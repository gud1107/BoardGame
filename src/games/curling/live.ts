/**
 * Live throws (rulebook §6, §15). The client that throws (or drives the bot)
 * is the throw's "authority": it runs the deterministic `ThrowSim` in real
 * time, fixes the sweep value of each 0.1 s frame from everyone's taps and
 * the bots' decisions, records those values, and finally hands them to the
 * `throw` action — which every client (itself included) replays to the same
 * result. Everything else here is presentation: the snapshots it broadcasts
 * (~10 Hz) and the interpolated view spectators draw.
 */

import { ThrowSim, TICKS_PER_FRAME, DT, type PartyKind, type SimEvent, type Stone, type ThrowParams } from "./physics";

/** One stone as drawn during a live throw. */
export interface LiveStone {
  id: number;
  side: number;
  x: number;
  y: number;
  angle: number;
  kind: PartyKind | null;
  ghost: boolean;
}

export interface LiveSnapshot {
  /** performance.now() when produced (local) or received (remote). */
  at: number;
  tick: number;
  stones: LiveStone[];
}

/** FX-worthy moments, forwarded to spectators inside snapshots. */
export type LiveEvent =
  | { kind: "hit"; x: number; y: number; power: number }
  | { kind: "out"; x: number; y: number; id: number }
  | { kind: "bomb"; x: number; y: number }
  | { kind: "stick"; x: number; y: number }
  | { kind: "solid"; x: number; y: number }
  | { kind: "tee" };

export interface LiveView {
  turn: number;
  seat: number;
  side: number;
  deliveredId: number;
  kind: PartyKind | null;
  /** Authority/replay views draw the newest snapshot; remote ones interpolate behind. */
  local: boolean;
  snaps: LiveSnapshot[];
  /** Current sweep 0..1 for each role and who is sweeping. */
  sweep: { own: number; opp: number; who: number[] };
  passedTee: boolean;
  done: boolean;
  /** Events not yet consumed by the canvas (FX/sound). */
  pending: LiveEvent[];
}

export function liveStones(sim: ThrowSim): LiveStone[] {
  return sim.stones.filter((s) => s.out === null).map((s) => ({ id: s.id, side: s.side, x: s.x, y: s.y, angle: s.angle, kind: s.kind, ghost: s.ghost }));
}

export function toLiveEvent(sim: ThrowSim, e: SimEvent): LiveEvent | null {
  switch (e.kind) {
    case "hit":
      return { kind: "hit", x: e.x, y: e.y, power: e.power };
    case "out":
      return { kind: "out", x: e.x, y: e.y, id: e.id };
    case "bomb":
      return { kind: "bomb", x: e.x, y: e.y };
    case "stick":
      return { kind: "stick", x: e.x, y: e.y };
    case "solid": {
      const d = sim.deliveredStone();
      return { kind: "solid", x: d.x, y: d.y };
    }
    case "tee":
      return { kind: "tee" };
  }
}

/* ── sweep taps → intensity ──────────────────────────────────────────── */

/** Taps within this window count toward a sweeper's intensity. */
export const SWEEP_WINDOW_MS = 600;
/** Taps in the window for full intensity (≈5 taps/s). */
export const SWEEP_FULL_TAPS = 3;

export class SweepCounter {
  private taps = new Map<number, number[]>();

  add(seat: number, count: number, at = performance.now()) {
    const list = this.taps.get(seat) ?? [];
    for (let i = 0; i < Math.min(count, 20); i++) list.push(at);
    this.taps.set(seat, list);
  }

  intensity(seat: number, now = performance.now()): number {
    const list = this.taps.get(seat);
    if (!list) return 0;
    while (list.length && now - list[0] > SWEEP_WINDOW_MS) list.shift();
    return Math.min(1, list.length / SWEEP_FULL_TAPS);
  }

  clear() {
    this.taps.clear();
  }
}

/* ── authority runner ────────────────────────────────────────────────── */

export interface SweepSample {
  /** 0..10 */
  own: number;
  opp: number;
  who: number[];
}

export interface RunnerHooks {
  /** Decide the next frame's sweep (called at each 0.1 s boundary). */
  sweep: (sim: ThrowSim, frame: number) => SweepSample;
  /** New snapshot + events (draw locally, broadcast throttled). */
  frame: (snap: LiveSnapshot, events: LiveEvent[], sweep: SweepSample, sim: ThrowSim) => void;
  done: (own: number[], opp: number[], sim: ThrowSim) => void;
}

