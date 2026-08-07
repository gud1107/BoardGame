/**
 * The 페루도 face (die value 1) — replaces the earlier skull emoji placeholder
 * with a hand-drawn recreation of the actual die's engraved crest (spike +
 * open crescent bracket + two eye dots + a scalloped dot-fringe), based on
 * the physical die reference photo. A good-faith stylized recreation of the
 * general iconographic impression, not a pixel copy of any copyrighted mark.
 * `currentColor`-driven so callers control color via a text-color class —
 * used white-on-red (see the die-face background in PerudoBoard.tsx) to
 * match the physical die's white-on-red engraving.
 */
export default function PerudoFaceIcon({ className = "h-full w-full" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      {/* spike/ear */}
      <polygon points="14,40 36,15 36,48" fill="currentColor" />
      {/* open crescent bracket */}
      <path
        d="M44,20 A28,28 0 0 1 44,80"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
      />
      {/* eyes */}
      <circle cx="45" cy="40" r="5" fill="currentColor" />
      <circle cx="60" cy="40" r="5" fill="currentColor" />
      {/* scalloped dot-fringe */}
      <circle cx="38" cy="64" r="4" fill="currentColor" />
      <circle cx="48" cy="72" r="4" fill="currentColor" />
      <circle cx="60" cy="74" r="4" fill="currentColor" />
      <circle cx="71" cy="69" r="4" fill="currentColor" />
      <circle cx="78" cy="59" r="4" fill="currentColor" />
    </svg>
  );
}
