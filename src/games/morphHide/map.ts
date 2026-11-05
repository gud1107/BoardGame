/**
 * 변신 숨바꼭질 — 맵. 한밤의 숨바꼭질 저택(1.5배로 넓힘) + 앞마당 + 도로·건널목 + 공원.
 *
 * 모든 충돌은 축 정렬 상자(`Solid`) 하나로 통일한다: 벽·바닥 슬래브·계단 단·가구·상자·지붕.
 * 걷기 판정은 "발 높이 + STEP보다 높은 상자는 벽, 낮은 상자는 밟고 올라선다"뿐이라
 * 계단·상자 파쿠르·옥상이 같은 규칙으로 된다(physics.ts).
 *
 * 좌표: x 오른쪽(동), z 화면 앞(남), y 위. 단위 m. 집 앞(남)이 마당 → 도로 → 공원.
 */

import type { PropKind } from "../hideAndSeek/house";

export type OutdoorKind =
  | "trashcan"
  | "hydrant"
  | "bench"
  | "cone"
  | "mailbox"
  | "vending"
  | "crate"
  | "chair"
  | "barrel"
  | "gnome"
  | "doghouse"
  | "bush"
  | "lamp"
  | "tree"
  | "fountain"
  | "trafficLight"
  | "chest";

export type ThingKind = PropKind | OutdoorKind;

export type SolidKind = "wall" | "floor" | "step" | "prop" | "glass" | "door" | "car";

export interface Solid {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
  k: SolidKind;
  /** 그릴 색 (없으면 안 그림 — 가구처럼 모델이 따로 있는 것) */
  c?: string;
  /** 소품 id (총에 맞으면 "엉뚱한 걸 쐈다"의 대상) */
  id?: string;
}

export const T = 0.2; // 벽 두께
export const FLOOR = [0, 3.0, 6.0] as const;
export const WALL_H = 2.8;
export const SLAB = 0.2;

/** 월드 경계 (이 밖으로는 못 나간다) */
export const BOUNDS = { x0: -16, x1: 12, z0: -8, z1: 40 } as const;

/** 술래 기지(마당 기둥) */
export const BASE = { x: 9, z: 9.5 } as const;

// ---------------------------------------------------------------------------
// 방 (라벨·미니맵·"지금 어디" 표시용)

export interface RoomDef {
  id: string;
  name: string;
  icon: string;
  floor: 0 | 1 | 2;
  box: readonly [number, number, number, number]; // x0 x1 z0 z1
  floorColor: string;
  wallColor: string;
}

export const ROOMS: readonly RoomDef[] = [
  { id: "garage", name: "창고", icon: "🧰", floor: 0, box: [-13.5, -7.5, -5.25, 5.25], floorColor: "#5b5751", wallColor: "#6f6a62" },
  { id: "hall", name: "현관", icon: "🚪", floor: 0, box: [-7.5, 0, 0, 5.25], floorColor: "#8a6a4a", wallColor: "#c9b79a" },
  { id: "living", name: "거실", icon: "🛋️", floor: 0, box: [0, 7.5, 0, 5.25], floorColor: "#7a5634", wallColor: "#b9c4a8" },
  { id: "bath", name: "욕실", icon: "🛁", floor: 0, box: [-7.5, 0, -5.25, 0], floorColor: "#9fb7c2", wallColor: "#d7e6ea" },
  { id: "kitchen", name: "부엌", icon: "🍳", floor: 0, box: [0, 7.5, -5.25, 0], floorColor: "#a88a62", wallColor: "#e7d9b8" },
  { id: "landing", name: "2층 복도", icon: "🪜", floor: 1, box: [-7.5, 0, 0, 5.25], floorColor: "#7d5c3e", wallColor: "#bfae93" },
  { id: "master", name: "안방", icon: "🛏️", floor: 1, box: [0, 7.5, 0, 5.25], floorColor: "#6e4c34", wallColor: "#c7a9a6" },
  { id: "kids", name: "아이방", icon: "🧸", floor: 1, box: [-7.5, 0, -5.25, 0], floorColor: "#8fa0c8", wallColor: "#f0d9a8" },
  { id: "study", name: "서재", icon: "📚", floor: 1, box: [0, 7.5, -5.25, 0], floorColor: "#5a3f2c", wallColor: "#8f9a7c" },
  { id: "attic", name: "다락방", icon: "🕸️", floor: 2, box: [-7.5, 0, -5.25, 0], floorColor: "#6b5541", wallColor: "#7b6650" },
];

export interface AreaDef {
  id: string;
  name: string;
  icon: string;
  box: readonly [number, number, number, number];
}

/** 바깥 구역 */
export const AREAS: readonly AreaDef[] = [
  { id: "alley", name: "뒷골목", icon: "🧱", box: [-16, 12, -8, -5.25] },
  { id: "yard", name: "앞마당", icon: "🌳", box: [-16, 12, -5.25, 14] },
  { id: "street", name: "건널목", icon: "🚦", box: [-16, 12, 14, 25] },
  { id: "park", name: "공원", icon: "⛲", box: [-16, 12, 25, 40] },
];

