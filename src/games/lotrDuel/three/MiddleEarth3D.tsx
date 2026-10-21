"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { labelTexture } from "@/games/shared/three/tableKit";
import { ImpactRing, PopIn } from "@/games/shared/three/tablePieces";
import { ADJACENCY, REGIONS, REGION_INFO } from "../data";
import { controlledCount } from "../engine";
import type { LotrDuelState, RegionId } from "../types";

/**
 * 반지의 제왕 대결 — 가운데땅 전황 지도를 3D 입체 지형으로. 7개 지역이 저마다
 * 지형(항구·평원·숲·고원·초원·백색 도시·화산)을 얹은 육각 판으로 솟아 있고,
 * 룬 길(인접)로 이어진다. 반지 원정대 병력은 금빛, 사우론 병력은 검붉은
 * 병정 말로 쌓이고, 요새는 성탑으로 솟는다. `MiddleEarthMap`과 같은 props —
 * 강조된 지역을 눌러 배치/이동/저격을 그대로 고른다.
 */

export interface MiddleEarth3DProps {
  state: LotrDuelState;
  targets: Set<RegionId>;
  selectedFrom: RegionId | null;
  onRegion: (r: RegionId) => void;
  rise?: { key: number; region: RegionId } | null;
  preview?: { regions: RegionId[]; tone: "red" | "violet" } | null;
  drops?: { key: number; items: { region: RegionId; faction: "FELLOWSHIP" | "SAURON"; count: number }[] } | null;
  lowDetail: boolean;
}

const TERRAIN: Record<RegionId, { color: string; deco: "port" | "ruins" | "forest" | "tower" | "plain" | "city" | "volcano" }> = {
  LINDON: { color: "#2f6f6a", deco: "port" },
  ARNOR: { color: "#3f5a7a", deco: "ruins" },
  RHOVANION: { color: "#4a5a2a", deco: "forest" },
  ENEDWAITH: { color: "#5a4a6a", deco: "tower" },
  ROHAN: { color: "#5f7a3a", deco: "plain" },
  GONDOR: { color: "#8a8a8a", deco: "city" },
  MORDOR: { color: "#4a1d1d", deco: "volcano" },
};

/** Map % coords → world (x right, z down the map). */
const P = (r: RegionId) => new THREE.Vector3((REGION_INFO[r].x - 50) * 0.11, 0, (REGION_INFO[r].y - 52) * 0.1);

function Deco({ kind }: { kind: (typeof TERRAIN)[RegionId]["deco"] }) {
  const lava = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (lava.current) lava.current.emissiveIntensity = 1.2 + Math.sin(clock.elapsedTime * 3) * 0.5;
  });
  switch (kind) {
    case "volcano":
      return (
        <group position={[0.35, 0, -0.3]}>
          <mesh position={[0, 0.5, 0]} castShadow>
            <coneGeometry args={[0.55, 1.0, 7]} />
            <meshStandardMaterial color="#2a0d0d" roughness={1} flatShading />
          </mesh>
          <mesh position={[0, 1.0, 0]}>
            <sphereGeometry args={[0.12, 10, 8]} />
            <meshStandardMaterial ref={lava} color="#ff4d1a" emissive="#ff3a00" emissiveIntensity={1.4} />
          </mesh>
          <pointLight position={[0, 1.3, 0]} color="#ff4d1a" intensity={6} distance={4} />
        </group>
      );
    case "forest":
      return (
        <group>
          {[[-0.4, -0.3], [-0.1, -0.45], [0.35, -0.3], [0.45, 0.1]].map(([x, z], i) => (
            <mesh key={i} position={[x, 0.32, z]} castShadow>
              <coneGeometry args={[0.16, 0.5, 6]} />
              <meshStandardMaterial color="#1f3d1a" roughness={1} flatShading />
            </mesh>
          ))}
        </group>
      );
    case "tower":
      return (
        <mesh position={[0.4, 0.4, -0.3]} castShadow>
          <cylinderGeometry args={[0.08, 0.12, 0.8, 8]} />
          <meshStandardMaterial color="#1c1917" roughness={0.7} />
        </mesh>
      );
    case "city":
      return (
        <group position={[0.35, 0, -0.3]}>
          {[0.18, 0.13, 0.08].map((r, i) => (
            <mesh key={i} position={[0, 0.1 + i * 0.16, 0]} castShadow>
              <cylinderGeometry args={[r, r + 0.02, 0.16, 12]} />
              <meshStandardMaterial color="#f1f5f9" roughness={0.6} />
            </mesh>
          ))}
        </group>
      );
    case "port":
      return (
        <mesh position={[-0.45, 0.03, 0.1]} rotation-x={-Math.PI / 2}>
          <circleGeometry args={[0.3, 20]} />
          <meshStandardMaterial color="#1e6f8a" roughness={0.2} metalness={0.3} />
        </mesh>
      );
    case "ruins":
      return (
        <group position={[0.35, 0, -0.3]}>
          {[-0.12, 0, 0.12].map((x, i) => (
            <mesh key={i} position={[x, 0.15 + (i % 2) * 0.05, 0]} castShadow>
              <boxGeometry args={[0.06, 0.3 + (i % 2) * 0.1, 0.06]} />
              <meshStandardMaterial color="#cbd5e1" roughness={0.8} />
            </mesh>
          ))}
        </group>
      );
    default:
      return null;
  }
}

