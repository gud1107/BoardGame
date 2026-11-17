import { describe, expect, it } from "vitest";
import { botThink } from "./bot";
import { BASH_MS, EXPOSE_MS, FREEZE_MS, GATE_OPEN_MS, GAUGE_MIN_ON, GRACE_MS, KICK_LOSS, KICK_MS, MASK_OFF_MS, MASK_ON_MS, MAX_FREEZES, SALT_MAX, SALT_START, SPEED_WALK, STUN_KID_MS, STUN_MASK_MS, SWING_MS, THAW_MS, TICK_MS, maskSecFor, sanitizeOptions, sealMsFor, sealsFor, timeLimitMs, winnerOf } from "./data";
import { createLocal, findTarget, reportOf, startLunge, stepLocal, syncLocal } from "./localBody";
import { BLOCKED, DOORS, EXITS, SPAWN_CELLS, SPOTS, WALKABLE, accessCells, centerOf, clearLine, collide, nextCell, walkCellAt, walkField } from "./map";
import { SnapBuffer, isSnap, makeSnap, stateFromSnap } from "./net";
import { applyAct, applyReport, createHost, createMatch, hostStep, noiseRadiusOf, runnersOf, setAway, taggerHears, taggerOf, yawTo, type HostRuntime, type PlayerState, type PosReport } from "./sim";
import { taggerAmongUsStatDetails } from "./stats";

/** 사람만 앉은 판 (봇이 제멋대로 움직이지 않는다). 0번이 술래. */
function room(seats = 4, seed = 11): HostRuntime {
  const s = createMatch(seed, Array.from({ length: seats }, () => ({ bot: false, level: 5 })), undefined, 0);
  return createHost(s, botThink);
}

const run = (rt: HostRuntime, ms: number, each?: () => void) => {
  for (let t = 0; t < ms; t += TICK_MS) {
    each?.();
    hostStep(rt, TICK_MS);
  }
};

const rep = (p: PlayerState, patch: Partial<PosReport> = {}): PosReport => ({ x: p.x, z: p.z, yaw: p.yaw, pitch: 0, mv: 0, cr: false, light: true, use: null, ...patch });

/** 사람을 칸 한가운데로 옮긴다 */
function put(p: PlayerState, cell: number) {
  const c = centerOf(cell);
  p.x = c.x;
  p.z = c.z;
}

/** 깨어난 장승 k 앞에 세운다 */
function atSpot(rt: HostRuntime, p: PlayerState, k: number) {
  const def = SPOTS[rt.state.spots[k].i];
  put(p, accessCells(def.cell)[0]);
  p.yaw = yawTo(p.x, p.z, def.x, def.z);
}

/** 술래에게 가면을 씌운다 (유예 시간을 건너뛴다) */
function mask(rt: HostRuntime) {
  rt.state.t = Math.max(rt.state.t, GRACE_MS + 100);
  applyAct(rt, rt.state.tg.seat, { k: "mask", on: true });
  run(rt, MASK_ON_MS + 100);
}

/** 술래를 q 바로 앞(북쪽 0.9m)에 세우고 덮친다 */
function catchRunner(rt: HostRuntime, q: PlayerState) {
  const t = taggerOf(rt.state);
  rt.state.tg.recoverUntil = 0;
  t.x = q.x;
  t.z = q.z - 0.9;
  t.yaw = yawTo(t.x, t.z, q.x, q.z);
  applyAct(rt, t.seat, { k: "hit" });
  run(rt, SWING_MS);
}

