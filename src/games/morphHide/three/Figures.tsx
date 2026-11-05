"use client";

import { useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";

/**
 * 저폴리 캐릭터 — VRM 없이 상자·구로 만든 사람/점검원(술래)/강아지/고양이/청소기/자동차.
 * 몸짓은 `anim` 문자열 하나로 정해지고 useFrame에서 관절 각도만 바꾼다(가볍다).
 * 원점 = 발바닥 가운데, +z = 앞.
 */

type V3 = [number, number, number];

const SHIRTS = ["#e76f51", "#2a9d8f", "#e9c46a", "#8ab17d", "#f4a261", "#9b5de5", "#00bbf9", "#f15bb5"];
const PANTS = ["#264653", "#3d405b", "#5c4033", "#22223b", "#4a4e69", "#2b2d42", "#6c584c", "#1d3557"];
const SKIN = ["#f1c27d", "#e0ac69", "#c68642", "#ffdbac", "#8d5524", "#f5d0a9", "#d1a17a", "#e8b98a"];
const HAIR = ["#2b1d14", "#5a3825", "#111", "#c19a6b", "#7b3f00", "#d4af37", "#333", "#8b4513"];

function B({ p, s, c, r }: { p: V3; s: V3; c: string; r?: V3 }) {
  return (
    <mesh position={p} rotation={r}>
      <boxGeometry args={s} />
      <meshStandardMaterial color={c} roughness={0.75} />
    </mesh>
  );
}

function S({ p, r, c }: { p: V3; r: number; c: string }) {
  return (
    <mesh position={p}>
      <sphereGeometry args={[r, 12, 10]} />
      <meshStandardMaterial color={c} roughness={0.7} />
    </mesh>
  );
}

export type WeaponLook = "hand" | "hammer" | "sling" | "pistol" | "shotgun" | "sniper" | "flashlight" | null;

function HeldItem({ kind }: { kind: WeaponLook }) {
  switch (kind) {
    case "hammer":
      return (
        <group position={[0, -0.32, 0.08]} rotation={[Math.PI / 2, 0, 0]}>
          <B p={[0, 0, 0.18]} s={[0.05, 0.05, 0.4]} c="#f2c14e" />
          <B p={[0, 0, 0.4]} s={[0.22, 0.14, 0.14]} c="#e63946" />
        </group>
      );
    case "sling":
      return <B p={[0, -0.32, 0.12]} s={[0.04, 0.2, 0.12]} c="#8d6e63" />;
    case "pistol":
      return <B p={[0, -0.3, 0.12]} s={[0.07, 0.12, 0.28]} c="#222" />;
    case "shotgun":
      return <B p={[0, -0.3, 0.3]} s={[0.08, 0.1, 0.7]} c="#4e342e" />;
    case "sniper":
      return (
        <group position={[0, -0.3, 0.35]}>
          <B p={[0, 0, 0]} s={[0.07, 0.1, 0.95]} c="#2f3e46" />
          <B p={[0, 0.09, 0.05]} s={[0.06, 0.06, 0.25]} c="#111" />
        </group>
      );
    case "flashlight":
      return (
        <group position={[0, -0.3, 0.1]}>
          <B p={[0, 0, 0]} s={[0.06, 0.06, 0.22]} c="#333" />
          <mesh position={[0, 0, 0.12]}>
            <sphereGeometry args={[0.045, 8, 6]} />
            <meshBasicMaterial color="#fff6c2" toneMapped={false} />
          </mesh>
        </group>
      );
    default:
      return null;
  }
}

/** 사람 (행인·점검원·술래) */
export function Humanoid({ anim, look = 0, uniform = false, held = null, scale = 1, children }: { anim: string; look?: number; uniform?: boolean; held?: WeaponLook; scale?: number; children?: ReactNode }) {
  const root = useRef<THREE.Group>(null);
  const hips = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const kneeL = useRef<THREE.Group>(null);
  const kneeR = useRef<THREE.Group>(null);
  const shirt = uniform ? "#1f3a5f" : SHIRTS[look % SHIRTS.length];
  const pants = uniform ? "#14213d" : PANTS[(look * 3) % PANTS.length];
  const skin = SKIN[(look * 5) % SKIN.length];
  const hair = HAIR[(look * 7) % HAIR.length];
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const g = { hipsY: 0.92, hipsRX: 0, torsoRX: 0, torsoRY: 0, torsoRZ: 0, headRX: 0, headRY: 0, aL: [0, 0, 0.08], aR: [0, 0, -0.08], lL: 0, lR: 0, kL: 0, kR: 0, rootRX: 0, rootY: 0 };
    const sw = (f: number, a: number, ph = 0) => Math.sin(t * f + ph) * a;
    switch (anim) {
      case "walk":
        g.lL = sw(7, 0.55);
        g.lR = -g.lL;
        g.kL = Math.max(0, -sw(7, 0.7));
        g.kR = Math.max(0, sw(7, 0.7));
        g.aL = [-g.lL * 0.8, 0, 0.08];
        g.aR = [-g.lR * 0.8, 0, -0.08];
        g.hipsY = 0.92 + Math.abs(sw(7, 0.03));
        break;
      case "run":
        g.lL = sw(12, 0.95);
        g.lR = -g.lL;
        g.kL = Math.max(0, -sw(12, 1.3)) + 0.2;
        g.kR = Math.max(0, sw(12, 1.3)) + 0.2;
        g.aL = [-g.lL * 1.1, 0, 0.12];
        g.aR = [-g.lR * 1.1, 0, -0.12];
        g.torsoRX = 0.25;
        g.hipsY = 0.9 + Math.abs(sw(12, 0.07));
        break;
      case "jump":
        g.lL = -0.6;
        g.lR = 0.3;
        g.kL = 1.0;
        g.kR = 0.6;
        g.aL = [-2.4, 0, 0.3];
        g.aR = [-2.4, 0, -0.3];
        break;
      case "sit":
        g.hipsY = 0.48;
        g.lL = -1.5;
        g.lR = -1.5;
        g.kL = 1.5;
        g.kR = 1.5;
        g.aL = [-0.4, 0, 0.1];
        g.aR = [-0.4, 0, -0.1];
        break;
      case "crouch":
        g.hipsY = 0.5;
        g.lL = -1.9;
        g.lR = -1.9;
        g.kL = 2.4;
        g.kR = 2.4;
        g.torsoRX = 0.45;
        g.aL = [-1.2, 0, 0.2];
        g.aR = [-1.2, 0, -0.2];
        break;
      case "lie":
        g.rootRX = -Math.PI / 2;
        g.rootY = 0.15;
        g.aL = [0, 0, 0.3];
        g.aR = [0, 0, -0.3];
        break;
      case "phone":
        g.aR = [-1.3, 0.3, -0.25];
        g.aL = [-0.9, -0.2, 0.2];
        g.headRX = 0.5;
        break;
      case "inspect":
      case "aim":
        // 손을 앞으로 쭉 — 술래가 뒤질 때 하는 그 동작
        g.aR = [-1.55 + sw(5, 0.08), 0, -0.05];
        g.aL = [anim === "aim" ? -1.45 : -1.2 + sw(4, 0.1, 1), 0, 0.15];
        g.torsoRX = anim === "aim" ? 0.05 : 0.2;
        g.headRX = 0.25;
        g.headRY = sw(1.8, 0.4);
        break;
      case "radio":
        g.aR = [-2.3, 0, -0.6];
        g.headRY = 0.3;
        break;
      case "wave":
        g.aR = [-2.8, 0, -0.4 + sw(10, 0.4)];
        break;
      case "dance":
        g.hipsY = 0.9 + Math.abs(sw(8, 0.08));
        g.torsoRZ = sw(4, 0.25);
        g.aL = [-2.6, 0, 0.6 + sw(8, 0.5)];
        g.aR = [-2.6, 0, -0.6 + sw(8, 0.5, 1)];
        g.lL = sw(8, 0.4);
        g.lR = sw(8, 0.4, Math.PI);
        break;
      case "laugh":
        g.torsoRX = -0.3 + sw(14, 0.1);
        g.headRX = -0.4;
        g.aL = [-0.5, 0, 0.6];
        g.aR = [-0.5, 0, -0.6];
        break;
      case "taunt":
        g.aL = [-1.8 + sw(9, 0.3), 0, 0.5];
        g.aR = [-1.8 + sw(9, 0.3, 1), 0, -0.5];
        g.torsoRY = sw(6, 0.4);
        g.hipsY = 0.92 + Math.abs(sw(9, 0.05));
        break;
      case "caught":
        g.rootRX = -Math.PI / 2.3;
        g.rootY = 0.1;
        break;
      default:
        g.aL = [sw(1.5, 0.04), 0, 0.08];
        g.aR = [sw(1.5, 0.04, 1), 0, -0.08];
        g.hipsY = 0.92 + sw(2, 0.006);
    }
    if (root.current) {
      root.current.rotation.x = g.rootRX;
      root.current.position.y = g.rootY;
    }
    if (hips.current) hips.current.position.y = g.hipsY;
    if (torso.current) torso.current.rotation.set(g.torsoRX, g.torsoRY, g.torsoRZ);
    if (head.current) head.current.rotation.set(g.headRX, g.headRY, 0);
    armL.current?.rotation.set(g.aL[0], g.aL[1], g.aL[2]);
    armR.current?.rotation.set(g.aR[0], g.aR[1], g.aR[2]);
    if (legL.current) legL.current.rotation.x = g.lL;
    if (legR.current) legR.current.rotation.x = g.lR;
    if (kneeL.current) kneeL.current.rotation.x = g.kL;
    if (kneeR.current) kneeR.current.rotation.x = g.kR;
  });
  const leg = (side: number, legRef: typeof legL, kneeRef: typeof kneeL) => (
    <group ref={legRef} position={[0.11 * side, 0, 0]}>
      <B p={[0, -0.22, 0]} s={[0.15, 0.44, 0.17]} c={pants} />
      <group ref={kneeRef} position={[0, -0.44, 0]}>
        <B p={[0, -0.21, 0]} s={[0.14, 0.42, 0.15]} c={pants} />
        <B p={[0, -0.44, 0.05]} s={[0.15, 0.07, 0.26]} c="#222" />
      </group>
    </group>
  );
  return (
    <group scale={scale}>
      <group ref={root}>
        <group ref={hips} position={[0, 0.92, 0]}>
          {leg(-1, legL, kneeL)}
          {leg(1, legR, kneeR)}
          <group ref={torso}>
            <B p={[0, 0.3, 0]} s={[0.42, 0.56, 0.24]} c={shirt} />
            {uniform && <B p={[0.11, 0.42, 0.125]} s={[0.1, 0.1, 0.02]} c="#f2c14e" />}
            <group ref={head} position={[0, 0.68, 0]}>
              <S p={[0, 0.1, 0]} r={0.15} c={skin} />
              {uniform ? (
                <>
                  <B p={[0, 0.22, 0]} s={[0.32, 0.08, 0.32]} c="#14213d" />
                  <B p={[0, 0.19, 0.17]} s={[0.3, 0.03, 0.12]} c="#14213d" />
                </>
              ) : (
                <B p={[0, 0.2, -0.03]} s={[0.31, 0.12, 0.3]} c={hair} />
              )}
              <B p={[-0.055, 0.12, 0.14]} s={[0.04, 0.04, 0.02]} c="#111" />
              <B p={[0.055, 0.12, 0.14]} s={[0.04, 0.04, 0.02]} c="#111" />
            </group>
            <group ref={armL} position={[-0.27, 0.55, 0]}>
              <B p={[0, -0.25, 0]} s={[0.11, 0.5, 0.12]} c={shirt} />
              <S p={[0, -0.52, 0]} r={0.06} c={skin} />
            </group>
            <group ref={armR} position={[0.27, 0.55, 0]}>
              <B p={[0, -0.25, 0]} s={[0.11, 0.5, 0.12]} c={shirt} />
              <S p={[0, -0.52, 0]} r={0.06} c={skin} />
              <HeldItem kind={held} />
              {anim === "phone" && <B p={[0, -0.55, 0.06]} s={[0.08, 0.14, 0.02]} c="#111" />}
            </group>
          </group>
        </group>
      </group>
      {children}
    </group>
  );
}

