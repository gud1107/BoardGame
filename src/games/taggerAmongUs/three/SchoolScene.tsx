"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EYE_CROUCH, EYE_MASK, EYE_STAND, KID_HEAR_MUL, SEAT_COLORS } from "../data";
import { stepLocal, syncLocal, type LocalBody } from "../localBody";
import { CELL, CELLS, COLS, DOORS, DOOR_POST, EXITS, FURNITURE, KIND, ROOM, ROOM_NAMES, ROWS, SPOTS, WORLD_D, WORLD_W, cellX, cellZ, colOf, idx, rowOf } from "../map";
import type { SnapBuffer } from "../net";
import { noiseRadiusOf } from "../sim";
import { ceilingTexture, doorTexture, floorTexture, labelTexture, maskFaceTexture, nameTexture, stainTexture, talismanTexture, wallTexture } from "./textures";

/**
 * 술래는 우리 중에 3D 무대 (룰북 §8): 1인칭. 달빛만 드는 폐교를 손전등 하나로 비춘다.
 * 벽은 인스턴스 상자, 문짝·장승·교문은 스냅샷을 보고 움직이고, 남의 몸은 보간 버퍼를 따라간다.
 * 내 몸은 `localBody.ts`가 이 기기에서 직접 움직인다(입력 지연 없음).
 *
 * 변장한 술래는 다른 아이와 **똑같이** 그린다. 가면을 쓰면 그 자리의 아이가 사라지고 키 큰 탈이 선다.
 * 술래 눈에는 손전등 대신 붉은 밤눈이 켜지고, 벽 너머 발소리가 바닥의 파문으로 보인다.
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
  const tagger = me.role === "tagger";
  const form = snap.tg.form;
  const masked = tagger && form !== "kid";
  let px = b.x;
  let pz = b.z;
  let yaw = b.yaw;
  let pitch = b.pitch;
  let eyeWant = masked ? EYE_MASK : b.cr ? EYE_CROUCH : EYE_STAND;
  let lightOn = me.st === "alive" && b.light && !masked;

  if (me.st === "out" || me.st === "escaped") {
    // 관전: 아직 뛰고 있는 친구의 눈으로
    const alive = snap.players.filter((p) => p.role === "runner" && p.st === "alive" && p.seat !== sh.mySeat);
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
      b.x = px;
      b.z = pz;
    } else {
      eyeWant = 2.5;
      pitch = -0.5;
      lightOn = false;
    }
  }

  rig.eye += (eyeWant - rig.eye) * Math.min(1, dt * (masked ? 3 : 9));
  b.shake = Math.max(0, b.shake - dt * 1.6);
  const stunned = tagger && snap.t < snap.tg.stunUntil;
  const sh2 = b.shake * (sh.calm ? 0.25 : 1) * 0.09 + (stunned ? 0.012 : 0);
  const walking = me.st === "alive" && b.mv > 0;
  const bobY = walking ? Math.sin(b.bob * Math.PI) * (masked ? 0.07 : b.mv === 3 ? 0.05 : 0.028) : 0;
  const bobX = walking ? Math.cos(b.bob * Math.PI * 0.5) * 0.012 : 0;
  cam.position.set(px + Math.sin(t * 61) * sh2 + bobX * Math.cos(yaw), rig.eye + bobY + Math.sin(t * 73) * sh2, pz + Math.cos(t * 67) * sh2 - bobX * Math.sin(yaw));
  cam.rotation.set(pitch, yaw, stunned ? Math.sin(t * 9) * 0.05 : 0, "YXZ");
  const lunging = masked && (now < b.lungeUntil || snap.t < snap.tg.swingUntil);
  const fovWant = masked ? (lunging ? 94 : 82) : 72 + (b.mv === 3 ? 5 : 0);
  rig.fov += (fovWant - rig.fov) * Math.min(1, dt * 8);
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
    spot.intensity = lightOn ? 21 : 0;
  }
  if (glow) {
    glow.position.copy(cam.position);
    // 가면을 쓰면 붉은 밤눈: 손전등 없이도 멀리까지 본다
    glow.color.set(masked ? "#ff6a4a" : "#6f86a8");
    glow.distance = masked ? 19 : 7.5;
    glow.intensity = masked ? 3.4 : lightOn ? 0.4 : 0.6;
  }
  if (vm) {
    vm.visible = me.st === "alive" && !masked;
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
  const rig = useRef<Rig>({ eye: EYE_STAND, ly: 0, lp: 0, fov: 72 });
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
        <meshStandardMaterial map={wallTex} color="#c9c2a8" roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={posts} args={[undefined, undefined, DOORS.length * 2]} castShadow={high} receiveShadow={high} frustumCulled={false}>
        <boxGeometry args={[DOOR_POST, WALL_H, CELL]} />
        <meshStandardMaterial color="#6f5a41" roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={lintels} args={[undefined, undefined, DOORS.length]} castShadow={high} receiveShadow={high} frustumCulled={false}>
        <boxGeometry args={[CELL - DOOR_POST * 2, WALL_H - DOOR_H, CELL]} />
        <meshStandardMaterial color="#8d8468" roughness={0.95} />
      </instancedMesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[WORLD_W / 2, 0, WORLD_D / 2]} receiveShadow={high}>
        <planeGeometry args={[WORLD_W, WORLD_D]} />
        <meshStandardMaterial map={floorTex} color="#b89a72" roughness={0.7} metalness={0.05} />
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
        t = labelTexture(name, { bg: "#1d2433", fg: "#d7e2ff" });
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

function doorsFrame(hinges: (THREE.Group | null)[], sh: SceneShared, dt: number, t: number) {
  const snap = sh.buf.latest();
  if (!snap) return;
  for (let i = 0; i < hinges.length; i++) {
    const h = hinges[i];
    if (!h) continue;
    // 술래가 부수는 중인 문은 덜컹거린다
    const rattle = snap.tg.bash === i ? Math.sin(t * 46) * 0.06 : 0;
    const want = snap.doors[i] ? -1.5 : rattle;
    h.rotation.y += (want - h.rotation.y) * Math.min(1, dt * (rattle !== 0 ? 30 : 9));
  }
}

function Doors({ shared, quality }: { shared: MutableRefObject<SceneShared>; quality: Quality }) {
  const tex = useMemo(() => doorTexture(), []);
  useEffect(() => () => tex.dispose(), [tex]);
  const hinges = useRef<(THREE.Group | null)[]>([]);
  useFrame((st, dt) => doorsFrame(hinges.current, shared.current, Math.min(0.05, dt), st.clock.elapsedTime));
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
              <meshStandardMaterial map={tex} color="#b08a5c" roughness={0.85} />
            </mesh>
          </group>
        </group>
      ))}
    </>
  );
}

/* ── 가구 ───────────────────────────────────────────────────────────── */

