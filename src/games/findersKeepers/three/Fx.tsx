"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { BASKET_R, SEAT_COLORS, TOY_INFO } from "../data";
import type { GameEvent } from "../sim";

/**
 * 3D 연출 (룰북 §11): 줍기 반짝, ✂️ 가로채기 금빛 폭죽 + 고리, 🧺 넣기 반짝(바구니 위), 🌈 세트 무지개 폭죽,
 * ✂️ 줄 끊기 조각, 🤝 넘겨주기 고리, 🔥 털기 주황 폭죽, 💣 폭탄 받기 빨간 고리, 💥 펑(큰 고리 + 연기),
 * 물건 착지 먼지, 돌진 박치기 불꽃, 몸 부딪힘.
 * 각 연출은 시작 시각(`at`, performance.now ms)부터 스스로 움직이고 수명이 끝나면 숨는다.
 */

export interface FxItem {
  ev: GameEvent;
  at: number;
}

const ringGeo = new THREE.RingGeometry(0.85, 1, 48);
const sparkGeo = new THREE.OctahedronGeometry(0.08, 0);
const dropGeo = new THREE.SphereGeometry(0.07, 6, 4);
const RAINBOW = ["#f43f5e", "#f97316", "#facc15", "#22c55e", "#3b82f6", "#a855f7"];

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
          case "pick":
            return <Burst key={key} at={at} x={ev.x} z={ev.z} y={0.3} colors={[TOY_INFO[ev.kind].color]} n={ev.kind === "trophy" ? 22 : 8} power={ev.kind === "trophy" ? 1.1 : 0.5} geo={dropGeo} life={500} />;
          case "snatch":
            return (
              <group key={key}>
                <Ring at={at} x={ev.x} z={ev.z} color="#fbbf24" radius={1.6} life={450} />
                <Burst at={at} x={ev.x} z={ev.z} y={0.5} colors={["#fbbf24", SEAT_COLORS[ev.s % 8]]} n={14 + Math.min(10, ev.n * 2)} power={0.9} />
              </group>
            );
          case "deposit":
            return <Burst key={key} at={at} x={ev.x} z={ev.z} y={0.6} colors={[TOY_INFO[ev.kind].color, ev.sale ? "#22d3ee" : "#fde68a"]} n={ev.sale ? 12 : 6} power={0.55} geo={dropGeo} life={500} gravity={3} />;
          case "set":
            return (
              <group key={key}>
                <Ring at={at} x={ev.x} z={ev.z} color={ev.set === "rainbow" ? "#a855f7" : "#fbbf24"} radius={BASKET_R + 0.8} life={650} />
                <Burst at={at} x={ev.x} z={ev.z} y={1} colors={ev.set === "rainbow" ? RAINBOW : ["#fbbf24", "#fde68a"]} n={ev.set === "rainbow" ? 30 : 16} power={1.2} life={900} />
              </group>
            );
          case "cut":
            return <Burst key={key} at={at} x={ev.x} z={ev.z} y={0.4} colors={["#e2e8f0", SEAT_COLORS[ev.s % 8]]} n={10} power={0.8} life={450} />;
          case "pass":
            return <Ring key={key} at={at} x={ev.x} z={ev.z} color="#34d399" radius={1.4} life={500} />;
          case "loot":
            return (
              <group key={key}>
                <Ring at={at} x={ev.x} z={ev.z} color="#fb923c" radius={BASKET_R + 0.6} life={500} />
                <Burst at={at} x={ev.x} z={ev.z} y={0.8} colors={["#fb923c", "#f43f5e"]} n={14} power={0.9} />
              </group>
            );
          case "bombOn":
            return <Ring key={key} at={at} x={ev.x} z={ev.z} color="#ef4444" radius={1.3} life={450} />;
          case "boom":
            return (
              <group key={key}>
                <Ring at={at} x={ev.x} z={ev.z} color="#f97316" radius={3.2} life={600} />
                <Ring at={at + 90} x={ev.x} z={ev.z} y={0.08} color="#fde047" radius={2.2} life={500} />
                <Burst at={at} x={ev.x} z={ev.z} y={0.8} colors={["#f97316", "#ef4444", "#fde047"]} n={26} power={1.6} life={800} />
                <Burst at={at} x={ev.x} z={ev.z} y={0.4} colors={["#4b5563", "#9ca3af"]} n={12} power={0.6} geo={dropGeo} life={1100} gravity={-1.5} />
              </group>
            );
          case "land":
            return <Ring key={key} at={at} x={ev.x} z={ev.z} color={ev.kind === "trophy" ? "#fbbf24" : "#e9d5ff"} radius={ev.kind === "trophy" ? 2.4 : 0.9} life={420} />;
          case "dashHit":
            return <Burst key={key} at={at} x={ev.x} z={ev.z} y={0.8} colors={[SEAT_COLORS[ev.a % 8]]} n={10} power={0.8} life={450} />;
          case "bump":
            return <Burst key={key} at={at} x={ev.x} z={ev.z} y={0.8} colors={["#fde68a"]} n={6} power={0.5} geo={dropGeo} life={400} />;
          default:
            return null;
        }
      })}
    </>
  );
}
