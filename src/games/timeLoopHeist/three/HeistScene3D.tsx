"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import ScreenSprite from "@/games/shared/three/ScreenSprite";
import { AdaptiveResolution } from "@/games/shared/three/sceneFx";
import { labelTexture } from "@/games/shared/three/tableKit";
import { parseLevel, type LevelDef } from "../levels";
import type { Frame, SelfFrame } from "../sim";
import type { SelfMeta } from "../show";
import { Thief3D } from "./Thief3D";

const FACE_ROT: Record<SelfFrame["face"], number> = { E: Math.PI / 2, W: -Math.PI / 2, N: Math.PI, S: 0 };

/**
 * 시간 루프 도둑단 3D — 위에서 비스듬히 내려다보는 박물관 단면. 한 칸 = 1 유닛.
 * 그리는 건 전부 `frame` 한 장(시뮬레이션 스냅샷)에서 나온다 — 움직임은 각 물체가 목표
 * 위치로 부드럽게 따라가는 것(lerp)뿐이라 녹화 중 한 걸음씩, 재생 중 연속 재생이 같은 코드다.
 *
 * 가벼움: 벽·바닥은 instancedMesh 두 개, 그림자 맵 없음, 발광 재질 + 반구광.
 */

export interface HeistScene3DProps {
  def: LevelDef;
  frame: Frame;
  meta: SelfMeta[];
  lowDetail: boolean;
  /** 재생 중이면 true — 보간을 조금 느리게 */
  replay: boolean;
  /** 확대 모드에서 따라갈 칸 (없으면 전체 보기) */
  focus?: { x: number; y: number } | null;
}

const WALL_H = 0.9;

function useGrid(def: LevelDef) {
  const lv = parseLevel(def);
  const ox = -lv.w / 2 + 0.5;
  const oz = -lv.h / 2 + 0.5;
  return { lv, at: (x: number, y: number): [number, number, number] => [x + ox, 0, y + oz] };
}

function Walls({ def }: { def: LevelDef }) {
  const { lv, at } = useGrid(def);
  const wallRef = useRef<THREE.InstancedMesh>(null);
  const floorRef = useRef<THREE.InstancedMesh>(null);
  const walls = useMemo(() => {
    const out: [number, number][] = [];
    for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) if (lv.wall[y * lv.w + x]) out.push([x, y]);
    return out;
  }, [lv]);
  const floors = useMemo(() => {
    const out: [number, number][] = [];
    for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) if (!lv.wall[y * lv.w + x]) out.push([x, y]);
    return out;
  }, [lv]);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    walls.forEach(([x, y], i) => {
      const p = at(x, y);
      m.makeTranslation(p[0], WALL_H / 2, p[2]);
      wallRef.current?.setMatrixAt(i, m);
      // 바깥 테두리는 조금 어둡게
      const edge = x === 0 || y === 0 || x === lv.w - 1 || y === lv.h - 1;
      wallRef.current?.setColorAt(i, c.set(edge ? "#3b3550" : "#5b5277"));
    });
    if (wallRef.current) {
      wallRef.current.instanceMatrix.needsUpdate = true;
      if (wallRef.current.instanceColor) wallRef.current.instanceColor.needsUpdate = true;
    }
    floors.forEach(([x, y], i) => {
      const p = at(x, y);
      m.makeTranslation(p[0], -0.02, p[2]);
      floorRef.current?.setMatrixAt(i, m);
      floorRef.current?.setColorAt(i, c.set((x + y) % 2 === 0 ? "#d9cdb4" : "#cbbd9f"));
    });
    if (floorRef.current) {
      floorRef.current.instanceMatrix.needsUpdate = true;
      if (floorRef.current.instanceColor) floorRef.current.instanceColor.needsUpdate = true;
    }
  }, [walls, floors, at, lv]);
  return (
    <>
      <instancedMesh ref={wallRef} args={[undefined, undefined, walls.length]}>
        <boxGeometry args={[1, WALL_H, 1]} />
        <meshStandardMaterial roughness={0.85} />
      </instancedMesh>
      <instancedMesh ref={floorRef} args={[undefined, undefined, floors.length]}>
        <boxGeometry args={[0.98, 0.04, 0.98]} />
        <meshStandardMaterial roughness={0.95} />
      </instancedMesh>
    </>
  );
}

function damp(cur: number, target: number, k: number, dt: number) {
  return cur + (target - cur) * (1 - Math.exp(-k * dt));
}

