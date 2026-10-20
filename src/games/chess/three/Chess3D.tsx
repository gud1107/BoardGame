"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { MoveRecord } from "../engine";

/**
 * 체스 3D 판 (rulebook §16, §17) — display + click input only. ChessBoard
 * owns every rule decision; this scene gets the shown position and the
 * newest move, and reports clicked squares back through `onSquare`.
 *
 * World: square (file f, rank r) sits at x = f − 3.5, z = 3.5 − r on the
 * board top (y = 0), so White's side is +z. The camera, not the board,
 * turns for Black / "판 돌리기".
 *
 * Lint rules this file follows (React Compiler, see alkkagi/Scene3D):
 * no ref reads during render, camera and materials touched only in useFrame.
 * Light count is fixed (flashes are additive meshes) so shaders never
 * recompile mid-game.
 */

export interface Chess3DProps {
  board: string;
  flipped: boolean;
  light: string;
  dark: string;
  selected: number | null;
  hints: { to: number; capture: boolean }[];
  myTurn: boolean;
  last: { from: number; to: number } | null;
  checkedKing: number;
  mated: number;
  /** King in check after the newest move (check line target), or −1. */
  checkKing: number;
  anim: MoveRecord | null;
  animPly: number | null;
  slideS: number;
  hopS: number;
  nope: { sq: number; n: number } | null;
  quality: "high" | "low";
  onSquare: (sq: number) => void;
}

const xz = (sq: number): [number, number] => [(sq & 7) - 3.5, 3.5 - (sq >> 3)];
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);
/** Deterministic 0..1 noise for FX particles. */
const noise = (i: number, k: number) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** Shared between FX (writers) and the camera rig (reader). */
const camShake = { v: 0 };

/* ── Piece geometry: lathe profiles + a few boxes, merged per type ── */

type P = [number, number];
function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 10): P[] {
  const out: P[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([Math.max(0, cx + Math.cos(a) * rx), cy + Math.sin(a) * ry]);
  }
  return out;
}
const BASE: P[] = [
  [0, 0],
  [0.4, 0],
  [0.41, 0.05],
  [0.36, 0.09],
  [0.36, 0.13],
  [0.3, 0.17],
];
function lathe(points: P[]): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    points.map(([x, y]) => new THREE.Vector2(x, y)),
    40,
  ).toNonIndexed();
}
function box(w: number, h: number, d: number, x: number, y: number, z: number, ry = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g.toNonIndexed();
}
function ball(r: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 16, 10);
  g.translate(x, y, z);
  return g.toNonIndexed();
}
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  for (const p of parts) for (const name of Object.keys(p.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") p.deleteAttribute(name);
  const g = mergeGeometries(parts)!;
  g.computeBoundingSphere();
  return g;
}

function buildGeometries(): Record<string, THREE.BufferGeometry> {
  const pawn = lathe([...BASE.map(([x, y]) => [x * 0.88, y] as P), [0.16, 0.24], [0.11, 0.44], [0.2, 0.47], [0.2, 0.5], [0.1, 0.53], ...arc(0, 0.66, 0.155, 0.155, -1.0, Math.PI / 2, 12)]);
  const rookBody = lathe([...BASE, [0.25, 0.22], [0.21, 0.6], [0.3, 0.64], [0.3, 0.8], [0.22, 0.8], [0.22, 0.76], [0, 0.76]]);
  const merlons = Array.from({ length: 4 }, (_, i) => {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    return box(0.15, 0.12, 0.1, Math.cos(a) * 0.25, 0.85, Math.sin(a) * 0.25, -a + Math.PI / 2);
  });
  const rook = merge([rookBody, ...merlons]);
  const bishop = merge([
    lathe([...BASE, [0.2, 0.24], [0.115, 0.6], [0.21, 0.63], [0.21, 0.67], [0.1, 0.7], ...arc(0, 0.9, 0.17, 0.22, -1.25, Math.PI / 2, 14)]),
    ball(0.055, 0, 1.15, 0),
  ]);
  const crown = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2;
    return ball(0.045, Math.cos(a) * 0.235, 1.11, Math.sin(a) * 0.235);
  });
  const queen = merge([lathe([...BASE, [0.24, 0.24], [0.13, 0.78], [0.25, 0.82], [0.25, 0.86], [0.14, 0.9], [0.19, 1.02], [0.24, 1.09], [0.16, 1.09], [0.09, 1.13], [0, 1.15]]), ...crown, ball(0.075, 0, 1.2, 0)]);
  const king = merge([
    lathe([...BASE, [0.25, 0.24], [0.14, 0.84], [0.26, 0.88], [0.26, 0.92], [0.15, 0.96], [0.22, 1.1], [0.12, 1.15], [0, 1.16]]),
    box(0.075, 0.28, 0.075, 0, 1.3, 0),
    box(0.22, 0.075, 0.075, 0, 1.33, 0),
  ]);
  // Knight: lathe base + extruded horse head (profile in x-y, +x = muzzle).
  const head = new THREE.Shape();
  const hp: P[] = [
    [-0.24, 0.26],
    [0.2, 0.26],
    [0.12, 0.48],
    [0.34, 0.6],
    [0.37, 0.72],
    [0.3, 0.78],
    [0.16, 0.84],
    [0.12, 0.98],
    [0.03, 0.9],
    [-0.1, 0.94],
    [-0.24, 0.76],
    [-0.29, 0.5],
  ];
  head.moveTo(hp[0][0], hp[0][1]);
  for (const [x, y] of hp.slice(1)) head.lineTo(x, y);
  head.closePath();
  const headGeo = new THREE.ExtrudeGeometry(head, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.035, bevelSegments: 2, curveSegments: 4 });
  headGeo.translate(0, 0, -0.11);
  const knight = merge([lathe([...BASE, [0.26, 0.22], [0.22, 0.3], [0, 0.3]]), headGeo.index ? headGeo.toNonIndexed() : headGeo]);
  return { p: pawn, r: rook, n: knight, b: bishop, q: queen, k: king };
}

