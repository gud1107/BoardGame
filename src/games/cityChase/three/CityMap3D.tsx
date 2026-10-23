"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import {
  cellRC,
  CELL_COUNT,
  GRID,
  MIDPOINT_ROUND,
  POINT_GRID,
  pointCells,
  pointIJ,
  tokenColor,
  TOKEN_ROUND,
  type Cell,
  type Point,
  type SearchRecord,
  type TokenColor,
} from "../engine";
import { cellLabel, HELI_STYLES, type CityMapProps } from "../CityMap";
import { clamp01, easeInOut, easeOut } from "@/games/shared/three/tableKit";

/**
 * 시티 체이스 입체 도시 (2026-10-23 개편) — 2D `CityMap`과 같은 props.
 *
 * 가독성: 낮은 상가 건물(뒷줄을 가리지 않음) + 큰 건물 이름표, 감시 구역은
 * 원뿔 빛 대신 그 유닛 색으로 땅(인도)을 칠한다. 🗺️ 탑뷰 = 거의 수직으로
 * 내려다보는 2.5D 카메라.
 *
 * 연출: 도둑 화면에선 도둑 캐릭터가 고른 건물 입구까지 걸어가 털고(💰) 쓰레기통
 * 뒤 어둠에 숨는다. 이미 턴 건물엔 폴리스 라인 + 사이렌. 경찰 유닛 3개는
 * 🚓 경찰차·👮 경찰관·🚁 헬기(모양만 다르고 규칙은 같음), 수색은 유닛에서
 * 건물로 쏘는 탐조등 + 건물이 반투명해지며 안이 보이고, 검거되면 수갑을 찬다.
 * 도둑과 흔적은 `showSecret`(도둑 본인 / 게임 종료)일 때만 그린다 — 2D와 같은 가림 규칙.
 */

const STEP = 2;
const HALF = (GRID * STEP) / 2;
const px = (j: number) => j * STEP - HALF; // road line j → world x
const pz = (i: number) => i * STEP - HALF;
const cx = (c: number) => px(c) + STEP / 2;
const cz = (r: number) => pz(r) + STEP / 2;
const FOOT = 1.3;
const HELI_ALT = 2.5;
/** People are drawn ~1.5× life size next to the shops so they read at board zoom. */
const PERSON = 1.5;

const TOKEN_HEX: Record<TokenColor, string> = { yellow: "#facc15", blue: "#22d3ee", purple: "#a855f7", red: "#ef4444" };
const TOKEN_ICON: Record<TokenColor, string> = { yellow: "🟡", blue: "🔵", purple: "🟣", red: "🔴" };
const FACADES = ["#475569", "#57534e", "#3f5a6b", "#5b4b6b", "#4b5563", "#3d5a50"];
const AWNINGS = ["#dc2626", "#16a34a", "#2563eb", "#d97706", "#9333ea", "#0891b2"];

/** Low-rise shops (0.6~1.12) so the back rows and every intersection stay visible. */
function buildingHeight(cell: Cell): number {
  return 0.6 + ((cell * 7 + 3) % 5) * 0.13;
}

type V3 = [number, number, number];
const doorPos = (cell: Cell): V3 => {
  const [r, c] = cellRC(cell);
  return [cx(c), 0, cz(r) + FOOT / 2 + 0.12];
};
/**
 * In the dark side alley east of the shop, behind its trash can (seen from the
 * south camera the can is in front). The alley stays visible from above — the
 * shop's own front would hide behind the next row's building.
 */
const hidePos = (cell: Cell): V3 => {
  const [r, c] = cellRC(cell);
  return [cx(c) + FOOT / 2 + 0.16, 0, cz(r) + 0.12];
};
const canPos = (cell: Cell): V3 => {
  const [r, c] = cellRC(cell);
  return [cx(c) + FOOT / 2 + 0.16, 0, cz(r) + 0.42];
};
function unitPos(p: Point, h: number): V3 {
  const [i, j] = pointIJ(p);
  // car / officer share the ground — nudge them apart so a stack stays readable, and both to the
  // far (north) side of the crossing: on the camera side the shop in front hides them up to the chest
  if (h === 2) return [px(j), HELI_ALT, pz(i)];
  return h === 0 ? [px(j) - 0.2, 0, pz(i) - 0.16] : [px(j) + 0.2, 0, pz(i) - 0.22];
}

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

const windowTex: Partial<Record<"map" | "glow", THREE.CanvasTexture>> = {};
/** Window grid: "map" = white wall with dark/lit panes (tints the facade colour), "glow" = only the lit panes (emissive). */
function windowTexture(kind: "map" | "glow"): THREE.CanvasTexture {
  const hit = windowTex[kind];
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = kind === "map" ? "#ffffff" : "#000000";
  ctx.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 3; x++) {
      const lit = Math.abs((Math.sin(x * 12.9 + y * 78.2) * 43758.5) % 1) > 0.45;
      ctx.fillStyle = lit ? "#fde68a" : kind === "map" ? "#1e293b" : "#000000";
      ctx.fillRect(6 + x * 20, 8 + y * 28, 12, 16);
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  windowTex[kind] = t;
  return t;
}

const chipCache = new Map<string, THREE.CanvasTexture>();
/** A round token chip face with its round number (blank when only the colour is known). */
function chipTexture(color: TokenColor, n: number | null): THREE.CanvasTexture {
  const key = `${color}:${n ?? ""}`;
  let t = chipCache.get(key);
  if (t) return t;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fillStyle = TOKEN_HEX[color];
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.stroke();
  if (n !== null) {
    ctx.fillStyle = color === "yellow" ? "#111827" : "#ffffff";
    ctx.font = "900 70px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(n), 64, 68);
  }
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  chipCache.set(key, t);
  return t;
}

const tagCache = new Map<string, { tex: THREE.CanvasTexture; aspect: number }>();
/** A pill sized to its text (unlike the kit's fixed 4:1 name tag) — big, crisp building / unit labels. */
function tagTexture(text: string, color: string, bg = "rgba(2,6,23,0.88)"): { tex: THREE.CanvasTexture; aspect: number } {
  const key = `${text}|${color}|${bg}`;
  let hit = tagCache.get(key);
  if (hit) return hit;
  const font = "800 64px 'Pretendard','Apple SD Gothic Neo','Malgun Gothic','Segoe UI Emoji','Apple Color Emoji',sans-serif";
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = font;
  const w = Math.ceil(probe.measureText(text).width) + 56;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = 96;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(4, 4, w - 8, 88, 40);
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.font = font;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, 52);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  hit = { tex, aspect: w / 96 };
  tagCache.set(key, hit);
  return hit;
}

function Tag({ text, color, bg, position, height = 0.34, front = false }: { text: string; color: string; bg?: string; position: V3; height?: number; front?: boolean }) {
  const { tex, aspect } = tagTexture(text, color, bg);
  // phones: the whole board is ~340px wide, so tags grow to stay readable
  const narrow = useThree((st) => st.size.width < 480);
  const hgt = narrow ? height * 1.4 : height;
  return (
    <sprite position={position} scale={[hgt * aspect, hgt, 1]} renderOrder={front ? 20 : 5}>
      <spriteMaterial map={tex} transparent depthWrite={false} depthTest={!front} />
    </sprite>
  );
}

let stripeTex: THREE.CanvasTexture | null = null;
function stripeTexture(): THREE.CanvasTexture {
  if (stripeTex) return stripeTex;
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  for (let y = 0; y < 8; y++) {
    ctx.fillStyle = y % 2 ? "#f8fafc" : "#111827";
    ctx.fillRect(0, y * 8, 16, 8);
  }
  stripeTex = new THREE.CanvasTexture(c);
  stripeTex.colorSpace = THREE.SRGBColorSpace;
  stripeTex.magFilter = THREE.NearestFilter;
  return stripeTex;
}

let tapeTex: THREE.CanvasTexture | null = null;
function policeTapeTexture(): THREE.CanvasTexture {
  if (tapeTex) return tapeTex;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 32;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#facc15";
  ctx.fillRect(0, 0, 256, 32);
  ctx.fillStyle = "#111827";
  ctx.font = "900 22px sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText("POLICE LINE ✕ POLICE LINE", 6, 17);
  tapeTex = new THREE.CanvasTexture(c);
  tapeTex.colorSpace = THREE.SRGBColorSpace;
  return tapeTex;
}

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

