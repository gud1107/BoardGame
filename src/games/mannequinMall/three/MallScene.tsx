"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EYE, SEAT_COLORS } from "../data";
import { iSee, stepLocal, syncLocal, type LocalBody } from "../localBody";
import { CELL, CELLS, COLS, EXIT, FURNITURE, KIND, MANNEQUIN_CELLS, ROOM, ROOM_NAMES, ROWS, WORLD_D, WORLD_W, cellX, cellZ, colOf, idx, rowOf } from "../map";
import type { SnapBuffer } from "../net";
import MannequinBody, { applyPose, emptyRig, type MannequinRig } from "./Mannequin";
import { ceilingTexture, floorTexture, labelTexture, nameTexture, shelfTexture, shutterTexture, wallTexture } from "./textures";

/**
 * 마네킹 백화점 3D 무대 (룰북 §10): 1인칭. 꺼진 매장을 내 손전등과 드문드문 남은 야간등으로 비춘다.
 * 벽·진열장은 인스턴스 상자, 계산대 서랍·셔터는 스냅샷을 보고 움직인다.
 *
 * **마네킹은 내가 보고 있는 동안 화면에서도 절대 움직이지 않는다**: 이 기기의 시선으로 보이는 마네킹은 마지막
 * 자리·포즈를 붙들고, 눈을 돌린 사이에만 방장이 보낸 자리로 옮긴다(네트워크 지연이 있어도 "보는 중엔 멈춤"이 깨지지 않는다).
 */

export interface SceneShared {
  buf: SnapBuffer;
  local: LocalBody;
  mySeat: number;
  /** 놀람 연출 줄이기 */
  calm: boolean;
  /** 최근 플래시 (모두에게 번쩍) */
  flash: { x: number; z: number; at: number } | null;
}

const WALL_H = 3.4;
const SHELF_H = 2.3;

type Quality = "high" | "low";

/* ── 카메라 + 손전등 ─────────────────────────────────────────────────── */

interface Rig {
  roll: number;
  ly: number;
  lp: number;
  fov: number;
  eye: number;
}

const fwd = new THREE.Vector3();

