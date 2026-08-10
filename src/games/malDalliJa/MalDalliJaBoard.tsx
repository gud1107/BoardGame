"use client";

import { useEffect, useState } from "react";
import RulebookModal from "./RulebookModal";
import {
  BOARD_SIZE,
  OASIS,
  getLegalMoves,
  otherSeat,
  positionsEqual,
  type EngineAction,
  type LegalMove,
  type MalDalliJaState,
  type Seat,
} from "./engine";

/**
 * Pure game UI + rules driver — knows nothing about betting, IndexedDB, or
 * networking. State is fully controlled by the caller (`MalDalliJaGame`,
 * which owns the Supabase Realtime sync): this component only ever emits
 * intent via `onAction`/`onGameEnd`, never mutates state itself.
 *
 * `turnTimerSec` is the room's optional §5 "착수 시간 제한" house rule
 * setting (null = disabled) — see the timer effect below and the trust-model
 * note in `engine.ts`'s module doc for why the countdown lives here instead
 * of in the engine.
 */
export interface MalDalliJaBoardProps {
  state: MalDalliJaState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  ids: Record<Seat, string>;
  opponentConnected: boolean;
  turnTimerSec: number | null;
  onAction: (action: EngineAction) => void;
  onGameEnd: (winnerId: string) => void;
}

const SEAT_THEME: Record<Seat, { name: string; emoji: string; glow: string; ring: string; text: string }> = {
  p1: { name: "흑마", emoji: "🐴", glow: "shadow-[0_0_18px_4px_rgba(244,63,94,0.55)]", ring: "border-rose-400", text: "text-rose-300" },
  p2: { name: "백마", emoji: "🐎", glow: "shadow-[0_0_18px_4px_rgba(34,211,238,0.55)]", ring: "border-cyan-300", text: "text-cyan-200" },
};

function cellKey(row: number, col: number) {
  return `${row}-${col}`;
}