function Ground() {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial color="#0b1324" roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[GRID * STEP + 1.4, GRID * STEP + 1.4]} />
        <meshStandardMaterial color="#1e293b" roughness={0.95} />
      </mesh>
      {Array.from({ length: POINT_GRID }, (_, k) => (
        <group key={k}>
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.004, pz(k)]}>
            <planeGeometry args={[GRID * STEP + 1, 0.05]} />
            <meshBasicMaterial color="#fde68a" transparent opacity={0.45} />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position={[px(k), 0.004, 0]}>
            <planeGeometry args={[0.05, GRID * STEP + 1]} />
            <meshBasicMaterial color="#fde68a" transparent opacity={0.45} />
          </mesh>
        </group>
      ))}
      {/* street names along the edges: A~E / 1~5, like the 2D map */}
      {Array.from({ length: GRID }, (_, k) => (
        <group key={`n${k}`}>
          <Tag text={String.fromCharCode(65 + k)} color="#64748b" position={[cx(k), 0.05, pz(GRID) + 0.75]} height={0.36} />
          <Tag text={String(k + 1)} color="#64748b" position={[px(0) - 0.75, 0.05, cz(k)]} height={0.36} />
        </group>
      ))}
      {Array.from({ length: 28 }, (_, i) => {
        const a = (i / 28) * Math.PI * 2;
        const h = 3 + ((i * 7) % 5) * 1.6;
        return (
          <mesh key={i} position={[Math.sin(a) * 22, h / 2, Math.cos(a) * 22]}>
            <boxGeometry args={[2.4, h, 2.4]} />
            <meshStandardMaterial color="#111a2e" emissive="#1e293b" emissiveIntensity={0.3} />
          </mesh>
        );
      })}
    </group>
  );
}

