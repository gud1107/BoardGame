/**
 * Pure "오이 다섯 개" (Five Cucumbers / 5 Cucumbers, Friedemann Friese) rules
 * engine — no React, no I/O. Implements boardGameRule/오이다섯개.md: a
 * trick-taking game where the goal is the *opposite* of most trick games —
 * avoid winning the 7th (last) trick of each round, since that trick's
 * winner(s) eat cucumber penalty tokens. Accumulate too many cucumbers and
 * you're eliminated; the last player standing across as many rounds as it
 * takes wins.
 *
 * §1 note on the 60-card deck: the rulebook's §1 "구성물" section states the
 * deck is "1부터 15까지" numbered 1-15, four copies each (4×15 = 60 cards) —
 * not a literal 1-60 run. The task brief that requested this game described
 * "1부터 60까지의 숫자 카드", but per this project's standing rule (see
 * HANDOFF.md "작업 규칙": when a task brief and a referenced rulebook
 * disagree, the rulebook wins and the call gets documented here), this
 * engine follows the rulebook's actual 1-15×4 deck and its explicit
 * cucumber-count tiers (§3) rather than inventing a 60-value curve.
 *
 * Same online-multiplayer trust model as every other game in this project:
 * every connected client computes and holds the FULL state (every seat's
 * hand) from a shared RNG seed plus replayed `EngineAction`s — there is no
 * server authority (see docs/architecture.md §2). Hands are not meant to be
 * secret from the *engine* (every client must know everyone's hand to
 * validate "is this the lowest card in their hand" for legality), only from
 * other *players* — enforced at the UI layer only, same technique
 * bang/avalon/splendor already use to hide information despite every client
 * holding the full state (see `FiveCucumbersBoard.tsx`).
 */

export type SeatIndex = number;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const CARD_MIN = 1;
export const CARD_MAX = 15;
export const COPIES_PER_VALUE = 4;
export const HAND_SIZE = 7;
export const TRICKS_PER_ROUND = 7;
export const FINAL_TRICK_NUMBER = TRICKS_PER_ROUND;

/**
 * Host-chosen house rule (task brief §1 "탈락 기준 선택 토글"): the rulebook
 * itself (§4) documents both a 6-cucumber default and a 5-cucumber "하우스룰"
 * variant, so both values are equally rulebook-sanctioned — only the choice
 * of *default* came from the task brief, which does not conflict with the
 * rulebook's rules themselves. Chosen once by the host before the room fills
 * up, applies identically to every seat (same pattern as no-thanks's
 * `ChipVisibility`).
 */
export type EliminationThreshold = 5 | 6;
export const DEFAULT_ELIMINATION_THRESHOLD: EliminationThreshold = 5;

export interface Card {
  /** `${value}-${copyIndex}`, unique across the 60-card deck. */
  id: string;
  value: number;
}

export interface PlayedCard {
  seat: SeatIndex;
  card: Card;
}

export interface PlayerState {
  seat: SeatIndex;
  /** Empty once eliminated, or before their first round's deal. */
  hand: Card[];
  cucumbers: number;
  eliminated: boolean;
  /** Round number (1-based) this seat crossed the elimination threshold, or null while still in. Drives final ranking (later = better). */
  eliminatedAtRound: number | null;
}

export type Phase = "playing" | "gameOver";

export interface TrickResult {
  roundNumber: number;
  trickNumber: number;
  plays: PlayedCard[];
  /** Always exactly 1 seat — later play wins ties, rulebook §2-4, applied uniformly to every trick including the 7th (§3 penalizes only that sole winner, never every tied top card). Kept as an array for shape-compatibility with `RoundSummary.winnerSeats` / existing UI code. */
  winnerSeats: SeatIndex[];
  /** Cucumbers each winner seat gained — 0 for tricks 1-6 (no penalty until the round's last trick). */
  cucumberPenaltyEach: number;
}

