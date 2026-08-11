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

export const ARENA_SIZE = 3000;
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

export const FOOD_COUNT_TARGET = 160;
export const FOOD_VALUE_MIN = 1;
export const FOOD_VALUE_MAX = 3;

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

  // 2. Food consumption — head vs. every uneaten pellet, first seat (in seat
  //    order) to reach it this tick wins a simultaneous-arrival tie.
  const eaten = new Set<number>();
  for (let seat = 0; seat < prev.playerCount; seat++) {
    const snake = moved[seat];
    if (!snake.alive) continue;
    for (const food of prev.food) {
      if (eaten.has(food.id)) continue;
      if (dist(snake.path[0], food) < HEAD_RADIUS + FOOD_RADIUS) {
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
    for (let b = 0; b < prev.playerCount; b++) {
      const target = moved[b];
      if (!target.alive || deaths.has(b)) continue;
      const isSelf = a === b;
      if (!isSelf && resolvedPairs.has(a < b ? `${a}-${b}` : `${b}-${a}`)) continue;
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
