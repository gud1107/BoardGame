"use client";

import { DuelToken } from "./DuelToken";
import { GRID_SIZE, SPIRAL_ORDER, type BoardToken } from "./engine";

/**
 * The 5×5 gem board. Purely presentational — the parent decides what a tap
 * means (toggle a line selection, spend a scroll, or resolve a
 * "take matching token" ability) and which cells are currently tappable.
 * The faint numbers are the spiral refill order (rulebook §1-3), shown so
 * players can see where the next refill will land.
 */
export default function SpiralGridBoard({
  grid,
  selected,
  selectable,
  highlight,
  onCellClick,
}: {
  grid: (BoardToken | null)[];
  selected: number[];
  /** Cells that currently respond to a tap — null means "every token cell". */
  selectable: Set<number> | null;
  /** Extra glow ring on these cells (e.g. matching-token targets). */
  highlight?: Set<number>;
  onCellClick?: (cell: number) => void;
}) {
  const orderOf = new Map(SPIRAL_ORDER.map((cell, i) => [cell, i + 1]));
  return (
    <div
      className="relative grid aspect-square w-full gap-[3%] rounded-2xl border border-amber-400/25 p-[3.5%] shadow-[inset_0_0_30px_rgba(0,0,0,0.7)] light:border-amber-600/30"
      style={{
        gridTemplateColumns: `repeat(${GRID_SIZE}, minmax(0, 1fr))`,
        background: "radial-gradient(circle at 50% 45%, #1c1917 0%, #0c0a09 70%, #050404 100%)",
      }}
    >
      {grid.map((token, cell) => {
        const isSel = selected.includes(cell);
        const canTap = onCellClick && token !== null && (selectable === null || selectable.has(cell));
        const glow = highlight?.has(cell);
        return (
          <button
            key={cell}
            type="button"
            disabled={!canTap}
            onClick={() => onCellClick?.(cell)}
            aria-label={token ? `칸 ${cell + 1}` : `빈칸 ${cell + 1}`}
            aria-pressed={isSel}
            className={`relative flex aspect-square items-center justify-center rounded-full transition duration-150 ${
              isSel
                ? "scale-110 ring-2 ring-amber-300 shadow-[0_0_14px_rgba(252,211,77,0.75)]"
                : glow
                  ? "ring-2 ring-fuchsia-300/80 animate-pulse"
                  : "ring-1 ring-white/5"
            } ${canTap ? "cursor-pointer hover:scale-105" : "cursor-default"} ${selectable && token && !selectable.has(cell) ? "opacity-40" : ""}`}
            style={{ background: "radial-gradient(circle, rgba(255,255,255,0.05) 0%, rgba(0,0,0,0.5) 100%)" }}
          >
            <span className="pointer-events-none absolute text-[8px] font-mono text-white/15">{orderOf.get(cell)}</span>
            {token && <DuelToken color={token} className="relative h-[82%] w-[82%]" />}
          </button>
        );
      })}
    </div>
  );
}