function rigFrame(cam: THREE.PerspectiveCamera, sh: SceneShared, rig: Rig, spot: THREE.SpotLight | null, vm: THREE.Group | null, glow: THREE.PointLight | null, dtRaw: number, t: number) {
  const dt = Math.min(0.05, dtRaw);
  const snap = sh.buf.latest();
  if (!snap) return;
  const now = performance.now();
  const b = sh.local;
  syncLocal(b, snap, sh.mySeat);
  stepLocal(b, snap, sh.mySeat, dt, now);
  const me = snap.players[sh.mySeat];
  if (!me) return;
  let px = b.x;
  let pz = b.z;
  let yaw = b.yaw;
  let pitch = b.pitch;
  let eyeWant = EYE;
  let lightOn = me.st === "alive" && b.light && me.battery > 0;
  let battery = me.battery;

  if (me.st === "down") {
    // 굳어 버렸다: 고개만 겨우 돌아간다
    eyeWant = EYE - 0.05;
  } else if (me.st !== "alive") {
    const alive = snap.players.filter((p) => p.st === "alive" && p.seat !== sh.mySeat);
    const tgt = alive.find((p) => p.seat === b.spectate) ?? alive[0];
    if (tgt) {
      b.spectate = tgt.seat;
      const pose = sh.buf.body(tgt.seat, now) ?? tgt;
      px = pose.x;
      pz = pose.z;
      yaw = pose.yaw;
      pitch = tgt.pitch;
      lightOn = tgt.light;
      battery = tgt.battery;
      b.x = px;
      b.z = pz;
    } else {
      eyeWant = 2.6;
      pitch = -0.5;
      lightOn = false;
    }
  }

  // 붙잡힘: 마네킹 얼굴 쪽으로 고개가 돌아간다
  if (now < b.scareUntil && b.scareAt) {
    const want = Math.atan2(-(b.scareAt.x - b.x), -(b.scareAt.z - b.z));
    let d = want - b.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    b.yaw += d * Math.min(1, dt * 16);
    b.pitch += (0.12 - b.pitch) * Math.min(1, dt * 16);
    yaw = b.yaw;
    pitch = b.pitch;
  }

  rig.eye += (eyeWant - rig.eye) * Math.min(1, dt * 8);
  b.shake = Math.max(0, b.shake - dt * 1.6);
  const sh2 = b.shake * (sh.calm ? 0.25 : 1) * 0.08;
  const bobY = me.st === "alive" ? Math.sin(b.bob * Math.PI) * (b.mv === 3 ? 0.05 : 0.026) : 0;
  const bobX = me.st === "alive" ? Math.cos(b.bob * Math.PI * 0.5) * 0.012 : 0;
  cam.position.set(px + Math.sin(t * 61) * sh2 + bobX * Math.cos(yaw), rig.eye + bobY + Math.sin(t * 73) * sh2, pz + Math.cos(t * 67) * sh2 - bobX * Math.sin(yaw));
  cam.rotation.set(pitch, yaw, 0, "YXZ");
  const fovWant = 72 + (b.mv === 3 ? 5 : 0);
  rig.fov += (fovWant - rig.fov) * Math.min(1, dt * 6);
  if (Math.abs(cam.fov - rig.fov) > 0.05) {
    cam.fov = rig.fov;
    cam.updateProjectionMatrix();
  }

  let dy = yaw - rig.ly;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  rig.ly += dy * Math.min(1, dt * 16);
  rig.lp += (pitch - rig.lp) * Math.min(1, dt * 16);
  const dark = snap.flicker.st === "dark";
  const warn = snap.flicker.st === "warn";
  if (spot) {
    const cp = Math.cos(rig.lp);
    fwd.set(-Math.sin(rig.ly) * cp, Math.sin(rig.lp), -Math.cos(rig.ly) * cp);
    spot.position.set(cam.position.x + Math.cos(yaw) * 0.16, cam.position.y - 0.14, cam.position.z - Math.sin(yaw) * 0.16);
    spot.target.position.set(spot.position.x + fwd.x * 6, spot.position.y + fwd.y * 6, spot.position.z + fwd.z * 6);
    spot.target.updateMatrixWorld();
    const weak = battery < 15 ? (Math.sin(t * 31) * Math.sin(t * 7.3) > 0.25 ? 0.25 : 1) * (0.45 + battery / 27) : 1;
    // 정전 경고 중에는 손전등도 지직거린다
    const stutter = warn && Math.sin(t * 47) * Math.sin(t * 13.1) > 0.55 ? 0.15 : 1;
    spot.intensity = lightOn && !dark ? 24 * weak * stutter : 0;
  }
  if (glow) {
    glow.position.copy(cam.position);
    glow.intensity = dark ? 0.08 : lightOn ? 0.35 : 0.5;
  }
  if (vm) {
    vm.visible = me.st === "alive";
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
  const rig = useRef<Rig>({ roll: 0, ly: 0, lp: 0, fov: 72, eye: EYE });
  useEffect(() => {
    const s = spot.current;
    if (!s) return;
    scene.add(s.target);
    return () => {
      scene.remove(s.target);
    };
  }, [scene]);
  useFrame((st, dt) => rigFrame(camera, shared.current, rig.current, spot.current, vm.current, glow.current, dt, st.clock.elapsedTime));
  return (
    <>
      <spotLight ref={spot} color="#fff4e0" angle={0.56} penumbra={0.8} distance={34} decay={1.25} intensity={0} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} shadow-bias={-0.0006} shadow-camera-near={0.3} shadow-camera-far={30} />
      <pointLight ref={glow} color="#7188a8" intensity={0.5} distance={8} decay={1.5} />
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

const WALL_CELLS: number[] = [];
const SHELF_CELLS: number[][] = [[], [], []];
const VOID_CELLS: number[] = [];
for (let i = 0; i < CELLS; i++) {
  const k = KIND[i];
  if (k === 4) SHELF_CELLS[(colOf(i) * 7 + rowOf(i) * 3) % 3].push(i);
  if (k === 5) VOID_CELLS.push(i);
  if (k !== 0 && k !== 3) continue;
  const c = colOf(i);
  const r = rowOf(i);
  let edge = false;
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const nc = c + dc;
    const nr = r + dr;
    if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
    const nk = KIND[idx(nc, nr)];
    if (nk !== 0 && nk !== 3) edge = true;
  }
  if (edge && k === 0) WALL_CELLS.push(i);
}

function Shelves({ cells, seed, high }: { cells: number[]; seed: number; high: boolean }) {
  const tex = useMemo(() => shelfTexture(seed + 3), [seed]);
  useEffect(() => () => tex.dispose(), [tex]);
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    cells.forEach((cell, i) => {
      m4.makeTranslation(cellX(colOf(cell)), SHELF_H / 2, cellZ(rowOf(cell)));
      m.setMatrixAt(i, m4);
    });
    m.instanceMatrix.needsUpdate = true;
  }, [cells]);
  if (!cells.length) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, cells.length]} castShadow={high} receiveShadow={high} frustumCulled={false}>
      <boxGeometry args={[CELL - 0.24, SHELF_H, CELL - 0.24]} />
      <meshStandardMaterial map={tex} roughness={0.85} />
    </instancedMesh>
  );
}

