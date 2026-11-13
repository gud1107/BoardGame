import { HEX } from "./lake";
import { ACCEL, DRAG, KNOCK_R, STOMP_CENTER_DMG, THAW_DAMAGE } from "./data";
import {
  airborne,
  geoOf,
  press,
  rnd,
  sectorAlive,
  setInput,
  tileAt,
  tileDoomed,
  tileSolid,
  tileWarned,
  type HostRuntime,
  type MatchState,
  type PlayerState,
} from "./sim";

/**
 * 살얼음 파티 AI (Lv.1~10). 숨은 정보가 없는 게임이라 봇도 사람과 같은 화면 정보만 쓴다
 * (얼음 금·해빙 경보·서든데스 흔들림·아이템 위치).
 *
 * 생각 순서: ① 주변 칸 점수 매기기(단단함·거리·경보·무너짐·북적임·가장자리·구멍 건너기·아이템)
 * → 가장 좋은 칸으로 ② 가는 길에 구멍이면 점프, 발밑이 곧 깨지면 비상 점프 ③ 약한 얼음 위나
 * 구멍 옆 상대가 가까우면 내려찍기 (높은 레벨은 내 발밑이 버틸 때만) ④ 유령이면 해빙 구역 투표.
 * 레벨이 낮을수록 늦게 반응하고, 경보·구멍을 덜 살피고, 한 칸에 오래 머문다.
 * 수치는 balance.sim.test.ts 셀프플레이로 맞췄다.
 */

export interface BotParams {
  /** 다시 생각하는 간격 ms (반응 속도) */
  think: number;
  /** 가는 방향 오차 (rad) */
  aim: number;
  /** 몇 m 안의 칸까지 살피나 */
  scan: number;
  /** 해빙 경보를 알아챌 확률 (생각할 때마다) */
  thawAware: number;
  /** 몇 ms 앞까지 서든데스 흔들림을 피하나 */
  doomMs: number;
  /** 가는 길의 구멍을 살필 확률 */
  holeCare: number;
  /** 구멍을 점프로 건너나 */
  jumper: boolean;
  /** 지금 칸에 머무르는 걸 얼마나 싫어하나 (클수록 자주 옮김) */
  restless: number;
  /** 기회가 왔을 때 내려찍기 확률 */
  stomp: number;
  /** 내려찍기 전에 내 발밑이 버틸지 보나 */
  stompSafe: boolean;
  /** 아이템 욕심 거리 (m) */
  greed: number;
  /** 엉뚱한 데로 가는 확률 (생각할 때마다) */
  wander: number;
  /** 점수 매기기 흔들림 */
  noise: number;
  /** 유령 투표를 "똑똑하게" 할 확률 (나머지는 아무 구역) */
  vote: number;
}

export const BOT_PARAMS: Record<number, BotParams> = {
  1: { think: 520, aim: 0.6, scan: 2.6, thawAware: 0.1, doomMs: 0, holeCare: 0.2, jumper: false, restless: 0.1, stomp: 0.06, stompSafe: false, greed: 1.5, wander: 0.3, noise: 2.4, vote: 0 },
  2: { think: 460, aim: 0.5, scan: 3, thawAware: 0.25, doomMs: 200, holeCare: 0.35, jumper: false, restless: 0.25, stomp: 0.08, stompSafe: false, greed: 2, wander: 0.24, noise: 2, vote: 0.15 },
  3: { think: 400, aim: 0.42, scan: 3.4, thawAware: 0.4, doomMs: 400, holeCare: 0.5, jumper: true, restless: 0.4, stomp: 0.1, stompSafe: false, greed: 2.5, wander: 0.18, noise: 1.6, vote: 0.3 },
  4: { think: 350, aim: 0.35, scan: 3.8, thawAware: 0.55, doomMs: 600, holeCare: 0.65, jumper: true, restless: 0.55, stomp: 0.13, stompSafe: false, greed: 3, wander: 0.13, noise: 1.3, vote: 0.45 },
  5: { think: 300, aim: 0.28, scan: 4.2, thawAware: 0.7, doomMs: 800, holeCare: 0.85, jumper: true, restless: 0.7, stomp: 0.16, stompSafe: true, greed: 3.5, wander: 0.09, noise: 1.05, vote: 0.6 },
  6: { think: 255, aim: 0.22, scan: 4.6, thawAware: 0.8, doomMs: 1000, holeCare: 0.95, jumper: true, restless: 0.8, stomp: 0.2, stompSafe: true, greed: 4, wander: 0.06, noise: 0.85, vote: 0.7 },
  7: { think: 215, aim: 0.17, scan: 5, thawAware: 0.88, doomMs: 1200, holeCare: 1, jumper: true, restless: 0.9, stomp: 0.24, stompSafe: true, greed: 4.5, wander: 0.04, noise: 0.65, vote: 0.8 },
  8: { think: 180, aim: 0.12, scan: 5.4, thawAware: 0.94, doomMs: 1400, holeCare: 1, jumper: true, restless: 1, stomp: 0.28, stompSafe: true, greed: 5, wander: 0.02, noise: 0.5, vote: 0.88 },
  9: { think: 150, aim: 0.08, scan: 5.8, thawAware: 0.98, doomMs: 1600, holeCare: 1, jumper: true, restless: 1.1, stomp: 0.32, stompSafe: true, greed: 5.5, wander: 0.01, noise: 0.38, vote: 0.94 },
  10: { think: 120, aim: 0.05, scan: 6.2, thawAware: 1, doomMs: 1800, holeCare: 1, jumper: true, restless: 1.2, stomp: 0.36, stompSafe: true, greed: 6, wander: 0, noise: 0.28, vote: 1 },
};

