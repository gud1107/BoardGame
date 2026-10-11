"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { BluffRouletteState, CardKind, Resolution, SeatIndex } from "./engine";
import { paintCard } from "./cardArt";
import Character from "./Character";
import { activePull, type ShowdownTimeline } from "./timeline";

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
  tableSuit: BluffRouletteState["tableSuit"];
  activeSeat: SeatIndex | null;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  showdown: Showdown | null;
  quality: "high" | "low";
}

const SEAT_R = 2.75;
const TABLE_R = 2.05;
const TABLE_Y = 0.92;
const SEAT_COLORS = ["#c2410c", "#2563eb", "#15803d", "#9333ea", "#be123c", "#0e7490"];

// ---------------------------------------------------------------------------
// Texture caches (module-level: built once per page, shared by every card)
// ---------------------------------------------------------------------------

const cardTextures = new Map<string, THREE.CanvasTexture>();
function cardTexture(kind: CardKind | "back"): THREE.CanvasTexture {
  let t = cardTextures.get(kind);
  if (!t) {
    const c = document.createElement("canvas");
    c.width = 300;
    c.height = 420;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    paintCard(c.getContext("2d")!, kind, 300, 420, () => {
      tex.needsUpdate = true;
    });
    t = tex;
    cardTextures.set(kind, t);
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
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function nowSec(sd: Showdown | null): number {
  return sd ? (performance.now() - sd.startedAt) / 1000 : 0;
}

/** Has pull `j` of the showdown already fired at time `t`? */
function pullFired(sd: Showdown | null, seat: SeatIndex, t: number): { pending: number; hitPending: boolean; fellAt: number | null } {
  if (!sd) return { pending: 0, hitPending: false, fellAt: null };
  let pending = 0;
  let hitPending = false;
  let fellAt: number | null = null;
  sd.res.pulls.forEach((p, j) => {
    if (p.seat !== seat) return;
    const fireAt = sd.tl.pulls[j].fireAt;
    if (t < fireAt) {
      pending++;
      if (p.hit) hitPending = true;
    } else if (p.hit) fellAt = fireAt;
  });
  return { pending, hitPending, fellAt };
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

function Card3D({ kind, position, rotation, scale = 1 }: { kind: CardKind | "back"; position: THREE.Vector3Tuple; rotation?: THREE.EulerTuple; scale?: number }) {
  return (
    <mesh position={position} rotation={rotation} scale={scale} castShadow>
      <planeGeometry args={[0.32, 0.45]} />
      <meshStandardMaterial map={cardTexture(kind)} roughness={0.45} metalness={0.05} side={THREE.DoubleSide} alphaTest={0.5} />
    </mesh>
  );
}

/** Rotating "오늘의 카드" sign hovering over the centre. */
function SuitSign({ suit, hidden }: { suit: BluffRouletteState["tableSuit"]; hidden: boolean }) {
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
        <meshStandardMaterial map={cardTexture(suit)} emissive="#ffffff" emissiveMap={cardTexture(suit)} emissiveIntensity={0.35} side={THREE.DoubleSide} alphaTest={0.5} />
      </mesh>
      <pointLight color="#ffe6a8" intensity={1.5} distance={2} />
    </group>
  );
}

/** Face-down plays piled at the centre (the challenged play lifts out during a showdown). */
function Pile({ pile, viewer, n, showdown }: { pile: SceneProps["pile"]; viewer: SeatIndex; n: number; showdown: Showdown | null }) {
  const cards: { pos: THREE.Vector3Tuple; rot: THREE.EulerTuple }[] = [];
  const shown = showdown ? pile.slice(0, -1) : pile;
  let k = 0;
  shown.forEach((play, pi) => {
    const dir = seatAngle(play.seat, viewer, n);
    const isLast = !showdown && pi === shown.length - 1;
    for (let i = 0; i < play.count; i++, k++) {
      const off = isLast ? polar(dir, 0.45 + i * 0.05) : polar(k * 2.4, 0.3 + (k % 3) * 0.05);
      cards.push({ pos: [off.x, TABLE_Y + 0.02 + k * 0.006, off.z], rot: [-Math.PI / 2, 0, k * 0.9 + dir] });
    }
  });
  return (
    <group>
      {cards.map((c, i) => (
        <Card3D key={i} kind="back" position={c.pos} rotation={c.rot} scale={0.85} />
      ))}
    </group>
  );
}

/** The challenged play, rising from the pile and flipping one by one. */
function RevealRow({ showdown, viewer, n }: { showdown: Showdown; viewer: SeatIndex; n: number }) {
  const root = useRef<THREE.Group>(null);
  const groups = useRef<(THREE.Group | null)[]>([]);
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
      const rise = easeOut((t - 0.25) / 0.5);
      const target = new THREE.Vector3((i - (count - 1) / 2) * 0.42, TABLE_Y + 0.75, 0.4);
      g.position.lerpVectors(from, target, rise);
      const flip = easeOut((t - tl.flipAt(i)) / 0.35);
      g.rotation.set(0, Math.PI * (1 - flip), 0);
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
          <Card3D kind={c.kind} position={[0, 0, 0.002]} scale={1.15} />
          <Card3D kind="back" position={[0, 0, -0.002]} rotation={[0, Math.PI, 0]} scale={1.15} />
        </group>
      ))}
      <mesh position={[0, TABLE_Y + 0.75, 0.38]}>
        <planeGeometry args={[count * 0.42 + 0.3, 0.75]} />
        <meshStandardMaterial ref={glow} color={verdictColor} emissive={verdictColor} emissiveIntensity={0} transparent opacity={0} />
      </mesh>
    </group>
  );
}