function Furnishings({ quality }: { quality: Quality }) {
  const sh = quality === "high";
  return (
    <>
      {FURNITURE.map((f, i) => {
        if (f.kind === "desk")
          return (
            <group key={i} position={[f.x, 0, f.z]} rotation={[0, f.rot, 0]}>
              <mesh position={[0, 0.7, 0]} castShadow={sh} receiveShadow={sh}>
                <boxGeometry args={[1.3, 0.05, 0.8]} />
                <meshStandardMaterial color="#8a6b45" roughness={0.8} />
              </mesh>
              {[[-0.58, -0.33], [0.58, -0.33], [-0.58, 0.33], [0.58, 0.33]].map(([x, z], k) => (
                <mesh key={k} position={[x, 0.34, z]} castShadow={sh}>
                  <boxGeometry args={[0.04, 0.68, 0.04]} />
                  <meshStandardMaterial color="#4b4f55" roughness={0.5} metalness={0.6} />
                </mesh>
              ))}
              {/* 걸상 */}
              <mesh position={[0, 0.42, 0.62]} castShadow={sh}>
                <boxGeometry args={[0.4, 0.04, 0.38]} />
                <meshStandardMaterial color="#7a5c3a" roughness={0.85} />
              </mesh>
              <mesh position={[0, 0.7, 0.8]}>
                <boxGeometry args={[0.4, 0.3, 0.03]} />
                <meshStandardMaterial color="#7a5c3a" roughness={0.85} />
              </mesh>
            </group>
          );
        if (f.kind === "locker")
          return (
            <group key={i} position={[f.x, 0, f.z]} rotation={[0, f.rot, 0]}>
              <mesh position={[0, 0.9, 0]} castShadow={sh} receiveShadow={sh}>
                <boxGeometry args={[1.4, 1.8, 0.5]} />
                <meshStandardMaterial color="#51606b" roughness={0.6} metalness={0.45} />
              </mesh>
              {[-0.35, 0.35].map((x) => (
                <mesh key={x} position={[x, 1.0, 0.256]}>
                  <boxGeometry args={[0.66, 1.56, 0.012]} />
                  <meshStandardMaterial color="#5d6e7a" roughness={0.55} metalness={0.5} />
                </mesh>
              ))}
            </group>
          );
        if (f.kind === "shelf")
          return (
            <group key={i} position={[f.x, 0, f.z]} rotation={[0, f.rot, 0]}>
              <mesh position={[0, 0.95, -0.02]} castShadow={sh} receiveShadow={sh}>
                <boxGeometry args={[1.6, 1.9, 0.4]} />
                <meshStandardMaterial color="#5e4630" roughness={0.9} />
              </mesh>
              {[0.35, 0.8, 1.25, 1.7].map((y, k) => (
                <mesh key={y} position={[(k % 2 ? 0.12 : -0.1), y, 0.19]}>
                  <boxGeometry args={[1.25, 0.26, 0.05]} />
                  <meshStandardMaterial color={["#6d2f2a", "#2f4a63", "#63572a", "#3b5a3c"][k]} roughness={0.9} />
                </mesh>
              ))}
            </group>
          );
        if (f.kind === "piano")
          return (
            <group key={i} position={[f.x, 0, f.z]} rotation={[0, f.rot, 0]}>
              <mesh position={[0, 0.62, 0]} castShadow={sh} receiveShadow={sh}>
                <boxGeometry args={[1.5, 1.24, 0.6]} />
                <meshStandardMaterial color="#15110f" roughness={0.35} metalness={0.2} />
              </mesh>
              <mesh position={[0, 0.74, 0.36]}>
                <boxGeometry args={[1.3, 0.05, 0.22]} />
                <meshStandardMaterial color="#e8e2d0" roughness={0.5} />
              </mesh>
            </group>
          );
        if (f.kind === "vault")
          return (
            <group key={i} position={[f.x, 0, f.z]}>
              {[0.2, 0.42, 0.64, 0.86].map((y, k) => (
                <mesh key={y} position={[0, y, 0]} castShadow={sh} receiveShadow={sh}>
                  <boxGeometry args={[1.5 - k * 0.14, 0.2, 0.7 - k * 0.05]} />
                  <meshStandardMaterial color={k === 3 ? "#8a6f52" : "#a58a62"} roughness={0.9} />
                </mesh>
              ))}
            </group>
          );
        if (f.kind === "pillar")
          return (
            <mesh key={i} position={[f.x, WALL_H / 2, f.z]} castShadow={sh} receiveShadow={sh}>
              <boxGeometry args={[0.8, WALL_H, 0.8]} />
              <meshStandardMaterial color="#9d977f" roughness={0.95} />
            </mesh>
          );
        return null;
      })}
    </>
  );
}

