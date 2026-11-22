/**
 * 한 발의 묘수 — deterministic shooting-puzzle simulation.
 *
 * Everything that moves on its own is an analytic function of time
 * (`motionAt`), so the observation scrubber can jump to any moment and the
 * solver can replay thousands of shots exactly. The only state is what the
 * player's bullets changed: dead targets, blown barrels, cut ropes and the
 * weights falling from them. Fixed 120 Hz step, no randomness anywhere.
 */

export const TPS = 120;
export const DT = 1 / TPS;
export const W = 1000;
export const H = 600;
export const FLOOR_Y = 572;
export const BULLET_SPEED = 1300;
export const BULLET_LIFE = 2.2;
export const MAX_BOUNCES = 6;
export const EXPLODE_R = 105;
export const CHAIN_DELAY = 8;
export const GRAVITY = 1400;
export const AIM_MIN = -178;
export const AIM_MAX = -2;
export const DEFAULT_GUN: Vec = { x: 70, y: 540 };

export interface Vec {
  x: number;
  y: number;
}

export type Motion =
  | { k: "static"; p: Vec }
  /** Ping-pong between a and b, one full round trip per `period` s. */
  | { k: "line"; a: Vec; b: Vec; period: number; phase?: number }
  /** Circle around c; negative period runs counter-clockwise. */
  | { k: "orbit"; c: Vec; r: number; period: number; phase?: number }
  /** Hangs `len` below `pivot`, swinging ±amp degrees. */
  | { k: "pendulum"; pivot: Vec; len: number; amp: number; period: number; phase?: number };

export interface TargetDef {
  id: string;
  kind: "target" | "hostage";
  m: Motion;
  r: number;
}

export interface SegmentDef {
  id: string;
  kind: "wall" | "mirror";
  c: Vec;
  len: number;
  /** Degrees at t = 0. */
  angle: number;
  /** Continuous rotation, degrees per second. */
  spin?: number;
  /** Back-and-forth rotation on top of `angle`. */
  swing?: { amp: number; period: number; phase?: number };
  /** The centre itself may travel. */
  move?: Motion;
}

export interface BarrelDef {
  id: string;
  m: Motion;
  r: number;
}

export interface WeightDef {
  id: string;
  /** `static` (rope from `anchor`) or `pendulum` (rope from its pivot). */
  m: Motion;
  anchor?: Vec;
  r: number;
}

export interface Shot {
  tick: number;
  /** Degrees, screen space (y down) — so aiming up is negative. */
  angle: number;
}

export interface StageDef {
  id: string;
  chapter: number;
  index: number;
  title: string;
  /** One line shown under the title. */
  brief: string;
  /** Hint 1: which device to use. */
  hint: string;
  duration: number;
  ammo: number;
  par: number;
  /** Fewer bullets than par — the hidden 묘수. */
  myosu?: number;
  gun?: Vec;
  targets: TargetDef[];
  segments: SegmentDef[];
  barrels: BarrelDef[];
  weights: WeightDef[];
  /** Reference answer with `par` bullets (verified by tests). */
  solution: Shot[];
  /** Reference answer with `myosu` bullets. */
  myosuSolution?: Shot[];
}

export type FxKind = "shot" | "hit" | "hostage" | "ricochet" | "wall" | "cut" | "boom" | "land" | "thud" | "smash";

export interface Fx {
  tick: number;
  kind: FxKind;
  x: number;
  y: number;
}

export interface Bullet {
  x: number;
  y: number;
  dx: number;
  dy: number;
  born: number;
  bounces: number;
  alive: boolean;
  path: Vec[];
}

interface Falling {
  tick: number;
  p0: Vec;
  v0: Vec;
  landed: Vec | null;
}

export type Outcome = "running" | "win" | "fail-hostage" | "fail-time" | "fail-ammo";

/* ------------------------------------------------------------------ math */

const TAU = Math.PI * 2;
const rad = (d: number) => (d * Math.PI) / 180;

function frac(x: number) {
  return x - Math.floor(x);
}

export function motionAt(m: Motion, t: number): Vec {
  switch (m.k) {
    case "static":
      return m.p;
    case "line": {
      const u = frac(t / m.period + (m.phase ?? 0));
      const s = u < 0.5 ? u * 2 : 2 - u * 2;
      return { x: m.a.x + (m.b.x - m.a.x) * s, y: m.a.y + (m.b.y - m.a.y) * s };
    }
    case "orbit": {
      const th = TAU * (t / m.period + (m.phase ?? 0));
      return { x: m.c.x + m.r * Math.cos(th), y: m.c.y + m.r * Math.sin(th) };
    }
    case "pendulum": {
      const th = rad(m.amp) * Math.sin(TAU * (t / m.period + (m.phase ?? 0)));
      return { x: m.pivot.x + m.len * Math.sin(th), y: m.pivot.y + m.len * Math.cos(th) };
    }
  }
}

