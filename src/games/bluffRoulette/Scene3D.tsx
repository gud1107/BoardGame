"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { BluffRouletteState, CardKind, Resolution, SeatIndex } from "./engine";
import { paintCard, type CardTheme } from "./cardArt";
import Character from "./Character";
import Revolver, { animateRevolver } from "./Revolver";
import { activePull, span, type ShowdownTimeline } from "./timeline";
import { defaultAvatar, EMOTE_DURATION_S, emoteIcon, type Avatar, type EmoteKind } from "./cosmetics";

/**
 * The 3D saloon table (rulebook §T). Presentation only: everything shown is
 * public information (hand COUNTS, shot counts, the pile as face-down
 * cards, and only the challenged play face-up during a showdown) — the
 * scene never receives another seat's hand contents or any bullet, so
 * nothing hidden can leak through the renderer. No physics: every motion is
 * a closed-form function of time, so all devices show the same thing.
 */

export interface Showdown {
  res: Resolution;
  tl: ShowdownTimeline;
  /** `performance.now()` (ms) when this client first saw the resolution. */
  startedAt: number;
}

export interface PublicSeat {
  seat: SeatIndex;
  alive: boolean;
  handCount: number;
  shots: number;
}

export interface SceneProps {
  playerCount: number;
  seats: PublicSeat[];
  /** Each entry = one face-down play this round (card count + who). */
  pile: { seat: SeatIndex; count: number }[];
  roundNumber: number;
  tableSuit: BluffRouletteState["tableSuit"];
  activeSeat: SeatIndex | null;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  showdown: Showdown | null;
  quality: "high" | "low";
  theme: CardTheme;
  avatars: Record<SeatIndex, Avatar | undefined>;
  /** Latest emote per seat; `at` = performance.now() on receipt. */
  emotes: Record<SeatIndex, { kind: EmoteKind; at: number } | undefined>;
  /** Average frames per second, reported every ~2s (auto quality, rulebook §T). */
  onFps?: (fps: number) => void;
}

const SEAT_R = 2.75;
const TABLE_R = 2.05;
const TABLE_Y = 0.92;
const SEAT_COLORS = ["#c2410c", "#2563eb", "#15803d", "#9333ea", "#be123c", "#0e7490"];

// ---------------------------------------------------------------------------
// Texture caches (module-level: built once per page, shared by every card)
// ---------------------------------------------------------------------------

const cardTextures = new Map<string, THREE.CanvasTexture>();
function cardTexture(kind: CardKind | "back", theme: CardTheme): THREE.CanvasTexture {
  const key = `${theme}:${kind}`;
  let t = cardTextures.get(key);
  if (!t) {
    const c = document.createElement("canvas");
    c.width = 300;
    c.height = 420;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    paintCard(
      c.getContext("2d")!,
      kind,
      300,
      420,
      () => {
        tex.needsUpdate = true;
      },
      theme,
    );
    t = tex;
    cardTextures.set(key, t);
  }
  return t;
}

const emojiTextures = new Map<string, THREE.CanvasTexture>();
function emojiTexture(icon: string): THREE.CanvasTexture {
  let t = emojiTextures.get(icon);
  if (!t) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "rgba(255,250,240,0.92)";
    ctx.beginPath();
    ctx.arc(64, 60, 52, 0, Math.PI * 2);
    ctx.moveTo(52, 104);
    ctx.lineTo(64, 126);
    ctx.lineTo(76, 104);
    ctx.fill();
    ctx.font = "64px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(icon, 64, 64);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    emojiTextures.set(icon, t);
  }
  return t;
}

const labelTextures = new Map<string, THREE.CanvasTexture>();
function labelTexture(text: string, color: string): THREE.CanvasTexture {
  const key = `${text}|${color}`;
  let t = labelTextures.get(key);
  if (!t) {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 128;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "rgba(12,10,9,0.72)";
    ctx.beginPath();
    ctx.roundRect(8, 20, 496, 88, 44);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.fillStyle = "#fef3c7";
    ctx.font = "700 52px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text.length > 9 ? `${text.slice(0, 8)}…` : text, 256, 66);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    labelTextures.set(key, t);
  }
  return t;
}

