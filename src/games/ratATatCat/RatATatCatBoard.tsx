"use client";

import { useState } from "react";
import Avatar from "@/components/common/Avatar";
import CardSlot, { CardBack } from "./CardSlot";
import GameOverReveal from "./RatATatCatEffects";
import { getValidMoves, SLOTS, type EngineAction, type RatATatCatState, type SeatIndex, type SlotIndex } from "./engine";

/**
 * Controlled component — state comes in via props only, every user action
 * turns into an `EngineAction` handed to `onAction`. No network/betting
 * awareness (ARCHITECTURE.md §2).
 */
export interface RatATatCatBoardProps {
  state: RatATatCatState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
  /** Called once the viewer has acknowledged (or skipped) the game-over reveal. */
  onGameEnd: () => void;
}

function seatOrderFrom(viewerSeat: SeatIndex, playerCount: number): SeatIndex[] {
  const order: SeatIndex[] = [];
  for (let i = 1; i < playerCount; i++) order.push((viewerSeat + i) % playerCount);
  return order;
}

const SPECIAL_INSTRUCTIONS: Record<"peek" | "swap" | "drawTwo", string> = {
  peek: "🔎 엿보기 카드입니다 — 확인하고 싶은 내 카드를 선택하세요.",
  swap: "🔄 바꾸기 카드입니다 — 먼저 내 카드를, 다음으로 상대의 카드를 선택하세요 (앞면은 보지 않고 그대로 교환됩니다).",
  drawTwo: "2️⃣ 두 번 뽑기 카드입니다 — 사용하면 덱에서 카드를 한 장 더 뽑아 마음에 드는 쪽을 고를 수 있어요.",
};

