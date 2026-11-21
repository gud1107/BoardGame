import { describe, expect, it } from "vitest";
import { botThink } from "./bot";
import {
  BUBBLE_MS,
  CAR_R,
  CATCHUP_MAX,
  COUNTDOWN_MS,
  DRIFT_T1_MS,
  DRIFT_T2_MS,
  FINISH_GRACE_MS,
  GP_POINTS,
  INTERMISSION_MS,
  ITEM_ROLL_MS,
  RUG_MULT,
  STEP_MS,
  TOY_AHEAD,
  TOY_AUTO_MS,
  TOY_WARN_MS,
  TRACK_IDS,
  V_MAX,
  fmtTime,
  sanitizeOptions,
  type GameOptions,
} from "./data";
import { LocalDriver } from "./local";
import { SnapBuffer, isSnap, makeSnap, stateFromSnap } from "./net";
import { IDLE_INPUT, driftTier, forwardSpeed, newCar, stepCar, type Car } from "./physics";
import {
  applyReport,
  carAhead,
  catchupFor,
  computeRanks,
  createHost,
  createMatch,
  dropToy,
  fireItem,
  hazardAt,
  setAway,
  step,
  trackOf,
  type HostRuntime,
  type MatchState,
  type PosReport,
} from "./sim";
import { toyRaceStatDetails } from "./stats";
import { BRIDGE_H, GRID_LANES, latLimit, pointAt, project, projectGlobal, trackFor, trainState, wrapDelta, type Track } from "./track";

const humans = (n: number) => Array.from({ length: n }, () => ({ bot: false, level: 5 }));
const bots = (n: number, level = 5) => Array.from({ length: n }, () => ({ bot: true, level }));

function host(seats = humans(3), opts: Partial<GameOptions> = {}, seed = 7): HostRuntime {
  return createHost(createMatch(seed, seats, { items: false, toyBox: false, laps: 3, ...opts }), botThink);
}

function run(rt: HostRuntime, ms: number) {
  const n = Math.round(ms / STEP_MS);
  for (let i = 0; i < n; i++) step(rt);
}

function toRace(rt: HostRuntime) {
  while (rt.state.phase !== "race") step(rt);
}

/** 차를 트랙 위치 s, 옆 lat에 진행 방향으로 놓는다 (진행 거리도 맞춤) */
function placeAt(s: MatchState, seat: number, at: number, lat = 0, dist?: number) {
  const tr = trackOf(s);
  const q = pointAt(tr, at, lat);
  Object.assign(s.players[seat], { x: q.x, z: q.z, y: q.y, h: q.h, vx: 0, vz: 0, seg: q.i, lastS: ((at % tr.L) + tr.L) % tr.L, dist: dist ?? at, spinUntil: 0, immuneUntil: 0, airUntil: 0 });
}

/** 시험용 원형 트랙 (반지름 R, 도로 반폭 W) */
function circleTrack(R: number, W: number): Track {
  const n = Math.round((Math.PI * 2 * R) / 0.8);
  const ds = (Math.PI * 2 * R) / n;
  const f = (fn: (i: number) => number) => Float64Array.from({ length: n }, (_, i) => fn(i));
  const a = (i: number) => (i / n) * Math.PI * 2;
  return {
    ...trackFor("living"),
    n,
    L: n * ds,
    ds,
    x: f((i) => Math.cos(a(i)) * R),
    z: f((i) => Math.sin(a(i)) * R),
    y: new Float64Array(n),
    tx: f((i) => -Math.sin(a(i))),
    tz: f((i) => Math.cos(a(i))),
    w: new Float64Array(n).fill(W),
    rugA: new Float64Array(n).fill(2),
    rugB: new Float64Array(n).fill(2),
    soap: new Uint8Array(n),
    curv: new Float64Array(n).fill(1 / R),
    obstacles: [],
    jumps: [],
    boxes: [],
  };
}

function freeCar(tr: Track, s = 20, lat = 0): Car {
  const q = pointAt(tr, s, lat);
  return newCar(tr, q.x, q.z, q.h, s, q.i);
}

function drive(c: Car, tr: Track, ms: number, inp = IDLE_INPUT, t0 = 10_000): number {
  let t = t0;
  for (let i = 0; i < ms / STEP_MS; i++) {
    t += STEP_MS;
    stepCar(c, inp, tr, t, STEP_MS / 1000);
  }
  return t;
}

const report = (p: { x: number; z: number; y: number; vx: number; vz: number; h: number }, extra: Partial<PosReport> = {}): PosReport => ({ x: p.x, z: p.z, y: p.y, vx: p.vx, vz: p.vz, h: p.h, fl: 0, ni: 0, nt: 0, nr: 0, rk: 0, tp: 1, race: 0, ...extra });