function Gate({ p, kind, open, vertical }: { p: [number, number, number]; kind: "door" | "laser"; open: boolean; vertical: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const want = open ? (kind === "door" ? -WALL_H + 0.06 : 0) : 0;
    g.position.y = damp(g.position.y, want, 10, dt);
    if (kind === "laser") g.visible = !open;
  });
  const rot = vertical ? Math.PI / 2 : 0;
  return (
    <group position={[p[0], 0, p[2]]} rotation-y={rot}>
      {/* 문틀 */}
      <mesh position={[0, WALL_H + 0.05, 0]}>
        <boxGeometry args={[1, 0.1, 0.2]} />
        <meshStandardMaterial color={open ? "#22c55e" : "#ef4444"} emissive={open ? "#16a34a" : "#b91c1c"} emissiveIntensity={0.6} />
      </mesh>
      <group ref={ref}>
        {kind === "door" ? (
          <mesh position={[0, WALL_H / 2, 0]}>
            <boxGeometry args={[0.96, WALL_H, 0.14]} />
            <meshStandardMaterial color="#64748b" metalness={0.6} roughness={0.35} />
          </mesh>
        ) : (
          [0.2, 0.45, 0.7].map((y) => (
            <mesh key={y} position={[0, y, 0]} rotation-z={Math.PI / 2}>
              <cylinderGeometry args={[0.025, 0.025, 0.96, 6]} />
              <meshBasicMaterial color="#ff2d55" transparent opacity={0.9} />
            </mesh>
          ))
        )}
      </group>
    </group>
  );
}

function Plate({ p, active, letter }: { p: [number, number, number]; active: boolean; letter: string }) {
  return (
    <group position={p}>
      <mesh position={[0, 0.03, 0]}>
        <cylinderGeometry args={[0.38, 0.42, 0.06, 20]} />
        <meshStandardMaterial color={active ? "#facc15" : "#a16207"} emissive={active ? "#facc15" : "#000000"} emissiveIntensity={active ? 0.9 : 0} />
      </mesh>
      <ScreenSprite position={[0, 0.35, 0.38]} scale={[0.7, 0.175]} map={labelTexture(`발판 ${letter}`, "#facc15")} />
    </group>
  );
}

function Lever({ p, on, letter }: { p: [number, number, number]; on: boolean; letter: string }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.z = damp(ref.current.rotation.z, on ? -0.7 : 0.7, 8, dt);
  });
  return (
    <group position={p}>
      <mesh position={[0, 0.08, 0]}>
        <boxGeometry args={[0.4, 0.16, 0.3]} />
        <meshStandardMaterial color="#475569" />
      </mesh>
      <mesh ref={ref} position={[0, 0.16, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.55, 8]} />
        <meshStandardMaterial color={on ? "#22c55e" : "#f97316"} emissive={on ? "#22c55e" : "#f97316"} emissiveIntensity={0.5} />
      </mesh>
      <ScreenSprite position={[0, 0.7, 0]} scale={[0.7, 0.175]} map={labelTexture(`레버 ${letter}${on ? " ✓" : ""}`, on ? "#22c55e" : "#f97316")} />
    </group>
  );
}

function Console({ p, emp }: { p: [number, number, number]; emp: number }) {
  const ref = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.emissiveIntensity = emp > 0 ? 0.8 + Math.sin(clock.elapsedTime * 12) * 0.4 : 0.35;
  });
  return (
    <group position={p}>
      <mesh position={[0, 0.3, 0]}>
        <boxGeometry args={[0.5, 0.6, 0.4]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
      <mesh position={[0, 0.5, 0.21]}>
        <planeGeometry args={[0.4, 0.25]} />
        <meshStandardMaterial ref={ref} color="#38bdf8" emissive="#38bdf8" />
      </mesh>
      <ScreenSprite position={[0, 0.95, 0]} scale={[0.8, 0.2]} map={labelTexture(emp > 0 ? `⚡ EMP ${emp}` : "EMP 콘솔", "#38bdf8")} />
    </group>
  );
}

function Van({ p }: { p: [number, number, number] }) {
  return (
    <group position={p}>
      <mesh position={[0, 0.3, 0]}>
        <boxGeometry args={[0.9, 0.5, 0.7]} />
        <meshStandardMaterial color="#e2e8f0" />
      </mesh>
      <mesh position={[0.32, 0.62, 0]}>
        <boxGeometry args={[0.26, 0.18, 0.66]} />
        <meshStandardMaterial color="#0f172a" />
      </mesh>
      {[-0.3, 0.3].map((x) =>
        [-0.36, 0.36].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.08, z]} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.1, 0.1, 0.06, 10]} />
            <meshStandardMaterial color="#111827" />
          </mesh>
        )),
      )}
      <ScreenSprite position={[0, 1.0, 0]} scale={[0.8, 0.2]} map={labelTexture("🚐 탈출 밴", "#e2e8f0")} />
    </group>
  );
}

