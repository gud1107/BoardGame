/**
 * Plays resolved rolls back on screen (rulebook §11). The engine state already
 * holds the pinfall, so every client re-runs the same deterministic physics
 * with `record` on and walks its frames: the bowler's approach, the ball
 * skidding and hooking down the lane, pins tipping over and scattering, then
 * a beat on the result. Rolls that arrive while one is playing queue up and
 * the player fast-forwards through the backlog.
 */

import { releaseOf, type BowlingState, type RollRecord } from "./engine";
import { DT, FRAME_EVERY, simulate, type SimEvent, type SimResult } from "./physics";

/** Approach + swing before the ball leaves the hand (s). */
export const WINDUP = 1.05;
/** Beat on the result after everything stops (s). */
export const TAIL = 1.5;
/** A foul (time-out) shows its banner this long (s). */
export const FOUL_SHOW = 1.4;
/** Pins take this long to tip over (s). */
const TIP = 0.24;

export type ReplayEvent =
  | { kind: "release"; seat: number; power: number }
  | { kind: "hit"; impulse: number; x: number; y: number; ev: SimEvent["kind"] }
  | { kind: "gutter"; x: number; y: number }
  | { kind: "bumper"; x: number; y: number; impulse: number }
  | { kind: "cone"; x: number; y: number }
  | { kind: "pit"; pin: boolean }
  /** Everything has stopped — the pinfall is final (fires before the tail). */
  | { kind: "settled"; rec: RollRecord }
  | { kind: "done"; rec: RollRecord };

export interface PinView {
  id: number;
  x: number;
  y: number;
  /** 0 standing … 1 lying flat. */
  tip: number;
  /** Unit direction it tipped toward (lane coords). */
  dirX: number;
  dirY: number;
  /** Spin about the vertical while it slides (rad). */
  yaw: number;
  /** How far below the deck it has dropped (pit / gutter). */
  drop: number;
  /** Rising in from the pinsetter (0 settled … 1 just appeared). */
  setter: number;
  visible: boolean;
}

export interface BallView {
  x: number;
  y: number;
  /** Down into the gutter (m below the lane). */
  drop: number;
  /** Rolling angle (rad) for the finger holes. */
  roll: number;
  visible: boolean;
}

export interface ReplayView {
  ball: BallView | null;
  pins: PinView[];
  /** The roll being shown (null when idle). */
  rec: RollRecord | null;
  /** 0..1 through the approach (bowler animation), −1 when not winding up. */
  windup: number;
  /** Seconds since release (−1 before). */
  rolling: number;
  /** The tail beat after the pins stopped. */
  settled: boolean;
  busy: boolean;
}

interface Playing {
  rec: RollRecord;
  sim: SimResult | null;
  t: number;
  evIdx: number;
  released: boolean;
  settled: boolean;
  /** Per input pin: tip direction + the step it went down (−1 = never). */
  tips: { dirX: number; dirY: number; at: number }[];
  /** Cumulative ball travel per frame (for the rolling angle). */
  travel: Float32Array;
}

const simDuration = (sim: SimResult) => sim.steps * DT;

function tipDirections(sim: SimResult, rec: RollRecord): Playing["tips"] {
  const frames = sim.frames!;
  const pins = rec.setup.pins;
  return pins.map((p, i) => {
    const k = sim.down.indexOf(p.id);
    if (k < 0) return { dirX: 0, dirY: 1, at: -1 };
    const step = sim.downStep[k];
    const f0 = Math.min(frames.length - 1, Math.floor(step / FRAME_EVERY));
    const f1 = Math.min(frames.length - 1, f0 + 8);
    const dx = frames[f1][3 + i * 3] - frames[f0][3 + i * 3];
    const dy = frames[f1][4 + i * 3] - frames[f0][4 + i * 3];
    const d = Math.hypot(dx, dy);
    // a pin that barely slid falls away from the ball
    if (d < 1e-3) {
      const bx = frames[f0][0] - p.x;
      const by = frames[f0][1] - p.y;
      const bd = Math.hypot(bx, by) || 1;
      return { dirX: -bx / bd, dirY: -by / bd, at: step * DT };
    }
    return { dirX: dx / d, dirY: dy / d, at: step * DT };
  });
}

