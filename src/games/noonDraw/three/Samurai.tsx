"use client";

import { useRef } from "react";
import * as THREE from "three";
import type { PersonLook } from "@/games/shared/three/SeatedPerson";
import VrmBody, { addCrouch, setBone, BODY, BODY_DROP, type BodyFace } from "@/games/shared/three/VrmBody";

/**
 * 결투자 (룰북 §11). 프로필 캐릭터(VRM)가 칼자루에 손을 얹고 낮게 버티다가, 칼을 뽑는 순간 옆으로 베어 낸 자세로 멈춘다.
 * 부정 출발은 앞으로 고꾸라질 듯 휘청, 진 사람은 무릎을 꿇고, 이긴 사람은 칼을 천천히 거둔다.
 *
 * 매 프레임 `read()`로 위치·자세를 받아 React 다시 그리기 없이 움직인다. VRM은 +Z가 앞.
 */

export type SamuraiMode = "idle" | "stance" | "tense" | "slash" | "stumble" | "kneel" | "sheathe" | "cheer" | "down";

export interface SamuraiFrame {
  x: number;
  z: number;
  /** rotation.y */
  yaw: number;
  mode: SamuraiMode;
  /** 이 자세가 시작된 시각 (useFrame clock 초) */
  since: number;
  visible: boolean;
}

export const HEAD_Y = 1.45;

const bladeGeo = new THREE.BoxGeometry(0.028, 0.82, 0.008);
const hiltGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.24, 8);
const guardGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.012, 12);
const sheathGeo = new THREE.CylinderGeometry(0.024, 0.02, 0.85, 8);
const bladeMat = new THREE.MeshStandardMaterial({ color: "#e8eef5", metalness: 0.95, roughness: 0.15, emissive: "#9fb4c8", emissiveIntensity: 0.15 });
const hiltMat = new THREE.MeshStandardMaterial({ color: "#2b1d14", roughness: 0.8 });
const guardMat = new THREE.MeshStandardMaterial({ color: "#b8902c", metalness: 0.7, roughness: 0.35 });
const sheathMat = new THREE.MeshStandardMaterial({ color: "#1d1a24", roughness: 0.45, metalness: 0.2 });
const shadowGeo = new THREE.CircleGeometry(0.42, 20);
const ringGeo = new THREE.RingGeometry(0.46, 0.56, 32);

const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

