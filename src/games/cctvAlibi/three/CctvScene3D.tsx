"use client";

import { useEffect, useMemo } from "react";
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
import { ROOMS, ROOM_COUNT, SEAT_COLORS, SEAT_GLYPHS, VAULT, hasStairs } from "../data";

/**
 * CCTV 알리바이 — 지붕을 걷어낸 저택 한 층(3×3 방)을 감시 카메라처럼 위에서 내려다본다 (규칙서 §2).
 * 지하 금고실은 집 앞쪽에 한 단 낮게 잘라 보여 주고, 계단이 있는 다섯 방엔 바닥 문(🪜)이 있다.
 * 인물은 VRM 캐릭터(내 캐릭터 설정 그대로)로, 재생 시각이 한 칸 움직이면 옆방으로 걸어간다.
 * 이 파일이 받는 위치는 언제나 "영상에 찍힌 위치"다 — 남의 실제 동선은 오지 않는다.
 */

export interface SceneActor {
  seat: number;
  room: number;
  /** 바로 앞 시각의 방 (걷는 연출용). 없으면 그 자리에 선다 */
  from: number | null;
}

export interface CctvScene3DProps {
  actors: SceneActor[];
  /** 걷기 연출 키 — 재생 시각이 바뀔 때마다 달라진다 */
  stepKey: string;
  names: Record<number, string>;
  viewerSeat: number;
  /** 누를 수 있는 방 (밤 계획) */
  pickable: number[];
  onPickRoom: (room: number) => void;
  /** 별표를 띄울 방 (내 할 일) */
  errands: number[];
  /** 붉은 고리로 표시할 "실제 위치" (범인 본인 또는 공개 뒤) */
  ghost: { room: number; label: string } | null;
  /** 센서 대조한 방: 일치/불일치 */
  scan: { room: number; hit: boolean } | null;
  lowDetail: boolean;
}

const W = 5.2;
const D = 4.4;
const WALL = 1.5;

function roomCenter(r: number): THREE.Vector3 {
  if (r === VAULT) return new THREE.Vector3(0, -1.6, D * 1.5 + 2.6);
  return new THREE.Vector3(((r % 3) - 1) * W, 0, (Math.floor(r / 3) - 1) * D);
}

function spotFor(room: number, seat: number): THREE.Vector3 {
  const c = roomCenter(room);
  return new THREE.Vector3(c.x - 1.3 + (seat % 3) * 1.3, c.y, c.z + 0.2 + Math.floor(seat / 3) * 1.1);
}

const FURNITURE: { kind: PropKind; x: number; z: number; rot?: number }[][] = [
  [{ kind: "bookcase", x: -1.5, z: -1.6 }, { kind: "desk", x: 1.3, z: -1.4 }],
  [{ kind: "mannequin", x: -1.7, z: -1.5 }, { kind: "curtain", x: 1.6, z: -1.8 }],
  [{ kind: "bed", x: -1.1, z: -1.2 }, { kind: "wardrobe", x: 1.8, z: -1.6 }],
  [{ kind: "plant", x: -1.8, z: -1.5 }, { kind: "plant", x: 0, z: -1.7 }, { kind: "plant", x: 1.8, z: -1.4 }],
  [{ kind: "trunk", x: -1.8, z: -1.6 }],
  [{ kind: "table", x: 0, z: -1.2 }],
  [{ kind: "piano", x: -1, z: -1.3 }],
  [{ kind: "coats", x: -1.7, z: -1.7 }, { kind: "shoecab", x: 1.6, z: -1.7 }],
  [{ kind: "sink", x: -1.3, z: -1.7 }, { kind: "pantry", x: 1.5, z: -1.7 }],
];

/** 2D 표의 어두운 바탕색을 3D 바닥에선 밝게 */
function floorColor(tint: string): THREE.Color {
  return new THREE.Color(tint).offsetHSL(0, 0.05, 0.14);
}