function Structure({ quality }: { quality: Quality }) {
  const wallTex = useMemo(() => wallTexture(), []);
  const floorTex = useMemo(() => {
    const t = floorTexture();
    t.repeat.set(COLS, ROWS);
    return t;
  }, []);
  const ceilTex = useMemo(() => {
    const t = ceilingTexture();
    t.repeat.set(COLS, ROWS);
    return t;
  }, []);
  useEffect(
    () => () => {
      wallTex.dispose();
      floorTex.dispose();
      ceilTex.dispose();
    },
    [wallTex, floorTex, ceilTex],
  );
  const walls = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const w = walls.current;
    if (!w) return;
    WALL_CELLS.forEach((cell, i) => {
      m4.makeTranslation(cellX(colOf(cell)), WALL_H / 2, cellZ(rowOf(cell)));
      w.setMatrixAt(i, m4);
    });
    w.instanceMatrix.needsUpdate = true;
  }, []);
  const high = quality === "high";
  return (
    <>
      <instancedMesh ref={walls} args={[undefined, undefined, WALL_CELLS.length]} castShadow={high} receiveShadow={high} frustumCulled={false}>
        <boxGeometry args={[CELL, WALL_H, CELL]} />
        <meshStandardMaterial map={wallTex} roughness={0.9} />
      </instancedMesh>
      {SHELF_CELLS.map((cells, i) => (
        <Shelves key={i} cells={cells} seed={i} high={high} />
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[WORLD_W / 2, 0, WORLD_D / 2]} receiveShadow={high}>
        <planeGeometry args={[WORLD_W, WORLD_D]} />
        <meshStandardMaterial map={floorTex} roughness={0.22} metalness={0.12} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[WORLD_W / 2, WALL_H, WORLD_D / 2]}>
        <planeGeometry args={[WORLD_W, WORLD_D]} />
        <meshStandardMaterial map={ceilTex} roughness={1} />
      </mesh>
    </>
  );
}

/** 에스컬레이터 빈 곳: 아래층이 내려다보이는 검은 구멍 + 유리 난간 */
function EscalatorVoid() {
  const x0 = Math.min(...VOID_CELLS.map((i) => colOf(i))) * CELL;
  const x1 = (Math.max(...VOID_CELLS.map((i) => colOf(i))) + 1) * CELL;
  const z0 = Math.min(...VOID_CELLS.map((i) => rowOf(i))) * CELL;
  const z1 = (Math.max(...VOID_CELLS.map((i) => rowOf(i))) + 1) * CELL;
  const w = x1 - x0;
  const d = z1 - z0;
  const sign = useMemo(() => labelTexture("에스컬레이터 운행 중지", { bg: "#1c1a17", fg: "#f5c15b", w: 512, h: 96, font: 40 }), []);
  useEffect(() => () => sign.dispose(), [sign]);
  const rails: [number, number, number, number][] = [
    [x0 + w / 2, z0, w, 0],
    [x0 + w / 2, z1, w, 0],
    [x0, z0 + d / 2, d, Math.PI / 2],
    [x1, z0 + d / 2, d, Math.PI / 2],
  ];
  // 멈춘 에스컬레이터 두 줄 (구멍 속으로 내려가는 계단)
  const steps = Array.from({ length: 12 }, (_, k) => k);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x0 + w / 2, 0.004, z0 + d / 2]}>
        <planeGeometry args={[w, d]} />
        <meshBasicMaterial color="#030304" />
      </mesh>
      {[x0 + w * 0.3, x0 + w * 0.7].map((x) => (
        <group key={x}>
          {steps.map((k) => (
            <mesh key={k} position={[x, 0.006 + k * 0.0004, z0 + 0.6 + k * ((d - 1.2) / 12)]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[1.0, 0.05]} />
              <meshStandardMaterial color="#3a3d40" emissive="#0a0a0a" roughness={0.5} metalness={0.6} transparent opacity={1 - k / 13} />
            </mesh>
          ))}
          <mesh position={[x - 0.58, 0.5, z0 + d / 2]}>
            <boxGeometry args={[0.1, 1.0, d - 0.6]} />
            <meshStandardMaterial color="#1a1c1e" roughness={0.4} metalness={0.5} />
          </mesh>
          <mesh position={[x + 0.58, 0.5, z0 + d / 2]}>
            <boxGeometry args={[0.1, 1.0, d - 0.6]} />
            <meshStandardMaterial color="#1a1c1e" roughness={0.4} metalness={0.5} />
          </mesh>
        </group>
      ))}
      {rails.map(([x, z, len, rot], i) => (
        <group key={i} position={[x, 0, z]} rotation={[0, rot, 0]}>
          <mesh position={[0, 0.5, 0]}>
            <boxGeometry args={[len, 1.0, 0.03]} />
            <meshStandardMaterial color="#9fb6c4" roughness={0.05} metalness={0.2} transparent opacity={0.18} depthWrite={false} />
          </mesh>
          <mesh position={[0, 1.02, 0]}>
            <boxGeometry args={[len, 0.05, 0.07]} />
            <meshStandardMaterial color="#b8b4aa" roughness={0.3} metalness={0.8} />
          </mesh>
        </group>
      ))}
      <mesh position={[x0 + w / 2, 1.35, z1 + 0.02]}>
        <planeGeometry args={[1.8, 0.34]} />
        <meshStandardMaterial map={sign} emissiveMap={sign} emissive="#ffffff" emissiveIntensity={0.25} />
      </mesh>
    </group>
  );
}

/* ── 천장 야간등 · 정전 ──────────────────────────────────────────────── */

/** 폐점 뒤에도 켜진 야간등 자리 (칸) */
const NIGHT_LIGHTS: [number, number][] = [[4, 3], [15, 3], [27, 3], [6, 10], [24, 10], [15, 14], [5, 17], [15, 16], [25, 17], [12, 6]];
const PANELS: number[] = [];
for (let i = 0; i < CELLS; i++) if (KIND[i] === 1 && (colOf(i) + rowOf(i)) % 3 === 0 && (colOf(i) * rowOf(i)) % 2 === 0) PANELS.push(i);

