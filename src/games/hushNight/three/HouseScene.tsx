"use client";

import { useMemo, useRef, type RefObject } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { AdaptiveResolution } from "@/games/shared/three/sceneFx";
import { emojiTexture, labelTexture } from "@/games/shared/three/tableKit";
import { EXIT, H, W, xy, type Cell, type RoundReport } from "../engine";

/**
 * 숨죽인 밤 3D (rulebook §7). A moonlit 7×7 room seen from above my own
 * corner: furniture under dust sheets on blocked cells, the glowing cellar
 * hatch in the middle, gold keys, a pawn with a tiny lantern per player and
 * the tall blind monster. After each round the pawns slide to their new
 * cells, noise ripples spread from every sound, and the monster lumbers
 * along its path. Lint: per-frame mutation lives in plain functions.
 */

export interface PawnView {
  seat: number;
  name: string;
  color: string;
  at: Cell;
  carry: number;
  away: boolean;
}

export interface HouseSceneProps {
  viewerSeat: number;
  viewerCorner: Cell;
  blocked: Cell[];
  keys: Cell[];
  pawns: PawnView[];
  monster: Cell;
  last: RoundReport | null;
  /** Cells the viewer may tap now (legal targets for the chosen mode). */
  targets: Cell[];
  targetColor: string;
  selected: Cell | null;
  /** 🔰 helper: where the monster would walk. */
  preview: Cell[];
  dread: number;
  lowDetail: boolean;
  onTap: ((c: Cell) => void) | null;
}

const S = 1.2;
const pos = (c: Cell): [number, number] => {
  const { x, y } = xy(c);
  return [(x - (W - 1) / 2) * S, (y - (H - 1) / 2) * S];
};
const MOVE_S = 0.8;
const MONSTER_DELAY = 0.9;
const MONSTER_STEP = 0.4;

/* ── animation clock: restarts whenever a new round report arrives ── */

interface ClockState {
  /** undefined until the first frame — the report seen on mount is shown settled */
  report: RoundReport | null | undefined;
  t0: number;
}
type Clock = RefObject<ClockState>;
function animT(clockRef: Clock, report: RoundReport | null, now: number): number {
  const clock = clockRef.current;
  if (clock.report !== report) {
    clock.t0 = clock.report === undefined ? -1e9 : now;
    clock.report = report;
  }
  return now - clock.t0;
}

function lerp2(a: [number, number], b: [number, number], k: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}
const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));

/* ── pieces ─────────────────────────────────────────────────────────── */

function Floor({ blocked, onTap, targets, targetColor, selected, preview }: Pick<HouseSceneProps, "blocked" | "onTap" | "targets" | "targetColor" | "selected" | "preview">) {
  const bs = useMemo(() => new Set(blocked), [blocked]);
  const tset = useMemo(() => new Set(targets), [targets]);
  const pset = useMemo(() => new Set(preview), [preview]);
  const cells = Array.from({ length: W * H }, (_, c) => c);
  return (
    <group>
      {cells.map((c) => {
        const [x, z] = pos(c);
        const { x: cx, y: cy } = xy(c);
        const shade = (cx + cy) % 2 ? "#5a4433" : "#6b523d";
        const tap = (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          if (onTap && tset.has(c) && e.delta < 8) onTap(c);
        };
        return (
          <group key={c} position={[x, 0, z]}>
            <mesh rotation-x={-Math.PI / 2} onClick={tap} receiveShadow>
              <planeGeometry args={[S * 0.98, S * 0.98]} />
              <meshStandardMaterial color={c === EXIT ? "#7a5530" : shade} roughness={0.9} />
            </mesh>
            {tset.has(c) && (
              <mesh rotation-x={-Math.PI / 2} position={[0, 0.012, 0]}>
                <planeGeometry args={[S * 0.86, S * 0.86]} />
                <meshBasicMaterial color={targetColor} transparent opacity={c === selected ? 0.55 : 0.2} depthWrite={false} />
              </mesh>
            )}
            {pset.has(c) && (
              <mesh rotation-x={-Math.PI / 2} position={[0, 0.016, 0]}>
                <ringGeometry args={[S * 0.22, S * 0.32, 24]} />
                <meshBasicMaterial color="#ef4444" transparent opacity={0.7} depthWrite={false} />
              </mesh>
            )}
            {bs.has(c) && <Furniture c={c} />}
          </group>
        );
      })}
    </group>
  );
}

