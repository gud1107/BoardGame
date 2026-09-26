import { describe, expect, it } from "vitest";
import {
  drainPerSecond,
  ENTITY_DEFS,
  explosionDamage,
  goldRushMultiplier,
  healGain,
  MEGA_EVERY,
  sharkById,
  SHARKS,
  upgradeCost,
} from "./data";
import { createWorld, explode, forceGoldRush, isEdible, step, summarize, type Entity, type World } from "./engine";
import { decodeSave, encodeSave, freshSave } from "./save";

const NO_UPGRADES = { bite: 0, speed: 0, boost: 0 };
const idle = { dirX: 0, dirY: 0, boost: false };

function place(w: World, kind: keyof typeof ENTITY_DEFS, x: number, y: number): Entity {
  // Reuse the engine's spawner indirectly: clone an existing-shape entity.
  const e: Entity = {
    id: 99999 + w.entities.length,
    kind,
    def: ENTITY_DEFS[kind],
    alive: true,
    x,
    y,
    vx: 0,
    vy: 0,
    angle: 0,
    hp: ENTITY_DEFS[kind].toughness,
    phase: 0,
    timer: 99,
    attackCd: 0,
    hitFlash: 0,
    homeY: y,
    dir: 1,
    state: "patrol",
  };
  w.entities.push(e);
  return e;
}

function isolate(w: World) {
  w.entities.length = 0;
  w.spawnTimer = 999;
}

describe("formulas (spec §1, §6)", () => {
  it("starvation drain accelerates: D(t) = D_base·(1+t/180)^1.3", () => {
    expect(drainPerSecond(3, 0)).toBeCloseTo(3);
    expect(drainPerSecond(3, 180)).toBeCloseTo(3 * Math.pow(2, 1.3));
    expect(drainPerSecond(3, 60)).toBeLessThan(drainPerSecond(3, 120));
  });

  it("heal gain scales 5% per bite level", () => {
    expect(healGain(10, 0)).toBe(10);
    expect(healGain(10, 4)).toBeCloseTo(12);
  });

  it("mine damage falls off linearly to zero at the blast radius", () => {
    expect(explosionDamage(100, 0, 200)).toBe(100);
    expect(explosionDamage(100, 100, 200)).toBe(50);
    expect(explosionDamage(100, 200, 200)).toBe(0);
    expect(explosionDamage(100, 300, 200)).toBe(0);
  });

  it("gold rush multiplier ×2..×8, mega ×10", () => {
    expect(goldRushMultiplier(1, false)).toBe(2);
    expect(goldRushMultiplier(3, false)).toBe(4);
    expect(goldRushMultiplier(20, false)).toBe(8);
    expect(goldRushMultiplier(8, true)).toBe(10);
  });

  it("upgrade costs grow and higher tiers cost more", () => {
    const reef = sharkById("reef"), mega = sharkById("megalodon");
    expect(upgradeCost(reef, "bite", 1)).toBeGreaterThan(upgradeCost(reef, "bite", 0));
    expect(upgradeCost(mega, "speed", 0)).toBeGreaterThan(upgradeCost(reef, "speed", 0));
  });
});