function lightsFrame(lights: (THREE.PointLight | null)[], panels: THREE.MeshStandardMaterial | null, sh: SceneShared, t: number) {
  const snap = sh.buf.latest();
  const st = snap?.flicker.st ?? "idle";
  for (let i = 0; i < lights.length; i++) {
    const l = lights[i];
    if (!l) continue;
    let k = 1;
    if (st === "dark") k = 0;
    else if (st === "warn") k = Math.sin(t * (37 + i * 5)) * Math.sin(t * (11 + i)) > 0.2 ? 0.1 : 1.2;
    else if (Math.sin(t * (0.6 + i * 0.11) + i * 2.3) > 0.97) k = 0.2;
    l.intensity = 2.4 * k;
  }
  if (panels) panels.emissiveIntensity = st === "dark" ? 0 : st === "warn" ? (Math.sin(t * 43) > 0 ? 0.9 : 0.05) : 0.35;
}

function NightLights({ shared, quality }: { shared: MutableRefObject<SceneShared>; quality: Quality }) {
  const refs = useRef<(THREE.PointLight | null)[]>([]);
  const panelMat = useRef<THREE.MeshStandardMaterial>(null);
  const panels = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = panels.current;
    if (!m) return;
    PANELS.forEach((cell, i) => {
      m4.makeRotationX(Math.PI / 2);
      m4.setPosition(cellX(colOf(cell)), WALL_H - 0.01, cellZ(rowOf(cell)));
      m.setMatrixAt(i, m4);
    });
    m.instanceMatrix.needsUpdate = true;
  }, []);
  useFrame((st) => lightsFrame(refs.current, panelMat.current, shared.current, st.clock.elapsedTime));
  const list = quality === "high" ? NIGHT_LIGHTS : NIGHT_LIGHTS.filter((_, i) => i % 2 === 0);
  return (
    <>
      <instancedMesh ref={panels} args={[undefined, undefined, PANELS.length]} frustumCulled={false}>
        <planeGeometry args={[1.2, 0.3]} />
        <meshStandardMaterial ref={panelMat} color="#3a3d40" emissive="#dfe9ff" emissiveIntensity={0.35} side={THREE.DoubleSide} />
      </instancedMesh>
      {list.map(([c, r], i) => (
        <pointLight
          key={i}
          ref={(o) => {
            refs.current[i] = o;
          }}
          position={[cellX(c), WALL_H - 0.3, cellZ(r)]}
          color="#cfdcff"
          intensity={2.4}
          distance={9}
          decay={1.6}
        />
      ))}
    </>
  );
}

/** 매장 안내판: 천장에 매달린 이름표 */
const ZONE_EN: Record<string, string> = { w: "STOCK ROOM", b: "WOMEN", k: "STAFF ONLY", c: "MEN", e: "INFORMATION", d: "KIDS", f: "SHOES", a: "COSMETICS", g: "BAGS & GOODS" };

function ZoneSigns() {
  const items = useMemo(() => {
    const acc: Record<string, { x: number; z: number; n: number }> = {};
    for (let i = 0; i < CELLS; i++) {
      const r = ROOM[i];
      if (!ZONE_EN[r] || KIND[i] !== 1) continue;
      const a = (acc[r] ??= { x: 0, z: 0, n: 0 });
      a.x += cellX(colOf(i));
      a.z += cellZ(rowOf(i));
      a.n++;
    }
    return Object.entries(acc).map(([r, a]) => ({ r, x: a.x / a.n, z: a.z / a.n, tex: labelTexture(ROOM_NAMES[r], { bg: "#14110e", fg: "#f2e3c2", w: 512, h: 128, font: 54, sub: ZONE_EN[r] }) }));
  }, []);
  useEffect(() => () => items.forEach((it) => it.tex.dispose()), [items]);
  return (
    <>
      {items.map((it) => (
        <group key={it.r} position={[it.x, WALL_H - 0.55, it.z]}>
          {[0, Math.PI].map((rot) => (
            <mesh key={rot} rotation={[0, rot, 0]} position={[0, 0, rot ? -0.02 : 0.02]}>
              <planeGeometry args={[1.8, 0.45]} />
              <meshStandardMaterial map={it.tex} emissiveMap={it.tex} emissive="#ffffff" emissiveIntensity={0.18} roughness={0.8} />
            </mesh>
          ))}
          <mesh position={[0, 0.4, 0]}>
            <cylinderGeometry args={[0.008, 0.008, 0.4, 4]} />
            <meshBasicMaterial color="#222" />
          </mesh>
        </group>
      ))}
    </>
  );
}

/* ── 가구 ───────────────────────────────────────────────────────────── */

