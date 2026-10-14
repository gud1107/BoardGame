"use client";

import { useMemo, useRef, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { EntryStatus } from "../engine";
import { BLOCK_H, SLAB_W, countdownTexture, lastOneTexture, nameTagTexture, slabFaceTexture, slabSideTexture } from "./textures";

/**
 * 단어 마천루 3D 무대. 표시 전용 — 상태는 props로만 받고, 움직임은 모두 "처음 본 시각" 기준의
 * 닫힌 식이라(물리 엔진 없음) 어느 기기에서나 같은 모습이 된다.
 *
 * - 원형 무대 위에 좌석 순서대로 탑이 나란히 선다. 단어 하나 = 층수만큼 두께의 블록 하나.
 * - 새 블록은 위에서 떨어져 통통 튀며 앉고, 보류 블록은 반투명하게 깜빡인다.
 * - 인정되면 금빛으로 번쩍, 거절되면 옆으로 굴러떨어지며 사라진다(위 블록들은 부드럽게 내려앉음).
 * - 높을수록 탑이 살짝 흔들린다. 1등 탑 위엔 왕관, 카메라는 가장 높은 탑에 맞춰 물러난다.
 * - 남은 10초: 하늘·안개가 붉게 맥박치고, 화면 앞에 큰 숫자가 초마다 튀어나오며, 5초부터 카메라가 떨린다.
 * - 정답 모으기 "마지막 하나!": 금빛 현수막이 뒤집히며 떨어지고, 탐조등 두 줄기가 무대를 훑는다.
 *   (조명 개수가 바뀌면 모든 셰이더가 다시 컴파일되므로, 연출용 조명은 늘 켜 둔 채 밝기만 바꾼다.)
 */

export interface SlabView {
  id: number;
  /** null = 남의 단어(비공개) → 창문 무늬. */
  label: string | null;
  /** 정답 모으기 보너스 층 — 금색. */
  bonus?: boolean;
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
          <Slab key={slab.id} slab={slab} color={slab.bonus ? "#eab308" : tower.color} baseY={baseY} />
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

function CameraRig({ span, maxTop, shake }: { span: number; maxTop: number; shake: number }) {
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
    if (shake > 0) {
      // lookAt이 매 프레임 방향을 새로 잡으니 떨림이 쌓이지 않는다.
      const t = frame.clock.elapsedTime;
      cam.rotateZ(Math.sin(t * 47) * shake);
      cam.rotateX(Math.sin(t * 61 + 1.3) * shake * 0.6);
    }
  });
  return null;
}

/* ── 연출: 화면 앞에 붙는 층 ───────────────────────────────── */

const HUD_DIST = 6;
const tmpDir = new THREE.Vector3();

