"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { AttackKind } from "../attackStyle";
import { requestFlash } from "./flashPool";

/**
 * 캐릭터별 3D 타격 이펙트 — 투사체(원거리)와 충돌 순간 그림(근접·원소별).
 * 모두 시작 시각 기준 닫힌 식으로 움직이고 수명이 끝나면 부모가 목록에서 지운다.
 */

export type V3 = [number, number, number];

export type StyleFxItem =
  | { id: number; type: "proj"; kind: AttackKind; color: string; from: V3; to: V3; start: number; dur: number }
  | { id: number; type: "impact"; kind: AttackKind; color: string; at: V3; dir: V3; start: number; big: boolean }
  | { id: number; type: "aim"; color: string; from: V3; to: V3; start: number; dur: number; ranged: boolean };

type NoId<T> = T extends unknown ? Omit<T, "id"> : never;
export type StyleFxInput = NoId<StyleFxItem>;

/** 수명(ms) — 부모가 이 시간이 지나면 지운다 */
export function fxLife(f: StyleFxItem): number {
  return f.type === "proj" || f.type === "aim" ? f.dur + 50 : 900;
}

const now = () => performance.now();
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/* ── 투사체 ─────────────────────────────────────────────── */

function Projectile({ f }: { f: Extract<StyleFxItem, { type: "proj" }> }) {
  const g = useRef<THREE.Group>(null);
  const trail = useRef<(THREE.Mesh | null)[]>([]);
  const from = new THREE.Vector3(...f.from);
  const to = new THREE.Vector3(...f.to);
  const arc = f.kind === "cannon" ? 2.4 : f.kind === "arrow" ? 0.55 : f.kind === "poison" || f.kind === "water" ? 1.1 : 0.25;
  const posAt = (t: number) => {
    const p = from.clone().lerp(to, t);
    p.y += Math.sin(Math.PI * t) * arc;
    return p;
  };
  useFrame(() => {
    const t = Math.min(1, Math.max(0, (now() - f.start) / f.dur));
    const node = g.current;
    if (!node) return;
    node.visible = t > 0 && t < 1;
    const p = posAt(t);
    node.position.copy(p);
    node.lookAt(posAt(Math.min(1, t + 0.02)));
    node.rotateZ(f.kind === "leaf" || f.kind === "fairy" ? t * 20 : 0);
    trail.current.forEach((m, i) => {
      if (!m) return;
      const tt = Math.max(0, t - (i + 1) * 0.05);
      m.position.copy(posAt(tt)).sub(p);
      m.position.applyQuaternion(node.quaternion.clone().invert());
      m.scale.setScalar(Math.max(0.01, 1 - i * 0.22));
    });
  });
  const c = f.color;
  let head: React.ReactNode;
  switch (f.kind) {
    case "arrow":
      head = (
        <>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.015, 0.015, 0.55, 6]} />
            <meshStandardMaterial color="#7c4a1e" />
          </mesh>
          <mesh position={[0, 0, 0.3]} rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.045, 0.12, 8]} />
            <meshStandardMaterial color="#e5e7eb" metalness={0.8} roughness={0.2} />
          </mesh>
          <mesh position={[0, 0, -0.25]}>
            <boxGeometry args={[0.1, 0.01, 0.1]} />
            <meshBasicMaterial color={c} toneMapped={false} />
          </mesh>
        </>
      );
      break;
    case "cannon":
      head = (
        <mesh>
          <sphereGeometry args={[0.12, 12, 10]} />
          <meshStandardMaterial color="#1c1917" metalness={0.7} roughness={0.4} />
        </mesh>
      );
      break;
    case "leaf":
      head = (
        <mesh scale={[0.14, 0.02, 0.08]}>
          <sphereGeometry args={[1, 8, 6]} />
          <meshBasicMaterial color={c} toneMapped={false} />
        </mesh>
      );
      break;
    default:
      head = (
        <>
          <mesh>
            <sphereGeometry args={[f.kind === "fire" ? 0.17 : 0.12, 14, 10]} />
            <meshBasicMaterial color={f.kind === "fire" ? "#fde047" : "#ffffff"} toneMapped={false} />
          </mesh>
          <mesh>
            <sphereGeometry args={[f.kind === "fire" ? 0.26 : 0.19, 14, 10]} />
            <meshBasicMaterial color={c} toneMapped={false} transparent opacity={0.55} depthWrite={false} />
          </mesh>
        </>
      );
  }
  return (
    <group ref={g} visible={false}>
      {head}
      {f.kind !== "arrow" &&
        [0, 1, 2, 3].map((i) => (
          <mesh key={i} ref={(m) => void (trail.current[i] = m)}>
            <sphereGeometry args={[f.kind === "cannon" ? 0.09 : 0.1, 8, 6]} />
            <meshBasicMaterial color={f.kind === "cannon" ? "#a8a29e" : c} toneMapped={false} transparent opacity={0.45 - i * 0.09} depthWrite={false} />
          </mesh>
        ))}
    </group>
  );
}

