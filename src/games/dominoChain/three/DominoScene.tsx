"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { colOf, DIRS, rowOf, sidesFor, type DominoState, type RoundResult } from "../engine";
import { toppleAt, type CellAnim } from "../anim";
import { SEAT_COLORS } from "../colors";

/**
 * 도미노 연쇄 3D 무대 (rulebook §11). Display + cell picking only.
 *
 * Cell (c, r) sits at three.js (c − m, 0, r − m), m = (size − 1) / 2, so the
 * south edge (row size−1) faces +z. A piece facing direction d tips over
 * toward DIRS[d] around its front bottom edge. During the topple the board
 * passes the playback clock (`toppleMs`), and every cell's pose comes from
 * `toppleAt` (anim.ts) — no physics, the engine already decided it all.
 */

export interface SceneShared {
  /** ms since the topple started (−1 = building). */
  toppleMs: number;
}

export interface DominoSceneProps {
  state: DominoState;
  viewerSeat: number;
  /** Frontier cells I may place on right now. */
  open: Set<number>;
  /** Cells a wall may go on (when the wall tool is picked). */
  wallCells: Set<number> | null;
  selected: number | null;
  /** Ghost piece on the selected cell. */
  ghost: { kind: "domino" | "split" | "wall"; dir: number } | null;
  /** Predicted owner per cell (🔮 preview), −1 = none. */
  predicted: Map<number, number> | null;
  result: RoundResult | null;
  shared: MutableRefObject<SceneShared>;
  onCell: (cell: number) => void;
  topView: boolean;
  quality: "high" | "low";
  onFps?: (fps: number) => void;
}

const SIDE_AZ = [Math.PI / 2, Math.PI, -Math.PI / 2, 0];
const dominoGeo = new THREE.BoxGeometry(0.16, 0.82, 0.52);
const splitGeo = new THREE.BoxGeometry(0.2, 0.82, 0.7);
const capGeo = new THREE.BoxGeometry(0.17, 0.06, 0.53);
const pipGeo = new THREE.CircleGeometry(0.045, 10);
const tileGeo = new THREE.PlaneGeometry(0.92, 0.92);
const ringGeo = new THREE.RingGeometry(0.4, 0.48, 32);

function yawFor(d: number): number {
  const [dc, dr] = DIRS[d];
  return Math.atan2(-dr, dc);
}

/* ── one standing / falling piece ─────────────────────────────────── */

interface PieceSlot {
  root: THREE.Group;
  pivot: THREE.Group;
  body: THREE.Mesh;
  cap: THREE.Mesh;
}