/** 강아지 */
export function Dog({ anim, look = 0 }: { anim: string; look?: number }) {
  const legs = [useRef<THREE.Group>(null), useRef<THREE.Group>(null), useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const body = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const fur = ["#c68642", "#f5deb3", "#3b2f2f", "#8b5a2b", "#fff", "#d2b48c"][look % 6];
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const f = anim === "run" ? 16 : 9;
    const moving = anim === "walk" || anim === "run";
    legs.forEach((l, i) => {
      if (!l.current) return;
      l.current.rotation.x = moving ? Math.sin(t * f + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * (anim === "run" ? 0.8 : 0.45) : anim === "lie" || anim === "roll" ? (i < 2 ? -1.3 : 1.3) : anim === "sit" && i > 1 ? -1.2 : 0;
    });
    if (body.current) {
      body.current.position.y = anim === "lie" || anim === "roll" ? 0.2 : anim === "sit" ? 0.36 : 0.42 + (moving ? Math.abs(Math.sin(t * f)) * 0.04 : 0);
      body.current.rotation.x = anim === "sit" ? -0.5 : 0;
      body.current.rotation.z = anim === "roll" ? Math.sin(t * 3) * 1.4 : 0;
    }
    if (tail.current) tail.current.rotation.y = Math.sin(t * (moving ? 14 : 8)) * 0.6;
    if (head.current) head.current.rotation.y = moving ? 0 : Math.sin(t * 0.9) * 0.5;
  });
  return (
    <group ref={body} position={[0, 0.42, 0]}>
      <B p={[0, 0, 0]} s={[0.3, 0.28, 0.62]} c={fur} />
      <group ref={head} position={[0, 0.18, 0.36]}>
        <B p={[0, 0, 0]} s={[0.24, 0.24, 0.24]} c={fur} />
        <B p={[0, -0.04, 0.16]} s={[0.13, 0.11, 0.13]} c={fur} />
        <B p={[0, -0.01, 0.23]} s={[0.05, 0.04, 0.03]} c="#111" />
        <B p={[-0.12, 0.08, -0.02]} s={[0.05, 0.16, 0.1]} c="#5c3d2e" r={[0, 0, 0.3]} />
        <B p={[0.12, 0.08, -0.02]} s={[0.05, 0.16, 0.1]} c="#5c3d2e" r={[0, 0, -0.3]} />
        <B p={[-0.06, 0.05, 0.125]} s={[0.035, 0.035, 0.01]} c="#111" />
        <B p={[0.06, 0.05, 0.125]} s={[0.035, 0.035, 0.01]} c="#111" />
      </group>
      <group ref={tail} position={[0, 0.1, -0.31]}>
        <B p={[0, 0.06, -0.08]} s={[0.05, 0.05, 0.2]} c={fur} r={[0.6, 0, 0]} />
      </group>
      {(
        [
          [-0.1, 0.22],
          [0.1, 0.22],
          [-0.1, -0.22],
          [0.1, -0.22],
        ] as const
      ).map(([x, z], i) => (
        <group key={i} ref={legs[i]} position={[x, -0.1, z]}>
          <B p={[0, -0.14, 0]} s={[0.08, 0.3, 0.08]} c={fur} />
        </group>
      ))}
    </group>
  );
}

