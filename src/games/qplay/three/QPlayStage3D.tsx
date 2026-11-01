"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { resolveLook } from "@/games/shared/three/SeatedPerson";
import ScreenSprite from "@/games/shared/three/ScreenSprite";
import { AdaptiveResolution } from "@/games/shared/three/sceneFx";
import { labelTexture } from "@/games/shared/three/tableKit";
import { roomCharacterOf, useRoomCharacters } from "@/lib/character/roomCharacters";
import VrmFighter, { type FighterPose } from "@/games/playDead/three/VrmFighter";
import { CLIMB_TOP, MISSILE_HP, currentMini, currentQuestion, eligibleSeats, hasFinished, type GameState, type Seat } from "../engine";

/**
 * 큐플레이 무대 3D — 원탁을 떠나 미니 게임마다 진짜 쇼 무대에 선 VRM 캐릭터들.
 *
 * - 🧗 올라올라: 자리마다 10층 탑. 맞히면 한 층 위로 폴짝 뛰어오르고, 틀리면 한 층 아래로
 *   미끄러지며 휘청인다. 꼭대기에 닿으면 깃발 아래서 만세.
 * - 🚀 미사일: 반원으로 늘어선 받침대 = 하트(3칸). 사수가 손을 뻗으면 미사일이 날아가 터지고,
 *   맞은 사람의 받침대가 한 칸 내려앉는다. 하트 0이면 바닥으로 쓰러진다.
 * - ⭕ OX: 왼쪽 ⭕ / 오른쪽 ❌ 광장을 캐릭터가 실제로 달려 다닌다. 내 캐릭터는 광장을 눌러/끌어
 *   옮기고(입력·판정은 OxArena가 그대로), 공개 때 오답 쪽 바닥이 꺼지며 쓰러진다.
 *
 * 숨은 정보는 없다(누가 어느 쪽에 섰는지·하트·층은 모두 공개 정보).
 */

export interface QPlayStage3DProps {
  state: GameState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  colors: readonly string[];
  lowDetail: boolean;
  /** 미사일: 내가 사수일 때 상대를 눌러 발사. */
  onFire?: ((target: Seat) => void) | null;
  /** OX: 내 화면의 쪽(로컬 선택 포함)과 광장 위 자유 위치(광장 %), 공개 여부. */
  ox?: { picked: number | null; myPos: { x: number; y: number } | null; reveal: boolean; ghostMe: boolean };
}

const H = 0.42; // 올라올라 한 층 높이
const SEG = 0.3; // 미사일 받침대 하트 한 칸 높이
const PAD_BASE = 0.14;

const ORIGIN = new THREE.Vector3();

const shortName = (name: string) => name.replace(/^🤖\s*/, "").replace(/^\[Lv\.\d+\]\s*/, "").replace(/^AI\s*/, "");

// ---------------------------------------------------------------------------
// 공용 조각

/** 값이 바뀌면 `ms` 동안만 true — 휘청·만세 같은 짧은 자세용. */
function useBlip(key: string | number | null, ms: number): boolean {
  const [initial] = useState(key);
  const [expired, setExpired] = useState<string | number | null>(null);
  useEffect(() => {
    if (key === null) return;
    const id = setTimeout(() => setExpired(key), ms);
    return () => clearTimeout(id);
  }, [key, ms]);
  return key !== null && key !== initial && expired !== key;
}

/** 떠오르며 사라지는 글자(⬆️ +1층 / ❌ 미끄러짐 / 💥 −1 …). key가 바뀔 때마다 다시. */
function RiseText({ text, color, y }: { text: string; color: string; y: number }) {
  const ref = useRef<THREE.Sprite>(null);
  const start = useRef<number | null>(null);
  const map = useMemo(() => labelTexture(text, color, { bg: "rgba(10,15,40,0.85)", fg: color }), [text, color]);
  useFrame(({ clock }) => {
    const s = ref.current;
    if (!s) return;
    start.current ??= clock.elapsedTime;
    const e = clock.elapsedTime - start.current;
    s.visible = e < 1.3;
    s.position.y = y + Math.min(1, e) * 0.55;
    const k = e < 0.12 ? 0.6 + e * 3.3 : 1;
    s.scale.set(0.9 * k, 0.225 * k, 1);
    s.material.opacity = e > 0.9 ? Math.max(0, 1 - (e - 0.9) / 0.4) : 1;
  });
  return (
    <sprite ref={ref} renderOrder={12}>
      <spriteMaterial map={map} transparent depthWrite={false} depthTest={false} />
    </sprite>
  );
}

