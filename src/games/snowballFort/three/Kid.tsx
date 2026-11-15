"use client";

import { useRef } from "react";
import * as THREE from "three";
import type { PersonLook } from "@/games/shared/three/SeatedPerson";
import VrmBody, { addCrouch, addWalk, setBone, BODY, BODY_DROP } from "@/games/shared/three/VrmBody";

/**
 * 눈밭 위 캐릭터 (룰북 §11). 프로필 캐릭터(VRM)가 팀 색 털모자·목도리를 하고 뛰고,
 * 팔을 뒤로 젖혀 힘을 모으고(오래 모을수록 더 크게), 던지고, 쪼그려 눈을 뭉치고, 벽을 쌓고,
 * 맞으면 움찔, 얼면 얼음 껍질 속에서 굳는다. 매 프레임 `read()`로 상태를 받아 움직인다.
 *
 * VRM은 +Z가 앞 — 시뮬 방향각 a(x=cos a, z=sin a)는 rotation.y = π/2 − a.
 */

export type KidMode = "idle" | "run" | "charge" | "throw" | "gather" | "build" | "dash" | "hit" | "frozen" | "cheer" | "sad";

export interface KidFrame {
  x: number;
  z: number;
  face: number;
  mode: KidMode;
  speed: number;
  /** 0..1 힘 모은 정도 */
  charge: number;
  visible: boolean;
  /** 🍫 반짝임 */
  cocoa: boolean;
  /** 🧊 왕눈덩이를 들고 있음 */
  giant: boolean;
}

export const HEAD_Y = 1.36;

const shadowGeo = new THREE.CircleGeometry(0.42, 24);
const ringGeo = new THREE.RingGeometry(0.42, 0.52, 32);

