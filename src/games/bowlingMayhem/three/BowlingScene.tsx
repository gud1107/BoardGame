"use client";

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { resolveLook } from "@/games/shared/three/SeatedPerson";
import { roomCharacterOf, useRoomCharacters } from "@/lib/character/roomCharacters";
import { currentSetup, LANE_MODS, type BowlingState, type Hazard, type LaneMod, type Seat } from "../engine";
import { ballPathPoints, DECK_Y, GUTTER_W, HALF_W, HEAD_Y, MAX_SLOPE, PIN_R, PIT_Y, RACK, SKID_Y, WALL_X, type LaneSetup } from "../physics";
import type { ReplayEvent, ReplayPlayer, ReplayView } from "../replay";
import { releaseFor, type LiveAim } from "../aim";
import Bowler, { bowlerRig, type BowlerPose } from "./Bowler";
import { approachTexture, ballTexture, laneTexture, oilTexture, PIN_PROFILE, pinTexture, signTexture, stripeTexture } from "./textures";
import { AdaptiveResolution } from "@/games/shared/three/sceneFx";

/**
 * 볼링 난장판 3D 볼링장 (rulebook §11). Display + input only — the replay
 * player (replay.ts) says where the ball and every pin are each frame.
 *
 * Lane coords (x across, y down the lane) map to three.js (x, 0, −y): the
 * foul line sits at z = 0, the pins around z = −18.3 … −19.1.
 * Input (§4): drag the ball along the foul line to move the release spot,
 * drag anywhere down the lane to aim at it.
 *
 * Lint rules this file follows (React Compiler, see alkkagi/Scene3D): no ref
 * reads during render, camera only touched inside useFrame.
 */

export interface SceneProps {
  state: BowlingState;
  player: ReplayPlayer;
  viewerSeat: Seat;
  /** The viewer may aim right now (their turn and the replay is idle). */
  canAim: boolean;
  aim: MutableRefObject<LiveAim | null>;
  /** Drag on the lane changed my release spot / direction. */
  onDraft: (patch: { x?: number; slope?: number }) => void;
  onEvent: (e: ReplayEvent) => void;
  onBusy: (busy: boolean) => void;
  names: Record<Seat, string>;
  /** 🔰 draw the whole predicted path while aiming. */
  helper: boolean;
  quality: "high" | "low";
  onFps?: (fps: number) => void;
}

const nowMs = () => performance.now();
const toZ = (y: number) => -y;

const pinGeo = new THREE.LatheGeometry(
  PIN_PROFILE.map(([r, h]) => new THREE.Vector2(r, h)),
  22,
);
const ballGeo = new THREE.SphereGeometry(1, 40, 24);

/** Shared between the event handler (writer) and the camera (reader). */
const camShake = { v: 0 };

interface Display {
  key: string;
  setup: LaneSetup;
  mod: LaneMod;
  hazards: Hazard[];
  seat: Seat;
}