export function paramsFor(lv: number): BotParams {
  return BOT_PARAMS[Math.max(1, Math.min(10, Math.round(lv)))] ?? BOT_PARAMS[5];
}

/** (x,z) 둘레 r m에 구멍(깨진 칸·호수 밖)이 몇 군데인가 (8방향) */
export function holesAround(s: MatchState, x: number, z: number, r: number): number {
  let n = 0;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    if (!tileSolid(s, tileAt(s, x + Math.cos(a) * r, z + Math.sin(a) * r))) n++;
  }
  return n;
}

/** 가는 길에 구멍이 있나 → 0 없음 / 1 건너뛸 만한 좁은 구멍 / 2 넓은 구멍, 그리고 길 위 가장 약한 얼음 */
function pathCheck(s: MatchState, x0: number, z0: number, x1: number, z1: number): { holes: 0 | 1 | 2; weakest: number } {
  const d = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.ceil(d / 0.35));
  let run = 0;
  let worst = 0;
  let weakest = 1;
  for (let k = 1; k <= n; k++) {
    const u = k / n;
    const i = tileAt(s, x0 + (x1 - x0) * u, z0 + (z1 - z0) * u);
    if (!tileSolid(s, i)) {
      run += d / n;
      worst = Math.max(worst, run);
    } else {
      run = 0;
      weakest = Math.min(weakest, s.hp[i]);
    }
  }
  return { holes: worst === 0 ? 0 : worst <= 2.2 ? 1 : 2, weakest };
}

function noisy(rt: HostRuntime, ang: number, amp: number): number {
  return ang + (rnd(rt.botRng) * 2 - 1) * amp;
}

function steer(rt: HostRuntime, seat: number, ang: number, speed = 1) {
  const cur = rt.inputs[seat];
  setInput(rt, seat, { mx: Math.cos(ang) * speed, mz: Math.sin(ang) * speed, jump: cur.jump, stomp: cur.stomp, vote: cur.vote });
}

/** 목표 지점으로 가되 미끄러지지 않게 미리 브레이크 (얼음 관성 보정) */
function seek(rt: HostRuntime, me: PlayerState, tx: number, tz: number, aim: number, brake: boolean) {
  const dx = tx - me.x;
  const dz = tz - me.z;
  const d = Math.hypot(dx, dz);
  if (!brake) {
    steer(rt, me.seat, noisy(rt, Math.atan2(dz, dx), aim), d < 0.3 ? 0.25 : 1);
    return;
  }
  const vmax = ACCEL / DRAG;
  const want = d < 1e-3 ? 0 : vmax * Math.min(1, d / 1.3);
  const wx = d < 1e-3 ? 0 : (dx / d) * want;
  const wz = d < 1e-3 ? 0 : (dz / d) * want;
  const ax = (wx - me.vx) * 0.9;
  const az = (wz - me.vz) * 0.9;
  const l = Math.hypot(ax, az);
  if (l < 0.05) {
    steer(rt, me.seat, 0, 0);
    return;
  }
  steer(rt, me.seat, noisy(rt, Math.atan2(az, ax), aim), Math.min(1, l));
}

