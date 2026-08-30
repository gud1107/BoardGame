"use client";

import { useMemo, useState } from "react";
import Avatar from "@/components/common/Avatar";
import {
  declarableHands,
  HAND_CATEGORY_LABEL,
  otherSeat,
  raiseRange,
  SUIT_EMOJI,
  type EngineAction,
  type HandCategory,
  type LoveWinsAllState,
  type Seat,
  type Suit,
} from "./engine";
import RevealOverlay, { ChipPot } from "./LoveWinsAllEffects";
import RulebookModal from "./RulebookModal";
import { useCountdown } from "./useCountdown";

/** Request's "판정 연출 최소 3초 유지" — same length used for both the ordinary tie's next-round countdown and the final KO reveal (see `LoveWinsAllGame.tsx`'s matching host `setTimeout`). */
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

function Card({ suit, size = "md", dim }: { suit: Suit; size?: "sm" | "md" | "lg"; dim?: boolean }) {
  const dims = size === "lg" ? "h-14 w-11 text-2xl" : size === "sm" ? "h-8 w-6 text-sm" : "h-11 w-9 text-lg";
  return (
    <span
      className={`flex flex-col items-center justify-center rounded-lg border ${dims} ${
        dim ? "border-white/10 bg-white/5 opacity-40" : "border-pink-300/30 bg-black/50"
      }`}
    >
      {SUIT_EMOJI[suit]}
    </span>
  );
}

