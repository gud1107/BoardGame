import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import { CHO_LIST, JONG_LIST, JUNG_LIST, composeSyllable, decomposeSyllable, decomposeWord, isPureHangulWord } from "./hangul";
import { isValidWord, wordsOfLength, WORD_BANK } from "./words";
import {
  applyAction,
  compareWords,
  hintScore,
  otherSeat,
  startGame,
  totalAttemptsRemaining,
  type PiecesOfLanguageState,
  type Seat,
} from "./engine";

describe("hangul decomposition", () => {
  it("splits a syllable with a complex vowel and no batchim", () => {
    expect(decomposeWord("사과")).toEqual([
      { cho: "ㅅ", jung: "ㅏ", jong: "" },
      { cho: "ㄱ", jung: "ㅘ", jong: "" },
    ]);
  });

  it("splits a syllable that has a batchim", () => {
    expect(decomposeWord("하늘")).toEqual([
      { cho: "ㅎ", jung: "ㅏ", jong: "" },
      { cho: "ㄴ", jung: "ㅡ", jong: "ㄹ" },
    ]);
  });

  it("rejects non-Hangul input", () => {
    expect(isPureHangulWord("abc")).toBe(false);
    expect(isPureHangulWord("사과!")).toBe(false);
    expect(isPureHangulWord("ㅅㅏㄱㅘ")).toBe(false); // bare jamo, not composed syllables
  });
});

describe("composeSyllable (rotator dial composition)", () => {
  it("composes the standard cho+jung syllable (no batchim) the rotator UI's example uses", () => {
    // ㅂ(초성) + ㅏ(중성), 종성 없음 = "바"; ㄷ + ㅏ = "다" — the rulebook's own "바다" example.
    expect(composeSyllable(CHO_LIST.indexOf("ㅂ"), JUNG_LIST.indexOf("ㅏ"), 0)).toBe("바");
    expect(composeSyllable(CHO_LIST.indexOf("ㄷ"), JUNG_LIST.indexOf("ㅏ"), 0)).toBe("다");
  });

  it("round-trips with decomposeSyllable for a syllable that has a batchim", () => {
    const d = decomposeSyllable("하늘"[1]); // "늘": ㄴ/ㅡ/ㄹ
    const composed = composeSyllable(
      CHO_LIST.indexOf(d.cho as (typeof CHO_LIST)[number]),
      JUNG_LIST.indexOf(d.jung as (typeof JUNG_LIST)[number]),
      JONG_LIST.indexOf(d.jong as (typeof JONG_LIST)[number]),
    );
    expect(composed).toBe("늘");
  });

  it("wraps out-of-range indices via modulo, so a rotator can spin past either end", () => {
    expect(composeSyllable(-1, 0, 0)).toBe(composeSyllable(CHO_LIST.length - 1, 0, 0));
    expect(composeSyllable(CHO_LIST.length, 0, 0)).toBe(composeSyllable(0, 0, 0));
  });
});

describe("word bank validity", () => {
  it("every bank entry actually has the syllable count of its own bucket", () => {
    for (const [length, words] of Object.entries(WORD_BANK)) {
      for (const w of words) {
        expect(w.length).toBe(Number(length));
        expect(isPureHangulWord(w)).toBe(true);
      }
    }
  });

  it("accepts a listed word of the right length, rejects wrong length or unlisted words", () => {
    expect(isValidWord("나무", 2)).toBe(true);
    expect(isValidWord("나무", 3)).toBe(false);
    expect(isValidWord("얼레벌레", 4)).toBe(false); // not in the bank
  });
});

describe("compareWords (완성 글자 단위 불빛 판정 — 1글자 = 1불빛)", () => {
  it("an exact match is all-green, one light per syllable", () => {
    const feedback = compareWords("나무", "나무");
    expect(feedback).toEqual(["green", "green"]);
  });

  it("marks a syllable present elsewhere in the target as yellow — the rulebook's 바다/다바 example", () => {
    // target "바다": guessing "다바" swaps both syllables, so each guessed
    // character exists in the target just at the other position.
    const feedback = compareWords("바다", "다바");
    expect(feedback).toEqual(["yellow", "yellow"]);
  });

  it("marks a syllable absent from the target entirely as red", () => {
    const feedback = compareWords("나무", "구름");
    expect(feedback).toEqual(["red", "red"]);
  });

  it("does not double-count a repeated syllable beyond how many times it appears in the target", () => {
    // target "다리" has exactly one "리" (at position 1), so guessing "리리"
    // can only mark one of the two as green/yellow. The exact-position match
    // (pos 1) is claimed first as green, leaving the target's "리" spent —
    // so pos 0's guessed "리" has nothing left to match and is red.
    const feedback = compareWords("다리", "리리");
    expect(feedback).toEqual(["red", "green"]);
  });

  it("mixes green/yellow/red within a single guess as appropriate", () => {
    // target "바다": guess "바구" — "바" matches position 0 (green), "구"
    // doesn't appear in "바다" at all (red).
    const feedback = compareWords("바다", "바구");
    expect(feedback).toEqual(["green", "red"]);
  });
});

describe("startGame", () => {
  it("is deterministic for a fixed seed (first mover and target word alike)", () => {
    const a = startGame(3, null, seededRng(7));
    const b = startGame(3, null, seededRng(7));
    expect(a.activeSeat).toBe(b.activeSeat);
    expect(a.targetWord).toBe(b.targetWord);
  });

  it("can produce either seat as first mover across seeds", () => {
    const seats = new Set<string>();
    for (let seed = 0; seed < 50; seed++) {
      seats.add(startGame(3, null, seededRng(seed)).activeSeat);
    }
    expect(seats.has("p1")).toBe(true);
    expect(seats.has("p2")).toBe(true);
  });

  it("starts directly in the playing phase with a valid shared target word and empty history", () => {
    const state = startGame(2, null, seededRng(1));
    expect(state.phase).toBe("playing");
    expect(wordsOfLength(2)).toContain(state.targetWord);
    expect(state.targetWord.length).toBe(2);
    expect(state.history).toEqual([]);
    expect(state.winner).toBeNull();
    expect(state.isDraw).toBe(false);
    expect(state.wordLength).toBe(2);
  });
});

