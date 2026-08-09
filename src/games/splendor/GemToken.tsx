import type { GemColor, TokenColor } from "./cards";

/**
 * Pure inline-SVG/CSS "round acrylic poker chip" token visual — no external
 * image asset, same convention as century/ResourceIcon.tsx and
 * perudo/PerudoFaceIcon.tsx. Colors follow the rulebook's own naming (§2):
 * 다이아몬드(흰), 사파이어(파랑), 에메랄드(초록), 루비(빨강), 오닉스(검정), plus
 * the wildcard 황금(조커) token.
 */
export const GEM_META: Record<GemColor, { fill: string; edge: string; label: string }> = {
  white: { fill: "#f8fafc", edge: "#94a3b8", label: "다이아몬드 (흰색)" },
  blue: { fill: "#38bdf8", edge: "#0c4a6e", label: "사파이어 (파란색)" },
  green: { fill: "#34d399", edge: "#065f46", label: "에메랄드 (초록색)" },
  red: { fill: "#f87171", edge: "#7f1d1d", label: "루비 (빨간색)" },
  black: { fill: "#64748b", edge: "#020617", label: "오닉스 (검은색)" },
};
const GOLD_META = { fill: "#fde68a", edge: "#92400e", label: "황금 (조커)" };

export function tokenMeta(color: TokenColor) {
  return color === "gold" ? GOLD_META : GEM_META[color];
}

/**
 * A layered radial gradient + dashed inner ring stands in for a real casino
 * chip's edge markings, and a soft top-left highlight gives it a glossy,
 * slightly domed acrylic look — built entirely from CSS (no image asset).
 */
export function GemChip({
  color,
  className = "h-8 w-8",
  title,
}: {
  color: TokenColor;
  className?: string;
  title?: string;
}) {
  const meta = tokenMeta(color);
  return (
    <span
      role="img"
      aria-label={title ?? meta.label}
      title={title ?? meta.label}
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full ${className}`}
      style={{
        background: `radial-gradient(circle at 35% 30%, ${meta.fill} 0%, ${meta.fill} 45%, ${meta.edge} 100%)`,
        boxShadow:
          "inset 0 0 0 2px rgba(255,255,255,0.28), inset 0 -3px 5px rgba(0,0,0,0.35), inset 0 2px 2px rgba(255,255,255,0.4), 0 2px 4px rgba(0,0,0,0.5)",
        border: `2px dashed rgba(255,255,255,0.3)`,
      }}
    >
      <span className="pointer-events-none absolute inset-[16%] rounded-full" style={{ border: "1px solid rgba(255,255,255,0.35)" }} />
      <span
        className="pointer-events-none absolute top-[16%] left-[20%] h-[30%] w-[30%] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 75%)" }}
      />
    </span>
  );
}

/** Small "chip + count" badge for compact cost/bonus listings. */
export function GemCountBadge({ color, count, size = "h-4 w-4" }: { color: TokenColor; count: number; size?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/30 px-1.5 py-0.5 text-[11px] font-semibold text-white/90">
      <GemChip color={color} className={size} />
      {count}
    </span>
  );
}
