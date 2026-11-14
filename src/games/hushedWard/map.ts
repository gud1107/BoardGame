import { BODY_R, DOOR_MUFFLE, THROW_MAX, THROW_MIN } from "./data";

/**
 * 새벽 요양병원 3병동 — 2m 칸 격자 지도 (29×19칸 = 58×38m).
 *
 *   #  벽   .  복도   +  문   X  현관(잠긴 출구)   글자  방 바닥
 *
 * 바깥 고리 복도(5·13행, 1·27열)와 가운데 세로 복도 둘(10·18열)이 서로 이어져 어디서든
 * 두 갈래로 도망칠 수 있다. 가운데 g = 기도실(제단), s = 로비(시작·출구).
 * 가구(서랍장·침대…)는 칸 하나를 차지하고 길찾기에서는 막힌 칸으로 친다.
 */

export const CELL = 2;

const RAW = [
  "#############################",
  "#aaaaa#bbbb#ccccc#dddd#eeeee#",
  "#aaaaa#bbbb#ccccc#dddd#eeeee#",
  "#aaaaa#bbbb#ccccc#dddd#eeeee#",
  "###+#####+####+#####+####+###",
  "#...........................#",
  "#.####+###.#######.###+####.#",
  "#.#ffffff#.#ggggg#.#hhhhhh#.#",
  "#.#ffffff#.#ggggg#.#hhhhhh#.#",
  "#.+ffffff#.+ggggg+.#hhhhhh+.#",
  "#.#ffffff#.#ggggg#.#hhhhhh#.#",
  "#.#ffffff#.#ggggg#.#hhhhhh#.#",
  "#.####+###.###+###.###+####.#",
  "#...........................#",
  "###+#####+####+#####+####+###",
  "#iiiii#jjjj#sssss#kkkk#lllll#",
  "#iiiii#jjjj#sssss#kkkk#lllll#",
  "#iiiii#jjjj#sssss#kkkk#lllll#",
  "##############X##############",
];

export const COLS = RAW[0].length;
export const ROWS = RAW.length;
export const CELLS = COLS * ROWS;
export const WORLD_W = COLS * CELL;
export const WORLD_D = ROWS * CELL;

export const ROOM_NAMES: Record<string, string> = {
  a: "원무과",
  b: "약제실",
  c: "간호사실",
  d: "처치실",
  e: "물리치료실",
  f: "301호 병실",
  g: "기도실",
  h: "수술실",
  i: "세탁실",
  j: "영안실",
  k: "보일러실",
  l: "원장실",
  s: "로비",
  ".": "복도",
  "+": "문간",
};

export const idx = (c: number, r: number) => r * COLS + c;
export const colOf = (i: number) => i % COLS;
export const rowOf = (i: number) => Math.floor(i / COLS);
export const cellX = (c: number) => (c + 0.5) * CELL;
export const cellZ = (r: number) => (r + 0.5) * CELL;
export const centerOf = (i: number) => ({ x: cellX(colOf(i)), z: cellZ(rowOf(i)) });

export function cellAt(x: number, z: number): number {
  const c = Math.max(0, Math.min(COLS - 1, Math.floor(x / CELL)));
  const r = Math.max(0, Math.min(ROWS - 1, Math.floor(z / CELL)));
  return idx(c, r);
}

/** 0 벽 · 1 바닥 · 2 문 · 3 현관 */
export const KIND = new Uint8Array(CELLS);
/** 방 글자 (복도 '.', 문 '+', 벽 '#') */
export const ROOM: string[] = new Array(CELLS).fill("#");

for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLS; c++) {
    const ch = RAW[r][c];
    const i = idx(c, r);
    ROOM[i] = ch;
    KIND[i] = ch === "#" ? 0 : ch === "+" ? 2 : ch === "X" ? 3 : 1;
  }

export function roomNameAt(x: number, z: number): string {
  return ROOM_NAMES[ROOM[cellAt(x, z)]] ?? "";
}