const feltTexture = (() => {
  let t: THREE.CanvasTexture | null = null;
  return () => {
    if (t) return t;
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(256, 256, 40, 256, 256, 256);
    g.addColorStop(0, "#1f6b45");
    g.addColorStop(1, "#0b3322");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = "rgba(212,166,74,0.55)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(256, 256, 150, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([6, 12]);
    ctx.beginPath();
    ctx.arc(256, 256, 232, 0, Math.PI * 2);
    ctx.stroke();
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
})();


// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function seatAngle(seat: SeatIndex, viewer: SeatIndex, n: number): number {
  return (((seat - viewer + n) % n) / n) * Math.PI * 2;
}

/** Point at radius `r` in the direction of `angle` (angle 0 = toward the camera, +z). */
function polar(angle: number, r: number, y = 0): THREE.Vector3 {
  return new THREE.Vector3(Math.sin(angle) * r, y, Math.cos(angle) * r);
}

const easeOut = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
/** Settles with a small overshoot — used for the card flip landing. */
const easeOutBack = (x: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const v = Math.min(1, Math.max(0, x));
  return 1 + c3 * Math.pow(v - 1, 3) + c1 * Math.pow(v - 1, 2);
};
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function nowSec(sd: Showdown | null): number {
  return sd ? (performance.now() - sd.startedAt) / 1000 : 0;
}

/** Pulls of `seat` that haven't fired yet at time `t` (to keep shot pips honest during the show). */
function pendingPulls(sd: Showdown | null, seat: SeatIndex, t: number): number {
  if (!sd) return 0;
  return sd.res.pulls.filter((p, j) => p.seat === seat && t < sd.tl.pulls[j].fireAt).length;
}

/** Is `seat` holding the revolver at time `t` (so the table copy must be hidden)? */
function gunInHand(sd: Showdown | null, seat: SeatIndex, t: number): boolean {
  if (!sd) return false;
  return sd.res.pulls.some((p, j) => p.seat === seat && t >= sd.tl.pulls[j].liftAt + 0.12 * sd.tl.pulls[j].k && (t < sd.tl.pulls[j].endAt || p.hit));
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Room({ quality }: { quality: "high" | "low" }) {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[12, quality === "high" ? 48 : 24]} />
        <meshStandardMaterial color="#2a1a12" roughness={0.9} />
      </mesh>
      <mesh position={[0, 4, 0]}>
        <cylinderGeometry args={[9, 9, 8, quality === "high" ? 40 : 20, 1, true]} />
        <meshStandardMaterial color="#1c0f12" roughness={1} side={THREE.BackSide} />
      </mesh>
      {/* wainscot band */}
      <mesh position={[0, 0.6, 0]}>
        <cylinderGeometry args={[8.9, 8.9, 1.2, quality === "high" ? 40 : 20, 1, true]} />
        <meshStandardMaterial color="#3b2416" roughness={0.8} side={THREE.BackSide} />
      </mesh>
    </group>
  );
}

function Lamp({ quality, tension }: { quality: "high" | "low"; tension: MutableRefObject<number> }) {
  const light = useRef<THREE.PointLight>(null);
  const bulb = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const flicker = 1 + Math.sin(t * 13) * 0.02 + Math.sin(t * 31) * 0.015 + (Math.sin(t * 2.3) > 0.97 ? -0.25 : 0) * tension.current;
    if (light.current) light.current.intensity = 26 * flicker;
    if (bulb.current) bulb.current.emissiveIntensity = 2.2 * flicker;
  });
  return (
    <group position={[0, 3.6, 0]}>
      <mesh position={[0, 1.2, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 2.4, 6]} />
        <meshStandardMaterial color="#111" />
      </mesh>
      <mesh>
        <coneGeometry args={[0.7, 0.45, quality === "high" ? 32 : 16, 1, true]} />
        <meshStandardMaterial color="#14532d" roughness={0.5} metalness={0.3} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, -0.12, 0]}>
        <sphereGeometry args={[0.13, 16, 12]} />
        <meshStandardMaterial ref={bulb} color="#fff1c1" emissive="#ffcf70" emissiveIntensity={2.2} />
      </mesh>
      <pointLight
        ref={light}
        position={[0, -0.25, 0]}
        color="#ffcf8a"
        intensity={26}
        distance={14}
        decay={2}
        castShadow={quality === "high"}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
    </group>
  );
}

