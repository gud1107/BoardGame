import type { BotLevel } from "@/games/shared/bot/botDifficulty";
import {
  MAX_ACTIVE_PINGS,
  MOVE_MAX,
  T_RAVINE,
  T_TREE,
  T_UNKNOWN,
  dirBetween,
  lanternView,
  monsterCell,
  monsterNextCell,
  neighbors4,
  plannedCells,
  uncheckedColors,
  type EngineAction,
  type GameState,
  type Seat,
} from "./engine";
import { WORD_STOP, type Dir, type PingMark } from "./show";

/**
 * 등불 지기 AI. 언제나 자기 좌석의 보기(`lanternView`)만 보고 판단한다 — 남의 색 함정·다리를
 * 몰래 알지 않는다. 사람과 똑같이 핑·한마디·공개된 계획으로만 정보를 주고받는다.
 *
 * 한 차례에 하는 일 (우선순위 순)
 * 1. 경고: 동료의 공개 계획이 내 색 함정·괴물에 닿으면 ⚠️/👹 핑 + "멈춰!"
 * 2. 미리 알림: 동료 근처의 내 색 함정·괴물·다리를 핑 (핑 칸이 남아 있을 때)
 * 3. 계획: 남은 빛 조각 → (다 모았으면) 새벽 제단. 모르는 곳은 탐험 경계로. 핑된 위험은 피한다.
 * 레벨: 낮으면 엉뚱한 곳을 탐험하거나 걸음을 덜 쓰고 모르는 골짜기에 몸을 던지기도 한다.
 * 높으면 내 색 괴물을 퇴치하고, 반딧불 병을 줍고, 🔆을 아껴 쓴다.
 */

const INF = 1e9;

interface Know {
  v: GameState;
  seat: Seat;
  n: number;
  /** 아직 다른 색이 확인 안 한 칸에 붙는 위험 가중치 (높은 레벨일수록 조심) */
  caution: number;
  /** 걸어서 지나갈 수 없는 칸 */
  block: Set<number>;
  /** risky 경로로도 절대 못 가는 칸 (다리 없다고 밝혀진 골짜기) */
  hardBlock: Set<number>;
  /** 보이는 괴물이 지금 있는 칸 — risky면 일부러 물려서(괴물이 2라운드 잠듦) 길을 연다 */
  monsterAt: Set<number>;
  /** 라운드를 마치면 안 되는 칸 (괴물이 올 칸) */
  noEnd: Set<number>;
  bridgeOk: Set<number>;
}

function pingAt(v: GameState, cell: number, marks: PingMark[], notBy?: Seat): boolean {
  return v.pings.some((p) => p.cell === cell && marks.includes(p.mark) && p.seat !== notBy);
}

function know(v: GameState, seat: Seat, caution = 0): Know {
  const n = v.w * v.h;
  const block = new Set<number>();
  const hardBlock = new Set<number>();
  const monsterAt = new Set<number>();
  const noEnd = new Set<number>();
  const bridgeOk = new Set<number>(v.bridges.map((b) => b.cell));
  const harmless = new Set(v.traps.filter((t) => t.state !== "armed").map((t) => t.cell));
  for (const p of v.pings) {
    if (p.seat === seat) continue;
    if ((p.mark === "bridge" || p.mark === "safe") && v.tiles[p.cell] === T_RAVINE) bridgeOk.add(p.cell);
  }
  for (const c of v.noBridge) {
    block.add(c);
    hardBlock.add(c);
  }
  for (const p of v.pings) {
    if (p.seat === seat) continue;
    if (p.mark === "danger" && !harmless.has(p.cell) && !bridgeOk.has(p.cell)) block.add(p.cell);
    if (p.mark === "monster") {
      const fresh = p.round >= v.round - 1;
      if (fresh) {
        block.add(p.cell);
        noEnd.add(p.cell);
        for (const nb of neighbors4(v.w, v.h, p.cell)) noEnd.add(nb);
      }
    }
  }
  for (const m of v.monsters) {
    if (m.gone || m.idx < 0) continue;
    if (m.sated > 0) continue;
    block.add(monsterCell(m));
    monsterAt.add(monsterCell(m));
    // 내 색 괴물 옆에서 멈추면 괴물이 움직이기 전에 녹아 사라지므로, 주인에겐 "괴물이 올 칸"이 위험하지 않다
    if (m.color === seat) continue;
    const nx = monsterNextCell(m);
    if (nx >= 0) noEnd.add(nx);
  }
  // 남의 색 함정 중 이미 드러난(터진) 건 해롭지 않고, 내 색 함정은 밟으면 해제된다
  for (const t of v.traps) if (t.state === "armed" && t.color !== seat) block.add(t.cell);
  return { v, seat, n, caution, block, hardBlock, monsterAt, noEnd, bridgeOk };
}