const GEO = buildGeometries();
// Lacquered ivory / polished ebony. Ebony stays a warm dark brown (not
// black) and gets a glossy clearcoat, so the room reflections and rim lights
// trace its silhouette even on the dark squares.
const MAT = {
  w: new THREE.MeshPhysicalMaterial({ color: "#e9dcc1", roughness: 0.4, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.3, sheen: 0.25, sheenColor: new THREE.Color("#fff6e0"), envMapIntensity: 0.3 }),
  b: new THREE.MeshPhysicalMaterial({ color: "#2a211c", roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.1, sheen: 0.6, sheenColor: new THREE.Color("#a8805c"), envMapIntensity: 0.55 }),
  gold: new THREE.MeshStandardMaterial({ color: "#d4a94e", roughness: 0.3, metalness: 1, envMapIntensity: 0.7 }),
};
/** Thin gold band around each piece's foot. */
const trimGeo = { big: new THREE.TorusGeometry(0.362, 0.016, 8, 48).rotateX(Math.PI / 2).translate(0, 0.11, 0), small: new THREE.TorusGeometry(0.318, 0.015, 8, 48).rotateX(Math.PI / 2).translate(0, 0.11, 0) };

function radialTexture(stops: [number, string][], size = 256): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
/** Soft contact shadow under every piece (works without shadow maps too). */
const blobMat = new THREE.MeshBasicMaterial({ map: radialTexture([[0, "rgba(0,0,0,.55)"], [0.45, "rgba(0,0,0,.3)"], [1, "rgba(0,0,0,0)"]]), transparent: true, depthWrite: false, toneMapped: false });
const unitPlane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const discGeo = new THREE.CircleGeometry(0.15, 28).rotateX(-Math.PI / 2);
const capRingGeo = new THREE.RingGeometry(0.38, 0.47, 36).rotateX(-Math.PI / 2);
const ringGeo = new THREE.RingGeometry(0.33, 0.4, 40).rotateX(-Math.PI / 2);
const sphereGeo = new THREE.SphereGeometry(1, 20, 12);
const shardGeo = new THREE.TetrahedronGeometry(0.09);
const pillarGeo = new THREE.CylinderGeometry(0.42, 0.42, 7, 24, 1, true);

/* ── Pieces ── */

interface PieceProps {
  ch: string;
  sq: number;
  from?: number;
  hop?: boolean;
  delay?: number;
  dur?: number;
  lifted: boolean;
  topple?: number;
  toppleAt?: number;
  wobble?: boolean;
  shadows: boolean;
  onPick: (sq: number) => void;
}

