"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { PersonLook } from "@/games/shared/three/SeatedPerson";
import VrmBody, { setBone, BODY, BODY_DROP } from "@/games/shared/three/VrmBody";
import { SEAT_SYMBOLS } from "../data";

/**
 * 장난감 차 (룰북 §11): 자리 색 차체 + 지붕 위 자리 기호·번호판, 굴러가는 바퀴, 브레이크 등,
 * ⚡ 부스트 불꽃, 🌀 드리프트 불똥(1단 파랑·2단 주황 — 색 + 불똥 개수로 구분), 🫧 방패 거품, 🌀 팽이 고리,
 * 💫 빙글(차가 팽그르르), 💨 바람막이 줄무늬. 운전석엔 프로필 캐릭터(VRM)가 앉아 핸들을 잡는다(화질 낮음이면 헬멧 머리).
 *
 * 매 프레임 `read()`로 위치·상태를 받아 React 다시 그리기 없이 움직인다. 차 앞 = +x, 방향각 h → rotation.y = −h.
 */

export interface CarFrame {
  x: number;
  y: number;
  z: number;
  h: number;
  speed: number;
  flags: number;
  visible: boolean;
  shield: boolean;
  /** 1등이면 작은 왕관 깃발 */
  leader: boolean;
  /** 핸들 꺾은 정도 −1~1 (화면 연출) */
  steer: number;
  finished: boolean;
}

const wheelGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.14, 16);
const hubGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.15, 10);
const shadowGeo = new THREE.CircleGeometry(0.62, 24);
const flameGeo = new THREE.ConeGeometry(0.13, 0.6, 10);
const sparkGeo = new THREE.OctahedronGeometry(0.05, 0);
const bubbleGeo = new THREE.SphereGeometry(0.85, 20, 14);
const ringGeo = new THREE.TorusGeometry(0.75, 0.04, 6, 32);
const lineGeo = new THREE.BoxGeometry(1.4, 0.015, 0.015);

