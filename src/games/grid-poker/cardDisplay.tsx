import { RANK_LABEL, type Card, type Suit } from "./engine";

export const SUIT_SYMBOL: Record<Suit, string> = { S: "♠", D: "◆", H: "♥", C: "♣" };
export const SUIT_TEXT_CLASS: Record<Suit, string> = {
  S: "text-slate-900",
  D: "text-rose-600",
  H: "text-rose-600",
  C: "text-slate-900",
};

export function rankLabel(rank: number): string {
  return RANK_LABEL[rank] ?? String(rank);
}

/**
 * Responsive size presets: each keeps the rank/suit legible (and the suit
 * glyph in particular large enough to tell ♠/♣ and ◆/♥ apart at a glance,
 * per the visibility pass) across phone-width up through desktop.
 */
const SIZE_DIMS: Record<"sm" | "md" | "lg", string> = {
  sm: "h-11 w-8 sm:h-12 sm:w-9",
  md: "h-14 w-10 text-sm sm:h-16 sm:w-12 sm:text-base",
  lg: "h-16 w-12 text-base sm:h-20 sm:w-14 sm:text-lg",
};
const SIZE_RANK_TEXT: Record<"sm" | "md" | "lg", string> = {
  sm: "text-[11px] sm:text-xs",
  md: "text-sm sm:text-base",
  lg: "text-base sm:text-xl",
};
const SIZE_SUIT_TEXT: Record<"sm" | "md" | "lg", string> = {
  sm: "text-sm sm:text-base",
  md: "text-lg sm:text-xl",
  lg: "text-xl sm:text-2xl",
};

/** Small fixed-size card face, used on the board grid, line pickers, and the rulebook's hand-ranking table. */
export function CardChip({
  card,
  size = "md",
  dim = false,
}: {
  card: Card | { kind: "std"; rank: number; suit: Suit } | { kind: "joker" };
  size?: "sm" | "md" | "lg";
  dim?: boolean;
}) {
  const dims = SIZE_DIMS[size];
  if (card.kind === "joker") {
    return (
      <span
        className={`inline-flex ${dims} flex-col items-center justify-center rounded-md border border-amber-400/40 bg-amber-400/10 font-bold text-amber-300 ${SIZE_SUIT_TEXT[size]} ${dim ? "opacity-40" : ""}`}
      >
        🃏
      </span>
    );
  }
  return (
    <span
      className={`inline-flex ${dims} flex-col items-center justify-center gap-0.5 rounded-md border border-white/15 bg-white/95 font-bold leading-none ${SUIT_TEXT_CLASS[card.suit]} ${dim ? "opacity-40" : ""}`}
    >
      <span className={SIZE_RANK_TEXT[size]}>{rankLabel(card.rank)}</span>
      <span className={SIZE_SUIT_TEXT[size]}>{SUIT_SYMBOL[card.suit]}</span>
    </span>
  );
}