function Table({ quality }: { quality: "high" | "low" }) {
  const seg = quality === "high" ? 64 : 28;
  return (
    <group>
      <mesh position={[0, TABLE_Y - 0.06, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[TABLE_R + 0.15, TABLE_R + 0.1, 0.14, seg]} />
        <meshStandardMaterial color="#5a2e17" roughness={0.45} metalness={0.05} />
      </mesh>
      <mesh position={[0, TABLE_Y + 0.012, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[TABLE_R - 0.05, seg]} />
        <meshStandardMaterial map={feltTexture()} roughness={0.95} />
      </mesh>
      <mesh position={[0, TABLE_Y / 2 - 0.05, 0]} castShadow>
        <cylinderGeometry args={[0.22, 0.5, TABLE_Y - 0.1, 16]} />
        <meshStandardMaterial color="#3a1d0e" roughness={0.6} />
      </mesh>
    </group>
  );
}


function Card3D({ kind, theme, position, rotation, scale = 1 }: { kind: CardKind | "back"; theme: CardTheme; position?: THREE.Vector3Tuple; rotation?: THREE.EulerTuple; scale?: number }) {
  return (
    <mesh position={position} rotation={rotation} scale={scale} castShadow>
      <planeGeometry args={[0.32, 0.45]} />
      <meshStandardMaterial map={cardTexture(kind, theme)} roughness={0.45} metalness={0.05} side={THREE.DoubleSide} alphaTest={0.5} />
    </mesh>
  );
}

/** Rotating "오늘의 카드" sign hovering over the centre. */
function SuitSign({ suit, hidden, theme }: { suit: BluffRouletteState["tableSuit"]; hidden: boolean; theme: CardTheme }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.rotation.y = clock.elapsedTime * 0.6;
    ref.current.position.y = TABLE_Y + 0.42 + Math.sin(clock.elapsedTime * 1.4) * 0.03;
    const s = ref.current.scale.x + ((hidden ? 0.001 : 1) - ref.current.scale.x) * 0.15;
    ref.current.scale.setScalar(s);
  });
  return (
    <group ref={ref} position={[0, TABLE_Y + 0.42, 0]}>
      <mesh>
        <planeGeometry args={[0.36, 0.5]} />
        <meshStandardMaterial map={cardTexture(suit, theme)} emissive="#ffffff" emissiveMap={cardTexture(suit, theme)} emissiveIntensity={0.35} side={THREE.DoubleSide} alphaTest={0.5} />
      </mesh>
      <pointLight color="#ffe6a8" intensity={1.5} distance={2} />
    </group>
  );
}

/**
 * One face-down card in the pile. A freshly played card flies in from its
 * player's place on an arc, spinning a little, and lands with a tiny bounce.
 */
function PileCard({ from, to, rotZ, theme }: { from: THREE.Vector3; to: THREE.Vector3; rotZ: number; theme: CardTheme }) {
  const ref = useRef<THREE.Group>(null);
  const born = useRef<number | null>(null);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    if (born.current === null) born.current = clock.elapsedTime;
    const u = clamp01((clock.elapsedTime - born.current) / 0.55);
    const e = easeOutBack(u);
    g.position.set(from.x + (to.x - from.x) * easeInOut(u), to.y + Math.sin(u * Math.PI) * 0.35 + (1 - e) * 0.0, from.z + (to.z - from.z) * easeInOut(u));
    g.rotation.set(-Math.PI / 2 + Math.sin(u * Math.PI) * 0.5, 0, rotZ + (1 - easeOut(u)) * 2.2);
  });
  return (
    <group ref={ref} position={from.toArray()}>
      <Card3D kind="back" theme={theme} scale={0.85} />
    </group>
  );
}

