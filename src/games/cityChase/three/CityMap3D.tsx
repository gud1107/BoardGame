"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import {
  cellContents,
  cellRC,
  CELL_COUNT,
  GRID,
  MIDPOINT_ROUND,
  POINT_GRID,
  pointCells,
  pointIJ,
  TOKEN_ROUND,
  type Cell,
  type Point,
  type SearchRecord,
  type TokenColor,
} from "../engine";
import { cellLabel, HELI_STYLES, type CityMapProps } from "../CityMap";
import { clamp01, easeInOut, easeOutBack, labelTexture } from "@/games/shared/three/tableKit";

/**
 * 시티 체이스 입체 도시 — 2D `CityMap`과 똑같은 props를 받아 같은 정보를
 * 밤의 도시로 그린다: 5×5 빌딩(창문 불빛), 교차로 36곳, 하늘에 떠 있는 헬기
 * 3대(돌아가는 로터 + 아래로 비추는 탐조등 = 감시 구역), 수색하면 빌딩이 번쩍
 * 들려 그 아래 흔적 토큰/차가 보인다. 도둑(또는 게임 종료 후)에게만
 * `showSecret`으로 차와 흔적이 보이고(빌딩이 반투명해짐), 경찰 화면에는 공개
 * 정보(수색 기록 배지·추리 지도 열)만 그린다 — 2D와 같은 가림 규칙.
 */

const STEP = 2;
const HALF = (GRID * STEP) / 2;
const px = (j: number) => j * STEP - HALF; // road line j → world x
const pz = (i: number) => i * STEP - HALF;
const cx = (c: number) => px(c) + STEP / 2;
const cz = (r: number) => pz(r) + STEP / 2;
const FOOT = 1.35;

const TOKEN_HEX: Record<TokenColor, string> = { yellow: "#facc15", blue: "#22d3ee", purple: "#a855f7", red: "#ef4444" };
const TOKEN_ICON: Record<TokenColor, string> = { yellow: "🟡", blue: "🔵", purple: "🟣", red: "🔴" };
const FACADES = ["#334155", "#3f3f5a", "#2f4858", "#44403c", "#3b3561", "#1f3b4d"];

function buildingHeight(cell: Cell): number {
  return 1.3 + ((cell * 7 + 3) % 5) * 0.45;
}

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

const windowTex: Partial<Record<"map" | "glow", THREE.CanvasTexture>> = {};
/** Window grid: "map" = white wall with dark/lit panes (tints the facade colour), "glow" = only the lit panes (emissive). */
function windowTexture(kind: "map" | "glow"): THREE.CanvasTexture {
  const hit = windowTex[kind];
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = kind === "map" ? "#ffffff" : "#000000";
  ctx.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      const lit = Math.abs((Math.sin(x * 12.9 + y * 78.2) * 43758.5) % 1) > 0.55;
      ctx.fillStyle = lit ? "#fde68a" : kind === "map" ? "#1e293b" : "#000000";
      ctx.fillRect(4 + x * 15, 5 + y * 15, 9, 9);
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  windowTex[kind] = t;
  return t;
}

