/**
 * Pure "센추리: 향신료의 길" (Century: Spice Road) rules engine — no React, no
 * I/O. Implements boardGameRule/Century.md: each player runs a spice-trading
 * economy of 4 tiered resources (yellow < red < green < brown, §4.1), using
 * merchant cards (produce / upgrade / trade) to accumulate resources they
 * then spend on point cards for victory points, gold (3pt) and silver (1pt)
 * bonus coins. Exactly one of 4 actions per turn (play / acquire / rest /
 * claim, rulebook §5); game ends once someone reaches the point-card goal
 * and every other player has taken one more turn (§7.1).
 *
 * Same online-multiplayer trust model as every other game in this project:
 * every connected client computes and holds the FULL state (every seat's
 * hand and resources) from a shared RNG seed plus replayed `EngineAction`s —
 * there is no server authority. See docs/architecture.md §2 for the accepted
 * trust trade-off (lowest of the 7 online games' leak severity: hands here
 * are visible market-knowledge cards, not secret roles, and resource pools
 * are numeric only).
 *
 * Documented, intentional simplifications (see also cards.ts's header):
 * - The communal spice bowl (105 physical cubes, rulebook §2) is NOT
 *   modeled as a finite bank — production/trade gains are never blocked by
 *   bowl scarcity. A finite shared bank would need a server-authoritative
 *   arbiter to resolve races between two clients' simultaneous "look then
 *   take" gains, which is exactly the server-authority trade-off this
 *   project has already declined to build for every other game (see
 *   docs/architecture.md §2) — the physical scenario (running out of a
 *   color entirely with 105 cubes in play) is also rare enough at normal
 *   table sizes that this rarely matters in practice.
 * - Gold/silver bonus coins (rulebook §5-D-2) are modeled as a simple bank
 *   supply consumed on claiming market slot 0/1 respectively, rather than
 *   as physical tokens resting on a specific card — mechanically identical
 *   since a claim always immediately draws the market back up to 5 cards,
 *   so "the coin sitting above slot 0/1" and "claiming slot 0/1 grants a
 *   coin from the bank if any remain" produce the same result every time.
 *   The rulebook is explicit that a depleted gold supply does NOT fall back
 *   to silver ("금화가 떨어진 경우 은화를 가져오지 않습니다", §5-D-2) — note
 *   this project's task brief describes the opposite ("금화 소진 시 은화가
 *   이동함"); the rulebook document is treated as authoritative here per
 *   this project's convention (docs/architecture.md §5).
 */

import {
  addBundle,
  basicProductionCard,
  basicUpgradeCard,
  bundleTotal,
  canAfford,
  createMerchantDeck,
  createPointDeck,
  RESOURCE_ORDER,
  scaleBundle,
  subtractBundle,
  upgradeOf,
  type MerchantCard,
  type PointCard,
  type Resource,
  type ResourceBundle,
} from "./cards";

export type { Resource, ResourceBundle, MerchantCard, PointCard } from "./cards";

export type SeatIndex = number;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;
/** Rulebook §6 — resources are capped at 10 on a player's cart at the end of their turn. */
export const HAND_LIMIT = 10;
export const MERCHANT_MARKET_SIZE = 6;
export const POINT_MARKET_SIZE = 5;

/** Rulebook §3.2-4 starting resources, indexed by seat (0 = 선 플레이어). */
const STARTING_RESOURCES: ResourceBundle[] = [
  { yellow: 3 },
  { yellow: 4 },
  { yellow: 4 },
  { yellow: 3, red: 1 },
  { yellow: 3, red: 1 },
];

export interface PlayerState {
  seat: SeatIndex;
  /** Merchant cards ready to play. */
  hand: MerchantCard[];
  /** Merchant cards already played this "cycle" — recovered in full by `rest`. */
  playedCards: MerchantCard[];
  resources: ResourceBundle;
  pointCards: PointCard[];
  gold: number;
  silver: number;
}

export type Phase = "playing" | "discarding" | "gameOver";

