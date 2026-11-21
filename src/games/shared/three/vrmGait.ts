/**
 * Real motion-capture gait cycles (walk / run / sneak) for the standing VRM body.
 *
 * Baked offline by scripts/mocap/bake-gait.mjs from the CMU motion capture database
 * into public/models/motion/gait.json: per clip N samples of one stride (right thigh
 * most forward → next), each a world rotation relative to the T-pose per humanoid bone
 * (D = W · W_T⁻¹), plus the hips' lateral sway / bob in leg lengths. VRM's normalized
 * bones rest in exactly that T-pose, so a bone's local rotation is D(parent)⁻¹ · D(bone)
 * against whichever parent the model has (upperChest, shoulders and toes are optional).
 *
 * Pure three.js math (no React) so the sampling is unit-tested directly.
 */

import * as THREE from "three";
import type { VRMHumanBoneName } from "@pixiv/three-vrm";

export const GAIT_STYLES = ["walk", "run", "sneak"] as const;
export type GaitStyle = (typeof GAIT_STYLES)[number];

export type GaitClip = { n: number; cycleSec: number; q: Float32Array; hips: Float32Array };
export type GaitData = { bones: VRMHumanBoneName[]; clips: Record<GaitStyle, GaitClip> };

type GaitJson = { bones: VRMHumanBoneName[]; clips: Record<string, { n: number; cycleSec: number; q: number[]; hips: number[] }> };

export function parseGait(json: GaitJson): GaitData {
  const clips = {} as Record<GaitStyle, GaitClip>;
  for (const s of GAIT_STYLES) {
    const c = json.clips[s];
    if (!c || c.q.length !== c.n * json.bones.length * 4 || c.hips.length !== c.n * 2) throw new Error(`gait.json: bad clip ${s}`);
    clips[s] = { n: c.n, cycleSec: c.cycleSec, q: Float32Array.from(c.q), hips: Float32Array.from(c.hips) };
  }
  return { bones: json.bones, clips };
}

let loaded: GaitData | null = null;
let loading: Promise<unknown> | null = null;

/** The baked cycles once downloaded (null until then, or if the download failed — bodies keep the procedural walk). */
export function getGait(): GaitData | null {
  if (!loading && typeof fetch !== "undefined")
    loading = fetch("/models/motion/gait.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`gait.json: ${r.status}`))))
      .then((j: GaitJson) => (loaded = parseGait(j)))
      .catch((err) => console.warn("gait mocap unavailable — procedural walk", err));
  return loaded;
}

/** Where phase 0 falls: addWalk's right thigh is most forward at sin(phase) = −1, the clips start there. */
const PHASE0 = (3 * Math.PI) / 2;
const TAU = Math.PI * 2;

/** addWalk's phase (radians) → position in the baked cycle (0..1). */
export function cycleAt(phase: number): number {
  const u = (phase - PHASE0) / TAU;
  return u - Math.floor(u);
}

const sq = new THREE.Quaternion();
const sq2 = new THREE.Quaternion();

/**
 * Sample the clips blended by `mix` (weights per GAIT_STYLES, any sum > 0) at cycle
 * position `u` (0..1): world deltas per bone into `outD`, hips sway / bob (leg lengths) into `hips`.
 */
export function sampleGait(g: GaitData, mix: ArrayLike<number>, u: number, outD: THREE.Quaternion[], hips: { x: number; y: number }) {
  const B = g.bones.length;
  for (let b = 0; b < B; b++) outD[b].set(0, 0, 0, 0);
  hips.x = 0;
  hips.y = 0;
  let total = 0;
  for (let s = 0; s < GAIT_STYLES.length; s++) total += Math.max(0, mix[s]);
  if (total <= 0) {
    for (let b = 0; b < B; b++) outD[b].identity();
    return;
  }
  for (let s = 0; s < GAIT_STYLES.length; s++) {
    const w = Math.max(0, mix[s]) / total;
    if (w <= 0) continue;
    const c = g.clips[GAIT_STYLES[s]];
    const f = u * c.n;
    const i0 = Math.floor(f) % c.n;
    const i1 = (i0 + 1) % c.n;
    const k = f - Math.floor(f);
    for (let b = 0; b < B; b++) {
      const a = (i0 * B + b) * 4, z = (i1 * B + b) * 4;
      sq.set(c.q[a], c.q[a + 1], c.q[a + 2], c.q[a + 3]);
      sq2.set(c.q[z], c.q[z + 1], c.q[z + 2], c.q[z + 3]);
      sq.slerp(sq2, k);
      const o = outD[b];
      // blend in one hemisphere so opposite-signed copies of the same rotation don't cancel
      const sgn = o.x * sq.x + o.y * sq.y + o.z * sq.z + o.w * sq.w < 0 ? -w : w;
      o.set(o.x + sq.x * sgn, o.y + sq.y * sgn, o.z + sq.z * sgn, o.w + sq.w * sgn);
    }
    hips.x += (c.hips[i0 * 2] * (1 - k) + c.hips[i1 * 2] * k) * w;
    hips.y += (c.hips[i0 * 2 + 1] * (1 - k) + c.hips[i1 * 2 + 1] * k) * w;
  }
  for (let b = 0; b < B; b++) outD[b].normalize();
}

/** Per model: each gait bone's nearest gait-bone ancestor that the model actually has (−1 = root). */
export function gaitParents(bones: readonly VRMHumanBoneName[], has: (b: VRMHumanBoneName) => boolean): number[] {
  const CHAIN: Partial<Record<VRMHumanBoneName, VRMHumanBoneName>> = {
    spine: "hips",
    chest: "spine",
    upperChest: "chest",
    neck: "upperChest",
    head: "neck",
    leftShoulder: "upperChest",
    rightShoulder: "upperChest",
    leftUpperArm: "leftShoulder",
    rightUpperArm: "rightShoulder",
    leftLowerArm: "leftUpperArm",
    rightLowerArm: "rightUpperArm",
    leftHand: "leftLowerArm",
    rightHand: "rightLowerArm",
    leftUpperLeg: "hips",
    rightUpperLeg: "hips",
    leftLowerLeg: "leftUpperLeg",
    rightLowerLeg: "rightUpperLeg",
    leftFoot: "leftLowerLeg",
    rightFoot: "rightLowerLeg",
    leftToes: "leftFoot",
    rightToes: "rightFoot",
  };
  // the humanoid spec's fallbacks when an optional bone is missing
  const SKIP: Partial<Record<VRMHumanBoneName, VRMHumanBoneName>> = { upperChest: "chest", leftShoulder: "upperChest", rightShoulder: "upperChest", neck: "upperChest" };
  return bones.map((b) => {
    let p = CHAIN[b];
    while (p && !has(p)) p = SKIP[p] ?? CHAIN[p];
    return p ? bones.indexOf(p) : -1;
  });
}

const lq = new THREE.Quaternion();
/** A bone's local rotation from the world deltas: D(parent)⁻¹ · D(bone). */
export function gaitLocal(D: readonly THREE.Quaternion[], parents: readonly number[], i: number, out: THREE.Quaternion): THREE.Quaternion {
  const p = parents[i];
  if (p < 0) return out.copy(D[i]);
  return out.copy(lq.copy(D[p]).invert()).multiply(D[i]);
}
