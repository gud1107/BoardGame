"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Avatar from "@/components/common/Avatar";
import {
  commitRange,
  otherSeat,
  type CoinToken,
  type CoinValue,
  type EngineAction,
  type Seat,
  type ShowMeTheCoinState,
} from "./engine";
import ShowdownOverlay, { AllInEmblem, VaultPot } from "./ShowMeTheCoinEffects";
import RulebookModal from "./RulebookModal";
import { useCountdown } from "./useCountdown";

/** Request's "결과/연출 3초 유지" — confirmed length of the showdown reveal before the host auto-advances (see `ShowMeTheCoinGame.tsx`'s matching `setTimeout`). */
export const SHOWDOWN_SECONDS = 3;

const DENOM_ORDER: CoinValue[] = [500, 100, 50, 10];
const DENOM_STYLE: Record<CoinValue, { ring: string; glow: string }> = {
  500: { ring: "border-amber-300/70", glow: "shadow-[0_0_10px_-1px_rgba(252,211,77,0.7)]" },
  100: { ring: "border-yellow-400/60", glow: "shadow-[0_0_8px_-1px_rgba(250,204,21,0.5)]" },
  50: { ring: "border-orange-300/50", glow: "" },
  10: { ring: "border-white/25", glow: "" },
};

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
  /** `winnerSeat` is `null` for the confirmed-draw edge case (both seats eliminated on a tied round — see engine.ts's `applyKoCheck`). */
  onGameEnd: (winnerSeat: Seat | null) => void;
}

function PlayerPanel({
  name,
  chips,
  coinsRemaining,
  isDealer,
  isViewer,
  isActing,
  connected,
}: {
  name: string;
  chips: number;
  coinsRemaining: number;
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
      <span className="max-w-[100px] truncate text-xs font-semibold text-white/90" style={{ wordBreak: "keep-all" }}>
        {name}
        {isViewer && <span className="text-emerald-300"> (나)</span>}
      </span>
      {isDealer && <span className="rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-200">선공</span>}
      <div className="flex items-center gap-2">
        <span className="text-sm font-black text-amber-100 tabular-nums" title="베팅칩">
          🎰 {chips}
        </span>
        <span className="text-sm font-black text-yellow-200/90 tabular-nums" title="남은 코인">
          🪙 {coinsRemaining}
        </span>
      </div>
      {isActing && <span className="text-[10px] font-medium text-pink-200">고민 중...</span>}
    </div>
  );
}