/* ── 트랙 ───────────────────────────────────────────────────────────── */

describe("트랙", () => {
  it.each(TRACK_IDS)("%s: 고르게 찍혔고, 다른 가지끼리 울타리가 겹치지 않는다", (id) => {
    const t = trackFor(id);
    expect(t.n).toBeGreaterThan(200);
    for (let i = 0; i < t.n; i++) {
      const j = (i + 1) % t.n;
      expect(Math.hypot(t.x[j] - t.x[i], t.z[j] - t.z[i])).toBeLessThan(t.ds * 1.25);
    }
    let minSep = Infinity;
    for (let i = 0; i < t.n; i += 2)
      for (let j = i + 2; j < t.n; j += 2) {
        const gap = Math.min(j - i, t.n - (j - i)) * t.ds;
        if (gap < 30 || Math.abs(t.y[i] - t.y[j]) > 1.5) continue;
        minSep = Math.min(minSep, Math.hypot(t.x[i] - t.x[j], t.z[i] - t.z[j]));
      }
    expect(minSep).toBeGreaterThan((t.w[0] + t.rugA[0]) * 2 + 1);
  });

  it.each(TRACK_IDS)("%s: 상자·장애물은 도로 위, 투하 자리 9곳, 소품은 트랙 밖", (id) => {
    const t = trackFor(id);
    for (const b of t.boxes) expect(Math.abs(b.lat)).toBeLessThan(t.w[0]);
    for (const o of t.obstacles) expect(Math.abs(o.lat) + o.r).toBeLessThan(t.w[0] + 0.2);
    expect(t.sockets).toHaveLength(9);
    for (const p of t.props) {
      if (p.kind === "rug" || p.kind === "mat" || p.kind === "table") continue;
      let d = Infinity;
      for (let i = 0; i < t.n; i++) d = Math.min(d, Math.hypot(t.x[i] - p.x, t.z[i] - p.z));
      expect(d).toBeGreaterThan(t.w[0] + t.rugA[0] + 2);
    }
  });

  it("아이 방은 8자 — 가운데 엇갈리는 곳은 책 다리로 위아래가 나뉜다", () => {
    const t = trackFor("bedroom");
    expect(Math.max(...t.y)).toBeCloseTo(BRIDGE_H, 1);
    // 다리 위·아래 표본이 같은 곳(가까운 x,z)에 있다
    let crossing = false;
    for (let i = 0; i < t.n; i++)
      for (let j = 0; j < t.n; j++) if (t.y[i] > 2 && t.y[j] < 0.2 && Math.hypot(t.x[i] - t.x[j], t.z[i] - t.z[j]) < 1) crossing = true;
    expect(crossing).toBe(true);
    // 다리 위는 러그 대신 난간
    const hi = t.y.findIndex((v) => v > 2);
    expect(t.rugA[hi]).toBe(0);
    expect(t.train).not.toBeNull();
  });

  it("투영: 가운데 선 위 점은 그 위치, 옆 거리 부호는 진행 방향 오른쪽이 +", () => {
    const t = trackFor("living");
    const q = pointAt(t, 50, 1.5);
    const p = project(t, q.x, q.z, q.i);
    expect(Math.abs(wrapDelta(p.s - 50, t.L))).toBeLessThan(0.05);
    expect(p.lat).toBeCloseTo(1.5, 1);
    // 오른쪽 = 방향각이 커지는 쪽 (x=cos h, z=sin h 기준 법선 (−sin h, cos h))
    expect(q.x - pointAt(t, 50, 0).x).toBeCloseTo(-Math.sin(q.h) * 1.5, 2);
  });

  it("8자 교차점: 직전 표본에 따라 지금 가지를 유지한다", () => {
    const t = trackFor("bedroom");
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < t.n; i++)
      for (let j = 0; j < t.n; j++)
        if (t.y[i] < 0.1 && t.y[j] > 2.3 && Math.hypot(t.x[i] - t.x[j], t.z[i] - t.z[j]) < 1) {
          lo = i;
          hi = j;
        }
    expect(project(t, t.x[lo], t.z[lo], lo).i).toBeLessThan(lo + 3);
    expect(Math.abs(project(t, t.x[lo], t.z[lo], hi).i - hi)).toBeLessThan(13);
    expect(projectGlobal(t, t.x[hi], t.z[hi], BRIDGE_H).y).toBeGreaterThan(2);
  });

  it("출발 자리: 4명까지는 한 줄로 나란히, 5명부터 두 번째 줄", () => {
    const t = trackFor("living");
    const s = createMatch(3, bots(8), { track: "living" });
    const lats = s.players.map((p) => project(t, p.x, p.z, p.seg));
    const front = lats.filter((p) => wrapDelta(p.s, t.L) > -3);
    expect(front).toHaveLength(4);
    expect(front.map((p) => Math.round(p.lat * 10) / 10).sort((a, b) => a - b)).toEqual(GRID_LANES);
    for (const p of s.players) expect(p.dist).toBeLessThan(0);
  });

  it("기차 건널목: 경고 → 지나감 → 비었음 주기", () => {
    const t = trackFor("bedroom");
    const tr = t.train!;
    expect(trainState(t, tr.offset + 100)).toBe("cross");
    expect(trainState(t, tr.offset - 100)).toBe("warn");
    expect(trainState(t, tr.offset + tr.cross + 500)).toBe("clear");
    expect(trainState(t, -5)).toBe("clear");
  });
});

