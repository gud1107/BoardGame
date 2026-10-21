"use client";

import { useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * A seated table player for the "real people around a table" 3D boards
 * (코요테, 라이어를 찾아라). Generalised from bluffRoulette/Character.tsx's rig
 * (hips → spine → head, two arms with shoulder/elbow) minus the revolver
 * choreography: the caller just names a `mood` and an optional point to look
 * at, and the rig blends toward that pose every frame with a face (brows,
 * blinking eyes, five mouth shapes, sweat) plus idle breathing/fidgets.
 *
 * Local frame: +z faces the table. Place it with `position` (the chair's
 * floor point) and `facing` (rotation around y). Presentation only.
 */

export type PersonMood =
  | "rest"
  | "think"
  | "talk"
  | "point"
  | "nervous"
  | "cheer"
  | "sad"
  | "shock"
  | "laugh"
  | "smug"
  | "clap"
  | "raise"
  | "write"
  | "shrug"
  | "slump";

export type HatKind = "none" | "cowboy" | "fedora" | "beret" | "cap" | "bowler" | "crown" | "circlet" | "hood" | "helmet";
export type HairStyle = "short" | "long" | "bun" | "spiky";

export interface PersonLook {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  coat: string;
  shirt: string;
  hat: HatKind;
  hatColor: string;
  beard: boolean;
  glasses: boolean;
}

const SKINS = ["#f3d2b6", "#e8bd98", "#d7a37b", "#b57a52", "#8a5638", "#f6dcc8"];
const HAIRS = ["#2a1a10", "#121212", "#5a3a22", "#8a5a2b", "#c99a5b", "#3b2a20", "#6b4a3a", "#a14b2a"];
const COATS = ["#7c2d12", "#1e3a8a", "#14532d", "#581c87", "#7f1d1d", "#155e75", "#3f3f46", "#854d0e", "#334155", "#9d174d"];
const SHIRTS = ["#f5f0e6", "#e0e7ff", "#fef3c7", "#dcfce7", "#fde2e4", "#e5e7eb"];
const STYLES: HairStyle[] = ["short", "long", "bun", "spiky", "long", "short"];

/**
 * A stable, varied default look per seat. `hats` restricts the hat pool
 * (e.g. the 코요테 desert table wants cowboy hats, the 라이어 room none).
 */
export function defaultLook(seat: number, hats: readonly HatKind[] = ["none"]): PersonLook {
  const h = (k: number) => Math.abs(Math.floor(Math.sin(seat * 91.7 + k * 13.3) * 10000));
  return {
    skin: SKINS[h(1) % SKINS.length],
    hair: HAIRS[(seat * 3 + 1) % HAIRS.length],
    hairStyle: STYLES[seat % STYLES.length],
    coat: COATS[seat % COATS.length],
    shirt: SHIRTS[h(4) % SHIRTS.length],
    hat: hats[seat % hats.length],
    hatColor: ["#5b3a1e", "#2b2118", "#8b5a2b", "#3a2a1a", "#6b4423"][h(5) % 5],
    beard: seat % 4 === 2,
    glasses: seat % 5 === 3,
  };
}

// ---------------------------------------------------------------------------
// Poses: [spineX, spineY, spineZ, headX, headY, headZ, lSx, lSy, lSz, lE, rSx, rSy, rSz, rE]
// Shoulder x<0 swings the arm forward/up; L inward is +y/+z, R inward is −y/−z.
// ---------------------------------------------------------------------------

type Pose = number[];
interface PoseSpec {
  spine?: [number, number, number];
  head?: [number, number, number];
  lS?: [number, number, number];
  lE?: number;
  rS?: [number, number, number];
  rE?: number;
}
const REST: Required<PoseSpec> = { spine: [0, 0, 0], head: [0.1, 0, 0], lS: [-0.75, 0, 0.12], lE: -0.9, rS: [-0.75, 0, -0.12], rE: -0.9 };
function P(spec: PoseSpec): Pose {
  const s = { ...REST, ...spec };
  return [...s.spine, ...s.head, ...s.lS, s.lE, ...s.rS, s.rE];
}

const POSES: Record<PersonMood, Pose> = {
  rest: P({}),
  think: P({ spine: [0.08, 0, 0], head: [0.05, 0, 0.14], rS: [-1.2, -0.55, 0], rE: -1.95 }),
  talk: P({ spine: [0.05, 0, 0], head: [0.02, 0, 0], rS: [-1.05, -0.3, -0.15], rE: -1.45 }),
  point: P({ spine: [0.14, 0, 0], head: [0.02, 0, 0], rS: [-1.5, 0, -0.05], rE: -0.1 }),
  nervous: P({ spine: [0.14, 0, 0], head: [0.22, 0, 0], lS: [-0.85, 0.35, 0.15], lE: -1.1, rS: [-0.85, -0.35, -0.15], rE: -1.1 }),
  cheer: P({ spine: [-0.08, 0, 0], head: [-0.2, 0, 0], lS: [-2.9, 0, -0.35], lE: -0.2, rS: [-2.9, 0, 0.35], rE: -0.2 }),
  sad: P({ spine: [0.24, 0, 0], head: [0.5, 0, 0], lS: [-0.45, 0, 0.1], lE: -0.5, rS: [-0.45, 0, -0.1], rE: -0.5 }),
  shock: P({ spine: [-0.1, 0, 0], head: [-0.12, 0, 0], lS: [-2.5, 0.3, -0.35], lE: -2.3, rS: [-2.5, -0.3, 0.35], rE: -2.3 }),
  laugh: P({ spine: [-0.22, 0, 0], head: [-0.32, 0, 0], lS: [-0.5, 0.3, 0.25], lE: -1.2, rS: [-0.5, -0.3, -0.25], rE: -1.2 }),
  smug: P({ spine: [-0.16, 0, 0], head: [-0.12, 0, 0.12], lS: [-1.25, 0.75, 0.1], lE: -1.75, rS: [-1.15, -0.75, -0.1], rE: -1.8 }),
  clap: P({ spine: [0.04, 0, 0], head: [0, 0, 0], lS: [-1.1, 0.55, 0], lE: -1.4, rS: [-1.1, -0.55, 0], rE: -1.4 }),
  raise: P({ spine: [-0.04, 0, 0], head: [-0.05, 0, 0], rS: [-2.85, 0, 0.3], rE: -0.25 }),
  write: P({ spine: [0.26, 0, 0], head: [0.42, 0, 0], lS: [-1.05, 0.3, 0.1], lE: -1.2, rS: [-1.1, -0.2, -0.1], rE: -1.05 }),
  shrug: P({ head: [0, 0, 0.15], lS: [-0.55, 0.2, 0.65], lE: -1.6, rS: [-0.55, -0.2, -0.65], rE: -1.6 }),
  slump: P({ spine: [0.5, 0, 0.08], head: [0.65, 0, 0.35], lS: [-1.3, 0.35, 0], lE: -0.7, rS: [-1.3, -0.35, 0], rE: -0.7 }),
};

interface Face {
  brow: number; // −1 angry … +1 worried
  mouth: "flat" | "smile" | "grin" | "frown" | "o";
  eye: number;
  sweat: number;
}
const FACES: Record<PersonMood, Face> = {
  rest: { brow: 0, mouth: "flat", eye: 1, sweat: 0 },
  think: { brow: -0.35, mouth: "flat", eye: 0.8, sweat: 0 },
  talk: { brow: 0.15, mouth: "o", eye: 1, sweat: 0 },
  point: { brow: -0.7, mouth: "o", eye: 1.05, sweat: 0 },
  nervous: { brow: 0.85, mouth: "frown", eye: 1.15, sweat: 1 },
  cheer: { brow: 0.45, mouth: "grin", eye: 1.1, sweat: 0 },
  sad: { brow: 0.9, mouth: "frown", eye: 0.55, sweat: 0.2 },
  shock: { brow: 1, mouth: "o", eye: 1.45, sweat: 0.4 },
  laugh: { brow: 0.35, mouth: "grin", eye: 0.22, sweat: 0 },
  smug: { brow: -0.25, mouth: "smile", eye: 0.7, sweat: 0 },
  clap: { brow: 0.25, mouth: "grin", eye: 1, sweat: 0 },
  raise: { brow: 0.2, mouth: "smile", eye: 1, sweat: 0 },
  write: { brow: -0.3, mouth: "flat", eye: 0.6, sweat: 0 },
  shrug: { brow: 0.6, mouth: "frown", eye: 1, sweat: 0 },
  slump: { brow: 0.4, mouth: "o", eye: 0.08, sweat: 0 },
};

const GREY = new THREE.Color("#57534e");
const hash = (a: number, b: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Coat silhouette for a LatheGeometry: hips → waist → chest → shoulders → collar (origin = hips). */
const COAT_PROFILE = [
  [0.0, 0.0],
  [0.27, 0.0],
  [0.3, 0.12],
  [0.26, 0.3],
  [0.3, 0.46],
  [0.36, 0.58],
  [0.35, 0.64],
  [0.22, 0.7],
  [0.1, 0.73],
  [0.0, 0.73],
].map(([x, y]) => new THREE.Vector2(x, y));

function Hat({ kind, color, seg }: { kind: HatKind; color: string; seg: number }) {
  if (kind === "none") return null;
  const felt = <meshStandardMaterial color={color} roughness={0.85} />;
  if (kind === "crown" || kind === "circlet") {
    // gold band with points (+ gems); the circlet is a thin, low version for nobles
    const crown = kind === "crown";
    const gold = <meshStandardMaterial color="#f5c542" metalness={0.85} roughness={0.25} emissive="#5a3a00" emissiveIntensity={0.25} />;
    const points = crown ? 8 : 5;
    return (
      <group position={[0, crown ? 0.16 : 0.12, -0.01]} rotation={[-0.06, 0, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[crown ? 0.17 : 0.2, crown ? 0.175 : 0.205, crown ? 0.07 : 0.03, seg, 1, true]} />
          {gold}
        </mesh>
        {Array.from({ length: points }, (_, i) => {
          const a = (i / points) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.sin(a) * (crown ? 0.168 : 0.2), crown ? 0.08 : 0.03, Math.cos(a) * (crown ? 0.168 : 0.2)]}>
              <coneGeometry args={[crown ? 0.032 : 0.018, crown ? 0.09 : 0.04, 4]} />
              {gold}
            </mesh>
          );
        })}
        {crown && (
          <>
            <mesh position={[0, 0.02, 0.172]}>
              <sphereGeometry args={[0.026, 10, 8]} />
              <meshStandardMaterial color="#dc2626" roughness={0.15} metalness={0.2} emissive="#7f1d1d" emissiveIntensity={0.6} />
            </mesh>
            {[-1, 1].map((s) => (
              <mesh key={s} position={[Math.sin(s * 0.9) * 0.17, 0.02, Math.cos(s * 0.9) * 0.17]}>
                <sphereGeometry args={[0.016, 8, 6]} />
                <meshStandardMaterial color="#2563eb" roughness={0.15} emissive="#1e3a8a" emissiveIntensity={0.5} />
              </mesh>
            ))}
            {/* velvet cap inside the band */}
            <mesh position={[0, 0.02, 0]} scale={[1, 0.55, 1]}>
              <sphereGeometry args={[0.165, seg, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial color={color} roughness={0.9} />
            </mesh>
          </>
        )}
        {!crown && (
          <mesh position={[0, 0.0, 0.205]}>
            <sphereGeometry args={[0.018, 8, 6]} />
            <meshStandardMaterial color="#a78bfa" roughness={0.15} emissive="#4c1d95" emissiveIntensity={0.5} />
          </mesh>
        )}
      </group>
    );
  }
  if (kind === "hood") {
    // a deep cloak hood that shadows the forehead (mafia / slave)
    return (
      <group position={[0, 0.02, -0.03]}>
        <mesh castShadow scale={[1.08, 1.12, 1.1]}>
          <sphereGeometry args={[0.215, seg, 12, Math.PI * 0.18, Math.PI * 1.64, 0, Math.PI * 0.78]} />
          <meshStandardMaterial color={color} roughness={0.95} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, -0.2, -0.04]} scale={[1, 1, 0.8]}>
          <cylinderGeometry args={[0.21, 0.27, 0.16, seg, 1, true, Math.PI * 0.75, Math.PI * 1.5]} />
          <meshStandardMaterial color={color} roughness={0.95} side={THREE.DoubleSide} />
        </mesh>
      </group>
    );
  }
  if (kind === "helmet") {
    const steel = <meshStandardMaterial color="#b8c0cc" metalness={0.9} roughness={0.3} />;
    return (
      <group position={[0, 0.03, -0.01]}>
        <mesh castShadow scale={[1.06, 1.05, 1.08]}>
          <sphereGeometry args={[0.21, seg, 12, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
          {steel}
        </mesh>
        {/* nose guard + crest */}
        <mesh position={[0, -0.02, 0.215]}>
          <boxGeometry args={[0.03, 0.13, 0.02]} />
          {steel}
        </mesh>
        <mesh position={[0, 0.2, -0.02]} rotation-x={0.2}>
          <boxGeometry args={[0.025, 0.08, 0.3]} />
          <meshStandardMaterial color={color} roughness={0.8} />
        </mesh>
      </group>
    );
  }
  if (kind === "beret") {
    return (
      <group position={[0.02, 0.15, -0.02]} rotation={[0.15, 0, -0.25]}>
        <mesh castShadow scale={[1, 0.38, 1]}>
          <sphereGeometry args={[0.215, seg, 10]} />
          {felt}
        </mesh>
      </group>
    );
  }
  if (kind === "cap") {
    return (
      <group position={[0, 0.1, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.205, seg, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
          {felt}
        </mesh>
        <mesh position={[0, 0.0, 0.2]} rotation={[0.18, 0, 0]} scale={[1, 1, 0.7]}>
          <cylinderGeometry args={[0.13, 0.13, 0.015, seg, 1, false, -Math.PI / 2, Math.PI]} />
          {felt}
        </mesh>
      </group>
    );
  }
  if (kind === "cowboy") {
    return (
      <group position={[0, 0.13, -0.01]} rotation={[-0.1, 0, 0]}>
        {/* curled brim: a squashed torus + flat disc */}
        <mesh castShadow scale={[1, 1, 0.9]}>
          <cylinderGeometry args={[0.36, 0.36, 0.018, seg]} />
          {felt}
        </mesh>
        <mesh position={[0, 0.02, 0]} rotation-x={Math.PI / 2} scale={[1, 0.9, 1]}>
          <torusGeometry args={[0.35, 0.025, 6, seg]} />
          {felt}
        </mesh>
        <mesh position={[0, 0.11, 0]} castShadow scale={[1, 1, 0.85]}>
          <cylinderGeometry args={[0.15, 0.19, 0.2, seg]} />
          {felt}
        </mesh>
        <mesh position={[0, 0.215, 0]} scale={[1, 0.3, 0.85]}>
          <sphereGeometry args={[0.15, seg, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
          {felt}
        </mesh>
        <mesh position={[0, 0.045, 0]} scale={[1, 1, 0.85]}>
          <cylinderGeometry args={[0.186, 0.188, 0.04, seg]} />
          <meshStandardMaterial color="#1c1917" roughness={0.5} />
        </mesh>
      </group>
    );
  }
  const brimR = kind === "fedora" ? 0.31 : 0.27;
  return (
    <group position={[0, 0.13, -0.01]} rotation={[-0.08, 0, 0]}>
      <mesh castShadow>
        <cylinderGeometry args={[brimR, brimR, 0.022, seg]} />
        {felt}
      </mesh>
      {kind === "bowler" ? (
        <mesh position={[0, 0.01, 0]} castShadow>
          <sphereGeometry args={[0.185, seg, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
          {felt}
        </mesh>
      ) : (
        <mesh position={[0, 0.1, 0]} castShadow>
          <cylinderGeometry args={[0.15, 0.19, 0.19, seg]} />
          {felt}
        </mesh>
      )}
    </group>
  );
}

function Hair({ look, seg }: { look: PersonLook; seg: number }) {
  const mat = <meshStandardMaterial color={look.hair} roughness={0.9} />;
  return (
    <group>
      <mesh position={[0, 0.03, -0.03]} scale={[0.97, 0.92, 0.96]}>
        <sphereGeometry args={[0.2, seg, 12, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
        {mat}
      </mesh>
      {look.hairStyle === "long" && (
        <mesh position={[0, -0.1, -0.07]} scale={[1, 1, 0.75]}>
          <cylinderGeometry args={[0.2, 0.17, 0.3, seg, 1, true, Math.PI * 0.62, Math.PI * 1.76]} />
          <meshStandardMaterial color={look.hair} roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
      )}
      {look.hairStyle === "bun" && (
        <mesh position={[0, 0.17, -0.12]}>
          <sphereGeometry args={[0.085, 12, 10]} />
          {mat}
        </mesh>
      )}
      {look.hairStyle === "spiky" &&
        [-0.1, -0.03, 0.04, 0.11].map((x, i) => (
          <mesh key={i} position={[x, 0.2, 0.02 - Math.abs(x) * 0.3]} rotation={[0.3, 0, -x * 2.5]}>
            <coneGeometry args={[0.045, 0.1, 6]} />
            {mat}
          </mesh>
        ))}
    </group>
  );
}

export interface SeatedPersonProps {
  /** Varies idle timing so a table doesn't fidget in sync. */
  seed: number;
  look: PersonLook;
  /** Accent colour (tie) — usually the seat colour. */
  color: string;
  position: THREE.Vector3;
  /** Rotation around y; local +z must end up facing the table. */
  facing: number;
  mood: PersonMood;
  /** World point to turn the head (and a pointing arm) toward. */
  lookAt?: THREE.Vector3 | null;
  /** Max head turn (radians) — keep small when something on the face must stay readable. */
  maxYaw?: number;
  /** Greyed out and slumped (e.g. eliminated). */
  out?: boolean;
  lowDetail: boolean;
  chair?: "wood" | "stool" | "none";
  chairColor?: string;
  /** Rendered inside the head group (e.g. a forehead card); head-local +z is the face. */
  headSlot?: ReactNode;
  /** Rendered at the body root (e.g. a name tag above the head). */
  children?: ReactNode;
}

export default function SeatedPerson(props: SeatedPersonProps) {
  const { look, color, position, facing, lowDetail, seed } = props;
  const seg = lowDetail ? 10 : 20;
  const root = useRef<THREE.Group>(null);
  const spine = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const lS = useRef<THREE.Group>(null);
  const lE = useRef<THREE.Group>(null);
  const rS = useRef<THREE.Group>(null);
  const rE = useRef<THREE.Group>(null);
  const eyes = useRef<THREE.Group>(null);
  const browL = useRef<THREE.Mesh>(null);
  const browR = useRef<THREE.Mesh>(null);
  const mouth = useRef<THREE.Group>(null);
  const sweat = useRef<THREE.Mesh>(null);
  const coatMat = useRef<THREE.MeshStandardMaterial>(null);
  const coatGeo = useMemo(() => new THREE.LatheGeometry(COAT_PROFILE, lowDetail ? 12 : 22), [lowDetail]);
  const coatColor = useMemo(() => new THREE.Color(look.coat), [look.coat]);
  const cur = useRef<{ pose: Pose; brow: number; eye: number; sweat: number; look: [number, number]; out: number } | null>(null);

  useFrame(({ clock }, dt) => {
    const now = clock.elapsedTime;
    if (!cur.current) cur.current = { pose: [...POSES.rest], brow: 0, eye: 1, sweat: 0, look: [0, 0], out: 0 };
    const c = cur.current;
    let mood: PersonMood = props.out ? "slump" : props.mood;
    // idle fidgets when nothing is going on
    if (mood === "rest") {
      const slot = Math.floor((now + seed * 2.3) / 7);
      const inSlot = (now + seed * 2.3) % 7;
      if (inSlot < 2.2) {
        const r = hash(seed, slot);
        if (r < 0.25) mood = "think";
        else if (r < 0.35) mood = "shrug";
      }
    }
    const target = POSES[mood];
    const face = FACES[mood];
    const rate = 1 - Math.exp(-dt * 7);
    for (let i = 0; i < target.length; i++) c.pose[i] += (target[i] - c.pose[i]) * rate;
    c.brow += (face.brow - c.brow) * rate;
    c.eye += (face.eye - c.eye) * rate;
    c.sweat += (face.sweat - c.sweat) * (1 - Math.exp(-dt * 3));
    c.out += ((props.out ? 1 : 0) - c.out) * (1 - Math.exp(-dt * 3));
    const q = c.pose;

    const osc = (f: number, a: number) => Math.sin(now * f + seed) * a;
    let spineX = q[0];
    let headX = q[3];
    let lSy = q[7];
    let rSx = q[10];
    let rSy = q[11];
    let lEx = q[9];
    let rEx = q[13];
    if (mood === "clap") {
      const s = Math.max(0, Math.sin(now * 14));
      rSy += s * 0.18;
      lSy -= s * 0.18;
    }
    if (mood === "laugh") {
      spineX += osc(16, 0.05);
      headX += osc(16, 0.06);
    }
    if (mood === "talk") {
      rSx += osc(5.5, 0.18);
      rEx += osc(7, 0.2);
      headX += osc(4, 0.04);
    }
    if (mood === "cheer") {
      lEx += osc(9, 0.25);
      rEx += osc(9, 0.25);
    }
    if (mood === "write") rEx += osc(13, 0.08);
    if (mood === "nervous") {
      lEx += osc(29, 0.02);
      rEx += osc(31, 0.02);
    }
    if (mood === "rest" && hash(seed, Math.floor(now / 9)) > 0.6) rEx += Math.max(0, Math.sin(now * 11)) * 0.05;

    if (root.current) root.current.position.y = Math.sin(now * 1.6 + seed) * 0.006 * (1 - c.out);
    if (spine.current) {
      spine.current.rotation.set(spineX, q[1], q[2]);
      spine.current.scale.y = 1 + Math.sin(now * 1.6 + seed) * 0.006;
    }
    // head turn toward lookAt (in this person's local frame)
    let yaw = 0;
    let pitch = 0;
    const la = props.lookAt;
    if (la && !props.out) {
      const dx = la.x - position.x;
      const dz = la.z - position.z;
      const lx = dx * Math.cos(facing) - dz * Math.sin(facing);
      const lz = dx * Math.sin(facing) + dz * Math.cos(facing);
      const my = props.maxYaw ?? 1.0;
      yaw = Math.max(-my, Math.min(my, Math.atan2(lx, Math.max(0.05, lz))));
      const dist = Math.hypot(dx, dz);
      pitch = Math.max(-0.4, Math.min(0.5, Math.atan2(1.45 - la.y, Math.max(0.3, dist)) * 0.7));
    }
    c.look[0] += (yaw - c.look[0]) * (1 - Math.exp(-dt * 5));
    c.look[1] += (pitch - c.look[1]) * (1 - Math.exp(-dt * 5));
    head.current?.rotation.set(headX + c.look[1], q[4] + c.look[0], q[5] + Math.sin(now * 0.7 + seed) * 0.025);
    const pointYaw = mood === "point" ? c.look[0] : 0;
    lS.current?.rotation.set(q[6], lSy, q[8]);
    lE.current?.rotation.set(lEx, 0, 0);
    rS.current?.rotation.set(rSx + (mood === "point" ? c.look[1] * 0.6 : 0), rSy + pointYaw * 0.9, q[12]);
    rE.current?.rotation.set(rEx, 0, 0);

    if (eyes.current) {
      const b = (now + seed * 1.37) % 4.2;
      eyes.current.scale.y = Math.max(0.06, c.eye * (b < 0.12 && c.eye > 0.3 ? 0.12 : 1));
    }
    browL.current?.rotation.set(0, 0, 0.12 + c.brow * 0.38);
    browR.current?.rotation.set(0, 0, -0.12 - c.brow * 0.38);
    if (mouth.current) {
      // talking flaps between "o" and "flat"
      const m = mood === "talk" ? (Math.sin(now * 13 + seed) > 0 ? "o" : "flat") : face.mouth;
      for (const ch of mouth.current.children) ch.visible = ch.name === m;
    }
    if (sweat.current) {
      sweat.current.visible = c.sweat > 0.15;
      const drip = (now * 0.35 + seed * 0.2) % 1;
      sweat.current.position.set(-0.17, 0.08 - drip * 0.12, 0.08);
      (sweat.current.material as THREE.MeshStandardMaterial).opacity = c.sweat * 0.8 * (1 - drip * 0.6);
    }
    if (coatMat.current) coatMat.current.color.copy(coatColor).lerp(GREY, c.out * 0.7);
  });

  const skin = <meshStandardMaterial color={look.skin} roughness={0.62} />;
  const sleeve = <meshStandardMaterial color={look.coat} roughness={0.75} />;
  const arm = (side: 1 | -1, sRef: React.RefObject<THREE.Group | null>, eRef: React.RefObject<THREE.Group | null>) => (
    <group ref={sRef} position={[0.34 * side, 0.67, 0.04]}>
      <mesh position={[0, -0.18, 0]} castShadow>
        <capsuleGeometry args={[0.075, 0.24, 4, lowDetail ? 6 : 10]} />
        {sleeve}
      </mesh>
      <group ref={eRef} position={[0, -0.36, 0]}>
        <mesh position={[0, -0.14, 0]} castShadow>
          <capsuleGeometry args={[0.065, 0.2, 4, lowDetail ? 6 : 10]} />
          {sleeve}
        </mesh>
        <mesh position={[0, -0.34, 0.01]} scale={[1, 0.8, 1.15]} castShadow>
          <sphereGeometry args={[0.062, 12, 10]} />
          {skin}
        </mesh>
      </group>
    </group>
  );
  const chair = props.chair ?? "wood";
  const chairColor = props.chairColor ?? "#5a2e17";

  return (
    <group position={position} rotation-y={facing}>
      {chair === "wood" && (
        <group>
          <mesh position={[0, 0.98, -0.36]} castShadow>
            <boxGeometry args={[0.72, 0.86, 0.07]} />
            <meshStandardMaterial color={chairColor} roughness={0.6} />
          </mesh>
          <mesh position={[0, 0.48, 0]} castShadow>
            <boxGeometry args={[0.7, 0.07, 0.65]} />
            <meshStandardMaterial color={chairColor} roughness={0.7} />
          </mesh>
          {[-1, 1].flatMap((sx) =>
            [-1, 1].map((sz) => (
              <mesh key={`${sx}${sz}`} position={[0.3 * sx, 0.22, 0.26 * sz]}>
                <boxGeometry args={[0.06, 0.46, 0.06]} />
                <meshStandardMaterial color={chairColor} roughness={0.7} />
              </mesh>
            )),
          )}
        </group>
      )}
      {chair === "stool" && (
        <group>
          <mesh position={[0, 0.47, 0]} castShadow>
            <cylinderGeometry args={[0.32, 0.3, 0.08, 16]} />
            <meshStandardMaterial color={chairColor} roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.22, 0]}>
            <cylinderGeometry args={[0.06, 0.14, 0.44, 10]} />
            <meshStandardMaterial color={chairColor} roughness={0.7} />
          </mesh>
        </group>
      )}
      <group ref={root}>
        <group ref={spine} position={[0, 0.55, -0.06]}>
          <mesh geometry={coatGeo} scale={[1, 1, 0.78]} castShadow>
            <meshStandardMaterial ref={coatMat} color={look.coat} roughness={0.78} />
          </mesh>
          <mesh position={[0, 0.5, 0.26]} rotation={[-0.12, 0, 0]}>
            <planeGeometry args={[0.2, 0.36]} />
            <meshStandardMaterial color={look.shirt} roughness={0.6} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, 0.44, 0.272]} rotation={[-0.12, 0, 0]}>
            <planeGeometry args={[0.045, 0.16]} />
            <meshStandardMaterial color={color} roughness={0.4} side={THREE.DoubleSide} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[0.085 * s, 0.51, 0.265]} rotation={[-0.12, 0, 0.32 * s]}>
              <planeGeometry args={[0.06, 0.34]} />
              <meshStandardMaterial color={look.coat} roughness={0.7} side={THREE.DoubleSide} />
            </mesh>
          ))}
          {arm(-1, lS, lE)}
          {arm(1, rS, rE)}
          <mesh position={[0, 0.77, 0.04]}>
            <cylinderGeometry args={[0.075, 0.085, 0.12, 12]} />
            {skin}
          </mesh>
          <group ref={head} position={[0, 0.97, 0.06]}>
            <mesh castShadow scale={[0.92, 1.06, 0.95]}>
              <sphereGeometry args={[0.2, seg + 6, seg]} />
              {skin}
            </mesh>
            <Hair look={look} seg={seg} />
            {[-1, 1].map((s) => (
              <mesh key={s} position={[0.185 * s, -0.01, 0]} scale={[0.5, 1, 0.8]}>
                <sphereGeometry args={[0.045, 10, 8]} />
                {skin}
              </mesh>
            ))}
            <group ref={eyes} position={[0, 0.02, 0.165]}>
              {[-1, 1].map((s) => (
                <group key={s} position={[0.066 * s, 0, 0]}>
                  <mesh scale={[1, 0.85, 0.6]}>
                    <sphereGeometry args={[0.033, 14, 10]} />
                    <meshStandardMaterial color="#fbfaf7" roughness={0.3} />
                  </mesh>
                  <mesh position={[0, 0, 0.018]}>
                    <sphereGeometry args={[0.017, 10, 8]} />
                    <meshStandardMaterial color="#2b1a10" roughness={0.2} />
                  </mesh>
                </group>
              ))}
            </group>
            {look.glasses &&
              [-1, 1].map((s) => (
                <mesh key={s} position={[0.066 * s, 0.02, 0.19]}>
                  <torusGeometry args={[0.042, 0.006, 6, 18]} />
                  <meshStandardMaterial color="#1f2937" metalness={0.6} roughness={0.3} />
                </mesh>
              ))}
            <mesh ref={browL} position={[-0.066, 0.075, 0.172]}>
              <boxGeometry args={[0.062, 0.013, 0.012]} />
              <meshStandardMaterial color={look.hair} roughness={0.9} />
            </mesh>
            <mesh ref={browR} position={[0.066, 0.075, 0.172]}>
              <boxGeometry args={[0.062, 0.013, 0.012]} />
              <meshStandardMaterial color={look.hair} roughness={0.9} />
            </mesh>
            <mesh position={[0, -0.025, 0.19]} scale={[0.8, 1.1, 1]}>
              <sphereGeometry args={[0.026, 10, 8]} />
              {skin}
            </mesh>
            {look.beard && (
              <mesh position={[0, -0.1, 0.1]} scale={[1, 0.8, 0.75]}>
                <sphereGeometry args={[0.15, seg, 10, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.35]} />
                <meshStandardMaterial color={look.hair} roughness={0.95} side={THREE.DoubleSide} />
              </mesh>
            )}
            <group ref={mouth} position={[0, -0.088, 0.174]}>
              <mesh name="flat">
                <boxGeometry args={[0.06, 0.009, 0.01]} />
                <meshStandardMaterial color="#7c2d2d" roughness={0.6} />
              </mesh>
              <mesh name="smile" rotation={[0, 0, Math.PI * 1.15]} position={[0, 0.02, 0]}>
                <torusGeometry args={[0.035, 0.007, 6, 12, Math.PI * 0.7]} />
                <meshStandardMaterial color="#7c2d2d" roughness={0.6} />
              </mesh>
              <group name="grin">
                <mesh position={[0, 0.004, 0]} rotation={[0, 0, Math.PI]}>
                  <circleGeometry args={[0.04, 14, 0, Math.PI]} />
                  <meshStandardMaterial color="#4a1414" side={THREE.DoubleSide} />
                </mesh>
                <mesh position={[0, -0.004, 0.002]}>
                  <planeGeometry args={[0.062, 0.012]} />
                  <meshStandardMaterial color="#fafaf9" side={THREE.DoubleSide} />
                </mesh>
              </group>
              <mesh name="frown" rotation={[0, 0, Math.PI * 0.15]} position={[0, -0.025, 0]}>
                <torusGeometry args={[0.035, 0.007, 6, 12, Math.PI * 0.7]} />
                <meshStandardMaterial color="#7c2d2d" roughness={0.6} />
              </mesh>
              <mesh name="o" scale={[0.75, 1, 0.4]}>
                <sphereGeometry args={[0.024, 10, 8]} />
                <meshStandardMaterial color="#3b0d0d" roughness={0.6} />
              </mesh>
            </group>
            <mesh ref={sweat} visible={false}>
              <sphereGeometry args={[0.016, 8, 6]} />
              <meshStandardMaterial color="#9fd6ff" transparent opacity={0} roughness={0.1} />
            </mesh>
            <Hat kind={look.hat} color={look.hatColor} seg={seg} />
            {props.headSlot}
          </group>
        </group>
        {props.children}
      </group>
    </group>
  );
}
