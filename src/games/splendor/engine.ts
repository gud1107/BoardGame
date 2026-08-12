/**
 * Pure "스플렌더" (Splendor) rules engine — no React, no I/O. Implements
 * boardGameRule/스플랜더.md: 2-4 players collect gem tokens to buy
 * development cards, whose permanent color bonuses discount future
 * purchases (engine building), attract noble visits (+3pt, no token cost),
 * and race to 15 victory points. Exactly one of 4 actions per turn (take 3
 * different tokens / take 2 same tokens / reserve a card + gold / purchase a
 * card, §4); once someone hits 15pt at the end of their own turn, play
 * continues until the seat right before the starting seat finishes theirs
 * (§6), then the game ends.
 *
 * Same online-multiplayer trust model as every other game in this project:
 * every connected client computes and holds the FULL state (every seat's
 * tokens, purchased cards, AND reserved cards) from a shared RNG seed plus
 * replayed `EngineAction`s — there is no server authority (see
 * docs/architecture.md §2). Unlike century (whose "hands" are public
 * market-knowledge), a player's *reserved* cards are meant to stay secret
 * from opponents by the physical rules — that's enforced at the UI layer
 * only (`SplendorBoard.tsx` renders other seats' reserved cards as face-down
 * backs), the same technique bang/avalon use to hide roles despite every
 * client holding the full state.
 */

import {
  addTokens,
  canPayTokens,
  costTotal,
  createDevelopmentDeck,
  createNobles,
  GEM_ORDER,
  subtractTokens,
  tokenTotal,
  TOKEN_COLORS,
  type CostBundle,
  type DevelopmentCard,
  type GemColor,
  type Noble,
  type Tier,
  type TokenBundle,
} from "./cards";

export type { GemColor, TokenColor, CostBundle, TokenBundle, DevelopmentCard, Noble, Tier } from "./cards";

export type SeatIndex = number;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
/** Rulebook §2/§3 — always 5 gold tokens regardless of player count. */
export const GOLD_SUPPLY = 5;
/** Rulebook §3 — gem tokens per color, by player count. */
export const TOKEN_SUPPLY_BY_PLAYER_COUNT: Record<number, number> = { 2: 4, 3: 5, 4: 7 };
/** Rulebook §5-3 — max tokens (incl. gold) a player may hold at turn end. */
export const TOKEN_LIMIT = 10;
/** Rulebook §4 Action C — max cards a player may keep reserved at once. */
export const RESERVE_LIMIT = 3;
/** Rulebook §1/§6 — first to this many victory points triggers the final round. */
export const WIN_SCORE = 15;
export const MARKET_SIZE = 4;

export interface PlayerState {
  seat: SeatIndex;
  tokens: TokenBundle;
  purchasedCards: DevelopmentCard[];
  reservedCards: DevelopmentCard[];
  nobles: Noble[];
}

export type Phase = "playing" | "discarding" | "choosingNoble" | "gameOver";

export interface SplendorState {
  playerCount: number;
  players: PlayerState[];
  decks: Record<Tier, DevelopmentCard[]>;
  markets: Record<Tier, (DevelopmentCard | null)[]>;
  /** Visible, unclaimed noble tiles — [playerCount + 1] of them (rulebook §3). */
  nobles: Noble[];
  tokenSupply: TokenBundle;
  activeSeat: SeatIndex;
  /** Non-null only while `phase === "discarding"` — the seat that must shed tokens down to `TOKEN_LIMIT` (rulebook §5-3). */
  awaitingDiscardSeat: SeatIndex | null;
  /** Non-null only while `phase === "choosingNoble"` — set when >1 noble qualifies at once (rulebook §5-5: only 1 may be taken per turn). */
  awaitingNobleSeat: SeatIndex | null;
  /** Set once any player reaches `WIN_SCORE` at the end of their own turn (rulebook §6) — turns keep advancing until the seat right before the starter (playerCount - 1) finishes theirs. */
  endTriggered: boolean;
  phase: Phase;
  turnNumber: number;
}