/** Builds a ready-to-guess state with a pinned target word and active seat, for deterministic assertions. */
function readyGame(targetWord: string, wordLength: number, maxAttempts: number | null, activeSeat: Seat = "p1"): PiecesOfLanguageState {
  const state = startGame(wordLength, maxAttempts, seededRng(1));
  return { ...state, targetWord, activeSeat };
}

describe("guess / 승리 조건 (정답 즉시 승리)", () => {
  it("an exact-match guess wins immediately for whoever is active", () => {
    const state = readyGame("사과", 2, null, "p1");
    const next = applyAction(state, { type: "guess", word: "사과" });
    expect(next.phase).toBe("gameOver");
    expect(next.winner).toBe("p1");
    expect(next.isDraw).toBe(false);
    expect(next.history).toEqual([{ seat: "p1", word: "사과", feedback: expect.any(Array), isMatch: true }]);
  });

  it("a non-matching guess records feedback tagged with the guesser's seat and passes the turn", () => {
    const state = readyGame("구름", 2, null, "p1");
    const wrongGuess = applyAction(state, { type: "guess", word: "나무" });
    expect(wrongGuess.phase).toBe("playing");
    expect(wrongGuess.activeSeat).toBe("p2");
    expect(wrongGuess.history).toHaveLength(1);
    expect(wrongGuess.history[0]).toMatchObject({ seat: "p1", word: "나무", isMatch: false });
  });

  it("alternates the active seat strictly turn by turn", () => {
    let state = readyGame("구름", 2, null, "p1");
    state = applyAction(state, { type: "guess", word: "나무" });
    expect(state.activeSeat).toBe("p2");
    state = applyAction(state, { type: "guess", word: "바다" });
    expect(state.activeSeat).toBe("p1");
    expect(state.history.map((g) => g.seat)).toEqual(["p1", "p2"]);
  });

  it("rejects a guess of the wrong length or not in the word bank (no-op)", () => {
    const state = readyGame("사과", 2, null, "p1");
    const badLength = applyAction(state, { type: "guess", word: "비행기" });
    expect(badLength).toEqual(state);
    const notInBank = applyAction(state, { type: "guess", word: "가나" });
    expect(notInBank).toEqual(state);
  });

  it("once gameOver, further actions are no-ops", () => {
    const state = readyGame("사과", 2, null, "p1");
    const won = applyAction(state, { type: "guess", word: "사과" });
    const after = applyAction(won, { type: "guess", word: "나무" });
    expect(after).toEqual(won);
  });
});

describe("guess / 최대 시도 횟수(양쪽 합산) + 힌트 점수 동점 처리", () => {
  it("neither wins early; once the combined cap is burned, the game ends and the winner matches the higher hint score", () => {
    let state = readyGame("여우", 2, 2, "p1"); // 2 combined attempts, nobody guesses the exact word
    state = applyAction(state, { type: "guess", word: "구름" }); // p1 guesses (wrong)
    expect(state.phase).toBe("playing");
    expect(state.activeSeat).toBe("p2");
    state = applyAction(state, { type: "guess", word: "가지" }); // p2 guesses (wrong) — combined cap now exhausted
    expect(state.phase).toBe("gameOver");
    expect(state.maxAttempts).toBe(2);
    const s1 = hintScore(state, "p1");
    const s2 = hintScore(state, "p2");
    if (s1 === s2) {
      expect(state.isDraw).toBe(true);
      expect(state.winner).toBeNull();
    } else {
      expect(state.isDraw).toBe(false);
      expect(state.winner).toBe(s1 > s2 ? "p1" : "p2");
    }
  });

  it("a tied hint score is an explicit draw, not an arbitrary winner", () => {
    // Both players guess the exact same (wrong) word against the same
    // target, so their feedback — and hence hint score — is identical.
    let state = readyGame("나무", 2, 2, "p1");
    state = applyAction(state, { type: "guess", word: "구름" });
    state = applyAction(state, { type: "guess", word: "구름" });
    expect(state.phase).toBe("gameOver");
    expect(state.isDraw).toBe(true);
    expect(state.winner).toBeNull();
  });

  it("the game keeps going past the combined cap's halfway point until it's actually exhausted", () => {
    let state = readyGame("사과", 2, 4, "p1");
    state = applyAction(state, { type: "guess", word: "구름" }); // 1/4 used
    expect(state.phase).toBe("playing");
    state = applyAction(state, { type: "guess", word: "바다" }); // 2/4 used
    expect(state.phase).toBe("playing"); // combined cap of 4 not yet hit
    expect(state.activeSeat).toBe("p1");
  });

  it("totalAttemptsRemaining reflects the combined cap and unlimited (null) mode", () => {
    let state = readyGame("사과", 2, 4, "p1");
    expect(totalAttemptsRemaining(state)).toBe(4);
    state = applyAction(state, { type: "guess", word: "구름" });
    expect(totalAttemptsRemaining(state)).toBe(3);

    const unlimited = readyGame("사과", 2, null, "p1");
    expect(totalAttemptsRemaining(unlimited)).toBeNull();
  });
});

describe("otherSeat", () => {
  it("flips between p1 and p2", () => {
    expect(otherSeat("p1")).toBe("p2");
    expect(otherSeat("p2")).toBe("p1");
  });
});
