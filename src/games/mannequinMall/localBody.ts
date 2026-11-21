import { BACK_MUL, BIND_RANGE, BODY_R, REVIVE_RANGE, SPEED_RUN, SPEED_WALK, STAMINA_DRAIN, STAMINA_MIN_RUN, STAMINA_REGEN, USE_RANGE, type MoveMode } from "./data";
import { CONTAINERS, FURNITURE, PANEL, clearLine, collide } from "./map";
import type { Snap } from "./net";
import { sees, type PlayerState, type PosReport } from "./sim";

/**
 * 내 몸 — 이 기기가 직접 움직인다 (입력 지연 없는 1인칭). 화면(MallScene)이 매 프레임 `stepLocal`을
 * 부르고, 방 컴포넌트가 0.1초마다 `reportOf`를 방장에게 보낸다. 리액트 상태가 아니라 ref 하나에 담는다.
 */

export type TargetKind = "search" | "panel" | "revive" | "bind";

export interface Target {
  /** 방장에게 보내는 대상: c12 · p · r2 · m5 */
  id: string;
  kind: TargetKind;
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
  light: boolean;
  wantUse: boolean;
  stamina: number;
  winded: boolean;
  mv: MoveMode;
  target: Target | null;
  use: string | null;
  bob: number;
  stepAt: number;
  shake: number;
  /** 붙잡힘 연출: 이 시각까지 마네킹 쪽을 강제로 본다 */
  scareUntil: number;
  scareAt: { x: number; z: number } | null;
  spectate: number;
  onStep: ((mode: MoveMode) => void) | null;
}

export function createLocal(): LocalBody {
  return { seed: -1, x: 0, z: 0, yaw: 0, pitch: 0, mx: 0, mz: 0, wantRun: false, light: true, wantUse: false, stamina: 100, winded: false, mv: 0, target: null, use: null, bob: 0, stepAt: 0, shake: 0, scareUntil: 0, scareAt: null, spectate: -1, onStep: null };
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

/** 내 기기 기준 "지금 내 눈" (방장 판정과 같은 식) */
export function myEyes(b: LocalBody, me: PlayerState): PlayerState {
  return { ...me, x: b.x, z: b.z, yaw: b.yaw, pitch: b.pitch, light: b.light && me.battery > 0 };
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
  for (const q of snap.players) if (q.seat !== seat && q.st === "down") consider({ id: `r${q.seat}`, kind: "revive", n: q.seat }, q.x, q.z, REVIVE_RANGE, 1.3, -1);
  if (me.fuses > 0 && snap.placed < snap.need) consider({ id: "p", kind: "panel", n: 0 }, PANEL.x, PANEL.z, USE_RANGE, 1.0, -0.5);
  for (const c of CONTAINERS) {
    if (snap.searched[c.i]) continue;
    const f = FURNITURE.find((it) => it.container === c.i);
    consider({ id: `c${c.i}`, kind: "search", n: c.i }, f?.x ?? c.x, f?.z ?? c.z, USE_RANGE, 0.95);
  }
  if (me.ribbons > 0) for (const m of snap.mannequins) if (snap.t >= m.boundUntil) consider({ id: `m${m.id}`, kind: "bind", n: m.id }, m.x, m.z, BIND_RANGE, 0.6, 0.2);
  const t = best as Target | null;
  if (t && t.kind === "search") {
    const f = FURNITURE.find((it) => it.container === t.n);
    if (f && !clearLine(b.x, b.z, f.x + (b.x - f.x) * 0.4, f.z + (b.z - f.z) * 0.4)) return null;
  }
  return t;
}

/** 한 프레임: 입력대로 걷고, 벽·마네킹에서 밀려나고, 바라보는 대상을 고른다 */
export function stepLocal(b: LocalBody, snap: Snap, seat: number, dt: number, now: number) {
  const me = snap.players[seat];
  if (!me) return;
  if (me.st !== "alive") {
    b.mv = 0;
    b.use = null;
    b.target = null;
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
  if (b.winded && b.stamina >= STAMINA_MIN_RUN) b.winded = false;
  const run = moving && b.wantRun && !b.winded && mz > 0.3 && b.stamina > 0;
  const mode: MoveMode = !moving ? 0 : run ? 3 : 2;
  if (mode === 3) {
    b.stamina = Math.max(0, b.stamina - STAMINA_DRAIN * dt);
    if (b.stamina <= 0) b.winded = true;
  } else b.stamina = Math.min(100, b.stamina + STAMINA_REGEN * dt);
  const holding = b.use !== null;
  const back = mz < -0.2 ? BACK_MUL : 1;
  const speed = (mode === 3 ? SPEED_RUN : SPEED_WALK) * back * (holding ? 0 : 1) * Math.min(1, l);
  if (moving && speed > 0) {
    const fx = -Math.sin(b.yaw);
    const fz = -Math.cos(b.yaw);
    const rx = Math.cos(b.yaw);
    const rz = -Math.sin(b.yaw);
    const pos = { x: b.x + (fx * mz + rx * mx) * speed * dt, z: b.z + (fz * mz + rz * mx) * speed * dt };
    collide(pos, BODY_R, snap.mannequins);
    const moved = Math.hypot(pos.x - b.x, pos.z - b.z);
    b.x = pos.x;
    b.z = pos.z;
    b.bob += moved * (mode === 3 ? 2.1 : 2.6);
    if (now >= b.stepAt && moved > 0.001) {
      b.stepAt = now + (mode === 3 ? 290 : 470);
      b.onStep?.(mode);
    }
  }
  b.mv = holding ? 0 : mode;
  b.target = findTarget(b, snap, seat);
  const t = b.target;
  b.use = b.wantUse && t ? t.id : null;
}

/** 이 기기 기준으로 지금 이 마네킹을 내가 보고 있나 (화면에서 "보는 동안 안 움직이게" 붙드는 데 쓴다) */
export function iSee(b: LocalBody, snap: Snap, seat: number, x: number, z: number): boolean {
  const me = snap.players[seat];
  if (!me || me.st !== "alive") return false;
  return sees(snap, myEyes(b, me), x, z);
}

export function reportOf(b: LocalBody): PosReport {
  const r = (v: number) => Math.round(v * 100) / 100;
  return { x: r(b.x), z: r(b.z), yaw: r(b.yaw), pitch: r(b.pitch), mv: b.mv, light: b.light, use: b.use };
}
