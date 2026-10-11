"use client";

import { useEffect, useState } from "react";
import Overlay from "@/components/Overlay";
import { fetchMetricLeaderboard, type LeaderboardResult, type MetricLeaderboardRow } from "@/lib/stats/leaderboard";
import type { RankMetric } from "@/lib/stats/presentation";
import { GAME_ID, PLAYER_COUNTS } from "./bestScore";

/**
 * 🏅 순위표 — everyone's best score for one player count, from the shared
 * `public_metric_leaderboard` RPC over the account-synced `maxScore{N}p`
 * detail (same data /stats ranks). Only logged-in players' synced games
 * count. "사람끼리만" drops games that had a bot at the table, since a table
 * of Lv.10 bots makes a co-op score much easier.
 */

export function scoreMetric(playerCount: number): RankMetric {
  return { id: `tp-${playerCount}p`, label: `${playerCount}인 최고 점수`, num: `maxScore${playerCount}p`, format: "count", unit: "점" };
}

type Load = { key: string; result: LeaderboardResult<MetricLeaderboardRow> };

export default function LeaderboardModal({ onClose, initialCount = 3 }: { onClose: () => void; initialCount?: number }) {
  const [count, setCount] = useState(initialCount);
  const [humansOnly, setHumansOnly] = useState(false);
  const [load, setLoad] = useState<Load | null>(null);
  const key = `${count}:${humansOnly}`;

  useEffect(() => {
    let alive = true;
    fetchMetricLeaderboard(GAME_ID, scoreMetric(count), { includeBots: !humansOnly, botLevel: null }, 30).then((result) => {
      if (alive) setLoad({ key, result });
    });
    return () => {
      alive = false;
    };
  }, [count, humansOnly, key]);

  const result = load?.key === key ? load.result : undefined;
  const medal = (rank: number) => (rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}`);

  return (
    <Overlay title="🏅 텔레파시 순위표" onClose={onClose} wide>
      <div className="flex flex-col gap-3 text-sm text-white/80 light:text-slate-700">
        <div className="flex flex-wrap items-center gap-1.5">
          {PLAYER_COUNTS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setCount(n)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                n === count ? "bg-indigo-500 text-white" : "border border-white/15 text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600"
              }`}
            >
              {n}인
            </button>
          ))}
          <label className="ml-auto flex items-center gap-1.5 text-xs text-white/70 light:text-slate-600">
            <input type="checkbox" checked={humansOnly} onChange={(e) => setHumansOnly(e.target.checked)} />
            사람끼리 한 판만
          </label>
        </div>

        {result === undefined ? (
          <p className="py-6 text-center text-xs text-white/50 light:text-slate-500">불러오는 중…</p>
        ) : result === null || result === "not-installed" ? (
          <p className="py-6 text-center text-xs text-white/50 light:text-slate-500">지금은 순위표를 불러올 수 없어요. 잠시 후 다시 열어 주세요.</p>
        ) : result.length === 0 ? (
          <p className="py-6 text-center text-xs text-white/50 light:text-slate-500">아직 {count}인 기록이 없어요. 첫 번째로 이름을 올려 보세요!</p>
        ) : (
          <ol className="flex flex-col gap-1">
            {result.map((r) => (
              <li
                key={`${r.rank}-${r.nickname}`}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 ${r.isMe ? "border border-indigo-300/60 bg-indigo-500/20" : "bg-white/[0.04] light:bg-slate-50"}`}
              >
                <span className="w-7 text-center text-sm font-black tabular-nums">{medal(r.rank)}</span>
                <span className="min-w-0 flex-1 truncate font-semibold text-white light:text-slate-900">
                  {r.nickname}
                  {r.isMe && <span className="ml-1 text-xs text-indigo-200 light:text-indigo-600">(나)</span>}
                </span>
                <span className="text-xs text-white/40 light:text-slate-400">{r.played}판</span>
                <span className="w-20 text-right font-black tabular-nums text-yellow-100 light:text-amber-700">{r.value.toLocaleString()}점</span>
              </li>
            ))}
          </ol>
        )}

        <p className="text-[11px] text-white/40 light:text-slate-400">
          로그인한 사람의 기록만 올라가요 (연습 모드 제외). 인원이 다르면 난이도가 달라서 인원별로 따로 겨뤄요. 전체 전적 순위는 /stats 에서도 볼 수 있어요.
        </p>
      </div>
    </Overlay>
  );
}
