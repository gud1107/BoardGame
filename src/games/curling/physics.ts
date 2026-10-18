/**
 * Deterministic curling-stone physics for 컬링 파티 (rulebook
 * boardGameRule/컬링파티/컬링파티.md §4, §5, §9 — section numbers below refer to it).
 *
 * Every client replays the same `ThrowSim` from the same inputs (aim, weight,
 * spin, party stone, per-0.1s sweep values), so the result must be
 * bit-identical across browsers. That is why this file only uses + − × ÷
 * and `Math.sqrt` (exactly rounded by the ECMAScript spec) — no sin/cos/exp/
 * pow/hypot, whose results may differ in the last bit between JS engines and
 * would be amplified by collisions.
 *
 * World frame (meters): origin = the button (center of the far house),
 * +x = the thrower's right, +y = back toward the thrower. A delivered stone
 * starts at (0, RELEASE_Y) and travels toward −y. The renderer draws −y as
 * "up", so a stone with +1 spin (clockwise, in-turn) curls to the right.
 *
 * No imports — Node can run this file directly for tuning scripts.
 */

// ---------------------------------------------------------------------------
// Sheet geometry (§1) — real World Curling dimensions
// ---------------------------------------------------------------------------

export const STONE_R = 0.145;
export const HOUSE_R = 1.83;
export const RING_8_R = 1.22;
export const RING_4_R = 0.61;
export const BUTTON_R = 0.15;
export const TEE_Y = 0;
export const BACK_Y = -1.83;
export const HOG_Y = 6.4;
/** The near hog line: stones are released here (§4). */
export const RELEASE_Y = HOG_Y + 21.95;
/** The hack (where the delivery slide starts — drawing only). */
export const HACK_Y = RELEASE_Y + 6.4 + 3.66;
/** The near-end house (drawing only — play always goes toward the far house). */
export const NEAR_TEE_Y = RELEASE_Y + 6.4;
export const SHEET_HALF = 2.375;

// ---------------------------------------------------------------------------
// Motion constants (§5) — tuned so a draw takes ~8 s (party pace) and curls ~1.1 m
// ---------------------------------------------------------------------------

/** Simulation tick (seconds). */
export const DT = 1 / 120;
/** Ticks per sweep frame — sweep values are fixed for each 0.1 s frame. */
export const TICKS_PER_FRAME = 12;
/** Safety cap on a single throw (sim seconds). */
export const MAX_TICKS = 120 * 40;
/** Pebbled-ice deceleration (m/s²). */
export const FRICTION = 0.88;
/** Full sweeping cuts friction by this fraction… */
export const SWEEP_FRICTION_CUT = 0.2;
/** …and the curl by this fraction (a swept stone runs straighter). */
export const SWEEP_CURL_CUT = 0.45;
/** Lateral (curl) acceleration = CURL_K / (speed + CURL_V) — curls most as it slows. */
export const CURL_K = 0.31;
export const CURL_V = 0.55;
/** Stone-to-stone restitution (granite is lively but not perfectly elastic). */
export const RESTITUTION = 0.9;
/** A hit stone keeps this much of its curl; the struck stone loses all of it. */
export const HIT_CURL_KEEP = 0.35;
/** Weight gauge: 0..1 maps linearly onto the no-sweep straight-line travel distance (m). */
export const TRAVEL_MIN = 19;
export const TRAVEL_MAX = 40;

// ---------------------------------------------------------------------------
// Party stones (§7)
// ---------------------------------------------------------------------------

export type PartyKind = "heavy" | "bomb" | "sticky" | "swirl" | "ghost" | "magnet";
export const PARTY_KINDS: readonly PartyKind[] = ["heavy", "bomb", "sticky", "swirl", "ghost", "magnet"];
export const HEAVY_MASS = 2;
export const SWIRL_CURL = 2.4;
export const BOMB_RADIUS = 1.25;
/** Outward kick (m/s) for a stone touching the bomb's center, falling off linearly to 0 at BOMB_RADIUS. */
export const BOMB_KICK = 2.6;
/** Magnet pull toward the button (m/s²) while the stone is moving inside the house. */
export const MAGNET_PULL = 0.55;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A resting stone on the sheet (engine state). */
export interface Stone {
  id: number;
  side: number;
  x: number;
  y: number;
  /** Handle angle, cosmetic (radians-ish units, only ever added to). */
  angle: number;
  /** Party stone it was delivered as (persists: a heavy stays heavy, the rest are just a badge). */
  kind: PartyKind | null;
}

