import { describe, expect, it } from "vitest";
import {
  applyAction,
  CARD_MAX,
  CARD_MIN,
  chooseBotAction,
  computeGroups,
  computePlayerScore,
  computeRankings,
  getValidMoves,
  MAX_PLAYERS,
  MIN_PLAYERS,
  REMOVE_COUNT,
  seededRng,
  startGame,
  startingChips,
  type NoThanksState,
  type PlayerState,
} from "./engine";

function makeState(overrides: Partial<NoThanksState> = {}): NoThanksState {
  const players: PlayerState[] = [
    { seat: 0, chips: 11, cards: [] },
    { seat: 1, chips: 11, cards: [] },
    { seat: 2, chips: 11, cards: [] },
  ];
  return {
    playerCount: 3,
    players,
    deck: [10, 11, 12],
    currentCard: 9,
    chipsOnCard: 0,
    activeSeat: 0,
    phase: "playing",
    removedCards: [],
    chipVisibility: "secret",
    ...overrides,
  };
}

describe("startGame — setup", () => {
  it("removes exactly 9 cards and deals a 24-card deck (deck + currentCard)", () => {
    const state = startGame(4, 1);
    expect(state.removedCards).toHaveLength(REMOVE_COUNT);
    expect(state.deck.length + 1).toBe(33 - REMOVE_COUNT); // +1 for currentCard already revealed
  });

  it("removed cards and dealt cards never overlap and together cover the full 3-35 range exactly once", () => {
    const state = startGame(5, 42);
    const dealt = [...state.deck, state.currentCard!];
    const all = [...state.removedCards, ...dealt].sort((a, b) => a - b);
    const expected = Array.from({ length: CARD_MAX - CARD_MIN + 1 }, (_, i) => i + CARD_MIN);
    expect(all).toEqual(expected);
    expect(new Set(all).size).toBe(expected.length); // no duplicates
  });

  it("is deterministic for a given seed", () => {
    const a = startGame(6, 777);
    const b = startGame(6, 777);
    expect(a).toEqual(b);
  });

  it("gives different removed-card sets for different seeds (sanity, not guaranteed but astronomically likely)", () => {
    const a = startGame(4, 1);
    const b = startGame(4, 2);
    expect(a.removedCards).not.toEqual(b.removedCards);
  });

  it("throws for unsupported player counts", () => {
    expect(() => startGame(2, 1)).toThrow();
    expect(() => startGame(8, 1)).toThrow();
    expect(MIN_PLAYERS).toBe(3);
    expect(MAX_PLAYERS).toBe(7);
  });

  it.each([
    [3, 11],
    [4, 11],
    [5, 11],
    [6, 9],
    [7, 7],
  ])("gives %i players %i starting chips each", (playerCount, chips) => {
    const state = startGame(playerCount, 1);
    expect(startingChips(playerCount)).toBe(chips);
    expect(state.players.every((p) => p.chips === chips)).toBe(true);
  });

  it("starts every player with an empty hand and reveals one current card with zero chips on it", () => {
    const state = startGame(3, 1);
    expect(state.players.every((p) => p.cards.length === 0)).toBe(true);
    expect(state.chipsOnCard).toBe(0);
    expect(state.currentCard).not.toBeNull();
    expect(state.phase).toBe("playing");
  });

  it("defaults to 'secret' chip visibility (the official rulebook mode) when not specified", () => {
    const state = startGame(4, 1);
    expect(state.chipVisibility).toBe("secret");
  });

  it("honors an explicit chip-visibility mode (host's rulebook §2 choice)", () => {
    expect(startGame(4, 1, "secret").chipVisibility).toBe("secret");
    expect(startGame(4, 1, "public").chipVisibility).toBe("public");
  });
});

