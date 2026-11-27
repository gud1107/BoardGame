import { tileIndexAt } from "./arena";
import { DASH_SPEED } from "./data";
import { airborne, dashing, geoOf, press, rnd, setInput, tileDoomed, type HostRuntime, type MatchState, type PlayerState } from "./sim";

/**
 * 범퍼 아레나 AI (Lv.1~10). 숨은 정보가 없는 게임이라 봇도 사람과 같은 화면 정보만 쓴다.
 *
 * 생각 순서: ① 내 발밑·진행 방향이 위험하면 안쪽으로 ② 대시가 날아오면 점프/버티기
 * ③ 가까운 아이템 ④ "가장자리에 가까운" 상대 뒤로 돌아가서 가장자리 쪽으로 대시.
 * 레벨이 낮을수록 늦게 반응하고, 조준이 흔들리고, 가장자리를 덜 살핀다.
 * 수치는 balance.sim.test.ts 셀프플레이로 맞췄다.
 */

export interface BotParams {
  /** 다시 생각하는 간격 ms (반응 속도) */
  think: number;
  /** 조준 오차 (rad) */
  aim: number;
  /** 가장자리 여유 (m) — 이보다 가까우면 안쪽으로 */
  margin: number;
  /** 몇 초 앞까지 무너질 타일을 피하나 */
  doomMs: number;
  /** 대시 정렬 허용각 (rad) — 상대·가장자리가 이 각 안에 있을 때만 대시 */
  align: number;
  /** 대시 사거리 (m) */
  reach: number;
  /** 날아오는 대시를 피할 확률 */
  dodge: number;
  /** 아이템 욕심 거리 (m) */
  greed: number;
  /** 아무 데로나 가는 확률 (생각할 때마다) */
  wander: number;
  /** 유령 입김을 쓰나 */
  gust: number;
}

export const BOT_PARAMS: Record<number, BotParams> = {
  1: { think: 480, aim: 0.75, margin: 0.4, doomMs: 0, align: 3.2, reach: 2.6, dodge: 0, greed: 2, wander: 0.35, gust: 0.1 },
  2: { think: 420, aim: 0.6, margin: 0.6, doomMs: 300, align: 2.6, reach: 2.8, dodge: 0.05, greed: 2.5, wander: 0.28, gust: 0.15 },
  3: { think: 360, aim: 0.5, margin: 0.8, doomMs: 500, align: 2.0, reach: 3, dodge: 0.12, greed: 3, wander: 0.2, gust: 0.25 },
  4: { think: 310, aim: 0.4, margin: 1.0, doomMs: 700, align: 1.6, reach: 3.1, dodge: 0.2, greed: 3.5, wander: 0.15, gust: 0.35 },
  5: { think: 260, aim: 0.32, margin: 1.15, doomMs: 900, align: 1.3, reach: 3.2, dodge: 0.3, greed: 4, wander: 0.1, gust: 0.45 },
  6: { think: 220, aim: 0.25, margin: 1.3, doomMs: 1100, align: 1.1, reach: 3.3, dodge: 0.4, greed: 4.5, wander: 0.07, gust: 0.55 },
  7: { think: 185, aim: 0.19, margin: 1.4, doomMs: 1300, align: 0.95, reach: 3.4, dodge: 0.5, greed: 5, wander: 0.05, gust: 0.65 },
  8: { think: 150, aim: 0.14, margin: 1.5, doomMs: 1500, align: 0.85, reach: 3.5, dodge: 0.6, greed: 5.5, wander: 0.03, gust: 0.75 },
  9: { think: 120, aim: 0.1, margin: 1.6, doomMs: 1700, align: 0.75, reach: 3.6, dodge: 0.7, greed: 6, wander: 0.015, gust: 0.85 },
  10: { think: 90, aim: 0.06, margin: 1.7, doomMs: 1800, align: 0.65, reach: 3.7, dodge: 0.8, greed: 6.5, wander: 0, gust: 0.95 },
};

export function paramsFor(lv: number): BotParams {
  return BOT_PARAMS[Math.max(1, Math.min(10, Math.round(lv)))] ?? BOT_PARAMS[5];
}

