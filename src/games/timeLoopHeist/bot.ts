import { seededRng } from "@/lib/rng";
import type { BotLevel } from "@/games/shared/bot/botDifficulty";
import { levelOf, type GameState, type Seat } from "./engine";
import { parseLevel, type LevelDef, type RoleDef, type RoleStep } from "./levels";
import { DIRS, passable, simulate, sortTracks, type SelfTrack, type SimResult } from "./sim";

/**
 * 시간 루프 도둑단 봇 — 한 루프치 행동열을 한 번에 만든다.
 *
 * 1) 지금(지난 루프 유령 + 이번 루프에 먼저 낸 동료 녹화) 세상에서 가져올 수 있는 보석이 있으면
 *    가져온다(필요하면 레버를 먼저 당긴다).
 * 2) 없으면 작전의 `roles`(발판 지키기·레버·EMP)를 앞에서부터 보며 아직 해결 안 된 것을 맡는다.
 * 3) 그것도 없으면 동전을 줍거나 출발점에서 대기.
 *
 * 경로 찾기 = (x, y, t) 시간 확장 BFS. 문 열림·경비 시야는 "나를 뺀 세상 + 지금까지의 내 계획"
 * 시뮬레이션에서 읽는다. 만든 계획은 전체 시뮬레이션으로 다시 검증한다(내가 체포/역설 없이,
 * 남의 자아를 망가뜨리지 않고, 목표를 이뤘는지).
 *
 * 레벨이 낮을수록 가끔 엉뚱하게 돌아다니며 루프 하나를 날리거나 늦게 출발한다.
 */

type Goal = (run: SimResult, me: number) => boolean;

interface Ctx {
  def: LevelDef;
  T: number;
  others: SelfTrack[];
  seat: Seat;
  loop: number;
  need: number;
  baseCasualties: number;
}

function myIndex(ctx: Ctx): number {
  const sorted = sortTracks([...ctx.others, { seat: ctx.seat, loop: ctx.loop, moves: "" }]);
  return sorted.findIndex((t) => t.seat === ctx.seat && t.loop === ctx.loop);
}

function run(ctx: Ctx, moves: string): SimResult {
  return simulate(ctx.def, [...ctx.others, { seat: ctx.seat, loop: ctx.loop, moves }], ctx.need);
}

function casualties(r: SimResult, except: number): number {
  return r.events.filter((e) => (e.kind === "paradox" || e.kind === "caught") && e.self !== except).length;
}

/** prefix 뒤로 target 칸까지 가장 빨리 가는 이동열 (시야·닫힌 문 회피) */
function bfs(ctx: Ctx, prefix: string, target: { x: number; y: number }): string | null {
  const lv = parseLevel(ctx.def);
  const r = run(ctx, prefix);
  const me = myIndex(ctx);
  const t0 = prefix.length;
  const start = r.frames[t0]?.selves[me];
  if (!start || start.status !== "ok") return null;
  if (start.x === target.x && start.y === target.y) return "";
  const W = lv.w;
  const H = lv.h;
  const key = (x: number, y: number, t: number) => (t * H + y) * W + x;
  const prev = new Map<number, { k: number; ch: string }>();
  let frontier: [number, number][] = [[start.x, start.y]];
  const seenSets = r.frames.map((f) => new Set(f.seen));
  for (let t = t0; t < ctx.T && frontier.length > 0; t++) {
    const next: [number, number][] = [];
    const frame = r.frames[t];
    const after = seenSets[t + 1];
    for (const [x, y] of frontier) {
      const opts: [string, number, number][] = [
        ["N", x, y - 1],
        ["S", x, y + 1],
        ["E", x + 1, y],
        ["W", x - 1, y],
        [".", x, y],
      ];
      for (const [ch, nx, ny] of opts) {
        if (ch !== "." && !passable(lv, nx, ny, frame.open)) continue;
        if (after.has(ny * W + nx)) continue;
        const k = key(nx, ny, t + 1);
        if (prev.has(k)) continue;
        prev.set(k, { k: key(x, y, t), ch });
        if (nx === target.x && ny === target.y) {
          let out = "";
          let cur = k;
          const startKey = key(start.x, start.y, t0);
          while (cur !== startKey) {
            const p = prev.get(cur)!;
            out = p.ch + out;
            cur = p.k;
          }
          return out;
        }
        next.push([nx, ny]);
      }
    }
    frontier = next;
  }
  return null;
}

