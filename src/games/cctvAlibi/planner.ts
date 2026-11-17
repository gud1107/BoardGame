import { MAX_WINDOW, ROOM_COUNT, TICKS, VAULT, canStep, dist, guestDist, neighbors } from "./data";

/**
 * 동선(계획) 도우미 — 엔진·봇·화면이 함께 쓴다. 입출력 없는 순수 함수만.
 *
 * - route: 시각 1..TICKS의 방 (길이 TICKS). 출발 방(시각 0)은 따로.
 * - full : [출발 방, ...route] (길이 TICKS + 1)
 * - forge: 범인만. `from` 시각부터 `rooms.length`개 시각의 영상을 `rooms`로 바꿔치기.
 */

export interface Forge {
  from: number;
  rooms: number[];
}

export interface Plan {
  route: number[];
  forge: Forge | null;
}

export function fullRoute(start: number, route: number[]): number[] {
  return [start, ...route];
}

/** 한 걸음씩 이어지는 올바른 동선인가 */
export function validRoute(start: number, route: unknown, allowVault: boolean): route is number[] {
  if (!Array.isArray(route) || route.length !== TICKS) return false;
  let prev = start;
  for (const r of route) {
    if (typeof r !== "number" || !Number.isInteger(r) || r < 0 || r > VAULT) return false;
    if (r === VAULT && !allowVault) return false;
    if (!canStep(prev, r)) return false;
    prev = r;
  }
  return true;
}

/** 금고실에 있던 시각들 (full 기준 번호) */
export function vaultTicks(full: number[]): number[] {
  const out: number[] = [];
  for (let t = 1; t < full.length; t++) if (full[t] === VAULT) out.push(t);
  return out;
}

/** 조작을 입힌 영상 동선 (full 길이) */
export function footageOf(full: number[], forge: Forge | null): number[] {
  if (!forge) return [...full];
  const out = [...full];
  forge.rooms.forEach((r, i) => {
    out[forge.from + i] = r;
  });
  return out;
}

/** 이 조작이 규칙에 맞나: 연속 1~3시각, 금고실 시각을 모두 덮고, 영상이 금고실 없는 올바른 동선 */
export function validForge(full: number[], forge: unknown): forge is Forge {
  if (!forge || typeof forge !== "object") return false;
  const f = forge as Forge;
  if (!Number.isInteger(f.from) || !Array.isArray(f.rooms)) return false;
  const len = f.rooms.length;
  if (len < 1 || len > MAX_WINDOW || f.from < 1 || f.from + len - 1 > TICKS) return false;
  if (f.rooms.some((r) => typeof r !== "number" || !Number.isInteger(r) || r < 0 || r >= ROOM_COUNT)) return false;
  const footage = footageOf(full, f);
  for (let t = 1; t < footage.length; t++) {
    if (footage[t] === VAULT) return false;
    if (!canStep(footage[t - 1], footage[t])) return false;
  }
  return true;
}

/**
 * 이 실제 동선에 입힐 수 있는 모든 조작. 영상이 같은 것은 하나로 합친다(짧은 구간 우선).
 * 금고실에 안 갔거나 금고실 시각이 3시각 안에 안 들어오면 [].
 */
export function forgeOptions(full: number[]): Forge[] {
  const vt = vaultTicks(full);
  if (vt.length === 0) return [];
  const lo = vt[0];
  const hi = vt[vt.length - 1];
  if (hi - lo + 1 > MAX_WINDOW) return [];
  const seen = new Set<string>();
  const out: Forge[] = [];
  for (let len = hi - lo + 1; len <= MAX_WINDOW; len++) {
    for (let from = Math.max(1, hi - len + 1); from <= lo && from + len - 1 <= TICKS; from++) {
      const to = from + len - 1;
      const rooms: number[] = [];
      const walk = (t: number, prev: number) => {
        if (t > to) {
          if (to < TICKS && !canStep(prev, full[to + 1])) return;
          // 구간 양 끝은 실제와 달라야 한다 (같으면 더 짧은 구간과 같은 조작)
          if (rooms[0] === full[from] || rooms[len - 1] === full[to]) return;
          const key = footageOf(full, { from, rooms }).join(",");
          if (seen.has(key)) return;
          seen.add(key);
          out.push({ from, rooms: [...rooms] });
          return;
        }
        for (const r of [prev, ...neighbors(prev)]) {
          if (r === VAULT) continue;
          rooms.push(r);
          walk(t + 1, r);
          rooms.pop();
        }
      };
      walk(from, full[from - 1]);
    }
  }
  return out;
}

/** 범인의 실제 동선으로 쓸 수 있나 (금고실에 들르고, 조작할 방법이 하나라도 있다) */
export function validCulpritRoute(start: number, route: unknown): route is number[] {
  return validRoute(start, route, true) && forgeOptions(fullRoute(start, route)).length > 0;
}

/** 손님 동선으로 쓸 수 있나 (금고실 금지, 할 일 방을 모두 들른다 — 출발 방은 이미 들른 셈) */
export function validGuestRoute(start: number, route: unknown, errands: number[]): route is number[] {
  if (!validRoute(start, route, false)) return false;
  const seen = new Set([start, ...route]);
  return errands.every((e) => seen.has(e));
}

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** target까지 남은 걸음 안에 닿을 수 있는 다음 방들 (금고실은 target일 때만) */
function stepsToward(from: number, target: number, stepsLeft: number): number[] {
  const d = target === VAULT ? dist : guestDist;
  return [from, ...neighbors(from)].filter((r) => (r !== VAULT || target === VAULT) && d(r, target) <= stepsLeft - 1);
}

/**
 * 손님의 자동 동선: 할 일을 가까운 순서로 들르고, 남는 시간은 머무르거나 어슬렁거린다.
 * 사람이 시간 안에 못 정했을 때와 봇이 쓴다.
 */
