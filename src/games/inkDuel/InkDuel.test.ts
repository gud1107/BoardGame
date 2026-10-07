import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import { analyzeWeapon, dcos, dsin, totalInk, type Stroke } from "./analyze";
import {
  applyAction,
  applyMove,
  botDoodle,
  MAX_MOVE,
  maxMoveFor,
  MOVE_INK_PER_PX,
  resolveMove,
  chooseBotAction,
  computeRankings,
  currentActor,
  FROZEN_INK,
  getValidMoves,
  hasShield,
  SHIELD_GUARD,
  startGame,
  wallPlacementError,
  type EngineAction,
  type InkDuelState,
} from "./engine";
import { surfaceY } from "./physics";
import { MAP_IDS } from "./maps";
import { newBotMemory, RT_INK_MAX, RT_SHIELD_MS, rtBotThink, startRealtime, stepRealtime } from "./realtime";
import { RtClientBuffer, snapFromState } from "./rtView";

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
    expect(next.players[target].status.freeze).toBeGreaterThan(0);
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

function arc(c: Stroke["c"] = 0): Stroke {
  // Smooth ~200° "C" arc.
  const p: number[] = [];
  for (let i = 0; i <= 24; i++) {
    const a = -1.75 + (i / 24) * 3.5;
    p.push(Math.round(100 + 60 * Math.cos(a)), Math.round(100 + 60 * Math.sin(a)));
  }
  return { c, p };
}

describe("status effects (stop mode)", () => {
  /** Two players side by side so a straight-down lob always hits the target. */
  function closeRange(seed: number) {
    const base = startGame(2, seed);
    const shooter = base.turnSeat;
    const target = 1 - shooter;
    const tx = base.players[shooter].x + 8;
    const s = { ...base, players: base.players.map((p) => (p.seat === target ? { ...p, x: tx, y: surfaceY(base.terrain, tx) } : p)) };
    return { s, shooter, target };
  }
  const lob = (seat: number, c: Stroke["c"]): EngineAction => ({ type: "fire", seat, strokes: [circle(60, c)], angle: 90, power: 40 });

  it("brown ink stuns: the victim's next turn is skipped, then they're immune once", () => {
    const { s, shooter, target } = closeRange(11);
    const hit = applyAction(s, lob(shooter, 6));
    // Turn went past the stunned target straight back to the shooter.
    expect(hit.turnSeat).toBe(shooter);
    expect(hit.lastEvent?.dots.some((d) => d.kind === "stun" && d.seat === target)).toBe(true);
    expect(hit.players[target].stunImmune).toBe(true);
  });

  it("pink ink heals the shooter by 40% of the damage dealt", () => {
    const { s, shooter } = closeRange(11);
    const hurt = { ...s, players: s.players.map((p) => (p.seat === shooter ? { ...p, hp: 50 } : p)) };
    const after = applyAction(hurt, lob(shooter, 9));
    const ev = after.lastEvent;
    if (ev?.kind !== "shot") throw new Error("shot expected");
    expect(ev.heal).toBeGreaterThan(0);
  });

  it("orange ink makes the target vulnerable, which raises the next hit's damage", () => {
    const { s, shooter, target } = closeRange(11);
    const plain = applyAction(s, lob(shooter, 0)).lastEvent;
    const vuln = applyAction({ ...s, players: s.players.map((p) => (p.seat === target ? { ...p, status: { vulnerable: 2 } } : p)) }, lob(shooter, 0)).lastEvent;
    if (plain?.kind !== "shot" || vuln?.kind !== "shot") throw new Error("shots expected");
    expect(vuln.hits.find((h) => h.seat === target)!.dmg).toBeGreaterThan(plain.hits.find((h) => h.seat === target)!.dmg);
  });

  it("slow halves the walk range; confuse knocks the fired angle off", () => {
    const s = startGame(2, 21);
    const seat = s.turnSeat;
    const slowed = { ...s, players: s.players.map((p) => (p.seat === seat ? { ...p, status: { slow: 1 } } : p)) };
    expect(maxMoveFor(slowed, seat)).toBe(MAX_MOVE / 2);
    expect(applyMove(slowed, seat, MAX_MOVE)).toBeNull();
    const confused = { ...s, players: s.players.map((p) => (p.seat === seat ? { ...p, status: { confuse: 1 } } : p)) };
    const ev = applyAction(confused, { type: "fire", seat, strokes: [circle(40)], angle: 90, power: 50 }).lastEvent;
    if (ev?.kind !== "shot") throw new Error("shot expected");
    expect(ev.confusedAngle).toBeDefined();
    expect(ev.angle).not.toBe(90);
  });
});

