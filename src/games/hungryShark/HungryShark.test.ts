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
    stun: 0,
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
    const w = createWorld(sharkById("sandTiger"), NO_UPGRADES, 9);
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

describe("target feed indicator", () => {
  it("green for edible prey with heal/score, red skull with required shark for dangerous", async () => {
    const { selectMarkers } = await import("./markers");
    const w = createWorld(sharkById("reef"), NO_UPGRADES, 21);
    isolate(w);
    w.shark.angle = 0;
    place(w, "swimmer", w.shark.x + 120, w.shark.y);
    place(w, "puffer", w.shark.x + 150, w.shark.y + 80);
    place(w, "fishingBoat", w.shark.x + 200, w.shark.y - 120);
    const ms = selectMarkers(w);
    const by = (k: string) => ms.find((m) => m.e.kind === k)!;
    expect(by("swimmer").kind).toBe("edible");
    expect(by("swimmer").label).toBe("+18 HP"); // 15 × 왕성한 식욕 1.2
    expect(by("puffer").kind).toBe("danger");
    expect(by("puffer").label).toContain("T2 2단계 진화 필요");
    expect(by("fishingBoat").kind).toBe("blocked");
  });

  it("ignores things behind the head except chasing threats, and collapses fish schools", async () => {
    const { selectMarkers } = await import("./markers");
    const w = createWorld(sharkById("reef"), NO_UPGRADES, 22);
    isolate(w);
    w.shark.angle = 0;
    place(w, "crab", w.shark.x - 200, w.shark.y);
    const hunter = place(w, "smallShark", w.shark.x - 220, w.shark.y);
    for (let i = 0; i < 6; i++) place(w, "smallFish", w.shark.x + 150 + i * 5, w.shark.y + i * 4);
    place(w, "grouper", w.shark.x + 5000, w.shark.y);
    const ms = selectMarkers(w);
    expect(ms.some((m) => m.e.kind === "crab")).toBe(false);
    expect(ms[0].e).toBe(hunter);
    expect(ms.filter((m) => m.e.kind === "smallFish")).toHaveLength(1);
    expect(ms.some((m) => m.e.kind === "grouper")).toBe(false);
  });

  it("gold rush swaps edible markers to gold; mega makes mines gold too", async () => {
    const { selectMarkers } = await import("./markers");
    const w = createWorld(sharkById("reef"), NO_UPGRADES, 23);
    isolate(w);
    w.shark.angle = 0;
    place(w, "smallFish", w.shark.x + 100, w.shark.y);
    place(w, "mineS", w.shark.x + 200, w.shark.y + 100);
    forceGoldRush(w);
    let ms = selectMarkers(w);
    expect(ms.find((m) => m.e.kind === "smallFish")!.kind).toBe("gold");
    expect(ms.find((m) => m.e.kind === "mineS")!.kind).toBe("blocked"); // invulnerable, not edible
    w.gold.mega = true;
    ms = selectMarkers(w);
    expect(ms.find((m) => m.e.kind === "mineS")!.kind).toBe("mega");
  });

  it("bestiary lists every non-player entity kind exactly once", async () => {
    const { BESTIARY_ORDER } = await import("./markers");
    expect(new Set(BESTIARY_ORDER).size).toBe(BESTIARY_ORDER.length);
    expect([...BESTIARY_ORDER].sort()).toEqual(Object.keys(ENTITY_DEFS).sort());
  });
});

describe("evolution tree", () => {
  it("has 10 sharks: 1 root + 3 branches × tiers 2-4, each child points at its parent", async () => {
    const { evolutionPath } = await import("./data");
    expect(SHARKS).toHaveLength(10);
    expect(sharkById("reef").nextIds).toEqual(["sandTiger", "mako", "elecShark"]);
    for (const s of SHARKS) {
      for (const n of s.nextIds) expect(sharkById(n).parentId).toBe(s.id);
      if (s.parentId) expect(sharkById(s.parentId).tier).toBe(s.tier - 1);
    }
    expect(evolutionPath("megalodon").map((s) => s.id)).toEqual(["reef", "sandTiger", "white", "megalodon"]);
    expect(evolutionPath("leviathan").map((s) => s.branch)).toEqual(["BASE", "VOID", "VOID", "VOID"]);
  });

  it("migrates old linear-ladder saves: tiger → sandTiger + refund, ancestors filled in", async () => {
    const { migrateSave } = await import("./save");
    const old = { ...freshSave(), coins: 100, owned: ["reef", "tiger", "megalodon"], selected: "tiger", best: { tiger: 5000 }, upgrades: { tiger: { bite: 2, speed: 1, boost: 0 } } };
    const m = migrateSave(old);
    expect(m.owned).toEqual(expect.arrayContaining(["reef", "sandTiger", "white", "megalodon"]));
    expect(m.owned).not.toContain("tiger");
    expect(m.selected).toBe("sandTiger");
    expect(m.coins).toBe(100 + 7800);
    expect(m.best.sandTiger).toBe(5000);
    expect(m.upgrades.sandTiger).toEqual({ bite: 2, speed: 1, boost: 0 });
    // Idempotent.
    expect(migrateSave(m)).toEqual(m);
  });
});

