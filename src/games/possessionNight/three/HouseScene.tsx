"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { resolveLook } from "@/games/shared/three/SeatedPerson";
import { roomCharacterOf, useRoomCharacters } from "@/lib/character/roomCharacters";
import VrmBody, { addCrouch, addWalk, setBone, BODY, BODY_DROP } from "@/games/shared/three/VrmBody";
import { EYE, GHOST_COLOR, GHOST_EYE, SEAT_COLORS, WARD_R } from "../data";
import { stepLocal, syncLocal, type LocalBody } from "../localBody";
import { BRAZIER, CELL, CELLS, COLS, CONTAINERS, FURNITURE, KIND, LANTERNS, ROOM, ROOM_NAMES, ROWS, WORLD_D, WORLD_W, cellX, cellZ, colOf, idx, rowOf } from "../map";
import { ghostKnown, type SnapBuffer } from "../net";
import { isCurse, type MatchState } from "../sim";
import { ceilingTexture, floorTexture, groundTexture, labelTexture, nameTexture, wallTexture, wardrobeTexture } from "./textures";

/**
 * 빙의의 밤 3D 무대 (룰북 §10): 1인칭. 달빛 마당을 ㅁ자 고택이 두르고, 방마다 꺼진 등잔이 하나씩 있다.
 *
 * - 🧿 퇴마사 화면: 내 손전등 + 켜진 등잔 + 화로 불빛뿐. 원귀는 스냅샷에 좌표가 실렸을 때(현신·성수·그림자)만
 *   반투명한 VRM으로 보인다 — 그 밖엔 화면에 아예 없다(데이터도 없다).
 * - 👻 원귀 화면: 파르스름한 밤눈(주변광이 밝고 안개가 옅다). 퇴마사는 공포만큼 붉게 빛나는 표식이 붙고,
 *   저주받은 물건이 든 수납은 붉은 기운이 새어 나온다(원귀는 안다).
 */

export interface SceneShared {
  buf: SnapBuffer;
  local: LocalBody;
  mySeat: number;
  /** 놀람 연출 줄이기 */
  calm: boolean;
  /** 최근 연출 (덜컹·성수·현신·태움) */
  fx: { slam: { x: number; z: number; at: number } | null; water: { x: number; z: number; at: number } | null; burn: number; manifest: number };
}

const WALL_H = 2.8;
const WARDROBE_H = 1.9;

type Quality = "high" | "low";

const isGhostView = (snap: MatchState, seat: number) => snap.players[seat]?.role === "ghost";

/* ── 카메라 + 손전등 ─────────────────────────────────────────────────── */

interface Rig {
  ly: number;
  lp: number;
  fov: number;
  eye: number;
  roll: number;
}

const fwd = new THREE.Vector3();

function rigFrame(cam: THREE.PerspectiveCamera, sh: SceneShared, rig: Rig, spot: THREE.SpotLight | null, vm: THREE.Group | null, glow: THREE.PointLight | null, amb: THREE.AmbientLight | null, scene: THREE.Scene, dtRaw: number, t: number) {
  const dt = Math.min(0.05, dtRaw);
  const snap = sh.buf.latest();
  if (!snap) return;
  const now = performance.now();
  const b = sh.local;
  syncLocal(b, snap, sh.mySeat);
  stepLocal(b, snap, sh.mySeat, dt, now);
  const me = snap.players[sh.mySeat];
  if (!me) return;
  const ghost = me.role === "ghost";
  let eyeWant = ghost ? GHOST_EYE : EYE;
  let rollWant = 0;
  if (!ghost && me.st === "possessed") {
    eyeWant = 0.55;
    rollWant = 0.5;
  }
  // 빙의 연출: 원귀 쪽으로 고개가 홱 돌아간다
  if (now < b.scareUntil && b.scareAt) {
    const want = Math.atan2(-(b.scareAt.x - b.x), -(b.scareAt.z - b.z));
    let d = want - b.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    b.yaw += d * Math.min(1, dt * 14);
    b.pitch += (0.05 - b.pitch) * Math.min(1, dt * 14);
  }
  rig.eye += (eyeWant - rig.eye) * Math.min(1, dt * 5);
  rig.roll += (rollWant - rig.roll) * Math.min(1, dt * 4);
  b.shake = Math.max(0, b.shake - dt * 1.6);
  // 덜컹이 가까우면 화면이 흔들린다
  const sl = sh.fx.slam;
  if (sl && now - sl.at < 60 && Math.hypot(sl.x - b.x, sl.z - b.z) < 8) b.shake = Math.max(b.shake, 0.5);
  const sh2 = b.shake * (sh.calm ? 0.25 : 1) * 0.08;
  const alive = me.st === "alive";
  const bobY = ghost ? Math.sin(t * 1.3) * 0.05 : alive ? Math.sin(b.bob * Math.PI) * (b.mv === 3 ? 0.05 : 0.026) : 0;
  const bobX = !ghost && alive ? Math.cos(b.bob * Math.PI * 0.5) * 0.012 : 0;
  cam.position.set(b.x + Math.sin(t * 61) * sh2 + bobX * Math.cos(b.yaw), rig.eye + bobY + Math.sin(t * 73) * sh2, b.z + Math.cos(t * 67) * sh2 - bobX * Math.sin(b.yaw));
  cam.rotation.set(b.pitch, b.yaw, rig.roll, "YXZ");
  const panic = !ghost && me.panic;
  const fovWant = ghost ? 80 : 72 + (b.mv === 3 ? 5 : 0) + (panic ? Math.sin(t * 5) * 3 : 0);
  rig.fov += (fovWant - rig.fov) * Math.min(1, dt * 6);
  if (Math.abs(cam.fov - rig.fov) > 0.05) {
    cam.fov = rig.fov;
    cam.updateProjectionMatrix();
  }

  let dy = b.yaw - rig.ly;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  rig.ly += dy * Math.min(1, dt * 16);
  rig.lp += (b.pitch - rig.lp) * Math.min(1, dt * 16);
  const snuffed = snap.t < me.lightOffUntil;
  const lightOn = !ghost && alive && b.light && me.battery > 0 && !snuffed;
  if (spot) {
    const cp = Math.cos(rig.lp);
    fwd.set(-Math.sin(rig.ly) * cp, Math.sin(rig.lp), -Math.cos(rig.ly) * cp);
    spot.position.set(cam.position.x + Math.cos(b.yaw) * 0.16, cam.position.y - 0.14, cam.position.z - Math.sin(b.yaw) * 0.16);
    spot.target.position.set(spot.position.x + fwd.x * 6, spot.position.y + fwd.y * 6, spot.position.z + fwd.z * 6);
    spot.target.updateMatrixWorld();
    const weak = me.battery < 15 ? (Math.sin(t * 31) * Math.sin(t * 7.3) > 0.25 ? 0.25 : 1) * (0.45 + me.battery / 27) : 1;
    // 공황이면 손전등이 덜덜 떨리며 깜빡인다
    const shaky = panic && Math.sin(t * 41) * Math.sin(t * 9.7) > 0.5 ? 0.2 : 1;
    spot.intensity = lightOn ? 22 * weak * shaky : 0;
  }
  if (glow) {
    glow.position.copy(cam.position);
    glow.intensity = ghost ? 0 : lightOn ? 0.35 : 0.55;
  }
  if (amb) amb.intensity = ghost ? 0.85 : 0.05;
  const fog = scene.fog as THREE.FogExp2 | null;
  if (fog) {
    fog.density = ghost ? 0.022 : 0.055;
    fog.color.set(ghost ? "#0b1a26" : "#030406");
  }
  if (vm) {
    vm.visible = !ghost && alive;
    vm.position.copy(cam.position);
    vm.rotation.set(rig.lp, rig.ly, 0, "YXZ");
  }
}

