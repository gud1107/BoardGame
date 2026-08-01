"use client";

import { useEffect, useState } from "react";
import { useBettingStore } from "@/store/bettingStore";
import type { DailyRecord } from "@/lib/db/types";
import Overlay from "@/components/Overlay";
import RosterEditor, { type RosterParticipant } from "./RosterEditor";
import PayoutTableEditor from "./PayoutTableEditor";

export default function BettingPanel() {
  const session = useBettingStore((s) => s.session);
  const hydrated = useBettingStore((s) => s.hydrated);
  const init = useBettingStore((s) => s.init);
  const startSession = useBettingStore((s) => s.startSession);
  const endSession = useBettingStore((s) => s.endSession);

  useEffect(() => {
    void init();
  }, [init]);

  const [setupOpen, setSetupOpen] = useState(false);
  const [participants, setParticipants] = useState<RosterParticipant[]>([]);
  const [payoutTable, setPayoutTable] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [lastRecord, setLastRecord] = useState<DailyRecord | null>(null);

  async function handleStart() {
    setError(null);
    const res = await startSession(
      participants.map((p) => ({ playerId: p.id, name: p.name })),
      payoutTable,
    );
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSetupOpen(false);
    setParticipants([]);
    setPayoutTable([]);
  }

  async function handleEnd() {
    const record = await endSession();
    setConfirmEnd(false);
    if (record) setLastRecord(record);
  }

  if (!hydrated) return <div className="h-8 w-24" />;

  return (
    <>
      {session ? (
        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-1.5 sm:flex">
            {[...session.participants]
              .sort((a, b) => (session.totals[b.playerId] ?? 0) - (session.totals[a.playerId] ?? 0))
              .slice(0, 4)
              .map((p) => {
                const total = session.totals[p.playerId] ?? 0;
                return (
                  <span
                    key={p.playerId}
                    className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/80"
                  >
                    {p.name}{" "}
                    <span className={total >= 0 ? "text-emerald-300" : "text-rose-300"}>
                      {total >= 0 ? "+" : ""}
                      {total.toLocaleString()}
                    </span>
                  </span>
                );
              })}
            {session.participants.length > 4 && (
              <span className="text-xs text-white/40">+{session.participants.length - 4}</span>
            )}
          </div>
          <button
            onClick={() => setConfirmEnd(true)}
            className="rounded-full bg-rose-500/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-400"
          >
            내기끝
          </button>
        </div>
      ) : (
        <button
          onClick={() => setSetupOpen(true)}
          className="rounded-full border border-white/20 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:border-rose-400 hover:text-white"
        >
          🎲 내기시작
        </button>
      )}

      {setupOpen && (
        <Overlay title="내기 설정" onClose={() => setSetupOpen(false)} wide>
          <div className="flex flex-col gap-5">
            <div>
              <p className="mb-2 text-sm font-medium text-white/80">참가자 (최대 10명)</p>
              <RosterEditor participants={participants} onChange={setParticipants} />
            </div>

            {participants.length >= 2 && (
              <PayoutTableEditor
                participantCount={participants.length}
                payoutTable={payoutTable}
                onChange={setPayoutTable}
              />
            )}

            {error && (
              <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>
            )}

            <button
              onClick={handleStart}
              disabled={participants.length < 2}
              className="w-full rounded-xl bg-rose-500 py-3 text-sm font-semibold text-white transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
            >
              내기시작
            </button>
            <p className="text-center text-[11px] text-white/40">
              내기시작을 누르지 않으면 게임은 순위 기록 없이 자유롭게 즐길 수 있어요.
            </p>
          </div>
        </Overlay>
      )}

      {confirmEnd && session && (
        <Overlay title="내기를 종료할까요?" onClose={() => setConfirmEnd(false)}>
          <p className="mb-4 text-sm text-white/60">
            지금까지 {session.rounds.length}게임의 결과가 기록되었습니다. 종료하면 오늘의 순위가
            저장되고 내기가 초기화됩니다.
          </p>
          <div className="mb-4 flex flex-col gap-1.5">
            {[...session.participants]
              .sort((a, b) => (session.totals[b.playerId] ?? 0) - (session.totals[a.playerId] ?? 0))
              .map((p) => {
                const total = session.totals[p.playerId] ?? 0;
                return (
                  <div key={p.playerId} className="flex justify-between text-sm">
                    <span className="text-white/80">{p.name}</span>
                    <span className={total >= 0 ? "text-emerald-300" : "text-rose-300"}>
                      {total >= 0 ? "+" : ""}
                      {total.toLocaleString()}원
                    </span>
                  </div>
                );
              })}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmEnd(false)}
              className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm text-white/70 hover:border-white/30"
            >
              계속하기
            </button>
            <button
              onClick={handleEnd}
              className="flex-1 rounded-xl bg-rose-500 py-2.5 text-sm font-semibold text-white hover:bg-rose-400"
            >
              내기끝
            </button>
          </div>
        </Overlay>
      )}

      {lastRecord && (
        <Overlay title={`${lastRecord.date} 최종 결과`} onClose={() => setLastRecord(null)}>
          <div className="flex flex-col gap-1.5">
            {lastRecord.standings.map((s) => (
              <div
                key={s.playerId}
                className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-sm"
              >
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
        </Overlay>
      )}
    </>
  );
}
