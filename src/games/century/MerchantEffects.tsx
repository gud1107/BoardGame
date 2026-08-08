"use client";

import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import ResourceIcon from "./ResourceIcon";
import { RESOURCE_ORDER, type ResourceBundle } from "./cards";
import type { CenturyState, SeatIndex } from "./engine";

/**
 * Purely cosmetic "resources swept off the card" flourish for the merchant
 * market — no game logic lives here. Mirrors no-thanks/AuctionEffects.tsx's
 * FlyingToken technique exactly (diff two consecutive lockstep states,
 * portal a fixed-position element, animate its left/top via a CSS
 * *transition* while a globals.css keyframe adds the flourish on top), so
 * every connected client renders the same effect for the same acquisition —
 * not just whoever clicked "확정".
 */
export interface AcquireAnimEvent {
  id: number;
  seat: SeatIndex;
  cardId: string;
  /** Market slot index the acquired card occupied *before* the market shifted left. */
  fromIndex: number;
  resources: ResourceBundle;
}

/**
 * Compares two consecutive `CenturyState` snapshots and infers "a merchant
 * card was just acquired, by whom, carrying which staked resources" purely
 * from the data — the reducer always returns the same object reference for
 * a rejected/no-op action (see engine.ts), so a genuine reference change
 * here always corresponds to a real transition. Returns null for anything
 * else (production/upgrade/trade/rest/claim/discard, or a fresh restart).
 */
export function detectAcquireEvent(prev: CenturyState, next: CenturyState): Omit<AcquireAnimEvent, "id"> | null {
  if (prev === next) return null;
  const nextIds = new Set(next.merchantMarket.filter((c) => c !== null).map((c) => c!.id));
  const fromIndex = prev.merchantMarket.findIndex((c) => c !== null && !nextIds.has(c.id));
  if (fromIndex < 0) return null;
  const removedCard = prev.merchantMarket[fromIndex]!;
  const resources = prev.merchantMarketResources[fromIndex] ?? {};
  const seat = next.players.find((p) => p.hand.some((c) => c.id === removedCard.id))?.seat;
  if (seat === undefined) return null;
  return { seat, cardId: removedCard.id, fromIndex, resources };
}

function rectCenter(rect: DOMRect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * Flies the resource bundle that was staked on an acquired merchant card
 * from the market slot it occupied to the acquiring seat's resource
 * display. `getSourceEl` is keyed by *slot index*, not card id — the slot's
 * wrapper `<div>` stays mounted continuously across the shift (only its
 * child card swaps), so reading its rect here still gives the correct
 * on-screen starting point even though by paint time that slot already
 * shows the next card (same trick NoThanksBoard's `centerCardRef` uses for
 * its "take" animation — see AuctionEffects.tsx).
 */
export function FlyingResourceBurst({
  event,
  getSourceEl,
  getTargetEl,
  onDone,
}: {
  event: AcquireAnimEvent;
  getSourceEl: () => HTMLElement | null;
  getTargetEl: () => HTMLElement | null;
  onDone: (id: number) => void;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);

  // Mount-only flight, same rationale as FlyingToken in AuctionEffects.tsx:
  // this component is always freshly mounted with a stable `key={event.id}`,
  // and re-running mid-flight on a source/target re-render would restart it.
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
    void el.offsetHeight; // force layout so "from" + transition:none commits before re-enabling the transition
    el.style.transition = "left 0.5s cubic-bezier(0.22,1,0.36,1), top 0.5s cubic-bezier(0.22,1,0.36,1)";

    const raf = requestAnimationFrame(() => {
      const live = elRef.current;
      if (!live) return;
      live.style.left = `${to.x}px`;
      live.style.top = `${to.y}px`;
    });
    const timeout = setTimeout(() => onDone(event.id), 600);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only, see comment above
  }, []);

  if (typeof document === "undefined") return null;

  const entries = RESOURCE_ORDER.filter((r) => (event.resources[r] ?? 0) > 0);
  if (entries.length === 0) return null;

  return createPortal(
    <div
      ref={elRef}
      className="pointer-events-none fixed z-[70] -translate-x-1/2 -translate-y-1/2"
      style={{ left: 0, top: 0, animation: "card-collect-fade 0.6s ease-in forwards" }}
    >
      <div className="flex items-center gap-1 rounded-full border border-white/30 bg-black/60 px-1.5 py-1 shadow-lg backdrop-blur-sm">
        {entries.map((r) => (
          <span key={r} className="flex items-center gap-0.5">
            <ResourceIcon resource={r} className="h-4 w-4" />
            <span className="text-[10px] font-bold text-white">×{event.resources[r]}</span>
          </span>
        ))}
      </div>
    </div>,
    document.body,
  );
}
