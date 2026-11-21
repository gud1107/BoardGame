import { BOMB_FUSE_MIN, BOMB_REVEAL_MS } from "./data";
import type { GameEvent, MatchState, PlayerState, Toy } from "./sim";

/**
 * 방장 → 손님 스냅샷 (~10번/초)과 받는 쪽 보간 버퍼 (룰북 §10).
 *
 * 스냅샷은 `MatchState` 전체(좌표만 반올림)라서 방장이 나가면 손님 하나가 마지막 스냅샷으로 판을 이어받을 수 있다.
 * 줄 위 물건 위치도 상태에 들어 있어 이어받은 방장이 줄을 그대로 끌고 간다.
 * **💣 폭탄의 터지는 시각은 숨긴다**: 마지막 5초 전에는 0으로 보내고(화면엔 "째깍"만), 이어받은 방장은 0이면
 * 새로 정한다 — 네트워크를 들여다봐도 남은 시간을 미리 알 수 없다.
 * 남의 몸·물건은 두 스냅샷 사이를 110ms 늦게 그리고, 내 몸은 최신 스냅샷 + 속도로 조금 앞서 그린다.
 * 가로채기 연출은 방장이 확정한 `snatch` 이벤트로만 — 손님 화면이 먼저 넘기지 않는다.
 */

export type Snap = MatchState & { seq: number };

const r2 = (v: number) => Math.round(v * 100) / 100;

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
        face: r2(p.face),
        chain: [...p.chain],
        run: { ...p.run, counts: [...p.run.counts] },
        stats: { ...p.stats },
      }),
    ),
    toys: s.toys.map((t): Toy => ({ ...t, x: r2(t.x), z: r2(t.z) })),
    baskets: s.baskets.map((b) => ({ ...b, stack: [...b.stack] })),
    stands: s.stands,
    bombs: s.bombs.map((b) => ({ ...b, fuseAt: b.state === "held" && b.fuseAt - s.t <= BOMB_REVEAL_MS ? b.fuseAt : 0 })),
    event: s.event ? { ...s.event } : null,
    goals: [...s.goals],
    goalWinners: s.goalWinners.map((w) => [...w]),
    teamScores: [s.teamScores[0], s.teamScores[1]],
    teamMult: [s.teamMult[0], s.teamMult[1]],
    events: s.events.filter((e) => e.at >= s.t - 2500),
    options: { ...s.options },
  };
}

/** 스냅샷을 다시 방장용 상태로 (방장 승계). 숨긴 폭탄 시각은 새로 정한다. */
export function stateFromSnap(snap: Snap): MatchState {
  const { seq: _seq, ...rest } = JSON.parse(JSON.stringify(snap)) as Snap;
  void _seq;
  for (const b of rest.bombs) {
    if (b.state === "held" && b.fuseAt === 0) b.fuseAt = rest.t + BOMB_REVEAL_MS + 1000 + ((rest.rng >>> 0) % 1000) / 1000 * (BOMB_FUSE_MIN - BOMB_REVEAL_MS);
  }
  return rest;
}

export function isSnap(v: unknown): v is Snap {
  const s = v as Snap;
  return !!s && typeof s === "object" && s.v === 1 && Array.isArray(s.players) && Array.isArray(s.toys) && Array.isArray(s.baskets) && typeof s.t === "number";
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
  private prevToys = new Map<number, Toy>();

  push(snap: Snap, now: number): GameEvent[] {
    if (this.curr && snap.seed === this.curr.snap.seed && snap.seq <= this.curr.snap.seq && snap.t <= this.curr.snap.t) return [];
    if (this.curr && snap.seed !== this.curr.snap.seed) {
      this.prev = null;
      this.seen.clear();
    } else this.prev = this.curr;
    this.curr = { snap, at: now };
    this.prevToys = new Map((this.prev?.snap.toys ?? []).map((t) => [t.id, t]));
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
    if (this.curr.snap.phase !== "fight") return this.body(seat, now);
    const dt = Math.min(150, now - this.curr.at) / 1000;
    return { x: c.x + c.vx * dt, z: c.z + c.vz * dt, face: c.face };
  }

  /** 물건 위치 (줄 위 물건은 보간, 바닥 물건은 그대로) */
  toy(t: Toy, now: number): { x: number; z: number } {
    const p = this.prevToys.get(t.id);
    if (!p || t.state !== "chain" || Math.hypot(t.x - p.x, t.z - p.z) > 5) return { x: t.x, z: t.z };
    const k = this.k(now);
    return { x: p.x + (t.x - p.x) * k, z: p.z + (t.z - p.z) * k };
  }
}
