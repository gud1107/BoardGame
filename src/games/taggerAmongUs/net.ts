import type { GameEvent, MatchState, PlayerState } from "./sim";

/**
 * 방장 → 손님 스냅샷(~10번/초)과 받는 쪽 보간 버퍼.
 *
 * 스냅샷은 `MatchState` 전체(좌표만 반올림)라 방장이 나가면 손님 하나가 마지막 스냅샷으로 판을
 * 이어받는다. 내 몸은 내 기기가 직접 움직이므로 버퍼는 **남의 몸**만 110ms 늦게 보간한다.
 *
 * 누가 술래인지도 스냅샷에 들어 있다(방장 승계에 필요). 화면은 변장 중인 술래를 다른 아이와 똑같이
 * 그리지만, 네트워크를 뜯어보면 알 수 있다 — 친구끼리 하는 게임의 한계로 룰북 §11에 적어 둔다.
 */

export type Snap = MatchState & { seq: number };

const r2 = (v: number) => Math.round(v * 100) / 100;
const r1 = (v: number) => Math.round(v * 10) / 10;

export function makeSnap(s: MatchState, seq: number): Snap {
  return {
    ...s,
    seq,
    players: s.players.map((p): PlayerState => ({ ...p, x: r2(p.x), z: r2(p.z), yaw: r2(p.yaw), pitch: r2(p.pitch), stats: { ...p.stats } })),
    tg: { ...s.tg, gauge: r1(s.tg.gauge) },
    doors: [...s.doors],
    spots: s.spots.map((sp) => ({ ...sp, p: Math.round(sp.p * 1000) / 1000 })),
    events: s.events.filter((e) => e.at >= s.t - 3000),
    options: { ...s.options },
    outcome: s.outcome ? { ...s.outcome } : null,
    ranks: s.ranks ? [...s.ranks] : null,
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
  return !!s && typeof s === "object" && s.v === 1 && Array.isArray(s.players) && Array.isArray(s.doors) && Array.isArray(s.spots) && !!s.tg && typeof s.t === "number";
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
    if (this.curr && snap.seed === this.curr.snap.seed && snap.t <= this.curr.snap.t && snap.phase === this.curr.snap.phase) return [];
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
}
