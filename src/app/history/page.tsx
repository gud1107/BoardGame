"use client";

import { useEffect, useState } from "react";
import { listDailyRecords } from "@/lib/db/repository";
import type { DailyRecord } from "@/lib/db/types";

export default function HistoryPage() {
  const [records, setRecords] = useState<DailyRecord[] | null>(null);

  useEffect(() => {
    void listDailyRecords().then(setRecords);
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="mb-1 text-2xl font-bold text-white">내기 기록</h1>
      <p className="mb-6 text-sm text-white/50">
        &lsquo;내기끝&rsquo;으로 종료된 세션의 일자별 최종 순위입니다. 이 브라우저(기기)에 저장된
        기록만 표시됩니다.
      </p>

      {records === null ? (
        <p className="text-sm text-white/40">불러오는 중...</p>
      ) : records.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-white/5 p-6 text-center text-sm text-white/40">
          아직 종료된 내기 기록이 없습니다.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {records.map((r) => (
            <div key={r.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-white">{r.date}</span>
                <span className="text-xs text-white/40">{r.roundCount}게임 진행</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {r.standings.map((s) => (
                  <div key={s.playerId} className="flex items-center justify-between text-sm">
                    <span className="text-white/80">
                      {s.rank}위 · {s.name}
                    </span>
                    <span className={s.total >= 0 ? "text-emerald-300" : "text-rose-300"}>
                      {s.total >= 0 ? "+" : ""}
                      {s.total.toLocaleString()}원
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
