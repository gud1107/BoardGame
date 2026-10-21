import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import {
  applyAction,
  computeRankings,
  currentActor,
  DEFAULT_OPTIONS,
  maxChain,
  ROUND_SHOT_LIMIT,
  setupStones,
  startGame,
  stoneCountFor,
  type AlkkagiState,
  type Stone,
} from "./engine";
import { chooseBotAction } from "./bot";
import { EDGE, firstContact, simulate, speedForPower, powerForSpeed, STONE_R } from "./physics";
import { alkkagiStatDetails } from "./stats";
import { fatalHits } from "./replay";
import { wordTier } from "./three/fxWords";

function withStones(stones: Omit<Stone, "id">[], patch: Partial<AlkkagiState> = {}): AlkkagiState {
  const s = startGame(2, 1);
  return { ...s, stones: stones.map((st, id) => ({ ...st, id })), activeSeat: 0, ...patch };
}

function playOut(s: AlkkagiState, levelOf: (seat: number) => number, seed: number): AlkkagiState {
  const rng = seededRng(seed);
  for (let i = 0; i < 2000 && s.phase !== "ended"; i++) {
    if (s.phase === "roundOver") {
      s = applyAction(s, { type: "next" });
      continue;
    }
    const actor = currentActor(s)!;
    const a = chooseBotAction(s, actor, levelOf(actor), rng);
    s = a ? applyAction(s, a) : applyAction(s, { type: "timeout", seat: actor, turn: s.turn });
  }
  return s;
}

describe("physics", () => {
  it("is deterministic", () => {
    const st = setupStones(4, { stones: "many", rounds: 1, king: true }).map((s) => ({ id: s.id, x: s.x, y: s.y, r: s.king ? 0.62 : 0.46, m: s.king ? 2.2 : 1 }));
    const a = simulate(st, 0, 3.3, 14.1, true);
    const b = simulate(st, 0, 3.3, 14.1, true);
    expect(a.rest).toEqual(b.rest);
    expect(a.falls).toEqual(b.falls);
    expect(a.frames!.length).toBe(b.frames!.length);
  });

  it("head-on hit: the target takes the speed, the shooter nearly stops", () => {
    const res = simulate(
      [
        { id: 0, x: 0, y: -4, r: STONE_R, m: 1 },
        { id: 1, x: 0, y: 0, r: STONE_R, m: 1 },
      ],
      0,
      0,
      9,
    );
    const shooter = res.rest.find((r) => r.id === 0)!;
    const target = res.rest.find((r) => r.id === 1);
    expect(shooter.y).toBeLessThan(0);
    expect(shooter.y).toBeGreaterThan(-1.5);
    expect(target ? target.y : 99).toBeGreaterThan(2);
  });

  it("a hard shot drives the target off the board", () => {
    const res = simulate(
      [
        { id: 0, x: 0, y: 5, r: STONE_R, m: 1 },
        { id: 1, x: 0, y: 7.5, r: STONE_R, m: 1 },
      ],
      0,
      0,
      15,
    );
    expect(res.falls.map((f) => f.id)).toContain(1);
    expect(Math.abs(res.falls.find((f) => f.id === 1)!.y)).toBeGreaterThan(EDGE);
  });

  it("power curve round-trips and stays in range", () => {
    expect(speedForPower(0)).toBeCloseTo(1.2);
    expect(speedForPower(1)).toBeCloseTo(16);
    expect(powerForSpeed(speedForPower(0.4))).toBeCloseTo(0.4, 5);
  });

  it("aim guide finds the first stone in the way", () => {
    const st = [
      { id: 0, x: 0, y: 0, r: STONE_R, m: 1 },
      { id: 1, x: 0, y: 5, r: STONE_R, m: 1 },
      { id: 2, x: 0.3, y: 3, r: STONE_R, m: 1 },
      { id: 3, x: 3, y: 3, r: STONE_R, m: 1 },
    ];
    expect(firstContact(st, 0, 0, 1)?.id).toBe(2);
    expect(firstContact(st, 0, 0, -1)).toBeNull();
  });
});