function displayFor(state: BowlingState, view: ReplayView | null): Display {
  const rec = view?.rec;
  if (rec) return { key: `r${rec.turn}`, setup: rec.setup, mod: rec.mod, hazards: rec.hazards, seat: rec.seat };
  return { key: `i${state.turn}`, setup: currentSetup(state), mod: state.laneMods[state.frame] ?? "normal", hazards: state.active, seat: state.activeSeat };
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

const SPARK = [new THREE.Color("#fff6d0"), new THREE.Color("#ffd36b"), new THREE.Color("#ffffff")];
const CONFETTI = ["#ff4d6d", "#ffd23f", "#3bceac", "#5e60ce", "#ff9f1c", "#ffffff"].map((c) => new THREE.Color(c));

/* ── the alley (static) ────────────────────────────────────────────────── */

/** Decorative neighbour lanes (x offsets) with full racks. */
const NEIGHBOURS = [-3.6, -1.8, 1.8, 3.6];

function Alley({ display, quality }: { display: Display; quality: "high" | "low" }) {
  const lane = useMemo(() => laneTexture(), []);
  const approach = useMemo(() => approachTexture(), []);
  const pinTex = useMemo(() => pinTexture(), []);
  const ice = display.mod === "ice";
  const laneMat = useMemo(
    () => new THREE.MeshStandardMaterial({ map: lane, color: ice ? "#bfe8ff" : "#ffffff", roughness: ice ? 0.05 : 0.25, metalness: 0.05, emissive: ice ? "#1b4a6b" : "#000000" }),
    [lane, ice],
  );
  useEffect(() => () => laneMat.dispose(), [laneMat]);
  const sideLaneMat = useMemo(() => new THREE.MeshStandardMaterial({ map: lane, roughness: 0.3, color: "#b9a58c" }), [lane]);
  const gutterMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#2b2d36", roughness: 0.35, metalness: 0.5, side: THREE.DoubleSide }), []);
  const pinMat = useMemo(() => new THREE.MeshStandardMaterial({ map: pinTex, roughness: 0.3 }), [pinTex]);
  const instRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = instRef.current;
    if (!m) return;
    const mat = new THREE.Matrix4();
    let i = 0;
    for (const ox of NEIGHBOURS) for (const p of RACK) m.setMatrixAt(i++, mat.makeTranslation(ox + p.x, 0, toZ(p.y)));
    m.instanceMatrix.needsUpdate = true;
  }, []);
  const sign = useMemo(() => {
    const m = LANE_MODS[display.mod];
    return signTexture(display.mod === "normal" ? "BOWLING MAYHEM" : `${m.icon} ${m.name}`, display.mod === "normal" ? "#ff4fd8" : "#5ff2ff");
  }, [display.mod]);
  useEffect(() => () => sign.dispose(), [sign]);
  const segs = quality === "high" ? 18 : 10;
  const laneLen = PIT_Y;
  return (
    <group>
      {/* the lane */}
      <mesh position={[0, -0.02, toZ(laneLen / 2)]} material={laneMat} receiveShadow>
        <boxGeometry args={[HALF_W * 2, 0.04, laneLen]} />
      </mesh>
      {/* approach */}
      <mesh position={[0, -0.02, 2.6]} receiveShadow>
        <boxGeometry args={[2.2, 0.04, 5.2]} />
        <meshStandardMaterial map={approach} roughness={0.4} />
      </mesh>
      {/* gutters */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (HALF_W + GUTTER_W / 2), 0, toZ(laneLen / 2)]} rotation-x={-Math.PI / 2} material={gutterMat}>
          <cylinderGeometry args={[GUTTER_W / 2, GUTTER_W / 2, laneLen, segs, 1, true, Math.PI / 2, Math.PI]} />
        </mesh>
      ))}
      {/* capping between lanes */}
      {[-1, 1].map((s) => (
        <mesh key={`cap${s}`} position={[s * (WALL_X + 0.06), 0.01, toZ(laneLen / 2)]}>
          <boxGeometry args={[0.12, 0.05, laneLen]} />
          <meshStandardMaterial color="#1c1c24" roughness={0.5} />
        </mesh>
      ))}
      {/* kickback walls */}
      {[-1, 1].map((s) => (
        <mesh key={`kb${s}`} position={[s * (WALL_X + 0.04), 0.4, toZ((DECK_Y + PIT_Y) / 2)]} castShadow>
          <boxGeometry args={[0.08, 0.8, PIT_Y - DECK_Y]} />
          <meshStandardMaterial color="#14121c" roughness={0.6} />
        </mesh>
      ))}
      {/* pit + curtain */}
      <mesh position={[0, -0.35, toZ(PIT_Y + 0.45)]}>
        <boxGeometry args={[WALL_X * 2, 0.6, 0.9]} />
        <meshStandardMaterial color="#050508" roughness={1} />
      </mesh>
      <mesh position={[0, 0.5, toZ(PIT_Y + 0.95)]}>
        <planeGeometry args={[WALL_X * 2 + 0.2, 1.4]} />
        <meshStandardMaterial color="#0b0912" roughness={1} />
      </mesh>
      {/* masking unit + neon sign */}
      <mesh position={[0, 1.18, toZ(HEAD_Y - 0.3)]}>
        <boxGeometry args={[WALL_X * 2 + 0.3, 0.62, 0.12]} />
        <meshBasicMaterial map={sign} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.84, toZ(HEAD_Y - 0.28)]}>
        <boxGeometry args={[WALL_X * 2 + 0.3, 0.04, 0.14]} />
        <meshBasicMaterial color="#ff4fd8" toneMapped={false} />
      </mesh>
      {/* neighbour lanes */}
      {NEIGHBOURS.map((ox) => (
        <group key={ox} position={[ox, 0, 0]}>
          <mesh position={[0, -0.02, toZ(laneLen / 2)]} material={sideLaneMat}>
            <boxGeometry args={[HALF_W * 2, 0.04, laneLen]} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * (HALF_W + GUTTER_W / 2), 0, toZ(laneLen / 2)]} rotation-x={-Math.PI / 2} material={gutterMat}>
              <cylinderGeometry args={[GUTTER_W / 2, GUTTER_W / 2, laneLen, 8, 1, true, Math.PI / 2, Math.PI]} />
            </mesh>
          ))}
          <mesh position={[0, 1.18, toZ(HEAD_Y - 0.3)]}>
            <boxGeometry args={[WALL_X * 2 + 0.3, 0.62, 0.1]} />
            <meshStandardMaterial color="#1a1530" emissive="#2a1f55" />
          </mesh>
        </group>
      ))}
      <instancedMesh ref={instRef} args={[pinGeo, pinMat, NEIGHBOURS.length * 10]} />
      {/* floor, back wall, ceiling light strips */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.06, -8]} receiveShadow>
        <planeGeometry args={[40, 60]} />
        <meshStandardMaterial color="#141026" roughness={0.9} />
      </mesh>
      <mesh position={[0, 2.5, toZ(PIT_Y + 1.1)]}>
        <planeGeometry args={[40, 5]} />
        <meshStandardMaterial color="#0d0a1c" emissive="#160c33" />
      </mesh>
      {[-6, -2, 2, 6].map((x) => (
        <mesh key={x} position={[x, 3.4, -9]} rotation-x={Math.PI / 2}>
          <planeGeometry args={[0.12, 34]} />
          <meshBasicMaterial color={x < 0 ? "#5ff2ff" : "#ff4fd8"} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/* ── lane twists & hazards ─────────────────────────────────────────────── */

function Hazards({ display }: { display: Display }) {
  const oilTex = useMemo(() => oilTexture(), []);
  const stripes = useMemo(() => {
    const t = stripeTexture();
    t.repeat.set(60, 1);
    return t;
  }, []);
  const fanRef = useRef<THREE.Group>(null);
  const windRef = useRef<THREE.Points | null>(null);
  const windRoot = useRef<THREE.Group>(null);
  const s = display.setup;
  const fan = display.hazards.find((h) => h.kind === "fan");
  const wind = s.wind;
  useEffect(() => {
    const root = windRoot.current;
    if (!root || Math.abs(wind) < 1e-6) return;
    const n = 70;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 2.4;
      pos[i * 3 + 1] = 0.05 + Math.random() * 0.6;
      pos[i * 3 + 2] = -(1 + Math.random() * 17);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: "#dff6ff", size: 0.05, transparent: true, opacity: 0.6, depthWrite: false });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    root.add(pts);
    windRef.current = pts;
    return () => {
      root.remove(pts);
      geo.dispose();
      mat.dispose();
      windRef.current = null;
    };
  }, [wind]);
  useFrame((_, dtRaw) => {
    const dt = Math.min(0.05, dtRaw);
    if (fanRef.current) fanRef.current.rotation.z += dt * 18;
    const w = windRef.current;
    if (w) {
      const p = w.geometry.attributes.position as THREE.BufferAttribute;
      const arr = p.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] += dt * 3.2 * Math.sign(wind);
        if (arr[i] > 1.3) arr[i] = -1.3;
        if (arr[i] < -1.3) arr[i] = 1.3;
      }
      p.needsUpdate = true;
    }
  });
  return (
    <group>
      {s.bumpers &&
        [-1, 1].map((side) => (
          <mesh key={side} position={[side * (HALF_W + 0.035), 0.06, toZ(HEAD_Y / 2)]} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.045, 0.045, HEAD_Y - 0.8, 12]} />
            <meshStandardMaterial map={stripes} roughness={0.4} emissive="#330000" />
          </mesh>
        ))}
      {s.cones.map((c, i) => (
        <group key={`cone${i}`} position={[c.x, 0, toZ(c.y)]}>
          <mesh position-y={0.16} castShadow>
            <coneGeometry args={[c.r, 0.32, 16]} />
            <meshStandardMaterial color="#ff7a1a" roughness={0.5} emissive="#4a1800" />
          </mesh>
          <mesh position-y={0.15}>
            <cylinderGeometry args={[c.r * 0.55, c.r * 0.62, 0.05, 16]} />
            <meshStandardMaterial color="#ffffff" />
          </mesh>
          <mesh position-y={0.01}>
            <boxGeometry args={[c.r * 2.4, 0.02, c.r * 2.4]} />
            <meshStandardMaterial color="#ff7a1a" />
          </mesh>
        </group>
      ))}
      {s.oil && (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.003, toZ((s.oil.y0 + s.oil.y1) / 2)]}>
          <planeGeometry args={[HALF_W * 2, s.oil.y1 - s.oil.y0]} />
          <meshStandardMaterial map={oilTex} transparent roughness={0.02} metalness={0.6} depthWrite={false} />
        </mesh>
      )}
      {fan && (
        <group position={[(fan.dir ?? 1) > 0 ? -(WALL_X + 0.55) : WALL_X + 0.55, 0.55, toZ(9)]} rotation-y={(fan.dir ?? 1) > 0 ? Math.PI / 2 : -Math.PI / 2}>
          <mesh>
            <torusGeometry args={[0.42, 0.03, 8, 28]} />
            <meshStandardMaterial color="#9aa4b8" metalness={0.7} roughness={0.3} />
          </mesh>
          <group ref={fanRef}>
            {[0, 1, 2, 3].map((k) => (
              <mesh key={k} rotation-z={(k * Math.PI) / 2} position={[0, 0, 0.02]}>
                <boxGeometry args={[0.1, 0.72, 0.02]} />
                <meshStandardMaterial color="#5ff2ff" emissive="#0b4a55" />
              </mesh>
            ))}
          </group>
          <mesh position={[0, -0.35, 0]}>
            <cylinderGeometry args={[0.04, 0.12, 0.5, 10]} />
            <meshStandardMaterial color="#444b5a" />
          </mesh>
        </group>
      )}
      <group ref={windRoot} />
    </group>
  );
}

