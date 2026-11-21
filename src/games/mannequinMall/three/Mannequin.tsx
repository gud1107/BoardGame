"use client";

import { useMemo } from "react";
import * as THREE from "three";

/**
 * 마네킹 한 개 — 매끈한 상아색 플라스틱 몸, 얼굴 없는 달걀 머리, 관절마다 피벗.
 * 화면(MallScene)이 매 프레임 `applyPose`로 관절을 돌린다. 살아 있는지는 겉으로 똑같고,
 * 정체가 드러났을 때만(플래시·끈·쓰러짐) 두 눈이 붉게 빛난다.
 */

export interface MannequinRig {
  root: THREE.Group | null;
  tilt: THREE.Group | null;
  torso: THREE.Group | null;
  head: THREE.Group | null;
  ls: THREE.Group | null;
  le: THREE.Group | null;
  rs: THREE.Group | null;
  re: THREE.Group | null;
  lh: THREE.Group | null;
  lk: THREE.Group | null;
  rh: THREE.Group | null;
  rk: THREE.Group | null;
  eyes: THREE.MeshStandardMaterial | null;
  /** 🎀 포장 끈 (묶였을 때만 보인다) */
  band: THREE.Mesh | null;
}

export const emptyRig = (): MannequinRig => ({ root: null, tilt: null, torso: null, head: null, ls: null, le: null, rs: null, re: null, lh: null, lk: null, rh: null, rk: null, eyes: null, band: null });

/** 포즈: [왼어깨 앞, 왼어깨 옆, 왼팔꿈치, 오른어깨 앞, 오른어깨 옆, 오른팔꿈치, 왼엉덩이, 오른엉덩이, 왼무릎, 오른무릎, 고개 숙임, 고개 갸웃, 고개 돌림, 상체 숙임] */
export type PoseVec = [number, number, number, number, number, number, number, number, number, number, number, number, number, number];

export const POSE_TABLE: PoseVec[] = [
  // 0 진열 자세: 팔을 살짝 벌리고 똑바로
  [0.05, -0.14, 0.12, 0.05, 0.14, 0.12, 0, 0, 0, 0, 0, 0, 0, 0],
  // 1 한 손은 허리에
  [0.1, -0.12, 0.1, 0.25, 0.75, 1.55, 0.05, -0.08, 0, 0.12, -0.05, 0.12, 0.2, 0],
  // 2 손을 높이 들어 흔든다
  [0, -0.1, 0.1, 0.2, 2.55, 0.55, 0, 0, 0, 0, -0.12, -0.15, 0, -0.04],
  // 3 두 팔을 앞으로 쭉 (붙잡으러 온다)
  [1.45, -0.04, 0.05, 1.5, 0.04, 0.05, 0.2, -0.15, -0.2, 0.15, 0.18, 0, 0, 0.14],
  // 4 고개가 옆으로 꺾였다
  [0.25, -0.1, 0.4, -0.1, 0.12, 0.1, 0, 0, 0, 0, 0.1, 0.95, 0.25, 0],
  // 5 앞으로 구부정하게
  [0.7, -0.1, 0.3, 0.6, 0.1, 0.4, 0.35, 0.35, -0.5, -0.5, 0.45, 0.08, 0, 0.45],
  // 6 나를 가리킨다
  [-0.1, -0.12, 0.15, 1.55, 0.05, 0, 0, 0.1, 0, 0, 0.05, 0.08, -0.3, 0.05],
];

/** 관절을 포즈 쪽으로 `k`만큼 (1 = 바로) */
export function applyPose(r: MannequinRig, pose: number, k: number) {
  const p = POSE_TABLE[((pose % POSE_TABLE.length) + POSE_TABLE.length) % POSE_TABLE.length];
  const set = (g: THREE.Group | null, ax: "x" | "y" | "z", v: number) => {
    if (g) g.rotation[ax] += (v - g.rotation[ax]) * k;
  };
  set(r.ls, "x", p[0]);
  set(r.ls, "z", p[1]);
  set(r.le, "x", p[2]);
  set(r.rs, "x", p[3]);
  set(r.rs, "z", p[4]);
  set(r.re, "x", p[5]);
  set(r.lh, "x", p[6]);
  set(r.rh, "x", p[7]);
  set(r.lk, "x", p[8]);
  set(r.rk, "x", p[9]);
  set(r.head, "x", -p[10]);
  set(r.head, "z", p[11]);
  set(r.head, "y", p[12]);
  set(r.torso, "x", -p[13]);
}

const BODY = new THREE.MeshStandardMaterial({ color: "#e8e1d5", roughness: 0.3, metalness: 0.02 });
const JOINT = new THREE.MeshStandardMaterial({ color: "#cfc6b6", roughness: 0.4 });
const BASE = new THREE.MeshStandardMaterial({ color: "#2a2724", roughness: 0.35, metalness: 0.7 });

/** 매장별 옷 (없으면 맨몸) */
const OUTFITS: Record<string, { torso?: string; skirt?: string; legs?: string }> = {
  b: { skirt: "#7a2e3a" },
  c: { torso: "#2f3b4d", legs: "#22252b" },
  d: { torso: "#e9c46a" },
  f: { legs: "#3d405b" },
  g: { torso: "#6b4e3d" },
};
const SKIRTS = ["#7a2e3a", "#2f4d6b", "#583f6e", "#4a6b4f"];

const mat = new Map<string, THREE.MeshStandardMaterial>();
function cloth(color: string) {
  let m = mat.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
    mat.set(color, m);
  }
  return m;
}

