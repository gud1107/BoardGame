"use client";

import { useMemo, useState } from "react";
import type { GameRankingEntry } from "@/games/types";
import type { BettingParticipant } from "@/lib/db/types";

interface Props {
  participants: BettingParticipant[];
  /** Ranking the game engine already computed for the subset that actually played (if any). */
  autoRanking: GameRankingEntry[];
  onConfirm: (ranks: Record<string, number>) => void;
}

export default function RoundResultEntry({ participants, autoRanking, onConfirm }: Props) {
  const initialRanks = useMemo(() => {
    const ranks: Record<string, number> = {};
    for (const entry of autoRanking) ranks[entry.playerId] = entry.rank;
    const nextRank = autoRanking.length > 0 ? Math.max(...autoRanking.map((e) => e.rank)) + 1 : 1;
    for (const p of participants) {
      if (!(p.playerId in ranks)) ranks[p.playerId] = nextRank;
    }
    return ranks;
  }, [participants, autoRanking]);

  const [ranks, setRanks] = useState(initialRanks);
  const autoIds = new Set(autoRanking.map((e) => e.playerId));

  function updateRank(playerId: string, value: number) {
    setRanks((prev) => ({ ...prev, [playerId]: value }));
  }

  const sorted = [...participants].sort((a, b) => ranks[a.playerId] - ranks[b.playerId]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-white/60">
        이번 판 순위를 확인하세요. 같은 숫자를 입력하면 공동 순위로 처리되어 상금을 나눠 갖습니다.
        {autoRanking.length > 0 && " 실제로 플레이한 참가자의 순위는 자동으로 채워졌습니다."}
      </p>
      <div className="flex flex-col gap-2">
        {sorted.map((p) => (
          <div
            key={p.playerId}
            className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2"
          >
            <span className="flex items-center gap-2 text-sm text-white/85">
              {p.name}
              {autoIds.has(p.playerId) && (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
                  자동
                </span>
              )}
            </span>
            <input
              type="number"
              min={1}
              value={ranks[p.playerId]}
              onChange={(e) => updateRank(p.playerId, Number(e.target.value) || 1)}
              className="w-16 rounded-md border border-white/15 bg-black/30 px-2 py-1 text-right text-sm text-white outline-none focus:border-rose-400"
            />
          </div>
        ))}
      </div>
      <button
        onClick={() => onConfirm(ranks)}
        className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-semibold text-white transition hover:bg-emerald-400"
      >
        이번 판 결과 반영하기
      </button>
    </div>
  );
}