export interface Box {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/* ── 문 ─────────────────────────────────────────────────────────────── */

export interface DoorDef {
  i: number;
  cell: number;
  x: number;
  z: number;
  /** true = 남북으로 지나가는 문 (문짝이 x축으로 놓임) */
  ns: boolean;
}

export const DOORS: DoorDef[] = [];
/** 칸 → 문 번호 (-1 없음) */
export const DOOR_AT = new Int16Array(CELLS).fill(-1);
for (let i = 0; i < CELLS; i++) {
  if (KIND[i] !== 2) continue;
  const c = colOf(i);
  const r = rowOf(i);
  const ns = KIND[idx(c - 1, r)] === 0 && KIND[idx(c + 1, r)] === 0;
  DOOR_AT[i] = DOORS.length;
  DOORS.push({ i: DOORS.length, cell: i, x: cellX(c), z: cellZ(r), ns });
}

/** 문틀 기둥 두께 — 문 칸은 폭 1.4m 통로 */
export const DOOR_POST = 0.3;

/* ── 가구 ───────────────────────────────────────────────────────────── */

export type FurnitureKind = "cabinet" | "bed" | "table" | "bench" | "altar";

export interface Furniture {
  kind: FurnitureKind;
  cell: number;
  /** 놓인 자리 (칸 중심에서 벽 쪽으로 붙임) */
  x: number;
  z: number;
  /** 정면이 보는 방향 (라디안, +z = 0) */
  rot: number;
  box: Box;
  /** 서랍장이면 서랍 번호 */
  container: number;
}

export interface ContainerDef {
  i: number;
  cell: number;
  /** 상호작용 기준점 = 칸 중심 */
  x: number;
  z: number;
  room: string;
}

const CONTAINER_CELLS: [number, number][] = [
  [1, 1], [5, 1], // a
  [7, 1], [10, 2], // b
  [12, 1], [16, 1], // c
  [18, 1], [21, 2], // d
  [23, 1], [27, 1], // e
  [3, 7], [8, 7], [8, 11], [3, 11], // f
  [20, 7], [25, 7], [20, 11], [25, 11], // h
  [1, 17], [5, 17], // i
  [7, 17], [10, 16], // j
  [18, 17], [21, 16], // k
  [23, 17], [27, 17], // l
];

const DECOR_CELLS: [FurnitureKind, number, number][] = [
  ["bed", 4, 8], ["bed", 7, 8], ["bed", 4, 10], ["bed", 7, 10],
  ["table", 22, 9], ["table", 23, 9],
  ["bench", 12, 17], ["bench", 16, 17],
  ["bed", 9, 2], ["bed", 19, 3], ["table", 25, 2], ["table", 3, 2], ["bed", 3, 16], ["table", 25, 16],
];

export const ALTAR_CELL = idx(14, 7);
export const ALTAR = { x: cellX(14), z: cellZ(7) + 0.2 };
export const EXIT_CELL = idx(14, 18);
/** 현관 앞 (여기 닿으면 탈출) */
export const EXIT = { x: cellX(14), z: cellZ(17) + 0.55 };
export const START_CELLS = [idx(13, 16), idx(15, 16), idx(14, 16), idx(14, 15)];
/** 귀신이 깨어나는 방 후보 (로비에서 먼 곳) */
export const GHOST_SPAWNS = [idx(2, 2), idx(26, 2), idx(14, 2), idx(5, 9), idx(23, 8)];

export const FURNITURE: Furniture[] = [];
export const CONTAINERS: ContainerDef[] = [];
/** 칸 → 가구 번호 (-1 없음) */
export const FURN_AT = new Int16Array(CELLS).fill(-1);

function wallDir(c: number, r: number): { dx: number; dz: number } {
  // 붙일 벽: 북 → 남 → 서 → 동 순으로 찾는다
  if (KIND[idx(c, r - 1)] === 0) return { dx: 0, dz: -1 };
  if (KIND[idx(c, r + 1)] === 0) return { dx: 0, dz: 1 };
  if (KIND[idx(c - 1, r)] === 0) return { dx: -1, dz: 0 };
  if (KIND[idx(c + 1, r)] === 0) return { dx: 1, dz: 0 };
  return { dx: 0, dz: 0 };
}

function addFurniture(kind: FurnitureKind, c: number, r: number, container = -1) {
  const cell = idx(c, r);
  const w = wallDir(c, r);
  // 크기: 벽을 따라 w, 벽에서 튀어나온 깊이 d
  const [along, deep] = kind === "cabinet" ? [1.3, 0.55] : kind === "bed" ? [1.0, 1.9] : kind === "table" ? [1.7, 0.9] : kind === "bench" ? [1.6, 0.5] : [1.6, 0.7];
  const free = w.dx === 0 && w.dz === 0;
  const off = free ? 0 : 1 - deep / 2 - 0.02;
  const x = cellX(c) + w.dx * off;
  const z = cellZ(r) + w.dz * off;
  const alongX = free ? true : w.dx === 0;
  const hx = (alongX ? along : deep) / 2;
  const hz = (alongX ? deep : along) / 2;
  const rot = free ? 0 : Math.atan2(-w.dx, -w.dz);
  FURN_AT[cell] = FURNITURE.length;
  FURNITURE.push({ kind, cell, x, z, rot, box: { x0: x - hx, z0: z - hz, x1: x + hx, z1: z + hz }, container });
}

CONTAINER_CELLS.forEach(([c, r], i) => {
  CONTAINERS.push({ i, cell: idx(c, r), x: cellX(c), z: cellZ(r), room: ROOM[idx(c, r)] });
  addFurniture("cabinet", c, r, i);
});
for (const [kind, c, r] of DECOR_CELLS) addFurniture(kind, c, r);
addFurniture("altar", 14, 7);

/** 길찾기에서 못 지나가는 칸 (벽·현관·가구) */
export const BLOCKED = new Uint8Array(CELLS);
for (let i = 0; i < CELLS; i++) BLOCKED[i] = KIND[i] === 0 || KIND[i] === 3 || FURN_AT[i] >= 0 ? 1 : 0;

/** 걸어 다닐 수 있는 칸 전부 */
export const WALKABLE: number[] = [];
for (let i = 0; i < CELLS; i++) if (!BLOCKED[i]) WALKABLE.push(i);
/** 방 안 바닥 칸만 (귀신이 어슬렁거릴 목적지) */
export const ROOM_CELLS = WALKABLE.filter((i) => KIND[i] === 1 && ROOM[i] !== ".");

/* ── 길찾기 ─────────────────────────────────────────────────────────── */

const DIAG = CELL * Math.SQRT2;
const NB: [number, number, number][] = [
  [1, 0, CELL], [-1, 0, CELL], [0, 1, CELL], [0, -1, CELL],
  [1, 1, DIAG], [1, -1, DIAG], [-1, 1, DIAG], [-1, -1, DIAG],
];

/**
 * `from` 칸에서 모든 칸까지의 거리(m). 대각선은 양옆이 모두 뚫려 있을 때만.
 * `closed`를 주면 닫힌 문 칸에 들어갈 때 `muffle`만큼 더한다(소리용).
 * `from`이 막힌 칸(가구 앞에 선 사람 등)이어도 거기서 출발은 된다.
 */
export function distField(from: number, closed?: ArrayLike<boolean | number> | null, muffle = DOOR_MUFFLE): Float32Array {
  const dist = new Float32Array(CELLS).fill(Infinity);
  dist[from] = 0;
  // 작은 이진 힙
  const heap: number[] = [from];
  const key: number[] = [0];
  const push = (n: number, k: number) => {
    let i = heap.length;
    heap.push(n);
    key.push(k);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (key[p] <= k) break;
      heap[i] = heap[p];
      key[i] = key[p];
      i = p;
    }
    heap[i] = n;
    key[i] = k;
  };
  const pop = (): [number, number] => {
    const n = heap[0];
    const k = key[0];
    const ln = heap.pop() as number;
    const lk = key.pop() as number;
    const len = heap.length;
    if (len > 0) {
      let i = 0;
      for (;;) {
        let ch = i * 2 + 1;
        if (ch >= len) break;
        if (ch + 1 < len && key[ch + 1] < key[ch]) ch++;
        if (key[ch] >= lk) break;
        heap[i] = heap[ch];
        key[i] = key[ch];
        i = ch;
      }
      heap[i] = ln;
      key[i] = lk;
    }
    return [n, k];
  };
  while (heap.length > 0) {
    const [n, k] = pop();
    if (k > dist[n]) continue;
    const c = colOf(n);
    const r = rowOf(n);
    for (const [dc, dr, cost] of NB) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
      const m = idx(nc, nr);
      if (BLOCKED[m]) continue;
      if (dc !== 0 && dr !== 0 && (BLOCKED[idx(nc, r)] || BLOCKED[idx(c, nr)])) continue;
      let nk = k + cost;
      if (closed && KIND[m] === 2 && !closed[DOOR_AT[m]]) nk += muffle;
      // dist가 Float32라 같은 정밀도로 맞춘다 (안 그러면 꺼낼 때 "낡은 값"으로 오해해 버린다)
      nk = Math.fround(nk);
      if (nk < dist[m]) {
        dist[m] = nk;
        push(m, nk);
      }
    }
  }
  return dist;
}

