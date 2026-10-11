"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Resolution, SeatIndex } from "./engine";
import { span, type ShowdownTimeline } from "./timeline";
import type { Avatar, EmoteKind, HatKind } from "./cosmetics";
import { EMOTE_DURATION_S } from "./cosmetics";
import Revolver, { animateRevolver } from "./Revolver";

/**
 * A seated saloon patron (rulebook §T) built as a small rig — hips → spine
 * (3 axes) → head (3 axes, plus look-at) and two arms (shoulder 3 axes,
 * elbow, hand). Everything it does is a blend of named poses plus a face
 * (brows, eyes, five mouth shapes, sweat) chosen every frame from public
 * information only:
 *  - its own trigger pull, acted out step by step (grab → swing the cylinder
 *    out → advance one notch → close → raise to the temple → cock → trembling
 *    hold → click/bang → lower the gun in relief or collapse),
 *  - an emote the player (or a bot) sent,
 *  - automatic reactions to the showdown (pointing when calling "거짓말!",
 *    fear when losing a verdict, shock at a bang, relief at a click),
 *  - thinking on its own turn, and idle fidgets otherwise.
 * +z faces the table. The engine resolves a showdown instantly, so every
 * visual consequence waits for the matching beat of the shared timeline.
 */

// ---------------------------------------------------------------------------
// Poses: flat arrays so blending is a plain lerp.
// [spineX, spineY, spineZ, headX, headY, headZ, lSx, lSy, lSz, lE, rSx, rSy, rSz, rE]
// L = the gun arm (−x side). Shoulder x<0 swings the arm forward/up; L inward is +y/+z, R inward is −y/−z.
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
const REST_SPEC: Required<PoseSpec> = { spine: [0, 0, 0], head: [0.12, 0, 0], lS: [-0.75, 0, 0.12], lE: -0.9, rS: [-0.75, 0, -0.12], rE: -0.9 };
function P(spec: PoseSpec): Pose {
  const s = { ...REST_SPEC, ...spec };
  return [...s.spine, ...s.head, ...s.lS, s.lE, ...s.rS, s.rE];
}

type Mood =
  | "rest"
  | "think"
  | "nervous"
  | "smug"
  | "angry"
  | "pray"
  | "clap"
  | "point"
  | "laugh"
  | "cheer"
  | "scared"
  | "shock"
  | "relief"
  | "dead"
  | "hat"
  | "aim";

