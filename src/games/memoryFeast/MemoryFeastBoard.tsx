"use client";

import { useEffect, useMemo, useState } from "react";
import Tooltip from "@/components/Tooltip";
import RulebookModal from "./RulebookModal";
import {
  DIFFICULTY_CONFIG,
  other,
  plateTotal,
  type EngineAction,
  type MemoryFeastState,
  type Seat,
} from "./engine";

/**
 * Pure game UI + rules driver — the caller (`MemoryFeastGame`, which owns
 * the Supabase Realtime sync) fully controls `state`; this component only
 * ever emits intent via `onAction`/`onGameEnd`, same convention as every
 * other lockstep game here (see hanamikoji's `HanamikojiBoard.tsx`).
 */
export interface MemoryFeastBoardProps {
  state: MemoryFeastState;
  viewerRole: Seat;
  names: Record<Seat, string>;
  ids: Record<Seat, string>;
  opponentConnected: boolean;
  onAction: (action: EngineAction) => void;
  onGameEnd: (winnerId: string) => void;
}

const TABLE_PANEL =
  "relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-[#1c1c1e] via-[#121214] to-[#050506] shadow-[0_0_60px_-20px_rgba(0,0,0,0.9)]";

function TableTexture() {
  return (
    <div
      className="pointer-events-none absolute inset-0 opacity-[0.05]"
      style={{ backgroundImage: "radial-gradient(#fff 1px, transparent 1px)", backgroundSize: "16px 16px" }}
    />
  );
}

function StockBar({ label, value, max, accent }: { label: string; value: number; max: number; accent: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="flex flex-1 flex-col gap-1">
      <div className="flex items-center justify-between text-[11px] text-white/60">
        <span>{label}</span>
        <span className="font-semibold text-white">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: accent }} />
      </div>
    </div>
  );
}

/** One plate tile — its rendered face depends entirely on `viewerRole`'s own knowledge of it. */
function PlateTile({
  index,
  total,
  known,
  selfCount,
  selectable,
  selected,
  flashing,
  flashAmount,
  onClick,
}: {
  index: number;
  total: number;
  known: boolean;
  selfCount: number;
  selectable: boolean;
  selected: boolean;
  flashing: boolean;
  flashAmount: number | null;
  onClick: () => void;
}) {
  const tooltip = known
    ? `접시 ${index + 1} · 실제 총합 ${total}개`
    : selfCount > 0
      ? `접시 ${index + 1} · 내가 넣은 개수 ${selfCount}개 (+ 상대가 넣은 개수는 비공개)`
      : `접시 ${index + 1} · 아직 아무것도 모릅니다`;
  return (
    <Tooltip text={tooltip}>
      <button
        type="button"
        onClick={onClick}
        disabled={!selectable}
        className={`relative flex aspect-square w-full flex-col items-center justify-center gap-0.5 rounded-xl border-2 text-xs font-semibold transition ${
          selected
            ? "-translate-y-1 border-amber-300 bg-amber-400/20 text-amber-100 shadow-[0_0_0_3px_rgba(251,191,36,0.35)]"
            : known
              ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-100"
              : selfCount > 0
                ? "border-sky-400/40 bg-sky-500/10 text-sky-100"
                : "border-white/10 bg-white/5 text-white/40"
        } ${selectable ? "cursor-pointer hover:border-white/40" : "cursor-default"}`}
      >
        <span className="absolute left-1 top-1 text-[9px] text-white/30">{index + 1}</span>
        {flashing ? (
          <span className="absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-rose-500/90 text-white shadow-[0_0_16px_rgba(244,63,94,0.8)]">
            <span className="text-[9px]">상대가 넣음</span>
            <span className="text-lg font-bold">+{flashAmount}</span>
          </span>
        ) : known ? (
          <span className="text-lg">{total}</span>
        ) : selfCount > 0 ? (
          <span className="text-sm">
            {selfCount}
            <span className="text-white/30">+?</span>
          </span>
        ) : (
          <span className="text-lg text-white/25">?</span>
        )}
      </button>
    </Tooltip>
  );
}

