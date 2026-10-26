/**
 * Maps the table rigs' joint channels (motion.ts, authored for SeatedPerson's
 * arms hanging down) onto a VRM humanoid's normalized bones, whose rest pose
 * is a T-pose. Pure three.js math so it is unit-tested directly.
 *
 * - upper arm = ours ∘ down (our rotation is applied to an arm already hanging down)
 * - lower arm / hand = down⁻¹ ∘ ours ∘ down (the joint turns in the hanging-arm frame)
 * - VRM 0.x models, after VRMUtils.rotateVRM0, have every normalized bone frame turned
 *   180° about y, so each rotation is conjugated by that turn (= negate x and z).
 */

import * as THREE from "three";

export type ArmSide = "l" | "r";

const Z = new THREE.Vector3(0, 0, 1);
/** T-pose arm → hanging down, with a slight A-pose so the sleeves clear the body. */
const DOWN: Record<ArmSide, THREE.Quaternion> = {
  l: new THREE.Quaternion().setFromAxisAngle(Z, -Math.PI / 2 + 0.08),
  r: new THREE.Quaternion().setFromAxisAngle(Z, Math.PI / 2 - 0.08),
};
const DOWN_INV: Record<ArmSide, THREE.Quaternion> = { l: DOWN.l.clone().invert(), r: DOWN.r.clone().invert() };
const e = new THREE.Euler();
const q = new THREE.Quaternion();

/** Shoulder channels (x, y, z) → the VRM upper-arm local rotation. */
export function upperArmQuat(side: ArmSide, x: number, y: number, z: number, out = new THREE.Quaternion()): THREE.Quaternion {
  return out.setFromEuler(e.set(x, y, z)).multiply(DOWN[side]);
}

/** A joint below the shoulder (elbow flex, wrist flex/roll) turned in the hanging-arm frame. */
export function armJointQuat(side: ArmSide, x: number, z: number, out = new THREE.Quaternion()): THREE.Quaternion {
  return out.copy(DOWN_INV[side]).multiply(q.setFromEuler(e.set(x, 0, z))).multiply(DOWN[side]);
}

/** Finger curl (0 open … 1 fist) as a z-rotation per finger joint; the thumb folds about y. */
export function fingerCurl(side: ArmSide, curl: number, joint: "Proximal" | "Intermediate" | "Distal"): number {
  return (side === "l" ? -1 : 1) * curl * (joint === "Proximal" ? 1.0 : 1.3);
}

/** In place: a rotation authored for VRM 1.0 → the same pose on a VRM 0.x normalized bone. */
export function toVrm0(quat: THREE.Quaternion): THREE.Quaternion {
  return quat.set(-quat.x, quat.y, -quat.z, quat.w);
}
