"use client";

import { useMemo, useRef, type MutableRefObject, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * 여관 난투 3D 캐릭터 — 외부 모델 파일 없이 기본 도형(상자·구·원기둥·원뿔·고리)을 조립해 만든다.
 * 유닛마다 몸 형태(kind)와 색·장비만 다르고, 움직임(숨쉬기·공격 동작·맞음 움찔)은 형태별 공통 규칙.
 * 기하·재질은 모듈 캐시로 공유해서 유닛이 14마리여도 GPU 객체 수가 적다.
 *
 * 좌표: 받침 윗면(y=0)에 서고 +z가 정면.
 */

/* ── 공유 기하·재질 ───────────────────────────────────────── */

const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(1, 16, 12),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 14),
  cone: new THREE.ConeGeometry(1, 1, 14),
  torus: new THREE.TorusGeometry(1, 0.22, 8, 20),
  ico: new THREE.IcosahedronGeometry(1, 0),
  oct: new THREE.OctahedronGeometry(1, 0),
};
type GeoKind = keyof typeof GEO;

const matCache = new Map<string, THREE.Material>();
function mat(color: string, o: { glow?: number; metal?: number; rough?: number; alpha?: number } = {}): THREE.Material {
  const key = `${color}|${o.glow ?? 0}|${o.metal ?? 0}|${o.rough ?? 0.6}|${o.alpha ?? 1}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      emissive: o.glow ? color : "#000000",
      emissiveIntensity: o.glow ?? 0,
      metalness: o.metal ?? 0.05,
      roughness: o.rough ?? 0.6,
      transparent: (o.alpha ?? 1) < 1,
      opacity: o.alpha ?? 1,
      depthWrite: (o.alpha ?? 1) >= 1,
    });
    matCache.set(key, m);
  }
  return m;
}

type V3 = [number, number, number];
function P({ g, c, p = [0, 0, 0], s = [1, 1, 1], r = [0, 0, 0], o }: { g: GeoKind; c: string; p?: V3; s?: V3 | number; r?: V3; o?: Parameters<typeof mat>[1] }) {
  return <mesh geometry={GEO[g]} material={mat(c, o)} position={p} scale={typeof s === "number" ? [s, s, s] : s} rotation={r} castShadow />;
}

const EYE = "#111111";
const STEEL = "#cbd5e1";
const WOOD = "#7c4a1e";

/* ── 스펙 ─────────────────────────────────────────────────── */

type Weapon = "sword" | "bigsword" | "shield" | "swordShield" | "bow" | "staff" | "dagger" | "wrench" | "hammer" | "shovel" | "flask" | "mace" | "none";
type Head = "helm" | "plume" | "hood" | "crown" | "wizard" | "hair" | "skull" | "visor" | "bare";

export type FigureSpec =
  | { kind: "human"; skin: string; body: string; accent: string; head: Head; weapon: Weapon; cape?: string; robe?: boolean; mount?: string; size?: number; glowEyes?: string }
  | { kind: "beast"; fur: string; belly: string; ears: "pointy" | "long" | "round"; tail: "bushy" | "short" | "none"; tusks?: boolean; trunk?: boolean; shell?: string; size: number; long?: boolean }
  | { kind: "robot"; metal: string; accent: string; eye: string; form: "mouse" | "bot" | "golem" | "tank" | "smith" | "titan"; size?: number }
  | { kind: "elemental"; color: string; core: string; form: "flame" | "drop" | "tornado" | "lava" | "storm" | "star"; size?: number }
  | { kind: "wraith"; cloak: string; eye: string; size?: number }
  | { kind: "dragon"; skin: string; belly: string; wing: string; size: number; form: "whelp" | "lizard" | "wyrm" | "bat" | "drake" | "elder" }
  | { kind: "bird"; color: string; beak: string };

const H = (o: Partial<Extract<FigureSpec, { kind: "human" }>> & { head: Head; weapon: Weapon }): FigureSpec => ({ kind: "human", skin: "#f1c27d", body: "#64748b", accent: "#facc15", ...o });

export const FIGURES: Record<string, FigureSpec> = {
  // 기사단
  k_squire: H({ body: "#78716c", accent: "#a8a29e", head: "helm", weapon: "shield", size: 0.85 }),
  k_guardian: H({ body: "#e2e8f0", accent: "#facc15", head: "helm", weapon: "swordShield" }),
  k_rider: H({ body: "#cbd5e1", accent: "#60a5fa", head: "plume", weapon: "sword", mount: "#f8fafc", size: 0.8 }),
  k_paladin: H({ body: "#fbbf24", accent: "#fef3c7", head: "helm", weapon: "hammer", cape: "#1d4ed8", size: 1.05 }),
  k_oath: H({ body: "#3b82f6", accent: "#e0f2fe", head: "plume", weapon: "swordShield", cape: "#e0f2fe", size: 1.1 }),
  k_lord: H({ body: "#f8fafc", accent: "#facc15", head: "crown", weapon: "bigsword", cape: "#b91c1c", size: 1.2 }),
  // 야수
  b_rabbit: { kind: "beast", fur: "#d6d3d1", belly: "#fafaf9", ears: "long", tail: "short", size: 0.55 },
  b_dog: { kind: "beast", fur: "#b45309", belly: "#fde68a", ears: "pointy", tail: "short", size: 0.7 },
  b_wolfmom: { kind: "beast", fur: "#6b7280", belly: "#e5e7eb", ears: "pointy", tail: "bushy", size: 0.85 },
  b_hunter: H({ body: "#166534", accent: "#a3e635", head: "hood", weapon: "bow" }),
  b_bear: { kind: "beast", fur: "#78350f", belly: "#d6a46b", ears: "round", tail: "short", size: 1.05 },
  b_turtle: { kind: "beast", fur: "#65a30d", belly: "#d9f99d", ears: "round", tail: "short", shell: "#3f6212", size: 1.05, long: true },
  b_mammoth: { kind: "beast", fur: "#7c2d12", belly: "#a16207", ears: "round", tail: "short", tusks: true, trunk: true, size: 1.3 },
  // 기계
  m_mouse: { kind: "robot", metal: "#94a3b8", accent: "#f59e0b", eye: "#ef4444", form: "mouse", size: 0.7 },
  m_repair: { kind: "robot", metal: "#cbd5e1", accent: "#f97316", eye: "#38bdf8", form: "bot" },
  m_golem: { kind: "robot", metal: "#92400e", accent: "#57534e", eye: "#fbbf24", form: "golem" },
  m_tank: { kind: "robot", metal: "#475569", accent: "#b45309", eye: "#fb923c", form: "tank" },
  m_smith: { kind: "robot", metal: "#a16207", accent: "#78716c", eye: "#f87171", form: "smith", size: 1.05 },
  m_titan: { kind: "robot", metal: "#e5e7eb", accent: "#6366f1", eye: "#22d3ee", form: "titan", size: 1.2 },
  // 원소
  e_ember: { kind: "elemental", color: "#f97316", core: "#fde047", form: "flame", size: 0.7 },
  e_droplet: { kind: "elemental", color: "#38bdf8", core: "#e0f2fe", form: "drop", size: 0.85 },
  e_wind: { kind: "elemental", color: "#a5f3fc", core: "#ecfeff", form: "tornado" },
  e_lava: { kind: "elemental", color: "#44403c", core: "#f97316", form: "lava", size: 1.1 },
  e_storm: { kind: "elemental", color: "#64748b", core: "#fde047", form: "storm", size: 1.1 },
  e_origin: { kind: "elemental", color: "#fef08a", core: "#ffffff", form: "star", size: 1.15 },
  // 망령
  u_skeleton: H({ skin: "#f5f5f4", body: "#e7e5e4", accent: "#a8a29e", head: "skull", weapon: "sword", size: 0.85 }),
  u_crow: { kind: "bird", color: "#1f2937", beak: "#fbbf24" },
  u_keeper: H({ skin: "#d6d3d1", body: "#3f3f46", accent: "#71717a", head: "hood", weapon: "shovel" }),
  u_wraith: { kind: "wraith", cloak: "#14532d", eye: "#4ade80" },
  u_lich: H({ skin: "#a5b4fc", body: "#4c1d95", accent: "#c4b5fd", head: "crown", weapon: "staff", robe: true, glowEyes: "#a78bfa", size: 1.1 }),
  u_dk: H({ skin: "#334155", body: "#1e293b", accent: "#7f1d1d", head: "visor", weapon: "bigsword", cape: "#450a0a", glowEyes: "#ef4444", size: 1.2 }),
  // 용족
  d_whelp: { kind: "dragon", skin: "#22c55e", belly: "#bbf7d0", wing: "#15803d", size: 0.6, form: "whelp" },
  d_flame: { kind: "dragon", skin: "#ea580c", belly: "#fed7aa", wing: "#9a3412", size: 0.75, form: "lizard" },
  d_guard: { kind: "dragon", skin: "#0e7490", belly: "#a5f3fc", wing: "#155e75", size: 1.0, form: "wyrm" },
  d_dusk: { kind: "dragon", skin: "#581c87", belly: "#d8b4fe", wing: "#3b0764", size: 1.0, form: "bat" },
  d_drake: { kind: "dragon", skin: "#b91c1c", belly: "#fecaca", wing: "#7f1d1d", size: 1.1, form: "drake" },
  d_elder: { kind: "dragon", skin: "#a16207", belly: "#fef3c7", wing: "#713f12", size: 1.3, form: "elder" },
  // 중립
  n_kid: H({ body: "#ef4444", accent: "#fde68a", head: "hair", weapon: "none", size: 0.7 }),
  n_rogue: H({ body: "#1f2937", accent: "#4ade80", head: "hood", weapon: "dagger" }),
  n_merc: H({ body: "#92400e", accent: "#d6d3d1", head: "helm", weapon: "swordShield", size: 1.05 }),
  n_priest: H({ body: "#f8fafc", accent: "#fbbf24", head: "hood", weapon: "staff", robe: true }),
  n_general: H({ body: "#991b1b", accent: "#facc15", head: "plume", weapon: "sword", cape: "#facc15", size: 1.1 }),
  n_alch: H({ body: "#7e22ce", accent: "#fbbf24", head: "wizard", weapon: "flask", robe: true, size: 1.05 }),
  // 토큰
  t_bunny: { kind: "beast", fur: "#fafaf9", belly: "#fecdd3", ears: "long", tail: "short", size: 0.45 },
  t_wolf: { kind: "beast", fur: "#9ca3af", belly: "#f3f4f6", ears: "pointy", tail: "bushy", size: 0.6 },
  t_cub: { kind: "beast", fur: "#92400e", belly: "#e7c39b", ears: "round", tail: "short", size: 0.7 },
  t_calf: { kind: "beast", fur: "#9a3412", belly: "#ca8a04", ears: "round", tail: "short", tusks: true, trunk: true, size: 0.85 },
  t_scrap: { kind: "robot", metal: "#78716c", accent: "#a8a29e", eye: "#fbbf24", form: "bot", size: 0.7 },
  t_skel: H({ skin: "#f5f5f4", body: "#e7e5e4", accent: "#a8a29e", head: "skull", weapon: "dagger", size: 0.65 }),
};

/* ── 움직임 입력 ─────────────────────────────────────────── */

/** Token이 매 프레임 채워 준다. swing: 0 평소, <0 예비 동작(치켜듦), >0 내려치기. hit: 맞은 강도 0~1. */
export interface FigureAct {
  swing: number;
  hit: number;
}

type Part = "root" | "torso" | "head" | "armL" | "armR" | "legL" | "legR" | "wingL" | "wingR" | "tail" | "spin";
/** rig("armR") → 그 부위 그룹에 붙일 ref 콜백. 노드는 Figure의 nodes 맵에 모인다. */
type Rig = (part: Part) => (node: THREE.Group | null) => void;

/* ── 무기 ─────────────────────────────────────────────────── */

function WeaponMesh({ w, accent }: { w: Weapon; accent: string }) {
  switch (w) {
    case "sword":
    case "bigsword": {
      const L = w === "bigsword" ? 0.62 : 0.42;
      return (
        <group position={[0, -0.04, 0.05]} rotation={[Math.PI / 2, 0, 0]}>
          <P g="box" c={STEEL} p={[0, L / 2 + 0.06, 0]} s={[0.05, L, 0.015]} o={{ metal: 0.9, rough: 0.2 }} />
          <P g="box" c={accent} p={[0, 0.05, 0]} s={[0.16, 0.035, 0.05]} o={{ metal: 0.7, rough: 0.3 }} />
          <P g="cyl" c={WOOD} p={[0, -0.02, 0]} s={[0.022, 0.12, 0.022]} />
        </group>
      );
    }
    case "dagger":
      return (
        <group position={[0, -0.04, 0.04]} rotation={[Math.PI / 2, 0, 0]}>
          <P g="cone" c="#a3e635" p={[0, 0.14, 0]} s={[0.035, 0.22, 0.015]} o={{ metal: 0.6, rough: 0.3, glow: 0.3 }} />
          <P g="cyl" c={WOOD} p={[0, 0, 0]} s={[0.02, 0.08, 0.02]} />
        </group>
      );
    case "hammer":
    case "mace":
      return (
        <group position={[0, -0.04, 0.04]} rotation={[Math.PI / 2, 0, 0]}>
          <P g="cyl" c={WOOD} p={[0, 0.17, 0]} s={[0.025, 0.4, 0.025]} />
          <P g="box" c={accent} p={[0, 0.38, 0]} s={[0.22, 0.13, 0.13]} o={{ metal: 0.8, rough: 0.3 }} />
        </group>
      );
    case "staff":
      return (
        <group position={[0, -0.05, 0.03]}>
          <P g="cyl" c={WOOD} p={[0, 0.12, 0]} s={[0.022, 0.7, 0.022]} />
          <P g="sphere" c={accent} p={[0, 0.5, 0]} s={0.07} o={{ glow: 1.2 }} />
        </group>
      );
    case "shovel":
      return (
        <group position={[0, -0.05, 0.04]}>
          <P g="cyl" c={WOOD} p={[0, 0.1, 0]} s={[0.02, 0.62, 0.02]} />
          <P g="box" c="#71717a" p={[0, -0.24, 0.02]} s={[0.12, 0.15, 0.02]} o={{ metal: 0.6 }} />
        </group>
      );
    case "wrench":
      return (
        <group position={[0, -0.04, 0.05]} rotation={[Math.PI / 2, 0, 0]}>
          <P g="box" c={STEEL} p={[0, 0.14, 0]} s={[0.04, 0.28, 0.03]} o={{ metal: 0.9, rough: 0.3 }} />
          <P g="torus" c={STEEL} p={[0, 0.3, 0]} s={0.05} o={{ metal: 0.9, rough: 0.3 }} />
        </group>
      );
    case "flask":
      return (
        <group position={[0, -0.06, 0.04]}>
          <P g="sphere" c="#4ade80" s={0.07} o={{ glow: 0.8, alpha: 0.85 }} />
          <P g="cyl" c="#e5e7eb" p={[0, 0.08, 0]} s={[0.02, 0.06, 0.02]} />
        </group>
      );
    case "bow":
      return (
        <group position={[0, -0.04, 0.05]} rotation={[0, Math.PI / 2, 0]}>
          <mesh geometry={GEO.torus} material={mat(WOOD)} scale={[0.26, 0.26, 0.1]} rotation={[0, 0, -Math.PI / 2]} />
        </group>
      );
    default:
      return null;
  }
}

/* ── 사람형 ───────────────────────────────────────────────── */

function HeadGear({ head, skin, body, accent, glowEyes }: { head: Head; skin: string; body: string; accent: string; glowEyes?: string }) {
  const eyes = (c: string, glow = 0) => (
    <>
      <P g="sphere" c={c} p={[-0.06, 0.02, 0.15]} s={0.025} o={{ glow }} />
      <P g="sphere" c={c} p={[0.06, 0.02, 0.15]} s={0.025} o={{ glow }} />
    </>
  );
  const e = glowEyes ? eyes(glowEyes, 2) : eyes(EYE);
  switch (head) {
    case "helm":
      return (
        <>
          <P g="sphere" c={skin} s={0.16} />
          {e}
          <P g="sphere" c={body} p={[0, 0.04, 0]} s={[0.18, 0.15, 0.18]} o={{ metal: 0.7, rough: 0.3 }} />
          <P g="box" c={body} p={[0, -0.01, 0.14]} s={[0.04, 0.12, 0.04]} o={{ metal: 0.7, rough: 0.3 }} />
        </>
      );
    case "plume":
      return (
        <>
          <P g="sphere" c={skin} s={0.16} />
          {e}
          <P g="sphere" c={body} p={[0, 0.05, 0]} s={[0.18, 0.15, 0.18]} o={{ metal: 0.7, rough: 0.3 }} />
          <P g="cone" c={accent} p={[0, 0.25, -0.04]} s={[0.05, 0.22, 0.12]} r={[-0.4, 0, 0]} />
        </>
      );
    case "hood":
      return (
        <>
          <P g="sphere" c={skin} s={0.15} />
          {e}
          <P g="sphere" c={body} p={[0, 0.03, -0.03]} s={[0.19, 0.19, 0.19]} />
          <P g="cone" c={body} p={[0, 0.18, -0.08]} s={[0.12, 0.2, 0.12]} r={[-0.6, 0, 0]} />
        </>
      );
    case "crown":
      return (
        <>
          <P g="sphere" c={skin} s={0.16} />
          {e}
          <P g="cyl" c="#facc15" p={[0, 0.15, 0]} s={[0.13, 0.08, 0.13]} o={{ metal: 0.9, rough: 0.2, glow: 0.2 }} />
          {[0, 1, 2, 3, 4].map((i) => (
            <P key={i} g="cone" c="#facc15" p={[Math.cos((i / 5) * Math.PI * 2) * 0.11, 0.23, Math.sin((i / 5) * Math.PI * 2) * 0.11]} s={[0.03, 0.08, 0.03]} o={{ metal: 0.9, rough: 0.2 }} />
          ))}
        </>
      );
    case "wizard":
      return (
        <>
          <P g="sphere" c={skin} s={0.15} />
          {e}
          <P g="cyl" c={body} p={[0, 0.1, 0]} s={[0.26, 0.02, 0.26]} />
          <P g="cone" c={body} p={[0, 0.3, 0]} s={[0.14, 0.38, 0.14]} r={[-0.15, 0, 0.1]} />
          <P g="sphere" c={accent} p={[0, 0.12, 0.12]} s={0.03} o={{ glow: 1 }} />
        </>
      );
    case "hair":
      return (
        <>
          <P g="sphere" c={skin} s={0.17} />
          {e}
          <P g="sphere" c="#92400e" p={[0, 0.07, -0.02]} s={[0.18, 0.13, 0.18]} />
        </>
      );
    case "skull":
      return (
        <>
          <P g="sphere" c={skin} s={[0.15, 0.15, 0.15]} />
          <P g="sphere" c={glowEyes ?? "#111"} p={[-0.055, 0.02, 0.12]} s={0.04} o={{ glow: glowEyes ? 2 : 0 }} />
          <P g="sphere" c={glowEyes ?? "#111"} p={[0.055, 0.02, 0.12]} s={0.04} o={{ glow: glowEyes ? 2 : 0 }} />
          <P g="box" c={skin} p={[0, -0.12, 0.05]} s={[0.12, 0.06, 0.1]} />
        </>
      );
    case "visor":
      return (
        <>
          <P g="box" c={body} s={[0.3, 0.3, 0.3]} o={{ metal: 0.8, rough: 0.35 }} />
          <P g="box" c={glowEyes ?? "#111"} p={[0, 0.02, 0.152]} s={[0.22, 0.04, 0.01]} o={{ glow: glowEyes ? 2.5 : 0 }} />
          <P g="cone" c={accent} p={[-0.17, 0.16, 0]} s={[0.04, 0.16, 0.04]} r={[0, 0, 0.6]} />
          <P g="cone" c={accent} p={[0.17, 0.16, 0]} s={[0.04, 0.16, 0.04]} r={[0, 0, -0.6]} />
        </>
      );
    default:
      return (
        <>
          <P g="sphere" c={skin} s={0.16} />
          {e}
        </>
      );
  }
}

function Human({ s, rig }: { s: Extract<FigureSpec, { kind: "human" }>; rig: Rig }) {
  const metal = s.head === "helm" || s.head === "plume" || s.head === "visor" || s.head === "crown" ? { metal: 0.65, rough: 0.35 } : undefined;
  const mounted = !!s.mount;
  const lift = mounted ? 0.34 : 0;
  const shield = s.weapon === "shield" || s.weapon === "swordShield";
  const right: Weapon = s.weapon === "shield" ? "mace" : s.weapon === "swordShield" ? "sword" : s.weapon;
  return (
    <group>
      {mounted && (
        <group>
          <P g="sphere" c={s.mount!} p={[0, 0.36, 0]} s={[0.2, 0.2, 0.4]} />
          {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <P key={`${sx}${sz}`} g="cyl" c={s.mount!} p={[sx * 0.11, 0.15, sz * 0.24]} s={[0.04, 0.3, 0.04]} />))}
          <group position={[0, 0.5, 0.34]} rotation={[0.6, 0, 0]}>
            <P g="cyl" c={s.mount!} p={[0, 0.08, 0]} s={[0.07, 0.24, 0.08]} />
            <P g="box" c={s.mount!} p={[0, 0.2, 0.06]} s={[0.11, 0.11, 0.22]} />
            <P g="box" c="#e5e7eb" p={[0, 0.27, -0.04]} s={[0.03, 0.12, 0.12]} />
          </group>
          <P g="cone" c="#e5e7eb" p={[0, 0.4, -0.42]} s={[0.05, 0.25, 0.05]} r={[-2.3, 0, 0]} />
          <P g="box" c={s.accent} p={[0, 0.56, 0]} s={[0.26, 0.04, 0.3]} />
        </group>
      )}
      <group position={[0, lift, 0]}>
        {!mounted && !s.robe && (
          <>
            <group ref={rig("legL")} position={[-0.09, 0.36, 0]}>
              <P g="box" c={s.accent === "#facc15" ? "#57534e" : "#44403c"} p={[0, -0.18, 0]} s={[0.12, 0.36, 0.13]} o={metal} />
            </group>
            <group ref={rig("legR")} position={[0.09, 0.36, 0]}>
              <P g="box" c={s.accent === "#facc15" ? "#57534e" : "#44403c"} p={[0, -0.18, 0]} s={[0.12, 0.36, 0.13]} o={metal} />
            </group>
          </>
        )}
        {s.robe && <P g="cone" c={s.body} p={[0, 0.3, 0]} s={[0.26, 0.62, 0.26]} />}
        <group ref={rig("torso")} position={[0, mounted ? 0.5 : 0.36, 0]}>
          {mounted && (
            <>
              <P g="box" c="#44403c" p={[-0.13, -0.05, 0.05]} s={[0.08, 0.2, 0.1]} r={[0, 0, 0.5]} />
              <P g="box" c="#44403c" p={[0.13, -0.05, 0.05]} s={[0.08, 0.2, 0.1]} r={[0, 0, -0.5]} />
            </>
          )}
          <P g="box" c={s.body} p={[0, 0.22, 0]} s={[0.38, 0.42, 0.24]} o={metal} />
          <P g="box" c={s.accent} p={[0, 0.04, 0]} s={[0.4, 0.06, 0.26]} o={{ metal: 0.6, rough: 0.35 }} />
          {metal && <P g="box" c={s.accent} p={[0, 0.27, 0.125]} s={[0.08, 0.26, 0.01]} />}
          {s.cape && <P g="box" c={s.cape} p={[0, 0.12, -0.15]} s={[0.4, 0.62, 0.03]} r={[0.12, 0, 0]} />}
          <group ref={rig("head")} position={[0, 0.6, 0]}>
            <HeadGear head={s.head} skin={s.skin} body={s.body} accent={s.accent} glowEyes={s.glowEyes} />
          </group>
          <group ref={rig("armL")} position={[-0.25, 0.38, 0]}>
            <P g="box" c={s.body} p={[0, -0.16, 0]} s={[0.1, 0.34, 0.11]} o={metal} />
            <P g="sphere" c={s.skin} p={[0, -0.35, 0]} s={0.055} />
            {shield && (
              <group position={[-0.06, -0.24, 0.08]} rotation={[0, -0.25, 0]}>
                <P g="cyl" c={s.accent} s={[0.17, 0.035, 0.17]} r={[Math.PI / 2, 0, 0]} o={{ metal: 0.7, rough: 0.3 }} />
                <P g="cyl" c={s.body} p={[0, 0, 0.02]} s={[0.12, 0.02, 0.12]} r={[Math.PI / 2, 0, 0]} o={{ metal: 0.7, rough: 0.3 }} />
              </group>
            )}
          </group>
          <group ref={rig("armR")} position={[0.25, 0.38, 0]}>
            <P g="box" c={s.body} p={[0, -0.16, 0]} s={[0.1, 0.34, 0.11]} o={metal} />
            <P g="sphere" c={s.skin} p={[0, -0.35, 0]} s={0.055} />
            <group position={[0, -0.35, 0]}>
              <WeaponMesh w={right} accent={s.accent} />
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

/* ── 네발짐승 ─────────────────────────────────────────────── */

function Beast({ s, rig }: { s: Extract<FigureSpec, { kind: "beast" }>; rig: Rig }) {
  const legH = s.long ? 0.14 : 0.24;
  const bodyY = legH + 0.2;
  return (
    <group>
      <group ref={rig("torso")} position={[0, bodyY, 0]}>
        <P g="sphere" c={s.fur} s={[0.3, 0.24, s.long ? 0.42 : 0.4]} />
        <P g="sphere" c={s.belly} p={[0, -0.08, 0.04]} s={[0.22, 0.15, 0.3]} />
        {s.shell && (
          <>
            <P g="sphere" c={s.shell} p={[0, 0.1, 0]} s={[0.36, 0.26, 0.44]} o={{ rough: 0.8 }} />
            {[-0.18, 0, 0.18].map((z) => (
              <P key={z} g="sphere" c="#365314" p={[0, 0.3, z]} s={[0.1, 0.05, 0.1]} />
            ))}
          </>
        )}
        <group ref={rig("head")} position={[0, 0.14, 0.36]}>
          <P g="sphere" c={s.fur} s={0.19} />
          {!s.trunk && <P g="box" c={s.belly} p={[0, -0.05, 0.15]} s={[0.12, 0.09, 0.12]} />}
          <P g="sphere" c={EYE} p={[-0.08, 0.05, 0.15]} s={0.03} />
          <P g="sphere" c={EYE} p={[0.08, 0.05, 0.15]} s={0.03} />
          <P g="sphere" c="#1c1917" p={[0, -0.03, 0.22]} s={0.025} />
          {s.ears === "pointy" &&
            [-1, 1].map((sx) => <P key={sx} g="cone" c={s.fur} p={[sx * 0.1, 0.18, 0]} s={[0.06, 0.14, 0.04]} r={[0, 0, -sx * 0.2]} />)}
          {s.ears === "long" &&
            [-1, 1].map((sx) => <P key={sx} g="sphere" c={s.fur} p={[sx * 0.07, 0.27, -0.02]} s={[0.05, 0.18, 0.03]} r={[0, 0, -sx * 0.15]} />)}
          {s.ears === "round" && [-1, 1].map((sx) => <P key={sx} g="sphere" c={s.fur} p={[sx * 0.14, 0.15, -0.02]} s={[0.07, 0.07, 0.03]} />)}
          {s.tusks &&
            [-1, 1].map((sx) => <P key={sx} g="cone" c="#fffbeb" p={[sx * 0.09, -0.12, 0.16]} s={[0.025, 0.22, 0.025]} r={[2.2, 0, -sx * 0.25]} />)}
          {s.trunk && <P g="cyl" c={s.fur} p={[0, -0.15, 0.17]} s={[0.04, 0.26, 0.04]} r={[0.35, 0, 0]} />}
        </group>
        <group ref={rig("tail")} position={[0, 0.06, -0.38]}>
          {s.tail === "bushy" && <P g="sphere" c={s.fur} p={[0, 0.08, -0.1]} s={[0.07, 0.07, 0.17]} r={[0.6, 0, 0]} />}
          {s.tail === "short" && <P g="sphere" c={s.belly} p={[0, 0.03, -0.02]} s={0.06} />}
        </group>
      </group>
      {[-1, 1].map((sx) => (
        <group key={`f${sx}`} ref={sx < 0 ? rig("legL") : undefined} position={[sx * 0.15, legH, 0.2]}>
          <P g="cyl" c={s.fur} p={[0, -legH / 2, 0]} s={[0.055, legH, 0.055]} />
        </group>
      ))}
      {[-1, 1].map((sx) => (
        <group key={`b${sx}`} ref={sx < 0 ? rig("legR") : undefined} position={[sx * 0.15, legH, -0.2]}>
          <P g="cyl" c={s.fur} p={[0, -legH / 2, 0]} s={[0.055, legH, 0.055]} />
        </group>
      ))}
    </group>
  );
}

/* ── 기계 ─────────────────────────────────────────────────── */

function Robot({ s, rig }: { s: Extract<FigureSpec, { kind: "robot" }>; rig: Rig }) {
  const m = { metal: 0.85, rough: 0.3 };
  if (s.form === "mouse") {
    return (
      <group>
        <group ref={rig("torso")} position={[0, 0.2, 0]}>
          <P g="sphere" c={s.metal} s={[0.22, 0.17, 0.3]} o={m} />
          <group ref={rig("head")} position={[0, 0.02, 0.25]}>
            <P g="cone" c={s.metal} s={[0.12, 0.22, 0.12]} r={[Math.PI / 2, 0, 0]} o={m} />
            <P g="sphere" c={s.eye} p={[-0.06, 0.06, 0.03]} s={0.03} o={{ glow: 2 }} />
            <P g="sphere" c={s.eye} p={[0.06, 0.06, 0.03]} s={0.03} o={{ glow: 2 }} />
            {[-1, 1].map((sx) => (
              <P key={sx} g="cyl" c={s.accent} p={[sx * 0.1, 0.12, -0.04]} s={[0.07, 0.01, 0.07]} r={[Math.PI / 2, 0, 0]} o={m} />
            ))}
          </group>
          <group ref={rig("spin")} position={[0, 0.2, -0.05]}>
            <P g="cyl" c={s.accent} p={[0, -0.04, 0]} s={[0.02, 0.1, 0.02]} o={m} />
            <P g="torus" c={s.accent} p={[0.07, 0.03, 0]} s={0.05} r={[0, Math.PI / 2, 0]} o={m} />
            <P g="torus" c={s.accent} p={[-0.07, 0.03, 0]} s={0.05} r={[0, Math.PI / 2, 0]} o={m} />
          </group>
          <group ref={rig("tail")} position={[0, 0, -0.3]}>
            <P g="cyl" c={s.accent} p={[0, 0.05, -0.1]} s={[0.012, 0.25, 0.012]} r={[1.2, 0, 0]} />
          </group>
        </group>
        {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <P key={`${sx}${sz}`} g="cyl" c="#1f2937" p={[sx * 0.17, 0.05, sz * 0.15]} s={[0.05, 0.03, 0.05]} r={[0, 0, Math.PI / 2]} />))}
      </group>
    );
  }
  if (s.form === "tank") {
    return (
      <group>
        <group ref={rig("torso")} position={[0, 0.15, 0]}>
          <P g="box" c={s.metal} p={[0, 0.08, 0]} s={[0.5, 0.18, 0.62]} o={m} />
          {[-1, 1].map((sx) => (
            <P key={sx} g="box" c="#1f2937" p={[sx * 0.29, 0, 0]} s={[0.1, 0.16, 0.66]} />
          ))}
          <group ref={rig("head")} position={[0, 0.25, -0.02]}>
            <P g="cyl" c={s.accent} s={[0.18, 0.14, 0.18]} o={m} />
            <P g="cyl" c={s.metal} p={[0, 0.02, 0.28]} s={[0.04, 0.4, 0.04]} r={[Math.PI / 2, 0, 0]} o={m} />
            <P g="cyl" c="#292524" p={[-0.08, 0.2, -0.06]} s={[0.04, 0.25, 0.04]} />
            <P g="box" c={s.eye} p={[0, 0.03, 0.17]} s={[0.15, 0.03, 0.02]} o={{ glow: 2 }} />
          </group>
          <group ref={rig("spin")} position={[-0.08, 0.6, -0.08]}>
            <P g="sphere" c="#a8a29e" s={0.06} o={{ alpha: 0.6 }} />
            <P g="sphere" c="#d6d3d1" p={[0.04, 0.1, 0]} s={0.045} o={{ alpha: 0.5 }} />
          </group>
        </group>
      </group>
    );
  }
  const big = s.form === "golem" || s.form === "titan";
  const tw = big ? 0.48 : 0.36;
  return (
    <group>
      {[-1, 1].map((sx) => (
        <group key={sx} ref={sx < 0 ? rig("legL") : rig("legR")} position={[sx * 0.11, 0.36, 0]}>
          <P g="box" c={s.accent} p={[0, -0.18, 0]} s={[0.14, 0.36, 0.16]} o={m} />
        </group>
      ))}
      <group ref={rig("torso")} position={[0, 0.36, 0]}>
        <P g="box" c={s.metal} p={[0, 0.22, 0]} s={[tw, 0.42, 0.28]} o={m} />
        <P g="sphere" c={s.eye} p={[0, 0.24, 0.14]} s={big ? 0.07 : 0.05} o={{ glow: 2 }} />
        {s.form === "titan" &&
          [-1, 1].map((sx) => <P key={sx} g="sphere" c={s.accent} p={[sx * 0.3, 0.42, 0]} s={[0.13, 0.1, 0.15]} o={m} />)}
        <group ref={rig("head")} position={[0, 0.55, 0]}>
          {s.form === "golem" ? (
            <>
              <P g="box" c={s.metal} s={[0.24, 0.18, 0.22]} o={{ rough: 0.9 }} />
              <P g="sphere" c={s.eye} p={[0, 0.01, 0.11]} s={0.045} o={{ glow: 2.5 }} />
            </>
          ) : (
            <>
              <P g="box" c={s.metal} s={[0.26, 0.2, 0.22]} o={m} />
              <P g="box" c={s.eye} p={[0, 0.01, 0.112]} s={[0.18, 0.05, 0.01]} o={{ glow: 2.5 }} />
              <P g="cyl" c={s.accent} p={[0, 0.16, 0]} s={[0.01, 0.12, 0.01]} />
              <P g="sphere" c={s.eye} p={[0, 0.23, 0]} s={0.025} o={{ glow: 2 }} />
            </>
          )}
        </group>
        {[-1, 1].map((sx) => (
          <group key={sx} ref={sx < 0 ? rig("armL") : rig("armR")} position={[sx * (tw / 2 + 0.06), 0.38, 0]}>
            <P g="box" c={s.accent} p={[0, -0.16, 0]} s={[0.1, 0.32, 0.1]} o={m} />
            <P g={big ? "box" : "sphere"} c={s.metal} p={[0, -0.36, 0]} s={big ? [0.16, 0.14, 0.16] : 0.06} o={m} />
            {sx > 0 && s.form === "bot" && (
              <group position={[0, -0.36, 0]}>
                <WeaponMesh w="wrench" accent={s.accent} />
              </group>
            )}
            {sx > 0 && s.form === "smith" && (
              <group position={[0, -0.36, 0]}>
                <WeaponMesh w="hammer" accent="#57534e" />
              </group>
            )}
          </group>
        ))}
      </group>
    </group>
  );
}

/* ── 원소 ─────────────────────────────────────────────────── */

function Elemental({ s, rig }: { s: Extract<FigureSpec, { kind: "elemental" }>; rig: Rig }) {
  const eyes = (y: number, z: number, c = "#1c1917", g = 0) => (
    <>
      <P g="sphere" c={c} p={[-0.06, y, z]} s={0.03} o={{ glow: g }} />
      <P g="sphere" c={c} p={[0.06, y, z]} s={0.03} o={{ glow: g }} />
    </>
  );
  switch (s.form) {
    case "flame":
      return (
        <group ref={rig("torso")} position={[0, 0.05, 0]}>
          <P g="cone" c={s.color} p={[0, 0.3, 0]} s={[0.22, 0.6, 0.22]} o={{ glow: 1.2 }} />
          <P g="cone" c={s.core} p={[0, 0.25, 0.05]} s={[0.13, 0.4, 0.13]} o={{ glow: 1.5 }} />
          <group ref={rig("head")}>{eyes(0.25, 0.17)}</group>
          <group ref={rig("spin")}>
            {[0, 1, 2].map((i) => (
              <P key={i} g="cone" c={s.color} p={[Math.cos(i * 2.1) * 0.18, 0.5 + i * 0.05, Math.sin(i * 2.1) * 0.18]} s={[0.05, 0.16, 0.05]} o={{ glow: 1.5 }} />
            ))}
          </group>
        </group>
      );
    case "drop":
      return (
        <group ref={rig("torso")} position={[0, 0.05, 0]}>
          <P g="sphere" c={s.color} p={[0, 0.25, 0]} s={0.25} o={{ alpha: 0.75, glow: 0.3, rough: 0.1 }} />
          <P g="cone" c={s.color} p={[0, 0.58, 0]} s={[0.17, 0.32, 0.17]} o={{ alpha: 0.75, glow: 0.3, rough: 0.1 }} />
          <P g="sphere" c={s.core} p={[-0.08, 0.36, 0.14]} s={0.05} o={{ glow: 1 }} />
          <group ref={rig("head")}>{eyes(0.26, 0.23)}</group>
        </group>
      );
    case "tornado":
      return (
        <group ref={rig("torso")}>
          <group ref={rig("spin")}>
            {[0, 1, 2, 3, 4].map((i) => (
              <P key={i} g="torus" c={i % 2 ? s.color : s.core} p={[Math.sin(i) * 0.03, 0.12 + i * 0.16, 0]} s={[0.08 + i * 0.06, 0.08 + i * 0.06, 0.12]} r={[Math.PI / 2, 0, 0]} o={{ glow: 0.5, alpha: 0.85 }} />
            ))}
          </group>
          <group ref={rig("head")} position={[0, 0.55, 0.25]}>
            {eyes(0, 0, "#0e7490", 1)}
          </group>
        </group>
      );
    case "lava":
      return (
        <group>
          {[-1, 1].map((sx) => (
            <group key={sx} ref={sx < 0 ? rig("legL") : rig("legR")} position={[sx * 0.13, 0.3, 0]}>
              <P g="ico" c={s.color} p={[0, -0.15, 0]} s={[0.12, 0.17, 0.12]} o={{ rough: 0.95 }} />
            </group>
          ))}
          <group ref={rig("torso")} position={[0, 0.3, 0]}>
            <P g="ico" c={s.color} p={[0, 0.26, 0]} s={[0.3, 0.3, 0.24]} o={{ rough: 0.95 }} />
            <P g="box" c={s.core} p={[0, 0.26, 0.2]} s={[0.04, 0.32, 0.04]} r={[0, 0, 0.4]} o={{ glow: 2.5 }} />
            <P g="box" c={s.core} p={[0.08, 0.18, 0.19]} s={[0.03, 0.18, 0.03]} r={[0, 0, -0.6]} o={{ glow: 2.5 }} />
            <group ref={rig("head")} position={[0, 0.62, 0]}>
              <P g="ico" c={s.color} s={0.15} o={{ rough: 0.95 }} />
              {eyes(0.02, 0.12, s.core, 3)}
            </group>
            {[-1, 1].map((sx) => (
              <group key={sx} ref={sx < 0 ? rig("armL") : rig("armR")} position={[sx * 0.34, 0.38, 0]}>
                <P g="ico" c={s.color} p={[0, -0.2, 0]} s={[0.12, 0.2, 0.12]} o={{ rough: 0.95 }} />
                <P g="ico" c={s.core} p={[0, -0.42, 0]} s={0.09} o={{ glow: 2 }} />
              </group>
            ))}
          </group>
        </group>
      );
    case "storm":
      return (
        <group ref={rig("torso")} position={[0, 0.2, 0]}>
          {[
            [0, 0.45, 0, 0.24],
            [-0.2, 0.4, 0, 0.17],
            [0.2, 0.42, 0, 0.18],
            [0, 0.58, -0.05, 0.16],
          ].map(([x, y, z, r], i) => (
            <P key={i} g="sphere" c={s.color} p={[x, y, z]} s={r} o={{ rough: 0.9 }} />
          ))}
          <group ref={rig("head")} position={[0, 0.45, 0.22]}>
            {eyes(0, 0, s.core, 2.5)}
          </group>
          <group ref={rig("spin")}>
            <P g="box" c={s.core} p={[0.02, 0.15, 0.05]} s={[0.04, 0.22, 0.02]} r={[0, 0, 0.5]} o={{ glow: 3 }} />
            <P g="box" c={s.core} p={[-0.03, -0.02, 0.05]} s={[0.04, 0.2, 0.02]} r={[0, 0, -0.5]} o={{ glow: 3 }} />
          </group>
        </group>
      );
    default:
      return (
        <group ref={rig("torso")} position={[0, 0.55, 0]}>
          <group ref={rig("spin")}>
            <P g="ico" c={s.color} s={0.26} o={{ glow: 1.6, metal: 0.3, rough: 0.2 }} />
            <P g="torus" c={s.core} s={[0.38, 0.38, 0.08]} r={[1.2, 0, 0]} o={{ glow: 2 }} />
            <P g="torus" c={s.color} s={[0.45, 0.45, 0.06]} r={[0.3, 1, 0]} o={{ glow: 1.5 }} />
          </group>
          <group ref={rig("head")} position={[0, 0.02, 0.24]}>
            {eyes(0, 0, "#78350f")}
          </group>
        </group>
      );
  }
}

/* ── 망령 ─────────────────────────────────────────────────── */

function Wraith({ s, rig }: { s: Extract<FigureSpec, { kind: "wraith" }>; rig: Rig }) {
  return (
    <group ref={rig("torso")} position={[0, 0.12, 0]}>
      <P g="cone" c={s.cloak} p={[0, 0.32, 0]} s={[0.28, 0.66, 0.28]} r={[Math.PI, 0, 0]} o={{ alpha: 0.85 }} />
      <P g="sphere" c={s.eye} p={[0, 0.08, 0]} s={[0.22, 0.1, 0.22]} o={{ glow: 1, alpha: 0.35 }} />
      <group ref={rig("head")} position={[0, 0.7, 0]}>
        <P g="sphere" c={s.cloak} s={0.18} o={{ alpha: 0.9 }} />
        <P g="sphere" c="#020617" p={[0, -0.01, 0.07]} s={[0.13, 0.13, 0.12]} />
        <P g="sphere" c={s.eye} p={[-0.05, 0, 0.17]} s={0.03} o={{ glow: 3 }} />
        <P g="sphere" c={s.eye} p={[0.05, 0, 0.17]} s={0.03} o={{ glow: 3 }} />
      </group>
      {[-1, 1].map((sx) => (
        <group key={sx} ref={sx < 0 ? rig("armL") : rig("armR")} position={[sx * 0.2, 0.5, 0.02]}>
          <P g="cone" c={s.cloak} p={[0, -0.14, 0.05]} s={[0.06, 0.3, 0.06]} r={[Math.PI - 0.3, 0, 0]} o={{ alpha: 0.85 }} />
        </group>
      ))}
    </group>
  );
}

/* ── 새 ───────────────────────────────────────────────────── */

function Bird({ s, rig }: { s: Extract<FigureSpec, { kind: "bird" }>; rig: Rig }) {
  return (
    <group>
      {[-1, 1].map((sx) => (
        <P key={sx} g="cyl" c={s.beak} p={[sx * 0.06, 0.08, 0]} s={[0.015, 0.16, 0.015]} />
      ))}
      <group ref={rig("torso")} position={[0, 0.3, 0]}>
        <P g="sphere" c={s.color} s={[0.17, 0.18, 0.24]} r={[-0.3, 0, 0]} />
        <group ref={rig("head")} position={[0, 0.2, 0.12]}>
          <P g="sphere" c={s.color} s={0.12} />
          <P g="cone" c={s.beak} p={[0, -0.01, 0.15]} s={[0.04, 0.12, 0.04]} r={[Math.PI / 2, 0, 0]} />
          <P g="sphere" c="#ef4444" p={[-0.06, 0.03, 0.08]} s={0.022} o={{ glow: 2 }} />
          <P g="sphere" c="#ef4444" p={[0.06, 0.03, 0.08]} s={0.022} o={{ glow: 2 }} />
        </group>
        {[-1, 1].map((sx) => (
          <group key={sx} ref={sx < 0 ? rig("wingL") : rig("wingR")} position={[sx * 0.14, 0.05, 0]}>
            <P g="box" c={s.color} p={[sx * 0.15, 0, -0.03]} s={[0.3, 0.025, 0.2]} />
          </group>
        ))}
        <P g="box" c={s.color} p={[0, -0.05, -0.25]} s={[0.12, 0.02, 0.18]} r={[0.4, 0, 0]} />
      </group>
    </group>
  );
}

/* ── 용 ───────────────────────────────────────────────────── */

function Dragon({ s, rig }: { s: Extract<FigureSpec, { kind: "dragon" }>; rig: Rig }) {
  const low = s.form === "lizard";
  const legH = low ? 0.1 : 0.2;
  const by = legH + 0.2;
  const wingSpan = s.form === "bat" ? 0.62 : s.form === "whelp" ? 0.3 : s.form === "lizard" ? 0 : 0.5;
  return (
    <group>
      {s.form === "whelp" && <P g="sphere" c="#f5f5f4" p={[0, 0.1, 0]} s={[0.26, 0.14, 0.26]} />}
      <group ref={rig("torso")} position={[0, by, 0]}>
        <P g="sphere" c={s.skin} s={[0.24, 0.22, low ? 0.42 : 0.32]} o={{ rough: 0.45, metal: 0.2 }} />
        <P g="sphere" c={s.belly} p={[0, -0.07, 0.07]} s={[0.17, 0.15, 0.24]} />
        {s.form === "wyrm" && [-0.15, 0, 0.15].map((z) => <P key={z} g="cone" c={s.belly} p={[0, 0.22, z]} s={[0.05, 0.1, 0.05]} />)}
        <group ref={rig("head")} position={[0, low ? 0.08 : 0.24, low ? 0.4 : 0.3]}>
          {!low && <P g="cyl" c={s.skin} p={[0, -0.08, -0.06]} s={[0.08, 0.22, 0.08]} r={[0.6, 0, 0]} />}
          <P g="box" c={s.skin} p={[0, 0.04, 0.04]} s={[0.2, 0.17, 0.2]} o={{ rough: 0.45, metal: 0.2 }} />
          <P g="box" c={s.skin} p={[0, 0.0, 0.17]} s={[0.15, 0.1, 0.16]} />
          <P g="box" c={s.belly} p={[0, -0.05, 0.17]} s={[0.13, 0.03, 0.15]} />
          <P g="sphere" c="#fde047" p={[-0.08, 0.08, 0.12]} s={0.03} o={{ glow: 2 }} />
          <P g="sphere" c="#fde047" p={[0.08, 0.08, 0.12]} s={0.03} o={{ glow: 2 }} />
          {s.form !== "whelp" &&
            [-1, 1].map((sx) => (
              <P key={sx} g="cone" c={s.form === "elder" ? "#fde68a" : "#e7e5e4"} p={[sx * 0.07, 0.17, -0.06]} s={[0.03, s.form === "elder" ? 0.22 : 0.13, 0.03]} r={[-0.6, 0, -sx * 0.25]} />
            ))}
          {(s.form === "drake" || s.form === "lizard") && <P g="sphere" c="#fb923c" p={[0, -0.02, 0.28]} s={0.05} o={{ glow: 3 }} />}
        </group>
        {wingSpan > 0 &&
          [-1, 1].map((sx) => (
            <group key={sx} ref={sx < 0 ? rig("wingL") : rig("wingR")} position={[sx * 0.14, 0.14, -0.02]}>
              <P g="cone" c={s.wing} p={[sx * wingSpan * 0.5, 0.06, -0.06]} s={[wingSpan * 0.5, 0.02, 0.26]} r={[0, 0, sx * -Math.PI / 2]} o={{ alpha: s.form === "bat" ? 0.9 : 1 }} />
              <P g="cyl" c={s.skin} p={[sx * wingSpan * 0.5, 0.08, 0.04]} s={[0.018, wingSpan, 0.018]} r={[0, 0, Math.PI / 2]} />
            </group>
          ))}
        <group ref={rig("tail")} position={[0, -0.02, low ? -0.38 : -0.28]}>
          <P g="cone" c={s.skin} p={[0, 0, -0.15]} s={[0.08, 0.36, 0.08]} r={[-Math.PI / 2 - 0.25, 0, 0]} />
          {s.form === "lizard" && <P g="cone" c="#fb923c" p={[0, 0.12, -0.32]} s={[0.06, 0.16, 0.06]} o={{ glow: 2.5 }} />}
        </group>
      </group>
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <group key={`${sx}${sz}`} ref={sz > 0 ? (sx < 0 ? rig("legL") : undefined) : sx < 0 ? rig("legR") : undefined} position={[sx * 0.14, legH, sz * (low ? 0.22 : 0.15)]}>
            <P g="cyl" c={s.skin} p={[0, -legH / 2, 0]} s={[0.05, legH, 0.05]} />
          </group>
        )),
      )}
    </group>
  );
}

/* ── 공개 컴포넌트 ───────────────────────────────────────── */

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (Math.abs(h) % 1000) / 1000;
}

export default function Figure({ defId, uid, golden, actRef }: { defId: string; uid: string; golden: boolean; actRef: MutableRefObject<FigureAct> }) {
  const spec = FIGURES[defId] ?? FIGURES.n_kid;
  const nodes = useRef<Partial<Record<Part, THREE.Group | null>>>({});
  const rig = useMemo<Rig>(() => (part) => (node) => void (nodes.current[part] = node), []);
  const phase = hash(uid) * 10;
  const sparkle = useRef<THREE.Group>(null);
  const size = ("size" in spec && spec.size ? spec.size : 1) * (golden ? 1.12 : 1);
  const kind = spec.kind;

  useFrame(() => {
    const t = performance.now() / 1000 + phase;
    const { swing, hit } = actRef.current;
    const up = Math.max(0, -swing);
    const down = Math.max(0, swing);
    const breathe = Math.sin(t * 2.2);
    const root = nodes.current.root;
    if (root) {
      const float = kind === "wraith" || kind === "elemental" ? 0.06 + Math.sin(t * 1.8) * 0.05 : 0;
      root.position.y = float + (kind === "human" || kind === "robot" ? 0 : Math.abs(breathe) * 0.01);
      root.rotation.x = -hit * 0.45 + (kind === "beast" || kind === "dragon" ? down * 0.25 - up * 0.2 : 0);
      root.rotation.z = hit * 0.18 * Math.sin(t * 30);
    }
    const torso = nodes.current.torso;
    if (torso) {
      torso.scale.y = 1 + breathe * 0.02;
      if (kind === "human" || kind === "robot") torso.rotation.x = down * 0.3 - up * 0.15;
      if (kind === "elemental") torso.scale.setScalar(1 + down * 0.25 + breathe * 0.03);
    }
    const head = nodes.current.head;
    if (head) {
      head.rotation.y = Math.sin(t * 0.7) * 0.25;
      head.rotation.x = (kind === "beast" || kind === "dragon" || kind === "bird" ? down * 0.5 - up * 0.4 : 0) + Math.sin(t * 1.3) * 0.05;
      if (kind === "beast" || kind === "dragon") head.position.z = (head.userData.z0 ??= head.position.z) + down * 0.12;
    }
    // 무기 팔: 예비 동작에서 높이 치켜들고, 내려치기에서 앞으로 휘두름
    const armR = nodes.current.armR;
    if (armR) armR.rotation.x = -0.1 - up * 2.6 + down * 1.3 + Math.sin(t * 2) * 0.05;
    const armL = nodes.current.armL;
    if (armL) armL.rotation.x = -0.15 - up * 0.6 - down * 0.5 + Math.sin(t * 2 + 1) * 0.05;
    const walk = Math.sin(t * 9) * (Math.abs(swing) > 0.05 ? 0.4 : 0);
    if (nodes.current.legL) nodes.current.legL.rotation.x = walk;
    if (nodes.current.legR) nodes.current.legR.rotation.x = -walk;
    const flap = Math.sin(t * (Math.abs(swing) > 0.05 ? 18 : 4)) * (Math.abs(swing) > 0.05 ? 0.7 : 0.18);
    if (nodes.current.wingL) nodes.current.wingL.rotation.z = 0.25 + flap;
    if (nodes.current.wingR) nodes.current.wingR.rotation.z = -0.25 - flap;
    if (nodes.current.tail) nodes.current.tail.rotation.y = Math.sin(t * 3) * 0.35;
    if (nodes.current.spin) nodes.current.spin.rotation.y = t * (2 + down * 10);
    if (sparkle.current) sparkle.current.rotation.y = t * 1.5;
  });

  let body: ReactNode;
  if (spec.kind === "human") body = <Human s={spec} rig={rig} />;
  else if (spec.kind === "beast") body = <Beast s={spec} rig={rig} />;
  else if (spec.kind === "robot") body = <Robot s={spec} rig={rig} />;
  else if (spec.kind === "elemental") body = <Elemental s={spec} rig={rig} />;
  else if (spec.kind === "wraith") body = <Wraith s={spec} rig={rig} />;
  else if (spec.kind === "bird") body = <Bird s={spec} rig={rig} />;
  else body = <Dragon s={spec} rig={rig} />;

  return (
    <group scale={size}>
      <group ref={rig("root")}>{body}</group>
      {golden && (
        <group ref={sparkle} position={[0, 0.6, 0]}>
          {[0, 1, 2, 3, 4].map((i) => (
            <P key={i} g="oct" c="#fde047" p={[Math.cos((i / 5) * Math.PI * 2) * 0.42, Math.sin(i * 1.7) * 0.25, Math.sin((i / 5) * Math.PI * 2) * 0.42]} s={0.035} o={{ glow: 2.5 }} />
          ))}
        </group>
      )}
    </group>
  );
}
