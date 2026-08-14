import * as THREE from "three";

/**
 * The physics roll (`DiceTray3D.tsx`) is purely decorative chaos — the
 * authoritative die values already sit in `engine.ts`'s state, synced to
 * every client the same way every other lockstep action is (see
 * `HANDOFF.md` §2's "온라인 대전 8종 전부 같은 락스텝 패턴"). Rapier's solver
 * is NOT seeded/deterministic across clients, so we never let it decide the
 * outcome — instead, once the tumble settles, every die is snapped to a
 * quaternion computed here that forces the *engine's* value face-up,
 * regardless of how the physics simulation actually landed. This module is
 * pure math (no Three.js scene/renderer state) so it's unit-testable on its
 * own, same spirit as `engine.ts` staying network/render-agnostic.
 *
 * Face-to-local-normal mapping below MUST match the material array order
 * built in `DiceMesh.tsx` (which in turn matches `RoundedBoxGeometry`'s
 * inherited `BoxGeometry` face-group order: +x, -x, +y, -y, +z, -z) — the
 * two files are two halves of one contract, kept in separate files only
 * because one is math and the other is a React/Three component.
 */

const UP = new THREE.Vector3(0, 1, 0);

export const FACE_LOCAL_NORMAL: Record<number, THREE.Vector3> = {
  1: new THREE.Vector3(0, 1, 0), // +y
  2: new THREE.Vector3(0, 0, 1), // +z
  3: new THREE.Vector3(1, 0, 0), // +x
  4: new THREE.Vector3(-1, 0, 0), // -x
  5: new THREE.Vector3(0, 0, -1), // -z
  6: new THREE.Vector3(0, -1, 0), // -y
};

/**
 * A quaternion that rotates the die so `face` points straight up (+Y),
 * with an extra free spin of `yaw` radians around the vertical axis so a
 * row of forced dice doesn't look like it was stamped from one mold. `yaw`
 * never changes which face is up — it only spins around the axis that's
 * already vertical.
 */
export function quaternionForFaceUp(face: number, yaw = 0): THREE.Quaternion {
  const normal = FACE_LOCAL_NORMAL[face];
  if (!normal) throw new Error(`quaternionForFaceUp: invalid face ${face}`);
  const align = new THREE.Quaternion().setFromUnitVectors(normal, UP);
  const spin = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
  return spin.multiply(align);
}

/** True (within `epsilon`) if applying `quat` to `face`'s local normal lands on world +Y — used by the settle logic's own sanity check and by tests. */
export function isFaceUp(face: number, quat: THREE.Quaternion, epsilon = 1e-4): boolean {
  const normal = FACE_LOCAL_NORMAL[face];
  if (!normal) return false;
  const rotated = normal.clone().applyQuaternion(quat);
  return rotated.distanceTo(UP) < epsilon;
}