export type EngineAction =
  | { type: "takeThreeDifferent"; seat: SeatIndex; colors: GemColor[] }
  | { type: "takeTwoSame"; seat: SeatIndex; color: GemColor }
  | { type: "reserveCard"; seat: SeatIndex; tier: Tier; marketIndex?: number }
  | { type: "purchaseCard"; seat: SeatIndex; cardId: string; source: "market" | "reserved" }
  | { type: "discardTokens"; seat: SeatIndex; discard: TokenBundle }
  | { type: "chooseNoble"; seat: SeatIndex; nobleId: string };

/** Deterministic PRNG + shuffle, shared across every engine — see src/lib/rng.ts. */
import { seededRng, shuffle } from "@/lib/rng";
export { seededRng };

function findPlayer(state: SplendorState, seat: SeatIndex): PlayerState | undefined {
  return state.players.find((p) => p.seat === seat);
}

function updatePlayer(state: SplendorState, seat: SeatIndex, patch: Partial<PlayerState>): PlayerState[] {
  return state.players.map((p) => (p.seat === seat ? { ...p, ...patch } : p));
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function startGame(playerCount: number, seed: number): SplendorState {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`Unsupported player count: ${playerCount}`);
  }
  const rng = seededRng(seed);
  const fullDeck = createDevelopmentDeck();

  const decks = {} as Record<Tier, DevelopmentCard[]>;
  const markets = {} as Record<Tier, (DevelopmentCard | null)[]>;
  for (const tier of [1, 2, 3] as Tier[]) {
    const shuffled = shuffle(fullDeck.filter((c) => c.tier === tier), rng);
    markets[tier] = shuffled.slice(0, MARKET_SIZE);
    decks[tier] = shuffled.slice(MARKET_SIZE);
  }

  const shuffledNobles = shuffle(createNobles(), rng);
  const nobles = shuffledNobles.slice(0, playerCount + 1);

  const gemSupply = TOKEN_SUPPLY_BY_PLAYER_COUNT[playerCount];
  const tokenSupply: TokenBundle = { gold: GOLD_SUPPLY };
  for (const c of GEM_ORDER) tokenSupply[c] = gemSupply;

  const players: PlayerState[] = Array.from({ length: playerCount }, (_, seat) => ({
    seat,
    tokens: {},
    purchasedCards: [],
    reservedCards: [],
    nobles: [],
  }));

  return {
    playerCount,
    players,
    decks,
    markets,
    nobles,
    tokenSupply,
    activeSeat: 0,
    awaitingDiscardSeat: null,
    awaitingNobleSeat: null,
    endTriggered: false,
    phase: "playing",
    turnNumber: 1,
  };
}

// ---------------------------------------------------------------------------
// Bonus / cost / payment helpers — pure derived values (this project's
// "파생 상태 금지" principle, docs/architecture.md §1.4).
// ---------------------------------------------------------------------------

export function computeBonusCounts(purchasedCards: DevelopmentCard[]): CostBundle {
  const counts: CostBundle = {};
  for (const c of purchasedCards) counts[c.bonus] = (counts[c.bonus] ?? 0) + 1;
  return counts;
}

/** Card cost after subtracting the player's permanent color bonuses (rulebook §5-1) — never negative per color. */
export function computeEffectiveCost(card: DevelopmentCard, purchasedCards: DevelopmentCard[]): CostBundle {
  const bonus = computeBonusCounts(purchasedCards);
  const effective: CostBundle = {};
  for (const c of GEM_ORDER) {
    const remaining = (card.cost[c] ?? 0) - (bonus[c] ?? 0);
    if (remaining > 0) effective[c] = remaining;
  }
  return effective;
}

export function canAffordCard(player: PlayerState, card: DevelopmentCard): boolean {
  const effective = computeEffectiveCost(card, player.purchasedCards);
  let goldNeeded = 0;
  for (const c of GEM_ORDER) {
    const need = effective[c] ?? 0;
    const have = player.tokens[c] ?? 0;
    if (have < need) goldNeeded += need - have;
  }
  return goldNeeded <= (player.tokens.gold ?? 0);
}

