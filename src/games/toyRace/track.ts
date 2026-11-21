import { CAR_R, type TrackId } from "./data";

/**
 * 장난감 방 레이스 트랙 (룰북 §4).
 *
 * 트랙 = 닫힌 가운데 선(0.8u 간격 표본) + 표본마다 도로 반폭·러그 폭·높이·비누 여부.
 * - 도로(|옆 거리| ≤ W): 제 속도 · 러그(W ~ W+러그): 최고 속도 55% · 그 밖: 🧱 블록 울타리(튕김)
 * - 거실·욕실은 "별 모양 극좌표 곡선"이라 절대 자기 자신과 엇갈리지 않는다.
 * - 아이 방은 8자 — 엇갈리는 곳은 📚 책 다리(높이 2.4u)로 위아래가 나뉜다. 다리 위는 러그 대신 난간.
 * 차가 트랙의 어디에 있는지는 "직전 표본 번호(seg) 근처만" 찾는다 — 8자 교차점에서 다른 가지로
 * 튀지 않게, 그리고 빠르게. (seg를 모를 때만 전체를 높이 걸러 찾는다.)
 */

export interface Circle {
  x: number;
  z: number;
  r: number;
}

export interface Prop {
  kind: "sofa" | "table" | "lamp" | "blocks" | "bear" | "plant" | "tub" | "sink" | "toilet" | "mat" | "towel" | "bed" | "desk" | "shelf" | "rocket" | "ball" | "books" | "rug";
  x: number;
  z: number;
  rot: number;
  s: number;
}

export interface Track {
  id: TrackId;
  /** 표본 개수 · 한 바퀴 길이 · 표본 간격 */
  n: number;
  L: number;
  ds: number;
  x: Float64Array;
  z: Float64Array;
  y: Float64Array;
  /** 진행 방향 단위 벡터 */
  tx: Float64Array;
  tz: Float64Array;
  /** 도로 반폭 */
  w: Float64Array;
  /** 오른쪽(+옆)·왼쪽(−옆) 러그 폭 (0 = 바로 난간) */
  rugA: Float64Array;
  rugB: Float64Array;
  /** 🫧 비누 거품 구간 */
  soap: Uint8Array;
  /** 표본별 굽은 정도 (rad/u, 부호 = 왼쪽으로 굽음 +) — 봇이 브레이크·드리프트를 정할 때 */
  curv: Float64Array;
  /** 🎁 선물 상자 자리 */
  boxes: { s: number; lat: number; x: number; z: number }[];
  /** 🧸 장난감 벽이 떨어질 수 있는 자리 (트랙 위치 s) */
  sockets: number[];
  /** 고정 장애물 (샴푸 통·블록 탑) — 도로 위, 지나갈 수 없다 */
  obstacles: (Circle & { s: number; lat: number; kind: "blocks" | "bottle" })[];
  /** 📚 점프대 (트랙 위치 s, 길이 방향 반폭) */
  jumps: { s: number; len: number }[];
  /** 🚂 기차 건널목 (아이 방만) */
  train: { s: number; period: number; cross: number; warn: number; offset: number } | null;
  /** 바닥 크기 (방 벽까지) */
  room: { hx: number; hz: number };
  props: Prop[];
}

export const ROAD_W = 2.9;
export const RUG_W = 1.6;
export const BRIDGE_H = 2.4;
const DS = 0.8;

type Pt = { x: number; z: number; y: number };

/** 별 모양 극좌표 곡선: R(θ) = 1 + Σ a·sin(kθ + φ) — R > 0이면 자기 자신과 엇갈리지 않는다 */
function polar(ax: number, az: number, terms: [number, number, number][], theta0: number) {
  return (u: number): Pt => {
    const th = theta0 + u * Math.PI * 2;
    let R = 1;
    for (const [k, a, ph] of terms) R += a * Math.sin(k * th + ph);
    return { x: ax * R * Math.cos(th), z: az * R * Math.sin(th), y: 0 };
  };
}

/** 8자 곡선 (가운데에서 엇갈림, 두 번째로 지날 때는 책 다리 위) */
function eight(A: number, B: number, phase: number) {
  return (u: number): Pt => {
    const th = phase + u * Math.PI * 2;
    // θ = 0에서 땅 위로 가운데를 지나고, θ = π에서 다리 위로 지난다
    let d = th - Math.PI;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const y = BRIDGE_H * Math.exp(-((d / 0.42) ** 2));
    return { x: A * Math.sin(th) + 2.5 * Math.sin(3 * th), z: B * Math.sin(th) * Math.cos(th), y };
  };
}