export default function Kid({ look, seed, teamColor, scarf, lowDetail, read }: { look: PersonLook; seed: number; teamColor: string; scarf: string; lowDetail: boolean; read: () => KidFrame }) {
  const root = useRef<THREE.Group>(null);
  const foot = useRef<THREE.Group>(null);
  const ice = useRef<THREE.Mesh>(null);
  const ball = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Mesh>(null);
  const anim = useRef({ phase: 0, modeAt: 0, mode: "idle" as KidMode });

  const pose = (o: Float32Array, t: number, dt: number) => {
    const f = read();
    const a = anim.current;
    if (f.mode !== a.mode) {
      a.mode = f.mode;
      a.modeAt = t;
    }
    const since = t - a.modeAt;
    const r = root.current;
    if (r) {
      r.visible = f.visible;
      r.position.set(f.x, 0, f.z);
      r.rotation.y = Math.PI / 2 - f.face;
    }
    const g = foot.current;
    if (g) {
      g.visible = f.visible;
      g.position.set(f.x, 0.015, f.z);
    }
    if (ice.current) ice.current.visible = f.visible && f.mode === "frozen";
    if (glow.current) glow.current.visible = f.visible && f.cocoa;
    const holding = f.mode === "charge" || f.giant;
    if (ball.current) {
      ball.current.visible = f.visible && holding;
      ball.current.scale.setScalar(f.giant ? 2.4 : 1);
    }
    switch (f.mode) {
      case "run":
        a.phase += dt * (7 + f.speed * 6);
        addWalk(o, a.phase, 0.45 + f.speed * 0.55);
        o[BODY.spine] += 0.15 * f.speed;
        break;
      case "charge": {
        // 오른팔을 뒤로 크게 젖힘 (많이 모을수록 더), 왼팔은 앞으로 겨눔
        const k = 0.4 + f.charge * 0.6;
        setBone(o, "rightUpperArm", -2.2 * k - 0.4, 0, -0.5);
        setBone(o, "rightLowerArm", -1.2 * k);
        setBone(o, "leftUpperArm", -1.3, 0, 0.2);
        o[BODY.spine] -= 0.15 * k;
        o[BODY.spine + 1] -= 0.35 * k;
        setBone(o, "rightUpperLeg", 0.25 * k);
        setBone(o, "leftUpperLeg", -0.3 * k);
        if (f.speed > 0.15) {
          a.phase += dt * 6;
          o[BODY.rightUpperLeg] += Math.sin(a.phase) * 0.3;
          o[BODY.leftUpperLeg] -= Math.sin(a.phase) * 0.3;
        }
        break;
      }
      case "throw": {
        // 휙 — 팔이 앞으로 내려오며 몸이 따라 돈다
        const k = Math.min(1, since / 0.25);
        setBone(o, "rightUpperArm", -2.6 + k * 1.9, 0, -0.3 + k * 0.2);
        setBone(o, "rightLowerArm", -0.3);
        setBone(o, "leftUpperArm", -0.4, 0, 0.5);
        o[BODY.spine] += 0.3 * k;
        o[BODY.spine + 1] += 0.4 * k;
        setBone(o, "leftUpperLeg", -0.4);
        setBone(o, "rightUpperLeg", 0.3);
        break;
      }
      case "gather": {
        addCrouch(o, 0.85);
        const w = Math.sin(t * 9 + seed);
        o[BODY.rightUpperArm] += w * 0.25;
        o[BODY.leftUpperArm] -= w * 0.25;
        o[BODY.rightLowerArm] -= 0.4;
        o[BODY.leftLowerArm] -= 0.4;
        break;
      }
      case "build":
        addCrouch(o, 0.6);
        setBone(o, "rightUpperArm", -1.6, 0, -0.2);
        setBone(o, "leftUpperArm", -1.6, 0, 0.2);
        break;
      case "dash":
        addCrouch(o, 0.35);
        o[BODY.spine] += 0.5;
        setBone(o, "rightUpperArm", 0.6, 0, -0.6);
        setBone(o, "leftUpperArm", 0.6, 0, 0.6);
        break;
      case "hit": {
        const w = Math.sin(since * 30) * Math.max(0, 1 - since * 3);
        o[BODY.spine] -= 0.35;
        o[BODY.head] -= 0.3 + w * 0.2;
        setBone(o, "rightUpperArm", -0.8, 0, -1.2);
        setBone(o, "leftUpperArm", -0.8, 0, 1.2);
        break;
      }
      case "frozen":
        // 얼음 속 굳은 자세 (팔 벌림)
        setBone(o, "rightUpperArm", -0.4, 0, -1.1);
        setBone(o, "leftUpperArm", -0.4, 0, 1.1);
        o[BODY.head] -= 0.1;
        break;
      case "cheer": {
        const w = Math.sin(t * 9);
        setBone(o, "rightUpperArm", -2.6 + w * 0.25, 0, -0.5);
        setBone(o, "leftUpperArm", -2.6 - w * 0.25, 0, 0.5);
        o[BODY_DROP] -= Math.max(0, Math.sin(t * 9)) * 0.07;
        break;
      }
      case "sad":
        o[BODY.head] += 0.45;
        o[BODY.spine] += 0.2;
        break;
      default:
        o[BODY.spine] += Math.sin(t * 2 + seed) * 0.03;
        setBone(o, "rightUpperArm", 0, 0, -0.15);
        setBone(o, "leftUpperArm", 0, 0, 0.15);
        break;
    }
  };

  const face = () => {
    const m = anim.current.mode;
    if (m === "hit") return { surprised: 1 };
    if (m === "frozen") return { surprised: 0.6, shut: true };
    if (m === "cheer") return { happy: 1 };
    if (m === "sad") return { sad: 0.8 };
    if (m === "charge" || m === "throw") return { angry: 0.5, happy: 0.3 };
    return { happy: 0.35 };
  };

  return (
    <>
      <group ref={foot} visible={false}>
        <mesh geometry={shadowGeo} rotation-x={-Math.PI / 2}>
          <meshBasicMaterial color="#334155" transparent opacity={0.22} depthWrite={false} />
        </mesh>
        <mesh geometry={ringGeo} rotation-x={-Math.PI / 2} position-y={0.003}>
          <meshBasicMaterial color={teamColor} transparent opacity={0.9} depthWrite={false} />
        </mesh>
        <mesh ref={glow} rotation-x={-Math.PI / 2} position-y={0.006} visible={false}>
          <ringGeometry args={[0.56, 0.66, 32]} />
          <meshBasicMaterial color="#f59e0b" transparent opacity={0.8} depthWrite={false} />
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
            <group position={[0, -0.02, -0.01]}>
              {/* 팀 색 털모자 + 방울 */}
              <mesh scale={[1, 0.8, 1]}>
                <sphereGeometry args={[0.11, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
                <meshStandardMaterial color={teamColor} roughness={0.9} />
              </mesh>
              <mesh position={[0, 0.1, 0]}>
                <sphereGeometry args={[0.04, 10, 8]} />
                <meshStandardMaterial color="#ffffff" roughness={1} />
              </mesh>
            </group>
          }
          back={
            // 목도리 (자리마다 다른 색 — 같은 팀 안에서도 구분)
            <mesh position={[0, 0.14, 0.02]} rotation-x={Math.PI / 2}>
              <torusGeometry args={[0.085, 0.03, 8, 20]} />
              <meshStandardMaterial color={scarf} roughness={0.9} />
            </mesh>
          }
          handR={
            <mesh ref={ball} position={[0, -0.08, 0.02]} visible={false}>
              <sphereGeometry args={[0.06, 12, 8]} />
              <meshStandardMaterial color="#f8fafc" roughness={0.8} />
            </mesh>
          }
          fallback={
            <mesh position={[0, 0.65, 0]} scale={[0.35, 0.68, 0.3]}>
              <sphereGeometry args={[1, 14, 10]} />
              <meshBasicMaterial color={teamColor} transparent opacity={0.45} />
            </mesh>
          }
        />
        {/* 얼었을 때: 반투명 얼음 껍질 */}
        <mesh ref={ice} position={[0, 0.85, 0]} visible={false}>
          <capsuleGeometry args={[0.42, 0.9, 6, 14]} />
          <meshPhysicalMaterial color="#bfe9ff" transparent opacity={0.45} roughness={0.08} transmission={0.4} thickness={0.3} depthWrite={false} />
        </mesh>
      </group>
    </>
  );
}
