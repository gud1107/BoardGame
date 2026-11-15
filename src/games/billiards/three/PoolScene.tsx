"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { CUE_ID, isPocket, rackCarom, rackPocket, type BilliardsState } from "../engine";
import { HALF_H, HALF_W, POCKETS, R } from "../physics";
import { aimGuide, type LiveAim } from "../live";
import type { ReplayEvent, ReplayPlayer } from "../replay";
import { ballTexture, feltTexture, luckyLabel, woodTexture } from "./ballTextures";

/**
 * 당구 파티 3D 무대 (rulebook §10). Display + aiming input only — the replay
 * player says where every ball is each frame.
 *
 * Table coords (x, y) map to three.js (x, −y) on the cloth (y = 0).
 * Aiming (§4): in the 🎥 aim view, drag sideways anywhere to swing the cue
 * (relative, fine control); in the top view, point at where you want the cue
 * ball to go. With ball in hand, drag the cue ball itself to place it.
 *
 * Lint rules (React Compiler, see alkkagi/three/Scene3D): no ref reads during
 * render; camera only touched inside useFrame helpers.
 */

export interface PoolSceneProps {
  state: BilliardsState;
  player: ReplayPlayer;
  /** The viewer may aim right now (their turn and the replay is idle). */
  canAim: boolean;
  /** Ball in hand for me right now. */
  placing: boolean;
  aim: MutableRefObject<LiveAim | null>;
  onAimDir: (dx: number, dy: number) => void;
  onPlace: (x: number, y: number) => void;
  onEvent: (e: ReplayEvent) => void;
  onBusy: (busy: boolean) => void;
  topView: boolean;
  quality: "high" | "low";
  onFps?: (fps: number) => void;
}

const nowMs = () => performance.now();
const ballGeo = new THREE.SphereGeometry(R, 32, 20);
const ringGeo = new THREE.TorusGeometry(1, 0.05, 8, 40);
const CLOTH_Y = 0;
const CUSHION_H = 0.34;
const RAIL_W = 0.55;
const FRAME_W = 1.25;

/** Shared between the input handler (writer) and the camera rig (reader). */
const camState = { aimView: true, shake: 0 };

function T(x: number, y: number, h = 0): THREE.Vector3 {
  return new THREE.Vector3(x, h, -y);
}

/* ── table ─────────────────────────────────────────────────────────── */