export interface CenturyState {
  playerCount: number;
  players: PlayerState[];
  merchantDeck: MerchantCard[];
  /** Always length `MERCHANT_MARKET_SIZE`; a `null` slot only happens once the deck runs dry. */
  merchantMarket: (MerchantCard | null)[];
  /** Parallel to `merchantMarket` — resources players have staked onto each displayed card while acquiring a card further right (rulebook §5-B-2/3). */
  merchantMarketResources: ResourceBundle[];
  pointDeck: PointCard[];
  /** Always length `POINT_MARKET_SIZE`; a `null` slot only happens once the deck runs dry. */
  pointMarket: (PointCard | null)[];
  goldSupply: number;
  silverSupply: number;
  activeSeat: SeatIndex;
  /** Non-null only while `phase === "discarding"` — the seat that must shed resources down to `HAND_LIMIT` before the turn can advance (rulebook §6). */
  awaitingDiscardSeat: SeatIndex | null;
  /** Set once any player reaches `pointCardGoal` (rulebook §7.1) — turns keep advancing normally until the seat right before the starter (playerCount - 1) finishes theirs. */
  endTriggered: boolean;
  phase: Phase;
  turnNumber: number;
  /** 5 for 4-5 players, 6 for 2-3 (rulebook §7.1). */
  pointCardGoal: number;
}

export type EngineAction =
  | { type: "playProduction"; seat: SeatIndex; cardId: string }
  | { type: "playUpgrade"; seat: SeatIndex; cardId: string; upgrades: Resource[] }
  | { type: "playTrade"; seat: SeatIndex; cardId: string; repeats: number }
  | { type: "acquireMerchant"; seat: SeatIndex; index: number; payment: Resource[] }
  | { type: "rest"; seat: SeatIndex }
  | { type: "claimPoint"; seat: SeatIndex; index: number }
  | { type: "discardToLimit"; seat: SeatIndex; discard: ResourceBundle };

/** Deterministic PRNG + shuffle, shared across every engine — see src/lib/rng.ts. */
import { seededRng, shuffle } from "@/lib/rng";
export { seededRng };

function findPlayer(state: CenturyState, seat: SeatIndex): PlayerState | undefined {
  return state.players.find((p) => p.seat === seat);
}

function updatePlayer(state: CenturyState, seat: SeatIndex, patch: Partial<PlayerState>): PlayerState[] {
  return state.players.map((p) => (p.seat === seat ? { ...p, ...patch } : p));
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function startGame(playerCount: number, seed: number): CenturyState {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`Unsupported player count: ${playerCount}`);
  }
  const rng = seededRng(seed);

  const shuffledMerchants = shuffle(createMerchantDeck(), rng);
  const merchantMarket: (MerchantCard | null)[] = shuffledMerchants.slice(0, MERCHANT_MARKET_SIZE);
  const merchantDeck = shuffledMerchants.slice(MERCHANT_MARKET_SIZE);
  const merchantMarketResources: ResourceBundle[] = Array.from({ length: MERCHANT_MARKET_SIZE }, () => ({}));

  const shuffledPoints = shuffle(createPointDeck(), rng);
  const pointMarket: (PointCard | null)[] = shuffledPoints.slice(0, POINT_MARKET_SIZE);
  const pointDeck = shuffledPoints.slice(POINT_MARKET_SIZE);

  const players: PlayerState[] = Array.from({ length: playerCount }, (_, seat) => ({
    seat,
    hand: [basicProductionCard(seat), basicUpgradeCard(seat)],
    playedCards: [],
    resources: { ...STARTING_RESOURCES[seat] },
    pointCards: [],
    gold: 0,
    silver: 0,
  }));

  return {
    playerCount,
    players,
    merchantDeck,
    merchantMarket,
    merchantMarketResources,
    pointDeck,
    pointMarket,
    goldSupply: playerCount * 2,
    silverSupply: playerCount * 2,
    activeSeat: 0,
    awaitingDiscardSeat: null,
    endTriggered: false,
    phase: "playing",
    turnNumber: 1,
    pointCardGoal: playerCount <= 3 ? 6 : 5,
  };
}

// ---------------------------------------------------------------------------
// Turn-flow helpers
// ---------------------------------------------------------------------------