/** 발밑 고리 — 나(호박색) / 조준 가능한 상대(깜빡임). */
function FootRing({ color, pulse = false, r = 0.5 }: { color: string; pulse?: boolean; r?: number }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.opacity = pulse ? 0.45 + Math.sin(clock.elapsedTime * 6) * 0.35 : 0.85;
  });
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={0.03}>
      <ringGeometry args={[r, r + 0.12, 32]} />
      <meshBasicMaterial ref={mat} color={color} transparent opacity={0.85} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

function NameTag({ text, sub, color, me, y }: { text: string; sub?: string | null; color: string; me: boolean; y: number }) {
  return (
    <>
      <ScreenSprite position={[0, y, 0]} anchorY={y - 0.3} scale={[0.5, 0.125]} map={labelTexture(me ? `${text} (나)` : text, me ? "#fbbf24" : color)} />
      {sub && <ScreenSprite position={[0, y + 0.15, 0]} anchorY={y - 0.3} scale={[0.5, 0.125]} map={labelTexture(sub, "#e2e8f0", { bg: "rgba(10,15,40,0.82)", fg: "#f1f5f9" })} />}
    </>
  );
}

/** 높이를 부드럽게 따라가는 받침 — 올라갈 땐 폴짝(포물선), 내려갈 땐 툭 떨어진다. */
function Lift({ y, hop = 0.4, children }: { y: number; hop?: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const anim = useRef<{ from: number; to: number; t0: number } | null>(null);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const t = clock.elapsedTime;
    if (!anim.current) anim.current = { from: y, to: y, t0: t };
    const a = anim.current;
    if (a.to !== y) {
      a.from = g.position.y;
      a.to = y;
      a.t0 = t;
    }
    const up = a.to > a.from;
    const dur = up ? 0.45 : 0.35;
    const p = Math.min(1, (t - a.t0) / dur);
    const ease = up ? p : p * p;
    g.position.y = a.from + (a.to - a.from) * ease + (up ? Math.sin(p * Math.PI) * hop : 0);
  });
  return <group ref={ref}>{children}</group>;
}

function useLooks(state: GameState, names: Record<Seat, string>) {
  const chars = useRoomCharacters((st) => st.byName);
  const namesKey = Array.from({ length: state.seatCount }, (_, s) => names[s] ?? "").join("|");
  return useMemo(() => namesKey.split("|").map((name, seat) => resolveLook(seat, ["none"], roomCharacterOf(chars, name))), [namesKey, chars]);
}

const camLook = new THREE.Vector3();
const camWant = new THREE.Vector3();

/**
 * 폭(width)·높이(height)가 화면에 다 들어오게 카메라를 물린다. 첫 프레임은 바로, 이후엔 부드럽게
 * (올라올라에서 내 층을 따라 올라갈 때). OX는 대상이 안 바뀌어 첫 프레임 뒤로 고정 — 광장 % → 바닥 변환이 정확하다.
 */
function FitCamera({ width, height, look, from }: { width: number; height: number; look: [number, number, number]; from: [number, number] }) {
  const size = useThree((st) => st.size);
  const snapped = useRef(false);
  const cur = useRef(new THREE.Vector3());
  const [lx, ly, lz] = look;
  const [up, back] = from;
  useFrame(({ camera }, dt) => {
    const cam = camera as THREE.PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    const half = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const d = Math.max(width / (2 * half * aspect), height / (2 * half));
    const len = Math.hypot(up, back);
    camWant.set(lx, ly + (d * up) / len, lz + (d * back) / len);
    camLook.set(lx, ly, lz);
    if (!snapped.current) {
      snapped.current = true;
      cam.position.copy(camWant);
      cur.current.copy(camLook);
    } else {
      const k = 1 - Math.exp(-Math.min(dt, 0.05) * 4);
      cam.position.lerp(camWant, k);
      cur.current.lerp(camLook, k);
    }
    cam.lookAt(cur.current);
  });
  return null;
}

// ---------------------------------------------------------------------------
// 🧗 올라올라

/**
 * 탑 = 캐릭터 뒤의 벽(층마다 색 띠·발판 가로대) + 꼭대기 금색 발판·깃발. 층마다 발판을 쌓으면
 * 사람 키(1.6)보다 층 간격(0.42)이 좁아 몸을 뚫으므로, 발밑 발판은 캐릭터와 같이 움직인다(`Climber`).
 */