/** A piece of furniture under a dust sheet — the shape varies by cell. */
function Furniture({ c }: { c: Cell }) {
  const kind = (c * 7) % 3;
  const h = kind === 0 ? 0.95 : kind === 1 ? 0.5 : 0.7;
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow>
        <boxGeometry args={[S * 0.86, h, S * (kind === 1 ? 0.86 : 0.6)]} />
        <meshStandardMaterial color="#a8a29e" roughness={1} />
      </mesh>
      <mesh position={[0, h + 0.02, 0]}>
        <boxGeometry args={[S * 0.9, 0.05, S * (kind === 1 ? 0.9 : 0.64)]} />
        <meshStandardMaterial color="#c4bfba" roughness={1} />
      </mesh>
    </group>
  );
}

function Hatch() {
  const glow = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => pulse(glow.current, clock.elapsedTime));
  const [x, z] = pos(EXIT);
  return (
    <group position={[x, 0.02, z]}>
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[S * 0.7, S * 0.7]} />
        <meshStandardMaterial color="#5b3a1e" roughness={0.8} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.005, 0]}>
        <ringGeometry args={[S * 0.36, S * 0.44, 32]} />
        <meshBasicMaterial ref={glow} color="#fbbf24" transparent opacity={0.5} toneMapped={false} />
      </mesh>
    </group>
  );
}
function pulse(m: THREE.MeshBasicMaterial | null, t: number) {
  if (m) m.opacity = 0.35 + Math.sin(t * 2) * 0.2;
}

function Key({ c }: { c: Cell }) {
  const ref = useRef<THREE.Group>(null);
  const [x, z] = pos(c);
  useFrame(({ clock }) => spin(ref.current, clock.elapsedTime + c));
  return (
    <group ref={ref} position={[x, 0.35, z]}>
      <mesh>
        <torusGeometry args={[0.08, 0.025, 8, 16]} />
        <meshStandardMaterial color="#fbbf24" emissive="#b45309" emissiveIntensity={0.8} metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0, -0.16, 0]}>
        <boxGeometry args={[0.03, 0.2, 0.03]} />
        <meshStandardMaterial color="#fbbf24" emissive="#b45309" emissiveIntensity={0.8} metalness={0.8} roughness={0.3} />
      </mesh>
      <pointLight color="#fbbf24" intensity={0.5} distance={1.4} />
    </group>
  );
}
function spin(g: THREE.Group | null, t: number) {
  if (!g) return;
  g.rotation.y = t * 1.6;
  g.position.y = 0.35 + Math.sin(t * 2.2) * 0.05;
}

function Pawn({ p, last, clock }: { p: PawnView; last: RoundReport | null; clock: Clock }) {
  const ref = useRef<THREE.Group>(null);
  const name = useMemo(() => labelTexture(`${p.name}${p.carry ? ` 🗝️${p.carry}` : ""}`, p.color), [p.name, p.carry, p.color]);
  useFrame(({ clock: c }) => pawnFrame(ref.current, p, last, clock, c.elapsedTime));
  const [x, z] = pos(p.at);
  return (
    <group ref={ref} position={[x, 0, z]}>
      <mesh position={[0, 0.35, 0]} castShadow>
        <cylinderGeometry args={[0.16, 0.24, 0.7, 14]} />
        <meshStandardMaterial color={p.color} roughness={0.6} transparent opacity={p.away ? 0.4 : 1} />
      </mesh>
      <mesh position={[0, 0.82, 0]} castShadow>
        <sphereGeometry args={[0.17, 14, 12]} />
        <meshStandardMaterial color="#fde7c7" roughness={0.7} />
      </mesh>
      {/* tiny lantern */}
      <mesh position={[0.24, 0.5, 0]}>
        <sphereGeometry args={[0.05, 8, 6]} />
        <meshBasicMaterial color="#fde68a" toneMapped={false} />
      </mesh>
      <pointLight position={[0.24, 0.6, 0]} color="#fcd34d" intensity={0.9} distance={2.2} decay={1.5} />
      <sprite position={[0, 1.35, 0]} scale={[1.5, 0.37, 1]}>
        <spriteMaterial map={name} transparent depthWrite={false} />
      </sprite>
    </group>
  );
}

