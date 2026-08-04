"use client";

import { type CSSProperties, useMemo, useState } from "react";
import Tooltip from "@/components/Tooltip";
import RulebookModal from "./RulebookModal";
import {
  canBang,
  effectiveDistance,
  weaponRange,
  type BangState,
  type Card,
  type CardType,
  type EngineAction,
  type EquipSlot,
  type PendingGeneralStore,
  type PendingGroupResponse,
  type PlayerState,
  type Role,
  type SeatIndex,
  type Team,
} from "./engine";

/**
 * Pure game UI + rules driver — mirrors HanamikojiBoard's contract: state is
 * fully controlled by the caller (BangGame, which owns the Supabase Realtime
 * sync); this component only ever emits intent via `onAction`, never mutates
 * state itself. Same online trust model as Hanamikoji: every client holds
 * the FULL state (all hands, all secret roles) — this component only
 * *renders* the viewer's own secrets and the always-public Sheriff; anyone
 * else's role/hand is hidden behind placeholders until revealed. See
 * README for the accepted trust trade-off (no server authority).
 */
export interface BangBoardProps {
  state: BangState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

type CardKind =
  | "self"
  | "none"
  | "target-bang"
  | "target-range1"
  | "target-any-alive"
  | "target-non-sheriff"
  | "response-only";

const CARD_META: Record<CardType, { label: string; icon: string; desc: string; kind: CardKind }> = {
  bang: { label: "뱅!", icon: "💥", desc: "사거리 내의 상대 1명을 조준합니다. 상대는 '빗나감!'을 내거나 체력 1을 잃습니다.", kind: "target-bang" },
  missed: { label: "빗나감!", icon: "🛡️", desc: "뱅!이나 개틀링에 대한 방어 카드입니다. 응답할 때만 낼 수 있어요.", kind: "response-only" },
  beer: { label: "맥주", icon: "🍺", desc: "체력을 1 회복합니다 (생존자가 2명뿐일 때는 효과가 없어요).", kind: "self" },
  saloon: { label: "선술집", icon: "🍻", desc: "생존한 모든 플레이어가 체력을 1씩 회복합니다.", kind: "self" },
  duel: { label: "듀얼", icon: "🤠", desc: "상대 1명과 결투합니다. 번갈아 뱅!을 내다 먼저 못 내면 체력 1을 잃습니다 (거리 무관).", kind: "target-any-alive" },
  indians: { label: "인디언!", icon: "🏹", desc: "나를 제외한 모두가 뱅!을 버리거나 체력 1을 잃습니다.", kind: "none" },
  gatling: { label: "개틀링", icon: "🔫", desc: "나를 제외한 모두에게 뱅!과 같은 효과입니다 (거리 무관, 빗나감!으로 방어 가능).", kind: "none" },
  "general-store": { label: "종합 상점", icon: "🏪", desc: "생존자 수만큼 카드를 공개하고, 순서대로 한 장씩 가져갑니다.", kind: "none" },
  stagecoach: { label: "역마차", icon: "🐎", desc: "카드를 2장 더 뽑습니다.", kind: "self" },
  "wells-fargo": { label: "웰스파고", icon: "🚂", desc: "카드를 3장 더 뽑습니다.", kind: "self" },
  panic: { label: "패닉!", icon: "😱", desc: "거리 1 이내의 상대에게서 카드 1장(패 또는 장비)을 빼앗습니다.", kind: "target-range1" },
  "cat-balou": { label: "고양이 발톱", icon: "🐈", desc: "거리와 상관없이 상대의 카드 1장(패 또는 장비)을 버리게 합니다.", kind: "target-any-alive" },
  jail: { label: "감옥", icon: "🔒", desc: "보안관을 제외한 상대 1명에게 씌웁니다. 다음 턴 시작 시 하트를 뽑지 못하면 턴을 건너뜁니다.", kind: "target-non-sheriff" },
  dynamite: { label: "다이너마이트", icon: "🧨", desc: "자신에게 장착합니다. 매 턴 시작 시 스페이드 2~9를 뽑으면 폭발(체력 3 손실), 아니면 다음 사람에게 넘어갑니다.", kind: "self" },
  volcanic: { label: "볼카닉", icon: "🔫", desc: "사거리 1 무기. 장착한 턴부터 뱅!을 여러 번 낼 수 있게 해줍니다.", kind: "self" },
  schofield: { label: "스코필드", icon: "🔫", desc: "사거리 2 무기.", kind: "self" },
  remington: { label: "레밍턴", icon: "🔫", desc: "사거리 3 무기.", kind: "self" },
  "rev-carbine": { label: "레버액션 카빈", icon: "🔫", desc: "사거리 4 무기.", kind: "self" },
  winchester: { label: "윈체스터", icon: "🔫", desc: "사거리 5 무기.", kind: "self" },
  barrel: { label: "술통", icon: "🛢️", desc: "뱅!이나 개틀링을 맞았을 때 카드를 뽑아 하트가 나오면 방어합니다.", kind: "self" },
  scope: { label: "쌍안경", icon: "🔭", desc: "내가 상대를 조준할 때 거리가 1 가까워집니다.", kind: "self" },
  mustang: { label: "무스탕", icon: "🐎", desc: "상대가 나를 조준할 때 거리가 1 멀어집니다.", kind: "self" },
};

const ROLE_LABEL: Record<Role, { label: string; icon: string }> = {
  sheriff: { label: "보안관", icon: "⭐" },
  deputy: { label: "부보안관", icon: "🥈" },
  outlaw: { label: "무법자", icon: "🥷" },
  renegade: { label: "배신자", icon: "🃏" },
};

const TEAM_LABEL: Record<Team, string> = {
  law: "보안관 팀 승리!",
  outlaw: "무법자 팀 승리!",
  renegade: "배신자 단독 승리!",
};

const EQUIP_ORDER: EquipSlot[] = ["weapon", "scope", "mustang", "barrel", "dynamite", "jail"];

// A wooden saloon-table panel — warm, dark wood tones instead of Hanamikoji's
// lacquerware palette, so the two games read as visually distinct rooms.
const TABLE_PANEL =
  "relative overflow-hidden rounded-3xl border border-black/50 bg-gradient-to-b from-[#3b2a1a] via-[#2a1d12] to-[#170f09] shadow-[0_0_60px_-20px_rgba(0,0,0,0.9)]";

function TableTexture() {
  return (
    <div
      className="pointer-events-none absolute inset-0 opacity-[0.06]"
      style={{
        backgroundImage:
          "repeating-linear-gradient(0deg, rgba(255,255,255,0.15) 0px, rgba(255,255,255,0.15) 1px, transparent 1px, transparent 6px)",
      }}
    />
  );
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

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

function legalTargets(state: BangState, actorSeat: SeatIndex, kind: CardKind): SeatIndex[] {
  const others = state.turnOrder.filter((s) => s !== actorSeat && state.players[s].alive);
  switch (kind) {
    case "target-bang":
      return others.filter((s) => canBang(state, actorSeat, s));
    case "target-range1":
      return others.filter((s) => effectiveDistance(state, actorSeat, s) <= 1);
    case "target-any-alive":
      return others;
    case "target-non-sheriff":
      return others.filter((s) => state.players[s].role !== "sheriff");
    default:
      return [];
  }
}

function actionForCard(
  cardId: string,
  type: CardType,
  target: { seat: SeatIndex; from?: "hand" | "equip"; equipCardId?: string } | null,
): EngineAction | null {
  switch (type) {
    case "beer":
      return { type: "play-beer", cardId };
    case "saloon":
      return { type: "play-saloon", cardId };
    case "stagecoach":
      return { type: "play-stagecoach", cardId, seed: randomSeed() };
    case "wells-fargo":
      return { type: "play-wells-fargo", cardId, seed: randomSeed() };
    case "volcanic":
    case "schofield":
    case "remington":
    case "rev-carbine":
    case "winchester":
      return { type: "play-weapon", cardId };
    case "scope":
      return { type: "play-scope", cardId };
    case "mustang":
      return { type: "play-mustang", cardId };
    case "barrel":
      return { type: "play-barrel", cardId };
    case "dynamite":
      return { type: "play-dynamite", cardId };
    case "indians":
      return { type: "play-indians", cardId };
    case "gatling":
      return { type: "play-gatling", cardId };
    case "general-store":
      return { type: "play-general-store", cardId, seed: randomSeed() };
    case "bang":
      return target ? { type: "play-bang", cardId, targetSeat: target.seat } : null;
    case "duel":
      return target ? { type: "play-duel", cardId, targetSeat: target.seat } : null;
    case "jail":
      return target ? { type: "play-jail", cardId, targetSeat: target.seat } : null;
    case "panic":
      return target
        ? { type: "play-panic", cardId, targetSeat: target.seat, from: target.from ?? "hand", equipCardId: target.equipCardId, seed: randomSeed() }
        : null;
    case "cat-balou":
      return target
        ? { type: "play-cat-balou", cardId, targetSeat: target.seat, from: target.from ?? "hand", equipCardId: target.equipCardId, seed: randomSeed() }
        : null;
    default:
      return null;
  }
}

function HeartPips({ life, maxLife }: { life: number; maxLife: number }) {
  return (
    <span className="flex gap-0.5 text-[10px] leading-none">
      {Array.from({ length: maxLife }).map((_, i) => (
        <span key={i} className={i < life ? "text-rose-400" : "text-white/15"}>
          ❤
        </span>
      ))}
    </span>
  );
}

function EquipRow({ player }: { player: PlayerState }) {
  const items = EQUIP_ORDER.map((slot) => player.equipment[slot]).filter((c): c is Card => c !== null);
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap justify-center gap-1">
      {items.map((c) => (
        <Tooltip key={c.id} text={`${CARD_META[c.type].label} — ${CARD_META[c.type].desc}`}>
          <span className="flex h-5 min-w-5 items-center justify-center gap-0.5 rounded border border-white/20 bg-black/40 px-0.5 text-[10px]">
            {CARD_META[c.type].icon}
            {c.type === "volcanic" || c.type === "schofield" || c.type === "remington" || c.type === "rev-carbine" || c.type === "winchester"
              ? weaponRange(player)
              : ""}
          </span>
        </Tooltip>
      ))}
    </div>
  );
}

function CardFace({ card, size = "md" }: { card: Card; size?: "sm" | "md" }) {
  const meta = CARD_META[card.type];
  const dims = size === "sm" ? "h-16 w-11" : "h-24 w-16";
  return (
    <Tooltip text={`${meta.label} — ${meta.desc}`}>
      <div
        className={`relative flex ${dims} flex-col items-center justify-between rounded-xl border-2 border-white/70 bg-gradient-to-b from-amber-100 via-amber-200 to-amber-400 px-1 py-1 text-amber-950 shadow-[0_4px_10px_rgba(0,0,0,0.5)]`}
      >
        <span className="text-[9px] font-bold leading-none">{card.suit}</span>
        <span className="text-xl drop-shadow-sm">{meta.icon}</span>
        <span className="rotate-180 text-[9px] font-bold leading-none">{card.suit}</span>
      </div>
    </Tooltip>
  );
}

function CardBack({ size = "sm" }: { size?: "sm" | "md" }) {
  const dims = size === "sm" ? "h-16 w-11" : "h-24 w-16";
  return (
    <div
      className={`flex ${dims} items-center justify-center rounded-xl border-2 border-white/15 shadow-[0_4px_10px_rgba(0,0,0,0.5)]`}
      style={{
        backgroundImage:
          "repeating-linear-gradient(135deg, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 2px, transparent 2px, transparent 8px), linear-gradient(160deg, #4a2f14, #1c1108)",
      }}
    >
      <span className="rounded-full border border-white/25 bg-black/30 p-1 text-sm">🤠</span>
    </div>
  );
}

/** Position of a non-viewer seat around the oval table, relative to the viewer always sitting at the bottom. */
function seatPosition(relativeIndex: number, total: number): CSSProperties {
  const angleDeg = 90 + (relativeIndex / total) * 360;
  const angleRad = (angleDeg * Math.PI) / 180;
  const x = 50 + 42 * Math.cos(angleRad);
  const y = 50 + 36 * Math.sin(angleRad);
  return { left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)" };
}

export default function BangBoard({ state, viewerSeat, names, connectedSeats, onAction, onGameEnd }: BangBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [discardSelection, setDiscardSelection] = useState<string[]>([]);

  const viewer = state.players[viewerSeat];
  const myTurn = state.turnSeat === viewerSeat;
  const selectedCard = selectedCardId ? viewer.hand.find((c) => c.id === selectedCardId) ?? null : null;
  const selectedKind = selectedCard ? CARD_META[selectedCard.type].kind : null;
  const targets = useMemo(() => {
    if (!selectedCard || !selectedKind) return [];
    return legalTargets(state, viewerSeat, selectedKind);
  }, [state, viewerSeat, selectedCard, selectedKind]);
  const isTargeting = selectedKind === "target-bang" || selectedKind === "target-range1" || selectedKind === "target-any-alive" || selectedKind === "target-non-sheriff";
  const isConfirmOnly = selectedKind === "self" || selectedKind === "none";

  function resetSelection() {
    setSelectedCardId(null);
  }

  function playSelected() {
    if (!selectedCard) return;
    const action = actionForCard(selectedCard.id, selectedCard.type, null);
    if (action) onAction(action);
    resetSelection();
  }

  function pickTarget(seat: SeatIndex, opts?: { from: "hand" | "equip"; equipCardId?: string }) {
    if (!selectedCard) return;
    const action = actionForCard(selectedCard.id, selectedCard.type, { seat, ...opts });
    if (action) onAction(action);
    resetSelection();
  }

  const hand = viewer.hand;
  const mustDiscard = state.turnPhase === "action" && myTurn && hand.length > viewer.life;
  const excessCount = Math.max(0, hand.length - viewer.life);

  function toggleDiscard(cardId: string) {
    setDiscardSelection((prev) => (prev.includes(cardId) ? prev.filter((id) => id !== cardId) : prev.length < excessCount ? [...prev, cardId] : prev));
  }

  function confirmEndTurn() {
    onAction({ type: "end-turn", discardCardIds: [] });
    setDiscardSelection([]);
    resetSelection();
  }

  function confirmDiscardAndEndTurn() {
    onAction({ type: "end-turn", discardCardIds: discardSelection });
    setDiscardSelection([]);
    resetSelection();
  }

  const otherSeats = state.turnOrder.filter((s) => s !== viewerSeat);
  const viewerOrderIdx = state.turnOrder.indexOf(viewerSeat);

  const rulebookButton = (
    <button
      onClick={() => setRulebookOpen(true)}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
    >
      📖 뱅! 룰북
    </button>
  );

  if (state.turnPhase === "game-end" && state.winner) {
    return (
      <div className={`${TABLE_PANEL} flex flex-col items-center gap-5 p-8 text-center`}>
        <TableTexture />
        <span className="relative z-10 text-5xl">🏆</span>
        <h2 className="relative z-10 text-2xl font-bold text-amber-100">{TEAM_LABEL[state.winner]}</h2>
        <div className="relative z-10 flex flex-wrap justify-center gap-2">
          {state.turnOrder.map((seat) => {
            const p = state.players[seat];
            const role = ROLE_LABEL[p.role];
            return (
              <div
                key={seat}
                className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-xs ${
                  p.alive ? "border-emerald-400/40 bg-emerald-400/10" : "border-white/10 bg-black/20 opacity-70"
                }`}
              >
                <span className="text-white/80">{names[seat]}</span>
                <span>
                  {role.icon} {role.label}
                </span>
              </div>
            );
          })}
        </div>
        <button
          onClick={onGameEnd}
          className="relative z-10 rounded-full bg-emerald-500 px-8 py-3 font-medium text-white transition hover:bg-emerald-400"
        >
          결과 확정하고 계속하기
        </button>
      </div>
    );
  }

  const pending = state.pending;
  const iOweGroupResponse = pending?.kind === "group" && pending.outstanding.includes(viewerSeat);
  const iOweDuelResponse = pending?.kind === "duel" && pending.turnToRespond === viewerSeat;
  const iOweStorePick = pending?.kind === "general-store" && pending.pickOrder[pending.nextPickIndex] === viewerSeat;

  return (
    <div className={`${TABLE_PANEL} flex flex-col gap-3 p-3 sm:p-4`}>
      <TableTexture />
      <div className="relative z-10 flex items-center justify-between text-xs text-amber-100/60">
        <span>
          {state.playerCount}인 · 턴 {state.turnNumber} · 남은 카드 {state.deck.length}장
        </span>
        {rulebookButton}
      </div>

      {/* Oval saloon table: every other seat placed around an ellipse, viewer always at the bottom. */}
      <div className="relative z-10 mx-auto h-[280px] w-full max-w-md sm:h-[320px]">
        <div
          className="absolute inset-[6%] rounded-[50%] border-4 border-emerald-900/60 bg-gradient-to-b from-emerald-800/70 to-emerald-950/70 shadow-inner"
        />
        {otherSeats.map((seat) => {
          const idx = state.turnOrder.indexOf(seat);
          const relativeIndex = (idx - viewerOrderIdx + state.playerCount) % state.playerCount;
          const player = state.players[seat];
          const isLegalTarget = isTargeting && targets.includes(seat);
          const showRole = player.role === "sheriff" || player.roleRevealed;
          const roleMeta = showRole ? ROLE_LABEL[player.role] : null;
          return (
            <div
              key={seat}
              style={seatPosition(relativeIndex, state.playerCount)}
              className="absolute flex flex-col items-center gap-0.5"
            >
              <div
                className={`flex flex-col items-center gap-0.5 rounded-xl border-2 px-2 py-1 text-center shadow-md transition ${
                  !player.alive
                    ? "border-white/10 bg-black/40 opacity-50"
                    : state.turnSeat === seat
                      ? "border-amber-300 bg-amber-950/60"
                      : "border-white/15 bg-black/40"
                } ${isLegalTarget ? "cursor-pointer ring-4 ring-amber-300" : isTargeting ? "opacity-40" : ""}`}
                onClick={() => isLegalTarget && pickTarget(seat)}
              >
                <span className="flex items-center gap-1 text-[11px] font-semibold text-white/90">
                  <span className={`h-1.5 w-1.5 rounded-full ${connectedSeats.has(seat) ? "bg-emerald-400" : "bg-white/20"}`} />
                  {names[seat]}
                </span>
                <span className="text-[10px] text-amber-200">
                  {roleMeta ? `${roleMeta.icon} ${roleMeta.label}` : "❔ 비공개"}
                </span>
                <HeartPips life={player.life} maxLife={player.maxLife} />
                <EquipRow player={player} />
                {isLegalTarget && (selectedCard?.type === "panic" || selectedCard?.type === "cat-balou") && (
                  <div className="mt-0.5 flex flex-wrap justify-center gap-1">
                    {EQUIP_ORDER.map((slot) => {
                      const c = player.equipment[slot];
                      if (!c) return null;
                      return (
                        <button
                          key={c.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            pickTarget(seat, { from: "equip", equipCardId: c.id });
                          }}
                          className="rounded border border-amber-300 bg-amber-400/30 px-1 text-[9px] text-amber-100"
                        >
                          {CARD_META[c.type].icon} 뺏기
                        </button>
                      );
                    })}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        pickTarget(seat, { from: "hand" });
                      }}
                      className="rounded border border-amber-300 bg-amber-400/30 px-1 text-[9px] text-amber-100"
                    >
                      🃏 패에서
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {/* deck/discard pile in the center */}
        <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2">
          <CardBack size="sm" />
          <span className="text-[10px] text-amber-100/70">{state.deck.length}장</span>
        </div>
      </div>

      {/* Response modal: shown only to whoever currently owes a response. */}
      {iOweGroupResponse && pending?.kind === "group" && (
        <GroupResponseModal pending={pending} viewer={viewer} onAction={onAction} viewerSeat={viewerSeat} />
      )}
      {iOweDuelResponse && pending?.kind === "duel" && (
        <DuelResponseModal viewer={viewer} onAction={onAction} viewerSeat={viewerSeat} />
      )}
      {iOweStorePick && pending?.kind === "general-store" && (
        <GeneralStoreModal pending={pending} onAction={onAction} viewerSeat={viewerSeat} />
      )}
      {pending && !iOweGroupResponse && !iOweDuelResponse && !iOweStorePick && (
        <div className="relative z-10 rounded-xl border border-white/10 bg-black/30 p-2 text-center text-xs text-amber-100/60">
          {pending.kind === "duel"
            ? `${names[pending.turnToRespond]}님이 응답 중...`
            : pending.kind === "general-store"
              ? `${names[pending.pickOrder[pending.nextPickIndex]]}님이 카드를 고르는 중...`
              : "상대가 응답을 고르는 중..."}
        </div>
      )}

      {/* Turn flow: begin-turn / action guidance / end-turn */}
      {!pending && (
        <div className="relative z-10 rounded-xl border border-white/10 bg-black/30 p-3 text-center">
          {!myTurn ? (
            <p className="text-xs text-amber-100/50">{names[state.turnSeat]}님의 차례입니다...</p>
          ) : state.turnPhase === "begin-turn" ? (
            <button
              onClick={() => onAction({ type: "begin-turn", seed: randomSeed() })}
              className="w-full rounded-xl bg-amber-600 py-3 font-medium text-white transition hover:bg-amber-500"
            >
              턴 시작 (다이너마이트/감옥 확인 · 카드 뽑기)
            </button>
          ) : mustDiscard ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-amber-100/70">
                체력({viewer.life})보다 카드가 많아요. {excessCount}장을 버리세요. ({discardSelection.length}/{excessCount} 선택됨)
              </p>
              <button
                disabled={discardSelection.length !== excessCount}
                onClick={confirmDiscardAndEndTurn}
                className="w-full rounded-xl bg-rose-600 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
              >
                선택한 카드 버리고 턴 종료
              </button>
            </div>
          ) : (
            <p className="text-xs text-amber-100/60">카드를 내거나, 턴을 종료하세요.</p>
          )}
        </div>
      )}

      {isTargeting && (
        <p className="relative z-10 text-center text-xs text-amber-200">
          대상을 고르세요 ({targets.length}명 가능) ·{" "}
          <button onClick={resetSelection} className="underline">
            취소
          </button>
        </p>
      )}
      {isConfirmOnly && selectedCard && (
        <div className="relative z-10 flex justify-center gap-2">
          <button onClick={playSelected} className="rounded-full bg-amber-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-amber-500">
            {CARD_META[selectedCard.type].label} 사용하기
          </button>
          <button onClick={resetSelection} className="rounded-full border border-white/15 px-4 py-1.5 text-xs text-white/70 hover:border-white/30">
            취소
          </button>
        </div>
      )}

      {/* My hand: fanned, face up, always visible. */}
      <div className="relative z-10">
        <p className="mb-1 text-center text-xs text-amber-100/50">
          {/* A player always knows their own role — only OTHER seats' roles are gated by public/revealed status. */}
          내 카드 · {names[viewerSeat]} (나) · {ROLE_LABEL[viewer.role].icon} {ROLE_LABEL[viewer.role].label}
        </p>
        <div className="flex justify-center pt-2">
          {hand.map((c, i) => {
            const interactive = myTurn && state.turnPhase === "action" && !pending;
            const inDiscardMode = mustDiscard;
            const isSelectedToPlay = selectedCardId === c.id;
            const isSelectedToDiscard = discardSelection.includes(c.id);
            return (
              <div key={c.id} style={fanStyle(i, hand.length, 24)}>
                <button
                  disabled={!interactive}
                  onClick={() => {
                    if (inDiscardMode) toggleDiscard(c.id);
                    else setSelectedCardId((prev) => (prev === c.id ? null : c.id));
                  }}
                  className={`relative block rounded-xl transition ${
                    isSelectedToPlay || isSelectedToDiscard ? "-translate-y-3 ring-2 ring-amber-300" : interactive ? "hover:-translate-y-1.5" : ""
                  } ${!interactive ? "opacity-90" : ""}`}
                >
                  <CardFace card={c} />
                </button>
              </div>
            );
          })}
        </div>
        {!mustDiscard && myTurn && state.turnPhase === "action" && !pending && (
          <button
            onClick={confirmEndTurn}
            className="mt-3 w-full rounded-xl border border-white/15 py-2 text-sm text-white/70 transition hover:border-white/30"
          >
            턴 종료
          </button>
        )}
      </div>

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
    </div>
  );
}

function GroupResponseModal({
  pending,
  viewer,
  viewerSeat,
  onAction,
}: {
  pending: PendingGroupResponse;
  viewer: BangState["players"][number];
  viewerSeat: SeatIndex;
  onAction: (a: EngineAction) => void;
}) {
  const matchingCards = viewer.hand.filter((c) => c.type === pending.requiredCard);
  const causeLabel = pending.cause === "bang" ? "뱅!" : pending.cause === "gatling" ? "개틀링" : "인디언!";
  return (
    <div className="relative z-10 flex flex-col gap-2 rounded-xl border border-amber-400/40 bg-black/50 p-3">
      <p className="text-center text-xs text-amber-100">
        {causeLabel}에 응답하세요! {pending.requiredCard === "missed" ? "빗나감!" : "뱅!"} 카드를 내거나 맞으세요.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {matchingCards.map((c) => (
          <button
            key={c.id}
            onClick={() => onAction({ type: "group-respond", seat: viewerSeat, mode: "card", cardId: c.id })}
            className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
          >
            {CARD_META[c.type].icon} {CARD_META[c.type].label}
          </button>
        ))}
        {pending.barrelAllowed && viewer.equipment.barrel && (
          <button
            onClick={() => onAction({ type: "group-respond", seat: viewerSeat, mode: "barrel", seed: randomSeed() })}
            className="rounded-full bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
          >
            🛢️ 술통 시도
          </button>
        )}
        <button
          onClick={() => onAction({ type: "group-respond", seat: viewerSeat, mode: "take-hit" })}
          className="rounded-full border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:border-white/40"
        >
          맞기 (체력 1 손실)
        </button>
      </div>
    </div>
  );
}

function DuelResponseModal({
  viewer,
  viewerSeat,
  onAction,
}: {
  viewer: BangState["players"][number];
  viewerSeat: SeatIndex;
  onAction: (a: EngineAction) => void;
}) {
  const bangCards = viewer.hand.filter((c) => c.type === "bang");
  return (
    <div className="relative z-10 flex flex-col gap-2 rounded-xl border border-amber-400/40 bg-black/50 p-3">
      <p className="text-center text-xs text-amber-100">듀얼! 뱅!을 내거나 포기하세요.</p>
      <div className="flex flex-wrap justify-center gap-2">
        {bangCards.map((c) => (
          <button
            key={c.id}
            onClick={() => onAction({ type: "duel-respond", seat: viewerSeat, cardId: c.id })}
            className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
          >
            💥 뱅!
          </button>
        ))}
        <button
          onClick={() => onAction({ type: "duel-respond", seat: viewerSeat, cardId: null })}
          className="rounded-full border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:border-white/40"
        >
          포기 (체력 1 손실)
        </button>
      </div>
    </div>
  );
}

function GeneralStoreModal({
  pending,
  viewerSeat,
  onAction,
}: {
  pending: PendingGeneralStore;
  viewerSeat: SeatIndex;
  onAction: (a: EngineAction) => void;
}) {
  return (
    <div className="relative z-10 flex flex-col gap-2 rounded-xl border border-amber-400/40 bg-black/50 p-3">
      <p className="text-center text-xs text-amber-100">종합 상점 — 카드 1장을 고르세요.</p>
      <div className="flex flex-wrap justify-center gap-2">
        {pending.revealed.map((c) => (
          <button key={c.id} onClick={() => onAction({ type: "general-store-pick", seat: viewerSeat, cardId: c.id })}>
            <CardFace card={c} size="sm" />
          </button>
        ))}
      </div>
    </div>
  );
}
