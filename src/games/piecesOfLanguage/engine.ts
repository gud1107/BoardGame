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
 *    hit without an exact match, whoever accumulated more blue/yellow hint
 *    tiles across their own guesses wins; an exact tie is an explicit draw.
 *
 * Hint color semantics (per this session's work order): a tile is
 * **blue** when the submitted 자음/모음 matches the target word's jamo *and*
 * position exactly, **yellow** when that jamo exists in the target word but
 * at a different position, and **gray** when it doesn't appear in the target
 * word at all. This is the same classic two-pass Wordle scoring as before,
 * just relabeled green→blue per the work order's explicit color spec.
 *
 * "자모 단위" comparison granularity: comparisons run per **(음절 순서,
 * 슬롯)** — every word of N syllables always compares as N fixed (초성,
 * 중성, 종성) triples, with "종성 없음" itself treated as a comparable value
 * (JONG_LIST[0] = ""). See `compareWords` below and `hangul.ts`'s module doc.
 * "종성 없음" is excluded from the yellow pass: an absence of a batchim isn't
 * a "letter" that can be "found elsewhere in the word", so a jong mismatch
 * where either side has no batchim is gray, never yellow.
 */

import { seededRng } from "@/lib/rng";
import { decomposeWord } from "./hangul";
import { isValidWord, wordsOfLength } from "./words";

export { seededRng };

export type Seat = "p1" | "p2";

export function otherSeat(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

export type FeedbackColor = "blue" | "yellow" | "gray";
export type JamoSlot = "cho" | "jung" | "jong";

export interface SyllableFeedback {
  cho: FeedbackColor;
  jung: FeedbackColor;
  jong: FeedbackColor;
}

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
 * pure-Hangul words) syllable-by-syllable, jamo-slot-by-jamo-slot, using the
 * classic two-pass Wordle algorithm run *independently per slot type*
 * (초성 only ever compares against other 초성, etc. — categories never mix).
 */
export function compareWords(target: string, guess: string): SyllableFeedback[] {
  const targetSyllables = decomposeWord(target);
  const guessSyllables = decomposeWord(guess);
  const n = targetSyllables.length;

  function scoreSlot(slot: JamoSlot): FeedbackColor[] {
    const targetValues = targetSyllables.map((s) => s[slot]);
    const guessValues = guessSyllables.map((s) => s[slot]);
    const colors: FeedbackColor[] = new Array(n).fill("gray");
    const remaining: (string | null)[] = [...targetValues];

    for (let i = 0; i < n; i++) {
      if (guessValues[i] === targetValues[i]) {
        colors[i] = "blue";
        remaining[i] = null;
      }
    }
    for (let i = 0; i < n; i++) {
      if (colors[i] === "blue") continue;
      const value = guessValues[i];
      if (slot === "jong" && value === "") continue; // no-batchim: never yellow, see doc above
      const idx = remaining.findIndex((v) => v !== null && v !== "" && v === value);
      if (idx !== -1) {
        colors[i] = "yellow";
        remaining[idx] = null;
      }
    }
    return colors;
  }

  const choColors = scoreSlot("cho");
  const jungColors = scoreSlot("jung");
  const jongColors = scoreSlot("jong");

  return Array.from({ length: n }, (_, i) => ({
    cho: choColors[i],
    jung: jungColors[i],
    jong: jongColors[i],
  }));
}

/** Sum of blue+yellow tiles across one seat's own guesses — the combined-cap tiebreak metric. */
export function hintScore(state: PiecesOfLanguageState, seat: Seat): number {
  let score = 0;
  for (const g of state.history) {
    if (g.seat !== seat) continue;
    for (const tile of g.feedback) {
      if (tile.cho !== "gray") score++;
      if (tile.jung !== "gray") score++;
      if (tile.jong !== "gray") score++;
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
