import { useEffect, useLayoutEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import { FRAG, VERT } from "../art/ChromeField.tsx";
import { ChromeMark } from "../art/ChromeMark.tsx";

/**
 * A 30-second film in the site's own visual language, rendered deterministically from `t` (seconds):
 * every opacity, offset and shader uniform is a pure function of t, so frame-by-frame capture is smooth.
 * Figures shown are the synthetic demo batch's (records R-0009, R-0005, R-0032).
 */
export const DURATION = 30;
export type Shape = "wide" | "square";

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
/** 0→1 across [a, b] with ease-out (cubic). */
const seg = (t: number, a: number, b: number) => 1 - Math.pow(1 - clamp((t - a) / (b - a)), 3);
/** In across [a, a+d], out across [b, b+d]. */
const life = (t: number, a: number, b: number, d = 0.6) => Math.min(seg(t, a, a + d), 1 - seg(t, b, b + d));
const smooth = (t: number, a: number, b: number) => { const x = clamp((t - a) / (b - a)); return x * x * (3 - 2 * x); };
const lerp = (a: number, b: number, x: number) => a + (b - a) * x;

/** Rise-in style: fades and slides up as k goes 0→1. */
const rise = (k: number, px = 28): CSSProperties => ({ opacity: k, transform: `translateY(${(1 - k) * px}px)` });

// Synthetic rows. The flagged ones use the demo batch's figures (R-0009's arithmetic, the R-0005/R-0032 reuse pair).
const ROWS = [
  ["R-0003", "V-1004", "INV-40052", "2026-02-11", "1,204.50"],
  ["R-0005", "V-1037", "INV-6002", "2026-06-30", "6,350.44"],
  ["R-0009", "V-1029", "INV-40061", "2026-03-04", "7,668.65"],
  ["R-0014", "V-1012", "INV-40075", "2026-03-19", "2,410.00"],
  ["R-0021", "V-1021", "INV-40076", "2026-04-02", "915.30"],
  ["R-0032", "V-1037", "INV-6002", "2025-06-30", "1,835.96"],
  ["R-0040", "V-1015", "INV-40077", "2026-04-27", "3,120.75"],
] as const;
const MISMATCH = "R-0009";
const PAIR = new Set(["R-0005", "R-0032"]);

function useShader(canvas: React.RefObject<HTMLCanvasElement | null>) {
  const gl = useRef<{ ctx: WebGLRenderingContext; u: (n: string) => WebGLUniformLocation | null } | null>(null);
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext("webgl", { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: true });
    if (!c || !ctx) return;
    const sh = (type: number, src: string) => { const s = ctx.createShader(type)!; ctx.shaderSource(s, src); ctx.compileShader(s); return s; };
    const prog = ctx.createProgram()!;
    ctx.attachShader(prog, sh(ctx.VERTEX_SHADER, VERT));
    ctx.attachShader(prog, sh(ctx.FRAGMENT_SHADER, FRAG));
    ctx.linkProgram(prog);
    ctx.useProgram(prog);
    ctx.bindBuffer(ctx.ARRAY_BUFFER, ctx.createBuffer());
    ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), ctx.STATIC_DRAW);
    const loc = ctx.getAttribLocation(prog, "a");
    ctx.enableVertexAttribArray(loc);
    ctx.vertexAttribPointer(loc, 2, ctx.FLOAT, false, 0, 0);
    gl.current = { ctx, u: (n) => ctx.getUniformLocation(prog, n) };
  }, [canvas]);
  return gl;
}

function Row({ cells, style, className }: { readonly cells: readonly string[]; readonly style?: CSSProperties; readonly className?: string }) {
  return (
    <div className={`f-row ${className ?? ""}`} style={style}>
      {cells.map((c, i) => <span key={i} className={i === 4 ? "num" : undefined}>{c}</span>)}
    </div>
  );
}

function Typed({ text, k }: { readonly text: string; readonly k: number }) {
  const n = Math.round(text.length * clamp(k));
  return <>{text.slice(0, n)}<span className="f-caret" style={{ opacity: k > 0 && k < 1 ? 1 : 0 }}>|</span></>;
}

function Layer({ style, children, className }: { readonly style?: CSSProperties; readonly children: ReactNode; readonly className?: string }) {
  return <div className={`f-layer ${className ?? ""}`} style={style}>{children}</div>;
}