function Tower({ x, color, top }: { x: number; color: string; top: boolean }) {
  return (
    <group position-x={x}>
      <mesh position={[0, (CLIMB_TOP * H) / 2, -0.5]}>
        <boxGeometry args={[0.95, CLIMB_TOP * H + 0.1, 0.08]} />
        <meshStandardMaterial color="#1e293b" roughness={0.7} />
      </mesh>
      {Array.from({ length: CLIMB_TOP }, (_, i) => (
        <mesh key={i} position={[0, i * H + H / 2, -0.45]}>
          <boxGeometry args={[0.95, H - 0.04, 0.02]} />
          <meshStandardMaterial color={i % 2 ? color : "#e2e8f0"} roughness={0.6} />
        </mesh>
      ))}
      {/* 꼭대기 금색 발판 + 깃발 */}
      <mesh position={[0, CLIMB_TOP * H - 0.05, -0.1]}>
        <boxGeometry args={[0.95, 0.1, 0.9]} />
        <meshStandardMaterial color="#facc15" emissive="#facc15" emissiveIntensity={top ? 0.9 : 0.25} roughness={0.5} />
      </mesh>
      <group position={[0.38, CLIMB_TOP * H, -0.45]}>
        <mesh position-y={0.45}>
          <cylinderGeometry args={[0.015, 0.015, 0.9, 6]} />
          <meshStandardMaterial color="#e5e7eb" />
        </mesh>
        <mesh position={[0.14, 0.78, 0]}>
          <boxGeometry args={[0.28, 0.18, 0.01]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
}

function ClimbScene({ state, viewerSeat, names, colors, lowDetail }: QPlayStage3DProps) {
  const n = state.seatCount;
  const looks = useLooks(state, names);
  const gap = 1.25;
  const xs = useMemo(() => Array.from({ length: n }, (_, s) => (s - (n - 1) / 2) * gap), [n]);
  const homes = useMemo(() => xs.map((x) => new THREE.Vector3(x, 0, 0)), [xs]);
  const myFloor = state.floor[viewerSeat] ?? 0;
  const lookY = Math.min(CLIMB_TOP * H - 0.6, Math.max(1.5, myFloor * H + 0.9));
  const ended = state.phase === "miniEnd";
  return (
    <>
      <color attach="background" args={["#7cc4f0"]} />
      <fog attach="fog" args={["#7cc4f0", 14, 34]} />
      <hemisphereLight args={["#f0f9ff", "#4d7c0f", 0.9]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[4, 9, 6]} intensity={1.3} color="#fff7e0" />
      <mesh rotation-x={-Math.PI / 2} position-y={-0.001}>
        <circleGeometry args={[30, 40]} />
        <meshStandardMaterial color="#65a30d" roughness={1} />
      </mesh>
      {!lowDetail &&
        [-9, -4, 3, 8].map((x, i) => (
          <mesh key={i} position={[x, 6 + (i % 2) * 1.5, -9 - i]}>
            <sphereGeometry args={[1.4 + (i % 3) * 0.4, 14, 10]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.85} />
          </mesh>
        ))}
      {/* 층 표시(왼쪽 끝 한 줄) */}
      {[2, 4, 6, 8, CLIMB_TOP].map((f) => (
        <ScreenSprite key={f} position={[xs[0] - 0.75, f * H, -0.45]} scale={[0.22, 0.08]} map={labelTexture(f === CLIMB_TOP ? "🏁" : `${f}F`, "#0f172a", { bg: "rgba(255,255,255,0.85)", fg: "#0f172a" })} />
      ))}
      {xs.map((x, s) => (
        <Tower key={s} x={x} color={colors[s % colors.length]} top={state.floor[s] >= CLIMB_TOP} />
      ))}
      {homes.map((home, s) => (
        <Climber key={s} seat={s} home={home} state={state} me={s === viewerSeat} name={shortName(names[s] ?? `플레이어 ${s + 1}`)} look={looks[s]} color={colors[s % colors.length]} lowDetail={lowDetail} ended={ended} />
      ))}
      <FitCamera width={(n - 1) * gap + 2.6} height={6.2} look={[0, lookY, 0]} from={[0.35, 1]} />
      <AdaptiveResolution max={lowDetail ? 1.5 : 2} />
    </>
  );
}

function Climber({ seat, home, state, me, name, look, color, lowDetail, ended }: { seat: Seat; home: THREE.Vector3; state: GameState; me: boolean; name: string; look: ReturnType<typeof resolveLook>; color: string; lowDetail: boolean; ended: boolean }) {
  const floor = state.floor[seat] ?? 0;
  const tries = state.climbIdx[seat] ?? 0;
  const last = state.lastClimb[seat];
  const top = floor >= CLIMB_TOP;
  const place = state.finishOrder.indexOf(seat);
  const slip = useBlip(last === false ? tries : null, 900);
  const pose: FighterPose = top || (ended && place === 0) ? "win" : slip ? "block" : "idle";
  const medal = place === 0 ? "🥇" : place === 1 ? "🥈" : place === 2 ? "🥉" : place >= 0 ? "🏁" : "";
  return (
    <group position={[home.x, 0, 0]}>
      <Lift y={floor * H}>
        {!top && (
          <mesh position={[0, -0.05, -0.1]}>
            <boxGeometry args={[0.8, 0.1, 0.7]} />
            <meshStandardMaterial color={color} roughness={0.5} />
          </mesh>
        )}
        <VrmFighter look={look} seed={seat * 7 + 1} home={ORIGIN} facing={0} pose={pose} poseKey={`${pose}-${tries}`} moveTo={null} aimAt={null} out={false} lowDetail={lowDetail}>
          {me && <FootRing color="#fbbf24" r={0.36} />}
          <NameTag text={name} sub={`${medal}${top ? " 도착!" : `${floor}층`}`} color={color} me={me} y={2.0} />
          {tries > 0 && <RiseText key={tries} text={last ? "⬆️ +1층" : "❌ 미끄러짐"} color={last ? "#4ade80" : "#f87171"} y={2.45} />}
        </VrmFighter>
      </Lift>
    </group>
  );
}

// ---------------------------------------------------------------------------
// 🚀 미사일

function padSpot(seat: Seat, n: number): THREE.Vector3 {
  // 카메라를 향해 오목한 반원 — 누가 누구를 쏘는지 한눈에
  const span = Math.min(Math.PI * 0.85, 0.5 * (n - 1) + 0.3);
  const a = n === 1 ? 0 : -span / 2 + (span * seat) / (n - 1);
  const r = 3.4 + Math.max(0, n - 5) * 0.35;
  return new THREE.Vector3(Math.sin(a) * r, 0, -Math.cos(a) * r + r * 0.55);
}

function Pedestal({ hp, color, out }: { hp: number; color: string; out: boolean }) {
  return (
    <group>
      <mesh position-y={PAD_BASE / 2}>
        <cylinderGeometry args={[0.55, 0.62, PAD_BASE, 24]} />
        <meshStandardMaterial color="#1e293b" metalness={0.5} roughness={0.4} />
      </mesh>
      {Array.from({ length: MISSILE_HP }, (_, i) => (
        <SegmentBlock key={i} index={i} on={i < hp} color={color} out={out} />
      ))}
    </group>
  );
}

/** 하트 한 칸 — 잃으면 아래로 꺼지며 사라진다. */
function SegmentBlock({ index, on, color, out }: { index: number; on: boolean; color: string; out: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    const m = ref.current;
    if (!m) return;
    const want = on ? 1 : 0;
    const cur = m.scale.y + (want - m.scale.y) * (1 - Math.exp(-dt * 9));
    m.scale.set(0.6 + cur * 0.4, Math.max(0.001, cur), 0.6 + cur * 0.4);
    m.visible = cur > 0.02;
    m.position.y = PAD_BASE + index * SEG * cur + (SEG * cur) / 2;
  });
  return (
    <mesh ref={ref} position-y={PAD_BASE + index * SEG + SEG / 2}>
      <cylinderGeometry args={[0.46, 0.5, SEG - 0.03, 24]} />
      <meshStandardMaterial color={out ? "#475569" : color} emissive={color} emissiveIntensity={out ? 0 : 0.18} roughness={0.45} />
    </mesh>
  );
}

const tmpA = new THREE.Vector3();

/** 사수 → 표적. 포물선 비행 + 불꽃 꼬리, 도착하면 폭발. `dur`초 뒤 충돌. */
function Rocket({ from, to, kill, dur }: { from: THREE.Vector3; to: THREE.Vector3; kill: boolean; dur: number }) {
  const body = useRef<THREE.Group>(null);
  const boom = useRef<THREE.Mesh>(null);
  const boomMat = useRef<THREE.MeshBasicMaterial>(null);
  const ring = useRef<THREE.Mesh>(null);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);
  const start = useRef<number | null>(null);
  const arc = 1.6 + from.distanceTo(to) * 0.2;
  const at = (p: number, out: THREE.Vector3) => out.lerpVectors(from, to, p).setY(from.y + (to.y - from.y) * p + Math.sin(p * Math.PI) * arc);
  useFrame(({ clock }) => {
    start.current ??= clock.elapsedTime;
    const e = clock.elapsedTime - start.current;
    const p = Math.min(1, e / dur);
    const g = body.current;
    if (g) {
      g.visible = p < 1;
      at(p, g.position);
      at(Math.min(1, p + 0.02), tmpA);
      g.lookAt(tmpA);
    }
    const b = Math.max(0, e - dur);
    if (boom.current && boomMat.current) {
      boom.current.visible = e >= dur && b < 0.7;
      boom.current.scale.setScalar((kill ? 1.5 : 1) * (0.3 + b * 2.2));
      boomMat.current.opacity = Math.max(0, 0.95 * (1 - b / 0.7));
    }
    if (ring.current && ringMat.current) {
      ring.current.visible = e >= dur && b < 1;
      ring.current.scale.setScalar(0.4 + b * 3.2);
      ringMat.current.opacity = Math.max(0, 0.8 * (1 - b));
    }
  });
  return (
    <>
      <group ref={body} visible={false}>
        {/* 로켓은 +z를 향해 날아간다(lookAt) */}
        <mesh rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.07, 0.07, 0.42, 12]} />
          <meshStandardMaterial color="#f8fafc" metalness={0.3} roughness={0.35} />
        </mesh>
        <mesh position-z={0.29} rotation-x={Math.PI / 2}>
          <coneGeometry args={[0.07, 0.16, 12]} />
          <meshStandardMaterial color="#ef4444" />
        </mesh>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} position-z={-0.16} rotation-z={(i * Math.PI) / 2}>
            <boxGeometry args={[0.24, 0.015, 0.1]} />
            <meshStandardMaterial color="#ef4444" />
          </mesh>
        ))}
        <mesh position-z={-0.3}>
          <sphereGeometry args={[0.1, 10, 8]} />
          <meshBasicMaterial color="#fb923c" transparent opacity={0.85} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh position-z={-0.48} scale={[1, 1, 2.2]}>
          <sphereGeometry args={[0.08, 10, 8]} />
          <meshBasicMaterial color="#fde047" transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
      <mesh ref={boom} position={to.toArray()} visible={false}>
        <sphereGeometry args={[0.5, 16, 12]} />
        <meshBasicMaterial ref={boomMat} color={kill ? "#ef4444" : "#fb923c"} transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={ring} position={[to.x, 0.05, to.z]} rotation-x={-Math.PI / 2} visible={false}>
        <ringGeometry args={[0.45, 0.6, 32]} />
        <meshBasicMaterial ref={ringMat} color="#fdba74" transparent side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
    </>
  );
}

