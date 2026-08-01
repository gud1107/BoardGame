"use client";

import { useMemo, useState } from "react";
import Tooltip from "@/components/Tooltip";
import RulebookModal from "./RulebookModal";
import {
  ACTION_TYPES,
  GEISHAS,
  type ActionType,
  type EngineAction,
  type HanamikojiState,
  type ItemCard,
  type Owner,
  other,
  tally,
} from "./engine";

/**
 * Pure game UI + rules driver — knows nothing about betting, IndexedDB, or
 * networking. State is fully controlled by the caller (`HanamikojiGame`,
 * which owns the Supabase Realtime sync): this component only ever emits
 * intent via `onAction`/`onGameEnd`, never mutates state itself. That's what
 * lets the exact same reducer output stay identical on both players' devices.
 *
 * Each device only ever renders `viewerRole`'s own hand face-up; the
 * opponent's hand is rendered as face-down count-only placeholders — there
 * is no "pass the device" screen anymore, because there's no shared device.
 */
export interface HanamikojiBoardProps {
  state: HanamikojiState;
  viewerRole: Owner;
  names: Record<Owner, string>;
  ids: Record<Owner, string>;
  opponentConnected: boolean;
  onAction: (action: EngineAction) => void;
  onGameEnd: (winnerId: string) => void;
}

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

function CardChip({ card, dim }: { card: ItemCard; dim?: boolean }) {
  const geisha = GEISHAS.find((g) => g.id === card.geishaId)!;
  return (
    <Tooltip text={`${geisha.name} · 호감도 ${geisha.value} — 라운드 종료 시 더 많이 모은 쪽이 이 게이샤를 차지합니다.`}>
      <div
        className={`flex h-14 w-11 flex-col items-center justify-center rounded-lg border text-lg shadow-sm ${
          dim ? "border-white/10 bg-white/5 opacity-50" : "border-white/20 bg-white/10"
        }`}
      >
        <span>{GEISHA_EMOJI[card.geishaId]}</span>
        <span className="text-[10px] text-white/60">{geisha.value}</span>
      </div>
    </Tooltip>
  );
}

function CardBack() {
  return (
    <Tooltip text="상대방의 카드입니다 (비공개).">
      <div className="flex h-14 w-11 items-center justify-center rounded-lg border border-white/10 bg-gradient-to-br from-indigo-950 to-black text-white/25">
        <span className="text-lg">🂠</span>
      </div>
    </Tooltip>
  );
}

function GeishaBoard({ state, names }: { state: HanamikojiState; names: Record<Owner, string> }) {
  return (
    // flex-wrap (not overflow-x-auto): a horizontal-scroll container forces
    // overflow-y to clip too (per the CSS overflow spec), which silently
    // hid the geisha tooltips popping up above each tile.
    <div className="flex flex-wrap gap-2 pb-2">
      {GEISHAS.map((g) => {
        const owner = state.geishaOwnership[g.id];
        const p1Public = state.players.p1.wonCards.filter((c) => c.geishaId === g.id).length;
        const p2Public = state.players.p2.wonCards.filter((c) => c.geishaId === g.id).length;
        const ownerLabel = owner ? `현재 ${names[owner]}님이 확보했습니다.` : "아직 아무도 확보하지 못했습니다.";
        return (
          <Tooltip key={g.id} text={`${g.name} · 호감도 ${g.value}점. ${ownerLabel}`}>
            <div
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
          </Tooltip>
        );
      })}
    </div>
  );
}