export interface RoundSummary {
  roundNumber: number;
  winnerSeats: SeatIndex[];
  cucumberPenaltyEach: number;
  /** How many '1' cards appeared in the final trick — drives the ×2 per '1' multiplier (rulebook §3-2). */
  onesCount: number;
  /** Seats that crossed the elimination threshold as a result of this round's penalty. */
  newlyEliminatedSeats: SeatIndex[];
}

export interface FiveCucumbersState {
  playerCount: number;
  eliminationThreshold: EliminationThreshold;
  players: PlayerState[];
  roundNumber: number;
  trickNumber: number;
  /** Cards played so far in the current trick, in play order. */
  trickPlays: PlayedCard[];
  leadSeat: SeatIndex;
  activeSeat: SeatIndex;
  phase: Phase;
  /** Most recently resolved trick — UI-only flash/highlight, not itself consumed by the engine. */
  lastTrickResult: TrickResult | null;
  /** Set whenever a round's 7th trick resolves (win or loss) — UI-only summary banner. */
  lastRoundSummary: RoundSummary | null;
  /** Seed the very first deal used; later rounds derive a fresh deterministic seed from this + roundNumber so every client reshuffles identically without needing a new network broadcast. */
  initialSeed: number;
  /**
   * Every card played so far this round, across all resolved tricks (reset
   * on each `dealRound`). Only consumer today is the Level 8-10 PIMC bot
   * (see "AI bot support" below): to determinize opponents' unseen hands
   * fairly it needs the exact set of cards no longer in anyone's hand, and
   * `lastTrickResult` alone only remembers the *most recent* trick, not the
   * whole round.
   */
  roundPlayedCards: Card[];
}

export type EngineAction = { type: "playCard"; seat: SeatIndex; cardId: string };

/** Deterministic PRNG + shuffle, shared across every engine — see src/lib/rng.ts. */
import { seededRng, shuffle } from "@/lib/rng";
export { seededRng };
import { botTier, pickByLevel, type BotLevel, type BotTier, type ScoredCandidate } from "@/games/shared/bot/botDifficulty";

/** The full 60-card deck: values 1-15, 4 copies each (rulebook §1). */
export function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (let value = CARD_MIN; value <= CARD_MAX; value++) {
    for (let copy = 0; copy < COPIES_PER_VALUE; copy++) {
      deck.push({ id: `${value}-${copy}`, value });
    }
  }
  return deck;
}

/**
 * Rulebook §3-1 cucumber-count tiers, by the winning card's face value (see
 * boardGameRule/오이다섯개/오이다섯개.md's "카드 구성 및 오이 개수 상세표"). Only
 * card 1 sits alone at tier 0 — it's the "2배 폭탄" special, not a cucumber
 * count in its own right (handled separately by the ×2-per-'1' multiplier in
 * `playCard`). This replaced an earlier tier curve that grouped 1-5 together
 * at tier 0; the folder's table splits 1 out on its own and moves 2-5 up to
 * tier 1, so every boundary below shifted by one value.
 */
export function cucumberCount(value: number): number {
  if (value === 1) return 0;
  if (value <= 5) return 1;
  if (value <= 9) return 2;
  if (value <= 11) return 3;
  if (value <= 14) return 4;
  return 5; // 15
}

function findPlayer(state: FiveCucumbersState, seat: SeatIndex): PlayerState | undefined {
  return state.players.find((p) => p.seat === seat);
}

function activeSeats(players: PlayerState[]): SeatIndex[] {
  return players.filter((p) => !p.eliminated).map((p) => p.seat);
}