function Table({ pockets, quality }: { pockets: boolean; quality: "high" | "low" }) {
  const felt = useMemo(() => feltTexture(), []);
  const wood = useMemo(() => woodTexture(), []);
  const cushionMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#13693a", roughness: 0.85 }), []);
  const woodMat = useMemo(() => new THREE.MeshStandardMaterial({ map: wood, roughness: 0.45, metalness: 0.05 }), [wood]);
  useEffect(
    () => () => {
      cushionMat.dispose();
      woodMat.dispose();
    },
    [cushionMat, woodMat],
  );
  // cushion segments between pocket mouths (carom tables have none)
  const rails = useMemo(() => {
    const out: { x: number; y: number; w: number; d: number }[] = [];
    const cg = pockets ? 1.15 : 0;
    const sg = pockets ? 0.85 : 0;
    for (const sy of [-1, 1]) {
      if (pockets) {
        const a = -HALF_W + cg;
        const b = -sg;
        out.push({ x: (a + b) / 2, y: sy * (HALF_H + RAIL_W / 2), w: b - a, d: RAIL_W });
        out.push({ x: -(a + b) / 2, y: sy * (HALF_H + RAIL_W / 2), w: b - a, d: RAIL_W });
      } else out.push({ x: 0, y: sy * (HALF_H + RAIL_W / 2), w: HALF_W * 2, d: RAIL_W });
    }
    for (const sx of [-1, 1]) out.push({ x: sx * (HALF_W + RAIL_W / 2), y: 0, w: RAIL_W, d: HALF_H * 2 - cg * 2 });
    return out;
  }, [pockets]);
  const seg = quality === "high" ? 24 : 12;
  const outerW = HALF_W + RAIL_W + FRAME_W;
  const outerH = HALF_H + RAIL_W + FRAME_W;
  return (
    <group>
      {/* cloth */}
      <mesh rotation-x={-Math.PI / 2} position-y={CLOTH_Y} receiveShadow>
        <planeGeometry args={[HALF_W * 2 + RAIL_W * 2, HALF_H * 2 + RAIL_W * 2]} />
        <meshStandardMaterial map={felt} roughness={0.92} />
      </mesh>
      {/* cushions */}
      {rails.map((r, i) => (
        <mesh key={i} position={[r.x, CUSHION_H / 2, -r.y]} material={cushionMat} castShadow receiveShadow>
          <boxGeometry args={[r.w, CUSHION_H, r.d]} />
        </mesh>
      ))}
      {/* wooden frame (four boards) */}
      {[
        { x: 0, y: outerH - FRAME_W / 2, w: outerW * 2, d: FRAME_W },
        { x: 0, y: -(outerH - FRAME_W / 2), w: outerW * 2, d: FRAME_W },
        { x: outerW - FRAME_W / 2, y: 0, w: FRAME_W, d: outerH * 2 - FRAME_W * 2 },
        { x: -(outerW - FRAME_W / 2), y: 0, w: FRAME_W, d: outerH * 2 - FRAME_W * 2 },
      ].map((b, i) => (
        <mesh key={`f${i}`} position={[b.x, 0.22, -b.y]} material={woodMat} castShadow receiveShadow>
          <boxGeometry args={[b.w, 0.62, b.d]} />
        </mesh>
      ))}
      {/* body + legs */}
      <mesh position={[0, -0.9, 0]} material={woodMat} castShadow>
        <boxGeometry args={[outerW * 2 - 0.6, 1.6, outerH * 2 - 0.6]} />
      </mesh>
      {[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([sx, sz]) => (
        <mesh key={`${sx}${sz}`} position={[sx * (outerW - 1.6), -3.6, sz * (outerH - 1.4)]} material={woodMat} castShadow>
          <cylinderGeometry args={[0.55, 0.45, 4, seg]} />
        </mesh>
      ))}
      {/* diamonds on the frame */}
      {[...Array(7)].flatMap((_, i) => {
        const x = -HALF_W + ((i + 1) * (HALF_W * 2)) / 8;
        return [1, -1].map((sy) => (
          <mesh key={`d${i}${sy}`} position={[x, 0.54, -sy * (outerH - FRAME_W / 2)]} rotation-x={-Math.PI / 2}>
            <circleGeometry args={[0.09, 4]} />
            <meshStandardMaterial color="#f3ead2" roughness={0.3} />
          </mesh>
        ));
      })}
      {/* pockets */}
      {pockets &&
        POCKETS.map((p, i) => (
          <group key={`p${i}`} position={[p.x, 0.0, -p.y]}>
            <mesh position-y={-0.3}>
              <cylinderGeometry args={[p.r * 1.02, p.r * 0.9, 0.62, seg]} />
              <meshStandardMaterial color="#060606" roughness={1} />
            </mesh>
            <mesh position-y={0.25} rotation-x={Math.PI / 2}>
              <torusGeometry args={[p.r * 1.05, 0.1, 8, seg]} />
              <meshStandardMaterial color="#1b1b1b" roughness={0.4} metalness={0.4} />
            </mesh>
          </group>
        ))}
      {/* floor */}
      <mesh rotation-x={-Math.PI / 2} position-y={-5.6} receiveShadow>
        <planeGeometry args={[140, 140]} />
        <meshStandardMaterial color="#2b1a14" roughness={0.9} />
      </mesh>
      {/* hanging lamp */}
      <group position={[0, 12, 0]}>
        <mesh>
          <boxGeometry args={[16, 0.5, 2.4]} />
          <meshStandardMaterial color="#14532d" roughness={0.5} metalness={0.3} />
        </mesh>
        <mesh position-y={-0.27}>
          <boxGeometry args={[15.4, 0.06, 2.0]} />
          <meshBasicMaterial color="#fff3cf" />
        </mesh>
      </group>
    </group>
  );
}