interface Def {
  curve: (u: number) => Pt;
  /** 비누 구간 (한 바퀴 비율 [시작, 끝]) */
  soap: [number, number][];
  jumps: number[];
  /** 선물 상자 줄 (비율) */
  boxRows: number[];
  /** 고정 장애물 (비율, 옆 위치) */
  obstacles: [number, number, "blocks" | "bottle"][];
  train: boolean;
  room: { hx: number; hz: number };
  props: (t: Omit<Track, "props">) => Prop[];
}

const DEFS: Record<TrackId, Def> = {
  living: {
    curve: polar(
      40,
      27,
      [
        [2, 0.1, 0.5],
        [3, 0.15, 1.6],
        [5, 0.06, 0.2],
      ],
      Math.PI / 2,
    ),
    soap: [],
    jumps: [0.43],
    boxRows: [0.16, 0.55, 0.8],
    obstacles: [
      [0.29, 1.4, "blocks"],
      [0.68, -1.5, "blocks"],
    ],
    train: false,
    room: { hx: 62, hz: 48 },
    props: (t) => [
      { kind: "rug", x: 0, z: 0, rot: 0, s: 1 },
      { kind: "table", x: 0, z: 0, rot: 0, s: 1 },
      { kind: "sofa", x: 0, z: -t.room.hz + 6, rot: 0, s: 1 },
      { kind: "lamp", x: t.room.hx - 7, z: -t.room.hz + 7, rot: 0, s: 1 },
      { kind: "plant", x: -t.room.hx + 6, z: -t.room.hz + 6, rot: 0, s: 1 },
      { kind: "bear", x: -t.room.hx + 7, z: t.room.hz - 8, rot: 0.6, s: 1 },
      { kind: "blocks", x: t.room.hx - 8, z: t.room.hz - 7, rot: 0.3, s: 1 },
      { kind: "ball", x: 14, z: 6, rot: 0, s: 1 },
      { kind: "books", x: -16, z: -4, rot: 0.4, s: 1 },
    ],
  },
  bath: {
    curve: polar(
      38,
      29,
      [
        [2, 0.16, 2.0],
        [3, 0.11, 0.3],
        [4, 0.06, 1.0],
      ],
      -Math.PI / 2,
    ),
    soap: [
      [0.27, 0.38],
      [0.63, 0.72],
    ],
    jumps: [0.89],
    boxRows: [0.14, 0.5, 0.78],
    obstacles: [
      [0.22, -1.3, "bottle"],
      [0.45, 1.5, "bottle"],
      [0.58, -0.2, "bottle"],
    ],
    train: false,
    room: { hx: 60, hz: 48 },
    props: (t) => [
      { kind: "mat", x: 0, z: 0, rot: 0, s: 1 },
      { kind: "tub", x: 0, z: -t.room.hz + 7, rot: 0, s: 1 },
      { kind: "sink", x: t.room.hx - 3.5, z: 8, rot: -Math.PI / 2, s: 1 },
      { kind: "toilet", x: -t.room.hx + 6, z: -6, rot: Math.PI / 2, s: 1 },
      { kind: "towel", x: -t.room.hx + 8, z: t.room.hz - 6, rot: 0, s: 1 },
      { kind: "plant", x: t.room.hx - 6, z: t.room.hz - 6, rot: 0, s: 1 },
      { kind: "ball", x: 4, z: 3, rot: 0, s: 0.8 },
    ],
  },
  bedroom: {
    curve: eight(42, 60, -0.45),
    soap: [],
    jumps: [],
    boxRows: [0.2, 0.46, 0.7, 0.93],
    obstacles: [
      [0.31, 1.3, "blocks"],
      [0.81, -1.3, "blocks"],
    ],
    train: true,
    room: { hx: 64, hz: 46 },
    props: (t) => [
      { kind: "bed", x: 0, z: -t.room.hz + 9, rot: 0, s: 1 },
      { kind: "desk", x: t.room.hx - 7, z: t.room.hz - 7, rot: Math.PI, s: 1 },
      { kind: "shelf", x: -t.room.hx + 5, z: 0, rot: Math.PI / 2, s: 1 },
      { kind: "rocket", x: -26, z: 2, rot: 0, s: 1 },
      { kind: "bear", x: 26, z: -3, rot: -0.5, s: 1 },
      { kind: "blocks", x: -t.room.hx + 8, z: t.room.hz - 7, rot: 0.2, s: 1 },
    ],
  },
};

const cache = new Map<TrackId, Track>();