function Piece({ ch, sq, from, hop, delay = 0, dur = 0.3, lifted, topple, toppleAt = 0, wobble, shadows, onPick }: PieceProps) {
  const ref = useRef<THREE.Group>(null);
  const blob = useRef<THREE.Mesh>(null);
  const t0 = useRef(-1);
  const lift = useRef(0);
  const white = ch === ch.toUpperCase();
  const type = ch.toLowerCase();
  const [x0, z0] = xz(from ?? sq);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    if (t0.current < 0) t0.current = clock.elapsedTime;
    const el = clock.elapsedTime - t0.current;
    let [x, z] = xz(sq);
    let y = 0;
    if (from !== undefined) {
      const k = clamp01((el - delay) / dur);
      const e = hop ? k : easeOut(k);
      const [fx, fz] = xz(from);
      x = fx + (x - fx) * e;
      z = fz + (z - fz) * e;
      y = Math.sin(Math.PI * k) * (hop ? 1.15 : 0.14);
    }
    lift.current += ((lifted ? 0.24 : 0) - lift.current) * 0.25;
    y += lift.current;
    if (wobble && el < 0.34) x += Math.sin((el / 0.34) * Math.PI * 4) * (1 - el / 0.34) * 0.12;
    if (topple) {
      const k = clamp01((el - toppleAt) / 0.7);
      const a = k * k * 1.42;
      g.rotation.z = topple * a;
      y += Math.sin(a) * 0.28;
    }
    g.position.set(x, y, z);
    const b = blob.current;
    if (b) {
      b.position.set(x, 0.004, z);
      b.scale.setScalar(0.92 / (1 + y * 0.9));
    }
  });
  return (
    <>
    <mesh ref={blob} geometry={unitPlane} material={blobMat} position={[x0, 0.004, z0]} scale={0.92} renderOrder={1} />
    <group
      ref={ref}
      position={[x0, 0, z0]}
      rotation={[0, type === "n" && !white ? Math.PI : 0, 0]}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        if (e.delta <= 6) onPick(sq);
      }}
    >
      <mesh geometry={GEO[type]} material={white ? MAT.w : MAT.b} castShadow={shadows} />
      <mesh geometry={type === "p" ? trimGeo.small : trimGeo.big} material={MAT.gold} />
    </group>
    </>
  );
}

/** The captured piece: knocked into the air (or sucked down for en passant). */
function CapturedPiece({ ch, sq, at, ep, shadows }: { ch: string; sq: number; at: number; ep: boolean; shadows: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const t0 = useRef(-1);
  const white = ch === ch.toUpperCase();
  const type = ch.toLowerCase();
  const [x, z] = xz(sq);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    if (t0.current < 0) t0.current = clock.elapsedTime;
    const el = clock.elapsedTime - t0.current - at;
    if (el < 0) return;
    if (ep) {
      const k = clamp01(el / 0.7);
      g.rotation.y = k * k * 14;
      g.position.y = -k * k * 0.9;
      g.scale.setScalar(Math.max(0.001, 1 - k));
    } else {
      const k = clamp01(el / 0.55);
      g.position.set(x + k * 0.9, 1.6 * el - 4.5 * el * el + 0.0, z - k * 0.5);
      g.rotation.set(k * 2.4, 0, -k * 3.1);
      g.scale.setScalar(Math.max(0.001, 1 - k * k));
    }
  });
  return (
    <group ref={ref} position={[x, 0, z]}>
      <mesh geometry={GEO[type]} material={white ? MAT.w : MAT.b} castShadow={shadows} />
    </group>
  );
}

/* ── One-shot FX (keyed by ply, so each move remounts them) ── */

/** Additive mesh whose scale/opacity follow `f(el)` from `at` seconds on. */
function Burst({ geo, pos, color, at, len, from, to, peak = 1, additive = true, rotY = 0 }: { geo: THREE.BufferGeometry; pos: [number, number, number]; color: string; at: number; len: number; from: number; to: number; peak?: number; additive?: boolean; rotY?: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const t0 = useRef(-1);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    if (t0.current < 0) t0.current = clock.elapsedTime;
    const k = (clock.elapsedTime - t0.current - at) / len;
    const mat = m.material as THREE.MeshBasicMaterial;
    if (k < 0 || k > 1) {
      m.visible = false;
      return;
    }
    m.visible = true;
    m.scale.setScalar(from + (to - from) * easeOut(k));
    mat.opacity = peak * (k < 0.12 ? k / 0.12 : 1 - (k - 0.12) / 0.88);
  });
  return (
    <mesh ref={ref} geometry={geo} position={pos} rotation={[0, rotY, 0]} visible={false} renderOrder={5}>
      <meshBasicMaterial color={color} transparent opacity={0} depthWrite={false} blending={additive ? THREE.AdditiveBlending : THREE.NormalBlending} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  );
}

