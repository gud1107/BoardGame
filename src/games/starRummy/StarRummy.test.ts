import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import {
  analyzeMeld,
  applyAction,
  checkCommit,
  computeRankings,
  currentActor,
  HAND_SIZE,
  isStateSyncStale,
  OBSERVATORY_SIZE,
  startGame,
  TILE_COUNT,
  type StarRummyState,
  type TileId,
} from "./engine";
import { chooseBotAction, solve } from "./bot";

// id helpers: colour c (0..3), number n (1..12), copy 0/1
const T = (c: number, n: number, copy = 0): TileId => c * 24 + copy * 12 + (n - 1);
const W1 = 96;
const W2 = 97;

function withHands(base: StarRummyState, hands: TileId[][], table: TileId[][] = [], opened?: boolean[]): StarRummyState {
  return { ...base, hands, table, opened: opened ?? base.opened, active: 0 };
}

describe("melds", () => {
  it("reads runs and groups", () => {
    expect(analyzeMeld([T(0, 3), T(0, 4), T(0, 5)])?.kind).toBe("run");
    expect(analyzeMeld([T(0, 7), T(1, 7), T(2, 7)])?.kind).toBe("group");
    expect(analyzeMeld([T(0, 7), T(1, 7), T(2, 7), T(3, 7)])?.value).toBe(28);
  });

  it("rejects bad melds", () => {
    expect(analyzeMeld([T(0, 3), T(0, 4)])).toBeNull();
    expect(analyzeMeld([T(0, 3), T(1, 4), T(0, 5)])).toBeNull();
    expect(analyzeMeld([T(0, 7), T(0, 7, 1), T(2, 7)])).toBeNull(); // same colour twice in a group
    expect(analyzeMeld([T(0, 7), T(1, 7), T(2, 7), T(3, 7), W1])).toBeNull(); // group of 5
    expect(analyzeMeld([T(0, 11), T(0, 12), T(0, 1)])).toBeNull(); // no wrap-around
  });

  it("lets wilds fill gaps and ends", () => {
    const gap = analyzeMeld([T(0, 3), W1, T(0, 5)]);
    expect(gap?.values).toEqual([3, 4, 5]);
    const top = analyzeMeld([T(1, 11), T(1, 12), W1]);
    expect(top?.values).toEqual([10, 11, 12]); // can't go past 12 → extends down
    expect(analyzeMeld([T(2, 9), W1, W2])?.value).toBe(27); // one real + two wilds → group of 9s
    expect(analyzeMeld([T(2, 9), T(2, 12), W1, W2])?.values).toEqual([9, 10, 11, 12]);
  });
});

describe("commit rules", () => {
  const base = startGame(2, 42);

  it("opening needs 24+ from the hand only", () => {
    const hand = [T(0, 3), T(0, 4), T(0, 5), T(1, 9), T(2, 9), T(3, 9), T(0, 1)];
    const s = withHands(base, [hand, [T(1, 1)]]);
    const small = checkCommit(s, 0, [[T(0, 3), T(0, 4), T(0, 5)]]);
    expect(small.ok).toBe(false);
    expect(small.openingValue).toBe(12);
    const enough = checkCommit(s, 0, [
      [T(0, 3), T(0, 4), T(0, 5)],
      [T(1, 9), T(2, 9), T(3, 9)],
    ]);
    expect(enough.ok).toBe(true);
  });

  it("can't touch table melds before opening", () => {
    const table = [[T(1, 4), T(1, 5), T(1, 6)]];
    const hand = [T(1, 7), T(1, 8), T(1, 9), T(1, 10), T(2, 10), T(3, 10)];
    const s = withHands(base, [hand, []], table);
    const extend = checkCommit(s, 0, [[T(1, 4), T(1, 5), T(1, 6), T(1, 7), T(1, 8), T(1, 9)], [T(1, 10), T(2, 10), T(3, 10)]]);
    expect(extend.ok).toBe(false);
    const separate = checkCommit(s, 0, [table[0], [T(1, 7), T(1, 8), T(1, 9)], [T(1, 10), T(2, 10), T(3, 10)]]);
    expect(separate.ok).toBe(true);
  });

  it("after opening: rearrange freely, never take tiles back, must play one", () => {
    const table = [[T(0, 5), T(0, 6), T(0, 7), T(0, 8)]];
    const s = withHands(base, [[T(1, 5), T(2, 5), T(3, 3)], []], table, [true, true]);
    // split the run and build a group of 5s with the red 5
    const ok = checkCommit(s, 0, [[T(0, 6), T(0, 7), T(0, 8)], [T(0, 5), T(1, 5), T(2, 5)]]);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.rearranged).toBe(true);
    expect(checkCommit(s, 0, [[T(0, 6), T(0, 7), T(0, 8)]]).ok).toBe(false); // dropped the 5
    expect(checkCommit(s, 0, table).ok).toBe(false); // nothing played
  });

  it("swapping a wild out keeps it on the table", () => {
    const table = [[T(0, 3), W1, T(0, 5)]];
    const s = withHands(base, [[T(0, 4), T(2, 9), T(3, 9)], []], table, [true, true]);
    const swap = checkCommit(s, 0, [[T(0, 3), T(0, 4), T(0, 5)], [W1, T(2, 9), T(3, 9)]]);
    expect(swap.ok).toBe(true);
  });

  it("applies a commit and ends the round when the hand empties", () => {
    const s = withHands(base, [[T(0, 3), T(0, 4), T(0, 5)], [T(1, 12), W1]], [], [true, true]);
    const next = applyAction(s, { type: "commit", seat: 0, turn: s.turn, table: [[T(0, 3), T(0, 4), T(0, 5)]] });
    expect(next.phase).toBe("roundEnd");
    const r = next.results[0];
    expect(r.outSeat).toBe(0);
    expect(r.delta).toEqual([32, -32]);
    expect(next.scores).toEqual([32, -32]);
  });
});

