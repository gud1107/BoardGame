"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { BOARD_SIZE, HOME_ZONES, OASIS, isOasisZoneCell, type LegalMove, type Position, type Seat } from "../engine";
import type { MoveAnim } from "../MoveEffects";
import { clamp01, easeInOut } from "@/games/shared/three/tableKit";

/**
 * 말달리자 입체 보드 — 데스게임 경기장 한가운데 놓인 11×11 돌판 위에 나이트
 * 체스말 모양 말 20개. 가운데 오아시스는 물웅덩이, 둘레 12칸은 풀밭.
 *
 * 규칙·선택 상태는 전부 보드(`MalDalliJaBoard`)가 갖고, 이 장면은 그대로
 * 그리기만 한다: 칸/말을 누르면 `onCellClick(row, col)`(2D와 같은 함수),
 * 이동 애니메이션은 보드의 `animations`(MoveAnim) 그대로 — 슬라이드는 칸마다
 * 깡충, 나이트는 큰 포물선 — 끝나면 `onAnimDone`, 발굽마다 `onHop`(소리).
 * 보드 방향은 2D와 같다(1행이 멀리, 11행이 가까이).
 */

export interface MalDalliJaBoard3DProps {
  positions: Record<Seat, Position[]>;
  viewerSeat: Seat;
  activeSeat: Seat | null;
  selected: number | null;
  /** 선택한 내 말의 이동 가능 칸. */
  legal: LegalMove[];
  /** 내 차례에 움직일 수 있는 내 말 번호. */
  movable: ReadonlySet<number>;
  animations: MoveAnim[];
  lastMove: { seat: Seat; to: Position } | null;
  onCellClick: (row: number, col: number) => void;
  onAnimDone: (id: number) => void;
  onHop: (kind: "hop" | "land") => void;
  lowDetail: boolean;
}

const HALF = (BOARD_SIZE - 1) / 2;
const TILE_TOP = 0.3;
const cellX = (col: number) => col - HALF;
const cellZ = (row: number) => row - HALF;

const THEME: Record<Seat, { body: string; accent: string; rough: number; metal: number }> = {
  p1: { body: "#1c1917", accent: "#fb7185", rough: 0.25, metal: 0.35 },
  p2: { body: "#f3ead7", accent: "#22d3ee", rough: 0.35, metal: 0.05 },
};

// ---------------------------------------------------------------------------
// Knight piece geometry (extruded horse-head profile on a turned base)
// ---------------------------------------------------------------------------

function knightHeadGeometry(): THREE.BufferGeometry {
  const pts: [number, number][] = [
    [-0.22, 0],
    [0.2, 0],
    [0.18, 0.1],
    [0.24, 0.26],
    [0.36, 0.38],
    [0.43, 0.46],
    [0.41, 0.53],
    [0.3, 0.6],
    [0.2, 0.7],
    [0.15, 0.82],
    [0.09, 0.72],
    [-0.04, 0.68],
    [-0.15, 0.56],
    [-0.21, 0.36],
    [-0.24, 0.16],
  ];
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) shape.lineTo(x, y);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.04, bevelSegments: 3, curveSegments: 4 });
  g.translate(0, 0, -0.1);
  g.computeVertexNormals();
  return g;
}

const BASE_PROFILE = [
  [0, 0],
  [0.34, 0],
  [0.36, 0.05],
  [0.33, 0.1],
  [0.25, 0.14],
  [0.24, 0.2],
  [0.27, 0.23],
  [0.22, 0.26],
  [0, 0.26],
].map(([x, y]) => new THREE.Vector2(x, y));

function useKnightGeometries(lowDetail: boolean) {
  return useMemo(() => ({ head: knightHeadGeometry(), base: new THREE.LatheGeometry(BASE_PROFILE, lowDetail ? 14 : 28) }), [lowDetail]);
}

