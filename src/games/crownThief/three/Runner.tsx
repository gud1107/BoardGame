"use client";

import { useRef } from "react";
import * as THREE from "three";
import type { PersonLook } from "@/games/shared/three/SeatedPerson";
import VrmBody, { addCrouch, addWalk, setBone, BODY, BODY_DROP } from "@/games/shared/three/VrmBody";
import CrownModel from "./CrownModel";

/**
 * 광장 위 캐릭터 (룰북 §11). 프로필 캐릭터(VRM)가 뛰고, 💨 돌진(몸을 숙여 쭉), 휘청, 🌀 점프대 비행,
 * 구름 아래로 떨어짐, 📣 호령(두 팔 번쩍), 환호·풀죽음을 뼈 회전으로 만든다.
 * 왕관(진짜·🎭 가짜)은 머리 뼈에 붙여 늘 머리 위에 있다. 💀 저주 모드에선 보랏빛 저주 왕관.
 *
 * 매 프레임 `read()`로 위치·상태를 받아 React 다시 그리기 없이 움직인다.
 * VRM은 +Z가 앞 — 시뮬 방향각 a(x=cos a, z=sin a)는 rotation.y = π/2 − a.
 */

export type RunnerMode = "idle" | "run" | "dash" | "stagger" | "pad" | "fall" | "roar" | "cheer" | "sad";

export interface RunnerFrame {
  x: number;
  y: number;
  z: number;
  face: number;
  mode: RunnerMode;
  /** 달리는 빠르기 0~1 */
  speed: number;
  visible: boolean;
  /** 머리 위 왕관 (진짜·가짜 똑같이 보임) */
  crown: boolean;
  /** 🛡 새 왕 무적 (발밑 금빛 고리가 깜빡임) */
  shield: boolean;
  /** 다시 나타난 직후 반투명 구간 (발밑 고리 점멸) */
  ghost: boolean;
  /** 팀전: 팀 색 (없으면 null) */
  team: string | null;
}

/** 머리 뼈 높이 (m) */
export const HEAD_Y = 1.3;

const footGeo = new THREE.RingGeometry(0.36, 0.48, 32);
const shadowGeo = new THREE.CircleGeometry(0.44, 24);
const shieldGeo = new THREE.RingGeometry(0.62, 0.74, 40);
const teamGeo = new THREE.RingGeometry(0.5, 0.56, 6);

