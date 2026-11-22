"use client";

import { useRef } from "react";
import * as THREE from "three";
import type { PersonLook } from "@/games/shared/three/SeatedPerson";
import VrmBody, { addCrouch, addWalk, setBone, BODY, BODY_DROP } from "@/games/shared/three/VrmBody";

/**
 * 탑을 오르는 캐릭터 (룰북 §11). 프로필 캐릭터(VRM)가 발판 위를 달리고, 점프(두 팔 번쩍)·떨어짐(허우적)·
 * 휘청·밀치기(한 팔 쭉)·트램펄린(만세)·환호·실망을 뼈 회전으로 만든다. 등에 자리 색 깃발을 달아 멀리서도
 * 누가 누군지 보인다(모양 기호는 이름표에). 붕괴선이 발밑 가까이 오면 무릎이 덜덜 떨린다.
 *
 * 매 프레임 `read()`로 위치·상태를 받아 React 다시 그리기 없이 움직인다.
 * VRM은 +Z가 앞 — 시뮬 방향각 a(x=cos a, z=sin a)는 rotation.y = π/2 − a.
 */

export type ClimberMode = "idle" | "run" | "jump" | "fall" | "bounce" | "stagger" | "shove" | "cheer" | "sad";

export interface ClimberFrame {
  x: number;
  y: number;
  z: number;
  face: number;
  mode: ClimberMode;
  speed: number;
  visible: boolean;
  /** 🛡 방패 */
  shield: boolean;
  /** ⚡ 번개 신발 */
  boots: boolean;
  /** 🪶 깃털 들고 있음 */
  feather: boolean;
  /** 위험(붕괴선 가까움) 0~1 — 덜덜 */
  fear: number;
}

export const HEAD_Y = 1.3;

const shadowGeo = new THREE.CircleGeometry(0.4, 20);
const ringGeo = new THREE.RingGeometry(0.36, 0.46, 28);

