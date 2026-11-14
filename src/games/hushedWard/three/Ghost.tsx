"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { GhostMode } from "../sim";
import { ghostFaceTexture } from "./textures";

/**
 * 청귀(聽鬼) — 눈이 꿰매어진 채 소리만 듣고 다니는 것. 키 2.2m, 무릎까지 내려오는 팔, 커다란 귀.
 * 상태마다 자세가 다르다: 어슬렁(절뚝·고개 꺾임) / 귀 기울임(멈춰서 귀가 벌어지고 고개가 천천히 돈다) /
 * 추격(앞으로 쏟아지며 팔을 뻗고 입이 벌어진다) / 붙잡음(웅크림) / 문 박차기.
 */

export interface GhostFrame {
  x: number;
  z: number;
  yaw: number;
  mode: GhostMode;
  visible: boolean;
}

interface Parts {
  root: THREE.Group | null;
  body: THREE.Group | null;
  head: THREE.Group | null;
  armL: THREE.Group | null;
  armR: THREE.Group | null;
  foreL: THREE.Group | null;
  foreR: THREE.Group | null;
  earL: THREE.Mesh | null;
  earR: THREE.Mesh | null;
  jaw: THREE.Mesh | null;
  hair: THREE.Group | null;
}

interface Pose {
  lean: number;
  armL: number;
  armR: number;
  fore: number;
  spread: number;
  ear: number;
  jaw: number;
  headYaw: number;
  headTilt: number;
  bob: number;
}

const k = (cur: number, want: number, a: number) => cur + (want - cur) * a;

function poseGhost(p: Parts, cur: Pose, f: GhostFrame, t: number, dt: number) {
  if (!p.root || !p.body || !p.head) return;
  p.root.visible = f.visible;
  if (!f.visible) return;
  p.root.position.set(f.x, 0, f.z);
  p.root.rotation.y = f.yaw;

  const hunt = f.mode === "hunt";
  const still = f.mode === "listen" || f.mode === "hush";
  const walk = t * (hunt ? 13 : f.mode === "investigate" ? 8 : 4.2);
  const sw = Math.sin(walk);
  // 2.3초마다 0.12초 동안 고개가 "딱" 꺾인다
  const tw = t % 2.3 < 0.12 ? (Math.floor(t / 2.3) % 2 === 0 ? 0.7 : -0.6) : 0;
  let want: Pose;
  switch (f.mode) {
    case "hunt":
      want = { lean: 0.52, armL: 1.45 + sw * 0.18, armR: 1.45 - sw * 0.18, fore: 0.25, spread: 0.12, ear: 1.25, jaw: 1, headYaw: Math.sin(t * 17) * 0.08, headTilt: Math.sin(t * 23) * 0.1, bob: Math.abs(sw) * 0.07 };
      break;
    case "investigate":
      want = { lean: 0.26, armL: 0.55 + sw * 0.2, armR: 0.35 - sw * 0.2, fore: 0.5, spread: 0.2, ear: 1.35, jaw: 0.25, headYaw: Math.sin(t * 2.4) * 0.5, headTilt: 0.2, bob: Math.abs(sw) * 0.04 };
      break;
    case "listen":
      want = { lean: 0.05, armL: 0.08, armR: 0.08, fore: 0.15, spread: 0.3, ear: 1.7, jaw: 0, headYaw: Math.sin(t * 0.9) * 1.25, headTilt: Math.sin(t * 0.5) * 0.3, bob: 0 };
      break;
    case "hush":
      want = { lean: -0.06, armL: 0.25, armR: 0.25, fore: 0.9, spread: 0.55, ear: 2.1, jaw: 0.1, headYaw: Math.sin(t * 0.7) * 1.5, headTilt: Math.sin(t * 31) * 0.03, bob: Math.sin(t * 37) * 0.006 };
      break;
    case "feed":
      want = { lean: 1.05, armL: 0.9, armR: 0.9, fore: 0.7, spread: 0.1, ear: 0.9, jaw: 1, headYaw: Math.sin(t * 9) * 0.25, headTilt: 0, bob: Math.sin(t * 9) * 0.03 };
      break;
    case "door":
      want = { lean: 0.2, armL: 2.5, armR: 2.5, fore: 0.3, spread: 0.1, ear: 1.2, jaw: 0.6, headYaw: 0, headTilt: 0.1, bob: 0 };
      break;
    case "sleep":
      want = { lean: 0.9, armL: 0.2, armR: 0.2, fore: 0.2, spread: 0.05, ear: 0.8, jaw: 0, headYaw: 0, headTilt: 0.5, bob: 0 };
      break;
    default:
      want = { lean: 0.13, armL: sw * 0.16, armR: -sw * 0.16, fore: 0.12, spread: 0.08, ear: 1, jaw: 0, headYaw: tw, headTilt: Math.sin(t * 0.7) * 0.28 + tw * 0.4, bob: Math.abs(sw) * 0.035 };
  }
  const a = Math.min(1, dt * (still ? 3 : 9));
  cur.lean = k(cur.lean, want.lean, a);
  cur.armL = k(cur.armL, want.armL, a);
  cur.armR = k(cur.armR, want.armR, a);
  cur.fore = k(cur.fore, want.fore, a);
  cur.spread = k(cur.spread, want.spread, a);
  cur.ear = k(cur.ear, want.ear, a);
  cur.jaw = k(cur.jaw, want.jaw, a);
  // 고개 꺾임은 보간 없이 튄다
  cur.headYaw = f.mode === "roam" && tw !== 0 ? want.headYaw : k(cur.headYaw, want.headYaw, a);
  cur.headTilt = k(cur.headTilt, want.headTilt, a);
  cur.bob = k(cur.bob, want.bob, a);

  p.body.rotation.x = -cur.lean;
  p.body.position.y = cur.bob;
  // 절뚝임
  p.body.rotation.z = still || f.mode === "feed" ? 0 : Math.sin(walk * 0.5) * (hunt ? 0.05 : 0.07);
  p.head.rotation.set(cur.lean * 0.55, cur.headYaw, cur.headTilt);
  if (p.armL && p.armR) {
    p.armL.rotation.set(cur.armL, 0, -cur.spread);
    p.armR.rotation.set(cur.armR, 0, cur.spread);
  }
  if (p.foreL && p.foreR) {
    p.foreL.rotation.x = cur.fore;
    p.foreR.rotation.x = cur.fore;
  }
  if (p.earL && p.earR) {
    p.earL.scale.set(cur.ear, cur.ear, 0.3);
    p.earR.scale.set(cur.ear, cur.ear, 0.3);
  }
  if (p.jaw) p.jaw.scale.y = 0.25 + cur.jaw * 1.5;
  if (p.hair) p.hair.rotation.x = cur.lean * 0.5 + Math.sin(t * 1.3) * 0.04;
}