describe("pass (No Thanks!)", () => {
  it("moves 1 chip from the active player onto the card and advances the turn", () => {
    const state = makeState({ activeSeat: 0 });
    const next = applyAction(state, { type: "pass", seat: 0 });
    expect(next.players[0].chips).toBe(10);
    expect(next.chipsOnCard).toBe(1);
    expect(next.activeSeat).toBe(1);
    expect(next.currentCard).toBe(9); // card itself doesn't change on a pass
  });

  it("wraps the turn back to seat 0 after the last seat passes", () => {
    const state = makeState({ activeSeat: 2, playerCount: 3 });
    const next = applyAction(state, { type: "pass", seat: 2 });
    expect(next.activeSeat).toBe(0);
  });

  it("is a no-op when it isn't that seat's turn", () => {
    const state = makeState({ activeSeat: 0 });
    const next = applyAction(state, { type: "pass", seat: 1 });
    expect(next).toEqual(state);
  });

  it("forces a take instead: passing with 0 chips is rejected as a no-op", () => {
    const state = makeState({
      players: [
        { seat: 0, chips: 0, cards: [] },
        { seat: 1, chips: 11, cards: [] },
        { seat: 2, chips: 11, cards: [] },
      ],
      activeSeat: 0,
    });
    const next = applyAction(state, { type: "pass", seat: 0 });
    expect(next).toEqual(state); // rejected — must call "take" instead
  });
});

describe("take (인수하기)", () => {
  it("gives the active player the card and every chip stacked on it", () => {
    const state = makeState({ activeSeat: 1, chipsOnCard: 3, currentCard: 9, deck: [10, 11] });
    const next = applyAction(state, { type: "take", seat: 1 });
    expect(next.players[1].cards).toEqual([9]);
    expect(next.players[1].chips).toBe(14); // 11 + 3
    expect(next.chipsOnCard).toBe(0);
  });

  it("immediately reveals the next deck card and gives the SAME player another turn", () => {
    const state = makeState({ activeSeat: 2, currentCard: 9, deck: [10, 11] });
    const next = applyAction(state, { type: "take", seat: 2 });
    expect(next.currentCard).toBe(10);
    expect(next.deck).toEqual([11]);
    expect(next.activeSeat).toBe(2); // unchanged — same player keeps going
    expect(next.phase).toBe("playing");
  });

  it("is a no-op when it isn't that seat's turn", () => {
    const state = makeState({ activeSeat: 0 });
    const next = applyAction(state, { type: "take", seat: 1 });
    expect(next).toEqual(state);
  });

  it("keeps cards sorted ascending as more are taken", () => {
    let state = makeState({
      activeSeat: 0,
      currentCard: 20,
      deck: [5],
      players: [
        { seat: 0, chips: 11, cards: [30] },
        { seat: 1, chips: 11, cards: [] },
        { seat: 2, chips: 11, cards: [] },
      ],
    });
    state = applyAction(state, { type: "take", seat: 0 });
    expect(state.players[0].cards).toEqual([20, 30]);
  });

  it("ends the game the instant the last deck card is taken", () => {
    const state = makeState({ activeSeat: 0, currentCard: 35, deck: [] });
    const next = applyAction(state, { type: "take", seat: 0 });
    expect(next.phase).toBe("gameOver");
    expect(next.currentCard).toBeNull();
    expect(next.players[0].cards).toEqual([35]);
  });
});

describe("full game exhaustion", () => {
  it("distributes exactly 24 cards total across all players by the time the game ends", () => {
    let state = startGame(4, 123);
    let guard = 0;
    while (state.phase === "playing" && guard < 500) {
      // Deterministic policy: always take. Guarantees termination regardless
      // of chip counts (taking never requires spending a chip).
      state = applyAction(state, { type: "take", seat: state.activeSeat });
      guard++;
    }
    expect(state.phase).toBe("gameOver");
    const totalCardsHeld = state.players.reduce((sum, p) => sum + p.cards.length, 0);
    expect(totalCardsHeld).toBe(33 - REMOVE_COUNT);
  });

  it("also terminates under a mixed pass/take policy without ever going negative on chips", () => {
    let state = startGame(3, 999);
    let guard = 0;
    while (state.phase === "playing" && guard < 1000) {
      const player = state.players[state.activeSeat];
      const action = player.chips > 0 && state.currentCard! % 2 === 0 ? "pass" : "take";
      state = applyAction(state, { type: action, seat: state.activeSeat });
      guard++;
    }
    expect(state.phase).toBe("gameOver");
    expect(state.players.every((p) => p.chips >= 0)).toBe(true);
    const totalCardsHeld = state.players.reduce((sum, p) => sum + p.cards.length, 0);
    expect(totalCardsHeld).toBe(33 - REMOVE_COUNT);
  });
});

