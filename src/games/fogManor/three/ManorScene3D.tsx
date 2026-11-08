"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { resolveLook } from "@/games/shared/three/SeatedPerson";
import ScreenSprite from "@/games/shared/three/ScreenSprite";
import { AdaptiveResolution } from "@/games/shared/three/sceneFx";
import { labelTexture } from "@/games/shared/three/tableKit";
import { roomCharacterOf, useRoomCharacters } from "@/lib/character/roomCharacters";
import HouseFigure from "@/games/hideAndSeek/three/HouseFigure";
import Prop from "@/games/hideAndSeek/three/Props";
import type { PropKind } from "@/games/hideAndSeek/house";
import { ROOMS, SEAT_COLORS, SEAT_GLYPHS, SUSPECTS } from "../data";

/**
 * 안개 저택 — 앞벽을 걷어낸 3층 × 3관 인형의 집 단면 (규칙서 §2-2). 위에서부터 2층·1층·지하.
 * 탐정은 VRM 캐릭터(내 캐릭터 설정 그대로)로 방 사이를 걷고, 용의자는 색 실루엣 + 이름표.
 * 이동할 수 있는 방은 바닥이 금빛으로 빛나고, 누르면 이동한다. 숨김 정보는 이 파일로 오지 않는다.
 */

export interface ManorScene3DProps {
  pos: number[];
  suspectPos: number[];
  names: Record<number, string>;
  viewerSeat: number;
  moveOptions: number[];
  onPickRoom: (room: number) => void;
  bellRooms: number[];
  deckCount: number[];
  lastMove: { seat: number; from: number; to: number; key: number } | null;
  eliminated: boolean[];
  lowDetail: boolean;
}

const W = 6.2;
const H = 3.2;
const D = 4.6;

/** 방 바닥 가운데 (row 0 = 2층) */
function roomBase(r: number): THREE.Vector3 {
  const row = Math.floor(r / 3);
  const col = r % 3;
  return new THREE.Vector3((col - 1) * W, (2 - row) * H, 0);
}

const FURNITURE: { kind: PropKind; x: number; z: number; rot?: number }[][] = [
  [{ kind: "bed", x: -1.4, z: -1 }, { kind: "wardrobe", x: 1.9, z: -1.6 }],
  [{ kind: "piano", x: -1.2, z: -1.3 }, { kind: "curtain", x: 2.2, z: -1.9 }],
  [{ kind: "bookcase", x: -1.8, z: -1.8 }, { kind: "desk", x: 1.2, z: -1.1 }],
  [{ kind: "plant", x: -2, z: -1.5 }, { kind: "plant", x: 0, z: -1.7 }, { kind: "plant", x: 2, z: -1.4 }],
  [{ kind: "table", x: 0, z: -1 }],
  [{ kind: "sofa", x: -0.8, z: -1.4 }, { kind: "vanity", x: 2, z: -1.7 }],
  [{ kind: "sink", x: -1.5, z: -1.7 }, { kind: "pantry", x: 1.6, z: -1.7 }],
  [{ kind: "shelf", x: -1.6, z: -1.8 }, { kind: "boxes", x: 1.4, z: -1.2 }],
  [{ kind: "table", x: 0.4, z: -0.9 }, { kind: "trunk", x: -2.1, z: -1.6 }],
];

const WALL = ["#3d2c3f", "#2f3352", "#3d3023", "#24402f", "#4a3420", "#4a2629", "#33383d", "#3f1f2a", "#1b3a2c"];

