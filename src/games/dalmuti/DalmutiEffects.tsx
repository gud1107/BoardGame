"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { CardFace } from "./CardArt";
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
 * - `TaxFlyEvent`: a card sliding between two seat rows, once for the
 *   automatic forced tribute (the instant tax phase starts), again for
 *   whatever the recipient chooses to give back (`returnTax`), and — reusing
 *   the same component — once per direction when a 평민(Commoner) pair's
 *   mutual swap completes (`detectCommonerSwapEvents`).
 * - Revolution: a full-board banner via `RevolutionBanner`, driven directly
 *   off `state.revolutionDeclared` in the caller (no diff helper needed —
 *   it's a single nullable field, not a growing list).
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
}

function findCardsByIds(state: DalmutiState, holderSeat: SeatIndex, cardIds: string[]): Card[] {
  const hand = state.players.find((p) => p.seat === holderSeat)?.hand ?? [];
  const idSet = new Set(cardIds);
  return hand.filter((c) => idSet.has(c.id));
}

/**
 * Compares two consecutive `DalmutiState` snapshots and infers which tax
 * cards just moved, purely from the data (the reducer always returns the
 * same object reference for a rejected/no-op action, so a genuine reference
 * change here always corresponds to a real transition).
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
    for (const t of next.tributes) {
      if (t.givenCardIds.length === 0) continue;
      events.push({ seat: t.fromSeat, targetSeat: t.toSeat, cards: findCardsByIds(next, t.toSeat, t.givenCardIds), kind: "give" });
    }
  }

  // Return resolution: a tribute record flips resolved false -> true.
  for (let i = 0; i < next.tributes.length; i++) {
    const nt = next.tributes[i];
    const pt = prev.tributes[i];
    if (pt && !pt.resolved && nt.resolved) {
      events.push({ seat: nt.toSeat, targetSeat: nt.fromSeat, cards: findCardsByIds(next, nt.fromSeat, nt.returnedCardIds), kind: "return" });
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

    events.push({ seat: giverSeat, targetSeat: otherSeat, cards: [givenCard], kind: "commoner" });
    events.push({ seat: otherSeat, targetSeat: giverSeat, cards: [receivedCard], kind: "commoner" });
  }

  return events;
}

function rectCenter(rect: DOMRect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** Flies one tax event's card(s) from the giving seat's row to the receiving seat's row, staggered slightly if there's more than one card. */
export function FlyingTaxCard({
  event,
  getSeatEl,
  onDone,
}: {
  event: TaxFlyEvent;
  getSeatEl: (seat: SeatIndex) => HTMLElement | null;
  onDone: (id: number) => void;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);

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

    el.style.transition = "none";
    el.style.left = `${from.x}px`;
    el.style.top = `${from.y}px`;
    void el.offsetHeight; // force layout so the "from" position + transition:none commits before re-enabling the transition
    el.style.transition = "left 0.55s cubic-bezier(0.22,1,0.36,1), top 0.55s cubic-bezier(0.22,1,0.36,1)";

    const raf = requestAnimationFrame(() => {
      const live = elRef.current;
      if (!live) return;
      live.style.left = `${to.x}px`;
      live.style.top = `${to.y}px`;
    });
    const timeout = setTimeout(() => onDone(event.id), 620);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only, see FlyingPlayedCard in five-cucumbers/CardEffects.tsx for the same pattern
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div ref={elRef} className="pointer-events-none fixed z-[70] -translate-x-1/2 -translate-y-1/2" style={{ left: 0, top: 0, animation: "dalmuti-tax-fly 0.55s ease-out forwards" }}>
      <div className="flex -space-x-6">
        {event.cards.slice(0, 2).map((c) => (
          <CardFace key={c.id} card={c} className="scale-75" />
        ))}
      </div>
      <p
        className={`mt-1 text-center text-[10px] font-bold ${
          event.kind === "give" ? "text-amber-300" : event.kind === "return" ? "text-sky-300" : "text-emerald-300"
        }`}
      >
        {event.kind === "give" ? "세금 진상" : event.kind === "return" ? "하사품" : "평민 교환"}
      </p>
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
