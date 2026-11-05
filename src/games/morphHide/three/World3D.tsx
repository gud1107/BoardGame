"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import ScreenSprite from "@/games/shared/three/ScreenSprite";
import { AdaptiveResolution, BlobShadow, PostFx, StudioEnvironment } from "@/games/shared/three/sceneFx";
import { DUSK, ShadowSetup, Sky, SunLight, surfaceTexture, type SurfaceKind } from "./Atmosphere";
import { labelTexture } from "@/games/shared/three/tableKit";
import { CHEST_SLOTS, DOORS, FIXED_THINGS, FLOOR, GOAL_SLOTS, LADDER, ROAD, ROOMS, STATIC_SOLIDS, WINDOWS, slotY, type PlacedThing } from "../map";
import { EMOTES, RUN_MULT, disguise, poseOf, weaponSchedule } from "../data";
import { rayBox, stepBody, type Body, type CollWorld, type Cyl } from "../physics";
import { bodySize, chestThings, dynamicSolids, npcSize, roundGrid, walkSpeed, type Act, type GameEvent, type PosReport } from "../sim";
import type { Snap, SnapBuffer, SnapPlayer } from "../net";
import Thing from "./Things";
import { Car, Cat, Dog, Humanoid, Vacuum, type WeaponLook } from "./Figures";
import VrmFigure, { castLook, seekerLook } from "./VrmFigure";
import { roomCharacterOf, useRoomCharacters } from "@/lib/character/roomCharacters";
import { WEAPONS } from "../data";

/** 사람 VRM에 필요한 판 정보 (출연진 랜덤 얼굴은 시드·라운드·자리로 정해 모든 기기가 같다) */
const FigCtx = createContext({ seed: 0, round: 0, low: false });

function castKeyFor(seed: number, round: number, seat: number): number {
  return (seed % 100003) * 31 + round * 7919 + seat * 13 + 1;
}

/** 술래 = 각자 프로필 VRM */
function SeekerVrm({ seat, name, anim }: { seat: number; name: string; anim: string }) {
  const chars = useRoomCharacters((st) => st.byName);
  const { low } = useContext(FigCtx);
  const look = useMemo(() => seekerLook(seat, roomCharacterOf(chars, name)), [seat, name, chars]);
  return <VrmFigure look={look} seed={seat * 5 + 3} anim={anim} lowDetail={low} />;
}

/** 행인 = 출연진 중 랜덤 VRM */
function CastVrm({ castKey, anim }: { castKey: number; anim: string }) {
  const { low } = useContext(FigCtx);
  const look = useMemo(() => castLook(castKey), [castKey]);
  return <VrmFigure look={look} seed={castKey % 997} anim={anim} lowDetail={low} />;
}

/**
 * 변신 숨바꼭질 3D 월드.
 *
 * - 남들(사람·NPC·분신)은 `SnapBuffer`에서 보간된 위치를 매 프레임 읽어 그린다.
 * - 내 몸은 `LocalPlayer`가 매 프레임 물리로 직접 움직이고(예측) 100ms마다 위치를 보고한다.
 * - 3인칭 카메라: 마우스(포인터 잠금)/오른쪽 화면 드래그로 돌리고, 벽에 막히면 앞으로 당긴다.
 */

export interface Controls {
  /** 카메라 기준 이동 (x 오른쪽, z 앞), 길이 ≤ 1 */
  mx: number;
  mz: number;
  run: boolean;
  jump: boolean;
  use: boolean;
  attack: boolean;
  aim: boolean;
  /** 쌓인 시점 회전 (픽셀) */
  lookDX: number;
  lookDY: number;
  zoom: number;
  /** 클릭·터치로 찍은 곳까지 걷기 */
  moveTo: [number, number, number] | null;
  pose: number;
  /** 마우스·드래그 감도 배율 */
  sens: number;
  /** 뒤돌기 (한 번) */
  turn: boolean;
  /** 둘러보기 — 누르는 동안 몸·자세·이동 방향은 그대로, 시점만 */
  freeLook: boolean;
}

export function freshControls(): Controls {
  return { mx: 0, mz: 0, run: false, jump: false, use: false, attack: false, aim: false, lookDX: 0, lookDY: 0, zoom: 1, moveTo: null, pose: 0, sens: 1, turn: false, freeLook: false };
}

export type NearKind = "door" | "window" | "chest" | "ladder";

export interface NearInfo {
  kind: NearKind;
  id: number;
  label: string;
}

export interface SelfInfo {
  x: number;
  y: number;
  z: number;
  yaw: number;
  camYaw: number;
}

export interface FxItem {
  ev: GameEvent;
  /** 받은 시각 (performance.now) */
  at: number;
}

