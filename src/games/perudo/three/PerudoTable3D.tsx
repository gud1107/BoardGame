"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import TableScene, { useTableGeo, type TableSeat, type TableTheme } from "@/games/shared/three/TableScene";
import { Clickable, GlowDisc, HitBox, PopIn, TableSign } from "@/games/shared/three/tablePieces";
import { easeInOut, paintedTexture, polar, type BubbleStyle } from "@/games/shared/three/tableKit";
import type { PersonMood } from "@/games/shared/three/SeatedPerson";

/**
 * 페루도 3D — 해 질 녘 안데스 석조 마당. 각자 앞에 가죽 컵이 엎어져 있고(속
 * 주사위는 안 보임), 내 컵도 기본은 덮여 있다 — 내 컵을 누르거나 HUD의
 * "👀 내 주사위 보기"로 들어 올려야(`peek`, 이 브라우저에서만) 보인다. 차례인
 * 사람의 컵은 제 쪽으로 살짝 들썩이며 몰래 확인하는 시늉만 한다(값은 없음).
 * 테이블 위엔 1…전체 주사위 수의 원형 배팅 트랙이 깔려 현재 선언(금색 주사위
 * 말)과 내 초안(보라 유령 주사위)이 그 칸에 서고, 내 차례엔 칸을 눌러 개수를
 * 고른다. "페루도!"/"맞아!"가 나오면 모든 컵이 들리며 주사위가 드러나고 선언한
 * 눈(+페루도 와일드)이 빛난다. 라운드가 바뀌면 컵을 흔들어 굴리는 동작.
 *
 * 보드가 볼 수 있는 주사위만 넘긴다(진행 중엔 내 것만, 공개 단계에선
 * `lastResolution.revealedDice`). 숨은 주사위 값은 이 장면에 오지 않는다.
 */

export interface PerudoColor3D {
  body: string;
  ink: string;
  shadow: string;
}

export interface PerudoSeat3D {
  seat: number;
  /** 연결 끊김(봇 대체 전). */
  away?: boolean;
  name: string;
  diceCount: number;
  /** 보이는 주사위 값(null = 컵 속, 안 보임). */
  dice: number[] | null;
  color: PerudoColor3D;
  out: boolean;
}

export interface PerudoReveal3D {
  kind: "dudo" | "calza";
  actorSeat: number;
  bidSeat: number;
  face: number;
  quantity: number;
  actualCount: number;
  affectedSeat: number;
  diceDelta: number;
  exactHitSeats: number[];
}

export interface PerudoTable3DProps {
  playerCount: number;
  viewerSeat: number;
  seats: PerudoSeat3D[];
  activeSeat: number | null;
  bid: { seat: number; quantity: number; face: number } | null;
  reveal: PerudoReveal3D | null;
  roundNumber: number;
  overview: boolean;
  lowDetail: boolean;
  /** 전체 주사위 수 — 원형 트랙의 칸 수. */
  totalDice: number;
  /** 내 컵을 들어 올려 내 주사위를 보는 중(로컬 전용). */
  peek: boolean;
  onTogglePeek?: (() => void) | null;
  /** 내 차례에 짜고 있는 선언(현재 선언과 다를 때만 보라 유령 말로 표시). */
  draft: { quantity: number; face: number } | null;
  /** 트랙 칸 클릭(내 차례에 고를 수 있는 칸만) — 없으면 클릭 불가. */
  onPickQuantity?: ((q: number) => void) | null;
  quantityEnabled?: (q: number) => boolean;
}

const SEAT_COLORS = ["#f97316", "#38bdf8", "#4ade80", "#c084fc", "#f43f5e", "#22d3ee", "#facc15", "#a3e635"];
const FACE_NAME: Record<number, string> = { 1: "페루도", 2: "2눈", 3: "3눈", 4: "4눈", 5: "5눈", 6: "6눈" };

// ---------------------------------------------------------------------------
// Dice
// ---------------------------------------------------------------------------