const POSES: Record<Mood, Pose> = {
  rest: P({}),
  think: P({ spine: [0.08, 0, 0], head: [0.05, 0, 0.14], rS: [-1.2, -0.55, 0], rE: -1.95 }),
  nervous: P({ spine: [0.14, 0, 0], head: [0.22, 0, 0], lS: [-0.85, 0.35, 0.15], lE: -1.1, rS: [-0.85, -0.35, -0.15], rE: -1.1 }),
  smug: P({ spine: [-0.16, 0, 0], head: [-0.12, 0, 0.12], lS: [-1.25, 0.75, 0.1], lE: -1.75, rS: [-1.15, -0.75, -0.1], rE: -1.8 }),
  angry: P({ spine: [0.26, 0, 0], head: [0.02, 0, 0], lS: [-0.62, 0, 0.05], lE: -1.0, rS: [-0.62, 0, -0.05], rE: -1.0 }),
  pray: P({ spine: [0.1, 0, 0], head: [0.36, 0, 0], lS: [-1.35, 0.5, 0], lE: -1.85, rS: [-1.35, -0.5, 0], rE: -1.85 }),
  clap: P({ spine: [0.04, 0, 0], head: [0.0, 0, 0], lS: [-1.1, 0.55, 0], lE: -1.4, rS: [-1.1, -0.55, 0], rE: -1.4 }),
  point: P({ spine: [0.12, 0, 0], head: [0.02, 0, 0], rS: [-1.5, 0, -0.05], rE: -0.1 }),
  laugh: P({ spine: [-0.22, 0, 0], head: [-0.32, 0, 0], lS: [-0.5, 0.3, 0.25], lE: -1.2, rS: [-0.5, -0.3, -0.25], rE: -1.2 }),
  cheer: P({ spine: [-0.08, 0, 0], head: [-0.2, 0, 0], lS: [-2.9, 0, -0.35], lE: -0.2, rS: [-2.9, 0, 0.35], rE: -0.2 }),
  scared: P({ spine: [-0.18, 0, 0], head: [-0.05, 0, 0], lS: [-2.0, 0.45, 0.1], lE: -1.6, rS: [-2.0, -0.45, -0.1], rE: -1.6 }),
  shock: P({ spine: [-0.1, 0, 0], head: [-0.12, 0, 0], lS: [-2.5, 0.3, -0.35], lE: -2.3, rS: [-2.5, -0.3, 0.35], rE: -2.3 }),
  relief: P({ spine: [-0.12, 0, 0], head: [-0.28, 0, 0], lS: [-0.6, 0, 0.1], lE: -0.8, rS: [-0.6, 0, -0.1], rE: -0.8 }),
  dead: P({ head: [0.45, 0, 0.5], lS: [-0.1, 0, -0.2], lE: -0.2, rS: [-0.1, 0, 0.2], rE: -0.2 }),
  hat: P({ head: [0.0, 0, -0.08], rS: [-2.55, -0.25, -0.1], rE: -1.7 }),
  // hand at temple height, elbow out so the muzzle just touches the side of the head
  aim: P({ head: [0.05, 0.12, -0.22], lS: [-2.0, 0, -0.55], lE: -2.1 }),
};
const HOLD_L: Pose = P({ lS: [-1.15, 0.45, 0.05], lE: -1.0 });
const SUPPORT_R: [number, number, number, number] = [-1.15, -0.62, 0, -1.15];

interface Face {
  brow: number; // −1 angry … +1 worried
  mouth: "flat" | "smile" | "grin" | "frown" | "o";
  eye: number; // eye-opening scale
  sweat: number; // 0..1
}
const FACES: Record<Mood, Face> = {
  rest: { brow: 0, mouth: "flat", eye: 1, sweat: 0 },
  think: { brow: -0.35, mouth: "flat", eye: 0.8, sweat: 0 },
  nervous: { brow: 0.85, mouth: "frown", eye: 1.15, sweat: 1 },
  smug: { brow: -0.25, mouth: "smile", eye: 0.7, sweat: 0 },
  angry: { brow: -1, mouth: "frown", eye: 0.9, sweat: 0 },
  pray: { brow: 0.6, mouth: "flat", eye: 0.12, sweat: 0.5 },
  clap: { brow: 0.25, mouth: "grin", eye: 1, sweat: 0 },
  point: { brow: -0.6, mouth: "o", eye: 1.05, sweat: 0 },
  laugh: { brow: 0.35, mouth: "grin", eye: 0.22, sweat: 0 },
  cheer: { brow: 0.45, mouth: "grin", eye: 1.1, sweat: 0 },
  scared: { brow: 1, mouth: "o", eye: 1.35, sweat: 1 },
  shock: { brow: 1, mouth: "o", eye: 1.45, sweat: 0.4 },
  relief: { brow: 0.55, mouth: "smile", eye: 0.35, sweat: 0.6 },
  dead: { brow: 0, mouth: "o", eye: 0.08, sweat: 0 },
  hat: { brow: -0.1, mouth: "smile", eye: 0.85, sweat: 0 },
  aim: { brow: 0.9, mouth: "flat", eye: 0.5, sweat: 1 },
};

const EMOTE_MOOD: Record<EmoteKind, Mood> = { smug: "smug", think: "think", nervous: "nervous", angry: "angry", pray: "pray", clap: "clap", point: "point", laugh: "laugh" };