/* ── 충돌 그림 ─────────────────────────────────────────── */

/** 카메라를 향하는 판 위에 그리는 근접 타격(베기·할퀴기·물기·찌르기·성광) */
function Billboard({ f, children, onFrame }: { f: Extract<StyleFxItem, { type: "impact" }>; children: React.ReactNode; onFrame: (t: number, g: THREE.Group) => void }) {
  const g = useRef<THREE.Group>(null);
  useFrame((st) => {
    const node = g.current;
    if (!node) return;
    const t = (now() - f.start) / 900;
    node.visible = t >= 0 && t <= 1;
    node.quaternion.copy(st.camera.quaternion);
    onFrame(Math.max(0, Math.min(1, t)), node);
  });
  return (
    <group ref={g} position={[f.at[0], f.at[1] + 0.65, f.at[2]]}>
      {children}
    </group>
  );
}

function fade(g: THREE.Object3D, o: number) {
  g.traverse((x) => {
    const m = (x as THREE.Mesh).material as THREE.Material | undefined;
    if (m && "opacity" in m) {
      m.transparent = true;
      (m as THREE.MeshBasicMaterial).opacity = o;
    }
  });
}

function Impact({ f }: { f: Extract<StyleFxItem, { type: "impact" }> }) {
  const c = f.color;
  const s = f.big ? 1.35 : 1;
  const ground = useRef<THREE.Group>(null);
  const sky = useRef<THREE.Group>(null);
  const lightColor = f.kind === "fire" ? "#fb923c" : f.kind === "lightning" ? "#bfdbfe" : f.kind === "holy" ? "#fde68a" : f.kind === "shadow" ? "#7c3aed" : c;
  const hasLight = ["fire", "lightning", "holy", "bolt", "fairy", "shadow", "water", "cannon"].includes(f.kind);
  useFrame(() => {
    const t = (now() - f.start) / 900;
    if (ground.current) {
      const k = Math.max(0, Math.min(1, t * 2.2));
      ground.current.scale.setScalar(0.3 + ease(k) * 2.2 * s);
      fade(ground.current, Math.max(0, 1 - k));
    }
    if (sky.current) {
      sky.current.visible = t >= 0 && t < 0.35;
      fade(sky.current, Math.sin(t * 120) > -0.3 ? 1 : 0.2);
    }
  });

  const parts: React.ReactNode[] = [];
  // 조명은 Arena의 고정 조명 풀에 요청(조명 개수가 바뀌면 셰이더가 재컴파일돼 멈칫함)
  useEffect(() => {
    if (hasLight) requestFlash([f.at[0], 1, f.at[2]], lightColor, f.kind === "lightning" ? 14 : 8, 450);
  }, [hasLight, lightColor, f.at, f.kind]);

  const angle = Math.atan2(f.dir[0], -f.dir[2]);
  switch (f.kind) {
    case "slash":
      parts.push(
        <Billboard
          key="b"
          f={f}
          onFrame={(t, g) => {
            const k = Math.min(1, t * 4);
            g.rotation.z += -0.9 + ease(k) * 1.8;
            g.scale.setScalar((0.8 + k * 0.5) * s);
            fade(g, t < 0.25 ? 1 : Math.max(0, 1 - (t - 0.25) * 2.5));
          }}
        >
          <mesh rotation={[0, 0, angle + 0.6]}>
            <torusGeometry args={[0.55, 0.035, 6, 32, Math.PI * 0.9]} />
            <meshBasicMaterial color="#ffffff" toneMapped={false} transparent />
          </mesh>
          <mesh rotation={[0, 0, angle + 0.6]}>
            <torusGeometry args={[0.55, 0.09, 6, 32, Math.PI * 0.9]} />
            <meshBasicMaterial color={c} toneMapped={false} transparent opacity={0.5} depthWrite={false} />
          </mesh>
        </Billboard>,
      );
      break;
    case "claw":
      parts.push(
        <Billboard
          key="b"
          f={f}
          onFrame={(t, g) => {
            g.children.forEach((ch, i) => {
              const k = Math.max(0, Math.min(1, (t - i * 0.04) * 6));
              ch.scale.set(k, 1, 1);
            });
            fade(g, t < 0.3 ? 1 : Math.max(0, 1 - (t - 0.3) * 2.2));
          }}
        >
          {[-1, 0, 1].map((i) => (
            <mesh key={i} position={[i * 0.16, i * -0.05, 0]} rotation={[0, 0, -0.9]}>
              <boxGeometry args={[0.8 * s, 0.05, 0.01]} />
              <meshBasicMaterial color={i === 0 ? "#ffffff" : "#ef4444"} toneMapped={false} transparent />
            </mesh>
          ))}
        </Billboard>,
      );
      break;
    case "bite":
      parts.push(
        <Billboard
          key="b"
          f={f}
          onFrame={(t, g) => {
            const k = Math.min(1, t * 6);
            const [top, bottom] = g.children;
            if (top) top.position.y = 0.35 - ease(k) * 0.3;
            if (bottom) bottom.position.y = -0.35 + ease(k) * 0.3;
            fade(g, t < 0.3 ? 1 : Math.max(0, 1 - (t - 0.3) * 2.5));
          }}
        >
          <mesh rotation={[0, 0, Math.PI]}>
            <torusGeometry args={[0.32 * s, 0.05, 6, 20, Math.PI]} />
            <meshBasicMaterial color="#fafafa" toneMapped={false} transparent />
          </mesh>
          <mesh>
            <torusGeometry args={[0.32 * s, 0.05, 6, 20, Math.PI]} />
            <meshBasicMaterial color="#fafafa" toneMapped={false} transparent />
          </mesh>
        </Billboard>,
      );
      break;
    case "stab":
      parts.push(
        <Billboard
          key="b"
          f={f}
          onFrame={(t, g) => {
            const k = t < 0.12 ? t / 0.12 : Math.max(0, 1 - (t - 0.12) * 3);
            g.scale.set(k * s, 1, 1);
            fade(g, k);
          }}
        >
          <mesh rotation={[0, 0, angle + Math.PI / 2]}>
            <boxGeometry args={[1.3, 0.035, 0.01]} />
            <meshBasicMaterial color="#ffffff" toneMapped={false} transparent />
          </mesh>
          <mesh rotation={[0, 0, angle + Math.PI / 2]}>
            <boxGeometry args={[1.1, 0.1, 0.01]} />
            <meshBasicMaterial color={c} toneMapped={false} transparent opacity={0.5} depthWrite={false} />
          </mesh>
        </Billboard>,
      );
      break;
    case "holy":
      parts.push(
        <Billboard
          key="b"
          f={f}
          onFrame={(t, g) => {
            g.scale.setScalar((0.6 + ease(Math.min(1, t * 3)) * 0.8) * s);
            g.rotation.z += t * 0.6;
            fade(g, Math.max(0, 1 - t * 1.6));
          }}
        >
          <mesh>
            <boxGeometry args={[0.16, 1.0, 0.01]} />
            <meshBasicMaterial color="#fffbeb" toneMapped={false} transparent />
          </mesh>
          <mesh position={[0, 0.15, 0]}>
            <boxGeometry args={[0.7, 0.16, 0.01]} />
            <meshBasicMaterial color="#fffbeb" toneMapped={false} transparent />
          </mesh>
          <mesh>
            <circleGeometry args={[0.6, 24]} />
            <meshBasicMaterial color={c} toneMapped={false} transparent opacity={0.35} depthWrite={false} />
          </mesh>
        </Billboard>,
      );
      break;
    case "lightning":
      parts.push(
        <group key="sky" ref={sky} position={[f.at[0], 0, f.at[2]]}>
          {Array.from({ length: 7 }, (_, i) => {
            const y0 = 4.2 - i * 0.55;
            const x = (i % 2 ? 0.18 : -0.18) * (i === 6 ? 0 : 1);
            return (
              <mesh key={i} position={[x, y0 - 0.27, 0]} rotation={[0, 0, i % 2 ? 0.55 : -0.55]}>
                <boxGeometry args={[0.07, 0.65, 0.07]} />
                <meshBasicMaterial color={i % 3 ? "#e0f2fe" : c} toneMapped={false} transparent />
              </mesh>
            );
          })}
        </group>,
      );
      break;
    case "wind":
      parts.push(
        <Billboard
          key="b"
          f={f}
          onFrame={(t, g) => {
            g.rotation.z += t * 14;
            g.scale.setScalar((0.5 + t * 0.9) * s);
            fade(g, Math.max(0, 1 - t * 1.5));
          }}
        >
          {[0, 1, 2].map((i) => (
            <mesh key={i} rotation={[0, 0, (i * Math.PI * 2) / 3]}>
              <torusGeometry args={[0.3 + i * 0.12, 0.03, 6, 24, Math.PI * 1.2]} />
              <meshBasicMaterial color={i === 1 ? "#ffffff" : c} toneMapped={false} transparent />
            </mesh>
          ))}
        </Billboard>,
      );
      break;
    case "shadow":
    case "poison":
      parts.push(
        <Billboard
          key="b"
          f={f}
          onFrame={(t, g) => {
            g.children.forEach((ch, i) => {
              ch.scale.setScalar((0.2 + ease(Math.min(1, t * 2)) * (0.45 + (i % 3) * 0.12)) * s);
              ch.position.y = (i - 2) * 0.12 + t * 0.4;
            });
            fade(g, Math.max(0, 0.75 - t * 0.9));
          }}
        >
          {Array.from({ length: 5 }, (_, i) => (
            <mesh key={i} position={[Math.cos(i * 1.3) * 0.25, 0, Math.sin(i * 1.3) * 0.05]}>
              <sphereGeometry args={[1, 12, 8]} />
              <meshBasicMaterial color={f.kind === "poison" ? (i % 2 ? "#4ade80" : "#166534") : i % 2 ? c : "#1e1b4b"} toneMapped={false} transparent depthWrite={false} />
            </mesh>
          ))}
        </Billboard>,
      );
      break;
    default:
      break;
  }
  // 바닥 충격파: 무거운 일격·포탄·불꽃·물
  if (["smash", "cannon", "fire", "water", "punch", "bolt", "fairy", "leaf"].includes(f.kind) || f.big) {
    const col = f.kind === "smash" || f.kind === "cannon" ? "#d6d3d1" : c;
    parts.push(
      <group key="g" ref={ground} position={[f.at[0], 0.04, f.at[2]]} rotation={[-Math.PI / 2, 0, 0]}>
        <mesh>
          <ringGeometry args={[0.32, 0.42, 40]} />
          <meshBasicMaterial color={col} toneMapped={false} transparent side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        {(f.kind === "smash" || f.kind === "cannon") && (
          <mesh>
            <circleGeometry args={[0.3, 24]} />
            <meshBasicMaterial color="#1c1917" transparent opacity={0.6} depthWrite={false} />
          </mesh>
        )}
      </group>,
    );
  }
  return <>{parts}</>;
}


