"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import ScreenSprite from "@/games/shared/three/ScreenSprite";
import { resolveLook } from "@/games/shared/three/SeatedPerson";
import { labelTexture } from "@/games/shared/three/tableKit";
import VrmBody, { BODY, addWalk, setBone } from "@/games/shared/three/VrmBody";
import { roomCharacterOf, useRoomCharacters } from "@/lib/character/roomCharacters";
import type { SelfFrame } from "../sim";
import type { SelfMeta } from "../show";

/**
 * 캣버글러 도둑 — 각 플레이어의 VRM 캐릭터(다른 3D 게임과 같은 내 캐릭터)에 좌석 색 비니 + 등에 자루.
 * 걸을 땐 몸을 살짝 숙이고 살금살금, 보석을 들면 두 팔로 머리 위에 받쳐 든다.
 * 유령(지난 루프의 자아)은 같은 캐릭터가 좌석 색으로 은은히 빛나는 반투명 홀로그램처럼 일렁인다.
 */

const G = {
  beanie: new THREE.SphereGeometry(0.118, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
  cuff: new THREE.TorusGeometry(0.116, 0.018, 8, 24),
  pom: new THREE.SphereGeometry(0.035, 10, 8),
  sack: new THREE.SphereGeometry(0.13, 12, 10),
  tie: new THREE.CylinderGeometry(0.03, 0.04, 0.06, 8),
  shadow: new THREE.CircleGeometry(0.26, 24),
  ring: new THREE.RingGeometry(0.3, 0.4, 32),
  gem: new THREE.OctahedronGeometry(0.11, 0),
  silhouette: new THREE.CapsuleGeometry(0.12, 0.5, 4, 10),
};

/** 머리뼈 높이(≈턱) — 예전 인형(머리 중심 0.8)과 같은 키 */
const HEAD_Y = 0.74;

const FACE_ROT: Record<SelfFrame["face"], number> = { E: Math.PI / 2, W: -Math.PI / 2, N: Math.PI, S: 0 };

function damp(cur: number, target: number, k: number, dt: number) {
  return cur + (target - cur) * (1 - Math.exp(-k * dt));
}

/** 가장 가까운 쪽으로 돌기 (W↔E 사이 360° 휙 도는 것 방지) */
function dampAngle(cur: number, target: number, k: number, dt: number) {
  let d = target - cur;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return cur + d * (1 - Math.exp(-k * dt));
}

function useThiefMaterials(color: string, ghost: boolean) {
  const mats = useMemo(() => {
    const mk = (c: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
      new THREE.MeshStandardMaterial({
        color: c,
        roughness: 0.7,
        ...extra,
        ...(ghost ? { transparent: true, opacity: 0.42, depthWrite: false, emissive: new THREE.Color(color), emissiveIntensity: 0.38 } : {}),
      });
    return {
      accent: mk(color, { roughness: 0.8 }),
      sack: mk("#7a5a40", { roughness: 0.95 }),
      shadow: new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: ghost ? 0.12 : 0.3, depthWrite: false }),
      silhouette: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false }),
    };
  }, [color, ghost]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  return mats;
}

