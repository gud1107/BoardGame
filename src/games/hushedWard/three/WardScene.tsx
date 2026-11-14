"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EYE_CROUCH, EYE_STAND, SEAT_COLORS } from "../data";
import { stepLocal, syncLocal, type LocalBody } from "../localBody";
import { ALTAR, CELL, CELLS, COLS, CONTAINERS, DOORS, DOOR_POST, EXIT, FURNITURE, KIND, ROOM, ROOM_NAMES, ROWS, WORLD_D, WORLD_W, cellX, cellZ, colOf, idx, rowOf } from "../map";
import type { SnapBuffer } from "../net";
import Ghost, { type GhostFrame } from "./Ghost";
import { ceilingTexture, doorTexture, floorTexture, labelTexture, nameTexture, stainTexture, talismanTexture, wallTexture } from "./textures";

/**
 * 숨죽인 병동 3D 무대 (룰북 §10): 1인칭. 거의 깜깜한 병동을 내 손전등 하나로 비춘다.
 * 벽은 인스턴스 상자, 문짝·서랍장 문은 스냅샷을 보고 열리고, 귀신·동료는 보간 버퍼를 따라 움직인다.
 * 내 몸은 `localBody.ts`가 이 기기에서 직접 움직인다(입력 지연 없음).
 */

export interface SceneShared {
  buf: SnapBuffer;
  local: LocalBody;
  mySeat: number;
  /** 놀람 연출 줄이기 */
  calm: boolean;
}

const WALL_H = 3;
const DOOR_H = 2.15;

type Quality = "high" | "low";

/* ── 카메라 + 손전등 ─────────────────────────────────────────────────── */

interface Rig {
  eye: number;
  roll: number;
  ly: number;
  lp: number;
  fov: number;
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
  let eyeWant = b.cr ? EYE_CROUCH : EYE_STAND;
  let rollWant = 0;
  let lightOn = me.st === "alive" && b.light && me.battery > 0;
  let battery = me.battery;

  if (me.st === "down") {
    eyeWant = 0.32;
    rollWant = 0.95;
  } else if (me.st !== "alive") {
    // 관전: 살아 있는 동료의 눈으로
    const alive = snap.players.filter((p) => p.st === "alive" && p.seat !== sh.mySeat);
    const tgt = alive.find((p) => p.seat === b.spectate) ?? alive[0];
    if (tgt) {
      b.spectate = tgt.seat;
      const pose = sh.buf.body(tgt.seat, now) ?? tgt;
      px = pose.x;
      pz = pose.z;
      yaw = pose.yaw;
      pitch = tgt.pitch;
      eyeWant = tgt.cr ? EYE_CROUCH : EYE_STAND;
      lightOn = tgt.light;
      battery = tgt.battery;
      b.x = px;
      b.z = pz;
    } else {
      eyeWant = 2.4;
      pitch = -0.5;
      lightOn = false;
    }
  }

  // 점프 스케어: 귀신 얼굴 쪽으로 고개가 돌아간다
  if (now < b.scareUntil) {
    const g = sh.buf.ghost(now);
    if (g) {
      const want = Math.atan2(-(g.x - b.x), -(g.z - b.z));
      let d = want - b.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      b.yaw += d * Math.min(1, dt * 18);
      b.pitch += (0.32 - b.pitch) * Math.min(1, dt * 18);
      yaw = b.yaw;
      pitch = b.pitch;
    }
  }

  rig.eye += (eyeWant - rig.eye) * Math.min(1, dt * 9);
  rig.roll += (rollWant - rig.roll) * Math.min(1, dt * 5);
  b.shake = Math.max(0, b.shake - dt * 1.6);
  const fear = me.st === "alive" ? me.fear : 0;
  const tremor = Math.max(0, fear - 55) / 45;
  const sh2 = b.shake * (sh.calm ? 0.25 : 1) * 0.09 + tremor * 0.006;
  const bobY = me.st === "alive" ? Math.sin(b.bob * Math.PI) * (b.mv === 3 ? 0.05 : 0.028) : 0;
  const bobX = me.st === "alive" ? Math.cos(b.bob * Math.PI * 0.5) * 0.012 : 0;
  cam.position.set(px + Math.sin(t * 61) * sh2 + bobX * Math.cos(yaw), rig.eye + bobY + Math.sin(t * 73) * sh2, pz + Math.cos(t * 67) * sh2 - bobX * Math.sin(yaw));
  cam.rotation.set(pitch + Math.sin(t * 2.1) * tremor * 0.004, yaw, rig.roll + Math.sin(t * 1.7) * tremor * 0.006, "YXZ");
  const fovWant = 72 + (b.mv === 3 ? 5 : 0) + (me.hold ? -4 : 0);
  rig.fov += (fovWant - rig.fov) * Math.min(1, dt * 6);
  if (Math.abs(cam.fov - rig.fov) > 0.05) {
    cam.fov = rig.fov;
    cam.updateProjectionMatrix();
  }