/** After any action resolves, either gate on the mandatory 10-resource discard or hand off to the next seat. */
function finishTurn(state: CenturyState, seat: SeatIndex): CenturyState {
  const player = findPlayer(state, seat)!;
  if (bundleTotal(player.resources) > HAND_LIMIT) {
    return { ...state, phase: "discarding", awaitingDiscardSeat: seat };
  }
  return advanceTurn(state, seat);
}

function advanceTurn(state: CenturyState, justFinishedSeat: SeatIndex): CenturyState {
  if (state.endTriggered && justFinishedSeat === state.playerCount - 1) {
    return { ...state, phase: "gameOver", awaitingDiscardSeat: null };
  }
  return {
    ...state,
    phase: "playing",
    awaitingDiscardSeat: null,
    activeSeat: (justFinishedSeat + 1) % state.playerCount,
    turnNumber: state.turnNumber + 1,
  };
}

// ---------------------------------------------------------------------------
// A. Play a merchant card
// ---------------------------------------------------------------------------

function playProduction(state: CenturyState, seat: SeatIndex, cardId: string): CenturyState {
  if (state.phase !== "playing" || seat !== state.activeSeat) return state;
  const player = findPlayer(state, seat);
  const card = player?.hand.find((c) => c.id === cardId);
  if (!player || !card || card.effect.kind !== "production") return state;

  const players = updatePlayer(state, seat, {
    hand: player.hand.filter((c) => c.id !== cardId),
    playedCards: [...player.playedCards, card],
    resources: addBundle(player.resources, card.effect.gain),
  });
  return finishTurn({ ...state, players }, seat);
}

/**
 * `steps` is the sequence of upgrade steps to apply, each naming the
 * *current* color of the cube being bumped one tier — this lets a single
 * physical cube be chained through multiple tiers (rulebook §4.2's "노란색
 * 1개를 빨간색을 거쳐 초록색 1개로" example: `["yellow", "red"]`) by simulating
 * each step against a running copy of the resources, rather than needing a
 * second "how many tiers per cube" data shape. Returns `null` if any step is
 * invalid (nothing of that color left to upgrade, or it's already brown).
 * Exported so the board UI can render a live preview with the exact same
 * validation the engine will apply — one place these rules can't drift out
 * of sync (mirrors `validateRaise`/`minValidQuantityForFace` in perudo/engine.ts).
 */
export function simulateUpgrade(resources: ResourceBundle, steps: Resource[]): ResourceBundle | null {
  const working: ResourceBundle = { ...resources };
  for (const from of steps) {
    const have = working[from] ?? 0;
    const to = upgradeOf(from);
    if (have <= 0 || !to) return null;
    if (have - 1 === 0) delete working[from];
    else working[from] = have - 1;
    working[to] = (working[to] ?? 0) + 1;
  }
  return working;
}

function playUpgrade(state: CenturyState, seat: SeatIndex, cardId: string, upgrades: Resource[]): CenturyState {
  if (state.phase !== "playing" || seat !== state.activeSeat) return state;
  const player = findPlayer(state, seat);
  const card = player?.hand.find((c) => c.id === cardId);
  if (!player || !card || card.effect.kind !== "upgrade") return state;
  if (upgrades.length > card.effect.upgrades) return state;

  const working = simulateUpgrade(player.resources, upgrades);
  if (!working) return state;

  const players = updatePlayer(state, seat, {
    hand: player.hand.filter((c) => c.id !== cardId),
    playedCards: [...player.playedCards, card],
    resources: working,
  });
  return finishTurn({ ...state, players }, seat);
}

/** Trade cards can be applied `repeats` times in one play (rulebook §5-A-3). */
function playTrade(state: CenturyState, seat: SeatIndex, cardId: string, repeats: number): CenturyState {
  if (state.phase !== "playing" || seat !== state.activeSeat) return state;
  if (!Number.isInteger(repeats) || repeats < 1) return state;
  const player = findPlayer(state, seat);
  const card = player?.hand.find((c) => c.id === cardId);
  if (!player || !card || card.effect.kind !== "trade") return state;

  const totalCost = scaleBundle(card.effect.cost, repeats);
  if (!canAfford(player.resources, totalCost)) return state;
  const totalGain = scaleBundle(card.effect.gain, repeats);

  const players = updatePlayer(state, seat, {
    hand: player.hand.filter((c) => c.id !== cardId),
    playedCards: [...player.playedCards, card],
    resources: addBundle(subtractBundle(player.resources, totalCost), totalGain),
  });
  return finishTurn({ ...state, players }, seat);
}

