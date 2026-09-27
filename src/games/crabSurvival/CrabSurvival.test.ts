import { describe, expect, it } from "vitest";
import { LEVELS, levelForScore, POOL_HEAL_RATE, SHIELDS, STAMINA_MAX } from "./data";
import { addScore, botThink, createWorld, player, revivePlayer, step, summarize, swing, updateLeaderboard, type Crab, type CrabInput, type World } from "./engine";

const idle: CrabInput = { moveX: 0, moveY: 0, boost: false, attack: false };

/** A world with nothing but the player (and optional extra bots) on a bare beach. */
function bare(bots = 0): World {
  const w = createWorld({ playerName: "나", colorId: "red", duration: 600, seed: 42, bots });
  w.rocks = [];
  w.palms = [];
  w.pools = [];
  w.boxes = [];
  w.pickups = [];
  w.creatures = [];
  w.kingId = null;
  for (const c of w.crabs) {
    c.invuln = 0;
    c.x = 0;
    c.y = 0;
    c.score = 0;
    c.level = 1;
    c.scale = 1;
    c.hp = c.maxHp = 100;
  }
  return w;
}

function face(a: Crab, b: Crab) {
  a.angle = Math.atan2(b.y - a.y, b.x - a.x);
}

describe("level table (spec §2.2)", () => {
  it("matches the spec thresholds, scales, ATK and HP", () => {
    expect(LEVELS.map((l) => [l.points, l.scale, l.atk, l.hp])).toEqual([
      [0, 1.0, 10, 100],
      [1_000, 1.3, 18, 200],
      [5_000, 1.7, 35, 450],
      [20_000, 2.2, 65, 1_000],
      [100_000, 2.8, 120, 2_500],
      [500_000, 3.5, 220, 5_000],
    ]);
    expect(levelForScore(999).level).toBe(1);
    expect(levelForScore(1000).level).toBe(2);
    expect(levelForScore(499_999).level).toBe(5);
    expect(levelForScore(500_000).level).toBe(6);
  });

  it("levels up on score, grows HP, and lerps the body scale smoothly", () => {
    const w = bare();
    const me = player(w);
    addScore(w, me, 5_000);
    expect(me.level).toBe(3);
    expect(me.maxHp).toBe(450);
    expect(w.events.some((e) => e.type === "levelUp" && e.player)).toBe(true);
    step(w, idle, 1 / 60);
    expect(me.scale).toBeGreaterThan(1);
    expect(me.scale).toBeLessThan(1.7);
    for (let i = 0; i < 240; i++) step(w, idle, 1 / 60);
    expect(me.scale).toBeCloseTo(1.7, 1);
  });
});

describe("boost / stamina", () => {
  it("drains while boosting and waits 2s before recharging", () => {
    const w = bare();
    const me = player(w);
    for (let i = 0; i < 60; i++) step(w, { ...idle, moveX: 1, boost: true }, 1 / 60);
    const after = me.stamina;
    expect(after).toBeLessThan(STAMINA_MAX);
    for (let i = 0; i < 60; i++) step(w, idle, 1 / 60); // 1s: still inside the delay
    expect(me.stamina).toBeCloseTo(after, 5);
    for (let i = 0; i < 120; i++) step(w, idle, 1 / 60);
    expect(me.stamina).toBeGreaterThan(after);
  });

  it("boosting moves 50% faster", () => {
    const a = bare(), b = bare();
    for (let i = 0; i < 30; i++) {
      step(a, { ...idle, moveX: 1 }, 1 / 60);
      step(b, { ...idle, moveX: 1, boost: true }, 1 / 60);
    }
    expect(player(b).x / player(a).x).toBeCloseTo(1.5, 1);
  });
});

describe("combat", () => {
  it("frontal shield guard reduces damage and wears durability; hits from behind ignore it", () => {
    const w = bare(1);
    const [me, foe] = w.crabs;
    foe.x = 40;
    face(me, foe);
    foe.shield = { kind: "potLid", dur: SHIELDS.potLid.durability };
    face(foe, me); // shield toward the attacker
    swing(w, me);
    expect(foe.shield?.dur).toBe(SHIELDS.potLid.durability - 1);
    expect(100 - foe.hp).toBeLessThanOrEqual(Math.ceil(10 * 1.1 * 1.75 * 0.5));

    const w2 = bare(1);
    const [me2, foe2] = w2.crabs;
    foe2.x = 40;
    face(me2, foe2);
    foe2.shield = { kind: "potLid", dur: SHIELDS.potLid.durability };
    foe2.angle = 0; // facing away from the attacker (who is at -x)
    swing(w2, me2);
    expect(foe2.shield?.dur).toBe(SHIELDS.potLid.durability);
    expect(100 - foe2.hp).toBeGreaterThanOrEqual(9);
  });

  it("weapons lose durability per connecting swing and break at 0", () => {
    const w = bare(1);
    const [me, foe] = w.crabs;
    foe.x = 40;
    foe.hp = foe.maxHp = 1e9;
    face(me, foe);
    me.weapon = { kind: "knife", dur: 2 };
    swing(w, me);
    expect(me.weapon?.dur).toBe(1);
    swing(w, me);
    expect(me.weapon).toBeNull();
    expect(w.events.some((e) => e.type === "break" && e.what === "weapon")).toBe(true);
    // Whiffing costs nothing.
    me.weapon = { kind: "knife", dur: 5 };
    foe.x = 999;
    swing(w, me);
    expect(me.weapon.dur).toBe(5);
  });

  it("builds a combo on consecutive hits", () => {
    const w = bare(1);
    const [me, foe] = w.crabs;
    foe.x = 40;
    foe.hp = foe.maxHp = 1e9;
    face(me, foe);
    for (let i = 0; i < 4; i++) swing(w, me);
    expect(me.combo).toBe(4);
  });

  it("killing drops coins + gear, rewards the killer, and flips the player into the revive choice", () => {
    const w = bare(1);
    const [me, foe] = w.crabs;
    foe.x = 40;
    face(foe, me);
    me.score = 10_000;
    me.hp = 1;
    me.weapon = { kind: "bat", dur: 8 };
    swing(w, foe);
    expect(me.alive).toBe(false);
    expect(w.playerDown).toBe(true);
    expect(w.pickups.some((p) => p.type === "coin")).toBe(true);
    expect(w.pickups.some((p) => p.type === "weapon" && p.weapon?.kind === "bat")).toBe(true);
    expect(foe.score).toBeGreaterThanOrEqual(2_000 + 150);
    expect(revivePlayer(w)).toBe(true);
    expect(me.alive).toBe(true);
    expect(me.score).toBe(5_000);
    expect(me.weapon).toEqual({ kind: "bat", dur: 4 });
    expect(w.revivesLeft).toBe(0);
  });
});

