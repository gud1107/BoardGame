import {
  ACCEL,
  BOOST_MULT,
  BRAKE,
  CAR_R,
  DRAFT_CHARGE_MS,
  DRAFT_MULT,
  DRIFT_BOOST1_MS,
  DRIFT_BOOST2_MS,
  DRIFT_GRIP,
  DRIFT_MIN_SPEED,
  DRIFT_SPEED_LOSS,
  DRIFT_T1_MS,
  DRIFT_T2_MS,
  DRIFT_TURN_MULT,
  GRIP,
  JUMP_BASE_MS,
  JUMP_H,
  JUMP_MIN_SPEED,
  JUMP_PER_SPEED_MS,
  OVERSPEED_DECAY,
  PERFECT_LAND_BOOST_MS,
  PERFECT_LAND_RAD,
  REVERSE_MAX,
  RUG_MULT,
  SOAP_GRIP,
  SOAP_TURN,
  SPIN_SPEED,
  TOP_MULT,
  TURN,
  TURN_FULL_SPEED,
  TURN_HIGH_SPEED_LOSS,
  V_MAX,
  WALL_BOUNCE,
  WALL_SPEED_KEEP,
} from "./data";
import { latLimit, pointAt, project, projectGlobal, surfaceAt, wrapDelta, wrapS, type Track } from "./track";

/**
 * 장난감 차 물리 (룰북 §5) — 방장 시뮬(봇 차)과 각자 기기(내 차 예측)가 **같은 함수**를 쓴다.
 *
 * 자동 가속 아케이드 모델: 차는 늘 앞으로 가속하고, 사람은 핸들(−1~1)·브레이크·드리프트만 정한다.
 * 한 스텝: 핸들로 방향 돌리기 → 속도를 새 방향의 앞/옆 성분으로 나눔 → 앞 성분은 목표 속도로,
 * 옆 성분은 접지력만큼 줄임(드리프트·비누는 덜 줄어 미끄러짐) → 이동 → 울타리·고정 장애물 → 점프대 → 진행 거리.
 * 타이머(부스트·빙글 등)는 이 차를 움직이는 쪽의 시계(ms)로 들고 다닌다 — 방장은 시뮬 시각, 내 기기는 내 시계.
 */

export interface Car {
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  /** 진행 방향각 (x = cos h, z = sin h) */
  h: number;
  /** 트랙 표본 번호 (근처만 찾기) */
  seg: number;
  /** 출발부터 쌓인 진행 거리 (뒤로 가면 준다 · 바퀴 = floor(dist / L)) */
  dist: number;
  /** 직전 트랙 위치 */
  lastS: number;
  boostUntil: number;
  boostMult: number;
  spinUntil: number;
  stallUntil: number;
  topUntil: number;
  /** 🔁 제자리로 하는 중 (이때까지 멈춤) */
  resetUntil: number;
  /** 📚 점프 중이면 공중에 뜬 시각·내려오는 시각·높이 */
  airFrom: number;
  airUntil: number;
  airH: number;
  /** 🌀 드리프트 0 = 아님 · 방향 −1/1 · 유지 시간 */
  drift: number;
  driftMs: number;
  /** 💨 바람막이 모은 시간 */
  draftMs: number;
  /** ↩ 반대 방향으로 간 시간 */
  wrongMs: number;
  /** 마지막으로 울타리에 박은 시각 (드리프트 끊기·소리) */
  wallAt: number;
  /** 🐢 뒤처짐 바람 배수 (방장이 정함, 1 = 없음) */
  catchup: number;
}

export interface CarInput {
  /** 핸들 −1(왼쪽) ~ 1(오른쪽) — 운전석 기준 (방향각이 커지는 쪽 = 오른쪽) */
  steer: number;
  brake: boolean;
  drift: boolean;
}

export const IDLE_INPUT: CarInput = { steer: 0, brake: false, drift: false };

