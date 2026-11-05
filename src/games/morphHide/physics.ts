import { BOUNDS, type Solid } from "./map";

/**
 * 변신 숨바꼭질 — 걷기·점프·충돌. 모든 기기(내 캐릭터 예측)와 방장(봇·NPC)이 같은 함수를 쓴다.
 *
 * 규칙은 하나: 발 높이 + STEP보다 높이 솟은 상자는 벽, 그보다 낮은 상자는 밟고 올라선다.
 * 그래서 계단(단 0.3m)·낮은 울타리 점프·상자 파쿠르·지붕 걷기가 전부 같은 코드로 된다.
 */

export const STEP = 0.36;
export const GRAVITY = 16;
export const JUMP_V = 6.0; // 최고 약 1.12m
const SNAP_DOWN = 0.45;

export interface Body {
  x: number;
  y: number;
  z: number;
  vy: number;
  grounded: boolean;
  /** 몸 반지름 (변신한 모양마다 다름) */
  r: number;
  /** 키 */
  h: number;
}

export interface MoveIn {
  /** 월드 방향 (길이 ≤ 1) */
  dx: number;
  dz: number;
  jump: boolean;
}

/** 다른 몸 (사람·소품으로 변신한 플레이어, NPC) — 원기둥 */
export interface Cyl {
  x: number;
  z: number;
  y0: number;
  y1: number;
  r: number;
}

/** 정적 상자를 4m 칸에 나눠 담아 근처만 검사한다 */
export class SolidGrid {
  private cells = new Map<number, Solid[]>();
  readonly all: Solid[];
  private static readonly C = 4;
  constructor(solids: readonly Solid[]) {
    this.all = [...solids];
    for (const s of solids) this.insert(s);
  }
  private key(cx: number, cz: number) {
    return (cx + 100) * 1000 + (cz + 100);
  }
  private insert(s: Solid) {
    const C = SolidGrid.C;
    for (let cx = Math.floor(s.x0 / C); cx <= Math.floor(s.x1 / C); cx++) {
      for (let cz = Math.floor(s.z0 / C); cz <= Math.floor(s.z1 / C); cz++) {
        const k = this.key(cx, cz);
        let arr = this.cells.get(k);
        if (!arr) this.cells.set(k, (arr = []));
        arr.push(s);
      }
    }
  }
  /** (x, z) 주변 반경 r 안에 걸칠 수 있는 상자들 */
  near(x: number, z: number, r: number, out: Solid[]): Solid[] {
    out.length = 0;
    const C = SolidGrid.C;
    const seen = new Set<Solid>();
    for (let cx = Math.floor((x - r) / C); cx <= Math.floor((x + r) / C); cx++) {
      for (let cz = Math.floor((z - r) / C); cz <= Math.floor((z + r) / C); cz++) {
        const arr = this.cells.get(this.key(cx, cz));
        if (!arr) continue;
        for (const s of arr) {
          if (seen.has(s)) continue;
          seen.add(s);
          out.push(s);
        }
      }
    }
    return out;
  }
}

export interface CollWorld {
  grid: SolidGrid;
  /** 매 프레임 바뀌는 상자 (닫힌 문·창문·자동차) */
  dynamic: readonly Solid[];
  /** 다른 몸들 */
  bodies: readonly Cyl[];
}

const scratch: Solid[] = [];

function candidates(w: CollWorld, x: number, z: number, r: number): Solid[] {
  w.grid.near(x, z, r + 0.5, scratch);
  for (const d of w.dynamic) scratch.push(d);
  return scratch;
}

/** 원(몸 바닥)과 상자 바닥면이 겹치나 */
function circleRect(x: number, z: number, r: number, s: Solid): boolean {
  const cx = Math.max(s.x0, Math.min(x, s.x1));
  const cz = Math.max(s.z0, Math.min(z, s.z1));
  return (x - cx) ** 2 + (z - cz) ** 2 < r * r;
}

/** 발밑 높이: 지금 발 + STEP 이하로 올라온 상자 윗면 중 가장 높은 것 (없으면 땅 0) */
export function groundAt(w: CollWorld, x: number, z: number, y: number, r: number): number {
  let g = 0;
  const rr = r * 0.7;
  for (const s of candidates(w, x, z, r)) {
    if (s.y1 > y + STEP + 1e-6 || s.y1 <= g) continue;
    if (circleRect(x, z, rr, s)) g = s.y1;
  }
  for (const b of w.bodies) {
    if (b.y1 > y + STEP + 1e-6 || b.y1 <= g) continue;
    if ((b.x - x) ** 2 + (b.z - z) ** 2 < (b.r + rr * 0.6) ** 2) g = b.y1;
  }
  return g;
}

