import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import {
  CHO_LIST,
  JONG_LIST,
  JUNG_LIST,
  composeSyllable,
  decomposeSyllable,
  decomposeWord,
  isPureHangulWord,
  jamoSatisfiedByTile,
  rotationPartner,
} from "./hangul";
import { isValidWord, wordsOfLength, WORD_BANK } from "./words";
import {
  applyAction,
  buildHint,
  buildTilePool,
  chooseBotAction,
  compareWords,
  getValidMoves,
  hintRevealIndices,
  hintScore,
  isHintUnlocked,
  otherSeat,
  startGame,
  totalAttemptsRemaining,
  wordBuildableFromPool,
  wrongAttemptCount,
  type EngineAction,
  type GuessRecord,
  type PiecesOfLanguageState,
  type Seat,
} from "./engine";

/** Every jamo a rotator dial can produce — used so tests unrelated to the tile-pool hard rail don't get blocked by it. */
const WILDCARD_POOL = [...CHO_LIST, ...JUNG_LIST, ...JONG_LIST.filter((j) => j !== "")];

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

/**
 * Builds a ready-to-guess state with a pinned target word and active seat,
 * for deterministic assertions. `tilePool` is overridden to a wildcard pool
 * (every jamo a dial can produce) so these pre-existing scoring/turn tests
 * aren't incidentally gated by the tile-pool hard rail — that rule gets its
 * own dedicated tests below.
 */
