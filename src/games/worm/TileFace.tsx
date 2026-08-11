/**
 * Pure inline-CSS tile visual — no external image assets, same
 * "<Feature>Icon.tsx" convention as `DieFace.tsx` / `five-cucumbers/CucumberIcon.tsx`.
 * Worm-icon count (1-4) drives both the badge row and a soil-to-grass color
 * ramp so a glance at the center grid reads "high-value tiles are greener".
 */

const TIER_BG: Record<number, string> = {
  1: "linear-gradient(160deg,#a3e635 0%,#4d7c0f 100%)",
  2: "linear-gradient(160deg,#84cc16 0%,#3f6212 100%)",
  3: "linear-gradient(160deg,#65a30d 0%,#365314 100%)",
  4: "linear-gradient(160deg,#4d7c0f 0%,#1a2e05 100%)",
};

export function WormRow({ count, size = "h-2.5 w-2.5" }: { count: number; size?: string }) {
  return (
    <div className="flex items-center justify-center gap-0.5">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={`${size} leading-none`}>
          🪱
        </span>
      ))}
    </div>
  );
}

export function TileFace({
  tileNumber,
  worms,
  size = "h-16 w-14",
  faceDown = false,
  className = "",
}: {
  tileNumber: number;
  worms: number;
  size?: string;
  /** Rendered as a "비공개" flipped-down tile — removed-from-play tiles from a bust. */
  faceDown?: boolean;
  className?: string;
}) {
  if (faceDown) {
    return (
      <div
        className={`flex shrink-0 flex-col items-center justify-center rounded-lg border border-black/40 text-white/30 ${size} ${className}`}
        style={{ background: "linear-gradient(160deg,#3f3f46 0%,#18181b 100%)" }}
        title="비공개(제거된 타일)"
      >
        <span className="text-lg">🂠</span>
      </div>
    );
  }
  return (
    <div
      className={`flex shrink-0 flex-col items-center justify-between rounded-lg border border-black/40 p-1 shadow-[0_3px_8px_-2px_rgba(0,0,0,0.6)] ${size} ${className}`}
      style={{ background: TIER_BG[worms] ?? TIER_BG[1] }}
    >
      <WormRow count={worms} />
      <span className="text-lg leading-none font-black text-white drop-shadow-sm">{tileNumber}</span>
    </div>
  );
}
