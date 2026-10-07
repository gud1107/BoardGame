import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import { analyzeWeapon, dcos, dsin, totalInk, type Stroke } from "./analyze";
import {
  applyAction,
  applyMove,
  botDoodle,
  MAX_MOVE,
  MOVE_INK_PER_PX,
  resolveMove,
  chooseBotAction,
  computeRankings,
  currentActor,
  FROZEN_INK,
  getValidMoves,
  startGame,
  wallPlacementError,
  type EngineAction,
  type InkDuelState,
} from "./engine";
import { surfaceY } from "./physics";

function line(x0: number, y0: number, x1: number, y1: number, steps = 20, c: Stroke["c"] = 0): Stroke {
  const p: number[] = [];
  for (let i = 0; i <= steps; i++) p.push(Math.round(x0 + ((x1 - x0) * i) / steps), Math.round(y0 + ((y1 - y0) * i) / steps));
  return { c, p };
}

function circle(r: number, c: Stroke["c"] = 0): Stroke {
  const p: number[] = [];
  for (let i = 0; i <= 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    p.push(Math.round(100 + r * Math.cos(a)), Math.round(100 + r * Math.sin(a)));
  }
  return { c, p };
}

function zigzag(c: Stroke["c"] = 0): Stroke {
  const p: number[] = [];
  for (let i = 0; i <= 10; i++) p.push(20 + i * 16, i % 2 === 0 ? 70 : 130);
  return { c, p };
}

describe("deterministic trig", () => {
  it("matches Math.sin/cos closely across the range", () => {
    for (let x = -20; x <= 20; x += 0.37) {
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(1e-8);
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(1e-8);
    }
  });
});

describe("analyzeWeapon", () => {
  it("classifies a straight line as a piercing spear", () => {
    const s = analyzeWeapon([line(10, 100, 190, 100)]);
    expect(s.kind).toBe("spear");
    expect(s.pierce).toBe(true);
    expect(s.spin).toBe(0);
  });
  it("classifies a closed circle as a bomb whose blast grows with area", () => {
    const small = analyzeWeapon([circle(30)]);
    const big = analyzeWeapon([circle(80)]);
    expect(small.kind).toBe("bomb");
    expect(big.kind).toBe("bomb");
    expect(big.blastRadius).toBeGreaterThan(small.blastRadius);
    // Heavier doodle flies slower.
    expect(big.speedMul).toBeLessThan(small.speedMul);
  });
  it("classifies a zigzag as chaining lightning with spikes for crits", () => {
    const s = analyzeWeapon([zigzag()]);
    expect(s.kind).toBe("lightning");
    expect(s.chains).toBeGreaterThanOrEqual(1);
    expect(s.critChance).toBeGreaterThan(0);
  });
  it("uses the ink-dominant color as the element", () => {
    expect(analyzeWeapon([line(10, 100, 190, 100, 20, 1)]).element).toBe("fire");
    expect(analyzeWeapon([zigzag(4)]).element).toBe("shock");
    expect(analyzeWeapon([zigzag(4)]).chains).toBe(analyzeWeapon([zigzag(0)]).chains + 1);
  });
});

describe("reducer", () => {
  it("rejects out-of-turn and over-budget actions", () => {
    const s = startGame(2, 42);
    const other = (s.turnSeat + 1) % 2;
    expect(applyAction(s, { type: "pass", seat: other })).toBe(s);
    const huge: Stroke[] = [];
    for (let k = 0; k < 6; k++) huge.push(line(0, k * 30, 200, k * 30 + 10));
    expect(totalInk(huge)).toBeGreaterThan(100);
    expect(applyAction(s, { type: "fire", seat: s.turnSeat, strokes: huge, angle: 45, power: 50 })).toBe(s);
  });

  it("is deterministic: the same shot from the same state gives identical results", () => {
    const s = startGame(3, 7);
    const action: EngineAction = { type: "fire", seat: s.turnSeat, strokes: [circle(50, 1)], angle: 60, power: 70 };
    expect(JSON.stringify(applyAction(s, action))).toBe(JSON.stringify(applyAction(s, action)));
  });

  it("a direct bomb drop on a target deals damage and carves a crater", () => {
    let s = startGame(2, 11);
    const shooter = s.turnSeat;
    const target = 1 - shooter;
    // Put the target right next to the shooter so a lob straight up comes down on them.
    s = { ...s, players: s.players.map((p) => (p.seat === target ? { ...p, x: s.players[shooter].x + 8, y: surfaceY(s.terrain, s.players[shooter].x + 8) } : p)) };
    const next = applyAction(s, { type: "fire", seat: shooter, strokes: [circle(60, 2)], angle: 90, power: 40 });
    const ev = next.lastEvent;
    expect(ev?.kind).toBe("shot");
    if (ev?.kind !== "shot") return;
    expect(ev.impact).not.toBeNull();
    expect(ev.hits.some((h) => h.seat === target && h.dmg > 0)).toBe(true);
    expect(next.players[target].hp).toBeLessThan(100);
    expect(next.players[target].frozen).toBe(true);
    expect(next.turnSeat).toBe(target);
    expect(next.inkBudget).toBe(FROZEN_INK);
    expect(ev.craterRadius).toBeGreaterThan(0);
  });

  it("validates wall placement range", () => {
    const s = startGame(2, 5);
    const me = s.players[s.turnSeat];
    const x = Math.round(me.x + (me.x < 480 ? 50 : -50));
    const g = Math.round(surfaceY(s.terrain, x));
    const ok = [line(x, g - 90, x, g - 6, 12)];
    expect(wallPlacementError(s, s.turnSeat, ok)).toBeNull();
    const next = applyAction(s, { type: "wall", seat: s.turnSeat, strokes: ok });
    expect(next.walls).toHaveLength(1);
    const far = [line(me.x < 480 ? 900 : 20, 50, me.x < 480 ? 900 : 20, 120, 8)];
    expect(wallPlacementError(s, s.turnSeat, far)).not.toBeNull();
  });
});

