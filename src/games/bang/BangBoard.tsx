"use client";

import { type CSSProperties, useMemo, useState } from "react";
import RulebookModal from "./RulebookModal";
import { CardFace, CardBack } from "./CardFace";
import { CARD_META, EQUIP_ORDER, ROLE_LABEL, TEAM_LABEL, type CardKind } from "./cardMeta";
import { MyEquipmentRow } from "./EquipSlotCard";
import { CenterPlayBanner, useLifeFlash, type CenterPlayEvent } from "./BangEffects";
import {
  canBang,
  effectiveDistance,
  weaponRange,
  type BangState,
  type Card,
  type CardType,
  type EngineAction,
  type PendingGeneralStore,
  type PendingGroupResponse,
  type PlayerState,
  type SeatIndex,
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
  /** Queue of "a card was just played" flourishes owned by BangGame.tsx (see BangEffects.tsx's module doc) — only the head is ever rendered at a time. */
  centerEvents: CenterPlayEvent[];
  onCenterEventDone: (id: number) => void;
}

/** Fan overlap tuned for CardFace's new 128px-wide "md" face (2026-08-21 redesign, see HANDOFF.md) — roughly the same ~30%-of-width overlap the old 80px face used, scaled up. */
const HAND_FAN_OVERLAP_PX = 40;

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
    transform: `rotate(${offset * 6}deg) translateY(${Math.abs(offset) * 8}px)`,
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

/**
 * The viewer's own HP + role, item 2 of the 2026-08-21 redesign (see
 * HANDOFF.md) — previously only OTHER seats got a life/role readout
 * (`HeartPips`/`EquipRow` in each seat badge around the oval); the viewer's
 * own seat was never rendered there at all (they sit at the bottom via the
 * hand panel instead), so this was the one seat with no HP display anywhere.
 * Placed directly above "내 카드" — the "화면 하단 중앙" the request asked for.
 */
function MyLifeAndRoleBadge({ viewer, viewerName }: { viewer: PlayerState; viewerName: string }) {
  const flash = useLifeFlash(viewer.life);
  const role = ROLE_LABEL[viewer.role];
  return (
    <div className="relative z-10 flex flex-wrap items-center justify-center gap-2 sm:gap-3">
      <div
        className={`flex items-center gap-1.5 rounded-full border-2 px-3 py-1.5 transition ${
          flash === "hit" ? "border-rose-400 bg-rose-500/20" : flash === "heal" ? "border-emerald-400 bg-emerald-500/20" : "border-white/15 bg-black/40"
        }`}
        style={flash ? { animation: `bang-hp-${flash} 0.7s ease-out` } : undefined}
      >
        <span className="flex gap-0.5 text-lg leading-none" aria-hidden>
          {Array.from({ length: viewer.maxLife }).map((_, i) => (
            <span key={i} className={i < viewer.life ? "text-rose-400" : "text-white/15"}>
              ❤
            </span>
          ))}
        </span>
        <span className="text-sm font-bold text-white">
          {viewer.life} / {viewer.maxLife}
        </span>
      </div>
      <div className="flex items-center gap-1.5 rounded-full border-2 border-amber-400/60 bg-amber-500/15 px-3 py-1.5">
        <span className="text-lg leading-none">{role.icon}</span>
        <span className="text-sm font-bold text-amber-100">{role.label}</span>
      </div>
      <span className="text-xs text-amber-100/50">{viewerName} (나)</span>
    </div>
  );
}

// Compact icon+range chip for the OTHER seats around the oval table — no
// room for full prose per opponent without crowding every seat badge (see
// EquipSlotCard.tsx's `EquipSlotCard`/`MyEquipmentRow`, used instead for the
// viewer's own equipment panel). No Tooltip wrap any more (2026-08-21
// redesign, see HANDOFF.md item 1's "제거" instruction) — this was the last
// remaining Tooltip usage in the bang folder.
function EquipRow({ player }: { player: PlayerState }) {
  const items = EQUIP_ORDER.map((slot) => player.equipment[slot]).filter((c): c is Card => c !== null);
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap justify-center gap-1">
      {items.map((c) => (
        <span
          key={c.id}
          className="flex h-5 min-w-5 items-center justify-center gap-0.5 rounded border border-white/20 bg-black/40 px-0.5 text-[10px]"
        >
          {CARD_META[c.type].icon}
          {c.type === "volcanic" || c.type === "schofield" || c.type === "remington" || c.type === "rev-carbine" || c.type === "winchester"
            ? weaponRange(player)
            : ""}
        </span>
      ))}
    </div>
  );
}

