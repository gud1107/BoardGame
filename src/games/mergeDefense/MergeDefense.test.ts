import { describe, expect, it } from "vitest";
import {
  applyAction,
  canMerge,
  chooseBotAction,
  computeRankings,
  fieldLoad,
  hireCost,
  SWARM_SIZE,
  SEND_COOLDOWN_TICKS,
  slotCenter,
  unitRange,
  loadLimit,
  wakeCost,
  COMBO,
  comboGold,
  critStats,
  FOCUS_MAX,
  focusCost,
  CRIT,
  braceCost,
  stunTicks,
  BRACE_MAX,
  killGold,
  MINION_CAP,
  eliminationLimit,
  MAX_GRADE,
  pathPoint,
  PATH_LEN,
  PREP_TICKS,
  sanitizeAction,
  startGame,
  stepGame,
  summonCost,
  type MergeDefenseState,
} from "./engine";

function runBots(n: number, seed: number, maxTicks = 20 * 60 * 25, mode: "survival" | "versus" = "survival"): MergeDefenseState {
  let s = startGame(n, seed, [], mode);
  while (s.phase === "playing" && s.tick < maxTicks) {
    for (let seat = 0; seat < n; seat++) {
      if ((s.tick + seat * 3) % 10 !== 0) continue;
      const a = chooseBotAction(s, seat);
      if (a) s = applyAction(s, seat, a);
    }
    s = stepGame(s);
  }
  return s;
}

