"use client";

import { useState } from "react";
import Avatar from "@/components/common/Avatar";
import {
  commitRange,
  otherSeat,
  type EngineAction,
  type Seat,
  type ShowMeTheCoinState,
} from "./engine";
import ShowdownOverlay, { VaultPot } from "./ShowMeTheCoinEffects";
import RulebookModal from "./RulebookModal";
import { useCountdown } from "./useCountdown";

/** Request's "결과/연출 3초 유지" — confirmed length of the showdown reveal before the host auto-advances (see `ShowMeTheCoinGame.tsx`'s matching `setTimeout`). */
export const SHOWDOWN_SECONDS = 3;

/**
 * Controlled component (ARCHITECTURE.md §2) — reads `state` only via props,
 * translates every tap into an `EngineAction` via `onAction`. Knows nothing
 * about the network/betting layer; `ShowMeTheCoinGame.tsx` is the only place
 * that broadcasts actions or reports `onGameEnd` to the betting system.
 */
export interface ShowMeTheCoinBoardProps {
  state: ShowMeTheCoinState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  opponentConnected: boolean;
  onAction: (action: EngineAction) => void;
  /** `winnerSeat` is `null` for the confirmed-draw edge case (both seats KO'd on a tied round — see engine.ts's `applyKoCheck`). */
  onGameEnd: (winnerSeat: Seat | null) => void;
}

