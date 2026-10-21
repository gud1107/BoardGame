"use client";

import { useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { createMotion, HANDS, stepMotion, type MotionState } from "./motion";
import { kpopEyeTexture } from "./kpopEyes";

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

// The look data (types, palettes, seat defaults, profile validation) lives in the
// three-free @/lib/character/avatar module so profile UIs and storage can use it without three.js.
import type { HatKind, PersonLook } from "@/lib/character/avatar";
export { defaultLook, resolveLook, type HairStyle, type HatKind, type PersonGender, type PersonLook } from "@/lib/character/avatar";

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
function P(spec: PoseSpec): Pose {
  const s = { ...REST, ...spec };
  return [...s.spine, ...s.head, ...s.lS, s.lE, ...s.rS, s.rE];
}

export const POSES: Record<PersonMood, Pose> = {
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
};

const GREY = new THREE.Color("#57534e");
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
function highlight(hex: string): string {
  const c = new THREE.Color(hex);
  return "#" + c.lerp(new THREE.Color("#fff3e6"), 0.55).getHexString();
}

/** Head sphere radii (0.2 × the head mesh's [0.92, 1.06, 0.95] scale). */
const HEAD_R = [0.184, 0.212, 0.19] as const;
/** A point `lift` above the face-side head surface at (x, y), and a YXZ euler laying a y-axis strand flat on it (pointing up the scalp). */
function onHead(x: number, y: number, lift = 0.012, roll = 0): { position: [number, number, number]; rotation: [number, number, number, "YXZ"] } {
  const [rx, ry, rz] = HEAD_R;
  const z = rz * Math.sqrt(Math.max(0.02, 1 - (x / rx) ** 2 - (y / ry) ** 2));
  let nx = x / (rx * rx);
  let ny = y / (ry * ry);
  let nz = z / (rz * rz);
  const l = Math.hypot(nx, ny, nz);
  nx /= l;
  ny /= l;
  nz /= l;
  return { position: [x + nx * lift, y + ny * lift, z + nz * lift], rotation: [Math.atan2(-ny, Math.hypot(nx, nz)), Math.atan2(nx, nz), roll, "YXZ"] };
}

function Strand({ x, y, len, r = 0.016, roll = 0, mat }: { x: number; y: number; len: number; r?: number; roll?: number; mat: ReactNode }) {
  const t = onHead(x, y, 0.006, roll);
  return (
    <mesh position={t.position} rotation={t.rotation} scale={[1.6, 1, 0.32]}>
      <capsuleGeometry args={[r, len, 3, 8]} />
      {mat}
    </mesh>
  );
}

/** K-pop hairline shells: full-round cap down to polar angle `t·π` (y ≈ 0.218·cos), a hair's breadth outside the head. */
function Hairline({ t, seg, mat, phi = [0, Math.PI * 2] }: { t: number; seg: number; mat: ReactNode; phi?: [number, number] }) {
  return (
    <mesh scale={[0.95, 1.09, 0.985]}>
      <sphereGeometry args={[0.2, seg + 6, 10, phi[0], phi[1], 0, Math.PI * t]} />
      {mat}
    </mesh>
  );
}

function Hair({ look, seg }: { look: PersonLook; seg: number }) {
  const mat = <meshStandardMaterial color={look.hair} roughness={0.9} />;
  // idol hair: glossier, double-sided so open shells read from inside too
  const gloss = <meshStandardMaterial color={look.hair} roughness={0.5} metalness={0.05} side={THREE.DoubleSide} />;
  const st = look.hairStyle;
  return (
    <group>
      <mesh position={[0, 0.03, -0.03]} scale={[0.97, 0.92, 0.96]}>
        <sphereGeometry args={[0.2, seg, 12, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
        {st === "short" || st === "long" || st === "bun" || st === "spiky" ? mat : gloss}
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

      {/* glossy "angel ring" highlight band across the crown of the idol cuts */}
      {(st === "straight" || st === "hush" || st === "pony" || st === "comma" || st === "curtain" || st === "dandy") && (
        <mesh scale={[0.958, 1.098, 0.993]} rotation-x={-0.25}>
          <sphereGeometry args={[0.2, seg + 6, 4, 0, Math.PI * 2, Math.PI * 0.15, Math.PI * 0.06]} />
          <meshBasicMaterial color={highlight(look.hair)} transparent opacity={0.4} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* ── women: sleek long straight hair / layered hush cut / high ponytail, all with see-through bangs ── */}
      {(st === "straight" || st === "hush" || st === "pony") && (
        <>
          <Hairline t={st === "pony" ? 0.31 : 0.29} seg={seg} mat={gloss} />
          {[-0.075, -0.045, -0.015, 0.015, 0.045, 0.075].map((x, i) => (
            <Strand key={i} x={x} y={0.13} len={0.045} r={0.017} roll={x * 0.8} mat={gloss} />
          ))}
        </>
      )}
      {st === "straight" && (
        <>
          <mesh position={[0, -0.17, -0.05]} scale={[1, 1, 0.8]}>
            <cylinderGeometry args={[0.2, 0.205, 0.5, seg, 1, true, Math.PI * 0.6, Math.PI * 1.8]} />
            {gloss}
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[0.168 * s, -0.14, 0.07]} rotation-z={0.06 * s} scale={[0.7, 1, 1]}>
              <capsuleGeometry args={[0.034, 0.3, 4, 8]} />
              {gloss}
            </mesh>
          ))}
        </>
      )}
      {st === "hush" && (
        <>
          <mesh position={[0, -0.13, -0.05]} scale={[1, 1, 0.8]}>
            <cylinderGeometry args={[0.2, 0.25, 0.4, seg, 1, true, Math.PI * 0.6, Math.PI * 1.8]} />
            {gloss}
          </mesh>
          {[-1, 1].map((s) => (
            <group key={s}>
              <mesh position={[0.17 * s, -0.1, 0.07]} rotation-z={-0.22 * s} scale={[0.75, 1, 1]}>
                <capsuleGeometry args={[0.036, 0.2, 4, 8]} />
                {gloss}
              </mesh>
              {/* outward-flicked layered ends */}
              <mesh position={[0.2 * s, -0.25, 0.02]} rotation-z={-0.9 * s} scale={[0.7, 1, 1]}>
                <capsuleGeometry args={[0.03, 0.08, 4, 8]} />
                {gloss}
              </mesh>
            </group>
          ))}
        </>
      )}
      {st === "pony" && (
        <>
          <mesh position={[0, 0.15, -0.16]}>
            <sphereGeometry args={[0.05, 12, 10]} />
            {gloss}
          </mesh>
          <mesh position={[0, 0.0, -0.23]} rotation-x={0.3} scale={[0.85, 1, 0.75]}>
            <capsuleGeometry args={[0.055, 0.26, 4, 10]} />
            {gloss}
          </mesh>
          {/* scrunchie */}
          <mesh position={[0, 0.14, -0.17]} rotation-x={1.2}>
            <torusGeometry args={[0.045, 0.014, 6, 14]} />
            <meshStandardMaterial color="#f9a8d4" roughness={0.8} />
          </mesh>
        </>
      )}

      {/* ── men: comma hair / curtain (middle-part) bangs / full dandy fringe, volume on top ── */}
      {(st === "comma" || st === "curtain" || st === "dandy") && (
        <Hairline t={st === "dandy" ? 0.355 : st === "comma" ? 0.32 : 0.3} seg={seg} mat={gloss} />
      )}
      {/* comma: fringe swept to one side, its tip dipping lowest at the brow */}
      {st === "comma" &&
        [-0.07, -0.038, -0.006, 0.026, 0.056].map((x, i) => <Strand key={i} x={x} y={0.13 - i * 0.007} len={0.05} r={0.018} roll={0.5} mat={gloss} />)}
      {st === "curtain" &&
        [-1, 1].map((s) =>
          [0.035, 0.075].map((x, i) => <Strand key={`${s}${i}`} x={x * s} y={0.125 - i * 0.008} len={0.06} r={0.02} roll={-0.75 * s} mat={gloss} />),
        )}
      {st === "dandy" && [-0.075, -0.035, 0.005, 0.045, 0.08].map((x, i) => <Strand key={i} x={x} y={0.115} len={0.035} r={0.016} roll={0.2} mat={gloss} />)}
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
  // dyed (light) idol hair keeps darker brows
  const browColor = useMemo(() => "#" + new THREE.Color(look.hair).lerp(new THREE.Color("#2a1c16"), 0.45).getHexString(), [look.hair]);
  const fem = look.gender === "f";
  const eyeTex = useMemo(() => kpopEyeTexture(look.gender, look.gender === "f" ? "#6a3f24" : "#4a2e1c"), [look.gender]);
  const lW = useRef<THREE.Group>(null);
  const rW = useRef<THREE.Group>(null);
  const lHand = useRef<THREE.Group>(null);
  const rHand = useRef<THREE.Group>(null);
  const cur = useRef<{ m: MotionState; brow: number; eye: number; sweat: number; look: [number, number]; out: number } | null>(null);

  useFrame(({ clock }, dt) => {
    const now = clock.elapsedTime;
    if (!cur.current) cur.current = { m: createMotion(POSES.rest, HANDS.rest), brow: 0, eye: 1, sweat: 0, look: [0, 0], out: 0 };
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
    const face = FACES[mood];
    const rate = 1 - Math.exp(-dt * 7);
    // body + hands: key pose, gestures and idle life, chased by springs (motion.ts)
    const q = stepMotion(c.m, mood, POSES[mood], now, dt, seed);
    c.brow += (face.brow - c.brow) * rate;
    c.eye += (face.eye - c.eye) * rate;
    c.sweat += (face.sweat - c.sweat) * (1 - Math.exp(-dt * 3));
    c.out += ((props.out ? 1 : 0) - c.out) * (1 - Math.exp(-dt * 3));

    if (root.current) root.current.position.y = Math.sin(now * 1.6 + seed) * 0.006 * (1 - c.out);
    if (spine.current) {
      spine.current.rotation.set(q[0], q[1], q[2]);
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
    // a look target steadies the head: idle drift is mostly cancelled while gazing at someone
    const drift = la ? 0.35 : 1;
    head.current?.rotation.set(q[3] + c.look[1], q[4] * drift + c.look[0], q[5]);
    const pointYaw = mood === "point" ? c.look[0] : 0;
    lS.current?.rotation.set(q[6], q[7], q[8]);
    lE.current?.rotation.set(q[9], 0, 0);
    rS.current?.rotation.set(q[10] + (mood === "point" ? c.look[1] * 0.6 : 0), q[11] + pointYaw * 0.9, q[12]);
    rE.current?.rotation.set(q[13], 0, 0);
    lW.current?.rotation.set(q[14], 0, q[15]);
    rW.current?.rotation.set(q[16], 0, q[17]);
    // a mitten "curls" by flattening into a fist
    lHand.current?.scale.set(1, 1 - q[18] * 0.28, 1 + q[18] * 0.12);
    rHand.current?.scale.set(1, 1 - q[19] * 0.28, 1 + q[19] * 0.12);

    if (eyes.current) {
      eyes.current.scale.y = Math.max(0.06, c.eye * (blinking(now, seed) && c.eye > 0.3 ? 0.12 : 1));
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

  // a touch of self-light in the skin tone fakes subsurface warmth (no grey faces on the shadow side)
  const skin = <meshStandardMaterial color={look.skin} roughness={0.55} emissive={look.skin} emissiveIntensity={0.14} />;
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
        <group ref={side === 1 ? rW : lW} position={[0, -0.29, 0.005]}>
          <group ref={side === 1 ? rHand : lHand}>
            <mesh position={[0, -0.05, 0.005]} scale={[1, 0.8, 1.15]} castShadow>
              <sphereGeometry args={[0.062, 12, 10]} />
              {skin}
            </mesh>
            {/* thumb */}
            <mesh position={[-0.04 * side, -0.035, 0.035]} rotation={[0.6, 0, 0.5 * side]}>
              <capsuleGeometry args={[0.018, 0.035, 2, 6]} />
              {skin}
            </mesh>
          </group>
        </group>
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
            {/* soft cel outline: an inverted hull a hair larger than the head */}
            {!lowDetail && (
              <mesh scale={[0.92 * 1.035, 1.06 * 1.03, 0.95 * 1.035]}>
                <sphereGeometry args={[0.2, seg + 6, seg]} />
                <meshBasicMaterial color="#3a2420" side={THREE.BackSide} />
              </mesh>
            )}
            <Hair look={look} seg={seg} />
            {[-1, 1].map((s) => (
              <mesh key={s} position={[0.185 * s, -0.01, 0]} scale={[0.5, 1, 0.8]}>
                <sphereGeometry args={[0.045, 10, 8]} />
                {skin}
              </mesh>
            ))}
            <group ref={eyes} position={[0, 0.02, 0.165]}>
              {[-1, 1].map((s) => (
                // painted anime eye (kpopEyes.ts) on a card that follows the head's curve; the left one is mirrored
                <mesh key={s} position={[0.066 * s, 0, 0.02]} rotation-y={0.38 * s} scale={[s, 1, 1]} renderOrder={2}>
                  <planeGeometry args={[0.09, 0.07]} />
                  <meshStandardMaterial map={eyeTex} transparent roughness={0.25} depthWrite={false} polygonOffset polygonOffsetFactor={-2} side={THREE.DoubleSide} />
                </mesh>
              ))}
            </group>
            {/* aegyo-sal under the eyes (women) + cheek blush */}
            {fem &&
              [-1, 1].map((s) => (
                <mesh key={`a${s}`} position={[0.066 * s, -0.009, 0.172]} scale={[1.15, 0.32, 0.4]}>
                  <sphereGeometry args={[0.028, 12, 8]} />
                  <meshStandardMaterial color="#ffe3d8" roughness={0.5} />
                </mesh>
              ))}
            {[-1, 1].map((s) => (
              <mesh key={`b${s}`} position={[0.11 * s, -0.045, 0.148]} rotation-y={0.62 * s} scale={[1.3, 0.75, 0.3]}>
                <sphereGeometry args={[0.03, 12, 8]} />
                <meshStandardMaterial color="#f48a9b" transparent opacity={fem ? 0.5 : 0.2} depthWrite={false} roughness={0.8} />
              </mesh>
            ))}
            {fem &&
              [-1, 1].map((s) => (
                <mesh key={`e${s}`} position={[0.19 * s, -0.058, 0.004]}>
                  <sphereGeometry args={[0.011, 10, 8]} />
                  <meshStandardMaterial color="#f5d27a" metalness={0.9} roughness={0.2} />
                </mesh>
              ))}
            {look.glasses &&
              [-1, 1].map((s) => (
                <mesh key={s} position={[0.066 * s, 0.02, 0.19]}>
                  <torusGeometry args={[0.042, 0.006, 6, 18]} />
                  <meshStandardMaterial color="#1f2937" metalness={0.6} roughness={0.3} />
                </mesh>
              ))}
            {/* soft, slim brows (women) / straight, fuller brows (men) */}
            <mesh ref={browL} position={[-0.066, 0.075, 0.172]}>
              <boxGeometry args={fem ? [0.056, 0.009, 0.01] : [0.066, 0.016, 0.013]} />
              <meshStandardMaterial color={browColor} roughness={0.9} />
            </mesh>
            <mesh ref={browR} position={[0.066, 0.075, 0.172]}>
              <boxGeometry args={fem ? [0.056, 0.009, 0.01] : [0.066, 0.016, 0.013]} />
              <meshStandardMaterial color={browColor} roughness={0.9} />
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
                <boxGeometry args={fem ? [0.05, 0.014, 0.012] : [0.056, 0.009, 0.01]} />
                <meshStandardMaterial color={look.lip} roughness={0.35} />
              </mesh>
              <mesh name="smile" rotation={[0, 0, Math.PI * 1.15]} position={[0, 0.02, 0]}>
                <torusGeometry args={[0.035, fem ? 0.009 : 0.007, 6, 12, Math.PI * 0.7]} />
                <meshStandardMaterial color={look.lip} roughness={0.35} />
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
                <meshStandardMaterial color={look.lip} roughness={0.35} />
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
