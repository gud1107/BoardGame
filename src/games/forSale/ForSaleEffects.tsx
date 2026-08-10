"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { CoinChip, formatDollars, PropertyCard } from "./CardArt";
import type { ForSaleState, SeatIndex } from "./engine";

/**
 * Purely cosmetic flourishes — no game logic lives here. Same "diff two
 * consecutive lockstep states, portal a fixed-position element, animate its
 * left/top via a CSS *transition* while a globals.css keyframe adds the
 * flourish on top" technique as every other `<Game>Effects.tsx` in this
 * project (dalmuti/DalmutiEffects.tsx, five-cucumbers/CardEffects.tsx,
 * lasVegas/DiceEffects.tsx, coyote/CoyoteEffects.tsx), so every connected
 * client renders the same flight/banner for the same state change — not just
 * whoever tapped the button.
 *
 * Four independent event kinds (task brief §2):
 * - `PassFlyEvent`: "포기(Pass) 시 절반 환불금 정산 시각 연출" — the passed
 *   card flies from the auction's open-card row to the passer's seat, with a
 *   refund badge.
 * - `BidFlyEvent`: every time a seat raises the table's current bid, a coin
 *   flies from that seat's row into the shared bidding pot in the auction
 *   section (the mirror-image direction of `PassFlyEvent`).
 * - `AuctionWinEvent`: the round's automatic resolution (last bidder standing)
 *   — a brief "낙찰!" banner.
 * - Phase-2 blind reveal: `CardFlipWrapper` (identical technique to Coyote's)
 *   flips every seat's submitted property card face-up together the instant
 *   `sale.revealed` flips true.
 */

// ---------------------------------------------------------------------------
// Phase 1 — pass refund flight
// ---------------------------------------------------------------------------

export interface PassFlyEvent {
  id: number;
  seat: SeatIndex;
  card: number;
  refundPaid: number;
}

/**
 * Detects the single most recent pass (whether or not it also happened to
 * end the round) by diffing two consecutive `ForSaleState`s. Mid-round
 * passes grow `auction.passesThisRound`; a round-ending pass instead shows up
 * as `lastAuctionResult` changing reference, whose `.passes` array's last
 * entry is that same final pass (see engine.ts's `pass()`).
 */
export function detectPassEvent(prev: ForSaleState, next: ForSaleState): Omit<PassFlyEvent, "id"> | null {
  if (prev === next) return null;
  if (prev.phase === "buying" && next.phase === "buying" && prev.auction && next.auction) {
    if (next.auction.passesThisRound.length > prev.auction.passesThisRound.length) {
      const latest = next.auction.passesThisRound[next.auction.passesThisRound.length - 1];
      return { seat: latest.seat, card: latest.card, refundPaid: latest.refundPaid };
    }
  }
  if (next.lastAuctionResult && next.lastAuctionResult !== prev.lastAuctionResult) {
    const passes = next.lastAuctionResult.passes;
    const latest = passes[passes.length - 1];
    if (latest) return { seat: latest.seat, card: latest.card, refundPaid: latest.refundPaid };
  }
  return null;
}

/** True exactly the render where a Phase-1 round just auto-resolved (last bidder standing). */
export function detectAuctionWinEvent(prev: ForSaleState, next: ForSaleState): boolean {
  return prev !== next && !!next.lastAuctionResult && next.lastAuctionResult !== prev.lastAuctionResult;
}