function Gem({ coin }: { coin?: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.rotation.y = clock.elapsedTime * 1.6;
    ref.current.position.y = 0.4 + Math.sin(clock.elapsedTime * 2.4) * 0.05;
  });
  return coin ? (
    <mesh ref={ref} rotation-x={Math.PI / 2}>
      <cylinderGeometry args={[0.16, 0.16, 0.04, 16]} />
      <meshStandardMaterial color="#fbbf24" emissive="#f59e0b" emissiveIntensity={0.45} metalness={0.7} roughness={0.3} />
    </mesh>
  ) : (
    <mesh ref={ref}>
      <octahedronGeometry args={[0.2, 0]} />
      <meshStandardMaterial color="#67e8f9" emissive="#22d3ee" emissiveIntensity={0.7} metalness={0.3} roughness={0.15} />
    </mesh>
  );
}

function Guard({ x, z, face, emp, k }: { x: number; z: number; face: SelfFrame["face"]; emp: boolean; k: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    g.position.x = damp(g.position.x, x, k, dt);
    g.position.z = damp(g.position.z, z, k, dt);
    g.rotation.y = damp(g.rotation.y, FACE_ROT[face], 12, dt);
  });
  return (
    <group ref={ref} position={[x, 0, z]}>
      <mesh position={[0, 0.35, 0]}>
        <cylinderGeometry args={[0.26, 0.32, 0.6, 16]} />
        <meshStandardMaterial color={emp ? "#475569" : "#e5e7eb"} metalness={0.5} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.78, 0]}>
        <sphereGeometry args={[0.22, 16, 12]} />
        <meshStandardMaterial color={emp ? "#334155" : "#cbd5e1"} metalness={0.5} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.8, 0.19]}>
        <sphereGeometry args={[0.07, 10, 8]} />
        <meshBasicMaterial color={emp ? "#1e293b" : "#ef4444"} />
      </mesh>
      <ScreenSprite position={[0, 1.25, 0]} scale={[0.75, 0.19]} map={labelTexture(emp ? "💤 정지" : "🤖 경비", emp ? "#64748b" : "#ef4444")} />
    </group>
  );
}

export const CAMERA_TILT_DEG = 64;
/** 확대 모드에서 화면 가로에 들어오는 칸 수 */
const ZOOM_TILES = 9;

/**
 * 전체 보기 = 지도 전체가 프레임에 꽉 차게. 확대 = 내 도둑(focus)을 따라가며 가로 ZOOM_TILES칸만
 * 보여 준다(지도 밖으로 카메라가 나가지 않게 가장자리에서 멈춤). 바뀔 때는 부드럽게 따라간다.
 */
function CameraRig({ w, h, focus }: { w: number; h: number; focus: [number, number, number] | null }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const look = useRef(new THREE.Vector3(0, 0, 0.4));
  const want = useRef(new THREE.Vector3());
  const wantLook = useRef(new THREE.Vector3());
  const first = useRef(true);
  const fit = useMemo(() => {
    const aspect = size.width / Math.max(1, size.height);
    const vf = THREE.MathUtils.degToRad(40 / 2);
    const hf = Math.atan(Math.tan(vf) * aspect);
    const tilt = THREE.MathUtils.degToRad(CAMERA_TILT_DEG);
    // 기울어진 시점에선 앞뒤(h)가 sin만큼 짧아 보인다
    const needW = (w / 2 + 0.3) / Math.tan(hf);
    const needH = ((h * Math.sin(tilt)) / 2 + 0.7) / Math.tan(vf);
    const full = Math.max(needW, needH);
    const zoom = Math.min(full, ZOOM_TILES / 2 / Math.tan(hf));
    return { vf, hf, tilt, full, zoom };
  }, [size, w, h]);
  const fx = focus?.[0];
  const fz = focus?.[2];
  useFrame((_, dt) => {
    const { vf, hf, tilt, full, zoom } = fit;
    const zoomed = fx !== undefined && fz !== undefined;
    const d = zoomed ? zoom : full;
    let tx = 0;
    let tz = 0.4;
    if (zoomed) {
      const halfW = d * Math.tan(hf);
      const halfD = (d * Math.tan(vf)) / Math.sin(tilt);
      const mx = Math.max(0, w / 2 - halfW + 0.4);
      const mz = Math.max(0, h / 2 - halfD + 0.6);
      tx = THREE.MathUtils.clamp(fx, -mx, mx);
      tz = THREE.MathUtils.clamp(fz, -mz, mz) + 0.4;
    }
    want.current.set(tx, d * Math.sin(tilt), tz + d * Math.cos(tilt));
    wantLook.current.set(tx, 0, tz);
    const k = first.current ? 1 : 1 - Math.exp(-6 * dt);
    first.current = false;
    camera.position.lerp(want.current, k);
    look.current.lerp(wantLook.current, k);
    camera.lookAt(look.current);
  });
  return null;
}

