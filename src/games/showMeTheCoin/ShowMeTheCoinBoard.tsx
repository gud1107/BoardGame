"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Avatar from "@/components/common/Avatar";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import {
  commitRange,
  convertedChipTotal,
  isSeatAllIn,
  otherSeat,
  STARTING_CHIPS,
  type CoinToken,
  type CoinValue,
  type EngineAction,
  type Seat,
  type ShowMeTheCoinState,
} from "./engine";
import ShowdownOverlay, { AllInEmblem, BetBadge, CoinBlastSlam, VaultPot } from "./ShowMeTheCoinEffects";
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
  betThisStreet,
  betPulseKey,
}: {
  name: string;
  chips: number;
  coinsRemaining: number;
  isDealer: boolean;
  isViewer: boolean;
  isActing: boolean;
  connected: boolean;
  /** This betting street's live commitment (§2 `betsThisRound[seat]`) — the rebuild request's "상대방 베팅 코인[칩] 수량 실시간 표시". 0 renders no badge. */
  betThisStreet: number;
  /** Bumped by the caller every time `betThisStreet` grows, so `BetBadge`'s pop animation replays on each raise/call, not just once. */
  betPulseKey: number;
}) {
  return (
    <div
      className={`relative flex flex-1 flex-col items-center gap-1.5 rounded-2xl border p-3 transition ${
        isActing ? "border-pink-400/70 bg-pink-500/10 shadow-[0_0_20px_-4px_rgba(244,114,182,0.6)]" : "border-white/10 bg-white/[0.03]"
      }`}
    >
      {betThisStreet > 0 && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <BetBadge amount={betThisStreet} pulseKey={betPulseKey} />
        </div>
      )}
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

/**
 * Private per-viewer stats HUD — the rebuild request's "본인 전용 실시간 칩
 * 환산 통계 자료 HUD". Only ever reads `viewerState`'s OWN remaining coins
 * (never the opponent's — info fairness, same principle as engine.ts's
 * `scoreMove`), and is only ever mounted for the viewer's own seat by the
 * caller — never rendered for the opponent. Formula confirmed via
 * `AskUserQuestion` (see engine.ts's `convertedChipTotal` doc): 코인 = all
 * remaining coins; 남은코인 500제외 = that count minus how many are
 * 500-value; 환산후총칩 = 남은코인 500제외 ÷ 20, to 1 decimal place.
 */
function ChipStatsPanel({ coins }: { coins: CoinToken[] }) {
  const totalCoins = coins.length;
  const count500 = coins.filter((c) => c.value === 500).length;
  const remainingAfter500 = totalCoins - count500;
  const converted = convertedChipTotal(remainingAfter500);

  return (
    <div className="flex flex-col gap-1 self-end rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-right text-[11px] backdrop-blur-md sm:text-xs" style={{ wordBreak: "keep-all" }}>
      <span className="mb-0.5 text-[9px] font-medium tracking-wide text-white/40 uppercase sm:text-[10px]">나만 보는 칩 환산 통계</span>
      <span className="text-white/70">
        코인 : <span className="font-bold text-yellow-200 tabular-nums">{totalCoins}</span>개
      </span>
      <span className="text-white/70">
        남은코인 500제외 <span className="font-bold text-yellow-200 tabular-nums">{remainingAfter500}</span>개
      </span>
      <span className="text-white/70">
        환산후총칩 : <span className="font-bold text-amber-200 tabular-nums">{converted.toFixed(1)}</span>개
      </span>
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
  const maxRaise = already + stack; // no-limit — full remaining stack (all-in), no artificial cap (see engine.ts's module doc addendum)
  const [raiseAmount, setRaiseAmount] = useState(minRaise);
  const raiseClamped = Math.min(Math.max(raiseAmount, minRaise), Math.max(minRaise, maxRaise));
  const isAllInRaise = raiseClamped === maxRaise;

  // No-limit rebuild request's "+1/+5/+10/MAX 퀵버튼" — each nudges from the
  // CURRENT clamped value (not from minRaise) so repeated taps stack, same
  // convention as every quantity stepper elsewhere in this project.
  function bump(delta: number) {
    setRaiseAmount((prev) => Math.min(Math.max(prev, minRaise) + delta, maxRaise));
  }

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
          onClick={() => {
            getSoundEngine().unlock(); // best-effort — same "unlock from inside the actual gesture that needs sound" convention as Dalmuti/Perudo's own action buttons
            onAction({ type: "call" });
          }}
          className="flex-1 rounded-xl border border-emerald-400/40 bg-emerald-500/10 py-2.5 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/20"
        >
          {toCall > 0 ? `✅ 콜 (${toCall})` : "✅ 체크"}
        </button>
      </div>
      {canRaise && (
        <div className="flex w-full flex-col items-center gap-2">
          <div className="flex w-full items-center gap-2">
            <input
              type="range"
              min={minRaise}
              max={maxRaise}
              value={raiseClamped}
              onChange={(e) => setRaiseAmount(Number(e.target.value))}
              className="flex-1 accent-pink-500"
            />
            <input
              type="number"
              min={minRaise}
              max={maxRaise}
              value={raiseClamped}
              onChange={(e) => setRaiseAmount(Number(e.target.value) || minRaise)}
              className="w-16 shrink-0 rounded-lg border border-white/15 bg-white/5 px-1.5 py-1 text-center text-sm font-bold text-white tabular-nums focus:border-pink-400 focus:outline-none"
            />
          </div>
          <div className="flex w-full gap-1.5">
            {[1, 5, 10].map((step) => (
              <button
                key={step}
                type="button"
                onClick={() => bump(step)}
                disabled={raiseClamped >= maxRaise}
                className="flex-1 rounded-lg border border-white/15 py-1.5 text-xs font-semibold text-white/70 transition hover:border-amber-400/50 hover:text-amber-200 disabled:opacity-30"
              >
                +{step}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setRaiseAmount(maxRaise)}
              className="flex-1 rounded-lg border border-rose-400/40 bg-rose-500/10 py-1.5 text-xs font-bold text-rose-200 transition hover:bg-rose-500/20"
            >
              MAX
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              getSoundEngine().unlock(); // best-effort — see the call button's matching comment above
              onAction({ type: "raise", amount: raiseClamped });
            }}
            className={`w-full rounded-xl py-2.5 text-sm font-bold text-black transition hover:brightness-110 ${
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

  // Heavy bet/raise FX (§4.2/§4.4 rebuild request's "Coin Blast Slam") + each
  // seat's live bet-badge pop, both driven off the SAME `betsThisRound`
  // growth so a bet/raise/call always triggers exactly one blast+badge pair.
  // `betsThisRound` (unlike `pot`) never moves for an ante (see engine.ts's
  // `applyAnte` — it only touches `chips`/`pot`/`totalBet`), so this can
  // never mis-fire the heavy FX on a mere round-start ante.
  const prevBetsRef = useRef(state.betsThisRound);
  const blastKeyRef = useRef(0);
  const [betPulse, setBetPulse] = useState<Record<Seat, number>>({ p1: 0, p2: 0 });
  const [blastFx, setBlastFx] = useState<{ seat: Seat; amount: number; intensity: number; key: number } | null>(null);
  const [shakeMag, setShakeMag] = useState(0);
  useEffect(() => {
    const prev = prevBetsRef.current;
    if (state.phase === "betting") {
      (["p1", "p2"] as const).forEach((seat) => {
        const delta = state.betsThisRound[seat] - prev[seat];
        if (delta > 0) {
          setBetPulse((p) => ({ ...p, [seat]: p[seat] + 1 }));
          const intensity = isSeatAllIn(state, seat) ? 1 : Math.max(0.15, Math.min(1, delta / STARTING_CHIPS));
          blastKeyRef.current += 1;
          setBlastFx({ seat, amount: delta, intensity, key: blastKeyRef.current });
          setShakeMag(3 + intensity * 11);
          getSoundEngine().playSmtcCoinBlastSlam(intensity);
        }
      });
    }
    prevBetsRef.current = state.betsThisRound;
  }, [state]);
  useEffect(() => {
    if (shakeMag <= 0) return;
    const t = setTimeout(() => setShakeMag(0), 400);
    return () => clearTimeout(t);
  }, [shakeMag]);

  const iHaveCommitted = state.committed[viewerSeat] !== undefined;

  return (
    <div
      className="relative flex flex-col gap-4 rounded-2xl border border-pink-500/20 p-4 sm:p-6"
      style={
        {
          background: "radial-gradient(ellipse at top, #1a0b12 0%, #05030a 60%, #000 100%)",
          animation: shakeMag > 0 ? "smtc-board-shake 0.4s ease-out both" : undefined,
          "--shake-mag": `${shakeMag}px`,
        } as CSSProperties
      }
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

      {/* Private per-viewer HUD — never rendered for the opponent (see `ChipStatsPanel`'s doc). */}
      <ChipStatsPanel coins={state.coins[viewerSeat]} />

      <div className="flex items-stretch gap-3">
        <PlayerPanel
          name={names[viewerSeat]}
          chips={state.chips[viewerSeat]}
          coinsRemaining={state.coins[viewerSeat].length}
          isDealer={state.dealerSeat === viewerSeat}
          isViewer
          isActing={state.phase === "betting" && state.actingSeat === viewerSeat}
          connected
          betThisStreet={state.betsThisRound[viewerSeat]}
          betPulseKey={betPulse[viewerSeat]}
        />
        <div className="flex flex-col items-center justify-center gap-1.5 px-1">
          <VaultPot pot={state.pot} clinkPulse={clinkPulse} />
          {state.phase === "betting" && (state.betsThisRound.p1 > 0 || state.betsThisRound.p2 > 0) && (
            <div className="flex items-center gap-1.5">
              <BetBadge amount={state.betsThisRound[viewerSeat]} pulseKey={betPulse[viewerSeat]} size="sm" />
              <BetBadge amount={state.betsThisRound[opponentSeat]} pulseKey={betPulse[opponentSeat]} size="sm" />
            </div>
          )}
        </div>
        <PlayerPanel
          name={names[opponentSeat]}
          chips={state.chips[opponentSeat]}
          coinsRemaining={state.coins[opponentSeat].length}
          isDealer={state.dealerSeat === opponentSeat}
          isViewer={false}
          isActing={state.phase === "betting" && state.actingSeat === opponentSeat}
          connected={opponentConnected}
          betThisStreet={state.betsThisRound[opponentSeat]}
          betPulseKey={betPulse[opponentSeat]}
        />
      </div>

      {blastFx && (
        <CoinBlastSlam
          key={blastFx.key}
          fromSide={blastFx.seat === viewerSeat ? "left" : "right"}
          amount={blastFx.amount}
          intensity={blastFx.intensity}
          // Guard against a stale timer clearing a NEWER blast that replaced this one before this instance's own onDone fired (e.g. two bets landing within 750ms of each other).
          onDone={() => setBlastFx((cur) => (cur?.key === blastFx.key ? null : cur))}
        />
      )}

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