function rectCenter(rect: DOMRect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** Flies the passed property card from the shared "open cards" anchor to the passer's seat row. */
export function FlyingPassCard({
  event,
  getAuctionEl,
  getSeatEl,
  onDone,
}: {
  event: PassFlyEvent;
  getAuctionEl: () => HTMLElement | null;
  getSeatEl: (seat: SeatIndex) => HTMLElement | null;
  onDone: (id: number) => void;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = elRef.current;
    const source = getAuctionEl();
    const target = getSeatEl(event.seat);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only, see dalmuti/DalmutiEffects.tsx's FlyingTaxCard for the same pattern
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div ref={elRef} className="pointer-events-none fixed z-[70] -translate-x-1/2 -translate-y-1/2" style={{ left: 0, top: 0, animation: "forsale-pass-fly 0.55s ease-out forwards" }}>
      <PropertyCard value={event.card} className="scale-90" />
      <p className="mt-1 text-center text-[10px] font-bold text-rose-300">{event.refundPaid > 0 ? `${formatDollars(event.refundPaid)} 정산` : "포기"}</p>
    </div>,
    document.body,
  );
}

/** Brief "낙찰!" banner the instant a Phase-1 round auto-resolves (last bidder wins). */
export function AuctionWinToast({ winnerName, card, paid, onDone }: { winnerName: string; card: number; paid: number; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 1700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only per declaration
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed top-6 left-1/2 z-[75] -translate-x-1/2" style={{ animation: "forsale-win-toast 1.7s ease-out forwards" }}>
      <div className="flex items-center gap-2 rounded-full border border-sky-300/50 bg-gradient-to-r from-sky-950/95 to-black/95 px-5 py-2.5 shadow-[0_10px_40px_-10px_rgba(56,189,248,0.6)]">
        <span className="text-xl">🔨</span>
        <p className="text-sm font-semibold text-sky-100">
          {winnerName}님이 {card}번 부동산 낙찰! <span className="text-sky-300">{formatDollars(paid)}</span> 지불
        </p>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Phase 1 — bidding coin flight to the center pot
// ---------------------------------------------------------------------------

export interface BidFlyEvent {
  id: number;
  seat: SeatIndex;
  /** The raise amount (new currentBid minus the previous one), purely for the coin-denomination pick and the flying label — not game state. */
  amount: number;
}

/**
 * Detects a bid raise by diffing two consecutive `ForSaleState`s: the table's
 * `currentBid` strictly increasing with a non-null `highBidderSeat` can only
 * happen from a `bid` action (a fresh round instead *resets* `currentBid` to
 * 0, which this strict `>` guard never mistakes for a raise).
 */
export function detectBidEvent(prev: ForSaleState, next: ForSaleState): Omit<BidFlyEvent, "id"> | null {
  if (prev === next) return null;
  if (prev.phase !== "buying" || next.phase !== "buying" || !prev.auction || !next.auction) return null;
  if (next.auction.highBidderSeat === null) return null;
  if (next.auction.currentBid > prev.auction.currentBid) {
    return { seat: next.auction.highBidderSeat, amount: next.auction.currentBid - prev.auction.currentBid };
  }
  return null;
}

/** Flies a coin from the bidding seat's row to the shared bidding-pot anchor in the auction section. */
export function FlyingBidCoin({
  event,
  getSeatEl,
  getPotEl,
  onDone,
}: {
  event: BidFlyEvent;
  getSeatEl: (seat: SeatIndex) => HTMLElement | null;
  getPotEl: () => HTMLElement | null;
  onDone: (id: number) => void;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = elRef.current;
    const source = getSeatEl(event.seat);
    const target = getPotEl();
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
    el.style.transition = "left 0.5s cubic-bezier(0.22,1,0.36,1), top 0.5s cubic-bezier(0.22,1,0.36,1)";

    const raf = requestAnimationFrame(() => {
      const live = elRef.current;
      if (!live) return;
      live.style.left = `${to.x}px`;
      live.style.top = `${to.y}px`;
    });
    const timeout = setTimeout(() => onDone(event.id), 560);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only, see FlyingPassCard above
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={elRef}
      className="pointer-events-none fixed z-[70] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5"
      style={{ left: 0, top: 0, animation: "forsale-bid-coin-fly 0.5s ease-out forwards" }}
    >
      <CoinChip value={event.amount >= 2000 ? 2000 : 1000} size="lg" />
      <p className="text-[10px] font-bold text-amber-300">+{formatDollars(event.amount)}</p>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Phase 2 — blind reveal 3D flip (same technique as coyote/CoyoteEffects.tsx)
// ---------------------------------------------------------------------------

/** True exactly the render where a Phase-2 round's blind submissions just flipped face-up together. */
export function detectSaleRevealEvent(prev: ForSaleState, next: ForSaleState): boolean {
  return prev !== next && prev.phase === "selling" && next.phase === "selling" && prev.sale?.revealed === false && next.sale?.revealed === true;
}

/**
 * Wraps a submitted-card face so it plays a single 3D flip the moment the
 * round reveals (`sale.revealed` flips true). `flipKey` should change once
 * per new reveal (e.g. a per-round counter) so the remount — and therefore
 * the animation — fires exactly once per showdown.
 */
export function CardFlipWrapper({ flipKey, revealed, children }: { flipKey: string; revealed: boolean; children: React.ReactNode }) {
  return (
    <div key={flipKey} style={revealed ? { animation: "forsale-card-flip 0.6s ease-out" } : undefined} className="[transform-style:preserve-3d]">
      {children}
    </div>
  );
}
