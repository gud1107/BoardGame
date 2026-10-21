"use client";

import { useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { BACK_Y, BUTTON_R, HACK_Y, HOG_Y, HOUSE_R, NEAR_TEE_Y, RELEASE_Y, RING_4_R, RING_8_R, SHEET_HALF, STONE_R, TEE_Y, type Stone } from "../physics";
import { viewStones, type LiveView } from "../live";
import { SIDE_COLORS } from "../SheetCanvas";

/**
 * 컬링 3D 중계 화면 — 실제 빙판 크기 그대로의 시트(하우스·호그 라인·티 라인),
 * 화강암 스톤과 팀 색 손잡이. 투구 중엔 방송 카메라가 날아가는 스톤 뒤를
 * 따라가고(스위핑 중이면 앞 얼음이 반짝), 멈추면 하우스 위로 올라가 판세를
 * 보여 준다. 입력(조준·투구·스위핑)은 원래 2D 시트가 그대로 맡고, 이 화면은
 * 같은 `live` 스냅샷을 매 프레임 읽기만 한다 — 판정·물리는 건드리지 않는다.
 */

export interface CurlingBroadcast3DProps {
  stones: readonly Stone[];
  live: MutableRefObject<LiveView | null>;
  lowDetail: boolean;
}

const POOL = 40;
const SHEET_START = BACK_Y - 1.6;
const SHEET_END = HACK_Y + 1.2;

function House({ y }: { y: number }) {
  return (
    <group position={[0, 0.003, y]} rotation-x={-Math.PI / 2}>
      <mesh>
        <ringGeometry args={[RING_8_R, HOUSE_R, 64]} />
        <meshStandardMaterial color="#1d4ed8" roughness={0.3} />
      </mesh>
      <mesh position={[0, 0, 0.001]}>
        <ringGeometry args={[RING_4_R, RING_8_R, 64]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.3} />
      </mesh>
      <mesh position={[0, 0, 0.002]}>
        <ringGeometry args={[BUTTON_R, RING_4_R, 64]} />
        <meshStandardMaterial color="#dc2626" roughness={0.3} />
      </mesh>
      <mesh position={[0, 0, 0.003]}>
        <circleGeometry args={[BUTTON_R, 32]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.3} />
      </mesh>
    </group>
  );
}

function Line({ y, color, w = 0.04 }: { y: number; color: string; w?: number }) {
  return (
    <mesh position={[0, 0.006, y]} rotation-x={-Math.PI / 2}>
      <planeGeometry args={[SHEET_HALF * 2, w]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

function Sheet() {
  const len = SHEET_END - SHEET_START;
  return (
    <group>
      <mesh position={[0, 0, (SHEET_START + SHEET_END) / 2]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[SHEET_HALF * 2, len]} />
        <meshPhysicalMaterial color="#eef6ff" roughness={0.12} metalness={0} clearcoat={1} clearcoatRoughness={0.08} />
      </mesh>
      {/* side boards */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (SHEET_HALF + 0.08), 0.1, (SHEET_START + SHEET_END) / 2]}>
          <boxGeometry args={[0.16, 0.2, len]} />
          <meshStandardMaterial color="#1e293b" roughness={0.6} />
        </mesh>
      ))}
      <House y={TEE_Y} />
      <House y={NEAR_TEE_Y} />
      <Line y={TEE_Y} color="#1e293b" w={0.02} />
      <Line y={BACK_Y} color="#1e293b" w={0.02} />
      <Line y={HOG_Y} color="#dc2626" w={0.1} />
      <Line y={RELEASE_Y} color="#dc2626" w={0.1} />
      <mesh position={[0, 0.006, (SHEET_START + SHEET_END) / 2]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[0.015, len]} />
        <meshBasicMaterial color="#334155" />
      </mesh>
      {/* arena floor + crowd glow */}
      <mesh position={[0, -0.02, (SHEET_START + SHEET_END) / 2]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[30, len + 20]} />
        <meshStandardMaterial color="#0f172a" roughness={1} />
      </mesh>
    </group>
  );
}

const graniteGeo = new THREE.CylinderGeometry(STONE_R, STONE_R * 0.92, 0.11, 32);
const bandGeo = new THREE.CylinderGeometry(STONE_R * 1.005, STONE_R * 1.005, 0.025, 32);
const handleGeo = new THREE.BoxGeometry(0.17, 0.04, 0.05);
const capGeo = new THREE.CylinderGeometry(STONE_R * 0.55, STONE_R * 0.6, 0.02, 24);

