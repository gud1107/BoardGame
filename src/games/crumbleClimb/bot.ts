import { GRAVITY, JUMP_V, RUN_SPEED, BOUNCE_V, SAB_PICK_MS, type SabKind } from "./data";
import { edgeRoom, onPlatform, platPos, type Platform, type Tower } from "./tower";
import { climbing, icy, leaderOf, playCard, press, rnd, setInput, solid, towerOf, type HostRuntime, type MatchState, type PlayerState } from "./sim";

/**
 * 무너지는 탑 오르기 AI (Lv.1~10). 숨은 정보가 없는 게임이라 봇도 화면에 보이는 것만 쓴다
 * (발판 모양·금·얼음·붕괴선·아이템·남의 위치).
 *
 * - **길 고르기** (생각 간격마다): 지금 발판에서 점프 한 번에 닿는 이웃 중 "왕관까지 남은 점프 수"가
 *   적고 위험(금 간·흔들리는·얼음·붕괴선 가까움·남이 선 발판)이 적은 곳. 낮은 레벨은 흔들림이 커서
 *   돌아가는 길·위험한 발판을 고른다.
 * - **실행** (매 스텝): 목표 발판 쪽으로 달리다가 닿을 만한 거리에서 점프, 공중에선 목표 위로 몸을 튼다.
 *   낮은 레벨은 점프 시점이 들쭉날쭉하고(덜 뛰거나 너무 일찍), 발판에서 머뭇거린다.
 * - 밀치기·🪶 공중 점프 구조·방해 카드 고르기도 레벨별 확률.
 */

export interface BotParams {
  /** 다시 길을 고르는 간격 ms */
  think: number;
  /** 달리는 방향 오차 (rad) */
  aim: number;
  /** 점프 시점 오차 (m, 클수록 덜/더 뛰어 떨어짐) */
  jumpErr: number;
  /** 길 점수 흔들림 */
  noise: number;
  /** 발판 위에서 머뭇거릴 확률 · 시간 */
  hesitate: number;
  hesitateMs: number;
  /** 위험한 발판을 얼마나 피하나 (0~1) */
  care: number;
  /** 밀치기 기회에 밀 확률 */
  shove: number;
  /** 떨어질 때 🪶 깃털로 살아날 확률 */
  rescue: number;
  /** 아이템 욕심 (점수 보너스) */
  greed: number;
  /** 방해 카드를 상황 보고 고를 확률 */
  cardSmart: number;
  /** 트램펄린 지름길을 쓰나 */
  bounce: number;
}

export const BOT_PARAMS: Record<number, BotParams> = {
  1: { think: 560, aim: 0.42, jumpErr: 1.25, noise: 7, hesitate: 0.5, hesitateMs: 1300, care: 0.05, shove: 0.04, rescue: 0.1, greed: 0.5, cardSmart: 0, bounce: 0 },
  2: { think: 500, aim: 0.36, jumpErr: 1.05, noise: 6, hesitate: 0.42, hesitateMs: 1150, care: 0.15, shove: 0.06, rescue: 0.2, greed: 1, cardSmart: 0.15, bounce: 0.1 },
  3: { think: 440, aim: 0.3, jumpErr: 0.85, noise: 5, hesitate: 0.34, hesitateMs: 1000, care: 0.3, shove: 0.08, rescue: 0.3, greed: 1.5, cardSmart: 0.3, bounce: 0.2 },
  4: { think: 380, aim: 0.24, jumpErr: 0.7, noise: 4.2, hesitate: 0.27, hesitateMs: 850, care: 0.45, shove: 0.11, rescue: 0.45, greed: 2, cardSmart: 0.45, bounce: 0.35 },
  5: { think: 320, aim: 0.19, jumpErr: 0.55, noise: 3.4, hesitate: 0.2, hesitateMs: 700, care: 0.6, shove: 0.14, rescue: 0.6, greed: 2.5, cardSmart: 0.6, bounce: 0.5 },
  6: { think: 270, aim: 0.15, jumpErr: 0.43, noise: 2.7, hesitate: 0.14, hesitateMs: 560, care: 0.7, shove: 0.18, rescue: 0.7, greed: 3, cardSmart: 0.7, bounce: 0.6 },
  7: { think: 225, aim: 0.11, jumpErr: 0.33, noise: 2.1, hesitate: 0.09, hesitateMs: 440, care: 0.8, shove: 0.22, rescue: 0.8, greed: 3.5, cardSmart: 0.8, bounce: 0.7 },
  8: { think: 185, aim: 0.08, jumpErr: 0.24, noise: 1.6, hesitate: 0.05, hesitateMs: 330, care: 0.88, shove: 0.26, rescue: 0.9, greed: 4, cardSmart: 0.88, bounce: 0.8 },
  9: { think: 150, aim: 0.05, jumpErr: 0.16, noise: 1.15, hesitate: 0.02, hesitateMs: 250, care: 0.95, shove: 0.3, rescue: 0.96, greed: 4.5, cardSmart: 0.95, bounce: 0.9 },
  10: { think: 120, aim: 0.03, jumpErr: 0.1, noise: 0.8, hesitate: 0, hesitateMs: 0, care: 1, shove: 0.34, rescue: 1, greed: 5, cardSmart: 1, bounce: 1 },
};