/** 수평으로 밀어내기 — 몸통 높이대(발+STEP ~ 머리)에 걸친 상자·몸에서 바깥으로 */
function pushOut(w: CollWorld, b: Body): void {
  const lo = b.y + STEP;
  const hi = b.y + b.h;
  for (let pass = 0; pass < 2; pass++) {
    for (const s of candidates(w, b.x, b.z, b.r)) {
      if (s.y1 <= lo + 1e-6 || s.y0 >= hi) continue;
      const cx = Math.max(s.x0, Math.min(b.x, s.x1));
      const cz = Math.max(s.z0, Math.min(b.z, s.z1));
      const dx = b.x - cx;
      const dz = b.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= b.r * b.r) continue;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2);
        b.x = cx + (dx / d) * b.r;
        b.z = cz + (dz / d) * b.r;
      } else {
        // 중심이 상자 안: 가장 얕은 쪽으로
        const pen = [b.x - s.x0 + b.r, s.x1 - b.x + b.r, b.z - s.z0 + b.r, s.z1 - b.z + b.r];
        const m = Math.min(...pen);
        if (m === pen[0]) b.x = s.x0 - b.r;
        else if (m === pen[1]) b.x = s.x1 + b.r;
        else if (m === pen[2]) b.z = s.z0 - b.r;
        else b.z = s.z1 + b.r;
      }
    }
    for (const o of w.bodies) {
      if (o.y1 <= lo + 1e-6 || o.y0 >= hi) continue;
      const dx = b.x - o.x;
      const dz = b.z - o.z;
      const min = b.r + o.r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min || d2 < 1e-10) continue;
      const d = Math.sqrt(d2);
      b.x = o.x + (dx / d) * min;
      b.z = o.z + (dz / d) * min;
    }
  }
  b.x = Math.max(BOUNDS.x0 + b.r, Math.min(BOUNDS.x1 - b.r, b.x));
  b.z = Math.max(BOUNDS.z0 + b.r, Math.min(BOUNDS.z1 - b.r, b.z));
}

/** 머리 위 천장 (지금 머리보다 위에서 시작하는 상자 중 가장 낮은 바닥) */
function ceilingAt(w: CollWorld, x: number, z: number, headY: number, r: number): number {
  let c = Infinity;
  const rr = r * 0.7;
  for (const s of candidates(w, x, z, r)) {
    if (s.y0 < headY - 1e-6 || s.y0 >= c) continue;
    if (circleRect(x, z, rr, s)) c = s.y0;
  }
  return c;
}

/**
 * 한 번 움직이기. `speed` m/s, `dt` 초 (길면 잘게 나눠서).
 * 반환: 실제로 움직인 거리(막혔는지 판단용)
 */
export function stepBody(b: Body, inp: MoveIn, speed: number, dt: number, w: CollWorld): number {
  const x0 = b.x;
  const z0 = b.z;
  let left = Math.min(dt, 0.1);
  let jumped = false;
  while (left > 1e-6) {
    const h = Math.min(left, 1 / 60);
    left -= h;
    // 수평
    b.x += inp.dx * speed * h;
    b.z += inp.dz * speed * h;
    pushOut(w, b);
    // 수직
    const g = groundAt(w, b.x, b.z, b.y, b.r);
    if (inp.jump && b.grounded && !jumped) {
      b.vy = JUMP_V;
      b.grounded = false;
      jumped = true;
    }
    if (b.grounded) {
      if (g >= b.y - SNAP_DOWN) {
        b.y = g;
        b.vy = 0;
      } else {
        b.grounded = false;
      }
    }
    if (!b.grounded) {
      const oldY = b.y;
      b.vy -= GRAVITY * h;
      b.y += b.vy * h;
      if (b.vy > 0) {
        const ceil = ceilingAt(w, b.x, b.z, oldY + b.h, b.r);
        if (b.y + b.h > ceil) {
          b.y = ceil - b.h;
          b.vy = 0;
        }
      }
      const g2 = groundAt(w, b.x, b.z, oldY, b.r);
      if (b.y <= g2) {
        b.y = g2;
        b.vy = 0;
        b.grounded = true;
      }
    }
  }
  return Math.hypot(b.x - x0, b.z - z0);
}

// ---------------------------------------------------------------------------
// 광선

export interface RayHit {
  t: number;
  solid?: Solid;
  /** bodies 인덱스 */
  body?: number;
}

/** 광선-상자 (slab). 맞으면 거리, 아니면 null */
export function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, max: number): number | null {
  let tmin = 0;
  let tmax = max;
  const axes: [number, number, number, number][] = [
    [ox, dx, x0, x1],
    [oy, dy, y0, y1],
    [oz, dz, z0, z1],
  ];
  for (const [o, d, a, b] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < a || o > b) return null;
      continue;
    }
    let t1 = (a - o) / d;
    let t2 = (b - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

export interface RayBody {
  x: number;
  y: number;
  z: number;
  /** 반폭 */
  r: number;
  h: number;
}

/** 가장 먼저 맞는 것 (상자 또는 몸). `skipSolid`이 참이면 그 상자는 지나간다(유리 등) */
export function raycast(
  solids: readonly Solid[],
  bodies: readonly RayBody[],
  o: readonly [number, number, number],
  d: readonly [number, number, number],
  max: number,
  skipSolid?: (s: Solid) => boolean,
): RayHit | null {
  let best: RayHit | null = null;
  let bt = max;
  for (const s of solids) {
    if (skipSolid?.(s)) continue;
    const t = rayBox(o[0], o[1], o[2], d[0], d[1], d[2], s.x0, s.x1, s.y0, s.y1, s.z0, s.z1, bt);
    if (t !== null && t < bt) {
      bt = t;
      best = { t, solid: s };
    }
  }
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    const t = rayBox(o[0], o[1], o[2], d[0], d[1], d[2], b.x - b.r, b.x + b.r, b.y, b.y + b.h, b.z - b.r, b.z + b.r, bt);
    if (t !== null && t < bt) {
      bt = t;
      best = { t, body: i };
    }
  }
  return best;
}

/** 두 점 사이가 벽에 가리지 않았나 (봇 시야) */
export function lineOfSight(solids: readonly Solid[], a: readonly [number, number, number], b: readonly [number, number, number]): boolean {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  const d: [number, number, number] = [dx / len, dy / len, dz / len];
  for (const s of solids) {
    if (s.k === "prop" || s.k === "glass" || s.k === "car") continue;
    if (rayBox(a[0], a[1], a[2], d[0], d[1], d[2], s.x0, s.x1, s.y0, s.y1, s.z0, s.z1, len - 0.05) !== null) return false;
  }
  return true;
}
