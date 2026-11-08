"use client";

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { resolveLook } from "@/games/shared/three/SeatedPerson";
import { roomCharacterOf, useRoomCharacters } from "@/lib/character/roomCharacters";
import { HOLES, holeBounds, layoutFor, type ObstacleKind } from "../course";
import { ballSpot, type MiniGolfState, type Seat } from "../engine";
import { BALL_R, CUP_R, simulate, WALL_H, WINDMILL_PERIOD, type Layout, type Poly } from "../physics";
import type { ReplayEvent, ReplayPlayer, ReplayView } from "../replay";
import { velocityFor, type LiveAim } from "../aim";
import { alignWindmill, windmillNow, windmillTurn } from "../clock";
import Golfer, { golferRig, STANCE, type GolferPose } from "./Golfer";
import { ballTexture, chevronTexture, flagTexture, grassTexture, iceTexture, labelTexture, rockTexture, sandTexture, SEAT_COLORS, stripeTexture, THEME_GRASS } from "./textures";

/**
 * 미니골프 파티 3D course (rulebook §11). Display + input only — the replay
 * player (replay.ts) says where every ball is each frame.
 *
 * Course coords (x across, y up the course) map to three.js (x, 0, −y).
 * Input (§5): drag anywhere on the course like a slingshot — pull back away
 * from where you want the ball to go; the longer the pull, the harder. Let
 * go to putt, or drag back to the ball to cancel.
 *
 * Lint rules this file follows (React Compiler, see alkkagi/Scene3D): no ref
 * reads during render, camera only touched inside useFrame.
 */

export type CamMode = "follow" | "overview";

export interface SceneProps {
  state: MiniGolfState;
  player: ReplayPlayer;
  viewerSeat: Seat;
  canAim: boolean;
  aim: MutableRefObject<LiveAim | null>;
  /** Slingshot changed my aim; `shoot` = let go with enough pull. */
  onDraft: (patch: { ang?: number; power?: number; dragging?: boolean }, shoot?: boolean) => void;
  onEvent: (e: ReplayEvent) => void;
  onBusy: (busy: boolean) => void;
  names: Record<Seat, string>;
  helper: boolean;
  quality: "high" | "low";
  cam: CamMode;
  /** In the pick phase: the obstacle being previewed on the next hole. */
  preview: ObstacleKind | null;
  onFps?: (fps: number) => void;
}

const nowMs = () => performance.now();
const toZ = (y: number) => -y;
const ballGeo = new THREE.SphereGeometry(1, 28, 18);
const camShake = { v: 0 };
/** Bumper squash per bumper index — written by the event handler, read by the hole (one course on screen). */
const bumperPulse = new Float32Array(32);
/** Drag pull (m) for full power. */
export const FULL_PULL = 1.1;

interface Display {
  key: string;
  holeId: number;
  obstacle: ObstacleKind | null;
  L: Layout;
  holeNo: number;
}

function displayFor(state: MiniGolfState, view: ReplayView | null, preview: ObstacleKind | null): Display {
  const rec = view?.rec;
  if (rec) return { key: `r${rec.holeId}:${rec.obstacle}`, holeId: rec.holeId, obstacle: rec.obstacle, L: layoutFor(rec.holeId, rec.obstacle), holeNo: rec.holeIdx + 1 };
  if (state.phase === "pick" && state.holeIdx + 1 < state.holes.length) {
    const id = state.holes[state.holeIdx + 1];
    return { key: `p${id}:${preview}`, holeId: id, obstacle: preview, L: layoutFor(id, preview), holeNo: state.holeIdx + 2 };
  }
  const id = state.holes[state.holeIdx];
  const ob = state.obstacles[state.holeIdx];
  return { key: `h${id}:${ob}`, holeId: id, obstacle: ob, L: layoutFor(id, ob), holeNo: state.holeIdx + 1 };
}

/* ── particles ─────────────────────────────────────────────────────────── */

