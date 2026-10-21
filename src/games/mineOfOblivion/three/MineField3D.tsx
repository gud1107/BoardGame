"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { paintedTexture, emojiTexture, FONTS } from "@/games/shared/three/tableKit";
import { ImpactRing } from "@/games/shared/three/tablePieces";

/**
 * 망각의 광산(1·2) 공용 3D 지뢰밭 — 11×11 동굴 바닥. 안 밟은 칸은 울퉁불퉁한
 * 돌 블록, 밟은 칸은 파여 들어가 주변 지뢰 수가 새겨지고, 보물 칸엔 보석이
 * 떠서 돈다. 내 지뢰·시한폭탄(남은 틱)·폭발 흔적·안전구역·이동 가능 칸을
 * 표시하고, 두 사람의 체스 말이 칸 사이를 뛰어다닌다. 카메라는 내 시작
 * 모서리 쪽에서 비스듬히 내려다보고, 드래그로 조금 돌려 볼 수 있다.
 *
 * 각 칸의 표시 정보는 보드가 2D 칸과 같은 규칙으로 계산해 넘긴다 — 상대의
 * 숨은 지뢰/폭탄은 여기 들어오지 않는다.
 */

export interface MineCell3D {
  id: string;
  kind: "rock" | "dug" | "treasure" | "treasureTaken";
  count?: number;
  treasurePoints?: number | null;
  safe: boolean;
  forbidden: boolean;
  reachable: boolean;
  selected: "mine" | "bomb" | null;
  myMine: boolean;
  myBomb: number | null;
  danger: boolean;
  crater: boolean;
  scorched: boolean;
  clickable: boolean;
}

export interface MineField3DProps {
  cells: MineCell3D[];
  /** Row-major index of each pawn. */
  pawns: { p1: number; p2: number };
  viewerIsP1: boolean;
  activeSeat: "p1" | "p2" | null;
  onTap: (id: string) => void;
  /** Latest event (blast / treasure / dig) for a one-shot effect. */
  event: { kind: "mine" | "treasure" | "reveal" | "bomb"; index: number; key: string; gained?: number } | null;
  lowDetail: boolean;
}

const N = 11;
const S = 1;
// column A sits at +x so that, seen from P1's corner (−z), A reads on the left like the 2D grid
const pos = (i: number) => new THREE.Vector3((N - 1) / 2 - (i % N) * S, 0, Math.floor(i / N) * S - (N - 1) / 2);
const COUNT_COLOR = ["#64748b", "#22d3ee", "#34d399", "#fbbf24", "#fb7185", "#f43f5e", "#e11d48", "#be123c", "#9f1239"];