function Pieces(props: DominoSceneProps) {
  const { state } = props;
  const m = (state.size - 1) / 2;
  const slots = useRef(new Map<number, PieceSlot>());
  const bells = useRef(new Map<number, THREE.Group>());
  const bombs = useRef(new Map<number, THREE.Group>());
  const mats = useMemo(() => SEAT_COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.05 })), []);
  const capMats = useMemo(() => [...SEAT_COLORS, "#f8fafc"].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, emissive: c, emissiveIntensity: 0.15 })), []);
  const wallMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#8b8f98", roughness: 0.85 }), []);
  useEffect(
    () => () => {
      for (const x of [...mats, ...capMats, wallMat]) x.dispose();
    },
    [mats, capMats, wallMat],
  );
  const pieces = useMemo(
    () =>
      state.cells
        .map((c, i) => ({ i, p: c.piece }))
        .filter((x) => x.p)
        .map((x) => ({ i: x.i, ...x.p! })),
    [state.cells],
  );
  const features = useMemo(
    () =>
      state.cells
        .map((c, i) => ({ i, f: c.feature }))
        .filter((x) => x.f)
        .map((x) => ({ i: x.i, ...x.f! })),
    [state.cells],
  );

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const ms = props.shared.current.toppleMs;
    const anim: Map<number, CellAnim> | null = ms >= 0 && props.result ? toppleAt(props.result, ms) : null;
    for (const p of pieces) {
      const s = slots.current.get(p.i);
      if (!s) continue;
      const a = anim?.get(p.i);
      const fall = a?.kind === "fall" ? a.fall : 0;
      // tip toward the facing direction (ease-in like a real domino)
      const ang = fall < 1 ? fall * fall * 1.25 : 1.25;
      s.pivot.rotation.z = p.kind === "wall" ? 0 : -ang;
      const owner = a?.kind === "fall" ? a.owner : p.owner;
      if (p.kind !== "wall") s.body.material = mats[owner % mats.length];
      const pred = props.predicted?.get(p.i);
      const capOwner = anim ? owner : pred !== undefined && pred >= 0 ? pred : p.owner;
      s.cap.material = capMats[capOwner % SEAT_COLORS.length];
      s.cap.visible = p.kind !== "wall" && p.kind !== "pusher";
      // a piece the preview says a rival will take wobbles a little
      if (!anim && pred !== undefined && pred >= 0 && pred !== p.owner) s.root.position.y = Math.abs(Math.sin(t * 6 + p.i)) * 0.05;
      else s.root.position.y = 0;
    }
    for (const [i, g] of bells.current) {
      const a = anim?.get(i);
      if (a && a.kind === "ring") {
        const k = Math.max(0, 1 - a.since / 10);
        g.rotation.z = Math.sin(a.since * 2.2) * 0.5 * k;
        const glow = g.children[2] as THREE.Mesh | undefined;
        if (glow) {
          glow.visible = true;
          const c = a.owners.length === 1 ? SEAT_COLORS[a.owners[0] % SEAT_COLORS.length] : "#ffffff";
          (glow.material as THREE.MeshBasicMaterial).color.set(c);
          glow.scale.setScalar(1 + Math.min(1.5, a.since * 0.12));
          (glow.material as THREE.MeshBasicMaterial).opacity = 0.75 * Math.max(0.25, k);
        }
      } else {
        g.rotation.z = Math.sin(t * 1.5 + i) * 0.03;
        const glow = g.children[2] as THREE.Mesh | undefined;
        if (glow) glow.visible = false;
      }
    }
    for (const [i, g] of bombs.current) {
      const a = anim?.get(i);
      if (a && a.kind === "boom") {
        const k = Math.min(1, a.since / 3);
        g.scale.setScalar(1 + k * 2.4);
        g.visible = k < 1;
        const flash = g.children[2] as THREE.Mesh | undefined;
        if (flash) flash.visible = true;
      } else {
        g.scale.setScalar(1 + Math.sin(t * 5 + i) * 0.04);
        g.visible = true;
        const flash = g.children[2] as THREE.Mesh | undefined;
        if (flash) flash.visible = false;
      }
    }
  });

  return (
    <group>
      {pieces.map((p) => {
        const x = colOf(state.size, p.i) - m;
        const z = rowOf(state.size, p.i) - m;
        const yaw = p.kind === "wall" ? 0 : yawFor(p.dir);
        return (
          <group
            key={`${p.i}:${p.kind}:${p.owner}:${p.dir}`}
            position={[x, 0, z]}
            rotation-y={yaw}
            ref={(g) => {
              if (!g) {
                slots.current.delete(p.i);
                return;
              }
              const pivot = g.children[0] as THREE.Group;
              slots.current.set(p.i, { root: g, pivot, body: pivot.children[0] as THREE.Mesh, cap: pivot.children[1] as THREE.Mesh });
            }}
          >
            <group position={[p.kind === "split" ? 0.1 : 0.08, 0, 0]}>
              {p.kind === "wall" ? (
                <mesh position={[-0.08, 0.3, 0]} material={wallMat} castShadow receiveShadow>
                  <boxGeometry args={[0.86, 0.6, 0.86]} />
                </mesh>
              ) : p.kind === "pusher" ? (
                <mesh position={[-0.2, 0.25, 0]} material={mats[p.owner % mats.length]} castShadow>
                  <boxGeometry args={[0.5, 0.5, 0.7]} />
                </mesh>
              ) : (
                <mesh position={[p.kind === "split" ? -0.1 : -0.08, 0.41, 0]} geometry={p.kind === "split" ? splitGeo : dominoGeo} material={mats[p.owner % mats.length]} castShadow receiveShadow />
              )}
              <mesh position={[p.kind === "split" ? -0.1 : -0.08, 0.84, 0]} geometry={capGeo} material={capMats[p.owner % SEAT_COLORS.length]} />
              {/* pips on the front face: 1 for a domino, the split gets a "V" of three */}
              {p.kind === "domino" && (
                <mesh position={[0.001, 0.55, 0]} rotation-y={Math.PI / 2} geometry={pipGeo}>
                  <meshBasicMaterial color="#ffffff" />
                </mesh>
              )}
              {p.kind === "split" &&
                [
                  [0.55, -0.16],
                  [0.4, 0],
                  [0.55, 0.16],
                ].map(([y, zz], k) => (
                  <mesh key={k} position={[0.001, y, zz]} rotation-y={Math.PI / 2} geometry={pipGeo}>
                    <meshBasicMaterial color="#ffffff" />
                  </mesh>
                ))}
              {p.kind === "pusher" && (
                <mesh position={[0.12, 0.25, 0]} rotation-z={-Math.PI / 2}>
                  <coneGeometry args={[0.2, 0.3, 3]} />
                  <meshBasicMaterial color="#ffffff" />
                </mesh>
              )}
            </group>
          </group>
        );
      })}
      {features.map((f) => {
        const x = colOf(state.size, f.i) - m;
        const z = rowOf(state.size, f.i) - m;
        if (f.kind === "bell")
          return (
            <group key={`b${f.i}`} position={[x, 0, z]}>
              <mesh position-y={0.04}>
                <cylinderGeometry args={[0.3, 0.34, 0.08, 20]} />
                <meshStandardMaterial color="#4a3a24" roughness={0.6} />
              </mesh>
              <group
                position-y={0.78}
                ref={(g) => {
                  if (g) bells.current.set(f.i, g);
                  else bells.current.delete(f.i);
                }}
              >
                <mesh position-y={-0.26}>
                  <cylinderGeometry args={[0.12 + f.value * 0.03, 0.26 + f.value * 0.05, 0.42, 20, 1, true]} />
                  <meshStandardMaterial color={f.value >= 3 ? "#ffd34d" : f.value === 2 ? "#f2c14e" : "#e0b04a"} metalness={0.35} roughness={0.3} emissive="#8a5a00" emissiveIntensity={0.35} side={THREE.DoubleSide} />
                </mesh>
                <mesh position-y={-0.02}>
                  <sphereGeometry args={[0.13 + f.value * 0.02, 16, 10]} />
                  <meshStandardMaterial color="#f6d35b" metalness={0.35} roughness={0.3} emissive="#8a5a00" emissiveIntensity={0.3} />
                </mesh>
                <mesh position-y={-0.3} rotation-x={-Math.PI / 2} visible={false}>
                  <ringGeometry args={[0.35, 0.5, 32]} />
                  <meshBasicMaterial color="#ffffff" transparent opacity={0.7} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
              </group>
              {/* value pips around the base so it reads without the number */}
              {Array.from({ length: f.value }, (_, k) => (
                <mesh key={k} position={[Math.cos((k / f.value) * Math.PI * 2) * 0.38, 0.09, Math.sin((k / f.value) * Math.PI * 2) * 0.38]}>
                  <sphereGeometry args={[0.06, 10, 8]} />
                  <meshStandardMaterial color="#ffd34d" emissive="#a16207" emissiveIntensity={0.4} />
                </mesh>
              ))}
            </group>
          );
        if (f.kind === "bomb")
          return (
            <group
              key={`m${f.i}`}
              position={[x, 0.3, z]}
              ref={(g) => {
                if (g) bombs.current.set(f.i, g);
                else bombs.current.delete(f.i);
              }}
            >
              <mesh castShadow>
                <sphereGeometry args={[0.3, 18, 12]} />
                <meshStandardMaterial color="#1c1917" roughness={0.4} metalness={0.3} />
              </mesh>
              <mesh position={[0.1, 0.32, 0]} rotation-z={-0.4}>
                <cylinderGeometry args={[0.03, 0.03, 0.2, 6]} />
                <meshStandardMaterial color="#f97316" emissive="#f97316" emissiveIntensity={0.8} />
              </mesh>
              <mesh visible={false}>
                <sphereGeometry args={[0.6, 14, 10]} />
                <meshBasicMaterial color="#fb923c" transparent opacity={0.55} depthWrite={false} />
              </mesh>
            </group>
          );
        return (
          <mesh key={`r${f.i}`} position={[x, 0.3, z]} rotation={[f.i * 0.7, f.i * 1.3, 0]} castShadow>
            <dodecahedronGeometry args={[0.38, 0]} />
            <meshStandardMaterial color="#6b6f76" roughness={0.95} />
          </mesh>
        );
      })}
    </group>
  );
}

