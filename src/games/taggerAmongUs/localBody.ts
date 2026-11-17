import { BODY_R, DOOR_RANGE, LUNGE_SPEED, RECOVER_MUL, SLOW_MUL, SPEED_CROUCH, SPEED_RUN, SPEED_WALK, STAMINA_DRAIN, STAMINA_MIN_RUN, STAMINA_REGEN, SWING_MS, TAG_SPEED, THAW_RANGE, USE_RANGE, type MoveMode } from "./data";
import { DOORS, SPOTS, clearLine, collide } from "./map";
import type { Snap } from "./net";
import type { PosReport } from "./sim";

/**
 * 내 몸 — 이 기기가 직접 움직인다 (입력 지연 없는 1인칭). 화면(SchoolScene)이 매 프레임 `stepLocal`을
 * 부르고, 방 컴포넌트가 0.1초마다 `reportOf`를 방장에게 보낸다. 리액트 상태가 아니라 ref 하나에 담는다.
 *
 * 도망자·변장한 술래는 같은 몸(앉기·걷기·달리기·체력)이고, 가면을 쓴 술래는 늘 `TAG_SPEED`로 움직이며
 * 덮치는 동안(`SWING_MS`) 보는 쪽으로 돌진한다.
 */

export type TargetKind = "seal" | "kick" | "thaw" | "door";

export interface Target {
  /** 방장에게 보내는 대상: s3 봉인 · k3 훼손 · t2 얼음 녹이기 / 문은 d5 */
  id: string;
  kind: TargetKind;
  /** 누르고 있어야 하나 (문은 한 번 톡) */
  hold: boolean;
  n: number;
}

export interface LocalBody {
  seed: number;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  /** 입력: 오른쪽(+x)·앞(+z) -1~1 */
  mx: number;
  mz: number;
  wantRun: boolean;
  cr: boolean;
  light: boolean;
  wantUse: boolean;
  stamina: number;
  /** 다 떨어져서 쉬는 중 */
  winded: boolean;
  mv: MoveMode;
  target: Target | null;
  use: string | null;
  /** 걸음 흔들림 위상 · 다음 발소리 */
  bob: number;
  stepAt: number;
  /** 화면 흔들림 (얼음·소금) */
  shake: number;
  /** 술래: 내가 덮치기를 누른 시각(performance.now) — 방장 답을 기다리지 않고 바로 돌진한다 */
  lungeUntil: number;
  /** 관전 대상 자리 */
  spectate: number;
  onStep: ((mode: MoveMode) => void) | null;
}

export function createLocal(): LocalBody {
  return { seed: -1, x: 0, z: 0, yaw: 0, pitch: 0, mx: 0, mz: 0, wantRun: false, cr: false, light: true, wantUse: false, stamina: 100, winded: false, mv: 0, target: null, use: null, bob: 0, stepAt: 0, shake: 0, lungeUntil: 0, spectate: -1, onStep: null };
}

/** 새 판이면 시작 자리로 */
export function syncLocal(b: LocalBody, snap: Snap, seat: number) {
  if (b.seed === snap.seed) return;
  const p = snap.players[seat];
  if (!p) return;
  b.seed = snap.seed;
  b.x = p.x;
  b.z = p.z;
  b.yaw = p.yaw;
  b.pitch = 0;
  b.cr = false;
  b.light = true;
  b.stamina = 100;
  b.winded = false;
  b.mv = 0;
  b.use = null;
  b.target = null;
  b.lungeUntil = 0;
  b.spectate = -1;
}

