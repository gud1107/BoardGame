import { BODY_R } from "./data";

/**
 * 산골 고택 — 2m 칸 격자 지도 (27×23칸 = 54×46m). ㅁ자 집: 가운데 마당을 툇마루가 두르고 네 채가 둘러싼다.
 *
 *   #  벽   W  장롱·뒤주 (길·시선을 막는다)   J  장독  O  우물 (길만 막고 시선은 통한다)
 *   F  마당 화로 (결계)   P  사당 제상   .  툇마루   +  문   글자  방 바닥
 *
 * 북채: 곳간(s)·안방(a)·대청(d, 마당 쪽이 트였다)·건넌방(b). 서채 부엌(k), 동채 사랑방(r).
 * 남채: 행랑채(h)·대문간(g)·사당(p). 방끼리 문이 이어져 있어 툇마루를 안 거치고 돌아갈 수도 있다.
 */

export const CELL = 2;

const RAW = [
  "###########################",
  "#sssss#aaaaaa#ddddd#bbbbbb#",
  "#sWsWs#aWaaWa#ddddd#bWbbWb#",
  "#sssss+aaaaaa+ddddd+bbbbbb#",
  "#sWsss#aaaaaa#ddddd#bbbbWb#",
  "#sssss#aaWWaa#ddddd#bbbbbb#",
  "###+######+###.....###+####",
  "#.........................#",
  "#kkkkk#.mmmmmmmmmmm.#rrrrr#",
  "#kWkkk#.mJmmmmmmmJm.#rrWrr#",
  "#kkkkk#.mmmmmmmmmmm.#rrrrr#",
  "#kkkkk+.mmmmmFmmmmm.+rrrrr#",
  "#kWkkk#.mmmmmmmmmmm.#rrrWr#",
  "#kkkkk#.mOmmmmmmmJm.#rrrrr#",
  "#kkkkk#.mmmmmmmmmmm.#rWrrr#",
  "#.........................#",
  "###+#########+########+####",
  "#hhhhhhhh#ggggggg#pppppppp#",
  "#hWhhWhhh#gggWggg#ppWppppp#",
  "#hhhhhhhh+ggggggg+pppppppp#",
  "#hhhWhhhh#ggWgggg#pppppWpp#",
  "#hhhhhhhh#ggggggg#pppPpppp#",
  "###########################",
];

export const COLS = RAW[0].length;
export const ROWS = RAW.length;
export const CELLS = COLS * ROWS;
export const WORLD_W = COLS * CELL;
export const WORLD_D = ROWS * CELL;
/** 지도 문자열 (테스트가 모양을 확인한다) */
export const MAP_ROWS: readonly string[] = RAW;

export const ROOM_NAMES: Record<string, string> = {
  s: "곳간",
  a: "안방",
  d: "대청",
  b: "건넌방",
  k: "부엌",
  m: "마당",
  r: "사랑방",
  h: "행랑채",
  g: "대문간",
  p: "사당",
  ".": "툇마루",
  "+": "문간",
};

/** 등잔을 켤 수 있는 방 (마당은 달빛, 툇마루는 어둡다) */
export const LANTERN_ROOMS = ["s", "a", "d", "b", "k", "r", "h", "g", "p"] as const;

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

/** 0 벽 · 1 바닥 · 4 장롱(길·시선 막음) · 5 장독·우물(길만 막음) · 6 화로 */
export const KIND = new Uint8Array(CELLS);
/** 방 글자 (툇마루 '.', 문 '+', 그 밖은 '#') */
export const ROOM: string[] = new Array(CELLS).fill("#");

for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLS; c++) {
    const ch = RAW[r][c];
    const i = idx(c, r);
    ROOM[i] = ch === "W" || ch === "P" || ch === "J" || ch === "O" || ch === "F" ? "#" : ch;
    KIND[i] = ch === "#" ? 0 : ch === "W" || ch === "P" ? 4 : ch === "J" || ch === "O" ? 5 : ch === "F" ? 6 : 1;
  }
