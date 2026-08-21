/**
 * Client-local visual FX layer for the real-time worm renderer
 * (`WormCanvas.tsx`) — no React, no network awareness, pure canvas math.
 *
 * ## Why this has to be event-diffing, not action-driven
 *
 * Every discrete-action game in this project fires its FX straight from the
 * action just applied (`applyAction` returns a new state, the UI diffs *that*
 * transition). Worm has no actions — `stepWorm` is a continuous physics
 * advance (see `engine.ts`'s module doc) and only the host ever calls it;
 * every other client (and the host's own renderer) just receives periodic
 * `WormState` snapshots. So the only way a client can know "seat 3 just ate a
 * pellet" or "seat 1 just got cut" is to diff two consecutive snapshots
 * itself — `detectWormEvents(prev, next)` below does exactly that, using the
 * same collision/consumption rules `stepWorm` applies internally (mirrored,
 * not imported, since the engine doesn't record *why* a death happened —
 * only the end state — so this is a best-effort reconstruction from the
 * numbers, not a replay). It's deliberately approximate (e.g. "was any other
 * head near the death point" for head-vs-head vs. self-collision) because
 * it only ever drives cosmetics, never gameplay.
 *
 * ## Why pooled arrays instead of `Particle[]` + push/splice
 *
 * A crowded 8-player match can spawn hundreds of particles per second
 * (explosions, cut sparks, boost trails). Growing/shrinking arrays every
 * frame is GC churn the requested 60fps budget can't afford on mobile, so
 * every FX layer below is a fixed-capacity array that spawns by overwriting
 * a round-robin cursor slot (see `spawnSlot`) — zero allocation once warmed
 * up, and a slot that's still "alive" when the cursor wraps back to it just
 * gets cut short a little early, which is invisible at these lifespans
 * (<1s) and these capacities (never all in-flight at once in practice).
 */

import { BODY_RADIUS, HEAD_RADIUS, type ArenaSize, type SeatIndex, type Vec2, type WormState } from "./engine";

// ---------------------------------------------------------------------------
// Event detection (pure, unit-testable — see Worm.test.ts)
// ---------------------------------------------------------------------------

export type WormEvent =
  | { type: "eat"; seat: SeatIndex; pos: Vec2; value: number; hue: number }
  | { type: "cut"; targetSeat: SeatIndex; attackerSeat: SeatIndex | null; pos: Vec2; hue: number }
  | { type: "death"; seat: SeatIndex; cause: "self" | "wall" | "head"; attackerSeat: SeatIndex | null; pos: Vec2; segments: Vec2[]; hue: number };

const HEAD_TO_HEAD_DIST = HEAD_RADIUS * 2 + 6;
const WALL_MARGIN = HEAD_RADIUS + 6;
const CUT_ATTACKER_RADIUS = HEAD_RADIUS + BODY_RADIUS + 10;

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** `#rrggbb` -> `rgba(r, g, b, alpha)`. Only ever called with the literal hex colors this file spawns FX with, not user input. */
function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function nearWall(pos: Vec2, arena: ArenaSize): boolean {
  return pos.x <= WALL_MARGIN || pos.x >= arena.width - WALL_MARGIN || pos.y <= WALL_MARGIN || pos.y >= arena.height - WALL_MARGIN;
}

/**
 * Diffs two consecutive `WormState` snapshots into cosmetic events. Called
 * once per incoming network snapshot (~11Hz), not per rendered frame.
 */
