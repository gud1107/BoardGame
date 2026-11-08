"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { BOARD, cellX, cellY, CENTER, type Placed, type Settler } from "../engine";
import { quadTerrain, resourceDir } from "../tiles";
import { SEAT_COLORS, TERRAIN_FILL } from "../TileArt";

/**
 * 섬 개척자 3D — the island as it grows out of a tropical sea: each tile is a
 * sand-sided block whose four triangles carry their terrain (forest = pine
 * cones, meadow = grass tufts, mountain = snowy peaks, sea = a lower water
 * plate). Resource icons stand as little props (log, sheep, gem, fish),
 * pioneers as flags in their seat colour. Presentation only — all input is on
 * the 2D map below. Drag to orbit.
 */

export interface IslandScene3DProps {
  board: readonly (Placed | null)[];
  settlers: readonly Settler[];
  ghost: { cell: number; tile: number; rot: number; ok: boolean; settler: number | null; seat: number } | null;
  flashCells: number[];
  lastCell: number | null;
  lowDetail: boolean;
}

const cx0 = cellX(CENTER);
const cy0 = cellY(CENTER);
const wx = (cell: number) => cellX(cell) - cx0;
const wz = (cell: number) => cellY(cell) - cy0;

// triangle d of a unit cell centred at the origin, on the XZ plane (N = −z)
const CORNERS: [number, number][] = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
];
const triGeos = [0, 1, 2, 3].map((d) => {
  const a = CORNERS[d];
  const b = CORNERS[(d + 1) % 4];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([a[0], 0, a[1], 0, 0, 0, b[0], 0, b[1]], 3));
  g.computeVertexNormals();
  return g;
});
const TRI_C: [number, number][] = [
  [0, -0.27],
  [0.27, 0],
  [0, 0.27],
  [-0.27, 0],
];

const terrainMats = TERRAIN_FILL.map((c, i) => new THREE.MeshStandardMaterial({ color: c, roughness: i === 3 ? 0.25 : 0.9, metalness: i === 3 ? 0.1 : 0, side: THREE.DoubleSide }));
const sandMat = new THREE.MeshStandardMaterial({ color: "#e9d3a0", roughness: 1 });
const blockGeo = new THREE.BoxGeometry(1, 0.22, 1);
const pineGeo = new THREE.ConeGeometry(0.09, 0.26, 6);
const trunkGeo = new THREE.CylinderGeometry(0.018, 0.022, 0.07, 5);
const pineMat = new THREE.MeshStandardMaterial({ color: "#1f5f2a", roughness: 0.9 });
const trunkMat = new THREE.MeshStandardMaterial({ color: "#6b4423" });
const peakGeo = new THREE.ConeGeometry(0.16, 0.3, 5);
const peakMat = new THREE.MeshStandardMaterial({ color: "#7d7366", roughness: 1, flatShading: true });
const snowGeo = new THREE.ConeGeometry(0.065, 0.1, 5);
const snowMat = new THREE.MeshStandardMaterial({ color: "#f8fafc" });
const tuftGeo = new THREE.ConeGeometry(0.025, 0.07, 4);
const tuftMat = new THREE.MeshStandardMaterial({ color: "#6f9b2c" });
const logGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.18, 8);
const logMat = new THREE.MeshStandardMaterial({ color: "#8b5a2b" });
const sheepGeo = new THREE.SphereGeometry(0.07, 10, 8);
const sheepMat = new THREE.MeshStandardMaterial({ color: "#fafaf9", roughness: 1 });
const headGeo = new THREE.SphereGeometry(0.03, 8, 6);
const headMat = new THREE.MeshStandardMaterial({ color: "#292524" });
const gemGeo = new THREE.OctahedronGeometry(0.07);
const gemMat = new THREE.MeshStandardMaterial({ color: "#67e8f9", emissive: "#0e7490", emissiveIntensity: 0.6, roughness: 0.15, metalness: 0.3 });
const fishGeo = new THREE.ConeGeometry(0.04, 0.16, 6);
const fishMat = new THREE.MeshStandardMaterial({ color: "#fb923c" });
const poleGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.32, 6);
const poleMat = new THREE.MeshStandardMaterial({ color: "#3f2a14" });
const flagGeo = new THREE.BoxGeometry(0.16, 0.1, 0.01);
const flagMats = SEAT_COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c, side: THREE.DoubleSide }));
const flashMat = new THREE.MeshBasicMaterial({ color: "#fde047", transparent: true, opacity: 0.4, depthWrite: false });
const lastMat = new THREE.MeshBasicMaterial({ color: "#fde047", transparent: true, opacity: 0.85 });
const ringGeo = new THREE.RingGeometry(0.47, 0.5, 4, 1, Math.PI / 4);
const flashGeo = new THREE.PlaneGeometry(1, 1);

