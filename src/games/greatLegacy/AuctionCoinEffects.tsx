"use client";

import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { purseCoinCount, purseValue } from "./constants";
import type { GreatLegacyState, SeatIndex } from "./types";

/**
 * Purely cosmetic coin-flight/vault flourish for the betting arena — no game
 * logic lives here, same "diff consecutive states, since the board only ever
 * receives the resulting state" approach as No Thanks' AuctionEffects.tsx.
 *
 * Three visual outcomes, all derived from a state diff rather than the raw
 * `EngineAction` (so every connected client renders/hears the same thing):
 *  - "bid": a seat's `auction.committed` value just went up — coin(s) fly
 *    from that seat's PlayerArea card to their bet-spot in BettingArena.
 *  - "refund-sweep": a seat's committed coins came back to their own purse
 *    (a normal-auction mid-auction pass, or the reverse-auction "winner"
 *    getting their own stake refunded per engine.ts's module doc) — coins
 *    fly bet-spot -> PlayerArea.
 *  - "vault-absorb": a seat's committed coins vanished without returning to
 *    their purse (a normal-auction winner's sunk payment, or a reverse
 *    auction's forfeited-by-everyone-else coins) — coins fly bet-spot ->
 *    the shared vault icon.
 */

export type CoinEventKind = "bid" | "refund-sweep" | "vault-absorb";

export interface CoinAnimEvent {
  id: number;
  kind: CoinEventKind;
  seat: SeatIndex;
  coinCount: number;
}

function committedOf(state: GreatLegacyState, seat: SeatIndex) {
  const purse = state.auction?.committed[seat];
  return { value: purse ? purseValue(purse) : 0, count: purse ? purseCoinCount(purse) : 0 };
}

/**
 * Diffs two consecutive `GreatLegacyState` snapshots and returns every coin
 * flight this transition implies (can be more than one — e.g. a reverse
 * auction's first pass simultaneously refunds the passer AND forfeits every
 * other bidder's stake in the very same action).
 */
export function detectCoinEvents(prev: GreatLegacyState, next: GreatLegacyState): Omit<CoinAnimEvent, "id">[] {
  if (prev === next) return [];
  const events: Omit<CoinAnimEvent, "id">[] = [];
  const seatCount = next.players.length;

  const sameLot = !!prev.auction && !!next.auction && prev.auction.card === next.auction.card;

  if (sameLot) {
    for (let seat = 0; seat < seatCount; seat++) {
      const before = committedOf(prev, seat);
      const after = committedOf(next, seat);
      if (after.value > before.value) {
        events.push({ kind: "bid", seat, coinCount: Math.max(1, after.count - before.count) });
      } else if (after.value === 0 && before.value > 0) {
        events.push({ kind: "refund-sweep", seat, coinCount: before.count });
      }
    }
    return events;
  }

  // The auction just resolved (a new lot came up, or the game ended) — every
  // seat that still had coins committed on the outgoing auction either got
  // them back (purse value rose by the same amount) or lost them for good.
  if (prev.auction) {
    for (const key of Object.keys(prev.auction.committed)) {
      const seat = Number(key) as SeatIndex;
      const { value, count } = committedOf(prev, seat);
      if (value <= 0) continue;
      const prevPlayer = prev.players.find((p) => p.seat === seat);
      const nextPlayer = next.players.find((p) => p.seat === seat);
      if (!prevPlayer || !nextPlayer) continue;
      const purseDelta = purseValue(nextPlayer.purse) - purseValue(prevPlayer.purse);
      events.push({ kind: purseDelta >= value ? "refund-sweep" : "vault-absorb", seat, coinCount: count });
    }
  }
  return events;
}

function rectCenter(rect: DOMRect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

const ANIMATION_MS = 620;
const KEYFRAME_BY_KIND: Record<CoinEventKind, string> = {
  bid: "great-legacy-coin-toss 0.55s cubic-bezier(0.22,1,0.36,1)",
  "refund-sweep": "great-legacy-coin-sweep 0.6s ease-in-out",
  "vault-absorb": "great-legacy-vault-absorb 0.6s ease-in forwards",
};

/**
 * A single flying coin cluster, portaled to `document.body` so `position:
 * fixed` coordinates aren't affected by any ancestor's transform/overflow.
 * Same two-layer technique as No Thanks' FlyingToken: a `left`/`top` CSS
 * transition carries it in a straight line between the two DOM anchors,
 * while a CSS keyframe (declared in globals.css) adds the flourish on top.
 */
export function FlyingCoins({
  event,
  getSourceEl,
  getTargetEl,
  onDone,
}: {
  event: CoinAnimEvent;
  getSourceEl: () => HTMLElement | null;
  getTargetEl: () => HTMLElement | null;
  onDone: (id: number) => void;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);

  // Mount-only: this component is always freshly mounted with a stable
  // `key={event.id}` by the caller, so there's nothing to react to over its
  // lifetime — re-running on every source/target re-render would restart the
  // flight mid-animation.
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
    void el.offsetHeight; // commit the "from" position + transition:none before re-enabling the transition
    el.style.transition = "left 0.5s cubic-bezier(0.22,1,0.36,1), top 0.5s cubic-bezier(0.22,1,0.36,1)";

    const raf = requestAnimationFrame(() => {
      const live = elRef.current;
      if (!live) return;
      live.style.left = `${to.x}px`;
      live.style.top = `${to.y}px`;
    });
    const timeout = setTimeout(() => onDone(event.id), ANIMATION_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only, see comment above
  }, []);

  if (typeof document === "undefined") return null;

  const coinGlyphs = Math.min(3, Math.max(1, Math.ceil(event.coinCount / 4)));

  return createPortal(
    <div
      ref={elRef}
      className="pointer-events-none fixed z-[70] -translate-x-1/2 -translate-y-1/2"
      style={{ left: 0, top: 0, animation: KEYFRAME_BY_KIND[event.kind] }}
    >
      <div className="flex -space-x-2">
        {Array.from({ length: coinGlyphs }).map((_, i) => (
          <span key={i} className="text-xl drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]">
            🟡
          </span>
        ))}
      </div>
    </div>,
    document.body,
  );
}