export default function Runner({ look, seed, color, lowDetail, curse, read }: { look: PersonLook; seed: number; color: string; lowDetail: boolean; curse: boolean; read: () => RunnerFrame }) {
  const root = useRef<THREE.Group>(null);
  const foot = useRef<THREE.Group>(null);
  const shield = useRef<THREE.Mesh>(null);
  const teamRing = useRef<THREE.Mesh>(null);
  const teamMat = useRef<THREE.MeshBasicMaterial>(null);
  const footMat = useRef<THREE.MeshBasicMaterial>(null);
  const crown = useRef<THREE.Group>(null);
  const anim = useRef({ phase: 0, modeAt: 0, mode: "idle" as RunnerMode });

  const pose = (o: Float32Array, t: number, dt: number) => {
    const f = read();
    const a = anim.current;
    if (f.mode !== a.mode) {
      a.mode = f.mode;
      a.modeAt = t;
    }
    const r = root.current;
    const g = foot.current;
    if (r) {
      r.visible = f.visible;
      r.position.set(f.x, f.y, f.z);
      r.rotation.y = Math.PI / 2 - f.face;
    }
    if (g) {
      g.visible = f.visible && f.mode !== "fall" && f.y < 0.4;
      g.position.set(f.x, 0.012, f.z);
    }
    if (shield.current) {
      shield.current.visible = f.shield;
      shield.current.rotation.z = t * 3;
      (shield.current.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.4 * Math.abs(Math.sin(t * 10));
    }
    if (teamRing.current && teamMat.current) {
      teamRing.current.visible = !!f.team;
      if (f.team) teamMat.current.color.set(f.team);
    }
    if (footMat.current) footMat.current.opacity = f.ghost ? 0.3 + 0.6 * Math.abs(Math.sin(t * 14)) : 0.9;
    if (crown.current) {
      crown.current.visible = f.crown;
      crown.current.rotation.y = Math.sin(t * 2) * 0.08;
    }
    setBone(o, "rightUpperArm", 0, 0, -0.18);
    setBone(o, "leftUpperArm", 0, 0, 0.18);
    switch (f.mode) {
      case "run": {
        a.phase += dt * (7 + f.speed * 7);
        addWalk(o, a.phase, 0.4 + f.speed * 0.6);
        o[BODY.spine] += 0.16 * f.speed;
        if (f.crown) {
          // 왕은 한 손으로 왕관을 붙잡고 뛴다
          setBone(o, "leftUpperArm", -2.5, 0, 0.35);
          setBone(o, "leftLowerArm", -1.2);
        }
        break;
      }
      case "dash":
        o[BODY.spine] += 0.55;
        setBone(o, "rightUpperArm", 0.6, 0, -0.5);
        setBone(o, "leftUpperArm", 0.6, 0, 0.5);
        setBone(o, "rightUpperLeg", -0.9);
        setBone(o, "leftUpperLeg", 0.5);
        setBone(o, "rightLowerLeg", 0.8);
        break;
      case "pad":
        setBone(o, "rightUpperArm", -2.8, 0, -0.5);
        setBone(o, "leftUpperArm", -2.8, 0, 0.5);
        setBone(o, "rightUpperLeg", -1.0);
        setBone(o, "leftUpperLeg", -0.4);
        setBone(o, "rightLowerLeg", 1.4);
        setBone(o, "leftLowerLeg", 0.8);
        break;
      case "stagger": {
        const w = Math.sin(t * 22);
        setBone(o, "rightUpperArm", -1.3 + w * 0.6, 0, -1.2);
        setBone(o, "leftUpperArm", -1.3 - w * 0.6, 0, 1.2);
        o[BODY.spine] -= 0.25;
        o[BODY.spine + 2] += w * 0.25;
        setBone(o, "rightUpperLeg", -0.5);
        setBone(o, "rightLowerLeg", 0.7);
        break;
      }
      case "fall": {
        const w = Math.sin(t * 18);
        setBone(o, "rightUpperArm", -2.8 + w * 0.3, 0, -0.6);
        setBone(o, "leftUpperArm", -2.8 - w * 0.3, 0, 0.6);
        setBone(o, "rightUpperLeg", -0.6 - w * 0.4);
        setBone(o, "leftUpperLeg", -0.6 + w * 0.4);
        o[BODY.head] -= 0.35;
        break;
      }
      case "roar": {
        const k = Math.min(1, (t - a.modeAt) * 6);
        setBone(o, "rightUpperArm", -2.9 * k, 0, -0.7);
        setBone(o, "leftUpperArm", -2.9 * k, 0, 0.7);
        o[BODY.spine] -= 0.25 * k;
        o[BODY.head] -= 0.3 * k;
        break;
      }
      case "cheer": {
        const w = Math.sin(t * 9);
        setBone(o, "rightUpperArm", -2.6 + w * 0.25, 0, -0.5);
        setBone(o, "leftUpperArm", -2.6 - w * 0.25, 0, 0.5);
        setBone(o, "rightLowerArm", -0.5);
        setBone(o, "leftLowerArm", -0.5);
        o[BODY_DROP] -= Math.max(0, Math.sin(t * 9)) * 0.06;
        break;
      }
      case "sad":
        o[BODY.head] += 0.45;
        o[BODY.spine] += 0.2;
        addCrouch(o, 0.12);
        break;
      default:
        o[BODY.spine] += Math.sin(t * 2 + seed) * 0.03;
        break;
    }
  };

  const face = () => {
    const m = anim.current.mode;
    if (m === "fall" || m === "stagger") return { surprised: 1 };
    if (m === "cheer") return { happy: 1 };
    if (m === "sad") return { sad: 0.8 };
    if (m === "roar" || m === "dash") return { angry: 0.7 };
    return { happy: 0.3 };
  };

  return (
    <>
      <group ref={foot} visible={false}>
        <mesh geometry={shadowGeo} rotation-x={-Math.PI / 2}>
          <meshBasicMaterial color="#1c1917" transparent opacity={0.28} depthWrite={false} />
        </mesh>
        <mesh geometry={footGeo} rotation-x={-Math.PI / 2} position-y={0.004}>
          <meshBasicMaterial ref={footMat} color={color} transparent opacity={0.9} depthWrite={false} />
        </mesh>
        <mesh ref={teamRing} geometry={teamGeo} rotation-x={-Math.PI / 2} position-y={0.006} visible={false}>
          <meshBasicMaterial ref={teamMat} transparent opacity={0.95} depthWrite={false} />
        </mesh>
        <mesh ref={shield} geometry={shieldGeo} rotation-x={-Math.PI / 2} position-y={0.008} visible={false}>
          <meshBasicMaterial color={curse ? "#c084fc" : "#fde047"} transparent opacity={0.9} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
      <group ref={root} visible={false}>
        <VrmBody
          look={look}
          seed={seed}
          headY={HEAD_Y}
          pose={pose}
          face={face}
          lowDetail={lowDetail}
          follow={18}
          head={
            <group ref={crown} position={[0, 0.06, -0.01]} visible={false} scale={0.62}>
              <CrownModel curse={curse} />
            </group>
          }
          fallback={
            <mesh position={[0, 0.6, 0]} scale={[0.35, 0.65, 0.3]}>
              <sphereGeometry args={[1, 14, 10]} />
              <meshBasicMaterial color={color} transparent opacity={0.45} />
            </mesh>
          }
        />
      </group>
    </>
  );
}