function Room({ r, movable, mine, onPick }: { r: number; movable: boolean; mine: boolean; onPick: () => void }) {
  const b = roomBase(r);
  const room = ROOMS[r];
  return (
    <group position={b}>
      {/* 바닥 */}
      <mesh position={[0, -0.06, 0]}>
        <boxGeometry args={[W - 0.1, 0.12, D]} />
        <meshStandardMaterial color={room.tint} roughness={0.85} />
      </mesh>
      {/* 뒷벽 */}
      <mesh position={[0, H / 2, -D / 2]}>
        <boxGeometry args={[W - 0.1, H, 0.12]} />
        <meshStandardMaterial color={WALL[r]} roughness={0.9} />
      </mesh>
      {/* 액자/창 — 방마다 작은 장식 */}
      <mesh position={[0, H * 0.62, -D / 2 + 0.08]}>
        <planeGeometry args={[1.3, 0.8]} />
        <meshStandardMaterial color={r < 3 ? "#5b6b9a" : r < 6 ? "#8a6a3c" : "#2a2a2a"} emissive={r < 3 ? "#1d2a55" : "#000000"} emissiveIntensity={0.6} />
      </mesh>
      {FURNITURE[r].map((f, i) => (
        <group key={i} position={[f.x, 0, f.z]} rotation-y={f.rot ?? 0} scale={0.85}>
          <Prop kind={f.kind} />
        </group>
      ))}
      {/* 이동 가능 표시 + 누르기 */}
      {movable && (
        <mesh position={[0, 0.02, 0.3]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[W - 0.6, D - 0.8]} />
          <meshBasicMaterial color="#fbbf24" transparent opacity={0.28} />
        </mesh>
      )}
      {mine && (
        <mesh position={[0, 0.015, 0.3]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[1.4, 1.6, 40]} />
          <meshBasicMaterial color="#fde68a" transparent opacity={0.5} />
        </mesh>
      )}
      <mesh
        position={[0, H / 2, 0]}
        onClick={(e) => {
          if (!movable) return;
          e.stopPropagation();
          onPick();
        }}
        onPointerOver={() => {
          if (movable) document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
        }}
      >
        <boxGeometry args={[W - 0.2, H - 0.1, D]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <ScreenSprite position={[-W / 2 + 1.25, H - 1.2, -D / 2 + 0.35]} scale={[1.35, 0.34]} map={labelTexture(`${room.icon} ${room.name}`, movable ? "#fbbf24" : "#e7d7c1", { bg: "rgba(20,14,24,0.85)", fg: "#f5e9d6" })} />
    </group>
  );
}

function Shell() {
  return (
    <group>
      {/* 층 사이 바닥판 · 지붕 · 옆벽 · 칸막이 */}
      {[0, 1, 2, 3].map((k) => (
        <mesh key={`slab${k}`} position={[0, k * H - 0.13, 0]}>
          <boxGeometry args={[W * 3 + 0.4, 0.14, D + 0.3]} />
          <meshStandardMaterial color={k === 3 ? "#2a1c18" : "#4b3527"} roughness={0.9} />
        </mesh>
      ))}
      {[-1.5, -0.5, 0.5, 1.5].map((c) => (
        <mesh key={`wall${c}`} position={[c * W, (H * 3) / 2, 0]}>
          <boxGeometry args={[0.14, H * 3, D]} />
          <meshStandardMaterial color="#3a2a22" roughness={0.9} />
        </mesh>
      ))}
      {/* 지붕 */}
      <mesh position={[-W * 0.78, H * 3 + 0.75, 0]} rotation-z={0.32}>
        <boxGeometry args={[W * 1.7, 0.18, D + 0.6]} />
        <meshStandardMaterial color="#231716" roughness={0.95} />
      </mesh>
      <mesh position={[W * 0.78, H * 3 + 0.75, 0]} rotation-z={-0.32}>
        <boxGeometry args={[W * 1.7, 0.18, D + 0.6]} />
        <meshStandardMaterial color="#231716" roughness={0.95} />
      </mesh>
      {/* 땅 + 안개 바다 */}
      <mesh position={[0, -0.4, 2]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[60, 30]} />
        <meshStandardMaterial color="#101820" roughness={1} />
      </mesh>
    </group>
  );
}

/** 비밀 통로 — 대각선 끝방끼리 점선 */
function Passages() {
  const lines = useMemo(() => {
    return ([
      [0, 8],
      [2, 6],
    ] as const).map(([a, b]) => {
      const pa = roomBase(a).add(new THREE.Vector3(0, 0.6, -D / 2 + 0.3));
      const pb = roomBase(b).add(new THREE.Vector3(0, 0.6, -D / 2 + 0.3));
      const geo = new THREE.BufferGeometry().setFromPoints([pa, pb]);
      const mat = new THREE.LineDashedMaterial({ color: "#a78bfa", dashSize: 0.3, gapSize: 0.25, transparent: true, opacity: 0.45 });
      const line = new THREE.Line(geo, mat);
      line.computeLineDistances();
      return line;
    });
  }, []);
  return (
    <>
      {lines.map((l, i) => (
        <primitive key={i} object={l} />
      ))}
    </>
  );
}

function SuspectFigure({ i, room, slot }: { i: number; room: number; slot: number }) {
  const s = SUSPECTS[i];
  const p = roomBase(room).add(new THREE.Vector3(-2.2 + slot * 0.75, 0, 1.4));
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    g.position.lerp(p, 0.06);
  });
  return (
    <group ref={ref} position={p}>
      <mesh position={[0, 0.45, 0]}>
        <cylinderGeometry args={[0.14, 0.22, 0.9, 10]} />
        <meshStandardMaterial color={s.color} roughness={0.6} transparent opacity={0.85} />
      </mesh>
      <mesh position={[0, 1.02, 0]}>
        <sphereGeometry args={[0.15, 12, 10]} />
        <meshStandardMaterial color="#e8d5c0" roughness={0.6} />
      </mesh>
      <ScreenSprite position={[0, 1.42, 0]} anchorY={1.25} scale={[0.95, 0.24]} map={labelTexture(`${s.icon} ${s.name}`, s.color)} />
    </group>
  );
}