const walkCache = new Map<number, Float32Array>();

/** 걸어서 `target` 칸까지의 거리장 (문은 열고 지나가므로 무시). 칸마다 한 번만 계산. */
export function walkField(target: number): Float32Array {
  let f = walkCache.get(target);
  if (!f) {
    f = distField(target, null);
    walkCache.set(target, f);
  }
  return f;
}

/** 막힌 칸(가구 칸) 위에 선 좌표라면 가장 가까운 걸을 수 있는 칸으로 */
export function walkCellAt(x: number, z: number): number {
  const here = cellAt(x, z);
  if (!BLOCKED[here]) return here;
  let best = here;
  let bd = Infinity;
  const c = colOf(here);
  const r = rowOf(here);
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
      const m = idx(nc, nr);
      if (BLOCKED[m]) continue;
      const d = Math.hypot(cellX(nc) - x, cellZ(nr) - z);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
  return best;
}

/** `target`으로 가는 다음 칸 (이미 그 칸이면 그대로) */
export function nextCell(from: number, target: number): number {
  if (from === target) return from;
  const f = walkField(target);
  const c = colOf(from);
  const r = rowOf(from);
  let best = from;
  let bd = BLOCKED[from] ? Infinity : f[from];
  for (const [dc, dr, cost] of NB) {
    const nc = c + dc;
    const nr = r + dr;
    if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
    const m = idx(nc, nr);
    if (BLOCKED[m]) continue;
    if (dc !== 0 && dr !== 0 && (BLOCKED[idx(nc, r)] || BLOCKED[idx(c, nr)])) continue;
    const d = f[m] + cost * 0.001;
    if (d < bd) {
      bd = d;
      best = m;
    }
  }
  return best;
}