const PIPS: Record<number, [number, number][]> = {
  2: [[0.28, 0.28], [0.72, 0.72]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
  6: [[0.28, 0.24], [0.72, 0.24], [0.28, 0.5], [0.72, 0.5], [0.28, 0.76], [0.72, 0.76]],
};

function dieFace(value: number, c: PerudoColor3D): THREE.CanvasTexture {
  return paintedTexture(`perudo:die:${value}:${c.body}:${c.ink}`, 128, 128, (ctx, W) => {
    const g = ctx.createRadialGradient(W / 2, W / 2, 10, W / 2, W / 2, W * 0.75);
    g.addColorStop(0, c.body);
    g.addColorStop(1, c.shadow);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, W);
    ctx.fillStyle = c.ink;
    if (value === 1) {
      // 페루도 crest: an Inca sun
      ctx.save();
      ctx.translate(W / 2, W / 2);
      for (let i = 0; i < 12; i++) {
        ctx.rotate(Math.PI / 6);
        ctx.beginPath();
        ctx.moveTo(-6, -24);
        ctx.lineTo(0, -46);
        ctx.lineTo(6, -24);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c.body;
      ctx.beginPath();
      ctx.arc(-7, -4, 3.5, 0, Math.PI * 2);
      ctx.arc(7, -4, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = c.body;
      ctx.beginPath();
      ctx.arc(0, 3, 9, 0.2, Math.PI - 0.2);
      ctx.stroke();
      ctx.restore();
      return;
    }
    for (const [x, y] of PIPS[value]) {
      ctx.beginPath();
      ctx.arc(x * W, y * W, W * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

const dieGeo = new RoundedBoxGeometry(0.13, 0.13, 0.13, 3, 0.022);
// box material order: +x, -x, +y(top), -y, +z, -z
const SIDES: Record<number, number[]> = {
  1: [3, 4, 1, 6, 2, 5],
  2: [3, 4, 2, 5, 1, 6],
  3: [1, 6, 3, 4, 2, 5],
  4: [6, 1, 4, 3, 2, 5],
  5: [3, 4, 5, 2, 6, 1],
  6: [4, 3, 6, 1, 2, 5],
};

function Die({ value, color, glow, dim }: { value: number; color: PerudoColor3D; glow: boolean; dim: boolean }) {
  const mats = useMemo(
    () =>
      SIDES[value].map(
        (v) =>
          new THREE.MeshStandardMaterial({
            map: dieFace(v, color),
            roughness: 0.32,
            metalness: 0.02,
            color: new THREE.Color().setScalar(dim ? 0.45 : 1),
            emissive: glow ? "#fbbf24" : "#000000",
            emissiveIntensity: glow ? 0.22 : 0,
          }),
      ),
    [value, color, glow, dim],
  );
  useEffect(() => () => mats.forEach((m) => m.dispose()), [mats]);
  return <mesh geometry={dieGeo} material={mats} castShadow position={[0, 0.065, 0]} />;
}

/** Dice in a small cluster (two rows) — deterministic jitter per slot. */
function DiceCluster({ dice, color, face, wild, roundKey }: { dice: number[]; color: PerudoColor3D; face: number | null; wild: boolean; roundKey: string }) {
  const n = dice.length;
  const perRow = n > 5 ? Math.ceil(n / 2) : n;
  return (
    <group>
      {dice.map((v, i) => {
        const row = Math.floor(i / perRow);
        const col = i % perRow;
        const inRow = row === 0 ? Math.min(perRow, n) : n - perRow;
        const x = (col - (inRow - 1) / 2) * 0.16;
        const z = row * -0.17 + (n > perRow ? 0.08 : 0);
        const jr = Math.sin(i * 91.7 + roundKey.length) * 0.35;
        const matches = face !== null && (v === face || (wild && v === 1));
        return (
          <group key={`${roundKey}-${i}`} position={[x, 0, z]} rotation-y={jr}>
            <PopIn delay={i * 0.05}>
              {matches && <GlowDisc color="#fbbf24" r={0.11} opacity={0.6} />}
              <Die value={v} color={color} glow={matches} dim={face !== null && !matches} />
            </PopIn>
          </group>
        );
      })}
    </group>
  );
}

const cupProfile = [
  [0.0, 0.0],
  [0.16, 0.0],
  [0.175, 0.02],
  [0.19, 0.26],
  [0.205, 0.3],
  [0.19, 0.3],
  [0.175, 0.03],
  [0.0, 0.03],
].map(([x, y]) => new THREE.Vector2(x, y));

/**
 * A leather dice cup. Closed: mouth down over the dice. Open: lifted, tipped
 * and set down beside them, mouth up. Shakes for a moment when `shakeKey`
 * changes (a new round's roll).
 */
function Cup({ open, accent, shakeKey, lowDetail, sneak = false }: { open: boolean; accent: string; shakeKey: string; lowDetail: boolean; sneak?: boolean }) {
  const geo = useMemo(() => new THREE.LatheGeometry(cupProfile, lowDetail ? 16 : 28), [lowDetail]);
  const ref = useRef<THREE.Group>(null);
  const t = useRef(open ? 1 : 0);
  const sn = useRef(0);
  const shake = useRef<{ key: string; at: number }>({ key: shakeKey, at: -10 });
  useFrame(({ clock }, dt) => {
    const g = ref.current;
    if (!g) return;
    if (shake.current.key !== shakeKey) shake.current = { key: shakeKey, at: clock.elapsedTime };
    t.current += ((open ? 1 : 0) - t.current) * (1 - Math.exp(-dt * 4));
    const e = easeInOut(t.current);
    const since = clock.elapsedTime - shake.current.at;
    const s = since < 1.1 ? Math.sin(since * 38) * (1 - since / 1.1) : 0;
    // sneak: the owner tips the near edge up now and then to check underneath (shows nothing)
    const wantSneak = sneak && !open ? Math.max(0, Math.sin(clock.elapsedTime * 1.3)) ** 3 : 0;
    sn.current += (wantSneak - sn.current) * (1 - Math.exp(-dt * 6));
    // closed: upside down centred on the dice; open: tipped up and parked to the side
    g.position.set(0.3 * e + s * 0.03, 0.31 * (1 - e) + Math.sin(Math.PI * e) * 0.35 + Math.abs(s) * 0.05 + sn.current * 0.07, -0.02 * e);
    g.rotation.set(-sn.current * 0.45, 0, Math.PI * (1 - e) + s * 0.12);
  });
  return (
    <group ref={ref}>
      <mesh geometry={geo} castShadow receiveShadow>
        <meshStandardMaterial color="#6b3a1f" roughness={0.7} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.197, 0.192, 0.045, lowDetail ? 16 : 28, 1, true]} />
        <meshStandardMaterial color={accent} roughness={0.6} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.09, 0]}>
        <cylinderGeometry args={[0.18, 0.177, 0.02, lowDetail ? 16 : 28, 1, true]} />
        <meshStandardMaterial color="#e9b949" roughness={0.45} metalness={0.5} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

function weaveTexture(): THREE.Texture {
  const t = paintedTexture("perudo:weave", 512, 512, (ctx, W) => {
    ctx.fillStyle = "#7a2e16";
    ctx.fillRect(0, 0, W, W);
    const bands = ["#b4461f", "#e3a73b", "#1f5d63", "#f1e3c2", "#8a1c2b", "#e3a73b"];
    // concentric Andean stripes
    for (let i = 0; i < 9; i++) {
      ctx.strokeStyle = bands[i % bands.length];
      ctx.lineWidth = i % 3 === 0 ? 16 : 7;
      ctx.beginPath();
      ctx.arc(W / 2, W / 2, 40 + i * 26, 0, Math.PI * 2);
      ctx.stroke();
    }
    // step-diamond motif ring
    ctx.fillStyle = "#f1e3c2";
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const x = W / 2 + Math.cos(a) * 205;
      const y = W / 2 + Math.sin(a) * 205;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4 + a);
      ctx.fillRect(-7, -7, 14, 14);
      ctx.restore();
    }
    // woven grain
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "#000";
    for (let y = 0; y < W; y += 4) ctx.fillRect(0, y, W, 1);
    ctx.globalAlpha = 1;
  });
  return t;
}

function stoneTexture(): THREE.Texture {
  const t = paintedTexture("perudo:stone", 512, 256, (ctx, W, H) => {
    ctx.fillStyle = "#6b5f52";
    ctx.fillRect(0, 0, W, H);
    // polygonal Inca masonry
    let y = 0;
    let row = 0;
    while (y < H) {
      const h = 44 + ((row * 37) % 22);
      let x = -((row * 53) % 60);
      while (x < W) {
        const w = 70 + ((x * 13 + row * 29) % 50);
        const shade = 92 + ((x * 7 + row * 11) % 40);
        ctx.fillStyle = `rgb(${shade + 20},${shade + 8},${shade - 6})`;
        ctx.beginPath();
        ctx.roundRect(x + 3, y + 3, w - 6, h - 6, 10);
        ctx.fill();
        x += w;
      }
      y += h;
      row++;
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(8, 1);
  return t;
}

function Torch({ position, light }: { position: [number, number, number]; light: boolean }) {
  const flame = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const f = 1 + Math.sin(clock.elapsedTime * 15 + position[0] * 3) * 0.14;
    flame.current?.scale.set(1, f, 1);
  });
  return (
    <group position={position}>
      <mesh position={[0, -0.6, 0]}>
        <cylinderGeometry args={[0.05, 0.07, 1.4, 8]} />
        <meshStandardMaterial color="#3b2412" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.12, 0]}>
        <cylinderGeometry args={[0.16, 0.1, 0.16, 10]} />
        <meshStandardMaterial color="#8a6d3b" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh ref={flame} position={[0, 0.36, 0]}>
        <coneGeometry args={[0.13, 0.4, 10]} />
        <meshBasicMaterial color="#ffae42" />
      </mesh>
      {light && <pointLight position={[0, 0.5, 0]} color="#ff9440" intensity={7} distance={7} decay={2} />}
    </group>
  );
}

function IncaCourtyard({ lowDetail }: { lowDetail: boolean }) {
  const seg = lowDetail ? 24 : 48;
  const stone = useMemo(() => stoneTexture(), []);
  const mountains = useMemo(
    () =>
      Array.from({ length: 11 }, (_, i) => {
        const a = (i / 11) * Math.PI * 2 + 0.3;
        const h = 6 + ((i * 37) % 7);
        return { a, h, r: 3.5 + ((i * 13) % 3) };
      }),
    [],
  );
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[30, seg]} />
        <meshStandardMaterial color="#5c4a36" roughness={1} />
      </mesh>
      {/* flagstone plaza */}
      <mesh position={[0, 0.005, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[7.5, seg]} />
        <meshStandardMaterial color="#8a7b68" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.007, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[4.2, 4.5, seg]} />
        <meshStandardMaterial color="#b4461f" roughness={0.9} />
      </mesh>
      {/* low trapezoid masonry wall with niches */}
      <mesh position={[0, 1.2, 0]}>
        <cylinderGeometry args={[9.6, 10, 2.4, seg, 1, true]} />
        <meshStandardMaterial map={stone} roughness={0.95} side={THREE.BackSide} />
      </mesh>
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return (
          <group key={i} position={[Math.sin(a) * 9.5, 0, Math.cos(a) * 9.5]} rotation-y={a + Math.PI}>
            <mesh position={[0, 1.15, 0.02]}>
              <shapeGeometry args={[trapezoid()]} />
              <meshBasicMaterial color="#2a1f17" />
            </mesh>
            {i % 3 === 1 && <Torch position={[0.9, 1.6, 0.4]} light={!lowDetail && i % 6 === 1} />}
          </group>
        );
      })}
      {/* distant snow-capped Andes */}
      {mountains.map((m, i) => (
        <group key={i} position={[Math.sin(m.a) * 26, 0, Math.cos(m.a) * 26]}>
          <mesh position={[0, m.h / 2, 0]}>
            <coneGeometry args={[m.r, m.h, 6]} />
            <meshStandardMaterial color="#3b2f45" roughness={1} flatShading />
          </mesh>
          <mesh position={[0, m.h - m.h * 0.12, 0]}>
            <coneGeometry args={[m.r * 0.25, m.h * 0.25, 6]} />
            <meshStandardMaterial color="#f5e6e0" roughness={0.8} flatShading />
          </mesh>
        </group>
      ))}
      {/* setting sun low on the horizon */}
      <mesh position={[-14, 4, -22]}>
        <circleGeometry args={[2.2, 32]} />
        <meshBasicMaterial color="#ffb35c" fog={false} />
      </mesh>
    </group>
  );
}

