"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { BOX_INFO, SEAT_COLORS } from "../data";
import type { GameEvent } from "../sim";

/**
 * 3D 연출 (룰북 §11): 🚚 싣기 반짝(트럭 칸) · 🎯 슛 금빛 폭죽 · 트럭 출발 고리 · 🙌 받기 고리 · 🥚 깨짐 조각 ·
 * 🧊 녹음 물방울 · 🗑️ 반송 빨간 불꽃 · 🔍 스캔 하늘색 고리 · 💥 들이받기/🚜 지게차 충돌 불꽃.
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
      <meshBasicMaterial ref={mat} color={color} transparent depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  );
}

function Burst({ at, x, z, y = 0.3, colors, n, power, geo = sparkGeo, life = 700, gravity = 7 }: { at: number; x: number; z: number; y?: number; colors: string[]; n: number; power: number; geo?: THREE.BufferGeometry; life?: number; gravity?: number }) {
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
          <meshBasicMaterial color={i % 4 === 0 ? "#ffffff" : colors[i % colors.length]} toneMapped={false} />
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
        const key = ev.id;
        switch (ev.k) {
          case "load":
            return ev.shot ? (
              <group key={key}>
                <Ring at={at} x={ev.x} z={ev.z} color="#fbbf24" radius={1.8} life={500} />
                <Burst at={at} x={ev.x} z={ev.z} y={0.9} colors={["#fbbf24", "#fde68a", BOX_INFO[ev.kind].color]} n={18} power={1.1} life={800} />
              </group>
            ) : (
              <Burst key={key} at={at} x={ev.x} z={ev.z} y={0.9} colors={[BOX_INFO[ev.kind].color, "#fde68a"]} n={ev.onTime ? 14 : 8} power={0.6} geo={dropGeo} life={550} gravity={3} />
            );
          case "truckGo":
            return null;
          case "catch":
            return <Ring key={key} at={at} x={ev.x} z={ev.z} color={ev.steal ? "#f97316" : "#34d399"} radius={1.1} life={420} />;
          case "break":
            return (
              <group key={key}>
                <Burst at={at} x={ev.x} z={ev.z} y={0.4} colors={["#fbcfe8", "#ffffff", "#c8925a"]} n={18} power={0.9} life={700} />
                <Ring at={at} x={ev.x} z={ev.z} color="#f43f5e" radius={1.2} life={450} />
              </group>
            );
          case "melt":
            return <Burst key={key} at={at} x={ev.x} z={ev.z} y={0.4} colors={["#7dd3fc", "#bae6fd"]} n={12} power={0.4} geo={dropGeo} life={900} gravity={5} />;
          case "miss":
            return <Burst key={key} at={at} x={ev.x} z={ev.z} y={0.9} colors={["#ef4444", "#7f1d1d"]} n={10} power={0.5} geo={dropGeo} life={600} />;
          case "scan":
            return <Ring key={key} at={at} x={ev.x} z={ev.z} color="#38bdf8" radius={1.4} life={500} />;
          case "knock":
            return <Burst key={key} at={at} x={ev.x} z={ev.z} y={0.9} colors={[SEAT_COLORS[ev.a % 6], "#fde68a"]} n={12} power={0.9} life={450} />;
          case "forkHit":
            return <Burst key={key} at={at} x={ev.x} z={ev.z} y={0.9} colors={["#facc15", "#f97316"]} n={14} power={1} life={500} />;
          case "throw":
            return null;
          default:
            return null;
        }
      })}
    </>
  );
}