export default function RatATatCatBoard({ state, viewerSeat, names, connectedSeats, onAction, onGameEnd }: RatATatCatBoardProps) {
  const [swapMySlot, setSwapMySlot] = useState<SlotIndex | null>(null);

  if (state.phase === "gameOver") {
    return <GameOverReveal state={state} names={names} viewerSeat={viewerSeat} onDone={onGameEnd} />;
  }

  const myHand = state.hands[viewerSeat];
  const isMyTurn = state.phase === "playing" && state.currentTurn === viewerSeat;
  const myMoves = isMyTurn ? getValidMoves(state, viewerSeat) : [];
  const canDrawDeck = myMoves.some((m) => m.type === "DRAW_CARD" && m.source === "deck");
  const canDrawDiscard = myMoves.some((m) => m.type === "DRAW_CARD" && m.source === "discard");
  // TURN_DECISION only — see engine.ts docstring point 5 (call timing moved
  // from "instead of drawing" to "after this turn's card action resolves").
  const canPassTurn = myMoves.some((m) => m.type === "PASS_TURN");
  const canCall = myMoves.some((m) => m.type === "CALL_RAT_A_TAT_CAT");
  const canDiscard = myMoves.some((m) => m.type === "DISCARD_CARD");
  const discardTop = state.discardPile[state.discardPile.length - 1] ?? null;

  // ---------------------------------------------------------------------
  // Setup phase — everyone privately peeks their own end cards (slots 0/3),
  // acks independently (see engine.ts's currentActor doc for why this isn't
  // turn-gated), then flips back down.
  // ---------------------------------------------------------------------
  if (state.phase === "setup") {
    const iAcked = state.setupAcks[viewerSeat];
    const ackedCount = state.setupAcks.filter(Boolean).length;
    return (
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center">
        <span className="text-3xl">🐱🐭</span>
        <h2 className="text-base font-bold text-white">시작 전 카드 확인</h2>
        <p className="max-w-xs text-xs text-white/50">양 끝(1, 4번) 카드만 몰래 확인하세요. 가운데 2장은 능력을 쓰기 전까지 알 수 없어요.</p>
        <div className="flex gap-2">
          {SLOTS.map((slot) => {
            const revealNow = !iAcked && (slot === 0 || slot === 3);
            return (
              <CardSlot
                key={slot}
                handCard={myHand[slot]}
                knownToViewer={revealNow || myHand[slot].isKnownToOwner}
                label={`내 카드 ${slot + 1}번`}
              />
            );
          })}
        </div>
        {iAcked ? (
          <p className="text-xs text-white/40">{ackedCount}/{state.playerCount}명 확인 완료 — 상대를 기다리는 중...</p>
        ) : (
          <button
            type="button"
            onClick={() => onAction({ type: "INITIAL_PEEK_DONE", seat: viewerSeat })}
            className="rounded-full bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            확인 완료 (다시 뒤집기)
          </button>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Playing phase
  // ---------------------------------------------------------------------
  const opponents = seatOrderFrom(viewerSeat, state.playerCount);

  function handleMySlotClick(slot: SlotIndex) {
    if (!isMyTurn) return;
    if (state.turnPhase === "DECIDE_CARD") {
      onAction({ type: "REPLACE_CARD", seat: viewerSeat, slot });
      return;
    }
    if (state.turnPhase === "EXECUTE_POWER" && state.drawnCard?.kind === "peek") {
      onAction({ type: "USE_SPECIAL_CARD", seat: viewerSeat, power: "peek", slot });
      return;
    }
    if (state.turnPhase === "EXECUTE_POWER" && state.drawnCard?.kind === "swap") {
      setSwapMySlot(slot);
    }
  }

  function handleOpponentSlotClick(targetSeat: SeatIndex, targetSlot: SlotIndex) {
    if (!isMyTurn || swapMySlot === null) return;
    onAction({ type: "USE_SPECIAL_CARD", seat: viewerSeat, power: "swap", mySlot: swapMySlot, targetSeat, targetSlot });
    setSwapMySlot(null);
  }

  const inSwapPickOwn = isMyTurn && state.turnPhase === "EXECUTE_POWER" && state.drawnCard?.kind === "swap" && swapMySlot === null;
  const inSwapPickTarget = isMyTurn && state.turnPhase === "EXECUTE_POWER" && state.drawnCard?.kind === "swap" && swapMySlot !== null;
  const inPeekPick = isMyTurn && state.turnPhase === "EXECUTE_POWER" && state.drawnCard?.kind === "peek";
  const inReplacePick = isMyTurn && state.turnPhase === "DECIDE_CARD";

  return (
    <div className="flex flex-col gap-5">
      {state.callerId !== null && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-center text-xs font-semibold text-amber-200">
          🐱 {names[state.callerId]}님이 &ldquo;랫어탯캣!&rdquo;을 외쳤습니다 — 마지막 턴이 진행 중이에요 ({state.finalRoundTurnsLeft}턴 남음)
        </div>
      )}

      {/* Opponents */}
      <div className="flex flex-wrap justify-center gap-4">
        {opponents.map((seat) => {
          const isTurn = state.phase === "playing" && state.currentTurn === seat;
          const isSwapTarget = inSwapPickTarget;
          return (
            <div
              key={seat}
              className={`flex flex-col items-center gap-1.5 rounded-xl border p-2.5 ${
                isTurn ? "border-emerald-400/50 bg-emerald-400/5" : "border-white/10 bg-white/[0.02]"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Avatar size={22} />
                <span className="max-w-[6rem] truncate text-xs font-semibold text-white/80">{names[seat]}</span>
                {!connectedSeats.has(seat) && <span className="text-[10px] text-white/30">💤</span>}
                {state.callerId === seat && <span className="text-[10px]">🐱</span>}
              </div>
              <div className="flex gap-1">
                {SLOTS.map((slot) => (
                  <CardSlot
                    key={slot}
                    size="sm"
                    handCard={state.hands[seat][slot]}
                    highlighted={isSwapTarget}
                    label={`${names[seat]}의 카드 ${slot + 1}번`}
                    onClick={isSwapTarget ? () => handleOpponentSlotClick(seat, slot) : undefined}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Center: deck / discard / drawn-card decision zone */}
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-center gap-6">
          <button
            type="button"
            disabled={!canDrawDeck}
            onClick={() => onAction({ type: "DRAW_CARD", seat: viewerSeat, source: "deck" })}
            className={`flex flex-col items-center gap-1 ${canDrawDeck ? "cursor-pointer" : "cursor-default opacity-60"}`}
          >
            <div className={canDrawDeck ? "animate-pulse" : ""}>
              <CardBack size="lg" />
            </div>
            <span className="text-[11px] text-white/50">덱 ({state.deck.length}장)</span>
          </button>

          <button
            type="button"
            disabled={!canDrawDiscard}
            onClick={() => onAction({ type: "DRAW_CARD", seat: viewerSeat, source: "discard" })}
            className={`flex flex-col items-center gap-1 ${canDrawDiscard ? "cursor-pointer" : "cursor-default"}`}
          >
            {discardTop ? (
              <CardSlot size="lg" handCard={{ card: discardTop, isKnownToOwner: true, isRevealed: true }} revealed highlighted={canDrawDiscard} />
            ) : (
              <div className="flex h-24 w-16 items-center justify-center rounded-xl border-2 border-dashed border-white/15 text-white/20 sm:h-28 sm:w-20">-</div>
            )}
            <span className="text-[11px] text-white/50">버림 더미</span>
          </button>
        </div>

        {isMyTurn && state.turnPhase === "DRAW" && (
          <div className="flex flex-col items-center gap-2">
            <p className="text-xs text-white/50">
              {state.drawTwoStage === 1 ? "덱에서 두 번째(마지막) 카드를 뽑으세요." : "덱 또는 버림 더미에서 카드를 가져오세요."}
            </p>
          </div>
        )}

        {/* Turn-end choice — reached once this turn's card action (교체/버리기/능력 사용) is
            fully resolved. Split into two big, clearly separated touch targets (gap-3) so a
            careless tap can't accidentally end the turn instead of calling, or vice versa —
            see engine.ts docstring point 5 for why the call moved here instead of "드로우 대신". */}
        {isMyTurn && state.turnPhase === "TURN_DECISION" && (
          <div className="flex flex-col items-center gap-2.5">
            <p className="text-xs text-white/50">이번 턴 행동을 마쳤어요. 턴을 마칠까요, 랫어탯캣을 외칠까요?</p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {canPassTurn && (
                <button
                  type="button"
                  onClick={() => onAction({ type: "PASS_TURN", seat: viewerSeat })}
                  className="min-w-[9.5rem] rounded-full bg-emerald-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-900/40 hover:bg-emerald-500 active:scale-95"
                >
                  ✅ 턴 종료
                </button>
              )}
              {canCall && (
                <button
                  type="button"
                  onClick={() => onAction({ type: "CALL_RAT_A_TAT_CAT", seat: viewerSeat })}
                  style={{ animation: "ratc-call-pulse-glow 1.6s ease-in-out infinite" }}
                  className="min-w-[9.5rem] rounded-full bg-gradient-to-b from-amber-400 to-amber-600 px-6 py-3 text-sm font-extrabold text-amber-950 hover:from-amber-300 hover:to-amber-500 active:scale-95"
                >
                  🐱 랫어탯캣! (콜)
                </button>
              )}
            </div>
            {!canCall && <p className="text-[11px] text-white/35">이미 다른 플레이어가 콜을 외쳤어요 — 턴 종료만 가능해요.</p>}
          </div>
        )}

        {isMyTurn && state.turnPhase === "DECIDE_CARD" && state.drawnCard && (
          <div className="flex flex-col items-center gap-2">
            <p className="text-xs text-white/60">뽑은 카드:</p>
            <CardSlot size="lg" handCard={{ card: state.drawnCard, isKnownToOwner: true, isRevealed: true }} revealed />
            <p className="text-xs text-white/50">{state.mustReplace ? "버림 더미에서 가져온 카드는 반드시 교체해야 해요." : "아래 내 카드 중 하나와 교체하거나 그냥 버리세요."}</p>
            {canDiscard && (
              <button type="button" onClick={() => onAction({ type: "DISCARD_CARD", seat: viewerSeat })} className="rounded-full border border-white/20 px-4 py-2 text-xs text-white/70 hover:border-white/40">
                그냥 버리기
              </button>
            )}
          </div>
        )}

        {isMyTurn && state.turnPhase === "EXECUTE_POWER" && state.drawnCard && state.drawnCard.kind !== "number" && (
          <div className="flex flex-col items-center gap-2">
            <CardSlot size="lg" handCard={{ card: state.drawnCard, isKnownToOwner: true, isRevealed: true }} revealed />
            <p className="max-w-xs text-xs text-white/60">{SPECIAL_INSTRUCTIONS[state.drawnCard.kind]}</p>
            {state.drawnCard.kind === "drawTwo" && (
              <button
                type="button"
                onClick={() => onAction({ type: "USE_SPECIAL_CARD", seat: viewerSeat, power: "drawTwo" })}
                className="rounded-full bg-sky-600 px-5 py-2 text-xs font-semibold text-white hover:bg-sky-500"
              >
                능력 사용 (한 장 더 뽑기)
              </button>
            )}
            {inSwapPickTarget && (
              <button type="button" onClick={() => setSwapMySlot(null)} className="rounded-full border border-white/20 px-4 py-1.5 text-[11px] text-white/60 hover:border-white/40">
                다시 선택
              </button>
            )}
            {canDiscard && (
              <button type="button" onClick={() => onAction({ type: "DISCARD_CARD", seat: viewerSeat })} className="rounded-full border border-white/20 px-4 py-2 text-xs text-white/70 hover:border-white/40">
                그냥 버리기
              </button>
            )}
          </div>
        )}

        {!isMyTurn && state.phase === "playing" && (
          <p className="text-xs text-white/40">{names[state.currentTurn]}님의 차례입니다...</p>
        )}
      </div>

      {/* My hand */}
      <div className="flex flex-col items-center gap-1.5">
        <div className="flex items-center gap-1.5">
          <Avatar size={22} />
          <span className="text-xs font-semibold text-emerald-300">나 ({names[viewerSeat]})</span>
        </div>
        <div className="flex gap-2">
          {SLOTS.map((slot) => (
            <CardSlot
              key={slot}
              size="lg"
              handCard={myHand[slot]}
              knownToViewer={myHand[slot].isKnownToOwner}
              selected={inSwapPickOwn === false && swapMySlot === slot}
              highlighted={inReplacePick || inPeekPick || inSwapPickOwn}
              label={`내 카드 ${slot + 1}번`}
              onClick={inReplacePick || inPeekPick || inSwapPickOwn ? () => handleMySlotClick(slot) : undefined}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
