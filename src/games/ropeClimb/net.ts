import type { GameEvent, MatchState, PlayerState } from "./sim";

/**
 * 방장 → 손님 스냅샷 (~10번/초)과 받는 쪽 보간 버퍼.
 *
 * 스냅샷은 `MatchState` 전체(좌표만 반올림)라서 방장이 나가면 손님 하나가 마지막 스냅샷으로
 * 판을 이어받을 수 있다(`RopeClimbGame`의 방장 승계). 남의 몸은 두 스냅샷 사이를 110ms 늦게
 * 그리고, 내 몸은 최신 스냅샷 + 속도로 조금 앞서 그려 입력 지연을 덜 느끼게 한다.
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
        y: r2(p.y),
        vx: r2(p.vx),
        vy: r2(p.vy),
        stam: Math.round(p.stam * 10) / 10,
        haulAcc: r2(p.haulAcc),
        stats: { ...p.stats, haulM: r2(p.stats.haulM), hangMs: Math.round(p.stats.hangMs) },
      }),
    ),
    ropes: s.ropes.map(r2),
    taut: [...s.taut],
    gone: [...s.gone],
    crumb: s.crumb.map((c) => ({ ...c })),
    rocks: s.rocks.map((r) => ({ ...r, x: r2(r.x), y: r2(r.y), hit: [...r.hit] })),
    wind: s.wind ? { ...s.wind } : null,
    stars: [...s.stars],
    events: s.events.filter((e) => e.at >= s.t - 2500),
    options: { ...s.options },
    ranks: s.ranks ? [...s.ranks] : null,
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
  return !!s && typeof s === "object" && s.v === 1 && Array.isArray(s.players) && Array.isArray(s.ropes) && Array.isArray(s.gone) && typeof s.t === "number";
}

const INTERP_MS = 110;

export interface Pose {
  x: number;
  y: number;
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

  /** 화면에 그릴 시뮬 시각 */
  simNow(now: number): number {
    if (!this.curr) return 0;
    return this.curr.snap.t + Math.min(400, now - this.curr.at);
  }

  /** 남의 몸: 두 스냅샷 사이 보간 */
  body(seat: number, now: number): Pose | null {
    const c = this.curr?.snap.players[seat];
    if (!c || !this.curr) return null;
    const p = this.prev?.snap.players[seat];
    if (!p || !this.prev) return { x: c.x, y: c.y };
    // 추락 뒤 캠프로 돌아가는 순간이동은 보간하지 않는다
    if (Math.hypot(c.x - p.x, c.y - p.y) > 5) return { x: c.x, y: c.y };
    const span = Math.max(1, this.curr.at - this.prev.at);
    const k = Math.max(0, Math.min(1.25, (now - INTERP_MS - this.prev.at) / span));
    return { x: p.x + (c.x - p.x) * k, y: p.y + (c.y - p.y) * k };
  }

  /** 내 몸: 최신 스냅샷 + 속도로 최대 150ms 앞서 */
  ahead(seat: number, now: number): Pose | null {
    const c = this.curr?.snap.players[seat];
    if (!c || !this.curr) return null;
    if (this.curr.snap.phase !== "climb") return this.body(seat, now);
    const dt = Math.min(150, now - this.curr.at) / 1000;
    return { x: c.x + c.vx * dt, y: c.y + c.vy * dt };
  }

  /** 화면용 위치: 내 자리는 앞서, 남은 보간 */
  pose(seat: number, mySeat: number, now: number): Pose | null {
    return seat === mySeat ? this.ahead(seat, now) : this.body(seat, now);
  }
}
