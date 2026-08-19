"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { formatHandLabel, LINES, type Card, type HandResult } from "./engine";

/**
 * Grid Poker's line-completion flourish — the moment one of the viewer's own
 * 12 lines (see engine.ts's `LINES`) becomes fully filled during the
 * "placing" phase, a gold sweep runs across its 5 cells (see
 * GridPokerBoard.tsx's `Cell`, which owns the sweep rendering itself using
 * `detectNewlyCompletedLines` below) and the poker hand that was just formed
 * floats up as a toast (`HandRankFloatingBadge`).
 *
 * Viewer's own board only — this is never run against an opponent's board.
 * Every client holds every player's full state (see engine.ts's module doc
 * on the trust trade-off), but `visibleOpponentBoard` deliberately hides an
 * opponent's un-revealed cells; showing this flourish off their hidden board
 * would leak exactly what that's meant to hide.
 *
 * The card-placement "slam" pop + border pulse (see GridPokerBoard.tsx's
 * `Cell`) needs no detection at all — a cell only ever transitions null ->
 * Card once, so a plain `key={card.id}` remount is enough to replay the
 * mount-only globals.css keyframes (gp-card-place / gp-cell-pulse), same
 * technique DealerReveal.tsx already uses for its own deal-flip.
 *
 * No "점수 획득" (score) is shown in the badge below: this fires purely from
 * the board filling up structurally, before any of the later blind
 * line-submission scoring in "submitting" phase (see engine.ts's
 * `resolveRound`) — there is no score to report yet at this point, only the
 * hand that was just formed.
 */
export interface LineCompleteEvent {
  id: number;
  lineIndex: number;
  hand: HandResult;
}

/**
 * Diffs two consecutive board snapshots for the viewer's own seat, returning
 * every line that just became fully filled (not full in `prevBoard`, full in
 * `nextBoard`). A single placement can complete more than one line at once —
 * a corner cell sits in 2 lines, the center cell in 4 (row + column + both
 * diagonals, see engine.ts's `LINES_BY_CELL`).
 */
export function detectNewlyCompletedLines(prevBoard: (Card | null)[], nextBoard: (Card | null)[]): number[] {
  const out: number[] = [];
  for (let li = 0; li < LINES.length; li++) {
    const cells = LINES[li];
    const wasFull = cells.every((c) => prevBoard[c] !== null);
    const isFull = cells.every((c) => nextBoard[c] !== null);
    if (!wasFull && isFull) out.push(li);
  }
  return out;
}

const LINE_COMPLETE_MS = 1500;

/** category >= 5 (플러시 and above — see engine.ts's CATEGORY_NAMES) gets the gold sparkle treatment on top of the plain badge; every lower category still gets the badge itself. */
const HIGH_TIER_CATEGORY = 5;

/** Small deterministic scatter around the badge — a fixed layout reads just as "sparkly" as randomizing per-event and avoids the badge's size jittering between events. */
const SPARKLE_OFFSETS = [
  { x: -34, y: -8, delayMs: 0 },
  { x: 30, y: -14, delayMs: 60 },
  { x: -20, y: 14, delayMs: 120 },
  { x: 24, y: 16, delayMs: 40 },
  { x: 2, y: -22, delayMs: 90 },
  { x: -6, y: 20, delayMs: 150 },
];

/**
 * Floating "줄 완성!" toast naming the poker hand just formed. Portals to
 * `document.body` like every other banner-style flourish in this project
 * (see e.g. forSale/ForSaleEffects.tsx's `AuctionWinToast`), so it reads
 * clearly regardless of how small the 5x5 board itself is on a phone screen,
 * and isn't clipped by GridPokerBoard.tsx's `TABLE_PANEL` (which has its own
 * `overflow-hidden`). `stackIndex` offsets simultaneous multi-line
 * completions (same placement, e.g. a corner or center cell) so they don't
 * fully overlap.
 */
export function HandRankFloatingBadge({
  event,
  stackIndex,
  onDone,
}: {
  event: LineCompleteEvent;
  stackIndex: number;
  onDone: (id: number) => void;
}) {
  useEffect(() => {
    const t = setTimeout(() => onDone(event.id), LINE_COMPLETE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only, same pattern as ForSaleEffects' AuctionWinToast
  }, []);

  if (typeof document === "undefined") return null;

  const highTier = event.hand.category >= HIGH_TIER_CATEGORY;

  return createPortal(
    <div
      className="pointer-events-none fixed left-1/2 z-[75] -translate-x-1/2"
      style={{ top: `calc(18% + ${stackIndex * 56}px)`, animation: "gp-hand-badge-float 1.5s ease-out forwards" }}
    >
      <div className="relative">
        {highTier &&
          SPARKLE_OFFSETS.map((s, i) => (
            <span
              key={i}
              aria-hidden
              className="absolute text-amber-300"
              style={{
                left: `calc(50% + ${s.x}px)`,
                top: `calc(50% + ${s.y}px)`,
                animation: `gp-sparkle-twinkle 0.9s ease-out ${s.delayMs}ms forwards`,
              }}
            >
              ✨
            </span>
          ))}
        <div
          className={`flex flex-col items-center gap-0.5 rounded-2xl border px-5 py-2.5 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.7)] ${
            highTier
              ? "border-amber-300/70 bg-gradient-to-r from-amber-950/95 via-amber-900/90 to-amber-950/95"
              : "border-emerald-400/50 bg-gradient-to-r from-emerald-950/95 to-black/90"
          }`}
        >
          <span className={`text-[10px] font-semibold tracking-wide uppercase ${highTier ? "text-amber-200/80" : "text-emerald-200/70"}`}>
            줄 완성!
          </span>
          <span className={`text-sm font-bold whitespace-nowrap ${highTier ? "text-amber-100" : "text-emerald-100"}`}>
            {formatHandLabel(event.hand)}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