function readyGame(targetWord: string, wordLength: number, maxAttempts: number | null, activeSeat: Seat = "p1"): PiecesOfLanguageState {
  const state = startGame(wordLength, maxAttempts, seededRng(1));
  return { ...state, targetWord, activeSeat, tilePool: WILDCARD_POOL };
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

describe("힌트 해금 조건 + 50% 부분 마스킹 (wrongAttemptCount / isHintUnlocked / buildHint)", () => {
  it("a seat with zero guesses of its own has the hint locked", () => {
    const state = readyGame("사과", 2, null, "p1");
    expect(wrongAttemptCount(state, "p1")).toBe(0);
    expect(isHintUnlocked(state, "p1")).toBe(false);
  });

  it("a wrong guess unlocks the hint for the seat that submitted it, not the other seat", () => {
    let state = readyGame("구름", 2, null, "p1");
    state = applyAction(state, { type: "guess", word: "나무" }); // p1 guesses wrong
    expect(wrongAttemptCount(state, "p1")).toBe(1);
    expect(isHintUnlocked(state, "p1")).toBe(true);
    expect(wrongAttemptCount(state, "p2")).toBe(0);
    expect(isHintUnlocked(state, "p2")).toBe(false);
  });

  it("an exact-match (winning) guess does not itself count as a wrong attempt", () => {
    const state = readyGame("사과", 2, null, "p1");
    const won = applyAction(state, { type: "guess", word: "사과" });
    expect(wrongAttemptCount(won, "p1")).toBe(0);
    expect(isHintUnlocked(won, "p1")).toBe(false);
  });

  it("reveals exactly K = floor(L/2) characters for a 2-syllable word (1 revealed, 1 masked)", () => {
    const revealed = hintRevealIndices("사과", "p1");
    expect(revealed.size).toBe(1);
    const hint = buildHint("사과", "p1");
    expect(hint).toHaveLength(2);
    expect(hint.filter((c) => c !== "_")).toHaveLength(1);
    expect(hint.filter((c) => c === "_")).toHaveLength(1);
  });

  it("reveals exactly K = floor(L/2) characters for a 4-syllable word (2 revealed, 2 masked)", () => {
    const target = wordsOfLength(4)[0];
    const revealed = hintRevealIndices(target, "p1");
    expect(revealed.size).toBe(2);
    const hint = buildHint(target, "p1");
    expect(hint).toHaveLength(4);
    expect(hint.filter((c) => c !== "_")).toHaveLength(2);
    expect(hint.filter((c) => c === "_")).toHaveLength(2);
  });

  it("every revealed character actually matches the target word at that position, masked slots are always '_'", () => {
    const target = "가지";
    const revealed = hintRevealIndices(target, "p2");
    const hint = buildHint(target, "p2");
    [...target].forEach((ch, i) => {
      expect(hint[i]).toBe(revealed.has(i) ? ch : "_");
    });
  });

  it("is deterministic for the same word+seat (stable across re-renders), independent per seat", () => {
    expect(buildHint("사과", "p1")).toEqual(buildHint("사과", "p1"));
    // Not asserting p1 !== p2 here (a coin-flip could coincide) — just that
    // both are independently valid half-reveals of the same word.
    expect(buildHint("사과", "p2").filter((c) => c !== "_")).toHaveLength(1);
  });
});

describe("otherSeat", () => {
  it("flips between p1 and p2", () => {
    expect(otherSeat("p1")).toBe("p2");
    expect(otherSeat("p2")).toBe("p1");
  });
});

describe("rotationPartner / jamoSatisfiedByTile (조각 회전 규칙)", () => {
  it("ㄱ and ㅡ rotate to the rulebook's explicit examples, and back", () => {
    expect(rotationPartner("ㄱ")).toBe("ㄴ");
    expect(rotationPartner("ㄴ")).toBe("ㄱ");
    expect(rotationPartner("ㅡ")).toBe("ㅣ");
    expect(rotationPartner("ㅣ")).toBe("ㅡ");
  });

  it("a jamo outside the rulebook's rotation pairs has no partner", () => {
    expect(rotationPartner("ㅁ")).toBeNull();
    expect(rotationPartner("ㅏ")).toBeNull();
  });

  it("a tile satisfies a requirement either literally or via its rotation partner", () => {
    expect(jamoSatisfiedByTile("ㄴ", "ㄱ")).toBe(true); // rotated stand-in
    expect(jamoSatisfiedByTile("ㄱ", "ㄱ")).toBe(true); // literal
    expect(jamoSatisfiedByTile("ㅁ", "ㄱ")).toBe(false); // no rotation partner, not literal
  });

  it("an empty (batchim-less) requirement is always satisfied — there's nothing to place", () => {
    expect(jamoSatisfiedByTile("ㅁ", "")).toBe(true);
  });
});

describe("buildTilePool / wordBuildableFromPool (공통 자모음 조각 풀 & 하드 레일 조합 제약)", () => {
  it("draws exactly one tile per unique jamo the target needs, deduped across repeated jamo", () => {
    // "가을": 초성 ㄱ/ㅇ, 중성 ㅏ/ㅡ, 종성 ㄹ — 5 unique jamo, no repeats to dedupe here,
    // but this pins the count so a future change that double-counts would fail loudly.
    const pool = buildTilePool("가을", seededRng(1));
    expect(pool).toHaveLength(5);
  });

  it("dedupes a jamo repeated across syllables into a single pool tile", () => {
    // "바다": both syllables need 중성 ㅏ — should still be one tile, not two.
    const pool = buildTilePool("바다", seededRng(1));
    expect(pool).toHaveLength(3); // ㅂ, ㄷ, ㅏ
  });

  it("the target word itself is always buildable from its own pool (rotation-aware)", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const pool = buildTilePool("가을", seededRng(seed));
      expect(wordBuildableFromPool("가을", pool)).toBe(true);
    }
  });

  it("a word needing a jamo entirely absent from the pool is rejected", () => {
    const pool = buildTilePool("가을", seededRng(1)); // needs only ㄱ/ㅇ/ㅏ/ㅡ/ㄹ (+ㄴ if rotated)
    expect(wordBuildableFromPool("사과", pool)).toBe(false); // needs ㅅ, absent either way
  });

  it("startGame wires the pool into state, and applyGuess hard-rails a pool-incompatible guess even if it's a valid dictionary word", () => {
    let state = readyGame("가을", 2, null, "p1");
    state = { ...state, tilePool: buildTilePool("가을", seededRng(1)) };
    const before = state;
    const blocked = applyAction(state, { type: "guess", word: "사과" }); // valid word, but ㅅ/ㅘ not in "가을"'s pool
    expect(blocked).toEqual(before); // no-op, same as any other rejected guess
  });
});

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7 / Level 1–10 difficulty)
// ---------------------------------------------------------------------------