function countTex(n: number) {
  return paintedTexture(`mine:count:${n}`, 128, 128, (ctx, W) => {
    ctx.fillStyle = COUNT_COLOR[Math.min(8, n)];
    ctx.font = `900 92px ${FONTS.text}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 8;
    ctx.fillText(String(n), W / 2, W / 2 + 6);
  });
}

const rockGeo = new THREE.BoxGeometry(0.94, 0.34, 0.94);
const dugGeo = new THREE.BoxGeometry(0.94, 0.08, 0.94);
const topGeo = new THREE.PlaneGeometry(0.86, 0.86);
const gemGeo = new THREE.OctahedronGeometry(0.24, 0);

function Gem({ taken }: { taken: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.rotation.y = clock.elapsedTime * 1.2;
    ref.current.position.y = 0.75 + Math.sin(clock.elapsedTime * 2) * 0.06;
  });
  if (taken) return null;
  return (
    <mesh ref={ref} geometry={gemGeo} position={[0, 0.75, 0]} castShadow>
      <meshPhysicalMaterial color="#67e8f9" emissive="#0891b2" emissiveIntensity={0.8} roughness={0.05} clearcoat={1} flatShading />
    </mesh>
  );
}

function Pulse({ color, y = 0.36 }: { color: string; y?: number }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.opacity = 0.35 + Math.sin(clock.elapsedTime * 5) * 0.2;
  });
  return (
    <mesh geometry={topGeo} rotation-x={-Math.PI / 2} position={[0, y, 0]}>
      <meshBasicMaterial ref={mat} color={color} transparent opacity={0.4} depthWrite={false} />
    </mesh>
  );
}

function Icon({ icon, y = 0.55, size = 0.36 }: { icon: string; y?: number; size?: number }) {
  return (
    <sprite position={[0, y, 0]} scale={[size, size, 1]}>
      <spriteMaterial map={emojiTexture(icon)} transparent depthWrite={false} />
    </sprite>
  );
}

function Cell({ c, i, onTap, flip }: { c: MineCell3D; i: number; onTap: (id: string) => void; flip: boolean }) {
  const p = pos(i);
  const rock = c.kind === "rock" || c.kind === "treasure" || c.kind === "treasureTaken";
  const h = rock ? 0.34 : 0.08;
  const shade = 0.82 + ((i * 37) % 11) / 60;
  const color = c.forbidden ? "#1f1a17" : c.safe ? "#2f5d45" : rock ? new THREE.Color("#5b4a3c").multiplyScalar(shade) : "#a88a5c";
  return (
    <group
      position={p}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        if (e.delta > 8 || !c.clickable) return;
        onTap(c.id);
      }}
      onPointerOver={() => {
        if (c.clickable) document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "";
      }}
    >
      <mesh geometry={rock ? rockGeo : dugGeo} position={[0, h / 2, 0]} castShadow={rock} receiveShadow>
        <meshStandardMaterial color={color} roughness={0.95} flatShading />
      </mesh>
      {c.kind === "dug" && c.count !== undefined && (
        <mesh geometry={topGeo} rotation={[-Math.PI / 2, 0, flip ? Math.PI : 0]} position={[0, h + 0.005, 0]}>
          <meshBasicMaterial map={countTex(c.count)} transparent depthWrite={false} />
        </mesh>
      )}
      {(c.kind === "treasure" || c.kind === "treasureTaken") && <Gem taken={c.kind === "treasureTaken"} />}
      {c.kind === "treasureTaken" && c.treasurePoints != null && <Icon icon="✨" y={0.5} size={0.3} />}
      {c.reachable && <Pulse color="#34d399" y={h + 0.01} />}
      {c.danger && <Pulse color="#f97316" y={h + 0.012} />}
      {c.selected && <Pulse color={c.selected === "mine" ? "#f43f5e" : "#f97316"} y={h + 0.014} />}
      {c.safe && <Icon icon="🛡️" y={h + 0.22} size={0.3} />}
      {c.myMine && <Icon icon="💣" y={h + 0.2} size={0.28} />}
      {c.myBomb !== null && <Icon icon={c.myBomb <= 1 ? "🧨" : "⏳"} y={h + 0.25} size={0.32} />}
      {c.crater && (
        <mesh rotation-x={-Math.PI / 2} position={[0, h + 0.008, 0]}>
          <ringGeometry args={[0.18, 0.34, 20]} />
          <meshBasicMaterial color="#111" transparent opacity={0.7} />
        </mesh>
      )}
      {c.scorched && (
        <mesh geometry={topGeo} rotation-x={-Math.PI / 2} position={[0, h + 0.006, 0]}>
          <meshBasicMaterial color="#3f0d0d" transparent opacity={0.55} />
        </mesh>
      )}
    </group>
  );
}

const pawnProfile = [
  [0, 0],
  [0.3, 0],
  [0.3, 0.06],
  [0.2, 0.12],
  [0.12, 0.4],
  [0.16, 0.46],
  [0.08, 0.5],
  [0.15, 0.62],
  [0.0, 0.72],
].map(([x, y]) => new THREE.Vector2(x, y));

function Pawn({ index, color, active }: { index: number; color: string; active: boolean }) {
  const geo = useMemo(() => new THREE.LatheGeometry(pawnProfile, 24), []);
  const ref = useRef<THREE.Group>(null);
  const from = useRef(pos(index));
  const to = useRef(pos(index));
  const t = useRef(1);
  useEffect(() => {
    if (!ref.current) return;
    from.current = ref.current.position.clone();
    to.current = pos(index);
    t.current = 0;
  }, [index]);
  useFrame(({ clock }, dt) => {
    const g = ref.current;
    if (!g) return;
    t.current = Math.min(1, t.current + dt * 2.6);
    const e = t.current;
    g.position.lerpVectors(from.current, to.current, e);
    g.position.y = 0.08 + Math.sin(Math.PI * e) * 0.6 + (active ? Math.abs(Math.sin(clock.elapsedTime * 3)) * 0.05 : 0);
  });
  return (
    <group ref={ref} position={pos(index)}>
      <mesh geometry={geo} castShadow>
        <meshStandardMaterial color={color} metalness={0.3} roughness={0.35} emissive={color} emissiveIntensity={active ? 0.35 : 0.1} />
      </mesh>
      {active && (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 0]}>
          <ringGeometry args={[0.36, 0.44, 32]} />
          <meshBasicMaterial color="#fde68a" />
        </mesh>
      )}
    </group>
  );
}

/** Camera behind my start corner; horizontal drag swings it a little. */
function Cam({ viewerIsP1 }: { viewerIsP1: boolean }) {
  const gl = useThree((s) => s.gl);
  const yaw = useRef(0);
  const target = useRef(0);
  useEffect(() => {
    const el = gl.domElement;
    let drag: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => (drag = { x: e.clientX, y: target.current });
    const move = (e: PointerEvent) => {
      if (drag) target.current = Math.max(-0.7, Math.min(0.7, drag.y - ((e.clientX - drag.x) / (el.clientWidth || 1)) * 2));
    };
    const up = () => (drag = null);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    for (const ev of ["pointerup", "pointerleave", "pointercancel"] as const) el.addEventListener(ev, up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      for (const ev of ["pointerup", "pointerleave", "pointercancel"] as const) el.removeEventListener(ev, up);
    };
  }, [gl]);
  useFrame(({ camera, size }) => {
    yaw.current += (target.current - yaw.current) * 0.1;
    // p1 starts at A1 (row 0, -z side) → stand on -z looking +z; p2 the other way
    const base = viewerIsP1 ? Math.PI : 0;
    const a = base + yaw.current;
    const portrait = size.width < size.height;
    const dist = portrait ? 11 : 9.4;
    const height = portrait ? 16 : 13.2;
    camera.position.set(Math.sin(a) * dist, height, Math.cos(a) * dist);
    // aim a little toward my side so my near rows aren't clipped
    camera.lookAt(Math.sin(a) * 1.2, 0, Math.cos(a) * 1.2);
  });
  return null;
}

function Scene(props: MineField3DProps) {
  return (
    <>
      <color attach="background" args={["#0c0a09"]} />
      <fog attach="fog" args={["#0c0a09", 16, 34]} />
      <ambientLight intensity={0.35} color="#fde7c7" />
      <hemisphereLight args={["#fde68a", "#1c1917", 0.45]} />
      <directionalLight position={[6, 12, 5]} intensity={1.1} color="#ffe6c2" castShadow={!props.lowDetail} shadow-mapSize-width={1024} shadow-mapSize-height={1024} shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8} />
      <pointLight position={[0, 4, 0]} intensity={8} color="#fbbf24" distance={14} />
      <mesh position={[0, -0.06, 0]} receiveShadow>
        <boxGeometry args={[N + 1.2, 0.1, N + 1.2]} />
        <meshStandardMaterial color="#292018" roughness={1} />
      </mesh>
      {props.cells.map((c, i) => (
        <Cell key={c.id} c={c} i={i} onTap={props.onTap} flip={props.viewerIsP1} />
      ))}
      <Pawn index={props.pawns.p1} color="#38bdf8" active={props.activeSeat === "p1"} />
      <Pawn index={props.pawns.p2} color="#f43f5e" active={props.activeSeat === "p2"} />
      {props.event && (
        <group key={props.event.key} position={pos(props.event.index).setY(0.36)}>
          <ImpactRing color={props.event.kind === "mine" || props.event.kind === "bomb" ? "#ef4444" : props.event.kind === "treasure" ? "#67e8f9" : "#fde68a"} size={props.event.kind === "reveal" ? 0.8 : 2.6} dur={0.9} />
          {(props.event.kind === "mine" || props.event.kind === "bomb") && <pointLight position={[0, 1, 0]} color="#ff4d2d" intensity={14} distance={5} />}
        </group>
      )}
      <Cam viewerIsP1={props.viewerIsP1} />
    </>
  );
}

export default function MineField3D(props: MineField3DProps) {
  const high = !props.lowDetail;
  return (
    <Canvas shadows={high} dpr={high ? [1, 1.75] : [1, 1.25]} gl={{ antialias: high, powerPreference: "high-performance" }} camera={{ fov: 42, position: [0, 10, 10], near: 0.1, far: 80 }} style={{ touchAction: "pan-y" }}>
      <Scene {...props} />
    </Canvas>
  );
}