export type CarEvent =
  | { k: "wall"; p: number; x: number; z: number }
  | { k: "driftBoost"; tier: 1 | 2 }
  | { k: "jump" }
  | { k: "land"; perfect: boolean }
  | { k: "obstacle"; p: number; x: number; z: number };

export function newCar(track: Track, x: number, z: number, h: number, s: number, i: number): Car {
  return {
    x,
    z,
    y: track.y[i] ?? 0,
    vx: 0,
    vz: 0,
    h,
    seg: i,
    // 출발선 뒤에 서 있으니 진행 거리는 음수에서 시작 (출발선을 넘으면 0)
    dist: wrapDelta(s, track.L),
    lastS: s,
    boostUntil: 0,
    boostMult: 1,
    spinUntil: 0,
    stallUntil: 0,
    topUntil: 0,
    resetUntil: 0,
    airFrom: 0,
    airUntil: 0,
    airH: 0,
    drift: 0,
    driftMs: 0,
    draftMs: 0,
    wrongMs: 0,
    wallAt: -1e9,
    catchup: 1,
  };
}

export const forwardSpeed = (c: Car) => c.vx * Math.cos(c.h) + c.vz * Math.sin(c.h);
export const speedOf = (c: Car) => Math.hypot(c.vx, c.vz);
export const inAir = (c: Car, t: number) => t < c.airUntil;

/** 지금 목표 최고 속도 (러그·부스트·바람막이·팽이·빙글·시동 꺼짐) */
export function targetSpeed(c: Car, t: number, rug: boolean): number {
  if (t < c.stallUntil || t < c.resetUntil) return 0;
  const top = t < c.topUntil;
  let v = V_MAX;
  if (rug && !top) v *= RUG_MULT;
  if (t < c.boostUntil) v *= c.boostMult;
  if (c.draftMs >= DRAFT_CHARGE_MS) v *= DRAFT_MULT;
  if (top) v *= TOP_MULT;
  if (t < c.spinUntil) v *= SPIN_SPEED;
  return v * (c.catchup || 1);
}

export function giveBoost(c: Car, t: number, ms: number, mult = BOOST_MULT) {
  const active = t < c.boostUntil;
  c.boostMult = active ? Math.max(c.boostMult, mult) : mult;
  c.boostUntil = Math.max(c.boostUntil, t + ms);
}

function endDrift(c: Car, t: number, reward: boolean, ev: CarEvent[]) {
  if (c.drift !== 0 && reward) {
    if (c.driftMs >= DRIFT_T2_MS) {
      giveBoost(c, t, DRIFT_BOOST2_MS);
      ev.push({ k: "driftBoost", tier: 2 });
    } else if (c.driftMs >= DRIFT_T1_MS) {
      giveBoost(c, t, DRIFT_BOOST1_MS);
      ev.push({ k: "driftBoost", tier: 1 });
    }
  }
  c.drift = 0;
  c.driftMs = 0;
}

/** 드리프트 단계 (0 없음 · 1 파랑 · 2 주황) */
export function driftTier(c: Car): 0 | 1 | 2 {
  if (c.drift === 0) return 0;
  return c.driftMs >= DRIFT_T2_MS ? 2 : c.driftMs >= DRIFT_T1_MS ? 1 : 0;
}

/**
 * 한 스텝. `t`는 이 차 시계의 지금 시각(스텝 끝), dt 초.
 * 돌려주는 이벤트는 소리·연출·기록용 (게임 판정은 sim.ts가 한다).
 */