/**
 * Position of a non-viewer seat around the oval table, relative to the
 * viewer always sitting at the bottom. Radius grows a little past 6 players
 * so the extra seat badges spread further apart instead of just packing
 * closer together at a fixed radius — paired with `seatBadgeScale`'s
 * shrinking badge/text/gap sizes below, this is what keeps an 8-player
 * table's badges from overlapping near the ellipse's top and sides.
 */
function seatPosition(relativeIndex: number, total: number): CSSProperties {
  const angleDeg = 90 + (relativeIndex / total) * 360;
  const angleRad = (angleDeg * Math.PI) / 180;
  const radiusX = total >= 7 ? 46 : 42;
  const radiusY = total >= 7 ? 40 : 36;
  const x = 50 + radiusX * Math.cos(angleRad);
  const y = 50 + radiusY * Math.sin(angleRad);
  return { left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)" };
}

/** Seat-badge padding/gap/text sizing, scaled down as the table gets more
 * crowded (7-8 players) so badges keep clear of each other around the oval —
 * at 4-6 players this matches the original fixed sizing exactly. */
function seatBadgeScale(total: number): { pad: string; gap: string; name: string; role: string } {
  if (total >= 8) return { pad: "px-1.5 py-0.5", gap: "gap-px", name: "text-[9px]", role: "text-[8px]" };
  if (total === 7) return { pad: "px-2 py-1", gap: "gap-0.5", name: "text-[10px]", role: "text-[9px]" };
  return { pad: "px-2 py-1", gap: "gap-0.5", name: "text-[11px]", role: "text-[10px]" };
}