describe("movement", () => {
  it("walking costs ink, moves the shooter, and is recorded on the event", () => {
    const s = startGame(2, 21);
    const seat = s.turnSeat;
    const me = s.players[seat];
    const dir = me.x < 480 ? -1 : 1; // walk away from the middle so nobody blocks
    const moved = applyMove(s, seat, dir * 40);
    expect(moved).not.toBeNull();
    expect(moved!.players[seat].x).toBe(me.x + dir * 40);
    expect(moved!.inkBudget).toBe(100 - 40 * MOVE_INK_PER_PX);
    const next = applyAction(s, { type: "pass", seat, move: dir * 40 });
    expect(next.players[seat].x).toBe(me.x + dir * 40);
    expect(next.lastEvent?.move).toEqual({ from: me.x, to: me.x + dir * 40 });
  });

  it("rejects walks beyond MAX_MOVE and walks whose ink + doodle exceed the budget", () => {
    const s = startGame(2, 22);
    const seat = s.turnSeat;
    expect(applyAction(s, { type: "pass", seat, move: MAX_MOVE + 1 })).toBe(s);
    const heavy: Stroke[] = [line(0, 10, 200, 10, 20), line(0, 60, 200, 60, 20)];
    expect(totalInk(heavy)).toBeGreaterThan(100 - MAX_MOVE * MOVE_INK_PER_PX);
    expect(totalInk(heavy)).toBeLessThanOrEqual(100);
    const dir = s.players[seat].x < 480 ? -1 : 1;
    expect(applyAction(s, { type: "fire", seat, strokes: heavy, angle: 45, power: 50, move: dir * MAX_MOVE })).toBe(s);
  });

  it("stops short of other players and ground-standing walls", () => {
    let s = startGame(2, 23);
    const seat = s.turnSeat;
    const other = 1 - seat;
    const me = s.players[seat];
    s = { ...s, players: s.players.map((p) => (p.seat === other ? { ...p, x: me.x + 50 } : p)) };
    expect(resolveMove(s, seat, 80)).toBe(me.x + 50 - 36);
    const g = Math.round(surfaceY(s.terrain, me.x - 30));
    s = { ...s, walls: [{ id: 1, owner: other, strokes: [[me.x - 30, g - 2, me.x - 30, g - 60]], hp: 20, maxHp: 20, color: 0 }] };
    expect(resolveMove(s, seat, -80)).toBe(me.x - 30 + 10);
  });
});

describe("bots", () => {
  it("getValidMoves only offers moves to the actor, all legal", () => {
    const s = startGame(3, 99);
    const other = (s.turnSeat + 1) % 3;
    expect(getValidMoves(s, other)).toEqual([]);
    for (const m of getValidMoves(s, s.turnSeat)) expect(applyAction(s, m)).not.toBe(s);
  });

  it("bot doodles fit the frozen ink budget", () => {
    const rng = seededRng(3);
    for (const t of ["spear", "bomb", "lightning", "club"] as const) {
      expect(totalInk(botDoodle(t, 0, FROZEN_INK, rng))).toBeLessThanOrEqual(FROZEN_INK);
    }
  });

  it("Lv.1 and Lv.10 can pick differently from the same rng", () => {
    const s = startGame(2, 1234);
    const a1 = chooseBotAction(s, s.turnSeat, 1, () => 0);
    const a10 = chooseBotAction(s, s.turnSeat, 10, () => 0);
    expect(a1).not.toBeNull();
    expect(a10).not.toBeNull();
    expect(JSON.stringify(a1)).not.toBe(JSON.stringify(a10));
  });

  it("bot-vs-bot games always finish with a legal action every turn", () => {
    for (const [count, seed] of [
      [2, 1],
      [3, 2],
      [4, 3],
    ] as const) {
      const rng = seededRng(seed * 77);
      let s: InkDuelState = startGame(count, seed);
      let steps = 0;
      while (s.phase === "playing" && steps < 200) {
        const actor = currentActor(s)!;
        const action = chooseBotAction(s, actor, 8, rng);
        expect(action).not.toBeNull();
        const next = applyAction(s, action!);
        expect(next).not.toBe(s);
        s = next;
        steps++;
      }
      expect(s.phase).toBe("gameOver");
      const ranks = computeRankings(s);
      expect(ranks).toHaveLength(count);
      expect(ranks.some((r) => r.rank === 1)).toBe(true);
    }
  }, 60_000);
});