/* ── balls ─────────────────────────────────────────────────────────── */

function Balls(props: PoolSceneProps) {
  const { state, player } = props;
  const carom = !isPocket(state);
  const roster = useMemo(() => (carom ? rackCarom() : rackPocket(state.seed)), [carom, state.seed]);
  const meshes = useRef(new Map<number, THREE.Mesh>());
  const lastRoll = useRef(new Map<number, { rx: number; ry: number }>());
  const busyRef = useRef<boolean | null>(null);
  const cue = useRef<THREE.Group>(null);
  const guideRoot = useRef<THREE.Group>(null);
  const lines = useRef<{ main: THREE.Line; obj: THREE.Line; tan: THREE.Line } | null>(null);
  const ghost = useRef<THREE.Mesh>(null);
  const handRing = useRef<THREE.Mesh>(null);
  const lucky = useRef<THREE.Group>(null);
  const flashes = useRef<{ x: number; y: number; born: number; k: number }[]>([]);
  const flashMesh = useRef<THREE.Mesh>(null);
  const luckyTex = useMemo(() => luckyLabel(), []);

  useEffect(() => {
    const root = guideRoot.current;
    if (!root) return;
    const mk = (color: string, dash: number) => {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]);
      const mat = new THREE.LineDashedMaterial({ color, dashSize: dash, gapSize: dash * 0.7, transparent: true, opacity: 0.85 });
      const l = new THREE.Line(geo, mat);
      l.visible = false;
      root.add(l);
      return l;
    };
    const made = { main: mk("#fff6d8", 0.3), obj: mk("#ffd34d", 0.22), tan: mk("#9fe8ff", 0.18) };
    lines.current = made;
    return () => {
      for (const l of Object.values(made)) {
        root.remove(l);
        l.geometry.dispose();
        (l.material as THREE.Material).dispose();
      }
      lines.current = null;
    };
  }, []);

  useFrame((_, dtRaw) => {
    const t = nowMs();
    const view = player.sample(state, t, (e) => {
      if (e.kind === "clack" && e.impulse > 1.2) {
        flashes.current.push({ x: e.x, y: e.y, born: t, k: Math.min(1, e.impulse / 14) });
        camState.shake = Math.min(0.5, camState.shake + Math.min(0.25, e.impulse / 60));
      }
      props.onEvent(e);
    });
    if (busyRef.current !== view.busy) {
      busyRef.current = view.busy;
      props.onBusy(view.busy);
    }
    const a = props.aim.current;
    // a remote aim goes stale when its broadcasts stop; my own stays until I shoot
    const aimLive = !!a && a.turn === state.turn && (!a.remote || t - a.at < 2200) && !view.busy;
    const seen = new Set<number>();
    for (const b of view.balls) {
      const m = meshes.current.get(b.id);
      if (!m) continue;
      seen.add(b.id);
      let x = b.x;
      let y = b.y;
      // hand placement preview moves the cue ball
      if (b.id === CUE_ID && aimLive && a && !Number.isNaN(a.px)) {
        x = a.px;
        y = a.py;
      }
      m.visible = true;
      m.position.set(x, R + b.z, -y);
      m.scale.setScalar(Math.max(0.001, 1 - b.fade * 0.4));
      // rolling: rotate about (−dy, 0, −dx) by distance / R
      const prev = lastRoll.current.get(b.id) ?? { rx: b.rx, ry: b.ry };
      const ddx = b.rx - prev.rx;
      const ddy = b.ry - prev.ry;
      const d = Math.hypot(ddx, ddy);
      if (d > 1e-5 && d < 3) {
        const axis = new THREE.Vector3(-ddy, 0, -ddx).normalize();
        const q = new THREE.Quaternion().setFromAxisAngle(axis, d / R);
        m.quaternion.premultiply(q);
      }
      lastRoll.current.set(b.id, { rx: b.rx, ry: b.ry });
    }
    for (const [id, m] of meshes.current) if (!seen.has(id)) m.visible = false;

    // cue stick: following the live aim, or the replay's stroke
    const cg = cue.current;
    if (cg) {
      const stroke = view.stroke;
      const cueBall = view.balls.find((b) => b.id === CUE_ID);
      let show = false;
      if (stroke) {
        const k = stroke.k;
        const back = k < 0.7 ? (k / 0.7) * (0.4 + stroke.power * 2.2) : (1 - (k - 0.7) / 0.3) * (0.4 + stroke.power * 2.2) - 0.15;
        placeCue(cg, stroke.x, stroke.y, stroke.dirX, stroke.dirY, R + 0.15 + Math.max(-0.1, back));
        show = true;
      } else if (aimLive && a && cueBall) {
        const cx = Number.isNaN(a.px) ? cueBall.x : a.px;
        const cy = Number.isNaN(a.py) ? cueBall.y : a.py;
        placeCue(cg, cx, cy, a.dx, a.dy, R + 0.25 + a.power * 2.6);
        show = true;
      }
      cg.visible = show;
    }
    // ghost-ball guide
    const L = lines.current;
    if (L) {
      const g = aimLive && a ? aimGuide(state.balls, a, state.options.guide === "long") : null;
      const setLine = (l: THREE.Line, x0: number, y0: number, x1: number, y1: number) => {
        const pos = l.geometry.attributes.position as THREE.BufferAttribute;
        pos.setXYZ(0, x0, 0.04, -y0);
        pos.setXYZ(1, x1, 0.04, -y1);
        pos.needsUpdate = true;
        l.computeLineDistances();
        l.visible = true;
      };
      if (g) {
        setLine(L.main, g.cx, g.cy, g.ex, g.ey);
        if (g.hit && g.objLen > 0) setLine(L.obj, g.hit.x, g.hit.y, g.hit.x + g.hit.nx * g.objLen, g.hit.y + g.hit.ny * g.objLen);
        else L.obj.visible = false;
        if (g.hit && g.cueLen > 0) setLine(L.tan, g.ex, g.ey, g.ex + g.cueTx * g.cueLen, g.ey + g.cueTy * g.cueLen);
        else L.tan.visible = false;
      } else {
        L.main.visible = false;
        L.obj.visible = false;
        L.tan.visible = false;
      }
      const gh = ghost.current;
      if (gh) {
        gh.visible = !!g?.hit;
        if (g?.hit) gh.position.set(g.ex, R, -g.ey);
      }
    }
    // hand placement ring
    const hr = handRing.current;
    if (hr) {
      const cb = view.balls.find((b) => b.id === CUE_ID);
      hr.visible = props.placing && !view.busy && !!cb;
      if (hr.visible && cb) {
        const x = aimLive && a && !Number.isNaN(a.px) ? a.px : cb.x;
        const y = aimLive && a && !Number.isNaN(a.py) ? a.py : cb.y;
        hr.position.set(x, 0.02, -y);
        hr.scale.setScalar(R * (1.6 + Math.sin(t / 180) * 0.15));
      }
    }
    // lucky pocket glow
    const lg = lucky.current;
    if (lg) {
      const show = isPocket(state) && state.lucky >= 0 && state.phase === "aim";
      lg.visible = show;
      if (show) {
        const pk = POCKETS[state.lucky];
        lg.position.set(pk.x, 0.3, -pk.y);
        const s = 1 + Math.sin(t / 220) * 0.08;
        lg.scale.setScalar(s);
      }
    }
    // impact flash (one shared sprite, newest hit)
    flashes.current = flashes.current.filter((f) => t - f.born < 260);
    const fm = flashMesh.current;
    if (fm) {
      const f = flashes.current[flashes.current.length - 1];
      fm.visible = !!f && props.quality === "high";
      if (f) {
        const age = (t - f.born) / 260;
        fm.position.set(f.x, R, -f.y);
        fm.scale.setScalar(0.25 + age * (0.6 + f.k));
        (fm.material as THREE.MeshBasicMaterial).opacity = (1 - age) * 0.8;
      }
    }
    camState.shake = Math.max(0, camState.shake - Math.min(dtRaw, 0.05) * 2.4);
  });

  return (
    <group>
      {roster.map((b) => (
        <mesh
          key={b.id}
          ref={(m) => {
            if (m) meshes.current.set(b.id, m);
            else meshes.current.delete(b.id);
          }}
          geometry={ballGeo}
          visible={false}
          castShadow
        >
          <meshPhysicalMaterial map={ballTexture(b.id, carom)} roughness={0.12} clearcoat={1} clearcoatRoughness={0.08} />
        </mesh>
      ))}
      <group ref={cue} visible={false}>
        {/* cue stick lying along local +z (tip at the origin, butt toward +z) */}
        <mesh position={[0, 0, 4.2]} rotation-x={Math.PI / 2} castShadow>
          <cylinderGeometry args={[0.07, 0.13, 8.4, 16]} />
          <meshStandardMaterial color="#d9b27c" roughness={0.4} />
        </mesh>
        <mesh position={[0, 0, 7.4]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.125, 0.135, 2, 16]} />
          <meshStandardMaterial color="#2a160b" roughness={0.35} />
        </mesh>
        <mesh position={[0, 0, 0.04]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.068, 0.068, 0.08, 12]} />
          <meshStandardMaterial color="#3d6fd6" roughness={0.8} />
        </mesh>
      </group>
      <group ref={guideRoot} />
      <mesh ref={ghost} geometry={ballGeo} visible={false}>
        <meshBasicMaterial color="#ffffff" transparent opacity={0.28} depthWrite={false} />
      </mesh>
      <mesh ref={handRing} geometry={ringGeo} rotation-x={Math.PI / 2} visible={false}>
        <meshBasicMaterial color="#7cf3a0" transparent opacity={0.85} depthWrite={false} />
      </mesh>
      <group ref={lucky} visible={false}>
        <mesh rotation-x={Math.PI / 2}>
          <torusGeometry args={[1.15, 0.09, 8, 40]} />
          <meshBasicMaterial color="#ffd34d" transparent opacity={0.9} />
        </mesh>
        <sprite position={[0, 1.4, 0]} scale={[2.2, 1.1, 1]}>
          <spriteMaterial map={luckyTex} transparent depthWrite={false} />
        </sprite>
      </group>
      <mesh ref={flashMesh} visible={false}>
        <sphereGeometry args={[1, 12, 8]} />
        <meshBasicMaterial color="#fffbe8" transparent opacity={0.6} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** Lays the cue along −(dx, dy) from the ball, `gap` back from the cue ball centre, tilted a touch upward. */
