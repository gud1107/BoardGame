"use client";

import { useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Strike } from "../../hideAndSeek/three/HouseFigure";
import type { WeaponLook } from "./Figures";

/**
 * VRM 술래 오른손에 쥐는 무기 — 손 뼈 기준 좌표(T자세: 팔 방향 -x, 손등 +y, 앞 +z).
 * 총은 총열이 팔을 따라(-x) 뻗고, 뿅망치는 자루가 팔과 45°로 꺾여 내려칠 때 머리가 앞으로 온다.
 */

type V3 = [number, number, number];

function Bx({ p, s, c, m = 0.2, r = 0.5, e }: { p: V3; s: V3; c: string; m?: number; r?: number; e?: string }) {
  return (
    <mesh position={p}>
      <boxGeometry args={s} />
      <meshStandardMaterial color={c} metalness={m} roughness={r} emissive={e ?? "#000"} emissiveIntensity={e ? 0.6 : 0} />
    </mesh>
  );
}

/** 총구 불꽃 — 쏜 직후 60ms */
function Muzzle({ at, strike }: { at: V3; strike?: RefObject<Strike> }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const sk = strike?.current;
    const e = sk && sk.kind === "gun" ? (performance.now() - sk.at) / 1000 : 9;
    g.visible = e < 0.07;
    if (g.visible) g.scale.setScalar(0.7 + Math.random() * 0.6);
  });
  return (
    <group ref={ref} position={at} visible={false}>
      <mesh>
        <sphereGeometry args={[0.06, 8, 6]} />
        <meshBasicMaterial color="#fff3b0" toneMapped={false} />
      </mesh>
      <mesh position={[-0.08, 0, 0]} rotation-z={Math.PI / 2}>
        <coneGeometry args={[0.07, 0.2, 8]} />
        <meshBasicMaterial color="#ffb347" transparent opacity={0.85} toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  );
}

export default function HeldWeapon({ kind, strike }: { kind: WeaponLook; strike?: RefObject<Strike> }) {
  switch (kind) {
    case "hammer":
      // 뿅망치: 노란 자루 + 빨간 머리(양 끝 노란 테)
      return (
        <group position={[-0.05, 0, 0.02]} rotation-z={Math.PI / 4}>
          <Bx p={[0, 0.18, 0]} s={[0.045, 0.46, 0.045]} c="#facc15" r={0.4} />
          <group position={[0, 0.44, 0]} rotation-z={Math.PI / 2}>
            <mesh>
              <cylinderGeometry args={[0.085, 0.085, 0.26, 14]} />
              <meshStandardMaterial color="#ef4444" roughness={0.35} />
            </mesh>
            {[-0.135, 0.135].map((y) => (
              <mesh key={y} position={[0, y, 0]}>
                <cylinderGeometry args={[0.09, 0.09, 0.03, 14]} />
                <meshStandardMaterial color="#fde047" roughness={0.4} />
              </mesh>
            ))}
          </group>
        </group>
      );
    case "sling":
      // 새총: Y자 나무 + 고무줄
      return (
        <group position={[-0.06, 0.02, 0]}>
          <Bx p={[0, 0.06, 0]} s={[0.04, 0.14, 0.04]} c="#8d6e63" />
          <Bx p={[0, 0.16, 0.05]} s={[0.035, 0.1, 0.035]} c="#8d6e63" />
          <Bx p={[0, 0.16, -0.05]} s={[0.035, 0.1, 0.035]} c="#8d6e63" />
          <Bx p={[0.03, 0.2, 0]} s={[0.01, 0.01, 0.11]} c="#b91c1c" />
        </group>
      );
    case "pistol":
      return (
        <group position={[-0.05, 0.05, 0]}>
          <Bx p={[-0.08, 0.03, 0]} s={[0.24, 0.07, 0.045]} c="#1f2937" m={0.7} r={0.35} />
          <Bx p={[0.01, -0.03, 0]} s={[0.06, 0.12, 0.04]} c="#111827" m={0.3} />
          <Muzzle at={[-0.22, 0.03, 0]} strike={strike} />
        </group>
      );
    case "shotgun":
      return (
        <group position={[-0.05, 0.05, 0]}>
          <Bx p={[-0.22, 0.03, 0]} s={[0.6, 0.06, 0.06]} c="#3f3f46" m={0.6} r={0.4} />
          <Bx p={[-0.18, -0.02, 0]} s={[0.22, 0.05, 0.07]} c="#78350f" />
          <Bx p={[0.14, -0.02, 0]} s={[0.22, 0.09, 0.06]} c="#78350f" />
          <Muzzle at={[-0.54, 0.03, 0]} strike={strike} />
        </group>
      );
    case "sniper":
      return (
        <group position={[-0.05, 0.05, 0]}>
          <Bx p={[-0.3, 0.03, 0]} s={[0.85, 0.055, 0.055]} c="#334155" m={0.6} r={0.4} />
          <Bx p={[-0.1, 0.1, 0]} s={[0.24, 0.06, 0.06]} c="#0f172a" m={0.5} />
          <Bx p={[0.2, -0.01, 0]} s={[0.26, 0.1, 0.06]} c="#475569" />
          <Muzzle at={[-0.74, 0.03, 0]} strike={strike} />
        </group>
      );
    case "flashlight":
      return (
        <group position={[-0.08, 0.02, 0]}>
          <Bx p={[0, 0, 0]} s={[0.2, 0.05, 0.05]} c="#333" />
          <mesh position={[-0.11, 0, 0]}>
            <sphereGeometry args={[0.04, 8, 6]} />
            <meshBasicMaterial color="#fff6c2" toneMapped={false} />
          </mesh>
        </group>
      );
    default:
      return null;
  }
}

export function strikeKindOf(weapon: string | null | undefined): Strike["kind"] {
  if (!weapon) return "none";
  if (weapon === "hand") return "punch";
  if (weapon === "hammer") return "melee";
  return "gun";
}
