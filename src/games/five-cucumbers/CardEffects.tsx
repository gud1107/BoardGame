"use client";

import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { CucumberIcon } from "./CucumberIcon";
import { cucumberCount, type Card, type FiveCucumbersState, type SeatIndex } from "./engine";

/**
 * Purely cosmetic flourishes for the trick table — no game logic lives here.
 * Same "diff two consecutive lockstep states, portal a fixed-position
 * element, animate its left/top via a CSS *transition* while a globals.css
 * keyframe adds the flourish on top" technique as no-thanks/AuctionEffects.tsx
 * and century/MerchantEffects.tsx, so every connected client renders the
 * same flight for the same play — not just whoever tapped the card.
 *
 * Two independent event kinds:
 * - `CardPlayEvent` (task brief §3): a single card sliding from the player's
 *   hand/seat into the central trick area the instant it's played.
 * - `CucumberPickupEvent` (task brief §4): one cucumber token at a time
 *   flying from the trick area to the round's cucumber-winner's scoreboard
 *   badge, staggered so a 4-cucumber penalty visibly arrives as 4 separate
 *   hops instead of one lump sum.
 */

// ---------------------------------------------------------------------------
// Card play FX
// ---------------------------------------------------------------------------

export interface CardPlayEvent {
  id: number;
  seat: SeatIndex;
  card: Card;
}

/**
 * Compares two consecutive `FiveCucumbersState` snapshots and infers "one
 * card was just played, by whom" purely from the data. Two shapes to handle:
 *
 * 1. A non-final play in a trick: `trickPlays` simply grows by one entry —
 *    the new play is the last element.
 * 2. The play that *completes* a trick: `playCard` returns a state with
 *    `trickPlays` already reset to `[]` for the next trick (or next round,
 *    if it was trick 7) in the very same transition, so the just-played card
 *    only survives inside the fresh `lastTrickResult.plays` — matched here
 *    against `prev`'s round/trick number (not `next`'s, which may have
 *    already advanced past a round rollover) to make sure it's really the
 *    trick `prev` was mid-way through, not some later one.
 *
 * The reducer always returns the same object reference for a rejected/no-op
 * action (see engine.ts), so a genuine reference change here always
 * corresponds to a real play.
 */
export function detectCardPlayEvent(prev: FiveCucumbersState, next: FiveCucumbersState): Omit<CardPlayEvent, "id"> | null {
  if (prev === next) return null;

  if (next.roundNumber === prev.roundNumber && next.trickNumber === prev.trickNumber && next.trickPlays.length === prev.trickPlays.length + 1) {
    const play = next.trickPlays[next.trickPlays.length - 1];
    return { seat: play.seat, card: play.card };
  }

  if (next.lastTrickResult && next.lastTrickResult !== prev.lastTrickResult) {
    const result = next.lastTrickResult;
    if (result.roundNumber === prev.roundNumber && result.trickNumber === prev.trickNumber && result.plays.length === prev.trickPlays.length + 1) {
      const play = result.plays[result.plays.length - 1];
      return { seat: play.seat, card: play.card };
    }
  }

  return null;
}