function pawnFrame(g: THREE.Group | null, p: PawnView, last: RoundReport | null, clock: Clock, now: number) {
  if (!g) return;
  const t = animT(clock, last, now);
  const end = pos(p.at);
  if (!last || t > MONSTER_DELAY + MONSTER_STEP * 4) {
    g.position.set(end[0], 0, end[1]);
    g.scale.setScalar(1);
    return;
  }
  const from = pos(last.from[p.seat]);
  const m = last.moves[p.seat];
  const moved = m && (m.kind === "walk" || m.kind === "run") ? pos(m.to) : from;
  const caught = last.caught.includes(p.seat);
  const catchAt = MONSTER_DELAY + MONSTER_STEP * last.monsterPath.length;
  if (caught && t > catchAt) {
    // dragged into the dark, then back at the start
    const k = Math.min(1, (t - catchAt) / 0.5);
    g.position.set(end[0], 0, end[1]);
    g.scale.setScalar(k);
    return;
  }
  const [x, z] = lerp2(from, moved, ease(t / MOVE_S));
  const hop = m?.kind === "run" ? Math.abs(Math.sin((t / MOVE_S) * Math.PI * 2)) * 0.12 : 0;
  g.position.set(x, t < MOVE_S ? hop : 0, z);
  g.scale.setScalar(1);
}

function Monster({ at, last, clock, dread }: { at: Cell; last: RoundReport | null; clock: Clock; dread: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock: c }) => monsterFrame(ref.current, at, last, clock, c.elapsedTime));
  const [x, z] = pos(at);
  return (
    <group ref={ref} position={[x, 0, z]}>
      <mesh position={[0, 1.05, 0]} castShadow>
        <capsuleGeometry args={[0.24, 1.4, 6, 12]} />
        <meshStandardMaterial color="#1c1917" emissive="#7f1d1d" emissiveIntensity={0.45} roughness={1} />
      </mesh>
      <mesh position={[0, 2.05, 0.04]}>
        <sphereGeometry args={[0.22, 14, 12]} />
        <meshStandardMaterial color="#292524" emissive="#7f1d1d" emissiveIntensity={0.6} roughness={1} />
      </mesh>
      {/* no eyes — only a gaping mouth */}
      <mesh position={[0, 1.98, 0.22]}>
        <circleGeometry args={[0.08, 16]} />
        <meshBasicMaterial color="#ef4444" toneMapped={false} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.34, 1.0, 0]} rotation-z={s * 0.18}>
          <capsuleGeometry args={[0.05, 1.1, 4, 8]} />
          <meshStandardMaterial color="#1c1917" emissive="#7f1d1d" emissiveIntensity={0.45} roughness={1} />
        </mesh>
      ))}
      {/* a red pool on the floor so its cell reads at a glance */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]}>
        <ringGeometry args={[S * 0.3, S * 0.44, 28]} />
        <meshBasicMaterial color="#dc2626" transparent opacity={0.55} depthWrite={false} toneMapped={false} />
      </mesh>
      <pointLight position={[0, 1.2, 0]} color="#dc2626" intensity={1.4 + dread * 1.2} distance={3.2} decay={1.4} />
    </group>
  );
}

function monsterFrame(g: THREE.Group | null, at: Cell, last: RoundReport | null, clock: Clock, now: number) {
  if (!g) return;
  const t = animT(clock, last, now);
  const sway = Math.sin(now * 1.3) * 0.08;
  g.rotation.z = sway * 0.4;
  let p = pos(at);
  if (last && last.monsterPath.length && t < MONSTER_DELAY + MONSTER_STEP * last.monsterPath.length) {
    const cells = [last.monsterFrom, ...last.monsterPath];
    const u = Math.max(0, (t - MONSTER_DELAY) / MONSTER_STEP);
    const i = Math.min(cells.length - 2, Math.floor(u));
    p = lerp2(pos(cells[i]), pos(cells[i + 1]), ease(u - i));
    const dir = pos(cells[i + 1]);
    g.rotation.y = Math.atan2(dir[0] - p[0], dir[1] - p[1]) || g.rotation.y;
  }
  g.position.set(p[0], Math.abs(Math.sin(now * 2.6)) * 0.03, p[1]);
}

/** Expanding rings from every sound of the last round. */
function Ripples({ last, colors, clock }: { last: RoundReport | null; colors: Record<number, string>; clock: Clock }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(({ clock: c }) => rippleFrame(refs.current, last, clock, c.elapsedTime));
  if (!last) return null;
  return (
    <group>
      {last.noises.map((n, i) => {
        const [x, z] = pos(n.at);
        return (
          <mesh
            key={`${last.round}-${i}`}
            ref={(el) => {
              refs.current[i] = el;
            }}
            rotation-x={-Math.PI / 2}
            position={[x, 0.03, z]}
          >
            <ringGeometry args={[0.95, 1, 48]} />
            <meshBasicMaterial color={n.why === "throw" ? "#e5e7eb" : (colors[n.seat] ?? "#fff")} transparent opacity={0} depthWrite={false} toneMapped={false} />
          </mesh>
        );
      })}
      {last.target && (
        <group position={[pos(last.target.at)[0], 1.6, pos(last.target.at)[1]]}>
          <sprite scale={[0.5, 0.5, 1]}>
            <spriteMaterial map={emojiTexture("👂")} transparent depthWrite={false} />
          </sprite>
        </group>
      )}
    </group>
  );
}