function Chip({ color, n, position, size = 0.4 }: { color: TokenColor; n: number | null; position: V3; size?: number }) {
  return (
    <mesh position={position} rotation-x={-Math.PI / 2} renderOrder={3}>
      <circleGeometry args={[size / 2, 28]} />
      <meshBasicMaterial map={chipTexture(color, n)} transparent depthWrite={false} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

type Reveal = { cell: Cell; heli: number; result: SearchRecord["result"]; tokens: TokenColor[]; key: number };
type Alarm = { cell: Cell; key: number };

function Building({
  cell,
  clickable,
  tone,
  zone,
  heat,
  note,
  ghost,
  robbed,
  alarm,
  onClick,
  lowDetail,
}: {
  cell: Cell;
  clickable: boolean;
  tone: "search" | "thief" | null;
  /** Colour of the police unit that can search this building right now (painted on the sidewalk). */
  zone: string | null;
  heat: number;
  note: SearchRecord | undefined;
  /** Searched / caught: the walls turn see-through so everyone sees what's inside. */
  ghost: boolean;
  /** Thief view: already robbed — police tape + siren, can't go back. */
  robbed: boolean;
  alarm: Alarm | null;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
  lowDetail: boolean;
}) {
  const [r, c] = cellRC(cell);
  const h = buildingHeight(cell);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const roof = useRef<THREE.MeshStandardMaterial>(null);
  const plot = useRef<THREE.MeshBasicMaterial>(null);
  const siren = useRef<THREE.Group>(null);
  const alarmAt = useRef<{ key: number; at: number } | null>(null);
  const facade = FACADES[(cell * 5 + 1) % FACADES.length];
  const awning = AWNINGS[(cell * 5 + 2) % AWNINGS.length];
  const [tex, glow] = useMemo(
    () =>
      (["map", "glow"] as const).map((k) => {
        const t = windowTexture(k).clone();
        t.repeat.set(1, Math.max(1, Math.round(h * 1.4)));
        t.needsUpdate = true;
        return t;
      }),
    [h],
  );
  const baseRoof = useMemo(() => new THREE.Color(facade).lerp(new THREE.Color("#ffffff"), 0.25), [facade]);
  const heatColor = useMemo(() => new THREE.Color("#f43f5e"), []);
  const plotBase = useMemo(() => new THREE.Color("#334155"), []);
  const plotTint = useMemo(() => new THREE.Color(tone === "thief" ? "#fb7185" : zone ?? "#334155"), [tone, zone]);
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    if (alarm && (!alarmAt.current || alarmAt.current.key !== alarm.key)) alarmAt.current = { key: alarm.key, at: t };
    const alarmT = alarmAt.current ? t - alarmAt.current.at : 99;
    const alarming = alarmT < 1.6;
    const pulse = tone ? 0.5 + Math.sin(t * 5) * 0.5 : 0;
    if (mat.current) {
      mat.current.opacity += ((ghost ? 0.16 : 1) - mat.current.opacity) * Math.min(1, dt * 5);
      mat.current.emissiveIntensity = alarming ? (Math.sin(alarmT * 18) > 0 ? 1.4 : 0.2) : 0.65 + pulse * 0.35;
    }
    if (roof.current) {
      roof.current.opacity += ((ghost ? 0.2 : 1) - roof.current.opacity) * Math.min(1, dt * 5);
      roof.current.color.copy(baseRoof).lerp(heatColor, Math.min(0.85, heat > 0.004 ? 0.15 + heat * 2.2 : 0));
    }
    if (plot.current) {
      plot.current.color.copy(plotBase).lerp(plotTint, tone ? 0.55 + pulse * 0.45 : zone ? 0.75 : 0);
      plot.current.opacity = tone || zone ? 0.95 : 0.8;
    }
    if (siren.current) {
      siren.current.rotation.y = t * (alarming ? 14 : 5);
      siren.current.scale.setScalar(alarming ? 1.5 : 1);
    }
  });
  const label = `${tone === "search" ? "🔍 " : tone === "thief" ? "🏃 " : robbed ? "🚧 " : ""}${cellLabel(cell)}`;
  const roofLabel = heat > 0.004 ? `${label} ${Math.round(heat * 100)}%` : label;
  const labelColor = alarm && robbed ? "#ef4444" : tone === "search" ? zone ?? "#38bdf8" : tone === "thief" ? "#fb7185" : heat > 0.004 ? "#f43f5e" : robbed ? "#facc15" : "#94a3b8";
  const noteText = note ? (note.result === "trail" ? `흔적${note.tokens.map((t) => TOKEN_ICON[t]).join("")} R${note.round}` : note.result === "caught" ? `🔗 검거` : `✕ 빈집 R${note.round}`) : null;
  const front = FOOT / 2;
  const [cx0, , cz0] = canPos(cell);
  const can: V3 = [cx0 - cx(c), 0, cz0 - cz(r)];
  return (
    <group position={[cx(c), 0, cz(r)]} onClick={onClick}>
      {/* sidewalk plot — carries the watch-zone / target colour */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.012, 0]}>
        <planeGeometry args={[FOOT + 0.42, FOOT + 0.42]} />
        <meshBasicMaterial ref={plot} color="#334155" transparent depthWrite={false} />
      </mesh>
      <mesh position={[0, h / 2, 0]} castShadow={!lowDetail} receiveShadow>
        <boxGeometry args={[FOOT, h, FOOT]} />
        <meshStandardMaterial
          ref={mat}
          color={facade}
          map={tex}
          emissive={alarm && robbed ? "#ef4444" : tone === "thief" ? "#fb7185" : tone === "search" ? zone ?? "#38bdf8" : "#ffffff"}
          // keep the map fixed: swapping it null ↔ texture needs a shader recompile R3F doesn't trigger (→ all-white walls)
          emissiveMap={glow}
          emissiveIntensity={0.65}
          roughness={0.6}
          transparent
          depthWrite={!ghost}
        />
      </mesh>
      <mesh position={[0, h + 0.04, 0]}>
        <boxGeometry args={[FOOT + 0.06, 0.08, FOOT + 0.06]} />
        <meshStandardMaterial ref={roof} color={baseRoof} roughness={0.7} transparent depthWrite={!ghost} />
      </mesh>
      {!ghost && (
        <>
          {/* shop front: door + awning, facing the default camera (south) */}
          <mesh position={[0, 0.2, front + 0.005]}>
            <planeGeometry args={[0.3, 0.4]} />
            <meshBasicMaterial color={tone === "thief" ? "#fecdd3" : "#0f172a"} />
          </mesh>
          <mesh position={[0, 0.46, front + 0.1]} rotation-x={0.5}>
            <boxGeometry args={[0.6, 0.02, 0.24]} />
            <meshStandardMaterial color={awning} roughness={0.8} />
          </mesh>
          {/* trash can by the door — the thief's hiding spot */}
          <mesh position={[can[0], 0.17, can[2]]} castShadow={!lowDetail}>
            <cylinderGeometry args={[0.13, 0.11, 0.34, 10]} />
            <meshStandardMaterial color="#4d7c0f" roughness={0.6} metalness={0.3} />
          </mesh>
          <mesh position={[can[0], 0.355, can[2]]}>
            <cylinderGeometry args={[0.145, 0.145, 0.04, 10]} />
            <meshStandardMaterial color="#365314" />
          </mesh>
        </>
      )}
      {robbed && !ghost && (
        <>
          {[0.5, -0.5].map((tilt) => (
            <mesh key={tilt} position={[0, 0.22, front + 0.03]} rotation-z={tilt}>
              <planeGeometry args={[0.62, 0.07]} />
              <meshBasicMaterial map={policeTapeTexture()} />
            </mesh>
          ))}
          <group ref={siren} position={[0, h + 0.16, 0]}>
            <mesh>
              <cylinderGeometry args={[0.09, 0.11, 0.14, 10]} />
              <meshBasicMaterial color="#ef4444" />
            </mesh>
            <mesh position={[0.09, 0, 0]}>
              <boxGeometry args={[0.04, 0.1, 0.04]} />
              <meshBasicMaterial color="#fee2e2" />
            </mesh>
          </group>
        </>
      )}
      <Tag text={roofLabel} color={labelColor} position={[0, h + 0.32, 0]} height={tone ? 0.42 : 0.36} front={!!tone} />
      {alarm && robbed && <Tag text="🚨 이미 턴 곳 — 들켜요!" color="#ef4444" bg="rgba(127,29,29,0.95)" position={[0, h + 0.8, 0]} height={0.32} front />}
      {noteText && !ghost && !tone && <Tag text={noteText} color={note!.result === "trail" ? "#fbbf24" : "#94a3b8"} bg={note!.result === "trail" ? "rgba(120,53,15,0.92)" : "rgba(30,41,59,0.9)"} position={[0, h + 0.72, 0]} height={0.28} />}
      {clickable && (
        <mesh position={[0, h / 2, 0]} visible={false}>
          <boxGeometry args={[STEP * 0.92, h + 1, STEP * 0.92]} />
        </mesh>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

type FigureAnim = { walk: number; phase: number; crouch: number; cuffed: number; look: number };

/** A small stylised person (≈0.62 tall). The parent drives `anim` every frame. */
/** `vest` = a glowing hi-vis vest in that colour (the officer unit — navy alone vanishes in the night city). */
function Figure({ kind, anim, sack = 0, vest }: { kind: "thief" | "officer"; anim: React.MutableRefObject<FigureAnim>; sack?: number; vest?: string }) {
  const body = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const cuffs = useRef<THREE.Group>(null);
  useFrame(() => {
    const a = anim.current;
    const swing = Math.sin(a.phase) * 0.75 * a.walk;
    if (legL.current) legL.current.rotation.x = swing - a.crouch * 1.2;
    if (legR.current) legR.current.rotation.x = -swing - a.crouch * 1.2;
    const armForward = -1.05 * a.cuffed;
    if (armL.current) {
      armL.current.rotation.x = -swing * 0.9 + armForward - a.crouch * 0.6;
      armL.current.rotation.z = 0.35 * a.cuffed;
    }
    if (armR.current) {
      armR.current.rotation.x = swing * 0.9 + armForward - a.crouch * 0.6;
      armR.current.rotation.z = -0.35 * a.cuffed;
    }
    if (body.current) {
      body.current.position.y = -0.17 * a.crouch + Math.abs(Math.sin(a.phase)) * 0.03 * a.walk;
      body.current.rotation.x = 0.35 * a.crouch;
    }
    if (head.current) head.current.rotation.y = a.look;
    if (cuffs.current) cuffs.current.scale.setScalar(Math.max(0.001, a.cuffed));
  });
  const thief = kind === "thief";
  const skin = "#f1c27d";
  const top = thief ? "#ffffff" : "#1e3a8a";
  const legs = thief ? "#111827" : "#172554";
  return (
    <group>
      <group ref={body}>
        {[-1, 1].map((s) => (
          <group key={s} ref={s < 0 ? legL : legR} position={[s * 0.05, 0.26, 0]}>
            <mesh position={[0, -0.13, 0]}>
              <boxGeometry args={[0.075, 0.26, 0.085]} />
              <meshStandardMaterial color={legs} roughness={0.8} />
            </mesh>
          </group>
        ))}
        <mesh position={[0, 0.38, 0]}>
          <boxGeometry args={[0.21, 0.25, 0.13]} />
          <meshStandardMaterial color={top} map={thief ? stripeTexture() : null} roughness={0.7} />
        </mesh>
        {vest && (
          <>
            <mesh position={[0, 0.37, 0]}>
              <boxGeometry args={[0.23, 0.21, 0.15]} />
              <meshStandardMaterial color={vest} emissive={vest} emissiveIntensity={0.9} roughness={0.5} />
            </mesh>
            {[0.33, 0.42].map((y) => (
              <mesh key={y} position={[0, y, 0]}>
                <boxGeometry args={[0.235, 0.022, 0.155]} />
                <meshBasicMaterial color="#f8fafc" />
              </mesh>
            ))}
          </>
        )}
        {!thief && (
          <mesh position={[0.05, 0.45, vest ? 0.077 : 0.067]}>
            <circleGeometry args={[0.022, 8]} />
            <meshBasicMaterial color="#fbbf24" />
          </mesh>
        )}
        {[-1, 1].map((s) => (
          <group key={s} ref={s < 0 ? armL : armR} position={[s * 0.135, 0.49, 0]}>
            <mesh position={[0, -0.11, 0]}>
              <boxGeometry args={[0.06, 0.22, 0.065]} />
              <meshStandardMaterial color={thief ? "#111827" : "#1e3a8a"} roughness={0.7} />
            </mesh>
            <mesh position={[0, -0.235, 0]}>
              <sphereGeometry args={[0.032, 8, 6]} />
              <meshStandardMaterial color={skin} />
            </mesh>
            {!thief && s > 0 && (
              <mesh position={[0, -0.25, 0.05]} rotation-x={Math.PI / 2}>
                <cylinderGeometry args={[0.018, 0.024, 0.11, 8]} />
                <meshStandardMaterial color="#111827" metalness={0.5} />
              </mesh>
            )}
          </group>
        ))}
        <group ref={head} position={[0, 0.58, 0]}>
          <mesh>
            <sphereGeometry args={[0.08, 14, 12]} />
            <meshStandardMaterial color={skin} roughness={0.6} />
          </mesh>
          {thief ? (
            <>
              <mesh position={[0, 0.03, 0]}>
                <sphereGeometry args={[0.085, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
                <meshStandardMaterial color="#111827" roughness={0.9} />
              </mesh>
              <mesh position={[0, 0.0, 0.035]}>
                <boxGeometry args={[0.17, 0.035, 0.1]} />
                <meshStandardMaterial color="#020617" />
              </mesh>
            </>
          ) : (
            <>
              <mesh position={[0, 0.06, 0]}>
                <cylinderGeometry args={[0.085, 0.08, 0.06, 14]} />
                <meshStandardMaterial color="#172554" />
              </mesh>
              <mesh position={[0, 0.035, 0.06]} rotation-x={0.25}>
                <boxGeometry args={[0.13, 0.012, 0.07]} />
                <meshStandardMaterial color="#020617" />
              </mesh>
              <mesh position={[0, 0.075, 0.08]}>
                <circleGeometry args={[0.018, 8]} />
                <meshBasicMaterial color="#fbbf24" />
              </mesh>
            </>
          )}
        </group>
        {thief && sack > 0 && (
          <group position={[0, 0.42, -0.13]}>
            <mesh scale={[1, 1.1, 0.9]}>
              <sphereGeometry args={[0.1 + sack * 0.012, 12, 10]} />
              <meshStandardMaterial color="#a16207" roughness={0.95} />
            </mesh>
            <mesh position={[0, 0.12 + sack * 0.01, 0]}>
              <coneGeometry args={[0.04, 0.06, 8]} />
              <meshStandardMaterial color="#854d0e" />
            </mesh>
          </group>
        )}
        {thief && (
          <group ref={cuffs} position={[0, 0.3, 0.2]}>
            {[-0.035, 0.035].map((x) => (
              <mesh key={x} position={[x, 0, 0]} rotation-y={Math.PI / 2}>
                <torusGeometry args={[0.03, 0.009, 6, 14]} />
                <meshStandardMaterial color="#e5e7eb" metalness={0.9} roughness={0.2} />
              </mesh>
            ))}
          </group>
        )}
      </group>
    </group>
  );
}

/** Polyline (on the roads) from the thief's hiding spot to the next building's door. */
function walkRoute(from: Cell | null, to: Cell): THREE.Vector3[] {
  const [r1, c1] = cellRC(to);
  const v = (x: number, z: number) => new THREE.Vector3(x, 0, z);
  const pts: THREE.Vector3[] = [];
  if (from === null) {
    pts.push(v(px(c1 + 1), pz(GRID) + 1.6), v(px(c1 + 1), pz(r1 + 1)));
  } else {
    const [r0, c0] = cellRC(from);
    const [hx, , hz] = hidePos(from);
    const xRoad = c1 < c0 ? px(c0) : px(c0 + 1);
    pts.push(v(hx, hz), v(hx, pz(r0 + 1)), v(xRoad, pz(r0 + 1)), v(xRoad, pz(r1 + 1)));
  }
  const [dx, , dz] = doorPos(to);
  pts.push(v(cx(c1), pz(r1 + 1)), v(dx, dz));
  return pts.filter((p, i) => i === 0 || p.distanceToSquared(pts[i - 1]) > 1e-4);
}

type Move = { from: Cell | null; to: Cell; key: number };
const WALK_SPEED = 2.6;
const T_ENTER = 0.35;
const T_LOOT = 0.9;
const T_EXIT = 0.35;
const T_HIDE = 0.7;

/**
 * The thief's own character (thief view / game over only): walks the roads to the
 * chosen shop, slips in the door, robs it (💰 + window flash), then crouches in the
 * dark behind the trash can.
 */
function ThiefActor({ at, move, loot, label }: { at: Cell; move: Move | null; loot: number; label: string }) {
  const root = useRef<THREE.Group>(null);
  const flash = useRef<THREE.PointLight>(null);
  const popup = useRef<THREE.Sprite>(null);
  const anim = useRef<FigureAnim>({ walk: 0, phase: 0, crouch: 1, cuffed: 0, look: 0 });
  const start = useRef<{ key: number; at: number } | null>(null);
  const route = useMemo(() => (move ? walkRoute(move.from, move.to) : null), [move]);
  const lengths = useMemo(() => {
    if (!route) return [0];
    const out = [0];
    for (let k = 1; k < route.length; k++) out.push(out[k - 1] + route[k].distanceTo(route[k - 1]));
    return out;
  }, [route]);
  const heading = useRef(0);
  const shadowMat = useRef<THREE.MeshBasicMaterial>(null);
  const here = useRef<THREE.Mesh>(null);
  useFrame(({ clock }, dt) => {
    const g = root.current;
    if (!g) return;
    const now = clock.elapsedTime;
    const a = anim.current;
    const [hx, , hz] = hidePos(at);
    const [dx, , dz] = doorPos(at);
    let x = hx;
    let z = hz;
    let visible = 1;
    let crouch = 1;
    let walking = 0;
    let lootT = -1;
    let face = heading.current;
    if (move && route && move.to === at) {
      if (!start.current || start.current.key !== move.key) start.current = { key: move.key, at: now };
      const t = now - start.current.at;
      const total = lengths[lengths.length - 1];
      const tWalk = total / WALK_SPEED;
      if (t < tWalk) {
        const d = t * WALK_SPEED;
        let k = 1;
        while (k < lengths.length - 1 && lengths[k] < d) k++;
        const seg = clamp01((d - lengths[k - 1]) / Math.max(1e-6, lengths[k] - lengths[k - 1]));
        const p = route[k - 1].clone().lerp(route[k], seg);
        x = p.x;
        z = p.z;
        face = Math.atan2(route[k].x - route[k - 1].x, route[k].z - route[k - 1].z);
        crouch = 0;
        walking = 1;
      } else if (t < tWalk + T_ENTER) {
        const k = easeInOut((t - tWalk) / T_ENTER);
        x = dx;
        z = dz - k * 0.25;
        face = Math.PI;
        visible = 1 - k;
        crouch = 0;
        walking = 0.6;
      } else if (t < tWalk + T_ENTER + T_LOOT) {
        visible = 0;
        lootT = (t - tWalk - T_ENTER) / T_LOOT;
      } else if (t < tWalk + T_ENTER + T_LOOT + T_EXIT) {
        const k = easeInOut((t - tWalk - T_ENTER - T_LOOT) / T_EXIT);
        x = dx;
        z = dz - 0.25 + k * 0.25;
        face = 0;
        visible = k;
        crouch = 0;
        walking = 0.6;
      } else if (t < tWalk + T_ENTER + T_LOOT + T_EXIT + T_HIDE) {
        const k = easeOut((t - tWalk - T_ENTER - T_LOOT - T_EXIT) / T_HIDE);
        // door → round the front corner → into the alley
        const corner = { x: hx, z: dz };
        const k1 = clamp01(k * 2);
        const k2 = clamp01(k * 2 - 1);
        x = dx + (corner.x - dx) * k1;
        z = corner.z + (hz - corner.z) * k2;
        face = k < 0.5 ? Math.PI / 2 : Math.PI;
        crouch = k;
        walking = 1 - k;
      }
    }
    heading.current = face;
    a.walk += (walking - a.walk) * Math.min(1, dt * 10);
    a.phase += dt * 13 * a.walk;
    a.crouch += (crouch - a.crouch) * Math.min(1, dt * 8);
    a.look = a.crouch > 0.8 ? Math.sin(now * 0.9) * 0.7 : 0;
    g.position.set(x, 0, z);
    g.rotation.y = face;
    const s = Math.max(0.001, visible);
    g.scale.setScalar(s);
    if (shadowMat.current) shadowMat.current.opacity = 0.55 * a.crouch;
    if (here.current) {
      here.current.visible = a.crouch > 0.5;
      here.current.scale.setScalar(1 + Math.sin(now * 3) * 0.15);
    }
    if (flash.current) flash.current.intensity = lootT >= 0 ? (Math.sin(lootT * 30) > 0 ? 6 : 1) : 0;
    if (popup.current) {
      const show = lootT >= 0 ? lootT : -1;
      popup.current.visible = show >= 0;
      popup.current.position.y = buildingHeight(at) + 0.6 + show * 0.6;
      (popup.current.material as THREE.SpriteMaterial).opacity = show >= 0 ? 1 - Math.max(0, show - 0.7) / 0.3 : 0;
    }
  });
  const [r, c] = cellRC(at);
  const [hx, , hz] = hidePos(at);
  const lootTag = useMemo(() => tagTexture("💰 털었다!", "#facc15", "rgba(120,53,15,0.95)"), []);
  return (
    <>
      {/* the dark corner the thief crouches in */}
      <mesh rotation-x={-Math.PI / 2} position={[hx, 0.02, hz]}>
        <circleGeometry args={[0.3, 20]} />
        <meshBasicMaterial ref={shadowMat} color="#000000" transparent opacity={0.55} depthWrite={false} />
      </mesh>
      {/* "you are here" — a slow red pulse around the hiding spot */}
      <mesh ref={here} rotation-x={-Math.PI / 2} position={[hx, 0.025, hz]} renderOrder={4}>
        <ringGeometry args={[0.3, 0.38, 28]} />
        <meshBasicMaterial color="#fb7185" transparent opacity={0.8} depthWrite={false} />
      </mesh>
      <group ref={root}>
        <group scale={PERSON}>
          <Figure kind="thief" anim={anim} sack={loot} />
        </group>
        <Tag text={label} color="#fb7185" bg="rgba(76,5,25,0.92)" position={[0, 1.05, 0.55]} height={0.3} front />
      </group>
      <pointLight ref={flash} position={[cx(c), buildingHeight(at) * 0.5, cz(r)]} color="#fde047" intensity={0} distance={2.5} />
      <sprite ref={popup} position={[cx(c), 1.5, cz(r)]} scale={[0.34 * lootTag.aspect, 0.34, 1]} renderOrder={21} visible={false}>
        <spriteMaterial map={lootTag.tex} transparent depthWrite={false} depthTest={false} />
      </sprite>
    </>
  );
}

/** 🔗 Caught: right after the search stamp ("도둑 발견!") the thief is pulled out and handcuffed under flashing lights. */
function CaughtScene({ cell }: { cell: Cell }) {
  const root = useRef<THREE.Group>(null);
  const thief = useRef<THREE.Group>(null);
  const cop = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  const thiefAnim = useRef<FigureAnim>({ walk: 0, phase: 0, crouch: 0, cuffed: 0, look: 0 });
  const copAnim = useRef<FigureAnim>({ walk: 0, phase: 0, crouch: 0, cuffed: 0, look: 0 });
  const t0 = useRef<number | null>(null);
  const [dx, , dz] = hidePos(cell);
  const [click, setClick] = useState(false);
  useFrame(({ clock }, dt) => {
    if (t0.current === null) t0.current = clock.elapsedTime;
    const t = clock.elapsedTime - t0.current - (FX.hit + 0.2);
    if (root.current) root.current.visible = t > 0;
    if (t < 0) return;
    const out = easeOut(t / 0.6);
    if (thief.current) thief.current.position.set(dx, 0, dz + out * 0.1);
    const run = clamp01((t - 0.2) / 0.8);
    if (cop.current) {
      cop.current.position.set(dx, 0, dz + 1.3 - run * 0.85);
      cop.current.rotation.y = Math.PI;
    }
    copAnim.current.walk = run < 1 ? 1 : 0;
    copAnim.current.phase += dt * 14 * copAnim.current.walk;
    thiefAnim.current.cuffed = easeOut((t - 1.0) / 0.3);
    thiefAnim.current.look = Math.sin(t * 2) * 0.3;
    if (!click && t > 1.0) setClick(true);
    if (light.current) light.current.color.set(Math.sin(t * 10) > 0 ? "#ef4444" : "#3b82f6");
  });
  return (
    <group ref={root} visible={false}>
      <group ref={thief} rotation-y={0.25}>
        <group scale={PERSON}>
          <Figure kind="thief" anim={thiefAnim} sack={2} />
        </group>
      </group>
      <group ref={cop}>
        <group scale={PERSON}>
          <Figure kind="officer" anim={copAnim} />
        </group>
      </group>
      <pointLight ref={light} position={[dx, 1.2, dz + 0.5]} intensity={8} distance={4} />
      {click && <Tag text="🔗 수갑 철컥! 검거" color="#ef4444" bg="rgba(127,29,29,0.95)" position={[dx, 0.9, dz + 1.0]} height={0.42} front />}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Police units: 🚓 car · 👮 officer · 🚁 helicopter (same rules, different looks)
// ---------------------------------------------------------------------------

function PoliceCarModel({ lights }: { lights: React.RefObject<THREE.Group | null> }) {
  return (
    <group scale={0.95}>
      <mesh position={[0, 0.15, 0]} castShadow>
        <boxGeometry args={[0.46, 0.2, 0.9]} />
        <meshStandardMaterial color="#f8fafc" metalness={0.3} roughness={0.35} />
      </mesh>
      {[-0.3, 0.3].map((z) => (
        <mesh key={z} position={[0, 0.15, z]}>
          <boxGeometry args={[0.465, 0.2, 0.22]} />
          <meshStandardMaterial color="#0f172a" metalness={0.3} roughness={0.4} />
        </mesh>
      ))}
      <mesh position={[0, 0.32, -0.04]}>
        <boxGeometry args={[0.42, 0.16, 0.46]} />
        <meshStandardMaterial color="#1e293b" metalness={0.5} roughness={0.15} />
      </mesh>
      <group ref={lights} position={[0, 0.43, -0.04]}>
        <mesh position={[-0.09, 0, 0]}>
          <boxGeometry args={[0.14, 0.06, 0.1]} />
          <meshBasicMaterial color="#ef4444" />
        </mesh>
        <mesh position={[0.09, 0, 0]}>
          <boxGeometry args={[0.14, 0.06, 0.1]} />
          <meshBasicMaterial color="#3b82f6" />
        </mesh>
      </group>
      {[-0.24, 0.24].flatMap((x) =>
        [-0.3, 0.3].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.07, z]} rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[0.08, 0.08, 0.06, 12]} />
            <meshStandardMaterial color="#0a0a0a" />
          </mesh>
        )),
      )}
    </group>
  );
}

function HeliModel({ color, rotor }: { color: string; rotor: React.RefObject<THREE.Group | null> }) {
  return (
    <group rotation-y={-Math.PI / 2}>
      <mesh castShadow>
        <capsuleGeometry args={[0.22, 0.4, 6, 12]} />
        <meshStandardMaterial color="#1e3a8a" metalness={0.3} roughness={0.35} />
      </mesh>
      <mesh position={[0, -0.02, 0]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.225, 0.225, 0.12, 14]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0.12, 0.06, 0]} rotation-z={Math.PI / 2} scale={[1, 1, 0.9]}>
        <sphereGeometry args={[0.18, 12, 10, 0, Math.PI]} />
        <meshStandardMaterial color="#bae6fd" metalness={0.5} roughness={0.1} transparent opacity={0.85} />
      </mesh>
      <mesh position={[-0.6, 0.05, 0]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.05, 0.08, 0.7, 8]} />
        <meshStandardMaterial color="#1e3a8a" />
      </mesh>
      <mesh position={[-0.95, 0.15, 0]}>
        <boxGeometry args={[0.08, 0.25, 0.04]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {[-0.18, 0.18].map((z) => (
        <mesh key={z} position={[0, -0.32, z]} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.02, 0.02, 0.7, 6]} />
          <meshStandardMaterial color="#111827" />
        </mesh>
      ))}
      <group ref={rotor} position={[0, 0.34, 0]}>
        {[0, 1].map((k) => (
          <mesh key={k} rotation-y={(k * Math.PI) / 2}>
            <boxGeometry args={[1.5, 0.015, 0.07]} />
            <meshStandardMaterial color="#0f172a" />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function PoliceUnit({ at, index, active }: { at: Point; index: number; active: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);
  const lights = useRef<THREE.Group>(null);
  const rotor = useRef<THREE.Group>(null);
  const beacon = useRef<THREE.Mesh>(null);
  const cur = useRef<THREE.Vector3 | null>(null);
  const heading = useRef(0);
  const anim = useRef<FigureAnim>({ walk: 0, phase: 0, crouch: 0, cuffed: 0, look: 0 });
  const style = HELI_STYLES[index];
  const target = useMemo(() => new THREE.Vector3(...unitPos(at, index)), [at, index]);
  const [i, j] = pointIJ(at);
  useFrame(({ clock }, dt) => {
    const g = ref.current;
    if (!g) return;
    if (!cur.current) cur.current = target.clone();
    const prev = cur.current.clone();
    cur.current.lerp(target, 1 - Math.exp(-dt * (index === 1 ? 2.2 : 3)));
    const vel = cur.current.clone().sub(prev);
    const speed = vel.length() / Math.max(dt, 1e-3);
    if (speed > 0.05) heading.current = Math.atan2(vel.x, vel.z);
    g.position.copy(cur.current);
    if (index === 2) g.position.y += Math.sin(clock.elapsedTime * 2) * 0.06;
    g.rotation.y = heading.current;
    if (index === 2) g.rotation.x = Math.min(0.35, speed * 0.08);
    anim.current.walk += ((speed > 0.1 ? 1 : 0) - anim.current.walk) * Math.min(1, dt * 8);
    anim.current.phase += dt * 14 * anim.current.walk;
    anim.current.look = speed > 0.1 ? 0 : Math.sin(clock.elapsedTime * 1.3) * 0.6;
    if (lights.current) lights.current.scale.x = Math.sin(clock.elapsedTime * 12) > 0 ? 1 : -1;
    if (rotor.current) rotor.current.rotation.y += dt * 28;
    if (beacon.current) {
      beacon.current.position.y = (index === 1 ? 1.6 : 1.1) + Math.sin(clock.elapsedTime * 4) * 0.06;
      beacon.current.rotation.y = clock.elapsedTime * 2;
    }
    if (ring.current) ring.current.scale.setScalar(active ? 1.15 + Math.sin(clock.elapsedTime * 5) * 0.15 : 1);
    if (ringMat.current) ringMat.current.opacity = active ? 0.95 : 0.6;
  });
  return (
    <>
      {/* where the unit stands on the road grid — always on the ground, even for the helicopter */}
      <group position={[px(j), 0.02, pz(i)]}>
        <mesh ref={ring} rotation-x={-Math.PI / 2} renderOrder={4}>
          <ringGeometry args={[0.34, 0.46, 32]} />
          <meshBasicMaterial ref={ringMat} color={style.hex} transparent opacity={0.6} depthWrite={false} />
        </mesh>
        {index === 2 && (
          <mesh position={[0, HELI_ALT / 2, 0]}>
            <cylinderGeometry args={[0.015, 0.015, HELI_ALT, 6]} />
            <meshBasicMaterial color={style.hex} transparent opacity={0.45} depthWrite={false} />
          </mesh>
        )}
      </group>
      <group ref={ref}>
        {index === 0 && <PoliceCarModel lights={lights} />}
        {index === 1 && (
          <group scale={PERSON * 1.2}>
            <Figure kind="officer" anim={anim} vest={style.hex} />
          </group>
        )}
        {index !== 2 && (
          // a bobbing marker that stays on top of the buildings, so a ground unit is never lost behind one
          <mesh ref={beacon} position={[0, 1.75, 0]} rotation-x={Math.PI} renderOrder={21}>
            <coneGeometry args={[0.12, 0.22, 4]} />
            <meshBasicMaterial color={style.hex} depthTest={false} depthWrite={false} transparent />
          </mesh>
        )}
        {index === 2 && <HeliModel color={style.hex} rotor={rotor} />}
        <Tag text={`${style.icon}${index + 1}`} color={style.hex} position={[0, index === 2 ? 0.75 : index === 1 ? 2.05 : 1.55, 0]} height={active ? 0.4 : 0.32} front={active || index !== 2} />
      </group>
    </>
  );
}

/** Search timeline (s): beam shoots out → scan sweeps the shop → hit (burst + stamp) → fade. */
const FX = { beam: 0.4, scanFrom: 0.25, scanTo: 1.0, hit: 1.0, end: 2.6 };
const FX_PARTICLES = 32;
/** Deterministic 0..1 noise (no Math.random in render). */
const hash = (n: number) => Math.abs((Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1);

/**
 * The police search show, per unit: 🚁 wide sky searchlight, 🚓 siren red/blue
 * floodlight, 👮 narrow flashlight. Beam → x-ray scan plane sweeping the shop
 * top to bottom → twin ground shockwaves → result burst (token colours for a
 * trail, grey dust for an empty shop, red/blue for a catch) + a popping stamp.
 */
function SearchFx({ from, heli, cell, result, tokens }: { from: V3; heli: number; cell: Cell; result: SearchRecord["result"]; tokens: TokenColor[] }) {
  const [r, c] = cellRC(cell);
  const h = buildingHeight(cell);
  const color = HELI_STYLES[heli].hex;
  const t0 = useRef<number | null>(null);
  const beam = useRef<THREE.Mesh>(null);
  const beamMat = useRef<THREE.MeshBasicMaterial>(null);
  const core = useRef<THREE.Mesh>(null);
  const scan = useRef<THREE.Mesh>(null);
  const scanMat = useRef<THREE.MeshBasicMaterial>(null);
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const light = useRef<THREE.PointLight>(null);
  const stamp = useRef<THREE.Group>(null);
  const parts = useRef<(THREE.Mesh | null)[]>([]);
  const src = useMemo(() => new THREE.Vector3(from[0], from[1] + (heli === 2 ? -0.1 : 0.35), from[2]), [from, heli]);
  const to = useMemo(() => new THREE.Vector3(cx(c), h * 0.55, cz(r)), [c, r, h]);
  const { len, quat } = useMemo(() => {
    const d = to.clone().sub(src);
    return { len: d.length(), quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()) };
  }, [src, to]);
  const radius = heli === 2 ? 0.85 : heli === 0 ? 0.55 : 0.32;
  const partColors = useMemo(() => {
    const pal =
      result === "trail"
        ? (tokens.length ? tokens.map((t) => TOKEN_HEX[t]) : ["#fbbf24"]).concat("#fde68a")
        : result === "caught"
          ? ["#ef4444", "#3b82f6", "#ffffff"]
          : ["#94a3b8", "#cbd5e1", "#64748b"];
    return Array.from({ length: FX_PARTICLES }, (_, k) => pal[k % pal.length]);
  }, [result, tokens]);
  const vel = useMemo(
    () =>
      Array.from({ length: FX_PARTICLES }, (_, k) => {
        const a = hash(k) * Math.PI * 2;
        const sp = (result === "empty" ? 0.6 : 1.3) + hash(k + 50) * 1.2;
        return new THREE.Vector3(Math.cos(a) * sp, (result === "empty" ? 0.8 : 2.2) + hash(k + 99) * 1.6, Math.sin(a) * sp);
      }),
    [result],
  );
  const stampText = result === "trail" ? `🔍 흔적 발견! ${tokens.map((t) => TOKEN_ICON[t]).join("")}` : result === "caught" ? "🚨 도둑 발견!" : "✕ 빈 건물";
  const stampColor = result === "trail" ? "#fbbf24" : result === "caught" ? "#ef4444" : "#94a3b8";
  const stampBg = result === "trail" ? "rgba(120,53,15,0.95)" : result === "caught" ? "rgba(127,29,29,0.95)" : "rgba(30,41,59,0.92)";
  useFrame(({ clock }) => {
    const now = clock.elapsedTime;
    if (t0.current === null) t0.current = now;
    const t = now - t0.current;
    const fade = 1 - clamp01((t - (FX.end - 0.5)) / 0.5);
    // beam grows from the unit to the shop, then flickers
    const grow = Math.max(0.001, easeOut(t / FX.beam));
    for (const m of [beam.current, core.current]) {
      if (!m) continue;
      m.scale.set(1, grow, 1);
      m.position.set(0, (len * grow) / 2, 0);
    }
    if (beamMat.current) {
      beamMat.current.opacity = (0.38 + Math.sin(t * 28) * 0.1) * fade;
      if (heli === 0) beamMat.current.color.set(Math.sin(t * 14) > 0 ? "#ef4444" : "#3b82f6");
    }
    // x-ray scan plane: roof → ground
    const sk = clamp01((t - FX.scanFrom) / (FX.scanTo - FX.scanFrom));
    if (scan.current) {
      scan.current.visible = t > FX.scanFrom && sk < 1;
      scan.current.position.y = (h + 0.25) * (1 - easeInOut(sk));
    }
    if (scanMat.current) scanMat.current.opacity = 0.75 * Math.sin(sk * Math.PI);
    // twin shockwaves on the ground
    rings.current.forEach((m, k) => {
      if (!m) return;
      const rk = clamp01((t - FX.hit - k * 0.18) / 0.9);
      m.visible = rk > 0 && rk < 1;
      m.scale.setScalar(0.6 + easeOut(rk) * (result === "empty" ? 2.2 : 3.4));
      (m.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - rk);
    });
    // light on the shop: unit colour (siren red/blue for the car or a catch) + a flash on the hit
    if (light.current) {
      const flash = t > FX.hit ? Math.max(0, 1 - (t - FX.hit) * 2.5) * 10 : 0;
      light.current.intensity = (2.5 + Math.sin(t * 20) + flash) * fade;
      if (heli === 0 || result === "caught") light.current.color.set(Math.sin(t * 14) > 0 ? "#ef4444" : "#3b82f6");
    }
    // result burst
    const pt = t - FX.hit;
    parts.current.forEach((m, k) => {
      if (!m) return;
      m.visible = pt > 0 && pt < 1.4;
      if (!m.visible) return;
      const v = vel[k];
      m.position.set(v.x * pt, h * 0.7 + v.y * pt - 3.2 * pt * pt, v.z * pt);
      m.rotation.set(pt * 9 + k, pt * 7, 0);
      m.scale.setScalar(Math.max(0.001, 1 - pt / 1.4));
    });
    // stamp pops with a little overshoot
    if (stamp.current) {
      const st = clamp01(pt / 0.35);
      const back = st < 1 ? 1 + Math.sin(st * Math.PI) * 0.35 : 1;
      stamp.current.visible = pt > 0;
      stamp.current.scale.setScalar(Math.max(0.001, easeOut(st) * back * fade));
      stamp.current.position.y = h + 0.95 + clamp01(pt / 1.5) * 0.25;
    }
  });
  return (
    <group>
      <group position={src} quaternion={quat}>
        <mesh ref={beam} renderOrder={6}>
          <cylinderGeometry args={[radius, 0.05, len, 20, 1, true]} />
          <meshBasicMaterial ref={beamMat} color={color} transparent opacity={0.4} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        <mesh ref={core} renderOrder={6}>
          <cylinderGeometry args={[radius * 0.25, 0.02, len, 10, 1, true]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.55} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      </group>
      <group position={[cx(c), 0, cz(r)]}>
        <mesh ref={scan} visible={false} renderOrder={8}>
          <boxGeometry args={[FOOT + 0.18, 0.035, FOOT + 0.18]} />
          <meshBasicMaterial ref={scanMat} color={color} transparent opacity={0.7} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        {[0, 1].map((k) => (
          <mesh
            key={k}
            ref={(m) => {
              rings.current[k] = m;
            }}
            rotation-x={-Math.PI / 2}
            position={[0, 0.03, 0]}
            visible={false}
            renderOrder={7}
          >
            <ringGeometry args={[0.5, 0.6, 40]} />
            <meshBasicMaterial color={k === 0 ? color : stampColor} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
          </mesh>
        ))}
        {partColors.map((col, k) => (
          <mesh
            key={k}
            ref={(m) => {
              parts.current[k] = m;
            }}
            visible={false}
            renderOrder={9}
          >
            {result === "trail" && k % 3 === 0 ? <octahedronGeometry args={[0.07]} /> : <boxGeometry args={[0.07, 0.07, 0.07]} />}
            <meshBasicMaterial color={col} transparent depthWrite={false} />
          </mesh>
        ))}
        <pointLight ref={light} position={[0, h + 0.6, 0.4]} color={color} intensity={0} distance={3.5} />
        <group ref={stamp} visible={false}>
          <Tag text={stampText} color={stampColor} bg={stampBg} position={[0, 0, 0]} height={0.42} front />
        </group>
      </group>
    </group>
  );
}

function PointTarget({ p, color, placing, onClick }: { p: Point; color: string; placing: boolean; onClick: (e: ThreeEvent<MouseEvent>) => void }) {
  const [i, j] = pointIJ(p);
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ring.current) ring.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 5 + p) * 0.12);
  });
  return (
    <group position={[px(j), 0.03, pz(i)]} onClick={onClick}>
      <mesh ref={ring} rotation-x={-Math.PI / 2} renderOrder={7}>
        <ringGeometry args={[0.24, 0.4, 28]} />
        <meshBasicMaterial color={color} transparent opacity={0.95} depthWrite={false} depthTest={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} renderOrder={7}>
        <circleGeometry args={[0.24, 20]} />
        <meshBasicMaterial color={color} transparent opacity={0.3} depthWrite={false} depthTest={false} />
      </mesh>
      <Tag text={placing ? "＋" : "↗"} color={color} position={[0, 0.5, 0]} height={0.3} front />
      <mesh position={[0, 0.4, 0]} visible={false}>
        <cylinderGeometry args={[0.6, 0.6, 1, 8]} />
      </mesh>
    </group>
  );
}

