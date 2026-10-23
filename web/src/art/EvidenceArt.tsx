/**
 * Original abstract artwork: three invoice sheets drift toward a ring where one line item is
 * checked. Decorative only (aria-hidden); no external assets.
 */
export function EvidenceArt({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 480 400" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="pf-metal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f2f5f7" />
          <stop offset="0.45" stopColor="#a9b6bf" />
          <stop offset="0.7" stopColor="#e3e9ec" />
          <stop offset="1" stopColor="#7d8b95" />
        </linearGradient>
        <linearGradient id="pf-teal" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#2dd4bf" />
          <stop offset="1" stopColor="#0f766e" />
        </linearGradient>
        <radialGradient id="pf-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#2dd4bf" stopOpacity="0.35" />
          <stop offset="1" stopColor="#2dd4bf" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="320" cy="200" r="170" fill="url(#pf-glow)" />

      {/* converging paths */}
      <g fill="none" stroke="url(#pf-teal)" strokeWidth="2" strokeLinecap="round" opacity="0.7">
        <path d="M70 80 C 170 90, 220 150, 300 190" />
        <path d="M50 210 C 150 210, 220 205, 296 202" />
        <path d="M80 330 C 170 310, 230 250, 300 214" />
      </g>

      {/* invoice sheets */}
      <g>
        <g transform="translate(24 40) rotate(-8)">
          <rect width="92" height="116" rx="10" fill="#17232b" stroke="url(#pf-metal)" strokeWidth="2" />
          <rect x="14" y="18" width="46" height="6" rx="3" fill="#a9b6bf" />
          <rect x="14" y="40" width="64" height="4" rx="2" fill="#4b5b66" />
          <rect x="14" y="54" width="64" height="4" rx="2" fill="#4b5b66" />
          <rect x="14" y="68" width="40" height="4" rx="2" fill="#4b5b66" />
          <rect x="44" y="92" width="34" height="8" rx="4" fill="#2dd4bf" />
        </g>
        <g transform="translate(8 160)">
          <rect width="92" height="116" rx="10" fill="#17232b" stroke="url(#pf-metal)" strokeWidth="2" />
          <rect x="14" y="18" width="46" height="6" rx="3" fill="#a9b6bf" />
          <rect x="14" y="40" width="64" height="4" rx="2" fill="#4b5b66" />
          <rect x="14" y="54" width="64" height="4" rx="2" fill="#4b5b66" />
          <rect x="14" y="68" width="40" height="4" rx="2" fill="#4b5b66" />
          <rect x="44" y="92" width="34" height="8" rx="4" fill="#e3e9ec" />
        </g>
        <g transform="translate(40 280) rotate(7)">
          <rect width="92" height="100" rx="10" fill="#17232b" stroke="url(#pf-metal)" strokeWidth="2" />
          <rect x="14" y="18" width="46" height="6" rx="3" fill="#a9b6bf" />
          <rect x="14" y="40" width="64" height="4" rx="2" fill="#4b5b66" />
          <rect x="14" y="54" width="40" height="4" rx="2" fill="#4b5b66" />
          <rect x="44" y="76" width="34" height="8" rx="4" fill="#a9b6bf" />
        </g>
      </g>

      {/* evidence ring */}
      <circle cx="320" cy="202" r="96" fill="none" stroke="url(#pf-metal)" strokeWidth="10" />
      <circle cx="320" cy="202" r="78" fill="#0f1a20" stroke="#2dd4bf" strokeWidth="1.5" strokeDasharray="4 7" />
      <g transform="translate(270 160)">
        <rect width="100" height="12" rx="6" fill="#4b5b66" />
        <rect y="24" width="100" height="12" rx="6" fill="#4b5b66" />
        <rect y="48" width="64" height="12" rx="6" fill="url(#pf-teal)" />
        <path d="M76 56 l9 9 l18 -20" fill="none" stroke="#2dd4bf" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </g>

      {/* metallic ribbon */}
      <path d="M200 380 C 300 330, 380 360, 470 300" fill="none" stroke="url(#pf-metal)" strokeWidth="14" strokeLinecap="round" opacity="0.55" />
      <path d="M220 30 C 300 60, 400 20, 470 70" fill="none" stroke="url(#pf-metal)" strokeWidth="6" strokeLinecap="round" opacity="0.4" />
    </svg>
  );
}