describe("학교 지도", () => {
  it("모든 바닥 칸이 서로 걸어서 닿는다", () => {
    const f = walkField(SPAWN_CELLS[0]);
    for (const c of WALKABLE) expect(Number.isFinite(f[c]), `cell ${c}`).toBe(true);
  });

  it("장승 12개는 모두 옆 칸에서 손이 닿고, 교문 2곳은 걸어서 닿는다", () => {
    expect(SPOTS.length).toBe(12);
    for (const d of SPOTS) {
      expect(BLOCKED[d.cell]).toBe(1);
      expect(accessCells(d.cell).length, `spot ${d.i}`).toBeGreaterThan(0);
    }
    expect(EXITS.length).toBe(2);
    const f = walkField(SPAWN_CELLS[0]);
    for (const e of EXITS) expect(Number.isFinite(f[walkCellAt(e.x, e.z)])).toBe(true);
  });

  it("시작 자리는 서로 다른 걸을 수 있는 칸", () => {
    expect(new Set(SPAWN_CELLS).size).toBe(SPAWN_CELLS.length);
    for (const c of SPAWN_CELLS) expect(BLOCKED[c]).toBe(0);
  });

  it("길찾기는 목표까지 줄어들고, 닫힌 문은 몸과 시선을 막는다", () => {
    const a = SPAWN_CELLS[0];
    const b = SPAWN_CELLS[3];
    let here = a;
    for (let i = 0; i < 200 && here !== b; i++) here = nextCell(here, b);
    expect(here).toBe(b);
    const d = DOORS[0];
    const closed = DOORS.map(() => false);
    const open = DOORS.map(() => true);
    const off = d.ns ? { x: 0, z: 1.2 } : { x: 1.2, z: 0 };
    expect(clearLine(d.x - off.x, d.z - off.z, d.x + off.x, d.z + off.z, open)).toBe(true);
    expect(clearLine(d.x - off.x, d.z - off.z, d.x + off.x, d.z + off.z, closed)).toBe(false);
    const p = { x: d.x, z: d.z };
    collide(p, closed);
    expect(Math.hypot(p.x - d.x, p.z - d.z)).toBeGreaterThan(0.2);
  });
});

describe("판 만들기", () => {
  it("술래는 한 명, 봉인 수와 장승 수는 인원에 맞는다", () => {
    for (const n of [3, 4, 5]) {
      const s = createMatch(100 + n, Array.from({ length: n }, () => ({ bot: false, level: 5 })));
      expect(s.players.filter((p) => p.role === "tagger").length).toBe(1);
      expect(runnersOf(s).length).toBe(n - 1);
      expect(s.need).toBe(sealsFor(n - 1));
      expect(s.spots.length).toBe(s.need + 2);
      expect(new Set(s.spots.map((sp) => sp.i)).size).toBe(s.spots.length);
      expect(taggerOf(s).salt).toBe(0);
      for (const p of runnersOf(s)) expect(p.salt).toBe(SALT_START);
    }
    expect([sealsFor(2), sealsFor(3), sealsFor(4)]).toEqual([2, 4, 5]);
  });

  it("술래 정하기: 지정 · AI · 무작위", () => {
    const seats = [{ bot: false, level: 5 }, { bot: true, level: 5 }, { bot: false, level: 5 }, { bot: true, level: 5 }];
    expect(createMatch(1, seats, undefined, 2).tg.seat).toBe(2);
    for (let i = 0; i < 20; i++) expect([1, 3]).toContain(createMatch(50 + i, seats, { pick: "bot" }).tg.seat);
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) seen.add(createMatch(900 + i * 31, seats).tg.seat);
    expect(seen.size).toBe(4);
  });

  it("옵션은 이상한 값을 기본값으로 돌린다", () => {
    expect(sanitizeOptions({ pick: "x" as never, minutes: 99 as never })).toEqual({ pick: "random", minutes: 9 });
    expect(sanitizeOptions({ pick: "host", minutes: 12 })).toEqual({ pick: "host", minutes: 12 });
    expect(sanitizeOptions(null)).toEqual({ pick: "random", minutes: 9 });
  });

  it("승패: 절반을 넘으면 도망자, 딱 절반은 무승부", () => {
    expect(winnerOf(2, 3)).toBe("runners");
    expect(winnerOf(1, 3)).toBe("tagger");
    expect(winnerOf(1, 2)).toBe("draw");
    expect(winnerOf(2, 4)).toBe("draw");
    expect(winnerOf(0, 2)).toBe("tagger");
    expect(winnerOf(3, 4)).toBe("runners");
  });
});

