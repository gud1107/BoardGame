/**
 * Pure "지렁이" rules engine — no React, no I/O.
 *
 * ⚠️ Spec history (see HANDOFF.md / docs/history.md for the full story): the
 * previous version of this file implemented a turn-based dice/tile-collecting
 * game (a Pickomino/Heckmeck house rule) taken literally from an earlier task
 * brief, deliberately ignoring the rule doc at
 * `boardGameRule/지렁이/지렁이.md` because the two disagreed and the user was
 * asked which to build. **That decision has since been reversed by explicit
 * user instruction**: the dice/tile engine is discarded outright and this
 * file now implements the `.md` doc's actual design — a real-time,
 * Slither.io-style growth/raiding game (continuous movement, food pellets,
 * boost, tail-cutting, head/body collisions).
 *
 * ## Why this is NOT a per-frame reducer (and why that's fine)
 *
 * Every other engine in this project is a discrete-action reducer
 * (`applyAction(state, action)`) driven by user clicks, replayed lockstep
 * over Supabase Realtime (see ARCHITECTURE.md §1, docs/cloud-sync.md). That
 * shape doesn't fit a continuous physics simulation — there is no
 * "action", just "time passed, here is everyone's current heading/boost
 * input". So this engine's one entry point is a **fixed-step advance
 * function**, `stepWorm(state, dtMs, inputs, rng)`, called repeatedly (the
 * project's convention of injecting a seeded `rng` per call is kept, but
 * unlike other engines it's expected to be called many times per second with
 * the *same* long-lived rng closure rather than once per user action).
 *
 * This is still a pure function (no `Date.now()`, no `Math.random()`, no
 * React, no network) — determinism holds given the same `(state, dtMs,
 * inputs, rng-state)` — but the *online multiplayer adapter* built on top of
 * it necessarily differs from every other game's lockstep protocol. See
 * `WormGame.tsx`'s module doc and docs/cloud-sync.md §5 ("호스트 권위 실시간
 * 동기화") for how that's handled: one client (the host) is the sole caller
 * of `stepWorm`, broadcasting the resulting snapshots; nobody else replays
 * the simulation. This is a deliberate, documented exception to
 * ARCHITECTURE.md's "don't invent a new sync protocol" rule.
 *
 * ## Documented inferences (rule doc left gaps, filled in from the doc's own
 * stated intent and this project's conventions)
 * - The doc never specifies an arena boundary or a match-length win
 *   condition beyond "제한 시간 내에 가장 길거나 큰 뱀을 만들거나, 상대방을
 *   완전히 제압하여 살아남기". This engine adds a bounded rectangular arena
 *   (touching the edge kills you, same drop-your-body-as-food treatment as
 *   any other death — arcade-genre convention, not spelled out but implied
 *   by "제한 시간 내" needing *some* finite playfield) and a fixed match
 *   timer (`MATCH_DURATION_MS`), after which final rankings are computed.
 * - Ranking metric: the doc's win condition is peak size, so
 *   `computeRankings` sorts by lifetime cumulative food-score (never
 *   decreases, even across deaths/respawns — a snake that got cut right
 *   before the buzzer isn't unfairly punished for a single bad instant),
 *   tie-broken by the single highest length ever reached (`bestLength`).
 * - Head-vs-head tie (exactly equal length): doc says "둘 다 마디 1개씩
 *   상실" — implemented literally as both losing exactly 1 segment, neither
 *   dying.
 * - All numeric speed/turn/boost constants below are this engine's own
 *   scale (world units, not the doc's abstract "Speed - Length*0.05"
 *   placeholder units) — chosen to produce the doc's *described feel*
 *   (longer = ohly slightly slower; boost ~1.5-2x; boost costs ~1
 *   segment/second) rather than its literal formula, since the doc's units
 *   were never grounded to an actual coordinate system.
 */

import { seededRng } from "@/lib/rng";
export { seededRng };

export type SeatIndex = number;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

export interface Vec2 {
  x: number;
  y: number;
}

