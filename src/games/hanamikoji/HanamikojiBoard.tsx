"use client";

import { type CSSProperties, useMemo, useState } from "react";
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

// Each geisha's item cards get a distinct color family so a fanned hand
// reads at a glance, like the printed card backs of a real card set.
const GEISHA_STYLE: Record<string, { grad: string; text: string }> = {
  g5: { grad: "from-indigo-300 via-indigo-400 to-indigo-600", text: "text-indigo-950" },
  g4: { grad: "from-orange-300 via-orange-400 to-red-500", text: "text-orange-950" },
  g3a: { grad: "from-rose-300 via-rose-400 to-rose-600", text: "text-rose-950" },
  g3b: { grad: "from-pink-300 via-pink-400 to-pink-600", text: "text-pink-950" },
  g2a: { grad: "from-amber-200 via-amber-300 to-amber-500", text: "text-amber-950" },
  g2b: { grad: "from-fuchsia-300 via-fuchsia-400 to-fuchsia-600", text: "text-fuchsia-950" },
  g2c: { grad: "from-violet-300 via-violet-400 to-violet-600", text: "text-violet-950" },
};

const ACTION_LABEL: Record<ActionType, { label: string; desc: string; count: number }> = {
  secret: { label: "밀서", desc: "카드 1장을 숨깁니다 (라운드 종료 시 공개)", count: 1 },
  tradeoff: { label: "제거", desc: "카드 2장을 제거합니다 (이번 라운드엔 집계되지 않음)", count: 2 },
  gift: { label: "선물", desc: "카드 3장을 보여주면 상대가 1장을 가져갑니다", count: 3 },
  compete: { label: "경쟁", desc: "카드 4장을 눌러 2장씩 A·B 두 묶음으로 나누면 상대가 1세트를 가져갑니다", count: 4 },
};

const ACTION_ICON: Record<ActionType, string> = {
  secret: "🤫",
  tradeoff: "❌",
  gift: "🎁",
  compete: "⚔️",
};

// A dark charcoal table panel, reused across every screen of the board so
// the "playing" and end-of-round states feel like one table.
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

function CardChip({
  card,
  size = "md",
  dim,
  badge,
}: {
  card: ItemCard;
  size?: "sm" | "md";
  dim?: boolean;
  badge?: "A" | "B";
}) {
  const geisha = GEISHAS.find((g) => g.id === card.geishaId)!;
  const style = GEISHA_STYLE[card.geishaId];
  const dims = size === "sm" ? "h-16 w-11" : "h-24 w-16";
  return (
    <Tooltip text={`${geisha.name} · 호감도 ${geisha.value} — 라운드 종료 시 더 많이 모은 쪽이 이 게이샤를 차지합니다.`}>
      <div
        className={`relative flex ${dims} flex-col items-center justify-between rounded-xl border-2 border-white/80 bg-gradient-to-b ${style.grad} px-1 py-1 shadow-[0_4px_10px_rgba(0,0,0,0.5)] ${
          dim ? "opacity-40 grayscale" : ""
        }`}
      >
        <span className={`self-start text-[9px] font-bold leading-none ${style.text}`}>{geisha.value}</span>
        <span className="text-xl drop-shadow-sm">{GEISHA_EMOJI[card.geishaId]}</span>
        <span className={`self-end rotate-180 text-[9px] font-bold leading-none ${style.text}`}>{geisha.value}</span>
        {badge && (
          <span
            className={`absolute -top-2 left-1/2 -translate-x-1/2 rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white shadow ring-1 ring-white/50 ${
              badge === "A" ? "bg-rose-500" : "bg-sky-500"
            }`}
          >
            {badge}
          </span>
        )}
      </div>
    </Tooltip>
  );
}

