"use client";

import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { NoThanksState, SeatIndex } from "./engine";

/**
 * Purely cosmetic "coin toss" / "card+chip collect" flourish for the auction
 * table — no game logic lives here. `NoThanksBoard` diffs consecutive
 * `NoThanksState` snapshots (see `detectAuctionEvent`) to figure out *what
 * just happened* (a pass or a take, and by whom), since it only ever
 * receives the resulting state from the lockstep reducer, never the raw
 * `EngineAction` — this also means every connected client (not just the
 * player who acted) renders the same effect, which is what we want for a
 * shared table.
 */

export interface AnimEvent {
  id: number;
  kind: "pass" | "take";
  seat: SeatIndex;
  /** For "pass": always 1 (one chip). For "take": however many chips were sitting on the card. */
  coinCount: number;
  /** The card that was just taken — null for "pass" events. */
  cardValue: number | null;
}

/**
 * Compares two consecutive engine states and infers the single action that
 * produced `next` from `prev`, purely from the data (card counts, chip
 * totals) — the reducer always returns the *same* object reference for a
 * rejected/no-op action (see engine.ts), so a genuine reference change here
 * always corresponds to a real pass/take. Returns null for anything that
 * isn't a pass or a take (e.g. a fresh `startGame()` on rematch).
 */
export function detectAuctionEvent(prev: NoThanksState, next: NoThanksState): Omit<AnimEvent, "id"> | null {
  if (prev === next) return null;
  // Skip the very last "take" that ends the game — by the time this effect
  // would play, NoThanksBoard has already swapped to the scoring screen and
  // the seat elements it would fly toward no longer exist.
  if (next.phase !== "playing") return null;

  for (const nextPlayer of next.players) {
    const prevPlayer = prev.players.find((p) => p.seat === nextPlayer.seat);
    if (prevPlayer && nextPlayer.cards.length > prevPlayer.cards.length) {
      return { kind: "take", seat: nextPlayer.seat, coinCount: prev.chipsOnCard, cardValue: prev.currentCard };
    }
  }
  if (next.chipsOnCard > prev.chipsOnCard) {
    // The chip always comes from whoever was active *before* the pass (a
    // pass advances `activeSeat` to the next player as part of the same
    // transition), so `prev.activeSeat` is the actor.
    return { kind: "pass", seat: prev.activeSeat, coinCount: 1, cardValue: null };
  }
  return null;
}

function rectCenter(rect: DOMRect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * A single flying token, portaled to `document.body` so its `position:
 * fixed` coordinates aren't affected by any ancestor's transform/overflow.
 * Animates in two independent layers: a `left`/`top` CSS *transition* carries
 * it in a straight line from the source element's center to the target
 * element's center, while a CSS *keyframe animation* (declared in
 * globals.css) adds the toss arc / collect-fade flourish on top. Removes
 * itself via `onDone` after a fixed duration — no game state depends on
 * this, so a slightly-early/late cleanup is harmless.
 */
export function FlyingToken({
  event,
  getSourceEl,
  getTargetEl,
  onDone,
}: {
  event: AnimEvent;
  getSourceEl: () => HTMLElement | null;
  getTargetEl: () => HTMLElement | null;
  onDone: (id: number) => void;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);

  // Runs once per mounted token (this component is always freshly mounted
  // with a stable `key={event.id}` by the caller, so an empty dep array is
  // intentional — there's nothing to react to over this instance's
  // lifetime, and re-running this on every source/target re-render would
  // restart the flight mid-animation).
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
    el.style.transition = "left 0.55s cubic-bezier(0.22,1,0.36,1), top 0.55s cubic-bezier(0.22,1,0.36,1)";

    const raf = requestAnimationFrame(() => {
      const live = elRef.current;
      if (!live) return;
      live.style.left = `${to.x}px`;
      live.style.top = `${to.y}px`;
    });
    const timeout = setTimeout(() => onDone(event.id), 650);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only, see comment above
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={elRef}
      className="pointer-events-none fixed z-[70] -translate-x-1/2 -translate-y-1/2"
      style={{
        left: 0,
        top: 0,
        animation: event.kind === "pass" ? "coin-toss-arc 0.55s ease-out" : "card-collect-fade 0.6s ease-in forwards",
      }}
    >
      {event.kind === "pass" ? (
        <span className="text-2xl drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]">🪙</span>
      ) : (
        <div className="flex flex-col items-center gap-0.5">
          <div className="flex h-9 w-7 items-center justify-center rounded-md border border-white/40 bg-gradient-to-b from-white to-neutral-200 text-xs font-black text-neutral-900 shadow">
            {event.cardValue}
          </div>
          {event.coinCount > 0 && (
            <span className="rounded-full bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-bold text-black shadow">
              🪙×{event.coinCount}
            </span>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