describe("turns and draws", () => {
  it("deals 13 each + 3 face up and keeps all 98 tiles", () => {
    const s = startGame(4, 7);
    expect(s.hands.every((h) => h.length === HAND_SIZE)).toBe(true);
    expect(s.observatory.length).toBe(OBSERVATORY_SIZE);
    expect(new Set([...s.hands.flat(), ...s.pool, ...s.observatory]).size).toBe(TILE_COUNT);
  });

  it("drawing from the observatory refills it; stale turns are ignored", () => {
    const s = startGame(2, 9);
    const seat = s.active;
    const pick = s.observatory[1];
    const next = applyAction(s, { type: "draw", seat, turn: s.turn, from: 1 });
    expect(next.hands[seat]).toContain(pick);
    expect(next.observatory.length).toBe(OBSERVATORY_SIZE);
    expect(next.observatory[1]).toBe(s.pool[0]);
    expect(next.active).not.toBe(seat);
    expect(applyAction(next, { type: "draw", seat, turn: s.turn, from: "pool" })).toBe(next);
    expect(isStateSyncStale(next, s)).toBe(true);
  });

  it("round runs dry after a full lap of passes", () => {
    let s = startGame(2, 11);
    s = { ...s, pool: [], observatory: [] };
    s = applyAction(s, { type: "timeout", seat: s.active, turn: s.turn });
    expect(s.phase).toBe("playing");
    s = applyAction(s, { type: "draw", seat: s.active, turn: s.turn, from: "pool" });
    expect(s.phase).toBe("roundEnd");
    expect(s.results[0].outSeat).toBeNull();
    expect(s.scores.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(0);
  });
});

describe("bot", () => {
  it("solver rearranges the table to place hand tiles", () => {
    // table: R5-R8 run; hand: B5, Y5 → split off R5 into a 5s group
    const sol = solve([T(0, 5), T(0, 6), T(0, 7), T(0, 8)], [T(1, 5), T(2, 5)], 5000);
    expect(sol?.used.sort()).toEqual([T(1, 5), T(2, 5)].sort());
    expect(sol!.melds.every((m) => analyzeMeld(m) !== null)).toBe(true);
  });

  function playGame(seed: number, players: number, levels: number[], rounds = 1) {
    let s = startGame(players, seed, rounds);
    const rng = seededRng(seed * 31 + 1);
    let steps = 0;
    while (s.phase !== "gameOver" && steps < 3000) {
      if (s.phase === "roundEnd") {
        s = applyAction(s, { type: "nextRound", round: s.round });
        continue;
      }
      const seat = currentActor(s)!;
      const action = chooseBotAction(s, seat, levels[seat], rng);
      expect(action).not.toBeNull();
      const next = applyAction(s, action!);
      expect(next).not.toBe(s); // every bot action is legal
      s = next;
      steps++;
      // tile conservation
      expect(s.hands.flat().length + s.table.flat().length + s.pool.length + s.observatory.length).toBe(TILE_COUNT);
    }
    return s;
  }

  it("self-play always finishes with legal moves", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const end = playGame(seed, 2 + (seed % 3), [3, 6, 9, 10], 2);
      expect(end.phase).toBe("gameOver");
      expect(end.results.length).toBe(2);
      expect(computeRankings(end)[0].rank).toBe(1);
    }
  });

  it("stronger bots win more often", () => {
    let strong = 0;
    const games = 10;
    for (let seed = 100; seed < 100 + games; seed++) {
      const levels = seed % 2 ? [1, 10] : [10, 1];
      const end = playGame(seed, 2, levels);
      const winner = computeRankings(end)[0].seat;
      if (levels[winner] === 10) strong++;
    }
    expect(strong).toBeGreaterThanOrEqual(games * 0.6);
  });
});
