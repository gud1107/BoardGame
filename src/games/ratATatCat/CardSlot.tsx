import type { Card, HandCard } from "./engine";

/**
 * One hand-card slot's visual face — pure presentation, no game logic. Every
 * card in this game physically sits face-down on the table; what actually
 * changes per-viewer is only whether *this* viewer currently knows what's
 * under it:
 *
 * - `revealed` (game-over reveal): shows the real face to everyone.
 * - `knownToViewer` (own hand only — `RatATatCatBoard.tsx` never passes this
 *   true for another seat's hand): a dimmed "hint" face per the work order's
 *   "자신이 아는 카드는 살짝 투명한 힌트 표시" — still visibly a card-back
 *   silhouette so it reads as "still face-down on the table, I just happen
 *   to remember it" rather than an actual reveal. Only ever true for a card
 *   the owner actively placed via REPLACE_CARD (engine.ts docstring point 8)
 *   — permanent for the rest of the game.
 * - `peeking` (own hand only, temporary): a full-brightness reveal with a
 *   gold glow ring, for the few seconds a setup peek or the Peek power
 *   card is actively showing its value — deliberately NOT the dimmed
 *   "remembered hint" look, since this is an active, timed look rather than
 *   a standing memory aid. `RatATatCatBoard.tsx` owns the timer entirely;
 *   this component just renders whatever boolean it's handed.
 * - Otherwise: a plain face-down "?" back.
 */

const SIZE_DIMS: Record<"sm" | "md" | "lg", string> = {
  sm: "h-14 w-10 sm:h-16 sm:w-11",
  md: "h-20 w-14 sm:h-24 sm:w-16",
  lg: "h-24 w-16 sm:h-28 sm:w-20",
};
const SIZE_TEXT: Record<"sm" | "md" | "lg", string> = {
  sm: "text-base",
  md: "text-2xl sm:text-3xl",
  lg: "text-3xl sm:text-4xl",
};

/** Rulebook flavor only (§1): 0-5 "cats" (low/good), 6-9 "rats" (high/bad) — scoring itself only ever cares about the raw number. */
function numberEmoji(value: number): string {
  return value <= 5 ? "🐱" : "🐭";
}

const SPECIAL_META: Record<Exclude<Card["kind"], "number">, { emoji: string; label: string }> = {
  peek: { emoji: "🔎", label: "엿보기" },
  swap: { emoji: "🔄", label: "바꾸기" },
  drawTwo: { emoji: "2️⃣", label: "두 번 뽑기" },
};

function CardContent({ card, small }: { card: Card; small: boolean }) {
  if (card.kind === "number") {
    return (
      <>
        <span className={small ? "text-[10px] leading-none opacity-70" : "text-xs leading-none opacity-70"}>{numberEmoji(card.value)}</span>
        <span className="leading-none">{card.value}</span>
      </>
    );
  }
  const meta = SPECIAL_META[card.kind];
  return (
    <>
      <span className={small ? "text-[9px] leading-none opacity-80" : "text-[11px] leading-none opacity-80"}>{meta.label}</span>
      <span className="leading-none">{meta.emoji}</span>
    </>
  );
}

export default function CardSlot({
  handCard,
  revealed = false,
  knownToViewer = false,
  peeking = false,
  size = "md",
  selected = false,
  highlighted = false,
  faded = false,
  label,
  onClick,
}: {
  handCard: HandCard;
  /** Game-over full reveal — shows the true face regardless of `knownToViewer`/`peeking`. */
  revealed?: boolean;
  /** Own-hand-only dimmed permanent hint (see module doc) — a card the owner actively placed via replace. Ignored when `revealed`. */
  knownToViewer?: boolean;
  /** Own-hand-only temporary full-brightness reveal with a gold glow (see module doc) — a setup peek or the Peek power card, actively timed by the caller. Ignored when `revealed`. */
  peeking?: boolean;
  size?: "sm" | "md" | "lg";
  selected?: boolean;
  /** A softly pulsing ring — used for "this slot is a legal target right now" affordances (replace target, peek/swap target). */
  highlighted?: boolean;
  faded?: boolean;
  label?: string;
  onClick?: () => void;
}) {
  const showFace = revealed || knownToViewer || peeking;
  const isHint = showFace && knownToViewer && !revealed && !peeking;
  const className = `relative flex ${SIZE_DIMS[size]} flex-col items-center justify-center gap-0.5 rounded-xl border-2 font-bold shadow-sm transition ${
    showFace
      ? "border-amber-300/60 bg-gradient-to-b from-amber-50 to-amber-100 text-amber-950"
      : "border-white/15 bg-gradient-to-br from-slate-700 to-slate-900 text-white/30"
  } ${isHint ? "opacity-60" : ""} ${selected ? "-translate-y-2 ring-4 ring-emerald-300/80" : ""} ${
    highlighted ? "ring-4 ring-sky-300/70 animate-pulse" : ""
  } ${peeking ? "ratc-peek-glow" : ""} ${faded ? "opacity-30" : ""} ${onClick ? "cursor-pointer active:scale-95" : "cursor-default"}`;

  const content = showFace ? <CardContent card={handCard.card} small={size === "sm"} /> : <span className={SIZE_TEXT[size]}>❓</span>;

  // Remounting on this key (card identity changing via replace/swap, or
  // `showFace` flipping true/false via a peek starting or its timer/tap
  // ending it) restarts the `ratc-card-flip` keyframe defined in
  // globals.css — the work order's "카드 엿보기/교환 시 부드러운 3D 플립"
  // ask, with zero extra timer/ref bookkeeping in this component itself.
  const body = (
    <div key={`${handCard.card.id}-${showFace}`} className={`${className} ratc-card-flip`} aria-label={label}>
      {content}
    </div>
  );

  if (!onClick) return body;
  return (
    <button type="button" onClick={onClick} className="contents" aria-label={label}>
      {body}
    </button>
  );
}

export function CardBack({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  return (
    <div className={`flex ${SIZE_DIMS[size]} items-center justify-center rounded-xl border-2 border-white/15 bg-gradient-to-br from-slate-700 to-slate-900 text-white/20`} aria-hidden>
      🐾
    </div>
  );
}
