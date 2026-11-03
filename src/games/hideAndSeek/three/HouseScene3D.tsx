"use client";

import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { resolveLook } from "@/games/shared/three/SeatedPerson";
import ScreenSprite from "@/games/shared/three/ScreenSprite";
import { AdaptiveResolution } from "@/games/shared/three/sceneFx";
import { labelTexture } from "@/games/shared/three/tableKit";
import { roomCharacterOf, useRoomCharacters } from "@/lib/character/roomCharacters";
import { DOOR_LIST, FLOOR_Y, ROOMS, SPOTS, WALL_H, doorPoints, room, roomCenter, type RoomId } from "../house";
import { PILLAR, SEAT_COLORS, type ClueSpec, type FigureSpec, type P3 } from "../show";
import { ladderHop, nearestFlash, nearestTarget, roomOf, stepWalk, WALK_SPEED, type WalkInput, type WalkNear, type WalkPos, type WalkSpec } from "../walk";
import HouseFigure, { type Drive } from "./HouseFigure";
import Prop from "./Props";

/**
 * 한밤의 숨바꼭질 저택 — 앞벽을 걷어낸 인형의 집 단면. 1층(창고·현관·거실·욕실·부엌),
 * 2층(복도·안방·아이방·서재), 다락방, 앞마당의 술래 기둥.
 *
 * 보드가 인물(`figures`)과 단서(`clues`)를 이미 "보는 사람 기준"으로 걸러 넘긴다 — 남의 숨은
 * 위치는 이 파일로 들어오지 않는다. 고를 수 있는 숨을 곳/방은 금빛 고리로 빛나고 누르면 고른다.
 *
 * 부드러움: 그림자 맵 없음(발밑 원판), 포인트 라이트 없이 반구광+달빛+발광 램프, 저사양이면
 * 해상도 자동 조절(AdaptiveResolution).
 */

/** "shot" = 고정 구도 (로비 포스터 촬영용) */
export type CameraFocus = { kind: "all" } | { kind: "room"; room: RoomId } | { kind: "shot"; pos: P3; look: P3 };

export interface HouseScene3DProps {
  viewerSeat: number;
  names: Record<number, string>;
  figures: FigureSpec[];
  clues: ClueSpec[];
  /** Date.now() (ms) 판정 연출이 시작된 시각 */
  fxStart: number;
  pickSpots: string[];
  pickRooms: RoomId[];
  picked: { spot?: string; room?: RoomId } | null;
  onPickSpot: (id: string) => void;
  onPickRoom: (id: RoomId) => void;
  focus: CameraFocus;
  lowDetail: boolean;
  /** 직접 걷기 (없으면 끔) */
  walk?: { spec: WalkSpec | null; input: RefObject<WalkInput>; drive: RefObject<Drive>; onNear: (n: WalkNear) => void };
  /** 걷기 중 가까이 있는 대상 — 금빛으로 표시 */
  nearTarget?: P3 | null;
  /** 배그식 상호작용 표시: 가까운 대상 위에 "[E] 뒤지기" */
  nearLabel?: { at: P3; text: string } | null;
  /** 들썩이는 가구 (판정 연출 시각 기준 초, 내가 막 뒤지기로 고른 곳은 계속) */
  rummage?: { spot: string; at: number; until: number }[];
}

const v3 = (p: P3) => new THREE.Vector3(p[0], p[1], p[2]);

function fxClock(fxStart: number) {
  return (Date.now() - fxStart) / 1000;
}

// ---------------------------------------------------------------------------
// 집

function Slab({ x0, x1, z0, z1, y, color }: { x0: number; x1: number; z0: number; z1: number; y: number; color: string }) {
  return (
    <mesh position={[(x0 + x1) / 2, y - 0.08, (z0 + z1) / 2]}>
      <boxGeometry args={[x1 - x0, 0.16, z1 - z0]} />
      <meshStandardMaterial color={color} roughness={0.85} />
    </mesh>
  );
}

