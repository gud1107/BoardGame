"use client";

import { useState } from "react";
import RulebookModal from "./RulebookModal";
import { CardBack, CardFace, CardSlot, cardLabel } from "./CardArt";
import TargetModal from "./TargetModal";
import { CardFlipWrapper, detectGameJustEnded, detectNewlyEliminated, EliminationToast, GameOverBanner } from "./LoveLetterEffects";
import {
  computeRankings,
  getPlayerView,
  isForcedCountess,
  needsTarget,
  validTargets,
  type Card,
  type CardNumber,
  type EngineAction,
  type LoveLetterState,
  type LoveLetterView,
  type SeatIndex,
} from "./engine";

/**
 * Pure game UI + rules driver — same controlled-component contract as every
 * other `<Game>Board.tsx` in this project (state via props only, intent out
 * via `onAction`). Every client holds the FULL state (every seat's actual
 * hand) per this project's lockstep trust model; hand secrecy is enforced
 * only here, purely at render time, via `getPlayerView` (see engine.ts's
 * module doc #2). The only decision-driving popup — target + Guard's
 * card-number guess — lives in `TargetModal.tsx`.
 */
export interface LoveLetterBoardProps {
  state: LoveLetterState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

function describeLastEvent(event: LoveLetterView["lastEvent"], names: Record<SeatIndex, string>, viewerSeat: SeatIndex): string | null {
  if (!event) return null;
  const who = (seat: SeatIndex) => (seat === viewerSeat ? "나" : (names[seat] ?? "상대"));
  switch (event.type) {
    case "guard":
      if (event.fizzled) return `${who(event.actorSeat)}님이 경비병을 냈지만 지목할 대상이 없어 효과가 소멸했습니다.`;
      return `${who(event.actorSeat)}님이 경비병으로 ${who(event.targetSeat!)}님을 "${cardLabel(event.guess!)}"로 지목 → ${event.correct ? "적중! 탈락" : "빗나감"}`;
    case "priest":
      if (event.fizzled) return `${who(event.actorSeat)}님이 사제를 냈지만 지목할 대상이 없어 효과가 소멸했습니다.`;
      return event.peekedCard
        ? `${who(event.actorSeat)}님이 사제로 ${who(event.targetSeat!)}님의 손패(${cardLabel(event.peekedCard)})를 확인했습니다.`
        : `${who(event.actorSeat)}님이 사제로 ${who(event.targetSeat!)}님의 손패를 확인했습니다.`;
    case "baron": {
      if (event.fizzled) return `${who(event.actorSeat)}님이 남작을 냈지만 지목할 대상이 없어 효과가 소멸했습니다.`;
      const outcome =
        event.outcome === "tie"
          ? "동률이라 아무도 탈락하지 않았습니다."
          : event.outcome === "actorEliminated"
            ? `${who(event.actorSeat)}님이 탈락했습니다.`
            : `${who(event.targetSeat!)}님이 탈락했습니다.`;
      return `${who(event.actorSeat)}님이 남작으로 ${who(event.targetSeat!)}님과 대결 → ${outcome}`;
    }
    case "handmaid":
      return `${who(event.actorSeat)}님이 하녀를 내어 다음 차례까지 보호받습니다.`;
    case "prince": {
      const base = `${who(event.actorSeat)}님이 왕자로 ${who(event.targetSeat)}님의 "${cardLabel(event.discardedCard)}"를 버리게 했습니다.`;
      if (event.eliminatedPrincess) return `${base} 공주였다! ${who(event.targetSeat)}님 즉시 탈락.`;
      return event.newCard ? `${base} 새 카드(${cardLabel(event.newCard)})를 뽑았습니다.` : `${base} 새 카드를 뽑았습니다.`;
    }
    case "king":
      if (event.fizzled) return `${who(event.actorSeat)}님이 왕을 냈지만 지목할 대상이 없어 효과가 소멸했습니다.`;
      return `${who(event.actorSeat)}님이 왕으로 ${who(event.targetSeat!)}님과 손패를 교환했습니다.`;
    case "countess":
      return `${who(event.actorSeat)}님이 백작부인을 냈습니다.`;
    case "princess":
      return `${who(event.actorSeat)}님이 공주를 버려 즉시 탈락했습니다!`;
  }
}

export default function LoveLetterBoard({ state, viewerSeat, names, connectedSeats, onAction, onGameEnd }: LoveLetterBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const [pendingCard, setPendingCard] = useState<Card | null>(null);
  const [confirmPrincess, setConfirmPrincess] = useState<Card | null>(null);

  // Same "diff consecutive lockstep snapshots on render" pattern every other
  // Board in this project uses to drive purely cosmetic flourishes — see
  // LoveLetterEffects.tsx's module doc.
  const [trackedState, setTrackedState] = useState(state);
  const [eliminationToast, setEliminationToast] = useState<{ id: number; names: string[] } | null>(null);
  const [gameOverBanner, setGameOverBanner] = useState(false);
  if (trackedState !== state) {
    const newlyEliminated = detectNewlyEliminated(trackedState, state);
    const justEnded = detectGameJustEnded(trackedState, state);
    setTrackedState(state);
    // `eliminationOrder.length` is a monotonically increasing counter across
    // the game, so it doubles as a stable, pure remount key for the toast —
    // no impure `Date.now()` call during render (React purity rule).
    if (newlyEliminated.length > 0) setEliminationToast({ id: state.eliminationOrder.length, names: newlyEliminated.map((s) => names[s] ?? "상대") });
    if (justEnded) setGameOverBanner(true);
  }

  const view = getPlayerView(state, viewerSeat);
  const narration = describeLastEvent(view.lastEvent, names, viewerSeat);

  const fx = (
    <>
      {eliminationToast && <EliminationToast key={eliminationToast.id} names={eliminationToast.names} onDone={() => setEliminationToast(null)} />}
      {gameOverBanner && (
        <GameOverBanner winnerNames={state.winnerSeats.map((s) => names[s] ?? "상대")} onDone={() => setGameOverBanner(false)} />
      )}
    </>
  );

  const rulebookButton = (
    <button
      onClick={() => setRulebookOpen(true)}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
    >
      📖 러브레터 룰북
    </button>
  );

  // ---------------------------------------------------------------------
  // Game over
  // ---------------------------------------------------------------------
  if (state.phase === "gameOver") {
    const rankings = computeRankings(state);
    return (
      <div
        className="relative flex flex-col items-center gap-5 rounded-[28px] border border-black/60 p-6 text-center shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-8"
        style={{ background: "linear-gradient(160deg,#3a1024 0%,#1e0a15 55%,#0a0308 100%)" }}
      >
        <span className="text-5xl">💌</span>
        <h2 className="text-2xl font-bold text-rose-100">
          {state.winnerSeats.map((s) => names[s] ?? "상대").join(", ")}님이 공주의 마음을 얻었습니다!
        </h2>
        <p className="text-xs text-white/50">
          {state.endReason === "elimination" ? "최후까지 살아남아 승리했습니다." : "덱이 소진되어 손패를 공개해 승자를 가렸습니다."}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {state.players.map((p) => {
            const revealedHand = view.players.find((v) => v.seat === p.seat)!.hand;
            return (
              <div key={p.seat} className="flex flex-col items-center gap-1">
                {revealedHand && revealedHand.length > 0 ? (
                  <CardFlipWrapper flipKey={`${p.seat}-gameOver`} revealed>
                    <CardFace card={revealedHand[0]} size="sm" />
                  </CardFlipWrapper>
                ) : (
                  // Eliminated seats hold nothing — a face-down back would
                  // wrongly imply hidden info still exists, so show a plain
                  // "탈락" marker instead (their held card, if any, already
                  // surfaced in their discard pile per engine.ts module doc #1).
                  <div className="flex h-20 w-14 items-center justify-center rounded-lg border border-white/10 bg-black/30 text-lg opacity-50">
                    💔
                  </div>
                )}
                <span className="text-[10px] text-white/60">{names[p.seat] ?? "상대"}</span>
              </div>
            );
          })}
        </div>
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[380px] border-collapse text-xs">
            <thead>
              <tr className="text-white/50">
                <th className="border-b border-white/10 px-2 py-2 text-left">순위</th>
                <th className="border-b border-white/10 px-2 py-2 text-left">플레이어</th>
                <th className="border-b border-white/10 px-2 py-2 text-left">버린 카드</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map(({ seat, rank }) => {
                const p = state.players.find((pl) => pl.seat === seat)!;
                return (
                  <tr key={seat} className={rank === 1 ? "bg-rose-400/10" : ""}>
                    <td className="border-b border-white/5 px-2 py-2 text-left font-bold text-rose-200">{rank === 1 ? "💌 1" : rank}</td>
                    <td className="border-b border-white/5 px-2 py-2 text-left text-white">
                      {names[seat] ?? "상대"}
                      {seat === viewerSeat && <span className="ml-1 text-rose-200">(나)</span>}
                    </td>
                    <td className="border-b border-white/5 px-2 py-2 text-left text-white/60">
                      {p.discardPile.length === 0 ? "—" : p.discardPile.map((c) => c.number).join(", ")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button onClick={onGameEnd} className="rounded-full bg-rose-500 px-8 py-3 font-medium text-black transition hover:bg-rose-400">
          결과 확정하고 계속하기
        </button>
        {fx}
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Playing
  // ---------------------------------------------------------------------
  const me = state.players.find((p) => p.seat === viewerSeat)!;
  const isMyTurn = state.phase === "playing" && state.activeSeat === viewerSeat;
  const forcedCountess = isMyTurn && isForcedCountess(me.hand);

  function playDirect(card: Card) {
    onAction({ type: "playCard", seat: viewerSeat, cardId: card.id });
  }

  function handleCardClick(card: Card) {
    if (!isMyTurn) return;
    if (forcedCountess && card.number !== 7) return; // guarded again below by disabling the button
    if (card.number === 8) {
      setConfirmPrincess(card);
      return;
    }
    if (!needsTarget(card.number)) {
      playDirect(card);
      return;
    }
    const targets = validTargets(state, viewerSeat, card.number as CardNumber);
    if (targets.length === 0) {
      playDirect(card); // fizzles — no decision to make, see engine.ts §4 지목 불가능 상황
      return;
    }
    setPendingCard(card);
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-[28px] border border-black/60 p-2.5 shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-4"
      style={{ background: "linear-gradient(160deg,#2a1020 0%,#180a14 45%,#0a0308 100%)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs text-rose-100/70">
        <span>
          {state.playerCount}인 · 단판 승부 · 덱 {state.deck.length}장 남음
        </span>
        <div className="flex gap-1.5">{rulebookButton}</div>
      </div>

      {narration && (
        <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-center text-xs text-white/70">💬 {narration}</div>
      )}

      {state.visibleRemovedCards.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border border-amber-300/20 bg-amber-400/5 px-3 py-2 text-center text-[11px] text-amber-100/70">
          <span>👁️ 2인 전용 공개 제거 카드:</span>
          <div className="flex gap-1.5">
            {state.visibleRemovedCards.map((c) => (
              <CardFace key={c.id} card={c} size="xs" />
            ))}
          </div>
        </div>
      )}

      {/* Scoreboard */}
      <section className="flex flex-col gap-1.5">
        {state.players.map((p) => {
          const v = view.players.find((x) => x.seat === p.seat)!;
          const isActive = state.activeSeat === p.seat;
          const isSelf = p.seat === viewerSeat;
          return (
            <div
              key={p.seat}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2 text-xs transition ${
                !p.alive ? "border-white/5 bg-black/10 opacity-60" : isActive ? "border-rose-300/60 bg-rose-400/10" : "border-white/10 bg-black/20"
              }`}
            >
              <span className="flex items-center gap-1.5 font-semibold text-white/90">
                <span className={`h-1.5 w-1.5 rounded-full ${connectedSeats.has(p.seat) ? "bg-emerald-400" : "bg-white/20"}`} />
                {isActive && <span title="차례">👉</span>}
                {names[p.seat] ?? "상대"}
                {isSelf && <span className="text-rose-200">(나)</span>}
                {!p.alive && <span className="text-white/40">💔 탈락</span>}
                {p.protectedUntilNextTurn && <span title="하녀 보호 중">🛡️</span>}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="flex gap-1">
                  {Array.from({ length: v.handSize }, (_, i) =>
                    v.hand ? <CardFace key={i} card={v.hand[i]} size="xs" /> : <CardBack key={i} size="xs" />,
                  )}
                </span>
                {p.discardPile.length > 0 && (
                  <span className="flex flex-wrap gap-0.5" title="버린 카드">
                    {p.discardPile.map((c) => (
                      <CardFace key={c.id} card={c} size="xs" />
                    ))}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </section>

      {/* My hand */}
      <section
        className="rounded-2xl border border-rose-300/20 p-2.5 sm:p-3"
        style={{ background: "linear-gradient(160deg,#3a1024 0%,#1e0a15 55%,#0a0308 100%)" }}
      >
        <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-rose-200/90 uppercase">💌 내 손패 ({me.hand.length}장)</h3>
        {!me.alive ? (
          <p className="text-xs text-white/30">탈락하여 더 이상 카드를 낼 수 없습니다.</p>
        ) : me.hand.length === 0 ? (
          <p className="text-xs text-white/30">{names[state.activeSeat] ?? "상대"}님의 차례를 기다리는 중...</p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            {me.hand.map((c) => {
              const disabled = !isMyTurn || (forcedCountess && c.number !== 7);
              return (
                <button
                  key={c.id}
                  disabled={disabled}
                  onClick={() => handleCardClick(c)}
                  title={forcedCountess && c.number !== 7 ? "백작부인을 반드시 내야 합니다 (왕자/왕과 함께 있음)" : undefined}
                  className={`transition ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:-translate-y-1"}`}
                >
                  <CardFace card={c} size="lg" highlight={isMyTurn && !disabled} />
                </button>
              );
            })}
          </div>
        )}
        {isMyTurn && (
          <p className="mt-2 text-center text-[11px] text-rose-200/80">
            {forcedCountess ? "🫵 백작부인을 반드시 내야 합니다!" : "🫵 낼 카드를 선택하세요."}
          </p>
        )}
        {!isMyTurn && me.alive && state.phase === "playing" && (
          <p className="mt-2 text-center text-[11px] text-white/40">{names[state.activeSeat] ?? "상대"}님의 차례를 기다리는 중...</p>
        )}
      </section>

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}

      {pendingCard && (
        <TargetModal
          cardNumber={pendingCard.number}
          targets={validTargets(state, viewerSeat, pendingCard.number)}
          names={names}
          viewerSeat={viewerSeat}
          onConfirm={(targetSeat, guessNumber) => {
            onAction({ type: "playCard", seat: viewerSeat, cardId: pendingCard.id, targetSeat, guessNumber });
            setPendingCard(null);
          }}
          onCancel={() => setPendingCard(null)}
        />
      )}

      {confirmPrincess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex w-full max-w-xs flex-col items-center gap-3 rounded-2xl border border-rose-300/40 bg-[#1e0a15] p-5 text-center shadow-2xl">
            <CardSlot card={confirmPrincess} size="md" />
            <p className="text-sm font-semibold text-rose-100">정말 공주를 버리시겠습니까?</p>
            <p className="text-xs text-white/50">이 카드를 내면 이유를 불문하고 즉시 탈락합니다.</p>
            <div className="flex w-full gap-2">
              <button
                onClick={() => setConfirmPrincess(null)}
                className="flex-1 rounded-xl border border-white/15 py-2 text-xs text-white/70 hover:border-white/30"
              >
                취소
              </button>
              <button
                onClick={() => {
                  playDirect(confirmPrincess);
                  setConfirmPrincess(null);
                }}
                className="flex-1 rounded-xl bg-rose-600 py-2 text-xs font-semibold text-white hover:bg-rose-500"
              >
                버리기
              </button>
            </div>
          </div>
        </div>
      )}

      {fx}
    </div>
  );
}