  // 손전등: 시선을 살짝 늦게 따라온다
  let dy = yaw - rig.ly;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  rig.ly += dy * Math.min(1, dt * 14);
  rig.lp += (pitch - rig.lp) * Math.min(1, dt * 14);
  if (spot) {
    const cp = Math.cos(rig.lp);
    fwd.set(-Math.sin(rig.ly) * cp, Math.sin(rig.lp), -Math.cos(rig.ly) * cp);
    spot.position.set(cam.position.x + Math.cos(yaw) * 0.16, cam.position.y - 0.14, cam.position.z - Math.sin(yaw) * 0.16);
    spot.target.position.set(spot.position.x + fwd.x * 6, spot.position.y + fwd.y * 6, spot.position.z + fwd.z * 6);
    spot.target.updateMatrixWorld();
    // 건전지가 15% 아래면 깜빡인다
    const weak = battery < 15 ? (Math.sin(t * 31) * Math.sin(t * 7.3) > 0.25 ? 0.25 : 1) * (0.45 + battery / 27) : 1;
    spot.intensity = lightOn ? 21 * weak : 0;
  }
  if (glow) {
    glow.position.copy(cam.position);
    glow.intensity = lightOn ? 0.4 : 0.55;
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
  const rig = useRef<Rig>({ eye: EYE_STAND, roll: 0, ly: 0, lp: 0, fov: 72 });
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
      <spotLight ref={spot} color="#fff1d6" angle={0.62} penumbra={0.85} distance={30} decay={1.3} intensity={0} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} shadow-bias={-0.0006} shadow-camera-near={0.3} shadow-camera-far={26} />
      {/* 어둠에 익은 눈: 손전등이 꺼져도 코앞은 희미하게 보인다 */}
      <pointLight ref={glow} color="#6f86a8" intensity={0.5} distance={7.5} decay={1.5} />
      {/* 손에 든 손전등 */}
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
const v3 = new THREE.Vector3();
const s3 = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);

/** 바닥과 맞닿은 벽 칸만 그린다 */
const WALL_CELLS: number[] = [];
for (let i = 0; i < CELLS; i++) {
  if (KIND[i] !== 0 && KIND[i] !== 3) continue;
  const c = colOf(i);
  const r = rowOf(i);
  let edge = false;
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const nc = c + dc;
    const nr = r + dr;
    if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
    if (KIND[idx(nc, nr)] !== 0 && KIND[idx(nc, nr)] !== 3) edge = true;
  }
  if (edge) WALL_CELLS.push(i);
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
  const posts = useRef<THREE.InstancedMesh>(null);
  const lintels = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const w = walls.current;
    if (w) {
      WALL_CELLS.forEach((cell, i) => {
        m4.makeTranslation(cellX(colOf(cell)), WALL_H / 2, cellZ(rowOf(cell)));
        w.setMatrixAt(i, m4);
      });
      w.instanceMatrix.needsUpdate = true;
    }
    const p = posts.current;
    const l = lintels.current;
    if (p && l) {
      DOORS.forEach((d, i) => {
        q4.setFromAxisAngle(UP, d.ns ? 0 : Math.PI / 2);
        for (const side of [-1, 1]) {
          v3.set(side * (CELL / 2 - DOOR_POST / 2), WALL_H / 2, 0).applyQuaternion(q4);
          v3.x += d.x;
          v3.z += d.z;
          m4.compose(v3, q4, s3);
          p.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), m4);
        }
        v3.set(d.x, DOOR_H + (WALL_H - DOOR_H) / 2, d.z);
        m4.compose(v3, q4, s3);
        l.setMatrixAt(i, m4);
      });
      p.instanceMatrix.needsUpdate = true;
      l.instanceMatrix.needsUpdate = true;
    }
  }, []);
  const high = quality === "high";
  return (
    <>
      <instancedMesh ref={walls} args={[undefined, undefined, WALL_CELLS.length]} castShadow={high} receiveShadow={high} frustumCulled={false}>
        <boxGeometry args={[CELL, WALL_H, CELL]} />
        <meshStandardMaterial map={wallTex} roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={posts} args={[undefined, undefined, DOORS.length * 2]} castShadow={high} receiveShadow={high} frustumCulled={false}>
        <boxGeometry args={[DOOR_POST, WALL_H, CELL]} />
        <meshStandardMaterial color="#7d7a6c" roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={lintels} args={[undefined, undefined, DOORS.length]} castShadow={high} receiveShadow={high} frustumCulled={false}>
        <boxGeometry args={[CELL - DOOR_POST * 2, WALL_H - DOOR_H, CELL]} />
        <meshStandardMaterial color="#8a8778" roughness={0.95} />
      </instancedMesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[WORLD_W / 2, 0, WORLD_D / 2]} receiveShadow={high}>
        <planeGeometry args={[WORLD_W, WORLD_D]} />
        <meshStandardMaterial map={floorTex} roughness={0.78} metalness={0.05} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[WORLD_W / 2, WALL_H, WORLD_D / 2]}>
        <planeGeometry args={[WORLD_W, WORLD_D]} />
        <meshStandardMaterial map={ceilTex} roughness={1} />
      </mesh>
    </>
  );
}

