import { useEffect, useRef } from "react";

/**
 * Scroll-driven chrome ribbons (hand-written WebGL, no library).
 *
 * Sections opt in with `data-chrome="hero" | "statement" | "vortex" | "haze" | "off"`; the field eases
 * its opacity, vortex twist and text-clearing zone toward the mode of the section at the viewport centre. Decorative
 * only: aria-hidden, rendered at reduced resolution, paused while the tab is hidden, a single
 * static frame under prefers-reduced-motion, and a CSS gradient when WebGL is unavailable.
 */

const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;

const FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_swirl;
uniform float u_alpha;
uniform float u_shift;
uniform vec3 u_clear; // xy = centre of the text-clearing zone (aspect units), z = strength

mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// Studio-lit chrome ramp: bright sky, soft grey, dark horizon line, bright floor.
vec3 chrome(float v){
  v = clamp(v, 0.0, 1.0);
  vec3 c = mix(vec3(0.985, 0.99, 1.0), vec3(0.66, 0.70, 0.76), smoothstep(0.10, 0.40, v));
  c = mix(c, vec3(0.30, 0.33, 0.39), smoothstep(0.40, 0.52, v));
  c = mix(c, vec3(0.94, 0.96, 0.99), smoothstep(0.54, 0.68, v));
  c = mix(c, vec3(0.72, 0.76, 0.83), smoothstep(0.82, 1.0, v));
  return c;
}

