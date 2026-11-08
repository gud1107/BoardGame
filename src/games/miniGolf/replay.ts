/**
 * Plays resolved strokes back on screen (rulebook §11). The engine state
 * already holds where every ball ended, so every client re-runs the same
 * deterministic physics with `record` on and walks its frames: the golfer's
 * swing, the ball rolling, bouncing, jumping, dropping into the cup or off
 * the island, then a beat on the result. Strokes that arrive while one is
 * playing queue up and the player fast-forwards through the backlog.
 */

import { layoutFor } from "./course";
import { ballSpot, shotOf, windmillClock, WINDUP_S, type MiniGolfState, type Seat, type ShotRecord } from "./engine";
import { DT, FRAME_EVERY, simulate, type SimEvent, type SimResult } from "./physics";

export const WINDUP = WINDUP_S;
/** Beat on the result after everything stops (s). */
export const TAIL = 1.1;
/** A whiff (time-out) shows its banner this long (s). */
export const WHIFF_SHOW = 1.3;
/** A ball falling off the island is shown this long (s). */
const FALL_SHOW = 1.1;

export type ReplayEvent =
  | { kind: "swing"; seat: Seat; power: number }
  | { kind: "hit"; ev: SimEvent["kind"]; impulse: number; x: number; y: number; seat: Seat }
  | { kind: "settled"; rec: ShotRecord }
  | { kind: "done"; rec: ShotRecord };

export interface BallView {
  seat: Seat;
  x: number;
  y: number;
  /** Height above the grass (m); negative = sinking into the cup / falling. */
  z: number;
  /** Rolling angle (rad) for the dimples. */
  roll: number;
  /** Travel direction (rad) for the rolling axis. */
  dir: number;
  /** 0 on the course, 1 holed, 2 fell off. */
  status: number;
  visible: boolean;
  /** This is the ball being played. */
  active: boolean;
}

export interface ReplayView {
  balls: BallView[];
  rec: ShotRecord | null;
  /** 0..1 through the swing, −1 when not swinging. */
  windup: number;
  /** Seconds since the ball started rolling (−1 before). */
  rolling: number;
  settled: boolean;
  busy: boolean;
  /** Windmill clock (s) to draw the blades at; null = the scene's own clock. */
  wmClock: number | null;
}

interface Playing {
  rec: ShotRecord;
  sim: SimResult | null;
  t: number;
  evIdx: number;
  swung: boolean;
  settled: boolean;
  /** Cumulative travel per frame per ball (rolling angle). */
  travel: Float32Array[];
  /** Step each ball ended (holed / out), −1 never. */
  ends: number[];
}

export class ReplayPlayer {
  private queue: ShotRecord[] = [];
  private cur: Playing | null = null;
  private seenTurn: number | null = null;
  private seed: number | null = null;
  private lastNow = 0;
  private freezeUntil = 0;

  hitStop(ms: number) {
    this.freezeUntil = Math.max(this.freezeUntil, this.lastNow + ms);
  }

  get busy(): boolean {
    return this.cur !== null || this.queue.length > 0;
  }

  sync(state: MiniGolfState) {
    if (this.seed !== state.seed) {
      this.seed = state.seed;
      this.queue = [];
      this.cur = null;
      // a stroke played before we were watching (join / reconnect) is not replayed
      this.seenTurn = state.lastShot?.turn ?? -1;
    }
    const r = state.lastShot;
    if (!r || r.turn <= (this.seenTurn ?? -1)) return;
    this.queue.push(r);
    this.seenTurn = r.turn;
  }