function pad(moves: string, T: number): string {
  return moves.length >= T ? moves.slice(0, T) : moves + ".".repeat(T - moves.length);
}

/** 계획 검증: 나는 무사, 남의 자아 피해 없음, 목표 달성 */
function verify(ctx: Ctx, moves: string, goal: Goal): boolean {
  const r = run(ctx, moves);
  const me = myIndex(ctx);
  if (r.final.selves[me]?.status !== "ok") return false;
  if (casualties(r, me) > ctx.baseCasualties) return false;
  return goal(r, me);
}

function stepPlan(ctx: Ctx, prefix: string, step: RoleStep): string | null {
  const lv = parseLevel(ctx.def);
  if (step.kind === "lever") {
    const at = lv.levers[step.trig];
    if (!at) return null;
    const path = bfs(ctx, prefix, at);
    if (path === null) return null;
    const p = prefix + path;
    const frame = run(ctx, p).frames[p.length];
    return frame?.levers[step.trig] ? p : p + "U";
  }
  if (step.kind === "hold") {
    const at = lv.plates[step.trig];
    if (!at) return null;
    const path = bfs(ctx, prefix, at);
    if (path === null) return null;
    return pad(prefix + path, ctx.T);
  }
  const at = lv.consoles[step.trig];
  if (!at) return null;
  const path = bfs(ctx, prefix, at);
  if (path === null) return null;
  let p = prefix + path;
  if (p.length < step.at) p += ".".repeat(step.at - p.length);
  return p.length < ctx.T ? p + "U" : null;
}

function stepDone(r: SimResult, step: RoleStep, T: number): boolean {
  if (step.kind === "lever") return r.frames[T].levers[step.trig] === true;
  if (step.kind === "hold") {
    for (let t = step.from; t < T; t++) if (!r.frames[t].active[step.trig]) return false;
    return true;
  }
  return r.frames[Math.min(T, step.at + 1)].active[step.trig] === true;
}

/** 역할의 "마지막 효과"가 이미 세상에 있는가 */
function roleDone(r: SimResult, role: RoleDef, T: number): boolean {
  const effects = role.steps.filter((s) => s.kind !== "lever");
  return (effects.length > 0 ? effects : role.steps).every((s) => stepDone(r, s, T));
}

function planRole(ctx: Ctx, role: RoleDef): string | null {
  let p = "";
  for (const step of role.steps) {
    const next = stepPlan(ctx, p, step);
    if (next === null) return null;
    p = next;
  }
  const moves = pad(p, ctx.T);
  return verify(ctx, moves, (r) => roleDone(r, role, ctx.T)) ? moves : null;
}

/** loot 하나를 가져와 밴에 넣기 (필요하면 레버 먼저) */
function planFetch(ctx: Ctx, lootId: number, leverFirst: string | null): string | null {
  const lv = parseLevel(ctx.def);
  const item = lv.loot[lootId];
  let p = "";
  if (leverFirst) {
    const s = stepPlan(ctx, p, { kind: "lever", trig: leverFirst });
    if (s === null) return null;
    p = s;
  }
  const go = bfs(ctx, p, item);
  if (go === null) return null;
  p += go;
  const back = bfs(ctx, p, lv.van);
  if (back === null) return null;
  const moves = pad(p + back, ctx.T);
  // 가는 길에 다른 보석을 먼저 주워도 "내가 보석 하나를 입금"하면 성공으로 본다
  const kind = item.kind;
  return verify(ctx, moves, (r, me) => r.events.some((e) => e.kind === "bank" && e.self === me && e.loot !== undefined && lv.loot[e.loot].kind === kind)) ? moves : null;
}