export interface ArenaSize {
  width: number;
  height: number;
}

// 2026-09-02 맵 확장 세션: 3000 → 5250 (1.75배 선형 확장, `AskUserQuestion`으로
// 1.5/1.75/2배 중 확정 — 면적 기준으로는 약 3.06배). 아래 `FOOD_COUNT_TARGET`도
// 같은 면적 배율로 함께 올려 먹이 밀도(단위 면적당 개수)를 이전과 동일하게 유지.
export const ARENA_SIZE = 5250;
export const DEFAULT_ARENA: ArenaSize = { width: ARENA_SIZE, height: ARENA_SIZE };

export const SEGMENT_SPACING = 16;
export const START_LENGTH = 8;
export const HEAD_RADIUS = 11;
export const BODY_RADIUS = 9;
export const FOOD_RADIUS = 7;

export const BASE_SPEED = 240; // world units / second at zero length
export const SPEED_LENGTH_PENALTY = 0.6; // world units/sec shaved off per segment of length
export const MIN_SPEED = 90;
export const BOOST_MULTIPLIER = 1.7;
export const MIN_LENGTH_TO_BOOST = 6;
export const BOOST_DRAIN_MS = 350; // lose 1 segment every this many ms of boosting
export const TURN_RATE = Math.PI * 2.6; // max radians/sec the head can turn

// 160 * (5250/3000)^2 ≈ 490 — same food density per world-area as before the
// map expansion above, not just the same raw count on a now-3x-larger field.
export const FOOD_COUNT_TARGET = 490;
export const FOOD_VALUE_MIN = 1;
export const FOOD_VALUE_MAX = 3;

// 2026-09-02 맵 확장 세션: 성장 단계별 외형 진화 길이 기준(`AskUserQuestion`으로
// 20/40 확정) — `length < MID`는 기본형, `[MID, LARGE)`는 중형(두꺼워짐 + 테두리
// 패턴), `>= LARGE`는 대형(중형 외형 + 잔상 이펙트). `WormCanvas.tsx`의 렌더링과
// `getGrowthStage`가 이 두 상수만 참조하므로 튜닝은 여기 한 곳만 고치면 된다.
export const GROWTH_STAGE_MID_LENGTH = 20;
export const GROWTH_STAGE_LARGE_LENGTH = 40;
export type GrowthStage = "small" | "mid" | "large";
export function getGrowthStage(length: number): GrowthStage {
  if (length >= GROWTH_STAGE_LARGE_LENGTH) return "large";
  if (length >= GROWTH_STAGE_MID_LENGTH) return "mid";
  return "small";
}

export const RESPAWN_DELAY_MS = 1800;
export const MATCH_DURATION_MS = 3 * 60 * 1000;
export const SELF_COLLISION_SKIP = 6; // segments nearest the head ignored for self-collision

/** Hue (0-360, for `hsl()`) assigned per seat, cycling if `playerCount > SEAT_HUES.length`. */
export const SEAT_HUES = [140, 195, 300, 30, 265, 5, 90, 170];

export interface SnakeInput {
  angle: number;
  boosting: boolean;
}

export interface SnakeState {
  seat: SeatIndex;
  alive: boolean;
  angle: number;
  targetAngle: number;
  boosting: boolean;
  speed: number;
  /** Head trajectory history, most-recent-first (`path[0]` is the head). Trimmed each tick to only what `segments` needs. */
  path: Vec2[];
  /** Resampled body points at `SEGMENT_SPACING` intervals, head first — what gets rendered/collision-checked. */
  segments: Vec2[];
  length: number;
  /** Highest `length` ever reached (survives death/respawn) — the tie-break ranking metric. */
  bestLength: number;
  /** Cumulative food value eaten (survives death/respawn) — the primary ranking metric. */
  score: number;
  boostAccumMs: number;
  deadAtMs: number | null;
  hue: number;
}

export interface FoodItem {
  id: number;
  x: number;
  y: number;
  value: number;
  hue: number;
}