export function paramsFor(lv: number): BotParams {
  return BOT_PARAMS[Math.max(1, Math.min(10, Math.round(lv)))] ?? BOT_PARAMS[5];
}

/** 높이 차 dy를 오를 때 점프에서 착지까지 걸리는 시간 (못 오르면 -1) */
export function airTime(dy: number, v0 = JUMP_V): number {
  const disc = v0 * v0 - 2 * GRAVITY * dy;
  if (disc < 0) return -1;
  return (v0 + Math.sqrt(disc)) / GRAVITY;
}

/** 길 점수 (작을수록 좋음) */
function routeScore(s: MatchState, tower: Tower, me: PlayerState, cur: Platform, q: Platform, prm: BotParams, noise: number): number {
  let sc = tower.hops[q.i] * 10 - (q.y - cur.y) * 2;
  const care = prm.care;
  if (q.kind === "crumbly") sc += 3 * care;
  if (q.kind === "moving") sc += 1.5 * care;
  if (q.kind === "bouncy") sc += prm.bounce > 0.5 ? -2 : 4 * (1 - prm.bounce);
  if (icy(s, q.i)) sc += 3 * care;
  if (s.crumbleAt[q.i] > 0) sc += 14 * care;
  if (q.y < s.collapseY + 2.2) sc += 25 * care;
  for (const o of s.players) if (o !== me && climbing(o) && o.on === q.i) sc += 2.5 * care;
  if (s.items.some((it) => it.plat === q.i)) sc -= prm.greed;
  for (const r of s.rocks) {
    const c = platPos(q, s.t);
    if (Math.hypot(r.x - c.x, r.z - c.z) < q.r + 1 && Math.abs(r.y - q.y) < 1.5) sc += 10 * care;
  }
  return sc + noise;
}

function chooseGoal(rt: HostRuntime, me: PlayerState, cur: Platform, prm: BotParams): number {
  const s = rt.state;
  const tower = towerOf(s);
  const cand = tower.next[cur.i].filter((i) => solid(s, i));
  if (cand.length === 0) return -1;
  let best = -1;
  let bestSc = Infinity;
  for (const i of cand) {
    const q = tower.platforms[i];
    // 내려가는 길은 막혔을 때만
    if (tower.hops[i] >= tower.hops[cur.i] && q.y < cur.y - 0.3) continue;
    const sc = routeScore(s, tower, me, cur, q, prm, rnd(rt.botRng) * prm.noise);
    if (sc < bestSc) {
      bestSc = sc;
      best = i;
    }
  }
  if (best < 0) {
    // 다 막혔으면 가장 높은 곳이라도
    best = cand.reduce((a, b) => (tower.platforms[b].y > tower.platforms[a].y ? b : a), cand[0]);
  }
  return best;
}

/** 지금 발판이 위험한가 (금 → 곧 무너짐, 붕괴선 가까움, 낙석 경고) */
function curDanger(s: MatchState, cur: Platform, me: PlayerState): boolean {
  if (s.crumbleAt[cur.i] > 0) return true;
  if (cur.y < s.collapseY + 2.5) return true;
  return s.rocks.some((r) => Math.hypot(r.x - me.x, r.z - me.z) < 1.6 && Math.abs(r.y - me.y) < 1.5);
}

function pickCard(s: MatchState, me: PlayerState, prm: BotParams, r: number): number {
  const card = me.card;
  if (!card) return 0;
  if (r > prm.cardSmart) return Math.floor(r * 997) % card.kinds.length;
  const lead = leaderOf(s, me.seat);
  if (lead < 0) return 0;
  const tg = s.players[lead];
  const tower = towerOf(s);
  const on = tg.on >= 0 ? tower.platforms[tg.on] : null;
  const want = (k: SabKind): number => {
    if (k === "shake") return on && on.kind !== "base" ? 3 + (on.kind === "moving" ? 1 : 0) : 0.5;
    if (k === "rocks") return on ? 2.6 : 1.2;
    if (k === "wind") return Math.hypot(tg.x, tg.z) > 4.6 ? 2.8 : 1.6;
    return 2.0; // ice
  };
  let best = 0;
  for (let i = 1; i < card.kinds.length; i++) if (want(card.kinds[i]) > want(card.kinds[best])) best = i;
  return best;
}