export function Thief3D({ s, meta, at, k, carrying, lowDetail = false }: { s: SelfFrame; meta: SelfMeta; at: [number, number, number]; k: number; carrying: boolean; lowDetail?: boolean }) {
  const root = useRef<THREE.Group>(null);
  const gem = useRef<THREE.Mesh>(null);
  const anim = useRef({ phase: 0, amt: 0, carry: 0, seed: (meta.seat * 7 + meta.loop * 3) % 11, ok: true, caught: false });
  const alpha = useRef(0.4);
  const ghost = !meta.live;
  const mats = useThiefMaterials(meta.color, ghost);
  const profile = useRoomCharacters((st) => roomCharacterOf(st.byName, meta.name));
  const look = useMemo(() => resolveLook(meta.seat, ["none"], profile), [meta.seat, profile]);
  const ghostSpec = useMemo(() => (ghost ? { color: meta.color, alpha } : null), [ghost, meta.color]);

  // 들키면 강조색(비니)이 경고 빨강으로
  useEffect(() => {
    mats.accent.color.set(s.status === "caught" ? "#ef4444" : meta.color);
    if (ghost) mats.accent.emissive.set(s.status === "caught" ? "#ef4444" : meta.color);
  }, [mats, s.status, meta.color, ghost]);

  useFrame(({ clock }, rawDt) => {
    const g = root.current;
    if (!g) return;
    const dt = Math.min(rawDt, 0.1);
    const a = anim.current;
    const dx = at[0] - g.position.x;
    const dz = at[2] - g.position.z;
    const dist = Math.hypot(dx, dz);
    g.position.x = damp(g.position.x, at[0], k, dt);
    g.position.z = damp(g.position.z, at[2], k, dt);
    g.rotation.y = dampAngle(g.rotation.y, FACE_ROT[s.face], 12, dt);

    const ok = s.status === "ok";
    const moving = ok && dist > 0.04;
    a.ok = ok;
    a.caught = s.status === "caught";
    a.amt = damp(a.amt, moving ? 1 : 0, moving ? 14 : 8, dt);
    a.phase += dt * (moving ? 13 : 0);
    a.carry = damp(a.carry, carrying ? 1 : 0, 9, dt);
    const t = clock.elapsedTime + a.seed;
    if (gem.current) gem.current.rotation.y += dt * 2;

    const scale = s.status === "paradox" ? 0.001 : 1;
    g.scale.setScalar(damp(g.scale.x, scale, s.status === "paradox" ? 4 : 10, dt));
    g.rotation.x = damp(g.rotation.x, s.status === "caught" ? -1.2 : 0, 6, dt);
    if (s.status === "paradox") g.rotation.y += dt * 14;
    if (ghost) {
      // 홀로그램처럼 은은한 일렁임
      const flicker = 0.4 + Math.sin(t * 6.3) * 0.05 + (Math.sin(t * 23) > 0.97 ? -0.15 : 0);
      alpha.current = flicker;
      for (const m of [mats.accent, mats.sack]) m.opacity = flicker;
    }
  });

  const pose = (o: Float32Array, time: number) => {
    const a = anim.current;
    const t = time + a.seed;
    addWalk(o, a.phase, a.amt);
    // 살금살금: 걸을 때 몸을 살짝 숙임, 서 있으면 두리번
    o[BODY.spine] += 0.18 * a.amt + Math.sin(t * 2.2) * 0.015;
    o[BODY.head + 1] = Math.sin(t * 0.9) * 0.35 * (1 - a.amt) * (a.ok ? 1 : 0);
    // 보석을 들면 두 팔을 머리 위로
    const c = a.carry;
    if (c > 0.01) {
      for (const [arm, low, out] of [
        ["rightUpperArm", "rightLowerArm", -1],
        ["leftUpperArm", "leftLowerArm", 1],
      ] as const) {
        const u = BODY[arm];
        o[u] = o[u] * (1 - c) - 2.75 * c;
        o[u + 2] = o[u + 2] * (1 - c) + out * 0.32 * c;
        o[BODY[low]] = o[BODY[low]] * (1 - c) - 0.55 * c;
      }
    }
    if (a.caught) {
      // 화들짝 두 손 번쩍
      setBone(o, "rightUpperArm", -2.6, 0, -0.6);
      setBone(o, "leftUpperArm", -2.6, 0, 0.6);
      setBone(o, "rightLowerArm", -0.4);
      setBone(o, "leftLowerArm", -0.4);
    }
  };
  const face = () => {
    const a = anim.current;
    return a.caught ? { surprised: 1 } : { happy: a.carry * 0.7 };
  };

  return (
    <group ref={root} position={[at[0], 0, at[2]]}>
      <mesh geometry={G.shadow} material={mats.shadow} position={[0, 0.012, 0]} rotation-x={-Math.PI / 2} />
      {meta.live && (
        <mesh geometry={G.ring} position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}>
          <meshBasicMaterial color="#fde047" transparent opacity={0.95} />
        </mesh>
      )}
      <VrmBody
        look={look}
        seed={meta.seat * 5 + meta.loop}
        headY={HEAD_Y}
        pose={pose}
        face={face}
        lowDetail={lowDetail}
        ghost={ghostSpec}
        head={
          <group position={[0, 0, -0.01]}>
            <mesh geometry={G.beanie} material={mats.accent} />
            <mesh geometry={G.cuff} material={mats.accent} rotation-x={Math.PI / 2} position={[0, 0.005, 0]} />
            <mesh geometry={G.pom} material={mats.accent} position={[0, 0.125, 0]} />
          </group>
        }
        back={
          <group position={[0, 0.02, -0.2]}>
            <mesh geometry={G.sack} material={mats.sack} scale={[1, 1.1, 0.75]} />
            <mesh geometry={G.tie} material={mats.sack} position={[0, 0.15, 0.01]} />
          </group>
        }
        fallback={<mesh geometry={G.silhouette} material={mats.silhouette} position={[0, 0.37, 0]} />}
      />
      {carrying && (
        <mesh ref={gem} geometry={G.gem} position={[0, 1.12, 0.04]}>
          <meshStandardMaterial color="#67e8f9" emissive="#22d3ee" emissiveIntensity={0.8} metalness={0.3} roughness={0.12} transparent={ghost} opacity={ghost ? 0.6 : 1} />
        </mesh>
      )}
      <ScreenSprite position={[0, carrying ? 1.42 : 1.22, 0]} scale={meta.live ? [0.9, 0.225] : [0.6, 0.15]} map={labelTexture(meta.live ? "▼ 나" : meta.short, meta.color)} />
    </group>
  );
}
