/**
 * Pure "언어의 조각" (넷플릭스 예능 <데스게임>) rules engine — no React, no I/O.
 *
 * Source of truth: `boardGameRule/언어의조각/언어의조각.md` ("[자율 글자 수
 * 단판 승부 하우스 룰] 정비된 완벽 규칙서").
 *
 * **Rulebook-vs-task-instruction conflict, resolved via `AskUserQuestion`**:
 * the work order that requested this game described an entirely different
 * genre — a card-deck/supply that continuously spits out random 자음/모음
 * tiles which players drag-and-drop-assemble into words under a per-turn
 * timer, eliminating whoever fails to complete a word. The actual rulebook
 * describes a 1-on-1 Wordle-style deduction duel: before play, both players
 * privately choose their own secret word (their own free choice, typed in —
 * not drawn from any random supply); then on your turn you declare a full
 * guessed word of the agreed length, and your opponent reveals a green
 * (자모 correct & in place) / yellow (자모 present, wrong position) / gray
 * (자모 absent) hint per §3. There is no "continuously generated random
 * letter supply" mechanic anywhere in the rulebook — the rulebook's "자모
 * 타일" are just the *display* medium for the deterministic word/hint
 * exchange, not a randomized draw pool. The user was asked to choose between
 * (a) rulebook verbatim, (b) task instructions verbatim, or (c) a hybrid,
 * and picked (a) — rulebook verbatim, with the Netflix death-game
 * *presentation* (dark countdown UI, elimination-style loss screen) layered
 * on top of the *unmodified* rulebook engine. So: no random letter
 * generator, no drag-and-drop tile supply, no per-turn timeout elimination
 * mechanic in this engine — only what §2~§4 of the rulebook actually specify.
 *
 * House rules implemented (rulebook §4, both already framed as "하우스 룰"
 * in the source document, so no rulebook-vs-instruction conflict here):
 *  - **승리 조건 A (필수)**: guessing the opponent's secret word exactly
 *    (all-green) wins immediately. Modeled as plain string equality —
 *    equivalent to "every 초성/중성/종성 slot green" by construction, since
 *    two words compose to the same syllables iff every jamo matches.
 *  - **승리 조건 B (선택, "최대 시도 횟수")**: a room may cap attempts per
 *    player (e.g. 6~8). Once *both* players have exhausted their cap without
 *    either landing an exact match, whoever "이끌어낸 초록/노랑 힌트"
 *    (sum of green+yellow tiles across their own guesses) is higher wins;
 *    an exact tie is an explicit draw (`isDraw: true`) — the rulebook names
 *    the tiebreak metric but doesn't address a tied score, so a draw is the
 *    most defensible fallback rather than inventing an extra rule.
 *  - The optional attempt cap is a *room setting* (like malDalliJa's turn
 *    timer), broadcast alongside the word-length choice in `game-start` —
 *    see `PiecesOfLanguageGame.tsx`.
 *
 * "자모 단위" comparison granularity: the rulebook says hints compare
 * "자음/모음 단위" at "해당 위치", but doesn't pin down what "위치" means
 * once multi-syllable words are broken into jamo (하나의 5글자 단어도
 * 배치음 유무에 따라 총 자모 개수가 달라져, 단순 순서 나열로는 "위치"가
 * 흔들린다). This engine fixes position as **(음절 순서, 슬롯)** — every
 * word of N syllables always compares as N fixed (초성, 중성, 종성) triples,
 * with "종성 없음" itself treated as a comparable value (JONG_LIST[0] = "").
 * See `compareWords` below and `hangul.ts`'s module doc.
 */

import { seededRng } from "@/lib/rng";
import { decomposeWord } from "./hangul";
import { isValidWord } from "./words";

export { seededRng };

export type Seat = "p1" | "p2";