export interface ThrowParams {
  /** Skip's broom: the x (m) on the tee line the stone is aimed at. */
  aim: number;
  /** Weight 0..1 (§4). */
  weight: number;
  /** +1 = clockwise (curls right), −1 = counter-clockwise (curls left). */
  spin: 1 | -1;
  /** Party stone used on this throw, if any. */
  kind: PartyKind | null;
}

export interface SimStone extends Stone {
  vx: number;
  vy: number;
  /** Curl direction × strength (±1 for a fresh delivery, 0 for a struck stone). */
  curl: number;
  mass: number;
  /** This is the delivered stone. */
  delivered: boolean;
  /** Ghost phase: passes through other stones (§7 유령). */
  ghost: boolean;
  /** Sticky still armed: the first contact glues both stones in place (§7 끈끈이). */
  sticky: boolean;
  out: OutReason | null;
}

export type OutReason = "back" | "side" | "hog" | "bomb";

export type SimEvent =
  | { kind: "hit"; tick: number; a: number; b: number; x: number; y: number; power: number }
  | { kind: "out"; tick: number; id: number; reason: OutReason; x: number; y: number }
  | { kind: "bomb"; tick: number; x: number; y: number }
  | { kind: "stick"; tick: number; a: number; b: number; x: number; y: number }
  | { kind: "solid"; tick: number; id: number }
  | { kind: "tee"; tick: number };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Straight-line no-sweep travel distance (m) for a gauge weight. */
export function travelFor(weight: number): number {
  return TRAVEL_MIN + clamp(weight, 0, 1) * (TRAVEL_MAX - TRAVEL_MIN);
}

/** Inverse of `travelFor` (unclamped). */
export function weightForTravel(travel: number): number {
  return (travel - TRAVEL_MIN) / (TRAVEL_MAX - TRAVEL_MIN);
}

/** Release speed (m/s) for a gauge weight: v² = 2·a·d. */
export function speedFor(weight: number): number {
  return Math.sqrt(2 * FRICTION * travelFor(weight));
}

/** Unit direction from the release point toward the broom on the tee line. */
export function aimDir(aim: number): { x: number; y: number } {
  const dx = aim;
  const dy = TEE_Y - RELEASE_Y;
  const len = Math.sqrt(dx * dx + dy * dy);
  return { x: dx / len, y: dy / len };
}

