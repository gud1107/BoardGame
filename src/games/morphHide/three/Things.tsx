"use client";

import Prop from "../../hideAndSeek/three/Props";
import type { PropKind } from "../../hideAndSeek/house";
import type { OutdoorKind, ThingKind } from "../map";

/**
 * 맵 소품 — 집 안 가구 25종은 한밤의 숨바꼭질 모델을 그대로, 바깥 소품은 여기서.
 * 원점 = 바닥 가운데, +z = 앞.
 */

type V3 = [number, number, number];

function Box({ p, s, c, r = 0.7, m = 0, e }: { p: V3; s: V3; c: string; r?: number; m?: number; e?: string }) {
  return (
    <mesh position={p}>
      <boxGeometry args={s} />
      <meshStandardMaterial color={c} roughness={r} metalness={m} emissive={e ?? "#000"} emissiveIntensity={e ? 0.8 : 0} />
    </mesh>
  );
}

function Cyl({ p, rt, rb, h, c, seg = 14, rot }: { p: V3; rt: number; rb: number; h: number; c: string; seg?: number; rot?: V3 }) {
  return (
    <mesh position={p} rotation={rot}>
      <cylinderGeometry args={[rt, rb, h, seg]} />
      <meshStandardMaterial color={c} roughness={0.6} />
    </mesh>
  );
}

function Glow({ p, r, c }: { p: V3; r: number; c: string }) {
  return (
    <mesh position={p}>
      <sphereGeometry args={[r, 10, 8]} />
      <meshBasicMaterial color={c} toneMapped={false} />
    </mesh>
  );
}

const PROP_KINDS = new Set<string>(["shelf", "bike", "boxes", "shoecab", "coats", "sofa", "curtain", "piano", "tub", "washer", "table", "pantry", "sink", "hamper", "plant", "wardrobe", "bed", "vanity", "toybox", "tent", "bunk", "desk", "bookcase", "trunk", "mannequin"]);

export default function Thing({ kind, pedLight }: { kind: ThingKind; pedLight?: boolean }) {
  if (PROP_KINDS.has(kind)) return <Prop kind={kind as PropKind} />;
  return <Outdoor kind={kind as OutdoorKind} pedLight={pedLight} />;
}