/* ── board, highlights, ghost, picking ────────────────────────────── */

function Board(props: DominoSceneProps) {
  const { state } = props;
  const m = (state.size - 1) / 2;
  const half = state.size / 2;
  const tiles = useRef<THREE.Group>(null);
  const ghostRef = useRef<THREE.Group>(null);
  const selRef = useRef<THREE.Mesh>(null);
  const down = useRef<{ x: number; y: number } | null>(null);
  const myColor = SEAT_COLORS[Math.max(0, props.viewerSeat) % SEAT_COLORS.length];
  const marks = useMemo(() => {
    const cells = props.wallCells ?? props.open;
    return [...cells];
  }, [props.open, props.wallCells]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const g = tiles.current;
    if (g) for (const c of g.children) ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.sin(t * 4) * 0.18;
    const gh = ghostRef.current;
    if (gh) {
      const show = props.selected !== null && !!props.ghost;
      gh.visible = show;
      if (show && props.ghost) {
        gh.position.set(colOf(state.size, props.selected!) - m, 0, rowOf(state.size, props.selected!) - m);
        gh.rotation.y = props.ghost.kind === "wall" ? 0 : yawFor(props.ghost.dir);
        gh.children.forEach((c, k) => (c.visible = (props.ghost!.kind === "wall" ? 2 : props.ghost!.kind === "split" ? 1 : 0) === k));
      }
    }
    const sel = selRef.current;
    if (sel) {
      sel.visible = props.selected !== null;
      if (props.selected !== null) {
        sel.position.set(colOf(state.size, props.selected) - m, 0.012, rowOf(state.size, props.selected) - m);
        sel.scale.setScalar(1 + Math.sin(t * 5) * 0.06);
      }
    }
  });
  const pick = (e: ThreeEvent<PointerEvent>) => {
    const d = down.current;
    down.current = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) return;
    const c = Math.round(e.point.x + m);
    const r = Math.round(e.point.z + m);
    if (c < 0 || r < 0 || c >= state.size || r >= state.size) return;
    props.onCell(c + r * state.size);
  };
  return (
    <group>
      {/* table + board */}
      <mesh position={[0, -0.6, 0]} receiveShadow>
        <boxGeometry args={[state.size + 3, 1.2, state.size + 3]} />
        <meshStandardMaterial color="#6b4423" roughness={0.6} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.001} receiveShadow onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })} onPointerUp={pick}>
        <planeGeometry args={[state.size, state.size]} />
        <meshStandardMaterial color="#e8dcc2" roughness={0.8} />
      </mesh>
      {/* grid lines */}
      <lineSegments position-y={0.003}>
        <bufferGeometry
          attach="geometry"
          onUpdate={(g) => {
            const pts: number[] = [];
            for (let k = 0; k <= state.size; k++) {
              const v = k - half;
              pts.push(-half, 0, v, half, 0, v, v, 0, -half, v, 0, half);
            }
            g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
          }}
        />
        <lineBasicMaterial color="#b39f7a" transparent opacity={0.7} />
      </lineSegments>
      {/* seat colour bands on each pusher's edge */}
      {sidesFor(state.playerCount).map((side, seat) => {
        const pos: [number, number, number] = side === 0 ? [0, 0.004, half - 0.15] : side === 2 ? [0, 0.004, -half + 0.15] : side === 1 ? [-half + 0.15, 0.004, 0] : [half - 0.15, 0.004, 0];
        const along = side === 0 || side === 2;
        return (
          <mesh key={seat} position={pos} rotation-x={-Math.PI / 2}>
            <planeGeometry args={along ? [state.size, 0.3] : [0.3, state.size]} />
            <meshBasicMaterial color={SEAT_COLORS[seat % SEAT_COLORS.length]} transparent opacity={0.55} />
          </mesh>
        );
      })}
      <group ref={tiles}>
        {marks.map((i) => (
          <mesh key={i} geometry={tileGeo} position={[colOf(state.size, i) - m, 0.006, rowOf(state.size, i) - m]} rotation-x={-Math.PI / 2}>
            <meshBasicMaterial color={props.wallCells ? "#94a3b8" : myColor} transparent opacity={0.35} depthWrite={false} />
          </mesh>
        ))}
      </group>
      <mesh ref={selRef} geometry={ringGeo} rotation-x={-Math.PI / 2} visible={false}>
        <meshBasicMaterial color="#ffffff" transparent opacity={0.9} depthWrite={false} />
      </mesh>
      <group ref={ghostRef} visible={false}>
        <mesh position={[0, 0.41, 0]} geometry={dominoGeo}>
          <meshStandardMaterial color={myColor} transparent opacity={0.5} />
        </mesh>
        <mesh position={[0, 0.41, 0]} geometry={splitGeo}>
          <meshStandardMaterial color={myColor} transparent opacity={0.5} />
        </mesh>
        <mesh position={[0, 0.3, 0]}>
          <boxGeometry args={[0.86, 0.6, 0.86]} />
          <meshStandardMaterial color="#8b8f98" transparent opacity={0.5} />
        </mesh>
      </group>
    </group>
  );
}

