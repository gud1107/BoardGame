import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import {
  applyAction,
  cellNeighbors,
  cellOf,
  chooseBotAction,
  computeRankings,
  currentActor,
  heliController,
  legalPlacements,
  legalThiefCells,
  tokenColor,
  pointCells,
  pointNeighbors,
  pointOf,
  policeBelief,
  startGame,
  TOTAL_ROUNDS,
  type CityChaseState,
  type Point,
} from "./engine";

function play(state: CityChaseState, thiefLevel: number, policeLevel: number, rng: () => number): CityChaseState {
  let s = state;
  for (let guard = 0; guard < 200 && s.phase !== "gameOver"; guard++) {
    const actor = currentActor(s)!;
    const level = actor === s.thiefSeat ? thiefLevel : policeLevel;
    const action = chooseBotAction(s, actor, level, rng);
    expect(action).not.toBeNull();
    const next = applyAction(s, action!);
    expect(next.seq).toBe(s.seq + 1);
    s = next;
  }
  return s;
}

describe("city chase geometry", () => {
  it("interior intersections touch 4 buildings, edges 2, corners 1", () => {
    expect(pointCells(pointOf(0, 0))).toEqual([cellOf(0, 0)]);
    expect(pointCells(pointOf(0, 3))).toHaveLength(2);
    expect(pointCells(pointOf(2, 2))).toHaveLength(4);
  });

  it("buildings move orthogonally only", () => {
    expect([...cellNeighbors(cellOf(0, 0))].sort()).toEqual([cellOf(0, 1), cellOf(1, 0)].sort());
    expect(cellNeighbors(cellOf(2, 2))).toHaveLength(4);
  });
});

/** Round-1 police turn: deploy the 3 helicopters. */
function deploy(s: CityChaseState, points: Point[] = [pointOf(0, 0), pointOf(0, 5), pointOf(5, 5)]): CityChaseState {
  let out = s;
  points.forEach((at, heli) => {
    out = applyAction(out, { type: "HELI_PLACE", seat: heliController(out, heli), heli, at });
  });
  return out;
}

/** Any other police turn where every helicopter just flies one step. */
function flyAll(s: CityChaseState, pick: (options: readonly Point[]) => Point = (o) => o[0]): CityChaseState {
  let out = s;
  for (let h = 0; h < 3; h++) out = applyAction(out, { type: "HELI_MOVE", seat: heliController(out, h), heli: h, to: pick(pointNeighbors(out.helis[h])) });
  return out;
}