describe("economy overhaul", () => {
  it("frenzy multiplier steps ×2 → ×5 with consecutive eats", async () => {
    const { frenzyMultiplier } = await import("./data");
    expect(frenzyMultiplier(4)).toBe(1);
    expect(frenzyMultiplier(5)).toBe(2);
    expect(frenzyMultiplier(12)).toBe(3);
    expect(frenzyMultiplier(20)).toBe(4);
    expect(frenzyMultiplier(30)).toBe(5);
    expect(frenzyMultiplier(99)).toBe(5);
  });

  it("gold rush coins are ×2 and scaled by the shark's gold multiplier", () => {
    const w = createWorld(sharkById("white"), NO_UPGRADES, 31);
    isolate(w);
    w.shark.angle = 0;
    forceGoldRush(w);
    const c0 = w.coins;
    const f = place(w, "swimmer", w.shark.x + 80, w.shark.y);
    f.def = { ...f.def, behavior: "static" };
    step(w, idle, 1 / 60);
    expect(f.alive).toBe(false);
    // 5 base × 2 (rush) × 1.5 (백상아리), no frenzy during a rush
    expect(w.coins - c0).toBe(15);
  });

  it("golden tuna triggers an instant gold rush", () => {
    const w = createWorld(sharkById("reef"), NO_UPGRADES, 32);
    isolate(w);
    w.shark.angle = 0;
    const g = place(w, "goldenTuna", w.shark.x + 45, w.shark.y);
    g.def = { ...g.def, behavior: "static" };
    step(w, idle, 1 / 60);
    expect(g.alive).toBe(false);
    expect(w.gold.active).toBe(true);
    expect(w.coins).toBeGreaterThanOrEqual(150);
  });

  it("magnet passive pulls small edible prey toward the mouth", () => {
    const w = createWorld(sharkById("elecShark"), NO_UPGRADES, 33);
    isolate(w);
    w.shark.angle = 0;
    const f = place(w, "smallFish", w.shark.x + 115, w.shark.y); // mouth reach ≈ 29, magnet 85
    f.def = { ...f.def, behavior: "mine" }; // stays put on its own; magnet must move it
    const d0 = Math.hypot(f.x - w.shark.x, f.y - w.shark.y);
    step(w, idle, 1 / 60);
    expect(Math.hypot(f.x - w.shark.x, f.y - w.shark.y)).toBeLessThan(d0);
    for (let i = 0; i < 40 && f.alive; i++) step(w, idle, 1 / 60);
    expect(f.alive).toBe(false);
  });
});

describe("active skills", () => {
  const cast = (id: string, seed: number) => {
    const w = createWorld(sharkById(id), NO_UPGRADES, seed);
    isolate(w);
    w.shark.angle = 0;
    return w;
  };

  it("Space casts the skill and starts its cooldown", () => {
    const w = cast("reef", 40);
    step(w, { ...idle, skill: true }, 1 / 60);
    expect(w.skill.cooldown).toBeGreaterThan(5);
    expect(w.skill.active).toBeGreaterThan(0);
  });

  it("크러시 바이트 lets the sand tiger eat a mine without exploding", () => {
    const w = cast("sandTiger", 41);
    const m = place(w, "mineS", w.shark.x + 70, w.shark.y);
    const hp0 = w.shark.hp;
    step(w, { ...idle, skill: true }, 1 / 60);
    for (let i = 0; i < 5 && m.alive; i++) step(w, idle, 1 / 60);
    expect(m.alive).toBe(false);
    expect(w.shark.hp).toBeGreaterThan(hp0 - 1);
    expect(w.run.eaten.mineS).toBe(1);
  });

  it("EMP chain-lightning eats nearby small prey and stuns hazards", () => {
    const w = cast("elecShark", 42);
    const fish = [0, 1, 2].map((i) => place(w, "crab", w.shark.x + 150 + i * 30, w.shark.y + 100));
    const jelly = place(w, "greenJelly", w.shark.x - 200, w.shark.y);
    step(w, { ...idle, skill: true }, 1 / 60);
    expect(fish.every((f) => !f.alive)).toBe(true);
    expect(jelly.stun).toBeGreaterThan(0);
  });

  it("그림자 은신: invulnerable while cloaked and the next big bite deals ×5", () => {
    const w = cast("phantom", 43);
    step(w, { ...idle, skill: true }, 1 / 60);
    const hp0 = w.shark.hp;
    explode(w, place(w, "mineL", w.shark.x + 40, w.shark.y));
    expect(w.shark.hp).toBe(hp0);
    expect(w.skill.ambush).toBe(true);
    const sub = place(w, "submarine", w.shark.x + 130, w.shark.y);
    sub.def = { ...sub.def, behavior: "static" };
    for (let i = 0; i < 3; i++) step(w, idle, 1 / 60);
    expect(w.skill.ambush).toBe(false);
    expect(ENTITY_DEFS.submarine.toughness - sub.hp).toBeCloseTo(w.stats.biteForce * 5);
  });

  it("블랙홀 swallows prey inside its radius", () => {
    const w = cast("leviathan", 44);
    step(w, { ...idle, skill: true }, 1 / 60);
    const v = w.skill.vortex!;
    expect(v).not.toBeNull();
    const f = place(w, "grouper", v.x + 150, v.y);
    for (let i = 0; i < 120 && f.alive; i++) step(w, idle, 1 / 60);
    expect(f.alive).toBe(false);
  });

  it("타이탄의 포효 doubles size and stuns everything around", async () => {
    const { bodyScale } = await import("./engine");
    const w = cast("megalodon", 45);
    const h = place(w, "smallShark", w.shark.x + 600, w.shark.y);
    step(w, { ...idle, skill: true }, 1 / 60);
    expect(bodyScale(w)).toBe(2);
    expect(h.stun).toBeGreaterThan(2);
  });

  it.each(SHARKS.map((s) => s.id))("%s survives a 60s dive spamming its skill", (id) => {
    const w = createWorld(sharkById(id), { bite: 3, speed: 3, boost: 3 }, 4321);
    let t = 0;
    for (let i = 0; i < 60 * 60 && !w.over; i++) {
      t += 1 / 60;
      step(w, { dirX: Math.cos(t * 0.4), dirY: Math.sin(t * 0.7), boost: Math.sin(t) > 0.6, skill: true }, 1 / 60);
      w.events.length = 0;
    }
    expect(Number.isFinite(w.shark.x) && Number.isFinite(w.shark.y)).toBe(true);
    expect(w.entities.length).toBeLessThan(400);
  });
});