const ROCKET_DUR = 0.95;

function MissileScene({ state, viewerSeat, names, colors, lowDetail, onFire }: QPlayStage3DProps) {
  const n = state.seatCount;
  const looks = useLooks(state, names);
  const spots = useMemo(() => Array.from({ length: n }, (_, s) => padSpot(s, n)), [n]);
  const centre = useMemo(() => new THREE.Vector3(0, 0, spots.reduce((m, p) => Math.max(m, p.z), -Infinity) + 1), [spots]);
  const phase = state.phase;
  const shot = phase === "reveal" ? state.shot : null;
  // 맞은 사람의 받침대는 미사일이 닿는 순간 한 칸 내려앉는다
  const [landed, setLanded] = useState<number | null>(null);
  useEffect(() => {
    if (!shot) return;
    const id = setTimeout(() => setLanded(state.stage), ROCKET_DUR * 1000);
    return () => clearTimeout(id);
  }, [shot, state.stage]);
  const impact = !!shot && landed === state.stage;
  const q = currentQuestion(state);
  const eligible = new Set(eligibleSeats(state));
  const aiming = phase === "aim" && state.shooter === viewerSeat && !!onFire;
  const xs = spots.map((p) => p.x);
  const span = Math.max(...xs) - Math.min(...xs);

  return (
    <>
      <color attach="background" args={["#1a1033"]} />
      <fog attach="fog" args={["#1a1033", 12, 30]} />
      <hemisphereLight args={["#c4b5fd", "#1e1b4b", 0.7]} />
      <ambientLight intensity={0.3} />
      <directionalLight position={[-5, 9, 6]} intensity={1.2} color="#fde68a" />
      <pointLight position={[0, 4, 0]} intensity={18} distance={14} color="#fb923c" />
      <mesh rotation-x={-Math.PI / 2}>
        <circleGeometry args={[16, 48]} />
        <meshStandardMaterial color="#27213f" roughness={0.9} />
      </mesh>
      {!lowDetail && (
        <mesh rotation-x={-Math.PI / 2} position-y={0.005}>
          <ringGeometry args={[1.0, 1.08, 48]} />
          <meshBasicMaterial color="#fb923c" transparent opacity={0.5} toneMapped={false} />
        </mesh>
      )}
      {spots.map((spot, s) => {
        const alive = state.alive[s];
        const out = !alive && phase !== "intro" && phase !== "miniEnd";
        // 공개 중 맞은 사람: 충돌 전엔 잃기 전 하트로
        const hp = shot?.to === s && !impact ? Math.min(MISSILE_HP, state.hp[s] + 1) : state.hp[s];
        const a = state.answers[s];
        let pose: FighterPose = "idle";
        let sub: string | null = "❤️".repeat(Math.max(0, state.hp[s])) + "🖤".repeat(Math.max(0, MISSILE_HP - state.hp[s]));
        if (shot?.to === s && !impact) sub = "❤️".repeat(hp) + "🖤".repeat(Math.max(0, MISSILE_HP - hp));
        let aimAt: THREE.Vector3 | null = null;
        if (phase === "question" && eligible.has(s) && q && hasFinished(state, s)) sub = `✔️ 답변 완료 · ${sub}`;
        if (phase === "aim") {
          if (state.shooter === s) {
            pose = "charge";
            sub = "🚀 조준 중";
          } else if (alive) pose = "block";
        }
        if (shot) {
          if (shot.from === s) {
            pose = "jangpung";
            aimAt = spots[shot.to];
          } else if (shot.to === s) {
            pose = impact && shot.kill ? "hit" : "block";
            aimAt = spots[shot.from];
          } else if (a?.correct) pose = "idle";
        }
        if (phase === "miniEnd" && alive) pose = "win";
        if (out && !(shot?.to === s)) pose = "down";
        const fireable = aiming && s !== viewerSeat && alive;
        const color = colors[s % colors.length];
        const lift = PAD_BASE + Math.max(0, hp) * SEG;
        return (
          <group key={s} position={spot}>
            <Pedestal hp={hp} color={color} out={out} />
            <Lift y={out && pose === "down" ? 0 : lift} hop={0}>
              <VrmFighter
                look={looks[s]}
                seed={s * 5 + 3}
                home={ORIGIN}
                facing={Math.atan2(centre.x - spot.x, centre.z - spot.z)}
                pose={pose}
                poseKey={`${pose}-${state.stage}-${impact}`}
                moveTo={null}
                aimAt={aimAt ? tmpLocal(aimAt, spot) : null}
                out={out}
                lowDetail={lowDetail}
                onPick={fireable ? () => onFire!(s) : undefined}
              >
                {s === viewerSeat && <FootRing color="#fbbf24" r={0.42} />}
                {fireable && <FootRing color="#fb923c" pulse r={0.55} />}
                <NameTag text={shortName(names[s] ?? `플레이어 ${s + 1}`)} sub={fireable ? `🎯 ${state.hp[s] === 1 ? "격추 가능!" : "눌러서 발사"}` : out ? "💀 탈락" : sub} color={color} me={s === viewerSeat} y={pose === "down" ? 0.9 : 2.0} />
                {shot?.to === s && impact && <RiseText text={shot.kill ? "💥 격추!" : "💥 하트 −1"} color="#fca5a5" y={2.4} />}
                {phase === "reveal" && state.gained[s] > 0 && <RiseText key={`g${state.stage}`} text={`+${state.gained[s]}`} color="#4ade80" y={2.6} />}
              </VrmFighter>
            </Lift>
          </group>
        );
      })}
      {shot && (
        <Rocket
          key={state.stage}
          from={spots[shot.from].clone().setY(PAD_BASE + state.hp[shot.from] * SEG + 1.3)}
          to={spots[shot.to].clone().setY(PAD_BASE + Math.min(MISSILE_HP, state.hp[shot.to] + 1) * SEG + 1.0)}
          kill={shot.kill}
          dur={ROCKET_DUR}
        />
      )}
      <FitCamera width={span + 2.4} height={5.4} look={[0, 1.25, centre.z - 2.2]} from={[0.55, 1]} />
      <AdaptiveResolution max={lowDetail ? 1.5 : 2} />
    </>
  );
}

