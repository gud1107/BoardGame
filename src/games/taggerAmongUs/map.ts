import { BODY_R } from "./data";

/**
 * 한밤의 폐교 "달빛초등학교" 1층 — 2m 칸 격자 지도 (29×19칸 = 58×38m).
 *
 *   #  벽   .  복도   +  문   X  교문(잠긴 출구)   글자  방 바닥
 *
 * 바깥 고리 복도(5·13행, 5·23열) 안쪽에 큰 강당(g)이 있고, 강당은 사방 여섯 문으로 뚫려 있어
 * 어디서든 두 갈래 이상으로 달아날 수 있다. 출구는 북쪽 급식실(c) 뒷문과 남쪽 중앙 현관(s) 정문 둘.
 * 가구는 칸 하나를 차지하고 길찾기에서는 막힌 칸으로 친다. 장승(봉인 터 후보)도 가구다.
 */

export const CELL = 2;

const RAW = [
  "##############X##############",
  "#aaaa#bbbbb#ccccc#ddddd#eeee#",
  "#aaaa#bbbbb#ccccc#ddddd#eeee#",
  "#aaaa#bbbbb#ccccc#ddddd#eeee#",
  "###+####+#####+#####+####+###",
  "#...........................#",
  "#####.####+#######+####.#####",
  "#fff#.#ggggggggggggggg#.#hhh#",
  "#fff#.#ggggggggggggggg#.#hhh#",
  "#fff+.+ggggggggggggggg+.+hhh#",
  "#fff#.#ggggggggggggggg#.#hhh#",
  "#fff#.#ggggggggggggggg#.#hhh#",
  "#####.####+#######+####.#####",
  "#...........................#",
  "###+####+#####+#####+####+###",
  "#iiii#jjjjj#sssss#kkkkk#llll#",
  "#iiii#jjjjj#sssss#kkkkk#llll#",
  "#iiii#jjjjj#sssss#kkkkk#llll#",
  "##############X##############",
];

export const COLS = RAW[0].length;
export const ROWS = RAW.length;
export const CELLS = COLS * ROWS;
export const WORLD_W = COLS * CELL;
export const WORLD_D = ROWS * CELL;

export const ROOM_NAMES: Record<string, string> = {
  a: "1학년 1반",
  b: "과학실",
  c: "급식실",
  d: "미술실",
  e: "음악실",
  f: "보건실",
  g: "강당",
  h: "도서실",
  i: "숙직실",
  j: "교무실",
  k: "방송실",
  l: "체육 창고",
  s: "중앙 현관",
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

/** 0 벽 · 1 바닥 · 2 문 · 3 교문 */
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
  /** 강당 문 (처음부터 열려 있다) */
  gym: boolean;
}

export const DOORS: DoorDef[] = [];
/** 칸 → 문 번호 (-1 없음) */
export const DOOR_AT = new Int16Array(CELLS).fill(-1);
for (let i = 0; i < CELLS; i++) {
  if (KIND[i] !== 2) continue;
  const c = colOf(i);
  const r = rowOf(i);
  const ns = KIND[idx(c - 1, r)] === 0 && KIND[idx(c + 1, r)] === 0;
  const around = [ROOM[idx(c - 1, r)], ROOM[idx(c + 1, r)], ROOM[idx(c, r - 1)], ROOM[idx(c, r + 1)]];
  DOOR_AT[i] = DOORS.length;
  DOORS.push({ i: DOORS.length, cell: i, x: cellX(c), z: cellZ(r), ns, gym: around.includes("g") });
}

/** 문틀 기둥 두께 — 문 칸은 폭 1.4m 통로 */
export const DOOR_POST = 0.3;

/* ── 가구 ───────────────────────────────────────────────────────────── */

export type FurnitureKind = "totem" | "desk" | "locker" | "shelf" | "piano" | "vault" | "pillar";

export interface Furniture {
  kind: FurnitureKind;
  cell: number;
  x: number;
  z: number;
  /** 정면이 보는 방향 (라디안, +z = 0) */
  rot: number;
  box: Box;
  /** 장승이면 봉인 터 후보 번호 */
  spot: number;
}

export interface SpotDef {
  i: number;
  cell: number;
  x: number;
  z: number;
  room: string;
}

/** 봉인 터 후보 12곳 (판마다 이 중 몇 곳만 깨어난다) */
const SPOT_CELLS: [number, number][] = [
  [1, 1], [10, 1], [18, 1], [27, 1],
  [1, 9], [27, 9],
  [1, 17], [10, 17], [18, 17], [27, 17],
  [12, 8], [16, 10],
];

