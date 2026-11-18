"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { resolveLook } from "@/games/shared/three/SeatedPerson";
import { roomCharacterOf, useRoomCharacters } from "@/lib/character/roomCharacters";
import { AdaptiveResolution } from "@/games/shared/three/sceneFx";
import { CROWN_DROP_MS, ITEM_INFO, SEAT_COLORS, TEAM_INFO } from "../data";
import { arenaFor, inBush, type ArenaGeo } from "../arena";
import type { SnapBuffer } from "../net";
import { crownOn, type MatchState, type PlayerState } from "../sim";
import CrownModel from "./CrownModel";
import { FxLayer, type FxItem } from "./Fx";
import Runner, { type RunnerFrame, type RunnerMode } from "./Runner";

/**
 * 왕관 도둑 3D 무대 (룰북 §11): 구름 위에 뜬 둥근 왕궁 안뜰. 돌바닥(동심원 무늬) + 금 테두리,
 * 대리석 기둥, 둥근 덤불, 빛나는 점프대(짝꿍 쪽 화살표), 바닥 왕관(빛기둥·회전), 첫 왕관 낙하 그림자,
 * 아이템·바나나 껍질, VRM 캐릭터(머리 위 왕관), 연출, 따라가는 카메라.
 * 이름표는 DOM(보드)이 그리고 여기서는 매 프레임 화면 좌표만 계산해 옮긴다.
 * 덤불 속 사람(나·왕관 쓴 사람 제외)은 이름표를 숨긴다 — 몸은 덤불이 가린다.
 */

export interface SceneShared {
  buf: SnapBuffer;
  mySeat: number;
  /** 화면 흔들림 세기 (0~1, 보드가 올리고 여기서 줄인다) */
  shake: number;
  /** 이름표 DOM (자리 순서) */
  labels: (HTMLDivElement | null)[];
}

export interface ArenaSceneProps {
  shared: MutableRefObject<SceneShared>;
  names: Record<number, string>;
  seatCount: number;
  quality: "high" | "low";
  fx: FxItem[];
  onFps?: (fps: number) => void;
}

/* ── 하늘·구름 ─────────────────────────────────────────────────────── */

function skyTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#2b6cd6");
  grad.addColorStop(0.45, "#6fb0ff");
  grad.addColorStop(0.62, "#cfe6ff");
  grad.addColorStop(0.75, "#ffe9c7");
  grad.addColorStop(1, "#ffd9a8");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function Sky() {
  const tex = useMemo(() => skyTexture(), []);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <group>
      <mesh>
        <sphereGeometry args={[160, 24, 16]} />
        <meshBasicMaterial map={tex} side={THREE.BackSide} fog={false} depthWrite={false} />
      </mesh>
      {/* 해 */}
      <mesh position={[60, 55, -90]}>
        <sphereGeometry args={[7, 24, 16]} />
        <meshBasicMaterial color="#fff7d1" fog={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** 광장 아래·둘레 구름 바다 (천천히 흘러감) */
function Clouds({ radius, quality }: { radius: number; quality: "high" | "low" }) {
  const group = useRef<THREE.Group>(null);
  const puffs = useMemo(() => {
    const n = quality === "high" ? 70 : 34;
    return Array.from({ length: n }, (_, i) => {
      const a = i * 2.399963;
      const r = radius * 0.6 + ((i * 37) % 23) * 1.6;
      return { x: Math.cos(a) * r, z: Math.sin(a) * r, y: -7 - ((i * 13) % 7) * 0.8, s: 3 + ((i * 7) % 5) * 1.1 };
    });
  }, [radius, quality]);
  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += Math.min(dt, 0.05) * 0.01;
  });
  return (
    <group ref={group}>
      {puffs.map((p, i) => (
        <mesh key={i} position={[p.x, p.y, p.z]} scale={[p.s * 1.6, p.s * 0.7, p.s * 1.3]}>
          <sphereGeometry args={[1, 12, 8]} />
          <meshStandardMaterial color="#ffffff" roughness={1} transparent opacity={0.92} />
        </mesh>
      ))}
    </group>
  );
}

/* ── 광장 ───────────────────────────────────────────────────────────── */

