"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { resolveLook, type PersonLook } from "@/games/shared/three/SeatedPerson";
import { roomCharacterOf, useRoomCharacters } from "@/lib/character/roomCharacters";
import { AdaptiveResolution } from "@/games/shared/three/sceneFx";
import VrmBody, { addWalk, setBone, BODY, BODY_DROP } from "@/games/shared/three/VrmBody";
import { buildCourse, type Course } from "../course";
import { CRUMBLY, LEDGE, OVERHANG, ROCK_WARN_MS, ROPE_LEN, SEAT_COLORS, SMOOTH, WALL_W, type Cell, type CourseId } from "../data";
import type { SnapBuffer, Snap } from "../net";
import type { PlayerState } from "../sim";

/**
 * 한 줄 등반대 3D 무대 (룰북 §10): 정면에서 본 암벽(칸마다 상자 + 종류 표식), 줄로 이어진
 * VRM 등반가, 낙석·돌풍·별·깃발. 모든 움직임은 스냅샷 버퍼를 매 프레임 읽어 React 다시 그리기
 * 없이 만든다. 색만으로 알리지 않는다: 매끈한 암반 = 움푹 + 빗금, 부서지는 바위 = ✕,
 * 오버행 = 튀어나옴 + ▼, 턱 = 선반.
 */

export interface SceneFx {
  k: "ring" | "burst";
  x: number;
  y: number;
  at: number;
  color: string;
}

export interface SceneShared {
  buf: SnapBuffer;
  mySeat: number;
  shake: number;
  /** 자리별 이름표 DOM (무대가 매 프레임 옮긴다) */
  labels: (HTMLDivElement | null)[];
  /** 보드가 넣는 순간 효과 */
  fx: SceneFx[];
}

export interface WallSceneProps {
  shared: MutableRefObject<SceneShared>;
  names: Record<number, string>;
  seatCount: number;
  seed: number;
  course: CourseId;
  quality: "high" | "low";
  onFps?: (fps: number) => void;
}

interface Theme {
  sky: [string, string];
  fog: string;
  rock: string;
  rock2: string;
  smooth: string;
  ledge: string;
  crumbly: string;
  overhang: string;
  hole: string;
  flank: string;
  light: string;
  mark: string;
}

const THEME: Record<CourseId, Theme> = {
  hill: { sky: ["#6fc1f5", "#eaf8ff"], fog: "#d5ecf7", rock: "#8f8477", rock2: "#7b7166", smooth: "#d9d2c4", ledge: "#6aa84f", crumbly: "#a8744a", overhang: "#5f574f", hole: "#3b352f", flank: "#5d6b4f", light: "#fff3d6", mark: "#3a332b" },
  ice: { sky: ["#5c95cf", "#eef8ff"], fog: "#d8ecfa", rock: "#7090a8", rock2: "#5e7b92", smooth: "#e6f7ff", ledge: "#ffffff", crumbly: "#a7bccb", overhang: "#42607a", hole: "#2c4256", flank: "#b9d3e6", light: "#eef6ff", mark: "#1f3447" },
  volcano: { sky: ["#241519", "#e0673b"], fog: "#5c3230", rock: "#62504a", rock2: "#4e403b", smooth: "#1c181a", ledge: "#d3623f", crumbly: "#8f5c3c", overhang: "#2e2523", hole: "#120e0e", flank: "#33262a", light: "#ffd0a4", mark: "#ffb27a" },
};

const Z_BODY = 0.62;
const HEAD_Y = 1.05;
const hash = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/* ── 하늘·주변 ──────────────────────────────────────────────────────── */