/** 지금 위치의 이름 (방 → 바깥 구역 → 지붕) */
export function placeName(x: number, y: number, z: number): { name: string; icon: string } {
  const floor = y > FLOOR[2] - 0.6 ? 2 : y > FLOOR[1] - 0.6 ? 1 : 0;
  for (const r of ROOMS) {
    if (r.floor !== floor) continue;
    const [x0, x1, z0, z1] = r.box;
    if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return r;
  }
  if (y > 2.4) return { name: "지붕 위", icon: "🏠" };
  for (const a of AREAS) {
    const [x0, x1, z0, z1] = a.box;
    if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return a;
  }
  return { name: "바깥", icon: "🌙" };
}

// ---------------------------------------------------------------------------
// 벽 빌더

interface Opening {
  at: number;
  w: number;
  /** 창문: 창턱 높이(층 바닥 기준). 없으면 문(바닥부터 뚫림) */
  sill?: number;
  top?: number;
}

const solids: Solid[] = [];

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, k: SolidKind, c?: string, id?: string) {
  solids.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0, y1, z0: Math.min(z0, z1), z1: Math.max(z0, z1), k, c, id });
}

/** axis "x": z=at에 놓여 x 방향으로 뻗는 벽 */
function wall(axis: "x" | "z", at: number, from: number, to: number, y: number, h: number, c: string, openings: Opening[] = []) {
  let cur = from;
  const put = (a: number, b: number, y0: number, y1: number) => {
    if (b - a < 0.01 || y1 - y0 < 0.01) return;
    if (axis === "x") box(a, b, y0, y1, at - T / 2, at + T / 2, "wall", c);
    else box(at - T / 2, at + T / 2, y0, y1, a, b, "wall", c);
  };
  for (const o of [...openings].sort((p, q) => p.at - q.at)) {
    const a = o.at - o.w / 2;
    const b = o.at + o.w / 2;
    put(cur, a, y, y + h);
    const top = Math.min(h, o.top ?? 2.2);
    if (o.sill !== undefined) put(a, b, y, y + o.sill);
    put(a, b, y + top, y + h);
    cur = b;
  }
  put(cur, to, y, y + h);
}

// ---------------------------------------------------------------------------
// 문 / 창문 (열고 닫기 — 닫히면 상자가 생긴다)

export interface DoorDef {
  id: number;
  axis: "x" | "z";
  /** 문 가운데 */
  x: number;
  z: number;
  y: number;
  w: number;
  /** 시작할 때 열려 있나 */
  open: boolean;
  name: string;
}

export interface WindowDef {
  id: number;
  axis: "x" | "z";
  x: number;
  z: number;
  y: number;
  w: number;
  sill: number;
  top: number;
  name: string;
}

export const DOORS: DoorDef[] = [];
export const WINDOWS: WindowDef[] = [];

function door(axis: "x" | "z", x: number, z: number, y: number, w: number, open: boolean, name: string): Opening {
  DOORS.push({ id: DOORS.length, axis, x, z, y, w, open, name });
  return { at: axis === "x" ? x : z, w };
}

function win(axis: "x" | "z", x: number, z: number, y: number, w: number, sill: number, top: number, name: string): Opening {
  WINDOWS.push({ id: WINDOWS.length, axis, x, z, y, w, sill, top, name });
  return { at: axis === "x" ? x : z, w, sill, top };
}

/** 닫힌 문·창문이 만드는 상자 */
export function doorSolid(d: DoorDef): Solid {
  const h = 2.2;
  return d.axis === "x"
    ? { x0: d.x - d.w / 2, x1: d.x + d.w / 2, y0: d.y, y1: d.y + h, z0: d.z - 0.06, z1: d.z + 0.06, k: "door" }
    : { x0: d.x - 0.06, x1: d.x + 0.06, y0: d.y, y1: d.y + h, z0: d.z - d.w / 2, z1: d.z + d.w / 2, k: "door" };
}

export function windowSolid(w: WindowDef): Solid {
  return w.axis === "x"
    ? { x0: w.x - w.w / 2, x1: w.x + w.w / 2, y0: w.y + w.sill, y1: w.y + w.top, z0: w.z - 0.04, z1: w.z + 0.04, k: "glass" }
    : { x0: w.x - 0.04, x1: w.x + 0.04, y0: w.y + w.sill, y1: w.y + w.top, z0: w.z - w.w / 2, z1: w.z + w.w / 2, k: "glass" };
}

// ---------------------------------------------------------------------------
// 집

const F0 = FLOOR[0];
const F1 = FLOOR[1];
const F2 = FLOOR[2];
const OUT = "#e6dccb";
const PART = "#d8cdbb";

