/**
 * Hangul syllable decomposition — pure math, no I/O.
 *
 * Every precomposed Hangul syllable block (U+AC00 "가" .. U+D7A3 "힣") encodes
 * exactly one 초성(initial consonant) + 중성(medial vowel) + optional
 * 종성(final consonant/batchim) triple. This module inverts that encoding so
 * `engine.ts` can compare a guessed word against a secret word "자음/모음
 * 단위" (jamo unit) — the rulebook's phrase for how §3 hint-giving compares
 * words (`boardGameRule/언어의조각/언어의조각.md`).
 *
 * The three fixed-size jamo tables below (19 초성 / 21 중성 / 28 종성,
 * 종성[0] = "" meaning "no batchim") are the standard KS X 1001 ordering used
 * by the Unicode Hangul Syllables block's own encoding formula, not a
 * project-specific invention — see the Unicode Hangul Syllable Composition
 * algorithm.
 */

/** 19 initial consonants (초성), in Unicode Hangul composition order. */
export const CHO_LIST = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
] as const;

/** 21 medial vowels (중성), in Unicode Hangul composition order. */
export const JUNG_LIST = [
  "ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ",
  "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ",
] as const;

/** 28 final consonants (종성), index 0 = "" meaning "no batchim". */
export const JONG_LIST = [
  "", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ",
  "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
] as const;

const HANGUL_BASE = 0xac00; // '가'
const HANGUL_LAST = 0xd7a3; // '힣'
const JUNG_COUNT = JUNG_LIST.length; // 21
const JONG_COUNT = JONG_LIST.length; // 28

export interface DecomposedSyllable {
  cho: string;
  jung: string;
  /** "" means no batchim (종성 없음) — see JONG_LIST[0]. */
  jong: string;
}

export function isHangulSyllable(char: string): boolean {
  if (char.length !== 1) return false;
  const code = char.codePointAt(0) ?? 0;
  return code >= HANGUL_BASE && code <= HANGUL_LAST;
}

/** True iff every character in `word` is a single precomposed Hangul syllable block. */
export function isPureHangulWord(word: string): boolean {
  return word.length > 0 && [...word].every(isHangulSyllable);
}

export function decomposeSyllable(char: string): DecomposedSyllable {
  if (!isHangulSyllable(char)) {
    throw new Error(`Not a Hangul syllable: ${char}`);
  }
  const offset = (char.codePointAt(0) ?? 0) - HANGUL_BASE;
  const choIndex = Math.floor(offset / (JUNG_COUNT * JONG_COUNT));
  const jungIndex = Math.floor((offset % (JUNG_COUNT * JONG_COUNT)) / JONG_COUNT);
  const jongIndex = offset % JONG_COUNT;
  return { cho: CHO_LIST[choIndex], jung: JUNG_LIST[jungIndex], jong: JONG_LIST[jongIndex] };
}

/** Decomposes every syllable of a pure-Hangul word, in order. */
export function decomposeWord(word: string): DecomposedSyllable[] {
  return [...word].map(decomposeSyllable);
}

/**
 * Inverse of `decomposeSyllable` — composes one precomposed Hangul syllable
 * block from a (초성, 중성, 종성) index triple into `CHO_LIST` / `JUNG_LIST` /
 * `JONG_LIST` (indices wrap via `%` so a rotator UI can spin past either end).
 * Every index combination yields a structurally valid Unicode syllable block
 * — Hangul composition has no "invalid" (자음, 모음) pairing — so the rotator
 * UI's own "이 조합은 등록된 단어가 아니에요" check is a word-bank membership
 * check (`isValidWord`), never a composition-validity check.
 */
export function composeSyllable(choIndex: number, jungIndex: number, jongIndex: number): string {
  const cho = ((choIndex % CHO_LIST.length) + CHO_LIST.length) % CHO_LIST.length;
  const jung = ((jungIndex % JUNG_COUNT) + JUNG_COUNT) % JUNG_COUNT;
  const jong = ((jongIndex % JONG_COUNT) + JONG_COUNT) % JONG_COUNT;
  const offset = (cho * JUNG_COUNT + jung) * JONG_COUNT + jong;
  return String.fromCodePoint(HANGUL_BASE + offset);
}

/**
 * The "조각 회전" house rule (`언어의조각.md` §2): a pool tile can stand in
 * for a different jamo when rotated. The rulebook states exactly two
 * concrete pairs — "ㄱ을 돌려 ㄴ으로", "ㅡ를 돌려 ㅣ로" — and no general
 * geometric rule for every other jamo, so this table is intentionally
 * limited to those two rulebook-literal pairs rather than inventing
 * additional "plausible-looking" rotations for jamo the rulebook never
 * mentions. Each pair is symmetric (rotating twice returns the original).
 */