function CameraRig({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const scene = useThree((s) => s.scene);
  const spot = useRef<THREE.SpotLight>(null);
  const vm = useRef<THREE.Group>(null);
  const glow = useRef<THREE.PointLight>(null);
  const amb = useRef<THREE.AmbientLight>(null);
  const rig = useRef<Rig>({ ly: 0, lp: 0, fov: 72, eye: EYE, roll: 0 });
  useEffect(() => {
    const s = spot.current;
    if (!s) return;
    scene.add(s.target);
    return () => {
      scene.remove(s.target);
    };
  }, [scene]);
  useFrame((st, dt) => rigFrame(camera, shared.current, rig.current, spot.current, vm.current, glow.current, amb.current, scene, dt, st.clock.elapsedTime));
  return (
    <>
      <ambientLight ref={amb} intensity={0.05} color="#8fb6d8" />
      <spotLight ref={spot} color="#fff1d6" angle={0.55} penumbra={0.8} distance={30} decay={1.25} intensity={0} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} shadow-bias={-0.0006} shadow-camera-near={0.3} shadow-camera-far={26} />
      <pointLight ref={glow} color="#6f86a8" intensity={0.5} distance={7} decay={1.5} />
      <group ref={vm}>
        <group position={[0.2, -0.19, -0.4]} rotation={[0.1, 0.16, 0]} scale={0.62}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.024, 0.02, 0.2, 10]} />
            <meshBasicMaterial color="#101214" />
          </mesh>
          <mesh position={[0, 0, -0.12]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.036, 0.026, 0.06, 12]} />
            <meshBasicMaterial color="#1c2024" />
          </mesh>
        </group>
      </group>
    </>
  );
}

/* ── 고정 구조물 ─────────────────────────────────────────────────────── */

const m4 = new THREE.Matrix4();
const q4 = new THREE.Quaternion();
const v4 = new THREE.Vector3();
const s4 = new THREE.Vector3(1, 1, 1);

const WALL_CELLS: number[] = [];
const WARDROBE_CELLS: number[][] = [[], [], []];
const JAR_CELLS: number[] = [];
let WELL_CELL = -1;
let ALTAR_CELL = -1;
const MARU_CELLS: number[] = [];
const ONDOL_CELLS: number[] = [];
const ROOF_CELLS: number[] = [];
for (let i = 0; i < CELLS; i++) {
  const k = KIND[i];
  const c = colOf(i);
  const r = rowOf(i);
  const room = ROOM[i];
  if (k === 4) {
    // P(사당 제상)는 따로 그린다
    if (room === "p" && c === 21 && r === 21) ALTAR_CELL = i;
    else WARDROBE_CELLS[(c * 7 + r * 3) % 3].push(i);
  }
  if (k === 5) {
    if (c === 9 && r === 13) WELL_CELL = i;
    else JAR_CELLS.push(i);
  }
  if (k !== 0) {
    if (room === "." || room === "+" || room === "d") MARU_CELLS.push(i);
    else if (room !== "m" && room !== "#") ONDOL_CELLS.push(i);
    if (room !== "m" && KIND[i] !== 6 && !(k === 5)) ROOF_CELLS.push(i);
    continue;
  }
  let edge = false;
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const nc = c + dc;
    const nr = r + dr;
    if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
    if (KIND[idx(nc, nr)] !== 0) edge = true;
  }
  if (edge) WALL_CELLS.push(i);
}

