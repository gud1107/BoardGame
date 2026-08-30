import { EXPEDITION_THEME, type Card, type Color } from "./engine";

/**
 * Pure inline-styled card face — no external image asset, matching this
 * project's convention for simple card games (grid-poker's `cardDisplay.tsx`
 * CardChip is the closest analogue). Each of the 5 expedition colors gets its
 * own solid background + the rulebook intro's thematic emoji (§1,
 * `EXPEDITION_THEME`) so colorblind-adjacent confusion (e.g. red/green) still
 * has an icon+label backup, not color alone.
 */
const COLOR_CLASS: Record<Color, string> = {
  white: "bg-slate-100 text-slate-900 border-slate-300",
  green: "bg-emerald-500 text-white border-emerald-300",
  yellow: "bg-amber-400 text-amber-950 border-amber-200",
  red: "bg-rose-500 text-white border-rose-300",
  blue: "bg-sky-500 text-white border-sky-300",
};

const SIZE_DIMS: Record<"sm" | "md" | "lg", string> = {
  sm: "h-12 w-9 sm:h-14 sm:w-10",
  md: "h-16 w-12 sm:h-20 sm:w-14",
  lg: "h-20 w-14 sm:h-24 sm:w-16",
};
const SIZE_TEXT: Record<"sm" | "md" | "lg", string> = {
  sm: "text-sm",
  md: "text-lg sm:text-xl",
  lg: "text-xl sm:text-2xl",
};

export default function CardFace({
  card,
  size = "md",
  selected = false,
  faded = false,
  onClick,
}: {
  card: Card;
  size?: "sm" | "md" | "lg";
  /** Highlighted as the currently-selected hand card. */
  selected?: boolean;
  /** Dimmed — used for the "just discarded, can't take back this turn" top-of-pile card. */
  faded?: boolean;
  onClick?: () => void;
}) {
  const theme = EXPEDITION_THEME[card.color];
  const className = `relative flex ${SIZE_DIMS[size]} flex-col items-center justify-center gap-0.5 rounded-lg border-2 font-bold shadow-sm transition ${COLOR_CLASS[card.color]} ${
    selected ? "-translate-y-2 ring-4 ring-white/80" : ""
  } ${faded ? "opacity-35" : ""} ${onClick ? "cursor-pointer active:scale-95" : "cursor-default"}`;
  const label = `${theme.name} ${card.kind === "investment" ? "투자 카드" : card.value}`;
  const content = (
    <>
      <span className="text-[10px] leading-none opacity-70 sm:text-xs">{theme.emoji}</span>
      <span className={`${SIZE_TEXT[size]} leading-none`}>{card.kind === "investment" ? "🤝" : card.value}</span>
    </>
  );
  // Only ever a real <button> when it's independently clickable (hand
  // cards) — every other usage (lane stacks, discard-pile tops) is nested
  // inside an *outer* button that already carries the actual click handler
  // (LostCitiesBoard.tsx's `LaneStack`/discard-pile buttons), and nesting an
  // interactive <button> inside another is invalid HTML that browsers
  // silently mangle (closes the outer button early) — plain markup here
  // avoids that entirely.
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className} aria-label={label}>
        {content}
      </button>
    );
  }
  return (
    <div className={className} aria-label={label}>
      {content}
    </div>
  );
}

export function CardBack({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  return (
    <div
      className={`flex ${SIZE_DIMS[size]} items-center justify-center rounded-lg border-2 border-white/20 bg-gradient-to-br from-slate-700 to-slate-900 text-white/30`}
      aria-hidden
    >
      🗺️
    </div>
  );
}
