"use client";

import type { ReactNode } from "react";
import * as THREE from "three";
import type { Persona } from "./persona";

/**
 * The shared vocabulary of a seated table player — moods, arm poses, faces,
 * blinking, hats and the props every table passes in. The body itself is the
 * VRoid model in VrmPerson.tsx (the old cartoon rig that used to live here was
 * removed 2026-10-27 so it can never show up again).
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
  | "slump"
  // one-shot action gestures (games show them for a couple of seconds after the event)
  | "wave" // "pass" — waving a hand off
  | "guard" // blocking — forearms crossed in front of the face
  | "stab" // a dagger thrust
  | "grab" // reach out and snatch back
  | "rake" // scooping coins in with both hands
  | "shuffle" // riffling cards between the hands
  | "slam"; // fist raised high and brought down

// The look data (types, palettes, seat defaults, profile validation) lives in the
// three-free @/lib/character/avatar module so profile UIs and storage can use it without three.js.
import type { HatKind, PersonLook } from "@/lib/character/avatar";
export { defaultLook, resolveLook, type BodyBuild, type EyeShape, type FaceShape, type HairStyle, type HatKind, type PersonGender, type PersonLook } from "@/lib/character/avatar";

// ---------------------------------------------------------------------------
// Poses: [spineX, spineY, spineZ, headX, headY, headZ, lSx, lSy, lSz, lE, rSx, rSy, rSz, rE]
// Shoulder x<0 swings the arm forward/up; L inward is +y/+z, R inward is −y/−z.
// ---------------------------------------------------------------------------

export type Pose = number[];
interface PoseSpec {
  spine?: [number, number, number];
  head?: [number, number, number];
  lS?: [number, number, number];
  lE?: number;
  rS?: [number, number, number];
  rE?: number;
}
const REST: Required<PoseSpec> = { spine: [0, 0, 0], head: [0.1, 0, 0], lS: [-0.75, 0, 0.12], lE: -0.9, rS: [-0.75, 0, -0.12], rE: -0.9 };
/**
 * The cartoon rig's resting base: leaning in a touch with the forearms laid on the felt
 * (hands ~0.1 inside the rim). REST left the hands hovering just outside the table edge.
 * Solved by forward kinematics over this rig's chain (spine → shoulder → elbow → hand);
 * see SeatedPerson.test.ts.
 */
const TABLE_REST: Required<PoseSpec> = { spine: [0.12, 0, 0], head: [-0.02, 0, 0], lS: [-1.03, 0, 0.12], lE: -0.58, rS: [-1.03, 0, -0.12], rE: -0.58 };
function P(spec: PoseSpec, base: Required<PoseSpec> = REST): Pose {
  const s = { ...base, ...spec };
  return [...s.spine, ...s.head, ...s.lS, s.lE, ...s.rS, s.rE];
}

const SPECS: Record<PersonMood, PoseSpec> = {
  rest: {},
  think: { spine: [0.08, 0, 0], head: [0.05, 0, 0.14], rS: [-1.2, -0.55, 0], rE: -1.95 },
  talk: { spine: [0.05, 0, 0], head: [0.02, 0, 0], rS: [-1.05, -0.3, -0.15], rE: -1.45 },
  point: { spine: [0.14, 0, 0], head: [0.02, 0, 0], rS: [-1.5, 0, -0.05], rE: -0.1 },
  nervous: { spine: [0.14, 0, 0], head: [0.22, 0, 0], lS: [-0.85, 0.35, 0.15], lE: -1.1, rS: [-0.85, -0.35, -0.15], rE: -1.1 },
  cheer: { spine: [-0.08, 0, 0], head: [-0.2, 0, 0], lS: [-2.9, 0, -0.35], lE: -0.2, rS: [-2.9, 0, 0.35], rE: -0.2 },
  sad: { spine: [0.24, 0, 0], head: [0.5, 0, 0], lS: [-0.45, 0, 0.1], lE: -0.5, rS: [-0.45, 0, -0.1], rE: -0.5 },
  shock: { spine: [-0.1, 0, 0], head: [-0.12, 0, 0], lS: [-2.5, 0.3, -0.35], lE: -2.3, rS: [-2.5, -0.3, 0.35], rE: -2.3 },
  laugh: { spine: [-0.22, 0, 0], head: [-0.32, 0, 0], lS: [-0.5, 0.3, 0.25], lE: -1.2, rS: [-0.5, -0.3, -0.25], rE: -1.2 },
  smug: { spine: [-0.16, 0, 0], head: [-0.12, 0, 0.12], lS: [-1.25, 0.75, 0.1], lE: -1.75, rS: [-1.15, -0.75, -0.1], rE: -1.8 },
  clap: { spine: [0.04, 0, 0], head: [0, 0, 0], lS: [-1.1, 0.55, 0], lE: -1.4, rS: [-1.1, -0.55, 0], rE: -1.4 },
  raise: { spine: [-0.04, 0, 0], head: [-0.05, 0, 0], rS: [-2.85, 0, 0.3], rE: -0.25 },
  write: { spine: [0.26, 0, 0], head: [0.42, 0, 0], lS: [-1.05, 0.3, 0.1], lE: -1.2, rS: [-1.1, -0.2, -0.1], rE: -1.05 },
  shrug: { head: [0, 0, 0.15], lS: [-0.55, 0.2, 0.65], lE: -1.6, rS: [-0.55, -0.2, -0.65], rE: -1.6 },
  slump: { spine: [0.5, 0, 0.08], head: [0.65, 0, 0.35], lS: [-1.3, 0.35, 0], lE: -0.7, rS: [-1.3, -0.35, 0], rE: -0.7 },
  wave: { head: [0.05, 0, 0], rS: [-1.35, -0.15, 0.25], rE: -1.5 },
  guard: { spine: [-0.1, 0, 0], head: [0.15, 0, 0], lS: [-1.75, 0.7, 0.15], lE: -1.95, rS: [-1.75, -0.7, -0.15], rE: -1.95 },
  stab: { spine: [0.22, 0, 0.05], head: [0, 0, 0], lS: [-0.6, 0, 0.2], lE: -1.2, rS: [-1.55, -0.1, -0.05], rE: -0.2 },
  grab: { spine: [0.2, 0, 0], head: [0, 0, 0], rS: [-1.6, -0.05, -0.05], rE: -0.1 },
  rake: { spine: [0.25, 0, 0], head: [0.2, 0, 0], lS: [-1.35, 0.35, 0.15], lE: -0.35, rS: [-1.35, -0.35, -0.15], rE: -0.35 },
  shuffle: { spine: [0.08, 0, 0], head: [0.25, 0, 0], lS: [-1.15, 0.55, 0], lE: -1.45, rS: [-1.15, -0.55, 0], rE: -1.45 },
  slam: { spine: [0.05, 0, 0], head: [-0.05, 0, 0], rS: [-1.3, -0.1, -0.1], rE: -0.5 },
};