describe("봉인", () => {
  it("혼자 봉인하면 정해진 시간에 끝나고 소금을 얻는다", () => {
    const rt = room(4);
    const s = rt.state;
    const p = s.players[1];
    atSpot(rt, p, 0);
    run(rt, sealMsFor(3) - 500, () => applyReport(rt, 1, rep(p, { use: "s0" })));
    expect(s.spots[0].done).toBe(false);
    expect(s.spots[0].p).toBeGreaterThan(0.9);
    run(rt, 800, () => applyReport(rt, 1, rep(p, { use: "s0" })));
    expect(s.spots[0].done).toBe(true);
    expect(s.sealed).toBe(1);
    expect(p.salt).toBe(Math.min(SALT_MAX, SALT_START + 1));
    expect(p.stats.seals).toBe(1);
    expect(s.events.some((e) => e.k === "sealDone")).toBe(true);
  });

  it("둘이 하면 더 빠르고, 변장한 술래는 시늉만 한다", () => {
    const solo = room(4);
    const duo = room(4);
    const fake = room(4);
    for (const rt of [solo, duo, fake]) {
      atSpot(rt, rt.state.players[1], 0);
      atSpot(rt, rt.state.players[2], 0);
      atSpot(rt, rt.state.players[0], 0);
    }
    run(solo, 5000, () => applyReport(solo, 1, rep(solo.state.players[1], { use: "s0" })));
    run(duo, 5000, () => {
      applyReport(duo, 1, rep(duo.state.players[1], { use: "s0" }));
      applyReport(duo, 2, rep(duo.state.players[2], { use: "s0" }));
    });
    run(fake, 5000, () => applyReport(fake, 0, rep(fake.state.players[0], { use: "s0" })));
    expect(duo.state.spots[0].p).toBeGreaterThan(solo.state.spots[0].p * 1.6);
    expect(fake.state.spots[0].p).toBe(0);
  });

  it("멀리서는 봉인이 안 된다", () => {
    const rt = room(4);
    const p = rt.state.players[1];
    put(p, SPAWN_CELLS[0]);
    const far = rt.state.spots.findIndex((sp) => Math.hypot(SPOTS[sp.i].x - p.x, SPOTS[sp.i].z - p.z) > 8);
    run(rt, 3000, () => applyReport(rt, 1, rep(p, { use: `s${far}` })));
    expect(rt.state.spots[far].p).toBe(0);
  });

  it("마지막 봉인 뒤 빗장이 풀리고, 교문에 닿으면 탈출 — 절반을 넘으면 도망자 승", () => {
    const rt = room(4);
    const s = rt.state;
    for (let k = 0; k < s.need; k++) {
      s.spots[k].p = 1;
      s.spots[k].done = true;
    }
    s.sealed = s.need - 1;
    s.spots[s.need - 1].done = false;
    s.spots[s.need - 1].p = 0.99;
    const p = s.players[1];
    atSpot(rt, p, s.need - 1);
    run(rt, 1500, () => applyReport(rt, 1, rep(p, { use: `s${s.need - 1}` })));
    expect(s.gate).toBe("opening");
    // 아직 안 열렸으니 교문 앞에 서도 못 나간다
    p.x = EXITS[0].x;
    p.z = EXITS[0].z;
    run(rt, 500);
    expect(p.st).toBe("alive");
    run(rt, GATE_OPEN_MS);
    expect(s.gate).toBe("open");
    expect(p.st).toBe("escaped");
    const q = s.players[2];
    q.x = EXITS[1].x;
    q.z = EXITS[1].z;
    run(rt, 200);
    expect(q.st).toBe("escaped");
    // 술래는 교문으로 못 나간다
    const t = taggerOf(s);
    t.x = EXITS[0].x;
    t.z = EXITS[0].z;
    run(rt, 200);
    expect(t.st).toBe("alive");
    // 마지막 도망자가 얼면 끝: 3명 중 2명 탈출 → 도망자 승
    mask(rt);
    catchRunner(rt, s.players[3]);
    run(rt, 200);
    expect(s.phase).toBe("gameOver");
    expect(s.outcome?.winner).toBe("runners");
    expect(s.ranks).toEqual([2, 1, 1, 2]);
  });
});