class Particles {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private next = 0;
  constructor(
    private readonly count: number,
    size: number,
    private readonly gravity: number,
  ) {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    for (let i = 0; i < count; i++) this.pos[i * 3 + 1] = -50;
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.PointsMaterial({ size, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }
  burst(x: number, y: number, z: number, n: number, speed: number, colors: THREE.Color[], up = 1) {
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.count;
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.vel[i * 3] = Math.cos(a) * s;
      this.vel[i * 3 + 1] = (0.5 + Math.random()) * speed * up;
      this.vel[i * 3 + 2] = Math.sin(a) * s;
      const c = colors[k % colors.length];
      this.col[i * 3] = c.r;
      this.col[i * 3 + 1] = c.g;
      this.col[i * 3 + 2] = c.b;
      this.life[i] = 1;
    }
  }
  update(dt: number, fade: number) {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt * fade;
      this.vel[i * 3 + 1] -= this.gravity * dt;
      this.vel[i * 3] *= 1 - dt * 1.5;
      this.vel[i * 3 + 2] *= 1 - dt * 1.5;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.life[i] <= 0) this.pos[i * 3 + 1] = -50;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

const CONFETTI = ["#ff4d6d", "#ffd23f", "#3bceac", "#5e60ce", "#ff9f1c", "#ffffff"].map((c) => new THREE.Color(c));
const DUST = [new THREE.Color("#f3ead2"), new THREE.Color("#d9c9a0"), new THREE.Color("#ffffff")];
const SPARK = [new THREE.Color("#fff6d0"), new THREE.Color("#ffd36b"), new THREE.Color("#ffffff")];
const CLOUD = [new THREE.Color("#ffffff"), new THREE.Color("#e8f4ff")];

/* ── geometry helpers ─────────────────────────────────────────────────── */

function shapeOf(poly: Poly): THREE.Shape {
  const s = new THREE.Shape();
  poly.forEach(([x, y], i) => (i === 0 ? s.moveTo(x, y) : s.lineTo(x, y)));
  s.closePath();
  return s;
}

/** A flat polygon on the course plane, UVs in metres (or along a slope's push). */
function flatGeometry(poly: Poly, uvScale = 1, along?: { x: number; y: number }): THREE.BufferGeometry {
  const geo = new THREE.ShapeGeometry(shapeOf(poly));
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    if (along) {
      const l = Math.hypot(along.x, along.y) || 1;
      const dx = along.x / l;
      const dy = along.y / l;
      uv.setXY(i, (x * dy - y * dx) / 0.32, -(x * dx + y * dy) / 0.32);
    } else uv.setXY(i, x * uvScale, y * uvScale);
  }
  uv.needsUpdate = true;
  // shape is in the XY plane: lay it on XZ with z = −y
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function hash(i: number, salt: number): number {
  const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Tapered rock under an island polygon. */
function rockGeometry(poly: Poly, salt: number, depth: number): THREE.BufferGeometry {
  // densify the outline
  const pts: [number, number][] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.35));
    for (let k = 0; k < n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p[0];
    cy += p[1];
  }
  cx /= pts.length;
  cy /= pts.length;
  const rings = 6;
  const verts: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const m = pts.length;
  for (let r = 0; r <= rings; r++) {
    const k = r / rings;
    const shrink = 1 - Math.pow(k, 1.25) * 0.86;
    const y = -0.04 - k * depth;
    for (let i = 0; i < m; i++) {
      const j = r === 0 ? 0 : (hash(i, salt + r) - 0.5) * 0.18 * (1 - k * 0.5);
      const x = cx + (pts[i][0] - cx) * (shrink + j * 0.4);
      const z = cy + (pts[i][1] - cy) * (shrink + j * 0.4);
      verts.push(x, y + (r === 0 ? 0 : j * 0.1), -z);
      uvs.push(i / m * 6, k);
    }
  }
  for (let r = 0; r < rings; r++)
    for (let i = 0; i < m; i++) {
      const a = r * m + i;
      const b = r * m + ((i + 1) % m);
      const c = (r + 1) * m + i;
      const d = (r + 1) * m + ((i + 1) % m);
      idx.push(a, c, b, b, c, d);
    }
  // the tip
  const tip = verts.length / 3;
  verts.push(cx, -0.04 - depth * 1.2, -cy);
  uvs.push(0.5, 1);
  for (let i = 0; i < m; i++) idx.push(rings * m + i, tip, rings * m + ((i + 1) % m));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/* ── sky ──────────────────────────────────────────────────────────────── */

function Sky() {
  const mat = useMemo(() => {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {},
      vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader:
        "varying vec3 vP; void main(){ float h = vP.y; vec3 top = vec3(0.22,0.52,0.95); vec3 hor = vec3(0.78,0.9,1.0); vec3 low = vec3(0.98,0.86,0.92); vec3 c = h > 0.0 ? mix(hor, top, pow(h, 0.6)) : mix(hor, low, pow(-h, 0.5)); gl_FragColor = vec4(c,1.0); }",
    });
  }, []);
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <mesh material={mat} renderOrder={-10}>
      <sphereGeometry args={[70, 32, 16]} />
    </mesh>
  );
}

/** Drifting cloud puffs below and around the islands. */
function Clouds({ cx, cy, quality }: { cx: number; cy: number; quality: "high" | "low" }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const n = quality === "high" ? 70 : 32;
  const puffs = useMemo(
    () =>
      Array.from({ length: n }, (_, i) => {
        const cluster = Math.floor(i / 5);
        const a = hash(cluster, 3) * Math.PI * 2;
        const r = 4 + hash(cluster, 4) * 14;
        return {
          x: Math.cos(a) * r + (hash(i, 5) - 0.5) * 1.6,
          y: -2.5 - hash(cluster, 6) * 6 + (hash(i, 7) - 0.5) * 0.6,
          z: Math.sin(a) * r + (hash(i, 8) - 0.5) * 1.6,
          s: 0.7 + hash(i, 9) * 1.3,
          v: 0.08 + hash(cluster, 10) * 0.15,
        };
      }),
    [n],
  );
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, emissive: "#c9dcff", emissiveIntensity: 0.35, transparent: true, opacity: 0.92 }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  const geo = useMemo(() => new THREE.IcosahedronGeometry(1, 1), []);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const t = clock.elapsedTime;
    const o = new THREE.Object3D();
    puffs.forEach((p, i) => {
      const drift = ((p.x + t * p.v + 20) % 40) - 20;
      o.position.set(cx + drift, p.y, -cy + p.z);
      o.scale.set(p.s * 1.4, p.s * 0.8, p.s);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geo, mat, n]} frustumCulled={false} />;
}

/* ── the hole (static per display) ─────────────────────────────────────── */