export interface WormState {
  playerCount: number;
  snakes: Record<SeatIndex, SnakeState>;
  food: FoodItem[];
  nextFoodId: number;
  elapsedMs: number;
  arena: ArenaSize;
  phase: "playing" | "gameOver";
}

// ---------------------------------------------------------------------------
// Small vector/angle helpers
// ---------------------------------------------------------------------------

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Normalizes to (-PI, PI]. */
export function normalizeAngle(a: number): number {
  let x = a % (Math.PI * 2);
  if (x <= -Math.PI) x += Math.PI * 2;
  if (x > Math.PI) x -= Math.PI * 2;
  return x;
}

function angleDiff(from: number, to: number): number {
  return normalizeAngle(to - from);
}

// ---------------------------------------------------------------------------
// Food & random placement
// ---------------------------------------------------------------------------

function randomFoodValue(rng: () => number): number {
  return FOOD_VALUE_MIN + Math.floor(rng() * (FOOD_VALUE_MAX - FOOD_VALUE_MIN + 1));
}

function randomPointInArena(arena: ArenaSize, rng: () => number): Vec2 {
  return { x: rng() * arena.width, y: rng() * arena.height };
}

function scatter(pos: Vec2, arena: ArenaSize, rng: () => number): Vec2 {
  return {
    x: clamp(pos.x + (rng() - 0.5) * 40, 0, arena.width),
    y: clamp(pos.y + (rng() - 0.5) * 40, 0, arena.height),
  };
}

function makeFood(id: number, pos: Vec2, value: number, rng: () => number): FoodItem {
  return { id, x: pos.x, y: pos.y, value, hue: Math.floor(rng() * 360) };
}

// ---------------------------------------------------------------------------
// Food spatial hash — 2026-09-02 맵 확장 세션: `FOOD_COUNT_TARGET`이 3배 가까이
//늘면서 매 틱 "모든 뱀 머리 x 모든 먹이"로 도는 원래 이중 루프의 비용도 같이 3배가
// 됐으므로, 먹이를 격자 버킷에 미리 넣어두고 머리 주변 3x3 셀만 훑도록 바꿔 최악의
// 경우(전체 스캔) 대신 평균적으로 근처 소수 후보만 검사하게 한다. 순수 broad-phase
// 최적화라 최종적으로 "어느 먹이가 이번 틱에 먹혔는가" 판정 결과는 원래 전수 스캔과
// 완전히 동일 — 셀 크기(160)가 판정 반경(HEAD_RADIUS+FOOD_RADIUS=18)보다 훨씬 커서
// 3x3 이웃 셀이 판정 원을 항상 포함한다.
const FOOD_GRID_CELL = 160;

function foodCellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

function buildFoodGrid(food: FoodItem[]): Map<string, FoodItem[]> {
  const grid = new Map<string, FoodItem[]>();
  for (const f of food) {
    const key = foodCellKey(Math.floor(f.x / FOOD_GRID_CELL), Math.floor(f.y / FOOD_GRID_CELL));
    const bucket = grid.get(key);
    if (bucket) bucket.push(f);
    else grid.set(key, [f]);
  }
  return grid;
}