/** 받침대 그룹 안 좌표로(VrmFighter는 부모 기준으로 방향을 잰다). */
function tmpLocal(world: THREE.Vector3, origin: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(world.x - origin.x, 0, world.z - origin.z);
}

// ---------------------------------------------------------------------------
// ⭕ OX 광장

const PLAZA_W = 7.6;
const PLAZA_D = 5.4;
const ZONE_X = [
  [-2.95, -1.75],
  [1.75, 2.95],
];
const LANE_X = [-0.55, 0.55];
const ROW_Z = [-1.95, -0.65, 0.65, 1.95];

export function oxSpot(seat: Seat, zone: number | null): THREE.Vector3 {
  const col = seat % 2;
  const z = ROW_Z[Math.floor(seat / 2) % ROW_Z.length];
  return new THREE.Vector3(zone === null ? LANE_X[col] : ZONE_X[zone][col], 0, z);
}

/** 광장 % 좌표(OxArena) → 바닥 위 점. 카메라가 좌우 대칭이라 화면 가운데 = 가운데 선. */
function useGroundPoint() {
  const { camera } = useThree();
  return useMemo(() => {
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const ndc = new THREE.Vector2();
    return (pos: { x: number; y: number }) => {
      ndc.set((pos.x / 100) * 2 - 1, 1 - (pos.y / 100) * 2);
      ray.setFromCamera(ndc, camera);
      const hit = new THREE.Vector3();
      if (!ray.ray.intersectPlane(plane, hit)) return null;
      hit.x = THREE.MathUtils.clamp(hit.x, -PLAZA_W / 2 + 0.35, PLAZA_W / 2 - 0.35);
      hit.z = THREE.MathUtils.clamp(hit.z, -PLAZA_D / 2 + 0.3, PLAZA_D / 2 - 0.3);
      // 선 위에 서지 않게 — 화면에서 고른 쪽 안으로
      if (Math.abs(hit.x) < 0.25) hit.x = pos.x < 50 ? -0.25 : 0.25;
      return hit;
    };
  }, [camera]);
}

