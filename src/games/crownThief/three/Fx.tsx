"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ITEM_INFO, ROAR_R, SEAT_COLORS, SNARE_R } from "../data";
import type { GameEvent } from "../sim";

/**
 * 3D 연출 (룰북 §11): 왕관 이동 금빛 폭죽, 왕관 낙하 충격 고리, 📣 호령 금빛 충격파, 💀 손길 보라 고리,
 * 돌진 박치기 불꽃, 몸 부딪힘, 착지 먼지, 다시 나타남 반짝임, 아이템 줍기, 🍌 미끄러짐.
 * 각 연출은 시작 시각(`at`, performance.now ms)부터 스스로 움직이고 수명이 끝나면 숨는다.
 */

export interface FxItem {
  ev: GameEvent;
  at: number;
}

const ringGeo = new THREE.RingGeometry(0.85, 1, 48);
const sparkGeo = new THREE.OctahedronGeometry(0.08, 0);
const dropGeo = new THREE.SphereGeometry(0.07, 6, 4);

function Ring({ at, x, z, y = 0.05, color, radius, life = 520 }: { at: number; x: number; z: number; y?: number; color: string; radius: number; life?: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    const m = ref.current;
    if (!m || !mat.current) return;
    const u = (performance.now() - at) / life;
    if (u >= 1 || u < 0) {
      m.visible = false;
      return;
    }
    m.visible = true;
    const e = 1 - (1 - u) * (1 - u);
    m.scale.set(radius * (0.15 + e * 0.85), radius * (0.15 + e * 0.85), 1);
    mat.current.opacity = (1 - u) * 0.85;
  });
  return (
    <mesh ref={ref} geometry={ringGeo} position={[x, y, z]} rotation-x={-Math.PI / 2}>
      <meshBasicMaterial ref={mat} color={color} transparent depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** 튀는 조각 (금가루·불꽃·먼지) — 포물선으로 날아가며 작아진다 */
function Burst({ at, x, z, y = 0.3, color, n, power, geo = sparkGeo, life = 700, gravity = 7, glow = false }: { at: number; x: number; z: number; y?: number; color: string; n: number; power: number; geo?: THREE.BufferGeometry; life?: number; gravity?: number; glow?: boolean }) {
  const group = useRef<THREE.Group>(null);
  const dirs = useMemo(
    () =>
      Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 + Math.sin(at * 0.013 + i * 7.1) * 0.5;
        const up = 0.7 + Math.abs(Math.sin(at * 0.37 + i * 3.3)) * 1.3;
        const sp = (0.5 + Math.abs(Math.cos(at * 0.11 + i)) * 0.9) * power;
        return { v: new THREE.Vector3(Math.cos(a) * sp, up * power, Math.sin(a) * sp), spin: (i % 3) - 1 };
      }),
    [at, n, power],
  );
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const u = (performance.now() - at) / 1000;
    if (u * 1000 > life || u < 0) {
      g.visible = false;
      return;
    }
    g.visible = true;
    g.children.forEach((c, i) => {
      const d = dirs[i];
      c.position.set(d.v.x * u * 2.2, d.v.y * u * 2.2 - gravity * u * u, d.v.z * u * 2.2);
      c.rotation.set(u * 9 * d.spin, u * 7, 0);
      c.scale.setScalar(Math.max(0.01, 1 - (u * 1000) / life));
    });
  });
  return (
    <group ref={group} position={[x, y, z]}>
      {dirs.map((_, i) => (
        <mesh key={i} geometry={geo}>
          {glow ? <meshBasicMaterial color={i % 3 === 0 ? "#ffffff" : color} toneMapped={false} /> : <meshStandardMaterial color={i % 3 === 0 ? "#ffffff" : color} roughness={0.3} metalness={0.4} />}
        </mesh>
      ))}
    </group>
  );
}

