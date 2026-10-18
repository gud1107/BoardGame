/**
 * Plays resolved shots back on screen (rulebook §11, §13). The engine state
 * already holds the outcome, so every client re-runs the same deterministic
 * physics with `record` on and walks its frames: a short finger wind-up,
 * then the stones slide, clack and fall. Shots that arrive while one is
 * still playing queue up and the player fast-forwards through the backlog.
 *
 * Fallen stones then tumble off the board edge and settle on the floor
 * (cosmetic, analytic — they stay there until the next round).
 */

import { radiusOf, toSim, type AlkkagiState, type Seat, type ShotRecord, type Stone } from "./engine";
import { DT, EDGE, FRAME_EVERY, simulate, type SimCollision, type SimFall, type SimResult } from "./physics";

/** Finger wind-up before the stone leaves (s). */
export const WINDUP = 0.42;
/** Board top to floor, in board units (§13 — a thick goban on legs). */
export const FLOOR_DROP = 3.4;
const G = 46;
const TAIL = 0.35;

export type ReplayEvent =
  | { kind: "flick"; seat: Seat; power: number }
  | { kind: "clack"; impulse: number; x: number; y: number }
  | { kind: "fall"; id: number; owner: Seat }
  | { kind: "floor"; id: number; strength: number }
  | { kind: "done"; shot: ShotRecord };

export interface BoardStoneView {
  id: number;
  owner: Seat;
  king: boolean;
  x: number;
  y: number;
  /** 0..1 fade-out (king-mode surrender). */
  fade: number;
}

export interface FallenStoneView {
  id: number;
  owner: Seat;
  king: boolean;
  x: number;
  y: number;
  /** Height relative to the board top (≤ 0 once off the edge). */
  z: number;
  /** Tilt (radians) about the axis perpendicular to `dir`. */
  tilt: number;
  dirX: number;
  dirY: number;
}

export interface ShotView {
  seat: Seat;
  stoneId: number;
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  /** 0..1 through the wind-up (finger pulls back, then snaps forward). */
  windup: number;
  /** Seconds since the stone left the finger (−1 during the wind-up). */
  rolling: number;
}

export interface ReplayView {
  stones: BoardStoneView[];
  fallen: FallenStoneView[];
  shot: ShotView | null;
  busy: boolean;
}

interface FallTrack {
  stone: Stone;
  fall: SimFall;
  /** performance.now() (ms) when it left the board. */
  at: number;
  floorPlayed: boolean;
}

interface Playing {
  rec: ShotRecord;
  sim: SimResult;
  /** Seconds of playback done so far (windup + sim time). */
  t: number;
  clackIdx: number;
  fallIdx: number;
  flicked: boolean;
}

const slideTime = (sim: SimResult) => sim.steps * DT;

/** Where a fallen stone is `s` seconds after leaving the edge. */
export function fallPose(f: SimFall, s: number): { x: number; y: number; z: number; tilt: number; settled: boolean; dirX: number; dirY: number } {
  const sp = Math.hypot(f.vx, f.vy);
  const dirX = sp > 1e-6 ? f.vx / sp : Math.sign(f.x) || 1;
  const dirY = sp > 1e-6 ? f.vy / sp : 0;
  // even a stone that crept over the edge drops with a little forward speed
  const h = Math.max(1.2, Math.min(sp, 9));
  const t1 = Math.sqrt((2 * FLOOR_DROP) / G);
  const bounceV = 2.4;
  const t2 = (2 * bounceV) / G;
  const slide = (t: number) => h * t;
  let along: number;
  let z: number;
  let tilt: number;
  let settled = false;
  if (s < t1) {
    along = slide(s);
    z = -0.5 * G * s * s;
    tilt = Math.min(1, s / t1) * 2.6;
  } else if (s < t1 + t2) {
    const b = s - t1;
    along = slide(t1) + h * 0.35 * b;
    z = -FLOOR_DROP + bounceV * b - 0.5 * G * b * b;
    tilt = 2.6 + (b / t2) * (Math.PI - 2.6 + 0.0);
  } else {
    const b = s - t1 - t2;
    const extra = Math.min(0.5, b * 1.4);
    along = slide(t1) + h * 0.35 * t2 + h * 0.12 * extra;
    z = -FLOOR_DROP;
    tilt = Math.PI;
    settled = b > 0.4;
  }
  return { x: f.x + dirX * along, y: f.y + dirY * along, z, tilt, settled, dirX, dirY };
}

export class ReplayPlayer {
  private queue: ShotRecord[] = [];
  private cur: Playing | null = null;
  private seenTurn: number | null = null;
  private round: number | null = null;
  private seed: number | null = null;
  private falls = new Map<number, FallTrack>();
  private fades = new Map<number, { stone: Stone; at: number }>();
  private lastNow = 0;

  get busy(): boolean {
    return this.cur !== null || this.queue.length > 0;
  }

  /** Feed the latest engine state (call every frame / on change; idempotent). */
  sync(state: AlkkagiState) {
    if (this.seed !== state.seed || this.round !== state.round) {
      const fresh = this.seed !== state.seed;
      this.seed = state.seed;
      this.round = state.round;
      this.falls.clear();
      this.fades.clear();
      this.queue = [];
      this.cur = null;
      // a shot that already happened before we were watching (join / reconnect) is not replayed
      if (fresh) this.seenTurn = state.lastShot?.turn ?? -1;
    }
    const shot = state.lastShot;
    if (!shot || shot.turn <= (this.seenTurn ?? -1)) return;
    this.queue.push(shot);
    this.seenTurn = shot.turn;
  }

