import { describe, expect, it } from "vitest";
import { BUBBLE_STUN, epicBounty, gearDropOdds, GEARS, isUnlocked, MUTATIONS, LEVELS, tierForLevel, levelForScore, MAX_LEVEL, PERK_ARMOR, POOL_HEAL_RATE, roadmap, SHIELDS, SPECIES, SPECIES_LIST, STAMINA_MAX } from "./data";
import { EMPTY_RECORD, nextSpeciesRecord } from "./save";
import { addScore, applyMutation, armorMult, atkMult, botThink, createWorld, equipGear, penaltyLeft, player, revivePlayer, step, summarize, swing, updateLeaderboard, type Crab, type CrabInput, type World } from "./engine";

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
  w.mines = [];
  w.hazards = [];
  w.shots = [];
  for (const c of w.crabs) {
    c.species = "flower";
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
  it("하이퍼 성장: early milestones cut 40%, late ones tuned so Lv12 lands ~2x sooner", () => {
    expect(MAX_LEVEL).toBe(12);
    const anchors = [0, 2, 4, 6, 8, 11].map((i) => LEVELS[i]);
    expect(anchors.map((l) => [l.points, l.scale, l.atk, l.hp])).toEqual([
      [0, 1.0, 10, 100],
      [600, 1.3, 18, 200],
      [3_000, 1.7, 35, 450],
      [15_000, 2.2, 65, 1_000],
      [90_000, 2.8, 120, 2_500],
      [720_000, 3.5, 220, 5_000],
    ]);
    expect(levelForScore(299).level).toBe(1);
    expect(levelForScore(300).level).toBe(2);
    expect(levelForScore(719_999).level).toBe(11);
    expect(levelForScore(720_000).level).toBe(12);
    // Gaps shrink: no step asks for more than ~2.3x the previous threshold.
    for (let i = 2; i < LEVELS.length; i++) expect(LEVELS[i].points / LEVELS[i - 1].points).toBeLessThan(2.6);
  });

  it("every species roadmap is strictly increasing and differs where it should", () => {
    for (const sp of SPECIES_LIST) {
      const r = roadmap(sp.id);
      expect(r).toHaveLength(12);
      for (let i = 1; i < r.length; i++) {
        expect(r[i].points).toBeGreaterThan(r[i - 1].points);
        expect(r[i].hp).toBeGreaterThan(r[i - 1].hp);
        expect(r[i].scale).toBeGreaterThan(r[i - 1].scale);
      }
    }
    const [flower, ghost, snow, fiddler] = (["flower", "ghost", "snow", "fiddler"] as const).map((id) => roadmap(id));
    expect(ghost[6].points).toBeLessThan(flower[6].points); // speed: early levels cheaper
    expect(ghost[11].points).toBeGreaterThan(flower[11].points); // ...late ones pricier
    expect(snow[6].points).toBeGreaterThan(flower[6].points); // tank: slow start
    expect(snow[11].points).toBeLessThan(flower[11].points); // ...fast finish
    expect(snow[11].hp).toBeGreaterThan(flower[11].hp);
    expect(fiddler[11].atk).toBeGreaterThan(flower[11].atk);
    expect(ghost[0].speed).toBeGreaterThan(flower[0].speed);
  });

  it("levels up on score, grows HP, and lerps the body scale smoothly", () => {
    const w = bare();
    const me = player(w);
    addScore(w, me, 3_000);
    expect(me.level).toBe(5);
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
    expect(foe.score).toBeGreaterThanOrEqual(2_000 + 75);
    expect(revivePlayer(w)).toBe(true);
    expect(me.alive).toBe(true);
    expect(me.score).toBe(5_000);
    expect(me.weapon).toEqual({ kind: "bat", dur: 4 });
    expect(w.revivesLeft).toBe(0);
  });
});

