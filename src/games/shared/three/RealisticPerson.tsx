"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { blinking, FACES, Hat, POSES, type PersonMood, type Pose, type SeatedPersonProps } from "./SeatedPerson";
import { createMotion, HANDS, stepMotion, type MotionState } from "./motion";
import { eyeBandTexture, mouthTexture, type EyeState, type FaceSpec, type Gender, type MouthShape } from "./glamFace";

/**
 * A more lifelike seated player — the same props, moods, gaze and idle
 * behaviour as `SeatedPerson` (it reuses that rig's pose/face tables), but
 * with adult proportions (≈1/7 head), a modelled face (nose, ears, lidded
 * eyes with irises, lips, jaw), volumetric hair, fabric-shaded clothes with a
 * collar and cuffs, hands with fingers, and seated legs with trousers and
 * shoes. Skin uses a soft sheen so faces don't read as plastic.
 *
 * Local frame: +z faces the table, origin = the chair's floor point.
 */

const hash = (a: number, b: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const GREY = new THREE.Color("#6b6560");
/** Poses whose hands should rest on the table (they get the adult-arm correction). */
/** Head profiles [y, radius] bottom → top; the feminine chin tapers more, the masculine jaw stays squarer. */
const HEAD_PROFILE: Record<Gender, [number, number][]> = {
  f: [[-0.13, 0], [-0.127, 0.012], [-0.12, 0.026], [-0.108, 0.042], [-0.092, 0.056], [-0.072, 0.07], [-0.05, 0.082], [-0.025, 0.092], [0, 0.098], [0.025, 0.1], [0.05, 0.098], [0.075, 0.09], [0.095, 0.076], [0.11, 0.056], [0.12, 0.032], [0.125, 0]],
  m: [[-0.13, 0], [-0.128, 0.018], [-0.122, 0.034], [-0.11, 0.05], [-0.094, 0.064], [-0.074, 0.076], [-0.05, 0.087], [-0.025, 0.096], [0, 0.101], [0.025, 0.103], [0.05, 0.1], [0.075, 0.092], [0.095, 0.078], [0.11, 0.058], [0.12, 0.034], [0.126, 0]],
};
/** Front-to-back depth relative to width (applied as a z scale). */
const HEAD_DEPTH = 1.08;
/** The painted slices: phi span across the front, and the y range each covers (matches glamFace's layouts). */
export const FACE_PHI = 1.1;
export const EYE_Y: [number, number] = [-0.005, 0.045];
export const LOWER_Y: [number, number] = [-0.095, -0.005];

function radiusAt(profile: [number, number][], y: number) {
  for (let i = 1; i < profile.length; i++) {
    const [y0, r0] = profile[i - 1];
    const [y1, r1] = profile[i];
    if (y <= y1) return r0 + ((y - y0) / (y1 - y0)) * (r1 - r0);
  }
  return 0;
}

const headCache = new Map<string, { head: THREE.LatheGeometry; eyes: THREE.LatheGeometry; lower: THREE.LatheGeometry }>();
/** The head + its two painted slices, sharing one surface so decals sit flush (slices pushed out 0.6 mm). */
function headGeometry(gender: Gender, seg: number) {
  const key = `${gender}:${seg}`;
  let g = headCache.get(key);
  if (g) return g;
  const prof = HEAD_PROFILE[gender];
  const band = (y0: number, y1: number) => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 14; i++) {
      const y = y0 + ((y1 - y0) * i) / 14;
      pts.push(new THREE.Vector2(radiusAt(prof, y) + 0.0006, y));
    }
    return new THREE.LatheGeometry(pts, 36, -FACE_PHI / 2, FACE_PHI);
  };
  g = {
    head: new THREE.LatheGeometry(prof.map(([y, r]) => new THREE.Vector2(r, y)), seg + 8),
    eyes: band(EYE_Y[0], EYE_Y[1]),
    lower: band(LOWER_Y[0], LOWER_Y[1]),
  };
  headCache.set(key, g);
  return g;
}

