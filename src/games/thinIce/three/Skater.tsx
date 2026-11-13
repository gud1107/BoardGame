"use client";

import { useRef } from "react";
import * as THREE from "three";
import type { PersonLook } from "@/games/shared/three/SeatedPerson";
import VrmBody, { addCrouch, addWalk, setBone, BODY, BODY_DROP } from "@/games/shared/three/VrmBody";

/**
 * 얼음 위 캐릭터 (룰북 §11). 프로필 캐릭터(VRM)가 미끄러운 얼음 위를 종종걸음치고,
 * 점프·내려찍기(두 팔 번쩍 → 웅크려 쿵)·휘청·첨벙·환호를 뼈 회전으로 만든다.
 * 금이 많이 간 칸에 서 있으면 두 팔을 벌리고 무릎을 덜덜 떤다(소리 없이도 위험이 보이게).
 *
 * 매 프레임 `read()`로 위치·상태를 받아 React 다시 그리기 없이 움직인다.
 * VRM은 +Z가 앞 — 시뮬 방향각 a(x=cos a, z=sin a)는 rotation.y = π/2 − a.
 */

export type SkaterMode = "idle" | "run" | "jump" | "rise" | "slam" | "stagger" | "fall" | "cheer" | "sad";

export interface SkaterFrame {
  x: number;
  y: number;
  z: number;
  face: number;
  mode: SkaterMode;
  /** 달리는 빠르기 0~1 */
  speed: number;
  visible: boolean;
  /** 🥾 아이젠 */
  spikes: boolean;
  /** 발밑 얼음이 위험 (0~1) — 덜덜 떨기 */
  wobble: number;
}

/** 머리 뼈 높이 (m) — 얼음 칸(반지름 1.15m)에 비해 아담한 키 */
export const HEAD_Y = 1.28;

const footGeo = new THREE.RingGeometry(0.34, 0.46, 32);
const shadowGeo = new THREE.CircleGeometry(0.42, 24);

