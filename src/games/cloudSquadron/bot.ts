import { ENEMIES, H, PILOTS, REVIVE_R, W, type PilotId } from "./data";
import { canSkill, canUlt, castSkill, castUlt, choosePilot, flying, rnd, type Bullet, type HostRuntime, type MatchState, type PlayerState } from "./sim";

/**
 * 구름 편대 AI 조종사 (룰북 §9). 레벨 1~10.
 *
 * 적탄이 전부 직선 등속이라 봇은 앞날을 정확히 계산할 수 있다 — 그대로 두면 사람보다 잘 피하므로
 * 레벨로 ① 생각 간격(반응 지연) ② 내다보는 시간 ③ 안전 여유 ④ 못 보고 넘기는 탄 비율 ⑤ 엉뚱한
 * 선택 확률을 나눈다. 움직일 방향 후보(16방향 × 일반/정밀 + 제자리)마다 "앞으로 맞을 위험 +
 * 가고 싶은 곳까지 거리"를 매겨 가장 낮은 것을 고른다.
 */

const DIRS: { x: number; y: number }[] = [{ x: 0, y: 0 }, ...Array.from({ length: 16 }, (_, i) => ({ x: Math.cos((i / 16) * Math.PI * 2), y: Math.sin((i / 16) * Math.PI * 2) }))];

/** 조종사 고르기 선호 (역할이 겹치지 않게 앞에서부터) */
const PICK_PREF: PilotId[][] = [
  ["iron", "bolt", "wind", "firefly", "flame", "shadow"],
  ["firefly", "wind", "flame", "bolt", "shadow", "iron"],
  ["bolt", "flame", "shadow", "iron", "wind", "firefly"],
  ["shadow", "flame", "wind", "firefly", "iron", "bolt"],
];