// 1층 바깥벽
wall("x", -5.25, -13.5, 7.5, F0, WALL_H, OUT, [win("x", -3.75, -5.25, F0, 1.4, 0.8, 2.6, "욕실 창문"), door("x", 3.75, -5.25, F0, 1.4, false, "부엌 뒷문")]);
wall("x", 5.25, -13.5, 7.5, F0, WALL_H, OUT, [door("x", -10.5, 5.25, F0, 2.4, true, "창고 셔터"), door("x", -3.75, 5.25, F0, 1.4, false, "현관문"), win("x", 3.75, 5.25, F0, 2.0, 0.75, 2.6, "거실 창문")]);
wall("z", -13.5, -5.25, 5.25, F0, WALL_H, "#9a948b");
wall("z", 7.5, -5.25, 5.25, F0, WALL_H, OUT, [win("z", 7.5, -2.6, F0, 1.4, 0.8, 2.6, "부엌 창문"), door("z", 7.5, 2.6, F0, 1.4, false, "거실 옆문")]);
// 1층 칸막이
wall("z", -7.5, -5.25, 5.25, F0, WALL_H, PART, [door("z", -7.5, 2.6, F0, 1.4, true, "창고 문")]);
wall("z", 0, -5.25, 5.25, F0, WALL_H, PART, [door("z", 0, -2.6, F0, 1.4, true, "욕실-부엌 문"), door("z", 0, 2.6, F0, 1.4, true, "거실 문")]);
wall("x", 0, -7.5, 0, F0, WALL_H, PART, [door("x", -3.75, 0, F0, 1.4, true, "욕실 문")]);
wall("x", 0, 0, 7.5, F0, WALL_H, PART, [door("x", 3.75, 0, F0, 1.4, true, "부엌 문")]);

// 계단 (현관 앞쪽 z 4.3 → 뒤쪽 z 0.7로 오른다)
export const STAIR = { x0: -2.7, x1: -1.2, z0: 1.3, z1: 4.6, steps: 10 } as const;
for (let i = 0; i < STAIR.steps; i++) {
  const d = (STAIR.z1 - STAIR.z0) / STAIR.steps;
  box(STAIR.x0, STAIR.x1, F0, (i + 1) * (F1 / STAIR.steps), STAIR.z1 - (i + 1) * d, STAIR.z1 - i * d, "step", "#8d6e63");
}

// 2층 바닥 (계단 구멍 비움)
function slab(x0: number, x1: number, z0: number, z1: number, y: number, c: string) {
  box(x0, x1, y - SLAB, y, z0, z1, "floor", c);
}
slab(-7.5, STAIR.x0, -5.25, 5.25, F1, "#7d5c3e");
slab(STAIR.x1, 7.5, -5.25, 5.25, F1, "#6e4c34");
slab(STAIR.x0, STAIR.x1, -5.25, STAIR.z0, F1, "#7d5c3e");
slab(STAIR.x0, STAIR.x1, STAIR.z1, 5.25, F1, "#7d5c3e");
// 계단 구멍 난간 (위로 올라오는 쪽 z0만 트임)
box(STAIR.x0 - 0.08, STAIR.x0, F1, F1 + 0.95, STAIR.z0, STAIR.z1, "wall", "#6d4c41");
box(STAIR.x1, STAIR.x1 + 0.08, F1, F1 + 0.95, STAIR.z0, STAIR.z1, "wall", "#6d4c41");
box(STAIR.x0, STAIR.x1, F1, F1 + 0.95, STAIR.z1, STAIR.z1 + 0.08, "wall", "#6d4c41");

// 창고 지붕 (걸어 다닐 수 있다)
slab(-13.6, -7.5, -5.35, 5.35, F1, "#4a3b33");

// 2층 바깥벽 (집 본채 x -7.5~7.5)
wall("x", -5.25, -7.5, 7.5, F1, WALL_H, OUT, [win("x", -3.75, -5.25, F1, 1.4, 0.7, 2.6, "아이방 창문"), win("x", 3.75, -5.25, F1, 1.4, 0.7, 2.6, "서재 창문")]);
wall("x", 5.25, -7.5, 7.5, F1, WALL_H, OUT, [win("x", -3.75, 5.25, F1, 1.6, 0.7, 2.6, "복도 창문"), win("x", 3.75, 5.25, F1, 1.6, 0.7, 2.6, "안방 창문")]);
wall("z", -7.5, -5.25, 5.25, F1, WALL_H, OUT, [win("z", -7.5, 2.6, F1, 1.4, 0.55, 2.6, "창고 지붕 창문")]);
wall("z", 7.5, -5.25, 5.25, F1, WALL_H, OUT);
// 2층 칸막이
wall("z", 0, -5.25, 5.25, F1, WALL_H, PART, [door("z", 0, -2.6, F1, 1.4, true, "서재 쪽문"), door("z", 0, 2.6, F1, 1.4, true, "안방 문")]);
wall("x", 0, -7.5, 0, F1, WALL_H, PART, [door("x", -3.75, 0, F1, 1.4, true, "아이방 문")]);
wall("x", 0, 0, 7.5, F1, WALL_H, PART, [door("x", 3.75, 0, F1, 1.4, false, "서재 문")]);