const chipCache = new Map<string, THREE.CanvasTexture>();
/** A round token chip face with its round number (blank when only the colour is known). */
function chipTexture(color: TokenColor, n: number | null): THREE.CanvasTexture {
  const key = `${color}:${n ?? ""}`;
  let t = chipCache.get(key);
  if (t) return t;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fillStyle = TOKEN_HEX[color];
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.stroke();
  if (n !== null) {
    ctx.fillStyle = color === "yellow" ? "#111827" : "#ffffff";
    ctx.font = "900 64px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(n), 64, 68);
  }
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  chipCache.set(key, t);
  return t;
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Ground() {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial color="#0b1324" roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[GRID * STEP + 1.2, GRID * STEP + 1.2]} />
        <meshStandardMaterial color="#334155" roughness={0.95} />
      </mesh>
      {Array.from({ length: POINT_GRID }, (_, k) => (
        <group key={k}>
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.005, pz(k)]}>
            <planeGeometry args={[GRID * STEP + 1, 0.04]} />
            <meshBasicMaterial color="#fde68a" transparent opacity={0.35} />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position={[px(k), 0.005, 0]}>
            <planeGeometry args={[0.04, GRID * STEP + 1]} />
            <meshBasicMaterial color="#fde68a" transparent opacity={0.35} />
          </mesh>
        </group>
      ))}
      {/* distant skyline silhouettes */}
      {Array.from({ length: 28 }, (_, i) => {
        const a = (i / 28) * Math.PI * 2;
        const h = 3 + ((i * 7) % 5) * 1.6;
        return (
          <mesh key={i} position={[Math.sin(a) * 22, h / 2, Math.cos(a) * 22]}>
            <boxGeometry args={[2.4, h, 2.4]} />
            <meshStandardMaterial color="#111a2e" emissive="#1e293b" emissiveIntensity={0.3} />
          </mesh>
        );
      })}
    </group>
  );
}

function Chip({ color, n, position, size = 0.34 }: { color: TokenColor; n: number | null; position: [number, number, number]; size?: number }) {
  return (
    <mesh position={position} rotation-x={-Math.PI / 2}>
      <circleGeometry args={[size / 2, 24]} />
      <meshBasicMaterial map={chipTexture(color, n)} transparent />
    </mesh>
  );
}

function Car({ position }: { position: [number, number, number] }) {
  const light = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (light.current) light.current.color.set(Math.sin(clock.elapsedTime * 6) > 0 ? "#ef4444" : "#7f1d1d");
  });
  return (
    <group position={position} scale={0.75}>
      <mesh position={[0, 0.16, 0]} castShadow>
        <boxGeometry args={[0.9, 0.22, 0.46]} />
        <meshStandardMaterial color="#dc2626" metalness={0.4} roughness={0.35} />
      </mesh>
      <mesh position={[-0.05, 0.34, 0]}>
        <boxGeometry args={[0.48, 0.18, 0.42]} />
        <meshStandardMaterial color="#1e293b" metalness={0.5} roughness={0.2} />
      </mesh>
      {[-0.28, 0.28].flatMap((x) =>
        [-0.24, 0.24].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.08, z]} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.09, 0.09, 0.06, 12]} />
            <meshStandardMaterial color="#0a0a0a" />
          </mesh>
        )),
      )}
      <mesh position={[0.46, 0.18, 0]}>
        <boxGeometry args={[0.02, 0.06, 0.36]} />
        <meshBasicMaterial ref={light} color="#ef4444" />
      </mesh>
    </group>
  );
}

type Reveal = { cell: Cell; result: SearchRecord["result"]; tokens: TokenColor[]; key: number };