function gradientTexture(top: string, bottom: string): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const g = c.getContext("2d")!;
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, top);
  grd.addColorStop(1, bottom);
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function markTexture(kind: "smooth" | "crumbly" | "overhang", color: string): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineCap = "round";
  if (kind === "smooth") {
    g.globalAlpha = 0.45;
    g.lineWidth = 3;
    for (let k = -1; k < 4; k++) {
      g.beginPath();
      g.moveTo(k * 22 - 6, 60);
      g.lineTo(k * 22 + 26, 4);
      g.stroke();
    }
  } else if (kind === "crumbly") {
    g.globalAlpha = 0.9;
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(16, 16);
    g.lineTo(48, 48);
    g.moveTo(48, 16);
    g.lineTo(16, 48);
    g.stroke();
  } else {
    g.globalAlpha = 0.9;
    g.beginPath();
    g.moveTo(14, 20);
    g.lineTo(50, 20);
    g.lineTo(32, 48);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function Backdrop({ theme, height, high }: { theme: Theme; height: number; high: boolean }) {
  const tex = useMemo(() => gradientTexture(theme.sky[0], theme.sky[1]), [theme]);
  useEffect(() => () => tex.dispose(), [tex]);
  const peaks = useMemo(
    () =>
      Array.from({ length: high ? 9 : 5 }, (_, i) => ({
        x: -70 + i * (140 / (high ? 8 : 4)) + hash(i + 3) * 10,
        h: 30 + hash(i + 11) * 45,
        r: 16 + hash(i + 29) * 14,
        z: -60 - hash(i + 41) * 40,
      })),
    [high],
  );
  return (
    <>
      <mesh position={[0, height / 2, -140]}>
        <planeGeometry args={[520, 320]} />
        <meshBasicMaterial map={tex} fog={false} depthWrite={false} />
      </mesh>
      {peaks.map((p, i) => (
        <mesh key={i} position={[p.x, p.h / 2 - 12, p.z]}>
          <coneGeometry args={[p.r, p.h, 5]} />
          <meshLambertMaterial color={theme.flank} />
        </mesh>
      ))}
      {/* 암벽 양옆으로 이어지는 절벽 (조금 물러나 있음) */}
      {[-1, 1].map((d) => (
        <mesh key={d} position={[d * (WALL_W / 2 + 20), height / 2, -1.6]}>
          <boxGeometry args={[40, height + 60, 2]} />
          <meshLambertMaterial color={theme.rock2} />
        </mesh>
      ))}
      {/* 정상 위 풀밭/눈 */}
      <mesh position={[0, height + 1.06, -0.3]}>
        <boxGeometry args={[WALL_W + 80, 0.12, 2.4]} />
        <meshLambertMaterial color={theme.ledge} />
      </mesh>
      {/* 출발 바닥 */}
      <mesh position={[0, -0.5, 4]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[200, 30]} />
        <meshLambertMaterial color={theme.flank} />
      </mesh>
    </>
  );
}

/* ── 벽 ─────────────────────────────────────────────────────────────── */

const m4 = new THREE.Matrix4();
const q0 = new THREE.Quaternion();
const v3a = new THREE.Vector3();
const v3b = new THREE.Vector3();
const col = new THREE.Color();

function cellDepth(v: Cell, i: number): number {
  if (v === SMOOTH) return 0.42;
  if (v === OVERHANG) return 0.98;
  return 0.6 + hash(i) * 0.24;
}

function paintWall(mesh: THREE.InstancedMesh, course: Course, theme: Theme, gone: Set<number>, crumbling: Set<number>) {
  const n = course.cells.length;
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / WALL_W);
    const c = i % WALL_W;
    const dead = gone.has(i);
    const v = dead ? SMOOTH : course.cells[i];
    const d = dead ? 0.2 : cellDepth(v, i);
    v3a.set(c + 0.5 - WALL_W / 2, r + 0.5, d / 2 - 0.6);
    v3b.set(0.985, 0.985, d);
    m4.compose(v3a, q0, v3b);
    mesh.setMatrixAt(i, m4);
    const base = dead ? theme.hole : v === SMOOTH ? theme.smooth : v === CRUMBLY ? theme.crumbly : v === OVERHANG ? theme.overhang : hash(i + 7) < 0.5 ? theme.rock : theme.rock2;
    col.set(base);
    if (crumbling.has(i)) col.lerp(new THREE.Color("#ff5a3c"), 0.55);
    else if (!dead && v !== SMOOTH) col.offsetHSL(0, 0, (hash(i + 19) - 0.5) * 0.06);
    mesh.setColorAt(i, col);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function wallFrame(mesh: THREE.InstancedMesh | null, marks: THREE.InstancedMesh | null, shared: SceneShared, course: Course, theme: Theme, sig: { v: string }, crumblyIdx: number[]) {
  const snap = shared.buf.latest();
  if (!mesh || !snap) return;
  const s = `${snap.seed}:${snap.gone.length}:${snap.crumb.map((c) => c.i).join(",")}`;
  if (s === sig.v) return;
  sig.v = s;
  const gone = new Set(snap.gone);
  paintWall(mesh, course, theme, gone, new Set(snap.crumb.map((c) => c.i)));
  if (marks) {
    // 떨어져 나간 부서지는 바위는 ✕ 표식도 지운다
    crumblyIdx.forEach((i, k) => {
      const r = Math.floor(i / WALL_W);
      const c = i % WALL_W;
      v3a.set(c + 0.5 - WALL_W / 2, r + 0.5, cellDepth(CRUMBLY, i) - 0.6 + 0.012);
      v3b.setScalar(gone.has(i) ? 0.0001 : 0.8);
      m4.compose(v3a, q0, v3b);
      marks.setMatrixAt(k, m4);
    });
    marks.instanceMatrix.needsUpdate = true;
  }
}

function Marks({ course, kind, cell, theme, meshRef }: { course: Course; kind: "smooth" | "crumbly" | "overhang"; cell: Cell; theme: Theme; meshRef?: MutableRefObject<THREE.InstancedMesh | null> }) {
  const idx = useMemo(() => course.cells.map((v, i) => (v === cell ? i : -1)).filter((i) => i >= 0), [course, cell]);
  const tex = useMemo(() => markTexture(kind, theme.mark), [kind, theme]);
  useEffect(() => () => tex.dispose(), [tex]);
  const own = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = own.current;
    if (!mesh) return;
    idx.forEach((i, k) => {
      const r = Math.floor(i / WALL_W);
      const c = i % WALL_W;
      v3a.set(c + 0.5 - WALL_W / 2, r + 0.5, cellDepth(cell, i) - 0.6 + 0.012);
      v3b.setScalar(kind === "smooth" ? 0.98 : 0.8);
      m4.compose(v3a, q0, v3b);
      mesh.setMatrixAt(k, m4);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (meshRef) meshRef.current = mesh;
  }, [idx, cell, kind, meshRef]);
  if (idx.length === 0) return null;
  return (
    <instancedMesh ref={own} args={[undefined, undefined, idx.length]} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} />
    </instancedMesh>
  );
}