describe("maps", () => {
  it("each map sets its own width/terrain/chests and the default is wider than the old 9000", async () => {
    const { MAPS } = await import("./data");
    expect(MAPS.map((m) => m.id)).toEqual(["deepBlue", "frozenStrait", "shipwreck"]);
    for (const m of MAPS) {
      const w = createWorld(sharkById("reef"), NO_UPGRADES, 50, m.id);
      const data = await import("./data");
      expect(data.WORLD_W).toBe(m.width);
      expect(w.entities.filter((e) => e.kind === "chest")).toHaveLength(m.chestCount);
      expect(summarize(w).mapId).toBe(m.id);
    }
    expect(MAPS[0].width).toBeGreaterThan(9000);
  });

  it("icebergs only drift in the frozen strait and are bounced off, not eaten", () => {
    const run = (id: "deepBlue" | "frozenStrait") => {
      const w = createWorld(sharkById("reef"), NO_UPGRADES, 51, id);
      w.shark.y = 120;
      for (let i = 0; i < 60 * 8; i++) step(w, idle, 1 / 60);
      return w.entities.filter((e) => e.kind === "iceberg").length;
    };
    expect(run("deepBlue")).toBe(0);
    expect(run("frozenStrait")).toBeGreaterThan(0);
    const w = createWorld(sharkById("megalodon"), NO_UPGRADES, 52, "frozenStrait");
    const ice = w.entities.find((e) => e.kind === "iceberg") ?? place(w, "iceberg", 0, 0);
    expect(isEdible(w, ice)).toBe(false);
  });

  it("map coin bonus multiplies drops", () => {
    const coinsOn = (id: "deepBlue" | "shipwreck") => {
      const w = createWorld(sharkById("reef"), NO_UPGRADES, 53, id);
      isolate(w);
      w.shark.angle = 0;
      forceGoldRush(w);
      const c0 = w.coins;
      const f = place(w, "swimmer", w.shark.x + 45, w.shark.y);
      f.def = { ...f.def, behavior: "static" };
      step(w, idle, 1 / 60);
      return w.coins - c0;
    };
    expect(coinsOn("deepBlue")).toBe(10);
    expect(coinsOn("shipwreck")).toBe(Math.round(10 * 1.25));
  });
});

describe("mid-dive evolution", () => {
  it("swaps the shark in place, keeps score/coins/position, full heal, fresh skill", async () => {
    const { evolveWorld } = await import("./engine");
    const w = createWorld(sharkById("reef"), NO_UPGRADES, 60);
    isolate(w);
    for (let i = 0; i < 120; i++) step(w, { dirX: 1, dirY: 0, boost: false }, 1 / 60);
    w.score = 1234;
    w.coins = 500;
    w.shark.hp = 10;
    w.skill.cooldown = 4;
    const x = w.shark.x, y = w.shark.y;
    evolveWorld(w, sharkById("mako"), NO_UPGRADES);
    expect(w.def.id).toBe("mako");
    expect(w.skill.id).toBe("sonicBreak");
    expect(w.skill.cooldown).toBe(0);
    expect(w.shark.hp).toBe(w.stats.maxHealth);
    expect([w.shark.x, w.shark.y, w.score, w.coins]).toEqual([x, y, 1234, 500]);
    expect(w.events.some((e) => e.type === "evolve")).toBe(true);
    // Now eats tier-2 prey.
    expect(isEdible(w, place(w, "puffer", 0, 0))).toBe(true);
  });
});