export function botThink(rt: HostRuntime, seat: number) {
  const s = rt.state;
  const me = s.players[seat];
  const mem = rt.bots[seat];
  const prm = paramsFor(me.lv);
  // 방해 카드 (탈락자도 쓴다)
  if (me.card) {
    const waited = s.t - (me.card.until - SAB_PICK_MS);
    const delay = 2200 - prm.cardSmart * 1300;
    if (waited >= delay) playCard(s, seat, pickCard(s, me, prm, rnd(rt.botRng)));
  }
  if (!climbing(me)) {
    setInput(rt, seat, { mx: 0, mz: 0 });
    return;
  }
  const tower = towerOf(s);
  const grounded = me.on >= 0;
  // ── 땅 위: 목표 고르기
  if (grounded) {
    const cur = tower.platforms[me.on];
    const goalBad = mem.goal < 0 || !solid(s, mem.goal) || mem.goal === me.on || !tower.next[cur.i].includes(mem.goal);
    const danger = curDanger(s, cur, me);
    if (goalBad || s.t >= mem.nextThinkAt) {
      const before = mem.goal;
      mem.goal = chooseGoal(rt, me, cur, prm);
      mem.nextThinkAt = s.t + prm.think * (0.75 + rnd(rt.botRng) * 0.5);
      if (mem.goal !== before) {
        mem.jumpBias = (rnd(rt.botRng) * 2 - 1) * prm.jumpErr;
        if (!danger && rnd(rt.botRng) < prm.hesitate) mem.waitUntil = s.t + prm.hesitateMs * (0.5 + rnd(rt.botRng));
        else mem.waitUntil = 0;
      }
    }
    if (danger) mem.waitUntil = 0;
    if (mem.goal < 0 || s.t < mem.waitUntil) {
      setInput(rt, seat, { mx: 0, mz: 0 });
      return;
    }
    const g = tower.platforms[mem.goal];
    const lead = g.kind === "moving" ? 0.45 : 0;
    const c = platPos(g, s.t + lead * 1000);
    let dx = c.x - me.x;
    let dz = c.z - me.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 1e-6) {
      dx /= dist;
      dz /= dist;
    }
    const aimErr = Math.sin(s.t * 0.0021 + seat * 1.7) * prm.aim;
    const ca = Math.cos(aimErr);
    const sa = Math.sin(aimErr);
    let mx = dx * ca - dz * sa;
    let mz = dx * sa + dz * ca;
    // 기둥에 막히면 바깥으로 돌아간다
    const ax = me.x + mx * 0.6;
    const az = me.z + mz * 0.6;
    if (Math.hypot(ax, az) < 2.15) {
      const d = Math.max(0.5, Math.hypot(me.x, me.z));
      mx += (me.x / d) * 0.8;
      mz += (me.z / d) * 0.8;
      const l = Math.hypot(mx, mz);
      mx /= l;
      mz /= l;
    }
    const dy = g.y - cur.y;
    const touching = onPlatform(g, me.x, me.z, s.t, -0.1) && Math.abs(dy) < 0.15;
    const needJump = !touching && (dy > 0.12 || dist - g.r > -0.15);
    if (needJump) {
      const tAir = cur.kind === "bouncy" ? airTime(dy, BOUNCE_V) : airTime(Math.max(0, dy));
      const reach = tAir > 0 ? RUN_SPEED * tAir : 2.5;
      const want = Math.max(0.6, reach * 0.62 + mem.jumpBias);
      const room = edgeRoom(cur, me.x, me.z, s.t);
      if (dist <= want || room < 0.12) press(rt, seat, "jump");
    }
    // 밀치기: 앞에 바짝 붙은 상대
    if (s.t >= me.shoveCdAt) {
      for (const o of s.players) {
        if (o === me || !climbing(o) || Math.abs(o.y - me.y) > 0.8) continue;
        const ox = o.x - me.x;
        const oz = o.z - me.z;
        const od = Math.hypot(ox, oz);
        if (od > 1.45 || od < 1e-6) continue;
        const facing = (ox * Math.cos(me.face) + oz * Math.sin(me.face)) / od;
        if (facing < 0.55) continue;
        const ahead = o.y > me.y - 0.2 ? 1.4 : 1;
        if (rnd(rt.botRng) < prm.shove * ahead * 0.03) press(rt, seat, "shove");
        break;
      }
    }
    setInput(rt, seat, { mx, mz });
    return;
  }
  // ── 공중: 트램펄린으로 튀어 오르는 중이면 거기서 갈 곳을 다시 고른다
  if (me.lastOn >= 0 && (mem.goal < 0 || mem.goal === me.lastOn || !solid(s, mem.goal)) && tower.platforms[me.lastOn].kind === "bouncy" && me.vy > 0) {
    mem.goal = chooseGoal(rt, me, tower.platforms[me.lastOn], prm);
  }
  // ── 공중: 목표 위로 몸 틀기
  if (mem.goal >= 0) {
    const g = tower.platforms[mem.goal];
    const c = platPos(g, s.t);
    const dx = c.x - me.x;
    const dz = c.z - me.z;
    const dist = Math.hypot(dx, dz);
    const above = me.y > g.y - 0.1;
    let mx = 0;
    let mz = 0;
    if (dist > 1e-6) {
      const k = above ? Math.min(1, dist / Math.max(0.6, g.r * 0.7)) : 1;
      mx = (dx / dist) * k;
      mz = (dz / dist) * k;
    }
    // 떨어지는 중인데 목표보다 낮아지면 🪶 깃털로 구조
    if (me.feather && me.vy < -1 && me.y < g.y - 0.3 && me.y > g.y - 1.5 && dist < 3 && rnd(rt.botRng) < prm.rescue * 0.2) press(rt, seat, "jump");
    setInput(rt, seat, { mx, mz });
  }
}

