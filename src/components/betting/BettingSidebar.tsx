"use client";

import { useEffect, useState } from "react";
import { useBettingStore } from "@/store/bettingStore";
import type { BettingSessionRecord, DailyRecord } from "@/lib/db/types";
import RosterEditor, { type RosterParticipant } from "./RosterEditor";
import PayoutTableEditor from "./PayoutTableEditor";
import SettlementModal from "./SettlementModal";
import DragHandle from "@/components/common/DragHandle";
import { useSwipeToDismiss } from "@/hooks/useSwipeToDismiss";
import type { SettlementRoundInput } from "@/lib/betting/settlementView";

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${
        checked ? "bg-emerald-500" : "bg-white/15"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export default function BettingSidebar() {
  const session = useBettingStore((s) => s.session);
  const hydrated = useBettingStore((s) => s.hydrated);
  const sidebarOpen = useBettingStore((s) => s.sidebarOpen);
  const setSidebarOpen = useBettingStore((s) => s.setSidebarOpen);
  const init = useBettingStore((s) => s.init);
  const startSession = useBettingStore((s) => s.startSession);
  const endSession = useBettingStore((s) => s.endSession);
  const updateParticipantName = useBettingStore((s) => s.updateParticipantName);
  const updatePayoutTable = useBettingStore((s) => s.updatePayoutTable);
  const mergeParticipants = useBettingStore((s) => s.mergeParticipants);
  const unmergeGroup = useBettingStore((s) => s.unmergeGroup);
  const applyManualAdjustment = useBettingStore((s) => s.applyManualAdjustment);
  const closeSidebar = () => setSidebarOpen(false);
  const [settlementOpen, setSettlementOpen] = useState(false);
  const { dragY, dragging, handlers } = useSwipeToDismiss(closeSidebar);

  useEffect(() => {
    void init();
  }, [init]);

  // Draft state used only before a session exists.
  const [draftParticipants, setDraftParticipants] = useState<RosterParticipant[]>([]);
  const [draftPayout, setDraftPayout] = useState<number[]>([]);
  const [startError, setStartError] = useState<string | null>(null);

  // Live-editable payout draft for an *active* session (mirrors session.payoutTable,
  // but survives momentarily-invalid keystrokes that the store refuses to persist).
  const [livePayout, setLivePayout] = useState<number[]>([]);
  const [livePayoutForSession, setLivePayoutForSession] = useState<string | null>(null);
  const [payoutError, setPayoutError] = useState<string | null>(null);
  if (session && session.id !== livePayoutForSession) {
    setLivePayoutForSession(session.id);
    setLivePayout(session.payoutTable);
    setPayoutError(null);
  }

  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [lastRecord, setLastRecord] = useState<DailyRecord | null>(null);

  async function handleToggle(next: boolean) {
    if (next) {
      setStartError(null);
      const res = await startSession(
        draftParticipants.map((p) => ({ playerId: p.id, name: p.name })),
        draftPayout,
      );
      if (!res.ok) {
        setStartError(res.error);
        return;
      }
      setDraftParticipants([]);
      setDraftPayout([]);
    } else {
      setConfirmingEnd(true);
    }
  }

  async function handleConfirmEnd() {
    const record = await endSession();
    setConfirmingEnd(false);
    if (record) setLastRecord(record);
  }

  async function handleLivePayoutChange(table: number[]) {
    setLivePayout(table);
    const res = await updatePayoutTable(table);
    setPayoutError(res.ok ? null : res.error);
  }

  const sortedParticipants = session
    ? [...session.participants].sort(
        (a, b) => (session.totals[b.playerId] ?? 0) - (session.totals[a.playerId] ?? 0),
      )
    : [];

  return (
    <>
      {/* Always-visible toggle, floats above everything so it's reachable on any scroll position / screen size. */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label="내기 관리 사이드바 열기"
        className="fixed right-4 bottom-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-rose-500 text-2xl text-white shadow-xl transition hover:bg-rose-400"
      >
        🎲
        {session && (
          <span className="absolute top-1 right-1 h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-[#0b0b12]" />
        )}
      </button>

      {sidebarOpen && <div onClick={closeSidebar} className="fixed inset-0 z-30 bg-black/50" />}

      <aside
        style={
          sidebarOpen
            ? { transform: `translateY(${dragY}px)`, transition: dragging ? "none" : "transform 200ms ease-out" }
            : undefined
        }
        className={`fixed inset-x-0 bottom-0 z-40 flex max-h-[85vh] w-full flex-col rounded-t-2xl border-t border-white/10 bg-[#12101c] shadow-2xl transition-transform duration-200 sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:max-h-none sm:w-96 sm:max-w-sm sm:translate-y-0 sm:rounded-none sm:rounded-l-2xl sm:border-t-0 sm:border-l md:w-[26rem] lg:w-[30rem] ${
          sidebarOpen ? "translate-y-0 sm:translate-x-0" : "translate-y-full sm:translate-x-full"
        }`}
      >
        <div {...handlers} className="shrink-0 px-4 pt-3">
          <DragHandle />
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <h2 className="text-sm font-bold text-white">🎲 내기 관리</h2>
            <button
              onClick={closeSidebar}
              className="-mr-2 grid h-12 w-12 place-items-center rounded-full text-xl text-white/50 transition hover:bg-white/10 hover:text-white active:bg-white/20"
              aria-label="닫기"
            >
              ×
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {!hydrated ? (
            <p className="text-sm text-white/40">불러오는 중...</p>
          ) : (
            <div className="flex flex-col gap-5">
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-white">내기 활성화</p>
                  <p className="text-[11px] text-white/45">
                    {session ? "진행 중 — 끄면 오늘 기록이 저장돼요." : "꺼져 있으면 순위 기록 없이 자유 플레이"}
                  </p>
                </div>
                <Switch checked={Boolean(session)} onChange={handleToggle} />
              </div>

              {!session && (
                <>
                  {startError && (
                    <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{startError}</p>
                  )}
                  <div>
                    <p className="mb-2 text-sm font-medium text-white/80">참가자 (최대 10명)</p>
                    <RosterEditor participants={draftParticipants} onChange={setDraftParticipants} />
                  </div>
                  {draftParticipants.length >= 2 && (
                    <PayoutTableEditor
                      participantCount={draftParticipants.length}
                      payoutTable={draftPayout}
                      onChange={setDraftPayout}
                    />
                  )}
                  <p className="text-[11px] text-white/40">
                    참가자를 추가하고 순위별 상금/벌금을 정한 뒤 위 스위치를 켜면 내기가 시작돼요.
                  </p>
                </>
              )}

              {session && (
                <>
                  <div>
                    <p className="mb-2 text-sm font-medium text-white/80">
                      참가자 닉네임 · 누적 스코어
                    </p>
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-2">
                      {sortedParticipants.map((p) => {
                        const total = session.totals[p.playerId] ?? 0;
                        return (
                          <div
                            key={p.playerId}
                            className="flex flex-col gap-1.5 rounded-xl border border-white/10 bg-white/5 p-2.5"
                          >
                            <input
                              defaultValue={p.name}
                              aria-label="참가자 닉네임"
                              onBlur={(e) => {
                                if (e.target.value.trim() && e.target.value.trim() !== p.name) {
                                  void updateParticipantName(p.playerId, e.target.value);
                                }
                              }}
                              className="min-h-11 min-w-0 rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-sm text-white outline-none focus:border-rose-400"
                            />
                            <span
                              className={`text-right text-base font-bold whitespace-nowrap tabular-nums ${
                                total >= 0 ? "text-emerald-300" : "text-rose-300"
                              }`}
                            >
                              {total >= 0 ? "+" : ""}
                              {total.toLocaleString()}원
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-1.5 text-[11px] text-white/40">
                      닉네임을 바꾸면 현재 진행 중인 게임에도 바로 반영돼요. 참가자 추가/삭제는 이번
                      내기를 끝낸 뒤 새로 시작해야 순위표와 어긋나지 않아요.
                    </p>
                  </div>

                  <div>
                    <PayoutTableEditor
                      participantCount={session.participants.length}
                      payoutTable={livePayout}
                      onChange={handleLivePayoutChange}
                    />
                    {payoutError && (
                      <p className="mt-2 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                        {payoutError} (마지막으로 저장된 값이 유지됩니다)
                      </p>
                    )}
                  </div>

                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="mb-1 flex items-center justify-between">
                      <p className="text-sm font-medium text-white/80">진행 상황</p>
                      <button
                        onClick={() => setSettlementOpen(true)}
                        className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/70 hover:border-white/30"
                      >
                        📊 정산표 보기
                      </button>
                    </div>
                    <p className="text-xs text-white/60">지금까지 {session.rounds.length}게임 진행됨</p>
                    {session.rounds.length > 0 && (
                      <ul className="mt-2 flex flex-col gap-1 text-[11px] text-white/45">
                        {[...session.rounds]
                          .slice(-5)
                          .reverse()
                          .map((r) => (
                            <li key={r.id}>
                              {r.gameName} · {new Date(r.playedAt).toLocaleTimeString("ko-KR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>

                  {!confirmingEnd ? (
                    <button
                      onClick={() => setConfirmingEnd(true)}
                      className="w-full rounded-xl bg-rose-500 py-3 text-sm font-semibold text-white transition hover:bg-rose-400"
                    >
                      내기 끝 (오늘 기록 저장)
                    </button>
                  ) : (
                    <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3">
                      <p className="mb-2 text-xs text-amber-200">
                        정말 종료할까요? 오늘의 최종 순위가 저장되고 내기가 초기화됩니다.
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setConfirmingEnd(false)}
                          className="flex-1 rounded-lg border border-white/15 py-2 text-xs text-white/70 hover:border-white/30"
                        >
                          계속하기
                        </button>
                        <button
                          onClick={handleConfirmEnd}
                          className="flex-1 rounded-lg bg-rose-500 py-2 text-xs font-semibold text-white hover:bg-rose-400"
                        >
                          내기끝
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {lastRecord && (
                <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-medium text-emerald-200">
                      {lastRecord.date} 최종 결과
                    </p>
                    <button
                      onClick={() => setLastRecord(null)}
                      className="text-xs text-emerald-200/60 hover:text-emerald-200"
                    >
                      닫기
                    </button>
                  </div>
                  <div className="flex flex-col gap-1">
                    {lastRecord.standings.map((s) => (
                      <div key={s.playerId} className="flex justify-between text-xs">
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
              )}
            </div>
          )}
        </div>
      </aside>

      {session && (
        <SettlementModal
          title="내기"
          open={settlementOpen}
          onClose={() => setSettlementOpen(false)}
          rounds={buildLocalSettlementRounds(session.rounds, session.manualAdjustments)}
          names={Object.fromEntries(session.participants.map((p) => [p.playerId, p.name]))}
          mergedGroups={session.mergedGroups ?? []}
          onMerge={(canonicalId, memberIds) => void mergeParticipants(canonicalId, memberIds)}
          onUnmerge={(canonicalId) => void unmergeGroup(canonicalId)}
          onManualAdjust={(playerId, amount, note) => void applyManualAdjustment(playerId, amount, note)}
        />
      )}
    </>
  );
}

/**
 * Folds `session.rounds` into the settlement grid's per-round columns, plus
 * one trailing "수동 보정" column summing every manual adjustment per
 * participant (so a correction shows up in the grid without being mistaken
 * for a real played round).
 */
function buildLocalSettlementRounds(
  rounds: BettingSessionRecord["rounds"],
  manualAdjustments: BettingSessionRecord["manualAdjustments"],
): SettlementRoundInput[] {
  const cols: SettlementRoundInput[] = rounds.map((r, i) => ({
    round: i + 1,
    label: r.gameName,
    deltas: r.deltas,
  }));
  if (manualAdjustments && manualAdjustments.length > 0) {
    const deltas: Record<string, number> = {};
    for (const adj of manualAdjustments) deltas[adj.playerId] = (deltas[adj.playerId] ?? 0) + adj.amount;
    cols.push({ round: cols.length + 1, label: "수동 보정", deltas });
  }
  return cols;
}
