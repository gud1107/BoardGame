"use client";

/**
 * 경찰 모자 — 술래(VRM 머리 뼈)와 점검원 NPC·"술래인 척" 변신이 똑같이 쓴다.
 * 멀리서도 "모자 쓴 사람 = 술래 쪽"으로 보이지만, 점검원도 같은 모자라 위장이 된다.
 * 원점 = 모자 안쪽 바닥 가운데, +z = 앞(챙), 단위 m.
 */

const NAVY = "#1b2a4e";
const BAND = "#0b1222";
const GOLD = "#f2c14e";

export default function PoliceCap({ scale = 1 }: { scale?: number }) {
  return (
    <group scale={scale}>
      {/* 몸통 (위가 살짝 넓다) */}
      <mesh position-y={0.05} castShadow>
        <cylinderGeometry args={[0.132, 0.112, 0.08, 20]} />
        <meshStandardMaterial color={NAVY} roughness={0.55} />
      </mesh>
      {/* 윗면 — 앞이 살짝 솟은 판 */}
      <mesh position={[0, 0.092, 0.012]} rotation-x={-0.12} castShadow>
        <cylinderGeometry args={[0.142, 0.138, 0.018, 20]} />
        <meshStandardMaterial color={NAVY} roughness={0.5} />
      </mesh>
      {/* 검은 띠 */}
      <mesh position-y={0.018}>
        <cylinderGeometry args={[0.115, 0.115, 0.034, 20]} />
        <meshStandardMaterial color={BAND} roughness={0.35} />
      </mesh>
      {/* 챙 (반원, 앞으로 살짝 숙임) */}
      <mesh position={[0, 0.006, 0.085]} rotation-x={0.28} scale={[1, 1, 0.62]}>
        <cylinderGeometry args={[0.105, 0.105, 0.01, 20, 1, false, -Math.PI / 2, Math.PI]} />
        <meshStandardMaterial color="#05070d" roughness={0.18} metalness={0.3} />
      </mesh>
      {/* 금색 줄 + 배지 */}
      <mesh position={[0, 0.038, 0.113]}>
        <boxGeometry args={[0.15, 0.008, 0.006]} />
        <meshStandardMaterial color={GOLD} metalness={0.8} roughness={0.25} />
      </mesh>
      <mesh position={[0, 0.062, 0.12]} rotation-x={Math.PI / 2 - 0.1}>
        <cylinderGeometry args={[0.022, 0.022, 0.008, 6]} />
        <meshStandardMaterial color={GOLD} metalness={0.85} roughness={0.2} emissive={GOLD} emissiveIntensity={0.25} />
      </mesh>
    </group>
  );
}
