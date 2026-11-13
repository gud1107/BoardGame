import { KKOM_CAMP_MS, SPAM_WINDOW_MS, type GameOptions } from "./data";
import type { DecoyState, GameEvent, MatchState, NpcKind, Phase, PingState, PlayerStats, Role, RoundSummary, TrapState } from "./sim";

/** 스냅샷에 실을 사람 위치를 바꿔 주는 함수 (방장: 보고 속도로 앞당김) */
export type PosProject = (p: MatchState["players"][number]) => { x: number; z: number };

/**
 * 방장이 ~10번/초 보내는 스냅샷과, 받는 쪽의 보간 버퍼.
 * 다른 사람·NPC·분신은 두 스냅샷 사이를 110ms 늦게 그려서 매끄럽게 움직인다.
 * 내 몸만 내 기기에서 바로 계산한다(예측) — 방장이 `tp`를 올리면 그 위치로 순간이동.
 */

export interface SnapPlayer {
  s: number;
  role: Role;
  bot: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
  anim: string;
  pose: number;
  tp: number;
  alive: boolean;
  escaped: boolean;
  hp: number;
  dg: string | null;
  offer: string[];
  rr: number;
  dc: number;
  ammo: number;
  em: { id: string; at: number } | null;
  score: number;
  catches: number;
  /** 최근 헛손질 횟수 (다음 벌점 가중) */
  wr: number;
  /** 꼼꼼이 집 지키기 게이지 0~1 (1이면 못 잡음) */
  camp?: number;
  /** 술래 증강: 고른 것 · 지금 3장 · 다시 뽑기 · 최대 체력 · 덫 · 충격파 · 보호막 · 추격 본능 중 · 육감 */
  aug?: string[];
  ao?: string[];
  arr?: number;
  mhp?: number;
  tr?: number;
  sk?: number;
  sh?: number;
  hu?: boolean;
  sn?: boolean;
  /** 증강 다음 발동 시각 (레이더·냄새·마지막 사냥, 시뮬 ms) · 불굴 썼나 · 재변신 남은 횟수 */
  an?: Record<string, number>;
  ru?: boolean;
  rm?: number;
  /** 숨는 사람을 잡은 술래 자리 (-1 = 꼼꼼이 "찾는다!") */
  cb?: number;
  stats?: PlayerStats;
}

export interface SnapNpc {
  id: number;
  kind: NpcKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  anim: string;
  look: number;
}