/** Where a horse is drawn right now (world) + which way it faces, given an optional running animation. */
function animPose(anim: MoveAnim, now: number): { x: number; z: number; y: number; dirX: number; dirZ: number; done: boolean; hop: number } {
  const t = clamp01((now - anim.createdAt) / anim.totalMs);
  const p = anim.path;
  const from = p[0];
  const to = p[p.length - 1];
  const dirX = cellX(to.col) - cellX(from.col);
  const dirZ = cellZ(to.row) - cellZ(from.row);
  if (anim.moveKind === "knight") {
    const e = easeInOut(t);
    return {
      x: cellX(from.col) + dirX * e,
      z: cellZ(from.row) + dirZ * e,
      y: Math.sin(t * Math.PI) * 1.5,
      dirX,
      dirZ,
      done: t >= 1,
      hop: t >= 1 ? 1 : 0,
    };
  }
  const steps = p.length - 1;
  const seg = Math.min(steps - 1, Math.floor(t * steps));
  const u = t * steps - seg;
  const a = p[seg];
  const b = p[seg + 1];
  const e = easeInOut(u);
  return {
    x: cellX(a.col) + (cellX(b.col) - cellX(a.col)) * e,
    z: cellZ(a.row) + (cellZ(b.row) - cellZ(a.row)) * e,
    y: Math.sin(Math.min(1, u) * Math.PI) * 0.42,
    dirX,
    dirZ,
    done: t >= 1,
    hop: t >= 1 ? steps : seg,
  };
}

function Horse({
  seat,
  pos,
  anim,
  selected,
  movable,
  geos,
  onClick,
  onAnimDone,
  onHop,
  lowDetail,
}: {
  seat: Seat;
  pos: Position;
  anim: MoveAnim | null;
  selected: boolean;
  movable: boolean;
  geos: ReturnType<typeof useKnightGeometries>;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
  onAnimDone: (id: number) => void;
  onHop: (kind: "hop" | "land") => void;
  lowDetail: boolean;
}) {
  const ref = useRef<THREE.Group>(null);
  const ring = useRef<THREE.MeshBasicMaterial>(null);
  const yawRef = useRef<number | null>(null);
  const animState = useRef<{ id: number; hops: number; done: boolean } | null>(null);
  const th = THEME[seat];
  useFrame(({ clock }, dt) => {
    const g = ref.current;
    if (!g) return;
    let x = cellX(pos.col);
    let z = cellZ(pos.row);
    let y = 0;
    let dirX = cellX(OASIS.col) - x;
    let dirZ = cellZ(OASIS.row) - z;
    if (anim) {
      if (!animState.current || animState.current.id !== anim.id) animState.current = { id: anim.id, hops: 0, done: false };
      const a = animPose(anim, performance.now());
      x = a.x;
      z = a.z;
      y = a.y;
      dirX = a.dirX;
      dirZ = a.dirZ;
      const st = animState.current;
      while (st.hops < a.hop) {
        st.hops++;
        onHop(a.done && st.hops >= a.hop ? "land" : "hop");
      }
      if (a.done && !st.done) {
        st.done = true;
        onAnimDone(anim.id);
      }
    }
    const lift = selected ? 0.28 + Math.sin(clock.elapsedTime * 4) * 0.05 : 0;
    g.position.set(x, TILE_TOP + y + lift, z);
    const yaw = Math.abs(dirX) + Math.abs(dirZ) > 0.01 ? Math.atan2(-dirZ, dirX) : (yawRef.current ?? 0);
    if (yawRef.current === null) yawRef.current = yaw;
    let d = yaw - yawRef.current;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    yawRef.current += d * (1 - Math.exp(-dt * (anim ? 14 : 5)));
    g.rotation.y = yawRef.current;
    if (ring.current) ring.current.opacity = selected ? 0.95 : movable ? 0.45 + Math.sin(clock.elapsedTime * 3.5) * 0.25 : 0;
  });
  return (
    <group ref={ref} onClick={onClick} scale={0.82}>
      <mesh geometry={geos.base} castShadow={!lowDetail} receiveShadow>
        <meshStandardMaterial color={th.body} roughness={th.rough} metalness={th.metal} />
      </mesh>
      <mesh geometry={geos.head} position={[0, 0.22, 0]} castShadow={!lowDetail}>
        <meshStandardMaterial color={th.body} roughness={th.rough} metalness={th.metal} />
      </mesh>
      {/* eye + accent collar so the two sides read apart at a glance */}
      {[1, -1].map((s) => (
        <mesh key={s} position={[0.3, 0.75, 0.165 * s]}>
          <sphereGeometry args={[0.025, 8, 6]} />
          <meshBasicMaterial color={seat === "p1" ? "#fecdd3" : "#0f172a"} />
        </mesh>
      ))}
      <mesh position={[0, 0.235, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.235, 0.025, 8, 24]} />
        <meshStandardMaterial color={th.accent} emissive={th.accent} emissiveIntensity={0.6} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.42, 0.52, 32]} />
        <meshBasicMaterial ref={ring} color={selected ? "#fde047" : th.accent} transparent opacity={0} depthWrite={false} />
      </mesh>
      {/* generous invisible hit box */}
      <mesh position={[0, 0.5, 0]} visible={false}>
        <boxGeometry args={[0.95, 1.1, 0.95]} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

