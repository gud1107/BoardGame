"use client";

import * as THREE from "three";

/**
 * 왕관 모형 (원점 = 왕관 밑동 가운데, 지름 약 0.36). 금 띠 + 뾰족한 다섯 갈래 + 보석.
 * 💀 저주 모드는 검보라 금속 + 보랏빛 보석. 머리 위(Runner)와 바닥(ArenaScene)에서 같이 쓴다.
 */

const bandGeo = new THREE.CylinderGeometry(0.18, 0.17, 0.12, 20, 1, true);
const spikeGeo = new THREE.ConeGeometry(0.045, 0.16, 6);
const gemGeo = new THREE.OctahedronGeometry(0.032, 0);
const topGemGeo = new THREE.SphereGeometry(0.028, 10, 8);

const SPIKES = Array.from({ length: 5 }, (_, i) => (i / 5) * Math.PI * 2);

export default function CrownModel({ curse = false }: { curse?: boolean }) {
  const metal = curse ? "#4c1d95" : "#f5c542";
  const emissive = curse ? "#7c3aed" : "#b8860b";
  const gem = curse ? "#e879f9" : "#ef4444";
  return (
    <group>
      <mesh geometry={bandGeo} position-y={0.06}>
        <meshStandardMaterial color={metal} metalness={0.85} roughness={0.25} emissive={emissive} emissiveIntensity={0.35} side={THREE.DoubleSide} />
      </mesh>
      {SPIKES.map((a, i) => (
        <group key={i} position={[Math.cos(a) * 0.17, 0.19, Math.sin(a) * 0.17]}>
          <mesh geometry={spikeGeo}>
            <meshStandardMaterial color={metal} metalness={0.85} roughness={0.25} emissive={emissive} emissiveIntensity={0.35} />
          </mesh>
          <mesh geometry={topGemGeo} position-y={0.09}>
            <meshStandardMaterial color="#fff7d6" emissive="#fff3b0" emissiveIntensity={0.6} />
          </mesh>
          <mesh geometry={gemGeo} position={[Math.cos(a) * 0.012, -0.13, Math.sin(a) * 0.012]}>
            <meshStandardMaterial color={i % 2 ? "#3b82f6" : gem} emissive={i % 2 ? "#1d4ed8" : gem} emissiveIntensity={0.5} roughness={0.15} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