// 다락 바닥 = 2층 지붕 (사다리 구멍만 비움)
export const LADDER = { x: -0.9, z: -4.4, hole: [-1.5, -0.3, -5.25, -3.6] as const } as const;
slab(-7.5, LADDER.hole[0], -5.25, 0, F2, "#6b5541");
slab(LADDER.hole[1], 0, -5.25, 0, F2, "#6b5541");
slab(LADDER.hole[0], LADDER.hole[1], LADDER.hole[3], 0, F2, "#6b5541");
// 나머지 2층 위는 평지붕 (다락 창문으로 나가서 걸을 수 있다)
slab(-7.5, 7.5, 0, 5.25, F2, "#3e3a46");
slab(0, 7.5, -5.25, 0, F2, "#3e3a46");
// 다락 벽 (낮은 박공)
wall("x", -5.25, -7.5, 0, F2, 1.9, "#7b6650");
wall("z", -7.5, -5.25, 0, F2, 1.9, "#7b6650");
wall("x", 0, -7.5, 0, F2, 1.9, "#7b6650", [win("x", -3.75, 0, F2, 1.4, 0.1, 1.9, "다락 지붕창")]);
wall("z", 0, -5.25, 0, F2, 1.9, "#7b6650");
// 다락 지붕
box(-7.6, 0.1, F2 + 1.9, F2 + 2.1, -5.35, 0.1, "wall", "#4a3b33");
// 평지붕 난간 (낮다 — 뛰어내릴 수 있다)
box(-7.5, 7.5, F2, F2 + 0.4, 5.15, 5.35, "wall", "#55505c");
box(7.4, 7.6, F2, F2 + 0.4, -5.25, 5.25, "wall", "#55505c");

// 집 앞 담·현관 계단·창고 옆 상자(지붕 오르기)
box(-15.0, -14.1, F0, 0.9, 0, 0.9, "prop", "#a97a45", "crate-a");
box(-14.1, -13.6, F0, 1.8, 0, 0.9, "prop", "#b9874f", "crate-b");

// ---------------------------------------------------------------------------
// 바깥: 담장·울타리·도로·공원

// 뒷골목 담 (높아서 못 넘는다)
box(BOUNDS.x0, BOUNDS.x1, F0, 2.6, BOUNDS.z0 - 0.3, BOUNDS.z0, "wall", "#5d5149");
// 옆 담
box(BOUNDS.x0 - 0.3, BOUNDS.x0, F0, 1.8, BOUNDS.z0, 14, "wall", "#7a6a5a");
box(BOUNDS.x1, BOUNDS.x1 + 0.3, F0, 1.8, BOUNDS.z0, 14, "wall", "#7a6a5a");
// 마당 앞 울타리 (낮다 — 점프로 넘는다), 문 두 곳
wall("x", 14, BOUNDS.x0, BOUNDS.x1, F0, 0.85, "#d7ccc8", [
  { at: -0.5, w: 3.2 },
  { at: -12, w: 2.0 },
]);
// 공원 산울타리
box(BOUNDS.x0 - 0.4, BOUNDS.x1 + 0.4, F0, 1.7, BOUNDS.z1, BOUNDS.z1 + 0.4, "wall", "#1e4620");
box(BOUNDS.x0 - 0.4, BOUNDS.x0, F0, 1.7, 25, BOUNDS.z1, "wall", "#1e4620");
box(BOUNDS.x1, BOUNDS.x1 + 0.4, F0, 1.7, 25, BOUNDS.z1, "wall", "#1e4620");
// 길 양 끝 (도로 밖으로 못 나가게 — 보이지 않는 벽)
box(BOUNDS.x0 - 0.4, BOUNDS.x0, F0, 3, 14, 25, "wall");
box(BOUNDS.x1, BOUNDS.x1 + 0.4, F0, 3, 14, 25, "wall");

export const ROAD = { z0: 16, z1: 23, crossX0: -2.5, crossX1: 1.5 } as const;

/** 고정 바깥 소품 (총에 맞으면 엉뚱한 걸 쏜 것) */
export interface PlacedThing {
  id: string;
  kind: ThingKind;
  x: number;
  y: number;
  z: number;
  rot: number;
}

export const THING_SIZE: Record<ThingKind, [number, number, number]> = {
  shelf: [1.4, 2.0, 0.5],
  bike: [0.3, 1.0, 1.4],
  boxes: [1.3, 1.1, 0.8],
  shoecab: [1.3, 1.2, 0.5],
  coats: [0.6, 1.9, 0.6],
  sofa: [2.0, 1.05, 0.9],
  curtain: [1.5, 2.1, 0.3],
  piano: [1.5, 1.3, 0.9],
  tub: [1.7, 0.6, 0.85],
  washer: [0.75, 0.9, 0.7],
  table: [1.8, 0.82, 1.1],
  pantry: [1.0, 2.2, 0.6],
  sink: [1.7, 0.95, 0.65],
  hamper: [0.8, 0.9, 0.8],
  plant: [0.7, 1.5, 0.7],
  wardrobe: [1.3, 2.3, 0.65],
  bed: [1.6, 0.9, 2.0],
  vanity: [0.9, 1.4, 0.45],
  toybox: [1.1, 0.78, 0.7],
  tent: [1.4, 1.8, 1.4],
  bunk: [1.5, 1.9, 0.9],
  desk: [1.6, 0.84, 0.8],
  bookcase: [1.5, 2.4, 0.45],
  trunk: [1.2, 0.75, 0.7],
  mannequin: [0.5, 1.8, 0.5],
  trashcan: [0.6, 1.0, 0.6],
  hydrant: [0.4, 0.8, 0.4],
  bench: [1.8, 0.85, 0.6],
  cone: [0.45, 0.7, 0.45],
  mailbox: [0.5, 1.3, 0.5],
  vending: [1.0, 1.9, 0.8],
  crate: [0.9, 0.9, 0.9],
  chair: [0.5, 0.95, 0.5],
  barrel: [0.6, 0.95, 0.6],
  gnome: [0.35, 0.6, 0.35],
  doghouse: [1.1, 1.0, 1.2],
  bush: [1.4, 1.1, 1.4],
  lamp: [0.3, 3.2, 0.3],
  tree: [0.5, 2.4, 0.5],
  fountain: [3.0, 0.8, 3.0],
  trafficLight: [0.3, 3.0, 0.3],
  chest: [0.9, 0.7, 0.6],
};