function Route({ path, winner, endReason }: { path: Cell[]; winner: CityMapProps["state"]["winner"]; endReason: CityMapProps["state"]["endReason"] }) {
  const Y = 1.75;
  const geo = useMemo(() => {
    if (path.length < 2) return null;
    const curve = new THREE.CurvePath<THREE.Vector3>();
    for (let k = 1; k < path.length; k++) {
      const [r0, c0] = cellRC(path[k - 1]);
      const [r1, c1] = cellRC(path[k]);
      curve.add(new THREE.LineCurve3(new THREE.Vector3(cx(c0), Y, cz(r0)), new THREE.Vector3(cx(c1), Y, cz(r1))));
    }
    return new THREE.TubeGeometry(curve, path.length * 8, 0.07, 6, false);
  }, [path]);
  const [drawn, setDrawn] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setDrawn((d) => (d >= path.length ? d : d + 1)), 250);
    return () => window.clearInterval(t);
  }, [path.length]);
  return (
    <group>
      {geo && (
        <mesh geometry={geo} renderOrder={15}>
          <meshBasicMaterial color="#ef4444" depthTest={false} transparent opacity={0.9} />
        </mesh>
      )}
      {path.slice(0, drawn).map((cell, k) => {
        const [r, c] = cellRC(cell);
        const round = k + 1;
        const last = k === path.length - 1;
        const text = last ? `${round} ${winner === "thief" ? "🏆 탈출" : endReason === "trapped" ? "🚧 갇힘" : "🔗 검거"}` : round === 1 ? "1 START" : round === MIDPOINT_ROUND ? `${round} 💜` : String(round);
        return <Tag key={k} text={text} color={round === MIDPOINT_ROUND ? "#a855f7" : last ? "#ffffff" : "#ef4444"} bg={round === 1 ? "rgba(161,98,7,0.95)" : "rgba(127,29,29,0.95)"} position={[cx(c), Y + 0.3, cz(r)]} height={0.32} front />;
      })}
    </group>
  );
}