/** Every food item within one grid cell of `(x, y)` (a 3x3 neighborhood) — a superset of anything actually eatable from here, cheap to over-include. */
function nearbyFood(grid: Map<string, FoodItem[]>, x: number, y: number): FoodItem[] {
  const cx = Math.floor(x / FOOD_GRID_CELL);
  const cy = Math.floor(y / FOOD_GRID_CELL);
  const out: FoodItem[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const bucket = grid.get(foodCellKey(cx + dx, cy + dy));
      if (bucket) out.push(...bucket);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Path -> body resampling
// ---------------------------------------------------------------------------

/** Drops path history beyond what `length` segments could ever need (plus a small buffer), keeping the array bounded. */
function trimPath(path: Vec2[], length: number): Vec2[] {
  const needed = length * SEGMENT_SPACING + SEGMENT_SPACING * 2;
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    acc += dist(path[i - 1], path[i]);
    if (acc >= needed) return path.slice(0, i + 1);
  }
  return path;
}

/** Walks the head's trajectory history and places `length` body points at fixed `spacing` intervals — the classic IK-free "follow the leader's breadcrumbs" snake technique. O(path.length + length). */
export function computeSegments(path: Vec2[], length: number, spacing: number): Vec2[] {
  if (path.length === 0) return [];
  const segments: Vec2[] = [path[0]];
  const cum: number[] = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + dist(path[i - 1], path[i]));
  const totalLen = cum[cum.length - 1];
  let ptr = 0;
  for (let i = 1; i < length; i++) {
    const target = i * spacing;
    if (target >= totalLen) {
      segments.push(path[path.length - 1]);
      continue;
    }
    while (ptr < cum.length - 2 && cum[ptr + 1] < target) ptr++;
    const segStart = cum[ptr];
    const segEnd = cum[ptr + 1];
    const t = segEnd > segStart ? (target - segStart) / (segEnd - segStart) : 0;
    segments.push(lerp(path[ptr], path[ptr + 1], t));
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Setup / respawn
// ---------------------------------------------------------------------------

function spawnSnake(seat: SeatIndex, pos: Vec2, heading: number, prev?: SnakeState): SnakeState {
  const behind = {
    x: pos.x - Math.cos(heading) * START_LENGTH * SEGMENT_SPACING,
    y: pos.y - Math.sin(heading) * START_LENGTH * SEGMENT_SPACING,
  };
  const path = [pos, behind];
  return {
    seat,
    alive: true,
    angle: heading,
    targetAngle: heading,
    boosting: false,
    speed: BASE_SPEED,
    path,
    segments: computeSegments(path, START_LENGTH, SEGMENT_SPACING),
    length: START_LENGTH,
    bestLength: Math.max(START_LENGTH, prev?.bestLength ?? 0),
    score: prev?.score ?? 0,
    boostAccumMs: 0,
    deadAtMs: null,
    hue: prev?.hue ?? SEAT_HUES[seat % SEAT_HUES.length],
  };
}

export function startGame(playerCount: number, seed: number, arena: ArenaSize = DEFAULT_ARENA): WormState {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`Unsupported player count: ${playerCount}`);
  }
  const rng = seededRng(seed);
  const snakes: Record<SeatIndex, SnakeState> = {};
  const cx = arena.width / 2;
  const cy = arena.height / 2;
  const radius = Math.min(arena.width, arena.height) * 0.3;
  for (let seat = 0; seat < playerCount; seat++) {
    const spawnAngle = (seat / playerCount) * Math.PI * 2;
    const pos = { x: cx + Math.cos(spawnAngle) * radius, y: cy + Math.sin(spawnAngle) * radius };
    const heading = normalizeAngle(spawnAngle + Math.PI); // face the center
    snakes[seat] = spawnSnake(seat, pos, heading);
  }
  let nextFoodId = 0;
  const food: FoodItem[] = [];
  while (food.length < FOOD_COUNT_TARGET) {
    food.push(makeFood(nextFoodId++, randomPointInArena(arena, rng), randomFoodValue(rng), rng));
  }
  return { playerCount, snakes, food, nextFoodId, elapsedMs: 0, arena, phase: "playing" };
}

// ---------------------------------------------------------------------------
// Input sanitizing (defensive parsing of network payloads, same
// reject-as-no-op spirit as every other engine's action guards)
// ---------------------------------------------------------------------------

export function sanitizeInput(raw: unknown): SnakeInput | null {
  if (!raw || typeof raw !== "object") return null;
  const angle = (raw as Record<string, unknown>).angle;
  const boosting = (raw as Record<string, unknown>).boosting;
  if (typeof angle !== "number" || !Number.isFinite(angle)) return null;
  return { angle: normalizeAngle(angle), boosting: !!boosting };
}

// ---------------------------------------------------------------------------
// The one advance function
// ---------------------------------------------------------------------------