const symbolCache = new Map<string, THREE.Texture>();
function symbolTexture(seat: number, color: string): THREE.Texture {
  const key = `${seat}:${color}`;
  const hit = symbolCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(64, 64, 58, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = color;
  g.font = "bold 64px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(SEAT_SYMBOLS[seat % 8], 64, 52);
  g.fillStyle = "#0f172a";
  g.font = "bold 34px sans-serif";
  g.fillText(String(seat + 1), 64, 102);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  symbolCache.set(key, t);
  return t;
}

export default function ToyCar({ seat, color, look, lowDetail, read }: { seat: number; color: string; look: PersonLook; lowDetail: boolean; read: () => CarFrame }) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const shadow = useRef<THREE.Mesh>(null);
  const wheels = useRef<THREE.Group>(null);
  const front = useRef<THREE.Group[]>([]);
  const flame = useRef<THREE.Group>(null);
  const sparks = useRef<THREE.Group>(null);
  const sparkMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#38bdf8", toneMapped: false }), []);
  const bubble = useRef<THREE.Mesh>(null);
  const topRing = useRef<THREE.Mesh>(null);
  const lines = useRef<THREE.Group>(null);
  const brake = useRef<THREE.MeshStandardMaterial>(null);
  const flag = useRef<THREE.Group>(null);
  const st = useRef({ roll: 0, spinA: 0, steer: 0, lastH: 0, t: 0 });
  const symbol = useMemo(() => symbolTexture(seat, color), [seat, color]);
  const frameRef = useRef<CarFrame | null>(null);

  useFrame((_, dtRaw) => {
    const dt = Math.min(0.05, dtRaw);
    const f = read();
    frameRef.current = f;
    const s = st.current;
    s.t += dt;
    const r = root.current;
    if (!r) return;
    r.visible = f.visible;
    if (!f.visible) {
      if (shadow.current) shadow.current.visible = false;
      return;
    }
    const spin = (f.flags & 32) !== 0;
    const top = (f.flags & 128) !== 0;
    s.spinA = spin || top ? s.spinA + dt * (top ? 16 : 13) : s.spinA * Math.exp(-dt * 10);
    if (!spin && !top && Math.abs(s.spinA) > 0.01) {
      // 빙글이 끝나면 가장 가까운 한 바퀴로 돌아온다
      const k = Math.round(s.spinA / (Math.PI * 2)) * Math.PI * 2;
      s.spinA = k + (s.spinA - k) * Math.exp(-dt * 10);
    }
    r.position.set(f.x, f.y, f.z);
    r.rotation.y = -f.h - s.spinA;
    // 기울기: 드리프트·핸들
    s.steer += (f.steer - s.steer) * Math.min(1, dt * 8);
    const drift = (f.flags & 1) !== 0;
    if (body.current) {
      body.current.rotation.x = -s.steer * (drift ? 0.12 : 0.05);
      body.current.position.y = (f.flags & 64 ? 0 : Math.abs(Math.sin(s.t * 18)) * 0.012 * Math.min(1, f.speed / 6)) + 0.05;
      body.current.rotation.z = f.flags & 64 ? 0.12 : 0;
    }
    if (shadow.current) {
      shadow.current.visible = true;
      shadow.current.position.set(f.x, f.y - (f.flags & 64 ? Math.max(0, f.y - 0) : 0) + 0.015, f.z);
      shadow.current.rotation.z = f.h;
    }
    s.roll += f.speed * dt * 5.5;
    wheels.current?.children.forEach((w) => {
      (w as THREE.Group).children[0].rotation.y = -s.roll;
    });
    for (const g of front.current) if (g) g.rotation.y = -s.steer * 0.45;
    const boost = (f.flags & 8) !== 0 || top;
    if (flame.current) {
      flame.current.visible = boost;
      flame.current.scale.setScalar(0.8 + Math.abs(Math.sin(s.t * 40)) * 0.5);
    }
    const tier = f.flags & 4 ? 2 : f.flags & 2 ? 1 : 0;
    if (sparks.current) {
      sparks.current.visible = drift && tier > 0;
      sparkMat.color.set(tier === 2 ? "#fb923c" : "#38bdf8");
      sparks.current.children.forEach((c, i) => {
        const ph = (s.t * 9 + i * 0.37) % 1;
        c.position.set(-0.5 - ph * 0.4, 0.05 + Math.sin(ph * Math.PI) * 0.25, (i % 2 ? 1 : -1) * 0.3 + Math.sin(i * 7.3 + s.t * 20) * 0.08);
        c.visible = tier === 2 || i < 4;
      });
    }
    if (bubble.current) {
      bubble.current.visible = f.shield;
      bubble.current.scale.setScalar(1 + Math.sin(s.t * 5) * 0.04);
    }
    if (topRing.current) {
      topRing.current.visible = top;
      topRing.current.rotation.z = s.t * 8;
    }
    if (lines.current) lines.current.visible = (f.flags & 1024) !== 0 && !boost;
    if (brake.current) brake.current.emissiveIntensity = f.flags & 16 ? 2.2 : 0.4;
    if (flag.current) {
      flag.current.visible = f.leader;
      flag.current.rotation.y = Math.sin(s.t * 4) * 0.3;
    }
  });

  /** 운전사 자세: 앉아서 두 손으로 핸들, 꺾는 쪽으로 몸이 기운다 */
  const pose = (o: Float32Array) => {
    const f = frameRef.current;
    const steer = st.current.steer;
    setBone(o, "rightUpperLeg", -1.5, 0, -0.08);
    setBone(o, "leftUpperLeg", -1.5, 0, 0.08);
    setBone(o, "rightLowerLeg", 0.25);
    setBone(o, "leftLowerLeg", 0.25);
    setBone(o, "rightUpperArm", -1.15, 0, -0.25);
    setBone(o, "leftUpperArm", -1.15, 0, 0.25);
    setBone(o, "rightLowerArm", -0.7);
    setBone(o, "leftLowerArm", -0.7);
    o[BODY.spine + 2] += steer * 0.18;
    o[BODY.head + 2] += steer * 0.12;
    if (f && f.flags & 32) {
      // 빙글: 두 팔 번쩍, 고개 젖힘
      setBone(o, "rightUpperArm", -2.6, 0, -0.6);
      setBone(o, "leftUpperArm", -2.6, 0, 0.6);
      o[BODY.head] -= 0.3;
    }
    if (f?.finished) {
      const w = Math.sin(st.current.t * 9);
      setBone(o, "rightUpperArm", -2.5 + w * 0.3, 0, -0.5);
    }
    o[BODY_DROP] += 0.32;
  };
  const face = () => {
    const f = frameRef.current;
    if (!f) return { happy: 0.3 };
    if (f.flags & 32) return { surprised: 1 };
    if (f.finished) return { happy: 1 };
    if (f.flags & 8) return { happy: 0.8 };
    return { happy: 0.35 };
  };

  return (
    <>
      <mesh ref={shadow} geometry={shadowGeo} rotation-x={-Math.PI / 2} visible={false}>
        <meshBasicMaterial color="#1c1917" transparent opacity={0.3} depthWrite={false} />
      </mesh>
      <group ref={root} visible={false}>
        <group ref={body}>
          {/* 차체 */}
          <mesh position={[0, 0.24, 0]} castShadow={!lowDetail}>
            <boxGeometry args={[1.12, 0.26, 0.62]} />
            <meshStandardMaterial color={color} roughness={0.35} metalness={0.15} />
          </mesh>
          <mesh position={[0.34, 0.33, 0]}>
            <boxGeometry args={[0.42, 0.1, 0.56]} />
            <meshStandardMaterial color={color} roughness={0.35} metalness={0.15} />
          </mesh>
          {/* 앞 범퍼·뒤 날개 */}
          <mesh position={[0.6, 0.16, 0]}>
            <boxGeometry args={[0.1, 0.12, 0.66]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.5} />
          </mesh>
          <mesh position={[-0.55, 0.48, 0]}>
            <boxGeometry args={[0.16, 0.04, 0.66]} />
            <meshStandardMaterial color="#1f2937" roughness={0.6} />
          </mesh>
          <mesh position={[-0.55, 0.4, 0.26]}>
            <boxGeometry args={[0.05, 0.14, 0.04]} />
            <meshStandardMaterial color="#1f2937" />
          </mesh>
          <mesh position={[-0.55, 0.4, -0.26]}>
            <boxGeometry args={[0.05, 0.14, 0.04]} />
            <meshStandardMaterial color="#1f2937" />
          </mesh>
          {/* 자리 기호 (보닛) */}
          <mesh position={[0.36, 0.385, 0]} rotation={[-Math.PI / 2, 0, -Math.PI / 2]}>
            <planeGeometry args={[0.36, 0.36]} />
            <meshBasicMaterial map={symbol} transparent />
          </mesh>
          {/* 브레이크 등 */}
          <mesh position={[-0.565, 0.26, 0.2]}>
            <boxGeometry args={[0.02, 0.06, 0.12]} />
            <meshStandardMaterial ref={brake} color="#ef4444" emissive="#ef4444" emissiveIntensity={0.4} />
          </mesh>
          <mesh position={[-0.565, 0.26, -0.2]}>
            <boxGeometry args={[0.02, 0.06, 0.12]} />
            <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={0.4} />
          </mesh>
          {/* 운전사 */}
          <group position={[-0.08, 0.24, 0]} rotation-y={Math.PI / 2}>
            {lowDetail ? (
              <group position={[0, 0.32, 0]}>
                <mesh>
                  <sphereGeometry args={[0.17, 14, 10]} />
                  <meshStandardMaterial color={color} roughness={0.3} metalness={0.2} />
                </mesh>
                <mesh position={[0, 0.01, 0.09]}>
                  <boxGeometry args={[0.22, 0.08, 0.1]} />
                  <meshStandardMaterial color="#0f172a" roughness={0.2} />
                </mesh>
              </group>
            ) : (
              <VrmBody
                look={look}
                seed={seat * 17 + 3}
                headY={0.62}
                pose={pose}
                face={face}
                lowDetail
                follow={14}
                fallback={
                  <mesh position={[0, 0.32, 0]}>
                    <sphereGeometry args={[0.17, 12, 8]} />
                    <meshBasicMaterial color={color} transparent opacity={0.5} />
                  </mesh>
                }
              />
            )}
          </group>
          {/* 1등 깃발 */}
          <group ref={flag} position={[-0.5, 0.5, 0.25]} visible={false}>
            <mesh position={[0, 0.25, 0]}>
              <cylinderGeometry args={[0.012, 0.012, 0.5, 6]} />
              <meshStandardMaterial color="#e5e7eb" />
            </mesh>
            <mesh position={[-0.12, 0.42, 0]}>
              <boxGeometry args={[0.24, 0.14, 0.01]} />
              <meshStandardMaterial color="#facc15" emissive="#facc15" emissiveIntensity={0.4} />
            </mesh>
          </group>
        </group>
        {/* 바퀴 */}
        <group ref={wheels}>
          {[
            [0.36, 0.33],
            [0.36, -0.33],
            [-0.36, 0.33],
            [-0.36, -0.33],
          ].map(([x, z], i) => (
            <group
              key={i}
              position={[x, 0.17, z]}
              ref={(g) => {
                if (i < 2 && g) front.current[i] = g;
              }}
            >
              <group rotation-x={Math.PI / 2}>
                <mesh geometry={wheelGeo}>
                  <meshStandardMaterial color="#111827" roughness={0.8} />
                </mesh>
                <mesh geometry={hubGeo}>
                  <meshStandardMaterial color="#e5e7eb" roughness={0.4} metalness={0.4} />
                </mesh>
              </group>
            </group>
          ))}
        </group>
        {/* ⚡ 불꽃 */}
        <group ref={flame} position={[-0.72, 0.24, 0]} visible={false}>
          {[0.16, -0.16].map((z) => (
            <mesh key={z} geometry={flameGeo} position={[0, 0, z]} rotation-z={Math.PI / 2}>
              <meshBasicMaterial color="#fb923c" transparent opacity={0.85} toneMapped={false} />
            </mesh>
          ))}
        </group>
        {/* 🌀 드리프트 불똥 */}
        <group ref={sparks} visible={false}>
          {Array.from({ length: 8 }, (_, i) => (
            <mesh key={i} geometry={sparkGeo} material={sparkMat} />
          ))}
        </group>
        {/* 🫧 방패 */}
        <mesh ref={bubble} geometry={bubbleGeo} position={[0, 0.35, 0]} visible={false}>
          <meshStandardMaterial color="#bae6fd" transparent opacity={0.28} roughness={0.05} metalness={0.3} depthWrite={false} />
        </mesh>
        {/* 🌀 팽이 */}
        <mesh ref={topRing} geometry={ringGeo} position={[0, 0.2, 0]} rotation-x={Math.PI / 2} visible={false}>
          <meshBasicMaterial color="#c084fc" toneMapped={false} />
        </mesh>
        {/* 💨 바람막이 */}
        <group ref={lines} visible={false}>
          {[0.42, -0.42, 0].map((z, i) => (
            <mesh key={i} geometry={lineGeo} position={[-0.2, 0.3 + i * 0.12, z]}>
              <meshBasicMaterial color="#ffffff" transparent opacity={0.6} />
            </mesh>
          ))}
        </group>
      </group>
    </>
  );
}
