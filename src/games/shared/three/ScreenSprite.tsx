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
  useFrame(({ camera }) => {
    const s = ref.current;
    if (!s) return;
    const k = distanceBoost(s, camera);
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
