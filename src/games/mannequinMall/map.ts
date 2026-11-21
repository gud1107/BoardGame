import { BODY_R } from "./data";

/**
 * 폐점한 백화점 2층 — 2m 칸 격자 지도 (31×21칸 = 62×42m).
 *
 *   #  벽   S  키 큰 진열장(길·시선을 막는다)   E  에스컬레이터 빈 공간(길은 막고 시선은 통한다)
 *   P  배전반   X  정문 셔터(잠긴 출구)   .  통로   +  문간   글자  매장 바닥
 *
 * 북쪽에 창고(w)·여성복(b)·직원 휴게실(k), 가운데 에스컬레이터 홀(e)을 사이에 두고 남성복(c)·아동복(d),
 * 남쪽에 신발(f)·화장품(a, 시작·정문)·잡화(g). 남북 큰 통로 두 줄(6·14행)과 홀 양옆 세로 통로가
 * 이어져 어디서든 두 갈래로 돌아갈 수 있고, 진열장 줄 사이로 시선이 끊기는 모퉁이가 많다.
 */

export const CELL = 2;

const RAW = [
  "###############################",
  "#wwwww#bbbbbbbbbbbbbbbbbb#kkkk#",
  "#wSwSw#bbSSSbbSSSbbSSSbbb#kkkk#",
  "#wwwww+bbbbbbbbbbbbbbbbbb+kkkk#",
  "#wSwSw#bbSSSbbSSSbbSSSbbb#kkkk#",
  "#wwwww#bbbbbbbbbbbbbbbbbb#kkkk#",
  "###+###..................###+##",
  "#ccccccccccc.eeeee.ddddddddddd#",
  "#cSSScSSSccc.EEEEE.dddSSSdSSSd#",
  "#ccccccccccc.EEEEE.ddddddddddd#",
  "#cSSScSSSccc.EEEEE.dddSSSdSSSd#",
  "#ccccccccccc.EEEEE.ddddddddddd#",
  "#cSSScSSSccc.eePee.dddSSSdSSSd#",
  "#ccccccccccc.eeeee.ddddddddddd#",
  "#.............................#",
  "#fffffffff.aaaaaaaaa.ggggggggg#",
  "#fSSfSSfff.aaaaaaaaa.gggSSgSSg#",
  "#fffffffff.aaaaaaaaa.ggggggggg#",
  "#fSSfSSfff.aaaaaaaaa.gggSSgSSg#",
  "#fffffffff.aaaaaaaaa.ggggggggg#",
  "###############X###############",
];

export const COLS = RAW[0].length;
export const ROWS = RAW.length;
export const CELLS = COLS * ROWS;
export const WORLD_W = COLS * CELL;
export const WORLD_D = ROWS * CELL;
/** 지도 문자열 (테스트가 모양을 확인한다) */
export const MAP_ROWS: readonly string[] = RAW;

export const ROOM_NAMES: Record<string, string> = {
  w: "창고",
  b: "여성복",
  k: "직원 휴게실",
  c: "남성복",
  e: "에스컬레이터 홀",
  d: "아동복",
  f: "신발",
  a: "화장품",
  g: "잡화·가방",
  ".": "통로",
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

/** 0 벽 · 1 바닥 · 3 셔터 · 4 진열장 · 5 에스컬레이터 빈 곳 · 6 배전반 */
export const KIND = new Uint8Array(CELLS);
/** 매장 글자 (통로 '.', 문간 '+', 그 밖은 '#') */
export const ROOM: string[] = new Array(CELLS).fill("#");

for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLS; c++) {
    const ch = RAW[r][c];
    const i = idx(c, r);
    ROOM[i] = ch === "S" || ch === "E" || ch === "P" || ch === "X" ? "#" : ch;
    KIND[i] = ch === "#" ? 0 : ch === "X" ? 3 : ch === "S" ? 4 : ch === "E" ? 5 : ch === "P" ? 6 : 1;
  }
// 진열장·배전반·빈 곳은 둘러싼 매장 이름을 물려받는다 (지도 글자용)
for (let i = 0; i < CELLS; i++) {
  if (ROOM[i] !== "#" || KIND[i] === 0 || KIND[i] === 3) continue;
  const c = colOf(i);
  const r = rowOf(i);
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const ch = RAW[r + dr]?.[c + dc];
    if (ch && ROOM_NAMES[ch] && ch !== "." && ch !== "+") {
      ROOM[i] = ch;
      break;
    }
  }
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