/**
 * The payment the engine actually charges: spend the player's own matching
 * color tokens first, fall back to gold only for the shortfall. This is
 * never worse than any other valid payment a rational player could choose —
 * gold is a strict superset of every color's purchasing power, so spending a
 * color-locked token before a gold token can never cost you a future
 * purchase you could otherwise have made — which is why the engine computes
 * payment automatically instead of asking the UI to let players hand-pick
 * which tokens to spend (mirrors century's `simulateUpgrade`/`maxTradeRepeats`
 * "engine and UI preview share one function" approach, just skipping the
 * "let the user choose a worse option" step since none exists here).
 */
export function computeAutoPayment(player: PlayerState, card: DevelopmentCard): TokenBundle {
  const effective = computeEffectiveCost(card, player.purchasedCards);
  const payment: TokenBundle = {};
  let goldNeeded = 0;
  for (const c of GEM_ORDER) {
    const need = effective[c] ?? 0;
    if (need <= 0) continue;
    const have = player.tokens[c] ?? 0;
    const pay = Math.min(need, have);
    if (pay > 0) payment[c] = pay;
    if (have < need) goldNeeded += need - have;
  }
  if (goldNeeded > 0) payment.gold = goldNeeded;
  return payment;
}

export function computeQualifyingNobles(state: SplendorState, seat: SeatIndex): Noble[] {
  const player = findPlayer(state, seat)!;
  const bonus = computeBonusCounts(player.purchasedCards);
  return state.nobles.filter((n) => GEM_ORDER.every((c) => (bonus[c] ?? 0) >= (n.cost[c] ?? 0)));
}

export function computePlayerScore(player: PlayerState): number {
  return player.purchasedCards.reduce((sum, c) => sum + c.points, 0) + player.nobles.length * 3;
}

// ---------------------------------------------------------------------------
// Turn-flow helpers
// ---------------------------------------------------------------------------

/** After any action resolves, gate on the mandatory 10-token discard before checking nobles. */
function finishTurn(state: SplendorState, seat: SeatIndex): SplendorState {
  const player = findPlayer(state, seat)!;
  if (tokenTotal(player.tokens) > TOKEN_LIMIT) {
    return { ...state, phase: "discarding", awaitingDiscardSeat: seat, awaitingNobleSeat: null };
  }
  return afterTokensSettled(state, seat);
}

/** Once tokens are within the limit, resolve any noble visit before handing off the turn (rulebook §5-5). */
function afterTokensSettled(state: SplendorState, seat: SeatIndex): SplendorState {
  const qualifying = computeQualifyingNobles(state, seat);
  if (qualifying.length === 0) return advanceTurn(state, seat);
  if (qualifying.length === 1) return advanceTurn(assignNoble(state, seat, qualifying[0].id), seat);
  return { ...state, phase: "choosingNoble", awaitingNobleSeat: seat, awaitingDiscardSeat: null };
}

function assignNoble(state: SplendorState, seat: SeatIndex, nobleId: string): SplendorState {
  const noble = state.nobles.find((n) => n.id === nobleId);
  if (!noble) return state;
  const player = findPlayer(state, seat)!;
  const players = updatePlayer(state, seat, { nobles: [...player.nobles, noble] });
  const nobles = state.nobles.filter((n) => n.id !== nobleId);
  return { ...state, players, nobles };
}

function advanceTurn(state: SplendorState, justFinishedSeat: SeatIndex): SplendorState {
  const player = findPlayer(state, justFinishedSeat)!;
  const endTriggered = state.endTriggered || computePlayerScore(player) >= WIN_SCORE;
  if (endTriggered && justFinishedSeat === state.playerCount - 1) {
    return { ...state, phase: "gameOver", awaitingDiscardSeat: null, awaitingNobleSeat: null, endTriggered };
  }
  return {
    ...state,
    phase: "playing",
    awaitingDiscardSeat: null,
    awaitingNobleSeat: null,
    endTriggered,
    activeSeat: (justFinishedSeat + 1) % state.playerCount,
    turnNumber: state.turnNumber + 1,
  };
}

