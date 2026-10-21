"use client";

import { useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { clamp01, easeInOut, easeOutBack, emojiTexture } from "./tableKit";
import { distanceBoost } from "./ScreenSprite";

/**
 * Small props shared by the 3D table games: cards, coins, fly-in animation,
 * floating icons. Presentation only.
 */

/**
 * A card lying flat on the table (local y = up). `face` null = face down.
 * The face's top edge points toward local −z (away from the owner, so it
 * reads upright from the seat it belongs to).
 */
export function FlatCard({ face, back, w = 0.3, h = 0.42, lift = 0.004, glow }: { face: THREE.Texture | null; back: THREE.Texture; w?: number; h?: number; lift?: number; glow?: string | null }) {
  return (
    <group position={[0, lift, 0]}>
      <mesh rotation-x={-Math.PI / 2} castShadow receiveShadow>
        <boxGeometry args={[w, h, 0.006]} />
        <meshStandardMaterial color="#f5efe0" roughness={0.6} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.0035, 0]}>
        <planeGeometry args={[w * 0.98, h * 0.98]} />
        <meshStandardMaterial map={face ?? back} roughness={0.55} />
      </mesh>
      {glow && (
        <mesh rotation-x={-Math.PI / 2} position={[0, -0.001, 0]}>
          <planeGeometry args={[w * 1.25, h * 1.2]} />
          <meshBasicMaterial color={glow} transparent opacity={0.45} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

/** A card standing up on its long edge (local +z = its face), e.g. an influence card turned toward me. */
export function StandingCard({ face, back, w = 0.3, h = 0.42, tilt = -0.25 }: { face: THREE.Texture | null; back: THREE.Texture; w?: number; h?: number; tilt?: number }) {
  return (
    <group rotation-x={tilt} position={[0, h / 2, 0]}>
      <mesh castShadow>
        <boxGeometry args={[w, h, 0.006]} />
        <meshStandardMaterial color="#f5efe0" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0, 0.0035]}>
        <planeGeometry args={[w * 0.98, h * 0.98]} />
        <meshStandardMaterial map={face ?? back} roughness={0.55} />
      </mesh>
      <mesh position={[0, 0, -0.0035]} rotation-y={Math.PI}>
        <planeGeometry args={[w * 0.98, h * 0.98]} />
        <meshStandardMaterial map={back} roughness={0.55} />
      </mesh>
    </group>
  );
}

/**
 * Animates its children from `from` (parent-local) to the origin along an
 * arc the first time it mounts (re-key it to replay). Optional spin flips
 * the payload around z on the way (a card thrown face down → face up).
 */
export function FlyIn({ from, delay = 0, dur = 0.55, arc = 0.5, spin = 0, children }: { from: THREE.Vector3; delay?: number; dur?: number; arc?: number; spin?: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const born = useRef<number | null>(null);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    if (born.current === null) born.current = clock.elapsedTime;
    const t = clamp01((clock.elapsedTime - born.current - delay) / dur);
    const e = easeInOut(t);
    g.position.set(from.x * (1 - e), from.y * (1 - e) + Math.sin(Math.PI * e) * arc, from.z * (1 - e));
    g.rotation.z = spin * (1 - e);
    g.visible = clock.elapsedTime - born.current >= delay;
  });
  return (
    <group ref={ref} position={from} visible={false}>
      {children}
    </group>
  );
}

/** Scales its children in with an overshoot when mounted. */
export function PopIn({ delay = 0, children }: { delay?: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const born = useRef<number | null>(null);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    if (born.current === null) born.current = clock.elapsedTime;
    const k = easeOutBack(clamp01((clock.elapsedTime - born.current - delay) / 0.4));
    g.scale.setScalar(Math.max(0.0001, k));
  });
  return (
    <group ref={ref} scale={0.0001}>
      {children}
    </group>
  );
}

const coinGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.018, 20);
const coinEdgeGeo = new THREE.TorusGeometry(0.06, 0.004, 4, 20);

/** Gold coins stacked in short columns (10 per column). */
export function CoinStack({ count, color = "#f2c14e", max = 30 }: { count: number; color?: string; max?: number }) {
  const shown = Math.min(count, max);
  const coins = useMemo(() => {
    const out: [number, number, number, number][] = [];
    for (let i = 0; i < shown; i++) {
      const col = Math.floor(i / 10);
      const row = i % 10;
      const jitter = Math.sin(i * 12.9898) * 0.006;
      out.push([(col - (Math.ceil(shown / 10) - 1) / 2) * 0.14 + jitter, 0.009 + row * 0.019, jitter, i * 0.7]);
    }
    return out;
  }, [shown]);
  return (
    <group>
      {coins.map(([x, y, z, r], i) => (
        <group key={i} position={[x, y, z]} rotation-y={r}>
          <mesh geometry={coinGeo} castShadow>
            <meshStandardMaterial color={color} metalness={0.9} roughness={0.28} />
          </mesh>
          <mesh geometry={coinEdgeGeo} rotation-x={Math.PI / 2} position={[0, 0.009, 0]}>
            <meshStandardMaterial color="#a8801e" metalness={0.9} roughness={0.35} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** A floating emoji/icon sprite that bobs and stays legible at a distance. */
export function FloatIcon({ icon, y = 0.4, size = 0.28, bob = 0.04 }: { icon: string; y?: number; size?: number; bob?: number }) {
  const ref = useRef<THREE.Sprite>(null);
  const tex = emojiTexture(icon);
  useFrame(({ clock, camera }) => {
    const s = ref.current;
    if (!s) return;
    const k = distanceBoost(s, camera, 3.2, 2);
    s.scale.set(size * k, size * k, 1);
    s.position.y = y + Math.sin(clock.elapsedTime * 2.4 + y * 7) * bob;
  });
  return (
    <sprite ref={ref} position={[0, y, 0]} renderOrder={8}>
      <spriteMaterial map={tex} transparent depthWrite={false} />
    </sprite>
  );
}

/** An expanding, fading shock ring on the table — a play landing, a coin hit. */
export function ImpactRing({ color = "#fde68a", size = 0.9, dur = 0.7 }: { color?: string; size?: number; dur?: number }) {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const born = useRef<number | null>(null);
  useFrame(({ clock }) => {
    if (born.current === null) born.current = clock.elapsedTime;
    const t = clamp01((clock.elapsedTime - born.current) / dur);
    mesh.current?.scale.setScalar(0.2 + t * size);
    if (mat.current) mat.current.opacity = (1 - t) * 0.8;
  });
  return (
    <mesh ref={mesh} rotation-x={-Math.PI / 2} position={[0, 0.02, 0]}>
      <ringGeometry args={[0.8, 1, 48]} />
      <meshBasicMaterial ref={mat} color={color} transparent opacity={0.8} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** A soft round shadow / glow disc lying on the table. */
export function GlowDisc({ color, r = 0.4, opacity = 0.35, pulse = true }: { color: string; r?: number; opacity?: number; pulse?: boolean }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current && pulse) mat.current.opacity = opacity * (0.75 + Math.sin(clock.elapsedTime * 3) * 0.25);
  });
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.008, 0]}>
      <circleGeometry args={[r, 32]} />
      <meshBasicMaterial ref={mat} color={color} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}