export type CameraMode = "city" | "top";

type Focus = { x: number; z: number; key: number; shake: number };

/** City = orbit (drag to swing / tilt), top = near-vertical 2.5D map with the drag disabled. A search `focus` pushes in and shakes. */
function CameraRig({ mode, focus }: { mode: CameraMode; focus: Focus | null }) {
  const focusAt = useRef<{ key: number; at: number } | null>(null);
  const gl = useThree((s) => s.gl);
  const yaw = useRef(0);
  const yawTarget = useRef(0);
  const pitch = useRef(1.2);
  const pitchTarget = useRef(1.2);
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
    if (mode === "top") {
      yawTarget.current = 0;
      pitchTarget.current = 1.5;
    } else pitchTarget.current = 1.2;
  }, [mode]);
  useEffect(() => {
    const el = gl.domElement;
    let drag: { x: number; y: number; yaw: number; pitch: number } | null = null;
    const down = (e: PointerEvent) => {
      if (modeRef.current === "top") return;
      drag = { x: e.clientX, y: e.clientY, yaw: yawTarget.current, pitch: pitchTarget.current };
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      yawTarget.current = drag.yaw - ((e.clientX - drag.x) / (el.clientWidth || 1)) * 3.2;
      pitchTarget.current = Math.max(0.7, Math.min(1.45, drag.pitch + ((e.clientY - drag.y) / (el.clientHeight || 1)) * 1.6));
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
    const fov = 42;
    const need = (GRID * STEP + 2.4) / 2 / Math.tan(((fov / 2) * Math.PI) / 180);
    let dist = (need / Math.min(1, aspect)) * (modeRef.current === "top" ? 1.0 : 0.98);
    let lx = 0;
    let lz = 0;
    let shake = 0;
    const now = frame.clock.elapsedTime;
    if (focus) {
      if (!focusAt.current || focusAt.current.key !== focus.key) focusAt.current = { key: focus.key, at: now };
      const ft = now - focusAt.current.at;
      const w = ft < 0.5 ? easeInOut(ft / 0.5) : 1 - easeInOut((ft - (FX.end - 0.6)) / 0.6);
      dist *= 1 - 0.14 * w;
      lx = focus.x * 0.3 * w;
      lz = focus.z * 0.3 * w;
      const hitT = ft - FX.hit;
      if (hitT > 0) shake = focus.shake * Math.max(0, 1 - hitT * 2.5);
    }
    const sx = Math.sin(now * 61) * shake;
    const sy = Math.sin(now * 53 + 1) * shake;
    cam.position.set(lx + sx + Math.sin(yaw.current) * Math.cos(pitch.current) * dist, sy + Math.sin(pitch.current) * dist, lz + Math.cos(yaw.current) * Math.cos(pitch.current) * dist);
    cam.lookAt(lx + sx * 0.5, 0, lz + (modeRef.current === "top" ? 0.15 : 0.5));
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  });
  return null;
}