/** 벽 한 줄 — 문 자리는 비운다. axis "x": z 고정, x 방향으로 뻗음 */
function Wall({ axis, at, from, to, y, h, color, gaps = [] }: { axis: "x" | "z"; at: number; from: number; to: number; y: number; h: number; color: string; gaps?: number[] }) {
  const segs: [number, number][] = [];
  let cur = from;
  for (const g of [...gaps].sort((a, b) => a - b)) {
    if (g - 0.72 > cur) segs.push([cur, g - 0.72]);
    cur = g + 0.72;
  }
  if (cur < to) segs.push([cur, to]);
  return (
    <>
      {segs.map(([a, b]) => {
        const mid = (a + b) / 2;
        const len = b - a;
        return (
          <mesh key={`${a}`} position={axis === "x" ? [mid, y + h / 2, at] : [at, y + h / 2, mid]}>
            <boxGeometry args={axis === "x" ? [len, h, 0.14] : [0.14, h, len]} />
            <meshStandardMaterial color={color} roughness={0.9} />
          </mesh>
        );
      })}
    </>
  );
}

function House() {
  const half = 1.0;
  const y1 = FLOOR_Y[0];
  const y2 = FLOOR_Y[1];
  const y3 = FLOOR_Y[2];
  return (
    <group>
      {/* 바닥 */}
      {ROOMS.filter((r) => r.id !== "yard" && r.id !== "landing").map((r) => (
        <Slab key={r.id} x0={r.box[0]} x1={r.box[1]} z0={r.box[2]} z1={r.box[3]} y={FLOOR_Y[r.floor]} color={r.floorColor} />
      ))}
      {/* 2층 복도 바닥 — 계단 구멍(x -1.8~-0.8, z 0.45~2.85)을 비워 둔다 */}
      {(
        [
          [-5, -1.8, 0, 3.5],
          [-0.8, 0, 0, 3.5],
          [-1.8, -0.8, 2.85, 3.5],
          [-1.8, -0.8, 0, 0.45],
        ] as const
      ).map(([a, b, c, d]) => (
        <Slab key={`ld${a}${c}`} x0={a} x1={b} z0={c} z1={d} y={y2} color={room("landing").floorColor} />
      ))}
      {/* 계단 구멍 난간 (옆으로는 못 지나가는 그 난간) */}
      <Wall axis="z" at={-1.8} from={0.45} to={2.85} y={y2} h={0.75} color="#6d4c41" />
      <Wall axis="z" at={-0.8} from={0.45} to={2.85} y={y2} h={0.75} color="#6d4c41" />
      <Wall axis="x" at={2.85} from={-1.8} to={-0.8} y={y2} h={0.75} color="#6d4c41" />
      {/* 앞쪽 낮은 담 — 마당으로 나가는 문 자리만 비어 있다 */}
      <Wall axis="x" at={3.5} from={-9} to={-5} y={y1} h={0.55} color="#8d7b68" gaps={[-7]} />
      <Wall axis="x" at={3.5} from={-5} to={0} y={y1} h={0.55} color="#8d7b68" gaps={[-2.5]} />
      <Wall axis="x" at={3.5} from={0} to={5} y={y1} h={0.55} color="#8d7b68" gaps={[2.5]} />
      {/* 문틀 — 문 자리를 한눈에 */}
      {DOOR_LIST.flatMap(([a, b]) => {
        const pts = doorPoints(a, b);
        if (pts.length !== 1) return [];
        const [x, y, z] = pts[0];
        const alongX = Math.abs(z - Math.round(z)) < 0.01 && (z === 0 || z === 3.5) && !(Math.abs(x) === 5 || x === 0);
        return [-0.72, 0.72].map((o) => (
          <mesh key={`${a}${b}${o}`} position={alongX ? [x + o, y + 0.65, z] : [x, y + 0.65, z + o]}>
            <boxGeometry args={[0.12, 1.3, 0.12]} />
            <meshStandardMaterial color="#e8d5b0" roughness={0.7} />
          </mesh>
        ));
      })}
      {/* 바깥 벽 (뒤·옆) */}
      <Wall axis="x" at={-3.5} from={-9} to={-5} y={y1} h={WALL_H} color={room("garage").wallColor} />
      <Wall axis="x" at={-3.5} from={-5} to={0} y={y1} h={WALL_H} color={room("bath").wallColor} />
      <Wall axis="x" at={-3.5} from={0} to={5} y={y1} h={WALL_H} color={room("kitchen").wallColor} />
      <Wall axis="z" at={-9} from={-3.5} to={3.5} y={y1} h={WALL_H} color={room("garage").wallColor} />
      <Wall axis="z" at={5} from={-3.5} to={3.5} y={y1} h={WALL_H} color={room("living").wallColor} />
      <Wall axis="x" at={-3.5} from={-5} to={0} y={y2} h={WALL_H} color={room("kids").wallColor} />
      <Wall axis="x" at={-3.5} from={0} to={5} y={y2} h={WALL_H} color={room("study").wallColor} />
      <Wall axis="z" at={-5} from={-3.5} to={3.5} y={y2} h={WALL_H} color={room("landing").wallColor} />
      <Wall axis="z" at={5} from={-3.5} to={3.5} y={y2} h={WALL_H} color={room("master").wallColor} />
      <Wall axis="x" at={-3.5} from={-5} to={0} y={y3} h={1.6} color={room("attic").wallColor} />
      <Wall axis="z" at={-5} from={-3.5} to={0} y={y3} h={1.6} color={room("attic").wallColor} />
      <Wall axis="z" at={0} from={-3.5} to={0} y={y3} h={1.6} color={room("attic").wallColor} />
      {/* 창고 지붕 */}
      <mesh position={[-7, WALL_H + 0.08, 0]}>
        <boxGeometry args={[4.2, 0.16, 7.2]} />
        <meshStandardMaterial color="#4a3b33" roughness={0.9} />
      </mesh>
      {/* 다락 지붕 서까래 */}
      {[-4.6, -2.5, -0.4].map((x) => (
        <group key={x} position={[x, y3 + 1.6, -1.75]}>
          <mesh rotation-x={0.55} position={[0, 0.45, 0.85]}>
            <boxGeometry args={[0.12, 0.12, 2.1]} />
            <meshStandardMaterial color="#5d4037" />
          </mesh>
          <mesh rotation-x={-0.55} position={[0, 0.45, -0.85]}>
            <boxGeometry args={[0.12, 0.12, 2.1]} />
            <meshStandardMaterial color="#5d4037" />
          </mesh>
        </group>
      ))}
      {/* 낮은 칸막이 (문 자리 비움) — 뒷방이 보이게 허리 높이 */}
      <Wall axis="z" at={-5} from={0} to={3.5} y={y1} h={half} color="#9e8b74" gaps={[1.75]} />
      <Wall axis="z" at={-5} from={-3.5} to={0} y={y1} h={half} color="#9e8b74" />
      <Wall axis="z" at={0} from={0} to={3.5} y={y1} h={half} color="#9e8b74" gaps={[1.75]} />
      <Wall axis="z" at={0} from={-3.5} to={0} y={y1} h={half} color="#9e8b74" gaps={[-1.75]} />
      <Wall axis="x" at={0} from={-5} to={0} y={y1} h={half} color="#9e8b74" gaps={[-2.5]} />
      <Wall axis="x" at={0} from={0} to={5} y={y1} h={half} color="#9e8b74" gaps={[2.5]} />
      <Wall axis="z" at={0} from={0} to={3.5} y={y2} h={half} color="#9e8b74" gaps={[1.75]} />
      <Wall axis="z" at={0} from={-3.5} to={0} y={y2} h={half} color="#9e8b74" gaps={[-1.75]} />
      <Wall axis="x" at={0} from={-5} to={0} y={y2} h={half} color="#9e8b74" gaps={[-2.5]} />
      <Wall axis="x" at={0} from={0} to={5} y={y2} h={half} color="#9e8b74" gaps={[2.5]} />
      {/* 계단 (현관 → 2층 복도) */}
      {Array.from({ length: 10 }, (_, i) => (
        <mesh key={i} position={[-1.3, (i + 0.5) * 0.3, 2.85 - (i + 0.5) * 0.24]}>
          <boxGeometry args={[1.0, 0.3, 0.26]} />
          <meshStandardMaterial color="#8d6e63" roughness={0.8} />
        </mesh>
      ))}
      {/* 사다리 (아이방 → 다락) */}
      {[-0.95, -0.25].map((x) => (
        <mesh key={x} position={[x, y2 + 1.5, -3.2]}>
          <boxGeometry args={[0.07, 3.0, 0.07]} />
          <meshStandardMaterial color="#a1887f" />
        </mesh>
      ))}
      {Array.from({ length: 7 }, (_, i) => (
        <mesh key={i} position={[-0.6, y2 + 0.35 + i * 0.4, -3.2]}>
          <boxGeometry args={[0.7, 0.05, 0.05]} />
          <meshStandardMaterial color="#a1887f" />
        </mesh>
      ))}
      {/* 램프 (발광만) */}
      {ROOMS.filter((r) => r.id !== "yard").map((r) => {
        const c = roomCenter(r.id);
        return (
          <mesh key={r.id} position={[c.x, c.y + (r.floor === 2 ? 1.5 : WALL_H - 0.25), r.box[2] + 0.6]}>
            <sphereGeometry args={[0.13, 10, 8]} />
            <meshBasicMaterial color="#ffd59a" toneMapped={false} />
          </mesh>
        );
      })}
      <Yard />
    </group>
  );
}