/**
 * Runs a throw in real time. Uses setInterval rather than rAF so a hidden
 * tab still finishes on schedule (catch-up is computed from elapsed time).
 */
export class LiveThrowRunner {
  readonly sim: ThrowSim;
  readonly own: number[] = [];
  readonly opp: number[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private start = 0;
  private eventCursor = 0;
  private current: SweepSample = { own: 0, opp: 0, who: [] };
  private finished = false;

  constructor(
    resting: readonly Stone[],
    params: ThrowParams,
    side: number,
    stoneId: number,
    private readonly hooks: RunnerHooks,
    private readonly speed = 1,
    private readonly recorded: { own: readonly number[]; opp: readonly number[] } | null = null,
  ) {
    this.sim = new ThrowSim(resting, params, side, stoneId);
  }

  run() {
    this.start = performance.now();
    this.timer = setInterval(() => this.pump(), 1000 / 60);
    this.pump();
  }

  stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private pump() {
    if (this.finished) return;
    const target = Math.floor(((performance.now() - this.start) / 1000 / DT) * this.speed);
    let budget = 900;
    while (!this.sim.done && this.sim.tick < target && budget-- > 0) {
      if (this.sim.tick % TICKS_PER_FRAME === 0) {
        const f = this.sim.frame;
        if (this.recorded) {
          const own = this.recorded.own[f] ?? 0;
          const opp = this.recorded.opp[f] ?? 0;
          this.current = { own, opp, who: [] };
        } else {
          this.current = this.hooks.sweep(this.sim, f);
          this.own[f] = this.current.own;
          this.opp[f] = this.current.opp;
        }
      }
      this.sim.step(this.current.own / 10, this.current.opp / 10);
    }
    const evs: LiveEvent[] = [];
    while (this.eventCursor < this.sim.events.length) {
      const e = toLiveEvent(this.sim, this.sim.events[this.eventCursor++]);
      if (e) evs.push(e);
    }
    this.hooks.frame({ at: performance.now(), tick: this.sim.tick, stones: liveStones(this.sim) }, evs, this.current, this.sim);
    if (this.sim.done) {
      this.finished = true;
      this.stop();
      const trim = (a: number[]) => {
        const out = Array.from(a, (x) => x ?? 0);
        while (out.length && out[out.length - 1] === 0) out.pop();
        return out;
      };
      this.hooks.done(trim(this.own), trim(this.opp), this.sim);
    }
  }
}

/** Interpolated stones for a remote view, drawn this far behind the newest snapshot. */
export const REMOTE_DELAY_MS = 140;

export function viewStones(view: LiveView, now = performance.now()): LiveStone[] {
  const snaps = view.snaps;
  if (snaps.length === 0) return [];
  const last = snaps[snaps.length - 1];
  if (view.local || snaps.length === 1 || view.done) return last.stones;
  const t = now - REMOTE_DELAY_MS;
  let i = snaps.length - 1;
  while (i > 0 && snaps[i - 1].at > t) i--;
  const b = snaps[i];
  const a = snaps[i - 1] ?? b;
  if (a === b || b.at <= a.at) return b.stones;
  const k = Math.max(0, Math.min(1, (t - a.at) / (b.at - a.at)));
  const prev = new Map(a.stones.map((s) => [s.id, s]));
  return b.stones.map((s) => {
    const p = prev.get(s.id);
    return p ? { ...s, x: p.x + (s.x - p.x) * k, y: p.y + (s.y - p.y) * k, angle: p.angle + (s.angle - p.angle) * k } : s;
  });
}

/** Compact wire format for a snapshot: [id, x*1000, y*1000, angle*100, ghost]. */
export function packStones(stones: readonly LiveStone[]): number[][] {
  return stones.map((s) => [s.id, Math.round(s.x * 1000), Math.round(s.y * 1000), Math.round(s.angle * 100), s.ghost ? 1 : 0]);
}

export function unpackStones(raw: unknown, meta: ReadonlyMap<number, { side: number; kind: PartyKind | null }>, fallback: { side: number; kind: PartyKind | null; id: number }): LiveStone[] | null {
  if (!Array.isArray(raw) || raw.length > 64) return null;
  const out: LiveStone[] = [];
  for (const r of raw) {
    if (!Array.isArray(r) || r.length < 4 || !r.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
    const [id, x, y, a, g] = r as number[];
    const m = meta.get(id) ?? (id === fallback.id ? fallback : { side: 0, kind: null });
    out.push({ id, side: m.side, x: x / 1000, y: y / 1000, angle: a / 100, kind: m.kind, ghost: g === 1 });
  }
  return out;
}
