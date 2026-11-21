/**
 * 택배 대란 창고 배치 (룰북 §2). 위에서 볼 때 x = 오른쪽, z = 아래(화면 아래쪽).
 *
 *   ┌─[트럭0]──[트럭1]──[트럭2]──[트럭3]─┐   ← 윗벽: 상하차 칸 (트럭이 오가는 곳)
 *   │ ═════ 🚜 지게차 길 (위) ══════════ │
 *   │ 🔍     [선반]          [선반]      │   ← 가운데 선반: 길을 나눈다 (던진 상자는 넘어감)
 *   │ ═════ 🚜 지게차 길 (아래) ════════ │
 *   │▶▶▶▶▶▶▶ 컨베이어 ▶▶▶▶▶▶▶▶▶▶[반송]│   ← 아랫벽: 왼쪽 구멍에서 상자가 나와 오른쪽 반송구로
 *   └─────────────────────────────────┘
 *
 * 인원수별 크기. 모든 수치는 결정적(난수 없음) — 같은 인원이면 같은 창고.
 */

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface Dock {
  /** 상하차 칸 (이 안에 맞는 상자를 들고 들어오면 실린다) */
  zone: Rect;
  x: number;
  z: number;
}

export interface Layout {
  W: number;
  H: number;
  docks: Dock[];
  belt: { x0: number; x1: number; z: number; hw: number };
  /** 반송구 (컨베이어 끝) */
  chute: Rect;
  racks: Rect[];
  scanner: { x: number; z: number; r: number };
  /** 지게차 길 (z) */
  lanes: number[];
  /** 몸이 못 지나가는 곳 (선반·컨베이어·반송구) */
  solids: Rect[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function layoutFor(seatCount: number): Layout {
  const n = Math.max(1, seatCount);
  const W = n <= 2 ? 18 : n <= 4 ? 22 : 25;
  const H = n <= 2 ? 12 : n <= 4 ? 13 : 14;
  const D = n <= 2 ? 3 : 4;
  const docks: Dock[] = [];
  const span = W - 6; // 왼쪽 스캐너 자리를 비우고 오른쪽으로
  for (let k = 0; k < D; k++) {
    const x = r2(-W / 2 + 4.2 + (span * (k + 0.5)) / D);
    const z0 = -H / 2;
    docks.push({ x, z: r2(z0 + 1.1), zone: { x0: r2(x - 1.5), x1: r2(x + 1.5), z0, z1: r2(z0 + 2.2) } });
  }
  const beltZ = r2(H / 2 - 1.1);
  const belt = { x0: -W / 2, x1: r2(W / 2 - 2.2), z: beltZ, hw: 0.55 };
  const chute: Rect = { x0: belt.x1, x1: W / 2, z0: r2(beltZ - 0.8), z1: H / 2 };
  const racks: Rect[] = [];
  const rz = 0.3;
  if (n <= 4) {
    const rw = W * 0.2;
    for (const cx of [-W * 0.14, W * 0.24]) racks.push({ x0: r2(cx - rw / 2), x1: r2(cx + rw / 2), z0: r2(rz - 0.45), z1: r2(rz + 0.45) });
  } else {
    const rw = W * 0.15;
    for (const cx of [-W * 0.2, W * 0.06, W * 0.32]) racks.push({ x0: r2(cx - rw / 2), x1: r2(cx + rw / 2), z0: r2(rz - 0.45), z1: r2(rz + 0.45) });
  }
  const beltRect: Rect = { x0: belt.x0, x1: belt.x1, z0: r2(beltZ - belt.hw), z1: r2(beltZ + belt.hw) };
  return {
    W,
    H,
    docks,
    belt,
    chute,
    racks,
    scanner: { x: r2(-W / 2 + 1.7), z: r2(-0.6), r: 1.05 },
    lanes: [r2(-H / 2 + 3.4), r2(H / 2 - 3.0)],
    solids: [...racks, beltRect, chute],
  };
}

export function inRect(r: Rect, x: number, z: number, pad = 0): boolean {
  return x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad;
}

/** 원(몸·상자)을 사각형 밖으로 밀어낸다. 밀었으면 밀린 방향(법선)을 돌려준다 */
export function pushOutRect(r: Rect, p: { x: number; z: number }, rad: number): { nx: number; nz: number } | null {
  const cx = Math.max(r.x0, Math.min(r.x1, p.x));
  const cz = Math.max(r.z0, Math.min(r.z1, p.z));
  const dx = p.x - cx;
  const dz = p.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= rad * rad) return null;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    p.x = cx + (dx / d) * rad;
    p.z = cz + (dz / d) * rad;
    return { nx: dx / d, nz: dz / d };
  }
  // 중심이 사각형 안: 가장 가까운 변으로
  const opts = [
    { d: p.x - r.x0, nx: -1, nz: 0 },
    { d: r.x1 - p.x, nx: 1, nz: 0 },
    { d: p.z - r.z0, nx: 0, nz: -1 },
    { d: r.z1 - p.z, nx: 0, nz: 1 },
  ].sort((a, b) => a.d - b.d)[0];
  if (opts.nx < 0) p.x = r.x0 - rad;
  else if (opts.nx > 0) p.x = r.x1 + rad;
  else if (opts.nz < 0) p.z = r.z0 - rad;
  else p.z = r.z1 + rad;
  return { nx: opts.nx, nz: opts.nz };
}