/** Brows: a fine arch (feminine) or a fuller, straighter stroke (masculine); horizontal by construction. */
const browArch = new THREE.TorusGeometry(0.019, 0.0028, 6, 16, Math.PI * 0.62).rotateZ(Math.PI * 0.19).translate(-0.002, -0.014, 0);
const browBold = new THREE.CapsuleGeometry(0.0042, 0.027, 2, 8).rotateZ(Math.PI / 2 - 0.08).scale(1, 0.8, 0.6);

/** Poses re-authored for adult proportions (the cartoon versions put the hands on the face). */
const OVERRIDES: Partial<Record<PersonMood, Pose>> = {
  // arms folded across the chest
  smug: [-0.12, 0, 0, -0.1, 0, 0.1, -0.45, 0.6, 0.2, -2.0, -0.4, -0.6, -0.2, -2.05],
  // hands together in front of the chest
  clap: [0.04, 0, 0, 0, 0, 0, -0.75, 0.5, 0, -1.3, -0.75, -0.5, 0, -1.3],
};

const RESTING = new Set<PersonMood>(["rest", "think", "talk", "write", "nervous", "sad"]);

// skin, hair, lip and top come from the shared PersonLook (@/lib/character/avatar); these stay per-seat
const IRIS = ["#3a2416", "#4a2e1a", "#2e1d12", "#553620", "#3f2a1c"];
const PANTS = ["#1f2430", "#2b2b2b", "#d8d2c4", "#3a4a66", "#1c1c22"];

function shade(hex: string, k: number) {
  return "#" + new THREE.Color(hex).multiplyScalar(k).getHexString();
}

const TORSO = [
  [0.0, 0.0],
  [0.15, 0.0],
  [0.165, 0.05],
  [0.155, 0.16],
  [0.148, 0.25],
  [0.168, 0.36],
  [0.183, 0.45],
  [0.175, 0.51],
  [0.12, 0.555],
  [0.055, 0.575],
  [0.0, 0.578],
].map(([x, y]) => new THREE.Vector2(x, y));

