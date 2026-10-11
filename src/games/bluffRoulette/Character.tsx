"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { SeatIndex } from "./engine";
import { activePull, type ShowdownTimeline } from "./timeline";
import type { Resolution } from "./engine";

/**
 * A seated saloon patron (rulebook §T): tailored coat silhouette, shirt and
 * tie, arms resting on the table, a face (eyes, brows, nose, ears, mouth)
 * and a per-seat persona (hat + accessory). Lives in the seat's local frame
 * (+z faces the table). Purely presentational and driven by public info:
 * looks toward whoever is acting, blinks, breathes, raises the gun arm on
 * its own pull and slumps once its pull has actually fired.
 */

type HatKind = "fedora" | "bowler" | "top" | "beret";
type Extra = "mustache" | "monocle" | "scarf" | "earring";

interface Persona {
  coat: string;
  vest: string;
  skin: string;
  hair: string;
  hat: HatKind;
  hatColor: string;
  extra: Extra;
}

const PERSONAS: Persona[] = [
  { coat: "#5b2a14", vest: "#c08a2e", skin: "#f0c8a4", hair: "#3b2416", hat: "fedora", hatColor: "#2b211c", extra: "mustache" },
  { coat: "#1f2f5c", vest: "#9aa7c7", skin: "#e3b58f", hair: "#1c1917", hat: "bowler", hatColor: "#141414", extra: "monocle" },
  { coat: "#1f4d33", vest: "#d9c7a0", skin: "#c48c68", hair: "#20140e", hat: "top", hatColor: "#111111", extra: "scarf" },
  { coat: "#4a2160", vest: "#e7c6f0", skin: "#f5d6bd", hair: "#7a3b1d", hat: "beret", hatColor: "#7f1d1d", extra: "earring" },
  { coat: "#6b1d2c", vest: "#e8d9b8", skin: "#8f5d3e", hair: "#0f0a08", hat: "fedora", hatColor: "#3f3a33", extra: "monocle" },
  { coat: "#24424d", vest: "#cfa86a", skin: "#f1c9a5", hair: "#5c4033", hat: "bowler", hatColor: "#2d241c", extra: "mustache" },
];

const GREY = new THREE.Color("#57534e");
const easeOut = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Coat silhouette for a LatheGeometry: hips → waist → chest → shoulders → collar. */
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

