import type { GameEvent, MatchState } from "./sim";

/**
 * 방장 → 손님 스냅샷 (~10번/초)과 받는 쪽 시계.
 *
 * 스냅샷은 `MatchState` 전체라서 방장이 나가면 손님 하나가 마지막 스냅샷으로 판을 이어받는다.
 *
 * 박자 게임이라 "지금 곡의 어디인가"가 흔들리면 안 된다. 스냅샷이 도착할 때마다
 * (내 시계 − 스냅샷의 시뮬 시각)을 재서 **가장 작은 값**을 기준으로 삼는다 — 지연이 가장 적었던
 * 스냅샷이 실제 차이에 가장 가깝고, 그 뒤로는 내 기기 시계로만 곡이 흐른다(스냅샷이 늦게 와도
 * 노트가 덜컹거리지 않는다). 기기마다 수십 ms씩 곡이 늦게 시작할 수는 있지만 소리·화면·판정이
 * 같이 밀리므로 플레이에는 영향이 없다.
 */

export type Snap = MatchState & { seq: number };

export function makeSnap(s: MatchState, seq: number): Snap {
  return {
    ...s,
    seq,
    t: Math.round(s.t * 10) / 10,
    players: s.players.map((p) => ({ ...p, judges: [...p.judges] as [number, number, number, number], stats: { ...p.stats } })),
    effects: s.effects.map((e) => ({ ...e })),
    events: s.events.filter((e) => e.at >= s.t - 2500),
    history: s.history,
    options: { ...s.options },
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
  return !!s && typeof s === "object" && s.v === 1 && Array.isArray(s.players) && Array.isArray(s.effects) && typeof s.t === "number" && typeof s.songAt === "number";
}

export class SnapBuffer {
  curr: { snap: Snap; at: number } | null = null;
  /** 내 시계(performance.now) − 시뮬 시각 의 최솟값 */
  private minOff = Infinity;
  private seen = new Set<number>();

  /** 새 스냅샷 넣기 → 처음 보는 이벤트들 */
  push(snap: Snap, now: number): GameEvent[] {
    if (this.curr && snap.seed === this.curr.snap.seed && snap.seq <= this.curr.snap.seq && snap.t <= this.curr.snap.t) return [];
    if (this.curr && snap.seed !== this.curr.snap.seed) {
      this.seen.clear();
      this.minOff = Infinity;
    }
    this.curr = { snap, at: now };
    this.minOff = Math.min(this.minOff, now - snap.t);
    const fresh = snap.events.filter((e) => !this.seen.has(e.id));
    for (const e of fresh) this.seen.add(e.id);
    if (this.seen.size > 600) this.seen = new Set(snap.events.map((e) => e.id));
    return fresh;
  }

  latest(): Snap | null {
    return this.curr?.snap ?? null;
  }

  /** 지금 시뮬 시각 (내 시계 기준으로 매끄럽게 흐른다) */
  simNow(now: number): number {
    return this.curr ? now - this.minOff : 0;
  }

  /** 지금 곡 시각 (ms). 곡 시작 전엔 음수 */
  songNow(now: number): number {
    return this.curr ? now - this.minOff - this.curr.snap.songAt : -1e9;
  }
}