function Pile({ pile, viewer, n, showdown, roundNumber, theme }: { pile: SceneProps["pile"]; viewer: SeatIndex; n: number; showdown: Showdown | null; roundNumber: number; theme: CardTheme }) {
  const shown = showdown ? pile.slice(0, -1) : pile;
  const cards: { key: string; from: THREE.Vector3; to: THREE.Vector3; rotZ: number }[] = [];
  let k = 0;
  shown.forEach((play, pi) => {
    const dir = seatAngle(play.seat, viewer, n);
    const isLast = !showdown && pi === shown.length - 1;
    for (let i = 0; i < play.count; i++, k++) {
      const off = isLast ? polar(dir, 0.45 + i * 0.05) : polar(k * 2.4, 0.3 + (k % 3) * 0.05);
      cards.push({
        key: `${roundNumber}:${pi}:${i}`,
        from: polar(dir, play.seat === viewer ? SEAT_R : TABLE_R - 0.32, TABLE_Y + (play.seat === viewer ? 0.6 : 0.05)),
        to: new THREE.Vector3(off.x, TABLE_Y + 0.02 + k * 0.006, off.z),
        rotZ: k * 0.9 + dir,
      });
    }
  });
  return (
    <group>
      {cards.map((c) => (
        <PileCard key={c.key} from={c.from} to={c.to} rotZ={c.rotZ} theme={theme} />
      ))}
    </group>
  );
}

/**
 * The challenged play: each card rises from the pile on a soft arc, then
 * flips one by one — lifting toward the camera mid-turn, settling with a
 * small overshoot and a glint — before the verdict glow lights up.
 */
