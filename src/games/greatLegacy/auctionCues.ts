import { emptyPurse, purseValue } from "./constants";
import type { AuctionKind, GreatLegacyState, SeatIndex } from "./types";

export interface AuctionCues {
  /** The high bid went up on the same lot. */
  bid: boolean;
  /** Someone dropped out of the current lot (and the lot is still open). */
  pass: boolean;
  /** The lot on the block was just knocked down. `winnerSeat` is whoever received the card (null if undetectable). */
  sold: { winnerSeat: SeatIndex | null; kind: AuctionKind } | null;
}

/**
 * Auction sound cues between two consecutive state snapshots — diff-based
 * like AuctionCoinEffects/synergy detection, so every client hears the same
 * gavel/chip/pass sounds no matter who acted.
 */
export function detectAuctionCues(prev: GreatLegacyState, next: GreatLegacyState): AuctionCues {
  const before = prev.auction;
  const after = next.auction;
  const cues: AuctionCues = { bid: false, pass: false, sold: null };
  if (!before) return cues;

  if (after && after.card.cardId === before.card.cardId) {
    cues.bid = after.highestBid > before.highestBid;
    cues.pass = after.passed.length > before.passed.length;
    return cues;
  }

  // The lot changed (or the game just ended): it was sold. The winner is the seat whose holdings changed.
  const winner = next.players.find((p) => {
    const old = prev.players.find((q) => q.seat === p.seat);
    return old !== undefined && (old.assets !== p.assets || old.pendingSpecials !== p.pendingSpecials);
  });
  cues.sold = { winnerSeat: winner?.seat ?? null, kind: before.kind };
  return cues;
}

/**
 * 0..1 "how heated is this lot" for the BGM: the high bid relative to a
 * quarter of the table's average money (floored at 12 coins, so opening bids
 * stay calm). ~20 coins on a fresh 4-player table ≈ 0.57.
 */
export function auctionHeat(state: GreatLegacyState): number {
  const auction = state.auction;
  if (!auction || state.players.length === 0) return 0;
  const avgMoney = state.players.reduce((sum, p) => sum + purseValue(p.purse) + purseValue(auction.committed[p.seat] ?? emptyPurse()), 0) / state.players.length;
  return Math.min(1, auction.highestBid / Math.max(12, avgMoney * 0.25));
}
