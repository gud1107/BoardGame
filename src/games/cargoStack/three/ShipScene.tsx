"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { COLS, TIERS, type Forecast, type Placed } from "../engine";
import type { DisplayCrate, Frame } from "../anim";
import type { Ghost } from "../Ship2D";
import { seatColor, seatMark } from "../labels";

/**
 * 화물선 쌓기 3D view (rulebook §10). Display + column picking only — the
 * shared timeline (anim.ts / useTimeline) says where every crate is and how
 * far the ship heels; this scene adds the sea swell, bobbing, the gantry
 * crane and splashes.
 *
 * Ship-local coords: x across the bay (column c spans [c−4.5, c−3.5]),
 * y up from the waterline (deck top at DECK), z along the ship (the bay is
 * at z≈0, the bridge astern at −z). Lint: per-frame mutation lives in plain
 * functions outside components (React Compiler rule, see bumperArena).
 */

const U = 1;
const H = 0.95;
const DECK = 0.9;
const DEPTH = 2.5;

const colX = (x: number, len: number) => (x + len / 2 - COLS / 2) * U;
const tierY = (y: number) => DECK + y * H + H / 2;

const SKY: Record<Forecast, string> = { calm: "#9fd8ff", swell: "#b4c8dc", storm: "#4b5563" };
const SEA: Record<Forecast, string> = { calm: "#0e7fc0", swell: "#1d6390", storm: "#173a55" };
const SWELL: Record<Forecast, number> = { calm: 0.06, swell: 0.12, storm: 0.22 };

const labelCache = new Map<string, THREE.CanvasTexture>();
function labelTexture(c: Placed): THREE.CanvasTexture {
  const key = `${c.kind}:${c.w}:${c.owner}:${c.pts}:${c.crushed ? 1 : 0}:${c.len}`;
  const hit = labelCache.get(key);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = 128 * c.len;
  cv.height = 128;
  const g = cv.getContext("2d")!;
  g.clearRect(0, 0, cv.width, cv.height);
  // corrugation
  g.fillStyle = "rgba(0,0,0,.16)";
  for (let i = 1; i < c.len * 6; i++) g.fillRect((i * cv.width) / (c.len * 6) - 2, 10, 4, 108);
  if (c.kind === "steel") {
    g.strokeStyle = "rgba(255,255,255,.28)";
    g.lineWidth = 8;
    for (let i = -128; i < cv.width; i += 26) {
      g.beginPath();
      g.moveTo(i, 128);
      g.lineTo(i + 128, 0);
      g.stroke();
    }
  }
  if (c.kind === "gold") {
    g.fillStyle = "#facc15";
    g.fillRect(0, 102, cv.width, 14);
  }
  if (c.kind === "fragile" && !c.crushed) {
    g.setLineDash([14, 10]);
    g.strokeStyle = "#fff";
    g.lineWidth = 6;
    g.strokeRect(6, 6, cv.width - 12, 116);
  }
  if (c.crushed) {
    g.strokeStyle = "#111";
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(16, 20);
    g.lineTo(cv.width / 2, 64);
    g.lineTo(cv.width - 20, 30);
    g.moveTo(cv.width / 2, 64);
    g.lineTo(cv.width / 2 - 14, 116);
    g.stroke();
  }
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 7;
  g.strokeStyle = "rgba(0,0,0,.55)";
  g.fillStyle = "#fff";
  g.font = "900 46px system-ui, sans-serif";
  const icon = c.kind === "gold" ? "💎" : c.kind === "fragile" ? "🥚" : c.kind === "steel" ? "⚙" : seatMark(c.owner);
  const main = `${icon} ${c.w}t`;
  g.strokeText(main, cv.width / 2, 50);
  g.fillText(main, cv.width / 2, 50);
  g.font = "800 28px system-ui, sans-serif";
  const sub = c.crushed ? "깨짐" : `${seatMark(c.owner)} ${c.pts}점`;
  g.strokeText(sub, cv.width / 2, 92);
  g.fillText(sub, cv.width / 2, 92);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  labelCache.set(key, tex);
  return tex;
}