function RevealRow({ showdown, viewer, n, theme }: { showdown: Showdown; viewer: SeatIndex; n: number; theme: CardTheme }) {
  const root = useRef<THREE.Group>(null);
  const groups = useRef<(THREE.Group | null)[]>([]);
  const glints = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const glow = useRef<THREE.MeshStandardMaterial>(null);
  const { res, tl } = showdown;
  const count = res.revealed.length;
  const from = polar(seatAngle(res.accusedSeat, viewer, n), 0.45, TABLE_Y + 0.03);
  useFrame(() => {
    const t = nowSec(showdown);
    // Once the roulette starts, the whole reveal row (cards + verdict glow) steps aside so the shooter is in clear view.
    if (root.current) root.current.visible = !tl.pulls.length || t < tl.pulls[0].liftAt + 0.3;
    res.revealed.forEach((_, i) => {
      const g = groups.current[i];
      if (!g) return;
      const rise = easeInOut(clamp01((t - 0.15 - i * 0.08) / 0.6));
      const tx = (i - (count - 1) / 2) * 0.42;
      g.position.set(from.x + (tx - from.x) * rise, from.y + (TABLE_Y + 0.75 - from.y) * rise + Math.sin(rise * Math.PI) * 0.25, from.z + (0.4 - from.z) * rise);
      const f = clamp01((t - tl.flipAt(i)) / 0.5);
      const flip = easeOutBack(f);
      g.position.z += Math.sin(f * Math.PI) * 0.18; // lifts toward the camera while turning
      g.rotation.set(Math.sin(f * Math.PI) * -0.15, Math.PI * (1 - flip), Math.sin(f * Math.PI) * 0.06);
      const s = 1 + Math.sin(f * Math.PI) * 0.08;
      g.scale.setScalar(s);
      const gl = glints.current[i];
      if (gl) gl.opacity = f > 0.6 && f < 1 ? Math.sin(((f - 0.6) / 0.4) * Math.PI) * 0.55 : 0;
    });
    if (glow.current) {
      const on = clamp01((t - tl.verdictAt) / 0.3);
      glow.current.emissiveIntensity = on * (1.4 + Math.sin(t * 8) * 0.3);
      glow.current.opacity = on * 0.85;
    }
  });
  const verdictColor = res.skull ? "#a855f7" : res.truthful ? "#22c55e" : "#ef4444";
  return (
    <group ref={root}>
      {res.revealed.map((c, i) => (
        <group key={c.id} ref={(el) => void (groups.current[i] = el)}>
          <Card3D kind={c.kind} theme={theme} position={[0, 0, 0.002]} scale={1.15} />
          <Card3D kind="back" theme={theme} position={[0, 0, -0.002]} rotation={[0, Math.PI, 0]} scale={1.15} />
          <mesh position={[0, 0, 0.004]}>
            <planeGeometry args={[0.37, 0.52]} />
            <meshBasicMaterial ref={(el) => void (glints.current[i] = el)} color="#ffffff" transparent opacity={0} depthWrite={false} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, TABLE_Y + 0.75, 0.38]}>
        <planeGeometry args={[count * 0.42 + 0.3, 0.75]} />
        <meshStandardMaterial ref={glow} color={verdictColor} emissive={verdictColor} emissiveIntensity={0} transparent opacity={0} />
      </mesh>
    </group>
  );
}

/** Emoji bubble that pops above a head, rises and fades. */
function EmoteBubble({ emote, y }: { emote: { kind: EmoteKind; at: number } | undefined; y: number }) {
  const ref = useRef<THREE.Sprite>(null);
  useFrame(() => {
    const s = ref.current;
    if (!s) return;
    const age = emote ? (performance.now() - emote.at) / 1000 : 99;
    const on = age < EMOTE_DURATION_S;
    s.visible = on;
    if (!on) return;
    const pop = easeOutBack(clamp01(age / 0.3));
    const fade = 1 - clamp01((age - (EMOTE_DURATION_S - 0.5)) / 0.5);
    s.scale.set(0.42 * pop, 0.42 * pop, 1);
    s.position.y = y + age * 0.06;
    (s.material as THREE.SpriteMaterial).opacity = fade;
  });
  const tex = emote ? emojiTexture(emoteIcon(emote.kind)) : null;
  return (
    <sprite ref={ref} position={[0, y, 0]} visible={false}>
      <spriteMaterial map={tex} transparent depthWrite={false} />
    </sprite>
  );
}

/** The revolver lying on the table in front of a seat (hidden while it's being held). */
function TableGun({ seat, angle, shots, showdown, lowDetail }: { seat: SeatIndex; angle: number; shots: number; showdown: Showdown | null; lowDetail: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const rest = useMemo(() => polar(angle, TABLE_R - 0.5, TABLE_Y + 0.05).add(polar(angle + Math.PI / 2, 0.42)), [angle]);
  useFrame(() => {
    if (ref.current) ref.current.visible = !gunInHand(showdown, seat, nowSec(showdown));
  });
  return (
    // lay it on its side first (x), then turn it to lie along the table edge (y) — order YXZ
    <group ref={ref} position={rest.toArray()} rotation={new THREE.Euler(Math.PI / 2, angle + Math.PI / 2, 0, "YXZ")}>
      <Revolver spent={shots} lowDetail={lowDetail} />
    </group>
  );
}

/** My own pull, first person: the gun comes up into view, is worked step by step and pressed to my temple. */
function FirstPersonGun({ viewer, showdown, shots, lowDetail }: { viewer: SeatIndex; showdown: Showdown | null; shots: number; lowDetail: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const gunRef = useRef<THREE.Group>(null);
  const flash = useRef<THREE.PointLight>(null);
  const camera = useThree((s) => s.camera);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const t = nowSec(showdown);
    const pull = showdown ? activePull(showdown.tl, t) : null;
    const mine = pull && showdown!.res.pulls[pull.index].seat === viewer ? pull : null;
    g.visible = !!mine;
    if (!mine) return;
    const p = showdown!.tl.pulls[mine.index];
    const hit = showdown!.res.pulls[mine.index].hit;
    const grab = easeInOut(span(t, p.liftAt, p.openAt));
    const raise = easeInOut(span(t, p.raiseAt, p.cockAt - 0.05 * p.k));
    const lower = hit ? 0 : easeInOut(span(t, p.lowerAt, p.endAt - 0.1 * p.k));
    const hold = span(t, p.holdAt, p.fireAt) * (t < p.fireAt ? 1 : 0);
    // camera-space keyframes: below view → in front (cylinder visible) → right temple
    const below = new THREE.Vector3(0.3, -0.65, -0.7);
    const front = new THREE.Vector3(0.08, -0.2, -0.55);
    const temple = new THREE.Vector3(0.24, 0.02, -0.2);
    const pos = below.clone().lerp(front, grab).lerp(temple, raise).lerp(below, lower);
    pos.x += Math.sin(clock.elapsedTime * 38) * 0.004 * hold;
    pos.y += Math.sin(clock.elapsedTime * 41) * 0.004 * hold;
    g.position.copy(camera.localToWorld(pos));
    g.quaternion.copy(camera.quaternion);
    const yaw = Math.PI / 2 + 0.55 + (Math.PI / 2 - 0.55) * raise;
    g.rotateY(yaw);
    g.rotateZ(0.12 + raise * 0.1);
    const gg = gunRef.current;
    if (gg) {
      const f = animateRevolver(gg, p, t, shots, hit);
      if (flash.current) flash.current.intensity = f * 30;
    }
  });
  return (
    <group ref={ref} visible={false}>
      <group ref={gunRef} scale={1.15}>
        <Revolver spent={shots} lowDetail={lowDetail} />
      </group>
      {/* my gloved hand around the grip */}
      <mesh position={[-0.15, -0.12, 0]} rotation-z={-0.42}>
        <boxGeometry args={[0.1, 0.13, 0.09]} />
        <meshStandardMaterial color="#2b211c" roughness={0.8} />
      </mesh>
      <pointLight ref={flash} position={[0.4, 0, 0]} color="#ffb347" intensity={0} distance={3} />
    </group>
  );
}

/** One seat: chair, character, name, emote bubble, active ring, hand fan and table revolver. */
function SeatPiece({
  seat,
  viewer,
  n,
  name,
  active,
  activeSeat,
  showdown,
  seatAngles,
  avatar,
  emote,
  theme,
  lowDetail,
}: {
  seat: PublicSeat;
  viewer: SeatIndex;
  n: number;
  name: string;
  active: boolean;
  activeSeat: SeatIndex | null;
  showdown: Showdown | null;
  seatAngles: Record<SeatIndex, number>;
  avatar: Avatar;
  emote: { kind: EmoteKind; at: number } | undefined;
  theme: CardTheme;
  lowDetail: boolean;
}) {
  const isViewer = seat.seat === viewer;
  const color = SEAT_COLORS[seat.seat % SEAT_COLORS.length];
  const angle = seatAngle(seat.seat, viewer, n);
  const ring = useRef<THREE.MeshStandardMaterial>(null);
  const seatPos = useMemo(() => polar(angle, SEAT_R), [angle]);
  const label = useMemo(() => labelTexture(name, color), [name, color]);
  useFrame(({ clock }) => {
    if (ring.current) ring.current.emissiveIntensity = active && !showdown ? 1.2 + Math.sin(clock.elapsedTime * 5) * 0.5 : 0;
  });
  const shotsShown = Math.max(0, seat.shots - pendingPulls(showdown, seat.seat, nowSec(showdown)));

  return (
    <group>
      {!isViewer && (
        <group position={seatPos.toArray()} rotation-y={angle + Math.PI}>
          <mesh position={[0, 0.98, -0.36]} castShadow>
            <boxGeometry args={[0.74, 0.9, 0.07]} />
            <meshStandardMaterial color="#3f1d0e" roughness={0.55} />
          </mesh>
          <mesh position={[0, 1.02, -0.32]}>
            <boxGeometry args={[0.6, 0.72, 0.02]} />
            <meshStandardMaterial color="#6b1d2c" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.48, 0]} castShadow>
            <boxGeometry args={[0.7, 0.07, 0.65]} />
            <meshStandardMaterial color="#5a2e17" roughness={0.7} />
          </mesh>
          <Character
            seat={seat.seat}
            color={color}
            avatar={avatar}
            angle={angle}
            seatPos={seatPos}
            seatAngles={seatAngles}
            seatR={SEAT_R}
            activeSeat={activeSeat}
            alive={seat.alive}
            shots={shotsShown}
            showdown={showdown}
            emote={emote ?? null}
            lowDetail={lowDetail}
          />
          <sprite position={[0, 2.12, 0]} scale={[0.8, 0.2, 1]}>
            <spriteMaterial map={label} transparent depthWrite={false} />
          </sprite>
          <EmoteBubble emote={emote} y={2.45} />
        </group>
      )}
      <mesh position={polar(angle, TABLE_R - 0.25, TABLE_Y + 0.016).toArray()} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.2, 0.26, 32]} />
        <meshStandardMaterial ref={ring} color="#fbbf24" emissive="#fbbf24" emissiveIntensity={0} transparent opacity={0.9} />
      </mesh>
      {!isViewer &&
        Array.from({ length: seat.handCount }, (_, i) => {
          const spread = (i - (seat.handCount - 1) / 2) * 0.13;
          const p = polar(angle, TABLE_R - 0.32).add(polar(angle + Math.PI / 2, spread));
          return <Card3D key={i} kind="back" theme={theme} position={[p.x, TABLE_Y + 0.02 + i * 0.004, p.z]} rotation={[-Math.PI / 2, 0, angle + spread * 0.6]} scale={0.7} />;
        })}
      <TableGun seat={seat.seat} angle={angle} shots={shotsShown} showdown={showdown} lowDetail={lowDetail} />
    </group>
  );
}

