/**
 * 미니골프 파티 course (rulebook §3, §8): nine floating-island holes, plus
 * the three obstacles last place can install on the next hole. Every hole
 * has one obstacle *slot* — a straight railed stretch of fairway — and each
 * obstacle is built there from the same recipe, so any hole can take any
 * obstacle:
 *
 * - 🌀 windmill: a house across the fairway; the only way on is the tunnel,
 *   and a blade sweeps across its mouth (blocked 30 % of the time).
 * - 🛹 jump ramp: a chasm across the fairway with a ramp in the middle —
 *   jump it with enough speed, or creep along the narrow bridge by one rail.
 * - 🧲 magnet: a post off to one side that drags passing balls toward it.
 *
 * Coordinates: metres, x across (− left), y up the course.
 */

import { BALL_R, type Bumper, type Layout, type Magnet, type Poly, type Pt, type Ramp, type Seg, type Windmill, type Zone } from "./physics";

export type ObstacleKind = "windmill" | "ramp" | "magnet";
export const OBSTACLE_KINDS: ObstacleKind[] = ["windmill", "ramp", "magnet"];

export const OBSTACLES: Record<ObstacleKind, { icon: string; name: string; desc: string; tip: string }> = {
  windmill: { icon: "🌀", name: "풍차", desc: "페어웨이를 막는 풍차 — 터널 하나뿐이고 날개가 입구를 가로질러요", tip: "날개가 지나간 직후에 치면 쏙" },
  ramp: { icon: "🛹", name: "점프대", desc: "페어웨이를 끊는 낭떠러지 — 가운데 점프대로 넘거나 한쪽 끝 좁은 다리로", tip: "약하면 추락, 세면 멀리 — 다리는 안전하지만 느려요" },
  magnet: { icon: "🧲", name: "자석", desc: "한쪽에 선 자석 기둥이 지나가는 공을 끌어당겨요", tip: "자석 반대쪽으로 겨누거나, 세게 쳐서 끌려가기 전에 지나가요" },
};

export interface Slot {
  x: number;
  y: number;
  /** Fairway direction at the slot (unit, axis-aligned). */
  dx: number;
  dy: number;
  /** Fairway width (rail to rail). */
  w: number;
  /** Which rail the ramp's bridge / the magnet hugs (+1 = right of the direction). */
  side: 1 | -1;
}

export interface HoleDef {
  id: number;
  name: string;
  /** Island theme for the 3D scene. */
  theme: "meadow" | "cliff" | "rainbow" | "stones" | "pinball" | "ice" | "volcano" | "fork" | "summit";
  par: number;
  ground: Poly[];
  voids?: Poly[];
  walls: Seg[];
  zones?: Zone[];
  bumpers?: Bumper[];
  tee: Pt;
  cup: Pt;
  slot: Slot;
  /** One-line hint shown when the hole starts. */
  hint: string;
}

const rect = (x0: number, y0: number, x1: number, y1: number): Poly => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** Rails along a polyline. */
function rails(...pts: [number, number][]): Seg[] {
  const out: Seg[] = [];
  for (let i = 1; i < pts.length; i++) out.push({ x1: pts[i - 1][0], y1: pts[i - 1][1], x2: pts[i][0], y2: pts[i][1] });
  return out;
}

function boxRails(x0: number, y0: number, x1: number, y1: number): Seg[] {
  return rails([x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]);
}

const slope = (poly: Poly, ax: number, ay: number): Zone => ({ kind: "slope", poly, ax, ay });
const sand = (poly: Poly): Zone => ({ kind: "sand", poly, ax: 0, ay: 0 });
const ice = (poly: Poly): Zone => ({ kind: "ice", poly, ax: 0, ay: 0 });

/** The crater on hole 7: an outer rim to climb, an inner bowl that funnels to the cup. */
function crater(cx: number, cy: number, outer: number, inner: number, rim: number, bowl: number): Zone[] {
  const o = outer;
  const i = inner;
  const z: Zone[] = [];
  // inner bowl: four triangles sloping down to the cup
  z.push(slope([[cx - i, cy + i], [cx + i, cy + i], [cx, cy]], 0, -bowl));
  z.push(slope([[cx - i, cy - i], [cx + i, cy - i], [cx, cy]], 0, bowl));
  z.push(slope([[cx + i, cy - i], [cx + i, cy + i], [cx, cy]], -bowl, 0));
  z.push(slope([[cx - i, cy - i], [cx - i, cy + i], [cx, cy]], bowl, 0));
  // outer rim: four trapezoids sloping away from the crater
  z.push(slope([[cx - o, cy + o], [cx + o, cy + o], [cx + i, cy + i], [cx - i, cy + i]], 0, rim));
  z.push(slope([[cx - o, cy - o], [cx + o, cy - o], [cx + i, cy - i], [cx - i, cy - i]], 0, -rim));
  z.push(slope([[cx + o, cy - o], [cx + o, cy + o], [cx + i, cy + i], [cx + i, cy - i]], rim, 0));
  z.push(slope([[cx - o, cy - o], [cx - o, cy + o], [cx - i, cy + i], [cx - i, cy - i]], -rim, 0));
  return z;
}