/* ── 차 물리 ────────────────────────────────────────────────────────── */

describe("차 물리", () => {
  const tr = trackFor("bath");

  it("손을 떼도 저절로 최고 속도까지 가속하고, 브레이크로 선다", () => {
    const c = freeCar(tr, 140);
    const t = drive(c, tr, 1500);
    expect(forwardSpeed(c)).toBeGreaterThan(V_MAX * 0.9);
    drive(c, tr, 800, { steer: 0, brake: true, drift: false }, t);
    expect(Math.abs(forwardSpeed(c))).toBeLessThan(2.5);
  });

  it("핸들 +1은 오른쪽(방향각이 커짐)", () => {
    const c = freeCar(tr, 140);
    c.vx = Math.cos(c.h) * 10;
    c.vz = Math.sin(c.h) * 10;
    const h0 = c.h;
    drive(c, tr, 200, { steer: 1, brake: false, drift: false });
    let d = c.h - h0;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    expect(d).toBeGreaterThan(0.2);
  });

  it("울타리 밖으로 못 나가고, 러그에선 느리다", () => {
    const c = freeCar(tr, 140);
    // 오른쪽으로 계속 꺾어 울타리로
    drive(c, tr, 3000, { steer: 1, brake: false, drift: false });
    const p = project(tr, c.x, c.z, c.seg);
    expect(Math.abs(p.lat)).toBeLessThanOrEqual(latLimit(tr, p.i, p.lat >= 0 ? 1 : -1) + 1e-6);
    // 러그 위 직진 속도
    const r = freeCar(tr, 140, tr.w[0] + 0.7);
    drive(r, tr, 200);
    r.vx = Math.cos(r.h) * 4;
    r.vz = Math.sin(r.h) * 4;
    const pr = project(tr, r.x, r.z, r.seg);
    if (Math.abs(pr.lat) > tr.w[pr.i]) {
      drive(r, tr, 400);
      expect(forwardSpeed(r)).toBeLessThan(V_MAX * RUG_MULT + 0.5);
    }
  });

  it("🌀 드리프트를 오래 끌수록 1단·2단, 떼면 부스트", () => {
    // 울타리에 안 박게 아주 넓은 원형 연습장에서
    const tr = circleTrack(60, 30);
    const c = freeCar(tr, 10);
    let t = drive(c, tr, 1500);
    const inp = { steer: 1, brake: false, drift: true };
    t = drive(c, tr, DRIFT_T1_MS + 80, inp, t);
    expect(c.drift).not.toBe(0);
    expect(driftTier(c)).toBe(1);
    t = drive(c, tr, DRIFT_T2_MS - DRIFT_T1_MS + 50, inp, t);
    expect(driftTier(c)).toBe(2);
    const ev = stepCar(c, { steer: 0, brake: false, drift: false }, tr, t + STEP_MS, STEP_MS / 1000);
    expect(ev.some((e) => e.k === "driftBoost" && e.tier === 2)).toBe(true);
    expect(c.boostUntil).toBeGreaterThan(t);
  });

  it("📚 점프대를 빠르게 넘으면 붕 떴다가 내려앉는다", () => {
    const lt = trackFor("living");
    const j = lt.jumps[0].s;
    const c = freeCar(lt, j - 12);
    let air = false;
    let land = false;
    let t = 20_000;
    for (let i = 0; i < 200; i++) {
      t += STEP_MS;
      const ev = stepCar(c, IDLE_INPUT, lt, t, STEP_MS / 1000);
      if (ev.some((e) => e.k === "jump")) air = true;
      if (ev.some((e) => e.k === "land")) land = true;
    }
    expect(air).toBe(true);
    expect(land).toBe(true);
  });

  it("고정 장애물(샴푸 통)은 지나갈 수 없다", () => {
    const o = tr.obstacles[0];
    const c = freeCar(tr, o.s - 6, o.lat);
    drive(c, tr, 1200);
    for (const ob of tr.obstacles) expect(Math.hypot(c.x - ob.x, c.z - ob.z)).toBeGreaterThanOrEqual(ob.r + CAR_R - 1e-6);
  });
});

