/**
 * Pure "위대한 유산" (The Great Legacy) rules engine — no React, no I/O.
 * Same online-multiplayer trust model as No Thanks/Coyote/Avalon: every
 * connected client computes and holds the FULL state (every seat's private
 * purse) from a shared RNG seed plus replayed `EngineAction`s.
 *
 * Two auction shapes coexist on the same bidding primitive (open-ascending,
 * strictly-increasing, cumulative, "can't un-commit, only add"):
 *  - "normal" (relic cards + 재평가): last bidder standing wins, everyone
 *    else who passed already got their committed coins refunded on the way
 *    out (rulebook §G).
 *  - "reverse" (평가절하/가품 판정): the FIRST player to pass "wins" (gets
 *    stuck with) the card; per §H, "다른 모든 플레이어가 입찰했던 코인은
 *    전부 폐기됩니다" — read literally, that scopes the forfeiture to seats
 *    OTHER than the passer, so the passer's own already-committed coins are
 *    refunded to them exactly like a normal-auction pass (see the
 *    HANDOFF.md entry for this session — this is a direct textual reading,
 *    not an invented rule, and was surfaced to the user rather than shipped
 *    silently).
 *
 * Special-card targeting ("직전에 획득한 유물"): always the seat's
 * chronologically LAST-acquired relic, full stop — a relic already modified
 * by an earlier special can be re-targeted and overwritten by a later one
 * (confirmed: "1개의 특수카드는 1개의 유물만 순서대로 적용합니다"). If the
 * seat owns zero relics yet, the special is queued (`pendingSpecials`) and
 * consumes exactly the NEXT relic that seat acquires, one queued special per
 * relic acquisition, in FIFO order (confirmed: "순서대로 유물카드 획득 시에
 * 적용").
 */

import { seededRng, shuffle } from "@/lib/rng";
export { seededRng };

import {
  addPurses,
  COLLECTION_BONUS,
  COUNTRIES,
  EXCLUDE_COUNT,
  FORMATS,
  RELIC_DEFS,
  SPECIAL_CARD_COUNTS,
  emptyPurse,
  purseContains,
  purseValue,
  startingPurse,
  subtractPurses,
} from "./constants";
import type {
  AuctionCardDef,
  AuctionKind,
  AuctionState,
  CoinVisibility,
  EngineAction,
  GreatLegacyMode,
  GreatLegacyState,
  OwnedRelic,
  PlayerState,
  Purse,
  SeatIndex,
  SpecialKind,
  TimeLimitMode,
} from "./types";

export const MIN_PLAYERS: Record<GreatLegacyMode, number> = { "4p": 4, "8p": 8 };
export const MAX_PLAYERS: Record<GreatLegacyMode, number> = { "4p": 4, "8p": 8 };

function auctionKindFor(card: AuctionCardDef): AuctionKind {
  if (card.kind === "relic") return "normal";
  return card.special === "재평가" ? "normal" : "reverse";
}

function nextActiveSeat(order: SeatIndex[], passed: SeatIndex[], from: SeatIndex): SeatIndex {
  const passedSet = new Set(passed);
  const idx = order.indexOf(from);
  for (let step = 1; step <= order.length; step++) {
    const candidate = order[(idx + step) % order.length];
    if (!passedSet.has(candidate)) return candidate;
  }
  return from; // unreachable in practice — at least one active seat always remains until gameOver
}