describe("city chase rules", () => {
  it("assigns roles and splits helicopters across the police team", () => {
    const s = startGame(3, 1);
    expect(s.thiefSeat).toBe(1);
    expect(s.policeSeats).toEqual([0, 2]);
    expect([0, 1, 2].map((h) => heliController(s, h))).toEqual([0, 2, 0]);
    expect(s.helis).toEqual([]);
    expect(currentActor(s)).toBe(1);
  });

  it("thief hides first, then the police deploy helicopters as their round-1 turn", () => {
    let s = startGame(3, 1);
    expect(legalThiefCells(s)).toHaveLength(25);
    s = applyAction(s, { type: "THIEF_MOVE", seat: 1, cell: cellOf(2, 2) });
    expect(s.phase).toBe("deploy");
    expect(s.heliHistory).toEqual([[]]); // the thief chose without seeing any helicopter
    expect(currentActor(s)).toBe(0);
    expect(legalPlacements(s)).toHaveLength(36);
    s = applyAction(s, { type: "HELI_PLACE", seat: 0, heli: 0, at: pointOf(2, 2) });
    // heli 1 belongs to seat 2; stacking on an occupied intersection is refused
    expect(currentActor(s)).toBe(2);
    expect(applyAction(s, { type: "HELI_PLACE", seat: 2, heli: 1, at: pointOf(2, 2) })).toBe(s);
    expect(legalPlacements(s)).not.toContain(pointOf(2, 2));
    s = applyAction(s, { type: "HELI_PLACE", seat: 2, heli: 1, at: pointOf(3, 3) });
    s = applyAction(s, { type: "HELI_PLACE", seat: 0, heli: 2, at: pointOf(0, 0) });
    // deploying ends round 1 — no search happened, the thief moves next
    expect(s.phase).toBe("thief");
    expect(s.round).toBe(2);
    expect(s.searches).toEqual([]);
    expect(s.helis).toEqual([pointOf(2, 2), pointOf(3, 3), pointOf(0, 0)]);
  });

  it("thief then only moves orthogonally", () => {
    let s = startGame(2, 0);
    s = applyAction(s, { type: "THIEF_MOVE", seat: 0, cell: cellOf(0, 0) });
    s = deploy(s);
    expect(legalThiefCells(s).sort()).toEqual([cellOf(0, 1), cellOf(1, 0)].sort());
    expect(applyAction(s, { type: "THIEF_MOVE", seat: 0, cell: cellOf(1, 1) })).toBe(s);
  });

  it("rejects actions from the wrong seat or wrong helicopter", () => {
    let s = startGame(2, 0);
    expect(applyAction(s, { type: "THIEF_MOVE", seat: 1, cell: 0 })).toBe(s);
    s = applyAction(s, { type: "THIEF_MOVE", seat: 0, cell: cellOf(4, 0) });
    expect(applyAction(s, { type: "HELI_PLACE", seat: 1, heli: 2, at: pointOf(1, 1) })).toBe(s);
    expect(applyAction(s, { type: "HELI_SEARCH", seat: 1, heli: 0, cell: cellOf(4, 0) })).toBe(s);
  });

  it("token colours: 1 yellow, 6 purple, 11 red, the rest blue", () => {
    expect(Array.from({ length: 11 }, (_, i) => tokenColor(i + 1))).toEqual([
      "yellow", "blue", "blue", "blue", "blue", "purple", "blue", "blue", "blue", "blue", "red",
    ]);
  });

  it("search reveals trail tokens and finding the car wins", () => {
    let s = startGame(2, 0);
    const skipOthers = () => {
      s = applyAction(s, { type: "HELI_MOVE", seat: 1, heli: 1, to: pointNeighbors(s.helis[1])[0] });
      s = applyAction(s, { type: "HELI_MOVE", seat: 1, heli: 2, to: pointNeighbors(s.helis[2])[0] });
    };
    // round 1: car under (1,1); police deploy heli 0 on point (1,2).
    s = applyAction(s, { type: "THIEF_MOVE", seat: 0, cell: cellOf(1, 1) });
    s = deploy(s, [pointOf(1, 2), pointOf(3, 4), pointOf(4, 1)]);
    // round 2: car moves to (2,1); (1,1) keeps the yellow start token.
    s = applyAction(s, { type: "THIEF_MOVE", seat: 0, cell: cellOf(2, 1) });
    s = applyAction(s, { type: "HELI_SEARCH", seat: 1, heli: 0, cell: cellOf(0, 1) });
    expect(s.searches[0]).toMatchObject({ result: "empty", tokens: [] });
    skipOthers();
    // round 3: car moves to (2,2); heli 0 finds the yellow token under (1,1).
    s = applyAction(s, { type: "THIEF_MOVE", seat: 0, cell: cellOf(2, 2) });
    s = applyAction(s, { type: "HELI_SEARCH", seat: 1, heli: 0, cell: cellOf(1, 1) });
    expect(s.searches.at(-1)).toMatchObject({ result: "trail", tokens: ["yellow"] });
    skipOthers();
    // round 4: (1,2) is found from point (1,2).
    s = applyAction(s, { type: "THIEF_MOVE", seat: 0, cell: cellOf(1, 2) });
    expect(s.heliHistory).toHaveLength(4);
    s = applyAction(s, { type: "HELI_SEARCH", seat: 1, heli: 0, cell: cellOf(1, 2) });
    expect(s.searches.at(-1)).toMatchObject({ result: "caught" });
    expect(s.phase).toBe("gameOver");
    expect(s.winner).toBe("police");
    expect(s.endReason).toBe("caught");
    expect(computeRankings(s)).toEqual([
      { seat: 0, rank: 2 },
      { seat: 1, rank: 1 },
    ]);
  });

  it("a building the car already visited can never be entered again", () => {
    let s = startGame(2, 0);
    s = applyAction(s, { type: "THIEF_MOVE", seat: 0, cell: cellOf(2, 2) });
    s = deploy(s);
    s = applyAction(s, { type: "THIEF_MOVE", seat: 0, cell: cellOf(2, 3) });
    s = flyAll(s);
    expect(legalThiefCells(s)).not.toContain(cellOf(2, 2));
    expect(applyAction(s, { type: "THIEF_MOVE", seat: 0, cell: cellOf(2, 2) })).toBe(s);
  });

  it("police win when the car drives into a dead end", () => {
    let s = startGame(2, 0);
    [cellOf(1, 0), cellOf(1, 1), cellOf(0, 1), cellOf(0, 0)].forEach((cell, i) => {
      s = applyAction(s, { type: "THIEF_MOVE", seat: 0, cell });
      s = i === 0 ? deploy(s, [pointOf(5, 0), pointOf(5, 3), pointOf(5, 5)]) : flyAll(s, (o) => o.at(-1)!);
    });
    expect(s.phase).toBe("gameOver");
    expect(s.winner).toBe("police");
    expect(s.endReason).toBe("trapped");
    expect(s.round).toBe(5);
  });

  it("thief escapes after surviving round 11's police turn", () => {
    let s = startGame(2, 0);
    const route = [
      cellOf(4, 0), cellOf(4, 1), cellOf(4, 2), cellOf(4, 3), cellOf(4, 4), cellOf(3, 4),
      cellOf(3, 3), cellOf(3, 2), cellOf(3, 1), cellOf(3, 0), cellOf(2, 0),
    ];
    for (let r = 1; r <= TOTAL_ROUNDS; r++) {
      s = applyAction(s, { type: "THIEF_MOVE", seat: 0, cell: route[r - 1] });
      s = r === 1 ? deploy(s) : flyAll(s);
    }
    expect(s.phase).toBe("gameOver");
    expect(s.winner).toBe("thief");
    expect(s.endReason).toBe("escaped");
    expect(s.path).toHaveLength(TOTAL_ROUNDS);
  });

  it("police belief never puts weight on a building just searched empty", () => {
    let s = startGame(2, 0);
    s = applyAction(s, { type: "THIEF_MOVE", seat: 0, cell: cellOf(4, 4) });
    s = deploy(s);
    s = applyAction(s, { type: "THIEF_MOVE", seat: 0, cell: cellOf(3, 4) });
    s = applyAction(s, { type: "HELI_SEARCH", seat: 1, heli: 0, cell: cellOf(0, 0) });
    const b = policeBelief(s.searches, s.heliHistory, s.round, 500, seededRng(3))!;
    expect(b[cellOf(0, 0)]).toBe(0);
    expect(b.reduce((a, v) => a + v, 0)).toBeCloseTo(1, 6);
  });
});

describe("city chase bots", () => {
  it("bot games always terminate legally across seat layouts", () => {
    const rng = seededRng(42);
    for (let g = 0; g < 20; g++) {
      const players = 2 + (g % 3);
      const end = play(startGame(players, g % players), 1 + (g % 10), 1 + ((g * 7) % 10), rng);
      expect(end.phase).toBe("gameOver");
      expect(end.winner).not.toBeNull();
    }
  }, 60_000);

  it("both sides win a meaningful share at equal strength", () => {
    const rng = seededRng(7);
    let thiefWins = 0;
    const games = 40;
    for (let g = 0; g < games; g++) {
      const end = play(startGame(2, 0), 6, 6, rng);
      if (end.winner === "thief") thiefWins++;
    }
    expect(thiefWins).toBeGreaterThan(games * 0.15);
    expect(thiefWins).toBeLessThan(games * 0.85);
  }, 60_000);
});