export default function MemoryFeastBoard({
  state,
  viewerRole,
  names,
  ids,
  opponentConnected,
  onAction,
  onGameEnd,
}: MemoryFeastBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const opponentRole = other(viewerRole);
  const cfg = DIFFICULTY_CONFIG[state.difficulty];

  // --- Opponent placement flash: shown the instant a new flash targets me,
  // auto-hidden after the difficulty's flash duration. The "show" half is
  // derived during render (compare-and-setState, same pattern as the
  // selection-reset below and hanamikoji's `selectionForKey`) rather than in
  // an effect, so only the "hide after a delay" half — a genuine subscription
  // to the passage of time — needs an effect at all. ---
  const currentFlashSeq = state.lastFlash && state.lastFlash.seat !== viewerRole ? state.lastFlash.seq : null;
  const [visibleFlashSeq, setVisibleFlashSeq] = useState<number | null>(null);
  const [flashTrackedSeq, setFlashTrackedSeq] = useState<number | null>(null);
  if (currentFlashSeq !== null && currentFlashSeq !== flashTrackedSeq) {
    setFlashTrackedSeq(currentFlashSeq);
    setVisibleFlashSeq(currentFlashSeq);
  }
  useEffect(() => {
    if (visibleFlashSeq === null) return;
    const timer = window.setTimeout(() => setVisibleFlashSeq(null), cfg.flashDurationMs);
    return () => window.clearTimeout(timer);
  }, [visibleFlashSeq, cfg.flashDurationMs]);

  // --- Guess selection (open phase): reset whenever a new guess turn starts. ---
  const [selected, setSelected] = useState<number[]>([]);
  const [selectionForSeq, setSelectionForSeq] = useState(state.guessSeq);
  if (state.guessSeq !== selectionForSeq) {
    setSelectionForSeq(state.guessSeq);
    setSelected([]);
  }

  // --- Cosmetic per-turn countdown bar (open phase). Purely visual — the
  // authoritative timeout dispatch lives in MemoryFeastGame.tsx, keyed off
  // the same `guessSeq`, so both stay anchored to the same logical turn.
  // The reset-to-full-bar half is derived during render (same pattern as
  // above); the effect only ever ticks the countdown down inside its own
  // interval callback. ---
  const [remainingMs, setRemainingMs] = useState(cfg.timeLimitMs);
  const [countdownForSeq, setCountdownForSeq] = useState(state.guessSeq);
  if (state.phase === "open" && state.guessSeq !== countdownForSeq) {
    setCountdownForSeq(state.guessSeq);
    setRemainingMs(cfg.timeLimitMs);
  }
  useEffect(() => {
    if (state.phase !== "open") return;
    const start = Date.now();
    const limit = cfg.timeLimitMs;
    const interval = window.setInterval(() => {
      setRemainingMs(Math.max(0, limit - (Date.now() - start)));
    }, 250);
    return () => window.clearInterval(interval);
  }, [state.guessSeq, state.phase, cfg.timeLimitMs]);

  const myTurnToPlace = state.phase === "placement" && state.activePlacer === viewerRole;
  const myTurnToGuess = state.phase === "open" && state.activeGuesser === viewerRole;

  function togglePlateSelection(index: number) {
    if (!myTurnToGuess) return;
    setSelected((prev) => {
      if (prev.includes(index)) return prev.filter((i) => i !== index);
      if (prev.length >= 2) return prev;
      return [...prev, index];
    });
  }

  function confirmGuess() {
    if (selected.length !== 2) return;
    onAction({ type: "guess", plateA: selected[0], plateB: selected[1] });
  }

  const rulebookButton = (
    <button
      onClick={() => setRulebookOpen(true)}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
    >
      📖 룰북
    </button>
  );

  const connectionBanner = !opponentConnected && (
    <div className="rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
      ⚠️ {names[opponentRole]}님의 연결이 끊겼습니다. 창을 닫지 말고 잠시 기다려주세요.
    </div>
  );

  const plateGridClass = useMemo(() => {
    const n = state.plates.length;
    const cols = n <= 12 ? "grid-cols-4" : n <= 16 ? "grid-cols-4 sm:grid-cols-4" : "grid-cols-5 sm:grid-cols-5";
    return `grid gap-2 ${cols}`;
  }, [state.plates.length]);

  if (state.phase === "match-end" && state.winner) {
    const winnerName = names[state.winner];
    const iWon = state.winner === viewerRole;
    return (
      <div className={`${TABLE_PANEL} flex flex-col items-center gap-6 p-10 text-center`}>
        <TableTexture />
        <span className="relative z-10 text-5xl">{iWon ? "🏆" : "🍽️"}</span>
        <h2 className="relative z-10 text-2xl font-bold text-white">{winnerName}님 승리!</h2>
        <p className="relative z-10 text-sm text-white/60">
          {state.loseReason === "stock"
            ? "저장고를 먼저 모두 비웠습니다."
            : `${names[other(state.winner)]}님의 매칭 실패 벌점이 임계치에 도달했습니다.`}
        </p>
        <button
          onClick={() => onGameEnd(ids[state.winner!])}
          className="relative z-10 rounded-full bg-emerald-500 px-8 py-3 font-medium text-white transition hover:bg-emerald-400"
        >
          결과 확정하고 계속하기
        </button>
      </div>
    );
  }

  const stockMax = Math.max(state.stock.p1, state.stock.p2, 1);

  return (
    <div className={`${TABLE_PANEL} flex flex-col gap-4 p-3 sm:p-4`}>
      <TableTexture />
      <div className="relative z-10 flex flex-col gap-4">
        <div className="flex items-center justify-between text-xs text-white/50">
          <span>
            {state.phase === "placement"
              ? `배치 ${state.round}/${cfg.totalRounds}라운드`
              : "오픈(맞히기) 단계"}
          </span>
          {rulebookButton}
        </div>

        {connectionBanner}

        <div className="flex gap-3">
          <StockBar label={`${names.p1} 저장고`} value={state.stock.p1} max={stockMax} accent="#f43f5e" />
          <StockBar label={`${names.p2} 저장고`} value={state.stock.p2} max={stockMax} accent="#38bdf8" />
        </div>
        <div className="flex justify-center gap-4 text-[11px] text-white/50">
          <span>{names.p1} 벌점 {state.penalties.p1}/{cfg.penaltyLossThreshold}</span>
          <span>{names.p2} 벌점 {state.penalties.p2}/{cfg.penaltyLossThreshold}</span>
        </div>

        {state.phase === "open" && (
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-amber-400 transition-[width] duration-200 ease-linear"
              style={{ width: `${(remainingMs / cfg.timeLimitMs) * 100}%` }}
            />
          </div>
        )}

        <div className={plateGridClass}>
          {state.plates.map((plate, i) => {
            const known = plate.revealedTo[viewerRole];
            const selfCount = viewerRole === "p1" ? plate.p1Count : plate.p2Count;
            const flashing =
              visibleFlashSeq !== null && state.lastFlash?.seq === visibleFlashSeq && state.lastFlash?.plateIndex === i;
            return (
              <PlateTile
                key={i}
                index={i}
                total={plateTotal(plate)}
                known={known}
                selfCount={selfCount}
                selectable={myTurnToPlace || myTurnToGuess}
                selected={selected.includes(i)}
                flashing={flashing}
                flashAmount={state.lastFlash?.amount ?? null}
                onClick={() => (myTurnToPlace ? onAction({ type: "place", plateIndex: i }) : togglePlateSelection(i))}
              />
            );
          })}
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-center">
          {state.phase === "placement" ? (
            myTurnToPlace ? (
              <p className="text-sm text-white/70">
                내 차례예요 — 이번 라운드 토큰 <span className="font-bold text-amber-300">{state.round}개</span>를
                올릴 접시를 골라주세요.
              </p>
            ) : (
              <p className="text-sm text-white/50">{names[state.activePlacer!]}님이 배치 중입니다...</p>
            )
          ) : myTurnToGuess ? (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm text-white/70">
                접시 2개를 골라 맞혀보세요 ({selected.length}/2 선택됨)
              </p>
              <button
                disabled={selected.length !== 2}
                onClick={confirmGuess}
                className="w-full max-w-xs rounded-xl bg-emerald-500 py-2.5 font-medium text-white transition disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
              >
                매칭 시도
              </button>
            </div>
          ) : (
            <p className="text-sm text-white/50">{names[state.activeGuesser!]}님이 맞히는 중입니다...</p>
          )}
        </div>
      </div>

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
    </div>
  );
}