function Tiles({ onCellClick, lowDetail }: { onCellClick: (e: ThreeEvent<MouseEvent>, row: number, col: number) => void; lowDetail: boolean }) {
  const home = useMemo(() => {
    const m = new Map<string, Seat>();
    (["p1", "p2"] as const).forEach((seat) => HOME_ZONES[seat].flat().forEach((p) => m.set(`${p.row},${p.col}`, seat)));
    return m;
  }, []);
  const tiles = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const center = row === OASIS.row && col === OASIS.col;
      const ring = !center && isOasisZoneCell({ row, col });
      const h = home.get(`${row},${col}`);
      const dark = (row + col) % 2 === 1;
      const color = ring ? (dark ? "#2f6b3a" : "#3d8a49") : h === "p1" ? (dark ? "#5b1f2b" : "#73303d") : h === "p2" ? (dark ? "#1d4c5a" : "#2a6273") : dark ? "#4a3b2c" : "#8a7356";
      tiles.push(
        <mesh key={`${row}-${col}`} position={[cellX(col), TILE_TOP / 2, cellZ(row)]} receiveShadow onClick={(e) => onCellClick(e, row, col)}>
          <boxGeometry args={[0.96, TILE_TOP, 0.96]} />
          <meshStandardMaterial color={center ? "#1e3a5f" : color} roughness={0.85} />
        </mesh>,
      );
      if (ring && !lowDetail && (row + col) % 2 === 0) {
        tiles.push(
          <group key={`g${row}-${col}`} position={[cellX(col), TILE_TOP, cellZ(row)]}>
            {[0, 1, 2].map((i) => (
              <mesh key={i} position={[Math.cos(i * 2.1) * 0.3, 0.05, Math.sin(i * 2.1) * 0.3]}>
                <coneGeometry args={[0.04, 0.12, 4]} />
                <meshStandardMaterial color="#65a30d" roughness={1} />
              </mesh>
            ))}
          </group>,
        );
      }
    }
  }
  return <group>{tiles}</group>;
}

