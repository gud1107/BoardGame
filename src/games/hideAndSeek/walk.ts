import { BASE, FLOOR_Y, NEIGHBORS, ROOMS, SPOTS, doorPoints, room, spot, type RoomId } from "./house";
import { legalMoves, type GameState, type Move, type Seat } from "./engine";
import { PILLAR, homeSlot, hunterPos, roomSlot, spotHide, spotStand, type P3 } from "./show";

/**
 * 직접 걸어서 고르기 — 내 차례에 내 캐릭터를 키보드(WASD/화살표)나 조이스틱으로 움직여
 * 가구 앞에 가서 숨거나 뒤진다. 규칙은 그대로 턴제: 걷기는 "입력 방법"일 뿐이고,
 * 이번 턴에 갈 수 있는 방(`rooms`) 밖으로는 못 나가며, 누르는 순간 그 자리의 합법 행동을 커밋한다.
 *
 * 이 파일은 순수 함수(이동·충돌·대상 찾기)만 — 3D 프레임 루프(`three/Walker.tsx`)와 테스트가 같이 쓴다.
 */

/** 보드가 채우는 입력 (키보드 + 조이스틱, -1~1, z+ = 화면 아래) */
export interface WalkInput {
  x: number;
  z: number;
  /** 사다리 오르내리기 요청 (Walker가 소비) */
  hop: boolean;
}

/** Walker가 보드에 알리는 "지금 가까이 있는 것" */
export interface WalkNear {
  target: string | null;
  room: RoomId;
  ladder: boolean;
}

/** 걸을 수 있는 칸: 방, 또는 현관↔2층 복도 계단 */
export type Zone = RoomId | "stairs";

export interface WalkPos {
  x: number;
  y: number;
  z: number;
  zone: Zone;
}

export interface WalkTarget {
  key: string;
  /** 다가가면 프롬프트가 뜨는 기준점 */
  at: P3;
  zone: RoomId;
  label: string;
  move: Move;
  /** 고른 뒤 캐릭터가 자리 잡는 곳 */
  snap: P3;
  pose: "crouch" | "stand" | "search";
}

export interface WalkSpec {
  /** 바뀌면 시작 위치로 다시 놓는다 */
  key: string;
  start: WalkPos;
  rooms: RoomId[];
  targets: WalkTarget[];
  /** 방마다 "여기서 멈추기"(술래 이동) */
  stops: Partial<Record<RoomId, WalkTarget>>;
}

/** 마당은 집 오른쪽 술래 기둥까지 넓게 걷는다 */
const YARD_BOX = [-9, 8.4, 3.5, 7.5] as const;
const STAIR = { x0: -1.8, x1: -0.8, z0: 0.45, z1: 2.85 } as const;
const LADDER = { x: -0.6, z: -2.85 } as const;
const BODY = 0.24;
const DOOR_HALF = 0.55;
const OBSTACLE_R = 0.4;
export const REACH = 1.25;
export const WALK_SPEED = 3.0;

function boxOf(r: RoomId) {
  return r === BASE ? YARD_BOX : room(r).box;
}

function roomAt(x: number, z: number, floor: number): RoomId | null {
  for (const r of ROOMS) {
    if (r.floor !== floor) continue;
    const [x0, x1, z0, z1] = boxOf(r.id);
    if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return r.id;
  }
  return null;
}

function floorOf(zone: Zone): number {
  return zone === "stairs" ? -1 : room(zone).floor;
}

function inStairRect(x: number, z: number) {
  return x >= STAIR.x0 && x <= STAIR.x1 && z >= STAIR.z0 && z <= STAIR.z1;
}

/** 같은 층의 두 방 사이 문 (계단·사다리 제외) */
function sameFloorDoor(a: RoomId, b: RoomId): P3 | null {
  const pts = doorPoints(a, b);
  return pts.length === 1 ? pts[0] : null;
}

function nearDoorOf(r: RoomId, x: number, z: number): boolean {
  for (const nb of NEIGHBORS[r]) {
    const d = sameFloorDoor(r, nb);
    if (d && Math.hypot(d[0] - x, d[2] - z) < DOOR_HALF + 0.3) return true;
  }
  return false;
}

/** 벽 쪽 여백(BODY)을 얼마나 파고들었나 (0 = 여백 밖) */
function wallOverlap(r: RoomId, x: number, z: number): number {
  const [x0, x1, z0, z1] = boxOf(r);
  return Math.max(0, x0 + BODY - x) + Math.max(0, x - (x1 - BODY)) + Math.max(0, z0 + BODY - z) + Math.max(0, z - (z1 - BODY));
}