type SceneProps = CityMapProps & { reveal: Reveal | null; move: Move | null; alarm: Alarm | null; lowDetail: boolean; camMode: CameraMode };

function SceneContents(props: SceneProps) {
  const { state, showSecret, revealRoute, thiefTargets, heliControls, heat, latestSearch, reveal, move, alarm, lowDetail, camMode } = props;
  // the colour of the first unit that can search each building = the watch zone painted on its sidewalk
  const zone = new Map<Cell, string>();
  state.helis.forEach((p, h) => {
    for (const c of pointCells(p)) if (!zone.has(c)) zone.set(c, HELI_STYLES[h].hex);
  });
  const thiefAt = state.path.length ? state.path[state.path.length - 1] : null;
  const roundOf = new Map<Cell, number>();
  if (showSecret) state.path.forEach((c, i) => roundOf.set(c, i + 1));
  const over = state.phase === "gameOver";
  const caughtCell = over && state.endReason === "caught" ? thiefAt : null;
  const thiefTurn = !!thiefTargets;
  const tap = (e: ThreeEvent<MouseEvent>, fn: () => void) => {
    e.stopPropagation();
    if (e.delta > 8) return;
    fn();
  };
  return (
    <>
      <color attach="background" args={["#070b18"]} />
      <fog attach="fog" args={["#070b18", 20, 42]} />
      <ambientLight intensity={0.6} color="#bfdbfe" />
      <hemisphereLight args={["#7dd3fc", "#0f172a", 0.6]} />
      <directionalLight
        position={[-6, 14, 9]}
        intensity={1.2}
        color="#e0e7ff"
        castShadow={!lowDetail}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
      />
      <Ground />
      {Array.from({ length: CELL_COUNT }, (_, cell) => {
        const isThiefTarget = thiefTargets?.has(cell) ?? false;
        const isSearchTarget = heliControls?.searchTargets.includes(cell) ?? false;
        // on the thief's turn every building answers a tap (a robbed one sounds the alarm)
        const clickable = isThiefTarget || isSearchTarget || thiefTurn;
        const searching = reveal?.cell === cell ? reveal : null;
        const round = roundOf.get(cell);
        const chips = searching
          ? searching.tokens.map((t) => ({ color: t, n: TOKEN_ROUND[t] }))
          : round !== undefined
            ? [{ color: tokenColor(round), n: round }]
            : [];
        const [dx, , dz] = doorPos(cell);
        return (
          <group key={cell}>
            {chips.map((t, k) => (
              <Chip key={k} color={t.color} n={t.n} position={[dx - 0.4 + k * 0.3, 0.03, dz + 0.12]} />
            ))}
            <Building
              cell={cell}
              clickable={clickable}
              tone={isSearchTarget ? "search" : isThiefTarget ? "thief" : null}
              zone={isSearchTarget && heliControls ? HELI_STYLES[heliControls.heli].hex : zone.get(cell) ?? null}
              heat={heat ? heat[cell] : 0}
              note={latestSearch.get(cell)}
              ghost={!!searching || caughtCell === cell}
              robbed={showSecret && !over && round !== undefined && cell !== thiefAt}
              alarm={alarm?.cell === cell ? alarm : null}
              onClick={(e) => clickable && tap(e, () => props.onCellClick?.(cell))}
              lowDetail={lowDetail}
            />
          </group>
        );
      })}
      {heliControls?.moveTargets.map((p) => (
        <PointTarget key={`t${p}`} p={p} color={HELI_STYLES[heliControls.heli].hex} placing={!!heliControls.placing} onClick={(e) => tap(e, () => props.onPointClick?.(p))} />
      ))}
      {state.helis.map((p, h) => (
        <PoliceUnit key={h} at={p} index={h} active={(state.phase === "police" || state.phase === "deploy") && state.heliTurn === h} />
      ))}
      {reveal && state.helis[reveal.heli] !== undefined && <SearchFx key={reveal.key} from={unitPos(state.helis[reveal.heli], reveal.heli)} heli={reveal.heli} cell={reveal.cell} result={reveal.result} tokens={reveal.tokens} />}
      {showSecret && thiefAt !== null && caughtCell === null && <ThiefActor at={thiefAt} move={move} loot={state.path.length} label={over ? "🦹 도둑" : "🦹 나 (숨는 중)"} />}
      {caughtCell !== null && <CaughtScene cell={caughtCell} />}
      {revealRoute && state.path.length > 0 && <Route path={state.path} winner={state.winner} endReason={state.endReason} />}
      <CameraRig
        mode={camMode}
        focus={reveal ? { x: cx(cellRC(reveal.cell)[1]), z: cz(cellRC(reveal.cell)[0]), key: reveal.key, shake: reveal.result === "empty" ? 0.03 : reveal.result === "trail" ? 0.08 : 0.16 } : null}
      />
    </>
  );
}