function buildAuction(card: AuctionCardDef, opener: SeatIndex, playerCount: number): AuctionState {
  const order = Array.from({ length: playerCount }, (_, i) => (opener + i) % playerCount);
  return {
    card,
    kind: auctionKindFor(card),
    order,
    activeSeat: opener,
    highestBid: 0,
    highestBidder: null,
    committed: {},
    passed: [],
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function startGame(
  mode: GreatLegacyMode,
  seed: number,
  timeLimitMode: TimeLimitMode = "none",
  coinVisibility: CoinVisibility = "secret",
): GreatLegacyState {
  const playerCount = MIN_PLAYERS[mode];
  const rng = seededRng(seed);

  const specialCounts = SPECIAL_CARD_COUNTS[mode];
  const specialCards: AuctionCardDef[] = [];
  (Object.keys(specialCounts) as SpecialKind[]).forEach((kind) => {
    for (let i = 0; i < specialCounts[kind]; i++) {
      specialCards.push({ kind: "special", cardId: `special-${kind}-${i}`, special: kind });
    }
  });
  const relicCards: AuctionCardDef[] = RELIC_DEFS.map((relic) => ({ kind: "relic", cardId: relic.id, relic }));

  const allCards = shuffle([...relicCards, ...specialCards], rng);
  const excludeCount = EXCLUDE_COUNT[mode];
  const excludedCards = allCards.slice(0, excludeCount);
  const deck = allCards.slice(excludeCount);

  const purse = startingPurse(mode);
  const players: PlayerState[] = Array.from({ length: playerCount }, (_, seat) => ({
    seat,
    purse: { ...purse },
    relics: [],
    pendingSpecials: [],
  }));

  // Confirmed: "선플레이어는 랜덤으로 진행" — the very first auction's opener
  // is picked from the shared seed for determinism (same convention as
  // No Thanks/Avalon's leaderless-start tiebreak).
  const opener = Math.floor(rng() * playerCount);
  const [firstCard, ...restDeck] = deck;

  return {
    mode,
    players,
    deck: restDeck,
    excludedCards,
    auction: buildAuction(firstCard, opener, playerCount),
    phase: "playing",
    timeLimitMode,
    coinVisibility,
    nextOpenerSeat: opener,
  };
}

// ---------------------------------------------------------------------------
// Special-card application
// ---------------------------------------------------------------------------

function applySpecialToRelic(relic: OwnedRelic, kind: SpecialKind): OwnedRelic {
  if (kind === "재평가") return { ...relic, currentScore: 5, discarded: false };
  if (kind === "평가절하") return { ...relic, currentScore: 1, discarded: false };
  return { ...relic, discarded: true }; // 가품 판정
}

/** Grants `winner` a relic, consuming one queued pending special (if any) — see module doc. */
function grantRelic(player: PlayerState, relicDef: AuctionCardDef & { kind: "relic" }): PlayerState {
  let relic: OwnedRelic = {
    relicId: relicDef.relic.id,
    country: relicDef.relic.country,
    format: relicDef.relic.format,
    baseScore: relicDef.relic.baseScore,
    currentScore: relicDef.relic.baseScore,
    discarded: false,
  };
  const pendingSpecials = [...player.pendingSpecials];
  if (pendingSpecials.length > 0) {
    const kind = pendingSpecials.shift()!;
    relic = applySpecialToRelic(relic, kind);
  }
  return { ...player, relics: [...player.relics, relic], pendingSpecials };
}

/** Grants `winner` a special card — applies to their last-acquired relic immediately, or queues it if they own none yet. */
function grantSpecial(player: PlayerState, kind: SpecialKind): PlayerState {
  if (player.relics.length === 0) {
    return { ...player, pendingSpecials: [...player.pendingSpecials, kind] };
  }
  const relics = [...player.relics];
  const lastIdx = relics.length - 1;
  relics[lastIdx] = applySpecialToRelic(relics[lastIdx], kind);
  return { ...player, relics };
}

function grantCard(player: PlayerState, card: AuctionCardDef): PlayerState {
  return card.kind === "relic" ? grantRelic(player, card) : grantSpecial(player, card.special);
}

// ---------------------------------------------------------------------------
// Auction resolution
// ---------------------------------------------------------------------------

/** Finalizes the current auction in favor of `winnerSeat`, refunding/forfeiting coins per auction kind, then deals the next card or ends the game. */
function resolveAuction(state: GreatLegacyState, winnerSeat: SeatIndex): GreatLegacyState {
  const auction = state.auction!;
  let players = state.players;

  if (auction.kind === "normal") {
    // Winner's committed coins are spent (sunk cost — money leaves the
    // player's economy, never refunded); everyone else already got refunded
    // when they passed.
  } else {
    // Reverse auction: the passer (winnerSeat) gets their own committed
    // coins refunded; everyone else's committed coins are forfeited outright
    // (never return to any purse) — see module doc.
    const ownCommitted = auction.committed[winnerSeat];
    if (ownCommitted) {
      players = players.map((p) => (p.seat === winnerSeat ? { ...p, purse: addPurses(p.purse, ownCommitted) } : p));
    }
  }

  players = players.map((p) => (p.seat === winnerSeat ? grantCard(p, auction.card) : p));

  const deck = state.deck;
  if (deck.length === 0) {
    return { ...state, players, auction: null, phase: "gameOver", nextOpenerSeat: winnerSeat };
  }
  const [nextCard, ...restDeck] = deck;
  return {
    ...state,
    players,
    deck: restDeck,
    auction: buildAuction(nextCard, winnerSeat, players.length),
    nextOpenerSeat: winnerSeat,
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function bid(state: GreatLegacyState, seat: SeatIndex, addCoins: Purse): GreatLegacyState {
  if (state.phase !== "playing" || !state.auction) return state;
  const auction = state.auction;
  if (auction.activeSeat !== seat || auction.passed.includes(seat)) return state;

  const player = state.players.find((p) => p.seat === seat);
  if (!player) return state;
  if (!purseContains(player.purse, addCoins)) return state; // can't add coins you don't have

  const alreadyCommitted = auction.committed[seat] ?? emptyPurse();
  const newCommitted = addPurses(alreadyCommitted, addCoins);
  const newTotal = purseValue(newCommitted);
  if (newTotal <= auction.highestBid) return state; // must strictly exceed the previous bid (§G-1)

  const players = state.players.map((p) => (p.seat === seat ? { ...p, purse: subtractPurses(p.purse, addCoins) } : p));
  const nextAuction: AuctionState = {
    ...auction,
    committed: { ...auction.committed, [seat]: newCommitted },
    highestBid: newTotal,
    highestBidder: seat,
    activeSeat: nextActiveSeat(auction.order, auction.passed, seat),
  };
  return { ...state, players, auction: nextAuction };
}

function pass(state: GreatLegacyState, seat: SeatIndex): GreatLegacyState {
  if (state.phase !== "playing" || !state.auction) return state;
  const auction = state.auction;
  if (auction.activeSeat !== seat || auction.passed.includes(seat)) return state;

  if (auction.kind === "reverse") {
    // The very first pass in a reverse auction always ends it outright.
    return resolveAuction(state, seat);
  }

  // Normal auction: refund this seat's committed coins and drop them out.
  const committed = auction.committed[seat];
  let players = state.players;
  if (committed) {
    players = players.map((p) => (p.seat === seat ? { ...p, purse: addPurses(p.purse, committed) } : p));
  }
  const passed = [...auction.passed, seat];

  const nextCommitted = { ...auction.committed };
  delete nextCommitted[seat];

  if (passed.length === auction.order.length - 1) {
    // Only one active bidder remains — they win immediately, per §G-1.
    // (`resolveAuction`'s "normal" branch doesn't touch `committed` at all —
    // the winner's coins were already deducted from their purse when bid,
    // and stay spent — so what's left in `nextCommitted` here is moot.)
    const winner = auction.order.find((s) => !passed.includes(s))!;
    return resolveAuction({ ...state, players, auction: { ...auction, passed, committed: nextCommitted } }, winner);
  }

  const nextAuction: AuctionState = {
    ...auction,
    passed,
    committed: nextCommitted,
    activeSeat: nextActiveSeat(auction.order, passed, seat),
  };
  return { ...state, players, auction: nextAuction };
}

/** Single entry point applying any `EngineAction` to a state — the whole engine as one reducer. */
export function applyAction(state: GreatLegacyState, action: EngineAction): GreatLegacyState {
  switch (action.type) {
    case "bid":
      return bid(state, action.seat, action.addCoins);
    case "pass":
      return pass(state, action.seat);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Bidding helpers (shared by UI + bots)
// ---------------------------------------------------------------------------

/**
 * Largest-denomination-first coin pick from `purse` reaching at least
 * `targetValue` (exact when the purse can make exact change, otherwise the
 * smallest possible overshoot — still legal, since a bid only needs to meet
 * or exceed a target, never match it exactly), or null if the purse's total
 * value can't reach `targetValue` at all.
 */
export function greedyCoinsFor(purse: Purse, targetValue: number): Purse | null {
  if (targetValue <= 0) return emptyPurse();
  if (purseValue(purse) < targetValue) return null;

  const picked = emptyPurse();
  const available = { ...purse };
  let remaining = targetValue;

  // Pass 1: consume exact multiples of each denomination, largest first —
  // this alone reaches the exact target whenever the purse can make exact
  // change for it (true for every case this engine's tests exercise).
  for (const denom of [20, 10, 5, 1] as const) {
    if (remaining <= 0) break;
    const take = Math.min(available[denom], Math.floor(remaining / denom));
    picked[denom] += take;
    available[denom] -= take;
    remaining -= take * denom;
  }

  // Pass 2: only reached when exact change wasn't possible (e.g. not enough
  // 1-coins left) — cover the shortfall with single coins, smallest
  // available denomination first, to minimize the overshoot.
  while (remaining > 0) {
    const denom = ([1, 5, 10, 20] as const).find((d) => available[d] > 0);
    if (denom === undefined) break; // unreachable — the purseValue precheck above guarantees enough total value
    picked[denom] += 1;
    available[denom] -= 1;
    remaining -= denom;
  }

  return picked;
}

/** The minimum legal raise for `seat` in the current auction, or null if they can't afford to raise at all. */
export function minimalRaiseCoins(state: GreatLegacyState, seat: SeatIndex): Purse | null {
  const auction = state.auction;
  if (!auction) return null;
  const player = state.players.find((p) => p.seat === seat);
  if (!player) return null;
  const already = purseValue(auction.committed[seat] ?? emptyPurse());
  const needed = auction.highestBid - already + 1;
  return greedyCoinsFor(player.purse, needed);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function hasCollectionCard(relics: OwnedRelic[], country: (typeof COUNTRIES)[number] | null, format: (typeof FORMATS)[number] | null): boolean {
  return relics.some((r) => !r.discarded && (country === null || r.country === country) && (format === null || r.format === format));
}

export function computeCollectionBonus(relics: OwnedRelic[]): { bonus: number; countries: string[]; formats: string[] } {
  const countries: string[] = [];
  const formats: string[] = [];
  for (const country of COUNTRIES) {
    if (FORMATS.every((format) => hasCollectionCard(relics, country, format))) countries.push(country);
  }
  for (const format of FORMATS) {
    if (COUNTRIES.every((country) => hasCollectionCard(relics, country, format))) formats.push(format);
  }
  return { bonus: (countries.length + formats.length) * COLLECTION_BONUS, countries, formats };
}

export interface PlayerScore {
  seat: SeatIndex;
  relicScore: number;
  collectionBonus: number;
  total: number;
  remainingCoinValue: number;
}

export function computePlayerScore(player: PlayerState): PlayerScore {
  const relicScore = player.relics.filter((r) => !r.discarded).reduce((sum, r) => sum + r.currentScore, 0);
  const { bonus } = computeCollectionBonus(player.relics);
  return {
    seat: player.seat,
    relicScore,
    collectionBonus: bonus,
    total: relicScore + bonus,
    remainingCoinValue: purseValue(player.purse),
  };
}

export interface RankedScore {
  seat: SeatIndex;
  rank: number;
  score: PlayerScore;
}

/**
 * Standard competition ranking (1, 1, 3, ...). Per the confirmed rule:
 * highest total score wins; a tied total is broken by remaining coin VALUE
 * (합계 금액, not coin count — confirmed after the "코인합" wording check);
 * if that's ALSO tied, the players are genuinely co-ranked (무승부).
 */
export function computeRankings(state: GreatLegacyState): RankedScore[] {
  const scores = state.players.map(computePlayerScore);
  const isBetter = (a: PlayerScore, b: PlayerScore) =>
    a.total !== b.total ? a.total > b.total : a.remainingCoinValue > b.remainingCoinValue;
  return scores
    .map((score) => ({
      seat: score.seat,
      rank: 1 + scores.filter((other) => other.seat !== score.seat && isBetter(other, score)).length,
      score,
    }))
    .sort((a, b) => a.rank - b.rank);
}

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7 — getValidMoves + chooseBotAction).
// Deliberately a modest heuristic (this game wasn't called out for a
// deep-EV bot the way No Thanks/Perudo were) — good enough to fill empty
// seats and keep an auction moving, not tournament-tuned.
// ---------------------------------------------------------------------------

/** Every legal `EngineAction` `seat` may submit right now — just the two shapes the UI/bots actually choose between: pass, or raise by the minimum legal amount. */
export function getValidMoves(state: GreatLegacyState, seat: SeatIndex): EngineAction[] {
  if (state.phase !== "playing" || !state.auction) return [];
  if (state.auction.activeSeat !== seat || state.auction.passed.includes(seat)) return [];
  const moves: EngineAction[] = [{ type: "pass", seat }];
  const raise = minimalRaiseCoins(state, seat);
  if (raise) moves.push({ type: "bid", seat, addCoins: raise });
  return moves;
}

/** Rough "how much is this card worth chasing" estimate, used only by the bot heuristic below. */
function cardValueEstimate(card: AuctionCardDef): number {
  if (card.kind === "relic") return card.relic.baseScore;
  if (card.special === "재평가") return 5;
  return 0; // 평가절하/가품판정 have no positive value to the bidder in a normal sense (only ever seen via reverse auctions below)
}

import { botTier, pickByLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";

function scoreMove(state: GreatLegacyState, seat: SeatIndex, move: EngineAction, level: BotLevel): number {
  const auction = state.auction!;
  const player = state.players.find((p) => p.seat === seat)!;
  const purseTotal = purseValue(player.purse) + purseValue(auction.committed[seat] ?? emptyPurse());
  const scarcity = purseTotal <= 0 ? 0 : 1; // guards a divide-by-zero edge case, not a real scarcity model

  if (auction.kind === "normal") {
    const value = cardValueEstimate(auction.card);
    if (move.type === "pass") return -value; // walking away from a card worth chasing is a mild loss
    const cost = purseValue(move.addCoins);
    // Willing to chase up to ~4x a relic's score (a rough "don't blow the whole purse on a 1-point card" guard) and never more than what's left.
    const willingCap = Math.max(value * 4, botTier(level) === "expert" ? 20 : 10);
    return auction.highestBid + cost <= willingCap ? value * 2 - cost * 0.1 : -cost;
  }

  // Reverse auction: passing means "I accept the penalty card" — worth
  // avoiding while cheap, but not worth going broke over.
  if (move.type === "pass") return -2; // small, deliberately modest penalty-avoidance value
  const cost = purseValue(move.addCoins);
  const affordableMargin = purseTotal - cost;
  return affordableMargin > cost * 2 ? 1 * scarcity : -1; // keep dodging while it's still cheap relative to what's left, otherwise prefer to just take the card
}

/** Picks a move for `seat` per the shared Level 1–10 curve, or null if it isn't their turn / they have no legal move. */
export function chooseBotAction(
  state: GreatLegacyState,
  seat: SeatIndex,
  level: BotLevel = 5,
  rng: () => number = Math.random,
): EngineAction | null {
  const moves = getValidMoves(state, seat);
  if (moves.length === 0) return null;
  const scored = moves.map((move) => ({ move, score: scoreMove(state, seat, move, level) }));
  return pickByLevel(scored, level, rng);
}