function bankedTick(ctx: Ctx, moves: string): number {
  const r = run(ctx, moves);
  const me = myIndex(ctx);
  const e = r.events.find((ev) => ev.kind === "bank" && ev.self === me);
  return e ? e.t : ctx.T + 1;
}

function bestFetch(ctx: Ctx, kind: "gem" | "coin", base: SimResult): string | null {
  const lv = parseLevel(ctx.def);
  const leverIds = Object.keys(lv.levers).filter((id) => !base.frames[ctx.T].levers[id]);
  let best: { moves: string; at: number } | null = null;
  for (const item of lv.loot) {
    if (item.kind !== kind) continue;
    const st = base.final.loot[item.id]?.state;
    if (st === "banked") continue;
    // 동료(같은 루프에 먼저 낸 녹화)가 이미 주운 건 건너뛴다
    if (base.events.some((e) => e.kind === (kind === "gem" ? "pick" : "coin") && e.loot === item.id)) continue;
    for (const lever of [null, ...leverIds]) {
      const moves = planFetch(ctx, item.id, lever);
      if (!moves) continue;
      const at = bankedTick(ctx, moves);
      if (!best || at < best.at) best = { moves, at };
      break;
    }
  }
  return best?.moves ?? null;
}

function wander(ctx: Ctx, rng: () => number): string {
  const lv = parseLevel(ctx.def);
  let p = "";
  for (let t = 0; t < ctx.T; t++) {
    const r = run(ctx, p);
    const me = r.frames[t].selves[myIndex(ctx)];
    if (!me || me.status !== "ok") break;
    const dirs = (["N", "S", "E", "W"] as const).filter((d) => passable(lv, me.x + DIRS[d][0], me.y + DIRS[d][1], r.frames[t].open));
    p += rng() < 0.3 || dirs.length === 0 ? "." : dirs[Math.floor(rng() * dirs.length)];
  }
  return pad(p, ctx.T);
}

function mistakeRate(level: BotLevel): number {
  if (level <= 2) return 0.35;
  if (level <= 4) return 0.2;
  if (level <= 6) return 0.07;
  return 0;
}

export function chooseBotMoves(state: GameState, seat: Seat, level: BotLevel): string {
  const def = levelOf(state);
  const T = def.ticks;
  const now: SelfTrack[] = state.pending
    .map((m, s) => (m !== null && s !== seat ? { seat: s, loop: state.loop, moves: m } : null))
    .filter((t): t is SelfTrack => t !== null);
  const others = [...state.tracks, ...now];
  const base = simulate(def, others, state.need);
  const ctx: Ctx = { def, T, others, seat, loop: state.loop, need: state.need, baseCasualties: 0 };
  ctx.baseCasualties = casualties(run(ctx, ".".repeat(T)), myIndex(ctx));

  const rng = seededRng((state.seed ^ (state.loop * 7919) ^ (seat * 104_729)) >>> 0);
  // 마지막 루프에는 실수하지 않는다(체감상 "봇이 판을 망쳤다"가 가장 억울하다)
  if (state.loop < state.maxLoops && rng() < mistakeRate(level)) return wander(ctx, rng);

  const gem = base.final.gems >= state.need ? null : bestFetch(ctx, "gem", base);
  if (gem) return gem;
  for (const role of def.roles) {
    if (roleDone(base, role, T)) continue;
    const moves = planRole(ctx, role);
    if (moves) return moves;
  }
  if (level >= 4) {
    const coin = bestFetch(ctx, "coin", base);
    if (coin) return coin;
  }
  return ".".repeat(T);
}
