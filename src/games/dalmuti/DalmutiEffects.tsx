"use client";

import { useLayoutEffect, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import { CardBack, CardFace, EXCHANGE_TIER_STYLE, type AuraTier } from "./CardArt";
import type { Card, DalmutiState, SeatIndex } from "./engine";

/**
 * Purely cosmetic flourishes — no game logic lives here. Same "diff two
 * consecutive lockstep states, portal a fixed-position element, animate its
 * left/top via a CSS *transition* while a globals.css keyframe adds the
 * flourish on top" technique as every other `<Game>Effects.tsx` in this
 * project (no-thanks/AuctionEffects.tsx, century/MerchantEffects.tsx,
 * five-cucumbers/CardEffects.tsx, lasVegas/DiceEffects.tsx,
 * summonersRift/SummonersRiftEffects.tsx), so every connected client renders
 * the same flight/banner for the same state change — not just whoever
 * tapped the button.
 *
 * Three independent event kinds (task brief §2 "세금 카드 교환 애니메이션",
 * "광대 2장 보유 시 '혁명!' 이펙트", and (2026-08-25, §5) the 평민 mutual
 * exchange's own "카드 이동 애니메이션"):
 * - `TaxFlyEvent`: a card flying between two seat rows via `FlyingExchangeCard`
 *   — once for the automatic forced tribute (the instant tax phase starts),
 *   again for whatever the recipient chooses to give back (`returnTax`), and
 *   once per direction when a 평민(Commoner) pair's mutual swap completes
 *   (`detectCommonerSwapEvents`).
 * - Revolution: a full-board banner via `RevolutionBanner`, driven directly
 *   off `state.revolutionDeclared` in the caller (no diff helper needed —
 *   it's a single nullable field, not a growing list).
 *
 * 2026-08-25 후속 세션 (평민 자유 선택 교환 모달 + 비공개 마스킹 + 화려한 VFX):
 * `FlyingExchangeCard` (renamed from `FlyingTaxCard`) now takes a
 * `viewerSeat` and only renders the *real* card face to the two seats
 * actually party to that exchange (`isExchangeParticipant`) — every other
 * viewer gets a tier-colored `CardBack` and a role-title-only system
 * message, never the rank. This is UI-layer masking only: per
 * docs/architecture.md §2 this project has no server-authoritative engine,
 * so every client's `DalmutiState` already holds the real `Card` objects in
 * memory the same way every other secret (opponent hands, Avalon roles)
 * does — true network-level secrecy would need a project-wide
 * server-authoritative rewrite, explicitly out of scope here (confirmed via
 * AskUserQuestion). The flight also picked up an arc (`dalmuti-exchange-arc`),
 * tier-colored aura/particles (`dalmuti-exchange-aura-pulse`/
 * `-spark`), an arrival glow burst (`-arrival-burst`/`-shimmer`), and
 * matching launch/arrival SFX via `lib/audio/soundEngine.ts` (also new this
 * session, per user confirmation — no other game in this project has audio
 * yet, so a mute toggle was added to `DalmutiBoard.tsx` alongside it).
 */

// ---------------------------------------------------------------------------
// Tax tribute flight (also reused for the commoner mutual exchange, §5)
// ---------------------------------------------------------------------------

export interface TaxFlyEvent {
  id: number;
  /** Seat the card is flying FROM. */
  seat: SeatIndex;
  /** Seat the card is flying TO. */
  targetSeat: SeatIndex;
  cards: Card[];
  kind: "give" | "return" | "commoner";
  /** VFX/SFX tier — see `CardArt.tsx`'s `EXCHANGE_TIER_STYLE` doc. */
  auraTier: AuraTier;
}

function findCardsByIds(state: DalmutiState, holderSeat: SeatIndex, cardIds: string[]): Card[] {
  const hand = state.players.find((p) => p.seat === holderSeat)?.hand ?? [];
  const idSet = new Set(cardIds);
  return hand.filter((c) => idSet.has(c.id));
}

/**
 * Whether `viewerSeat` is actually a party to `event` — the sole masking
 * gate every renderer must consult before showing a real `CardFace` for an
 * exchange event (task brief "교환 당사자 본인들에게만... 노출"). Pure and
 * framework-free on purpose so it's testable without jsdom/RTL (this
 * project's `*.test.ts` only ever imports plain functions, per
 * docs/architecture.md §1), unlike `FlyingExchangeCard` itself.
 */
export function isExchangeParticipant(event: Pick<TaxFlyEvent, "seat" | "targetSeat">, viewerSeat: SeatIndex): boolean {
  return viewerSeat === event.seat || viewerSeat === event.targetSeat;
}

/**
 * Compares two consecutive `DalmutiState` snapshots and infers which tax
 * cards just moved, purely from the data (the reducer always returns the
 * same object reference for a rejected/no-op action, so a genuine reference
 * change here always corresponds to a real transition). `auraTier` relies on
 * `computeTributes`' fixed push order in engine.ts: the 노예↔왕(King) tribute
 * is always `tributes[0]`, the 거지↔귀족(Noble) tribute (if it exists at all,
 * n>=4) is always `tributes[1]`.
 */
export function detectTaxEvents(prev: DalmutiState, next: DalmutiState): Omit<TaxFlyEvent, "id">[] {
  if (prev === next) return [];
  const events: Omit<TaxFlyEvent, "id">[] = [];

  // Forced tribute computed the instant tax phase starts (declineRevolution,
  // or straight from startGame when nobody could declare in the first
  // place — that initial-render case has no `prev` to diff against, so its
  // flourish is simply skipped, same known limitation as every other game's
  // mount-time FX in this project).
  if (prev.tributes.length === 0 && next.tributes.length > 0) {
    next.tributes.forEach((t, i) => {
      if (t.givenCardIds.length === 0) return;
      events.push({ seat: t.fromSeat, targetSeat: t.toSeat, cards: findCardsByIds(next, t.toSeat, t.givenCardIds), kind: "give", auraTier: i === 0 ? "king" : "noble" });
    });
  }

  // Return resolution: a tribute record flips resolved false -> true.
  for (let i = 0; i < next.tributes.length; i++) {
    const nt = next.tributes[i];
    const pt = prev.tributes[i];
    if (pt && !pt.resolved && nt.resolved) {
      events.push({
        seat: nt.toSeat,
        targetSeat: nt.fromSeat,
        cards: findCardsByIds(next, nt.fromSeat, nt.returnedCardIds),
        kind: "return",
        auraTier: i === 0 ? "king" : "noble",
      });
    }
  }

  return events;
}

/**
 * Detects a 평민(Commoner) pair's swap completing (§5) by diffing two
 * consecutive states' `commonerExchange.pairs` against the actual hands.
 * `next.commonerExchange` may already be null by the time this runs — the
 * phase advances to `trick` the instant the *last* pending pair resolves —
 * so this reads `prev`'s pair list (still around) and confirms the swap
 * actually landed by checking whether the giver's hand picked up a new
 * card, rather than trusting a `resolved` flag that might already be gone.
 */
export function detectCommonerSwapEvents(prev: DalmutiState, next: DalmutiState): Omit<TaxFlyEvent, "id">[] {
  if (prev === next) return [];
  const prevPairs = prev.commonerExchange?.pairs ?? [];
  const events: Omit<TaxFlyEvent, "id">[] = [];

  for (const pair of prevPairs) {
    if (pair.resolved) continue;
    const aPicked = pair.cardIdA !== null;
    const bPicked = pair.cardIdB !== null;
    if (aPicked === bPicked) continue; // neither side had picked yet — nothing could have completed on this transition

    const giverSeat = aPicked ? pair.seatA : pair.seatB;
    const otherSeat = aPicked ? pair.seatB : pair.seatA;
    const givenCardId = (aPicked ? pair.cardIdA : pair.cardIdB)!;

    const giverHandBeforeIds = new Set((prev.players.find((p) => p.seat === giverSeat)?.hand ?? []).map((c) => c.id));
    const giverHandAfter = next.players.find((p) => p.seat === giverSeat)?.hand ?? [];
    const receivedCard = giverHandAfter.find((c) => !giverHandBeforeIds.has(c.id));
    if (!receivedCard) continue; // the other side hasn't picked yet — swap hasn't happened

    const givenCard = (next.players.find((p) => p.seat === otherSeat)?.hand ?? []).find((c) => c.id === givenCardId);
    if (!givenCard) continue; // defensive — should always be found alongside receivedCard

    events.push({ seat: giverSeat, targetSeat: otherSeat, cards: [givenCard], kind: "commoner", auraTier: "commoner" });
    events.push({ seat: otherSeat, targetSeat: giverSeat, cards: [receivedCard], kind: "commoner", auraTier: "commoner" });
  }

  return events;
}

function rectCenter(rect: DOMRect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function cardsSummaryText(cards: Card[]): string {
  return cards.map((c) => (c.isJoker ? "조커" : `${c.rank}번`)).join(", ") + " 카드";
}

const KIND_VERB: Record<TaxFlyEvent["kind"], string> = {
  give: "진상했습니다",
  return: "하사했습니다",
  commoner: "맞교환했습니다",
};

const FLIGHT_MS = 900;
const ARRIVAL_MS = 480;

/**
 * Flies one exchange event's card(s) from the giving seat's row to the
 * receiving seat's row along an arc, with tier-colored aura/particles and an
 * arrival glow burst. Masks the card face to `CardBack` (and the label to a
 * numberless role-title sentence) for every viewer who isn't
 * `isExchangeParticipant` — see this file's module doc for the masking
 * limitation.
 */
export function FlyingExchangeCard({
  event,
  viewerSeat,
  names,
  titleFor,
  getSeatEl,
  onDone,
}: {
  event: TaxFlyEvent;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  titleFor: (seat: SeatIndex) => string;
  getSeatEl: (seat: SeatIndex) => HTMLElement | null;
  onDone: (id: number) => void;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<"flying" | "arrived">("flying");
  const palette = EXCHANGE_TIER_STYLE[event.auraTier];
  const participant = isExchangeParticipant(event, viewerSeat);

  useLayoutEffect(() => {
    const el = elRef.current;
    const source = getSeatEl(event.seat);
    const target = getSeatEl(event.targetSeat);
    if (!el || !source || !target) {
      onDone(event.id);
      return;
    }
    const from = rectCenter(source.getBoundingClientRect());
    const to = rectCenter(target.getBoundingClientRect());

    const sound = getSoundEngine();
    sound.playExchangeLaunch(event.auraTier);

    el.style.transition = "none";
    el.style.left = `${from.x}px`;
    el.style.top = `${from.y}px`;
    void el.offsetHeight; // force layout so the "from" position + transition:none commits before re-enabling the transition
    el.style.transition = `left ${FLIGHT_MS}ms cubic-bezier(0.33,0.9,0.4,1), top ${FLIGHT_MS}ms cubic-bezier(0.33,0.9,0.4,1)`;

    const raf = requestAnimationFrame(() => {
      const live = elRef.current;
      if (!live) return;
      live.style.left = `${to.x}px`;
      live.style.top = `${to.y}px`;
    });
    const arriveTimeout = setTimeout(() => {
      setPhase("arrived");
      sound.playExchangeArrival(event.auraTier);
    }, FLIGHT_MS);
    const doneTimeout = setTimeout(() => onDone(event.id), FLIGHT_MS + ARRIVAL_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(arriveTimeout);
      clearTimeout(doneTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only, see FlyingPlayedCard in five-cucumbers/CardEffects.tsx for the same pattern
  }, []);

  if (typeof document === "undefined") return null;

  // Task brief §2: participants get an exact "누구에게 무엇을 주고/받았는지"
  // sentence; everyone else gets a numberless "누구와 누가 교환했는지" one.
  const label =
    viewerSeat === event.targetSeat
      ? `🎁 ${titleFor(event.seat)}(${names[event.seat]})로부터 ${cardsSummaryText(event.cards)}을(를) 받았습니다!`
      : viewerSeat === event.seat
        ? `📤 ${titleFor(event.targetSeat)}(${names[event.targetSeat]})에게 ${cardsSummaryText(event.cards)}을(를) 주었습니다`
        : `${titleFor(event.seat)}가 ${titleFor(event.targetSeat)}에게 카드 ${event.cards.length}장을 ${KIND_VERB[event.kind]}`;

  const particleCount = phase === "arrived" ? 10 : 6;
  const particles = Array.from({ length: particleCount });

  return createPortal(
    <div ref={elRef} className="pointer-events-none fixed z-[70] flex flex-col items-center" style={{ left: 0, top: 0 }}>
      {/* Tier-colored aura glow, pulsing while airborne, one big burst on arrival */}
      <div
        className="absolute top-0 left-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background: `radial-gradient(circle, ${palette.glow} 0%, transparent 70%)`,
          animation: phase === "flying" ? "dalmuti-exchange-aura-pulse 0.5s ease-in-out infinite" : "dalmuti-exchange-arrival-burst 0.45s ease-out forwards",
        }}
      />
      {/* Radial spark particles, tinted per tier via inline style (one shared keyframe, see globals.css) */}
      {particles.map((_, i) => (
        <span
          key={i}
          className="absolute top-0 left-1/2 h-1.5 w-1.5 rounded-full"
          style={
            {
              background: palette.spark,
              boxShadow: `0 0 6px 1px ${palette.spark}`,
              "--angle": `${(360 / particleCount) * i}deg`,
              animation: `dalmuti-exchange-spark ${phase === "arrived" ? "0.55s" : "0.7s"} ease-out ${(i * 0.04).toFixed(2)}s ${phase === "flying" ? "infinite" : "forwards"}`,
            } as CSSProperties
          }
        />
      ))}
      {/* The card(s) themselves, riding the arc/spin keyframe */}
      <div className="relative flex -space-x-6" style={{ animation: `dalmuti-exchange-arc ${FLIGHT_MS}ms ease-out forwards` }}>
        {event.cards.slice(0, 2).map((c) =>
          participant ? (
            <CardFace key={c.id} card={c} className={`scale-75 ${phase === "arrived" ? "dalmuti-exchange-shimmer" : ""}`} />
          ) : (
            <CardBack key={c.id} tier={event.auraTier} className={`scale-75 ${phase === "arrived" ? "dalmuti-exchange-shimmer" : ""}`} />
          ),
        )}
      </div>
      <p className={`mt-1 max-w-[220px] text-center text-[10px] font-bold ${participant ? "text-amber-200" : "text-white/60"}`}>{label}</p>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Revolution banner
// ---------------------------------------------------------------------------

/** Centered full-board "혁명!" flourish — task brief §2. Plays once per `revolutionDeclared` value change (driven by the caller, since it's a single nullable field rather than a growing event list). */
export function RevolutionBanner({
  isGrand,
  seatLabel,
  onDone,
}: {
  isGrand: boolean;
  seatLabel: string;
  onDone: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only per declaration
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center">
      <div
        className={`flex flex-col items-center gap-2 rounded-3xl border-4 px-10 py-8 text-center shadow-[0_0_80px_-10px_rgba(0,0,0,0.9)] ${
          isGrand ? "border-rose-400 bg-gradient-to-b from-rose-950/95 to-black/95" : "border-amber-300 bg-gradient-to-b from-purple-950/95 to-black/95"
        }`}
        style={{ animation: "dalmuti-revolution-burst 2.2s ease-out forwards" }}
      >
        <span className="text-6xl">{isGrand ? "🔥👑🔥" : "⚡🃏⚡"}</span>
        <h2 className={`text-3xl font-black tracking-wide ${isGrand ? "text-rose-200" : "text-amber-200"}`}>
          {isGrand ? "대혁명!" : "혁명!"}
        </h2>
        <p className="text-sm text-white/70">
          {seatLabel}님이 조커 2장으로 {isGrand ? "모든 신분을 뒤집었습니다" : "세금 바치기를 취소시켰습니다"}!
        </p>
      </div>
    </div>,
    document.body,
  );
}
