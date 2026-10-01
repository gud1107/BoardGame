"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getGameMeta } from "@/games/registry";
import type { StatTotalsRecord } from "@/lib/db/types";
import { countPendingStats, listPlayerStats, STATS_CHANGED_EVENT, syncPlayerStats } from "@/lib/stats/playerStats";
import { useSubscriptionStore } from "@/store/subscriptionStore";

export default function StatsPage() {
  const userId = useSubscriptionStore((s) => s.userId);
  const [stats, setStats] = useState<StatTotalsRecord[] | null>(null);
  const [pending, setPending] = useState(0);

  const load = useCallback(() => {
    void Promise.all([listPlayerStats(), countPendingStats()]).then(([rows, n]) => {
      setStats(rows.sort((a, b) => b.played - a.played || a.gameId.localeCompare(b.gameId)));
      setPending(n);
    });
  }, []);

  useEffect(() => {
    load();
    void syncPlayerStats();
    window.addEventListener(STATS_CHANGED_EVENT, load);
    return () => window.removeEventListener(STATS_CHANGED_EVENT, load);
  }, [load]);

  const total = (stats ?? []).reduce(
    (acc, s) => ({ played: acc.played + s.played, wins: acc.wins + s.wins }),
    { played: 0, wins: 0 },
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="mb-1 text-2xl font-bold text-white light:text-slate-900">내 전적</h1>
      <p className="mb-6 text-sm text-white/50 light:text-slate-500">
        {userId ? (
          <>계정에 저장된 전적입니다. 다른 기기에서 로그인해도 같은 기록이 보여요.</>
        ) : (
          <>
            지금은 이 브라우저에만 저장돼요.{" "}
            <Link href="/login?next=/stats" className="text-rose-300 underline light:text-rose-600">
              로그인
            </Link>
            하면 지금까지의 기록이 계정으로 합쳐집니다.
          </>
        )}
        {" "}1등은 승, 그 외 순위는 패로 집계하고, 봇이 대신 둔 판은 빠집니다.
      </p>

      {userId && pending > 0 && (
        <p className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-xs text-amber-200 light:text-amber-700">
          아직 계정에 올라가지 않은 기록 {pending}판이 있어요. 연결되면 자동으로 올라갑니다.
        </p>
      )}

      {stats === null ? (
        <p className="text-sm text-white/40 light:text-slate-400">불러오는 중...</p>
      ) : stats.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-white/5 p-6 text-center text-sm text-white/40 light:border-slate-200 light:bg-slate-50 light:text-slate-400">
          아직 기록된 게임이 없어요. 온라인 방에서 한 판 끝내면 여기에 쌓입니다.
        </p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <Stat label="전체 판수" value={`${total.played}`} />
            <Stat label="승리" value={`${total.wins}`} />
            <Stat label="승률" value={pct(total.wins, total.played)} />
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/10 light:border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-xs text-white/50 light:bg-slate-50 light:text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">게임</th>
                  <th className="px-2 py-2 text-right font-medium">판</th>
                  <th className="px-2 py-2 text-right font-medium">승</th>
                  <th className="px-2 py-2 text-right font-medium">패</th>
                  <th className="px-2 py-2 text-right font-medium">승률</th>
                  <th className="px-3 py-2 text-right font-medium">최고</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => {
                  const meta = getGameMeta(s.gameId);
                  return (
                    <tr key={s.gameId} className="border-t border-white/5 light:border-slate-100">
                      <td className="px-3 py-2 text-white/85 light:text-slate-800">
                        <span className="mr-1.5">{meta?.thumbnail.emoji ?? "🎲"}</span>
                        {meta?.name ?? s.gameId}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-white/70 light:text-slate-600">{s.played}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-white/70 light:text-slate-600">{s.wins}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-white/70 light:text-slate-600">{s.losses}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-white/85 light:text-slate-800">{pct(s.wins, s.played)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-white/70 light:text-slate-600">
                        {s.bestRank === null ? "-" : `${s.bestRank}위`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function pct(wins: number, played: number): string {
  return played === 0 ? "-" : `${Math.round((wins / played) * 100)}%`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-center light:border-slate-200 light:bg-white light:shadow-sm">
      <p className="text-xs text-white/40 light:text-slate-400">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums text-white light:text-slate-900">{value}</p>
    </div>
  );
}