export default function Climber({ look, seed, color, lowDetail, read }: { look: PersonLook; seed: number; color: string; lowDetail: boolean; read: () => ClimberFrame }) {
  const root = useRef<THREE.Group>(null);
  const shield = useRef<THREE.Mesh>(null);
  const boots = useRef<THREE.Group>(null);
  const feather = useRef<THREE.Mesh>(null);
  const anim = useRef({ phase: 0, modeAt: 0, mode: "idle" as ClimberMode });

  const pose = (o: Float32Array, t: number, dt: number) => {
    const f = read();
    const a = anim.current;
    if (f.mode !== a.mode) {
      a.mode = f.mode;
      a.modeAt = t;
    }
    const r = root.current;
    if (r) {
      r.visible = f.visible;
      r.position.set(f.x, f.y, f.z);
      r.rotation.y = Math.PI / 2 - f.face;
    }
    if (shield.current) {
      shield.current.visible = f.shield;
      shield.current.rotation.y = t * 1.5;
    }
    if (boots.current) boots.current.visible = f.boots;
    if (feather.current) feather.current.visible = f.feather;
    setBone(o, "rightUpperArm", 0, 0, -1.2);
    setBone(o, "leftUpperArm", 0, 0, 1.2);
    switch (f.mode) {
      case "run": {
        a.phase += dt * (6 + f.speed * 8);
        addWalk(o, a.phase, 0.4 + f.speed * 0.6);
        o[BODY.spine] += 0.15 * f.speed;
        break;
      }
      case "jump":
        setBone(o, "rightUpperArm", -2.5, 0, -0.4);
        setBone(o, "leftUpperArm", -2.5, 0, 0.4);
        setBone(o, "rightUpperLeg", -1.1);
        setBone(o, "leftUpperLeg", -0.35);
        setBone(o, "rightLowerLeg", 1.5);
        setBone(o, "leftLowerLeg", 0.5);
        break;
      case "bounce": {
        const w = Math.sin(t * 10);
        setBone(o, "rightUpperArm", -2.9, 0, -0.6 + w * 0.15);
        setBone(o, "leftUpperArm", -2.9, 0, 0.6 - w * 0.15);
        setBone(o, "rightUpperLeg", -0.25);
        setBone(o, "leftUpperLeg", -0.25);
        o[BODY.spine] -= 0.15;
        break;
      }
      case "fall": {
        const w = Math.sin(t * 16);
        setBone(o, "rightUpperArm", -2.4 + w * 0.5, 0, -0.9);
        setBone(o, "leftUpperArm", -2.4 - w * 0.5, 0, 0.9);
        setBone(o, "rightUpperLeg", -0.7 - w * 0.4);
        setBone(o, "leftUpperLeg", -0.7 + w * 0.4);
        setBone(o, "rightLowerLeg", 0.8);
        setBone(o, "leftLowerLeg", 0.8);
        o[BODY.head] -= 0.3;
        break;
      }
      case "stagger": {
        const w = Math.sin(t * 24);
        setBone(o, "rightUpperArm", -1.2 + w * 0.6, 0, -1.2);
        setBone(o, "leftUpperArm", -1.2 - w * 0.6, 0, 1.2);
        o[BODY.spine] -= 0.3;
        o[BODY.spine + 2] += w * 0.25;
        break;
      }
      case "shove": {
        const u = Math.min(1, (t - a.modeAt) / 0.12);
        setBone(o, "rightUpperArm", -1.5 * u, 0, -0.2);
        setBone(o, "leftUpperArm", -1.5 * u, 0, 0.2);
        setBone(o, "rightLowerArm", -0.1);
        setBone(o, "leftLowerArm", 0.1);
        o[BODY.spine] += 0.3 * u;
        setBone(o, "rightUpperLeg", -0.6);
        setBone(o, "leftUpperLeg", 0.3);
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
        addCrouch(o, 0.2);
        break;
      default:
        o[BODY.spine] += Math.sin(t * 2 + seed) * 0.03;
        break;
    }
    if (f.fear > 0 && (f.mode === "idle" || f.mode === "run")) {
      const jit = Math.sin(t * 38 + seed) * 0.1 * f.fear;
      o[BODY.rightLowerLeg] += 0.3 * f.fear + jit;
      o[BODY.leftLowerLeg] += 0.3 * f.fear - jit;
      o[BODY.spine + 2] += jit * 0.5;
    }
  };

  const face = () => {
    const m = anim.current.mode;
    if (m === "fall" || m === "stagger") return { surprised: 1 };
    if (m === "cheer" || m === "bounce") return { happy: 1 };
    if (m === "sad") return { sad: 0.8 };
    if (m === "shove") return { angry: 0.8 };
    return { happy: 0.25 };
  };

  return (
    <group ref={root} visible={false}>
      <mesh geometry={shadowGeo} rotation-x={-Math.PI / 2} position-y={0.02}>
        <meshBasicMaterial color="#0b0f1a" transparent opacity={0.3} depthWrite={false} />
      </mesh>
      <mesh geometry={ringGeo} rotation-x={-Math.PI / 2} position-y={0.03}>
        <meshBasicMaterial color={color} transparent opacity={0.9} depthWrite={false} />
      </mesh>
      {/* 🛡 방패: 몸을 감싸는 육각 막 */}
      <mesh ref={shield} position-y={0.75} visible={false}>
        <icosahedronGeometry args={[0.75, 0]} />
        <meshBasicMaterial color="#93c5fd" transparent opacity={0.22} wireframe />
      </mesh>
      {/* ⚡ 번개 신발: 발목에 노란 불꽃 고리 */}
      <group ref={boots} visible={false}>
        {[-0.1, 0.1].map((x) => (
          <mesh key={x} position={[x, 0.08, 0]} rotation-x={-Math.PI / 2}>
            <torusGeometry args={[0.09, 0.025, 6, 12]} />
            <meshBasicMaterial color="#facc15" />
          </mesh>
        ))}
      </group>
      {/* 🪶 깃털: 머리 위에 떠 있음 */}
      <mesh ref={feather} position={[0.18, HEAD_Y + 0.35, 0]} rotation-z={0.5} visible={false}>
        <coneGeometry args={[0.05, 0.3, 6]} />
        <meshStandardMaterial color="#fde68a" emissive="#fde68a" emissiveIntensity={0.5} />
      </mesh>
      <VrmBody
        look={look}
        seed={seed}
        headY={HEAD_Y}
        pose={pose}
        face={face}
        lowDetail={lowDetail}
        follow={18}
        head={
          <group position={[0, -0.02, -0.01]}>
            {/* 자리 색 등반 헬멧 */}
            <mesh scale={[1, 0.75, 1.05]}>
              <sphereGeometry args={[0.115, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial color={color} roughness={0.5} metalness={0.1} />
            </mesh>
            <mesh position={[0, 0.02, 0.1]}>
              <boxGeometry args={[0.05, 0.03, 0.03]} />
              <meshBasicMaterial color="#fff7d6" />
            </mesh>
          </group>
        }
        fallback={
          <mesh position={[0, 0.6, 0]} scale={[0.35, 0.65, 0.3]}>
            <sphereGeometry args={[1, 14, 10]} />
            <meshBasicMaterial color={color} transparent opacity={0.55} />
          </mesh>
        }
      />
      {/* 등 깃발 (자리 색) */}
      <group position={[0, 1.05, -0.16]}>
        <mesh position={[0, 0.25, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 0.6, 5]} />
          <meshStandardMaterial color="#e5e7eb" />
        </mesh>
        <mesh position={[0.09, 0.45, 0]}>
          <planeGeometry args={[0.18, 0.12]} />
          <meshStandardMaterial color={color} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
}
