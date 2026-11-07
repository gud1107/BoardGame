import { KKOM_CAMP_MS, SPAM_WINDOW_MS, type GameOptions } from "./data";
import type { DecoyState, GameEvent, MatchState, NpcKind, Phase, PingState, PlayerStats, Role, RoundSummary, TrapState } from "./sim";

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

export function makeSnap(s: MatchState, seq: number): Snap {
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
    players: s.players.map((p) => ({
      s: p.seat,
      role: p.role,
      bot: p.bot,
      x: r2(p.x),
      y: r2(p.y),
      z: r2(p.z),
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
      wr: p.wrongAt.filter((t) => t > s.t - SPAM_WINDOW_MS).length,
      ...(p.role === "seeker" && s.goal ? { camp: Math.min(1, Math.round((p.campMs / KKOM_CAMP_MS) * 100) / 100) } : {}),
      ...(p.role === "seeker"
        ? { aug: p.augs, ao: p.augOffer, arr: p.augRerolls, mhp: p.maxHp, tr: p.traps, sk: p.shocks, sh: p.shieldLeft, hu: s.t < p.hunterUntil, sn: p.sense }
        : {}),
      ...(over ? { stats: p.stats } : {}),
    })),
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

const INTERP_MS = 110;

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

/** 받는 쪽: 최근 두 스냅샷 사이를 보간 */
export class SnapBuffer {
  prev: { snap: Snap; at: number } | null = null;
  curr: { snap: Snap; at: number } | null = null;
  private seen = new Set<number>();

  push(snap: Snap, now: number): GameEvent[] {
    if (this.curr && (snap.seq <= this.curr.snap.seq && snap.seed === this.curr.snap.seed)) return [];
    if (this.curr && snap.seed !== this.curr.snap.seed) {
      this.prev = null;
      this.seen.clear();
    } else this.prev = this.curr;
    this.curr = { snap, at: now };
    const fresh = snap.events.filter((e) => !this.seen.has(e.id));
    for (const e of fresh) this.seen.add(e.id);
    if (this.seen.size > 400) {
      const keep = new Set(snap.events.map((e) => e.id));
      this.seen = keep;
    }
    return fresh;
  }

  latest(): Snap | null {
    return this.curr?.snap ?? null;
  }

  /** 지금 화면에 그릴 시뮬레이션 시각 (ms) */
  simNow(now: number): number {
    if (!this.curr) return 0;
    return this.curr.snap.t + (now - this.curr.at);
  }

  private blend<T extends { x: number; y: number; z: number; yaw: number }>(now: number, find: (s: Snap) => T | undefined): Pose3 | null {
    const c = this.curr ? find(this.curr.snap) : undefined;
    if (!c) return null;
    const p = this.prev ? find(this.prev.snap) : undefined;
    if (!p || !this.prev || !this.curr) return { x: c.x, y: c.y, z: c.z, yaw: c.yaw };
    const span = Math.max(1, this.curr.at - this.prev.at);
    const k = Math.max(0, Math.min(1, (now - INTERP_MS - this.prev.at) / span));
    // 갑자기 멀리 튀었으면(순간이동) 보간하지 않는다
    if (Math.hypot(c.x - p.x, c.z - p.z) > 4 || Math.abs(c.y - p.y) > 2) return { x: c.x, y: c.y, z: c.z, yaw: c.yaw };
    return { x: p.x + (c.x - p.x) * k, y: p.y + (c.y - p.y) * k, z: p.z + (c.z - p.z) * k, yaw: lerpAngle(p.yaw, c.yaw, k) };
  }

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
