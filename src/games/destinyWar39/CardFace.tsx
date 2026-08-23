"use client";

import { isReverseCard, type Card, type PlayerCount } from "./engine";

/**
 * Shared card-face rendering for 운명전쟁39 — used by every place a card is
 * drawn (hand, played-card slot, trick-reveal freeze-frame, last-round
 * history). Centralizing this (previously duplicated `cardLabel`/
 * `cardBadgeClasses` pairs in DestinyWar39Board.tsx and
 * LastRoundHistoryModal.tsx) is what makes the reverse-card treatment below
 * consistent everywhere instead of needing to be hand-copied per call site.
 *
 * Reverse cards (11/22/33/44/55) get several simultaneous visual cues so
 * their rule-flipping nature — AND the number itself — reads at a glance
 * even at small on-screen scale, not just on close inspection:
 *  - a "🔄 리버스" banner strip across the top of the card (unchanged
 *    footprint from the original design)
 *  - a large translucent 🔁 U-turn watermark behind the number, dimmed
 *    further than before so it never competes with the number on top of it
 *  - a fuchsia glow ring + border distinct from every other card color
 *  - (2026-08-23 readability fix, this session's confirmed answer) a solid
 *    dark chip directly behind the big center number, plus a thin dark
 *    text-stroke on the number itself, so the digits stay legible no matter
 *    how busy the fuchsia background/watermark/glow gets underneath
 *  - (same session) a small top-left/bottom-right corner index repeating the
 *    number, positioned within the number sub-area (below the banner strip)
 *    so it never collides with either the banner text or the center number —
 *    a second, always-uncluttered place to read the value at a glance
 *
 * Sizes were bumped ~1.6–1.8x across the board in the same session (hand
 * cards ~68×96 "md", field/played-slot ~60×84 "sm", freeze-frame reveal
 * ~82×118 "lg") to fix on-screen digits being too small to read on phone-size
 * viewports (this project has no separate mobile/desktop skin, so the bump
 * applies everywhere — verified it still reads well on desktop too).
 */

export type CardFaceSize = "sm" | "md" | "lg";

const SIZE_MAP: Record<
  CardFaceSize,
  { box: string; reverseBox: string; num: string; banner: string; watermark: string; chipPad: string; cornerIndex: string }
> = {
  // Field/played-slot + history-modal scale.
  sm: { box: "h-[84px] w-[60px]", reverseBox: "h-[94px] w-[60px]", num: "text-2xl", banner: "text-[7px] py-0.5", watermark: "text-4xl", chipPad: "px-2 py-1", cornerIndex: "text-[9px]" },
  // Hand-card scale (predicting-phase display + playing-phase interactive pick).
  md: { box: "h-24 w-[68px]", reverseBox: "h-[108px] w-[68px]", num: "text-3xl", banner: "text-[8px] py-0.5", watermark: "text-5xl", chipPad: "px-2.5 py-1", cornerIndex: "text-[10px]" },
  // Trick-resolution freeze-frame reveal — biggest emphasis.
  lg: { box: "h-[118px] w-[82px]", reverseBox: "h-[132px] w-[82px]", num: "text-4xl", banner: "text-[9px] py-1", watermark: "text-6xl", chipPad: "px-3 py-1.5", cornerIndex: "text-[11px]" },
};

export function cardLabel(card: Card): string {
  return card.kind === "death" ? "💀" : String(card.value);
}

/** Border/background/text classes for a card badge. Reverse cards intentionally do NOT reuse this alone — see `CardFace` for the full banner+watermark+contrast-chip treatment. */
export function cardBadgeClasses(card: Card, playerCount: PlayerCount): string {
  if (card.kind === "death") return "border-rose-400/60 bg-rose-950/60 text-rose-200";
  if (card.value === 0) return "border-amber-400/60 bg-amber-950/50 text-amber-200";
  if (isReverseCard(card, playerCount)) return "border-fuchsia-400 bg-fuchsia-950/70 text-fuchsia-100";
  return "border-white/20 bg-white/5 text-white/90";
}

export interface CardFaceProps {
  card: Card;
  /** Which deck mode `card` was dealt from — needed to tell whether it's a reverse card (11/22/33 for 5-player, plus 44/55 for 8-player). */
  playerCount: PlayerCount;
  size?: CardFaceSize;
  /** Renders a <button> (clickable hand card) instead of a <span> (display-only). */
  interactive?: boolean;
  onClick?: () => void;
  /** Extra classes appended last — used by callers for winner rings/scale/hover, kept out of this component so each call site controls its own emphasis styling. */
  className?: string;
}

export function CardFace({ card, playerCount, size = "md", interactive = false, onClick, className = "" }: CardFaceProps) {
  const reverse = isReverseCard(card, playerCount);
  const { box, reverseBox, num, banner, watermark, chipPad, cornerIndex } = SIZE_MAP[size];
  const Tag = interactive ? "button" : "span";
  const label = cardLabel(card);

  // Thin dark outline on top of the dark chip (belt-and-suspenders per this
  // session's confirmed answer: dark-chip overlay AND a text stroke) so the
  // number stays crisp even at the smallest "sm" scale where anti-aliasing
  // alone can blur digit edges against the busy fuchsia background.
  const numberOutline = "[-webkit-text-stroke:1px_rgba(0,0,0,0.9)] drop-shadow-[0_1px_1px_rgba(0,0,0,0.85)]";

  return (
    <Tag
      onClick={onClick}
      aria-label={reverse ? `리버스 카드 ${card.value}` : undefined}
      className={`relative overflow-hidden rounded-lg border font-extrabold transition ${reverse ? reverseBox : box} ${num} ${cardBadgeClasses(card, playerCount)} ${
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
        {reverse && <span aria-hidden className={`pointer-events-none absolute select-none text-fuchsia-300/15 ${watermark}`}>🔁</span>}
        {reverse ? (
          // Dark chip directly behind the number (this session's confirmed
          // contrast fix) — solid near-black backdrop so the digits read
          // clearly no matter what's happening in the fuchsia background
          // behind it.
          <span className={`relative z-10 inline-flex items-center justify-center rounded-md bg-black/75 leading-none text-white ${chipPad} ${numberOutline}`}>
            {label}
          </span>
        ) : (
          <span className="relative z-10">{label}</span>
        )}
        {reverse && (
          <>
            <span aria-hidden className={`pointer-events-none absolute top-1 left-1 leading-none font-extrabold text-white ${cornerIndex} ${numberOutline}`}>
              {label}
            </span>
            <span aria-hidden className={`pointer-events-none absolute right-1 bottom-1 leading-none font-extrabold text-white ${cornerIndex} ${numberOutline}`}>
              {label}
            </span>
          </>
        )}
      </span>
    </Tag>
  );
}

export default CardFace;
