import { BODY_R, DOOR_RANGE, REVIVE_RANGE, SPEED_CROUCH, SPEED_RUN, SPEED_WALK, STAMINA_DRAIN, STAMINA_MIN_RUN, STAMINA_REGEN, USE_RANGE, type MoveMode } from "./data";
import { ALTAR, CONTAINERS, DOORS, FURNITURE, clearLine, collide } from "./map";
import type { Snap } from "./net";
import type { PosReport } from "./sim";

/**
 * 내 몸 — 이 기기가 직접 움직인다 (입력 지연 없는 1인칭). 화면(WardScene)이 매 프레임 `stepLocal`을
 * 부르고, 방 컴포넌트가 0.1초마다 `reportOf`를 방장에게 보낸다. 리액트 상태가 아니라 ref 하나에 담는다.
 */

export type TargetKind = "search" | "altar" | "revive" | "door";

export interface Target {
  /** 방장에게 보내는 대상: c12 · a · r2 / 문은 d5 */
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
  hb: boolean;
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
  steps: number;
  /** 화면 흔들림 (붙잡힘·비명) */
  shake: number;
  /** 점프 스케어: 이 시각까지 귀신을 강제로 본다 */
  scareUntil: number;
  /** 관전 대상 자리 */
  spectate: number;
  onStep: ((mode: MoveMode) => void) | null;
}

export function createLocal(): LocalBody {
  return { seed: -1, x: 0, z: 0, yaw: 0, pitch: 0, mx: 0, mz: 0, wantRun: false, cr: false, hb: false, light: true, wantUse: false, stamina: 100, winded: false, mv: 0, target: null, use: null, bob: 0, stepAt: 0, steps: 0, shake: 0, scareUntil: 0, spectate: -1, onStep: null };
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
  b.hb = false;
  b.light = true;
  b.stamina = 100;
  b.winded = false;
  b.mv = 0;
  b.use = null;
  b.target = null;
  b.scareUntil = 0;
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
  for (const q of snap.players) if (q.seat !== seat && q.st === "down") consider({ id: `r${q.seat}`, kind: "revive", hold: true, n: q.seat }, q.x, q.z, REVIVE_RANGE, 1.4, -1);
  if (me.tal > 0 && snap.placed < snap.need) consider({ id: "a", kind: "altar", hold: true, n: 0 }, ALTAR.x, ALTAR.z, USE_RANGE, 1.0, -0.5);
  for (const c of CONTAINERS) {
    if (snap.searched[c.i]) continue;
    const f = FURNITURE.find((it) => it.container === c.i);
    consider({ id: `c${c.i}`, kind: "search", hold: true, n: c.i }, f?.x ?? c.x, f?.z ?? c.z, USE_RANGE, 0.95);
  }
  for (const d of DOORS) consider({ id: `d${d.i}`, kind: "door", hold: false, n: d.i }, d.x, d.z, DOOR_RANGE, 0.8, 0.4);
  const t = best as Target | null;
  if (t && t.kind !== "door" && t.kind !== "revive") {
    // 벽 너머 서랍은 못 뒤진다
    const pos = t.kind === "altar" ? ALTAR : CONTAINERS[t.n];
    const f = t.kind === "search" ? FURNITURE.find((it) => it.container === t.n) : null;
    const tx = f ? f.x + (b.x - f.x) * 0.35 : pos.x + (b.x - pos.x) * 0.35;
    const tz = f ? f.z + (b.z - f.z) * 0.35 : pos.z + (b.z - pos.z) * 0.35;
    if (!clearLine(b.x, b.z, tx, tz, snap.doors)) return null;
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
    b.hb = false;
    if (me.st === "down") {
      b.x = me.x;
      b.z = me.z;
    }
    return;
  }
  const scared = now < b.scareUntil;
  let mx = scared ? 0 : b.mx;
  let mz = scared ? 0 : b.mz;
  const l = Math.hypot(mx, mz);
  if (l > 1) {
    mx /= l;
    mz /= l;
  }
  const moving = l > 0.12;
  // 달리기: 앞으로 갈 때만, 앉거나 숨 참는 중에는 못 달린다
  if (b.winded && b.stamina >= STAMINA_MIN_RUN) b.winded = false;
  const run = moving && b.wantRun && !b.cr && !b.hb && !b.winded && mz > 0.3 && b.stamina > 0;
  const mode: MoveMode = !moving ? 0 : b.cr ? 1 : run ? 3 : 2;
  if (mode === 3) {
    b.stamina = Math.max(0, b.stamina - STAMINA_DRAIN * dt);
    if (b.stamina <= 0) b.winded = true;
  } else b.stamina = Math.min(100, b.stamina + STAMINA_REGEN * dt);
  // 무언가 붙들고 있으면 느리게만 움직인다 (손을 떼면 풀린다)
  const holding = b.use !== null;
  const speed = (mode === 3 ? SPEED_RUN : mode === 2 ? SPEED_WALK : SPEED_CROUCH) * (holding ? 0 : 1) * Math.min(1, l);
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
      b.steps++;
      b.onStep?.(mode);
    }
  }
  b.mv = holding ? 0 : mode;
  b.target = findTarget(b, snap, seat);
  const t = b.target;
  b.use = b.wantUse && t && t.hold ? t.id : null;
}

export function reportOf(b: LocalBody): PosReport {
  const r = (v: number) => Math.round(v * 100) / 100;
  return { x: r(b.x), z: r(b.z), yaw: r(b.yaw), pitch: r(b.pitch), mv: b.mv, cr: b.cr, hb: b.hb, light: b.light, use: b.use };
}
