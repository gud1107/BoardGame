/**
 * Pure "볼링 난장판(Bowling Mayhem)" rules engine — no React, no I/O.
 * Implements boardGameRule/볼링난장판/볼링난장판.md (section numbers below
 * refer to it): ten-pin scoring over 3/5/10 frames, a 🎲 lane twist per frame
 * (§7) and sabotage items (§8).
 *
 * Lockstep like every other online game here: every client replays the same
 * seeded state + `EngineAction`s. A `roll` carries the release as integers
 * (mm, mm/s, milli-spin); the pinfall comes from the deterministic physics
 * in physics.ts, so no client ever reports a result.
 */

import { seededRng } from "@/lib/rng";
import { tallyAdd, tallyMax, tallyOf, type StatTally } from "@/games/shared/statTally";
import { BALL_M, BALL_R, defaultSetup, HALF_W, MAX_SLOPE, PIN_M, PIN_R, RACK, rackNeighbours, simulate, TOPPLE, V_MAX, V_MIN, type LaneSetup } from "./physics";

export type Seat = number;

export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 6;
/** §4 */
export const AIM_TIMEOUT_MS = 30_000;
export const FRAME_CHOICES = [3, 5, 10] as const;
export type FrameCount = (typeof FRAME_CHOICES)[number];
/** §8 — most items a player can hold. */
export const MAX_ITEMS = 2;

export interface GameOptions {
  frames: FrameCount;
  /** §7 — lane twists on. */
  chaos: boolean;
  /** §8 — sabotage items on. */
  items: boolean;
  /** §4 — 🔰 show the whole predicted path while aiming. */
  helper: boolean;
}

export const DEFAULT_OPTIONS: GameOptions = { frames: 5, chaos: true, items: true, helper: false };

// ---------------------------------------------------------------------------
// Lane twists (§7) and items (§8)
// ---------------------------------------------------------------------------

export type LaneMod = "normal" | "ice" | "bumpers" | "giantPins" | "featherPins" | "wind" | "shuffle" | "giantBall";

export const LANE_MODS: Record<LaneMod, { icon: string; name: string; desc: string }> = {
  normal: { icon: "🎳", name: "정통 레인", desc: "아무 일도 없는 평범한 레인" },
  ice: { icon: "🧊", name: "얼음 레인", desc: "공이 덜 휘고, 핀이 멀리 미끄러져요" },
  bumpers: { icon: "🧱", name: "범퍼 레인", desc: "양옆 범퍼가 공을 튕겨 줘요 — 거터 없음" },
  giantPins: { icon: "🗿", name: "거인 핀", desc: "핀이 1.4배 뚱뚱해져서 잘 맞아요" },
  featherPins: { icon: "🪶", name: "깃털 핀", desc: "가벼운 핀이 살짝만 스쳐도 날아가요" },
  wind: { icon: "💨", name: "옆바람", desc: "레인 전체에 한쪽으로 바람이 불어요" },
  shuffle: { icon: "🔀", name: "삐뚤빼뚤 핀", desc: "핀이 제자리에서 조금씩 어긋나 있어요" },
  giantBall: { icon: "🌕", name: "왕 볼", desc: "공이 1.5배 커지고 무거워져요" },
};

export type ItemKind = "cone" | "oil" | "fan" | "bumper";

export const ITEMS: Record<ItemKind, { icon: string; name: string; desc: string; self: boolean }> = {
  cone: { icon: "🚧", name: "고깔", desc: "상대 레인 한가운데쯤에 고깔을 세워요 — 공이 맞으면 튕겨 나가요", self: false },
  oil: { icon: "🛢️", name: "기름 웅덩이", desc: "상대 레인 뒤쪽에 기름 — 거기선 공이 반대로 휘어요", self: false },
  fan: { icon: "🌬️", name: "선풍기", desc: "상대 차례 내내 한쪽으로 센 바람", self: false },
  bumper: { icon: "🍀", name: "행운 범퍼", desc: "이번 내 프레임에 범퍼를 세워요 — 거터 걱정 끝", self: true },
};
export const ITEM_KINDS = Object.keys(ITEMS) as ItemKind[];

