import { useId } from "react";

/**
 * Original Preflight mark — the "check-P" monogram: one continuous inflated chrome tube.
 * A check's short leg drops in, its long stroke rises into the stem of a P and curls round
 * into the bowl, so "pre-flight check" lives in a single shape. Pure SVG (no images):
 * a chrome horizon-reflection body, iridescent blue–peach rim, specular streak and a soft
 * contact shadow. Gradient/filter ids are per-instance so several marks can share a page.
 */
const PATH = "M14 63 L31 80 L31 36 C31 21 42 13 56 13 C72 13 84 23 84 38 C84 53 72 62 57 62 L44 62";

export function ChromeMark({ className, title, animated = false }: { readonly className?: string; readonly title?: string; readonly animated?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const body = `${id}-body`;
  const rim = `${id}-rim`;
  const spec = `${id}-spec`;
  const shadow = `${id}-shadow`;
  return (
    <svg className={animated ? `${className ?? ""} mark-anim` : className} viewBox="0 0 100 96" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <defs>
        {/* Chrome: bright sky, cool mid, dark horizon band, bright ground bounce. */}
        <linearGradient id={body} x1="0.1" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.22" stopColor="#dfe3ea" />
          <stop offset="0.42" stopColor="#8d95a1" />
          <stop offset="0.5" stopColor="#3a4049" />
          <stop offset="0.56" stopColor="#c9d0d9" />
          <stop offset="0.74" stopColor="#f7f9fc" />
          <stop offset="0.9" stopColor="#a9b1bc" />
          <stop offset="1" stopColor="#e9edf2" />
        </linearGradient>
        <linearGradient id={rim} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#7fb0ff" />
          <stop offset="0.35" stopColor="#c7b8ff" />
          <stop offset="0.6" stopColor="#ffc9ad" />
          <stop offset="1" stopColor="#8fd0ff" />
        </linearGradient>
        <linearGradient id={spec} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.3" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="0.7" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <filter id={shadow} x="-30%" y="-30%" width="160%" height="170%">
          <feGaussianBlur stdDeviation="3.2" />
        </filter>
      </defs>
      {/* contact shadow */}
      <path pathLength={1} d={PATH} transform="translate(2 7)" fill="none" stroke="#24344d" strokeOpacity="0.22" strokeWidth="17" strokeLinecap="round" strokeLinejoin="round" filter={`url(#${shadow})`} />
      {/* iridescent rim */}
      <path pathLength={1} d={PATH} fill="none" stroke={`url(#${rim})`} strokeWidth="19" strokeLinecap="round" strokeLinejoin="round" />
      {/* chrome body */}
      <path pathLength={1} d={PATH} fill="none" stroke={`url(#${body})`} strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
      {/* lower core shade gives the tube volume */}
      <path pathLength={1} d={PATH} transform="translate(0.8 3.4)" fill="none" stroke="#1f2630" strokeOpacity="0.28" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      {/* specular streak along the top of the tube */}
      <path pathLength={1} d={PATH} transform="translate(-1.4 -4)" fill="none" stroke={`url(#${spec})`} strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
      {/* travelling glint (intro only) */}
      {animated ? <path pathLength={1} className="mark-glint" d={PATH} fill="none" stroke="#ffffff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" /> : null}
    </svg>
  );
}