function floorTexture(): THREE.Texture {
  // 1024px · 굵고 옅은 줄눈 — 얇은 방사선은 비스듬한 카메라에서 물결무늬(모아레)가 생겨서 피한다
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  const g = c.getContext("2d")!;
  const m = 512;
  g.fillStyle = "#e9dcc3";
  g.fillRect(0, 0, 1024, 1024);
  // 동심원 돌 고리 (고리마다 살짝 다른 색)
  for (let r = 9; r >= 0; r--) {
    g.beginPath();
    g.arc(m, m, 52 + r * 48, 0, Math.PI * 2);
    g.fillStyle = r % 2 ? "#e6d7bc" : "#eadfc8";
    g.fill();
    g.strokeStyle = "rgba(140,110,80,0.22)";
    g.lineWidth = 6;
    g.stroke();
  }
  // 방사형 줄눈은 12개만, 굵고 옅게
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    g.beginPath();
    g.moveTo(m + Math.cos(a) * 52, m + Math.sin(a) * 52);
    g.lineTo(m + Math.cos(a) * 512, m + Math.sin(a) * 512);
    g.strokeStyle = "rgba(140,110,80,0.14)";
    g.lineWidth = 6;
    g.stroke();
  }
  // 가운데 왕관 문장
  g.fillStyle = "rgba(200,150,40,0.35)";
  g.beginPath();
  g.arc(m, m, 48, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function Plaza({ geo, quality }: { geo: ArenaGeo; quality: "high" | "low" }) {
  const tex = useMemo(() => floorTexture(), []);
  useEffect(() => () => tex.dispose(), [tex]);
  const R = geo.radius;
  return (
    <group>
      {/* 윗면 */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[R, 72]} />
        <meshStandardMaterial map={tex} roughness={0.85} />
      </mesh>
      {/* 금 테두리 (여기 밖은 낭떠러지) */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.01}>
        <ringGeometry args={[R - 0.32, R, 72]} />
        <meshStandardMaterial color="#d4a017" metalness={0.6} roughness={0.35} emissive="#7a5a00" emissiveIntensity={0.25} />
      </mesh>
      {/* 떠 있는 섬 바닥 (아래로 좁아지는 바위) */}
      {/* 윗면 뚜껑은 없음 — 바닥 원판과 같은 높이라 겹치면 깜빡이는 줄무늬(z-fighting)가 생긴다 */}
      <mesh position-y={-1.64}>
        <cylinderGeometry args={[R, R * 0.55, 3.2, 48, 1, true]} />
        <meshStandardMaterial color="#a08566" roughness={1} flatShading />
      </mesh>
      <mesh position-y={-4.2}>
        <coneGeometry args={[R * 0.55, 4, 32]} />
        <meshStandardMaterial color="#7c6448" roughness={1} flatShading />
      </mesh>
      {/* 기둥 */}
      {geo.pillars.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]}>
          <mesh position-y={1.5} castShadow={quality === "high"} receiveShadow>
            <cylinderGeometry args={[p.r * 0.85, p.r * 0.92, 3, 16]} />
            <meshStandardMaterial color="#f5f1e8" roughness={0.45} />
          </mesh>
          <mesh position-y={0.12}>
            <cylinderGeometry args={[p.r * 1.05, p.r * 1.1, 0.24, 16]} />
            <meshStandardMaterial color="#e7e0d0" roughness={0.5} />
          </mesh>
          <mesh position-y={3.08}>
            <boxGeometry args={[p.r * 2.1, 0.22, p.r * 2.1]} />
            <meshStandardMaterial color="#e7e0d0" roughness={0.5} />
          </mesh>
          <mesh position-y={3.26}>
            <sphereGeometry args={[0.18, 12, 8]} />
            <meshStandardMaterial color="#f5c542" metalness={0.7} roughness={0.3} />
          </mesh>
        </group>
      ))}
      {/* 덤불 */}
      {geo.bushes.map((b, i) => (
        <group key={i} position={[b.x, 0, b.z]}>
          {[0, 1, 2, 3, 4, 5].map((k) => {
            const a = (k / 6) * Math.PI * 2 + i;
            const rr = k === 0 ? 0 : b.r * 0.55;
            return (
              <mesh key={k} position={[Math.cos(a) * rr, 0.55 + (k === 0 ? 0.35 : 0), Math.sin(a) * rr]} scale={k === 0 ? 1.05 : 0.8} castShadow={quality === "high"}>
                <icosahedronGeometry args={[b.r * 0.62, 1]} />
                <meshStandardMaterial color={k % 2 ? "#3f8f46" : "#2f7a3b"} roughness={0.95} flatShading />
              </mesh>
            );
          })}
        </group>
      ))}
    </group>
  );
}

