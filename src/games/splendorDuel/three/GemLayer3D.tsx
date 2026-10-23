"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { BoardToken, GemColor } from "../engine";
import { GEM_PALETTE, SHAPES } from "../DuelToken";

/**
 * 3D gems only — a transparent canvas laid exactly over the flat 2D gem
 * board, looking straight down (orthographic, no tilt). Each gem is cut from
 * the same outline as its 2D token (trillion ruby, hexagonal onyx, emerald
 * cut…) so colors stay tellable by shape, with a raised table and crown
 * facets that catch studio reflections as it sways. Clicks, rings and the
 * pluck flight all stay on the 2D board underneath (pointer-events: none).
 */

export interface GemSpot {
  /** Cell center and size in % of the board box. */
  x: number;
  y: number;
  size: number;
}

export interface GemLayer3DProps {
  grid: (BoardToken | null)[];
  spots: GemSpot[];
  selected: number[];
  /** Cells drawn faded (not pickable right now). */
  dim: Set<number>;
  lowDetail: boolean;
  onReady: () => void;
}

/** Crown facets + table + pavilion from a 2D outline (100×100 viewBox, y down) → unit-size flat-shaded mesh facing +Z. */
function cutGem(outline: [number, number][], tableCy: number): THREE.BufferGeometry {
  const toXY = ([x, y]: [number, number]) => [(x - 50) / 100, -(y - 50) / 100] as const;
  const rim = outline.map(toXY);
  const table = outline.map(([x, y]) => toXY([50 + (x - 50) * 0.52, tableCy + (y - tableCy) * 0.52]));
  const crownZ = 0.26;
  const pos: number[] = [];
  const tri = (a: readonly number[], b: readonly number[], c: readonly number[]) => pos.push(...a, ...b, ...c);
  const n = rim.length;
  const tc = [table.reduce((s, p) => s + p[0], 0) / n, table.reduce((s, p) => s + p[1], 0) / n, crownZ] as const;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const r0 = [rim[i][0], rim[i][1], 0];
    const r1 = [rim[j][0], rim[j][1], 0];
    const t0 = [table[i][0], table[i][1], crownZ];
    const t1 = [table[j][0], table[j][1], crownZ];
    // table
    tri(tc, t0, t1);
    // crown: two facets per side, split so the light breaks across them
    tri(r0, r1, t1);
    tri(r0, t1, t0);
    // pavilion down to a point
    tri(r1, r0, [0, 0, -0.3]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

const GEM_GEO: Record<GemColor, THREE.BufferGeometry> = {
  white: cutGem(SHAPES.white, 48),
  blue: cutGem(SHAPES.blue, 48),
  green: cutGem(SHAPES.green, 48),
  red: cutGem(SHAPES.red, 62),
  black: cutGem(SHAPES.black, 48),
};
const PEARL_GEO = new THREE.SphereGeometry(0.4, 32, 24);
const COIN_GEO = new THREE.CylinderGeometry(0.44, 0.44, 0.1, 40);

function crownTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(48, 44, 6, 64, 64, 64);
  g.addColorStop(0, "#fff1b0");
  g.addColorStop(0.55, "#f2b705");
  g.addColorStop(1, "#8a5a00");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = "#7a4a00";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(64, 64, 54, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#7a4a00";
  ctx.beginPath();
  ctx.moveTo(34, 84);
  ctx.lineTo(28, 44);
  ctx.lineTo(48, 62);
  ctx.lineTo(64, 36);
  ctx.lineTo(80, 62);
  ctx.lineTo(100, 44);
  ctx.lineTo(94, 84);
  ctx.closePath();
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  // the cap's UVs run sideways once the coin is turned to face the camera
  t.center.set(0.5, 0.5);
  t.rotation = Math.PI / 2;
  return t;
}

function makeMaterials(env: THREE.Texture, opacity: number) {
  const gem = (color: GemColor) => {
    const p = GEM_PALETTE[color];
    return new THREE.MeshPhysicalMaterial({
      // white is toned down a step so its facets don't blow out to flat white next to the pearl
      color: color === "white" ? "#a7c8ee" : p.base,
      emissive: p.dark,
      emissiveIntensity: 0.25,
      roughness: 0.1,
      metalness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      flatShading: true,
      envMap: env,
      envMapIntensity: color === "white" ? 0.7 : 0.55,
      transparent: true,
      opacity,
    });
  };
  const crown = crownTexture();
  const coinSide = new THREE.MeshStandardMaterial({ color: "#d99a12", metalness: 0.95, roughness: 0.25, envMap: env, transparent: true, opacity });
  const coinFace = new THREE.MeshStandardMaterial({ map: crown, metalness: 0.8, roughness: 0.3, envMap: env, transparent: true, opacity });
  return {
    white: gem("white"),
    blue: gem("blue"),
    green: gem("green"),
    red: gem("red"),
    black: gem("black"),
    pearl: new THREE.MeshPhysicalMaterial({ color: "#f3dfd6", roughness: 0.3, metalness: 0, clearcoat: 1, iridescence: 0.6, sheen: 1, sheenColor: new THREE.Color("#fbcfe8"), envMap: env, envMapIntensity: 0.6, transparent: true, opacity }),
    gold: [coinSide, coinFace, coinFace] as THREE.Material[],
  };
}
type Mats = ReturnType<typeof makeMaterials>;

/** Orthographic camera that maps the board box to 0..100 (x right, y down → -y). */
function FitCamera() {
  useFrame(({ camera, size }) => {
    const zoom = size.width / 100;
    if (camera.zoom === zoom && camera.position.z === 100) return;
    camera.position.set(50, -50, 100);
    camera.lookAt(50, -50, 0);
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
  });
  return null;
}

function Gem({ token, spot, lifted, seed, mats }: { token: BoardToken; spot: GemSpot; lifted: boolean; seed: number; mats: Mats }) {
  const ref = useRef<THREE.Group>(null);
  const scale = spot.size * (token === "gold" || token === "pearl" ? 0.8 : 0.86);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const t = clock.elapsedTime * 0.9 + seed;
    const sway = lifted ? 0.32 : 0.16;
    g.rotation.x = Math.sin(t) * sway;
    g.rotation.y = Math.cos(t * 0.8) * sway;
    const k = scale * (lifted ? 1.14 : 1);
    g.scale.setScalar(g.scale.x + (k - g.scale.x) * 0.2);
  });
  return (
    <group ref={ref} position={[spot.x, -spot.y, 0]} scale={scale}>
      {token === "gold" ? (
        <mesh geometry={COIN_GEO} material={mats.gold} rotation-x={Math.PI / 2} />
      ) : token === "pearl" ? (
        <mesh geometry={PEARL_GEO} material={mats.pearl} />
      ) : (
        <mesh geometry={GEM_GEO[token]} material={mats[token]} />
      )}
    </group>
  );
}