/**
 * Camera: first-person at my seat. Dragging the canvas looks around (yaw),
 * releasing drifts back to my seat; showdowns turn the head toward the
 * action, push in during the trigger hold and jolt on a bang.
 */
function CameraRig({ viewer, n, showdown }: { viewer: SeatIndex; n: number; showdown: Showdown | null }) {
  const gl = useThree((s) => s.gl);
  const look = useRef(new THREE.Vector3(0, TABLE_Y, 0));
  const yaw = useRef(0);
  const yawTarget = useRef(0);
  useEffect(() => {
    const el = gl.domElement;
    let drag: { x: number; yaw: number } | null = null;
    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, yaw: yawTarget.current };
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      yawTarget.current = Math.max(-1.6, Math.min(1.6, drag.yaw - ((e.clientX - drag.x) / (el.clientWidth || 1)) * 3));
    };
    const up = () => {
      drag = null;
      yawTarget.current = 0;
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
    const portrait = frame.size.width / frame.size.height < 1;
    const t = nowSec(showdown);
    const pull = showdown ? activePull(showdown.tl, t) : null;
    let fov = portrait ? 72 : 52;
    let roll = 0;
    const target = new THREE.Vector3(0, TABLE_Y + 0.1, -0.2);
    if (showdown && t < showdown.tl.verdictAt + 0.6) {
      target.set(0, TABLE_Y + 0.7, 0.3);
      fov = portrait ? 60 : 40;
    } else if (showdown && pull) {
      const p = showdown.tl.pulls[pull.index];
      const shooter = showdown.res.pulls[pull.index].seat;
      const hit = showdown.res.pulls[pull.index].hit;
      const push = span(t, p.raiseAt, p.fireAt);
      if (shooter !== viewer) {
        target.copy(polar(seatAngle(shooter, viewer, n), SEAT_R, 1.55));
        fov = (portrait ? 48 : 32) - push * (portrait ? 10 : 8);
      } else {
        target.set(0, TABLE_Y + 0.4, 0);
        fov = (portrait ? 70 : 50) - push * 6;
        roll = Math.sin(t * 3) * 0.015 * push;
        if (hit && t >= p.fireAt) roll = 0.35 * clamp01((t - p.fireAt) / 0.4);
      }
      if (hit && t >= p.fireAt && t < p.fireAt + 0.25) target.y += Math.sin(t * 90) * 0.04; // jolt
    }
    yaw.current += (yawTarget.current - yaw.current) * 0.12;
    const up = new THREE.Vector3(0, 1, 0);
    cam.position.lerp(new THREE.Vector3(0, 2.4, SEAT_R + 0.95).applyAxisAngle(up, yaw.current * 0.25), 0.1);
    look.current.lerp(showdown ? target : target.applyAxisAngle(up, yaw.current), 0.08);
    cam.lookAt(look.current);
    cam.rotateZ(roll);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * 0.08;
      cam.updateProjectionMatrix();
    }
  });
  return null;
}