function Hat({ kind, color, band }: { kind: HatKind; color: string; band: string }) {
  const felt = <meshStandardMaterial color={color} roughness={0.85} />;
  if (kind === "beret") {
    return (
      <group position={[0.02, 0.15, -0.02]} rotation={[0.15, 0, -0.25]}>
        <mesh castShadow scale={[1, 0.38, 1]}>
          <sphereGeometry args={[0.215, 20, 12]} />
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
        <cylinderGeometry args={[brimR, brimR, 0.022, 28]} />
        {felt}
      </mesh>
      {kind === "bowler" ? (
        <mesh position={[0, 0.01, 0]} castShadow>
          <sphereGeometry args={[0.185, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2]} />
          {felt}
        </mesh>
      ) : (
        <mesh position={[0, kind === "top" ? 0.17 : 0.1, 0]} castShadow>
          <cylinderGeometry args={kind === "top" ? [0.17, 0.18, 0.34, 24] : [0.15, 0.19, 0.19, 24]} />
          {felt}
        </mesh>
      )}
      {kind === "fedora" && (
        <mesh position={[0, 0.2, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 0.35, 0.5]}>
          <torusGeometry args={[0.08, 0.03, 6, 12, Math.PI]} />
          {felt}
        </mesh>
      )}
      <mesh position={[0, kind === "bowler" ? 0.035 : 0.04, 0]}>
        <cylinderGeometry args={kind === "top" ? [0.181, 0.181, 0.05, 24] : kind === "bowler" ? [0.188, 0.188, 0.04, 24] : [0.172, 0.181, 0.045, 24]} />
        <meshStandardMaterial color={band} roughness={0.5} />
      </mesh>
    </group>
  );
}

export interface CharacterProps {
  seat: SeatIndex;
  /** Seat colour (name tag, tie, hat band). */
  color: string;
  /** World angle of this seat around the table and its world position. */
  angle: number;
  seatPos: THREE.Vector3;
  /** World angles of every seat, to look at whoever is acting. */
  seatAngles: Record<SeatIndex, number>;
  seatR: number;
  activeSeat: SeatIndex | null;
  alive: boolean;
  showdown: { res: Resolution; tl: ShowdownTimeline; startedAt: number } | null;
}

export default function Character({ seat, color, angle, seatPos, seatAngles, seatR, activeSeat, alive, showdown }: CharacterProps) {
  const p = PERSONAS[seat % PERSONAS.length];
  const root = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const gunArm = useRef<THREE.Group>(null);
  const otherArm = useRef<THREE.Group>(null);
  const eyes = useRef<THREE.Group>(null);
  const coatMat = useRef<THREE.MeshStandardMaterial>(null);
  const coatGeo = useMemo(() => new THREE.LatheGeometry(COAT_PROFILE, 24), []);
  const coatColor = useMemo(() => new THREE.Color(p.coat), [p.coat]);
  const blinkPhase = (seat * 1.37) % 4;

  useFrame(({ clock }) => {
    const now = clock.elapsedTime;
    const t = showdown ? (performance.now() - showdown.startedAt) / 1000 : 0;

    // Has my pull fired yet? (the engine resolved everything instantly — visuals wait for the bang)
    let pendingHit = false;
    let fellAt: number | null = null;
    let raise = 0;
    let lookSeat: SeatIndex | null = activeSeat;
    if (showdown) {
      showdown.res.pulls.forEach((pl, j) => {
        if (pl.seat !== seat) return;
        const fireAt = showdown.tl.pulls[j].fireAt;
        if (t < fireAt) pendingHit ||= pl.hit;
        else if (pl.hit) fellAt = fireAt;
      });
      const pull = activePull(showdown.tl, t);
      if (pull) {
        lookSeat = showdown.res.pulls[pull.index].seat;
        if (lookSeat === seat) raise = easeOut(pull.local / 0.35) * (1 - easeOut((pull.local - 2.3) / 0.35));
      } else lookSeat = t < showdown.tl.verdictAt ? showdown.res.accusedSeat : showdown.res.challengerSeat;
    }
    const visuallyAlive = alive || pendingHit;
    const fall = fellAt !== null ? clamp01((t - fellAt) / 0.6) : visuallyAlive ? 0 : 1;

    if (root.current) {
      root.current.rotation.x = -easeOut(fall) * 1.15;
      root.current.position.y = Math.sin(now * 1.6 + seat) * 0.01 * (1 - fall);
      root.current.scale.y = 1 + Math.sin(now * 1.6 + seat) * 0.006; // breathing
    }
    if (coatMat.current) coatMat.current.color.copy(coatColor).lerp(GREY, fall * 0.75);

    // Head: turn toward the seat that is acting (or down at the table when it's me / nobody).
    if (head.current) {
      let yaw = 0;
      let pitch = 0.18;
      if (lookSeat !== null && lookSeat !== seat && seatAngles[lookSeat] !== undefined) {
        const a = seatAngles[lookSeat];
        const dx = Math.sin(a) * seatR - seatPos.x;
        const dz = Math.cos(a) * seatR - seatPos.z;
        const th = angle + Math.PI;
        const lx = dx * Math.cos(th) - dz * Math.sin(th);
        const lz = dx * Math.sin(th) + dz * Math.cos(th);
        yaw = Math.max(-0.95, Math.min(0.95, Math.atan2(lx, lz)));
        pitch = 0.02;
      }
      if (raise > 0) {
        yaw = 0;
        pitch = -0.1 * raise;
      }
      head.current.rotation.y += (yaw - head.current.rotation.y) * 0.08;
      head.current.rotation.x += (pitch - head.current.rotation.x) * 0.08;
      head.current.rotation.z = Math.sin(now * 0.7 + seat) * 0.03 + raise * 0.12;
    }
    if (eyes.current) {
      const b = (now + blinkPhase) % 4.2;
      eyes.current.scale.y = fall > 0.5 ? 0.15 : b < 0.12 ? 0.12 : 1;
    }
    // Arms rest on the table; the gun arm swings up to the temple on my pull.
    if (gunArm.current) {
      gunArm.current.rotation.x = -1.05 + raise * -1.85;
      gunArm.current.rotation.z = 0.18 + raise * -0.53;
    }
    if (otherArm.current) otherArm.current.rotation.x = -1.05 + Math.sin(now * 0.9 + seat) * 0.03;
  });

  const skin = <meshStandardMaterial color={p.skin} roughness={0.62} />;
  const sleeve = <meshStandardMaterial color={p.coat} roughness={0.75} />;
  const arm = (side: 1 | -1, ref: React.RefObject<THREE.Group | null>) => (
    <group ref={ref} position={[0.34 * side, 1.22, -0.02]} rotation={[-1.05, 0, 0.18 * side * -1]}>
      <mesh position={[0, -0.2, 0]} castShadow>
        <capsuleGeometry args={[0.075, 0.3, 4, 10]} />
        {sleeve}
      </mesh>
      <mesh position={[0, -0.44, 0.02]} castShadow>
        <capsuleGeometry args={[0.065, 0.18, 4, 10]} />
        {sleeve}
      </mesh>
      <mesh position={[0, -0.58, 0.03]}>
        <cylinderGeometry args={[0.07, 0.07, 0.03, 12]} />
        <meshStandardMaterial color="#f5f0e6" roughness={0.6} />
      </mesh>
      <mesh position={[0, -0.65, 0.04]} scale={[1, 0.8, 1.15]} castShadow>
        <sphereGeometry args={[0.065, 12, 10]} />
        {skin}
      </mesh>
    </group>
  );

  return (
    <group ref={root}>
      {/* coat */}
      <mesh geometry={coatGeo} position={[0, 0.55, -0.06]} scale={[1, 1, 0.78]} castShadow>
        <meshStandardMaterial ref={coatMat} color={p.coat} roughness={0.78} />
      </mesh>
      {/* shirt front, vest and tie */}
      <mesh position={[0, 1.05, 0.2]} rotation={[-0.12, 0, 0]}>
        <planeGeometry args={[0.2, 0.36]} />
        <meshStandardMaterial color={p.vest} roughness={0.6} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 1.13, 0.215]} rotation={[-0.12, 0, Math.PI]}>
        <circleGeometry args={[0.085, 3]} />
        <meshStandardMaterial color="#f8f5ee" roughness={0.5} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 1.08, 0.222]} rotation={[-0.12, 0, Math.PI / 4]}>
        <planeGeometry args={[0.045, 0.045]} />
        <meshStandardMaterial color={color} roughness={0.4} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.99, 0.225]} rotation={[-0.12, 0, 0]}>
        <planeGeometry args={[0.04, 0.14]} />
        <meshStandardMaterial color={color} roughness={0.4} side={THREE.DoubleSide} />
      </mesh>
      {/* lapels */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0.085 * s, 1.06, 0.205]} rotation={[-0.12, 0, 0.32 * s]}>
          <planeGeometry args={[0.06, 0.34]} />
          <meshStandardMaterial color={p.coat} roughness={0.7} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {arm(-1, gunArm)}
      {arm(1, otherArm)}
      {/* neck + head */}
      <mesh position={[0, 1.32, -0.02]}>
        <cylinderGeometry args={[0.075, 0.085, 0.12, 12]} />
        {skin}
      </mesh>
      {p.extra === "scarf" && (
        <mesh position={[0, 1.3, -0.02]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.1, 0.045, 8, 18]} />
          <meshStandardMaterial color="#b91c1c" roughness={0.9} />
        </mesh>
      )}
      <group ref={head} position={[0, 1.52, 0]}>
        <mesh castShadow scale={[0.92, 1.06, 0.95]}>
          <sphereGeometry args={[0.2, 28, 22]} />
          {skin}
        </mesh>
        {/* hair at the back and sides */}
        <mesh position={[0, 0.03, -0.03]} scale={[0.96, 0.9, 0.95]}>
          <sphereGeometry args={[0.2, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
          <meshStandardMaterial color={p.hair} roughness={0.9} />
        </mesh>
        {/* ears */}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[0.185 * s, -0.01, 0]} scale={[0.5, 1, 0.8]}>
            <sphereGeometry args={[0.045, 10, 8]} />
            {skin}
          </mesh>
        ))}
        {/* eyes (white + iris), blinking as a group */}
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
        {/* brows */}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[0.066 * s, 0.075, 0.172]} rotation={[0, 0, -0.12 * s]}>
            <boxGeometry args={[0.06, 0.012, 0.012]} />
            <meshStandardMaterial color={p.hair} roughness={0.9} />
          </mesh>
        ))}
        {/* nose + mouth */}
        <mesh position={[0, -0.025, 0.19]} scale={[0.8, 1.1, 1]}>
          <sphereGeometry args={[0.026, 10, 8]} />
          {skin}
        </mesh>
        <mesh position={[0, -0.085, 0.17]} rotation={[0.2, 0, Math.PI]}>
          <torusGeometry args={[0.035, 0.007, 6, 12, Math.PI * 0.7]} />
          <meshStandardMaterial color="#7c2d2d" roughness={0.6} />
        </mesh>
        {p.extra === "mustache" &&
          [-1, 1].map((s) => (
            <mesh key={s} position={[0.032 * s, -0.058, 0.185]} rotation={[0, 0, (Math.PI / 2 - 0.35) * s]}>
              <capsuleGeometry args={[0.011, 0.045, 3, 6]} />
              <meshStandardMaterial color={p.hair} roughness={0.9} />
            </mesh>
          ))}
        {p.extra === "monocle" && (
          <mesh position={[0.066, 0.02, 0.19]}>
            <torusGeometry args={[0.04, 0.005, 6, 20]} />
            <meshStandardMaterial color="#d4a64a" metalness={0.9} roughness={0.25} />
          </mesh>
        )}
        {p.extra === "earring" && (
          <mesh position={[0.19, -0.07, 0.01]}>
            <sphereGeometry args={[0.014, 8, 6]} />
            <meshStandardMaterial color="#facc15" metalness={0.9} roughness={0.2} />
          </mesh>
        )}
        <Hat kind={p.hat} color={p.hatColor} band={color} />
      </group>
    </group>
  );
}
