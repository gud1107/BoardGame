/**
 * 시대의 진격 combat motion — pure pose math for the jointed rigs (rigs.ts).
 *
 * Attack timing comes straight from the engine: a unit's `lastAtk` tick is the
 * moment the blow lands, its cooldown tells when the next one will. So every
 * attack is shown as windup (second half of the cooldown) → strike (landing
 * exactly on the hit) → recover → hold, and the windup of the next blow ends
 * precisely when the engine resolves it.
 *
 * Signs: `pitch` > 0 leans forward, arm/leg rotations > 0 swing forward
 * (π/2 = straight ahead, π = overhead), `lunge` > 0 steps toward the enemy.
 */

import type { Rig } from "./rigs";

export interface PoseIn {
  rig: Rig;
  /** Global clock, seconds. */
  t: number;
  /** World distance this unit has walked (drives stride and wheel spin). */
  stride: number;
  /** 0 = standing, 1 = full walk (smoothed). */
  move: number;
  /** Seconds since the last blow landed (Infinity = never). */
  since: number;
  /** Seconds between blows. */
  cd: number;
  /** In combat right now. */
  engaged: boolean;
  /** 0–1.4 flinch from a fresh hit. */
  hit: number;
  stunned: boolean;
  /** 0–1 spawn pop progress (1 = done). */
  spawn: number;
  cheer: boolean;
  seed: number;
}