export function stepCar(c: Car, inp: CarInput, track: Track, t: number, dt: number): CarEvent[] {
  const ev: CarEvent[] = [];
  if (t < c.resetUntil) {
    c.vx = 0;
    c.vz = 0;
    return ev;
  }
  // 📚 공중: 그대로 날아가고 핸들·접지 없음
  if (c.airUntil > 0) {
    c.x += c.vx * dt;
    c.z += c.vz * dt;
    const p = project(track, c.x, c.z, c.seg);
    const u = Math.min(1, (t - c.airFrom) / Math.max(1, c.airUntil - c.airFrom));
    c.y = p.y + c.airH * 4 * u * (1 - u);
    walls(c, track, p, t, ev);
    progress(c, track, project(track, c.x, c.z, c.seg));
    if (t >= c.airUntil) {
      c.airUntil = 0;
      c.airFrom = 0;
      const pp = pointAt(track, c.lastS);
      let d = c.h - pp.h;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const perfect = Math.abs(d) < PERFECT_LAND_RAD;
      if (perfect) giveBoost(c, t, PERFECT_LAND_BOOST_MS);
      ev.push({ k: "land", perfect });
    }
    return ev;
  }

  const p0 = project(track, c.x, c.z, c.seg);
  const surf = surfaceAt(track, p0);
  const spinning = t < c.spinUntil;
  const soap = surf === "soap";
  let vf = forwardSpeed(c);

  // 🌀 드리프트 시작·유지·끝
  if (spinning || t < c.stallUntil) endDrift(c, t, false, ev);
  else if (c.drift === 0) {
    if (inp.drift && vf > DRIFT_MIN_SPEED && Math.abs(inp.steer) > 0.3) {
      c.drift = inp.steer > 0 ? 1 : -1;
      c.driftMs = 0;
    }
  } else if (!inp.drift) endDrift(c, t, true, ev);
  else if (vf < DRIFT_MIN_SPEED * 0.55) endDrift(c, t, false, ev);
  else c.driftMs += dt * 1000;

  // 핸들
  if (!spinning) {
    let steer = Math.max(-1, Math.min(1, inp.steer));
    if (c.drift !== 0) steer = c.drift * (0.5 + 0.35 * Math.max(-1, Math.min(1, steer * c.drift)));
    const speedK = Math.min(1, Math.abs(vf) / TURN_FULL_SPEED) * (1 - TURN_HIGH_SPEED_LOSS * Math.min(1, Math.max(0, vf) / V_MAX));
    let rate = TURN * steer * speedK * (vf < 0 ? -1 : 1);
    if (soap) rate *= SOAP_TURN;
    if (c.drift !== 0) rate *= DRIFT_TURN_MULT;
    c.h += rate * dt;
    if (c.h > Math.PI) c.h -= Math.PI * 2;
    if (c.h < -Math.PI) c.h += Math.PI * 2;
  }

  // 새 방향 기준 앞/옆 속도
  const fx = Math.cos(c.h);
  const fz = Math.sin(c.h);
  vf = c.vx * fx + c.vz * fz;
  let vl = -c.vx * fz + c.vz * fx;
  const vt = targetSpeed(c, t, surf === "rug");
  if (inp.brake && !spinning) {
    if (vf > 0) vf = Math.max(0, vf - BRAKE * dt);
    else vf = Math.max(-REVERSE_MAX, vf - ACCEL * 0.6 * dt);
  } else if (vf < vt) vf = Math.min(vt, vf + ACCEL * (vf < 0 ? 2 : 1) * dt);
  else vf -= (vf - vt) * Math.min(1, OVERSPEED_DECAY * dt * (spinning ? 2.5 : 1));
  if (c.drift !== 0) vf *= 1 - DRIFT_SPEED_LOSS * dt;
  const grip = spinning ? 3 : c.drift !== 0 ? DRIFT_GRIP : soap ? SOAP_GRIP : GRIP;
  vl *= Math.exp(-grip * dt);
  c.vx = fx * vf - fz * vl;
  c.vz = fz * vf + fx * vl;

  c.x += c.vx * dt;
  c.z += c.vz * dt;
  const p = project(track, c.x, c.z, c.seg);
  walls(c, track, p, t, ev);
  obstacles(c, track, t, ev);
  const p2 = project(track, c.x, c.z, c.seg);
  c.y = p2.y;

  // 📚 점프대: 점프 자리를 앞으로 지나가면
  if (track.jumps.length > 0 && vf > JUMP_MIN_SPEED) {
    for (const j of track.jumps) {
      const before = wrapDelta(j.s - c.lastS, track.L);
      const after = wrapDelta(j.s - p2.s, track.L);
      if (before > 0 && after <= 0 && Math.abs(p2.lat) < track.w[p2.i]) {
        c.airFrom = t;
        c.airUntil = t + JUMP_BASE_MS + JUMP_PER_SPEED_MS * vf;
        c.airH = JUMP_H * Math.min(1.3, vf / V_MAX);
        endDrift(c, t, true, ev);
        ev.push({ k: "jump" });
        break;
      }
    }
  }
  progress(c, track, p2);
  // ↩ 반대 방향
  const sp = speedOf(c);
  const dot = sp > 1.5 ? (c.vx * track.tx[p2.i] + c.vz * track.tz[p2.i]) / sp : 1;
  c.wrongMs = dot < -0.35 ? c.wrongMs + dt * 1000 : 0;
  return ev;
}