const soldierGeo = new THREE.CapsuleGeometry(0.05, 0.1, 3, 8);

function Units({ n, faction, side }: { n: number; faction: "FELLOWSHIP" | "SAURON"; side: number }) {
  const color = faction === "FELLOWSHIP" ? "#f2c14e" : "#7f1d1d";
  return (
    <group position={[side * 0.28, 0, 0.2]}>
      {Array.from({ length: Math.min(n, 9) }, (_, i) => (
        <mesh key={i} geometry={soldierGeo} position={[((i % 3) - 1) * 0.12, 0.1 + Math.floor(i / 3) * 0.0, Math.floor(i / 3) * 0.12 - 0.12]} castShadow>
          <meshStandardMaterial color={color} metalness={faction === "FELLOWSHIP" ? 0.6 : 0.2} roughness={0.4} emissive={color} emissiveIntensity={0.15} />
        </mesh>
      ))}
    </group>
  );
}

function Keep({ faction }: { faction: "FELLOWSHIP" | "SAURON" }) {
  const c = faction === "FELLOWSHIP" ? "#e2e8f0" : "#1c1917";
  return (
    <group position={[faction === "FELLOWSHIP" ? -0.3 : 0.3, 0, -0.05]}>
      <PopIn>
        <mesh position={[0, 0.22, 0]} castShadow>
          <boxGeometry args={[0.2, 0.44, 0.2]} />
          <meshStandardMaterial color={c} roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.5, 0]}>
          <coneGeometry args={[0.16, 0.18, 4]} />
          <meshStandardMaterial color={faction === "FELLOWSHIP" ? "#1d4ed8" : "#b91c1c"} roughness={0.6} />
        </mesh>
      </PopIn>
    </group>
  );
}

function Region({ r, p }: { r: RegionId; p: MiddleEarth3DProps }) {
  const s = p.state.boardRegions[r];
  const target = p.targets.has(r);
  const from = p.selectedFrom === r;
  const prev = p.preview?.regions.includes(r) ? p.preview.tone : null;
  const glow = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (glow.current) glow.current.opacity = target || from || prev ? 0.45 + Math.sin(clock.elapsedTime * 5) * 0.2 : 0;
  });
  const info = REGION_INFO[r];
  const label = useMemo(() => labelTexture(`${info.name}`, TERRAIN[r].color), [info.name, r]);
  return (
    <group
      position={P(r)}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        if (e.delta > 8 || !target) return;
        p.onRegion(r);
      }}
      onPointerOver={() => {
        if (target) document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "";
      }}
    >
      <mesh position={[0, -0.08, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.95, 1.02, 0.18, 6]} />
        <meshStandardMaterial color={TERRAIN[r].color} roughness={0.95} flatShading />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.9, 1.04, 6]} />
        <meshBasicMaterial ref={glow} color={from ? "#38bdf8" : prev === "violet" ? "#a78bfa" : prev === "red" ? "#ef4444" : "#fde68a"} transparent opacity={0} depthWrite={false} />
      </mesh>
      <Deco kind={TERRAIN[r].deco} />
      {s.fellowshipUnits > 0 && <Units n={s.fellowshipUnits} faction="FELLOWSHIP" side={-1} />}
      {s.sauronUnits > 0 && <Units n={s.sauronUnits} faction="SAURON" side={1} />}
      {s.fellowshipFortress && <Keep key={`f-${p.rise?.region === r ? p.rise.key : 0}`} faction="FELLOWSHIP" />}
      {s.sauronFortress && <Keep key={`s-${p.rise?.region === r ? p.rise.key : 0}`} faction="SAURON" />}
      <sprite position={[0, 1.05, 0.55]} scale={[1.2, 0.3, 1]} renderOrder={5}>
        <spriteMaterial map={label} transparent depthWrite={false} />
      </sprite>
      {p.state.combatFlash?.region === r && <ImpactRing key={p.state.combatFlash.no} color="#ef4444" size={1.6} dur={0.9} />}
      {p.drops?.items.some((d) => d.region === r) && <ImpactRing key={`d${p.drops.key}`} color="#fde68a" size={1.0} dur={0.6} />}
    </group>
  );
}

