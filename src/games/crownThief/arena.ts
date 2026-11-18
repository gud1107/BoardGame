/**
 * 왕관 도둑 광장 — 하늘에 뜬 둥근 왕궁 안뜰. 가장자리 밖은 구름 아래로 떨어진다.
 *
 * 인원수별로 크기와 배치가 다르다(룰북 §4). 모든 배치는 원점 대칭이라 어느 자리에서 시작해도 같은 지형.
 * - 🏛 기둥: 지나갈 수 없는 원기둥 (빙빙 돌며 버티기)
 * - 🌳 덤불: 지나갈 수 있는 수풀 — 안에 들어가면 이름표가 숨는다 (왕관 빛은 새어 나옴)
 * - 🌀 점프대: 짝꿍 점프대 쪽으로 붕 날아간다 (공중에선 뺏기도 뺏기지도 않음)
 * 가운데(반지름 2m)는 늘 비워 둔다 — 왕관이 떨어지는 자리.
 */

export interface Circle {
  x: number;
  z: number;
  r: number;
}

export interface Pad extends Circle {
  /** 날아가 내려앉는 곳 (짝꿍 점프대보다 안쪽) */
  tx: number;
  tz: number;
  /** 짝꿍 점프대 번호 */
  pair: number;
}

export interface ArenaGeo {
  size: "small" | "mid" | "large";
  /** 광장 반지름 — 몸 중심이 이 밖으로 나가면 떨어진다 */
  radius: number;
  pillars: Circle[];
  bushes: Circle[];
  pads: Pad[];
}

export const PILLAR_R = 0.75;
export const BUSH_R = 1.45;
export const PAD_RADIUS = 0.75;
/** 가운데 비워 두는 반지름 */
export const CENTER_CLEAR = 2;

const cache = new Map<number, ArenaGeo>();

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function ring(n: number, frac: number, R: number, r: number, offsetDeg: number): Circle[] {
  return Array.from({ length: n }, (_, k) => {
    const a = ((offsetDeg + (k * 360) / n) * Math.PI) / 180;
    return { x: r3(Math.cos(a) * R * frac), z: r3(Math.sin(a) * R * frac), r };
  });
}

/** anglesDeg = [a0, b0, a1, b1, ...] — 두 개씩 짝꿍 */
function padPairs(anglesDeg: number[], frac: number, R: number): Pad[] {
  return anglesDeg.map((deg, k) => {
    const a = (deg * Math.PI) / 180;
    const pair = k % 2 === 0 ? k + 1 : k - 1;
    const b = (anglesDeg[pair] * Math.PI) / 180;
    // 짝꿍 점프대보다 1.4m 안쪽에 내려앉는다 (다시 점프대에 안 올라서게)
    const land = R * frac - PAD_RADIUS - 1.4;
    return { x: r3(Math.cos(a) * R * frac), z: r3(Math.sin(a) * R * frac), r: PAD_RADIUS, tx: r3(Math.cos(b) * land), tz: r3(Math.sin(b) * land), pair };
  });
}

export function arenaFor(players: number): ArenaGeo {
  const key = players <= 3 ? 3 : players <= 5 ? 5 : 8;
  const hit = cache.get(key);
  if (hit) return hit;
  let geo: ArenaGeo;
  if (key === 3) {
    const R = 8.5;
    geo = { size: "small", radius: R, pillars: ring(4, 0.48, R, PILLAR_R, 45), bushes: ring(2, 0.74, R, BUSH_R, 0), pads: padPairs([90, 270], 0.74, R) };
  } else if (key === 5) {
    const R = 10.5;
    geo = { size: "mid", radius: R, pillars: ring(6, 0.46, R, PILLAR_R, 0), bushes: ring(3, 0.76, R, BUSH_R, 0), pads: padPairs([90, 270], 0.76, R) };
  } else {
    const R = 12.5;
    geo = {
      size: "large",
      radius: R,
      pillars: [...ring(6, 0.4, R, PILLAR_R, 0), ...ring(6, 0.64, R, PILLAR_R, 30)],
      bushes: ring(4, 0.8, R, BUSH_R, 45),
      pads: padPairs([0, 180, 120, 300], 0.84, R),
    };
  }
  cache.set(key, geo);
  return geo;
}

/** 이 점이 덤불 안인가 */
export function inBush(geo: ArenaGeo, x: number, z: number): boolean {
  return geo.bushes.some((b) => Math.hypot(b.x - x, b.z - z) < b.r - 0.15);
}

/** 이 점에서 가장 가까운 기둥 표면까지 거리 (음수면 안쪽) */
export function pillarGap(geo: ArenaGeo, x: number, z: number): number {
  let best = Infinity;
  for (const p of geo.pillars) best = Math.min(best, Math.hypot(p.x - x, p.z - z) - p.r);
  return best;
}

/** 두 점 사이 직선이 기둥에 막히나 */
export function blockedByPillar(geo: ArenaGeo, x0: number, z0: number, x1: number, z1: number, pad = 0): boolean {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const L2 = dx * dx + dz * dz;
  if (L2 < 1e-6) return false;
  for (const p of geo.pillars) {
    const u = Math.max(0, Math.min(1, ((p.x - x0) * dx + (p.z - z0) * dz) / L2));
    if (Math.hypot(x0 + dx * u - p.x, z0 + dz * u - p.z) < p.r + pad) return true;
  }
  return false;
}