/* ── 조준선 + 표적 ─────────────────────────────────────── */

/** 공격 예고: 공격자 → 대상으로 흐르는 점선 호와 대상 발밑의 빨간 표적 */
function Aim({ f }: { f: Extract<StyleFxItem, { type: "aim" }> }) {
  const dots = useRef<(THREE.Mesh | null)[]>([]);
  const reticle = useRef<THREE.Group>(null);
  const from = new THREE.Vector3(...f.from);
  const to = new THREE.Vector3(...f.to);
  const N = 14;
  const lift = f.ranged ? 1.2 : 0.7;
  useFrame(() => {
    const t = (now() - f.start) / f.dur;
    const on = t >= 0 && t <= 1;
    const appear = Math.min(1, t * 4);
    const fadeOut = t > 0.85 ? Math.max(0, 1 - (t - 0.85) / 0.15) : 1;
    dots.current.forEach((m, i) => {
      if (!m) return;
      m.visible = on && i / N <= appear;
      const k = ((i + ((now() / 90) % 1)) % N) / N;
      const p = from.clone().lerp(to, k);
      p.y = 0.12 + Math.sin(Math.PI * k) * lift;
      m.position.copy(p);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.85 * fadeOut;
    });
    const r = reticle.current;
    if (r) {
      r.visible = on;
      r.rotation.y = now() / 400;
      r.scale.setScalar((1.25 - 0.25 * Math.min(1, t * 3)) * (1 + Math.sin(now() / 80) * 0.05));
      r.traverse((x) => {
        const m = (x as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
        if (m) m.opacity = fadeOut;
      });
    }
  });
  return (
    <>
      {Array.from({ length: N }, (_, i) => (
        <mesh key={i} ref={(m) => void (dots.current[i] = m)} visible={false}>
          <sphereGeometry args={[0.045, 8, 6]} />
          <meshBasicMaterial color={f.color} toneMapped={false} transparent depthWrite={false} />
        </mesh>
      ))}
      <group ref={reticle} position={[f.to[0], 0.05, f.to[2]]} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.5, 0.57, 40]} />
          <meshBasicMaterial color="#ef4444" toneMapped={false} transparent side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} position={[Math.cos((i * Math.PI) / 2) * 0.66, 0, Math.sin((i * Math.PI) / 2) * 0.66]} rotation={[-Math.PI / 2, 0, (i * Math.PI) / 2]}>
            <planeGeometry args={[0.2, 0.06]} />
            <meshBasicMaterial color="#fecaca" toneMapped={false} transparent side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
        ))}
      </group>
    </>
  );
}

export function StyleFxLayer({ items }: { items: StyleFxItem[] }) {
  return (
    <>
      {items.map((f) => (f.type === "proj" ? <Projectile key={f.id} f={f} /> : f.type === "aim" ? <Aim key={f.id} f={f} /> : <Impact key={f.id} f={f} />))}
    </>
  );
}