function Yard() {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[-1, -0.02, 5]}>
        <planeGeometry args={[30, 12]} />
        <meshStandardMaterial color="#25381f" roughness={1} />
      </mesh>
      {/* 디딤돌 */}
      {[
        [-2.5, 4.2],
        [-2.0, 4.9],
        [-1.6, 5.4],
        [2.5, 4.3],
        [-7, 4.3],
      ].map(([x, z]) => (
        <mesh key={`${x}${z}`} rotation-x={-Math.PI / 2} position={[x, 0.01, z]}>
          <circleGeometry args={[0.32, 12]} />
          <meshStandardMaterial color="#8d8d8d" roughness={0.9} />
        </mesh>
      ))}
      {/* 술래 기둥: 나무 기둥 + 등불 */}
      <group position={PILLAR}>
        <mesh position-y={1.2}>
          <cylinderGeometry args={[0.16, 0.2, 2.4, 10]} />
          <meshStandardMaterial color="#6d4c41" roughness={0.9} />
        </mesh>
        <mesh position-y={2.55}>
          <boxGeometry args={[0.32, 0.36, 0.32]} />
          <meshBasicMaterial color="#ffcf7a" toneMapped={false} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
          <ringGeometry args={[0.5, 0.62, 28]} />
          <meshBasicMaterial color="#facc15" transparent opacity={0.5} toneMapped={false} />
        </mesh>
      </group>
      {/* 울타리 */}
      {Array.from({ length: 19 }, (_, i) => (
        <mesh key={i} position={[-9.5 + i * 1.0, 0.45, 7.8]}>
          <boxGeometry args={[0.1, 0.9, 0.1]} />
          <meshStandardMaterial color="#d7ccc8" />
        </mesh>
      ))}
      <mesh position={[-0.5, 0.7, 7.8]}>
        <boxGeometry args={[18.5, 0.08, 0.06]} />
        <meshStandardMaterial color="#d7ccc8" />
      </mesh>
      {/* 덤불 */}
      {[
        [4.4, 5.6],
        [-8.3, 6.4],
        [0.9, 7.1],
        [8.0, 7.0],
      ].map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x, 0.4, z]}>
          <sphereGeometry args={[0.6, 10, 8]} />
          <meshStandardMaterial color="#1e4620" roughness={1} />
        </mesh>
      ))}
      {/* 달 */}
      <mesh position={[9, 14, -14]}>
        <circleGeometry args={[1.4, 28]} />
        <meshBasicMaterial color="#fff8dc" toneMapped={false} />
      </mesh>
    </group>
  );
}

