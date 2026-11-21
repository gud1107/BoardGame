"use client";

import { useRef } from "react";
import * as THREE from "three";
import type { PersonLook } from "@/games/shared/three/SeatedPerson";
import VrmBody, { addCrouch, addWalk, setBone, BODY, BODY_DROP } from "@/games/shared/three/VrmBody";
import { BombModel } from "./ToyModel";

/**
 * 홀 위 캐릭터 (룰북 §11). 프로필 캐릭터(VRM)가 뛰고, 💨 돌진(몸을 숙여 쭉), 휘청, ✂️ 줄 끊기(두 팔 휙),
 * 🧺 넣기(팔을 앞으로), 💣 폭탄(머리 위, 심지 불꽃), 환호·풀죽음을 뼈 회전으로 만든다.
 * 매 프레임 `read()`로 위치·상태를 받아 React 다시 그리기 없이 움직인다.
 * VRM은 +Z가 앞 — 시뮬 방향각 a(x=cos a, z=sin a)는 rotation.y = π/2 − a.
 */

export type RunnerMode = "idle" | "run" | "dash" | "stagger" | "cut" | "deposit" | "cheer" | "sad";

export interface RunnerFrame {
  x: number;
  z: number;
  face: number;
  mode: RunnerMode;
  speed: number;
  visible: boolean;
  /** 💣 폭탄을 들었나 · 터지기 직전(빨리 깜빡) */
  bomb: boolean;
  bombHot: boolean;
  /** 🐣 꼴찌 보호 (발밑 노란 고리) */
  underdog: boolean;
  /** 팀전: 팀 색 */
  team: string | null;
}

export const HEAD_Y = 1.3;

const footGeo = new THREE.RingGeometry(0.36, 0.48, 32);
const shadowGeo = new THREE.CircleGeometry(0.44, 24);
const udGeo = new THREE.RingGeometry(0.58, 0.66, 40);
const teamGeo = new THREE.RingGeometry(0.5, 0.56, 6);

export default function Runner({ look, seed, color, lowDetail, read }: { look: PersonLook; seed: number; color: string; lowDetail: boolean; read: () => RunnerFrame }) {
  const root = useRef<THREE.Group>(null);
  const foot = useRef<THREE.Group>(null);
  const ud = useRef<THREE.Mesh>(null);
  const teamRing = useRef<THREE.Mesh>(null);
  const teamMat = useRef<THREE.MeshBasicMaterial>(null);
  const bomb = useRef<THREE.Group>(null);
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
      r.position.set(f.x, 0, f.z);
      r.rotation.y = Math.PI / 2 - f.face;
    }
    if (g) {
      g.visible = f.visible;
      g.position.set(f.x, 0.012, f.z);
    }
    if (ud.current) {
      ud.current.visible = f.underdog;
      ud.current.rotation.z = t * 2;
    }
    if (teamRing.current && teamMat.current) {
      teamRing.current.visible = !!f.team;
      if (f.team) teamMat.current.color.set(f.team);
    }
    if (bomb.current) {
      bomb.current.visible = f.bomb;
      bomb.current.rotation.y = t * 1.5;
      const spark = bomb.current.getObjectByName("spark");
      if (spark) spark.scale.setScalar(0.035 * (0.6 + 0.6 * Math.abs(Math.sin(t * (f.bombHot ? 30 : 10)))));
      const k = f.bombHot ? 1 + 0.12 * Math.abs(Math.sin(t * 18)) : 1;
      bomb.current.scale.setScalar(0.9 * k);
    }
    setBone(o, "rightUpperArm", 0, 0, -0.18);
    setBone(o, "leftUpperArm", 0, 0, 0.18);
    switch (f.mode) {
      case "run": {
        a.phase += dt * (7 + f.speed * 7);
        addWalk(o, a.phase, 0.4 + f.speed * 0.6);
        o[BODY.spine] += 0.16 * f.speed;
        // 뒤로 손을 뻗어 줄을 끄는 느낌
        setBone(o, "leftUpperArm", 0.5, 0, 0.35);
        break;
      }
      case "dash":
        o[BODY.spine] += 0.55;
        setBone(o, "rightUpperArm", -1.4, 0, -0.3);
        setBone(o, "leftUpperArm", -1.4, 0, 0.3);
        setBone(o, "rightUpperLeg", -0.9);
        setBone(o, "leftUpperLeg", 0.5);
        setBone(o, "rightLowerLeg", 0.8);
        break;
      case "cut": {
        const k = Math.min(1, (t - a.modeAt) * 7);
        setBone(o, "rightUpperArm", -1.2 * k, 0, -1.2 * k);
        setBone(o, "leftUpperArm", -1.2 * k, 0, 1.2 * k);
        o[BODY.spine] -= 0.15 * k;
        break;
      }
      case "deposit": {
        const w = Math.sin(t * 12);
        setBone(o, "rightUpperArm", -1.1 + w * 0.3, 0, -0.3);
        setBone(o, "leftUpperArm", -1.1 - w * 0.3, 0, 0.3);
        o[BODY.spine] += 0.3;
        break;
      }
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
    if (m === "cheer" || m === "deposit") return { happy: 1 };
    if (m === "sad") return { sad: 0.8 };
    if (m === "dash" || m === "cut") return { angry: 0.6 };
    return { happy: 0.3 };
  };

  return (
    <>
      <group ref={foot} visible={false}>
        <mesh geometry={shadowGeo} rotation-x={-Math.PI / 2}>
          <meshBasicMaterial color="#0b0614" transparent opacity={0.32} depthWrite={false} />
        </mesh>
        <mesh geometry={footGeo} rotation-x={-Math.PI / 2} position-y={0.004}>
          <meshBasicMaterial color={color} transparent opacity={0.9} depthWrite={false} />
        </mesh>
        <mesh ref={teamRing} geometry={teamGeo} rotation-x={-Math.PI / 2} position-y={0.006} visible={false}>
          <meshBasicMaterial ref={teamMat} transparent opacity={0.95} depthWrite={false} />
        </mesh>
        <mesh ref={ud} geometry={udGeo} rotation-x={-Math.PI / 2} position-y={0.008} visible={false}>
          <meshBasicMaterial color="#fde047" transparent opacity={0.75} depthWrite={false} toneMapped={false} />
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
            <group ref={bomb} position={[0, 0.12, 0]} visible={false} scale={0.9}>
              <BombModel />
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