function Room({ r, pickable, onPick }: { r: number; pickable: boolean; onPick: () => void }) {
  const c = roomCenter(r);
  const room = ROOMS[r];
  const vault = r === VAULT;
  const w = vault ? W * 1.1 : W;
  const d = vault ? D * 0.8 : D;
  return (
    <group position={c}>
      <mesh position={[0, -0.06, 0]}>
        <boxGeometry args={[w - 0.12, 0.12, d - 0.12]} />
        <meshStandardMaterial color={floorColor(room.tint)} roughness={0.85} />
      </mesh>
      {/* 뒷벽 + 옆벽 (앞벽은 걷어냄) */}
      <mesh position={[0, WALL / 2, -d / 2]}>
        <boxGeometry args={[w, WALL, 0.14]} />
        <meshStandardMaterial color={vault ? "#5a2530" : "#6b5a4e"} roughness={0.9} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[(side * w) / 2, WALL * 0.3, 0]}>
          <boxGeometry args={[0.14, WALL * 0.6, d]} />
          <meshStandardMaterial color={vault ? "#5a2530" : "#5c4c40"} roughness={0.9} />
        </mesh>
      ))}
      {!vault &&
        FURNITURE[r].map((f, i) => (
          <group key={i} position={[f.x, 0, f.z]} rotation-y={f.rot ?? 0} scale={0.8}>
            <Prop kind={f.kind} />
          </group>
        ))}
      {vault && (
        <>
          <mesh position={[0, 0.45, -0.6]}>
            <boxGeometry args={[0.9, 0.9, 0.9]} />
            <meshStandardMaterial color="#6b7280" metalness={0.7} roughness={0.35} />
          </mesh>
          <mesh position={[0, 1.15, -0.6]} rotation-y={Math.PI / 4}>
            <octahedronGeometry args={[0.28, 0]} />
            <meshStandardMaterial color="#7dd3fc" emissive="#38bdf8" emissiveIntensity={1.2} roughness={0.1} />
          </mesh>
          <pointLight position={[0, 1.4, -0.4]} intensity={6} distance={6} color="#7dd3fc" />
        </>
      )}
      {/* 금고실로 내려가는 바닥 문 */}
      {!vault && hasStairs(r) && (
        <group position={[w / 2 - 0.75, 0.01, d / 2 - 0.7]}>
          <mesh rotation-x={-Math.PI / 2}>
            <planeGeometry args={[0.9, 0.9]} />
            <meshStandardMaterial color="#1a1512" roughness={1} />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position-y={0.005}>
            <ringGeometry args={[0.5, 0.58, 4, 1, Math.PI / 4]} />
            <meshBasicMaterial color="#fbbf24" transparent opacity={0.8} />
          </mesh>
        </group>
      )}
      {pickable && (
        <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[w - 0.5, d - 0.5]} />
          <meshBasicMaterial color={vault ? "#f87171" : "#fbbf24"} transparent opacity={0.3} />
        </mesh>
      )}
      <mesh
        position={[0, WALL / 2, 0]}
        onClick={(e) => {
          if (!pickable) return;
          e.stopPropagation();
          onPick();
        }}
        onPointerOver={() => {
          if (pickable) document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
        }}
      >
        <boxGeometry args={[w - 0.2, WALL, d - 0.2]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <ScreenSprite
        position={vault ? [-w / 2 + 1.3, 0.3, d / 2 - 0.3] : [-w / 2 + 1.3, WALL + 0.3, -d / 2]}
        scale={[1.3, 0.33]}
        map={labelTexture(`${room.icon} ${room.name}${!vault && hasStairs(r) ? " 🪜" : ""}`, pickable ? "#fbbf24" : "#e7d7c1", { bg: "rgba(14,16,22,0.85)", fg: "#f1f5f9" })}
      />
    </group>
  );
}

function Shell() {
  return (
    <group>
      <mesh position={[0, -0.2, 0]}>
        <boxGeometry args={[W * 3 + 0.5, 0.16, D * 3 + 0.5]} />
        <meshStandardMaterial color="#241b16" roughness={0.95} />
      </mesh>
      {/* 금고실 구덩이 테두리 */}
      <mesh position={[0, -0.95, D * 1.5 + 2.6]}>
        <boxGeometry args={[W * 1.1 + 0.6, 1.5, D * 0.8 + 0.6]} />
        <meshStandardMaterial color="#15100d" roughness={1} side={THREE.BackSide} />
      </mesh>
      <mesh position={[0, -1.9, 6]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[70, 50]} />
        <meshStandardMaterial color="#0b0f17" roughness={1} />
      </mesh>
    </group>
  );
}

/** 계단 방 → 금고실 점선 */
function StairLines() {
  const lines = useMemo(() => {
    const out: THREE.Line[] = [];
    for (let r = 0; r < ROOM_COUNT; r++) {
      if (!hasStairs(r)) continue;
      const a = roomCenter(r).add(new THREE.Vector3(W / 2 - 0.75, 0.05, D / 2 - 0.7));
      const b = roomCenter(VAULT).add(new THREE.Vector3(0, 0.3, 0));
      const mid = a.clone().lerp(b, 0.5).setY(-1.3);
      const geo = new THREE.BufferGeometry().setFromPoints(new THREE.QuadraticBezierCurve3(a, mid, b).getPoints(16));
      const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: "#fbbf24", dashSize: 0.25, gapSize: 0.25, transparent: true, opacity: 0.28 }));
      line.computeLineDistances();
      out.push(line);
    }
    return out;
  }, []);
  return (
    <>
      {lines.map((l, i) => (
        <primitive key={i} object={l} />
      ))}
    </>
  );
}