function RoomLabels() {
  return (
    <>
      {ROOMS.filter((r) => r.id !== "yard").map((r) => {
        const c = roomCenter(r.id);
        return <ScreenSprite key={r.id} position={[c.x, c.y + (r.floor === 2 ? 1.75 : r.box[2] === 0 ? WALL_H - 0.75 : WALL_H - 0.1), r.box[2] + 0.12]} scale={[0.95, 0.24]} map={labelTexture(`${r.icon} ${r.name}`, "#e2e8f0", { bg: "rgba(10,12,30,0.75)", fg: "#f8fafc" })} />;
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// 고르기 표시

function PickRing({ position, picked, size = 0.7, onPick }: { position: P3; picked: boolean; size?: number; onPick: () => void }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.opacity = picked ? 0.95 : 0.45 + Math.sin(clock.elapsedTime * 5) * 0.3;
  });
  return (
    <group position={position}>
      <mesh rotation-x={-Math.PI / 2} position-y={0.05}>
        <ringGeometry args={[size * 0.8, size, 32]} />
        <meshBasicMaterial ref={mat} color={picked ? "#22d3ee" : "#f2b544"} transparent opacity={0.7} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh
        position-y={0.7}
        onClick={(e) => {
          e.stopPropagation();
          onPick();
        }}
      >
        <boxGeometry args={[size * 2, 1.4, size * 2]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
    </group>
  );
}

/** 걷기 중 갈 수 있는 대상 표시 — 가까이 서면 밝은 하늘색 */
function TargetGlow({ at, near }: { at: P3; near: boolean }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.opacity = near ? 0.95 : 0.3 + Math.sin(clock.elapsedTime * 3) * 0.12;
  });
  return (
    <mesh rotation-x={-Math.PI / 2} position={[at[0], at[1] + 0.04, at[2]]}>
      <ringGeometry args={[near ? 0.75 : 0.62, near ? 0.95 : 0.72, 32]} />
      <meshBasicMaterial ref={mat} color={near ? "#67e8f9" : "#f2b544"} transparent opacity={0.4} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

function RoomPick({ id, picked, onPick }: { id: RoomId; picked: boolean; onPick: () => void }) {
  const r = room(id);
  const y = FLOOR_Y[r.floor];
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.opacity = picked ? 0.42 : 0.12 + Math.sin(clock.elapsedTime * 4) * 0.08;
  });
  const [x0, x1, z0, z1] = id === "yard" ? [5.2, 8.2, 3.4, 6.6] : r.box;
  return (
    <mesh
      rotation-x={-Math.PI / 2}
      position={[(x0 + x1) / 2, y + 0.03, (z0 + z1) / 2]}
      onClick={(e) => {
        e.stopPropagation();
        onPick();
      }}
    >
      <planeGeometry args={[x1 - x0 - 0.3, z1 - z0 - 0.3]} />
      <meshBasicMaterial ref={mat} color={picked ? "#22d3ee" : "#f2b544"} transparent opacity={0.2} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// 단서

function Bubble({ pos, text, color, at, fxStart }: { pos: P3; text: string; color: string; at: number; fxStart: number }) {
  const ref = useRef<THREE.Group>(null);
  const map = useMemo(() => labelTexture(text, color, { bg: "rgba(12,10,28,0.88)", fg: color }), [text, color]);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const e = fxClock(fxStart) - at;
    g.visible = e >= 0;
    const k = e < 0.2 ? 0.5 + e * 2.5 : 1;
    g.scale.setScalar(k);
    g.position.y = pos[1] + (e < 0.4 ? (0.4 - Math.max(0, e)) * -0.6 : 0);
  });
  return (
    <group ref={ref} position={pos} visible={false}>
      <ScreenSprite position={[0, 0, 0]} scale={[1.05, 0.26]} map={map} renderOrder={12} />
    </group>
  );
}

function Beam({ from, to, at, fxStart }: { from: P3; to: P3; at: number; fxStart: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const { mid, len, quat } = useMemo(() => {
    const a = v3(from);
    const b = v3(to);
    const dir = b.clone().sub(a);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().normalize());
    return { mid: a.clone().add(b).multiplyScalar(0.5), len: dir.length(), quat: q };
  }, [from, to]);
  useFrame(() => {
    const e = fxClock(fxStart) - at;
    if (!ref.current || !mat.current) return;
    ref.current.visible = e >= 0 && e < 2.2;
    mat.current.opacity = e < 0.2 ? e * 1.5 : e > 1.7 ? Math.max(0, (2.2 - e) * 0.6) : 0.3;
  });
  return (
    <mesh ref={ref} position={mid} quaternion={quat} visible={false}>
      <coneGeometry args={[1.3, len, 20, 1, true]} />
      <meshBasicMaterial ref={mat} color="#fff3b0" transparent opacity={0.3} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} toneMapped={false} />
    </mesh>
  );
}

/** 뒤지는 동안 가구가 들썩들썩 */
function Wiggle({ spec, fxStart, children }: { spec?: { at: number; until: number }; fxStart: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const e = fxClock(fxStart);
    const on = !!spec && e >= spec.at && e <= spec.until;
    const t = clock.elapsedTime;
    g.rotation.z = on ? Math.sin(t * 38) * 0.05 : 0;
    g.rotation.x = on ? Math.sin(t * 29 + 1) * 0.03 : 0;
    g.position.y = on ? Math.abs(Math.sin(t * 22)) * 0.07 : 0;
  });
  return <group ref={ref}>{children}</group>;
}