function Clues({ room, count, bell }: { room: number; count: number; bell: boolean }) {
  const b = roomBase(room);
  return (
    <group position={b}>
      {Array.from({ length: count }, (_, k) => (
        <mesh key={k} position={[1.9 - k * 0.3, 0.02 + k * 0.012, 1.3]} rotation-x={-Math.PI / 2} rotation-z={0.3 * k}>
          <planeGeometry args={[0.35, 0.25]} />
          <meshStandardMaterial color={bell && k === 0 ? "#fde68a" : "#f3e9d2"} emissive={bell && k === 0 ? "#f59e0b" : "#000000"} emissiveIntensity={0.7} />
        </mesh>
      ))}
      {bell && <ScreenSprite position={[1.8, 0.7, 1.3]} anchorY={0.55} scale={[0.85, 0.22]} map={labelTexture("🔔 새 단서", "#fbbf24")} />}
    </group>
  );
}

function spotFor(room: number, seat: number): THREE.Vector3 {
  return roomBase(room).add(new THREE.Vector3(-1.5 + (seat % 3) * 1.25, 0, 0.35 + Math.floor(seat / 3) * 0.75));
}

const camGoal = { pos: new THREE.Vector3(0, 4.2, 18), look: new THREE.Vector3(0, 4.2, 0) };
function rigFrame(camera: THREE.Camera, dt: number, t: number) {
  const sway = Math.sin(t * 0.15) * 0.6;
  camera.position.lerp(new THREE.Vector3(camGoal.pos.x + sway, camGoal.pos.y, camGoal.pos.z), Math.min(1, dt * 2));
  camera.lookAt(camGoal.look);
}

function CameraRig() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    // 가로(3관)와 세로(3층 + 지붕) 둘 다 들어오게 — 앞쪽 바닥 끝이 가까워 보이는 만큼 여유 1.25배
    const d = Math.max(18, (W * 1.75) / (0.364 * aspect), (H * 1.9) / 0.364) * 1.08;
    camGoal.pos.set(0, H * 1.5 + 1.2, d);
    camGoal.look.set(0, H * 1.5 + 0.2, 0);
  }, [size]);
  useFrame((st, dt) => rigFrame(camera, dt, st.clock.elapsedTime));
  return null;
}