export interface Hazard {
  kind: "cone" | "oil" | "fan";
  from: Seat;
  /** cone */
  x?: number;
  y?: number;
  /** oil */
  y0?: number;
  y1?: number;
  /** fan: +1 blows right, −1 left */
  dir?: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** One resolved roll — the board replays it from `setup` (keyed by `turn`). */
export interface RollRecord {
  turn: number;
  seat: Seat;
  frame: number;
  /** Ball within the frame (0, 1, 2 in the last frame). */
  ball: number;
  x: number;
  vx: number;
  vy: number;
  spin: number;
  /** Lane the roll ran on (standing pins + modifiers + hazards). */
  setup: LaneSetup;
  mod: LaneMod;
  hazards: Hazard[];
  /** Pin ids knocked down. */
  down: number[];
  gutter: boolean;
  /** Ran out of time — a foul, 0 pins, no replay. */
  foul: boolean;
  strike: boolean;
  spare: boolean;
  /** Split left standing after this ball. */
  split: boolean;
  /** Converted a split into a spare. */
  splitConverted: boolean;
  /** Consecutive strikes for this seat after this ball. */
  streak: number;
  /** The frame (or the game) is done for this seat after this ball. */
  frameDone: boolean;
  steps: number;
}

export interface ItemRecord {
  turn: number;
  seat: Seat;
  kind: ItemKind;
  target: Seat;
}

export type Phase = "aim" | "ended";

export interface BowlingState {
  seed: number;
  playerCount: number;
  options: GameOptions;
  frame: number;
  activeSeat: Seat;
  /** Ball within the current frame. */
  ball: number;
  /** Pin ids still standing. */
  standing: number[];
  /** Pin positions for this frame turn (shuffle twist moves them). */
  rack: { id: number; x: number; y: number }[];
  laneMods: LaneMod[];
  /** Wind side per frame (only used by the 💨 twist). */
  windDirs: number[];
  /** rolls[seat][frame] = pins per ball. */
  rolls: number[][][];
  items: ItemKind[][];
  /** Hazards waiting for each seat's next frame. */
  pending: Hazard[][];
  /** Hazards on the current frame turn. */
  active: Hazard[];
  selfBumper: boolean;
  itemUsed: boolean;
  /** Was a split standing after the first ball of this frame turn. */
  splitOpen: boolean;
  streak: number[];
  phase: Phase;
  /** Monotonic action counter — animation key and stale-timeout guard. */
  turn: number;
  lastRoll: RollRecord | null;
  lastItem: ItemRecord | null;
  /** Items handed out at the end of a frame (§8 comeback), for the HUD. */
  lastGift: { turn: number; seats: Seat[]; kinds: ItemKind[] } | null;
  statTally?: StatTally;
}

export type EngineAction =
  | { type: "roll"; seat: Seat; x: number; vx: number; vy: number; spin: number }
  | { type: "item"; seat: Seat; kind: ItemKind; target: Seat }
  | { type: "timeout"; seat: Seat; turn: number };

// ---------------------------------------------------------------------------
// Setup (§3, §7)
// ---------------------------------------------------------------------------

const TWISTS: LaneMod[] = ["ice", "bumpers", "giantPins", "featherPins", "wind", "shuffle", "giantBall"];

/** §7 — frame 1 is always a plain lane; later frames roll a twist (sometimes none), never the same twice in a row. */
export function rollLaneMods(seed: number, frames: number, chaos: boolean): { mods: LaneMod[]; wind: number[] } {
  const rng = seededRng(seed ^ 0x6b1a7e);
  const mods: LaneMod[] = [];
  const wind: number[] = [];
  for (let f = 0; f < frames; f++) {
    wind.push(rng() < 0.5 ? -1 : 1);
    if (!chaos || f === 0) {
      mods.push("normal");
      continue;
    }
    // the last frame always has a twist — a finale
    if (f < frames - 1 && rng() < 0.2) {
      mods.push("normal");
      continue;
    }
    const pool = TWISTS.filter((m) => m !== mods[f - 1]);
    mods.push(pool[Math.floor(rng() * pool.length)]);
  }
  return { mods, wind };
}

/** Rack positions for a frame turn — the 🔀 twist jitters them (§7). */
export function rackFor(seed: number, frame: number, seat: Seat, mod: LaneMod): { id: number; x: number; y: number }[] {
  if (mod !== "shuffle") return RACK.map((p) => ({ ...p }));
  const rng = seededRng((seed ^ 0x2f3d) + frame * 977 + seat * 131);
  return RACK.map((p) => ({ id: p.id, x: Math.round((p.x + (rng() - 0.5) * 0.15) * 1000) / 1000, y: Math.round((p.y + (rng() - 0.5) * 0.14) * 1000) / 1000 }));
}

function giveItem(rng: () => number): ItemKind {
  return ITEM_KINDS[Math.floor(rng() * ITEM_KINDS.length)];
}

export function startGame(playerCount: number, seed: number, options: Partial<GameOptions> = DEFAULT_OPTIONS): BowlingState {
  const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.floor(playerCount)));
  const opts: GameOptions = { ...DEFAULT_OPTIONS, ...options };
  if (!FRAME_CHOICES.includes(opts.frames)) opts.frames = DEFAULT_OPTIONS.frames;
  const { mods, wind } = rollLaneMods(seed, opts.frames, opts.chaos);
  const rng = seededRng(seed ^ 0x1735);
  const items: ItemKind[][] = Array.from({ length: n }, () => (opts.items && n > 1 ? [giveItem(rng)] : []));
  return {
    seed,
    playerCount: n,
    options: opts,
    frame: 0,
    activeSeat: 0,
    ball: 0,
    standing: RACK.map((p) => p.id),
    rack: rackFor(seed, 0, 0, mods[0]),
    laneMods: mods,
    windDirs: wind,
    rolls: Array.from({ length: n }, () => Array.from({ length: opts.frames }, () => [])),
    items,
    pending: Array.from({ length: n }, () => []),
    active: [],
    selfBumper: false,
    itemUsed: false,
    splitOpen: false,
    streak: Array(n).fill(0),
    phase: "aim",
    turn: 0,
    lastRoll: null,
    lastItem: null,
    lastGift: null,
  };
}