/* ── 레이스 진행 ─────────────────────────────────────────────────────── */

describe("레이스", () => {
  it("카운트다운 뒤 출발 (go 이벤트), 카운트다운 중엔 봇이 안 움직인다", () => {
    const rt = host(bots(3));
    const x0 = rt.state.players[0].x;
    run(rt, COUNTDOWN_MS - 200);
    expect(rt.state.phase).toBe("countdown");
    expect(rt.state.players[0].x).toBe(x0);
    run(rt, 400);
    expect(rt.state.phase).toBe("race");
    expect(rt.state.events.some((e) => e.k === "go")).toBe(true);
  });

  it("진행 거리로 바퀴를 세고, 다 돌면 들어온 순서로 순위", () => {
    const rt = host(humans(3), { laps: 2 });
    toRace(rt);
    const s = rt.state;
    const L = trackOf(s).L;
    placeAt(s, 1, 2 * L + 1, 0, 2 * L + 1);
    run(rt, 50);
    expect(s.players[1].finishedAt).toBeGreaterThan(0);
    expect(s.players[1].finishRank).toBe(1);
    expect(s.events.some((e) => e.k === "firstFinish" && e.s === 1)).toBe(true);
    placeAt(s, 0, 2 * L + 1, 0, 2 * L + 1);
    run(rt, 50);
    expect(s.players[0].finishRank).toBe(2);
    // 나머지는 15초 안에 못 들어오면 끝
    run(rt, FINISH_GRACE_MS + 200);
    expect(s.phase).toBe("gameOver");
    expect(s.ranks).toEqual([2, 1, 3]);
  });

  it("한 바퀴 돌면 lap 이벤트와 랩 시간, 마지막 바퀴 알림", () => {
    const rt = host(humans(2), { laps: 2 });
    toRace(rt);
    const s = rt.state;
    const L = trackOf(s).L;
    run(rt, 1000);
    placeAt(s, 0, L + 0.5, 0, L + 0.5);
    run(rt, 20);
    expect(s.players[0].laps).toBe(1);
    expect(s.events.some((e) => e.k === "lap" && e.s === 0 && e.ms > 900)).toBe(true);
    expect(s.events.some((e) => e.k === "finalLap" && e.s === 0)).toBe(true);
    expect(s.players[0].stats.bestLapMs).toBeGreaterThan(900);
  });

  it("🏆 그랑프리: 세 트랙, 점수 합산, 점수가 낮은 사람이 앞줄", () => {
    const rt = host(humans(3), { mode: "gp", laps: 2 });
    const s = rt.state;
    expect(s.races).toBe(3);
    expect(s.track).toBe("living");
    toRace(rt);
    const L = trackOf(s).L;
    for (const seat of [2, 0, 1]) {
      placeAt(s, seat, 2 * L + 1, 0, 2 * L + 1);
      run(rt, 30);
    }
    expect(s.phase).toBe("raceEnd");
    expect(s.players.map((p) => p.points)).toEqual([GP_POINTS[1], GP_POINTS[2], GP_POINTS[0]]);
    expect(s.raceRanks).toEqual([2, 3, 1]);
    run(rt, INTERMISSION_MS + 100);
    expect(s.phase).toBe("countdown");
    expect(s.track).toBe("bath");
    expect(s.race).toBe(1);
    // 점수가 가장 낮은 1번 자리가 첫 칸(맨 왼쪽 줄)
    const tr = trackOf(s);
    expect(project(tr, s.players[1].x, s.players[1].z, s.players[1].seg).lat).toBeCloseTo(GRID_LANES[0], 1);
    expect(s.players.every((p) => p.laps === 0 && !p.finishedAt)).toBe(true);
  });

  it("그랑프리 최종 순위: 점수 → 동점이면 마지막 레이스 순위", () => {
    const s = createMatch(1, humans(3), { mode: "gp" });
    s.players[0].points = 20;
    s.players[1].points = 20;
    s.players[2].points = 9;
    s.players[0].raceRanks = [1, 2, 3];
    s.players[1].raceRanks = [3, 1, 1];
    s.players[2].raceRanks = [2, 3, 2];
    expect(computeRanks(s)).toEqual([2, 1, 3]);
  });

  it("너무 오래 걸리면 그 자리 순위로 끝난다", () => {
    const rt = host(humans(2), { laps: 2 });
    toRace(rt);
    run(rt, 2 * 70_000 + 100);
    expect(rt.state.phase).toBe("gameOver");
  });
});

/* ── 아이템 ─────────────────────────────────────────────────────────── */