/* ── 가구 ───────────────────────────────────────────────────────────── */

export type FurnitureKind = "counter" | "box" | "locker" | "panel";

export interface Furniture {
  kind: FurnitureKind;
  cell: number;
  x: number;
  z: number;
  /** 정면이 보는 방향 (라디안, +z = 0) */
  rot: number;
  box: Box;
  /** 뒤질 수 있는 곳이면 번호 */
  container: number;
}

export interface ContainerDef {
  i: number;
  cell: number;
  x: number;
  z: number;
  room: string;
}

const CONTAINER_CELLS: [number, number][] = [
  [1, 1], [5, 1], [1, 5], [5, 5], // w 창고
  [7, 1], [13, 1], [19, 1], [24, 1], [24, 5], // b 여성복
  [26, 1], [29, 1], [29, 5], // k 직원 휴게실
  [1, 7], [1, 11], [9, 13], // c 남성복
  [29, 7], [29, 11], [21, 13], // d 아동복
  [13, 13], [17, 13], // e 안내 데스크
  [1, 15], [1, 19], [9, 19], // f 신발
  [12, 16], [18, 16], // a 화장품
  [29, 15], [29, 19], [21, 19], // g 잡화
];

export const PANEL_CELL = idx(15, 12);
/** 배전반 앞 (퓨즈를 꽂는 자리 기준점) */
export const PANEL = { x: cellX(15), z: cellZ(12) + 0.45 };
export const EXIT_CELL = idx(15, 20);
/** 셔터 앞 (여기 닿으면 탈출) */
export const EXIT = { x: cellX(15), z: cellZ(19) + 0.55 };
export const START_CELLS = [idx(15, 18), idx(14, 18), idx(16, 18), idx(15, 17)];

/** 진열된 마네킹 자리 — 이 중 몇 개만 살아 있다 (누가 살아 있는지는 겉으로 안 보인다) */
export const MANNEQUIN_CELLS: number[] = [
  [8, 3], [12, 3], [17, 3], [22, 3], [10, 1], [16, 5], [21, 5], // b
  [3, 3], // w
  [27, 3], // k
  [5, 9], [9, 11], [2, 13], [5, 7], // c
  [25, 9], [21, 11], [28, 13], [25, 7], // d
  [17, 7], // e
  [3, 17], [7, 15], [5, 19], // f
  [11, 15], [19, 15], // a
  [23, 17], [27, 15], [25, 19], // g
].map(([c, r]) => idx(c, r));

export const FURNITURE: Furniture[] = [];
export const CONTAINERS: ContainerDef[] = [];
/** 칸 → 가구 번호 (-1 없음) */
export const FURN_AT = new Int16Array(CELLS).fill(-1);

const solidCell = (k: number) => k === 0 || k === 3 || k === 4;

function wallDir(c: number, r: number): { dx: number; dz: number } {
  if (solidCell(KIND[idx(c, r - 1)])) return { dx: 0, dz: -1 };
  if (solidCell(KIND[idx(c, r + 1)])) return { dx: 0, dz: 1 };
  if (solidCell(KIND[idx(c - 1, r)])) return { dx: -1, dz: 0 };
  if (solidCell(KIND[idx(c + 1, r)])) return { dx: 1, dz: 0 };
  return { dx: 0, dz: 0 };
}

function addFurniture(kind: FurnitureKind, c: number, r: number, container = -1) {
  const cell = idx(c, r);
  const w = kind === "panel" ? { dx: 0, dz: -1 } : wallDir(c, r);
  const [along, deep] = kind === "counter" ? [1.5, 0.75] : kind === "box" ? [1.4, 1.0] : kind === "locker" ? [1.2, 0.55] : [1.6, 0.5];
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
  const room = ROOM[idx(c, r)];
  CONTAINERS.push({ i, cell: idx(c, r), x: cellX(c), z: cellZ(r), room });
  addFurniture(room === "w" ? "box" : room === "k" ? "locker" : "counter", c, r, i);
});
addFurniture("panel", 15, 12);

/** 길찾기에서 못 지나가는 칸 (벽·셔터·진열장·빈 곳·배전반·가구) */
export const BLOCKED = new Uint8Array(CELLS);
for (let i = 0; i < CELLS; i++) BLOCKED[i] = KIND[i] !== 1 || FURN_AT[i] >= 0 ? 1 : 0;