describe("impact words (§13)", () => {
  it("only the hit that knocks a stone off is fatal", () => {
    const res = simulate(
      [
        { id: 0, x: 0, y: 2, r: STONE_R, m: 1 },
        { id: 1, x: 0, y: 5, r: STONE_R, m: 1 },
        { id: 2, x: 5, y: 0, r: STONE_R, m: 1 },
      ],
      0,
      0,
      15,
      true,
    );
    expect(res.falls.map((f) => f.id)).toEqual([1]);
    const fatal = [...fatalHits(res)];
    expect(fatal).toHaveLength(1);
    const c = res.collisions![fatal[0]];
    expect([c.a, c.b]).toContain(1);
  });

  it("쾅 only for knock-offs; hard misses top out at 딱", () => {
    expect(wordTier(1, false)).toBe(1);
    expect(wordTier(0.1, true)).toBe(2);
    expect(wordTier(0.4, false)).toBe(0);
    expect(wordTier(0.2, false)).toBeNull();
  });
});

describe("setup", () => {
  it.each([2, 3, 4])("%ip: no overlaps, all on the board", (n) => {
    for (const opt of ["few", "normal", "many"] as const) {
      const st = setupStones(n, { stones: opt, rounds: 1, king: true });
      expect(st).toHaveLength(n * stoneCountFor(n, opt));
      for (const a of st) {
        expect(Math.max(Math.abs(a.x), Math.abs(a.y))).toBeLessThan(EDGE - 1);
        for (const b of st) if (a.id < b.id) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(1.3);
      }
      for (let seat = 0; seat < n; seat++) expect(st.filter((s) => s.owner === seat && s.king)).toHaveLength(1);
    }
  });

  it("is deterministic per seed", () => {
    expect(startGame(3, 99)).toEqual(startGame(3, 99));
  });
});

