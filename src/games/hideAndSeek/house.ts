/**
 * 한밤의 숨바꼭질 — 저택 지도. 방 10개 + 마당(술래 기둥), 숨을 곳 25곳.
 * 엔진·봇·3D가 모두 이 표 하나를 쓴다 (3D 좌표 `box`는 방 바닥의 x/z 범위와 층).
 */

export type RoomId = "yard" | "garage" | "hall" | "living" | "bath" | "kitchen" | "landing" | "master" | "kids" | "study" | "attic";

export interface RoomDef {
  id: RoomId;
  name: string;
  icon: string;
  floor: 0 | 1 | 2;
  /** 3D: 바닥 범위 [x0, x1, z0, z1] */
  box: readonly [number, number, number, number];
  /** 바닥·벽 색 */
  floorColor: string;
  wallColor: string;
}

export interface SpotDef {
  id: string;
  room: RoomId;
  name: string;
  icon: string;
  /** 3D: 방 안 위치(월드 x, z)와 가구 종류 */
  x: number;
  z: number;
  prop: PropKind;
  /** 가구가 바라보는 방향(라디안, 0 = +z) */
  rot?: number;
}

export type PropKind =
  | "shelf"
  | "bike"
  | "boxes"
  | "shoecab"
  | "coats"
  | "sofa"
  | "curtain"
  | "piano"
  | "tub"
  | "washer"
  | "table"
  | "pantry"
  | "sink"
  | "hamper"
  | "plant"
  | "wardrobe"
  | "bed"
  | "vanity"
  | "toybox"
  | "tent"
  | "bunk"
  | "desk"
  | "bookcase"
  | "trunk"
  | "mannequin";

export const FLOOR_Y = [0, 3.0, 6.0] as const;
export const WALL_H = 2.7;

export const ROOMS: readonly RoomDef[] = [
  { id: "yard", name: "마당", icon: "🌳", floor: 0, box: [-9, 5, 3.5, 7.5], floorColor: "#2f4a2b", wallColor: "#2f4a2b" },
  { id: "garage", name: "창고", icon: "🧰", floor: 0, box: [-9, -5, -3.5, 3.5], floorColor: "#5b5751", wallColor: "#6f6a62" },
  { id: "hall", name: "현관", icon: "🚪", floor: 0, box: [-5, 0, 0, 3.5], floorColor: "#8a6a4a", wallColor: "#c9b79a" },
  { id: "living", name: "거실", icon: "🛋️", floor: 0, box: [0, 5, 0, 3.5], floorColor: "#7a5634", wallColor: "#b9c4a8" },
  { id: "bath", name: "욕실", icon: "🛁", floor: 0, box: [-5, 0, -3.5, 0], floorColor: "#9fb7c2", wallColor: "#d7e6ea" },
  { id: "kitchen", name: "부엌", icon: "🍳", floor: 0, box: [0, 5, -3.5, 0], floorColor: "#a88a62", wallColor: "#e7d9b8" },
  { id: "landing", name: "2층 복도", icon: "🪜", floor: 1, box: [-5, 0, 0, 3.5], floorColor: "#7d5c3e", wallColor: "#bfae93" },
  { id: "master", name: "안방", icon: "🛏️", floor: 1, box: [0, 5, 0, 3.5], floorColor: "#6e4c34", wallColor: "#c7a9a6" },
  { id: "kids", name: "아이방", icon: "🧸", floor: 1, box: [-5, 0, -3.5, 0], floorColor: "#8fa0c8", wallColor: "#f0d9a8" },
  { id: "study", name: "서재", icon: "📚", floor: 1, box: [0, 5, -3.5, 0], floorColor: "#5a3f2c", wallColor: "#8f9a7c" },
  { id: "attic", name: "다락방", icon: "🕸️", floor: 2, box: [-5, 0, -3.5, 0], floorColor: "#6b5541", wallColor: "#7b6650" },
];