// ---------------------------------------------------------------------------
// A. Take 3 different-color tokens
// ---------------------------------------------------------------------------

function takeThreeDifferent(state: SplendorState, seat: SeatIndex, colors: GemColor[]): SplendorState {
  if (state.phase !== "playing" || seat !== state.activeSeat) return state;
  if (colors.length !== 3 || new Set(colors).size !== 3) return state;
  if (!colors.every((c) => (state.tokenSupply[c] ?? 0) >= 1)) return state;

  const delta: TokenBundle = {};
  for (const c of colors) delta[c] = 1;
  const player = findPlayer(state, seat)!;
  const players = updatePlayer(state, seat, { tokens: addTokens(player.tokens, delta) });
  const tokenSupply = subtractTokens(state.tokenSupply, delta);
  return finishTurn({ ...state, players, tokenSupply }, seat);
}

// ---------------------------------------------------------------------------
// B. Take 2 same-color tokens (only if the supply has >= 4 of that color)
// ---------------------------------------------------------------------------

function takeTwoSame(state: SplendorState, seat: SeatIndex, color: GemColor): SplendorState {
  if (state.phase !== "playing" || seat !== state.activeSeat) return state;
  if ((state.tokenSupply[color] ?? 0) < 4) return state;

  const player = findPlayer(state, seat)!;
  const players = updatePlayer(state, seat, { tokens: addTokens(player.tokens, { [color]: 2 }) });
  const tokenSupply = subtractTokens(state.tokenSupply, { [color]: 2 });
  return finishTurn({ ...state, players, tokenSupply }, seat);
}

// ---------------------------------------------------------------------------
// C. Reserve a development card (+ 1 gold token if any remain)
// ---------------------------------------------------------------------------

/** `marketIndex` omitted = reserve blind off the top of that tier's deck (rulebook §4-C). */
function reserveCard(state: SplendorState, seat: SeatIndex, tier: Tier, marketIndex?: number): SplendorState {
  if (state.phase !== "playing" || seat !== state.activeSeat) return state;
  const player = findPlayer(state, seat)!;
  if (player.reservedCards.length >= RESERVE_LIMIT) return state;

  let card: DevelopmentCard | null;
  let markets = state.markets;
  let decks = state.decks;
  if (marketIndex !== undefined) {
    card = state.markets[tier][marketIndex] ?? null;
    if (!card) return state;
    const drawn = decks[tier][0] ?? null;
    markets = { ...markets, [tier]: markets[tier].map((c, i) => (i === marketIndex ? drawn : c)) };
    decks = { ...decks, [tier]: decks[tier].slice(1) };
  } else {
    card = decks[tier][0] ?? null;
    if (!card) return state;
    decks = { ...decks, [tier]: decks[tier].slice(1) };
  }

  const gainsGold = (state.tokenSupply.gold ?? 0) > 0;
  const tokenSupply = gainsGold ? subtractTokens(state.tokenSupply, { gold: 1 }) : state.tokenSupply;
  const players = updatePlayer(state, seat, {
    reservedCards: [...player.reservedCards, card],
    tokens: gainsGold ? addTokens(player.tokens, { gold: 1 }) : player.tokens,
  });
  return finishTurn({ ...state, players, markets, decks, tokenSupply }, seat);
}

// ---------------------------------------------------------------------------
// D. Purchase a development card (market or own reserved pile)
// ---------------------------------------------------------------------------