export default function BangBoard({
  state,
  viewerSeat,
  names,
  connectedSeats,
  onAction,
  onGameEnd,
  centerEvents,
  onCenterEventDone,
}: BangBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  // Which hand card currently has the mouse over it, so its wrapper's
  // z-index can be bumped above sibling cards on hover — a CSS `:hover`
  // class alone can't do this (see CardFace.tsx's module doc: every fanned
  // wrapper below already has its own inline-styled z-index from `fanStyle`,
  // and a plain stylesheet `:hover` rule never outranks an inline style).
  const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);
  const [discardSelection, setDiscardSelection] = useState<string[]>([]);
  // Only true once the viewer has actually chosen to end their turn while
  // over the hand limit — the real rule discards down to life *at end of
  // turn*, not throughout the whole action phase. Gating on hand-size alone
  // (regardless of this flag) used to force discard-only mode the instant a
  // low-life player drew back up over their limit, before they could play
  // anything at all. See BangBoard bug write-up in HANDOFF.md.
  const [discarding, setDiscarding] = useState(false);

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
  const overHandLimit = state.turnPhase === "action" && myTurn && hand.length > viewer.life;
  const excessCount = Math.max(0, hand.length - viewer.life);

  function toggleDiscard(cardId: string) {
    setDiscardSelection((prev) => (prev.includes(cardId) ? prev.filter((id) => id !== cardId) : prev.length < excessCount ? [...prev, cardId] : prev));
  }

  // Entry point for the "턴 종료" button: only the *attempt* to end turn should
  // ever require discarding down to the hand limit — playing cards during the
  // action phase must stay available even while over the limit (the player
  // may well play their way back under it instead of discarding).
  function requestEndTurn() {
    if (overHandLimit) {
      setDiscarding(true);
      setDiscardSelection([]);
      resetSelection();
      return;
    }
    onAction({ type: "end-turn", discardCardIds: [] });
    setDiscardSelection([]);
    resetSelection();
  }

  function cancelDiscard() {
    setDiscarding(false);
    setDiscardSelection([]);
  }

  function confirmDiscardAndEndTurn() {
    onAction({ type: "end-turn", discardCardIds: discardSelection });
    setDiscarding(false);
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
      {centerEvents[0] && (
        <CenterPlayBanner key={centerEvents[0].id} event={centerEvents[0]} names={names} onDone={() => onCenterEventDone(centerEvents[0].id)} />
      )}
      <div className="relative z-10 flex items-center justify-between text-xs text-amber-100/60">
        <span>
          {state.playerCount}인 · 턴 {state.turnNumber} · 남은 카드 {state.deck.length}장
        </span>
        {rulebookButton}
      </div>

      {/* Oval saloon table: every other seat placed around an ellipse, viewer always at the bottom.
          Container grows a bit past 6 players so seatPosition's wider radius has more room to work with. */}
      <div
        className={`relative z-10 mx-auto w-full max-w-md ${
          state.playerCount >= 7 ? "h-[320px] sm:h-[380px]" : "h-[280px] sm:h-[320px]"
        }`}
      >
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
          const scale = seatBadgeScale(state.playerCount);
          return (
            <div
              key={seat}
              style={seatPosition(relativeIndex, state.playerCount)}
              className="absolute flex flex-col items-center gap-0.5"
            >
              <div
                className={`flex flex-col items-center ${scale.gap} rounded-xl border-2 ${scale.pad} text-center shadow-md transition ${
                  !player.alive
                    ? "border-white/10 bg-black/40 opacity-50"
                    : state.turnSeat === seat
                      ? "border-amber-300 bg-amber-950/60"
                      : "border-white/15 bg-black/40"
                } ${isLegalTarget ? "cursor-pointer ring-4 ring-amber-300" : isTargeting ? "opacity-40" : ""}`}
                onClick={() => isLegalTarget && pickTarget(seat)}
              >
                <span className={`flex items-center gap-1 font-semibold text-white/90 ${scale.name}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${connectedSeats.has(seat) ? "bg-emerald-400" : "bg-white/20"}`} />
                  {names[seat]}
                </span>
                <span className={`text-amber-200 ${scale.role}`}>
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
          ) : discarding && overHandLimit ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-amber-100/70">
                체력({viewer.life})보다 카드가 많아요. {excessCount}장을 버리세요. ({discardSelection.length}/{excessCount} 선택됨)
              </p>
              <div className="flex gap-2">
                <button
                  disabled={discardSelection.length !== excessCount}
                  onClick={confirmDiscardAndEndTurn}
                  className="flex-1 rounded-xl bg-rose-600 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
                >
                  선택한 카드 버리고 턴 종료
                </button>
                <button
                  onClick={cancelDiscard}
                  className="rounded-xl border border-white/15 px-3 py-2 text-sm text-white/70 transition hover:border-white/30"
                >
                  취소
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-amber-100/60">
              {overHandLimit
                ? `카드를 내거나, 턴을 종료하세요. (턴 종료 시 ${excessCount}장을 버려야 해요)`
                : "카드를 내거나, 턴을 종료하세요."}
            </p>
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

      {/* Own HP/role, always visible — item 2 of the 2026-08-21 redesign, see MyLifeAndRoleBadge's doc. */}
      <MyLifeAndRoleBadge viewer={viewer} viewerName={names[viewerSeat]} />
      {/* Own equipped items, full name+range+effect text — item 3 of the same redesign (EquipSlotCard.tsx). */}
      <div className="relative z-10">
        <MyEquipmentRow player={viewer} />
      </div>

      {/* My hand: fanned, face up, always visible. */}
      <div className="relative z-10">
        <p className="mb-1 text-center text-xs text-amber-100/50">내 카드</p>
        <div className="flex justify-center pt-2 pb-2">
          {hand.map((c, i) => {
            const interactive = myTurn && state.turnPhase === "action" && !pending;
            const inDiscardMode = discarding && overHandLimit;
            const isSelectedToPlay = selectedCardId === c.id;
            const isSelectedToDiscard = discardSelection.includes(c.id);
            const isHovered = hoveredCardId === c.id;
            const isSelected = isSelectedToPlay || isSelectedToDiscard;
            // A single source for the transform utilities so a selected card
            // that's ALSO currently hovered doesn't end up with two
            // conflicting `-translate-y-*` classes fighting for the same CSS
            // property (Tailwind can't merge them — whichever lands later in
            // the generated stylesheet silently wins).
            const transformClass =
              interactive && isHovered
                ? "-translate-y-9 scale-[1.18] shadow-[0_25px_50px_-10px_rgba(0,0,0,0.9)]"
                : isSelected
                  ? "-translate-y-3"
                  : interactive
                    ? "hover:-translate-y-1.5"
                    : "";
            return (
              <div
                key={c.id}
                style={{ ...fanStyle(i, hand.length, HAND_FAN_OVERLAP_PX), zIndex: isHovered ? 200 : i }}
                onMouseEnter={() => setHoveredCardId(c.id)}
                onMouseLeave={() => setHoveredCardId((prev) => (prev === c.id ? null : prev))}
              >
                <button
                  disabled={!interactive}
                  onClick={() => {
                    if (inDiscardMode) toggleDiscard(c.id);
                    else setSelectedCardId((prev) => (prev === c.id ? null : c.id));
                  }}
                  className={`relative block origin-bottom rounded-xl transition-transform duration-200 ease-out ${transformClass} ${
                    isSelected ? "ring-2 ring-amber-300" : ""
                  } ${!interactive ? "opacity-90" : ""}`}
                >
                  <CardFace card={c} />
                </button>
              </div>
            );
          })}
        </div>
        {!(discarding && overHandLimit) && myTurn && state.turnPhase === "action" && !pending && (
          <button
            onClick={requestEndTurn}
            className="mt-3 w-full rounded-xl border border-white/15 py-2 text-sm text-white/70 transition hover:border-white/30"
          >
            턴 종료{overHandLimit ? ` (버릴 카드 선택 필요: ${excessCount}장)` : ""}
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