let trapShape: THREE.Shape | null = null;
function trapezoid(): THREE.Shape {
  if (trapShape) return trapShape;
  const s = new THREE.Shape();
  s.moveTo(-0.35, -0.55);
  s.lineTo(0.35, -0.55);
  s.lineTo(0.24, 0.55);
  s.lineTo(-0.24, 0.55);
  s.closePath();
  trapShape = s;
  return s;
}

// ---------------------------------------------------------------------------
// Centre: the current bid as a big die + count
// ---------------------------------------------------------------------------

const SIGN_STYLE: BubbleStyle = { bg: "rgba(41,20,8,0.92)", fg: "#fde68a", border: "#e3a73b", size: 44 };

function BidCenter({ bid, reveal, names }: { bid: PerudoTable3DProps["bid"]; reveal: PerudoReveal3D | null; names: Record<number, string> }) {
  const face = reveal ? reveal.face : bid?.face ?? null;
  const text = reveal
    ? `선언 ${FACE_NAME[reveal.face]} ${reveal.quantity}개 → 실제 ${reveal.actualCount}개`
    : bid
      ? `${FACE_NAME[bid.face]} ${bid.quantity}개 이상\n${names[bid.seat] ?? ""}`
      : "첫 선언 대기";
  const spin = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (spin.current) {
      spin.current.rotation.y = clock.elapsedTime * 0.6;
      spin.current.position.y = 0.42 + Math.sin(clock.elapsedTime * 1.6) * 0.04;
    }
  });
  return (
    <group>
      {face !== null && (
        <group ref={spin} position={[0, 0.42, 0]} scale={2.1}>
          <group position={[0, -0.065, 0]}>
            <Die value={face} color={BID_DIE} glow={!!reveal} dim={false} />
          </group>
        </group>
      )}
      <GlowDisc color={reveal ? (reveal.actualCount >= reveal.quantity ? "#22c55e" : "#ef4444") : "#e3a73b"} r={0.42} opacity={0.22} />
      <TableSign text={text} style={SIGN_STYLE} y={0.92} width={1.2} />
    </group>
  );
}