describe("species level-up traits + unlocks", () => {
  it("only 꽃게 is free; the rest unlock by lifetime trophies", () => {
    expect(isUnlocked("flower", 0)).toBe(true);
    for (const sp of SPECIES_LIST.filter((x) => x.id !== "flower")) {
      expect(isUnlocked(sp.id, sp.unlock - 1)).toBe(false);
      expect(isUnlocked(sp.id, sp.unlock)).toBe(true);
    }
  });

  it("each species fires its own surge on level-up", () => {
    const w = bare();
    const me = player(w);

    me.species = "ghost";
    me.stamina = 10;
    addScore(w, me, 500);
    expect(me.level).toBeGreaterThan(1);
    expect(me.stamina).toBe(STAMINA_MAX);
    expect(me.surge).toBeCloseTo(SPECIES.ghost.perk.seconds);
    const ev = w.events.find((e) => e.type === "levelUp");
    expect(ev && ev.type === "levelUp" && ev.species).toBe("ghost");
    expect(w.particles.some((p) => p.kind === "streak")).toBe(true);

    const w2 = bare(1);
    const [tank, foe] = w2.crabs;
    tank.species = "snow";
    foe.x = 40;
    tank.angle = 0; // facing away from nothing in particular; no shield anyway
    foe.angle = Math.PI;
    tank.hp = tank.maxHp = 1e6;
    swing(w2, foe);
    const plain = 1e6 - tank.hp;
    tank.hp = 1e6;
    tank.surge = 3;
    foe.attackCd = 0;
    foe.combo = 0;
    foe.comboT = 0;
    swing(w2, foe);
    const armored = 1e6 - tank.hp;
    expect(armored).toBeLessThanOrEqual(Math.ceil(plain * PERK_ARMOR * 1.25 * 1.75));
    expect(armored).toBeLessThan(plain * 1.25);
  });
});

describe("expansion species traits", () => {
  it("offers 8 growth paths with rising unlock costs", () => {
    expect(SPECIES_LIST).toHaveLength(8);
    const locks = SPECIES_LIST.map((sp) => sp.unlock);
    expect(locks[0]).toBe(0);
    for (let i = 1; i < locks.length; i++) expect(locks[i]).toBeGreaterThan(locks[i - 1]);
  });

  it("소라게 repairs (or grants) a shield on level-up", () => {
    const w = bare();
    const me = player(w);
    me.species = "hermit";
    addScore(w, me, 500);
    expect(me.shield).toEqual({ kind: "potLid", dur: SHIELDS.potLid.durability });
    me.shield = { kind: "shell", dur: 1 };
    addScore(w, me, 1_000);
    expect(me.shield.dur).toBe(SHIELDS.shell.durability);
  });

  it("참게 heals from damage dealt while surging", () => {
    const w = bare(1);
    const [me, foe] = w.crabs;
    me.species = "mitten";
    foe.x = 40;
    foe.hp = foe.maxHp = 1e6;
    me.angle = 0;
    me.hp = 10;
    me.surge = 4;
    swing(w, me);
    expect(me.hp).toBeGreaterThan(10);
  });

  it("홍게 showers coins on level-up and earns more per bite", () => {
    const w = bare();
    const me = player(w);
    me.species = "redsnow";
    addScore(w, me, 500);
    expect(w.pickups.filter((p) => p.type === "coin").length).toBeGreaterThanOrEqual(6);
    expect(roadmap("redsnow")[5].gain).toBeGreaterThan(roadmap("flower")[5].gain);
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
    let sawKing = false;
    while (!w.over) {
      if (w.playerDown) revivePlayer(w);
      step(w, me.alive ? botThink(w, me, 1 / 30) : idle, 1 / 30);
      if (w.kingId !== null) sawKing = true;
      w.events.length = 0;
    }
    const s = summarize(w);
    expect(w.crabs.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.hp))).toBe(true);
    expect(Math.max(...w.crabs.map((c) => c.score))).toBeGreaterThan(5_000);
    expect(sawKing).toBe(true);
    expect(s.rank).toBeGreaterThanOrEqual(1);
    expect(s.rank).toBeLessThanOrEqual(s.total);
    expect(s.total).toBe(w.crabs.length);
  }, 30_000);
});

