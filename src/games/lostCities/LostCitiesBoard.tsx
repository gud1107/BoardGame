"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Avatar from "@/components/common/Avatar";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import CardFace, { CardBack } from "./CardFace";
import DiscardPile from "./DiscardPile";
import ExpeditionLane from "./ExpeditionLane";
import LostCitiesEffects, { type LostCitiesEffect } from "./LostCitiesEffects";
import ScoreBreakdownModal from "./ScoreBreakdownModal";
import {
  calculateTotalScore,
  canPlayToExpedition,
  COLORS,
  scoreBreakdownForSeat,
  otherSeat,
  type Card,
  type Color,
  type EngineAction,
  type LostCitiesState,
  type Seat,
} from "./engine";

/**
 * Pure game UI + rules driver (ARCHITECTURE.md §1.6) — state is fully
 * controlled by the caller (`LostCitiesGame`, which owns the Supabase
 * Realtime sync). This component only ever emits intent via `onAction`,
 * never mutates state itself, and knows nothing about networking or betting.
 *
 * Interaction model (mobile-first two-tap flow, per the task's "탭 시 유효
 * 탐험로/버림 더미 하이라이트 후 원터치 배치" requirement):
 *  1. Tap a hand card during your own `PLAY_OR_DISCARD` phase to select it —
 *     that card's own-color expedition lane (if `canPlayToExpedition` allows
 *     it right now) and its own-color discard pile both light up as valid
 *     targets.
 *  2. Tap the highlighted lane to play it, or the highlighted discard pile to
 *     discard it. Tapping the already-selected card again deselects it.
 * During your `DRAW` phase, the deck and every legal (non-just-discarded,
 * non-empty) discard pile light up directly — no selection step needed there.
 *
 * 2026-08-31 visual-renewal session: mobile layout intentionally stays the
 * single-screen compressed 5-lane row (`AskUserQuestion`, confirmed) — only
 * the per-lane visuals/HUD (`ExpeditionLane.tsx`) and discard cells
 * (`DiscardPile.tsx`) changed, not this component's overall structure.
 * Action effects (`LostCitiesEffects.tsx`) are driven by a single
 * prev-vs-current `state` diff below, the same pattern as
 * `ratATatCat/RatATatCatBoard.tsx`'s acquisition-flight effect — every
 * viewer (including the non-acting seat, and both seats watching a bot's
 * move) derives the same effects locally from state they already received.
 */
export interface LostCitiesBoardProps {
  state: LostCitiesState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  opponentConnected: boolean;
  onAction: (action: EngineAction) => void;
  onLeave: () => void;
  onRematch: () => void;
}

function ExpeditionRow({
  seat,
  state,
  selectedCard,
  onLaneClick,
  reversed,
  registerLaneRef,
}: {
  seat: Seat;
  state: LostCitiesState;
  selectedCard: Card | null;
  onLaneClick?: (color: Color) => void;
  reversed?: boolean;
  registerLaneRef: (seat: Seat, color: Color, el: HTMLDivElement | null) => void;
}) {
  const colors = reversed ? [...COLORS].reverse() : COLORS;
  return (
    <div className="flex gap-1 sm:gap-1.5">
      {colors.map((color) => {
        const lane = state.expeditions[seat][color];
        const isTarget = !!selectedCard && selectedCard.color === color && !!onLaneClick;
        const legal = isTarget && canPlayToExpedition(state, seat, selectedCard!);
        return (
          <ExpeditionLane
            key={color}
            color={color}
            cards={lane}
            highlight={!!legal}
            onClick={legal ? () => onLaneClick!(color) : undefined}
            laneRef={(el) => registerLaneRef(seat, color, el)}
          />
        );
      })}
    </div>
  );
}

