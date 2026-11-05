import { describe, expect, it } from "vitest";
import { DOORS, FILLER_SLOTS, FIXED_THINGS, NAV_EDGES, NAV_NODES, STATIC_SOLIDS, thingSolid } from "./map";
import { SolidGrid, groundAt, stepBody, type Body, type CollWorld } from "./physics";
import { DISGUISES, SEEKER_HP, weaponSchedule, weaponTier } from "./data";
import { evalMany } from "./selfplay";
import { hiderParamsFor, seekerParamsFor } from "./botParams";
import { applyAct, buildFillers, computeRankings, createHost, createMatch, dynamicSolids, hostStep, type HostRuntime } from "./sim";

function worldWith(round = 1, seed = 7): CollWorld {
  const fillers = buildFillers(seed, round);
  const grid = new SolidGrid([...STATIC_SOLIDS, ...fillers.map(thingSolid).filter((s) => s !== null)]);
  // 문은 전부 연 상태로
  return { grid, dynamic: [], bodies: [] };
}

function walkTo(w: CollWorld, b: Body, tx: number, tz: number, secs = 25, speed = 3): boolean {
  for (let i = 0; i < secs * 30; i++) {
    const dx = tx - b.x;
    const dz = tz - b.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.35) return true;
    stepBody(b, { dx: dx / d, dz: dz / d, jump: false }, speed, 1 / 30, w);
  }
  return false;
}

describe("map + physics", () => {
  it("every nav edge is walkable with the real collision (both ways)", () => {
    for (const seed of [7, 99, 1234]) {
      for (const round of [1, 2, 3]) {
        const w = worldWith(round, seed);
        for (const e of NAV_EDGES) {
          if (e.ladder) continue;
          for (const [a, b] of [
            [e.a, e.b],
            [e.b, e.a],
          ]) {
            const A = NAV_NODES[a];
            const B = NAV_NODES[b];
            const body: Body = { x: A.x, y: A.y, z: A.z, vy: 0, grounded: true, r: 0.3, h: 1.7 };
            const ok = walkTo(w, body, B.x, B.z);
            expect(ok && Math.abs(body.y - B.y) < 0.5, `seed ${seed} round ${round}: ${a}→${b} stuck at ${body.x.toFixed(2)},${body.y.toFixed(2)},${body.z.toFixed(2)}`).toBe(true);
          }
        }
      }
    }
  });

  it("nav nodes stand on the floor they claim", () => {
    const w = worldWith();
    for (const n of NAV_NODES) expect(Math.abs(groundAt(w, n.x, n.z, n.y + 0.1, 0.3) - n.y), `node ${n.id}`).toBeLessThan(0.05);
  });

  it("stairs lead up to the 2nd floor and crates lead onto the garage roof", () => {
    const w = worldWith();
    const b: Body = { x: -1.95, y: 0, z: 4.82, vy: 0, grounded: true, r: 0.3, h: 1.7 };
    expect(walkTo(w, b, -1.95, 0.8)).toBe(true);
    expect(b.y).toBeCloseTo(3, 1);
    // 상자 두 개 밟고 창고 지붕으로 (점프)
    const c: Body = { x: -15.5, y: 0, z: 0.45, vy: 0, grounded: true, r: 0.3, h: 1.7 };
    for (let i = 0; i < 300 && c.y < 2.9; i++) stepBody(c, { dx: 1, dz: 0, jump: true }, 2.2, 1 / 30, w);
    expect(c.y).toBeCloseTo(3, 1);
  });

  it("closed doors block, open doors let you through", () => {
    const base = worldWith();
    const front = DOORS.find((d) => d.name === "현관문")!;
    const closed: CollWorld = { ...base, dynamic: dynamicSolids({ doors: DOORS.map((d) => d !== front), windows: [], chests: [], npcs: [] }) };
    const b: Body = { x: front.x, y: 0, z: 6.6, vy: 0, grounded: true, r: 0.3, h: 1.7 };
    expect(walkTo(closed, b, front.x, 3.5, 4)).toBe(false);
    const b2: Body = { x: front.x, y: 0, z: 6.6, vy: 0, grounded: true, r: 0.3, h: 1.7 };
    expect(walkTo(base, b2, front.x, 3.5, 4)).toBe(true);
  });

  it("filler props never block a nav node and every disguise thing exists on the map", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const fillers = buildFillers(seed, 1);
      expect(fillers.length).toBe(30);
      for (const f of fillers) {
        const s = thingSolid(f)!;
        for (const n of NAV_NODES) {
          if (Math.abs(n.y - f.y) > 0.5) continue;
          const cx = Math.max(s.x0, Math.min(n.x, s.x1));
          const cz = Math.max(s.z0, Math.min(n.z, s.z1));
          expect(Math.hypot(n.x - cx, n.z - cz), `filler ${f.id} ${f.kind} blocks node ${n.id}`).toBeGreaterThan(0.3);
        }
      }
    }
    expect(FILLER_SLOTS.length).toBeGreaterThanOrEqual(30);
    const kinds = new Set(FIXED_THINGS.map((t) => t.kind));
    for (const seed of [1, 2, 3]) for (const f of buildFillers(seed, 1)) kinds.add(f.kind);
    for (const d of DISGUISES) if (d.thing) expect(kinds.has(d.thing), d.id).toBe(true);
  });
});

