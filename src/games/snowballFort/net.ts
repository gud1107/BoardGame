import type { GameEvent, MatchState, PlayerState } from "./sim";

/**
 * 방장 → 손님 스냅샷 (~10번/초)과 받는 쪽 보간 버퍼 (살얼음 파티 net.ts와 같은 방식).
 *
 * 스냅샷은 `MatchState` 전체(좌표만 반올림)라서 방장이 나가면 손님 하나가 마지막 스냅샷으로
 * 판을 이어받을 수 있다. 남의 몸은 스냅샷 간격에 맞춰 45~160ms 늦게 보간하고, 내 몸은 최신 스냅샷 +
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

/** 보간 지연 범위: 방장 화면(33ms마다)은 짧게, 손님(100ms마다)은 길게 자동으로 맞춘다 */
const DELAY_MIN = 45;
const HIST = 8;

export class SnapBuffer {
  curr: { snap: Snap; at: number } | null = null;
  /** 최근 스냅샷 (오래된 것부터) — 그릴 시각을 사이에 둔 두 장을 골라 보간한다 */
  private hist: Snap[] = [];
  /** 내 기기 시각 − 시뮬 시각 (튀지 않게 서서히 맞춤) */
  private off = 0;
  /** 스냅샷 간격(시뮬 시각)의 평균 */
  private gap = 60;
  /** 내 몸: 새 스냅샷이 오며 생긴 위치 차이를 서서히 없앤다 */
  private err = { seat: -1, x: 0, z: 0, at: 0 };
  private seen = new Set<number>();

  push(snap: Snap, now: number): GameEvent[] {
    const c = this.curr?.snap;
    if (c && snap.seed === c.seed && snap.seq <= c.seq && snap.t <= c.t) return [];
    const reset = !c || snap.seed !== c.seed || snap.round !== c.round || snap.t < c.t;
    if (c && snap.seed !== c.seed) this.seen.clear();
    const mine = this.err.seat;
    const before = !reset && mine >= 0 ? this.ahead(mine, now) : null;
    const sample = now - snap.t;
    if (reset || Math.abs(sample - this.off) > 350) {
      this.off = sample;
      this.hist = [];
    } else {
      // 빨리 온 스냅샷 쪽으로는 빠르게, 늦게 온(지연) 쪽으로는 천천히
      this.off += (sample - this.off) * (sample < this.off ? 0.25 : 0.04);
      if (c) this.gap += (Math.min(250, snap.t - c.t) - this.gap) * 0.12;
    }
    this.hist.push(snap);
    if (this.hist.length > HIST) this.hist.shift();
    this.curr = { snap, at: now };
    this.err = { seat: mine, x: 0, z: 0, at: now };
    if (before) {
      const after = this.ahead(mine, now);
      if (after) {
        const dx = before.x - after.x;
        const dz = before.z - after.z;
        if (Math.hypot(dx, dz) < 1.5) this.err = { seat: mine, x: dx, z: dz, at: now };
      }
    }
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
    return this.simLive(now) - Math.max(DELAY_MIN, Math.min(160, this.gap * 1.25));
  }

  /** 지금 시각의 방장 시뮬 시각 추정 (내 몸·조준선) */
  simLive(now: number): number {
    if (!this.curr) return 0;
    return Math.min(this.curr.snap.t + 400, now - this.off);
  }

  body(seat: number, now: number): Pose | null {
    const c = this.curr?.snap.players[seat];
    if (!c || !this.curr) return null;
    const t = this.simNow(now);
    const h = this.hist;
    for (let i = h.length - 1; i > 0; i--) {
      const a = h[i - 1];
      if (a.t > t) continue;
      const b = h[i];
      const p = a.players[seat];
      const q = b.players[seat];
      if (!p || !q || Math.hypot(q.x - p.x, q.z - p.z) > 5) return { x: c.x, z: c.z, face: c.face };
      // 늦게 오면 잠깐(간격의 25%)만 앞으로 밀어 그린다
      const k = Math.max(0, Math.min(1.25, (t - a.t) / Math.max(1, b.t - a.t)));
      return { x: p.x + (q.x - p.x) * k, z: p.z + (q.z - p.z) * k, face: lerpAngle(p.face, q.face, Math.min(1, k)) };
    }
    const o = h[0]?.players[seat] ?? c;
    return { x: o.x, z: o.z, face: o.face };
  }

  /** 내 몸: 최신 스냅샷 + 속도로 최대 150ms 앞서 */
  ahead(seat: number, now: number): Pose | null {
    const c = this.curr?.snap.players[seat];
    if (!c || !this.curr) return null;
    if (this.curr.snap.phase !== "fight" || c.frozenUntil > this.curr.snap.t) return this.body(seat, now);
    if (this.err.seat !== seat) this.err = { seat, x: 0, z: 0, at: now };
    const dt = Math.max(0, Math.min(150, this.simLive(now) - this.curr.snap.t)) / 1000;
    const k = Math.exp(-Math.max(0, now - this.err.at) / 70);
    return { x: c.x + c.vx * dt + this.err.x * k, z: c.z + c.vz * dt + this.err.z * k, face: c.face };
  }
}