export const WALKABLE: number[] = [];
for (let i = 0; i < CELLS; i++) if (!BLOCKED[i]) WALKABLE.push(i);

/* ── 길찾기 ─────────────────────────────────────────────────────────── */

const DIAG = CELL * Math.SQRT2;
const NB: [number, number, number][] = [
  [1, 0, CELL], [-1, 0, CELL], [0, 1, CELL], [0, -1, CELL],
  [1, 1, DIAG], [1, -1, DIAG], [-1, 1, DIAG], [-1, -1, DIAG],
];

/** `from` 칸에서 모든 칸까지 걸어서 잰 거리(m). 대각선은 양옆이 모두 뚫려 있을 때만. */
export function distField(from: number): Float32Array {
  const dist = new Float32Array(CELLS).fill(Infinity);
  dist[from] = 0;
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
      // dist가 Float32라 같은 정밀도로 맞춘다 (안 그러면 꺼낼 때 "낡은 값"으로 오해해 버린다)
      const nk = Math.fround(k + cost);
      if (nk < dist[m]) {
        dist[m] = nk;
        push(m, nk);
      }
    }
  }
  return dist;
}

const walkCache = new Map<number, Float32Array>();

/** 걸어서 `target` 칸까지의 거리장. 칸마다 한 번만 계산. */
export function walkField(target: number): Float32Array {
  let f = walkCache.get(target);
  if (!f) {
    f = distField(target);
    walkCache.set(target, f);
  }
  return f;
}

/** 막힌 칸 위에 선 좌표라면 가장 가까운 걸을 수 있는 칸으로 */
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

/** 두 점 사이 걸어서 잰 거리 (같은 칸이면 직선거리) */
export function pathDist(x0: number, z0: number, x1: number, z1: number): number {
  const a = walkCellAt(x0, z0);
  const b = walkCellAt(x1, z1);
  if (a === b) return Math.hypot(x1 - x0, z1 - z0);
  const f = walkField(b)[a];
  return Math.max(Math.hypot(x1 - x0, z1 - z0), Number.isFinite(f) ? f : Infinity);
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

/** 진열장 한 칸의 실제 판 크기 (칸 가장자리에 살짝 틈) */
const SHELF_INSET = 0.12;

/**
 * 원(반지름 r)을 벽·진열장·빈 곳·가구에서 밀어낸다. `bodies`를 주면 그 원들(마네킹)에서도 밀어낸다.
 * 사람(직접 조작·봇)과 마네킹이 함께 쓴다.
 */
export function collide(p: { x: number; z: number }, r = BODY_R, bodies?: readonly { x: number; z: number }[] | null, bodyR = 0.32) {
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
        if (k === 0 || k === 3 || k === 4 || k === 5) {
          const inset = k === 4 ? SHELF_INSET : 0;
          box.x0 = c * CELL + inset;
          box.x1 = (c + 1) * CELL - inset;
          box.z0 = rw * CELL + inset;
          box.z1 = (rw + 1) * CELL - inset;
          pushOut(p, box, r);
        } else if (FURN_AT[i] >= 0) {
          pushOut(p, FURNITURE[FURN_AT[i]].box, r);
        }
      }
    if (bodies)
      for (const b of bodies) {
        const dx = p.x - b.x;
        const dz = p.z - b.z;
        const d = Math.hypot(dx, dz);
        const need = r + bodyR;
        if (d >= need || d < 1e-6) continue;
        p.x = b.x + (dx / d) * need;
        p.z = b.z + (dz / d) * need;
      }
  }
  p.x = Math.max(r, Math.min(WORLD_W - r, p.x));
  p.z = Math.max(r, Math.min(WORLD_D - r, p.z));
}

/** 그 점에서 시선이 막히나 (벽·셔터·키 큰 진열장. 낮은 계산대·빈 곳 너머는 보인다) */
export function sightBlockedAt(x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= WORLD_W || z >= WORLD_D) return true;
  const k = KIND[cellAt(x, z)];
  return k === 0 || k === 3 || k === 4;
}

/** 두 점 사이가 벽·진열장에 안 막혔나 (보는 판정·손전등) */
export function clearLine(x0: number, z0: number, x1: number, z1: number): boolean {
  const d = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.ceil(d / 0.35);
  for (let i = 1; i < n; i++) {
    const k = i / n;
    if (sightBlockedAt(x0 + (x1 - x0) * k, z0 + (z1 - z0) * k)) return false;
  }
  return true;
}
