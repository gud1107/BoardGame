"use client";

import { memo, useRef } from "react";
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
  /** 앞구르기 진행 0..1 (아니면 −1) */
  roll: number;
  /** 구르는 방향 (시뮬 각) */
  rollDir: number;
}

/** 웅크린 몸의 굴림 중심 높이 */
const ROLL_C = 0.38;
/** 구르기 진행(0..1) → 몸이 돈 각도 (웅크린 뒤 돌기 시작, 일어서기 전에 한 바퀴 끝) */
function rollAngle(k: number): number {
  const u = Math.max(0, Math.min(1, (k - 0.08) / 0.76));
  return Math.PI * 2 * (u * 0.65 + u * u * (3 - 2 * u) * 0.35);
}
function rollTumble(g: THREE.Group, k: number) {
  const a = k < 0 ? 0 : rollAngle(k);
  // 발밑이 아니라 웅크린 몸 가운데를 축으로 돈다
  g.rotation.x = a;
  g.position.set(0, ROLL_C * (1 - Math.cos(a)), -ROLL_C * Math.sin(a));
}

export const HEAD_Y = 1.36;

const shadowGeo = new THREE.CircleGeometry(0.42, 24);
const ringGeo = new THREE.RingGeometry(0.42, 0.52, 32);

export default memo(function Kid({ look, seed, teamColor, scarf, lowDetail, read }: { look: PersonLook; seed: number; teamColor: string; scarf: string; lowDetail: boolean; read: () => KidFrame }) {
  const root = useRef<THREE.Group>(null);
  const tumble = useRef<THREE.Group>(null);
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
      // 구를 때는 구르는 쪽을 보고, 끝날 무렵 조준 방향으로 돌아온다
      let face = f.face;
      if (f.roll >= 0) {
        const back = Math.max(0, (f.roll - 0.82) / 0.18);
        const d = Math.atan2(Math.sin(f.face - f.rollDir), Math.cos(f.face - f.rollDir));
        face = f.rollDir + d * back;
      }
      r.rotation.y = Math.PI / 2 - face;
    }
    if (tumble.current) rollTumble(tumble.current, f.roll);
    const g = foot.current;
    if (g) {
      g.visible = f.visible;
      g.position.set(f.x, 0.015, f.z);
    }
    if (ice.current) ice.current.visible = f.visible && f.mode === "frozen";
    if (glow.current) glow.current.visible = f.visible && f.cocoa;
    const holding = f.mode === "charge" || (f.giant && f.roll < 0);
    if (ball.current) {
      ball.current.visible = f.visible && holding;
      ball.current.scale.setScalar(f.giant ? 1.9 : 1);
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
      case "dash": {
        // 앞구르기: 무릎을 가슴에 끌어안고 턱을 당겨 공처럼 말았다가 끝에 펴며 일어선다
        const k = f.roll < 0 ? 0 : f.roll > 0.78 ? Math.max(0.25, 1 - ((f.roll - 0.78) / 0.22) * 0.75) : 1;
        for (const side of ["right", "left"] as const) {
          const out = side === "right" ? -1 : 1;
          setBone(o, `${side}UpperLeg`, -2.15 * k, 0, 0.12 * out * k);
          setBone(o, `${side}LowerLeg`, 2.45 * k);
          setBone(o, `${side}UpperArm`, -1.15 * k, 0, 0.25 * out * k);
          setBone(o, `${side}LowerArm`, -1.6 * k);
        }
        setBone(o, "spine", 0.6 * k);
        setBone(o, "chest", 0.45 * k);
        setBone(o, "neck", 0.4 * k);
        setBone(o, "head", 0.45 * k);
        o[BODY_DROP] += 0.4 * k;
        break;
      }
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
        <group ref={tumble}>
        <VrmBody
          look={look}
          seed={seed}
          headY={HEAD_Y}
          pose={pose}
          face={face}
          lowDetail={lowDetail}
          follow={24}
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
              <sphereGeometry args={[0.1, 14, 10]} />
              <meshStandardMaterial color="#f8fafc" roughness={0.8} emissive="#7dd3fc" emissiveIntensity={0.25} />
            </mesh>
          }
          fallback={
            <mesh position={[0, 0.65, 0]} scale={[0.35, 0.68, 0.3]}>
              <sphereGeometry args={[1, 14, 10]} />
              <meshBasicMaterial color={teamColor} transparent opacity={0.45} />
            </mesh>
          }
        />
        </group>
        {/* 얼었을 때: 반투명 얼음 껍질 */}
        <mesh ref={ice} position={[0, 0.85, 0]} visible={false}>
          <capsuleGeometry args={[0.42, 0.9, 6, 14]} />
          {/* 투과(transmission) 재질은 얼 때마다 장면 전체를 한 번 더 그려 렉이 걸린다 — 일반 반투명으로 */}
          <meshStandardMaterial color="#bfe9ff" transparent opacity={0.5} roughness={0.08} metalness={0.15} emissive="#7dd3fc" emissiveIntensity={0.15} depthWrite={false} />
        </mesh>
      </group>
    </>
  );
});