/** 뒤진 곳 바닥에서 퍼지는 고리 */
function Ping({ pos, color, at, big, fxStart }: { pos: P3; color: string; at: number; big: boolean; fxStart: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    const m = ref.current;
    if (!m || !mat.current) return;
    const e = fxClock(fxStart) - at;
    const dur = big ? 1.1 : 0.8;
    m.visible = e >= 0 && e < dur;
    const p = Math.max(0, e) / dur;
    m.scale.setScalar(0.3 + p * (big ? 2.6 : 1.6));
    mat.current.opacity = 0.9 * (1 - p);
  });
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} position={[pos[0], pos[1] + 0.06, pos[2]]} visible={false}>
      <ringGeometry args={[0.7, 0.95, 40]} />
      <meshBasicMaterial ref={mat} color={color} transparent depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** 배그식 상호작용 표시 — 가까운 대상 위에 떠서 살짝 오르내린다 */
function InteractLabel({ at, text }: { at: P3; text: string }) {
  const ref = useRef<THREE.Group>(null);
  const map = useMemo(() => labelTexture(text, "#22d3ee", { bg: "rgba(4,30,44,0.92)", fg: "#ecfeff" }), [text]);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.y = at[1] + 1.75 + Math.sin(clock.elapsedTime * 4) * 0.05;
  });
  return (
    <group ref={ref} position={[at[0], at[1] + 1.75, at[2]]}>
      <ScreenSprite position={[0, 0, 0]} scale={[0.82, 0.2]} map={map} renderOrder={14} />
    </group>
  );
}