function CardBack({ size = "md" }: { size?: "sm" | "md" }) {
  const dims = size === "sm" ? "h-16 w-11" : "h-24 w-16";
  return (
    <Tooltip text="상대방의 카드입니다 (비공개).">
      <div
        className={`flex ${dims} items-center justify-center rounded-xl border-2 border-white/15 shadow-[0_4px_10px_rgba(0,0,0,0.5)]`}
        style={{
          backgroundImage:
            "repeating-linear-gradient(135deg, rgba(255,255,255,0.07) 0px, rgba(255,255,255,0.07) 2px, transparent 2px, transparent 8px), linear-gradient(160deg, #2c1032, #130715)",
        }}
      >
        <span className="rounded-full border border-white/25 bg-black/30 p-1 text-sm">🌸</span>
      </div>
    </Tooltip>
  );
}

/** Slight arc + overlap so a hand of cards reads like it's fanned out by hand, not stacked in a grid. */
function fanStyle(index: number, total: number, overlapPx: number): CSSProperties {
  if (total <= 1) return { zIndex: index };
  const mid = (total - 1) / 2;
  const offset = index - mid;
  return {
    transform: `rotate(${offset * 6}deg) translateY(${Math.abs(offset) * 5}px)`,
    marginLeft: index === 0 ? 0 : -overlapPx,
    zIndex: index,
  };
}

/** The small "win marker" chip that sits above a geisha tile, showing who currently leads the public count for her. */
function GeishaMarker({ p1Count, p2Count, owner }: { p1Count: number; p2Count: number; owner: Owner | null }) {
  const leader: Owner | null = owner ?? (p1Count > p2Count ? "p1" : p2Count > p1Count ? "p2" : null);
  return (
    <div
      className={`flex h-5 min-w-[38px] items-center justify-center gap-1 rounded-md border px-1 text-[9px] font-bold sm:h-6 sm:min-w-[42px] sm:text-[10px] ${
        leader === "p1"
          ? "border-rose-400/70 bg-rose-500/20 text-rose-200"
          : leader === "p2"
            ? "border-sky-400/70 bg-sky-500/20 text-sky-200"
            : "border-white/10 bg-white/5 text-white/30"
      }`}
    >
      {owner ? "👑" : leader ? `${leader === "p1" ? "P1" : "P2"} ${leader === "p1" ? p1Count : p2Count}` : "–"}
    </div>
  );
}

function GeishaBoard({ state, names }: { state: HanamikojiState; names: Record<Owner, string> }) {
  return (
    <div className="flex justify-center gap-1.5 overflow-x-auto pb-1 sm:gap-2.5">
      {GEISHAS.map((g) => {
        const owner = state.geishaOwnership[g.id];
        const style = GEISHA_STYLE[g.id];
        const p1Public = state.players.p1.wonCards.filter((c) => c.geishaId === g.id).length;
        const p2Public = state.players.p2.wonCards.filter((c) => c.geishaId === g.id).length;
        const ownerLabel = owner ? `현재 ${names[owner]}님이 확보했습니다.` : "아직 아무도 확보하지 못했습니다.";
        return (
          <div key={g.id} className="flex shrink-0 flex-col items-center gap-1">
            <Tooltip text={`공개된 카드: P1 ${p1Public}장 · P2 ${p2Public}장. ${ownerLabel}`}>
              <GeishaMarker p1Count={p1Public} p2Count={p2Public} owner={owner} />
            </Tooltip>
            <Tooltip text={`${g.name} · 호감도 ${g.value}점. ${ownerLabel}`}>
              <div
                className={`relative flex w-[50px] flex-col items-center gap-0.5 rounded-xl border-2 bg-gradient-to-b p-1.5 shadow-[0_3px_8px_rgba(0,0,0,0.45)] sm:w-[66px] sm:p-2 ${style.grad} ${
                  owner === "p1"
                    ? "border-rose-300 ring-2 ring-rose-400/70"
                    : owner === "p2"
                      ? "border-sky-300 ring-2 ring-sky-400/70"
                      : "border-white/40"
                }`}
              >
                <span className={`absolute left-1 top-1 text-[8px] font-bold sm:text-[9px] ${style.text}`}>
                  {g.value}
                </span>
                <span className="text-lg drop-shadow-sm sm:text-xl">{GEISHA_EMOJI[g.id]}</span>
                <span className={`text-[9px] font-semibold sm:text-xs ${style.text}`}>{g.name}</span>
              </div>
            </Tooltip>
          </div>
        );
      })}
    </div>
  );
}