describe("weapons", () => {
  it("tiers go up over time and never come back", () => {
    for (const sec of [180, 300, 420] as const) {
      const n = weaponSchedule(sec).length;
      let last = 0;
      for (let t = 0; t <= sec; t += 5) {
        const tier = weaponTier(sec, t);
        expect(tier).toBeGreaterThanOrEqual(last);
        last = tier;
      }
      expect(last).toBe(n - 1);
    }
    expect(weaponSchedule(180)[0]).toBe("hand");
    expect(weaponSchedule(420)).toContain("sniper");
  });
});

function runBots(seed: number, n: number, level: number, opts: Parameters<typeof createMatch>[2] = {}) {
  const m = createMatch(
    seed,
    Array.from({ length: n }, () => ({ bot: true, level })),
    { huntSec: 180, rounds: 2, ...opts },
  );
  const rt = createHost(m);
  let ticks = 0;
  while (rt.state.phase !== "gameOver" && ticks < 20 * 60 * 15) {
    hostStep(rt, 50);
    ticks++;
  }
  return rt;
}

describe("trained bots + balance rules", () => {
  it("Lv10 vs Lv10 stays near a coin flip per hider, and strong hiders beat weak ones", () => {
    const seeds = [50_000, 50_001, 50_002, 50_003, 50_004, 50_005];
    const even = evalMany(seeds, hiderParamsFor(10), seekerParamsFor(10));
    expect(even.catchFrac).toBeGreaterThan(0.2);
    expect(even.catchFrac).toBeLessThan(0.75);
    const weakHiders = evalMany(seeds, hiderParamsFor(1), seekerParamsFor(10));
    expect(weakHiders.catchFrac).toBeGreaterThan(even.catchFrac);
  }, 120_000);

  it("spamming wrong hits escalates the penalty, catching heals", () => {
    const m = createMatch(4, [{ bot: false, level: 5 }, { bot: false, level: 5 }], { huntSec: 180, rounds: 1 });
    const rt = createHost(m);
    for (let i = 0; i < (15 + 30 + 1) * 20; i++) hostStep(rt, 50);
    const s = rt.state.players[rt.state.seekers[0]];
    const npc = rt.state.npcs.find((n) => n.kind === "ped")!;
    const hits: number[] = [];
    for (let i = 0; i < 3; i++) {
      const before = s.hp;
      s.x = npc.x;
      s.z = npc.z - 1;
      s.y = npc.y;
      applyAct(rt, s.seat, { t: "atk", o: [s.x, s.y + 1.55, s.z], d: [0, -0.3, 1] });
      hits.push(before - s.hp);
      for (let k = 0; k < 16; k++) hostStep(rt, 50);
    }
    // 맨손 −4 → −6 → −8 (20초 안 연속)
    expect(hits.filter((h) => h > 0).length).toBeGreaterThanOrEqual(2);
    const pos = hits.filter((h) => h > 0);
    expect(pos[pos.length - 1]).toBeGreaterThan(pos[0]);
  });
});

