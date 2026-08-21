import { describe, expect, it } from "vitest";
import {
  computeLeaderboard,
  computeRankings,
  computeSegments,
  DEFAULT_ARENA,
  FOOD_COUNT_TARGET,
  BOOST_DRAIN_MS,
  MATCH_DURATION_MS,
  MAX_PLAYERS,
  MIN_LENGTH_TO_BOOST,
  MIN_PLAYERS,
  RESPAWN_DELAY_MS,
  SEAT_HUES,
  SEGMENT_SPACING,
  START_LENGTH,
  TURN_RATE,
  normalizeAngle,
  sanitizeInput,
  seededRng,
  startGame,
  stepWorm,
  type FoodItem,
  type SeatIndex,
  type SnakeState,
  type Vec2,
  type WormState,
} from "./engine";
import { detectWormEvents } from "./WormEffects";

/** A straight two-point trail long enough that `computeSegments(path, length, ...)` never has to clamp-duplicate its tail point — real gameplay always has this much history behind a snake's head. */
function straightPath(head: Vec2, headingAngle: number, length: number): Vec2[] {
  const tailDist = length * SEGMENT_SPACING + SEGMENT_SPACING * 2;
  const tail = { x: head.x - Math.cos(headingAngle) * tailDist, y: head.y - Math.sin(headingAngle) * tailDist };
  return [head, tail];
}

function makeSnake(seat: SeatIndex, overrides: Partial<SnakeState> = {}): SnakeState {
  const length = overrides.length ?? START_LENGTH;
  const angle = overrides.angle ?? 0;
  const path = overrides.path ?? straightPath({ x: 100 + seat * 400, y: 100 }, angle, length);
  return {
    seat,
    alive: true,
    angle: 0,
    targetAngle: 0,
    boosting: false,
    speed: 0,
    path,
    segments: computeSegments(path, length, SEGMENT_SPACING),
    length,
    bestLength: length,
    score: 0,
    boostAccumMs: 0,
    deadAtMs: null,
    hue: SEAT_HUES[seat % SEAT_HUES.length],
    ...overrides,
  };
}