/** 문 위 팻말: 문 건너편 방 이름. 어둠 속에서 희미하게 빛난다 */
function DoorLabels() {
  const items = useMemo(() => {
    const out: { key: string; pos: [number, number, number]; rot: number; tex: THREE.CanvasTexture }[] = [];
    const cache = new Map<string, THREE.CanvasTexture>();
    const tex = (name: string) => {
      let t = cache.get(name);
      if (!t) {
        t = labelTexture(name, { bg: "#16241c", fg: "#b7e3c0" });
        cache.set(name, t);
      }
      return t;
    };
    for (const d of DOORS) {
      const c = colOf(d.cell);
      const r = rowOf(d.cell);
      const a = d.ns ? idx(c, r - 1) : idx(c - 1, r);
      const b = d.ns ? idx(c, r + 1) : idx(c + 1, r);
      const na = ROOM_NAMES[ROOM[a]] ?? "";
      const nb = ROOM_NAMES[ROOM[b]] ?? "";
      const off = CELL / 2 + 0.012;
      if (d.ns) {
        out.push({ key: `${d.i}a`, pos: [d.x, 2.56, d.z - off], rot: Math.PI, tex: tex(nb) });
        out.push({ key: `${d.i}b`, pos: [d.x, 2.56, d.z + off], rot: 0, tex: tex(na) });
      } else {
        out.push({ key: `${d.i}a`, pos: [d.x - off, 2.56, d.z], rot: -Math.PI / 2, tex: tex(nb) });
        out.push({ key: `${d.i}b`, pos: [d.x + off, 2.56, d.z], rot: Math.PI / 2, tex: tex(na) });
      }
    }
    return { out, cache };
  }, []);
  useEffect(() => () => items.cache.forEach((t) => t.dispose()), [items]);
  return (
    <>
      {items.out.map((it) => (
        <mesh key={it.key} position={it.pos} rotation={[0, it.rot, 0]}>
          <planeGeometry args={[1.0, 0.25]} />
          <meshStandardMaterial map={it.tex} emissiveMap={it.tex} emissive="#ffffff" emissiveIntensity={0.22} roughness={0.8} />
        </mesh>
      ))}
    </>
  );
}

/* ── 문짝 ───────────────────────────────────────────────────────────── */

function doorsFrame(hinges: (THREE.Group | null)[], sh: SceneShared, dt: number) {
  const snap = sh.buf.latest();
  if (!snap) return;
  for (let i = 0; i < hinges.length; i++) {
    const h = hinges[i];
    if (!h) continue;
    const want = snap.doors[i] ? -1.5 : 0;
    h.rotation.y += (want - h.rotation.y) * Math.min(1, dt * 9);
  }
}

function Doors({ shared, quality }: { shared: MutableRefObject<SceneShared>; quality: Quality }) {
  const tex = useMemo(() => doorTexture(), []);
  useEffect(() => () => tex.dispose(), [tex]);
  const hinges = useRef<(THREE.Group | null)[]>([]);
  useFrame((_, dt) => doorsFrame(hinges.current, shared.current, Math.min(0.05, dt)));
  const w = CELL - DOOR_POST * 2;
  return (
    <>
      {DOORS.map((d) => (
        <group key={d.i} position={[d.x, 0, d.z]} rotation={[0, d.ns ? 0 : Math.PI / 2, 0]}>
          <group
            ref={(o) => {
              hinges.current[d.i] = o;
            }}
            position={[-w / 2, 0, 0]}
          >
            <mesh position={[w / 2, DOOR_H / 2, 0]} castShadow={quality === "high"}>
              <boxGeometry args={[w, DOOR_H, 0.06]} />
              <meshStandardMaterial map={tex} roughness={0.85} />
            </mesh>
          </group>
        </group>
      ))}
    </>
  );
}

/* ── 가구 ───────────────────────────────────────────────────────────── */