function CrateMesh({ d, warn, shadows }: { d: DisplayCrate; warn: boolean; shadows: boolean }) {
  const { c } = d;
  const color = c.crushed ? "#6b7280" : seatColor(c.owner);
  const w = c.len * U - 0.06;
  const tex = useMemo(() => labelTexture(c), [c]);
  const transparent = d.opacity < 1;
  return (
    <group position={[colX(d.x, c.len), tierY(d.y), 0]} rotation={[0, 0, d.rot]}>
      <mesh castShadow={shadows} receiveShadow={shadows}>
        <boxGeometry args={[w, H - 0.05, DEPTH]} />
        <meshStandardMaterial color={color} roughness={0.55} metalness={c.kind === "steel" ? 0.55 : 0.15} transparent={transparent} opacity={d.opacity} emissive={warn ? "#facc15" : "#000000"} emissiveIntensity={warn ? 0.45 : 0} />
      </mesh>
      <mesh position={[0, 0, DEPTH / 2 + 0.006]}>
        <planeGeometry args={[w, H - 0.05]} />
        <meshBasicMaterial map={tex} transparent opacity={d.opacity} depthWrite={false} />
      </mesh>
      {c.kind === "gold" && (
        <mesh position={[0, (H - 0.05) / 2 + 0.01, 0]}>
          <boxGeometry args={[w * 0.6, 0.02, DEPTH * 0.6]} />
          <meshStandardMaterial color="#facc15" emissive="#b45309" emissiveIntensity={0.4} metalness={0.8} roughness={0.25} transparent={transparent} opacity={d.opacity} />
        </mesh>
      )}
    </group>
  );
}

function GhostMesh({ g }: { g: Ghost }) {
  const x = colX(g.x, g.len);
  const y = tierY(g.y);
  const color = g.valid ? seatColor(g.owner) : "#ef4444";
  const top = 9.2;
  return (
    <group>
      <mesh position={[x, y, 0]}>
        <boxGeometry args={[g.len * U - 0.04, H - 0.03, DEPTH + 0.04]} />
        <meshStandardMaterial color={color} transparent opacity={0.38} emissive={color} emissiveIntensity={0.35} depthWrite={false} />
      </mesh>
      <mesh position={[x, (y + H / 2 + top) / 2, 0]}>
        <cylinderGeometry args={[0.025, 0.025, Math.max(0.1, top - y - H / 2), 6]} />
        <meshBasicMaterial color="#1f2937" />
      </mesh>
    </group>
  );
}

