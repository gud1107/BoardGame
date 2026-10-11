"use client";

import { PLAYER_COUNTS, useBestRecords } from "./bestScore";

/**
 * 🏆 내 최고 기록 — every player count's best score and furthest level in one
 * table. Shown on the room-choose screen and the result screen; `highlight`
 * marks the count just played.
 */
export default function BestRecordsPanel({ highlight }: { highlight?: number }) {
  const records = useBestRecords();
  return (
    <div className="w-full rounded-xl border border-yellow-300/30 bg-yellow-400/[0.06] p-3 text-left light:border-amber-200 light:bg-amber-50">
      <p className="mb-2 text-xs font-bold text-yellow-100 light:text-amber-800">🏆 내 최고 기록 (인원별)</p>
      {records === null ? (
        <p className="text-xs text-white/40 light:text-slate-400">불러오는 중…</p>
      ) : (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="text-white/50 light:text-slate-500">
              <th className="pb-1 text-left font-semibold">인원</th>
              <th className="pb-1 text-right font-semibold">최고 점수</th>
              <th className="pb-1 text-right font-semibold">최고 레벨</th>
            </tr>
          </thead>
          <tbody>
            {PLAYER_COUNTS.map((n) => {
              const r = records[n];
              const cleared = r.level >= r.maxLevel;
              return (
                <tr key={n} className={n === highlight ? "bg-yellow-400/15 font-semibold" : ""}>
                  <td className="py-1 pl-1 text-white/80 light:text-slate-700">{n}인</td>
                  <td className="py-1 text-right tabular-nums text-white light:text-slate-900">{r.score > 0 ? `${r.score.toLocaleString()}점` : <span className="text-white/30 light:text-slate-300">—</span>}</td>
                  <td className="py-1 pr-1 text-right tabular-nums text-white/80 light:text-slate-700">
                    {r.level > 0 ? (
                      <>
                        {r.level} / {r.maxLevel}
                        {cleared && " 🌌"}
                      </>
                    ) : (
                      <span className="text-white/30 light:text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="mt-1.5 text-[10px] text-white/40 light:text-slate-400">로그인하면 계정에 저장돼 다른 기기에서도 보여요 · 연습 모드는 기록 안 됨 · 🌌 = 전 레벨 통과</p>
    </div>
  );
}