function cabinetsFrame(doors: (THREE.Group | null)[], bodies: (THREE.MeshStandardMaterial | null)[], sh: SceneShared, dt: number, t: number) {
  const snap = sh.buf.latest();
  if (!snap) return;
  const aim = sh.local.target?.kind === "search" ? sh.local.target.n : -1;
  for (const c of CONTAINERS) {
    const open = snap.searched[c.i];
    const l = doors[c.i * 2];
    const r = doors[c.i * 2 + 1];
    const k = Math.min(1, dt * 7);
    if (l) l.rotation.y += ((open ? -1.9 : 0) - l.rotation.y) * k;
    if (r) r.rotation.y += ((open ? 1.75 : 0) - r.rotation.y) * k;
    const m = bodies[c.i];
    if (m) m.emissiveIntensity = aim === c.i ? 0.1 + Math.sin(t * 6) * 0.04 : 0;
  }
}

function Furnishings({ shared, quality }: { shared: MutableRefObject<SceneShared>; quality: Quality }) {
  const cab = useRef<(THREE.Group | null)[]>([]);
  const mats = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  useFrame((st, dt) => cabinetsFrame(cab.current, mats.current, shared.current, Math.min(0.05, dt), st.clock.elapsedTime));
  const sh = quality === "high";
  return (
    <>
      {FURNITURE.map((f, i) => {
        if (f.kind === "cabinet")
          return (
            <group key={i} position={[f.x, 0, f.z]} rotation={[0, f.rot, 0]}>
              <mesh position={[0, 0.92, -0.02]} castShadow={sh} receiveShadow={sh}>
                <boxGeometry args={[1.3, 1.84, 0.5]} />
                <meshStandardMaterial
                  ref={(o) => {
                    mats.current[f.container] = o;
                  }}
                  color="#4c5357"
                  roughness={0.7}
                  metalness={0.35}
                  emissive="#ffd9a0"
                  emissiveIntensity={0}
                />
              </mesh>
              {/* 속 (문이 열리면 보이는 어둠) */}
              <mesh position={[0, 0.92, 0.236]}>
                <planeGeometry args={[1.2, 1.74]} />
                <meshStandardMaterial color="#0a0b0c" roughness={1} />
              </mesh>
              <group
                ref={(o) => {
                  cab.current[f.container * 2] = o;
                }}
                position={[-0.63, 0.92, 0.25]}
              >
                <mesh position={[0.315, 0, 0.012]} castShadow={sh}>
                  <boxGeometry args={[0.62, 1.78, 0.025]} />
                  <meshStandardMaterial color="#5a6266" roughness={0.65} metalness={0.4} />
                </mesh>
                <mesh position={[0.56, 0, 0.04]}>
                  <boxGeometry args={[0.02, 0.2, 0.03]} />
                  <meshStandardMaterial color="#b9b9b0" roughness={0.4} metalness={0.8} />
                </mesh>
              </group>
              <group
                ref={(o) => {
                  cab.current[f.container * 2 + 1] = o;
                }}
                position={[0.63, 0.92, 0.25]}
              >
                <mesh position={[-0.315, 0, 0.012]} castShadow={sh}>
                  <boxGeometry args={[0.62, 1.78, 0.025]} />
                  <meshStandardMaterial color="#5a6266" roughness={0.65} metalness={0.4} />
                </mesh>
                <mesh position={[-0.56, 0, 0.04]}>
                  <boxGeometry args={[0.02, 0.2, 0.03]} />
                  <meshStandardMaterial color="#b9b9b0" roughness={0.4} metalness={0.8} />
                </mesh>
              </group>
            </group>
          );
        if (f.kind === "bed")
          return (
            <group key={i} position={[f.x, 0, f.z]} rotation={[0, f.rot, 0]}>
              <mesh position={[0, 0.3, 0]} castShadow={sh} receiveShadow={sh}>
                <boxGeometry args={[1.0, 0.1, 1.9]} />
                <meshStandardMaterial color="#6d7378" roughness={0.5} metalness={0.6} />
              </mesh>
              {[[-0.46, -0.9], [0.46, -0.9], [-0.46, 0.9], [0.46, 0.9]].map(([x, z], k) => (
                <mesh key={k} position={[x, z < 0 ? 0.42 : 0.3, z]} castShadow={sh}>
                  <cylinderGeometry args={[0.025, 0.025, z < 0 ? 0.84 : 0.6, 6]} />
                  <meshStandardMaterial color="#7b8187" roughness={0.5} metalness={0.6} />
                </mesh>
              ))}
              <mesh position={[0, 0.43, 0]} castShadow={sh} receiveShadow={sh}>
                <boxGeometry args={[0.92, 0.16, 1.8]} />
                <meshStandardMaterial color="#9c998a" roughness={1} />
              </mesh>
              <mesh position={[0, 0.55, -0.68]} rotation={[0, 0.15, 0]}>
                <boxGeometry args={[0.6, 0.1, 0.34]} />
                <meshStandardMaterial color="#aaa696" roughness={1} />
              </mesh>
              <mesh position={[0.08, 0.53, 0.38]} rotation={[0, -0.12, 0.04]}>
                <boxGeometry args={[0.94, 0.07, 0.95]} />
                <meshStandardMaterial color="#59645c" roughness={1} />
              </mesh>
            </group>
          );
        if (f.kind === "table")
          return (
            <group key={i} position={[f.x, 0, f.z]} rotation={[0, f.rot, 0]}>
              <mesh position={[0, 0.84, 0]} castShadow={sh} receiveShadow={sh}>
                <boxGeometry args={[1.7, 0.06, 0.9]} />
                <meshStandardMaterial color="#8b9197" roughness={0.35} metalness={0.75} />
              </mesh>
              {[[-0.78, -0.38], [0.78, -0.38], [-0.78, 0.38], [0.78, 0.38]].map(([x, z], k) => (
                <mesh key={k} position={[x, 0.41, z]} castShadow={sh}>
                  <boxGeometry args={[0.05, 0.82, 0.05]} />
                  <meshStandardMaterial color="#63686d" roughness={0.5} metalness={0.6} />
                </mesh>
              ))}
            </group>
          );
        if (f.kind === "bench")
          return (
            <group key={i} position={[f.x, 0, f.z]} rotation={[0, f.rot, 0]}>
              <mesh position={[0, 0.44, 0.02]} castShadow={sh} receiveShadow={sh}>
                <boxGeometry args={[1.6, 0.07, 0.46]} />
                <meshStandardMaterial color="#5b3f2c" roughness={0.9} />
              </mesh>
              <mesh position={[0, 0.78, -0.2]} castShadow={sh}>
                <boxGeometry args={[1.6, 0.5, 0.05]} />
                <meshStandardMaterial color="#5b3f2c" roughness={0.9} />
              </mesh>
              {[-0.7, 0.7].map((x) => (
                <mesh key={x} position={[x, 0.22, 0]}>
                  <boxGeometry args={[0.06, 0.44, 0.44]} />
                  <meshStandardMaterial color="#2a2c2e" roughness={0.6} metalness={0.5} />
                </mesh>
              ))}
            </group>
          );
        return null;
      })}
    </>
  );
}