const DECOR_CELLS: [FurnitureKind, number, number][] = [
  ["locker", 4, 1], ["shelf", 1, 3],
  ["desk", 7, 2], ["desk", 9, 2],
  ["locker", 12, 3], ["locker", 16, 3],
  ["desk", 19, 2], ["desk", 21, 2],
  ["piano", 24, 1],
  ["shelf", 1, 7], ["locker", 3, 11],
  ["shelf", 27, 7], ["locker", 25, 11],
  ["pillar", 9, 8], ["pillar", 19, 8], ["pillar", 9, 10], ["pillar", 19, 10], ["vault", 14, 9],
  ["locker", 4, 17],
  ["desk", 7, 16], ["desk", 9, 16],
  ["locker", 12, 15], ["locker", 16, 15],
  ["desk", 19, 16], ["desk", 21, 16],
  ["shelf", 24, 17],
];

export interface ExitDef {
  i: number;
  name: string;
  /** 여기 닿으면 탈출 */
  x: number;
  z: number;
  /** 문이 붙은 벽 쪽 (-1 북 / +1 남) */
  dir: -1 | 1;
}

export const EXITS: ExitDef[] = [
  { i: 0, name: "뒷문 (급식실)", x: cellX(14), z: cellZ(1) - 0.55, dir: -1 },
  { i: 1, name: "정문 (중앙 현관)", x: cellX(14), z: cellZ(17) + 0.55, dir: 1 },
];

/** 시작 자리 후보 — 서로 다른 방 (누가 어디서 시작하는지 아무도 모른다) */
export const SPAWN_CELLS = [idx(2, 2), idx(26, 2), idx(2, 16), idx(26, 16), idx(2, 8), idx(26, 10), idx(8, 2), idx(20, 16)];

export const FURNITURE: Furniture[] = [];
export const SPOTS: SpotDef[] = [];
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

const SIZE: Record<FurnitureKind, [number, number]> = {
  totem: [0.7, 0.7],
  desk: [1.3, 0.8],
  locker: [1.4, 0.5],
  shelf: [1.6, 0.45],
  piano: [1.5, 0.75],
  vault: [1.5, 0.7],
  pillar: [0.8, 0.8],
};

function addFurniture(kind: FurnitureKind, c: number, r: number, spot = -1) {
  const cell = idx(c, r);
  // 책상·뜀틀·기둥은 칸 한가운데, 나머지는 벽에 붙인다
  const center = kind === "desk" || kind === "vault" || kind === "pillar";
  const w = center ? { dx: 0, dz: 0 } : wallDir(c, r);
  const [along, deep] = SIZE[kind];
  const free = w.dx === 0 && w.dz === 0;
  const off = free ? 0 : 1 - deep / 2 - 0.02;
  const x = cellX(c) + w.dx * off;
  const z = cellZ(r) + w.dz * off;
  const alongX = free ? true : w.dx === 0;
  const hx = (alongX ? along : deep) / 2;
  const hz = (alongX ? deep : along) / 2;
  const rot = free ? 0 : Math.atan2(-w.dx, -w.dz);
  FURN_AT[cell] = FURNITURE.length;
  FURNITURE.push({ kind, cell, x, z, rot, box: { x0: x - hx, z0: z - hz, x1: x + hx, z1: z + hz }, spot });
}

SPOT_CELLS.forEach(([c, r], i) => {
  addFurniture("totem", c, r, i);
  const f = FURNITURE[FURNITURE.length - 1];
  SPOTS.push({ i, cell: idx(c, r), x: f.x, z: f.z, room: ROOM[idx(c, r)] });
});
for (const [kind, c, r] of DECOR_CELLS) addFurniture(kind, c, r);

/** 길찾기에서 못 지나가는 칸 (벽·교문·가구) */
export const BLOCKED = new Uint8Array(CELLS);
for (let i = 0; i < CELLS; i++) BLOCKED[i] = KIND[i] === 0 || KIND[i] === 3 || FURN_AT[i] >= 0 ? 1 : 0;

/** 걸어 다닐 수 있는 칸 전부 */
export const WALKABLE: number[] = [];
for (let i = 0; i < CELLS; i++) if (!BLOCKED[i]) WALKABLE.push(i);
/** 방 안 바닥 칸만 */
export const ROOM_CELLS = WALKABLE.filter((i) => KIND[i] === 1 && ROOM[i] !== ".");

/** 그 칸의 상하좌우 중 걸을 수 있는 칸 (가구·장승 앞에 설 자리) */
export function accessCells(cell: number): number[] {
  const c = colOf(cell);
  const r = rowOf(cell);
  const out: number[] = [];
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const nc = c + dc;
    const nr = r + dr;
    if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
    if (!BLOCKED[idx(nc, nr)]) out.push(idx(nc, nr));
  }
  return out;
}

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
export function distField(from: number, closed?: ArrayLike<boolean | number> | null, muffle = 0): Float32Array {
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