export interface Pose {
  lunge: number;
  bob: number;
  pitch: number;
  roll: number;
  twist: number;
  scale: number;
  armL: number;
  armLx: number;
  armR: number;
  armRx: number;
  legs: [number, number];
  fleg: [number, number];
  bleg: [number, number];
  wheel: number;
  rotor: number;
  barrel: number;
  cape: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const eo = (k: number) => 1 - (1 - k) ** 3;
const eio = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const backOut = (k: number) => 1 + 2.4 * (k - 1) ** 3 + 1.4 * (k - 1) ** 2;

export function newPose(): Pose {
  return { lunge: 0, bob: 0, pitch: 0, roll: 0, twist: 0, scale: 1, armL: 0, armLx: 0, armR: 0, armRx: 0, legs: [0, 0], fleg: [0, 0], bleg: [0, 0], wheel: 0, rotor: 0, barrel: 0, cape: 0 };
}

/** Where the weapon arm rests while walking / waiting. */
const CARRY: Record<Rig["weapon"], number> = { swing: 0.55, thrust: 1.25, bow: -0.1, gun: 0.95, sling: 0.25, throw: 0.35, heal: 0.45, drum: 0.95, none: 0 };
const READY: Record<Rig["weapon"], number> = { swing: 1.15, thrust: 1.5, bow: 1.5, gun: 1.5, sling: 1.2, throw: 0.6, heal: 1.1, drum: 0.95, none: 0 };

export function computePose(p: PoseIn, out: Pose): Pose {
  const { rig, t, move, cd } = p;
  const h = rig.heavy;
  const mounted = rig.frame === "mount";
  const S1 = 0.13 * h;
  const S2 = 0.45 * h;
  const since = p.since;
  const engaged = p.engaged;
  const k = since < S1 ? eo(since / S1) : 1;
  const inStrike = engaged && since < S1;
  const inRecover = engaged && since >= S1 && since < S2;
  const r = inRecover ? eio((since - S1) / (S2 - S1)) : 0;
  const w = engaged ? eio(clamp01((since - cd * 0.5) / Math.max(0.05, cd * 0.5 - 0.03))) : 0;

  // stride
  const phase = (p.stride / (mounted ? 1.4 : 0.9)) * Math.PI;
  const sw = Math.sin(phase);
  const amp = move;

  out.lunge = 0;
  out.bob = 0;
  out.pitch = 0;
  out.roll = 0;
  out.twist = 0;
  out.scale = 1;
  out.armLx = 0;
  out.armRx = 0;
  out.barrel = 0;
  out.wheel = 0;
  out.rotor = t * 28;

  // ── legs / locomotion ──
  if (rig.frame === "human") {
    const stance = engaged ? 0.32 : 0.06;
    out.legs[0] = sw * 0.62 * amp + stance * (1 - amp);
    out.legs[1] = -sw * 0.62 * amp - stance * 0.9 * (1 - amp);
    out.bob = Math.abs(sw) * 0.09 * amp + Math.sin(t * 2.1 + p.seed) * 0.012 * (1 - amp);
    out.roll = sw * 0.035 * amp;
    out.pitch = 0.07 * amp;
  } else if (mounted) {
    const g = 0.75 * amp;
    out.fleg[0] = Math.sin(phase) * g;
    out.fleg[1] = Math.sin(phase + 0.7) * g;
    out.bleg[0] = Math.sin(phase + Math.PI) * g;
    out.bleg[1] = Math.sin(phase + Math.PI + 0.7) * g;
    out.pitch = Math.sin(phase * 2) * 0.06 * amp;
    out.bob = Math.abs(Math.sin(phase)) * 0.14 * amp + Math.sin(t * 1.7 + p.seed) * 0.015 * (1 - amp);
  } else if (rig.frame === "vehicle") {
    out.wheel = -p.stride / 0.42;
    out.bob = Math.sin(t * 9 + p.seed) * 0.02 * amp;
    out.pitch = Math.sin(t * 7 + p.seed) * 0.01 * amp;
  } else {
    out.bob = Math.sin(t * 2.6 + p.seed) * 0.15;
    out.pitch = 0.12 * amp;
  }

  // ── arms ──
  const carry = CARRY[rig.weapon];
  const ready = READY[rig.weapon];
  const armBlend = engaged ? 1 : 0;
  out.armR = lerp(carry + sw * 0.12 * amp, ready, armBlend);
  out.armL = rig.shield ? lerp(0.35, 0.6, armBlend) : -sw * 0.42 * amp;
  if (rig.weapon === "bow") out.armL = lerp(0.25 - sw * 0.1 * amp, 1.57, armBlend);
  if (rig.weapon === "gun" || rig.weapon === "thrust") out.armL = lerp(-sw * 0.3 * amp + (rig.weapon === "gun" ? 0.75 : 0.2), rig.weapon === "gun" ? 1.32 : 1.25, armBlend);

  if (engaged) {
    switch (rig.weapon) {
      case "swing": {
        const raised = 2.85;
        const low = 0.25;
        out.armR = inStrike ? lerp(raised, low, k) : inRecover ? lerp(low, ready, r) : lerp(ready, raised, w);
        out.pitch += inStrike ? lerp(-0.12, 0.34, k) : inRecover ? lerp(0.34, 0, r) : -0.12 * w;
        out.twist = inStrike ? lerp(-0.35, 0.3, k) : inRecover ? lerp(0.3, 0, r) : -0.35 * w;
        out.lunge = inStrike ? 0.42 * k : inRecover ? lerp(0.42, 0, r) : -0.05 * w;
        if (!rig.shield) out.armL = inStrike ? lerp(0.5, -0.5, k) : inRecover ? lerp(-0.5, 0.3, r) : lerp(0.3, 0.6, w);
        else out.armL = inStrike ? 0.45 : 0.6 + 0.15 * w;
        out.legs[0] += inStrike ? 0.25 * k : inRecover ? lerp(0.25, 0, r) : 0;
        break;
      }
      case "thrust": {
        const ext = inStrike ? lerp(-0.32, 0.55, k) : inRecover ? lerp(0.55, 0, r) : -0.32 * w;
        out.armRx = ext;
        if (!mounted) out.armLx = ext * 0.7;
        out.armR = ready + (inStrike ? -0.08 : 0);
        out.pitch += inStrike ? 0.22 * k : inRecover ? lerp(0.22, 0, r) : -0.08 * w;
        out.lunge = inStrike ? 0.45 * k : inRecover ? lerp(0.45, 0, r) : -0.08 * w;
        out.legs[0] += inStrike ? 0.3 * k : inRecover ? lerp(0.3, 0, r) : 0;
        break;
      }
      case "bow": {
        out.twist = -0.28;
        out.armRx = inStrike ? lerp(-0.42, 0.08, k) : inRecover ? lerp(0.08, 0, r) : -0.42 * w;
        out.armR = 1.5 + (inStrike ? 0.08 * (1 - k) : 0);
        out.armL = 1.57 + (inStrike ? 0.12 * (1 - k) : 0);
        out.pitch += -0.06 * w;
        break;
      }
      case "gun": {
        const kick = since < 0.28 * h ? (1 - since / (0.28 * h)) ** 2 : 0;
        const m = since / cd;
        const reload = m > 0.3 && m < 0.68 ? Math.sin(((m - 0.3) / 0.38) * Math.PI) : 0;
        out.armR = ready + 0.45 * kick - 0.75 * reload;
        out.armL = 1.32 + 0.35 * kick - 0.3 * reload;
        out.armRx = -0.15 * kick;
        out.armLx = -0.1 * kick;
        out.pitch += -0.14 * kick + 0.08 * reload;
        out.lunge = -0.12 * kick;
        break;
      }
      case "sling": {
        const spin = 1.3 + w * w * Math.PI * 4;
        out.armR = inStrike ? lerp(spin, 2.15, k) : inRecover ? lerp(2.15, 0.9, r) : lerp(0.9, spin, Math.min(1, w * 3));
        out.pitch += inStrike ? 0.2 * k : inRecover ? lerp(0.2, 0, r) : 0;
        out.twist = inStrike ? 0.25 * k : -0.15 * w;
        break;
      }
      case "throw": {
        out.armR = inStrike ? lerp(-1.2, 2.5, k) : inRecover ? lerp(2.5, 0.6, r) : lerp(0.6, -1.2, w);
        out.pitch += inStrike ? lerp(-0.15, 0.3, k) : inRecover ? lerp(0.3, 0, r) : -0.15 * w;
        out.twist = inStrike ? lerp(-0.4, 0.3, k) : inRecover ? lerp(0.3, 0, r) : -0.4 * w;
        out.lunge = inStrike ? 0.2 * k : 0;
        out.armL = inStrike ? -0.3 : 0.9 * w;
        break;
      }
      case "heal":
        if (rig.frame === "human") {
          // raise the staff, flick it up as the heal lands
          out.armR = inStrike ? lerp(2.5, 3.05, k) : inRecover ? lerp(3.05, 1.1, r) : lerp(1.1, 2.5, w);
          out.armL = 1.0 + 0.35 * w;
          out.pitch += -0.08 * w + (inStrike ? 0.05 : 0);
        } else out.pitch += 0.2;
        break;
      case "drum":
        break;
      case "none": {
        // vehicles: barrel recoil on shots, a shove on rams
        const kick = since < 0.35 * h ? (1 - since / (0.35 * h)) ** 2 : 0;
        out.barrel = -0.38 * kick;
        out.pitch += -0.07 * kick;
        if (rig.ram) out.lunge = inStrike ? 0.35 * k : inRecover ? lerp(0.35, 0, r) : -0.06 * w;
        else out.lunge = -0.12 * kick;
        break;
      }
    }
    if (mounted) {
      // the mount rears into the blow and stamps down
      const rear = inStrike ? Math.sin(k * Math.PI) : 0;
      out.pitch -= 0.22 * rear + 0.06 * w;
      out.fleg[0] += 0.9 * rear + 0.3 * w;
      out.fleg[1] += 0.8 * rear + 0.25 * w;
      out.lunge += 0.15 * rear;
    }
  }

  if (rig.weapon === "drum") {
    const f = engaged ? 16 : 9;
    const a = engaged ? 0.65 : 0.45;
    out.armR = 0.85 + Math.max(0, Math.sin(t * f + p.seed)) * a;
    out.armL = 0.85 + Math.max(0, Math.sin(t * f + p.seed + Math.PI)) * a;
  }

  // ── reactions ──
  if (p.hit > 0) {
    out.pitch -= 0.32 * p.hit;
    out.lunge -= 0.2 * p.hit;
    out.armR += 0.25 * p.hit;
    out.armL += rig.shield ? 0.35 * p.hit : 0.2 * p.hit;
    out.roll += 0.06 * p.hit * (p.seed % 2 ? 1 : -1);
  }
  if (p.stunned) {
    out.roll += Math.sin(t * 9 + p.seed) * 0.18;
    out.twist += Math.sin(t * 6 + p.seed) * 0.3;
    out.armR = lerp(out.armR, 0.15, 0.7);
    out.armL = lerp(out.armL, 0.1, 0.7);
  }
  if (p.cheer) {
    out.bob += Math.abs(Math.sin(t * 7 + p.seed)) * 0.45;
    out.armR = 2.9 + Math.sin(t * 14 + p.seed) * 0.18;
    out.armL = rig.weapon === "bow" ? 2.7 : 2.6 + Math.sin(t * 14 + p.seed + 1) * 0.15;
    out.legs[0] = out.legs[1] = 0;
  }
  if (p.spawn < 1) {
    out.scale = Math.max(0.05, backOut(p.spawn));
    out.bob -= (1 - p.spawn) * 0.6;
  }
  out.cape = -(0.12 + 0.55 * amp + 0.07 * Math.sin(t * 7 + p.seed) + (engaged ? 0.1 * Math.max(0, out.lunge) : 0));
  return out;
}

/** Falling / wrecked pose, `el` seconds after death. */
export function deathPose(rig: Rig, el: number, dir: number, seed: number, out: Pose): Pose {
  out.lunge = 0;
  out.twist = 0;
  out.scale = 1;
  out.armLx = out.armRx = 0;
  out.barrel = 0;
  out.rotor = el * 6;
  out.wheel = 0;
  out.cape = -0.3;
  const fall = seed % 3; // 0 back, 1 forward, 2 sideways
  if (rig.frame === "human") {
    const buckle = eo(clamp01(el / 0.14));
    const k = eio(clamp01((el - 0.08) / 0.42));
    const hip = rig.hipY;
    out.pitch = fall === 0 ? -1.45 * k : fall === 1 ? 1.4 * k : 0.15 * k;
    out.roll = fall === 2 ? dir * 1.45 * k : 0;
    out.bob = -0.22 * buckle * (1 - k) - hip * 0.72 * k;
    out.lunge = fall === 0 ? -0.35 * k : fall === 1 ? 0.3 * k : 0;
    out.armR = lerp(1.0, fall === 1 ? 2.8 : 2.2, k);
    out.armL = lerp(0.5, fall === 1 ? 2.6 : -0.9, k);
    out.legs[0] = 0.5 * k;
    out.legs[1] = -0.25 * k;
  } else if (rig.frame === "mount") {
    const k = eio(clamp01(el / 0.55));
    out.roll = dir * 0.75 * k;
    out.pitch = 0.25 * k;
    out.bob = -0.5 * k;
    out.fleg[0] = out.fleg[1] = 1.0 * k;
    out.bleg[0] = out.bleg[1] = -0.8 * k;
    out.armR = 2.4 * k;
    out.armL = 0;
    out.legs[0] = out.legs[1] = 0;
  } else if (rig.frame === "vehicle") {
    const k = eo(clamp01(el / 0.3));
    out.roll = dir * 0.22 * k;
    out.pitch = -0.12 * k;
    out.bob = 0.25 * Math.sin(clamp01(el / 0.3) * Math.PI);
    out.barrel = -0.5 * k;
    out.armR = out.armL = 0;
    out.legs[0] = out.legs[1] = 0;
  } else {
    out.roll = el * 5 * dir;
    out.pitch = 0.4;
    out.bob = Math.max(-1.9, -el * el * 7);
    out.armR = out.armL = 0;
    out.legs[0] = out.legs[1] = 0;
  }
  // sink into the ground at the end
  const sinkStart = rig.frame === "vehicle" ? 0.6 : 1.0;
  if (el > sinkStart) out.bob -= (el - sinkStart) * 1.5;
  return out;
}
