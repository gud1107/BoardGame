"use client";

import * as THREE from "three";
import type { ToyKind } from "../data";

/**
 * 장난감 모형 (원점 = 바닥에 닿는 밑면 가운데, 높이 약 0.4m). 단순한 도형 조합이라 수십 개를 그려도 가볍다.
 * 색 + 모양이 모두 달라서 색을 구분하기 어려워도 종류를 알 수 있다(접근성): 🧦 길쭉한 양말 · 🦆 둥근 오리 ·
 * 🤖 네모 로봇 · 🎁 리본 상자 · 🏆 손잡이 달린 컵. 💣 폭탄(BombModel)도 여기에.
 */

const sphere = new THREE.SphereGeometry(1, 16, 12);
const box = new THREE.BoxGeometry(1, 1, 1);
const cyl = new THREE.CylinderGeometry(1, 1, 1, 16);
const capsule = new THREE.CapsuleGeometry(0.075, 0.22, 4, 10);
const cone = new THREE.ConeGeometry(1, 1, 10);
const torus = new THREE.TorusGeometry(0.07, 0.018, 8, 16);
const cupGeo = new THREE.LatheGeometry(
  [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.11, 0.0),
    new THREE.Vector2(0.11, 0.03),
    new THREE.Vector2(0.03, 0.05),
    new THREE.Vector2(0.03, 0.16),
    new THREE.Vector2(0.06, 0.18),
    new THREE.Vector2(0.15, 0.3),
    new THREE.Vector2(0.17, 0.44),
    new THREE.Vector2(0.155, 0.44),
    new THREE.Vector2(0.135, 0.31),
  ],
  20,
);

function Mat({ color, metal = 0, rough = 0.55, emissive, ei = 0 }: { color: string; metal?: number; rough?: number; emissive?: string; ei?: number }) {
  return <meshStandardMaterial color={color} metalness={metal} roughness={rough} emissive={emissive ?? "#000000"} emissiveIntensity={ei} />;
}

function Sock() {
  return (
    <group>
      <mesh geometry={capsule} position={[0, 0.2, 0]} rotation-z={0.12}>
        <Mat color="#f472b6" />
      </mesh>
      <mesh geometry={capsule} position={[0.07, 0.07, 0]} rotation-z={Math.PI / 2} scale={[1, 0.55, 1]}>
        <Mat color="#f472b6" />
      </mesh>
      <mesh geometry={cyl} position={[-0.02, 0.36, 0]} scale={[0.085, 0.05, 0.085]}>
        <Mat color="#ffffff" />
      </mesh>
      {/* 줄무늬 */}
      <mesh geometry={cyl} position={[-0.005, 0.24, 0]} scale={[0.079, 0.03, 0.079]} rotation-z={0.12}>
        <Mat color="#fde047" />
      </mesh>
    </group>
  );
}

function Duck() {
  return (
    <group>
      <mesh geometry={sphere} position={[0, 0.14, 0]} scale={[0.17, 0.13, 0.14]}>
        <Mat color="#facc15" rough={0.35} />
      </mesh>
      <mesh geometry={sphere} position={[0.1, 0.3, 0]} scale={0.09}>
        <Mat color="#facc15" rough={0.35} />
      </mesh>
      <mesh geometry={cone} position={[0.2, 0.29, 0]} rotation-z={-Math.PI / 2} scale={[0.04, 0.07, 0.03]}>
        <Mat color="#f97316" />
      </mesh>
      <mesh geometry={sphere} position={[0.15, 0.33, 0.05]} scale={0.014}>
        <Mat color="#111827" />
      </mesh>
      <mesh geometry={sphere} position={[0.15, 0.33, -0.05]} scale={0.014}>
        <Mat color="#111827" />
      </mesh>
      <mesh geometry={cone} position={[-0.17, 0.2, 0]} rotation-z={Math.PI / 2.6} scale={[0.05, 0.08, 0.05]}>
        <Mat color="#facc15" rough={0.35} />
      </mesh>
    </group>
  );
}

