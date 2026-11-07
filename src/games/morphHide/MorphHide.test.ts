import { describe, expect, it } from "vitest";
import { DOORS, FILLER_SLOTS, FIXED_THINGS, NAV_EDGES, NAV_NODES, STATIC_SOLIDS, thingSolid } from "./map";
import { SolidGrid, groundAt, stepBody, type Body, type CollWorld } from "./physics";
import { DISGUISES, EMOTES, KKOM_CAMP_MS, KKOM_CAMP_R, PICK_SEC, SEEKER_HP, weaponSchedule, weaponTier } from "./data";
import { BASE } from "./map";
import { evalMany } from "./selfplay";
import { hiderParamsFor, seekerParamsFor } from "./botParams";
import { applyAct, applyPos, buildFillers, computeRankings, createHost, createMatch, currentWeapon, dynamicSolids, hostStep, mulberry, wrongPenalty, type HostRuntime } from "./sim";
import { AUG_N, rollAugOffer } from "./augments";

/** 사람 술래는 시간이 끝나면 증강이 랜덤으로 붙는다 — 증강과 상관없는 규칙 테스트에선 뗀다 */
function clearAugs(p: { augs: string[]; maxHp: number; hp: number; shieldLeft: number }) {
  p.augs = [];
  p.maxHp = SEEKER_HP;
  p.hp = SEEKER_HP;
  p.shieldLeft = 0;
}

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
    for (let i = 0; i < 20 * 80 && rt.state.phase !== "hunt"; i++) hostStep(rt, 50);
    const s = rt.state.players[rt.state.seekers[0]];
    clearAugs(s);
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
    for (let i = 0; i < (PICK_SEC + 5) * 20; i++) hostStep(rt, 50);
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
    for (let i = 0; i < 20 * 80 && rt.state.phase !== "hunt"; i++) hostStep(rt, 50);
    expect(rt.state.phase).toBe("hunt");
    const s = rt.state.players[rt.state.seekers[0]];
    clearAugs(s);
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

  describe("꼼꼼이 집 지키기 판정 (손님 위치 지연·게이지)", () => {
    // 사람 2명(술래 1, 숨는 1) — 숨는 사람을 기지 밖에 세워 두고 술래가 바로 앞에서 친다
    function setup() {
      const m = createMatch(11, [{ bot: false, level: 5 }, { bot: false, level: 5 }], { goalMode: true, huntSec: 180, rounds: 1 });
      const rt: HostRuntime = createHost(m);
      for (let i = 0; i < 20 * 60 && rt.state.phase !== "hunt"; i++) hostStep(rt, 50);
      expect(rt.state.phase).toBe("hunt");
      const seeker = rt.state.players.find((p) => p.role === "seeker")!;
      const hider = rt.state.players.find((p) => p.role === "hider")!;
      hider.alive = true;
      // 난수에 따라 작은 동물로 변신하거나 NPC가 끼어들면 판정 대상이 바뀐다 — 고정
      hider.disguise = "person";
      clearAugs(seeker);
      rt.state.npcs = rt.state.npcs.filter((n) => n.kind === "car");
      const pos =(q: typeof seeker, x: number, z: number) => applyPos(rt, q.seat, { x, y: 0, z, yaw: 0, anim: "idle", pose: 0, tp: q.tp });
      return { rt, seeker, hider, pos };
    }
    const outX = BASE.x - KKOM_CAMP_R - 2; // 기지 밖
    function camp(rt: HostRuntime, seeker: { seat: number; tp: number }, ms: number) {
      for (let t = 0; t < ms; t += 50) {
        applyPos(rt, seeker.seat, { x: BASE.x, y: 0, z: BASE.z + 2, yaw: 0, anim: "idle", pose: 0, tp: seeker.tp });
        hostStep(rt, 50);
      }
    }
    function strike(rt: HostRuntime, seeker: { seat: number; nextAtkAt: number }, from: number, hiderZ: number, b?: [number, number]) {
      seeker.nextAtkAt = 0;
      applyAct(rt, seeker.seat, { t: "atk", o: [from, 1.5, BASE.z], d: [0, 0, Math.sign(hiderZ - BASE.z) || 1], ...(b ? { b } : {}) });
    }

    it("기지를 떠나면 (오래 지켰어도) 바로 잡을 수 있다", () => {
      const { rt, seeker, hider, pos } = setup();
      camp(rt, seeker, 15000);
      pos(seeker, outX, BASE.z);
      hostStep(rt, 50);
      pos(hider, outX, BASE.z + 1.2);
      strike(rt, seeker, outX, BASE.z + 1.2);
      expect(hider.alive).toBe(false);
    });

    it("방장이 아직 옛 위치(기지 안)를 갖고 있어도, 공격에 실린 내 위치가 밖이면 잡힌다", () => {
      const { rt, seeker, hider, pos } = setup();
      camp(rt, seeker, KKOM_CAMP_MS + 1000);
      // 위치 보고가 아직 안 와서 방장 쪽 술래는 기지 경계 바로 안 (손님 화면에선 이미 1m 밖)
      pos(seeker, BASE.x - KKOM_CAMP_R + 0.5, BASE.z);
      pos(hider, BASE.x - KKOM_CAMP_R - 1, BASE.z + 1.2);
      strike(rt, seeker, BASE.x - KKOM_CAMP_R - 1, BASE.z + 1.2, [BASE.x - KKOM_CAMP_R - 1, BASE.z]);
      expect(hider.alive).toBe(false);
    });

    it("기지 안에 붙어 있으면 여전히 못 잡고, 공격에 실린 위치를 멀리 속여도 안 통한다", () => {
      const { rt, seeker, hider, pos } = setup();
      camp(rt, seeker, KKOM_CAMP_MS + 1000);
      pos(hider, BASE.x, BASE.z + 3.2);
      strike(rt, seeker, BASE.x, BASE.z + 3.2, [BASE.x - 30, BASE.z]);
      expect(hider.alive).toBe(true);
    });
  });

  it("감정표현 대사엔 음성이 기호 이름으로 읽을 물결표가 없다", () => {
    for (const e of EMOTES) expect(e.line).not.toMatch(/[~～]/);
  });
});