// ---------------------------------------------------------------------------
// B. Acquire a merchant card
// ---------------------------------------------------------------------------

/**
 * `payment` must have exactly `index` entries — one resource (player's free
 * choice of color) staked onto each of the market cards to its left
 * (rulebook §5-B-2). Slot 0 is always free (`payment` is `[]`).
 */
function acquireMerchant(state: CenturyState, seat: SeatIndex, index: number, payment: Resource[]): CenturyState {
  if (state.phase !== "playing" || seat !== state.activeSeat) return state;
  if (index < 0 || index >= MERCHANT_MARKET_SIZE) return state;
  const card = state.merchantMarket[index];
  if (!card) return state;
  if (payment.length !== index) return state;
  const player = findPlayer(state, seat)!;

  const paymentCost: ResourceBundle = {};
  for (const r of payment) paymentCost[r] = (paymentCost[r] ?? 0) + 1;
  if (!canAfford(player.resources, paymentCost)) return state;

  const marketResources = state.merchantMarketResources.map((bundle, i) =>
    i < index ? addBundle(bundle, { [payment[i]]: 1 }) : bundle,
  );
  const gainedFromCard = marketResources[index];
  const finalResources = addBundle(subtractBundle(player.resources, paymentCost), gainedFromCard);

  const players = updatePlayer(state, seat, { hand: [...player.hand, card], resources: finalResources });

  const remainingCards = state.merchantMarket.filter((_, i) => i !== index);
  const remainingResources = marketResources.filter((_, i) => i !== index);
  const drawn = state.merchantDeck[0] ?? null;
  const merchantDeck = state.merchantDeck.slice(1);
  const merchantMarket = [...remainingCards, drawn];
  const merchantMarketResources = [...remainingResources, {}];

  return finishTurn({ ...state, players, merchantMarket, merchantMarketResources, merchantDeck }, seat);
}

// ---------------------------------------------------------------------------
// C. Rest
// ---------------------------------------------------------------------------

function rest(state: CenturyState, seat: SeatIndex): CenturyState {
  if (state.phase !== "playing" || seat !== state.activeSeat) return state;
  const player = findPlayer(state, seat)!;
  const players = updatePlayer(state, seat, { hand: [...player.hand, ...player.playedCards], playedCards: [] });
  return finishTurn({ ...state, players }, seat);
}

// ---------------------------------------------------------------------------
// D. Claim a point card
// ---------------------------------------------------------------------------

function claimPoint(state: CenturyState, seat: SeatIndex, index: number): CenturyState {
  if (state.phase !== "playing" || seat !== state.activeSeat) return state;
  if (index < 0 || index >= POINT_MARKET_SIZE) return state;
  const card = state.pointMarket[index];
  if (!card) return state;
  const player = findPlayer(state, seat)!;
  if (!canAfford(player.resources, card.cost)) return state;

  let gold = player.gold;
  let silver = player.silver;
  let goldSupply = state.goldSupply;
  let silverSupply = state.silverSupply;
  // Rulebook §5-D-2: only slots 0/1 grant a bonus coin, and a depleted gold
  // supply does NOT fall back to silver (see module doc).
  if (index === 0 && goldSupply > 0) {
    gold += 1;
    goldSupply -= 1;
  } else if (index === 1 && silverSupply > 0) {
    silver += 1;
    silverSupply -= 1;
  }

  const players = updatePlayer(state, seat, {
    resources: subtractBundle(player.resources, card.cost),
    pointCards: [...player.pointCards, card],
    gold,
    silver,
  });

  const remainingCards = state.pointMarket.filter((_, i) => i !== index);
  const drawn = state.pointDeck[0] ?? null;
  const pointDeck = state.pointDeck.slice(1);
  const pointMarket = [...remainingCards, drawn];

  const claimant = players.find((p) => p.seat === seat)!;
  const endTriggered = state.endTriggered || claimant.pointCards.length >= state.pointCardGoal;

  return finishTurn({ ...state, players, pointMarket, pointDeck, goldSupply, silverSupply, endTriggered }, seat);
}