function leaderSeat(s: MatchState, exclude: number): number {
  let best = -1;
  for (const p of s.players) if (p.seat !== exclude && p.alive && (best < 0 || p.score > s.players[best].score)) best = p.seat;
  return best;
}

export function botThink(rt: HostRuntime, seat: number) {
  const s = rt.state;
  const me = s.players[seat];
  const mem = rt.bots[seat];
  if (s.t < mem.nextThinkAt) return;
  const P = paramsFor(me.lv);
  mem.nextThinkAt = s.t + P.think * (0.8 + rnd(rt.botRng) * 0.4);
  if (!me.alive) {
    if (me.ghost) ghostVote(rt, me, P);
    return;
  }
  const geo = geoOf(s);
  if (airborne(me)) {
    if (mem.goal >= 0 && tileSolid(s, mem.goal)) {
      const g = geo.tiles[mem.goal];
      seek(rt, me, g.x, g.z, P.aim * 0.5, P.holeCare >= 0.85);
    }
    return;
  }
  const here = tileAt(s, me.x, me.z);
  const aware = rnd(rt.botRng) < P.thawAware;
  const careHoles = rnd(rt.botRng) < P.holeCare;

  // 가끔 딴짓 (낮은 레벨): 근처 아무 데로
  if (mem.wander && s.t < mem.wander.until && here >= 0 && s.hp[here] > 0.3) {
    seek(rt, me, mem.wander.x, mem.wander.z, P.aim, P.holeCare >= 0.5);
    return;
  }
  if (rnd(rt.botRng) < P.wander && here >= 0 && s.hp[here] > 0.5) {
    const a = rnd(rt.botRng) * Math.PI * 2;
    const wx = me.x + Math.cos(a) * 2;
    const wz = me.z + Math.sin(a) * 2;
    const pc = pathCheck(s, me.x, me.z, wx, wz);
    if (tileSolid(s, tileAt(s, wx, wz)) && pc.holes === 0 && pc.weakest > 0.3) {
      mem.wander = { x: wx, z: wz, until: s.t + 600 };
      return;
    }
  }

  // ① 칸 고르기
  let best = -1;
  let bestScore = -Infinity;
  let bestPath: 0 | 1 | 2 = 0;
  for (let i = 0; i < geo.tiles.length; i++) {
    if (!tileSolid(s, i)) continue;
    const t = geo.tiles[i];
    const d = Math.hypot(t.x - me.x, t.z - me.z);
    if (d > P.scan) continue;
    let sc = s.hp[i] * 3 - d * 0.32;
    if (aware && tileWarned(s, i)) sc -= s.hp[i] <= THAW_DAMAGE + 0.05 ? 5 : 2;
    if (tileDoomed(s, i, P.doomMs)) sc -= 6;
    if (i === here) sc -= 0.4 + P.restless * 0.6;
    for (const o of s.players) if (o !== me && o.alive && Math.hypot(o.x - t.x, o.z - t.z) < 1.1) sc -= 0.9;
    sc -= (t.ring / geo.rings) * (s.sudden ? 2.2 : 0.7);
    if (P.holeCare > 0.5) sc -= holesAround(s, t.x, t.z, HEX * 1.2) * 0.12;
    let path: 0 | 1 | 2 = 0;
    if (careHoles && d > HEX * 0.8) {
      const pc = pathCheck(s, me.x, me.z, t.x, t.z);
      path = pc.holes;
      if (path === 1) sc -= P.jumper ? 0.6 : 2.5;
      else if (path === 2) sc -= 6;
      // 금이 많이 간 칸을 밟고 지나가면 그 사이에 깨질 수 있다
      if (pc.weakest < 0.22 && path === 0) sc -= P.jumper ? 0.8 : 2;
    }
    const it = s.items.find((x) => x.tile === i);
    if (it && d <= P.greed) sc += it.kind === "fish" ? 1.8 : it.kind === "frost" ? 1.4 + (1 - s.hp[here >= 0 ? here : i]) : 1.1;
    sc += (rnd(rt.botRng) - 0.5) * P.noise;
    if (sc > bestScore) {
      bestScore = sc;
      best = i;
      bestPath = path;
    }
  }
  mem.goal = best;
  if (best < 0) {
    steer(rt, seat, Math.atan2(-me.z, -me.x), 0.5);
    return;
  }
  const g = geo.tiles[best];
  const gx = g.x - me.x;
  const gz = g.z - me.z;
  const gd = Math.hypot(gx, gz);
  const ang = Math.atan2(gz, gx);
  // 미끄러져 구멍·호수 밖으로 가는 중이면 먼저 브레이크 (구멍을 살피는 봇만)
  const sx = me.x + me.vx * 0.38;
  const sz = me.z + me.vz * 0.38;
  if ((careHoles || P.holeCare >= 0.5) && !tileSolid(s, tileAt(s, sx, sz)) && Math.hypot(me.vx, me.vz) > 1 && !(P.jumper && bestPath === 1)) {
    steer(rt, seat, Math.atan2(-me.vz, -me.vx), 1);
    return;
  }
  seek(rt, me, g.x, g.z, P.aim, careHoles);

  // ② 점프: 바로 앞이 구멍이면 건너기, 발밑이 곧 깨지면 비상 점프
  if (s.t >= me.jumpCdAt) {
    const ax = me.x + Math.cos(ang) * 0.75;
    const az = me.z + Math.sin(ang) * 0.75;
    const aheadHole = !tileSolid(s, tileAt(s, ax, az));
    const hereBad = here >= 0 && (s.hp[here] < 0.12 || tileDoomed(s, here, 350));
    if (P.jumper && aheadHole && gd > 0.7 && bestPath !== 2) {
      press(rt, seat, "jump");
      return;
    }
    if (P.jumper && hereBad && gd > 0.9) {
      press(rt, seat, "jump");
      return;
    }
    // 점프를 모르는 낮은 레벨도 구멍 바로 앞에선 가끔 뛴다
    if (!P.jumper && aheadHole && rnd(rt.botRng) < 0.25) press(rt, seat, "jump");
  }

  // ③ 내려찍기
  if (s.t >= me.stompCdAt && rnd(rt.botRng) < P.stomp) {
    if (P.stompSafe && here >= 0 && s.hp[here] <= STOMP_CENTER_DMG + 0.08) return;
    const lead = leaderSeat(s, seat);
    let value = 0;
    for (const o of s.players) {
      if (o === me || !o.alive || airborne(o)) continue;
      const d = Math.hypot(o.x - me.x, o.z - me.z);
      if (d > KNOCK_R * 0.85) continue;
      const oi = tileAt(s, o.x, o.z);
      const weak = oi >= 0 ? 1 - s.hp[oi] : 1;
      value += weak * 1.6 + holesAround(s, o.x, o.z, 1.6) * 0.35 + (o.seat === lead ? 0.4 : 0) + (1 - d / KNOCK_R) * 0.5;
    }
    if (value > (P.stompSafe ? 1.1 : 0.5)) press(rt, seat, "stomp");
  }
}