/** 몸이 통과하는 것 (덤불 속에 숨을 수 있다) */
export const PASSABLE: ReadonlySet<ThingKind> = new Set<ThingKind>(["bush"]);

/** 회전(90° 단위)을 반영한 바닥 크기 */
export function footprint(kind: ThingKind, rot: number): [number, number] {
  const [w, , d] = THING_SIZE[kind];
  const q = Math.round(rot / (Math.PI / 2)) & 1;
  return q ? [d, w] : [w, d];
}

export function thingSolid(t: PlacedThing): Solid | null {
  if (PASSABLE.has(t.kind)) return null;
  const [w, d] = footprint(t.kind, t.rot);
  const h = THING_SIZE[t.kind][1];
  return { x0: t.x - w / 2, x1: t.x + w / 2, y0: t.y, y1: t.y + h, z0: t.z - d / 2, z1: t.z + d / 2, k: "prop", id: t.id };
}

const HALF_PI = Math.PI / 2;

/** 저택 가구 (한밤의 숨바꼭질 숨을 곳 25곳을 1.5배 자리로) */
const FURNITURE: [PropKind, number, number, number, number][] = [
  // kind, x, z, floor, rot
  ["shelf", -12.4, -4.6, 0, 0],
  ["bike", -9.0, -1.8, 0, HALF_PI],
  ["boxes", -11.6, 2.4, 0, 0],
  ["shoecab", -6.6, 1.0, 0, HALF_PI],
  ["coats", -5.0, 0.6, 0, 0],
  ["sofa", 3.6, 3.9, 0, 0],
  ["curtain", 7.1, 4.4, 0, -HALF_PI],
  ["piano", 1.2, 0.8, 0, 0],
  ["tub", -5.4, -4.4, 0, 0],
  ["washer", -1.0, -4.6, 0, 0],
  ["table", 5.4, -2.0, 0, 0],
  ["pantry", 6.6, -4.6, 0, 0],
  ["sink", 1.4, -4.6, 0, 0],
  ["hamper", -6.6, 1.2, 1, 0],
  ["plant", -6.6, 4.6, 1, 0],
  ["wardrobe", 1.2, 0.7, 1, 0],
  ["bed", 4.7, 2.4, 1, 0],
  ["vanity", 6.9, 0.6, 1, 0],
  ["toybox", -2.2, -1.2, 1, 0],
  ["tent", -5.2, -1.8, 1, 0],
  ["bunk", -6.4, -4.4, 1, 0],
  ["desk", 5.2, -1.6, 1, 0],
  ["bookcase", 6.7, -3.9, 1, -HALF_PI],
  ["trunk", -5.4, -2.1, 2, 0],
  ["mannequin", -2.0, -3.9, 2, 0],
];

/** 바깥 고정 소품 (나무·가로등·벤치·분수…) */
const OUTDOOR: [OutdoorKind, number, number, number][] = [
  ["tree", -13.8, 9.8, 0],
  ["tree", 5.5, 11.5, 0],
  ["bush", -9, 12.6, 0],
  ["bush", 3, 12.6, 0],
  ["bush", 10.5, 4, 0],
  ["doghouse", -14.6, 11.4, HALF_PI],
  ["mailbox", -5.5, 13.4, 0],
  ["trafficLight", -3.0, 15.6, 0],
  ["trafficLight", 2.0, 23.2, 0],
  ["lamp", -10, 15.6, 0],
  ["lamp", 7, 15.6, 0],
  ["lamp", -9, 23.3, 0],
  ["lamp", 8, 23.3, 0],
  ["hydrant", 4.5, 15.7, 0],
  ["fountain", -2, 32, 0],
  ["tree", -12.5, 29, 0],
  ["tree", -13, 35, 0],
  ["tree", 8.5, 28.5, 0],
  ["tree", 9, 37, 0],
  ["tree", 2.5, 38, 0],
  ["bush", -8, 38, 0],
  ["bush", 5.5, 26.6, 0],
  ["bush", -14.4, 33, 0],
  ["bush", 10.6, 33, 0],
  ["bench", -7, 28.2, 0],
  ["bench", 3.5, 35.2, Math.PI],
  ["bench", -6.5, 37.0, Math.PI],
  ["trashcan", -9.4, 27.2, 0],
  ["trashcan", 6.2, 25.6, 0],
  ["vending", 10.8, 26.3, -HALF_PI],
  ["lamp", -4.6, 27, 0],
  ["lamp", 6.5, 31, 0],
];