// 가구 칸은 둘러싼 방 이름을 물려받는다
for (let i = 0; i < CELLS; i++) {
  if (ROOM[i] !== "#" || KIND[i] === 0) continue;
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

export function roomAt(x: number, z: number): string {
  return ROOM[cellAt(x, z)];
}

export function roomNameAt(x: number, z: number): string {
  return ROOM_NAMES[roomAt(x, z)] ?? "";
}

export interface Box {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/* ── 가구 ───────────────────────────────────────────────────────────── */

export type FurnitureKind = "chest" | "jar" | "cabinet" | "altar";

export interface Furniture {
  kind: FurnitureKind;
  cell: number;
  x: number;
  z: number;
  /** 정면이 보는 방향 (라디안, +z = 0) */
  rot: number;
  box: Box;
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
  [1, 1], [5, 1], [1, 5], [5, 5], // s 곳간
  [7, 1], [12, 1], [7, 5], [12, 5], // a 안방
  [14, 1], [18, 1], // d 대청
  [20, 1], [25, 1], [20, 5], [25, 5], // b 건넌방
  [1, 8], [5, 8], [1, 14], [5, 14], // k 부엌
  [21, 8], [25, 8], [25, 14], [21, 14], // r 사랑방
  [1, 17], [8, 17], [1, 21], [8, 21], // h 행랑채
  [10, 17], [16, 17], [10, 21], [16, 21], // g 대문간
  [18, 17], [25, 17], [18, 21], [25, 21], // p 사당
];

/** 마당 화로 */
export const BRAZIER_CELL = idx(13, 11);
export const BRAZIER = { x: cellX(13), z: cellZ(11) };
/** 퇴마사 시작 자리 (화로 남쪽) */
export const START_CELLS = [idx(13, 13), idx(12, 13), idx(14, 13), idx(11, 13), idx(15, 13)];

/** 방마다 등잔 하나 (바닥에 놓인 작은 등 — 길을 막지 않는다) */
export const LANTERN_CELLS: Record<string, number> = { s: idx(3, 3), a: idx(10, 3), d: idx(16, 3), b: idx(22, 3), k: idx(3, 11), r: idx(23, 11), h: idx(6, 19), g: idx(14, 19), p: idx(22, 19) };
export const LANTERNS = LANTERN_ROOMS.map((room, i) => ({ i, room, cell: LANTERN_CELLS[room], ...centerOf(LANTERN_CELLS[room]) }));

export const FURNITURE: Furniture[] = [];
export const CONTAINERS: ContainerDef[] = [];
/** 칸 → 가구 번호 (-1 없음) */
export const FURN_AT = new Int16Array(CELLS).fill(-1);

const solidCell = (k: number) => k === 0 || k === 4;

function wallDir(c: number, r: number): { dx: number; dz: number } {
  if (solidCell(KIND[idx(c, r - 1)])) return { dx: 0, dz: -1 };
  if (solidCell(KIND[idx(c, r + 1)])) return { dx: 0, dz: 1 };
  if (solidCell(KIND[idx(c - 1, r)])) return { dx: -1, dz: 0 };
  if (solidCell(KIND[idx(c + 1, r)])) return { dx: 1, dz: 0 };
  return { dx: 0, dz: 0 };
}

function addFurniture(kind: FurnitureKind, c: number, r: number, container = -1) {
  const cell = idx(c, r);
  const w = wallDir(c, r);
  const [along, deep] = kind === "chest" ? [1.3, 0.7] : kind === "jar" ? [1.1, 1.1] : kind === "cabinet" ? [1.2, 0.6] : [1.6, 0.7];
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

/** 방마다 어울리는 수납: 곳간·부엌은 항아리, 사당은 제기함, 나머지는 반닫이 */
CONTAINER_CELLS.forEach(([c, r], i) => {
  const room = ROOM[idx(c, r)];
  CONTAINERS.push({ i, cell: idx(c, r), x: cellX(c), z: cellZ(r), room });
  addFurniture(room === "s" || room === "k" ? "jar" : room === "p" ? "cabinet" : "chest", c, r, i);
});

/** 길찾기에서 못 지나가는 칸 (벽·장롱·장독·화로·수납) */
export const BLOCKED = new Uint8Array(CELLS);
for (let i = 0; i < CELLS; i++) BLOCKED[i] = KIND[i] !== 1 || FURN_AT[i] >= 0 ? 1 : 0;

export const WALKABLE: number[] = [];
for (let i = 0; i < CELLS; i++) if (!BLOCKED[i]) WALKABLE.push(i);

/** 문 칸 ('+') — 원귀의 💥 덜컹 대상 */
export const DOOR_CELLS: number[] = [];
for (let i = 0; i < CELLS; i++) if (ROOM[i] === "+") DOOR_CELLS.push(i);

/** 원귀가 떠다닐 수 있는 범위 (바깥 담장 안) */
export const GHOST_MIN = CELL + 0.4;
export const GHOST_MAX_X = WORLD_W - CELL - 0.4;
export const GHOST_MAX_Z = WORLD_D - CELL - 0.4;

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

/** 장롱 한 칸의 실제 크기 (칸 가장자리에 살짝 틈) */
const SHELF_INSET = 0.12;

/**
 * 원(반지름 r)을 벽·장롱·장독·화로·수납에서 밀어낸다. `bodies`를 주면 그 원들(다른 사람)에서도 밀어낸다.
 * 퇴마사(직접 조작·봇)가 쓴다. 원귀는 벽을 뚫고 다니므로 `clampGhost`만 쓴다.
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
        if (k === 0 || k === 4 || k === 5 || k === 6) {
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

/** 그 점에서 시선이 막히나 (벽·장롱. 장독·우물·화로 너머는 보인다) */
export function sightBlockedAt(x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= WORLD_W || z >= WORLD_D) return true;
  const k = KIND[cellAt(x, z)];
  return k === 0 || k === 4;
}

/** 두 점 사이가 벽·장롱에 안 막혔나 (보는 판정·손전등) */
export function clearLine(x0: number, z0: number, x1: number, z1: number): boolean {
  const d = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.ceil(d / 0.35);
  for (let i = 1; i < n; i++) {
    const k = i / n;
    if (sightBlockedAt(x0 + (x1 - x0) * k, z0 + (z1 - z0) * k)) return false;
  }
  return true;
}

/** 원귀 위치를 담장 안으로, 그리고 화로 결계 밖으로 */
export function clampGhost(p: { x: number; z: number }, ward: number) {
  p.x = Math.max(GHOST_MIN, Math.min(GHOST_MAX_X, p.x));
  p.z = Math.max(GHOST_MIN, Math.min(GHOST_MAX_Z, p.z));
  const dx = p.x - BRAZIER.x;
  const dz = p.z - BRAZIER.z;
  const d = Math.hypot(dx, dz);
  if (d < ward) {
    const k = d < 1e-4 ? 1 : ward / d;
    p.x = BRAZIER.x + (d < 1e-4 ? ward : dx * k);
    p.z = BRAZIER.z + (d < 1e-4 ? 0 : dz * k);
  }
}

/** 방이 등잔으로 밝혀졌나 (마당은 달빛 — 따로 센다) */
export function lanternOf(room: string): number {
  return (LANTERN_ROOMS as readonly string[]).indexOf(room);
}
