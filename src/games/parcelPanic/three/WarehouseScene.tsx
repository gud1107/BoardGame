"use client";

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { resolveLook } from "@/games/shared/three/SeatedPerson";
import { roomCharacterOf, useRoomCharacters } from "@/lib/character/roomCharacters";
import { AdaptiveResolution } from "@/games/shared/three/sceneFx";
import { BELT_SPEED, BOX_INFO, DEST_INFO, FORK_HALF, FORK_SPEED, HEAVY_R, SEAT_COLORS, truckCap, type BoxKind } from "../data";
import type { Layout } from "../arena";
import type { SnapBuffer } from "../net";
import { layoutOf, type Box, type MatchState, type PlayerState } from "../sim";
import { FxLayer, type FxItem } from "./Fx";
import Worker, { type WorkerFrame, type WorkerMode } from "./Worker";

/**
 * 택배 대란 3D 창고 (룰북 §11): 콘크리트 바닥 + 노란 안전선, 벽, 윗벽 상하차 칸(롤업 문틀 + 목적지 색 트럭이 후진해
 * 들어오고 가득 차면 빠져나감, 짐칸에 실린 상자가 보임), 아래 컨베이어(굴러가는 롤러 무늬 + 입구 덮개 + 빨간 반송구),
 * 가운데 철제 선반(팔레트·상자), 🔍 스캐너 문, 🚜 지게차(경고 줄 깜빡임), 상자 5종(라벨 = 목적지 색 + 기호),
 * VRM 직원(안전모), 연출, 따라가는 카메라. 이름표는 DOM(보드)이 그리고 여기서는 매 프레임 화면 좌표만 옮긴다.
 */

export interface SceneShared {
  buf: SnapBuffer;
  mySeat: number;
  shake: number;
  labels: (HTMLDivElement | null)[];
}

export interface WarehouseSceneProps {
  shared: MutableRefObject<SceneShared>;
  names: Record<number, string>;
  seatCount: number;
  quality: "high" | "low";
  fx: FxItem[];
  onFps?: (fps: number) => void;
}

/* ── 텍스처 ───────────────────────────────────────────────────────── */

function floorTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = "#8b8f98";
  g.fillRect(0, 0, 512, 512);
  // 콘크리트 얼룩 (결정적 무늬)
  for (let i = 0; i < 260; i++) {
    const x = (i * 97) % 512;
    const y = (i * 211) % 512;
    const r = 6 + ((i * 13) % 22);
    g.fillStyle = i % 2 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.05)";
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = "rgba(40,44,52,0.35)";
  g.lineWidth = 5;
  g.strokeRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function beltTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#1f2937";
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = "#374151";
  for (let x = 0; x < 256; x += 32) g.fillRect(x, 0, 14, 64);
  g.strokeStyle = "rgba(250,204,21,0.8)";
  g.lineWidth = 6;
  for (let x = 8; x < 256; x += 64) {
    g.beginPath();
    g.moveTo(x, 14);
    g.lineTo(x + 18, 32);
    g.lineTo(x, 50);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function stripeTexture(a: string, b: string): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = a;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = b;
  for (let k = -64; k < 128; k += 32) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k + 16, 0);
    g.lineTo(k + 80, 64);
    g.lineTo(k + 64, 64);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const labelCache = new Map<string, THREE.Texture>();