function placeCue(g: THREE.Group, x: number, y: number, dx: number, dy: number, gap: number) {
  g.position.set(x - dx * gap, R * 1.05, -(y - dy * gap));
  // local +z points away from the ball → world direction (−dx, 0, +dy)
  const yaw = Math.atan2(-dx, dy);
  g.rotation.set(-0.08, yaw, 0, "YXZ");
}

/* ── input ─────────────────────────────────────────────────────────── */

function AimInput(props: PoolSceneProps) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const cb = useRef(props);
  useEffect(() => {
    cb.current = props;
  });
  useEffect(() => {
    const el = gl.domElement;
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -R);
    const hitP = new THREE.Vector3();
    const toTable = (cx: number, cy: number): { x: number; y: number } | null => {
      const r = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return ray.ray.intersectPlane(plane, hitP) ? { x: hitP.x, y: -hitP.z } : null;
    };
    let mode: "none" | "rotate" | "point" | "place" = "none";
    let lastX = 0;
    const cueSpot = () => {
      const p = cb.current;
      const a = p.aim.current;
      const cueBall = p.state.balls.find((b) => b.id === CUE_ID);
      if (!cueBall) return null;
      if (a && !Number.isNaN(a.px)) return { x: a.px, y: a.py };
      return { x: cueBall.x, y: cueBall.y };
    };
    const pointAt = (cx: number, cy: number) => {
      const p = toTable(cx, cy);
      const c = cueSpot();
      if (!p || !c) return;
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const l = Math.hypot(dx, dy);
      if (l > 0.2) cb.current.onAimDir(dx / l, dy / l);
    };
    const down = (e: PointerEvent) => {
      const p = cb.current;
      if (!p.canAim) return;
      const pt = toTable(e.clientX, e.clientY);
      const c = cueSpot();
      if (p.placing && pt && c && Math.hypot(pt.x - c.x, pt.y - c.y) < R * 2.6) mode = "place";
      else if (camState.aimView) mode = "rotate";
      else {
        mode = "point";
        pointAt(e.clientX, e.clientY);
      }
      lastX = e.clientX;
      el.setPointerCapture?.(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      const p = cb.current;
      if (mode === "none" || !p.canAim) return;
      if (mode === "place") {
        const pt = toTable(e.clientX, e.clientY);
        if (pt) p.onPlace(pt.x, pt.y);
      } else if (mode === "point") pointAt(e.clientX, e.clientY);
      else {
        const a = p.aim.current;
        if (!a) return;
        const w = el.clientWidth || 1;
        // full screen width ≈ 120°; slow near the start so small nudges are fine
        const dxPix = e.clientX - lastX;
        lastX = e.clientX;
        const ang = -(dxPix / w) * 2.1;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        p.onAimDir(a.dx * c - a.dy * s, a.dx * s + a.dy * c);
      }
    };
    const up = () => {
      mode = "none";
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    for (const ev of ["pointerup", "pointercancel", "pointerleave"] as const) el.addEventListener(ev, up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      for (const ev of ["pointerup", "pointercancel", "pointerleave"] as const) el.removeEventListener(ev, up);
    };
  }, [gl, camera]);
  return null;
}

