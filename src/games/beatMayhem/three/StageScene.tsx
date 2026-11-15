"use client";

import { useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { resolveLook, type PersonLook } from "@/games/shared/three/SeatedPerson";
import { roomCharacterOf, useRoomCharacters } from "@/lib/character/roomCharacters";
import { AdaptiveResolution } from "@/games/shared/three/sceneFx";
import VrmBody, { setBone, BODY, BODY_DROP } from "@/games/shared/three/VrmBody";
import { GOOD_MS, JUDGE_INFO, LANES, LANE_COLORS, SEAT_COLORS, type Judge, type PrankKind, type StyleId } from "../data";
import type { Song } from "../song";

/**
 * 박자 난장판 3D 무대 (룰북 §10): 멀리서 달려오는 노트 하이웨이(4줄) + 판정선 + 박자에 맞춰
 * 춤추는 VRM 라이벌들. 보드가 채워 주는 `StageShared`(곡 시각·맞힌 노트·내게 걸린 장난)를
 * 매 프레임 읽어 React 다시 그리기 없이 움직인다.
 */

export interface StageShared {
  song: Song | null;
  /** 지금 곡 시각 (ms, 판정 보정 반영) */
  time: () => number;
  /** 노트별 상태: 0 아직 · 1 맞힘 · 2 놓침 */
  hit: Uint8Array;
  /** 노트의 화면 줄 (뒤집기 장난 반영) */
  laneOf: (i: number) => number;
  /** 지금 내게 걸린 장난과 세기 0~1 */
  prank: { kind: PrankKind; k: number } | null;
  /** 노트가 보이기 시작해 판정선까지 걸리는 ms */
  lookahead: number;
  /** 줄별 마지막으로 누른 시각 (performance.now) */
  pressAt: number[];
  /** 최근 판정 효과 */
  bursts: { lane: number; judge: Judge; at: number }[];
  /** 자리별 춤 상태 */
  dancers: { seat: number; combo: number; pranked: boolean; lead: boolean; missAt: number }[];
  over: boolean;
  winnerSeats: number[];
}

export interface StageSceneProps {
  shared: MutableRefObject<StageShared>;
  names: Record<number, string>;
  seats: number[];
  style: StyleId;
  quality: "high" | "low";
  onFps?: (fps: number) => void;
}

const LANE_W = 1.15;
const LEN = 30;
const HIT_Z = 0;
const MAX_NOTES = 96;

const THEME: Record<StyleId, { bg: string; fog: string; floor: string; line: string; glow: string }> = {
  polka: { bg: "#3a1d5c", fog: "#3a1d5c", floor: "#241238", line: "#f9a8d4", glow: "#fde047" },
  city: { bg: "#0b1530", fog: "#0b1530", floor: "#0a1024", line: "#38bdf8", glow: "#a78bfa" },
  rush: { bg: "#2a0d12", fog: "#2a0d12", floor: "#1a080b", line: "#fb923c", glow: "#f43f5e" },
};

const laneX = (lane: number) => (lane - (LANES - 1) / 2) * LANE_W;

const m4 = new THREE.Matrix4();
const q0 = new THREE.Quaternion();
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();
const col = new THREE.Color();
const laneColors = LANE_COLORS.map((c) => new THREE.Color(c));

/* ── 하이웨이 ───────────────────────────────────────────────────────── */

function notesFrame(mesh: THREE.InstancedMesh | null, sh: StageShared, win: { from: number }) {
  if (!mesh) return;
  const song = sh.song;
  if (!song) {
    mesh.count = 0;
    return;
  }
  const t = sh.time();
  const rush = sh.prank?.kind === "rush" ? sh.prank.k : 0;
  const tiny = sh.prank?.kind === "tiny" ? sh.prank.k : 0;
  const look = sh.lookahead * (1 - 0.42 * rush);
  const notes = song.notes;
  // 창 시작을 앞으로만 민다 (곡이 바뀌면 처음부터)
  if (win.from > notes.length || (win.from > 0 && notes[win.from - 1].t > t + 500)) win.from = 0;
  while (win.from < notes.length && notes[win.from].t < t - GOOD_MS - 60) win.from++;
  let n = 0;
  for (let i = win.from; i < notes.length && n < MAX_NOTES; i++) {
    const note = notes[i];
    const dt = note.t - t;
    if (dt > look) break;
    if (sh.hit[i] === 1) continue;
    const z = HIT_Z - (dt / look) * LEN;
    const s = 1 - 0.6 * tiny;
    pos.set(laneX(sh.laneOf(i)), 0.12, z);
    scl.set(s, s, s);
    m4.compose(pos, q0, scl);
    mesh.setMatrixAt(n, m4);
    col.copy(laneColors[sh.laneOf(i)]);
    if (sh.hit[i] === 2) col.multiplyScalar(0.3);
    mesh.setColorAt(n, col);
    n++;
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function Notes({ shared }: { shared: MutableRefObject<StageShared> }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const win = useRef({ from: 0 });
  useFrame(() => notesFrame(mesh.current, shared.current, win.current));
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, MAX_NOTES]} frustumCulled={false}>
      <boxGeometry args={[LANE_W * 0.86, 0.2, 0.55]} />
      <meshStandardMaterial roughness={0.35} metalness={0.1} emissive="#ffffff" emissiveIntensity={0.12} />
    </instancedMesh>
  );
}