/** 가구에 부딪히면 둘레 밖으로 밀어낸다 — 대각선으로 밀어도 가구를 따라 미끄러져 돈다 */
function pushOutOfFurniture(x: number, z: number, floor: number): [number, number] {
  for (const sp of SPOTS) {
    if (room(sp.room).floor !== floor) continue;
    const dx = x - sp.x;
    const dz = z - sp.z;
    const d = Math.hypot(dx, dz);
    if (d >= OBSTACLE_R) continue;
    if (d < 1e-6) return [sp.x + OBSTACLE_R, z];
    x = sp.x + (dx / d) * OBSTACLE_R;
    z = sp.z + (dz / d) * OBSTACLE_R;
  }
  return [x, z];
}

function tryMove(p: WalkPos, x0: number, z0: number, allowed: ReadonlySet<RoomId>): WalkPos | null {
  let x = x0;
  let z = z0;
  if (p.zone === "stairs") {
    const nx = Math.min(STAIR.x1 - BODY, Math.max(STAIR.x0 + BODY, x));
    if (z >= STAIR.z1) return allowed.has("hall") ? { x: nx, y: FLOOR_Y[0], z: STAIR.z1 + 0.05, zone: "hall" } : null;
    if (z <= STAIR.z0) return allowed.has("landing") ? { x: nx, y: FLOOR_Y[1], z: STAIR.z0 - 0.05, zone: "landing" } : null;
    return { x: nx, y: stairY(z), z, zone: "stairs" };
  }
  const floor = floorOf(p.zone);
  // 계단: 현관에선 아래쪽 끝(앞)으로만, 2층 복도에선 위쪽 끝(뒤)으로만 들어선다
  if ((p.zone === "hall" || p.zone === "landing") && inStairRect(x, z)) {
    // 계단 방향으로 걸을 때만 올라선다 — 옆으로 지나가면 난간처럼 막힌다
    const along = (dz: number) => dz > 1.5 * Math.abs(x - p.x);
    const fromBottom = p.zone === "hall" && p.z >= STAIR.z1 - 0.3 && along(p.z - z);
    const fromTop = p.zone === "landing" && p.z <= STAIR.z0 + 0.2 && along(z - p.z);
    if (!fromBottom && !fromTop) return null;
    return { x, y: stairY(z), z, zone: "stairs" };
  }
  [x, z] = pushOutOfFurniture(x, z, floor);
  const r2 = roomAt(x, z, floor);
  if (!r2) return null;
  if (r2 === p.zone) {
    // 벽에서 몸 두께만큼 떨어져 걷는다. 문 근처에선 벽 선까지 다가갈 수 있고, 문으로 막 들어와
    // 벽 쪽 여백 안에 서 있어도 여백에서 멀어지는 쪽으로는 움직일 수 있다(갇히지 않게)
    const over = wallOverlap(r2, x, z);
    return over === 0 || nearDoorOf(r2, x, z) || over <= wallOverlap(r2, p.x, p.z) + 1e-9 ? { x, y: p.y, z, zone: r2 } : null;
  }
  if (!allowed.has(r2)) return null;
  const door = sameFloorDoor(p.zone, r2);
  if (!door || Math.hypot(door[0] - x, door[2] - z) > DOOR_HALF + 0.25) return null;
  return { x, y: p.y, z, zone: r2 };
}

function stairY(z: number): number {
  return Math.min(FLOOR_Y[1], Math.max(FLOOR_Y[0], ((STAIR.z1 - z) / (STAIR.z1 - STAIR.z0)) * FLOOR_Y[1]));
}

/** 한 프레임 이동 — 막히면 x만, z만 따로 시도해 벽을 따라 미끄러진다 */
export function stepWalk(p: WalkPos, dx: number, dz: number, allowed: ReadonlySet<RoomId>): WalkPos {
  if (dx === 0 && dz === 0) return p;
  return tryMove(p, p.x + dx, p.z + dz, allowed) ?? (dx !== 0 ? tryMove(p, p.x + dx, p.z, allowed) : null) ?? (dz !== 0 ? tryMove(p, p.x, p.z + dz, allowed) : null) ?? p;
}