export const FIXED_THINGS: PlacedThing[] = [
  ...FURNITURE.map(([kind, x, z, f, rot], i) => ({ id: `f${i}`, kind, x, y: FLOOR[f], z, rot })),
  ...OUTDOOR.map(([kind, x, z, rot], i) => ({ id: `o${i}`, kind, x, y: 0, z, rot })),
];

for (const t of FIXED_THINGS) {
  const s = thingSolid(t);
  if (!s) continue;
  if (t.kind === "tree") {
    // 줄기만 단단하다
    solids.push({ ...s, x0: t.x - 0.22, x1: t.x + 0.22, z0: t.z - 0.22, z1: t.z + 0.22 });
  } else if (t.kind === "lamp" || t.kind === "trafficLight") {
    solids.push({ ...s, x0: t.x - 0.12, x1: t.x + 0.12, z0: t.z - 0.12, z1: t.z + 0.12 });
  } else solids.push(s);
}

/** 바뀌지 않는 상자 전부 (문·창문·채움 소품·자동차는 판마다 따로) */
export const STATIC_SOLIDS: readonly Solid[] = solids;

// ---------------------------------------------------------------------------
// 판마다 새로 깔리는 소품 (변신할 물건이 맵 여기저기 "원래 있던 것처럼" 보이게)

export interface Slot {
  x: number;
  z: number;
  f: 0 | 1 | 2;
  /** 길 옆이라 긴 쪽을 길과 나란히 (회전 0/180°만) */
  lock?: boolean;
}

export const FILLER_SLOTS: readonly Slot[] = [
  // 창고
  { x: -12.6, z: -1.2, f: 0 },
  { x: -9.2, z: 3.6, f: 0 },
  { x: -12.4, z: 4.2, f: 0 },
  // 현관·거실·욕실·부엌
  { x: -6.4, z: 4.4, f: 0 },
  { x: 6.6, z: 1.0, f: 0 },
  { x: 1.2, z: 4.4, f: 0 },
  { x: -6.6, z: -1.2, f: 0 },
  { x: 6.6, z: -0.7, f: 0 },
  // 2층
  { x: -4.6, z: 4.5, f: 1 },
  { x: 1.2, z: 4.4, f: 1 },
  { x: -2.6, z: -4.6, f: 1 },
  { x: 1.2, z: -4.5, f: 1 },
  { x: 6.6, z: -0.7, f: 1 },
  // 다락
  { x: -6.6, z: -4.4, f: 2 },
  { x: -6.6, z: -0.8, f: 2 },
  // 뒷골목 (길 옆 담벼락에 붙여서)
  { x: -12, z: -7.5, f: 0, lock: true },
  { x: -5, z: -7.5, f: 0, lock: true },
  { x: 1.5, z: -7.5, f: 0, lock: true },
  { x: 8.5, z: -7.5, f: 0, lock: true },
  // 앞마당
  { x: -15, z: 9.0, f: 0 },
  { x: -8.5, z: 11.5, f: 0 },
  { x: -6.2, z: 6.8, f: 0 },
  { x: 2.0, z: 7.0, f: 0 },
  { x: 1.6, z: 12.2, f: 0 },
  { x: 10.6, z: 12.6, f: 0 },
  { x: -15, z: 13, f: 0 },
  // 인도
  { x: -13, z: 15.7, f: 0, lock: true },
  { x: -7, z: 15.7, f: 0, lock: true },
  { x: 9.8, z: 15.7, f: 0, lock: true },
  { x: -13, z: 24.9, f: 0, lock: true },
  { x: -5.5, z: 24.9, f: 0, lock: true },
  { x: 4.5, z: 24.9, f: 0, lock: true },
  // 공원
  { x: -13.5, z: 26.5, f: 0 },
  { x: -8.6, z: 33.4, f: 0 },
  { x: -6, z: 31.6, f: 0 },
  { x: 2, z: 28.2, f: 0 },
  { x: 5, z: 31.8, f: 0 },
  { x: 3, z: 33.6, f: 0 },
  { x: -3.4, z: 37.8, f: 0 },
  { x: 6, z: 38.4, f: 0 },
  { x: 10.4, z: 30, f: 0 },
];

/** 보물 상자 후보 */
export const CHEST_SLOTS: readonly Slot[] = [
  { x: -11, z: -3.4, f: 0 },
  { x: 5.8, z: -3.6, f: 0 },
  { x: 5.6, z: 4.1, f: 1 },
  { x: -3.0, z: -4.4, f: 2 },
  { x: -10.5, z: 0, f: 1 },
  { x: 2.5, z: 4.5, f: 2 },
  { x: -15.3, z: -7.3, f: 0 },
  { x: -13.6, z: 38.4, f: 0 },
  { x: 11.0, z: 39.2, f: 0 },
];

