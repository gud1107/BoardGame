"use client";

import CardFace, { LANE_THEME } from "./CardFace";
import { EXPEDITION_THEME, type Card, type Color } from "./engine";

/**
 * One color's discard cell inside the shared center board — extracted from
 * `LostCitiesBoard.tsx`'s old inline `CenterPiles` per-color button so the
 * "버림 칸(Discard Pile) 영역 명확화" requirement (dashed/neon border,
 * distinct from an expedition lane, top-card + count) lives in one place.
 * The *outer* "🗑️ 버림 칸 / DISCARD" zone label + neon frame wrapping all 5
 * of these lives in `LostCitiesBoard.tsx`'s `CenterPiles` — this component
 * is just one color's cell inside that zone.
 */
export interface DiscardPileProps {
  color: Color;
  pile: Card[];
  clickable: boolean;
  /**
   * Which step this cell is a valid action target for, when `clickable` —
   * purely a visual distinction (2026-09-05 턴 인디케이터 세션) so the 1단계
   * (내려놓기/버리기) 에메랄드 "빔" and 2단계(보충하기) 하늘색 "픽업" pulses
   * never look the same, even though both render on this same button.
   */
  highlightKind?: "target" | "pickup";
  faded?: boolean;
  onClick?: () => void;
  pileRef?: (el: HTMLDivElement | null) => void;
}

export default function DiscardPile({ color, pile, clickable, highlightKind, faded, onClick, pileRef }: DiscardPileProps) {
  const theme = LANE_THEME[color];
  const top = pile[pile.length - 1];
  return (
    <div ref={pileRef} className="relative flex flex-col items-center gap-0.5">
      <button
        type="button"
        disabled={!clickable}
        onClick={clickable ? onClick : undefined}
        className={`relative flex h-12 w-9 items-center justify-center rounded-lg border-2 border-dashed bg-black/30 transition sm:h-14 sm:w-10 ${
          clickable
            ? highlightKind === "pickup"
              ? "lc-pickup-pulse border-sky-300 ring-2 ring-sky-300/70"
              : "lc-target-beam-pulse border-emerald-300 ring-2 ring-emerald-300/70"
            : theme.discardBorder
        }`}
      >
        {top ? (
          <CardFace card={top} size="sm" faded={faded} />
        ) : (
          <span className="text-[9px] text-white/20">{EXPEDITION_THEME[color].emoji}</span>
        )}
        {pile.length > 0 && (
          <span className="absolute -bottom-1.5 -right-1.5 rounded-full border border-white/30 bg-black/85 px-1 text-[8px] font-bold text-white/80">
            {pile.length}장
          </span>
        )}
      </button>
    </div>
  );
}