function trackFrame(g: THREE.Group | null, fog: THREE.Mesh | null, sway: THREE.Group | null, sh: StageShared, now: number) {
  if (g) {
    // 판정선 받침: 누르면 번쩍
    for (let l = 0; l < LANES; l++) {
      const m = g.children[l] as THREE.Mesh;
      const age = now - (sh.pressAt[l] ?? -1e9);
      const k = Math.max(0, 1 - age / 160);
      m.scale.set(1 + k * 0.12, 1 + k * 1.6, 1 + k * 0.12);
      (m.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.35 + k * 1.6;
    }
    // 박자선: 한 박마다 한 줄씩 다가온다
    const song = sh.song;
    const t = sh.time();
    for (let b = 0; b < 8; b++) {
      const line = g.children[LANES + b] as THREE.Mesh;
      if (!song) {
        line.visible = false;
        continue;
      }
      const beat = Math.floor(t / song.beatMs) + 1 + b;
      const dt = beat * song.beatMs - t;
      line.visible = dt <= sh.lookahead && beat >= 0;
      line.position.z = HIT_Z - (dt / sh.lookahead) * LEN;
      (line.material as THREE.MeshBasicMaterial).opacity = beat % 4 === 0 ? 0.5 : 0.16;
    }
  }
  if (fog) {
    const k = sh.prank?.kind === "fog" ? sh.prank.k : 0;
    fog.visible = k > 0.01;
    (fog.material as THREE.MeshBasicMaterial).opacity = 0.97 * k;
  }
  if (sway) {
    const k = sh.prank?.kind === "wobble" ? sh.prank.k : 0;
    sway.rotation.z = Math.sin(now * 0.0052) * 0.16 * k;
    sway.position.x = Math.sin(now * 0.0037) * 0.9 * k;
  }
}

function burstsFrame(g: THREE.Group | null, sh: StageShared, now: number) {
  if (!g) return;
  sh.bursts = sh.bursts.filter((b) => now - b.at < 380).slice(-g.children.length);
  g.children.forEach((c, i) => {
    const b = sh.bursts[i];
    const mesh = c as THREE.Mesh;
    if (!b) {
      mesh.visible = false;
      return;
    }
    const k = (now - b.at) / 380;
    mesh.visible = true;
    mesh.position.set(laneX(b.lane), 0.3 + k * 0.5, HIT_Z);
    mesh.scale.setScalar(0.5 + k * 1.6);
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.color.set(JUDGE_INFO[b.judge].color);
    mat.opacity = 0.9 * (1 - k);
  });
}

function Highway({ shared, theme }: { shared: MutableRefObject<StageShared>; theme: (typeof THEME)[StyleId] }) {
  const parts = useRef<THREE.Group>(null);
  const fog = useRef<THREE.Mesh>(null);
  const sway = useRef<THREE.Group>(null);
  const bursts = useRef<THREE.Group>(null);
  useFrame(() => {
    const now = performance.now();
    trackFrame(parts.current, fog.current, sway.current, shared.current, now);
    burstsFrame(bursts.current, shared.current, now);
  });
  const w = LANES * LANE_W;
  return (
    <group ref={sway}>
      {/* 바닥 */}
      <mesh position={[0, 0, HIT_Z - LEN / 2 + 1]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[w + 0.3, LEN + 2]} />
        <meshStandardMaterial color={theme.floor} roughness={0.5} metalness={0.3} />
      </mesh>
      {/* 줄 경계선 */}
      {Array.from({ length: LANES + 1 }, (_, i) => (
        <mesh key={i} position={[(i - LANES / 2) * LANE_W, 0.012, HIT_Z - LEN / 2 + 1]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[i === 0 || i === LANES ? 0.07 : 0.03, LEN + 2]} />
          <meshBasicMaterial color={theme.line} transparent opacity={i === 0 || i === LANES ? 0.9 : 0.35} />
        </mesh>
      ))}
      {/* 판정선 */}
      <mesh position={[0, 0.02, HIT_Z]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[w, 0.16]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <group ref={parts}>
        {Array.from({ length: LANES }, (_, l) => (
          <mesh key={l} position={[laneX(l), 0.05, HIT_Z]}>
            <boxGeometry args={[LANE_W * 0.9, 0.08, 0.7]} />
            <meshStandardMaterial color={LANE_COLORS[l]} emissive={LANE_COLORS[l]} emissiveIntensity={0.35} transparent opacity={0.55} />
          </mesh>
        ))}
        {Array.from({ length: 8 }, (_, b) => (
          <mesh key={`b${b}`} position={[0, 0.014, 0]} rotation-x={-Math.PI / 2} visible={false}>
            <planeGeometry args={[w, 0.05]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.2} />
          </mesh>
        ))}
      </group>
      <Notes shared={shared} />
      {/* 안개 장난: 먼 쪽 70%를 가린다 */}
      <mesh ref={fog} position={[0, 0.9, HIT_Z - LEN * 0.3 - (LEN * 0.7) / 2]} visible={false}>
        <boxGeometry args={[w + 1.2, 1.8, LEN * 0.7]} />
        <meshBasicMaterial color="#cbd5e1" transparent opacity={0.9} depthWrite={false} />
      </mesh>
      <group ref={bursts}>
        {Array.from({ length: 8 }, (_, i) => (
          <mesh key={i} rotation-x={-Math.PI / 2.4} visible={false}>
            <ringGeometry args={[0.32, 0.46, 24]} />
            <meshBasicMaterial transparent opacity={0.8} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/* ── 무대 장식 (박자에 맞춰 뛰는 기둥) ──────────────────────────────── */

function pillarsFrame(g: THREE.Group | null, sh: StageShared) {
  if (!g) return;
  const song = sh.song;
  const t = sh.time();
  const phase = song && t >= 0 ? (t % song.beatMs) / song.beatMs : 1;
  const pulse = Math.max(0, 1 - phase * 2.2);
  g.children.forEach((c, i) => {
    const h = 1 + pulse * (0.5 + ((i * 7) % 5) * 0.14);
    c.scale.y = h;
    c.position.y = (h * 2.4) / 2;
  });
}

function Pillars({ shared, theme, count }: { shared: MutableRefObject<StageShared>; theme: (typeof THEME)[StyleId]; count: number }) {
  const g = useRef<THREE.Group>(null);
  useFrame(() => pillarsFrame(g.current, shared.current));
  return (
    <group ref={g}>
      {Array.from({ length: count }, (_, i) => {
        const side = i % 2 === 0 ? -1 : 1;
        const row = Math.floor(i / 2);
        return (
          <mesh key={i} position={[side * (8.5 + (row % 2) * 1.6), 1.2, -6 - row * 4.2]}>
            <boxGeometry args={[0.7, 2.4, 0.7]} />
            <meshStandardMaterial color={i % 4 < 2 ? theme.line : theme.glow} emissive={i % 4 < 2 ? theme.line : theme.glow} emissiveIntensity={0.55} roughness={0.4} />
          </mesh>
        );
      })}
    </group>
  );
}

/* ── 춤추는 라이벌 ──────────────────────────────────────────────────── */

type DanceMode = "groove" | "hype" | "dizzy" | "cheer" | "sad" | "idle";

function Dancer({ look, seed, color, lowDetail, read, x, z }: { look: PersonLook; seed: number; color: string; lowDetail: boolean; read: () => { mode: DanceMode; beat: number }; x: number; z: number }) {
  const mode = useRef<DanceMode>("idle");
  const pose = (o: Float32Array, t: number) => {
    const f = read();
    mode.current = f.mode;
    const ph = f.beat * Math.PI * 2;
    const bounce = Math.max(0, Math.sin(ph));
    switch (f.mode) {
      case "groove": {
        const w = Math.sin(ph / 2 + seed);
        setBone(o, "rightUpperArm", -0.9 + w * 0.5, 0, -0.5);
        setBone(o, "leftUpperArm", -0.9 - w * 0.5, 0, 0.5);
        setBone(o, "rightLowerArm", -1.1);
        setBone(o, "leftLowerArm", -1.1);
        o[BODY.spine + 2] += w * 0.1;
        o[BODY.spine + 1] += w * 0.25;
        o[BODY_DROP] += bounce * 0.045;
        break;
      }
      case "hype": {
        const w = Math.sin(ph + seed);
        setBone(o, "rightUpperArm", -2.5 + w * 0.5, 0, -0.4);
        setBone(o, "leftUpperArm", -2.5 - w * 0.5, 0, 0.4);
        setBone(o, "rightLowerArm", -0.6);
        setBone(o, "leftLowerArm", -0.6);
        setBone(o, "rightUpperLeg", -0.3 * bounce);
        setBone(o, "rightLowerLeg", 0.5 * bounce);
        o[BODY.spine + 1] += w * 0.3;
        o[BODY_DROP] += bounce * 0.07 - 0.02;
        break;
      }
      case "dizzy": {
        const w = Math.sin(t * 13);
        setBone(o, "rightUpperArm", -0.7, 0, -1.0 + w * 0.25);
        setBone(o, "leftUpperArm", -0.7, 0, 1.0 - w * 0.25);
        o[BODY.head + 2] += w * 0.35;
        o[BODY.spine + 2] += Math.sin(t * 6.5) * 0.2;
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
    const m = mode.current;
    if (m === "dizzy") return { surprised: 1 };
    if (m === "cheer" || m === "hype") return { happy: 1 };
    if (m === "sad") return { sad: 0.8 };
    return { happy: 0.3 };
  };
  return (
    <group position={[x, 0, z]} rotation-y={x < 0 ? 0.35 : -0.35}>
      {/* 자리 색 받침 */}
      <mesh position={[0, 0.06, 0]}>
        <cylinderGeometry args={[0.75, 0.85, 0.12, 20]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} roughness={0.5} />
      </mesh>
      <group position={[0, 0.12, 0]}>
        <VrmBody
          look={look}
          seed={seed}
          headY={1.5}
          pose={pose}
          face={face}
          lowDetail={lowDetail}
          follow={18}
          fallback={
            <mesh position={[0, 0.8, 0]} scale={[0.35, 0.8, 0.3]}>
              <sphereGeometry args={[1, 14, 10]} />
              <meshBasicMaterial color={color} transparent opacity={0.45} />
            </mesh>
          }
        />
      </group>
    </group>
  );
}

function DancerSlot({ seat, slot, names, shared, lowDetail }: { seat: number; slot: number; names: Record<number, string>; shared: MutableRefObject<StageShared>; lowDetail: boolean }) {
  const chars = useRoomCharacters((st) => st.byName);
  const name = names[seat] ?? "";
  const look = useMemo(() => resolveLook(seat, ["none"], roomCharacterOf(chars, name)), [seat, chars, name]);
  const out = useRef<{ mode: DanceMode; beat: number }>({ mode: "idle", beat: 0 });
  const read = () => {
    const sh = shared.current;
    const d = sh.dancers.find((x) => x.seat === seat);
    const song = sh.song;
    const t = sh.time();
    const o = out.current;
    o.beat = song && t >= 0 ? t / song.beatMs : 0;
    if (!d) o.mode = "idle";
    else if (sh.over) o.mode = sh.winnerSeats.includes(seat) ? "cheer" : "sad";
    else if (!song || t < 0 || t > song.lengthMs) o.mode = "idle";
    else if (d.pranked || performance.now() - d.missAt < 700) o.mode = "dizzy";
    else o.mode = d.combo >= 30 ? "hype" : "groove";
    return o;
  };
  const side = slot % 2 === 0 ? -1 : 1;
  const row = Math.floor(slot / 2);
  return <Dancer look={look} seed={seat * 13 + 3} color={SEAT_COLORS[seat % 8]} lowDetail={lowDetail} read={read} x={side * (4.4 + row * 0.5)} z={-5.5 - row * 4.6} />;
}

/* ── 카메라 ─────────────────────────────────────────────────────────── */

function rigFrame(camera: THREE.Camera, size: { width: number; height: number }) {
  const aspect = size.width / Math.max(1, size.height);
  // 세로 화면에선 더 높이·가까이서 내려다봐 하이웨이가 화면을 채우게
  const narrow = Math.max(0, Math.min(1, (1.25 - aspect) / 0.75));
  camera.position.set(0, 4.3 + narrow * 4.2, 5.6 + narrow * 1.2);
  camera.lookAt(0, 0.2, -7.5 + narrow * 2.5);
}

function CameraRig() {
  useFrame(({ camera, size }) => rigFrame(camera, size));
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

export default function StageScene({ shared, names, seats, style, quality, onFps }: StageSceneProps) {
  const high = quality === "high";
  const theme = THEME[style];
  const bg = useMemo(() => new THREE.Color(theme.bg), [theme]);
  // 화면에 세우는 춤꾼 수 (낮은 화질에선 2명만)
  const shown = seats.slice(0, high ? 6 : 2);
  return (
    <Canvas dpr={high ? [1, 1.75] : [1, 1.5]} gl={{ antialias: high, powerPreference: "high-performance" }} camera={{ fov: 52, position: [0, 4.3, 5.6], near: 0.1, far: 200 }} style={{ touchAction: "none" }}>
      <color attach="background" args={[bg]} />
      <fog attach="fog" args={[theme.fog, 24, 60]} />
      <hemisphereLight args={["#ffffff", theme.floor, 0.9]} />
      <directionalLight position={[4, 10, 8]} intensity={1.1} />
      <pointLight position={[0, 3, -2]} intensity={12} color={theme.glow} distance={18} />
      {/* 무대 바닥 */}
      <mesh position={[0, -0.05, -14]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[80, 70]} />
        <meshStandardMaterial color={theme.bg} roughness={0.9} />
      </mesh>
      <Highway shared={shared} theme={theme} />
      <Pillars shared={shared} theme={theme} count={high ? 12 : 6} />
      {shown.map((seat, i) => (
        <DancerSlot key={seat} seat={seat} slot={i} names={names} shared={shared} lowDetail={!high} />
      ))}
      <CameraRig />
      <FpsProbe onFps={onFps} />
      <AdaptiveResolution max={high ? 1.75 : 1.5} />
    </Canvas>
  );
}
