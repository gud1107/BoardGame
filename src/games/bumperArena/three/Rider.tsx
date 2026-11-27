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
 * 범퍼 튜브를 탄 캐릭터 (룰북 §11). 프로필 캐릭터(VRM)를 허리까지 오는 튜브에 태우고
 * 상태(달리기·대시·버티기·점프·맞음·추락·승리)를 뼈 회전으로 만든다.
 *
 * 매 프레임 `read()`로 위치·상태를 받아 React 다시 그리기 없이 움직인다.
 * VRM은 +Z가 앞 — 시뮬 방향각 a(x=cos a, z=sin a)는 rotation.y = π/2 − a.
 */

export type RiderPose = "idle" | "run" | "dash" | "brace" | "air" | "hit" | "fall" | "cheer" | "sad";

export interface RiderFrame {
  x: number;
  y: number;
  z: number;
  face: number;
  pose: RiderPose;
  /** 몸 크기 배수 (거대화 1.45) */
  scale: number;
  /** 0~250 열기 % — 튜브가 하얀색→주황→빨강으로 달아오른다 */
  heat: number;
  shield: boolean;
  turbo: boolean;
  visible: boolean;
  /** 달리는 빠르기 0~1 */
  speed: number;
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
const CROUCH = BONES.length * 3;
const HOP = CROUCH + 1;
const CHANNELS = HOP + 1;
const HEAD_HEIGHT = 1.45;
/** 튜브 높이 (허리) */
export const TUBE_Y = 0.78;

function set3(o: Float32Array, at: number, x: number, y: number, z: number) {
  o[at] = x;
  o[at + 1] = y;
  o[at + 2] = z;
}

/** 두 손으로 튜브를 잡은 기본 자세 */
function grip(o: Float32Array, t: number, seed: number) {
  o.fill(0);
  const sway = Math.sin(t * 2 + seed) * 0.03;
  set3(o, B.rightUpperArm, -0.5, 0.2, 0.95 + sway);
  set3(o, B.leftUpperArm, -0.5, -0.2, -0.95 - sway);
  set3(o, B.rightLowerArm, 0, 0.9, 0);
  set3(o, B.leftLowerArm, 0, -0.9, 0);
}

function pose(o: Float32Array, p: RiderPose, t: number, u: number, seed: number, speed: number) {
  grip(o, t, seed);
  const run = Math.sin(t * 13);
  switch (p) {
    case "idle":
      set3(o, B.spine, 0.04, 0, 0);
      break;
    case "run":
      set3(o, B.spine, 0.18 * speed, run * 0.05, 0);
      set3(o, B.rightUpperLeg, -0.55 * run * speed, 0, 0.04);
      set3(o, B.leftUpperLeg, 0.55 * run * speed, 0, -0.04);
      set3(o, B.rightLowerLeg, 0.5 + 0.35 * Math.max(0, run) * speed, 0, 0);
      set3(o, B.leftLowerLeg, 0.5 + 0.35 * Math.max(0, -run) * speed, 0, 0);
      o[HOP] = Math.abs(run) * 0.05 * speed;
      break;
    case "dash":
      // 슈퍼맨처럼 앞으로 — 팔은 뒤로 젖히고 고개를 든다
      set3(o, B.spine, 0.5, 0, 0);
      set3(o, B.chest, 0.15, 0, 0);
      set3(o, B.head, -0.45, 0, 0);
      set3(o, B.rightUpperArm, 0.5, -0.4, 1.1);
      set3(o, B.leftUpperArm, 0.5, 0.4, -1.1);
      set3(o, B.rightLowerArm, 0, 0.2, 0);
      set3(o, B.leftLowerArm, 0, -0.2, 0);
      set3(o, B.rightUpperLeg, 0.45, 0, 0.05);
      set3(o, B.leftUpperLeg, -0.6, 0, -0.05);
      set3(o, B.leftLowerLeg, 0.8, 0, 0);
      break;
    case "brace":
      // 다리를 벌리고 낮게 — 튜브를 꽉
      set3(o, B.spine, 0.22, 0, 0);
      set3(o, B.head, -0.15, 0, 0);
      set3(o, B.rightUpperLeg, -0.55, 0, 0.42);
      set3(o, B.leftUpperLeg, -0.55, 0, -0.42);
      set3(o, B.rightLowerLeg, 1.0, 0, 0);
      set3(o, B.leftLowerLeg, 1.0, 0, 0);
      set3(o, B.rightUpperArm, -0.7, 0.3, 0.85 + Math.sin(t * 30) * 0.02);
      set3(o, B.leftUpperArm, -0.7, -0.3, -0.85 - Math.sin(t * 30) * 0.02);
      o[CROUCH] = 0.16;
      break;
    case "air":
      // 무릎을 당겨 웅크림, 팔은 위로
      set3(o, B.spine, 0.2, 0, 0);
      set3(o, B.rightUpperLeg, -1.1, 0, 0.12);
      set3(o, B.leftUpperLeg, -1.1, 0, -0.12);
      set3(o, B.rightLowerLeg, 1.6, 0, 0);
      set3(o, B.leftLowerLeg, 1.6, 0, 0);
      set3(o, B.rightUpperArm, 0, 0, -0.9);
      set3(o, B.leftUpperArm, 0, 0, 0.9);
      set3(o, B.rightLowerArm, 0, 0.3, 0);
      set3(o, B.leftLowerArm, 0, -0.3, 0);
      break;
    case "hit": {
      // 뒤로 젖혀지며 팔이 들림
      const k = Math.max(0, 1 - u / 0.45);
      set3(o, B.spine, -0.35 * k, 0, Math.sin(t * 20) * 0.1 * k);
      set3(o, B.head, -0.4 * k, 0, 0);
      set3(o, B.rightUpperArm, 0, 0, -0.4 * k + 0.9 * (1 - k));
      set3(o, B.leftUpperArm, 0, 0, 0.4 * k - 0.9 * (1 - k));
      break;
    }
    case "fall": {
      // 허우적
      const f = Math.sin(t * 16);
      set3(o, B.spine, -0.2, 0, f * 0.15);
      set3(o, B.head, -0.5, 0, 0);
      set3(o, B.rightUpperArm, f * 0.6, 0, -1.1 + f * 0.5);
      set3(o, B.leftUpperArm, -f * 0.6, 0, 1.1 + f * 0.5);
      set3(o, B.rightUpperLeg, -0.6 + f * 0.5, 0, 0.2);
      set3(o, B.leftUpperLeg, -0.6 - f * 0.5, 0, -0.2);
      set3(o, B.rightLowerLeg, 0.9, 0, 0);
      set3(o, B.leftLowerLeg, 0.9, 0, 0);
      break;
    }
    case "cheer": {
      const pump = Math.sin(t * 9) * 0.25;
      set3(o, B.rightUpperArm, 0, 0, -1.25 + pump);
      set3(o, B.leftUpperArm, 0, 0, 1.25 - pump);
      set3(o, B.rightLowerArm, 0, 0.4, 0);
      set3(o, B.leftLowerArm, 0, -0.4, 0);
      set3(o, B.head, -0.25, 0, 0);
      o[HOP] = Math.abs(Math.sin(t * 8)) * 0.12;
      break;
    }
    case "sad":
      set3(o, B.spine, 0.3, 0, 0);
      set3(o, B.head, 0.45, Math.sin(t * 3) * 0.12, 0);
      break;
  }
}

const fQ = new THREE.Quaternion();
const fE = new THREE.Euler();
const heatCold = new THREE.Color("#ffffff");
const heatWarm = new THREE.Color("#ff9b2f");
const heatHot = new THREE.Color("#ff2a2a");

export interface RiderProps {
  look: PersonLook;
  seed: number;
  color: string;
  lowDetail: boolean;
  read: () => RiderFrame | null;
}

export default function Rider({ look, seed, color, lowDetail, read }: RiderProps) {
  const { vrm, morphs } = useVrmAvatar(look, seed, { lowDetail });
  const rootRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const tubeMat = useRef<THREE.MeshStandardMaterial>(null);
  const stripeMat = useRef<THREE.MeshStandardMaterial>(null);
  const shieldRef = useRef<THREE.Mesh>(null);
  const trailRef = useRef<THREE.Mesh>(null);
  const shadowRef = useRef<THREE.Mesh>(null);
  const st = useRef<{ pose: RiderPose; start: number; springs: { current: number }; cur: Float32Array; want: Float32Array; scale: number } | null>(null);
  const fit = useMemo(() => {
    if (!vrm) return null;
    const head = vrm.humanoid.getNormalizedBoneNode("head");
    const y = head ? head.getWorldPosition(new THREE.Vector3()).y : 1.4;
    return HEAD_HEIGHT / Math.max(0.5, y);
  }, [vrm]);
  const tmpColor = useMemo(() => new THREE.Color(), []);
  const seatColor = useMemo(() => new THREE.Color(color), [color]);

  useFrame(({ clock }, dtRaw) => {
    const root = rootRef.current;
    const body = bodyRef.current;
    if (!root || !body) return;
    const f = read();
    if (!f || !f.visible) {
      root.visible = false;
      return;
    }
    root.visible = true;
    const dt = Math.min(dtRaw, 0.05);
    const t = clock.elapsedTime;
    st.current ??= { pose: "idle", start: 0, springs: { current: 0 }, cur: new Float32Array(CHANNELS), want: new Float32Array(CHANNELS), scale: 1 };
    const s = st.current;
    if (s.pose !== f.pose) {
      s.pose = f.pose;
      s.start = t;
    }
    root.position.set(f.x, f.y, f.z);
    root.rotation.y = Math.PI / 2 - f.face;
    s.scale += (f.scale - s.scale) * (1 - Math.exp(-dt * 8));
    root.scale.setScalar(s.scale);
    pose(s.want, f.pose, t, t - s.start, seed, f.speed);
    const k = 1 - Math.exp(-dt * (f.pose === "dash" || f.pose === "hit" ? 22 : 11));
    for (let i = 0; i < CHANNELS; i++) s.cur[i] += (s.want[i] - s.cur[i]) * k;
    body.position.y = s.cur[HOP] - s.cur[CROUCH];
    // 튜브: 열기에 따라 달아오름 (숫자 % 도 이름표에 같이 나온다 — 색만으로 알리지 않음)
    const h = Math.min(1, f.heat / 150);
    if (h < 0.5) tmpColor.copy(heatCold).lerp(heatWarm, h * 2);
    else tmpColor.copy(heatWarm).lerp(heatHot, (h - 0.5) * 2);
    if (tubeMat.current) {
      tubeMat.current.emissive.copy(tmpColor);
      tubeMat.current.emissiveIntensity = h * (0.55 + Math.sin(t * (6 + h * 10)) * 0.15 * h);
    }
    if (stripeMat.current) stripeMat.current.color.copy(seatColor);
    if (shieldRef.current) {
      shieldRef.current.visible = f.shield;
      shieldRef.current.rotation.y = t * 0.8;
    }
    if (trailRef.current) trailRef.current.visible = f.turbo || f.pose === "dash";
    // 그림자는 땅에 남는다 (점프하면 작아짐, 추락하면 사라짐)
    if (shadowRef.current) {
      shadowRef.current.visible = f.y > -0.2;
      shadowRef.current.position.y = (0.01 - Math.max(0, f.y)) / s.scale;
      shadowRef.current.scale.setScalar(Math.max(0.4, 1 - Math.max(0, f.y) * 0.4));
    }

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
      const p = f.pose;
      em.setValue("happy", p === "cheer" ? 1 : 0);
      em.setValue("angry", p === "dash" || p === "brace" ? 0.7 : 0);
      em.setValue("surprised", p === "hit" || p === "fall" || p === "air" ? 0.9 : 0);
      em.setValue("sad", p === "sad" ? 0.9 : 0);
      em.setValue("aa", p === "fall" ? 0.8 : p === "cheer" ? 0.4 : 0);
      em.setValue("blink", p === "cheer" || p === "fall" ? 0 : blinkAmount(t, seed));
    }
    tickVrm(vrm, dt, morphs.current, s.springs, lowDetail, { t, seed });
  });