describe("map invariant sweep", () => {
  const MAP_IDS = ["deepBlue", "frozenStrait", "shipwreck"] as const;
  // Spawned by something else, not by the roster.
  const ALWAYS_OK = new Set(["chest", "torpedo", "sailor", "passenger", "rock", "iceShard", "mastDebris"]);
  it.each(MAP_IDS.flatMap((m) => SHARKS.map((s) => [m, s.id] as const)))(
    "%s × %s: 45s dive with skills + mid-dive evolution keeps every invariant",
    async (mapId, sharkId) => {
      const { evolveWorld } = await import("./engine");
      const data = await import("./data");
      const w = createWorld(sharkById(sharkId), { bite: 2, speed: 2, boost: 2 }, 777, mapId);
      const chests0 = w.entities.filter((e) => e.kind === "chest").length;
      let t = 0;
      for (let i = 0; i < 60 * 45 && !w.over; i++) {
        t += 1 / 60;
        if (i === 60 * 15 && w.def.nextIds.length) evolveWorld(w, sharkById(w.def.nextIds[0]), NO_UPGRADES);
        // Wander everywhere: surface jumps, deep trenches, world edges.
        step(w, { dirX: Math.cos(t * 0.35) + 0.3, dirY: Math.sin(t * 0.55) * 1.2, boost: Math.sin(t * 1.3) > 0.4, skill: i % 90 === 0 }, 1 / 60);
        w.events.length = 0;
        const s = w.shark;
        if (!Number.isFinite(s.x) || !Number.isFinite(s.y) || !Number.isFinite(s.hp)) throw new Error(`non-finite shark @${i}`);
        if (s.x < 0 || s.x > data.WORLD_W) throw new Error(`shark x out of world: ${s.x}`);
        if (s.y > data.seabedY(s.x) + 1) throw new Error(`shark below seabed: ${s.y} > ${data.seabedY(s.x)}`);
        if (s.y < data.SKY_TOP) throw new Error(`shark above sky: ${s.y}`);
        if (!s.airborne && data.isUnderIce(s.x) && s.y < data.ceilingY(s.x) - 1) throw new Error(`shark inside the ice sheet: ${s.y}`);
        for (const c of data.activeGeometry().colliders) {
          if (Math.hypot(s.x - c.x, s.y - c.y) < c.r * 0.6) throw new Error(`shark stuck inside a structure @${i}`);
        }
        if (i % 30 === 0) {
          for (const e of w.entities) {
            if (!e.alive) continue;
            if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) throw new Error(`non-finite ${e.kind}`);
            if (e.x < 0 || e.x > data.WORLD_W) throw new Error(`${e.kind} x out of world: ${e.x}`);
            if (e.kind === "iceberg" && mapId !== "frozenStrait") throw new Error("iceberg on wrong map");
            if (!ALWAYS_OK.has(e.kind) && !(w.map.spawns[e.kind] ?? 0)) throw new Error(`${e.kind} is not on the ${mapId} roster`);
            const b = e.def.behavior;
            if ((b === "surfaceSwim" || b === "surfaceBoat") && data.isUnderIce(e.x)) throw new Error(`${e.kind} under the ice`);
            if ((b === "wander" || b === "hunter" || b === "boid") && e.y < data.ceilingY(e.x) - 1) throw new Error(`${e.kind} above the ice ceiling`);
          }
          if (w.entities.filter((e) => e.kind === "chest" && e.alive).length > chests0) throw new Error("chests respawned");
        }
      }
      expect(w.entities.length).toBeLessThan(450);
      expect(summarize(w).mapId).toBe(mapId);
    },
    20000,
  );

  it("camera can always show a shark lying on the deepest seabed of every map", async () => {
    const { updateCamera, viewHeightFor } = await import("./render");
    const data = await import("./data");
    for (const m of data.MAPS) {
      const w = createWorld(sharkById("megalodon"), NO_UPGRADES, 90, m.id);
      // Find the deepest floor point.
      let bx = 0, by = -1;
      for (let x = 0; x < data.WORLD_W; x += 5) if (data.seabedY(x) > by) { by = data.seabedY(x); bx = x; }
      w.shark.x = bx;
      w.shark.y = by - w.stats.length * 0.3;
      const vh = 500;
      const cam = { x: w.shark.x, y: w.shark.y, zoom: vh / viewHeightFor(w.def) };
      for (let i = 0; i < 300; i++) updateCamera(cam, w, 900, vh, 1 / 60);
      const screenY = (w.shark.y - cam.y) * cam.zoom + vh / 2;
      expect(screenY, `${m.id} shark off-screen at floor y=${by.toFixed(0)}`).toBeLessThan(vh - 10);
    }
  });
});