function buildState(snakes: SnakeState[], overrides: Partial<WormState> = {}): WormState {
  const map: Record<SeatIndex, SnakeState> = {};
  for (const s of snakes) map[s.seat] = s;
  return {
    playerCount: snakes.length,
    snakes: map,
    food: [],
    nextFoodId: 0,
    elapsedMs: 0,
    arena: DEFAULT_ARENA,
    phase: "playing",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe("startGame — setup", () => {
  it("spawns every seat alive at START_LENGTH and fills the field with food up to the target", () => {
    const state = startGame(4, 1);
    expect(Object.keys(state.snakes)).toHaveLength(4);
    for (let seat = 0; seat < 4; seat++) {
      expect(state.snakes[seat].alive).toBe(true);
      expect(state.snakes[seat].length).toBe(START_LENGTH);
      expect(state.snakes[seat].score).toBe(0);
    }
    expect(state.food).toHaveLength(FOOD_COUNT_TARGET);
    expect(state.phase).toBe("playing");
  });

  it("is deterministic for a given seed", () => {
    expect(startGame(4, 42)).toEqual(startGame(4, 42));
  });

  it("throws for unsupported player counts", () => {
    expect(() => startGame(1, 1)).toThrow();
    expect(() => startGame(MAX_PLAYERS + 1, 1)).toThrow();
    expect(MIN_PLAYERS).toBe(2);
  });
});

describe("computeSegments — path resampling", () => {
  it("places body points at fixed SEGMENT_SPACING intervals along a straight trail", () => {
    const path: Vec2[] = Array.from({ length: 20 }, (_, i) => ({ x: -i * 4, y: 0 }));
    const segments = computeSegments(path, 5, SEGMENT_SPACING);
    expect(segments).toHaveLength(5);
    expect(segments[0].x).toBeCloseTo(0, 10);
    expect(segments[0].y).toBeCloseTo(0, 10);
    for (let i = 1; i < segments.length; i++) {
      const d = Math.hypot(segments[i].x - segments[i - 1].x, segments[i].y - segments[i - 1].y);
      expect(d).toBeCloseTo(SEGMENT_SPACING, 5);
    }
  });

  it("clamps to the last known point when the trail is shorter than needed", () => {
    const path: Vec2[] = [{ x: 0, y: 0 }, { x: -5, y: 0 }];
    const segments = computeSegments(path, 6, SEGMENT_SPACING);
    expect(segments[5]).toEqual(path[path.length - 1]);
  });
});

describe("stepWorm — movement & turning", () => {
  it("integrates the head forward along the current heading by speed * dt", () => {
    const snake = makeSnake(0, { angle: 0, targetAngle: 0 });
    const state = buildState([snake]);
    const result = stepWorm(state, 200, { 0: { angle: 0, boosting: false } }, seededRng(1));
    const head = result.snakes[0].path[0];
    expect(head.x).toBeGreaterThan(snake.path[0].x);
    expect(head.y).toBeCloseTo(snake.path[0].y, 1);
  });

  it("turns toward the input angle at a bounded rate rather than snapping instantly", () => {
    const snake = makeSnake(0, { angle: 0, targetAngle: 0 });
    const state = buildState([snake]);
    const dtMs = 40;
    const result = stepWorm(state, dtMs, { 0: { angle: Math.PI, boosting: false } }, seededRng(1));
    const maxTurn = TURN_RATE * (dtMs / 1000);
    expect(result.snakes[0].angle).toBeCloseTo(maxTurn, 5);
    expect(result.snakes[0].angle).not.toBeCloseTo(Math.PI, 1);
  });

  it("a snake with no input this tick keeps its previous target angle and keeps moving", () => {
    const snake = makeSnake(0, { angle: 0, targetAngle: 0 });
    const state = buildState([snake]);
    const result = stepWorm(state, 100, {}, seededRng(1));
    expect(result.snakes[0].targetAngle).toBe(0);
    expect(result.snakes[0].path[0].x).toBeGreaterThan(snake.path[0].x);
  });

  it("a dead snake does not move and stays dead before its respawn delay elapses", () => {
    const snake = makeSnake(0, { alive: false, deadAtMs: 0, path: [], segments: [] });
    const state = buildState([snake]);
    const result = stepWorm(state, 100, { 0: { angle: 0, boosting: false } }, seededRng(1));
    expect(result.snakes[0].alive).toBe(false);
  });

  it("respawns a dead snake once RESPAWN_DELAY_MS has elapsed, keeping score/bestLength", () => {
    const snake = makeSnake(0, { alive: false, deadAtMs: 0, path: [], segments: [], score: 500, bestLength: 40 });
    const state = buildState([snake]);
    const result = stepWorm(state, RESPAWN_DELAY_MS + 10, { 0: { angle: 0, boosting: false } }, seededRng(1));
    expect(result.snakes[0].alive).toBe(true);
    expect(result.snakes[0].length).toBe(START_LENGTH);
    expect(result.snakes[0].score).toBe(500);
    expect(result.snakes[0].bestLength).toBe(40);
  });
});

describe("stepWorm — food", () => {
  it("eating a pellet grows length/score, removes it, and backfills the food count to the target", () => {
    const snake = makeSnake(0, { path: [{ x: 100, y: 100 }, { x: 84, y: 100 }], angle: 0, targetAngle: 0 });
    const food: FoodItem[] = [{ id: 1, x: 102, y: 100, value: 3, hue: 0 }];
    const state = buildState([snake], { food, nextFoodId: 2 });
    const result = stepWorm(state, 16, { 0: { angle: 0, boosting: false } }, seededRng(7));
    expect(result.snakes[0].length).toBe(START_LENGTH + 3);
    expect(result.snakes[0].score).toBe(30);
    expect(result.food.some((f) => f.id === 1)).toBe(false);
    expect(result.food).toHaveLength(FOOD_COUNT_TARGET);
  });
});

describe("stepWorm — boost", () => {
  it("boosting drains a segment every BOOST_DRAIN_MS and drops food behind the tail", () => {
    const snake = makeSnake(0, { length: 20, bestLength: 20 });
    const food: FoodItem[] = Array.from({ length: FOOD_COUNT_TARGET }, (_, i) => ({ id: i, x: 10, y: 10, value: 1, hue: 0 }));
    const state = buildState([snake], { food, nextFoodId: FOOD_COUNT_TARGET });
    const result = stepWorm(state, BOOST_DRAIN_MS * 3, { 0: { angle: 0, boosting: true } }, seededRng(1));
    expect(result.snakes[0].length).toBe(17);
    expect(result.food).toHaveLength(FOOD_COUNT_TARGET + 3);
  });

  it("ignores the boost flag (no speed bonus, no drain) once length is at or below MIN_LENGTH_TO_BOOST", () => {
    const snake = makeSnake(0, { length: MIN_LENGTH_TO_BOOST });
    const state = buildState([snake]);
    const result = stepWorm(state, 500, { 0: { angle: 0, boosting: true } }, seededRng(1));
    expect(result.snakes[0].boosting).toBe(false);
    expect(result.snakes[0].length).toBe(MIN_LENGTH_TO_BOOST);
  });
});

describe("stepWorm — arena boundary", () => {
  it("a head crossing the arena edge kills the snake and drops its body as food", () => {
    const arena = { width: 200, height: 200 };
    const snake = makeSnake(0, { path: [{ x: 195, y: 100 }, { x: 179, y: 100 }], angle: 0, targetAngle: 0 });
    const state = buildState([snake], { arena });
    const result = stepWorm(state, 100, { 0: { angle: 0, boosting: false } }, seededRng(3));
    expect(result.snakes[0].alive).toBe(false);
    expect(result.snakes[0].deadAtMs).toBe(100);
    expect(result.food.length).toBeGreaterThan(0);
  });
});

describe("stepWorm — collisions (boardGameRule/지렁이/지렁이.md §2(2))", () => {
  it("head-to-head: the longer snake survives untouched, the shorter one dies and drops everything", () => {
    const long = makeSnake(0, { path: straightPath({ x: 100, y: 100 }, 0, 15), length: 15, angle: 0, targetAngle: 0 });
    const short = makeSnake(1, { path: straightPath({ x: 100, y: 100 }, Math.PI, 8), length: 8, angle: Math.PI, targetAngle: Math.PI });
    const state = buildState([long, short]);
    const result = stepWorm(state, 10, { 0: { angle: 0, boosting: false }, 1: { angle: Math.PI, boosting: false } }, seededRng(1));
    expect(result.snakes[1].alive).toBe(false);
    expect(result.snakes[0].alive).toBe(true);
    expect(result.snakes[0].length).toBe(15);
  });

  it("head-to-head tie (equal length): neither dies, each loses exactly one segment", () => {
    const a = makeSnake(0, { path: straightPath({ x: 100, y: 100 }, 0, 10), length: 10, angle: 0, targetAngle: 0 });
    const b = makeSnake(1, { path: straightPath({ x: 100, y: 100 }, Math.PI, 10), length: 10, angle: Math.PI, targetAngle: Math.PI });
    const state = buildState([a, b]);
    const result = stepWorm(state, 10, { 0: { angle: 0, boosting: false }, 1: { angle: Math.PI, boosting: false } }, seededRng(1));
    expect(result.snakes[0].alive).toBe(true);
    expect(result.snakes[1].alive).toBe(true);
    expect(result.snakes[0].length).toBe(9);
    expect(result.snakes[1].length).toBe(9);
  });

  it("head-vs-opponent-body: cuts the victim's tail at the hit point (dropped as food) without harming the attacker", () => {
    // Kept comfortably inside DEFAULT_ARENA (starts at x=0,y=0) — negative
    // coordinates here would trigger the wall-death check instead.
    const victimHead = { x: 1000, y: 1000 };
    const victimPath: Vec2[] = Array.from({ length: 10 }, (_, i) => ({ x: victimHead.x - i * SEGMENT_SPACING, y: victimHead.y }));
    const victim = makeSnake(1, { path: victimPath, length: 8, angle: 0, targetAngle: 0 });
    // Attacker's head sits right on top of one of the victim's mid-body segments.
    const attacker = makeSnake(0, {
      path: straightPath(victimPath[4], Math.PI / 2, 8),
      length: 8,
      angle: Math.PI / 2,
      targetAngle: Math.PI / 2,
    });
    const state = buildState([attacker, victim]);
    const result = stepWorm(state, 5, { 0: { angle: Math.PI / 2, boosting: false }, 1: { angle: 0, boosting: false } }, seededRng(2));
    expect(result.snakes[0].alive).toBe(true);
    expect(result.snakes[0].length).toBe(8);
    expect(result.snakes[1].alive).toBe(true);
    expect(result.snakes[1].length).toBeLessThan(8);
    expect(result.snakes[1].length).toBeGreaterThan(0);
    expect(result.food.length).toBeGreaterThan(0);
  });

  it("self-collision: a head hitting its own body beyond the near-head skip zone kills it", () => {
    const length = 20;
    const totalPathLen = length * SEGMENT_SPACING;
    const radius = totalPathLen / (Math.PI * 2);
    const points = 60;
    const path: Vec2[] = Array.from({ length: points }, (_, i) => {
      const theta = (i / points) * Math.PI * 2;
      return { x: radius * Math.cos(theta), y: radius * Math.sin(theta) };
    });
    // Tangent heading at theta=0 for this counter-clockwise parametrization is straight "down" (angle = PI/2).
    const snake = makeSnake(0, { path, length, angle: Math.PI / 2, targetAngle: Math.PI / 2 });
    const state = buildState([snake]);
    const result = stepWorm(state, 1, { 0: { angle: Math.PI / 2, boosting: false } }, seededRng(1));
    expect(result.snakes[0].alive).toBe(false);
  });
});

describe("stepWorm — match end", () => {
  it("flips to gameOver once MATCH_DURATION_MS has elapsed, and further steps become no-ops", () => {
    const snake = makeSnake(0);
    const state = buildState([snake], { elapsedMs: MATCH_DURATION_MS - 10 });
    const result = stepWorm(state, 20, { 0: { angle: 0, boosting: false } }, seededRng(1));
    expect(result.phase).toBe("gameOver");
    const again = stepWorm(result, 100, { 0: { angle: 0, boosting: false } }, seededRng(1));
    expect(again).toBe(result);
  });
});

describe("computeRankings / computeLeaderboard", () => {
  it("ranks by cumulative score desc, ties broken by bestLength, sharing rank numbers", () => {
    const state = buildState([
      makeSnake(0, { score: 100, bestLength: 30 }),
      makeSnake(1, { score: 100, bestLength: 40 }),
      makeSnake(2, { score: 50, bestLength: 60 }),
    ]);
    const ranked = computeRankings(state);
    expect(ranked.find((r) => r.seat === 1)!.rank).toBe(1);
    expect(ranked.find((r) => r.seat === 0)!.rank).toBe(2);
    expect(ranked.find((r) => r.seat === 2)!.rank).toBe(3);
  });

  it("computeLeaderboard returns the top N seats sorted by current length", () => {
    const state = buildState([makeSnake(0, { length: 10 }), makeSnake(1, { length: 50 }), makeSnake(2, { length: 30 })]);
    const board = computeLeaderboard(state, 2);
    expect(board.map((b) => b.seat)).toEqual([1, 2]);
  });
});

describe("sanitizeInput", () => {
  it("accepts a well-formed payload and normalizes the angle into (-PI, PI]", () => {
    const result = sanitizeInput({ angle: Math.PI * 3, boosting: 1 });
    expect(result).not.toBeNull();
    expect(result!.boosting).toBe(true);
    expect(result!.angle).toBeGreaterThan(-Math.PI);
    expect(result!.angle).toBeLessThanOrEqual(Math.PI);
  });

  it("rejects malformed payloads as a no-op-friendly null", () => {
    expect(sanitizeInput(null)).toBeNull();
    expect(sanitizeInput(42)).toBeNull();
    expect(sanitizeInput({ angle: "east" })).toBeNull();
    expect(sanitizeInput({ angle: Number.NaN })).toBeNull();
  });
});

describe("normalizeAngle", () => {
  it("wraps any angle into (-PI, PI]", () => {
    expect(normalizeAngle(0)).toBeCloseTo(0, 10);
    expect(normalizeAngle(Math.PI * 2)).toBeCloseTo(0, 5);
    expect(normalizeAngle(-Math.PI * 3)).toBeCloseTo(Math.PI, 5);
  });
});

// ---------------------------------------------------------------------------
// detectWormEvents (WormEffects.ts) — the client-local snapshot diff that
// drives the FX layer. Pure and deterministic given two states, so it's
// tested the same way as the engine itself even though it lives outside it.
// ---------------------------------------------------------------------------

describe("detectWormEvents", () => {
  it("emits an eat event sized to the score delta when a still-alive snake's score rises", () => {
    const before = buildState([makeSnake(0, { score: 0 })]);
    const after = buildState([makeSnake(0, { score: 20 })]);
    const events = detectWormEvents(before, after);
    expect(events).toEqual([{ type: "eat", seat: 0, pos: after.snakes[0].path[0], value: 20, hue: after.snakes[0].hue }]);
  });

  it("does not emit an eat event when score is unchanged", () => {
    const before = buildState([makeSnake(0, { score: 10 })]);
    const after = buildState([makeSnake(0, { score: 10 })]);
    expect(detectWormEvents(before, after)).toEqual([]);
  });

  it("does not treat a single-segment boost drain as a cut", () => {
    const before = buildState([makeSnake(0, { length: 10 })]);
    const after = buildState([makeSnake(0, { length: 9 })]);
    expect(detectWormEvents(before, after)).toEqual([]);
  });

  it("emits a cut event (with no attacker) when length drops by more than one and no other snake's head is nearby", () => {
    const before = buildState([makeSnake(0, { length: 10 })]);
    const after = buildState([makeSnake(0, { length: 4 })]);
    const events = detectWormEvents(before, after);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "cut", targetSeat: 0, attackerSeat: null });
  });

  it("attributes a cut to the nearest other alive head within striking distance", () => {
    const target = makeSnake(0, { length: 10 });
    const cutPos = target.segments[4];
    const attacker = makeSnake(1, { path: [{ x: cutPos.x + 5, y: cutPos.y }, { x: cutPos.x - 400, y: cutPos.y }] });
    const bystander = makeSnake(2, { path: [{ x: cutPos.x + 2000, y: cutPos.y }, { x: cutPos.x + 1600, y: cutPos.y }] });
    const before = buildState([target, attacker, bystander]);
    const after = buildState([makeSnake(0, { length: 4 }), attacker, bystander]);
    const events = detectWormEvents(before, after);
    const cut = events.find((e) => e.type === "cut");
    expect(cut).toMatchObject({ targetSeat: 0, attackerSeat: 1 });
  });

  it("classifies a death near the arena boundary as a wall death", () => {
    const before = buildState([makeSnake(0, { path: [{ x: 3, y: 500 }, { x: 20, y: 500 }] })]);
    const after = buildState([makeSnake(0, { alive: false, deadAtMs: 0, path: [], segments: [] })]);
    const events = detectWormEvents(before, after);
    expect(events).toEqual([expect.objectContaining({ type: "death", seat: 0, cause: "wall" })]);
  });

  it("classifies a death next to another surviving head as a head-vs-head death", () => {
    const dead = makeSnake(0, { path: [{ x: 500, y: 500 }, { x: 520, y: 500 }] });
    const winner = makeSnake(1, { path: [{ x: 510, y: 500 }, { x: 900, y: 500 }] });
    const before = buildState([dead, winner]);
    const after = buildState([makeSnake(0, { alive: false, deadAtMs: 0, path: [], segments: [] }), winner]);
    const events = detectWormEvents(before, after);
    expect(events).toEqual([expect.objectContaining({ type: "death", seat: 0, cause: "head" })]);
  });

  it("falls back to a self-destruct death when neither the wall nor another head explains it", () => {
    const before = buildState([makeSnake(0, { path: [{ x: 1500, y: 1500 }, { x: 1520, y: 1500 }] })]);
    const after = buildState([makeSnake(0, { alive: false, deadAtMs: 0, path: [], segments: [] })]);
    const events = detectWormEvents(before, after);
    expect(events).toEqual([expect.objectContaining({ type: "death", seat: 0, cause: "self" })]);
  });

  it("carries the pre-death segments through so corpse-scatter FX has something to animate", () => {
    const snake = makeSnake(0, { length: 6 });
    const before = buildState([snake]);
    const after = buildState([makeSnake(0, { alive: false, deadAtMs: 0, path: [], segments: [] })]);
    const events = detectWormEvents(before, after);
    expect(events[0]).toMatchObject({ type: "death", segments: snake.segments });
  });
});