// ---------------------------------------------------------------------------
// Scoring (§5)
// ---------------------------------------------------------------------------

export interface FrameScore {
  /** Marks to print in the frame's boxes: "X", "/", "-", "F"(oul) or a digit. */
  marks: string[];
  /** Running total once the frame's bonus balls are known, else null. */
  total: number | null;
}

/** Ten-pin scoring for one player's frames; the last frame is the "10th" (up to 3 balls). */
export function scoreFrames(frames: readonly (readonly number[])[], fouls?: ReadonlySet<string>): FrameScore[] {
  const F = frames.length;
  const flat: number[] = [];
  const startAt: number[] = [];
  for (let f = 0; f < F; f++) {
    startAt.push(flat.length);
    flat.push(...frames[f]);
  }
  const out: FrameScore[] = [];
  let running = 0;
  let known = true;
  for (let f = 0; f < F; f++) {
    const r = frames[f];
    const i = startAt[f];
    const last = f === F - 1;
    const marks: string[] = [];
    const mark = (pins: number, ballIdx: number) => (fouls?.has(`${f}:${ballIdx}`) ? "F" : pins === 0 ? "-" : String(pins));
    if (!last) {
      if (r[0] === 10) marks.push("X");
      else {
        if (r.length > 0) marks.push(mark(r[0], 0));
        if (r.length > 1) marks.push(r[0] + r[1] === 10 ? "/" : mark(r[1], 1));
      }
    } else {
      let rackLeft = 10;
      for (let b = 0; b < r.length; b++) {
        const p = r[b];
        if (p === rackLeft && rackLeft === 10) marks.push("X");
        else if (p === rackLeft) marks.push("/");
        else marks.push(mark(p, b));
        rackLeft = p === rackLeft ? 10 : rackLeft - p;
      }
    }
    let value: number | null = null;
    if (!last) {
      if (r[0] === 10) value = flat.length >= i + 3 ? 10 + flat[i + 1] + flat[i + 2] : null;
      else if (r.length >= 2 && r[0] + r[1] === 10) value = flat.length >= i + 3 ? 10 + flat[i + 2] : null;
      else if (r.length >= 2) value = r[0] + r[1];
    } else {
      const done = r.length === 3 || (r.length === 2 && r[0] + r[1] < 10);
      value = done ? r.reduce((a, b) => a + b, 0) : null;
    }
    if (value === null) known = false;
    if (known && value !== null) {
      running += value;
      out.push({ marks, total: running });
    } else out.push({ marks, total: null });
  }
  return out;
}

