"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ITEM_INFO, ROCK_R, SEAT_COLORS, SHOVE_R } from "../data";
import type { GameEvent } from "../sim";

/**
 * 3D 연출 (룰북 §11): 착지 먼지, 트램펄린 고리, 밀치기 부채꼴, 맞음 별, 발판 부서짐 조각, 낙석 충격,
 * 아이템 반짝임, 등정 꽃가루, 붕괴 휩쓸림 먼지. 각 연출은 시작 시각(`at`, performance.now ms)부터
 * 스스로 움직이고 수명이 끝나면 숨는다. 위치가 이벤트에 없으면(발판 번호만) 보드가 x·y·z를 붙여 준다.
 */

export interface FxItem {
  ev: GameEvent;
  at: number;
  x?: number;
  y?: number;
  z?: number;
  /** 밀치기 방향 */
  face?: number;
}

export const FX_LIFE_MS = 1800;

const ringGeo = new THREE.RingGeometry(0.82, 1, 36);
const chunkGeo = new THREE.BoxGeometry(0.22, 0.14, 0.18);
const dotGeo = new THREE.SphereGeometry(0.06, 6, 4);
const confettiGeo = new THREE.PlaneGeometry(0.12, 0.07);
const fanGeo = new THREE.RingGeometry(0.3, 1, 18, 1, -0.9, 1.8);

function Ring({ at, x, y, z, color, radius, life = 520 }: { at: number; x: number; y: number; z: number; color: string; radius: number; life?: number }) {
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
    m.scale.set(radius * (0.2 + e * 0.8), radius * (0.2 + e * 0.8), 1);
    mat.current.opacity = (1 - u) * 0.85;
  });
  return (
    <mesh ref={ref} geometry={ringGeo} position={[x, y + 0.04, z]} rotation-x={-Math.PI / 2}>
      <meshBasicMaterial ref={mat} color={color} transparent depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** 튀는 조각 — 포물선으로 날아가며 작아진다 */
function Burst({ at, x, y, z, color, n, power, geo = dotGeo, life = 700, gravity = 9 }: { at: number; x: number; y: number; z: number; color: string; n: number; power: number; geo?: THREE.BufferGeometry; life?: number; gravity?: number }) {
  const group = useRef<THREE.Group>(null);
  const dirs = useMemo(
    () =>
      Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 + Math.sin(at * 0.013 + i * 7.1) * 0.5;
        const up = 0.5 + Math.abs(Math.sin(at * 0.37 + i * 3.3)) * 1.2;
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
      c.rotation.set(u * 9 * d.spin, u * 7, u * 5);
      c.scale.setScalar(Math.max(0.01, 1 - (u * 1000) / life));
    });
  });
  return (
    <group ref={group} position={[x, y, z]}>
      {dirs.map((_, i) => (
        <mesh key={i} geometry={geo}>
          <meshStandardMaterial color={i % 3 === 0 ? "#ffffff" : color} roughness={0.6} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

/** 밀치기: 바라보는 쪽 부채꼴이 퍼진다 */
function Fan({ at, x, y, z, face, color }: { at: number; x: number; y: number; z: number; face: number; color: string }) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    const m = ref.current;
    if (!m || !mat.current) return;
    const u = (performance.now() - at) / 300;
    if (u >= 1 || u < 0) {
      m.visible = false;
      return;
    }
    m.visible = true;
    const s = SHOVE_R * (0.4 + u * 0.6);
    m.scale.set(s, s, 1);
    mat.current.opacity = (1 - u) * 0.6;
  });
  return (
    <mesh ref={ref} geometry={fanGeo} position={[x, y + 0.6, z]} rotation={[-Math.PI / 2, 0, face]}>
      <meshBasicMaterial ref={mat} color={color} transparent depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

export function FxLayer({ items }: { items: FxItem[] }) {
  return (
    <>
      {items.map((it) => {
        const { ev, at } = it;
        const key = ev.id;
        const x = it.x ?? 0;
        const y = it.y ?? 0;
        const z = it.z ?? 0;
        switch (ev.k) {
          case "land":
            return ev.drop >= 1.5 ? <Burst key={key} at={at} x={x} y={y + 0.05} z={z} color="#d6cfc4" n={8} power={0.45} life={500} gravity={3} /> : null;
          case "bounce":
            return (
              <group key={key}>
                <Ring at={at} x={x} y={y} z={z} color="#4ade80" radius={1.3} life={450} />
                <Ring at={at + 90} x={x} y={y} z={z} color="#ffffff" radius={0.9} life={380} />
              </group>
            );
          case "shove":
            return <Fan key={key} at={at} x={x} y={y} z={z} face={it.face ?? 0} color={SEAT_COLORS[ev.s % 6]} />;
          case "hit":
            return <Burst key={key} at={at} x={ev.x} y={ev.y} z={ev.z} color="#fde047" n={9} power={0.7} life={500} gravity={2} />;
          case "block":
            return <Ring key={key} at={at} x={x} y={y + 0.7} z={z} color="#93c5fd" radius={1} life={500} />;
          case "break":
          case "gone":
            return <Burst key={key} at={at} x={x} y={y - 0.1} z={z} color={ev.k === "gone" ? "#6b5b4b" : "#a8916f"} n={10} power={0.7} geo={chunkGeo} life={900} gravity={12} />;
          case "rock":
            return (
              <group key={key}>
                <Ring at={at} x={ev.x} y={ev.y} z={ev.z} color="#fca5a5" radius={ROCK_R * 1.8} life={500} />
                <Burst at={at} x={ev.x} y={ev.y + 0.1} z={ev.z} color="#78716c" n={12} power={0.9} geo={chunkGeo} life={800} gravity={10} />
              </group>
            );
          case "pick":
            return <Burst key={key} at={at} x={x} y={y + 0.8} z={z} color={ITEM_INFO[ev.kind].color} n={12} power={0.7} life={650} gravity={2} />;
          case "finish":
            return <Burst key={key} at={at} x={x} y={y + 1.2} z={z} color={SEAT_COLORS[ev.s % 6]} n={26} power={1.4} geo={confettiGeo} life={1700} gravity={3} />;
          case "caught":
            return <Burst key={key} at={at} x={x} y={y} z={z} color="#57534e" n={14} power={1} life={1000} gravity={-1} />;
          default:
            return null;
        }
      })}
    </>
  );
}
