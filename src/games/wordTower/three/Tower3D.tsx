"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { EntryStatus } from "../engine";
import { BLOCK_H, SLAB_W, nameTagTexture, slabFaceTexture, slabSideTexture } from "./textures";

/**
 * 단어 마천루 3D 무대. 표시 전용 — 상태는 props로만 받고, 움직임은 모두 "처음 본 시각" 기준의
 * 닫힌 식이라(물리 엔진 없음) 어느 기기에서나 같은 모습이 된다.
 *
 * - 원형 무대 위에 좌석 순서대로 탑이 나란히 선다. 단어 하나 = 층수만큼 두께의 블록 하나.
 * - 새 블록은 위에서 떨어져 통통 튀며 앉고, 보류 블록은 반투명하게 깜빡인다.
 * - 인정되면 금빛으로 번쩍, 거절되면 옆으로 굴러떨어지며 사라진다(위 블록들은 부드럽게 내려앉음).
 * - 높을수록 탑이 살짝 흔들린다. 1등 탑 위엔 왕관, 카메라는 가장 높은 탑에 맞춰 물러난다.
 */

export interface SlabView {
  id: number;
  /** null = 남의 단어(비공개) → 창문 무늬. */
  label: string | null;
  blocks: number;
  status: EntryStatus;
}

export interface TowerView {
  seat: number;
  name: string;
  color: string;
  isMe: boolean;
  height: number;
  streak: number;
  crowned: boolean;
  slabs: SlabView[];
}

const SPACING = 1.85;
const GAP = 0.025;
const DROP_MS = 520;
const FALL_MS = 1300;

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
function bounce(t: number) {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

/** 블록마다 조금씩 어긋나게 — 손으로 쌓은 느낌. id 기반이라 모든 기기에서 같다. */
function jitter(id: number): { x: number; z: number; ry: number } {
  const a = Math.sin(id * 12.9898) * 43758.5453;
  const b = Math.sin(id * 78.233) * 12345.6789;
  const c = Math.sin(id * 3.17) * 9876.54321;
  const f = (v: number) => v - Math.floor(v) - 0.5;
  return { x: f(a) * 0.12, z: f(b) * 0.12, ry: f(c) * 0.22 };
}

function towerX(index: number, count: number): number {
  return (index - (count - 1) / 2) * SPACING;
}

function slabHeight(blocks: number): number {
  return blocks * BLOCK_H - GAP;
}

/** 거절된 블록을 뺀 쌓인 높이(월드 단위). */
function stackHeight(slabs: SlabView[]): number {
  return slabs.reduce((h, s) => (s.status === "rejected" ? h : h + s.blocks * BLOCK_H), 0);
}

/* ── 블록 ─────────────────────────────────────────────────── */

function Slab({ slab, color, baseY }: { slab: SlabView; color: string; baseY: number }) {
  const mesh = useRef<THREE.Mesh>(null);
  const anim = useRef<{ born: number | null; y: number | null; fall: number | null; flash: number | null; last: EntryStatus | null }>({
    born: null,
    y: null,
    fall: null,
    flash: null,
    last: null,
  });
  const h = slabHeight(slab.blocks);
  const j = jitter(slab.id);

  const materials = useMemo(() => {
    const face = slabFaceTexture(color, slab.blocks, slab.label);
    const side = slabSideTexture(color, slab.blocks);
    const top = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.85), roughness: 0.6 });
    const mk = (map: THREE.Texture) => new THREE.MeshStandardMaterial({ map, roughness: 0.55, metalness: 0.05 });
    // BoxGeometry 면 순서: +x, -x, +y, -y, +z(앞), -z
    return [mk(side), mk(side), top, top, mk(face), mk(side)];
  }, [color, slab.blocks, slab.label]);

  useFrame((frame, delta) => {
    const m = mesh.current;
    if (!m) return;
    const now = frame.clock.elapsedTime * 1000;
    const a = anim.current;
    if (a.born === null) a.born = now;
    if (a.last !== slab.status) {
      if (slab.status === "approved" && a.last === "pending") a.flash = now;
      if (slab.status === "rejected" && a.fall === null) a.fall = now;
      a.last = slab.status;
    }
    const targetY = baseY + h / 2;
    a.y = a.y === null ? targetY : a.y + (targetY - a.y) * Math.min(1, delta * 8);

    const dropT = Math.min(1, (now - a.born) / DROP_MS);
    let y = a.y + (1 - bounce(dropT)) * 3.2;
    let x = j.x;
    let rz = 0;
    let opacity = 1;
    if (a.fall !== null) {
      const t = Math.min(1, (now - a.fall) / FALL_MS);
      const dir = slab.id % 2 === 0 ? 1 : -1;
      x += dir * easeOut(t) * 1.6;
      y -= t * t * 5;
      rz = dir * -t * 2.4;
      opacity = 1 - Math.max(0, (t - 0.55) / 0.45);
      m.visible = t < 1;
    }
    m.position.set(x, y, j.z);
    m.rotation.set(0, j.ry, rz);

    const pending = slab.status === "pending";
    const alpha = pending ? 0.45 + Math.sin(now / 260) * 0.12 : opacity;
    const flash = a.flash !== null ? Math.max(0, 1 - (now - a.flash) / 900) : 0;
    // 재질은 훅이 돌려준 값 대신 메시에서 꺼내 바꾼다(React Compiler 규칙).
    for (const mat of m.material as THREE.MeshStandardMaterial[]) {
      mat.transparent = alpha < 1;
      mat.opacity = alpha;
      if (pending) mat.emissive.setRGB(0.25, 0.2, 0.45);
      else mat.emissive.setRGB(flash, flash * 0.75, flash * 0.1);
      mat.emissiveIntensity = pending ? 0.6 : flash > 0 ? 1 : 0;
    }
  });

  return (
    <mesh ref={mesh} material={materials}>
      <boxGeometry args={[SLAB_W, h, SLAB_W]} />
    </mesh>
  );
}

