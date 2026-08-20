import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import {
  applyAction,
  BOARD_TRACK_SEQUENCE,
  chooseBotAction,
  computeRankings,
  countMatching,
  getValidMoves,
  isValidBid,
  MIN_PLAYERS,
  MAX_PLAYERS,
  STARTING_DICE,
  startGame,
  totalDiceInPlay,
  trackIndexForBid,
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

/** Finds a track cell's index by (kind, quantity) — a small test helper, distinct from `trackIndexForBid` which only searches *ahead* of a given position. */
function trackIndexOf(kind: "normal" | "perudo", quantity: number, occurrence: 1 | 2 = 1): number {
  const matches = BOARD_TRACK_SEQUENCE.filter((n) => n.kind === kind && n.quantity === quantity);
  const node = matches[occurrence - 1];
  if (!node) throw new Error(`no ${kind} cell with quantity ${quantity} (occurrence ${occurrence})`);
  return node.index;
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
// 2026-08-19 board track redesign — bidding validity is no longer the
// rulebook §3 quantity/face formulas at all; it's a single fixed sequence
// (`BOARD_TRACK_SEQUENCE`, 37 cells) that every bid maps to a cell of, and
// the only rule is "the next bid's cell must have a strictly greater index
// than the current bid's cell" (`isValidBid`). See engine.ts's module doc
// note for why the raw number labels aren't monotonic (e.g.
// "...6→7→4→[페루도4]→8...") without that being a contradiction — validity
// only ever looks at array index, never the printed label.
// ---------------------------------------------------------------------------
describe("BOARD_TRACK_SEQUENCE — the fixed linear board track", () => {
  it("has exactly 37 cells, matching the user-specified sequence 1→[페루도1]→2→...→[페루도10]→20", () => {
    expect(BOARD_TRACK_SEQUENCE).toHaveLength(37);
    expect(BOARD_TRACK_SEQUENCE[0]).toMatchObject({ index: 0, kind: "normal", quantity: 1 });
    expect(BOARD_TRACK_SEQUENCE[1]).toMatchObject({ index: 1, kind: "perudo", quantity: 1 });
    expect(BOARD_TRACK_SEQUENCE[36]).toMatchObject({ index: 36, kind: "normal", quantity: 20 });
  });

  it("reproduces the exact confirmed label sequence, including its non-monotonic dips (e.g. ...7→4→[페루도4]...)", () => {
    const labels = BOARD_TRACK_SEQUENCE.map((n) => (n.kind === "perudo" ? `페루도${n.quantity}` : `${n.quantity}`));
    expect(labels).toEqual([
      "1", "페루도1",
      "2", "3", "페루도2",
      "4", "5", "페루도3",
      "6", "7", "4", "페루도4",
      "8", "9", "5", "페루도5",
      "10", "11", "6", "페루도6",
      "12", "13", "7", "페루도7",
      "14", "15", "8", "페루도8",
      "16", "17", "9", "페루도9",
      "18", "19", "10", "페루도10",
      "20",
    ]);
  });

  it("[페루도2]에서 3(트랙 상 이전 칸)으로 비딩 시도 시 실패(false)", () => {
    const perudo2 = trackIndexOf("perudo", 2);
    const three = trackIndexOf("normal", 3);
    expect(isValidBid(perudo2, three)).toBe(false);
  });

  it("[페루도2]에서 4 또는 [페루도3]으로 비딩 시도 시 성공(true)", () => {
    const perudo2 = trackIndexOf("perudo", 2);
    const four = trackIndexOf("normal", 4);
    const perudo3 = trackIndexOf("perudo", 3);
    expect(isValidBid(perudo2, four)).toBe(true);
    expect(isValidBid(perudo2, perudo3)).toBe(true);
  });

  it("트랙을 처음부터 끝까지 한 칸씩 전진하면 매번 유효하다 (전체 순서 검증)", () => {
    for (let i = 1; i < BOARD_TRACK_SEQUENCE.length; i++) {
      expect(isValidBid(i - 1, i)).toBe(true);
    }
  });

  it("같은 칸이거나 이전 칸으로는 이동할 수 없다 (역행 차단)", () => {
    for (let i = 0; i < BOARD_TRACK_SEQUENCE.length; i++) {
      expect(isValidBid(i, i)).toBe(false);
      if (i > 0) expect(isValidBid(i, i - 1)).toBe(false);
    }
  });

  it("트랙 범위를 벗어난 인덱스는 거절된다", () => {
    expect(isValidBid(0, -1)).toBe(false);
    expect(isValidBid(0, BOARD_TRACK_SEQUENCE.length)).toBe(false);
  });

  it("prev=null(개장 선언)은 트랙 내 아무 칸이나 허용한다", () => {
    expect(isValidBid(null, 0)).toBe(true);
    expect(isValidBid(null, 36)).toBe(true);
  });

  it("trackIndexForBid finds the nearest matching cell strictly ahead of a position, or null if none remains", () => {
    expect(trackIndexForBid(-1, 1, 2)).toBe(0); // opening bid "1"
    expect(trackIndexForBid(-1, 1, 1)).toBe(1); // opening bid "페루도1"
    expect(trackIndexForBid(trackIndexOf("normal", 7), 4, 2)).toBe(trackIndexOf("normal", 4, 2)); // second "4", since the first is already behind
    expect(trackIndexForBid(0, 1, 2)).toBeNull(); // quantity 1 never recurs later on the track
    expect(trackIndexForBid(0, 21, 2)).toBeNull(); // quantity 21 never appears on the track at all
    expect(trackIndexForBid(0, 11, 1)).toBeNull(); // 페루도11 never appears (perudo cells only go up to 10)
  });
});

describe("validateRaise — board-track index comparison (rulebook §3 formulas no longer apply)", () => {
  it("always accepts the round's opening bid, as long as it lands on a real track cell", () => {
    expect(validateRaise(null, { quantity: 1, face: 1 })).toBe(true);
    expect(validateRaise(null, { quantity: 20, face: 6 })).toBe(true);
  });

  it("rejects an out-of-range face, non-positive quantity, or a quantity that never appears on the track", () => {
    expect(validateRaise(null, { quantity: 1, face: 0 as Face })).toBe(false);
    expect(validateRaise(null, { quantity: 1, face: 7 as Face })).toBe(false);
    expect(validateRaise(null, { quantity: 0, face: 3 })).toBe(false);
    expect(validateRaise(null, { quantity: 99, face: 6 })).toBe(false); // no cell for quantity 99
    expect(validateRaise(null, { quantity: 11, face: 1 })).toBe(false); // no 페루도11 cell
  });

  it("[페루도2]에 놓인 뒤: 3/2/[페루도1]/1 등 트랙 상 이전 칸으로는 거절된다", () => {
    const prev: Bid = { seat: 0, trackIndex: trackIndexOf("perudo", 2), quantity: 2, face: 1 };
    expect(validateRaise(prev, { quantity: 3, face: 2 })).toBe(false);
    expect(validateRaise(prev, { quantity: 2, face: 2 })).toBe(false);
    expect(validateRaise(prev, { quantity: 1, face: 1 })).toBe(false);
    expect(validateRaise(prev, { quantity: 1, face: 2 })).toBe(false);
  });

  it("[페루도2]에 놓인 뒤: 4, 5, [페루도3], 6... 등 트랙 상 이후 칸은 모두 허용된다", () => {
    const prev: Bid = { seat: 0, trackIndex: trackIndexOf("perudo", 2), quantity: 2, face: 1 };
    expect(validateRaise(prev, { quantity: 4, face: 2 })).toBe(true);
    expect(validateRaise(prev, { quantity: 5, face: 3 })).toBe(true);
    expect(validateRaise(prev, { quantity: 3, face: 1 })).toBe(true); // [페루도3]
    expect(validateRaise(prev, { quantity: 6, face: 5 })).toBe(true);
  });

  it("같은 수량이라도 이미 지나간 칸이 아니라 트랙 상 더 뒤에 있는 동일 라벨 칸이면 유효하다 (예: 두 번째 '4')", () => {
    // Sitting at "7" (index of the first "7"), the *later* duplicate "4" cell
    // (after "6, 7") is still strictly ahead on the track, even though 4 < 7.
    const prev: Bid = { seat: 0, trackIndex: trackIndexOf("normal", 7), quantity: 7, face: 2 };
    expect(validateRaise(prev, { quantity: 4, face: 3 })).toBe(true);
  });

  it("페루도(1)는 오직 트랙에 명시된 [페루도 N] 칸으로만 비딩할 수 있다 — 존재하지 않는 페루도 수량은 거절", () => {
    expect(validateRaise(null, { quantity: 11, face: 1 })).toBe(false);
    expect(validateRaise(null, { quantity: 1, face: 1 })).toBe(true); // [페루도1] exists
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

  it("is a no-op for an invalid raise (a quantity with no cell strictly ahead of the current one)", () => {
    const state = makeState({
      activeSeat: 0,
      currentBid: { seat: 2, trackIndex: trackIndexOf("normal", 4), quantity: 4, face: 3 },
    });
    // Quantity 3 only ever appears once on the track, at an index before "4" — nothing ahead can match it.
    const next = applyAction(state, { type: "raise", seat: 0, quantity: 3, face: 6 });
    expect(next).toEqual(state);
  });

  it("updates currentBid (with its resolved trackIndex) and advances to the next alive seat", () => {
    const state = makeState({ activeSeat: 0 });
    const next = applyAction(state, { type: "raise", seat: 0, quantity: 2, face: 3 });
    expect(next.currentBid).toEqual({ seat: 0, trackIndex: trackIndexOf("normal", 2), quantity: 2, face: 3 });
    expect(next.activeSeat).toBe(1);
  });

  it("landing on a later duplicate-labelled cell is a legal raise even though the printed quantity looks smaller", () => {
    const state = makeState({
      activeSeat: 0,
      currentBid: { seat: 1, trackIndex: trackIndexOf("normal", 7), quantity: 7, face: 2 },
    });
    const next = applyAction(state, { type: "raise", seat: 0, quantity: 4, face: 5 });
    expect(next.currentBid).toEqual({ seat: 0, trackIndex: trackIndexOf("normal", 4, 2), quantity: 4, face: 5 });
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
      currentBid: { seat: 2, trackIndex: trackIndexOf("normal", 3), quantity: 3, face: 4 },
    });
    const next = applyAction(state, { type: "dudo", seat: 1 });
    expect(next).toEqual(state);
  });

  it("penalizes the bidder by the exact shortfall when the bid was too high (rulebook §4①: 선언 개수 - 실제 개수)", () => {
    // Table has three 4s + no 1s = 3 actual, but seat 2 bid 5 -> shortfall of 2.
    const state = makeState({
      activeSeat: 0,
      currentBid: { seat: 2, trackIndex: trackIndexOf("normal", 5), quantity: 5, face: 4 },
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
      currentBid: { seat: 2, trackIndex: trackIndexOf("normal", 2), quantity: 2, face: 4 },
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
      currentBid: { seat: 2, trackIndex: trackIndexOf("normal", 5), quantity: 5, face: 4 },
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
      currentBid: { seat: 1, trackIndex: trackIndexOf("normal", 6), quantity: 6, face: 4 },
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
      currentBid: { seat: 0, trackIndex: trackIndexOf("normal", 2), quantity: 2, face: 4 },
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
      currentBid: { seat: 2, trackIndex: trackIndexOf("normal", 2), quantity: 2, face: 4 },
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
      currentBid: { seat: 2, trackIndex: trackIndexOf("normal", 2), quantity: 2, face: 4 },
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
      currentBid: { seat: 2, trackIndex: trackIndexOf("normal", 2), quantity: 2, face: 4 },
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
      state = { ...state, phase: "playing", currentBid: { seat: 2, trackIndex: trackIndexOf("normal", 2), quantity: 2, face: 4 } };
    }
    expect(state.players.find((p) => p.seat === 0)!.diceCount).toBe(9); // 5 + four successive +1s, no cap
  });

  it("loses dice equal to the exact absolute margin on a wrong call (rulebook §4②: |실제 개수 - 선언 개수|)", () => {
    // face-4 count: seat0's two 4s + seat1's wild 1 = 3 actual, bid was 5 -> |3-5| = 2.
    const state = makeState({
      currentBid: { seat: 2, trackIndex: trackIndexOf("normal", 5), quantity: 5, face: 4 },
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
      currentBid: { seat: 2, trackIndex: trackIndexOf("normal", 4), quantity: 4, face: 4 },
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
      currentBid: { seat: 2, trackIndex: 36, quantity: 30, face: 4 }, // quantity 30 never appears on the track itself — only reachable directly via state override, exercising the "margin exceeds stock" clamp regardless
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
      currentBid: { seat: 0, trackIndex: trackIndexOf("normal", 1), quantity: 1, face: 4 },
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
      currentBid: { seat: 2, trackIndex: trackIndexOf("normal", 2), quantity: 2, face: 4 },
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
      currentBid: { seat: 0, trackIndex: trackIndexOf("normal", 2), quantity: 2, face: 3 },
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
      currentBid: { seat: 0, trackIndex: trackIndexOf("normal", 2), quantity: 2, face: 3 },
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
      currentBid: { seat: 0, trackIndex: trackIndexOf("normal", 2), quantity: 2, face: 4 },
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
      // [페루도10] — the track's second-to-last cell, so the only raise left
      // ahead of it is the final "20" cell (index 36): needing 10 wild-1s out
      // of 15 total dice is already a bad bid, and every raise candidate left
      // on the track from here is strictly worse (an outright-impossible
      // quantity-20 bid), so dudo should read as clearly best regardless.
      currentBid: { seat: 0, trackIndex: trackIndexOf("perudo", 10), quantity: 10, face: 1 },
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
      // Same [페루도10] setup as above — face 1 has no raise candidate left at
      // all (this *is* the last perudo cell), so the first enumerated raise
      // is face 2's jump to the track's final "20" cell.
      currentBid: { seat: 0, trackIndex: trackIndexOf("perudo", 10), quantity: 10, face: 1 },
      players: [
        { seat: 0, diceCount: 5, dice: [3, 3, 3, 3, 3] },
        { seat: 1, diceCount: 5, dice: [3, 3, 3, 3, 3] },
        { seat: 2, diceCount: 5, dice: [3, 3, 3, 3, 3] },
      ],
    });

    // rng() always 0 -> always below Level 1's ~55% mistake chance -> always
    // takes candidates[Math.floor(0 * length)] === the first enumerated move
    // (a raise to the track's final "20" cell — the only quantity left ahead
    // of [페루도10] at all — a bid that can never hold since only 15 dice are
    // in play), not the obviously-correct call.
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
  // ([페루도10] — 10 wild-1s needed out of only 15 total dice) can never
  // hold — holdProbability is exactly 0 — and every raise still reachable
  // from here (only the track's final "20" cell remains ahead) is at least
  // as bad (quantity 20 exceeds every die in play, an outright-impossible
  // bid), so across many independent decisions an expert bot should
  // overwhelmingly (not universally, since a genuine mixed strategy leaves
  // room for an occasional credible bluff/raise) resolve it by calling dudo.
  it("Level 10 overwhelmingly calls dudo on a bid that can never hold, without being perfectly deterministic about it", () => {
    const state = makeState({
      activeSeat: 1,
      currentBid: { seat: 0, trackIndex: trackIndexOf("perudo", 10), quantity: 10, face: 1 },
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