/** One of the four action tiles below the geisha row — icon + label, highlighted while selected. */
function ActionTile({
  type,
  selected,
  disabled,
  onSelect,
}: {
  type: ActionType;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const meta = ACTION_LABEL[type];
  return (
    <div className="relative flex flex-col items-center">
      {selected && (
        <span className="absolute -top-6 whitespace-nowrap rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-black shadow-md">
          {meta.label} 선택됨
        </span>
      )}
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        className={`flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-xl border-2 text-[10px] font-semibold transition sm:h-16 sm:w-16 ${
          disabled
            ? "cursor-not-allowed border-white/5 bg-white/[0.03] text-white/20"
            : selected
              ? "scale-105 border-amber-300 bg-amber-400/20 text-amber-100 shadow-[0_0_0_3px_rgba(251,191,36,0.35)]"
              : "border-white/15 bg-white/5 text-white/70 hover:border-white/30 hover:bg-white/10"
        }`}
      >
        <span className="text-lg sm:text-xl">{ACTION_ICON[type]}</span>
        <span>{meta.label}</span>
      </button>
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
  // Compete needs two explicit 2-card groups rather than one selection list
  // + a derived "which half" flag — a derived flag can fall out of sync the
  // moment a card is deselected (it doesn't get pulled back out of the
  // group), which is what silently disabled the submit button. Two lists
  // that a card can only ever belong to one of can't drift apart like that.
  const [competeGroupA, setCompeteGroupA] = useState<string[]>([]);
  const [competeGroupB, setCompeteGroupB] = useState<string[]>([]);
  const turnKey = `${state.roundNumber}-${state.activePlayer}-${state.turnInRound}`;
  const [selectionForKey, setSelectionForKey] = useState(turnKey);
  if (turnKey !== selectionForKey) {
    setSelectionForKey(turnKey);
    setSelectedAction(null);
    setSelectedCardIds([]);
    setCompeteGroupA([]);
    setCompeteGroupB([]);
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

  // Tap a card to place it in whichever group (A, then B) still has room;
  // tap an already-placed card to pull it back out. No hidden second click
  // target — the card itself is the whole control.
  function toggleCompeteCard(cardId: string) {
    if (competeGroupA.includes(cardId)) {
      setCompeteGroupA((prev) => prev.filter((id) => id !== cardId));
      return;
    }
    if (competeGroupB.includes(cardId)) {
      setCompeteGroupB((prev) => prev.filter((id) => id !== cardId));
      return;
    }
    if (competeGroupA.length < 2) setCompeteGroupA((prev) => [...prev, cardId]);
    else if (competeGroupB.length < 2) setCompeteGroupB((prev) => [...prev, cardId]);
  }

  function selectAction(a: ActionType) {
    setSelectedAction(a);
    setSelectedCardIds([]);
    setCompeteGroupA([]);
    setCompeteGroupB([]);
  }

  const competeReady = competeGroupA.length === 2 && competeGroupB.length === 2;
  const confirmDisabled =
    selectedAction === null
      ? true
      : selectedAction === "compete"
        ? !competeReady
        : selectedCardIds.length !== ACTION_LABEL[selectedAction].count;

  function confirmAction() {
    if (!selectedAction) return;
    if (selectedAction === "secret") onAction({ type: "secret", cardId: selectedCardIds[0] });
    else if (selectedAction === "tradeoff")
      onAction({ type: "tradeoff", cardIds: selectedCardIds as [string, string] });
    else if (selectedAction === "gift")
      onAction({ type: "gift", cardIds: selectedCardIds as [string, string, string] });
    else if (selectedAction === "compete") {
      onAction({
        type: "compete",
        setA: competeGroupA as [string, string],
        setB: competeGroupB as [string, string],
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
      <div className={`${TABLE_PANEL} flex flex-col items-center gap-6 p-10 text-center`}>
        <TableTexture />
        <span className="relative z-10 text-5xl">🏆</span>
        <h2 className="relative z-10 text-2xl font-bold text-white">{winnerName}님 승리!</h2>
        <p className="relative z-10 text-sm text-white/60">
          게이샤 {t[state.matchWinner === "p1" ? "p1GeishaCount" : "p2GeishaCount"]}명 · 호감도{" "}
          {t[state.matchWinner === "p1" ? "p1Points" : "p2Points"]}점
        </p>
        <div className="relative z-10">
          <GeishaBoard state={state} names={names} />
        </div>
        <button
          onClick={() => onGameEnd(ids[state.matchWinner!])}
          className="relative z-10 rounded-full bg-emerald-500 px-8 py-3 font-medium text-white transition hover:bg-emerald-400"
        >
          결과 확정하고 계속하기
        </button>
      </div>
    );
  }

  if (state.phase === "round-end") {
    return (
      <div className={`${TABLE_PANEL} flex flex-col items-center gap-6 p-8 text-center`}>
        <TableTexture />
        <h2 className="relative z-10 text-xl font-bold text-white">{state.roundNumber}라운드 결과</h2>
        <div className="relative z-10">
          <GeishaBoard state={state} names={names} />
        </div>
        <p className="relative z-10 text-sm text-white/60">
          {names.p1}: 게이샤 {t.p1GeishaCount}명 / 호감도 {t.p1Points}점 · {names.p2}: 게이샤{" "}
          {t.p2GeishaCount}명 / 호감도 {t.p2Points}점
        </p>
        <button
          onClick={() => onAction({ type: "next-round", seed: Math.floor(Math.random() * 1_000_000_000) })}
          className="relative z-10 rounded-full bg-rose-500 px-6 py-3 font-medium text-white transition hover:bg-rose-400"
        >
          다음 라운드 시작
        </button>
      </div>
    );
  }

  const responder = state.pendingOffer ? other(state.pendingOffer.offeredBy) : null;
  const iAmResponder = state.phase === "awaiting-response" && responder === viewerRole;

  return (
    <div className={`${TABLE_PANEL} flex flex-col gap-4 p-3 sm:p-4`}>
      <TableTexture />
      <div className="relative z-10 flex flex-col gap-4">
        <div className="flex items-center justify-between text-xs text-white/50">
          <span>
            {state.roundNumber}라운드 · 남은 카드 {state.deck.length}장
          </span>
          {rulebookButton}
        </div>

        {connectionBanner}

        {/* Opponent's side of the table: count-only face-down hand + which
            actions they've already spent this round, both up top since
            that's "across the table" from the viewer. */}
        <div>
          <p className="mb-1 text-center text-xs text-white/50">
            {names[opponentRole]} (상대) · {opponentHandCount}장
          </p>
          <div className="flex justify-center pt-2">
            {Array.from({ length: opponentHandCount }).map((_, i) => (
              <div key={i} style={fanStyle(i, opponentHandCount, 16)}>
                <CardBack size="sm" />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex justify-center gap-1">
            {ACTION_TYPES.map((a) => {
              const used = state.players[opponentRole].actionsUsed.includes(a);
              return (
                <span
                  key={a}
                  className={`flex h-5 w-5 items-center justify-center rounded-md border text-[10px] ${
                    used ? "border-white/5 bg-white/[0.03] text-white/15" : "border-white/15 bg-white/5 text-white/50"
                  }`}
                >
                  {ACTION_ICON[a]}
                </span>
              );
            })}
          </div>
        </div>

        <GeishaBoard state={state} names={names} />

        {/* My action tiles: the four action markers, always shown, greyed
            out once spent for the round. Selecting one is the only way to
            start choosing cards below. */}
        {myTurn && state.phase === "awaiting-action" && (
          <div className="flex justify-center gap-3 pt-6 sm:gap-4">
            {ACTION_TYPES.map((a) => (
              <ActionTile
                key={a}
                type={a}
                selected={selectedAction === a}
                disabled={!available.includes(a)}
                onSelect={() => selectAction(a)}
              />
            ))}
          </div>
        )}

        {state.phase === "awaiting-response" && state.pendingOffer && responder ? (
          iAmResponder ? (
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <p className="mb-3 text-sm text-white/70">
                {names[state.pendingOffer.offeredBy]}님이 제시한{" "}
                {state.pendingOffer.kind === "gift" ? "카드 중 1장" : "세트 중 1개"}를 선택하세요.
              </p>
              {state.pendingOffer.kind === "gift" ? (
                <div className="flex justify-center gap-3">
                  {state.pendingOffer.cards.map((card) => (
                    <button key={card.id} onClick={() => onAction({ type: "gift-response", cardId: card.id })}>
                      <CardChip card={card} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex justify-center gap-6">
                  {state.pendingOffer.sets.map((set, idx) => (
                    <button
                      key={idx}
                      onClick={() => onAction({ type: "compete-response", index: idx as 0 | 1 })}
                      className="flex gap-2 rounded-xl border border-white/10 p-2 transition hover:border-rose-400 hover:bg-white/5"
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
                <div className="flex justify-center gap-3">
                  {state.pendingOffer.cards.map((card) => (
                    <CardChip key={card.id} card={card} />
                  ))}
                </div>
              ) : (
                <div className="flex justify-center gap-6">
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
            ) : selectedAction ? (
              <p className="text-xs text-white/50">
                {ACTION_LABEL[selectedAction].desc}
                {selectedAction === "compete" ? (
                  <>
                    {" · "}
                    <span className={competeGroupA.length === 2 ? "text-rose-300" : "text-white/50"}>
                      묶음 A {competeGroupA.length}/2
                    </span>
                    {" · "}
                    <span className={competeGroupB.length === 2 ? "text-sky-300" : "text-white/50"}>
                      묶음 B {competeGroupB.length}/2
                    </span>
                  </>
                ) : (
                  <>
                    {" · "}
                    {selectedCardIds.length}/{ACTION_LABEL[selectedAction].count} 선택됨
                  </>
                )}
              </p>
            ) : (
              <p className="text-xs text-white/40">위에서 행동을 선택하세요.</p>
            )}
          </div>
        )}

        {/* My hand: always visible, face-up, fanned, selectable during my action phase. */}
        <div>
          <p className="mb-1 text-center text-xs text-white/50">내 카드</p>
          <div className="flex justify-center pt-2">
            {myHand.map((card, i) => {
              const interactive = myTurn && state.phase === "awaiting-action" && Boolean(selectedAction);
              const competeBadge: "A" | "B" | undefined = competeGroupA.includes(card.id)
                ? "A"
                : competeGroupB.includes(card.id)
                  ? "B"
                  : undefined;
              const isSelected = selectedAction === "compete" ? Boolean(competeBadge) : selectedCardIds.includes(card.id);
              return (
                <div key={card.id} style={fanStyle(i, myHand.length, 24)}>
                  <button
                    disabled={!interactive}
                    onClick={() => (selectedAction === "compete" ? toggleCompeteCard(card.id) : toggleCard(card.id))}
                    className={`relative block rounded-xl transition ${
                      isSelected
                        ? "-translate-y-3 ring-2 ring-amber-300 ring-offset-2 ring-offset-transparent"
                        : interactive
                          ? "hover:-translate-y-1.5"
                          : ""
                    } ${!interactive ? "opacity-90" : ""}`}
                  >
                    <CardChip card={card} badge={competeBadge} />
                  </button>
                </div>
              );
            })}
          </div>
          {myTurn && state.phase === "awaiting-action" && selectedAction && (
            <>
              <button
                disabled={confirmDisabled}
                onClick={confirmAction}
                className="mt-3 w-full rounded-xl bg-emerald-500 py-3 font-medium text-white transition disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
              >
                {selectedAction === "compete" ? "2장씩 나눠 제시하기" : "확정"}
              </button>
              {confirmDisabled && (
                <p className="mt-1.5 text-center text-[11px] text-white/40">
                  {selectedAction === "compete"
                    ? "카드 4장을 눌러 2장씩 A·B 묶음을 채우면 제출할 수 있어요."
                    : `카드를 ${ACTION_LABEL[selectedAction].count}장 선택하면 제출할 수 있어요.`}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
    </div>
  );
}