export interface Snap {
  seq: number;
  t: number;
  seed: number;
  seatCount: number;
  round: number;
  phase: Phase;
  phaseStart: number;
  phaseEnd: number;
  options: GameOptions;
  seekers: number[];
  tier: number;
  players: SnapPlayer[];
  npcs: SnapNpc[];
  decoys: DecoyState[];
  doors: boolean[];
  windows: boolean[];
  chests: { slot: number; opened: boolean }[];
  goal: { slot: number; open: boolean; errand?: number } | null;
  pedLight: boolean;
  /** 술래 증강: 덫·지도 표시 (술래 화면에만 그린다) */
  traps: TrapState[];
  pings: PingState[];
  events: GameEvent[];
  history: RoundSummary[];
  winners: number[] | null;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function makeSnap(s: MatchState, seq: number, project?: PosProject): Snap {
  const over = s.phase === "gameOver";
  return {
    seq,
    t: s.t,
    seed: s.seed,
    seatCount: s.seatCount,
    round: s.round,
    phase: s.phase,
    phaseStart: s.phaseStart,
    phaseEnd: s.phaseEnd,
    options: s.options,
    seekers: s.seekers,
    tier: s.tier,
    players: s.players.map((p) => {
      const pp = project ? project(p) : p;
      return {
      s: p.seat,
      role: p.role,
      bot: p.bot,
      x: r2(pp.x),
      y: r2(p.y),
      z: r2(pp.z),
      yaw: r2(p.yaw),
      anim: p.anim,
      pose: p.pose,
      tp: p.tp,
      alive: p.alive,
      escaped: p.escaped,
      hp: p.hp,
      dg: p.disguise,
      offer: p.offer,
      rr: p.rerolls,
      dc: p.decoys,
      ammo: p.ammo,
      em: p.emote,
      score: p.score,
      catches: p.roundCatches,
      ...(p.caughtBy !== null ? { cb: p.caughtBy } : {}),
      wr: p.wrongAt.filter((t) => t > s.t - SPAM_WINDOW_MS).length,
      ...(p.role === "seeker" && s.goal ? { camp: Math.min(1, Math.round((p.campMs / KKOM_CAMP_MS) * 100) / 100) } : {}),
      ...(p.role === "seeker"
        ? {
            aug: p.augs,
            ao: p.augOffer,
            arr: p.augRerolls,
            mhp: p.maxHp,
            tr: p.traps,
            sk: p.shocks,
            sh: p.shieldLeft,
            hu: s.t < p.hunterUntil,
            sn: p.sense,
            ru: p.resolveUsed,
            an: { radar: p.augT.radar ?? 0, scent: p.augT.scent ?? 0, last: p.augT.last ?? 0 },
          }
        : // 숨는 쪽 증강 (술래 화면엔 안 그린다 — 개발자도구로는 보이는 기존 한계와 같다)
          { aug: p.augs, ao: p.augOffer, arr: p.augRerolls, sh: p.shieldLeft, rm: p.remorphs, sn: p.sense }),
      ...(over ? { stats: p.stats } : {}),
      };
    }),
    npcs: s.npcs.map((n) => ({ id: n.id, kind: n.kind, x: r2(n.x), y: r2(n.y), z: r2(n.z), yaw: r2(n.yaw), anim: n.anim, look: n.look })),
    decoys: s.decoys.map((d) => ({ ...d, x: r2(d.x), y: r2(d.y), z: r2(d.z), yaw: r2(d.yaw) })),
    doors: s.doors,
    windows: s.windows,
    chests: s.chests,
    goal: s.goal,
    pedLight: s.pedLight,
    traps: s.traps,
    pings: s.pings,
    events: s.events.filter((e) => e.at >= s.t - 2500),
    history: s.history,
    winners: s.winners,
  };
}

/**
 * 그리는 시각 = 방장 시뮬레이션 시계 − 이만큼. 스냅샷 간격(100ms) + 네트워크 흔들림 여유.
 * (예전엔 "도착 시각" 두 장 사이를 보간해서, 한 장이 늦으면 멈칫하고 몰려 오면 순간이동했다)
 */
export const INTERP_DELAY_MS = 160;
const KEEP = 12;

export interface Pose3 {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

function lerpAngle(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

/**
 * 받는 쪽: 최근 스냅샷 여러 장을 시뮬 시각(`snap.t`) 순으로 들고 있다가
 * "추정한 방장 시각 − 지연" 지점을 감싸는 두 장 사이를 보간한다.
 * 방장 시계와 내 시계의 차이(offset)는 가장 빨리 도착한 쪽에 맞추되 천천히 따라가서,
 * 도착 간격이 들쭉날쭉해도 그리는 시계는 일정한 속도로 흐른다.
 */
export class SnapBuffer {
  private list: { snap: Snap; at: number }[] = [];
  private seen = new Set<number>();
  /** 방장 시뮬 시각 − 내 performance.now() 추정치 */
  private offset: number | null = null;
  private lastPushAt = 0;
  private cache = { now: -1, a: null as Snap | null, b: null as Snap | null, k: 0 };

  push(snap: Snap, now: number): GameEvent[] {
    const last = this.list[this.list.length - 1];
    if (last && snap.seed === last.snap.seed && snap.seq <= last.snap.seq) return [];
    if (last && snap.seed !== last.snap.seed) {
      this.list = [];
      this.seen.clear();
      this.offset = null;
      this.pushAnim = null;
    }
    this.list.push({ snap, at: now });
    if (this.list.length > KEEP) this.list.shift();
    const sample = snap.t - now;
    if (this.offset === null || Math.abs(sample - this.offset) > 1000) this.offset = sample;
    else {
      // 일찍 온 것(지연이 작은 것)엔 빨리, 늦게 온 것엔 아주 천천히 맞춘다 → 흔들림이 그림에 안 번진다
      const gap = Math.max(1, now - this.lastPushAt);
      this.offset += (sample - this.offset) * (sample > this.offset ? 0.3 : Math.min(0.2, gap / 4000));
    }
    this.lastPushAt = now;
    this.cache.now = -1;
    const br = this.bracket(now);
    this.pushAnim = (br.k < 0.5 ? br.a : br.b) ?? snap;
    const fresh = snap.events.filter((e) => !this.seen.has(e.id));
    for (const e of fresh) this.seen.add(e.id);
    if (this.seen.size > 400) {
      const keep = new Set(snap.events.map((e) => e.id));
      this.seen = keep;
    }
    return fresh;
  }

  latest(): Snap | null {
    return this.list[this.list.length - 1]?.snap ?? null;
  }

  /** 지금 화면에 그릴 시뮬레이션 시각 (ms) — 타이머 표시용 (최신 스냅샷 기준) */
  simNow(now: number): number {
    const last = this.list[this.list.length - 1];
    if (!last) return 0;
    return last.snap.t + (now - last.at);
  }

  /** 사람·NPC를 그리는 시뮬 시각 */
  renderT(now: number): number {
    if (this.offset === null) return 0;
    return now + this.offset - INTERP_DELAY_MS;
  }

  /** 이번 프레임에 쓸 두 장과 비율 (같은 프레임 안 호출은 한 번만 계산) */
  private bracket(now: number) {
    const c = this.cache;
    if (c.now >= 0 && Math.abs(now - c.now) < 2) return c;
    c.now = now;
    const L = this.list;
    if (L.length === 0) {
      c.a = c.b = null;
      return c;
    }
    const t = this.renderT(now);
    if (L.length === 1 || t <= L[0].snap.t) {
      c.a = c.b = L[0].snap;
      c.k = 0;
      return c;
    }
    const lastSnap = L[L.length - 1].snap;
    if (t >= lastSnap.t) {
      // 새 스냅샷이 아직 안 왔다 — 마지막 위치에 멈춰 기다린다 (튀어나가는 예측은 안 한다)
      c.a = c.b = lastSnap;
      c.k = 0;
      return c;
    }
    let i = L.length - 2;
    while (i > 0 && L[i].snap.t > t) i--;
    const a = L[i].snap;
    const b = L[i + 1].snap;
    c.a = a;
    c.b = b;
    c.k = Math.max(0, Math.min(1, (t - a.t) / Math.max(1, b.t - a.t)));
    return c;
  }

  private blend<T extends { x: number; y: number; z: number; yaw: number }>(now: number, find: (s: Snap) => T | undefined): Pose3 | null {
    const { a, b, k } = this.bracket(now);
    if (!a || !b) return null;
    const cb = find(b);
    const ca = find(a);
    if (!ca && !cb) {
      // 방금 생긴 것(분신 등) — 보간 구간엔 아직 없으니 최신 스냅샷 위치로 (원점에 번쩍 뜨지 않게)
      const l = this.latest();
      const n = l ? find(l) : undefined;
      return n ? { x: n.x, y: n.y, z: n.z, yaw: n.yaw } : null;
    }
    if (!ca || !cb) {
      // 이 사이에 생기거나 사라졌다 — 있는 쪽 그대로
      const one = (cb ?? ca)!;
      return { x: one.x, y: one.y, z: one.z, yaw: one.yaw };
    }
    // 갑자기 멀리 튀었으면(순간이동) 보간하지 않는다
    if (Math.hypot(cb.x - ca.x, cb.z - ca.z) > 4 || Math.abs(cb.y - ca.y) > 2) {
      const one = k < 0.5 ? ca : cb;
      return { x: one.x, y: one.y, z: one.z, yaw: one.yaw };
    }
    return { x: ca.x + (cb.x - ca.x) * k, y: ca.y + (cb.y - ca.y) * k, z: ca.z + (cb.z - ca.z) * k, yaw: lerpAngle(ca.yaw, cb.yaw, k) };
  }

  /**
   * 마지막 스냅샷을 받은 순간 그리던 위치에 가장 가까운 스냅샷 — 걷기/멈춤 몸짓을 위치와 같은 시점으로 맞출 때.
   * (화면은 스냅샷을 받을 때 다시 그려지니, 받는 순간 골라 둔다)
   */
  animSnap(): Snap | null {
    return this.pushAnim ?? this.latest();
  }
  private pushAnim: Snap | null = null;

  player(seat: number, now: number): Pose3 | null {
    return this.blend(now, (s) => s.players[seat]);
  }
  npc(id: number, now: number): Pose3 | null {
    return this.blend(now, (s) => s.npcs.find((n) => n.id === id));
  }
  decoy(id: number, now: number): Pose3 | null {
    return this.blend(now, (s) => s.decoys.find((d) => d.id === id));
  }
}