// ---------------------------------------------------------------------------
// The bid track: tiles 1…total in a ring on the felt
// ---------------------------------------------------------------------------

const BID_DIE: PerudoColor3D = { body: "#fbbf24", shadow: "#b45309", ink: "#451a03" };
const DRAFT_DIE: PerudoColor3D = { body: "#a78bfa", shadow: "#5b21b6", ink: "#ffffff" };

type TileTone = "plain" | "passed" | "bid" | "draft" | "open";
const TILE_COLOR: Record<TileTone, string> = { plain: "#3b2417", passed: "#b45309", bid: "#fbbf24", draft: "#8b5cf6", open: "#f1e3c2" };

function tileNumber(q: number, dark: boolean): THREE.CanvasTexture {
  return paintedTexture(`perudo:tile:${q}:${dark}`, 128, 128, (ctx, W) => {
    ctx.font = `900 ${q >= 10 ? 62 : 78}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 10;
    ctx.strokeStyle = dark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.7)";
    ctx.strokeText(String(q), W / 2, W / 2 + 4);
    ctx.fillStyle = dark ? "#2a1206" : "#fff7e6";
    ctx.fillText(String(q), W / 2, W / 2 + 4);
  });
}

const tileGeo = new RoundedBoxGeometry(1, 0.03, 1, 2, 0.008);

function BidTile({ q, tone, size, onPick }: { q: number; tone: TileTone; size: number; onPick: (() => void) | null }) {
  const dark = tone === "bid" || tone === "open";
  return (
    <Clickable onClick={onPick} lift={0.03}>
      <mesh geometry={tileGeo} scale={[size, 1, size]} position={[0, 0.015, 0]} receiveShadow>
        <meshStandardMaterial
          color={TILE_COLOR[tone]}
          roughness={0.5}
          metalness={tone === "bid" ? 0.35 : 0.05}
          emissive={tone === "draft" ? "#6d28d9" : tone === "bid" ? "#92400e" : "#000000"}
          emissiveIntensity={tone === "draft" || tone === "bid" ? 0.35 : 0}
        />
      </mesh>
      <mesh position={[0, 0.032, 0]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[size * 0.92, size * 0.92]} />
        <meshBasicMaterial map={tileNumber(q, dark)} transparent depthWrite={false} opacity={tone === "plain" ? 0.7 : 1} />
      </mesh>
      {onPick && <HitBox size={[size * 1.05, 0.12, size * 1.05]} />}
    </Clickable>
  );
}

/** A die standing on a tile as the bid's game piece; `ghost` bobs and spins (my unconfirmed draft). */
function BidPiece({ face, color, ghost }: { face: number; color: PerudoColor3D; ghost: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const t = clock.elapsedTime;
    g.position.y = ghost ? 0.1 + Math.sin(t * 3) * 0.03 : 0.03;
    g.rotation.y = ghost ? t * 1.2 : Math.sin(t * 0.8) * 0.15;
  });
  return (
    <group>
      <GlowDisc color={ghost ? "#a78bfa" : "#fbbf24"} r={0.16} opacity={0.55} />
      <group ref={ref} scale={1.35}>
        <Die value={face} color={color} glow={!ghost} dim={false} />
      </group>
    </group>
  );
}

function BidRing(props: { total: number; bid: PerudoTable3DProps["bid"]; draft: PerudoTable3DProps["draft"]; onPick: PerudoTable3DProps["onPickQuantity"]; enabled?: (q: number) => boolean }) {
  const geo = useTableGeo();
  const total = Math.max(1, props.total);
  // the ring sits inside the cups; the small duel table gets smaller tiles so it clears both cups
  const r = Math.min(2.0, Math.max(0.4, geo.tableR - 0.9));
  const size = Math.min(geo.tableR < 1.3 ? 0.16 : 0.22, ((2 * Math.PI * r) / total) * 0.84);
  // q = 1 sits just left of me and the ring climbs clockwise (as seen from my seat) back round to my right;
  // a bid past the dice in play parks on the last tile (the centre sign still says the real number)
  const at = (q: number) => polar(-((Math.min(q, total) - 0.5) / total) * Math.PI * 2, r);
  const bidQ = props.bid?.quantity ?? 0;
  const draft = props.draft && (!props.bid || props.draft.quantity !== props.bid.quantity || props.draft.face !== props.bid.face) ? props.draft : null;
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.004, 0]}>
        <ringGeometry args={[r - size * 0.7, r + size * 0.7, 64]} />
        <meshStandardMaterial color="#1c120b" roughness={0.9} transparent opacity={0.55} />
      </mesh>
      {Array.from({ length: total }, (_, i) => {
        const q = i + 1;
        const can = !!props.onPick && (props.enabled?.(q) ?? true);
        const tone: TileTone = draft && Math.min(draft.quantity, total) === q ? "draft" : q === Math.min(bidQ, total) ? "bid" : can ? "open" : q < bidQ ? "passed" : "plain";
        return (
          <group key={q} position={at(q)}>
            <BidTile q={q} tone={tone} size={size} onPick={can ? () => props.onPick!(q) : null} />
          </group>
        );
      })}
      {props.bid && (
        <group position={at(props.bid.quantity)}>
          <BidPiece face={props.bid.face} color={BID_DIE} ghost={false} />
        </group>
      )}
      {draft && (
        <group position={at(draft.quantity)}>
          <BidPiece face={draft.face} color={DRAFT_DIE} ghost />
        </group>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------

const THEME: TableTheme = {
  background: "#3a2340",
  fog: [12, 34],
  ambient: ["#ffd7b0", 0.5],
  hemi: ["#ffb98a", "#2a1a24", 0.5],
  fills: [
    ["#ff9a5a", 0.75, -10, 5, -14],
    ["#a5b4fc", 0.25, 6, 6, 8],
  ],
  lamp: { color: "#ffd9a0", intensity: 16, height: 3.4 },
  table: { top: "#7a2e16", rim: "#4a2a14", felt: "#7a2e16", inlay: "#e3a73b", base: "#3a2010", feltMap: weaveTexture },
  chair: "stool",
  chairColor: "#5a3a1e",
  seatColors: SEAT_COLORS,
  hats: ["none", "fedora", "none", "beret"],
};

const BID_STYLE: BubbleStyle = { bg: "rgba(255,247,237,0.97)", fg: "#7c2d12", border: "#fb923c" };
const CALL_STYLE: BubbleStyle = { bg: "rgba(127,29,29,0.95)", fg: "#fff1f2", border: "#fecaca", size: 56 };
const CALZA_STYLE: BubbleStyle = { bg: "rgba(20,83,45,0.95)", fg: "#f0fdf4", border: "#bbf7d0", size: 56 };
const DELTA_STYLE: BubbleStyle = { bg: "rgba(30,27,75,0.92)", fg: "#e0e7ff", border: "#818cf8" };

export default function PerudoTable3D(props: PerudoTable3DProps & { names: Record<number, string> }) {
  const { playerCount: n, viewerSeat, reveal, bid, activeSeat, names } = props;
  const roundKey = `r${props.roundNumber}`;
  const faceForGlow = reveal ? reveal.face : null;
  const wild = reveal ? reveal.face !== 1 : false;

  const seats: TableSeat[] = props.seats.map((s) => {
    let mood: PersonMood = "rest";
    let lookSeat: TableSeat["lookSeat"] = activeSeat !== null && activeSeat !== s.seat ? activeSeat : "center";
    let bubble: TableSeat["bubble"] = null;
    if (s.out) mood = "slump";
    else if (reveal) {
      lookSeat = "center";
      const lost = reveal.affectedSeat === s.seat && reveal.diceDelta < 0;
      const gained = reveal.affectedSeat === s.seat && reveal.diceDelta > 0;
      if (reveal.actorSeat === s.seat) {
        mood = lost ? "sad" : gained ? "cheer" : "laugh";
        bubble = { text: reveal.kind === "dudo" ? "페루도!" : "맞아!", style: reveal.kind === "dudo" ? CALL_STYLE : CALZA_STYLE, key: `c${roundKey}`, width: 0.75 };
      } else if (reveal.bidSeat === s.seat) mood = lost ? "sad" : "smug";
      else mood = reveal.exactHitSeats.includes(s.seat) ? "shock" : "clap";
      if (lost || gained || reveal.exactHitSeats.includes(s.seat)) {
        const d = reveal.affectedSeat === s.seat ? reveal.diceDelta : -1;
        if (reveal.actorSeat !== s.seat) bubble = { text: `🎲 ${d > 0 ? "+" : ""}${d}`, style: DELTA_STYLE, key: `d${roundKey}`, width: 0.5 };
      }
    } else if (activeSeat === s.seat) {
      mood = "think";
      lookSeat = bid ? bid.seat : "center";
    } else if (bid?.seat === s.seat) {
      mood = "smug";
      bubble = { text: `${FACE_NAME[bid.face]} ${bid.quantity}개!`, style: BID_STYLE, key: `b${bid.quantity}-${bid.face}`, width: 0.72 };
    }
    const isViewer = s.seat === viewerSeat;
    const open = !!reveal || (isViewer && props.peek);
    return {
      seat: s.seat,
      name: s.name,
      away: s.away,
      sub: s.out ? "💀 탈락" : `🎲 × ${s.diceCount}`,
      mood,
      lookSeat,
      out: s.out,
      active: !reveal && activeSeat === s.seat,
      bubble,
      // no tag of my own — it would float over the ring track; the HUD under the canvas carries it
      tag: null,
      front: s.out ? null : (
        // my own cup and dice sit a bit bigger so they read from the camera behind them
        <group scale={isViewer ? 1.2 : 1}>
          {open && s.dice && (
            <DiceCluster
              dice={s.dice}
              color={s.color}
              face={reveal ? faceForGlow : (bid?.face ?? null)}
              wild={reveal ? wild : !!bid && bid.face !== 1}
              roundKey={`${roundKey}-${open}`}
            />
          )}
          <Clickable onClick={isViewer && !reveal ? props.onTogglePeek : null} lift={0.04}>
            <Cup open={open} accent={s.color.body} shakeKey={roundKey} lowDetail={props.lowDetail} sneak={!isViewer && !reveal && activeSeat === s.seat} />
            {isViewer && !reveal && props.onTogglePeek && <HitBox size={[0.5, 0.4, 0.5]} />}
          </Clickable>
        </group>
      ),
    };
  });

  return (
    <TableScene
      cameraKey="perudo-camera"
      // first person: eyes a little up, so my own cup in front doesn't wall off the bid ring
      selfView={{ pitch: 0.16 }}
      seatCount={n}
      viewerSeat={viewerSeat}
      seats={seats}
      theme={THEME}
      environment={<IncaCourtyard lowDetail={props.lowDetail} />}
      center={
        <group>
          <BidCenter bid={bid} reveal={reveal} names={names} />
          <BidRing
            total={props.totalDice}
            bid={reveal ? { seat: reveal.bidSeat, quantity: reveal.quantity, face: reveal.face } : bid}
            draft={reveal ? null : props.draft}
            onPick={reveal ? null : props.onPickQuantity}
            enabled={props.quantityEnabled}
          />
        </group>
      }
      overview={props.overview}
      lowDetail={props.lowDetail}
    />
  );
}