/** A fixed pool of stone meshes, assigned to the live stones every frame (no React churn at 60 Hz). */
function Stones({ stones, live }: CurlingBroadcast3DProps) {
  const groups = useRef<(THREE.Group | null)[]>([]);
  const handleMats = useMemo(() => SIDE_COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35 })), []);
  const handles = useRef<(THREE.Mesh | null)[]>([]);
  const caps = useRef<(THREE.Mesh | null)[]>([]);
  const camTarget = useRef(new THREE.Vector3(0, 0, 0));
  const camPos = useRef(new THREE.Vector3(0, 6.5, 7));
  const sweepGlow = useRef<THREE.Mesh>(null);
  useFrame(({ camera, clock }) => {
    const view = live.current;
    const moving = !!view && !view.done && view.snaps.length > 0;
    const list = moving ? viewStones(view!) : stones.map((s) => ({ ...s, ghost: false }));
    for (let i = 0; i < POOL; i++) {
      const g = groups.current[i];
      if (!g) continue;
      const s = list[i];
      if (!s || s.ghost) {
        g.visible = false;
        continue;
      }
      g.visible = true;
      g.position.set(s.x, 0.055, s.y);
      g.rotation.y = -s.angle;
      const m = handleMats[s.side % handleMats.length];
      if (handles.current[i]) handles.current[i]!.material = m;
      if (caps.current[i]) caps.current[i]!.material = m;
    }
    // broadcast camera: chase the delivered stone, otherwise hover over the house
    const delivered = moving ? list.find((s) => s.id === view!.deliveredId) : undefined;
    if (delivered) {
      camTarget.current.lerp(new THREE.Vector3(delivered.x * 0.6, 0, delivered.y - 3), 0.12);
      camPos.current.lerp(new THREE.Vector3(delivered.x * 0.4, 1.6, delivered.y + 3.4), 0.1);
    } else {
      camTarget.current.lerp(new THREE.Vector3(0, 0, TEE_Y - 0.2), 0.05);
      camPos.current.lerp(new THREE.Vector3(0, 6.2, TEE_Y + 5.8), 0.05);
    }
    camera.position.copy(camPos.current);
    camera.lookAt(camTarget.current);
    const sweeping = moving && delivered && (view!.sweep.own > 0 || view!.sweep.opp > 0);
    if (sweepGlow.current) {
      sweepGlow.current.visible = !!sweeping;
      if (delivered) sweepGlow.current.position.set(delivered.x, 0.008, delivered.y - 0.6);
      (sweepGlow.current.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(clock.elapsedTime * 30) * 0.15;
    }
  });
  return (
    <group>
      {Array.from({ length: POOL }, (_, i) => (
        <group key={i} ref={(g) => void (groups.current[i] = g)} visible={false}>
          <mesh geometry={graniteGeo} castShadow>
            <meshStandardMaterial color="#6b7280" roughness={0.55} />
          </mesh>
          <mesh geometry={bandGeo} position={[0, -0.005, 0]}>
            <meshStandardMaterial color="#374151" roughness={0.5} />
          </mesh>
          <mesh ref={(m) => void (caps.current[i] = m)} geometry={capGeo} position={[0, 0.065, 0]} material={handleMats[0]} />
          <mesh ref={(m) => void (handles.current[i] = m)} geometry={handleGeo} position={[0.02, 0.095, 0]} material={handleMats[0]} />
        </group>
      ))}
      <mesh ref={sweepGlow} rotation-x={-Math.PI / 2} visible={false}>
        <planeGeometry args={[0.5, 0.7]} />
        <meshBasicMaterial color="#bae6fd" transparent opacity={0.4} depthWrite={false} />
      </mesh>
    </group>
  );
}

function Scene(props: CurlingBroadcast3DProps) {
  return (
    <>
      <color attach="background" args={["#0b1020"]} />
      <fog attach="fog" args={["#0b1020", 18, 46]} />
      <ambientLight intensity={0.5} color="#e0f2fe" />
      <hemisphereLight args={["#e0f2fe", "#0f172a", 0.6]} />
      <directionalLight position={[3, 10, 4]} intensity={1.1} castShadow={!props.lowDetail} shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      {[TEE_Y, HOG_Y + 8, RELEASE_Y].map((z) => (
        <pointLight key={z} position={[0, 5, z]} intensity={10} distance={16} color="#f8fafc" />
      ))}
      <Sheet />
      <Stones {...props} />
    </>
  );
}

export default function CurlingBroadcast3D(props: CurlingBroadcast3DProps) {
  const high = !props.lowDetail;
  return (
    <Canvas shadows={high} dpr={high ? [1, 1.75] : [1, 1.25]} gl={{ antialias: high, powerPreference: "high-performance" }} camera={{ fov: 45, position: [0, 6.2, 5.8], near: 0.05, far: 120 }} style={{ pointerEvents: "none" }}>
      <Scene {...props} />
    </Canvas>
  );
}