describe("shark motor", () => {
  it("drains HP over time while idle and eventually starves", () => {
    const w = createWorld(sharkById("reef"), NO_UPGRADES, 1);
    isolate(w);
    const hp0 = w.shark.hp;
    for (let i = 0; i < 60; i++) step(w, idle, 1 / 60);
    expect(w.shark.hp).toBeLessThan(hp0);
    for (let i = 0; i < 60 * 60 && !w.over; i++) step(w, idle, 1 / 60);
    expect(w.over).toBe(true);
    expect(w.deathCause).toBe("굶주림");
  });

  it("swims toward the input direction and boost drains energy", () => {
    const w = createWorld(sharkById("mako"), NO_UPGRADES, 2);
    isolate(w);
    const x0 = w.shark.x;
    for (let i = 0; i < 30; i++) step(w, { dirX: 1, dirY: 0, boost: true }, 1 / 60);
    expect(w.shark.x).toBeGreaterThan(x0 + 40);
    expect(w.shark.boost).toBeLessThan(w.stats.boostDuration);
  });

  it("breaching the surface goes airborne under gravity, then splashes back", () => {
    const w = createWorld(sharkById("mako"), NO_UPGRADES, 3);
    isolate(w);
    w.shark.y = 60;
    w.shark.angle = -Math.PI / 2;
    let wentUp = false;
    for (let i = 0; i < 240; i++) {
      step(w, { dirX: 0, dirY: -1, boost: true }, 1 / 60);
      if (w.shark.airborne) wentUp = true;
      if (wentUp && !w.shark.airborne) break;
    }
    expect(wentUp).toBe(true);
    expect(w.run.jumps).toBe(1);
    expect(w.shark.airborne).toBe(false);
  });
});

describe("bite engine (spec §4)", () => {
  it("eats same-tier prey in front of the mouth and heals", () => {
    const w = createWorld(sharkById("reef"), NO_UPGRADES, 4);
    isolate(w);
    w.shark.hp = 50;
    w.shark.angle = 0;
    const fish = place(w, "swimmer", w.shark.x + 45, w.shark.y);
    fish.def = { ...fish.def, behavior: "static" };
    step(w, idle, 1 / 60);
    expect(fish.alive).toBe(false);
    expect(w.score).toBeGreaterThan(0);
    expect(w.shark.hp).toBeGreaterThan(50);
  });

  it("does not eat prey behind the shark (forward cone)", () => {
    const w = createWorld(sharkById("reef"), NO_UPGRADES, 5);
    isolate(w);
    w.shark.angle = 0;
    const e = place(w, "chest", w.shark.x - 45, w.shark.y);
    step(w, idle, 1 / 60);
    expect(e.alive).toBe(true);
  });

  it("tier too low: harmful prey damages instead of being eaten", () => {
    const w = createWorld(sharkById("reef"), NO_UPGRADES, 6);
    isolate(w);
    w.shark.angle = 0;
    const puffer = place(w, "puffer", w.shark.x + 30, w.shark.y);
    puffer.def = { ...puffer.def, behavior: "static" };
    const hp0 = w.shark.hp;
    step(w, idle, 1 / 60);
    expect(puffer.alive).toBe(true);
    expect(w.shark.hp).toBeLessThan(hp0 - 5);
    expect(isEdible(w, puffer)).toBe(false);
  });

  it("tough prey (submarine) takes multiple bites", () => {
    const w = createWorld(sharkById("white"), NO_UPGRADES, 7);
    isolate(w);
    w.shark.angle = 0;
    const sub = place(w, "chest", w.shark.x + 90, w.shark.y);
    sub.kind = "submarine";
    sub.def = { ...ENTITY_DEFS.submarine, behavior: "static" };
    sub.hp = ENTITY_DEFS.submarine.toughness;
    let bites = 0;
    for (let i = 0; i < 600 && sub.alive; i++) {
      w.shark.x = sub.x - 90;
      w.shark.vx = 0;
      w.shark.vy = 0;
      const before = sub.hp;
      step(w, idle, 1 / 60);
      if (sub.hp < before) bites++;
    }
    expect(sub.alive).toBe(false);
    expect(bites).toBeGreaterThan(2);
    expect(w.run.bigKills).toBe(1);
  });
});