/** gamble: 모르는 골짜기에 몸을 던짐 · risky: 꽉 막혔을 때 ♥ 하나 각오하고 위험 핑 칸도 지나감 */
function stepCost(k: Know, c: number, gamble: boolean, risky = false): number {
  const t = k.v.tiles[c];
  if (t === T_TREE) return INF;
  if (k.block.has(c)) return risky && !k.hardBlock.has(c) ? (k.monsterAt.has(c) ? 15 : 10) : INF;
  if (risky && t === T_RAVINE && !k.bridgeOk.has(c)) return 12;
  if (t === T_UNKNOWN) return 2.5;
  if (t === T_RAVINE) return k.bridgeOk.has(c) ? 1 : gamble ? 4 : INF;
  return 1 + (k.caution > 0 ? k.caution * uncheckedColors(k.v, c, k.seat) : 0);
}

function dijkstra(k: Know, from: number, gamble: boolean, risky = false): { dist: Float64Array; parent: Int32Array } {
  const dist = new Float64Array(k.n).fill(INF);
  const parent = new Int32Array(k.n).fill(-1);
  const done = new Uint8Array(k.n);
  dist[from] = 0;
  for (;;) {
    let c = -1;
    let best = INF;
    for (let i = 0; i < k.n; i++) {
      if (!done[i] && dist[i] < best) {
        best = dist[i];
        c = i;
      }
    }
    if (c < 0) break;
    done[c] = 1;
    // 모르는 칸 너머로는 길을 이어 가지 않는다 (탐험 경계까지만)
    if (k.v.tiles[c] === T_UNKNOWN) continue;
    for (const nb of neighbors4(k.v.w, k.v.h, c)) {
      const sc = stepCost(k, nb, gamble, risky);
      if (sc >= INF) continue;
      const nd = dist[c] + sc;
      if (nd < dist[nb]) {
        dist[nb] = nd;
        parent[nb] = c;
      }
    }
  }
  return { dist, parent };
}

function routeTo(parent: Int32Array, from: number, to: number): number[] {
  const out: number[] = [];
  let c = to;
  let guard = 0;
  while (c !== -1 && c !== from && guard++ < 1000) {
    out.push(c);
    c = parent[c];
  }
  return c === from ? out.reverse() : [];
}

/** 동료가 걸어서 닿는 거리 (아는 길만) */
function unitDist(v: GameState, from: number): Int16Array {
  const dist = new Int16Array(v.w * v.h).fill(-1);
  dist[from] = 0;
  const q = [from];
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    for (const nb of neighbors4(v.w, v.h, c)) {
      if (dist[nb] !== -1) continue;
      const t = v.tiles[nb];
      if (t === T_TREE || t === T_UNKNOWN) continue;
      dist[nb] = dist[c] + 1;
      q.push(nb);
    }
  }
  return dist;
}

function teammates(v: GameState, seat: Seat): Seat[] {
  return Array.from({ length: v.seatCount }, (_, s) => s).filter((s) => s !== seat);
}

// ------------------------------------------------------------------ 경고

export interface Warning {
  cell: number;
  mark: PingMark;
  word?: number;
}