/** 라벨·간판 텍스처 (글자 + 배경색) */
function labelTexture(text: string, bg: string, w = 256, h = 128, font = 64, fg = "#ffffff"): THREE.Texture {
  const key = `${text}|${bg}|${w}|${h}|${font}|${fg}`;
  const hit = labelCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(4, 4, w - 8, h - 8, Math.min(w, h) * 0.18);
  g.fill();
  g.strokeStyle = "rgba(255,255,255,0.85)";
  g.lineWidth = 6;
  g.stroke();
  g.fillStyle = fg;
  g.font = `900 ${font}px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, w / 2, h / 2 + font * 0.05);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  labelCache.set(key, t);
  return t;
}

/* ── 창고 ───────────────────────────────────────────────────────────── */

const STEEL = "#64748b";

function Warehouse({ L, quality, shared }: { L: Layout; quality: "high" | "low"; shared: MutableRefObject<SceneShared> }) {
  const tex = useMemo(() => {
    const t = floorTexture();
    t.repeat.set(L.W / 3, L.H / 3);
    return t;
  }, [L.W, L.H]);
  const btex = useMemo(() => {
    const t = beltTexture();
    t.repeat.set((L.belt.x1 - L.belt.x0) / 2, 1);
    return t;
  }, [L.belt.x1, L.belt.x0]);
  const hazard = useMemo(() => stripeTexture("#111827", "#facc15"), []);
  const red = useMemo(() => stripeTexture("#7f1d1d", "#f87171"), []);
  useEffect(
    () => () => {
      tex.dispose();
      btex.dispose();
      hazard.dispose();
      red.dispose();
    },
    [tex, btex, hazard, red],
  );
  const { W, H, belt, chute } = L;
  const high = quality === "high";
  const wallH = 3.2;
  return (
    <group>
      {/* 바닥 */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[W, H]} />
        <meshStandardMaterial map={tex} roughness={0.85} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.03}>
        <planeGeometry args={[W + 30, H + 30]} />
        <meshStandardMaterial color="#2a2f3a" roughness={1} />
      </mesh>
      {/* 벽 (위쪽 벽은 트럭 칸 사이만 — 칸 위치는 Docks가 문틀을 그린다) */}
      {/* 카메라 쪽(아래) 벽은 낮은 턱 — 컨베이어를 가리지 않게 */}
      <mesh position={[0, 0.3, H / 2 + 0.15]}>
        <boxGeometry args={[W + 0.6, 0.6, 0.3]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.9} />
      </mesh>
      <mesh position={[-W / 2 - 0.15, wallH / 2, 0]}>
        <boxGeometry args={[0.3, wallH, H]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.9} />
      </mesh>
      <mesh position={[W / 2 + 0.15, wallH / 2, 0]}>
        <boxGeometry args={[0.3, wallH, H]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.9} />
      </mesh>
      <TopWall L={L} />
      {/* 아래 턱 위 노란 띠 */}
      <mesh position={[0, 0.605, H / 2 + 0.15]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[W + 0.6, 0.3]} />
        <meshStandardMaterial map={hazard} roughness={0.7} />
      </mesh>
      {/* 지게차 길 (바닥 노란 줄) — 깜빡임은 ForkLanes */}
      {/* 컨베이어 */}
      <group position={[(belt.x0 + belt.x1) / 2, 0, belt.z]}>
        <mesh position-y={0.28} castShadow={high} receiveShadow>
          <boxGeometry args={[belt.x1 - belt.x0, 0.56, belt.hw * 2]} />
          <meshStandardMaterial color="#475569" roughness={0.6} metalness={0.3} />
        </mesh>
        <BeltTop tex={btex} len={belt.x1 - belt.x0} hw={belt.hw} shared={shared} />
        {/* 옆 난간 */}
        {[-1, 1].map((sd) => (
          <mesh key={sd} position={[0, 0.62, sd * (belt.hw + 0.03)]}>
            <boxGeometry args={[belt.x1 - belt.x0, 0.1, 0.06]} />
            <meshStandardMaterial color="#facc15" roughness={0.5} />
          </mesh>
        ))}
      </group>
      {/* 입구 덮개 (왼쪽 벽) */}
      <group position={[-W / 2 + 0.2, 0, belt.z]}>
        <mesh position-y={1.1}>
          <boxGeometry args={[0.4, 1.0, belt.hw * 2 + 0.5]} />
          <meshStandardMaterial color="#334155" roughness={0.7} />
        </mesh>
        <mesh position={[0.22, 0.85, 0]}>
          <planeGeometry args={[belt.hw * 2, 0.5]} />
          <meshBasicMaterial color="#0b0f17" side={THREE.DoubleSide} />
        </mesh>
      </group>
      {/* 반송구 */}
      <group position={[(chute.x0 + chute.x1) / 2, 0, (chute.z0 + chute.z1) / 2]}>
        <mesh position-y={0.3} rotation-x={-0.25}>
          <boxGeometry args={[chute.x1 - chute.x0, 0.12, chute.z1 - chute.z0]} />
          <meshStandardMaterial map={red} roughness={0.6} />
        </mesh>
        <sprite position={[0, 1.4, 0]} scale={[1.5, 0.6, 1]}>
          <spriteMaterial map={labelTexture("🗑️ 반송", "#991b1b", 256, 100, 52)} transparent depthWrite={false} />
        </sprite>
      </group>
      {/* 선반 */}
      {L.racks.map((r, i) => (
        <Rack key={i} x0={r.x0} x1={r.x1} z0={r.z0} z1={r.z1} seed={i} high={high} />
      ))}
      {/* 스캐너 문 */}
      <group position={[L.scanner.x, 0, L.scanner.z]}>
        <mesh rotation-x={-Math.PI / 2} position-y={0.012}>
          <circleGeometry args={[L.scanner.r, 40]} />
          <meshBasicMaterial color="#0ea5e9" transparent opacity={0.28} depthWrite={false} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position-y={0.014}>
          <ringGeometry args={[L.scanner.r - 0.08, L.scanner.r, 40]} />
          <meshBasicMaterial color="#38bdf8" toneMapped={false} depthWrite={false} />
        </mesh>
        {[-1, 1].map((sd) => (
          <mesh key={sd} position={[0, 1.1, sd * (L.scanner.r - 0.1)]}>
            <boxGeometry args={[0.18, 2.2, 0.18]} />
            <meshStandardMaterial color="#e2e8f0" metalness={0.4} roughness={0.35} />
          </mesh>
        ))}
        <mesh position={[0, 2.25, 0]}>
          <boxGeometry args={[0.22, 0.2, L.scanner.r * 2]} />
          <meshStandardMaterial color="#0284c7" emissive="#0ea5e9" emissiveIntensity={0.6} />
        </mesh>
        <sprite position={[0, 2.8, 0]} scale={[1.6, 0.64, 1]}>
          <spriteMaterial map={labelTexture("🔍 스캔", "#0369a1", 256, 100, 50)} transparent depthWrite={false} />
        </sprite>
      </group>
    </group>
  );
}

function BeltTop({ tex, len, hw, shared }: { tex: THREE.Texture; len: number; hw: number; shared: MutableRefObject<SceneShared> }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((_, dt) => {
    const snap = shared.current.buf.latest();
    // 🔌 정전 중엔 컨베이어도 멈춘다
    if (snap?.incident?.k === "blackout" && snap.t < snap.incident.until) return;
    const map = mat.current?.map;
    if (map) map.offset.x -= (Math.min(dt, 0.05) * BELT_SPEED) / 2;
  });
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={0.565}>
      <planeGeometry args={[len, hw * 2]} />
      <meshStandardMaterial ref={mat} map={tex} roughness={0.8} />
    </mesh>
  );
}

function TopWall({ L }: { L: Layout }) {
  // 칸 사이의 벽 조각
  const pieces = useMemo(() => {
    const xs = [...L.docks.map((d) => d.zone)].sort((a, b) => a.x0 - b.x0);
    const out: { x0: number; x1: number }[] = [];
    let cur = -L.W / 2 - 0.3;
    for (const z of xs) {
      if (z.x0 - 0.15 > cur) out.push({ x0: cur, x1: z.x0 - 0.15 });
      cur = z.x1 + 0.15;
    }
    if (cur < L.W / 2 + 0.3) out.push({ x0: cur, x1: L.W / 2 + 0.3 });
    return out;
  }, [L]);
  const z = -L.H / 2 - 0.15;
  return (
    <group>
      {pieces.map((p, i) => (
        <mesh key={i} position={[(p.x0 + p.x1) / 2, 1.6, z]}>
          <boxGeometry args={[p.x1 - p.x0, 3.2, 0.3]} />
          <meshStandardMaterial color="#cbd5e1" roughness={0.9} />
        </mesh>
      ))}
      {/* 칸 위 가로보 */}
      {L.docks.map((d, i) => (
        <mesh key={`b${i}`} position={[d.x, 2.95, z]}>
          <boxGeometry args={[d.zone.x1 - d.zone.x0 + 0.3, 0.5, 0.3]} />
          <meshStandardMaterial color="#94a3b8" roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function Rack({ x0, x1, z0, z1, seed, high }: { x0: number; x1: number; z0: number; z1: number; seed: number; high: boolean }) {
  const w = x1 - x0;
  const d = z1 - z0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const posts = [x0 + 0.06, cx, x1 - 0.06];
  const crates = useMemo(() => {
    const out: { x: number; y: number; s: number; c: string }[] = [];
    const n = Math.max(2, Math.round(w / 0.9));
    for (let lv = 0; lv < 2; lv++)
      for (let k = 0; k < n; k++) {
        if ((k * 7 + lv * 3 + seed) % 4 === 0) continue;
        out.push({ x: x0 + ((k + 0.5) * w) / n, y: 0.55 + lv * 0.95, s: 0.48 + (((k + lv + seed) * 37) % 20) / 100, c: ["#c8925a", "#b07d48", "#d6a46a"][(k + lv) % 3] });
      }
    return out;
  }, [w, x0, seed]);
  return (
    <group>
      {posts.map((px) =>
        [z0 + 0.05, z1 - 0.05].map((pz) => (
          <mesh key={`${px}:${pz}`} position={[px, 1.0, pz]}>
            <boxGeometry args={[0.08, 2.0, 0.08]} />
            <meshStandardMaterial color="#1d4ed8" roughness={0.5} metalness={0.4} />
          </mesh>
        )),
      )}
      {[0.3, 1.25].map((y) => (
        <mesh key={y} position={[cx, y, cz]} castShadow={high} receiveShadow>
          <boxGeometry args={[w, 0.06, d]} />
          <meshStandardMaterial color="#f97316" roughness={0.6} metalness={0.2} />
        </mesh>
      ))}
      {crates.map((c, i) => (
        <mesh key={i} position={[c.x, c.y - 0.25 + c.s / 2, cz]} castShadow={high}>
          <boxGeometry args={[c.s, c.s * 0.85, Math.min(d - 0.1, c.s)]} />
          <meshStandardMaterial color={c.c} roughness={0.9} />
        </mesh>
      ))}
      <mesh position={[cx, 0.02, cz]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[w + 0.3, d + 0.3]} />
        <meshBasicMaterial color={STEEL} transparent opacity={0.25} depthWrite={false} />
      </mesh>
    </group>
  );
}

/* ── 트럭 칸 ─────────────────────────────────────────────────────── */

function Docks({ shared, L }: { shared: MutableRefObject<SceneShared>; L: Layout }) {
  return (
    <group>
      {L.docks.map((d, k) => (
        <DockTruck key={k} k={k} L={L} shared={shared} />
      ))}
    </group>
  );
}

function DockTruck({ k, L, shared }: { k: number; L: Layout; shared: MutableRefObject<SceneShared> }) {
  const dk = L.docks[k];
  const truck = useRef<THREE.Group>(null);
  const zoneMat = useRef<THREE.MeshBasicMaterial>(null);
  const edgeMat = useRef<THREE.MeshBasicMaterial>(null);
  const bodyMat = useRef<THREE.MeshStandardMaterial>(null);
  const cabMat = useRef<THREE.MeshStandardMaterial>(null);
  const [view, setView] = useState<{ dest: number; n: number; away: boolean }>({ dest: 0, n: 0, away: false });
  const sig = useRef("");
  const slide = useRef(1);
  const cap = truckCap(shared.current.buf.latest()?.seatCount ?? 4);
  useFrame(({ clock }, dt) => {
    const snap = shared.current.buf.latest();
    if (!snap) return;
    const d = snap.docks[k];
    if (!d) return;
    const away = d.state !== "here";
    const s = `${d.dest}:${d.load.length}:${away}`;
    if (s !== sig.current) {
      sig.current = s;
      setView({ dest: d.dest, n: d.load.length, away });
    }
    // 트럭: 나가면 위쪽(−z)으로 미끄러져 나가고, 오면 후진해서 들어온다
    const want = away ? 0 : 1;
    slide.current += (want - slide.current) * Math.min(1, dt * 2.2);
    if (truck.current) truck.current.position.z = -L.H / 2 - 2.35 - (1 - slide.current) * 9;
    const info = DEST_INFO[d.dest];
    const time = clock.elapsedTime;
    // 내 상자가 이 트럭이면 칸이 깜빡인다
    const me = snap.players[shared.current.mySeat];
    const hb = me && me.hold >= 0 ? snap.boxes.find((b) => b.id === me.hold) : null;
    const mine = !!hb && hb.known && hb.dest === d.dest;
    if (zoneMat.current) {
      zoneMat.current.color.set(info.color);
      zoneMat.current.opacity = away ? 0.08 : mine ? 0.3 + 0.2 * Math.abs(Math.sin(time * 5)) : 0.2;
    }
    if (edgeMat.current) edgeMat.current.color.set(info.color);
    if (bodyMat.current) bodyMat.current.color.set(info.color);
    if (cabMat.current) cabMat.current.color.set(info.color).offsetHSL(0, 0, -0.12);
  });
  const info = DEST_INFO[view.dest];
  const zw = dk.zone.x1 - dk.zone.x0;
  const zd = dk.zone.z1 - dk.zone.z0;
  const loads = Array.from({ length: Math.min(view.n, cap) }, (_, i) => i);
  return (
    <group>
      {/* 바닥 칸 */}
      <mesh rotation-x={-Math.PI / 2} position={[dk.x, 0.013, (dk.zone.z0 + dk.zone.z1) / 2]}>
        <planeGeometry args={[zw, zd]} />
        <meshBasicMaterial ref={zoneMat} transparent opacity={0.2} depthWrite={false} />
      </mesh>
      {[
        [dk.x, dk.zone.z1, zw, 0.1],
        [dk.zone.x0, (dk.zone.z0 + dk.zone.z1) / 2, 0.1, zd],
        [dk.zone.x1, (dk.zone.z0 + dk.zone.z1) / 2, 0.1, zd],
      ].map(([x, z, w, d], i) => (
        <mesh key={i} rotation-x={-Math.PI / 2} position={[x, 0.016, z]}>
          <planeGeometry args={[w, d]} />
          <meshBasicMaterial ref={i === 0 ? edgeMat : undefined} color={info.color} toneMapped={false} depthWrite={false} />
        </mesh>
      ))}
      {/* 바닥 큰 기호 */}
      <mesh rotation-x={-Math.PI / 2} position={[dk.x, 0.018, (dk.zone.z0 + dk.zone.z1) / 2 + 0.2]}>
        <planeGeometry args={[1.3, 0.65]} />
        <meshBasicMaterial map={labelTexture(`${info.sym} ${info.short}`, "rgba(15,23,42,0.6)", 256, 128, 50)} transparent depthWrite={false} />
      </mesh>
      {/* 트럭 */}
      <group ref={truck} position={[dk.x, 0, -L.H / 2 - 2.35]}>
        {/* 짐칸 (뒤가 열려 창고 쪽을 본다) */}
        <mesh position={[0, 1.35, 0]} castShadow>
          <boxGeometry args={[2.5, 2.1, 3.6]} />
          <meshStandardMaterial ref={bodyMat} color={info.color} roughness={0.55} side={THREE.BackSide} />
        </mesh>
        <mesh position={[0, 0.32, 0]}>
          <boxGeometry args={[2.5, 0.12, 3.7]} />
          <meshStandardMaterial color="#334155" roughness={0.7} />
        </mesh>
        {/* 운전석 */}
        <mesh position={[0, 1.0, -2.45]} castShadow>
          <boxGeometry args={[2.3, 1.5, 1.3]} />
          <meshStandardMaterial ref={cabMat} color={info.color} roughness={0.5} />
        </mesh>
        <mesh position={[0, 1.35, -1.82]}>
          <planeGeometry args={[1.9, 0.6]} />
          <meshStandardMaterial color="#93c5fd" roughness={0.2} metalness={0.5} side={THREE.DoubleSide} />
        </mesh>
        {[-1, 1].map((sx) =>
          [-2.3, 0.9].map((wz) => (
            <mesh key={`${sx}:${wz}`} position={[sx * 1.18, 0.38, wz]} rotation-z={Math.PI / 2}>
              <cylinderGeometry args={[0.38, 0.38, 0.28, 16]} />
              <meshStandardMaterial color="#111827" roughness={0.9} />
            </mesh>
          )),
        )}
        {/* 실린 상자 */}
        {loads.map((i) => (
          <mesh key={i} position={[((i % 3) - 1) * 0.72, 0.65 + Math.floor(i / 3) * 0.62, 1.2 - Math.floor(i / 3) * 0.1 - (i % 2) * 0.15]}>
            <boxGeometry args={[0.6, 0.55, 0.6]} />
            <meshStandardMaterial color="#c8925a" roughness={0.9} />
          </mesh>
        ))}
        {/* 간판 */}
        <sprite position={[0, 3.0, 1.4]} scale={[2.2, 0.9, 1]}>
          <spriteMaterial map={labelTexture(view.away ? `${info.sym} 🚚…` : `${info.sym} ${info.short} ${view.n}/${cap}`, info.color, 320, 128, 50)} transparent depthWrite={false} />
        </sprite>
      </group>
    </group>
  );
}

/* ── 지게차 ─────────────────────────────────────────────────────── */

function ForkLanes({ shared, L }: { shared: MutableRefObject<SceneShared>; L: Layout }) {
  const mats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const fork = useRef<THREE.Group>(null);
  const hazard = useMemo(() => {
    const t = stripeTexture("#00000000", "#facc15");
    t.repeat.set(L.W / 1.2, 1);
    return t;
  }, [L.W]);
  useEffect(() => () => hazard.dispose(), [hazard]);
  useFrame(() => {
    const sh = shared.current;
    const snap = sh.buf.latest();
    if (!snap) return;
    const f = snap.fork;
    const now = performance.now();
    const simNow = sh.buf.simNow(now);
    L.lanes.forEach((lz, i) => {
      const m = mats.current[i];
      if (!m) return;
      const active = !!f && Math.abs(f.z - lz) < 0.01;
      const warn = active && simNow < (f?.goAt ?? 0);
      m.opacity = active ? (warn ? (Math.floor(now / 180) % 2 ? 0.95 : 0.35) : 0.7) : 0.22;
    });
    const g = fork.current;
    if (!g) return;
    g.visible = !!f;
    if (f) {
      const since = (now - (sh.buf.curr?.at ?? now)) / 1000;
      const moving = simNow >= f.goAt;
      g.position.set(f.x + (moving ? f.dir * FORK_SPEED * Math.min(0.2, since) : 0), 0, f.z);
      g.rotation.y = f.dir > 0 ? 0 : Math.PI;
    }
  });
  return (
    <group>
      {L.lanes.map((lz, i) => (
        <mesh key={i} rotation-x={-Math.PI / 2} position={[0, 0.011, lz]}>
          <planeGeometry args={[L.W, FORK_HALF.z * 2]} />
          <meshBasicMaterial
            ref={(m) => {
              mats.current[i] = m;
            }}
            map={hazard}
            transparent
            opacity={0.22}
            depthWrite={false}
          />
        </mesh>
      ))}
      <group ref={fork} visible={false}>
        <mesh position={[0, 0.65, 0]} castShadow>
          <boxGeometry args={[FORK_HALF.x * 1.5, 0.9, FORK_HALF.z * 1.9]} />
          <meshStandardMaterial color="#facc15" roughness={0.5} />
        </mesh>
        <mesh position={[-0.2, 1.45, 0]}>
          <boxGeometry args={[0.9, 0.7, FORK_HALF.z * 1.6]} />
          <meshStandardMaterial color="#1f2937" roughness={0.4} transparent opacity={0.7} />
        </mesh>
        {/* 포크 기둥 + 날 (앞 = +x) */}
        <mesh position={[FORK_HALF.x * 0.8, 1.2, 0]}>
          <boxGeometry args={[0.12, 2.2, FORK_HALF.z * 1.6]} />
          <meshStandardMaterial color="#374151" metalness={0.5} roughness={0.4} />
        </mesh>
        {[-0.3, 0.3].map((z) => (
          <mesh key={z} position={[FORK_HALF.x * 1.05, 0.15, z]}>
            <boxGeometry args={[0.8, 0.06, 0.14]} />
            <meshStandardMaterial color="#9ca3af" metalness={0.6} roughness={0.3} />
          </mesh>
        ))}
        {[-1, 1].map((sx) =>
          [-1, 1].map((sz) => (
            <mesh key={`${sx}:${sz}`} position={[sx * FORK_HALF.x * 0.5, 0.25, sz * FORK_HALF.z * 0.95]} rotation-x={Math.PI / 2}>
              <cylinderGeometry args={[0.25, 0.25, 0.18, 14]} />
              <meshStandardMaterial color="#111827" />
            </mesh>
          )),
        )}
        <mesh position={[-0.3, 2.0, 0]}>
          <sphereGeometry args={[0.1, 10, 8]} />
          <meshBasicMaterial color="#fb923c" toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

/* ── 상자 ─────────────────────────────────────────────────────────── */

const boxGeo = new THREE.BoxGeometry(0.55, 0.45, 0.55);
const heavyGeo = new THREE.BoxGeometry(HEAVY_R * 2, 0.7, HEAVY_R * 1.4);
const tapeGeo = new THREE.BoxGeometry(0.56, 0.02, 0.12);
const shadowGeo = new THREE.CircleGeometry(0.36, 16);

function BoxMesh({ id, kind, shared }: { id: number; kind: BoxKind; shared: MutableRefObject<SceneShared> }) {
  const g = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const shadow = useRef<THREE.Mesh>(null);
  const label = useRef<THREE.SpriteMaterial>(null);
  const cache = useRef<{ b: Box | null; snapT: number; key: string }>({ b: null, snapT: -1, key: "" });
  useFrame(({ clock }) => {
    const sh = shared.current;
    const snap = sh.buf.latest();
    const grp = g.current;
    if (!snap || !grp || !body.current) return;
    if (cache.current.snapT !== snap.t) cache.current = { ...cache.current, b: snap.boxes.find((x) => x.id === id) ?? null, snapT: snap.t };
    const b = cache.current.b;
    if (!b || b.state === "gone") {
      grp.visible = false;
      return;
    }
    grp.visible = true;
    const now = performance.now();
    const q = sh.buf.box(b, now, sh.mySeat);
    const time = clock.elapsedTime;
    grp.position.set(q.x, 0, q.z);
    body.current.position.y = q.y + (kind === "heavy" ? 0.35 : 0.225);
    if (b.state === "air") {
      body.current.rotation.set(time * 7, time * 4, 0);
    } else if (b.state === "held" && b.kind !== "heavy" && b.holders.length) {
      const p = snap.players[b.holders[0]];
      body.current.rotation.set(0, Math.PI / 2 - (p?.face ?? 0), 0);
    } else {
      body.current.rotation.set(0, (id * 0.7) % 1.2, 0);
    }
    if (shadow.current) {
      shadow.current.visible = b.state === "air" || b.state === "floor";
      shadow.current.scale.setScalar(b.state === "air" ? 0.6 + 0.4 * (1 - Math.min(1, q.y / 3)) : kind === "heavy" ? 1.8 : 1);
    }
    // 라벨: 목적지 기호 (❓) · 🧊 남은 시간이 짧으면 빨갛게 깜빡
    const key = `${b.known ? b.dest : -1}|${kind === "cold" && b.expireAt > 0 && b.expireAt - snap.t < 10_000 ? Math.floor(time * 4) % 2 : 0}|${kind === "express" && snap.t <= b.deadline ? 1 : 0}`;
    if (label.current && key !== cache.current.key) {
      cache.current.key = key;
      const info = b.known ? DEST_INFO[b.dest] : null;
      const hot = key.split("|")[1] === "1";
      const icon = kind === "normal" ? "" : `${BOX_INFO[kind].emoji}`;
      label.current.map = labelTexture(`${icon}${info ? info.sym : "❓"}`, hot ? "#dc2626" : info ? info.color : "#475569", 192, 128, 64);
      label.current.needsUpdate = true;
    }
  });
  const info = BOX_INFO[kind];
  return (
    <group ref={g} visible={false}>
      <mesh ref={shadow} geometry={shadowGeo} rotation-x={-Math.PI / 2} position-y={0.01}>
        <meshBasicMaterial color="#05070c" transparent opacity={0.32} depthWrite={false} />
      </mesh>
      <group ref={body}>
        <mesh geometry={kind === "heavy" ? heavyGeo : boxGeo} castShadow>
          <meshStandardMaterial color={info.color} roughness={0.85} />
        </mesh>
        {kind !== "heavy" ? (
          <mesh geometry={tapeGeo} position-y={0.235}>
            <meshStandardMaterial color={kind === "express" ? "#ef4444" : kind === "fragile" ? "#f43f5e" : kind === "cold" ? "#0284c7" : "#e8d3a8"} roughness={0.5} />
          </mesh>
        ) : (
          <>
            {/* 대형 가구: 다리 + 비닐 포장 띠 */}
            {[-1, 1].map((sx) =>
              [-1, 1].map((sz) => (
                <mesh key={`${sx}:${sz}`} position={[sx * HEAVY_R * 0.8, -0.42, sz * HEAVY_R * 0.5]}>
                  <boxGeometry args={[0.1, 0.16, 0.1]} />
                  <meshStandardMaterial color="#422006" />
                </mesh>
              )),
            )}
            <mesh position={[0, 0.36, 0]}>
              <boxGeometry args={[HEAVY_R * 2.02, 0.02, 0.2]} />
              <meshStandardMaterial color="#fde68a" />
            </mesh>
          </>
        )}
        <sprite position={[0, kind === "heavy" ? 0.75 : 0.58, 0]} scale={kind === "heavy" ? [0.9, 0.6, 1] : [0.6, 0.4, 1]}>
          <spriteMaterial ref={label} transparent depthWrite={false} />
        </sprite>
      </group>
    </group>
  );
}

function Boxes({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const [list, setList] = useState<{ id: number; kind: BoxKind }[]>([]);
  const sigRef = useRef("");
  useFrame(() => {
    const snap = shared.current.buf.latest();
    if (!snap) return;
    const sig = snap.boxes.map((b) => b.id).join(",");
    if (sig !== sigRef.current) {
      sigRef.current = sig;
      setList(snap.boxes.map((b) => ({ id: b.id, kind: b.kind })));
    }
  });
  return (
    <group>
      {list.map((b) => (
        <BoxMesh key={b.id} id={b.id} kind={b.kind} shared={shared} />
      ))}
    </group>
  );
}

/* ── 직원 ─────────────────────────────────────────────────────────── */

export function modeOf(snap: MatchState, p: PlayerState): WorkerMode {
  if (snap.phase === "gameOver") {
    const ok = snap.options.mode === "coop" ? snap.stars >= 1 : snap.ranks?.[p.seat] === 1;
    return ok ? "cheer" : "sad";
  }
  if (p.move === "stagger") return "stagger";
  if (p.move === "dash") return "dash";
  if (p.hold >= 0) {
    const b = snap.boxes.find((x) => x.id === p.hold);
    return b?.kind === "heavy" ? "heavy" : "carry";
  }
  return Math.hypot(p.vx, p.vz) > 0.6 ? "run" : "idle";
}

function WorkerSlot({ seat, names, shared, lowDetail }: { seat: number; names: Record<number, string>; shared: MutableRefObject<SceneShared>; lowDetail: boolean }) {
  const chars = useRoomCharacters((st) => st.byName);
  const name = names[seat] ?? "";
  const look = useMemo(() => resolveLook(seat, ["none"], roomCharacterOf(chars, name)), [seat, chars, name]);
  const frame = useRef<WorkerFrame>({ x: 0, z: 0, face: 0, mode: "idle", speed: 0, visible: false });
  const throwUntil = useRef(0);
  const lastThrow = useRef(0);
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
    f.visible = true;
    f.x = pose.x;
    f.z = pose.z;
    f.face = pose.face;
    let mode = modeOf(snap, p);
    const th = snap.events.find((e) => e.k === "throw" && e.s === seat && e.id > lastThrow.current);
    if (th) {
      lastThrow.current = th.id;
      throwUntil.current = now + 380;
    }
    if (now < throwUntil.current && mode !== "stagger") mode = "throw";
    f.mode = mode;
    f.speed = Math.min(1, Math.hypot(p.vx, p.vz) / 5);
    return f;
  };
  return <Worker look={look} seed={seat * 13 + 5} color={SEAT_COLORS[seat % 6]} lowDetail={lowDetail} read={read} />;
}

/* ── 카메라 + 이름표 ─────────────────────────────────────────────── */

const v3 = new THREE.Vector3();
type RigState = { cx: number; cz: number; ext: number; init: boolean };

/** 카메라: 나 65% + 모두 35% 쪽을 보며, 내 상자의 트럭 칸도 웬만하면 화면에. 시작·끝은 창고 전체. */
function rigFrame(camera: THREE.Camera, size: { width: number; height: number }, dtRaw: number, sh: SceneShared, st: RigState) {
  const dt = Math.min(dtRaw, 0.05);
  const snap = sh.buf.latest();
  if (!snap) return;
  const L = layoutOf(snap);
  const now = performance.now();
  const meP = sh.buf.ahead(sh.mySeat, now);
  let px = 0;
  let pz = 0;
  let pn = 0;
  for (const p of snap.players) {
    const b = sh.buf.body(p.seat, now);
    if (!b) continue;
    px += b.x;
    pz += b.z;
    pn++;
  }
  const gx = pn ? px / pn : 0;
  const gz = pn ? pz / pn : 0;
  let cx = meP ? meP.x * 0.65 + gx * 0.35 : gx;
  let cz = meP ? meP.z * 0.65 + gz * 0.35 : gz;
  let ext = 7;
  if (meP) {
    ext = Math.max(ext, Math.hypot(meP.x - cx, meP.z - cz) + 4);
    const me = snap.players[sh.mySeat];
    const hb = me && me.hold >= 0 ? snap.boxes.find((b) => b.id === me.hold) : null;
    if (hb && hb.known) {
      const k = snap.docks.findIndex((d) => d.dest === hb.dest);
      const dk = L.docks[k];
      if (dk) {
        cx = cx * 0.75 + dk.x * 0.25;
        cz = cz * 0.75 + dk.z * 0.25;
        ext = Math.max(ext, Math.min(L.W * 0.55, Math.hypot(dk.x - cx, dk.z - cz) * 0.8 + 1.5));
      }
    }
  }
  ext = Math.min(ext, L.W * 0.56);
  if (snap.phase === "gameOver" || snap.phase === "countdown") {
    cx = 0;
    cz = -0.5;
    ext = L.W * 0.52;
  }
  const k = st.init ? 1 - Math.exp(-dt * 2.4) : 1;
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
  const pitch = aspect < 0.8 ? 1.18 : 1.1;
  const shake = sh.shake;
  sh.shake = Math.max(0, shake - dt * 2.5);
  const jx = shake > 0 ? (Math.sin(now * 0.09) + Math.sin(now * 0.23)) * 0.12 * shake : 0;
  const jy = shake > 0 ? Math.cos(now * 0.11) * 0.1 * shake : 0;
  camera.position.set(st.cx + jx, Math.sin(pitch) * dist + jy, st.cz + Math.cos(pitch) * dist);
  // 트럭(윗벽 너머)이 화면에 들어오게 살짝 위쪽을 본다
  camera.lookAt(st.cx + jx * 0.5, 0, st.cz - 1.1);
  for (let seat = 0; seat < sh.labels.length; seat++) {
    const el = sh.labels[seat];
    if (!el) continue;
    const b = seat === sh.mySeat ? sh.buf.ahead(seat, now) : sh.buf.body(seat, now);
    if (!b) {
      el.style.display = "none";
      continue;
    }
    v3.set(b.x, 1.95, b.z).project(camera);
    if (v3.z > 1 || Math.abs(v3.x) > 1.1 || Math.abs(v3.y) > 1.1) {
      el.style.display = "none";
      continue;
    }
    el.style.display = "";
    const x = (v3.x * 0.5 + 0.5) * size.width;
    const y = (-v3.y * 0.5 + 0.5) * size.height;
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  }
}

function CameraRig({ shared, W }: { shared: MutableRefObject<SceneShared>; W: number }) {
  const st = useRef<RigState>({ cx: 0, cz: 0, ext: W / 2, init: false });
  useFrame(({ camera, size }, dtRaw) => rigFrame(camera, size, dtRaw, shared.current, st.current));
  return null;
}

/** 정전이면 조명을 줄인다 */
function Lights({ shared, L, high }: { shared: MutableRefObject<SceneShared>; L: Layout; high: boolean }) {
  const dir = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  useFrame(() => {
    const snap = shared.current.buf.latest();
    const dark = !!snap?.incident && snap.incident.k === "blackout" && snap.t < snap.incident.until;
    const k = dark ? 0.35 : 1;
    if (dir.current) dir.current.intensity += (1.3 * k - dir.current.intensity) * 0.15;
    if (hemi.current) hemi.current.intensity += (0.9 * k - hemi.current.intensity) * 0.15;
  });
  const r = Math.max(L.W, L.H) / 2 + 3;
  return (
    <>
      <hemisphereLight ref={hemi} args={["#f8fafc", "#475569", 0.9]} />
      <ambientLight intensity={0.3} />
      <directionalLight
        ref={dir}
        position={[6, 22, 10]}
        intensity={1.3}
        color="#fff7ed"
        castShadow={high}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-r}
        shadow-camera-right={r}
        shadow-camera-top={r}
        shadow-camera-bottom={-r}
        shadow-camera-near={1}
        shadow-camera-far={70}
        shadow-bias={-0.0008}
      />
    </>
  );
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

export default function WarehouseScene({ shared, names, seatCount, quality, fx, onFps }: WarehouseSceneProps) {
  const high = quality === "high";
  const L = layoutOf({ seatCount });
  return (
    <Canvas shadows={high} dpr={high ? [1, 1.75] : [1, 1.5]} gl={{ antialias: high, powerPreference: "high-performance" }} camera={{ fov: 42, position: [0, 18, 16], near: 0.1, far: 300 }} style={{ touchAction: "none" }}>
      <color attach="background" args={["#1c1f26"]} />
      <fog attach="fog" args={["#1c1f26", 34, 80]} />
      <Lights shared={shared} L={L} high={high} />
      <Warehouse L={L} quality={quality} shared={shared} />
      <Docks shared={shared} L={L} />
      <ForkLanes shared={shared} L={L} />
      <Boxes shared={shared} />
      {Array.from({ length: seatCount }, (_, seat) => (
        <WorkerSlot key={seat} seat={seat} names={names} shared={shared} lowDetail={!high} />
      ))}
      <FxLayer items={fx} />
      <CameraRig shared={shared} W={L.W} />
      <FpsProbe onFps={onFps} />
      <AdaptiveResolution max={high ? 1.75 : 1.5} />
    </Canvas>
  );
}