function HoleView({ display, quality }: { display: Display; quality: "high" | "low" }) {
  const { L, holeId } = display;
  const hole = HOLES[holeId];
  const grass = useMemo(() => {
    const t = grassTexture(THEME_GRASS[hole.theme] ?? "#4fae4a");
    return t;
  }, [hole.theme]);
  useEffect(() => () => grass.dispose(), [grass]);
  const rock = useMemo(() => rockTexture(), []);
  const sandT = useMemo(() => sandTexture(), []);
  const iceT = useMemo(() => iceTexture(), []);
  const chev = useMemo(() => chevronTexture(), []);
  const stripes = useMemo(() => stripeTexture(), []);
  const flag = useMemo(() => flagTexture(display.holeNo, "#ff4d6d"), [display.holeNo]);
  useEffect(() => () => flag.dispose(), [flag]);
  const grassGeos = useMemo(() => L.ground.map((g) => flatGeometry(g, 1.4)), [L]);
  const rockGeos = useMemo(() => L.ground.map((g, i) => rockGeometry(g, holeId * 10 + i, 1.1 + (i % 2) * 0.4)), [L, holeId]);
  useEffect(
    () => () => {
      for (const g of grassGeos) g.dispose();
      for (const g of rockGeos) g.dispose();
    },
    [grassGeos, rockGeos],
  );
  const voidGeos = useMemo(() => L.voids.map((v) => flatGeometry(v)), [L]);
  const zoneGeos = useMemo(() => L.zones.map((z) => (z.kind === "slope" ? flatGeometry(z.poly, 1, { x: z.ax, y: z.ay }) : flatGeometry(z.poly, 2.4))), [L]);
  useEffect(
    () => () => {
      for (const g of voidGeos) g.dispose();
      for (const g of zoneGeos) g.dispose();
    },
    [voidGeos, zoneGeos],
  );
  const railRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = railRef.current;
    if (!m) return;
    const o = new THREE.Object3D();
    L.walls.forEach((s, i) => {
      const dx = s.x2 - s.x1;
      const dy = s.y2 - s.y1;
      const len = Math.hypot(dx, dy);
      o.position.set((s.x1 + s.x2) / 2, WALL_H / 2, toZ((s.y1 + s.y2) / 2));
      o.rotation.set(0, Math.atan2(dy, dx), 0);
      o.scale.set(len + 0.036, 1, 1);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  }, [L]);
  const bumperRefs = useRef<(THREE.Mesh | null)[]>([]);
  const chevMat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((_, dtRaw) => {
    const dt = Math.min(0.05, dtRaw);
    if (chevMat.current?.map) chevMat.current.map.offset.y -= dt * 0.5;
    const pulse = bumperPulse;
    bumperRefs.current.forEach((m, i) => {
      if (!m) return;
      pulse[i] = Math.max(0, (pulse[i] ?? 0) - dt * 4);
      const s = 1 + pulse[i] * 0.35;
      m.scale.set(s, 1, s);
    });
  });
  const segs = quality === "high" ? 24 : 14;
  return (
    <group>
      {/* islands */}
      {grassGeos.map((g, i) => (
        <mesh key={`g${i}`} geometry={g} position-y={i * 0.0004} receiveShadow>
          <meshStandardMaterial map={grass} roughness={0.92} />
        </mesh>
      ))}
      {rockGeos.map((g, i) => (
        <mesh key={`r${i}`} geometry={g} castShadow={quality === "high"}>
          <meshStandardMaterial map={rock} roughness={1} />
        </mesh>
      ))}
      {/* grass lip around each island */}
      {L.ground.map((g, i) => (
        <mesh key={`l${i}`} geometry={rockGeos[i]} scale={[1.001, 0.04, 1.001]} position-y={-0.002}>
          <meshStandardMaterial color="#3d8a35" roughness={1} />
        </mesh>
      ))}
      {/* chasms: depth-only cut-outs, the sky shows through */}
      {voidGeos.map((g, i) => (
        <mesh key={`v${i}`} geometry={g} position-y={0.006} renderOrder={-1}>
          <meshBasicMaterial colorWrite={false} />
        </mesh>
      ))}
      {/* zones */}
      {L.zones.map((z, i) =>
        z.kind === "sand" ? (
          <mesh key={`z${i}`} geometry={zoneGeos[i]} position-y={0.003} receiveShadow>
            <meshStandardMaterial map={sandT} roughness={1} />
          </mesh>
        ) : z.kind === "ice" ? (
          <mesh key={`z${i}`} geometry={zoneGeos[i]} position-y={0.003}>
            <meshStandardMaterial map={iceT} roughness={0.05} metalness={0.35} transparent opacity={0.92} />
          </mesh>
        ) : (
          <mesh key={`z${i}`} geometry={zoneGeos[i]} position-y={0.0035}>
            <meshBasicMaterial ref={i === L.zones.findIndex((q) => q.kind === "slope") ? chevMat : undefined} map={chev} transparent opacity={0.5} depthWrite={false} />
          </mesh>
        ),
      )}
      {/* rails */}
      <instancedMesh ref={railRef} args={[undefined, undefined, Math.max(1, L.walls.length)]} castShadow={quality === "high"} receiveShadow key={`rails${display.key}`}>
        <boxGeometry args={[1, WALL_H, 0.036]} />
        <meshStandardMaterial color="#c98a4b" roughness={0.7} />
      </instancedMesh>
      {/* bumpers */}
      {L.bumpers.map((b, i) => (
        <mesh
          key={`b${i}`}
          ref={(m) => {
            bumperRefs.current[i] = m;
          }}
          position={[b.x, 0.045, toZ(b.y)]}
          castShadow
        >
          <cylinderGeometry args={[b.r, b.r, 0.09, segs]} />
          <meshStandardMaterial map={stripes} roughness={0.4} emissive="#550a14" emissiveIntensity={0.4} />
        </mesh>
      ))}
      {/* tee mat */}
      <mesh rotation-x={-Math.PI / 2} position={[L.tee.x, 0.004, toZ(L.tee.y)]}>
        <planeGeometry args={[0.3, 0.3]} />
        <meshStandardMaterial color="#2d6b2a" roughness={1} />
      </mesh>
      {/* cup + flag */}
      <group position={[L.cup.x, 0, toZ(L.cup.y)]}>
        <mesh rotation-x={-Math.PI / 2} position-y={0.0045}>
          <circleGeometry args={[CUP_R, 28]} />
          <meshBasicMaterial color="#0b0d10" />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position-y={0.005}>
          <ringGeometry args={[CUP_R, CUP_R + 0.012, 28]} />
          <meshStandardMaterial color="#f5f5f0" />
        </mesh>
        <mesh position-y={0.42}>
          <cylinderGeometry args={[0.006, 0.006, 0.84, 6]} />
          <meshStandardMaterial color="#f1f1f1" />
        </mesh>
        <FlagCloth texture={flag} />
      </group>
      <Obstacles display={display} quality={quality} />
    </group>
  );
}

