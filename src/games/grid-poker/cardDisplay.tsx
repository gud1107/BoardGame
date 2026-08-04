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

/** Small fixed-size card face, used on the board grid, line pickers, and the rulebook's hand-ranking table. */
export function CardChip({
  card,
  size = "md",
  dim = false,
}: {
  card: Card | { kind: "std"; rank: number; suit: Suit } | { kind: "joker" };
  size?: "sm" | "md";
  dim?: boolean;
}) {
  const dims = size === "sm" ? "h-8 w-6 text-[10px]" : "h-12 w-9 text-sm";
  if (card.kind === "joker") {
    return (
      <span
        className={`inline-flex ${dims} flex-col items-center justify-center rounded-md border border-amber-400/40 bg-amber-400/10 font-bold text-amber-300 ${dim ? "opacity-40" : ""}`}
      >
        🃏
      </span>
    );
  }
  return (
    <span
      className={`inline-flex ${dims} flex-col items-center justify-center rounded-md border border-white/15 bg-white/95 font-bold leading-none ${SUIT_TEXT_CLASS[card.suit]} ${dim ? "opacity-40" : ""}`}
    >
      <span>{rankLabel(card.rank)}</span>
      <span>{SUIT_SYMBOL[card.suit]}</span>
    </span>
  );
}