describe("술래", () => {
  it("유예 시간 동안은 탈을 못 쓰고, 쓰고 벗는 동안은 못 움직인다", () => {
    const rt = room(4);
    const s = rt.state;
    applyAct(rt, 0, { k: "mask", on: true });
    expect(s.tg.form).toBe("kid");
    s.t = GRACE_MS + 50;
    applyAct(rt, 0, { k: "mask", on: true });
    expect(s.tg.form).toBe("on");
    const t = taggerOf(s);
    const x0 = t.x;
    applyReport(rt, 0, rep(t, { x: t.x + 1, mv: 2 }));
    expect(t.x).toBe(x0);
    run(rt, MASK_ON_MS + 100);
    expect(s.tg.form).toBe("mask");
    expect(t.light).toBe(false);
    applyAct(rt, 0, { k: "mask", on: false });
    expect(s.tg.form).toBe("off");
    run(rt, MASK_OFF_MS + 100);
    expect(s.tg.form).toBe("kid");
    // 도망자는 탈을 못 쓴다
    applyAct(rt, 1, { k: "mask", on: true });
    expect(s.tg.form).toBe("kid");
  });

  it("탈 기운이 다하면 저절로 벗겨지고, 모자라면 다시 못 쓴다", () => {
    const rt = room(4);
    const s = rt.state;
    mask(rt);
    run(rt, maskSecFor(3) * 1000 + MASK_OFF_MS + 500);
    expect(s.tg.form).toBe("kid");
    expect(s.tg.gauge).toBeLessThan(GAUGE_MIN_ON);
    applyAct(rt, 0, { k: "mask", on: true });
    expect(s.tg.form).toBe("kid");
    run(rt, 30_000);
    expect(s.tg.gauge).toBe(100);
  });

  it("덮치면 앞에 있는 도망자가 얼고, 벽 너머·등 뒤는 안 맞는다", () => {
    const rt = room(4);
    const s = rt.state;
    const q = s.players[1];
    put(q, SPAWN_CELLS[0]);
    mask(rt);
    catchRunner(rt, q);
    expect(q.st).toBe("frozen");
    expect(q.freezes).toBe(1);
    expect(q.melt).toBe(FREEZE_MS[0]);
    expect(taggerOf(s).stats.catches).toBe(1);
    expect(s.t).toBeLessThan(s.tg.recoverUntil);
    // 숨 고르는 동안은 다시 못 덮친다
    const sw = s.tg.swingUntil;
    applyAct(rt, 0, { k: "hit" });
    expect(s.tg.swingUntil).toBe(sw);
    // 등 뒤
    const r = s.players[2];
    put(r, SPAWN_CELLS[1]);
    const t = taggerOf(s);
    s.tg.recoverUntil = 0;
    t.x = r.x;
    t.z = r.z - 0.9;
    t.yaw = yawTo(t.x, t.z, r.x, r.z) + Math.PI;
    applyAct(rt, 0, { k: "hit" });
    run(rt, SWING_MS);
    expect(r.st).toBe("alive");
    // 변장 중에는 못 덮친다
    const rt2 = room(4);
    applyAct(rt2, 0, { k: "hit" });
    expect(rt2.state.tg.swingUntil).toBe(0);
  });

  it("탈 쓴 술래는 닫힌 문을 부수고, 진행 중인 봉인을 걷어찬다", () => {
    const rt = room(4);
    const s = rt.state;
    mask(rt);
    const t = taggerOf(s);
    const d = DOORS.find((x) => !x.gym) ?? DOORS[0];
    s.doors[d.i] = false;
    t.x = d.x + (d.ns ? 0 : 1.2);
    t.z = d.z + (d.ns ? 1.2 : 0);
    applyAct(rt, 0, { k: "door", i: d.i });
    expect(s.doors[d.i]).toBe(false);
    expect(s.tg.bash).toBe(d.i);
    run(rt, BASH_MS + 100);
    expect(s.doors[d.i]).toBe(true);
    // 열린 문은 못 닫는다
    applyAct(rt, 0, { k: "door", i: d.i });
    expect(s.doors[d.i]).toBe(true);
    // 걷어차기
    s.spots[0].p = 0.6;
    atSpot(rt, t, 0);
    run(rt, KICK_MS + 200, () => applyReport(rt, 0, rep(t, { use: "k0" })));
    expect(s.spots[0].p).toBeCloseTo(0.6 - KICK_LOSS, 5);
    expect(t.stats.kicks).toBe(1);
  });

  it("소리: 달리면 멀리서도 들리고, 앉아 걸으면 안 들린다. 변장 중에는 귀가 어둡다", () => {
    const rt = room(4);
    const s = rt.state;
    const t = taggerOf(s);
    const q = s.players[1];
    put(t, SPAWN_CELLS[0]);
    q.x = t.x + 10;
    q.z = t.z;
    q.mv = 3;
    expect(noiseRadiusOf(q)).toBeGreaterThan(10);
    expect(taggerHears(s, q)).toBe(false);
    s.tg.form = "mask";
    expect(taggerHears(s, q)).toBe(true);
    q.mv = 1;
    expect(noiseRadiusOf(q)).toBe(0);
    expect(taggerHears(s, q)).toBe(false);
  });
});