export function botWarning(full: GameState, seat: Seat): Warning | null {
  if (full.phase !== "plan" || full.pingsLeft[seat] <= 0) return null;
  const v = full.viewer === seat ? full : lanternView(full, seat);
  const mates = teammates(v, seat);
  const myTraps = v.traps.filter((t) => t.state === "armed" && t.color === seat);
  const myMonsters = v.monsters.filter((m) => !m.gone && m.color === seat);
  const myBridges = v.bridges.filter((b) => b.color === seat && !b.revealed);
  const word = v.wordsLeft[seat] > 0 ? WORD_STOP : undefined;

  // 1. 동료 계획이 내 색 위험에 닿음
  for (const t of mates) {
    const cells = plannedCells(v, t);
    const end = cells.length > 0 ? cells[cells.length - 1] : v.players[t].pos;
    for (const trap of myTraps) if (cells.includes(trap.cell) && !pingAt(v, trap.cell, ["danger"])) return { cell: trap.cell, mark: "danger", word };
    for (const m of myMonsters) {
      if (m.idx < 0) continue;
      const cur = monsterCell(m);
      const nx = monsterNextCell(m);
      const hit = cells.includes(cur) || end === nx;
      if (hit && !pingAt(v, cur, ["monster", "danger"])) return { cell: cur, mark: "monster", word };
    }
  }

  // 2. 미리 알림 — 핑 자리 하나는 1번 경고용으로 남겨 둔다
  const mine = v.pings.filter((p) => p.seat === seat).length;
  if (mine >= MAX_ACTIVE_PINGS - 1) return null;
  const dists = mates.map((t) => unitDist(v, v.players[t].pos));
  const near = (cell: number, r: number) => dists.some((d) => d[cell] >= 0 && d[cell] <= r);
  for (const trap of myTraps) if (!pingAt(v, trap.cell, ["danger"]) && near(trap.cell, 4)) return { cell: trap.cell, mark: "danger" };
  for (const m of myMonsters) {
    if (m.path.some((c) => pingAt(v, c, ["monster"]))) continue;
    const at = m.idx >= 0 ? monsterCell(m) : m.path[0];
    if (v.explored[at] === "1" && m.path.some((c) => near(c, 5))) return { cell: at, mark: "monster" };
  }
  // 다리는 멀어도 알린다 — 다리 건너편 조각은 다리 주인 말고는 아무도 못 간다
  for (const b of myBridges) if (!pingAt(v, b.cell, ["bridge", "safe"])) return { cell: b.cell, mark: "bridge" };
  return null;
}

// ------------------------------------------------------------------ 계획

function frontier(v: GameState, k: Know): number[] {
  const out: number[] = [];
  for (let c = 0; c < k.n; c++) {
    const t = v.tiles[c];
    if (t === T_TREE || t === T_UNKNOWN) continue;
    if (t === T_RAVINE && !k.bridgeOk.has(c)) continue;
    if (neighbors4(v.w, v.h, c).some((nb) => v.tiles[nb] === T_UNKNOWN)) out.push(c);
  }
  return out;
}

export interface BotPlan {
  steps: Dir[];
  flare: boolean;
}