export default function Samurai({ look, seed, color, lowDetail, out, read }: { look: PersonLook; seed: number; color: string; lowDetail: boolean; out?: boolean; read: () => SamuraiFrame }) {
  const root = useRef<THREE.Group>(null);
  const blade = useRef<THREE.Group>(null);
  const hilt = useRef<THREE.Group>(null);
  const modeRef = useRef<SamuraiMode>("idle");

  const pose = (o: Float32Array, t: number) => {
    const f = read();
    modeRef.current = f.mode;
    const r = root.current;
    if (r) {
      r.visible = f.visible;
      r.position.set(f.x, 0, f.z);
      r.rotation.y = f.yaw;
    }
    const u = t - f.since;
    const drawn = f.mode === "slash" || f.mode === "kneel" || f.mode === "cheer" || (f.mode === "sheathe" && u < 1.1);
    if (blade.current) blade.current.visible = drawn;
    if (hilt.current) hilt.current.visible = !drawn;
    const breath = Math.sin(t * 2.1 + seed) * 0.02;

    switch (f.mode) {
      case "idle":
        setBone(o, "rightUpperArm", 0, 0, -0.15);
        setBone(o, "leftUpperArm", -0.2, 0, 0.15);
        setBone(o, "leftLowerArm", -0.6);
        o[BODY.spine] += breath;
        break;
      case "stance":
      case "tense": {
        const k = f.mode === "tense" ? 0.34 : 0.22;
        addCrouch(o, k);
        // 오른손은 왼쪽 허리 칼자루로, 왼손은 칼집을 쥔다
        setBone(o, "rightUpperArm", -0.6, 0, 0.5);
        setBone(o, "rightLowerArm", -1.15, 0.2);
        setBone(o, "leftUpperArm", -0.3, 0, 0.12);
        setBone(o, "leftLowerArm", -0.85);
        setBone(o, "rightUpperLeg", -0.55 - k, 0, -0.05);
        setBone(o, "rightLowerLeg", 0.6 + k);
        setBone(o, "leftUpperLeg", 0.15, 0, 0.08);
        setBone(o, "leftLowerLeg", 0.4);
        o[BODY.spine] += 0.08 + breath;
        o[BODY.head] -= 0.18;
        if (f.mode === "tense") {
          // 떨리는 손끝
          o[BODY.rightLowerArm + 2] += Math.sin(t * 31) * 0.03;
          o[BODY.head + 1] += Math.sin(t * 0.9 + seed) * 0.04;
        }
        break;
      }
      case "slash": {
        const k = ease(u / 0.12);
        setBone(o, "rightUpperArm", -0.6 - 0.95 * k, 0, 0.5 - 1.45 * k);
        setBone(o, "rightLowerArm", -1.15 * (1 - k) - 0.05);
        setBone(o, "leftUpperArm", -0.3 - 0.2 * k, 0, 0.12 + 0.5 * k);
        setBone(o, "leftLowerArm", -0.85);
        setBone(o, "rightUpperLeg", -0.95 * k - 0.4, 0, -0.1);
        setBone(o, "rightLowerLeg", 1.0);
        setBone(o, "leftUpperLeg", 0.6 * k);
        setBone(o, "leftLowerLeg", 0.25);
        o[BODY.spine] += 0.3 * k;
        o[BODY.spine + 1] -= 0.45 * k;
        o[BODY.chest + 1] -= 0.2 * k;
        o[BODY_DROP] += 0.16 * k;
        break;
      }
      case "stumble": {
        const w = Math.sin(t * 18);
        setBone(o, "rightUpperArm", -1.3 + w * 0.5, 0, -0.7);
        setBone(o, "leftUpperArm", -1.1 - w * 0.5, 0, 0.8);
        setBone(o, "rightUpperLeg", -0.7);
        setBone(o, "rightLowerLeg", 0.6);
        setBone(o, "leftUpperLeg", 0.4);
        o[BODY.spine] += 0.55;
        o[BODY.head] += 0.25;
        o[BODY.spine + 2] += w * 0.12;
        break;
      }
      case "kneel":
      case "down": {
        const k = ease(u / 0.45);
        addCrouch(o, 0.85 * k);
        setBone(o, "rightUpperArm", -0.35 * k, 0, -0.1);
        setBone(o, "leftUpperArm", -0.5 * k, 0, 0.3);
        setBone(o, "leftLowerArm", -0.5 * k);
        o[BODY.spine] += 0.55 * k;
        o[BODY.head] += 0.45 * k;
        break;
      }
      case "sheathe": {
        // 칼을 천천히 거두며 똑바로 선다
        const k = ease(u / 1.1);
        setBone(o, "rightUpperArm", -1.55 + 0.95 * k, 0, -0.95 + 1.45 * k);
        setBone(o, "rightLowerArm", -0.05 - 1.1 * k);
        setBone(o, "leftUpperArm", -0.5, 0, 0.3 - 0.15 * k);
        setBone(o, "leftLowerArm", -0.85);
        o[BODY.spine] += 0.15 * (1 - k) + breath;
        break;
      }
      case "cheer": {
        setBone(o, "rightUpperArm", -2.85, 0, -0.25 + Math.sin(t * 3) * 0.05);
        setBone(o, "rightLowerArm", -0.2);
        setBone(o, "leftUpperArm", -0.3, 0, 0.25);
        setBone(o, "leftLowerArm", -0.9);
        o[BODY.spine] -= 0.1;
        o[BODY.head] -= 0.2;
        break;
      }
    }
  };

  const face = (t: number): BodyFace => {
    const m = modeRef.current;
    if (m === "stance") return { angry: 0.35 };
    if (m === "tense") return { angry: 0.55 };
    if (m === "slash") return { angry: 0.8 };
    if (m === "stumble") return { surprised: 0.9 };
    if (m === "kneel" || m === "down") return { sad: 0.8, shut: m === "down" };
    if (m === "cheer" || m === "sheathe") return { happy: 0.7 + Math.sin(t * 4) * 0.1 };
    return {};
  };

  return (
    <group ref={root}>
      <mesh geometry={shadowGeo} rotation-x={-Math.PI / 2} position-y={0.012}>
        <meshBasicMaterial color="#000" transparent opacity={0.28} depthWrite={false} />
      </mesh>
      <mesh geometry={ringGeo} rotation-x={-Math.PI / 2} position-y={0.015}>
        <meshBasicMaterial color={color} transparent opacity={0.85} depthWrite={false} />
      </mesh>
      {/* 왼쪽 허리 칼집 (뒤로 비스듬히) */}
      <group position={[0.17, 0.82, -0.05]} rotation={[1.15, 0, 0.12]}>
        <mesh geometry={sheathGeo} material={sheathMat} position-y={-0.38} castShadow />
        <group ref={hilt} position-y={0.02}>
          <mesh geometry={guardGeo} material={guardMat} />
          <mesh geometry={hiltGeo} material={hiltMat} position-y={0.13} />
        </group>
      </group>
      <VrmBody
        look={look}
        seed={seed}
        headY={HEAD_Y}
        lowDetail={lowDetail}
        follow={22}
        out={out}
        pose={pose}
        face={face}
        handR={
          <group ref={blade} visible={false}>
            <mesh geometry={hiltGeo} material={hiltMat} position-y={-0.02} />
            <mesh geometry={guardGeo} material={guardMat} position-y={-0.14} />
            <mesh geometry={bladeGeo} material={bladeMat} position-y={-0.56} castShadow />
          </group>
        }
      />
    </group>
  );
}