  /** Advance playback to `now` (ms) and describe what to draw. */
  sample(state: AlkkagiState, now: number, emit?: (e: ReplayEvent) => void): ReplayView {
    const dt = this.lastNow === 0 ? 0 : Math.min(0.1, (now - this.lastNow) / 1000);
    this.lastNow = now;
    this.sync(state);

    if (!this.cur && this.queue.length > 0) {
      const rec = this.queue.shift()!;
      const sim = simulate(toSim(rec.before), rec.stoneId, rec.vx / 1000, rec.vy / 1000, true);
      this.cur = { rec, sim, t: 0, clackIdx: 0, fallIdx: 0, flicked: false };
    }

    let shot: ShotView | null = null;
    let stones: BoardStoneView[];
    const cur = this.cur;
    if (cur) {
      // fast-forward when more shots are waiting
      const speed = this.queue.length > 0 ? 2.6 : 1;
      cur.t += dt * speed;
      const rec = cur.rec;
      const roll = cur.t - WINDUP;
      const shooter = rec.before.find((s) => s.id === rec.stoneId);
      const v = Math.hypot(rec.vx, rec.vy) || 1;
      if (roll >= 0 && !cur.flicked) {
        cur.flicked = true;
        emit?.({ kind: "flick", seat: rec.seat, power: Math.min(1, v / 16000) });
      }
      const simT = Math.max(0, roll);
      const step = simT / DT;
      const frames = cur.sim.frames!;
      const fi = Math.min(frames.length - 1, step / FRAME_EVERY);
      const f0 = Math.floor(fi);
      const f1 = Math.min(frames.length - 1, f0 + 1);
      const k = fi - f0;
      stones = [];
      rec.before.forEach((s, i) => {
        const ax = frames[f0][i * 2];
        const ay = frames[f0][i * 2 + 1];
        if (Number.isNaN(ax)) return;
        let bx = frames[f1][i * 2];
        let by = frames[f1][i * 2 + 1];
        if (Number.isNaN(bx)) {
          bx = ax;
          by = ay;
        }
        stones.push({ id: s.id, owner: s.owner, king: s.king, x: ax + (bx - ax) * k, y: ay + (by - ay) * k, fade: 0 });
      });
      // sounds / falls whose time has come
      const cols: SimCollision[] = cur.sim.collisions ?? [];
      while (cur.clackIdx < cols.length && cols[cur.clackIdx].step <= step) {
        const c = cols[cur.clackIdx++];
        emit?.({ kind: "clack", impulse: c.impulse, x: c.x, y: c.y });
      }
      const falls = cur.sim.falls;
      while (cur.fallIdx < falls.length && falls[cur.fallIdx].step <= step) {
        const f = falls[cur.fallIdx++];
        const st = rec.before.find((s) => s.id === f.id)!;
        this.falls.set(f.id, { stone: st, fall: f, at: now - ((step - f.step) * DT * 1000) / speed, floorPlayed: false });
        emit?.({ kind: "fall", id: f.id, owner: st.owner });
      }
      if (shooter && roll < 0.25) {
        const frame = stones.find((s) => s.id === shooter.id);
        shot = {
          seat: rec.seat,
          stoneId: shooter.id,
          x: frame?.x ?? shooter.x,
          y: frame?.y ?? shooter.y,
          dirX: rec.vx / v,
          dirY: rec.vy / v,
          windup: Math.min(1, cur.t / WINDUP),
          rolling: roll < 0 ? -1 : roll,
        };
      }
      if (roll >= slideTime(cur.sim) + TAIL) {
        for (const id of rec.fallen) {
          if (this.falls.has(id)) continue;
          const st = rec.before.find((s) => s.id === id);
          if (st) this.fades.set(id, { stone: st, at: now });
        }
        this.cur = null;
        emit?.({ kind: "done", shot: rec });
      }
    } else {
      stones = state.stones.map((s) => ({ id: s.id, owner: s.owner, king: s.king, x: s.x, y: s.y, fade: 0 }));
    }

    // king-mode surrender: those stones lift and fade out
    for (const [id, fd] of this.fades) {
      const k = (now - fd.at) / 700;
      if (k >= 1) continue;
      if (!stones.some((s) => s.id === id)) stones.push({ id, owner: fd.stone.owner, king: fd.stone.king, x: fd.stone.x, y: fd.stone.y, fade: Math.max(0.01, k) });
    }
    // fades are drawn from their pre-shot spot; prefer the replayed spot if still listed
    const fallen: FallenStoneView[] = [];
    for (const tr of this.falls.values()) {
      const p = fallPose(tr.fall, (now - tr.at) / 1000);
      if (!tr.floorPlayed && p.z <= -FLOOR_DROP + 0.01) {
        tr.floorPlayed = true;
        emit?.({ kind: "floor", id: tr.stone.id, strength: Math.min(1, Math.hypot(tr.fall.vx, tr.fall.vy) / 10 + 0.3) });
      }
      fallen.push({ id: tr.stone.id, owner: tr.stone.owner, king: tr.stone.king, x: p.x, y: p.y, z: p.z, tilt: p.tilt, dirX: p.dirX, dirY: p.dirY });
    }
    return { stones, fallen, shot, busy: this.busy };
  }
}

/** Half-thickness of a stone (go stones are ~0.42 as thick as they are wide). */
export const stoneHalfHeight = (king: boolean) => radiusOf({ king }) * 0.42;

/** True when (x, y) is on the playing surface. */
export const onBoard = (x: number, y: number) => Math.abs(x) <= EDGE && Math.abs(y) <= EDGE;