function Hull({ shadows }: { shadows: boolean }) {
  const hullGeo = useMemo(() => {
    const s = new THREE.Shape();
    const half = (COLS * U) / 2 + 0.7;
    s.moveTo(-half, DECK);
    s.lineTo(half, DECK);
    s.lineTo(half - 0.7, -1.3);
    s.lineTo(-half + 0.7, -1.3);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 15, bevelEnabled: false });
    g.translate(0, 0, -12);
    return g;
  }, []);
  return (
    <group>
      <mesh geometry={hullGeo} castShadow={shadows} receiveShadow={shadows}>
        <meshStandardMaterial color="#1f2937" roughness={0.7} metalness={0.2} />
      </mesh>
      {/* red bottom band (front face) */}
      <mesh position={[0, -0.55, 3.01]}>
        <planeGeometry args={[COLS * U + 0.6, 1.3]} />
        <meshStandardMaterial color="#b91c1c" />
      </mesh>
      {/* white deck stripe */}
      <mesh position={[0, DECK - 0.08, 3.02]}>
        <planeGeometry args={[COLS * U + 1.4, 0.12]} />
        <meshBasicMaterial color="#f8fafc" />
      </mesh>
      {/* deck plate */}
      <mesh position={[0, DECK + 0.005, -4.5]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow={shadows}>
        <planeGeometry args={[COLS * U + 1.3, 15]} />
        <meshStandardMaterial color="#64748b" roughness={0.9} />
      </mesh>
      {/* bay guides (column lines) */}
      {Array.from({ length: COLS + 1 }, (_, i) => (
        <mesh key={i} position={[(i - COLS / 2) * U, DECK + 0.02, DEPTH / 2 + 0.1]}>
          <boxGeometry args={[0.04, 0.04, 0.2]} />
          <meshBasicMaterial color={i === 4 || i === 5 ? "#fde047" : "#cbd5e1"} />
        </mesh>
      ))}
      {/* max tier marker posts */}
      {[-1, 1].map((sx) => (
        <mesh key={sx} position={[sx * ((COLS * U) / 2 + 0.25), DECK + (TIERS * H) / 2, -DEPTH / 2 - 0.2]}>
          <boxGeometry args={[0.12, TIERS * H, 0.12]} />
          <meshStandardMaterial color="#f97316" />
        </mesh>
      ))}
      <mesh position={[0, DECK + TIERS * H, -DEPTH / 2 - 0.2]}>
        <boxGeometry args={[COLS * U + 0.62, 0.06, 0.06]} />
        <meshBasicMaterial color="#ef4444" />
      </mesh>
      {/* bridge astern */}
      <group position={[0, DECK, -9]}>
        <mesh position={[0, 1.8, 0]} castShadow={shadows}>
          <boxGeometry args={[6.5, 3.6, 3]} />
          <meshStandardMaterial color="#f1f5f9" roughness={0.6} />
        </mesh>
        <mesh position={[0, 3.1, 1.51]}>
          <planeGeometry args={[5.8, 0.55]} />
          <meshStandardMaterial color="#0f172a" emissive="#38bdf8" emissiveIntensity={0.25} />
        </mesh>
        <mesh position={[2.2, 4.3, -0.4]} castShadow={shadows}>
          <cylinderGeometry args={[0.45, 0.55, 1.6, 14]} />
          <meshStandardMaterial color="#b91c1c" />
        </mesh>
      </group>
    </group>
  );
}

/* ── per-frame helpers (outside components: React Compiler lint) ─────── */

function bobShip(g: THREE.Group, t: number, swell: number, sink: number) {
  g.position.y = Math.sin(t * 1.3) * swell - sink;
  g.rotation.x = Math.sin(t * 0.9) * swell * 0.15;
}

function waveSea(geo: THREE.PlaneGeometry, base: Float32Array, t: number, amp: number) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = base[i * 3];
    const y = base[i * 3 + 1];
    pos.setZ(i, Math.sin(x * 0.45 + t * 1.4) * amp + Math.cos(y * 0.5 + t * 1.1) * amp * 0.7);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

function Sea({ forecast }: { forecast: Forecast }) {
  const geo = useMemo(() => new THREE.PlaneGeometry(90, 70, 48, 36), []);
  const base = useMemo(() => Float32Array.from(geo.attributes.position.array as Float32Array), [geo]);
  const amp = SWELL[forecast] * 1.6;
  useFrame(({ clock }) => waveSea(geo, base, clock.elapsedTime, amp));
  return (
    <mesh geometry={geo} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -10]} receiveShadow>
      <meshStandardMaterial color={SEA[forecast]} roughness={0.35} metalness={0.1} transparent opacity={0.94} />
    </mesh>
  );
}