describe("king crab", () => {
  it("crowns the leader, needs a 5% lead to change hands, and pays a bounty on the king", () => {
    const w = bare(2);
    const [me, a, b] = w.crabs;
    w.time = 30;
    a.score = 10_000;
    updateLeaderboard(w);
    expect(w.kingId).toBe(a.id);
    b.score = 10_300; // < 5% lead
    updateLeaderboard(w);
    expect(w.kingId).toBe(a.id);
    b.score = 10_600;
    updateLeaderboard(w);
    expect(w.kingId).toBe(b.id);
    expect(w.events.filter((e) => e.type === "kingNew")).toHaveLength(2);

    me.x = -40;
    b.hp = 1;
    face(me, b);
    swing(w, me);
    expect(b.alive).toBe(false);
    expect(w.kingId).toBeNull();
    expect(w.events.some((e) => e.type === "kingDown" && e.byPlayer)).toBe(true);
    expect(me.score).toBeGreaterThanOrEqual(10_000 + Math.floor(10_600 * 0.5));
  });
});

describe("world objects", () => {
  it("tide pools heal 5% max HP per second", () => {
    const w = bare();
    const me = player(w);
    w.pools = [{ x: 0, y: 0, r: 120 }];
    me.hp = 10;
    me.sinceHurt = 0;
    for (let i = 0; i < 60; i++) step(w, idle, 1 / 60);
    expect(me.hp).toBeCloseTo(10 + 100 * POOL_HEAL_RATE, 0);
  });

  it("golden chests stay shut without a key and open with one", () => {
    const w = bare();
    const me = player(w);
    w.boxes = [{ id: 999, kind: "gold", alive: true, x: 45, y: 0, hp: 1, maxHp: 1, hitFlash: 0, lockedMsgT: 0 }];
    me.angle = 0;
    swing(w, me);
    expect(w.boxes[0].alive).toBe(true);
    me.hasKey = true;
    swing(w, me);
    expect(w.boxes[0].alive).toBe(false);
    expect(me.hasKey).toBe(false);
    expect(w.pickups.some((p) => p.type === "weapon")).toBe(true);
  });
});

describe("full match", () => {
  it("is deterministic for a seed", () => {
    const run = () => {
      const w = createWorld({ playerName: "나", colorId: "red", duration: 60, seed: 7 });
      for (let i = 0; i < 600; i++) step(w, { ...idle, moveX: 1, attack: i % 3 === 0 }, 1 / 60);
      return w.crabs.map((c) => [Math.round(c.x), Math.round(c.y), c.score]);
    };
    expect(run()).toEqual(run());
  });

  it("bots play a whole match to the buzzer without breaking the world", () => {
    const w = createWorld({ playerName: "나", colorId: "red", duration: 180, seed: 3 });
    const me = player(w);
    me.brain = { goal: "wander", targetId: 0, gx: 0, gy: 0, think: 0, aggression: 0.6, skill: 1, wanderAngle: 0, stuck: 0, lastX: 0, lastY: 0 };
    let kings = 0;
    while (!w.over) {
      if (w.playerDown) revivePlayer(w);
      step(w, me.alive ? botThink(w, me, 1 / 30) : idle, 1 / 30);
      for (const e of w.events) if (e.type === "kingNew") kings++;
      w.events.length = 0;
    }
    const s = summarize(w);
    expect(w.crabs.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.hp))).toBe(true);
    expect(Math.max(...w.crabs.map((c) => c.score))).toBeGreaterThan(5_000);
    expect(kings).toBeGreaterThan(0);
    expect(s.rank).toBeGreaterThanOrEqual(1);
    expect(s.rank).toBeLessThanOrEqual(s.total);
    expect(s.total).toBe(w.crabs.length);
  }, 30_000);
});