/* ── 충돌 ───────────────────────────────────────────────────────────── */

function pushOut(p: { x: number; z: number }, b: Box, r: number) {
  const qx = Math.max(b.x0, Math.min(b.x1, p.x));
  const qz = Math.max(b.z0, Math.min(b.z1, p.z));
  let dx = p.x - qx;
  let dz = p.z - qz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    p.x = qx + (dx / d) * r;
    p.z = qz + (dz / d) * r;
    return;
  }
  // 중심이 상자 안: 가장 얕은 쪽으로
  const l = p.x - b.x0;
  const rr = b.x1 - p.x;
  const u = p.z - b.z0;
  const dn = b.z1 - p.z;
  const m = Math.min(l, rr, u, dn);
  dx = m === l ? -1 : m === rr ? 1 : 0;
  dz = dx !== 0 ? 0 : m === u ? -1 : 1;
  if (dx < 0) p.x = b.x0 - r;
  else if (dx > 0) p.x = b.x1 + r;
  else if (dz < 0) p.z = b.z0 - r;
  else p.z = b.z1 + r;
}

const box: Box = { x0: 0, z0: 0, x1: 0, z1: 0 };

/**
 * 원(반지름 r)을 벽·가구·문틀·닫힌 문에서 밀어낸다. `doorOpen[i]`가 false면 그 문은 막혀 있다.
 * 사람(직접 조작·봇)과 던진 병의 착지 계산이 함께 쓴다.
 */