export interface World3DProps {
  buf: SnapBuffer;
  snap: Snap;
  mySeat: number;
  names: Record<number, string>;
  controlsRef: RefObject<Controls>;
  onPos: (p: PosReport) => void;
  onAct: (a: Act) => void;
  onNear: (n: NearInfo | null) => void;
  selfRef: RefObject<SelfInfo>;
  /** 잡혔으면 따라볼 사람 */
  spectate: number | null;
  fx: FxItem[];
  lowDetail: boolean;
  /** 클릭으로 걷기 허용 (포인터 잠금 중엔 끔) */
  clickMove: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// 맵

function StaticBoxes() {
  const groups = useMemo(() => {
    const by = new Map<string, typeof STATIC_SOLIDS>();
    for (const s of STATIC_SOLIDS) {
      if (!s.c || s.id) continue;
      const arr = (by.get(s.c) as (typeof STATIC_SOLIDS)[number][] | undefined) ?? [];
      arr.push(s);
      by.set(s.c, arr);
    }
    return [...by.entries()];
  }, []);
  return (
    <>
      {groups.map(([color, list]) => (
        <ColorInstances key={color} color={color} list={list} />
      ))}
      {STATIC_SOLIDS.filter((s) => s.id?.startsWith("crate")).map((s) => (
        <group key={s.id} position={[(s.x0 + s.x1) / 2, s.y0, (s.z0 + s.z1) / 2]} scale={[(s.x1 - s.x0) / 0.9, (s.y1 - s.y0) / 0.9, (s.z1 - s.z0) / 0.9]}>
          <Thing kind="crate" />
        </group>
      ))}
    </>
  );
}

function ColorInstances({ color, list }: { color: string; list: readonly { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    const mat = new THREE.Matrix4();
    list.forEach((s, i) => {
      mat.compose(new THREE.Vector3((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, (s.z0 + s.z1) / 2), new THREE.Quaternion(), new THREE.Vector3(s.x1 - s.x0, s.y1 - s.y0, s.z1 - s.z0));
      m.setMatrixAt(i, mat);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [list]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, list.length]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} roughness={0.85} />
    </instancedMesh>
  );
}

function Plane({ x0, x1, z0, z1, y = 0.005, color, surface, tile = 3 }: { x0: number; x1: number; z0: number; z1: number; y?: number; color?: string; surface?: SurfaceKind; tile?: number }) {
  const map = useMemo(() => {
    if (!surface) return null;
    const t = surfaceTexture(surface).clone();
    t.needsUpdate = true;
    t.repeat.set((x1 - x0) / tile, (z1 - z0) / tile);
    return t;
  }, [surface, x0, x1, z0, z1, tile]);
  return (
    <mesh rotation-x={-Math.PI / 2} position={[(x0 + x1) / 2, y, (z0 + z1) / 2]}>
      <planeGeometry args={[x1 - x0, z1 - z0]} />
      <meshStandardMaterial color={map ? "#ffffff" : color} map={map} roughness={surface === "tile" ? 0.45 : surface === "wood" ? 0.6 : 0.95} />
    </mesh>
  );
}

const ROOM_SURFACE: Record<string, SurfaceKind> = { garage: "concrete", hall: "wood", living: "wood", bath: "tile", kitchen: "tile" };

function Ground() {
  return (
    <group>
      <Plane x0={-40} x1={36} z0={-30} z1={60} y={-0.01} surface="grass" tile={4} />
      {ROOMS.filter((r) => r.floor === 0).map((r) => (
        <Plane key={r.id} x0={r.box[0]} x1={r.box[1]} z0={r.box[2]} z1={r.box[3]} y={0.008} surface={ROOM_SURFACE[r.id] ?? "wood"} tile={r.id === "bath" || r.id === "kitchen" ? 1.6 : 2.4} />
      ))}
      {/* 뒷골목 */}
      <Plane x0={-16} x1={12} z0={-8} z1={-5.35} surface="concrete" tile={3} />
      {/* 인도·도로·건널목 */}
      <Plane x0={-30} x1={30} z0={14} z1={16} surface="sidewalk" tile={2} />
      <Plane x0={-30} x1={30} z0={ROAD.z0} z1={ROAD.z1} surface="asphalt" tile={4} />
      <Plane x0={-30} x1={30} z0={23} z1={25} surface="sidewalk" tile={2} />
      {Array.from({ length: 9 }, (_, i) => (
        <Plane key={i} x0={ROAD.crossX0} x1={ROAD.crossX1} z0={16.3 + i * 0.75} z1={16.3 + i * 0.75 + 0.42} y={0.012} color="#f1f5f9" />
      ))}
      {Array.from({ length: 12 }, (_, i) => (
        <Plane key={`c${i}`} x0={-22 + i * 4} x1={-20 + i * 4} z0={19.45} z1={19.55} y={0.012} color="#facc15" />
      ))}
      {/* 공원 산책길 */}
      <Plane x0={-2.8} x1={-1.2} z0={25} z1={30.5} y={0.01} surface="path" tile={1.6} />
      <Plane x0={-13} x1={9} z0={34.3} z1={35.8} y={0.01} surface="path" tile={1.6} />
      <Plane x0={-12.3} x1={-10.7} z0={25} z1={36} y={0.01} surface="path" tile={1.6} />
      <Plane x0={6.3} x1={7.9} z0={25} z1={38} y={0.01} surface="path" tile={1.6} />
      {/* 마당 디딤돌 길 */}
      <Plane x0={-1.4} x1={0.4} z0={5.4} z1={14} y={0.01} surface="sidewalk" tile={1.8} />
      {/* 술래 기지 */}
      <mesh rotation-x={-Math.PI / 2} position={[9, 0.02, 9.5]}>
        <ringGeometry args={[1.1, 1.3, 32]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.55} toneMapped={false} />
      </mesh>
      <mesh position={[9, 1.2, 8.4]}>
        <cylinderGeometry args={[0.16, 0.2, 2.4, 10]} />
        <meshStandardMaterial color="#6d4c41" />
      </mesh>
      <mesh position={[9, 2.55, 8.4]}>
        <boxGeometry args={[0.32, 0.36, 0.32]} />
        <meshBasicMaterial color="#7dd3fc" toneMapped={false} />
      </mesh>
      {/* 사다리 */}
      {[-1.25, -0.55].map((x) => (
        <mesh key={x} position={[x, FLOOR[1] + 1.5, LADDER.z - 0.6]}>
          <boxGeometry args={[0.07, 3.0, 0.07]} />
          <meshStandardMaterial color="#a1887f" />
        </mesh>
      ))}
      {Array.from({ length: 7 }, (_, i) => (
        <mesh key={i} position={[LADDER.x, FLOOR[1] + 0.35 + i * 0.4, LADDER.z - 0.6]}>
          <boxGeometry args={[0.7, 0.05, 0.05]} />
          <meshStandardMaterial color="#a1887f" />
        </mesh>
      ))}

    </group>
  );
}

function DoorsAndWindows({ doors, windows }: { doors: boolean[]; windows: boolean[] }) {
  return (
    <>
      {DOORS.map((d) => {
        const open = doors[d.id];
        // 경첩 = 문 왼쪽 끝. 열리면 90° 돌아간다
        const hx = d.axis === "x" ? d.x - d.w / 2 : d.x;
        const hz = d.axis === "x" ? d.z : d.z - d.w / 2;
        const base = d.axis === "x" ? 0 : -Math.PI / 2;
        return (
          <group key={d.id} position={[hx, d.y, hz]} rotation-y={base + (open ? -Math.PI / 2 : 0)}>
            <mesh position={[d.w / 2, 1.1, 0]}>
              <boxGeometry args={[d.w, 2.2, 0.08]} />
              <meshStandardMaterial color={d.w > 2 ? "#6b7280" : "#7c4a2d"} roughness={0.7} />
            </mesh>
            <mesh position={[d.w - 0.15, 1.05, 0.06]}>
              <sphereGeometry args={[0.05, 8, 6]} />
              <meshStandardMaterial color="#facc15" metalness={0.8} />
            </mesh>
          </group>
        );
      })}
      {WINDOWS.map((w) => {
        const open = windows[w.id];
        const h = w.top - w.sill;
        return (
          <group key={w.id} position={[w.x, w.y + w.sill + (open ? h * 0.82 : 0) + h / 2, w.z]} rotation-y={w.axis === "x" ? 0 : Math.PI / 2}>
            <mesh>
              <boxGeometry args={[w.w, open ? h * 0.18 : h, 0.05]} />
              <meshStandardMaterial color="#9fd3f5" transparent opacity={0.35} roughness={0.1} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

function ThingAt({ t, pedLight }: { t: PlacedThing; pedLight: boolean }) {
  return (
    <group position={[t.x, t.y, t.z]} rotation-y={t.rot}>
      <Thing kind={t.kind} pedLight={pedLight} />
    </group>
  );
}

function GoalBeacon({ slot }: { slot: number }) {
  const g = GOAL_SLOTS[slot];
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = clock.elapsedTime * 1.4;
  });
  const map = useMemo(() => labelTexture(`🏁 찜! ${g.name}`, "#fde047", { bg: "rgba(60,40,0,0.85)", fg: "#fef9c3" }), [g.name]);
  return (
    <group position={[g.x, slotY(g), g.z]}>
      <mesh position-y={4}>
        <cylinderGeometry args={[0.6, 0.9, 8, 18, 1, true]} />
        <meshBasicMaterial color="#fde047" transparent opacity={0.22} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
      <group ref={ref}>
        <mesh rotation-x={-Math.PI / 2} position-y={0.04}>
          <ringGeometry args={[1.0, 1.3, 32]} />
          <meshBasicMaterial color="#facc15" transparent opacity={0.9} toneMapped={false} />
        </mesh>
      </group>
      <ScreenSprite position={[0, 2.6, 0]} scale={[1.4, 0.35]} map={map} renderOrder={15} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// 사람·동물·물건


/** 변신한 모양 하나 (플레이어·분신 공용) */
function FormModel({ dg, anim, pose, look, held, castKey }: { dg: string | null; anim: string; pose: number; look: number; held?: WeaponLook; castKey?: number }) {
  const def = disguise(dg);
  if (!def) return <Humanoid anim={anim} look={look} uniform held={held ?? "flashlight"} />;
  switch (def.form) {
    case "person":
      return castKey !== undefined ? <CastVrm castKey={castKey} anim={anim} /> : <Humanoid anim={anim} look={look} />;
    case "guard":
      return <Humanoid anim={anim} look={look} uniform held="flashlight" />;
    case "dog":
      return <Dog anim={anim} look={look} />;
    case "cat":
      return <Cat anim={anim} look={look} />;
    case "vacuum":
      return <Vacuum anim={anim} />;
    default: {
      const ps = poseOf("prop", pose);
      const tipH = def.r;
      return (
        <group rotation-y={ps.yaw ?? 0}>
          <group rotation-x={ps.tip ? -Math.PI / 2 : 0} position={ps.tip ? [0, tipH, -def.h / 2 + tipH] : [0, 0, 0]}>
            <PropWiggle moving={anim === "walk" || anim === "run" || anim === "jump"}>
              <Thing kind={def.thing!} />
            </PropWiggle>
          </group>
        </group>
      );
    }
  }
}

function PropWiggle({ moving, children }: { moving: boolean; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const t = clock.elapsedTime;
    g.position.y = moving ? Math.abs(Math.sin(t * 14)) * 0.06 : 0;
    g.rotation.z = moving ? Math.sin(t * 14) * 0.05 : 0;
  });
  return <group ref={ref}>{children}</group>;
}

function Tag({ text, color, y, mine }: { text: string; color: string; y: number; mine?: boolean }) {
  const map = useMemo(() => labelTexture(text, color, mine ? { bg: "rgba(8,40,60,0.9)", fg: "#e0f2fe" } : {}), [text, color, mine]);
  return <ScreenSprite position={[0, y, 0]} anchorY={y - 0.2} scale={[0.9, 0.22]} map={map} renderOrder={13} />;
}

function Bubble({ text, y }: { text: string; y: number }) {
  const map = useMemo(() => labelTexture(text, "#fde68a", { bg: "rgba(20,16,0,0.9)", fg: "#fef3c7" }), [text]);
  return <ScreenSprite position={[0, y, 0]} scale={[1.0, 0.25]} map={map} renderOrder={14} />;
}

function RemotePlayer({ buf, p, snap, name, showName }: { buf: SnapBuffer; p: SnapPlayer; snap: Snap; name: string; showName: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const pose = buf.player(p.s, performance.now());
    if (!pose || !ref.current) return;
    ref.current.visible = camState.hideSeat !== p.s;
    ref.current.position.set(pose.x, pose.y, pose.z);
    ref.current.rotation.y = pose.yaw;
  });
  const em = p.em ? EMOTES.find((e) => e.id === p.em!.id) : null;
  const def = disguise(p.dg);
  const anim = em && p.anim !== "walk" && p.anim !== "run" ? em.anim : p.anim;
  const fig = useContext(FigCtx);
  const wpn = snap.phase === "hunt" ? WEAPONS[weaponSchedule(snap.options.huntSec)[snap.tier]] : null;
  const h = p.role === "seeker" ? 1.75 : (def?.h ?? 1.7);
  return (
    <group ref={ref}>
      <BlobShadow radius={p.role === "seeker" ? 0.42 : Math.max(0.3, (def?.r ?? 0.3) * 1.4)} opacity={0.7} />
      {p.role === "seeker" ? <SeekerVrm seat={p.s} name={name} anim={anim} /> : <FormModel dg={p.dg} anim={anim} pose={p.pose} look={(p.s * 3 + 1) % 8} castKey={castKeyFor(fig.seed, fig.round, p.s)} />}
      {showName && <Tag text={p.role === "seeker" ? `👁️ ${name}${wpn ? ` ${wpn.icon}` : ""}` : name} color={p.role === "seeker" ? "#38bdf8" : "#a7f3d0"} y={h + 0.45} />}
      {em && <Bubble text={`${em.icon} ${em.line}`} y={h + (showName ? 0.85 : 0.5)} />}
      {p.role === "seeker" && snap.phase === "hide" && <Bubble text="🙈 눈 가리는 중…" y={h + 0.85} />}
    </group>
  );
}

function NpcView({ buf, id, kind, anim, look }: { buf: SnapBuffer; id: number; kind: string; anim: string; look: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const pose = buf.npc(id, performance.now());
    if (!pose || !ref.current) return;
    ref.current.position.set(pose.x, pose.y, pose.z);
    ref.current.rotation.y = pose.yaw;
  });
  return (
    <group ref={ref}>
      {kind !== "car" && <BlobShadow radius={kind === "vacuum" ? 0.36 : kind === "cat" ? 0.3 : 0.42} opacity={0.7} />}
      {kind === "ped" && <CastVrm castKey={100_000 + id * 37 + look} anim={anim} />}
      {kind === "guard" && <Humanoid anim={anim} look={look} uniform held="flashlight" />}
      {kind === "dog" && <Dog anim={anim} look={look} />}
      {kind === "cat" && <Cat anim={anim} look={look} />}
      {kind === "vacuum" && <Vacuum anim={anim} />}
      {kind === "car" && <Car anim={anim} look={look} />}
    </group>
  );
}

function DecoyView({ buf, id, dg, anim, pose, look, owner }: { buf: SnapBuffer; id: number; dg: string; anim: string; pose: number; look: number; owner: number }) {
  const fig = useContext(FigCtx);
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const p = buf.decoy(id, performance.now());
    if (!p || !ref.current) return;
    ref.current.position.set(p.x, p.y, p.z);
    ref.current.rotation.y = p.yaw;
  });
  return (
    <group ref={ref}>
      <FormModel dg={dg} anim={anim} pose={pose} look={look} castKey={castKeyFor(fig.seed, fig.round, owner)} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// 효과

function Tracer({ from, to, at, color }: { from: [number, number, number]; to: [number, number, number]; at: number; color: string }) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const { mid, len, quat } = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const dir = b.clone().sub(a);
    return { mid: a.clone().add(b).multiplyScalar(0.5), len: Math.max(0.01, dir.length()), quat: new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()) };
  }, [from, to]);
  useFrame(() => {
    const e = (performance.now() - at) / 1000;
    if (ref.current) ref.current.visible = e < 0.25;
    if (mat.current) mat.current.opacity = Math.max(0, 0.9 - e * 3.6);
  });
  return (
    <mesh ref={ref} position={mid} quaternion={quat}>
      <cylinderGeometry args={[0.02, 0.02, len, 5]} />
      <meshBasicMaterial ref={mat} color={color} transparent toneMapped={false} />
    </mesh>
  );
}

function Burst({ pos, at, color, text }: { pos: [number, number, number]; at: number; color: string; text: string }) {
  const ring = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const label = useRef<THREE.Group>(null);
  const map = useMemo(() => labelTexture(text, color, { bg: "rgba(10,10,20,0.9)", fg: color }), [text, color]);
  useFrame(() => {
    const e = (performance.now() - at) / 1000;
    if (ring.current) {
      ring.current.visible = e < 0.9;
      ring.current.scale.setScalar(0.3 + e * 3);
    }
    if (mat.current) mat.current.opacity = Math.max(0, 1 - e / 0.9);
    if (label.current) {
      label.current.visible = e < 2.2;
      label.current.position.y = 1.8 + Math.min(e, 0.6) * 0.8;
    }
  });
  return (
    <group position={pos}>
      <mesh ref={ring} rotation-x={-Math.PI / 2} position-y={0.08}>
        <ringGeometry args={[0.6, 0.85, 32]} />
        <meshBasicMaterial ref={mat} color={color} transparent depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <group ref={label}>
        <ScreenSprite position={[0, 0, 0]} scale={[1.2, 0.3]} map={map} renderOrder={16} />
      </group>
    </group>
  );
}

function Effects({ fx, snap }: { fx: FxItem[]; snap: Snap }) {
  return (
    <>
      {fx.map(({ ev, at }) => {
        if (ev.type === "shot") return <Tracer key={ev.id} from={ev.from} to={ev.to} at={at} color={ev.weapon === "sniper" ? "#f472b6" : "#fde68a"} />;
        if (ev.type === "catch") return <Burst key={ev.id} pos={[ev.x, ev.y, ev.z]} at={at} color="#f87171" text="💥 잡혔다!" />;
        if (ev.type === "wrong") return <Burst key={ev.id} pos={[ev.x, ev.y, ev.z]} at={at} color="#94a3b8" text={`✖ ${ev.what}였어! −체력`} />;
        if (ev.type === "escape") {
          const p = snap.players[ev.seat];
          return p ? <Burst key={ev.id} pos={[p.x, p.y, p.z]} at={at} color="#fde047" text="🏁 찜!" /> : null;
        }
        return null;
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// 내 캐릭터 + 카메라

const LADDER_BOTTOM: [number, number, number] = [LADDER.x, FLOOR[1], LADDER.z + 0.9];
const LADDER_TOP: [number, number, number] = [LADDER.x, FLOOR[2], -3.0];

function LocalPlayer(props: World3DProps & { gridRef: RefObject<ReturnType<typeof roundGrid> | null> }) {
  const { buf, snap, mySeat, controlsRef, selfRef, onPos, onAct, onNear } = props;
  const { size } = useThree();
  const me = snap.players[mySeat];
  const group = useRef<THREE.Group>(null);
  const body = useRef<Body>({ x: me.x, y: me.y, z: me.z, vy: 0, grounded: true, r: 0.3, h: 1.7 });
  const tpSeen = useRef(-1);
  // 배그식 3인칭: 목표 시점(tYaw/tPitch)을 마우스가 바로 바꾸고, 실제 시점은 살짝 늦게 따라가 부드럽다.
  // pivot은 몸을 부드럽게 따라가고(계단·점프에서 덜컹이지 않게), 거리는 벽에 막히면 즉시 당겨졌다가 천천히 풀린다.
  const cam = useRef({ yaw: Math.PI, pitch: 0.28, tYaw: Math.PI, tPitch: 0.28, dist: 3.2, fov: 60, pivot: new THREE.Vector3(), pivotInit: false, init: false, free: false, baseYaw: Math.PI, basePitch: 0.28, slowUntil: 0 });
  const lastSent = useRef(0);
  const anim = useRef("idle");
  const yawRef = useRef(0);
  const nearTag = useRef("");
  const animState = useRef({ value: "idle", pose: 0 });
  const lastSwing = useRef(0);
  const faceRef = useRef(0);

  useFrame(({ camera }, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const c = controlsRef.current;
    const snapNow = buf.latest() ?? snap;
    const meNow = snapNow.players[mySeat];
    if (!meNow) return;
    const b = body.current;
    const size3 = bodySize({ role: meNow.role, disguise: meNow.dg });
    b.r = size3.r;
    b.h = size3.h;
    // 방장이 순간이동시켰으면 따른다
    if (meNow.tp !== tpSeen.current) {
      tpSeen.current = meNow.tp;
      b.x = meNow.x;
      b.y = meNow.y;
      b.z = meNow.z;
      b.vy = 0;
      b.grounded = true;
      yawRef.current = faceRef.current = meNow.yaw;
      c.moveTo = null;
      cam.current.pivotInit = false;
      if (!cam.current.init) {
        cam.current.yaw = cam.current.tYaw = Math.PI;
        cam.current.init = true;
      }
    }
    const visible = meNow.role === "seeker" ? meNow.alive : meNow.alive && !meNow.escaped && !!meNow.dg;
    const canMove = visible && (snapNow.phase === "hunt" || (snapNow.phase === "hide" && meNow.role === "hider"));

    // 시점 — 입력은 목표값에 바로, 실제 시점은 지수 감쇠로 따라간다 (조준 중엔 더 둔하게)
    const aimingNow = c.aim && meNow.role === "seeker" && snapNow.phase === "hunt";
    const sens = c.sens * (aimingNow ? 0.5 : 1);
    const cm = cam.current;
    const nowT = performance.now();
    // 둘러보기: 누르는 순간의 방향을 기억하고, 떼면 그 방향으로 부드럽게 돌아온다
    if (c.freeLook && !cm.free) {
      cm.free = true;
      cm.baseYaw = cm.tYaw;
      cm.basePitch = cm.tPitch;
    } else if (!c.freeLook && cm.free) {
      cm.free = false;
      cm.tYaw = cm.baseYaw;
      cm.tPitch = cm.basePitch;
      cm.slowUntil = nowT + 450;
    }
    // 뒤돌기: 시점 180° (사람·동물·술래는 몸도 같이, 물건은 몸이 돌면 들키니 시점만)
    if (c.turn) {
      c.turn = false;
      cm.tYaw += Math.PI;
      if (cm.free) cm.baseYaw += Math.PI;
      cm.slowUntil = nowT + 450;
      const dd = disguise(meNow.dg);
      if (meNow.role === "seeker" || (dd && dd.form !== "prop")) faceRef.current += Math.PI;
    }
    cm.tYaw -= c.lookDX * 0.0032 * sens;
    cm.tPitch = Math.max(-0.55, Math.min(1.15, cm.tPitch + c.lookDY * 0.0026 * sens));
    c.lookDX = 0;
    c.lookDY = 0;
    const kLook = 1 - Math.exp(-dt * (nowT < cm.slowUntil ? 11 : 26));
    cm.yaw += angDiff(cm.tYaw, cm.yaw) * kLook;
    cm.pitch += (cm.tPitch - cm.pitch) * kLook;
    const cy = cm.yaw;
    const fx = Math.sin(cy);
    const fz = Math.cos(cy);
    // 이동·몸 방향 기준: 둘러보는 중엔 누르기 전 방향
    const my = cm.free ? cm.baseYaw : cy;
    const mfx = Math.sin(my);
    const mfz = Math.cos(my);

    let moving = false;
    if (canMove) {
      const grid = props.gridRef.current;
      let mx = -c.mx * Math.cos(my) + c.mz * mfx;
      let mz = c.mx * Math.sin(my) + c.mz * mfz;
      if (Math.hypot(c.mx, c.mz) > 0.05) c.moveTo = null;
      else if (c.moveTo) {
        const dx = c.moveTo[0] - b.x;
        const dz = c.moveTo[2] - b.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.35) c.moveTo = null;
        else {
          mx = dx / d;
          mz = dz / d;
        }
      }
      const len = Math.hypot(mx, mz);
      if (len > 1) {
        mx /= len;
        mz /= len;
      }
      const run = c.run || (c.moveTo !== null && Math.hypot(c.moveTo[0] - b.x, c.moveTo[2] - b.z) > 6);
      const speed = walkSpeed({ role: meNow.role, disguise: meNow.dg }) * (run ? RUN_MULT : 1);
      if (grid) {
        const now = performance.now();
        const bodies: Cyl[] = [];
        for (const q of snapNow.players) {
          if (q.s === mySeat) continue;
          const vis = q.role === "seeker" ? q.alive : q.alive && !q.escaped && !!q.dg;
          if (!vis) continue;
          const pp = buf.player(q.s, now);
          if (!pp) continue;
          const sz = bodySize({ role: q.role, disguise: q.dg });
          bodies.push({ x: pp.x, z: pp.z, y0: pp.y, y1: pp.y + sz.h, r: sz.r });
        }
        for (const n of snapNow.npcs) {
          if (n.kind === "car") continue;
          const pp = buf.npc(n.id, now);
          if (!pp) continue;
          const sz = npcSize(n.kind);
          bodies.push({ x: pp.x, z: pp.z, y0: pp.y, y1: pp.y + sz.h, r: sz.r });
        }
        for (const d of snapNow.decoys) {
          const def = disguise(d.disguise);
          bodies.push({ x: d.x, z: d.z, y0: d.y, y1: d.y + (def?.h ?? 1), r: def?.r ?? 0.3 });
        }
        const world: CollWorld = { grid: grid.grid, dynamic: dynamicSolids(snapNow), bodies };
        const ox = b.x;
        const oz = b.z;
        stepBody(b, { dx: mx, dz: mz, jump: c.jump }, speed, dt, world);
        const moved = Math.hypot(b.x - ox, b.z - oz);
        moving = moved > speed * dt * 0.2;
        const def = disguise(meNow.dg);
        const turns = meNow.role === "seeker" || (def && def.form !== "prop");
        if (moving && turns) faceRef.current = Math.atan2(b.x - ox, b.z - oz);
        if (c.moveTo && !moving) c.moveTo = null;
        anim.current = !b.grounded ? "jump" : moving ? (run ? "run" : "walk") : "idle";
      }
      // 상호작용
      const near = findNear(b, snapNow);
      const tag = near ? `${near.kind}:${near.id}:${near.label}` : "";
      if (tag !== nearTag.current) {
        nearTag.current = tag;
        onNear(near);
      }
      if (c.use && near) {
        if (near.kind === "ladder") {
          const to = near.id === 0 ? LADDER_TOP : LADDER_BOTTOM;
          b.x = to[0];
          b.y = to[1];
          b.z = to[2];
          b.vy = 0;
          b.grounded = true;
        } else if (near.kind === "door") onAct({ t: "door", id: near.id });
        else if (near.kind === "window") onAct({ t: "window", id: near.id });
        else if (near.kind === "chest") onAct({ t: "chest", slot: near.id });
      }
    } else if (nearTag.current) {
      nearTag.current = "";
      onNear(null);
    }
    c.jump = false;
    c.use = false;

    // 자세: 움직이면 사람·동물은 기본 자세로
    const def = disguise(meNow.dg);
    let pose = c.pose;
    if (moving && def && def.form !== "prop") pose = c.pose = 0;
    let showAnim = anim.current;
    if (!moving && b.grounded) {
      if (meNow.role === "seeker") showAnim = snapNow.phase === "hunt" && performance.now() - lastSwing.current < 450 ? "inspect" : c.aim ? "aim" : "idle";
      else if (def && def.form !== "prop") showAnim = poseOf(def.form, pose).anim ?? "idle";
      const em = meNow.em ? EMOTES.find((e) => e.id === meNow.em!.id) : null;
      if (em) showAnim = em.anim;
    }
    animState.current.value = showAnim;
    animState.current.pose = pose;

    // 공격
    if (c.attack) {
      c.attack = false;
      if (meNow.role === "seeker" && meNow.alive && snapNow.phase === "hunt") {
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        onAct({ t: "atk", o: [camera.position.x, camera.position.y, camera.position.z], d: [dir.x, dir.y, dir.z] });
        lastSwing.current = performance.now();
        faceRef.current = Math.atan2(dir.x, dir.z);
      }
    }
    // 술래는 조준하거나 서 있을 땐 카메라가 보는 쪽을 바라본다 (배그처럼)
    if (meNow.role === "seeker" && !cm.free && (aimingNow || (!moving && performance.now() - lastSwing.current < 1500))) faceRef.current = Math.atan2(fx, fz);
    yawRef.current += angDiff(faceRef.current, yawRef.current) * (1 - Math.exp(-dt * 13));

    // 위치 보고 (100ms)
    const now = performance.now();
    if (visible && now - lastSent.current > 100) {
      lastSent.current = now;
      onPos({ x: r2(b.x), y: r2(b.y), z: r2(b.z), yaw: r2(yawRef.current), anim: showAnim, pose, tp: meNow.tp });
    }
    if (group.current) {
      group.current.visible = visible;
      group.current.position.set(b.x, b.y, b.z);
      group.current.rotation.y = yawRef.current;
    }
    selfRef.current.x = b.x;
    selfRef.current.y = b.y;
    selfRef.current.z = b.z;
    selfRef.current.yaw = yawRef.current;
    selfRef.current.camYaw = cy;

    // 카메라 — 잡혔으면 다른 사람을 따라본다
    let px = b.x;
    let py = b.y;
    let pz = b.z;
    let ph = b.h;
    camState.hideSeat = -1;
    if (!visible && props.spectate !== null) {
      const sp = buf.player(props.spectate, now);
      const sq = snapNow.players[props.spectate];
      if (sp && sq) {
        px = sp.x;
        py = sp.y;
        pz = sp.z;
        ph = bodySize({ role: sq.role, disguise: sq.dg }).h;
      }
    }
    const sniper = aimingNow && weaponSchedule(snapNow.options.huntSec)[snapNow.tier] === "sniper";
    const small = ph < 1.2;
    const eyeH = small ? Math.max(0.55, ph + 0.45) : ph * 0.92;
    // 몸을 부드럽게 따라가는 피벗 (수평은 빠르게, 높이는 천천히 — 계단·점프가 출렁이지 않게)
    const pv = cam.current.pivot;
    if (!cam.current.pivotInit) {
      pv.set(px, py + eyeH, pz);
      cam.current.pivotInit = true;
    } else {
      const kh = 1 - Math.exp(-dt * 20);
      const kv = 1 - Math.exp(-dt * 9);
      pv.x += (px - pv.x) * kh;
      pv.z += (pz - pv.z) * kh;
      pv.y += (py + eyeH - pv.y) * kv;
    }
    const pitch = cam.current.pitch;
    const fwd = new THREE.Vector3(fx * Math.cos(pitch), -Math.sin(pitch), fz * Math.cos(pitch));
    const right = new THREE.Vector3(-Math.cos(cy), 0, Math.sin(cy));
    // 어깨 너머: 캐릭터가 화면 왼쪽에 오도록 오른쪽 어깨 뒤에서 본다
    const shoulder = sniper ? 0 : aimingNow ? 0.62 : small ? 0.35 : 0.55;
    const want = sniper ? 0 : aimingNow ? 1.25 : (small ? 3.0 : 3.1) * c.zoom;
    const origin = pv.clone().addScaledVector(right, shoulder);
    if (sniper) origin.copy(pv);
    // 벽 충돌: 머리 → 어깨 → 카메라까지 막히면 그 앞까지 즉시 당기고, 풀리면 천천히 뒤로
    let free = want;
    const grid = props.gridRef.current;
    if (grid && want > 0) {
      const dyn = dynamicSolids(snapNow);
      const back = fwd.clone().negate();
      const sideHit = cameraBlock(grid.grid.all, dyn, pv, right, shoulder + 0.15);
      if (sideHit !== null) origin.copy(pv).addScaledVector(right, Math.max(0, sideHit - 0.2));
      for (const [ox, oy] of [
        [0, 0],
        [0.18, 0.12],
        [-0.18, 0.12],
        [0, -0.15],
      ] as const) {
        const o = origin.clone().addScaledVector(right, ox);
        o.y += oy;
        const hit = cameraBlock(grid.grid.all, dyn, o, back, want + 0.3);
        if (hit !== null) free = Math.min(free, Math.max(0.2, hit - 0.25));
      }
    }
    if (free < cam.current.dist) cam.current.dist = free;
    else cam.current.dist += (free - cam.current.dist) * (1 - Math.exp(-dt * 3.2));
    const dist = cam.current.dist;
    const hideSelf = sniper || dist < 0.75;
    if (group.current && hideSelf) group.current.visible = false;
    if (!visible && props.spectate !== null && dist < 0.75) camState.hideSeat = props.spectate;
    camera.position.copy(origin).addScaledVector(fwd, -dist);
    camera.lookAt(camera.position.clone().add(fwd));
    // 시야각: 가로 기준(배그 3인칭 ≈ 80°)을 세로로 바꿔 화면 비율이 달라도 같은 넓이로 보이게
    const pc = camera as THREE.PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    const hfov = sniper ? 16 : aimingNow ? 58 : 82;
    const vfov = Math.min(sniper ? 20 : 78, Math.max(sniper ? 10 : 42, (2 * Math.atan(Math.tan((hfov * Math.PI) / 360) / aspect) * 180) / Math.PI));
    cam.current.fov += (vfov - cam.current.fov) * (1 - Math.exp(-dt * 12));
    if (Math.abs(pc.fov - cam.current.fov) > 0.01) {
      pc.fov = cam.current.fov;
      pc.updateProjectionMatrix();
    }
  });
  const def = disguise(me.dg);
  const castKey = castKeyFor(snap.seed, snap.round, me.s);
  const myName = props.names[mySeat] ?? "";
  return (
    <group ref={group}>
      <BlobShadow radius={me.role === "seeker" ? 0.42 : Math.max(0.3, (def?.r ?? 0.3) * 1.4)} opacity={0.7} />
      <AnimProxy stateRef={animState} render={(a, pose) => (me.role === "seeker" ? <SeekerVrm seat={me.s} name={myName} anim={a} /> : <FormModel dg={me.dg} anim={a} pose={pose} look={(me.s * 3 + 1) % 8} castKey={castKey} />)} />
      {me.em && <Bubble text={`${EMOTES.find((e) => e.id === me.em!.id)?.icon ?? ""} ${EMOTES.find((e) => e.id === me.em!.id)?.line ?? ""}`} y={(def?.h ?? 1.75) + 0.5} />}
    </group>
  );
}

/** useFrame에서 바뀌는 몸짓·자세를 바뀔 때만 React 상태에 반영 */
function AnimProxy({ stateRef, render }: { stateRef: RefObject<{ value: string; pose: number }>; render: (a: string, pose: number) => ReactNode }) {
  const [cur, setCur] = useState({ value: "idle", pose: 0 });
  useFrame(() => {
    const st = stateRef.current;
    if (st.value !== cur.value || st.pose !== cur.pose) setCur({ value: st.value, pose: st.pose });
  });
  return <>{render(cur.value, cur.pose)}</>;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** b → a 로 가는 가장 짧은 각도 차 */
function angDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** 카메라가 너무 가까울 때 숨길 관전 대상 (useFrame끼리만 주고받는 값) */
const camState = { hideSeat: -1 };

function cameraBlock(solids: readonly { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; k: string }[], dyn: readonly { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; k: string }[], o: THREE.Vector3, d: THREE.Vector3, max: number): number | null {
  let best: number | null = null;
  const test = (s: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; k: string }) => {
    if (s.k === "glass" || s.k === "prop" || s.k === "car") return;
    const t = rayBox(o.x, o.y, o.z, d.x, d.y, d.z, s.x0, s.x1, s.y0, s.y1, s.z0, s.z1, best ?? max);
    if (t !== null && t > 0.05 && (best === null || t < best)) best = t;
  };
  for (const s of solids) {
    if (Math.abs((s.x0 + s.x1) / 2 - o.x) > max + 8 || Math.abs((s.z0 + s.z1) / 2 - o.z) > max + 8) continue;
    test(s);
  }
  for (const s of dyn) test(s);
  return best;
}

function findNear(b: Body, snap: Snap): NearInfo | null {
  let best: NearInfo | null = null;
  let bd = 1.7;
  const consider = (x: number, y: number, z: number, info: NearInfo, reach = 1.7) => {
    if (Math.abs(b.y - y) > 1.4) return;
    const d = Math.hypot(b.x - x, b.z - z);
    if (d < Math.min(bd, reach)) {
      bd = d;
      best = info;
    }
  };
  for (const c of snap.chests) {
    if (c.opened) continue;
    const s = CHEST_SLOTS[c.slot];
    consider(s.x, slotY(s), s.z, { kind: "chest", id: c.slot, label: "🎁 보물 상자 열기" });
  }
  consider(LADDER_BOTTOM[0], LADDER_BOTTOM[1], LADDER_BOTTOM[2] - 0.4, { kind: "ladder", id: 0, label: "🪜 다락으로 오르기" }, 1.3);
  consider(LADDER_TOP[0], LADDER_TOP[1], LADDER_TOP[2], { kind: "ladder", id: 1, label: "🪜 사다리 내려가기" }, 1.1);
  for (const w of WINDOWS) consider(w.x, w.y, w.z, { kind: "window", id: w.id, label: snap.windows[w.id] ? `🪟 ${w.name} 닫기` : `🪟 ${w.name} 열기` }, 1.5);
  for (const d of DOORS) consider(d.x, d.y, d.z, { kind: "door", id: d.id, label: snap.doors[d.id] ? `🚪 ${d.name} 닫기` : `🚪 ${d.name} 열기` }, 1.6);
  return best;
}

// ---------------------------------------------------------------------------

function Scene(props: World3DProps) {
  const { snap, buf, mySeat, names, controlsRef } = props;
  const gridRef = useRef<ReturnType<typeof roundGrid> | null>(null);
  const round = useMemo(() => roundGrid(snap.seed, Math.max(1, snap.round)), [snap.seed, snap.round]);
  const figCtx = useMemo(() => ({ seed: snap.seed, round: snap.round, low: props.lowDetail }), [snap.seed, snap.round, props.lowDetail]);
  useEffect(() => {
    gridRef.current = round;
  }, [round]);
  const me = snap.players[mySeat];
  const meDead = me && (me.role === "seeker" ? !me.alive : !me.alive || me.escaped);
  const chests = chestThings(snap);
  return (
    <>
      <FigCtx.Provider value={figCtx}>
      <color attach="background" args={[DUSK.horizon]} />
      <fog attach="fog" args={[DUSK.fog, 38, 120]} />
      <Sky />
      <hemisphereLight args={[DUSK.sky, DUSK.ground, 0.85]} />
      <SunLight shadows={!props.lowDetail} followRef={props.selfRef} />
      <StudioEnvironment intensity={0.32} />
      <ShadowSetup enabled={!props.lowDetail} />
      <group
        onClick={(e: ThreeEvent<MouseEvent>) => {
          if (!props.clickMove || e.delta > 6) return;
          const n = e.face?.normal;
          if (n && Math.abs(n.y) < 0.5 && e.object.type !== "InstancedMesh") return;
          e.stopPropagation();
          controlsRef.current.moveTo = [e.point.x, e.point.y, e.point.z];
        }}
      >
        <Ground />
        <StaticBoxes />
        {FIXED_THINGS.map((t) => (
          <ThingAt key={t.id} t={t} pedLight={snap.pedLight} />
        ))}
        {round.fillers.map((t) => (
          <ThingAt key={t.id} t={t} pedLight={snap.pedLight} />
        ))}
        {chests.map((t) => (
          <ThingAt key={t.id} t={t} pedLight={snap.pedLight} />
        ))}
        <DoorsAndWindows doors={snap.doors} windows={snap.windows} />
      </group>
      {snap.goal?.open && <GoalBeacon slot={snap.goal.slot} />}
      {snap.npcs.map((n) => (
        <NpcView key={n.id} buf={buf} id={n.id} kind={n.kind} anim={n.anim} look={n.look} />
      ))}
      {snap.decoys.map((d) => (
        <DecoyView key={d.id} buf={buf} id={d.id} dg={d.disguise} anim={d.anim} pose={d.pose} look={(d.owner * 3 + 1) % 8} owner={d.owner} />
      ))}
      {snap.players.map((p) => {
        if (p.s === mySeat) return null;
        const vis = p.role === "seeker" ? p.alive : p.alive && !p.escaped && !!p.dg;
        if (!vis || snap.phase === "gameOver") return null;
        // 이름표: 술래는 모두에게, 숨는 사람 이름은 같은 편(또는 탈락자)에게만
        const showName = p.s !== props.spectate && (p.role === "seeker" || meDead || me?.role === "hider");
        return <RemotePlayer key={`${p.s}:${p.dg}:${p.role}`} buf={buf} p={p} snap={snap} name={names[p.s] ?? `${p.s + 1}번`} showName={showName} />;
      })}
      {me && <LocalPlayer key={`${me.role}:${me.dg}`} {...props} gridRef={gridRef} />}
      <Effects fx={props.fx} snap={snap} />
      <AdaptiveResolution max={props.lowDetail ? 1.25 : 1.75} />
      {!props.lowDetail && <PostFx bloom={0.42} ao={false} />}
      </FigCtx.Provider>
    </>
  );
}

export default function World3D(props: World3DProps) {
  return (
    <Canvas shadows={props.lowDetail ? false : "soft"} dpr={props.lowDetail ? [1, 1.25] : [1, 1.75]} gl={{ antialias: !props.lowDetail, powerPreference: "high-performance" }} camera={{ fov: 62, position: [9, 4, 14], near: 0.08, far: 160 }} style={{ touchAction: "none" }}>
      <Scene {...props} />
    </Canvas>
  );
}
