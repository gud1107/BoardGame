/**
 * Plays resolved shots back on screen (rulebook §10). The engine state
 * already holds the outcome, so every client re-runs the same deterministic
 * physics with `record` on and walks its frames: the cue draws back and
 * strikes, the balls roll, clack, bank off cushions and drop into pockets.
 * Shots that arrive while one is still playing queue up and the player
 * fast-forwards through the backlog.
 */

import { CUE_ID, runShot, type BilliardsState, type ShotRecord } from "./engine";
import { DT, FRAME_EVERY, POCKETS, type SimContact, type SimPot, type SimRail, type SimResult } from "./physics";

/** Cue draw-back + stroke before the cue ball leaves (s). */
export const STROKE = 0.55;
const TAIL = 0.4;
/** How long a pocketed ball takes to drop out of sight (s). */
export const DROP_S = 0.45;

export type ReplayEvent =
  | { kind: "strike"; seat: number; power: number }
  | { kind: "clack"; impulse: number; x: number; y: number; a: number; b: number }
  | { kind: "rail"; impulse: number; x: number; y: number; id: number }
  | { kind: "pot"; id: number; pocket: number }
  | { kind: "done"; shot: ShotRecord };

export interface BallView {
  id: number;
  x: number;
  y: number;
  /** Height offset (negative while dropping into a pocket). */
  z: number;
  /** Total rolled distance along x / y (for the rolling spin). */
  rx: number;
  ry: number;
  /** 0..1 shrink as it vanishes into the pocket. */
  fade: number;
}

export interface StrokeView {
  seat: number;
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  /** 0..1 through the stroke (draw back, then thrust). */
  k: number;
  power: number;
}

export interface ReplayView {
  balls: BallView[];
  stroke: StrokeView | null;
  busy: boolean;
}

interface Playing {
  rec: ShotRecord;
  sim: SimResult;
  t: number;
  contactIdx: number;
  railIdx: number;
  potIdx: number;
  struck: boolean;
}

interface Drop {
  pot: SimPot;
  at: number;
}

export class ReplayPlayer {
  private queue: ShotRecord[] = [];
  private cur: Playing | null = null;
  private seenTurn: number | null = null;
  private seed: number | null = null;
  private rack: number | null = null;
  private drops = new Map<number, Drop>();
  private roll = new Map<number, { rx: number; ry: number; x: number; y: number }>();
  private lastNow = 0;

  get busy(): boolean {
    return this.cur !== null || this.queue.length > 0;
  }

  sync(state: BilliardsState) {
    if (this.seed !== state.seed || this.rack !== state.rack) {
      const fresh = this.seed !== state.seed;
      this.seed = state.seed;
      this.rack = state.rack;
      this.queue = [];
      this.cur = null;
      this.drops.clear();
      this.roll.clear();
      if (fresh) this.seenTurn = state.lastShot?.turn ?? -1;
    }
    const shot = state.lastShot;
    if (!shot || shot.turn <= (this.seenTurn ?? -1)) return;
    this.queue.push(shot);
    this.seenTurn = shot.turn;
  }

  private rolled(id: number, x: number, y: number): { rx: number; ry: number } {
    const r = this.roll.get(id);
    if (!r) {
      this.roll.set(id, { rx: 0, ry: 0, x, y });
      return { rx: 0, ry: 0 };
    }
    const dx = x - r.x;
    const dy = y - r.y;
    // a teleport (re-spot / hand placement) doesn't spin the ball
    if (dx * dx + dy * dy < 4) {
      r.rx += dx;
      r.ry += dy;
    }
    r.x = x;
    r.y = y;
    return { rx: r.rx, ry: r.ry };
  }

