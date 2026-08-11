/**
 * Pure "언어의 조각" rules engine — no React, no I/O.
 *
 * **Design history**: this game originally shipped as a 1-on-1 Wordle duel
 * where each player privately chose their *own* secret word for the other to
 * guess (see git history / HANDOFF.md for that version's rulebook-fidelity
 * rationale). This module replaces that design per an explicit, direct user
 * work order (not a rulebook-derived inference) that specifies a different
 * shape:
 *
 *  - **One shared target word**, drawn at random by the system when the game
 *    starts — neither player chooses it, and neither player's own "secret"
 *    exists anymore.
 *  - **Strict turn alternation**: p1 and p2 take turns submitting a guess
 *    against that *same* target word. Whoever lands the exact match first
 *    wins the single-round match immediately.
 *  - **No wall-clock timer** (explicitly decided via `AskUserQuestion` this
 *    session): "제한시간 내에 먼저 맞히면 승리" is modeled purely as a race
 *    condition — first exact match wins — with no countdown/timeout/turn-skip
 *    mechanic. There is nothing to "expire".
 *  - **Combined attempt cap** (also decided via `AskUserQuestion`): the
 *    optional §4-style "최대 시도 횟수" house rule (제한없음/6회/8회) now caps
 *    the *total* guesses across both players combined, not each player's own
 *    count — since both players are racing toward one shared answer rather
 *    than each managing their own attempt budget. Once the combined cap is
 *    hit without an exact match, whoever accumulated more green/yellow hint
 *    lights across their own guesses wins; an exact tie is an explicit draw.
 *  - **Letter-rotation entry + one-light-per-completed-글자 judging** (this
 *    session's work order): guesses are built by rotating 초성/중성/종성
 *    dials per syllable (see `hangul.ts`'s `composeSyllable`) rather than
 *    picked whole from a list, and — critically — feedback is no longer 3
 *    jamo-slot lights per syllable. It's exactly **one light per completed
 *    글자** (2-syllable word ⇒ 2 lights): **green** when that syllable
 *    character matches the target's character at the same position exactly,
 *    **yellow** when that exact syllable character exists elsewhere in the
 *    target word, **red** when it doesn't appear in the target word at all.
 *    This is the classic two-pass Wordle algorithm run over whole syllable
 *    *characters* (음절 문자 단위), not over their individual jamo — jamo
 *    only matter for the rotator's composition step in the UI, never for
 *    scoring.
 */

import { seededRng } from "@/lib/rng";
import { isValidWord, wordsOfLength } from "./words";

export { seededRng };

export type Seat = "p1" | "p2";