describe("computeGroups — consecutive-run scoring", () => {
  it("treats a lone card as its own group", () => {
    expect(computeGroups([15])).toEqual([{ cards: [15], penaltyCard: 15 }]);
  });

  it("collapses a run of 3+ consecutive numbers into one group scored by the smallest", () => {
    // Rulebook's own worked example: 13,14,15,16 -> only 13 counts.
    expect(computeGroups([13, 14, 15, 16])).toEqual([{ cards: [13, 14, 15, 16], penaltyCard: 13 }]);
  });

  it("does NOT merge a run when the middle number is missing (removed at setup)", () => {
    // 21,22 would be consecutive, but 23 is missing so a lone 24 stays separate.
    expect(computeGroups([21, 22, 24])).toEqual([
      { cards: [21, 22], penaltyCard: 21 },
      { cards: [24], penaltyCard: 24 },
    ]);
  });

  it("handles unsorted input and multiple separate runs", () => {
    expect(computeGroups([9, 7, 8, 29, 28, 15])).toEqual([
      { cards: [7, 8, 9], penaltyCard: 7 },
      { cards: [15], penaltyCard: 15 },
      { cards: [28, 29], penaltyCard: 28 },
    ]);
  });

  it("returns an empty array for an empty hand", () => {
    expect(computeGroups([])).toEqual([]);
  });
});

describe("computePlayerScore — matches the rulebook's worked example exactly", () => {
  it("7,8,9,15,28,29 with 6 chips -> penalty 50, total 44", () => {
    const score = computePlayerScore({ seat: 0, chips: 6, cards: [7, 8, 9, 15, 28, 29] });
    expect(score.cardPenalty).toBe(50); // 7 + 15 + 28
    expect(score.total).toBe(44); // 50 - 6
    expect(score.groups).toHaveLength(3);
  });

  it("more chips can push the total below zero", () => {
    const score = computePlayerScore({ seat: 0, chips: 20, cards: [5] });
    expect(score.total).toBe(-15);
  });

  it("an empty hand scores 0 penalty minus chips", () => {
    const score = computePlayerScore({ seat: 0, chips: 4, cards: [] });
    expect(score.cardPenalty).toBe(0);
    expect(score.total).toBe(-4);
  });
});