/** Reports the average frame rate every ~2s so the board can lower the quality on slow phones. */
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

function SceneContents(props: SceneProps) {
  const { playerCount: n, seats, viewerSeat, showdown, quality, theme } = props;
  const lowDetail = quality === "low";
  const tension = useRef(0);
  const seatAngles = useMemo(() => Object.fromEntries(seats.map((s) => [s.seat, seatAngle(s.seat, viewerSeat, n)])) as Record<SeatIndex, number>, [seats, viewerSeat, n]);
  useEffect(() => {
    const me = seats.find((s) => s.seat === viewerSeat);
    tension.current = me ? me.shots / 5 : 0;
  }, [seats, viewerSeat]);
  const myShots = seats.find((s) => s.seat === viewerSeat)?.shots ?? 0;
  return (
    <>
      <color attach="background" args={["#0c0706"]} />
      <fog attach="fog" args={["#0c0706", 6, 13]} />
      <ambientLight intensity={0.22} color="#ffd9b0" />
      <hemisphereLight args={["#ffdcb0", "#1a0e0a", 0.35]} />
      {/* cool back light so silhouettes separate from the dark room */}
      <directionalLight position={[0, 3.5, -6]} intensity={0.55} color="#8fb4ff" />
      <directionalLight position={[0, 2.5, 6]} intensity={0.18} color="#ffd9a8" />
      <Room quality={quality} />
      <Lamp quality={quality} tension={tension} />
      <Table quality={quality} />
      <SuitSign suit={props.tableSuit} hidden={!!showdown} theme={theme} />
      <Pile pile={props.pile} viewer={viewerSeat} n={n} showdown={showdown} roundNumber={props.roundNumber} theme={theme} />
      {showdown && <RevealRow showdown={showdown} viewer={viewerSeat} n={n} theme={theme} />}
      {seats.map((s) => (
        <SeatPiece
          key={s.seat}
          seat={s}
          viewer={viewerSeat}
          n={n}
          name={props.names[s.seat] ?? `${s.seat + 1}번`}
          active={props.activeSeat === s.seat}
          activeSeat={props.activeSeat}
          showdown={showdown}
          seatAngles={seatAngles}
          avatar={props.avatars[s.seat] ?? defaultAvatar(s.seat)}
          emote={props.emotes[s.seat]}
          theme={theme}
          lowDetail={lowDetail}
        />
      ))}
      <FirstPersonGun viewer={viewerSeat} showdown={showdown} shots={Math.max(0, myShots - pendingPulls(showdown, viewerSeat, nowSec(showdown)))} lowDetail={lowDetail} />
      <CameraRig viewer={viewerSeat} n={n} showdown={showdown} />
      <FpsProbe onFps={props.onFps} />
    </>
  );
}

export default function Scene3D(props: SceneProps) {
  const high = props.quality === "high";
  return (
    <Canvas
      shadows={high}
      dpr={high ? [1, 1.75] : 1}
      gl={{ antialias: high, powerPreference: "high-performance" }}
      camera={{ fov: 52, position: [0, 2.4, SEAT_R + 0.95], near: 0.05, far: 40 }}
      style={{ touchAction: "none" }}
    >
      <SceneContents {...props} />
    </Canvas>
  );
}
