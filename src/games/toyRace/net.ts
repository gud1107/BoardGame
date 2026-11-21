import type { GameEvent, MatchState, PlayerState } from "./sim";

/**
 * 방장 → 손님 스냅샷 (~10번/초)과 받는 쪽 버퍼 (룰북 §10).
 *
 * 스냅샷은 `MatchState` 전체(숫자만 반올림)라서 방장이 나가면 손님 하나가 마지막 스냅샷으로 판을 이어받는다.
 * 레이스는 빨라서(13u/s) 남의 차를 110ms 늦게 그리면 1.4u나 뒤에 보인다 → **남의 차는 마지막 위치 + 속도로
 * 지금까지 앞으로 밀어(추측 항법) 부드럽게 따라가게** 그린다. 내 차는 내 기기가 직접 움직인다(`LocalDriver`).
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
        y: r2(p.y),
        vx: r2(p.vx),
        vz: r2(p.vz),
        h: r3(p.h),
        dist: r2(p.dist),
        lastS: r2(p.lastS),
        driftMs: Math.round(p.driftMs),
        draftMs: Math.round(p.draftMs),
        wrongMs: Math.round(p.wrongMs),
        raceRanks: [...p.raceRanks],
        stats: { ...p.stats },
      }),
    ),
    boxes: s.boxes.map((b) => ({ ...b })),
    projectiles: s.projectiles.map((pj) => ({ ...pj, x: r2(pj.x), z: r2(pj.z), y: r2(pj.y), vx: r2(pj.vx), vz: r2(pj.vz), d: r2(pj.d), lat: r2(pj.lat) })),
    ducks: s.ducks.map((d) => ({ ...d })),
    toys: s.toys.map((t) => ({ ...t })),
    events: s.events.filter((e) => e.at >= s.t - 2500),
    options: { ...s.options },
    raceRanks: s.raceRanks ? [...s.raceRanks] : null,
    ranks: s.ranks ? [...s.ranks] : null,
  };
}

/** 스냅샷을 다시 방장용 상태로 (방장 승계). 깊은 복사. */
export function stateFromSnap(snap: Snap): MatchState {
  const { seq: _seq, ...rest } = JSON.parse(JSON.stringify(snap)) as Snap;
  void _seq;
  return rest;
}

export function isSnap(v: unknown): v is Snap {
  const s = v as Snap;
  return !!s && typeof s === "object" && s.v === 1 && Array.isArray(s.players) && Array.isArray(s.boxes) && typeof s.t === "number" && typeof s.track === "string";
}

export interface Pose {
  x: number;
  z: number;
  y: number;
  h: number;
  vx: number;
  vz: number;
}

function lerpAngle(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

/** 남의 차를 얼마나 앞으로 밀어 그리나 (받은 뒤 지난 시간 + 이만큼, 최대 MAX) */
const LEAD_MS = 60;
const LEAD_MAX_MS = 260;

export class SnapBuffer {
  curr: { snap: Snap; at: number } | null = null;
  private seen = new Set<number>();
  /** 자리별로 화면에 그리던 위치 (부드럽게 따라가기) */
  private shown = new Map<number, Pose & { at: number; key: string }>();

  push(snap: Snap, now: number): GameEvent[] {
    if (this.curr && snap.seed === this.curr.snap.seed && snap.seq <= this.curr.snap.seq && snap.t <= this.curr.snap.t) return [];
    if (this.curr && snap.seed !== this.curr.snap.seed) {
      this.seen.clear();
      this.shown.clear();
    }
    this.curr = { snap, at: now };
    const fresh = snap.events.filter((e) => !this.seen.has(e.id));
    for (const e of fresh) this.seen.add(e.id);
    if (this.seen.size > 900) this.seen = new Set(snap.events.map((e) => e.id));
    return fresh;
  }

  latest(): Snap | null {
    return this.curr?.snap ?? null;
  }

  /** 방장 시각 추정 (마지막 스냅샷 시각 + 받은 뒤 지난 시간) */
  hostNow(now: number): number {
    if (!this.curr) return 0;
    return this.curr.snap.t + Math.min(600, now - this.curr.at);
  }

  /** 남의 차: 마지막 위치 + 속도 × (지난 시간 + 60ms), 그리던 위치에서 부드럽게 따라감. 순간이동·새 레이스는 바로. */
  car(seat: number, now: number): Pose | null {
    const c = this.curr;
    const p = c?.snap.players[seat];
    if (!c || !p) return null;
    const racing = c.snap.phase === "race" && !p.finishedAt;
    const lead = racing ? Math.min(LEAD_MAX_MS, now - c.at + LEAD_MS) / 1000 : 0;
    const air = (p.flags & 64) !== 0;
    const target: Pose = { x: p.x + p.vx * lead, z: p.z + p.vz * lead, y: p.y, h: p.h, vx: p.vx, vz: p.vz };
    const key = `${c.snap.race}:${p.tp}:${c.snap.seed}`;
    const prev = this.shown.get(seat);
    if (!prev || prev.key !== key || Math.hypot(prev.x - target.x, prev.z - target.z) > 6) {
      this.shown.set(seat, { ...target, at: now, key });
      return target;
    }
    const dt = Math.min(0.1, Math.max(0, (now - prev.at) / 1000));
    // 앞으로 같이 가면서(속도만큼) 남은 차이를 줄인다
    const k = 1 - Math.exp(-dt * 10);
    const nx = prev.x + target.vx * dt;
    const nz = prev.z + target.vz * dt;
    const out: Pose & { at: number; key: string } = {
      x: nx + (target.x - nx) * k,
      z: nz + (target.z - nz) * k,
      y: air ? prev.y + (target.y - prev.y) * Math.min(1, dt * 14) : target.y,
      h: lerpAngle(prev.h, target.h, Math.min(1, dt * 12)),
      vx: target.vx,
      vz: target.vz,
      at: now,
      key,
    };
    this.shown.set(seat, out);
    return out;
  }

  /** 털실 공처럼 빠른 것: 속도만큼 앞으로 (최대 0.25초) */
  ahead(x: number, z: number, vx: number, vz: number, now: number): { x: number; z: number } {
    const c = this.curr;
    if (!c) return { x, z };
    const dt = Math.min(250, now - c.at) / 1000;
    return { x: x + vx * dt, z: z + vz * dt };
  }
}