/** 카메라 바로 앞에 붙어 다니는 무리 — 탑 높이와 상관없이 늘 같은 자리에 보인다. CameraRig 뒤에 둘 것. */
function CameraHud({ children }: { children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  useFrame((frame) => {
    const g = group.current;
    if (!g) return;
    const cam = frame.camera;
    cam.getWorldDirection(tmpDir);
    g.position.copy(cam.position).addScaledVector(tmpDir, HUD_DIST);
    g.quaternion.copy(cam.quaternion);
  });
  return <group ref={group}>{children}</group>;
}

const BG = new THREE.Color("#0b1022");
const BG_RED = new THREE.Color("#4a0b1c");

/** 남은 10초: 붉은 맥박(배경·안개·역광) + 초마다 튀어나오는 큰 숫자. */
function HurryFx({ sec }: { sec: number | null }) {
  const light = useRef<THREE.DirectionalLight>(null);
  const num = useRef<THREE.Mesh>(null);
  const st = useRef<{ level: number; sec: number | null; at: number }>({ level: 0, sec: null, at: 0 });
  const material = useMemo(() => new THREE.MeshBasicMaterial({ map: countdownTexture(10), transparent: true, depthTest: false, depthWrite: false }), []);
  useFrame((frame, delta) => {
    const now = frame.clock.elapsedTime;
    const a = st.current;
    a.level += ((sec !== null ? 1 : 0) - a.level) * Math.min(1, delta * 3);
    if (sec !== null && sec !== a.sec) a.at = now;
    if (sec !== null) a.sec = sec;
    const urgent = a.sec !== null && a.sec <= 5;
    const pulse = 0.5 + 0.5 * Math.cos((now - a.at) * Math.PI * 2);
    const glow = a.level * (urgent ? 0.55 + 0.45 * pulse : 0.35 + 0.35 * pulse);

    if (light.current) light.current.intensity = glow * 2.2;
    const bg = frame.scene.background;
    if (bg instanceof THREE.Color) bg.copy(BG).lerp(BG_RED, glow);
    const fog = frame.scene.fog as THREE.Fog | null;
    if (fog) fog.color.copy(BG).lerp(BG_RED, glow);

    const m = num.current;
    if (!m) return;
    m.visible = a.level > 0.02 && a.sec !== null;
    if (!m.visible || a.sec === null) return;
    const mat = m.material as THREE.MeshBasicMaterial;
    mat.map = countdownTexture(a.sec);
    const k = now - a.at;
    const punch = 1 - easeOut(Math.min(1, k / 0.35));
    m.scale.setScalar((urgent ? 1.25 : 1) * (1 + punch * 0.9));
    m.position.z = punch * 1.2;
    mat.opacity = a.level * Math.max(urgent ? 0.4 : 0.22, 0.95 - k * 0.85);
  });
  return (
    <>
      <directionalLight ref={light} position={[0, 6, -10]} color="#f43f5e" intensity={0} />
      <CameraHud>
        <mesh ref={num} material={material} position={[0, 0.1, 0]} renderOrder={20} visible={false}>
          <planeGeometry args={[1.5, 1.5]} />
        </mesh>
      </CameraHud>
    </>
  );
}

/** 정답 모으기 마지막 하나: 뒤집히며 떨어지는 금빛 현수막 + 무대를 훑는 탐조등 + 바닥 충격파. */
function LastOneFx({ on, span }: { on: boolean; span: number }) {
  const banner = useRef<THREE.Mesh>(null);
  const beams = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const st = useRef<{ born: number | null; level: number }>({ born: null, level: 0 });
  const bannerMat = useMemo(() => new THREE.MeshBasicMaterial({ map: lastOneTexture(), transparent: true, opacity: 0, depthTest: false, depthWrite: false, side: THREE.DoubleSide }), []);
  const beamMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#fde68a", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), []);
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#facc15", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }), []);
  const edge = span / 2 + 1.6;

  useFrame((frame, delta) => {
    const now = frame.clock.elapsedTime;
    const a = st.current;
    if (on && a.born === null) a.born = now;
    if (!on) a.born = null;
    a.level += ((on ? 1 : 0) - a.level) * Math.min(1, delta * (on ? 6 : 4));
    const k = a.born === null ? 99 : now - a.born;

    const b = banner.current;
    if (b) {
      b.visible = a.level > 0.02;
      const drop = Math.min(1, k / 0.75);
      b.position.y = 1.45 + (1 - bounce(drop)) * 2.6 + Math.sin(now * 2.4) * 0.05;
      b.rotation.y = (1 - easeOut(Math.min(1, k / 0.6))) * Math.PI * 2;
      b.rotation.z = Math.sin(now * 1.7) * 0.025;
      b.scale.setScalar(1 + Math.sin(now * 5) * 0.03);
      (b.material as THREE.MeshBasicMaterial).opacity = a.level;
    }

    const g = beams.current;
    if (g) {
      g.visible = a.level > 0.02;
      g.children.forEach((pivot, i) => {
        const dir = i === 0 ? 1 : -1;
        pivot.rotation.z = dir * (0.35 + Math.sin(now * 0.9 + i * 2.1) * 0.32);
        pivot.rotation.x = Math.sin(now * 0.7 + i) * 0.15;
        const mesh = pivot.children[0] as THREE.Mesh;
        (mesh.material as THREE.MeshBasicMaterial).opacity = a.level * (0.13 + Math.sin(now * 3 + i) * 0.03);
      });
    }

    const r = ring.current;
    if (r) {
      const t = Math.min(1, k / 1.3);
      r.visible = t < 1;
      r.scale.setScalar(0.5 + easeOut(t) * (edge + 1));
      (r.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.85;
    }
  });

  return (
    <>
      <CameraHud>
        <mesh ref={banner} material={bannerMat} renderOrder={21} visible={false}>
          <planeGeometry args={[3.4, 0.85]} />
        </mesh>
      </CameraHud>
      <group ref={beams} visible={false}>
        {[-1, 1].map((side) => (
          <group key={side} position={[side * edge, 10, -2.5]}>
            {/* 원뿔 꼭짓점을 피벗에 맞춰 아래로 늘어뜨린다 */}
            <mesh material={beamMat} position={[0, -6, 0]}>
              <coneGeometry args={[1.7, 12, 24, 1, true]} />
            </mesh>
          </group>
        ))}
      </group>
      <mesh ref={ring} material={ringMat} position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.85, 1, 64]} />
      </mesh>
    </>
  );
}

/* ── 장면 ─────────────────────────────────────────────────── */

export default function Tower3D({
  towers,
  hurrySec = null,
  lastOne = false,
}: {
  towers: TowerView[];
  /** 쌓기 마지막 10초의 남은 초(아니면 null). */
  hurrySec?: number | null;
  /** 정답 모으기에서 남은 정답이 하나. */
  lastOne?: boolean;
}) {
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
      <CameraRig span={span} maxTop={maxTop} shake={hurrySec !== null && hurrySec <= 5 ? 0.004 + (5 - hurrySec) * 0.0012 : 0} />
      {/* 연출은 CameraRig 뒤 — 카메라가 움직인 뒤의 위치를 같은 프레임에 따라가도록 */}
      <HurryFx sec={hurrySec} />
      <LastOneFx on={lastOne} span={span} />
    </Canvas>
  );
}