void main(){
  vec2 s = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  // Keep text legible: fade ribbons inside an elliptical clearing around u_clear.
  float clearing = mix(1.0, smoothstep(0.22, 0.66, length((s - u_clear.xy) * vec2(0.52, 0.92))), u_clear.z);

  vec2 p = s;
  float r = length(p);
  p = rot(u_swirl * (2.6 / (r * 3.0 + 0.30) + u_time * 0.12)) * p;   // vortex twirl
  p = rot(-0.42 + 0.08 * sin(u_shift * 0.9)) * p;                      // diagonal flow

  float bundle = -0.10 + 0.22 * sin(p.x * 0.75 + u_time * 0.14 + u_shift * 1.25) + 0.05 * sin(p.x * 1.9 - u_time * 0.09);
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float twist = sin(p.x * (0.85 + fi * 0.2) + u_time * 0.21 + fi * 2.1 + u_shift * 0.8);
    // Smooth twist: the facing (+1 / -1) eases through edge-on instead of flipping (no seam).
    float facing = twist / (abs(twist) + 0.22);
    float th = (0.030 + 0.020 * fi) * (0.34 + 0.66 * abs(facing)) + 0.006;
    float yc = bundle + (fi - 1.0) * 0.105 + 0.03 * sin(p.x * 2.4 + fi * 1.3 + u_time * 0.17);
    float d = (p.y - yc) / th;
    float soft = 0.08 + 0.10 * fi;
    float cover = 1.0 - smoothstep(1.0 - soft, 1.0 + soft, abs(d));
    if (cover <= 0.001) continue;
    float nz = sqrt(max(0.0, 1.0 - d * d));
    float refl = 0.5 + 0.46 * d * facing + 0.08 * sin(p.x * 3.1 + fi + u_time * 0.25);
    vec3 col = chrome(refl);
    float rim = smoothstep(0.55, 0.99, abs(d));
    vec3 tint = mix(vec3(0.55, 0.72, 1.0), vec3(1.0, 0.79, 0.68), 0.5 + 0.5 * sin(p.x * 2.0 + fi * 1.7 + u_time * 0.2));
    col = mix(col, col * 0.5 + tint * 0.62, rim * 0.7);
    col += pow(nz, 26.0) * 0.20;
    float a = cover * (0.62 + 0.38 * nz) * u_alpha * clearing;
    acc.rgb += (1.0 - acc.a) * col * a;
    acc.a += (1.0 - acc.a) * a;
  }
  // Iridescent haze behind the ribbons.
  float h = exp(-pow(length(s - vec2(-0.6, -0.28)) * 2.0, 2.0)) * 0.26 * u_alpha * clearing
          + exp(-pow(length(s - vec2(0.75, 0.32)) * 2.4, 2.0)) * 0.16 * u_alpha * clearing;
  vec3 hc = mix(vec3(0.62, 0.78, 1.0), vec3(1.0, 0.86, 0.78), 0.5 + 0.5 * sin(u_time * 0.15 + s.y * 3.0 + s.x));
  acc.rgb += (1.0 - acc.a) * hc * h;
  acc.a += (1.0 - acc.a) * h;
  // Dither: +-0.5/255 noise breaks up 8-bit banding in the very soft haze.
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  acc += vec4(n / 255.0) * step(0.002, acc.a);
  gl_FragColor = acc;
}`;

type Mode = "hero" | "statement" | "vortex" | "haze" | "off";
interface Target { readonly alpha: number; readonly swirl: number; readonly cx: number; readonly cy: number; readonly clear: number }
const TARGET: Readonly<Record<Mode, Target>> = {
  hero: { alpha: 1, swirl: 0, cx: -0.5, cy: -0.04, clear: 1 },      // headline sits left
  statement: { alpha: 1, swirl: 0, cx: 0, cy: 0, clear: 1 },        // centred statement
  vortex: { alpha: 1, swirl: 1, cx: 0, cy: 0, clear: 0 },           // pure visual, no text
  haze: { alpha: 0.11, swirl: 0, cx: 0, cy: 0, clear: 0 },          // dense reading sections
  off: { alpha: 0, swirl: 0, cx: 0, cy: 0, clear: 0 },
};

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
}

/** Mode of the section crossing the viewport centre (pure; exported for tests). */
export function modeAt(sections: readonly { top: number; bottom: number; mode: string }[], centre: number): Mode {
  const hit = sections.find((s) => s.top <= centre && s.bottom > centre);
  const m = hit?.mode;
  return m && Object.hasOwn(TARGET, m) ? (m as Mode) : "haze";
}

export function ChromeField({ className }: { readonly className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: "low-power" });
    const vs = gl && compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = gl && compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl && vs && fs ? gl.createProgram() : null;
    if (!gl || !prog || !vs || !fs) {
      canvas.classList.add("chrome-fallback");
      return;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      canvas.classList.add("chrome-fallback");
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    const uRes = u("u_res"), uTime = u("u_time"), uSwirl = u("u_swirl"), uAlpha = u("u_alpha"), uShift = u("u_shift"), uClear = u("u_clear");

    // ponytail: renders at ~0.85x CSS pixels (cap 1.5 DPR); sharp enough for the thin horizon line, cheap for 3 ribbons.
    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 1.5) * 0.85;
      canvas.width = Math.max(1, Math.round(window.innerWidth * scale));
      canvas.height = Math.max(1, Math.round(window.innerHeight * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    const cur = { alpha: 0, swirl: 0, cx: -0.5, cy: -0.04, clear: 1 };
    let raf = 0, last = performance.now(), time = 7, cleared = false;
    const draw = (t: number, a: number, s: number, shift: number) => {
      gl.uniform3f(uClear, cur.cx, cur.cy, cur.clear);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, t);
      gl.uniform1f(uAlpha, a);
      gl.uniform1f(uSwirl, s);
      gl.uniform1f(uShift, shift);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    // Section elements are re-queried only every ~30 frames; their positions are read each frame (cheap, no writes).
    let sectionEls: HTMLElement[] = [];
    let sinceQuery = 30;
    const sections = () => {
      if (++sinceQuery >= 30) {
        sectionEls = Array.from(document.querySelectorAll<HTMLElement>("[data-chrome]"));
        sinceQuery = 0;
      }
      return sectionEls.map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, mode: el.dataset.chrome ?? "haze" };
      });
    };

    // GPU reset / context loss: stop drawing and fall back to the CSS gradient instead of a blank canvas.
    let lost = false;
    const onLost = (e: Event) => {
      e.preventDefault();
      lost = true;
      cancelAnimationFrame(raf);
      canvas.classList.add("chrome-fallback");
    };
    canvas.addEventListener("webglcontextlost", onLost);

    resize();
    if (reduce) {
      // One still, faint frame (no scroll linkage) so body text never sits on strong chrome.
      const still = () => draw(time, 0.22, 0, 0);
      still();
      const onResize = () => { resize(); still(); };
      window.addEventListener("resize", onResize);
      return () => {
        window.removeEventListener("resize", onResize);
        canvas.removeEventListener("webglcontextlost", onLost);
      };
    }

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) { last = now; return; }
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      time += dt;
      const target = TARGET[modeAt(sections(), window.innerHeight / 2)];
      const ease = 1 - Math.exp(-dt * 3.2);
      for (const k of ["alpha", "swirl", "cx", "cy", "clear"] as const) cur[k] += (target[k] - cur[k]) * ease;
      if (lost) return;
      if (cur.alpha < 0.004 && target.alpha === 0) {
        if (!cleared) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); cleared = true; }
        return; // invisible (e.g. behind the dark band): skip the full-screen shader
      }
      cleared = false;
      draw(time, cur.alpha, cur.swirl, window.scrollY / Math.max(window.innerHeight, 1));
    };
    raf = requestAnimationFrame(frame);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      canvas.removeEventListener("webglcontextlost", onLost);
      // No loseContext(): React StrictMode re-runs this effect on the same canvas in development.
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
