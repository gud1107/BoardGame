import { BASE_R, CROWN_R, LANE_MAX, LANE_MIN, PILLAR_R, SWAY_AMP, SWAY_MS, TOWER_H, type PlatformKind } from "./data";

/**
 * 탑 모양 — 라운드마다 `towerSeed`로 다시 만든다(방장·손님이 같은 씨앗으로 같은 탑을 짓는다).
 *
 * 가운데 기둥(반지름 1.7m) 둘레를 나선으로 도는 **본길** 발판이 바닥부터 꼭대기 왕관까지 이어지고,
 * 본길 옆에 **샛길** 발판이 붙어 추월·우회 길을 만든다. 본길은 이웃 발판까지 늘 보통 점프로 닿게
 * (중심 거리 2.3~3.1m, 높이 차 0.55~0.95m) 만들어 운 나쁜 탑이 나오지 않는다.
 *
 * 좌표: x·z 평면(기둥 축 = 원점), y 위. 발판 높이 `y`는 윗면.
 */

export interface Platform {
  i: number;
  kind: PlatformKind;
  /** 윗면 높이 */
  y: number;
  /** 원판 반지름 (base는 바깥 반지름) */
  r: number;
  /** 기둥 축에서 중심까지 거리 */
  rad: number;
  /** 기둥 축 둘레 각 (x = cos, z = sin) */
  ang: number;
  /** 본길 몇 번째 (샛길·바닥은 가까운 본길 번호, 바닥 0) */
  chain: number;
  main: boolean;
  /** 움직이는 발판 흔들림 위상 */
  phase: number;
}

export interface Tower {
  seed: number;
  platforms: Platform[];
  /** 본길 순서대로 발판 번호 (0 = 바닥, 마지막 = 왕관) */
  mainPath: number[];
  crown: number;
  top: number;
  /** 갈 수 있는 이웃 (점프 한 번) */
  next: number[][];
  /** 왕관까지 남은 점프 수 (못 가면 큰 수) */
  hops: number[];
}

