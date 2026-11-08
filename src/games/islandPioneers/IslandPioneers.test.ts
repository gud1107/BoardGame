import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import {
  analyze,
  applyAction,
  BOARD,
  CENTER,
  DECK_SIZE,
  fits,
  isStateSyncStale,
  legalPlacements,
  majority,
  neighbor,
  settlerOptions,
  startGame,
  supplyOf,
  type IslandState,
  type Placed,
} from "./engine";
import { chooseBotAction } from "./bot";
import { DECK_IDS, distinctRotations, quadTerrain, rotatedQuads, TILE_DEFS } from "./tiles";
import { islandSoundCues } from "./islandPioneersSound";

const empty = (): (Placed | null)[] => Array.from({ length: BOARD * BOARD }, () => null);
const tileOf = (pattern: string) => TILE_DEFS.findIndex((t, i) => i > 0 && t.q.map((x) => "FMRS"[x]).join("") === pattern);

describe("tiles", () => {
  it("has a start camp + 60 deck tiles, each with 4 terrains", () => {
    expect(DECK_IDS.length).toBe(60);
    expect(Math.max(...Object.values(DECK_SIZE))).toBeLessThanOrEqual(60);
    for (const t of TILE_DEFS) expect(t.q).toHaveLength(4);
  });
  it("rotates clockwise", () => {
    const id = tileOf("FMRS");
    expect(rotatedQuads(id, 0)).toEqual([0, 1, 2, 3]);
    expect(rotatedQuads(id, 1)).toEqual([3, 0, 1, 2]);
  });
  it("dedupes symmetric rotations", () => {
    const plain = TILE_DEFS.findIndex((t, i) => i > 0 && t.res < 0 && t.q.map((x) => "FMRS"[x]).join("") === "FMFM");
    expect(distinctRotations(plain)).toHaveLength(2);
    const solid = TILE_DEFS.findIndex((t, i) => i > 0 && t.res < 0 && t.q.every((x) => x === 0));
    expect(distinctRotations(solid)).toHaveLength(1);
  });
});

describe("placement", () => {
  it("must touch the island and match every edge", () => {
    const s = startGame(2, 1);
    const camp = s.board[CENTER]!;
    const north = neighbor(CENTER, 0);
    const want = quadTerrain(camp.tile, camp.rot, 0);
    const full = TILE_DEFS.findIndex((t, i) => i > 0 && t.q.every((x) => x === want));
    expect(fits(s.board, north, full, 0)).toBe(true);
    const other = TILE_DEFS.findIndex((t, i) => i > 0 && t.q.every((x) => x === (want + 1) % 4));
    expect(fits(s.board, north, other, 0)).toBe(false);
    expect(fits(s.board, 0, full, 0)).toBe(false); // not touching
    expect(fits(s.board, CENTER, full, 0)).toBe(false); // occupied
  });

  it("rejects illegal actions and stale turns", () => {
    const s = startGame(3, 4);
    const m = legalPlacements(s.board, s.market[0])[0];
    expect(applyAction(s, { type: "place", seat: (s.active + 1) % 3, turn: s.turn, pick: 0, cell: m.cell, rot: m.rot, settler: null })).toBe(s);
    expect(applyAction(s, { type: "place", seat: s.active, turn: s.turn + 1, pick: 0, cell: m.cell, rot: m.rot, settler: null })).toBe(s);
    expect(applyAction(s, { type: "place", seat: s.active, turn: s.turn, pick: 0, cell: 0, rot: 0, settler: null })).toBe(s);
    expect(applyAction(s, { type: "place", seat: s.active, turn: s.turn, pick: 0, cell: m.cell, rot: m.rot, settler: 9 })).toBe(s);
    const next = applyAction(s, { type: "place", seat: s.active, turn: s.turn, pick: 0, cell: m.cell, rot: m.rot, settler: null });
    expect(next).not.toBe(s);
    expect(next.turn).toBe(s.turn + 1);
    expect(isStateSyncStale(next, s)).toBe(true);
  });

  it("timeout plays an automatic legal tile", () => {
    const s = startGame(2, 9);
    const next = applyAction(s, { type: "timeout", seat: s.active, turn: s.turn });
    expect(next.board.filter(Boolean).length).toBe(2);
    expect(next.lastEvent?.timeout).toBe(true);
  });
});

