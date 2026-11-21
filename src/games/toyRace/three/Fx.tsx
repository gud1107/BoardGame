"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ITEM_INFO, SEAT_COLORS } from "../data";
import type { GameEvent } from "../sim";

/**
 * 3D 연출 (룰북 §11): 상자 깨짐 색종이, 아이템 쓰기 고리, 맞음 별 폭죽, 방패 터짐, 장난감 벽 착지 먼지·와르르,
 * 울타리·차끼리 부딪힘 불꽃, 착지 먼지, 골인 색종이, 출발 부스트 고리.
 * 각 연출은 시작 시각(`at`, performance.now ms)부터 스스로 움직이고 수명이 끝나면 숨는다.
 */

export interface FxItem {
  ev: GameEvent;
  at: number;
}

const ringGeo = new THREE.RingGeometry(0.85, 1, 40);
const chipGeo = new THREE.BoxGeometry(0.14, 0.04, 0.1);
const starGeo = new THREE.OctahedronGeometry(0.11, 0);
const dropGeo = new THREE.SphereGeometry(0.07, 6, 4);
const blockGeo = new THREE.BoxGeometry(0.28, 0.24, 0.28);

const CONFETTI = ["#f43f5e", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ffffff"];

function Ring({ at, x, z, y = 0.06, color, radius, life = 500 }: { at: number; x: number; z: number; y?: number; color: string; radius: number; life?: number }) {
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

function Burst({ at, x, z, y = 0.3, colors, n, power, geo = starGeo, life = 700, gravity = 7 }: { at: number; x: number; z: number; y?: number; colors: string[]; n: number; power: number; geo?: THREE.BufferGeometry; life?: number; gravity?: number }) {
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
      c.position.set(d.v.x * u * 2.2, Math.max(-y, d.v.y * u * 2.2 - gravity * u * u), d.v.z * u * 2.2);
      c.rotation.set(u * 9 * d.spin, u * 7, 0);
      c.scale.setScalar(Math.max(0.01, 1 - (u * 1000) / life));
    });
  });
  return (
    <group ref={group} position={[x, y, z]}>
      {dirs.map((_, i) => (
        <mesh key={i} geometry={geo}>
          <meshStandardMaterial color={colors[i % colors.length]} roughness={0.4} emissive={colors[i % colors.length]} emissiveIntensity={0.25} />
        </mesh>
      ))}
    </group>
  );
}

export function FxLayer({ items }: { items: FxItem[] }) {
  return (
    <>
      {items.map((it) => {
        const { ev, at } = it;
        const key = `${ev.id}:${at}`;
        switch (ev.k) {
          case "box":
            return <Burst key={key} at={at} x={ev.x} z={ev.z} y={0.5} colors={CONFETTI} n={16} power={0.9} geo={chipGeo} life={800} />;
          case "use":
            return <Ring key={key} at={at} x={ev.x} z={ev.z} color={ITEM_INFO[ev.kind].color} radius={1.8} life={420} />;
          case "hit":
            return (
              <group key={key}>
                <Burst at={at} x={ev.x} z={ev.z} y={0.6} colors={["#fde047", "#ffffff", "#f97316"]} n={12} power={0.8} />
                <Ring at={at} x={ev.x} z={ev.z} color="#fde047" radius={1.6} life={400} />
              </group>
            );
          case "block":
            return <Ring key={key} at={at} x={ev.x} z={ev.z} y={0.5} color="#7dd3fc" radius={1.4} life={380} />;
          case "toyLand":
            return (
              <group key={key}>
                <Ring at={at} x={ev.x} z={ev.z} color="#e7e5e4" radius={3.2} life={600} />
                <Burst at={at} x={ev.x} z={ev.z} y={0.2} colors={["#d6d3d1", "#a8a29e"]} n={12} power={0.7} geo={dropGeo} />
              </group>
            );
          case "toyBreak":
            return <Burst key={key} at={at} x={ev.x} z={ev.z} y={0.5} colors={["#ef4444", "#3b82f6", "#facc15", "#22c55e"]} n={14} power={1.1} geo={blockGeo} life={1000} gravity={9} />;
          case "bump":
          case "wall":
            return <Burst key={key} at={at} x={ev.x} z={ev.z} y={0.35} colors={["#fde68a", "#ffffff"]} n={6} power={0.5} geo={dropGeo} life={380} />;
          case "land":
            return <Ring key={key} at={at} x={ev.x} z={ev.z} color={ev.perfect ? "#fde047" : "#e7e5e4"} radius={1.4} life={420} />;
          case "finish":
            return null;
          case "rocket":
            return null;
          case "toyDrop":
            return <Ring key={key} at={at} x={ev.x} z={ev.z} color="#ef4444" radius={2.6} life={1400} />;
          default:
            return null;
        }
      })}
    </>
  );
}

export { SEAT_COLORS };