function Wall({ shared, course, theme }: { shared: MutableRefObject<SceneShared>; course: Course; theme: Theme }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const crumbMarks = useRef<THREE.InstancedMesh | null>(null);
  const sig = useRef({ v: "" });
  const crumblyIdx = useMemo(() => course.cells.map((v, i) => (v === CRUMBLY ? i : -1)).filter((i) => i >= 0), [course]);
  const ledges = useMemo(() => course.cells.map((v, i) => (v === LEDGE ? i : -1)).filter((i) => i >= 0), [course]);
  const ledgeMesh = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    sig.current.v = "";
    const lm = ledgeMesh.current;
    if (!lm) return;
    ledges.forEach((i, k) => {
      const r = Math.floor(i / WALL_W);
      const c = i % WALL_W;
      v3a.set(c + 0.5 - WALL_W / 2, r + 0.08, 0.5);
      v3b.set(1, 1, 1);
      m4.compose(v3a, q0, v3b);
      lm.setMatrixAt(k, m4);
    });
    lm.instanceMatrix.needsUpdate = true;
  }, [ledges, course]);
  useFrame(() => wallFrame(mesh.current, crumbMarks.current, shared.current, course, theme, sig.current, crumblyIdx));
  return (
    <>
      <instancedMesh ref={mesh} args={[undefined, undefined, course.cells.length]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={ledgeMesh} args={[undefined, undefined, Math.max(1, ledges.length)]} frustumCulled={false}>
        <boxGeometry args={[1.02, 0.16, 1.05]} />
        <meshLambertMaterial color={theme.ledge} />
      </instancedMesh>
      <Marks course={course} kind="smooth" cell={SMOOTH} theme={theme} />
      <Marks course={course} kind="crumbly" cell={CRUMBLY} theme={theme} meshRef={crumbMarks} />
      <Marks course={course} kind="overhang" cell={OVERHANG} theme={theme} />
    </>
  );
}

/* ── 깃발·별 ────────────────────────────────────────────────────────── */

