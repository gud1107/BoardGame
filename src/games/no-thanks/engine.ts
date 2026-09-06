/**
 * Pure "No Thanks!" (마이너스 경매) rules engine — no React, no I/O. Implements
 * the standard 3-7 player ruleset: a 33-card deck (3-35) with 9 cards
 * randomly and permanently removed at setup (24 remain), a single shared
 * "auction" card that each player in turn either passes on (paying 1 chip
 * onto it) or takes (claiming the card plus every chip stacked on it, then
 * immediately flipping the next card and taking another turn), and the
 * "lowest-numbered card of a consecutive run only counts once" scoring rule.
 *
 * Same online-multiplayer trust model as Hanamikoji/Bang/Grid Poker/Avalon:
 * every connected client computes and holds the FULL state (every seat's
 * private chip count) from a shared RNG seed plus replayed `EngineAction`s —
 * there is no server authority. Per the rulebook's §2 game-mode option
 * (`ChipVisibility`), the view layer renders the viewer's own chip count as a
 * number always, and every other seat's either as a number ("public" mode,
 * the rulebook's custom option) or as "?" ("secret" mode, the official
 * rule) — chips are the only thing that can ever be secret in this game,
 * acquired cards are always public per the rulebook. See README for the
 * accepted trust trade-off.
 */

export type SeatIndex = number;

export const CARD_MIN = 3;
export const CARD_MAX = 35;
export const REMOVE_COUNT = 9;
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 7;

export interface PlayerState {
  seat: SeatIndex;
  chips: number;
  /** Sorted ascending — engine keeps this invariant so consumers never have to re-sort. */
  cards: number[];
}

export type Phase = "playing" | "gameOver";

/**
 * Host-chosen game mode from the rulebook's §2 "게임 모드 설정":
 * - "secret" (비밀 모드, the official rule): only the owner ever sees their
 *   own chip count; everyone else's is hidden in the view layer.
 * - "public" (공개 모드, the rulebook's custom option): every seat's chip
 *   count is shown to every player. Chosen once by the host before the game
 *   starts and applies identically to all seats — this is a real shared game
 *   rule, distinct from the board's separate local-only "practice reveal"
 *   toggle which only ever affects the viewer's own screen.
 */
export type ChipVisibility = "secret" | "public";

export interface NoThanksState {
  playerCount: number;
  players: PlayerState[];
  /** Face-down draw pile, excludes `currentCard`. */
  deck: number[];
  /** The single card currently up for auction, or null once the deck is exhausted post-game. */
  currentCard: number | null;
  chipsOnCard: number;
  activeSeat: SeatIndex;
  phase: Phase;
  /** The 9 cards excluded at setup — never dealt, kept only for tests/debugging. */
  removedCards: number[];
  /** Chosen once at `startGame` by the host, see `ChipVisibility`. */
  chipVisibility: ChipVisibility;
}

export type EngineAction = { type: "pass"; seat: SeatIndex } | { type: "take"; seat: SeatIndex };

/** Deterministic PRNG + shuffle, shared across every engine — see src/lib/rng.ts. */
import { seededRng, shuffle } from "@/lib/rng";
export { seededRng };

/** Starting chip count per the rulebook's player-count table (3-5p: 11, 6p: 9, 7p: 7). */
export function startingChips(playerCount: number): number {
  if (playerCount <= 5) return 11;
  if (playerCount === 6) return 9;
  return 7;
}