function Shards({ pos, white, at, n, spread }: { pos: [number, number]; white: boolean; at: number; n: number; spread: number }) {
  const ref = useRef<THREE.Group>(null);
  const t0 = useRef(-1);
  const dirs = useMemo(
    () =>
      Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 + noise(i, n) * 0.6;
        const s = (0.8 + noise(i, 3)) * spread;
        return { vx: Math.cos(a) * s, vz: Math.sin(a) * s, vy: 2 + noise(i, 5) * 2.2, spin: (noise(i, 9) - 0.5) * 20 };
      }),
    [n, spread],
  );
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    if (t0.current < 0) t0.current = clock.elapsedTime;
    const el = clock.elapsedTime - t0.current - at;
    g.visible = el >= 0 && el < 0.9;
    if (!g.visible) return;
    g.children.forEach((c, i) => {
      const d = dirs[i];
      c.position.set(pos[0] + d.vx * el, Math.max(0.03, 0.35 + d.vy * el - 6 * el * el), pos[1] + d.vz * el);
      c.rotation.set(d.spin * el, d.spin * el * 0.7, 0);
      c.scale.setScalar(Math.max(0.001, 1 - el / 0.9));
    });
  });
  return (
    <group ref={ref} visible={false}>
      {dirs.map((_, i) => (
        <mesh key={i} geometry={shardGeo} material={white ? MAT.w : MAT.b} />
      ))}
    </group>
  );
}

/** Red beam along the board from checker to king, drawn then faded. */
function CheckBeam({ from, to, at }: { from: number; to: number; at: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const t0 = useRef(-1);
  const [fx, fz] = xz(from);
  const [tx, tz] = xz(to);
  const len = Math.hypot(tx - fx, tz - fz);
  const ang = Math.atan2(tx - fx, tz - fz);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    if (t0.current < 0) t0.current = clock.elapsedTime;
    const k = (clock.elapsedTime - t0.current - at) / 1.5;
    const mat = m.material as THREE.MeshBasicMaterial;
    m.visible = k >= 0 && k <= 1;
    if (!m.visible) return;
    const grow = clamp01(k / 0.5);
    m.scale.set(0.11, 1, Math.max(0.001, grow * len));
    m.position.set(fx + Math.sin(ang) * grow * len * 0.5, 0.06, fz + Math.cos(ang) * grow * len * 0.5);
    mat.opacity = k < 0.55 ? 0.95 : 0.95 * (1 - (k - 0.55) / 0.45);
  });
  return (
    <mesh ref={ref} geometry={unitPlane} rotation={[0, ang, 0]} visible={false} renderOrder={6}>
      <meshBasicMaterial color="#ff3b5c" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </mesh>
  );
}

/** Kicks the camera once `at` seconds after mount. */
function Shake({ at, amp }: { at: number; amp: number }) {
  const t0 = useRef(-1);
  const done = useRef(false);
  useFrame(({ clock }) => {
    if (t0.current < 0) t0.current = clock.elapsedTime;
    if (!done.current && clock.elapsedTime - t0.current >= at) {
      done.current = true;
      camShake.v = Math.max(camShake.v, amp);
    }
  });
  return null;
}

/* ── Board, highlights ── */

