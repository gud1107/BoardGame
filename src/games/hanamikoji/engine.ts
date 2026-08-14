/**
 * Pure Hanamikoji rules engine — no React, no I/O. Implements the official
 * 2-player ruleset:
 *  - 21 item cards, one per geisha's charm value (2,2,2,3,3,4,5 = 21 cards).
 *  - Each round: 1 card removed unseen, 6 dealt to each player, 8-card draw
 *    pile. Players alternate 4 turns each; every turn = draw 1, then use one
 *    of the four actions (Secret / Trade-off / Gift / Compete), each usable
 *    exactly once per round.
 *  - At round end, item cards are compared per geisha; majority wins that
 *    geisha (ties leave ownership unchanged). Geisha ownership PERSISTS
 *    across rounds within a match.
 *  - The match ends the instant a player controls >=4 geisha or >=11 charm
 *    points; if a round somehow satisfies both thresholds for both players
 *    simultaneously, charm points break the tie.
 */

export type Owner = "p1" | "p2";

export const ACTION_TYPES = ["secret", "tradeoff", "gift", "compete"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export interface Geisha {
  id: string;
  name: string;
  value: number;
}

export const GEISHAS: Geisha[] = [
  { id: "g5", name: "설월화", value: 5 },
  { id: "g4", name: "단풍", value: 4 },
  { id: "g3a", name: "동백", value: 3 },
  { id: "g3b", name: "벚꽃", value: 3 },
  { id: "g2a", name: "국화", value: 2 },
  { id: "g2b", name: "매화", value: 2 },
  { id: "g2c", name: "창포", value: 2 },
];

export interface ItemCard {
  id: string;
  geishaId: string;
}

export function other(owner: Owner): Owner {
  return owner === "p1" ? "p2" : "p1";
}

function buildDeck(): ItemCard[] {
  const deck: ItemCard[] = [];
  for (const geisha of GEISHAS) {
    for (let i = 0; i < geisha.value; i++) {
      deck.push({ id: `${geisha.id}-${i}`, geishaId: geisha.id });
    }
  }
  return deck;
}

/** Deterministic PRNG + shuffle, shared across every engine — see src/lib/rng.ts. */
import { seededRng, shuffle } from "@/lib/rng";
export { seededRng };

export interface PlayerRoundState {
  hand: ItemCard[];
  actionsUsed: ActionType[];
  secretCard: ItemCard | null;
  wonCards: ItemCard[];
  discarded: ItemCard[];
}

function emptyPlayerState(): PlayerRoundState {
  return { hand: [], actionsUsed: [], secretCard: null, wonCards: [], discarded: [] };
}

export type GeishaOwnership = Record<string, Owner | null>;

export interface PendingGiftOffer {
  kind: "gift";
  offeredBy: Owner;
  cards: [ItemCard, ItemCard, ItemCard];
}

export interface PendingCompeteOffer {
  kind: "compete";
  offeredBy: Owner;
  sets: [[ItemCard, ItemCard], [ItemCard, ItemCard]];
}

export type PendingOffer = PendingGiftOffer | PendingCompeteOffer;

export type RoundPhase =
  | "awaiting-draw"
  | "awaiting-action"
  | "awaiting-response"
  | "round-end"
  | "match-end";

export interface HanamikojiState {
  players: Record<Owner, PlayerRoundState>;
  deck: ItemCard[];
  removedCard: ItemCard | null;
  geishaOwnership: GeishaOwnership;
  activePlayer: Owner;
  roundStarter: Owner;
  turnInRound: number; // 0-7, each player gets 4
  phase: RoundPhase;
  pendingOffer: PendingOffer | null;
  roundNumber: number;
  matchWinner: Owner | null;
  lastRoundSummary: RoundSummary | null;
}

export interface RoundSummary {
  roundNumber: number;
  geishaResults: { geishaId: string; p1Count: number; p2Count: number; winner: Owner | null }[];
}

export function createInitialOwnership(): GeishaOwnership {
  return Object.fromEntries(GEISHAS.map((g) => [g.id, null]));
}

export function startRound(
  roundNumber: number,
  roundStarter: Owner,
  geishaOwnership: GeishaOwnership,
  rng?: () => number,
): HanamikojiState {
  const shuffled = shuffle(buildDeck(), rng);
  const [removedCard, ...rest] = shuffled;
  const p1Hand = rest.slice(0, 6);
  const p2Hand = rest.slice(6, 12);
  const deck = rest.slice(12);

  return {
    players: {
      p1: { ...emptyPlayerState(), hand: p1Hand },
      p2: { ...emptyPlayerState(), hand: p2Hand },
    },
    deck,
    removedCard,
    geishaOwnership,
    activePlayer: roundStarter,
    roundStarter,
    turnInRound: 0,
    phase: "awaiting-draw",
    pendingOffer: null,
    roundNumber,
    matchWinner: null,
    lastRoundSummary: null,
  };
}

export function drawCard(state: HanamikojiState): HanamikojiState {
  if (state.phase !== "awaiting-draw") return state;
  const [card, ...rest] = state.deck;
  if (!card) return { ...state, phase: "awaiting-action" };
  const active = state.activePlayer;
  return {
    ...state,
    deck: rest,
    players: {
      ...state.players,
      [active]: { ...state.players[active], hand: [...state.players[active].hand, card] },
    },
    phase: "awaiting-action",
  };
}

function availableActions(playerState: PlayerRoundState): ActionType[] {
  return ACTION_TYPES.filter((a) => !playerState.actionsUsed.includes(a));
}

export function getAvailableActions(state: HanamikojiState): ActionType[] {
  return availableActions(state.players[state.activePlayer]);
}

function removeFromHand(hand: ItemCard[], ids: string[]): ItemCard[] {
  const idSet = new Set(ids);
  return hand.filter((c) => !idSet.has(c.id));
}

function findCards(hand: ItemCard[], ids: string[]): ItemCard[] {
  const byId = new Map(hand.map((c) => [c.id, c]));
  return ids.map((id) => {
    const card = byId.get(id);
    if (!card) throw new Error(`Card ${id} not in hand`);
    return card;
  });
}

/** Ends the current player's turn: hands off to the opponent, or scores the round if both are done. */
function advanceTurn(state: HanamikojiState): HanamikojiState {
  const turnInRound = state.turnInRound + 1;
  if (turnInRound >= 8) {
    return scoreRound({ ...state, turnInRound, phase: "round-end" });
  }
  return {
    ...state,
    turnInRound,
    activePlayer: other(state.activePlayer),
    phase: "awaiting-draw",
  };
}

export function chooseSecret(state: HanamikojiState, cardId: string): HanamikojiState {
  const active = state.activePlayer;
  const p = state.players[active];
  const [card] = findCards(p.hand, [cardId]);
  const updated: PlayerRoundState = {
    ...p,
    hand: removeFromHand(p.hand, [cardId]),
    secretCard: card,
    actionsUsed: [...p.actionsUsed, "secret"],
  };
  return advanceTurn({ ...state, players: { ...state.players, [active]: updated } });
}

export function chooseTradeoff(state: HanamikojiState, cardIds: [string, string]): HanamikojiState {
  const active = state.activePlayer;
  const p = state.players[active];
  const cards = findCards(p.hand, cardIds);
  const updated: PlayerRoundState = {
    ...p,
    hand: removeFromHand(p.hand, cardIds),
    discarded: [...p.discarded, ...cards],
    actionsUsed: [...p.actionsUsed, "tradeoff"],
  };
  return advanceTurn({ ...state, players: { ...state.players, [active]: updated } });
}

export function chooseGift(
  state: HanamikojiState,
  cardIds: [string, string, string],
): HanamikojiState {
  const active = state.activePlayer;
  const p = state.players[active];
  const cards = findCards(p.hand, cardIds) as [ItemCard, ItemCard, ItemCard];
  const updated: PlayerRoundState = {
    ...p,
    hand: removeFromHand(p.hand, cardIds),
    actionsUsed: [...p.actionsUsed, "gift"],
  };
  return {
    ...state,
    players: { ...state.players, [active]: updated },
    phase: "awaiting-response",
    pendingOffer: { kind: "gift", offeredBy: active, cards },
  };
}

export function chooseCompete(
  state: HanamikojiState,
  setA: [string, string],
  setB: [string, string],
): HanamikojiState {
  const active = state.activePlayer;
  const p = state.players[active];
  const cardsA = findCards(p.hand, setA) as [ItemCard, ItemCard];
  const cardsB = findCards(p.hand, setB) as [ItemCard, ItemCard];
  const updated: PlayerRoundState = {
    ...p,
    hand: removeFromHand(p.hand, [...setA, ...setB]),
    actionsUsed: [...p.actionsUsed, "compete"],
  };
  return {
    ...state,
    players: { ...state.players, [active]: updated },
    phase: "awaiting-response",
    pendingOffer: { kind: "compete", offeredBy: active, sets: [cardsA, cardsB] },
  };
}

export function resolveGiftResponse(state: HanamikojiState, chosenCardId: string): HanamikojiState {
  const offer = state.pendingOffer;
  if (!offer || offer.kind !== "gift") return state;
  const responder = other(offer.offeredBy);
  const chosen = offer.cards.find((c) => c.id === chosenCardId);
  if (!chosen) return state;
  const rest = offer.cards.filter((c) => c.id !== chosenCardId);

  const responderState = state.players[responder];
  const offererState = state.players[offer.offeredBy];

  return advanceTurn({
    ...state,
    pendingOffer: null,
    players: {
      ...state.players,
      [responder]: { ...responderState, wonCards: [...responderState.wonCards, chosen] },
      [offer.offeredBy]: { ...offererState, wonCards: [...offererState.wonCards, ...rest] },
    },
  });
}

export function resolveCompeteResponse(
  state: HanamikojiState,
  chosenSetIndex: 0 | 1,
): HanamikojiState {
  const offer = state.pendingOffer;
  if (!offer || offer.kind !== "compete") return state;
  const responder = other(offer.offeredBy);
  const chosenSet = offer.sets[chosenSetIndex];
  const otherSet = offer.sets[chosenSetIndex === 0 ? 1 : 0];

  const responderState = state.players[responder];
  const offererState = state.players[offer.offeredBy];

  return advanceTurn({
    ...state,
    pendingOffer: null,
    players: {
      ...state.players,
      [responder]: { ...responderState, wonCards: [...responderState.wonCards, ...chosenSet] },
      [offer.offeredBy]: { ...offererState, wonCards: [...offererState.wonCards, ...otherSet] },
    },
  });
}

function countByGeisha(cards: ItemCard[], geishaId: string): number {
  return cards.filter((c) => c.geishaId === geishaId).length;
}

/** Pure win-condition check, split out from `scoreRound` so it can be unit tested directly. */
export function determineMatchWinner(ownership: GeishaOwnership): Owner | null {
  const t = tally(ownership);
  const p1Wins = t.p1GeishaCount >= 4 || t.p1Points >= 11;
  const p2Wins = t.p2GeishaCount >= 4 || t.p2Points >= 11;
  if (!p1Wins && !p2Wins) return null;
  if (p1Wins && p2Wins) return t.p1Points >= t.p2Points ? "p1" : "p2";
  return p1Wins ? "p1" : "p2";
}

export function scoreRound(state: HanamikojiState): HanamikojiState {
  // Reveal secret cards into each player's won pile.
  const p1Won = [
    ...state.players.p1.wonCards,
    ...(state.players.p1.secretCard ? [state.players.p1.secretCard] : []),
  ];
  const p2Won = [
    ...state.players.p2.wonCards,
    ...(state.players.p2.secretCard ? [state.players.p2.secretCard] : []),
  ];

  const nextOwnership: GeishaOwnership = { ...state.geishaOwnership };
  const geishaResults: RoundSummary["geishaResults"] = [];

  for (const geisha of GEISHAS) {
    const p1Count = countByGeisha(p1Won, geisha.id);
    const p2Count = countByGeisha(p2Won, geisha.id);
    let winner: Owner | null = null;
    if (p1Count > p2Count) winner = "p1";
    else if (p2Count > p1Count) winner = "p2";
    if (winner) nextOwnership[geisha.id] = winner;
    geishaResults.push({ geishaId: geisha.id, p1Count, p2Count, winner });
  }

  const matchWinner = determineMatchWinner(nextOwnership);
  const phase: RoundPhase = matchWinner ? "match-end" : "round-end";

  return {
    ...state,
    geishaOwnership: nextOwnership,
    matchWinner,
    phase,
    lastRoundSummary: { roundNumber: state.roundNumber, geishaResults },
  };
}

export function tally(ownership: GeishaOwnership) {
  const p1GeishaCount = Object.values(ownership).filter((o) => o === "p1").length;
  const p2GeishaCount = Object.values(ownership).filter((o) => o === "p2").length;
  const p1Points = GEISHAS.filter((g) => ownership[g.id] === "p1").reduce((s, g) => s + g.value, 0);
  const p2Points = GEISHAS.filter((g) => ownership[g.id] === "p2").reduce((s, g) => s + g.value, 0);
  return { p1GeishaCount, p2GeishaCount, p1Points, p2Points };
}

/**
 * Every state transition a player can trigger, as a serializable message —
 * this is exactly what an online match broadcasts between the two clients.
 * `next-round` carries its own seed (rather than defaulting to Math.random)
 * so both clients deal the identical next hand from one shared number.
 */
export type EngineAction =
  | { type: "draw" }
  | { type: "secret"; cardId: string }
  | { type: "tradeoff"; cardIds: [string, string] }
  | { type: "gift"; cardIds: [string, string, string] }
  | { type: "compete"; setA: [string, string]; setB: [string, string] }
  | { type: "gift-response"; cardId: string }
  | { type: "compete-response"; index: 0 | 1 }
  | { type: "next-round"; seed: number };

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7 — every game exposes getValidMoves +
// chooseBotAction so a host client can drive a bot-occupied seat). Levels
// 1–10 route through the shared `pickByLevel` noise curve (botDifficulty.ts)
// on top of `scoreMove` below — see that module's doc for the tier design.
// ---------------------------------------------------------------------------

import { botTier, pickByLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";

const GEISHA_VALUE_BY_ID: Record<string, number> = Object.fromEntries(GEISHAS.map((g) => [g.id, g.value]));

function cardValue(card: ItemCard): number {
  return GEISHA_VALUE_BY_ID[card.geishaId] ?? 0;
}

function sumValues(cards: ItemCard[]): number {
  return cards.reduce((sum, c) => sum + cardValue(c), 0);
}

/** All k-element subsets of `items`, order-preserving. */
function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [first, ...rest] = items;
  const withFirst = combinations(rest, k - 1).map((c) => [first, ...c]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

/** The 3 ways to split 4 items into 2 unordered pairs. */
function pairSplits<T>([a, b, c, d]: [T, T, T, T]): [[T, T], [T, T]][] {
  return [
    [
      [a, b],
      [c, d],
    ],
    [
      [a, c],
      [b, d],
    ],
    [
      [a, d],
      [b, c],
    ],
  ];
}

/**
 * Every legal `EngineAction` `seat` may submit right now — the sole contract
 * a bot controller needs (see `useBotAutoplay`). Mirrors the exact guards
 * `applyAction`'s handlers use, so nothing here can produce a move the
 * reducer would silently reject as a no-op.
 */
export function getValidMoves(state: HanamikojiState, seat: Owner): EngineAction[] {
  if (state.phase === "awaiting-draw") {
    return state.activePlayer === seat ? [{ type: "draw" }] : [];
  }
  if (state.phase === "awaiting-action") {
    if (state.activePlayer !== seat) return [];
    const p = state.players[seat];
    const used = new Set(p.actionsUsed);
    const ids = p.hand.map((c) => c.id);
    const moves: EngineAction[] = [];
    if (!used.has("secret")) {
      for (const id of ids) moves.push({ type: "secret", cardId: id });
    }
    if (!used.has("tradeoff")) {
      for (const pair of combinations(ids, 2)) moves.push({ type: "tradeoff", cardIds: pair as [string, string] });
    }
    if (!used.has("gift")) {
      for (const triple of combinations(ids, 3)) moves.push({ type: "gift", cardIds: triple as [string, string, string] });
    }
    if (!used.has("compete")) {
      for (const quad of combinations(ids, 4)) {
        for (const [setA, setB] of pairSplits(quad as [string, string, string, string])) {
          moves.push({ type: "compete", setA, setB });
        }
      }
    }
    return moves;
  }
  if (state.phase === "awaiting-response" && state.pendingOffer) {
    const responder = other(state.pendingOffer.offeredBy);
    if (responder !== seat) return [];
    if (state.pendingOffer.kind === "gift") {
      return state.pendingOffer.cards.map((c) => ({ type: "gift-response", cardId: c.id }) as EngineAction);
    }
    return [0, 1].map((i) => ({ type: "compete-response", index: i as 0 | 1 }) as EngineAction);
  }
  // "round-end"/"match-end" advance via a shared "next round"/"confirm result"
  // button any viewer can click — not a per-seat decision, so bots don't need
  // to handle it (the human always in the room clicks through, same as any
  // all-bot-opponent match still has exactly one real device: the host).
  return [];
}

/**
 * A geisha whose remaining (still-in-play) item cards can no longer flip the
 * current-round majority is "locked" — deciding who wins it is already
 * settled from *visible* information alone (won piles + discards + the
 * face-down removed card, none of which requires reading either hand), so
 * Lv.8+ stops spending resources contesting it and instead prioritizes
 * geisha still genuinely up for grabs.
 */
type GeishaLock = "self" | "opp" | "contested";

function geishaLocks(state: HanamikojiState, seat: Owner): Record<string, GeishaLock> {
  const opp = other(seat);
  const locks: Record<string, GeishaLock> = {};
  for (const g of GEISHAS) {
    const selfWon = countByGeisha(state.players[seat].wonCards, g.id);
    const oppWon = countByGeisha(state.players[opp].wonCards, g.id);
    const selfDiscarded = countByGeisha(state.players[seat].discarded, g.id);
    const oppDiscarded = countByGeisha(state.players[opp].discarded, g.id);
    const removed = state.removedCard?.geishaId === g.id ? 1 : 0;
    const remaining = g.value - selfWon - oppWon - selfDiscarded - oppDiscarded - removed;
    const oppCanCatchUp = oppWon + remaining > selfWon;
    const selfCanCatchUp = selfWon + remaining > oppWon;
    if (!oppCanCatchUp && selfWon > oppWon) locks[g.id] = "self";
    else if (!selfCanCatchUp && oppWon > selfWon) locks[g.id] = "opp";
    else locks[g.id] = "contested";
  }
  return locks;
}

/** Lv.8+ card weight: contested geisha matter most, already-lost-this-round geisha are cheap to part with, already-secured ones are worth less urgency. */
function expertCardWeight(card: ItemCard, locks: Record<string, GeishaLock>): number {
  const base = cardValue(card);
  const lock = locks[card.geishaId];
  if (lock === "opp") return base * 0.15;
  if (lock === "self") return base * 0.6;
  return base * 1.3;
}

function expertSum(cards: ItemCard[], locks: Record<string, GeishaLock>): number {
  return cards.reduce((sum, c) => sum + expertCardWeight(c, locks), 0);
}

/** How good `move` looks for `seat` — higher is better, used only to rank candidates from `getValidMoves`. Lv.1–7 use a flat per-card value heuristic; Lv.8–10 (`botTier(level) === "expert"`) additionally reason about which geisha are already decided from visible info (see `geishaLocks`) to focus effort on genuinely contested ones. */
function scoreMove(state: HanamikojiState, seat: Owner, move: EngineAction, level: BotLevel): number {
  const p = state.players[seat];
  const byId = new Map(p.hand.map((c) => [c.id, c]));
  const cardsOf = (ids: string[]) => ids.map((id) => byId.get(id)!);
  const expert = botTier(level) === "expert";
  const locks = expert ? geishaLocks(state, seat) : null;
  const weight = (card: ItemCard) => (locks ? expertCardWeight(card, locks) : cardValue(card));
  const weightSum = (cards: ItemCard[]) => (locks ? expertSum(cards, locks) : sumValues(cards));

  switch (move.type) {
    case "draw":
      return 0;
    case "secret":
      // Keep the most valuable card for yourself.
      return weight(byId.get(move.cardId)!);
    case "tradeoff":
      // Cards are removed from the game entirely — sacrifice your cheapest ones.
      return -weightSum(cardsOf(move.cardIds));
    case "gift":
      // Opponent picks the best of the 3 you offer; keep the rest of your
      // hand strong by offering your weakest cards.
      return -weightSum(cardsOf(move.cardIds));
    case "compete": {
      // Opponent always takes the stronger pair, so your guaranteed floor is
      // the weaker one — maximize that floor by keeping the two pairs close
      // in value instead of dumping your best cards into one pile.
      const sumA = weightSum(cardsOf(move.setA));
      const sumB = weightSum(cardsOf(move.setB));
      return -Math.abs(sumA - sumB);
    }
    case "gift-response": {
      const offer = state.pendingOffer;
      const card = offer?.kind === "gift" ? offer.cards.find((c) => c.id === move.cardId) : undefined;
      return card ? weight(card) : 0;
    }
    case "compete-response": {
      const offer = state.pendingOffer;
      if (offer?.kind !== "compete") return 0;
      return weightSum(offer.sets[move.index]);
    }
    default:
      return 0;
  }
}

/**
 * Picks a move for `seat` per the shared Level 1–10 curve (`pickByLevel`,
 * botDifficulty.ts): scores every legal move with `scoreMove`, then lets the
 * level decide how reliably the best-scored one actually gets played. `rng`
 * defaults to `Math.random` since bot decisions are local UX, not part of
 * the deterministic engine contract — the resulting `EngineAction` is still
 * applied through the ordinary, fully deterministic `applyAction`.
 */
export function chooseBotAction(
  state: HanamikojiState,
  seat: Owner,
  level: BotLevel = 5,
  rng: () => number = Math.random,
): EngineAction | null {
  const moves = getValidMoves(state, seat);
  if (moves.length === 0) return null;
  const scored = moves.map((move) => ({ move, score: scoreMove(state, seat, move, level) }));
  return pickByLevel(scored, level, rng);
}

/** Single entry point applying any `EngineAction` to a state — the whole engine as one reducer. */
export function applyAction(state: HanamikojiState, action: EngineAction): HanamikojiState {
  switch (action.type) {
    case "draw":
      return drawCard(state);
    case "secret":
      return chooseSecret(state, action.cardId);
    case "tradeoff":
      return chooseTradeoff(state, action.cardIds);
    case "gift":
      return chooseGift(state, action.cardIds);
    case "compete":
      return chooseCompete(state, action.setA, action.setB);
    case "gift-response":
      return resolveGiftResponse(state, action.cardId);
    case "compete-response":
      return resolveCompeteResponse(state, action.index);
    case "next-round":
      return startRound(
        state.roundNumber + 1,
        other(state.roundStarter),
        state.geishaOwnership,
        seededRng(action.seed),
      );
    default:
      return state;
  }
}