export function planFor(full: GameState, seat: Seat, level: BotLevel, rng: () => number): BotPlan {
  const v = full.viewer === seat ? full : lanternView(full, seat);
  const me = v.players[seat];
  // 높은 레벨일수록 다른 색이 아직 안 비춘 칸을 꺼린다 → 자연스럽게 탐험대가 뭉쳐 다닌다
  const k = know(v, seat, level >= 8 ? 2 : level >= 6 ? 1.4 : level >= 3 ? 0.7 : 0);
  const spread = level >= 6 ? 0 : level >= 3 ? 3 : 5;
  const gamble = level <= 2 && rng() < 0.5;
  const mates = teammates(v, seat);
  const mateDist = mates.map((t) => unitDist(v, v.players[t].pos));
  const shardsLeft = v.need - v.shards.filter((s) => s.taken).length;
  const roundsLeft = v.maxRounds - v.round;

  const pickBest = (cells: number[], score: (c: number) => number) => {
    let best = -1;
    let bs = INF;
    for (const c of cells) {
      const sc = score(c);
      if (sc < bs) {
        bs = sc;
        best = c;
      }
    }
    return best;
  };

  const myBit = 1 << seat;
  /** 이 거리표로 갈 곳을 고른다. 없으면 -1 */
  const chooseTarget = (dist: Float64Array): { target: number; exploring: boolean } => {
    const reach = (c: number) => dist[c] < INF;
    const closestIsMe = (c: number) => mateDist.every((d) => d[c] < 0 || d[c] >= dist[c]);
    const cands: { cell: number; score: number; exploring?: boolean }[] = [];
    if (shardsLeft <= 0) {
      if (reach(v.altar)) cands.push({ cell: v.altar, score: dist[v.altar] });
    } else {
      for (const s of v.shards) if (!s.taken && reach(s.cell)) cands.push({ cell: s.cell, score: dist[s.cell] + (closestIsMe(s.cell) ? 0 : spread + 1) });
    }
    const haveGoal = cands.length > 0;
    if (level >= 5 && roundsLeft > 6) {
      const lim = level >= 7 ? 6 : 3;
      for (const j of v.jars) if (!j.taken && reach(j.cell) && dist[j.cell] <= lim) cands.push({ cell: j.cell, score: dist[j.cell] + 1 });
    }
    // 내 색 괴물 퇴치 — 옆 칸에서 멈추면 된다
    if (level >= 4) {
      for (const m of v.monsters) {
        if (m.gone || m.color !== seat || m.idx < 0) continue;
        const spot = pickBest(
          neighbors4(v.w, v.h, monsterCell(m)).filter((c) => reach(c) && !k.block.has(c)),
          (c) => dist[c],
        );
        // 동료가 이 괴물을 핑했으면(길이 막혔다는 뜻) 멀어도 간다
        const called = m.path.some((c) => pingAt(v, c, ["monster", "danger"], seat));
        const lim = called ? INF : level >= 7 ? 12 : 7;
        if (spot >= 0 && dist[spot] <= lim) cands.push({ cell: spot, score: dist[spot] - (called ? 4 : 1) });
      }
    }
    // 내 색이 아직 안 본 골짜기 — 내 다리일지도 모른다. 옆 칸까지 가서 비춰 본다
    for (let c = 0; c < k.n; c++) {
      if (v.tiles[c] !== T_RAVINE || k.bridgeOk.has(c) || k.hardBlock.has(c) || v.checked[c] & myBit) continue;
      const spot = pickBest(
        neighbors4(v.w, v.h, c).filter((x) => reach(x) && v.tiles[x] !== T_RAVINE),
        (x) => dist[x],
      );
      if (spot >= 0) cands.push({ cell: spot, score: dist[spot] + (haveGoal ? 6 : 2) });
    }
    const fr = frontier(v, k).filter(reach);
    const noisy = level <= 3 && rng() < 0.35;
    const towardAltar = (c: number) => (shardsLeft <= 0 ? Math.abs((c % v.w) - (v.altar % v.w)) + Math.abs(Math.floor(c / v.w) - Math.floor(v.altar / v.w)) : 0);
    for (const c of fr) cands.push({ cell: c, score: dist[c] + (haveGoal ? 10 : 0) + (closestIsMe(c) ? 0 : spread) + (noisy ? rng() * 20 : rng() * 0.5) + towardAltar(c) * 0.3, exploring: true });
    if (cands.length > 0) {
      const best = cands.reduce((a, b) => (b.score < a.score ? b : a));
      return { target: best.cell, exploring: best.exploring === true };
    }
    // 내 색 함정이 동료 길을 막고 있으면 내가 밟아 해제한다
    const myTrap = v.traps.filter((t) => t.state === "armed" && t.color === seat && reach(t.cell)).map((t) => t.cell);
    if (myTrap.length > 0) return { target: pickBest(myTrap, (c) => dist[c] - (pingAt(v, c, ["danger"]) ? 5 : 0)), exploring: false };
    return { target: -1, exploring: false };
  };

  // 목표는 순수 걸음 거리로 고르고(라운드마다 목표가 뒤바뀌지 않게), 길은 조심 가중치로 찾는다
  const k0 = know(v, seat, 0);
  const last = v.lastMoves;
  const lp = last?.paths[seat] ?? [];
  const prevCell = lp.length >= 2 ? lp[lp.length - 2] : lp.length === 1 ? (last?.from[seat] ?? -1) : -1;
  const pick = (risky: boolean) => {
    const unit = dijkstra(k0, me.pos, gamble, risky);
    // 방금 온 길로 바로 되돌아가는 목표엔 벌점 — 두 목표 사이를 오가며 등유만 태우지 않게
    const back = new Float64Array(k.n);
    if (prevCell >= 0) {
      for (let c = 0; c < k.n; c++) {
        if (unit.dist[c] >= INF) continue;
        let x = c;
        let guard = 0;
        while (unit.parent[x] !== -1 && unit.parent[x] !== me.pos && guard++ < 400) x = unit.parent[x];
        if (x === prevCell) back[c] = 4;
      }
    }
    const scored = new Float64Array(k.n);
    for (let c = 0; c < k.n; c++) scored[c] = unit.dist[c] >= INF ? INF : unit.dist[c] + back[c];
    return { ...chooseTarget(scored), route: dijkstra(k, me.pos, gamble, risky), risky };
  };
  let choice = pick(false);
  // 꽉 막혔다: ♥가 넉넉하면 위험 핑 칸·모르는 골짜기도 각오하고 지나간다
  if (choice.target < 0 && v.hearts >= 3) {
    const risky = pick(true);
    if (risky.target >= 0) choice = risky;
  }
  const { target, exploring } = choice;
  const parent = choice.route.parent;

  let cells = target >= 0 && target !== me.pos ? routeTo(parent, me.pos, target) : [];
  const cut = cells.findIndex((c) => v.tiles[c] === T_UNKNOWN);
  if (cut >= 0) cells = cells.slice(0, cut);
  let take = Math.min(MOVE_MAX, cells.length);
  if (level <= 3 && take > 1 && rng() < 0.25) take = 1 + Math.floor(rng() * take);
  cells = cells.slice(0, take);
  if (!choice.risky) while (cells.length > 0 && k.noEnd.has(cells[cells.length - 1])) cells.pop();
  // 제자리가 괴물이 올 칸이면 비켜선다
  if (cells.length === 0 && k.noEnd.has(me.pos)) {
    const away = neighbors4(v.w, v.h, me.pos).find((c) => stepCost(k, c, false) < INF && v.tiles[c] !== T_UNKNOWN && !k.noEnd.has(c));
    if (away !== undefined) cells = [away];
  }

  const steps: Dir[] = [];
  let at = me.pos;
  for (const c of cells) {
    const d = dirBetween(v.w, at, c);
    if (!d) break;
    steps.push(d);
    at = c;
  }

  // 🔆은 아껴 쓴다: 넓은 어둠을 탐험할 때, 이번 라운드에 아무도 안 밝힐 때만
  let flare = false;
  const someoneFlares = mates.some((t) => v.plans[t].flare || v.players[t].flaring);
  if (me.flares > 0 && level >= 5 && !someoneFlares && v.round >= 4) {
    let unknown = 0;
    for (let c = 0; c < k.n; c++) if (v.tiles[c] === T_UNKNOWN && Math.abs((c % v.w) - (at % v.w)) + Math.abs(Math.floor(c / v.w) - Math.floor(at / v.w)) <= 6) unknown++;
    flare = (exploring && unknown >= 16 && rng() < 0.3) || (target < 0 && level >= 8);
  }
  return { steps, flare };
}

