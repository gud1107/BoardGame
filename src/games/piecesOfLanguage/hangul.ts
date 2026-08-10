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