const DIRS = 16;

/** (x,z)에서 섬 밖(또는 곧 무너질 칸)까지 가장 가까운 방향·거리 */
export function edgeOf(s: MatchState, x: number, z: number, doomMs: number): { dx: number; dz: number; dist: number } {
  const geo = geoOf(s);
  let best = { dx: 1, dz: 0, dist: Infinity };
  for (let k = 0; k < DIRS; k++) {
    const a = (k / DIRS) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    for (let r = 0.25; r <= 10; r += 0.4) {
      const i = tileIndexAt(geo, x + dx * r, z + dz * r);
      if (i < 0 || tileDoomed(s, i, doomMs)) {
        if (r < best.dist) best = { dx, dz, dist: r };
        break;
      }
    }
  }
  return best;
}

/** 안전한 칸들의 가운데 (가운데 칸은 안 무너지니 항상 하나는 있다) */
function safeCenter(s: MatchState, doomMs: number, fromX: number, fromZ: number): { x: number; z: number } {
  const geo = geoOf(s);
  let sx = 0;
  let sz = 0;
  let n = 0;
  let near = { x: 0, z: 0, d: Infinity };
  for (let i = 0; i < geo.tiles.length; i++) {
    if (tileDoomed(s, i, doomMs)) continue;
    const t = geo.tiles[i];
    sx += t.x;
    sz += t.z;
    n++;
    const d = Math.hypot(t.x - fromX, t.z - fromZ);
    if (d < near.d) near = { x: t.x, z: t.z, d };
  }
  if (n === 0) return { x: 0, z: 0 };
  // 무게중심 쪽으로 가되, 바로 옆 안전한 칸이 멀지 않으면 그쪽
  const cx = sx / n;
  const cz = sz / n;
  return near.d < 1.2 ? { x: (near.x + cx) / 2, z: (near.z + cz) / 2 } : { x: cx, z: cz };
}

function noisy(rt: HostRuntime, ang: number, amp: number): number {
  return ang + (rnd(rt.botRng) * 2 - 1) * amp;
}

function steer(rt: HostRuntime, seat: number, ang: number, brace = false, speed = 1) {
  setInput(rt, seat, { mx: Math.cos(ang) * speed, mz: Math.sin(ang) * speed, brace, dash: rt.inputs[seat].dash, jump: rt.inputs[seat].jump });
}