describe("아이템", () => {
  function itemsHost(n = 3) {
    const rt = host(humans(n), { items: true });
    toRace(rt);
    return rt;
  }

  it("🎁 상자를 지나면 아이템, 룰렛이 끝나야 쓸 수 있고, 상자는 3초 뒤 다시 생긴다", () => {
    const rt = itemsHost();
    const s = rt.state;
    const tr = trackOf(s);
    const b = tr.boxes[0];
    placeAt(s, 0, b.s, b.lat, b.s);
    run(rt, 20);
    expect(s.players[0].item).not.toBeNull();
    expect(s.boxes[0].back).toBeGreaterThan(s.t);
    expect(fireItem(rt, 0)).toBe(false);
    run(rt, ITEM_ROLL_MS + 50);
    expect(fireItem(rt, 0)).toBe(true);
    placeAt(s, 0, b.s + 30, 0, b.s + 30);
    run(rt, 3100);
    expect(s.boxes[0].back).toBe(0);
  });

  it("아이템이 꺼져 있으면 상자를 깨도 빈손", () => {
    const rt = host(humans(2), { items: false });
    toRace(rt);
    const s = rt.state;
    const b = trackOf(s).boxes[0];
    placeAt(s, 0, b.s, b.lat, b.s);
    run(rt, 20);
    expect(s.players[0].item).toBeNull();
  });

  it("🔋 건전지: 사람 차는 fxBoost로 내려보낸다", () => {
    const rt = itemsHost();
    const p = rt.state.players[0];
    p.item = "battery";
    p.itemAt = rt.state.t - ITEM_ROLL_MS - 1;
    const n0 = p.fxBoost;
    expect(fireItem(rt, 0)).toBe(true);
    expect(p.fxBoost).toBe(n0 + 1);
    expect(p.item).toBeNull();
  });

  it("🧶 털실: 앞차를 맞히면 빙글 (fxSpin), 🫧 방패면 막힘", () => {
    const rt = itemsHost();
    const s = rt.state;
    placeAt(s, 0, 60, 0, 60);
    placeAt(s, 1, 66, 0, 66);
    placeAt(s, 2, 150, 0, 150);
    s.players[0].item = "yarn";
    s.players[0].itemAt = 0;
    fireItem(rt, 0);
    run(rt, 600);
    expect(s.players[1].fxSpin).toBe(1);
    expect(s.players[0].stats.hits).toBe(1);
    // 방패
    run(rt, 2500);
    placeAt(s, 1, 66, 0, 66);
    s.players[1].shieldUntil = s.t + BUBBLE_MS;
    s.players[0].item = "yarn";
    s.players[0].itemAt = 0;
    placeAt(s, 0, 60, 0, 60);
    fireItem(rt, 0);
    run(rt, 600);
    expect(s.players[1].fxSpin).toBe(1);
    expect(s.players[1].shieldUntil).toBe(0);
    expect(s.players[1].stats.blocked).toBe(1);
  });

  it("🪀 요요: 바로 앞 순위 차를 쫓아가 맞힌다 (멀리 있어도)", () => {
    const rt = itemsHost();
    const s = rt.state;
    placeAt(s, 0, 20, 0, 20);
    placeAt(s, 1, 60, 1, 60);
    placeAt(s, 2, 100, 0, 100);
    run(rt, 20);
    expect(carAhead(s, s.players[0])).toBe(1);
    s.players[0].item = "yoyo";
    s.players[0].itemAt = 0;
    fireItem(rt, 0);
    expect(s.projectiles[0].kind).toBe("yoyo");
    expect(s.projectiles[0].target).toBe(1);
    run(rt, 2500);
    expect(s.players[1].fxSpin).toBe(1);
    expect(s.players[2].fxSpin).toBe(0);
  });

  it("🦆 오리: 뒤에 놓이고, 봇 차가 밟으면 빙글", () => {
    const rt = createHost(createMatch(5, [{ bot: false, level: 5 }, { bot: true, level: 5 }], { items: true, toyBox: false }));
    toRace(rt);
    const s = rt.state;
    placeAt(s, 0, 80, 0, 80);
    s.players[0].item = "duck";
    s.players[0].itemAt = 0;
    fireItem(rt, 0);
    expect(s.ducks).toHaveLength(1);
    const d = s.ducks[0];
    expect(project(trackOf(s), d.x, d.z, s.players[0].seg).s).toBeLessThan(80);
    const dp = project(trackOf(s), d.x, d.z, s.players[0].seg);
    placeAt(s, 1, dp.s - 2.5, dp.lat, dp.s - 2.5);
    rt.think = null;
    s.players[1].vx = Math.cos(s.players[1].h) * 8;
    s.players[1].vz = Math.sin(s.players[1].h) * 8;
    run(rt, 1500);
    expect(s.players[1].stats.spun).toBe(1);
    expect(s.ducks).toHaveLength(0);
  });

  it("🌀 팽이: 무적이고 부딪힌 차가 빙글", () => {
    const rt = itemsHost();
    const s = rt.state;
    placeAt(s, 0, 80, 0, 80);
    placeAt(s, 1, 80.6, 0, 80.6);
    s.players[0].item = "top";
    s.players[0].itemAt = 0;
    fireItem(rt, 0);
    expect(s.players[0].fxTop).toBe(1);
    run(rt, 20);
    expect(s.players[1].fxSpin).toBe(1);
  });
});