describe("computeRankings", () => {
  it("ranks strictly by lower total first", () => {
    const state = makeState({
      players: [
        { seat: 0, chips: 5, cards: [10] }, // total 5
        { seat: 1, chips: 0, cards: [3] }, // total 3
        { seat: 2, chips: 2, cards: [20] }, // total 18
      ],
    });
    const rankings = computeRankings(state);
    expect(rankings.map((r) => r.seat)).toEqual([1, 0, 2]);
    expect(rankings.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("breaks a tied total by more remaining chips", () => {
    const state = makeState({
      players: [
        { seat: 0, chips: 10, cards: [15] }, // total 5
        { seat: 1, chips: 2, cards: [7] }, // total 5
        { seat: 2, chips: 11, cards: [30] }, // total 19
      ],
    });
    const rankings = computeRankings(state);
    // seat 0 has more chips than seat 1 despite an identical total -> ranks ahead
    expect(rankings[0].seat).toBe(0);
    expect(rankings[0].rank).toBe(1);
    expect(rankings[1].seat).toBe(1);
    expect(rankings[1].rank).toBe(2);
  });

  it("gives a true co-rank (standard competition ranking) when total AND chips are both equal", () => {
    const state = makeState({
      players: [
        { seat: 0, chips: 5, cards: [10] }, // total 5
        { seat: 1, chips: 5, cards: [10] }, // total 5, identical
        { seat: 2, chips: 0, cards: [20] }, // total 20
      ],
    });
    const rankings = computeRankings(state);
    const bySeat = Object.fromEntries(rankings.map((r) => [r.seat, r.rank]));
    expect(bySeat[0]).toBe(1);
    expect(bySeat[1]).toBe(1);
    expect(bySeat[2]).toBe(3); // standard competition ranking skips rank 2
  });
});

describe("getValidMoves (AI bot support, ARCHITECTURE.md §7)", () => {
  it("offers only the active seat both 'take' and 'pass' (chips remaining)", () => {
    const state = makeState();
    expect(getValidMoves(state, 0)).toEqual([{ type: "take", seat: 0 }, { type: "pass", seat: 0 }]);
    expect(getValidMoves(state, 1)).toEqual([]);
  });

  it("omits 'pass' once the seat is out of chips — 'take' is the only legal move", () => {
    const state = makeState({ players: [{ seat: 0, chips: 0, cards: [] }, { seat: 1, chips: 11, cards: [] }, { seat: 2, chips: 11, cards: [] }] });
    expect(getValidMoves(state, 0)).toEqual([{ type: "take", seat: 0 }]);
  });

  it("offers nothing once the game is over", () => {
    const state = makeState({ phase: "gameOver" });
    expect(getValidMoves(state, 0)).toEqual([]);
  });
});

describe("chooseBotAction (AI bot support, Level 1–10)", () => {
  it("returns null for a seat that isn't up", () => {
    const state = makeState();
    expect(chooseBotAction(state, 1, 5)).toBeNull();
  });

  it("is forced to take when out of chips, even with a costly unconnected card", () => {
    const state = makeState({
      currentCard: 30,
      chipsOnCard: 0,
      players: [{ seat: 0, chips: 0, cards: [] }, { seat: 1, chips: 11, cards: [] }, { seat: 2, chips: 11, cards: [] }],
    });
    expect(chooseBotAction(state, 0, 5)).toEqual({ type: "take", seat: 0 });
  });

  it("takes a card that connects to one already in hand, even with 0 chips on it", () => {
    const state = makeState({
      currentCard: 11,
      chipsOnCard: 0,
      players: [{ seat: 0, chips: 5, cards: [10] }, { seat: 1, chips: 11, cards: [] }, { seat: 2, chips: 11, cards: [] }],
    });
    // rng forced high enough to stay outside Level 5's ~12% mistake chance,
    // so this exercises the actual scored decision rather than the noise curve.
    expect(chooseBotAction(state, 0, 5, () => 0.99)).toEqual({ type: "take", seat: 0 });
  });

  it("passes on a big unconnected card with few chips on it and chips left to spend", () => {
    const state = makeState({ currentCard: 30, chipsOnCard: 1 });
    expect(chooseBotAction(state, 0, 5, () => 0.99)).toEqual({ type: "pass", seat: 0 });
  });

  it("takes a big card once enough chips have piled up on it", () => {
    const state = makeState({ currentCard: 20, chipsOnCard: 21 });
    expect(chooseBotAction(state, 0, 5, () => 0.99)).toEqual({ type: "take", seat: 0 });
  });

  it("always returns a legal move across every level", () => {
    const state = makeState({ currentCard: 30, chipsOnCard: 1 });
    for (let level = 1; level <= 10; level++) {
      const action = chooseBotAction(state, 0, level, () => 0.5);
      expect(action).not.toBeNull();
      expect(getValidMoves(state, 0)).toContainEqual(action);
    }
  });

  it("Level 1 (forced onto its mistake path) can pick the worse-scored move, while Level 10 always plays the top-scored one", () => {
    // Passing is clearly better here (score -1 vs. take's -29), so a
    // never-mistaken bot always passes.
    const state = makeState({ currentCard: 30, chipsOnCard: 1 });

    // rng() always 0 -> always below Level 1's ~55% mistake chance -> always
    // takes candidates[Math.floor(0 * length)] === candidates[0] === "take"
    // (getValidMoves lists "take" before "pass"), the worse-scored move.
    const level1Action = chooseBotAction(state, 0, 1, () => 0);
    expect(level1Action).toEqual({ type: "take", seat: 0 });

    // Level 10 has a 0% mistake chance and 0 tie margin -> always the true
    // argmax regardless of rng.
    const level10Action = chooseBotAction(state, 0, 10, () => 0);
    expect(level10Action).toEqual({ type: "pass", seat: 0 });
  });
});

function playFullBotGame(playerCount: number, seed: number, levelOf: (seat: number) => number) {
  let state = startGame(playerCount, seed);
  let guard = 0;
  while (state.phase !== "gameOver" && guard < 2000) {
    guard++;
    const action = chooseBotAction(state, state.activeSeat, levelOf(state.activeSeat));
    expect(action).not.toBeNull();
    state = applyAction(state, action!);
  }
  return state;
}

describe("Level 1–10 풀 시뮬레이션 (버그 없이 gameOver까지 완주)", () => {
  for (const level of [1, 4, 7, 10]) {
    it(`completes an all-Level-${level} game with a fully resolved final score`, () => {
      const state = playFullBotGame(4, 1000 + level, () => level);
      expect(state.phase).toBe("gameOver");
      const rankings = computeRankings(state);
      expect(rankings).toHaveLength(4);
      expect(new Set(rankings.map((r) => r.seat)).size).toBe(4);
    });
  }

  it("also completes with a mixed Level 1 / Level 10 table (no crash, no infinite loop)", () => {
    const state = playFullBotGame(5, 4242, (seat) => (seat % 2 === 0 ? 1 : 10));
    expect(state.phase).toBe("gameOver");
    expect(computeRankings(state)).toHaveLength(5);
  });
});

describe("Lv.8-10 마스터 EV 알고리즘 (연속 카드 정밀 처리 / 순손익 / 칩 고갈 방어)", () => {
  it("req③ 칩 고갈 방어: 같은 실질 손익(-2)이라도 칩이 넉넉하면 패스, 칩이 바닥나가면(1개) 먼저 수거해 충전한다", () => {
    // realTakeValue = chipsOnCard(8) - card(10) = -2 either way (no run connection).
    const abundant = makeState({
      currentCard: 10,
      chipsOnCard: 8,
      players: [{ seat: 0, chips: 11, cards: [] }, { seat: 1, chips: 11, cards: [] }, { seat: 2, chips: 11, cards: [] }],
    });
    expect(chooseBotAction(abundant, 0, 10, () => 0.5)).toEqual({ type: "pass", seat: 0 });

    const starving = makeState({
      currentCard: 10,
      chipsOnCard: 8,
      players: [{ seat: 0, chips: 1, cards: [] }, { seat: 1, chips: 11, cards: [] }, { seat: 2, chips: 11, cards: [] }],
    });
    expect(chooseBotAction(starving, 0, 10, () => 0.5)).toEqual({ type: "take", seat: 0 });
  });

  it("req② 순손익(Net Value): 칩이 충분히 쌓인 큰 카드는 실질 손익이 좋아지는 즉시 수거한다", () => {
    // 20번 카드 위에 21개 칩 -> 실질 손익 +1, 이미 pass(-1)보다 좋음.
    const state = makeState({ currentCard: 20, chipsOnCard: 21 });
    expect(chooseBotAction(state, 0, 10, () => 0.5)).toEqual({ type: "take", seat: 0 });
  });

  it("req① 연속 카드 정밀 처리: 이미 손에 든 카드와 이어지는 카드는 칩이 얼마나 쌓였든 즉시 수거한다(지연 없음)", () => {
    // 9를 들고 있는 상태에서 10이 뜨면 [9,10] 묶음 -> 벌점은 그대로 9, 실질손익 = +chipsOnCard.
    // (한때 "칩을 더 불릴 때까지 일부러 패스하고 버틴다"는 핑퐁 파밍을 시도했으나, 500게임
    // 시뮬레이션에서 자멸률이 오히려 6.0% -> 9.6~19.0%로 악화됨을 확인하고 폐기함 — 카드를
    // 가져가면 즉시 추가 턴이 오는 템포 이득을 포기하는 대가가 기대 칩 인상분보다 항상 컸음.
    // scoreMoveExpert 주석 참고.)
    const state = makeState({
      currentCard: 10,
      chipsOnCard: 2,
      players: [{ seat: 0, chips: 11, cards: [9] }, { seat: 1, chips: 11, cards: [] }, { seat: 2, chips: 11, cards: [] }],
    });
    expect(chooseBotAction(state, 0, 10, () => 0.5)).toEqual({ type: "take", seat: 0 });
  });

  it("연속 카드가 두 묶음 사이 간격을 메우면(병합) 지워지는 벌점까지 정확히 반영해 즉시 수거한다", () => {
    // [9] 묶음과 [11,12] 묶음을 [9,10,11,12]로 병합 -> 지워지는 11의 벌점만큼 실질손익이 더 커짐.
    const state = makeState({
      currentCard: 10,
      chipsOnCard: 0,
      players: [{ seat: 0, chips: 11, cards: [9, 11, 12] }, { seat: 1, chips: 11, cards: [] }, { seat: 2, chips: 11, cards: [] }],
    });
    expect(chooseBotAction(state, 0, 10, () => 0.5)).toEqual({ type: "take", seat: 0 });
  });

  it("Lv.1-7은 새 EV 로직의 영향을 받지 않고 기존 단순 휴리스틱 그대로 유지된다 (파밍/고갈방어 미적용)", () => {
    // req③ 테스트와 동일한 '칩 1개' 상황이지만 core tier(레벨 5)는 여전히 flat -1 pass 비용만 본다
    // -> take(-2) < pass(-1) 이므로 그대로 패스(칩이 남아있는 한 core tier는 강제 수거 로직이 없음).
    const state = makeState({
      currentCard: 10,
      chipsOnCard: 8,
      players: [{ seat: 0, chips: 1, cards: [] }, { seat: 1, chips: 11, cards: [] }, { seat: 2, chips: 11, cards: [] }],
    });
    expect(chooseBotAction(state, 0, 5, () => 0.99)).toEqual({ type: "pass", seat: 0 });
  });

  it("풀 시뮬레이션: 올-Lv.10 테이블은 자멸(칩 0개로 무너져 대형 벌점 카드를 강제 섭취해 최하위 확정)하지 않는다", () => {
    // 500개 시드(봇 rng도 시드 고정 — 재현 가능하도록)에 대해, 매 게임 최하위가 '칩 0개로
    // 마감 + 벌점 15점 이상'인 예전 버그의 특징적 패턴(칩을 다 쓰고 막판에 방어 불가능한 큰
    // 카드를 강제로 먹어 자멸)이 얼마나 드문지 측정한다.
    //
    // 실측 비교(같은 500시드, 같은 시드 고정 rng): 수정 전 6.8% -> 이 알고리즘 6.0%로 개선.
    // (참고: "핑퐁 파밍" 지연 전략까지 넣어봤을 땐 오히려 9.6~19.0%로 악화되는 것을 확인하고
    // 폐기했다 — scoreMoveExpert 주석 참고.) 노이즈 여유를 두고 12%를 상한으로 검증한다.
    const SEEDS = 500;
    let selfDestructedLastPlace = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      let state = startGame(4, seed);
      const rng = seededRng(seed * 999983 + 7);
      let guard = 0;
      while (state.phase !== "gameOver" && guard < 5000) {
        guard++;
        const action = chooseBotAction(state, state.activeSeat, 10, rng);
        if (!action) break;
        state = applyAction(state, action);
      }
      const rankings = computeRankings(state);
      const lastPlaceRank = Math.max(...rankings.map((r) => r.rank));
      for (const { rank, score } of rankings) {
        if (rank === lastPlaceRank && score.chips === 0 && score.cardPenalty >= 15) selfDestructedLastPlace++;
      }
    }
    expect(selfDestructedLastPlace).toBeLessThan(SEEDS * 0.12);
  });
});
