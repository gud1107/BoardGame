"use client";

import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { DiceFace, diceColorForSeat, NEUTRAL_DICE_COLOR } from "./DiceIcon";
import type { CasinoNumber, Face, LasVegasState, SeatIndex } from "./engine";

/**
 * Purely cosmetic dice-placement flourish for the casino board — no game
 * logic lives here. Same "diff two consecutive lockstep states, portal a
 * fixed-position element, animate its left/top via a CSS *transition* while
 * a globals.css keyframe adds the flourish on top" technique as
 * five-cucumbers/CardEffects.tsx, so every connected client renders the same
 * flight for the same placement — not just whoever rolled. The roll itself
 * (dice tumbling in place) doesn't need this cross-element flight — it's
 * animated directly where it's shown, see LasVegasBoard.tsx's `DiceTray`.
 */

export interface PlacementEvent {
  id: number;
  seat: SeatIndex;
  casino: CasinoNumber;
  face: Face;
  ownCount: number;
  neutralCount: number;
}

/**
 * Compares two consecutive `LasVegasState` snapshots and infers "dice were
 * just placed, by whom, how many" purely from the `lastPlacement` field the
 * reducer already stamps on every successful `placeDice`. The reducer always
 * returns the same object reference for a rejected/no-op action, so a
 * genuine reference change here always corresponds to a real placement.
 */
export function detectPlacementEvent(prev: LasVegasState, next: LasVegasState): Omit<PlacementEvent, "id"> | null {
  if (prev === next || !next.lastPlacement || next.lastPlacement === prev.lastPlacement) return null;
  const { seat, casino, face, ownCount, neutralCount } = next.lastPlacement;
  return { seat, casino, face, ownCount, neutralCount };
}

function rectCenter(rect: DOMRect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

const FLIGHT_MS = 480;
const STAGGER_MS = 55;

/**
 * Flies every die from one placement (own-color dice tagged to the placing
 * seat, neutral dice tagged separately) from the roller's dice tray/seat row
 * to the target casino tile, each with a small stagger so a big same-face
 * roll visibly arrives as a little cascade instead of one lump. Portaled to
 * `document.body` so `position: fixed` coordinates aren't affected by any
 * ancestor's transform/overflow.
 */
export function FlyingDicePlacement({
  event,
  getSourceEl,
  getTargetEl,
  onDone,
}: {
  event: PlacementEvent;
  getSourceEl: () => HTMLElement | null;
  getTargetEl: () => HTMLElement | null;
  onDone: (id: number) => void;
}) {
  const dice = [
    ...Array.from({ length: event.ownCount }, () => ({ color: diceColorForSeat(event.seat) })),
    ...Array.from({ length: event.neutralCount }, () => ({ color: NEUTRAL_DICE_COLOR })),
  ];
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  useLayoutEffect(() => {
    const source = getSourceEl();
    const target = getTargetEl();
    if (!source || !target) {
      onDone(event.id);
      return;
    }
    const from = rectCenter(source.getBoundingClientRect());
    const to = rectCenter(target.getBoundingClientRect());
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    const rafs: number[] = [];

    refs.current.forEach((el, i) => {
      if (!el) return;
      const jitter = (n: number) => n + (Math.random() - 0.5) * 18;
      el.style.transition = "none";
      el.style.left = `${jitter(from.x)}px`;
      el.style.top = `${jitter(from.y)}px`;
      void el.offsetHeight; // force layout so "from" + transition:none commits before re-enabling the transition
      const startDelay = i * STAGGER_MS;
      const t = setTimeout(() => {
        const live = el;
        live.style.transition = `left ${FLIGHT_MS}ms cubic-bezier(0.22,1,0.36,1), top ${FLIGHT_MS}ms cubic-bezier(0.22,1,0.36,1)`;
        const raf = requestAnimationFrame(() => {
          live.style.left = `${jitter(to.x)}px`;
          live.style.top = `${jitter(to.y)}px`;
        });
        rafs.push(raf);
      }, startDelay);
      timeouts.push(t);
    });

    const doneTimeout = setTimeout(onDone.bind(null, event.id), dice.length * STAGGER_MS + FLIGHT_MS + 120);
    return () => {
      timeouts.forEach(clearTimeout);
      rafs.forEach(cancelAnimationFrame);
      clearTimeout(doneTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only, see five-cucumbers/CardEffects.tsx's identical pattern
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      {dice.map((d, i) => (
        <div
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className="pointer-events-none fixed z-[70]"
          style={{ left: 0, top: 0, animation: "dice-slide-fly 0.48s ease-out forwards" }}
        >
          <DiceFace face={event.face} color={d.color} size="h-6 w-6" />
        </div>
      ))}
    </>,
    document.body,
  );
}