describe("shape freedom", () => {
  it("every archetype's reference doodle is classified as that weapon", () => {
    const rng = seededRng(5);
    for (const kind of ["spear", "bomb", "rocket", "anvil", "shuriken", "lightning", "boomerang", "drill", "wave", "cluster", "club"] as const) {
      expect([kind, analyzeWeapon(botDoodle(kind, 0, 100, rng)).kind]).toEqual([kind, kind]);
    }
  });

  it("two crossed straight lines make a shuriken; a strong second color adds a second element", () => {
    expect(analyzeWeapon([line(20, 20, 180, 180), line(20, 180, 180, 20)]).kind).toBe("shuriken");
    const dual = analyzeWeapon([{ ...circle(50, 1) }, { ...circle(40, 2) }]);
    expect(dual.element).toBe("fire");
    expect(dual.element2).toBe("ice");
  });

  it("scatter bursts several times, wave shoves the target away", () => {
    let s = startGame(2, 11);
    const shooter = s.turnSeat;
    const target = 1 - shooter;
    s = { ...s, players: s.players.map((p) => (p.seat === target ? { ...p, x: s.players[shooter].x + 8, y: surfaceY(s.terrain, s.players[shooter].x + 8) } : p)) };
    const scatter = applyAction(s, { type: "fire", seat: shooter, strokes: botDoodle("cluster", 0, 100, seededRng(1)), angle: 90, power: 40 }).lastEvent;
    if (scatter?.kind !== "shot") throw new Error("shot expected");
    expect(scatter.stats.kind).toBe("cluster");
    expect(scatter.pelletPoints.length).toBeGreaterThanOrEqual(6);
    const waved = applyAction(s, { type: "fire", seat: shooter, strokes: botDoodle("wave", 0, 100, seededRng(1)), angle: 90, power: 40 });
    const ev = waved.lastEvent;
    if (ev?.kind !== "shot") throw new Error("shot expected");
    if (ev.hits.some((h) => h.seat === target)) expect(waved.players[target].x).not.toBe(s.players[target].x);
  });
});

describe("boomerang", () => {
  it("classifies a smooth C arc as a boomerang (not a club)", () => {
    const s = analyzeWeapon([arc()]);
    expect(s.kind).toBe("boomerang");
    expect(s.returnAcc).toBeGreaterThan(0);
  });

  it("comes back: thrown straight out with nobody in the way, it reverses and the thrower catches it", () => {
    let s = startGame(2, 31);
    const seat = s.turnSeat;
    // Park the other player far away on the opposite side so the throw meets nobody.
    const me = s.players[seat];
    const dir = me.x < 480 ? 1 : -1;
    s = { ...s, wind: 0, players: s.players.map((p) => (p.seat === seat ? p : { ...p, x: me.x < 480 ? 20 : 940 })) };
    const next = applyAction(s, { type: "fire", seat, strokes: [arc()], angle: dir > 0 ? 60 : 120, power: 60 });
    const ev = next.lastEvent;
    expect(ev?.kind).toBe("shot");
    if (ev?.kind !== "shot") return;
    const xs = ev.frames.filter((_, i) => i % 4 === 0);
    const far = dir > 0 ? Math.max(...xs) : Math.min(...xs);
    expect(Math.abs(far - me.x)).toBeGreaterThan(40);
    // It turns around and comes back into the thrower's hands.
    expect(ev.caught).toBe(true);
    expect(Math.abs(xs[xs.length - 1] - me.x)).toBeLessThan(40);
  });
});

describe("shield", () => {
  it("stands next to the player, cuts damage taken, and expires when the owner's turn comes back", () => {
    let s = startGame(2, 41);
    const a = s.turnSeat;
    const b = 1 - a;
    const shieldAction: EngineAction = { type: "shield", seat: a, strokes: [circle(45, 2)], angle: 90 };
    s = applyAction(s, shieldAction);
    expect(s.lastEvent?.kind).toBe("shield");
    expect(s.walls.filter((w) => w.shieldOf === a)).toHaveLength(1);
    expect(hasShield(s.walls, a)).toBe(true);
    // b passes → a's turn starts → shield is gone.
    s = applyAction(s, { type: "pass", seat: b });
    expect(s.turnSeat).toBe(a);
    expect(s.walls.some((w) => w.shieldOf === a)).toBe(false);
  });

  it("damage to a shielded player is reduced by SHIELD_GUARD", () => {
    const base = startGame(2, 11);
    const shooter = base.turnSeat;
    const target = 1 - shooter;
    const s = { ...base, players: base.players.map((p) => (p.seat === target ? { ...p, x: base.players[shooter].x + 8, y: surfaceY(base.terrain, base.players[shooter].x + 8) } : p)) };
    const fire: EngineAction = { type: "fire", seat: shooter, strokes: [circle(60, 0)], angle: 90, power: 40 };
    const plain = applyAction(s, fire).lastEvent;
    // A far-away dummy shield still grants the guard (it's an aura while the shield stands).
    const guarded = applyAction({ ...s, walls: [{ id: 99, owner: target, shieldOf: target, strokes: [[5, 5, 6, 6]], hp: 50, maxHp: 50, color: 2 }] }, fire).lastEvent;
    if (plain?.kind !== "shot" || guarded?.kind !== "shot") throw new Error("expected shots");
    const p = plain.hits.find((h) => h.seat === target)!.dmg;
    const g = guarded.hits.find((h) => h.seat === target)!.dmg;
    expect(g).toBeLessThan(p);
    expect(Math.abs(g - p * SHIELD_GUARD)).toBeLessThanOrEqual(1.5);
  });
});