/** 진행 거리 쌓기 (한 번에 25u 넘게 건너뛴 건 순간이동이라 안 친다) */
function progress(c: Car, track: Track, p: { s: number; i: number }) {
  const d = wrapDelta(p.s - c.lastS, track.L);
  if (Math.abs(d) < 25) c.dist += d;
  c.lastS = p.s;
  c.seg = p.i;
}

/** 🧱 울타리: 차 중심이 (도로 + 러그 − 차 반지름) 밖이면 안으로 밀고 튕긴다 */
function walls(c: Car, track: Track, p: { i: number; lat: number; s: number }, t: number, ev: CarEvent[]) {
  const side = p.lat >= 0 ? 1 : -1;
  const lim = latLimit(track, p.i, side);
  if (Math.abs(p.lat) <= lim) return;
  const nx = -track.tz[p.i];
  const nz = track.tx[p.i];
  const over = Math.abs(p.lat) - lim;
  c.x -= nx * side * over;
  c.z -= nz * side * over;
  const vn = (c.vx * nx + c.vz * nz) * side;
  if (vn > 0) {
    c.vx -= nx * side * vn * (1 + WALL_BOUNCE);
    c.vz -= nz * side * vn * (1 + WALL_BOUNCE);
    if (vn > 2.2) {
      c.vx *= WALL_SPEED_KEEP;
      c.vz *= WALL_SPEED_KEEP;
      if (c.drift !== 0) {
        c.drift = 0;
        c.driftMs = 0;
      }
      if (t - c.wallAt > 250) ev.push({ k: "wall", p: Math.round(vn * 10) / 10, x: c.x, z: c.z });
      c.wallAt = t;
    }
  }
}

/** 고정 장애물 (블록 탑·샴푸 통): 밀어내고 튕긴다 */
function obstacles(c: Car, track: Track, t: number, ev: CarEvent[]) {
  for (const o of track.obstacles) {
    if (Math.abs(c.y - (track.y[Math.round(o.s / track.ds) % track.n] ?? 0)) > 0.8) continue;
    const dx = c.x - o.x;
    const dz = c.z - o.z;
    const d = Math.hypot(dx, dz);
    const need = o.r + CAR_R;
    if (d >= need) continue;
    const nx = d > 1e-6 ? dx / d : 1;
    const nz = d > 1e-6 ? dz / d : 0;
    c.x = o.x + nx * need;
    c.z = o.z + nz * need;
    const vn = -(c.vx * nx + c.vz * nz);
    if (vn > 0) {
      c.vx += nx * vn * (1 + WALL_BOUNCE);
      c.vz += nz * vn * (1 + WALL_BOUNCE);
      if (vn > 3) {
        c.vx *= WALL_SPEED_KEEP;
        c.vz *= WALL_SPEED_KEEP;
        if (t - c.wallAt > 250) ev.push({ k: "obstacle", p: Math.round(vn * 10) / 10, x: c.x, z: c.z });
        c.wallAt = t;
      }
    }
  }
}