describe("distinct map geometry + rosters", () => {
  it("each map has its own level structure, not a recolor", async () => {
    const data = await import("./data");
    const geo = (id: "deepBlue" | "frozenStrait" | "shipwreck") => {
      createWorld(sharkById("reef"), NO_UPGRADES, 70, id);
      const g = data.activeGeometry();
      return { g, floor: (x: number) => data.seabedY(x), ice: (x: number) => data.isUnderIce(x) };
    };
    const blue = geo("deepBlue");
    expect(blue.g.ice).toBeNull();
    expect(blue.g.colliders).toHaveLength(0);

    const ice = geo("frozenStrait");
    // Solid ice sheet over most of the surface, with breathing holes.
    let covered = 0;
    for (let x = 0; x < 12000; x += 50) if (ice.ice(x)) covered++;
    expect(covered / 240).toBeGreaterThan(0.6);
    expect(ice.ice(1400)).toBe(false);
    // Shallow shelf vs. deep trench.
    expect(ice.floor(800)).toBeLessThan(1100);
    expect(ice.floor(3200)).toBeGreaterThan(3200);
    expect(ice.g.structures.some((st) => st.kind === "icicle")).toBe(true);
    expect(ice.g.structures.some((st) => st.kind === "icePillar")).toBe(true);

    const wreck = geo("shipwreck");
    expect(wreck.g.ice).toBeNull();
    expect(wreck.g.structures.filter((st) => st.kind === "hull").length).toBeGreaterThanOrEqual(6);
    // Terraces: flat steps separated by cliffs.
    expect(Math.abs(wreck.floor(2400) - wreck.floor(3000))).toBeLessThan(80);
    expect(wreck.floor(3800) - wreck.floor(3000)).toBeGreaterThan(500);
  });

  it("every map has exclusive monsters and none of another map's exclusives", async () => {
    const { MAPS } = await import("./data");
    const { mapExclusives } = await import("./markers");
    const ex = Object.fromEntries(MAPS.map((m) => [m.id, mapExclusives(m)]));
    expect(ex.frozenStrait).toEqual(expect.arrayContaining(["penguin", "seal", "narwhal", "orca"]));
    expect(ex.shipwreck).toEqual(expect.arrayContaining(["barracuda", "moray", "treasureHunter", "giantSquid"]));
    expect(ex.deepBlue).toEqual(expect.arrayContaining(["swimmer", "helicopter"]));
    for (const m of MAPS) for (const k of Object.values(ex).flat()) if (!ex[m.id].includes(k)) expect(m.spawns[k] ?? 0).toBe(0);
  });

  it("a breaching shark can't jump through the ice and lands back in a hole", async () => {
    const data = await import("./data");
    const w = createWorld(sharkById("reef"), NO_UPGRADES, 71, "frozenStrait");
    isolate(w);
    // Under the ice: swimming straight up stops at the ice underside.
    w.shark.x = 2600;
    w.shark.y = 400;
    for (let i = 0; i < 120; i++) step(w, { dirX: 0, dirY: -1, boost: true }, 1 / 60);
    expect(w.shark.airborne).toBe(false);
    expect(w.shark.y).toBeGreaterThanOrEqual(data.ceilingY(w.shark.x) - 1);
    // In a hole: jump out, drift over the ice, slide back into the water.
    w.shark.x = 1400;
    w.shark.y = 300;
    w.shark.hp = 9999;
    for (let i = 0; i < 90; i++) step(w, { dirX: 0.35, dirY: -1, boost: true }, 1 / 60);
    let wasAir = w.shark.airborne;
    for (let i = 0; i < 60 * 8; i++) {
      step(w, idle, 1 / 60);
      wasAir = wasAir || w.shark.airborne;
      w.shark.hp = 9999;
    }
    expect(wasAir).toBe(true);
    expect(w.shark.airborne).toBe(false);
  });

  it("population grew ×1.4 and shark unlocks cost ×1.3", async () => {
    const { populationTargets } = await import("./data");
    expect(populationTargets(2).grouper).toBe(14);
    expect(populationTargets(2).smallFish).toBe(100);
    expect(sharkById("sandTiger").cost).toBe(1560);
    expect(sharkById("megalodon").cost).toBe(20800);
  });
});

describe("picker prefs", () => {
  it("round-trip through the save and fall back on junk", () => {
    const s = { ...freshSave(), picker: { sort: "gold" as const, dir: "asc" as const, hideOwned: true, buyableOnly: true } };
    expect(decodeSave(encodeSave(s)).picker).toEqual(s.picker);
    const junk = { ...freshSave(), picker: { sort: "nope", dir: "sideways", hideOwned: 1, buyableOnly: 0 } } as unknown as typeof s;
    expect(decodeSave(encodeSave(junk)).picker).toEqual({ sort: "tree", dir: "desc", hideOwned: true, buyableOnly: false });
    const old = { ...freshSave() } as Partial<typeof s>;
    delete old.picker;
    expect(decodeSave(encodeSave(old as typeof s)).picker.sort).toBe("tree");
  });
});

describe("frozen strait falling icicles", () => {
  it("only fall under the ice, hang ~0.9s, then plunge and hurt a shark below", async () => {
    const countShards = (id: "deepBlue" | "frozenStrait" | "shipwreck") => {
      const w = createWorld(sharkById("reef"), NO_UPGRADES, 81, id);
      let seen = 0;
      for (let i = 0; i < 60 * 30; i++) {
        w.shark.x = 2600 + Math.sin(i / 90) * 400;
        w.shark.y = 420;
        w.shark.hp = 9999;
        step(w, idle, 1 / 60);
        if (w.events.some((e) => e.type === "icicle")) seen++;
        w.events.length = 0;
      }
      return seen;
    };
    expect(countShards("deepBlue")).toBe(0);
    expect(countShards("shipwreck")).toBe(0);
    expect(countShards("frozenStrait")).toBeGreaterThan(3);

    const w = createWorld(sharkById("reef"), NO_UPGRADES, 82, "frozenStrait");
    isolate(w);
    const shard = place(w, "iceShard", w.shark.x, w.shark.y - 160);
    shard.timer = 0.9;
    const y0 = shard.y;
    for (let i = 0; i < 30; i++) step(w, idle, 1 / 60);
    expect(shard.y).toBe(y0); // still hanging
    const hp0 = w.shark.hp;
    for (let i = 0; i < 90 && shard.alive; i++) {
      w.shark.vx = 0;
      w.shark.vy = 0;
      step(w, idle, 1 / 60);
    }
    expect(w.shark.hp).toBeLessThan(hp0 - 20);
  });
});