/** Fine wavy grain lines over a rectangle (deterministic). */
function grain(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number, alpha: number, lines: number) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  for (let i = 0; i < lines; i++) {
    const yy = y + ((i + noise(i, seed)) / lines) * h;
    const amp = 2 + noise(i, seed + 1) * 5;
    const ph = noise(i, seed + 2) * 6.28;
    g.strokeStyle = noise(i, seed + 3) > 0.5 ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha * 0.6})`;
    g.lineWidth = 0.8 + noise(i, seed + 4) * 1.6;
    g.beginPath();
    for (let xx = 0; xx <= w; xx += 8) {
      const yv = yy + Math.sin(xx / (40 + amp * 9) + ph) * amp;
      if (xx === 0) g.moveTo(x + xx, yv);
      else g.lineTo(x + xx, yv);
    }
    g.stroke();
  }
  g.restore();
}

function boardTexture(light: string, dark: string, flipped: boolean): THREE.CanvasTexture {
  const S = 160;
  const M = 80;
  const c = document.createElement("canvas");
  c.width = c.height = S * 8 + M * 2;
  const g = c.getContext("2d")!;
  // walnut border
  const wood = g.createLinearGradient(0, 0, c.width, c.height);
  wood.addColorStop(0, "#3b2312");
  wood.addColorStop(0.5, "#2a170b");
  wood.addColorStop(1, "#1e1007");
  g.fillStyle = wood;
  g.fillRect(0, 0, c.width, c.height);
  grain(g, 0, 0, c.width, c.height, 7, 0.08, 90);
  // squares with their own grain, alternating direction like an inlaid board
  for (let r = 0; r < 8; r++)
    for (let f = 0; f < 8; f++) {
      const x = M + f * S;
      const y = M + (7 - r) * S;
      const isLight = (f + r) % 2 === 1;
      g.fillStyle = isLight ? light : dark;
      g.fillRect(x, y, S, S);
      if (f % 2 === 0) grain(g, x, y, S, S, f * 8 + r, isLight ? 0.05 : 0.09, 11);
      else {
        g.save();
        g.translate(x + S, y);
        g.rotate(Math.PI / 2);
        grain(g, 0, 0, S, S, f * 8 + r + 99, isLight ? 0.05 : 0.09, 11);
        g.restore();
      }
      g.strokeStyle = "rgba(0,0,0,.08)";
      g.lineWidth = 2;
      g.strokeRect(x + 1, y + 1, S - 2, S - 2);
    }
  // double gold inlay around the playing field
  g.strokeStyle = "#c9a052";
  g.lineWidth = 5;
  g.strokeRect(M - 6, M - 6, S * 8 + 12, S * 8 + 12);
  g.lineWidth = 2;
  g.strokeStyle = "rgba(201,160,82,.7)";
  g.strokeRect(M - 16, M - 16, S * 8 + 32, S * 8 + 32);
  g.fillStyle = "#d8bd86";
  g.font = "600 38px Georgia, 'Times New Roman', serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  const text = (str: string, x: number, y: number) => {
    g.save();
    g.translate(x, y);
    if (flipped) g.rotate(Math.PI);
    g.fillText(str, 0, 0);
    g.restore();
  };
  const off = (M - 16) / 2;
  for (let i = 0; i < 8; i++) {
    text("abcdefgh"[i], M + i * S + S / 2, c.height - off);
    text("abcdefgh"[i], M + i * S + S / 2, off);
    text(String(8 - i), off, M + i * S + S / 2);
    text(String(8 - i), c.width - off, M + i * S + S / 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Rounded, bevelled slab under the board top (top face at y = 0). */
const frameGeo = (() => {
  const h = 4.75;
  const r = 0.28;
  const sh = new THREE.Shape();
  sh.moveTo(-h + r, -h);
  sh.lineTo(h - r, -h);
  sh.quadraticCurveTo(h, -h, h, -h + r);
  sh.lineTo(h, h - r);
  sh.quadraticCurveTo(h, h, h - r, h);
  sh.lineTo(-h + r, h);
  sh.quadraticCurveTo(-h, h, -h, h - r);
  sh.lineTo(-h, -h + r);
  sh.quadraticCurveTo(-h, -h, -h + r, -h);
  const depth = 0.4;
  const bevel = 0.07;
  const geo = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 8 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -(depth + bevel) - 0.002, 0);
  return geo;
})();
const frameMat = new THREE.MeshPhysicalMaterial({ color: "#2b180b", roughness: 0.42, clearcoat: 0.8, clearcoatRoughness: 0.2, envMapIntensity: 0.3 });
const tableMat = new THREE.MeshStandardMaterial({ map: radialTexture([[0, "rgba(74,50,32,1)"], [0.35, "rgba(46,30,19,1)"], [0.75, "rgba(24,16,11,.6)"], [1, "rgba(24,16,11,0)"]], 512), transparent: true, roughness: 0.85, depthWrite: false });

function Board({ light, dark, flipped, shadows, env, onSquare }: { light: string; dark: string; flipped: boolean; shadows: boolean; env: THREE.Texture; onSquare: (sq: number) => void }) {
  const tex = useMemo(() => boardTexture(light, dark, flipped), [light, dark, flipped]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <group>
      <mesh geometry={frameGeo} material={frameMat} receiveShadow={shadows} castShadow={shadows} />
      <mesh
        geometry={unitPlane}
        scale={[9, 1, 9]}
        position={[0, 0.002, 0]}
        receiveShadow={shadows}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          if (e.delta > 6) return;
          const f = Math.floor(e.point.x + 4);
          const r = Math.floor(4 - e.point.z);
          if (f >= 0 && f < 8 && r >= 0 && r < 8) onSquare(r * 8 + f);
        }}
      >
        <meshPhysicalMaterial map={tex} envMap={env} roughness={0.38} clearcoat={0.6} clearcoatRoughness={0.25} envMapIntensity={0.12} />
      </mesh>
      {/* table, fading into the backdrop */}
      <mesh geometry={unitPlane} material={tableMat} position={[0, -0.5, 0]} scale={[34, 1, 34]} receiveShadow={shadows} />
    </group>
  );
}

/**
 * Soft studio reflections (PMREM of three's RoomEnvironment), set as each
 * material's own envMap — with `scene.environment` three ignores the
 * per-material envMapIntensity and everything washes out.
 */
function useStudioEnv(): THREE.Texture {
  const gl = useThree((st) => st.gl);
  const env = useMemo(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const tex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    return tex;
  }, [gl]);
  useEffect(() => {
    for (const m of [MAT.w, MAT.b, MAT.gold, frameMat]) {
      m.envMap = env;
      m.needsUpdate = true;
    }
    return () => env.dispose();
  }, [env]);
  return env;
}

function Tile({ sq, color, opacity, y = 0.006 }: { sq: number; color: string; opacity: number; y?: number }) {
  const [x, z] = xz(sq);
  return (
    <mesh geometry={unitPlane} position={[x, y, z]} renderOrder={1}>
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

function CheckGlow({ sq }: { sq: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const [x, z] = xz(sq);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const p = 0.5 + 0.5 * Math.sin(clock.elapsedTime * Math.PI * 2);
    (m.material as THREE.MeshBasicMaterial).opacity = 0.45 + p * 0.45;
    m.scale.setScalar(1.15 + p * 0.15);
  });
  return (
    <mesh ref={ref} geometry={discGeo} position={[x, 0.01, z]} scale={1.2} renderOrder={2}>
      <meshBasicMaterial color="#ef4444" transparent opacity={0.6} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/* ── Camera ── */

function CameraRig({ flipped }: { flipped: boolean }) {
  const gl = useThree((s) => s.gl);
  const orbit = useRef({ az: flipped ? -Math.PI / 2 : Math.PI / 2, el: 0.95, zoom: 1, userAz: 0 });
  const lastFlip = useRef(flipped);
  useEffect(() => {
    const el = gl.domElement;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch: number | null = null;
    const down = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const move = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, cur);
      const o = orbit.current;
      if (pointers.size >= 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        o.zoom = Math.max(0.6, Math.min(1.4, o.zoom * (pinch / Math.max(1, d))));
        pinch = d;
        return;
      }
      const w = el.clientWidth || 1;
      o.userAz -= ((cur.x - prev.x) / w) * 3.2;
      o.el = Math.max(0.5, Math.min(1.52, o.el + ((cur.y - prev.y) / w) * 2));
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
    };
    const reset = () => {
      const o = orbit.current;
      o.userAz = 0;
      o.el = 0.95;
      o.zoom = 1;
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("dblclick", reset);
    for (const ev of ["pointerup", "pointerleave", "pointercancel"] as const) el.addEventListener(ev, up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("dblclick", reset);
      for (const ev of ["pointerup", "pointerleave", "pointercancel"] as const) el.removeEventListener(ev, up);
    };
  }, [gl]);
  useFrame((frame, dt) => {
    const cam = frame.camera as THREE.PerspectiveCamera;
    const o = orbit.current;
    if (lastFlip.current !== flipped) {
      lastFlip.current = flipped;
      o.userAz = 0;
    }
    const want = (flipped ? -Math.PI / 2 : Math.PI / 2) + o.userAz;
    o.az += (want - o.az) * Math.min(1, dt * 6);
    const dist = 14.4 * o.zoom;
    const s = camShake.v;
    camShake.v = s * Math.pow(0.02, dt);
    const jx = s > 0.01 ? (Math.random() - 0.5) * s * 0.06 : 0;
    const jy = s > 0.01 ? (Math.random() - 0.5) * s * 0.06 : 0;
    cam.position.set(Math.cos(o.az) * Math.cos(o.el) * dist + jx, Math.sin(o.el) * dist + jy, Math.sin(o.az) * Math.cos(o.el) * dist);
    // look slightly toward the near edge so the far rank isn't cramped
    cam.lookAt(Math.cos(o.az) * 0.15, -0.35, Math.sin(o.az) * 0.15);
  });
  return null;
}

/* ── Scene ── */

function Scene(props: Chess3DProps) {
  const { board, selected, hints, myTurn, last, checkedKing, mated, checkKing, anim, animPly, slideS, hopS, nope, onSquare } = props;
  const shadows = props.quality === "high";
  const env = useStudioEnv();

  const info = useMemo(() => {
    if (!anim) return null;
    const knight = anim.piece.toLowerCase() === "n";
    const castle = anim.kind === "castleK" || anim.kind === "castleQ";
    const rook = castle ? (anim.kind === "castleK" ? { from: anim.to + 1, to: anim.to - 1 } : { from: anim.to - 2, to: anim.to + 1 }) : null;
    const dur = knight ? hopS : slideS;
    return { knight, rook, dur, impact: dur * 0.82 };
  }, [anim, slideS, hopS]);

  const pieces: ReactNode[] = [];
  for (let sq = 0; sq < 64; sq++) {
    const ch = board[sq];
    if (ch === ".") continue;
    const moving = info && anim && sq === anim.to;
    const rookMoving = info?.rook && sq === info.rook.to;
    const wob = nope && nope.sq === sq;
    pieces.push(
      <Piece
        key={`${sq}:${ch}:${moving || rookMoving ? `m${animPly}` : wob ? `n${nope.n}` : ""}`}
        ch={ch}
        sq={sq}
        from={moving ? anim!.from : rookMoving ? info!.rook!.from : undefined}
        hop={!!moving && info!.knight}
        delay={rookMoving ? 0.06 : 0}
        dur={moving ? info!.dur : slideS + 0.08}
        lifted={selected === sq}
        topple={sq === mated ? (ch === ch.toUpperCase() ? 1 : -1) : undefined}
        toppleAt={(info?.dur ?? 0) + 0.35}
        wobble={!!wob}
        shadows={shadows}
        onPick={onSquare}
      />,
    );
  }

  const fx: ReactNode[] = [];
  if (anim && info) {
    const k = `fx${animPly}`;
    const [tx, tz] = xz(anim.to);
    fx.push(<Burst key={`${k}-ring`} geo={ringGeo} pos={[tx, 0.02, tz]} color="#ffffff" at={info.impact} len={0.55} from={0.5} to={1.9} peak={0.8} />);
    if (info.knight) fx.push(<Burst key={`${k}-ring2`} geo={ringGeo} pos={[tx, 0.025, tz]} color="#fcd34d" at={info.impact + 0.04} len={0.7} from={0.4} to={2.4} peak={0.9} />);
    if (anim.captured && anim.capSq !== null) {
      const ep = anim.kind === "ep";
      const [cx, cz] = xz(anim.capSq);
      const big = /[qr]/i.test(anim.captured);
      fx.push(<CapturedPiece key={`${k}-cap`} ch={anim.captured} sq={anim.capSq} at={ep ? info.impact * 0.6 : info.impact} ep={ep} shadows={shadows} />);
      if (ep) {
        fx.push(<Burst key={`${k}-vortex`} geo={capRingGeo} pos={[cx, 0.03, cz]} color="#c4b5fd" at={info.impact * 0.4} len={0.85} from={1.5} to={0.1} peak={1} />);
      } else {
        fx.push(<Burst key={`${k}-flash`} geo={sphereGeo} pos={[tx, 0.45, tz]} color={big ? "#fb923c" : "#fde68a"} at={info.impact} len={big ? 0.6 : 0.45} from={0.15} to={big ? 1.3 : 0.9} peak={0.9} />);
        fx.push(<Shards key={`${k}-shards`} pos={[cx, cz]} white={anim.captured === anim.captured.toUpperCase()} at={info.impact} n={big ? 14 : 9} spread={big ? 2.4 : 1.6} />);
        fx.push(<Shake key={`${k}-shake`} at={info.impact} amp={big ? 7 : 3.5} />);
      }
    }
    if (info.rook) {
      const [ax, az] = xz(info.rook.to);
      fx.push(<Burst key={`${k}-castle`} geo={ringGeo} pos={[ax, 0.03, az]} color="#fbbf24" at={info.dur} len={0.8} from={0.4} to={2.2} peak={1} />);
      fx.push(<Burst key={`${k}-castle2`} geo={ringGeo} pos={[tx, 0.03, tz]} color="#fcd34d" at={info.dur} len={0.8} from={0.4} to={2.2} peak={1} />);
    }
    if (anim.promo) {
      fx.push(<Burst key={`${k}-pillar`} geo={pillarGeo} pos={[tx, 3.5, tz]} color="#fef08a" at={info.dur} len={1} from={0.3} to={1.4} peak={0.75} />);
      fx.push(<Burst key={`${k}-glow`} geo={sphereGeo} pos={[tx, 0.6, tz]} color="#fde68a" at={info.dur} len={0.7} from={0.2} to={1.1} peak={1} />);
    }
    if (anim.check && checkKing >= 0) for (const c of anim.checkers) fx.push(<CheckBeam key={`${k}-beam${c}`} from={c} to={checkKing} at={info.dur} />);
    if (anim.mate && checkKing >= 0) {
      const [mx, mz] = xz(checkKing);
      [0, 0.18, 0.36].forEach((d) => fx.push(<Burst key={`${k}-shock${d}`} geo={ringGeo} pos={[mx, 0.04, mz]} color="#fcd34d" at={info.dur + d} len={1.3} from={0.5} to={9} peak={0.9} />));
      fx.push(<Shake key={`${k}-mshake`} at={info.dur} amp={9} />);
    }
  }

  const tiles: ReactNode[] = [];
  if (last) {
    tiles.push(<Tile key="lf" sq={last.from} color="#facc15" opacity={0.42} />);
    tiles.push(<Tile key="lt" sq={last.to} color="#facc15" opacity={0.42} />);
  }
  if (selected !== null) tiles.push(<Tile key="sel" sq={selected} color="#facc15" opacity={0.62} y={0.007} />);
  for (const h of hints) {
    const [x, z] = xz(h.to);
    tiles.push(
      <mesh key={`h${h.to}`} geometry={h.capture ? capRingGeo : discGeo} position={[x, 0.009, z]} renderOrder={3}>
        <meshBasicMaterial color="#141414" transparent opacity={myTurn ? 0.34 : 0.17} depthWrite={false} toneMapped={false} />
      </mesh>,
    );
  }

  return (
    <>
      <Board light={props.light} dark={props.dark} flipped={props.flipped} shadows={shadows} env={env} onSquare={onSquare} />
      {tiles}
      {checkedKing >= 0 && <CheckGlow sq={checkedKing} />}
      {pieces}
      {fx}
    </>
  );
}

export default function Chess3D(props: Chess3DProps) {
  const high = props.quality === "high";
  return (
    <Canvas
      shadows={high ? "soft" : false}
      dpr={high ? [1, 1.75] : [1, 1.25]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance", toneMappingExposure: 0.95 }}
      camera={{ fov: 38, position: [0, 11, 7], near: 0.1, far: 120 }}
      style={{ touchAction: "none", background: "radial-gradient(ellipse at 50% 38%, #3a2a1c 0%, #1c140d 55%, #0b0806 100%)" }}
    >
      <hemisphereLight args={["#fff2dc", "#2a1a0e", 0.25]} />
      <directionalLight
        position={[5, 14, 7]}
        intensity={1.7}
        color="#fff1dc"
        castShadow={high}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-7}
        shadow-camera-right={7}
        shadow-camera-top={7}
        shadow-camera-bottom={-7}
        shadow-camera-near={1}
        shadow-camera-far={40}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      {/* rim lights from both ends so dark pieces keep an outline whichever side the camera is on */}
      <directionalLight position={[-4, 5, -10]} intensity={0.9} color="#b9cdf5" />
      <directionalLight position={[4, 5, 10]} intensity={0.45} color="#ffe2b8" />
      <Scene {...props} />
      <CameraRig flipped={props.flipped} />
    </Canvas>
  );
}