function readCamMode(): CameraMode {
  try {
    return window.localStorage.getItem("city-chase-cam") === "top" ? "top" : "city";
  } catch {
    return "city";
  }
}

export default function CityMap3D(props: CityMapProps & { lowDetail: boolean; alarm?: Alarm | null }) {
  const { state } = props;
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [move, setMove] = useState<Move | null>(null);
  const [lastSeq, setLastSeq] = useState(state.seq);
  const [camMode, setCamModeState] = useState<CameraMode>(readCamMode);
  const setCamMode = (m: CameraMode) => {
    setCamModeState(m);
    try {
      window.localStorage.setItem("city-chase-cam", m);
    } catch {
      /* private mode — keep the in-memory choice */
    }
  };
  // Search → beam + see-through building; thief move → walk + rob + hide (thief view). Keyed off `seq`.
  if (lastSeq !== state.seq) {
    setLastSeq(state.seq);
    const ev = state.lastEvent;
    if (ev?.kind === "search") setReveal({ cell: ev.cell, heli: ev.heli, result: ev.result, tokens: ev.tokens, key: state.seq });
    if (ev?.kind === "thiefMove" && props.showSecret && state.path.length > 0) {
      setMove({ from: state.path.length > 1 ? state.path[state.path.length - 2] : null, to: state.path[state.path.length - 1], key: state.seq });
    }
  }
  useEffect(() => {
    if (!reveal || reveal.result === "caught") return;
    const t = window.setTimeout(() => setReveal((r) => (r && r.key === reveal.key ? null : r)), FX.end * 1000);
    return () => window.clearTimeout(t);
  }, [reveal]);
  const high = !props.lowDetail;
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[min(92vw,620px)] overflow-hidden rounded-3xl ring-1 ring-white/10">
      <Canvas
        shadows={high}
        dpr={high ? [1, 1.75] : [1, 1.25]}
        gl={{ antialias: high, powerPreference: "high-performance" }}
        camera={{ fov: 42, position: [0, 14, 10], near: 0.1, far: 120 }}
        style={{ touchAction: "none" }}
      >
        <SceneContents {...props} reveal={reveal} move={move} alarm={props.alarm ?? null} camMode={camMode} />
      </Canvas>
      <button
        type="button"
        onClick={() => setCamMode(camMode === "top" ? "city" : "top")}
        className="absolute left-2 top-2 z-[60] rounded-full border border-white/20 bg-black/60 px-2.5 py-1 text-[11px] text-white/80 hover:border-white/40"
      >
        {camMode === "top" ? "🎥 입체 시점" : "🗺️ 탑뷰"}
      </button>
      {reveal && reveal.result === "caught" && (
        <div className="pointer-events-none absolute inset-x-0 top-12 z-50 flex justify-center">
          <div className="rounded-2xl bg-red-600/90 px-5 py-3 text-center text-lg font-black text-white shadow-2xl" style={{ animation: "cc3d-pop .5s ease-out 2.4s both, cc3d-fade .5s ease-in 4.8s forwards" }}>
            🔗 수갑 철컥! {cellLabel(reveal.cell)}에서 검거
          </div>
        </div>
      )}
      <span className="pointer-events-none absolute bottom-2 left-1/2 max-w-[92%] -translate-x-1/2 truncate rounded-full bg-black/55 px-3 py-1 text-[11px] whitespace-nowrap text-white/70">
        {camMode === "top" ? "빛나는 건물/교차로를 탭" : "드래그로 회전 · 빛나는 건물/교차로를 탭"}
      </span>
      <style>{`
        @keyframes cc3d-pop { 0% { transform: scale(.3); opacity: 0 } 60% { transform: scale(1.15); opacity: 1 } 100% { transform: scale(1) } }
        @keyframes cc3d-fade { to { opacity: 0; transform: scale(.9) } }
      `}</style>
    </div>
  );
}