function Mark({ pos }: { pos: P3 }) {
  const map = useMemo(() => labelTexture("✖ 확인함", "#94a3b8", { bg: "rgba(30,30,40,0.7)", fg: "#cbd5e1" }), []);
  return <ScreenSprite position={pos} scale={[0.7, 0.18]} map={map} />;
}

// ---------------------------------------------------------------------------
// 카메라

/** 이번 턴 직접 걷기: 매 프레임 입력을 읽어 `drive`를 움직이고, 가까운 대상이 바뀌면 알린다 */
function Walker({ spec, inputRef, driveRef, onNear }: { spec: WalkSpec | null; inputRef: RefObject<WalkInput>; driveRef: RefObject<Drive>; onNear: (n: WalkNear) => void }) {
  const st = useRef<{ key: string; pos: WalkPos; allowed: Set<RoomId>; near: string } | null>(null);
  useFrame((_, dtRaw) => {
    const d = driveRef.current;
    if (!spec) {
      d.active = false;
      st.current = null;
      return;
    }
    if (!st.current || st.current.key !== spec.key) st.current = { key: spec.key, pos: spec.start, allowed: new Set(spec.rooms), near: "" };
    const s = st.current;
    s.allowed = new Set(spec.rooms);
    // 느린 기기에서도 제 속도로 걷게 프레임당 최대 0.1초 (벽·문 판정은 칸 단위라 뚫고 지나가지 않는다)
    const dt = Math.min(dtRaw, 0.1);
    const inp = inputRef.current;
    let vx = inp.x;
    let vz = inp.z;
    const len = Math.hypot(vx, vz);
    if (len > 1) {
      vx /= len;
      vz /= len;
    }
    if (inp.hop) {
      inp.hop = false;
      s.pos = ladderHop(s.pos, s.allowed) ?? s.pos;
    }
    s.pos = stepWalk(s.pos, vx * WALK_SPEED * dt, vz * WALK_SPEED * dt, s.allowed);
    d.active = true;
    d.x = s.pos.x;
    d.y = s.pos.y;
    d.z = s.pos.z;
    d.moving = len > 0.08;
    if (d.moving) d.yaw = Math.atan2(vx, vz);
    const target = nearestTarget(s.pos, spec.targets);
    const fl = nearestFlash(s.pos, spec.flashes);
    const n: WalkNear = { target: target?.key ?? null, room: roomOf(s.pos), ladder: ladderHop(s.pos, s.allowed) !== null, flash: fl?.key ?? null };
    const tag = `${n.target}|${n.room}|${n.ladder}|${n.flash}`;
    if (tag !== s.near) {
      s.near = tag;
      onNear(n);
    }
  });
  return null;
}