/* ── 제단 ───────────────────────────────────────────────────────────── */

function altarFrame(papers: (THREE.Mesh | null)[], light: THREE.PointLight | null, flames: (THREE.Mesh | null)[], sh: SceneShared, t: number) {
  const snap = sh.buf.latest();
  if (!snap) return;
  for (let i = 0; i < papers.length; i++) {
    const p = papers[i];
    if (!p) continue;
    p.visible = i < snap.need;
    const placed = i < snap.placed;
    const m = p.material as THREE.MeshStandardMaterial;
    m.opacity = placed ? 1 : 0.1;
    m.emissiveIntensity = placed ? 0.35 + Math.sin(t * 3 + i) * 0.1 : 0;
  }
  const fl = 0.75 + Math.sin(t * 11) * 0.12 + Math.sin(t * 23.7) * 0.08;
  if (light) light.intensity = (1.6 + snap.placed * 0.9) * fl;
  for (const f of flames) if (f) f.scale.setScalar(0.8 + fl * 0.4);
}

function Altar({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const tex = useMemo(() => talismanTexture(), []);
  useEffect(() => () => tex.dispose(), [tex]);
  const papers = useRef<(THREE.Mesh | null)[]>([]);
  const flames = useRef<(THREE.Mesh | null)[]>([]);
  const light = useRef<THREE.PointLight>(null);
  useFrame((st) => altarFrame(papers.current, light.current, flames.current, shared.current, st.clock.elapsedTime));
  const f = FURNITURE.find((it) => it.kind === "altar");
  if (!f) return null;
  const wallZ = cellZ(rowOf(f.cell)) - CELL / 2 + 0.012;
  return (
    <>
      <group position={[f.x, 0, f.z]}>
        <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.6, 0.9, 0.7]} />
          <meshStandardMaterial color="#3b1512" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.91, 0]}>
          <boxGeometry args={[1.7, 0.03, 0.78]} />
          <meshStandardMaterial color="#7a1f17" roughness={1} />
        </mesh>
        {/* 향로 */}
        <mesh position={[0, 1.0, 0]}>
          <cylinderGeometry args={[0.12, 0.08, 0.14, 12]} />
          <meshStandardMaterial color="#8a6a2c" roughness={0.4} metalness={0.8} />
        </mesh>
        {[-0.6, 0.6].map((x, i) => (
          <group key={x} position={[x, 0.93, 0.05]}>
            <mesh position={[0, 0.13, 0]}>
              <cylinderGeometry args={[0.03, 0.035, 0.26, 8]} />
              <meshStandardMaterial color="#d8d2bd" roughness={0.6} />
            </mesh>
            <mesh
              ref={(o) => {
                flames.current[i] = o;
              }}
              position={[0, 0.3, 0]}
            >
              <sphereGeometry args={[0.028, 8, 8]} />
              <meshBasicMaterial color="#ffc46b" />
            </mesh>
          </group>
        ))}
        <pointLight ref={light} position={[0, 1.5, 0.5]} color="#ff9a3c" intensity={1.6} distance={9} decay={1.7} />
      </group>
      {/* 벽에 붙는 봉인 부적 (빈 자리는 흐릿한 자국) */}
      {Array.from({ length: 6 }, (_, i) => (
        <mesh
          key={i}
          ref={(o) => {
            papers.current[i] = o;
          }}
          position={[ALTAR.x + (i - 2.5) * 0.3, 1.9 + (i % 2) * 0.12, wallZ]}
          rotation={[0, 0, ((i % 3) - 1) * 0.05]}
        >
          <planeGeometry args={[0.2, 0.52]} />
          <meshStandardMaterial map={tex} emissiveMap={tex} emissive="#ffb347" emissiveIntensity={0} transparent opacity={0.1} roughness={0.9} />
        </mesh>
      ))}
    </>
  );
}

