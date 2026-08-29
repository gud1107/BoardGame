"use client";

import { useState } from "react";
import PayoutTableEditor from "@/components/betting/PayoutTableEditor";
import SettlementModal from "@/components/betting/SettlementModal";
import { generateDefaultPayoutTable } from "@/lib/betting/zeroSum";
import { computeRoomBettingTotals, computeLatestNames, type RoomBettingState } from "./roomBetting";

interface Props {
  state: RoomBettingState;
  isHost: boolean;
  /** Live seat -> display name for seats that haven't played a round yet (fresh session, or a seat that just joined). */
  namesBySeat: Record<string, string>;
  participantCount: number;
  onStart: (payoutTable: number[]) => void;
  onPayoutChange: (table: number[]) => void;
  onEnd: () => void;
  onMerge: (canonicalSeat: string, memberSeats: string[]) => void;
  onUnmerge: (canonicalSeat: string) => void;
}

/**
 * Floating room-linked betting control, shared by every game that opts into
 * the cross-device ledger (see `roomBetting.ts`). Only the host can start/end
 * the session or edit the payout table — everyone else gets a read-only live
 * view of totals plus the same copy/CSV-export settlement modal.
 *
 * Positioning: a fixed FAB like `BettingSidebar`'s, but placed at
 * `bottom-24 right-4` (stacked above it, since `BettingSidebar` is mounted
 * globally in the root layout and is present on every game room page too) —
 * callers should double check their own game doesn't already have something
 * else fixed at that spot before mounting this.
 */
export default function RoomBettingPanel({
  state,
  isHost,
  namesBySeat,
  participantCount,
  onStart,
  onPayoutChange,
  onEnd,
  onMerge,
  onUnmerge,
}: Props) {
  const [open, setOpen] = useState(false);
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [payoutEditorOpen, setPayoutEditorOpen] = useState(false);
  const [draftPayout, setDraftPayout] = useState<number[]>(() => generateDefaultPayoutTable(participantCount));

  const totals = computeRoomBettingTotals(state);
  const latestNames = { ...namesBySeat, ...computeLatestNames(state) };
  const seatOrder = Object.keys(latestNames).sort((a, b) => (totals[b] ?? 0) - (totals[a] ?? 0));

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="내기 정산 패널 열기"
        className="fixed right-4 bottom-24 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500 text-xl text-white shadow-xl transition hover:bg-amber-400"
      >
        🎲
        {state.active && <span className="absolute top-1 right-1 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-[#0b0b12]" />}
      </button>

      {open && (
        <div className="fixed right-4 bottom-[9.5rem] z-40 w-72 rounded-2xl border border-white/10 bg-[#12101c] p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-bold text-white">🎲 이 방 내기</p>
            <button onClick={() => setOpen(false)} className="text-white/40 hover:text-white" aria-label="닫기">
              ×
            </button>
          </div>

          {!state.active ? (
            isHost ? (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-white/50">이 방 플레이어 전원이 자동으로 참여합니다.</p>
                <PayoutTableEditor participantCount={participantCount} payoutTable={draftPayout} onChange={setDraftPayout} />
                <button
                  onClick={() => onStart(draftPayout)}
                  className="min-h-11 rounded-xl bg-amber-500 py-2 text-sm font-semibold text-white hover:bg-amber-400"
                >
                  내기 시작
                </button>
              </div>
            ) : (
              <p className="text-xs text-white/50">총무(방장)가 아직 내기를 시작하지 않았어요.</p>
            )
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                {seatOrder.map((seat) => {
                  const total = totals[seat] ?? 0;
                  return (
                    <div key={seat} className="flex items-center justify-between rounded-lg bg-white/5 px-2.5 py-1.5 text-sm">
                      <span className="text-white/80">{latestNames[seat]}</span>
                      <span className={`font-bold tabular-nums ${total >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                        {total >= 0 ? "+" : ""}
                        {total.toLocaleString()}원
                      </span>
                    </div>
                  );
                })}
                {seatOrder.length === 0 && <p className="text-xs text-white/40">아직 정산된 라운드가 없어요.</p>}
              </div>
              <button
                onClick={() => setSettlementOpen(true)}
                className="min-h-11 rounded-xl border border-white/15 py-2 text-sm text-white/80 hover:border-white/30"
              >
                📊 정산표 보기
              </button>
              {isHost && (
                <>
                  <button
                    onClick={() => setPayoutEditorOpen((v) => !v)}
                    className="min-h-11 rounded-xl border border-white/15 py-2 text-sm text-white/60 hover:border-white/30"
                  >
                    ⚙️ 배당표 수정
                  </button>
                  {payoutEditorOpen && (
                    <PayoutTableEditor
                      participantCount={state.payoutTable.length}
                      payoutTable={[...state.payoutTable]}
                      onChange={onPayoutChange}
                    />
                  )}
                  <button
                    onClick={onEnd}
                    className="min-h-11 rounded-xl border border-rose-400/30 py-2 text-sm text-rose-300 hover:border-rose-400/60"
                  >
                    내기 종료
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <SettlementModal
        title="이 방"
        open={settlementOpen}
        onClose={() => setSettlementOpen(false)}
        rounds={state.rounds.map((r) => ({ round: r.round, label: `게임 ${r.round}`, deltas: r.deltas }))}
        names={latestNames}
        mergedGroups={[...state.mergedGroups]}
        readOnly={!isHost}
        onMerge={isHost ? onMerge : undefined}
        onUnmerge={isHost ? onUnmerge : undefined}
      />
    </>
  );
}