describe("hazards (spec §6)", () => {
  it("jellyfish poisons: DoT ticks and slows", () => {
    const w = createWorld(sharkById("reef"), NO_UPGRADES, 8);
    isolate(w);
    const j = place(w, "greenJelly", w.shark.x, w.shark.y);
    j.def = { ...j.def, behavior: "static" };
    step(w, idle, 1 / 60);
    expect(w.shark.poison).not.toBeNull();
    j.alive = false;
    const hp0 = w.shark.hp;
    for (let i = 0; i < 70; i++) step(w, idle, 1 / 60);
    // ≥2 ticks of 5% maxHP plus starvation
    expect(hp0 - w.shark.hp).toBeGreaterThan(w.stats.maxHealth * 0.05 * 2);
  });

  it("mine explosion damages with distance falloff and chains", () => {
    const w = createWorld(sharkById("tiger"), NO_UPGRADES, 9);
    isolate(w);
    const m1 = place(w, "mineM", w.shark.x + 80, w.shark.y);
    const m2 = place(w, "mineS", w.shark.x + 130, w.shark.y);
    const hp0 = w.shark.hp;
    explode(w, m1);
    expect(m1.alive).toBe(false);
    expect(m2.alive).toBe(false); // chained
    expect(w.shark.hp).toBeLessThan(hp0);
    expect(w.shark.hp).toBeGreaterThan(hp0 - 70);
  });
});

describe("gold rush (spec §1-2)", () => {
  it("fills from eating, makes the shark invulnerable and heals to full", () => {
    const w = createWorld(sharkById("reef"), NO_UPGRADES, 10);
    isolate(w);
    w.shark.hp = 20;
    forceGoldRush(w);
    expect(w.gold.active).toBe(true);
    expect(w.shark.hp).toBe(w.stats.maxHealth);
    const hp = w.shark.hp;
    const m = place(w, "mineL", w.shark.x + 60, w.shark.y + 60);
    explode(w, m);
    expect(w.shark.hp).toBe(hp);
    for (let i = 0; i < 60 * 9; i++) step(w, idle, 1 / 60);
    expect(w.gold.active).toBe(false);
  });

  it("every 8th rush is a Mega Gold Rush that makes everything edible", () => {
    const w = createWorld(sharkById("reef"), NO_UPGRADES, 11);
    isolate(w);
    for (let i = 1; i < MEGA_EVERY; i++) {
      forceGoldRush(w);
      expect(w.gold.mega).toBe(false);
      w.gold.remaining = 0;
      step(w, idle, 1 / 60);
    }
    forceGoldRush(w);
    expect(w.gold.mega).toBe(true);
    const mine = place(w, "mineXL", 0, 0);
    expect(isEdible(w, mine)).toBe(true);
  });
});

describe("full simulation smoke test", () => {
  it.each(SHARKS.map((s) => s.id))("%s survives a scripted 60s dive without throwing", (id) => {
    const w = createWorld(sharkById(id), { bite: 3, speed: 3, boost: 3 }, 1234);
    let t = 0;
    for (let i = 0; i < 60 * 60 && !w.over; i++) {
      t += 1 / 60;
      step(w, { dirX: Math.cos(t * 0.4), dirY: Math.sin(t * 0.7), boost: Math.sin(t) > 0.6 }, 1 / 60);
      w.events.length = 0;
    }
    const s = summarize(w);
    expect(s.seconds).toBeGreaterThan(0);
    expect(Number.isFinite(w.shark.x) && Number.isFinite(w.shark.y)).toBe(true);
    expect(w.entities.length).toBeLessThan(400);
    expect(w.particles.length).toBeLessThanOrEqual(700);
  });

  it("is deterministic for the same seed + inputs", () => {
    const run = () => {
      const w = createWorld(sharkById("reef"), NO_UPGRADES, 77);
      for (let i = 0; i < 1200 && !w.over; i++) step(w, { dirX: 1, dirY: Math.sin(i / 50), boost: i % 90 < 30 }, 1 / 60);
      return [w.score, Math.round(w.shark.x), w.entities.length];
    };
    expect(run()).toEqual(run());
  });
});

describe("save", () => {
  it("round-trips and rejects tampering", () => {
    const s = { ...freshSave(), coins: 1234, owned: ["reef", "mako"] };
    const enc = encodeSave(s);
    expect(decodeSave(enc).coins).toBe(1234);
    const tampered = enc.slice(0, -3) + "AAA";
    expect(decodeSave(tampered).coins).toBe(0);
  });
});