export function collide(p: { x: number; z: number }, doorOpen: ArrayLike<boolean | number>, r = BODY_R) {
  for (let pass = 0; pass < 2; pass++) {
    const c0 = Math.floor(p.x / CELL);
    const r0 = Math.floor(p.z / CELL);
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const c = c0 + dc;
        const rw = r0 + dr;
        if (c < 0 || rw < 0 || c >= COLS || rw >= ROWS) continue;
        const i = idx(c, rw);
        const k = KIND[i];
        if (k === 0 || k === 3) {
          box.x0 = c * CELL;
          box.x1 = box.x0 + CELL;
          box.z0 = rw * CELL;
          box.z1 = box.z0 + CELL;
          pushOut(p, box, r);
        } else if (k === 2) {
          const d = DOORS[DOOR_AT[i]];
          const x0 = c * CELL;
          const z0 = rw * CELL;
          if (d.ns) {
            pushOut(p, { x0, z0, x1: x0 + DOOR_POST, z1: z0 + CELL }, r);
            pushOut(p, { x0: x0 + CELL - DOOR_POST, z0, x1: x0 + CELL, z1: z0 + CELL }, r);
            if (!doorOpen[d.i]) pushOut(p, { x0, z0: d.z - 0.1, x1: x0 + CELL, z1: d.z + 0.1 }, r);
          } else {
            pushOut(p, { x0, z0, x1: x0 + CELL, z1: z0 + DOOR_POST }, r);
            pushOut(p, { x0, z0: z0 + CELL - DOOR_POST, x1: x0 + CELL, z1: z0 + CELL }, r);
            if (!doorOpen[d.i]) pushOut(p, { x0: d.x - 0.1, z0, x1: d.x + 0.1, z1: z0 + CELL }, r);
          }
        } else if (FURN_AT[i] >= 0) {
          pushOut(p, FURNITURE[FURN_AT[i]].box, r);
        }
      }
  }
  p.x = Math.max(r, Math.min(WORLD_W - r, p.x));
  p.z = Math.max(r, Math.min(WORLD_D - r, p.z));
}

/** 그 점이 벽·닫힌 문 속인가 (던진 병이 부딪히는 곳) */
export function solidAt(x: number, z: number, doorOpen: ArrayLike<boolean | number>): boolean {
  if (x < 0 || z < 0 || x >= WORLD_W || z >= WORLD_D) return true;
  const i = cellAt(x, z);
  const k = KIND[i];
  if (k === 0 || k === 3) return true;
  if (k === 2 && !doorOpen[DOOR_AT[i]]) return true;
  return false;
}

/** 약병이 떨어지는 곳: 바라보는 쪽으로 날아가다 벽에 부딪히면 그 앞에서 깨진다. pitch는 위가 +. */
export function throwLanding(x: number, z: number, yaw: number, pitch: number, doorOpen: ArrayLike<boolean | number>): { x: number; z: number; dist: number } {
  const k = Math.max(0, Math.min(1, (pitch + 0.35) / 0.9));
  const range = THROW_MIN + (THROW_MAX - THROW_MIN) * k;
  const dx = -Math.sin(yaw);
  const dz = -Math.cos(yaw);
  let d = 0;
  let lx = x;
  let lz = z;
  while (d < range) {
    const nd = Math.min(range, d + 0.25);
    const nx = x + dx * nd;
    const nz = z + dz * nd;
    if (solidAt(nx, nz, doorOpen)) break;
    d = nd;
    lx = nx;
    lz = nz;
  }
  return { x: lx, z: lz, dist: d };
}

/** 두 점 사이가 벽·닫힌 문에 안 막혔나 (손전등 빛·눈으로 보는 판정) */
export function clearLine(x0: number, z0: number, x1: number, z1: number, doorOpen: ArrayLike<boolean | number>): boolean {
  const d = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.ceil(d / 0.4);
  for (let i = 1; i < n; i++) {
    const k = i / n;
    if (solidAt(x0 + (x1 - x0) * k, z0 + (z1 - z0) * k, doorOpen)) return false;
  }
  return true;
}