// ---------------------------------------------------------------------------
// End-of-turn mandatory discard (rulebook §6)
// ---------------------------------------------------------------------------

function discardToLimit(state: CenturyState, seat: SeatIndex, discard: ResourceBundle): CenturyState {
  if (state.phase !== "discarding" || state.awaitingDiscardSeat !== seat) return state;
  const player = findPlayer(state, seat)!;
  if (!canAfford(player.resources, discard)) return state;
  const remaining = subtractBundle(player.resources, discard);
  if (bundleTotal(remaining) !== HAND_LIMIT) return state; // must land exactly on the 10-resource cap

  const players = updatePlayer(state, seat, { resources: remaining });
  return advanceTurn({ ...state, players }, seat);
}

/** Single entry point applying any `EngineAction` to a state — the whole engine as one reducer. */
export function applyAction(state: CenturyState, action: EngineAction): CenturyState {
  switch (action.type) {
    case "playProduction":
      return playProduction(state, action.seat, action.cardId);
    case "playUpgrade":
      return playUpgrade(state, action.seat, action.cardId, action.upgrades);
    case "playTrade":
      return playTrade(state, action.seat, action.cardId, action.repeats);
    case "acquireMerchant":
      return acquireMerchant(state, action.seat, action.index, action.payment);
    case "rest":
      return rest(state, action.seat);
    case "claimPoint":
      return claimPoint(state, action.seat, action.index);
    case "discardToLimit":
      return discardToLimit(state, action.seat, action.discard);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// UI helper predicates — pure derived values, computed on demand rather than
// stored (this project's "파생 상태 금지" principle, docs/architecture.md §1.4).
// ---------------------------------------------------------------------------

export function canAcquireMerchant(player: PlayerState, index: number): boolean {
  return bundleTotal(player.resources) >= index;
}

export function canClaimPoint(player: PlayerState, card: PointCard): boolean {
  return canAfford(player.resources, card.cost);
}

/** The largest `repeats` the player can currently afford for a trade card — used to clamp the UI's stepper. */
export function maxTradeRepeats(player: PlayerState, cost: ResourceBundle): number {
  let max = Infinity;
  for (const r of RESOURCE_ORDER) {
    const need = cost[r] ?? 0;
    if (need <= 0) continue;
    max = Math.min(max, Math.floor((player.resources[r] ?? 0) / need));
  }
  return Number.isFinite(max) ? Math.max(0, max) : 0;
}

// ---------------------------------------------------------------------------
// Final scoring (rulebook §7.2/§7.3)
// ---------------------------------------------------------------------------

export interface PlayerScore {
  seat: SeatIndex;
  pointCardScore: number;
  goldScore: number;
  silverScore: number;
  /** Non-yellow resources remaining, 1 point each. */
  resourceScore: number;
  total: number;
}

export function computePlayerScore(player: PlayerState): PlayerScore {
  const pointCardScore = player.pointCards.reduce((sum, c) => sum + c.points, 0);
  const goldScore = player.gold * 3;
  const silverScore = player.silver * 1;
  const resourceScore = RESOURCE_ORDER.filter((r) => r !== "yellow").reduce((sum, r) => sum + (player.resources[r] ?? 0), 0);
  return { seat: player.seat, pointCardScore, goldScore, silverScore, resourceScore, total: pointCardScore + goldScore + silverScore + resourceScore };
}

export interface RankedSeat {
  seat: SeatIndex;
  rank: number;
  score: PlayerScore;
}

/**
 * Only meaningful once `state.phase === "gameOver"`. Rulebook §7.3: ties are
 * always broken by later turn order (higher seat wins), so this ranking
 * never produces a genuine tie.
 */
export function computeRankings(state: CenturyState): RankedSeat[] {
  const scores = state.players.map(computePlayerScore);
  const sorted = [...scores].sort((a, b) => b.total - a.total || b.seat - a.seat);
  return sorted.map((score, i) => ({ seat: score.seat, rank: i + 1, score }));
}
