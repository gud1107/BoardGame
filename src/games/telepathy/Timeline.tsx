"use client";

import type { LevelLog } from "./engine";

/** Distinct, readable on both themes. Indexed by seat. */
export const SEAT_COLORS = ["#38bdf8", "#f472b6", "#a3e635", "#fbbf24", "#c084fc", "#fb923c"];

/**
 * Replay timeline (rulebook §12): every card of one level placed by when it
 * landed, colored by who played it. Mistake reveals are red rings, ⚡ reveals
 * dashed. Shown in the level break and on the result screen.
 */
export default function Timeline({ log, names, showHands = true }: { log: LevelLog; names: string[]; showHands?: boolean }) {
  const entries = log.entries;
  const maxT = Math.max(1000, ...entries.map((e) => e.t));
  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}초`;

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="relative h-16 w-full rounded-xl border border-white/10 bg-black/20 light:border-slate-200 light:bg-slate-50">
        <div className="absolute inset-x-3 top-1/2 h-px bg-white/15 light:bg-slate-300" />
        {entries.length === 0 && <p className="absolute inset-0 flex items-center justify-center text-xs text-white/40 light:text-slate-400">기록 없음</p>}
        {entries.map((e, i) => {
          const left = `calc(${(e.t / maxT) * 100}% * 0.94 + 3%)`;
          const color = SEAT_COLORS[e.seat % SEAT_COLORS.length];
          const up = i % 2 === 0;
          return (
            <div
              key={`${e.card}-${i}`}
              className="absolute flex -translate-x-1/2 flex-col items-center"
              style={{ left, top: up ? 4 : undefined, bottom: up ? undefined : 4 }}
              title={`${names[e.seat] ?? ""} · ${e.card} · ${seconds(e.t)}${e.kind === "mistake" ? " · 실수로 버림" : e.kind === "star" ? " · ⚡로 버림" : ""}`}
            >
              {!up && <span className="mb-0.5 h-2 w-2 rounded-full" style={{ background: color }} />}
              <span
                className={`rounded-md px-1 text-[10px] font-bold leading-4 tabular-nums ${
                  e.kind === "mistake"
                    ? "bg-rose-500/20 text-rose-200 ring-1 ring-rose-400 light:text-rose-700"
                    : e.kind === "star"
                      ? "border border-dashed border-amber-300/70 text-amber-200 light:text-amber-700"
                      : "text-white light:text-slate-800"
                }`}
                style={e.kind === "play" ? { background: `${color}33` } : undefined}
              >
                {e.card}
              </span>
              {up && <span className="mt-0.5 h-2 w-2 rounded-full" style={{ background: color }} />}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap justify-between gap-1 text-[10px] text-white/40 light:text-slate-500">
        <span>0초</span>
        <span className="flex flex-wrap gap-2">
          <span className="text-rose-300 light:text-rose-600">● 실수로 버림</span>
          <span className="text-amber-300 light:text-amber-600">┆ ⚡로 버림</span>
        </span>
        <span>{seconds(maxT)}</span>
      </div>
      {showHands && (
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {log.hands.map((hand, seat) => (
          <span key={seat} className="text-white/70 light:text-slate-600">
            <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: SEAT_COLORS[seat % SEAT_COLORS.length] }} />
            {names[seat] ?? `${seat + 1}번`}: <span className="tabular-nums">{hand.join(", ") || "—"}</span>
          </span>
        ))}
      </div>
      )}
    </div>
  );
}