/** Next seat in clockwise order, skipping eliminated seats. Only valid while >= 2 seats remain active. */
function nextActiveSeat(players: PlayerState[], from: SeatIndex): SeatIndex {
  const count = players.length;
  let s = (from + 1) % count;
  let guard = 0;
  while (players[s].eliminated && guard < count) {
    s = (s + 1) % count;
    guard++;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Setup / round dealing
// ---------------------------------------------------------------------------

/**
 * Deals a fresh round to every still-active seat: a 60-card shuffle, 7 cards
 * each. `preferredLeadSeats` is the previous round's 7th-trick winner(s) —
 * the rulebook's "가장 최근에 오이를 먹은 사람" leads next (§1-3); ties are
 * broken by lowest seat number. Round 1 has no such precedent, so its leader
 * is picked from the shared seed instead (same convention as no-thanks's
 * `activeSeat` pick at `startGame`).
 */
function dealRound(state: FiveCucumbersState, preferredLeadSeats: SeatIndex[]): FiveCucumbersState {
  const roundNumber = state.roundNumber + 1;
  // Distinct offset per round so consecutive rounds don't reuse the same
  // shuffle, while staying purely a function of shared state (no extra
  // network round-trip needed to keep every client's RNG in lockstep).
  const rng = seededRng(state.initialSeed + roundNumber * 104729);
  const seats = activeSeats(state.players);
  const deck = shuffle(buildDeck(), rng);

  const hands = new Map<SeatIndex, Card[]>();
  seats.forEach((seat, i) => hands.set(seat, deck.slice(i * HAND_SIZE, (i + 1) * HAND_SIZE)));

  const players = state.players.map((p) => (p.eliminated ? { ...p, hand: [] } : { ...p, hand: hands.get(p.seat) ?? [] }));

  const validPreferred = preferredLeadSeats.filter((s) => seats.includes(s));
  const leadSeat = validPreferred.length > 0 ? Math.min(...validPreferred) : seats[Math.floor(rng() * seats.length)];

  return {
    ...state,
    players,
    roundNumber,
    trickNumber: 1,
    trickPlays: [],
    leadSeat,
    activeSeat: leadSeat,
    phase: "playing",
    roundPlayedCards: [],
  };
}

export function startGame(
  playerCount: number,
  seed: number,
  eliminationThreshold: EliminationThreshold = DEFAULT_ELIMINATION_THRESHOLD,
): FiveCucumbersState {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`Unsupported player count: ${playerCount}`);
  }
  const players: PlayerState[] = Array.from({ length: playerCount }, (_, seat) => ({
    seat,
    hand: [],
    cucumbers: 0,
    eliminated: false,
    eliminatedAtRound: null,
  }));
  const base: FiveCucumbersState = {
    playerCount,
    eliminationThreshold,
    players,
    roundNumber: 0,
    trickNumber: 1,
    trickPlays: [],
    leadSeat: 0,
    activeSeat: 0,
    phase: "playing",
    lastTrickResult: null,
    lastRoundSummary: null,
    initialSeed: seed,
    roundPlayedCards: [],
  };
  return dealRound(base, []);
}

// ---------------------------------------------------------------------------
// Legal-play predicate — pure derived value, drives both validation and the
// UI's "which cards can I click" highlight (task brief §2).
// ---------------------------------------------------------------------------

/**
 * Rulebook §2-3: on your turn you must play either (a) a card whose value is
 * >= the current trick's highest value so far, or (b) whichever card(s) tie
 * for the lowest value in your hand — option (b) is always legal, even if
 * you *could* play higher (e.g. deliberately shedding a low card early). The
 * trick's leader (no cards played yet) may play anything.
 */
