"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import ScreenSprite from "@/games/shared/three/ScreenSprite";
import { labelTexture } from "@/games/shared/three/tableKit";
import type { SelfFrame } from "../sim";
import type { SelfMeta } from "../show";

/**
 * 캣버글러 도둑 — 검은 터틀넥 · 좌석 색 비니/줄무늬/장갑 · 도미노 가면(눈빛) · 등에 자루.
 * 팔다리는 골반·어깨 피벗에서 흔들리는 걷기 동작, 보석을 들면 두 팔로 머리 위에 받쳐 든다.
 * 유령(지난 루프의 자아)은 좌석 색으로 은은히 빛나는 반투명 홀로그램처럼 일렁인다.
 * 기하는 모듈에서 한 번만 만들어 모든 도둑이 공유한다(재질만 도둑마다).
 */

const G = {
  leg: new THREE.CapsuleGeometry(0.048, 0.2, 4, 10),
  shoe: new THREE.BoxGeometry(0.085, 0.05, 0.14),
  torso: new THREE.CapsuleGeometry(0.115, 0.15, 6, 16),
  stripe: new THREE.TorusGeometry(0.117, 0.012, 6, 24),
  belt: new THREE.TorusGeometry(0.108, 0.02, 6, 24),
  buckle: new THREE.BoxGeometry(0.05, 0.035, 0.02),
  arm: new THREE.CapsuleGeometry(0.036, 0.18, 4, 8),
  glove: new THREE.SphereGeometry(0.045, 10, 8),
  neck: new THREE.CylinderGeometry(0.068, 0.078, 0.07, 14),
  head: new THREE.SphereGeometry(0.128, 20, 16),
  beanie: new THREE.SphereGeometry(0.136, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
  cuff: new THREE.CylinderGeometry(0.139, 0.139, 0.045, 20),
  pom: new THREE.SphereGeometry(0.034, 10, 8),
  mask: new THREE.CylinderGeometry(0.132, 0.13, 0.052, 20, 1, true, -1.35, 2.7),
  eye: new THREE.SphereGeometry(0.02, 8, 6),
  sack: new THREE.SphereGeometry(0.1, 12, 10),
  tie: new THREE.CylinderGeometry(0.025, 0.035, 0.05, 8),
  shadow: new THREE.CircleGeometry(0.26, 24),
  ring: new THREE.RingGeometry(0.3, 0.4, 32),
  gem: new THREE.OctahedronGeometry(0.11, 0),
};

const SUIT = "#1d2130";
const PANTS = "#262a3a";
const SKIN = "#f1cfae";

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
      suit: mk(SUIT, { roughness: 0.85 }),
      pants: mk(PANTS, { roughness: 0.9 }),
      accent: mk(color, { roughness: 0.55 }),
      skin: mk(SKIN, { roughness: 0.6 }),
      mask: mk("#07090f", { roughness: 0.35, side: THREE.DoubleSide }),
      metal: mk("#e5c07b", { metalness: 0.8, roughness: 0.3 }),
      sack: mk("#7a5a40", { roughness: 0.95 }),
      eye: new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: ghost, opacity: ghost ? 0.6 : 1 }),
      shadow: new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: ghost ? 0.12 : 0.3, depthWrite: false }),
    };
  }, [color, ghost]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  return mats;
}

