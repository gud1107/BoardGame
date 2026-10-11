/**
 * Pure "블러프 룰렛(Bluff Roulette)" rules engine — no React, no I/O.
 * Implements boardGameRule/블러프룰렛/블러프룰렛.md (the rulebook is the
 * source of truth; section letters below refer to it): every round each
 * survivor gets 5 cards and a random "오늘의 카드" suit is shown; players
 * take turns playing 1–3 cards face-down (implicitly claiming they are all
 * that suit) or shouting "거짓말!" at the previous play. Whoever is wrong
 * pulls the trigger on their own never-reloaded 6-chamber revolver.
 *
 * Same lockstep trust model as every other online game here (see
 * coyote/engine.ts): every client computes the full state from a shared
 * seed + replayed `EngineAction`s; hand secrecy is a view-layer projection
 * (`getPlayerView`). All randomness is seeded — never `Math.random` in the
 * reducer (bullet positions are drawn in `startGame`, decks/suits in
 * `dealRound` from the `continue` action's seed).
 */

import { seededRng, shuffle } from "@/lib/rng";
import { tallyAdd, tallyMax, type StatTally } from "@/games/shared/statTally";
import { botTier, pickByLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";

export type SeatIndex = number;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const HAND_SIZE = 5;
export const CHAMBERS = 6;
export const MAX_PLAY = 3;

export type Suit = "sun" | "moon" | "star";
export type CardKind = Suit | "mask" | "skull";
export const SUITS: readonly Suit[] = ["sun", "moon", "star"];

export interface Card {
  id: number;
  kind: CardKind;
}

export interface GameOptions {
  /** §M — one 🎭 mask is swapped for a 💀 skull. */
  skullMode: boolean;
}

export const DEFAULT_OPTIONS: GameOptions = { skullMode: false };

/** §O — the deck is sized by the STARTING player count and never shrinks. */
export function deckSpec(playerCount: number): { perSuit: number; masks: number } {
  return playerCount <= 4 ? { perSuit: 6, masks: 2 } : { perSuit: 9, masks: 3 };
}

export function buildDeck(playerCount: number, options: GameOptions): Card[] {
  const { perSuit, masks } = deckSpec(playerCount);
  const cards: Card[] = [];
  let id = 0;
  for (const suit of SUITS) for (let i = 0; i < perSuit; i++) cards.push({ id: id++, kind: suit });
  for (let i = 0; i < masks; i++) cards.push({ id: id++, kind: options.skullMode && i === 0 ? "skull" : "mask" });
  return cards;
}

/** A card counts as "진짜" for a play of `cards` under `tableSuit` (§I, §M: a skull is only truthful alone). */
export function isTrueCard(card: Card, tableSuit: Suit): boolean {
  return card.kind === tableSuit || card.kind === "mask";
}

export function isSkullSolo(cards: readonly Card[]): boolean {
  return cards.length === 1 && cards[0].kind === "skull";
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface PlayerState {
  seat: SeatIndex;
  alive: boolean;
  hand: Card[];
  /** Trigger pulls so far (public, "n/6"). */
  shots: number;
  /** Chamber index 0..5 holding the live round (hidden; fixed for the whole game, §D). */
  bullet: number;
}

export interface Play {
  seat: SeatIndex;
  cards: Card[];
}

export interface Pull {
  seat: SeatIndex;
  /** Shots already taken before this pull (the chamber being fired). */
  chamber: number;
  hit: boolean;
}

export interface Resolution {
  challengerSeat: SeatIndex;
  accusedSeat: SeatIndex;
  revealed: Card[];
  tableSuit: Suit;
  /** true = the accused told the truth. */
  truthful: boolean;
  /** §M — a lone skull was revealed: everyone else pulled. */
  skull: boolean;
  /** The challenger had no cards and no choice (§L). */
  forced: boolean;
  pulls: Pull[];
}

export type Phase = "playing" | "reveal" | "gameOver";

export interface BluffRouletteState {
  playerCount: number;
  options: GameOptions;
  players: PlayerState[];
  tableSuit: Suit;
  /** Every play this round, oldest first; the last one is the only challengeable one. */
  pile: Play[];
  activeSeat: SeatIndex;
  roundStarter: SeatIndex;
  roundNumber: number;
  phase: Phase;
  lastResolution: Resolution | null;
  /** Seats in elimination order (first out first). */
  eliminationOrder: SeatIndex[];
  winnerSeat: SeatIndex | null;
  statTally?: StatTally;
}

export type EngineAction =
  | { type: "play"; seat: SeatIndex; cardIds: number[] }
  | { type: "liar"; seat: SeatIndex }
  | { type: "continue"; seed: number };

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function dealRound(state: Pick<BluffRouletteState, "playerCount" | "options" | "players">, rng: () => number) {
  const deck = shuffle(buildDeck(state.playerCount, state.options), rng);
  let next = 0;
  const players = state.players.map((p) => {
    if (!p.alive) return { ...p, hand: [] };
    const hand = deck.slice(next, next + HAND_SIZE);
    next += HAND_SIZE;
    return { ...p, hand };
  });
  const tableSuit = SUITS[Math.floor(rng() * SUITS.length)];
  return { players, tableSuit };
}

export function startGame(playerCount: number, seed: number, options: GameOptions = DEFAULT_OPTIONS): BluffRouletteState {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) throw new Error(`Unsupported player count: ${playerCount}`);
  const rng = seededRng(seed);
  const base = Array.from({ length: playerCount }, (_, seat) => ({
    seat,
    alive: true,
    hand: [] as Card[],
    shots: 0,
    bullet: Math.floor(rng() * CHAMBERS),
  }));
  const starter = Math.floor(rng() * playerCount);
  const { players, tableSuit } = dealRound({ playerCount, options, players: base }, rng);
  return {
    playerCount,
    options: { ...options },
    players,
    tableSuit,
    pile: [],
    activeSeat: starter,
    roundStarter: starter,
    roundNumber: 1,
    phase: "playing",
    lastResolution: null,
    eliminationOrder: [],
    winnerSeat: null,
  };
}

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

export function aliveSeats(state: BluffRouletteState): SeatIndex[] {
  return state.players.filter((p) => p.alive).map((p) => p.seat);
}

export function lastPlay(state: BluffRouletteState): Play | null {
  return state.pile.length > 0 ? state.pile[state.pile.length - 1] : null;
}

/** Seats after `seat` in table order (excluding `seat` itself), wrapping once. */
function seatsAfter(state: BluffRouletteState, seat: SeatIndex): PlayerState[] {
  const out: PlayerState[] = [];
  for (let i = 1; i < state.playerCount; i++) out.push(state.players[(seat + i) % state.playerCount]);
  return out;
}

function nextAlive(state: BluffRouletteState, seat: SeatIndex): SeatIndex {
  return seatsAfter(state, seat).find((p) => p.alive)?.seat ?? seat;
}

/** §L — the active seat may only call "거짓말!" (it has no cards left to play). */
export function mustChallenge(state: BluffRouletteState): boolean {
  if (state.phase !== "playing" || state.pile.length === 0) return false;
  return state.players[state.activeSeat].hand.length === 0;
}

export function canChallenge(state: BluffRouletteState): boolean {
  return state.phase === "playing" && state.pile.length > 0;
}

/** Shots-before → chance the next pull fires (§J). */
export function pullDanger(shots: number): number {
  return shots >= CHAMBERS - 1 ? 1 : 1 / (CHAMBERS - shots);
}

export interface PlayerView {
  seat: SeatIndex;
  alive: boolean;
  handCount: number;
  shots: number;
  /** Only the viewer's own hand; null for everyone else. */
  hand: Card[] | null;
}

/** §Q — what `viewerSeat` may see: own hand only, everyone's counts and shots. Bullets are never exposed. */
export function getPlayerView(state: BluffRouletteState, viewerSeat: SeatIndex | null): PlayerView[] {
  return state.players.map((p) => ({
    seat: p.seat,
    alive: p.alive,
    handCount: p.hand.length,
    shots: p.shots,
    hand: p.seat === viewerSeat ? p.hand : null,
  }));
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function play(state: BluffRouletteState, seat: SeatIndex, cardIds: number[]): BluffRouletteState {
  if (state.phase !== "playing" || seat !== state.activeSeat) return state;
  const player = state.players[seat];
  if (!player?.alive) return state;
  const unique = [...new Set(cardIds)];
  if (unique.length < 1 || unique.length > MAX_PLAY || unique.length !== cardIds.length) return state;
  const cards = unique.map((id) => player.hand.find((c) => c.id === id));
  if (cards.some((c) => !c)) return state;
  const played = cards as Card[];

  const hand = player.hand.filter((c) => !unique.includes(c.id));
  const players = state.players.map((p) => (p.seat === seat ? { ...p, hand } : p));
  const next: BluffRouletteState = { ...state, players, pile: [...state.pile, { seat, cards: played }] };

  // §G/§L — next survivor holding cards; if nobody else has any, the next survivor must challenge.
  const after = seatsAfter(next, seat).filter((p) => p.alive);
  const responder = after.find((p) => p.hand.length > 0) ?? after[0];

  const lie = !(isSkullSolo(played) || played.every((c) => isTrueCard(c, state.tableSuit)));
  let statTally = tallyAdd(state.statTally, seat, "plays");
  if (lie) statTally = tallyAdd(statTally, seat, "liesTold");
  return { ...next, activeSeat: responder ? responder.seat : seat, statTally };
}

function pullTrigger(players: PlayerState[], seat: SeatIndex): { players: PlayerState[]; pull: Pull } {
  const p = players[seat];
  const hit = p.shots === p.bullet;
  const pull: Pull = { seat, chamber: p.shots, hit };
  return {
    players: players.map((pl) => (pl.seat === seat ? { ...pl, shots: pl.shots + 1, alive: !hit } : pl)),
    pull,
  };
}

function challenge(state: BluffRouletteState, seat: SeatIndex): BluffRouletteState {
  if (!canChallenge(state) || seat !== state.activeSeat) return state;
  if (!state.players[seat]?.alive) return state;
  const target = lastPlay(state)!;
  const forced = mustChallenge(state);
  const skull = isSkullSolo(target.cards);
  const truthful = skull || target.cards.every((c) => isTrueCard(c, state.tableSuit));

  // §I / §M — who pulls, in order.
  let shooters: SeatIndex[];
  if (skull) {
    shooters = [seat, ...seatsAfter(state, seat).filter((p) => p.alive && p.seat !== target.seat && p.seat !== seat).map((p) => p.seat)];
  } else {
    shooters = [truthful ? seat : target.seat];
  }

  let players = state.players;
  const pulls: Pull[] = [];
  const eliminationOrder = [...state.eliminationOrder];
  for (const s of shooters) {
    const r = pullTrigger(players, s);
    players = r.players;
    pulls.push(r.pull);
    if (r.pull.hit) eliminationOrder.push(s);
  }

  let statTally = tallyAdd(state.statTally, seat, "liarCalls");
  if (!truthful) statTally = tallyAdd(statTally, seat, "liarCorrect");
  if (!truthful) statTally = tallyAdd(statTally, target.seat, "liesCaught");
  if (skull) statTally = tallyAdd(statTally, target.seat, "skullTriggers");
  for (const pull of pulls) {
    statTally = tallyAdd(statTally, pull.seat, "triggerPulls");
    if (!pull.hit) {
      statTally = tallyAdd(statTally, pull.seat, "survivedPulls");
      statTally = tallyMax(statTally, pull.seat, "maxPullsSurvived", players[pull.seat].shots);
    }
  }

  const resolution: Resolution = {
    challengerSeat: seat,
    accusedSeat: target.seat,
    revealed: target.cards,
    tableSuit: state.tableSuit,
    truthful,
    skull,
    forced,
    pulls,
  };

  const alive = players.filter((p) => p.alive);
  if (alive.length <= 1) {
    return {
      ...state,
      players,
      phase: "gameOver",
      lastResolution: resolution,
      eliminationOrder,
      winnerSeat: alive[0]?.seat ?? null,
      statTally,
    };
  }
  return { ...state, players, phase: "reveal", lastResolution: resolution, eliminationOrder, statTally };
}

/** §K — next round's starter. */
export function nextStarter(state: BluffRouletteState): SeatIndex {
  const res = state.lastResolution!;
  if (res.skull) return state.players[res.accusedSeat].alive ? res.accusedSeat : nextAlive(state, res.accusedSeat);
  const shooter = res.pulls[0].seat;
  return state.players[shooter].alive ? shooter : nextAlive(state, shooter);
}

function continueRound(state: BluffRouletteState, seed: number): BluffRouletteState {
  if (state.phase !== "reveal") return state;
  const starter = nextStarter(state);
  const { players, tableSuit } = dealRound(state, seededRng(seed));
  return {
    ...state,
    players,
    tableSuit,
    pile: [],
    activeSeat: starter,
    roundStarter: starter,
    roundNumber: state.roundNumber + 1,
    phase: "playing",
  };
}

export function applyAction(state: BluffRouletteState, action: EngineAction): BluffRouletteState {
  switch (action.type) {
    case "play":
      return play(state, action.seat, action.cardIds);
    case "liar":
      return challenge(state, action.seat);
    case "continue":
      return continueRound(state, action.seed);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Rankings
// ---------------------------------------------------------------------------

export interface RankedSeat {
  seat: SeatIndex;
  rank: number;
}

/** §N — winner first, then reverse elimination order (simultaneous skull deaths split by pull order). */
export function computeRankings(state: BluffRouletteState): RankedSeat[] {
  const ranks: RankedSeat[] = [];
  if (state.winnerSeat !== null) ranks.push({ seat: state.winnerSeat, rank: 1 });
  for (const seat of [...state.eliminationOrder].reverse()) ranks.push({ seat, rank: ranks.length + 1 });
  return ranks;
}

// ---------------------------------------------------------------------------
// Bots (§W) — information-fair: only the bot's own hand/plays, public counts,
// the public deck composition and public shot counts. Never reads other
// hands or any bullet.
// ---------------------------------------------------------------------------

/** log C(n, k) */
function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

/** P(X = x) for X ~ Hypergeometric(population N, successes K, draws n). */
function hyperPmf(N: number, K: number, n: number, x: number): number {
  if (x < 0 || x > K || x > n || n - x > N - K) return 0;
  return Math.exp(logChoose(K, x) + logChoose(N - K, n - x) - logChoose(N, n));
}

/** P(X >= need) for X ~ Hypergeometric(population N, successes K, draws n). */
export function hyperAtLeast(N: number, K: number, n: number, need: number): number {
  if (need <= 0) return 1;
  let p = 0;
  for (let x = need; x <= Math.min(K, n); x++) p += hyperPmf(N, K, n, x);
  return Math.min(1, Math.max(0, p));
}

/** Assumed size of a forced lie (a player holding no true card): mostly 1 card. */
const LIE_SIZE_PRIOR = [0, 0.7, 0.2, 0.1];

/**
 * Probability (from `seat`'s point of view) that the last play is a lie.
 *
 * Bayesian, not "how likely were they to hold c true cards": people only
 * claim big when they actually have the cards, so a 3-card claim is not
 * suspicious by itself. Model of the accused's behaviour given t = true
 * cards in their pre-play hand: t >= 1 → a truthful play of a uniform size
 * 1..min(t, 3); t = 0 → a lie sized by `LIE_SIZE_PRIOR`. Their hand is a
 * random draw from every card `seat` hasn't seen, with earlier unchallenged
 * claims by others removed from the true pool. Claims that exceed every
 * unseen true card are certain lies.
 */
export function estimateLieChance(state: BluffRouletteState, seat: SeatIndex): number {
  const target = lastPlay(state);
  if (!target) return 0;
  const me = state.players[seat];
  const deck = buildDeck(state.playerCount, state.options);
  const isTrue = (c: Card) => isTrueCard(c, state.tableSuit);
  const totalTrue = deck.filter(isTrue).length;
  const skullUnseen = deck.some((c) => c.kind === "skull") && !me.hand.some((c) => c.kind === "skull");

  const myPlays = state.pile.filter((p) => p.seat === seat).flatMap((p) => p.cards);
  const seen = [...me.hand, ...myPlays];
  const seenTrue = seen.filter(isTrue).length;
  const otherClaims = state.pile.slice(0, -1).filter((p) => p.seat !== seat).reduce((n, p) => n + p.cards.length, 0);

  const claimed = target.cards.length;
  const unseenTrue = totalTrue - seenTrue;
  if (unseenTrue - otherClaims < claimed && !(claimed === 1 && skullUnseen)) return 1;

  const pool = Math.max(1, deck.length - seen.length - otherClaims);
  const poolTrue = Math.max(0, unseenTrue - otherClaims);
  const handBefore = Math.min(pool, state.players[target.seat].hand.length + claimed);

  const pNone = hyperPmf(pool, poolTrue, handBefore, 0);
  const lieWeight = pNone * (LIE_SIZE_PRIOR[claimed] ?? 0.05);
  let truthWeight = 0;
  for (let t = Math.max(1, claimed); t <= Math.min(poolTrue, handBefore); t++) {
    truthWeight += hyperPmf(pool, poolTrue, handBefore, t) / Math.min(t, MAX_PLAY);
  }
  if (lieWeight + truthWeight <= 0) return 1;
  return lieWeight / (lieWeight + truthWeight);
}

export function getValidMoves(state: BluffRouletteState, seat: SeatIndex): EngineAction[] {
  if (state.phase !== "playing" || seat !== state.activeSeat) return [];
  const me = state.players[seat];
  if (!me?.alive) return [];
  const moves: EngineAction[] = [];
  if (canChallenge(state)) moves.push({ type: "liar", seat });
  if (me.hand.length === 0) return moves;

  // Enumerate by composition (true/false/skull counts) instead of every id subset — same outcome, far fewer moves.
  const trues = me.hand.filter((c) => c.kind === state.tableSuit);
  const masks = me.hand.filter((c) => c.kind === "mask");
  const fakes = me.hand.filter((c) => c.kind !== state.tableSuit && c.kind !== "mask" && c.kind !== "skull");
  const skull = me.hand.find((c) => c.kind === "skull");
  const truthPool = [...trues, ...masks]; // suits before masks: save wildcards
  const seenCombos = new Set<string>();
  for (let t = 0; t <= Math.min(MAX_PLAY, truthPool.length); t++) {
    for (let f = 0; f + t <= MAX_PLAY && f <= fakes.length; f++) {
      for (let k = 0; k <= (skull ? 1 : 0) && t + f + k <= MAX_PLAY; k++) {
        if (t + f + k === 0) continue;
        const ids = [...truthPool.slice(0, t), ...fakes.slice(0, f), ...(k ? [skull!] : [])].map((c) => c.id);
        const key = `${t}:${f}:${k}`;
        if (seenCombos.has(key)) continue;
        seenCombos.add(key);
        moves.push({ type: "play", seat, cardIds: ids });
      }
    }
  }
  return moves;
}

/**
 * Bot tuning knobs (tuned by self-play — see BluffRoulette.test.ts). Units
 * are "my expected pull danger": a move scores the chance it gets ME shot
 * (negative) plus a smaller bonus for the chance it gets an OPPONENT shot.
 */
export const BOT_TUNING = {
  /** How much an opponent's pull is worth relative to my own (one of n-1 rivals dying helps less than me surviving). */
  rivalWeight: 0.35,
  /** Base chance the next player calls a play, + per extra card, + per card already claimed this round. */
  callBase: 0.22,
  callPerCard: 0.12,
  callPerClaimed: 0.025,
  /** Penalty for keeping a hand with no true card left (a forced lie/call is coming). */
  deadHand: 0.35,
  /** Experts keep 🎭 masks for a rainy day. */
  maskKeep: 0.02,
};

function scoreMove(state: BluffRouletteState, seat: SeatIndex, move: EngineAction, level: BotLevel): number {
  const T = BOT_TUNING;
  const expert = botTier(level) === "expert";
  const me = state.players[seat];
  const myDanger = pullDanger(me.shots);

  if (move.type === "liar") {
    const target = lastPlay(state)!;
    const pLie = estimateLieChance(state, seat);
    const theirDanger = pullDanger(state.players[target.seat].shots);
    // A lone card in skull mode might be the skull: then I (and everyone but them) pull.
    const skullUnseen = state.options.skullMode && target.cards.length === 1 && !me.hand.some((c) => c.kind === "skull");
    const pSkull = skullUnseen ? 0.08 : 0;
    return pLie * theirDanger * T.rivalWeight - (1 - pLie - pSkull) * myDanger - pSkull * myDanger;
  }
  if (move.type !== "play") return 0;

  const cards = move.cardIds.map((id) => me.hand.find((c) => c.id === id)!);
  const isT = (c: Card) => isTrueCard(c, state.tableSuit);
  const hasSkull = cards.some((c) => c.kind === "skull");
  const skullSolo = hasSkull && cards.length === 1;
  const isLie = !skullSolo && cards.some((c) => !isT(c));
  const rest = me.hand.filter((c) => !move.cardIds.includes(c.id));
  const restHasTrue = rest.some((c) => isT(c) || (c.kind === "skull" && rest.length === 1));

  const claimedSoFar = state.pile.reduce((n, p) => n + p.cards.length, 0);
  const pCalled = Math.min(0.9, T.callBase + T.callPerCard * (cards.length - 1) + T.callPerClaimed * claimedSoFar);
  const after = seatsAfter(state, seat).filter((p) => p.alive);
  const next = after.find((p) => p.hand.length > 0) ?? after[0];
  const nextDanger = next ? pullDanger(next.shots) : 0;
  const deadHand = rest.length > 0 && !restHasTrue ? T.deadHand * myDanger : 0;

  if (skullSolo) {
    const othersDanger = after.reduce((n, p) => n + pullDanger(p.shots), 0);
    return pCalled * othersDanger * T.rivalWeight - deadHand;
  }
  if (isLie) {
    const wastedTrue = cards.filter(isT).length;
    return -pCalled * myDanger - deadHand - wastedTrue * 0.05 * myDanger;
  }
  const masksUsed = cards.filter((c) => c.kind === "mask").length;
  return pCalled * nextDanger * T.rivalWeight - deadHand - (expert ? masksUsed * T.maskKeep : 0);
}

export function chooseBotAction(
  state: BluffRouletteState,
  seat: SeatIndex,
  level: BotLevel = 5,
  rng: () => number = Math.random,
): EngineAction | null {
  const moves = getValidMoves(state, seat);
  if (moves.length === 0) return null;
  const scored = moves.map((move) => ({ move, score: scoreMove(state, seat, move, level) }));
  return pickByLevel(scored, level, rng);
}