export function botThink(rt: HostRuntime, seat: number) {
  const s = rt.state;
  const me = s.players[seat];
  const mem = rt.bots[seat];
  if (s.t < mem.nextThinkAt) return;
  const P = paramsFor(me.lv);
  mem.nextThinkAt = s.t + P.think * (0.8 + rnd(rt.botRng) * 0.4);
  if (!me.alive) {
    if (me.ghost) ghostThink(rt, me, P);
    return;
  }
  if (airborne(me)) {
    // 공중: 안전한 쪽으로 몸을 튼다
    const c = safeCenter(s, P.doomMs, me.x, me.z);
    steer(rt, seat, Math.atan2(c.z - me.z, c.x - me.x));
    return;
  }

  // ① 위험: 발밑이 곧 무너지거나, 진행 방향 앞이 낭떠러지
  const hereDoomed = tileDoomed(s, tileIndexAt(geoOf(s), me.x, me.z), P.doomMs);
  const look = 0.35;
  const fx = me.x + me.vx * look;
  const fz = me.z + me.vz * look;
  const aheadIdx = tileIndexAt(geoOf(s), fx, fz);
  const aheadBad = aheadIdx < 0 || tileDoomed(s, aheadIdx, P.doomMs * 0.5);
  const edge = edgeOf(s, me.x, me.z, P.doomMs);
  const outSpeed = me.vx * edge.dx + me.vz * edge.dz;
  if (hereDoomed || aheadBad || edge.dist < P.margin) {
    const c = safeCenter(s, P.doomMs, me.x, me.z);
    const ang = Math.atan2(c.z - me.z, c.x - me.x);
    // 바깥으로 빠르게 밀려나는 중이면 버티기(레벨 3+) — 안 되면 반대로 대시
    const sliding = outSpeed > 3.5 && edge.dist < 2.2;
    const canBrace = me.lv >= 3 && me.stamina > 0.2;
    steer(rt, seat, noisy(rt, ang, P.aim * 0.5), sliding && canBrace);
    if (sliding && !canBrace && me.lv >= 6 && s.t >= me.dashCdAt) press(rt, seat, "dash");
    // 발밑이 꺼지는데 옆이 멀면 점프로 건너기
    if (hereDoomed && edge.dist < 0.6 && me.lv >= 4 && s.t >= me.jumpCdAt) press(rt, seat, "jump");
    return;
  }

  // ② 날아오는 대시 피하기
  for (const o of s.players) {
    if (o === me || !o.alive || !dashing(o, s.t)) continue;
    const dx = me.x - o.x;
    const dz = me.z - o.z;
    const d = Math.hypot(dx, dz);
    if (d > 3.2 || d < 1e-3) continue;
    const toward = (o.vx * dx + o.vz * dz) / d;
    if (toward < DASH_SPEED * 0.5) continue;
    if (rnd(rt.botRng) >= P.dodge) break;
    if (edge.dist < 3 && s.t >= me.jumpCdAt) {
      press(rt, seat, "jump");
      steer(rt, seat, Math.atan2(-edge.dz, -edge.dx));
    } else if (me.stamina > 0.3) {
      steer(rt, seat, Math.atan2(-dz, -dx), true, 0.4);
    } else {
      // 옆으로 비키기
      const side = Math.atan2(dz, dx) + Math.PI / 2;
      steer(rt, seat, side);
    }
    return;
  }

  // 가끔 딴짓 (낮은 레벨)
  if (mem.wander && s.t < mem.wander.until) {
    steer(rt, seat, Math.atan2(mem.wander.z - me.z, mem.wander.x - me.x));
    return;
  }
  if (rnd(rt.botRng) < P.wander) {
    const c = safeCenter(s, P.doomMs, me.x, me.z);
    mem.wander = { x: c.x + (rnd(rt.botRng) * 2 - 1) * 3, z: c.z + (rnd(rt.botRng) * 2 - 1) * 3, until: s.t + 700 };
    if (me.lv <= 2 && rnd(rt.botRng) < 0.3 && s.t >= me.dashCdAt) press(rt, seat, "dash");
    return;
  }

  // ③ 아이템
  let item: { x: number; z: number; d: number } | null = null;
  for (const it of s.items) {
    const d = Math.hypot(it.x - me.x, it.z - me.z);
    if (d > P.greed) continue;
    const e = edgeOf(s, it.x, it.z, P.doomMs);
    if (e.dist < P.margin + 0.3) continue;
    if (!item || d < item.d) item = { x: it.x, z: it.z, d };
  }

  // ④ 공격 대상: 가장자리에 가깝고, 나와 가깝고, 열기가 높은 상대
  let best: { o: PlayerState; score: number; e: { dx: number; dz: number; dist: number } } | null = null;
  for (const o of s.players) {
    if (o === me || !o.alive || airborne(o)) continue;
    const e = edgeOf(s, o.x, o.z, P.doomMs);
    const d = Math.hypot(o.x - me.x, o.z - me.z);
    const score = e.dist * 1.0 + d * 0.35 - o.heat * 0.012 + (o.seat === mem.target ? -0.4 : 0) + (s.t < o.bigUntil ? 1.2 : 0);
    if (!best || score < best.score) best = { o, score, e };
  }
  if (item && (!best || item.d < 2.2 || best.score > 5)) {
    steer(rt, seat, noisy(rt, Math.atan2(item.z - me.z, item.x - me.x), P.aim * 0.5));
    return;
  }
  if (!best) {
    const c = safeCenter(s, P.doomMs, me.x, me.z);
    steer(rt, seat, Math.atan2(c.z - me.z, c.x - me.x), false, 0.6);
    return;
  }
  mem.target = best.o.seat;
  const o = best.o;
  const e = best.e;
  const dx = o.x - me.x;
  const dz = o.z - me.z;
  const d = Math.hypot(dx, dz);
  // 상대 뒤(가장자리 반대편)로 돌아가기
  const back = 1.5;
  let bx = o.x - e.dx * back;
  let bz = o.z - e.dz * back;
  const behindEdge = edgeOf(s, bx, bz, P.doomMs);
  if (behindEdge.dist < P.margin) {
    bx = o.x - e.dx * 0.9;
    bz = o.z - e.dz * 0.9;
  }
  const toT = Math.atan2(dz, dx);
  const edgeAng = Math.atan2(e.dz, e.dx);
  let off = toT - edgeAng;
  while (off > Math.PI) off -= Math.PI * 2;
  while (off < -Math.PI) off += Math.PI * 2;
  const aligned = Math.abs(off) < P.align;
  // 내가 대시하면 지나쳐서 떨어질까? (상대 너머가 가장자리면 너무 가까이선 자제)
  const overshoot = e.dist < 1.2 && edge.dist < 3 && me.lv >= 5;
  if (d < P.reach && aligned && s.t >= me.dashCdAt && !overshoot) {
    // 상대가 움직이는 걸 조금 앞서 본다
    const lead = me.lv >= 6 ? 0.12 : 0;
    const ax = o.x + o.vx * lead - me.x;
    const az = o.z + o.vz * lead - me.z;
    steer(rt, seat, noisy(rt, Math.atan2(az, ax), P.aim));
    press(rt, seat, "dash");
    return;
  }
  // 상대가 버티는 중이면 점프 충격파로 (레벨 7+)
  if (o.bracing && d < 1.8 && me.lv >= 7 && s.t >= me.jumpCdAt) {
    press(rt, seat, "jump");
    steer(rt, seat, toT, false, 0.5);
    return;
  }
  const goAng = Math.atan2(bz - me.z, bx - me.x);
  const far = Math.hypot(bx - me.x, bz - me.z);
  steer(rt, seat, noisy(rt, goAng, P.aim * 0.6), false, far < 0.6 ? 0.3 : 1);
}

