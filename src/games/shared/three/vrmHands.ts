import * as THREE from "three";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

/**
 * Human hands for the VRoid table characters, on top of the channel pose (vrmPose.ts):
 *
 * - Reach: in calm moods the arms are placed by two-bone IK instead of the cartoon's joint
 *   angles — both hands on the held cards' lower corners (thumbs on the face side, fingers
 *   behind), or resting on the lap when there's nothing to hold. Big gestures (cheer,
 *   point, shock…) keep their channel poses; the two blend over ~0.3 s.
 * - Wrist: the hand is turned so fingers and palm face the way that grip needs.
 * - Fingers: a natural cascade (index straightest, little finger most curled), a slight
 *   fan, and a thumb that bends at every joint instead of one stiff hinge.
 *
 * All IK maths runs in world space on the normalized bones, so it is the same for VRM 0.x
 * and 1.0 models whatever their bone frames.
 */

export type Side = "l" | "r";
export type Grip = "cards" | "lap";

const FINGERS = ["Index", "Middle", "Ring", "Little"] as const;
const JOINTS = ["Proximal", "Intermediate", "Distal"] as const;
/** How much each finger curls relative to the hand's curl (relaxed hands cascade toward the little finger). */
const CASCADE = [0.78, 0.95, 1.08, 1.2];
/** Per-joint share of the curl: knuckle, middle joint, fingertip. */
const JOINT_SHARE = [0.85, 1.15, 0.75];
/** Fan of the fingers at the knuckle (index outward … little outward), shrinking as the hand closes. */
const SPREAD = [0.12, 0.03, -0.05, -0.13];

type BoneEntry = readonly [VRMHumanBoneName, number, number];

/**
 * Euler (y, z) per finger joint in the normalized T-pose frame — z curls, y fans —
 * plus a small baseline curl so even an "open" hand isn't board-flat.
 */
export function fingerAngles(side: Side, curl: number): BoneEntry[] {
  const s = side === "l" ? -1 : 1;
  const prefix = side === "l" ? "left" : "right";
  const c = Math.max(0, Math.min(1, curl));
  const out: BoneEntry[] = [];
  FINGERS.forEach((f, fi) => {
    const fc = Math.min(1.15, 0.12 + c * CASCADE[fi]);
    JOINTS.forEach((j, ji) => {
      const z = s * fc * JOINT_SHARE[ji] * 1.15;
      const y = ji === 0 ? -s * SPREAD[fi] * (1 - c * 0.7) : 0;
      out.push([`${prefix}${f}${j}` as VRMHumanBoneName, y, z]);
    });
  });
  return out;
}

/** Thumb joints: folds across the palm as the hand closes, never fully straight. */
export function thumbAngles(side: Side, curl: number): BoneEntry[] {
  const s = side === "l" ? 1 : -1;
  const prefix = side === "l" ? "left" : "right";
  const c = Math.max(0, Math.min(1, curl));
  return [
    [`${prefix}ThumbMetacarpal` as VRMHumanBoneName, s * (0.15 + c * 0.35), 0],
    [`${prefix}ThumbProximal` as VRMHumanBoneName, s * (0.12 + c * 0.45), 0],
    [`${prefix}ThumbDistal` as VRMHumanBoneName, s * (0.1 + c * 0.55), 0],
  ];
}

/** Where each grip puts the wrists and how it turns the hands, in the seat's local frame (+z = toward the table, +x = the sitter's left). */
const GRIPS: Record<Grip, { wrist: [number, number, number]; fingers: [number, number, number]; thumbSide: 1 | -1; pole: [number, number, number]; curl: number }> = {
  // palms toward the sitter, fingers up behind the fan (opponents see their backs over the
  // card backs), wrists at its lower corners, elbows down and out
  cards: { wrist: [0.06, -0.035, 0.05], fingers: [-0.2, 0.9, -0.3], thumbSide: 1, pole: [0.7, -1, -0.35], curl: 0.45 },
  // palms down on the thighs, fingers forward and a little inward, thumbs toward the midline
  lap: { wrist: [0.12, 0.11, 0.2], fingers: [-0.2, -0.25, 1], thumbSide: -1, pole: [0.45, -0.3, -1], curl: 0.3 },
};
export const GRIP_CURL: Record<Grip, number> = { cards: GRIPS.cards.curl, lap: GRIPS.lap.curl };

export type HandRig = {
  side: Side;
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  hand: THREE.Object3D;
  chain: THREE.Object3D[];
  index: THREE.Object3D;
  middle: THREE.Object3D;
  little: THREE.Object3D;
};

const rigCache = new WeakMap<VRM, HandRig[]>();
export function handRigs(vrm: VRM): HandRig[] {
  let r = rigCache.get(vrm);
  if (r) return r;
  const node = (b: VRMHumanBoneName) => vrm.humanoid.getNormalizedBoneNode(b);
  r = (["l", "r"] as const).flatMap((side) => {
    const p = side === "l" ? "left" : "right";
    const upper = node(`${p}UpperArm`), lower = node(`${p}LowerArm`), hand = node(`${p}Hand`);
    const index = node(`${p}IndexProximal`), middle = node(`${p}MiddleProximal`), little = node(`${p}LittleProximal`);
    if (!upper || !lower || !hand || !index || !middle || !little) return [];
    const chain = [node(`${p}Shoulder`), upper, lower, hand, index, middle, little].filter((n): n is THREE.Object3D => !!n);
    return [{ side, upper, lower, hand, chain, index, middle, little }];
  });
  rigCache.set(vrm, r);
  return r;
}

