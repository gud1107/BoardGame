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
 * The bowler at the foul line (rulebook §11) — the player's own character
 * (same look as at every 3D table, via `useVrmAvatar`) posed procedurally on
 * the normalized humanoid bones: ready with the ball at the chest, a
 * four-step approach with a pendulum swing and a sliding release, then a
 * cheer for a strike / spare or a slump for a miss.
 *
 * Axes (normalized VRM, facing +Z, Euler XYZ): an arm lowered by z then
 * swings back with +x and forward with −x; a thigh steps forward with −x.
 */

export type BowlerPose = "ready" | "approach" | "follow" | "cheer" | "slump" | "wait";

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
const HEAD_HEIGHT = 1.52;

function set3(o: Float32Array, at: number, x: number, y: number, z: number) {
  o[at] = x;
  o[at + 1] = y;
  o[at + 2] = z;
}

function rest(o: Float32Array, t: number, seed: number) {
  o.fill(0);
  const sway = Math.sin(t * 1.6 + seed) * 0.03;
  set3(o, B.rightUpperArm, 0, 0, 1.25 + sway);
  set3(o, B.leftUpperArm, 0, 0, -1.25 - sway);
  set3(o, B.rightLowerArm, 0, 0.25, 0);
  set3(o, B.leftLowerArm, 0, -0.25, 0);
  set3(o, B.spine, Math.sin(t * 2 + seed) * 0.02, 0, 0);
}

function ready(o: Float32Array, t: number) {
  o.fill(0);
  // ball cradled at the chest, eyes on the arrows
  const breathe = Math.sin(t * 2.2) * 0.02;
  set3(o, B.rightUpperArm, -0.55, 0.2, 1.15);
  set3(o, B.leftUpperArm, -0.55, -0.2, -1.15);
  set3(o, B.rightLowerArm, 0, 1.55, 0);
  set3(o, B.leftLowerArm, 0, -1.55, 0);
  set3(o, B.spine, 0.12 + breathe, 0, 0);
  set3(o, B.head, -0.1, 0, 0);
  set3(o, B.rightUpperLeg, -0.12, 0, 0.04);
  set3(o, B.leftUpperLeg, -0.12, 0, -0.04);
  set3(o, B.rightLowerLeg, 0.22, 0, 0);
  set3(o, B.leftLowerLeg, 0.22, 0, 0);
  o[CROUCH] = 0.04;
}

/** u = 0..1 through the approach (four steps, push-away, backswing, slide, release at 1). */
function approach(o: Float32Array, u: number) {
  o.fill(0);
  const steps = Math.min(1, u / 0.82);
  const stride = Math.sin(steps * Math.PI * 4) * 0.5;
  // pendulum: push-away → down → back (peak ~0.62) → forward to release at 1
  let arm: number;
  if (u < 0.2) arm = -0.6 + (u / 0.2) * 0.6;
  else if (u < 0.62) arm = ((u - 0.2) / 0.42) * 1.15;
  else arm = 1.15 - ((u - 0.62) / 0.38) * 1.75;
  set3(o, B.rightUpperArm, arm, 0, 1.22);
  set3(o, B.rightLowerArm, 0, 0.12, 0);
  // the free arm goes out for balance as the slide starts
  const out = Math.min(1, Math.max(0, (u - 0.55) / 0.3));
  set3(o, B.leftUpperArm, -0.2 * out, 0, -1.25 + out * 0.75);
  set3(o, B.leftLowerArm, 0, -0.3, 0);
  if (u < 0.82) {
    set3(o, B.rightUpperLeg, stride, 0, 0.04);
    set3(o, B.leftUpperLeg, -stride, 0, -0.04);
    set3(o, B.rightLowerLeg, Math.max(0, -stride) * 1.1 + 0.15, 0, 0);
    set3(o, B.leftLowerLeg, Math.max(0, stride) * 1.1 + 0.15, 0, 0);
    set3(o, B.spine, 0.15 + steps * 0.15, 0, 0);
    o[CROUCH] = 0.03 + steps * 0.08;
  } else {
    // the slide: left knee deep, right leg trailing behind
    const k = (u - 0.82) / 0.18;
    set3(o, B.leftUpperLeg, -0.95 * k - 0.3 * (1 - k), 0, -0.05);
    set3(o, B.leftLowerLeg, 1.15 * k + 0.3, 0, 0);
    set3(o, B.rightUpperLeg, 0.55 * k, 0, 0.18 * k);
    set3(o, B.rightLowerLeg, 0.4 * k, 0, 0);
    set3(o, B.spine, 0.3 + 0.12 * k, 0, 0);
    o[CROUCH] = 0.11 + 0.17 * k;
  }
  set3(o, B.head, -0.2, 0, 0);
}