function ghostThink(rt: HostRuntime, me: PlayerState, P: BotParams) {
  const s = rt.state;
  const g = me.ghost!;
  // 1등(점수) 중 살아 있는 상대를 노린다 — 앞서가는 사람 견제
  let tgt: PlayerState | null = null;
  for (const o of s.players) {
    if (!o.alive || o === me) continue;
    if (!tgt || o.score > tgt.score || (o.score === tgt.score && o.heat > tgt.heat)) tgt = o;
  }
  if (!tgt) {
    setInput(rt, me.seat, { mx: 0, mz: 0, brace: false, dash: rt.inputs[me.seat].dash, jump: 0 });
    return;
  }
  const e = edgeOf(s, tgt.x, tgt.z, 0);
  const bx = tgt.x - e.dx * 1.0;
  const bz = tgt.z - e.dz * 1.0;
  const dx = bx - g.x;
  const dz = bz - g.z;
  const d = Math.hypot(dx, dz);
  if (d > 0.4) setInput(rt, me.seat, { mx: dx / d, mz: dz / d, brace: false, dash: rt.inputs[me.seat].dash, jump: 0 });
  else setInput(rt, me.seat, { mx: e.dx * 0.25, mz: e.dz * 0.25, brace: false, dash: rt.inputs[me.seat].dash, jump: 0 });
  const toT = Math.hypot(tgt.x - g.x, tgt.z - g.z);
  if (toT < 1.6 && s.t >= g.cdAt) {
    // 입김은 유령이 바라보는 쪽으로 — 사람처럼 가장자리 쪽으로 몸을 돌린 뒤 누른다
    const want = Math.atan2(e.dz, e.dx);
    setInput(rt, me.seat, { mx: Math.cos(want) * 0.3, mz: Math.sin(want) * 0.3, brace: false, dash: rt.inputs[me.seat].dash, jump: 0 });
    let off = g.face - want;
    while (off > Math.PI) off -= Math.PI * 2;
    while (off < -Math.PI) off += Math.PI * 2;
    if (Math.abs(off) < 0.35 + P.aim && rnd(rt.botRng) < P.gust) press(rt, me.seat, "dash");
  }
}