describe("shipwreck falling mast debris", () => {
  it("only breaks off masts on the shipwreck map, creaks ~1s, then falls and hurts", async () => {
    const data = await import("./data");
    const creaks = (id: "deepBlue" | "frozenStrait" | "shipwreck") => {
      const w = createWorld(sharkById("reef"), NO_UPGRADES, 91, id);
      const masts = data.activeGeometry().structures.filter((st) => st.kind === "mast");
      let seen = 0;
      for (let i = 0; i < 60 * 30; i++) {
        const m = masts[Math.floor(i / 300) % Math.max(1, masts.length)];
        if (m) { w.shark.x = m.x + Math.sin(i / 60) * 200; w.shark.y = data.seabedY(w.shark.x) - 120; }
        w.shark.hp = 9999;
        step(w, idle, 1 / 60);
        if (w.events.some((e) => e.type === "creak")) seen++;
        w.events.length = 0;
      }
      return seen;
    };
    expect(creaks("deepBlue")).toBe(0);
    expect(creaks("frozenStrait")).toBe(0);
    expect(creaks("shipwreck")).toBeGreaterThan(3);

    const w = createWorld(sharkById("reef"), NO_UPGRADES, 92, "shipwreck");
    isolate(w);
    w.shark.x = 1200;
    w.shark.y = 300;
    const chunk = place(w, "mastDebris", w.shark.x, w.shark.y - 200);
    chunk.timer = 1.0;
    const y0 = chunk.y;
    for (let i = 0; i < 40; i++) step(w, idle, 1 / 60);
    expect(chunk.y).toBe(y0);
    const hp0 = w.shark.hp;
    for (let i = 0; i < 120 && chunk.alive; i++) {
      w.shark.vx = 0;
      w.shark.vy = 0;
      step(w, idle, 1 / 60);
    }
    expect(w.shark.hp).toBeLessThan(hp0 - 25);
  });
});

describe("economy + records", () => {
  it("frozen strait pays T4 sharks less, other tiers the plain bonus", async () => {
    const { mapById, mapCoinBonus } = await import("./data");
    expect(mapCoinBonus(mapById("frozenStrait"), 3)).toBeCloseTo(1.1);
    expect(mapCoinBonus(mapById("frozenStrait"), 4)).toBeCloseTo(0.825);
    expect(mapCoinBonus(mapById("deepBlue"), 4)).toBe(1);
  });

  it("map records + death counts round-trip and junk is dropped", () => {
    const s = {
      ...freshSave(),
      mapBest: { shipwreck: { score: 12345, sharkId: "mako", seconds: 99 } },
      deaths: { frozenStrait: { 굶주림: 3, "떨어지는 고드름": 1 } },
    };
    const back = decodeSave(encodeSave(s));
    expect(back.mapBest).toEqual(s.mapBest);
    expect(back.deaths).toEqual(s.deaths);
    const junk = { ...freshSave(), mapBest: { deepBlue: { score: "x", sharkId: 5 }, nowhere: { score: 1, sharkId: "reef", seconds: 1 } }, deaths: { deepBlue: { a: -1, b: 2 } } } as unknown as typeof s;
    const j = decodeSave(encodeSave(junk));
    expect(j.mapBest).toEqual({});
    expect(j.deaths).toEqual({ deepBlue: { b: 2 } });
    const old = { ...freshSave() } as Partial<typeof s>;
    delete old.mapBest;
    delete old.deaths;
    expect(decodeSave(encodeSave(old as typeof s)).mapBest).toEqual({});
  });
});

describe("shipwreck low-tier mercy + records + killer ranking", () => {
  it("out-of-reach deep hunters are rarer around a T1/T2 shark on the shipwreck", () => {
    const deepHunters = (sharkId: string) => {
      let peak = 0;
      for (const seed of [1, 2, 3]) {
        const w = createWorld(sharkById(sharkId), NO_UPGRADES, 300 + seed, "shipwreck");
        for (let i = 0; i < 60 * 20; i++) {
          w.shark.x = 6700;
          w.shark.y = 3000;
          w.shark.hp = 99999;
          step(w, idle, 1 / 60);
          w.events.length = 0;
        }
        peak += w.entities.filter((e) => e.alive && (e.kind === "giantSquid" || e.kind === "ghostShark")).length;
      }
      return peak;
    };
    // 대왕오징어/유령 상어 need T4: a reef shark (T1) gets the mercy, a white shark (T3) doesn't.
    expect(deepHunters("reef")).toBeLessThan(deepHunters("white"));
  });

  it("per-shark map records round-trip, drop junk, and seed from an older overall best", () => {
    const s = {
      ...freshSave(),
      mapBest: { frozenStrait: { score: 900, sharkId: "mako", seconds: 80 } },
      mapSharkBest: { frozenStrait: { reef: { score: 500, sharkId: "reef", seconds: 60 }, ghost: { score: 9, sharkId: "ghost", seconds: 1 } } },
    };
    const back = decodeSave(encodeSave(s));
    expect(back.mapSharkBest.frozenStrait).toEqual({
      reef: { score: 500, sharkId: "reef", seconds: 60 },
      mako: { score: 900, sharkId: "mako", seconds: 80 },
    });
  });

  it("killer ranking sums every map, keeps starvation separate and maps jelly poison to a jelly", async () => {
    const { killerRanking } = await import("./BestiaryPanel");
    const r = killerRanking({
      deepBlue: { 굶주림: 4, "해파리 독": 2, 범고래: 0 },
      frozenStrait: { 범고래: 3, "해파리 독": 1 },
      shipwreck: { 대왕오징어: 1 },
    });
    expect(r.starved).toBe(4);
    expect(r.killers.map((k) => [k.cause, k.total])).toEqual([["해파리 독", 3], ["범고래", 3], ["대왕오징어", 1]]);
    expect(r.killers[0].kind).toBe("greenJelly");
    expect(r.killers.find((k) => k.cause === "범고래")?.kind).toBe("orca");
  });
});