/** 유령 투표: 살아 있는 상대가 가장 많이 선 구역(점수 1등은 더 무겁게). 낮은 레벨은 아무 데나. */
function ghostVote(rt: HostRuntime, me: PlayerState, P: BotParams) {
  const s = rt.state;
  if (s.phase !== "fight" || me.vote >= 0) return;
  const valid = [0, 1, 2, 3, 4, 5].filter((k) => sectorAlive(s, k) >= 2 && (!s.thaw || k !== s.thaw.sector));
  if (valid.length === 0) return;
  let pick = valid[Math.floor(rnd(rt.botRng) * valid.length)];
  if (rnd(rt.botRng) < P.vote) {
    const lead = leaderSeat(s, me.seat);
    const weight = [0, 0, 0, 0, 0, 0];
    const geo = geoOf(s);
    for (const o of s.players) {
      if (!o.alive) continue;
      const ti = tileAt(s, o.x, o.z);
      const sec = ti >= 0 ? geo.tiles[ti].sector : -1;
      if (sec < 0) continue;
      weight[sec] += 1 + (o.seat === lead ? 1.5 : 0);
    }
    let w = -1;
    for (const k of valid) if (weight[k] > w) {
      w = weight[k];
      pick = k;
    }
  }
  const cur = rt.inputs[me.seat];
  setInput(rt, me.seat, { mx: 0, mz: 0, jump: cur.jump, stomp: cur.stomp, vote: pick });
}
