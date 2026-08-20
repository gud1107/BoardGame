"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CardFace } from "./CardFace";
import { CARD_META, EQUIP_ORDER } from "./cardMeta";
import type { BangState, Card, CardType, EngineAction, SeatIndex } from "./engine";

/**
 * BangBoard's cosmetic flourishes — item 4/5 of the 2026-08-21 hover/HP/
 * center-banner redesign (see HANDOFF.md): a face-up card popping up at the
 * table's center plus a bold "who played what on whom" banner, held for
 * ~1.8s, every time ANY card gets played by ANYONE (including the viewer's
 * own plays — the user explicitly chose "나/상대 모두 동일 연출" over the
 * literal "상대 카드 사용 시" wording of the request, so this covers both).
 *
 * Unlike every other `<Game>Effects.tsx` in this project (which diff two
 * consecutive `state` snapshots — see e.g. coup/CoupEffects.tsx's
 * `detectNewlyEliminated`), Bang's events are derived from the raw
 * `EngineAction` itself, not a state diff: a life delta alone can't tell a
 * bang hit apart from a duel loss, an indians hit, a gatling hit, or a
 * dynamite explosion, and several plays (scope, general-store, ...) don't
 * touch life at all. `deriveCenterEvent` is instead called from
 * BangGame.tsx's single `game-action` broadcast handler, which already has
 * both the pre-action `BangState` (via its existing `gameStateRef`) and the
 * action responsible — see that file's module doc.
 *
 * Deliberately does NOT cover `group-respond` mode "take-hit",
 * `general-store-pick`, or `end-turn`/`begin-turn` — none of those are "a
 * card being played" (no face to reveal), and the per-seat `HeartPips`
 * pulse (`useLifeFlash` below) already gives immediate feedback for the
 * life loss a take-hit causes.
 */

export interface CenterPlayEvent {
  id: number;
  actorSeat: SeatIndex;
  cardType: CardType;
  targetSeat: SeatIndex | null;
  /** Short trailing clause appended to the banner, e.g. "반격!", "포기 (체력 1 손실)", "장착 아이템 뺏음: 🔫 볼카닉". */
  note: string | null;
  /** Which flourish plays over the reveal — see the `bang-*` keyframes in globals.css. */
  effect: "bang" | "missed" | "duel" | "dynamite" | "heal" | "plain";
  /** The actual card played, when it was resolvable out of a hand/equipment slot (real suit/rank for the center reveal) — falls back to a synthetic placeholder in CenterPlayBanner when absent (e.g. the "포기" duel-respond has no card at all). */
  card?: Card;
}

function findHandCard(state: BangState, seat: SeatIndex, cardId: string): Card | undefined {
  return state.players[seat]?.hand.find((c) => c.id === cardId);
}

/** Looks up the label of whatever's equipped in `equipCardId` on `seat`, for panic/cat-balou's "뺏음" note. */
function findEquippedLabel(state: BangState, seat: SeatIndex, equipCardId: string): string | null {
  const player = state.players[seat];
  if (!player) return null;
  for (const slot of EQUIP_ORDER) {
    const c = player.equipment[slot];
    if (c && c.id === equipCardId) return `${CARD_META[c.type].icon} ${CARD_META[c.type].label}`;
  }
  return null;
}

let nextEventId = 1;

/** See this file's module doc — called with the state as it was JUST BEFORE `action` is applied. Returns null for actions that aren't "a card being played" (see module doc). */
export function deriveCenterEvent(prevState: BangState, action: EngineAction): CenterPlayEvent | null {
  const turnSeat = prevState.turnSeat;
  /** Resolves `cardId` out of `seat`'s hand and builds the event around its real type+suit — every play-* action's card is still in the actor's hand at this point (this runs on the PRE-action state), so this covers all of them uniformly instead of hand-naming each card type per case. */
  const fromHand = (seat: SeatIndex, cardId: string, opts: Partial<CenterPlayEvent> = {}): CenterPlayEvent | null => {
    const card = findHandCard(prevState, seat, cardId);
    if (!card) return null;
    return { id: nextEventId++, actorSeat: seat, cardType: card.type, targetSeat: null, note: null, effect: "plain", card, ...opts };
  };

  switch (action.type) {
    case "play-bang":
      return fromHand(turnSeat, action.cardId, { targetSeat: action.targetSeat, effect: "bang" });
    case "play-beer":
      return fromHand(turnSeat, action.cardId, { effect: "heal" });
    case "play-saloon":
      return fromHand(turnSeat, action.cardId, { effect: "heal" });
    case "play-duel":
      return fromHand(turnSeat, action.cardId, { targetSeat: action.targetSeat, effect: "duel" });
    case "play-indians":
      return fromHand(turnSeat, action.cardId);
    case "play-gatling":
      return fromHand(turnSeat, action.cardId, { effect: "bang" });
    case "play-general-store":
      return fromHand(turnSeat, action.cardId);
    case "play-stagecoach":
      return fromHand(turnSeat, action.cardId);
    case "play-wells-fargo":
      return fromHand(turnSeat, action.cardId);
    case "play-dynamite":
      return fromHand(turnSeat, action.cardId, { effect: "dynamite" });
    case "play-scope":
      return fromHand(turnSeat, action.cardId);
    case "play-mustang":
      return fromHand(turnSeat, action.cardId);
    case "play-barrel":
      return fromHand(turnSeat, action.cardId);
    case "play-jail":
      return fromHand(turnSeat, action.cardId, { targetSeat: action.targetSeat });
    case "play-weapon":
      return fromHand(turnSeat, action.cardId);
    case "play-panic":
    case "play-cat-balou": {
      const verb = action.type === "play-panic" ? "뺏음" : "버리게 함";
      const note = action.from === "equip" && action.equipCardId ? `${findEquippedLabel(prevState, action.targetSeat, action.equipCardId) ?? "장비"} ${verb}` : `패에서 ${verb}`;
      return fromHand(turnSeat, action.cardId, { targetSeat: action.targetSeat, note });
    }
    case "group-respond": {
      if (action.mode === "card") {
        const isMissed = findHandCard(prevState, action.seat, action.cardId)?.type === "missed";
        return fromHand(action.seat, action.cardId, { note: isMissed ? "방어!" : "반격!", effect: isMissed ? "missed" : "bang" });
      }
      if (action.mode === "barrel") {
        return { id: nextEventId++, actorSeat: action.seat, cardType: "barrel", targetSeat: null, note: "술통 방어 시도", effect: "plain", card: prevState.players[action.seat]?.equipment.barrel ?? undefined };
      }
      return null; // take-hit — no card face to show, HP pulse covers it
    }
    case "duel-respond": {
      if (action.cardId) {
        return fromHand(action.seat, action.cardId, { note: "반격!", effect: "duel" });
      }
      return { id: nextEventId++, actorSeat: action.seat, cardType: "duel", targetSeat: null, note: "포기 (체력 1 손실)", effect: "duel" };
    }
    default:
      return null; // begin-turn / general-store-pick / end-turn
  }
}

