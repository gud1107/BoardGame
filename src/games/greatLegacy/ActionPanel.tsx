"use client";

import { useMemo, useState } from "react";
import { DENOMINATIONS, emptyPurse, purseContains, purseValue } from "./constants";
import { minimalRaiseCoins } from "./engine";
import type { AuctionState, Denomination, EngineAction, GreatLegacyState, Purse, SeatIndex } from "./types";

/**
 * The viewer's own bidding controls — confirmed design: coin denominations
 * are tracked precisely (rulebook §G-1's "이미 제출한 코인은 구성 변경 불가,
 * 추가만 가능"), so the viewer builds up their raise by clicking individual
 * 20/10/5/1 coin stacks (each click stages one more of that denomination
 * from their remaining purse) rather than typing a raw number.
 */
export default function ActionPanel({
  state,
  viewerSeat,
  onAction,
}: {
  state: GreatLegacyState;
  viewerSeat: SeatIndex;
  onAction: (action: EngineAction) => void;
}) {
  const auction = state.auction as AuctionState | null;
  const [staged, setStaged] = useState<Purse>(emptyPurse());
  const player = state.players.find((p) => p.seat === viewerSeat);

  const isMyTurn = !!auction && auction.activeSeat === viewerSeat && !auction.passed.includes(viewerSeat);

  const remainingPurse = useMemo(() => {
    if (!player) return emptyPurse();
    return { 20: player.purse[20] - staged[20], 10: player.purse[10] - staged[10], 5: player.purse[5] - staged[5], 1: player.purse[1] - staged[1] };
  }, [player, staged]);

  if (!auction || !player) return null;

  const alreadyCommitted = auction.committed[viewerSeat];
  const alreadyCommittedValue = alreadyCommitted ? purseValue(alreadyCommitted) : 0;
  const stagedValue = purseValue(staged);
  const newTotal = alreadyCommittedValue + stagedValue;
  const canSubmitBid = newTotal > auction.highestBid && stagedValue > 0;

  function resetStaged() {
    setStaged(emptyPurse());
  }

  function addCoin(denom: Denomination) {
    if (remainingPurse[denom] <= 0) return;
    setStaged((s) => ({ ...s, [denom]: s[denom] + 1 }));
  }

  function removeCoin(denom: Denomination) {
    setStaged((s) => (s[denom] > 0 ? { ...s, [denom]: s[denom] - 1 } : s));
  }

  function submitBid() {
    if (!canSubmitBid) return;
    onAction({ type: "bid", seat: viewerSeat, addCoins: staged });
    resetStaged();
  }

  function submitMinimalBid() {
    const minimal = minimalRaiseCoins(state, viewerSeat);
    if (!minimal) return;
    onAction({ type: "bid", seat: viewerSeat, addCoins: minimal });
    resetStaged();
  }

  function submitPass() {
    onAction({ type: "pass", seat: viewerSeat });
    resetStaged();
  }

  if (!isMyTurn) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] light:border-slate-200 light:bg-slate-50 p-4 text-center text-sm text-white/40 light:text-slate-500">
        {auction.passed.includes(viewerSeat) ? "이번 경매에서 포기했습니다 — 다음 매물을 기다려주세요." : "다른 플레이어의 차례입니다..."}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-amber-400/40 bg-amber-400/[0.06] light:border-amber-300 light:bg-amber-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-white/80 light:text-slate-700">
        <span>
          내 차례 — 현재 최고 입찰{" "}
          <b className="text-amber-200 light:text-amber-700">{auction.highestBid}코인</b>
          {auction.kind === "reverse" && <span className="ml-1 text-rose-300 light:text-rose-600">(역경매: 먼저 포기하면 이 카드를 받습니다)</span>}
        </span>
        <span className="text-white/50 light:text-slate-500">
          내 입찰 누적 {alreadyCommittedValue}코인 → 지금 추가 {stagedValue}코인 = {newTotal}코인
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {DENOMINATIONS.map((denom) => (
          <div key={denom} className="flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={() => addCoin(denom)}
              disabled={remainingPurse[denom] <= 0}
              className="flex h-14 w-14 flex-col items-center justify-center rounded-full border-2 border-amber-300/50 bg-gradient-to-b from-amber-300/80 to-amber-600/80 text-sm font-bold text-black shadow-inner transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:scale-100"
              title={`${denom}코인 추가`}
            >
              {denom}
            </button>
            <span className="text-[10px] text-white/50 light:text-slate-500">
              보유 {remainingPurse[denom]}
              {staged[denom] > 0 && <span className="text-amber-300 light:text-amber-700"> (+{staged[denom]})</span>}
            </span>
            {staged[denom] > 0 && (
              <button type="button" onClick={() => removeCoin(denom)} className="text-[10px] text-white/40 underline hover:text-white/70 light:text-slate-400 light:hover:text-slate-600">
                되돌리기
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={submitBid}
          disabled={!canSubmitBid}
          className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-30"
        >
          입찰 ({newTotal}코인){!canSubmitBid && stagedValue > 0 ? " — 직전 입찰보다 더 많아야 해요" : ""}
        </button>
        <button
          type="button"
          onClick={submitMinimalBid}
          disabled={!purseContains(player.purse, minimalRaiseCoins(state, viewerSeat) ?? emptyPurse()) || !minimalRaiseCoins(state, viewerSeat)}
          className="rounded-xl border border-amber-300/40 px-3 py-2.5 text-xs font-semibold text-amber-200 transition hover:border-amber-300/70 disabled:cursor-not-allowed disabled:opacity-30 light:border-amber-400 light:text-amber-700 light:hover:border-amber-500"
        >
          최소 입찰
        </button>
        <button
          type="button"
          onClick={submitPass}
          className="rounded-xl border border-rose-400/40 px-4 py-2.5 text-sm font-semibold text-rose-200 transition hover:border-rose-400/70 hover:bg-rose-400/10 light:border-rose-400 light:text-rose-700 light:hover:border-rose-500 light:hover:bg-rose-50"
        >
          포기
        </button>
      </div>
    </div>
  );
}
