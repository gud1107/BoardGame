/**
 * 낙서 결투 — fixed-step projectile simulation. The drawn shape itself is the
 * hitbox: every tick the (rotated) stroke segments are tested against player
 * circles, ink walls and the terrain. Pure + deterministic (only + − × ÷,
 * sqrt, floor/round and the Taylor-series `dsin`/`dcos` from analyze.ts).
 */

import { dcos, degToRad, dsin, type WeaponStats } from "./analyze";

export const WORLD_W = 960;
export const WORLD_H = 540;
export const COL_W = 8;
export const TERRAIN_COLS = WORLD_W / COL_W + 1;
export const PLAYER_R = 15;
/** Launch point sits this far above the player's feet. */
export const MUZZLE_Y = 34;
export const GRAVITY = 0.22;
export const MAX_TICKS = 900;
/** The shooter can't hit itself for the first ticks of a shot. */
const SELF_GRACE_TICKS = 24;
/** Contact distance between a weapon stroke and a wall stroke. */
const WALL_CONTACT = 3;

export interface Wall {
  id: number;
  owner: number;
  /** Flat world coordinates, one polyline per stroke. */
  strokes: number[][];
  hp: number;
  maxHp: number;
  color: number;
  /** Set for a 🛡️ shield: it guards this seat and vanishes when that seat's next turn starts. */
  shieldOf?: number;
}

export interface Body {
  seat: number;
  x: number;
  y: number;
  alive: boolean;
}

export interface FlightResult {
  /** Flat [x, y, cos, sin] per recorded frame (every 2 ticks), rounded to keep state-sync small. */
  frames: number[];
  impact: { x: number; y: number } | null;
  directSeat: number | null;
  /** Wall hit (non-pierce) that stopped the shot. */
  wallStop: number | null;
  /** Walls a spear went through. */
  pierced: number[];
  ticks: number;
  /** A boomerang came back and the thrower caught it (no impact). */
  caught?: boolean;
}

export function surfaceY(terrain: readonly number[], x: number): number {
  if (x <= 0) return terrain[0];
  if (x >= WORLD_W) return terrain[terrain.length - 1];
  const i = Math.floor(x / COL_W);
  const t = (x - i * COL_W) / COL_W;
  return terrain[i] + (terrain[i + 1] - terrain[i]) * t;
}

export function launchVelocity(angleDeg: number, power: number, speedMul: number): { vx: number; vy: number } {
  const a = degToRad(angleDeg);
  const v = (2.2 + power * 0.14) * speedMul;
  return { vx: dcos(a) * v, vy: -dsin(a) * v };
}

function segPointDist2(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px;
  const qy = ay + dy * t - py;
  return qx * qx + qy * qy;
}

function segSegDist2(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  // Proper intersection test first.
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(
    segPointDist2(ax, ay, bx, by, cx, cy),
    segPointDist2(ax, ay, bx, by, dx, dy),
    segPointDist2(cx, cy, dx, dy, ax, ay),
    segPointDist2(cx, cy, dx, dy, bx, by),
  );
}

function wallBounds(w: Wall): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of w.strokes) {
    for (let i = 0; i < s.length; i += 2) {
      if (s[i] < x0) x0 = s[i];
      if (s[i] > x1) x1 = s[i];
      if (s[i + 1] < y0) y0 = s[i + 1];
      if (s[i + 1] > y1) y1 = s[i + 1];
    }
  }
  return { x0, y0, x1, y1 };
}

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Flies `stats.shape` from `shooter`. `fast` skips the per-segment shape
 * tests and treats the doodle as a circle of `stats.radius` (bot aim search).
 */