function Building({
  cell,
  clickable,
  tone,
  covered,
  heat,
  note,
  lifting,
  translucent,
  onClick,
  lowDetail,
}: {
  cell: Cell;
  clickable: boolean;
  tone: "search" | "thief" | null;
  covered: boolean;
  heat: number;
  note: SearchRecord | undefined;
  lifting: Reveal | null;
  translucent: boolean;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
  lowDetail: boolean;
}) {
  const [r, c] = cellRC(cell);
  const h = buildingHeight(cell);
  const ref = useRef<THREE.Group>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const roof = useRef<THREE.MeshStandardMaterial>(null);
  const liftStart = useRef<{ key: number; at: number } | null>(null);
  const facade = FACADES[(cell * 5 + 1) % FACADES.length];
  const [tex, glow] = useMemo(
    () =>
      (["map", "glow"] as const).map((k) => {
        const t = windowTexture(k).clone();
        t.repeat.set(1, Math.max(1, Math.round(h * 1.2)));
        t.needsUpdate = true;
        return t;
      }),
    [h],
  );
  const baseRoof = useMemo(() => new THREE.Color(facade).lerp(new THREE.Color("#ffffff"), 0.2), [facade]);
  const heatColor = useMemo(() => new THREE.Color("#f43f5e"), []);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    let y = 0;
    let tilt = 0;
    if (lifting) {
      if (!liftStart.current || liftStart.current.key !== lifting.key) liftStart.current = { key: lifting.key, at: clock.elapsedTime };
      const t = clock.elapsedTime - liftStart.current.at;
      const up = easeOutBack(clamp01(t / 0.45));
      const down = lifting.result === "caught" ? 0 : easeInOut(clamp01((t - 1.45) / 0.4));
      y = (2.6 + h * 0.2) * up * (1 - down);
      tilt = -0.12 * up * (1 - down);
    }
    g.position.y = y;
    g.rotation.z = tilt;
    const pulse = tone ? 0.35 + Math.sin(clock.elapsedTime * 5) * 0.25 : 0;
    if (mat.current) {
      mat.current.emissiveIntensity = 0.55 + pulse;
      mat.current.opacity = translucent ? 0.35 : 1;
    }
    if (roof.current) {
      roof.current.color.copy(baseRoof).lerp(heatColor, Math.min(0.85, heat > 0.004 ? 0.15 + heat * 2.2 : 0));
      roof.current.emissive.set(tone === "search" ? "#38bdf8" : tone === "thief" ? "#fb7185" : covered ? "#0c4a6e" : "#000000");
      roof.current.emissiveIntensity = tone ? 0.5 + pulse : covered ? 0.4 : 0;
      roof.current.opacity = translucent ? 0.4 : 1;
    }
  });
  const label = cellLabel(cell);
  const roofLabel = heat > 0.004 ? `${label} · ${Math.round(heat * 100)}%` : label;
  const noteText = note ? (note.result === "trail" ? `흔적 ${note.tokens.map((t) => TOKEN_ICON[t]).join("")} R${note.round}` : `✕ 빈집 R${note.round}`) : null;
  return (
    <group position={[cx(c), 0, cz(r)]}>
      <group ref={ref} onClick={onClick}>
        <mesh position={[0, h / 2, 0]} castShadow={!lowDetail} receiveShadow>
          <boxGeometry args={[FOOT, h, FOOT]} />
          <meshStandardMaterial
            ref={mat}
            color={facade}
            map={tex}
            emissive={tone === "search" ? "#38bdf8" : tone === "thief" ? "#fb7185" : "#ffffff"}
            emissiveMap={tone ? null : glow}
            emissiveIntensity={0.55}
            roughness={0.6}
            transparent={translucent}
            depthWrite={!translucent}
          />
        </mesh>
        <mesh position={[0, h + 0.05, 0]}>
          <boxGeometry args={[FOOT + 0.06, 0.1, FOOT + 0.06]} />
          <meshStandardMaterial ref={roof} color={baseRoof} roughness={0.7} transparent={translucent} />
        </mesh>
        <sprite position={[0, h + 0.38, 0]} scale={[heat > 0.004 ? 1.8 : 1.5, heat > 0.004 ? 0.45 : 0.37, 1]}>
          <spriteMaterial map={labelTexture(roofLabel, tone === "search" ? "#38bdf8" : tone === "thief" ? "#fb7185" : heat > 0.004 ? "#f43f5e" : "#64748b")} transparent depthWrite={false} />
        </sprite>
        {tone && (
          <sprite position={[0, h + 1.0, 0]} scale={[1.2, 0.3, 1]}>
            <spriteMaterial map={labelTexture(tone === "search" ? "🔍 수색" : "➜ 이동", tone === "search" ? "#38bdf8" : "#fb7185")} transparent depthWrite={false} />
          </sprite>
        )}
        {noteText && !lifting && (
          <sprite position={[0, h + (tone ? 1.4 : 0.9), 0]} scale={[1.6, 0.4, 1]}>
            <spriteMaterial
              map={labelTexture(noteText, note!.result === "trail" ? "#fbbf24" : "#cbd5e1", { bg: note!.result === "trail" ? "rgba(120,53,15,0.9)" : "rgba(30,41,59,0.85)" })}
              transparent
              depthWrite={false}
            />
          </sprite>
        )}
        {/* generous tap target */}
        {clickable && (
          <mesh position={[0, h / 2, 0]} visible={false}>
            <boxGeometry args={[STEP * 0.9, h + 1, STEP * 0.9]} />
          </mesh>
        )}
      </group>
    </group>
  );
}