function CommitControls({ coins, onCommit }: { coins: CoinToken[]; onCommit: (coinIds: string[]) => void }) {
  const { min, max } = commitRange(coins.length);
  const groups = useMemo(() => {
    const byValue = new Map<CoinValue, CoinToken[]>();
    for (const c of coins) byValue.set(c.value, [...(byValue.get(c.value) ?? []), c]);
    return DENOM_ORDER.map((value) => ({ value, tokens: byValue.get(value) ?? [] })).filter((g) => g.tokens.length > 0);
  }, [coins]);
  const [picks, setPicks] = useState<Partial<Record<CoinValue, number>>>({});
  const total = Object.values(picks).reduce<number>((a, b) => a + (b ?? 0), 0);
  const sum = groups.reduce((acc, g) => acc + (picks[g.value] ?? 0) * g.value, 0);

  function adjust(value: CoinValue, delta: number) {
    setPicks((p) => {
      const current = p[value] ?? 0;
      const available = groups.find((g) => g.value === value)?.tokens.length ?? 0;
      const roomLeft = Math.max(0, max - (total - current));
      const next = Math.max(0, Math.min(current + delta, available, roomLeft));
      return { ...p, [value]: next };
    });
  }

  function submit() {
    const ids: string[] = [];
    for (const g of groups) ids.push(...g.tokens.slice(0, picks[g.value] ?? 0).map((t) => t.id));
    onCommit(ids);
  }

  const valid = total >= min && total <= max;

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-pink-400/30 bg-black/40 p-4">
      <p className="text-center text-xs text-white/60" style={{ wordBreak: "keep-all" }}>
        가림판 뒤에서 이번 라운드에 걸 코인을 {min}~{max}개 고르세요 (되찾을 수 없이 영구 소멸됩니다)
      </p>
      <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
        {groups.map((g) => {
          const picked = picks[g.value] ?? 0;
          const style = DENOM_STYLE[g.value];
          return (
            <div key={g.value} className={`flex flex-col items-center gap-1.5 rounded-xl border ${style.ring} bg-white/5 p-2 ${style.glow}`}>
              <span className="text-base font-black text-amber-100 tabular-nums">{g.value}</span>
              <span className="text-[10px] text-white/40">보유 {g.tokens.length}개</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => adjust(g.value, -1)}
                  disabled={picked <= 0}
                  className="h-7 w-7 rounded-full border border-white/15 text-sm text-white/80 disabled:opacity-30"
                >
                  −
                </button>
                <span className="w-5 text-center text-sm font-bold text-white">{picked}</span>
                <button
                  type="button"
                  onClick={() => adjust(g.value, 1)}
                  disabled={picked >= g.tokens.length || total >= max}
                  className="h-7 w-7 rounded-full border border-white/15 text-sm text-white/80 disabled:opacity-30"
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3 text-sm">
        <span className={`font-bold tabular-nums ${valid ? "text-emerald-300" : "text-white/50"}`}>
          {total}/{max}개 선택
        </span>
        <span className="text-white/40">·</span>
        <span className="font-bold text-amber-200 tabular-nums">합계 {sum}</span>
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={!valid}
        className="w-full rounded-xl bg-gradient-to-r from-pink-500 to-amber-500 py-2.5 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-30"
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
  const stack = state.chips[seat];
  const already = state.betsThisRound[seat];
  const toCall = state.currentBet - already;
  const canRaise = stack > toCall;
  const minRaise = Math.max(state.currentBet + 1, already + 1);
  const maxRaise = already + stack;
  const [raiseAmount, setRaiseAmount] = useState(minRaise);
  const raiseClamped = Math.min(Math.max(raiseAmount, minRaise), Math.max(minRaise, maxRaise));
  const isAllInRaise = raiseClamped === maxRaise;

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-amber-400/30 bg-black/40 p-4">
      <p className="text-center text-xs text-white/60" style={{ wordBreak: "keep-all" }}>
        {toCall > 0 ? `상대 베팅 ${state.currentBet}칩 — 콜하려면 ${toCall}칩 필요` : "베팅 없음 — 체크하거나 베팅을 거세요"}
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
            className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-bold text-black transition hover:brightness-110 ${
              isAllInRaise ? "bg-gradient-to-r from-rose-500 to-amber-400" : "bg-gradient-to-r from-pink-500 to-amber-500"
            }`}
          >
            {isAllInRaise ? `🔥 올인 ${raiseClamped}` : `🔺 레이즈 ${raiseClamped}`}
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

  // Chip-clink spark on the vault every time the pot grows (ante/bet/raise/call) — see VaultPot's doc.
  const prevPotRef = useRef(state.pot);
  const [clinkPulse, setClinkPulse] = useState(0);
  useEffect(() => {
    if (state.pot > prevPotRef.current) setClinkPulse((p) => p + 1);
    prevPotRef.current = state.pot;
  }, [state.pot]);

  // ALL-IN emblem whenever a seat's chip stack visibly hits 0 mid-betting (a raise-shove or a call-for-everything both count as "declaring all-in").
  const prevChipsRef = useRef(state.chips);
  const [allInSeat, setAllInSeat] = useState<Seat | null>(null);
  useEffect(() => {
    const prev = prevChipsRef.current;
    if (state.phase === "betting" || state.phase === "showdown") {
      (["p1", "p2"] as const).forEach((seat) => {
        if (prev[seat] > 0 && state.chips[seat] === 0) setAllInSeat(seat);
      });
    }
    prevChipsRef.current = state.chips;
  }, [state.chips, state.phase]);

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
          chips={state.chips[viewerSeat]}
          coinsRemaining={state.coins[viewerSeat].length}
          isDealer={state.dealerSeat === viewerSeat}
          isViewer
          isActing={state.phase === "betting" && state.actingSeat === viewerSeat}
          connected
        />
        <div className="flex flex-col items-center justify-center px-1">
          <VaultPot pot={state.pot} clinkPulse={clinkPulse} />
        </div>
        <PlayerPanel
          name={names[opponentSeat]}
          chips={state.chips[opponentSeat]}
          coinsRemaining={state.coins[opponentSeat].length}
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
            <CommitControls coins={state.coins[viewerSeat]} onCommit={(coinIds) => onAction({ type: "commit", seat: viewerSeat, coinIds })} />
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

      {allInSeat && <AllInEmblem name={names[allInSeat]} onDone={() => setAllInSeat(null)} />}

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
    </div>
  );
}
