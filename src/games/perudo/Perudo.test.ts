import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import {
  applyAction,
  chooseBotAction,
  computeRankings,
  countMatching,
  getValidMoves,
  minValidQuantityForFace,
  MIN_PLAYERS,
  MAX_PLAYERS,
  STARTING_DICE,
  startGame,
  totalDiceInPlay,
  trackCellAt,
  trackCellForBid,
  validateRaise,
  type Bid,
  type Face,
  type PerudoState,
  type PlayerState,
} from "./engine";

function makeState(overrides: Partial<PerudoState> = {}): PerudoState {
  const players: PlayerState[] = [
    { seat: 0, diceCount: 5, dice: [1, 2, 3, 4, 5] },
    { seat: 1, diceCount: 5, dice: [1, 2, 3, 4, 5] },
    { seat: 2, diceCount: 5, dice: [1, 2, 3, 4, 5] },
  ];
  return {
    playerCount: 3,
    players,
    currentBid: null,
    activeSeat: 0,
    roundStarter: 0,
    roundNumber: 1,
    phase: "playing",
    lastResolution: null,
    eliminationOrder: [],
    winnerSeat: null,
    ...overrides,
  };
}


describe("startGame — setup", () => {
  it("deals 5 dice to every player and picks a starter within range", () => {
    const state = startGame(4, 1);
    expect(state.players).toHaveLength(4);
    expect(state.players.every((p) => p.diceCount === STARTING_DICE && p.dice.length === STARTING_DICE)).toBe(true);
    expect(state.players.every((p) => p.dice.every((d) => d >= 1 && d <= 6))).toBe(true);
    expect(state.activeSeat).toBeGreaterThanOrEqual(0);
    expect(state.activeSeat).toBeLessThan(4);
    expect(state.roundStarter).toBe(state.activeSeat);
    expect(state.currentBid).toBeNull();
    expect(state.phase).toBe("playing");
    expect(state.roundNumber).toBe(1);
    expect(totalDiceInPlay(state)).toBe(4 * STARTING_DICE);
  });

  it("is deterministic for a given seed", () => {
    const a = startGame(5, 42);
    const b = startGame(5, 42);
    expect(a).toEqual(b);
  });

  it("throws for unsupported player counts", () => {
    expect(() => startGame(1, 1)).toThrow();
    expect(() => startGame(9, 1)).toThrow();
    expect(MIN_PLAYERS).toBe(2);
    expect(MAX_PLAYERS).toBe(8);
  });

  it("supports the full 8-player table (extends beyond the physical box's 6 cups)", () => {
    const state = startGame(8, 1);
    expect(state.players).toHaveLength(8);
    expect(totalDiceInPlay(state)).toBe(8 * STARTING_DICE);
  });
});

// ---------------------------------------------------------------------------
// 2026-08-21 "수정필요1" 30칸 실물 보드 세션 (see engine.ts's module doc for
// the full history + the exact 30-slot sequence from
// `boardGameRule/페루도/수정필요1.png`): `trackCellForBid`/`trackCellAt` are
// still pure, stateless functions of (quantity, face) / (index) — but as of
// this session they are ALSO the sole authority `validateRaise` (tested
// below) reduces to. This describe block only locks down the mapping itself;
// legality is its own describe block further down.
// ---------------------------------------------------------------------------
describe("trackCellForBid / trackCellAt — 30-slot 실물 보드 트랙 매핑", () => {
  // The exact 30 labels from the user's spec, index 0 through 29.
  const EXPECTED_30: Array<{ kind: "normal" | "perudo"; quantity: number }> = [
    { kind: "normal", quantity: 1 }, // 0: 숫자 1
    { kind: "perudo", quantity: 1 }, // 1: 페루도 1
    { kind: "normal", quantity: 2 }, // 2: 숫자 2
    { kind: "normal", quantity: 3 }, // 3: 숫자 3
    { kind: "perudo", quantity: 2 }, // 4: 페루도 2
    { kind: "normal", quantity: 4 }, // 5: 숫자 4
    { kind: "normal", quantity: 5 }, // 6: 숫자 5
    { kind: "perudo", quantity: 3 }, // 7: 페루도 3
    { kind: "normal", quantity: 6 }, // 8: 숫자 6
    { kind: "normal", quantity: 7 }, // 9: 숫자 7
    { kind: "perudo", quantity: 4 }, // 10: 페루도 4
    { kind: "normal", quantity: 8 }, // 11: 숫자 8
    { kind: "normal", quantity: 9 }, // 12: 숫자 9
    { kind: "perudo", quantity: 5 }, // 13: 페루도 5
    { kind: "normal", quantity: 10 }, // 14: 숫자 10
    { kind: "normal", quantity: 11 }, // 15: 숫자 11
    { kind: "perudo", quantity: 6 }, // 16: 페루도 6
    { kind: "normal", quantity: 12 }, // 17: 숫자 12
    { kind: "normal", quantity: 13 }, // 18: 숫자 13
    { kind: "perudo", quantity: 7 }, // 19: 페루도 7
    { kind: "normal", quantity: 14 }, // 20: 숫자 14
    { kind: "normal", quantity: 15 }, // 21: 숫자 15
    { kind: "perudo", quantity: 8 }, // 22: 페루도 8
    { kind: "normal", quantity: 16 }, // 23: 숫자 16
    { kind: "normal", quantity: 17 }, // 24: 숫자 17
    { kind: "perudo", quantity: 9 }, // 25: 페루도 9
    { kind: "normal", quantity: 18 }, // 26: 숫자 18
    { kind: "normal", quantity: 19 }, // 27: 숫자 19
    { kind: "perudo", quantity: 10 }, // 28: 페루도 10
    { kind: "normal", quantity: 20 }, // 29: 숫자 20
  ];

  it("trackCellAt reproduces the exact 30-slot sequence from 수정필요1.png (index 0-29)", () => {
    EXPECTED_30.forEach((expected, index) => {
      expect(trackCellAt(index)).toEqual({ index, ...expected });
    });
  });

  it("trackCellForBid maps every (quantity, face) bid onto the same 30-slot sequence", () => {
    EXPECTED_30.forEach(({ kind, quantity }, index) => {
      const face: Face = kind === "perudo" ? 1 : 2;
      expect(trackCellForBid({ quantity, face })).toEqual({ index, kind, quantity });
    });
  });

  it("faces 2-6 all share the exact same normal cell for a given quantity", () => {
    const faces: Face[] = [2, 3, 4, 5, 6];
    const cells = faces.map((face) => trackCellForBid({ quantity: 3, face }));
    for (const cell of cells) expect(cell).toEqual({ index: 3, kind: "normal", quantity: 3 });
  });

  it("is strictly monotonic in quantity within each kind — every higher quantity lands on a strictly later index", () => {
    for (let q = 1; q < 60; q++) {
      expect(trackCellForBid({ quantity: q + 1, face: 2 }).index).toBeGreaterThan(trackCellForBid({ quantity: q, face: 2 }).index);
      expect(trackCellForBid({ quantity: q + 1, face: 1 }).index).toBeGreaterThan(trackCellForBid({ quantity: q, face: 1 }).index);
    }
  });

  it("has no upper bound — extends past the physical board's 30 slots (uncapped dice counts) with the same closed-form pattern", () => {
    // Quantity 21 (odd, one past the physical board's last cell at quantity 20/index 29).
    expect(trackCellForBid({ quantity: 21, face: 4 })).toEqual({ index: 30, kind: "normal", quantity: 21 });
    // Quantity 500 (even): index = 3*(500/2) - 1 = 749.
    expect(trackCellForBid({ quantity: 500, face: 3 })).toEqual({ index: 749, kind: "normal", quantity: 500 });
  });

  it("trackCellAt is the exact inverse of trackCellForBid, including past the physical board's 30 slots", () => {
    for (let index = 0; index < 90; index++) {
      const cell = trackCellAt(index);
      expect(cell.index).toBe(index);
      expect(trackCellForBid({ quantity: cell.quantity, face: cell.kind === "perudo" ? 1 : 2 })).toEqual(cell);
    }
  });
});