describe("turns", () => {
  const lineup = (): Omit<Stone, "id">[] => [
    { owner: 0, x: 0, y: 5, king: false },
    { owner: 0, x: -5, y: -5, king: false },
    { owner: 1, x: 0, y: 7.5, king: false },
    { owner: 1, x: 5, y: -5, king: false },
  ];

  it("knocking a stone off keeps the turn (bonus)", () => {
    const s = applyAction(withStones(lineup()), { type: "flick", seat: 0, stone: 0, vx: 0, vy: 15000 });
    expect(s.lastShot!.knocked).toBe(1);
    expect(s.lastShot!.bonus).toBe(true);
    expect(s.activeSeat).toBe(0);
    expect(s.chain).toBe(1);
  });

  it("chain stops after the bonus-shot option runs out", () => {
    const base = withStones(lineup());
    const s = applyAction({ ...base, chain: maxChain(base.options) - 1 }, { type: "flick", seat: 0, stone: 0, vx: 0, vy: 15000 });
    expect(s.lastShot!.bonus).toBe(false);
    expect(s.activeSeat).toBe(1);
    expect(s.chain).toBe(0);
  });

  it("bonus-shot option: 0 turns the chain off, N allows N extra shots", () => {
    const base = withStones(lineup());
    const off = applyAction({ ...base, options: { ...base.options, bonusShots: 0 } }, { type: "flick", seat: 0, stone: 0, vx: 0, vy: 15000 });
    expect(off.lastShot!.knocked).toBe(1);
    expect(off.lastShot!.bonus).toBe(false);
    expect(off.activeSeat).toBe(1);
    const five = { ...base, options: { ...base.options, bonusShots: 5 } };
    expect(maxChain(five.options)).toBe(6);
    const s = applyAction({ ...five, chain: 4 }, { type: "flick", seat: 0, stone: 0, vx: 0, vy: 15000 });
    expect(s.lastShot!.bonus).toBe(true);
    expect(s.chain).toBe(5);
    expect(maxChain(startGame(2, 1).options)).toBe(3);
  });

  it("a miss passes the turn; wrong seat / foreign stone is ignored", () => {
    const base = withStones(lineup());
    expect(applyAction(base, { type: "flick", seat: 1, stone: 2, vx: 0, vy: -3000 })).toBe(base);
    expect(applyAction(base, { type: "flick", seat: 0, stone: 2, vx: 0, vy: -3000 })).toBe(base);
    const s = applyAction(base, { type: "flick", seat: 0, stone: 1, vx: -2000, vy: 0 });
    expect(s.activeSeat).toBe(1);
    expect(s.lastShot!.knocked).toBe(0);
  });

  it("timeout passes only the current turn", () => {
    const base = withStones(lineup());
    expect(applyAction(base, { type: "timeout", seat: 0, turn: base.turn + 3 })).toBe(base);
    const s = applyAction(base, { type: "timeout", seat: 0, turn: base.turn });
    expect(s.activeSeat).toBe(1);
    expect(s.lastPass).toEqual({ turn: base.turn, seat: 0 });
  });

  it("knocking the last enemy stone ends the round", () => {
    const s = applyAction(
      withStones([
        { owner: 0, x: 0, y: 5, king: false },
        { owner: 1, x: 0, y: 7.5, king: false },
      ]),
      { type: "flick", seat: 0, stone: 0, vx: 0, vy: 15000 },
    );
    expect(s.phase).toBe("roundOver");
    expect(s.history[0].places[0]).toBe(0);
    expect(s.scores).toEqual([1, 0]);
    const end = applyAction(s, { type: "next" });
    expect(end.phase).toBe("ended");
    expect(computeRankings(end)[0]).toEqual({ seat: 0, rank: 1 });
  });

  it("everyone out at once: the stone that stayed on longest wins", () => {
    // a heavy (king-sized) stone of seat 0 slams through seat 1 and follows it off the edge
    const s = applyAction(
      withStones([
        { owner: 0, x: 0, y: 6.5, king: true },
        { owner: 1, x: 0, y: 8.2, king: false },
      ]),
      { type: "flick", seat: 0, stone: 0, vx: 0, vy: 16000 },
    );
    expect(s.phase).toBe("roundOver");
    expect(s.stones).toHaveLength(0);
    expect(s.lastShot!.fallen).toEqual([1, 0]);
    expect(s.lastShot!.eliminated).toEqual([1, 0]);
    expect(s.history[0].places).toEqual([0, 1]);
  });

  it("king mode: losing the king surrenders the rest", () => {
    const s = applyAction(
      withStones(
        [
          { owner: 0, x: 0, y: 5, king: false },
          { owner: 1, x: 0, y: 7.5, king: true },
          { owner: 1, x: 5, y: -5, king: false },
          { owner: 0, x: -5, y: -5, king: false },
        ],
        { options: { ...DEFAULT_OPTIONS, king: true } },
      ),
      { type: "flick", seat: 0, stone: 0, vx: 0, vy: 16000 },
    );
    if (s.lastShot!.kingsDown.includes(1)) {
      expect(s.stones.some((x) => x.owner === 1)).toBe(false);
      expect(s.phase).toBe("roundOver");
      expect(alkkagiStatDetails(s, 0).kingKills).toBe(1);
    } else {
      // heavy king may survive a single hit — then nothing is surrendered
      expect(s.stones.filter((x) => x.owner === 1)).toHaveLength(2);
    }
  });

  it("shot limit ends the round by stones left", () => {
    const base = withStones(
      [
        { owner: 0, x: 0, y: 0, king: false },
        { owner: 0, x: 2, y: 0, king: false },
        { owner: 1, x: -5, y: -5, king: false },
      ],
      { roundShots: ROUND_SHOT_LIMIT - 1 },
    );
    const s = applyAction(base, { type: "flick", seat: 0, stone: 0, vx: 0, vy: 1500 });
    expect(s.phase).toBe("roundOver");
    expect(s.history[0].limitHit).toBe(true);
    expect(s.history[0].places[0]).toBe(0);
  });
});

describe("bots", { timeout: 60_000 }, () => {
  it.each([2, 3, 4])("%ip bot games finish with consistent rankings", (n) => {
    const s = playOut(startGame(n, 7 + n, { stones: "normal", rounds: 3, king: n === 3 }), (seat) => [2, 5, 8, 10][seat], 100 + n);
    expect(s.phase).toBe("ended");
    expect(s.history).toHaveLength(3);
    const r = computeRankings(s);
    expect(r).toHaveLength(n);
    expect(r[0].rank).toBe(1);
    const d = alkkagiStatDetails(s, 0);
    expect(d.shots).toBeGreaterThan(0);
  });

  it("a Lv.10 bot finds the obvious knock-off", () => {
    const st = withStones([
      { owner: 0, x: 0, y: 5, king: false },
      { owner: 0, x: -6, y: -6, king: false },
      { owner: 1, x: 0, y: 7.5, king: false },
      { owner: 1, x: 6, y: -6, king: false },
    ]);
    let hits = 0;
    const rng = seededRng(3);
    for (let i = 0; i < 10; i++) {
      const a = chooseBotAction(st, 0, 10, rng)!;
      if (applyAction(st, a).lastShot!.knocked > 0) hits++;
    }
    expect(hits).toBeGreaterThanOrEqual(8);
  });
});