describe("frozen strait low-tier mercy", () => {
  it("범고래 shows up less around a T1 shark than around a T3 shark", () => {
    const orcas = (sharkId: string) => {
      let n = 0;
      for (const seed of [1, 2, 3]) {
        const w = createWorld(sharkById(sharkId), NO_UPGRADES, 400 + seed, "frozenStrait");
        for (let i = 0; i < 60 * 20; i++) {
          w.shark.x = 8900;
          w.shark.y = 1500;
          w.shark.hp = 99999;
          step(w, idle, 1 / 60);
          w.events.length = 0;
        }
        n += w.entities.filter((e) => e.alive && e.kind === "orca").length;
      }
      return n;
    };
    expect(orcas("reef")).toBeLessThan(orcas("white"));
  });
});

describe("death cause credit", () => {
  it("a hunger tick right after a hit is credited to the hit; long after, it's starvation", () => {
    const die = (gap: number) => {
      const w = createWorld(sharkById("reef"), NO_UPGRADES, 500);
      isolate(w);
      w.safe = null; // the start bubble would keep the hunter away
      const jelly = place(w, "barracuda", w.shark.x + 10, w.shark.y);
      jelly.attackCd = 0;
      for (let i = 0; i < 10 && !w.lastHit; i++) step(w, idle, 1 / 60);
      jelly.alive = false;
      expect(w.lastHit?.cause).toBe("꼬치고기");
      for (let i = 0; i < gap * 60; i++) { w.shark.hp = Math.max(w.shark.hp, 5); step(w, idle, 1 / 60); }
      w.shark.hp = 0.01;
      for (let i = 0; i < 30 && !w.over; i++) step(w, idle, 1 / 60);
      return summarize(w).cause;
    };
    expect(die(1)).toBe("꼬치고기");
    expect(die(7)).toBe("굶주림");
  });
});

describe("shipwreck safe start + near-tier mercy", () => {
  it("no hunter gets inside the start bubble while it lasts, then it expires", async () => {
    const { safeZoneActive } = await import("./engine");
    const w = createWorld(sharkById("reef"), NO_UPGRADES, 600, "shipwreck");
    expect(w.safe).not.toBeNull();
    const sf = w.safe!;
    // Drop a barracuda right next to the idle shark: it must swim out, never bite.
    const b = place(w, "barracuda", sf.x + 60, sf.y);
    const hp0 = w.shark.hp;
    let minD = Infinity;
    for (let i = 0; i < 60 * 10; i++) {
      step(w, idle, 1 / 60);
      for (const e of w.entities) if (e.alive && e.def.behavior === "hunter") minD = Math.min(minD, Math.hypot(e.x - sf.x, e.y - sf.y));
    }
    expect(b.alive).toBe(true);
    expect(minD).toBeGreaterThan(sf.r * 0.8);
    expect(w.run.damageTaken).toBe(0);
    expect(w.shark.hp).toBeLessThan(hp0); // only hunger
    for (let i = 0; i < 60 * 6; i++) step(w, idle, 1 / 60);
    expect(safeZoneActive(w)).toBe(false);
    // The other maps get a shorter, smaller bubble.
    for (const id of ["deepBlue", "frozenStrait"] as const) {
      const o = createWorld(sharkById("reef"), NO_UPGRADES, 601, id).safe;
      expect(o && o.until).toBe(8);
      expect(o && o.r).toBeLessThan(sf.r);
    }
  });

  it("one-tier-gap hunters (꼬치고기 vs T1) also thin out on the shipwreck", () => {
    const barracudas = (sharkId: string) => {
      let n = 0;
      for (const seed of [1, 2, 3]) {
        const w = createWorld(sharkById(sharkId), NO_UPGRADES, 700 + seed, "shipwreck");
        for (let i = 0; i < 60 * 25; i++) {
          w.shark.x = 4300;
          w.shark.y = 1500;
          w.shark.hp = 99999;
          step(w, idle, 1 / 60);
          w.events.length = 0;
        }
        n += w.entities.filter((e) => e.alive && e.kind === "barracuda").length;
      }
      return n;
    };
    // T1 reef gets the `near` mercy vs 꼬치고기(T2); T2 mako eats them (no mercy).
    expect(barracudas("reef")).toBeLessThan(barracudas("mako"));
  });
});