const GREY = new THREE.Color("#57534e");
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
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

const HAIR = ["#3b2416", "#1c1917", "#20140e", "#7a3b1d", "#0f0a08", "#5c4033"];
const VEST = ["#c08a2e", "#9aa7c7", "#d9c7a0", "#e7c6f0", "#e8d9b8", "#cfa86a"];

function Hat({ kind, band, seg }: { kind: HatKind; band: string; seg: number }) {
  const felt = <meshStandardMaterial color={kind === "beret" ? "#7f1d1d" : "#1d1a18"} roughness={0.85} />;
  if (kind === "beret") {
    return (
      <group position={[0.02, 0.15, -0.02]} rotation={[0.15, 0, -0.25]}>
        <mesh castShadow scale={[1, 0.38, 1]}>
          <sphereGeometry args={[0.215, seg, 10]} />
          {felt}
        </mesh>
        <mesh position={[0, 0.085, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 0.04, 6]} />
          {felt}
        </mesh>
      </group>
    );
  }
  const brimR = kind === "fedora" ? 0.33 : kind === "top" ? 0.29 : 0.27;
  return (
    <group position={[0, 0.13, -0.01]} rotation={[-0.08, 0, 0]}>
      <mesh castShadow scale={[1, 1, kind === "fedora" ? 0.92 : 1]}>
        <cylinderGeometry args={[brimR, brimR, 0.022, seg]} />
        {felt}
      </mesh>
      {kind === "bowler" ? (
        <mesh position={[0, 0.01, 0]} castShadow>
          <sphereGeometry args={[0.185, seg, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
          {felt}
        </mesh>
      ) : (
        <mesh position={[0, kind === "top" ? 0.17 : 0.1, 0]} castShadow>
          <cylinderGeometry args={kind === "top" ? [0.17, 0.18, 0.34, seg] : [0.15, 0.19, 0.19, seg]} />
          {felt}
        </mesh>
      )}
      <mesh position={[0, kind === "bowler" ? 0.035 : 0.04, 0]}>
        <cylinderGeometry args={kind === "top" ? [0.181, 0.181, 0.05, seg] : kind === "bowler" ? [0.188, 0.188, 0.04, seg] : [0.172, 0.181, 0.045, seg]} />
        <meshStandardMaterial color={band} roughness={0.5} />
      </mesh>
    </group>
  );
}

export interface CharacterProps {
  seat: SeatIndex;
  /** Seat colour (tie, hat band). */
  color: string;
  avatar: Avatar;
  /** World angle of this seat around the table and its world position. */
  angle: number;
  seatPos: THREE.Vector3;
  /** World angles of every seat, to look at whoever is acting. */
  seatAngles: Record<SeatIndex, number>;
  seatR: number;
  activeSeat: SeatIndex | null;
  alive: boolean;
  /** Proven-empty chambers so far (public), for the open cylinder. */
  shots: number;
  showdown: { res: Resolution; tl: ShowdownTimeline; startedAt: number } | null;
  /** Latest emote from this seat: `at` = performance.now() when received. */
  emote: { kind: EmoteKind; at: number } | null;
  lowDetail: boolean;
}

export default function Character(props: CharacterProps) {
  const { seat, color, avatar, angle, seatPos, seatAngles, seatR, lowDetail } = props;
  const seg = lowDetail ? 10 : 22;
  const root = useRef<THREE.Group>(null);
  const spine = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const lS = useRef<THREE.Group>(null);
  const lE = useRef<THREE.Group>(null);
  const rS = useRef<THREE.Group>(null);
  const rE = useRef<THREE.Group>(null);
  const gun = useRef<THREE.Group>(null);
  const eyes = useRef<THREE.Group>(null);
  const browL = useRef<THREE.Mesh>(null);
  const browR = useRef<THREE.Mesh>(null);
  const mouth = useRef<THREE.Group>(null);
  const sweat = useRef<THREE.Mesh>(null);
  const flash = useRef<THREE.PointLight>(null);
  const flashSprite = useRef<THREE.Mesh>(null);
  const smoke = useRef<THREE.Group>(null);
  const coatMat = useRef<THREE.MeshStandardMaterial>(null);
  const coatGeo = useMemo(() => new THREE.LatheGeometry(COAT_PROFILE, lowDetail ? 12 : 24), [lowDetail]);
  const coatColor = useMemo(() => new THREE.Color(avatar.coat), [avatar.coat]);
  // Current (smoothed) joint values + face, mutated only inside useFrame.
  const cur = useRef<{ pose: Pose; brow: number; eye: number; sweat: number; look: [number, number] } | null>(null);

  useFrame(({ clock }, dt) => {
    const now = clock.elapsedTime;
    const { showdown, alive, activeSeat, emote } = props;
    if (!cur.current) cur.current = { pose: [...POSES.rest], brow: 0, eye: 1, sweat: 0, look: [0, 0] };
    const c = cur.current;
    const t = showdown ? (performance.now() - showdown.startedAt) / 1000 : 0;

    // --- my own pull (if any) and whether a fatal pull has visually happened ---
    let myPull: ShowdownTimeline["pulls"][number] | null = null;
    let myHit = false;
    let pendingHit = false;
    let fellAt: number | null = null;
    let otherPull: { seat: SeatIndex; fireAt: number; hit: boolean } | null = null;
    if (showdown) {
      showdown.res.pulls.forEach((pl, j) => {
        const p = showdown.tl.pulls[j];
        if (pl.seat === seat) {
          if (t < p.fireAt) pendingHit ||= pl.hit;
          else if (pl.hit) fellAt = p.fireAt;
          if (t >= p.liftAt && t < p.endAt + 0.6) {
            myPull = p;
            myHit = pl.hit;
          }
        } else if (t >= p.liftAt && t < p.endAt + 1.4) otherPull = { seat: pl.seat, fireAt: p.fireAt, hit: pl.hit };
      });
    }
    const visuallyAlive = alive || pendingHit;
    const fall = fellAt !== null ? clamp01((t - fellAt) / 0.55) : visuallyAlive ? 0 : 1;

    // --- choose a mood ---
    let mood: Mood = "rest";
    let lookSeat: SeatIndex | null = activeSeat;
    const emoteOn = emote && (performance.now() - emote.at) / 1000 < EMOTE_DURATION_S ? emote : null;
    if (showdown) {
      const res = showdown.res;
      const firstLift = showdown.tl.pulls[0]?.liftAt ?? showdown.tl.total;
      if (t < showdown.tl.verdictAt) {
        lookSeat = res.accusedSeat;
        mood = seat === res.challengerSeat ? "point" : seat === res.accusedSeat ? "nervous" : "think";
        if (seat === res.accusedSeat) lookSeat = res.challengerSeat;
      } else if (t < firstLift) {
        const shooters = res.pulls.map((p) => p.seat);
        lookSeat = shooters[0];
        mood = shooters.includes(seat) ? "scared" : seat === res.challengerSeat || seat === res.accusedSeat ? "smug" : "nervous";
      } else if (otherPull) {
        const op = otherPull as { seat: SeatIndex; fireAt: number; hit: boolean };
        lookSeat = op.seat;
        mood = t < op.fireAt ? "nervous" : op.hit ? "shock" : "relief";
      }
    } else if (activeSeat === seat) mood = "think";
    if (emoteOn) mood = EMOTE_MOOD[emoteOn.kind];
    if (!emoteOn && !showdown && activeSeat !== seat) {
      // idle fidgets, staggered per seat
      const slot = Math.floor((now + seat * 2.3) / 7);
      const inSlot = (now + seat * 2.3) % 7;
      if (inSlot < 2.4) {
        const r = hash(seat, slot);
        mood = r < 0.3 ? "think" : r < 0.5 ? "hat" : "rest";
        if (r >= 0.5 && r < 0.8) lookSeat = (Object.keys(seatAngles).map(Number)[Math.floor(hash(slot, seat) * Object.keys(seatAngles).length)] ?? null) as SeatIndex | null;
      }
    }
    if (fall > 0) mood = "dead";

    // --- target pose (+ the step-by-step gun choreography on my own pull) ---
    let target = [...POSES[mood]];
    let face = { ...FACES[mood] };
    let rate = 1 - Math.exp(-dt * 7);
    let gunVisible = false;
    let gunRotZ = -Math.PI / 2;
    let tremble = 0;
    if (myPull && fall === 0) {
      const p = myPull as ShowdownTimeline["pulls"][number];
      rate = 1 - Math.exp(-dt * 14);
      const grab = easeInOut(span(t, p.liftAt, p.openAt - 0.08 * p.k));
      const raise = easeInOut(span(t, p.raiseAt, p.cockAt - 0.05 * p.k));
      const lower = myHit ? 0 : easeInOut(span(t, p.lowerAt, p.endAt - 0.1 * p.k));
      const support = span(t, p.openAt - 0.1 * p.k, p.openAt + 0.2 * p.k) * (1 - span(t, p.closeAt, p.raiseAt));
      target = [...POSES.rest];
      for (let i = 0; i < target.length; i++) {
        let v = POSES.rest[i] + (HOLD_L[i] - POSES.rest[i]) * grab;
        v = v + (POSES.aim[i] - v) * raise;
        v = v + (POSES.rest[i] - v) * lower;
        target[i] = v;
      }
      // right hand comes over to work the cylinder, flicks it a notch
      const flick = t >= p.spinAt && t < p.spinAt + 0.18 * p.k ? Math.sin(span(t, p.spinAt, p.spinAt + 0.18 * p.k) * Math.PI) * 0.35 : 0;
      target[10] += (SUPPORT_R[0] - target[10]) * support;
      target[11] += (SUPPORT_R[1] - target[11]) * support + flick;
      target[12] += (SUPPORT_R[2] - target[12]) * support;
      target[13] += (SUPPORT_R[3] - target[13]) * support;
      gunVisible = t >= p.liftAt + 0.12 * p.k;
      gunRotZ = -Math.PI / 2 + (Math.PI / 2 + 0.55) * raise * (1 - lower); // +0.55 levels the barrel against the elbow-out tilt
      tremble = span(t, p.holdAt, p.fireAt) * (t < p.fireAt ? 1 : 0);
      lookSeat = null;
      const steps = t < p.raiseAt ? { brow: 0.5, mouth: "flat" as const, eye: 0.95, sweat: 0.4 } : t < p.fireAt ? FACES.aim : FACES.relief;
      face = { ...steps };
      if (t >= p.fireAt && t < p.fireAt + 0.35 * p.k) face = { brow: 1, mouth: "o", eye: 1.4, sweat: 1 };
    } else if (myPull && myHit) {
      gunVisible = true;
      gunRotZ = 0.55;
    }

    // smooth toward the target
    for (let i = 0; i < target.length; i++) c.pose[i] += (target[i] - c.pose[i]) * rate;
    c.brow += (face.brow - c.brow) * rate;
    c.eye += (face.eye - c.eye) * rate;
    c.sweat += (face.sweat - c.sweat) * (1 - Math.exp(-dt * 3));
    const q = c.pose;

    // procedural layers on top of the blended pose
    const osc = (f: number, a: number) => Math.sin(now * f + seat) * a;
    let lSx = q[6] + tremble * osc(38, 0.03);
    let lEx = q[9] + tremble * osc(41, 0.025);
    let rSy = q[11];
    let lSy = q[7];
    let rEx = q[13];
    let spineX = q[0];
    let headX = q[3];
    if (mood === "clap") {
      const s = Math.max(0, Math.sin(now * 14));
      rSy += s * 0.18;
      lSy -= s * 0.18;
    }
    if (mood === "angry") {
      const s = Math.abs(Math.sin(now * 9));
      lEx -= s * 0.35;
      rEx -= s * 0.35;
    }
    if (mood === "laugh") {
      spineX += osc(16, 0.05);
      headX += osc(16, 0.06);
    }
    if (mood === "nervous" || mood === "scared") {
      lSx += osc(29, 0.015);
      rEx += osc(31, 0.015);
    }
    if (mood === "rest" && hash(seat, Math.floor(now / 9)) > 0.6) rEx += Math.max(0, Math.sin(now * 11)) * 0.05; // drumming fingers

    // --- apply ---
    if (root.current) {
      const side = seat % 2 === 0 ? 1 : -1;
      root.current.rotation.x = -easeInOut(fall) * 0.95;
      root.current.rotation.z = easeInOut(fall) * 0.55 * side;
      root.current.position.y = Math.sin(now * 1.6 + seat) * 0.008 * (1 - fall);
    }
    if (spine.current) {
      spine.current.rotation.set(spineX, q[1], q[2]);
      spine.current.scale.y = 1 + Math.sin(now * 1.6 + seat) * 0.006 * (1 - fall); // breathing
    }
    // head: look at the acting seat, plus the pose's own tilt
    let yaw = 0;
    let pitch = 0;
    if (lookSeat !== null && lookSeat !== seat && seatAngles[lookSeat] !== undefined && fall === 0) {
      const a = seatAngles[lookSeat];
      const dx = Math.sin(a) * seatR - seatPos.x;
      const dz = Math.cos(a) * seatR - seatPos.z;
      const th = angle + Math.PI;
      const lx = dx * Math.cos(th) - dz * Math.sin(th);
      const lz = dx * Math.sin(th) + dz * Math.cos(th);
      yaw = Math.max(-0.95, Math.min(0.95, Math.atan2(lx, lz)));
      pitch = -0.1;
    }
    c.look[0] += (yaw - c.look[0]) * (1 - Math.exp(-dt * 5));
    c.look[1] += (pitch - c.look[1]) * (1 - Math.exp(-dt * 5));
    if (head.current) {
      head.current.rotation.set(headX + c.look[1], q[4] + c.look[0], q[5] + Math.sin(now * 0.7 + seat) * 0.025 * (1 - fall));
    }
    // pointing follows the gaze
    const pointYaw = mood === "point" ? c.look[0] : 0;
    lS.current?.rotation.set(lSx, lSy, q[8]);
    lE.current?.rotation.set(lEx, 0, 0);
    rS.current?.rotation.set(q[10], rSy + pointYaw * 0.9, q[12]);
    rE.current?.rotation.set(rEx, 0, 0);

    // face
    if (eyes.current) {
      const b = (now + seat * 1.37) % 4.2;
      eyes.current.scale.y = Math.max(0.06, c.eye * (b < 0.12 && c.eye > 0.3 ? 0.12 : 1));
    }
    browL.current?.rotation.set(0, 0, 0.12 + c.brow * 0.38);
    browR.current?.rotation.set(0, 0, -0.12 - c.brow * 0.38);
    browL.current?.position.setY(0.075 + Math.abs(c.brow) * 0.012 * (c.brow > 0 ? 1 : -0.6));
    browR.current?.position.setY(0.075 + Math.abs(c.brow) * 0.012 * (c.brow > 0 ? 1 : -0.6));
    if (mouth.current) for (const m of mouth.current.children) m.visible = m.name === face.mouth;
    if (sweat.current) {
      sweat.current.visible = c.sweat > 0.15;
      const drip = (now * 0.35 + seat * 0.2) % 1;
      sweat.current.position.set(-0.17, 0.08 - drip * 0.12, 0.08);
      (sweat.current.material as THREE.MeshStandardMaterial).opacity = c.sweat * 0.8 * (1 - drip * 0.6);
    }
    if (coatMat.current) coatMat.current.color.copy(coatColor).lerp(GREY, fall * 0.75);

    // --- the revolver in my hand ---
    const g = gun.current;
    if (g) {
      g.visible = gunVisible;
      g.rotation.set(0, 0, gunRotZ);
      const p = myPull as ShowdownTimeline["pulls"][number] | null;
      if (p) {
        const f = animateRevolver(g, p, t, props.shots, myHit);
        if (flash.current) flash.current.intensity = f * 45;
        if (flashSprite.current) {
          flashSprite.current.visible = f > 0;
          flashSprite.current.scale.setScalar(0.5 + (1 - f) * 0.8);
        }
        if (smoke.current) {
          const s = myHit ? span(t, p.fireAt, p.fireAt + 1.6) : 0;
          smoke.current.visible = s > 0 && s < 1;
          smoke.current.children.forEach((puff, i) => {
            puff.position.set(0.36 + s * (0.08 + i * 0.05), 0.02 + s * (0.15 + i * 0.06), (i - 1.5) * 0.03 * s);
            puff.scale.setScalar(0.03 + s * (0.1 + i * 0.03));
            ((puff as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = (1 - s) * 0.45;
          });
        }
      }
    }
  });

  const skin = <meshStandardMaterial color={avatar.skin} roughness={0.62} />;
  const sleeve = <meshStandardMaterial color={avatar.coat} roughness={0.75} />;
  const arm = (side: 1 | -1, sRef: React.RefObject<THREE.Group | null>, eRef: React.RefObject<THREE.Group | null>, withGun: boolean) => (
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
        <mesh position={[0, -0.28, 0]}>
          <cylinderGeometry args={[0.07, 0.07, 0.03, 12]} />
          <meshStandardMaterial color="#f5f0e6" roughness={0.6} />
        </mesh>
        <group position={[0, -0.34, 0.01]}>
          <mesh scale={[1, 0.8, 1.15]} castShadow>
            <sphereGeometry args={[0.062, 12, 10]} />
            {skin}
          </mesh>
          {withGun && (
            <group ref={gun} visible={false} position={[0.0, -0.02, 0.04]}>
              <Revolver spent={props.shots} lowDetail={lowDetail} />
              <group name="fx" position={[0.36, 0.012, 0]}>
                <pointLight ref={flash} color="#ffb347" intensity={0} distance={4} />
                <mesh ref={flashSprite} visible={false}>
                  <sphereGeometry args={[0.12, 10, 8]} />
                  <meshBasicMaterial color="#ffd27a" transparent opacity={0.9} />
                </mesh>
              </group>
              <group ref={smoke} visible={false}>
                {[0, 1, 2, 3].map((i) => (
                  <mesh key={i}>
                    <sphereGeometry args={[1, 8, 6]} />
                    <meshStandardMaterial color="#d6d3d1" transparent opacity={0} depthWrite={false} />
                  </mesh>
                ))}
              </group>
            </group>
          )}
        </group>
      </group>
    </group>
  );

  return (
    <group ref={root}>
      <group ref={spine} position={[0, 0.55, -0.06]}>
        {/* coat */}
        <mesh geometry={coatGeo} scale={[1, 1, 0.78]} castShadow>
          <meshStandardMaterial ref={coatMat} color={avatar.coat} roughness={0.78} />
        </mesh>
        {/* shirt front, vest, bow tie and tie */}
        <mesh position={[0, 0.5, 0.26]} rotation={[-0.12, 0, 0]}>
          <planeGeometry args={[0.2, 0.36]} />
          <meshStandardMaterial color={VEST[seat % VEST.length]} roughness={0.6} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0.58, 0.275]} rotation={[-0.12, 0, Math.PI]}>
          <circleGeometry args={[0.085, 3]} />
          <meshStandardMaterial color="#f8f5ee" roughness={0.5} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0.53, 0.282]} rotation={[-0.12, 0, Math.PI / 4]}>
          <planeGeometry args={[0.045, 0.045]} />
          <meshStandardMaterial color={color} roughness={0.4} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0.44, 0.285]} rotation={[-0.12, 0, 0]}>
          <planeGeometry args={[0.04, 0.14]} />
          <meshStandardMaterial color={color} roughness={0.4} side={THREE.DoubleSide} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[0.085 * s, 0.51, 0.265]} rotation={[-0.12, 0, 0.32 * s]}>
            <planeGeometry args={[0.06, 0.34]} />
            <meshStandardMaterial color={avatar.coat} roughness={0.7} side={THREE.DoubleSide} />
          </mesh>
        ))}
        {arm(-1, lS, lE, true)}
        {arm(1, rS, rE, false)}
        {/* neck + head */}
        <mesh position={[0, 0.77, 0.04]}>
          <cylinderGeometry args={[0.075, 0.085, 0.12, 12]} />
          {skin}
        </mesh>
        {avatar.accessory === "scarf" && (
          <mesh position={[0, 0.75, 0.04]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.1, 0.045, 8, 18]} />
            <meshStandardMaterial color="#b91c1c" roughness={0.9} />
          </mesh>
        )}
        <group ref={head} position={[0, 0.97, 0.06]}>
          <mesh castShadow scale={[0.92, 1.06, 0.95]}>
            <sphereGeometry args={[0.2, seg + 6, seg]} />
            {skin}
          </mesh>
          <mesh position={[0, 0.03, -0.03]} scale={[0.96, 0.9, 0.95]}>
            <sphereGeometry args={[0.2, seg, 12, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
            <meshStandardMaterial color={HAIR[seat % HAIR.length]} roughness={0.9} />
          </mesh>
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
          <mesh ref={browL} position={[-0.066, 0.075, 0.172]}>
            <boxGeometry args={[0.062, 0.013, 0.012]} />
            <meshStandardMaterial color={HAIR[seat % HAIR.length]} roughness={0.9} />
          </mesh>
          <mesh ref={browR} position={[0.066, 0.075, 0.172]}>
            <boxGeometry args={[0.062, 0.013, 0.012]} />
            <meshStandardMaterial color={HAIR[seat % HAIR.length]} roughness={0.9} />
          </mesh>
          <mesh position={[0, -0.025, 0.19]} scale={[0.8, 1.1, 1]}>
            <sphereGeometry args={[0.026, 10, 8]} />
            {skin}
          </mesh>
          {/* five mouth shapes, one visible at a time */}
          <group ref={mouth} position={[0, -0.088, 0.172]}>
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
          {avatar.accessory === "mustache" &&
            [-1, 1].map((s) => (
              <mesh key={s} position={[0.032 * s, -0.058, 0.185]} rotation={[0, 0, (Math.PI / 2 - 0.35) * s]}>
                <capsuleGeometry args={[0.011, 0.045, 3, 6]} />
                <meshStandardMaterial color={HAIR[seat % HAIR.length]} roughness={0.9} />
              </mesh>
            ))}
          {avatar.accessory === "monocle" && (
            <mesh position={[0.066, 0.02, 0.19]}>
              <torusGeometry args={[0.04, 0.005, 6, 20]} />
              <meshStandardMaterial color="#d4a64a" metalness={0.9} roughness={0.25} />
            </mesh>
          )}
          {avatar.accessory === "earring" && (
            <mesh position={[0.19, -0.07, 0.01]}>
              <sphereGeometry args={[0.014, 8, 6]} />
              <meshStandardMaterial color="#facc15" metalness={0.9} roughness={0.2} />
            </mesh>
          )}
          <Hat kind={avatar.hat} band={color} seg={seg} />
        </group>
      </group>
    </group>
  );
}
