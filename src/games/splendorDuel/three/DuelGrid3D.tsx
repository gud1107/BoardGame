"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { GRID_SIZE, SPIRAL_ORDER, type BoardToken } from "../engine";
import { GEM_PALETTE } from "../DuelToken";

/**
 * 스플렌더 듀얼의 5×5 보석판을 3D로 — 벨벳 판 위에 깎은 보석(팔면체), 진주,
 * 금화가 놓이고 살짝 회전하며 빛난다. `SpiralGridBoard`와 같은 props를 받아
 * 같은 칸 클릭 규칙을 그대로 쓴다(고를 수 있는 칸은 금빛 받침, 고른 칸은
 * 떠오르며 번호, 강조 칸은 링). 카메라는 판을 비스듬히 내려다본다.
 */

export interface DuelGrid3DProps {
  grid: (BoardToken | null)[];
  selected: number[];
  selectable: Set<number> | null;
  highlight?: Set<number>;
  onCellClick?: (cell: number) => void;
  lowDetail: boolean;
}

const CELL = 1;
const HALF = ((GRID_SIZE - 1) * CELL) / 2;
const cellPos = (i: number) => new THREE.Vector3((i % GRID_SIZE) * CELL - HALF, 0, Math.floor(i / GRID_SIZE) * CELL - HALF);

const gemGeo = new THREE.OctahedronGeometry(0.32, 0);
gemGeo.scale(1, 0.75, 1);
const pearlGeo = new THREE.SphereGeometry(0.26, 24, 18);
const goldGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.1, 28);

function Token({ token, lifted, order, seed }: { token: BoardToken; lifted: boolean; order: number; seed: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const t = clock.elapsedTime + seed;
    g.rotation.y = t * 0.5;
    const target = lifted ? 0.55 : 0.32 + Math.sin(t * 1.4) * 0.03;
    g.position.y += (target - g.position.y) * 0.2;
  });
  const mat = useMemo(() => {
    if (token === "pearl") return new THREE.MeshPhysicalMaterial({ color: "#fff4ee", roughness: 0.15, metalness: 0.1, clearcoat: 1, sheen: 1, sheenColor: new THREE.Color("#a5f3fc") });
    if (token === "gold") return new THREE.MeshStandardMaterial({ color: "#f2c14e", metalness: 0.9, roughness: 0.25, emissive: "#5a3a00", emissiveIntensity: 0.3 });
    const p = GEM_PALETTE[token];
    return new THREE.MeshPhysicalMaterial({ color: p.base, roughness: 0.08, metalness: 0.1, transmission: 0.15, clearcoat: 1, emissive: p.dark, emissiveIntensity: 0.35, flatShading: true });
  }, [token]);
  return (
    <group ref={ref} position={[0, 0.32, 0]}>
      <mesh geometry={token === "pearl" ? pearlGeo : token === "gold" ? goldGeo : gemGeo} material={mat} castShadow rotation-x={token === "gold" ? Math.PI / 2 : 0} />
      {lifted && order > 0 && (
        <sprite position={[0, 0.55, 0]} scale={[0.36, 0.36, 1]}>
          <spriteMaterial map={numberTex(order)} transparent depthTest={false} />
        </sprite>
      )}
    </group>
  );
}

const numCache = new Map<number, THREE.CanvasTexture>();
function numberTex(n: number) {
  let t = numCache.get(n);
  if (t) return t;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fbbf24";
  ctx.beginPath();
  ctx.arc(32, 32, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1c1917";
  ctx.font = "900 40px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(n), 32, 34);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  numCache.set(n, t);
  return t;
}

function Cell({ i, props }: { i: number; props: DuelGrid3DProps }) {
  const token = props.grid[i];
  const canTap = !!props.onCellClick && token !== null && (props.selectable === null || props.selectable.has(i));
  const selIdx = props.selected.indexOf(i);
  const hi = props.highlight?.has(i) ?? false;
  const p = cellPos(i);
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 8 || !canTap) return;
    props.onCellClick!(i);
  };
  return (
    <group position={p}>
      <mesh
        position={[0, 0.06, 0]}
        receiveShadow
        onClick={onClick}
        onPointerOver={() => {
          if (canTap) document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
        }}
      >
        <cylinderGeometry args={[0.42, 0.44, 0.08, 32]} />
        <meshStandardMaterial color={selIdx >= 0 ? "#fbbf24" : canTap ? "#7a5a2a" : "#2a1a2a"} metalness={0.5} roughness={0.45} emissive={selIdx >= 0 ? "#a16207" : "#000"} emissiveIntensity={selIdx >= 0 ? 0.6 : 0} />
      </mesh>
      {hi && (
        <mesh position={[0, 0.11, 0]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.4, 0.47, 32]} />
          <meshBasicMaterial color="#fde68a" />
        </mesh>
      )}
      {token && <Token token={token} lifted={selIdx >= 0} order={selIdx + 1} seed={i * 1.7} />}
    </group>
  );
}

function Scene(props: DuelGrid3DProps) {
  return (
    <>
      <color attach="background" args={["#140a12"]} />
      <ambientLight intensity={0.45} color="#ffe4e6" />
      <hemisphereLight args={["#fff1e0", "#1a0a12", 0.5]} />
      <directionalLight position={[3, 8, 4]} intensity={1.3} color="#fff4e0" castShadow={!props.lowDetail} shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <pointLight position={[-4, 3, -3]} intensity={6} color="#f0abfc" distance={12} />
      {/* velvet board with a gilt frame */}
      <mesh position={[0, -0.05, 0]} receiveShadow>
        <boxGeometry args={[GRID_SIZE + 0.5, 0.1, GRID_SIZE + 0.5]} />
        <meshStandardMaterial color="#4a1030" roughness={1} />
      </mesh>
      <mesh position={[0, -0.02, 0]}>
        <boxGeometry args={[GRID_SIZE + 0.75, 0.06, GRID_SIZE + 0.75]} />
        <meshStandardMaterial color="#c9a13a" metalness={0.8} roughness={0.3} />
      </mesh>
      {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, i) => (
        <Cell key={i} i={i} props={props} />
      ))}
      {/* faint spiral refill path */}
      {SPIRAL_ORDER.slice(1).map((c, k) => {
        const a = cellPos(SPIRAL_ORDER[k]);
        const b = cellPos(c);
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const len = a.distanceTo(b);
        return (
          <mesh key={c} position={[mid.x, 0.011, mid.z]} rotation={[-Math.PI / 2, 0, Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2]}>
            <planeGeometry args={[len, 0.03]} />
            <meshBasicMaterial color="#fbbf24" transparent opacity={0.14} />
          </mesh>
        );
      })}
    </>
  );
}

export default function DuelGrid3D(props: DuelGrid3DProps) {
  const high = !props.lowDetail;
  return (
    <Canvas
      shadows={high}
      dpr={high ? [1, 1.75] : [1, 1.25]}
      gl={{ antialias: high, powerPreference: "high-performance" }}
      camera={{ fov: 40, position: [0, 7.4, 4.6], near: 0.1, far: 40 }}
      onCreated={({ camera }) => camera.lookAt(0, 0, 0.2)}
      style={{ touchAction: "pan-y" }}
    >
      <Scene {...props} />
    </Canvas>
  );
}