/** Score so far, counting unfinished bonus balls as they stand (for live rankings and the HUD). */
export function runningScore(frames: readonly (readonly number[])[]): number {
  const F = frames.length;
  const flat: number[] = [];
  const startAt: number[] = [];
  for (let f = 0; f < F; f++) {
    startAt.push(flat.length);
    flat.push(...frames[f]);
  }
  let total = 0;
  for (let f = 0; f < F; f++) {
    const r = frames[f];
    const i = startAt[f];
    if (f === F - 1) {
      total += r.reduce((a, b) => a + b, 0);
      continue;
    }
    if (r.length === 0) break;
    if (r[0] === 10) total += 10 + (flat[i + 1] ?? 0) + (flat[i + 2] ?? 0);
    else if (r.length >= 2 && r[0] + r[1] === 10) total += 10 + (flat[i + 2] ?? 0);
    else total += r.reduce((a, b) => a + b, 0);
  }
  return total;
}

/** Best possible final score from here (every remaining ball a strike) — for "아직 역전 가능" hints. */
export function maxPossible(frames: readonly (readonly number[])[]): number {
  const F = frames.length;
  const copy = frames.map((r) => [...r]);
  // fill the rest with strikes
  for (let f = 0; f < F; f++) {
    const r = copy[f];
    const last = f === F - 1;
    if (!last) {
      if (r.length === 0) r.push(10);
      else if (r.length === 1 && r[0] !== 10) r.push(10 - r[0]);
    } else {
      while (true) {
        const left = lastFrameRackLeft(r);
        const done = r.length === 3 || (r.length === 2 && r[0] + r[1] < 10);
        if (done) break;
        r.push(left);
      }
    }
  }
  return scoreFrames(copy)[F - 1]?.total ?? 0;
}

function lastFrameRackLeft(r: readonly number[]): number {
  let left = 10;
  for (const p of r) left = p === left ? 10 : left - p;
  return left;
}

export function totalOf(state: Pick<BowlingState, "rolls">, seat: Seat): number {
  return runningScore(state.rolls[seat] ?? []);
}

/** "frame:ball" keys of this seat's fouls (time-outs), to print "F" on the sheet. */
export function foulsOf(state: Pick<BowlingState, "statTally">, seat: Seat): Set<string> {
  return new Set(Object.keys(tallyOf(state.statTally, seat)).filter((k) => k.startsWith("foul@")).map((k) => k.slice(5)));
}

// ---------------------------------------------------------------------------
// Lane setup for the current ball
// ---------------------------------------------------------------------------

/** Physics setup for a ball on `mod` with these hazards and pins (§6–§8). */
export function laneSetup(pins: LaneSetup["pins"], mod: LaneMod, wind: number, hazards: readonly Hazard[], selfBumper: boolean): LaneSetup {
  const s = defaultSetup(pins);
  switch (mod) {
    case "ice":
      s.hookMul = 0.4;
      s.ballFriction = 0.06;
      s.pinFriction = 2.2;
      break;
    case "bumpers":
      s.bumpers = true;
      break;
    case "giantPins":
      s.pinR = PIN_R * 1.4;
      s.pinM = PIN_M * 1.3;
      break;
    case "featherPins":
      s.pinM = PIN_M * 0.45;
      s.topple = TOPPLE * 0.5;
      s.pinFriction = 3.6;
      break;
    case "wind":
      s.wind = 0.32 * wind;
      break;
    case "giantBall":
      s.ballR = BALL_R * 1.5;
      s.ballM = BALL_M * 1.35;
      break;
    default:
      break;
  }
  for (const h of hazards) {
    if (h.kind === "cone") s.cones.push({ x: h.x ?? 0, y: h.y ?? 11, r: 0.085 });
    else if (h.kind === "oil") s.oil = { y0: h.y0 ?? 11, y1: h.y1 ?? 15 };
    else if (h.kind === "fan") s.wind += 0.42 * (h.dir ?? 1);
  }
  if (selfBumper) s.bumpers = true;
  return s;
}

