import { GemChip, GEM_META } from "@/games/splendor/GemToken";
import type { GemColor, TokenColor } from "./engine";

/**
 * Token visuals for 스플렌더 대결 — gems and gold reuse base Splendor's
 * CSS-only acrylic chip (`splendor/GemToken.tsx`, no image assets), and the
 * one token base Splendor doesn't have, the pearl, gets its own iridescent
 * CSS sphere in the same style.
 */
export const TOKEN_LABEL: Record<TokenColor, string> = {
  white: "흰색",
  blue: "파랑",
  green: "녹색",
  red: "빨강",
  black: "검정",
  pearl: "진주",
  gold: "황금",
};

export const COLOR_ACCENT: Record<GemColor, string> = {
  white: GEM_META.white.fill,
  blue: GEM_META.blue.fill,
  green: GEM_META.green.fill,
  red: GEM_META.red.fill,
  black: GEM_META.black.fill,
};

export function DuelToken({ color, className = "h-8 w-8" }: { color: TokenColor; className?: string }) {
  if (color !== "pearl") return <GemChip color={color} className={className} title={TOKEN_LABEL[color]} />;
  return (
    <span
      role="img"
      aria-label="진주"
      title="진주"
      className={`relative inline-flex shrink-0 rounded-full ${className}`}
      style={{
        background: "radial-gradient(circle at 32% 28%, #ffffff 0%, #fdf2f8 22%, #e9d5ff 55%, #a78bfa 85%, #6d28d9 100%)",
        boxShadow: "inset 0 -3px 6px rgba(76,29,149,0.45), inset 0 2px 3px rgba(255,255,255,0.8), 0 0 10px rgba(233,213,255,0.45), 0 2px 4px rgba(0,0,0,0.5)",
      }}
    >
      <span
        className="pointer-events-none absolute top-[14%] left-[20%] h-[28%] w-[28%] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0) 75%)" }}
      />
    </span>
  );
}

/** Compact "token + count" chip for cost rows and inventories. */
export function TokenCount({ color, count, size = "h-3.5 w-3.5", dim = false }: { color: TokenColor; count: number; size?: string; dim?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-0.5 font-mono text-[11px] font-bold tabular-nums ${dim ? "opacity-35" : ""}`}>
      <DuelToken color={color} className={size} />
      {count}
    </span>
  );
}