function CameraRig({ focus, follow }: { focus: CameraFocus; follow?: RefObject<Drive> }) {
  const { camera, size } = useThree();
  const goal = useRef({ pos: new THREE.Vector3(), look: new THREE.Vector3() });
  const cur = useRef<{ look: THREE.Vector3 } | null>(null);
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    // 가로로 맞춰 거리를 잡는다 (fov 40°: tan 20° ≈ 0.364). 낮게 내려다봐야 2층 바닥 밑 1층 뒷방까지 보인다
    const fit = (halfW: number, min: number) => Math.max(min, halfW / (0.364 * aspect));
    if (focus.kind === "shot") {
      goal.current.pos.set(...focus.pos);
      goal.current.look.set(...focus.look);
    } else if (focus.kind === "all") {
      const d = fit(8.6, 15);
      goal.current.pos.set(-1, 2.6 + d * 0.2, 2 + d);
      goal.current.look.set(-1, 2.6, 0);
    } else {
      const c = roomCenter(focus.room);
      const d = fit(3.2, 5.5);
      goal.current.pos.set(c.x, c.y + 1.2 + d * 0.38, c.z + 1.6 + d);
      goal.current.look.set(c.x, c.y + 0.7, c.z - 0.4);
    }
  }, [focus, size]);
  useFrame((_, dt) => {
    const f = follow?.current;
    if (f?.active) {
      // 직접 걷는 중: 내 캐릭터 뒤 위에서 따라간다 (화면 위 = 집 안쪽)
      const aspect = size.width / Math.max(1, size.height);
      const back = aspect < 1 ? 7.4 : 5.8;
      // 카메라는 위층 바닥(천장) 밑에 머문다 — 위로 올라가면 천장에 가려 화면이 까매진다.
      // 마당·다락(위가 트임)에서만 더 높이 올라가 내려다본다
      const floorY = f.y < FLOOR_Y[1] - 0.5 ? FLOOR_Y[0] : f.y < FLOOR_Y[2] - 0.5 ? FLOOR_Y[1] : FLOOR_Y[2];
      const open = f.z > 3.5 || floorY === FLOOR_Y[2];
      const lift = open ? back * 0.6 : Math.min(back * 0.6, FLOOR_Y[1] - 0.45 - (f.y - floorY));
      goal.current.pos.set(f.x, f.y + lift, f.z + back);
      goal.current.look.set(f.x, f.y + 0.8, f.z - (open ? 0.8 : 1.6));
    }
    const k = 1 - Math.exp(-Math.min(dt, 0.05) * (f?.active ? 6 : 4));
    if (!cur.current) {
      camera.position.copy(goal.current.pos);
      cur.current = { look: goal.current.look.clone() };
    }
    camera.position.lerp(goal.current.pos, k);
    cur.current.look.lerp(goal.current.look, k);
    camera.lookAt(cur.current.look);
  });
  return null;
}

// ---------------------------------------------------------------------------

function Appear({ at, fxStart, children }: { at: number | null; fxStart: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (ref.current) ref.current.visible = at === null || fxClock(fxStart) >= at;
  });
  return <group ref={ref}>{children}</group>;
}