function Oasis() {
  const water = useRef<THREE.MeshStandardMaterial>(null);
  const ripple = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (water.current) water.current.emissiveIntensity = 0.55 + Math.sin(t * 2.2) * 0.2;
    if (ripple.current) {
      const u = (t * 0.6) % 1;
      ripple.current.scale.setScalar(0.3 + u * 1.2);
      (ripple.current.material as THREE.MeshBasicMaterial).opacity = (1 - u) * 0.6;
    }
  });
  return (
    <group position={[cellX(OASIS.col), TILE_TOP + 0.01, cellZ(OASIS.row)]}>
      <mesh rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.42, 32]} />
        <meshStandardMaterial ref={water} color="#38bdf8" emissive="#0ea5e9" emissiveIntensity={0.6} roughness={0.1} metalness={0.2} />
      </mesh>
      <mesh ref={ripple} position={[0, 0.005, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.3, 0.34, 32]} />
        <meshBasicMaterial color="#e0f2fe" transparent opacity={0.5} depthWrite={false} />
      </mesh>
      {/* palm trees on the four diagonal neighbours */}
      {[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([dx, dz], i) => (
        <group key={i} position={[dx * 0.95, 0, dz * 0.95]} scale={0.55}>
          <mesh position={[0, 0.7, 0]} rotation-z={dx * 0.12}>
            <cylinderGeometry args={[0.06, 0.09, 1.4, 6]} />
            <meshStandardMaterial color="#7c5a33" roughness={0.9} />
          </mesh>
          {[0, 1, 2, 3, 4].map((k) => (
            <mesh key={k} position={[Math.cos(k * 1.26) * 0.3 + dx * 0.08, 1.38, Math.sin(k * 1.26) * 0.3]} rotation={[Math.sin(k * 1.26) * 0.7, 0, -Math.cos(k * 1.26) * 0.7]}>
              <coneGeometry args={[0.12, 0.7, 4]} />
              <meshStandardMaterial color="#15803d" roughness={0.8} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function TargetMarker({ move, onClick }: { move: LegalMove; onClick: (e: ThreeEvent<MouseEvent>) => void }) {
  const ref = useRef<THREE.Mesh>(null);
  const color = move.moveKind === "slide" ? "#22d3ee" : "#e879f9";
  useFrame(({ clock }) => {
    if (ref.current) ref.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 5 + move.to.row) * 0.1);
  });
  return (
    <group position={[cellX(move.to.col), TILE_TOP + 0.02, cellZ(move.to.row)]} onClick={onClick}>
      <mesh ref={ref} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.2, 0.34, 28]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} depthWrite={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.005, 0]}>
        <circleGeometry args={[0.2, 20]} />
        <meshBasicMaterial color={color} transparent opacity={0.3} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.3, 0]} visible={false}>
        <boxGeometry args={[0.95, 0.6, 0.95]} />
      </mesh>
    </group>
  );
}

