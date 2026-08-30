"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import Avatar from "@/components/common/Avatar";
import CardFace, { CardBack } from "./CardFace";
import ScoreBreakdownModal from "./ScoreBreakdownModal";
import {
  calculateTotalScore,
  canPlayToExpedition,
  COLORS,
  EXPEDITION_THEME,
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

function LaneStack({ cards, highlight, onClick, dim }: { cards: Card[]; highlight: boolean; onClick?: () => void; dim?: boolean }) {
  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={onClick}
      className={`flex min-h-[3.5rem] flex-1 items-center gap-[-6px] overflow-x-auto rounded-lg border-2 border-dashed p-1 transition sm:min-h-[4.5rem] ${
        highlight ? "border-emerald-400 bg-emerald-400/10 ring-2 ring-emerald-400/60" : "border-white/10 bg-white/[0.03]"
      } ${dim ? "opacity-60" : ""}`}
    >
      {cards.length === 0 ? (
        <span className="mx-auto text-[10px] text-white/25">비어있음</span>
      ) : (
        <span className="flex -space-x-3">
          {cards.map((c) => (
            <CardFace key={c.id} card={c} size="sm" />
          ))}
        </span>
      )}
    </button>
  );
}

function ExpeditionRow({
  seat,
  state,
  selectedCard,
  onLaneClick,
  reversed,
}: {
  seat: Seat;
  state: LostCitiesState;
  selectedCard: Card | null;
  onLaneClick?: (color: Color) => void;
  reversed?: boolean;
}) {
  const colors = reversed ? [...COLORS].reverse() : COLORS;
  return (
    <div className="flex gap-1 sm:gap-1.5">
      {colors.map((color) => {
        const lane = state.expeditions[seat][color];
        const isTarget = !!selectedCard && selectedCard.color === color && !!onLaneClick;
        const legal = isTarget && canPlayToExpedition(state, seat, selectedCard!);
        return (
          <div key={color} className="flex flex-1 flex-col items-center gap-0.5">
            <span className="text-[9px] text-white/30 sm:text-[10px]">{EXPEDITION_THEME[color].emoji}</span>
            <LaneStack cards={lane} highlight={!!legal} onClick={legal ? () => onLaneClick!(color) : undefined} />
          </div>
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
}: {
  state: LostCitiesState;
  canDraw: boolean;
  selectedCard: Card | null;
  onDrawDeck: () => void;
  /** Fires for either the DRAW-phase pickup, or the PLAY_OR_DISCARD-phase discard of the selected card. */
  onDiscardPileClick: (color: Color) => void;
}) {
  const deckClickable = canDraw && state.deck.length > 0;
  return (
    <div className="flex items-center justify-center gap-1 rounded-xl border border-white/10 bg-black/20 p-2 sm:gap-2 sm:p-3">
      <button
        type="button"
        disabled={!deckClickable}
        onClick={deckClickable ? onDrawDeck : undefined}
        className={`flex flex-col items-center gap-0.5 rounded-lg p-0.5 transition ${deckClickable ? "ring-2 ring-emerald-400/70" : ""}`}
      >
        <CardBack size="sm" />
        <span className="text-[10px] font-semibold text-white/50">덱 {state.deck.length}</span>
      </button>
      {COLORS.map((color) => {
        const pile = state.discardPiles[color];
        const top = pile[pile.length - 1];
        const drawTarget = canDraw && pile.length > 0 && color !== state.justDiscardedColor;
        const discardTarget = !!selectedCard && selectedCard.color === color && !canDraw;
        const clickable = drawTarget || discardTarget;
        return (
          <button
            key={color}
            type="button"
            disabled={!clickable}
            onClick={clickable ? () => onDiscardPileClick(color) : undefined}
            className={`flex flex-col items-center gap-0.5 rounded-lg p-0.5 transition ${
              clickable ? "ring-2 ring-emerald-400/70" : ""
            }`}
          >
            {top ? <CardFace card={top} size="sm" faded={canDraw && color === state.justDiscardedColor} /> : (
              <div className="flex h-12 w-9 items-center justify-center rounded-lg border-2 border-dashed border-white/10 text-[9px] text-white/20 sm:h-14 sm:w-10">
                {EXPEDITION_THEME[color].emoji}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default function LostCitiesBoard({ state, viewerSeat, names, opponentConnected, onAction, onLeave, onRematch }: LostCitiesBoardProps) {
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const opponentSeat = otherSeat(viewerSeat);
  const isMyTurn = state.phase === "playing" && state.activeSeat === viewerSeat;
  const myPhaseIsPlay = isMyTurn && state.turnPhase === "PLAY_OR_DISCARD";
  const myPhaseIsDraw = isMyTurn && state.turnPhase === "DRAW";

  const hand = state.hands[viewerSeat];
  const selectedCard = myPhaseIsPlay ? hand.find((c) => c.id === selectedCardId) ?? null : null;

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
      {/* Opponent header + expeditions */}
      <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-white">
          <Avatar size={24} />
          {names[opponentSeat]}
          {!opponentConnected && <span className="text-[10px] font-normal text-rose-300">(연결 끊김)</span>}
        </span>
        <span className="text-xs text-white/40">손패 {state.hands[opponentSeat].length}장</span>
      </div>
      <ExpeditionRow seat={opponentSeat} state={state} selectedCard={null} />

      {/* Center: deck + discard piles */}
      <CenterPiles state={state} canDraw={myPhaseIsDraw} selectedCard={selectedCard} onDrawDeck={handleDrawDeck} onDiscardPileClick={handleCenterPileClick} />

      {/* My expeditions */}
      <ExpeditionRow seat={viewerSeat} state={state} selectedCard={selectedCard} onLaneClick={myPhaseIsPlay ? handleLaneClick : undefined} />

      {/* Status + my hand */}
      <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-white">
          <Avatar size={24} />
          {names[viewerSeat]} <span className="text-xs font-normal text-emerald-300">(나)</span>
        </span>
        <span className={`text-xs ${isMyTurn ? "text-emerald-300" : "text-white/40"}`}>{statusText}</span>
      </div>
      <div className="flex flex-wrap justify-center gap-1.5 rounded-xl border border-white/10 bg-black/20 p-2 sm:gap-2 sm:p-3">
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