function SceneContents(props: HouseScene3DProps) {
  const { figures, clues, fxStart, lowDetail, names } = props;
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
  const pickSpots = new Set(props.pickSpots);
  return (
    <>
      <color attach="background" args={["#0b1026"]} />
      <fog attach="fog" args={["#0b1026", 26, 60]} />
      <hemisphereLight args={["#aab8ff", "#2a1d14", 0.95]} />
      <ambientLight intensity={0.35} color="#ffe2b8" />
      <directionalLight position={[8, 14, 12]} intensity={0.9} color="#c8d4ff" />
      <directionalLight position={[-6, 6, 10]} intensity={0.55} color="#ffc98a" />
      <House />
      <RoomLabels />
      {SPOTS.map((sp) => {
        const y = FLOOR_Y[room(sp.room).floor];
        return (
          <group key={sp.id} position={[sp.x, y, sp.z]} rotation-y={sp.rot ?? 0}>
            <Wiggle spec={props.rummage?.find((r) => r.spot === sp.id)} fxStart={fxStart}>
              <Prop kind={sp.prop} />
            </Wiggle>
          </group>
        );
      })}
      {props.pickRooms.map((r) => (
        <RoomPick key={r} id={r} picked={props.picked?.room === r} onPick={() => props.onPickRoom(r)} />
      ))}
      {SPOTS.filter((sp) => pickSpots.has(sp.id)).map((sp) => (
        <PickRing key={sp.id} position={[sp.x, FLOOR_Y[room(sp.room).floor], sp.z]} picked={props.picked?.spot === sp.id} onPick={() => props.onPickSpot(sp.id)} />
      ))}
      {figures.map((f) => {
        const color = SEAT_COLORS[f.seat % SEAT_COLORS.length];
        return (
          <Appear key={f.seat} at={f.appearAt} fxStart={fxStart}>
            <HouseFigure
              look={looks[f.seat] ?? resolveLook(f.seat, ["none"])}
              seed={f.seat * 5 + 3}
              color={color}
              path={f.path.map(v3)}
              pathKey={f.pathKey}
              delay={f.delay}
              faceTo={f.faceTo ? v3(f.faceTo) : null}
              pose={f.pose}
              lowDetail={lowDetail}
              size={0.9}
              drive={f.mine ? props.walk?.drive : undefined}
            >
              {f.tag && <ScreenSprite position={[0, 1.75, 0]} anchorY={1.5} scale={[0.85, 0.21]} map={labelTexture(f.tag, color, f.mine ? { bg: "rgba(8,40,60,0.9)", fg: "#e0f2fe" } : {})} />}
            </HouseFigure>
          </Appear>
        );
      })}
      {clues.map((c) => {
        switch (c.kind) {
          case "bubble":
            return <Bubble key={c.key} pos={c.pos} text={c.text} color={c.color} at={c.at} fxStart={fxStart} />;
          case "beam":
            return <Beam key={c.key} from={c.from} to={c.to} at={c.at} fxStart={fxStart} />;
          case "mark":
            return <Mark key={c.key} pos={c.pos} />;
          case "ping":
            return <Ping key={c.key} pos={c.pos} color={c.color} at={c.at} big={c.big} fxStart={fxStart} />;
        }
      })}
      {props.nearLabel && <InteractLabel key={props.nearLabel.text} at={props.nearLabel.at} text={props.nearLabel.text} />}
      {props.walk?.spec?.targets.map((t) => (
        <TargetGlow key={t.key} at={t.at} near={!!props.nearTarget && props.nearTarget[0] === t.at[0] && props.nearTarget[2] === t.at[2] && props.nearTarget[1] === t.at[1]} />
      ))}
      {props.walk && <Walker spec={props.walk.spec} inputRef={props.walk.input} driveRef={props.walk.drive} onNear={props.walk.onNear} />}
      <CameraRig focus={props.focus} follow={props.walk?.drive} />
      <AdaptiveResolution max={lowDetail ? 1.5 : 2} />
    </>
  );
}

export default function HouseScene3D(props: HouseScene3DProps) {
  return (
    <Canvas dpr={props.lowDetail ? [1, 1.5] : [1, 2]} gl={{ antialias: !props.lowDetail, powerPreference: "high-performance" }} camera={{ fov: 40, position: [-2, 10, 22], near: 0.1, far: 120 }} style={{ touchAction: "pan-y" }}>
      <SceneContents {...props} />
    </Canvas>
  );
}