const EFFECT_ICON: Record<CenterPlayEvent["effect"], string | null> = {
  bang: "💥",
  missed: "🛡️",
  duel: "⚡",
  dynamite: "🧨",
  heal: "✨",
  plain: null,
};

const EFFECT_RING: Record<CenterPlayEvent["effect"], string> = {
  bang: "border-rose-400/70 shadow-[0_0_70px_-10px_rgba(244,63,94,0.7)]",
  missed: "border-sky-400/70 shadow-[0_0_70px_-10px_rgba(56,189,248,0.7)]",
  duel: "border-amber-300/80 shadow-[0_0_70px_-10px_rgba(251,191,36,0.75)]",
  dynamite: "border-rose-500/80 shadow-[0_0_70px_-10px_rgba(225,29,72,0.8)]",
  heal: "border-emerald-400/70 shadow-[0_0_70px_-10px_rgba(52,211,153,0.7)]",
  plain: "border-amber-500/40 shadow-[0_0_50px_-10px_rgba(0,0,0,0.7)]",
};

const EVENT_DURATION_MS = 1800;

/** Portals a face-up card + "who → what [대상: whom]" banner to the center of the screen. Renders exactly one `CenterPlayEvent` at a time — BangBoard queues the rest (see its `centerEvents` prop) and advances via `onDone`. */
export function CenterPlayBanner({
  event,
  names,
  onDone,
}: {
  event: CenterPlayEvent;
  names: Record<SeatIndex, string>;
  onDone: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDone, EVENT_DURATION_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only, same pattern as every other <Game>Effects.tsx toast
  }, []);

  if (typeof document === "undefined") return null;

  const meta = CARD_META[event.cardType];
  const icon = EFFECT_ICON[event.effect];
  const bannerText = `${names[event.actorSeat] ?? "?"} ➔ ${meta.icon} ${meta.label} 사용${event.targetSeat !== null ? ` [대상: ${names[event.targetSeat] ?? "?"}]` : ""}`;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center">
      <div className="flex flex-col items-center gap-3" style={{ animation: "bang-center-reveal 0.35s ease-out both" }}>
        <div className="relative">
          {icon && (
            <span
              aria-hidden
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-6xl"
              style={{
                animation:
                  event.effect === "bang"
                    ? "bang-muzzle-flash 0.5s ease-out"
                    : event.effect === "missed"
                      ? "bang-shield-swish 0.6s ease-out"
                      : event.effect === "duel" || event.effect === "dynamite"
                        ? "bang-duel-tension 1.1s ease-in-out infinite"
                        : "bang-heal-glow 1.1s ease-in-out infinite",
              }}
            >
              {icon}
            </span>
          )}
          <div className={`rounded-xl border-4 bg-black/20 p-1 ${EFFECT_RING[event.effect]}`}>
            <CardFace card={event.card ?? { id: "center-preview", type: event.cardType, suit: "S", rank: 2 }} size="md" />
          </div>
        </div>
        <div
          className="max-w-[min(90vw,26rem)] rounded-2xl border border-amber-300/60 bg-gradient-to-r from-amber-950/95 via-black/90 to-amber-950/95 px-5 py-2.5 text-center shadow-[0_10px_40px_-10px_rgba(0,0,0,0.8)]"
          style={{ animation: "bang-banner-slide 0.3s ease-out 0.1s both" }}
        >
          <p className="text-sm font-bold whitespace-nowrap text-amber-100">{bannerText}</p>
          {event.note && <p className="mt-0.5 text-xs font-semibold text-amber-300">{event.note}</p>}
          <p className="mt-0.5 text-[11px] text-amber-100/60">{meta.desc}</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** "hit" (life just went down) or "heal" (life just went up), for the viewer's own HP badge's pulse/flash. Returns null on the very first render (no previous value to compare against) and whenever life didn't change. */
export function useLifeFlash(life: number): "hit" | "heal" | null {
  const prevRef = useRef(life);
  const [flash, setFlash] = useState<"hit" | "heal" | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = life;
    if (life === prev) return;
    setFlash(life < prev ? "hit" : "heal");
    const t = setTimeout(() => setFlash(null), 700);
    return () => clearTimeout(t);
  }, [life]);

  return flash;
}
