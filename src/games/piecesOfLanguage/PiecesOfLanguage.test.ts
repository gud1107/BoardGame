import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import { decomposeWord, isPureHangulWord } from "./hangul";
import { isValidWord, WORD_BANK } from "./words";
import {
  applyAction,
  attemptsRemaining,
  compareWords,
  hintScore,
  otherSeat,
  startGame,
  type PiecesOfLanguageState,
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

describe("compareWords (§3 힌트 판정)", () => {
  it("an exact match is all-green on every slot", () => {
    const feedback = compareWords("나무", "나무");
    expect(feedback).toEqual([
      { cho: "green", jung: "green", jong: "green" },
      { cho: "green", jung: "green", jong: "green" },
    ]);
  });

  it("marks a jamo present but in the wrong syllable position as yellow", () => {
    // secret "가지" (ㄱㅏ / ㅈㅣ) vs guess "지가" (ㅈㅣ / ㄱㅏ): every 초성/중성
    // is present in the secret, just at the swapped position.
    const feedback = compareWords("가지", "지가");
    expect(feedback[0].cho).toBe("yellow"); // guess ㅈ exists in secret's 초성 set (pos 1)
    expect(feedback[0].jung).toBe("yellow"); // guess ㅣ exists in secret's 중성 set (pos 1)
    expect(feedback[1].cho).toBe("yellow");
    expect(feedback[1].jung).toBe("yellow");
  });

  it("marks a jamo absent from the secret entirely as gray", () => {
    const feedback = compareWords("나무", "구름");
    // 나무 has no ㄱ/ㅜ/ㄹ/ㅡ/ㅁ 조합 matching 구름's 초성 at all... check at least one gray.
    expect(feedback.some((s) => s.cho === "gray" || s.jung === "gray")).toBe(true);
  });

  it("never marks a missing batchim as yellow, even if another syllable also lacks one", () => {
    // "나무": both syllables have jong="" (no batchim). Guessing "무나" (also
    // both no-batchim) should never produce a yellow jong — always green
    // (both absent at that position) since jong[0]===jong[1]==="" for both words.
    const feedback = compareWords("나무", "무나");
    for (const s of feedback) {
      expect(s.jong).not.toBe("yellow");
    }
  });

  it("does not double-count a repeated jamo beyond how many times it appears in the secret", () => {
    // secret "마마" (초성 ㅁㅁ), guess has only two 초성 slots too — every
    // guess 초성 that's ㅁ should be green here since both match; use a
    // 3rd-party case instead: secret "다리" (ㄷㄹ 초성), guess "라라" (ㄹㄹ).
    // Secret has exactly one ㄹ (pos 1), so only one of the two guessed ㄹ's
    // can be marked (green at pos1, and pos0 must be gray, not yellow).
    const feedback = compareWords("다리", "라라");
    const choColors = feedback.map((s) => s.cho).sort();
    expect(choColors).toEqual(["gray", "green"]);
  });
});

describe("startGame (setup, §3)", () => {
  it("is deterministic for a fixed seed", () => {
    const a = startGame(3, null, seededRng(7));
    const b = startGame(3, null, seededRng(7));
    expect(a.activeSeat).toBe(b.activeSeat);
  });

  it("can produce either seat as first mover across seeds", () => {
    const seats = new Set<string>();
    for (let seed = 0; seed < 50; seed++) {
      seats.add(startGame(3, null, seededRng(seed)).activeSeat);
    }
    expect(seats.has("p1")).toBe(true);
    expect(seats.has("p2")).toBe(true);
  });

  it("starts in setup phase with no secrets set and no winner", () => {
    const state = startGame(2, null, seededRng(1));
    expect(state.phase).toBe("setup");
    expect(state.players.p1.secretWord).toBeNull();
    expect(state.players.p2.secretWord).toBeNull();
    expect(state.winner).toBeNull();
    expect(state.isDraw).toBe(false);
    expect(state.wordLength).toBe(2);
  });
});

describe("set-secret (setup phase)", () => {
  it("stays in setup until both seats have submitted", () => {
    let state = startGame(2, null, seededRng(1));
    state = applyAction(state, { type: "set-secret", seat: "p1", word: "나무" });
    expect(state.phase).toBe("setup");
    expect(state.players.p1.secretWord).toBe("나무");
    state = applyAction(state, { type: "set-secret", seat: "p2", word: "사과" });
    expect(state.phase).toBe("playing");
  });

  it("rejects a word of the wrong length or not in the word bank (no-op)", () => {
    const state = startGame(2, null, seededRng(1));
    const wrongLength = applyAction(state, { type: "set-secret", seat: "p1", word: "비행기" });
    expect(wrongLength).toEqual(state);
    const notInBank = applyAction(state, { type: "set-secret", seat: "p1", word: "가나" });
    expect(notInBank).toEqual(state);
  });

  it("a set-secret action is ignored once the game has left setup", () => {
    let state = startGame(2, null, seededRng(1));
    state = applyAction(state, { type: "set-secret", seat: "p1", word: "나무" });
    state = applyAction(state, { type: "set-secret", seat: "p2", word: "사과" });
    const changed = applyAction(state, { type: "set-secret", seat: "p1", word: "구름" });
    expect(changed).toEqual(state);
  });
});

function readyGame(p1Secret: string, p2Secret: string, wordLength: number, maxAttempts: number | null, seed = 1): PiecesOfLanguageState {
  let state = startGame(wordLength, maxAttempts, seededRng(seed));
  state = applyAction(state, { type: "set-secret", seat: "p1", word: p1Secret });
  state = applyAction(state, { type: "set-secret", seat: "p2", word: p2Secret });
  return { ...state, activeSeat: "p1" }; // pin first mover for deterministic assertions
}

describe("guess / 승리 조건 A (정답 즉시 승리)", () => {
  it("an exact-match guess wins immediately for the guesser", () => {
    const state = readyGame("나무", "사과", 2, null);
    const next = applyAction(state, { type: "guess", word: "사과" });
    expect(next.phase).toBe("gameOver");
    expect(next.winner).toBe("p1");
    expect(next.isDraw).toBe(false);
  });

  it("a non-matching guess records feedback and passes the turn", () => {
    const state = readyGame("나무", "구름", 2, null); // p1 guesses against p2's secret "구름"
    const wrongGuess = applyAction(state, { type: "guess", word: "나무" });
    expect(wrongGuess.phase).toBe("playing");
    expect(wrongGuess.activeSeat).toBe("p2");
    expect(wrongGuess.players.p1.guesses).toHaveLength(1);
    expect(wrongGuess.players.p1.guesses[0].isMatch).toBe(false);
  });

  it("rejects a guess of the wrong length or not in the word bank (no-op)", () => {
    const state = readyGame("나무", "사과", 2, null);
    const badLength = applyAction(state, { type: "guess", word: "비행기" });
    expect(badLength).toEqual(state);
  });

  it("once gameOver, further actions are no-ops", () => {
    const state = readyGame("나무", "사과", 2, null);
    const won = applyAction(state, { type: "guess", word: "사과" });
    const after = applyAction(won, { type: "guess", word: "나무" });
    expect(after).toEqual(won);
  });
});

describe("guess / 승리 조건 B (attempt cap + hint-score tiebreak)", () => {
  it("neither wins early; once both burn their 1-attempt cap, the game ends and the winner matches the higher hint score", () => {
    let state = readyGame("나무", "여우", 2, 1); // 1 attempt each, nobody guesses the exact word
    state = applyAction(state, { type: "guess", word: "구름" }); // p1 guesses (wrong) against p2's "여우"
    expect(state.phase).toBe("playing");
    expect(state.activeSeat).toBe("p2");
    state = applyAction(state, { type: "guess", word: "가지" }); // p2 guesses (wrong) against p1's "나무" — both caps now exhausted
    expect(state.phase).toBe("gameOver");
    expect(state.maxAttempts).toBe(1);
    // Cross-check the engine's own tiebreak decision against hintScore directly.
    const s1 = hintScoreOf(state, "p1");
    const s2 = hintScoreOf(state, "p2");
    if (s1 === s2) {
      expect(state.isDraw).toBe(true);
      expect(state.winner).toBeNull();
    } else {
      expect(state.isDraw).toBe(false);
      expect(state.winner).toBe(s1 > s2 ? "p1" : "p2");
    }
  });

  it("a tied hint score is an explicit draw, not an arbitrary winner", () => {
    // Both players happen to pick the same secret word and both guess the
    // same (wrong) word against it, so their feedback — and hence hint
    // score — is identical by construction.
    let state = readyGame("나무", "나무", 2, 1);
    state = applyAction(state, { type: "guess", word: "구름" }); // p1 guesses p2's "나무"
    state = applyAction(state, { type: "guess", word: "구름" }); // p2 guesses p1's "나무" — identical secret+guess -> identical scores
    expect(state.phase).toBe("gameOver");
    expect(state.isDraw).toBe(true);
    expect(state.winner).toBeNull();
  });

  it("the game keeps going past one attempt each when only one side has exhausted the cap", () => {
    let state = readyGame("나무", "사과", 2, 2);
    state = applyAction(state, { type: "guess", word: "구름" }); // p1: 1/2 used
    expect(state.phase).toBe("playing");
    state = applyAction(state, { type: "guess", word: "바다" }); // p2: 1/2 used
    expect(state.phase).toBe("playing"); // neither side has hit the cap of 2 yet
    expect(state.activeSeat).toBe("p1");
  });

  it("attemptsRemaining reflects the cap and unlimited (null) mode", () => {
    let state = readyGame("나무", "사과", 2, 2);
    expect(attemptsRemaining(state, "p1")).toBe(2);
    state = applyAction(state, { type: "guess", word: "구름" });
    expect(attemptsRemaining(state, "p1")).toBe(1);

    const unlimited = readyGame("나무", "사과", 2, null);
    expect(attemptsRemaining(unlimited, "p1")).toBeNull();
  });
});

function hintScoreOf(state: PiecesOfLanguageState, seat: "p1" | "p2"): number {
  return hintScore(state.players[seat]);
}

describe("otherSeat", () => {
  it("flips between p1 and p2", () => {
    expect(otherSeat("p1")).toBe("p2");
    expect(otherSeat("p2")).toBe("p1");
  });
});