describe("merge defense engine", () => {
  it("summons a grade 1~2 unit into an empty slot and charges gold", () => {
    const s0 = startGame(2, 42);
    const s1 = applyAction(s0, 0, { type: "summon" });
    const units = s1.boards[0].units.filter(Boolean);
    expect(units).toHaveLength(1);
    expect(units[0]!.grade).toBeLessThanOrEqual(2);
    expect(s1.boards[0].gold).toBe(s0.boards[0].gold - summonCost(s0.boards[0]));
    expect(s0.boards[0].units.filter(Boolean)).toHaveLength(0); // pure
  });

  it("merges only identical kind+grade pairs into one unit a grade higher", () => {
    let s = startGame(2, 7);
    s = { ...s, boards: s.boards.map((b, i) => (i === 0 ? { ...b, units: b.units.map((_, j) => (j < 3 ? { kind: "archer" as const, grade: 1, cd: 0 } : null)) } : b)) };
    s.boards[0].units[2] = { kind: "mage", grade: 1, cd: 0 };
    expect(canMerge(s.boards[0], 0, 2)).toBe(false);
    const merged = applyAction(s, 0, { type: "merge", a: 0, b: 1 });
    expect(merged.boards[0].units[0]).toBeNull();
    expect(merged.boards[0].units[1]!.grade).toBe(2);
    expect(applyAction(s, 0, { type: "merge", a: 0, b: 2 })).toBe(s);
  });

  it("builds on the chosen empty cell and refuses an occupied one", () => {
    const s0 = startGame(2, 3);
    const s1 = applyAction(s0, 0, { type: "summon", slot: 7 });
    expect(s1.boards[0].units[7]).not.toBeNull();
    expect(s1.boards[0].units.filter(Boolean)).toHaveLength(1);
    expect(applyAction(s1, 0, { type: "summon", slot: 7 })).toBe(s1);
  });

  it("moves a unit to an empty cell and swaps with an occupied one", () => {
    const s = startGame(2, 3);
    s.boards[0].units[0] = { kind: "archer", grade: 1, cd: 0 };
    s.boards[0].units[1] = { kind: "mage", grade: 2, cd: 0 };
    const moved = applyAction(s, 0, { type: "move", a: 0, b: 5 });
    expect(moved.boards[0].units[0]).toBeNull();
    expect(moved.boards[0].units[5]!.kind).toBe("archer");
    const swapped = applyAction(s, 0, { type: "move", a: 0, b: 1 });
    expect(swapped.boards[0].units[0]!.kind).toBe("mage");
    expect(swapped.boards[0].units[1]!.kind).toBe("archer");
  });

  it("units only shoot monsters inside their range", () => {
    let s = startGame(2, 9);
    // Centre cell (row 1, col 2) — the top road at the spawn corner is out of reach.
    s.boards[0].units[7] = { kind: "archer", grade: 1, cd: 0 };
    const c = slotCenter(7);
    expect(Math.hypot(c.x - 20, c.y - 20)).toBeGreaterThan(unitRange(s.boards[0].units[7]!));
    while (s.tick < 120 + 3) s = stepGame(s); // wave 1 starts at tick 120
    expect(s.boards[0].mobs.length).toBeGreaterThan(0);
    expect(s.boards[0].shots).toHaveLength(0);
    expect(s.boards[0].mobs.every((m) => m.hp === m.maxHp)).toBe(true);
  });

  it("유닛 대결: sending a unit removes it and drops an invader on the target's road", () => {
    let s = startGame(2, 21, [], "versus");
    while (s.wave < 1) s = stepGame(s);
    s.boards[0].units[3] = { kind: "thunder", grade: 3, cd: 0 };
    const before = s.boards[1].mobs.length;
    const sent = applyAction(s, 0, { type: "send", slot: 3 });
    expect(sent.boards[0].units[3]).toBeNull();
    expect(sent.boards[0].sendCd).toBe(SEND_COOLDOWN_TICKS);
    const inv = sent.boards[1].mobs.find((m) => m.kind === "invader")!;
    expect(sent.boards[1].mobs.length).toBe(before + 1);
    expect(inv.unitKind).toBe("thunder");
    expect(inv.grade).toBe(3);
    // Cooldown blocks a second send; survival mode never allows it.
    sent.boards[0].units[4] = { kind: "mage", grade: 1, cd: 0 };
    expect(applyAction(sent, 0, { type: "send", slot: 4 })).toBe(sent);
    const surv = startGame(2, 21);
    surv.boards[0].units[3] = { kind: "thunder", grade: 3, cd: 0 };
    expect(applyAction({ ...surv, wave: 2 }, 0, { type: "send", slot: 3 }).boards[0].units[3]).not.toBeNull();
  });

  it("유닛 대결: buying monsters charges gold, drops them on the target and shares the send cooldown", () => {
    let s = startGame(2, 22, [], "versus");
    while (s.wave < 1) s = stepGame(s);
    s.boards[0].gold = 1000;
    const before = s.boards[1].mobs.length;
    const swarm = applyAction(s, 0, { type: "hire", mob: "swarm" });
    expect(swarm.boards[0].gold).toBe(1000 - hireCost("swarm", s.wave));
    expect(swarm.boards[0].sendCd).toBe(SEND_COOLDOWN_TICKS);
    expect(swarm.boards[1].mobs.length).toBe(before + SWARM_SIZE);
    expect(swarm.boards[1].mobs.slice(-SWARM_SIZE).every((m) => m.from === 0)).toBe(true);
    // Cooldown blocks the next buy; locked tiers wait for their wave; survival never allows it.
    expect(applyAction(swarm, 0, { type: "hire", mob: "swarm" })).toBe(swarm);
    expect(applyAction(s, 0, { type: "hire", mob: "warlord" })).toBe(s);
    const later = { ...s, wave: 5 };
    const lord = applyAction(later, 0, { type: "hire", mob: "warlord" });
    expect(lord.boards[1].mobs.some((m) => m.kind === "warlord")).toBe(true);
    const surv = startGame(2, 22);
    surv.boards[0].gold = 1000;
    expect(applyAction({ ...surv, wave: 3 }, 0, { type: "hire", mob: "swarm" }).boards[0].gold).toBe(1000);
    // Not enough gold → nothing happens.
    const poor = applyAction({ ...s, boards: s.boards.map((b, i) => (i === 0 ? { ...b, gold: 10 } : b)) }, 0, { type: "hire", mob: "swarm" });
    expect(poor.boards[1].mobs.length).toBe(before);
  });

  it("frost never slows a wraith", () => {
    let s = startGame(2, 23, [], "versus");
    while (s.wave < 2) s = stepGame(s);
    s.boards[0].gold = 1000;
    s.boards[1].mobs = [];
    s.boards[1].units[5] = { kind: "frost", grade: 3, cd: 0 };
    s = applyAction(s, 0, { type: "hire", mob: "wraith" });
    let frostHits = 0;
    for (let i = 0; i < 120; i++) {
      s = stepGame(s);
      s.boards[1].mobs = s.boards[1].mobs.filter((m) => m.kind === "wraith");
      const w = s.boards[1].mobs[0];
      if (!w) break;
      frostHits += s.boards[1].shots.filter((sh) => sh.kind === "frost").length;
      expect(w.slowT).toBe(0);
    }
    expect(frostHits).toBeGreaterThan(0);
  });

  it("elimination counts heads: bosses call minions and golems split", () => {
    let s = startGame(2, 31, [], "versus");
    // Idle boards would be overrun before wave 5 — keep the roads clear.
    while (s.wave < 5) {
      for (const b of s.boards) b.mobs = [];
      s = stepGame(s);
    }
    s.boards[1].units = s.boards[1].units.map(() => null);
    s.boards[1].mobs = [];
    s.boards[0].gold = 5000;
    s = applyAction(s, 0, { type: "hire", mob: "warlord" });
    expect(fieldLoad(s.boards[1])).toBe(1);
    for (let i = 0; i < 20 * 11; i++) s = stepGame(s);
    expect(s.boards[1].mobs.filter((m) => m.kind === "normal" && m.from === 0).length).toBeGreaterThanOrEqual(2);
    expect(fieldLoad(s.boards[1])).toBe(s.boards[1].mobs.length);
    // A golem that dies leaves two pebbles behind.
    s.boards[0].sendCd = 0;
    s.boards[1].mobs = [];
    s = applyAction(s, 0, { type: "hire", mob: "golem" });
    s.boards[1].mobs[0].hp = 0.01;
    s.boards[1].mobs[0].poisonT = 5;
    s.boards[1].mobs[0].poisonDps = 1000;
    s = stepGame(s);
    expect(s.boards[1].mobs.filter((m) => m.kind === "normal").length).toBe(2);
  });

  it("elimination bar drops as seats rise and is announced when a minion is called", () => {
    expect(loadLimit(2)).toBeGreaterThan(loadLimit(3));
    expect(loadLimit(3)).toBeGreaterThan(loadLimit(4));
    // The same crowd that a 2p board survives knocks a 4p board out.
    let s = startGame(4, 41);
    while (s.boards[0].mobs.length === 0) s = stepGame(s);
    const crowd = (n: number) => Array.from({ length: n }, (_, i) => ({ ...s.boards[0].mobs[0], id: 9000 + i }));
    s.boards[0].mobs = crowd(loadLimit(4));
    expect(stepGame(s).boards[0].alive).toBe(false);
    let two = startGame(2, 41);
    while (two.boards[0].mobs.length === 0) two = stepGame(two);
    two.boards[0].mobs = crowd(loadLimit(4));
    expect(stepGame(two).boards[0].alive).toBe(true);
    let t = startGame(2, 42, [], "versus");
    while (t.wave < 5) {
      for (const b of t.boards) b.mobs = [];
      t = stepGame(t);
    }
    let calls = 0;
    for (let i = 0; i < 20 * 9; i++) {
      const before = t.nextEventId;
      t = stepGame(t);
      calls += t.events.filter((e) => e.id >= before && e.type === "call").length;
    }
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("a room-chosen limit overrides the per-seat default; junk falls back", () => {
    expect(eliminationLimit(startGame(2, 1, [], "survival", 35))).toBe(35);
    expect(eliminationLimit(startGame(4, 1))).toBe(loadLimit(4));
    expect(eliminationLimit(startGame(2, 1, [], "survival", 7))).toBe(loadLimit(2));
    let s = startGame(2, 51, [], "survival", 35);
    while (s.boards[0].mobs.length === 0) s = stepGame(s);
    s.boards[0].mobs = Array.from({ length: 35 }, (_, i) => ({ ...s.boards[0].mobs[0], id: 9000 + i }));
    expect(stepGame(s).boards[0].alive).toBe(false);
  });

  it("difficulty scales monster HP; junk difficulty falls back to normal", () => {
    const hpAt = (d: "easy" | "normal" | "hard") => {
      let s = startGame(2, 61, [], "survival", null, d);
      while (s.boards[0].mobs.length === 0) s = stepGame(s);
      return s.boards[0].mobs[0].maxHp;
    };
    expect(hpAt("easy")).toBeLessThan(hpAt("normal"));
    expect(hpAt("hard")).toBeGreaterThan(hpAt("normal"));
    expect(startGame(2, 1, [], "survival", null, "nightmare" as never).difficulty).toBe("normal");
    // Hard also sends a bigger crowd per wave.
    const spawned = (d: "normal" | "hard") => {
      let s = startGame(2, 62, [], "survival", null, d);
      let n = 0;
      while (s.wave < 2) {
        const before = s.nextMobId;
        s = stepGame(s);
        if (s.wave === 1) n += (s.nextMobId - before) / 2;
        for (const b of s.boards) b.mobs = [];
      }
      return n;
    };
    expect(spawned("hard")).toBeGreaterThan(spawned("normal"));
  });

  it("a boss stops calling minions after the cap", () => {
    let s = startGame(2, 71);
    while (s.wave < 10) {
      for (const b of s.boards) b.mobs = b.mobs.filter((m) => m.kind === "boss");
      s = stepGame(s);
    }
    for (let i = 0; i < 20 * 40; i++) {
      for (const b of s.boards) b.mobs = b.mobs.filter((m) => m.kind === "boss" || m.from === -1);
      s = stepGame(s);
      if (s.wave > 10) break;
    }
    const boss = s.boards[0].mobs.find((m) => m.kind === "boss");
    expect(boss?.calls).toBe(MINION_CAP.normal);
    expect(boss?.rage).toBe(true);
  });

  it("wake clears every stun for gold; refused with nothing stunned or too little gold", () => {
    let s = startGame(2, 81);
    while (s.wave < 1) s = stepGame(s);
    s.boards[0].units[0] = { kind: "archer", grade: 2, cd: 0, stun: 30 };
    s.boards[0].units[1] = { kind: "mage", grade: 1, cd: 0, stun: 12 };
    s.boards[0].gold = 100;
    const woke = applyAction(s, 0, { type: "wake" });
    expect(woke.boards[0].units[0]!.stun).toBe(0);
    expect(woke.boards[0].units[1]!.stun).toBe(0);
    expect(woke.boards[0].gold).toBe(100 - wakeCost(s.wave));
    expect(applyAction(woke, 0, { type: "wake" })).toBe(woke);
    s.boards[0].gold = 1;
    expect(applyAction(s, 0, { type: "wake" })).toBe(s);
  });

  it("killing a berserk boss pays a gold bonus and an extra gem", () => {
    let s = startGame(2, 82);
    while (s.wave < 10) {
      for (const b of s.boards) b.mobs = b.mobs.filter((m) => m.kind === "boss");
      s = stepGame(s);
    }
    const boss = s.boards[0].mobs.find((m) => m.kind === "boss")!;
    boss.rage = true;
    boss.hp = 0.01;
    boss.poisonT = 5;
    boss.poisonDps = 1e6;
    s.boards[0].mobs = [boss];
    const gold0 = s.boards[0].gold;
    const gems0 = s.boards[0].gems;
    s = stepGame(s);
    expect(s.boards[0].gems).toBe(gems0 + 3);
    expect(s.boards[0].gold).toBeGreaterThanOrEqual(gold0 + Math.round(killGold("boss", s.wave) * 1.5));
    expect(s.events.some((e) => e.type === "boss-kill" && e.rage)).toBe(true);
    expect(s.boards[0].rageKills).toBe(1);
  });

  it("결속 shortens smash stuns per level and caps at BRACE_MAX", () => {
    expect(stunTicks(1)).toBeLessThan(stunTicks(0));
    expect(stunTicks(BRACE_MAX)).toBeGreaterThan(0);
    let s = startGame(2, 83);
    s.boards[0].gold = 10_000;
    for (let i = 0; i < BRACE_MAX; i++) s = applyAction(s, 0, { type: "brace" });
    expect(s.boards[0].brace).toBe(BRACE_MAX);
    expect(s.boards[0].gold).toBe(10_000 - [0, 1, 2].reduce((t, l) => t + braceCost(l), 0));
    expect(applyAction(s, 0, { type: "brace" })).toBe(s);
  });

  it("critical hits land at roughly CRIT.chance and are flagged on the shot", () => {
    let s = startGame(2, 91);
    for (let i = 0; i < 8; i++) s.boards[0].units[i] = { kind: "archer", grade: 2, cd: 0 };
    let shots = 0;
    let crits = 0;
    for (let i = 0; i < 20 * 120 && s.phase === "playing"; i++) {
      s = stepGame(s);
      for (const sh of s.boards[0].shots) {
        shots++;
        if (sh.crit) crits++;
        expect(sh.target).toBeTypeOf("number");
      }
    }
    expect(shots).toBeGreaterThan(100);
    expect(crits / shots).toBeGreaterThan(CRIT.chance * 0.6);
    expect(crits / shots).toBeLessThan(CRIT.chance * 1.5);
  });

  it("집중 raises crit chance and damage per level, capped at FOCUS_MAX", () => {
    expect(critStats(1).chance).toBeGreaterThan(critStats(0).chance);
    expect(critStats(FOCUS_MAX).mult).toBeGreaterThan(critStats(0).mult);
    expect(critStats(FOCUS_MAX + 3)).toEqual(critStats(FOCUS_MAX));
    let s = startGame(2, 92);
    s.boards[0].gold = 10_000;
    for (let i = 0; i < FOCUS_MAX; i++) s = applyAction(s, 0, { type: "focus" });
    expect(s.boards[0].focus).toBe(FOCUS_MAX);
    expect(s.boards[0].gold).toBe(10_000 - Array.from({ length: FOCUS_MAX }, (_, l) => focusCost(l)).reduce((a, b) => a + b, 0));
    expect(applyAction(s, 0, { type: "focus" })).toBe(s);
  });

  it("crit combos pay their milestone once per wave and record the best chain", () => {
    let s = startGame(2, 93);
    // Skip to tougher waves (mobs live long enough for crits to chain).
    while (s.wave < 15) {
      for (const b of s.boards) b.mobs = [];
      s = stepGame(s);
    }
    for (let i = 0; i < 15; i++) s.boards[0].units[i] = { kind: "archer", grade: 3, cd: 0 };
    s.boards[0].focus = 5;
    const paid: { wave: number; gold: number; gems: number }[] = [];
    let last = 0;
    for (let i = 0; i < 20 * 200 && s.phase === "playing"; i++) {
      for (const b of s.boards) if (b !== s.boards[0]) b.mobs = [];
      s = stepGame(s);
      for (const e of s.events) if (e.id > last && e.type === "combo" && e.seat === 0) paid.push({ wave: s.wave, gold: e.gold, gems: e.gems });
      last = s.nextEventId - 1;
    }
    expect(s.boards[0].bestCombo).toBeGreaterThanOrEqual(COMBO.goldAt);
    expect(paid.length).toBeGreaterThan(0);
    // Never two gold (or two gem) payouts in one wave.
    for (const kind of ["gold", "gems"] as const) {
      const waves = paid.filter((p) => p[kind] > 0).map((p) => p.wave);
      expect(new Set(waves).size).toBe(waves.length);
    }
    for (const p of paid) if (p.gold) expect(p.gold).toBe(comboGold(p.wave));
  });

  it("유닛 대결: a combo milestone stuns the next opponent's strongest towers", () => {
    let s = startGame(2, 94, [], "versus");
    while (s.wave < 15) {
      for (const b of s.boards) b.mobs = [];
      s = stepGame(s);
    }
    for (let i = 0; i < 15; i++) s.boards[0].units[i] = { kind: "archer", grade: 3, cd: 0 };
    s.boards[0].focus = 5;
    s.boards[1].units[3] = { kind: "mage", grade: 5, cd: 0 };
    s.boards[1].units[4] = { kind: "frost", grade: 4, cd: 0 };
    s.boards[1].units[5] = { kind: "poison", grade: 1, cd: 0 };
    let jam: { slots: number[] } | null = null;
    let last = 0;
    for (let i = 0; i < 20 * 120 && !jam; i++) {
      s.boards[1].mobs = [];
      s = stepGame(s);
      for (const e of s.events) if (e.id > last && e.type === "jam" && e.seat === 0) jam = e;
      last = s.nextEventId - 1;
    }
    expect(jam).not.toBeNull();
    expect(jam!.slots.slice(0, 2).sort()).toEqual([3, 4]);
    expect(s.boards[0].jamsSent).toBeGreaterThanOrEqual(1);
    expect(s.boards[1].jamsTaken).toBeGreaterThanOrEqual(1);
    expect(s.boards[0].lateWaves).toBeGreaterThanOrEqual(1);
    expect(s.boards[0].comboBonusWaves).toBeGreaterThanOrEqual(1);
    // Max 결속: later jams bounce off and stun nothing.
    s.boards[1].brace = BRACE_MAX;
    for (const u of s.boards[1].units) if (u) u.stun = 0;
    let blocked = false;
    for (let i = 0; i < 20 * 200 && !blocked; i++) {
      s.boards[1].mobs = [];
      s = stepGame(s);
      for (const e of s.events) if (e.id > last && e.type === "jam" && e.seat === 0) {
        expect(e.blocked).toBe(true);
        expect(e.slots).toEqual([]);
        blocked = true;
      }
      last = s.nextEventId - 1;
    }
    expect(blocked).toBe(true);
    expect(s.boards[1].jamsBlocked).toBeGreaterThanOrEqual(1);
    // Survival never jams.
    expect(startGame(2, 1).mode).toBe("survival");
  });

  it("a dying golem announces its split", () => {
    let s = startGame(2, 52, [], "versus");
    while (s.wave < 3) {
      for (const b of s.boards) b.mobs = [];
      s = stepGame(s);
    }
    s.boards[0].gold = 1000;
    s.boards[1].mobs = [];
    s = applyAction(s, 0, { type: "hire", mob: "golem" });
    s.boards[1].mobs[0].hp = 0.01;
    s.boards[1].mobs[0].poisonT = 5;
    s.boards[1].mobs[0].poisonDps = 1000;
    const before = s.nextEventId;
    s = stepGame(s);
    expect(s.events.some((e) => e.id >= before && e.type === "split" && e.seat === 1)).toBe(true);
  });

  it("refuses to merge max-grade units", () => {
    const s = startGame(2, 1);
    s.boards[0].units[0] = { kind: "poison", grade: MAX_GRADE, cd: 0 };
    s.boards[0].units[1] = { kind: "poison", grade: MAX_GRADE, cd: 0 };
    expect(applyAction(s, 0, { type: "merge", a: 0, b: 1 })).toBe(s);
  });

  it("sanitizes untrusted network actions", () => {
    expect(sanitizeAction({ type: "merge", a: 1, b: 1 })).toBeNull();
    expect(sanitizeAction({ type: "hire", mob: "swarm", to: 1 })).toEqual({ type: "hire", mob: "swarm", to: 1 });
    expect(sanitizeAction({ type: "hire", mob: "dragon" })).toBeNull();
    expect(sanitizeAction({ type: "merge", a: -1, b: 2 })).toBeNull();
    expect(sanitizeAction({ type: "upgrade", kind: "laser" })).toBeNull();
    expect(sanitizeAction({ type: "summon", extra: 1 })).toEqual({ type: "summon" });
    expect(sanitizeAction(null)).toBeNull();
    expect(sanitizeAction({ type: "summon", slot: 99 })).toBeNull();
    expect(sanitizeAction({ type: "summon", slot: 4 })).toEqual({ type: "summon", slot: 4 });
    expect(sanitizeAction({ type: "move", a: 0, b: 0 })).toBeNull();
    expect(sanitizeAction({ type: "send", slot: 2, to: 9 })).toBeNull();
  });

  it("walks the road as a closed loop", () => {
    expect(pathPoint(0)).toEqual(pathPoint(PATH_LEN));
  });

  it("is deterministic for the same seed and inputs", () => {
    const a = runBots(2, 99, 20 * 60 * 3);
    const b = runBots(2, 99, 20 * 60 * 3);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("an idle player is overrun by the early waves", () => {
    let s = startGame(2, 5);
    while (s.phase === "playing" && s.tick < 20 * 60 * 5) {
      if (s.tick % 10 === 0) {
        const a = chooseBotAction(s, 1);
        if (a) s = applyAction(s, 1, a);
      }
      s = stepGame(s);
    }
    expect(s.phase).toBe("gameOver");
    expect(s.boards[0].alive).toBe(false);
    expect(s.boards[0].outWave).toBeLessThan(10);
    expect(computeRankings(s)[0].seat).toBe(1);
  });

  it("bot-vs-bot games end with one winner in a reasonable time", () => {
    for (const [n, seed, mode] of [
      [2, 11, "survival"],
      [3, 12, "survival"],
      [4, 13, "survival"],
      [2, 14, "versus"],
      [4, 15, "versus"],
    ] as const) {
      const s = runBots(n, seed, 20 * 60 * 25, mode);
      expect(s.phase).toBe("gameOver");
      const minutes = (s.tick - PREP_TICKS) / 20 / 60;
      expect(minutes).toBeGreaterThan(4);
      expect(minutes).toBeLessThan(16);
      const ranks = computeRankings(s);
      expect(ranks).toHaveLength(n);
      expect(ranks.filter((r) => r.rank === 1).length).toBeGreaterThanOrEqual(1);
      for (const b of s.boards) if (!b.alive) expect(b.outAt).not.toBeNull();
      for (const b of s.boards) if (b.alive) expect(fieldLoad(b)).toBeLessThan(loadLimit(n));
    }
  });
});