const ROTATION_PAIRS: readonly [string, string][] = [
  ["ㄱ", "ㄴ"],
  ["ㅡ", "ㅣ"],
];

const ROTATION_MAP: Record<string, string> = Object.fromEntries(
  ROTATION_PAIRS.flatMap(([a, b]) => [
    [a, b],
    [b, a],
  ]),
);

/** The jamo `jamo` becomes when rotated, or `null` if it has no rotation partner (rotating it is a no-op). */
export function rotationPartner(jamo: string): string | null {
  return ROTATION_MAP[jamo] ?? null;
}

/** True iff `poolJamo` — used as-is or rotated — can stand in for `required`. An empty `required` (no batchim) always trivially holds, since there's nothing to place. */
export function jamoSatisfiedByTile(poolJamo: string, required: string): boolean {
  if (required === "") return true;
  return poolJamo === required || rotationPartner(poolJamo) === required;
}

/**
 * True iff some tile in `pool` can stand in for `jamo` (literally or via
 * rotation) — `jamoSatisfiedByTile` asked per pool tile against one
 * requirement; this is the same question asked the other way round, for one
 * jamo against the whole pool. Used by the typing-input piece counter
 * (`WordInput.tsx`/`PieceTracker.tsx`) to decide whether a single jamo chip
 * should render as "available" or "overused" — `wordBuildableFromPool`
 * (engine.ts) asks the equivalent whole-word question for gating submission,
 * this is its per-jamo breakdown for the UI. Like the pool itself, this is
 * never a *quantity* check — the pool holds at most one tile per unique
 * jamo (see `engine.ts`'s `buildTilePool`) and is never consumed, so a jamo
 * used twice in one guess is still "available" as long as one matching tile
 * exists at all.
 */
export function jamoAvailableInPool(jamo: string, pool: string[]): boolean {
  return pool.some((tile) => jamoSatisfiedByTile(tile, jamo));
}

/** Per-jamo usage counts for a (possibly still-being-typed) piece of text — see `analyzeJamoUsage`. */
export interface JamoUsage {
  /** 초성/종성 consonant jamo -> how many times each appears. */
  consonants: Record<string, number>;
  /** 중성 vowel jamo -> how many times each appears. */
  vowels: Record<string, number>;
}

function bumpCount(map: Record<string, number>, key: string): void {
  if (key === "") return; // JONG_LIST[0] = "no batchim" — nothing to count.
  map[key] = (map[key] ?? 0) + 1;
}

/**
 * Real-time jamo usage breakdown for `text` — powers `WordInput.tsx`'s
 * per-jamo piece counter (`useHangulAnalysis`, its thin `useMemo` wrapper).
 * Every complete precomposed syllable block is decomposed via
 * `decomposeSyllable` (초성 and 종성 both count toward `consonants`, 중성
 * counts toward `vowels`); a still-mid-composition lone jamo — the IME has
 * only committed e.g. "ㅎ" so far, before its vowel arrives, which is *not*
 * a precomposed syllable block and would make `decomposeSyllable` throw — is
 * still counted by matching it directly against `CHO_LIST`/`JUNG_LIST`, so
 * the counter updates live while typing rather than jumping only once each
 * syllable completes. Compound/複合 자모 (ㄲ, ㅘ, …) are each counted as one
 * atomic piece, matching this module's Unicode-standard jamo tables — never
 * split into ㄱ+ㄱ or ㅗ+ㅏ (see module doc). Anything else (spaces,
 * punctuation, non-Hangul characters) is silently skipped rather than
 * thrown on, since a partial guess is expected to contain incomplete input
 * while the player is still typing.
 */
export function analyzeJamoUsage(text: string): JamoUsage {
  const consonants: Record<string, number> = {};
  const vowels: Record<string, number> = {};
  for (const char of text) {
    if (isHangulSyllable(char)) {
      const { cho, jung, jong } = decomposeSyllable(char);
      bumpCount(consonants, cho);
      bumpCount(vowels, jung);
      bumpCount(consonants, jong);
    } else if ((CHO_LIST as readonly string[]).includes(char)) {
      bumpCount(consonants, char);
    } else if ((JUNG_LIST as readonly string[]).includes(char)) {
      bumpCount(vowels, char);
    }
    // else: not a Hangul jamo/syllable at all — ignored, not thrown on.
  }
  return { consonants, vowels };
}