export const HOLES: HoleDef[] = [
  {
    id: 0,
    name: "구름 활주로",
    theme: "meadow",
    par: 2,
    ground: [rect(-0.6, 0, 0.6, 5)],
    walls: boxRails(-0.6, 0, 0.6, 5),
    zones: [slope(rect(-0.6, 3.6, 0.6, 5), 0.18, 0)],
    bumpers: [{ x: 0.05, y: 3.3, r: 0.09 }],
    tee: { x: 0, y: 0.5 },
    cup: { x: 0.2, y: 4.3 },
    slot: { x: 0, y: 2.6, dx: 0, dy: 1, w: 1.2, side: 1 },
    hint: "곧은 길 — 가운데 구름 범퍼를 피해, 컵 근처는 오른쪽으로 살짝 기울었어요",
  },
  {
    id: 1,
    name: "벼랑 끝 L",
    theme: "cliff",
    par: 3,
    ground: [
      [
        [-0.6, 0],
        [0.6, 0],
        [0.6, 3.0],
        [3.6, 3.0],
        [3.6, 4.2],
        [-0.6, 4.2],
      ],
    ],
    walls: [...rails([-0.6, 0], [0.6, 0], [0.6, 3.0], [3.6, 3.0], [3.6, 4.2]), ...rails([1.0, 4.2], [-0.6, 4.2], [-0.6, 0])],
    zones: [slope(rect(1.0, 3.0, 3.6, 4.2), 0, 0.28)],
    tee: { x: 0, y: 0.5 },
    cup: { x: 3.0, y: 3.5 },
    slot: { x: 0, y: 1.8, dx: 0, dy: 1, w: 1.2, side: -1 },
    hint: "꺾인 뒤 위쪽 가장자리엔 난간이 없어요 — 벼랑 쪽으로 살짝 기울었어요",
  },
  {
    id: 2,
    name: "무지개 언덕",
    theme: "rainbow",
    par: 3,
    ground: [rect(-0.7, 0, 0.7, 7)],
    walls: boxRails(-0.7, 0, 0.7, 7),
    zones: [slope(rect(-0.7, 2.0, 0.7, 3.4), 0, -0.9), slope(rect(-0.7, 3.4, 0.7, 4.8), 0, 0.9), sand(rect(0.22, 5.8, 0.7, 6.7))],
    tee: { x: 0, y: 0.5 },
    cup: { x: -0.12, y: 6.25 },
    slot: { x: 0, y: 5.15, dx: 0, dy: 1, w: 1.4, side: -1 },
    hint: "오르막을 넘을 만큼 세게 — 내리막에서 빨라져요. 컵 오른쪽은 모래",
  },
  {
    id: 3,
    name: "징검다리",
    theme: "stones",
    par: 3,
    ground: [rect(-0.8, 0, 0.8, 2.4), rect(-0.15, 2.35, 0.15, 4.45), rect(-0.9, 4.4, 0.9, 6.8)],
    walls: [...rails([-0.15, 2.4], [-0.8, 2.4], [-0.8, 0], [0.8, 0], [0.8, 2.4], [0.15, 2.4]), ...rails([0.15, 4.4], [0.9, 4.4], [0.9, 6.8], [-0.9, 6.8], [-0.9, 4.4], [-0.15, 4.4])],
    tee: { x: 0, y: 0.5 },
    cup: { x: 0.35, y: 5.9 },
    slot: { x: 0, y: 1.3, dx: 0, dy: 1, w: 1.6, side: 1 },
    hint: "난간 없는 30 cm 다리 — 똑바로!",
  },
  {
    id: 4,
    name: "핀볼 섬",
    theme: "pinball",
    par: 3,
    ground: [rect(-1.2, 0, 1.2, 5.6)],
    walls: boxRails(-1.2, 0, 1.2, 5.6),
    bumpers: [
      { x: 0, y: 2.7, r: 0.1 },
      { x: -0.6, y: 3.4, r: 0.1 },
      { x: 0.6, y: 3.4, r: 0.1 },
      { x: -0.28, y: 4.15, r: 0.08 },
      { x: 0.28, y: 4.15, r: 0.08 },
    ],
    zones: [sand(rect(-1.2, 4.8, -0.7, 5.6)), sand(rect(0.7, 4.8, 1.2, 5.6))],
    tee: { x: 0, y: 0.5 },
    cup: { x: 0, y: 4.85 },
    slot: { x: 0, y: 1.4, dx: 0, dy: 1, w: 2.4, side: 1 },
    hint: "범퍼는 통통 튀어요 — 틈을 노리거나 벽을 맞혀 돌아가요",
  },
  {
    id: 5,
    name: "얼음 계단",
    theme: "ice",
    par: 4,
    ground: [
      [
        [-0.6, 0],
        [0.6, 0],
        [0.6, 3.0],
        [3.0, 3.0],
        [3.0, 7.4],
        [1.8, 7.4],
        [1.8, 4.2],
        [-0.6, 4.2],
      ],
    ],
    walls: rails([-0.6, 4.2], [-0.6, 0], [0.6, 0], [0.6, 3.0], [3.0, 3.0], [3.0, 7.4], [1.8, 7.4], [1.8, 4.2], [0.6, 4.2]),
    zones: [ice(rect(-0.6, 3.0, 3.0, 4.2))],
    tee: { x: 0, y: 0.5 },
    cup: { x: 2.4, y: 6.7 },
    slot: { x: 2.4, y: 5.5, dx: 0, dy: 1, w: 1.2, side: 1 },
    hint: "꺾인 곳은 빙판, 첫 길 끝 위쪽엔 난간이 없어요 — 오른쪽 벽을 맞혀 올라가요",
  },
  {
    id: 6,
    name: "분화구",
    theme: "volcano",
    par: 3,
    ground: [
      rect(-0.5, 0, 0.5, 1.75),
      [
        [-0.58, 1.6],
        [0.58, 1.6],
        [1.4, 2.42],
        [1.4, 3.58],
        [0.58, 4.4],
        [-0.58, 4.4],
        [-1.4, 3.58],
        [-1.4, 2.42],
      ],
    ],
    walls: [
      ...rails([-0.5, 1.6], [-0.5, 0], [0.5, 0], [0.5, 1.6]),
      ...rails([-0.5, 1.6], [-0.58, 1.6], [-1.4, 2.42], [-1.4, 3.58]),
      ...rails([0.5, 1.6], [0.58, 1.6], [1.4, 2.42], [1.4, 3.58]),
      ...rails([0.58, 4.4], [-0.58, 4.4]),
    ],
    zones: crater(0, 3.0, 0.9, 0.38, 0.95, 0.5),
    bumpers: [{ x: 0, y: 2.0, r: 0.07 }],
    tee: { x: 0, y: 0.4 },
    cup: { x: 0, y: 3.0 },
    slot: { x: 0, y: 0.95, dx: 0, dy: 1, w: 1.0, side: -1 },
    hint: "분화구 테두리를 넘으면 컵으로 쏙 — 너무 세면 반대편 벼랑으로",
  },
  {
    id: 7,
    name: "두 갈래 길",
    theme: "fork",
    par: 3,
    ground: [rect(-1.0, 0, 1.0, 6.6)],
    walls: [...rails([-1.0, 2.4], [-1.0, 0], [1.0, 0], [1.0, 6.6], [-1.0, 6.6], [-1.0, 4.4]), ...boxRails(-0.3, 2.0, 0.3, 4.8)],
    zones: [slope(rect(-1.0, 2.0, -0.3, 4.8), -0.3, 0), sand(rect(0.3, 3.0, 1.0, 3.7))],
    tee: { x: 0, y: 0.5 },
    cup: { x: 0, y: 5.9 },
    slot: { x: 0, y: 1.2, dx: 0, dy: 1, w: 2.0, side: 1 },
    hint: "왼쪽 길은 벼랑 쪽으로 기울고, 오른쪽 길엔 모래 — 어느 쪽?",
  },
  {
    id: 8,
    name: "하늘 정상",
    theme: "summit",
    par: 4,
    ground: [rect(-0.7, 0, 0.7, 3.6), rect(-0.25, 3.55, 0.25, 5.45), rect(-1.0, 5.4, 1.0, 7.6)],
    walls: [...rails([-0.25, 3.6], [-0.7, 3.6], [-0.7, 0], [0.7, 0], [0.7, 3.6], [0.25, 3.6]), ...rails([0.25, 5.4], [1.0, 5.4], [1.0, 7.6], [-1.0, 7.6], [-1.0, 5.4], [-0.25, 5.4])],
    zones: [slope(rect(-0.7, 2.4, 0.7, 3.6), 0, -0.5), ice(rect(-0.25, 3.6, 0.25, 5.4)), sand(rect(-1.0, 5.4, -0.5, 6.0)), sand(rect(0.5, 5.4, 1.0, 6.0))],
    bumpers: [
      { x: 0.26, y: 6.42, r: 0.08 },
      { x: -0.3, y: 6.5, r: 0.07 },
    ],
    tee: { x: 0, y: 0.5 },
    cup: { x: 0.3, y: 7.0 },
    slot: { x: 0, y: 1.5, dx: 0, dy: 1, w: 1.4, side: -1 },
    hint: "마지막 홀! 오르막 끝의 얼음 다리 — 난간이 없어요",
  },
];