export function distToButton(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/** Touching the house counts (§9). */
export function inHouse(s: { x: number; y: number }): boolean {
  return distToButton(s.x, s.y) <= HOUSE_R + STONE_R;
}

/** Between the hog line and the tee line but not in the house (§8 프리 가드 존). */
export function inFreeGuardZone(s: { x: number; y: number }): boolean {
  return s.y > TEE_Y && s.y - STONE_R < HOG_Y && !inHouse(s);
}

/** Rounds to a fixed grid so actions serialize exactly. */
export function quantize(v: number, step: number): number {
  return Math.round(v / step) * step;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export class ThrowSim {
  readonly stones: SimStone[];
  readonly events: SimEvent[] = [];
  tick = 0;
  done = false;
  /** The delivered stone touched another stone (hog-line exemption, §5). */
  contact = false;
  passedTee = false;
  private bombDone = false;

  constructor(resting: readonly Stone[], params: ThrowParams, side: number, id: number) {
    this.stones = resting.map((s) => ({
      ...s,
      vx: 0,
      vy: 0,
      curl: 0,
      mass: s.kind === "heavy" ? HEAVY_MASS : 1,
      delivered: false,
      ghost: false,
      sticky: false,
      out: null,
    }));
    const dir = aimDir(params.aim);
    const v0 = speedFor(params.weight);
    const kind = params.kind;
    this.stones.push({
      id,
      side,
      x: 0,
      y: RELEASE_Y,
      angle: 0,
      kind,
      vx: dir.x * v0,
      vy: dir.y * v0,
      curl: params.spin * (kind === "swirl" ? SWIRL_CURL : 1),
      mass: kind === "heavy" ? HEAVY_MASS : 1,
      delivered: true,
      ghost: kind === "ghost",
      sticky: kind === "sticky",
      out: null,
    });
  }

  get frame(): number {
    return Math.floor(this.tick / TICKS_PER_FRAME);
  }

  deliveredStone(): SimStone {
    return this.stones[this.stones.length - 1];
  }

  /** Effective sweep on the delivered stone: own side always, rivals only past the tee line (§6). */
  sweepFor(own: number, opp: number): number {
    const d = this.deliveredStone();
    return clamp(own + (d.y < TEE_Y ? opp : 0), 0, 1);
  }

  private moving(s: SimStone): boolean {
    return s.out === null && (s.vx !== 0 || s.vy !== 0);
  }

  /** Advance one tick. `own`/`opp` are this frame's sweep intensities 0..1. */
  step(own = 0, opp = 0): void {
    if (this.done) return;
    const sweep = this.sweepFor(own, opp);
    for (const s of this.stones) {
      if (!this.moving(s)) continue;
      const sw = s.delivered ? sweep : 0;
      let speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
      // curl: lateral push to the right of travel for +curl
      if (s.curl !== 0) {
        const lat = (s.curl * CURL_K * (1 - SWEEP_CURL_CUT * sw)) / (speed + CURL_V);
        const rx = -s.vy / speed;
        const ry = s.vx / speed;
        s.vx += rx * lat * DT;
        s.vy += ry * lat * DT;
      }
      if (s.delivered && s.kind === "magnet") {
        const d = distToButton(s.x, s.y);
        if (d <= HOUSE_R && d > 0.02) {
          s.vx -= (s.x / d) * MAGNET_PULL * DT;
          s.vy -= (s.y / d) * MAGNET_PULL * DT;
        }
      }
      speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
      const decel = FRICTION * (1 - SWEEP_FRICTION_CUT * sw) * DT;
      if (speed <= decel) {
        s.vx = 0;
        s.vy = 0;
      } else {
        const k = (speed - decel) / speed;
        s.vx *= k;
        s.vy *= k;
        s.x += s.vx * DT;
        s.y += s.vy * DT;
        // handle rotation (cosmetic): ~1 turn per 10 m for a curling stone
        s.angle += (s.curl === 0 ? 0 : s.curl > 0 ? 1 : -1) * speed * DT * 0.6;
      }
      // out of play: touching the side boards, or completely past the back line (§5)
      if (s.x > SHEET_HALF - STONE_R || s.x < -SHEET_HALF + STONE_R) this.remove(s, "side");
      else if (s.y < BACK_Y - STONE_R) this.remove(s, "back");
    }
    const d = this.deliveredStone();
    if (!this.passedTee && d.out === null && d.y < TEE_Y) {
      this.passedTee = true;
      this.events.push({ kind: "tee", tick: this.tick });
    }
    // ghost turns solid once inside the house front and clear of every stone
    if (d.ghost && d.out === null && d.y <= HOUSE_R + STONE_R && !this.overlapsAny(d)) {
      d.ghost = false;
      this.events.push({ kind: "solid", tick: this.tick, id: d.id });
    }
    this.collide();
    this.tick += 1;
    if (!this.stones.some((s) => this.moving(s))) this.settle();
    if (this.tick >= MAX_TICKS) {
      for (const s of this.stones) {
        s.vx = 0;
        s.vy = 0;
      }
      this.settle();
    }
  }

  private remove(s: SimStone, reason: OutReason) {
    s.out = reason;
    s.vx = 0;
    s.vy = 0;
    this.events.push({ kind: "out", tick: this.tick, id: s.id, reason, x: s.x, y: s.y });
  }

  private overlapsAny(s: SimStone): boolean {
    for (const o of this.stones) {
      if (o === s || o.out !== null) continue;
      const dx = o.x - s.x;
      const dy = o.y - s.y;
      if (dx * dx + dy * dy < 4 * STONE_R * STONE_R) return true;
    }
    return false;
  }

  /** Deep copy (bots look ahead "what if we sweep / don't sweep from here"). */
  clone(): ThrowSim {
    const c = Object.create(ThrowSim.prototype) as ThrowSim;
    Object.assign(c, this);
    (c as { stones: SimStone[] }).stones = this.stones.map((s) => ({ ...s }));
    (c as { events: SimEvent[] }).events = [...this.events];
    return c;
  }

  private collide() {
    const n = this.stones.length;
    const min2 = 4 * STONE_R * STONE_R;
    // pairs where at least one stone moves; a moving pair is handled once, by its lower index
    for (let i = 0; i < n; i++) {
      const a = this.stones[i];
      if (a.out !== null || a.ghost || (a.vx === 0 && a.vy === 0)) continue;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const b = this.stones[j];
        if (b.out !== null || b.ghost) continue;
        const bMoving = b.vx !== 0 || b.vy !== 0;
        if (bMoving && j < i) continue;
        if (a.vx === 0 && a.vy === 0 && !bMoving) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min2 || d2 === 0) continue;
        const dist = Math.sqrt(d2);
        const nx = dx / dist;
        const ny = dy / dist;
        const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        // positional correction so stones never sink into each other
        const overlap = 2 * STONE_R - dist;
        const ia = 1 / a.mass;
        const ib = 1 / b.mass;
        a.x += nx * overlap * (ia / (ia + ib));
        a.y += ny * overlap * (ia / (ia + ib));
        b.x -= nx * overlap * (ib / (ia + ib));
        b.y -= ny * overlap * (ib / (ia + ib));
        if (rel >= 0) continue;
        if (a.delivered || b.delivered) this.contact = true;
        const hx = (a.x + b.x) / 2;
        const hy = (a.y + b.y) / 2;
        if (a.sticky || b.sticky) {
          a.sticky = false;
          b.sticky = false;
          a.vx = a.vy = b.vx = b.vy = 0;
          a.curl = b.curl = 0;
          this.events.push({ kind: "stick", tick: this.tick, a: a.id, b: b.id, x: hx, y: hy });
          continue;
        }
        // the stone that was moving faster is the hitter; it keeps a little curl
        const aWasHitter = a.vx * a.vx + a.vy * a.vy > b.vx * b.vx + b.vy * b.vy;
        const jImp = (-(1 + RESTITUTION) * rel) / (ia + ib);
        a.vx += jImp * ia * nx;
        a.vy += jImp * ia * ny;
        b.vx -= jImp * ib * nx;
        b.vy -= jImp * ib * ny;
        a.curl = aWasHitter ? a.curl * HIT_CURL_KEEP : 0;
        b.curl = aWasHitter ? 0 : b.curl * HIT_CURL_KEEP;
        this.events.push({ kind: "hit", tick: this.tick, a: a.id, b: b.id, x: hx, y: hy, power: -rel });
      }
    }
  }

  /** Everything stopped: bomb (§7), ghost clean-up, hog line (§5). */
  private settle() {
    const d = this.deliveredStone();
    if (d.out === null && d.kind === "bomb" && !this.bombDone) {
      this.bombDone = true;
      this.events.push({ kind: "bomb", tick: this.tick, x: d.x, y: d.y });
      this.remove(d, "bomb");
      let kicked = false;
      for (const s of this.stones) {
        if (s.out !== null) continue;
        const dx = s.x - d.x;
        const dy = s.y - d.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= BOMB_RADIUS) continue;
        const kick = (BOMB_KICK * (1 - dist / BOMB_RADIUS)) / s.mass;
        if (dist < 1e-6) {
          s.vy = -kick;
        } else {
          s.vx += (dx / dist) * kick;
          s.vy += (dy / dist) * kick;
        }
        kicked = true;
      }
      if (kicked) return; // keep simulating the blast
    }
    if (d.out === null && d.ghost) {
      // stopped while still overlapping something: back off toward the thrower until clear
      for (let k = 0; k < 400 && this.overlapsAny(d); k++) d.y += 0.01;
      d.ghost = false;
    }
    if (d.out === null && !this.contact && d.y + STONE_R > HOG_Y) this.remove(d, "hog");
    this.done = true;
  }

  /** Resting stones still in play, in a stable order (engine state). */
  restingStones(): Stone[] {
    return this.stones.filter((s) => s.out === null).map(({ id, side, x, y, angle, kind }) => ({ id, side, x, y, angle, kind }));
  }
}

/** Run a throw to completion with recorded per-frame sweep values (0..10 each). */
export function runThrow(resting: readonly Stone[], params: ThrowParams, side: number, id: number, sweepOwn: readonly number[] = [], sweepOpp: readonly number[] = []): ThrowSim {
  const sim = new ThrowSim(resting, params, side, id);
  while (!sim.done) {
    const f = sim.frame;
    sim.step((sweepOwn[f] ?? 0) / 10, (sweepOpp[f] ?? 0) / 10);
  }
  return sim;
}

/** Where a lone stone would come to rest (no other stones, no sweep). */
export function restingPoint(params: ThrowParams): { x: number; y: number; out: OutReason | null; ticks: number } {
  const sim = runThrow([], params, 0, 0);
  const d = sim.deliveredStone();
  return { x: d.x, y: d.y, out: d.out, ticks: sim.tick };
}