function PlayerPanel({
  name,
  stack,
  isDealer,
  isViewer,
  isActing,
  connected,
}: {
  name: string;
  stack: number;
  isDealer: boolean;
  isViewer: boolean;
  isActing: boolean;
  connected: boolean;
}) {
  return (
    <div
      className={`flex flex-1 flex-col items-center gap-1.5 rounded-2xl border p-3 transition ${
        isActing ? "border-pink-400/70 bg-pink-500/10 shadow-[0_0_20px_-4px_rgba(244,114,182,0.6)]" : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <div className="relative">
        <Avatar size={40} className={isViewer ? "ring-2 ring-emerald-400/70" : "ring-2 ring-white/10"} />
        {!connected && <span className="absolute -right-1 -bottom-1 text-xs" title="연결 끊김">📡</span>}
      </div>
      <span className="max-w-[100px] truncate text-xs font-semibold text-white/90">
        {name}
        {isViewer && <span className="text-emerald-300"> (나)</span>}
      </span>
      {isDealer && <span className="rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-200">선공</span>}
      <span className="text-base font-black text-amber-100 tabular-nums">🪙 {stack}</span>
      {isActing && <span className="text-[10px] font-medium text-pink-200">고민 중...</span>}
    </div>
  );
}

function CommitControls({
  stack,
  onCommit,
}: {
  stack: number;
  onCommit: (amount: number) => void;
}) {
  const { min, max } = commitRange(stack);
  const [amount, setAmount] = useState(min);
  const clamped = Math.min(Math.max(amount, min), max);

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-pink-400/30 bg-black/40 p-4">
      <p className="text-center text-xs text-white/60">
        가림판 뒤에서 이번 라운드에 걸 코인 개수를 정하세요 ({min}~{max}개)
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setAmount((a) => Math.max(min, a - 1))}
          disabled={clamped <= min}
          className="h-9 w-9 rounded-full border border-white/15 text-lg text-white/80 disabled:opacity-30"
        >
          −
        </button>
        <span className="w-16 text-center text-2xl font-black text-amber-200">🪙 {clamped}</span>
        <button
          type="button"
          onClick={() => setAmount((a) => Math.min(max, a + 1))}
          disabled={clamped >= max}
          className="h-9 w-9 rounded-full border border-white/15 text-lg text-white/80 disabled:opacity-30"
        >
          +
        </button>
      </div>
      <button
        type="button"
        onClick={() => onCommit(clamped)}
        className="w-full rounded-xl bg-gradient-to-r from-pink-500 to-amber-500 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
      >
        🔒 비공개 배치 확정
      </button>
    </div>
  );
}

function BettingControls({
  state,
  seat,
  onAction,
}: {
  state: ShowMeTheCoinState;
  seat: Seat;
  onAction: (action: EngineAction) => void;
}) {
  const stack = state.stacks[seat];
  const already = state.betsThisRound[seat];
  const toCall = state.currentBet - already;
  const canRaise = stack > toCall;
  const minRaise = Math.max(state.currentBet + 1, already + 1);
  const maxRaise = already + stack;
  const [raiseAmount, setRaiseAmount] = useState(minRaise);
  const raiseClamped = Math.min(Math.max(raiseAmount, minRaise), Math.max(minRaise, maxRaise));

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-amber-400/30 bg-black/40 p-4">
      <p className="text-center text-xs text-white/60">
        {toCall > 0 ? `상대 베팅 ${state.currentBet}코인 — 콜하려면 ${toCall}코인 필요` : "베팅 없음 — 체크하거나 베팅을 거세요"}
      </p>
      <div className="flex w-full gap-2">
        <button
          type="button"
          onClick={() => onAction({ type: "fold" })}
          className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm font-semibold text-white/70 transition hover:border-rose-400/50 hover:text-rose-300"
        >
          🏳️ 폴드
        </button>
        <button
          type="button"
          onClick={() => onAction({ type: "call" })}
          className="flex-1 rounded-xl border border-emerald-400/40 bg-emerald-500/10 py-2.5 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/20"
        >
          {toCall > 0 ? `✅ 콜 (${toCall})` : "✅ 체크"}
        </button>
      </div>
      {canRaise && (
        <div className="flex w-full items-center gap-2">
          <input
            type="range"
            min={minRaise}
            max={maxRaise}
            value={raiseClamped}
            onChange={(e) => setRaiseAmount(Number(e.target.value))}
            className="flex-1 accent-pink-500"
          />
          <button
            type="button"
            onClick={() => onAction({ type: "raise", amount: raiseClamped })}
            className="shrink-0 rounded-xl bg-gradient-to-r from-pink-500 to-amber-500 px-4 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
          >
            🔺 레이즈 {raiseClamped}
          </button>
        </div>
      )}
    </div>
  );
}

export default function ShowMeTheCoinBoard({
  state,
  viewerSeat,
  names,
  opponentConnected,
  onAction,
  onGameEnd,
}: ShowMeTheCoinBoardProps) {
  const opponentSeat = otherSeat(viewerSeat);
  const { timeLeft } = useCountdown(SHOWDOWN_SECONDS, state.lastRoundResult?.roundNumber ?? 0, state.phase === "showdown");
  const [rulebookOpen, setRulebookOpen] = useState(false);

  const iHaveCommitted = state.committed[viewerSeat] !== undefined;

  return (
    <div
      className="flex flex-col gap-4 rounded-2xl border border-pink-500/20 p-4 sm:p-6"
      style={{ background: "radial-gradient(ellipse at top, #1a0b12 0%, #05030a 60%, #000 100%)" }}
    >
      <div className="flex items-center justify-between text-xs text-white/40">
        <span>ROUND {state.round}</span>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-pink-400/30 px-2 py-0.5 text-pink-200">쇼 미 더 코인</span>
          <button
            type="button"
            onClick={() => setRulebookOpen(true)}
            className="rounded-full border border-white/15 px-2 py-0.5 text-white/60 transition hover:border-white/30 hover:text-white"
          >
            📖 룰북
          </button>
        </div>
      </div>

      <div className="flex items-stretch gap-3">
        <PlayerPanel
          name={names[viewerSeat]}
          stack={state.stacks[viewerSeat]}
          isDealer={state.dealerSeat === viewerSeat}
          isViewer
          isActing={state.phase === "betting" && state.actingSeat === viewerSeat}
          connected
        />
        <div className="flex flex-col items-center justify-center px-1">
          <VaultPot pot={state.pot} />
        </div>
        <PlayerPanel
          name={names[opponentSeat]}
          stack={state.stacks[opponentSeat]}
          isDealer={state.dealerSeat === opponentSeat}
          isViewer={false}
          isActing={state.phase === "betting" && state.actingSeat === opponentSeat}
          connected={opponentConnected}
        />
      </div>

      {state.phase === "commit" && (
        <>
          {iHaveCommitted ? (
            <p className="text-center text-sm text-white/50">🔒 배치 완료 — 상대방을 기다리는 중...</p>
          ) : (
            <CommitControls stack={state.stacks[viewerSeat]} onCommit={(amount) => onAction({ type: "commit", seat: viewerSeat, amount })} />
          )}
        </>
      )}

      {state.phase === "betting" &&
        (state.actingSeat === viewerSeat ? (
          <BettingControls state={state} seat={viewerSeat} onAction={onAction} />
        ) : (
          <p className="text-center text-sm text-white/50">⏳ 상대방이 베팅을 고민하는 중...</p>
        ))}

      {(state.phase === "showdown" || state.phase === "gameOver") && state.lastRoundResult && (
        <ShowdownOverlay
          result={state.lastRoundResult}
          isGameOver={state.phase === "gameOver"}
          gameLoserSeat={state.winner ? otherSeat(state.winner) : null}
          names={names}
          viewerSeat={viewerSeat}
          timeLeft={timeLeft}
          secondsTotal={SHOWDOWN_SECONDS}
          onSkip={() => {
            if (state.phase === "gameOver") onGameEnd(state.winner);
            else onAction({ type: "continue" });
          }}
        />
      )}

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
    </div>
  );
}