describe("술래 증강", () => {
  /** 사람 2명(술래 1·숨는 1), NPC 없음 — 고르기 단계 */
  function fresh(seed = 21) {
    const m = createMatch(seed, [{ bot: false, level: 5 }, { bot: false, level: 5 }], { huntSec: 180, rounds: 1 });
    const rt: HostRuntime = createHost(m);
    rt.state.npcs = rt.state.npcs.filter((n) => n.kind === "car");
    const seeker = rt.state.players[rt.state.seekers[0]];
    const hider = rt.state.players.find((p) => p.role === "hider")!;
    return { rt, seeker, hider };
  }
  function toHunt(rt: HostRuntime) {
    for (let i = 0; i < 20 * 80 && rt.state.phase !== "hunt"; i++) hostStep(rt, 50);
    expect(rt.state.phase).toBe("hunt");
  }

  it("눈 가린 동안 3장 중 하나씩 두 번 — 안 고르면 랜덤, 같은 걸 두 번 못 고른다", () => {
    const { rt, seeker } = fresh();
    expect(seeker.augOffer).toHaveLength(3);
    expect(new Set(seeker.augOffer).size).toBe(3);
    const first = seeker.augOffer[0];
    applyAct(rt, seeker.seat, { t: "aug", id: first });
    expect(seeker.augs).toEqual([first]);
    // 고르기 단계에선 2번째를 못 고른다
    expect(seeker.augOffer).toHaveLength(0);
    for (let i = 0; i < (PICK_SEC + 1) * 20 && rt.state.phase === "pick"; i++) hostStep(rt, 50);
    expect(rt.state.phase).toBe("hide");
    expect(seeker.augOffer).toHaveLength(3);
    expect(seeker.augOffer).not.toContain(first);
    toHunt(rt);
    expect(seeker.augs).toHaveLength(2);
    expect(new Set(seeker.augs).size).toBe(2);
  });

  it("다시 뽑기는 한 번, 꼼꼼이 전용 증강은 일반 판에 안 나온다", () => {
    const { rt, seeker } = fresh();
    applyAct(rt, seeker.seat, { t: "augReroll" });
    applyAct(rt, seeker.seat, { t: "augReroll" });
    expect(seeker.augRerolls).toBe(0);
    for (let sd = 0; sd < 60; sd++) expect(rollAugOffer(mulberry(sd), sd % 2, false, [])).not.toContain("camp");
    for (let sd = 0; sd < 60; sd++) expect(rollAugOffer(mulberry(sd), sd % 2, true, [])).not.toContain("lastone");
  });

  it("단단한 몸·보호막: 체력이 늘고, 처음 두 번 헛손질은 벌점 0", () => {
    const { rt, seeker } = fresh();
    seeker.augOffer = ["tough"];
    applyAct(rt, seeker.seat, { t: "aug", id: "tough" });
    expect(seeker.maxHp).toBe(SEEKER_HP + AUG_N.toughHp);
    expect(seeker.hp).toBe(seeker.maxHp);
    toHunt(rt);
    seeker.augs = ["tough", "shield"];
    seeker.shieldLeft = AUG_N.shieldHits;
    const w = currentWeapon(rt.state);
    expect(wrongPenalty(rt.state, seeker, w, "npc")).toBe(0);
    seeker.shieldLeft = 0;
    expect(wrongPenalty(rt.state, seeker, w, "npc")).toBe(w.penalty);
    seeker.augs = ["npcpass"];
    expect(wrongPenalty(rt.state, seeker, w, "npc")).toBe(Math.round(w.penalty * AUG_N.npcpass));
    expect(wrongPenalty(rt.state, seeker, w, "prop")).toBe(w.penalty);
  });

  it("급한 술래는 숨는 시간을 5초 줄인다 (숨는 시간에 골라도)", () => {
    const { rt, seeker } = fresh();
    for (let i = 0; i < (PICK_SEC + 1) * 20 && rt.state.phase === "pick"; i++) hostStep(rt, 50);
    const end = rt.state.phaseEnd;
    seeker.augOffer = ["hasty"];
    applyAct(rt, seeker.seat, { t: "aug", id: "hasty" });
    expect(end - rt.state.phaseEnd).toBe(AUG_N.hastyMs);
  });

  it("방울 덫: 숨은 사람이 밟으면 근처 원이 찍히고 그 사람에게 알린다", () => {
    const { rt, seeker, hider } = fresh();
    toHunt(rt);
    seeker.augs = ["trap"];
    seeker.traps = 1;
    seeker.x = 4;
    seeker.z = 30;
    seeker.y = 0;
    applyAct(rt, seeker.seat, { t: "trap" });
    expect(rt.state.traps).toHaveLength(1);
    expect(seeker.traps).toBe(0);
    hider.alive = true;
    applyPos(rt, hider.seat, { x: 4.3, y: 0, z: 30.2, yaw: 0, anim: "walk", pose: 0, tp: hider.tp });
    hostStep(rt, 50);
    expect(rt.state.traps).toHaveLength(0);
    const ping = rt.state.pings.find((g) => g.kind === "trap");
    expect(ping).toBeTruthy();
    expect(Math.hypot(ping!.x - hider.x, ping!.z - hider.z)).toBeLessThanOrEqual(ping!.r);
    expect(rt.state.events.some((e) => e.type === "ping" && e.notify.includes(hider.seat))).toBe(true);
  });

  it("충격파: 6m 안만 드러내고, 횟수를 다 쓰면 끝", () => {
    const { rt, seeker, hider } = fresh();
    toHunt(rt);
    seeker.augs = ["shock"];
    seeker.shocks = 1;
    seeker.x = 4;
    seeker.z = 30;
    seeker.y = 0;
    hider.alive = true;
    applyPos(rt, hider.seat, { x: 4 + AUG_N.shockR + 3, y: 0, z: 30, yaw: 0, anim: "idle", pose: 0, tp: hider.tp });
    applyAct(rt, seeker.seat, { t: "shock" });
    expect(rt.state.pings.filter((g) => g.kind === "shock")).toHaveLength(0);
    seeker.shocks = 1;
    applyPos(rt, hider.seat, { x: 6, y: 0, z: 30, yaw: 0, anim: "idle", pose: 0, tp: hider.tp });
    applyAct(rt, seeker.seat, { t: "shock" });
    expect(rt.state.pings.filter((g) => g.kind === "shock")).toHaveLength(1);
    applyAct(rt, seeker.seat, { t: "shock" });
    expect(rt.state.pings.filter((g) => g.kind === "shock")).toHaveLength(1);
  });

  it("분신 감별: 분신을 치면 사라지고 벌점은 절반", () => {
    const { rt, seeker, hider } = fresh();
    toHunt(rt);
    clearAugs(seeker);
    seeker.augs = ["decoyx"];
    hider.alive = true;
    hider.disguise = "person";
    applyPos(rt, hider.seat, { x: 4, y: 0, z: 30, yaw: 0, anim: "idle", pose: 0, tp: hider.tp });
    applyAct(rt, hider.seat, { t: "decoy" });
    expect(rt.state.decoys).toHaveLength(1);
    const d = rt.state.decoys[0];
    // 분신은 주인이 서 있던 바로 그 자리에 생긴다
    expect(d.x).toBeCloseTo(4);
    expect(d.z).toBeCloseTo(30);
    // 주인은 걸어 나가고(+z 6m), 분신 반대쪽(-z)에서 분신 쪽으로 친다
    hider.z = 36;
    const dx = 0;
    const dz = -1;
    const l = 1;
    seeker.x = d.x + (dx / l) * 1;
    seeker.z = d.z + (dz / l) * 1;
    seeker.y = 0;
    seeker.nextAtkAt = 0;
    applyAct(rt, seeker.seat, { t: "atk", o: [seeker.x, 1.55, seeker.z], d: [-dx / l, -0.25, -dz / l] });
    expect(rt.state.decoys).toHaveLength(0);
    const w = currentWeapon(rt.state);
    expect(SEEKER_HP - seeker.hp).toBe(Math.round(w.penalty * AUG_N.decoyPen));
    expect(hider.alive).toBe(true);
  });

  it("봇 술래끼리 증강을 들고 한 판을 끝까지 (꼼꼼이 포함)", () => {
    for (const goalMode of [false, true]) {
      const m = createMatch(31, Array.from({ length: 6 }, () => ({ bot: true, level: 10 })), { huntSec: 180, rounds: 1, goalMode });
      const rt = createHost(m);
      for (let i = 0; i < 20 * 60 * 6 && rt.state.phase !== "gameOver"; i++) hostStep(rt, 50);
      expect(rt.state.phase).toBe("gameOver");
      for (const sk of rt.state.history[0].seekers) expect(rt.state.players[sk].augs).toHaveLength(2);
    }
  }, 60_000);
});