function HiddenCard({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const dims = size === "lg" ? "h-14 w-11 text-xl" : size === "sm" ? "h-8 w-6 text-xs" : "h-11 w-9 text-base";
  return <span className={`flex flex-col items-center justify-center rounded-lg border border-white/10 bg-gradient-to-br from-pink-950 to-black ${dims}`}>🂠</span>;
}

function PlayerHeader({ name, isViewer, chips, connected, pending }: { name: string; isViewer: boolean; chips: number; connected: boolean; pending: boolean }) {
  return (
    <div
      className={`flex flex-1 flex-col items-center gap-1 rounded-2xl border p-2.5 transition ${
        pending ? "border-pink-400/70 bg-pink-500/10 shadow-[0_0_20px_-4px_rgba(244,114,182,0.6)]" : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <div className="relative">
        <Avatar size={36} className={isViewer ? "ring-2 ring-emerald-400/70" : "ring-2 ring-white/10"} />
        {!connected && (
          <span className="absolute -right-1 -bottom-1 text-xs" title="연결 끊김">
            📡
          </span>
        )}
      </div>
      <span className="max-w-[96px] truncate text-xs font-semibold text-white/90">
        {name}
        {isViewer && <span className="text-emerald-300"> (나)</span>}
      </span>
      <span className="text-sm font-bold text-amber-200">🪙 {chips}</span>
    </div>
  );
}

function BettingControls({ state, viewerSeat, onAction }: { state: LoveWinsAllState; viewerSeat: Seat; onAction: (a: EngineAction) => void }) {
  const toCall = state.currentBet - state.betsThisStreet[viewerSeat];
  const range = raiseRange(state, viewerSeat);
  const [raiseAmount, setRaiseAmount] = useState<number>(range?.min ?? 0);
  const clampedRaise = range ? Math.min(Math.max(raiseAmount, range.min), range.max) : 0;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-pink-400/30 bg-black/40 p-4">
      <p className="text-center text-xs text-white/60">
        {toCall > 0 ? `상대 베팅 ${state.currentBet} — 콜하려면 ${toCall}칩 필요` : "베팅할 차례입니다 (체크 가능)"}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onAction({ type: "fold" })}
          className="flex-1 rounded-xl border border-rose-400/40 bg-rose-500/10 py-3 text-sm font-bold text-rose-200 transition hover:bg-rose-500/20 active:scale-95"
        >
          폴드
        </button>
        <button
          type="button"
          onClick={() => onAction({ type: "call" })}
          className="flex-1 rounded-xl border border-emerald-400/40 bg-emerald-500/10 py-3 text-sm font-bold text-emerald-200 transition hover:bg-emerald-500/20 active:scale-95"
        >
          {toCall > 0 ? `콜 (${toCall})` : "체크"}
        </button>
      </div>
      {range && (
        <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-center justify-between text-xs text-white/60">
            <span>레이즈 (노리밋)</span>
            <span className="font-bold text-white/90">{clampedRaise}</span>
          </div>
          <input
            type="range"
            min={range.min}
            max={range.max}
            value={clampedRaise}
            onChange={(e) => setRaiseAmount(Number(e.target.value))}
            className="w-full accent-pink-500"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onAction({ type: "raise", amount: clampedRaise })}
              className="flex-1 rounded-xl bg-gradient-to-r from-pink-500 to-rose-600 py-2.5 text-sm font-semibold text-black transition hover:brightness-110 active:scale-95"
            >
              레이즈 {clampedRaise}
            </button>
            <button
              type="button"
              onClick={() => onAction({ type: "raise", amount: range.max })}
              className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2.5 text-xs font-bold text-amber-200 transition hover:bg-amber-500/20 active:scale-95"
            >
              올인
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DeclareControls({
  state,
  viewerSeat,
  onAction,
}: {
  state: LoveWinsAllState;
  viewerSeat: Seat;
  onAction: (a: EngineAction) => void;
}) {
  const hand = state.hands[viewerSeat];
  const [cardIndex, setCardIndex] = useState(0);
  const [declaredHand, setDeclaredHand] = useState<HandCategory | null>(null);
  const labels = useMemo(() => declarableHands(state.variant), [state.variant]);

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-pink-400/30 bg-black/40 p-4">
      <p className="text-center text-xs text-white/60">공개할 카드 1장을 고르고, 자신의 족보를 선언하세요 (거짓 선언 가능)</p>
      <div className="flex justify-center gap-2">
        {hand.map((suit, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setCardIndex(i)}
            className={`rounded-lg transition ${i === cardIndex ? "scale-110 ring-2 ring-pink-400" : "opacity-70"}`}
          >
            <Card suit={suit} size="lg" />
          </button>
        ))}
      </div>
      <div className="flex flex-wrap justify-center gap-1.5">
        {labels.map((h) => (
          <button
            key={h}
            type="button"
            onClick={() => setDeclaredHand(h)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
              declaredHand === h ? "border-pink-400 bg-pink-500/20 text-pink-100" : "border-white/15 text-white/60 hover:border-white/30"
            }`}
          >
            {HAND_CATEGORY_LABEL[h]}
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={declaredHand === null}
        onClick={() => declaredHand && onAction({ type: "declare", seat: viewerSeat, cardIndex, declaredHand })}
        className="rounded-xl bg-gradient-to-r from-pink-500 to-rose-600 py-3 text-sm font-semibold text-black transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
      >
        선언 확정
      </button>
    </div>
  );
}

export default function LoveWinsAllBoard({ state, viewerSeat, names, opponentConnected, onAction, onGameEnd }: LoveWinsAllBoardProps) {
  const opponentSeat = otherSeat(viewerSeat);
  const { timeLeft } = useCountdown(REVEAL_SECONDS, `${state.round}:${state.lastRoundResult?.roundNumber ?? 0}`, state.phase === "showdown" || state.phase === "gameOver");
  const [rulebookOpen, setRulebookOpen] = useState(false);

  const isBetting = state.phase === "bet1" || state.phase === "bet2";
  const myTurn = isBetting && state.actingSeat === viewerSeat;
  const iHaveDeclared = state.declaredHand[viewerSeat] !== undefined;
  const opponentDeclared = state.declaredHand[opponentSeat];
  const opponentRevealedIdx = state.revealedIndex[opponentSeat];

  return (
    <div
      className="flex flex-col gap-4 rounded-2xl border border-pink-500/20 p-4 sm:p-6"
      style={{ background: "radial-gradient(ellipse at top, #1a0510 0%, #05030a 60%, #000 100%)" }}
    >
      <div className="flex items-center justify-between text-xs text-white/40">
        <span>ROUND {state.round}</span>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-pink-400/30 px-2 py-0.5 text-pink-200">
            {state.variant === "base" ? "러브 윈즈 올" : "러브 윈즈 올 2"}
          </span>
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
        <PlayerHeader name={names[viewerSeat]} isViewer chips={state.chips[viewerSeat]} connected pending={myTurn} />
        <div className="flex flex-col items-center justify-center gap-2 px-1">
          <ChipPot pot={state.pot} />
          {state.community && (
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-[10px] text-white/40">공용 카드</span>
              <Card suit={state.community} size="sm" />
            </div>
          )}
        </div>
        <PlayerHeader
          name={names[opponentSeat]}
          isViewer={false}
          chips={state.chips[opponentSeat]}
          connected={opponentConnected}
          pending={isBetting && state.actingSeat === opponentSeat}
        />
      </div>

      {/* Opponent's hand — face-down until their §4 reveal, then that one slot flips to its true suit. Never shows the other two slots' true suits before showdown, matching the online trust model's UI-side info hiding. */}
      {isBetting || state.phase === "declare" ? (
        <div className="flex flex-col items-center gap-1.5">
          <span className="text-[10px] tracking-wide text-white/40 uppercase">{names[opponentSeat]}의 카드</span>
          <div className="flex items-center gap-2">
            {state.hands[opponentSeat].map((suit, i) =>
              opponentRevealedIdx === i ? <Card key={i} suit={suit} size="sm" /> : <HiddenCard key={i} size="sm" />,
            )}
          </div>
          {opponentDeclared && <span className="text-xs text-white/60">“{HAND_CATEGORY_LABEL[opponentDeclared]}” 라고 선언했습니다</span>}
        </div>
      ) : null}

      <div className="flex flex-col items-center gap-1.5">
        <span className="text-[10px] tracking-wide text-white/40 uppercase">내 카드</span>
        <div className="flex gap-2">
          {state.hands[viewerSeat].map((suit, i) => (
            <Card key={i} suit={suit} size="lg" dim={state.revealedIndex[viewerSeat] !== undefined && state.revealedIndex[viewerSeat] !== i} />
          ))}
        </div>
      </div>

      {isBetting &&
        (myTurn ? (
          <BettingControls state={state} viewerSeat={viewerSeat} onAction={onAction} />
        ) : (
          <p className="text-center text-sm text-white/50">⏳ {names[opponentSeat]}님의 베팅을 기다리는 중...</p>
        ))}

      {state.phase === "declare" &&
        (iHaveDeclared ? (
          <p className="text-center text-sm text-white/50">🔒 선언 완료 — 상대방을 기다리는 중...</p>
        ) : (
          <DeclareControls state={state} viewerSeat={viewerSeat} onAction={onAction} />
        ))}

      {(state.phase === "showdown" || state.phase === "gameOver") && state.lastRoundResult && (
        <RevealOverlay
          result={state.lastRoundResult}
          isGameOver={state.phase === "gameOver"}
          names={names}
          viewerSeat={viewerSeat}
          timeLeft={timeLeft}
          secondsTotal={REVEAL_SECONDS}
          onSkip={() => {
            if (state.phase === "gameOver") onGameEnd(state.winner);
            else onAction({ type: "continue", seed: Math.floor(Math.random() * 1_000_000_000) });
          }}
        />
      )}

      {rulebookOpen && <RulebookModal variant={state.variant} onClose={() => setRulebookOpen(false)} />}
    </div>
  );
}
