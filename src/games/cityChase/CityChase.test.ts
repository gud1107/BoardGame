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
  HELI_START_POINTS,
  legalThiefCells,
  pointCells,
  pointNeighbors,
  pointOf,
  policeBelief,
  startGame,
  TOTAL_ROUNDS,
  type CityChaseState,
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

describe("city chase rules", () => {
  it("assigns roles and splits helicopters across the police team", () => {
    const s = startGame(3, 1);
    expect(s.thiefSeat).toBe(1);
    expect(s.policeSeats).toEqual([0, 2]);
    expect([0, 1, 2].map((h) => heliController(s, h))).toEqual([0, 2, 0]);
    expect(s.helis).toEqual([...HELI_START_POINTS]);
    expect(currentActor(s)).toBe(1);
  });

  it("thief starts anywhere, then only orthogonal moves", () => {
    let s = startGame(2, 0);
    expect(legalThiefCells(s)).toHaveLength(25);
    s = applyAction(s, { type: "THIEF_MOVE", seat: 0, cell: cellOf(0, 0) });
    expect(s.phase).toBe("police");
    // police turn: 3 helicopters move
    for (let h = 0; h < 3; h++) {
      s = applyAction(s, { type: "HELI_MOVE", seat: 1, heli: h, to: pointNeighbors(s.helis[h])[0] });
    }
    expect(s.phase).toBe("thief");
    expect(s.round).toBe(2);
    expect(legalThiefCells(s).sort()).toEqual([cellOf(0, 1), cellOf(1, 0)].sort());
    const illegal = applyAction(s, { type: "THIEF_MOVE", seat: 0, cell: cellOf(1, 1) });
    expect(illegal).toBe(s);
  });

  it("rejects actions from the wrong seat or wrong helicopter", () => {
    let s = startGame(2, 0);
    expect(applyAction(s, { type: "THIEF_MOVE", seat: 1, cell: 0 })).toBe(s);
    s = applyAction(s, { type: "THIEF_MOVE", seat: 0, cell: cellOf(4, 0) });
    expect(applyAction(s, { type: "HELI_MOVE", seat: 1, heli: 2, to: pointNeighbors(s.helis[2])[0] })).toBe(s);
  });

  it("search reveals trail tokens and finding the car wins", () => {
    // Put heli 0 on interior point (1,1) so it can reach four buildings.
    let s: CityChaseState = { ...startGame(2, 0), helis: [pointOf(1, 1), pointOf(3, 4), pointOf(4, 1)] };
    const skipOthers = () => {
      s = applyAction(s, { type: "HELI_MOVE", seat: 1, heli: 1, to: pointNeighbors(s.helis[1])[0] });
      s = applyAction(s, { type: "HELI_MOVE", seat: 1, heli: 2, to: pointNeighbors(s.helis[2])[0] });
    };
    // round 1: car under (1,1); heli 0 sits on point (1,1) and lifts (0,0) instead.
    s = applyAction(s, { type: "THIEF_MOVE", seat: 0, cell: cellOf(1, 1) });
    s = applyAction(s, { type: "HELI_SEARCH", seat: 1, heli: 0, cell: cellOf(0, 0) });
    expect(s.searches[0]).toMatchObject({ result: "empty", tokens: [] });
    skipOthers();
    // round 2: car moves to (1,2); (1,1) keeps the yellow start token.
    s = applyAction(s, { type: "THIEF_MOVE", seat: 0, cell: cellOf(1, 2) });
    s = applyAction(s, { type: "HELI_SEARCH", seat: 1, heli: 0, cell: cellOf(1, 1) });
    expect(s.searches.at(-1)).toMatchObject({ result: "trail", tokens: ["yellow"] });
    skipOthers();
    // round 3: (0,2); heli 0 flies to point (1,2).
    s = applyAction(s, { type: "THIEF_MOVE", seat: 0, cell: cellOf(0, 2) });
    s = applyAction(s, { type: "HELI_MOVE", seat: 1, heli: 0, to: pointOf(1, 2) });
    skipOthers();
    // round 4: (0,1) is found from point (1,2).
    s = applyAction(s, { type: "THIEF_MOVE", seat: 0, cell: cellOf(0, 1) });
    expect(s.heliHistory).toHaveLength(4);
    s = applyAction(s, { type: "HELI_SEARCH", seat: 1, heli: 0, cell: cellOf(0, 1) });
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
    const policePass = () => {
      for (let h = 0; h < 3; h++) s = applyAction(s, { type: "HELI_MOVE", seat: 1, heli: h, to: pointNeighbors(s.helis[h])[0] });
    };
    s = applyAction(s, { type: "THIEF_MOVE", seat: 0, cell: cellOf(2, 2) });
    policePass();
    s = applyAction(s, { type: "THIEF_MOVE", seat: 0, cell: cellOf(2, 3) });
    policePass();
    expect(legalThiefCells(s)).not.toContain(cellOf(2, 2));
    expect(applyAction(s, { type: "THIEF_MOVE", seat: 0, cell: cellOf(2, 2) })).toBe(s);
  });

  it("police win when the car drives into a dead end", () => {
    let s = startGame(2, 0);
    for (const cell of [cellOf(1, 0), cellOf(1, 1), cellOf(0, 1), cellOf(0, 0)]) {
      s = applyAction(s, { type: "THIEF_MOVE", seat: 0, cell });
      for (let h = 0; h < 3; h++) s = applyAction(s, { type: "HELI_MOVE", seat: 1, heli: h, to: pointNeighbors(s.helis[h]).at(-1)! });
    }
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
      for (let h = 0; h < 3; h++) {
        s = applyAction(s, { type: "HELI_MOVE", seat: 1, heli: h, to: pointNeighbors(s.helis[h])[0] });
      }
    }
    expect(s.phase).toBe("gameOver");
    expect(s.winner).toBe("thief");
    expect(s.endReason).toBe("escaped");
    expect(s.path).toHaveLength(TOTAL_ROUNDS);
  });

  it("police belief never puts weight on a building just searched empty", () => {
    let s = startGame(2, 0);
    s = applyAction(s, { type: "THIEF_MOVE", seat: 0, cell: cellOf(4, 4) });
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
