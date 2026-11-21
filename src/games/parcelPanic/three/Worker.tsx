"use client";

import { useRef } from "react";
import * as THREE from "three";
import type { PersonLook } from "@/games/shared/three/SeatedPerson";
import VrmBody, { addCrouch, addWalk, setBone, BODY, BODY_DROP } from "@/games/shared/three/VrmBody";

/**
 * 창고 직원 캐릭터 (룰북 §11). 프로필 캐릭터(VRM)가 노란 안전모를 쓰고 뛴다.
 * 빈손 달리기 · 📦 들고 걷기(두 팔 앞으로) · 🛋️ 가구 들기(무릎 굽히고 버팀) · 🎯 던지기(팔 휙) · 💨 돌진 ·
 * 휘청(들이받힘·지게차) · 환호·풀죽음을 뼈 회전으로 만든다.
 * 매 프레임 `read()`로 위치·상태를 받아 React 다시 그리기 없이 움직인다.
 * VRM은 +Z가 앞 — 시뮬 방향각 a(x=cos a, z=sin a)는 rotation.y = π/2 − a.
 */

export type WorkerMode = "idle" | "run" | "carry" | "heavy" | "throw" | "dash" | "stagger" | "cheer" | "sad";

export interface WorkerFrame {
  x: number;
  z: number;
  face: number;
  mode: WorkerMode;
  speed: number;
  visible: boolean;
}

export const HEAD_Y = 1.3;

const footGeo = new THREE.RingGeometry(0.34, 0.46, 32);
const shadowGeo = new THREE.CircleGeometry(0.42, 24);
const hatGeo = new THREE.SphereGeometry(0.16, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
const brimGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.02, 20);

export default function Worker({ look, seed, color, lowDetail, read }: { look: PersonLook; seed: number; color: string; lowDetail: boolean; read: () => WorkerFrame }) {
  const root = useRef<THREE.Group>(null);
  const foot = useRef<THREE.Group>(null);
  const anim = useRef({ phase: 0, modeAt: 0, mode: "idle" as WorkerMode });

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
      r.position.set(f.x, 0, f.z);
      r.rotation.y = Math.PI / 2 - f.face;
    }
    if (g) {
      g.visible = f.visible;
      g.position.set(f.x, 0.012, f.z);
    }
    setBone(o, "rightUpperArm", 0, 0, -0.18);
    setBone(o, "leftUpperArm", 0, 0, 0.18);
    switch (f.mode) {
      case "run": {
        a.phase += dt * (7 + f.speed * 7);
        addWalk(o, a.phase, 0.4 + f.speed * 0.6);
        o[BODY.spine] += 0.14 * f.speed;
        break;
      }
      case "carry": {
        // 두 팔을 앞으로 뻗어 상자를 받친다 (걷는 다리는 그대로)
        if (f.speed > 0.08) {
          a.phase += dt * (6 + f.speed * 6);
          addWalk(o, a.phase, 0.3 + f.speed * 0.5);
        }
        setBone(o, "rightUpperArm", -1.25, 0, -0.32);
        setBone(o, "leftUpperArm", -1.25, 0, 0.32);
        setBone(o, "rightLowerArm", -0.35);
        setBone(o, "leftLowerArm", -0.35);
        o[BODY.spine] -= 0.06;
        break;
      }
      case "heavy": {
        a.phase += dt * (3 + f.speed * 5);
        if (f.speed > 0.05) addWalk(o, a.phase, 0.25 + f.speed * 0.3);
        addCrouch(o, 0.18);
        setBone(o, "rightUpperArm", -1.0, 0, -0.55);
        setBone(o, "leftUpperArm", -1.0, 0, 0.55);
        setBone(o, "rightLowerArm", -0.6);
        setBone(o, "leftLowerArm", -0.6);
        o[BODY.spine] += 0.35;
        break;
      }
      case "throw": {
        const k = Math.min(1, (t - a.modeAt) * 6);
        setBone(o, "rightUpperArm", -2.2 + k * 1.6, 0, -0.3);
        setBone(o, "leftUpperArm", -2.2 + k * 1.6, 0, 0.3);
        o[BODY.spine] += -0.25 + k * 0.45;
        break;
      }
      case "dash":
        o[BODY.spine] += 0.55;
        setBone(o, "rightUpperArm", 0.9, 0, -0.3);
        setBone(o, "leftUpperArm", 0.9, 0, 0.3);
        setBone(o, "rightUpperLeg", -0.9);
        setBone(o, "leftUpperLeg", 0.5);
        setBone(o, "rightLowerLeg", 0.8);
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
    if (m === "stagger") return { surprised: 1 };
    if (m === "cheer") return { happy: 1 };
    if (m === "sad") return { sad: 0.8 };
    if (m === "heavy") return { angry: 0.5 };
    if (m === "dash" || m === "throw") return { angry: 0.4 };
    return { happy: 0.3 };
  };

  return (
    <>
      <group ref={foot} visible={false}>
        <mesh geometry={shadowGeo} rotation-x={-Math.PI / 2}>
          <meshBasicMaterial color="#05070c" transparent opacity={0.32} depthWrite={false} />
        </mesh>
        <mesh geometry={footGeo} rotation-x={-Math.PI / 2} position-y={0.004}>
          <meshBasicMaterial color={color} transparent opacity={0.9} depthWrite={false} />
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
            <group position={[0, -0.05, 0]} scale={[1.08, 1, 1.1]}>
              <mesh geometry={hatGeo}>
                <meshStandardMaterial color="#facc15" roughness={0.45} />
              </mesh>
              <mesh geometry={brimGeo} position={[0, 0, 0.03]}>
                <meshStandardMaterial color="#eab308" roughness={0.5} />
              </mesh>
              <mesh position={[0, 0.08, 0.12]} scale={[0.06, 0.04, 0.02]}>
                <boxGeometry />
                <meshBasicMaterial color={color} />
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
