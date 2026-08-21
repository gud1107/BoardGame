"use client";

import Overlay from "@/components/Overlay";
import { combatBadge } from "./SummonersRiftBoard";
import { ITEM_CATALOG, type SeatIndex, type SummonersRiftState } from "./engine";
import { MonsterFace, RemovedItemsRow } from "./CardArt";

export interface SummonersRiftLastRoundModalProps {
  state: SummonersRiftState;
  names: Record<SeatIndex, string>;
  onClose: () => void;
}

/**
 * "직전 라운드 결과" — a single combined modal (요약 + 상세 브레이크다운, per the
 * task brief's confirmed UI decision) covering the most recently *completed*
 * round, sourced entirely from `state.lastRoundResult` (see engine.ts's
 * `RoundResult`). Mirrors destinyWar39's `LastRoundHistoryModal.tsx`: opened
 * from a header toggle button that stays disabled until a round has actually
 * finished, and stays available through the rest of the game regardless of
 * how far the *current* round has progressed since.
 */
export default function SummonersRiftLastRoundModal({ state, names, onClose }: SummonersRiftLastRoundModalProps) {
  const round = state.lastRoundResult;

  return (
    <Overlay title="🕓 직전 라운드 결과" onClose={onClose} wide>
      {!round ? (
        <p className="text-sm text-white/50">아직 완료된 라운드가 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-5 text-sm text-white/80">
          {/* 1. 요약 — 던전 진입자 / 공략 결과 / 남은 체력·최대 체력 */}
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <span className="text-xs text-white/50">ROUND {round.roundNumber}</span>
            <span className="font-semibold text-white/90">🛡️ {names[round.challengerSeat]}</span>
            {round.outcome === "success" ? (
              <span className="rounded-full border border-emerald-400/50 bg-emerald-400/10 px-2 py-0.5 text-xs font-bold text-emerald-200">
                ✅ 공략 성공
              </span>
            ) : (
              <span className="rounded-full border border-rose-400/50 bg-rose-400/10 px-2 py-0.5 text-xs font-bold text-rose-200">
                💀 공략 실패
              </span>
            )}
            {round.newlyEliminated && (
              <span className="rounded-full border border-rose-400/50 bg-rose-400/10 px-2 py-0.5 text-xs font-bold text-rose-200">🪦 탈락</span>
            )}
            <span className="ml-auto text-xs text-white/60">
              ❤️ 남은 체력 <b className="text-white">{Math.max(0, round.finalHp)}</b> / 최대 체력 <b className="text-white">{round.totalHp}</b>
            </span>
          </div>

          {round.spatulaDeclaredThreat !== null && (
            <p className="text-xs text-white/50">🥄 황금 뒤집개 지정 몬스터: 위협도 {round.spatulaDeclaredThreat}</p>
          )}

          {/* 2-a. 제외된 장비 목록 — 플레이어별 */}
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-white/50 uppercase">🗑️ 제외된 장비</h3>
            {round.removedByPlayer.length === 0 ? (
              <p className="text-xs text-white/35">이번 라운드엔 아무도 장비를 제외하지 않았습니다.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {round.removedByPlayer.map(({ seat, itemIds }) => (
                  <div key={seat} className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-white/70">{names[seat]}</span>
                    <RemovedItemsRow removedItemIds={itemIds} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 2-b. 등장한 몬스터 및 격파 과정 — 등장 순서대로 */}
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-white/50 uppercase">📜 등장 몬스터 & 격파 과정</h3>
            {round.combatLog.length === 0 ? (
              <p className="text-xs text-white/35">협곡 더미가 비어 있어 몬스터 없이 바로 공략에 성공했습니다.</p>
            ) : (
              <div className="flex flex-wrap gap-2.5">
                {round.combatLog.map((entry, i) => (
                  <div key={entry.monster.id} className="flex flex-col items-center gap-1">
                    <span className="text-[10px] text-white/40">#{i + 1}</span>
                    <MonsterFace threat={entry.monster.threat} size="sm" />
                    {combatBadge(entry)}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 최종 장착 아이템(참고용) */}
          <p className="text-[10px] text-white/35">
            라운드 종료 시점 장착 아이템: {round.equippedItemIds.length > 0 ? round.equippedItemIds.map((id) => ITEM_CATALOG.find((i) => i.id === id)!.name).join(", ") : "없음"}
          </p>
        </div>
      )}
    </Overlay>
  );
}