/**
 * Advances the whole field by `dtMs` given each alive snake's latest known
 * input (missing entries keep coasting on their last heading, no boost).
 * `rng` drives food placement/scatter only — never movement — so replaying
 * the exact same `(state, dtMs, inputs)` sequence against a fresh
 * `seededRng` reproduces the exact same food layout, same determinism
 * contract as every other engine in this project.
 */
export function stepWorm(
  prev: WormState,
  dtMs: number,
  inputs: Partial<Record<SeatIndex, SnakeInput>>,
  rng: () => number = Math.random,
): WormState {
  if (prev.phase === "gameOver" || dtMs <= 0) return prev;
  // Clamp dt so a throttled background tab (or a slow first tick) can't fling a snake across the whole arena in one step.
  const dtSec = Math.min(dtMs, 250) / 1000;
  const elapsedMs = prev.elapsedMs + dtMs;
  const arena = prev.arena;

  // 1. Move every alive snake: turn toward its input angle at a bounded
  //    rate, integrate position, drain a segment periodically while boosting.
  const moved: Record<SeatIndex, SnakeState> = {};
  let foodIdCounter = prev.nextFoodId;
  const drops: FoodItem[] = [];

  for (let seat = 0; seat < prev.playerCount; seat++) {
    const snake = prev.snakes[seat];
    if (!snake.alive) {
      moved[seat] = snake;
      continue;
    }
    const input = inputs[seat];
    const targetAngle = input ? input.angle : snake.targetAngle;
    const boosting = !!input?.boosting && snake.length > MIN_LENGTH_TO_BOOST;
    const maxTurn = TURN_RATE * dtSec;
    const turn = clamp(angleDiff(snake.angle, targetAngle), -maxTurn, maxTurn);
    const angle = normalizeAngle(snake.angle + turn);
    const speedBase = Math.max(MIN_SPEED, BASE_SPEED - snake.length * SPEED_LENGTH_PENALTY);
    const speed = boosting ? speedBase * BOOST_MULTIPLIER : speedBase;
    const prevHead = snake.path[0];
    const head = { x: prevHead.x + Math.cos(angle) * speed * dtSec, y: prevHead.y + Math.sin(angle) * speed * dtSec };
    const path = trimPath([head, ...snake.path], snake.length);

    let length = snake.length;
    let boostAccumMs = snake.boostAccumMs;
    if (boosting) {
      boostAccumMs += dtMs;
      while (boostAccumMs >= BOOST_DRAIN_MS && length > MIN_LENGTH_TO_BOOST) {
        boostAccumMs -= BOOST_DRAIN_MS;
        length -= 1;
        const tail = path[path.length - 1] ?? head;
        drops.push(makeFood(foodIdCounter++, tail, 1, rng));
      }
    } else {
      boostAccumMs = 0;
    }

    moved[seat] = {
      ...snake,
      angle,
      targetAngle,
      boosting,
      speed,
      path,
      length,
      segments: computeSegments(path, length, SEGMENT_SPACING),
      boostAccumMs,
    };
  }

  // 2. Food consumption — head vs. every uneaten pellet *near it* (spatial
  //    hash broad-phase, see `buildFoodGrid` above), first seat (in seat
  //    order) to reach it this tick wins a simultaneous-arrival tie.
  const eaten = new Set<number>();
  const foodGrid = buildFoodGrid(prev.food);
  for (let seat = 0; seat < prev.playerCount; seat++) {
    const snake = moved[seat];
    if (!snake.alive) continue;
    const head = snake.path[0];
    for (const food of nearbyFood(foodGrid, head.x, head.y)) {
      if (eaten.has(food.id)) continue;
      if (dist(head, food) < HEAD_RADIUS + FOOD_RADIUS) {
        eaten.add(food.id);
        moved[seat] = { ...moved[seat], length: moved[seat].length + food.value, score: moved[seat].score + food.value * 10 };
      }
    }
  }
  for (let seat = 0; seat < prev.playerCount; seat++) {
    const s = moved[seat];
    if (!s.alive) continue;
    moved[seat] = { ...s, segments: computeSegments(s.path, s.length, SEGMENT_SPACING), bestLength: Math.max(s.bestLength, s.length) };
  }

  // 3. Collision detection — table straight from boardGameRule/지렁이/지렁이.md §2(2):
  //    [머리 vs 바닥 아이템] handled above · [머리 vs 머리] · [머리 vs 몸통(자기/상대)].
  const deaths = new Set<SeatIndex>();
  const cuts: Record<SeatIndex, number> = {}; // seat -> new (shortened) length

  for (let seat = 0; seat < prev.playerCount; seat++) {
    const s = moved[seat];
    if (!s.alive) continue;
    const h = s.path[0];
    if (h.x < 0 || h.x > arena.width || h.y < 0 || h.y > arena.height) deaths.add(seat);
  }

  // Pairs already fully resolved by a head-to-head hit this tick (kill or
  // tie) — their heads are, by definition, within `HEAD_RADIUS * 2` of each
  // other, which almost always also puts each snake's own segment #1 within
  // `HEAD_RADIUS + BODY_RADIUS` of the *other* snake's coincident head. That
  // would spuriously re-trigger as a body cut/self-kill in the pass below,
  // so a pair the head-to-head check already adjudicated is excluded from
  // the head-to-body pass for this same tick.
  const resolvedPairs = new Set<string>();

  for (let a = 0; a < prev.playerCount; a++) {
    if (!moved[a].alive || deaths.has(a)) continue;
    for (let b = a + 1; b < prev.playerCount; b++) {
      if (!moved[b].alive || deaths.has(b)) continue;
      if (dist(moved[a].path[0], moved[b].path[0]) < HEAD_RADIUS * 2) {
        resolvedPairs.add(`${a}-${b}`);
        if (moved[a].length > moved[b].length) deaths.add(b);
        else if (moved[b].length > moved[a].length) deaths.add(a);
        else {
          cuts[a] = Math.max(1, moved[a].length - 1);
          cuts[b] = Math.max(1, moved[b].length - 1);
        }
      }
    }
  }

  for (let a = 0; a < prev.playerCount; a++) {
    const attacker = moved[a];
    if (!attacker.alive || deaths.has(a)) continue;
    const attackerHead = attacker.path[0];
    for (let b = 0; b < prev.playerCount; b++) {
      const target = moved[b];
      if (!target.alive || deaths.has(b)) continue;
      const isSelf = a === b;
      if (!isSelf && resolvedPairs.has(a < b ? `${a}-${b}` : `${b}-${a}`)) continue;
      // Bounding-circle broad-phase: every one of `target`'s segments lies
      // within `target.length * SEGMENT_SPACING` of its own head, so if the
      // attacker's head is already farther than that (plus the collision
      // radius) from the target's head, none of its segments can possibly be
      // in range — skip the whole per-segment scan below. Bigger snakes on a
      // bigger map (see this session's arena expansion) is exactly the case
      // this saves the most on.
      if (!isSelf) {
        const maxReach = target.length * SEGMENT_SPACING + HEAD_RADIUS + BODY_RADIUS;
        if (dist(attackerHead, target.segments[0]) > maxReach) continue;
      }
      const startIdx = isSelf ? SELF_COLLISION_SKIP : 1; // idx 0 is the head, already resolved above
      for (let k = startIdx; k < target.segments.length; k++) {
        if (dist(attacker.path[0], target.segments[k]) < HEAD_RADIUS + BODY_RADIUS) {
          if (isSelf) deaths.add(a);
          else cuts[b] = Math.min(cuts[b] ?? target.length, k);
          break;
        }
      }
    }
  }

  // 4. Apply deaths/cuts: dead snakes drop their whole body as food and go
  //    into a respawn countdown; cut snakes drop the severed tail only.
  const finalSnakes: Record<SeatIndex, SnakeState> = {};
  for (let seat = 0; seat < prev.playerCount; seat++) {
    const s = moved[seat];
    if (deaths.has(seat)) {
      for (const seg of s.segments) {
        if (rng() < 0.7) drops.push(makeFood(foodIdCounter++, scatter(seg, arena, rng), randomFoodValue(rng), rng));
      }
      finalSnakes[seat] = { ...s, alive: false, deadAtMs: elapsedMs, path: [], segments: [] };
    } else if (cuts[seat] !== undefined && s.alive) {
      const cutAt = Math.min(cuts[seat], s.segments.length);
      const removed = s.segments.slice(cutAt);
      for (const seg of removed) {
        if (rng() < 0.8) drops.push(makeFood(foodIdCounter++, scatter(seg, arena, rng), randomFoodValue(rng), rng));
      }
      finalSnakes[seat] = { ...s, length: cutAt, segments: s.segments.slice(0, cutAt) };
    } else {
      finalSnakes[seat] = s;
    }
  }

  // 5. Respawns.
  for (let seat = 0; seat < prev.playerCount; seat++) {
    const s = finalSnakes[seat];
    if (!s.alive && s.deadAtMs !== null && elapsedMs - s.deadAtMs >= RESPAWN_DELAY_MS) {
      const pos = randomPointInArena(arena, rng);
      const heading = rng() * Math.PI * 2;
      finalSnakes[seat] = spawnSnake(seat, pos, heading, s);
    }
  }

  // 6. Food bookkeeping: drop eaten pellets, add drops, top back up to target.
  const food = prev.food.filter((f) => !eaten.has(f.id)).concat(drops);
  while (food.length < FOOD_COUNT_TARGET) {
    food.push(makeFood(foodIdCounter++, randomPointInArena(arena, rng), randomFoodValue(rng), rng));
  }

  const phase = elapsedMs >= MATCH_DURATION_MS ? "gameOver" : "playing";

  return { ...prev, snakes: finalSnakes, food, nextFoodId: foodIdCounter, elapsedMs, phase };
}

