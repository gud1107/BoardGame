"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { FROST_R, ITEM_INFO, KNOCK_R, SEAT_COLORS, WATER_Y } from "../data";
import { lakeGeo, sectorAngle } from "../lake";
import type { GameEvent } from "../sim";

/**
 * 3D 연출 (룰북 §11): 내려찍기 충격 고리+얼음 조각, 칸 깨짐 조각, 첨벙 물보라, 아이템 반짝임,
 * ❄️ 냉기 고리, 해빙 김(구역 위로 피어오름), 몸 부딪힘 불꽃.
 * 각 연출은 시작 시각(`at`, performance.now ms)부터 스스로 움직이고 수명이 끝나면 숨는다.
 */

export interface FxItem {
  ev: GameEvent;
  at: number;
  /** 깨진 칸·해빙 구역처럼 위치가 이벤트에 없을 때 보드가 붙여 준다 */
  x?: number;
  z?: number;
  rings?: number;
}

export const FX_LIFE_MS = 1600;

const ringGeo = new THREE.RingGeometry(0.82, 1, 40);
const shardGeo = new THREE.TetrahedronGeometry(0.11, 0);
const dropGeo = new THREE.SphereGeometry(0.07, 6, 4);
const puffGeo = new THREE.SphereGeometry(0.5, 10, 8);

function Ring({ at, x, z, y = 0.04, color, radius, life = 520 }: { at: number; x: number; z: number; y?: number; color: string; radius: number; life?: number }) {
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
    <mesh ref={ref} geometry={ringGeo} position={[x, y, z]} rotation-x={-Math.PI / 2}>
      <meshBasicMaterial ref={mat} color={color} transparent depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** 튀는 조각 (얼음 조각·물방울·불꽃) — 포물선으로 날아가며 작아진다 */
function Burst({ at, x, z, y = 0.1, color, n, power, geo = shardGeo, life = 700, gravity = 9 }: { at: number; x: number; z: number; y?: number; color: string; n: number; power: number; geo?: THREE.BufferGeometry; life?: number; gravity?: number }) {
  const group = useRef<THREE.Group>(null);
  const dirs = useMemo(
    () =>
      Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 + Math.sin(at * 0.013 + i * 7.1) * 0.5;
        const up = 0.6 + Math.abs(Math.sin(at * 0.37 + i * 3.3)) * 1.2;
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
          <meshStandardMaterial color={i % 3 === 0 ? "#ffffff" : color} roughness={0.2} metalness={0.1} transparent opacity={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/** 해빙 김: 구역 위로 하얀 김이 피어오른다 */
function Steam({ at, sector, rings }: { at: number; sector: number; rings: number }) {
  const group = useRef<THREE.Group>(null);
  const spots = useMemo(() => {
    const geo = lakeGeo(rings);
    return geo.bySector[sector].filter((_, k) => k % 3 === 0).map((i) => geo.tiles[i]);
  }, [sector, rings]);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const u = (performance.now() - at) / 1600;
    if (u > 1 || u < 0) {
      g.visible = false;
      return;
    }
    g.visible = true;
    g.children.forEach((c, i) => {
      const k = Math.min(1, u * 1.3 + (i % 4) * 0.05);
      c.position.y = 0.2 + k * 1.6;
      c.scale.setScalar(0.4 + k * 1.1);
      ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = (1 - u) * 0.45;
    });
  });
  return (
    <group ref={group}>
      {spots.map((t, i) => (
        <mesh key={i} geometry={puffGeo} position={[t.x, 0.2, t.z]}>
          <meshBasicMaterial color="#f8fafc" transparent depthWrite={false} />
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
          case "slam":
            return (
              <group key={key}>
                <Ring at={at} x={ev.x} z={ev.z} color={SEAT_COLORS[ev.s % 6]} radius={KNOCK_R} life={460} />
                <Ring at={at + 70} x={ev.x} z={ev.z} y={0.06} color="#ffffff" radius={KNOCK_R * 0.7} life={420} />
                <Burst at={at} x={ev.x} z={ev.z} color="#cfeaff" n={14} power={1.3} />
              </group>
            );
          case "break":
            return it.x !== undefined && it.z !== undefined ? <Burst key={key} at={at} x={it.x} z={it.z} y={0} color="#bfe3fb" n={8} power={0.8} life={650} /> : null;
          case "splash":
            return (
              <group key={key}>
                <Ring at={at} x={ev.x} z={ev.z} y={WATER_Y + 0.03} color="#e0f2fe" radius={1.6} life={900} />
                <Ring at={at + 200} x={ev.x} z={ev.z} y={WATER_Y + 0.03} color="#bae6fd" radius={2.4} life={1100} />
                <Burst at={at} x={ev.x} z={ev.z} y={WATER_Y} color="#93c5fd" n={18} power={1.5} geo={dropGeo} life={900} gravity={12} />
              </group>
            );
          case "pick":
            return (
              <group key={key}>
                <Burst at={at} x={ev.x} z={ev.z} y={0.5} color={ITEM_INFO[ev.kind].color} n={12} power={0.8} geo={dropGeo} />
                {ev.kind === "frost" && <Ring at={at} x={ev.x} z={ev.z} y={0.05} color="#7dd3fc" radius={FROST_R} life={700} />}
              </group>
            );
          case "bump":
            return <Burst key={key} at={at} x={ev.x} z={ev.z} y={0.8} color="#fde68a" n={6} power={0.5} geo={dropGeo} life={400} />;
          case "thaw":
            return it.rings ? <Steam key={key} at={at} sector={ev.sector} rings={it.rings} /> : null;
          default:
            return null;
        }
      })}
    </>
  );
}

/** 구역 가운데 근처 한 점 (유령이 떠 있을 자리 등) */
export function sectorPoint(sector: number, rings: number, frac = 0.55): { x: number; z: number } {
  const a = sectorAngle(sector);
  const r = lakeGeo(rings).radius * frac;
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}