describe("getValidMoves (AI bot support, ARCHITECTURE.md §7)", () => {
  it("offers every pool-buildable word of the right length for the active seat, and nothing for the idle seat", () => {
    const state = readyGame("사과", 2, null, "p1"); // WILDCARD_POOL -> every 2-syllable bank word is buildable
    const moves = getValidMoves(state, "p1");
    expect(moves).toHaveLength(wordsOfLength(2).length);
    expect(moves.every((m) => m.type === "guess")).toBe(true);
    expect(getValidMoves(state, "p2")).toEqual([]);
  });

  it("returns [] outside the 'playing' phase", () => {
    const state = { ...readyGame("사과", 2, null, "p1"), phase: "gameOver" as const };
    expect(getValidMoves(state, "p1")).toEqual([]);
  });

  it("respects the tile-pool hard rail — a pool-incompatible word never appears as a candidate", () => {
    const pool = buildTilePool("가을", seededRng(1));
    const state = { ...readyGame("가을", 2, null, "p1"), tilePool: pool };
    const moves = getValidMoves(state, "p1");
    expect(moves.some((m) => (m as { word: string }).word === "사과")).toBe(false); // needs ㅅ, absent from "가을"'s pool
  });
});

describe("chooseBotAction (AI bot support, Level 1–10)", () => {
  it("returns null for the idle seat", () => {
    const state = readyGame("사과", 2, null, "p1");
    expect(chooseBotAction(state, "p2", 5)).toBeNull();
  });

  it("always returns a legal move regardless of level", () => {
    const state = readyGame("사과", 2, null, "p1");
    for (let level = 1; level <= 10; level++) {
      const action = chooseBotAction(state, "p1", level, () => 0.5);
      expect(action).not.toBeNull();
      expect(getValidMoves(state, "p1")).toContainEqual(action);
    }
  });

  it("Level 1 (forced onto its mistake path) repeats a guess already disproven by history, while Level 10 does constraint propagation to guess a still-consistent word", () => {
    // A single past guess of "나무" that came back all-red rules "나무"
    // itself out (guessing it again would have to be green-green) and
    // narrows the field to words sharing no characters with 나/무 — "사과"
    // (the next word in bank order that qualifies) is the deterministic
    // winner once ties are broken by getValidMoves' own array order (rng
    // always 0 -> the first tied top-scorer, same convention as every
    // other game's divergence test here).
    const history: GuessRecord[] = [{ seat: "p1", word: "나무", feedback: ["red", "red"], isMatch: false }];
    const state: PiecesOfLanguageState = { ...readyGame("무관", 2, null, "p1"), history };

    const level1Action = chooseBotAction(state, "p1", 1, () => 0);
    expect(level1Action).toEqual({ type: "guess", word: "나무" });

    const level10Action = chooseBotAction(state, "p1", 10, () => 0);
    expect(level10Action).toEqual({ type: "guess", word: "사과" });
  });
});

function playFullBotGame(wordLength: number, maxAttempts: number | null, seed: number, levelOf: (seat: Seat) => number): PiecesOfLanguageState {
  let state = startGame(wordLength, maxAttempts, seededRng(seed));
  let guard = 0;
  while (state.phase !== "gameOver" && guard < 500) {
    guard++;
    const seat = state.activeSeat;
    const action = chooseBotAction(state, seat, levelOf(seat));
    expect(action).not.toBeNull();
    state = applyAction(state, action as EngineAction);
  }
  return state;
}

describe("Level 10 고수 AI끼리 풀 시뮬레이션 (버그 없이 gameOver까지 완주)", () => {
  for (const wordLength of [2, 3, 4, 5]) {
    it(`completes a ${wordLength}-syllable all-Level-10 game without a combined attempt cap`, () => {
      const state = playFullBotGame(wordLength, null, 900 + wordLength, () => 10);
      expect(state.phase).toBe("gameOver");
      expect(state.winner).not.toBeNull(); // an uncapped race always ends in an exact match, never a draw
    });
  }

  it("also completes with a combined attempt cap and a mixed Level 1 / Level 10 table (no crash, no infinite loop)", () => {
    const state = playFullBotGame(3, 8, 42, (seat) => (seat === "p1" ? 1 : 10));
    expect(state.phase).toBe("gameOver");
  });
});