function purchaseCard(state: SplendorState, seat: SeatIndex, cardId: string, source: "market" | "reserved"): SplendorState {
  if (state.phase !== "playing" || seat !== state.activeSeat) return state;
  const player = findPlayer(state, seat)!;

  let card: DevelopmentCard | undefined;
  let markets = state.markets;
  let decks = state.decks;
  let reservedCards = player.reservedCards;

  if (source === "reserved") {
    card = player.reservedCards.find((c) => c.id === cardId);
    if (!card) return state;
    reservedCards = player.reservedCards.filter((c) => c.id !== cardId);
  } else {
    for (const tier of [1, 2, 3] as Tier[]) {
      const idx = state.markets[tier].findIndex((c) => c?.id === cardId);
      if (idx >= 0) {
        card = state.markets[tier][idx]!;
        const drawn = decks[tier][0] ?? null;
        markets = { ...markets, [tier]: markets[tier].map((c, i) => (i === idx ? drawn : c)) };
        decks = { ...decks, [tier]: decks[tier].slice(1) };
        break;
      }
    }
    if (!card) return state;
  }

  if (!canAffordCard(player, card)) return state;
  const payment = computeAutoPayment(player, card);
  const tokens = subtractTokens(player.tokens, payment);
  const tokenSupply = addTokens(state.tokenSupply, payment);

  const players = updatePlayer(state, seat, {
    tokens,
    purchasedCards: [...player.purchasedCards, card],
    reservedCards,
  });
  return finishTurn({ ...state, players, markets, decks, tokenSupply }, seat);
}

// ---------------------------------------------------------------------------
// End-of-turn mandatory discard (rulebook §5-3)
// ---------------------------------------------------------------------------

function discardTokens(state: SplendorState, seat: SeatIndex, discard: TokenBundle): SplendorState {
  if (state.phase !== "discarding" || state.awaitingDiscardSeat !== seat) return state;
  const player = findPlayer(state, seat)!;
  if (!canPayTokens(player.tokens, discard)) return state;
  const tokens = subtractTokens(player.tokens, discard);
  if (tokenTotal(tokens) !== TOKEN_LIMIT) return state; // must land exactly on the 10-token cap

  const tokenSupply = addTokens(state.tokenSupply, discard);
  const players = updatePlayer(state, seat, { tokens });
  return afterTokensSettled({ ...state, players, tokenSupply }, seat);
}

// ---------------------------------------------------------------------------
// Noble choice when multiple qualify at once (rulebook §5-5)
// ---------------------------------------------------------------------------

function chooseNoble(state: SplendorState, seat: SeatIndex, nobleId: string): SplendorState {
  if (state.phase !== "choosingNoble" || state.awaitingNobleSeat !== seat) return state;
  const qualifying = computeQualifyingNobles(state, seat);
  if (!qualifying.some((n) => n.id === nobleId)) return state;
  return advanceTurn(assignNoble(state, seat, nobleId), seat);
}

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7 — every game exposes getValidMoves +
// chooseBotAction so a host client can drive a bot-occupied seat).
// ---------------------------------------------------------------------------

/** Every 3-different-color combo the token supply can currently pay out. */
function threeDifferentCombos(tokenSupply: TokenBundle): GemColor[][] {
  const available = GEM_ORDER.filter((c) => (tokenSupply[c] ?? 0) >= 1);
  const combos: GemColor[][] = [];
  for (let i = 0; i < available.length; i++) {
    for (let j = i + 1; j < available.length; j++) {
      for (let k = j + 1; k < available.length; k++) {
        combos.push([available[i], available[j], available[k]]);
      }
    }
  }
  return combos;
}

/**
 * Every combination of exactly `overage` tokens `player` could discard —
 * bounded by how far over `TOKEN_LIMIT` they are (never more than 3 in
 * practice, since a single turn can add at most 3 tokens), so this stays
 * cheap regardless of how many colors the player is holding.
 */
function discardCombos(player: PlayerState, overage: number): TokenBundle[] {
  if (overage <= 0) return [{}];
  const colors = TOKEN_COLORS.filter((c) => (player.tokens[c] ?? 0) > 0);
  const results: TokenBundle[] = [];
  function walk(idx: number, remaining: number, acc: TokenBundle) {
    if (remaining === 0) {
      results.push({ ...acc });
      return;
    }
    if (idx >= colors.length) return;
    const color = colors[idx];
    const maxTake = Math.min(remaining, player.tokens[color] ?? 0);
    for (let take = 0; take <= maxTake; take++) {
      walk(idx + 1, remaining - take, take > 0 ? { ...acc, [color]: take } : acc);
    }
  }
  walk(0, overage, {});
  return results;
}

