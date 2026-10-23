"use client";

import { DuelToken } from "./DuelToken";
import { GRID_SIZE, SPIRAL_ORDER, type BoardToken } from "./engine";

/**
 * The 5×5 gem board. Purely presentational — the parent decides what a tap
 * means (toggle a line selection, spend a scroll, or resolve a
 * "take matching token" ability) and which cells are currently tappable.
 * The faint numbers are the spiral refill order (rulebook §1-3), shown so
 * players can see where the next refill will land.
 *
 * Drawn 2.5D (a gently tilted plate with a wooden edge, recessed sockets and
 * gems that sit up and lift when picked) — full 3D read worse (2026-10-23).
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
    // 2.5D: the plate leans back a little (md+ only — the mobile board is
    // already tiny) and shows a wooden edge; gems stay flat-on and readable.
    <div className="pb-3" style={{ containerType: "inline-size" }}>
      <style>{TILT_CSS}</style>
      <div
        className="sdgrid-plate relative grid aspect-square w-full gap-[3%] rounded-2xl border border-amber-400/30 p-[3.5%] light:border-amber-600/35"
        style={{
          gridTemplateColumns: `repeat(${GRID_SIZE}, minmax(0, 1fr))`,
          background: "radial-gradient(circle at 50% 35%, #2a2118 0%, #12100c 65%, #070505 100%)",
          boxShadow:
            "inset 0 0 30px rgba(0,0,0,.7), inset 0 1px 0 rgba(253,230,138,.18), 0 2px 0 #6b4a22, 0 5px 0 #4a3216, 0 9px 0 #2e1f0e, 0 9px 0 1px rgba(251,191,36,.18), 0 22px 26px -6px rgba(0,0,0,.75)",
        }}
      >
        {grid.map((token, cell) => {
          const isSel = selected.includes(cell);
          // Gold is never tappable in normal play (it can only be taken by reserving) unless the parent lists it explicitly.
          const canTap = onCellClick && token !== null && (selectable === null ? token !== "gold" : selectable.has(cell));
          const glow = highlight?.has(cell);
          return (
            <button
              key={cell}
              data-cell={cell}
              type="button"
              disabled={!canTap}
              onClick={() => onCellClick?.(cell)}
              aria-label={token ? `칸 ${cell + 1}` : `빈칸 ${cell + 1}`}
              aria-pressed={isSel}
              className={`group relative flex aspect-square items-center justify-center rounded-full transition duration-150 ${
                isSel ? "ring-2 ring-amber-300 shadow-[0_0_14px_rgba(252,211,77,0.75)]" : glow ? "ring-2 ring-fuchsia-300/80 animate-pulse" : "ring-1 ring-white/5"
              } ${canTap ? "cursor-pointer" : "cursor-default"} ${selectable && token && !selectable.has(cell) ? "opacity-40" : ""}`}
              style={{ background: "radial-gradient(circle at 50% 60%, rgba(255,255,255,0.05) 0%, rgba(0,0,0,0.55) 100%)" }}
            >
              {/* recessed socket — its own layer so the button's selection ring (also a box-shadow) survives */}
              <span className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_3px_6px_rgba(0,0,0,.85),inset_0_-1px_0_rgba(255,255,255,.07)]" />
              <span className="pointer-events-none absolute text-[8px] font-mono text-white/15">{orderOf.get(cell)}</span>
              {token && (
                <>
                  {/* contact shadow — spreads and fades as the gem lifts */}
                  <span
                    className={`pointer-events-none absolute bottom-[8%] h-[18%] w-[62%] rounded-[50%] bg-black/70 blur-[2px] transition duration-150 ${
                      isSel ? "scale-110 opacity-45" : canTap ? "group-hover:scale-105 group-hover:opacity-60" : ""
                    }`}
                  />
                  <span
                    className={`relative flex h-[82%] w-[82%] transition duration-150 ${
                      isSel ? "-translate-y-[16%] scale-110" : canTap ? "-translate-y-[5%] group-hover:-translate-y-[10%]" : "-translate-y-[5%]"
                    }`}
                  >
                    <DuelToken color={token} className="h-full w-full" />
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const TILT_CSS = `
@media (min-width: 768px) {
  .sdgrid-plate { transform: perspective(260cqw) rotateX(13deg); transform-origin: 50% 100%; }
}
`;
