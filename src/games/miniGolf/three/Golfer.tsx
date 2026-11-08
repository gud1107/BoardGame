"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { VRMHumanBoneName } from "@pixiv/three-vrm";
import type { PersonLook } from "@/games/shared/three/SeatedPerson";
import { blinkAmount } from "@/games/shared/three/vrmLife";
import { tickVrm, useVrmAvatar } from "@/games/shared/three/VrmPerson";
import { toVrm0 } from "@/games/shared/three/vrmPose";

/**
 * The golfer at the ball (rulebook §11) — the player's own character (same
 * look as at every 3D table, via `useVrmAvatar`) posed procedurally on the
 * normalized humanoid bones: addressing the ball with a putter, a pendulum
 * stroke whose backswing grows with the power, then a cheer or a slump.
 *
 * The golfer stands side-on with the target on their left (a right-handed
 * putter), so in the root's local frame the ball is at +Z and the aim runs
 * along +X. The putter is its own mesh hung from the hands' pivot.
 */

export type GolferPose = "address" | "swing" | "follow" | "cheer" | "slump" | "wait";

const BONES: VRMHumanBoneName[] = [
  "spine",
  "chest",
  "neck",
  "head",
  "rightUpperArm",
  "rightLowerArm",
  "leftUpperArm",
  "leftLowerArm",
  "rightUpperLeg",
  "rightLowerLeg",
  "leftUpperLeg",
  "leftLowerLeg",
];
const B = Object.fromEntries(BONES.map((b, i) => [b, i * 3])) as Record<(typeof BONES)[number], number>;
const CROUCH = BONES.length * 3;
const HOP = CROUCH + 1;
const CHANNELS = HOP + 1;
const HEAD_HEIGHT = 1.5;
/** Ball distance in front of the golfer's feet (m). */
export const STANCE = 0.42;

function set3(o: Float32Array, at: number, x: number, y: number, z: number) {
  o[at] = x;
  o[at + 1] = y;
  o[at + 2] = z;
}

function holdPutter(o: Float32Array, rock: number, t: number) {
  const breathe = Math.sin(t * 2) * 0.015;
  set3(o, B.rightUpperArm, -0.42, 0.12 + rock * 0.35, 1.02);
  set3(o, B.leftUpperArm, -0.42, -0.12 + rock * 0.35, -1.02);
  set3(o, B.rightLowerArm, 0, 0.45, 0);
  set3(o, B.leftLowerArm, 0, -0.45, 0);
  set3(o, B.spine, 0.36 + breathe, rock * 0.25, 0);
  set3(o, B.chest, 0.08, rock * 0.2, 0);
  set3(o, B.head, 0.32, 0, 0);
  set3(o, B.rightUpperLeg, -0.18, 0, 0.12);
  set3(o, B.leftUpperLeg, -0.18, 0, -0.12);
  set3(o, B.rightLowerLeg, 0.3, 0, 0);
  set3(o, B.leftLowerLeg, 0.3, 0, 0);
  o[CROUCH] = 0.06;
}

function rest(o: Float32Array, t: number, seed: number) {
  o.fill(0);
  const sway = Math.sin(t * 1.6 + seed) * 0.03;
  set3(o, B.rightUpperArm, 0, 0, 1.25 + sway);
  set3(o, B.leftUpperArm, 0, 0, -1.25 - sway);
  set3(o, B.rightLowerArm, 0, 0.25, 0);
  set3(o, B.leftLowerArm, 0, -0.25, 0);
}

function cheer(o: Float32Array, u: number, t: number) {
  o.fill(0);
  const pump = Math.sin(t * 9) * 0.25;
  set3(o, B.rightUpperArm, 0, 0, -1.25 + pump);
  set3(o, B.leftUpperArm, 0, 0, 1.25 - pump);
  set3(o, B.rightLowerArm, 0, 0.4, 0);
  set3(o, B.leftLowerArm, 0, -0.4, 0);
  set3(o, B.head, -0.25, 0, 0);
  o[HOP] = Math.abs(Math.sin(u * 8)) * 0.14 * Math.max(0, 1 - u / 2.2);
}

function slump(o: Float32Array, t: number) {
  o.fill(0);
  const shake = Math.sin(t * 3) * 0.12;
  set3(o, B.rightUpperArm, -0.2, 0, 1.35);
  set3(o, B.leftUpperArm, -0.2, 0, -1.35);
  set3(o, B.spine, 0.32, shake * 0.3, 0);
  set3(o, B.head, 0.45, shake, 0);
  set3(o, B.rightUpperLeg, -0.2, 0, 0.05);
  set3(o, B.leftUpperLeg, -0.2, 0, -0.05);
  set3(o, B.rightLowerLeg, 0.35, 0, 0);
  set3(o, B.leftLowerLeg, 0.35, 0, 0);
  o[CROUCH] = 0.07;
}

/**
 * Shared with the scene (one golfer on screen at a time): where they stand,
 * which way the shot goes, and how far through the stroke the replay is.
 */
export const golferRig = { pos: new THREE.Vector3(), yaw: 0, progress: 0, power: 0.4 };

