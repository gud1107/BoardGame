"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GUST_R, ITEM_INFO, POUND_R, SEAT_COLORS, SHOCK_R } from "../data";
import type { GameEvent } from "../sim";

/**
 * 3D 연출 (룰북 §11): 부딪힘 고리+불꽃, 착지 충격파, 충격파 아이템, 유령 입김,
 * 범퍼 기둥, 아이템 줍기 반짝임, 추락한 자리 아래 구름 퍼프.
 * 각 연출은 시작 시각(`at`, performance.now ms)부터 스스로 애니메이션하고 수명이 끝나면 숨는다.
 */

export interface FxItem {
  ev: GameEvent;
  at: number;
}

export const FX_LIFE_MS = 1400;

const ringGeo = new THREE.RingGeometry(0.82, 1, 40);
const sparkGeo = new THREE.SphereGeometry(0.06, 6, 4);

function Ring({ at, x, z, y = 0.08, color, radius, life = 520, width = 1 }: { at: number; x: number; z: number; y?: number; color: string; radius: number; life?: number; width?: number }) {
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
    m.scale.set(radius * (0.25 + e * 0.75), radius * (0.25 + e * 0.75), 1);
    mat.current.opacity = (1 - u) * 0.85;
  });
  return (
    <mesh ref={ref} geometry={ringGeo} position={[x, y, z]} rotation-x={-Math.PI / 2} scale={[width, width, 1]}>
      <meshBasicMaterial ref={mat} color={color} transparent depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

function Sparks({ at, x, z, y = 0.8, color, n, power }: { at: number; x: number; z: number; y?: number; color: string; n: number; power: number }) {
  const group = useRef<THREE.Group>(null);
  const dirs = useMemo(
    () =>
      Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 + Math.sin(at + i * 7.1) * 0.4;
        const up = 0.4 + Math.abs(Math.sin(at * 0.37 + i * 3.3)) * 1.1;
        const sp = (0.6 + Math.abs(Math.cos(at * 0.11 + i)) * 0.8) * power;
        return new THREE.Vector3(Math.cos(a) * sp, up * power, Math.sin(a) * sp);
      }),
    [at, n, power],
  );
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const u = (performance.now() - at) / 1000;
    if (u > 0.6 || u < 0) {
      g.visible = false;
      return;
    }
    g.visible = true;
    g.children.forEach((c, i) => {
      const d = dirs[i];
      c.position.set(d.x * u * 3, d.y * u * 3 - 9 * u * u, d.z * u * 3);
      c.scale.setScalar(Math.max(0.01, 1 - u / 0.6));
    });
  });
  return (
    <group ref={group} position={[x, y, z]}>
      {dirs.map((_, i) => (
        <mesh key={i} geometry={sparkGeo}>
          <meshBasicMaterial color={i % 3 === 0 ? "#ffffff" : color} />
        </mesh>
      ))}
    </group>
  );
}

/** 떨어진 자리 아래에서 피어오르는 구름 퍼프 */
function Puff({ at, x, z, color }: { at: number; x: number; z: number; color: string }) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const u = (performance.now() - at - 500) / 900;
    if (u > 1 || u < 0) {
      g.visible = false;
      return;
    }
    g.visible = true;
    g.scale.setScalar(0.5 + u * 1.6);
    g.children.forEach((c) => {
      const m = (c as THREE.Mesh).material as THREE.MeshBasicMaterial;
      m.opacity = (1 - u) * 0.7;
    });
  });
  return (
    <group ref={group} position={[x, -6.5, z]}>
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} position={[Math.cos(i * 1.3) * 0.7, Math.sin(i * 2.1) * 0.3, Math.sin(i * 1.3) * 0.7]}>
          <sphereGeometry args={[0.7, 10, 8]} />
          <meshBasicMaterial color={i === 0 ? color : "#ffffff"} transparent depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/** 유령 입김: 바라보는 쪽으로 흩날리는 바람 줄기 */
function Gust({ at, x, z, fx, fz }: { at: number; x: number; z: number; fx: number; fz: number }) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const u = (performance.now() - at) / 700;
    if (u > 1 || u < 0) {
      g.visible = false;
      return;
    }
    g.visible = true;
    g.children.forEach((c, i) => {
      const k = u * (1.4 + i * 0.25) * GUST_R;
      const side = (i - 2) * 0.35;
      c.position.set(fx * k - fz * side, 0.6 + Math.sin(u * 8 + i) * 0.15, fz * k + fx * side);
      ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = (1 - u) * 0.6;
    });
  });
  return (
    <group ref={group} position={[x, 0, z]}>
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} rotation-y={Math.atan2(fx, fz)}>
          <boxGeometry args={[0.06, 0.06, 0.7]} />
          <meshBasicMaterial color="#e0f2fe" transparent depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

export function FxLayer({ items }: { items: FxItem[] }) {
  return (
    <>
      {items.map(({ ev, at }) => {
        const key = ev.id;
        switch (ev.k) {
          case "hit": {
            const strong = ev.p > 6;
            const c = SEAT_COLORS[ev.a % 6];
            return (
              <group key={key}>
                <Ring at={at} x={ev.x} z={ev.z} y={0.7} color={strong ? "#fff7cc" : "#ffffff"} radius={0.6 + Math.min(1.6, ev.p * 0.14)} life={360} />
                <Sparks at={at} x={ev.x} z={ev.z} color={c} n={strong ? 14 : 7} power={0.6 + Math.min(1.4, ev.p * 0.1)} />
              </group>
            );
          }
          case "land":
            return <Ring key={key} at={at} x={ev.x} z={ev.z} color={SEAT_COLORS[ev.s % 6]} radius={POUND_R} life={480} />;
          case "shock":
            return (
              <group key={key}>
                <Ring at={at} x={ev.x} z={ev.z} color={ITEM_INFO.shock.color} radius={SHOCK_R} life={520} />
                <Ring at={at + 90} x={ev.x} z={ev.z} y={0.5} color="#ffffff" radius={SHOCK_R * 0.8} life={460} />
                <Sparks at={at} x={ev.x} z={ev.z} color={ITEM_INFO.shock.color} n={16} power={1.6} />
              </group>
            );
          case "post":
            return <Ring key={key} at={at} x={ev.x} z={ev.z} y={0.6} color="#fde047" radius={0.9} life={300} />;
          case "pick":
            return <Sparks key={key} at={at} x={ev.x} z={ev.z} y={0.5} color={ITEM_INFO[ev.kind].color} n={12} power={0.8} />;
          case "block":
            return null;
          case "gust":
            return <Gust key={key} at={at} x={ev.x} z={ev.z} fx={ev.fx} fz={ev.fz} />;
          case "fall":
            return null;
          default:
            return null;
        }
      })}
    </>
  );
}

/** 추락 퍼프는 떨어진 위치가 이벤트에 없어서 보드가 몸 위치를 붙여 넘긴다 */
export function FallPuffs({ items }: { items: { id: number; at: number; x: number; z: number; seat: number }[] }) {
  return (
    <>
      {items.map((p) => (
        <Puff key={p.id} at={p.at} x={p.x} z={p.z} color={SEAT_COLORS[p.seat % 6]} />
      ))}
    </>
  );
}