// ---------------------------------------------------------------------------
// 2026-08-21 "버그3" 회귀: `boardGameRule/페루도/버그3.png`가 신고한 증상은
// `trackCellForBid`/`validateRaise` 자체의 버그가 아니라 `PerudoBoard.tsx`의
// UI 초안(draft) 기본값이 "다음 최소 합법 인상"(quantity+1)으로 미리 밀려
// 있어, 상대의 실제 확정 비딩(예: 2가 2개)과 보드 마커가 어긋나 보이던
// 문제였다(수정은 PerudoBoard.tsx의 bid-composer 기본값 쪽 — 여기 아래
// 테스트들은 그 수정이 딛고 서는 엔진 계약(마커 매핑이 실제 비딩 그대로를
// 정확히 가리키는지, 동일 비딩이 항상 거절되는지, 동일 수량에서 눈금
// 상향이 항상 허용되는지)이 깨지지 않았음을 고정한다.
// ---------------------------------------------------------------------------
describe("버그3 회귀 — 마커 위치 매핑 및 동일 비딩 거절/눈금 상향 허용", () => {
  it("currentBid = { quantity: 2, face: 2 } 는 정확히 '수량 2' 슬롯(인덱스 2, normal)에 매핑된다", () => {
    expect(trackCellForBid({ quantity: 2, face: 2 })).toEqual({ index: 2, kind: "normal", quantity: 2 });
  });

  it("동일 배팅 { quantity: 2, face: 2 } 재선언은 항상 거절된다", () => {
    const prev: Bid = { seat: 0, quantity: 2, face: 2 };
    expect(validateRaise(prev, { quantity: 2, face: 2 })).toBe(false);
  });

  it("같은 수량(2)에서 눈금만 3~6으로 올리는 재선언은 전부 허용된다", () => {
    const prev: Bid = { seat: 0, quantity: 2, face: 2 };
    const faces: Face[] = [3, 4, 5, 6];
    for (const face of faces) expect(validateRaise(prev, { quantity: 2, face })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2026-08-21 "수정필요1" 30칸 실물 보드 세션 (AskUserQuestion-confirmed "트랙
// 인덱스로 완전 대체" — see engine.ts's module doc): `validateRaise` no
// longer implements the old rulebook §3 formulas (`⌈prev/2⌉`/`prev*2+1` for
// normal↔paco conversions) at all — it's now a pure `trackIndexForBid`
// comparison. The board track is the judge now, not a display-only layer.
// ---------------------------------------------------------------------------
describe("validateRaise — 30칸 트랙 인덱스 비교가 유일한 판정 근거", () => {
  it("always accepts the round's opening bid", () => {
    expect(validateRaise(null, { quantity: 1, face: 1 })).toBe(true);
    expect(validateRaise(null, { quantity: 99, face: 6 })).toBe(true);
  });

  it("rejects an out-of-range face or non-positive quantity", () => {
    expect(validateRaise(null, { quantity: 1, face: 0 as Face })).toBe(false);
    expect(validateRaise(null, { quantity: 1, face: 7 as Face })).toBe(false);
    expect(validateRaise(null, { quantity: 0, face: 3 })).toBe(false);
  });

  describe("normal(2-6) -> normal(2-6) — identical to the old formula for this direction (index is a bijection of quantity)", () => {
    const prev: Bid = { seat: 0, quantity: 4, face: 3 };
    it("quantity up, face unchanged or changed — both allowed", () => {
      expect(validateRaise(prev, { quantity: 5, face: 3 })).toBe(true);
      expect(validateRaise(prev, { quantity: 5, face: 5 })).toBe(true);
    });
    it("same quantity, higher face — allowed (same track cell, rule 2)", () => {
      expect(validateRaise(prev, { quantity: 4, face: 4 })).toBe(true);
      expect(validateRaise(prev, { quantity: 4, face: 6 })).toBe(true);
    });
    it("same quantity, lower or equal face — rejected", () => {
      expect(validateRaise(prev, { quantity: 4, face: 2 })).toBe(false);
      expect(validateRaise(prev, { quantity: 4, face: 3 })).toBe(false);
    });
    it("lower quantity — always rejected regardless of face", () => {
      expect(validateRaise(prev, { quantity: 3, face: 6 })).toBe(false);
    });
  });

  // "버그2" 재현 케이스: 눈금 2 · 수량 1 선언 뒤, 동일 수량(1)에서 눈금만
  // 3/4/5/6으로 올리는 비딩 전부가 합법이어야 한다.
  it("버그2: quantity:1,face:2 다음 동일 수량 1에서 face 3/4/5/6은 전부 합법, face<=2는 거절", () => {
    const prev: Bid = { seat: 0, quantity: 1, face: 2 };
    expect(validateRaise(prev, { quantity: 1, face: 3 })).toBe(true);
    expect(validateRaise(prev, { quantity: 1, face: 4 })).toBe(true);
    expect(validateRaise(prev, { quantity: 1, face: 5 })).toBe(true);
    expect(validateRaise(prev, { quantity: 1, face: 6 })).toBe(true);
    expect(validateRaise(prev, { quantity: 1, face: 2 })).toBe(false); // 같은 눈금은 상향이 아님
    // face:1(조커)은 별도 트랙 칸([페루도 1], index 1)이라 "같은 칸" 비교가
    // 아니라 rule 1(인덱스 증가)로 판정된다 — 숫자1(index 0)보다 크므로 합법.
    expect(validateRaise(prev, { quantity: 1, face: 1 })).toBe(true);
    // 눈금 3 다음 곧바로 눈금 6으로도(중간 단계를 거치지 않고) 갈 수 있다.
    expect(validateRaise({ seat: 0, quantity: 1, face: 3 }, { quantity: 1, face: 6 })).toBe(true);
  });

  // ---------------------------------------------------------------------
  // 요청하신 필수 회귀 케이스: "3이 2개 이상"(quantity: 2, face: 3 — 숫자2
  // 슬롯, index 2)에 배팅된 상태에서 트랙상 더 앞선(인덱스가 낮은) 칸으로
  // 역행하는 비딩은 전부 완전히 선택 불가능해야 한다.
  // ---------------------------------------------------------------------
  describe("역행 비딩 원천 차단 — quantity: 2, face: 3 (숫자2 슬롯, index 2) 기준", () => {
    const prev: Bid = { seat: 0, quantity: 2, face: 3 };

    it("페루도 1(quantity: 1, face: 1, index 1)로 비딩 시도 — isValidBid === false", () => {
      expect(validateRaise(prev, { quantity: 1, face: 1 })).toBe(false);
    });

    it("숫자 1(quantity: 1, face: 아무 2-6, index 0)로 비딩 시도 — isValidBid === false", () => {
      expect(validateRaise(prev, { quantity: 1, face: 4 })).toBe(false);
    });

    it("페루도 2(quantity: 2, face: 1, index 4)로 비딩 시도 — isValidBid === true", () => {
      expect(validateRaise(prev, { quantity: 2, face: 1 })).toBe(true);
    });

    it("숫자 4(quantity: 4, face: 아무 2-6, index 5)로 비딩 시도 — isValidBid === true", () => {
      expect(validateRaise(prev, { quantity: 4, face: 2 })).toBe(true);
      expect(validateRaise(prev, { quantity: 4, face: 6 })).toBe(true);
    });

    it("같은 슬롯(숫자2)에서 눈금 상향은 여전히 허용, 눈금 하향/동일은 거절", () => {
      expect(validateRaise(prev, { quantity: 2, face: 4 })).toBe(true);
      expect(validateRaise(prev, { quantity: 2, face: 2 })).toBe(false);
      expect(validateRaise(prev, { quantity: 2, face: 3 })).toBe(false); // 동일 배팅
    });
  });

  describe("normal <-> perudo — 옛 ⌈Q/2⌉/2Q+1 공식과 다르게 동작하는 지점 (AskUserQuestion-confirmed)", () => {
    it("normal -> perudo: 옛 공식(⌈5/2⌉=3)과 우연히 같은 결과가 나오는 경우도 있다", () => {
      const prev: Bid = { seat: 0, quantity: 5, face: 4 }; // index 6
      expect(validateRaise(prev, { quantity: 3, face: 1 })).toBe(true); // 페루도3 index 7 > 6
      expect(validateRaise(prev, { quantity: 2, face: 1 })).toBe(false); // 페루도2 index 4 < 6
    });

    it("normal -> perudo: 트랙 규칙이 옛 ⌈Q/2⌉ 공식보다 더 엄격한 지점 — 페루도1은 옛 공식으론 합법이었지만 이제 거절된다", () => {
      const prev: Bid = { seat: 0, quantity: 2, face: 3 }; // index 2 — 옛 공식: ceil(2/2)=1이라 페루도1도 합법이었음
      expect(validateRaise(prev, { quantity: 1, face: 1 })).toBe(false); // 페루도1 index 1 < 2 — 이제 거절
    });

    it("paco -> paco: quantity must strictly increase", () => {
      const prev: Bid = { seat: 0, quantity: 2, face: 1 };
      expect(validateRaise(prev, { quantity: 3, face: 1 })).toBe(true);
      expect(validateRaise(prev, { quantity: 2, face: 1 })).toBe(false);
    });

    it("paco -> normal: 트랙 규칙이 옛 2Q+1 공식보다 더 관대한 지점 — 옛 공식은 수량 5가 필요했지만 트랙 규칙은 수량 4로도 충분하다", () => {
      const prev: Bid = { seat: 0, quantity: 2, face: 1 }; // 페루도2, index 4
      expect(validateRaise(prev, { quantity: 4, face: 6 })).toBe(true); // 숫자4 index 5 > 4 — 트랙 규칙으론 합법
      expect(validateRaise(prev, { quantity: 3, face: 2 })).toBe(false); // 숫자3 index 3 < 4 — 여전히 거절
      expect(validateRaise(prev, { quantity: 5, face: 2 })).toBe(true); // 숫자5 index 6 > 4 — 옛 공식(2*2+1=5)과도 일치
    });
  });
});

describe("minValidQuantityForFace", () => {
  it("is 1 for the opening bid, any face", () => {
    expect(minValidQuantityForFace(null, 2)).toBe(1);
    expect(minValidQuantityForFace(null, 1)).toBe(1);
  });
  it("matches the same-quantity-higher-face allowance for a normal prev bid", () => {
    const prev: Bid = { seat: 0, quantity: 1, face: 2 };
    expect(minValidQuantityForFace(prev, 3)).toBe(1); // same quantity, higher face still legal
    expect(minValidQuantityForFace(prev, 2)).toBe(2); // same face needs a higher quantity
  });
});

describe("countMatching", () => {
  const players: PlayerState[] = [
    { seat: 0, diceCount: 3, dice: [1, 4, 4] },
    { seat: 1, diceCount: 2, dice: [4, 6] },
  ];
  it("counts 1s (페루도) as wild for any other face — always, no more Palafico exception (2026-08-17 룰북 정리)", () => {
    expect(countMatching(players, 4)).toBe(4); // three real 4s + one wild 1
  });
  it("counting face 1 itself never double-counts via the wild branch", () => {
    expect(countMatching(players, 1)).toBe(1);
  });
});

describe("raise (action)", () => {
  it("is a no-op when it isn't that seat's turn", () => {
    const state = makeState({ activeSeat: 0 });
    const next = applyAction(state, { type: "raise", seat: 1, quantity: 3, face: 4 });
    expect(next).toEqual(state);
  });

  it("is a no-op for an invalid raise (lower quantity, regardless of face)", () => {
    const state = makeState({
      activeSeat: 0,
      currentBid: { seat: 2, quantity: 4, face: 3 },
    });
    const next = applyAction(state, { type: "raise", seat: 0, quantity: 3, face: 6 });
    expect(next).toEqual(state);
  });

  it("updates currentBid and advances to the next alive seat", () => {
    const state = makeState({ activeSeat: 0 });
    const next = applyAction(state, { type: "raise", seat: 0, quantity: 2, face: 3 });
    expect(next.currentBid).toEqual({ seat: 0, quantity: 2, face: 3 });
    expect(next.activeSeat).toBe(1);
  });

  it("same quantity, strictly higher face is a legal raise (버그2 회귀 — the old board-track house rule couldn't express this at all)", () => {
    const state = makeState({
      activeSeat: 0,
      currentBid: { seat: 1, quantity: 1, face: 2 },
    });
    const next = applyAction(state, { type: "raise", seat: 0, quantity: 1, face: 5 });
    expect(next.currentBid).toEqual({ seat: 0, quantity: 1, face: 5 });
  });

  it("skips eliminated seats when advancing", () => {
    const state = makeState({
      activeSeat: 0,
      players: [
        { seat: 0, diceCount: 5, dice: [1, 2, 3, 4, 5] },
        { seat: 1, diceCount: 0, dice: [] },
        { seat: 2, diceCount: 5, dice: [1, 2, 3, 4, 5] },
      ],
    });
    const next = applyAction(state, { type: "raise", seat: 0, quantity: 2, face: 3 });
    expect(next.activeSeat).toBe(2);
  });
});

describe("dudo (페루도!)", () => {
  it("is a no-op without a pending bid", () => {
    const state = makeState({ activeSeat: 1, currentBid: null });
    const next = applyAction(state, { type: "dudo", seat: 1 });
    expect(next).toEqual(state);
  });

  it("is a no-op when it isn't that seat's turn", () => {
    const state = makeState({
      activeSeat: 0,
      currentBid: { seat: 2, quantity: 3, face: 4 },
    });
    const next = applyAction(state, { type: "dudo", seat: 1 });
    expect(next).toEqual(state);
  });

  it("penalizes the bidder by the exact shortfall when the bid was too high (rulebook §4①: 선언 개수 - 실제 개수)", () => {
    // Table has three 4s + no 1s = 3 actual, but seat 2 bid 5 -> shortfall of 2.
    const state = makeState({
      activeSeat: 0,
      currentBid: { seat: 2, quantity: 5, face: 4 },
      players: [
        { seat: 0, diceCount: 5, dice: [4, 4, 2, 3, 5] },
        { seat: 1, diceCount: 5, dice: [4, 2, 2, 3, 5] },
        { seat: 2, diceCount: 5, dice: [2, 2, 3, 3, 5] },
      ],
    });
    const next = applyAction(state, { type: "dudo", seat: 0 });
    expect(next.players.find((p) => p.seat === 2)!.diceCount).toBe(3); // 5 - (5-3) = 3
    expect(next.lastResolution).toMatchObject({ kind: "dudo", actorSeat: 0, affectedSeat: 2, diceDelta: -2, actualCount: 3 });
    expect(next.phase).toBe("reveal");
    expect(next.roundStarter).toBe(2); // penalized player leads the next round
  });

  it("penalizes the doubter by the exact overshoot+1 when the bid was accurate or conservative (rulebook §4①: 실제 개수 - 선언 개수 + 1)", () => {
    const state = makeState({
      activeSeat: 0,
      currentBid: { seat: 2, quantity: 2, face: 4 },
      players: [
        { seat: 0, diceCount: 5, dice: [4, 4, 2, 3, 5] },
        { seat: 1, diceCount: 5, dice: [4, 2, 2, 3, 5] },
        { seat: 2, diceCount: 5, dice: [2, 2, 3, 3, 5] },
      ],
    });
    const next = applyAction(state, { type: "dudo", seat: 0 });
    expect(next.players.find((p) => p.seat === 0)!.diceCount).toBe(3); // 5 - (3-2+1) = 3
    expect(next.lastResolution).toMatchObject({ affectedSeat: 0, diceDelta: -2 });
    expect(next.roundStarter).toBe(0);
  });

  it("matches the rulebook's worked example — 5개 선언, 실제 2개면 3개 상실", () => {
    const state = makeState({
      activeSeat: 0,
      currentBid: { seat: 2, quantity: 5, face: 4 },
      players: [
        { seat: 0, diceCount: 5, dice: [4, 4, 2, 3, 5] },
        { seat: 1, diceCount: 5, dice: [2, 2, 3, 3, 5] },
        { seat: 2, diceCount: 5, dice: [2, 2, 3, 3, 5] },
      ],
    });
    const next = applyAction(state, { type: "dudo", seat: 0 });
    expect(next.lastResolution).toMatchObject({ actualCount: 2, diceDelta: -3 });
    expect(next.players.find((p) => p.seat === 2)!.diceCount).toBe(2); // 5 - 3
  });

  it("ends the game once only one player has dice left", () => {
    const state = makeState({
      playerCount: 2,
      activeSeat: 0,
      currentBid: { seat: 1, quantity: 6, face: 4 },
      players: [
        { seat: 0, diceCount: 1, dice: [4] },
        { seat: 1, diceCount: 1, dice: [2] },
      ],
    });
    const next = applyAction(state, { type: "dudo", seat: 0 });
    expect(next.phase).toBe("gameOver");
    expect(next.winnerSeat).toBe(0);
    expect(next.eliminationOrder).toEqual([1]);
  });

  // 2026-08-17 룰북 정리: 팔라피코(Palafico) 특수 라운드가 최신 룰북에서
  // 완전히 삭제됐다 — 라운드 선의 주사위가 1개뿐이어도 조커(1) 기능이 그대로
  // 살아있는 일반 라운드와 동일하게 진행돼야 한다(이전엔 이 상황에서 1이
  // 와일드로 집계되지 않는 특수 분기를 탔었다).
  it("a round starter with only 1 die left still plays a normal round — 1 still counts as wild, no Palafico branch", () => {
    const state = makeState({
      roundStarter: 0,
      activeSeat: 1,
      currentBid: { seat: 0, quantity: 2, face: 4 },
      players: [
        { seat: 0, diceCount: 1, dice: [4] },
        { seat: 1, diceCount: 5, dice: [1, 2, 3, 5, 6] }, // one wild 1
        { seat: 2, diceCount: 5, dice: [2, 2, 3, 3, 5] },
      ],
    });
    const next = applyAction(state, { type: "dudo", seat: 1 });
    // Real 4s (just seat 0's) + seat 1's wild 1 = 2, matching the bid exactly
    // -> bid held up, so the doubter (seat 1) is penalized, not the bidder.
    expect(next.lastResolution?.actualCount).toBe(2);
    expect(next.lastResolution).not.toHaveProperty("wasPalafico");
    expect(next.players.find((p) => p.seat === 1)!.diceCount).toBe(4); // 5 - (2-2+1) = 4
  });
});

describe("calza (맞아!)", () => {
  it("is not restricted to the active seat", () => {
    const state = makeState({
      activeSeat: 0,
      currentBid: { seat: 2, quantity: 2, face: 4 },
      players: [
        { seat: 0, diceCount: 5, dice: [4, 4, 2, 3, 5] },
        { seat: 1, diceCount: 5, dice: [1, 2, 2, 3, 5] },
        { seat: 2, diceCount: 5, dice: [2, 2, 3, 3, 5] },
      ],
    });
    // seat 1 calls calza even though it's seat 0's turn.
    const next = applyAction(state, { type: "calza", seat: 1 });
    expect(next.phase).toBe("reveal");
  });

  // 2026-08-17 룰북 정리: "맞아!" 성공 시 되찾는 주사위 개수 상한(구 MAX_DICE=5
  // 캡)이 완전히 제거됐다 — 이미 5개를 보유한 채로 성공하면 6개 이상으로도
  // 정상 누적돼야 한다(최신 룰북 문구: "최대 개수 제한없음").
  it("regains a die on an exact match with NO upper cap — 5개 보유 상태에서 성공하면 6개로 증가한다", () => {
    const state = makeState({
      currentBid: { seat: 2, quantity: 2, face: 4 },
      players: [
        { seat: 0, diceCount: 5, dice: [4, 4, 2, 3, 5] },
        { seat: 1, diceCount: 5, dice: [2, 2, 3, 3, 5] },
        { seat: 2, diceCount: 5, dice: [2, 2, 3, 3, 5] },
      ],
    });
    const next = applyAction(state, { type: "calza", seat: 0 });
    expect(next.lastResolution).toMatchObject({ kind: "calza", diceDelta: 1, actualCount: 2 });
    expect(next.players.find((p) => p.seat === 0)!.diceCount).toBe(6); // was already at 5, uncapped -> 6
  });

  it("keeps regaining dice past 6, 7, 8... across repeated exact-match successes — genuinely unbounded", () => {
    let state = makeState({
      currentBid: { seat: 2, quantity: 2, face: 4 },
      players: [
        { seat: 0, diceCount: 5, dice: [4, 4, 2, 3, 5] },
        { seat: 1, diceCount: 5, dice: [2, 2, 3, 3, 5] },
        { seat: 2, diceCount: 5, dice: [2, 2, 3, 3, 5] },
      ],
    });
    for (let i = 0; i < 4; i++) {
      state = applyAction(state, { type: "calza", seat: 0 });
      // calza moves the game to "reveal"; reset back to "playing" with the
      // same fixed dice/bid (rather than going through `continue`, whose
      // random reroll would make the "exact match" setup unreliable across
      // iterations) so the next calza call in the loop has something
      // identical to act on again.
      state = { ...state, phase: "playing", currentBid: { seat: 2, quantity: 2, face: 4 } };
    }
    expect(state.players.find((p) => p.seat === 0)!.diceCount).toBe(9); // 5 + four successive +1s, no cap
  });

  it("loses dice equal to the exact absolute margin on a wrong call (rulebook §4②: |실제 개수 - 선언 개수|)", () => {
    // face-4 count: seat0's two 4s + seat1's wild 1 = 3 actual, bid was 5 -> |3-5| = 2.
    const state = makeState({
      currentBid: { seat: 2, quantity: 5, face: 4 },
      players: [
        { seat: 0, diceCount: 5, dice: [4, 4, 2, 3, 5] },
        { seat: 1, diceCount: 5, dice: [1, 2, 2, 3, 5] },
        { seat: 2, diceCount: 5, dice: [2, 2, 3, 3, 5] },
      ],
    });
    const next = applyAction(state, { type: "calza", seat: 0 });
    expect(next.lastResolution).toMatchObject({ actualCount: 3, diceDelta: -2 });
    expect(next.players.find((p) => p.seat === 0)!.diceCount).toBe(3);
  });

  it("matches the rulebook's worked example — 4개라 외쳤으나 실제 7개면 3개 상실", () => {
    const state = makeState({
      currentBid: { seat: 2, quantity: 4, face: 4 },
      players: [
        { seat: 0, diceCount: 5, dice: [4, 4, 4, 4, 5] },
        { seat: 1, diceCount: 5, dice: [4, 4, 4, 3, 5] },
        { seat: 2, diceCount: 5, dice: [2, 2, 3, 3, 5] },
      ],
    });
    const next = applyAction(state, { type: "calza", seat: 0 });
    expect(next.lastResolution).toMatchObject({ actualCount: 7, diceDelta: -3 });
    expect(next.players.find((p) => p.seat === 0)!.diceCount).toBe(2); // 5 - 3
  });

  it("clamps the loss at 0 dice rather than going negative when the margin exceeds the caller's stock", () => {
    const state = makeState({
      currentBid: { seat: 2, quantity: 30, face: 4 }, // exaggerated quantity via direct state override, purely to exercise the "margin exceeds stock" clamp
      players: [
        { seat: 0, diceCount: 2, dice: [4, 5] },
        { seat: 1, diceCount: 5, dice: [2, 2, 3, 3, 5] },
        { seat: 2, diceCount: 5, dice: [2, 2, 3, 3, 5] },
      ],
    });
    const next = applyAction(state, { type: "calza", seat: 0 });
    expect(next.lastResolution).toMatchObject({ actualCount: 1, diceDelta: -29 });
    expect(next.players.find((p) => p.seat === 0)!.diceCount).toBe(0);
  });

  // 2026-08-17 룰북 정리: 팔라피코가 완전히 삭제됐으므로, 라운드 선의 주사위가
  // 1개뿐이어도 "맞아!"는 다른 라운드와 똑같이 허용돼야 한다(이전엔 여기서
  // 거절되는 특수 분기가 있었다).
  it("is still allowed even when the round starter has only 1 die left (no more Palafico restriction)", () => {
    const state = makeState({
      roundStarter: 0,
      currentBid: { seat: 0, quantity: 1, face: 4 },
      players: [
        { seat: 0, diceCount: 1, dice: [4] },
        { seat: 1, diceCount: 5, dice: [1, 2, 2, 3, 5] },
        { seat: 2, diceCount: 5, dice: [2, 2, 3, 3, 5] },
      ],
    });
    const next = applyAction(state, { type: "calza", seat: 1 });
    expect(next.phase).toBe("reveal");
    expect(next.lastResolution?.kind).toBe("calza");
  });

  it("is a no-op for a seat that's already eliminated", () => {
    const state = makeState({
      currentBid: { seat: 2, quantity: 2, face: 4 },
      players: [
        { seat: 0, diceCount: 0, dice: [] },
        { seat: 1, diceCount: 5, dice: [1, 2, 2, 3, 5] },
        { seat: 2, diceCount: 5, dice: [2, 2, 3, 3, 5] },
      ],
    });
    const next = applyAction(state, { type: "calza", seat: 0 });
    expect(next).toEqual(state);
  });
});

describe("continue (round transition)", () => {
  it("is a no-op outside the reveal phase", () => {
    const state = makeState({ phase: "playing" });
    const next = applyAction(state, { type: "continue", seed: 1 });
    expect(next).toEqual(state);
  });

  it("rerolls every alive player's dice, clears the bid, and advances the round counter", () => {
    const state = makeState({
      phase: "reveal",
      roundNumber: 1,
      roundStarter: 1,
      currentBid: { seat: 0, quantity: 2, face: 3 },
      players: [
        { seat: 0, diceCount: 4, dice: [4, 4, 2, 3] },
        { seat: 1, diceCount: 0, dice: [] },
        { seat: 2, diceCount: 5, dice: [2, 2, 3, 3, 5] },
      ],
    });
    const next = applyAction(state, { type: "continue", seed: 123 });
    expect(next.phase).toBe("playing");
    expect(next.currentBid).toBeNull();
    expect(next.roundNumber).toBe(2);
    expect(next.activeSeat).toBe(1);
    expect(next.players.find((p) => p.seat === 0)!.dice).toHaveLength(4);
    expect(next.players.find((p) => p.seat === 1)!.dice).toHaveLength(0);
    expect(next.players.find((p) => p.seat === 2)!.dice).toHaveLength(5);
  });

  it("is deterministic for a given seed", () => {
    const state = makeState({ phase: "reveal", roundStarter: 0 });
    const a = applyAction(state, { type: "continue", seed: 55 });
    const b = applyAction(state, { type: "continue", seed: 55 });
    expect(a).toEqual(b);
  });
});

describe("computeRankings", () => {
  it("ranks the winner 1st and the rest by reverse elimination order", () => {
    const state = makeState({
      phase: "gameOver",
      winnerSeat: 1,
      eliminationOrder: [2, 0], // seat 2 eliminated first, seat 0 eliminated last
    });
    const rankings = computeRankings(state);
    expect(rankings).toEqual([
      { seat: 1, rank: 1 },
      { seat: 0, rank: 2 }, // last eliminated -> 2nd place
      { seat: 2, rank: 3 }, // first eliminated -> last place
    ]);
  });
});

describe("full game simulation", () => {
  it("always terminates with exactly one winner under a deterministic always-dudo policy", () => {
    let state = startGame(4, 2024);
    let guard = 0;
    while (state.phase !== "gameOver" && guard < 2000) {
      if (state.phase === "reveal") {
        state = applyAction(state, { type: "continue", seed: guard + 1 });
      } else if (!state.currentBid) {
        state = applyAction(state, { type: "raise", seat: state.activeSeat, quantity: 1, face: 2 });
      } else {
        state = applyAction(state, { type: "dudo", seat: state.activeSeat });
      }
      guard++;
    }
    expect(state.phase).toBe("gameOver");
    expect(state.winnerSeat).not.toBeNull();
    expect(aliveCount(state)).toBe(1);
    expect(state.eliminationOrder).toHaveLength(3);
  });

  it("also terminates under a mixed raise/dudo policy without dice counts ever going negative (this policy never calls calza, so it stays <= STARTING_DICE too — see the separate uncapped-calza tests above for the no-longer-capped growth case)", () => {
    let state = startGame(3, 777);
    let guard = 0;
    while (state.phase !== "gameOver" && guard < 3000) {
      if (state.phase === "reveal") {
        state = applyAction(state, { type: "continue", seed: guard + 7 });
      } else if (!state.currentBid) {
        state = applyAction(state, { type: "raise", seat: state.activeSeat, quantity: 1, face: 3 });
      } else if (guard % 3 === 0) {
        state = applyAction(state, { type: "raise", seat: state.activeSeat, quantity: state.currentBid.quantity + 1, face: state.currentBid.face });
      } else {
        state = applyAction(state, { type: "dudo", seat: state.activeSeat });
      }
      guard++;
    }
    expect(state.phase).toBe("gameOver");
    expect(state.players.every((p) => p.diceCount >= 0 && p.diceCount <= STARTING_DICE)).toBe(true);
  });
});

function aliveCount(state: PerudoState): number {
  return state.players.filter((p) => p.diceCount > 0).length;
}

describe("getValidMoves (AI bot support, ARCHITECTURE.md §7)", () => {
  it("gives the active seat opening raises for every face and nothing to anyone else", () => {
    const state = makeState({ activeSeat: 0 });
    const moves = getValidMoves(state, 0);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.type === "raise")).toBe(true); // no pending bid yet -> no dudo/calza
    expect(getValidMoves(state, 1)).toEqual([]);
  });

  it("includes dudo and calza once a bid is pending", () => {
    const state = makeState({
      activeSeat: 1,
      currentBid: { seat: 0, quantity: 2, face: 3 },
    });
    const moves = getValidMoves(state, 1);
    expect(moves.some((m) => m.type === "dudo")).toBe(true);
    expect(moves.some((m) => m.type === "calza")).toBe(true);
  });

  // 2026-08-17 룰북 정리: 팔라피코가 삭제됐으므로 라운드 선의 주사위가 1개뿐인
  // 상황에서도 calza가 포함되고, raise 후보의 눈금도 4로 고정되지 않아야 한다
  // (이전엔 여기서 calza 제외 + 눈금 고정 특수 분기가 있었다).
  it("still includes calza and offers raises across every face even when the round starter has only 1 die left", () => {
    const state = makeState({
      activeSeat: 1,
      roundStarter: 0,
      currentBid: { seat: 0, quantity: 2, face: 4 },
      players: [
        { seat: 0, diceCount: 1, dice: [4] },
        { seat: 1, diceCount: 5, dice: [1, 2, 3, 4, 5] },
        { seat: 2, diceCount: 5, dice: [1, 2, 3, 4, 5] },
      ],
    });
    const moves = getValidMoves(state, 1);
    expect(moves.some((m) => m.type === "calza")).toBe(true);
    expect(moves.filter((m) => m.type === "raise").some((m) => m.type === "raise" && m.face !== 4)).toBe(true);
  });

  it("returns nothing for an already-eliminated seat", () => {
    const state = makeState({
      activeSeat: 0,
      players: [
        { seat: 0, diceCount: 0, dice: [] },
        { seat: 1, diceCount: 5, dice: [1, 2, 3, 4, 5] },
        { seat: 2, diceCount: 5, dice: [1, 2, 3, 4, 5] },
      ],
    });
    expect(getValidMoves(state, 0)).toEqual([]);
  });
});

describe("chooseBotAction (AI bot support, Level 1–10)", () => {
  it("returns null for a seat that isn't up", () => {
    const state = makeState({ activeSeat: 0 });
    expect(chooseBotAction(state, 1, 5)).toBeNull();
  });

  it("calls dudo when the pending bid is far beyond a fair estimate", () => {
    const state = makeState({
      activeSeat: 1,
      // 페루도(1)×10 — needing 10 wild-1s out of 15 total dice is already a
      // bad bid, and every legal raise from here is strictly worse (paco ->
      // paco needs quantity > 10; paco -> normal needs quantity >= 20 — both
      // impossible with only 15 dice in play), so dudo should read as
      // clearly best regardless.
      currentBid: { seat: 0, quantity: 10, face: 1 },
      players: [
        { seat: 0, diceCount: 5, dice: [3, 3, 3, 3, 3] },
        { seat: 1, diceCount: 5, dice: [3, 3, 3, 3, 3] }, // no 1s in my own hand
        { seat: 2, diceCount: 5, dice: [3, 3, 3, 3, 3] },
      ],
    });
    // rng forced high enough to stay outside Level 5's ~12% mistake chance,
    // so this exercises the actual scored decision rather than the noise curve.
    expect(chooseBotAction(state, 1, 5, () => 0.99)).toEqual({ type: "dudo", seat: 1 });
  });

  it("always returns a legal move across every level", () => {
    const state = makeState({ activeSeat: 0 });
    for (let level = 1; level <= 10; level++) {
      const action = chooseBotAction(state, 0, level, () => 0.5);
      expect(action).not.toBeNull();
      expect(getValidMoves(state, 0)).toContainEqual(action);
    }
  });

  it("Level 1 (forced onto its mistake path) can pick a far worse move than Level 10's usual call", () => {
    const state = makeState({
      activeSeat: 1,
      // Same 페루도(1)×10 setup as above — every legal raise from here (paco
      // -> paco quantity 11, or paco -> normal at quantity >= 20) is a bad
      // bid with only 15 dice in play.
      currentBid: { seat: 0, quantity: 10, face: 1 },
      players: [
        { seat: 0, diceCount: 5, dice: [3, 3, 3, 3, 3] },
        { seat: 1, diceCount: 5, dice: [3, 3, 3, 3, 3] },
        { seat: 2, diceCount: 5, dice: [3, 3, 3, 3, 3] },
      ],
    });

    // rng() always 0 -> always below Level 1's ~55% mistake chance -> always
    // takes candidates[Math.floor(0 * length)] === the first enumerated move
    // (raiseMoves walks face 1..6 — face 1's own raise, quantity 11, comes
    // first — a bid that can never hold since only 15 dice are in play),
    // not the obviously-correct call.
    const level1Action = chooseBotAction(state, 1, 1, () => 0);
    expect(level1Action?.type).toBe("raise");
    expect(level1Action).not.toEqual({ type: "dudo", seat: 1 });
  });

  // Level 8-10 route through ISMCTS-lite + live regret-matching (see
  // engine.ts's "Level 8-10 expert bot" section) instead of the shared
  // `pickByLevel` curve, specifically so expert play stays a genuinely mixed
  // strategy (real bluffing) rather than a flat, perfectly predictable
  // argmax — so unlike the deterministic tiers above, this can't assert a
  // single rng draw always produces one exact action. Instead: this bid
  // (페루도(1)×10 — 10 wild-1s needed out of only 15 total dice) can never
  // hold — holdProbability is exactly 0 — and every raise still reachable
  // from here (paco -> paco quantity 11, or paco -> normal quantity >= 20)
  // is at least as bad (both exceed every die in play), so across many
  // independent decisions an expert bot should
  // overwhelmingly (not universally, since a genuine mixed strategy leaves
  // room for an occasional credible bluff/raise) resolve it by calling dudo.
  it("Level 10 overwhelmingly calls dudo on a bid that can never hold, without being perfectly deterministic about it", () => {
    const state = makeState({
      activeSeat: 1,
      currentBid: { seat: 0, quantity: 10, face: 1 },
      players: [
        { seat: 0, diceCount: 5, dice: [3, 3, 3, 3, 3] },
        { seat: 1, diceCount: 5, dice: [3, 3, 3, 3, 3] },
        { seat: 2, diceCount: 5, dice: [3, 3, 3, 3, 3] },
      ],
    });

    const trials = 200;
    let dudoCount = 0;
    for (let i = 0; i < trials; i++) {
      const action = chooseBotAction(state, 1, 10, seededRng(i));
      if (action?.type === "dudo") dudoCount++;
    }
    expect(dudoCount / trials).toBeGreaterThan(0.8);
  });
});

function playFullBotGame(playerCount: number, seed: number, levelOf: (seat: number) => number): PerudoState {
  let state = startGame(playerCount, seed);
  let guard = 0;
  while (state.phase !== "gameOver" && guard < 3000) {
    guard++;
    if (state.phase === "reveal") {
      state = applyAction(state, { type: "continue", seed: seed * 1000 + guard });
      continue;
    }
    const action = chooseBotAction(state, state.activeSeat, levelOf(state.activeSeat));
    expect(action).not.toBeNull();
    state = applyAction(state, action!);
  }
  return state;
}

describe("Level 1–10 풀 시뮬레이션 (버그 없이 gameOver까지 완주)", () => {
  for (const level of [1, 4, 7, 10]) {
    it(`completes an all-Level-${level} game with a decided winner`, () => {
      const state = playFullBotGame(4, 1000 + level, () => level);
      expect(state.phase).toBe("gameOver");
      expect(computeRankings(state)).toHaveLength(4);
    });
  }

  it("also completes with a mixed Level 1 / Level 10 table (no crash, no infinite loop)", () => {
    const state = playFullBotGame(5, 4242, (seat) => (seat % 2 === 0 ? 1 : 10));
    expect(state.phase).toBe("gameOver");
    expect(computeRankings(state)).toHaveLength(5);
  });
});