export default function HanamikojiBoard({
  state,
  viewerRole,
  names,
  ids,
  opponentConnected,
  onAction,
  onGameEnd,
}: HanamikojiBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const opponentRole = other(viewerRole);
  const myTurn = state.activePlayer === viewerRole;

  const [selectedAction, setSelectedAction] = useState<ActionType | null>(null);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [competeGroupA, setCompeteGroupA] = useState<string[]>([]);
  const turnKey = `${state.roundNumber}-${state.activePlayer}-${state.turnInRound}`;
  const [selectionForKey, setSelectionForKey] = useState(turnKey);
  if (turnKey !== selectionForKey) {
    setSelectionForKey(turnKey);
    setSelectedAction(null);
    setSelectedCardIds([]);
    setCompeteGroupA([]);
  }

  const myHand = state.players[viewerRole].hand;
  const opponentHandCount = state.players[opponentRole].hand.length;
  const available = ACTION_TYPES.filter((a) => !state.players[viewerRole].actionsUsed.includes(a));

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
    if (selectedAction === "secret") onAction({ type: "secret", cardId: selectedCardIds[0] });
    else if (selectedAction === "tradeoff")
      onAction({ type: "tradeoff", cardIds: selectedCardIds as [string, string] });
    else if (selectedAction === "gift")
      onAction({ type: "gift", cardIds: selectedCardIds as [string, string, string] });
    else if (selectedAction === "compete") {
      const setB = selectedCardIds.filter((id) => !competeGroupA.includes(id));
      onAction({
        type: "compete",
        setA: competeGroupA as [string, string],
        setB: setB as [string, string],
      });
    }
  }

  const t = useMemo(() => tally(state.geishaOwnership), [state.geishaOwnership]);

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

  if (state.phase === "match-end" && state.matchWinner) {
    const winnerName = names[state.matchWinner];
    return (
      <div className="flex flex-col items-center gap-6 rounded-2xl border border-white/10 bg-black/40 p-10 text-center">
        <span className="text-5xl">🏆</span>
        <h2 className="text-2xl font-bold text-white">{winnerName}님 승리!</h2>
        <p className="text-sm text-white/60">
          게이샤 {t[state.matchWinner === "p1" ? "p1GeishaCount" : "p2GeishaCount"]}명 · 호감도{" "}
          {t[state.matchWinner === "p1" ? "p1Points" : "p2Points"]}점
        </p>
        <GeishaBoard state={state} names={names} />
        <button
          onClick={() => onGameEnd(ids[state.matchWinner!])}
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
        <GeishaBoard state={state} names={names} />
        <p className="text-sm text-white/60">
          {names.p1}: 게이샤 {t.p1GeishaCount}명 / 호감도 {t.p1Points}점 · {names.p2}: 게이샤{" "}
          {t.p2GeishaCount}명 / 호감도 {t.p2Points}점
        </p>
        <button
          onClick={() => onAction({ type: "next-round", seed: Math.floor(Math.random() * 1_000_000_000) })}
          className="rounded-full bg-rose-500 px-6 py-3 font-medium text-white transition hover:bg-rose-400"
        >
          다음 라운드 시작
        </button>
      </div>
    );
  }

  const responder = state.pendingOffer ? other(state.pendingOffer.offeredBy) : null;
  const iAmResponder = state.phase === "awaiting-response" && responder === viewerRole;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between text-xs text-white/50">
        <span>
          {state.roundNumber}라운드 · 남은 카드 {state.deck.length}장
        </span>
        {rulebookButton}
      </div>

      {connectionBanner}

      <GeishaBoard state={state} names={names} />

      {/* Opponent's hand: count-only, face-down. */}
      <div>
        <p className="mb-1.5 text-xs text-white/50">{names[opponentRole]} (상대) · {opponentHandCount}장</p>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: opponentHandCount }).map((_, i) => (
            <CardBack key={i} />
          ))}
        </div>
      </div>

      {state.phase === "awaiting-response" && state.pendingOffer && responder ? (
        iAmResponder ? (
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <p className="mb-3 text-sm text-white/70">
              {names[state.pendingOffer.offeredBy]}님이 제시한{" "}
              {state.pendingOffer.kind === "gift" ? "카드 중 1장" : "세트 중 1개"}를 선택하세요.
            </p>
            {state.pendingOffer.kind === "gift" ? (
              <div className="flex gap-3">
                {state.pendingOffer.cards.map((card) => (
                  <button key={card.id} onClick={() => onAction({ type: "gift-response", cardId: card.id })}>
                    <CardChip card={card} />
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex gap-6">
                {state.pendingOffer.sets.map((set, idx) => (
                  <button
                    key={idx}
                    onClick={() => onAction({ type: "compete-response", index: idx as 0 | 1 })}
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
            <p className="mb-3 text-sm text-white/70">
              {names[responder]}님이 선택 중입니다... 내가 제시한{" "}
              {state.pendingOffer.kind === "gift" ? "카드" : "묶음"}이에요.
            </p>
            {state.pendingOffer.kind === "gift" ? (
              <div className="flex gap-3">
                {state.pendingOffer.cards.map((card) => (
                  <CardChip key={card.id} card={card} />
                ))}
              </div>
            ) : (
              <div className="flex gap-6">
                {state.pendingOffer.sets.map((set, idx) => (
                  <div key={idx} className="flex gap-2 rounded-xl border border-white/10 p-2">
                    {set.map((card) => (
                      <CardChip key={card.id} card={card} />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      ) : (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
          <p className="mb-2 text-sm text-white/70">{myTurn ? "내 차례예요" : `${names[state.activePlayer]}님의 차례입니다...`}</p>

          {!myTurn ? (
            <p className="text-xs text-white/40">상대방이 카드를 뽑고 행동을 고르는 중이에요.</p>
          ) : state.phase === "awaiting-draw" ? (
            <button
              onClick={() => onAction({ type: "draw" })}
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
            </>
          )}
        </div>
      )}

      {/* My hand: always visible, face-up, selectable during my action phase. */}
      <div>
        <p className="mb-1.5 text-xs text-white/50">내 카드</p>
        <div className="flex flex-wrap gap-2">
          {myHand.map((card) => {
            const isSelected = selectedCardIds.includes(card.id);
            const inGroupA = competeGroupA.includes(card.id);
            const interactive = myTurn && state.phase === "awaiting-action" && Boolean(selectedAction);
            return (
              <button
                key={card.id}
                disabled={!interactive}
                onClick={() => toggleCard(card.id)}
                className={`relative rounded-lg transition ${
                  isSelected ? "-translate-y-2 ring-2 ring-rose-400" : ""
                } ${!interactive ? "opacity-90" : ""}`}
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
        {myTurn && state.phase === "awaiting-action" && selectedAction && (
          <button
            disabled={
              selectedCardIds.length !== ACTION_LABEL[selectedAction].count ||
              (selectedAction === "compete" &&
                (competeGroupA.length !== 2 || selectedCardIds.length - competeGroupA.length !== 2))
            }
            onClick={confirmAction}
            className="mt-3 w-full rounded-xl bg-emerald-500 py-3 font-medium text-white transition disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
          >
            {selectedAction === "compete" ? "2장씩 나눠 제시하기" : "확정"}
          </button>
        )}
      </div>

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
    </div>
  );
}