/* ── camera ─────────────────────────────────────────────────────────── */

type Rig = { px: number; py: number; pz: number; lx: number; ly: number; lz: number; init: boolean; zoom: number };

function rigFrame(camera: THREE.Camera, size: { width: number; height: number }, props: PoolSceneProps, st: Rig, dtRaw: number) {
  const cam = camera as THREE.PerspectiveCamera;
  const dt = Math.min(dtRaw, 0.05);
  camState.aimView = !props.topView;
  const portrait = size.width / size.height < 0.9;
  const a = props.aim.current;
  const cueBall = props.state.balls.find((b) => b.id === CUE_ID);
  let want: { p: THREE.Vector3; l: THREE.Vector3; up: THREE.Vector3 };
  // nobody is aiming live (a bot's turn, or a shot rolling out): an overview of the whole table
  const live = !!a && a.turn === props.state.turn && (!a.remote || performance.now() - a.at < 2200);
  if (!props.topView && cueBall && !live) {
    want = portrait
      ? { p: new THREE.Vector3(0, 30 * st.zoom, 9 * st.zoom), l: new THREE.Vector3(0, 0, 0.5), up: new THREE.Vector3(1, 0, 0) }
      : { p: new THREE.Vector3(0, 19 * st.zoom, 16 * st.zoom), l: new THREE.Vector3(0, 0, 0.8), up: new THREE.Vector3(0, 1, 0) };
  } else if (props.topView || !cueBall) {
    const dist = portrait ? 34 : 27;
    want = { p: new THREE.Vector3(0, dist * st.zoom, portrait ? 0.01 : 6), l: new THREE.Vector3(0, 0, 0), up: portrait ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0) };
  } else {
    const dx = a ? a.dx : 1;
    const dy = a ? a.dy : 0;
    const cx = a && !Number.isNaN(a.px) ? a.px : cueBall.x;
    const cy = a && !Number.isNaN(a.py) ? a.py : cueBall.y;
    const back = (portrait ? 13 : 10.5) * st.zoom;
    const h = (portrait ? 8.5 : 6.4) * st.zoom;
    want = { p: T(cx - dx * back, cy - dy * back, h), l: T(cx + dx * 6, cy + dy * 6, 0), up: new THREE.Vector3(0, 1, 0) };
  }
  const k = st.init ? 1 - Math.exp(-dt * 5) : 1;
  st.init = true;
  st.px += (want.p.x - st.px) * k;
  st.py += (want.p.y - st.py) * k;
  st.pz += (want.p.z - st.pz) * k;
  st.lx += (want.l.x - st.lx) * k;
  st.ly += (want.l.y - st.ly) * k;
  st.lz += (want.l.z - st.lz) * k;
  const s = camState.shake;
  const jx = s > 0.01 ? (Math.random() - 0.5) * s * 0.25 : 0;
  const jy = s > 0.01 ? (Math.random() - 0.5) * s * 0.25 : 0;
  cam.up.copy(want.up);
  cam.position.set(st.px + jx, st.py + jy, st.pz);
  cam.lookAt(st.lx, st.ly, st.lz);
  const fov = portrait ? 52 : 42;
  if (Math.abs(cam.fov - fov) > 0.05) {
    cam.fov = fov;
    cam.updateProjectionMatrix();
  }
}