/* ── 현관 ───────────────────────────────────────────────────────────── */

function exitFrame(l: THREE.Group | null, r: THREE.Group | null, light: THREE.PointLight | null, sign: THREE.MeshStandardMaterial | null, sh: SceneShared, dt: number, t: number) {
  const snap = sh.buf.latest();
  if (!snap) return;
  const open = snap.exitOpen;
  const k = Math.min(1, dt * 3);
  if (l) l.rotation.y += ((open ? 1.35 : 0) - l.rotation.y) * k;
  if (r) r.rotation.y += ((open ? -1.35 : 0) - r.rotation.y) * k;
  if (light) light.intensity += ((open ? 26 : 0) - light.intensity) * k;
  if (sign) sign.emissiveIntensity = open ? 1.4 + Math.sin(t * 9) * 0.6 : 0.45;
}

function ExitDoor({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const tex = useMemo(() => labelTexture("비상구 EXIT", { bg: "#0b3d1e", fg: "#c9ffd9", w: 256, h: 64, font: 30 }), []);
  useEffect(() => () => tex.dispose(), [tex]);
  const l = useRef<THREE.Group>(null);
  const r = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  const sign = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((st, dt) => exitFrame(l.current, r.current, light.current, sign.current, shared.current, Math.min(0.05, dt), st.clock.elapsedTime));
  const z = EXIT.z + 0.45 - 0.03;
  return (
    <group position={[EXIT.x, 0, z]}>
      {/* 문 너머 새벽빛 */}
      <mesh position={[0, 1.15, 0.02]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[1.7, 2.3]} />
        <meshBasicMaterial color="#9fc4e8" />
      </mesh>
      <group ref={l} position={[-0.85, 0, -0.03]}>
        <mesh position={[0.425, 1.15, 0]} castShadow>
          <boxGeometry args={[0.85, 2.3, 0.06]} />
          <meshStandardMaterial color="#39424a" roughness={0.5} metalness={0.6} />
        </mesh>
      </group>
      <group ref={r} position={[0.85, 0, -0.03]}>
        <mesh position={[-0.425, 1.15, 0]} castShadow>
          <boxGeometry args={[0.85, 2.3, 0.06]} />
          <meshStandardMaterial color="#39424a" roughness={0.5} metalness={0.6} />
        </mesh>
      </group>
      <mesh position={[0, 2.58, -0.02]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[1.1, 0.28]} />
        <meshStandardMaterial ref={sign} map={tex} emissiveMap={tex} emissive="#ffffff" emissiveIntensity={0.45} />
      </mesh>
      <pointLight position={[0, 2.3, -0.6]} color="#2bff7a" intensity={0.5} distance={5} decay={1.8} />
      <pointLight ref={light} position={[0, 1.4, -1.2]} color="#bcd9ff" intensity={0} distance={16} decay={1.5} />
    </group>
  );
}

/* ── 비상등 · 얼룩 ──────────────────────────────────────────────────── */

const RED_LIGHTS: [number, number][] = [[1, 5], [27, 13], [10, 9], [18, 9], [27, 5], [1, 13]];

function redFrame(lights: (THREE.PointLight | null)[], t: number) {
  for (let i = 0; i < lights.length; i++) {
    const l = lights[i];
    if (!l) continue;
    // 가끔 꺼졌다 켜진다
    const off = Math.sin(t * (0.7 + i * 0.13) + i * 2.1) > 0.93 || Math.sin(t * 19 + i * 5) > 0.985;
    l.intensity = off ? 0.05 : 1.5 + Math.sin(t * 3 + i) * 0.2;
  }
}

function EmergencyLights({ quality }: { quality: Quality }) {
  const refs = useRef<(THREE.PointLight | null)[]>([]);
  useFrame((st) => redFrame(refs.current, st.clock.elapsedTime));
  const list = quality === "high" ? RED_LIGHTS : RED_LIGHTS.slice(0, 3);
  return (
    <>
      {list.map(([c, r], i) => (
        <group key={i} position={[cellX(c), WALL_H - 0.08, cellZ(r)]}>
          <mesh>
            <boxGeometry args={[0.3, 0.08, 0.14]} />
            <meshStandardMaterial color="#3a0a08" emissive="#ff2414" emissiveIntensity={1.2} />
          </mesh>
          <pointLight
            ref={(o) => {
              refs.current[i] = o;
            }}
            position={[0, -0.25, 0]}
            color="#ff2a18"
            intensity={1.5}
            distance={8}
            decay={1.7}
          />
        </group>
      ))}
    </>
  );
}

const STAINS: [number, number, number, number][] = [
  [5, 5, 1.6, 1], [14, 13, 2.2, 2], [22, 5, 1.4, 3], [10, 10, 1.8, 4], [18, 7, 1.5, 5], [5.5, 9, 2.4, 6], [22.5, 10, 2.6, 7], [8.5, 16, 2, 8], [14, 9.5, 1.7, 9], [27, 9, 1.6, 10],
];

function Stains() {
  const texs = useMemo(() => STAINS.map(([, , , seed]) => stainTexture(seed * 13)), []);
  useEffect(() => () => texs.forEach((t) => t.dispose()), [texs]);
  return (
    <>
      {STAINS.map(([c, r, size, seed], i) => (
        <mesh key={i} position={[cellX(c), 0.006 + i * 0.0004, cellZ(r)]} rotation={[-Math.PI / 2, 0, seed * 1.3]}>
          <planeGeometry args={[size, size]} />
          <meshStandardMaterial map={texs[i]} transparent depthWrite={false} roughness={0.35} />
        </mesh>
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
}

function matesFrame(refs: MateRefs[], sh: SceneShared, dt: number, t: number) {
  const snap = sh.buf.latest();
  if (!snap) return;
  const now = performance.now();
  const me = snap.players[sh.mySeat];
  const watching = me && me.st !== "alive" && me.st !== "down" ? sh.local.spectate : -1;
  let lights = 0;
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
    const lying = p.st !== "alive";
    const k = Math.min(1, dt * 8);
    const wantX = lying ? -Math.PI / 2 : 0;
    r.body.rotation.x += (wantX - r.body.rotation.x) * k;
    const wantY = lying ? 0.22 : 0;
    r.body.position.y += (wantY - r.body.position.y) * k;
    const sy = lying ? 1 : p.cr ? 0.66 : 1;
    r.body.scale.y += (sy - r.body.scale.y) * k;
    if (!lying && p.mv > 0) r.body.position.y += Math.abs(Math.sin(t * (p.mv === 3 ? 11 : 7))) * 0.02;
    if (r.tag) {
      r.tag.position.y = lying ? 0.75 : p.cr ? 1.45 : 2.0;
      r.tag.material.opacity = p.st === "dead" ? 0.35 : 0.9;
    }
    if (r.spot && p.st === "alive" && p.light && lights < 3) {
      lights++;
      r.spot.intensity = 22;
      const cp = Math.cos(p.pitch);
      r.spot.target.position.set(pose.x - Math.sin(pose.yaw) * cp * 5, (p.cr ? 0.9 : 1.4) + Math.sin(p.pitch) * 5, pose.z - Math.cos(pose.yaw) * cp * 5);
      r.spot.target.updateMatrixWorld();
    }
  }
}

function Mates({ shared, names, seatCount }: { shared: MutableRefObject<SceneShared>; names: Record<number, string>; seatCount: number }) {
  const scene = useThree((s) => s.scene);
  const refs = useRef<MateRefs[]>(Array.from({ length: 4 }, () => ({ root: null, body: null, spot: null, tag: null })));
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
              <meshStandardMaterial color="#23272e" roughness={0.9} />
            </mesh>
            <mesh position={[0, 1.12, 0]} castShadow>
              <capsuleGeometry args={[0.2, 0.42, 4, 10]} />
              <meshStandardMaterial color="#39414d" roughness={0.9} />
            </mesh>
            {/* 자리 색 완장 */}
            <mesh position={[0.21, 1.25, 0]}>
              <boxGeometry args={[0.07, 0.11, 0.2]} />
              <meshStandardMaterial color={SEAT_COLORS[seat % 4]} emissive={SEAT_COLORS[seat % 4]} emissiveIntensity={0.5} />
            </mesh>
            <mesh position={[0, 1.6, 0]} castShadow>
              <sphereGeometry args={[0.13, 14, 12]} />
              <meshStandardMaterial color="#c9a98d" roughness={0.8} />
            </mesh>
            <mesh position={[0, 1.66, 0.02]}>
              <sphereGeometry args={[0.137, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
              <meshStandardMaterial color="#1b1512" roughness={0.9} />
            </mesh>
            {/* 손전등 */}
            <mesh position={[0.24, 1.0, -0.22]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.025, 0.02, 0.18, 8]} />
              <meshStandardMaterial color="#22252a" roughness={0.5} metalness={0.6} />
            </mesh>
            <spotLight
              ref={(o) => {
                refs.current[seat].spot = o;
              }}
              position={[0.24, 1.0, -0.32]}
              color="#fff1d6"
              angle={0.48}
              penumbra={0.6}
              distance={22}
              decay={1.4}
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

/* ── 귀신 · 날아가는 약병 ───────────────────────────────────────────── */

function ghostFrame(frame: GhostFrame, sh: SceneShared) {
  const g = sh.buf.ghost(performance.now());
  const snap = sh.buf.latest();
  if (!g || !snap) {
    frame.visible = false;
    return;
  }
  frame.x = g.x;
  frame.z = g.z;
  frame.yaw = g.yaw;
  frame.mode = g.mode;
  frame.visible = snap.phase === "play" || snap.phase === "gameOver";
}

function GhostActor({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const frame = useRef<GhostFrame>({ x: 0, z: 0, yaw: 0, mode: "sleep", visible: false });
  useFrame(() => ghostFrame(frame.current, shared.current));
  return <Ghost frame={frame} />;
}

function bottlesFrame(meshes: (THREE.Mesh | null)[], sh: SceneShared) {
  const snap = sh.buf.latest();
  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i];
    if (!m) continue;
    const b = snap?.bottles[i];
    if (!b || !snap) {
      m.visible = false;
      continue;
    }
    // 스냅샷 뒤로 흐른 시간만큼 앞서 그린다
    const age = sh.buf.curr ? performance.now() - sh.buf.curr.at : 0;
    const k = Math.max(0, Math.min(1, (snap.t + age - b.t0) / Math.max(1, b.t1 - b.t0)));
    m.visible = true;
    m.position.set(b.x + (b.x2 - b.x) * k, 1.35 + Math.sin(k * Math.PI) * 0.9 - k * 1.25, b.z + (b.z2 - b.z) * k);
    m.rotation.set(k * 14, k * 5, 0);
  }
}

function Bottles({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(() => bottlesFrame(meshes.current, shared.current));
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <mesh
          key={i}
          ref={(o) => {
            meshes.current[i] = o;
          }}
          visible={false}
        >
          <cylinderGeometry args={[0.035, 0.04, 0.2, 8]} />
          <meshStandardMaterial color="#8a5a2a" roughness={0.2} metalness={0.1} transparent opacity={0.85} emissive="#5a3a18" emissiveIntensity={0.4} />
        </mesh>
      ))}
    </>
  );
}

/* ── 프레임 속도 감시 (자동 화질) ───────────────────────────────────── */

function fpsFrame(acc: { t: number; n: number; done: boolean }, dt: number, onFps: (fps: number) => void) {
  if (acc.done) return;
  acc.t += dt;
  acc.n++;
  if (acc.t < 4) return;
  // 처음 1초는 준비 시간이라 뺀 셈 치고 넉넉히 본다
  acc.done = true;
  onFps(acc.n / acc.t);
}

function FpsProbe({ onFps }: { onFps: (fps: number) => void }) {
  const acc = useRef({ t: 0, n: 0, done: false });
  useFrame((_, dt) => fpsFrame(acc.current, dt, onFps));
  return null;
}

export default function WardScene({ shared, names, seatCount, quality, onFps }: { shared: MutableRefObject<SceneShared>; names: Record<number, string>; seatCount: number; quality: Quality; onFps?: (fps: number) => void }) {
  const high = quality === "high";
  return (
    <Canvas shadows={high} dpr={high ? [1, 1.5] : [0.75, 1]} gl={{ antialias: high, powerPreference: "high-performance" }} camera={{ fov: 72, near: 0.06, far: 70, position: [cellX(14), EYE_STAND, cellZ(16)] }} style={{ touchAction: "none", background: "#000" }}>
      <color attach="background" args={["#010203"]} />
      <fogExp2 attach="fog" args={["#010203", 0.085]} />
      <ambientLight intensity={0.07} color="#8fa3c2" />
      <CameraRig shared={shared} />
      <Structure quality={quality} />
      <DoorLabels />
      <Doors shared={shared} quality={quality} />
      <Furnishings shared={shared} quality={quality} />
      <Altar shared={shared} />
      <ExitDoor shared={shared} />
      <EmergencyLights quality={quality} />
      <Stains />
      <Mates shared={shared} names={names} seatCount={seatCount} />
      <GhostActor shared={shared} />
      <Bottles shared={shared} />
      {onFps && <FpsProbe onFps={onFps} />}
    </Canvas>
  );
}
