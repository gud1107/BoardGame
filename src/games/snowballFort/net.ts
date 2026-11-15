import type { GameEvent, MatchState, PlayerState } from "./sim";

/**
 * 방장 → 손님 스냅샷 (~10번/초)과 받는 쪽 보간 버퍼 (살얼음 파티 net.ts와 같은 방식).
 *
 * 스냅샷은 `MatchState` 전체(좌표만 반올림)라서 방장이 나가면 손님 하나가 마지막 스냅샷으로
 * 판을 이어받을 수 있다. 남의 몸은 두 스냅샷 사이를 110ms 늦게 그리고, 내 몸은 최신 스냅샷 +
 * 속도로 조금 앞서 그린다. 눈덩이는 발사값으로 포물선을 직접 계산하므로 보간이 필요 없다.
 */

export type Snap = MatchState & { seq: number };

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function makeSnap(s: MatchState, seq: number): Snap {
  return {
    ...s,
    seq,
    t: Math.round(s.t * 10) / 10,
    players: s.players.map(
      (p): PlayerState => ({
        ...p,
        x: r2(p.x),
        z: r2(p.z),
        vx: r2(p.vx),
        vz: r2(p.vz),
        face: r3(p.face),
        gatherMs: Math.round(p.gatherMs),
        stats: { ...p.stats },
      }),
    ),
    balls: s.balls.map((b) => ({ ...b, x0: r3(b.x0), y0: r3(b.y0), z0: r3(b.z0), vx: r3(b.vx), vy: r3(b.vy), vz: r3(b.vz), apex: r2(b.apex) })),
    walls: s.walls.map((w) => ({ ...w, x: r3(w.x), z: r3(w.z), a: r3(w.a) })),
    snowmen: s.snowmen.map((m) => ({ ...m })),
    items: s.items.map((it) => ({ ...it, x: r2(it.x), z: r2(it.z) })),
    wins: [...s.wins],
    teamSize: [...s.teamSize],
    events: s.events.filter((e) => e.at >= s.t - 2500),
    history: s.history,
    options: { ...s.options },
  };
}

export function stateFromSnap(snap: Snap): MatchState {
  const { seq: _seq, ...rest } = JSON.parse(JSON.stringify(snap)) as Snap;
  void _seq;
  return rest;
}

export function isSnap(v: unknown): v is Snap {
  const s = v as Snap;
  return !!s && typeof s === "object" && s.v === 1 && Array.isArray(s.players) && Array.isArray(s.balls) && Array.isArray(s.walls) && Array.isArray(s.snowmen) && typeof s.t === "number";
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

  push(snap: Snap, now: number): GameEvent[] {
    if (this.curr && snap.seed === this.curr.snap.seed && snap.seq <= this.curr.snap.seq && snap.t <= this.curr.snap.t) return [];
    if (this.curr && snap.seed !== this.curr.snap.seed) {
      this.prev = null;
      this.seen.clear();
    } else this.prev = this.curr;
    this.curr = { snap, at: now };
    const fresh = snap.events.filter((e) => !this.seen.has(e.id));
    for (const e of fresh) this.seen.add(e.id);
    if (this.seen.size > 900) this.seen = new Set(snap.events.map((e) => e.id));
    return fresh;
  }

  latest(): Snap | null {
    return this.curr?.snap ?? null;
  }

  /** 화면에 그릴 시뮬 시각 (눈덩이·남의 몸 기준) */
  simNow(now: number): number {
    if (!this.curr) return 0;
    return this.curr.snap.t + Math.min(400, now - this.curr.at) - INTERP_MS;
  }

  /** 지금 시각의 방장 시뮬 시각 추정 (내 몸·조준선) */
  simLive(now: number): number {
    if (!this.curr) return 0;
    return this.curr.snap.t + Math.min(400, now - this.curr.at);
  }

  body(seat: number, now: number): Pose | null {
    const c = this.curr?.snap.players[seat];
    if (!c || !this.curr) return null;
    const p = this.prev?.snap.players[seat];
    if (!p || !this.prev || this.prev.snap.round !== this.curr.snap.round) return { x: c.x, z: c.z, face: c.face };
    const span = Math.max(1, this.curr.at - this.prev.at);
    const k = Math.max(0, Math.min(1.25, (now - INTERP_MS - this.prev.at) / span));
    if (Math.hypot(c.x - p.x, c.z - p.z) > 5) return { x: c.x, z: c.z, face: c.face };
    return { x: p.x + (c.x - p.x) * k, z: p.z + (c.z - p.z) * k, face: lerpAngle(p.face, c.face, Math.min(1, k)) };
  }

  /** 내 몸: 최신 스냅샷 + 속도로 최대 150ms 앞서 */
  ahead(seat: number, now: number): Pose | null {
    const c = this.curr?.snap.players[seat];
    if (!c || !this.curr) return null;
    const dt = Math.min(150, now - this.curr.at) / 1000;
    if (this.curr.snap.phase !== "fight" || c.frozenUntil > this.curr.snap.t) return this.body(seat, now);
    return { x: c.x + c.vx * dt, z: c.z + c.vz * dt, face: c.face };
  }
}