function nextSeat(seat: SeatIndex, playerCount: number): SeatIndex {
  return (seat + 1) % playerCount;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function startGame(playerCount: number, seed: number, chipVisibility: ChipVisibility = "secret"): NoThanksState {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`Unsupported player count: ${playerCount}`);
  }
  const rng = seededRng(seed);
  const allCards = Array.from({ length: CARD_MAX - CARD_MIN + 1 }, (_, i) => i + CARD_MIN);
  const shuffled = shuffle(allCards, rng);
  const removedCards = shuffled.slice(0, REMOVE_COUNT);
  const remaining = shuffled.slice(REMOVE_COUNT); // 24 cards, already in random order

  const chips = startingChips(playerCount);
  const players: PlayerState[] = Array.from({ length: playerCount }, (_, seat) => ({ seat, chips, cards: [] }));

  const currentCard = remaining[0];
  const deck = remaining.slice(1);
  // The rulebook's "most recent person to say No" tiebreak has no meaning at
  // a fresh table, so — same convention as Avalon's leader marker — the
  // starting player is picked from the shared seed for determinism.
  const activeSeat = Math.floor(rng() * playerCount);

  return {
    playerCount,
    players,
    deck,
    currentCard,
    chipsOnCard: 0,
    activeSeat,
    phase: "playing",
    removedCards,
    chipVisibility,
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function pass(state: NoThanksState, seat: SeatIndex): NoThanksState {
  if (state.phase !== "playing") return state;
  if (seat !== state.activeSeat) return state;
  const player = state.players[seat];
  if (!player || player.chips <= 0) return state; // no chips left -> must take, see rulebook §4

  const players = state.players.map((p) => (p.seat === seat ? { ...p, chips: p.chips - 1 } : p));
  return {
    ...state,
    players,
    chipsOnCard: state.chipsOnCard + 1,
    activeSeat: nextSeat(seat, state.playerCount),
  };
}

function take(state: NoThanksState, seat: SeatIndex): NoThanksState {
  if (state.phase !== "playing") return state;
  if (seat !== state.activeSeat) return state;
  if (state.currentCard === null) return state;

  const takenCard = state.currentCard;
  const wonChips = state.chipsOnCard;
  const players = state.players.map((p) =>
    p.seat === seat ? { ...p, chips: p.chips + wonChips, cards: [...p.cards, takenCard].sort((a, b) => a - b) } : p,
  );

  if (state.deck.length === 0) {
    // Last card claimed — game ends immediately per the rulebook.
    return { ...state, players, chipsOnCard: 0, currentCard: null, phase: "gameOver" };
  }

  // Taking a card immediately reveals the next one and starts a brand-new
  // turn for the *same* player (rulebook §4-B) — `activeSeat` stays put.
  const [nextCard, ...restDeck] = state.deck;
  return { ...state, players, chipsOnCard: 0, currentCard: nextCard, deck: restDeck };
}

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7 — every game exposes getValidMoves +
// chooseBotAction so a host client can drive a bot-occupied seat). Levels
// 1–10 route through the shared `pickByLevel` noise curve (botDifficulty.ts)
// on top of `scoreMove` below.
// ---------------------------------------------------------------------------

import { botTier, pickByLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";

/** Every legal `EngineAction` `seat` may submit right now. Mirrors `pass`/`take`'s own guards exactly. */
export function getValidMoves(state: NoThanksState, seat: SeatIndex): EngineAction[] {
  if (state.phase !== "playing" || seat !== state.activeSeat) return [];
  const player = state.players.find((p) => p.seat === seat);
  if (!player) return [];
  const moves: EngineAction[] = [{ type: "take", seat }];
  if (player.chips > 0) moves.push({ type: "pass", seat }); // no chips left -> must take, rulebook §4
  return moves;
}

/**
 * Simple expected-value heuristic for Lv.1–7 (`botTier(level) !== "expert"`):
 * taking is worth (chips currently on the card) minus the card's penalty —
 * except a card that extends a run already in hand (adjacent to a card the
 * seat already owns) costs nothing extra, so it's always worth taking.
 * Passing is scored as a flat -1 (the chip it costs), directly comparable
 * since both scores are on the same "net chip value" scale. This is a
 * one-turn-only view on purpose — Lv.1–7 are meant to play a bit myopically.
 */
function scoreMoveCore(state: NoThanksState, seat: SeatIndex, move: EngineAction): number {
  if (move.type === "pass") return -1;
  const player = state.players.find((p) => p.seat === seat)!;
  const card = state.currentCard!;
  const connectsRun = player.cards.includes(card - 1) || player.cards.includes(card + 1);
  const penalty = connectsRun ? 0 : card;
  return state.chipsOnCard - penalty;
}

/**
 * Exact real-score delta of `seat` taking `card` right now with `chipsOnCard`
 * chips on it — simulates the take and diffs `computePlayerScore(...).total`
 * before/after, so the consecutive-run rule (including the "bridges two runs
 * into one, erasing a whole separate penalty" case) is captured *exactly*,
 * not approximated. Positive = genuinely good for `seat` (lowers their
 * total); e.g. a card that plugs a gap between two existing runs returns the
 * erased run's full penalty as a bonus, automatically.
 */
function realTakeValue(state: NoThanksState, seat: SeatIndex, card: number, chipsOnCard: number): number {
  const player = state.players.find((p) => p.seat === seat)!;
  const before = computePlayerScore(player).total;
  const after = computePlayerScore({
    seat: player.seat,
    chips: player.chips + chipsOnCard,
    cards: [...player.cards, card].sort((a, b) => a - b),
  }).total;
  return before - after;
}

/**
 * How much a chip is really "worth" to `seat` right now — grows sharply
 * below ~5 remaining. A flat -1 pass cost is only true for the single next
 * turn; it ignores that spending your last few chips converts a controllable
 * choice into "whatever double-digit card turns up next, with whatever's
 * accumulated on it (often little), you must eat it." This is what fixes the
 * "passes everything down to 0 chips, then force-swallows a 30+ card"
 * failure mode (req. ③): as chips shrink, previously-marginal takes (decent
 * `realTakeValue` but not quite better than a flat -1) start winning well
 * before the seat actually hits zero.
 */
function scarcityFactor(chips: number): number {
  if (chips <= 1) return 2.2;
  if (chips <= 2) return 1.8;
  if (chips <= 3) return 1.5;
  if (chips <= 5) return 1.2;
  if (chips <= 8) return 1.05;
  return 1;
}

/**
 * Lv.8–10 ("expert") master EV pass. Unlike `scoreMoveCore`'s one-turn-only
 * view, this weighs the seat's own chip runway (`scarcityFactor`, req. ③)
 * against the exact real value of taking right now (`realTakeValue`, req.
 * ② — this alone also fully and exactly handles req. ①'s "free
 * run-extension" case: a card that plugs a gap into an existing run is
 * `realValue`d correctly with zero extra logic, no separate connects-a-run
 * branch needed, and it's always taken immediately rather than left for
 * later). Every input is real per-seat state already present on `state` —
 * per the confirmed design decision this deliberately does *not*
 * distinguish "secret" vs "public" `chipVisibility`: that option only ever
 * governs what the UI *displays* to human players, never what's in the
 * shared state, and every pass/take is itself a public turn event, so a
 * perfect-memory human could reconstruct the exact same numbers — a Lv.10
 * "master" reading them directly is simulating flawless memory, not
 * cheating.
 *
 * Req. ①'s "칩 파밍" ping-pong (deliberately passing on an already-good take
 * to let the pile grow one more lap) and req. ④'s active interception were
 * both implemented and then *dropped* after measuring them: across 500
 * simulated all-Lv.10 games, both a 1-seat-ahead and a full-table-lap safety
 * check for "is farming safe right now" made the self-destruct rate
 * measurably *worse* (9.6% / 19.0% of games ending with a chip-starved last
 * place) than simply always taking an already-good card immediately (6.0%,
 * even better than the pre-fix baseline's 6.8%). The mechanism: taking a
 * card always grants an immediate extra turn on a freshly-revealed card
 * (rulebook §5-B) — deferring that take to farm more chips also forfeits
 * that tempo, a real cost `realTakeValue`'s pure chip/penalty accounting
 * doesn't capture, and it consistently outweighed the farmed chips' upside
 * regardless of how conservatively "safe to farm" was defined. Req. ④ (deny
 * a chip-starved neighbor a free profit) turned out to have no way to
 * matter anyway once farming was gone: passing is always negative and an
 * already-non-negative take always beats it outright, so an active,
 * loss-free-only denial play is never actually reachable in this game's
 * strictly binary take/pass choice. See NoThanks.test.ts's simulation test
 * for the measured numbers.
 */
function scoreMoveExpert(state: NoThanksState, seat: SeatIndex, move: EngineAction): number {
  const player = state.players.find((p) => p.seat === seat)!;
  const passScore = -scarcityFactor(player.chips);
  if (move.type === "pass") return passScore;

  const card = state.currentCard!;
  return realTakeValue(state, seat, card, state.chipsOnCard);
}

function scoreMove(state: NoThanksState, seat: SeatIndex, move: EngineAction, level: BotLevel): number {
  return botTier(level) === "expert"
    ? scoreMoveExpert(state, seat, move)
    : scoreMoveCore(state, seat, move);
}

/**
 * Picks a move for `seat` per the shared Level 1–10 curve (`pickByLevel`,
 * botDifficulty.ts): scores every legal move with `scoreMove`, then lets the
 * level decide how reliably the best-scored one actually gets played, or
 * null if it isn't `seat`'s turn. `rng` defaults to `Math.random` — bot
 * decisions are local UX, not part of the deterministic engine contract; the
 * resulting `EngineAction` still runs through the ordinary, fully
 * deterministic `applyAction`.
 */
export function chooseBotAction(
  state: NoThanksState,
  seat: SeatIndex,
  level: BotLevel = 5,
  rng: () => number = Math.random,
): EngineAction | null {
  const moves = getValidMoves(state, seat);
  if (moves.length === 0) return null;
  const scored = moves.map((move) => ({ move, score: scoreMove(state, seat, move, level) }));
  return pickByLevel(scored, level, rng);
}

/** Single entry point applying any `EngineAction` to a state — the whole engine as one reducer. */
export function applyAction(state: NoThanksState, action: EngineAction): NoThanksState {
  switch (action.type) {
    case "pass":
      return pass(state, action.seat);
    case "take":
      return take(state, action.seat);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Scoring — the consecutive-run rule
// ---------------------------------------------------------------------------

export interface ScoreGroup {
  /** Ascending, consecutive run of card numbers, e.g. [21, 22, 23]. */
  cards: number[];
  /** Always `cards[0]` — the only number in the run that counts as a penalty. */
  penaltyCard: number;
}

/** Splits a (possibly unsorted) hand of card numbers into consecutive runs. Empty input -> empty output. */
export function computeGroups(cards: number[]): ScoreGroup[] {
  const sorted = [...cards].sort((a, b) => a - b);
  const groups: ScoreGroup[] = [];
  let current: number[] = [];
  for (const card of sorted) {
    if (current.length === 0 || card === current[current.length - 1] + 1) {
      current.push(card);
    } else {
      groups.push({ cards: current, penaltyCard: current[0] });
      current = [card];
    }
  }
  if (current.length > 0) groups.push({ cards: current, penaltyCard: current[0] });
  return groups;
}

export interface PlayerScore {
  seat: SeatIndex;
  /** Ascending. */
  cards: number[];
  groups: ScoreGroup[];
  cardPenalty: number;
  chips: number;
  /** cardPenalty - chips. Lower is better (0 or negative is a great score). */
  total: number;
}

export function computePlayerScore(player: PlayerState): PlayerScore {
  const groups = computeGroups(player.cards);
  const cardPenalty = groups.reduce((sum, g) => sum + g.penaltyCard, 0);
  return {
    seat: player.seat,
    cards: [...player.cards].sort((a, b) => a - b),
    groups,
    cardPenalty,
    chips: player.chips,
    total: cardPenalty - player.chips,
  };
}

export interface RankedScore {
  seat: SeatIndex;
  rank: number;
  score: PlayerScore;
}

/**
 * Standard competition ranking (1, 2, 2, 4, ...): a player's rank is 1 plus
 * the number of players who strictly beat them. Per the rulebook, a lower
 * `total` wins; a tied `total` is broken by more remaining chips; if both are
 * equal the players are genuinely co-ranked.
 */
export function computeRankings(state: NoThanksState): RankedScore[] {
  const scores = state.players.map(computePlayerScore);
  const isBetter = (a: PlayerScore, b: PlayerScore) => (a.total !== b.total ? a.total < b.total : a.chips > b.chips);
  return scores
    .map((score) => ({
      seat: score.seat,
      rank: 1 + scores.filter((other) => other.seat !== score.seat && isBetter(other, score)).length,
      score,
    }))
    .sort((a, b) => a.rank - b.rank);
}
