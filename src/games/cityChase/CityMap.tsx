"use client";

import { useEffect, useState } from "react";
import {
  cellContents,
  cellRC,
  CELL_COUNT,
  GRID,
  POINT_GRID,
  pointCells,
  pointIJ,
  type Cell,
  type CityChaseState,
  type Point,
  type SearchRecord,
  type TokenColor,
} from "./engine";

/** Column letter + row number, e.g. "C4" — used in every log line and badge. */
export function cellLabel(cell: Cell): string {
  const [r, c] = cellRC(cell);
  return `${String.fromCharCode(65 + c)}${r + 1}`;
}

export const HELI_STYLES = [
  { ring: "ring-sky-400", border: "border-sky-400", bg: "bg-sky-500", text: "text-sky-300", hex: "#38bdf8" },
  { ring: "ring-amber-400", border: "border-amber-400", bg: "bg-amber-500", text: "text-amber-300", hex: "#fbbf24" },
  { ring: "ring-fuchsia-400", border: "border-fuchsia-400", bg: "bg-fuchsia-500", text: "text-fuchsia-300", hex: "#e879f9" },
] as const;

export const TOKEN_CLASS: Record<TokenColor, string> = {
  yellow: "bg-yellow-300 border-yellow-100",
  blue: "bg-blue-500 border-blue-200",
  red: "bg-red-500 border-red-200",
};

const STEP = 100 / GRID; // % distance between two road lines
const INSET = 2.6; // % gap between a building and the road centre line

// Deterministic per-building look (height tier + facade hue) so the skyline isn't a flat grid.
const FACADES = ["#334155", "#3f3f5a", "#2f4858", "#44403c", "#3b3561", "#1f3b4d"];
function buildingLook(cell: Cell) {
  const h = (cell * 7 + 3) % 5;
  return { lift: 4 + h * 2, facade: FACADES[(cell * 5 + 1) % FACADES.length], windows: 2 + (cell % 3) };
}

export interface HeliControls {
  heli: number;
  moveTargets: readonly Point[];
  searchTargets: readonly Cell[];
}

export interface CityMapProps {
  state: CityChaseState;
  /** Thief's private view (car, trail tokens) — also used for the post-game reveal. */
  showSecret: boolean;
  thiefTargets?: ReadonlySet<Cell>;
  heliControls?: HeliControls | null;
  onCellClick?: (cell: Cell) => void;
  onPointClick?: (p: Point) => void;
  /** Police deduction heat (0..1 per building), when the viewer turned on the 수사 지도. */
  heat?: Float64Array | null;
  latestSearch: Map<Cell, SearchRecord>;
}

type Reveal = { cell: Cell; result: SearchRecord["result"]; tokens: TokenColor[]; key: number };