function CameraRig(props: PoolSceneProps) {
  const gl = useThree((s) => s.gl);
  const st = useRef<Rig>({ px: 0, py: 20, pz: 10, lx: 0, ly: 0, lz: 0, init: false, zoom: 1 });
  useEffect(() => {
    const el = gl.domElement;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      st.current.zoom = Math.max(0.6, Math.min(1.5, st.current.zoom * (1 + Math.sign(e.deltaY) * 0.08)));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [gl]);
  useFrame(({ camera, size }, dt) => rigFrame(camera, size, props, st.current, dt));
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

export default function PoolScene(props: PoolSceneProps) {
  const high = props.quality === "high";
  const pockets = isPocket(props.state);
  return (
    <Canvas shadows={high} dpr={high ? [1, 1.75] : 1} gl={{ antialias: high, powerPreference: "high-performance" }} camera={{ fov: 42, position: [0, 22, 10], near: 0.1, far: 200 }} style={{ touchAction: "none" }}>
      <color attach="background" args={["#140d0a"]} />
      <fog attach="fog" args={["#140d0a", 40, 110]} />
      <hemisphereLight args={["#fff4dc", "#24160f", 0.45]} />
      <ambientLight intensity={0.12} />
      <spotLight
        position={[0, 14, 0]}
        angle={0.95}
        penumbra={0.55}
        intensity={260}
        distance={40}
        decay={1.6}
        color="#fff1d0"
        castShadow={high}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0004}
      />
      <pointLight position={[-9, 9, 0]} intensity={30} distance={26} color="#ffe2a8" />
      <pointLight position={[9, 9, 0]} intensity={30} distance={26} color="#ffe2a8" />
      <Table pockets={pockets} quality={props.quality} />
      <Balls {...props} />
      <AimInput {...props} />
      <CameraRig {...props} />
      <FpsProbe onFps={props.onFps} />
    </Canvas>
  );
}
