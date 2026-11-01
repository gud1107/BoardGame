"use client";

import { useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { VRMHumanBoneName } from "@pixiv/three-vrm";
import { blinking, type PersonLook } from "@/games/shared/three/SeatedPerson";
import { tickVrm, useVrmAvatar } from "@/games/shared/three/VrmPerson";
import { toVrm0 } from "@/games/shared/three/vrmPose";

/**
 * A standing VRM fighter for 죽은척 기싸움 — the player's own character (same look as at
 * every 3D table, via `useVrmAvatar`) posed procedurally on the normalized humanoid bones.
 *
 * Poses are target joint angles blended per frame (no per-frame allocation); timed poses
 * (casting, rising, ambushing) read the seconds since `poseKey` last changed.
 * A body lying down looks exactly the same whether the player is really dead or faking:
 * same pose, same closed eyes, no breathing — the hidden state never reaches this file.
 */

export type FighterPose = "idle" | "charge" | "block" | "pa" | "jangpung" | "energy" | "loot" | "finish" | "hit" | "down" | "rise" | "ambush" | "win";

export interface VrmFighterProps {
  look: PersonLook;
  seed: number;
  home: THREE.Vector3;
  /** yaw facing the arena centre */
  facing: number;
  pose: FighterPose;
  /** changes whenever the pose should restart its timeline */
  poseKey: string;
  /** walk here (loot / finish), else stay home */
  moveTo: THREE.Vector3 | null;
  /** turn to face this point (casting, walking up to a body) */
  aimAt: THREE.Vector3 | null;
  /** greyed out: death confirmed */
  out: boolean;
  lowDetail: boolean;
  onPick?: () => void;
  children?: ReactNode;
}

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
/** extra channels after the bones: fall (0..1), crouch (m, pre-scale), hop (m) */
const FALL = BONES.length * 3;
const CROUCH = FALL + 1;
const HOP = FALL + 2;
const CHANNELS = HOP + 1;

const HEAD_HEIGHT = 1.52;
/** Which side a fighter topples to (±1) — sideways along the ring, so a body never falls out of shot. */
export function fallSide(seed: number): number {
  return seed % 2 === 0 ? 1 : -1;
}

function set3(o: Float32Array, at: number, x: number, y: number, z: number) {
  o[at] = x;
  o[at + 1] = y;
  o[at + 2] = z;
}

function idle(o: Float32Array, t: number, seed: number) {
  o.fill(0);
  const sway = Math.sin(t * 1.7 + seed) * 0.03;
  set3(o, B.rightUpperArm, -0.1, 0, 1.2 + sway);
  set3(o, B.leftUpperArm, -0.1, 0, -1.2 - sway);
  set3(o, B.rightLowerArm, 0, 0.3, 0);
  set3(o, B.leftLowerArm, 0, -0.3, 0);
  set3(o, B.spine, Math.sin(t * 2.1 + seed) * 0.02, 0, 0);
  set3(o, B.rightUpperLeg, 0, 0, 0.05);
  set3(o, B.leftUpperLeg, 0, 0, -0.05);
}

function chargePose(o: Float32Array, t: number) {
  // fists pulled to the belly, knees bent — 기를 모으는 자세
  const pulse = Math.sin(t * 9) * 0.04;
  set3(o, B.rightUpperArm, 0.35, 0, 1.0);
  set3(o, B.leftUpperArm, 0.35, 0, -1.0);
  set3(o, B.rightLowerArm, 0, 1.95 + pulse, 0);
  set3(o, B.leftLowerArm, 0, -1.95 - pulse, 0);
  set3(o, B.spine, 0.18, 0, 0);
  set3(o, B.head, -0.12, 0, 0);
  set3(o, B.rightUpperLeg, -0.45, 0, 0.18);
  set3(o, B.leftUpperLeg, -0.45, 0, -0.18);
  set3(o, B.rightLowerLeg, 0.85, 0, 0);
  set3(o, B.leftLowerLeg, 0.85, 0, 0);
  o[CROUCH] = 0.1;
}

function thrust(o: Float32Array, power: number) {
  // both palms pushed at the target
  set3(o, B.rightUpperArm, -1.5, 0.15, 1.3);
  set3(o, B.leftUpperArm, -1.5, -0.15, -1.3);
  set3(o, B.rightLowerArm, 0, 0.1, 0);
  set3(o, B.leftLowerArm, 0, -0.1, 0);
  set3(o, B.spine, 0.1 + power * 0.05, 0, 0);
  set3(o, B.head, -0.05, 0, 0);
  set3(o, B.rightUpperLeg, 0.3, 0, 0.12);
  set3(o, B.leftUpperLeg, -0.55, 0, -0.12);
  set3(o, B.leftLowerLeg, 0.6, 0, 0);
  o[CROUCH] = 0.05 + power * 0.02;
}

function lying(o: Float32Array) {
  o.fill(0);
  // arms along the body — nothing sticks up out of a lying silhouette
  set3(o, B.rightUpperArm, 0.1, 0, 1.4);
  set3(o, B.leftUpperArm, 0.1, 0, -1.4);
  set3(o, B.rightLowerArm, 0, 0.15, 0);
  set3(o, B.leftLowerArm, 0, -0.15, 0);
  set3(o, B.rightUpperLeg, 0, 0, 0.1);
  set3(o, B.leftUpperLeg, 0, 0, -0.1);
  set3(o, B.head, 0, 0.35, 0);
  o[FALL] = 1;
}

/** Target channels for a pose `u` seconds after it started. */
function poseTarget(o: Float32Array, pose: FighterPose, u: number, t: number, seed: number) {
  idle(o, t, seed);
  switch (pose) {
    case "idle":
      return;
    case "charge":
      return chargePose(o, t);
    case "block":
      // forearms crossed in front of the face
      set3(o, B.rightUpperArm, -1.2, 0.55, 0.95);
      set3(o, B.leftUpperArm, -1.2, -0.55, -0.95);
      set3(o, B.rightLowerArm, 0, 1.75, 0);
      set3(o, B.leftLowerArm, 0, -1.75, 0);
      set3(o, B.spine, 0.08, 0, 0);
      set3(o, B.rightUpperLeg, -0.25, 0, 0.15);
      set3(o, B.leftUpperLeg, -0.25, 0, -0.15);
      set3(o, B.rightLowerLeg, 0.45, 0, 0);
      set3(o, B.leftLowerLeg, 0.45, 0, 0);
      o[CROUCH] = 0.05;
      return;
    case "pa":
    case "jangpung":
    case "energy": {
      const wind = pose === "energy" ? 0.45 : 0.3;
      if (u < wind) chargePose(o, t);
      else thrust(o, pose === "energy" ? 2 : pose === "jangpung" ? 1 : 0);
      return;
    }
    case "hit":
      set3(o, B.spine, -0.4, 0, 0);
      set3(o, B.head, -0.35, 0, 0);
      set3(o, B.rightUpperArm, -0.5, 0, 0.45);
      set3(o, B.leftUpperArm, -0.5, 0, -0.45);
      set3(o, B.rightLowerArm, 0, 0.6, 0);
      set3(o, B.leftLowerArm, 0, -0.6, 0);
      o[FALL] = Math.min(1, Math.max(0, (u - 0.25) / 0.35));
      return;
    case "down":
      return lying(o);
    case "rise":
    case "ambush": {
      // spring up from the floor, then (ambush) strike
      if (u < 0.15) lying(o);
      else if (pose === "ambush" && u > 0.55) thrust(o, 1);
      else chargePose(o, t);
      o[FALL] = u < 0.15 ? 1 : Math.max(0, 1 - (u - 0.15) / 0.2);
      o[HOP] = u > 0.15 && u < 0.6 ? Math.sin(((u - 0.15) / 0.45) * Math.PI) * 0.35 : 0;
      return;
    }
    case "loot":
      // crouch over the body, rummaging
      set3(o, B.spine, 0.75, 0, 0);
      set3(o, B.head, 0.2, 0, 0);
      set3(o, B.rightUpperArm, -1.0, 0, 1.15 + Math.sin(t * 10) * 0.12);
      set3(o, B.leftUpperArm, -1.0, 0, -1.15 - Math.sin(t * 10 + 1) * 0.12);
      set3(o, B.rightUpperLeg, -0.75, 0, 0.2);
      set3(o, B.leftUpperLeg, -0.75, 0, -0.2);
      set3(o, B.rightLowerLeg, 1.3, 0, 0);
      set3(o, B.leftLowerLeg, 1.3, 0, 0);
      o[CROUCH] = 0.22;
      return;
    case "finish": {
      // raise both fists, then smash down at the body
      const down = u > 0.75;
      set3(o, B.spine, down ? 0.55 : -0.1, 0, 0);
      set3(o, B.rightUpperArm, down ? -0.9 : 0.2, 0, down ? 1.3 : -1.0);
      set3(o, B.leftUpperArm, down ? -0.9 : 0.2, 0, down ? -1.3 : 1.0);
      set3(o, B.rightLowerArm, 0, down ? 0.1 : 0.6, 0);
      set3(o, B.leftLowerArm, 0, down ? -0.1 : -0.6, 0);
      set3(o, B.rightUpperLeg, -0.4, 0, 0.15);
      set3(o, B.leftUpperLeg, -0.4, 0, -0.15);
      set3(o, B.rightLowerLeg, 0.7, 0, 0);
      set3(o, B.leftLowerLeg, 0.7, 0, 0);
      o[CROUCH] = 0.1;
      return;
    }
    case "win":
      set3(o, B.rightUpperArm, -0.2, 0, -1.1 + Math.sin(t * 6) * 0.15);
      set3(o, B.leftUpperArm, -0.2, 0, 1.1 - Math.sin(t * 6) * 0.15);
      set3(o, B.rightLowerArm, 0, 0.2, 0);
      set3(o, B.leftLowerArm, 0, -0.2, 0);
      set3(o, B.spine, -0.1, 0, 0);
      o[HOP] = Math.abs(Math.sin(t * 6)) * 0.12;
      return;
  }
}

/** Facial preset weights per pose; a body on the floor always shows the same shut eyes. */
function face(pose: FighterPose, u: number): { angry: number; sad: number; surprised: number; happy: number; aa: number; shut: boolean } {
  switch (pose) {
    case "charge":
      return { angry: 0.45, sad: 0, surprised: 0, happy: 0, aa: 0, shut: false };
    case "block":
      return { angry: 0.3, sad: 0, surprised: 0, happy: 0, aa: 0, shut: false };
    case "pa":
    case "jangpung":
    case "energy":
    case "finish":
      return { angry: 1, sad: 0, surprised: 0, happy: 0, aa: u > 0.3 ? 0.75 : 0.2, shut: false };
    case "ambush":
    case "rise":
      return { angry: u > 0.4 ? 0.8 : 0, sad: 0, surprised: u <= 0.4 ? 1 : 0, happy: 0, aa: 0.5, shut: u < 0.15 };
    case "hit":
      return { angry: 0, sad: 0.8, surprised: u < 0.3 ? 1 : 0, happy: 0, aa: 0.4, shut: u > 0.5 };
    case "down":
      return { angry: 0, sad: 0, surprised: 0, happy: 0, aa: 0, shut: true };
    case "loot":
      return { angry: 0, sad: 0, surprised: 0, happy: 0.55, aa: 0, shut: false };
    case "win":
      return { angry: 0, sad: 0, surprised: 0, happy: 1, aa: 0.3, shut: false };
    default:
      return { angry: 0, sad: 0, surprised: 0, happy: 0, aa: 0, shut: false };
  }
}

const fQ = new THREE.Quaternion();
const fE = new THREE.Euler();
const tmpV = new THREE.Vector3();

export default function VrmFighter(props: VrmFighterProps) {
  const { look, seed, home, facing, pose, poseKey, moveTo, aimAt, out, lowDetail } = props;
  const { vrm, morphs } = useVrmAvatar(look, seed, { out, lowDetail });
  const rootRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const state = useRef<{ key: string; start: number; yaw: number | null; walk: number; springs: { current: number }; cur: Float32Array; want: Float32Array } | null>(null);
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
    state.current ??= { key: "", start: 0, yaw: null, walk: 0, springs: { current: 0 }, cur: new Float32Array(CHANNELS), want: new Float32Array(CHANNELS) };
    const st = state.current;
    const { cur, want } = st;
    st.yaw ??= facing;
    if (st.key !== poseKey) {
      st.key = poseKey;
      st.start = t;
    }
    const u = t - st.start;

    // walk to the body being looted / finished, then back home
    const dest = moveTo ?? home;
    const dx = dest.x - root.position.x;
    const dz = dest.z - root.position.z;
    const dist = Math.hypot(dx, dz);
    const step = Math.min(dist, dt * 3.2);
    if (dist > 0.001) {
      root.position.x += (dx / dist) * step;
      root.position.z += (dz / dist) * step;
    }
    const walking = dist > 0.05;
    st.walk = walking ? st.walk + dt * 11 : 0;
    const look = walking ? tmpV.set(dest.x, 0, dest.z) : aimAt;
    const yawTo = look ? Math.atan2(look.x - root.position.x, look.z - root.position.z) : facing;
    let dy = yawTo - st.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    st.yaw += dy * (1 - Math.exp(-dt * 10));
    root.rotation.y = st.yaw;

    poseTarget(want, walking && pose !== "down" ? "idle" : pose, u, t, seed);
    if (walking) {
      const s = Math.sin(st.walk) * 0.55;
      want[B.rightUpperLeg] = s;
      want[B.leftUpperLeg] = -s;
      want[B.rightLowerLeg] = Math.max(0, -s) * 1.1;
      want[B.leftLowerLeg] = Math.max(0, s) * 1.1;
      want[B.rightUpperArm] = -s * 0.6;
      want[B.leftUpperArm] = s * 0.6;
    }
    const k = 1 - Math.exp(-dt * (pose === "hit" || pose === "rise" || pose === "ambush" ? 20 : 13));
    for (let i = 0; i < CHANNELS; i++) cur[i] += (want[i] - cur[i]) * k;

    // topple sideways about the feet; hips stay on the floor while lying
    const fall = cur[FALL];
    body.rotation.z = fallSide(seed) * fall * (Math.PI / 2);
    body.position.y = fall * 0.14 + cur[HOP] - cur[CROUCH] * (1 - fall);

    if (!vrm || !fit) return;
    const vrm0 = vrm.meta.metaVersion === "0";
    for (let i = 0; i < BONES.length; i++) {
      const node = vrm.humanoid.getNormalizedBoneNode(BONES[i]);
      if (!node) continue;
      fQ.setFromEuler(fE.set(cur[i * 3], cur[i * 3 + 1], cur[i * 3 + 2]));
      node.quaternion.copy(vrm0 ? toVrm0(fQ) : fQ);
    }
    const em = vrm.expressionManager;
    if (em) {
      const f = face(pose, u);
      em.setValue("angry", f.angry);
      em.setValue("sad", f.sad);
      em.setValue("surprised", f.surprised);
      em.setValue("happy", f.happy);
      em.setValue("aa", f.aa);
      em.setValue("blink", f.shut ? 1 : f.happy > 0.9 || f.surprised > 0 ? 0 : blinking(t, seed) ? 1 : 0);
    }
    tickVrm(vrm, dt, morphs.current, st.springs, lowDetail);
  });

  return (
    <group ref={rootRef} position={home}>
      {/* blob shadow — far cheaper than a skinned shadow-map pass per fighter */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.01}>
        <circleGeometry args={[0.42, 20]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <group ref={bodyRef}>{vrm && fit && <primitive object={vrm.scene} scale={fit} />}</group>
      {props.onPick && (
        <mesh
          position-y={0.9}
          onClick={(e) => {
            e.stopPropagation();
            props.onPick?.();
          }}
        >
          <cylinderGeometry args={[0.5, 0.5, 1.9, 10]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
      )}
      {props.children}
    </group>
  );
}