/** Which holes a game plays for each length option (§2). */
export const HOLE_SETS: Record<3 | 6 | 9, number[]> = {
  3: [0, 3, 8],
  6: [0, 1, 3, 4, 6, 8],
  9: [0, 1, 2, 3, 4, 5, 6, 7, 8],
};

/* ── obstacle builders (slot-local u across, v along) ──────────────────── */

const HOUSE_D = 0.15;
const TUNNEL = 0.26;
const RAMP_W = 0.44;
const RAMP_LEN = 0.42;
const CHASM_LEN = 0.55;
const BRIDGE_W = 0.17;

function frameOf(s: Slot) {
  // across = direction rotated clockwise (right of travel)
  const ax = s.dy;
  const ay = -s.dx;
  const at = (u: number, v: number): [number, number] => [round(s.x + u * ax + v * s.dx), round(s.y + u * ay + v * s.dy)];
  const seg = (u1: number, v1: number, u2: number, v2: number): Seg => {
    const a = at(u1, v1);
    const b = at(u2, v2);
    return { x1: a[0], y1: a[1], x2: b[0], y2: b[1] };
  };
  const box = (u0: number, v0: number, u1: number, v1: number): Poly => [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
  return { at, seg, box };
}

const round = (v: number) => Math.round(v * 10000) / 10000;

export function buildObstacle(base: Omit<Layout, "windmill" | "ramps" | "magnets">, s: Slot, kind: ObstacleKind | null): Layout {
  const L: Layout = { ...base, walls: [...base.walls], voids: [...base.voids], windmill: null, ramps: [], magnets: [] };
  if (!kind) return L;
  const f = frameOf(s);
  const h = s.w / 2;
  if (kind === "windmill") {
    const g = TUNNEL / 2;
    L.walls.push(f.seg(-h, -HOUSE_D, -g, -HOUSE_D), f.seg(g, -HOUSE_D, h, -HOUSE_D), f.seg(-h, HOUSE_D, -g, HOUSE_D), f.seg(g, HOUSE_D, h, HOUSE_D), f.seg(-g, -HOUSE_D, -g, HOUSE_D), f.seg(g, -HOUSE_D, g, HOUSE_D));
    const hub = f.at(0, -HOUSE_D);
    const wm: Windmill = { gate: f.seg(-g, -HOUSE_D, g, -HOUSE_D), x: hub[0], y: hub[1], dx: s.dx, dy: s.dy, w: s.w };
    L.windmill = wm;
  } else if (kind === "ramp") {
    const bridgeIn = s.side > 0 ? h - BRIDGE_W : -h + BRIDGE_W;
    const chasm = s.side > 0 ? f.box(-h - 0.05, 0.05, bridgeIn, 0.05 + CHASM_LEN) : f.box(bridgeIn, 0.05, h + 0.05, 0.05 + CHASM_LEN);
    L.voids.push(chasm);
    const c = f.at(0, 0.05 - RAMP_LEN / 2);
    const ramp: Ramp = { poly: f.box(-RAMP_W / 2, 0.05 - RAMP_LEN, RAMP_W / 2, 0.05), dx: s.dx, dy: s.dy, cx: c[0], cy: c[1], w: RAMP_W, len: RAMP_LEN };
    L.ramps.push(ramp);
  } else {
    const p = f.at(s.side * s.w * 0.24, 0.15);
    const m: Magnet = { x: p[0], y: p[1], r: 0.06, field: 0.75, k: 3.2 };
    L.magnets.push(m);
  }
  return L;
}

const CACHE = new Map<string, Layout>();

/** The physics layout of hole `id` with this obstacle (cached — layouts are immutable). */
export function layoutFor(id: number, obstacle: ObstacleKind | null): Layout {
  const key = `${id}:${obstacle ?? "-"}`;
  const hit = CACHE.get(key);
  if (hit) return hit;
  const h = HOLES[id];
  const base = { ground: h.ground, voids: h.voids ?? [], walls: h.walls, zones: h.zones ?? [], bumpers: h.bumpers ?? [], tee: h.tee, cup: h.cup };
  const L = buildObstacle(base, h.slot, obstacle);
  CACHE.set(key, L);
  return L;
}

/** Bounds of a hole (for cameras and the 2D view). */
export function holeBounds(id: number): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const g of HOLES[id].ground)
    for (const [x, y] of g) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  return { x0, y0, x1, y1 };
}

/** Keep a ball spot legal (inside the ground, off rails) — used for tee placement guards. */
export const TEE_CLEAR = BALL_R * 2.2;