function Scene({ def, frame, meta, lowDetail, replay, focus }: HeistScene3DProps) {
  const { lv, at } = useGrid(def);
  const k = replay ? 9 : 16;
  return (
    <>
      <color attach="background" args={["#141226"]} />
      <hemisphereLight args={["#e0e7ff", "#3b2f4a", 1.15]} />
      <directionalLight position={[4, 10, 6]} intensity={1.1} />
      <Walls def={def} />
      {/* 경비 시야 */}
      {frame.seen.map((idx) => {
        const p = at(idx % lv.w, Math.floor(idx / lv.w));
        return (
          <mesh key={`v${idx}`} position={[p[0], 0.015, p[2]]} rotation-x={-Math.PI / 2}>
            <planeGeometry args={[0.96, 0.96]} />
            <meshBasicMaterial color="#ef4444" transparent opacity={0.38} />
          </mesh>
        );
      })}
      {/* 출발점 */}
      <mesh position={[at(lv.spawn.x, lv.spawn.y)[0], 0.012, at(lv.spawn.x, lv.spawn.y)[2]]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.25, 0.45, 24]} />
        <meshBasicMaterial color="#a78bfa" />
      </mesh>
      <Van p={at(lv.van.x, lv.van.y)} />
      {Object.entries(lv.gates).map(([id, g]) => {
        // 좌우로 지나가는 문이면 문짝을 세로(z)로 돌린다
        const eastWest = !lv.wall[g.y * lv.w + g.x - 1] && !lv.wall[g.y * lv.w + g.x + 1];
        return <Gate key={id} p={at(g.x, g.y)} kind={g.kind} open={frame.open[id] ?? false} vertical={eastWest} />;
      })}
      {Object.entries(lv.plates).map(([id, c]) => (
        <Plate key={id} p={at(c.x, c.y)} active={frame.active[id] ?? false} letter={id} />
      ))}
      {Object.entries(lv.levers).map(([id, c]) => (
        <Lever key={id} p={at(c.x, c.y)} on={frame.levers[id] ?? false} letter={id} />
      ))}
      {Object.entries(lv.consoles).map(([id, c]) => (
        <Console key={id} p={at(c.x, c.y)} emp={frame.emp} />
      ))}
      {frame.loot.map((l, i) =>
        l.state === "floor" ? (
          <group key={`l${i}`} position={at(l.x, l.y)}>
            <Gem coin={lv.loot[i].kind === "coin"} />
          </group>
        ) : null,
      )}
      {frame.guards.map((g, i) => {
        const p = at(g.x, g.y);
        return <Guard key={`g${i}`} x={p[0]} z={p[2]} face={g.face} emp={frame.emp > 0} k={k} />;
      })}
      {frame.selves.map((s, i) => {
        const m = meta[i];
        if (!m) return null;
        return <Thief3D key={`s${m.seat}-${m.loop}`} s={s} meta={m} at={at(s.x, s.y)} k={k} carrying={s.carry !== null} />;
      })}
      <CameraRig w={lv.w} h={lv.h} focus={focus ? at(focus.x, focus.y) : null} />
      <AdaptiveResolution max={lowDetail ? 1.5 : 2} />
    </>
  );
}

export default function HeistScene3D(props: HeistScene3DProps) {
  return (
    <Canvas dpr={props.lowDetail ? [1, 1.5] : [1, 2]} gl={{ antialias: !props.lowDetail, powerPreference: "high-performance" }} camera={{ fov: 40, position: [0, 14, 10], near: 0.1, far: 120 }} style={{ touchAction: "pan-y" }}>
      <Scene {...props} />
    </Canvas>
  );
}
