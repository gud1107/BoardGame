/**
 * The 페루도 face (die value 1) — redesigned as a 5-point star medallion to
 * match the new reference asset `boardGameRule/페루도/페루도모양.avif`
 * (copied into the app at `public/assets/games/perudo/mark.avif`) and the
 * updated rulebook wording: "주사위의 1번 눈에는 일반 숫자 1 대신 별모양인
 * 페루도 마크가 그려져 있습니다." (previously a domed ladybug medallion,
 * itself a redraw of an earlier photo reference — see git history).
 *
 * Drawn as a single closed polygon (5 outer points + 5 inner points,
 * alternating) rather than embedding the raster photo/avif directly: this
 * icon is reused across many contexts that each need their own tint —
 * white-on-red on the physical-looking die face, a per-player "ink" color on
 * each seat's own dice colorway, a low-opacity black watermark on the bid
 * track's medallion tiles, `text-red-400` in the rulebook modal — which only
 * a `currentColor`-driven vector can do; a static photo/avif embed would look
 * wrong in at least half of those spots. A good-faith stylized recreation of
 * the general iconographic impression, not a pixel trace of any photo.
 * Reused on the die face, the face picker, the bid track's watermark tiles,
 * the stats panel, and the rulebook (see PerudoBoard.tsx / RulebookModal.tsx).
 */
export default function PerudoFaceIcon({ className = "h-full w-full" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M50,8 L60,36.3 L90,37 L66.2,55.3 L74.7,84 L50,67 L25.3,84 L33.8,55.3 L10,37 L40,36.3 Z"
      />
    </svg>
  );
}
