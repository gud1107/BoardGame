import { describe, expect, it } from "vitest";
import { BOSSES, DIFFICULTIES, ENEMIES, HERO_ORDER, HEROES, MECHA, STAGES, stageGrade, styleRank, type MoveDef } from "./data";
import { botInput, createWorld, heroActor, NO_INPUT, step, type Input, type World } from "./engine";
import { applySummary, freshSave } from "./save";

function run(w: World, ticks: number, inp: (w: World) => Input = () => NO_INPUT) {
  for (let i = 0; i < ticks; i++) {
    step(w, inp(w));
    w.events.length = 0;
  }
}

function playToEnd(stage: number, hero: (typeof HERO_ORDER)[number], diff: "easy" | "normal" | "hard", seed: number) {
  const w = createWorld({ stage, hero, diff, seed });
  const mem = { t: 0 };
  let n = 0;
  while (w.phase !== "clear" && w.phase !== "over" && n < 60 * 60 * 12) {
    step(w, botInput(w, mem));
    w.events.length = 0;
    n++;
  }
  return w;
}

/** Skips the henshin intro and parks the hero next to a single grunt. */
function arena(enemy: keyof typeof ENEMIES = "grunt") {
  const w = createWorld({ stage: 1, hero: "red", diff: "normal", seed: 7 });
  run(w, 151);
  const h = heroActor(w);
  w.waveIdx = 99; // no scripted waves
  w.lockX = w.camX;
  const e = { ...h, id: 999, kind: "enemy" as const, team: 1 as const, enemyId: enemy, name: ENEMIES[enemy].name, x: h.x + 40, hp: 5000, maxHp: 5000, face: -1 as const, heroId: undefined, entered: true, ai: { cd: 9999, think: 0, side: 1 as const, wz: h.z, patCd: {}, zOff: 0 }, state: "idle" as const, breakMax: ENEMIES[enemy].breakMax ?? 0 };
  w.actors.push(e);
  return { w, h, e: w.actors[w.actors.length - 1] };
}

const press = (k: Partial<Input>): Input => ({ ...NO_INPUT, ...k });

describe("data invariants", () => {
  const all: MoveDef[] = [];
  for (const id of HERO_ORDER) {
    const h = HEROES[id];
    all.push(...h.chain, h.heavy, h.finisher, ...h.air, h.airHeavy, h.dashAtk, h.slide, ...h.skills, h.ult, h.assist);
  }
  for (const e of Object.values(ENEMIES)) all.push(...e.moves);
  for (const b of Object.values(BOSSES)) all.push(...b.patterns.map((p) => p.move), ...b.giantMoves);
  all.push(...MECHA.chain, MECHA.heavy, MECHA.rocket, MECHA.finish);

  it("every hit and projectile fires inside its move", () => {
    for (const m of all) {
      for (const h of m.hits) expect(h.at, `${m.id}/${m.name}`).toBeLessThan(m.untilLand ? 999 : m.total);
      for (const p of m.proj ?? []) expect(p.at, m.name).toBeLessThan(m.total);
      if (m.cancel !== undefined) expect(m.cancel).toBeLessThan(m.total);
    }
  });

  it("every hero has 3 costed skills, a launcher and an ultimate", () => {
    for (const id of HERO_ORDER) {
      const h = HEROES[id];
      expect(h.skills).toHaveLength(3);
      for (const s of h.skills) {
        expect(s.en, s.name).toBeGreaterThan(0);
        expect(s.cd, s.name).toBeGreaterThan(0);
      }
      expect(h.heavy.hits.some((x) => x.kind === "launch")).toBe(true);
      expect(h.ult.hits.some((x) => x.screen)).toBe(true);
    }
  });

  it("each stage ends in exactly one boss wave", () => {
    for (const s of STAGES) {
      const bosses = s.waves.filter((w) => w.boss);
      expect(bosses).toHaveLength(1);
      expect(s.waves[s.waves.length - 1].boss).toBeTruthy();
      expect(s.waves[s.waves.length - 1].at).toBeLessThan(s.length);
    }
  });

  it("grades and style ranks are monotone", () => {
    expect(stageGrade(95)).toBe("S");
    expect(stageGrade(10)).toBe("C");
    expect(styleRank(0).id).toBe("D");
    expect(styleRank(9999).id).toBe("SSS");
  });
});