function furnFrame(drawers: (THREE.Group | null)[], glows: (THREE.MeshStandardMaterial | null)[], slots: (THREE.MeshStandardMaterial | null)[], sh: SceneShared, dt: number, t: number) {
  const snap = sh.buf.latest();
  if (!snap) return;
  const aim = sh.local.target?.kind === "search" ? sh.local.target.n : -1;
  for (let i = 0; i < drawers.length; i++) {
    const d = drawers[i];
    if (d) d.position.z += ((snap.searched[i] ? 0.42 : 0) - d.position.z) * Math.min(1, dt * 6);
    const g = glows[i];
    if (g) g.emissiveIntensity = aim === i ? 0.12 + Math.sin(t * 6) * 0.05 : 0;
  }
  for (let i = 0; i < slots.length; i++) {
    const m = slots[i];
    if (!m) continue;
    const on = i < snap.placed;
    m.emissiveIntensity = on ? 1.2 + Math.sin(t * 5 + i) * 0.3 : i < snap.need ? 0.08 : 0;
    m.emissive.set(on ? "#ffd24a" : "#552222");
  }
}

function Furnishings({ shared, quality }: { shared: MutableRefObject<SceneShared>; quality: Quality }) {
  const drawers = useRef<(THREE.Group | null)[]>([]);
  const glows = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const slots = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  useFrame((st, dt) => furnFrame(drawers.current, glows.current, slots.current, shared.current, Math.min(0.05, dt), st.clock.elapsedTime));
  const panelSign = useMemo(() => labelTexture("⚡ 배전반", { bg: "#2b2b2b", fg: "#ffd24a", w: 256, h: 64, font: 30 }), []);
  useEffect(() => () => panelSign.dispose(), [panelSign]);
  const sh = quality === "high";
  const glowMat = (i: number) => (o: THREE.MeshStandardMaterial | null) => {
    glows.current[i] = o;
  };
  const drawerRef = (i: number) => (o: THREE.Group | null) => {
    drawers.current[i] = o;
  };
  return (
    <>
      {FURNITURE.map((f, i) => {
        if (f.kind === "counter")
          return (
            <group key={i} position={[f.x, 0, f.z]} rotation={[0, f.rot, 0]}>
              <mesh position={[0, 0.45, 0]} castShadow={sh} receiveShadow={sh}>
                <boxGeometry args={[1.5, 0.9, 0.75]} />
                <meshStandardMaterial ref={glowMat(f.container)} color="#3d3026" roughness={0.45} metalness={0.1} emissive="#ffd9a0" emissiveIntensity={0} />
              </mesh>
              <mesh position={[0, 1.06, 0]}>
                <boxGeometry args={[1.5, 0.3, 0.75]} />
                <meshStandardMaterial color="#cfe3ee" roughness={0.04} metalness={0.1} transparent opacity={0.22} depthWrite={false} />
              </mesh>
              <mesh position={[0, 1.22, 0]}>
                <boxGeometry args={[1.52, 0.02, 0.77]} />
                <meshStandardMaterial color="#c7a96a" roughness={0.3} metalness={0.8} />
              </mesh>
              {/* 서랍 (뒤지면 앞으로 빠진다) */}
              <group ref={drawerRef(f.container)} position={[0, 0, 0]}>
                <mesh position={[0, 0.62, 0.34]}>
                  <boxGeometry args={[1.1, 0.22, 0.1]} />
                  <meshStandardMaterial color="#5a4636" roughness={0.6} />
                </mesh>
                <mesh position={[0, 0.62, 0.4]}>
                  <boxGeometry args={[0.24, 0.03, 0.03]} />
                  <meshStandardMaterial color="#c7a96a" roughness={0.3} metalness={0.8} />
                </mesh>
              </group>
            </group>
          );
        if (f.kind === "box")
          return (
            <group key={i} position={[f.x, 0, f.z]} rotation={[0, f.rot, 0]}>
              <mesh position={[0, 0.35, 0]} castShadow={sh} receiveShadow={sh}>
                <boxGeometry args={[1.4, 0.7, 1.0]} />
                <meshStandardMaterial ref={glowMat(f.container)} color="#8a6a44" roughness={0.95} emissive="#ffd9a0" emissiveIntensity={0} />
              </mesh>
              <mesh position={[-0.2, 0.95, 0]} rotation={[0, 0.2, 0]} castShadow={sh}>
                <boxGeometry args={[0.8, 0.5, 0.7]} />
                <meshStandardMaterial color="#9b7a50" roughness={0.95} />
              </mesh>
              <group ref={drawerRef(f.container)}>
                <mesh position={[0.35, 0.72, 0.2]} rotation={[-0.6, 0, 0]}>
                  <boxGeometry args={[0.6, 0.02, 0.5]} />
                  <meshStandardMaterial color="#a8875a" roughness={0.95} />
                </mesh>
              </group>
            </group>
          );
        if (f.kind === "locker")
          return (
            <group key={i} position={[f.x, 0, f.z]} rotation={[0, f.rot, 0]}>
              <mesh position={[0, 0.95, 0]} castShadow={sh} receiveShadow={sh}>
                <boxGeometry args={[1.2, 1.9, 0.55]} />
                <meshStandardMaterial ref={glowMat(f.container)} color="#4f5a63" roughness={0.6} metalness={0.5} emissive="#ffd9a0" emissiveIntensity={0} />
              </mesh>
              <group ref={drawerRef(f.container)}>
                {[-0.3, 0.3].map((x) => (
                  <mesh key={x} position={[x, 1.55, 0.28]}>
                    <boxGeometry args={[0.4, 0.04, 0.02]} />
                    <meshStandardMaterial color="#2b3137" />
                  </mesh>
                ))}
              </group>
            </group>
          );
        // 배전반
        return (
          <group key={i} position={[f.x, 0, f.z]} rotation={[0, f.rot, 0]}>
            <mesh position={[0, 1.1, 0]} castShadow={sh} receiveShadow={sh}>
              <boxGeometry args={[1.6, 1.6, 0.5]} />
              <meshStandardMaterial color="#6b6f72" roughness={0.5} metalness={0.6} />
            </mesh>
            {Array.from({ length: 6 }, (_, k) => (
              <mesh key={k} position={[-0.55 + k * 0.22, 1.15, 0.26]}>
                <boxGeometry args={[0.14, 0.42, 0.04]} />
                <meshStandardMaterial
                  ref={(o) => {
                    slots.current[k] = o;
                  }}
                  color="#1a1a1a"
                  emissive="#552222"
                  emissiveIntensity={0.08}
                />
              </mesh>
            ))}
            <mesh position={[0, 1.75, 0.26]}>
              <planeGeometry args={[0.9, 0.22]} />
              <meshStandardMaterial map={panelSign} emissiveMap={panelSign} emissive="#ffffff" emissiveIntensity={0.4} />
            </mesh>
            <pointLight position={[0, 1.4, 0.9]} color="#ffcf6a" intensity={0.8} distance={5} decay={1.8} />
          </group>
        );
      })}
    </>
  );
}