export function currentSetup(state: BowlingState): LaneSetup {
  const pins = state.rack.filter((p) => state.standing.includes(p.id));
  return laneSetup(pins, state.laneMods[state.frame] ?? "normal", state.windDirs[state.frame] ?? 1, state.active, state.selfBumper);
}

/** Release limits for the current ball (the 🌕 twist narrows the approach). */
export function releaseLimit(state: BowlingState): number {
  const s = currentSetup(state);
  return HALF_W - s.ballR;
}

/** Quantized release the action carries (mm, mm/s, milli-spin), clamped to the legal range. */
export function quantizeRoll(x: number, vx: number, vy: number, spin: number): { x: number; vx: number; vy: number; spin: number } {
  const c = clampRelease(x, vx, vy, spin);
  return { x: Math.round(c.x * 1000), vx: Math.round(c.vx * 1000), vy: Math.round(c.vy * 1000), spin: Math.round(c.spin * 1000) };
}

function clampRelease(x: number, vx: number, vy: number, spin: number) {
  const lim = HALF_W - 0.05;
  let cvy = Math.max(V_MIN * 0.98, Math.min(V_MAX, Number.isFinite(vy) ? vy : V_MIN));
  let cvx = Number.isFinite(vx) ? vx : 0;
  if (Math.abs(cvx) > cvy * MAX_SLOPE) cvx = Math.sign(cvx) * cvy * MAX_SLOPE;
  const s = Math.sqrt(cvx * cvx + cvy * cvy);
  if (s > V_MAX) {
    cvx = (cvx * V_MAX) / s;
    cvy = (cvy * V_MAX) / s;
  }
  return { x: Math.max(-lim, Math.min(lim, Number.isFinite(x) ? x : 0)), vx: cvx, vy: cvy, spin: Math.max(-1, Math.min(1, Number.isFinite(spin) ? spin : 0)) };
}