export function detectWormEvents(prev: WormState, next: WormState): WormEvent[] {
  const events: WormEvent[] = [];

  for (let seat = 0; seat < prev.playerCount; seat++) {
    const before = prev.snakes[seat];
    const after = next.snakes[seat];
    if (!before || !after) continue;

    if (before.alive && after.alive) {
      // Eat: cumulative score only ever rises on a pellet pickup.
      if (after.score > before.score) {
        events.push({ type: "eat", seat, pos: after.path[0] ?? before.path[0], value: after.score - before.score, hue: after.hue });
      }
      // Cut: boosting can shave at most ~1 segment per visible snapshot
      // (BOOST_DRAIN_MS is longer than the snapshot interval), so a bigger
      // single-tick drop means something bit the tail off instead.
      if (after.length < before.length - 1 && before.segments.length > 0) {
        const cutIdx = Math.min(Math.max(after.length, 0), before.segments.length - 1);
        const pos = before.segments[cutIdx];
        let attackerSeat: SeatIndex | null = null;
        let bestDist = CUT_ATTACKER_RADIUS;
        for (let b = 0; b < prev.playerCount; b++) {
          if (b === seat) continue;
          const other = prev.snakes[b];
          if (!other?.alive) continue;
          const d = dist(other.path[0], pos);
          if (d < bestDist) {
            bestDist = d;
            attackerSeat = b;
          }
        }
        events.push({ type: "cut", targetSeat: seat, attackerSeat, pos, hue: after.hue });
      }
    } else if (before.alive && !after.alive) {
      const pos = before.path[0] ?? { x: 0, y: 0 };
      let cause: "self" | "wall" | "head" = "self";
      // For a "head" death (the only cause another player can be credited
      // with — see `stepWorm`'s collision table, `engine.ts:422-436`: a body
      // cut can never itself be lethal), attribute it to the closest
      // surviving head in range, same nearest-attacker pattern as the cut
      // event above — this is what drives the kill banner/gold-aura FX.
      let attackerSeat: SeatIndex | null = null;
      if (nearWall(pos, prev.arena)) {
        cause = "wall";
      } else {
        let bestDist = HEAD_TO_HEAD_DIST;
        for (let b = 0; b < prev.playerCount; b++) {
          if (b === seat) continue;
          const other = prev.snakes[b];
          if (!other?.alive) continue;
          const d = dist(other.path[0], pos);
          if (d < bestDist) {
            bestDist = d;
            cause = "head";
            attackerSeat = b;
          }
        }
      }
      events.push({ type: "death", seat, cause, attackerSeat, pos, segments: before.segments, hue: before.hue });
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Pooled FX primitives
// ---------------------------------------------------------------------------

interface Particle {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  hue: number;
  sat: number;
  light: number;
  baseAlpha: number;
  drag: number;
}

interface FloatingText {
  alive: boolean;
  x: number;
  y: number;
  vy: number;
  age: number;
  life: number;
  text: string;
  color: string;
}

interface Ring {
  alive: boolean;
  x: number;
  y: number;
  age: number;
  life: number;
  maxRadius: number;
  hue: number;
}

interface Flash {
  alive: boolean;
  x: number;
  y: number;
  age: number;
  life: number;
  radius: number;
  hue: number;
}

interface Slash {
  alive: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  age: number;
  life: number;
}

/** Spawns into a fixed-capacity pool by overwriting the next round-robin slot — see module doc. */
function spawnSlot<T extends { alive: boolean }>(pool: T[], cursor: number, init: Omit<T, "alive">): number {
  Object.assign(pool[cursor], init, { alive: true });
  return (cursor + 1) % pool.length;
}

const PARTICLE_CAPACITY = 480;
const TEXT_CAPACITY = 24;
const RING_CAPACITY = 8;
const FLASH_CAPACITY = 8;
const SLASH_CAPACITY = 16;

const EAT_BURST_COUNT = 9;
const EAT_PULSE_MS = 220;
const CUT_SPARK_COUNT = 10;
const CUT_DEBRIS_COUNT = 6;
const HIT_GLOW_MS = 260;
const EXPLOSION_DEBRIS_COUNT = 30;
const EXPLOSION_FLASH_MS = 160;
const EXPLOSION_RING_MS = 480;
const EXPLOSION_RING_RADIUS = 78;
const SELF_SHAKE_MS = 180;
const SELF_SHAKE_MAGNITUDE = 6; // CSS px
const CORPSE_FADE_MS = 650;
const FLOAT_TEXT_MS = 800;
const FLOAT_TEXT_RISE = 60; // world units
const BOOST_TRAIL_INTERVAL_MS = 45;

// ---------------------------------------------------------------------------
// Kill FX (opponent eliminated via a head-to-head collision — the only death
// cause another player can be credited with, see `detectWormEvents` above).
// Deliberately bigger/longer than the self-destruct explosion above per the
// kill-FX request session's confirmed answers: shake ~12px/200ms (stronger
// than self-destruct's 6px/180ms), applied to both the killer's and victim's
// own screens; orb lifespan kept inside the request's explicit 0.5–0.8s
// budget so a crowded match never queues more than one lifespan's worth of
// kill particles per pooled slot.
// ---------------------------------------------------------------------------
const KILL_RING_MS = 620;
const KILL_RING_RADIUS = 130;
const KILL_RING_SECONDARY_LIFE_MULT = 0.7;
const KILL_RING_SECONDARY_RADIUS_MULT = 0.6;
const KILL_FLASH_MS = 200;
const KILL_FLASH_RADIUS_MULT = 0.75;
const KILL_DEBRIS_COUNT = 46; // multi-color neon debris (point 1: "다색 불꽃 파티클")
const KILL_SPARK_COUNT = 26;
const KILL_ORB_LIFE_MS: [number, number] = [520, 780]; // "에너지 구슬" body-segment collapse, 0.5-0.8s per the request
const KILL_SHAKE_MS = 200;
const KILL_SHAKE_MAGNITUDE = 12; // CSS px — user-confirmed stronger-than-self-destruct tier
const KILL_SCREEN_FLASH_MS = 180;
const GOLD_AURA_MS = 1300; // killer's gold aura pulse — stays lit roughly through the kill banner's hold phase

/**
 * Owns every pooled FX layer plus the small per-seat transient maps (head
 * scale-pulse, hit-glow, boost-trail throttling). One instance lives for the
 * lifetime of a `WormCanvas` mount (see its `useRef` there); `handleEvents`
 * is called once per new network snapshot, `update`/`updateLiveBoost` once
 * per rendered frame, `draw` once per rendered frame after the world.
 */
export class WormEffectsManager {
  private particles: Particle[] = Array.from({ length: PARTICLE_CAPACITY }, () => ({ alive: false, x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1, size: 2, hue: 0, sat: 80, light: 60, baseAlpha: 1, drag: 0 }));
  private particleCursor = 0;
  private texts: FloatingText[] = Array.from({ length: TEXT_CAPACITY }, () => ({ alive: false, x: 0, y: 0, vy: 0, age: 0, life: 1, text: "", color: "#fff" }));
  private textCursor = 0;
  private rings: Ring[] = Array.from({ length: RING_CAPACITY }, () => ({ alive: false, x: 0, y: 0, age: 0, life: 1, maxRadius: 40, hue: 20 }));
  private ringCursor = 0;
  private flashes: Flash[] = Array.from({ length: FLASH_CAPACITY }, () => ({ alive: false, x: 0, y: 0, age: 0, life: 1, radius: 40, hue: 30 }));
  private flashCursor = 0;
  private slashes: Slash[] = Array.from({ length: SLASH_CAPACITY }, () => ({ alive: false, x1: 0, y1: 0, x2: 0, y2: 0, age: 0, life: 1 }));
  private slashCursor = 0;

  private headPulseExpiry = new Map<SeatIndex, number>();
  private hitGlowExpiry = new Map<SeatIndex, number>();
  private lastBoostSpawn = new Map<SeatIndex, number>();
  /** Gold aura pulse expiry per seat — set on whoever just landed a kill (`onDeath`'s "head" cause), read by `killerAuraAlpha`. */
  private killerAuraExpiry = new Map<SeatIndex, number>();

  /** Internal clock, advanced by `update`; every expiry above is stored as an absolute time on this clock. */
  private clock = 0;
  private shakeTimeLeft = 0;
  private shakeTotalMs = SELF_SHAKE_MS;
  private shakeMagnitude = 0;
  /** Full-screen white/neon kill flash (point 2) — separate from the world-space `flashes` pool since this one is drawn in screen space, after the shake translate. */
  private screenFlashTimeLeft = 0;

  private spawnParticle(init: Omit<Particle, "alive" | "age">) {
    this.particleCursor = spawnSlot(this.particles, this.particleCursor, { ...init, age: 0 });
  }

  private spawnBurst(pos: Vec2, count: number, opts: { speed: [number, number]; size: [number, number]; life: [number, number]; hue: number; sat?: number; light?: number; drag?: number }) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = opts.speed[0] + Math.random() * (opts.speed[1] - opts.speed[0]);
      this.spawnParticle({
        x: pos.x,
        y: pos.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: opts.life[0] + Math.random() * (opts.life[1] - opts.life[0]),
        size: opts.size[0] + Math.random() * (opts.size[1] - opts.size[0]),
        hue: opts.hue + (Math.random() - 0.5) * 20,
        sat: opts.sat ?? 80,
        light: opts.light ?? 60,
        baseAlpha: 1,
        drag: opts.drag ?? 2.2,
      });
    }
  }

  // -------------------------------------------------------------------
  // Event dispatch — one call per network snapshot.
  // -------------------------------------------------------------------
  handleEvents(events: WormEvent[], viewerSeat: SeatIndex) {
    for (const ev of events) {
      if (ev.type === "eat") this.onEat(ev);
      else if (ev.type === "cut") this.onCut(ev);
      else this.onDeath(ev, viewerSeat);
    }
  }

  private onEat(ev: Extract<WormEvent, { type: "eat" }>) {
    this.spawnBurst(ev.pos, EAT_BURST_COUNT, { speed: [30, 90], size: [1.5, 3.5], life: [280, 460], hue: ev.hue, sat: 90, light: 70, drag: 3 });
    this.textCursor = spawnSlot(this.texts, this.textCursor, { x: ev.pos.x, y: ev.pos.y, vy: -FLOAT_TEXT_RISE / (FLOAT_TEXT_MS / 1000), age: 0, life: FLOAT_TEXT_MS, text: `+${ev.value}`, color: "#fef08a" });
    this.headPulseExpiry.set(ev.seat, this.clock + EAT_PULSE_MS);
  }

  private onCut(ev: Extract<WormEvent, { type: "cut" }>) {
    // Bright metallic sparks (the doc's "챙-!" moment) plus a few
    // target-hue debris chunks so the severed segments visibly scatter
    // before they settle back into ordinary food pellets.
    this.spawnBurst(ev.pos, CUT_SPARK_COUNT, { speed: [70, 170], size: [1, 2.4], life: [140, 260], hue: 50, sat: 90, light: 85, drag: 4 });
    this.spawnBurst(ev.pos, CUT_DEBRIS_COUNT, { speed: [40, 100], size: [2.5, 4.5], life: [300, 500], hue: ev.hue, sat: 75, light: 55, drag: 2.5 });
    const angle = Math.random() * Math.PI;
    const half = 16;
    this.slashCursor = spawnSlot(this.slashes, this.slashCursor, {
      x1: ev.pos.x - Math.cos(angle) * half,
      y1: ev.pos.y - Math.sin(angle) * half,
      x2: ev.pos.x + Math.cos(angle) * half,
      y2: ev.pos.y + Math.sin(angle) * half,
      age: 0,
      life: 180,
    });
    if (ev.attackerSeat !== null) this.hitGlowExpiry.set(ev.attackerSeat, this.clock + HIT_GLOW_MS);
  }

  private onDeath(ev: Extract<WormEvent, { type: "death" }>, viewerSeat: SeatIndex) {
    const isKill = ev.cause === "head" && ev.attackerSeat !== null;

    // General disintegration: every remembered body segment drifts outward
    // and fades — applies to every death cause per the request's point 4. A
    // kill death (opponent eliminated) gets the brighter "energy orb"
    // treatment instead of the plain corpse-fade dots (point 2: "에너지 구슬
    // 변환"), still within the request's explicit 0.5-0.8s particle budget.
    for (const seg of ev.segments) {
      const angle = Math.random() * Math.PI * 2;
      if (isKill) {
        const speed = 30 + Math.random() * 70;
        this.spawnParticle({ x: seg.x, y: seg.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: KILL_ORB_LIFE_MS[0] + Math.random() * (KILL_ORB_LIFE_MS[1] - KILL_ORB_LIFE_MS[0]), size: 4.5 + Math.random() * 3, hue: ev.hue, sat: 92, light: 76, baseAlpha: 1, drag: 1.1 });
      } else {
        const speed = 15 + Math.random() * 35;
        this.spawnParticle({ x: seg.x, y: seg.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: CORPSE_FADE_MS * (0.7 + Math.random() * 0.5), size: 3 + Math.random() * 2.5, hue: ev.hue, sat: 55, light: 45, baseAlpha: 0.85, drag: 1.4 });
      }
    }

    if (ev.cause === "self") {
      // Self-destruct: the explosion is reserved for "A의 머리 vs A의 몸통
      // (자폭)" per the rule doc, not every death (see the self-destruct-scope
      // question the prior FX session confirmed).
      this.ringCursor = spawnSlot(this.rings, this.ringCursor, { x: ev.pos.x, y: ev.pos.y, age: 0, life: EXPLOSION_RING_MS, maxRadius: EXPLOSION_RING_RADIUS, hue: 26 });
      this.flashCursor = spawnSlot(this.flashes, this.flashCursor, { x: ev.pos.x, y: ev.pos.y, age: 0, life: EXPLOSION_FLASH_MS, radius: EXPLOSION_RING_RADIUS * 0.7, hue: 40 });
      this.spawnBurst(ev.pos, EXPLOSION_DEBRIS_COUNT, { speed: [80, 260], size: [2, 5], life: [280, 560], hue: 22, sat: 95, light: 58, drag: 1.8 });
      if (ev.seat === viewerSeat) {
        this.shakeTimeLeft = SELF_SHAKE_MS;
        this.shakeTotalMs = SELF_SHAKE_MS;
        this.shakeMagnitude = SELF_SHAKE_MAGNITUDE;
      }
      return;
    }

    if (!isKill || ev.attackerSeat === null) return; // wall death — no shockwave/shake beyond the general disintegration above
    const attackerSeat = ev.attackerSeat; // narrowed non-null by the check above

    // ---- Massive kill explosion (point 1: "처치 지점 대형 폭발 파티클") ----
    // Two overlapping rings (own hue + a shifted accent hue) read as a
    // fuller shockwave than a single ring, plus a bigger, multi-hue debris
    // burst than the self-destruct explosion above.
    this.ringCursor = spawnSlot(this.rings, this.ringCursor, { x: ev.pos.x, y: ev.pos.y, age: 0, life: KILL_RING_MS, maxRadius: KILL_RING_RADIUS, hue: ev.hue });
    this.ringCursor = spawnSlot(this.rings, this.ringCursor, { x: ev.pos.x, y: ev.pos.y, age: 0, life: KILL_RING_MS * KILL_RING_SECONDARY_LIFE_MULT, maxRadius: KILL_RING_RADIUS * KILL_RING_SECONDARY_RADIUS_MULT, hue: (ev.hue + 40) % 360 });
    this.flashCursor = spawnSlot(this.flashes, this.flashCursor, { x: ev.pos.x, y: ev.pos.y, age: 0, life: KILL_FLASH_MS, radius: KILL_RING_RADIUS * KILL_FLASH_RADIUS_MULT, hue: 48 });
    this.spawnBurst(ev.pos, KILL_DEBRIS_COUNT, { speed: [90, 320], size: [2, 5.5], life: [420, 780], hue: ev.hue, sat: 95, light: 62, drag: 1.5 });
    this.spawnBurst(ev.pos, KILL_SPARK_COUNT, { speed: [140, 380], size: [1, 2.6], life: [280, 520], hue: (ev.hue + 150) % 360, sat: 95, light: 80, drag: 2.6 });

    // ---- Screen shake + white/neon flash (point 2) — killer's AND
    // victim's own screens, per this session's confirmed answer (not every
    // spectator's, to keep the jolt tied to the two players actually in the
    // exchange). ----
    if (viewerSeat === attackerSeat || viewerSeat === ev.seat) {
      this.shakeTimeLeft = KILL_SHAKE_MS;
      this.shakeTotalMs = KILL_SHAKE_MS;
      this.shakeMagnitude = KILL_SHAKE_MAGNITUDE;
      this.screenFlashTimeLeft = KILL_SCREEN_FLASH_MS;
    }

    // ---- Killer gold aura pulse (point 2) — world-space, so visible to
    // everyone watching the killer's head, not just the killer. ----
    this.killerAuraExpiry.set(attackerSeat, this.clock + GOLD_AURA_MS);
  }

  // -------------------------------------------------------------------
  // Continuous (per-frame, not event-driven) — boost trail.
  // -------------------------------------------------------------------
  updateLiveBoost(state: WormState) {
    for (let seat = 0; seat < state.playerCount; seat++) {
      const snake = state.snakes[seat];
      if (!snake?.alive || !snake.boosting || snake.segments.length === 0) continue;
      const last = this.lastBoostSpawn.get(seat) ?? -Infinity;
      if (this.clock - last < BOOST_TRAIL_INTERVAL_MS) continue;
      this.lastBoostSpawn.set(seat, this.clock);
      const tail = snake.segments[snake.segments.length - 1];
      const angle = Math.random() * Math.PI * 2;
      this.spawnParticle({ x: tail.x + Math.cos(angle) * 4, y: tail.y + Math.sin(angle) * 4, vx: Math.cos(angle) * 8, vy: Math.sin(angle) * 8, life: 260 + Math.random() * 140, size: 2.5 + Math.random() * 2, hue: snake.hue, sat: 40, light: 60, baseAlpha: 0.45, drag: 1 });
    }
  }

  // -------------------------------------------------------------------
  // Frame advance — ages every pooled item and the shake timer.
  // -------------------------------------------------------------------
  update(dtMs: number) {
    this.clock += dtMs;
    const dtSec = dtMs / 1000;
    for (const p of this.particles) {
      if (!p.alive) continue;
      p.age += dtMs;
      if (p.age >= p.life) {
        p.alive = false;
        continue;
      }
      const damp = Math.max(0, 1 - p.drag * dtSec);
      p.vx *= damp;
      p.vy *= damp;
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
    }
    for (const t of this.texts) {
      if (!t.alive) continue;
      t.age += dtMs;
      if (t.age >= t.life) {
        t.alive = false;
        continue;
      }
      t.y += t.vy * dtSec;
    }
    for (const r of this.rings) {
      if (!r.alive) continue;
      r.age += dtMs;
      if (r.age >= r.life) r.alive = false;
    }
    for (const f of this.flashes) {
      if (!f.alive) continue;
      f.age += dtMs;
      if (f.age >= f.life) f.alive = false;
    }
    for (const s of this.slashes) {
      if (!s.alive) continue;
      s.age += dtMs;
      if (s.age >= s.life) s.alive = false;
    }
    this.shakeTimeLeft = Math.max(0, this.shakeTimeLeft - dtMs);
    this.screenFlashTimeLeft = Math.max(0, this.screenFlashTimeLeft - dtMs);
  }

  // -------------------------------------------------------------------
  // Per-seat cosmetic queries used by WormCanvas's snake rendering.
  // -------------------------------------------------------------------
  /** Head radius multiplier — eases back to 1 as the eat-pulse expires. */
  headScale(seat: SeatIndex): number {
    const expiry = this.headPulseExpiry.get(seat);
    if (expiry === undefined) return 1;
    const remaining = expiry - this.clock;
    if (remaining <= 0) return 1;
    const t = remaining / EAT_PULSE_MS; // 1 -> 0
    return 1 + 0.32 * Math.sin(t * Math.PI); // pulse out and back, peak mid-flight
  }

  /** 0..1 alpha for the hit-impact glow ring drawn around a successful attacker's head. */
  headGlowAlpha(seat: SeatIndex): number {
    const expiry = this.hitGlowExpiry.get(seat);
    if (expiry === undefined) return 0;
    const remaining = expiry - this.clock;
    if (remaining <= 0) return 0;
    return remaining / HIT_GLOW_MS;
  }

  /** Screen-space (CSS px) camera jitter while a viewer-triggered self-destruct or kill shake is active. */
  consumeShakeOffset(): { dx: number; dy: number } {
    if (this.shakeTimeLeft <= 0) return { dx: 0, dy: 0 };
    // `shakeTotalMs` is whichever duration (self-destruct or kill tier) the
    // active shake started with, so the linear decay below is correct for
    // either one without needing to know which triggered it.
    const t = this.shakeTimeLeft / this.shakeTotalMs;
    const m = this.shakeMagnitude * t;
    return { dx: (Math.random() * 2 - 1) * m, dy: (Math.random() * 2 - 1) * m };
  }

  /** 0..1 alpha for the full-screen white/neon flash on a kill (point 2), for the killer's and victim's own screens only. */
  screenFlashAlpha(): number {
    if (this.screenFlashTimeLeft <= 0) return 0;
    return this.screenFlashTimeLeft / KILL_SCREEN_FLASH_MS;
  }

  /** 0..1 alpha for the gold aura pulse drawn around a recent kill's attacker head (point 2), visible to every viewer. */
  killerAuraAlpha(seat: SeatIndex): number {
    const expiry = this.killerAuraExpiry.get(seat);
    if (expiry === undefined) return 0;
    const remaining = expiry - this.clock;
    if (remaining <= 0) return 0;
    const fade = remaining / GOLD_AURA_MS; // 1 -> 0 envelope
    const pulse = 0.65 + 0.35 * Math.sin(this.clock / 90); // continuous breathing while active
    return fade * pulse;
  }

  // -------------------------------------------------------------------
  // Draw — world-space FX only (camera shake is applied by the caller
  // around the whole frame, not here).
  // -------------------------------------------------------------------
  draw(ctx: CanvasRenderingContext2D, toScreen: (x: number, y: number) => [number, number], scale: number) {
    for (const r of this.rings) {
      if (!r.alive) continue;
      const t = r.age / r.life;
      const [sx, sy] = toScreen(r.x, r.y);
      ctx.beginPath();
      ctx.strokeStyle = `hsla(${r.hue}, 95%, 60%, ${Math.max(0, 1 - t)})`;
      ctx.lineWidth = Math.max(1, (4 - t * 3) * scale);
      ctx.arc(sx, sy, Math.max(1, r.maxRadius * t * scale), 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const f of this.flashes) {
      if (!f.alive) continue;
      const t = f.age / f.life;
      const [sx, sy] = toScreen(f.x, f.y);
      ctx.beginPath();
      ctx.fillStyle = `hsla(${f.hue}, 100%, 75%, ${Math.max(0, 0.55 * (1 - t))})`;
      ctx.arc(sx, sy, Math.max(1, f.radius * scale), 0, Math.PI * 2);
      ctx.fill();
    }
    for (const s of this.slashes) {
      if (!s.alive) continue;
      const t = s.age / s.life;
      const [ax, ay] = toScreen(s.x1, s.y1);
      const [bx, by] = toScreen(s.x2, s.y2);
      ctx.beginPath();
      ctx.strokeStyle = `rgba(255,255,255,${Math.max(0, 0.9 * (1 - t))})`;
      ctx.lineWidth = Math.max(1, 3 * scale);
      ctx.lineCap = "round";
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    for (const p of this.particles) {
      if (!p.alive) continue;
      const t = p.age / p.life;
      const [sx, sy] = toScreen(p.x, p.y);
      ctx.beginPath();
      ctx.fillStyle = `hsla(${p.hue}, ${p.sat}%, ${p.light}%, ${Math.max(0, p.baseAlpha * (1 - t))})`;
      ctx.arc(sx, sy, Math.max(0.5, p.size * scale), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.textAlign = "center";
    for (const txt of this.texts) {
      if (!txt.alive) continue;
      const t = txt.age / txt.life;
      const [sx, sy] = toScreen(txt.x, txt.y);
      ctx.font = `bold ${Math.max(10, 13 * scale)}px sans-serif`;
      ctx.fillStyle = withAlpha(txt.color, Math.max(0, 1 - t));
      ctx.fillText(txt.text, sx, sy);
    }
  }
}