/** 문으로 이어진 방 (양방향) */
const DOORS: readonly [RoomId, RoomId][] = [
  ["yard", "hall"],
  ["yard", "garage"],
  ["yard", "living"],
  ["garage", "hall"],
  ["hall", "living"],
  ["hall", "bath"],
  ["hall", "landing"],
  ["living", "kitchen"],
  ["bath", "kitchen"],
  ["landing", "master"],
  ["landing", "kids"],
  ["master", "study"],
  ["kids", "study"],
  ["kids", "attic"],
];

export const SPOTS: readonly SpotDef[] = [
  { id: "shelf", room: "garage", name: "공구 선반 뒤", icon: "🧰", x: -8.3, z: -2.6, prop: "shelf" },
  { id: "bike", room: "garage", name: "자전거 뒤", icon: "🚲", x: -6.0, z: -1.2, prop: "bike", rot: Math.PI / 2 },
  { id: "boxes", room: "garage", name: "상자 더미 속", icon: "📦", x: -7.6, z: 1.6, prop: "boxes" },
  { id: "shoecab", room: "hall", name: "신발장 안", icon: "👟", x: -4.3, z: 0.7, prop: "shoecab", rot: Math.PI / 2 },
  { id: "coats", room: "hall", name: "코트 걸이 뒤", icon: "🧥", x: -1.2, z: 0.5, prop: "coats" },
  { id: "sofa", room: "living", name: "소파 뒤", icon: "🛋️", x: 2.4, z: 1.3, prop: "sofa" },
  { id: "curtain", room: "living", name: "커튼 뒤", icon: "🪟", x: 4.4, z: 2.2, prop: "curtain", rot: -Math.PI / 2 },
  { id: "piano", room: "living", name: "피아노 밑", icon: "🎹", x: 0.9, z: 0.5, prop: "piano" },
  { id: "tub", room: "bath", name: "욕조 샤워 커튼 뒤", icon: "🛁", x: -3.6, z: -2.4, prop: "tub" },
  { id: "washer", room: "bath", name: "세탁기 옆", icon: "🧺", x: -0.8, z: -2.8, prop: "washer" },
  { id: "table", room: "kitchen", name: "식탁 밑", icon: "🍽️", x: 2.5, z: -1.4, prop: "table" },
  { id: "pantry", room: "kitchen", name: "팬트리 안", icon: "🥫", x: 4.3, z: -2.8, prop: "pantry" },
  { id: "sink", room: "kitchen", name: "싱크대 아래", icon: "🚰", x: 0.9, z: -3.0, prop: "sink" },
  { id: "hamper", room: "landing", name: "빨래 바구니 속", icon: "🧺", x: -4.2, z: 0.8, prop: "hamper" },
  { id: "plant", room: "landing", name: "큰 화분 뒤", icon: "🪴", x: -0.9, z: 0.8, prop: "plant" },
  { id: "wardrobe", room: "master", name: "옷장 안", icon: "🚪", x: 0.8, z: 0.6, prop: "wardrobe" },
  { id: "bed", room: "master", name: "침대 밑", icon: "🛏️", x: 3.1, z: 1.4, prop: "bed" },
  { id: "vanity", room: "master", name: "화장대 옆", icon: "🪞", x: 4.5, z: 0.5, prop: "vanity" },
  { id: "toybox", room: "kids", name: "장난감 상자 속", icon: "🧸", x: -1.0, z: -0.8, prop: "toybox" },
  { id: "tent", room: "kids", name: "인디언 텐트 안", icon: "⛺", x: -3.4, z: -1.2, prop: "tent" },
  { id: "bunk", room: "kids", name: "이층 침대 위", icon: "🪜", x: -4.0, z: -2.8, prop: "bunk" },
  { id: "desk", room: "study", name: "책상 밑", icon: "🖋️", x: 2.6, z: -1.2, prop: "desk" },
  { id: "bookcase", room: "study", name: "책장 뒤 비밀 공간", icon: "📚", x: 4.4, z: -2.6, prop: "bookcase", rot: -Math.PI / 2 },
  { id: "trunk", room: "attic", name: "낡은 트렁크 속", icon: "🧳", x: -3.6, z: -1.4, prop: "trunk" },
  { id: "mannequin", room: "attic", name: "마네킹 사이", icon: "🕴️", x: -1.0, z: -2.6, prop: "mannequin" },
];

export const BASE: RoomId = "yard";