function SceneContents(props: ManorScene3DProps) {
  const { pos, suspectPos, names, viewerSeat, moveOptions, onPickRoom, bellRooms, deckCount, lastMove, eliminated, lowDetail } = props;
  const chars = useRoomCharacters((st) => st.byName);
  const nameKey = Object.entries(names)
    .map(([s, n]) => `${s}:${n}`)
    .join("|");
  const looks = useMemo(
    () =>
      Object.fromEntries(
        nameKey.split("|").map((e) => {
          const i = e.indexOf(":");
          const seat = Number(e.slice(0, i));
          return [seat, resolveLook(seat, ["none"], roomCharacterOf(chars, e.slice(i + 1)))];
        }),
      ),
    [nameKey, chars],
  );
  const bySlot = new Map<number, number>();
  return (
    <>
      <color attach="background" args={["#0a0c14"]} />
      <fog attach="fog" args={["#0a0c14", 24, 60]} />
      <hemisphereLight args={["#8090c8", "#24160f", 0.8]} />
      <ambientLight intensity={0.32} color="#ffd9a8" />
      <directionalLight position={[6, 12, 14]} intensity={0.85} color="#c8d0ff" />
      <directionalLight position={[-8, 5, 10]} intensity={0.5} color="#ffb070" />
      <Shell />
      <Passages />
      {ROOMS.map((_, r) => (
        <Room key={r} r={r} movable={moveOptions.includes(r)} mine={pos[viewerSeat] === r} onPick={() => onPickRoom(r)} />
      ))}
      {ROOMS.map((_, r) => (
        <Clues key={r} room={r} count={deckCount[r] ?? 0} bell={bellRooms.includes(r)} />
      ))}
      {suspectPos.map((room, i) => {
        const slot = bySlot.get(room) ?? 0;
        bySlot.set(room, slot + 1);
        return <SuspectFigure key={i} i={i} room={room} slot={slot} />;
      })}
      {pos.map((room, seat) => {
        const color = SEAT_COLORS[seat % SEAT_COLORS.length];
        const moving = lastMove && lastMove.seat === seat && lastMove.to === room;
        const path = moving ? [spotFor(lastMove.from, seat), spotFor(room, seat)] : [spotFor(room, seat)];
        const key = moving ? `m${lastMove.key}` : `s${room}`;
        return (
          <HouseFigure
            key={seat}
            look={looks[seat] ?? resolveLook(seat, ["none"])}
            seed={seat * 5 + 3}
            color={color}
            path={path}
            pathKey={key}
            faceTo={new THREE.Vector3(spotFor(room, seat).x, spotFor(room, seat).y, 6)}
            pose={eliminated[seat] ? "caught" : "stand"}
            lowDetail={lowDetail}
            size={0.78}
          >
            <ScreenSprite
              position={[0, 1.75, 0]}
              anchorY={1.5}
              scale={[0.85, 0.21]}
              map={labelTexture(`${SEAT_GLYPHS[seat % SEAT_GLYPHS.length]} ${seat === viewerSeat ? "나" : (names[seat] ?? `${seat + 1}번`)}`, color, seat === viewerSeat ? { bg: "rgba(60,40,8,0.9)", fg: "#fef3c7" } : {})}
            />
          </HouseFigure>
        );
      })}
      <CameraRig />
      <AdaptiveResolution max={lowDetail ? 1.5 : 2} />
    </>
  );
}

export default function ManorScene3D(props: ManorScene3DProps) {
  return (
    <Canvas dpr={props.lowDetail ? [1, 1.5] : [1, 2]} gl={{ antialias: !props.lowDetail, powerPreference: "high-performance" }} camera={{ fov: 40, position: [0, 5, 20], near: 0.1, far: 120 }} style={{ touchAction: "pan-y" }}>
      <SceneContents {...props} />
    </Canvas>
  );
}