/* ── 장승 (봉인 터) ─────────────────────────────────────────────────── */

interface TotemRefs {
  paper: THREE.Mesh | null;
  ring: THREE.Mesh | null;
  wood: THREE.MeshStandardMaterial | null;
  eyes: THREE.MeshBasicMaterial | null;
}

function totemsFrame(refs: TotemRefs[], sh: SceneShared, t: number) {
  const snap = sh.buf.latest();
  if (!snap) return;
  const aim = sh.local.target && (sh.local.target.kind === "seal" || sh.local.target.kind === "kick") ? snap.spots[sh.local.target.n]?.i : -1;
  const byDef = new Map<number, { p: number; done: boolean }>();
  for (const sp of snap.spots) byDef.set(sp.i, sp);
  for (let i = 0; i < refs.length; i++) {
    const r = refs[i];
    const sp = byDef.get(i);
    const awake = !!sp;
    if (r.paper) {
      // 깨어난 장승에만 봉인 부적 자리가 있다: 진행도만큼 또렷해진다
      r.paper.visible = awake;
      const m = r.paper.material as THREE.MeshStandardMaterial;
      m.opacity = !sp ? 0 : sp.done ? 1 : 0.18 + sp.p * 0.7;
      m.emissiveIntensity = !sp ? 0 : sp.done ? 0.9 + Math.sin(t * 3 + i) * 0.15 : sp.p * 0.5;
    }
    if (r.ring) {
      r.ring.visible = awake && !sp.done;
      const m = r.ring.material as THREE.MeshBasicMaterial;
      m.opacity = 0.25 + Math.sin(t * 2.2 + i) * 0.12 + (aim === i ? 0.3 : 0);
      r.ring.scale.setScalar(1 + (sp?.p ?? 0) * 0.5);
    }
    if (r.wood) r.wood.emissiveIntensity = aim === i ? 0.16 + Math.sin(t * 6) * 0.05 : sp?.done ? 0.12 : 0;
    // 아직 봉인 안 된 장승은 눈이 붉게 뜬다
    if (r.eyes) r.eyes.color.set(!awake ? "#1a1210" : sp.done ? "#ffd27a" : "#ff3a22");
  }
}