export type RigBind = <K extends keyof MannequinRig>(key: K, value: MannequinRig[K]) => void;

export default function MannequinBody({ bind, room, id, kid, shadows }: { bind: RigBind; room: string; id: number; kid: boolean; shadows: boolean }) {
  const eyes = useMemo(() => new THREE.MeshStandardMaterial({ color: "#200000", emissive: "#ff1a0a", emissiveIntensity: 0, roughness: 0.4 }), []);
  const o = OUTFITS[room] ?? {};
  const skirt = o.skirt ? SKIRTS[id % SKIRTS.length] : null;
  const torsoMat = o.torso ? cloth(o.torso) : BODY;
  const legMat = o.legs ? cloth(o.legs) : BODY;
  const sc = kid ? 0.74 : 1;
  return (
    <group
      ref={(g) => {
        bind("root", g);
      }}
    >
      {/* 받침 */}
      <mesh position={[0, 0.015, 0]} receiveShadow material={BASE}>
        <cylinderGeometry args={[0.24, 0.26, 0.03, 18]} />
      </mesh>
      <group
        ref={(g) => {
          bind("tilt", g);
        }}
        scale={sc}
      >
        {/* 다리 */}
        {([-1, 1] as const).map((side) => (
          <group
            key={side}
            position={[side * 0.1, 0.95, 0]}
            ref={(g) => {
              bind(side < 0 ? "lh" : "rh", g);
            }}
          >
            <mesh position={[0, -0.23, 0]} castShadow={shadows} material={legMat}>
              <capsuleGeometry args={[0.065, 0.34, 4, 10]} />
            </mesh>
            <group
              position={[0, -0.47, 0]}
              ref={(g) => {
                bind(side < 0 ? "lk" : "rk", g);
              }}
            >
              <mesh position={[0, -0.21, 0]} castShadow={shadows} material={legMat}>
                <capsuleGeometry args={[0.05, 0.32, 4, 10]} />
              </mesh>
              <mesh position={[0, -0.44, -0.05]} castShadow={shadows} material={BODY}>
                <boxGeometry args={[0.08, 0.05, 0.2]} />
              </mesh>
            </group>
          </group>
        ))}
        {/* 골반 */}
        <mesh position={[0, 0.98, 0]} castShadow={shadows} material={legMat} scale={[1.25, 0.75, 0.85]}>
          <sphereGeometry args={[0.14, 14, 10]} />
        </mesh>
        {skirt && (
          <mesh position={[0, 0.82, 0]} castShadow={shadows} material={cloth(skirt)}>
            <coneGeometry args={[0.3, 0.48, 16, 1, true]} />
          </mesh>
        )}
        {/* 상체 */}
        <group
          position={[0, 1.0, 0]}
          ref={(g) => {
            bind("torso", g);
          }}
        >
          <mesh position={[0, 0.25, 0]} castShadow={shadows} material={torsoMat} scale={[1.2, 1, 0.78]}>
            <capsuleGeometry args={[0.14, 0.3, 4, 12]} />
          </mesh>
          <mesh
            position={[0, 0.3, 0]}
            rotation={[Math.PI / 2, 0, 0]}
            visible={false}
            ref={(m) => {
              bind("band", m);
            }}
          >
            <torusGeometry args={[0.2, 0.025, 6, 20]} />
            <meshStandardMaterial color="#e11d48" emissive="#9f1239" emissiveIntensity={0.6} roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.52, 0]} material={JOINT}>
            <cylinderGeometry args={[0.045, 0.05, 0.1, 10]} />
          </mesh>
          {/* 팔 */}
          {([-1, 1] as const).map((side) => (
            <group
              key={side}
              position={[side * 0.22, 0.43, 0]}
              ref={(g) => {
                bind(side < 0 ? "ls" : "rs", g);
              }}
            >
              <mesh material={JOINT}>
                <sphereGeometry args={[0.055, 10, 8]} />
              </mesh>
              <mesh position={[0, -0.16, 0]} castShadow={shadows} material={torsoMat === BODY ? BODY : torsoMat}>
                <capsuleGeometry args={[0.042, 0.22, 4, 8]} />
              </mesh>
              <group
                position={[0, -0.31, 0]}
                ref={(g) => {
                  bind(side < 0 ? "le" : "re", g);
                }}
              >
                <mesh position={[0, -0.13, 0]} castShadow={shadows} material={BODY}>
                  <capsuleGeometry args={[0.036, 0.2, 4, 8]} />
                </mesh>
                <mesh position={[0, -0.29, -0.01]} castShadow={shadows} material={BODY} scale={[0.7, 1.15, 0.45]}>
                  <sphereGeometry args={[0.05, 10, 8]} />
                </mesh>
              </group>
            </group>
          ))}
          {/* 머리 */}
          <group
            position={[0, 0.58, 0]}
            ref={(g) => {
              bind("head", g);
            }}
          >
            <mesh position={[0, 0.12, 0]} castShadow={shadows} material={BODY} scale={[0.85, 1.15, 0.95]}>
              <sphereGeometry args={[0.12, 18, 14]} />
            </mesh>
            {/* 눈 자리 (평소엔 거의 안 보이는 홈, 드러나면 붉게) */}
            {[-0.042, 0.042].map((x) => (
              <mesh
                key={x}
                position={[x, 0.135, -0.108]}
                material={eyes}
                ref={() => {
                  bind("eyes", eyes);
                }}
              >
                <sphereGeometry args={[0.014, 8, 6]} />
              </mesh>
            ))}
          </group>
        </group>
      </group>
    </group>
  );
}
