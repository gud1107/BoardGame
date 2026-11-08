"use client";

import { useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { VRMHumanBoneName } from "@pixiv/three-vrm";
import { blinking, type PersonLook } from "@/games/shared/three/SeatedPerson";
import { tickVrm, useVrmAvatar } from "@/games/shared/three/VrmPerson";
import { fingerAngles, thumbAngles, type Side } from "@/games/shared/three/vrmHands";
import { toVrm0 } from "@/games/shared/three/vrmPose";

/**
 * A standing VRM fighter for 죽은척 대작전 — the player's own character (same look as at
 * every 3D table, via `useVrmAvatar`) posed procedurally on the normalized humanoid bones.
 *
 * Poses are target joint angles blended per frame (no per-frame allocation); timed poses
 * (casting, rising, ambushing) read the seconds since `poseKey` last changed.
 * A body lying down looks exactly the same whether the player is really dead or faking:
 * same pose, same closed eyes, no breathing — the hidden state never reaches this file.
 */

export type FighterPose = "idle" | "reload" | "cover" | "shot" | "burst" | "grenade" | "loot" | "finish" | "hit" | "down" | "rise" | "ambush" | "win" | "slump" | "sprawl" | "curl";

/** 쓰러진(맞은) 몸의 자세 — 바닥에 누운 셋 중 앉은 자세(slump)만 몸을 세운다 */
export const LYING_POSES: ReadonlySet<FighterPose> = new Set(["down", "sprawl", "curl"]);

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
  /** walking speed (m/s), default 3.2 */
  speed?: number;
  /** body scale on top of the fitted height (1 = 1.52 m to the head) */
  size?: number;
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
/** 앉은 자세에서 엉덩이를 바닥까지 내리는 높이(m) — 머리 1.52 m 기준 골반 높이쯤 */
const SIT_DROP = 0.7;
/** Finger curl: relaxed, and wrapped round the rifle (right fist on the grip, left hand cupping the handguard). */
const CURL_REST = 0.15;
const CURL_GRIP = { r: 0.9, l: 0.65 } as const;

/** Finger/thumb angles per side for a curl, quantised to 1/50 so the frame loop reuses them. */
const handCache = new Map<string, readonly (readonly [VRMHumanBoneName, number, number])[]>();
function handShape(side: Side, curl: number) {
  const k = Math.round(Math.max(0, Math.min(1, curl)) * 50);
  const id = side + k;
  let v = handCache.get(id);
  if (!v) handCache.set(id, (v = [...fingerAngles(side, k / 50), ...thumbAngles(side, k / 50)]));
  return v;
}
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

function reloadPose(o: Float32Array, t: number) {
  // kneeling, hands at the chest working the magazine — 장전
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

function aim(o: Float32Array, recoil: number) {
  // shouldered rifle: right hand at the grip, left hand forward under the barrel
  set3(o, B.rightUpperArm, -0.75 + recoil * 0.12, 0.5, 1.25);
  set3(o, B.leftUpperArm, -1.2 + recoil * 0.12, -0.45, -1.15);
  set3(o, B.rightLowerArm, 0, 1.55, 0);
  set3(o, B.leftLowerArm, 0, -0.35, 0);
  set3(o, B.spine, 0.12 - recoil * 0.06, 0, 0);
  set3(o, B.head, 0.12, 0.15, 0);
  set3(o, B.rightUpperLeg, -0.35, 0, 0.15);
  set3(o, B.leftUpperLeg, -0.75, 0, -0.1);
  set3(o, B.rightLowerLeg, 1.1, 0, 0);
  set3(o, B.leftLowerLeg, 0.8, 0, 0);
  o[CROUCH] = 0.16;
}

function throwing(o: Float32Array, u: number) {
  // wind the right arm back over the shoulder, then hurl
  const out = u > 0.75;
  set3(o, B.rightUpperArm, out ? -1.6 : 0.5, 0, out ? 1.2 : -0.6);
  set3(o, B.rightLowerArm, 0, out ? 0.2 : 1.4, 0);
  set3(o, B.leftUpperArm, -1.2, 0, -1.2);
  set3(o, B.leftLowerArm, 0, -0.2, 0);
  set3(o, B.spine, out ? 0.25 : -0.2, out ? -0.3 : 0.35, 0);
  set3(o, B.rightUpperLeg, out ? -0.5 : 0.25, 0, 0.12);
  set3(o, B.leftUpperLeg, out ? 0.2 : -0.45, 0, -0.12);
  set3(o, B.leftLowerLeg, 0.4, 0, 0);
  o[CROUCH] = 0.08;
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

/** 앉은 채 고개를 떨군 몸: 엉덩이는 바닥, 다리는 앞으로 뻗고, 팔은 축 늘어뜨린다 */
function slumped(o: Float32Array) {
  o.fill(0);
  set3(o, B.rightUpperLeg, -1.45, 0, 0.18);
  set3(o, B.leftUpperLeg, -1.4, 0, -0.22);
  set3(o, B.rightLowerLeg, 0.35, 0, 0);
  set3(o, B.leftLowerLeg, 0.15, 0, 0);
  set3(o, B.spine, 0.35, 0, 0.08);
  set3(o, B.chest, 0.3, 0, 0);
  set3(o, B.neck, 0.35, 0, 0);
  set3(o, B.head, 0.45, 0.25, 0.35);
  set3(o, B.rightUpperArm, 0.25, 0, 1.3);
  set3(o, B.leftUpperArm, 0.35, 0, -1.25);
  set3(o, B.rightLowerArm, 0, 0.35, 0);
  set3(o, B.leftLowerArm, 0, -0.2, 0);
  o[CROUCH] = SIT_DROP;
}

/** 옆으로 뻗은 몸: 한 팔은 앞으로 내던지고 한 다리는 굽힌 채 고개가 꺾였다 */
function sprawled(o: Float32Array) {
  lying(o);
  set3(o, B.rightUpperArm, -1.35, 0.2, 0.9);
  set3(o, B.rightLowerArm, 0, 0.5, 0);
  set3(o, B.leftUpperArm, -0.3, 0, -1.25);
  set3(o, B.rightUpperLeg, -0.95, 0, 0.1);
  set3(o, B.rightLowerLeg, 1.35, 0, 0);
  set3(o, B.leftUpperLeg, 0.15, 0, -0.05);
  set3(o, B.spine, -0.15, 0.2, 0);
  set3(o, B.head, -0.35, 0.55, 0);
}

/** 배를 움켜쥐고 웅크린 몸 */
function curled(o: Float32Array) {
  lying(o);
  set3(o, B.spine, 0.5, 0, 0);
  set3(o, B.chest, 0.25, 0, 0);
  set3(o, B.head, 0.45, 0.2, 0);
  set3(o, B.rightUpperLeg, -1.3, 0, 0.12);
  set3(o, B.leftUpperLeg, -1.15, 0, -0.12);
  set3(o, B.rightLowerLeg, 1.8, 0, 0);
  set3(o, B.leftLowerLeg, 1.65, 0, 0);
  set3(o, B.rightUpperArm, -0.45, 0, 1.05);
  set3(o, B.leftUpperArm, -0.45, 0, -1.05);
  set3(o, B.rightLowerArm, 0, 1.85, 0);
  set3(o, B.leftLowerArm, 0, -1.85, 0);
}

/** Target channels for a pose `u` seconds after it started. */
function poseTarget(o: Float32Array, pose: FighterPose, u: number, t: number, seed: number) {
  idle(o, t, seed);
  switch (pose) {
    case "idle":
      return;
    case "reload":
      return reloadPose(o, t);
    case "cover":
      // duck low, hands over the head
      set3(o, B.rightUpperArm, -2.3, 0.4, 1.0);
      set3(o, B.leftUpperArm, -2.3, -0.4, -1.0);
      set3(o, B.rightLowerArm, 0, 1.9, 0);
      set3(o, B.leftLowerArm, 0, -1.9, 0);
      set3(o, B.spine, 0.6, 0, 0);
      set3(o, B.head, 0.45, 0, 0);
      set3(o, B.rightUpperLeg, -1.0, 0, 0.2);
      set3(o, B.leftUpperLeg, -1.0, 0, -0.2);
      set3(o, B.rightLowerLeg, 1.7, 0, 0);
      set3(o, B.leftLowerLeg, 1.7, 0, 0);
      o[CROUCH] = 0.38;
      return;
    case "shot":
    case "burst":
    case "grenade": {
      if (pose === "grenade") return throwing(o, u);
      // raise the rifle, then fire (burst kicks three times)
      const kick = pose === "burst" ? Math.max(0, Math.sin((u - 0.3) * 35)) : u > 0.3 && u < 0.4 ? 1 : 0;
      aim(o, u < 0.3 ? 0 : kick);
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
    case "slump":
      return slumped(o);
    case "sprawl":
      return sprawled(o);
    case "curl":
      return curled(o);
    case "rise":
    case "ambush": {
      // spring up from the floor, then (ambush) strike
      if (u < 0.15) lying(o);
      else if (pose === "ambush" && u > 0.55) aim(o, u < 0.7 ? 1 : 0);
      else reloadPose(o, t);
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
    case "reload":
      return { angry: 0.45, sad: 0, surprised: 0, happy: 0, aa: 0, shut: false };
    case "cover":
      return { angry: 0.3, sad: 0, surprised: 0, happy: 0, aa: 0, shut: false };
    case "shot":
    case "burst":
    case "grenade":
    case "finish":
      return { angry: 1, sad: 0, surprised: 0, happy: 0, aa: u > 0.3 ? 0.75 : 0.2, shut: false };
    case "ambush":
    case "rise":
      return { angry: u > 0.4 ? 0.8 : 0, sad: 0, surprised: u <= 0.4 ? 1 : 0, happy: 0, aa: 0.5, shut: u < 0.15 };
    case "hit":
      return { angry: 0, sad: 0.8, surprised: u < 0.3 ? 1 : 0, happy: 0, aa: 0.4, shut: u > 0.5 };
    case "down":
    case "slump":
    case "sprawl":
      return { angry: 0, sad: 0, surprised: 0, happy: 0, aa: 0, shut: true };
    case "curl":
      return { angry: 0, sad: 0.45, surprised: 0, happy: 0, aa: 0.15, shut: true };
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

/** Rifle-space points the palms sit on: right fist round the pistol grip, left fist round the handguard. */
const GRIP = new THREE.Vector3(0, -0.07, 0.38);
const FORE = new THREE.Vector3(0, -0.01, 0.75);
const GRIP_TO_FORE = FORE.clone().sub(GRIP).normalize();
const UP = new THREE.Vector3(0, 1, 0);
const palmR = new THREE.Vector3();
const palmL = new THREE.Vector3();
const gunDir = new THREE.Vector3();
const gunUp = new THREE.Vector3();
const wantUp = new THREE.Vector3();
const gunQ = new THREE.Quaternion();
const rollQ = new THREE.Quaternion();

/** Palm centre in `space`'s local frame: wrist pulled 60% toward the middle knuckle. */
function palm(vrm: NonNullable<ReturnType<typeof useVrmAvatar>["vrm"]>, side: "left" | "right", space: THREE.Object3D, out: THREE.Vector3): boolean {
  const hand = vrm.humanoid.getRawBoneNode(`${side}Hand`);
  if (!hand) return false;
  hand.updateWorldMatrix(true, false);
  hand.getWorldPosition(out);
  const knuckle = vrm.humanoid.getRawBoneNode(`${side}MiddleProximal`);
  if (knuckle) {
    knuckle.updateWorldMatrix(false, false);
    out.lerp(knuckle.getWorldPosition(tmpV), 0.6);
  }
  space.worldToLocal(out);
  return true;
}

/**
 * Seat the rifle in the hands: grip on the right palm, barrel through the left palm, kept upright.
 * Arm angles alone leave a model-dependent gap (every VRM has different arm lengths).
 */
function seatRifle(rifle: THREE.Group, body: THREE.Group, vrm: NonNullable<ReturnType<typeof useVrmAvatar>["vrm"]>) {
  if (!palm(vrm, "right", body, palmR) || !palm(vrm, "left", body, palmL)) return;
  gunDir.subVectors(palmL, palmR);
  // hands still swinging up (or crossed): point it straight ahead instead of backwards
  if (gunDir.lengthSq() < 1e-4 || gunDir.normalize().z < 0.3) gunDir.set(0, 0, 1);
  gunQ.setFromUnitVectors(GRIP_TO_FORE, gunDir);
  // roll about the barrel so the sights stay on top
  gunUp.copy(UP).applyQuaternion(gunQ);
  gunUp.addScaledVector(gunDir, -gunUp.dot(gunDir));
  wantUp.copy(UP).addScaledVector(gunDir, -gunDir.y);
  if (gunUp.lengthSq() > 1e-6 && wantUp.lengthSq() > 1e-6) {
    gunUp.normalize();
    wantUp.normalize();
    const roll = Math.atan2(tmpV.crossVectors(gunUp, wantUp).dot(gunDir), gunUp.dot(wantUp));
    gunQ.premultiply(rollQ.setFromAxisAngle(gunDir, roll));
  }
  rifle.quaternion.copy(gunQ);
  rifle.position.copy(palmR).sub(tmpV.copy(GRIP).applyQuaternion(gunQ));
}

export default function VrmFighter(props: VrmFighterProps) {
  const { look, seed, home, facing, pose, poseKey, moveTo, aimAt, out, lowDetail, speed = 3.2, size = 1 } = props;
  const { vrm, morphs } = useVrmAvatar(look, seed, { out, lowDetail });
  const rootRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const rifleRef = useRef<THREE.Group>(null);
  const flashRef = useRef<THREE.Mesh>(null);
  const state = useRef<{ key: string; start: number; yaw: number | null; walk: number; curl: { r: number; l: number }; springs: { current: number }; cur: Float32Array; want: Float32Array } | null>(null);
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
    state.current ??= { key: "", start: 0, yaw: null, walk: 0, curl: { r: CURL_REST, l: CURL_REST }, springs: { current: 0 }, cur: new Float32Array(CHANNELS), want: new Float32Array(CHANNELS) };
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
    const step = Math.min(dist, dt * speed);
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

    poseTarget(want, walking && !LYING_POSES.has(pose) && pose !== "slump" ? "idle" : pose, u, t, seed);
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
    // the rifle comes out only while firing — lying bodies all look alike
    const firing = pose === "shot" || pose === "burst" || (pose === "ambush" && u > 0.55);
    if (rifleRef.current) rifleRef.current.visible = firing && u > 0.12 && fall < 0.3;
    if (flashRef.current) {
      const burstKick = pose === "burst" && Math.sin((u - 0.3) * 35) > 0.85 && u < 0.7;
      const singleKick = (pose === "shot" && u > 0.3 && u < 0.37) || (pose === "ambush" && u > 0.55 && u < 0.62);
      flashRef.current.visible = firing && (burstKick || singleKick);
    }

    if (!vrm || !fit) return;
    const vrm0 = vrm.meta.metaVersion === "0";
    for (let i = 0; i < BONES.length; i++) {
      const node = vrm.humanoid.getNormalizedBoneNode(BONES[i]);
      if (!node) continue;
      fQ.setFromEuler(fE.set(cur[i * 3], cur[i * 3 + 1], cur[i * 3 + 2]));
      node.quaternion.copy(vrm0 ? toVrm0(fQ) : fQ);
    }
    // fingers close round the rifle while it's out
    const armed = !!rifleRef.current?.visible;
    const kc = 1 - Math.exp(-dt * 16);
    for (const side of ["r", "l"] as const) {
      st.curl[side] += ((armed ? CURL_GRIP[side] : CURL_REST) - st.curl[side]) * kc;
      for (const [name, y, z] of handShape(side, st.curl[side])) {
        const node = vrm.humanoid.getNormalizedBoneNode(name);
        if (!node) continue;
        fQ.setFromEuler(fE.set(0, y, z));
        node.quaternion.copy(vrm0 ? toVrm0(fQ) : fQ);
      }
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
    if (rifleRef.current?.visible) seatRifle(rifleRef.current, body, vrm);
  });

  return (
    <group ref={rootRef} position={home}>
      {/* blob shadow — far cheaper than a skinned shadow-map pass per fighter */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.01}>
        <circleGeometry args={[0.42, 20]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <group ref={bodyRef}>
        {vrm && fit && <primitive object={vrm.scene} scale={fit * size} />}
        <group ref={rifleRef} position={[0.1, 1.18 * size, 0.12]} visible={false}>
          <mesh position={[0, 0, 0.42]}>
            <boxGeometry args={[0.05, 0.08, 0.5]} />
            <meshStandardMaterial color="#26282a" metalness={0.6} roughness={0.45} />
          </mesh>
          <mesh position={[0, 0.01, 0.82]} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.014, 0.014, 0.32, 8]} />
            <meshStandardMaterial color="#1b1c1e" metalness={0.7} roughness={0.4} />
          </mesh>
          <mesh position={[0, -0.02, 0.12]}>
            <boxGeometry args={[0.05, 0.1, 0.22]} />
            <meshStandardMaterial color="#5a3b22" roughness={0.8} />
          </mesh>
          {/* pistol grip — the right palm sits on it (GRIP) */}
          <mesh position={[0, -0.1, 0.38]} rotation-x={0.25}>
            <boxGeometry args={[0.04, 0.14, 0.06]} />
            <meshStandardMaterial color="#26282a" metalness={0.6} roughness={0.45} />
          </mesh>
          {/* handguard — the left fist closes round it (FORE) */}
          <mesh position={[0, -0.01, 0.75]}>
            <boxGeometry args={[0.045, 0.06, 0.34]} />
            <meshStandardMaterial color="#3a3d33" roughness={0.7} />
          </mesh>
          <mesh ref={flashRef} position={[0, 0.01, 1.02]} visible={false}>
            <sphereGeometry args={[0.09, 8, 6]} />
            <meshBasicMaterial color="#ffd27a" transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
          </mesh>
        </group>
      </group>
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