function ShipRig({ frame, heel, ghost, warnIds, interactive, onColumn, forecast, shadows }: SceneProps & { shadows: boolean }) {
  const bob = useRef<THREE.Group>(null);
  const swell = SWELL[forecast];
  const sink = frame.capsize * 2.2;
  useFrame(({ clock }) => {
    if (bob.current) bobShip(bob.current, clock.elapsedTime, swell, sink);
  });
  return (
    <group ref={bob}>
      <group rotation={[0, 0, (-heel * Math.PI) / 180]}>
        <Hull shadows={shadows} />
        {frame.crates.map((d) => (
          <CrateMesh key={d.c.id} d={d} warn={warnIds.has(d.c.id)} shadows={shadows} />
        ))}
        {ghost && <GhostMesh g={ghost} />}
        {interactive &&
          Array.from({ length: COLS }, (_, c) => (
            <mesh
              key={c}
              position={[colX(c, 1), DECK + (TIERS * H) / 2, 0]}
              onPointerDown={(e) => {
                e.stopPropagation();
                onColumn(c);
              }}
            >
              <boxGeometry args={[U, TIERS * H + 0.6, DEPTH + 0.6]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
          ))}
      </group>
    </group>
  );
}

function Crane({ ghost }: { ghost: Ghost | null }) {
  const top = 9.5;
  const tx = ghost ? colX(ghost.x, ghost.len) : 0;
  return (
    <group>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 7.4, top / 2 - 0.5, -0.2]}>
          <boxGeometry args={[0.35, top + 1, 0.35]} />
          <meshStandardMaterial color="#f59e0b" roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[0, top, -0.2]}>
        <boxGeometry args={[15.2, 0.4, 0.5]} />
        <meshStandardMaterial color="#f59e0b" roughness={0.6} />
      </mesh>
      <mesh position={[tx, top - 0.3, -0.2]}>
        <boxGeometry args={[0.9, 0.35, 0.8]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
    </group>
  );
}

function Splashes({ frame }: { frame: Frame }) {
  return (
    <>
      {frame.splashes.map((s, i) => (
        <group key={i} position={[colX(s.x, 1), 0.05, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.3 + s.u * 1.6, 0.45 + s.u * 1.8, 28]} />
            <meshBasicMaterial color="#e0f2fe" transparent opacity={1 - s.u} side={THREE.DoubleSide} />
          </mesh>
          {[-0.4, 0.1, 0.5].map((dx, k) => (
            <mesh key={k} position={[dx, 0.3 + Math.sin(s.u * Math.PI) * (1.2 + k * 0.4), 0.2 * k]}>
              <sphereGeometry args={[0.12, 8, 6]} />
              <meshBasicMaterial color="#f0f9ff" transparent opacity={1 - s.u} />
            </mesh>
          ))}
        </group>
      ))}
    </>
  );
}

function aimCamera(cam: THREE.PerspectiveCamera, aspect: number) {
  // keep the 11-unit-wide bay + crane legs in view on narrow screens
  const dist = aspect < 0.9 ? 24 : aspect < 1.3 ? 19 : 16;
  cam.position.set(0, 5.5 + dist * 0.12, dist);
  cam.lookAt(0, 3.1, 0);
}

function CameraRig() {
  const { camera, size } = useThree();
  const aspect = size.width / Math.max(1, size.height);
  useFrame(() => aimCamera(camera as THREE.PerspectiveCamera, aspect));
  return null;
}

export interface SceneProps {
  frame: Frame;
  heel: number;
  ghost: Ghost | null;
  warnIds: Set<number>;
  interactive: boolean;
  onColumn: (c: number) => void;
  forecast: Forecast;
  quality?: "high" | "low";
}

export default function ShipScene(props: SceneProps) {
  const high = props.quality !== "low";
  const f = props.forecast;
  return (
    <Canvas shadows={high} dpr={high ? [1, 1.75] : 1} gl={{ antialias: high, powerPreference: "high-performance" }} camera={{ fov: 38, position: [0, 7, 16], near: 0.1, far: 200 }} style={{ touchAction: "none" }}>
      <color attach="background" args={[SKY[f]]} />
      <fog attach="fog" args={[SKY[f], 28, 80]} />
      <CameraRig />
      <hemisphereLight args={[f === "storm" ? "#cbd5e1" : "#f0f9ff", "#0c4a6e", f === "storm" ? 0.6 : 0.85]} />
      <ambientLight intensity={0.2} />
      <directionalLight position={[6, 14, 9]} intensity={f === "storm" ? 0.9 : 1.6} color="#fff7e6" castShadow={high} shadow-mapSize-width={1024} shadow-mapSize-height={1024} shadow-camera-left={-10} shadow-camera-right={10} shadow-camera-top={12} shadow-camera-bottom={-4} />
      <Sea forecast={f} />
      <ShipRig {...props} shadows={high} />
      <Crane ghost={props.ghost} />
      <Splashes frame={props.frame} />
    </Canvas>
  );
}
