import { createRoot } from "react-dom/client";
import { Film, DURATION } from "./Film.tsx";
import "./film.css";

/**
 * Dev-only film entry. The capture script calls window.__film.set(t) for each frame and waits for
 * window.__film.ready; with ?play the film also plays in real time for previewing.
 */
const params = new URLSearchParams(location.search);
const shape = params.get("shape") === "square" ? "square" : "wide";
const root = createRoot(document.getElementById("film")!);

let current = Number(params.get("t") ?? 0);
const render = (t: number) => root.render(<Film t={t} shape={shape} />);

declare global {
  interface Window { __film: { duration: number; ready: Promise<void>; set(t: number): Promise<void> } }
}

window.__film = {
  duration: DURATION,
  ready: document.fonts.ready.then(() => undefined),
  set: (t: number) =>
    new Promise<void>((done) => {
      current = t;
      render(t);
      // Two frames: React commit, then the WebGL draw in Film's layout effect has been composited.
      requestAnimationFrame(() => requestAnimationFrame(() => done()));
    }),
};

render(current);
if (params.has("play")) {
  const start = performance.now() - current * 1000;
  const tick = () => {
    render(((performance.now() - start) / 1000) % DURATION);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