function Revolver({ shots, color }: { shots: number; color: string }) {
  const cylinder = useRef<THREE.Group>(null);
  return (
    <group>
      {/* barrel */}
      <mesh position={[0.17, 0, 0]} rotation-z={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.028, 0.028, 0.34, 10]} />
        <meshStandardMaterial color="#2b2b2e" metalness={0.85} roughness={0.3} />
      </mesh>
      {/* frame */}
      <mesh position={[-0.02, 0, 0]} castShadow>
        <boxGeometry args={[0.16, 0.1, 0.07]} />
        <meshStandardMaterial color="#3a3a3e" metalness={0.8} roughness={0.35} />
      </mesh>
      {/* cylinder */}
      <group ref={cylinder} name="cyl" position={[0.0, 0.0, 0]}>
        <mesh rotation-z={Math.PI / 2} castShadow>
          <cylinderGeometry args={[0.07, 0.07, 0.11, 6]} />
          <meshStandardMaterial color="#55555a" metalness={0.9} roughness={0.25} />
        </mesh>
      </group>
      {/* grip */}
      <mesh position={[-0.13, -0.09, 0]} rotation-z={-0.45} castShadow>
        <boxGeometry args={[0.08, 0.2, 0.06]} />
        <meshStandardMaterial color="#6b3a1f" roughness={0.7} />
      </mesh>
      {/* chamber pips: used = red */}
      {Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return (
          <mesh key={i} position={[-0.02 + Math.cos(a) * 0.11, 0.17 + Math.sin(a) * 0.11 * 0, Math.sin(a) * 0.11]}>
            <sphereGeometry args={[0.022, 8, 6]} />
            <meshStandardMaterial color={i < shots ? "#ef4444" : "#e7e5e4"} emissive={i < shots ? "#ef4444" : color} emissiveIntensity={i < shots ? 0.9 : 0.05} />
          </mesh>
        );
      })}
    </group>
  );
}

/** One opponent: chair, body, head, hat, name, hand fan and revolver — plus their showdown animation. */
function SeatPiece({
  seat,
  viewer,
  n,
  name,
  active,
  showdown,
  isViewer,
  seatAngles,
  activeSeatAll,
}: {
  seatAngles: Record<SeatIndex, number>;
  activeSeatAll: SeatIndex | null;
  seat: PublicSeat;
  viewer: SeatIndex;
  n: number;
  name: string;
  active: boolean;
  showdown: Showdown | null;
  isViewer: boolean;
}) {
  const color = SEAT_COLORS[seat.seat % SEAT_COLORS.length];
  const angle = seatAngle(seat.seat, viewer, n);
  const gun = useRef<THREE.Group>(null);
  const flash = useRef<THREE.PointLight>(null);
  const ring = useRef<THREE.MeshStandardMaterial>(null);
  const seatPos = polar(angle, SEAT_R);
  const gunRest = polar(angle, TABLE_R - 0.5, TABLE_Y + 0.06).add(polar(angle + Math.PI / 2, 0.42));
  const label = useMemo(() => labelTexture(name, color), [name, color]);

  useFrame(({ clock }) => {
    const t = nowSec(showdown);
    if (ring.current) ring.current.emissiveIntensity = active && !showdown ? 1.2 + Math.sin(clock.elapsedTime * 5) * 0.5 : 0;

    // gun: rest on table, or rise to the head during this seat's pull
    const g = gun.current;
    if (!g) return;
    const pull = showdown ? activePull(showdown.tl, t) : null;
    const mine = pull && showdown!.res.pulls[pull.index].seat === seat.seat ? pull : null;
    const head = isViewer
      ? new THREE.Vector3(0.3, 2.12, SEAT_R + 0.45)
      : seatPos.clone().add(new THREE.Vector3(0, 1.62, 0)).add(polar(angle + Math.PI / 2, 0.3)).add(polar(angle + Math.PI, 0.05));
    if (mine) {
      const u = mine.local;
      const up = easeOut(u / 0.35) * (1 - easeOut((u - 2.3) / 0.35));
      g.position.lerpVectors(gunRest, head, up);
      g.rotation.set(0, angle + Math.PI / 2 + up * (isViewer ? Math.PI / 2 : Math.PI), up * 0.2);
      const cyl = g.getObjectByName("cyl");
      if (cyl) cyl.rotation.x = u > 0.35 && u < 1.45 ? (u - 0.35) * 22 : 0;
      const hit = showdown!.res.pulls[mine.index].hit;
      if (flash.current) flash.current.intensity = hit && u > 1.95 && u < 2.2 ? 40 * (1 - (u - 1.95) / 0.25) : 0;
      g.position.x += hit && u > 1.95 && u < 2.1 ? (Math.random() - 0.5) * 0.04 : 0;
    } else {
      g.position.copy(gunRest);
      g.rotation.set(0, angle + Math.PI / 2, 0);
      if (flash.current) flash.current.intensity = 0;
    }
  });

  const shotsShown = (() => {
    const t = nowSec(showdown);
    return seat.shots - pullFired(showdown, seat.seat, t).pending;
  })();

  return (
    <group>
      {!isViewer && (
        <group position={seatPos.toArray()} rotation-y={angle + Math.PI}>
          {/* chair */}
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
            angle={angle}
            seatPos={seatPos}
            seatAngles={seatAngles}
            seatR={SEAT_R}
            activeSeat={activeSeatAll}
            alive={seat.alive}
            showdown={showdown}
          />
          <sprite position={[0, 2.12, 0]} scale={[0.8, 0.2, 1]}>
            <spriteMaterial map={label} transparent depthWrite={false} />
          </sprite>
        </group>
      )}
      {/* active-turn ring on the table in front of the seat */}
      <mesh position={polar(angle, TABLE_R - 0.25, TABLE_Y + 0.016).toArray()} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.2, 0.26, 32]} />
        <meshStandardMaterial ref={ring} color="#fbbf24" emissive="#fbbf24" emissiveIntensity={0} transparent opacity={0.9} />
      </mesh>
      {/* hand: face-down fan (not drawn for me — my hand is in the HUD) */}
      {!isViewer &&
        Array.from({ length: seat.handCount }, (_, i) => {
          const spread = (i - (seat.handCount - 1) / 2) * 0.13;
          const p = polar(angle, TABLE_R - 0.32).add(polar(angle + Math.PI / 2, spread));
          return <Card3D key={i} kind="back" position={[p.x, TABLE_Y + 0.02 + i * 0.004, p.z]} rotation={[-Math.PI / 2, 0, angle + spread * 0.6]} scale={0.7} />;
        })}
      <group ref={gun}>
        <Revolver shots={Math.max(0, shotsShown)} color={color} />
        <pointLight ref={flash} color="#ffb347" intensity={0} distance={4} />
      </group>
    </group>
  );
}