/* ── 🧸 꼴찌의 장난감 ───────────────────────────────────────────────── */

describe("꼴찌의 장난감 상자", () => {
  function toyHost(n = 3) {
    const rt = host(humans(n), { toyBox: true });
    toRace(rt);
    return rt;
  }

  it("선두가 새 바퀴에 들어서면 꼴찌가 받는다 (1등은 못 받음)", () => {
    const rt = toyHost();
    const s = rt.state;
    const L = trackOf(s).L;
    placeAt(s, 0, L + 1, 0, L + 1);
    placeAt(s, 1, 100, 0, 100);
    placeAt(s, 2, 40, 0, 40);
    run(rt, 30);
    expect(s.players[2].toy).toBe(1);
    expect(s.players[0].toy).toBe(0);
    expect(s.events.some((e) => e.k === "toyGet" && e.s === 2)).toBe(true);
  });

  it("던지면 선두보다 24u 넘게 앞 투하 자리에, 선두가 달리던 반쪽에 떨어진다 (그림자 1.5초 뒤 벽)", () => {
    const rt = toyHost();
    const s = rt.state;
    const tr = trackOf(s);
    placeAt(s, 0, 30, 1.5, 30);
    placeAt(s, 1, 10, 0, 10);
    placeAt(s, 2, 5, 0, 5);
    run(rt, 20);
    s.players[2].toy = 1;
    s.players[2].toyAt = s.t;
    expect(dropToy(rt, 2)).toBe(true);
    const toy = s.toys[0];
    expect(wrapDelta(toy.s - 30, tr.L)).toBeGreaterThanOrEqual(TOY_AHEAD - 1);
    expect(tr.sockets).toContain(toy.s);
    expect(toy.side).toBe(1);
    expect(toy.target).toBe(0);
    expect(toy.activeAt - toy.at).toBeCloseTo(TOY_WARN_MS);
    expect(s.players[2].toy).toBe(0);
  });

  it("벽에 박은 봇 차는 뒤로 튕기고 벽은 한 번에 무너진다", () => {
    const rt = createHost(createMatch(9, [{ bot: true, level: 1 }, { bot: false, level: 5 }, { bot: false, level: 5 }], { toyBox: true, items: false }));
    toRace(rt);
    const s = rt.state;
    const tr = trackOf(s);
    const sock = tr.sockets[3];
    placeAt(s, 0, sock - 2, 1.2, sock - 2);
    s.toys.push({ id: 99, s: sock, side: 1, owner: 2, target: 0, d: sock, at: s.t - 2000, activeAt: s.t - 100, until: s.t + 9000, ...pointAt(tr, sock, 2), y: 0 });
    // 봇이 피하지 못하게 생각을 끈다
    rt.think = null;
    s.players[0].vx = Math.cos(s.players[0].h) * 10;
    s.players[0].vz = Math.sin(s.players[0].h) * 10;
    run(rt, 400);
    expect(s.players[0].stats.crashes).toBe(1);
    expect(s.players[2].stats.toyHits).toBe(1);
    expect(s.toys).toHaveLength(0);
  });

  it("안 던지고 버티면 10초 뒤 저절로 떨어진다 · 장난감 상자를 끄면 아무도 안 받는다", () => {
    const rt = toyHost();
    const s = rt.state;
    placeAt(s, 0, 50, 0, 50);
    s.players[2].toy = 1;
    s.players[2].toyAt = s.t;
    run(rt, TOY_AUTO_MS + 100);
    expect(s.players[2].toy).toBe(0);
    expect(s.players[2].stats.toyDrops).toBe(1);

    const off = host(humans(3), { toyBox: false });
    toRace(off);
    const L = trackOf(off.state).L;
    placeAt(off.state, 0, L + 1, 0, L + 1);
    run(off, 30);
    expect(off.state.players.every((p) => p.toy === 0)).toBe(true);
  });
});

/* ── 사람 차 보고 (방장 검사) ───────────────────────────────────────── */