function rectCenter(rect: DOMRect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * Flies a single card face from the playing seat's hand/row to the central
 * trick area, portaled to `document.body` so its `position: fixed`
 * coordinates aren't affected by any ancestor's transform/overflow. Removes
 * itself via `onDone` once the flourish finishes — the real `TrickSlot`
 * underneath is already showing the same card by the time this lands (React
 * already applied the state update), so no game state depends on this timer.
 */
export function FlyingPlayedCard({
  event,
  getSourceEl,
  getTargetEl,
  onDone,
}: {
  event: CardPlayEvent;
  getSourceEl: () => HTMLElement | null;
  getTargetEl: () => HTMLElement | null;
  onDone: (id: number) => void;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);

  // Mount-only flight — this component is always freshly mounted with a
  // stable `key={event.id}`, and re-running mid-flight on a source/target
  // re-render would restart it.
  useLayoutEffect(() => {
    const el = elRef.current;
    const source = getSourceEl();
    const target = getTargetEl();
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
    el.style.transition = "left 0.45s cubic-bezier(0.22,1,0.36,1), top 0.45s cubic-bezier(0.22,1,0.36,1)";

    const raf = requestAnimationFrame(() => {
      const live = elRef.current;
      if (!live) return;
      live.style.left = `${to.x}px`;
      live.style.top = `${to.y}px`;
    });
    const timeout = setTimeout(() => onDone(event.id), 480);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only, see comment above
  }, []);

  if (typeof document === "undefined") return null;

  const cucumbers = cucumberCount(event.card.value);
  return createPortal(
    <div
      ref={elRef}
      className="pointer-events-none fixed z-[70] -translate-x-1/2 -translate-y-1/2"
      style={{ left: 0, top: 0, animation: "card-play-slide 0.45s ease-out forwards" }}
    >
      <div className="flex h-16 w-11 flex-col items-center justify-between rounded-md border border-white/40 bg-gradient-to-b from-emerald-800 to-emerald-950 p-1 shadow-[0_8px_20px_-6px_rgba(0,0,0,0.8)]">
        <span className="text-base leading-none font-black text-white">{event.card.value}</span>
        {cucumbers > 0 && (
          <span className="flex items-center gap-0.5 text-[9px] text-white/70">
            <CucumberIcon className="h-2.5 w-2.5" />
            {cucumbers}
          </span>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Sequential cucumber pickup FX
// ---------------------------------------------------------------------------

export interface CucumberPickupEvent {
  id: number;
  seat: SeatIndex;
  /** This token's 1-based position within its seat's batch — drives the stagger delay and the "N/total" label. */
  index: number;
  total: number;
}

/** Rulebook §3 penalty settlement → one `CucumberPickupEvent` per cucumber, per winner, staggered so a multi-cucumber penalty arrives as visibly separate hops (task brief §4). */
export function buildCucumberPickupEvents(
  winnerSeats: SeatIndex[],
  cucumberPenaltyEach: number,
  nextId: () => number,
): CucumberPickupEvent[] {
  const events: CucumberPickupEvent[] = [];
  for (const seat of winnerSeats) {
    for (let i = 0; i < cucumberPenaltyEach; i++) {
      events.push({ id: nextId(), seat, index: i, total: cucumberPenaltyEach });
    }
  }
  return events;
}

const CUCUMBER_HOP_STAGGER_MS = 340;
const CUCUMBER_HOP_FLIGHT_MS = 420;

/**
 * Flies a single cucumber token from the trick area to the winning seat's
 * scoreboard badge. All events in a batch mount at once (so React only
 * re-renders once), but each delays the start of its own flight by
 * `index * CUCUMBER_HOP_STAGGER_MS` via `setTimeout` — the net effect is the
 * same one-at-a-time cadence as sequencing them with actual delayed mounts,
 * without needing a parent-owned timer queue.
 */
export function FlyingCucumber({
  event,
  getSourceEl,
  getTargetEl,
  onDone,
}: {
  event: CucumberPickupEvent;
  getSourceEl: () => HTMLElement | null;
  getTargetEl: () => HTMLElement | null;
  onDone: (id: number) => void;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const startDelay = event.index * CUCUMBER_HOP_STAGGER_MS;

  // All events in a batch mount in the same tick, but each waits out its own
  // `startDelay` (via `setTimeout`, not CSS `animation-delay`) before doing
  // anything visible — until then it just sits at the source position with
  // `opacity: 0`. Once its turn comes, it plays the same "pop in + fly to
  // target" sequence FlyingToken uses, just started late instead of at
  // mount. Kept as one plain `let` (not a ref/stash) since the cleanup below
  // closes over it directly.
  useLayoutEffect(() => {
    const el = elRef.current;
    const source = getSourceEl();
    const target = getTargetEl();
    if (!el || !source || !target) {
      onDone(event.id);
      return;
    }
    const from = rectCenter(source.getBoundingClientRect());
    const to = rectCenter(target.getBoundingClientRect());

    el.style.left = `${from.x}px`;
    el.style.top = `${from.y}px`;
    el.style.opacity = "0";

    let raf = 0;
    const startTimeout = setTimeout(() => {
      const live = elRef.current;
      if (!live) return;
      live.style.opacity = "1";
      live.style.animation = "cucumber-hop-pop 0.42s ease-out";
      live.style.transition = "none";
      live.style.left = `${from.x}px`;
      live.style.top = `${from.y}px`;
      void live.offsetHeight; // force layout so the "from" position + transition:none commits before re-enabling the transition
      live.style.transition = `left ${CUCUMBER_HOP_FLIGHT_MS}ms cubic-bezier(0.22,1,0.36,1), top ${CUCUMBER_HOP_FLIGHT_MS}ms cubic-bezier(0.22,1,0.36,1)`;
      raf = requestAnimationFrame(() => {
        const inner = elRef.current;
        if (!inner) return;
        inner.style.left = `${to.x}px`;
        inner.style.top = `${to.y}px`;
      });
    }, startDelay);

    const doneTimeout = setTimeout(() => onDone(event.id), startDelay + CUCUMBER_HOP_FLIGHT_MS + 80);

    return () => {
      clearTimeout(startTimeout);
      clearTimeout(doneTimeout);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only (per-event start delay is fixed at mount), see comment above
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div ref={elRef} className="pointer-events-none fixed z-[70]" style={{ left: 0, top: 0, opacity: 0 }}>
      <div
        title={`오이 ${event.index + 1}/${event.total}`}
        className="flex h-7 w-7 items-center justify-center rounded-full border border-emerald-300/60 bg-black/70 shadow-[0_6px_16px_-4px_rgba(0,0,0,0.85)]"
      >
        <CucumberIcon className="h-4 w-4" />
      </div>
    </div>,
    document.body,
  );
}
