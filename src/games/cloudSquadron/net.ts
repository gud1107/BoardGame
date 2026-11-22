import type { Bullet, Enemy, GameEvent, MatchState, PlayerState } from "./sim";

/**
 * 방장 → 손님 스냅샷 (~10번/초)과 받는 쪽 버퍼 (룰북 §10).
 *
 * 스냅샷 = 경기 상태 전체라서 방장이 나가면 손님 하나가 마지막 스냅샷으로 판을 이어받는다.
 * 적탄은 수백 개라 `[id, x, y, vx, vy, k]` 정수 배열(`bq`)로 줄여 보낸다. 적탄은 전부 직선 등속이라
 * 받는 쪽은 `x + vx·경과`로 지금 위치를 정확히 이어 그린다 — 스냅샷 지연 없이 "지금" 위치.
 * 적·다른 기체는 두 스냅샷 사이를 100ms 늦게 보간한다.
 */

export type Snap = Omit<MatchState, "bullets"> & { bullets: []; bq: number[]; seq: number };

const r1 = (v: number) => Math.round(v * 10) / 10;

export function makeSnap(s: MatchState, seq: number): Snap {
  const bq: number[] = [];
  for (const b of s.bullets) bq.push(b.id, Math.round(b.x), Math.round(b.y), Math.round(b.vx), Math.round(b.vy), b.k);
  return {
    ...s,
    seq,
    t: Math.round(s.t),
    bullets: [],
    bq,
    players: s.players.map((p): PlayerState => ({ ...p, x: r1(p.x), y: r1(p.y), gauge: r1(p.gauge), revive: Math.round(p.revive), stats: { ...p.stats } })),
    enemies: s.enemies.map((e): Enemy => ({ ...e, x: r1(e.x), y: r1(e.y), hp: Math.ceil(e.hp), age: Math.round(e.age), fireAt: Math.round(e.fireAt), dmgBy: e.dmgBy.map((d) => Math.round(d ?? 0)), drop: [...e.drop] })),
    lanes: s.lanes.map((l) => ({ ...l })),
    patches: s.patches.map((q) => ({ ...q })),
    items: s.items.map((it) => ({ ...it, x: r1(it.x), y: r1(it.y) })),
    events: s.events.filter((e) => e.at >= s.t - 2500),
    history: s.history.map((h) => ({ ...h })),
    options: { ...s.options },
    ranks: s.ranks ? [...s.ranks] : null,
  };
}

const BR = [5, 7, 4.5, 10];

export function decodeBullets(bq: number[]): Bullet[] {
  const out: Bullet[] = [];
  for (let i = 0; i + 5 < bq.length; i += 6) out.push({ id: bq[i], x: bq[i + 1], y: bq[i + 2], vx: bq[i + 3], vy: bq[i + 4], k: bq[i + 5], r: BR[bq[i + 5]] ?? 5 });
  return out;
}

/** 스냅샷을 다시 방장용 상태로 (방장 승계). 깊은 복사. */
export function stateFromSnap(snap: Snap): MatchState {
  const { seq: _seq, bq, ...rest } = JSON.parse(JSON.stringify(snap)) as Snap;
  void _seq;
  return { ...(rest as unknown as MatchState), bullets: decodeBullets(bq) };
}

/** 받은 스냅샷이 쓸 만한 모양인가 (깨진 패킷 거르기) */
export function isSnap(v: unknown): v is Snap {
  const s = v as Snap;
  return !!s && typeof s === "object" && s.v === 1 && Array.isArray(s.players) && Array.isArray(s.enemies) && Array.isArray(s.bq) && typeof s.t === "number";
}

const INTERP_MS = 100;

export class SnapBuffer {
  prev: { snap: Snap; at: number } | null = null;
  curr: { snap: Snap; at: number; bullets: Bullet[] } | null = null;
  private seen = new Set<number>();

  /** 새 스냅샷 넣기 → 처음 보는 이벤트들 */
  push(snap: Snap, now: number): GameEvent[] {
    if (this.curr && snap.seed === this.curr.snap.seed && snap.seq <= this.curr.snap.seq && snap.t <= this.curr.snap.t) return [];
    if (this.curr && snap.seed !== this.curr.snap.seed) {
      this.prev = null;
      this.seen.clear();
    } else this.prev = this.curr;
    this.curr = { snap, at: now, bullets: decodeBullets(snap.bq) };
    const fresh = snap.events.filter((e) => !this.seen.has(e.id));
    for (const e of fresh) this.seen.add(e.id);
    if (this.seen.size > 900) this.seen = new Set(snap.events.map((e) => e.id));
    return fresh;
  }

  latest(): Snap | null {
    return this.curr?.snap ?? null;
  }

  /** 지금 시뮬 시각 (최신 스냅샷 + 받은 뒤 흐른 시간, 최대 0.4초까지만 앞서) */
  simNow(now: number): number {
    if (!this.curr) return 0;
    return this.curr.snap.t + Math.min(400, now - this.curr.at);
  }

  /** 적탄 지금 위치 (out 배열을 다시 써서 할당을 줄인다) */
  bulletsAt(now: number, out: Bullet[]): Bullet[] {
    out.length = 0;
    if (!this.curr) return out;
    const s = this.curr.snap;
    const t = this.simNow(now);
    const k = ((t < s.slowUntil ? 0.35 : 1) * (t - s.t)) / 1000;
    for (const b of this.curr.bullets) {
      const x = b.x + b.vx * k;
      const y = b.y + b.vy * k;
      if (x < -20 || x > 380 || y < -30 || y > 660) continue;
      out.push({ id: b.id, x, y, vx: b.vx, vy: b.vy, k: b.k, r: b.r });
    }
    return out;
  }

  private k(now: number): number {
    if (!this.curr || !this.prev) return 1;
    const span = Math.max(1, this.curr.at - this.prev.at);
    return Math.max(0, Math.min(1.2, (now - INTERP_MS - this.prev.at) / span));
  }

  /** 남의 기체: 두 스냅샷 사이 보간 */
  player(seat: number, now: number): { x: number; y: number } | null {
    const c = this.curr?.snap.players[seat];
    if (!c) return null;
    const p = this.prev?.snap.players[seat];
    if (!p || Math.hypot(c.x - p.x, c.y - p.y) > 160) return { x: c.x, y: c.y };
    const k = this.k(now);
    return { x: p.x + (c.x - p.x) * k, y: p.y + (c.y - p.y) * k };
  }

  /** 적 위치 보간 (id로 짝짓기) */
  enemies(now: number): (Enemy & { rx: number; ry: number })[] {
    if (!this.curr) return [];
    const prev = new Map((this.prev?.snap.enemies ?? []).map((e) => [e.id, e]));
    const k = this.k(now);
    return this.curr.snap.enemies.map((e) => {
      const p = prev.get(e.id);
      if (!p || Math.hypot(e.x - p.x, e.y - p.y) > 200) return { ...e, rx: e.x, ry: e.y };
      return { ...e, rx: p.x + (e.x - p.x) * k, ry: p.y + (e.y - p.y) * k };
    });
  }

  items(now: number): { id: number; kind: string; x: number; y: number }[] {
    if (!this.curr) return [];
    const prev = new Map((this.prev?.snap.items ?? []).map((e) => [e.id, e]));
    const k = this.k(now);
    return this.curr.snap.items.map((it) => {
      const p = prev.get(it.id);
      if (!p) return it;
      return { ...it, x: p.x + (it.x - p.x) * k, y: p.y + (it.y - p.y) * k };
    });
  }
}