  sample(state: BilliardsState, now: number, emit?: (e: ReplayEvent) => void): ReplayView {
    const dt = this.lastNow === 0 ? 0 : Math.min(0.1, (now - this.lastNow) / 1000);
    this.lastNow = now;
    this.sync(state);
    if (!this.cur && this.queue.length > 0) {
      const rec = this.queue.shift()!;
      const sim = runShot(rec.before, state.options.mode, rec.vx, rec.vy, rec.spin, rec.side, true);
      this.cur = { rec, sim, t: 0, contactIdx: 0, railIdx: 0, potIdx: 0, struck: false };
    }

    let stroke: StrokeView | null = null;
    let balls: BallView[];
    const cur = this.cur;
    if (cur) {
      const speed = this.queue.length > 0 ? 2.8 : 1;
      cur.t += dt * speed;
      const rec = cur.rec;
      const roll = cur.t - STROKE;
      const v = Math.hypot(rec.vx, rec.vy) || 1;
      if (roll >= 0 && !cur.struck) {
        cur.struck = true;
        emit?.({ kind: "strike", seat: rec.seat, power: Math.min(1, v / 24000) });
      }
      const step = Math.max(0, roll) / DT;
      const frames = cur.sim.frames!;
      const fi = Math.min(frames.length - 1, step / FRAME_EVERY);
      const f0 = Math.floor(fi);
      const f1 = Math.min(frames.length - 1, f0 + 1);
      const k = fi - f0;
      balls = [];
      rec.before.forEach((b, i) => {
        const ax = frames[f0][i * 2];
        const ay = frames[f0][i * 2 + 1];
        if (Number.isNaN(ax)) return;
        let bx = frames[f1][i * 2];
        let by = frames[f1][i * 2 + 1];
        if (Number.isNaN(bx)) {
          bx = ax;
          by = ay;
        }
        const x = ax + (bx - ax) * k;
        const y = ay + (by - ay) * k;
        balls.push({ id: b.id, x, y, z: 0, ...this.rolled(b.id, x, y), fade: 0 });
      });
      const contacts: SimContact[] = cur.sim.contacts;
      while (cur.contactIdx < contacts.length && contacts[cur.contactIdx].step <= step) {
        const c = contacts[cur.contactIdx++];
        emit?.({ kind: "clack", impulse: c.impulse, x: c.x, y: c.y, a: c.a, b: c.b });
      }
      const rails: SimRail[] = cur.sim.rails;
      while (cur.railIdx < rails.length && rails[cur.railIdx].step <= step) {
        const r = rails[cur.railIdx++];
        emit?.({ kind: "rail", impulse: r.impulse, x: r.x, y: r.y, id: r.id });
      }
      const pots = cur.sim.pots;
      while (cur.potIdx < pots.length && pots[cur.potIdx].step <= step) {
        const p = pots[cur.potIdx++];
        this.drops.set(p.id, { pot: p, at: now - ((step - p.step) * DT * 1000) / speed });
        emit?.({ kind: "pot", id: p.id, pocket: p.pocket });
      }
      if (roll < 0.18) {
        const cueBall = rec.before.find((b) => b.id === CUE_ID);
        if (cueBall) stroke = { seat: rec.seat, x: cueBall.x, y: cueBall.y, dirX: rec.vx / v, dirY: rec.vy / v, k: Math.min(1, cur.t / STROKE), power: Math.min(1, v / 24000) };
      }
      if (roll >= cur.sim.steps * DT + TAIL) {
        this.cur = null;
        this.drops.clear();
        emit?.({ kind: "done", shot: rec });
      }
    } else {
      balls = state.balls.map((b) => ({ id: b.id, x: b.x, y: b.y, z: 0, ...this.rolled(b.id, b.x, b.y), fade: 0 }));
    }
    // balls dropping into pockets: slide to the pocket centre and sink
    for (const [id, d] of this.drops) {
      const s = (now - d.at) / 1000;
      if (s > DROP_S + 0.2) continue;
      const pk = POCKETS[d.pot.pocket];
      const k = Math.min(1, s / DROP_S);
      const x = d.pot.x + (pk.x - d.pot.x) * Math.min(1, k * 1.6);
      const y = d.pot.y + (pk.y - d.pot.y) * Math.min(1, k * 1.6);
      if (!balls.some((b) => b.id === id)) balls.push({ id, x, y, z: -k * 1.2, ...this.rolled(id, x, y), fade: k });
    }
    return { balls, stroke, busy: this.busy };
  }
}