export function simulateFlight(
  terrain: readonly number[],
  bodies: readonly Body[],
  walls: readonly Wall[],
  shooter: Body,
  stats: WeaponStats,
  angleDeg: number,
  power: number,
  wind: number,
  fast = false,
): FlightResult {
  let x = shooter.x;
  let y = shooter.y - MUZZLE_Y;
  let { vx, vy } = launchVelocity(angleDeg, power, stats.speedMul);
  // Boomerangs are pulled back toward the side they were thrown from.
  const throwDir = vx >= 0 ? 1 : -1;
  const boomerang = stats.returnAcc > 0;
  let bouncesLeft = stats.bounces;
  let digLeft = stats.dig;
  let digging = false;
  let theta = 0;
  let c = 1;
  let s = 0;
  const frames: number[] = [];
  const pierced: number[] = [];
  const bounds = walls.map(wallBounds);
  let minTerrain = Infinity;
  for (const h of terrain) if (h < minTerrain) minTerrain = h;
  const R = stats.radius;
  const shape = stats.shape;
  // World-space shape buffer reused every tick.
  const world: number[][] = shape.map((st) => new Array<number>(st.p.length));

  const transform = () => {
    for (let k = 0; k < shape.length; k++) {
      const src = shape[k].p;
      const dst = world[k];
      for (let i = 0; i < src.length; i += 2) {
        dst[i] = x + src[i] * c - src[i + 1] * s;
        dst[i + 1] = y + src[i] * s + src[i + 1] * c;
      }
    }
  };

  for (let tick = 1; tick <= MAX_TICKS; tick++) {
    vx += wind;
    if (boomerang && tick > 10) {
      if (vx * throwDir > 0) {
        vx -= throwDir * stats.returnAcc;
      } else {
        // On the way back it homes in (spring + damping) on the thrower's hands.
        vx += (shooter.x - x) * 0.004;
        vy += (shooter.y - MUZZLE_Y - y) * 0.004;
        vx *= 0.985;
        vy *= 0.985;
      }
    }
    vy += GRAVITY * stats.gravityMul;
    x += vx;
    y += vy;
    if (stats.spin === 0) {
      // Spear: keep the drawn axis aligned with the velocity (rotation from axis → velocity, no trig).
      const vl = Math.sqrt(vx * vx + vy * vy);
      const ux = vl > 0 ? vx / vl : 1;
      const uy = vl > 0 ? vy / vl : 0;
      c = stats.axisX * ux + stats.axisY * uy;
      s = stats.axisX * uy - stats.axisY * ux;
    } else {
      theta += (boomerang ? throwDir : vx >= 0 ? 1 : -1) * stats.spin;
      c = dcos(theta);
      s = dsin(theta);
    }
    if (tick % 2 === 0) frames.push(r2(x), r2(y), r2(c), r2(s));

    if (x < -160 || x > WORLD_W + 160 || y > WORLD_H + 80) {
      return { frames, impact: null, directSeat: null, wallStop: null, pierced, ticks: tick };
    }

    let transformed = false;
    const ensure = () => {
      if (!transformed) {
        transform();
        transformed = true;
      }
    };

    // Players.
    for (const b of bodies) {
      if (!b.alive) continue;
      if (b.seat === shooter.seat && tick < SELF_GRACE_TICKS) continue;
      const by = b.y - PLAYER_R;
      const dx = b.x - x;
      const dy = by - y;
      if (boomerang && b.seat === shooter.seat) {
        // The thrower catches a returning boomerang instead of being hit by it.
        const catchR = PLAYER_R + R * 0.6 + 10;
        if (dx * dx + dy * dy <= catchR * catchR) {
          frames.push(r2(x), r2(y), r2(c), r2(s));
          return { frames, impact: null, directSeat: null, wallStop: null, pierced, ticks: tick, caught: true };
        }
        continue;
      }
      const reach = R + PLAYER_R;
      if (dx * dx + dy * dy > reach * reach) continue;
      if (fast) {
        frames.push(r2(x), r2(y), r2(c), r2(s));
        return { frames, impact: { x, y }, directSeat: b.seat, wallStop: null, pierced, ticks: tick };
      }
      ensure();
      for (const st of world) {
        // analyzeWeapon guarantees ≥ 2 points per stroke.
        for (let i = 0; i + 3 < st.length; i += 2) {
          if (segPointDist2(st[i], st[i + 1], st[i + 2], st[i + 3], b.x, by) <= PLAYER_R * PLAYER_R) {
            frames.push(r2(x), r2(y), r2(c), r2(s));
            return { frames, impact: { x, y }, directSeat: b.seat, wallStop: null, pierced, ticks: tick };
          }
        }
      }
    }

    // Ink walls.
    for (let wi = 0; wi < walls.length; wi++) {
      const w = walls[wi];
      if (w.hp <= 0 || pierced.includes(w.id)) continue;
      const bb = bounds[wi];
      if (x + R < bb.x0 - WALL_CONTACT || x - R > bb.x1 + WALL_CONTACT || y + R < bb.y0 - WALL_CONTACT || y - R > bb.y1 + WALL_CONTACT) continue;
      let hit = false;
      if (fast) {
        for (const ws of w.strokes) {
          for (let j = 0; j + 3 < ws.length && !hit; j += 2) {
            if (segPointDist2(ws[j], ws[j + 1], ws[j + 2], ws[j + 3], x, y) <= R * R) hit = true;
          }
          if (hit) break;
        }
      } else {
        ensure();
        outer: for (const st of world) {
          for (let i = 0; i + 3 < st.length; i += 2) {
            for (const ws of w.strokes) {
              for (let j = 0; j + 3 < ws.length; j += 2) {
                if (segSegDist2(st[i], st[i + 1], st[i + 2], st[i + 3], ws[j], ws[j + 1], ws[j + 2], ws[j + 3]) <= WALL_CONTACT * WALL_CONTACT) {
                  hit = true;
                  break outer;
                }
              }
            }
          }
        }
      }
      if (!hit) continue;
      if (stats.pierce) {
        pierced.push(w.id);
        continue;
      }
      frames.push(r2(x), r2(y), r2(c), r2(s));
      return { frames, impact: { x, y }, directSeat: null, wallStop: w.id, pierced, ticks: tick };
    }

    // 🌀 Tunnelling: slows down underground and blows up when the drill runs out.
    if (digging) {
      vx *= 0.9;
      vy *= 0.9;
      digLeft--;
      if (digLeft <= 0 || y > WORLD_H - 30) {
        frames.push(r2(x), r2(y), r2(c), r2(s));
        return { frames, impact: { x, y }, directSeat: null, wallStop: null, pierced, ticks: tick };
      }
      continue;
    }

    // Terrain.
    if (y + R >= minTerrain) {
      let ground = false;
      if (fast) {
        ground = y + R * 0.5 >= surfaceY(terrain, x);
      } else {
        ensure();
        for (const st of world) {
          for (let i = 0; i < st.length; i += 2) {
            if (st[i + 1] >= surfaceY(terrain, st[i])) {
              ground = true;
              break;
            }
          }
          if (ground) break;
        }
      }
      if (ground && bouncesLeft > 0) {
        // ✴️ Ricochet: flip upward, lose some speed, lift clear of the ground.
        bouncesLeft--;
        vy = -Math.abs(vy) * 0.65 - 1;
        vx *= 0.85;
        y = Math.min(y, surfaceY(terrain, x) - R - 1);
        continue;
      }
      if (ground && digLeft > 0) {
        digging = true;
        continue;
      }
      if (ground) {
        frames.push(r2(x), r2(y), r2(c), r2(s));
        return { frames, impact: { x, y }, directSeat: null, wallStop: null, pierced, ticks: tick };
      }
    }
  }
  return { frames, impact: null, directSeat: null, wallStop: null, pierced, ticks: MAX_TICKS };
}

/** Carves a round crater (y grows downward) and returns the new terrain. */
export function carveCrater(terrain: readonly number[], cx: number, cy: number, radius: number): number[] {
  const out = terrain.slice();
  if (radius <= 0) return out;
  for (let i = 0; i < out.length; i++) {
    const dx = i * COL_W - cx;
    if (dx * dx >= radius * radius) continue;
    const bottom = cy + Math.sqrt(radius * radius - dx * dx);
    if (bottom > out[i]) out[i] = Math.min(WORLD_H - 24, Math.round(bottom * 10) / 10);
  }
  return out;
}

export function wallTouchesCircle(w: Wall, cx: number, cy: number, r: number): boolean {
  for (const s of w.strokes) {
    for (let j = 0; j + 3 < s.length; j += 2) {
      if (segPointDist2(s[j], s[j + 1], s[j + 2], s[j + 3], cx, cy) <= r * r) return true;
    }
    if (s.length === 2) {
      const dx = s[0] - cx;
      const dy = s[1] - cy;
      if (dx * dx + dy * dy <= r * r) return true;
    }
  }
  return false;
}