export function legalCardIds(state: FiveCucumbersState, seat: SeatIndex): Set<string> {
  const result = new Set<string>();
  if (state.phase !== "playing" || state.activeSeat !== seat) return result;
  const player = findPlayer(state, seat);
  if (!player || player.eliminated || player.hand.length === 0) return result;

  if (state.trickPlays.length === 0) {
    for (const c of player.hand) result.add(c.id);
    return result;
  }

  const currentMax = Math.max(...state.trickPlays.map((p) => p.card.value));
  const minInHand = Math.min(...player.hand.map((c) => c.value));
  for (const c of player.hand) {
    if (c.value >= currentMax || c.value === minInHand) result.add(c.id);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Trick resolution
// ---------------------------------------------------------------------------

/** Rulebook §2-4: highest value wins; on a tie, whoever played it *later* wins (leads the next trick). */
function resolveLeadingTrickWinner(plays: PlayedCard[]): SeatIndex {
  let winner = plays[0];
  for (const p of plays) {
    // ">=" (not ">") means a later tie overwrites the running winner, which
    // is exactly "later play wins ties" — a strictly lower value never wins.
    if (p.card.value >= winner.card.value) winner = p;
  }
  return winner.seat;
}

function playCard(state: FiveCucumbersState, seat: SeatIndex, cardId: string): FiveCucumbersState {
  if (state.phase !== "playing" || seat !== state.activeSeat) return state;
  if (!legalCardIds(state, seat).has(cardId)) return state;

  const player = findPlayer(state, seat)!;
  const card = player.hand.find((c) => c.id === cardId)!;
  const hand = player.hand.filter((c) => c.id !== cardId);
  let players = state.players.map((p) => (p.seat === seat ? { ...p, hand } : p));
  const trickPlays = [...state.trickPlays, { seat, card }];
  const activeCount = activeSeats(players).length;
  // Tracked from the moment a card leaves a hand (not only once the trick
  // resolves) so a bot deciding mid-trick already sees its own just-played
  // card excluded from "unseen" — see `roundPlayedCards`'s doc.
  const roundPlayedCards = [...state.roundPlayedCards, card];

  if (trickPlays.length < activeCount) {
    return { ...state, players, trickPlays, activeSeat: nextActiveSeat(players, seat), roundPlayedCards };
  }

  // Trick complete.
  if (state.trickNumber < FINAL_TRICK_NUMBER) {
    const winnerSeat = resolveLeadingTrickWinner(trickPlays);
    const lastTrickResult: TrickResult = {
      roundNumber: state.roundNumber,
      trickNumber: state.trickNumber,
      plays: trickPlays,
      winnerSeats: [winnerSeat],
      cucumberPenaltyEach: 0,
    };
    return {
      ...state,
      players,
      trickPlays: [],
      trickNumber: state.trickNumber + 1,
      leadSeat: winnerSeat,
      activeSeat: winnerSeat,
      lastTrickResult,
      roundPlayedCards,
    };
  }

  // 7th (final) trick — rulebook §2-4/§3: trick-winner determination is the
  // SAME rule as every other trick, including its tie-break ("나중에 해당
  // 숫자를 낸 플레이어가 트릭을 따냅니다" — whoever played the tied top card
  // LATER wins outright); §3 then penalizes only "트릭을 따낸 플레이어"
  // (singular, the trick's winner), not every seat that happened to tie the
  // top value. So a tie for highest on trick 7 gives the cucumbers to the
  // later player alone, exactly like tricks 1-6 give them sole lead of the
  // next trick — this replaced an earlier reading where every tied seat ate
  // the penalty.
  const winnerSeat = resolveLeadingTrickWinner(trickPlays);
  const winnerSeats = [winnerSeat];
  const maxValue = trickPlays.find((p) => p.seat === winnerSeat)!.card.value;
  const onesCount = trickPlays.filter((p) => p.card.value === 1).length;
  const multiplier = 2 ** onesCount;
  const penaltyEach = cucumberCount(maxValue) * multiplier;

  const newlyEliminatedSeats: SeatIndex[] = [];
  players = players.map((p) => {
    if (!winnerSeats.includes(p.seat)) return p;
    const cucumbers = p.cucumbers + penaltyEach;
    const nowEliminated = cucumbers >= state.eliminationThreshold;
    if (nowEliminated && !p.eliminated) newlyEliminatedSeats.push(p.seat);
    return {
      ...p,
      cucumbers,
      eliminated: p.eliminated || nowEliminated,
      eliminatedAtRound: nowEliminated && !p.eliminated ? state.roundNumber : p.eliminatedAtRound,
    };
  });

  const lastTrickResult: TrickResult = {
    roundNumber: state.roundNumber,
    trickNumber: state.trickNumber,
    plays: trickPlays,
    winnerSeats,
    cucumberPenaltyEach: penaltyEach,
  };
  const lastRoundSummary: RoundSummary = {
    roundNumber: state.roundNumber,
    winnerSeats,
    cucumberPenaltyEach: penaltyEach,
    onesCount,
    newlyEliminatedSeats,
  };

  const settled: FiveCucumbersState = { ...state, players, trickPlays: [], lastTrickResult, lastRoundSummary, roundPlayedCards };
  const remaining = activeSeats(players);
  if (remaining.length <= 1) {
    return { ...settled, phase: "gameOver" };
  }
  return dealRound(settled, winnerSeats);
}

/** Single entry point applying any `EngineAction` to a state — the whole engine as one reducer. */
export function applyAction(state: FiveCucumbersState, action: EngineAction): FiveCucumbersState {
  switch (action.type) {
    case "playCard":
      return playCard(state, action.seat, action.cardId);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Final scoring
// ---------------------------------------------------------------------------

export interface RankedPlayer {
  seat: SeatIndex;
  rank: number;
  cucumbers: number;
  eliminatedAtRound: number | null;
}

/**
 * Only meaningful once `state.phase === "gameOver"`. Ranked by survival: the
 * player never eliminated (`eliminatedAtRound === null`, the last one
 * standing) ranks 1st; among eliminated players, whoever lasted more rounds
 * ranks better. Standard competition ranking (1,1,3 — not 1,1,2), since two
 * seats can be eliminated in the very same round (including, in the rare
 * case where the last 2 players both cross the threshold on the same final
 * trick, a genuine co-finish with no outright winner at all — this ranking
 * scheme handles that automatically as a tie for 1st, without special-casing
 * it).
 */
export function computeRankings(state: FiveCucumbersState): RankedPlayer[] {
  const key = (p: PlayerState) => (p.eliminatedAtRound === null ? Number.POSITIVE_INFINITY : p.eliminatedAtRound);
  const scored = state.players.map((p) => ({ seat: p.seat, cucumbers: p.cucumbers, eliminatedAtRound: p.eliminatedAtRound, key: key(p) }));
  const sorted = [...scored].sort((a, b) => b.key - a.key);
  const ranked: RankedPlayer[] = [];
  let rank = 1;
  sorted.forEach((entry, i) => {
    if (i > 0 && sorted[i - 1].key !== entry.key) rank = i + 1;
    ranked.push({ seat: entry.seat, rank, cucumbers: entry.cucumbers, eliminatedAtRound: entry.eliminatedAtRound });
  });
  return ranked;
}

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7) — getValidMoves / scoreMove /
// chooseBotAction(state, seat, level, rng?). Information fairness: every
// value used below (own hand, `trickPlays` so far this trick, round/trick
// numbers) is either the bot's own private hand or already-public info
// visible to every seat at the table — no other seat's hidden hand is ever
// read.
// ---------------------------------------------------------------------------

export function getValidMoves(state: FiveCucumbersState, seat: SeatIndex): EngineAction[] {
  return Array.from(legalCardIds(state, seat)).map((cardId) => ({ type: "playCard", seat, cardId }));
}

function countAtValue(values: number[], value: number): number {
  return values.filter((v) => v === value).length;
}

/**
 * Higher = more desirable for the bot to play. Tiers per ARCHITECTURE.md
 * §7.5: novice ignores the score curve almost entirely (near-uniform),
 * core applies a simple "shed low cards" rule, expert follows the task
 * brief's Lv.10 spec — minimize winning tricks 1-6, reserve the hand's
 * lowest card for the 7th (final) trick so it's never forced to eat
 * cucumbers, and exploit the "later tie wins" rule to pass a dangerous tie
 * forward instead of exceeding it.
 */
export function scoreMove(state: FiveCucumbersState, seat: SeatIndex, move: EngineAction, tier: BotTier): number {
  if (move.type !== "playCard") return 0;
  if (tier === "novice") return 0; // every legal card equally likely — pickByLevel's own noise does the rest.

  const player = findPlayer(state, seat)!;
  const card = player.hand.find((c) => c.id === move.cardId)!;
  const value = card.value;
  const handValues = player.hand.map((c) => c.value);
  const handMin = Math.min(...handValues);
  const activeCount = activeSeats(state.players).length;
  const isLastToAct = state.trickPlays.length === activeCount - 1;
  const isFinalTrick = state.trickNumber === FINAL_TRICK_NUMBER;
  const currentMax = state.trickPlays.length > 0 ? Math.max(...state.trickPlays.map((p) => p.card.value)) : null;
  const projectedWinner = isLastToAct ? resolveLeadingTrickWinner([...state.trickPlays, { seat, card }]) : null;
  const wouldWinNow = projectedWinner === seat;

  if (tier === "core") {
    let score = -value; // dump low cards first — simple, not necessarily optimal.
    if (isFinalTrick && isLastToAct && wouldWinNow) score -= 50;
    return score;
  }

  // expert (Lv.8-10)
  if (isFinalTrick) {
    if (isLastToAct) {
      if (wouldWinNow) {
        const onesSoFar = countAtValue(state.trickPlays.map((p) => p.card.value), 1) + (value === 1 ? 1 : 0);
        const penalty = cucumberCount(value) * 2 ** onesSoFar;
        return -1000 - penalty * 10; // forced to eat cucumbers — rank by how bad.
      }
      return 500; // safely ducks the final trick.
    }
    if (state.trickPlays.length === 0) return -value * 5; // lead the final trick as low as possible.
    if (value < currentMax!) return 300 - value; // safe duck below the current max.
    if (value === currentMax) return 100; // tie passes the "later tie wins" risk forward to the next player.
    return 50 - value; // forced to exceed — prefer the smallest possible exceedance.
  }

  // Tricks 1-6: winning isn't directly penalized, but reserve the hand's
  // unique lowest card for the approaching final trick, and mildly prefer
  // not winning (keeps future lead choices flexible).
  const ticksUntilFinal = FINAL_TRICK_NUMBER - state.trickNumber;
  const reserveBonus = value === handMin && countAtValue(handValues, handMin) === 1 ? -80 / Math.max(1, ticksUntilFinal) : 0;
  let score: number;
  if (isLastToAct) {
    score = wouldWinNow ? -20 : 40;
  } else if (state.trickPlays.length === 0) {
    score = -value;
  } else if (value < currentMax!) {
    score = 30 - value;
  } else if (value === currentMax) {
    score = 10;
  } else {
    score = -value;
  }
  return score + reserveBonus;
}

// ---------------------------------------------------------------------------
// Level 8-10 "expert" bot: Perfect Information Monte Carlo (PIMC).
//
// A genuinely exhaustive minimax here is infeasible with 4-6 players and up
// to 6 remaining tricks — the game tree's branching factor compounds across
// every seat's turn within every trick, unlike a 2-player game. Real PIMC
// bots for trick-taking games (Bridge/Skat solvers included) handle exactly
// this by determinizing the hidden hands into N concrete "worlds", then
// playing each one out with a FAST heuristic rollout policy rather than
// exhaustively searching it — that's what `simulateRoundOutcome` below does,
// using the existing "core"-tier `scoreMove` as that rollout policy for
// every seat (including this bot's own future turns). The move whose
// average outcome (fewest cucumbers eaten by the 7th trick, across all
// sampled worlds) wins is what gets played.
// ---------------------------------------------------------------------------

import { evaluateMovesByDeterminization } from "@/games/shared/bot/montecarlo";

export const DEFAULT_PIMC_TRIALS = 150; // within the 100-200 determinizations the task spec calls for.
const PIMC_ROLLOUT_MOVE_GUARD = 200; // defensive cap — a round can't structurally take this many single-card plays before resolving.

/**
 * Cards no seat but `seat` could already be holding: everyone's cards are
 * drawn from the same 60-card deck, and `roundPlayedCards`/`trickPlays`
 * cover every card that's left a hand so far this round (see
 * `roundPlayedCards`'s doc on `FiveCucumbersState`) — the complement of
 * (own hand ∪ already-played) is exactly the pool every opponent's hidden
 * hand was dealt from.
 */
function unseenCardsFor(state: FiveCucumbersState, seat: SeatIndex): Card[] {
  const me = findPlayer(state, seat)!;
  const known = new Set<string>([
    ...me.hand.map((c) => c.id),
    ...state.roundPlayedCards.map((c) => c.id),
    ...state.trickPlays.map((p) => p.card.id),
  ]);
  return buildDeck().filter((c) => !known.has(c.id));
}

/**
 * One determinized "world": every other active seat's hand is a random deal
 * from the unseen pool, sized to that seat's real (publicly known) hand
 * length — `seat`'s own hand is left exactly as-is, never guessed. Fairness
 * note matches the module doc: this only ever reads hand *sizes* for other
 * seats (public info), never their actual `hand` contents.
 */
function determinizeHands(state: FiveCucumbersState, seat: SeatIndex, rng: () => number): FiveCucumbersState {
  const pool = shuffle(unseenCardsFor(state, seat), rng);
  let idx = 0;
  const players = state.players.map((p) => {
    if (p.seat === seat || p.eliminated) return p;
    const size = p.hand.length;
    const hand = pool.slice(idx, idx + size);
    idx += size;
    return { ...p, hand };
  });
  return { ...state, players };
}

/** Fast deterministic policy (argmax of the existing "expert" heuristic — the sophisticated final-trick-avoidance scoring, not a recursive PIMC call) used to roll every seat's *subsequent* turns forward inside a PIMC trial — a full recursive PIMC-inside-PIMC would defeat the point of sampling many worlds cheaply, and a weaker rollout policy (e.g. "core") would make every trial systematically underrate how well a good final-trick strategy actually plays out. */
function fastRolloutMove(state: FiveCucumbersState, seat: SeatIndex): EngineAction | null {
  const moves = getValidMoves(state, seat);
  if (moves.length === 0) return null;
  let best = moves[0];
  let bestScore = -Infinity;
  for (const move of moves) {
    const score = scoreMove(state, seat, move, "expert");
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}

/**
 * Plays `firstMove` in `world`, then rolls every subsequent seat's turn
 * forward with `fastRolloutMove` until this round's 7th trick resolves
 * (`dealRound`/`gameOver` both change `roundNumber`/`phase` out from under
 * the loop condition, so it stops exactly there — see call sites). Returns
 * how many FEWER cucumbers `seat` ate than the worst case, i.e. higher is
 * better, matching every other `scoreMove`'s "higher = more desirable"
 * convention in this file.
 */
function simulateRoundOutcome(world: FiveCucumbersState, seat: SeatIndex, firstMove: EngineAction): number {
  let s = applyAction(world, firstMove);
  const before = findPlayer(world, seat)!.cucumbers;
  const targetRound = world.roundNumber;
  let guard = 0;
  while (s.phase === "playing" && s.roundNumber === targetRound && guard < PIMC_ROLLOUT_MOVE_GUARD) {
    const move = fastRolloutMove(s, s.activeSeat);
    if (!move) break;
    s = applyAction(s, move);
    guard++;
  }
  const after = findPlayer(s, seat)?.cucumbers ?? before;
  return -(after - before);
}

function pimcScoreMoves(
  state: FiveCucumbersState,
  seat: SeatIndex,
  moves: EngineAction[],
  rng: () => number,
  trials: number,
): ScoredCandidate<EngineAction>[] {
  const evaluated = evaluateMovesByDeterminization(moves, {
    determinize: (r) => determinizeHands(state, seat, r),
    evaluateInWorld: (world, move) => simulateRoundOutcome(world, seat, move),
    trials,
    rng,
  });
  return evaluated.map((e) => ({ move: e.move, score: e.averageValue }));
}

export function chooseBotAction(
  state: FiveCucumbersState,
  seat: SeatIndex,
  level: BotLevel,
  rng: () => number = Math.random,
  opts?: { pimcTrials?: number },
): EngineAction | null {
  const moves = getValidMoves(state, seat);
  if (moves.length === 0) return null;
  const tier = botTier(level);

  if (tier === "expert") {
    const candidates = pimcScoreMoves(state, seat, moves, rng, opts?.pimcTrials ?? DEFAULT_PIMC_TRIALS);
    return pickByLevel(candidates, level, rng);
  }

  const candidates: ScoredCandidate<EngineAction>[] = moves.map((move) => ({ move, score: scoreMove(state, seat, move, tier) }));
  return pickByLevel(candidates, level, rng);
}