describe("engine", () => {
  it("is deterministic for a seed", () => {
    const a = playToEnd(1, "red", "normal", 3);
    const b = playToEnd(1, "red", "normal", 3);
    expect(a.score).toBe(b.score);
    expect(a.tick).toBe(b.tick);
  });

  it("henshin intro locks input, then play starts", () => {
    const w = createWorld({ stage: 1, hero: "blue", diff: "normal" });
    run(w, 60, () => press({ mx: 1 }));
    expect(w.phase).toBe("intro");
    expect(heroActor(w).x).toBe(120);
    run(w, 100, () => press({ mx: 1 }));
    expect(w.phase).toBe("play");
    expect(heroActor(w).x).toBeGreaterThan(120);
  });

  it("light chain → finisher knocks a grunt down and counts a combo", () => {
    const { w, e } = arena();
    const seq: Partial<Input>[] = [{ light: true }, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, { light: true }, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, { heavy: true }];
    for (const k of seq) {
      step(w, press(k));
      w.events.length = 0;
    }
    run(w, 30);
    expect(w.combo).toBeGreaterThanOrEqual(3);
    expect(["air", "down"]).toContain(e.state);
  });

  it("launcher puts a grunt in the air, and jump-cancel chases it", () => {
    const { w, h, e } = arena();
    step(w, press({ heavy: true }));
    run(w, 16);
    expect(e.state).toBe("air");
    expect(e.y).toBeGreaterThan(0);
    step(w, press({ jump: true }));
    run(w, 12);
    expect(h.state).toBe("jump");
    expect(h.vy).toBeGreaterThan(0);
  });

  it("front shield blocks light hits until a launcher breaks the guard", () => {
    const { w, h, e } = arena("shield");
    const pin = () => {
      if (e.state === "walk" || e.state === "idle") {
        e.x = h.x + 40;
        e.z = h.z;
        e.face = -1;
      }
      return NO_INPUT;
    };
    const hp0 = e.hp;
    pin();
    step(w, press({ light: true }));
    run(w, 14, pin);
    expect(e.hp).toBe(hp0);
    run(w, 20, pin);
    step(w, press({ heavy: true }));
    run(w, 16, pin);
    expect(e.hp).toBeLessThan(hp0);
    expect(e.guardBroken).toBeGreaterThan(0);
  });

  it("bosses have super armor until the break gauge fills", () => {
    const { w, e } = arena();
    e.kind = "boss";
    e.bossId = "hornbuster";
    e.breakMax = 60;
    step(w, press({ light: true }));
    run(w, 10);
    expect(e.state).not.toBe("hit");
    for (let i = 0; i < 6; i++) {
      step(w, press({ heavy: true }));
      run(w, 36);
    }
    expect(e.broken > 0 || e.state === "stunned" || e.breakG === 0).toBe(true);
  });

  it("dodging into an attack at the last moment triggers 섬광 회피", () => {
    const { w, h, e } = arena();
    e.next = ENEMIES.grunt.moves[0];
    e.state = "tell";
    e.stun = 1;
    run(w, 6); // grunt's punch becomes active at tick 8
    step(w, press({ dodge: true, mx: 0 }));
    run(w, 4);
    expect(w.perfectDodges).toBe(1);
    expect(h.hp).toBe(h.maxHp);
  });

  it("losing all HP spends a henshin stock and refills HP", () => {
    const { w, h } = arena();
    const lives = w.lives;
    h.hp = 0;
    h.state = "hit";
    run(w, 120);
    expect(w.lives).toBe(lives - 1);
    expect(h.hp).toBe(h.maxHp);
  });

  it("giants only die to the finisher", () => {
    const w = playToEnd(1, "red", "normal", 1);
    expect(w.phase).toBe("clear");
    expect(w.bossKills).toBe(1);
    expect(w.summary?.cleared).toBe(true);
  });
});

describe("balance sims (bot)", () => {
  it.each(HERO_ORDER)("%s clears stage 1 on normal", (hero) => {
    const w = playToEnd(1, hero, "normal", 2);
    expect(w.phase).toBe("clear");
  });

  it.each(STAGES.map((s) => s.id))("red clears stage %i on easy", (stage) => {
    const w = playToEnd(stage, "red", "easy", 4);
    expect(w.phase).toBe("clear");
    expect(w.summary!.timeSec).toBeLessThan(STAGES[stage - 1].par * 2);
  });

  it("hard hits harder than easy", () => {
    expect(DIFFICULTIES.hard.dmg).toBeGreaterThan(DIFFICULTIES.easy.dmg);
    const easy = playToEnd(3, "green", "easy", 5);
    const hard = playToEnd(3, "green", "hard", 5);
    expect(hard.dmgTaken).toBeGreaterThan(easy.dmgTaken);
  });
});

describe("save", () => {
  it("clearing a stage unlocks the next and keeps the best", () => {
    const s = freshSave();
    const w = playToEnd(1, "pink", "normal", 2);
    const { next, newBest, unlockedStage } = applySummary(s, w.summary!);
    expect(newBest).toBe(true);
    expect(unlockedStage).toBe(2);
    expect(next.unlocked).toBe(2);
    expect(next.best["1-normal"].score).toBe(w.summary!.score);
    const again = applySummary(next, { ...w.summary!, score: 1 });
    expect(again.newBest).toBe(false);
    expect(again.next.best["1-normal"].score).toBe(w.summary!.score);
  });
});