function Flags({ course }: { course: Course }) {
  return (
    <>
      {course.camps.slice(1).map((cp, i) => (
        <group key={i} position={[cp.c0 - WALL_W / 2 + 0.2, cp.row + 0.16, 0.75]}>
          <mesh position={[0, 0.5, 0]}>
            <cylinderGeometry args={[0.03, 0.03, 1, 6]} />
            <meshLambertMaterial color="#f1f5f9" />
          </mesh>
          <mesh position={[0.22, 0.82, 0]}>
            <planeGeometry args={[0.44, 0.28]} />
            <meshBasicMaterial color="#38bdf8" side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
      <group position={[0, course.height + 0.16, 0.6]}>
        <mesh position={[0, 0.9, 0]}>
          <cylinderGeometry args={[0.045, 0.045, 1.8, 6]} />
          <meshLambertMaterial color="#f8fafc" />
        </mesh>
        <mesh position={[0.42, 1.5, 0]}>
          <planeGeometry args={[0.84, 0.52]} />
          <meshBasicMaterial color="#ef4444" side={THREE.DoubleSide} />
        </mesh>
      </group>
    </>
  );
}

function starsFrame(g: THREE.Group | null, shared: SceneShared, t: number) {
  const snap = shared.buf.latest();
  if (!g || !snap) return;
  g.children.forEach((c, i) => {
    c.visible = !snap.stars[i];
    c.rotation.y = t * 2 + i;
    c.position.z = 0.75 + Math.sin(t * 3 + i) * 0.05;
  });
}

function Stars({ shared, course }: { shared: MutableRefObject<SceneShared>; course: Course }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => starsFrame(g.current, shared.current, clock.elapsedTime));
  return (
    <group ref={g}>
      {course.stars.map((s, i) => (
        <mesh key={i} position={[s.x, s.y, 0.75]}>
          <octahedronGeometry args={[0.3, 0]} />
          <meshStandardMaterial color="#fde047" emissive="#f59e0b" emissiveIntensity={0.7} metalness={0.4} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

/* ── 줄 ─────────────────────────────────────────────────────────────── */

const ROPE_PIECES = 10;
const UP = new THREE.Vector3(0, 1, 0);
const pa = new THREE.Vector3();
const pb = new THREE.Vector3();
const dir = new THREE.Vector3();
const slackColor = new THREE.Color("#f5e6c8");
const tautColor = new THREE.Color("#ff7a2f");

function ropeFrame(g: THREE.Group | null, mat: THREE.MeshLambertMaterial | null, shared: SceneShared, seg: number) {
  const snap = shared.buf.latest();
  if (!g || !snap) return;
  const now = performance.now();
  const a = shared.buf.pose(seg, shared.mySeat, now);
  const b = shared.buf.pose(seg + 1, shared.mySeat, now);
  if (!a || !b) {
    g.visible = false;
    return;
  }
  g.visible = true;
  const L = snap.ropes[seg] ?? ROPE_LEN;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const sag = d < L - 0.05 ? Math.min(2.4, 0.45 * Math.sqrt(Math.max(0, L * L - d * d))) : 0;
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2 - sag;
  const at = (k: number, out: THREE.Vector3) => {
    const u = 1 - k;
    out.set(u * u * a.x + 2 * u * k * cx + k * k * b.x, u * u * a.y + 2 * u * k * cy + k * k * b.y, Z_BODY + 0.12);
  };
  g.children.forEach((c, i) => {
    at(i / ROPE_PIECES, pa);
    at((i + 1) / ROPE_PIECES, pb);
    dir.subVectors(pb, pa);
    const len = dir.length();
    c.position.addVectors(pa, pb).multiplyScalar(0.5);
    c.scale.set(1, Math.max(0.001, len), 1);
    c.quaternion.setFromUnitVectors(UP, dir.normalize());
  });
  if (mat) mat.color.copy(snap.taut[seg] ? tautColor : slackColor);
}

function Rope({ shared, seg }: { shared: MutableRefObject<SceneShared>; seg: number }) {
  const g = useRef<THREE.Group>(null);
  const mat = useMemo(() => new THREE.MeshLambertMaterial({ color: "#f5e6c8" }), []);
  const geo = useMemo(() => new THREE.CylinderGeometry(0.035, 0.035, 1, 5), []);
  useEffect(
    () => () => {
      mat.dispose();
      geo.dispose();
    },
    [mat, geo],
  );
  useFrame(() => ropeFrame(g.current, mat, shared.current, seg));
  return (
    <group ref={g}>
      {Array.from({ length: ROPE_PIECES }, (_, i) => (
        <mesh key={i} geometry={geo} material={mat} />
      ))}
    </group>
  );
}

/* ── 낙석·돌풍·효과 ─────────────────────────────────────────────────── */

const MAX_ROCKS = 6;

function rocksFrame(g: THREE.Group | null, shared: SceneShared, t: number) {
  const snap = shared.buf.latest();
  if (!g || !snap) return;
  const simNow = shared.buf.simNow(performance.now());
  for (let i = 0; i < MAX_ROCKS; i++) {
    const rock = g.children[i * 2] as THREE.Mesh;
    const beam = g.children[i * 2 + 1] as THREE.Mesh;
    const r = snap.rocks[i];
    if (!r) {
      rock.visible = false;
      beam.visible = false;
      continue;
    }
    const falling = simNow >= r.fallAt;
    rock.visible = falling;
    beam.visible = true;
    beam.position.set(r.x, r.y0 - 20, Z_BODY + 0.3);
    const warn = Math.max(0, Math.min(1, 1 - (r.fallAt - simNow) / ROCK_WARN_MS));
    (beam.material as THREE.MeshBasicMaterial).opacity = falling ? 0.12 : 0.1 + 0.22 * warn * (0.6 + 0.4 * Math.sin(t * 22));
    if (falling) {
      rock.position.set(r.x, r.y, Z_BODY + 0.1);
      rock.rotation.set(t * 5 + i, t * 3, 0);
    }
  }
}

function Rocks({ shared, theme }: { shared: MutableRefObject<SceneShared>; theme: Theme }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => rocksFrame(g.current, shared.current, clock.elapsedTime));
  return (
    <group ref={g}>
      {Array.from({ length: MAX_ROCKS }, (_, i) => [
        <mesh key={`r${i}`} visible={false}>
          <dodecahedronGeometry args={[0.55, 0]} />
          <meshLambertMaterial color={theme.overhang} />
        </mesh>,
        <mesh key={`b${i}`} visible={false}>
          <planeGeometry args={[1.1, 44]} />
          <meshBasicMaterial color="#ff3b30" transparent opacity={0.2} depthWrite={false} />
        </mesh>,
      ])}
    </group>
  );
}

function windFrame(g: THREE.Group | null, shared: SceneShared, t: number) {
  const snap = shared.buf.latest();
  if (!g || !snap) return;
  const w = snap.wind;
  const simNow = shared.buf.simNow(performance.now());
  const blowing = !!w && simNow >= w.from;
  g.visible = blowing;
  if (!blowing || !w) return;
  let cy = 0;
  for (const p of snap.players) cy += p.y;
  cy /= Math.max(1, snap.players.length);
  g.children.forEach((c, i) => {
    const phase = (t * 1.4 + hash(i + 5)) % 1;
    c.position.set(w.dir * (phase * 26 - 13), cy - 6 + hash(i + 77) * 13, Z_BODY + 0.6 + hash(i) * 1.2);
  });
}

function WindStreaks({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => windFrame(g.current, shared.current, clock.elapsedTime));
  return (
    <group ref={g} visible={false}>
      {Array.from({ length: 14 }, (_, i) => (
        <mesh key={i}>
          <planeGeometry args={[2.6, 0.05]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.55} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

const MAX_FX = 8;

function fxFrame(g: THREE.Group | null, shared: SceneShared) {
  if (!g) return;
  const now = performance.now();
  shared.fx = shared.fx.filter((f) => now - f.at < 700).slice(-MAX_FX);
  g.children.forEach((c, i) => {
    const f = shared.fx[i];
    const mesh = c as THREE.Mesh;
    if (!f) {
      mesh.visible = false;
      return;
    }
    const k = (now - f.at) / 700;
    mesh.visible = true;
    mesh.position.set(f.x, f.y, Z_BODY + 0.35);
    mesh.scale.setScalar(f.k === "ring" ? 0.4 + k * 2.2 : 0.3 + k * 1.2);
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.color.set(f.color);
    mat.opacity = 0.85 * (1 - k);
  });
}

function FxLayer({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const g = useRef<THREE.Group>(null);
  useFrame(() => fxFrame(g.current, shared.current));
  return (
    <group ref={g}>
      {Array.from({ length: MAX_FX }, (_, i) => (
        <mesh key={i} visible={false}>
          <ringGeometry args={[0.7, 0.9, 28]} />
          <meshBasicMaterial transparent opacity={0.8} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

/* ── 등반가 ─────────────────────────────────────────────────────────── */

export type ClimbPose = "climb" | "hold" | "hang" | "fall" | "stand" | "walk" | "haul" | "stun" | "cheer" | "sad";

interface ClimberFrame {
  x: number;
  y: number;
  mode: ClimbPose;
  speed: number;
  /** 줄에 매달려 기운 각도 */
  tilt: number;
  /** 벽을 보나(true) 카메라를 보나 */
  toWall: boolean;
  visible: boolean;
}

export function poseOf(snap: Snap, p: PlayerState, onLedge: boolean): ClimbPose {
  if (snap.phase === "gameOver") return snap.cleared ? "cheer" : "sad";
  if (snap.t < p.stunUntil) return p.mode === "air" && !p.hang ? "fall" : "stun";
  if (p.mode === "air") return p.hang ? "hang" : "fall";
  if (p.hauling) return "haul";
  const v = Math.hypot(p.vx, p.vy);
  if (onLedge) return p.summit ? "cheer" : v > 0.3 ? "walk" : "stand";
  return v > 0.25 ? "climb" : "hold";
}

function Climber({ look, seed, color, lowDetail, read }: { look: PersonLook; seed: number; color: string; lowDetail: boolean; read: () => ClimberFrame }) {
  const root = useRef<THREE.Group>(null);
  const anim = useRef({ phase: 0, mode: "hold" as ClimbPose, yaw: Math.PI, tilt: 0 });

  const pose = (o: Float32Array, t: number, dt: number) => {
    const f = read();
    const a = anim.current;
    a.mode = f.mode;
    const r = root.current;
    if (r) {
      r.visible = f.visible;
      const wantYaw = f.toWall ? Math.PI : 0;
      a.yaw += (wantYaw - a.yaw) * Math.min(1, dt * 8);
      a.tilt += (f.tilt - a.tilt) * Math.min(1, dt * 10);
      r.position.set(f.x, f.y, Z_BODY);
      r.rotation.set(0, a.yaw, a.yaw > Math.PI / 2 ? -a.tilt : a.tilt);
    }
    switch (f.mode) {
      case "climb": {
        a.phase += dt * (5 + f.speed * 6);
        const w = Math.sin(a.phase);
        setBone(o, "rightUpperArm", -2.5 + w * 0.55, 0, -0.25);
        setBone(o, "leftUpperArm", -2.5 - w * 0.55, 0, 0.25);
        setBone(o, "rightLowerArm", -0.5 + w * 0.4);
        setBone(o, "leftLowerArm", -0.5 - w * 0.4);
        setBone(o, "rightUpperLeg", -0.75 - w * 0.5, 0, -0.25);
        setBone(o, "leftUpperLeg", -0.75 + w * 0.5, 0, 0.25);
        setBone(o, "rightLowerLeg", 1.2 + w * 0.5);
        setBone(o, "leftLowerLeg", 1.2 - w * 0.5);
        o[BODY.spine] -= 0.08;
        break;
      }
      case "hold":
        setBone(o, "rightUpperArm", -2.7, 0, -0.3);
        setBone(o, "leftUpperArm", -2.3, 0, 0.35);
        setBone(o, "rightLowerArm", -0.4);
        setBone(o, "leftLowerArm", -0.7);
        setBone(o, "rightUpperLeg", -0.9, 0, -0.3);
        setBone(o, "leftUpperLeg", -0.45, 0, 0.25);
        setBone(o, "rightLowerLeg", 1.4);
        setBone(o, "leftLowerLeg", 0.8);
        o[BODY.spine] += Math.sin(t * 2 + seed) * 0.03;
        break;
      case "hang": {
        const w = Math.sin(t * 3 + seed);
        setBone(o, "rightUpperArm", -3.0, 0, -0.12);
        setBone(o, "leftUpperArm", -3.0, 0, 0.12);
        setBone(o, "rightUpperLeg", -0.15 + w * 0.18);
        setBone(o, "leftUpperLeg", -0.15 - w * 0.18);
        setBone(o, "rightLowerLeg", 0.35);
        setBone(o, "leftLowerLeg", 0.35);
        o[BODY.head] += 0.2;
        break;
      }
      case "fall": {
        const w = Math.sin(t * 18);
        setBone(o, "rightUpperArm", -2.4 + w * 0.5, 0, -0.9);
        setBone(o, "leftUpperArm", -2.4 - w * 0.5, 0, 0.9);
        setBone(o, "rightUpperLeg", -0.6 - w * 0.4);
        setBone(o, "leftUpperLeg", -0.6 + w * 0.4);
        setBone(o, "rightLowerLeg", 0.8);
        setBone(o, "leftLowerLeg", 0.8);
        o[BODY.head] -= 0.3;
        break;
      }
      case "walk":
        a.phase += dt * 9;
        addWalk(o, a.phase, 0.8);
        break;
      case "haul": {
        const w = Math.sin(t * 9);
        setBone(o, "rightUpperArm", -1.5 + w * 0.8, 0, -0.2);
        setBone(o, "leftUpperArm", -1.5 - w * 0.8, 0, 0.2);
        setBone(o, "rightLowerArm", -0.9 - w * 0.4);
        setBone(o, "leftLowerArm", -0.9 + w * 0.4);
        setBone(o, "rightUpperLeg", -0.5, 0, -0.3);
        setBone(o, "leftUpperLeg", -0.5, 0, 0.3);
        setBone(o, "rightLowerLeg", 0.9);
        setBone(o, "leftLowerLeg", 0.9);
        o[BODY.spine] -= 0.2;
        o[BODY_DROP] += 0.08;
        break;
      }
      case "stun": {
        const w = Math.sin(t * 14);
        setBone(o, "rightUpperArm", -0.6, 0, -0.9 + w * 0.2);
        setBone(o, "leftUpperArm", -0.6, 0, 0.9 - w * 0.2);
        o[BODY.head + 2] += w * 0.3;
        o[BODY.spine + 2] += w * 0.12;
        break;
      }
      case "cheer": {
        const w = Math.sin(t * 9 + seed);
        setBone(o, "rightUpperArm", -2.6 + w * 0.25, 0, -0.5);
        setBone(o, "leftUpperArm", -2.6 - w * 0.25, 0, 0.5);
        setBone(o, "rightLowerArm", -0.5);
        setBone(o, "leftLowerArm", -0.5);
        o[BODY_DROP] -= Math.max(0, w) * 0.06;
        break;
      }
      case "sad":
        o[BODY.head] += 0.45;
        o[BODY.spine] += 0.2;
        setBone(o, "rightUpperArm", 0, 0, -0.1);
        setBone(o, "leftUpperArm", 0, 0, 0.1);
        break;
      default:
        o[BODY.spine] += Math.sin(t * 2 + seed) * 0.03;
        setBone(o, "rightUpperArm", 0, 0, -0.15);
        setBone(o, "leftUpperArm", 0, 0, 0.15);
        break;
    }
  };

  const face = () => {
    const m = anim.current.mode;
    if (m === "fall" || m === "stun") return { surprised: 1 };
    if (m === "cheer") return { happy: 1 };
    if (m === "sad") return { sad: 0.8 };
    if (m === "haul") return { angry: 0.6 };
    if (m === "hang") return { surprised: 0.4 };
    return { happy: 0.2 };
  };

  return (
    <group ref={root} visible={false}>
      <VrmBody
        look={look}
        seed={seed}
        headY={HEAD_Y}
        pose={pose}
        face={face}
        lowDetail={lowDetail}
        follow={14}
        head={
          <group position={[0, -0.02, -0.01]}>
            {/* 자리 색 헬멧 — 멀리서도 누가 누군지 */}
            <mesh scale={[1, 0.82, 1.05]}>
              <sphereGeometry args={[0.115, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial color={color} roughness={0.5} />
            </mesh>
          </group>
        }
        fallback={
          <mesh position={[0, 0.55, 0]} scale={[0.3, 0.55, 0.25]}>
            <sphereGeometry args={[1, 14, 10]} />
            <meshBasicMaterial color={color} transparent opacity={0.5} />
          </mesh>
        }
      />
    </group>
  );
}

function ClimberSlot({ seat, names, shared, lowDetail, course }: { seat: number; names: Record<number, string>; shared: MutableRefObject<SceneShared>; lowDetail: boolean; course: Course }) {
  const chars = useRoomCharacters((st) => st.byName);
  const name = names[seat] ?? "";
  const look = useMemo(() => resolveLook(seat, ["none"], roomCharacterOf(chars, name)), [seat, chars, name]);
  const frame = useRef<ClimberFrame>({ x: 0, y: 0, mode: "hold", speed: 0, tilt: 0, toWall: true, visible: false });
  const read = () => {
    const sh = shared.current;
    const snap = sh.buf.latest();
    const p = snap?.players[seat];
    const f = frame.current;
    if (!snap || !p) {
      f.visible = false;
      return f;
    }
    const pos = sh.buf.pose(seat, sh.mySeat, performance.now());
    if (!pos) {
      f.visible = false;
      return f;
    }
    f.visible = true;
    const row = Math.floor(pos.y);
    const ci = Math.floor(pos.x + WALL_W / 2);
    const cell = row >= 0 && row <= course.height && ci >= 0 && ci < WALL_W ? course.cells[row * WALL_W + ci] : undefined;
    const onLedge = p.mode === "grip" && cell === LEDGE;
    f.mode = poseOf(snap, p, onLedge);
    f.x = pos.x;
    // 턱에선 선반 위에 서고, 벽에선 몸 가운데가 좌표에 오게
    f.y = onLedge ? row + 0.16 : pos.y - 0.6;
    f.speed = Math.min(1, Math.hypot(p.vx, p.vy) / 1.6);
    f.toWall = !(onLedge && (f.mode === "cheer" || f.mode === "sad" || f.mode === "stand"));
    // 매달리면 줄을 잡은 사람 쪽으로 몸이 기운다
    f.tilt = 0;
    if (f.mode === "hang") {
      for (const d of [-1, 1]) {
        const n = snap.players[seat + d];
        if (!n || n.mode !== "grip" || !snap.taut[Math.min(seat, n.seat)]) continue;
        f.tilt = Math.max(-0.7, Math.min(0.7, Math.atan2(n.x - pos.x, Math.max(0.4, n.y - pos.y))));
        break;
      }
    }
    return f;
  };
  return <Climber look={look} seed={seat * 13 + 3} color={SEAT_COLORS[seat % 4]} lowDetail={lowDetail} read={read} />;
}

/* ── 카메라 ─────────────────────────────────────────────────────────── */

interface RigState {
  cx: number;
  cy: number;
  half: number;
  init: boolean;
}

const v3 = new THREE.Vector3();

function rigFrame(camera: THREE.Camera, size: { width: number; height: number }, dtRaw: number, sh: SceneShared, st: RigState, height: number) {
  const snap = sh.buf.latest();
  if (!snap) return;
  const now = performance.now();
  const dt = Math.min(dtRaw, 0.05);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of snap.players) {
    const b = sh.buf.pose(p.seat, sh.mySeat, now);
    if (!b) continue;
    minX = Math.min(minX, b.x);
    maxX = Math.max(maxX, b.x);
    minY = Math.min(minY, b.y);
    maxY = Math.max(maxY, b.y);
  }
  if (minX === Infinity) return;
  const aspect = size.width / Math.max(1, size.height);
  const persp = camera as THREE.PerspectiveCamera;
  const vfov = (persp.fov * Math.PI) / 180;
  // 위쪽을 더 넓게 본다 (갈 길이 보여야 한다)
  const top = maxY + 4.2;
  const bottom = minY - 2.2;
  const halfH = Math.max(4.6, (top - bottom) / 2);
  const halfW = Math.max(4.2, (maxX - minX) / 2 + 2.6);
  const half = Math.max(halfH, halfW / aspect);
  const cx = Math.max(-WALL_W / 2 + 2, Math.min(WALL_W / 2 - 2, (minX + maxX) / 2));
  const cy = Math.min(height + 2.5, (top + bottom) / 2);
  const k = st.init ? 1 - Math.exp(-dt * 3) : 1;
  st.init = true;
  st.cx += (cx - st.cx) * k;
  st.cy += (cy - st.cy) * k;
  st.half += (half - st.half) * k;
  const dist = st.half / Math.tan(vfov / 2) + 0.6;
  sh.shake = Math.max(0, sh.shake - dt * 2.2);
  const jx = sh.shake > 0 ? (Math.sin(now * 0.09) + Math.sin(now * 0.23)) * 0.12 * sh.shake : 0;
  const jy = sh.shake > 0 ? Math.cos(now * 0.11) * 0.12 * sh.shake : 0;
  camera.position.set(st.cx * 0.85 + jx, st.cy - st.half * 0.12 + jy, dist);
  camera.lookAt(st.cx, st.cy, 0);
  for (let seat = 0; seat < sh.labels.length; seat++) {
    const el = sh.labels[seat];
    if (!el) continue;
    const b = snap.players[seat] ? sh.buf.pose(seat, sh.mySeat, now) : null;
    if (!b) {
      el.style.display = "none";
      continue;
    }
    v3.set(b.x, b.y + 0.72, Z_BODY).project(camera);
    if (v3.z > 1) {
      el.style.display = "none";
      continue;
    }
    el.style.display = "";
    const x = (v3.x * 0.5 + 0.5) * size.width;
    const y = (-v3.y * 0.5 + 0.5) * size.height;
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  }
}

function CameraRig({ shared, height }: { shared: MutableRefObject<SceneShared>; height: number }) {
  const st = useRef<RigState>({ cx: 0, cy: 3, half: 6, init: false });
  useFrame(({ camera, size }, dtRaw) => rigFrame(camera, size, dtRaw, shared.current, st.current, height));
  return null;
}

function FpsProbe({ onFps }: { onFps?: (fps: number) => void }) {
  const acc = useRef({ frames: 0, time: 0 });
  useFrame((_, dt) => {
    const a = acc.current;
    a.frames += 1;
    a.time += Math.min(dt, 0.5);
    if (a.time >= 2) {
      onFps?.(a.frames / a.time);
      a.frames = 0;
      a.time = 0;
    }
  });
  return null;
}

export default function WallScene({ shared, names, seatCount, seed, course: courseId, quality, onFps }: WallSceneProps) {
  const high = quality === "high";
  const course = useMemo(() => buildCourse(seed, courseId), [seed, courseId]);
  const theme = THEME[courseId];
  return (
    <Canvas dpr={high ? [1, 1.75] : [1, 1.5]} gl={{ antialias: high, powerPreference: "high-performance" }} camera={{ fov: 40, position: [0, 4, 16], near: 0.1, far: 400 }} style={{ touchAction: "none" }}>
      <fog attach="fog" args={[theme.fog, 40, 190]} />
      <Backdrop theme={theme} height={course.height} high={high} />
      <hemisphereLight args={["#ffffff", theme.rock2, 0.85]} />
      <directionalLight position={[-9, 14, 12]} intensity={1.25} color={theme.light} />
      <Wall key={`${seed}:${courseId}`} shared={shared} course={course} theme={theme} />
      <Flags course={course} />
      <Stars shared={shared} course={course} />
      {Array.from({ length: Math.max(0, seatCount - 1) }, (_, i) => (
        <Rope key={i} shared={shared} seg={i} />
      ))}
      {Array.from({ length: seatCount }, (_, seat) => (
        <ClimberSlot key={seat} seat={seat} names={names} shared={shared} lowDetail={!high} course={course} />
      ))}
      <Rocks shared={shared} theme={theme} />
      <WindStreaks shared={shared} />
      <FxLayer shared={shared} />
      <CameraRig shared={shared} height={course.height} />
      <FpsProbe onFps={onFps} />
      <AdaptiveResolution max={high ? 1.75 : 1.5} />
    </Canvas>
  );
}