function Totems({ shared, quality }: { shared: MutableRefObject<SceneShared>; quality: Quality }) {
  const tex = useMemo(() => talismanTexture(), []);
  useEffect(() => () => tex.dispose(), [tex]);
  const refs = useRef<TotemRefs[]>(SPOTS.map(() => ({ paper: null, ring: null, wood: null, eyes: null })));
  useFrame((st) => totemsFrame(refs.current, shared.current, st.clock.elapsedTime));
  const sh = quality === "high";
  return (
    <>
      {FURNITURE.map((f, i) => {
        if (f.kind !== "totem") return null;
        const k = f.spot;
        return (
          <group key={i} position={[f.x, 0, f.z]} rotation={[0, f.rot, 0]}>
            <mesh position={[0, 0.95, 0]} castShadow={sh} receiveShadow={sh}>
              <cylinderGeometry args={[0.17, 0.22, 1.9, 9]} />
              <meshStandardMaterial
                ref={(o) => {
                  refs.current[k].wood = o;
                }}
                color="#5a4028"
                roughness={0.95}
                emissive="#ffd9a0"
                emissiveIntensity={0}
              />
            </mesh>
            {/* 갓 */}
            <mesh position={[0, 1.98, 0]} castShadow={sh}>
              <coneGeometry args={[0.3, 0.3, 9]} />
              <meshStandardMaterial color="#3a2817" roughness={0.95} />
            </mesh>
            {/* 눈 · 입 */}
            {[-0.07, 0.07].map((x) => (
              <mesh key={x} position={[x, 1.58, 0.17]}>
                <sphereGeometry args={[0.035, 8, 8]} />
                <meshBasicMaterial
                  ref={(o) => {
                    if (x < 0) refs.current[k].eyes = o;
                  }}
                  color="#1a1210"
                />
              </mesh>
            ))}
            <mesh position={[0, 1.36, 0.185]}>
              <boxGeometry args={[0.16, 0.035, 0.02]} />
              <meshBasicMaterial color="#120b08" />
            </mesh>
            {/* 봉인 부적 */}
            <mesh
              ref={(o) => {
                refs.current[k].paper = o;
              }}
              position={[0, 0.92, 0.215]}
              visible={false}
            >
              <planeGeometry args={[0.2, 0.52]} />
              <meshStandardMaterial map={tex} emissiveMap={tex} emissive="#ffb347" emissiveIntensity={0} transparent opacity={0.2} roughness={0.9} />
            </mesh>
            {/* 바닥 금줄 */}
            <mesh
              ref={(o) => {
                refs.current[k].ring = o;
              }}
              position={[0, 0.02, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
              visible={false}
            >
              <ringGeometry args={[0.5, 0.58, 28]} />
              <meshBasicMaterial color="#ff5a36" transparent opacity={0.3} depthWrite={false} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

/* ── 교문 ───────────────────────────────────────────────────────────── */

interface GateRefs {
  l: THREE.Group | null;
  r: THREE.Group | null;
  light: THREE.PointLight | null;
  sign: THREE.MeshStandardMaterial | null;
}

function gatesFrame(refs: GateRefs[], sh: SceneShared, dt: number, t: number) {
  const snap = sh.buf.latest();
  if (!snap) return;
  const open = snap.gate === "open";
  const opening = snap.gate === "opening";
  const k = Math.min(1, dt * 3);
  for (const g of refs) {
    const rattle = opening ? Math.sin(t * 38) * 0.05 : 0;
    if (g.l) g.l.rotation.y += ((open ? 1.35 : rattle) - g.l.rotation.y) * (opening ? 1 : k);
    if (g.r) g.r.rotation.y += ((open ? -1.35 : -rattle) - g.r.rotation.y) * (opening ? 1 : k);
    if (g.light) g.light.intensity += ((open ? 24 : 0) - g.light.intensity) * k;
    if (g.sign) g.sign.emissiveIntensity = open ? 1.4 + Math.sin(t * 9) * 0.6 : opening ? 0.6 + Math.sin(t * 14) * 0.5 : 0.3;
  }
}

function Gates({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const tex = useMemo(() => labelTexture("교문 EXIT", { bg: "#0b3d1e", fg: "#c9ffd9", w: 256, h: 64, font: 30 }), []);
  useEffect(() => () => tex.dispose(), [tex]);
  const refs = useRef<GateRefs[]>(EXITS.map(() => ({ l: null, r: null, light: null, sign: null })));
  useFrame((st, dt) => gatesFrame(refs.current, shared.current, Math.min(0.05, dt), st.clock.elapsedTime));
  return (
    <>
      {EXITS.map((e) => {
        // 문은 벽면에: 북쪽 문은 -z, 남쪽 문은 +z 벽
        const z = e.z + e.dir * 0.42;
        return (
          <group key={e.i} position={[e.x, 0, z]} rotation={[0, e.dir > 0 ? 0 : Math.PI, 0]}>
            {/* 문 너머 달빛 */}
            <mesh position={[0, 1.15, 0.02]} rotation={[0, Math.PI, 0]}>
              <planeGeometry args={[1.7, 2.3]} />
              <meshBasicMaterial color="#9fc4e8" />
            </mesh>
            <group
              ref={(o) => {
                refs.current[e.i].l = o;
              }}
              position={[-0.85, 0, -0.03]}
            >
              <mesh position={[0.425, 1.15, 0]} castShadow>
                <boxGeometry args={[0.85, 2.3, 0.06]} />
                <meshStandardMaterial color="#3f3a33" roughness={0.6} metalness={0.5} />
              </mesh>
            </group>
            <group
              ref={(o) => {
                refs.current[e.i].r = o;
              }}
              position={[0.85, 0, -0.03]}
            >
              <mesh position={[-0.425, 1.15, 0]} castShadow>
                <boxGeometry args={[0.85, 2.3, 0.06]} />
                <meshStandardMaterial color="#3f3a33" roughness={0.6} metalness={0.5} />
              </mesh>
            </group>
            <mesh position={[0, 2.58, -0.05]} rotation={[0, Math.PI, 0]}>
              <planeGeometry args={[1.1, 0.28]} />
              <meshStandardMaterial
                ref={(o) => {
                  refs.current[e.i].sign = o;
                }}
                map={tex}
                emissiveMap={tex}
                emissive="#ffffff"
                emissiveIntensity={0.3}
              />
            </mesh>
            <pointLight
              ref={(o) => {
                refs.current[e.i].light = o;
              }}
              position={[0, 1.4, -1.2]}
              color="#bcd9ff"
              intensity={0}
              distance={16}
              decay={1.5}
            />
          </group>
        );
      })}
    </>
  );
}

/* ── 달빛 · 얼룩 ────────────────────────────────────────────────────── */

/** 복도 창으로 드는 달빛 (칸 좌표) */
const MOON_LIGHTS: [number, number][] = [[5, 5], [23, 13], [14, 9], [23, 5], [5, 13], [14, 5], [14, 13]];

function MoonLights({ quality }: { quality: Quality }) {
  const list = quality === "high" ? MOON_LIGHTS : MOON_LIGHTS.slice(0, 3);
  return (
    <>
      {list.map(([c, r], i) => (
        <pointLight key={i} position={[cellX(c), WALL_H - 0.4, cellZ(r)]} color="#7f9fd6" intensity={2.2} distance={11} decay={1.6} />
      ))}
    </>
  );
}

const STAINS: [number, number, number, number][] = [
  [5, 5, 1.6, 1], [14, 13, 2.2, 2], [22, 5, 1.4, 3], [10, 10, 1.8, 4], [18, 7, 1.5, 5], [5.5, 9, 2.4, 6], [22.5, 10, 2.6, 7], [8.5, 16, 2, 8],
];

function Stains() {
  const texs = useMemo(() => STAINS.map(([, , , seed]) => stainTexture(seed * 13)), []);
  useEffect(() => () => texs.forEach((t) => t.dispose()), [texs]);
  return (
    <>
      {STAINS.map(([c, r, size, seed], i) => (
        <mesh key={i} position={[cellX(c), 0.006 + i * 0.0004, cellZ(r)]} rotation={[-Math.PI / 2, 0, seed * 1.3]}>
          <planeGeometry args={[size, size]} />
          <meshStandardMaterial map={texs[i]} transparent depthWrite={false} roughness={0.35} opacity={0.6} />
        </mesh>
      ))}
    </>
  );
}

/* ── 아이들 · 탈 ────────────────────────────────────────────────────── */

interface MateRefs {
  root: THREE.Group | null;
  kid: THREE.Group | null;
  mask: THREE.Group | null;
  arms: THREE.Group | null;
  ice: THREE.Mesh | null;
  mark: THREE.Mesh | null;
  spot: THREE.SpotLight | null;
  tag: THREE.Sprite | null;
}

const emptyMate = (): MateRefs => ({ root: null, kid: null, mask: null, arms: null, ice: null, mark: null, spot: null, tag: null });

function matesFrame(refs: MateRefs[], sh: SceneShared, dt: number, t: number) {
  const snap = sh.buf.latest();
  if (!snap) return;
  const now = performance.now();
  const me = snap.players[sh.mySeat];
  const watching = me && (me.st === "out" || me.st === "escaped") ? sh.local.spectate : -1;
  const tg = snap.tg;
  const exposed = snap.t < tg.exposedUntil;
  let lights = 0;
  for (let seat = 0; seat < refs.length; seat++) {
    const r = refs[seat];
    const p = snap.players[seat];
    if (!r?.root || !r.kid || !r.mask) continue;
    const show = !!p && seat !== sh.mySeat && seat !== watching && p.st !== "escaped" && p.st !== "out";
    r.root.visible = show;
    if (r.spot) r.spot.intensity = 0;
    if (!show || !p) continue;
    const pose = sh.buf.body(seat, now) ?? p;
    r.root.position.set(pose.x, 0, pose.z);
    r.root.rotation.y = pose.yaw;
    const isTagger = p.role === "tagger";
    const masked = isTagger && tg.form !== "kid";
    const frozen = p.st === "frozen";
    const k = Math.min(1, dt * 8);
    r.kid.visible = !masked;
    r.mask.visible = masked;
    if (masked) {
      // 쓰는 중에는 솟아오르고, 벗는 중에는 가라앉는다
      const grow = tg.form === "mask" ? 1 : tg.form === "on" ? 0.55 : 0.7;
      r.mask.scale.y += (grow - r.mask.scale.y) * Math.min(1, dt * 5);
      const stunned = snap.t < tg.stunUntil;
      r.mask.rotation.z = stunned ? Math.sin(t * 22) * 0.12 : Math.sin(t * 1.7) * 0.03;
      r.mask.rotation.x = snap.t < tg.swingUntil ? -0.45 : stunned ? 0.35 : -0.08;
      if (r.arms) r.arms.rotation.x += ((snap.t < tg.swingUntil ? -1.5 : p.mv > 0 ? -0.5 + Math.sin(t * 9) * 0.25 : -0.1) - r.arms.rotation.x) * Math.min(1, dt * 16);
    } else {
      const sy = frozen ? 1 : p.cr ? 0.66 : 1;
      r.kid.scale.y += (sy - r.kid.scale.y) * k;
      r.kid.position.y = !frozen && p.mv > 0 ? Math.abs(Math.sin(t * (p.mv === 3 ? 11 : 7))) * 0.03 : 0;
      // 변장 중에 소금을 맞은 술래는 비틀거린다
      r.kid.rotation.z = isTagger && snap.t < tg.stunUntil ? Math.sin(t * 14) * 0.18 : 0;
    }
    if (r.ice) {
      r.ice.visible = frozen;
      if (frozen) (r.ice.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.35 + Math.sin(t * 2.5 + seat) * 0.12;
    }
    if (r.mark) {
      r.mark.visible = isTagger && !masked && exposed;
      r.mark.position.y = 2.25 + Math.sin(t * 5) * 0.05;
    }
    if (r.tag) {
      r.tag.visible = !masked;
      r.tag.position.y = p.cr && !frozen ? 1.45 : 1.95;
    }
    if (r.spot && !masked && p.st === "alive" && p.light && lights < 3) {
      lights++;
      r.spot.intensity = 22;
      const cp = Math.cos(p.pitch);
      r.spot.target.position.set(pose.x - Math.sin(pose.yaw) * cp * 5, (p.cr ? 0.9 : 1.4) + Math.sin(p.pitch) * 5, pose.z - Math.cos(pose.yaw) * cp * 5);
      r.spot.target.updateMatrixWorld();
    }
  }
}

const ROBE = "#17110f";

function Mates({ shared, names, seatCount }: { shared: MutableRefObject<SceneShared>; names: Record<number, string>; seatCount: number }) {
  const scene = useThree((s) => s.scene);
  const refs = useRef<MateRefs[]>(Array.from({ length: 5 }, emptyMate));
  const tags = useMemo(() => Array.from({ length: seatCount }, (_, s) => nameTexture(names[s] ?? `${s + 1}번`, SEAT_COLORS[s % 5])), [names, seatCount]);
  useEffect(() => () => tags.forEach((t) => t.dispose()), [tags]);
  const face = useMemo(() => maskFaceTexture(), []);
  useEffect(() => () => face.dispose(), [face]);
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
          {/* 아이 */}
          <group
            ref={(o) => {
              refs.current[seat].kid = o;
            }}
          >
            <mesh position={[0, 0.4, 0]} castShadow>
              <capsuleGeometry args={[0.12, 0.48, 3, 8]} />
              <meshStandardMaterial color="#2a3350" roughness={0.9} />
            </mesh>
            <mesh position={[0, 1.02, 0]} castShadow>
              <capsuleGeometry args={[0.19, 0.36, 4, 10]} />
              <meshStandardMaterial color="#e8e2d2" roughness={0.9} />
            </mesh>
            {/* 자리 색 이름표 (가슴) + 책가방 */}
            <mesh position={[0, 1.12, -0.19]}>
              <boxGeometry args={[0.14, 0.09, 0.02]} />
              <meshStandardMaterial color={SEAT_COLORS[seat % 5]} emissive={SEAT_COLORS[seat % 5]} emissiveIntensity={0.5} />
            </mesh>
            <mesh position={[0, 1.05, 0.2]} castShadow>
              <boxGeometry args={[0.28, 0.34, 0.14]} />
              <meshStandardMaterial color={SEAT_COLORS[seat % 5]} roughness={0.8} />
            </mesh>
            <mesh position={[0, 1.46, 0]} castShadow>
              <sphereGeometry args={[0.15, 14, 12]} />
              <meshStandardMaterial color="#d9b99b" roughness={0.8} />
            </mesh>
            <mesh position={[0, 1.52, 0.02]}>
              <sphereGeometry args={[0.158, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
              <meshStandardMaterial color="#1b1512" roughness={0.9} />
            </mesh>
            {/* 손전등 */}
            <mesh position={[0.22, 0.92, -0.2]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.025, 0.02, 0.18, 8]} />
              <meshStandardMaterial color="#22252a" roughness={0.5} metalness={0.6} />
            </mesh>
            <spotLight
              ref={(o) => {
                refs.current[seat].spot = o;
              }}
              position={[0.22, 0.92, -0.3]}
              color="#fff1d6"
              angle={0.48}
              penumbra={0.6}
              distance={22}
              decay={1.4}
              intensity={0}
            />
          </group>
          {/* 탈을 쓴 술래 */}
          <group
            ref={(o) => {
              refs.current[seat].mask = o;
            }}
            visible={false}
          >
            <mesh position={[0, 0.95, 0]} castShadow>
              <cylinderGeometry args={[0.2, 0.42, 1.9, 10, 1, true]} />
              <meshStandardMaterial color={ROBE} roughness={1} side={THREE.DoubleSide} />
            </mesh>
            <mesh position={[0, 1.86, 0]} castShadow>
              <sphereGeometry args={[0.24, 12, 10]} />
              <meshStandardMaterial color={ROBE} roughness={1} />
            </mesh>
            <mesh position={[0, 2.04, -0.2]} rotation={[0, Math.PI, 0]}>
              <planeGeometry args={[0.46, 0.575]} />
              <meshStandardMaterial map={face} emissiveMap={face} emissive="#ffffff" emissiveIntensity={0.55} transparent alphaTest={0.4} roughness={0.8} side={THREE.DoubleSide} />
            </mesh>
            {/* 눈구멍 속 불빛 */}
            {[-0.085, 0.085].map((x) => (
              <mesh key={x} position={[x, 2.1, -0.19]}>
                <sphereGeometry args={[0.022, 8, 8]} />
                <meshBasicMaterial color="#ff2a12" />
              </mesh>
            ))}
            <pointLight position={[0, 2.0, -0.5]} color="#ff3b1e" intensity={1.4} distance={4.5} decay={1.8} />
            <group
              ref={(o) => {
                refs.current[seat].arms = o;
              }}
              position={[0, 1.62, 0]}
            >
              {[-0.27, 0.27].map((x) => (
                <group key={x} position={[x, 0, 0]}>
                  <mesh position={[0, -0.42, 0]} castShadow>
                    <capsuleGeometry args={[0.045, 0.78, 3, 8]} />
                    <meshStandardMaterial color={ROBE} roughness={1} />
                  </mesh>
                  {[-0.04, 0, 0.04].map((dx) => (
                    <mesh key={dx} position={[dx, -0.95, 0]} rotation={[0, 0, dx * 3]}>
                      <coneGeometry args={[0.014, 0.22, 5]} />
                      <meshStandardMaterial color="#c9c0aa" roughness={0.9} />
                    </mesh>
                  ))}
                </group>
              ))}
            </group>
          </group>
          {/* 얼음 */}
          <mesh
            ref={(o) => {
              refs.current[seat].ice = o;
            }}
            position={[0, 0.9, 0]}
            visible={false}
          >
            <boxGeometry args={[0.72, 1.8, 0.72]} />
            <meshStandardMaterial color="#a9dcff" emissive="#4aa8ff" emissiveIntensity={0.4} transparent opacity={0.42} roughness={0.1} metalness={0.1} depthWrite={false} />
          </mesh>
          {/* 정체가 드러난 술래 표시 */}
          <mesh
            ref={(o) => {
              refs.current[seat].mark = o;
            }}
            position={[0, 2.25, 0]}
            visible={false}
          >
            <octahedronGeometry args={[0.12]} />
            <meshBasicMaterial color="#ff2a12" />
          </mesh>
          <sprite
            ref={(o) => {
              refs.current[seat].tag = o;
            }}
            position={[0, 1.95, 0]}
            scale={[1.3, 0.325, 1]}
          >
            <spriteMaterial map={tags[seat]} transparent opacity={0.9} depthWrite={false} />
          </sprite>
        </group>
      ))}
    </>
  );
}

/* ── 술래 눈에만 보이는 소리 파문 ───────────────────────────────────── */

function ripplesFrame(rings: (THREE.Mesh | null)[], sh: SceneShared, t: number) {
  const snap = sh.buf.latest();
  const me = snap?.players[sh.mySeat];
  const on = !!snap && !!me && me.role === "tagger" && snap.phase === "play";
  const hear = snap && snap.tg.form === "mask" ? 1 : KID_HEAR_MUL;
  const now = performance.now();
  for (let seat = 0; seat < rings.length; seat++) {
    const ring = rings[seat];
    if (!ring) continue;
    const p = snap?.players[seat];
    if (!on || !snap || !p || p.role !== "runner") {
      ring.visible = false;
      continue;
    }
    const r = noiseRadiusOf(p) * hear;
    const pose = sh.buf.body(seat, now) ?? p;
    const heard = r > 0 && Math.hypot(pose.x - sh.local.x, pose.z - sh.local.z) <= r;
    ring.visible = heard;
    if (!heard) continue;
    const k = (t * 1.3 + seat * 0.37) % 1;
    ring.position.set(pose.x, 0.05, pose.z);
    ring.scale.setScalar(0.4 + k * 1.5);
    (ring.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.85;
  }
}

function NoiseRipples({ shared, seatCount }: { shared: MutableRefObject<SceneShared>; seatCount: number }) {
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  useFrame((st) => ripplesFrame(rings.current, shared.current, st.clock.elapsedTime));
  return (
    <>
      {Array.from({ length: seatCount }, (_, seat) => (
        <mesh
          key={seat}
          ref={(o) => {
            rings.current[seat] = o;
          }}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={20}
          visible={false}
        >
          <ringGeometry args={[0.7, 0.86, 32]} />
          <meshBasicMaterial color="#ffd166" transparent opacity={0.8} depthTest={false} depthWrite={false} />
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
  acc.done = true;
  onFps(acc.n / acc.t);
}

function FpsProbe({ onFps }: { onFps: (fps: number) => void }) {
  const acc = useRef({ t: 0, n: 0, done: false });
  useFrame((_, dt) => fpsFrame(acc.current, dt, onFps));
  return null;
}

export default function SchoolScene({ shared, names, seatCount, quality, onFps }: { shared: MutableRefObject<SceneShared>; names: Record<number, string>; seatCount: number; quality: Quality; onFps?: (fps: number) => void }) {
  const high = quality === "high";
  return (
    <Canvas shadows={high} dpr={high ? [1, 1.5] : [0.75, 1]} gl={{ antialias: high, powerPreference: "high-performance" }} camera={{ fov: 72, near: 0.06, far: 70, position: [cellX(14), EYE_STAND, cellZ(16)] }} style={{ touchAction: "none", background: "#000" }}>
      <color attach="background" args={["#02040a"]} />
      <fogExp2 attach="fog" args={["#02040a", 0.07]} />
      <ambientLight intensity={0.1} color="#8fa3d2" />
      <CameraRig shared={shared} />
      <Structure quality={quality} />
      <DoorLabels />
      <Doors shared={shared} quality={quality} />
      <Furnishings quality={quality} />
      <Totems shared={shared} quality={quality} />
      <Gates shared={shared} />
      <MoonLights quality={quality} />
      <Stains />
      <Mates shared={shared} names={names} seatCount={seatCount} />
      <NoiseRipples shared={shared} seatCount={seatCount} />
      {onFps && <FpsProbe onFps={onFps} />}
    </Canvas>
  );
}
