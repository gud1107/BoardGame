import type { Box, GameEvent, MatchState, PlayerState } from "./sim";

/**
 * 방장 → 손님 스냅샷 (~10번/초)과 받는 쪽 보간 버퍼 (룰북 §10).
 *
 * 스냅샷은 `MatchState` 전체(좌표만 반올림)라서 방장이 나가면 손님 하나가 마지막 스냅샷으로 판을 이어받는다.
 * 숨기는 정보는 없다(❓ 상자의 목적지도 화면엔 안 보일 뿐 — 협동 게임이라 엿볼 이유가 없고, 경쟁에서도
 * 스캔은 덤 5점뿐). 남의 몸·상자는 두 스냅샷 사이를 110ms 늦게 그리고, 내 몸은 최신 스냅샷 + 속도로 조금 앞서 그린다.
 */

export type Snap = MatchState & { seq: number };

const r2 = (v: number) => Math.round(v * 100) / 100;

export function makeSnap(s: MatchState, seq: number): Snap {
  return {
    ...s,
    seq,
    t: Math.round(s.t * 10) / 10,
    players: s.players.map((p): PlayerState => ({ ...p, x: r2(p.x), z: r2(p.z), vx: r2(p.vx), vz: r2(p.vz), face: r2(p.face), stats: { ...p.stats } })),
    boxes: s.boxes.map((b): Box => ({ ...b, x: r2(b.x), z: r2(b.z), vx: r2(b.vx), vz: r2(b.vz), holders: [...b.holders], handles: b.handles.map(r2), air: b.air ? { ...b.air } : null })),
    docks: s.docks.map((d) => ({ ...d, load: [...d.load] })),
    targets: [s.targets[0], s.targets[1], s.targets[2]],
    incident: s.incident ? { ...s.incident } : null,
    fork: s.fork ? { ...s.fork, x: r2(s.fork.x) } : null,
    events: s.events.filter((e) => e.at >= s.t - 2500),
    options: { ...s.options },
  };
}

/** 스냅샷을 다시 방장용 상태로 (방장 승계) */
export function stateFromSnap(snap: Snap): MatchState {
  const { seq: _seq, ...rest } = JSON.parse(JSON.stringify(snap)) as Snap;
  void _seq;
  return rest;
}

export function isSnap(v: unknown): v is Snap {
  const s = v as Snap;
  return !!s && typeof s === "object" && s.v === 1 && Array.isArray(s.players) && Array.isArray(s.boxes) && Array.isArray(s.docks) && typeof s.t === "number";
}

const INTERP_MS = 110;

export interface Pose {
  x: number;
  z: number;
  face: number;
}

function lerpAngle(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

export class SnapBuffer {
  prev: { snap: Snap; at: number } | null = null;
  curr: { snap: Snap; at: number } | null = null;
  private seen = new Set<number>();
  private prevBoxes = new Map<number, Box>();

  push(snap: Snap, now: number): GameEvent[] {
    if (this.curr && snap.seed === this.curr.snap.seed && snap.seq <= this.curr.snap.seq && snap.t <= this.curr.snap.t) return [];
    if (this.curr && snap.seed !== this.curr.snap.seed) {
      this.prev = null;
      this.seen.clear();
    } else this.prev = this.curr;
    this.curr = { snap, at: now };
    this.prevBoxes = new Map((this.prev?.snap.boxes ?? []).map((b) => [b.id, b]));
    const fresh = snap.events.filter((e) => !this.seen.has(e.id));
    for (const e of fresh) this.seen.add(e.id);
    if (this.seen.size > 900) this.seen = new Set(snap.events.map((e) => e.id));
    return fresh;
  }

  latest(): Snap | null {
    return this.curr?.snap ?? null;
  }

  simNow(now: number): number {
    if (!this.curr) return 0;
    return this.curr.snap.t + Math.min(400, now - this.curr.at) - INTERP_MS;
  }

  private k(now: number): number {
    if (!this.curr || !this.prev) return 1;
    const span = Math.max(1, this.curr.at - this.prev.at);
    return Math.max(0, Math.min(1.25, (now - INTERP_MS - this.prev.at) / span));
  }

  body(seat: number, now: number): Pose | null {
    const c = this.curr?.snap.players[seat];
    if (!c || !this.curr) return null;
    const p = this.prev?.snap.players[seat];
    if (!p || !this.prev) return { x: c.x, z: c.z, face: c.face };
    const k = this.k(now);
    if (Math.hypot(c.x - p.x, c.z - p.z) > 6) return { x: c.x, z: c.z, face: c.face };
    return { x: p.x + (c.x - p.x) * k, z: p.z + (c.z - p.z) * k, face: lerpAngle(p.face, c.face, Math.min(1, k)) };
  }

  ahead(seat: number, now: number): Pose | null {
    const c = this.curr?.snap.players[seat];
    if (!c || !this.curr) return null;
    if (this.curr.snap.phase !== "work") return this.body(seat, now);
    const dt = Math.min(150, now - this.curr.at) / 1000;
    return { x: c.x + c.vx * dt, z: c.z + c.vz * dt, face: c.face };
  }

  /** 상자 위치 (든 상자는 든 사람 기준, 날아가는 상자는 포물선 계산, 컨베이어는 보간) */
  box(b: Box, now: number, mySeat: number): { x: number; z: number; y: number } {
    const snap = this.curr?.snap;
    if (b.state === "held" && snap && b.kind !== "heavy" && b.holders.length === 1) {
      const seat = b.holders[0];
      const pose = seat === mySeat ? this.ahead(seat, now) : this.body(seat, now);
      if (pose) return { x: pose.x + Math.cos(pose.face) * 0.55, z: pose.z + Math.sin(pose.face) * 0.55, y: 0.95 };
    }
    if (b.state === "air" && b.air) {
      const t = this.simNow(now) + INTERP_MS * 0.5;
      const a = b.air;
      const u = Math.max(0, Math.min(1, (t - a.at) / Math.max(1, a.until - a.at)));
      const dist = Math.hypot(a.x1 - a.x0, a.z1 - a.z0);
      return { x: a.x0 + (a.x1 - a.x0) * u, z: a.z0 + (a.z1 - a.z0) * u, y: 0.95 * (1 - u) + 0.15 * u + Math.sin(u * Math.PI) * (0.6 + dist * 0.22) };
    }
    const p = this.prevBoxes.get(b.id);
    const y = b.state === "belt" ? 0.62 : b.state === "held" ? 0.7 : 0;
    if (!p || p.state !== b.state || Math.hypot(b.x - p.x, b.z - p.z) > 4) return { x: b.x, z: b.z, y };
    const k = this.k(now);
    return { x: p.x + (b.x - p.x) * k, z: p.z + (b.z - p.z) * k, y };
  }
}