function Helicopter({ at, index, active }: { at: Point; index: number; active: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const rotor = useRef<THREE.Group>(null);
  const beam = useRef<THREE.MeshBasicMaterial>(null);
  const cur = useRef<THREE.Vector3 | null>(null);
  const color = HELI_STYLES[index].hex;
  const [i, j] = pointIJ(at);
  const target = useMemo(() => new THREE.Vector3(px(j), 3.6 + index * 0.25, pz(i)), [i, j, index]);
  const numTex = useMemo(() => labelTexture(`🚁 ${index + 1}`, color), [index, color]);
  useFrame(({ clock }, dt) => {
    const g = ref.current;
    if (!g) return;
    if (!cur.current) cur.current = target.clone();
    const prev = cur.current.clone();
    cur.current.lerp(target, 1 - Math.exp(-dt * 3));
    const vel = cur.current.clone().sub(prev);
    g.position.copy(cur.current);
    g.position.y += Math.sin(clock.elapsedTime * 2 + index) * 0.06;
    if (vel.lengthSq() > 1e-6) g.rotation.y = Math.atan2(-vel.z, vel.x);
    g.rotation.z = -Math.min(0.35, vel.length() * 8);
    if (rotor.current) rotor.current.rotation.y += dt * 28;
    if (beam.current) beam.current.opacity = active ? 0.16 + Math.sin(clock.elapsedTime * 4) * 0.05 : 0.07;
  });
  return (
    <group ref={ref}>
      <group>
        <mesh castShadow>
          <capsuleGeometry args={[0.22, 0.4, 6, 12]} />
          <meshStandardMaterial color={color} metalness={0.3} roughness={0.35} />
        </mesh>
        <mesh position={[0.1, 0.05, 0]} rotation-z={Math.PI / 2} scale={[1, 1, 0.9]}>
          <sphereGeometry args={[0.18, 12, 10, 0, Math.PI]} />
          <meshStandardMaterial color="#bae6fd" metalness={0.5} roughness={0.1} transparent opacity={0.85} />
        </mesh>
        <mesh position={[-0.6, 0.05, 0]} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.05, 0.08, 0.7, 8]} />
          <meshStandardMaterial color={color} metalness={0.3} roughness={0.35} />
        </mesh>
        <mesh position={[-0.95, 0.15, 0]}>
          <boxGeometry args={[0.08, 0.25, 0.04]} />
          <meshStandardMaterial color="#e5e7eb" />
        </mesh>
        {[-0.18, 0.18].map((z) => (
          <mesh key={z} position={[0, -0.32, z]} rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[0.02, 0.02, 0.7, 6]} />
            <meshStandardMaterial color="#111827" />
          </mesh>
        ))}
      </group>
      <group ref={rotor} position={[0, 0.34, 0]}>
        {[0, 1].map((k) => (
          <mesh key={k} rotation-y={(k * Math.PI) / 2}>
            <boxGeometry args={[1.5, 0.015, 0.07]} />
            <meshStandardMaterial color="#0f172a" />
          </mesh>
        ))}
      </group>
      {/* searchlight cone over the 4 watched buildings */}
      <mesh position={[0, -1.85, 0]}>
        <coneGeometry args={[STEP * 0.95, 3.4, 4, 1, true]} />
        <meshBasicMaterial ref={beam} color={color} transparent opacity={0.08} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <sprite position={[0, 0.85, 0]} scale={[0.85, 0.21, 1]}>
        <spriteMaterial map={numTex} transparent depthWrite={false} />
      </sprite>
    </group>
  );
}