export function trackFor(id: TrackId): Track {
  const hit = cache.get(id);
  if (hit) return hit;
  const t = build(id);
  cache.set(id, t);
  return t;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function build(id: TrackId): Track {
  const def = DEFS[id];
  // 1) 촘촘하게 찍어 길이를 재고 2) 같은 간격(≈0.8u)으로 다시 찍는다
  const M = 6000;
  const dense: Pt[] = [];
  for (let k = 0; k < M; k++) dense.push(def.curve(k / M));
  const cum = new Float64Array(M + 1);
  for (let k = 1; k <= M; k++) {
    const a = dense[k - 1];
    const b = dense[k % M];
    cum[k] = cum[k - 1] + Math.hypot(b.x - a.x, b.z - a.z);
  }
  const L0 = cum[M];
  const n = Math.round(L0 / DS);
  const ds = L0 / n;
  const x = new Float64Array(n);
  const z = new Float64Array(n);
  const y = new Float64Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const target = i * ds;
    while (k < M - 1 && cum[k + 1] < target) k++;
    const u = (target - cum[k]) / Math.max(1e-9, cum[k + 1] - cum[k]);
    const a = dense[k];
    const b = dense[(k + 1) % M];
    x[i] = a.x + (b.x - a.x) * u;
    z[i] = a.z + (b.z - a.z) * u;
    y[i] = a.y + (b.y - a.y) * u;
  }
  const tx = new Float64Array(n);
  const tz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n;
    const b = (i + 1) % n;
    const dx = x[b] - x[a];
    const dz = z[b] - z[a];
    const l = Math.hypot(dx, dz) || 1;
    tx[i] = dx / l;
    tz[i] = dz / l;
  }
  const curv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 3 + n) % n;
    const b = (i + 3) % n;
    let d = Math.atan2(tz[b], tx[b]) - Math.atan2(tz[a], tx[a]);
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    curv[i] = d / (6 * ds);
  }
  const w = new Float64Array(n).fill(ROAD_W);
  const rugA = new Float64Array(n);
  const rugB = new Float64Array(n);
  const soap = new Uint8Array(n);
  const L = n * ds;
  for (let i = 0; i < n; i++) {
    // 다리 위(높이 0.3u 넘는 곳)는 러그 대신 난간
    const bridge = y[i] > 0.3;
    rugA[i] = bridge ? 0 : RUG_W;
    rugB[i] = bridge ? 0 : RUG_W;
    const f = i / n;
    soap[i] = def.soap.some(([a, b]) => f >= a && f <= b) ? 1 : 0;
  }
  const base = { id, n, L, ds, x, z, y, tx, tz, w, rugA, rugB, soap, curv } as const;
  const at = (s: number, lat: number) => pointAt(base as unknown as Track, s, lat);
  const boxes = def.boxRows.flatMap((f) => [-2.1, -0.7, 0.7, 2.1].map((lat) => ({ s: r3(f * L), lat, ...pick(at(f * L, lat)) })));
  const obstacles = def.obstacles.map(([f, lat, kind]) => ({ s: r3(f * L), lat, r: kind === "bottle" ? 0.55 : 0.62, kind, ...pick(at(f * L, lat)) }));
  const jumps = def.jumps.map((f) => ({ s: r3(f * L), len: 1.4 }));
  // 투하 자리: 한 바퀴에 9곳 (출발선 근처·점프대·상자 줄·장애물·기차와 겹치지 않게 조금 비킴)
  const avoid = [0, ...jumps.map((j) => j.s), ...def.boxRows.map((f) => f * L), ...obstacles.map((o) => o.s)];
  const sockets: number[] = [];
  for (let q = 0; q < 9; q++) {
    let s = ((q + 0.5) / 9) * L;
    for (let it = 0; it < 8 && avoid.some((a) => wrapAbs(a - s, L) < 6); it++) s = (s + 3) % L;
    sockets.push(r3(s));
  }
  let train: Track["train"] = null;
  if (def.train) {
    // 오른쪽 고리 끝(x가 가장 큰 곳) 근처를 가로지른다
    let best = 0;
    for (let i = 0; i < n; i++) if (x[i] > x[best]) best = i;
    train = { s: r3(best * ds), period: 13_000, cross: 2600, warn: 2200, offset: 5200 };
  }
  const partial: Omit<Track, "props"> = { ...base, boxes, obstacles, jumps, sockets, train, room: def.room };
  return { ...partial, props: def.props(partial) };
}

function pick(p: { x: number; z: number }) {
  return { x: r3(p.x), z: r3(p.z) };
}

export function wrapS(s: number, L: number): number {
  return ((s % L) + L) % L;
}

/** 트랙 위 두 위치의 차이 (−L/2 ~ L/2) */
export function wrapDelta(d: number, L: number): number {
  let v = d % L;
  if (v > L / 2) v -= L;
  if (v < -L / 2) v += L;
  return v;
}

function wrapAbs(d: number, L: number) {
  return Math.abs(wrapDelta(d, L));
}

