"use client";

import { useState } from "react";
import Avatar from "@/components/common/Avatar";
import { otherSeat, type EngineAction, type LoveWinsAllState, type Seat } from "./engine";
import RevealOverlay, { TensionPot } from "./LoveWinsAllEffects";
import RulebookModal from "./RulebookModal";
import { useCountdown } from "./useCountdown";

/** Request's "선택 공개 및 생사 판정 연출 최소 3초 유지" — confirmed length of the reveal before the host auto-advances (see `LoveWinsAllGame.tsx`'s matching `setTimeout`), same length for an ordinary tie's replay countdown and the final gameOver reveal. */
export const REVEAL_SECONDS = 3;

/**
 * Controlled component (ARCHITECTURE.md §2) — reads `state` only via props,
 * translates every tap into an `EngineAction` via `onAction`. Knows nothing
 * about the network/betting layer; `LoveWinsAllGame.tsx` is the only place
 * that broadcasts actions or reports `onGameEnd` to the betting system.
 */
export interface LoveWinsAllBoardProps {
  state: LoveWinsAllState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  opponentConnected: boolean;
  onAction: (action: EngineAction) => void;
  onGameEnd: (winnerSeat: Seat | null) => void;
}

function PlayerPanel({
  name,
  isViewer,
  hasChosen,
  connected,
}: {
  name: string;
  isViewer: boolean;
  hasChosen: boolean;
  connected: boolean;
}) {
  return (
    <div
      className={`flex flex-1 flex-col items-center gap-1.5 rounded-2xl border p-3 transition ${
        hasChosen ? "border-pink-400/70 bg-pink-500/10 shadow-[0_0_20px_-4px_rgba(244,114,182,0.6)]" : "border-white/10 bg-white/[0.03]"
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
      <span className="text-[10px] font-medium text-pink-200">{hasChosen ? "🔒 선택 완료" : "고민 중..."}</span>
    </div>
  );
}

function ChoiceControls({ onChoose }: { onChoose: (choice: "LOVE" | "WAR") => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-pink-400/30 bg-black/40 p-4">
      <p className="text-center text-xs text-white/60">가림판 뒤에서 이번 판의 선택을 정하세요</p>
      <div className="flex w-full gap-3">
        <button
          type="button"
          onClick={() => onChoose("LOVE")}
          className="flex flex-1 flex-col items-center gap-1 rounded-xl border border-emerald-400/40 bg-emerald-500/10 py-4 text-sm font-bold text-emerald-200 transition hover:bg-emerald-500/20 active:scale-95"
        >
          <span className="text-2xl">💚</span>
          LOVE
        </button>
        <button
          type="button"
          onClick={() => onChoose("WAR")}
          className="flex flex-1 flex-col items-center gap-1 rounded-xl border border-rose-400/40 bg-rose-500/10 py-4 text-sm font-bold text-rose-200 transition hover:bg-rose-500/20 active:scale-95"
        >
          <span className="text-2xl">⚔️</span>
          WAR
        </button>
      </div>
    </div>
  );
}

export default function LoveWinsAllBoard({ state, viewerSeat, names, opponentConnected, onAction, onGameEnd }: LoveWinsAllBoardProps) {
  const opponentSeat = otherSeat(viewerSeat);
  const { timeLeft } = useCountdown(REVEAL_SECONDS, state.lastRoundResult?.roundNumber ?? 0, state.phase === "reveal" || state.phase === "gameOver");
  const [rulebookOpen, setRulebookOpen] = useState(false);

  const iHaveChosen = state.choices[viewerSeat] !== undefined;

  return (
    <div
      className="flex flex-col gap-4 rounded-2xl border border-pink-500/20 p-4 sm:p-6"
      style={{ background: "radial-gradient(ellipse at top, #1a0510 0%, #05030a 60%, #000 100%)" }}
    >
      <div className="flex items-center justify-between text-xs text-white/40">
        <span>ROUND {state.round}</span>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-pink-400/30 px-2 py-0.5 text-pink-200">러브 윈즈 올</span>
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
        <PlayerPanel name={names[viewerSeat]} isViewer hasChosen={iHaveChosen} connected />
        <div className="flex flex-col items-center justify-center px-1">
          <TensionPot pot={state.pot} />
        </div>
        <PlayerPanel
          name={names[opponentSeat]}
          isViewer={false}
          hasChosen={state.choices[opponentSeat] !== undefined}
          connected={opponentConnected}
        />
      </div>

      {state.phase === "choice" &&
        (iHaveChosen ? (
          <p className="text-center text-sm text-white/50">🔒 선택 완료 — 상대방을 기다리는 중...</p>
        ) : (
          <ChoiceControls onChoose={(choice) => onAction({ type: "choose", seat: viewerSeat, choice })} />
        ))}

      {(state.phase === "reveal" || state.phase === "gameOver") && state.lastRoundResult && (
        <RevealOverlay
          result={state.lastRoundResult}
          isGameOver={state.phase === "gameOver"}
          matchOutcome={state.matchOutcome}
          names={names}
          viewerSeat={viewerSeat}
          timeLeft={timeLeft}
          secondsTotal={REVEAL_SECONDS}
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