function follow(o: Float32Array, u: number) {
  o.fill(0);
  // hold the finish: arm high toward the pins, slide leg bent
  const k = Math.min(1, u / 0.35);
  set3(o, B.rightUpperArm, -0.6 - k * 1.3, 0, 1.15);
  set3(o, B.rightLowerArm, 0, 0.2, 0);
  set3(o, B.leftUpperArm, -0.2, 0, -0.5);
  set3(o, B.leftLowerArm, 0, -0.3, 0);
  set3(o, B.leftUpperLeg, -0.95, 0, -0.05);
  set3(o, B.leftLowerLeg, 1.45, 0, 0);
  set3(o, B.rightUpperLeg, 0.55, 0, 0.18);
  set3(o, B.rightLowerLeg, 0.4, 0, 0);
  set3(o, B.spine, 0.42 - k * 0.1, 0, 0);
  set3(o, B.head, -0.35, 0, 0);
  o[CROUCH] = 0.28 - Math.max(0, u - 1.2) * 0.2;
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

function target(o: Float32Array, pose: BowlerPose, u: number, t: number, seed: number) {
  switch (pose) {
    case "ready":
      return ready(o, t);
    case "approach":
      return approach(o, Math.min(1, u));
    case "follow":
      return follow(o, u);
    case "cheer":
      return cheer(o, u, t);
    case "slump":
      return slump(o, t);
    default:
      return rest(o, t, seed);
  }
}

function face(pose: BowlerPose) {
  switch (pose) {
    case "approach":
    case "follow":
      return { happy: 0, sad: 0, surprised: 0, angry: 0.35, aa: 0 };
    case "cheer":
      return { happy: 1, sad: 0, surprised: 0, angry: 0, aa: 0.45 };
    case "slump":
      return { happy: 0, sad: 0.9, surprised: 0, angry: 0, aa: 0 };
    default:
      return { happy: 0.15, sad: 0, surprised: 0, angry: 0, aa: 0 };
  }
}

/**
 * Where the bowler stands / walks to and how far through the approach the
 * replay is — written by the scene every frame, read here (one alley at a time).
 */
export const bowlerRig = { progress: 0, from: new THREE.Vector3(-0.22, 0, 2.25), to: new THREE.Vector3(-0.22, 0, 0.45) };

const fQ = new THREE.Quaternion();
const fE = new THREE.Euler();

export interface BowlerProps {
  look: PersonLook;
  seed: number;
  pose: BowlerPose;
  /** Changes whenever the pose should restart its timeline. */
  poseKey: string;
  lowDetail: boolean;
}

export default function Bowler({ look, seed, pose, poseKey, lowDetail }: BowlerProps) {
  const { vrm, morphs } = useVrmAvatar(look, seed, { lowDetail });
  const rootRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const st = useRef<{ key: string; start: number; springs: { current: number }; cur: Float32Array; want: Float32Array } | null>(null);
  const fit = useMemo(() => {
    if (!vrm) return null;
    const head = vrm.humanoid.getNormalizedBoneNode("head");
    const y = head ? head.getWorldPosition(new THREE.Vector3()).y : 1.4;
    return HEAD_HEIGHT / Math.max(0.5, y);
  }, [vrm]);

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
    const u = pose === "approach" ? bowlerRig.progress : t - s.start;
    // walk from the stance to the foul line with the approach
    const walk = pose === "approach" ? Math.min(1, u / 0.95) : pose === "ready" || pose === "wait" ? 0 : 1;
    const ease = walk * walk * (3 - 2 * walk);
    root.position.lerpVectors(bowlerRig.from, bowlerRig.to, ease);
    root.rotation.y = Math.PI;

    target(s.want, pose, u, t, seed);
    const k = 1 - Math.exp(-dt * (pose === "approach" ? 22 : 10));
    for (let i = 0; i < CHANNELS; i++) s.cur[i] += (s.want[i] - s.cur[i]) * k;
    body.position.y = s.cur[HOP] - s.cur[CROUCH];

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
      const f = face(pose);
      em.setValue("happy", f.happy);
      em.setValue("sad", f.sad);
      em.setValue("surprised", f.surprised);
      em.setValue("angry", f.angry);
      em.setValue("aa", f.aa);
      em.setValue("blink", f.happy > 0.9 ? 0 : blinkAmount(t, seed));
    }
    tickVrm(vrm, dt, morphs.current, s.springs, lowDetail, { t, seed });
  });

  return (
    <group ref={rootRef}>
      <mesh rotation-x={-Math.PI / 2} position-y={0.012}>
        <circleGeometry args={[0.36, 20]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <group ref={bodyRef}>{vrm && fit && <primitive object={vrm.scene} scale={fit} />}</group>
    </group>
  );
}