function rippleFrame(meshes: (THREE.Mesh | null)[], last: RoundReport | null, clock: Clock, now: number) {
  if (!last) return;
  const t = animT(clock, last, now) - MOVE_S * 0.6;
  last.noises.forEach((n, i) => {
    const m = meshes[i];
    if (!m) return;
    const radius = n.level * 2 * S;
    const k = Math.max(0, Math.min(1, t / 1.2));
    m.scale.setScalar(0.05 + k * radius);
    (m.material as THREE.MeshBasicMaterial).opacity = t < 0 || k >= 1 ? 0 : (1 - k) * 0.6;
  });
}

function Room() {
  const span = W * S;
  return (
    <group>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} rotation-y={(i * Math.PI) / 2} position={[Math.sin((i * Math.PI) / 2) * (span / 2 + 0.05), 1.3, Math.cos((i * Math.PI) / 2) * (span / 2 + 0.05)]}>
          <planeGeometry args={[span + 0.1, 2.6]} />
          <meshStandardMaterial color="#3a2c22" roughness={1} side={THREE.BackSide} />
        </mesh>
      ))}
      {/* moonlit windows on the far walls */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 1.6, 1.6, -span / 2 + 0.02]}>
          <planeGeometry args={[0.9, 1.2]} />
          <meshBasicMaterial color="#93c5fd" transparent opacity={0.35} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

function CameraRig({ corner, yaw }: { corner: Cell; yaw: RefObject<number> }) {
  useFrame(({ camera, size }) => camFrame(camera, corner, yaw.current, size.width / Math.max(1, size.height)));
  return null;
}
function camFrame(camera: THREE.Camera, corner: Cell, yaw: number, aspect: number) {
  const [cx, cz] = pos(corner);
  const base = Math.atan2(cx, cz);
  const a = base + yaw;
  // the house is seen corner-on (a diamond): on a narrow canvas pull back until its side corners fit
  const k = Math.max(1, 1.3 / aspect);
  const r = 8.4 * k;
  camera.position.set(Math.sin(a) * r, 10.4 * k, Math.cos(a) * r);
  camera.lookAt(Math.sin(a) * 0.5, 0, Math.cos(a) * 0.5);
}

export default function HouseScene(p: HouseSceneProps) {
  const clock = useRef<ClockState>({ report: undefined, t0: 0 });
  const yaw = useRef(0);
  const drag = useRef<{ x: number; yaw: number } | null>(null);
  const colors = Object.fromEntries(p.pawns.map((x) => [x.seat, x.color]));
  const high = !p.lowDetail;
  return (
    <div
      className="h-full w-full"
      style={{ touchAction: "none" }}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, yaw: yaw.current };
      }}
      onPointerMove={(e) => {
        if (drag.current) yaw.current = Math.max(-0.9, Math.min(0.9, drag.current.yaw + (e.clientX - drag.current.x) * 0.006));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerLeave={() => {
        drag.current = null;
      }}
    >
      <Canvas shadows={high} dpr={high ? [1, 1.75] : 1} gl={{ antialias: high, powerPreference: "high-performance" }} camera={{ fov: 45, position: [0, 9, 9], near: 0.1, far: 60 }}>
        <color attach="background" args={["#030305"]} />
        <fog attach="fog" args={["#030305", 18, 40]} />
        <AdaptiveResolution max={1.75} />
        <CameraRig corner={p.viewerCorner} yaw={yaw} />
        <ambientLight intensity={0.75 - p.dread * 0.3} color="#a5b4fc" />
        <directionalLight position={[-4, 8, -6]} intensity={1.1} color="#93c5fd" castShadow={high} shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
        <pointLight position={[0, 0.6, 0]} color="#f59e0b" intensity={0.8} distance={3} />
        <Room />
        <Floor blocked={p.blocked} onTap={p.onTap} targets={p.targets} targetColor={p.targetColor} selected={p.selected} preview={p.preview} />
        <Hatch />
        {p.keys.map((k, i) => (
          <Key key={`${k}-${i}`} c={k} />
        ))}
        {p.pawns.map((x) => (
          <Pawn key={x.seat} p={x} last={p.last} clock={clock} />
        ))}
        <Monster at={p.monster} last={p.last} clock={clock} dread={p.dread} />
        <Ripples last={p.last} colors={colors} clock={clock} />
      </Canvas>
    </div>
  );
}