function PointTarget({ p, color, placing, onClick }: { p: Point; color: string; placing: boolean; onClick: (e: ThreeEvent<MouseEvent>) => void }) {
  const [i, j] = pointIJ(p);
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ring.current) ring.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 5 + p) * 0.12);
  });
  return (
    <group position={[px(j), 0.02, pz(i)]} onClick={onClick}>
      <mesh ref={ring} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.28, 0.4, 28]} />
        <meshBasicMaterial color={color} transparent opacity={0.95} depthWrite={false} />
      </mesh>
      <mesh position={[0, 1.2, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 2.4, 6]} />
        <meshBasicMaterial color={color} transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <sprite position={[0, 2.6, 0]} scale={[1.0, 0.25, 1]}>
        <spriteMaterial map={labelTexture(placing ? "＋ 배치" : "↗ 이동", color)} transparent depthWrite={false} />
      </sprite>
      <mesh position={[0, 1.2, 0]} visible={false}>
        <cylinderGeometry args={[0.55, 0.55, 2.6, 8]} />
      </mesh>
    </group>
  );
}

function Route({ path, winner, endReason }: { path: Cell[]; winner: CityMapProps["state"]["winner"]; endReason: CityMapProps["state"]["endReason"] }) {
  const geo = useMemo(() => {
    if (path.length < 2) return null;
    const curve = new THREE.CurvePath<THREE.Vector3>();
    for (let k = 1; k < path.length; k++) {
      const [r0, c0] = cellRC(path[k - 1]);
      const [r1, c1] = cellRC(path[k]);
      curve.add(new THREE.LineCurve3(new THREE.Vector3(cx(c0), 0.25, cz(r0)), new THREE.Vector3(cx(c1), 0.25, cz(r1))));
    }
    return new THREE.TubeGeometry(curve, path.length * 8, 0.07, 6, false);
  }, [path]);
  const [drawn, setDrawn] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setDrawn((d) => (d >= path.length ? d : d + 1)), 250);
    return () => window.clearInterval(t);
  }, [path.length]);
  return (
    <group>
      {geo && (
        <mesh geometry={geo}>
          <meshBasicMaterial color="#ef4444" />
        </mesh>
      )}
      {path.slice(0, drawn).map((cell, k) => {
        const [r, c] = cellRC(cell);
        const round = k + 1;
        const last = k === path.length - 1;
        const text = last ? `${round} ${winner === "thief" ? "🏆 탈출" : endReason === "trapped" ? "🚧 갇힘" : "🚨 검거"}` : round === 1 ? "1 START" : round === MIDPOINT_ROUND ? `${round} 💜` : String(round);
        return (
          <sprite key={k} position={[cx(c), 0.55 + (k % 2) * 0.12, cz(r)]} scale={[text.length > 3 ? 1.1 : 0.55, text.length > 3 ? 0.27 : 0.27, 1]} renderOrder={12}>
            <spriteMaterial map={labelTexture(text, round === MIDPOINT_ROUND ? "#a855f7" : last ? "#ffffff" : "#ef4444", { bg: round === 1 ? "rgba(161,98,7,0.95)" : "rgba(127,29,29,0.95)" })} transparent depthWrite={false} depthTest={false} />
          </sprite>
        );
      })}
    </group>
  );
}