describe("얼음땡", () => {
  it("친구가 땡! 하면 풀리고 잠깐 무적", () => {
    const rt = room(4);
    const s = rt.state;
    const q = s.players[1];
    const f = s.players[2];
    put(q, SPAWN_CELLS[0]);
    mask(rt);
    catchRunner(rt, q);
    expect(q.st).toBe("frozen");
    // 술래는 멀리 보낸다
    put(taggerOf(s), SPAWN_CELLS[3]);
    f.x = q.x + 1;
    f.z = q.z;
    run(rt, THAW_MS + 200, () => applyReport(rt, 2, rep(f, { use: "t1" })));
    expect(q.st).toBe("alive");
    expect(f.stats.thaws).toBe(1);
    expect(s.t).toBeLessThan(q.safeUntil);
    // 무적 동안은 다시 안 언다
    catchRunner(rt, q);
    expect(q.st).toBe("alive");
  });

  it("못 녹으면 끌려가고, 술래가 지키고 있으면 시계가 멈춘다", () => {
    const rt = room(4);
    const s = rt.state;
    const q = s.players[1];
    put(q, SPAWN_CELLS[0]);
    put(s.players[2], SPAWN_CELLS[1]);
    put(s.players[3], SPAWN_CELLS[2]);
    mask(rt);
    catchRunner(rt, q);
    const melt0 = q.melt;
    // 술래가 곁에 서 있는 동안 (탈 기운이 다하기 전)
    run(rt, 3000);
    expect(q.melt).toBe(melt0);
    put(taggerOf(s), SPAWN_CELLS[3]);
    run(rt, FREEZE_MS[0] + 500);
    expect(q.st).toBe("out");
    expect(taggerOf(s).stats.outs).toBe(1);
  });

  it("세 번째로 붙잡히면 바로 끌려간다", () => {
    const rt = room(4);
    const s = rt.state;
    const q = s.players[1];
    put(q, SPAWN_CELLS[0]);
    put(s.players[2], SPAWN_CELLS[1]);
    q.freezes = MAX_FREEZES - 1;
    mask(rt);
    catchRunner(rt, q);
    expect(q.st).toBe("out");
    expect(s.phase).toBe("play");
  });

  it("움직일 수 있는 도망자가 없으면 술래 승", () => {
    const rt = room(3);
    const s = rt.state;
    put(s.players[1], SPAWN_CELLS[0]);
    put(s.players[2], SPAWN_CELLS[1]);
    mask(rt);
    catchRunner(rt, s.players[1]);
    catchRunner(rt, s.players[2]);
    run(rt, 200);
    expect(s.phase).toBe("gameOver");
    expect(s.outcome?.winner).toBe("tagger");
    expect(s.outcome?.why).toBe("allCaught");
    expect(s.ranks).toEqual([1, 2, 2]);
  });
});