/** 꼼꼼이(찜) 장소 후보 */
export const GOAL_SLOTS: readonly (Slot & { name: string })[] = [
  { x: -4.6, z: -3.4, f: 2, name: "다락방" },
  { x: 10.4, z: -6.6, f: 0, name: "뒷골목 끝" },
  { x: -14.4, z: 38.2, f: 0, name: "공원 구석" },
  { x: 9.6, z: 38.2, f: 0, name: "공원 정자" },
  { x: -13.4, z: 12.4, f: 0, name: "마당 쪽문" },
  { x: 3.8, z: -6.6, f: 0, name: "부엌 뒤 골목" },
];

export function slotY(s: Slot): number {
  return FLOOR[s.f];
}

// ---------------------------------------------------------------------------
// 길찾기 그래프 (봇·NPC가 문·계단·사다리를 지나 다닌다)

export interface NavNode {
  id: number;
  x: number;
  y: number;
  z: number;
  /** 바깥 행인이 다니는 길 */
  out?: boolean;
  /** 경비원이 멈춰서 점검하는 곳 */
  inspect?: boolean;
}

export interface NavEdge {
  a: number;
  b: number;
  ladder?: boolean;
  /** 건널목 (행인은 보행 신호를 기다린다) */
  cross?: boolean;
}

const NODES_RAW: [number, number, number, ...("out" | "inspect")[]][] = [
  // 0~ 1층
  [-10.5, 0, -1.5, "inspect"], // 0 창고
  [-10.5, 0, 6.6], // 1 창고 셔터 밖
  [-7.5, 0, 2.6], // 2 창고-현관 문
  [-4.5, 0, 3.0, "inspect"], // 3 현관
  [-3.75, 0, 6.6], // 4 현관문 밖
  [0, 0, 2.6], // 5 현관-거실 문
  [3.8, 0, 2.2, "inspect"], // 6 거실
  [-3.75, 0, 0], // 7 현관-욕실 문
  [-3.75, 0, -2.6, "inspect"], // 8 욕실
  [0, 0, -2.6], // 9 욕실-부엌 문
  [3.75, 0, -3.3, "inspect"], // 10 부엌
  [3.75, 0, 0], // 11 거실-부엌 문
  [3.75, 0, -5.25], // 12 부엌 뒷문
  [3.75, 0, -6.6], // 13 뒷골목(부엌 뒤)
  [7.5, 0, 2.6], // 14 거실 옆문
  [9.6, 0, 2.6], // 15 옆마당
  // 계단
  [-1.95, 0, 4.82], // 16 계단 아래
  [-1.95, 3.0, 0.8], // 17 계단 위
  // 2층
  [-4.5, 3, 2.6, "inspect"], // 18 2층 복도
  [0, 3, 2.6], // 19 복도-안방 문
  [3.0, 3, 3.9, "inspect"], // 20 안방
  [-3.75, 3, 0], // 21 복도-아이방 문
  [-3.5, 3, -2.8, "inspect"], // 22 아이방
  [0, 3, -2.6], // 23 아이방-서재 문
  [3.8, 3, -3.0, "inspect"], // 24 서재
  [3.75, 3, 0], // 25 안방-서재 문
  [-0.9, 3, -3.4], // 26 사다리 아래
  [-0.9, 6, -3.0], // 27 사다리 위
  [-3.5, 6, -2.8, "inspect"], // 28 다락
  // 뒷골목
  [-14.2, 0, -6.6], // 29
  [10.4, 0, -6.6], // 30
  [-15.4, 0, 0.5], // 31 창고 옆(서쪽, 상자 옆 틈)
  // 앞마당
  [-12, 0, 9.5], // 32
  [-6, 0, 9.5], // 33
  [-0.5, 0, 10.5], // 34
  [5.5, 0, 9.0], // 35
  [9, 0, 9.5], // 36 술래 기지
  // 마당 문 → 인도
  [-0.5, 0, 13.2], // 37 마당 큰 문 안
  [-12, 0, 13.2], // 38 마당 쪽문 안
  [-12, 0, 14.7, "out"], // 39 인도 서
  [-0.5, 0, 14.7, "out"], // 40 인도 건널목
  [9.5, 0, 14.7, "out"], // 41 인도 동
  [-14.6, 0, 14.7, "out"], // 42 인도 서쪽 끝
  // 건너편
  [-0.5, 0, 24, "out"], // 43 건널목 남
  [-13, 0, 24, "out"], // 44
  [9.5, 0, 24, "out"], // 45
  // 공원
  [-11.5, 0, 27.5, "out"], // 46
  [-11, 0, 35.5, "out"], // 47
  [-4.6, 0, 30.5, "out"], // 48 분수 서
  [0.6, 0, 30.5, "out"], // 49 분수 동
  [-2, 0, 35.6, "out"], // 50 분수 남
  [7, 0, 29.5, "out"], // 51
  [7.4, 0, 37, "out"], // 52
  [-2, 0, 27, "out"], // 53 공원 입구
  [-14.2, 0, 38.2, "out"], // 54 공원 구석
  [9.8, 0, 38.4, "out"], // 55 정자
  [-3.4, 3, 0.75], // 56 계단 위 복도
  [-15.0, 0, 6.4], // 57 창고 앞 서쪽
  [-3.3, 0, 4.82], // 58 계단 앞
  [-4.6, 0, 34.6, "out"], // 59 분수 남서
  [0.6, 0, 34.6, "out"], // 60 분수 남동
  [-3.2, 0, 0.75], // 61 계단 뒤 통로(1층)
  [-0.6, 0, 1.0], // 62 계단 동쪽(1층)
  [-0.6, 3, 1.0], // 63 계단 동쪽(2층)
];