function hash(n: number) {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

function Tile({ cell, p, ghost = false, ok = true }: { cell: number; p: { tile: number; rot: number }; ghost?: boolean; ok?: boolean }) {
  const rd = resourceDir(p.tile, p.rot);
  const items = useMemo(() => {
    const out: React.ReactNode[] = [];
    for (let d = 0; d < 4; d++) {
      const t = quadTerrain(p.tile, p.rot, d);
      const [tx, tz] = TRI_C[d];
      const seed = cell * 4 + d;
      if (d === rd) continue;
      if (t === 0) {
        for (let k = 0; k < 2; k++) {
          const ox = tx + (hash(seed + k) - 0.5) * 0.16;
          const oz = tz + (hash(seed + k + 9) - 0.5) * 0.16;
          out.push(
            <group key={`p${d}${k}`} position={[ox, 0, oz]}>
              <mesh geometry={trunkGeo} material={trunkMat} position={[0, 0.035, 0]} />
              <mesh geometry={pineGeo} material={pineMat} position={[0, 0.18, 0]} castShadow />
            </group>,
          );
        }
      } else if (t === 1) {
        for (let k = 0; k < 3; k++) out.push(<mesh key={`g${d}${k}`} geometry={tuftGeo} material={tuftMat} position={[tx + (hash(seed * 3 + k) - 0.5) * 0.22, 0.035, tz + (hash(seed * 5 + k) - 0.5) * 0.22]} />);
      } else if (t === 2) {
        out.push(
          <group key={`m${d}`} position={[tx, 0, tz]}>
            <mesh geometry={peakGeo} material={peakMat} position={[0, 0.15, 0]} castShadow />
            <mesh geometry={snowGeo} material={snowMat} position={[0, 0.27, 0]} />
          </group>,
        );
      }
    }
    if (rd >= 0) {
      const t = quadTerrain(p.tile, p.rot, rd);
      const [tx, tz] = TRI_C[rd];
      out.push(
        <group key="res" position={[tx, 0, tz]}>
          {t === 0 && <mesh geometry={logGeo} material={logMat} position={[0, 0.045, 0]} rotation={[0, 0.5, Math.PI / 2]} />}
          {t === 1 && (
            <>
              <mesh geometry={sheepGeo} material={sheepMat} position={[0, 0.08, 0]} />
              <mesh geometry={headGeo} material={headMat} position={[0.07, 0.1, 0]} />
            </>
          )}
          {t === 2 && <mesh geometry={gemGeo} material={gemMat} position={[0, 0.1, 0]} />}
          {t === 3 && <mesh geometry={fishGeo} material={fishMat} position={[0, 0.02, 0]} rotation={[0, 0, Math.PI / 2]} />}
        </group>,
      );
    }
    return out;
  }, [cell, p.tile, p.rot, rd]);
  const ghostMats = useMemo(() => {
    if (!ghost) return null;
    return terrainMats.map((m) => {
      const g = m.clone();
      g.transparent = true;
      g.opacity = 0.75;
      if (!ok) g.color.lerp(new THREE.Color("#f43f5e"), 0.5);
      return g;
    });
  }, [ghost, ok]);
  return (
    <group position={[wx(cell), ghost ? 0.12 : 0, wz(cell)]}>
      {!ghost && <mesh geometry={blockGeo} material={sandMat} position={[0, -0.11, 0]} receiveShadow />}
      {[0, 1, 2, 3].map((d) => {
        const t = quadTerrain(p.tile, p.rot, d);
        return <mesh key={d} geometry={triGeos[d]} material={(ghostMats ?? terrainMats)[t]} position={[0, t === 3 ? 0.002 : 0.004, 0]} receiveShadow />;
      })}
      {items}
    </group>
  );
}

function Flag({ cell, quad, seat, lift = 0 }: { cell: number; quad: number; seat: number; lift?: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = Math.sin(clock.elapsedTime * 3 + cell) * 0.35;
  });
  const [tx, tz] = TRI_C[quad];
  return (
    <group position={[wx(cell) + tx, lift, wz(cell) + tz]}>
      <mesh geometry={poleGeo} material={poleMat} position={[0, 0.16, 0]} castShadow />
      <mesh ref={ref} geometry={flagGeo} material={flagMats[seat]} position={[0.08, 0.27, 0]} castShadow />
    </group>
  );
}