describe("all-missions bonus", () => {
  it("clearing every mission pays 50% of their rewards once, and only then", async () => {
    const { ALL_MISSIONS_BONUS_RATE } = await import("./data");
    const w = createWorld(sharkById("reef"), NO_UPGRADES, 800);
    isolate(w);
    const total = w.missions.reduce((a, m) => a + m.reward, 0);
    // Two of three done: no bonus yet.
    w.missions[0].goal = 0;
    w.missions[1].goal = 0;
    step(w, idle, 1 / 60);
    expect(w.missionBonus).toBe(0);
    const coins0 = w.coins;
    w.missions[2].goal = 0;
    step(w, idle, 1 / 60);
    const bonus = Math.round(total * ALL_MISSIONS_BONUS_RATE);
    expect(w.missionBonus).toBe(bonus);
    expect(w.coins - coins0).toBe(w.missions[2].reward + bonus);
    expect(w.events.some((e) => e.type === "missionsAll")).toBe(true);
    const c1 = w.coins;
    for (let i = 0; i < 30; i++) step(w, idle, 1 / 60);
    expect(w.coins).toBe(c1); // paid once
    expect(summarize(w).missionBonus).toBe(bonus);
  });
});

describe("mission all-clear streak", () => {
  it("each prior consecutive all-clear adds 10%p to the bonus, capped at 100%", async () => {
    const { allMissionsBonusRate } = await import("./data");
    expect([0, 1, 2, 5, 9].map(allMissionsBonusRate)).toEqual([0.5, 0.6, 0.7, 1, 1]);
    const bonusAt = (streak: number) => {
      const w = createWorld(sharkById("reef"), NO_UPGRADES, 810, "deepBlue", { missionStreak: streak });
      isolate(w);
      for (const m of w.missions) m.goal = 0;
      step(w, idle, 1 / 60);
      const ev = w.events.find((e) => e.type === "missionsAll");
      return { bonus: w.missionBonus, total: w.missions.reduce((a, m) => a + m.reward, 0), ev };
    };
    const a = bonusAt(0), b = bonusAt(3);
    expect(a.bonus).toBe(Math.round(a.total * 0.5));
    expect(b.bonus).toBe(Math.round(b.total * 0.8));
    expect(b.ev && b.ev.type === "missionsAll" && b.ev.streak).toBe(4);
  });

  it("streak survives the save round-trip; junk resets to 0", () => {
    const s = { ...freshSave(), missionStreak: 3, bestMissionStreak: 7 };
    const back = decodeSave(encodeSave(s));
    expect([back.missionStreak, back.bestMissionStreak]).toEqual([3, 7]);
    const junk = { ...freshSave(), missionStreak: -2, bestMissionStreak: "x" } as unknown as typeof s;
    const j = decodeSave(encodeSave(junk));
    expect([j.missionStreak, j.bestMissionStreak]).toEqual([0, 0]);
  });

  it("every map's geometry tags its colliders with a structure kind (rulebook cross-section)", async () => {
    const { MAPS, geometryFor } = await import("./data");
    for (const m of MAPS) for (const c of geometryFor(m).colliders) expect(c.kind).toBeDefined();
  });
});

describe("rulebook cross-section chest spots", () => {
  it("each drawn chest spot has a real chest within the per-dive jitter, on every map", async () => {
    const { MAPS, approxChestSpots, geometryFor } = await import("./data");
    for (const m of MAPS) {
      const spots = approxChestSpots(m);
      expect(spots).toHaveLength(m.chestCount);
      for (const seed of [11, 12]) {
        const w = createWorld(sharkById("reef"), NO_UPGRADES, seed, m.id);
        const real = w.entities.filter((e) => e.kind === "chest").map((e) => e.x).sort((a, b) => a - b);
        spots.forEach((sp, i) => {
          // Next to a hull/pillar the chest may slide off to either side (up to a hull length away).
          const nearStructure = geometryFor(m).colliders.some((c) => Math.abs(c.x - sp.x) < 1300);
          expect(Math.abs(real[i] - sp.x), `${m.id} chest ${i}`).toBeLessThan(nearStructure ? 300 + 1300 : 301);
        });
      }
    }
  });
});

describe("/stats details", () => {
  it("hungry-shark session details merge (max streak/score kept, dives summed) and render", async () => {
    const { mergeStatDetails, STAT_DETAIL_ROWS } = await import("@/lib/stats/details");
    const a = { dives: 4, missionAllClears: 1, maxScore: 9000, maxMissionStreak: 1 };
    const b = { dives: 6, missionAllClears: 3, maxScore: 4000, maxMissionStreak: 3 };
    const m = mergeStatDetails(a, b);
    expect(m).toEqual({ dives: 10, missionAllClears: 4, maxScore: 9000, maxMissionStreak: 3 });
    const shown = STAT_DETAIL_ROWS["hungry-shark"].map((r) => r.value(m, 2));
    expect(shown).toEqual(["9,000", "10회", "40% (4/10)", "3회"]);
  });
});