export default function MalDalliJaBoard({
  state,
  viewerSeat,
  names,
  ids,
  opponentConnected,
  turnTimerSec,
  onAction,
  onGameEnd,
}: MalDalliJaBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const opponentSeat = otherSeat(viewerSeat);
  const isMyTurn = state.phase === "playing" && state.activeSeat === viewerSeat;

  const legalMoves: LegalMove[] = isMyTurn ? getLegalMoves(state) : [];
  const legalByCell = new Map<string, LegalMove>();
  for (const move of legalMoves) legalByCell.set(cellKey(move.to.row, move.to.col), move);

  // ---- §5 optional turn timer: a plain local countdown, reset every time
  // it becomes a new turn. Only the seat whose turn it actually is sends
  // the resulting `pass` — see engine.ts's module doc for the trust model.
  const [remainingSec, setRemainingSec] = useState<number | null>(turnTimerSec);
  const [trackedTurn, setTrackedTurn] = useState(state.turnNumber);
  // Reset the countdown the instant a new turn begins, via React's
  // documented "adjust state while rendering" pattern (comparing against a
  // tracked previous value and calling setState conditionally) rather than
  // a synchronous setState at the top of an effect — the latter trips the
  // set-state-in-effect lint rule and causes an extra unnecessary render.
  if (trackedTurn !== state.turnNumber) {
    setTrackedTurn(state.turnNumber);
    setRemainingSec(turnTimerSec);
  }
  useEffect(() => {
    if (turnTimerSec === null || state.phase !== "playing") return;
    const interval = setInterval(() => {
      setRemainingSec((prev) => {
        if (prev === null) return prev;
        const next = prev - 1;
        // Fire `pass` exactly once, on the prev>0 -> next<=0 transition —
        // once remainingSec is clamped to 0 this guard never re-triggers,
        // so no separate "already passed" ref is needed.
        if (prev > 0 && next <= 0 && state.activeSeat === viewerSeat) {
          onAction({ type: "pass" });
        }
        return Math.max(0, next);
      });
    }, 1000);
    return () => clearInterval(interval);
    // Deliberately keyed on turnNumber (not just phase/turnTimerSec) so the
    // interval restarts fresh every turn instead of drifting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.turnNumber, state.phase, turnTimerSec]);

  function handleCellClick(row: number, col: number) {
    if (!isMyTurn) return;
    const move = legalByCell.get(cellKey(row, col));
    if (!move) return;
    onAction({ type: "move", moveKind: move.moveKind, dr: move.dr, dc: move.dc });
  }

  const cells = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const isOasis = row === OASIS.row && col === OASIS.col;
      const move = legalByCell.get(cellKey(row, col));
      const horseSeat: Seat | null = positionsEqual(state.positions.p1, { row, col })
        ? "p1"
        : positionsEqual(state.positions.p2, { row, col })
          ? "p2"
          : null;

      cells.push(
        <button
          key={cellKey(row, col)}
          type="button"
          disabled={!move}
          onClick={() => handleCellClick(row, col)}
          className={`relative aspect-square border border-white/[0.06] transition ${
            isOasis ? "bg-amber-500/10" : (row + col) % 2 === 0 ? "bg-white/[0.02]" : "bg-black/20"
          } ${move ? "cursor-pointer" : "cursor-default"}`}
        >
          {isOasis && (
            <span
              className="absolute inset-1 rounded-full border border-amber-400/60 bg-amber-400/20"
              style={{ animation: "maldallija-oasis-pulse 2.2s ease-in-out infinite" }}
            />
          )}
          {isOasis && !horseSeat && (
            <span className="absolute inset-0 grid place-items-center text-[10px] text-amber-300/80 sm:text-xs">🌴</span>
          )}
          {move && (
            <span
              className={`absolute inset-[18%] rounded-full ${
                move.moveKind === "slide"
                  ? "bg-cyan-400/25 ring-1 ring-cyan-300/70"
                  : "bg-fuchsia-400/25 ring-1 ring-fuchsia-300/70"
              }`}
            />
          )}
          {horseSeat && (
            <span
              key={`${horseSeat}-${row}-${col}`}
              className={`absolute inset-[8%] grid place-items-center rounded-full border-2 bg-black/70 text-sm sm:text-lg ${SEAT_THEME[horseSeat].ring} ${SEAT_THEME[horseSeat].glow}`}
              style={{ animation: "maldallija-horse-land 0.35s ease-out" }}
            >
              {SEAT_THEME[horseSeat].emoji}
            </span>
          )}
        </button>,
      );
    }
  }

  return (
    <div className="relative flex flex-col gap-4">
      {/* ---- HUD ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-gradient-to-b from-[#1c0a0e] via-[#12080b] to-[#050203] p-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🐎</span>
          <div>
            <p className="text-sm font-bold text-white">말달리자</p>
            <p className="text-[11px] text-white/40">단판 승부 · 데스게임 하우스 룰</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(["p1", "p2"] as const).map((seat) => (
            <div
              key={seat}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                state.phase === "playing" && state.activeSeat === seat
                  ? `${SEAT_THEME[seat].ring} bg-white/10 ${SEAT_THEME[seat].text}`
                  : "border-white/10 text-white/40"
              }`}
            >
              <span>{SEAT_THEME[seat].emoji}</span>
              <span>{names[seat]}</span>
              {seat === viewerSeat && <span className="text-white/30">(나)</span>}
              {state.phase === "playing" && state.activeSeat === seat && (
                <span className="ml-1 h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
              )}
            </div>
          ))}
          {!opponentConnected && (
            <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-300">
              상대 연결 대기중…
            </span>
          )}
          <button
            onClick={() => setRulebookOpen(true)}
            className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:border-white/30"
          >
            📖 룰북
          </button>
        </div>
      </div>

      {/* ---- Turn timer bar (§5 optional house rule) ---- */}
      {turnTimerSec !== null && state.phase === "playing" && remainingSec !== null && (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-white/5"
          style={remainingSec <= 5 ? { animation: "maldallija-timer-warn 0.6s ease-in-out infinite" } : undefined}
        >
          <div
            className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${
              remainingSec <= 5 ? "bg-rose-500" : "bg-amber-400"
            }`}
            style={{ width: `${Math.max(0, (remainingSec / turnTimerSec) * 100)}%` }}
          />
        </div>
      )}

      {/* ---- Board ---- */}
      <div className="mx-auto grid w-full max-w-xl grid-cols-11 overflow-hidden rounded-xl border border-white/10 bg-black shadow-[0_0_60px_-15px_rgba(244,63,94,0.35)]">
        {cells}
      </div>

      <p className="text-center text-xs text-white/40">
        {isMyTurn
          ? "내 차례입니다 — 하이라이트된 칸으로 말을 이동하세요 (파랑=슬라이드, 자홍=나이트)"
          : `${names[opponentSeat]}의 차례를 기다리는 중…`}
      </p>

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}

      {state.phase === "gameOver" && state.winner && (
        <GameOverOverlay
          amIWinner={state.winner === viewerSeat}
          winnerName={names[state.winner]}
          onConfirm={() => onGameEnd(ids[state.winner as Seat])}
        />
      )}
    </div>
  );
}

function GameOverOverlay({
  amIWinner,
  winnerName,
  onConfirm,
}: {
  amIWinner: boolean;
  winnerName: string;
  onConfirm: () => void;
}) {
  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 p-6 text-center ${
        amIWinner ? "bg-gradient-to-b from-amber-950/95 via-black/95 to-black/95" : "bg-gradient-to-b from-rose-950/95 via-black/95 to-black/95"
      }`}
      style={{ animation: "maldallija-elim-flash 0.5s ease-out" }}
    >
      <div style={{ animation: "maldallija-result-burst 0.6s ease-out" }}>
        {amIWinner ? (
          <>
            <p className="text-5xl">🏆</p>
            <h2 className="mt-3 text-3xl font-black tracking-wider text-amber-300 sm:text-5xl">WINNER</h2>
            <p className="mt-2 text-sm text-amber-100/80">오아시스에 먼저 입성해 생존했습니다.</p>
          </>
        ) : (
          <>
            <p className="text-5xl">💀</p>
            <h2 className="mt-3 text-3xl font-black tracking-wider text-rose-400 sm:text-5xl">ELIMINATED</h2>
            <p className="mt-2 text-sm text-rose-100/70">{winnerName}님이 먼저 오아시스에 입성했습니다.</p>
          </>
        )}
      </div>
      <button
        onClick={onConfirm}
        className="rounded-full bg-white px-8 py-3 text-sm font-semibold text-black transition hover:bg-white/85"
      >
        결과 확정하고 계속하기
      </button>
    </div>
  );
}
