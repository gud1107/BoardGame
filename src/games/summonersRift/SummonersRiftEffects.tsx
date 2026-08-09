"use client";

import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { DeckBack } from "./CardArt";
import type { SeatIndex, SummonersRiftState } from "./engine";

/**
 * Purely cosmetic flourish for the Rift pile's "cards physically piling up"
 * moment (task brief §2 "협곡 카드 덱이 누적되는 연출") — no game logic lives
 * here. Same "diff two consecutive lockstep states, portal a fixed-position
 * element, animate its left/top via a CSS *transition* while a globals.css
 * keyframe adds the flourish on top" technique as every other game's
 * `*Effects.tsx` (five-cucumbers/CardEffects.tsx, no-thanks/AuctionEffects.tsx,
 * las-vegas/DiceEffects.tsx), so every connected client renders the same
 * flight for the same push — not just whoever tapped the button.
 *
 * The dungeon phase's "card removal animation" (task brief §2, a monster
 * being slain or dealing damage and then discarded) is handled separately,
 * directly inside `SummonersRiftBoard.tsx` as a keyed CSS animation on the
 * single reveal slot — no source/target flight is needed there since there's
 * only ever one "current" monster card, unlike the many-seats-pushing-at-once
 * case this file exists for.
 */

export interface RiftPushEvent {
  id: number;
  seat: SeatIndex;
}

/**
 * A push (rulebook §4 옵션 A-1 "협곡에 집어넣기") always transitions
 * `pendingDraw: {seat, card} -> null` in the *same* step that grows
 * `riftPile` by exactly one — `removeItem` also clears `pendingDraw` but
 * never touches `riftPile`, which is what distinguishes the two here without
 * needing a dedicated action-kind field on the state itself.
 */
export function detectRiftPushEvent(prev: SummonersRiftState, next: SummonersRiftState): Omit<RiftPushEvent, "id"> | null {
  if (prev === next) return null;
  if (prev.pendingDraw && !next.pendingDraw && next.riftPile.length === prev.riftPile.length + 1) {
    return { seat: prev.pendingDraw.seat };
  }
  return null;
}

function rectCenter(rect: DOMRect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export function FlyingRiftCard({
  event,
  getSourceEl,
  getTargetEl,
  onDone,
}: {
  event: RiftPushEvent;
  getSourceEl: () => HTMLElement | null;
  getTargetEl: () => HTMLElement | null;
  onDone: (id: number) => void;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);

  // Mount-only flight — this component is always freshly mounted with a
  // stable `key={event.id}`, and re-running mid-flight on a source/target
  // re-render would restart it (same convention as FlyingPlayedCard).
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
    el.style.transition = "left 0.42s cubic-bezier(0.22,1,0.36,1), top 0.42s cubic-bezier(0.22,1,0.36,1)";

    const raf = requestAnimationFrame(() => {
      const live = elRef.current;
      if (!live) return;
      live.style.left = `${to.x}px`;
      live.style.top = `${to.y}px`;
    });
    const timeout = setTimeout(() => onDone(event.id), 460);
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
      style={{ left: 0, top: 0, animation: "rift-card-toss 0.42s ease-out forwards" }}
    >
      <DeckBack className="h-16 w-12" />
    </div>,
    document.body,
  );
}
