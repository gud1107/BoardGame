"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three-stdlib";
import { getDiceFaceTexture } from "./diceTexture";
import { quaternionForFaceUp } from "./faceMath";
import type { DiceColorway } from "./colorways";

/**
 * The one shared 3D die primitive — every die in this game (ivory face dice,
 * the red 페루도 die, the purple betting die, hidden dice still in the
 * cup) renders through this component, matching the "one primitive, many
 * colorways" pattern the old CSS `DiceCube` established (see its own header
 * comment in `PerudoBoard.tsx`, and Century's `ResourceCube`).
 *
 * Uses `three-stdlib`'s `RoundedBoxGeometry` — NOT `@react-three/drei`'s own
 * `<RoundedBox>` — on purpose: drei's version extrudes a 2D rounded-rect
 * profile, which only exposes two usable material slots (front+back caps
 * share one, all the beveled sides share another). `three-stdlib`'s version
 * instead subdivides a real `BoxGeometry` and pushes its corner vertices
 * outward onto a rounded corner, which means it keeps `BoxGeometry`'s six
 * independent face groups (`+x,-x,+y,-y,+z,-z`) — exactly what a physically
 * tumbling die needs, since a physics roll can leave *any* of the six faces
 * pointing at the camera, and each one needs its own correct pip texture.
 * `faceMath.ts` is written against this exact face/group order — the two
 * files are two halves of one contract.
 *
 * A `DiceMesh` is always a "raw" die: faces 1-6 are painted onto fixed local
 * directions (1=+y, 6=-y, 2=+z, 5=-z, 3=+x, 4=-x — opposite faces sum to 7)
 * and it never rotates itself. Both the physics roll (`DiceTray3D`, which
 * animates toward `quaternionForFaceUp` frame by frame) and every static,
 * non-physics tile (`DieTile` below — the bid-track die, reveal-panel
 * tiles, etc.) bring a specific value "up" the exact same way: by wrapping
 * this mesh in a `<group>` rotated by `quaternionForFaceUp(value)`. There is
 * deliberately only one code path for "make face N point up."
 */

const GEOMETRY_CACHE = new Map<string, THREE.BufferGeometry>();
function getGeometry(size: number): THREE.BufferGeometry {
  const key = size.toFixed(3);
  const cached = GEOMETRY_CACHE.get(key);
  if (cached) return cached;
  const geometry = new RoundedBoxGeometry(size, size, size, 3, size * 0.14);
  GEOMETRY_CACHE.set(key, geometry);
  return geometry;
}

/** Which face value sits on each geometry material group; order matches `BoxGeometry`'s group order (+x,-x,+y,-y,+z,-z) — see `faceMath.ts`'s `FACE_LOCAL_NORMAL`. */
const GROUP_FACES = [3, 4, 1, 6, 2, 5] as const;

export interface DiceMeshProps {
  colorway: DiceColorway;
  /** Edge length in scene units — this module has no opinion on "sm/md/lg", callers map their own size scale to a number. */
  size?: number;
  /** A hidden/opponent die: every face is a plain, pip-free body-colored square instead of a real numbered face. */
  blank?: boolean;
}

/** The bare rotating die object — see file header for why it never applies its own "which face is up" rotation. */
export function DiceMesh({ colorway, size = 1, blank = false }: DiceMeshProps) {
  const geometry = getGeometry(size);
  const materials = useMemo(
    () =>
      GROUP_FACES.map(
        (face) =>
          new THREE.MeshStandardMaterial({
            map: getDiceFaceTexture(colorway, blank ? 0 : face),
            roughness: colorway.roughness,
            metalness: colorway.metalness,
          }),
      ),
    [colorway, blank],
  );
  return <mesh geometry={geometry} material={materials} castShadow receiveShadow />;
}

export interface DieTileProps extends DiceMeshProps {
  /** The value to present face-up. Ignored (no rotation applied) when `blank`. */
  value?: 1 | 2 | 3 | 4 | 5 | 6;
  /** Extra spin around the vertical axis, purely cosmetic — see `quaternionForFaceUp`. */
  yaw?: number;
}

/** A non-physics, always-settled die showing one fixed value — used for every static tile (bid track, roster backs, reveal panel). */
export function DieTile({ value = 1, yaw = 0, ...meshProps }: DieTileProps) {
  const quaternion = useMemo(() => (meshProps.blank ? new THREE.Quaternion() : quaternionForFaceUp(value, yaw)), [meshProps.blank, value, yaw]);
  return (
    <group quaternion={quaternion}>
      <DiceMesh {...meshProps} />
    </group>
  );
}