function motionVel(m: Motion, t: number): Vec {
  if (m.k === "static") return { x: 0, y: 0 };
  const e = 1e-4;
  const a = motionAt(m, t - e);
  const b = motionAt(m, t + e);
  return { x: (b.x - a.x) / (2 * e), y: (b.y - a.y) / (2 * e) };
}

export function segmentAt(s: SegmentDef, t: number): { a: Vec; b: Vec } {
  const c = s.move ? motionAt(s.move, t) : s.c;
  let ang = s.angle + (s.spin ?? 0) * t;
  if (s.swing) ang += s.swing.amp * Math.sin(TAU * (t / s.swing.period + (s.swing.phase ?? 0)));
  const hx = (Math.cos(rad(ang)) * s.len) / 2;
  const hy = (Math.sin(rad(ang)) * s.len) / 2;
  return { a: { x: c.x - hx, y: c.y - hy }, b: { x: c.x + hx, y: c.y + hy } };
}

/** Distance along the ray (unit d) to a circle, or -1. */
function rayCircle(px: number, py: number, dx: number, dy: number, c: Vec, r: number, maxS: number): number {
  const ox = px - c.x;
  const oy = py - c.y;
  const b = dx * ox + dy * oy;
  const cc = ox * ox + oy * oy - r * r;
  if (cc < 0) return 0;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const s = -b - Math.sqrt(disc);
  return s >= 0 && s <= maxS ? s : -1;
}

/** Distance along the ray to segment a-b, or -1. */
function raySeg(px: number, py: number, dx: number, dy: number, a: Vec, b: Vec, maxS: number): number {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-9) return -1;
  const ax = a.x - px;
  const ay = a.y - py;
  const s = (ax * ey - ay * ex) / den;
  const u = (ax * dy - ay * dx) / den;
  return s >= 0 && s <= maxS && u >= 0 && u <= 1 ? s : -1;
}

function distToSeg(p: Vec, a: Vec, b: Vec): number {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const l2 = ex * ex + ey * ey || 1;
  const u = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l2));
  return Math.hypot(p.x - (a.x + ex * u), p.y - (a.y + ey * u));
}

export function aimDir(angle: number): Vec {
  return { x: Math.cos(rad(angle)), y: Math.sin(rad(angle)) };
}

export function clampAim(a: number): number {
  return Math.max(AIM_MIN, Math.min(AIM_MAX, a));
}

/* ------------------------------------------------------------------ sim */

export class Sim {
  readonly stage: StageDef;
  readonly gun: Vec;
  tick = 0;
  readonly dead = new Map<string, number>();
  readonly blown = new Map<string, number>();
  readonly falling = new Map<string, Falling>();
  readonly bullets: Bullet[] = [];
  readonly fx: Fx[] = [];
  readonly fired: Shot[] = [];
  private queued: Shot[] = [];
  private fuses: { id: string; at: number }[] = [];
  private hostageDown = false;

  constructor(stage: StageDef, reserved: Shot[] = []) {
    this.stage = stage;
    this.gun = stage.gun ?? DEFAULT_GUN;
    this.queued = [...reserved].sort((a, b) => a.tick - b.tick);
  }

  get time() {
    return this.tick * DT;
  }

  get ammoLeft() {
    return this.stage.ammo - this.fired.length - this.queued.length;
  }

  /** Real-time trigger pull: fires on the next step. */
  fire(angle: number): boolean {
    if (this.ammoLeft <= 0 || this.outcome() !== "running") return false;
    this.queued.push({ tick: this.tick, angle: clampAim(angle) });
    return true;
  }

  targetAlive(id: string) {
    return !this.dead.has(id);
  }

  targetPos(def: TargetDef, t = this.time): Vec {
    return motionAt(def.m, t);
  }

  barrelPos(def: BarrelDef, t = this.time): Vec {
    return motionAt(def.m, t);
  }

  weightPos(def: WeightDef, t = this.time): Vec {
    const f = this.falling.get(def.id);
    if (!f) return motionAt(def.m, t);
    if (f.landed) return f.landed;
    const tau = Math.max(0, t - f.tick * DT);
    return { x: f.p0.x + f.v0.x * tau, y: f.p0.y + f.v0.y * tau + 0.5 * GRAVITY * tau * tau };
  }