describe("술래 증강 — 고르기 단계 길이", () => {
  it("숨는 쪽이 다 골라도 사람 술래가 1번째 증강을 고를 때까지 고르기 단계가 이어진다", () => {
    const m = createMatch(5, [{ bot: false, level: 5 }, { bot: true, level: 10 }], { huntSec: 180, rounds: 1 });
    const rt = createHost(m);
    const seeker = rt.state.players[rt.state.seekers[0]];
    expect(seeker.bot).toBe(false);
    for (let i = 0; i < 5 * 20; i++) hostStep(rt, 50);
    expect(rt.state.players.find((p) => p.role === "hider")!.disguise).toBeTruthy();
    expect(rt.state.phase).toBe("pick");
    applyAct(rt, seeker.seat, { t: "aug", id: seeker.augOffer[0] });
    hostStep(rt, 50);
    expect(rt.state.phase).toBe("hide");
  });
});

describe("숨는 쪽 증강", () => {
  function fresh(seed = 41) {
    const m = createMatch(seed, [{ bot: false, level: 5 }, { bot: false, level: 5 }], { huntSec: 180, rounds: 1 });
    const rt: HostRuntime = createHost(m);
    rt.state.npcs = rt.state.npcs.filter((n) => n.kind === "car");
    const seeker = rt.state.players[rt.state.seekers[0]];
    const hider = rt.state.players.find((p) => p.role === "hider")!;
    return { rt, seeker, hider };
  }
  const toHunt = (rt: HostRuntime) => {
    for (let i = 0; i < 20 * 80 && rt.state.phase !== "hunt"; i++) hostStep(rt, 50);
    expect(rt.state.phase).toBe("hunt");
  };

  it("숨는 사람은 숨는 쪽 카드만 3장 받고, 고를 때까지 고르기 단계가 이어진다", () => {
    const { rt, seeker, hider } = fresh();
    expect(hider.augOffer).toHaveLength(3);
    for (const id of hider.augOffer) expect(id.startsWith("h_")).toBe(true);
    for (const id of seeker.augOffer) expect(id.startsWith("h_")).toBe(false);
    applyAct(rt, seeker.seat, { t: "aug", id: seeker.augOffer[0] });
    applyAct(rt, hider.seat, { t: "pick", id: hider.offer[0] });
    hostStep(rt, 50);
    expect(rt.state.phase).toBe("pick");
    applyAct(rt, hider.seat, { t: "aug", id: hider.augOffer[0] });
    expect(hider.augs).toHaveLength(1);
    // 두 번은 못 고른다
    applyAct(rt, hider.seat, { t: "aug", id: "h_swift" });
    expect(hider.augs).toHaveLength(1);
    hostStep(rt, 50);
    expect(rt.state.phase).toBe("hide");
  });

  it("갑옷: 처음 한 대는 막고 술래에게 근처를 알린다, 두 번째엔 잡힌다", () => {
    const { rt, seeker, hider } = fresh();
    toHunt(rt);
    clearAugs(seeker);
    hider.alive = true;
    hider.disguise = "person";
    hider.augs = ["h_armor"];
    hider.shieldLeft = 1;
    applyPos(rt, hider.seat, { x: 4, y: 0, z: 31, yaw: 0, anim: "idle", pose: 0, tp: hider.tp });
    const hit = () => {
      seeker.x = 4;
      seeker.z = 30;
      seeker.y = 0;
      seeker.nextAtkAt = 0;
      applyAct(rt, seeker.seat, { t: "atk", o: [4, 1.55, 30], d: [0, -0.3, 1] });
    };
    hit();
    expect(hider.alive).toBe(true);
    expect(seeker.hp).toBe(SEEKER_HP);
    expect(rt.state.pings.length).toBeGreaterThan(0);
    hit();
    expect(hider.alive).toBe(false);
    expect(hider.caughtBy).toBe(seeker.seat);
  });

  it("재변신: 처음 받은 카드 중 다른 것으로 한 번만", () => {
    const { rt, hider } = fresh();
    toHunt(rt);
    hider.alive = true;
    hider.augs = ["h_remorph"];
    hider.remorphs = 1;
    const other = hider.offer.find((id) => id !== hider.disguise)!;
    applyAct(rt, hider.seat, { t: "remorph", id: "nope" });
    expect(hider.remorphs).toBe(1);
    applyAct(rt, hider.seat, { t: "remorph", id: other });
    expect(hider.disguise).toBe(other);
    const third = hider.offer.find((id) => id !== other)!;
    applyAct(rt, hider.seat, { t: "remorph", id: third });
    expect(hider.disguise).toBe(other);
  });

  it("고양이 발걸음: 방울 덫을 밟아도 안 울린다", () => {
    const { rt, seeker, hider } = fresh();
    toHunt(rt);
    seeker.traps = 1;
    seeker.x = 4;
    seeker.z = 30;
    seeker.y = 0;
    applyAct(rt, seeker.seat, { t: "trap" });
    hider.alive = true;
    hider.augs = ["h_silent"];
    applyPos(rt, hider.seat, { x: 4.2, y: 0, z: 30.1, yaw: 0, anim: "walk", pose: 0, tp: hider.tp });
    hostStep(rt, 50);
    expect(rt.state.traps).toHaveLength(1);
  });

  it("분신술은 분신 +1, 버티기 장인은 끝까지 숨으면 +2점", () => {
    const { rt, seeker, hider } = fresh();
    applyAct(rt, hider.seat, { t: "pick", id: hider.offer[0] });
    hider.augOffer = ["h_decoy"];
    applyAct(rt, hider.seat, { t: "aug", id: "h_decoy" });
    expect(hider.decoys).toBe(3);
    hider.augs.push("h_survive");
    toHunt(rt);
    clearAugs(seeker);
    for (let i = 0; i < 20 * 300 && rt.state.phase === "hunt"; i++) hostStep(rt, 50);
    const sum = rt.state.history[0].hiders.find((h) => h.seat === hider.seat)!;
    if (sum.result === "survived") expect(hider.score).toBe(3 + 2);
  });
});