function Outdoor({ kind, pedLight }: { kind: OutdoorKind; pedLight?: boolean }) {
  switch (kind) {
    case "trashcan":
      return (
        <group>
          <Cyl p={[0, 0.45, 0]} rt={0.3} rb={0.26} h={0.9} c="#4b7f52" />
          <Cyl p={[0, 0.93, 0]} rt={0.32} rb={0.32} h={0.08} c="#3a6342" />
          <Box p={[0, 1.0, 0]} s={[0.2, 0.05, 0.06]} c="#2d4d33" />
        </group>
      );
    case "hydrant":
      return (
        <group>
          <Cyl p={[0, 0.32, 0]} rt={0.15} rb={0.18} h={0.64} c="#d62828" />
          <Cyl p={[0, 0.7, 0]} rt={0.1} rb={0.16} h={0.14} c="#b71c1c" />
          <Cyl p={[0, 0.42, 0]} rt={0.06} rb={0.06} h={0.42} c="#b71c1c" rot={[0, 0, Math.PI / 2]} />
        </group>
      );
    case "bench":
      return (
        <group>
          <Box p={[0, 0.45, 0.05]} s={[1.8, 0.07, 0.45]} c="#a0673a" />
          <Box p={[0, 0.75, -0.2]} s={[1.8, 0.35, 0.06]} c="#a0673a" />
          {[-0.8, 0.8].map((x) => (
            <Box key={x} p={[x, 0.23, 0]} s={[0.07, 0.46, 0.5]} c="#333" m={0.5} />
          ))}
        </group>
      );
    case "cone":
      return (
        <group>
          <Box p={[0, 0.03, 0]} s={[0.45, 0.06, 0.45]} c="#f97316" />
          <Cyl p={[0, 0.36, 0]} rt={0.04} rb={0.18} h={0.62} c="#f97316" />
          <Cyl p={[0, 0.4, 0]} rt={0.11} rb={0.13} h={0.1} c="#f8fafc" />
        </group>
      );
    case "mailbox":
      return (
        <group>
          <Box p={[0, 0.55, 0]} s={[0.45, 1.1, 0.45]} c="#c1121f" />
          <Cyl p={[0, 1.1, 0]} rt={0.23} rb={0.23} h={0.45} c="#c1121f" rot={[Math.PI / 2, 0, 0]} />
          <Box p={[0, 0.85, 0.23]} s={[0.3, 0.05, 0.02]} c="#222" />
        </group>
      );
    case "vending":
      return (
        <group>
          <Box p={[0, 0.95, 0]} s={[1.0, 1.9, 0.8]} c="#1d4ed8" />
          <Box p={[-0.12, 1.15, 0.41]} s={[0.6, 1.1, 0.02]} c="#bfdbfe" e="#93c5fd" />
          <Box p={[0.36, 1.0, 0.41]} s={[0.16, 0.5, 0.02]} c="#111" />
          <Box p={[0, 0.25, 0.41]} s={[0.7, 0.18, 0.02]} c="#0f172a" />
        </group>
      );
    case "crate":
      return (
        <group>
          <Box p={[0, 0.45, 0]} s={[0.9, 0.9, 0.9]} c="#b9874f" r={0.9} />
          <Box p={[0, 0.45, 0.452]} s={[0.9, 0.12, 0.01]} c="#8d6236" />
          <Box p={[0, 0.45, -0.452]} s={[0.9, 0.12, 0.01]} c="#8d6236" />
        </group>
      );
    case "chair":
      return (
        <group>
          <Box p={[0, 0.45, 0]} s={[0.45, 0.06, 0.45]} c="#7c4a2d" />
          <Box p={[0, 0.72, -0.2]} s={[0.45, 0.5, 0.05]} c="#7c4a2d" />
          {[
            [-0.19, -0.19],
            [0.19, -0.19],
            [-0.19, 0.19],
            [0.19, 0.19],
          ].map(([x, z]) => (
            <Box key={`${x}${z}`} p={[x, 0.22, z]} s={[0.05, 0.44, 0.05]} c="#5d3a22" />
          ))}
        </group>
      );
    case "barrel":
      return (
        <group>
          <Cyl p={[0, 0.47, 0]} rt={0.3} rb={0.3} h={0.94} c="#2563eb" />
          {[0.2, 0.75].map((y) => (
            <Cyl key={y} p={[0, y, 0]} rt={0.31} rb={0.31} h={0.04} c="#1e3a8a" />
          ))}
        </group>
      );
    case "gnome":
      return (
        <group>
          <Cyl p={[0, 0.16, 0]} rt={0.12} rb={0.15} h={0.32} c="#2563eb" />
          <mesh position={[0, 0.36, 0]}>
            <sphereGeometry args={[0.1, 10, 8]} />
            <meshStandardMaterial color="#f5d0a9" />
          </mesh>
          <Cyl p={[0, 0.3, 0.04]} rt={0.02} rb={0.11} h={0.16} c="#f8fafc" />
          <Cyl p={[0, 0.52, 0]} rt={0.0} rb={0.12} h={0.22} c="#dc2626" />
        </group>
      );
    case "doghouse":
      return (
        <group>
          <Box p={[0, 0.4, 0]} s={[1.1, 0.8, 1.2]} c="#a0522d" />
          <Box p={[0, 0.25, 0.601]} s={[0.45, 0.5, 0.01]} c="#2b1a10" />
          <Box p={[-0.3, 0.98, 0]} s={[0.65, 0.07, 1.3]} c="#7f1d1d" />
          <Box p={[0.3, 0.98, 0]} s={[0.65, 0.07, 1.3]} c="#7f1d1d" />
        </group>
      );
    case "bush":
      return (
        <group>
          <mesh position={[0, 0.5, 0]} scale={[1, 0.8, 1]}>
            <sphereGeometry args={[0.72, 12, 9]} />
            <meshStandardMaterial color="#2f6b2f" roughness={1} />
          </mesh>
          <mesh position={[0.3, 0.75, 0.2]}>
            <sphereGeometry args={[0.4, 10, 8]} />
            <meshStandardMaterial color="#3c8a3c" roughness={1} />
          </mesh>
        </group>
      );
    case "lamp":
      return (
        <group>
          <Cyl p={[0, 1.6, 0]} rt={0.06} rb={0.09} h={3.2} c="#334155" />
          <Box p={[0, 3.2, 0.2]} s={[0.25, 0.1, 0.5]} c="#334155" />
          <Glow p={[0, 3.12, 0.32]} r={0.12} c="#ffe8a3" />
        </group>
      );
    case "tree":
      return (
        <group>
          <Cyl p={[0, 1.1, 0]} rt={0.18} rb={0.26} h={2.2} c="#5b3a1e" />
          <mesh position={[0, 2.9, 0]}>
            <sphereGeometry args={[1.5, 12, 10]} />
            <meshStandardMaterial color="#2d6a4f" roughness={1} />
          </mesh>
          <mesh position={[0.7, 2.4, 0.4]}>
            <sphereGeometry args={[0.9, 10, 8]} />
            <meshStandardMaterial color="#40916c" roughness={1} />
          </mesh>
        </group>
      );
    case "fountain":
      return (
        <group>
          <Cyl p={[0, 0.3, 0]} rt={1.5} rb={1.55} h={0.6} c="#9ca3af" seg={24} />
          <Cyl p={[0, 0.58, 0]} rt={1.3} rb={1.3} h={0.04} c="#38bdf8" seg={24} />
          <Cyl p={[0, 0.95, 0]} rt={0.15} rb={0.2} h={0.8} c="#9ca3af" />
          <Glow p={[0, 1.45, 0]} r={0.18} c="#bae6fd" />
        </group>
      );
    case "trafficLight":
      return (
        <group>
          <Cyl p={[0, 1.5, 0]} rt={0.06} rb={0.08} h={3.0} c="#1f2937" />
          <Box p={[0, 2.7, 0]} s={[0.3, 0.7, 0.25]} c="#111827" />
          <Glow p={[0, 2.88, 0.13]} r={0.09} c={pedLight ? "#3b0a0a" : "#ef4444"} />
          <Glow p={[0, 2.55, 0.13]} r={0.09} c={pedLight ? "#22c55e" : "#052e16"} />
          <Glow p={[0, 2.88, -0.13]} r={0.09} c={pedLight ? "#3b0a0a" : "#ef4444"} />
          <Glow p={[0, 2.55, -0.13]} r={0.09} c={pedLight ? "#22c55e" : "#052e16"} />
        </group>
      );
    case "chest":
      return (
        <group>
          <Box p={[0, 0.25, 0]} s={[0.9, 0.5, 0.6]} c="#8b5a2b" />
          <Box p={[0, 0.58, 0]} s={[0.92, 0.18, 0.62]} c="#a0522d" />
          <Box p={[0, 0.42, 0.31]} s={[0.14, 0.18, 0.02]} c="#facc15" m={0.8} />
          <Box p={[-0.35, 0.35, 0]} s={[0.06, 0.6, 0.63]} c="#facc15" m={0.8} />
          <Box p={[0.35, 0.35, 0]} s={[0.06, 0.6, 0.63]} c="#facc15" m={0.8} />
        </group>
      );
  }
}
