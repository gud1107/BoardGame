"use client";

import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { TileFace } from "./TileFace";
import { wormsOnTile, type SeatIndex, type WormState } from "./engine";

/**
 * Purely cosmetic tile-claim/steal flourish — no game logic here. Same "diff
 * two consecutive lockstep states, portal a fixed-position element, animate
 * its left/top via a CSS *transition* while a globals.css keyframe adds the
 * flourish on top" technique as five-cucumbers/CardEffects.tsx and
 * lasVegas/DiceEffects.tsx, so every connected client renders the same
 * flight for the same claim — not just whoever pressed "스톱".
 */

export interface ClaimFlightEvent {
  id: number;
  seat: SeatIndex;
  tileNumber: number;
  /** "center" for a straight center pickup; a seat index when it was stolen off that seat's stack top. */
  source: "center" | SeatIndex;
}

/**
 * Compares two consecutive `WormState` snapshots and infers "a tile was just
 * claimed or stolen, by whom, from where" purely from the `lastEvent` field
 * the reducer already stamps on every successful `stop`. The reducer always
 * returns the same object reference for a rejected/no-op action, so a
 * genuine reference change here always corresponds to a real resolution —
 * bust events are intentionally not flown (see WormBoard's plain toast).
 */
export function detectClaimFlightEvent(prev: WormState, next: WormState): Omit<ClaimFlightEvent, "id"> | null {
  if (prev === next || !next.lastEvent || next.lastEvent === prev.lastEvent) return null;
  const event = next.lastEvent;
  if (event.kind === "claimed") return { seat: event.seat, tileNumber: event.tileNumber, source: "center" };
  if (event.kind === "stolen") return { seat: event.seat, tileNumber: event.tileNumber, source: event.fromSeat };
  return null;
}

function rectCenter(rect: DOMRect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

const FLIGHT_MS = 520;

export function FlyingTile({
  event,
  getSourceEl,
  getTargetEl,
  onDone,
}: {
  event: ClaimFlightEvent;
  getSourceEl: () => HTMLElement | null;
  getTargetEl: () => HTMLElement | null;
  onDone: (id: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const source = getSourceEl();
    const target = getTargetEl();
    const el = ref.current;
    if (!source || !target || !el) {
      onDone(event.id);
      return;
    }
    const from = rectCenter(source.getBoundingClientRect());
    const to = rectCenter(target.getBoundingClientRect());
    el.style.transition = "none";
    el.style.left = `${from.x}px`;
    el.style.top = `${from.y}px`;
    void el.offsetHeight; // force layout so "from" + transition:none commits before re-enabling the transition
    const raf = requestAnimationFrame(() => {
      el.style.transition = `left ${FLIGHT_MS}ms cubic-bezier(0.22,1,0.36,1), top ${FLIGHT_MS}ms cubic-bezier(0.22,1,0.36,1)`;
      el.style.left = `${to.x}px`;
      el.style.top = `${to.y}px`;
    });
    const doneTimeout = setTimeout(() => onDone(event.id), FLIGHT_MS + 120);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(doneTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only, see five-cucumbers/CardEffects.tsx's identical pattern
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      className="pointer-events-none fixed z-[70]"
      style={{ left: 0, top: 0, animation: "worm-tile-fly 0.52s ease-out forwards" }}
    >
      <TileFace tileNumber={event.tileNumber} worms={wormsOnTile(event.tileNumber)} size="h-14 w-12" />
    </div>,
    document.body,
  );
}