describe("사람 차 보고", () => {
  it("말이 되는 위치는 받아들이고 진행 거리를 쌓는다", () => {
    const rt = host(humans(2));
    toRace(rt);
    const s = rt.state;
    const tr = trackOf(s);
    const p = s.players[0];
    const d0 = p.dist;
    const q = pointAt(tr, p.lastS + 1, 0);
    expect(applyReport(rt, 0, report({ ...q, y: q.y, vx: 10, vz: 0 }))).toBe(true);
    expect(p.dist).toBeGreaterThan(d0 + 0.5);
  });

  it("순간이동·울타리 밖은 버리고 tp(보정)를 올린다 · tp를 아직 못 받은 보고는 무시", () => {
    const rt = host(humans(2));
    toRace(rt);
    const s = rt.state;
    const tr = trackOf(s);
    const p = s.players[0];
    applyReport(rt, 0, report(p));
    run(rt, 50);
    const far = pointAt(tr, p.lastS + 60, 0);
    const tp0 = p.tp;
    expect(applyReport(rt, 0, report({ ...far, vx: 0, vz: 0 }))).toBe(false);
    expect(p.tp).toBe(tp0 + 1);
    // 옛 tp 번호로 온 보고는 버림
    expect(applyReport(rt, 0, report(p, { tp: tp0 }))).toBe(false);
    expect(applyReport(rt, 0, report(p, { tp: p.tp }))).toBe(true);
    // 다른 레이스 번호도 버림
    expect(applyReport(rt, 0, report(p, { tp: p.tp, race: 3 }))).toBe(false);
  });

  it("누른 횟수 카운터가 늘면 아이템·장난감을 쓴다 (첫 보고는 기준만)", () => {
    const rt = host(humans(3), { items: true, toyBox: true });
    toRace(rt);
    const s = rt.state;
    const p = s.players[1];
    applyReport(rt, 1, report(p, { tp: p.tp, ni: 4 }));
    p.item = "bubble";
    p.itemAt = 0;
    applyReport(rt, 1, report(p, { tp: p.tp, ni: 5 }));
    expect(p.item).toBeNull();
    expect(p.shieldUntil).toBeGreaterThan(s.t);
  });

  it("스스로 밟은 오리 보고: 오리를 치우고 놓은 사람에게 기록", () => {
    const rt = host(humans(3), { items: true });
    toRace(rt);
    const s = rt.state;
    s.ducks.push({ id: 5, x: 0, z: 0, y: 0, owner: 2, at: s.t, until: s.t + 9000 });
    const p = s.players[0];
    applyReport(rt, 0, report(p, { tp: p.tp }));
    applyReport(rt, 0, report(p, { tp: p.tp, hz: [{ k: "duck", id: 5 }] }));
    expect(s.ducks).toHaveLength(0);
    expect(s.players[2].stats.hits).toBe(1);
    expect(p.stats.spun).toBe(1);
  });

  it("봇 보고는 무시, 나간 사람은 봇이 대신 달리고 돌아오면 tp로 맞춘다", () => {
    const rt = host([{ bot: false, level: 5 }, { bot: true, level: 5 }]);
    toRace(rt);
    const s = rt.state;
    expect(applyReport(rt, 1, report(s.players[1]))).toBe(false);
    setAway(rt, 0, true);
    const d0 = s.players[0].dist;
    run(rt, 3000);
    expect(s.players[0].dist).toBeGreaterThan(d0 + 10);
    const tp = s.players[0].tp;
    setAway(rt, 0, false);
    expect(s.players[0].bot).toBe(false);
    expect(s.players[0].tp).toBe(tp + 1);
  });
});

/* ── 내 차 (LocalDriver) ─────────────────────────────────────────────── */

describe("내 차", () => {
  function setup() {
    const rt = host(humans(2));
    const buf = new SnapBuffer();
    let now = 1000;
    const push = () => buf.push(makeSnap(rt.state, rt.state.eventSeq + Math.round(rt.state.t)), now);
    push();
    const d = new LocalDriver(0);
    return {
      rt,
      buf,
      d,
      tick(ms: number) {
        const n = Math.round(ms / STEP_MS);
        for (let i = 0; i < n; i++) {
          step(rt);
          now += STEP_MS;
          if (i % 6 === 0) push();
          d.frame(buf, now, []);
          if (i % 4 === 0) {
            const r = d.report(rt.state.race);
            if (r) applyReport(rt, 0, r);
          }
        }
        push();
      },
      get now() {
        return now;
      },
    };
  }

  it("카운트다운 중엔 묶여 있고 출발하면 달린다 · 보고가 방장에게 받아들여진다", () => {
    const k = setup();
    k.tick(1000);
    const c = k.d.car!;
    const x0 = c.x;
    k.tick(1000);
    expect(c.x).toBe(x0);
    k.tick(COUNTDOWN_MS);
    expect(Math.hypot(c.x - x0, c.z)).toBeGreaterThan(1);
    const r = k.d.report(k.rt.state.race)!;
    expect(applyReport(k.rt, 0, r)).toBe(true);
  });

  it("🚀 출발 직전에 누르면 부스트, 너무 일찍 누르면 시동 꺼짐", () => {
    const good = setup();
    good.tick(COUNTDOWN_MS - 250);
    good.d.pressRocket(good.now, "countdown");
    good.tick(600);
    expect(good.d.rocket).toBe(1);
    expect(good.d.car!.boostUntil).toBeGreaterThan(0);

    const bad = setup();
    bad.tick(COUNTDOWN_MS - 1500);
    bad.d.pressRocket(bad.now, "countdown");
    bad.tick(1700);
    expect(bad.d.rocket).toBe(-1);
    expect(bad.d.events.some((e) => e.k === "rocket" && !e.ok)).toBe(true);
  });

  it("방장이 내린 빙글(fxSpin)을 받아 적용한다", () => {
    const k = setup();
    k.tick(COUNTDOWN_MS + 500);
    k.rt.state.players[0].fxSpin += 1;
    k.rt.state.players[0].fxSpinMs = 1000;
    k.tick(50);
    expect(k.d.car!.spinUntil).toBeGreaterThan(k.now);
  });
});