function Ocean() {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#0e7490", roughness: 0.3, metalness: 0.2 }), []);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.y = -0.2 + Math.sin(clock.elapsedTime * 0.8) * 0.015;
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} material={mat} receiveShadow>
      <planeGeometry args={[BOARD * 4, BOARD * 4]} />
    </mesh>
  );
}

/** Orbit by dragging, auto-fit to the island. */
function CameraRig({ center, radius, yawRef }: { center: [number, number]; radius: number; yawRef: React.RefObject<number> }) {
  const { camera, size } = useThree();
  const cur = useRef({ x: center[0], z: center[1], r: radius });
  useFrame(() => {
    const c = cur.current;
    c.x += (center[0] - c.x) * 0.08;
    c.z += (center[1] - c.z) * 0.08;
    const fitR = (radius + 1.2) * (size.width < size.height ? 1.5 : 1.05);
    c.r += (fitR - c.r) * 0.08;
    const yaw = yawRef.current ?? 0;
    const dist = c.r * 1.55;
    camera.position.set(c.x + Math.sin(yaw) * dist * 0.62, dist * 0.85, c.z + Math.cos(yaw) * dist * 0.62);
    camera.lookAt(c.x, 0, c.z);
  });
  return null;
}

export default function IslandScene3D({ board, settlers, ghost, flashCells, lastCell, lowDetail }: IslandScene3DProps) {
  const yawRef = useRef(0);
  const drag = useRef<{ x: number; yaw: number } | null>(null);
  const { center, radius } = useMemo(() => {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    board.forEach((p, c) => {
      if (!p) return;
      x0 = Math.min(x0, wx(c));
      x1 = Math.max(x1, wx(c));
      z0 = Math.min(z0, wz(c));
      z1 = Math.max(z1, wz(c));
    });
    return { center: [(x0 + x1) / 2, (z0 + z1) / 2] as [number, number], radius: Math.max(2, (x1 - x0) / 2 + 1, (z1 - z0) / 2 + 1) };
  }, [board]);
  useEffect(() => {
    const up = () => (drag.current = null);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);
  const high = !lowDetail;
  return (
    <div
      className="h-full w-full"
      style={{ touchAction: "pan-y" }}
      onPointerDown={(e) => (drag.current = { x: e.clientX, yaw: yawRef.current })}
      onPointerMove={(e) => {
        if (!drag.current) return;
        yawRef.current = drag.current.yaw - (e.clientX - drag.current.x) * 0.01;
      }}
    >
      <Canvas shadows={high} dpr={high ? [1, 1.75] : 1} gl={{ antialias: high }} camera={{ fov: 42, position: [0, 8, 6], near: 0.1, far: 120 }}>
        <color attach="background" args={["#7dd3fc"]} />
        <fog attach="fog" args={["#7dd3fc", 14, 40]} />
        <hemisphereLight args={["#fef9c3", "#0e7490", 0.75]} />
        <directionalLight position={[6, 10, 4]} intensity={1.5} castShadow={high} shadow-mapSize={[1024, 1024]} shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8} />
        <CameraRig center={center} radius={radius} yawRef={yawRef} />
        <Ocean />
        {board.map((p, c) => (p ? <Tile key={c} cell={c} p={p} /> : null))}
        {settlers.map((s) => (
          <Flag key={`${s.cell}-${s.quad}`} cell={s.cell} quad={s.quad} seat={s.seat} />
        ))}
        {ghost && (
          <>
            <Tile key={`ghost-${ghost.cell}-${ghost.tile}-${ghost.rot}-${ghost.ok}`} cell={ghost.cell} p={ghost} ghost ok={ghost.ok} />
            {ghost.settler !== null && <Flag cell={ghost.cell} quad={ghost.settler} seat={ghost.seat} lift={0.12} />}
          </>
        )}
        {flashCells.map((c) => (
          <mesh key={`f${c}`} geometry={flashGeo} material={flashMat} position={[wx(c), 0.05, wz(c)]} rotation={[-Math.PI / 2, 0, 0]} />
        ))}
        {lastCell !== null && board[lastCell] && <mesh geometry={ringGeo} material={lastMat} position={[wx(lastCell), 0.02, wz(lastCell)]} rotation={[-Math.PI / 2, 0, 0]} />}
      </Canvas>
    </div>
  );
}