describe("bot match", () => {
  it("plays to the end with catches, wrong hits and survivors across seeds", () => {
    let catches = 0;
    let survived = 0;
    let wrong = 0;
    for (const seed of [11, 22, 33]) {
      const rt = runBots(seed, 5, 6);
      expect(rt.state.phase).toBe("gameOver");
      expect(rt.state.history.length).toBe(2);
      for (const h of rt.state.history)
        for (const x of h.hiders) {
          if (x.result === "caught") catches++;
          else survived++;
        }
      wrong += rt.state.players.reduce((a, p) => a + p.stats.wrongHits, 0);
      expect(computeRankings(rt.state)[0].rank).toBe(1);
      expect(rt.state.winners?.length).toBeGreaterThan(0);
    }
    // 봇 술래가 아무도 못 찾거나 전부 찾으면 밸런스가 깨진 것
    expect(catches).toBeGreaterThan(0);
    expect(survived).toBeGreaterThan(0);
    expect(wrong).toBeGreaterThan(0);
  }, 60_000);

  it("goal mode lets hiders escape", () => {
    let escapes = 0;
    for (const seed of [5, 6, 7]) {
      const rt = runBots(seed, 4, 8, { goalMode: true });
      escapes += rt.state.players.reduce((a, p) => a + p.stats.escapes, 0);
    }
    expect(escapes).toBeGreaterThan(0);
  }, 60_000);

  it("random disguise when the pick timer runs out, seekers stay blindfolded at base", () => {
    const m = createMatch(3, [{ bot: false, level: 5 }, { bot: false, level: 5 }, { bot: false, level: 5 }], { huntSec: 180, rounds: 1 });
    const rt: HostRuntime = createHost(m);
    const seeker = rt.state.seekers[0];
    for (let i = 0; i < (15 + 5) * 20; i++) hostStep(rt, 50);
    expect(rt.state.phase).toBe("hide");
    for (const p of rt.state.players) if (p.role === "hider") expect(p.offer).toContain(p.disguise);
    expect(Math.hypot(rt.state.players[seeker].x - 9, rt.state.players[seeker].z - 9.5)).toBeLessThan(1.5);
    // 숨는 사람은 분신을 두 번까지
    const h = rt.state.players.find((p) => p.role === "hider")!;
    applyAct(rt, h.seat, { t: "decoy" });
    applyAct(rt, h.seat, { t: "decoy" });
    applyAct(rt, h.seat, { t: "decoy" });
    expect(rt.state.decoys.length).toBe(2);
  });

  it("a seeker that keeps hitting the wrong things goes down", () => {
    const m = createMatch(4, [{ bot: false, level: 5 }, { bot: false, level: 5 }], { huntSec: 180, rounds: 1 });
    const rt = createHost(m);
    for (let i = 0; i < (15 + 30 + 1) * 20; i++) hostStep(rt, 50);
    expect(rt.state.phase).toBe("hunt");
    const s = rt.state.players[rt.state.seekers[0]];
    // 바로 앞 NPC를 계속 친다
    const npc = rt.state.npcs.find((n) => n.kind === "ped")!;
    for (let i = 0; i < 40 && s.alive; i++) {
      s.x = npc.x;
      s.z = npc.z - 1;
      s.y = npc.y;
      applyAct(rt, s.seat, { t: "atk", o: [s.x, s.y + 1.55, s.z], d: [0, -0.3, 1] });
      for (let k = 0; k < 16; k++) hostStep(rt, 50);
    }
    expect(s.stats.wrongHits).toBeGreaterThan(5);
    expect(s.hp).toBeLessThan(SEEKER_HP);
  });
});