// ---------------------------------------------------------------------------
// Bot-takeover steering AI
// ---------------------------------------------------------------------------
// 2026-09-02 맵 확장/봇 대체 세션: 지렁이는 원래 이 프로젝트의 투표 기반
// "이탈 시 봇 대체" 기능(HANDOFF.md 2026-08-29절, `src/games/shared/bot/
// botTakeover.ts`) 대상 6개 게임에 포함돼 있지 않았고, 그 게임들처럼 미리
// 로비에서 채워두는 난이도별(`botLevels`) 봇 좌석 인프라도 지렁이에는 아예
// 없었다(`WormGame.tsx`에 `useBotAutoplay`/`AddBotButton` 자체가 없음). 이번
// 세션에 사용자가 명시적으로 "지렁이도 봇 대체 신규 구현"을 선택해 새로 추가하되,
// 재사용할 기존 난이도 설정이 없으므로 단일 고정 난이도 휴리스틱 하나만 제공—
// 다른 게임들의 티어형 알파베타/몬테카를로 AI와 달리 "매 틱 입력값(각도/부스트)을
// 계산해서 낸다"는 게 이 게임 특유의 연속 조작 모델과 맞는 유일한 형태이기도 하다.
// `stepWorm`처럼 replay 결정성이 필요한 함수가 아니라 — 실제 플레이어의 마우스/
// 조이스틱 입력과 동급의 "매 틱 새로 계산되는 입력값"일 뿐이므로 호스트 클라이언트
// 에서만, 매 틱 최신 상태로 다시 계산해 호출한다(`WormGame.tsx`의 host tick loop).
const BOT_WALL_MARGIN = 260;
const BOT_THREAT_LOOKAHEAD = 140;
const BOT_FOOD_SEARCH_RADIUS = 900;

