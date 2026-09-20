"use client";

import { DENOMINATIONS, purseCoinCount, purseValue } from "./constants";
import type { Denomination, Purse } from "./types";

/**
 * Visual coin-tower for one seat's currently-committed bid (`auction.committed[seat]`).
 * Denomination composition is legitimately public info here (rulebook §G-1 —
 * once submitted, a bid's coin composition can't change, and nothing in the
 * rules treats a live bid as hidden the way a resting purse can be via
 * `coinVisibility`), so this always renders the full breakdown regardless of
 * that setting.
 */

const DENOM_GRADIENT: Record<Denomination, string> = {
  20: "from-amber-200 via-yellow-100 to-amber-500 border-amber-200/90",
  10: "from-amber-300 via-yellow-200 to-amber-600 border-amber-300/80",
  5: "from-orange-300 via-amber-200 to-orange-600 border-orange-300/80",
  1: "from-stone-200 via-white to-stone-400 border-stone-300/80",
};
const DENOM_SIZE: Record<Denomination, string> = {
  20: "h-4 w-11",
  10: "h-3.5 w-10",
  5: "h-3 w-9",
  1: "h-2.5 w-7",
};

const MAX_RENDER = 15;

function flattenCoins(purse: Purse): Denomination[] {
  const coins: Denomination[] = [];
  for (const denom of DENOMINATIONS) {
    for (let i = 0; i < purse[denom]; i++) coins.push(denom);
  }
  return coins; // DENOMINATIONS is already largest-first — biggest coins sit at the base of the stack
}

export default function CoinStack({ purse }: { purse: Purse }) {
  const totalCount = purseCoinCount(purse);
  if (totalCount <= 0) return null;
  const totalValue = purseValue(purse);

  const coins = flattenCoins(purse).slice(0, MAX_RENDER);
  const columnCount = totalCount <= 5 ? 1 : totalCount <= 10 ? 2 : 3;
  const columns: Denomination[][] = Array.from({ length: columnCount }, () => []);
  coins.forEach((denom, i) => columns[i % columnCount].push(denom));

  const breakdown = DENOMINATIONS.filter((d) => purse[d] > 0)
    .map((d) => `${d}×${purse[d]}`)
    .join(" ");

  return (
    <div className="relative flex flex-col items-center gap-1 select-none">
      <div className="animate-great-legacy-badge-pop rounded-full border border-amber-300/80 bg-neutral-950/90 px-2 py-0.5 text-[10px] font-black text-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.4)] light:border-amber-400 light:bg-white light:text-amber-700 light:shadow-sm">
        🟡 {totalValue}코인
      </div>
      <div className="flex items-end gap-1.5">
        {columns.map((col, ci) => (
          <div key={ci} className="flex flex-col-reverse items-center">
            {col.map((denom, idx) => (
              <div
                key={idx}
                className={`rounded-full border ${DENOM_SIZE[denom]} ${DENOM_GRADIENT[denom]} bg-gradient-to-b shadow-[0_2px_3px_rgba(0,0,0,0.5)] ${idx > 0 ? "-mt-1.5" : ""}`}
              />
            ))}
          </div>
        ))}
      </div>
      <span className="text-[9px] font-mono text-white/40 light:text-slate-500">{breakdown}</span>
    </div>
  );
}