describe("하이퍼 성장: tiers + special skills", () => {
  it("maps levels to the 4 evolution tiers", () => {
    expect([1, 3, 4, 7, 8, 10, 11, 12].map(tierForLevel)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it("Tier 1 dash rolls you forward and makes you briefly untouchable", () => {
    const w = bare(1);
    const me = player(w);
    step(w, { ...idle, moveX: 1, skill: true }, 1 / 60);
    expect(me.invuln).toBeGreaterThan(0.2);
    expect(me.vx).toBeGreaterThan(400);
    expect(me.skillCd).toBeGreaterThan(3);
  });

  it("Tier 2 bubble spit stuns every crab around", () => {
    const w = bare(2);
    const [me, a, b] = w.crabs;
    addScore(w, me, 1_300);
    a.x = 80;
    b.x = -90;
    step(w, { ...idle, skill: true }, 1 / 60);
    expect(a.stun).toBeGreaterThan(BUBBLE_STUN - 0.1);
    expect(b.stun).toBeGreaterThan(BUBBLE_STUN - 0.1);
  });

  it("Tier 3 burrow is immune, then erupts and launches nearby crabs", () => {
    const w = bare(1);
    const [me, foe] = w.crabs;
    addScore(w, me, 36_000);
    me.scale = 2.5;
    foe.x = 400;
    step(w, { ...idle, skill: true }, 1 / 60);
    expect(me.burrow).toBeGreaterThan(1);
    foe.x = 60;
    face(foe, me);
    const hp = me.hp;
    swing(w, foe);
    expect(me.hp).toBe(hp);
    const foeHp = foe.hp;
    for (let i = 0; i < 100; i++) step(w, idle, 1 / 60);
    expect(me.burrow).toBe(0);
    expect(foe.hp).toBeLessThan(foeHp);
  });

  it("Tier 4 hydro cannon pierces everything on its line", () => {
    const w = bare(2);
    const [me, a, b] = w.crabs;
    addScore(w, me, 440_000);
    me.angle = 0;
    a.x = 200;
    b.x = 420;
    a.hp = a.maxHp = b.hp = b.maxHp = 5_000;
    step(w, { ...idle, skill: true }, 1 / 60);
    expect(a.hp).toBeLessThan(5_000);
    expect(b.hp).toBeLessThan(5_000);
    expect(w.beams.some((x) => x.kind === "hydro")).toBe(true);
  });
});

describe("field weapons", () => {
  it("hold at most two, refresh on a duplicate, and expire", () => {
    const w = bare();
    const me = player(w);
    expect(equipGear(w, me, "shotgun")).toBe(true);
    expect(equipGear(w, me, "needle")).toBe(true);
    me.gear[0].t = 1;
    expect(equipGear(w, me, "shotgun")).toBe(true);
    expect(me.gear[0].t).toBe(GEARS.shotgun.duration);
    me.gear[1].t = 2;
    expect(equipGear(w, me, "trident")).toBe(true);
    expect(me.gear.map((g) => g.kind).sort()).toEqual(["shotgun", "trident"]);
    for (let i = 0; i < 60 * 43; i++) step(w, idle, 1 / 60);
    expect(me.gear).toHaveLength(0);
  });

  it("auto-fire at the nearest foe and land hits", () => {
    for (const kind of ["shotgun", "needle", "trident", "zap", "vortex"] as const) {
      const w = bare(1);
      const [me, foe] = w.crabs;
      foe.brain = null; // a sitting target — live bots dash out of the way
      foe.x = 160;
      foe.hp = foe.maxHp = 10_000;
      equipGear(w, me, kind);
      for (let i = 0; i < 60; i++) step(w, idle, 1 / 60);
      expect(foe.hp, kind).toBeLessThan(10_000);
    }
  });

  it("puffer mines arm behind you and blow up under a pursuer", () => {
    const w = bare(1);
    const [me, foe] = w.crabs;
    foe.x = -2000;
    equipGear(w, me, "mine");
    for (let i = 0; i < 20; i++) step(w, { ...idle, moveX: 1 }, 1 / 60);
    expect(w.mines.length).toBeGreaterThan(0);
    const m = w.mines[0];
    for (let i = 0; i < 60; i++) step(w, idle, 1 / 60);
    foe.x = m.x;
    foe.y = m.y;
    foe.hp = foe.maxHp = 10_000;
    step(w, idle, 1 / 60);
    expect(foe.hp).toBeLessThan(10_000);
  });
});

describe("mutations", () => {
  it("rum reverses the controls but every hit crits", () => {
    const w = bare(1);
    const [me, foe] = w.crabs;
    applyMutation(w, me, "rum");
    step(w, { ...idle, moveX: 1 }, 1 / 60);
    expect(me.x).toBeLessThan(0);
    me.x = 0;
    foe.x = 40;
    face(me, foe);
    swing(w, me);
    expect(w.texts.some((t) => t.text.startsWith("치명타"))).toBe(true);
  });

  it("toxic barrel triples damage and drains 2% HP per second", () => {
    const w = bare();
    const me = player(w);
    const base = atkMult(me);
    applyMutation(w, me, "toxic");
    expect(atkMult(me)).toBeCloseTo(base * 3, 5);
    me.hp = me.maxHp = 1000;
    for (let i = 0; i < 60; i++) step(w, idle, 1 / 60);
    expect(me.hp).toBeCloseTo(980, 0);
  });

  it("salt slows you and shrugs off knockback", () => {
    const a = bare(), b = bare();
    applyMutation(b, player(b), "salt");
    for (let i = 0; i < 30; i++) {
      step(a, { ...idle, moveX: 1 }, 1 / 60);
      step(b, { ...idle, moveX: 1 }, 1 / 60);
    }
    expect(player(b).x / player(a).x).toBeCloseTo(0.6, 1);
  });

  it("pearl shield eats two hits then pops", () => {
    const w = bare(1);
    const [me, foe] = w.crabs;
    applyMutation(w, me, "pearl");
    foe.x = 40;
    face(foe, me);
    const hp = me.hp;
    swing(w, foe);
    foe.attackCd = 0;
    swing(w, foe);
    expect(me.hp).toBe(hp);
    expect(me.pearl).toBe(0);
    swing(w, foe);
    expect(me.hp).toBeLessThan(hp);
  });

  it("oil slick takes the wheel for 3 seconds", () => {
    const w = bare();
    const me = player(w);
    step(w, { ...idle, moveX: 1 }, 1 / 60);
    applyMutation(w, me, "oil");
    const x0 = me.x;
    for (let i = 0; i < 30; i++) step(w, { ...idle, moveX: -1 }, 1 / 60);
    expect(me.x).toBeGreaterThan(x0); // still skating right despite pushing left
    for (let i = 0; i < 180; i++) step(w, idle, 1 / 60);
    expect(me.slide).toBeNull();
  });

  it("golden capsule pulls food in and pays triple", () => {
    const w = bare();
    const me = player(w);
    applyMutation(w, me, "capsule");
    w.pickups.push({ id: 999, type: "food", food: "banana", value: 62, absolute: false, x: 70, y: 0, vx: 0, vy: 0, z: 0, vz: 0, radius: 9, age: 0, ttl: Infinity, lockId: 0, lockT: 0 });
    for (let i = 0; i < 30; i++) step(w, idle, 1 / 60);
    expect(w.pickups.find((p) => p.id === 999)).toBeUndefined();
    expect(me.score).toBe(186);
  });
});

describe("risk mutations: short penalty, long upside", () => {
  it("every risk item's downside ends before its upside", () => {
    for (const m of Object.values(MUTATIONS)) if (m.risk && m.kind !== "oil") expect(m.penalty!).toBeLessThan(m.duration);
  });

  it("rum: controls come back after the penalty but the crits stay", () => {
    const w = bare(1);
    const [me, foe] = w.crabs;
    foe.brain = null;
    foe.x = 3000;
    applyMutation(w, me, "rum");
    for (let i = 0; i < 60 * 5.2; i++) step(w, idle, 1 / 60);
    expect(penaltyLeft(me, "rum")).toBe(0);
    me.x = 0;
    step(w, { ...idle, moveX: 1 }, 1 / 60);
    expect(me.x).toBeGreaterThan(0);
    foe.x = 40;
    foe.y = me.y;
    face(me, foe);
    w.texts = [];
    swing(w, me);
    expect(w.texts.some((t) => t.text.startsWith("치명타"))).toBe(true);
  });

  it("salt: the slow wears off while the armor holds", () => {
    const w = bare();
    const me = player(w);
    applyMutation(w, me, "salt");
    for (let i = 0; i < 60 * 4.2; i++) step(w, idle, 1 / 60);
    expect(armorMult(me)).toBeLessThan(0.6);
    const x0 = me.x;
    step(w, { ...idle, moveX: 1 }, 1 / 10);
    expect(me.x - x0).toBeCloseTo(12.5, 1); // full 250 u/s Lv1 speed (step clamps dt to 0.05)
  });

  it("toxic: the self-damage stops after the penalty, the triple damage doesn't", () => {
    const w = bare();
    const me = player(w);
    applyMutation(w, me, "toxic");
    me.hp = me.maxHp = 1000;
    for (let i = 0; i < 60 * 7; i++) step(w, idle, 1 / 60);
    const hp = me.hp;
    for (let i = 0; i < 60 * 2; i++) step(w, idle, 1 / 60);
    expect(me.hp).toBeGreaterThanOrEqual(hp);
    expect(atkMult(me)).toBeCloseTo(3, 5);
  });
});

describe("weapon rarity", () => {
  it("rarer weapons hit harder and last longer", () => {
    expect(GEARS.shotgun.dmg).toBe(GEARS.shotgun.baseDmg);
    expect(GEARS.zap.dmg).toBeCloseTo(GEARS.zap.baseDmg * 1.15, 3);
    expect(GEARS.zap.duration).toBe(36);
    expect(GEARS.trident.dmg).toBeCloseTo(GEARS.trident.baseDmg * 1.3, 3);
    expect(GEARS.trident.duration).toBe(42);
    expect(GEARS.vortex.rarity).toBe("epic");
  });

  it("the kraken vortex drags a crab into its eye and grinds it", () => {
    const w = bare(1);
    const [me, foe] = w.crabs;
    foe.brain = null;
    foe.x = 200;
    foe.y = 60;
    foe.hp = foe.maxHp = 10_000;
    equipGear(w, me, "vortex");
    for (let i = 0; i < 20; i++) step(w, idle, 1 / 60);
    const v = w.shots.find((s) => s.kind === "vortex");
    expect(v).toBeDefined();
    const d0 = Math.hypot(foe.x - v!.x, foe.y - v!.y);
    for (let i = 0; i < 40; i++) step(w, idle, 1 / 60);
    expect(Math.hypot(foe.x - v!.x, foe.y - v!.y)).toBeLessThan(d0);
    expect(foe.hp).toBeLessThan(10_000);
  });

  it("rarer weapons drop less often; golden chests skip commons", () => {
    const all = gearDropOdds(), rare = gearDropOdds("rare");
    expect(all.trident).toBeLessThan(all.zap);
    expect(all.zap).toBeLessThan(all.shotgun);
    expect(Object.values(all).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    expect(rare.shotgun).toBe(0);
    expect(rare.trident).toBeGreaterThan(all.trident * 3);
  });

  it("a rarer weapon bumps a common one off a full rack, never the reverse", () => {
    const w = bare();
    const me = player(w);
    equipGear(w, me, "shotgun");
    equipGear(w, me, "trident");
    expect(equipGear(w, me, "needle")).toBe(false); // fresh common can't push out a fresh common/epic
    expect(equipGear(w, me, "zap")).toBe(true); // rare replaces the common
    expect(me.gear.map((g) => g.kind).sort()).toEqual(["trident", "zap"]);
    expect(equipGear(w, me, "shotgun")).toBe(false); // a fresh rare/epic beats a common
    me.gear.forEach((g) => (g.t = 1));
    expect(equipGear(w, me, "shotgun")).toBe(true); // ...until it's nearly spent
  });
});

describe("duplicate stacking + legendary bounty", () => {
  it("a duplicate weapon upgrades to ★3 max, hitting harder and firing faster", () => {
    const run = (stars: number) => {
      const w = bare(1);
      const [me, foe] = w.crabs;
      foe.brain = null;
      foe.x = 150;
      foe.hp = foe.maxHp = 100_000;
      for (let i = 0; i < stars; i++) equipGear(w, me, "needle");
      for (let i = 0; i < 120; i++) step(w, idle, 1 / 60);
      return { lv: me.gear[0].lv, dealt: 100_000 - foe.hp };
    };
    const one = run(1), three = run(3), five = run(5);
    expect(one.lv).toBe(1);
    expect(three.lv).toBe(3);
    expect(five.lv).toBe(3); // capped
    expect(three.dealt).toBeGreaterThan(one.dealt * 1.5);
  });

  it("picking up a legendary alerts the island once, not on refresh", () => {
    const w = bare(1);
    const foe = w.crabs[1];
    equipGear(w, foe, "trident");
    expect(w.events.filter((e) => e.type === "epicAlert")).toHaveLength(1);
    equipGear(w, foe, "trident");
    expect(w.events.filter((e) => e.type === "epicAlert")).toHaveLength(1);
  });

  it("bots go after whoever carries a legendary", () => {
    const w = bare(3);
    const [, hunter, plain, epic] = w.crabs;
    player(w).x = 3000;
    addScore(w, hunter, 15_000);
    hunter.hp = hunter.maxHp;
    hunter.brain!.aggression = 0.6;
    plain.x = 300;
    epic.x = -300;
    plain.brain = epic.brain = null;
    equipGear(w, epic, "vortex");
    epic.gear[0].t = 999;
    hunter.brain!.think = 0;
    botThink(w, hunter, 1 / 60);
    expect(hunter.brain!.targetId).toBe(epic.id);
  });
});

describe("legendary bounty", () => {
  it("flipping a legendary carrier pays the bounty on top of the kill reward", () => {
    const pay = (epic: boolean) => {
      const w = bare(1);
      const [me, foe] = w.crabs;
      foe.brain = null;
      foe.x = 40;
      if (epic) equipGear(w, foe, "trident");
      foe.hp = 1;
      face(me, foe);
      swing(w, me);
      expect(foe.alive).toBe(false);
      const kill = w.events.find((e) => e.type === "kill");
      return { score: me.score, bounty: kill && kill.type === "kill" ? kill.bounty : -1 };
    };
    const plain = pay(false), epic = pay(true);
    expect(plain.bounty).toBe(0);
    expect(epic.bounty).toBe(epicBounty(1));
    expect(epic.score - plain.score).toBeGreaterThanOrEqual(epicBounty(1) - 50);
  });
});

describe("growing bounty + 생존 보상 + match record", () => {
  it("the bounty grows the longer a legendary is carried, up to the cap", () => {
    expect(epicBounty(5, 0)).toBe(5_500);
    expect(epicBounty(5, 30)).toBe(5_500 + 30 * 120);
    expect(epicBounty(5, 10_000)).toBe(5_500 + 15_000);
  });

  it("carrying a legendary pays a survival bonus every 5s and grows my bounty", () => {
    const w = bare();
    const me = player(w);
    equipGear(w, me, "trident");
    me.gear[0].t = 999;
    for (let i = 0; i < 60 * 10.2; i++) step(w, idle, 1 / 60);
    expect(me.epicT).toBeGreaterThan(10);
    expect(w.stats.survivalBonus).toBe(2 * 150);
    expect(w.stats.epicSeconds).toBeGreaterThan(10);
    expect(me.score).toBeGreaterThanOrEqual(300);
  });

  it("killing a long-time carrier pays the grown bounty and records it", () => {
    const w = bare(1);
    const [me, foe] = w.crabs;
    foe.brain = null;
    foe.x = 40;
    equipGear(w, foe, "vortex");
    foe.gear[0].t = 999;
    foe.epicT = 20;
    foe.hp = 1;
    face(me, foe);
    swing(w, me);
    expect(w.stats.bounties).toBe(1);
    expect(w.stats.bountyPoints).toBe(epicBounty(foe.level, 20));
  });

  it("records the best weapon star", () => {
    const w = bare();
    const me = player(w);
    equipGear(w, me, "needle");
    equipGear(w, me, "needle");
    expect(w.stats.bestStar).toBe(2);
  });
});

describe("WANTED carriers + per-species bounty records", () => {
  it("announces a carrier once when its bounty crosses the WANTED line", () => {
    const w = bare();
    const me = player(w);
    equipGear(w, me, "trident");
    me.gear[0].t = 9_999;
    w.events.length = 0;
    // Lv1: 3,500 base → crosses 10,000 after ~55s of carrying.
    for (let i = 0; i < 60 * 70; i++) step(w, idle, 1 / 60);
    expect(w.events.filter((e) => e.type === "wanted")).toHaveLength(1);
  });

  it("keeps the best bounty / longest carry per species and flags new records", () => {
    const first = nextSpeciesRecord(EMPTY_RECORD, { score: 1000, rank: 3, maxLevel: 5, bountyPoints: 8000, epicSeconds: 40.4 });
    expect(first.record.bestBounty).toBe(8000);
    expect(first.record.longestEpic).toBe(40);
    expect(first.bountyRecord && first.epicRecord).toBe(true);
    const worse = nextSpeciesRecord(first.record, { score: 500, rank: 5, maxLevel: 4, bountyPoints: 3000, epicSeconds: 10 });
    expect(worse.record.bestBounty).toBe(8000);
    expect(worse.bountyRecord || worse.epicRecord).toBe(false);
    // Saves from before these fields existed still work.
    const legacy = nextSpeciesRecord({ best: 10, wins: 0, matches: 3, maxLevel: 2 }, { score: 5, rank: 9, maxLevel: 1 });
    expect(legacy.record.bestBounty).toBe(0);
    expect(legacy.bountyRecord).toBe(false);
  });
});

describe("evolution reveal", () => {
  it("a level-up starts the shell-pattern reveal, which runs out on its own", () => {
    const w = bare();
    const me = player(w);
    expect(me.evoT).toBe(0);
    addScore(w, me, 1_300);
    expect(me.evoT).toBeGreaterThan(0.5);
    for (let i = 0; i < 60; i++) step(w, idle, 1 / 60);
    expect(me.evoT).toBe(0);
  });
});

describe("crown flourish", () => {
  it("taking the crown (after the opening 10s) starts the player's gold flourish, which runs out", () => {
    const w = bare(1);
    const [me, foe] = w.crabs;
    w.time = 20;
    foe.score = 100;
    me.score = 50_000;
    updateLeaderboard(w);
    expect(w.kingId).toBe(me.id);
    expect(w.kingFx).toBeGreaterThan(1);
    for (let i = 0; i < 60 * 1.5; i++) step(w, idle, 1 / 60);
    expect(w.kingFx).toBe(0);
  });

  it("a bot taking the crown doesn't trigger it", () => {
    const w = bare(1);
    const [me, foe] = w.crabs;
    w.time = 20;
    me.score = 10;
    foe.score = 50_000;
    updateLeaderboard(w);
    expect(w.kingId).toBe(foe.id);
    expect(w.kingFx).toBe(0);
  });
});

describe("crown lost", () => {
  it("being overtaken while alive plays the red flourish and tells the UI who took it", () => {
    const w = bare(1);
    const [me, foe] = w.crabs;
    w.time = 20;
    me.score = 50_000;
    foe.score = 100;
    updateLeaderboard(w);
    expect(w.kingId).toBe(me.id);
    w.events.length = 0;
    foe.score = 80_000;
    updateLeaderboard(w);
    expect(w.kingId).toBe(foe.id);
    expect(w.crownLostFx).toBeGreaterThan(1);
    expect(w.usurpFx).toBeGreaterThan(3); // the new king stays highlighted for a few seconds
    expect(w.events.some((e) => e.type === "crownLost" && e.by === foe.name)).toBe(true);
    for (let i = 0; i < 60 * 4.2; i++) step(w, idle, 1 / 60);
    expect(w.usurpFx).toBe(0);
  });
});