function Arena({ lowDetail }: { lowDetail: boolean }) {
  const seg = lowDetail ? 24 : 48;
  return (
    <group>
      <mesh position={[0, -0.02, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[30, seg]} />
        <meshStandardMaterial color="#1a0d0f" roughness={1} />
      </mesh>
      {/* board plinth */}
      <mesh position={[0, -0.15, 0]} castShadow receiveShadow>
        <boxGeometry args={[BOARD_SIZE + 0.9, 0.35, BOARD_SIZE + 0.9]} />
        <meshStandardMaterial color="#2a1a14" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <boxGeometry args={[BOARD_SIZE + 0.5, 0.1, BOARD_SIZE + 0.5]} />
        <meshStandardMaterial color="#a16207" metalness={0.6} roughness={0.35} />
      </mesh>
      {/* stands */}
      <mesh position={[0, 1.4, 0]}>
        <cylinderGeometry args={[16, 18, 2.8, seg, 1, true]} />
        <meshStandardMaterial color="#2b1416" roughness={1} side={THREE.BackSide} />
      </mesh>
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return (
          <group key={i} position={[Math.sin(a) * 15, 0, Math.cos(a) * 15]}>
            <mesh position={[0, 2.2, 0]}>
              <cylinderGeometry args={[0.25, 0.3, 4.4, 8]} />
              <meshStandardMaterial color="#3f1d20" roughness={0.8} />
            </mesh>
            <mesh position={[0, 4.6, 0]}>
              <sphereGeometry args={[0.28, 10, 8]} />
              <meshBasicMaterial color="#fb923c" />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** Orbit-ish camera: drag to swing around the board, starts from my side. */
function CameraRig() {
  const gl = useThree((s) => s.gl);
  const yaw = useRef(0);
  const yawTarget = useRef(0);
  const pitch = useRef(0.95);
  const pitchTarget = useRef(0.95);
  useEffect(() => {
    const el = gl.domElement;
    let drag: { x: number; y: number; yaw: number; pitch: number } | null = null;
    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY, yaw: yawTarget.current, pitch: pitchTarget.current };
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      yawTarget.current = drag.yaw - ((e.clientX - drag.x) / (el.clientWidth || 1)) * 3.2;
      pitchTarget.current = Math.max(0.55, Math.min(1.45, drag.pitch + ((e.clientY - drag.y) / (el.clientHeight || 1)) * 1.6));
    };
    const up = () => {
      drag = null;
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    for (const ev of ["pointerup", "pointerleave", "pointercancel"] as const) el.addEventListener(ev, up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      for (const ev of ["pointerup", "pointerleave", "pointercancel"] as const) el.removeEventListener(ev, up);
    };
  }, [gl]);
  useFrame((frame) => {
    const cam = frame.camera as THREE.PerspectiveCamera;
    const aspect = frame.size.width / frame.size.height;
    yaw.current += (yawTarget.current - yaw.current) * 0.12;
    pitch.current += (pitchTarget.current - pitch.current) * 0.12;
    // keep the whole 11-wide board in frame whatever the aspect
    const fov = 42;
    const need = (BOARD_SIZE + 1.5) / 2 / Math.tan(((fov / 2) * Math.PI) / 180);
    const dist = need / Math.min(1, aspect) * 1.02;
    cam.position.set(Math.sin(yaw.current) * Math.cos(pitch.current) * dist, Math.sin(pitch.current) * dist, Math.cos(yaw.current) * Math.cos(pitch.current) * dist);
    cam.lookAt(0, 0, 0.3);
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  });
  return null;
}

function LastMoveMarker({ to, seat }: { to: Position; seat: Seat }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.opacity = 0.35 + Math.sin(clock.elapsedTime * 2.5) * 0.15;
  });
  return (
    <mesh position={[cellX(to.col), TILE_TOP + 0.008, cellZ(to.row)]} rotation-x={-Math.PI / 2}>
      <planeGeometry args={[0.94, 0.94]} />
      <meshBasicMaterial ref={mat} color={THEME[seat].accent} transparent opacity={0.4} depthWrite={false} />
    </mesh>
  );
}

function SceneContents(props: MalDalliJaBoard3DProps) {
  const { positions, lowDetail } = props;
  const geos = useKnightGeometries(lowDetail);
  const click = (e: ThreeEvent<MouseEvent>, row: number, col: number) => {
    e.stopPropagation();
    if (e.delta > 8) return; // that was a camera drag, not a tap
    props.onCellClick(row, col);
  };
  const animByHorse = new Map(props.animations.map((a) => [`${a.seat}-${a.horseIndex}`, a]));
  return (
    <>
      <color attach="background" args={["#0d0607"]} />
      <fog attach="fog" args={["#0d0607", 16, 34]} />
      <ambientLight intensity={0.35} color="#ffe4e6" />
      <hemisphereLight args={["#fde68a", "#2a0f12", 0.45]} />
      <directionalLight
        position={[6, 14, 8]}
        intensity={1.5}
        color="#fff1d6"
        castShadow={!lowDetail}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
      />
      <pointLight position={[0, 6, 0]} color="#7dd3fc" intensity={8} distance={10} />
      <Arena lowDetail={lowDetail} />
      <Tiles onCellClick={click} lowDetail={lowDetail} />
      <Oasis />
      {props.lastMove && <LastMoveMarker to={props.lastMove.to} seat={props.lastMove.seat} />}
      {props.legal.map((m) => (
        <TargetMarker key={`${m.to.row}-${m.to.col}`} move={m} onClick={(e) => click(e, m.to.row, m.to.col)} />
      ))}
      {(["p1", "p2"] as const).flatMap((seat) =>
        positions[seat].map((p, i) => {
          const mine = seat === props.viewerSeat;
          return (
            <Horse
              key={`${seat}-${i}`}
              seat={seat}
              pos={p}
              anim={animByHorse.get(`${seat}-${i}`) ?? null}
              selected={mine && props.selected === i}
              movable={mine && props.selected === null && props.movable.has(i)}
              geos={geos}
              onClick={(e) => click(e, p.row, p.col)}
              onAnimDone={props.onAnimDone}
              onHop={props.onHop}
              lowDetail={lowDetail}
            />
          );
        }),
      )}
      <CameraRig />
    </>
  );
}

export default function MalDalliJaBoard3D(props: MalDalliJaBoard3DProps) {
  const high = !props.lowDetail;
  return (
    <Canvas
      shadows={high}
      dpr={high ? [1, 1.75] : [1, 1.25]}
      gl={{ antialias: high, powerPreference: "high-performance" }}
      camera={{ fov: 42, position: [0, 14, 10], near: 0.1, far: 120 }}
      style={{ touchAction: "none" }}
    >
      <SceneContents {...props} />
    </Canvas>
  );
}