/**
 * Every legal `EngineAction` `seat` may submit right now. Mirrors each
 * handler's own guards exactly, across all three phases a turn can be
 * blocked on (`playing`/`discarding`/`choosingNoble`).
 */
export function getValidMoves(state: SplendorState, seat: SeatIndex): EngineAction[] {
  if (state.phase === "discarding") {
    if (state.awaitingDiscardSeat !== seat) return [];
    const player = findPlayer(state, seat)!;
    const overage = tokenTotal(player.tokens) - TOKEN_LIMIT;
    return discardCombos(player, overage).map((discard) => ({ type: "discardTokens", seat, discard }));
  }
  if (state.phase === "choosingNoble") {
    if (state.awaitingNobleSeat !== seat) return [];
    return computeQualifyingNobles(state, seat).map((n) => ({ type: "chooseNoble", seat, nobleId: n.id }));
  }
  if (state.phase !== "playing" || state.activeSeat !== seat) return [];

  const player = findPlayer(state, seat)!;
  const moves: EngineAction[] = [];
  for (const colors of threeDifferentCombos(state.tokenSupply)) moves.push({ type: "takeThreeDifferent", seat, colors });
  for (const color of GEM_ORDER) if (canTakeTwoSame(state, color)) moves.push({ type: "takeTwoSame", seat, color });
  if (canReserve(player)) {
    for (const tier of [1, 2, 3] as Tier[]) {
      state.markets[tier].forEach((card, marketIndex) => {
        if (card) moves.push({ type: "reserveCard", seat, tier, marketIndex });
      });
      if (state.decks[tier].length > 0) moves.push({ type: "reserveCard", seat, tier });
    }
  }
  for (const tier of [1, 2, 3] as Tier[]) {
    for (const card of state.markets[tier]) {
      if (card && canAffordCard(player, card)) moves.push({ type: "purchaseCard", seat, cardId: card.id, source: "market" });
    }
  }
  for (const card of player.reservedCards) {
    if (canAffordCard(player, card)) moves.push({ type: "purchaseCard", seat, cardId: card.id, source: "reserved" });
  }
  return moves;
}

/** How many market-visible cards currently need more of `color` than `seat` already holds — a cheap "how useful is this color right now" proxy. */
function colorUtility(state: SplendorState, seat: SeatIndex, color: GemColor): number {
  const player = findPlayer(state, seat)!;
  let utility = 0;
  for (const tier of [1, 2, 3] as Tier[]) {
    for (const card of state.markets[tier]) {
      if (!card) continue;
      const effective = computeEffectiveCost(card, player.purchasedCards);
      if ((effective[color] ?? 0) > (player.tokens[color] ?? 0)) utility += 1;
    }
  }
  return utility;
}

/** A simple greedy heuristic — buy points when affordable, otherwise gather tokens useful for the visible market. Not a full lookahead search. */
function scoreMove(state: SplendorState, seat: SeatIndex, move: EngineAction): number {
  switch (move.type) {
    case "purchaseCard": {
      const card =
        move.source === "reserved"
          ? findPlayer(state, seat)!.reservedCards.find((c) => c.id === move.cardId)
          : ([1, 2, 3] as Tier[]).flatMap((t) => state.markets[t]).find((c) => c?.id === move.cardId);
      if (!card) return -Infinity;
      return card.points * 20 + colorUtility(state, seat, card.bonus) * 2;
    }
    case "reserveCard": {
      const card = move.marketIndex !== undefined ? state.markets[move.tier][move.marketIndex] : null;
      return 4 + (card ? card.points * 2 : 1);
    }
    case "takeThreeDifferent":
      return 3 + move.colors.reduce((sum, c) => sum + colorUtility(state, seat, c), 0);
    case "takeTwoSame":
      return 2 + colorUtility(state, seat, move.color) * 2;
    case "discardTokens": {
      const entries = Object.entries(move.discard) as [GemColor | "gold", number][];
      return -entries.reduce((sum, [color, count]) => sum + (color === "gold" ? 5 : colorUtility(state, seat, color)) * count, 0);
    }
    case "chooseNoble":
      return costTotal(state.nobles.find((n) => n.id === move.nobleId)?.cost ?? {});
    default:
      return -Infinity;
  }
}