  sample(state: MiniGolfState, now: number, emit?: (e: ReplayEvent) => void): ReplayView {
    const dt = this.lastNow === 0 ? 0 : Math.min(0.1, (now - this.lastNow) / 1000);
    this.lastNow = now;
    this.sync(state);

    if (!this.cur && this.queue.length > 0) {
      const rec = this.queue.shift()!;
      let sim: SimResult | null = null;
      if (!rec.timeout) {
        const v = shotOf(rec);
        sim = simulate(layoutFor(rec.holeId, rec.obstacle), rec.balls, { shooter: rec.shooter, vx: v.vx, vy: v.vy, wm: windmillClock(rec.wm) }, true);
      }
      const travel: Float32Array[] = [];
      if (sim) {
        const fr = sim.frames!;
        for (let b = 0; b < rec.balls.length; b++) {
          const tr = new Float32Array(fr.length);
          for (let i = 1; i < fr.length; i++) tr[i] = tr[i - 1] + Math.hypot(fr[i][b * 4] - fr[i - 1][b * 4], fr[i][b * 4 + 1] - fr[i - 1][b * 4 + 1]);
          travel.push(tr);
        }
      }
      this.cur = { rec, sim, t: 0, evIdx: 0, swung: false, settled: false, travel, ends: sim ? sim.balls.map((b) => b.step) : [] };
    }

    const cur = this.cur;
    if (!cur) return this.idleView(state);

    const speed = this.queue.length > 0 ? 2.6 : 1;
    if (now >= this.freezeUntil) cur.t += dt * speed;
    const rec = cur.rec;
    const wmClock = windmillClock(rec.wm) - WINDUP + cur.t;

    if (!cur.sim) {
      if (!cur.settled) {
        cur.settled = true;
        emit?.({ kind: "settled", rec });
      }
      const view: ReplayView = { balls: this.restBalls(rec), rec, windup: -1, rolling: -1, settled: true, busy: true, wmClock: null };
      if (cur.t >= WHIFF_SHOW) {
        this.cur = null;
        emit?.({ kind: "done", rec });
      }
      return view;
    }

    const sim = cur.sim;
    const roll = cur.t - WINDUP;
    if (!cur.swung && cur.t >= WINDUP * 0.55) {
      cur.swung = true;
      const v = shotOf(rec);
      emit?.({ kind: "swing", seat: rec.seat, power: Math.min(1, Math.hypot(v.vx, v.vy) / 4.2) });
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

    const evs = sim.events ?? [];
    while (roll >= 0 && cur.evIdx < evs.length && evs[cur.evIdx].step <= step) {
      const e = evs[cur.evIdx++];
      emit?.({ kind: "hit", ev: e.kind, impulse: e.impulse, x: e.x, y: e.y, seat: rec.balls[e.a]?.id ?? rec.seat });
    }

    const balls: BallView[] = rec.balls.map((b, i) => {
      const st = A[i * 4 + 3];
      const x = A[i * 4] + (B[i * 4] - A[i * 4]) * k;
      const y = A[i * 4 + 1] + (B[i * 4 + 1] - A[i * 4 + 1]) * k;
      let z = A[i * 4 + 2] + (B[i * 4 + 2] - A[i * 4 + 2]) * k;
      const tr = cur.travel[i];
      const travel = tr[f0] + (tr[f1] - tr[f0]) * k;
      const dx = B[i * 4] - A[i * 4];
      const dy = B[i * 4 + 1] - A[i * 4 + 1];
      let visible = true;
      const endAt = cur.ends[i] >= 0 ? cur.ends[i] * DT : -1;
      if (st === 1 && endAt >= 0) {
        // dropping into the cup
        const since = simT - endAt;
        z = -Math.min(0.07, since * 0.5);
        visible = since < 0.6;
      } else if (st === 2 && endAt >= 0) {
        const since = simT - endAt;
        z = -4.9 * since * since;
        visible = since < FALL_SHOW;
      }
      return { seat: b.id, x, y, z, roll: travel / 0.03, dir: Math.atan2(dy, dx), status: st, visible, active: i === rec.shooter };
    });

    const end = sim.steps * DT;
    if (roll >= end && !cur.settled) {
      cur.settled = true;
      emit?.({ kind: "settled", rec });
    }
    const view: ReplayView = { balls, rec, windup: roll < 0 ? Math.min(1, cur.t / WINDUP) : -1, rolling: roll < 0 ? -1 : roll, settled: cur.settled, busy: true, wmClock };
    if (roll >= end + TAIL) {
      this.cur = null;
      emit?.({ kind: "done", rec });
    }
    return view;
  }

  private restBalls(rec: ShotRecord): BallView[] {
    return rec.balls.map((b, i) => ({ seat: b.id, x: b.x, y: b.y, z: 0, roll: 0, dir: 0, status: 0, visible: true, active: i === rec.shooter }));
  }

  private idleView(state: MiniGolfState): ReplayView {
    const balls: BallView[] = [];
    for (let s = 0; s < state.playerCount; s++) {
      const b = state.balls[s];
      const active = state.phase === "play" && s === state.activeSeat;
      if (b.status === "rest") balls.push({ seat: s, x: b.x, y: b.y, z: 0, roll: 0, dir: 0, status: 0, visible: true, active });
      else if (b.status === "hand" && active) {
        const p = ballSpot(state, s);
        balls.push({ seat: s, x: p.x, y: p.y, z: 0, roll: 0, dir: 0, status: 0, visible: true, active });
      }
    }
    return { balls, rec: null, windup: -1, rolling: -1, settled: false, busy: false, wmClock: null };
  }
}