const mapSpecs = (base: Required<PoseSpec>) => Object.fromEntries(Object.entries(SPECS).map(([k, v]) => [k, P(v, base)])) as Record<PersonMood, Pose>;
/** Shared key poses (the realistic rig layers its adult-arm correction on these). */
export const POSES: Record<PersonMood, Pose> = mapSpecs(REST);
/** The cartoon rig's poses: same specs, but any arm a mood leaves free rests on the table. */
export const TABLE_POSES: Record<PersonMood, Pose> = mapSpecs(TABLE_REST);
/**
 * Holding a hand of cards: both hands meet in front of the chest just above the rim
 * (±0.08, 1.06, 0.50 person-local), elbows kept outside the torso. Replaces the arm
 * channels (6-13) and the spine lean of the calm moods while a seat has something `held`.
 */
export const HOLD_ARMS = { spine: 0.08, arms: [-0.9, 0.8, 0.08, -1.28, -0.9, -0.8, -0.08, -1.28] };
/** Where a held hand of cards sits in the spine group's frame (the hold point above, minus the lean). */
export const HOLD_POINT: [number, number, number] = [0, 0.52, 0.52];
const HOLD_MOODS = new Set<PersonMood>(["rest", "talk", "nervous", "smug", "write", "sad"]);
/** Whether a seat with something `held` grips it in this mood (big reactions let go for the gesture). */
export const holdsInMood = (mood: PersonMood) => HOLD_MOODS.has(mood);
export function holdPose(pose: Pose, mood: PersonMood): Pose {
  if (!HOLD_MOODS.has(mood)) return pose;
  const out = [...pose];
  out[0] = Math.max(out[0], HOLD_ARMS.spine);
  for (let i = 0; i < 8; i++) out[6 + i] = HOLD_ARMS.arms[i];
  return out;
}

export interface Face {
  brow: number; // −1 angry … +1 worried
  mouth: "flat" | "smile" | "grin" | "frown" | "o";
  eye: number;
  sweat: number;
}
export const FACES: Record<PersonMood, Face> = {
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
  wave: { brow: 0.1, mouth: "flat", eye: 0.85, sweat: 0 },
  guard: { brow: -0.7, mouth: "frown", eye: 1.1, sweat: 0 },
  stab: { brow: -0.9, mouth: "grin", eye: 0.7, sweat: 0 },
  grab: { brow: -0.5, mouth: "grin", eye: 0.9, sweat: 0 },
  rake: { brow: 0.3, mouth: "grin", eye: 0.8, sweat: 0 },
  shuffle: { brow: -0.2, mouth: "smile", eye: 0.7, sweat: 0 },
  slam: { brow: -1, mouth: "o", eye: 1.2, sweat: 0 },
};

/** Natural blinking: irregular gaps (2-6 s) and the occasional double blink. */
export function blinking(t: number, seed: number): boolean {
  const T = t + seed * 1.37;
  const slot = Math.floor(T / 4);
  const at = 0.4 + hash(seed, slot + 31) * 3;
  const u = T - slot * 4 - at;
  if (u >= 0 && u < 0.13) return true;
  return hash(seed, slot + 57) < 0.2 && u >= 0.26 && u < 0.38;
}
const hash = (a: number, b: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export function Hat({ kind, color, seg }: { kind: HatKind; color: string; seg: number }) {
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

/** The hair's sheen colour: much lighter, a touch warm, so even black hair shows a gloss band. */
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
  /** Temperament: where a calm player's eyes wander and how restless they are (persona.ts). */
  persona?: Persona;
  /** The viewer's head (world) — what a "starer" keeps looking at. */
  viewerAt?: THREE.Vector3 | null;
  /** Held in both hands in front of the chest (e.g. a fan of cards), authored like a seat's `front`: +z toward the holder. */
  held?: ReactNode;
}

/** Moods with something to react to: every persona follows the game's cue then. */
export const STRONG_MOODS = new Set<PersonMood>(["point", "cheer", "shock", "laugh", "clap", "raise", "slump", "sad", "guard", "stab", "grab", "slam"]);