function angleTo(b: LocalBody, x: number, z: number): number {
  const want = Math.atan2(-(x - b.x), -(z - b.z));
  let d = want - b.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

/** 지금 바라보는 상호작용 대상 */
export function findTarget(b: LocalBody, snap: Snap, seat: number): Target | null {
  const me = snap.players[seat];
  if (!me || me.st !== "alive") return null;
  const tagger = me.role === "tagger";
  const form = snap.tg.form;
  if (tagger && (form === "on" || form === "off")) return null;
  const masked = tagger && form === "mask";
  let best: Target | null = null;
  let bs = Infinity;
  const consider = (t: Target, x: number, z: number, range: number, cone: number, bias = 0) => {
    const d = Math.hypot(x - b.x, z - b.z);
    if (d > range) return;
    const a = d < 0.6 ? 0 : angleTo(b, x, z);
    if (a > cone) return;
    const sc = a * 2 + d * 0.35 + bias;
    if (sc < bs) {
      bs = sc;
      best = t;
    }
  };
  if (!tagger) for (const q of snap.players) if (q.seat !== seat && q.st === "frozen") consider({ id: `t${q.seat}`, kind: "thaw", hold: true, n: q.seat }, q.x, q.z, THAW_RANGE, 1.4, -1);
  snap.spots.forEach((sp, k) => {
    if (sp.done) return;
    const def = SPOTS[sp.i];
    if (masked) {
      if (sp.p > 0) consider({ id: `k${k}`, kind: "kick", hold: true, n: k }, def.x, def.z, USE_RANGE, 1.0, -0.3);
    } else consider({ id: `s${k}`, kind: "seal", hold: true, n: k }, def.x, def.z, USE_RANGE, 1.0, -0.3);
  });
  for (const d of DOORS) {
    // 가면 쓴 술래는 닫힌 문만 (부순다)
    if (masked && snap.doors[d.i]) continue;
    consider({ id: `d${d.i}`, kind: "door", hold: false, n: d.i }, d.x, d.z, DOOR_RANGE, 0.8, 0.4);
  }
  const t = best as Target | null;
  if (t && (t.kind === "seal" || t.kind === "kick")) {
    // 벽 너머 장승은 못 만진다
    const def = SPOTS[snap.spots[t.n].i];
    if (!clearLine(b.x, b.z, def.x + (b.x - def.x) * 0.35, def.z + (b.z - def.z) * 0.35, snap.doors)) return null;
  }
  return t;
}

/** 한 프레임: 입력대로 걷고, 벽에서 밀려나고, 바라보는 대상을 고른다 */
export function stepLocal(b: LocalBody, snap: Snap, seat: number, dt: number, now: number) {
  const me = snap.players[seat];
  if (!me) return;
  if (me.st !== "alive") {
    b.mv = 0;
    b.use = null;
    b.target = null;
    if (me.st === "frozen") {
      b.x = me.x;
      b.z = me.z;
    }
    return;
  }
  const tagger = me.role === "tagger";
  const tg = snap.tg;
  const masked = tagger && tg.form === "mask";
  const rooted = tagger && (tg.form === "on" || tg.form === "off" || snap.t < tg.stunUntil);
  if (rooted) {
    b.mv = 0;
    b.use = null;
    b.target = null;
    b.lungeUntil = 0;
    return;
  }

  let mx = b.mx;
  let mz = b.mz;
  const l = Math.hypot(mx, mz);
  if (l > 1) {
    mx /= l;
    mz /= l;
  }
  let moving = l > 0.12;
  let mode: MoveMode;
  let speed: number;
  if (masked) {
    const lunging = now < b.lungeUntil || snap.t < tg.swingUntil;
    if (lunging) {
      // 덮치기: 보는 쪽으로 곧장
      mx = 0;
      mz = 1;
      moving = true;
      speed = LUNGE_SPEED;
    } else speed = TAG_SPEED * (snap.t < tg.recoverUntil ? RECOVER_MUL : 1) * Math.min(1, l);
    mode = moving ? 3 : 0;
    b.stamina = 100;
    b.winded = false;
  } else {
    // 달리기: 앞으로 갈 때만, 앉은 채로는 못 달린다
    if (b.winded && b.stamina >= STAMINA_MIN_RUN) b.winded = false;
    const run = moving && b.wantRun && !b.cr && !b.winded && mz > 0.3 && b.stamina > 0;
    mode = !moving ? 0 : b.cr ? 1 : run ? 3 : 2;
    if (mode === 3) {
      b.stamina = Math.max(0, b.stamina - STAMINA_DRAIN * dt);
      if (b.stamina <= 0) b.winded = true;
    } else b.stamina = Math.min(100, b.stamina + STAMINA_REGEN * dt);
    speed = (mode === 3 ? SPEED_RUN : mode === 2 ? SPEED_WALK : SPEED_CROUCH) * (snap.t < me.slowUntil ? SLOW_MUL : 1) * Math.min(1, l);
  }
  // 무언가 붙들고 있으면 못 움직인다 (손을 떼면 풀린다)
  const holding = b.use !== null;
  if (holding) speed = 0;
  if (moving && speed > 0) {
    const fx = -Math.sin(b.yaw);
    const fz = -Math.cos(b.yaw);
    const rx = Math.cos(b.yaw);
    const rz = -Math.sin(b.yaw);
    const pos = { x: b.x + (fx * mz + rx * mx) * speed * dt, z: b.z + (fz * mz + rz * mx) * speed * dt };
    collide(pos, snap.doors, BODY_R);
    const moved = Math.hypot(pos.x - b.x, pos.z - b.z);
    b.x = pos.x;
    b.z = pos.z;
    b.bob += moved * (mode === 3 ? 2.1 : 2.6);
    if (now >= b.stepAt && moved > 0.001) {
      b.stepAt = now + (mode === 3 ? 290 : mode === 2 ? 470 : 640);
      b.onStep?.(mode);
    }
  }
  b.mv = holding ? 0 : mode;
  b.target = findTarget(b, snap, seat);
  const t = b.target;
  b.use = b.wantUse && t && t.hold ? t.id : null;
}

/** 술래가 덮치기를 눌렀다 — 방장 답을 기다리지 않고 바로 돌진 */
export function startLunge(b: LocalBody, now: number) {
  b.lungeUntil = now + SWING_MS;
  b.use = null;
  b.wantUse = false;
}

export function reportOf(b: LocalBody): PosReport {
  const r = (v: number) => Math.round(v * 100) / 100;
  return { x: r(b.x), z: r(b.z), yaw: r(b.yaw), pitch: r(b.pitch), mv: b.mv, cr: b.cr, light: b.light, use: b.use };
}
