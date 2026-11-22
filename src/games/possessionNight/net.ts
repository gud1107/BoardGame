import type { GameEvent, MatchState, PlayerState } from "./sim";

/**
 * 판정 기기 → 다른 기기 스냅샷(~10번/초)과 받는 쪽 보간 버퍼.
 *
 * **숨김 정보**: 다른 기기로 보내는 스냅샷(`secret=false`)에는 원귀가 드러났을 때(`ghostVis>0`)만 원귀 좌표가
 * 실리고, 안 뒤진 수납의 내용물은 -1로 지워진다 — 네트워크를 뜯어봐도 원귀가 어디 있는지, 물건이 어디 있는지
 * 알 수 없다. 판정 기기 자신은 `secret=true` 전체 상태로 화면을 그린다(원귀 본인이니 다 알아도 된다).
 * 판정을 이어받는 기기는 `rebuildSecrets`(sim.ts)로 비밀을 새로 정한다.
 */

export type Snap = MatchState & { seq: number };

const r2 = (v: number) => Math.round(v * 100) / 100;
const r1 = (v: number) => Math.round(v * 10) / 10;
/** 원귀 좌표를 지운 자리 */
export const HIDDEN = -999;

export function makeSnap(s: MatchState, seq: number, secret: boolean): Snap {
  const showGhost = secret || s.ghostVis > 0;
  return {
    ...s,
    seq,
    secret,
    rng: secret ? s.rng : 0,
    players: s.players.map((p): PlayerState => ({ ...p, x: r2(p.x), z: r2(p.z), yaw: r2(p.yaw), pitch: r2(p.pitch), fear: r1(p.fear), battery: r1(p.battery), carry: [...p.carry], hunter: { ...p.hunter, ritualSec: r1(p.hunter.ritualSec) }, ghost: { ...p.ghost } })),
    ghost: {
      ...s.ghost,
      x: showGhost ? r2(s.ghost.x) : HIDDEN,
      z: showGhost ? r2(s.ghost.z) : HIDDEN,
      yaw: showGhost ? r2(s.ghost.yaw) : 0,
      pitch: showGhost ? r2(s.ghost.pitch) : 0,
      energy: r1(s.ghost.energy),
      ready: { ...s.ghost.ready },
    },
    contents: secret ? [...s.contents] : s.contents.map((v, i) => (s.searched[i] ? v : -1)),
    searched: [...s.searched],
    ground: s.ground.map((g) => ({ ...g, x: r2(g.x), z: r2(g.z) })),
    lanterns: [...s.lanterns],
    events: s.events.filter((e) => e.at >= s.t - 3000),
    options: { ...s.options },
    outcome: s.outcome ? { ...s.outcome } : null,
    ranks: s.ranks ? [...s.ranks] : null,
  };
}

/** 스냅샷을 다시 판정용 상태로 (판정 승계) — 비밀이 지워진 것이면 받는 쪽이 `rebuildSecrets`를 불러야 한다 */
export function stateFromSnap(snap: Snap): MatchState {
  const { seq: _seq, ...rest } = JSON.parse(JSON.stringify(snap)) as Snap;
  void _seq;
  if (!rest.secret && !rest.rng) rest.rng = (rest.seed ^ (rest.t * 2654435761)) | 0;
  return rest;
}

export function isSnap(v: unknown): v is Snap {
  const s = v as Snap;
  return !!s && typeof s === "object" && s.v === 1 && Array.isArray(s.players) && !!s.ghost && typeof s.t === "number" && typeof s.ghostSeat === "number";
}

/** 이 스냅샷에 원귀 좌표가 있나 */
export function ghostKnown(s: MatchState): boolean {
  return s.ghost.x !== HIDDEN;
}

const INTERP_MS = 110;

export interface Pose {
  x: number;
  z: number;
  yaw: number;
}

function lerpAngle(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

function mix(p: Pose, c: Pose, k: number): Pose {
  if (Math.hypot(c.x - p.x, c.z - p.z) > 5) return { x: c.x, z: c.z, yaw: c.yaw };
  return { x: p.x + (c.x - p.x) * k, z: p.z + (c.z - p.z) * k, yaw: lerpAngle(p.yaw, c.yaw, Math.min(1, k)) };
}

export class SnapBuffer {
  prev: { snap: Snap; at: number } | null = null;
  curr: { snap: Snap; at: number } | null = null;
  private seen = new Set<number>();

  /** 새 스냅샷 넣기 → 처음 보는 이벤트들 */
  push(snap: Snap, now: number): GameEvent[] {
    if (this.curr && snap.seed === this.curr.snap.seed && snap.t <= this.curr.snap.t && snap.phase === this.curr.snap.phase && snap.secret === this.curr.snap.secret) return [];
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

  private k(now: number): number {
    if (!this.prev || !this.curr) return 1;
    const span = Math.max(1, this.curr.at - this.prev.at);
    return Math.max(0, Math.min(1.3, (now - INTERP_MS - this.prev.at) / span));
  }

  /** 남의 몸 */
  body(seat: number, now: number): Pose | null {
    const c = this.curr?.snap.players[seat];
    if (!c) return null;
    const p = this.prev?.snap.players[seat];
    if (!p) return { x: c.x, z: c.z, yaw: c.yaw };
    return mix(p, c, this.k(now));
  }

  /** 원귀 (보일 때만) */
  ghost(now: number): Pose | null {
    const c = this.curr?.snap;
    if (!c || !ghostKnown(c)) return null;
    const p = this.prev?.snap;
    const cg = { x: c.ghost.x, z: c.ghost.z, yaw: c.ghost.yaw };
    if (!p || !ghostKnown(p)) return cg;
    return mix({ x: p.ghost.x, z: p.ghost.z, yaw: p.ghost.yaw }, cg, this.k(now));
  }
}
