/**
 * The Lens mark: two equal circles with their overlap cut out (and a hairline gap around it), so
 * the empty lens in the middle is "the duplicate being found". Flat, one colour (currentColor);
 * LensChrome is the 3D version used in the intro.
 *
 * Geometry (viewBox 154 x 100): circles r=50 at x=50 and x=104 (centres 0.54 r apart), the cut-out is
 * the intersection of the same circles grown to r=53.5.
 */
import { useId } from "react";

export const LENS_VIEWBOX = "0 0 154 100";

export function LensMark({ className, title }: { readonly className?: string; readonly title?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg className={className} viewBox={LENS_VIEWBOX} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <defs>
        <clipPath id={`${id}-c`}><circle cx="104" cy="50" r="53.5" /></clipPath>
        <mask id={`${id}-m`} maskUnits="userSpaceOnUse" x="-10" y="-10" width="174" height="120">
          <rect x="-10" y="-10" width="174" height="120" fill="#fff" />
          <circle cx="50" cy="50" r="53.5" fill="#000" clipPath={`url(#${id}-c)`} />
        </mask>
      </defs>
      <g mask={`url(#${id}-m)`} fill="currentColor">
        <circle cx="50" cy="50" r="50" />
        <circle cx="104" cy="50" r="50" />
      </g>
    </svg>
  );
}