function FlagCloth({ texture }: { texture: THREE.Texture }) {
  const ref = useRef<THREE.Mesh>(null);
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(0.26, 0.16, 8, 2);
    g.translate(0.13, 0, 0);
    return g;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  const base = useMemo(() => Float32Array.from(geo.attributes.position.array as Float32Array), [geo]);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const t = clock.elapsedTime;
    const pos = m.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3];
      pos.setZ(i, Math.sin(x * 22 - t * 6) * 0.018 * (x / 0.26));
    }
    pos.needsUpdate = true;
  });
  return (
    <mesh ref={ref} geometry={geo} position={[0.003, 0.76, 0]}>
      <meshStandardMaterial map={texture} side={THREE.DoubleSide} roughness={0.8} />
    </mesh>
  );
}

/* ── obstacles ────────────────────────────────────────────────────────── */

function Obstacles({ display, quality }: { display: Display; quality: "high" | "low" }) {
  const { L } = display;
  const wm = L.windmill;
  const bladesRef = useRef<THREE.Group>(null);
  const fieldRefs = useRef<(THREE.Mesh | null)[]>([]);
  const sign = useMemo(() => labelTexture("WINDMILL", "#a8453a"), []);
  const rampTex = useMemo(() => {
    const t = stripeTexture("#ffd23f", "#2b2b33");
    t.repeat.set(3, 1);
    return t;
  }, []);
  useFrame(({ clock }) => {
    const b = bladesRef.current;
    if (b) b.rotation.z = windmillTurn(windmillNow()) * Math.PI * 2;
    const t = clock.elapsedTime;
    fieldRefs.current.forEach((m, i) => {
      if (!m) return;
      const k = (t * 0.7 + i * 0.3) % 1;
      const s = 0.15 + k * 0.85;
      m.scale.set(s, s, s);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.35 * (1 - k);
    });
  });
  const segs = quality === "high" ? 20 : 12;
  return (
    <group>
      {wm && (
        <group position={[wm.x, 0, toZ(wm.y)]} rotation-y={Math.atan2(-wm.dx, wm.dy)}>
          {/* local: +Z faces the incoming ball (house front), x across */}
          {[-1, 1].map((side) => {
            const inner = 0.13;
            const outer = wm.w / 2;
            const w = outer - inner;
            return (
              <mesh key={side} position={[side * (inner + w / 2), 0.2, -0.15]} castShadow>
                <boxGeometry args={[w, 0.4, 0.3]} />
                <meshStandardMaterial color="#f3e6cf" roughness={0.8} />
              </mesh>
            );
          })}
          <mesh position={[0, 0.33, -0.15]} castShadow>
            <boxGeometry args={[0.26, 0.14, 0.3]} />
            <meshStandardMaterial color="#e9d8bb" roughness={0.8} />
          </mesh>
          <mesh position={[0, 0.58, -0.15]} rotation-y={Math.PI / 4} castShadow>
            <coneGeometry args={[Math.min(0.55, wm.w * 0.42), 0.36, 4]} />
            <meshStandardMaterial color="#b9473b" roughness={0.6} />
          </mesh>
          <mesh position={[0, 0.3, 0.002]}>
            <planeGeometry args={[Math.min(0.6, wm.w * 0.5), 0.08]} />
            <meshBasicMaterial map={sign} transparent />
          </mesh>
          {/* the blades turn in front of the tunnel mouth; a blade pointing straight down blocks it */}
          <group ref={bladesRef} position={[0, 0.36, 0.04]}>
            <mesh>
              <cylinderGeometry args={[0.035, 0.035, 0.05, 12]} />
              <meshStandardMaterial color="#5a3b22" />
            </mesh>
            {[0, 1, 2, 3].map((k) => (
              <group key={k} rotation-z={(k * Math.PI) / 2}>
                <mesh position={[0, -0.18, 0.02]} castShadow>
                  <boxGeometry args={[0.085, 0.33, 0.012]} />
                  <meshStandardMaterial color={k % 2 ? "#fdfbf6" : "#e85d4f"} roughness={0.6} />
                </mesh>
              </group>
            ))}
          </group>
        </group>
      )}
      {L.ramps.map((r, i) => {
        const rise = 0.075;
        const tilt = Math.atan2(rise, r.len);
        return (
          <group key={`ramp${i}`} position={[r.cx, 0, toZ(r.cy)]} rotation-y={Math.atan2(-r.dx, r.dy)}>
            <mesh position={[0, rise / 2, 0]} rotation-x={tilt} castShadow receiveShadow>
              <boxGeometry args={[r.w, 0.018, Math.hypot(r.len, rise)]} />
              <meshStandardMaterial map={rampTex} roughness={0.5} />
            </mesh>
            {[-1, 1].map((s) => (
              <mesh key={s} position={[(s * r.w) / 2, rise / 2 - 0.01, 0]} rotation-x={tilt}>
                <boxGeometry args={[0.02, 0.05, Math.hypot(r.len, rise)]} />
                <meshStandardMaterial color="#2b2b33" />
              </mesh>
            ))}
          </group>
        );
      })}
      {L.voids.map((v, i) => (
        <ChasmRim key={`rim${i}`} poly={v} L={L} />
      ))}
      {L.magnets.map((m, i) => (
        <group key={`mag${i}`} position={[m.x, 0, toZ(m.y)]}>
          <mesh position-y={0.05} castShadow>
            <cylinderGeometry args={[m.r, m.r * 1.1, 0.1, segs]} />
            <meshStandardMaterial color="#4b5263" metalness={0.6} roughness={0.35} />
          </mesh>
          <group position-y={0.2}>
            <mesh rotation-x={Math.PI / 2}>
              <torusGeometry args={[0.06, 0.025, 10, 20, Math.PI]} />
              <meshStandardMaterial color="#e23a3a" roughness={0.35} />
            </mesh>
            {[-1, 1].map((s) => (
              <mesh key={s} position={[s * 0.06, 0, 0.035]} rotation-x={Math.PI / 2}>
                <cylinderGeometry args={[0.025, 0.025, 0.07, 10]} />
                <meshStandardMaterial color={s < 0 ? "#e23a3a" : "#3a6ee2"} roughness={0.35} />
              </mesh>
            ))}
            {[-1, 1].map((s) => (
              <mesh key={`t${s}`} position={[s * 0.06, 0, 0.08]} rotation-x={Math.PI / 2}>
                <cylinderGeometry args={[0.026, 0.026, 0.02, 10]} />
                <meshStandardMaterial color="#d8dde6" metalness={0.9} roughness={0.2} />
              </mesh>
            ))}
          </group>
          <mesh
            ref={(r) => {
              fieldRefs.current[i] = r;
            }}
            rotation-x={-Math.PI / 2}
            position-y={0.006}
          >
            <ringGeometry args={[m.field * 0.96, m.field, 40]} />
            <meshBasicMaterial color="#ff6b6b" transparent opacity={0.3} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Dark earth edges inside a chasm, where it cuts the grass. */
function ChasmRim({ poly, L }: { poly: Poly; L: Layout }) {
  const edges = useMemo(() => {
    const out: { x: number; y: number; len: number; ang: number }[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      // only edges that border grass
      if (!insideAny(L, mx, my)) continue;
      out.push({ x: mx, y: my, len: Math.hypot(b[0] - a[0], b[1] - a[1]), ang: Math.atan2(b[1] - a[1], b[0] - a[0]) });
    }
    return out;
  }, [poly, L]);
  return (
    <group>
      {edges.map((e, i) => (
        <mesh key={i} position={[e.x, -0.03, toZ(e.y)]} rotation-y={e.ang}>
          <boxGeometry args={[e.len, 0.07, 0.02]} />
          <meshStandardMaterial color="#4a2f1c" roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

function insideAny(L: Layout, x: number, y: number): boolean {
  return L.ground.some((g) => {
    let inside = false;
    for (let i = 0, j = g.length - 1; i < g.length; j = i++) {
      const xi = g[i][0];
      const yi = g[i][1];
      const xj = g[j][0];
      const yj = g[j][1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });
}

/* ── the dynamic world: balls, aim, camera, fx ────────────────────────── */

function World(props: SceneProps & { setDisplay: (d: Display) => void; onGolfer: (g: { seat: Seat; pose: GolferPose; key: string }) => void }) {
  const { state, player } = props;
  const gl = useThree((s) => s.gl);
  const ballMats = useMemo(() => Array.from({ length: 6 }, (_, s) => new THREE.MeshStandardMaterial({ map: ballTexture(s), roughness: 0.35 })), []);
  useEffect(() => () => ballMats.forEach((m) => m.dispose()), [ballMats]);
  const ballRefs = useRef<(THREE.Mesh | null)[]>([]);
  const markRefs = useRef<(THREE.Mesh | null)[]>([]);
  const shadowRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lineRoot = useRef<THREE.Group>(null);
  const lines = useRef<{ aim: THREE.Line; path: THREE.Line; trail: THREE.Line } | null>(null);
  const arrowRef = useRef<THREE.Mesh>(null);
  const fxRoot = useRef<THREE.Group>(null);
  const fx = useRef<{ confetti: Particles; dust: Particles; spark: Particles } | null>(null);
  const busyRef = useRef<boolean | null>(null);
  const lastKey = useRef("");
  const golferKey = useRef("");
  const cam = useRef({ pos: new THREE.Vector3(0, 2, 2), look: new THREE.Vector3(0, 0, -2), init: false });
  const pathCache = useRef<{ key: string; pts: [number, number][] }>({ key: "", pts: [] });
  const trail = useRef<{ turn: number; pts: number[] }>({ turn: -1, pts: [] });

  useEffect(() => {
    const root = lineRoot.current;
    if (!root) return;
    const mk = (color: string, dash: number, gap: number, opacity: number, dashed = true) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * 400), 3));
      geo.setDrawRange(0, 0);
      const mat = dashed ? new THREE.LineDashedMaterial({ color, dashSize: dash, gapSize: gap, transparent: true, opacity, depthWrite: false }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      line.visible = false;
      root.add(line);
      return line;
    };
    const aim = mk("#fff6c4", 0.06, 0.04, 0.95);
    const path = mk("#5ff2ff", 0.05, 0.05, 0.8);
    const tr = mk("#ffffff", 0, 0, 0.45, false);
    lines.current = { aim, path, trail: tr };
    return () => {
      for (const l of [aim, path, tr]) {
        root.remove(l);
        l.geometry.dispose();
        (l.material as THREE.Material).dispose();
      }
      lines.current = null;
    };
  }, []);

  useEffect(() => {
    const root = fxRoot.current;
    if (!root) return;
    const confetti = new Particles(320, 0.035, 2.8);
    const dust = new Particles(160, 0.03, 1.2);
    const spark = new Particles(160, 0.025, 4);
    root.add(confetti.points, dust.points, spark.points);
    fx.current = { confetti, dust, spark };
    return () => {
      root.remove(confetti.points, dust.points, spark.points);
      confetti.dispose();
      dust.dispose();
      spark.dispose();
      fx.current = null;
    };
  }, []);

  useFrame((frame, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = nowMs();
    const low = props.quality === "low";
    const pending: ReplayEvent[] = [];
    const view = player.sample(state, t, (e) => {
      pending.push(e);
      props.onEvent(e);
    });
    if (busyRef.current !== view.busy) {
      busyRef.current = view.busy;
      props.onBusy(view.busy);
    }
    if (view.wmClock !== null) alignWindmill(view.wmClock);
    const d = displayFor(state, view, props.preview);
    if (d.key !== lastKey.current) {
      lastKey.current = d.key;
      props.setDisplay(d);
    }
    const L = d.L;

    // ---- events → fx
    for (const e of pending) {
      if (e.kind === "hit") {
        const k = Math.min(1, e.impulse / 2.5);
        if (e.ev === "bumper") {
          const bi = L.bumpers.findIndex((b) => Math.hypot(b.x - e.x, b.y - e.y) < b.r + 0.01);
          if (bi >= 0) bumperPulse[bi] = 1;
          if (!low) fx.current?.spark.burst(e.x, 0.06, toZ(e.y), 10, 0.8, SPARK);
          camShake.v = Math.min(0.5, camShake.v + 0.12);
        } else if (e.ev === "ball") {
          if (!low) fx.current?.spark.burst(e.x, 0.04, toZ(e.y), Math.round(4 + k * 10), 0.6 + k, SPARK);
          camShake.v = Math.min(0.6, camShake.v + 0.1 + k * 0.2);
        } else if (e.ev === "land") {
          fx.current?.dust.burst(e.x, 0.02, toZ(e.y), low ? 10 : 22, 0.7, DUST, 0.5);
          camShake.v = Math.min(0.7, camShake.v + 0.25);
        } else if (e.ev === "sand") fx.current?.dust.burst(e.x, 0.02, toZ(e.y), low ? 6 : 14, 0.4, DUST, 0.6);
        else if (e.ev === "out") fx.current?.dust.burst(e.x, -0.1, toZ(e.y), low ? 10 : 24, 0.5, CLOUD, 0.3);
        else if (e.ev === "cup") fx.current?.spark.burst(e.x, 0.05, toZ(e.y), 14, 0.7, SPARK);
        else if (e.ev === "windmill") camShake.v = Math.min(0.5, camShake.v + 0.15);
      } else if (e.kind === "settled") {
        const r = e.rec;
        if (r.holed) {
          const big = r.stroke === 1 || (r.score !== null && r.score < HOLES[r.holeId].par);
          fx.current?.confetti.burst(L.cup.x, 0.15, toZ(L.cup.y), big ? (low ? 140 : 300) : low ? 50 : 110, big ? 1.6 : 1.1, CONFETTI, 1.3);
          if (big) player.hitStop(200);
        }
      }
    }
    fx.current?.confetti.update(dt, 0.5);
    fx.current?.dust.update(dt, 1.4);
    fx.current?.spark.update(dt, 2);

    // ---- balls
    const a = props.aim.current;
    const aimLive = !!a && a.turn === state.turn && !view.busy && state.phase === "play";
    let activeX = 0;
    let activeY = 0;
    let activeZ = 0;
    let haveActive = false;
    const shown = new Set<number>();
    for (const b of view.balls) {
      const m = ballRefs.current[b.seat];
      const mk = markRefs.current[b.seat];
      const sh = shadowRefs.current[b.seat];
      if (!m || !mk || !sh) continue;
      shown.add(b.seat);
      m.visible = b.visible;
      m.position.set(b.x, BALL_R + b.z, toZ(b.y));
      m.rotation.set(0, 0, 0);
      if (b.roll !== 0) {
        const axis = new THREE.Vector3(-Math.sin(b.dir), 0, -Math.cos(b.dir));
        m.quaternion.setFromAxisAngle(axis, -b.roll);
      }
      m.scale.setScalar(BALL_R);
      sh.visible = b.visible && b.z > -0.02;
      sh.position.set(b.x, 0.004, toZ(b.y));
      const shs = Math.max(0.3, 1 - Math.max(0, b.z) * 1.2);
      sh.scale.set(shs, shs, shs);
      mk.visible = b.visible && b.status === 0;
      const bob = Math.sin(t / 260 + b.seat) * 0.02;
      const big = b.active ? 1.35 : 1;
      mk.position.set(b.x, BALL_R + Math.max(0, b.z) + 0.16 * big + bob, toZ(b.y));
      mk.scale.setScalar(big);
      if (b.active) {
        activeX = b.x;
        activeY = b.y;
        activeZ = b.z;
        haveActive = true;
      }
    }
    for (let s = 0; s < 6; s++) {
      if (shown.has(s)) continue;
      if (ballRefs.current[s]) ballRefs.current[s]!.visible = false;
      if (markRefs.current[s]) markRefs.current[s]!.visible = false;
      if (shadowRefs.current[s]) shadowRefs.current[s]!.visible = false;
    }
    if (!haveActive && state.phase === "play") {
      const p = ballSpot(state, state.activeSeat);
      activeX = p.x;
      activeY = p.y;
    }

    // ---- trail of the ball in play
    const Ls = lines.current;
    if (Ls) {
      if (view.rec && view.rolling >= 0 && haveActive) {
        const tr = trail.current;
        if (tr.turn !== view.rec.turn) {
          tr.turn = view.rec.turn;
          tr.pts = [];
        }
        const n = tr.pts.length / 3;
        const lx = n ? tr.pts[(n - 1) * 3] : NaN;
        const lz = n ? tr.pts[(n - 1) * 3 + 2] : NaN;
        if (!n || Math.hypot(activeX - lx, toZ(activeY) - lz) > 0.04) {
          tr.pts.push(activeX, 0.012 + Math.max(0, activeZ), toZ(activeY));
          if (tr.pts.length > 399 * 3) tr.pts.splice(0, 3);
        }
        const pos = Ls.trail.geometry.attributes.position as THREE.BufferAttribute;
        const cnt = tr.pts.length / 3;
        for (let i = 0; i < cnt; i++) pos.setXYZ(i, tr.pts[i * 3], tr.pts[i * 3 + 1], tr.pts[i * 3 + 2]);
        pos.needsUpdate = true;
        Ls.trail.geometry.setDrawRange(0, cnt);
        (Ls.trail.material as THREE.LineBasicMaterial).color.set(SEAT_COLORS[view.rec.seat % 6]);
        Ls.trail.visible = cnt > 1;
      } else if (!view.busy) Ls.trail.visible = false;

      // ---- aim arrow + 🔰 predicted roll
      if (aimLive && a) {
        const dx = Math.cos(a.ang);
        const dy = Math.sin(a.ang);
        const len = 0.18 + a.power * 1.5;
        const pos = Ls.aim.geometry.attributes.position as THREE.BufferAttribute;
        pos.setXYZ(0, activeX + dx * 0.05, 0.02, toZ(activeY + dy * 0.05));
        pos.setXYZ(1, activeX + dx * len, 0.02, toZ(activeY + dy * len));
        pos.needsUpdate = true;
        Ls.aim.geometry.setDrawRange(0, 2);
        Ls.aim.computeLineDistances();
        Ls.aim.visible = true;
        const ar = arrowRef.current;
        if (ar) {
          ar.visible = true;
          ar.position.set(activeX + dx * len, 0.025, toZ(activeY + dy * len));
          ar.rotation.set(-Math.PI / 2, 0, a.ang - Math.PI / 2);
          const c = new THREE.Color().setHSL(0.33 - a.power * 0.33, 0.95, 0.55);
          (ar.material as THREE.MeshBasicMaterial).color.copy(c);
          (Ls.aim.material as THREE.LineDashedMaterial).color.copy(c);
        }
        const showPath = props.helper && (!a.remote || props.canAim);
        if (showPath) {
          const key = `${state.turn}:${a.ang.toFixed(3)}:${a.power.toFixed(3)}:${d.key}`;
          if (pathCache.current.key !== key) {
            const v = velocityFor(a.ang, a.power);
            const res = simulate(L, [{ id: state.activeSeat, x: activeX, y: activeY }], { shooter: 0, vx: v.vx, vy: v.vy, wm: windmillNow() + 0.75 }, true);
            const pts: [number, number][] = [];
            const fr = res.frames!;
            for (let i = 0; i < fr.length; i += 3) pts.push([fr[i][0], fr[i][1]]);
            pathCache.current = { key, pts: pts.slice(0, 400) };
          }
          const pts = pathCache.current.pts;
          const pp = Ls.path.geometry.attributes.position as THREE.BufferAttribute;
          for (let i = 0; i < pts.length; i++) pp.setXYZ(i, pts[i][0], 0.016, toZ(pts[i][1]));
          pp.needsUpdate = true;
          Ls.path.geometry.setDrawRange(0, pts.length);
          Ls.path.computeLineDistances();
          Ls.path.visible = pts.length > 1;
        } else Ls.path.visible = false;
      } else {
        Ls.aim.visible = false;
        Ls.path.visible = false;
        if (arrowRef.current) arrowRef.current.visible = false;
      }
    }

    // ---- golfer pose + spot
    const gSeat = view.rec ? view.rec.seat : state.activeSeat;
    let pose: GolferPose = "address";
    let key = `${gSeat}:idle:${state.turn}`;
    let ang = a && aimLive ? a.ang : Math.atan2(L.cup.y - activeY, L.cup.x - activeX);
    let gx = activeX;
    let gy = activeY;
    let showGolfer = state.phase === "play";
    if (view.rec) {
      const r = view.rec;
      const from = r.from;
      gx = from.x;
      gy = from.y;
      ang = r.timeout ? ang : Math.atan2(r.vy, r.vx);
      showGolfer = true;
      if (r.timeout) {
        pose = "slump";
        key = `${r.turn}:whiff`;
      } else if (view.windup >= 0) {
        pose = "swing";
        key = `${r.turn}:swing`;
      } else if (!view.settled) {
        pose = "follow";
        key = `${r.turn}:fol`;
      } else {
        pose = r.holed ? "cheer" : r.out || r.picked ? "slump" : "follow";
        key = `${r.turn}:end`;
      }
      golferRig.progress = Math.max(0, view.windup);
      golferRig.power = Math.min(1, Math.hypot(r.vx, r.vy) / 4200);
    } else {
      golferRig.progress = 0;
      if (a && aimLive) golferRig.power = a.power;
    }
    // stand side-on: the target on the golfer's left
    const fx2 = Math.sin(ang);
    const fy2 = -Math.cos(ang);
    golferRig.pos.set(gx - fx2 * STANCE, showGolfer ? 0 : -50, toZ(gy - fy2 * STANCE));
    golferRig.yaw = Math.atan2(fx2, -fy2);
    if (key !== golferKey.current) {
      golferKey.current = key;
      props.onGolfer({ seat: gSeat, pose, key });
    }

    // ---- camera
    const c = cam.current;
    const camera = frame.camera as THREE.PerspectiveCamera;
    const aspect = frame.size.width / frame.size.height;
    const portrait = aspect < 0.9;
    const wantPos = new THREE.Vector3();
    const wantLook = new THREE.Vector3();
    let rate = 3;
    const overview = props.cam === "overview" || state.phase === "pick" || state.phase === "ended";
    const draggingNow = !!a && a.dragging && aimLive;
    if (overview) {
      const bb = holeBounds(d.holeId);
      const cx = (bb.x0 + bb.x1) / 2;
      const cy = (bb.y0 + bb.y1) / 2;
      const fovR = (camera.fov * Math.PI) / 180;
      const needH = (bb.y1 - bb.y0 + 0.8) / (2 * Math.tan(fovR / 2));
      const needW = (bb.x1 - bb.x0 + 0.8) / (2 * Math.tan(fovR / 2) * aspect);
      const h = Math.max(needH, needW) * 1.05;
      wantPos.set(cx, h * 0.93, toZ(cy - h * 0.36));
      wantLook.set(cx, 0, toZ(cy));
      rate = 2.5;
    } else if (view.rec && view.rolling >= 0 && !view.rec.timeout) {
      const r = view.rec;
      const sa = Math.atan2(r.vy, r.vx);
      const back = portrait ? 1.55 : 1.25;
      wantPos.set(activeX - Math.cos(sa) * back, (portrait ? 1.25 : 0.95) + Math.max(0, activeZ) * 0.6, toZ(activeY - Math.sin(sa) * back));
      wantLook.set(activeX + Math.cos(sa) * 0.6, 0, toZ(activeY + Math.sin(sa) * 0.6));
      rate = 2.6;
    } else {
      // behind the ball, looking down the aim line
      const back = portrait ? 1.75 : 1.4;
      const lookAng = ang;
      wantPos.set(activeX - Math.cos(lookAng) * back, portrait ? 1.45 : 1.15, toZ(activeY - Math.sin(lookAng) * back));
      wantLook.set(activeX + Math.cos(lookAng) * 1.0, 0, toZ(activeY + Math.sin(lookAng) * 1.0));
      rate = 3;
    }
    if (!c.init) {
      c.init = true;
      c.pos.copy(wantPos);
      c.look.copy(wantLook);
    } else if (!draggingNow) {
      const k = 1 - Math.exp(-dt * rate);
      c.pos.lerp(wantPos, k);
      c.look.lerp(wantLook, k);
    }
    const s = camShake.v;
    const jx = s > 0.01 ? (Math.random() - 0.5) * s * 0.03 : 0;
    const jy = s > 0.01 ? (Math.random() - 0.5) * s * 0.03 : 0;
    camera.position.set(c.pos.x + jx, c.pos.y + jy, c.pos.z);
    camera.lookAt(c.look);
    const fov = portrait ? 60 : 48;
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    camShake.v = Math.max(0, camShake.v - dt * 2.4);
  });

  /** §5 — slingshot: pull back from the direction you want; let go to putt. */
  const startDrag = (e: ThreeEvent<PointerEvent>) => {
    if (!props.canAim) return;
    e.stopPropagation();
    const camera = e.camera;
    const el = gl.domElement;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const ray = new THREE.Raycaster();
    const hit = new THREE.Vector3();
    const toCourse = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
      return ray.ray.intersectPlane(plane, hit) ? { x: hit.x, y: -hit.z } : null;
    };
    const first = toCourse(e.nativeEvent.clientX, e.nativeEvent.clientY);
    if (!first) return;
    let last: { ang: number; power: number } | null = null;
    const apply = (p: { x: number; y: number }) => {
      const px = first.x - p.x;
      const py = first.y - p.y;
      const pull = Math.hypot(px, py);
      if (pull < 0.04) {
        last = null;
        props.onDraft({ dragging: true });
        return;
      }
      last = { ang: Math.atan2(py, px), power: Math.min(1, pull / FULL_PULL) };
      props.onDraft({ ...last, dragging: true });
    };
    props.onDraft({ dragging: true });
    const move = (ev: PointerEvent) => {
      const p = toCourse(ev.clientX, ev.clientY);
      if (p) apply(p);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      props.onDraft({ dragging: false }, !!last && last.power >= 0.03);
    };
    const cancel = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      props.onDraft({ dragging: false });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  return (
    <group>
      {/* input plane over the whole course */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.001, -4]} onPointerDown={startDrag}>
        <planeGeometry args={[30, 30]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      {Array.from({ length: 6 }, (_, s) => (
        <group key={s}>
          <mesh
            ref={(m) => {
              ballRefs.current[s] = m;
            }}
            geometry={ballGeo}
            material={ballMats[s]}
            castShadow
            visible={false}
          />
          <mesh
            ref={(m) => {
              shadowRefs.current[s] = m;
            }}
            rotation-x={-Math.PI / 2}
            visible={false}
          >
            <circleGeometry args={[BALL_R * 1.1, 14]} />
            <meshBasicMaterial color="#000000" transparent opacity={0.35} depthWrite={false} />
          </mesh>
          <mesh
            ref={(m) => {
              markRefs.current[s] = m;
            }}
            rotation-x={Math.PI}
            visible={false}
          >
            <coneGeometry args={[0.028, 0.06, 4]} />
            <meshBasicMaterial color={SEAT_COLORS[s]} />
          </mesh>
        </group>
      ))}
      <mesh ref={arrowRef} visible={false}>
        <circleGeometry args={[0.035, 3]} />
        <meshBasicMaterial color="#fff6c4" transparent opacity={0.95} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <group ref={lineRoot} />
      <group ref={fxRoot} />
    </group>
  );
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

function GolferSlot({ seat, pose, poseKey, names, lowDetail }: { seat: Seat; pose: GolferPose; poseKey: string; names: Record<Seat, string>; lowDetail: boolean }) {
  const chars = useRoomCharacters((st) => st.byName);
  const name = names[seat] ?? "";
  const look = useMemo(() => resolveLook(seat, ["none"], roomCharacterOf(chars, name)), [seat, chars, name]);
  return <Golfer key={seat} look={look} seed={seat * 11 + 5} pose={pose} poseKey={poseKey} lowDetail={lowDetail} color={SEAT_COLORS[seat % 6]} />;
}

export default function GolfScene(props: SceneProps) {
  const high = props.quality === "high";
  const [display, setDisplay] = useState<Display>(() => displayFor(props.state, null, props.preview));
  const [golfer, setGolfer] = useState<{ seat: Seat; pose: GolferPose; key: string }>({ seat: props.state.activeSeat, pose: "address", key: "init" });
  const bb = holeBounds(display.holeId);
  const cx = (bb.x0 + bb.x1) / 2;
  const cy = (bb.y0 + bb.y1) / 2;
  return (
    <Canvas shadows={high} dpr={high ? [1, 1.75] : 1} gl={{ antialias: high, powerPreference: "high-performance" }} camera={{ fov: 48, position: [0, 2, 2], near: 0.03, far: 160 }} style={{ touchAction: "none" }}>
      <color attach="background" args={["#cfe9ff"]} />
      <fog attach="fog" args={["#d6ecff", 18, 60]} />
      <Sky />
      <hemisphereLight args={["#eaf6ff", "#6b8f5a", 0.85]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[cx + 4, 9, toZ(cy) + 3]}
        intensity={1.5}
        color="#fff4e0"
        castShadow={high}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
        shadow-camera-near={1}
        shadow-camera-far={30}
        shadow-bias={-0.0006}
      >
        <object3D attach="target" position={[cx, 0, toZ(cy)]} />
      </directionalLight>
      <Clouds cx={cx} cy={cy} quality={props.quality} />
      <HoleView key={display.key} display={display} quality={props.quality} />
      <World {...props} setDisplay={setDisplay} onGolfer={setGolfer} />
      <GolferSlot seat={golfer.seat} pose={golfer.pose} poseKey={golfer.key} names={props.names} lowDetail={!high} />
      <FpsProbe onFps={props.onFps} />
    </Canvas>
  );
}

export { WINDMILL_PERIOD };
