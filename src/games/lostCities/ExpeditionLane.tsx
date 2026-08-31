"use client";

import CardFace, { LANE_THEME } from "./CardFace";
import { EXPEDITION_THEME, type Card, type Color } from "./engine";
import { useExpeditionScore } from "./useExpeditionScore";

/**
 * One color's expedition track — cards stack + the real-time score HUD
 * (task brief's `ExpeditionLane.tsx` / "실시간 탐험로 점수 연산 훅 및 HUD UI"),
 * extracted out of `LostCitiesBoard.tsx`'s old inline `LaneStack`/
 * `ExpeditionRow` so the per-color visual theme (`LANE_THEME`) and the score
 * arithmetic (`useExpeditionScore`) live in one place.
 *
 * HUD rules (confirmed via `AskUserQuestion`, this session):
 *  - 0 cards → "미시작" (unstarted), no -20 shown — matches the rulebook's
 *    "카드를 한 장도 놓지 않은 색상은 0점 처리" (§6.1).
 *  - ≥1 card → the -20 base cost is shown immediately, then the live total
 *    `(numberSum − 20) × multiplier` updates the instant a card lands.
 *  - The +20 "8장 이상" bonus badge appears the instant the 8th card lands,
 *    not only at game end.
 */
export interface ExpeditionLaneProps {
  color: Color;
  cards: Card[];
  highlight: boolean;
  dim?: boolean;
  onClick?: () => void;
  laneRef?: (el: HTMLDivElement | null) => void;
}

export default function ExpeditionLane({ color, cards, highlight, dim, onClick, laneRef }: ExpeditionLaneProps) {
  const theme = LANE_THEME[color];
  const breakdown = useExpeditionScore(color, cards);
  const started = cards.length > 0;

  return (
    <div
      ref={laneRef}
      className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg border bg-gradient-to-b p-0.5 transition ${theme.backdropFrom} ${theme.backdropTo} ${
        highlight ? "border-emerald-300 ring-2 ring-emerald-300/70" : theme.laneBorder
      } ${dim ? "opacity-60" : ""}`}
    >
      <div className="flex w-full items-center justify-between px-0.5">
        <span className="text-[9px] leading-none text-white/60 sm:text-[10px]" title={theme.label}>
          {EXPEDITION_THEME[color].emoji}
        </span>
        {breakdown.investCount > 0 && (
          <span className="lc-mult-badge-glow rounded-full border border-amber-200 bg-gradient-to-br from-amber-300 to-amber-500 px-1 text-[8px] font-extrabold leading-tight text-amber-950 sm:text-[9px]">
            ×{breakdown.multiplier}
          </span>
        )}
      </div>

      {/* Real-time score HUD */}
      <div className="flex min-h-[1.6rem] w-full flex-col items-center justify-center leading-none">
        {!started ? (
          <span className="text-[9px] text-white/25">미시작</span>
        ) : (
          <>
            <span
              key={breakdown.total}
              className={`lc-score-pulse text-[11px] font-extrabold sm:text-xs ${breakdown.total >= 0 ? "text-emerald-300" : "text-rose-400"}`}
            >
              {breakdown.total >= 0 ? `+${breakdown.total}` : breakdown.total}
            </span>
            <span className="text-[8px] text-rose-300/80 sm:text-[9px]">시작비용 -20</span>
            {breakdown.bonus > 0 && (
              <span className="lc-bonus-pop mt-0.5 rounded-full border border-amber-200 bg-gradient-to-r from-amber-300 to-yellow-400 px-1.5 py-px text-[8px] font-extrabold text-amber-950 sm:text-[9px]">
                +20 BONUS
              </span>
            )}
          </>
        )}
      </div>

      <button
        type="button"
        disabled={!onClick}
        onClick={onClick}
        className="flex min-h-[3.5rem] w-full flex-1 items-center gap-[-6px] overflow-x-auto rounded-md border border-dashed border-white/15 bg-black/20 p-1 sm:min-h-[4.5rem]"
      >
        {cards.length === 0 ? (
          <span className="mx-auto text-[10px] text-white/25">비어있음</span>
        ) : (
          <span className="flex -space-x-3">
            {cards.map((c) => (
              <CardFace key={c.id} card={c} size="sm" multiplierBadge={c.kind === "investment" ? breakdown.multiplier : undefined} />
            ))}
          </span>
        )}
      </button>
    </div>
  );
}