export class ReplayPlayer {
  private queue: RollRecord[] = [];
  private cur: Playing | null = null;
  private seenTurn: number | null = null;
  private seed: number | null = null;
  private lastNow = 0;
  private freezeUntil = 0;
  /** Idle rack shown last (to animate a fresh rack coming down). */
  private idleKey = "";
  private idleAt = 0;

  hitStop(ms: number) {
    this.freezeUntil = Math.max(this.freezeUntil, this.lastNow + ms);
  }

  get busy(): boolean {
    return this.cur !== null || this.queue.length > 0;
  }

  sync(state: BowlingState) {
    if (this.seed !== state.seed) {
      this.seed = state.seed;
      this.queue = [];
      this.cur = null;
      // a roll that happened before we were watching (join / reconnect) is not replayed
      this.seenTurn = state.lastRoll?.turn ?? -1;
    }
    const r = state.lastRoll;
    if (!r || r.turn <= (this.seenTurn ?? -1)) return;
    this.queue.push(r);
    this.seenTurn = r.turn;
  }

  sample(state: BowlingState, now: number, emit?: (e: ReplayEvent) => void): ReplayView {
    const dt = this.lastNow === 0 ? 0 : Math.min(0.1, (now - this.lastNow) / 1000);
    this.lastNow = now;
    this.sync(state);

    if (!this.cur && this.queue.length > 0) {
      const rec = this.queue.shift()!;
      const sim = rec.foul ? null : simulate(rec.setup, releaseOf(rec), true);
      let travel = new Float32Array(0);
      if (sim) {
        const fr = sim.frames!;
        travel = new Float32Array(fr.length);
        for (let i = 1; i < fr.length; i++) travel[i] = travel[i - 1] + Math.hypot(fr[i][0] - fr[i - 1][0], fr[i][1] - fr[i - 1][1]);
      }
      this.cur = { rec, sim, t: 0, evIdx: 0, released: false, settled: false, tips: sim ? tipDirections(sim, rec) : [], travel };
    }

    const cur = this.cur;
    if (!cur) return this.idleView(state, now);

    const speed = this.queue.length > 0 ? 2.6 : 1;
    if (now >= this.freezeUntil) cur.t += dt * speed;
    const rec = cur.rec;

    if (!cur.sim) {
      // foul: the banner shows, nothing rolls
      if (!cur.settled) {
        cur.settled = true;
        emit?.({ kind: "settled", rec });
      }
      const view: ReplayView = { ball: null, pins: this.rackPins(rec), rec, windup: -1, rolling: -1, settled: true, busy: true };
      if (cur.t >= FOUL_SHOW) {
        this.cur = null;
        emit?.({ kind: "done", rec });
      }
      return view;
    }

    const sim = cur.sim;
    const roll = cur.t - WINDUP;
    if (roll >= 0 && !cur.released) {
      cur.released = true;
      emit?.({ kind: "release", seat: rec.seat, power: Math.min(1, Math.max(0, (rec.vy / 1000 - 5) / 4.5)) });
    }
    const simT = Math.max(0, roll);
    const step = simT / DT;
    const frames = sim.frames!;
    const fi = Math.min(frames.length - 1, step / FRAME_EVERY);
    const f0 = Math.floor(fi);
    const f1 = Math.min(frames.length - 1, f0 + 1);
    const k = fi - f0;
    const A = frames[f0];
    const B = frames[f1];
    const lerp = (j: number) => A[j] + (B[j] - A[j]) * k;

    const evs = sim.events ?? [];
    while (cur.evIdx < evs.length && evs[cur.evIdx].step <= step && roll >= 0) {
      const e = evs[cur.evIdx++];
      if (e.kind === "pin" || e.kind === "pinPin" || e.kind === "wall") emit?.({ kind: "hit", impulse: e.impulse, x: e.x, y: e.y, ev: e.kind });
      else if (e.kind === "gutter") emit?.({ kind: "gutter", x: e.x, y: e.y });
      else if (e.kind === "bumper") emit?.({ kind: "bumper", x: e.x, y: e.y, impulse: e.impulse });
      else if (e.kind === "cone") emit?.({ kind: "cone", x: e.x, y: e.y });
      else if (e.kind === "pit") emit?.({ kind: "pit", pin: e.a >= 0 });
    }

    // ball
    const ballState = A[2];
    const bx = lerp(0);
    const by = lerp(1);
    const inGutter = ballState >= 1;
    const travel = cur.travel[f0] + (cur.travel[f1] - cur.travel[f0]) * k;
    let ball: BallView | null = null;
    if (roll < 0) {
      ball = { x: frames[0][0], y: 0, drop: 0, roll: 0, visible: false };
    } else if (ballState < 2) {
      ball = { x: bx, y: by, drop: inGutter ? 0.06 : 0, roll: travel / rec.setup.ballR, visible: true };
    } else {
      // in the pit: drop out of sight behind the deck
      ball = { x: bx, y: by, drop: 0.5, roll: travel / rec.setup.ballR, visible: false };
    }

    // pins
    const pins: PinView[] = rec.setup.pins.map((p, i) => {
      const tip = cur.tips[i];
      const x = roll < 0 ? p.x : lerp(3 + i * 3);
      const y = roll < 0 ? p.y : lerp(4 + i * 3);
      const st = A[5 + i * 3];
      let tipK = 0;
      if (tip.at >= 0 && simT >= tip.at) tipK = Math.min(1, (simT - tip.at) / TIP);
      const slid = Math.hypot(x - p.x, y - p.y);
      return {
        id: p.id,
        x,
        y,
        tip: tipK,
        dirX: tip.dirX,
        dirY: tip.dirY,
        yaw: tipK > 0 ? slid * 5 : 0,
        drop: st === 2 ? 0.35 : 0,
        setter: 0,
        visible: st !== 2 || y < 19.2,
      };
    });

    const end = simDuration(sim);
    if (roll >= end && !cur.settled) {
      cur.settled = true;
      emit?.({ kind: "settled", rec });
    }
    const view: ReplayView = { ball, pins, rec, windup: roll < 0 ? Math.min(1, cur.t / WINDUP) : -1, rolling: roll < 0 ? -1 : roll, settled: cur.settled, busy: true };
    if (roll >= end + TAIL) {
      this.cur = null;
      emit?.({ kind: "done", rec });
    }
    return view;
  }

  private rackPins(rec: RollRecord): PinView[] {
    return rec.setup.pins.map((p) => ({ id: p.id, x: p.x, y: p.y, tip: 0, dirX: 0, dirY: 1, yaw: 0, drop: 0, setter: 0, visible: true }));
  }

  private idleView(state: BowlingState, now: number): ReplayView {
    const standing = new Set(state.standing);
    const key = `${state.frame}:${state.activeSeat}:${state.ball}:${state.standing.join(",")}`;
    if (key !== this.idleKey) {
      this.idleKey = key;
      this.idleAt = now;
    }
    const age = (now - this.idleAt) / 1000;
    // a fresh rack (new frame turn / reset) drops in from the pinsetter
    const fresh = state.ball === 0 || state.standing.length === 10;
    const setter = fresh ? Math.max(0, 1 - age / 0.55) : 0;
    const pins: PinView[] = state.rack
      .filter((p) => standing.has(p.id))
      .map((p) => ({ id: p.id, x: p.x, y: p.y, tip: 0, dirX: 0, dirY: 1, yaw: 0, drop: 0, setter, visible: true }));
    return { ball: null, pins, rec: null, windup: -1, rolling: -1, settled: false, busy: false };
  }
}