/** Putter swing angle (rad, + toward the target) for a pose at time u. */
export function putterAngle(pose: GolferPose, u: number, power: number): number {
  const back = -(0.16 + power * 0.62);
  if (pose === "swing") {
    if (u < 0.6) {
      const k = u / 0.6;
      return back * (k * k * (3 - 2 * k));
    }
    const k = (u - 0.6) / 0.4;
    return back * (1 - k * k);
  }
  if (pose === "follow") return Math.min(1, u / 0.25) * -back * 0.75;
  return 0;
}

const fQ = new THREE.Quaternion();
const fE = new THREE.Euler();

export interface GolferProps {
  look: PersonLook;
  seed: number;
  pose: GolferPose;
  poseKey: string;
  lowDetail: boolean;
  /** Ball colour for the putter grip. */
  color: string;
}

export default function Golfer({ look, seed, pose, poseKey, lowDetail, color }: GolferProps) {
  const { vrm, morphs } = useVrmAvatar(look, seed, { lowDetail });
  const rootRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const putterRef = useRef<THREE.Group>(null);
  const st = useRef<{ key: string; start: number; springs: { current: number }; cur: Float32Array; want: Float32Array } | null>(null);
  const fit = useMemo(() => {
    if (!vrm) return null;
    const head = vrm.humanoid.getNormalizedBoneNode("head");
    const y = head ? head.getWorldPosition(new THREE.Vector3()).y : 1.4;
    return HEAD_HEIGHT / Math.max(0.5, y);
  }, [vrm]);
  const showPutter = pose === "address" || pose === "swing" || pose === "follow";

  useFrame(({ clock }, dtRaw) => {
    const root = rootRef.current;
    const body = bodyRef.current;
    if (!root || !body) return;
    const dt = Math.min(dtRaw, 0.05);
    const t = clock.elapsedTime;
    st.current ??= { key: "", start: 0, springs: { current: 0 }, cur: new Float32Array(CHANNELS), want: new Float32Array(CHANNELS) };
    const s = st.current;
    if (s.key !== poseKey) {
      s.key = poseKey;
      s.start = t;
    }
    const u = pose === "swing" ? golferRig.progress : t - s.start;
    root.position.copy(golferRig.pos);
    root.rotation.y = golferRig.yaw;
    const a = putterAngle(pose, u, golferRig.power);
    const w = s.want;
    if (pose === "address" || pose === "swing" || pose === "follow") {
      w.fill(0);
      holdPutter(w, a, t);
      if (pose === "follow") set3(w, B.head, 0.1, 0.7 * Math.min(1, u / 0.6), 0);
    } else if (pose === "cheer") cheer(w, u, t);
    else if (pose === "slump") slump(w, t);
    else rest(w, t, seed);
    const k = 1 - Math.exp(-dt * (pose === "swing" ? 24 : 10));
    for (let i = 0; i < CHANNELS; i++) s.cur[i] += (w[i] - s.cur[i]) * k;
    body.position.y = s.cur[HOP] - s.cur[CROUCH];
    const putter = putterRef.current;
    if (putter) putter.rotation.z = a;

    if (!vrm || !fit) return;
    const vrm0 = vrm.meta.metaVersion === "0";
    for (let i = 0; i < BONES.length; i++) {
      const node = vrm.humanoid.getNormalizedBoneNode(BONES[i]);
      if (!node) continue;
      fQ.setFromEuler(fE.set(s.cur[i * 3], s.cur[i * 3 + 1], s.cur[i * 3 + 2]));
      node.quaternion.copy(vrm0 ? toVrm0(fQ) : fQ);
    }
    const em = vrm.expressionManager;
    if (em) {
      const happy = pose === "cheer" ? 1 : pose === "address" ? 0.15 : 0;
      em.setValue("happy", happy);
      em.setValue("sad", pose === "slump" ? 0.9 : 0);
      em.setValue("angry", pose === "swing" ? 0.3 : 0);
      em.setValue("aa", pose === "cheer" ? 0.45 : 0);
      em.setValue("blink", happy > 0.9 ? 0 : blinkAmount(t, seed));
    }
    tickVrm(vrm, dt, morphs.current, s.springs, lowDetail, { t, seed });
  });

  return (
    <group ref={rootRef}>
      <mesh rotation-x={-Math.PI / 2} position-y={0.004}>
        <circleGeometry args={[0.3, 20]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.3} depthWrite={false} />
      </mesh>
      <group ref={bodyRef}>{vrm && fit && <primitive object={vrm.scene} scale={fit} />}</group>
      {/* putter: pivot at the hands, shaft leaning out to the ball */}
      <group position={[0, 0.78, 0.2]} visible={showPutter}>
        <group ref={putterRef}>
          <group rotation-x={-0.29}>
            <mesh position={[0, -0.39, 0]}>
              <cylinderGeometry args={[0.007, 0.007, 0.78, 8]} />
              <meshStandardMaterial color="#c9ced6" metalness={0.85} roughness={0.25} />
            </mesh>
            <mesh position={[0, -0.05, 0]}>
              <cylinderGeometry args={[0.013, 0.012, 0.16, 8]} />
              <meshStandardMaterial color={color} roughness={0.6} />
            </mesh>
            <mesh position={[0.03, -0.78, 0.0]}>
              <boxGeometry args={[0.1, 0.028, 0.03]} />
              <meshStandardMaterial color="#2a2f3a" metalness={0.7} roughness={0.3} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
}