const camGoal = { pos: new THREE.Vector3(0, 17, 15), look: new THREE.Vector3(0, 0, 1.4) };

function CameraRig() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    // 가로(방 3칸)와 세로(방 3줄 + 금고실) 둘 다 들어오게 물러선다
    const k = Math.max(1, 1.3 / aspect);
    camGoal.pos.set(0, 17.2 * k, 14.9 * k + 2.6);
    camGoal.look.set(0, 0, 2.6);
  }, [size]);
  useFrame((st, dt) => {
    const sway = Math.sin(st.clock.elapsedTime * 0.12) * 0.5;
    camera.position.lerp(new THREE.Vector3(camGoal.pos.x + sway, camGoal.pos.y, camGoal.pos.z), Math.min(1, dt * 2));
    camera.lookAt(camGoal.look);
  });
  return null;
}

function SceneContents(props: CctvScene3DProps) {
  const { actors, stepKey, names, viewerSeat, pickable, onPickRoom, errands, ghost, scan, lowDetail } = props;
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
  return (
    <>
      <color attach="background" args={["#070a12"]} />
      <fog attach="fog" args={["#070a12", 30, 70]} />
      <hemisphereLight args={["#b9c8ee", "#3a2a1c", 1.5]} />
      <ambientLight intensity={0.9} color="#ffe9cc" />
      <directionalLight position={[6, 16, 10]} intensity={1.7} color="#e3e8ff" />
      <directionalLight position={[-8, 8, 6]} intensity={0.8} color="#ffc48f" />
      <Shell />
      <StairLines />
      {Array.from({ length: ROOM_COUNT + 1 }, (_, r) => (
        <Room key={r} r={r} pickable={pickable.includes(r)} onPick={() => onPickRoom(r)} />
      ))}
      {errands.map((r) => {
        const c = roomCenter(r);
        return <ScreenSprite key={`e${r}`} position={[c.x + W / 2 - 1.2, 1.5, c.z - D / 2 + 0.5]} scale={[1.15, 0.29]} map={labelTexture(`⭐ ${ROOMS[r].errand}`, "#fde68a", { bg: "rgba(60,40,8,0.9)", fg: "#fef3c7" })} />;
      })}
      {scan && (
        <mesh position={roomCenter(scan.room).setY(0.03)} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[1.5, 1.75, 48]} />
          <meshBasicMaterial color={scan.hit ? "#f87171" : "#4ade80"} transparent opacity={0.85} />
        </mesh>
      )}
      {ghost && (
        <group position={spotFor(ghost.room, viewerSeat >= 0 ? viewerSeat : 0)}>
          <mesh rotation-x={-Math.PI / 2} position-y={0.04}>
            <ringGeometry args={[0.36, 0.5, 28]} />
            <meshBasicMaterial color="#f87171" transparent opacity={0.9} depthWrite={false} />
          </mesh>
          <ScreenSprite position={[0, 0.7, 0]} scale={[1.05, 0.27]} map={labelTexture(ghost.label, "#f87171", { bg: "rgba(69,10,10,0.9)", fg: "#fecaca" })} />
        </group>
      )}
      {actors.map(({ seat, room, from }) => {
        const color = SEAT_COLORS[seat % SEAT_COLORS.length];
        const here = spotFor(room, seat);
        const walking = from !== null && from !== room;
        return (
          <HouseFigure
            key={seat}
            look={looks[seat] ?? resolveLook(seat, ["none"])}
            seed={seat * 5 + 3}
            color={color}
            path={walking ? [spotFor(from, seat), here] : [here]}
            pathKey={walking ? `w${stepKey}` : `s${room}`}
            faceTo={new THREE.Vector3(here.x, here.y, here.z + 8)}
            pose="stand"
            lowDetail={lowDetail}
            size={0.95}
            speed={5.5}
          >
            <ScreenSprite
              position={[0, 1.8, 0]}
              anchorY={1.55}
              scale={[0.9, 0.225]}
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

export default function CctvScene3D(props: CctvScene3DProps) {
  return (
    <Canvas dpr={props.lowDetail ? [1, 1.5] : [1, 2]} gl={{ antialias: !props.lowDetail, powerPreference: "high-performance" }} camera={{ fov: 38, position: [0, 17, 15], near: 0.1, far: 140 }} style={{ touchAction: "pan-y" }}>
      <SceneContents {...props} />
    </Canvas>
  );
}
