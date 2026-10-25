"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const tmp = new THREE.Vector3();

/**
 * How much a label at `obj` should grow so far-away tags stay readable:
 * 1 up to `near` units from the camera, then linear with distance (capped).
 */
export function distanceBoost(obj: THREE.Object3D, camera: THREE.Camera, near = 3.2, max = 2.4): number {
  obj.getWorldPosition(tmp);
  return Math.min(max, Math.max(1, tmp.distanceTo(camera.position) / near));
}

/**
 * Extra label scale on narrow canvases: a 360-px phone table drew bubble name tabs ~6 CSS px
 * tall. Grows smoothly below 600 px wide (×1.36 at 360), never shrinks wide screens.
 */
export function screenBoost(width: number): number {
  return width >= 600 ? 1 : Math.min(1.5, Math.pow(600 / Math.max(240, width), 0.6));
}

const ndc = new THREE.Vector3();
/**
 * Pulls a sprite that would hang off the left/right edge of the view back inside it (keeping
 * its depth), so a side seat's speech bubble on a narrow phone canvas stays readable.
 * `halfW` = the sprite's half width in world units.
 */
export function clampIntoView(s: THREE.Object3D, camera: THREE.Camera, halfW: number, margin = 0.04) {
  if (!s.parent) return;
  s.getWorldPosition(ndc);
  const world = ndc.clone();
  ndc.project(camera);
  if (ndc.z > 1) return;
  // half width in NDC at this depth: project a point halfW to the camera's right
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(halfW).add(world).project(camera);
  const hw = Math.abs(right.x - ndc.x);
  const lim = 1 - margin - hw;
  if (lim <= 0 || Math.abs(ndc.x) <= lim) return;
  ndc.x = Math.sign(ndc.x) * lim;
  ndc.unproject(camera);
  s.parent.worldToLocal(ndc);
  s.position.x = ndc.x;
  s.position.z = ndc.z;
}

/** A name tag / badge sprite that grows with distance so the far side of the table stays legible. */
export default function ScreenSprite({
  map,
  position,
  scale,
  renderOrder,
  anchorY,
}: {
  map: THREE.Texture;
  position: [number, number, number];
  scale: [number, number];
  renderOrder?: number;
  /** When set, the gap above this height grows with the tag too, so stacked tags never overlap. */
  anchorY?: number;
}) {
  const ref = useRef<THREE.Sprite>(null);
  useFrame(({ camera, size }) => {
    const s = ref.current;
    if (!s) return;
    const k = distanceBoost(s, camera) * screenBoost(size.width);
    s.scale.set(scale[0] * k, scale[1] * k, 1);
    // grow upward so a bigger tag doesn't sink into the head below it
    // with an anchor the whole stack scales uniformly about it (gaps grow with the tags)
    s.position.y = anchorY === undefined ? position[1] + (scale[1] * (k - 1)) / 2 : anchorY + (position[1] - anchorY) * k;
  });
  return (
    <sprite ref={ref} position={position} scale={[scale[0], scale[1], 1]} renderOrder={renderOrder}>
      <spriteMaterial map={map} transparent depthWrite={false} />
    </sprite>
  );
}
