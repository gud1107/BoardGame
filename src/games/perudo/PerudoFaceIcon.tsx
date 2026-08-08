/**
 * The 페루도 face (die value 1) — a bold, high-contrast skull/mask medallion
 * (thick solid ring, wide dark eye sockets with a glint, a triangular nose,
 * and a jagged toothy grin), redesigned for instant readability at both
 * badge size (h-3) and full die size — the previous dashed-ray-ring version
 * turned into visual noise below ~16px. A good-faith stylized recreation of
 * the general iconographic impression (skull/mask on the "1" face), not a
 * pixel copy of any copyrighted mark. `currentColor`-driven so callers
 * control color via a text-color class — reused on the die face
 * (white-on-red), the face picker, the bid track's watermark tiles, the
 * stats panel, and the rulebook (see PerudoBoard.tsx / RulebookModal.tsx).
 */
export default function PerudoFaceIcon({ className = "h-full w-full" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      {/* outer solid ring — thick and simple so it survives shrinking to badge size */}
      <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="7" />
      {/* eye sockets, wide and dark for contrast, each with a small glint */}
      <circle cx="33" cy="41" r="12" fill="currentColor" />
      <circle cx="67" cy="41" r="12" fill="currentColor" />
      {/* nose — a simple downward triangle, skull-like */}
      <path d="M50,50 L44,62 L56,62 Z" fill="currentColor" />
      {/* jagged toothy grin, thicker strokes for legibility at small sizes */}
      <path
        d="M22,72 L30,82 L38,72 L46,82 L54,72 L62,82 L70,72 L78,82"
        fill="none"
        stroke="currentColor"
        strokeWidth="7.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