export function otherSeat(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

/** green = 글자·위치 모두 일치, yellow = 단어에 포함되나 위치가 다름, red = 단어에 전혀 없음. */
export type FeedbackColor = "green" | "yellow" | "red";

/** One color per completed 글자 (syllable) of the guess, in word order — one light per character, not per jamo slot. */
export type SyllableFeedback = FeedbackColor;

export interface GuessRecord {
  /** Which seat submitted this guess — needed since both seats guess the same shared target. */
  seat: Seat;
  word: string;
  /** One entry per syllable, in word order. */
  feedback: SyllableFeedback[];
  /** True iff this guess exactly matched the shared target word. */
  isMatch: boolean;
}

export type Phase = "playing" | "gameOver";

export interface PiecesOfLanguageState {
  /** Agreed syllable count for the shared target word (2~5). */
  wordLength: number;
  /** Optional combined (both players' guesses summed) attempt cap; null = unlimited. */
  maxAttempts: number | null;
  /** The system-generated shared answer both players are racing to guess. Present in state on both clients (same trust model this project already uses elsewhere), but the UI must not reveal it before `phase === "gameOver"`. */
  targetWord: string;
  /** Every guess ever submitted, in turn order, by either seat. */
  history: GuessRecord[];
  activeSeat: Seat;
  turnNumber: number; // 1-based, increments every guess
  phase: Phase;
  winner: Seat | null;
  isDraw: boolean;
}

/**
 * Draws the shared target word and picks who guesses first — the only
 * randomness this engine needs, both derived from the same seed so every
 * client in a room reproduces an identical state (ARCHITECTURE.md §1
 * determinism contract).
 */
export function startGame(
  wordLength: number,
  maxAttempts: number | null,
  rng: () => number = Math.random,
): PiecesOfLanguageState {
  const firstSeat: Seat = rng() < 0.5 ? "p1" : "p2";
  const pool = wordsOfLength(wordLength);
  const targetWord = pool[Math.floor(rng() * pool.length)];
  return {
    wordLength,
    maxAttempts,
    targetWord,
    history: [],
    activeSeat: firstSeat,
    turnNumber: 1,
    phase: "playing",
    winner: null,
    isDraw: false,
  };
}

/**
 * Compares `guess` against `target` (both already validated as same-length
 * words) whole-syllable-character by whole-syllable-character, using the
 * classic two-pass Wordle algorithm: exact-position matches ("green") are
 * claimed first, then any remaining guessed character is matched against
 * whatever target characters are still unclaimed ("yellow") — so a
 * repeated character is never counted more times than it actually appears
 * in the target. One color comes out per syllable — this is deliberately
 * *not* a jamo-level comparison (see module doc: rotating cho/jung/jong is
 * purely how a guess gets composed, not how it gets scored).
 */
export function compareWords(target: string, guess: string): SyllableFeedback[] {
  const targetChars = [...target];
  const guessChars = [...guess];
  const n = targetChars.length;
  const colors: SyllableFeedback[] = new Array(n).fill("red");
  const remaining: (string | null)[] = [...targetChars];

  for (let i = 0; i < n; i++) {
    if (guessChars[i] === targetChars[i]) {
      colors[i] = "green";
      remaining[i] = null;
    }
  }
  for (let i = 0; i < n; i++) {
    if (colors[i] === "green") continue;
    const idx = remaining.findIndex((c) => c !== null && c === guessChars[i]);
    if (idx !== -1) {
      colors[i] = "yellow";
      remaining[idx] = null;
    }
  }
  return colors;
}

/** Sum of green+yellow lights (one per completed 글자) across one seat's own guesses — the combined-cap tiebreak metric. */
export function hintScore(state: PiecesOfLanguageState, seat: Seat): number {
  let score = 0;
  for (const g of state.history) {
    if (g.seat !== seat) continue;
    for (const tile of g.feedback) {
      if (tile !== "red") score++;
    }
  }
  return score;
}

/** Combined guesses left across both seats against the cap (null = unlimited). */
export function totalAttemptsRemaining(state: PiecesOfLanguageState): number | null {
  if (state.maxAttempts === null) return null;
  return Math.max(0, state.maxAttempts - state.history.length);
}

export type EngineAction = { type: "guess"; word: string };

function applyGuess(state: PiecesOfLanguageState, word: string): PiecesOfLanguageState {
  if (state.phase !== "playing") return state;
  if (!isValidWord(word, state.wordLength)) return state;

  const guesser = state.activeSeat;
  const feedback = compareWords(state.targetWord, word);
  const isMatch = word === state.targetWord;
  const record: GuessRecord = { seat: guesser, word, feedback, isMatch };
  const history = [...state.history, record];

  if (isMatch) {
    // First exact match wins the round immediately — the whole "win condition".
    return { ...state, history, phase: "gameOver", winner: guesser, isDraw: false, turnNumber: state.turnNumber + 1 };
  }

  if (state.maxAttempts !== null && history.length >= state.maxAttempts) {
    // Combined cap exhausted without an exact match — whoever drew more
    // blue/yellow hints across their own guesses wins; a tie is a draw.
    const nextState = { ...state, history };
    const s1 = hintScore(nextState, "p1");
    const s2 = hintScore(nextState, "p2");
    const winner: Seat | null = s1 === s2 ? null : s1 > s2 ? "p1" : "p2";
    return { ...nextState, phase: "gameOver", winner, isDraw: s1 === s2, turnNumber: state.turnNumber + 1 };
  }

  return { ...state, history, activeSeat: otherSeat(guesser), turnNumber: state.turnNumber + 1 };
}

/** Single entry point applying any `EngineAction` to a state — the whole engine as one reducer. */
export function applyAction(state: PiecesOfLanguageState, action: EngineAction): PiecesOfLanguageState {
  switch (action.type) {
    case "guess":
      return applyGuess(state, action.word);
    default:
      return state;
  }
}