  /** Rope from its top to the weight; null once cut. */
  ropeOf(def: WeightDef, t = this.time): { a: Vec; b: Vec } | null {
    if (this.falling.has(def.id)) return null;
    const top = def.m.k === "pendulum" ? def.m.pivot : (def.anchor ?? { x: motionAt(def.m, t).x, y: 0 });
    return { a: top, b: motionAt(def.m, t) };
  }

  private kill(id: string, x: number, y: number) {
    if (this.dead.has(id)) return;
    this.dead.set(id, this.tick);
    const def = this.stage.targets.find((d) => d.id === id);
    if (def?.kind === "hostage") {
      this.hostageDown = true;
      this.fx.push({ tick: this.tick, kind: "hostage", x, y });
    } else this.fx.push({ tick: this.tick, kind: "hit", x, y });
  }

  private cut(def: WeightDef, t: number, x: number, y: number) {
    if (this.falling.has(def.id)) return;
    this.falling.set(def.id, { tick: this.tick, p0: motionAt(def.m, t), v0: motionVel(def.m, t), landed: null });
    this.fx.push({ tick: this.tick, kind: "cut", x, y });
  }

  private ignite(id: string, delay: number) {
    if (this.blown.has(id) || this.fuses.some((f) => f.id === id)) return;
    this.fuses.push({ id, at: this.tick + delay });
  }

  private explode(def: BarrelDef, t: number) {
    const c = motionAt(def.m, t);
    this.blown.set(def.id, this.tick);
    this.fx.push({ tick: this.tick, kind: "boom", x: c.x, y: c.y });
    for (const td of this.stage.targets) {
      if (this.dead.has(td.id)) continue;
      const p = motionAt(td.m, t);
      if (Math.hypot(p.x - c.x, p.y - c.y) - td.r < EXPLODE_R) this.kill(td.id, p.x, p.y);
    }
    for (const bd of this.stage.barrels) {
      if (bd.id === def.id || this.blown.has(bd.id)) continue;
      const p = motionAt(bd.m, t);
      if (Math.hypot(p.x - c.x, p.y - c.y) - bd.r < EXPLODE_R) this.ignite(bd.id, CHAIN_DELAY);
    }
    for (const wd of this.stage.weights) {
      const rope = this.ropeOf(wd, t);
      if (rope && distToSeg(c, rope.a, rope.b) < EXPLODE_R) this.cut(wd, t, c.x, c.y);
    }
  }

  step() {
    const t1 = (this.tick + 1) * DT;
    const st = this.stage;

    while (this.queued.length && this.queued[0].tick <= this.tick) {
      const s = this.queued.shift()!;
      if (this.fired.length >= st.ammo) continue;
      this.fired.push({ tick: this.tick, angle: s.angle });
      const d = aimDir(s.angle);
      this.bullets.push({ x: this.gun.x + d.x * 34, y: this.gun.y + d.y * 34, dx: d.x, dy: d.y, born: this.tick, bounces: 0, alive: true, path: [{ x: this.gun.x + d.x * 34, y: this.gun.y + d.y * 34 }] });
      this.fx.push({ tick: this.tick, kind: "shot", x: this.gun.x + d.x * 34, y: this.gun.y + d.y * 34 });
    }

    for (const b of this.bullets) if (b.alive) this.moveBullet(b, t1);

    for (const wd of st.weights) {
      const f = this.falling.get(wd.id);
      if (!f || f.landed) continue;
      const p = this.weightPos(wd, t1);
      for (const td of st.targets) {
        if (this.dead.has(td.id)) continue;
        const q = motionAt(td.m, t1);
        if (Math.hypot(p.x - q.x, p.y - q.y) < wd.r + td.r) {
          this.kill(td.id, q.x, q.y);
          this.fx.push({ tick: this.tick, kind: "smash", x: q.x, y: q.y });
        }
      }
      for (const bd of st.barrels) {
        if (this.blown.has(bd.id)) continue;
        const q = motionAt(bd.m, t1);
        if (Math.hypot(p.x - q.x, p.y - q.y) < wd.r + bd.r) this.ignite(bd.id, 0);
      }
      let land = p.y + wd.r >= FLOOR_Y || p.x < -60 || p.x > W + 60;
      if (!land)
        for (const sd of st.segments) {
          const s = segmentAt(sd, t1);
          if (distToSeg(p, s.a, s.b) < wd.r) {
            land = true;
            break;
          }
        }
      if (land) {
        f.landed = { x: p.x, y: Math.min(p.y, FLOOR_Y - wd.r) };
        this.fx.push({ tick: this.tick, kind: "land", x: p.x, y: f.landed.y + wd.r });
      }
    }

    const due = this.fuses.filter((f) => f.at <= this.tick);
    if (due.length) {
      this.fuses = this.fuses.filter((f) => f.at > this.tick);
      for (const f of due) {
        const bd = st.barrels.find((b) => b.id === f.id);
        if (bd && !this.blown.has(bd.id)) this.explode(bd, t1);
      }
    }

    this.tick++;
  }