/* ── 왕관 ─────────────────────────────────────────────────── */

const GOLD = new THREE.MeshStandardMaterial({ color: "#facc15", metalness: 0.85, roughness: 0.25, emissive: "#a16207", emissiveIntensity: 0.35 });
const RUBY = new THREE.MeshStandardMaterial({ color: "#e11d48", metalness: 0.3, roughness: 0.2, emissive: "#9f1239", emissiveIntensity: 0.4 });

function Crown({ topY }: { topY: number }) {
  const group = useRef<THREE.Group>(null);
  const y = useRef<number | null>(null);
  useFrame((frame, delta) => {
    const g = group.current;
    if (!g) return;
    const t = frame.clock.elapsedTime;
    const target = topY + 1.25;
    y.current = y.current === null ? target : y.current + (target - y.current) * Math.min(1, delta * 5);
    g.position.y = y.current + Math.sin(t * 2.2) * 0.08;
    g.rotation.y = t * 1.1;
  });
  const spikes = [0, 1, 2, 3, 4].map((i) => (i / 5) * Math.PI * 2);
  return (
    <group ref={group}>
      <mesh material={GOLD} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.32, 0.07, 10, 24]} />
      </mesh>
      {spikes.map((a) => (
        <group key={a} position={[Math.cos(a) * 0.32, 0.17, Math.sin(a) * 0.32]}>
          <mesh material={GOLD}>
            <coneGeometry args={[0.075, 0.3, 8]} />
          </mesh>
          <mesh material={RUBY} position={[0, 0.19, 0]}>
            <sphereGeometry args={[0.05, 10, 8]} />
          </mesh>
        </group>
      ))}
      <pointLight color="#fde68a" intensity={2.2} distance={4} />
    </group>
  );
}

/* ── 이름표 ───────────────────────────────────────────────── */

function NameTag({ tower, topY }: { tower: TowerView; topY: number }) {
  const sprite = useRef<THREE.Sprite>(null);
  const y = useRef<number | null>(null);
  const material = useMemo(
    () => new THREE.SpriteMaterial({ map: nameTagTexture(tower.name, tower.height, tower.color, tower.isMe, tower.streak), depthTest: false, transparent: true }),
    [tower.name, tower.height, tower.color, tower.isMe, tower.streak],
  );
  useFrame((frame, delta) => {
    const s = sprite.current;
    if (!s) return;
    const target = topY + 0.45;
    y.current = y.current === null ? target : y.current + (target - y.current) * Math.min(1, delta * 6);
    s.position.y = y.current;
  });
  return <sprite ref={sprite} material={material} scale={[1.8, 0.56, 1]} renderOrder={10} />;
}

/* ── 탑 ───────────────────────────────────────────────────── */