function mulberry(seed: number) {
  let s = seed | 0;
  return () => {
    let t = (s = (s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

const cache = new Map<number, Tower>();

export function buildTower(seed: number): Tower {
  const hit = cache.get(seed);
  if (hit) return hit;
  const rnd = mulberry(seed ^ 0x51ed270b);
  const ps: Platform[] = [];
  ps.push({ i: 0, kind: "base", y: 0, r: BASE_R, rad: 0, ang: 0, chain: 0, main: true, phase: 0 });
  const mainPath = [0];
  let ang = rnd() * Math.PI * 2;
  let rad = 4.4;
  let y = 0;
  const dir = rnd() < 0.5 ? 1 : -1;
  let lastKind: PlatformKind = "stone";
  let k = 0;
  while (y < TOWER_H - 1.2) {
    k++;
    const dy = k === 1 ? 0.7 : 0.55 + rnd() * 0.4;
    const newRad = clamp(rad + (rnd() - 0.5) * 1.7, LANE_MIN, LANE_MAX);
    const d = 2.3 + rnd() * 0.8;
    const r = 0.95 + rnd() * 0.3;
    const c = clamp((rad * rad + newRad * newRad - d * d) / (2 * rad * newRad), -1, 1);
    ang += dir * Math.acos(c);
    rad = newRad;
    y += dy;
    let kind: PlatformKind = "stone";
    const roll = rnd();
    if (k > 4 && lastKind === "stone") {
      if (roll < 0.17) kind = "crumbly";
      else if (roll < 0.29) kind = "moving";
    }
    lastKind = kind;
    ps.push({ i: ps.length, kind, y, r: kind === "moving" ? r * 1.05 : r, rad, ang, chain: k, main: true, phase: rnd() * Math.PI * 2 });
    mainPath.push(ps.length - 1);
  }
  // 왕관: 한 칸 더 위
  {
    const newRad = 4.3;
    const d = 2.7;
    const c = clamp((rad * rad + newRad * newRad - d * d) / (2 * rad * newRad), -1, 1);
    ang += dir * Math.acos(c);
    y += 0.8;
    k++;
    ps.push({ i: ps.length, kind: "crown", y, r: CROWN_R, rad: newRad, ang, chain: k, main: true, phase: 0 });
    mainPath.push(ps.length - 1);
  }
  const crown = ps.length - 1;
  // 샛길: 본길 옆 다른 줄(안쪽/바깥쪽)에 붙는다
  const mains = ps.slice(1, crown);
  for (const m of mains) {
    // 아래쪽은 출발 혼잡을 풀려고 샛길을 더 자주 둔다
    if (rnd() > (m.chain <= 4 ? 0.95 : 0.66)) continue;
    for (let tryN = 0; tryN < 8; tryN++) {
      // 반대쪽 줄(안쪽↔바깥쪽)을 먼저, 안 되면 같은 줄에서 각도를 더 벌려 본다
      const other = m.rad >= 4.4 ? m.rad - 1.95 : m.rad + 1.95;
      const sideRad = clamp((tryN % 2 === 0 ? other : m.rad + (m.rad >= 4.4 ? -1 : 1) * 1.2) + (rnd() - 0.5) * 0.5, LANE_MIN, LANE_MAX);
      const sAng = m.ang + dir * (rnd() - 0.35) * (0.7 + tryN * 0.12);
      const sy = m.y + (rnd() - 0.5) * 0.5;
      const sr = 0.85 + rnd() * 0.25;
      const sx = Math.cos(sAng) * sideRad;
      const sz = Math.sin(sAng) * sideRad;
      const clash = ps.some((o) => o.kind !== "base" && Math.abs(o.y - sy) < 0.8 && Math.hypot(Math.cos(o.ang) * o.rad - sx, Math.sin(o.ang) * o.rad - sz) < o.r + sr + 0.3);
      if (clash) continue;
      // 이웃 본길 발판에서 점프로 닿아야 쓸모가 있다
      const near = mains.some((o) => Math.abs(o.chain - m.chain) <= 1 && Math.hypot(Math.cos(o.ang) * o.rad - sx, Math.sin(o.ang) * o.rad - sz) - o.r - sr < 1.8);
      if (!near) continue;
      const roll = rnd();
      const kind: PlatformKind = m.chain <= 2 ? "stone" : roll < 0.24 ? "crumbly" : roll < 0.42 ? "bouncy" : "stone";
      ps.push({ i: ps.length, kind, y: sy, r: sr, rad: sideRad, ang: sAng, chain: m.chain, main: false, phase: rnd() * Math.PI * 2 });
      break;
    }
  }
  const tower: Tower = { seed, platforms: ps, mainPath, crown, top: ps[crown].y, next: [], hops: [] };
  buildGraph(tower);
  cache.set(seed, tower);
  if (cache.size > 24) cache.delete(cache.keys().next().value as number);
  return tower;
}

/* ── 위치 ───────────────────────────────────────────────────────────── */

/** 발판 중심 기둥 축 각 (움직이는 발판은 시간에 따라) */
export function platAngle(p: Platform, t: number): number {
  if (p.kind !== "moving") return p.ang;
  return p.ang + SWAY_AMP * Math.sin((t / SWAY_MS) * Math.PI * 2 + p.phase);
}

export function platPos(p: Platform, t: number): { x: number; z: number } {
  if (p.kind === "base") return { x: 0, z: 0 };
  const a = platAngle(p, t);
  return { x: Math.cos(a) * p.rad, z: Math.sin(a) * p.rad };
}

/** (x,z)가 발판 위인가. margin = 몸이 걸쳐도 되는 여유 */
export function onPlatform(p: Platform, x: number, z: number, t: number, margin: number): boolean {
  if (p.kind === "base") {
    const d = Math.hypot(x, z);
    return d <= BASE_R + margin && d >= PILLAR_R - margin;
  }
  const c = platPos(p, t);
  return Math.hypot(x - c.x, z - c.z) <= p.r + margin;
}

/** 발판 가장자리까지 남은 거리 (안쪽이면 +) */
export function edgeRoom(p: Platform, x: number, z: number, t: number): number {
  if (p.kind === "base") {
    const d = Math.hypot(x, z);
    return Math.min(BASE_R - d, d - PILLAR_R);
  }
  const c = platPos(p, t);
  return p.r - Math.hypot(x - c.x, z - c.z);
}

/* ── 이웃·거리 ─────────────────────────────────────────────────────── */

/** 두 발판 가장자리 사이 수평 틈 (움직이는 발판은 흔들림 절반만큼 더 멀다고 본다) */
export function gapBetween(a: Platform, b: Platform): number {
  if (a.kind === "base" || b.kind === "base") {
    const o = a.kind === "base" ? b : a;
    return Math.max(0, o.rad - o.r - BASE_R);
  }
  const ax = Math.cos(a.ang) * a.rad;
  const az = Math.sin(a.ang) * a.rad;
  const bx = Math.cos(b.ang) * b.rad;
  const bz = Math.sin(b.ang) * b.rad;
  const sway = (a.kind === "moving" ? SWAY_AMP * a.rad * 0.5 : 0) + (b.kind === "moving" ? SWAY_AMP * b.rad * 0.5 : 0);
  return Math.max(0, Math.hypot(ax - bx, az - bz) - a.r - b.r + sway);
}

/** 점프 한 번으로 a → b에 닿나 (보통 점프 기준 · 넉넉히) */
export function reachable(a: Platform, b: Platform): boolean {
  if (a === b || b.kind === "base") return false;
  const dy = b.y - a.y;
  if (a.kind === "bouncy") {
    if (dy > 2.6) return false;
  } else if (dy > 1.3) return false;
  if (dy < -6) return false;
  const gap = gapBetween(a, b);
  const allow = dy > 0 ? 2.5 - dy * (a.kind === "bouncy" ? 0.25 : 0.6) : 3.0;
  return gap <= allow;
}

function buildGraph(t: Tower) {
  const n = t.platforms.length;
  t.next = Array.from({ length: n }, () => []);
  for (const a of t.platforms) for (const b of t.platforms) if (reachable(a, b)) t.next[a.i].push(b.i);
  // 왕관까지 점프 수 (거꾸로 BFS)
  const prev: number[][] = Array.from({ length: n }, () => []);
  for (let a = 0; a < n; a++) for (const b of t.next[a]) prev[b].push(a);
  t.hops = Array(n).fill(999);
  t.hops[t.crown] = 0;
  const q = [t.crown];
  while (q.length) {
    const b = q.shift()!;
    for (const a of prev[b]) {
      if (t.hops[a] <= t.hops[b] + 1) continue;
      t.hops[a] = t.hops[b] + 1;
      q.push(a);
    }
  }
}

/** 높이 → 0~1 진행도 (화면 표시) */
export function progressOf(t: Tower, y: number): number {
  return clamp(y / t.top, 0, 1);
}