  private moveBullet(b: Bullet, t: number) {
    const st = this.stage;
    let left = BULLET_SPEED * DT;
    let skip: string | null = null;
    let guard = 0;
    while (left > 0 && b.alive && guard++ < 8) {
      let best = left;
      let hit: { kind: "wall" | "mirror" | "barrel" | "weight" | "bounds"; id: string; a?: Vec; b?: Vec } | null = null;

      for (const sd of st.segments) {
        if (sd.id === skip) continue;
        const s = segmentAt(sd, t);
        const d = raySeg(b.x, b.y, b.dx, b.dy, s.a, s.b, best);
        if (d >= 0 && d < best) {
          best = d;
          hit = { kind: sd.kind, id: sd.id, a: s.a, b: s.b };
        }
      }
      for (const bd of st.barrels) {
        if (this.blown.has(bd.id)) continue;
        const d = rayCircle(b.x, b.y, b.dx, b.dy, motionAt(bd.m, t), bd.r, best);
        if (d >= 0 && d < best) {
          best = d;
          hit = { kind: "barrel", id: bd.id };
        }
      }
      for (const wd of st.weights) {
        const f = this.falling.get(wd.id);
        if (f?.landed) continue;
        const d = rayCircle(b.x, b.y, b.dx, b.dy, this.weightPos(wd, t), wd.r, best);
        if (d >= 0 && d < best) {
          best = d;
          hit = { kind: "weight", id: wd.id };
        }
      }
      const bx = b.x + b.dx * best;
      const by = b.y + b.dy * best;
      if (bx < 0 || bx > W || by < 0 || by > FLOOR_Y) {
        let s = best;
        if (b.dx < 0) s = Math.min(s, -b.x / b.dx);
        if (b.dx > 0) s = Math.min(s, (W - b.x) / b.dx);
        if (b.dy < 0) s = Math.min(s, -b.y / b.dy);
        if (b.dy > 0) s = Math.min(s, (FLOOR_Y - b.y) / b.dy);
        best = Math.max(0, s);
        hit = { kind: "bounds", id: "" };
      }

      // Pierce through everything soft before the blocking hit.
      for (const td of st.targets) {
        if (this.dead.has(td.id)) continue;
        const c = motionAt(td.m, t);
        const d = rayCircle(b.x, b.y, b.dx, b.dy, c, td.r, best);
        if (d >= 0) this.kill(td.id, b.x + b.dx * d, b.y + b.dy * d);
      }
      for (const wd of st.weights) {
        const rope = this.ropeOf(wd, t);
        if (!rope) continue;
        const d = raySeg(b.x, b.y, b.dx, b.dy, rope.a, rope.b, best);
        if (d >= 0) this.cut(wd, t, b.x + b.dx * d, b.y + b.dy * d);
      }

      b.x += b.dx * best;
      b.y += b.dy * best;
      left -= best;
      if (!hit) break;
      b.path.push({ x: b.x, y: b.y });
      if (hit.kind === "mirror" && hit.a && hit.b && b.bounces < MAX_BOUNCES) {
        const ex = hit.b.x - hit.a.x;
        const ey = hit.b.y - hit.a.y;
        const l = Math.hypot(ex, ey) || 1;
        const nx = -ey / l;
        const ny = ex / l;
        const dot = b.dx * nx + b.dy * ny;
        b.dx -= 2 * dot * nx;
        b.dy -= 2 * dot * ny;
        b.bounces++;
        skip = hit.id;
        this.fx.push({ tick: this.tick, kind: "ricochet", x: b.x, y: b.y });
        continue;
      }
      b.alive = false;
      if (hit.kind === "barrel") {
        this.ignite(hit.id, 0);
      } else {
        this.fx.push({ tick: this.tick, kind: hit.kind === "weight" ? "thud" : "wall", x: b.x, y: b.y });
      }
    }
    if (b.alive && (this.tick + 1 - b.born) * DT > BULLET_LIFE) b.alive = false;
    if (b.alive) {
      const last = b.path[b.path.length - 1];
      if (Math.hypot(last.x - b.x, last.y - b.y) > 40) b.path.push({ x: b.x, y: b.y });
    }
    if (!b.alive) b.path.push({ x: b.x, y: b.y });
  }