function ZoneFloor({ zone, reveal, answer }: { zone: number; reveal: boolean; answer: number }) {
  const ref = useRef<THREE.Group>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const wrong = reveal && zone !== answer;
  const right = reveal && zone === answer;
  const base = zone === 0 ? "#0ea5e9" : "#f43f5e";
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    // 오답 쪽 바닥은 살짝 꺼진다
    g.position.y += ((wrong ? -0.18 : 0) - g.position.y) * (1 - Math.exp(-dt * 6));
  });
  const x = zone === 0 ? -PLAZA_W / 4 : PLAZA_W / 4;
  const color = right ? "#22c55e" : wrong ? "#475569" : base;
  return (
    <group ref={ref} position-x={x}>
      <mesh position-y={-0.06}>
        <boxGeometry args={[PLAZA_W / 2 - 0.06, 0.12, PLAZA_D]} />
        <meshStandardMaterial ref={mat} color={color} emissive={color} emissiveIntensity={right ? 0.35 : 0.12} roughness={0.6} />
      </mesh>
      {/* 바닥 글자 ⭕ / ❌ — 색이 아니라 모양으로도 구분 */}
      {zone === 0 ? (
        <mesh rotation-x={-Math.PI / 2} position-y={0.006}>
          <ringGeometry args={[1.05, 1.45, 48]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={wrong ? 0.15 : 0.5} depthWrite={false} />
        </mesh>
      ) : (
        [1, -1].map((k) => (
          <mesh key={k} rotation={[-Math.PI / 2, 0, (k * Math.PI) / 4]} position-y={0.006}>
            <planeGeometry args={[3.0, 0.4]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={wrong ? 0.15 : 0.5} depthWrite={false} />
          </mesh>
        ))
      )}
      {/* 오답 쪽 빗금 — 색각 이상이어도 보이게 */}
      {wrong &&
        Array.from({ length: 7 }, (_, i) => (
          <mesh key={i} rotation-x={-Math.PI / 2} position={[-1.5 + i * 0.5, 0.008, 0]}>
            <planeGeometry args={[0.12, PLAZA_D - 0.2]} />
            <meshBasicMaterial color="#0f172a" transparent opacity={0.45} depthWrite={false} />
          </mesh>
        ))}
    </group>
  );
}

function OxScene({ state, viewerSeat, names, colors, lowDetail, ox }: QPlayStage3DProps) {
  const n = state.seatCount;
  const looks = useLooks(state, names);
  const ground = useGroundPoint();
  const reveal = !!ox?.reveal;
  const q = currentQuestion(state);
  const answer = q?.answer ?? -1;
  const alive = new Set(eligibleSeats(state));
  const ghosts = state.ghosts ?? {};
  const isGhost = (s: Seat) => !alive.has(s) && !state.eliminated.includes(s);
  const centre = useMemo(() => new THREE.Vector3(0, 0, 0), []);
  // 내 자유 위치: 광장 % → 바닥 점(카메라가 정해진 뒤 계산되므로 매 렌더 다시)
  const myFree = ox?.myPos && !reveal ? ground(ox.myPos) : null;
  return (
    <>
      <color attach="background" args={["#0b1030"]} />
      <fog attach="fog" args={["#0b1030", 12, 26]} />
      <hemisphereLight args={["#bfdbfe", "#0b1026", 0.75]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 9, 7]} intensity={1.25} color="#fefce8" />
      <mesh rotation-x={-Math.PI / 2} position-y={-0.13}>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color="#111843" roughness={1} />
      </mesh>
      <ZoneFloor zone={0} reveal={reveal} answer={answer} />
      <ZoneFloor zone={1} reveal={reveal} answer={answer} />
      {/* 가운데 점선 */}
      {Array.from({ length: 9 }, (_, i) => (
        <mesh key={i} rotation-x={-Math.PI / 2} position={[0, 0.01, -PLAZA_D / 2 + 0.3 + i * 0.6]}>
          <planeGeometry args={[0.1, 0.34]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      ))}
      {Array.from({ length: n }, (_, s) => {
        const me = s === viewerSeat;
        const ghost = isGhost(s);
        const zone = me ? (ox?.picked ?? null) : ghost ? (ghosts[s] ?? null) : (state.answers[s]?.choice ?? null);
        const target = me && myFree ? myFree : oxSpot(s, zone);
        const dead = reveal && state.eliminated.includes(s);
        const ok = reveal && !ghost && alive.has(s) && zone === answer;
        const pose: FighterPose = dead ? "hit" : ok ? "win" : "idle";
        const color = colors[s % colors.length];
        const tag = ghost && reveal && ghosts[s] !== undefined ? (ghosts[s] === answer ? "✨ 예측 적중" : "💨 빗나감") : ghost ? `👻 ${(state.ghostHits?.[s] ?? 0)}/${state.ghostTries?.[s] ?? 0}` : dead ? "💀 탈락" : null;
        return (
          <group key={s}>
            <group position-y={ghost ? 0.35 : 0}>
              <VrmFighter
                look={looks[s]}
                seed={s * 3 + 2}
                home={centre}
                facing={0}
                pose={pose}
                poseKey={`${pose}-${state.stage}`}
                moveTo={target}
                aimAt={null}
                out={ghost || dead}
                speed={4.6}
                lowDetail={lowDetail}
              >
                {ghost && <GhostBob />}
                {me && <FootRing color="#fbbf24" r={0.36} />}
                <NameTag text={me ? "나" : shortName(names[s] ?? `플레이어 ${s + 1}`)} sub={tag} color={color} me={false} y={dead ? 0.9 : 2.0} />
              </VrmFighter>
            </group>
          </group>
        );
      })}
      <FitCamera width={PLAZA_W + 0.2} height={PLAZA_D} look={[0, 0.3, 0.2]} from={[1.2, 1]} />
      <AdaptiveResolution max={lowDetail ? 1.5 : 2} />
    </>
  );
}

/** 유령 표시 — 머리 위 👻가 둥실. */
function GhostBob() {
  const ref = useRef<THREE.Group>(null);
  const map = useMemo(() => labelTexture("👻", "#c4b5fd", { bg: "rgba(0,0,0,0)", fg: "#ffffff" }), []);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.y = 1.85 + Math.sin(clock.elapsedTime * 2.6) * 0.08;
  });
  return (
    <group ref={ref}>
      <sprite scale={[0.5, 0.125, 1]} position-x={0.42}>
        <spriteMaterial map={map} transparent depthWrite={false} />
      </sprite>
    </group>
  );
}

// ---------------------------------------------------------------------------

function Scene(props: QPlayStage3DProps) {
  const mini = currentMini(props.state);
  if (mini === "climb") return <ClimbScene {...props} />;
  if (mini === "missile") return <MissileScene {...props} />;
  return <OxScene {...props} />;
}

export default function QPlayStage3D(props: QPlayStage3DProps) {
  return (
    <Canvas
      dpr={props.lowDetail ? [1, 1.5] : [1, 2]}
      gl={{ antialias: !props.lowDetail, powerPreference: "high-performance" }}
      camera={{ fov: 42, position: [0, 5, 9], near: 0.1, far: 90 }}
      style={{ touchAction: props.ox ? "none" : "pan-y" }}
    >
      <Scene {...props} />
    </Canvas>
  );
}
