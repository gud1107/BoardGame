"use client";

import { useMemo, useReducer, useState } from "react";
import type { PlayableGameProps } from "@/games/types";
import {
  ACTION_TYPES,
  GEISHAS,
  type ActionType,
  type HanamikojiState,
  type ItemCard,
  type Owner,
  chooseCompete,
  chooseGift,
  chooseSecret,
  chooseTradeoff,
  createInitialOwnership,
  drawCard,
  other,
  resolveCompeteResponse,
  resolveGiftResponse,
  startRound,
  tally,
} from "./engine";

const GEISHA_EMOJI: Record<string, string> = {
  g5: "🌸",
  g4: "🌺",
  g3a: "🌼",
  g3b: "🌻",
  g2a: "🌷",
  g2b: "💮",
  g2c: "🏵️",
};

const ACTION_LABEL: Record<ActionType, { label: string; desc: string; count: number }> = {
  secret: { label: "비밀", desc: "카드 1장을 숨깁니다 (라운드 종료 시 공개)", count: 1 },
  tradeoff: { label: "거래", desc: "카드 2장을 버립니다 (이번 라운드엔 집계되지 않음)", count: 2 },
  gift: { label: "선물", desc: "카드 3장을 보여주면 상대가 1장을 가져갑니다", count: 3 },
  compete: { label: "경쟁", desc: "카드 4장을 2장씩 2세트로 나누면 상대가 1세트를 가져갑니다", count: 4 },
};

type EngineAction =
  | { type: "draw" }
  | { type: "secret"; cardId: string }
  | { type: "tradeoff"; cardIds: [string, string] }
  | { type: "gift"; cardIds: [string, string, string] }
  | { type: "compete"; setA: [string, string]; setB: [string, string] }
  | { type: "gift-response"; cardId: string }
  | { type: "compete-response"; index: 0 | 1 }
  | { type: "next-round" };

function reducer(state: HanamikojiState, action: EngineAction): HanamikojiState {
  switch (action.type) {
    case "draw":
      return drawCard(state);
    case "secret":
      return chooseSecret(state, action.cardId);
    case "tradeoff":
      return chooseTradeoff(state, action.cardIds);
    case "gift":
      return chooseGift(state, action.cardIds);
    case "compete":
      return chooseCompete(state, action.setA, action.setB);
    case "gift-response":
      return resolveGiftResponse(state, action.cardId);
    case "compete-response":
      return resolveCompeteResponse(state, action.index);
    case "next-round":
      return startRound(state.roundNumber + 1, other(state.roundStarter), state.geishaOwnership);
    default:
      return state;
  }
}

function CardChip({ card, dim }: { card: ItemCard; dim?: boolean }) {
  const geisha = GEISHAS.find((g) => g.id === card.geishaId)!;
  return (
    <div
      className={`flex h-14 w-11 flex-col items-center justify-center rounded-lg border text-lg shadow-sm ${
        dim ? "border-white/10 bg-white/5 opacity-50" : "border-white/20 bg-white/10"
      }`}
      title={geisha.name}
    >
      <span>{GEISHA_EMOJI[card.geishaId]}</span>
      <span className="text-[10px] text-white/60">{geisha.value}</span>
    </div>
  );
}