/** 트랙 위치 s, 옆 거리 lat의 점과 진행 방향각 */
export function pointAt(t: Track, s: number, lat = 0): { x: number; z: number; y: number; h: number; i: number } {
  const ss = wrapS(s, t.L);
  const f = ss / t.ds;
  const i = Math.floor(f) % t.n;
  const j = (i + 1) % t.n;
  const u = f - Math.floor(f);
  const tx = t.tx[i] + (t.tx[j] - t.tx[i]) * u;
  const tz = t.tz[i] + (t.tz[j] - t.tz[i]) * u;
  const l = Math.hypot(tx, tz) || 1;
  const nx = -tz / l;
  const nz = tx / l;
  return {
    x: t.x[i] + (t.x[j] - t.x[i]) * u + nx * lat,
    z: t.z[i] + (t.z[j] - t.z[i]) * u + nz * lat,
    y: t.y[i] + (t.y[j] - t.y[i]) * u,
    h: Math.atan2(tz, tx),
    i,
  };
}

export interface Proj {
  /** 가장 가까운 표본 */
  i: number;
  /** 트랙 위치 (0 ~ L) */
  s: number;
  /** 옆 거리 (+ = 진행 방향 오른쪽, 운전석 기준) */
  lat: number;
  /** 그 자리 도로 높이 */
  y: number;
}

const SEARCH = 12;

/** 직전 표본 근처에서 가장 가까운 곳 찾기 (8자 교차점에서도 지금 가지를 유지) */
export function project(t: Track, x: number, z: number, hint: number): Proj {
  let best = -1;
  let bestD = Infinity;
  const h = ((Math.round(hint) % t.n) + t.n) % t.n;
  for (let k = -SEARCH; k <= SEARCH; k++) {
    const i = (h + k + t.n) % t.n;
    const dx = x - t.x[i];
    const dz = z - t.z[i];
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return projAt(t, x, z, best);
}

function projAt(t: Track, x: number, z: number, i: number): Proj {
  const dx = x - t.x[i];
  const dz = z - t.z[i];
  const along = dx * t.tx[i] + dz * t.tz[i];
  const lat = -dx * t.tz[i] + dz * t.tx[i];
  const s = wrapS(i * t.ds + along, t.L);
  const j = along >= 0 ? (i + 1) % t.n : (i - 1 + t.n) % t.n;
  const u = Math.min(1, Math.abs(along) / t.ds);
  return { i, s, lat, y: t.y[i] + (t.y[j] - t.y[i]) * u };
}

/** 표본 번호를 모를 때: 높이가 비슷한 표본 중 가장 가까운 곳 (재배치·방장 승계 검증용) */
export function projectGlobal(t: Track, x: number, z: number, y = 0): Proj {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < t.n; i++) {
    if (Math.abs(t.y[i] - y) > 1.2) continue;
    const dx = x - t.x[i];
    const dz = z - t.z[i];
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return projAt(t, x, z, best);
}

/** 이 옆 위치에서 바깥 울타리까지 (차 중심이 갈 수 있는 한계) */
export function latLimit(t: Track, i: number, side: number): number {
  const rug = side >= 0 ? t.rugA[i] : t.rugB[i];
  return t.w[i] + rug - CAR_R;
}

export type Surface = "road" | "rug" | "soap";

export function surfaceAt(t: Track, p: Proj): Surface {
  if (Math.abs(p.lat) > t.w[p.i]) return "rug";
  return t.soap[p.i] ? "soap" : "road";
}

/** 출발 자리: 출발선 뒤에 네 대씩 나란히 (4명까지는 한 줄 — 앞줄 이득이 없다), 5~8명은 두 줄 */
export const GRID_LANES = [-2.1, -0.7, 0.7, 2.1];
export function gridSpot(t: Track, slot: number): { x: number; z: number; y: number; h: number; s: number; i: number } {
  const row = Math.floor(slot / 4);
  const lane = GRID_LANES[slot % 4];
  const s = -2.2 - row * 2.6;
  const p = pointAt(t, s, lane);
  return { ...p, s: wrapS(s, t.L) };
}

/** 🚂 기차가 건널목을 막고 있나 / 곧 오나 (경기 시작부터 ms) */
export function trainState(t: Track, sinceGo: number): "clear" | "warn" | "cross" {
  const tr = t.train;
  if (!tr || sinceGo < 0) return "clear";
  const ph = (sinceGo + tr.period - tr.offset) % tr.period;
  if (ph < tr.cross) return "cross";
  if (ph > tr.period - tr.warn) return "warn";
  return "clear";
}

/** 🚂 기차 칸들이 지나가는 정도 0~1 (화면용, 건널목 가로지르기) */
export function trainProgress(t: Track, sinceGo: number): number {
  const tr = t.train;
  if (!tr || sinceGo < 0) return -1;
  const ph = (sinceGo + tr.period - tr.offset) % tr.period;
  return ph < tr.cross ? ph / tr.cross : -1;
}