describe("소금", () => {
  it("탈 쓴 술래가 맞으면 멈추고, 변장 중이면 정체가 드러난다", () => {
    const rt = room(4);
    const s = rt.state;
    const p = s.players[1];
    const t = taggerOf(s);
    put(p, SPAWN_CELLS[0]);
    t.x = p.x + 1.5;
    t.z = p.z;
    applyAct(rt, 1, { k: "salt", yaw: yawTo(p.x, p.z, t.x, t.z) });
    expect(p.salt).toBe(SALT_START - 1);
    expect(s.tg.stunUntil).toBe(s.t + STUN_KID_MS);
    expect(s.tg.exposedUntil).toBe(s.t + EXPOSE_MS);
    expect(p.stats.unmasks).toBe(1);
    // 기절 중에는 탈을 못 쓴다
    s.t = GRACE_MS + 100;
    s.tg.stunUntil = s.t + 1000;
    applyAct(rt, 0, { k: "mask", on: true });
    expect(s.tg.form).toBe("kid");
    // 탈 쓴 채로 맞으면
    s.tg.stunUntil = 0;
    mask(rt);
    p.salt = 1;
    t.x = p.x + 1.5;
    t.z = p.z;
    const exposed = s.tg.exposedUntil;
    applyAct(rt, 1, { k: "salt", yaw: yawTo(p.x, p.z, t.x, t.z) });
    expect(s.tg.stunUntil).toBe(s.t + STUN_MASK_MS);
    expect(s.tg.form).toBe("mask");
    expect(s.tg.exposedUntil).toBe(exposed);
    // 기절한 술래는 덮치지 못한다
    applyAct(rt, 0, { k: "hit" });
    expect(s.tg.swingUntil).toBe(0);
  });

  it("친구가 맞으면 느려지고, 빗나가거나 소금이 없으면 아무 일도 없다", () => {
    const rt = room(4);
    const s = rt.state;
    const p = s.players[1];
    const f = s.players[2];
    put(p, SPAWN_CELLS[0]);
    put(taggerOf(s), SPAWN_CELLS[3]);
    put(s.players[3], SPAWN_CELLS[2]);
    f.x = p.x + 1.5;
    f.z = p.z;
    applyAct(rt, 1, { k: "salt", yaw: yawTo(p.x, p.z, f.x, f.z) });
    expect(f.slowUntil).toBeGreaterThan(s.t);
    expect(p.stats.friendly).toBe(1);
    expect(p.salt).toBe(0);
    applyAct(rt, 1, { k: "salt", yaw: 0 });
    expect(p.stats.salts).toBe(1);
    // 술래는 소금을 못 뿌린다
    taggerOf(s).salt = 1;
    applyAct(rt, 0, { k: "salt", yaw: 0 });
    expect(taggerOf(s).stats.salts).toBe(0);
  });
});

describe("끝 · 기록", () => {
  it("첫닭이 울면 남은 도망자는 끌려간다", () => {
    const rt = room(4);
    const s = rt.state;
    s.t = timeLimitMs(s.options) - 200;
    run(rt, 400);
    expect(s.phase).toBe("gameOver");
    expect(s.outcome?.why).toBe("time");
    expect(s.outcome?.winner).toBe("tagger");
    expect(runnersOf(s).every((p) => p.st === "out")).toBe(true);
    const tagger = taggerAmongUsStatDetails(s, 0);
    expect(tagger).toMatchObject({ taggerGames: 1, taggerWins: 1, sweeps: 1 });
    const runner = taggerAmongUsStatDetails(s, 1);
    expect(runner).toMatchObject({ runnerGames: 1, escapes: 0 });
    expect(runner.minEscapeSec).toBeUndefined();
  });

  it("봇끼리 한 판이 끝까지 간다 (3·4·5인)", () => {
    for (const n of [3, 4, 5]) {
      const s = createMatch(4242 + n, Array.from({ length: n }, () => ({ bot: true, level: 6 })));
      const rt = createHost(s, botThink);
      const max = timeLimitMs(s.options) / TICK_MS + 10;
      for (let i = 0; i < max && s.phase === "play"; i++) hostStep(rt, TICK_MS);
      expect(s.phase).toBe("gameOver");
      expect(s.ranks?.length).toBe(n);
      for (const p of s.players) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
        expect(BLOCKED[walkCellAt(p.x, p.z)]).toBe(0);
      }
    }
  });

  it("나간 사람 자리는 AI가 대신 움직이고, 돌아오면 다시 사람이 움직인다", () => {
    const rt = room(4);
    const s = rt.state;
    const p = s.players[1];
    const x0 = p.x;
    const z0 = p.z;
    run(rt, 3000);
    expect(p.x).toBe(x0);
    setAway(rt, 1, true);
    run(rt, 4000);
    expect(Math.hypot(p.x - x0, p.z - z0)).toBeGreaterThan(1);
    setAway(rt, 1, false);
    const x1 = p.x;
    run(rt, 1000);
    expect(p.x).toBe(x1);
  });
});