export const NAV_NODES: readonly NavNode[] = NODES_RAW.map(([x, y, z, ...tags], id) => ({ id, x, y, z, out: tags.includes("out") || undefined, inspect: tags.includes("inspect") || undefined }));

const E = (a: number, b: number, extra: Partial<NavEdge> = {}): NavEdge => ({ a, b, ...extra });

export const NAV_EDGES: readonly NavEdge[] = [
  E(0, 1),
  E(0, 2),
  E(2, 3),
  E(3, 4),
  E(3, 61),
  E(61, 62),
  E(62, 5),
  E(7, 61),
  E(5, 6),
  E(3, 7),
  E(7, 8),
  E(8, 9),
  E(9, 10),
  E(10, 11),
  E(11, 6),
  E(10, 12),
  E(12, 13),
  E(6, 14),
  E(14, 15),
  E(3, 58),
  E(58, 16),
  E(16, 17),
  E(17, 56),
  E(56, 18),
  E(56, 21),
  E(17, 63),
  E(63, 19),
  E(19, 20),
  E(21, 22),
  E(22, 23),
  E(23, 24),
  E(24, 25),
  E(25, 20),
  E(22, 26),
  E(26, 27, { ladder: true }),
  E(27, 28),
  E(13, 29),
  E(13, 30),
  E(30, 15),
  E(29, 31),
  E(31, 57),
  E(57, 1),
  E(57, 32),
  E(1, 32),
  E(1, 33),
  E(4, 33),
  E(4, 34),
  E(15, 35),
  E(15, 36),
  E(32, 33),
  E(33, 34),
  E(34, 35),
  E(35, 36),
  E(34, 37),
  E(32, 38),
  E(37, 40),
  E(38, 39),
  E(39, 40),
  E(40, 41),
  E(39, 42),
  E(40, 43, { cross: true }),
  E(43, 44),
  E(43, 45),
  E(43, 53),
  E(44, 46),
  E(53, 48),
  E(53, 49),
  E(46, 48),
  E(46, 47),
  E(47, 50),
  E(48, 59),
  E(59, 50),
  E(49, 60),
  E(60, 50),
  E(49, 51),
  E(45, 51),
  E(51, 52),
  E(50, 52),
  E(47, 54),
  E(52, 55),
];

export const NAV_ADJ: readonly (readonly { to: number; edge: NavEdge }[])[] = (() => {
  const adj: { to: number; edge: NavEdge }[][] = NAV_NODES.map(() => []);
  for (const e of NAV_EDGES) {
    adj[e.a].push({ to: e.b, edge: e });
    adj[e.b].push({ to: e.a, edge: e });
  }
  return adj;
})();

/** 가장 가까운 길찾기 점 (같은 층 우선) */
export function nearestNode(x: number, y: number, z: number, filter?: (n: NavNode) => boolean): number {
  let best = 0;
  let bd = Infinity;
  for (const n of NAV_NODES) {
    if (filter && !filter(n)) continue;
    const d = Math.hypot(n.x - x, n.z - z) + Math.abs(n.y - y) * 6;
    if (d < bd) {
      bd = d;
      best = n.id;
    }
  }
  return best;
}

/** A* 최단 경로 (노드 id 목록, 시작 포함) */
export function navPath(from: number, to: number): number[] {
  if (from === to) return [from];
  const g = new Map<number, number>([[from, 0]]);
  const prev = new Map<number, number>();
  const open = new Set<number>([from]);
  const h = (i: number) => Math.hypot(NAV_NODES[i].x - NAV_NODES[to].x, NAV_NODES[i].z - NAV_NODES[to].z) + Math.abs(NAV_NODES[i].y - NAV_NODES[to].y) * 2;
  while (open.size > 0) {
    let cur = -1;
    let cf = Infinity;
    for (const i of open) {
      const f = (g.get(i) ?? Infinity) + h(i);
      if (f < cf) {
        cf = f;
        cur = i;
      }
    }
    if (cur === to) break;
    open.delete(cur);
    for (const { to: nb } of NAV_ADJ[cur]) {
      const a = NAV_NODES[cur];
      const b = NAV_NODES[nb];
      const cost = (g.get(cur) ?? 0) + Math.hypot(a.x - b.x, a.z - b.z) + Math.abs(a.y - b.y);
      if (cost < (g.get(nb) ?? Infinity)) {
        g.set(nb, cost);
        prev.set(nb, cur);
        open.add(nb);
      }
    }
  }
  if (!prev.has(to)) return [from];
  const out = [to];
  let c = to;
  while (c !== from) {
    c = prev.get(c)!;
    out.push(c);
  }
  return out.reverse();
}