export function Thief3D({ s, meta, at, k, carrying }: { s: SelfFrame; meta: SelfMeta; at: [number, number, number]; k: number; carrying: boolean }) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const gem = useRef<THREE.Mesh>(null);
  const anim = useRef({ phase: 0, amt: 0, carry: 0, seed: (meta.seat * 7 + meta.loop * 3) % 11 });
  const ghost = !meta.live;
  const mats = useThiefMaterials(meta.color, ghost);

  // 들키면 강조색이 경고 빨강으로
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
    a.amt = damp(a.amt, moving ? 1 : 0, moving ? 14 : 8, dt);
    a.phase += dt * (moving ? 13 : 0);
    a.carry = damp(a.carry, carrying ? 1 : 0, 9, dt);
    const swing = Math.sin(a.phase) * 0.75 * a.amt;
    const t = clock.elapsedTime + a.seed;

    if (legL.current) legL.current.rotation.x = swing;
    if (legR.current) legR.current.rotation.x = -swing;
    // 팔: 걸을 땐 다리와 반대로 흔들고, 보석을 들면 머리 위로 받쳐 든다
    const armSwing = -swing * 0.8 * (1 - a.carry);
    const lift = -2.6 * a.carry;
    if (armL.current) {
      armL.current.rotation.x = armSwing + lift;
      armL.current.rotation.z = -0.12 - 0.25 * a.carry;
    }
    if (armR.current) {
      armR.current.rotation.x = -armSwing + lift;
      armR.current.rotation.z = 0.12 + 0.25 * a.carry;
    }
    if (body.current) {
      // 살금살금: 걸을 때 몸을 살짝 숙이고 통통 튐, 서 있으면 숨쉬기
      body.current.position.y = Math.abs(Math.sin(a.phase)) * 0.035 * a.amt + Math.sin(t * 2.2) * 0.006 + (ghost ? Math.sin(t * 1.7) * 0.02 + 0.02 : 0);
      body.current.rotation.x = 0.16 * a.amt;
    }
    if (head.current) head.current.rotation.y = Math.sin(t * 0.9) * 0.25 * (1 - a.amt) * (ok ? 1 : 0);
    if (gem.current) gem.current.rotation.y += dt * 2;

    const scale = s.status === "paradox" ? 0.001 : 1;
    g.scale.setScalar(damp(g.scale.x, scale, s.status === "paradox" ? 4 : 10, dt));
    g.rotation.x = damp(g.rotation.x, s.status === "caught" ? -1.2 : 0, 6, dt);
    if (s.status === "paradox") g.rotation.y += dt * 14;
    if (ghost) {
      // 홀로그램처럼 은은한 일렁임
      const flicker = 0.36 + Math.sin(t * 6.3) * 0.04 + (Math.sin(t * 23) > 0.97 ? -0.15 : 0);
      for (const m of [mats.suit, mats.pants, mats.accent, mats.skin, mats.mask, mats.sack, mats.metal]) m.opacity = flicker;
    }
  });

  return (
    <group ref={root} position={[at[0], 0, at[2]]}>
      <mesh geometry={G.shadow} material={mats.shadow} position={[0, 0.012, 0]} rotation-x={-Math.PI / 2} />
      {meta.live && (
        <mesh geometry={G.ring} position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}>
          <meshBasicMaterial color="#fde047" transparent opacity={0.95} />
        </mesh>
      )}
      <group ref={body}>
        {/* 다리 */}
        {([
          [legL, -0.068],
          [legR, 0.068],
        ] as const).map(([ref, x]) => (
          <group key={x} ref={ref} position={[x, 0.34, 0]}>
            <mesh geometry={G.leg} material={mats.pants} position={[0, -0.15, 0]} />
            <mesh geometry={G.shoe} material={mats.mask} position={[0, -0.305, 0.025]} />
          </group>
        ))}
        {/* 몸통 + 줄무늬 + 벨트 */}
        <group position={[0, 0.5, 0]} scale={[1, 1, 0.82]}>
          <mesh geometry={G.torso} material={mats.suit} />
          <mesh geometry={G.stripe} material={mats.accent} position={[0, 0.06, 0]} rotation-x={Math.PI / 2} />
          <mesh geometry={G.stripe} material={mats.accent} position={[0, 0.0, 0]} rotation-x={Math.PI / 2} />
          <mesh geometry={G.belt} material={mats.pants} position={[0, -0.11, 0]} rotation-x={Math.PI / 2} />
        </group>
        <mesh geometry={G.buckle} material={mats.metal} position={[0, 0.39, 0.098]} />
        {/* 등 자루 */}
        <mesh geometry={G.sack} material={mats.sack} position={[0, 0.53, -0.14]} scale={[1, 1.1, 0.75]} />
        <mesh geometry={G.tie} material={mats.sack} position={[0, 0.64, -0.13]} />
        {/* 팔 */}
        {([
          [armL, -0.148],
          [armR, 0.148],
        ] as const).map(([ref, x]) => (
          <group key={x} ref={ref} position={[x, 0.61, 0]}>
            <mesh geometry={G.arm} material={mats.suit} position={[0, -0.12, 0]} />
            <mesh geometry={G.glove} material={mats.accent} position={[0, -0.245, 0]} />
          </group>
        ))}
        {/* 머리 */}
        <mesh geometry={G.neck} material={mats.suit} position={[0, 0.67, 0]} />
        <group ref={head} position={[0, 0.8, 0]}>
          <mesh geometry={G.head} material={mats.skin} />
          <mesh geometry={G.beanie} material={mats.accent} position={[0, 0.03, 0]} />
          <mesh geometry={G.cuff} material={mats.accent} position={[0, 0.035, 0]} />
          <mesh geometry={G.pom} material={mats.accent} position={[0, 0.17, 0]} />
          <mesh geometry={G.mask} material={mats.mask} position={[0, -0.015, 0]} />
          <mesh geometry={G.eye} material={mats.eye} position={[-0.046, -0.012, 0.118]} />
          <mesh geometry={G.eye} material={mats.eye} position={[0.046, -0.012, 0.118]} />
        </group>
        {carrying && (
          <mesh ref={gem} geometry={G.gem} position={[0, 1.08, 0.04]}>
            <meshStandardMaterial color="#67e8f9" emissive="#22d3ee" emissiveIntensity={0.8} metalness={0.3} roughness={0.12} transparent={ghost} opacity={ghost ? 0.6 : 1} />
          </mesh>
        )}
      </group>
      <ScreenSprite position={[0, carrying ? 1.38 : 1.22, 0]} scale={meta.live ? [0.9, 0.225] : [0.6, 0.15]} map={labelTexture(meta.live ? "▼ 나" : meta.short, meta.color)} />
    </group>
  );
}