export default function CityMap({ state, showSecret, thiefTargets, heliControls, onCellClick, onPointClick, heat, latestSearch }: CityMapProps) {
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [lastSeq, setLastSeq] = useState(state.seq);

  // Lift the searched building for a moment — keyed off `seq` so a replayed
  // state-sync of the same action doesn't re-trigger it.
  if (lastSeq !== state.seq) {
    setLastSeq(state.seq);
    const ev = state.lastEvent;
    if (ev?.kind === "search") setReveal({ cell: ev.cell, result: ev.result, tokens: ev.tokens, key: state.seq });
  }
  useEffect(() => {
    if (!reveal || reveal.result === "caught") return;
    const t = window.setTimeout(() => setReveal((r) => (r && r.key === reveal.key ? null : r)), 1900);
    return () => window.clearTimeout(t);
  }, [reveal]);

  const covered = new Set<Cell>();
  for (const p of state.helis) for (const c of pointCells(p)) covered.add(c);
  const carCell = state.path.length ? state.path[state.path.length - 1] : null;
  const pathOrder = new Map<Cell, number[]>();
  if (showSecret) state.path.forEach((c, i) => pathOrder.set(c, [...(pathOrder.get(c) ?? []), i + 1]));

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[min(92vw,560px)] select-none rounded-3xl bg-[#0b1220] p-[5%] shadow-[inset_0_0_60px_rgba(56,189,248,0.08)] ring-1 ring-white/10 light:bg-slate-800">
      <style>{`
        @keyframes cc-lift { 0% { transform: translateY(0) } 25%, 80% { transform: translateY(-38%) rotate(-3deg) } 100% { transform: translateY(0) } }
        @keyframes cc-lift-stay { 0% { transform: translateY(0) } 30%, 100% { transform: translateY(-42%) rotate(-4deg) } }
        @keyframes cc-siren { 0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,.0) } 50% { box-shadow: 0 0 28px 8px rgba(239,68,68,.75) } }
        @keyframes cc-pulse { 0%, 100% { transform: translate(-50%,-50%) scale(1) } 50% { transform: translate(-50%,-50%) scale(1.12) } }
        @keyframes cc-rotor { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        @keyframes cc-pop { 0% { transform: scale(.3); opacity: 0 } 60% { transform: scale(1.15); opacity: 1 } 100% { transform: scale(1) } }
      `}</style>
      <div className="relative h-full w-full">
        {/* Roads */}
        {Array.from({ length: POINT_GRID }, (_, i) => (
          <div key={`h${i}`} className="absolute left-0 right-0 h-[3.4%] -translate-y-1/2 bg-slate-700/70" style={{ top: `${i * STEP}%` }}>
            <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-yellow-200/25" />
          </div>
        ))}
        {Array.from({ length: POINT_GRID }, (_, j) => (
          <div key={`v${j}`} className="absolute bottom-0 top-0 w-[3.4%] -translate-x-1/2 bg-slate-700/70" style={{ left: `${j * STEP}%` }}>
            <div className="absolute inset-y-0 left-1/2 border-l border-dashed border-yellow-200/25" />
          </div>
        ))}

        {/* Buildings */}
        {Array.from({ length: CELL_COUNT }, (_, cell) => {
          const [r, c] = cellRC(cell);
          const look = buildingLook(cell);
          const isThiefTarget = thiefTargets?.has(cell) ?? false;
          const isSearchTarget = heliControls?.searchTargets.includes(cell) ?? false;
          const clickable = isThiefTarget || isSearchTarget;
          const note = latestSearch.get(cell);
          const lifting = reveal?.cell === cell;
          const contents = showSecret ? cellContents(state, cell) : null;
          const hasCar = showSecret && carCell === cell;
          const heatV = heat ? heat[cell] : 0;
          return (
            <div
              key={cell}
              className="absolute"
              style={{
                top: `${r * STEP + INSET}%`,
                left: `${c * STEP + INSET}%`,
                width: `${STEP - INSET * 2}%`,
                height: `${STEP - INSET * 2}%`,
              }}
            >
              {/* Ground: what's hidden under the building */}
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 rounded-lg bg-black/60 ring-1 ring-white/10">
                {(lifting ? reveal!.result === "caught" : hasCar) && (
                  <span className="text-[min(5.5vw,26px)] leading-none drop-shadow-[0_0_8px_rgba(239,68,68,0.9)]">🚗</span>
                )}
                <div className="flex flex-wrap justify-center gap-0.5">
                  {(lifting ? reveal!.tokens : (contents?.tokens.filter((_, i, arr) => !(hasCar && i === arr.length - 1)) ?? [])).map((t, i) => (
                    <span key={i} className={`h-2 w-2 rounded-full border sm:h-2.5 sm:w-2.5 ${TOKEN_CLASS[t]}`} />
                  ))}
                </div>
                {lifting && reveal!.result === "empty" && <span className="text-[9px] font-bold text-white/60 sm:text-[10px]">텅 빔</span>}
              </div>

              {/* The building itself (lifts off on search) */}
              <button
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onCellClick?.(cell)}
                className={`group absolute inset-0 rounded-lg transition-[filter] ${clickable ? "cursor-pointer" : "cursor-default"} ${
                  showSecret && hasCar && !lifting ? "opacity-80" : ""
                }`}
                style={{
                  animation: lifting ? `${reveal!.result === "caught" ? "cc-lift-stay" : "cc-lift"} 1.8s ease-in-out forwards` : undefined,
                  zIndex: lifting ? 20 : 1,
                }}
                aria-label={`${cellLabel(cell)} 건물${isSearchTarget ? " 수색" : isThiefTarget ? "으로 이동" : ""}`}
              >
                {/* facade (depth) */}
                <div className="absolute inset-x-0 bottom-0 top-[18%] rounded-lg" style={{ background: look.facade, boxShadow: "0 6px 10px rgba(0,0,0,.5)" }} />
                {/* roof */}
                <div
                  className={`absolute inset-x-0 top-0 flex flex-col justify-center gap-[6%] rounded-lg px-[12%] ring-1 ${
                    isSearchTarget ? "ring-2 ring-sky-300" : isThiefTarget ? "ring-2 ring-rose-400" : "ring-white/15"
                  } ${clickable ? "group-hover:brightness-125" : ""}`}
                  style={{
                    bottom: `${look.lift}%`,
                    background: `linear-gradient(160deg, color-mix(in srgb, ${look.facade} 70%, white 22%), ${look.facade})`,
                    animation: isSearchTarget || isThiefTarget ? "cc-siren 1.6s ease-in-out infinite" : undefined,
                  }}
                >
                  {Array.from({ length: look.windows }, (_, w) => (
                    <div key={w} className="flex justify-between">
                      {[0, 1, 2].map((k) => (
                        <span key={k} className={`h-[3px] w-[22%] rounded-sm ${(cell + w + k) % 3 === 0 ? "bg-amber-200/70" : "bg-white/15"}`} />
                      ))}
                    </div>
                  ))}
                </div>
                {/* watched-zone tint + heat */}
                {covered.has(cell) && <div className="pointer-events-none absolute inset-0 rounded-lg bg-sky-400/10" />}
                {heatV > 0.004 && (
                  <div
                    className="pointer-events-none absolute inset-0 rounded-lg"
                    style={{ background: `rgba(244,63,94,${Math.min(0.75, 0.12 + heatV * 2.2)})` }}
                  />
                )}
                <span className="pointer-events-none absolute left-1 top-0.5 text-[8px] font-semibold text-white/40 sm:text-[10px]">{cellLabel(cell)}</span>
                {heatV > 0.004 && (
                  <span className="pointer-events-none absolute bottom-0.5 left-1 text-[8px] font-bold text-rose-100 sm:text-[10px]">{Math.round(heatV * 100)}%</span>
                )}
                {isSearchTarget && (
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-base sm:text-xl">🔍</span>
                )}
                {isThiefTarget && !isSearchTarget && (
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-bold text-rose-200 sm:text-sm">➜</span>
                )}
                {/* Police notes: last search result on this building */}
                {note && !lifting && (
                  <span
                    className={`pointer-events-none absolute -right-1 -top-1 flex items-center gap-0.5 rounded-full px-1 py-px text-[8px] font-bold shadow sm:text-[9px] ${
                      note.result === "trail" ? "bg-amber-400 text-black" : "bg-slate-200 text-slate-800"
                    }`}
                  >
                    {note.result === "trail" ? (
                      <>
                        {note.tokens.map((t, i) => (
                          <span key={i} className={`h-1.5 w-1.5 rounded-full border ${TOKEN_CLASS[t]}`} />
                        ))}
                        R{note.round}
                      </>
                    ) : (
                      <>✕ R{note.round}</>
                    )}
                  </span>
                )}
                {showSecret && (pathOrder.get(cell)?.length ?? 0) > 0 && !hasCar && (
                  <span className="pointer-events-none absolute bottom-0.5 right-1 text-[8px] font-bold text-rose-200/90 sm:text-[10px]">
                    {pathOrder.get(cell)!.join("·")}
                  </span>
                )}
                {hasCar && !lifting && (
                  <span className="pointer-events-none absolute bottom-0.5 right-1 text-sm sm:text-base">🚗</span>
                )}
              </button>
            </div>
          );
        })}

        {/* Move targets for the active helicopter */}
        {heliControls?.moveTargets.map((p) => {
          const [i, j] = pointIJ(p);
          return (
            <button
              key={`t${p}`}
              type="button"
              onClick={() => onPointClick?.(p)}
              className={`absolute z-30 flex h-[7%] w-[7%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-dashed ${HELI_STYLES[heliControls.heli].border} bg-black/50 text-[10px] font-bold text-white hover:bg-white/20`}
              style={{ top: `${i * STEP}%`, left: `${j * STEP}%` }}
              aria-label="헬기 이동"
            >
              ↗
            </button>
          );
        })}

        {/* Helicopters */}
        {state.helis.map((p, h) => {
          const [i, j] = pointIJ(p);
          const active = state.phase === "police" && state.heliTurn === h;
          return (
            <div
              key={`heli${h}`}
              className={`pointer-events-none absolute z-40 flex h-[9%] w-[9%] items-center justify-center rounded-full ${HELI_STYLES[h].bg} shadow-lg ring-2 ring-white/80 transition-all duration-500 ease-out`}
              style={{
                top: `${i * STEP}%`,
                left: `${j * STEP}%`,
                transform: "translate(-50%,-50%)",
                animation: active ? "cc-pulse 1.1s ease-in-out infinite" : undefined,
                boxShadow: active ? `0 0 0 4px rgba(255,255,255,.25), 0 0 18px ${HELI_STYLES[h].hex}` : undefined,
              }}
            >
              <span
                className="absolute inset-[-18%] rounded-full border-2 border-dotted border-white/40"
                style={{ animation: "cc-rotor 0.6s linear infinite" }}
              />
              <span className="text-[min(4vw,20px)] leading-none">🚁</span>
              <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-black text-[9px] font-bold text-white ring-1 ring-white/60">
                {h + 1}
              </span>
            </div>
          );
        })}

        {reveal && reveal.result === "caught" && (
          <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center">
            <div className="rounded-2xl bg-red-600/90 px-5 py-3 text-center text-lg font-black text-white shadow-2xl" style={{ animation: "cc-pop .5s ease-out both" }}>
              🚨 검거! {cellLabel(reveal.cell)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