describe("regions & scoring", () => {
  it("a forest closed by four tiles around a pond scores for the majority and returns pioneers", () => {
    // 2×2 block whose inner corners are forest, outer sides sea: FF SS at the right rotations
    const board = empty();
    const c = CENTER;
    const id = tileOf("FFSS"); // N,E forest; S,W sea
    // top-left cell: forest on E and S → rot 1 (N→E): q = [S? ] compute by search
    const pick = (cell: number, inner: number[]) => {
      for (let rot = 0; rot < 4; rot++) if (inner.every((d) => quadTerrain(id, rot, d) === 0) && [0, 1, 2, 3].filter((d) => !inner.includes(d)).every((d) => quadTerrain(id, rot, d) === 3)) return { tile: id, rot, by: 0 };
      throw new Error("no rot");
    };
    board[c] = pick(c, [1, 2]);
    board[c + 1] = pick(c + 1, [3, 2]);
    board[c + BOARD] = pick(c + BOARD, [0, 1]);
    const an0 = analyze(board, []);
    const forest = an0.regions.find((r) => r.terrain === 0)!;
    expect(forest.cells.length).toBe(3);
    expect(forest.open).toBeGreaterThan(0);
    const state0 = startGame(2, 3);
    const state: IslandState = { ...state0, board, market: [id], bag: [], active: 0, settlers: [{ seat: 1, cell: c, quad: 1 }, { seat: 1, cell: c + 1, quad: 3 }].slice(0, 1) };
    const target = c + BOARD + 1;
    const p = pick(target, [0, 3]);
    const next = applyAction(state, { type: "place", seat: 0, turn: state.turn, pick: 0, cell: target, rot: p.rot, settler: null });
    expect(next).not.toBe(state);
    const sc = next.lastEvent!.scored.find((r) => r.terrain === 0)!;
    expect(sc.tiles).toBe(4);
    expect(sc.owners).toEqual([1]);
    expect(sc.points).toBe(8);
    expect(next.settlers.length).toBe(0);
    expect(next.phase).toBe("gameOver"); // harbour ran out
  });

  it("majority ties share", () => {
    expect(majority([{ seat: 0, cell: 1, quad: 0 }, { seat: 2, cell: 2, quad: 0 }])).toEqual([0, 2]);
    expect(majority([{ seat: 0, cell: 1, quad: 0 }, { seat: 2, cell: 2, quad: 0 }, { seat: 2, cell: 3, quad: 0 }])).toEqual([2]);
  });

  it("can't stand a pioneer on a claimed region", () => {
    const s = startGame(2, 11);
    const an = analyze(s.board, [{ seat: 0, cell: CENTER, quad: 0 }]);
    const free = settlerOptions(s.board, [{ seat: 0, cell: CENTER, quad: 0 }], CENTER, an);
    expect(free).not.toContain(0);
  });
});

describe("full games", () => {
  for (const n of [2, 3, 4, 5]) {
    it(`${n}p bot game ends, supply never negative, every tile accounted for`, () => {
      let s = startGame(n, 77 + n);
      const rng = seededRng(n);
      let guard = 0;
      while (s.phase === "playing" && guard++ < 300) {
        const before = s;
        s = applyAction(s, chooseBotAction(s, s.active, 3 + n, rng)!);
        expect(s).not.toBe(before);
        for (let seat = 0; seat < n; seat++) expect(supplyOf(s, seat)).toBeGreaterThanOrEqual(0);
      }
      expect(s.phase).toBe("gameOver");
      expect(s.final).toHaveLength(n);
      const placed = s.board.filter(Boolean).length - 1;
      expect(placed + s.washed.length + s.bag.length).toBe(DECK_SIZE[n]);
    }, 60_000);
  }
});

describe("sound cues", () => {
  it("every move makes a place sound and the game ends on a fanfare", () => {
    let s = startGame(2, 5);
    const rng = seededRng(5);
    const all: string[] = [];
    while (s.phase === "playing") {
      const next = applyAction(s, chooseBotAction(s, s.active, 5, rng)!);
      const cues = islandSoundCues(s, next).map((c) => (typeof c === "string" ? c : c.name));
      expect(cues.filter((c) => c === "place").length).toBe(1);
      all.push(...cues);
      s = next;
    }
    expect(all.at(-1)).toBe("victory");
    expect(all).toContain("complete");
  }, 60_000);
});