/** 위로 솟는 빛기둥 (왕관 이동 순간) */
function Pillar({ at, x, z, color, life = 700 }: { at: number; x: number; z: number; color: string; life?: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    const m = ref.current;
    if (!m || !mat.current) return;
    const u = (performance.now() - at) / life;
    if (u >= 1 || u < 0) {
      m.visible = false;
      return;
    }
    m.visible = true;
    m.scale.set(1 - u * 0.6, 0.4 + u * 1.2, 1 - u * 0.6);
    mat.current.opacity = (1 - u) * 0.55;
  });
  return (
    <mesh ref={ref} position={[x, 2.5, z]}>
      <cylinderGeometry args={[0.55, 0.55, 5, 16, 1, true]} />
      <meshBasicMaterial ref={mat} color={color} transparent depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  );
}

export function FxLayer({ items, curse }: { items: FxItem[]; curse: boolean }) {
  const gold = curse ? "#a855f7" : "#fbbf24";
  return (
    <>
      {items.map((it) => {
        const { ev, at } = it;
        const key = ev.id;
        switch (ev.k) {
          case "steal":
            return (
              <group key={key}>
                <Pillar at={at} x={ev.x} z={ev.z} color={gold} />
                <Ring at={at} x={ev.x} z={ev.z} color={gold} radius={1.8} life={500} />
                <Burst at={at} x={ev.x} z={ev.z} y={1.4} color={gold} n={18} power={1.1} glow />
              </group>
            );
          case "crownLand":
            return (
              <group key={key}>
                <Ring at={at} x={ev.x} z={ev.z} color="#fde68a" radius={3} life={650} />
                <Ring at={at + 120} x={ev.x} z={ev.z} color="#ffffff" radius={2} life={500} />
                <Burst at={at} x={ev.x} z={ev.z} y={0.2} color="#e7e5e4" n={14} power={0.9} geo={dropGeo} />
              </group>
            );
          case "drop":
            return <Burst key={key} at={at} x={ev.x} z={ev.z} y={0.4} color="#fbbf24" n={12} power={0.8} glow />;
          case "roar":
            return (
              <group key={key}>
                <Ring at={at} x={ev.x} z={ev.z} color="#fbbf24" radius={ROAR_R} life={420} />
                <Ring at={at + 80} x={ev.x} z={ev.z} y={0.08} color="#ffffff" radius={ROAR_R * 0.75} life={380} />
                <Burst at={at} x={ev.x} z={ev.z} y={0.2} color="#fde68a" n={16} power={1.2} geo={dropGeo} />
              </group>
            );
          case "snare":
            return (
              <group key={key}>
                <Ring at={at} x={ev.x} z={ev.z} color="#a855f7" radius={SNARE_R} life={600} />
                <Burst at={at} x={ev.x} z={ev.z} y={0.3} color="#7c3aed" n={14} power={0.7} glow life={800} gravity={-1} />
              </group>
            );
          case "dashHit":
            return <Burst key={key} at={at} x={ev.x} z={ev.z} y={0.8} color={SEAT_COLORS[ev.a % 8]} n={10} power={0.8} glow life={450} />;
          case "bump":
            return <Burst key={key} at={at} x={ev.x} z={ev.z} y={0.8} color="#fde68a" n={6} power={0.5} geo={dropGeo} life={400} />;
          case "land":
            return <Ring key={key} at={at} x={ev.x} z={ev.z} color="#e7e5e4" radius={1.3} life={420} />;
          case "respawn":
            return (
              <group key={key}>
                <Pillar at={at} x={ev.x} z={ev.z} color={SEAT_COLORS[ev.s % 8]} life={600} />
                <Burst at={at} x={ev.x} z={ev.z} y={0.2} color={SEAT_COLORS[ev.s % 8]} n={10} power={0.6} glow gravity={-2} life={800} />
              </group>
            );
          case "pick":
            return <Burst key={key} at={at} x={ev.x} z={ev.z} y={0.6} color={ITEM_INFO[ev.kind].color} n={12} power={0.8} geo={dropGeo} />;
          case "slip":
            return <Burst key={key} at={at} x={ev.x} z={ev.z} y={0.2} color="#facc15" n={8} power={0.6} geo={dropGeo} life={500} />;
          default:
            return null;
        }
      })}
    </>
  );
}