/** Recompute world matrices down a parent→child chain only (the ancestors keep this frame's matrices). */
function refresh(chain: THREE.Object3D[]) {
  for (const n of chain) {
    n.updateMatrix();
    n.matrixWorld.multiplyMatrices(n.parent!.matrixWorld, n.matrix);
  }
}

const vS = new THREE.Vector3();
const vE = new THREE.Vector3();
const vH = new THREE.Vector3();
const vT = new THREE.Vector3();
const vDir = new THREE.Vector3();
const vBend = new THREE.Vector3();
const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const vC = new THREE.Vector3();
const qW = new THREE.Quaternion();
const qP = new THREE.Quaternion();
const qPi = new THREE.Quaternion();
const vScale = new THREE.Vector3();
const mCur = new THREE.Matrix4();
const mDes = new THREE.Matrix4();
const vElbow = new THREE.Vector3();
const vWrist = new THREE.Vector3();
const saved = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];

/** Turn `bone` by the world rotation `q` (kept in its parent's frame). */
function turnWorld(bone: THREE.Object3D, q: THREE.Quaternion) {
  bone.parent!.matrixWorld.decompose(vC, qP, vScale);
  qPi.copy(qP).invert();
  bone.quaternion.premultiply(qPi.multiply(q).multiply(qP));
}

/** Rotate `bone` (at `at`) so the point `from` swings onto the ray toward `to`. */
function aim(bone: THREE.Object3D, at: THREE.Vector3, from: THREE.Vector3, to: THREE.Vector3) {
  vA.subVectors(from, at).normalize();
  vB.subVectors(to, at).normalize();
  turnWorld(bone, qW.setFromUnitVectors(vA, vB));
}

/**
 * Place one arm for `grip`, blended by `w` (0 = keep the channel pose, 1 = full IK).
 * `seat` is the seat group's world matrix, `pivot` the seat-local point the grip is relative
 * to (the held cards' pivot, or the seat height for the lap).
 */
export function reach(rig: HandRig, grip: Grip, w: number, seat: THREE.Matrix4, pivot: readonly [number, number, number]) {
  if (w <= 0.001) return;
  const g = GRIPS[grip];
  const mirror = rig.side === "l" ? 1 : -1;
  saved[0].copy(rig.upper.quaternion);
  saved[1].copy(rig.lower.quaternion);
  saved[2].copy(rig.hand.quaternion);
  refresh(rig.chain);

  // target wrist and elbow pole, from the seat frame into world space
  vT.set(pivot[0] + g.wrist[0] * mirror, pivot[1] + g.wrist[1], pivot[2] + g.wrist[2]).applyMatrix4(seat);
  const pole = vBend.set(g.pole[0] * mirror, g.pole[1], g.pole[2]).transformDirection(seat);

  vS.setFromMatrixPosition(rig.upper.matrixWorld);
  vE.setFromMatrixPosition(rig.lower.matrixWorld);
  vH.setFromMatrixPosition(rig.hand.matrixWorld);
  const l1 = vS.distanceTo(vE), l2 = vE.distanceTo(vH);
  vDir.subVectors(vT, vS);
  const d = Math.max(Math.abs(l1 - l2) + 1e-4, Math.min((l1 + l2) * 0.995, vDir.length()));
  vDir.normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  pole.addScaledVector(vDir, -pole.dot(vDir)).normalize();
  const elbow = vElbow.copy(vS).addScaledVector(vDir, a).addScaledVector(pole, h);
  const wrist = vWrist.copy(vS).addScaledVector(vDir, d);

  aim(rig.upper, vS, vE, elbow);
  refresh(rig.chain);
  vE.setFromMatrixPosition(rig.lower.matrixWorld);
  vH.setFromMatrixPosition(rig.hand.matrixWorld);
  aim(rig.lower, vE, vH, wrist);
  refresh(rig.chain);

  // wrist: fingers along the grip direction, index side outward or toward the midline
  const p0 = vS.setFromMatrixPosition(rig.hand.matrixWorld);
  const fCur = vA.setFromMatrixPosition(rig.middle.matrixWorld).sub(p0).normalize();
  const xCur = vB.setFromMatrixPosition(rig.index.matrixWorld).sub(vE.setFromMatrixPosition(rig.little.matrixWorld));
  xCur.addScaledVector(fCur, -xCur.dot(fCur)).normalize();
  mCur.makeBasis(fCur, xCur, vC.crossVectors(fCur, xCur));
  const fDes = vDir.set(g.fingers[0] * mirror, g.fingers[1], g.fingers[2]).transformDirection(seat);
  const xDes = vH.set(g.thumbSide * mirror, 0, 0).transformDirection(seat);
  xDes.addScaledVector(fDes, -xDes.dot(fDes)).normalize();
  mDes.makeBasis(fDes, xDes, vT.crossVectors(fDes, xDes));
  qW.setFromRotationMatrix(mDes.multiply(mCur.transpose()));
  turnWorld(rig.hand, qW);

  if (w < 0.999) {
    rig.upper.quaternion.copy(saved[0].slerp(rig.upper.quaternion, w));
    rig.lower.quaternion.copy(saved[1].slerp(rig.lower.quaternion, w));
    rig.hand.quaternion.copy(saved[2].slerp(rig.hand.quaternion, w));
  }
  refresh(rig.chain);
}