function Robot() {
  return (
    <group>
      <mesh geometry={box} position={[0, 0.15, 0]} scale={[0.2, 0.2, 0.15]}>
        <Mat color="#94a3b8" metal={0.6} rough={0.35} />
      </mesh>
      <mesh geometry={box} position={[0, 0.32, 0]} scale={[0.15, 0.13, 0.13]}>
        <Mat color="#cbd5e1" metal={0.6} rough={0.3} />
      </mesh>
      <mesh geometry={box} position={[0.068, 0.33, 0.035]} scale={0.03}>
        <Mat color="#22d3ee" emissive="#22d3ee" ei={0.9} />
      </mesh>
      <mesh geometry={box} position={[0.068, 0.33, -0.035]} scale={0.03}>
        <Mat color="#22d3ee" emissive="#22d3ee" ei={0.9} />
      </mesh>
      <mesh geometry={cyl} position={[0, 0.43, 0]} scale={[0.008, 0.08, 0.008]}>
        <Mat color="#475569" />
      </mesh>
      <mesh geometry={sphere} position={[0, 0.48, 0]} scale={0.025}>
        <Mat color="#ef4444" emissive="#ef4444" ei={0.8} />
      </mesh>
      {/* 태엽 */}
      <mesh geometry={torus} position={[-0.1, 0.17, 0]} rotation-y={Math.PI / 2}>
        <Mat color="#f59e0b" metal={0.7} rough={0.3} />
      </mesh>
      <mesh geometry={box} position={[0, 0.03, 0.05]} scale={[0.07, 0.06, 0.05]}>
        <Mat color="#64748b" />
      </mesh>
      <mesh geometry={box} position={[0, 0.03, -0.05]} scale={[0.07, 0.06, 0.05]}>
        <Mat color="#64748b" />
      </mesh>
    </group>
  );
}

function Gift() {
  return (
    <group>
      <mesh geometry={box} position={[0, 0.16, 0]} scale={0.3}>
        <Mat color="#ef4444" rough={0.45} />
      </mesh>
      <mesh geometry={box} position={[0, 0.16, 0]} scale={[0.31, 0.31, 0.06]}>
        <Mat color="#fde047" rough={0.3} />
      </mesh>
      <mesh geometry={box} position={[0, 0.16, 0]} scale={[0.06, 0.31, 0.31]}>
        <Mat color="#fde047" rough={0.3} />
      </mesh>
      <mesh geometry={torus} position={[0.04, 0.34, 0]} rotation-x={Math.PI / 2} scale={1.1}>
        <Mat color="#fde047" rough={0.3} />
      </mesh>
      <mesh geometry={torus} position={[-0.04, 0.34, 0]} rotation-x={Math.PI / 2} scale={1.1}>
        <Mat color="#fde047" rough={0.3} />
      </mesh>
    </group>
  );
}

function Trophy() {
  return (
    <group>
      <mesh geometry={box} position={[0, 0.04, 0]} scale={[0.2, 0.08, 0.2]}>
        <Mat color="#78350f" rough={0.6} />
      </mesh>
      <mesh geometry={cupGeo} position={[0, 0.08, 0]}>
        <meshStandardMaterial color="#fbbf24" metalness={0.9} roughness={0.2} emissive="#b45309" emissiveIntensity={0.35} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={torus} position={[0.17, 0.38, 0]} scale={1.2}>
        <Mat color="#fbbf24" metal={0.9} rough={0.2} />
      </mesh>
      <mesh geometry={torus} position={[-0.17, 0.38, 0]} scale={1.2}>
        <Mat color="#fbbf24" metal={0.9} rough={0.2} />
      </mesh>
    </group>
  );
}

export default function ToyModel({ kind }: { kind: ToyKind }) {
  switch (kind) {
    case "sock":
      return <Sock />;
    case "duck":
      return <Duck />;
    case "robot":
      return <Robot />;
    case "gift":
      return <Gift />;
    case "trophy":
      return <Trophy />;
  }
}

/** 💣 째깍 폭탄 (머리 위에 얹는다). spark = 심지 불꽃 (매 프레임 Runner가 깜빡임) */
export function BombModel() {
  return (
    <group>
      <mesh geometry={sphere} position={[0, 0.16, 0]} scale={0.16}>
        <meshStandardMaterial color="#1f2937" metalness={0.4} roughness={0.35} />
      </mesh>
      <mesh geometry={cyl} position={[0, 0.33, 0]} scale={[0.05, 0.05, 0.05]}>
        <meshStandardMaterial color="#6b7280" metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh geometry={cyl} position={[0.02, 0.4, 0]} rotation-z={-0.4} scale={[0.012, 0.1, 0.012]}>
        <meshStandardMaterial color="#d6a46a" />
      </mesh>
      <mesh geometry={sphere} position={[0.045, 0.46, 0]} scale={0.035} name="spark">
        <meshBasicMaterial color="#fde047" toneMapped={false} />
      </mesh>
    </group>
  );
}
