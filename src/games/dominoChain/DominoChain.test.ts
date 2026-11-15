import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import {
  allowedDirs,
  applyAction,
  boardSizeFor,
  canWall,
  computeRankings,
  currentActor,
  frontier,
  idx,
  makeBoard,
  pusherOf,
  sidesFor,
  startGame,
  stepCell,
  topple,
  type Cell,
  type DominoState,
} from "./engine";
import { chooseBotAction } from "./bot";

function blank(size: number): Cell[] {
  return Array.from({ length: size * size }, () => ({ piece: null, feature: null }));
}

describe("domino chain — board", () => {
  it("places every pusher on its side facing in, with a clear runway", () => {
    for (const n of [2, 3, 4]) {
      const size = boardSizeFor(n);
      const cells = makeBoard(n, 12);
      sidesFor(n).forEach((side, seat) => {
        const p = pusherOf(size, side);
        const i = idx(size, p.c, p.r);
        expect(cells[i].piece).toEqual({ kind: "pusher", owner: seat, dir: p.dir });
        const ahead = stepCell(size, i, p.dir);
        expect(cells[ahead].feature).toBeNull();
        expect(cells[stepCell(size, ahead, p.dir)].feature).toBeNull();
      });
      const center = idx(size, (size - 1) / 2, (size - 1) / 2);
      expect(cells[center].feature).toEqual({ kind: "bell", value: 3 });
    }
  });

  it("is symmetric so no side is favoured", () => {
    const size = boardSizeFor(4);
    const cells = makeBoard(4, 99);
    const rot = (c: number, r: number) => [size - 1 - r, c];
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++) {
        const [x, y] = rot(c, r);
        expect(cells[idx(size, x, y)].feature).toEqual(cells[idx(size, c, r)].feature);
      }
  });
});

describe("domino chain — building", () => {
  it("open ends start in front of the pusher; facings fan ±90°", () => {
    const s = startGame(2, 3);
    const seat = s.activeSeat;
    const f = frontier(s, seat);
    expect(f.size).toBe(1);
    const [cell] = [...f.keys()];
    const dirs = allowedDirs(s, seat, cell);
    expect(dirs.length).toBe(5);
  });

  it("two placements per turn, then the next player", () => {
    let s = startGame(2, 3);
    const seat = s.activeSeat;
    for (let k = 0; k < 2; k++) {
      const [cell] = [...frontier(s, seat).keys()];
      const dir = allowedDirs(s, seat, cell)[2];
      s = applyAction(s, { type: "place", seat, cell, kind: "domino", dir });
    }
    expect(s.activeSeat).not.toBe(seat);
    expect(s.turnsLeft[seat]).toBe(s.turnsLeft[s.activeSeat] - 1);
  });

  it("rejects pieces off the chain, wrong facings and spent specials", () => {
    const s = startGame(2, 5);
    const seat = s.activeSeat;
    const [cell] = [...frontier(s, seat).keys()];
    const dirs = allowedDirs(s, seat, cell);
    const bad = [0, 1, 2, 3, 4, 5, 6, 7].find((d) => !dirs.includes(d))!;
    expect(applyAction(s, { type: "place", seat, cell, kind: "domino", dir: bad })).toBe(s);
    expect(applyAction(s, { type: "place", seat, cell: 0, kind: "domino", dir: 0 })).toBe(s);
    expect(applyAction(s, { type: "place", seat: (seat + 1) % 2, cell, kind: "domino", dir: dirs[0] })).toBe(s);
    const noSplit = { ...s, splitsLeft: [0, 0] };
    expect(applyAction(noSplit, { type: "place", seat, cell, kind: "split", dir: dirs[0] })).toBe(noSplit);
  });

  it("walls keep away from pushers", () => {
    const s = startGame(2, 5);
    const size = s.size;
    const p = pusherOf(size, 0);
    expect(canWall(s, idx(size, p.c, p.r - 1))).toBe(false);
    const far = s.cells.findIndex((c, i) => !c.piece && !c.feature && canWall(s, i));
    expect(far).toBeGreaterThanOrEqual(0);
  });
});