const SKIN = "#a69e90";
const GOWN = "#6f6d66";

function Arm({ side, arm, fore }: { side: 1 | -1; arm: (g: THREE.Group | null) => void; fore: (g: THREE.Group | null) => void }) {
  return (
    <group ref={arm} position={[side * 0.215, 1.66, 0]}>
      <mesh position={[0, -0.27, 0]} castShadow>
        <capsuleGeometry args={[0.034, 0.5, 3, 8]} />
        <meshStandardMaterial color={SKIN} roughness={0.95} />
      </mesh>
      <group ref={fore} position={[0, -0.56, 0]}>
        <mesh position={[0, -0.27, 0]} castShadow>
          <capsuleGeometry args={[0.028, 0.5, 3, 8]} />
          <meshStandardMaterial color={SKIN} roughness={0.95} />
        </mesh>
        {/* 손가락 넷: 길고 뾰족하다 */}
        {[-0.04, -0.013, 0.013, 0.04].map((dx, i) => (
          <mesh key={i} position={[dx, -0.66, 0]} rotation={[0, 0, dx * 3]} castShadow>
            <coneGeometry args={[0.011, 0.24, 5]} />
            <meshStandardMaterial color="#77705f" roughness={1} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

export default function Ghost({ frame }: { frame: MutableRefObject<GhostFrame> }) {
  const face = useMemo(() => ghostFaceTexture(), []);
  useEffect(() => () => face.dispose(), [face]);
  const parts = useRef<Parts>({ root: null, body: null, head: null, armL: null, armR: null, foreL: null, foreR: null, earL: null, earR: null, jaw: null, hair: null });
  const pose = useRef<Pose>({ lean: 0.1, armL: 0, armR: 0, fore: 0.1, spread: 0.1, ear: 1, jaw: 0, headYaw: 0, headTilt: 0, bob: 0 });
  useFrame((st, dt) => poseGhost(parts.current, pose.current, frame.current, st.clock.elapsedTime, Math.min(0.05, dt)));

  return (
    <group ref={(o) => {
          parts.current.root = o;
        }} visible={false}>
      <group ref={(o) => {
          parts.current.body = o;
        }}>
        {/* 해진 환자복 */}
        <mesh position={[0, 0.72, 0]} castShadow>
          <cylinderGeometry args={[0.17, 0.33, 1.3, 9, 1, true]} />
          <meshStandardMaterial color={GOWN} roughness={1} side={THREE.DoubleSide} />
        </mesh>
        {[-0.09, 0.09].map((dx) => (
          <mesh key={dx} position={[dx, 0.38, 0]} castShadow>
            <capsuleGeometry args={[0.04, 0.68, 3, 8]} />
            <meshStandardMaterial color={SKIN} roughness={0.95} />
          </mesh>
        ))}
        <mesh position={[0, 1.5, 0]} castShadow>
          <capsuleGeometry args={[0.17, 0.3, 4, 10]} />
          <meshStandardMaterial color={GOWN} roughness={1} />
        </mesh>
        <Arm side={-1} arm={(o) => {
          parts.current.armL = o;
        }} fore={(o) => {
          parts.current.foreL = o;
        }} />
        <Arm side={1} arm={(o) => {
          parts.current.armR = o;
        }} fore={(o) => {
          parts.current.foreR = o;
        }} />
        {/* 길게 빠진 목 */}
        <mesh position={[0, 1.86, 0]} castShadow>
          <cylinderGeometry args={[0.04, 0.055, 0.26, 8]} />
          <meshStandardMaterial color={SKIN} roughness={0.95} />
        </mesh>
        <group ref={(o) => {
          parts.current.head = o;
        }} position={[0, 2.06, 0]}>
          <mesh rotation={[0, Math.PI / 2, 0]} scale={[1, 1.22, 0.95]} castShadow>
            <sphereGeometry args={[0.15, 20, 16]} />
            <meshStandardMaterial map={face} roughness={0.9} emissive="#1a1512" emissiveIntensity={0.5} />
          </mesh>
          {/* 귀: 소리를 들을 때 벌어진다 */}
          <mesh ref={(o) => {
          parts.current.earL = o;
        }} position={[-0.15, 0.02, 0.01]} rotation={[0, 0, Math.PI / 2 + 0.35]} scale={[1, 1, 0.3]} castShadow>
            <coneGeometry args={[0.085, 0.24, 8]} />
            <meshStandardMaterial color="#8f8576" roughness={1} />
          </mesh>
          <mesh ref={(o) => {
          parts.current.earR = o;
        }} position={[0.15, 0.02, 0.01]} rotation={[0, 0, -Math.PI / 2 - 0.35]} scale={[1, 1, 0.3]} castShadow>
            <coneGeometry args={[0.085, 0.24, 8]} />
            <meshStandardMaterial color="#8f8576" roughness={1} />
          </mesh>
          {/* 벌어지는 입 속 */}
          <mesh ref={(o) => {
          parts.current.jaw = o;
        }} position={[0, -0.085, -0.118]} scale={[1, 0.25, 1]}>
            <sphereGeometry args={[0.062, 10, 8]} />
            <meshStandardMaterial color="#050203" roughness={1} />
          </mesh>
          {/* 젖은 긴 머리 */}
          <group ref={(o) => {
          parts.current.hair = o;
        }} position={[0, 0.1, 0.05]}>
            {[-0.13, -0.09, -0.045, 0, 0.045, 0.09, 0.13].map((dx, i) => (
              <mesh key={i} position={[dx, -0.42 - (i % 3) * 0.06, 0.07 - Math.abs(dx) * 0.5]} rotation={[0.05, 0, dx * 0.5]}>
                <boxGeometry args={[0.035, 0.95 + (i % 3) * 0.12, 0.012]} />
                <meshStandardMaterial color="#0a0908" roughness={0.7} />
              </mesh>
            ))}
            {[-0.1, 0.11].map((dx) => (
              <mesh key={dx} position={[dx, -0.2, -0.12]} rotation={[-0.1, 0, dx]}>
                <boxGeometry args={[0.03, 0.5, 0.01]} />
                <meshStandardMaterial color="#0a0908" roughness={0.7} />
              </mesh>
            ))}
          </group>
        </group>
      </group>
    </group>
  );
}