export function botThink(rt: HostRuntime, seat: number) {
  const s = rt.state;
  const p = s.players[seat];
  const m = rt.bots[seat];
  if (s.phase === "pick") {
    if (p.pilot) {
      p.ready = true;
      return;
    }
    if (m.pickAt === 0) m.pickAt = s.t + 900 + rnd(rt.botRng) * 2600 + seat * 300;
    if (s.t < m.pickAt) return;
    const pref = PICK_PREF[(seat + Math.floor(rnd(rt.botRng) * 4)) % 4];
    const free = pref.filter((id) => !s.players.some((q) => q.pilot === id));
    if (free.length) choosePilot(s, seat, free[0]);
    p.ready = true;
    return;
  }
  if (s.t < m.nextThinkAt) return;
  const L = Math.max(1, Math.min(10, p.level));
  m.nextThinkAt = s.t + (330 - L * 28) * (0.8 + 0.4 * rnd(rt.botRng));
  if (!flying(p)) {
    m.mx = 0;
    m.my = 0;
    return;
  }
  const pilot = PILOTS[p.pilot!];
  const horizon = 0.12 + L * 0.042;
  const margin = 1 + L * 0.8;
  const blind = (10 - L) * 0.075;

  // 가까운 탄만 (미리 거르기) + 레벨 낮으면 일부 못 봄
  const near: Bullet[] = [];
  const reach = pilot.speed * horizon + 90;
  for (const b of s.bullets) {
    if (Math.abs(b.x - p.x) > reach || Math.abs(b.y - p.y) > reach) continue;
    if (blind > 0 && ((b.id * 2654435761) >>> 0) % 1000 < blind * 1000) continue;
    near.push(b);
  }
  const goal = goalOf(s, p);
  const speedK = s.t < s.slowUntil ? 0.35 : 1;

  let best = 0;
  let bestFocus = false;
  let bestCost = Infinity;
  let stayDanger = 0;
  const tries: boolean[] = L >= 4 ? [false, true] : [false];
  for (const focus of tries) {
    const sp = focus ? pilot.focusSpeed : pilot.speed;
    for (let i = 0; i < DIRS.length; i++) {
      if (focus && i === 0) continue;
      const d = DIRS[i];
      let danger = 0;
      for (const tt of [horizon * 0.33, horizon * 0.66, horizon]) {
        const px = clamp(p.x + d.x * sp * tt, 12, W - 12);
        const py = clamp(p.y + d.y * sp * tt, 30, H - 16);
        for (const b of near) {
          const bx = b.x + b.vx * tt * speedK;
          const by = b.y + b.vy * tt * speedK;
          const r = pilot.hitR + b.r + margin;
          const dd = (bx - px) ** 2 + (by - py) ** 2;
          if (dd < r * r) danger += (1 - Math.sqrt(dd) / r) * (tt < horizon * 0.5 ? 3 : 1.5);
        }
        for (const l of s.lanes) if (Math.abs(px - l.x) < l.w / 2 + pilot.hitR + 6 && s.t + tt * 1000 > l.fireAt - 250) danger += 6;
      }
      const ex = clamp(p.x + d.x * sp * horizon, 12, W - 12);
      const ey = clamp(p.y + d.y * sp * horizon, 30, H - 16);
      const dist = Math.hypot(goal.x - ex, goal.y - ey);
      // 벽에 붙으면 갇히기 쉬움
      const wall = (ex < 26 || ex > W - 26 ? 0.5 : 0) + (ey > H - 30 ? 0.4 : 0);
      const cost = danger * 40 + dist * 0.06 + wall + (focus ? 0.4 : 0);
      if (i === 0) stayDanger = danger;
      if (cost < bestCost) {
        bestCost = cost;
        best = i;
        bestFocus = focus;
      }
    }
  }
  // 낮은 레벨: 가끔 엉뚱한 선택
  if (rnd(rt.botRng) < (10 - L) * 0.025) {
    best = Math.floor(rnd(rt.botRng) * DIRS.length);
    bestFocus = false;
  }
  m.mx = DIRS[best].x;
  m.my = DIRS[best].y;
  m.focus = bestFocus;
  // 목표 가까우면 덜 흔들리게
  if (best !== 0 && Math.hypot(goal.x - p.x, goal.y - p.y) < 10 && stayDanger === 0) {
    m.mx = 0;
    m.my = 0;
  }

  // 스킬·궁극기 (레벨이 낮으면 자주 깜빡함)
  const smart = rnd(rt.botRng) < 0.25 + L * 0.075;
  if (!smart) return;
  const dense = near.filter((b) => (b.x - p.x) ** 2 + (b.y - p.y) ** 2 < 95 * 95).length;
  const danger = stayDanger;
  const boss = s.enemies.find((e) => ENEMIES[e.kind].boss || ENEMIES[e.kind].mid);
  if (canUlt(p, s)) {
    const downAlly = s.players.some((q) => q.st === "down");
    const want =
      (pilot.id === "firefly" && (downAlly || s.players.some((q) => flying(q) && q.hp === 1))) ||
      (pilot.id !== "firefly" && (danger > 1.2 || dense > 14 || (!!boss && rnd(rt.botRng) < 0.25) || s.bullets.length > 150));
    if (want) {
      castUlt(rt, seat);
      return;
    }
  }
  if (!canSkill(p, s)) return;
  switch (pilot.id) {
    case "wind":
      if (danger > 0.9) castSkill(rt, seat, DIRS[best].x || 0, DIRS[best].y || -1);
      break;
    case "iron": {
      const above = near.filter((b) => b.y < p.y && b.y > p.y - 140 && Math.abs(b.x - p.x) < 60).length;
      if (above >= 5 || (boss && above >= 2)) castSkill(rt, seat);
      break;
    }
    case "firefly":
      if (s.players.some((q) => flying(q) && q.hp < PILOTS[q.pilot!].maxHp) || boss) castSkill(rt, seat);
      break;
    case "bolt": {
      const target = s.enemies.find((e) => e.y < p.y - 40 && e.y > 0 && Math.abs(e.x - p.x) < 26 && e.hp > 60);
      if (target && danger < 0.4) castSkill(rt, seat);
      break;
    }
    case "shadow":
      if (danger > 0.7 || dense > 8) castSkill(rt, seat);
      break;
    case "flame":
      if (dense >= 7 || danger > 0.8) castSkill(rt, seat);
      break;
  }
}

/** 가고 싶은 곳: 쓰러진 동료 > 가까운 아이템 > 조준 위치 */
function goalOf(s: MatchState, p: PlayerState): { x: number; y: number } {
  const pilot = PILOTS[p.pilot!];
  const down = s.players.filter((q) => q.st === "down").sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
  if (down && p.level >= 3) return { x: down.x, y: Math.min(H - 30, down.y + REVIVE_R * 0.4) };
  const item = s.items.filter((it) => Math.hypot(it.x - p.x, it.y - p.y) < 170 && it.y > 120).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
  if (item && (item.kind !== "heal" || p.hp < pilot.maxHp)) return { x: item.x, y: Math.max(item.y + 10, H * 0.45) };
  // 목표 적: 보스 > 체력 많은 적 > 가까운 적
  let target = s.enemies.find((e) => (ENEMIES[e.kind].boss || ENEMIES[e.kind].mid) && e.y > 0) ?? null;
  if (!target) {
    let bd = Infinity;
    for (const e of s.enemies) {
      if (e.y < 0 || e.y > p.y - 30) continue;
      const d = Math.abs(e.x - p.x) - e.hp * 0.3;
      if (d < bd) {
        bd = d;
        target = e;
      }
    }
  }
  const tx = target ? target.x + (p.seat - (s.seatCount - 1) / 2) * 16 : (W * (p.seat + 1)) / (s.seatCount + 1);
  let ty = H - 110;
  if (pilot.id === "flame" && target) ty = Math.min(H - 80, Math.max(target.y + 150, H * 0.42));
  else if (pilot.id === "shadow") ty = H - 80;
  else if (pilot.id === "iron") ty = H - 140;
  return { x: clamp(tx, 20, W - 20), y: ty };
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