/** Orbit camera: drag to swing around / tilt; starts from the south (A1 top-left like the 2D map). */
function CameraRig() {
  const gl = useThree((s) => s.gl);
  const yaw = useRef(0);
  const yawTarget = useRef(0);
  const pitch = useRef(1.0);
  const pitchTarget = useRef(1.0);
  useEffect(() => {
    const el = gl.domElement;
    let drag: { x: number; y: number; yaw: number; pitch: number } | null = null;
    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY, yaw: yawTarget.current, pitch: pitchTarget.current };
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      yawTarget.current = drag.yaw - ((e.clientX - drag.x) / (el.clientWidth || 1)) * 3.2;
      pitchTarget.current = Math.max(0.6, Math.min(1.5, drag.pitch + ((e.clientY - drag.y) / (el.clientHeight || 1)) * 1.6));
    };
    const up = () => {
      drag = null;
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    for (const ev of ["pointerup", "pointerleave", "pointercancel"] as const) el.addEventListener(ev, up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      for (const ev of ["pointerup", "pointerleave", "pointercancel"] as const) el.removeEventListener(ev, up);
    };
  }, [gl]);
  useFrame((frame) => {
    const cam = frame.camera as THREE.PerspectiveCamera;
    const aspect = frame.size.width / frame.size.height;
    yaw.current += (yawTarget.current - yaw.current) * 0.12;
    pitch.current += (pitchTarget.current - pitch.current) * 0.12;
    const fov = 45;
    const need = (GRID * STEP + 2.2) / 2 / Math.tan(((fov / 2) * Math.PI) / 180);
    const dist = (need / Math.min(1, aspect)) * 1.05;
    cam.position.set(Math.sin(yaw.current) * Math.cos(pitch.current) * dist, Math.sin(pitch.current) * dist + 1, Math.cos(yaw.current) * Math.cos(pitch.current) * dist);
    cam.lookAt(0, 0.8, 0.4);
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  });
  return null;
}

function SceneContents(props: CityMapProps & { reveal: Reveal | null; lowDetail: boolean }) {
  const { state, showSecret, revealRoute, thiefTargets, heliControls, heat, latestSearch, reveal, lowDetail } = props;
  const covered = new Set<Cell>();
  for (const p of state.helis) for (const c of pointCells(p)) covered.add(c);
  const carCell = state.path.length ? state.path[state.path.length - 1] : null;
  const pathOrder = new Map<Cell, number[]>();
  if (showSecret) state.path.forEach((c, i) => pathOrder.set(c, [...(pathOrder.get(c) ?? []), i + 1]));
  const tap = (e: ThreeEvent<MouseEvent>, fn: () => void) => {
    e.stopPropagation();
    if (e.delta > 8) return;
    fn();
  };
  return (
    <>
      <color attach="background" args={["#070b18"]} />
      <fog attach="fog" args={["#070b18", 18, 40]} />
      <ambientLight intensity={0.45} color="#93c5fd" />
      <hemisphereLight args={["#7dd3fc", "#0f172a", 0.5]} />
      <directionalLight
        position={[-6, 14, 9]}
        intensity={1.1}
        color="#e0e7ff"
        castShadow={!lowDetail}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
      />
      <Ground />
      {Array.from({ length: CELL_COUNT }, (_, cell) => {
        const [r, c] = cellRC(cell);
        const isThiefTarget = thiefTargets?.has(cell) ?? false;
        const isSearchTarget = heliControls?.searchTargets.includes(cell) ?? false;
        const clickable = isThiefTarget || isSearchTarget;
        const lifting = reveal?.cell === cell ? reveal : null;
        const contents = showSecret ? cellContents(state, cell) : null;
        const hasCar = showSecret && carCell === cell;
        const groundTokens = lifting
          ? lifting.tokens.map((t) => ({ color: t, n: TOKEN_ROUND[t] }))
          : (contents?.tokens.filter((_, i, arr) => !(hasCar && i === arr.length - 1)) ?? []).map((t, i) => ({ color: t, n: pathOrder.get(cell)?.[i] ?? TOKEN_ROUND[t] }));
        const showCar = lifting ? lifting.result === "caught" : hasCar;
        return (
          <group key={cell}>
            {groundTokens.map((t, k) => (
              <Chip key={k} color={t.color} n={t.n} position={[cx(c) + (k - (groundTokens.length - 1) / 2) * 0.38, 0.03 + k * 0.002, cz(r) + 0.35]} />
            ))}
            {showCar && <Car position={[cx(c), 0.02, cz(r) - 0.15]} />}
            <Building
              cell={cell}
              clickable={clickable}
              tone={isSearchTarget ? "search" : isThiefTarget ? "thief" : null}
              covered={covered.has(cell)}
              heat={heat ? heat[cell] : 0}
              note={latestSearch.get(cell)}
              lifting={lifting}
              translucent={!lifting && showSecret && (hasCar || (pathOrder.get(cell)?.length ?? 0) > 0) && !revealRoute}
              onClick={(e) => clickable && tap(e, () => props.onCellClick?.(cell))}
              lowDetail={lowDetail}
            />
          </group>
        );
      })}
      {heliControls?.moveTargets.map((p) => (
        <PointTarget key={`t${p}`} p={p} color={HELI_STYLES[heliControls.heli].hex} placing={!!heliControls.placing} onClick={(e) => tap(e, () => props.onPointClick?.(p))} />
      ))}
      {state.helis.map((p, h) => (
        <Helicopter key={h} at={p} index={h} active={(state.phase === "police" || state.phase === "deploy") && state.heliTurn === h} />
      ))}
      {revealRoute && state.path.length > 0 && <Route path={state.path} winner={state.winner} endReason={state.endReason} />}
      <CameraRig />
    </>
  );
}