  /** Nothing left in flight that could still change the board. */
  quiet(): boolean {
    if (this.bullets.some((b) => b.alive)) return false;
    if (this.fuses.length) return false;
    for (const f of this.falling.values()) if (!f.landed) return false;
    return true;
  }

  targetsLeft(): number {
    return this.stage.targets.filter((d) => d.kind === "target" && !this.dead.has(d.id)).length;
  }

  outcome(): Outcome {
    if (this.hostageDown) return "fail-hostage";
    const q = this.quiet();
    if (this.targetsLeft() === 0) return q ? "win" : "running";
    if (!q) return "running";
    if (this.time >= this.stage.duration) return "fail-time";
    if (this.ammoLeft <= 0) return "fail-ammo";
    return "running";
  }
}

/** Plays reserved shots to the end and reports the outcome. */
export function runShots(stage: StageDef, shots: Shot[], maxExtra = 4): { outcome: Outcome; sim: Sim } {
  const sim = new Sim(stage, shots);
  const limit = Math.ceil((stage.duration + maxExtra) * TPS);
  while (sim.tick < limit) {
    sim.step();
    const o = sim.outcome();
    if (o !== "running") return { outcome: o, sim };
  }
  return { outcome: sim.outcome() === "running" ? "fail-time" : sim.outcome(), sim };
}

/**
 * Aim line for the observation view: from the gun to the first thing that
 * would stop or bend the bullet if everything froze at time t. Deliberately
 * stops at the first mirror — reading the bounce is the puzzle.
 */
export function aimPreview(sim: Sim, angle: number, t: number): { end: Vec; bend: boolean } {
  const st = sim.stage;
  const d = aimDir(angle);
  const px = sim.gun.x + d.x * 34;
  const py = sim.gun.y + d.y * 34;
  let best = 2400;
  let bend = false;
  for (const sd of st.segments) {
    const s = segmentAt(sd, t);
    const r = raySeg(px, py, d.x, d.y, s.a, s.b, best);
    if (r >= 0 && r < best) {
      best = r;
      bend = sd.kind === "mirror";
    }
  }
  for (const bd of st.barrels) {
    if (sim.blown.has(bd.id)) continue;
    const r = rayCircle(px, py, d.x, d.y, motionAt(bd.m, t), bd.r, best);
    if (r >= 0 && r < best) {
      best = r;
      bend = false;
    }
  }
  for (const wd of st.weights) {
    const r = rayCircle(px, py, d.x, d.y, sim.weightPos(wd, t), wd.r, best);
    if (r >= 0 && r < best) {
      best = r;
      bend = false;
    }
  }
  let ex = px + d.x * best;
  let ey = py + d.y * best;
  if (ex < 0 || ex > W || ey < 0 || ey > FLOOR_Y) {
    let s = best;
    if (d.x < 0) s = Math.min(s, -px / d.x);
    if (d.x > 0) s = Math.min(s, (W - px) / d.x);
    if (d.y < 0) s = Math.min(s, -py / d.y);
    if (d.y > 0) s = Math.min(s, (FLOOR_Y - py) / d.y);
    ex = px + d.x * s;
    ey = py + d.y * s;
    bend = false;
  }
  return { end: { x: ex, y: ey }, bend };
}

/** How far each reference shot may drift (time ± / angle ±) and still win. */
export function solutionWindow(stage: StageDef, shots: Shot[]): { ms: number; deg: number }[] {
  return shots.map((_, i) => {
    const winsWith = (s: Shot) => runShots(stage, shots.map((o, j) => (j === i ? s : o))).outcome === "win";
    const base = shots[i];
    const last = Math.floor(stage.duration * TPS);
    let lo = 0;
    while (lo < 240 && base.tick - lo - 1 >= 0 && winsWith({ ...base, tick: base.tick - lo - 1 })) lo++;
    let hi = 0;
    while (hi < 240 && base.tick + hi + 1 < last && winsWith({ ...base, tick: base.tick + hi + 1 })) hi++;
    let alo = 0;
    while (alo < 200 && winsWith({ ...base, angle: base.angle - (alo + 1) * 0.05 })) alo++;
    let ahi = 0;
    while (ahi < 200 && winsWith({ ...base, angle: base.angle + (ahi + 1) * 0.05 })) ahi++;
    return { ms: Math.round(((lo + hi + 1) / TPS) * 1000), deg: Math.round((alo + ahi + 1) * 5) / 100 };
  });
}
