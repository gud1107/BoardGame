"use client";

import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { DiceFace, diceColorForSeat, NEUTRAL_DICE_COLOR } from "./DiceIcon";
import { MoneyBillIcon } from "./MoneyBillArt";
import type { CasinoNumber, Face, LasVegasState, SeatIndex } from "./engine";

/**
 * Purely cosmetic dice-placement flourish for the casino board — no game
 * logic lives here. Same "diff two consecutive lockstep states, portal a
 * fixed-position element, animate its left/top via a CSS *transition* while
 * a globals.css keyframe adds the flourish on top" technique as
 * five-cucumbers/CardEffects.tsx, so every connected client renders the same
 * flight for the same placement — not just whoever rolled. The roll itself
 * (dice tumbling in place) doesn't need this cross-element flight — it's
 * animated directly where it's shown, see LasVegasBoard.tsx's
 * `RollViewerPanel`.
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
// 2026-08-23 요청: "선택된 주사위들이 강조(Glow/Scale)된 후... 카지노로 날아가는
// 모션" — every die now holds in place at the roll viewer, glowing/scaling
// up via `lasvegas-selection-glow`, for this long *before* the existing
// flight transition starts (applied uniformly to mine and every opponent's
// placement alike, per user decision — one shared component, one behavior).
const HOLD_MS = 300;

/**
 * Flies every die from one placement (own-color dice tagged to the placing
 * seat, neutral dice tagged separately) from the shared roll viewer panel
 * (2026-08-23 요청 — one panel now shows mine AND every opponent's roll, so
 * it's the flight source either way) to the target casino tile. Each die
 * first holds in place glowing/scaling up (`HOLD_MS`, "선택 하이라이트") before
 * flying, with a small stagger on the flight itself so a big same-face roll
 * visibly arrives as a little cascade instead of one lump. Portaled to
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
      // Hold phase: highlight in place (glow + scale up) before flying —
      // all dice glow together, at once, since they were all "selected" by
      // the same one face choice (only the flight itself is staggered).
      el.style.animation = "lasvegas-selection-glow 0.3s ease-out forwards";
      void el.offsetHeight; // force layout so "from" + transition:none commits before re-enabling the transition
      const startDelay = HOLD_MS + i * STAGGER_MS;
      const t = setTimeout(() => {
        const live = el;
        live.style.transition = `left ${FLIGHT_MS}ms cubic-bezier(0.22,1,0.36,1), top ${FLIGHT_MS}ms cubic-bezier(0.22,1,0.36,1)`;
        live.style.animation = "dice-slide-fly 0.48s ease-out forwards";
        const raf = requestAnimationFrame(() => {
          live.style.left = `${jitter(to.x)}px`;
          live.style.top = `${jitter(to.y)}px`;
        });
        rafs.push(raf);
      }, startDelay);
      timeouts.push(t);
    });

    const doneTimeout = setTimeout(onDone.bind(null, event.id), HOLD_MS + dice.length * STAGGER_MS + FLIGHT_MS + 120);
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
          style={{ left: 0, top: 0, animation: "lasvegas-selection-glow 0.3s ease-out forwards" }}
        >
          <DiceFace face={event.face} color={d.color} size="h-6 w-6" />
        </div>
      ))}
    </>,
    document.body,
  );
}

const MONEY_FLIGHT_MS = 560;
const MONEY_STAGGER_MS = 90;

/**
 * Payout flourish for `LasVegasBoard.tsx`'s game-over screen: flies the
 * winning seat's bill notes, one by one, from the trophy header down into
 * that seat's ranking-row money badge, each landing with a small sparkle —
 * same left/top-CSS-transition-plus-portal technique as
 * `FlyingDicePlacement` above, just triggered once on mount (there is no
 * further mid-game state to diff once `phase === "gameOver"`) rather than
 * off a state-diff. Scoped to the #1 seat(s) only, not every award across
 * all 6 casinos to every player — keeps the flourish focused on "you won"
 * instead of turning the results screen into a 54-card money shower.
 */
export function PayoutMoneyFly({
  bills,
  getSourceEl,
  getTargetEl,
  onDone,
}: {
  bills: number[];
  getSourceEl: () => HTMLElement | null;
  getTargetEl: () => HTMLElement | null;
  onDone: () => void;
}) {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const sparkleRefs = useRef<(HTMLDivElement | null)[]>([]);

  useLayoutEffect(() => {
    const source = getSourceEl();
    const target = getTargetEl();
    if (!source || !target || bills.length === 0) {
      onDone();
      return;
    }
    const from = rectCenter(source.getBoundingClientRect());
    const to = rectCenter(target.getBoundingClientRect());
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    const rafs: number[] = [];

    refs.current.forEach((el, i) => {
      if (!el) return;
      const jitter = (n: number) => n + (Math.random() - 0.5) * 22;
      el.style.transition = "none";
      el.style.left = `${jitter(from.x)}px`;
      el.style.top = `${jitter(from.y)}px`;
      void el.offsetHeight;
      const startDelay = i * MONEY_STAGGER_MS;
      const t = setTimeout(() => {
        el.style.transition = `left ${MONEY_FLIGHT_MS}ms cubic-bezier(0.22,1,0.36,1), top ${MONEY_FLIGHT_MS}ms cubic-bezier(0.22,1,0.36,1)`;
        const raf = requestAnimationFrame(() => {
          el.style.left = `${jitter(to.x)}px`;
          el.style.top = `${jitter(to.y)}px`;
        });
        rafs.push(raf);
        const landTimeout = setTimeout(() => {
          const sparkle = sparkleRefs.current[i];
          if (sparkle) {
            sparkle.style.left = `${to.x}px`;
            sparkle.style.top = `${to.y}px`;
            sparkle.style.animation = "lasvegas-money-land-sparkle 0.5s ease-out forwards";
          }
        }, MONEY_FLIGHT_MS - 60);
        timeouts.push(landTimeout);
      }, startDelay);
      timeouts.push(t);
    });

    const doneTimeout = setTimeout(onDone, bills.length * MONEY_STAGGER_MS + MONEY_FLIGHT_MS + 150);
    return () => {
      timeouts.forEach(clearTimeout);
      rafs.forEach(cancelAnimationFrame);
      clearTimeout(doneTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      {bills.map((bill, i) => (
        <div
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className="pointer-events-none fixed z-[80]"
          style={{ left: 0, top: 0, animation: "lasvegas-money-fly 0.4s ease-out forwards" }}
        >
          <MoneyBillIcon value={bill} className="h-6 w-10 drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]" />
        </div>
      ))}
      {bills.map((_, i) => (
        <div
          key={`spark-${i}`}
          ref={(el) => {
            sparkleRefs.current[i] = el;
          }}
          className="pointer-events-none fixed z-[80] h-6 w-6 rounded-full"
          style={{ left: -9999, top: -9999, background: "radial-gradient(circle, rgba(252,211,77,0.9) 0%, rgba(252,211,77,0) 70%)" }}
        />
      ))}
    </>,
    document.body,
  );
}