function useInstanced(ref: MutableRefObject<THREE.InstancedMesh | null>, cells: number[], y: number, rotX = 0) {
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    cells.forEach((cell, i) => {
      q4.setFromEuler(new THREE.Euler(rotX, 0, 0));
      v4.set(cellX(colOf(cell)), y, cellZ(rowOf(cell)));
      m4.compose(v4, q4, s4);
      m.setMatrixAt(i, m4);
    });
    m.instanceMatrix.needsUpdate = true;
  }, [ref, cells, y, rotX]);
}

function Wardrobes({ cells, seed, high }: { cells: number[]; seed: number; high: boolean }) {
  const tex = useMemo(() => wardrobeTexture(seed + 3), [seed]);
  useEffect(() => () => tex.dispose(), [tex]);
  const ref = useRef<THREE.InstancedMesh>(null);
  useInstanced(ref, cells, WARDROBE_H / 2);
  if (!cells.length) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, cells.length]} castShadow={high} receiveShadow={high} frustumCulled={false}>
      <boxGeometry args={[CELL - 0.3, WARDROBE_H, CELL - 0.3]} />
      <meshStandardMaterial map={tex} roughness={0.55} />
    </instancedMesh>
  );
}

function Structure({ quality }: { quality: Quality }) {
  const wallTex = useMemo(() => wallTexture(), []);
  const maruTex = useMemo(() => floorTexture("maru"), []);
  const ondolTex = useMemo(() => floorTexture("ondol"), []);
  const groundTex = useMemo(() => {
    const t = groundTexture();
    t.repeat.set(COLS / 2, ROWS / 2);
    return t;
  }, []);
  const ceilTex = useMemo(() => ceilingTexture(), []);
  useEffect(
    () => () => {
      for (const t of [wallTex, maruTex, ondolTex, groundTex, ceilTex]) t.dispose();
    },
    [wallTex, maruTex, ondolTex, groundTex, ceilTex],
  );
  const walls = useRef<THREE.InstancedMesh>(null);
  const maru = useRef<THREE.InstancedMesh>(null);
  const ondol = useRef<THREE.InstancedMesh>(null);
  const roof = useRef<THREE.InstancedMesh>(null);
  const jars = useRef<THREE.InstancedMesh>(null);
  useInstanced(walls, WALL_CELLS, WALL_H / 2);
  useInstanced(maru, MARU_CELLS, 0.012, -Math.PI / 2);
  useInstanced(ondol, ONDOL_CELLS, 0.012, -Math.PI / 2);
  useInstanced(roof, ROOF_CELLS, WALL_H, Math.PI / 2);
  useInstanced(jars, JAR_CELLS, 0.45);
  const high = quality === "high";
  return (
    <>
      <instancedMesh ref={walls} args={[undefined, undefined, WALL_CELLS.length]} castShadow={high} receiveShadow={high} frustumCulled={false}>
        <boxGeometry args={[CELL, WALL_H, CELL]} />
        <meshStandardMaterial map={wallTex} roughness={0.95} />
      </instancedMesh>
      {WARDROBE_CELLS.map((cells, i) => (
        <Wardrobes key={i} cells={cells} seed={i} high={high} />
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[WORLD_W / 2, 0, WORLD_D / 2]} receiveShadow={high}>
        <planeGeometry args={[WORLD_W, WORLD_D]} />
        <meshStandardMaterial map={groundTex} roughness={1} />
      </mesh>
      <instancedMesh ref={maru} args={[undefined, undefined, MARU_CELLS.length]} receiveShadow={high} frustumCulled={false}>
        <planeGeometry args={[CELL, CELL]} />
        <meshStandardMaterial map={maruTex} roughness={0.6} />
      </instancedMesh>
      <instancedMesh ref={ondol} args={[undefined, undefined, ONDOL_CELLS.length]} receiveShadow={high} frustumCulled={false}>
        <planeGeometry args={[CELL, CELL]} />
        <meshStandardMaterial map={ondolTex} roughness={0.5} />
      </instancedMesh>
      <instancedMesh ref={roof} args={[undefined, undefined, ROOF_CELLS.length]} frustumCulled={false}>
        <planeGeometry args={[CELL, CELL]} />
        <meshStandardMaterial map={ceilTex} roughness={1} />
      </instancedMesh>
      {/* 장독 */}
      <instancedMesh ref={jars} args={[undefined, undefined, JAR_CELLS.length]} castShadow={high} frustumCulled={false}>
        <sphereGeometry args={[0.55, 16, 12]} />
        <meshStandardMaterial color="#3a2618" roughness={0.25} metalness={0.1} />
      </instancedMesh>
      {/* 우물 */}
      {WELL_CELL >= 0 && (
        <group position={[cellX(colOf(WELL_CELL)), 0, cellZ(rowOf(WELL_CELL))]}>
          <mesh position={[0, 0.4, 0]} castShadow={high}>
            <cylinderGeometry args={[0.85, 0.9, 0.8, 18, 1, true]} />
            <meshStandardMaterial color="#6b6358" roughness={0.95} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.8, 18]} />
            <meshBasicMaterial color="#010102" />
          </mesh>
          {[-0.8, 0.8].map((x) => (
            <mesh key={x} position={[x, 1.1, 0]}>
              <boxGeometry args={[0.1, 1.4, 0.1]} />
              <meshStandardMaterial color="#3a2a1c" />
            </mesh>
          ))}
          <mesh position={[0, 1.75, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.05, 0.05, 1.7, 8]} />
            <meshStandardMaterial color="#3a2a1c" />
          </mesh>
        </group>
      )}
      {/* 사당 제상 + 위패 */}
      {ALTAR_CELL >= 0 && (
        <group position={[cellX(colOf(ALTAR_CELL)), 0, cellZ(rowOf(ALTAR_CELL))]}>
          <mesh position={[0, 0.45, 0]} castShadow={high}>
            <boxGeometry args={[1.7, 0.9, 1.2]} />
            <meshStandardMaterial color="#2a120c" roughness={0.4} />
          </mesh>
          {[-0.45, 0, 0.45].map((x) => (
            <mesh key={x} position={[x, 1.2, 0.1]}>
              <boxGeometry args={[0.18, 0.6, 0.05]} />
              <meshStandardMaterial color="#1a0f0a" emissive="#3a0a06" emissiveIntensity={0.3} />
            </mesh>
          ))}
        </group>
      )}
    </>
  );
}