/** 차 두 대 부딪힘 (같은 무게 · 높이가 다르면 다리 위·아래라 안 부딪힘). 돌려주는 값 = 부딪힌 세기 */
export function collidePair(a: Car, b: Car, moveA = true, moveB = true): number {
  if (Math.abs(a.y - b.y) > 0.8) return 0;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  const rr = CAR_R * 2;
  if (d >= rr) return 0;
  const nx = d > 1e-6 ? dx / d : 1;
  const nz = d > 1e-6 ? dz / d : 0;
  const over = rr - d;
  const share = moveA && moveB ? 0.5 : 1;
  if (moveA) {
    a.x -= nx * over * share;
    a.z -= nz * over * share;
  }
  if (moveB) {
    b.x += nx * over * share;
    b.z += nz * over * share;
  }
  const vn = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
  if (vn <= 0) return 0;
  const J = vn * 0.6 * share;
  if (moveA) {
    a.vx -= nx * J;
    a.vz -= nz * J;
  }
  if (moveB) {
    b.vx += nx * J;
    b.vz += nz * J;
  }
  return vn;
}

/** 🔁 제자리로: 가장 가까운 길 가운데, 진행 방향으로 (진행 거리는 그대로) */
export function resetCar(c: Car, track: Track, t: number, ms: number) {
  const p = project(track, c.x, c.z, c.seg);
  const q = pointAt(track, p.s, Math.max(-1.5, Math.min(1.5, p.lat * 0.3)));
  Object.assign(c, { x: q.x, z: q.z, y: q.y, h: q.h, vx: 0, vz: 0, seg: q.i, drift: 0, driftMs: 0, airUntil: 0, airFrom: 0, resetUntil: t + ms, wrongMs: 0 } satisfies Partial<Car>);
  c.lastS = p.s;
}

/** 순간이동(방장 보정): 위치를 받아 트랙 위치를 다시 잡는다 */
export function placeCar(c: Car, track: Track, x: number, z: number, h: number) {
  const p = projectGlobal(track, x, z, c.y);
  c.x = x;
  c.z = z;
  c.h = h;
  c.seg = p.i;
  c.lastS = p.s;
  c.y = p.y;
}

/**
 * 💨 바람막이: 앞차가 (같은 높이로) 바로 앞 DRAFT_DIST 안, 옆으로 DRAFT_SIDE 안에 있으면 모은다.
 * `others` = 다른 차들의 위치. 돌려준 값을 c.draftMs로 쓴다.
 */
export function draftUpdate(c: Car, others: { x: number; z: number; y: number }[], dtMs: number): number {
  const fx = Math.cos(c.h);
  const fz = Math.sin(c.h);
  let behind = false;
  if (forwardSpeed(c) > 6) {
    for (const o of others) {
      if (Math.abs(o.y - c.y) > 0.8) continue;
      const dx = o.x - c.x;
      const dz = o.z - c.z;
      const ahead = dx * fx + dz * fz;
      const side = Math.abs(-dx * fz + dz * fx);
      if (ahead > 0.9 && ahead < 5.5 && side < 1.15) {
        behind = true;
        break;
      }
    }
  }
  if (behind) return Math.min(c.draftMs + dtMs, 3000);
  // 벗어나도 잠깐(0.4초)은 남는다: 다 모은 상태면 (모은 기준 + 0.4초)에서 깎아 내려간다
  if (c.draftMs < DRAFT_CHARGE_MS) return 0;
  const left = Math.min(c.draftMs, DRAFT_CHARGE_MS + 400) - dtMs;
  return left >= DRAFT_CHARGE_MS ? left : 0;
}

export { wrapS };