/**
 * Picks a steering input for a bot-controlled seat: seek the nearest food in
 * range, override toward safety when another snake's body is close ahead,
 * override again (highest priority) to turn back toward the center once near
 * the arena wall, and boost opportunistically when nothing dangerous is
 * nearby. Deliberately simple — this exists to keep a room alive after a
 * disconnect, not to be a competitive opponent.
 */
export function chooseWormBotInput(state: WormState, seat: SeatIndex): SnakeInput {
  const snake = state.snakes[seat];
  if (!snake || !snake.alive) return { angle: 0, boosting: false };
  const head = snake.path[0];
  const arena = state.arena;

  // 1. Seek the nearest food within range; otherwise just hold heading.
  let targetAngle = snake.angle;
  let bestFoodDist = BOT_FOOD_SEARCH_RADIUS;
  for (const food of state.food) {
    const d = dist(head, food);
    if (d < bestFoodDist) {
      bestFoodDist = d;
      targetAngle = Math.atan2(food.y - head.y, food.x - head.x);
    }
  }

  // 2. Steer away from the nearest opposing body segment within a short
  //    lookahead, overriding the food-seeking heading above.
  let nearestThreat: Vec2 | null = null;
  let threatDist = BOT_THREAT_LOOKAHEAD;
  for (let other = 0; other < state.playerCount; other++) {
    if (other === seat) continue;
    const s = state.snakes[other];
    if (!s.alive) continue;
    for (const seg of s.segments) {
      const d = dist(head, seg);
      if (d < threatDist) {
        threatDist = d;
        nearestThreat = seg;
      }
    }
  }
  if (nearestThreat) {
    targetAngle = Math.atan2(head.y - nearestThreat.y, head.x - nearestThreat.x);
  }

  // 3. Wall proximity overrides everything — turn back toward the center.
  const nearLeft = head.x < BOT_WALL_MARGIN;
  const nearRight = head.x > arena.width - BOT_WALL_MARGIN;
  const nearTop = head.y < BOT_WALL_MARGIN;
  const nearBottom = head.y > arena.height - BOT_WALL_MARGIN;
  if (nearLeft || nearRight || nearTop || nearBottom) {
    targetAngle = Math.atan2(arena.height / 2 - head.y, arena.width / 2 - head.x);
  }

  // 4. Boost only when it's safe to (nothing dangerous nearby, not hugging
  //    the wall, long enough to afford the drain, food still a bit away).
  const boosting =
    !nearestThreat && !nearLeft && !nearRight && !nearTop && !nearBottom && snake.length > MIN_LENGTH_TO_BOOST + 4 && bestFoodDist > 200;

  return { angle: normalizeAngle(targetAngle), boosting };
}