export default function CityMap3D(props: CityMapProps & { lowDetail: boolean }) {
  const { state } = props;
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [lastSeq, setLastSeq] = useState(state.seq);
  // Same "lift the searched building" trigger as the 2D map, keyed off `seq`.
  if (lastSeq !== state.seq) {
    setLastSeq(state.seq);
    const ev = state.lastEvent;
    if (ev?.kind === "search") setReveal({ cell: ev.cell, result: ev.result, tokens: ev.tokens, key: state.seq });
  }
  useEffect(() => {
    if (!reveal || reveal.result === "caught") return;
    const t = window.setTimeout(() => setReveal((r) => (r && r.key === reveal.key ? null : r)), 1900);
    return () => window.clearTimeout(t);
  }, [reveal]);
  const high = !props.lowDetail;
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[min(92vw,620px)] overflow-hidden rounded-3xl ring-1 ring-white/10">
      <Canvas
        shadows={high}
        dpr={high ? [1, 1.75] : [1, 1.25]}
        gl={{ antialias: high, powerPreference: "high-performance" }}
        camera={{ fov: 45, position: [0, 14, 10], near: 0.1, far: 120 }}
        style={{ touchAction: "none" }}
      >
        <SceneContents {...props} reveal={reveal} />
      </Canvas>
      {reveal && reveal.result === "caught" && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center">
          <div className="rounded-2xl bg-red-600/90 px-5 py-3 text-center text-lg font-black text-white shadow-2xl" style={{ animation: "cc3d-pop .5s ease-out both, cc3d-fade .5s ease-in 2.2s forwards" }}>
            🚨 검거! {cellLabel(reveal.cell)}
          </div>
        </div>
      )}
      <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-[11px] whitespace-nowrap text-white/70">드래그로 회전 · 빛나는 건물/교차로를 탭</span>
      <style>{`
        @keyframes cc3d-pop { 0% { transform: scale(.3); opacity: 0 } 60% { transform: scale(1.15); opacity: 1 } 100% { transform: scale(1) } }
        @keyframes cc3d-fade { to { opacity: 0; transform: scale(.9) } }
      `}</style>
    </div>
  );
}
