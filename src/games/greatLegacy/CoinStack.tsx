"use client";

import { useMemo } from "react";
import { DENOMINATIONS, purseCoinCount, purseValue } from "./constants";
import type { Denomination, Purse } from "./types";

/**
 * Visual coin-pile for one seat's currently-committed bid (`auction.committed[seat]`).
 * Denomination composition is legitimately public info here (rulebook §G-1 —
 * once submitted, a bid's coin composition can't change, and nothing in the
 * rules treats a live bid as hidden the way a resting purse can be via
 * `coinVisibility`), so this always renders the full breakdown regardless of
 * that setting.
 *
 * Deliberately NOT a mechanically-perfect vertical tower — each coin gets a
 * small deterministic left/right jitter + tilt (index-derived, so it doesn't
 * reshuffle every re-render) so a pile of real 20/10/5/1 coins reads like
 * something actually dropped on a felt table, not a bar chart. New columns
 * start every 5 coins so a big bid fans out sideways instead of shooting
 * straight up past the panel.
 */

const DENOM_FACE: Record<Denomination, string> = {
  20: "from-amber-400 via-amber-100 to-yellow-50",
  10: "from-amber-500 via-amber-200 to-yellow-100",
  5: "from-orange-500 via-amber-300 to-amber-100",
  1: "from-stone-400 via-stone-100 to-white",
};
const DENOM_EDGE: Record<Denomination, string> = {
  20: "from-amber-600 via-amber-800 to-neutral-950",
  10: "from-amber-700 via-amber-900 to-neutral-950",
  5: "from-orange-700 via-orange-900 to-neutral-950",
  1: "from-stone-500 via-stone-700 to-neutral-900",
};
const DENOM_WIDTH: Record<Denomination, number> = { 20: 40, 10: 36, 5: 33, 1: 27 };
const DENOM_THICKNESS: Record<Denomination, number> = { 20: 4.6, 10: 4.1, 5: 3.7, 1: 3.1 };

const MAX_RENDER = 15;
const COLUMN_CHUNK = 5;

function flattenCoins(purse: Purse): Denomination[] {
  const coins: Denomination[] = [];
  for (const denom of DENOMINATIONS) {
    for (let i = 0; i < purse[denom]; i++) coins.push(denom);
  }
  return coins; // DENOMINATIONS is already largest-first — biggest coins settle at the base of each pile
}

/** Deterministic "hand-dropped" jitter from a coin's flattened index — stable across re-renders, no layout thrash. */
function jitterFor(globalIndex: number) {
  return {
    offsetX: ((globalIndex * 17) % 7) - 3, // -3..3px
    rotation: ((globalIndex * 23) % 9) - 4, // -4..4deg
  };
}

interface PlacedCoin {
  denom: Denomination;
  offsetX: number;
  offsetY: number;
  rotation: number;
}

function buildColumns(coins: Denomination[]): { placed: PlacedCoin[]; height: number }[] {
  const chunks: Denomination[][] = [];
  for (let i = 0; i < coins.length; i += COLUMN_CHUNK) chunks.push(coins.slice(i, i + COLUMN_CHUNK));

  return chunks.map((chunk, chunkIdx) => {
    let cursor = 0;
    const placed: PlacedCoin[] = chunk.map((denom, idxInChunk) => {
      const globalIndex = chunkIdx * COLUMN_CHUNK + idxInChunk;
      const { offsetX, rotation } = jitterFor(globalIndex);
      const offsetY = cursor;
      cursor += DENOM_THICKNESS[denom];
      return { denom, offsetX, offsetY, rotation };
    });
    return { placed, height: cursor };
  });
}

export default function CoinStack({ purse }: { purse: Purse }) {
  const totalCount = purseCoinCount(purse);
  const totalValue = purseValue(purse);

  const columns = useMemo(() => buildColumns(flattenCoins(purse).slice(0, MAX_RENDER)), [purse]);
  if (totalCount <= 0) return null;

  const tallestColumn = Math.max(...columns.map((c) => c.height), 0);
  const breakdown = DENOMINATIONS.filter((d) => purse[d] > 0)
    .map((d) => `${d}×${purse[d]}`)
    .join(" ");

  return (
    <div className="relative flex flex-col items-center gap-1 select-none">
      <div
        className="absolute z-30 flex items-center gap-1 whitespace-nowrap rounded-full border border-amber-300/80 bg-neutral-950/90 px-2 py-0.5 text-[10px] font-black text-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.4)] animate-great-legacy-badge-pop light:border-amber-400 light:bg-white light:text-amber-700 light:shadow-sm"
        style={{ bottom: `${tallestColumn + 12}px`, left: "50%", transform: "translateX(-50%)" }}
      >
        <span>🟡</span>
        <span>{totalValue}코인</span>
      </div>

      <div className="flex items-end gap-2 pt-5">
        {columns.map((col, ci) => (
          <div key={ci} className="relative flex items-end justify-center" style={{ width: 46, height: col.height + 10 }}>
            <div className="absolute bottom-0 h-3 w-9 scale-110 rounded-full bg-black/60 blur-[3px]" />
            {col.placed.map((coin, idx) => {
              const width = DENOM_WIDTH[coin.denom];
              const thickness = DENOM_THICKNESS[coin.denom];
              return (
                <div
                  key={idx}
                  className="absolute left-1/2"
                  style={{
                    bottom: `${coin.offsetY}px`,
                    width: `${width}px`,
                    height: `${thickness * 2.1}px`,
                    transform: `translateX(calc(-50% + ${coin.offsetX}px)) rotate(${coin.rotation}deg)`,
                    zIndex: idx + 1,
                  }}
                >
                  {/* 옆면(두께) — 위에서 내려다보는 입체감을 주는 어두운 베이스 */}
                  <div className={`absolute inset-0 rounded-full bg-gradient-to-b ${DENOM_EDGE[coin.denom]} shadow-[0_2px_3px_rgba(0,0,0,0.6)]`} />
                  {/* 윗면 — 엠보싱 림 + 각인 문양 */}
                  <div
                    className={`absolute inset-x-0 top-0 rounded-full border border-black/20 bg-gradient-to-tr ${DENOM_FACE[coin.denom]} shadow-[inset_0_1px_1px_rgba(255,255,255,0.7)]`}
                    style={{ height: `${thickness * 1.5}px` }}
                  >
                    <div className="absolute left-1/2 top-1/2 h-[55%] w-[55%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/10 bg-black/5" />
                    {/* 사선 하이라이트 글레어 */}
                    <div className="absolute left-1.5 top-0.5 h-[35%] w-[28%] -rotate-12 rounded-full bg-white/50 blur-[0.5px]" />
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <span className="text-[9px] font-mono text-white/40 light:text-slate-500">{breakdown}</span>
    </div>
  );
}
