"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import RulebookModal from "./RulebookModal";
import { CardFace, RoleBadge } from "./CardArt";
import { detectCommonerSwapEvents, detectTaxEvents, FlyingTaxCard, RevolutionBanner, type TaxFlyEvent } from "./DalmutiEffects";
import {
  computeRankings,
  isLegalPlay,
  legalPlayOptions,
  rankTitle,
  type Card,
  type DalmutiState,
  type EngineAction,
  type SeatIndex,
  type TrickResult,
} from "./engine";

/**
 * Pure game UI + rules driver — same controlled-component contract as every
 * other `<Game>Board.tsx` in this project (state via props only, intent out
 * via `onAction`). Every client holds the FULL state (every seat's hand) per
 * this project's lockstep trust model, but a hand is meant to stay secret
 * from *opponents* by the physical rules — enforced here only: the hand
 * section renders the viewer's own hand face-up but every other seat's hand
 * as a face-down count (see engine.ts's module doc).
 */
export interface DalmutiBoardProps {
  state: DalmutiState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

export default function DalmutiBoard({ state, viewerSeat, names, connectedSeats, onAction, onGameEnd }: DalmutiBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Same "diff consecutive lockstep snapshots on render" pattern every other
  // Board in this project uses to drive purely cosmetic flourishes — see
  // DalmutiEffects.tsx's module doc.
  const [trackedState, setTrackedState] = useState(state);
  const [taxEvents, setTaxEvents] = useState<TaxFlyEvent[]>([]);
  const [trickFlash, setTrickFlash] = useState<TrickResult | null>(null);
  const [revolutionBanner, setRevolutionBanner] = useState<{ seat: SeatIndex; isGrand: boolean } | null>(null);
  const [commonerSwapFlash, setCommonerSwapFlash] = useState<{ seatA: SeatIndex; seatB: SeatIndex } | null>(null);
  if (trackedState !== state) {
    const newTax = detectTaxEvents(trackedState, state);
    const newCommonerSwaps = detectCommonerSwapEvents(trackedState, state);
    const newTrick = state.lastTrickResult !== trackedState.lastTrickResult ? state.lastTrickResult : null;
    const newRevolution = state.revolutionDeclared !== trackedState.revolutionDeclared ? state.revolutionDeclared : null;
    setTrackedState(state);
    if (newTax.length > 0 || newCommonerSwaps.length > 0) {
      setTaxEvents((prev) => {
        let nextId = (prev.at(-1)?.id ?? 0) + 1;
        return [...prev, ...[...newTax, ...newCommonerSwaps].map((e) => ({ ...e, id: nextId++ }))];
      });
    }
    if (newTrick) setTrickFlash(newTrick);
    if (newRevolution) setRevolutionBanner(newRevolution);
    // Commoner-swap events come in pairs (one per direction) — surface the
    // "교환 완료" popup once per completed pair, not once per direction.
    if (newCommonerSwaps.length > 0) setCommonerSwapFlash({ seatA: newCommonerSwaps[0].seat, seatB: newCommonerSwaps[0].targetSeat });
  }
  useEffect(() => {
    if (!trickFlash) return;
    const t = setTimeout(() => setTrickFlash(null), 3200);
    return () => clearTimeout(t);
  }, [trickFlash]);
  useEffect(() => {
    if (!commonerSwapFlash) return;
    const t = setTimeout(() => setCommonerSwapFlash(null), 3200);
    return () => clearTimeout(t);
  }, [commonerSwapFlash]);
  const handleTaxDone = useCallback((id: number) => {
    setTaxEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // Card-selection resets whenever the turn/trick shape moves on, so a stale
  // partial selection from a previous turn never lingers into the next one.
  // Adjusted directly during render (React's recommended "state adjustment"
  // pattern, same as `trackedState` above) rather than in an effect, so it
  // never triggers a second cascading render just to clear a selection.
  const selectionKey = `${state.activeSeat}-${state.trick.plays.length}-${state.phase}`;
  const [trackedSelectionKey, setTrackedSelectionKey] = useState(selectionKey);
  if (trackedSelectionKey !== selectionKey) {
    setTrackedSelectionKey(selectionKey);
    setSelected(new Set());
  }

  const seatRowRefs = useRef(new Map<SeatIndex, HTMLElement>());
  function setSeatRowRef(seat: SeatIndex) {
    return (el: HTMLElement | null) => {
      if (el) seatRowRefs.current.set(seat, el);
      else seatRowRefs.current.delete(seat);
    };
  }

  const rulebookButton = (
    <button
      onClick={() => setRulebookOpen(true)}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
    >
      📖 달무티 룰북
    </button>
  );

  // ---------------------------------------------------------------------
  // Game over
  // ---------------------------------------------------------------------
  if (state.phase === "gameOver") {
    const rankings = computeRankings(state);
    const winner = rankings.find((r) => r.rank === 1)!;
    return (
      <div
        className="relative flex flex-col items-center gap-5 rounded-[28px] border border-black/60 p-6 text-center shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-8"
        style={{ background: "linear-gradient(160deg,#241a3a 0%,#160f26 55%,#0a0714 100%)" }}
      >
        <span className="text-5xl">👑</span>
        <h2 className="text-2xl font-bold text-amber-100">{names[winner.seat]}님이 진정한 왕이 되었습니다!</h2>
        <p className="text-xs text-white/50">손패를 가장 먼저 털어낸 사람이 이기는 단판 승부입니다.</p>
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-xs">
            <thead>
              <tr className="text-white/50">
                <th className="border-b border-white/10 px-2 py-2 text-left">순위</th>
                <th className="border-b border-white/10 px-2 py-2 text-left">플레이어</th>
                <th className="border-b border-white/10 px-2 py-2 text-left">시작 신분</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map(({ seat, rank }) => {
                const startTitle = rankTitle(state.rankOrder.indexOf(seat), state.playerCount);
                return (
                  <tr key={seat} className={rank === 1 ? "bg-amber-400/10" : ""}>
                    <td className="border-b border-white/5 px-2 py-2 text-left font-bold text-amber-200">{rank === 1 ? "👑 1" : rank}</td>
                    <td className="border-b border-white/5 px-2 py-2 text-left text-white">
                      {names[seat]}
                      {seat === viewerSeat && <span className="ml-1 text-amber-200">(나)</span>}
                    </td>
                    <td className="border-b border-white/5 px-2 py-2 text-left">
                      <RoleBadge title={startTitle} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button onClick={onGameEnd} className="rounded-full bg-amber-500 px-8 py-3 font-medium text-black transition hover:bg-amber-400">
          결과 확정하고 계속하기
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Playing (revolutionOption / taxReturn / trick)
  // ---------------------------------------------------------------------
  const me = state.players.find((p) => p.seat === viewerSeat)!;
  const myPosition = state.rankOrder.indexOf(viewerSeat);
  const myTitle = rankTitle(myPosition, state.playerCount);
  const seatOrder = state.rankOrder;

  const isMyTrickTurn = state.phase === "trick" && state.activeSeat === viewerSeat;
  const trickOptions = isMyTrickTurn ? legalPlayOptions(state, viewerSeat) : [];
  const legalRanks = new Set(trickOptions.map((o) => o.rank));
  const myTribute = state.tributes.find((t) => t.toSeat === viewerSeat && !t.resolved);
  const isMyTaxTurn = state.phase === "taxReturn" && !!myTribute;
  const isMyRevolutionTurn = state.phase === "revolutionOption" && state.pendingRevolution?.seat === viewerSeat;

  const myCommonerParticipant = state.commonerExchange?.participants.find((p) => p.seat === viewerSeat) ?? null;
  const isMyCommonerOptInTurn = state.phase === "commonerExchange" && !!myCommonerParticipant && myCommonerParticipant.participate === null;
  const myCommonerPair = state.commonerExchange?.pairs.find((p) => !p.resolved && (p.seatA === viewerSeat || p.seatB === viewerSeat)) ?? null;
  const myCommonerPairIsA = myCommonerPair?.seatA === viewerSeat;
  const myCommonerAlreadyPicked = !!myCommonerPair && (myCommonerPairIsA ? myCommonerPair.cardIdA !== null : myCommonerPair.cardIdB !== null);
  const isMyCommonerOfferTurn = state.phase === "commonerExchange" && !!myCommonerPair && !myCommonerAlreadyPicked;

  const selectedCards = me.hand.filter((c) => selected.has(c.id));
  const selectedNonJokerRanks = new Set(selectedCards.filter((c) => !c.isJoker).map((c) => c.rank));

  function isSelectableForTrick(card: Card): boolean {
    if (!isMyTrickTurn) return false;
    const requiredCount = state.trick.count;
    if (requiredCount > 0 && selected.size >= requiredCount) return false;
    if (card.isJoker) {
      if (requiredCount === 0) return true; // leading: a joker is always a legal addition
      return selectedNonJokerRanks.size > 0; // following: joker only useful once a beating rank is chosen
    }
    if (!legalRanks.has(card.rank)) return false;
    if (selectedNonJokerRanks.size > 0 && !selectedNonJokerRanks.has(card.rank)) return false;
    return true;
  }

  function toggleCard(card: Card) {
    if (state.phase === "trick") {
      if (!isMyTrickTurn) return;
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(card.id)) {
          next.delete(card.id);
          return next;
        }
        return isSelectableForTrick(card) ? new Set(next).add(card.id) : prev;
      });
    } else if (state.phase === "taxReturn" && isMyTaxTurn && myTribute) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(card.id)) {
          next.delete(card.id);
          return next;
        }
        if (next.size >= myTribute.givenCardIds.length) return prev;
        return new Set(next).add(card.id);
      });
    } else if (state.phase === "commonerExchange" && isMyCommonerOfferTurn) {
      setSelected((prev) => (prev.has(card.id) ? new Set() : new Set([card.id])));
    }
  }

  const canSubmitPlay = state.phase === "trick" && isMyTrickTurn && selected.size > 0 && isLegalPlay(state, viewerSeat, Array.from(selected));
  const canReturnTax = isMyTaxTurn && !!myTribute && selected.size === myTribute.givenCardIds.length;
  const canOfferCommonerCard = isMyCommonerOfferTurn && selected.size === 1;

  function submitPlay() {
    if (!canSubmitPlay) return;
    onAction({ type: "playCards", seat: viewerSeat, cardIds: Array.from(selected) });
  }
  function passTurn() {
    if (state.phase !== "trick" || !isMyTrickTurn || state.trick.count === 0) return;
    onAction({ type: "pass", seat: viewerSeat });
  }
  function submitReturnTax() {
    if (!canReturnTax) return;
    onAction({ type: "returnTax", seat: viewerSeat, cardIds: Array.from(selected) });
  }
  function submitCommonerOffer() {
    if (!canOfferCommonerCard) return;
    onAction({ type: "commonerOfferCard", seat: viewerSeat, cardId: Array.from(selected)[0] });
  }

  const cardIsClickable =
    (state.phase === "trick" && isMyTrickTurn) || (state.phase === "taxReturn" && isMyTaxTurn) || (state.phase === "commonerExchange" && isMyCommonerOfferTurn);
  const cardIsHighlighted = (card: Card) => {
    if (selected.has(card.id)) return true;
    if (state.phase === "trick") return isMyTrickTurn && isSelectableForTrick(card);
    if (state.phase === "taxReturn") return isMyTaxTurn && !!myTribute && selected.size < myTribute.givenCardIds.length;
    if (state.phase === "commonerExchange") return isMyCommonerOfferTurn && selected.size < 1;
    return false;
  };

  return (
    <div
      className="flex flex-col gap-3 rounded-[28px] border border-black/60 p-2.5 shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-4"
      style={{ background: "linear-gradient(160deg,#1c1430 0%,#120c20 45%,#080510 100%)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs text-purple-100/70">
        <span className="flex items-center gap-1.5">
          {state.playerCount}인 · 단판 승부 ·{" "}
          <RoleBadge title={myTitle} />
        </span>
        <div className="flex gap-1.5">{rulebookButton}</div>
      </div>

      {/* Revolution option */}
      {state.phase === "revolutionOption" && state.pendingRevolution && (
        <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-3 text-center text-xs">
          {isMyRevolutionTurn ? (
            <div className="flex flex-col items-center gap-2">
              <p className="font-semibold text-rose-200">
                🃏 조커 2장을 모두 갖고 있습니다! {state.pendingRevolution.isGrand ? "대혁명(모든 신분 역전)" : "혁명(세금 취소)"}을 선포하시겠습니까?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => onAction({ type: "declareRevolution", seat: viewerSeat })}
                  className="rounded-full bg-rose-500 px-4 py-2 text-xs font-bold text-white hover:bg-rose-400"
                >
                  {state.pendingRevolution.isGrand ? "🔥 대혁명 선포" : "⚡ 혁명 선포"}
                </button>
                <button
                  onClick={() => onAction({ type: "declineRevolution", seat: viewerSeat })}
                  className="rounded-full border border-white/20 px-4 py-2 text-xs text-white/70 hover:border-white/40"
                >
                  선포하지 않기
                </button>
              </div>
            </div>
          ) : (
            <p className="text-white/70">
              {names[state.pendingRevolution.seat]}님이 조커 2장을 모두 갖고 있어 혁명 선포 여부를 고민 중입니다...
            </p>
          )}
        </div>
      )}

      {/* Tax phase */}
      {state.phase === "taxReturn" && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-amber-300/30 bg-amber-400/10 px-3 py-2.5 text-xs">
          <p className="text-center font-semibold text-amber-200">💰 세금 바치기</p>
          {state.tributes.map((t, i) => (
            <p key={i} className="text-center text-white/70">
              {names[t.fromSeat]} → {names[t.toSeat]}: {t.givenCardIds.length}장 진상{" "}
              {t.resolved ? "✅ 하사 완료" : t.toSeat === viewerSeat ? "⏳ 내가 돌려줄 카드 선택 중" : "⏳ 대기 중"}
            </p>
          ))}
          {isMyTaxTurn && myTribute && (
            <p className="mt-1 text-center font-medium text-amber-100">
              🫵 아래 손패에서 돌려줄 카드 {myTribute.givenCardIds.length}장을 고른 뒤 확정하세요.
            </p>
          )}
        </div>
      )}

      {/* Commoner (평민) mutual exchange phase */}
      {state.phase === "commonerExchange" && state.commonerExchange && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-3 py-2.5 text-xs">
          <p className="text-center font-semibold text-emerald-200">🌾 평민 카드 교환</p>
          {commonerSwapFlash && (
            <p className="text-center text-emerald-100">
              ✅ {names[commonerSwapFlash.seatA]}님과 {names[commonerSwapFlash.seatB]}님이 카드를 교환했습니다!
            </p>
          )}
          <div className="flex flex-col gap-1">
            {state.commonerExchange.participants.map((p) => {
              const pair = state.commonerExchange!.pairs.find((pr) => pr.seatA === p.seat || pr.seatB === p.seat);
              let status: string;
              if (p.participate === null) status = "⏳ 참여 여부 결정 중";
              else if (p.participate === false) status = "🙅 교환 미참여";
              else if (!pair) status = "🙅 짝 없음(참여자 홀수)";
              else if (pair.resolved) status = "✅ 교환 완료";
              else status = "⏳ 카드 선택 중";
              return (
                <p key={p.seat} className="text-center text-white/70">
                  {names[p.seat]}: {status}
                </p>
              );
            })}
          </div>
          {isMyCommonerOptInTurn && (
            <div className="mt-1 flex flex-col items-center gap-2">
              <p className="font-medium text-emerald-100">🫵 다른 평민과 카드 1장을 맞교환하시겠습니까?</p>
              <div className="flex gap-2">
                <button
                  onClick={() => onAction({ type: "commonerOptIn", seat: viewerSeat, participate: true })}
                  className="rounded-full bg-emerald-500 px-4 py-2 text-xs font-bold text-black hover:bg-emerald-400"
                >
                  🤝 교환 요청
                </button>
                <button
                  onClick={() => onAction({ type: "commonerOptIn", seat: viewerSeat, participate: false })}
                  className="rounded-full border border-white/20 px-4 py-2 text-xs text-white/70 hover:border-white/40"
                >
                  ❌ 거절
                </button>
              </div>
            </div>
          )}
          {isMyCommonerOfferTurn && (
            <p className="mt-1 text-center font-medium text-emerald-100">
              🫵 상대에게 줄 카드 1장을 아래 손패에서 골라 제안하세요 (상대의 선택은 서로 확정 전까지 비공개입니다).
            </p>
          )}
        </div>
      )}

      {/* Trick area */}
      {state.phase === "trick" && (
        <>
          {trickFlash && (
            <div className="rounded-xl border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-center text-xs text-white/70">
              {names[trickFlash.winnerSeat]}님이 {trickFlash.rankValue === 13 ? "조커" : `${trickFlash.rankValue}번`} {trickFlash.count}장으로 트릭을 가져가 다음 리드가 됩니다.
            </div>
          )}
          <p className={`text-center text-xs font-medium ${isMyTrickTurn ? "text-amber-200" : "text-white/50"}`}>
            {isMyTrickTurn
              ? state.trick.count === 0
                ? "🫵 당신 차례입니다! 트릭을 리드할 카드를 원하는 계급/장수로 내세요."
                : `🫵 당신 차례입니다! 같은 장수(${state.trick.count}장)이면서 더 높은 계급(숫자 < ${state.trick.rankValue})만 낼 수 있어요.`
              : `${names[state.activeSeat]}님 차례를 기다리는 중...`}
          </p>
          <section className="flex flex-wrap items-start justify-center gap-2.5 rounded-2xl border border-white/10 bg-black/25 p-3">
            {state.trick.plays.length === 0 ? (
              <p className="py-6 text-xs text-white/30">아직 아무도 카드를 내지 않았어요. 이 트릭의 선입니다.</p>
            ) : (
              state.trick.plays.map((play, i) => (
                <div key={`${play.seat}-${i}`} className="flex flex-col items-center gap-1">
                  <span className={`text-[10px] font-semibold ${play.seat === viewerSeat ? "text-amber-200" : "text-white/50"}`}>
                    {i + 1}. {names[play.seat]}
                  </span>
                  <div className="flex -space-x-8">
                    {play.cards.map((c) => (
                      <CardFace key={c.id} card={c} />
                    ))}
                  </div>
                </div>
              ))
            )}
          </section>
        </>
      )}

      {/* Scoreboard */}
      <section className="flex flex-col gap-1.5">
        {seatOrder.map((seat, position) => {
          const p = state.players.find((pl) => pl.seat === seat)!;
          const title = rankTitle(position, state.playerCount);
          const isActive = state.phase === "trick" && state.activeSeat === seat;
          const isSelf = seat === viewerSeat;
          return (
            <div
              key={seat}
              ref={setSeatRowRef(seat)}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2 text-xs transition ${
                p.finishedAtOrder !== null
                  ? "border-white/5 bg-black/10 opacity-60"
                  : isActive
                    ? "border-amber-300/60 bg-amber-400/10"
                    : "border-white/10 bg-black/20"
              }`}
            >
              <span className="flex items-center gap-1.5 font-semibold text-white/90">
                <span className={`h-1.5 w-1.5 rounded-full ${connectedSeats.has(seat) ? "bg-emerald-400" : "bg-white/20"}`} />
                {isActive && <span title="차례">👉</span>}
                <RoleBadge title={title} />
                {names[seat]}
                {isSelf && <span className="text-amber-200">(나)</span>}
                {p.finishedAtOrder !== null && <span className="text-amber-300">🏁 {p.finishedAtOrder}등</span>}
              </span>
              <span className="text-white/70" title="남은 손패 수">
                🂠 {p.hand.length}장
              </span>
            </div>
          );
        })}
      </section>

      {/* My hand */}
      <section
        className="rounded-2xl border border-purple-300/20 p-2.5 sm:p-3"
        style={{ background: "linear-gradient(160deg,#241a3a 0%,#160f26 55%,#0a0714 100%)" }}
      >
        <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-purple-200/90 uppercase">🃏 내 손패 ({me.hand.length}장)</h3>
        {me.hand.length === 0 ? (
          <p className="text-xs text-white/30">손패가 없습니다.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {[...me.hand]
              .sort((a, b) => a.rank - b.rank)
              .map((c) => {
                const clickable = cardIsClickable;
                const highlighted = cardIsHighlighted(c);
                return (
                  <button
                    key={c.id}
                    disabled={!clickable || (!highlighted && !selected.has(c.id))}
                    onClick={() => toggleCard(c)}
                    className={`transition ${clickable && (highlighted || selected.has(c.id)) ? "cursor-pointer hover:-translate-y-1" : "cursor-not-allowed opacity-40"} ${
                      selected.has(c.id) ? "-translate-y-2" : ""
                    }`}
                  >
                    <CardFace card={c} highlight={highlighted} />
                  </button>
                );
              })}
          </div>
        )}
        {state.phase === "trick" && isMyTrickTurn && (
          <div className="mt-3 flex justify-center gap-2">
            <button
              onClick={passTurn}
              disabled={state.trick.count === 0}
              className="rounded-full border border-white/20 px-5 py-2 text-xs font-semibold text-white/80 transition hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-30"
            >
              🙅 패스
            </button>
            <button
              onClick={submitPlay}
              disabled={!canSubmitPlay}
              className="rounded-full bg-amber-500 px-5 py-2 text-xs font-bold text-black transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-30"
            >
              🃏 카드 내기 ({selected.size}장)
            </button>
          </div>
        )}
        {state.phase === "taxReturn" && isMyTaxTurn && (
          <div className="mt-3 flex justify-center">
            <button
              onClick={submitReturnTax}
              disabled={!canReturnTax}
              className="rounded-full bg-amber-500 px-5 py-2 text-xs font-bold text-black transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-30"
            >
              💰 {selected.size}/{myTribute?.givenCardIds.length ?? 0}장 돌려주기
            </button>
          </div>
        )}
        {state.phase === "commonerExchange" && isMyCommonerOfferTurn && (
          <div className="mt-3 flex justify-center">
            <button
              onClick={submitCommonerOffer}
              disabled={!canOfferCommonerCard}
              className="rounded-full bg-emerald-500 px-5 py-2 text-xs font-bold text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-30"
            >
              🌾 {selected.size}/1장 제안하기
            </button>
          </div>
        )}
      </section>

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}

      {/* Tax tribute FX */}
      {taxEvents.map((event) => (
        <FlyingTaxCard key={event.id} event={event} getSeatEl={(seat) => seatRowRefs.current.get(seat) ?? null} onDone={handleTaxDone} />
      ))}

      {/* Revolution banner */}
      {revolutionBanner && (
        <RevolutionBanner
          isGrand={revolutionBanner.isGrand}
          seatLabel={names[revolutionBanner.seat]}
          onDone={() => setRevolutionBanner(null)}
        />
      )}
    </div>
  );
}