/** 벽 안으로 (몸 반지름만큼). 밀었으면 법선 */
export function clampWalls(L: Layout, p: { x: number; z: number }, rad: number): { nx: number; nz: number } | null {
  let hit: { nx: number; nz: number } | null = null;
  if (p.x < -L.W / 2 + rad) {
    p.x = -L.W / 2 + rad;
    hit = { nx: 1, nz: 0 };
  } else if (p.x > L.W / 2 - rad) {
    p.x = L.W / 2 - rad;
    hit = { nx: -1, nz: 0 };
  }
  if (p.z < -L.H / 2 + rad) {
    p.z = -L.H / 2 + rad;
    hit = { nx: 0, nz: 1 };
  } else if (p.z > L.H / 2 - rad) {
    p.z = L.H / 2 - rad;
    hit = { nx: 0, nz: -1 };
  }
  return hit;
}

/** 바닥에 놓을 수 있는 자리로 (선반·컨베이어 밖, 벽 안) */
export function clampFloor(L: Layout, x: number, z: number, rad: number): { x: number; z: number } {
  const p = { x, z };
  for (let it = 0; it < 3; it++) {
    for (const s of L.solids) pushOutRect(s, p, rad);
    clampWalls(L, p, rad);
  }
  return { x: r2(p.x), z: r2(p.z) };
}

/** 선분이 사각형을 지나가나 (pad만큼 키운 사각형) */
export function segHitsRect(r: Rect, x0: number, z0: number, x1: number, z1: number, pad = 0): boolean {
  const rx0 = r.x0 - pad;
  const rx1 = r.x1 + pad;
  const rz0 = r.z0 - pad;
  const rz1 = r.z1 + pad;
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dz = z1 - z0;
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return clip(-dx, x0 - rx0) && clip(dx, rx1 - x0) && clip(-dz, z0 - rz0) && clip(dz, rz1 - z0) && t0 <= t1;
}

/** 봇 길찾기: 목표까지 직선이 막혔으면 막은 사각형 모서리 하나를 거쳐 간다 */
export function nextWaypoint(L: Layout, x: number, z: number, tx: number, tz: number, pad = 0.75): { x: number; z: number } {
  let block: Rect | null = null;
  let best = Infinity;
  for (const s of L.solids) {
    if (!segHitsRect(s, x, z, tx, tz, pad - 0.2)) continue;
    const d = Math.hypot((s.x0 + s.x1) / 2 - x, (s.z0 + s.z1) / 2 - z);
    if (d < best) {
      best = d;
      block = s;
    }
  }
  if (!block) return { x: tx, z: tz };
  const corners = [
    { x: block.x0 - pad, z: block.z0 - pad },
    { x: block.x1 + pad, z: block.z0 - pad },
    { x: block.x0 - pad, z: block.z1 + pad },
    { x: block.x1 + pad, z: block.z1 + pad },
  ].filter((c) => c.x > -L.W / 2 + 0.45 && c.x < L.W / 2 - 0.45 && c.z > -L.H / 2 + 0.45 && c.z < L.H / 2 - 0.45);
  let pick: { x: number; z: number } | null = null;
  let pc = Infinity;
  for (const c of corners) {
    if (Math.hypot(c.x - x, c.z - z) < 0.3) continue;
    const open = !segHitsRect(block, x, z, c.x, c.z, pad - 0.35);
    const cost = Math.hypot(c.x - x, c.z - z) + Math.hypot(tx - c.x, tz - c.z) + (open ? 0 : 50);
    if (cost < pc) {
      pc = cost;
      pick = c;
    }
  }
  return pick ?? { x: tx, z: tz };
}