/** 점프대: 빛나는 원판 + 도는 고리 + 짝꿍 쪽 화살표 */
function Pads({ geo }: { geo: ArenaGeo }) {
  const rings = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    rings.current?.children.forEach((c, i) => {
      c.rotation.z = clock.elapsedTime * (i % 2 ? -2 : 2);
      c.position.y = 0.05 + Math.sin(clock.elapsedTime * 3 + i) * 0.02;
    });
  });
  return (
    <group>
      {geo.pads.map((p, i) => {
        const a = Math.atan2(p.tz - p.z, p.tx - p.x);
        return (
          <group key={i} position={[p.x, 0, p.z]}>
            <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
              <circleGeometry args={[p.r, 32]} />
              <meshStandardMaterial color="#22d3ee" emissive="#0891b2" emissiveIntensity={0.8} roughness={0.3} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, -a]} position-y={0.04}>
              <shapeGeometry args={[arrowShape(p.r)]} />
              <meshBasicMaterial color="#ecfeff" transparent opacity={0.9} />
            </mesh>
          </group>
        );
      })}
      <group ref={rings}>
        {geo.pads.map((p, i) => (
          <mesh key={i} position={[p.x, 0.05, p.z]} rotation-x={-Math.PI / 2}>
            <ringGeometry args={[p.r * 1.02, p.r * 1.18, 6]} />
            <meshBasicMaterial color="#a5f3fc" transparent opacity={0.85} toneMapped={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function arrowShape(r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(r * 0.6, 0);
  s.lineTo(-r * 0.1, r * 0.4);
  s.lineTo(-r * 0.1, r * 0.15);
  s.lineTo(-r * 0.5, r * 0.15);
  s.lineTo(-r * 0.5, -r * 0.15);
  s.lineTo(-r * 0.1, -r * 0.15);
  s.lineTo(-r * 0.1, -r * 0.4);
  s.closePath();
  return s;
}

/* ── 바닥 왕관 · 첫 낙하 ───────────────────────────────────────────── */

function GroundCrown({ shared, curse }: { shared: MutableRefObject<SceneShared>; curse: boolean }) {
  const crown = useRef<THREE.Group>(null);
  const beam = useRef<THREE.Mesh>(null);
  const shadow = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const snap = shared.current.buf.latest();
    const c = crown.current;
    const b = beam.current;
    const sh = shadow.current;
    if (!snap || !c || !b || !sh) return;
    const t = clock.elapsedTime;
    const now = shared.current.buf.simNow(performance.now());
    const cr = snap.crown;
    if (cr.state === "ground") {
      c.visible = true;
      b.visible = true;
      sh.visible = false;
      c.position.set(cr.x, 0.35 + Math.sin(t * 3) * 0.08, cr.z);
      c.rotation.y = t * 1.8;
      b.position.set(cr.x, 4, cr.z);
      (b.material as THREE.MeshBasicMaterial).opacity = 0.22 + 0.1 * Math.sin(t * 4);
      return;
    }
    if (cr.state === "pending" && snap.phase !== "gameOver" && !curse) {
      // 첫 왕관: 그림자가 커지다가 마지막 0.7초에 하늘에서 떨어진다
      const dropAt = snap.fightStart + CROWN_DROP_MS;
      const leftMs = dropAt - now;
      sh.visible = true;
      const k = Math.max(0, Math.min(1, 1 - leftMs / (CROWN_DROP_MS + 3000)));
      sh.scale.setScalar(0.4 + k * 0.8);
      (sh.material as THREE.MeshBasicMaterial).opacity = 0.2 + 0.25 * k;
      if (leftMs < 700) {
        c.visible = true;
        const u = Math.max(0, leftMs) / 700;
        c.position.set(0, 0.35 + u * u * 14, 0);
        c.rotation.y = t * 6;
      } else c.visible = false;
      b.visible = false;
      return;
    }
    c.visible = false;
    b.visible = false;
    sh.visible = false;
  });
  return (
    <group>
      <group ref={crown} visible={false} scale={1.6}>
        <CrownModel curse={curse} />
      </group>
      <mesh ref={beam} visible={false}>
        <cylinderGeometry args={[0.5, 0.5, 8, 16, 1, true]} />
        <meshBasicMaterial color={curse ? "#c084fc" : "#fde68a"} transparent opacity={0.25} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <mesh ref={shadow} rotation-x={-Math.PI / 2} position-y={0.03} visible={false}>
        <circleGeometry args={[0.9, 32]} />
        <meshBasicMaterial color="#1c1917" transparent opacity={0.3} depthWrite={false} />
      </mesh>
    </group>
  );
}

/* ── 아이템 · 바나나 ─────────────────────────────────────────────── */

const emojiCache = new Map<string, THREE.Texture>();
function emojiTexture(emoji: string): THREE.Texture {
  const hit = emojiCache.get(emoji);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.font = "96px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(emoji, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  emojiCache.set(emoji, t);
  return t;
}

function Items({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const group = useRef<THREE.Group>(null);
  const textures = useMemo(() => Object.fromEntries(Object.entries(ITEM_INFO).map(([k, v]) => [k, emojiTexture(v.emoji)])), []);
  useFrame(({ clock }) => {
    const g = group.current;
    const snap = shared.current.buf.latest();
    if (!g || !snap) return;
    const t = clock.elapsedTime;
    g.children.forEach((c, i) => {
      const it = snap.items[i];
      if (!it) {
        c.visible = false;
        return;
      }
      c.visible = true;
      c.position.set(it.x, 0, it.z);
      const sprite = c.children[0] as THREE.Sprite;
      const ring = c.children[1] as THREE.Mesh;
      sprite.position.y = 0.75 + Math.sin(t * 3 + i) * 0.1;
      const mat = sprite.material as THREE.SpriteMaterial;
      const tex = textures[it.kind];
      if (mat.map !== tex) {
        mat.map = tex;
        mat.needsUpdate = true;
      }
      mat.opacity = it.until - snap.t < 3000 ? 0.45 + 0.55 * Math.abs(Math.sin(t * 8)) : 1;
      ring.rotation.z = t * 1.5;
      ((ring.material as THREE.MeshBasicMaterial).color as THREE.Color).set(ITEM_INFO[it.kind].color);
    });
  });
  return (
    <group ref={group}>
      {[0, 1, 2].map((i) => (
        <group key={i} visible={false}>
          <sprite scale={[0.85, 0.85, 0.85]}>
            <spriteMaterial transparent depthWrite={false} />
          </sprite>
          <mesh rotation-x={-Math.PI / 2} position-y={0.03}>
            <ringGeometry args={[0.45, 0.6, 6]} />
            <meshBasicMaterial transparent opacity={0.85} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

const peelGeo = new THREE.TorusGeometry(0.22, 0.06, 6, 12, Math.PI * 1.3);

function Traps({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = group.current;
    const snap = shared.current.buf.latest();
    if (!g || !snap) return;
    g.children.forEach((c, i) => {
      const tr = snap.traps[i];
      c.visible = !!tr;
      if (tr) {
        c.position.set(tr.x, 0.07, tr.z);
        c.rotation.y = tr.id * 1.3;
      }
    });
  });
  return (
    <group ref={group}>
      {[0, 1, 2, 3, 4].map((i) => (
        <group key={i} visible={false}>
          {[0, 1, 2].map((k) => (
            <mesh key={k} geometry={peelGeo} rotation={[-Math.PI / 2, 0, (k / 3) * Math.PI * 2]}>
              <meshStandardMaterial color="#facc15" roughness={0.6} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/* ── 캐릭터 ─────────────────────────────────────────────────────────── */

export function modeOf(snap: MatchState, p: PlayerState): RunnerMode {
  if (p.move === "fall") return "fall";
  if (snap.phase === "gameOver") return snap.ranks?.[p.seat] === 1 ? "cheer" : "sad";
  if (p.move === "pad") return "pad";
  if (p.move === "stagger") return "stagger";
  if (p.move === "dash") return "dash";
  return Math.hypot(p.vx, p.vz) > 0.6 ? "run" : "idle";
}

function RunnerSlot({ seat, names, shared, lowDetail, curse }: { seat: number; names: Record<number, string>; shared: MutableRefObject<SceneShared>; lowDetail: boolean; curse: boolean }) {
  const chars = useRoomCharacters((st) => st.byName);
  const name = names[seat] ?? "";
  const look = useMemo(() => resolveLook(seat, ["none"], roomCharacterOf(chars, name)), [seat, chars, name]);
  const frame = useRef<RunnerFrame>({ x: 0, y: 0, z: 0, face: 0, mode: "idle", speed: 0, visible: false, crown: false, shield: false, ghost: false, team: null });
  const roarUntil = useRef(0);
  const lastRoarId = useRef(0);
  const read = () => {
    const sh = shared.current;
    const snap = sh.buf.latest();
    const p = snap?.players[seat];
    const f = frame.current;
    if (!snap || !p) {
      f.visible = false;
      return f;
    }
    const now = performance.now();
    const pose = seat === sh.mySeat ? sh.buf.ahead(seat, now) : sh.buf.body(seat, now);
    if (!pose) {
      f.visible = false;
      return f;
    }
    f.visible = p.respawnAt === 0 || pose.y > -5.5;
    f.x = pose.x;
    f.y = pose.y;
    f.z = pose.z;
    f.face = pose.face;
    let mode = modeOf(snap, p);
    // 📣 호령은 순간 이벤트라 잠깐 붙잡아 보여 준다
    const roar = snap.events.find((e) => e.k === "roar" && e.s === seat && e.id > lastRoarId.current);
    if (roar) {
      lastRoarId.current = roar.id;
      roarUntil.current = now + 550;
    }
    if (now < roarUntil.current && mode !== "fall" && mode !== "pad") mode = "roar";
    f.mode = mode;
    f.speed = Math.min(1, Math.hypot(p.vx, p.vz) / 5);
    f.crown = !!crownOn(snap, p) && p.move !== "fall";
    f.shield = snap.crown.state === "held" && snap.crown.holder === seat && snap.t < snap.crown.invulnUntil;
    f.ghost = snap.t < p.ghostUntil;
    f.team = snap.options.mode === "team" ? TEAM_INFO[p.team].color : null;
    return f;
  };
  return <Runner look={look} seed={seat * 13 + 5} color={SEAT_COLORS[seat % 8]} lowDetail={lowDetail} curse={curse} read={read} />;
}

/* ── 카메라 + 이름표 ─────────────────────────────────────────────── */

const v3 = new THREE.Vector3();

function decayShake(sh: SceneShared, dt: number): number {
  const v = sh.shake;
  sh.shake = Math.max(0, v - dt * 2.5);
  return v;
}

type RigState = { cx: number; cz: number; ext: number; init: boolean };

/** 카메라 따라가기 + 이름표 옮기기 (매 프레임). 공유 객체·DOM을 고치므로 컴포넌트 밖 함수로 둔다. */
function rigFrame(camera: THREE.Camera, size: { width: number; height: number }, dtRaw: number, sh: SceneShared, st: RigState) {
  const dt = Math.min(dtRaw, 0.05);
  const snap = sh.buf.latest();
  if (!snap) return;
  const geo = arenaFor(snap.seatCount);
  const now = performance.now();
  let px = 0;
  let pz = 0;
  let pn = 0;
  for (const p of snap.players) {
    if (p.respawnAt > 0) continue;
    const b = sh.buf.body(p.seat, now);
    if (!b) continue;
    px += b.x;
    pz += b.z;
    pn++;
  }
  // 광장 가운데와 사람들 가운데 사이 — 왕관(또는 왕) 쪽으로 조금 더
  let cx = pn ? (px / pn) * 0.4 : 0;
  let cz = pn ? (pz / pn) * 0.4 : 0;
  const cr = snap.crown;
  if (cr.state !== "pending") {
    cx += cr.x * 0.2;
    cz += cr.z * 0.2;
  }
  let ext = Math.max(6, geo.radius * 0.6);
  for (const p of snap.players) {
    if (p.respawnAt > 0) continue;
    const b = sh.buf.body(p.seat, now);
    if (b) ext = Math.max(ext, Math.hypot(b.x - cx, b.z - cz) + 2);
  }
  ext = Math.min(ext, geo.radius + 2);
  if (snap.phase === "gameOver") {
    cx = 0;
    cz = 0;
    ext = geo.radius * 0.8;
  }
  const k = st.init ? 1 - Math.exp(-dt * 2) : 1;
  st.init = true;
  st.cx += (cx - st.cx) * k;
  st.cz += (cz - st.cz) * k;
  st.ext += (ext - st.ext) * k;
  const aspect = size.width / Math.max(1, size.height);
  const persp = camera as THREE.PerspectiveCamera;
  const vfov = (persp.fov * Math.PI) / 180;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const fitFov = Math.min(vfov, hfov);
  const dist = (st.ext * 1.05) / Math.tan(fitFov / 2);
  const pitch = aspect < 0.8 ? 1.05 : 0.95;
  const shake = decayShake(sh, dt);
  const jx = shake > 0 ? (Math.sin(now * 0.09) + Math.sin(now * 0.23)) * 0.12 * shake : 0;
  const jy = shake > 0 ? Math.cos(now * 0.11) * 0.1 * shake : 0;
  camera.position.set(st.cx + jx, Math.sin(pitch) * dist + jy, st.cz + Math.cos(pitch) * dist);
  camera.lookAt(st.cx + jx * 0.5, 0, st.cz + 0.5);
  for (let seat = 0; seat < sh.labels.length; seat++) {
    const el = sh.labels[seat];
    if (!el) continue;
    const p = snap.players[seat];
    if (!p || p.respawnAt > 0) {
      if (el) el.style.display = "none";
      continue;
    }
    const b = seat === sh.mySeat ? sh.buf.ahead(seat, now) : sh.buf.body(seat, now);
    // 덤불 속 사람은 이름표를 숨긴다 (나와 왕관 쓴 사람은 예외)
    if (!b || (seat !== sh.mySeat && !crownOn(snap, p) && p.move === "none" && inBush(geo, b.x, b.z))) {
      el.style.display = "none";
      continue;
    }
    v3.set(b.x, b.y + 1.95, b.z).project(camera);
    if (v3.z > 1) {
      el.style.display = "none";
      continue;
    }
    el.style.display = "";
    const x = (v3.x * 0.5 + 0.5) * size.width;
    const y = (-v3.y * 0.5 + 0.5) * size.height;
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  }
}

function CameraRig({ shared, radius }: { shared: MutableRefObject<SceneShared>; radius: number }) {
  const st = useRef<RigState>({ cx: 0, cz: 0, ext: radius, init: false });
  useFrame(({ camera, size }, dtRaw) => rigFrame(camera, size, dtRaw, shared.current, st.current));
  return null;
}

function FpsProbe({ onFps }: { onFps?: (fps: number) => void }) {
  const acc = useRef({ frames: 0, time: 0 });
  useFrame((_, dt) => {
    const a = acc.current;
    a.frames += 1;
    a.time += Math.min(dt, 0.5);
    if (a.time >= 2) {
      onFps?.(a.frames / a.time);
      a.frames = 0;
      a.time = 0;
    }
  });
  return null;
}

export default function ArenaScene({ shared, names, seatCount, quality, fx, onFps }: ArenaSceneProps) {
  const high = quality === "high";
  const geo = arenaFor(seatCount);
  const r = geo.radius;
  const curse = shared.current.buf.latest()?.options.mode === "curse";
  return (
    <Canvas shadows={high} dpr={high ? [1, 1.75] : [1, 1.5]} gl={{ antialias: high, powerPreference: "high-performance" }} camera={{ fov: 42, position: [0, 18, 16], near: 0.1, far: 400 }} style={{ touchAction: "none" }}>
      <fog attach="fog" args={["#cfe6ff", 60, 170]} />
      <Sky />
      <hemisphereLight args={["#e0f0ff", "#b08a5a", 0.85]} />
      <ambientLight intensity={0.3} />
      <directionalLight
        position={[10, 22, 8]}
        intensity={1.5}
        color="#fff4dc"
        castShadow={high}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-r - 2}
        shadow-camera-right={r + 2}
        shadow-camera-top={r + 2}
        shadow-camera-bottom={-r - 2}
        shadow-camera-near={1}
        shadow-camera-far={70}
        shadow-bias={-0.0008}
      />
      <Clouds radius={r} quality={quality} />
      <Plaza geo={geo} quality={quality} />
      <Pads geo={geo} />
      <GroundCrown shared={shared} curse={curse} />
      <Items shared={shared} />
      <Traps shared={shared} />
      {Array.from({ length: seatCount }, (_, seat) => (
        <RunnerSlot key={seat} seat={seat} names={names} shared={shared} lowDetail={!high} curse={curse} />
      ))}
      <FxLayer items={fx} curse={curse} />
      <CameraRig shared={shared} radius={r} />
      <FpsProbe onFps={onFps} />
      <AdaptiveResolution max={high ? 1.75 : 1.5} />
    </Canvas>
  );
}
