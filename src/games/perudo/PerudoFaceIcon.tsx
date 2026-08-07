/**
 * The 페루도 face (die value 1) — a symmetric Aztec/Mayan sun-mask medallion
 * (dashed ray ring + two round eyes + a zigzag toothy grin + a nose bump),
 * matching the repeating carved-medallion motif on the physical board mat
 * (see boardGameRule/Perudo.md's box photo). A good-faith stylized
 * recreation of the general iconographic impression, not a pixel copy of
 * any copyrighted mark. `currentColor`-driven so callers control color via
 * a text-color class — reused both on the die face (white-on-red) and as a
 * decorative watermark on the bid track's wood tiles (see PerudoBoard.tsx).
 */
export default function PerudoFaceIcon({ className = "h-full w-full" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      {/* outer ray ring */}
      <circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" strokeWidth="5" strokeDasharray="7 6" strokeLinecap="round" />
      {/* eyes */}
      <circle cx="34" cy="42" r="9" fill="currentColor" />
      <circle cx="66" cy="42" r="9" fill="currentColor" />
      {/* nose bump */}
      <rect x="45" y="48" width="10" height="12" rx="3" fill="currentColor" />
      {/* zigzag toothy grin */}
      <path
        d="M25,68 L33,77 L41,68 L49,77 L57,68 L65,77 L73,68"
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