export function Film({ t, shape }: { readonly t: number; readonly shape: Shape }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const gl = useShader(canvas);
  const sq = shape === "square";

  // ----- page tone: white → near-black across 20.0 to 22.6s, then dark to the end -----
  const dark = smooth(t, 20, 22.6);
  const ink = clamp((dark - 0.3) / 0.4);
  const bg = `rgb(${[255, 255, 255].map((v, i) => Math.round(lerp(v, [17, 18, 20][i]!, dark))).join(",")})`;
  const fg = `rgb(${[24, 24, 24].map((v, i) => Math.round(lerp(v, [243, 243, 241][i]!, ink))).join(",")})`;

  // ----- shader keyframes -----
  const reading = smooth(t, 4.2, 5.4) * (1 - smooth(t, 19.6, 21));       // calm ribbons behind the data scenes
  const alpha = lerp(seg(t, 0, 1.6), 0.26, reading);
  const swirl = lerp(0.18, 0, smooth(t, 3.5, 5.5)) + 0.5 * smooth(t, 20, 23) - 0.2 * smooth(t, 25.5, 27.5);
  const clearZ = lerp(1, 0.25, reading) * (1 - 0.35 * smooth(t, 20, 23));
  const cx = sq ? 0 : lerp(-0.45, 0, smooth(t, 20, 23));
  const cy = sq ? lerp(0.12, 0, smooth(t, 20, 23)) : lerp(-0.04, 0.02, smooth(t, 20, 23));

  useLayoutEffect(() => {
    const g = gl.current, c = canvas.current;
    if (!g || !c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const { ctx, u } = g;
    ctx.viewport(0, 0, w, h);
    ctx.uniform2f(u("u_res"), w, h);
    ctx.uniform1f(u("u_time"), 7 + t);
    ctx.uniform1f(u("u_alpha"), alpha);
    ctx.uniform1f(u("u_swirl"), swirl);
    ctx.uniform1f(u("u_shift"), t * 0.18);
    ctx.uniform3f(u("u_clear"), cx, cy, clearZ);
    ctx.uniform1f(u("u_dark"), dark);
    ctx.clearColor(0, 0, 0, 0);
    ctx.clear(ctx.COLOR_BUFFER_BIT);
    ctx.drawArrays(ctx.TRIANGLES, 0, 3);
  });

  // ----- scene timing -----
  const heroK = life(t, 0.5, 4.2, 0.9);
  const tableIn = life(t, 4.6, 19.8, 0.8);
  const highlight = life(t, 9.0, 14.6, 0.5);
  const arith = life(t, 9.6, 14.6, 0.7);
  const pairK = life(t, 15.0, 19.8, 0.8);
  const darkHead = life(t, 21.6, 25.8, 0.9);
  const endK = seg(t, 26.4, 27.4);

  const arithLines: readonly (readonly [string, string, number])[] = [
    ["Subtotal", "7,518.73", 10.0],
    ["+ Tax", "620.29", 10.25],
    ["+ Shipping", "0.00", 10.5],
    ["− Discount", "470.36", 10.75],
    ["Should total", "7,668.66", 11.2],
    ["Invoice says", "7,668.65", 11.6],
  ];

  return (
    <div className={`film film-${shape}`} style={{ background: bg, color: fg } as CSSProperties}>
      <canvas ref={canvas} className="f-canvas" aria-hidden="true" />

      {/* Scene A, hero */}
      <Layer className="f-hero" style={{ opacity: heroK }}>
        <p className="f-kicker" style={rise(seg(t, 0.5, 1.4), 16)}>Invoice review · free prototype</p>
        <h1 className="f-display">
          <span style={rise(seg(t, 0.8, 1.9))}>Catch invoice errors</span>
          <span style={rise(seg(t, 1.15, 2.25))}>before they're paid</span>
        </h1>
        <p className="f-lede" style={rise(seg(t, 1.7, 2.7), 14)}>Duplicate bills. Totals that don't add up. Right in your browser.</p>
      </Layer>

      {/* Scenes B-D, the data */}
      <Layer className="f-data" style={{ opacity: tableIn }}>
        <div className="f-caption" style={{ opacity: life(t, 5.0, 8.6, 0.5) }}>Export your bills as a CSV. Drop it in.</div>
        <div className="f-caption" style={{ opacity: life(t, 9.0, 14.4, 0.5) }}>Says 7,668.65. Adds up to 7,668.66.</div>
        <div className="f-caption" style={{ opacity: life(t, 15.2, 17.0, 0.5) }}>Same vendor. Same invoice number.</div>
        <div className="f-caption" style={{ opacity: life(t, 17.2, 19.6, 0.5) }}>Not every flag is an error. You decide.</div>

        <div className="f-stage">
          <div className="f-file" style={{ ...rise(seg(t, 4.9, 5.7), 40), opacity: seg(t, 4.9, 5.7) * (1 - seg(t, 6.6, 7.2)) }}>
            <span className="f-file-icon">CSV</span>
            <span>bills-2026.csv</span>
            <span className="f-file-meta">QuickBooks export · 120 rows</span>
          </div>

          <div className="f-table" style={{ opacity: seg(t, 6.4, 7.2) * (1 - 0.82 * pairK) }}>
            <Row className="f-head" cells={["Record", "Vendor", "Invoice", "Date", "Total"]} />
            {ROWS.map((r, i) => {
              const k = seg(t, 6.6 + i * 0.16, 7.3 + i * 0.16);
              const hot = r[0] === MISMATCH ? highlight : 0;
              const pair = PAIR.has(r[0]) ? pairK : 0;
              return (
                <Row key={r[0]} cells={r} className={hot > 0.5 ? "is-hot" : pair > 0.5 ? "is-pair" : undefined}
                  style={{ ...rise(k, 18), opacity: k * (r[0] === MISMATCH || PAIR.has(r[0]) ? 1 : 1 - 0.55 * Math.max(highlight, pairK)) }} />
              );
            })}
          </div>

          <div className="f-arith" style={{ ...rise(arith, 30), opacity: arith }}>
            <p className="f-arith-title">Total mismatch · R-0009</p>
            {arithLines.map(([label, value, at], i) => (
              <div key={label} className={`f-arith-line ${i >= 4 ? "is-strong" : ""}`} style={rise(seg(t, at, at + 0.4), 10)}>
                <span>{label}</span><span className="num">{value}</span>
              </div>
            ))}
            <div className="f-delta" style={{ opacity: seg(t, 12.1, 12.6), transform: `scale(${lerp(0.7, 1, seg(t, 12.1, 12.7))})` }}>
              <span className="num">−0.01</span>
              <span>Flagged for a person to check</span>
            </div>
          </div>

          <div className="f-pair" style={{ opacity: pairK }}>
            {[ROWS[1], ROWS[5]].map((r, i) => (
              <div key={r[0]} className="f-card" style={rise(seg(t, 15.2 + i * 0.25, 16.0 + i * 0.25), 30)}>
                <p className="f-card-id">{r[0]}</p>
                <dl>
                  <div><dt>Vendor</dt><dd>{r[1]}</dd></div>
                  <div><dt>Invoice</dt><dd>{r[2]}</dd></div>
                  <div className="is-diff"><dt>Date</dt><dd className="num">{r[3]}</dd></div>
                  <div className="is-diff"><dt>Total</dt><dd className="num">{r[4]}</dd></div>
                </dl>
              </div>
            ))}
            <div className="f-decide" style={rise(seg(t, 17.4, 18.1), 16)}>
              <span className="f-btn">Confirm finding</span>
              <span className={`f-btn ${t > 18.3 ? "is-on" : ""}`}>Dismiss candidate</span>
              <span className="f-reason"><Typed text="Different billing year. Legitimate reuse." k={seg(t, 18.5, 19.5)} /></span>
            </div>
          </div>
        </div>
      </Layer>

      {/* Scene E, the dark */}
      <Layer className="f-center" style={{ opacity: darkHead }}>
        <h2 className="f-display f-display-mid">
          <span style={rise(seg(t, 21.6, 22.6))}>Your invoices never</span>
          <span style={rise(seg(t, 21.9, 22.9))}>leave your browser.</span>
        </h2>
        <p className="f-lede" style={rise(seg(t, 22.6, 23.5), 14)}>No upload · No account · Delete it all in one click</p>
      </Layer>

      {/* Scene F, end card */}
      <Layer className="f-center f-end" style={{ opacity: endK }}>
        <div className="f-brand" style={{ transform: `scale(${lerp(0.92, 1, endK)})` }}>
          <ChromeMark className="f-mark" />
          <span>Preflight</span>
        </div>
        <p className="f-lede" style={rise(seg(t, 27.0, 27.8), 12)}>Catch invoice errors before they're paid.</p>
        <p className="f-url" style={rise(seg(t, 27.5, 28.3), 12)}>preflight-finance-portfolio.vercel.app</p>
        <p className="f-fine" style={{ opacity: seg(t, 28.0, 28.8) }}>Free prototype · figures shown are from the synthetic demo</p>
      </Layer>
    </div>
  );
}