export function otherSeat(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

export type FeedbackColor = "green" | "yellow" | "gray";
export type JamoSlot = "cho" | "jung" | "jong";

export interface SyllableFeedback {
  cho: FeedbackColor;
  jung: FeedbackColor;
  jong: FeedbackColor;
}

export interface GuessRecord {
  word: string;
  /** One entry per syllable, in word order. */
  feedback: SyllableFeedback[];
  /** True iff this guess exactly matched the opponent's secret word. */
  isMatch: boolean;
}

export interface PlayerState {
  /** Opponent-facing secret word this player set for the *other* seat to guess. Null until submitted (setup phase). */
  secretWord: string | null;
  /** This player's own guesses against the opponent's secret, in order. */
  guesses: GuessRecord[];
}

function emptyPlayerState(): PlayerState {
  return { secretWord: null, guesses: [] };
}

export type Phase = "setup" | "playing" | "gameOver";

export interface PiecesOfLanguageState {
  /** Agreed syllable count for both secret words (§2, 2~5). */
  wordLength: number;
  /** §4 "승리 조건 B" optional attempt cap; null = unlimited (§4 default). */
  maxAttempts: number | null;
  players: Record<Seat, PlayerState>;
  activeSeat: Seat;
  turnNumber: number; // 1-based, increments every guess
  phase: Phase;
  winner: Seat | null;
  isDraw: boolean;
}

/**
 * §3 "선/후공을 가위바위보나 추첨으로 정한 뒤" — the only randomness this
 * engine needs is picking who guesses first; secret words are the players'
 * own free choice (typed input via `set-secret`, never randomized).
 */
export function startGame(
  wordLength: number,
  maxAttempts: number | null,
  rng: () => number = Math.random,
): PiecesOfLanguageState {
  const firstSeat: Seat = rng() < 0.5 ? "p1" : "p2";
  return {
    wordLength,
    maxAttempts,
    players: { p1: emptyPlayerState(), p2: emptyPlayerState() },
    activeSeat: firstSeat,
    turnNumber: 1,
    phase: "setup",
    winner: null,
    isDraw: false,
  };
}

/**
 * Compares `guess` against `secret` (both already validated as same-length
 * pure-Hangul words) syllable-by-syllable, jamo-slot-by-jamo-slot, using the
 * classic two-pass Wordle algorithm run *independently per slot type*
 * (초성 only ever compares against other 초성, etc. — categories never mix).
 *
 * "종성 없음" (jong = "") is excluded from the yellow (present-elsewhere)
 * pass: an *absence* of a batchim isn't a "letter" that can be "found
 * elsewhere in the word", so a jong mismatch where either side has no
 * batchim is gray, never yellow — this is a deliberate interpretation (the
 * rulebook doesn't discuss the no-batchim edge case), documented here rather
 * than left implicit.
 */
export function compareWords(secret: string, guess: string): SyllableFeedback[] {
  const secretSyllables = decomposeWord(secret);
  const guessSyllables = decomposeWord(guess);
  const n = secretSyllables.length;

  function scoreSlot(slot: JamoSlot): FeedbackColor[] {
    const secretValues = secretSyllables.map((s) => s[slot]);
    const guessValues = guessSyllables.map((s) => s[slot]);
    const colors: FeedbackColor[] = new Array(n).fill("gray");
    const remaining: (string | null)[] = [...secretValues];

    for (let i = 0; i < n; i++) {
      if (guessValues[i] === secretValues[i]) {
        colors[i] = "green";
        remaining[i] = null;
      }
    }
    for (let i = 0; i < n; i++) {
      if (colors[i] === "green") continue;
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

/** Sum of green+yellow tiles across a player's own guesses — §4 "승리 조건 B" tiebreak metric. */
export function hintScore(player: PlayerState): number {
  let score = 0;
  for (const g of player.guesses) {
    for (const tile of g.feedback) {
      if (tile.cho !== "gray") score++;
      if (tile.jung !== "gray") score++;
      if (tile.jong !== "gray") score++;
    }
  }
  return score;
}

/** Attempts a seat has left against the cap (null = unlimited, per §4 승리 조건 B). */
export function attemptsRemaining(state: PiecesOfLanguageState, seat: Seat): number | null {
  if (state.maxAttempts === null) return null;
  return Math.max(0, state.maxAttempts - state.players[seat].guesses.length);
}

export type EngineAction =
  | { type: "set-secret"; seat: Seat; word: string }
  | { type: "guess"; word: string };

function applySetSecret(
  state: PiecesOfLanguageState,
  seat: Seat,
  word: string,
): PiecesOfLanguageState {
  if (state.phase !== "setup") return state;
  if (!isValidWord(word, state.wordLength)) return state;

  const players: Record<Seat, PlayerState> = {
    ...state.players,
    [seat]: { ...state.players[seat], secretWord: word },
  };
  const bothReady = players.p1.secretWord !== null && players.p2.secretWord !== null;
  return { ...state, players, phase: bothReady ? "playing" : "setup" };
}

function applyGuess(state: PiecesOfLanguageState, word: string): PiecesOfLanguageState {
  if (state.phase !== "playing") return state;
  if (!isValidWord(word, state.wordLength)) return state;

  const guesser = state.activeSeat;
  const opponent = otherSeat(guesser);
  const secret = state.players[opponent].secretWord;
  if (!secret) return state; // defensive: shouldn't happen once phase is "playing"

  const feedback = compareWords(secret, word);
  const isMatch = word === secret;
  const record: GuessRecord = { word, feedback, isMatch };
  const players: Record<Seat, PlayerState> = {
    ...state.players,
    [guesser]: { ...state.players[guesser], guesses: [...state.players[guesser].guesses, record] },
  };

  if (isMatch) {
    // §4 승리 조건 A: exact match wins immediately.
    return { ...state, players, phase: "gameOver", winner: guesser, isDraw: false, turnNumber: state.turnNumber + 1 };
  }

  if (state.maxAttempts !== null) {
    const p1Done = players.p1.guesses.length >= state.maxAttempts;
    const p2Done = players.p2.guesses.length >= state.maxAttempts;
    if (p1Done && p2Done) {
      // §4 승리 조건 B: both exhausted their attempt cap without an exact
      // match — whoever drew more green/yellow hints wins; tie = draw.
      const s1 = hintScore(players.p1);
      const s2 = hintScore(players.p2);
      const winner: Seat | null = s1 === s2 ? null : s1 > s2 ? "p1" : "p2";
      return {
        ...state,
        players,
        phase: "gameOver",
        winner,
        isDraw: s1 === s2,
        turnNumber: state.turnNumber + 1,
      };
    }
  }

  return { ...state, players, activeSeat: opponent, turnNumber: state.turnNumber + 1 };
}

/** Single entry point applying any `EngineAction` to a state — the whole engine as one reducer. */
export function applyAction(state: PiecesOfLanguageState, action: EngineAction): PiecesOfLanguageState {
  switch (action.type) {
    case "set-secret":
      return applySetSecret(state, action.seat, action.word);
    case "guess":
      return applyGuess(state, action.word);
    default:
      return state;
  }
}