function GeishaBoard({ state }: { state: HanamikojiState }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {GEISHAS.map((g) => {
        const owner = state.geishaOwnership[g.id];
        const p1Public = state.players.p1.wonCards.filter((c) => c.geishaId === g.id).length;
        const p2Public = state.players.p2.wonCards.filter((c) => c.geishaId === g.id).length;
        return (
          <div
            key={g.id}
            className={`flex min-w-[64px] flex-col items-center gap-1 rounded-xl border p-2 ${
              owner === "p1"
                ? "border-rose-400 bg-rose-500/20"
                : owner === "p2"
                  ? "border-sky-400 bg-sky-500/20"
                  : "border-white/15 bg-white/5"
            }`}
          >
            <span className="text-xl">{GEISHA_EMOJI[g.id]}</span>
            <span className="text-xs font-medium text-white/80">{g.name}</span>
            <span className="text-[10px] text-white/50">호감 {g.value}</span>
            <div className="flex items-center gap-1 text-[10px] text-white/60">
              <span className="text-rose-300">P1 {p1Public}</span>
              <span>·</span>
              <span className="text-sky-300">P2 {p2Public}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PassScreen({
  name,
  subtitle,
  onContinue,
}: {
  name: string;
  subtitle: string;
  onContinue: () => void;
}) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 rounded-2xl border border-white/10 bg-black/40 p-8 text-center">
      <span className="text-4xl">🤝</span>
      <p className="text-sm text-white/60">기기를 전달하세요</p>
      <h3 className="text-2xl font-bold text-white">{name}님 차례</h3>
      <p className="max-w-xs text-sm text-white/60">{subtitle}</p>
      <button
        onClick={onContinue}
        className="mt-4 rounded-full bg-rose-500 px-6 py-3 font-medium text-white transition hover:bg-rose-400"
      >
        탭하여 확인 (다른 사람이 보지 않게 해주세요)
      </button>
    </div>
  );
}

export default function HanamikojiGame({ participants, onComplete }: PlayableGameProps) {
  const [p1, p2] = participants;
  const names: Record<Owner, string> = { p1: p1.name, p2: p2.name };

  const [state, dispatch] = useReducer(
    reducer,
    undefined,
    () => startRound(1, "p1", createInitialOwnership()) as HanamikojiState,
  );

  const responder = state.pendingOffer ? other(state.pendingOffer.offeredBy) : null;
  const viewerKey =
    state.phase === "awaiting-response"
      ? `resp-${responder}-${state.turnInRound}`
      : state.phase === "awaiting-draw" || state.phase === "awaiting-action"
        ? `turn-${state.activePlayer}-${state.turnInRound}`
        : "public";
  const needsPass = viewerKey !== "public";

  const [passed, setPassed] = useState(false);
  const [passedForKey, setPassedForKey] = useState(viewerKey);
  if (viewerKey !== passedForKey) {
    setPassedForKey(viewerKey);
    setPassed(false);
  }

  const [selectedAction, setSelectedAction] = useState<ActionType | null>(null);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [competeGroupA, setCompeteGroupA] = useState<string[]>([]);
  const turnKey = `${state.activePlayer}-${state.turnInRound}`;
  const [selectionForKey, setSelectionForKey] = useState(turnKey);
  if (turnKey !== selectionForKey) {
    setSelectionForKey(turnKey);
    setSelectedAction(null);
    setSelectedCardIds([]);
    setCompeteGroupA([]);
  }

  const activeState = state.players[state.activePlayer];
  const available = ACTION_TYPES.filter((a) => !activeState.actionsUsed.includes(a));

  function toggleCard(cardId: string) {
    if (!selectedAction) return;
    const max = ACTION_LABEL[selectedAction].count;
    setSelectedCardIds((prev) => {
      if (prev.includes(cardId)) return prev.filter((id) => id !== cardId);
      if (prev.length >= max) return prev;
      return [...prev, cardId];
    });
  }

  function confirmAction() {
    if (!selectedAction) return;
    if (selectedAction === "secret") dispatch({ type: "secret", cardId: selectedCardIds[0] });
    else if (selectedAction === "tradeoff")
      dispatch({ type: "tradeoff", cardIds: selectedCardIds as [string, string] });
    else if (selectedAction === "gift")
      dispatch({ type: "gift", cardIds: selectedCardIds as [string, string, string] });
    else if (selectedAction === "compete") {
      const setB = selectedCardIds.filter((id) => !competeGroupA.includes(id));
      dispatch({
        type: "compete",
        setA: competeGroupA as [string, string],
        setB: setB as [string, string],
      });
    }
  }

  const t = useMemo(() => (state.geishaOwnership ? tally(state.geishaOwnership) : null), [state.geishaOwnership]);

  if (state.phase === "match-end" && state.matchWinner) {
    const winnerId = state.matchWinner === "p1" ? p1.id : p2.id;
    const loserId = state.matchWinner === "p1" ? p2.id : p1.id;
    const winnerName = names[state.matchWinner];
    return (
      <div className="flex flex-col items-center gap-6 rounded-2xl border border-white/10 bg-black/40 p-10 text-center">
        <span className="text-5xl">🏆</span>
        <h2 className="text-2xl font-bold text-white">{winnerName}님 승리!</h2>
        <p className="text-sm text-white/60">
          게이샤 {t?.[state.matchWinner === "p1" ? "p1GeishaCount" : "p2GeishaCount"]}명 · 호감도{" "}
          {t?.[state.matchWinner === "p1" ? "p1Points" : "p2Points"]}점
        </p>
        <GeishaBoard state={state} />
        <button
          onClick={() =>
            onComplete({
              rankings: [
                { playerId: winnerId, rank: 1 },
                { playerId: loserId, rank: 2 },
              ],
              finishedAt: new Date().toISOString(),
            })
          }
          className="rounded-full bg-emerald-500 px-8 py-3 font-medium text-white transition hover:bg-emerald-400"
        >
          결과 확정하고 계속하기
        </button>
      </div>
    );
  }

  if (state.phase === "round-end") {
    return (
      <div className="flex flex-col items-center gap-6 rounded-2xl border border-white/10 bg-black/40 p-8 text-center">
        <h2 className="text-xl font-bold text-white">{state.roundNumber}라운드 결과</h2>
        <GeishaBoard state={state} />
        <p className="text-sm text-white/60">
          {names.p1}: 게이샤 {t?.p1GeishaCount}명 / 호감도 {t?.p1Points}점 · {names.p2}: 게이샤{" "}
          {t?.p2GeishaCount}명 / 호감도 {t?.p2Points}점
        </p>
        <button
          onClick={() => dispatch({ type: "next-round" })}
          className="rounded-full bg-rose-500 px-6 py-3 font-medium text-white transition hover:bg-rose-400"
        >
          다음 라운드 시작
        </button>
      </div>
    );
  }

  if (needsPass && !passed) {
    const viewerOwner = state.phase === "awaiting-response" ? responder! : state.activePlayer;
    return (
      <PassScreen
        name={names[viewerOwner]}
        subtitle={
          state.phase === "awaiting-response"
            ? "상대가 제시한 카드 중 하나를 선택하세요."
            : "카드를 뽑고 4가지 행동 중 하나를 선택하세요."
        }
        onContinue={() => setPassed(true)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between text-xs text-white/50">
        <span>{state.roundNumber}라운드</span>
        <span>남은 카드 {state.deck.length}장</span>
      </div>

      <GeishaBoard state={state} />

      {state.phase === "awaiting-response" && state.pendingOffer && responder ? (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
          <p className="mb-3 text-sm text-white/70">
            {names[responder]}님, {names[state.pendingOffer.offeredBy]}님이 제시한{" "}
            {state.pendingOffer.kind === "gift" ? "카드 중 1장" : "세트 중 1개"}를 선택하세요.
          </p>
          {state.pendingOffer.kind === "gift" ? (
            <div className="flex gap-3">
              {state.pendingOffer.cards.map((card) => (
                <button key={card.id} onClick={() => dispatch({ type: "gift-response", cardId: card.id })}>
                  <CardChip card={card} />
                </button>
              ))}
            </div>
          ) : (
            <div className="flex gap-6">
              {state.pendingOffer.sets.map((set, idx) => (
                <button
                  key={idx}
                  onClick={() => dispatch({ type: "compete-response", index: idx as 0 | 1 })}
                  className="flex gap-2 rounded-xl border border-white/10 p-2 hover:border-rose-400"
                >
                  {set.map((card) => (
                    <CardChip key={card.id} card={card} />
                  ))}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
          <p className="mb-2 text-sm text-white/70">{names[state.activePlayer]}님의 차례</p>

          {state.phase === "awaiting-draw" ? (
            <button
              onClick={() => dispatch({ type: "draw" })}
              className="w-full rounded-xl bg-rose-500 py-3 font-medium text-white transition hover:bg-rose-400"
            >
              카드 뽑기
            </button>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-2">
                {available.map((a) => (
                  <button
                    key={a}
                    onClick={() => {
                      setSelectedAction(a);
                      setSelectedCardIds([]);
                      setCompeteGroupA([]);
                    }}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      selectedAction === a
                        ? "border-rose-400 bg-rose-500/30 text-white"
                        : "border-white/15 text-white/70 hover:border-white/30"
                    }`}
                  >
                    {ACTION_LABEL[a].label}
                  </button>
                ))}
              </div>
              {selectedAction && (
                <p className="mb-3 text-xs text-white/50">{ACTION_LABEL[selectedAction].desc}</p>
              )}

              <div className="mb-3 flex flex-wrap gap-2">
                {activeState.hand.map((card) => {
                  const isSelected = selectedCardIds.includes(card.id);
                  const inGroupA = competeGroupA.includes(card.id);
                  return (
                    <button
                      key={card.id}
                      disabled={!selectedAction}
                      onClick={() => toggleCard(card.id)}
                      className={`relative rounded-lg transition ${
                        isSelected ? "-translate-y-2 ring-2 ring-rose-400" : ""
                      } ${!selectedAction ? "opacity-70" : ""}`}
                    >
                      <CardChip card={card} />
                      {selectedAction === "compete" && isSelected && (
                        <span
                          role="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCompeteGroupA((prev) =>
                              inGroupA ? prev.filter((id) => id !== card.id) : [...prev, card.id],
                            );
                          }}
                          className="absolute -top-2 -right-2 rounded-full bg-black px-1.5 text-[9px] text-white ring-1 ring-white/30"
                        >
                          {inGroupA ? "A" : "B"}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {selectedAction && (
                <button
                  disabled={
                    selectedCardIds.length !== ACTION_LABEL[selectedAction].count ||
                    (selectedAction === "compete" &&
                      (competeGroupA.length !== 2 || selectedCardIds.length - competeGroupA.length !== 2))
                  }
                  onClick={confirmAction}
                  className="w-full rounded-xl bg-emerald-500 py-3 font-medium text-white transition disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
                >
                  {selectedAction === "compete" ? "2장씩 나눠 제시하기" : "확정"}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