export function guestAutoRoute(start: number, errands: number[], rng: () => number): number[] {
  const todo = errands.filter((e) => e !== start);
  // 들르는 순서: 전체 걸음이 짧은 쪽 (둘이 같으면 무작위)
  const orders = todo.length === 2 ? [todo, [todo[1], todo[0]]] : [todo];
  const cost = (o: number[]) => o.reduce((acc, r, i) => acc + guestDist(i === 0 ? start : o[i - 1], r), 0);
  orders.sort((a, b) => cost(a) - cost(b) || rng() - 0.5);
  const order = orders[0];
  const route: number[] = [];
  let cur = start;
  let idx = 0;
  for (let t = 1; t <= TICKS; t++) {
    const left = TICKS - t + 1;
    const rest = order.slice(idx);
    const need = rest.reduce((acc, r, i) => acc + guestDist(i === 0 ? cur : rest[i - 1], r), 0);
    let next: number;
    if (rest.length === 0) {
      // 할 일 끝: 절반은 머무르고 절반은 옆방으로
      next = rng() < 0.5 ? cur : pick(neighbors(cur).filter((r) => r !== VAULT), rng);
    } else if (need >= left) {
      next = pick(stepsToward(cur, rest[0], guestDist(cur, rest[0])).filter((r) => r !== cur), rng) ?? cur;
    } else {
      // 여유가 있으면 가끔 딴짓
      const slack = left - need;
      const roll = rng();
      if (roll < 0.25 && slack >= 1) next = cur;
      else if (roll < 0.4 && slack >= 2) next = pick(neighbors(cur).filter((r) => r !== VAULT), rng);
      else next = pick(stepsToward(cur, rest[0], guestDist(cur, rest[0])).filter((r) => r !== cur), rng) ?? cur;
    }
    route.push(next);
    cur = next;
    while (idx < order.length && order[idx] === cur) idx++;
  }
  // 안전망: 무작위 딴짓으로 할 일을 놓쳤으면 가장 짧은 길로 다시 만든다
  if (!validGuestRoute(start, route, errands)) return shortestGuestRoute(start, order);
  return route;
}

function shortestGuestRoute(start: number, order: number[]): number[] {
  const route: number[] = [];
  let cur = start;
  let idx = 0;
  while (idx < order.length && order[idx] === cur) idx++;
  for (let t = 1; t <= TICKS; t++) {
    if (idx < order.length) {
      const target = order[idx];
      cur = stepsToward(cur, target, guestDist(cur, target)).find((r) => r !== cur) ?? cur;
      while (idx < order.length && order[idx] === cur) idx++;
    }
    route.push(cur);
  }
  return route;
}

/** 조작 구간 길이별 선호 (짧을수록 들킬 칸이 적다) */
const LEN_WEIGHT = [0, 0.5, 0.3, 0.2];

/**
 * 범인의 자동 계획: 금고실에 닿는 시각을 고르고 그 전후는 손님처럼 돌아다닌 뒤, 조작 하나를 고른다.
 * `sharp`(0~1)이 높을수록 조작 구간 길이를 섞어 쓴다 (낮으면 아무거나).
 */
export function culpritAutoPlan(start: number, rng: () => number, sharp = 0.5): Plan {
  for (let attempt = 0; attempt < 40; attempt++) {
    const minArrive = Math.max(1, dist(start, VAULT));
    const arrive = minArrive + Math.floor(rng() * (TICKS - minArrive + 1));
    const stay = rng() < 0.75 ? 1 : rng() < 0.7 ? 2 : 3;
    const route: number[] = [];
    let cur = start;
    for (let t = 1; t <= TICKS; t++) {
      let next: number;
      if (t < arrive) {
        const opts = stepsToward(cur, VAULT, arrive - t + 1).filter((r) => r !== VAULT);
        next = opts.length ? pick(opts, rng) : cur;
      } else if (t < arrive + stay) {
        next = VAULT;
      } else {
        const opts = [cur, ...neighbors(cur)].filter((r) => r !== VAULT);
        next = cur === VAULT ? pick(neighbors(VAULT), rng) : rng() < 0.4 ? cur : pick(opts, rng);
      }
      route.push(next);
      cur = next;
    }
    if (!validRoute(start, route, true)) continue;
    const options = forgeOptions(fullRoute(start, route));
    if (options.length === 0) continue;
    let forge: Forge;
    if (rng() < sharp) {
      const total = options.reduce((acc, o) => acc + LEN_WEIGHT[o.rooms.length], 0);
      let roll = rng() * total;
      forge = options[options.length - 1];
      for (const o of options) {
        roll -= LEN_WEIGHT[o.rooms.length];
        if (roll <= 0) {
          forge = o;
          break;
        }
      }
    } else {
      forge = pick(options, rng);
    }
    return { route, forge };
  }
  // 안전망: 곧장 금고실로 가서 머문다 → 마지막 3시각만 금고실에 있도록
  return fallbackCulpritPlan(start);
}

function fallbackCulpritPlan(start: number): Plan {
  const route: number[] = [];
  let cur = start;
  // 금고실 바로 옆방까지 가서 기다렸다가 마지막 시각에 들어간다
  for (let t = 1; t <= TICKS; t++) {
    if (t === TICKS) cur = VAULT;
    else if (dist(cur, VAULT) > 1) cur = stepsToward(cur, VAULT, dist(cur, VAULT)).find((r) => r !== cur && r !== VAULT) ?? cur;
    route.push(cur);
  }
  const full = fullRoute(start, route);
  const forge = forgeOptions(full)[0] ?? { from: TICKS, rooms: [full[TICKS - 1]] };
  return { route, forge };
}