/** 고양이 */
export function Cat({ anim, look = 0 }: { anim: string; look?: number }) {
  const body = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Group>(null);
  const legs = [useRef<THREE.Group>(null), useRef<THREE.Group>(null), useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const fur = ["#ff9f43", "#222", "#ddd", "#8395a7", "#c8a27c"][look % 5];
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const moving = anim === "walk" || anim === "run";
    const f = anim === "run" ? 15 : 8;
    legs.forEach((l, i) => {
      if (l.current) l.current.rotation.x = moving ? Math.sin(t * f + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * 0.5 : anim === "loaf" ? (i < 2 ? -1.4 : 1.4) : 0;
    });
    if (body.current) {
      body.current.position.y = anim === "loaf" ? 0.14 : 0.27;
      body.current.scale.z = anim === "stretch" ? 1.25 + Math.sin(t * 2) * 0.05 : 1;
      body.current.rotation.x = anim === "stretch" ? 0.25 : 0;
    }
    if (tail.current) tail.current.rotation.z = Math.sin(t * 2.2) * 0.4;
  });
  return (
    <group ref={body} position={[0, 0.27, 0]}>
      <B p={[0, 0, 0]} s={[0.2, 0.18, 0.42]} c={fur} />
      <group position={[0, 0.12, 0.24]}>
        <B p={[0, 0, 0]} s={[0.19, 0.17, 0.17]} c={fur} />
        <B p={[-0.06, 0.12, 0]} s={[0.05, 0.08, 0.04]} c={fur} r={[0, 0, 0.3]} />
        <B p={[0.06, 0.12, 0]} s={[0.05, 0.08, 0.04]} c={fur} r={[0, 0, -0.3]} />
        <B p={[-0.045, 0.02, 0.09]} s={[0.03, 0.035, 0.01]} c="#9be564" />
        <B p={[0.045, 0.02, 0.09]} s={[0.03, 0.035, 0.01]} c="#9be564" />
      </group>
      <group ref={tail} position={[0, 0.05, -0.21]}>
        <B p={[0, 0.17, -0.03]} s={[0.04, 0.34, 0.04]} c={fur} r={[-0.3, 0, 0]} />
      </group>
      {(
        [
          [-0.07, 0.15],
          [0.07, 0.15],
          [-0.07, -0.15],
          [0.07, -0.15],
        ] as const
      ).map(([x, z], i) => (
        <group key={i} ref={legs[i]} position={[x, -0.07, z]}>
          <B p={[0, -0.1, 0]} s={[0.05, 0.2, 0.05]} c={fur} />
        </group>
      ))}
    </group>
  );
}