describe("domino chain — topple", () => {
  it("a straight line falls in order and rings the bell at the end", () => {
    const size = 7;
    const cells = blank(size);
    cells[idx(size, 3, 6)].piece = { kind: "pusher", owner: 0, dir: 6 };
    for (let r = 5; r >= 2; r--) cells[idx(size, 3, r)].piece = { kind: "domino", owner: 0, dir: 6 };
    cells[idx(size, 3, 1)].feature = { kind: "bell", value: 2 };
    const res = topple(cells, size, 1, 0);
    expect(res.chain[0]).toBe(4);
    expect(res.bells[0]).toBe(1);
    // bell 2 + longest-chain bonus 2
    expect(res.points[0]).toBe(4);
    const ring = res.events.find((e) => e.kind === "ring")!;
    expect(ring.t).toBe(5 * 2);
  });

  it("diagonals are slower, so the straight chain steals the shared piece", () => {
    const size = 9;
    const cells = blank(size);
    // seat 0 straight from the south, seat 1 diagonal from the west; both reach (4,4)
    cells[idx(size, 4, 8)].piece = { kind: "pusher", owner: 0, dir: 6 };
    for (let r = 7; r >= 5; r--) cells[idx(size, 4, r)].piece = { kind: "domino", owner: 0, dir: 6 };
    cells[idx(size, 0, 8)].piece = { kind: "pusher", owner: 1, dir: 7 };
    for (let k = 1; k <= 3; k++) cells[idx(size, k, 8 - k)].piece = { kind: "domino", owner: 1, dir: 7 };
    // the prize: seat 1's own piece at (4,4) and beyond
    cells[idx(size, 4, 4)].piece = { kind: "domino", owner: 1, dir: 6 };
    cells[idx(size, 4, 3)].piece = { kind: "domino", owner: 1, dir: 6 };
    cells[idx(size, 4, 2)].feature = { kind: "bell", value: 3 };
    const res = topple(cells, size, 2, 0);
    // seat 0 arrives at t=8 (4 straight falls), seat 1 at t=12 (4 diagonal falls)
    expect(res.steals[0]).toBe(2);
    expect(res.bells[0]).toBe(1);
    expect(res.bells[1]).toBe(0);
    const flip = res.events.find((e) => e.cell === idx(size, 4, 4))!;
    expect(flip.was).toBe(1);
    expect(flip.owner).toBe(0);
  });

  it("splits fork onto both forward diagonals; bombs cost 2 and knock neighbours", () => {
    const size = 7;
    const cells = blank(size);
    cells[idx(size, 3, 6)].piece = { kind: "pusher", owner: 0, dir: 6 };
    cells[idx(size, 3, 5)].piece = { kind: "split", owner: 0, dir: 6 };
    cells[idx(size, 2, 4)].feature = { kind: "bell", value: 1 };
    cells[idx(size, 4, 4)].feature = { kind: "bomb", value: 0 };
    cells[idx(size, 5, 3)].piece = { kind: "domino", owner: 0, dir: 6 };
    cells[idx(size, 5, 2)].feature = { kind: "bell", value: 2 };
    const res = topple(cells, size, 1, 0);
    expect(res.bells[0]).toBe(2);
    expect(res.bombs[0]).toBe(1);
    // bells 1 + 2, bomb −2, longest +2
    expect(res.points[0]).toBe(3);
  });

  it("walls and rocks stop a chain", () => {
    const size = 7;
    const cells = blank(size);
    cells[idx(size, 3, 6)].piece = { kind: "pusher", owner: 0, dir: 6 };
    cells[idx(size, 3, 5)].piece = { kind: "domino", owner: 0, dir: 6 };
    cells[idx(size, 3, 4)].piece = { kind: "wall", owner: 1, dir: 0 };
    cells[idx(size, 3, 3)].piece = { kind: "domino", owner: 0, dir: 6 };
    const res = topple(cells, size, 2, 0);
    expect(res.chain[0]).toBe(1);
  });

  it("simultaneous arrivals on a bell score for both", () => {
    const size = 7;
    const cells = blank(size);
    cells[idx(size, 3, 6)].piece = { kind: "pusher", owner: 0, dir: 6 };
    cells[idx(size, 3, 0)].piece = { kind: "pusher", owner: 1, dir: 2 };
    for (const r of [5, 4]) cells[idx(size, 3, r)].piece = { kind: "domino", owner: 0, dir: 6 };
    for (const r of [1, 2]) cells[idx(size, 3, r)].piece = { kind: "domino", owner: 1, dir: 2 };
    cells[idx(size, 3, 3)].feature = { kind: "bell", value: 2 };
    const res = topple(cells, size, 2, 0);
    expect(res.bells).toEqual([1, 1]);
    expect(res.points).toEqual([3, 3]);
  });
});

describe("domino chain — full games", () => {
  function play(n: number, levels: number[], seed: number): DominoState {
    const rng = seededRng(seed);
    let s = startGame(n, seed, { rounds: 3 });
    for (let guard = 0; guard < 600 && s.phase !== "ended"; guard++) {
      if (s.phase === "topple") {
        s = applyAction(s, { type: "next" });
        continue;
      }
      const actor = currentActor(s)!;
      const a = chooseBotAction(s, actor, levels[actor], rng) ?? { type: "pass" as const, seat: actor };
      const next = applyAction(s, a);
      expect(next).not.toBe(s);
      s = next;
    }
    return s;
  }

  it("bots finish 2p and 4p games with legal moves only", () => {
    for (const [n, lv] of [
      [2, [3, 9]],
      [4, [5, 5, 8, 2]],
    ] as const) {
      const s = play(n, [...lv], 40 + n);
      expect(s.phase).toBe("ended");
      expect(s.history.length).toBe(3);
      expect(computeRankings(s).length).toBe(n);
    }
  });

  it("a timeout passes the rest of the turn", () => {
    const s = startGame(3, 8);
    const t = applyAction(s, { type: "timeout", seat: s.activeSeat, turn: s.turn });
    expect(t.activeSeat).not.toBe(s.activeSeat);
    expect(t.lastPass?.timeout).toBe(true);
    expect(applyAction(s, { type: "timeout", seat: s.activeSeat, turn: s.turn + 5 })).toBe(s);
  });
});
