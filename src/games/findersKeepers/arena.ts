/**
 * 만지면 내 꺼! 무대 — 문 닫기 직전 장난감 백화점의 둥근 중앙 홀. 둘레는 낮은 담(떨어짐 없음).
 *
 * 인원수별 크기(룰북 §2). 바구니는 홀 둘레에 고르게, 진열대는 바구니 사이에 — 모든 배치가 회전 대칭이라
 * 어느 자리에서 시작해도 같은 지형이다. 중간·큰 홀에는 가운데를 도는 무빙워크 고리가 있다.
 */

export interface Circle {
  x: number;
  z: number;
  r: number;
}

export interface Walkway {
  r0: number;
  r1: number;
  /** +면 반시계(위에서 볼 때) */
  speed: number;
}

export interface HallGeo {
  size: "small" | "mid" | "large";
  /** 홀 반지름 — 몸 중심은 이 안(담)에 갇힌다 */
  radius: number;
  walkway: Walkway | null;
}

export const STAND_R = 0.9;
export const TOY_R = 0.28;

export function hallFor(players: number): HallGeo {
  if (players <= 3) return { size: "small", radius: 9, walkway: null };
  if (players <= 5) return { size: "mid", radius: 11, walkway: { r0: 4.2, r1: 5.4, speed: 1 } };
  return { size: "large", radius: 13, walkway: { r0: 5.2, r1: 6.4, speed: 1 } };
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** 바구니 자리 (중심) — 홀 둘레 안쪽 1.9m */
export function basketSpots(radius: number, n: number, rot: number): { x: number; z: number; a: number }[] {
  const R = radius - 1.9;
  return Array.from({ length: n }, (_, k) => {
    const a = rot + (k / n) * Math.PI * 2;
    return { x: r3(Math.cos(a) * R), z: r3(Math.sin(a) * R), a };
  });
}

/** 진열대: 바구니 사이 각도, 반지름 62% (큰 홀은 안쪽 고리도) */
export function standSpots(geo: HallGeo, sectors: number, rot: number): Circle[] {
  const out: Circle[] = [];
  const n = Math.max(3, sectors);
  for (let k = 0; k < n; k++) {
    const a = rot + ((k + 0.5) / n) * Math.PI * 2;
    out.push({ x: r3(Math.cos(a) * geo.radius * 0.62), z: r3(Math.sin(a) * geo.radius * 0.62), r: STAND_R });
  }
  if (geo.size === "small") {
    // 작은 홀: 가운데 진열대 하나 (선물 상자 주위를 빙빙)
    out.push({ x: 0, z: 0, r: 0.7 });
  }
  return out;
}

/** 점이 진열대에 박혔으면 밖으로 + 담 안으로 */
export function clampSpot(radius: number, stands: Circle[], x: number, z: number, pad: number): { x: number; z: number } {
  let px = x;
  let pz = z;
  for (let it = 0; it < 4; it++) {
    for (const c of stands) {
      const d = Math.hypot(px - c.x, pz - c.z);
      const need = c.r + pad;
      if (d < need) {
        const nx = d > 1e-6 ? (px - c.x) / d : 1;
        const nz = d > 1e-6 ? (pz - c.z) / d : 0;
        px = c.x + nx * need;
        pz = c.z + nz * need;
      }
    }
    const r = Math.hypot(px, pz);
    const lim = radius - pad;
    if (r > lim) {
      px *= lim / r;
      pz *= lim / r;
    }
  }
  return { x: px, z: pz };
}

/** 두 점 사이 직선이 진열대에 막히나 */
export function blockedByStand(stands: Circle[], x0: number, z0: number, x1: number, z1: number, pad = 0): boolean {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const L2 = dx * dx + dz * dz;
  if (L2 < 1e-6) return false;
  for (const p of stands) {
    const u = Math.max(0, Math.min(1, ((p.x - x0) * dx + (p.z - z0) * dz) / L2));
    if (Math.hypot(x0 + dx * u - p.x, z0 + dz * u - p.z) < p.r + pad) return true;
  }
  return false;
}

/** 무빙워크 위면 그 자리의 밀림 속도 (접선 방향) */
export function walkwayPush(geo: HallGeo, x: number, z: number, speed: number): { vx: number; vz: number } | null {
  const w = geo.walkway;
  if (!w) return null;
  const r = Math.hypot(x, z);
  if (r < w.r0 || r > w.r1 || r < 1e-6) return null;
  // 반시계(+): (-z, x)/r
  return { vx: (-z / r) * speed * w.speed, vz: (x / r) * speed * w.speed };
}