/* ── 정문 셔터 ──────────────────────────────────────────────────────── */

function exitFrame(shutter: THREE.Group | null, sign: THREE.MeshStandardMaterial | null, light: THREE.PointLight | null, sh: SceneShared, dt: number, t: number) {
  const snap = sh.buf.latest();
  if (!snap) return;
  const open = snap.exitOpen;
  if (shutter) shutter.position.y += ((open ? 2.6 : 0) - shutter.position.y) * Math.min(1, dt * 1.2);
  if (sign) sign.emissiveIntensity = open ? 1.4 + Math.sin(t * 9) * 0.6 : 0.45;
  if (light) light.intensity += ((open ? 22 : 0) - light.intensity) * Math.min(1, dt * 2);
}

function ExitShutter({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const tex = useMemo(() => {
    const t = shutterTexture();
    t.repeat.set(1, 3);
    return t;
  }, []);
  const signTex = useMemo(() => labelTexture("비상구 EXIT", { bg: "#0b3d1e", fg: "#c9ffd9", w: 256, h: 64, font: 30 }), []);
  useEffect(
    () => () => {
      tex.dispose();
      signTex.dispose();
    },
    [tex, signTex],
  );
  const shutter = useRef<THREE.Group>(null);
  const sign = useRef<THREE.MeshStandardMaterial>(null);
  const light = useRef<THREE.PointLight>(null);
  useFrame((st, dt) => exitFrame(shutter.current, sign.current, light.current, shared.current, Math.min(0.05, dt), st.clock.elapsedTime));
  const z = EXIT.z + 0.45 - 0.03;
  return (
    <group position={[EXIT.x, 0, z]}>
      <mesh position={[0, 1.3, 0.04]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[1.9, 2.6]} />
        <meshBasicMaterial color="#2c3e5c" />
      </mesh>
      <group ref={shutter}>
        <mesh position={[0, 1.3, 0]} castShadow>
          <boxGeometry args={[1.95, 2.6, 0.05]} />
          <meshStandardMaterial map={tex} roughness={0.45} metalness={0.7} />
        </mesh>
      </group>
      <mesh position={[0, 2.85, -0.04]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[1.1, 0.28]} />
        <meshStandardMaterial ref={sign} map={signTex} emissiveMap={signTex} emissive="#ffffff" emissiveIntensity={0.45} />
      </mesh>
      <pointLight position={[0, 2.6, -0.6]} color="#2bff7a" intensity={0.6} distance={5} decay={1.8} />
      <pointLight ref={light} position={[0, 1.4, -1.2]} color="#a9c6ff" intensity={0} distance={16} decay={1.5} />
    </group>
  );
}

/* ── 마네킹 ─────────────────────────────────────────────────────────── */

interface MqView {
  init: boolean;
  x: number;
  z: number;
  yaw: number;
  pose: number;
  fall: number;
}

function mannequinsFrame(rigs: MannequinRig[], views: MqView[], sh: SceneShared, dt: number, t: number) {
  const snap = sh.buf.latest();
  if (!snap) return;
  const now = performance.now();
  for (let i = 0; i < rigs.length; i++) {
    const r = rigs[i];
    const m = snap.mannequins[i];
    if (!r.root || !m) continue;
    const v = views[i];
    const tgt = sh.buf.mannequin(i, now);
    if (!tgt) continue;
    const seen = v.init && iSee(sh.local, snap, sh.mySeat, v.x, v.z);
    if (!seen) {
      // 내가 안 보는 사이에만 자리를 옮긴다
      const first = !v.init;
      v.init = true;
      v.x = tgt.x;
      v.z = tgt.z;
      v.yaw = tgt.yaw;
      if (v.pose !== tgt.pose || first) {
        v.pose = tgt.pose;
        applyPose(r, v.pose, 1);
      }
    }
    r.root.position.set(v.x, 0, v.z);
    r.root.rotation.y = v.yaw;
    // 쓰러짐 (보고 있어도 보인다 — 노려본 결과니까)
    const fallWant = m.downUntil > snap.t ? 1 : 0;
    v.fall += (fallWant - v.fall) * Math.min(1, dt * (fallWant ? 5 : 2.5));
    if (r.tilt) {
      r.tilt.rotation.x = v.fall * 1.5;
      r.tilt.position.y = v.fall * 0.12;
      // 노려보기가 차오르면 부들부들 떤다
      const tremble = fallWant ? 0 : m.stare;
      r.tilt.rotation.z = tremble > 0.02 ? Math.sin(t * 57 + i) * tremble * 0.05 : 0;
    }
    if (r.eyes) r.eyes.emissiveIntensity = m.revealUntil > snap.t ? 2.0 + Math.sin(t * 8 + i) * 0.6 : 0;
    if (r.band) r.band.visible = m.boundUntil > snap.t;
  }
}

function Mannequins({ shared, quality }: { shared: MutableRefObject<SceneShared>; quality: Quality }) {
  const rigs = useRef<MannequinRig[]>(MANNEQUIN_CELLS.map(() => emptyRig()));
  const views = useRef<MqView[]>(MANNEQUIN_CELLS.map(() => ({ init: false, x: 0, z: 0, yaw: 0, pose: 0, fall: 0 })));
  useFrame((st, dt) => mannequinsFrame(rigs.current, views.current, shared.current, Math.min(0.05, dt), st.clock.elapsedTime));
  return (
    <>
      {MANNEQUIN_CELLS.map((cell, i) => (
        <MannequinBody key={i} bind={(k, v) => (rigs.current[i][k] = v)} room={ROOM[cell]} id={i} kid={ROOM[cell] === "d"} shadows={quality === "high"} />
      ))}
    </>
  );
}

/* ── 동료 ───────────────────────────────────────────────────────────── */

interface MateRefs {
  root: THREE.Group | null;
  body: THREE.Group | null;
  spot: THREE.SpotLight | null;
  tag: THREE.Sprite | null;
  skin: THREE.MeshStandardMaterial[];
}

const STONE = new THREE.Color("#e8e1d5");

function matesFrame(refs: MateRefs[], sh: SceneShared, dt: number, t: number) {
  const snap = sh.buf.latest();
  if (!snap) return;
  const now = performance.now();
  const me = snap.players[sh.mySeat];
  const watching = me && me.st !== "alive" && me.st !== "down" ? sh.local.spectate : -1;
  let lights = 0;
  const dark = snap.flicker.st === "dark";
  for (let seat = 0; seat < refs.length; seat++) {
    const r = refs[seat];
    const p = snap.players[seat];
    if (!r?.root || !r.body) continue;
    const show = !!p && seat !== sh.mySeat && seat !== watching && p.st !== "escaped";
    r.root.visible = show;
    if (r.spot) r.spot.intensity = 0;
    if (!show || !p) continue;
    const pose = sh.buf.body(seat, now) ?? p;
    r.root.position.set(pose.x, 0, pose.z);
    r.root.rotation.y = pose.yaw;
    // 붙잡힌 사람은 그 자리에서 마네킹처럼 굳는다 (하얗게 변한다)
    const stone = p.st !== "alive";
    for (const mat of r.skin) {
      const base = mat.userData.base as THREE.Color | undefined;
      if (!base) continue;
      mat.color.lerpColors(base, STONE, stone ? Math.min(1, (snap.t - p.downAt) / 1200) : 0);
      mat.roughness = stone ? 0.3 : 0.9;
    }
    if (!stone && p.mv > 0) r.body.position.y = Math.abs(Math.sin(t * (p.mv === 3 ? 11 : 7))) * 0.02;
    else r.body.position.y += (0 - r.body.position.y) * Math.min(1, dt * 8);
    if (r.tag) r.tag.material.opacity = p.st === "dead" ? 0.35 : 0.9;
    if (r.spot && p.st === "alive" && p.light && !dark && lights < 3) {
      lights++;
      r.spot.intensity = 22;
      const cp = Math.cos(p.pitch);
      r.spot.target.position.set(pose.x - Math.sin(pose.yaw) * cp * 5, 1.4 + Math.sin(p.pitch) * 5, pose.z - Math.cos(pose.yaw) * cp * 5);
      r.spot.target.updateMatrixWorld();
    }
  }
}

function Mates({ shared, names, seatCount }: { shared: MutableRefObject<SceneShared>; names: Record<number, string>; seatCount: number }) {
  const scene = useThree((s) => s.scene);
  const refs = useRef<MateRefs[]>(Array.from({ length: 4 }, () => ({ root: null, body: null, spot: null, tag: null, skin: [] })));
  const tags = useMemo(() => Array.from({ length: seatCount }, (_, s) => nameTexture(names[s] ?? `${s + 1}번`, SEAT_COLORS[s % 4])), [names, seatCount]);
  useEffect(() => () => tags.forEach((t) => t.dispose()), [tags]);
  useEffect(() => {
    const spots = refs.current.map((r) => r.spot).filter((s): s is THREE.SpotLight => !!s);
    for (const s of spots) scene.add(s.target);
    return () => {
      for (const s of spots) scene.remove(s.target);
    };
  }, [scene, seatCount]);
  useFrame((st, dt) => matesFrame(refs.current, shared.current, Math.min(0.05, dt), st.clock.elapsedTime));
  const skin = (seat: number) => (o: THREE.MeshStandardMaterial | null) => {
    if (!o) return;
    if (!o.userData.base) o.userData.base = o.color.clone();
    const list = refs.current[seat].skin;
    if (!list.includes(o)) list.push(o);
  };
  return (
    <>
      {Array.from({ length: seatCount }, (_, seat) => (
        <group
          key={seat}
          ref={(o) => {
            refs.current[seat].root = o;
          }}
          visible={false}
        >
          <group
            ref={(o) => {
              refs.current[seat].body = o;
            }}
          >
            <mesh position={[0, 0.45, 0]} castShadow>
              <capsuleGeometry args={[0.13, 0.55, 3, 8]} />
              <meshStandardMaterial ref={skin(seat)} color="#23272e" roughness={0.9} />
            </mesh>
            <mesh position={[0, 1.12, 0]} castShadow>
              <capsuleGeometry args={[0.2, 0.42, 4, 10]} />
              <meshStandardMaterial ref={skin(seat)} color="#4a3b33" roughness={0.9} />
            </mesh>
            <mesh position={[0.21, 1.25, 0]}>
              <boxGeometry args={[0.07, 0.11, 0.2]} />
              <meshStandardMaterial color={SEAT_COLORS[seat % 4]} emissive={SEAT_COLORS[seat % 4]} emissiveIntensity={0.5} />
            </mesh>
            <mesh position={[0, 1.6, 0]} castShadow>
              <sphereGeometry args={[0.13, 14, 12]} />
              <meshStandardMaterial ref={skin(seat)} color="#c9a98d" roughness={0.8} />
            </mesh>
            <mesh position={[0, 1.66, 0.02]}>
              <sphereGeometry args={[0.137, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
              <meshStandardMaterial ref={skin(seat)} color="#1b1512" roughness={0.9} />
            </mesh>
            <mesh position={[0.24, 1.0, -0.22]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.025, 0.02, 0.18, 8]} />
              <meshStandardMaterial color="#22252a" roughness={0.5} metalness={0.6} />
            </mesh>
            <spotLight
              ref={(o) => {
                refs.current[seat].spot = o;
              }}
              position={[0.24, 1.0, -0.32]}
              color="#fff4e0"
              angle={0.48}
              penumbra={0.6}
              distance={24}
              decay={1.35}
              intensity={0}
            />
          </group>
          <sprite
            ref={(o) => {
              refs.current[seat].tag = o;
            }}
            position={[0, 2.0, 0]}
            scale={[1.3, 0.325, 1]}
          >
            <spriteMaterial map={tags[seat]} transparent opacity={0.9} depthWrite={false} />
          </sprite>
        </group>
      ))}
    </>
  );
}

/* ── 플래시 ─────────────────────────────────────────────────────────── */

function flashFrame(l: THREE.PointLight | null, sh: SceneShared) {
  if (!l) return;
  const f = sh.flash;
  const age = f ? performance.now() - f.at : 9999;
  if (!f || age > 260) {
    l.intensity = 0;
    return;
  }
  l.position.set(f.x, 1.6, f.z);
  l.intensity = 60 * (1 - age / 260) * (sh.calm ? 0.4 : 1);
}

function FlashFx({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const l = useRef<THREE.PointLight>(null);
  useFrame(() => flashFrame(l.current, shared.current));
  return <pointLight ref={l} color="#f4f7ff" intensity={0} distance={26} decay={1.2} />;
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

export default function MallScene({ shared, names, seatCount, quality, onFps }: { shared: MutableRefObject<SceneShared>; names: Record<number, string>; seatCount: number; quality: Quality; onFps?: (fps: number) => void }) {
  const high = quality === "high";
  return (
    <Canvas shadows={high} dpr={high ? [1, 1.5] : [0.75, 1]} gl={{ antialias: high, powerPreference: "high-performance" }} camera={{ fov: 72, near: 0.06, far: 80, position: [cellX(15), EYE, cellZ(18)] }} style={{ touchAction: "none", background: "#000" }}>
      <color attach="background" args={["#020203"]} />
      <fogExp2 attach="fog" args={["#020203", 0.06]} />
      <ambientLight intensity={0.06} color="#8fa3c2" />
      <CameraRig shared={shared} />
      <Structure quality={quality} />
      <EscalatorVoid />
      <NightLights shared={shared} quality={quality} />
      <ZoneSigns />
      <Furnishings shared={shared} quality={quality} />
      <ExitShutter shared={shared} />
      <Mannequins shared={shared} quality={quality} />
      <Mates shared={shared} names={names} seatCount={seatCount} />
      <FlashFx shared={shared} />
      {onFps && <FpsProbe onFps={onFps} />}
    </Canvas>
  );
}

