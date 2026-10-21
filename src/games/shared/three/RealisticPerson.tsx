"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { FACES, Hat, POSES, type PersonMood, type Pose, type SeatedPersonProps } from "./SeatedPerson";

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
/** Brow / lid strokes lie horizontally (capsules are vertical by default). */
const browGeo = new THREE.CapsuleGeometry(0.0045, 0.028, 2, 6).rotateZ(Math.PI / 2);

/** Poses re-authored for adult proportions (the cartoon versions put the hands on the face). */
const OVERRIDES: Partial<Record<PersonMood, Pose>> = {
  // arms folded across the chest
  smug: [-0.12, 0, 0, -0.1, 0, 0.1, -0.45, 0.6, 0.2, -2.0, -0.4, -0.6, -0.2, -2.05],
  // hands together in front of the chest
  clap: [0.04, 0, 0, 0, 0, 0, -0.75, 0.5, 0, -1.3, -0.75, -0.5, 0, -1.3],
};

const RESTING = new Set<PersonMood>(["rest", "think", "talk", "write", "nervous", "sad"]);

// natural palettes
const SKIN = ["#f1c9a5", "#e0ac84", "#c68c62", "#9c6644", "#7a4b30", "#f6d7bf"];
const HAIR = ["#1b120c", "#2e1f15", "#4a3222", "#6b4a2e", "#8f6a43", "#b98b5a", "#3a3a3a", "#0e0e0e"];
const EYES = ["#3b2a1d", "#5a3b22", "#2f4a5a", "#3d5a3a", "#1f1a17"];
const TOPS = ["#3f4a5a", "#7a2e2e", "#2f4a3a", "#c9b79c", "#4a3a5a", "#1f2937", "#8a5a3a", "#5a6a7a"];
const PANTS = ["#2a2f3a", "#3a3026", "#1f2430", "#4a4036", "#2b2b2b"];

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
  const lids = useRef<THREE.Group>(null);
  const browL = useRef<THREE.Mesh>(null);
  const browR = useRef<THREE.Mesh>(null);
  const mouth = useRef<THREE.Group>(null);
  const sweat = useRef<THREE.Mesh>(null);
  const topMat = useRef<THREE.MeshPhysicalMaterial>(null);
  const cur = useRef<{ pose: Pose; brow: number; eye: number; sweat: number; look: [number, number]; out: number; rest: number } | null>(null);

  // a stable personal palette per seat, kept apart from the cartoon look so every face differs
  const p = useMemo(() => {
    const h = (k: number) => hash(seed, k);
    const skin = SKIN[Math.floor(h(1) * SKIN.length)];
    return {
      skin,
      lip: shade(skin, 0.78),
      hair: HAIR[Math.floor(h(2) * HAIR.length)],
      eye: EYES[Math.floor(h(3) * EYES.length)],
      top: look.coat && h(9) < 0.35 ? look.coat : TOPS[Math.floor(h(4) * TOPS.length)],
      shirt: look.shirt,
      pants: PANTS[Math.floor(h(5) * PANTS.length)],
      shoes: h(6) < 0.5 ? "#1c1917" : "#5a3a22",
      long: look.hairStyle === "long" || look.hairStyle === "bun",
      bun: look.hairStyle === "bun",
      fringe: look.hairStyle === "spiky" || look.hairStyle === "short",
    };
  }, [seed, look.coat, look.shirt, look.hairStyle]);
  const topColor = useMemo(() => new THREE.Color(p.top), [p.top]);
  const torsoGeo = useMemo(() => new THREE.LatheGeometry(TORSO, lowDetail ? 14 : 28), [lowDetail]);

  useFrame(({ clock }, dt) => {
    const now = clock.elapsedTime;
    if (!cur.current) cur.current = { pose: [...POSES.rest], brow: 0, eye: 1, sweat: 0, look: [0, 0], out: 0, rest: 1 };
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
    const target = OVERRIDES[mood] ?? POSES[mood];
    const face = FACES[mood];
    const rate = 1 - Math.exp(-dt * 6);
    for (let i = 0; i < target.length; i++) c.pose[i] += (target[i] - c.pose[i]) * rate;
    c.brow += (face.brow - c.brow) * rate;
    c.eye += (face.eye - c.eye) * rate;
    c.sweat += (face.sweat - c.sweat) * (1 - Math.exp(-dt * 3));
    c.out += ((props.out ? 1 : 0) - c.out) * (1 - Math.exp(-dt * 3));
    const q = c.pose;
    const osc = (f: number, a: number) => Math.sin(now * f + seed) * a;
    let spineX = q[0] * 0.8;
    let headX = q[3];
    let lSy = q[7];
    let rSx = q[10];
    let rSy = q[11];
    let lEx = q[9];
    let rEx = q[13];
    if (mood === "clap") {
      const s = Math.max(0, Math.sin(now * 12));
      rSy += s * 0.16;
      lSy -= s * 0.16;
    }
    if (mood === "laugh") {
      spineX += osc(14, 0.035);
      headX += osc(14, 0.05);
    }
    if (mood === "talk") {
      rSx += osc(4.5, 0.14);
      rEx += osc(6, 0.16);
      headX += osc(3.5, 0.03);
    }
    if (mood === "cheer") {
      lEx += osc(8, 0.2);
      rEx += osc(8, 0.2);
    }
    if (mood === "write") rEx += osc(12, 0.06);
    if (mood === "nervous") {
      lEx += osc(27, 0.015);
      rEx += osc(29, 0.015);
    }
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
    head.current?.rotation.set(headX * 0.8 + c.look[1], q[4] + c.look[0], q[5] * 0.8 + Math.sin(now * 0.6 + seed) * 0.018);
    const pointYaw = mood === "point" ? c.look[0] : 0;
    // adult arms are shorter than the cartoon rig's: in the resting-type poses, lift the upper arm a
    // touch and bend the elbow more so the forearms lie on the table edge (other poses stay as authored)
    const resting = RESTING.has(mood) ? 1 : 0;
    c.rest += (resting * (1 - c.out) - c.rest) * rate;
    const lift = -0.08 * c.rest;
    const bend = -0.42 * c.rest;
    const leftOnly = mood === "think" || mood === "talk" || mood === "write";
    lS.current?.rotation.set(q[6] + lift, lSy, q[8]);
    lE.current?.rotation.set(lEx + bend, 0, 0);
    rS.current?.rotation.set(rSx + (leftOnly ? 0 : lift) + (mood === "point" ? c.look[1] * 0.6 : 0), rSy + pointYaw * 0.9, q[12]);
    rE.current?.rotation.set(rEx + (leftOnly ? 0 : bend), 0, 0);

    // blink every few seconds; eyes narrow when laughing/tired, widen in shock
    if (lids.current) {
      const b = (now + seed * 1.37) % 4.6;
      lids.current.scale.y = Math.max(0.08, Math.min(1.25, c.eye) * (b < 0.11 && c.eye > 0.3 ? 0.1 : 1));
    }
    browL.current?.rotation.set(0, 0, 0.08 + c.brow * 0.3);
    browR.current?.rotation.set(0, 0, -0.08 - c.brow * 0.3);
    if (browL.current) browL.current.position.y = 0.047 + Math.max(0, c.brow) * 0.006;
    if (browR.current) browR.current.position.y = 0.047 + Math.max(0, c.brow) * 0.006;
    if (mouth.current) {
      const m = mood === "talk" ? (Math.sin(now * 12 + seed) > 0 ? "o" : "flat") : face.mouth;
      for (const ch of mouth.current.children) ch.visible = ch.name === m;
    }
    if (sweat.current) {
      sweat.current.visible = c.sweat > 0.15;
      const drip = (now * 0.3 + seed * 0.2) % 1;
      sweat.current.position.set(-0.095, 0.05 - drip * 0.08, 0.06);
      (sweat.current.material as THREE.MeshStandardMaterial).opacity = c.sweat * 0.75 * (1 - drip * 0.6);
    }
    if (topMat.current) topMat.current.color.copy(topColor).lerp(GREY, c.out * 0.6);
  });

  const skin = <meshPhysicalMaterial color={p.skin} roughness={0.52} sheen={0.35} sheenColor="#ff9a7a" sheenRoughness={0.6} clearcoat={0.06} clearcoatRoughness={0.6} />;
  const fabric = (color: string) => <meshPhysicalMaterial color={color} roughness={0.92} sheen={0.6} sheenColor={shade(color, 1.4)} sheenRoughness={0.8} />;
  const hairMat = <meshPhysicalMaterial color={p.hair} roughness={0.55} sheen={0.8} sheenColor={shade(p.hair, 2.2)} sheenRoughness={0.35} />;

  const hand = (side: 1 | -1) => (
    <group position={[0, -0.27, 0.005]} rotation={[0.15, 0, 0]}>
      <mesh position={[0, -0.04, 0]} castShadow>
        <boxGeometry args={[0.062, 0.078, 0.026]} />
        {skin}
      </mesh>
      {[-0.021, -0.007, 0.007, 0.021].map((x, i) => (
        <mesh key={i} position={[x, -0.098 + Math.abs(x) * 0.4, 0.004]} rotation={[0.35, 0, 0]}>
          <capsuleGeometry args={[0.0075, 0.04 - Math.abs(x) * 0.3, 2, 6]} />
          {skin}
        </mesh>
      ))}
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
            {/* skull + jaw */}
            <mesh castShadow scale={[0.86, 1.03, 0.96]}>
              <sphereGeometry args={[0.112, seg + 4, seg]} />
              {skin}
            </mesh>
            <mesh position={[0, -0.052, 0.018]} scale={[0.86, 0.78, 0.92]}>
              <sphereGeometry args={[0.085, seg, seg]} />
              {skin}
            </mesh>
            {/* ears */}
            {[-1, 1].map((s) => (
              <mesh key={s} position={[0.094 * s, -0.004, -0.004]} scale={[0.38, 1, 0.68]}>
                <sphereGeometry args={[0.027, 12, 10]} />
                {skin}
              </mesh>
            ))}
            {/* nose: bridge + tip + wings */}
            <mesh position={[0, -0.004, 0.103]} rotation-x={-0.32}>
              <boxGeometry args={[0.016, 0.046, 0.022]} />
              {skin}
            </mesh>
            <mesh position={[0, -0.026, 0.114]}>
              <sphereGeometry args={[0.0145, 12, 10]} />
              {skin}
            </mesh>
            {[-1, 1].map((s) => (
              <mesh key={s} position={[0.011 * s, -0.03, 0.107]}>
                <sphereGeometry args={[0.009, 10, 8]} />
                {skin}
              </mesh>
            ))}
            {/* eyes: sclera, iris, pupil, glint (the group squashes to blink) */}
            <group ref={lids} position={[0, 0.019, 0.088]}>
              {[-1, 1].map((s) => (
                <group key={s} position={[0.035 * s, 0, 0]}>
                  <mesh scale={[1, 0.72, 0.55]}>
                    <sphereGeometry args={[0.0165, 16, 12]} />
                    <meshStandardMaterial color="#f4f1ec" roughness={0.25} />
                  </mesh>
                  <mesh position={[0, 0, 0.0085]}>
                    <circleGeometry args={[0.0085, 18]} />
                    <meshStandardMaterial color={p.eye} roughness={0.3} />
                  </mesh>
                  <mesh position={[0, 0, 0.0088]}>
                    <circleGeometry args={[0.0042, 14]} />
                    <meshBasicMaterial color="#0a0a0a" />
                  </mesh>
                  <mesh position={[0.003, 0.003, 0.009]}>
                    <circleGeometry args={[0.0018, 8]} />
                    <meshBasicMaterial color="#ffffff" />
                  </mesh>
                </group>
              ))}
            </group>
            {/* upper-lid creases + soft under-eye */}
            {[-1, 1].map((s) => (
              <mesh key={s} position={[0.035 * s, 0.032, 0.092]} scale={[0.9, 0.9, 0.5]} geometry={browGeo}>
                <meshStandardMaterial color={shade(p.skin, 0.82)} roughness={0.6} />
              </mesh>
            ))}
            {/* brows */}
            <mesh ref={browL} geometry={browGeo} position={[-0.036, 0.047, 0.098]}>
              {hairMat}
            </mesh>
            <mesh ref={browR} geometry={browGeo} position={[0.036, 0.047, 0.098]}>
              {hairMat}
            </mesh>
            {/* mouth shapes (one visible at a time) */}
            <group ref={mouth} position={[0, -0.058, 0.094]}>
              <group name="flat">
                <mesh rotation-z={Math.PI / 2}>
                  <capsuleGeometry args={[0.0055, 0.026, 2, 8]} />
                  <meshStandardMaterial color={p.lip} roughness={0.45} />
                </mesh>
              </group>
              <mesh name="smile" rotation={[0, 0, Math.PI * 1.12]} position={[0, 0.013, 0]}>
                <torusGeometry args={[0.019, 0.0052, 6, 14, Math.PI * 0.76]} />
                <meshStandardMaterial color={p.lip} roughness={0.45} />
              </mesh>
              <group name="grin">
                <mesh position={[0, 0.002, 0]} rotation={[0, 0, Math.PI]}>
                  <circleGeometry args={[0.021, 16, 0, Math.PI]} />
                  <meshStandardMaterial color="#5a1f1f" side={THREE.DoubleSide} />
                </mesh>
                <mesh position={[0, -0.003, 0.001]}>
                  <planeGeometry args={[0.032, 0.006]} />
                  <meshStandardMaterial color="#f5f2ea" side={THREE.DoubleSide} />
                </mesh>
              </group>
              <mesh name="frown" rotation={[0, 0, Math.PI * 0.12]} position={[0, -0.014, 0]}>
                <torusGeometry args={[0.019, 0.0052, 6, 14, Math.PI * 0.76]} />
                <meshStandardMaterial color={p.lip} roughness={0.45} />
              </mesh>
              <mesh name="o" scale={[0.75, 1, 0.4]}>
                <sphereGeometry args={[0.012, 10, 8]} />
                <meshStandardMaterial color="#4a1515" roughness={0.6} />
              </mesh>
            </group>
            {/* hair: shaped cap + style */}
            {/* crown, tilted back so the hairline sits high on the forehead and low at the nape */}
            <mesh position={[0, 0.014, -0.008]} rotation-x={-0.42} scale={[0.93, 1.0, 1.0]}>
              <sphereGeometry args={[0.117, seg + 4, seg, 0, Math.PI * 2, 0, Math.PI * 0.42]} />
              {hairMat}
            </mesh>
            {/* sides + back only (the face stays open) */}
            <mesh position={[0, -0.004, -0.018]} scale={[0.9, 0.98, 0.92]}>
              <sphereGeometry args={[0.115, seg, seg, Math.PI * 0.82, Math.PI * 1.36, Math.PI * 0.3, Math.PI * 0.28]} />
              {hairMat}
            </mesh>
            {p.fringe && (
              <mesh position={[0.022, 0.082, 0.062]} rotation={[0.95, 0.2, -0.35]} scale={[1.5, 0.4, 0.9]}>
                <sphereGeometry args={[0.04, 14, 10]} />
                {hairMat}
              </mesh>
            )}
            {p.long && (
              <mesh position={[0, -0.075, -0.05]} scale={[1, 1, 0.72]}>
                <cylinderGeometry args={[0.105, 0.095, 0.17, seg, 1, true, Math.PI * 0.6, Math.PI * 1.8]} />
                <meshPhysicalMaterial color={p.hair} roughness={0.55} sheen={0.8} sheenColor={shade(p.hair, 2.2)} side={THREE.DoubleSide} />
              </mesh>
            )}
            {p.bun && (
              <mesh position={[0, 0.07, -0.1]}>
                <sphereGeometry args={[0.045, 14, 12]} />
                {hairMat}
              </mesh>
            )}
            {look.beard && (
              <mesh position={[0, -0.06, 0.03]} scale={[0.92, 0.82, 0.86]}>
                <sphereGeometry args={[0.088, seg, 10, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.4]} />
                <meshStandardMaterial color={p.hair} roughness={0.95} side={THREE.DoubleSide} />
              </mesh>
            )}
            {look.glasses && (
              <group position={[0, 0.019, 0.104]}>
                {[-1, 1].map((s) => (
                  <mesh key={s} position={[0.035 * s, 0, 0]}>
                    <torusGeometry args={[0.019, 0.0025, 6, 20]} />
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