/** 하늘: 마당 위로 달과 별 */
function Sky() {
  const stars = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pts: number[] = [];
    let s = 7;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 400; i++) pts.push(WORLD_W / 2 + (r() - 0.5) * 160, 30 + r() * 30, WORLD_D / 2 + (r() - 0.5) * 160);
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  useEffect(() => () => stars.dispose(), [stars]);
  return (
    <>
      <points geometry={stars}>
        <pointsMaterial color="#c8d6ff" size={0.35} sizeAttenuation transparent opacity={0.8} fog={false} />
      </points>
      <mesh position={[WORLD_W / 2 + 20, 42, WORLD_D / 2 - 30]}>
        <sphereGeometry args={[2.4, 20, 14]} />
        <meshBasicMaterial color="#f3ead0" fog={false} />
      </mesh>
      <directionalLight position={[WORLD_W / 2 + 20, 42, WORLD_D / 2 - 30]} color="#8ea6d8" intensity={0.22} />
    </>
  );
}

/** 방 이름 현판 (문 위) */
function RoomSigns() {
  const items = useMemo(() => {
    const acc: Record<string, { x: number; z: number; n: number }> = {};
    for (let i = 0; i < CELLS; i++) {
      const r = ROOM[i];
      if (!ROOM_NAMES[r] || r === "." || r === "+" || r === "m" || KIND[i] !== 1) continue;
      const a = (acc[r] ??= { x: 0, z: 0, n: 0 });
      a.x += cellX(colOf(i));
      a.z += cellZ(rowOf(i));
      a.n++;
    }
    return Object.entries(acc).map(([r, a]) => ({ r, x: a.x / a.n, z: a.z / a.n, tex: labelTexture(ROOM_NAMES[r], { bg: "#1b120c", fg: "#e8d2a0", w: 256, h: 96, font: 46 }) }));
  }, []);
  useEffect(() => () => items.forEach((it) => it.tex.dispose()), [items]);
  return (
    <>
      {items.map((it) => (
        <group key={it.r} position={[it.x, WALL_H - 0.45, it.z]}>
          {[0, Math.PI / 2, Math.PI, -Math.PI / 2].map((rot) => (
            <mesh key={rot} rotation={[0, rot, 0]} position={[Math.sin(rot) * 0.03, 0, Math.cos(rot) * 0.03]}>
              <planeGeometry args={[0.9, 0.34]} />
              <meshStandardMaterial map={it.tex} emissiveMap={it.tex} emissive="#ffffff" emissiveIntensity={0.12} roughness={0.8} />
            </mesh>
          ))}
        </group>
      ))}
    </>
  );
}

/* ── 화로 ───────────────────────────────────────────────────────────── */

function brazierFrame(light: THREE.PointLight | null, flame: THREE.Mesh | null, ward: THREE.MeshBasicMaterial | null, sh: SceneShared, t: number) {
  const snap = sh.buf.latest();
  if (!snap) return;
  const ritual = snap.ritual >= 0;
  const since = performance.now() - sh.fx.burn;
  const burst = since < 900 ? 1 - since / 900 : 0;
  const k = 1 + Math.sin(t * 13) * 0.12 + Math.sin(t * 29) * 0.08 + burst * 2.4 + (ritual ? 0.6 + (snap.ritual / 100) * 1.2 : 0);
  if (light) {
    light.intensity = 3.2 * k;
    light.color.set(ritual ? "#ffb35a" : "#ff8a3a");
  }
  if (flame) {
    flame.scale.set(1, 0.8 + k * 0.35, 1);
    flame.rotation.y = t * 1.7;
  }
  if (ward) {
    // 결계 고리 — 원귀 눈에만 또렷하다
    const ghost = isGhostView(snap, sh.mySeat);
    ward.opacity = ghost ? 0.35 + Math.sin(t * 3) * 0.1 : ritual ? 0.18 : 0.05;
  }
}