describe("내 몸 · 스냅샷", () => {
  it("입력대로 걷고, 얼면 멈춘다", () => {
    const rt = room(4);
    const snap = makeSnap(rt.state, 1);
    const b = createLocal();
    syncLocal(b, snap, 1);
    expect(b.x).toBe(snap.players[1].x);
    b.mz = 1;
    const x0 = b.x;
    const z0 = b.z;
    for (let i = 0; i < 20; i++) stepLocal(b, snap, 1, 0.05, i * 50);
    const moved = Math.hypot(b.x - x0, b.z - z0);
    expect(moved).toBeGreaterThan(0.3);
    expect(moved).toBeLessThanOrEqual(SPEED_WALK + 0.01);
    expect(reportOf(b).mv).toBe(2);
    rt.state.players[1].st = "frozen";
    const frozen = makeSnap(rt.state, 2);
    stepLocal(b, frozen, 1, 0.05, 2000);
    expect(b.mv).toBe(0);
    expect(b.x).toBe(frozen.players[1].x);
  });

  it("바라보는 대상: 도망자는 봉인·땡, 탈 쓴 술래는 걷어차기, 덮치는 동안 앞으로 돌진", () => {
    const rt = room(4);
    const s = rt.state;
    atSpot(rt, s.players[1], 0);
    atSpot(rt, s.players[0], 0);
    let snap = makeSnap(s, 1);
    const b = createLocal();
    syncLocal(b, snap, 1);
    expect(findTarget(b, snap, 1)).toMatchObject({ kind: "seal", id: "s0", hold: true });
    // 변장한 술래도 봉인(시늉) 대상이 잡힌다
    const tb = createLocal();
    syncLocal(tb, snap, 0);
    expect(findTarget(tb, snap, 0)?.kind).toBe("seal");
    // 얼어붙은 친구가 곁에 있으면 땡이 먼저
    s.players[2].st = "frozen";
    s.players[2].x = s.players[1].x;
    s.players[2].z = s.players[1].z + 0.8;
    snap = makeSnap(s, 2);
    b.yaw = yawTo(b.x, b.z, s.players[2].x, s.players[2].z);
    expect(findTarget(b, snap, 1)).toMatchObject({ kind: "thaw", id: "t2" });
    // 탈: 진행 중인 장승만 걷어찰 수 있다
    s.tg.form = "mask";
    snap = makeSnap(s, 3);
    expect(findTarget(tb, snap, 0)?.kind).not.toBe("seal");
    s.spots[0].p = 0.4;
    snap = makeSnap(s, 4);
    expect(findTarget(tb, snap, 0)).toMatchObject({ kind: "kick", id: "k0" });
    // 돌진
    put(s.players[0], SPAWN_CELLS[4]);
    snap = { ...makeSnap(s, 5), seed: 999 };
    syncLocal(tb, snap, 0);
    tb.yaw = 0;
    const z0 = tb.z;
    startLunge(tb, 1000);
    stepLocal(tb, snap, 0, 0.05, 1010);
    expect(z0 - tb.z).toBeGreaterThan(0.2);
  });

  it("스냅샷은 왕복해도 판이 이어지고, 이벤트는 한 번씩만 나온다", () => {
    const rt = room(4);
    run(rt, 500);
    applyAct(rt, 1, { k: "salt", yaw: 0 });
    const snap = makeSnap(rt.state, 3);
    expect(isSnap(snap)).toBe(true);
    expect(isSnap({ v: 1 })).toBe(false);
    const buf = new SnapBuffer();
    expect(buf.push(snap, 0).some((e) => e.k === "salt")).toBe(true);
    run(rt, 100);
    expect(buf.push(makeSnap(rt.state, 4), 100).some((e) => e.k === "salt")).toBe(false);
    const back = stateFromSnap(JSON.parse(JSON.stringify(snap)));
    expect((back as unknown as { seq?: number }).seq).toBeUndefined();
    const rt2 = createHost(back, botThink);
    run(rt2, 1000);
    expect(rt2.state.t).toBe(snap.t + 1000);
    expect(rt2.state.tg.seat).toBe(rt.state.tg.seat);
  });
});