// ---------------------------------------------------------------------------
// Leaderboard / final rankings
// ---------------------------------------------------------------------------

export interface LeaderboardEntry {
  seat: SeatIndex;
  length: number;
  score: number;
  alive: boolean;
}

/** Live HUD leaderboard — sorted by current length per the rule doc ("가장 긴 뱀 TOP 5의 닉네임과 길이"). */
export function computeLeaderboard(state: WormState, limit = 5): LeaderboardEntry[] {
  return Object.values(state.snakes)
    .map((s) => ({ seat: s.seat, length: s.length, score: s.score, alive: s.alive }))
    .sort((a, b) => b.length - a.length)
    .slice(0, limit);
}

export interface RankedSeat {
  seat: SeatIndex;
  rank: number;
  score: number;
  bestLength: number;
}

/** Only meaningful once `state.phase === "gameOver"`. Ties share a rank, same competition-ranking convention as five-cucumbers/century. */
export function computeRankings(state: WormState): RankedSeat[] {
  const scored = Array.from({ length: state.playerCount }, (_, seat) => ({
    seat,
    score: state.snakes[seat].score,
    bestLength: state.snakes[seat].bestLength,
  }));
  const sorted = [...scored].sort((a, b) => b.score - a.score || b.bestLength - a.bestLength);
  const ranked: RankedSeat[] = [];
  let rank = 1;
  sorted.forEach((entry, i) => {
    if (i > 0 && (sorted[i - 1].score !== entry.score || sorted[i - 1].bestLength !== entry.bestLength)) rank = i + 1;
    ranked.push({ ...entry, rank });
  });
  return ranked;
}