/* ── the dynamic world: ball, pins, aim, camera, fx ────────────────────── */

function World(props: SceneProps & { display: Display; setDisplay: (d: Display) => void; onBowler: (b: { seat: Seat; pose: BowlerPose; key: string }) => void }) {
  const { state, player, display } = props;
  const gl = useThree((s) => s.gl);
  const pinTexW = useMemo(() => pinTexture(), []);
  const pinTexF = useMemo(() => pinTexture("#f3dcff"), []);
  const pinMat = useMemo(() => new THREE.MeshStandardMaterial({ map: pinTexW, roughness: 0.28, metalness: 0.02 }), [pinTexW]);
  const pinMatF = useMemo(() => new THREE.MeshStandardMaterial({ map: pinTexF, roughness: 0.4, emissive: "#3a1a55", emissiveIntensity: 0.4 }), [pinTexF]);
  const ballMats = useMemo(() => Array.from({ length: 6 }, (_, s) => new THREE.MeshStandardMaterial({ map: ballTexture(s), roughness: 0.18, metalness: 0.15 })), []);
  const pinRefs = useRef(new Map<number, THREE.Group>());
  const ballRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const arrowRingRef = useRef<THREE.Mesh>(null);
  const lineRoot = useRef<THREE.Group>(null);
  const lines = useRef<{ aim: THREE.Line; path: THREE.Line } | null>(null);
  const fxRoot = useRef<THREE.Group>(null);
  const fx = useRef<{ sparks: Particles; confetti: Particles } | null>(null);
  const busyRef = useRef<boolean | null>(null);
  const lastKey = useRef("");
  const bowlerKey = useRef("");
  const cam = useRef({ pos: new THREE.Vector3(0, 1.95, 4.4), look: new THREE.Vector3(0, 0, -12), init: false });

  useEffect(() => {
    const root = lineRoot.current;
    if (!root) return;
    const mk = (color: string, dash: number, gap: number, opacity: number) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * 64), 3));
      geo.setDrawRange(0, 0);
      const mat = new THREE.LineDashedMaterial({ color, dashSize: dash, gapSize: gap, transparent: true, opacity, depthWrite: false });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      line.visible = false;
      root.add(line);
      return line;
    };
    const aim = mk("#fff3c4", 0.35, 0.25, 0.95);
    const path = mk("#5ff2ff", 0.2, 0.18, 0.75);
    lines.current = { aim, path };
    return () => {
      for (const l of [aim, path]) {
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
    const sparks = new Particles(220, 0.05, 6);
    const confetti = new Particles(360, 0.07, 3.2);
    root.add(sparks.points, confetti.points);
    fx.current = { sparks, confetti };
    return () => {
      root.remove(sparks.points, confetti.points);
      sparks.dispose();
      confetti.dispose();
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
    const d = displayFor(state, view);
    if (d.key !== lastKey.current) {
      lastKey.current = d.key;
      props.setDisplay(d);
    }

    // ---- events → fx
    for (const e of pending) {
      if (e.kind === "hit") {
        const k = Math.min(1, e.impulse / 14);
        if (e.ev === "pin") camShake.v = Math.min(0.9, camShake.v + 0.15 + k * 0.35);
        if (!low && k > 0.15) fx.current?.sparks.burst(e.x, 0.15, toZ(e.y), Math.round(4 + k * 14), 1.2 + k * 2.2, SPARK);
      } else if (e.kind === "settled") {
        const r = e.rec;
        if (r.strike) {
          fx.current?.confetti.burst(0, 0.9, toZ(HEAD_Y + 0.3), low ? 120 : 300, 2.6, CONFETTI, 1.4);
          camShake.v = Math.min(1, camShake.v + 0.3);
          player.hitStop(160);
        } else if (r.spare) fx.current?.confetti.burst(0, 0.7, toZ(HEAD_Y + 0.3), low ? 60 : 150, 2, CONFETTI, 1.1);
      } else if (e.kind === "cone" || e.kind === "bumper") camShake.v = Math.min(0.6, camShake.v + 0.15);
    }
    fx.current?.sparks.update(dt, 1.6);
    fx.current?.confetti.update(dt, 0.45);

    // ---- pins
    const setup = d.setup;
    const radial = setup.pinR / PIN_R;
    const tall = radial > 1.01 ? 1.2 : 1;
    const seen = new Set<number>();
    for (const pv of view.pins) {
      const g = pinRefs.current.get(pv.id);
      if (!g) continue;
      seen.add(pv.id);
      g.visible = pv.visible;
      const lift = pv.setter * 0.7;
      // tip over about the axis perpendicular to the fall direction, then lie a little raised
      const ax = new THREE.Vector3(-pv.dirY, 0, -pv.dirX);
      if (ax.lengthSq() < 1e-6) ax.set(1, 0, 0);
      ax.normalize();
      const qTip = new THREE.Quaternion().setFromAxisAngle(ax, pv.tip * (Math.PI / 2) * 0.97);
      const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), pv.yaw);
      g.quaternion.copy(qYaw.multiply(qTip));
      g.position.set(pv.x, lift - pv.drop + pv.tip * 0.055 * radial, toZ(pv.y));
      g.scale.set(radial, tall, radial);
      const mesh = g.children[0] as THREE.Mesh | undefined;
      if (mesh) mesh.material = d.mod === "featherPins" ? pinMatF : pinMat;
    }
    for (const [id, g] of pinRefs.current) if (!seen.has(id)) g.visible = false;

    // ---- the ball
    const a = props.aim.current;
    const aimLive = !!a && a.turn === state.turn && !view.busy && state.phase === "aim";
    const ball = ballRef.current;
    const br = setup.ballR;
    let ballX = aimLive && a ? a.x : 0;
    let ballY = 0;
    if (ball) {
      ball.material = ballMats[d.seat % ballMats.length];
      ball.scale.setScalar(br);
      if (view.rec && view.windup >= 0) {
        // carried through the swing, coming down onto the lane at the foul line
        const w = view.windup;
        const rel = view.rec.x / 1000;
        ballX = rel;
        const swing = w < 0.62 ? (w / 0.62) * Math.PI * 0.9 : Math.PI * 0.9 - ((w - 0.62) / 0.38) * Math.PI * 0.9;
        const zz = 0.35 + (1 - w) * 1.6 - Math.sin(swing) * 0.5;
        ball.position.set(rel, br + 0.45 - Math.cos(swing) * 0.38 + Math.max(0, swing - 2) * 0.15, zz);
        ball.visible = true;
        ball.rotation.set(0, 0, 0);
      } else if (view.ball && view.ball.visible) {
        ballX = view.ball.x;
        ballY = view.ball.y;
        ball.position.set(view.ball.x, br - view.ball.drop, toZ(view.ball.y));
        ball.rotation.set(-view.ball.roll, 0, 0);
        ball.visible = true;
      } else if (!view.busy && state.phase === "aim") {
        // waiting on the foul line where the bowler will release
        ball.position.set(ballX, br, 0.18);
        ball.rotation.set(0, t / 1400, 0);
        ball.visible = true;
      } else ball.visible = false;
    }
    const ring = ringRef.current;
    if (ring) {
      ring.visible = props.canAim && aimLive;
      ring.position.set(ballX, 0.012, 0.18);
      ring.scale.setScalar(br * (1.5 + Math.sin(t / 220) * 0.12));
    }

    // ---- aim line to the skid point + 🔰 path + the arrow being targeted
    const L = lines.current;
    if (L) {
      if (aimLive && a) {
        const pos = L.aim.geometry.attributes.position as THREE.BufferAttribute;
        const slope = Math.max(-MAX_SLOPE, Math.min(MAX_SLOPE, a.slope));
        pos.setXYZ(0, a.x, 0.02, 0.1);
        pos.setXYZ(1, a.x + slope * SKID_Y, 0.02, toZ(SKID_Y));
        pos.needsUpdate = true;
        L.aim.geometry.setDrawRange(0, 2);
        L.aim.computeLineDistances();
        L.aim.visible = true;
        const showPath = props.helper && (!a.remote || props.canAim);
        if (showPath) {
          const pts = ballPathPoints(setup, releaseFor(a, a.power >= 0 ? a.power : 0.6), HEAD_Y, 0.6);
          const pp = L.path.geometry.attributes.position as THREE.BufferAttribute;
          const n = Math.min(64, pts.length);
          for (let i = 0; i < n; i++) pp.setXYZ(i, pts[i][0], 0.025, toZ(pts[i][1]));
          pp.needsUpdate = true;
          L.path.geometry.setDrawRange(0, n);
          L.path.computeLineDistances();
          L.path.visible = true;
        } else L.path.visible = false;
        const ar = arrowRingRef.current;
        if (ar) {
          ar.visible = true;
          ar.position.set(a.x + slope * 4.6, 0.01, toZ(4.6));
          const pulse = 1 + Math.sin(t / 180) * 0.1;
          ar.scale.set(0.06 * pulse, 0.06 * pulse, 0.06 * pulse);
        }
      } else {
        L.aim.visible = false;
        L.path.visible = false;
        if (arrowRingRef.current) arrowRingRef.current.visible = false;
      }
    }

    // ---- bowler pose + position
    const bowlerSeat = view.rec ? view.rec.seat : state.activeSeat;
    let pose: BowlerPose = "ready";
    let key = `${bowlerSeat}:idle:${state.turn}`;
    if (view.rec) {
      const r = view.rec;
      if (r.foul) {
        pose = "slump";
        key = `${r.turn}:foul`;
      } else if (view.windup >= 0) {
        pose = "approach";
        key = `${r.turn}:app`;
      } else if (!view.settled) {
        pose = "follow";
        key = `${r.turn}:fol`;
      } else {
        pose = r.strike || r.spare ? "cheer" : r.down.length <= 3 ? "slump" : "follow";
        key = `${r.turn}:end`;
      }
      bowlerRig.progress = Math.max(0, view.windup);
      const rel = r.x / 1000;
      bowlerRig.from.set(rel - 0.3, 0, 2.25);
      bowlerRig.to.set(rel - 0.3, 0, 0.45);
    } else {
      if (state.phase === "ended") pose = "wait";
      bowlerRig.progress = 0;
      bowlerRig.from.set(ballX - 0.3, 0, 2.25);
      bowlerRig.to.set(ballX - 0.3, 0, 0.45);
    }
    if (key !== bowlerKey.current) {
      bowlerKey.current = key;
      props.onBowler({ seat: bowlerSeat, pose, key });
    }

    // ---- camera: behind the bowler → chasing the ball → on the pins
    const c = cam.current;
    const camera = frame.camera as THREE.PerspectiveCamera;
    const portrait = frame.size.width / frame.size.height < 0.9;
    const wantPos = new THREE.Vector3();
    const wantLook = new THREE.Vector3();
    let rate = 3.2;
    if (view.rec && view.rolling >= 0 && !view.settled && !view.rec.foul) {
      const by = Math.min(ballY, HEAD_Y - 4.2);
      wantPos.set(ballX * 0.55, 0.85 + Math.max(0, 6 - ballY) * 0.08, toZ(by - 2.6));
      wantLook.set(ballX * 0.7, 0.12, toZ(Math.min(HEAD_Y + 0.4, by + 5)));
      rate = 5;
      if (ballY > HEAD_Y - 6) {
        // close in on the deck as the ball arrives
        wantPos.set(0, 0.62, toZ(HEAD_Y - 3.3));
        wantLook.set(0, 0.12, toZ(HEAD_Y + 0.5));
        rate = 3;
      }
    } else if (view.rec && view.settled && !view.rec.foul) {
      wantPos.set(0, 0.68, toZ(HEAD_Y - 3.0));
      wantLook.set(0, 0.12, toZ(HEAD_Y + 0.5));
    } else {
      const w = view.windup >= 0 ? view.windup : 0;
      // over the bowler's right shoulder: the figure stands left of the ball, the lane stays clear
      wantPos.set(ballX + 0.42, (portrait ? 2.45 : 2.2) - w * 0.4, (portrait ? 5.0 : 4.3) - w * 1.5);
      wantLook.set(ballX * 0.3 + 0.05, 0.0, toZ(portrait ? 11 : 12));
    }
    if (!c.init) {
      c.init = true;
      c.pos.copy(wantPos);
      c.look.copy(wantLook);
    } else {
      const k = 1 - Math.exp(-dt * rate);
      c.pos.lerp(wantPos, k);
      c.look.lerp(wantLook, k);
    }
    const s = camShake.v;
    const jx = s > 0.01 ? (Math.random() - 0.5) * s * 0.06 : 0;
    const jy = s > 0.01 ? (Math.random() - 0.5) * s * 0.06 : 0;
    camera.position.set(c.pos.x + jx, c.pos.y + jy, c.pos.z);
    camera.lookAt(c.look);
    const fov = portrait ? 58 : 44;
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    camShake.v = Math.max(0, camShake.v - dt * 2.4);
  });

  /** §4 — drag the ball along the foul line, or drag down the lane to aim. */
  const startDrag = (e: ThreeEvent<PointerEvent>) => {
    if (!props.canAim) return;
    e.stopPropagation();
    const camera = e.camera;
    const el = gl.domElement;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const ray = new THREE.Raycaster();
    const hit = new THREE.Vector3();
    const toLane = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
      return ray.ray.intersectPlane(plane, hit) ? { x: hit.x, y: -hit.z } : null;
    };
    const first = toLane(e.nativeEvent.clientX, e.nativeEvent.clientY);
    if (!first) return;
    const mode: "x" | "aim" = first.y < 1.6 ? "x" : "aim";
    const lim = HALF_W - display.setup.ballR - 0.01;
    const apply = (p: { x: number; y: number }) => {
      if (mode === "x") props.onDraft({ x: Math.max(-lim, Math.min(lim, p.x)) });
      else {
        const cur = props.aim.current;
        const x0 = cur ? cur.x : 0;
        const y = Math.max(2, p.y);
        props.onDraft({ slope: Math.max(-MAX_SLOPE, Math.min(MAX_SLOPE, (p.x - x0) / y)) });
      }
    };
    apply(first);
    const move = (ev: PointerEvent) => {
      const p = toLane(ev.clientX, ev.clientY);
      if (p) apply(p);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  return (
    <group>
      {/* input plane over the lane + approach */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.001, toZ(PIT_Y / 2 - 1.5)]} onPointerDown={startDrag}>
        <planeGeometry args={[WALL_X * 2 + 0.6, PIT_Y + 3]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      {RACK.map((p) => (
        <group
          key={p.id}
          ref={(g) => {
            if (g) pinRefs.current.set(p.id, g);
            else pinRefs.current.delete(p.id);
          }}
          visible={false}
        >
          <mesh geometry={pinGeo} material={pinMat} castShadow />
        </group>
      ))}
      <mesh ref={ballRef} geometry={ballGeo} material={ballMats[0]} castShadow visible={false} />
      <mesh ref={ringRef} rotation-x={-Math.PI / 2} visible={false}>
        <ringGeometry args={[1, 1.18, 40]} />
        <meshBasicMaterial color="#ffd36b" transparent opacity={0.85} depthWrite={false} />
      </mesh>
      <mesh ref={arrowRingRef} rotation-x={-Math.PI / 2} visible={false}>
        <ringGeometry args={[0.7, 1, 32]} />
        <meshBasicMaterial color="#fff3c4" transparent opacity={0.9} depthWrite={false} />
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

function BowlerSlot({ seat, pose, poseKey, names, lowDetail }: { seat: Seat; pose: BowlerPose; poseKey: string; names: Record<Seat, string>; lowDetail: boolean }) {
  const chars = useRoomCharacters((st) => st.byName);
  const name = names[seat] ?? "";
  const look = useMemo(() => resolveLook(seat, ["none"], roomCharacterOf(chars, name)), [seat, chars, name]);
  return <Bowler key={seat} look={look} seed={seat * 11 + 3} pose={pose} poseKey={poseKey} lowDetail={lowDetail} />;
}

export default function BowlingScene(props: SceneProps) {
  const high = props.quality === "high";
  const [display, setDisplay] = useState<Display>(() => displayFor(props.state, null));
  const [bowler, setBowler] = useState<{ seat: Seat; pose: BowlerPose; key: string }>({ seat: props.state.activeSeat, pose: "ready", key: "init" });
  return (
    <Canvas shadows={high} dpr={high ? [1, 1.75] : [1, 1.5]} gl={{ antialias: high, powerPreference: "high-performance" }} camera={{ fov: 44, position: [0, 1.95, 4.4], near: 0.05, far: 90 }} style={{ touchAction: "none" }}>
      <color attach="background" args={["#0c0820"]} />
      <fog attach="fog" args={["#0c0820", 26, 60]} />
      <hemisphereLight args={["#f3e8ff", "#1a1030", 0.7]} />
      <ambientLight intensity={0.18} />
      <directionalLight
        position={[3, 9, 2]}
        intensity={1.3}
        color="#fff4e6"
        castShadow={high}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-3}
        shadow-camera-right={3}
        shadow-camera-top={4}
        shadow-camera-bottom={-24}
        shadow-camera-near={1}
        shadow-camera-far={40}
        shadow-bias={-0.0005}
      />
      <pointLight position={[0, 2.4, toZ(HEAD_Y - 1.2)]} intensity={9} distance={6} color="#ffffff" />
      <pointLight position={[-2.5, 2.4, -6]} intensity={6} distance={14} color="#ff4fd8" />
      <pointLight position={[2.5, 2.4, -12]} intensity={6} distance={14} color="#5ff2ff" />
      <pointLight position={[0, 2.2, 1.5]} intensity={3} distance={8} color="#ffe7c2" />
      <Alley display={display} quality={props.quality} />
      <Hazards display={display} />
      <World {...props} display={display} setDisplay={setDisplay} onBowler={setBowler} />
      <BowlerSlot seat={bowler.seat} pose={bowler.pose} poseKey={bowler.key} names={props.names} lowDetail={!high} />
      <FpsProbe onFps={props.onFps} />
      <AdaptiveResolution max={high ? 1.75 : 1.5} />
    </Canvas>
  );
}