/** 계획을 냈는데 그 길에 남이 위험 핑을 꽂았거나 괴물이 올 칸에서 끝나면 다시 짠다 */
export function needsReplan(full: GameState, seat: Seat): boolean {
  if (full.phase !== "plan" || !full.plans[seat]?.planned || full.players[seat].stunned > 0) return false;
  const v = full.viewer === seat ? full : lanternView(full, seat);
  const cells = plannedCells(v, seat);
  if (cells.length === 0) return false;
  const k = know(v, seat);
  return cells.some((c) => k.block.has(c)) || k.noEnd.has(cells[cells.length - 1]);
}

/** 봇이 지금 할 일이 있는가 — 서버(pendingBot)·방장 자동 진행이 같이 쓴다. chooseBotAction이 null이 아닌 때와 같다. */
export function botHasWork(full: GameState, seat: Seat): boolean {
  if (full.phase !== "plan") return false;
  if (botWarning(full, seat)) return true;
  if (full.players[seat].stunned > 0) return false;
  const p = full.plans[seat];
  return !p.planned || !p.ready || needsReplan(full, seat);
}

/**
 * 한 번에 하나: 경고 → 계획 공개(PLAN, 아직 출발 안 함) → 출발(READY).
 * 계획과 출발을 나눠야 다른 봇·사람이 그 계획을 보고 경고할 틈이 생긴다.
 */
export function chooseBotAction(full: GameState, seat: Seat, level: BotLevel, rng: () => number = Math.random): EngineAction | null {
  if (full.phase !== "plan") return null;
  const round = full.round;
  const warn = botWarning(full, seat);
  if (warn) return { type: "SIGNAL", seat, round, ping: { cell: warn.cell, mark: warn.mark }, ...(warn.word !== undefined ? { word: warn.word } : {}) };
  if (full.players[seat].stunned > 0) return null;
  const cur = full.plans[seat];
  if (!cur.planned || needsReplan(full, seat)) {
    const plan = planFor(full, seat, level, rng);
    if (cur.planned && cur.steps.join("") === plan.steps.join("")) {
      // 다시 짜도 같은 길이면 제자리로 (같은 상태 반복 방지)
      return { type: "PLAN", seat, round, steps: [], flare: false };
    }
    return { type: "PLAN", seat, round, steps: plan.steps, flare: plan.flare };
  }
  if (!cur.ready) return { type: "READY", seat, round, ready: true };
  return null;
}