/** The release an action stands for (integers → metres, clamped). */
export function releaseOf(a: { x: number; vx: number; vy: number; spin: number }): { x: number; vx: number; vy: number; spin: number } {
  return clampRelease(a.x / 1000, a.vx / 1000, a.vy / 1000, a.spin / 1000);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** A split (§5): the head pin is down and what's left falls into separate groups. */
export function isSplit(standing: readonly number[]): boolean {
  if (standing.includes(0) || standing.length < 2) return false;
  const left = new Set(standing);
  const seen = new Set<number>();
  const stack = [standing[0]];
  while (stack.length) {
    const p = stack.pop()!;
    if (seen.has(p)) continue;
    seen.add(p);
    for (const q of left) if (!seen.has(q) && rackNeighbours(p, q)) stack.push(q);
  }
  return seen.size < left.size;
}

function isLastFrame(state: BowlingState): boolean {
  return state.frame === state.options.frames - 1;
}

/** Applies a pinfall for the active seat and moves the game on. */
function finishBall(state: BowlingState, seat: Seat, down: number[], rec: Omit<RollRecord, "down" | "strike" | "spare" | "split" | "splitConverted" | "streak" | "frameDone"> | null): BowlingState {
  const count = down.length;
  const rolls = state.rolls.map((r) => r.map((b) => [...b]));
  const mine = rolls[seat][state.frame];
  mine.push(count);
  const standing = state.standing.filter((id) => !down.includes(id));
  const last = isLastFrame(state);
  const fullRack = state.standing.length === 10;
  const strike = fullRack && count === 10;
  const spare = !fullRack && standing.length === 0;
  const split = !strike && fullRack && isSplit(standing);
  const splitConverted = spare && state.splitOpen;
  const streak = [...state.streak];
  streak[seat] = strike ? streak[seat] + 1 : 0;

  let tally = state.statTally;
  tally = tallyAdd(tally, seat, "rolls");
  if (strike) tally = tallyAdd(tally, seat, "strikes");
  if (spare) tally = tallyAdd(tally, seat, "spares");
  if (rec?.gutter) tally = tallyAdd(tally, seat, "gutters");
  if (rec?.foul) tally = tallyAdd(tally, seat, `foul@${state.frame}:${state.ball}`);
  if (split) tally = tallyAdd(tally, seat, "splits");
  if (splitConverted) tally = tallyAdd(tally, seat, "splitsConverted");
  if (strike && streak[seat] === 3) tally = tallyAdd(tally, seat, "turkeys");
  tally = tallyMax(tally, seat, "maxStreak", streak[seat]);
  if (state.active.length > 0 && (strike || spare)) tally = tallyAdd(tally, seat, "hazardBeaten");

  // what happens next in this frame
  let frameDone: boolean;
  let nextStanding = standing;
  if (!last) {
    frameDone = strike || state.ball === 1;
  } else {
    const r = mine;
    frameDone = r.length === 3 || (r.length === 2 && r[0] + r[1] < 10);
    // a fresh rack after a strike / spare in the last frame
    if (!frameDone && standing.length === 0) nextStanding = RACK.map((p) => p.id);
  }

  const record: RollRecord | null = rec ? { ...rec, down, strike, spare, split, splitConverted, streak: streak[seat], frameDone } : null;
  let next: BowlingState = {
    ...state,
    rolls,
    standing: nextStanding,
    ball: state.ball + 1,
    splitOpen: fullRack ? split : state.splitOpen && !spare,
    streak,
    turn: state.turn + 1,
    lastRoll: record,
    statTally: tally,
  };
  if (frameDone) next = advanceTurn(next);
  return next;
}

/** Next seat (and frame); hands out comeback items at the end of a frame (§8). */
function advanceTurn(state: BowlingState): BowlingState {
  let seat = state.activeSeat + 1;
  let frame = state.frame;
  let items = state.items;
  let gift: BowlingState["lastGift"] = state.lastGift;
  let tally = state.statTally;
  if (seat >= state.playerCount) {
    seat = 0;
    frame += 1;
    if (frame >= state.options.frames) {
      for (let s = 0; s < state.playerCount; s++) tally = tallyMax(tally, s, "maxScore", totalOf(state, s));
      return { ...state, phase: "ended", statTally: tally };
    }
    // §8 — the last place after a frame (with ties: all of them, unless everyone ties) gets an item
    if (state.options.items && state.playerCount > 1) {
      const totals = Array.from({ length: state.playerCount }, (_, s) => totalOf(state, s));
      const low = Math.min(...totals);
      const lows = totals.map((t, s) => (t === low ? s : -1)).filter((s) => s >= 0);
      if (lows.length < state.playerCount) {
        const rng = seededRng((state.seed ^ 0x4e1f) + frame * 7919);
        items = state.items.map((list) => [...list]);
        const got: Seat[] = [];
        const kinds: ItemKind[] = [];
        for (const s of lows) {
          if (items[s].length >= MAX_ITEMS) continue;
          const k = giveItem(rng);
          items[s].push(k);
          got.push(s);
          kinds.push(k);
        }
        if (got.length > 0) gift = { turn: state.turn, seats: got, kinds };
      }
    }
  }
  const mod = state.laneMods[frame] ?? "normal";
  const pending = state.pending.map((p) => [...p]);
  const active = pending[seat];
  pending[seat] = [];
  return {
    ...state,
    frame,
    activeSeat: seat,
    ball: 0,
    standing: RACK.map((p) => p.id),
    rack: rackFor(state.seed, frame, seat, mod),
    items,
    pending,
    active,
    selfBumper: false,
    itemUsed: false,
    splitOpen: false,
    lastGift: gift,
    statTally: tally,
  };
}

function doRoll(state: BowlingState, seat: Seat, a: { x: number; vx: number; vy: number; spin: number }): BowlingState {
  if (state.phase !== "aim" || seat !== state.activeSeat) return state;
  if (![a.x, a.vx, a.vy, a.spin].every((v) => Number.isFinite(v))) return state;
  const q = { x: Math.round(a.x), vx: Math.round(a.vx), vy: Math.round(a.vy), spin: Math.round(a.spin) };
  const rel = releaseOf(q);
  const setup = currentSetup(state);
  const res = simulate(setup, rel);
  const mod = state.laneMods[state.frame] ?? "normal";
  return finishBall(state, seat, res.down, {
    turn: state.turn,
    seat,
    frame: state.frame,
    ball: state.ball,
    x: q.x,
    vx: q.vx,
    vy: q.vy,
    spin: q.spin,
    setup,
    mod,
    hazards: state.active,
    gutter: res.gutterStep !== null,
    foul: false,
    steps: res.steps,
  });
}

function doTimeout(state: BowlingState, seat: Seat, turn: number): BowlingState {
  if (state.phase !== "aim" || turn !== state.turn || seat !== state.activeSeat) return state;
  const mod = state.laneMods[state.frame] ?? "normal";
  return finishBall(state, seat, [], {
    turn: state.turn,
    seat,
    frame: state.frame,
    ball: state.ball,
    x: 0,
    vx: 0,
    vy: 0,
    spin: 0,
    setup: currentSetup(state),
    mod,
    hazards: state.active,
    gutter: false,
    foul: true,
    steps: 0,
  });
}

/** Can `seat` use `kind` on `target` right now (§8)? */
export function canUseItem(state: BowlingState, seat: Seat, kind: ItemKind, target: Seat): boolean {
  if (!state.options.items || state.phase !== "aim" || seat !== state.activeSeat) return false;
  if (state.ball !== 0 || state.itemUsed || !state.items[seat]?.includes(kind)) return false;
  if (ITEMS[kind].self) return target === seat && !state.selfBumper;
  if (target === seat || target < 0 || target >= state.playerCount) return false;
  // one of each kind waiting per target
  return !state.pending[target].some((h) => h.kind === kind);
}

function doItem(state: BowlingState, seat: Seat, kind: ItemKind, target: Seat): BowlingState {
  if (!canUseItem(state, seat, kind, target)) return state;
  const items = state.items.map((l) => [...l]);
  items[seat].splice(items[seat].indexOf(kind), 1);
  let tally = tallyAdd(state.statTally, seat, "itemsUsed");
  const base = { ...state, items, itemUsed: true, turn: state.turn + 1, lastItem: { turn: state.turn, seat, kind, target } };
  if (kind === "bumper") return { ...base, selfBumper: true, statTally: tally };
  const rng = seededRng((state.seed ^ 0x77aa) + state.turn * 31 + target * 7);
  const h: Hazard =
    kind === "cone"
      ? { kind, from: seat, x: Math.round((rng() - 0.5) * 0.6 * 1000) / 1000, y: Math.round((10 + rng() * 4) * 100) / 100 }
      : kind === "oil"
        ? (() => {
            const y0 = Math.round((10.5 + rng() * 1.5) * 100) / 100;
            return { kind, from: seat, y0, y1: Math.round((y0 + 4) * 100) / 100 };
          })()
        : { kind, from: seat, dir: rng() < 0.5 ? -1 : 1 };
  tally = tallyAdd(tally, seat, "sabotages");
  const pending = state.pending.map((p) => [...p]);
  pending[target].push(h);
  return { ...base, pending, statTally: tally };
}

export function applyAction(state: BowlingState, action: EngineAction): BowlingState {
  switch (action?.type) {
    case "roll":
      return doRoll(state, action.seat, action);
    case "item":
      return doItem(state, action.seat, action.kind, action.target);
    case "timeout":
      return doTimeout(state, action.seat, action.turn);
    default:
      return state;
  }
}

/** Whose decision bots/timeouts drive right now. */
export function currentActor(state: BowlingState): Seat | null {
  return state.phase === "aim" ? state.activeSeat : null;
}

// ---------------------------------------------------------------------------
// Rankings (§9)
// ---------------------------------------------------------------------------

export interface RankedSeat {
  seat: Seat;
  rank: number;
}

export function strikesOf(state: BowlingState, seat: Seat): number {
  return state.statTally?.[seat]?.strikes ?? 0;
}
export function sparesOf(state: BowlingState, seat: Seat): number {
  return state.statTally?.[seat]?.spares ?? 0;
}

export function computeRankings(state: BowlingState): RankedSeat[] {
  const seats = Array.from({ length: state.playerCount }, (_, s) => s);
  const key = (s: Seat) => [totalOf(state, s), strikesOf(state, s), sparesOf(state, s)];
  const cmp = (a: Seat, b: Seat) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return 0;
  };
  const sorted = [...seats].sort((a, b) => cmp(a, b) || a - b);
  const out: RankedSeat[] = [];
  sorted.forEach((s, i) => {
    const prev = out[i - 1];
    out.push({ seat: s, rank: prev && cmp(sorted[i - 1], s) === 0 ? prev.rank : i + 1 });
  });
  return out;
}
