import type { GameEvent, MatchState, PlayerState } from "./sim";

/**
 * 방장 → 손님 스냅샷 (~10번/초)과 받는 쪽 보간 버퍼.
 *
 * 스냅샷은 `MatchState` 전체(좌표만 반올림)라서 방장이 나가면 손님 하나가 마지막 스냅샷으로
 * 판을 이어받을 수 있다(`CrownThiefGame`의 방장 승계). 남의 몸은 두 스냅샷 사이를 110ms 늦게
 * 그리고, 내 몸은 최신 스냅샷 + 속도로 조금 앞서 그려 입력 지연을 덜 느끼게 한다.
 * 왕관이 넘어가는 순간은 방장이 확정한 이벤트(`steal`)로만 연출한다 — 손님 화면이 먼저 넘기지 않는다.
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
        y: r2(p.y),
        vx: r2(p.vx),
        vz: r2(p.vz),
        face: r2(p.face),
        score: Math.round(p.score),
        stats: { ...p.stats },
      }),
    ),
    crown: { ...s.crown, x: r2(s.crown.x), z: r2(s.crown.z) },
    items: s.items.map((it) => ({ ...it })),
    traps: s.traps.map((tr) => ({ ...tr })),
    teamScores: [Math.round(s.teamScores[0]), Math.round(s.teamScores[1])],
    teamMult: [s.teamMult[0], s.teamMult[1]],
    events: s.events.filter((e) => e.at >= s.t - 2500),
    options: { ...s.options },
  };
}

/** 스냅샷을 다시 방장용 상태로 (방장 승계). 깊은 복사라 버퍼의 스냅샷과 섞이지 않는다. */
export function stateFromSnap(snap: Snap): MatchState {
  const { seq: _seq, ...rest } = JSON.parse(JSON.stringify(snap)) as Snap;
  void _seq;
  return rest;
}

/** 받은 스냅샷이 쓸 만한 모양인가 (깨진 패킷 거르기) */
export function isSnap(v: unknown): v is Snap {
  const s = v as Snap;
  return !!s && typeof s === "object" && s.v === 1 && Array.isArray(s.players) && !!s.crown && typeof s.crown === "object" && typeof s.t === "number";
}

const INTERP_MS = 110;

export interface Pose {
  x: number;
  z: number;
  y: number;
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

  /** 새 스냅샷 넣기 → 처음 보는 이벤트들 */
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

  /** 화면에 그릴 시뮬 시각 (남의 몸 기준: INTERP_MS 늦게) */
  simNow(now: number): number {
    if (!this.curr) return 0;
    return this.curr.snap.t + Math.min(400, now - this.curr.at) - INTERP_MS;
  }

  /** 남의 몸: 두 스냅샷 사이 보간 (순간이동은 끊어서) */
  body(seat: number, now: number): Pose | null {
    const c = this.curr?.snap.players[seat];
    if (!c || !this.curr) return null;
    const p = this.prev?.snap.players[seat];
    if (!p || !this.prev || p.respawnAt !== c.respawnAt) return { x: c.x, z: c.z, y: c.y, face: c.face };
    const span = Math.max(1, this.curr.at - this.prev.at);
    const k = Math.max(0, Math.min(1.25, (now - INTERP_MS - this.prev.at) / span));
    if (Math.hypot(c.x - p.x, c.z - p.z) > 6) return { x: c.x, z: c.z, y: c.y, face: c.face };
    return { x: p.x + (c.x - p.x) * k, z: p.z + (c.z - p.z) * k, y: p.y + (c.y - p.y) * k, face: lerpAngle(p.face, c.face, Math.min(1, k)) };
  }

  /** 내 몸: 최신 스냅샷 + 속도로 최대 150ms 앞서 (점프대 비행·떨어짐 중엔 보간 그대로) */
  ahead(seat: number, now: number): Pose | null {
    const c = this.curr?.snap.players[seat];
    if (!c || !this.curr) return null;
    if (this.curr.snap.phase !== "fight" || c.move === "pad" || c.move === "fall" || c.respawnAt > 0) return this.body(seat, now);
    const dt = Math.min(150, now - this.curr.at) / 1000;
    return { x: c.x + c.vx * dt, z: c.z + c.vz * dt, y: c.y, face: c.face };
  }
}