function Scene(props: GemLayer3DProps) {
  const gl = useThree((st) => st.gl);
  const env = useMemo(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const tex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    return tex;
  }, [gl]);
  // Materials are per gem kind but opacity is per cell → one material set per dim state.
  const lit = useMemo(() => makeMaterials(env, 1), [env]);
  const faded = useMemo(() => makeMaterials(env, 0.4), [env]);
  useEffect(() => () => env.dispose(), [env]);
  const { onReady } = props;
  useEffect(() => onReady(), [onReady]);
  return (
    <>
      <FitCamera />
      <ambientLight intensity={0.25} />
      <directionalLight position={[20, 20, 100]} intensity={1.3} color="#fff6e8" />
      <pointLight position={[90, -90, 60]} intensity={3000} distance={300} color="#f0abfc" />
      {props.grid.map((token, i) => {
        const spot = props.spots[i];
        if (!token || !spot) return null;
        const dim = props.dim.has(i);
        return <Gem key={`${i}-${token}`} token={token} spot={spot} lifted={props.selected.includes(i)} seed={i * 1.7} mats={dim ? faded : lit} />;
      })}
    </>
  );
}

export default function GemLayer3D(props: GemLayer3DProps) {
  const high = !props.lowDetail;
  return (
    <Canvas
      orthographic
      flat
      dpr={high ? [1, 2] : [1, 1.5]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      camera={{ near: 1, far: 400 }}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      <Scene {...props} />
    </Canvas>
  );
}
