"use client";

import { isReverseCard, type Card } from "./engine";

/**
 * Shared card-face rendering for 운명전쟁39 — used by every place a card is
 * drawn (hand, played-card slot, trick-reveal freeze-frame, last-round
 * history). Centralizing this (previously duplicated `cardLabel`/
 * `cardBadgeClasses` pairs in DestinyWar39Board.tsx and
 * LastRoundHistoryModal.tsx) is what makes the reverse-card treatment below
 * consistent everywhere instead of needing to be hand-copied per call site.
 *
 * Reverse cards (11/22/33) get three simultaneous visual cues so their
 * rule-flipping nature reads at a glance even at hand-card scale, not just
 * on close inspection of the number:
 *  - a "🔄 리버스" banner strip across the top of the card
 *  - a large translucent 🔁 U-turn watermark behind the number
 *  - a fuchsia glow ring + border distinct from every other card color
 */

export type CardFaceSize = "sm" | "md" | "lg";

const SIZE_MAP: Record<CardFaceSize, { box: string; reverseBox: string; num: string; banner: string; watermark: string }> = {
  sm: { box: "h-12 w-9", reverseBox: "h-14 w-9", num: "text-sm", banner: "text-[5px] py-[1px]", watermark: "text-xl" },
  md: { box: "h-14 w-10", reverseBox: "h-16 w-10", num: "text-base", banner: "text-[5.5px] py-[1px]", watermark: "text-2xl" },
  lg: { box: "h-16 w-11", reverseBox: "h-[4.5rem] w-11", num: "text-lg", banner: "text-[6.5px] py-px", watermark: "text-2xl" },
};

export function cardLabel(card: Card): string {
  return card.kind === "death" ? "💀" : String(card.value);
}

/** Border/background/text classes for a card badge. Reverse cards intentionally do NOT reuse this alone — see `CardFace` for the full banner+watermark treatment. */
export function cardBadgeClasses(card: Card): string {
  if (card.kind === "death") return "border-rose-400/60 bg-rose-950/60 text-rose-200";
  if (card.value === 0) return "border-amber-400/60 bg-amber-950/50 text-amber-200";
  if (isReverseCard(card)) return "border-fuchsia-400 bg-fuchsia-950/70 text-fuchsia-100";
  return "border-white/20 bg-white/5 text-white/90";
}

export interface CardFaceProps {
  card: Card;
  size?: CardFaceSize;
  /** Renders a <button> (clickable hand card) instead of a <span> (display-only). */
  interactive?: boolean;
  onClick?: () => void;
  /** Extra classes appended last — used by callers for winner rings/scale/hover, kept out of this component so each call site controls its own emphasis styling. */
  className?: string;
}

export function CardFace({ card, size = "md", interactive = false, onClick, className = "" }: CardFaceProps) {
  const reverse = isReverseCard(card);
  const { box, reverseBox, num, banner, watermark } = SIZE_MAP[size];
  const Tag = interactive ? "button" : "span";

  return (
    <Tag
      onClick={onClick}
      aria-label={reverse ? `리버스 카드 ${card.value}` : undefined}
      className={`relative overflow-hidden rounded-lg border font-bold transition ${reverse ? reverseBox : box} ${num} ${cardBadgeClasses(card)} ${
        // `outline` + `drop-shadow` (filter), deliberately NOT `ring`/`shadow` (box-shadow) — callers append their
        // own `ring-*`/`shadow-*` for winner emphasis via `className`, and box-shadow-based utilities would silently
        // clobber each other depending on Tailwind's generated CSS order. Different CSS properties compose safely.
        reverse ? "outline outline-2 outline-fuchsia-400/80 outline-offset-1 drop-shadow-[0_0_8px_rgba(232,121,249,0.65)]" : ""
      } ${reverse ? "flex flex-col" : "grid place-items-center"} ${className}`}
    >
      {reverse && (
        <span className={`flex items-center justify-center gap-px bg-fuchsia-500 font-extrabold tracking-tight whitespace-nowrap text-white ${banner}`}>
          🔄 리버스
        </span>
      )}
      <span className="relative grid flex-1 place-items-center">
        {reverse && <span className={`pointer-events-none absolute select-none text-fuchsia-300/25 ${watermark}`}>🔁</span>}
        <span className="relative z-10">{cardLabel(card)}</span>
      </span>
    </Tag>
  );
}

export default CardFace;