/** 지금 서 있는 방 (계단 위는 가까운 쪽 층) */
export function roomOf(p: WalkPos): RoomId {
  if (p.zone !== "stairs") return p.zone;
  return p.y > FLOOR_Y[1] / 2 ? "landing" : "hall";
}

/** 다락 사다리 (아이방 ↔ 다락방) — 가까이 서서 누르면 오르내린다 */
export function ladderHop(p: WalkPos, allowed: ReadonlySet<RoomId>): WalkPos | null {
  if (Math.hypot(p.x - LADDER.x, p.z - LADDER.z) > 0.9) return null;
  if (p.zone === "kids" && allowed.has("attic")) return { x: LADDER.x, y: FLOOR_Y[2], z: LADDER.z + 0.5, zone: "attic" };
  if (p.zone === "attic" && allowed.has("kids")) return { x: LADDER.x, y: FLOOR_Y[1], z: LADDER.z + 0.5, zone: "kids" };
  return null;
}

/** 가장 가까운 대상 (같은 층, REACH 안) */
export function nearestTarget(p: WalkPos, targets: readonly WalkTarget[]): WalkTarget | null {
  if (p.zone === "stairs") return null;
  const floor = floorOf(p.zone);
  let best: WalkTarget | null = null;
  let bd = REACH;
  for (const t of targets) {
    if (room(t.zone).floor !== floor) continue;
    const d = Math.hypot(t.at[0] - p.x, t.at[2] - p.z);
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------

const posOf = (p: P3, zone: RoomId): WalkPos => ({ x: p[0], y: p[1], z: p[2], zone });

/** 이번 턴에 내가 걸어서 고를 수 있는 것들 (합법 행동에서 만든다) */
export function walkSpecFor(state: GameState, me: Seat): WalkSpec | null {
  const legal = legalMoves(state, me);
  if (legal.length === 0) return null;
  const s = state.seats[me];
  const key = `${state.seed}:${state.round}:${state.turn}:${me}`;
  const spotTarget = (id: string, label: string, move: Move, pose: WalkTarget["pose"], snap: P3): WalkTarget => {
    const sp = spot(id)!;
    return { key: `${move.kind}:${id}`, at: [sp.x, FLOOR_Y[room(sp.room).floor], sp.z], zone: sp.room, label, move, snap, pose };
  };
  if (state.step === "hide") {
    const targets = legal.map((m) => spotTarget(m.spot!, `🫣 ${spot(m.spot!)!.name}에 숨기`, m, "crouch", spotHide(m.spot!)));
    return { key, start: posOf(homeSlot(me), BASE), rooms: ROOMS.map((r) => r.id), targets, stops: {} };
  }
  if (s.status === "hiding" && s.spot) {
    const targets: WalkTarget[] = [];
    const rooms = new Set<RoomId>([s.room]);
    for (const m of legal) {
      if (m.kind === "stay") targets.push(spotTarget(s.spot, `🤫 ${spot(s.spot)!.name} — 그대로 숨죽이기`, m, "crouch", spotHide(s.spot)));
      if (m.kind === "sneak") {
        targets.push(spotTarget(m.spot!, `🐾 ${spot(m.spot!)!.name}(으)로 살금살금`, m, "crouch", spotHide(m.spot!)));
        rooms.add(spot(m.spot!)!.room);
      }
      if (m.kind === "home") {
        rooms.add(BASE);
        targets.push({ key: "home", at: PILLAR, zone: BASE, label: "🏃 찜!", move: m, snap: homeSlot(me), pose: "stand" });
      }
    }
    return { key, start: posOf(spotHide(s.spot), s.room), rooms: [...rooms], targets, stops: {} };
  }
  // 술래 편
  const rooms = new Set<RoomId>([s.room]);
  const targets: WalkTarget[] = [];
  const stops: Partial<Record<RoomId, WalkTarget>> = {};
  for (const m of legal) {
    if (m.kind === "search") {
      const sp = spot(m.spot!)!;
      rooms.add(sp.room);
      targets.push(spotTarget(sp.id, `🔍 ${sp.name} 뒤지기`, m, "search", spotStand(sp.id)));
    }
    if (m.kind === "move") {
      rooms.add(m.room!);
      stops[m.room!] = { key: `move:${m.room}`, at: [0, 0, 0], zone: m.room!, label: `🚶 ${room(m.room!).name}에서 멈추기`, move: m, snap: roomSlot(m.room!, me), pose: "stand" };
    }
  }
  return { key, start: posOf(hunterPos(state, me), s.room), rooms: [...rooms], targets, stops };
}
