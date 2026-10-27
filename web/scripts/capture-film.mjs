// Renders web/film/ frame by frame in headless Edge over the DevTools protocol (no extra packages:
// Node's built-in WebSocket), then encodes with ffmpeg.
// Usage: node scripts/capture-film.mjs <filmUrl> <shape: wide|square> <outFile.mp4> [fps] [framesDir]
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const [filmUrl, shape = "wide", out = "film.mp4", fpsArg = "30", framesArg] = process.argv.slice(2);
const fps = Number(fpsArg);
const [W, H] = shape === "square" ? [1080, 1080] : [1920, 1080];
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const port = 9333 + (shape === "square" ? 1 : 0);
const profile = join(tmpdir(), `film-edge-${shape}`);
const frames = framesArg ?? join(tmpdir(), `film-frames-${shape}`);
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });

const edge = spawn(EDGE, [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${W},${H}`,
  "--hide-scrollbars", "--force-device-scale-factor=1", "--no-first-run", "--disable-extensions", "--mute-audio",
  "--enable-unsafe-swiftshader", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 60 && !target; i++) {
  await sleep(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = list.find((t) => t.type === "page");
  } catch { /* not up yet */ }
}
if (!target) throw new Error("Edge did not start");

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  pending.set(n, { resolve, reject });
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: `${filmUrl}?shape=${shape}` });
for (let i = 0; i < 80; i++) {
  await sleep(250);
  try { if (await evaluate("!!window.__film")) break; } catch { /* navigating */ }
}
await evaluate("window.__film.ready");
const duration = await evaluate("window.__film.duration");
const total = Math.round(duration * fps);
const webgl = await evaluate("!!document.createElement('canvas').getContext('webgl')");
console.log(`${shape}: ${W}x${H}, ${total} frames at ${fps} fps, WebGL ${webgl ? "on" : "OFF"}`);

const started = Date.now();
for (let f = 0; f < total; f++) {
  await evaluate(`window.__film.set(${(f / fps).toFixed(5)})`);
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(join(frames, `${String(f).padStart(5, "0")}.png`), Buffer.from(shot.data, "base64"));
  if (f % 90 === 0) console.log(`  frame ${f}/${total} (${Math.round((Date.now() - started) / 1000)}s)`);
}
ws.close();
edge.kill();

const enc = spawnSync("ffmpeg", [
  "-v", "error", "-y", "-framerate", String(fps), "-i", join(frames, "%05d.png"),
  "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out,
], { stdio: "inherit" });
if (enc.status !== 0) throw new Error("ffmpeg failed");
console.log(`wrote ${out}`);
