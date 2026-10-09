"use client";

import { useState } from "react";
import { DIFFICULTIES, MAP_IDS, MAPS, type GameMode } from "./engine";
import type { BestByMode } from "./bestWave";
import { DIFFICULTY_LABEL } from "./RoomSettings";

/** Lobby card: this device's best wave for every map × difficulty, one mode at a time. */
export default function BestWaveTable({ best }: { best: BestByMode }) {
  const [mode, setMode] = useState<GameMode>("survival");
  const rows = best[mode];
  const any = MAP_IDS.some((id) => DIFFICULTIES.some((d) => rows[id][d] > 0));
  // The top record in each difficulty column is drawn in gold.
  const top = Object.fromEntries(DIFFICULTIES.map((d) => [d, Math.max(...MAP_IDS.map((id) => rows[id][d]))]));
  const tab = (m: GameMode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      aria-pressed={mode === m}
      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${mode === m ? "bg-amber-400/25 text-amber-100 light:bg-amber-100 light:text-amber-800" : "text-white/50 hover:text-white/80 light:text-slate-500"}`}
    >
      {label}
    </button>
  );
  return (
    <div className="mt-3 w-full max-w-xs rounded-xl border border-white/10 bg-white/[0.03] p-2.5 text-left light:border-slate-200 light:bg-slate-50">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-white/80 light:text-slate-700">🏅 내 최고 기록</span>
        <span className="flex gap-0.5">
          {tab("survival", "🛡️ 생존전")}
          {tab("versus", "⚔️ 대결")}
        </span>
      </div>
      <table className="w-full table-fixed text-[11px] text-white/70 light:text-slate-600">
        <thead>
          <tr className="text-white/40 light:text-slate-400">
            <th className="w-[40%] pb-1 text-left font-normal">맵</th>
            {DIFFICULTIES.map((d) => (
              <th key={d} className="pb-1 text-center font-normal">
                {DIFFICULTY_LABEL[d].emoji} {DIFFICULTY_LABEL[d].name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MAP_IDS.map((id) => (
            <tr key={id} className="border-t border-white/5 light:border-slate-200">
              <td className="truncate py-1">
                {MAPS[id].emoji} {MAPS[id].name}
              </td>
              {DIFFICULTIES.map((d) => {
                const w = rows[id][d];
                return (
                  <td key={d} className={`py-1 text-center font-mono ${w && w === top[d] ? "font-bold text-amber-300 light:text-amber-600" : w ? "" : "opacity-30"}`}>
                    {w ? `W${w}` : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {!any && <p className="mt-1 text-center text-[10px] text-white/40 light:text-slate-400">아직 기록이 없어요 — 한 판 해보세요!</p>}
    </div>
  );
}