function CenterPiles({
  state,
  canDraw,
  selectedCard,
  onDrawDeck,
  onDiscardPileClick,
  deckRef,
  registerDiscardRef,
}: {
  state: LostCitiesState;
  canDraw: boolean;
  selectedCard: Card | null;
  onDrawDeck: () => void;
  /** Fires for either the DRAW-phase pickup, or the PLAY_OR_DISCARD-phase discard of the selected card. */
  onDiscardPileClick: (color: Color) => void;
  deckRef: (el: HTMLButtonElement | null) => void;
  registerDiscardRef: (color: Color, el: HTMLDivElement | null) => void;
}) {
  const deckClickable = canDraw && state.deck.length > 0;
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-white/10 bg-black/20 p-2 sm:p-3">
      <div className="flex items-center gap-1 sm:gap-2">
        <button
          ref={deckRef}
          type="button"
          disabled={!deckClickable}
          onClick={deckClickable ? onDrawDeck : undefined}
          className={`flex flex-col items-center gap-0.5 rounded-lg p-0.5 transition ${deckClickable ? "ring-2 ring-emerald-400/70" : ""}`}
        >
          <CardBack size="sm" />
          <span className="text-[10px] font-semibold text-white/50">덱 {state.deck.length}</span>
        </button>

        {/* 🗑️ 버림 칸 (Discard Pile) zone — dashed neon frame + label, deliberately
            distinct from the solid-color expedition lanes so it can never be
            mistaken for one (task brief's "High Visibility Discard Area"). */}
        <div className="lc-discard-zone-pulse flex flex-col items-center gap-1 rounded-lg border-2 border-dashed border-rose-400/50 bg-rose-500/5 px-1.5 py-1.5 sm:px-2">
          <span className="whitespace-nowrap text-[8px] font-bold tracking-wide text-rose-300 sm:text-[9px]">🗑️ 버림 칸 · DISCARD</span>
          <div className="flex items-center gap-1 sm:gap-1.5">
            {COLORS.map((color) => {
              const pile = state.discardPiles[color];
              const drawTarget = canDraw && pile.length > 0 && color !== state.justDiscardedColor;
              const discardTarget = !!selectedCard && selectedCard.color === color && !canDraw;
              const clickable = drawTarget || discardTarget;
              return (
                <DiscardPile
                  key={color}
                  color={color}
                  pile={pile}
                  clickable={clickable}
                  faded={canDraw && color === state.justDiscardedColor}
                  onClick={clickable ? () => onDiscardPileClick(color) : undefined}
                  pileRef={(el) => registerDiscardRef(color, el)}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function centerOf(rect: DOMRect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export default function LostCitiesBoard({ state, viewerSeat, names, opponentConnected, onAction, onLeave, onRematch }: LostCitiesBoardProps) {
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const opponentSeat = otherSeat(viewerSeat);
  const isMyTurn = state.phase === "playing" && state.activeSeat === viewerSeat;
  const myPhaseIsPlay = isMyTurn && state.turnPhase === "PLAY_OR_DISCARD";
  const myPhaseIsDraw = isMyTurn && state.turnPhase === "DRAW";

  const hand = state.hands[viewerSeat];
  const selectedCard = myPhaseIsPlay ? hand.find((c) => c.id === selectedCardId) ?? null : null;

  // --- Action-effect anchors (LostCitiesEffects.tsx) --------------------
  const handRowRef = useRef<HTMLDivElement | null>(null);
  const opponentHeaderRef = useRef<HTMLDivElement | null>(null);
  const deckRef = useRef<HTMLButtonElement | null>(null);
  const laneRefs = useRef<Record<Seat, Partial<Record<Color, HTMLDivElement>>>>({ p1: {}, p2: {} });
  const discardRefs = useRef<Partial<Record<Color, HTMLDivElement>>>({});
  const [effects, setEffects] = useState<LostCitiesEffect[]>([]);
  const removeEffect = (id: string) => setEffects((prev) => prev.filter((e) => e.id !== id));

  const prevStateRef = useRef(state);
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (prev === state) return;

    const stamp = state.turnNumber;
    const seatOriginEl = (seat: Seat) => (seat === viewerSeat ? handRowRef.current : opponentHeaderRef.current);

    // 1. A card was just placed onto an expedition lane.
    for (const seat of ["p1", "p2"] as Seat[]) {
      for (const color of COLORS) {
        const before = prev.expeditions[seat][color].length;
        const after = state.expeditions[seat][color].length;
        if (after !== before + 1) continue;
        const fromEl = seatOriginEl(seat);
        const toEl = laneRefs.current[seat]?.[color];
        if (fromEl && toEl) {
          setEffects((list) => [
            ...list,
            { id: `place-${stamp}-${seat}-${color}`, kind: "place", from: centerOf(fromEl.getBoundingClientRect()), to: centerOf(toEl.getBoundingClientRect()) },
          ]);
        }
        getSoundEngine().playGridSnap();
      }
    }

    // 2. A card was just discarded to the center pile.
    for (const color of COLORS) {
      const before = prev.discardPiles[color].length;
      const after = state.discardPiles[color].length;
      if (after !== before + 1) continue;
      const actingSeat = prev.activeSeat; // discard never changes activeSeat
      const fromEl = seatOriginEl(actingSeat);
      const toEl = discardRefs.current[color];
      if (fromEl && toEl) {
        setEffects((list) => [
          ...list,
          { id: `discard-${stamp}-${color}`, kind: "discard", from: centerOf(fromEl.getBoundingClientRect()), to: centerOf(toEl.getBoundingClientRect()) },
        ]);
      }
      getSoundEngine().playCardFlick();
    }

    // 3a. A card was just drawn from the deck.
    if (state.deck.length === prev.deck.length - 1) {
      const actingSeat = prev.activeSeat; // draw-deck flips activeSeat only *after* resolving
      const fromEl = deckRef.current;
      const toEl = seatOriginEl(actingSeat);
      if (fromEl && toEl) {
        setEffects((list) => [
          ...list,
          {
            id: `draw-${stamp}-deck`,
            kind: "draw",
            drawSource: "deck",
            from: centerOf(fromEl.getBoundingClientRect()),
            to: centerOf(toEl.getBoundingClientRect()),
          },
        ]);
      }
      getSoundEngine().playCardDrawWhoosh();
    } else {
      // 3b. A card was just picked up from a discard pile.
      for (const color of COLORS) {
        const before = prev.discardPiles[color].length;
        const after = state.discardPiles[color].length;
        if (after !== before - 1) continue;
        const actingSeat = prev.activeSeat;
        const fromEl = discardRefs.current[color];
        const toEl = seatOriginEl(actingSeat);
        if (fromEl && toEl) {
          setEffects((list) => [
            ...list,
            {
              id: `draw-${stamp}-discard-${color}`,
              kind: "draw",
              drawSource: "discard",
              from: centerOf(fromEl.getBoundingClientRect()),
              to: centerOf(toEl.getBoundingClientRect()),
            },
          ]);
        }
        getSoundEngine().playCardDrawWhoosh();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- viewerSeat is stable for the component's lifetime (a seat never changes mid-game).
  }, [state]);

  function handleHandCardClick(card: Card) {
    if (!myPhaseIsPlay) return;
    setSelectedCardId((prev) => (prev === card.id ? null : card.id));
  }

  function handleLaneClick(color: Color) {
    if (!selectedCard || selectedCard.color !== color) return;
    onAction({ type: "play-expedition", cardId: selectedCard.id });
    setSelectedCardId(null);
  }

  function handleCenterPileClick(color: Color) {
    if (myPhaseIsDraw) {
      onAction({ type: "draw-discard", color });
      return;
    }
    if (selectedCard && selectedCard.color === color) {
      onAction({ type: "discard", cardId: selectedCard.id });
      setSelectedCardId(null);
    }
  }

  function handleDrawDeck() {
    if (!myPhaseIsDraw) return;
    onAction({ type: "draw-deck" });
  }

  const statusText = state.phase === "gameOver" ? "게임 종료" : isMyTurn ? (myPhaseIsPlay ? "내 차례 · 카드를 내거나 버리세요" : "내 차례 · 카드 1장을 보충하세요") : `${names[opponentSeat]}님의 차례`;

  return (
    <div className="flex w-full flex-col gap-2 sm:gap-3">
      <LostCitiesEffects effects={effects} onEffectDone={removeEffect} />

      {/* Opponent header + expeditions */}
      <div ref={opponentHeaderRef} className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-white">
          <Avatar size={24} />
          {names[opponentSeat]}
          {!opponentConnected && <span className="text-[10px] font-normal text-rose-300">(연결 끊김)</span>}
        </span>
        <span className="text-xs text-white/40">손패 {state.hands[opponentSeat].length}장</span>
      </div>
      <ExpeditionRow
        seat={opponentSeat}
        state={state}
        selectedCard={null}
        registerLaneRef={(seat, color, el) => {
          laneRefs.current[seat][color] = el ?? undefined;
        }}
      />

      {/* Center: deck + discard piles */}
      <CenterPiles
        state={state}
        canDraw={myPhaseIsDraw}
        selectedCard={selectedCard}
        onDrawDeck={handleDrawDeck}
        onDiscardPileClick={handleCenterPileClick}
        deckRef={(el) => {
          deckRef.current = el;
        }}
        registerDiscardRef={(color, el) => {
          discardRefs.current[color] = el ?? undefined;
        }}
      />

      {/* My expeditions */}
      <ExpeditionRow
        seat={viewerSeat}
        state={state}
        selectedCard={selectedCard}
        onLaneClick={myPhaseIsPlay ? handleLaneClick : undefined}
        registerLaneRef={(seat, color, el) => {
          laneRefs.current[seat][color] = el ?? undefined;
        }}
      />

      {/* Status + my hand */}
      <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-white">
          <Avatar size={24} />
          {names[viewerSeat]} <span className="text-xs font-normal text-emerald-300">(나)</span>
        </span>
        <span className={`text-xs ${isMyTurn ? "text-emerald-300" : "text-white/40"}`}>{statusText}</span>
      </div>
      <div ref={handRowRef} className="flex flex-wrap justify-center gap-1.5 rounded-xl border border-white/10 bg-black/20 p-2 sm:gap-2 sm:p-3">
        {hand.map((card) => (
          <CardFace key={card.id} card={card} onClick={myPhaseIsPlay ? () => handleHandCardClick(card) : undefined} selected={selectedCardId === card.id} />
        ))}
      </div>

      {state.phase === "gameOver" &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="pointer-events-auto fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-black/80 p-3 sm:p-6">
            <ScoreBreakdownModal
              names={names}
              breakdowns={{ p1: scoreBreakdownForSeat(state, "p1"), p2: scoreBreakdownForSeat(state, "p2") }}
              totals={{ p1: calculateTotalScore(state, "p1"), p2: calculateTotalScore(state, "p2") }}
              winner={state.winner}
              isDraw={state.isDraw}
              viewerSeat={viewerSeat}
              onLeave={onLeave}
              onRematch={onRematch}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