export function Vacuum({ anim }: { anim: string }) {
  const led = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (led.current) led.current.color.set(anim === "walk" && Math.sin(clock.elapsedTime * 6) > 0 ? "#22d3ee" : "#0e7490");
  });
  return (
    <group>
      <mesh position={[0, 0.06, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 0.1, 24]} />
        <meshStandardMaterial color="#e5e7eb" roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.115, 0]}>
        <cylinderGeometry args={[0.22, 0.24, 0.02, 24]} />
        <meshStandardMaterial color="#374151" />
      </mesh>
      <mesh position={[0, 0.13, 0.15]}>
        <sphereGeometry args={[0.03, 8, 6]} />
        <meshBasicMaterial ref={led} color="#22d3ee" toneMapped={false} />
      </mesh>
    </group>
  );
}

export function Car({ look = 0, anim }: { look?: number; anim: string }) {
  const color = ["#d62828", "#1d4ed8", "#f5f5f5", "#065f46", "#f59e0b"][look % 5];
  const wheels = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (wheels.current && anim === "drive") wheels.current.children.forEach((w) => (w.rotation.x += dt * 12));
  });
  return (
    <group>
      <B p={[0, 0.55, 0]} s={[1.8, 0.6, 3.9]} c={color} />
      <B p={[0, 1.05, -0.2]} s={[1.6, 0.5, 2.0]} c="#a5d8ff" />
      <B p={[0, 1.31, -0.2]} s={[1.62, 0.04, 2.02]} c={color} />
      {[-0.6, 0.6].map((x) => (
        <mesh key={x} position={[x, 0.6, 1.96]}>
          <boxGeometry args={[0.35, 0.15, 0.04]} />
          <meshBasicMaterial color="#fff7cc" toneMapped={false} />
        </mesh>
      ))}
      {[-0.6, 0.6].map((x) => (
        <mesh key={`r${x}`} position={[x, 0.6, -1.96]}>
          <boxGeometry args={[0.35, 0.12, 0.04]} />
          <meshBasicMaterial color={anim === "stop" ? "#ff2d2d" : "#7f1d1d"} toneMapped={false} />
        </mesh>
      ))}
      <group ref={wheels}>
        {(
          [
            [-0.85, 1.3],
            [0.85, 1.3],
            [-0.85, -1.3],
            [0.85, -1.3],
          ] as const
        ).map(([x, z]) => (
          <mesh key={`${x}${z}`} position={[x, 0.32, z]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.32, 0.32, 0.22, 14]} />
            <meshStandardMaterial color="#111" />
          </mesh>
        ))}
      </group>
    </group>
  );
}