function Brazier({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const light = useRef<THREE.PointLight>(null);
  const flame = useRef<THREE.Mesh>(null);
  const ward = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((st) => brazierFrame(light.current, flame.current, ward.current, shared.current, st.clock.elapsedTime));
  return (
    <group position={[BRAZIER.x, 0, BRAZIER.z]}>
      <mesh position={[0, 0.35, 0]} castShadow>
        <cylinderGeometry args={[0.7, 0.45, 0.7, 16]} />
        <meshStandardMaterial color="#2b2622" roughness={0.6} metalness={0.6} />
      </mesh>
      {[0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map((a) => (
        <mesh key={a} position={[Math.cos(a) * 0.5, 0.15, Math.sin(a) * 0.5]}>
          <boxGeometry args={[0.08, 0.3, 0.08]} />
          <meshStandardMaterial color="#1f1b18" />
        </mesh>
      ))}
      <mesh ref={flame} position={[0, 0.95, 0]}>
        <coneGeometry args={[0.45, 1.0, 10, 1, true]} />
        <meshBasicMaterial color="#ffb050" transparent opacity={0.8} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <pointLight ref={light} position={[0, 1.4, 0]} color="#ff8a3a" intensity={3.2} distance={16} decay={1.5} castShadow={false} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[WARD_R - 0.06, WARD_R, 64]} />
        <meshBasicMaterial ref={ward} color="#ffd28a" transparent opacity={0.05} depthWrite={false} />
      </mesh>
    </group>
  );
}

/* ── 수납·등잔·떨어진 물건 ──────────────────────────────────────────── */

interface FurnRefs {
  lids: (THREE.Group | null)[];
  glows: (THREE.MeshStandardMaterial | null)[];
  curses: (THREE.Mesh | null)[];
  shake: (THREE.Group | null)[];
}

function furnFrame(r: FurnRefs, sh: SceneShared, dt: number, t: number) {
  const snap = sh.buf.latest();
  if (!snap) return;
  const ghost = isGhostView(snap, sh.mySeat);
  const aim = sh.local.target?.kind === "search" ? sh.local.target.n : -1;
  const sl = sh.fx.slam;
  const slamAge = sl ? performance.now() - sl.at : 9999;
  for (let i = 0; i < FURNITURE.length; i++) {
    const f = FURNITURE[i];
    const ci = f.container;
    if (ci < 0) continue;
    const lid = r.lids[ci];
    if (lid) lid.rotation.x += ((snap.searched[ci] ? -1.1 : 0) - lid.rotation.x) * Math.min(1, dt * 6);
    const g = r.glows[ci];
    if (g) g.emissiveIntensity = aim === ci ? 0.18 + Math.sin(t * 6) * 0.06 : 0;
    const cm = r.curses[ci];
    if (cm) {
      // 원귀 눈에는 저주받은 물건이 든 곳이 붉게 새어 나온다
      const on = ghost && snap.secret && !snap.searched[ci] && isCurse(snap.contents[ci]);
      cm.visible = on;
      if (on) cm.scale.setScalar(1 + Math.sin(t * 3 + ci) * 0.15);
    }
    const s = r.shake[ci];
    if (s) {
      const near = sl && slamAge < 700 && Math.hypot(sl.x - f.x, sl.z - f.z) < 0.6;
      s.position.x = near ? Math.sin(t * 70) * 0.05 * (1 - slamAge / 700) : 0;
      s.rotation.z = near ? Math.sin(t * 55) * 0.06 * (1 - slamAge / 700) : 0;
    }
  }
}

function Furnishings({ shared, quality }: { shared: MutableRefObject<SceneShared>; quality: Quality }) {
  const refs = useRef<FurnRefs>({ lids: [], glows: [], curses: [], shake: [] });
  useFrame((st, dt) => furnFrame(refs.current, shared.current, Math.min(0.05, dt), st.clock.elapsedTime));
  const sh = quality === "high";
  const setLid = (i: number) => (o: THREE.Group | null) => {
    refs.current.lids[i] = o;
  };
  const setGlow = (i: number) => (o: THREE.MeshStandardMaterial | null) => {
    refs.current.glows[i] = o;
  };
  const setCurse = (i: number) => (o: THREE.Mesh | null) => {
    refs.current.curses[i] = o;
  };
  const setShake = (i: number) => (o: THREE.Group | null) => {
    refs.current.shake[i] = o;
  };
  return (
    <>
      {FURNITURE.map((f, i) => (
        <group key={i} position={[f.x, 0, f.z]} rotation={[0, f.rot, 0]}>
          <group ref={setShake(f.container)}>
            {f.kind === "jar" ? (
              <>
                <mesh position={[0, 0.5, 0]} castShadow={sh}>
                  <sphereGeometry args={[0.48, 16, 12]} />
                  <meshStandardMaterial ref={setGlow(f.container)} color="#4a2e1c" roughness={0.3} emissive="#ffd9a0" emissiveIntensity={0} />
                </mesh>
                <group ref={setLid(f.container)} position={[0, 0.92, -0.25]}>
                  <mesh position={[0, 0.03, 0.25]}>
                    <cylinderGeometry args={[0.3, 0.32, 0.08, 14]} />
                    <meshStandardMaterial color="#3a2414" roughness={0.4} />
                  </mesh>
                </group>
              </>
            ) : (
              <>
                <mesh position={[0, f.kind === "cabinet" ? 0.55 : 0.35, 0]} castShadow={sh} receiveShadow={sh}>
                  <boxGeometry args={f.kind === "cabinet" ? [1.1, 1.1, 0.55] : [1.25, 0.7, 0.65]} />
                  <meshStandardMaterial ref={setGlow(f.container)} color={f.kind === "cabinet" ? "#2b160e" : "#5a3a22"} roughness={0.45} emissive="#ffd9a0" emissiveIntensity={0} />
                </mesh>
                {/* 놋쇠 장식 */}
                <mesh position={[0, f.kind === "cabinet" ? 0.6 : 0.42, 0.34]}>
                  <boxGeometry args={[0.22, 0.14, 0.02]} />
                  <meshStandardMaterial color="#b8924a" roughness={0.3} metalness={0.8} />
                </mesh>
                {/* 뚜껑 (뒤지면 열린다) */}
                <group ref={setLid(f.container)} position={[0, f.kind === "cabinet" ? 1.1 : 0.7, -0.32]}>
                  <mesh position={[0, 0.03, 0.32]}>
                    <boxGeometry args={[1.27, 0.06, 0.67]} />
                    <meshStandardMaterial color="#4a2e1a" roughness={0.45} />
                  </mesh>
                </group>
              </>
            )}
          </group>
          <mesh ref={setCurse(f.container)} position={[0, 1.2, 0]} visible={false}>
            <sphereGeometry args={[0.28, 12, 10]} />
            <meshBasicMaterial color="#ff2a2a" transparent opacity={0.45} depthWrite={false} blending={THREE.AdditiveBlending} fog={false} />
          </mesh>
        </group>
      ))}
    </>
  );
}

function lanternsFrame(lights: (THREE.PointLight | null)[], shades: (THREE.MeshStandardMaterial | null)[], sh: SceneShared, t: number) {
  const snap = sh.buf.latest();
  if (!snap) return;
  for (let i = 0; i < LANTERNS.length; i++) {
    const on = !!snap.lanterns[i];
    const k = on ? 1 + Math.sin(t * 9 + i * 1.3) * 0.08 + Math.sin(t * 23 + i) * 0.05 : 0;
    const l = lights[i];
    if (l) l.intensity = 2.6 * k;
    const m = shades[i];
    if (m) m.emissiveIntensity = on ? 1.1 * k : 0.02;
  }
}

function Lanterns({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  const shades = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  useFrame((st) => lanternsFrame(lights.current, shades.current, shared.current, st.clock.elapsedTime));
  return (
    <>
      {LANTERNS.map((l) => (
        <group key={l.i} position={[l.x, 0, l.z]}>
          <mesh position={[0, 0.35, 0]}>
            <cylinderGeometry args={[0.03, 0.06, 0.7, 6]} />
            <meshStandardMaterial color="#2a1c12" />
          </mesh>
          <mesh position={[0, 0.85, 0]}>
            <boxGeometry args={[0.32, 0.38, 0.32]} />
            <meshStandardMaterial
              ref={(o) => {
                shades.current[l.i] = o;
              }}
              color="#e8dcc0"
              emissive="#ffb760"
              emissiveIntensity={0.02}
              transparent
              opacity={0.92}
            />
          </mesh>
          <pointLight
            ref={(o) => {
              lights.current[l.i] = o;
            }}
            position={[0, 1.0, 0]}
            color="#ffb760"
            intensity={0}
            distance={10}
            decay={1.6}
          />
        </group>
      ))}
    </>
  );
}

function groundFrame(group: THREE.Group | null, sh: SceneShared, t: number) {
  const snap = sh.buf.latest();
  if (!group || !snap) return;
  group.children.forEach((ch, i) => {
    const g = snap.ground[i];
    ch.visible = !!g;
    if (!g) return;
    ch.position.set(g.x, 0.15 + Math.sin(t * 2 + i) * 0.03, g.z);
    ch.rotation.y = t * 0.6 + i;
  });
}

/** 빙의된 사람이 떨어뜨린 물건 (최대 8개 자리) */
function GroundItems({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const group = useRef<THREE.Group>(null);
  useFrame((st) => groundFrame(group.current, shared.current, st.clock.elapsedTime));
  return (
    <group ref={group}>
      {Array.from({ length: 8 }, (_, i) => (
        <group key={i} visible={false}>
          <mesh>
            <capsuleGeometry args={[0.07, 0.18, 4, 8]} />
            <meshStandardMaterial color="#3a1414" emissive="#a01010" emissiveIntensity={0.8} />
          </mesh>
          <pointLight color="#ff3030" intensity={0.6} distance={3} decay={2} />
        </group>
      ))}
    </group>
  );
}

/* ── 퇴마사 (VRM) ───────────────────────────────────────────────────── */

interface HunterFrame {
  visible: boolean;
  x: number;
  z: number;
  yaw: number;
  mode: "idle" | "walk" | "run" | "search" | "down" | "panic";
  fear: number;
  lightOn: boolean;
  pitch: number;
}

function Hunter({ seat, name, shared, lowDetail }: { seat: number; name: string; shared: MutableRefObject<SceneShared>; lowDetail: boolean }) {
  const chars = useRoomCharacters((st) => st.byName);
  const look = useMemo(() => resolveLook(seat, ["none"], roomCharacterOf(chars, name)), [seat, chars, name]);
  const root = useRef<THREE.Group>(null);
  const spot = useRef<THREE.SpotLight>(null);
  const tag = useRef<THREE.Sprite>(null);
  const aura = useRef<THREE.Sprite>(null);
  const scene = useThree((s) => s.scene);
  const frame = useRef<HunterFrame>({ visible: false, x: 0, z: 0, yaw: 0, mode: "idle", fear: 0, lightOn: false, pitch: 0 });
  const anim = useRef({ phase: 0, lie: 0 });
  const tagTex = useMemo(() => nameTexture(name || `${seat + 1}번`, SEAT_COLORS[seat % 6]), [name, seat]);
  useEffect(() => () => tagTex.dispose(), [tagTex]);
  useEffect(() => {
    const s = spot.current;
    if (!s) return;
    scene.add(s.target);
    return () => {
      scene.remove(s.target);
    };
  }, [scene]);

  const read = () => {
    const sh = shared.current;
    const snap = sh.buf.latest();
    const f = frame.current;
    const p = snap?.players[seat];
    if (!snap || !p || seat === sh.mySeat) {
      f.visible = false;
      return f;
    }
    const pose = sh.buf.body(seat, performance.now()) ?? p;
    f.visible = true;
    f.x = pose.x;
    f.z = pose.z;
    f.yaw = pose.yaw;
    f.pitch = p.pitch;
    f.fear = p.fear;
    f.lightOn = p.st === "alive" && p.light && p.battery > 0 && snap.t >= p.lightOffUntil;
    f.mode = p.st === "possessed" ? "down" : p.use ? "search" : p.mv === 3 ? "run" : p.mv === 2 ? "walk" : p.panic ? "panic" : "idle";
    return f;
  };

  useFrame((st, rawDt) => {
    const f = read();
    const sh = shared.current;
    const snap = sh.buf.latest();
    const ghostView = !!snap && isGhostView(snap, sh.mySeat);
    const r = root.current;
    if (r) {
      r.visible = f.visible;
      r.position.set(f.x, 0, f.z);
      // 시뮬 yaw(−z가 앞) → VRM(+z가 앞)
      r.rotation.y = f.yaw + Math.PI;
      const a = anim.current;
      a.lie += ((f.mode === "down" ? 1 : 0) - a.lie) * Math.min(1, rawDt * 4);
      r.rotation.x = -a.lie * 1.35;
      r.position.y = a.lie * 0.25;
    }
    const s = spot.current;
    if (s) {
      s.intensity = f.visible && f.lightOn && !ghostView ? 18 : f.visible && f.lightOn && ghostView ? 6 : 0;
      const cp = Math.cos(f.pitch);
      s.position.set(f.x - Math.sin(f.yaw) * 0.3, 1.25, f.z - Math.cos(f.yaw) * 0.3);
      s.target.position.set(f.x - Math.sin(f.yaw) * cp * 5, 1.25 + Math.sin(f.pitch) * 5, f.z - Math.cos(f.yaw) * cp * 5);
      s.target.updateMatrixWorld();
    }
    if (tag.current) tag.current.visible = f.visible;
    const au = aura.current;
    if (au) {
      // 원귀 눈: 공포만큼 붉게 타오르는 표식
      au.visible = f.visible && ghostView;
      if (au.visible) {
        const k = f.fear / 100;
        au.material.color.setRGB(0.4 + k * 0.6, 0.85 - k * 0.7, 0.9 - k * 0.8);
        au.material.opacity = 0.35 + k * 0.45 + (f.fear >= 75 ? Math.sin(st.clock.elapsedTime * 8) * 0.15 : 0);
        au.scale.setScalar(1.1 + k * 0.6);
      }
    }
  });

  const pose = (o: Float32Array, t: number, dt: number) => {
    const f = frame.current;
    const a = anim.current;
    setBone(o, "rightUpperArm", -0.9, 0, -0.15);
    setBone(o, "rightLowerArm", -0.6);
    setBone(o, "leftUpperArm", 0, 0, 0.18);
    switch (f.mode) {
      case "run":
        a.phase += dt * 13;
        addWalk(o, a.phase, 0.9);
        o[BODY.spine] += 0.12;
        break;
      case "walk":
        a.phase += dt * 8;
        addWalk(o, a.phase, 0.5, "sneak");
        break;
      case "search":
        addCrouch(o, 0.35);
        setBone(o, "leftUpperArm", -1.2, 0, 0.3);
        setBone(o, "leftLowerArm", -0.5 + Math.sin(t * 9) * 0.25);
        o[BODY.spine] += 0.4;
        break;
      case "panic": {
        const w = Math.sin(t * 17);
        o[BODY.spine] += 0.2;
        o[BODY.head + 1] = w * 0.4;
        setBone(o, "leftUpperArm", -1.6 + w * 0.2, 0, 0.6);
        break;
      }
      case "down":
        setBone(o, "rightUpperArm", -0.3, 0, -1.0);
        setBone(o, "leftUpperArm", -0.3, 0, 1.0);
        o[BODY.head] -= 0.4;
        break;
      default:
        o[BODY.spine] += Math.sin(t * 2 + seat) * 0.03;
        o[BODY.head + 1] = Math.sin(t * 0.7 + seat) * 0.5;
    }
    o[BODY_DROP] += 0;
  };

  const face = () => {
    const f = frame.current;
    if (f.mode === "down") return { shut: true };
    if (f.fear >= 75) return { surprised: 0.9 };
    if (f.fear >= 40) return { sad: 0.5 };
    return {};
  };

  return (
    <group>
      <group ref={root} visible={false}>
        <VrmBody look={look} seed={seat * 13 + 5} headY={1.45} pose={pose} face={face} lowDetail={lowDetail} follow={14} />
      </group>
      <spotLight ref={spot} color="#fff1d6" angle={0.45} penumbra={0.6} distance={22} decay={1.35} intensity={0} />
      <sprite ref={tag} position={[0, 0, 0]} scale={[1.3, 0.325, 1]} visible={false}>
        <spriteMaterial map={tagTex} transparent opacity={0.9} depthWrite={false} />
      </sprite>
      <sprite ref={aura} scale={[1.2, 1.2, 1]} visible={false}>
        <spriteMaterial color="#ff3030" transparent opacity={0.5} depthWrite={false} depthTest={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <TagFollower root={root} tag={tag} aura={aura} />
    </group>
  );
}

/** 이름표·표식을 몸 위로 */
function TagFollower({ root, tag, aura }: { root: MutableRefObject<THREE.Group | null>; tag: MutableRefObject<THREE.Sprite | null>; aura: MutableRefObject<THREE.Sprite | null> }) {
  useFrame(() => {
    const r = root.current;
    if (!r) return;
    tag.current?.position.set(r.position.x, 2.05 - r.position.y * 4, r.position.z);
    aura.current?.position.set(r.position.x, 1.0, r.position.z);
  });
  return null;
}

/* ── 원귀 (보일 때만) ───────────────────────────────────────────────── */

function Ghost({ seat, name, shared }: { seat: number; name: string; shared: MutableRefObject<SceneShared> }) {
  const chars = useRoomCharacters((st) => st.byName);
  const look = useMemo(() => resolveLook(seat, ["none"], roomCharacterOf(chars, name)), [seat, chars, name]);
  const root = useRef<THREE.Group>(null);
  const alpha = useRef(0);
  const ghostSpec = useMemo(() => ({ color: GHOST_COLOR, alpha }), []);
  const light = useRef<THREE.PointLight>(null);
  useFrame((st) => {
    const sh = shared.current;
    const snap = sh.buf.latest();
    const r = root.current;
    if (!r || !snap) return;
    const t = st.clock.elapsedTime;
    const mine = isGhostView(snap, sh.mySeat);
    const pose = !mine && ghostKnown(snap) && snap.ghostVis > 0 ? sh.buf.ghost(performance.now()) : null;
    const want = !pose ? 0 : snap.ghostVis === 2 ? 0.7 + Math.sin(t * 17) * 0.08 : 0.16 + (Math.sin(t * 23) > 0.6 ? 0.12 : 0);
    alpha.current += (want - alpha.current) * 0.25;
    r.visible = alpha.current > 0.02;
    if (pose) {
      r.position.set(pose.x, 0.18 + Math.sin(t * 1.6) * 0.08, pose.z);
      r.rotation.y = pose.yaw + Math.PI;
    }
    if (light.current) {
      light.current.position.set(r.position.x, 1.4, r.position.z);
      light.current.intensity = r.visible ? alpha.current * 3 : 0;
    }
  });
  const pose = (o: Float32Array, t: number) => {
    // 두 팔을 앞으로 늘어뜨리고, 다리는 모은 채 떠 있다
    setBone(o, "rightUpperArm", -1.1 + Math.sin(t * 1.3) * 0.08, 0, -0.1);
    setBone(o, "leftUpperArm", -1.1 + Math.sin(t * 1.3 + 1) * 0.08, 0, 0.1);
    setBone(o, "rightLowerArm", -0.2);
    setBone(o, "leftLowerArm", -0.2);
    o[BODY.head] += 0.35;
    o[BODY.head + 2] += Math.sin(t * 0.8) * 0.15;
    setBone(o, "rightUpperLeg", 0.05);
    setBone(o, "leftUpperLeg", 0.05);
  };
  return (
    <>
      <group ref={root} visible={false}>
        <VrmBody look={look} seed={seat * 13 + 99} headY={1.5} pose={pose} face={() => ({ shut: false, sad: 1 })} ghost={ghostSpec} follow={8} />
      </group>
      <pointLight ref={light} color={GHOST_COLOR} intensity={0} distance={6} decay={1.8} />
    </>
  );
}

/* ── 연출: 성수 물보라 ──────────────────────────────────────────────── */

function splashFrame(m: THREE.Mesh | null, mat: THREE.MeshBasicMaterial | null, sh: SceneShared) {
  if (!m || !mat) return;
  const w = sh.fx.water;
  const age = w ? performance.now() - w.at : 9999;
  m.visible = age < 700;
  if (!w || !m.visible) return;
  const k = age / 700;
  m.position.set(w.x, 1.0 - k * 0.6, w.z);
  m.scale.setScalar(0.3 + k * 2.2);
  mat.opacity = 0.55 * (1 - k);
}

function Splash({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const m = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => splashFrame(m.current, mat.current, shared.current));
  return (
    <mesh ref={m} visible={false}>
      <sphereGeometry args={[1, 16, 10]} />
      <meshBasicMaterial ref={mat} color="#bfe8ff" transparent opacity={0.5} depthWrite={false} blending={THREE.AdditiveBlending} />
    </mesh>
  );
}

/* ── 프레임 속도 감시 (자동 화질) ───────────────────────────────────── */

function fpsFrame(acc: { t: number; n: number; done: boolean }, dt: number, onFps: (fps: number) => void) {
  if (acc.done) return;
  acc.t += dt;
  acc.n++;
  if (acc.t < 4) return;
  acc.done = true;
  onFps(acc.n / acc.t);
}

function FpsProbe({ onFps }: { onFps: (fps: number) => void }) {
  const acc = useRef({ t: 0, n: 0, done: false });
  useFrame((_, dt) => fpsFrame(acc.current, dt, onFps));
  return null;
}

export default function HouseScene({ shared, names, seatCount, ghostSeat, quality, onFps }: { shared: MutableRefObject<SceneShared>; names: Record<number, string>; seatCount: number; ghostSeat: number; quality: Quality; onFps?: (fps: number) => void }) {
  const high = quality === "high";
  return (
    <Canvas shadows={high} dpr={high ? [1, 1.5] : [0.75, 1]} gl={{ antialias: high, powerPreference: "high-performance" }} camera={{ fov: 72, near: 0.06, far: 120, position: [BRAZIER.x, EYE, BRAZIER.z + 4] }} style={{ touchAction: "none", background: "#000" }}>
      <color attach="background" args={["#05070d"]} />
      <fogExp2 attach="fog" args={["#030406", 0.055]} />
      <CameraRig shared={shared} />
      <Sky />
      <Structure quality={quality} />
      <RoomSigns />
      <Brazier shared={shared} />
      <Furnishings shared={shared} quality={quality} />
      <Lanterns shared={shared} />
      <GroundItems shared={shared} />
      {Array.from({ length: seatCount }, (_, seat) => (seat === ghostSeat ? <Ghost key={seat} seat={seat} name={names[seat] ?? ""} shared={shared} /> : <Hunter key={seat} seat={seat} name={names[seat] ?? ""} shared={shared} lowDetail={!high} />))}
      <Splash shared={shared} />
      {onFps && <FpsProbe onFps={onFps} />}
    </Canvas>
  );
}

export { CONTAINERS };