/* ── camera ─────────────────────────────────────────────────────────── */

const dragState = { v: false };

function CameraRig({ side, topView, size }: { side: number; topView: boolean; size: number }) {
  const gl = useThree((s) => s.gl);
  const orbit = useRef({ az: SIDE_AZ[side] ?? Math.PI / 2, el: 1.0, userEl: 1.0, zoom: 1 });
  const lastSide = useRef(side);
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
        o.zoom = Math.max(0.55, Math.min(1.5, o.zoom * (pinch / Math.max(1, d))));
        pinch = d;
        return;
      }
      const w = el.clientWidth || 1;
      if (Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y) > 1) dragState.v = true;
      o.az -= ((cur.x - prev.x) / w) * 3.4;
      o.userEl = Math.max(0.45, Math.min(1.5, o.userEl + ((cur.y - prev.y) / w) * 2.2));
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      dragState.v = false;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const o = orbit.current;
      o.zoom = Math.max(0.55, Math.min(1.5, o.zoom * (1 + Math.sign(e.deltaY) * 0.08)));
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("wheel", wheel, { passive: false });
    for (const ev of ["pointerup", "pointerleave", "pointercancel"] as const) el.addEventListener(ev, up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("wheel", wheel);
      for (const ev of ["pointerup", "pointerleave", "pointercancel"] as const) el.removeEventListener(ev, up);
    };
  }, [gl]);
  useFrame((frame) => {
    const cam = frame.camera as THREE.PerspectiveCamera;
    const o = orbit.current;
    if (lastSide.current !== side) {
      lastSide.current = side;
      o.az = SIDE_AZ[side] ?? o.az;
    }
    const wantEl = topView ? 1.52 : o.userEl;
    o.el += (wantEl - o.el) * 0.08;
    const portrait = frame.size.width / frame.size.height < 0.9;
    const dist = size * (portrait ? 2.05 : 1.45) * o.zoom;
    cam.position.set(Math.cos(o.az) * Math.cos(o.el) * dist, Math.sin(o.el) * dist, Math.sin(o.az) * Math.cos(o.el) * dist);
    cam.lookAt(0, 0, 0);
    const fov = portrait ? 48 : 40;
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  });
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

export default function DominoScene(props: DominoSceneProps) {
  const high = props.quality === "high";
  const side = sidesFor(props.state.playerCount)[Math.max(0, props.viewerSeat)] ?? 0;
  return (
    <Canvas shadows={high} dpr={high ? [1, 1.75] : 1} gl={{ antialias: high, powerPreference: "high-performance" }} camera={{ fov: 40, position: [0, 14, 12], near: 0.1, far: 200 }} style={{ touchAction: "none" }}>
      <color attach="background" args={["#1d1a26"]} />
      <fog attach="fog" args={["#1d1a26", 30, 80]} />
      <hemisphereLight args={["#fff6e5", "#2a2333", 0.7]} />
      <ambientLight intensity={0.2} />
      <directionalLight
        position={[6, 14, 8]}
        intensity={1.8}
        color="#fff3e0"
        castShadow={high}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
        shadow-bias={-0.0005}
      />
      <directionalLight position={[-8, 6, -6]} intensity={0.35} color="#b9c8ff" />
      <Board {...props} />
      <Pieces {...props} />
      <CameraRig side={side} topView={props.topView} size={props.state.size} />
      <FpsProbe onFps={props.onFps} />
    </Canvas>
  );
}