/**
 * Picks the highest-scoring legal move for `seat` (ties broken randomly via
 * `rng`), or null if it isn't `seat`'s decision right now. `rng` defaults to
 * `Math.random` — bot decisions are local UX, not part of the deterministic
 * engine contract; the resulting `EngineAction` still runs through the
 * ordinary, fully deterministic `applyAction`.
 */
export function chooseBotAction(state: SplendorState, seat: SeatIndex, rng: () => number = Math.random): EngineAction | null {
  const moves = getValidMoves(state, seat);
  if (moves.length === 0) return null;
  const scored = moves.map((move) => ({ move, score: scoreMove(state, seat, move) }));
  const best = Math.max(...scored.map((s) => s.score));
  const bestMoves = scored.filter((s) => s.score === best).map((s) => s.move);
  return bestMoves[Math.floor(rng() * bestMoves.length)];
}

/** Single entry point applying any `EngineAction` to a state — the whole engine as one reducer. */
export function applyAction(state: SplendorState, action: EngineAction): SplendorState {
  switch (action.type) {
    case "takeThreeDifferent":
      return takeThreeDifferent(state, action.seat, action.colors);
    case "takeTwoSame":
      return takeTwoSame(state, action.seat, action.color);
    case "reserveCard":
      return reserveCard(state, action.seat, action.tier, action.marketIndex);
    case "purchaseCard":
      return purchaseCard(state, action.seat, action.cardId, action.source);
    case "discardTokens":
      return discardTokens(state, action.seat, action.discard);
    case "chooseNoble":
      return chooseNoble(state, action.seat, action.nobleId);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// UI helper predicates — pure derived values, computed on demand.
// ---------------------------------------------------------------------------

export function canTakeThreeDifferent(state: SplendorState, colors: GemColor[]): boolean {
  return colors.length === 3 && new Set(colors).size === 3 && colors.every((c) => (state.tokenSupply[c] ?? 0) >= 1);
}

export function canTakeTwoSame(state: SplendorState, color: GemColor): boolean {
  return (state.tokenSupply[color] ?? 0) >= 4;
}

export function canReserve(player: PlayerState): boolean {
  return player.reservedCards.length < RESERVE_LIMIT;
}

// ---------------------------------------------------------------------------
// Final scoring (rulebook §6)
// ---------------------------------------------------------------------------

export interface RankedSeat {
  seat: SeatIndex;
  rank: number;
  score: number;
  cardCount: number;
}

/**
 * Only meaningful once `state.phase === "gameOver"`. Rulebook §6 tie-break:
 * fewer purchased development cards wins; a full tie (score AND card count)
 * is an explicit co-victory ("공동 승리"), so this uses standard competition
 * ranking (1,1,3 — not 1,1,2) rather than forcing a false total order.
 */
export function computeRankings(state: SplendorState): RankedSeat[] {
  const scored = state.players.map((p) => ({ seat: p.seat, score: computePlayerScore(p), cardCount: p.purchasedCards.length }));
  const sorted = [...scored].sort((a, b) => b.score - a.score || a.cardCount - b.cardCount);
  const ranked: RankedSeat[] = [];
  let rank = 1;
  sorted.forEach((entry, i) => {
    if (i > 0) {
      const prev = sorted[i - 1];
      if (!(prev.score === entry.score && prev.cardCount === entry.cardCount)) rank = i + 1;
    }
    ranked.push({ ...entry, rank });
  });
  return ranked;
}

export { costTotal, TOKEN_COLORS };