function Roads({ selectedFrom }: { selectedFrom: RegionId | null }) {
  const edges: [RegionId, RegionId][] = [];
  for (const a of REGIONS) for (const b of ADJACENCY[a]) if (a < b) edges.push([a, b]);
  return (
    <group>
      {edges.map(([a, b]) => {
        const pa = P(a);
        const pb = P(b);
        const mid = pa.clone().add(pb).multiplyScalar(0.5);
        const len = pa.distanceTo(pb);
        const hot = selectedFrom !== null && (a === selectedFrom || b === selectedFrom);
        return (
          <mesh key={`${a}-${b}`} position={[mid.x, -0.12, mid.z]} rotation={[-Math.PI / 2, 0, -Math.atan2(pb.z - pa.z, pb.x - pa.x)]}>
            <planeGeometry args={[len, hot ? 0.16 : 0.09]} />
            <meshBasicMaterial color={hot ? "#38bdf8" : "#d9b36b"} transparent opacity={hot ? 0.8 : 0.45} />
          </mesh>
        );
      })}
    </group>
  );
}

function Scene(p: MiddleEarth3DProps) {
  return (
    <>
      <color attach="background" args={["#0f0b07"]} />
      <fog attach="fog" args={["#0f0b07", 14, 30]} />
      <ambientLight intensity={0.4} color="#fde7c7" />
      <hemisphereLight args={["#f5deb3", "#1a120a", 0.5]} />
      <directionalLight position={[-5, 10, 6]} intensity={1.2} color="#ffe8c4" castShadow={!p.lowDetail} shadow-mapSize-width={1024} shadow-mapSize-height={1024} shadow-camera-left={-7} shadow-camera-right={7} shadow-camera-top={7} shadow-camera-bottom={-7} />
      {/* parchment sea */}
      <mesh position={[0, -0.2, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[14, 12]} />
        <meshStandardMaterial color="#6b5434" roughness={1} />
      </mesh>
      <Roads selectedFrom={p.selectedFrom} />
      {REGIONS.map((r) => (
        <Region key={r} r={r} p={p} />
      ))}
    </>
  );
}

export default function MiddleEarth3D(props: MiddleEarth3DProps) {
  const high = !props.lowDetail;
  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-amber-700/40 shadow-2xl">
      <div className="relative z-10 flex items-center justify-between gap-2 border-b border-amber-700/30 bg-black/55 px-2.5 py-1.5">
        <span className="font-serif text-[11px] font-black tracking-wider text-amber-200">🗺️ 가운데땅 전황 지도</span>
        <span className="flex gap-1.5 font-mono text-[10px] font-bold">
          <span className="rounded-md border border-amber-400/50 bg-amber-500/15 px-1.5 text-amber-200">💍 {controlledCount(props.state, "FELLOWSHIP")}/7</span>
          <span className="rounded-md border border-red-500/50 bg-red-950/60 px-1.5 text-rose-200">👁️ {controlledCount(props.state, "SAURON")}/7</span>
        </span>
      </div>
      <div className="aspect-[10/9] w-full">
        <Canvas shadows={high} dpr={high ? [1, 1.75] : [1, 1.25]} gl={{ antialias: high, powerPreference: "high-performance" }} camera={{ fov: 42, position: [0, 7.6, 5.4], near: 0.1, far: 60 }} onCreated={({ camera }) => camera.lookAt(0, 0, 0.3)} style={{ touchAction: "pan-y" }}>
          <Scene {...props} />
        </Canvas>
      </div>
    </div>
  );
}