/* ── 스냅샷·방장 승계·기록 ─────────────────────────────────────────── */

describe("스냅샷과 방장 승계", () => {
  it("스냅샷 = 상태 전체 → 이어받아 끝까지 진행된다", () => {
    const rt = host(bots(4), { items: true, toyBox: true }, 11);
    run(rt, 20_000);
    const snap = makeSnap(rt.state, 42);
    expect(isSnap(snap)).toBe(true);
    expect(isSnap({ v: 1 })).toBe(false);
    const st = stateFromSnap(snap);
    const rt2 = createHost(st, botThink);
    let g = 0;
    while (st.phase !== "gameOver" && g++ < 60 * 300) step(rt2);
    expect(st.phase).toBe("gameOver");
    expect([...st.ranks!].sort()).toEqual([1, 2, 3, 4]);
  });

  it("버퍼: 같은 이벤트는 한 번만, 오래된 스냅샷은 무시", () => {
    const rt = host(bots(2));
    run(rt, COUNTDOWN_MS + 100);
    const buf = new SnapBuffer();
    const a = makeSnap(rt.state, 1);
    expect(buf.push(a, 0).some((e) => e.k === "go")).toBe(true);
    expect(buf.push(makeSnap(rt.state, 2), 10).some((e) => e.k === "go")).toBe(false);
    expect(buf.push(a, 20)).toEqual([]);
    expect(buf.car(0, 30)).not.toBeNull();
  });

  it("기록: 들어온 사람의 상세 기록, 랩 기록이 없으면 minLapCs를 빼서 합칠 때 0이 최고 기록이 되지 않는다", () => {
    const rt = host(bots(3), { laps: 2 }, 3);
    let g = 0;
    while (rt.state.phase !== "gameOver" && g++ < 60 * 300) step(rt);
    const d = toyRaceStatDetails(rt.state, 0);
    expect(d.races).toBe(1);
    expect(d.minLapCs).toBeGreaterThan(500);
    const none = createMatch(1, bots(2));
    expect("minLapCs" in toyRaceStatDetails(none, 0)).toBe(false);
  });

  it("옵션 정리·시간 표시·뒤처짐 바람", () => {
    expect(sanitizeOptions({ laps: 4 as 3, track: "moon" as "living", mode: "x" as "gp" })).toEqual({ mode: "single", track: "living", laps: 3, items: true, toyBox: true });
    expect(sanitizeOptions({ track: "random", laps: 5, items: false })).toMatchObject({ track: "random", laps: 5, items: false });
    expect(fmtTime(62_345)).toBe("1:02.35");
    expect(fmtTime(0)).toBe("-:--.--");
    expect(catchupFor(0)).toBe(1);
    expect(catchupFor(1000)).toBeCloseTo(1 + CATCHUP_MAX);
    expect(catchupFor(21)).toBeGreaterThan(1);
  });

  it("고무 오리 위험물 판정은 놓은 사람에게 잠깐 안전", () => {
    const s = createMatch(2, humans(2), { items: true });
    const tr = trackOf(s);
    const q = pointAt(tr, 40, 0);
    s.ducks.push({ id: 1, x: q.x, z: q.z, y: q.y, owner: 0, at: 1000, until: 99_000 });
    const c = newCar(tr, q.x, q.z, q.h, 40, q.i);
    expect(hazardAt(s, c, 0, 1500)).toBeNull();
    expect(hazardAt(s, c, 0, 4000)?.k).toBe("duck");
    expect(hazardAt(s, c, 1, 1500)?.k).toBe("duck");
  });
});
