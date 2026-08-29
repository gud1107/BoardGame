"use client";

import { useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { isValidWord, wordsOfLength } from "./words";
import { isHangulSyllable } from "./hangul";
import { wordBuildableFromPool } from "./engine";
import { useHangulAnalysis } from "./useHangulAnalysis";
import PieceTracker from "./PieceTracker";

/**
 * Direct-typing guess entry (replaces the old syllable-rotator dial picker —
 * see git history for that version): a single controlled `<input>` a player
 * types a whole guess into with their own keyboard (mobile IME or desktop),
 * with `PieceTracker` above it giving real-time consonant/vowel usage
 * feedback as they type. Kept deliberately *sticky-bottom* (not truly
 * viewport-`fixed`, which would fight this app's own scroll containers) so
 * the counter + submit button stay in view once a mobile on-screen keyboard
 * opens, without reaching for the full Visual Viewport API for what's a
 * single small control.
 *
 * Validity is unchanged from the old rotator: a guess only submits once it's
 * *both* a real word-bank entry (`isValidWord`) *and* buildable from the
 * shared tile pool (`wordBuildableFromPool` — literally or via each tile's
 * rotation partner, engine.ts's module doc). `PieceTracker`'s red chips are
 * a live preview of that same pool rule per jamo, not a separate check.
 *
 * IME composition: React already delivers each intermediate composed
 * character through plain `onChange` as a Korean IME composes it (no
 * separate `compositionstart`/`compositionend` wiring needed for a
 * single-line text input), so typing "ㅎ" → "하" → "한" already re-renders
 * `PieceTracker` after every keystroke.
 */
export interface WordInputProps {
  wordLength: number;
  pool: string[];
  accent: string;
  onSubmit: (word: string) => void;
}

/**
 * Closest-match valid words for the "완성 힌트" chip row — ranked by how
 * many syllables already match the current (invalid) input, restricted to
 * words the shared tile pool can actually build (engine.ts's §2 hard rail),
 * so a hint chip never points at something the pool would reject on submit
 * anyway. Tapping a chip fills the input outright (this game has no
 * per-jamo "nudge a dial" step anymore).
 */
function suggestCompletions(current: string, wordLength: number, pool: string[], limit = 6): string[] {
  const currentChars = [...current];
  const ranked = wordsOfLength(wordLength)
    .filter((w) => wordBuildableFromPool(w, pool))
    .map((w) => {
      const chars = [...w];
      let matches = 0;
      for (let i = 0; i < wordLength; i++) if (chars[i] === currentChars[i]) matches++;
      return { w, matches };
    })
    .sort((a, b) => b.matches - a.matches);
  return ranked.slice(0, limit).map((r) => r.w);
}

export default function WordInput({ wordLength, pool, accent, onSubmit }: WordInputProps) {
  const [value, setValue] = useState("");
  const [shake, setShake] = useState(false);
  const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const usage = useHangulAnalysis(value);
  const chars = [...value];
  const isComplete = chars.length === wordLength && chars.every(isHangulSyllable);
  const isWord = isComplete && isValidWord(value, wordLength);
  const poolOk = isComplete && wordBuildableFromPool(value, pool);
  const valid = isWord && poolOk;
  const suggestions = isComplete && !valid ? suggestCompletions(value, wordLength, pool) : [];

  function triggerShake() {
    setShake(true);
    if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
    shakeTimerRef.current = setTimeout(() => setShake(false), 400);
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    // Cap at `wordLength` *syllables* (code points), not UTF-16 length, so
    // pasting something longer doesn't silently overflow this fixed-length
    // guess.
    setValue([...e.target.value].slice(0, wordLength).join(""));
  }

  function submitIfValid() {
    if (!valid) {
      triggerShake();
      return;
    }
    onSubmit(value);
    setValue("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    submitIfValid();
  }

  const errorMessage = isComplete && !isWord ? `⚠️ "${value}"은(는) 올바른 한글 단어가 아니에요` : isComplete && isWord && !poolOk ? `🧩 "${value}"은(는) 단어이지만 지금 조각 풀로는 조합할 수 없어요` : null;

  return (
    <div className="sticky bottom-2 z-10 flex flex-col gap-2.5">
      <PieceTracker usage={usage} pool={pool} shake={shake} />

      <div className="flex flex-col gap-1.5 rounded-2xl border border-white/10 bg-gradient-to-b from-[#140a1c] via-[#0c0715] to-black p-3">
        <input
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          lang="ko"
          inputMode="text"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={`${wordLength}글자 단어를 입력하세요`}
          aria-label="추측 단어 입력"
          className={`rounded-xl border bg-black/30 px-4 py-3 text-center text-lg font-bold tracking-widest text-white placeholder:text-white/20 focus:outline-none ${
            value.length === 0
              ? "border-white/15 focus:border-violet-400"
              : valid
                ? "border-sky-300 focus:border-sky-300"
                : "border-rose-400/50 focus:border-rose-400"
          }`}
        />

        {errorMessage && <p className="text-center text-xs text-amber-300">{errorMessage}</p>}

        {suggestions.length > 0 && (
          <div className="flex flex-wrap justify-center gap-1.5">
            <span className="text-[11px] text-white/40">완성 힌트:</span>
            {suggestions.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setValue(w)}
                className={`rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-medium text-white/70 transition hover:text-white ${accent}`}
              >
                {w}
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          disabled={!valid}
          onClick={submitIfValid}
          title={
            !valid
              ? !isComplete
                ? `${wordLength}글자를 모두 입력해야 제출할 수 있어요`
                : !isWord
                  ? "사전에 없는 단어예요"
                  : "지금 조각 풀로는 조합할 수 없는 단어예요"
              : undefined
          }
          className="rounded-xl bg-violet-500 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
        >
          제시하기 (Enter)
        </button>
      </div>
    </div>
  );
}