/**
 * Camera: first-person at my seat. Dragging the canvas looks around (yaw),
 * releasing drifts back to my seat; showdowns turn the head toward the
 * action and narrow the field of view.
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
    const target = new THREE.Vector3(0, TABLE_Y + 0.1, -0.2);
    if (showdown && t < showdown.tl.verdictAt + 0.6) {
      target.set(0, TABLE_Y + 0.7, 0.3);
      fov = portrait ? 60 : 40;
    } else if (showdown && pull) {
      const shooter = showdown.res.pulls[pull.index].seat;
      if (shooter !== viewer) {
        target.copy(polar(seatAngle(shooter, viewer, n), SEAT_R, 1.85));
        fov = portrait ? 46 : 30;
      } else {
        target.set(0.25, 1.9, 0.8);
        fov = portrait ? 66 : 48;
      }
    }
    yaw.current += (yawTarget.current - yaw.current) * 0.12;
    const up = new THREE.Vector3(0, 1, 0);
    cam.position.lerp(new THREE.Vector3(0, 2.4, SEAT_R + 0.95).applyAxisAngle(up, yaw.current * 0.25), 0.1);
    look.current.lerp(showdown ? target : target.applyAxisAngle(up, yaw.current), 0.08);
    cam.lookAt(look.current);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * 0.08;
      cam.updateProjectionMatrix();
    }
  });
  return null;
}

function SceneContents(props: SceneProps) {
  const { playerCount: n, seats, viewerSeat, showdown, quality } = props;
  const tension = useRef(0);
  const seatAngles = useMemo(() => Object.fromEntries(seats.map((s) => [s.seat, seatAngle(s.seat, viewerSeat, n)])) as Record<SeatIndex, number>, [seats, viewerSeat, n]);
  useEffect(() => {
    const me = seats.find((s) => s.seat === viewerSeat);
    tension.current = me ? me.shots / 5 : 0;
  }, [seats, viewerSeat]);
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
      <SuitSign suit={props.tableSuit} hidden={!!showdown} />
      <Pile pile={props.pile} viewer={viewerSeat} n={n} showdown={showdown} />
      {showdown && <RevealRow showdown={showdown} viewer={viewerSeat} n={n} />}
      {seats.map((s) => (
        <SeatPiece
          key={s.seat}
          seat={s}
          viewer={viewerSeat}
          n={n}
          name={props.names[s.seat] ?? `${s.seat + 1}번`}
          active={props.activeSeat === s.seat}
          showdown={showdown}
          isViewer={s.seat === viewerSeat}
          seatAngles={seatAngles}
          activeSeatAll={props.activeSeat}
        />
      ))}
      <CameraRig viewer={viewerSeat} n={n} showdown={showdown} />
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