  return (
    <group ref={rootRef}>
      <group ref={bodyRef}>{vrm && fit && <primitive object={vrm.scene} scale={fit} />}</group>
      {/* 범퍼 튜브 (허리) — 몸 반지름 0.62에 맞춘 크기 */}
      <group position-y={TUBE_Y}>
        <mesh rotation-x={Math.PI / 2} castShadow={!lowDetail}>
          <torusGeometry args={[0.44, 0.2, lowDetail ? 10 : 16, lowDetail ? 24 : 40]} />
          <meshStandardMaterial ref={tubeMat} color="#f4f6fb" roughness={0.35} metalness={0.05} emissive="#000000" />
        </mesh>
        <mesh rotation-x={Math.PI / 2} scale={[1.002, 1.002, 0.5]}>
          <torusGeometry args={[0.44, 0.205, 8, lowDetail ? 24 : 40]} />
          <meshStandardMaterial ref={stripeMat} color={color} roughness={0.45} />
        </mesh>
        {/* 앞쪽 표시 (방향을 알기 쉽게) */}
        <mesh position={[0, 0.02, 0.62]} rotation-x={Math.PI / 2}>
          <coneGeometry args={[0.09, 0.16, 3]} />
          <meshBasicMaterial color={color} />
        </mesh>
      </group>
      {/* 방패 거품 */}
      <mesh ref={shieldRef} position-y={0.85} visible={false}>
        <sphereGeometry args={[0.95, lowDetail ? 14 : 24, lowDetail ? 10 : 16]} />
        <meshStandardMaterial color="#7dd3fc" transparent opacity={0.22} emissive="#38bdf8" emissiveIntensity={0.5} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {/* 대시·터보 꼬리 */}
      <mesh ref={trailRef} position={[0, TUBE_Y, -0.95]} rotation-x={Math.PI / 2} visible={false}>
        <coneGeometry args={[0.42, 1.3, 12, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={0.28} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {/* 그림자 */}
      <mesh ref={shadowRef} rotation-x={-Math.PI / 2} position-y={0.01}>
        <circleGeometry args={[0.62, 20]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.28} depthWrite={false} />
      </mesh>
    </group>
  );
}