export default function Skater({ look, seed, color, lowDetail, read }: { look: PersonLook; seed: number; color: string; lowDetail: boolean; read: () => SkaterFrame }) {
  const root = useRef<THREE.Group>(null);
  const foot = useRef<THREE.Group>(null);
  const spikeRing = useRef<THREE.Mesh>(null);
  const anim = useRef({ phase: 0, modeAt: 0, mode: "idle" as SkaterMode });

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
      g.visible = f.visible && f.mode !== "fall";
      g.position.set(f.x, 0.012, f.z);
    }
    if (spikeRing.current) spikeRing.current.visible = f.spikes;
    // 얼음 위 기본: 두 팔을 살짝 벌려 균형 잡기
    setBone(o, "rightUpperArm", 0, 0, -0.35);
    setBone(o, "leftUpperArm", 0, 0, 0.35);
    switch (f.mode) {
      case "run": {
        a.phase += dt * (6 + f.speed * 7);
        addWalk(o, a.phase, 0.35 + f.speed * 0.65);
        o[BODY.spine] += 0.12 * f.speed;
        break;
      }
      case "jump":
        setBone(o, "rightUpperArm", -1.6, 0, -0.5);
        setBone(o, "leftUpperArm", -1.6, 0, 0.5);
        setBone(o, "rightUpperLeg", -0.7);
        setBone(o, "leftUpperLeg", -0.3);
        setBone(o, "rightLowerLeg", 1.1);
        setBone(o, "leftLowerLeg", 0.6);
        break;
      case "rise":
        // 내려찍기 준비: 두 팔 번쩍, 다리 접기
        setBone(o, "rightUpperArm", -2.8, 0, -0.3);
        setBone(o, "leftUpperArm", -2.8, 0, 0.3);
        setBone(o, "rightUpperLeg", -1.0);
        setBone(o, "leftUpperLeg", -1.0);
        setBone(o, "rightLowerLeg", 1.5);
        setBone(o, "leftLowerLeg", 1.5);
        o[BODY.spine] -= 0.15;
        break;
      case "slam":
        addCrouch(o, 0.75);
        setBone(o, "rightUpperArm", -0.4, 0, -1.1);
        setBone(o, "leftUpperArm", -0.4, 0, 1.1);
        break;
      case "stagger": {
        const w = Math.sin(t * 24);
        setBone(o, "rightUpperArm", -1.2 + w * 0.6, 0, -1.2);
        setBone(o, "leftUpperArm", -1.2 - w * 0.6, 0, 1.2);
        o[BODY.spine] -= 0.25;
        o[BODY.spine + 2] += w * 0.2;
        setBone(o, "rightUpperLeg", -0.5);
        setBone(o, "rightLowerLeg", 0.7);
        break;
      }
      case "fall": {
        const w = Math.sin(t * 18);
        setBone(o, "rightUpperArm", -2.7 + w * 0.3, 0, -0.4);
        setBone(o, "leftUpperArm", -2.7 - w * 0.3, 0, 0.4);
        setBone(o, "rightUpperLeg", -0.6 - w * 0.3);
        setBone(o, "leftUpperLeg", -0.6 + w * 0.3);
        o[BODY.head] -= 0.3;
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
        setBone(o, "rightUpperArm", 0, 0, -0.1);
        setBone(o, "leftUpperArm", 0, 0, 0.1);
        break;
      default: {
        // 가만히: 숨쉬듯 살짝
        o[BODY.spine] += Math.sin(t * 2 + seed) * 0.03;
        break;
      }
    }
    if (f.wobble > 0 && (f.mode === "idle" || f.mode === "run")) {
      // 금 간 얼음 위: 팔 크게 벌리고 무릎 덜덜
      const k = f.wobble;
      const jit = Math.sin(t * 38 + seed) * 0.12 * k;
      setBone(o, "rightUpperArm", -0.3, 0, -1.25 * k - 0.35 + jit);
      setBone(o, "leftUpperArm", -0.3, 0, 1.25 * k + 0.35 - jit);
      o[BODY.rightLowerLeg] += 0.35 * k + jit;
      o[BODY.leftLowerLeg] += 0.35 * k - jit;
      o[BODY.spine + 2] += jit * 0.6;
    }
  };

  const face = () => {
    const m = anim.current.mode;
    if (m === "fall" || m === "stagger") return { surprised: 1 };
    if (m === "cheer") return { happy: 1 };
    if (m === "sad") return { sad: 0.8 };
    if (m === "rise" || m === "slam") return { angry: 0.7 };
    return { happy: 0.25 };
  };

  return (
    <>
      <group ref={foot} visible={false}>
        <mesh geometry={shadowGeo} rotation-x={-Math.PI / 2}>
          <meshBasicMaterial color="#0b1b2b" transparent opacity={0.28} depthWrite={false} />
        </mesh>
        <mesh geometry={footGeo} rotation-x={-Math.PI / 2} position-y={0.004}>
          <meshBasicMaterial color={color} transparent opacity={0.9} depthWrite={false} />
        </mesh>
        <mesh ref={spikeRing} rotation-x={-Math.PI / 2} position-y={0.008} visible={false}>
          <ringGeometry args={[0.5, 0.58, 6]} />
          <meshBasicMaterial color="#a3e635" transparent opacity={0.95} depthWrite={false} />
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
          follow={16}
          head={
            <group position={[0, -0.02, -0.01]}>
              {/* 자리 색 털모자 — 멀리서도 누가 누군지 */}
              <mesh scale={[1, 0.8, 1]}>
                <sphereGeometry args={[0.11, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
                <meshStandardMaterial color={color} roughness={0.9} />
              </mesh>
              <mesh position={[0, 0.1, 0]}>
                <sphereGeometry args={[0.04, 10, 8]} />
                <meshStandardMaterial color="#ffffff" roughness={1} />
              </mesh>
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