describe("characters & maps", () => {
  it("honours unique picks and deals the rest deterministically without duplicates", () => {
    const s = startGame(4, 7, { characters: [3, 3, null, 5] });
    expect(s.characters[0]).toBe(3);
    expect(s.characters[3]).toBe(5);
    expect(new Set(s.characters).size).toBe(4);
    expect(startGame(4, 7, { characters: [3, 3, null, 5] }).characters).toEqual(s.characters);
  });

  it("each map changes the terrain, the meadow stays identical to the legacy generator", () => {
    const meadow = startGame(2, 99).terrain;
    expect(startGame(2, 99, { map: "meadow" }).terrain).toEqual(meadow);
    for (const m of MAP_IDS) {
      const s = startGame(2, 99, { map: m });
      expect(s.map).toBe(m);
      if (m !== "meadow") expect(s.terrain).not.toEqual(meadow);
    }
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

describe("moving mode (realtime)", () => {
  const still = { left: false, right: false, jump: false };

  it("walks with held keys; slow halves the pace; stun freezes the player", () => {
    const run = (status: Record<string, number>) => {
      const s = startRealtime(2, 3);
      const seat = 0;
      s.players[seat].x = 300;
      s.players[seat].y = surfaceY(s.terrain, 300);
      s.players[seat].status = status;
      const x0 = s.players[seat].x;
      for (let i = 0; i < 30; i++) stepRealtime(s, 1000 / 60, { [seat]: { ...still, right: true } }, [], () => 0.5);
      return s.players[seat].x - x0;
    };
    const normal = run({});
    expect(normal).toBeGreaterThan(20);
    expect(run({ slow: 99999 })).toBeLessThan(normal * 0.7);
    expect(run({ stun: 99999 })).toBe(0);
  });

  it("firing spends ink, starts the cooldown and spawns a doodle; too little ink is refused", () => {
    const s = startRealtime(2, 4);
    const strokes = [circle(50)];
    stepRealtime(s, 16, {}, [{ type: "fire", seat: 0, strokes, angle: 60, power: 60 }], () => 0.5);
    expect(s.projectiles).toHaveLength(1);
    expect(s.players[0].ink).toBeLessThan(RT_INK_MAX);
    expect(s.players[0].cooldownMs).toBeGreaterThan(0);
    const broke = startRealtime(2, 4);
    broke.players[0].ink = 5;
    stepRealtime(broke, 16, {}, [{ type: "fire", seat: 0, strokes, angle: 60, power: 60 }], () => 0.5);
    expect(broke.projectiles).toHaveLength(0);
  });

  it("a shield fades out after RT_SHIELD_MS", () => {
    const s = startRealtime(2, 5);
    stepRealtime(s, 16, {}, [{ type: "shield", seat: 0, strokes: [circle(40)], angle: 90 }], () => 0.5);
    expect(s.walls.some((w) => w.shieldOf === 0)).toBe(true);
    for (let t = 0; t < RT_SHIELD_MS + 500; t += 100) stepRealtime(s, 100, {}, [], () => 0.5);
    expect(s.walls.some((w) => w.shieldOf === 0)).toBe(false);
  });

  it("bot-vs-bot real-time matches end, and snapshots rebuild the world on a guest", () => {
    const rng = seededRng(9);
    const s = startRealtime(3, 21);
    const mems = s.players.map(() => newBotMemory(rng));
    let steps = 0;
    while (s.phase === "playing" && steps < 20000) {
      const cmds = s.players.map((p) => rtBotThink(s, p.seat, 7, mems[p.seat], rng)).filter((c) => c !== null);
      stepRealtime(s, 1000 / 60, Object.fromEntries(s.players.map((p) => [p.seat, mems[p.seat].input])), cmds, rng);
      steps++;
    }
    expect(s.phase).toBe("gameOver");
    expect(computeRankings(s).some((r) => r.rank === 1)).toBe(true);
    const buf = new RtClientBuffer();
    buf.push(snapFromState(s, { full: true }), 0);
    const view = buf.view(500)!;
    expect(view.terrain).toEqual(s.terrain);
    expect(view.players.map((p) => p.hp)).toEqual(s.players.map((p) => Math.round(p.hp)));
  }, 60_000);
});