function Tower({ tower, x }: { tower: TowerView; x: number }) {
  const group = useRef<THREE.Group>(null);
  const top = stackHeight(tower.slabs);
  // 쌓인 순서대로 바닥 높이 — 거절 블록은 자기 자리에서 떨어지고, 위 블록은 그만큼 내려온다.
  const placed = tower.slabs.map((slab, i) => ({ slab, baseY: stackHeight(tower.slabs.slice(0, i)) }));
  useFrame((frame) => {
    const g = group.current;
    if (!g) return;
    const t = frame.clock.elapsedTime;
    const sway = Math.min(0.05, top * 0.0035);
    g.rotation.z = Math.sin(t * 1.15 + tower.seat * 1.7) * sway;
    g.rotation.x = Math.cos(t * 0.9 + tower.seat) * sway * 0.5;
  });
  return (
    <group position={[x, 0.12, 0]}>
      {/* 바닥 받침 */}
      <mesh position={[0, -0.04, 0]}>
        <boxGeometry args={[SLAB_W + 0.35, 0.08, SLAB_W + 0.35]} />
        <meshStandardMaterial color={tower.color} roughness={0.7} />
      </mesh>
      {tower.isMe && (
        <mesh position={[0, -0.075, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.95, 1.1, 40]} />
          <meshBasicMaterial color="#facc15" transparent opacity={0.85} />
        </mesh>
      )}
      <group ref={group}>
        {placed.map(({ slab, baseY }) => (
          <Slab key={slab.id} slab={slab} color={tower.color} baseY={baseY} />
        ))}
        <NameTag tower={tower} topY={top} />
        {tower.crowned && <Crown topY={top + 0.3} />}
      </group>
    </group>
  );
}

/* ── 배경 도시 ────────────────────────────────────────────── */

function Skyline({ span }: { span: number }) {
  const buildings = useMemo(() => {
    const out: { x: number; z: number; w: number; h: number; c: string }[] = [];
    const n = 26;
    for (let i = 0; i < n; i++) {
      const f = (k: number) => {
        const v = Math.sin((i + 1) * k) * 10000;
        return v - Math.floor(v);
      };
      out.push({
        x: (i / (n - 1) - 0.5) * (span + 26),
        z: -9 - f(3.1) * 7,
        w: 1 + f(5.7) * 1.6,
        h: 2 + f(9.3) * 9,
        c: ["#1e293b", "#273449", "#334155", "#1f2a44"][i % 4],
      });
    }
    return out;
  }, [span]);
  return (
    <group>
      {buildings.map((b, i) => (
        <mesh key={i} position={[b.x, b.h / 2 - 0.2, b.z]}>
          <boxGeometry args={[b.w, b.h, b.w]} />
          <meshStandardMaterial color={b.c} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/* ── 카메라 ───────────────────────────────────────────────── */

const FOV = 42;

function CameraRig({ span, maxTop }: { span: number; maxTop: number }) {
  useFrame((frame, delta) => {
    const cam = frame.camera as THREE.PerspectiveCamera;
    const aspect = frame.size.width / Math.max(1, frame.size.height);
    const tanV = Math.tan(((FOV / 2) * Math.PI) / 180);
    const needH = maxTop + 2.6;
    const needW = span + 1.8;
    const dist = Math.max(7, needH / 2 / tanV, needW / 2 / (tanV * aspect)) * 1.08;
    const lookY = Math.max(1.2, needH / 2 - 0.4);
    const k = Math.min(1, delta * 2.2);
    cam.position.x += (0 - cam.position.x) * k;
    cam.position.y += (lookY + dist * 0.22 - cam.position.y) * k;
    cam.position.z += (dist - cam.position.z) * k;
    cam.lookAt(0, lookY, 0);
  });
  return null;
}

/* ── 장면 ─────────────────────────────────────────────────── */

export default function Tower3D({ towers }: { towers: TowerView[] }) {
  const span = (towers.length - 1) * SPACING + SLAB_W;
  const maxTop = Math.max(0, ...towers.map((t) => stackHeight(t.slabs)));
  return (
    <Canvas camera={{ fov: FOV, position: [0, 4, 12], near: 0.1, far: 200 }} dpr={[1, 2]} gl={{ antialias: true }}>
      <color attach="background" args={["#0b1022"]} />
      <fog attach="fog" args={["#0b1022", 16, 48]} />
      <hemisphereLight args={["#c7d2fe", "#1e1b4b", 0.9]} />
      <directionalLight position={[5, 12, 8]} intensity={1.6} />
      <directionalLight position={[-6, 4, -4]} intensity={0.4} color="#93c5fd" />
      <Skyline span={span} />
      <mesh position={[0, -0.02, 0]}>
        <cylinderGeometry args={[span / 2 + 1.6, span / 2 + 1.9, 0.2, 48]} />
        <meshStandardMaterial color="#334155" roughness={0.85} />
      </mesh>
      {towers.map((t, i) => (
        <Tower key={t.seat} tower={t} x={towerX(i, towers.length)} />
      ))}
      <CameraRig span={span} maxTop={maxTop} />
    </Canvas>
  );
}