export default function RealisticPerson(props: SeatedPersonProps) {
  const { look, position, facing, lowDetail, seed } = props;
  const seg = lowDetail ? 14 : 28;
  const root = useRef<THREE.Group>(null);
  const spine = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const lS = useRef<THREE.Group>(null);
  const lE = useRef<THREE.Group>(null);
  const rS = useRef<THREE.Group>(null);
  const rE = useRef<THREE.Group>(null);
  const eyeMat = useRef<THREE.MeshStandardMaterial>(null);
  const mouthMat = useRef<THREE.MeshStandardMaterial>(null);
  const browL = useRef<THREE.Mesh>(null);
  const browR = useRef<THREE.Mesh>(null);
  const sweat = useRef<THREE.Mesh>(null);
  const topMat = useRef<THREE.MeshPhysicalMaterial>(null);
  const cur = useRef<{ m: MotionState; brow: number; eye: number; sweat: number; look: [number, number]; out: number; rest: number } | null>(null);
  const lW = useRef<THREE.Group>(null);
  const rW = useRef<THREE.Group>(null);
  /** Finger knuckle hinges: [left little … index, right little … index]. */
  const fingers = useRef<(THREE.Group | null)[]>([]);

  // a stable personal look per seat: the shared look's K-pop woman / man, rendered life-size
  const p = useMemo(() => {
    const h = (k: number) => hash(seed, k);
    const gender: Gender = look.gender;
    const skin = look.skin;
    const hair = look.hair;
    const lip = gender === "f" ? look.lip : shade(skin, 0.72);
    const face: FaceSpec = {
      id: `${seed}`,
      gender,
      skin,
      iris: IRIS[Math.floor(h(3) * IRIS.length)],
      lip,
      liner: gender === "f" ? "#120a08" : shade(hair, 0.8),
      // soft K-beauty tones: peach / coral / rose-brown shadow, pink blush
      shadow: ["#d8907a", "#c98a7a", "#b9808a", "#d0a080"][Math.floor(h(8) * 4)],
      blush: ["#f49aa6", "#f6a08a", "#ee8ea0"][Math.floor(h(10) * 3)],
    };
    // long sleek / layered hush / ponytail (women); comma / curtain / dandy fringe (men)
    const STYLE: Partial<Record<string, string>> = { straight: "long", hush: "bob", pony: "pony", comma: "part", curtain: "curtain", dandy: "dandy" };
    return {
      gender,
      face,
      skin,
      hair,
      top: look.coat,
      shirt: look.shirt,
      pants: PANTS[Math.floor(h(5) * PANTS.length)],
      shoes: h(6) < 0.5 ? "#1c1917" : "#5a3a22",
      style: STYLE[look.hairStyle] ?? (gender === "f" ? "long" : "part"),
    };
  }, [seed, look.coat, look.shirt, look.gender, look.skin, look.hair, look.hairStyle, look.lip]);
  const topColor = useMemo(() => new THREE.Color(p.top), [p.top]);
  const headGeo = headGeometry(p.gender, lowDetail ? 14 : 28);
  const torsoGeo = useMemo(() => new THREE.LatheGeometry(TORSO, lowDetail ? 14 : 28), [lowDetail]);

  useFrame(({ clock }, dt) => {
    const now = clock.elapsedTime;
    if (!cur.current) cur.current = { m: createMotion(OVERRIDES.rest ?? POSES.rest, HANDS.rest), brow: 0, eye: 1, sweat: 0, look: [0, 0], out: 0, rest: 1 };
    const c = cur.current;
    let mood: PersonMood = props.out ? "slump" : props.mood;
    if (mood === "rest") {
      const slot = Math.floor((now + seed * 2.3) / 7);
      if ((now + seed * 2.3) % 7 < 2.2) {
        const r = hash(seed, slot);
        if (r < 0.25) mood = "think";
        else if (r < 0.35) mood = "shrug";
      }
    }
    const face = FACES[mood];
    const rate = 1 - Math.exp(-dt * 6);
    // body + hands: key pose, gestures and idle life, chased by springs (motion.ts)
    const q = stepMotion(c.m, mood, OVERRIDES[mood] ?? POSES[mood], now, dt, seed);
    c.brow += (face.brow - c.brow) * rate;
    c.eye += (face.eye - c.eye) * rate;
    c.sweat += (face.sweat - c.sweat) * (1 - Math.exp(-dt * 3));
    c.out += ((props.out ? 1 : 0) - c.out) * (1 - Math.exp(-dt * 3));
    const spineX = q[0] * 0.8;
    // breathing: chest rises a touch, shoulders follow
    const breath = Math.sin(now * 1.35 + seed) * (1 - c.out);
    if (root.current) root.current.position.y = breath * 0.003;
    if (spine.current) {
      spine.current.rotation.set(spineX, q[1], q[2]);
      spine.current.scale.set(1 + breath * 0.008, 1 + breath * 0.004, 1 + breath * 0.012);
    }
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
      pitch = Math.max(-0.4, Math.min(0.5, Math.atan2(1.4 - la.y, Math.max(0.3, Math.hypot(dx, dz))) * 0.7));
    }
    c.look[0] += (yaw - c.look[0]) * (1 - Math.exp(-dt * 4));
    c.look[1] += (pitch - c.look[1]) * (1 - Math.exp(-dt * 4));
    const drift = la ? 0.35 : 1;
    head.current?.rotation.set(q[3] * 0.8 + c.look[1], q[4] * drift + c.look[0], q[5] * 0.8);
    const pointYaw = mood === "point" ? c.look[0] : 0;
    // adult arms are shorter than the cartoon rig's: in the resting-type poses, lift the upper arm a
    // touch and bend the elbow more so the forearms lie on the table edge (other poses stay as authored)
    const resting = RESTING.has(mood) ? 1 : 0;
    c.rest += (resting * (1 - c.out) - c.rest) * rate;
    const lift = -0.08 * c.rest;
    const bend = -0.42 * c.rest;
    const leftOnly = mood === "think" || mood === "talk" || mood === "write";
    lS.current?.rotation.set(q[6] + lift, q[7], q[8]);
    lE.current?.rotation.set(q[9] + bend, 0, 0);
    rS.current?.rotation.set(q[10] + (leftOnly ? 0 : lift) + (mood === "point" ? c.look[1] * 0.6 : 0), q[11] + pointYaw * 0.9, q[12]);
    rE.current?.rotation.set(q[13] + (leftOnly ? 0 : bend), 0, 0);
    lW.current?.rotation.set(0.15 + q[14], 0, q[15]);
    rW.current?.rotation.set(0.15 + q[16], 0, q[17]);
    // fingers curl at the knuckle; pointing keeps the index straight
    for (let i = 0; i < 8; i++) {
      const g = fingers.current[i];
      if (!g) continue;
      const right = i >= 4;
      const index = i % 4 === 3;
      const curl = right && index && mood === "point" ? 0 : q[right ? 19 : 18];
      g.rotation.x = 0.35 + curl * 1.45;
    }

    // blink every few seconds; eyes close when laughing/asleep, widen in shock — the painted eye band swaps state
    const eyeState: EyeState = c.eye < 0.3 || (blinking(now, seed) && c.eye > 0.3) ? "closed" : c.eye > 1.25 ? "wide" : "open";
    const eyeTex = eyeBandTexture(p.face, eyeState);
    if (eyeMat.current && eyeMat.current.map !== eyeTex) eyeMat.current.map = eyeTex;
    const browK = p.gender === "f" ? 0.25 : 0.3;
    const browBase = p.gender === "f" ? 0.05 : 0.06;
    browL.current?.rotation.set(0, 0, browBase + c.brow * browK);
    browR.current?.rotation.set(0, 0, -browBase - c.brow * browK);
    if (browL.current) browL.current.position.y = 0.05 + Math.max(0, c.brow) * 0.005;
    if (browR.current) browR.current.position.y = 0.05 + Math.max(0, c.brow) * 0.005;
    const shape: MouthShape = mood === "talk" ? (Math.sin(now * 12 + seed) > 0 ? "o" : "flat") : face.mouth;
    const mTex = mouthTexture(p.face, shape);
    if (mouthMat.current && mouthMat.current.map !== mTex) mouthMat.current.map = mTex;
    if (sweat.current) {
      sweat.current.visible = c.sweat > 0.15;
      const drip = (now * 0.3 + seed * 0.2) % 1;
      sweat.current.position.set(-0.09, 0.055 - drip * 0.08, 0.06);
      (sweat.current.material as THREE.MeshStandardMaterial).opacity = c.sweat * 0.75 * (1 - drip * 0.6);
    }
    if (topMat.current) topMat.current.color.copy(topColor).lerp(GREY, c.out * 0.6);
  });

  const skin = <meshPhysicalMaterial color={p.skin} roughness={0.52} sheen={0.35} sheenColor="#ff9a7a" sheenRoughness={0.6} clearcoat={0.06} clearcoatRoughness={0.6} />;
  const fabric = (color: string) => <meshPhysicalMaterial color={color} roughness={0.92} sheen={0.6} sheenColor={shade(color, 1.4)} sheenRoughness={0.8} />;
  const hairMat = <meshPhysicalMaterial color={p.hair} roughness={0.55} sheen={0.8} sheenColor={shade(p.hair, 2.2)} sheenRoughness={0.35} />;

  const hand = (side: 1 | -1) => (
    <group ref={side === 1 ? rW : lW} position={[0, -0.27, 0.005]} rotation={[0.15, 0, 0]}>
      <mesh position={[0, -0.04, 0]} castShadow>
        <boxGeometry args={[0.062, 0.078, 0.026]} />
        {skin}
      </mesh>
      {/* little → index (the index sits next to the thumb) */}
      {[0.021, 0.007, -0.007, -0.021].map((dx, i) => {
        const x = dx * side;
        const len = 0.04 - Math.abs(dx) * 0.3;
        return (
          <group
            key={i}
            ref={(g) => {
              fingers.current[(side === 1 ? 4 : 0) + i] = g;
            }}
            position={[x, -0.078 + Math.abs(dx) * 0.4, 0.004]}
            rotation={[0.35, 0, 0]}
          >
            <mesh position={[0, -len / 2 - 0.006, 0]}>
              <capsuleGeometry args={[0.0075, len, 2, 6]} />
              {skin}
            </mesh>
          </group>
        );
      })}
      <mesh position={[0.036 * side * -1, -0.035, 0.014]} rotation={[0.5, 0, 0.7 * side]}>
        <capsuleGeometry args={[0.009, 0.032, 2, 6]} />
        {skin}
      </mesh>
    </group>
  );

  const arm = (side: 1 | -1, sRef: React.RefObject<THREE.Group | null>, eRef: React.RefObject<THREE.Group | null>) => (
    <group ref={sRef} position={[0.2 * side, 0.485, 0.0]}>
      <mesh position={[0, -0.12, 0]} castShadow>
        <capsuleGeometry args={[0.048, 0.19, 4, seg]} />
        {fabric(p.top)}
      </mesh>
      <group ref={eRef} position={[0, -0.27, 0]}>
        <mesh position={[0, -0.11, 0]} castShadow>
          <capsuleGeometry args={[0.041, 0.17, 4, seg]} />
          {fabric(p.top)}
        </mesh>
        {/* shirt cuff peeking out */}
        <mesh position={[0, -0.225, 0]}>
          <cylinderGeometry args={[0.036, 0.038, 0.025, seg]} />
          {fabric(p.shirt)}
        </mesh>
        <mesh position={[0, -0.245, 0]}>
          <cylinderGeometry args={[0.026, 0.03, 0.03, 12]} />
          {skin}
        </mesh>
        {hand(side)}
      </group>
    </group>
  );

  const chair = props.chair ?? "wood";
  const chairColor = props.chairColor ?? "#5a2e17";
  const wood = <meshStandardMaterial color={chairColor} roughness={0.55} />;

  return (
    <group position={position} rotation-y={facing}>
      {chair === "wood" && (
        <group>
          <mesh position={[0, 0.98, -0.34]} castShadow>
            <boxGeometry args={[0.5, 0.52, 0.045]} />
            {wood}
          </mesh>
          {[-1, 1].map((sx) => (
            <mesh key={sx} position={[0.23 * sx, 0.74, -0.34]} castShadow>
              <boxGeometry args={[0.045, 1.0, 0.045]} />
              {wood}
            </mesh>
          ))}
          <mesh position={[0, 0.47, -0.02]} castShadow receiveShadow>
            <boxGeometry args={[0.52, 0.05, 0.5]} />
            {wood}
          </mesh>
          {[-1, 1].flatMap((sx) =>
            [-1, 1].map((sz) => (
              <mesh key={`${sx}${sz}`} position={[0.22 * sx, 0.22, -0.02 + 0.21 * sz]}>
                <boxGeometry args={[0.04, 0.45, 0.04]} />
                {wood}
              </mesh>
            )),
          )}
        </group>
      )}
      {chair === "stool" && (
        <group>
          <mesh position={[0, 0.47, 0]} castShadow>
            <cylinderGeometry args={[0.24, 0.22, 0.06, 20]} />
            {wood}
          </mesh>
          {[0, 1, 2].map((i) => (
            <mesh key={i} position={[Math.sin(i * 2.1) * 0.15, 0.22, Math.cos(i * 2.1) * 0.15]} rotation={[Math.cos(i * 2.1) * 0.12, 0, -Math.sin(i * 2.1) * 0.12]}>
              <cylinderGeometry args={[0.018, 0.022, 0.45, 8]} />
              {wood}
            </mesh>
          ))}
        </group>
      )}

      <group ref={root} position={[0, 0, 0.12]}>
        {/* seated legs: thighs forward, shins down, shoes */}
        {[-1, 1].map((s) => (
          <group key={s} position={[0.09 * s, 0.53, 0]}>
            <mesh position={[0, 0, 0.19]} rotation-x={Math.PI / 2} castShadow>
              <capsuleGeometry args={[0.066, 0.3, 4, seg]} />
              {fabric(p.pants)}
            </mesh>
            <mesh position={[0, -0.24, 0.39]} castShadow>
              <capsuleGeometry args={[0.05, 0.36, 4, seg]} />
              {fabric(p.pants)}
            </mesh>
            <mesh position={[0, -0.505, 0.43]} castShadow>
              <boxGeometry args={[0.09, 0.06, 0.22]} />
              <meshStandardMaterial color={p.shoes} roughness={0.35} metalness={0.05} />
            </mesh>
          </group>
        ))}

        <group ref={spine} position={[0, 0.53, -0.05]}>
          <mesh geometry={torsoGeo} scale={[1, 1, 0.64]} castShadow>
            <meshPhysicalMaterial ref={topMat} color={p.top} roughness={0.92} sheen={0.6} sheenColor={shade(p.top, 1.4)} sheenRoughness={0.8} />
          </mesh>
          {/* collar + placket */}
          <mesh position={[0, 0.545, 0.012]} rotation-x={Math.PI / 2 - 0.25}>
            <torusGeometry args={[0.062, 0.016, 8, seg]} />
            {fabric(p.shirt)}
          </mesh>
          {/* open collar: a narrow V of shirt under the top */}
          <mesh position={[0, 0.5, 0.1]} rotation={[0.25, 0, Math.PI]}>
            <coneGeometry args={[0.03, 0.09, 3, 1, false, Math.PI, Math.PI]} />
            {fabric(p.shirt)}
          </mesh>
          {/* belt */}
          <mesh position={[0, 0.03, 0]} scale={[1, 1, 0.64]}>
            <cylinderGeometry args={[0.162, 0.162, 0.035, seg]} />
            <meshStandardMaterial color="#2a1d15" roughness={0.45} />
          </mesh>
          {/* rounded shoulders */}
          {[-1, 1].map((s) => (
            <mesh key={s} position={[0.175 * s, 0.49, 0]} scale={[1, 0.8, 0.9]}>
              <sphereGeometry args={[0.058, seg, seg / 2]} />
              {fabric(p.top)}
            </mesh>
          ))}
          {arm(-1, lS, lE)}
          {arm(1, rS, rE)}
          <mesh position={[0, 0.6, 0.012]}>
            <cylinderGeometry args={[0.042, 0.048, 0.1, seg]} />
            {skin}
          </mesh>

          <group ref={head} position={[0, 0.72, 0.022]}>
            {/* one smooth head from a lathe profile: cranium → cheeks → tapered chin (no seams) */}
            <mesh geometry={headGeo.head} scale={[1, 1, HEAD_DEPTH]} castShadow>
              {skin}
            </mesh>
            {/* ears (+ small studs for the feminine look) */}
            {[-1, 1].map((s) => (
              <group key={s} position={[0.095 * s, 0.004, -0.006]}>
                <mesh scale={[0.36, 1, 0.66]}>
                  <sphereGeometry args={[0.026, 12, 10]} />
                  {skin}
                </mesh>
                {p.gender === "f" && (
                  <mesh position={[0.004 * s, -0.024, 0.006]}>
                    <sphereGeometry args={[0.0055, 10, 8]} />
                    <meshStandardMaterial color="#f5d27a" metalness={0.9} roughness={0.2} />
                  </mesh>
                )}
              </group>
            ))}
            {/* a straight, refined nose: bridge, rounded tip, wings */}
            <mesh position={[0, -0.002, 0.104]} rotation-x={-0.28} scale={[0.42, 1.7, 0.62]}>
              <sphereGeometry args={[0.013, 14, 12]} />
              {skin}
            </mesh>
            <mesh position={[0, -0.024, 0.108]} scale={p.gender === "f" ? [0.85, 0.8, 0.8] : [0.95, 0.9, 0.9]}>
              <sphereGeometry args={[0.0098, 14, 12]} />
              {skin}
            </mesh>
            {[-1, 1].map((s) => (
              <mesh key={s} position={[0.0085 * s, -0.028, 0.1]}>
                <sphereGeometry args={[0.0052, 10, 8]} />
                {skin}
              </mesh>
            ))}
            {/* painted eye band + painted lower face (blush, contour, lips) on matching slices of the head */}
            <mesh geometry={headGeo.eyes} scale={[1, 1, HEAD_DEPTH]} renderOrder={2}>
              <meshStandardMaterial ref={eyeMat} map={eyeBandTexture(p.face, "open")} transparent roughness={0.4} depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
            </mesh>
            <mesh geometry={headGeo.lower} scale={[1, 1, HEAD_DEPTH]} renderOrder={2}>
              <meshStandardMaterial ref={mouthMat} map={mouthTexture(p.face, "flat")} transparent roughness={0.3} depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
            </mesh>
            {/* brows: fine arches (feminine) or fuller straight brows (masculine) */}
            <mesh ref={browL} geometry={p.gender === "f" ? browArch : browBold} position={[-0.031, 0.05, 0.105]}>
              <meshStandardMaterial color={shade(p.hair, 0.7)} roughness={0.8} />
            </mesh>
            <mesh ref={browR} geometry={p.gender === "f" ? browArch : browBold} position={[0.031, 0.05, 0.105]} scale={[-1, 1, 1]}>
              <meshStandardMaterial color={shade(p.hair, 0.7)} roughness={0.8} />
            </mesh>
            {/* hair — the cap reaches down to y≈0.076 at the front so every fringe overlaps it
                (at 0.42π the hairline sat near the crown and bare scalp showed between cap and fringe) */}
            <mesh position={[0, 0.016, -0.008]} rotation-x={-0.42} scale={[0.99, 1.03, 1.12]}>
              <sphereGeometry args={[0.118, seg + 4, seg, 0, Math.PI * 2, 0, Math.PI * 0.47]} />
              {hairMat}
            </mesh>
            <mesh position={[0, -0.004, -0.018]} scale={[0.96, 1.0, 1.08]}>
              <sphereGeometry args={[0.116, seg, seg, Math.PI * 0.82, Math.PI * 1.36, Math.PI * 0.3, Math.PI * 0.28]} />
              {hairMat}
            </mesh>
            {(p.style === "long" || p.style === "pony") && (
              // light, wispy bangs: one thin fringe sheet just above the brows
              <mesh position={[0, 0.08, 0.072]} rotation={[0.98, 0, 0]} scale={[2.1, 0.3, 0.8]}>
                <sphereGeometry args={[0.04, 16, 12]} />
                {hairMat}
              </mesh>
            )}
            {p.style === "long" && (
              <>
                {/* sleek long straight hair over the shoulders */}
                <mesh position={[0, -0.1, -0.045]} scale={[1.05, 1, 0.75]}>
                  <cylinderGeometry args={[0.108, 0.125, 0.24, seg, 1, true, Math.PI * 0.55, Math.PI * 1.9]} />
                  <meshPhysicalMaterial color={p.hair} roughness={0.5} sheen={0.9} sheenColor={shade(p.hair, 2.4)} side={THREE.DoubleSide} />
                </mesh>
                {[-1, 1].map((s) => (
                  <mesh key={s} position={[0.085 * s, -0.12, 0.02]} scale={[0.55, 1.6, 0.6]}>
                    <sphereGeometry args={[0.04, 14, 12]} />
                    {hairMat}
                  </mesh>
                ))}
              </>
            )}
            {p.style === "bob" && (
              <>
                <mesh position={[0, -0.045, -0.02]} scale={[1.02, 0.9, 0.95]}>
                  <sphereGeometry args={[0.122, seg, seg, Math.PI * 0.72, Math.PI * 1.56, Math.PI * 0.35, Math.PI * 0.4]} />
                  <meshPhysicalMaterial color={p.hair} roughness={0.5} sheen={0.9} sheenColor={shade(p.hair, 2.4)} side={THREE.DoubleSide} />
                </mesh>
                <mesh position={[0.02, 0.084, 0.07]} rotation={[0.95, 0.1, -0.15]} scale={[2.0, 0.38, 0.85]}>
                  <sphereGeometry args={[0.04, 16, 12]} />
                  {hairMat}
                </mesh>
              </>
            )}
            {p.style === "pony" && (
              <>
                <mesh position={[0, 0.09, -0.1]}>
                  <sphereGeometry args={[0.03, 14, 12]} />
                  {hairMat}
                </mesh>
                <mesh position={[0, 0.0, -0.15]} rotation-x={0.35} scale={[0.7, 1, 0.7]}>
                  <capsuleGeometry args={[0.03, 0.14, 4, 12]} />
                  {hairMat}
                </mesh>
              </>
            )}
            {/* men: volume on top for every K-pop cut */}
            {p.gender === "m" && look.hat === "none" && (
              <mesh position={[0, 0.088, -0.012]} scale={[1.2, 0.42, 1.15]}>
                <sphereGeometry args={[0.07, seg, 12]} />
                {hairMat}
              </mesh>
            )}
            {p.style === "curtain" &&
              // middle-parted curtain bangs sweeping out to both temples
              [-1, 1].map((s) => (
                <mesh key={s} position={[0.032 * s, 0.078, 0.07]} rotation={[0.85, 0.25 * s, -0.55 * s]} scale={[1.6, 0.42, 0.9]}>
                  <sphereGeometry args={[0.038, 16, 12]} />
                  {hairMat}
                </mesh>
              ))}
            {p.style === "dandy" && (
              // full, soft fringe brushed down to the brows
              <mesh position={[0, 0.074, 0.072]} rotation={[0.98, 0, 0]} scale={[2.25, 0.42, 0.85]}>
                <sphereGeometry args={[0.04, 16, 12]} />
                {hairMat}
              </mesh>
            )}
            {p.style === "part" && (
              // comma: fringe swept to one side, dipping toward the brow
              <mesh position={[0.02, 0.078, 0.068]} rotation={[0.95, 0.2, -0.4]} scale={[1.9, 0.42, 0.9]}>
                <sphereGeometry args={[0.04, 16, 12]} />
                {hairMat}
              </mesh>
            )}
            {look.glasses && (
              <group position={[0, 0.02, 0.113]}>
                {[-1, 1].map((s) => (
                  <mesh key={s} position={[0.031 * s, 0, 0]}>
                    <torusGeometry args={[0.017, 0.0022, 6, 20]} />
                    <meshStandardMaterial color="#1f2937" metalness={0.6} roughness={0.3} />
                  </mesh>
                ))}
                <mesh>
                  <boxGeometry args={[0.03, 0.003, 0.003]} />
                  <meshStandardMaterial color="#1f2937" metalness={0.6} roughness={0.3} />
                </mesh>
              </group>
            )}
            <mesh ref={sweat} visible={false}>
              <sphereGeometry args={[0.009, 8, 6]} />
              <meshStandardMaterial color="#9fd6ff" transparent opacity={0} roughness={0.1} />
            </mesh>
            {look.hat !== "none" && (
              <group scale={0.58} position={[0, 0.012, 0]}>
                <Hat kind={look.hat} color={look.hatColor} seg={seg} />
              </group>
            )}
            {props.headSlot}
          </group>
        </group>
        {props.children}
      </group>
    </group>
  );
}
