import { describe, expect, it } from "vitest";
import { ROOMS, SPOTS, roomPath, doorPoints, type RoomId } from "./house";
import { applyAction, moveHash, pendingSeats, startGame, type GameState, type Move } from "./engine";
import { ladderHop, nearestTarget, stepWalk, walkSpecFor, type WalkPos } from "./walk";
import type { P3 } from "./show";

const ALL = new Set<RoomId>(ROOMS.map((r) => r.id));

/** 웨이포인트를 향해 조금씩 걷는다 — 막혀서 못 가면 false */
function walkTo(p: WalkPos, to: P3, allowed: ReadonlySet<RoomId>, tol = 0.15): { p: WalkPos; ok: boolean } {
  let side = 1;
  for (let i = 0; i < 600; i++) {
    const dx = to[0] - p.x;
    const dz = to[2] - p.z;
    const d = Math.hypot(dx, dz);
    if (d < tol) return { p, ok: true };
    const step = Math.min(0.05, d);
    // 가구에 막히면 옆으로 비켜 돌아간다 (사람이 조이스틱을 꺾듯이)
    const base = Math.atan2(dz, dx);
    let next = p;
    // 한 번 비켜 간 쪽으로 계속 돈다 (좌우로 번갈아 비키면 가구 앞에서 제자리걸음)
    for (const off of [0, 0.5, 1.0, 1.5, -0.5, -1.0, -1.5].map((o) => o * side)) {
      const q = stepWalk(p, Math.cos(base + off) * step, Math.sin(base + off) * step, allowed);
      if (q.x !== p.x || q.z !== p.z || q.zone !== p.zone) {
        next = q;
        if (off !== 0) side = Math.sign(off);
        break;
      }
    }
    if (next === p) return { p, ok: false };
    p = next;
  }
  return { p, ok: false };
}

/** 방 경로를 따라 문/계단/사다리를 지나 목표 가구까지 */
function centerOf(r: RoomId): [number, number] {
  if (r === "yard") return [0, 5.5];
  const b = ROOMS.find((x) => x.id === r)!.box;
  return [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2];
}

function walkRoute(start: WalkPos, dest: RoomId, at: P3, allowed: ReadonlySet<RoomId>): WalkPos | null {
  let p = start;
  const rooms = roomPath(start.zone as RoomId, dest);
  for (let i = 0; i + 1 < rooms.length; i++) {
    const [a, b] = [rooms[i], rooms[i + 1]];
    if ((a === "kids" && b === "attic") || (a === "attic" && b === "kids")) {
      const r = walkTo(p, [-0.6, 0, -2.85], allowed, 0.3);
      if (!r.ok) return null;
      const hop = ladderHop(r.p, allowed);
      if (!hop) return null;
      p = hop;
      continue;
    }
    const pts = doorPoints(a, b);
    if (pts.length === 1) {
      // 사람처럼: 문 앞에 서서 → 문 → 건너편으로 한 걸음
      const door = pts[0];
      const ca = centerOf(a);
      const cb = centerOf(b);
      const off = (c: [number, number], k: number): P3 => {
        const dx = c[0] - door[0];
        const dz = c[1] - door[2];
        // 문은 벽에 수직으로 지난다: 벽이 x=상수면 x 방향, z=상수면 z 방향
        const alongX = Math.abs(dx) > Math.abs(dz) && door[2] !== 3.5;
        return alongX ? [door[0] + Math.sign(dx) * k, door[1], door[2]] : [door[0], door[1], door[2] + Math.sign(dz) * k];
      };
      for (const pt of [off(ca, 0.6), door, off(cb, 0.6)]) {
        const r = walkTo(p, pt, allowed, 0.2);
        if (!r.ok) return null;
        p = r.p;
      }
    } else {
      for (const pt of pts) {
        const r = walkTo(p, pt, allowed, 0.2);
        if (!r.ok) return null;
        p = r.p;
      }
      // 계단 끝에서 한 걸음 더, 2층에선 계단 구멍 옆으로 비켜선다
      if (b === "landing") {
        const side = walkTo(p, [-0.45, 3, 0.3], allowed, 0.15);
        if (!side.ok) return null;
        p = side.p;
      }
    }
    if (p.zone !== b) return null;
  }
  const r = walkTo(p, at, allowed, 0.9);
  return r.ok || Math.hypot(at[0] - r.p.x, at[2] - r.p.z) < 1.2 ? r.p : null;
}

function hidden(): GameState {
  let s = startGame(3, 0);
  const moves: Record<number, Move> = { 1: { kind: "hide", spot: "sofa" }, 2: { kind: "hide", spot: "trunk" } };
  for (const seat of pendingSeats(s)) s = applyAction(s, { type: "COMMIT", seat, round: s.round, turn: s.turn, hash: moveHash(moves[seat], "x") });
  for (const seat of pendingSeats(s)) s = applyAction(s, { type: "REVEAL", seat, round: s.round, turn: s.turn, move: moves[seat], salt: "x" });
  return applyAction(s, { type: "TIMEOUT", stage: s.stage });
}

describe("walking the house", () => {
  it("can walk from the yard to every one of the 25 hiding spots and get its prompt", () => {
    const spec = walkSpecFor(startGame(3, 0), 1)!;
    expect(spec.targets.length).toBe(SPOTS.length);
    const fails: string[] = [];
    for (const t of spec.targets) {
      const p = walkRoute(spec.start, t.zone, t.at, ALL);
      if (!p || nearestTarget(p, [t])?.key !== t.key) fails.push(t.key + (p ? ` @${p.x.toFixed(2)},${p.z.toFixed(2)} ${p.zone}` : " null"));
    }
    expect(fails).toEqual([]);
  });

  it("walls block: you can't walk straight from the hall into the bath except through the door", () => {
    let p: WalkPos = { x: -4.0, y: 0, z: 1.0, zone: "hall" };
    for (let i = 0; i < 100; i++) p = stepWalk(p, 0, -0.05, ALL);
    expect(p.zone).toBe("hall");
  });

  it("a hider can't wander beyond this turn's rooms", () => {
    const s = hidden();
    const spec = walkSpecFor(s, 1)!; // sofa (living): living + hall + kitchen + yard
    expect(new Set(spec.rooms)).toEqual(new Set(["living", "hall", "kitchen", "yard"]));
    const allowed = new Set(spec.rooms);
    // hall → bath door is closed to them
    const p = walkRoute({ x: -2.5, y: 0, z: 1.5, zone: "hall" }, "bath", [-3.6, 0, -2.4], allowed);
    expect(p).toBeNull();
    // the seeker's stops cover every room within two doors
    const seek = walkSpecFor(s, 0)!;
    expect(Object.keys(seek.stops).sort()).toEqual(["garage", "hall", "landing", "living", "bath", "kitchen", "yard"].sort());
  });
});