const ROOM_BY_ID = new Map(ROOMS.map((r) => [r.id, r]));
const SPOT_BY_ID = new Map(SPOTS.map((s) => [s.id, s]));

export function room(id: RoomId): RoomDef {
  return ROOM_BY_ID.get(id)!;
}

export function spot(id: string): SpotDef | undefined {
  return SPOT_BY_ID.get(id);
}

export const NEIGHBORS: Readonly<Record<RoomId, readonly RoomId[]>> = (() => {
  const out = Object.fromEntries(ROOMS.map((r) => [r.id, [] as RoomId[]])) as Record<RoomId, RoomId[]>;
  for (const [a, b] of DOORS) {
    out[a].push(b);
    out[b].push(a);
  }
  return out;
})();

export const DOOR_LIST = DOORS;

/** 방 사이 최단 거리 (문 개수) */
export const DIST: Readonly<Record<RoomId, Readonly<Record<RoomId, number>>>> = (() => {
  const out = {} as Record<RoomId, Record<RoomId, number>>;
  for (const r of ROOMS) {
    const d = { [r.id]: 0 } as Record<RoomId, number>;
    const queue: RoomId[] = [r.id];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const nb of NEIGHBORS[cur]) {
        if (d[nb] === undefined) {
          d[nb] = d[cur] + 1;
          queue.push(nb);
        }
      }
    }
    out[r.id] = d;
  }
  return out;
})();

export function spotsIn(roomId: RoomId): SpotDef[] {
  return SPOTS.filter((s) => s.room === roomId);
}

/** 3D: 방 바닥 가운데 */
export function roomCenter(id: RoomId): { x: number; y: number; z: number } {
  const r = room(id);
  return { x: (r.box[0] + r.box[1]) / 2, y: FLOOR_Y[r.floor], z: (r.box[2] + r.box[3]) / 2 };
}

type P3 = [number, number, number];

/** 3D: 두 방 사이를 지나는 웨이포인트 (문 가운데, 계단·사다리는 아래→위) */
const DOOR_POINTS: Record<string, P3[]> = {
  "yard|hall": [[-2.5, 0, 3.5]],
  "yard|garage": [[-7, 0, 3.5]],
  "yard|living": [[2.5, 0, 3.5]],
  "garage|hall": [[-5, 0, 1.75]],
  "hall|living": [[0, 0, 1.75]],
  "hall|bath": [[-2.5, 0, 0]],
  "hall|landing": [
    [-4.3, 0, 3.0],
    [-4.3, 3.0, 0.6],
  ],
  "living|kitchen": [[2.5, 0, 0]],
  "bath|kitchen": [[0, 0, -1.75]],
  "landing|master": [[0, 3.0, 1.75]],
  "landing|kids": [[-2.5, 3.0, 0]],
  "master|study": [[2.5, 3.0, 0]],
  "kids|study": [[0, 3.0, -1.75]],
  "kids|attic": [
    [-0.6, 3.0, -3.0],
    [-0.6, 6.0, -3.0],
  ],
};

export function doorPoints(a: RoomId, b: RoomId): P3[] {
  const fwd = DOOR_POINTS[`${a}|${b}`];
  if (fwd) return fwd;
  const back = DOOR_POINTS[`${b}|${a}`];
  return back ? [...back].reverse() : [];
}

/** 방 경로 (최단, a 포함 b 포함) */
export function roomPath(a: RoomId, b: RoomId): RoomId[] {
  const out: RoomId[] = [a];
  let cur = a;
  let guard = 0;
  while (cur !== b && guard++ < 20) {
    cur = NEIGHBORS[cur].reduce((best, nb) => (DIST[nb][b] < DIST[best][b] ? nb : best), NEIGHBORS[cur][0]);
    out.push(cur);
  }
  return out;
}

/** a 방에서 b 방까지 지나는 문들의 웨이포인트 */
export function routeVia(a: RoomId, b: RoomId): P3[] {
  const rooms = roomPath(a, b);
  const pts: P3[] = [];
  for (let i = 0; i + 1 < rooms.length; i++) pts.push(...doorPoints(rooms[i], rooms[i + 1]));
  return pts;
}
