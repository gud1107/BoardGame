"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import { CuboidCollider, Physics, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { DiceMesh } from "./DiceMesh";
import { quaternionForFaceUp } from "./faceMath";
import type { DiceColorway } from "./colorways";

/**
 * The physics rolling spectacle for "내 주사위" (requirement #2: real
 * tumble/collide physics; requirement #3: lift-the-cup peek toggle).
 *
 * Important trust-model note (see also `faceMath.ts`'s header): Rapier's
 * solver is local to this browser tab and NOT part of the lockstep sync —
 * two clients running the "same" toss would settle on different faces by
 * pure floating-point chance. That's fine because the toss is decoration
 * only. The actual values in `dice` come from `engine.ts` (already synced
 * the same way every other action is) and are known *before* this component
 * even starts animating; physics just improvises a chaotic-looking path
 * from "freshly tossed" to a pose this component forces frame-by-frame
 * during the "settling" phase, landing exactly on `quaternionForFaceUp`.
 *
 * The cup's physical boundary is a plain rectangular pen (`CuboidCollider`
 * walls) hidden behind a round decorative cup mesh — modelling the actual
 * concave interior of a real cup would need a concave (trimesh) collider,
 * which is unnecessary complexity here since dice never get close enough to
 * the mismatch between "round shell" and "square pen" to make it visible in
 * the ~1s the dice are ever moving.
 */

const DIE_SIZE = 0.62;
const TUMBLE_MS = 950;
const SETTLE_MS = 320;
const LID_LERP_SPEED = 6.5; // per second, exponential approach

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function penHalfWidth(diceCount: number): number {
  return Math.max(1.0, ((Math.max(diceCount, 1) - 1) / 2) * (DIE_SIZE * 1.35) + 0.75);
}

function settledSlot(index: number, diceCount: number): THREE.Vector3 {
  const x = (index - (diceCount - 1) / 2) * (DIE_SIZE * 1.35);
  return new THREE.Vector3(x, DIE_SIZE / 2, 0);
}

/** Static invisible walls + floor — see file header for why this is a simple box pen rather than a true concave cup collider. */
function Pen({ halfWidth }: { halfWidth: number }) {
  const wallHeight = 1.7;
  const t = 0.08;
  return (
    <RigidBody type="fixed" colliders={false} restitution={0.25} friction={0.7}>
      <CuboidCollider args={[halfWidth, 0.05, halfWidth]} position={[0, -0.05, 0]} />
      <CuboidCollider args={[t, wallHeight, halfWidth]} position={[halfWidth, wallHeight - 0.05, 0]} />
      <CuboidCollider args={[t, wallHeight, halfWidth]} position={[-halfWidth, wallHeight - 0.05, 0]} />
      <CuboidCollider args={[halfWidth, wallHeight, t]} position={[0, wallHeight - 0.05, halfWidth]} />
      <CuboidCollider args={[halfWidth, wallHeight, t]} position={[0, wallHeight - 0.05, -halfWidth]} />
    </RigidBody>
  );
}

/**
 * The visible cup shell — purely decorative (no collider of its own),
 * lifted straight up by the parent scene to reveal the dice underneath
 * rather than "opening" in place. That's deliberate: the cylinder below has
 * closed caps (no `openEnded`), i.e. it's a solid, fully opaque vessel from
 * every angle — an open-topped tube would let the elevated camera used here
 * look straight down into it and see the dice through the "closed" cup,
 * which would silently defeat the whole peek toggle.
 */
function CupShell({ colorway, halfWidth }: { colorway: DiceColorway; halfWidth: number }) {
  const radius = halfWidth * 1.28;
  const height = 2.0;
  return (
    <group>
      <mesh position={[0, height / 2 - 0.15, 0]}>
        <cylinderGeometry args={[radius * 1.05, radius * 0.85, height, 28]} />
        <meshStandardMaterial color={colorway.body} roughness={0.65} metalness={0.04} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, height - 0.15, 0]}>
        <torusGeometry args={[radius * 1.05, 0.045, 12, 32]} />
        <meshStandardMaterial color={colorway.shadow} roughness={0.5} metalness={0.1} />
      </mesh>
      <mesh position={[0, -0.15, 0]}>
        <cylinderGeometry args={[radius * 0.85, radius * 0.85, 0.05, 28]} />
        <meshStandardMaterial color={colorway.shadow} roughness={0.7} metalness={0.05} />
      </mesh>
    </group>
  );
}

type RollPhase = "tumbling" | "settling" | "settled";

interface Snapshot {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
}

function CupScene({
  dice,
  colorway,
  rollToken,
  peeking,
  ringForIndex,
  onRollStart,
  onSettled,
}: {
  dice: number[];
  colorway: DiceColorway;
  rollToken: number | string;
  peeking: boolean;
  ringForIndex?: (index: number) => "match" | "wild" | undefined;
  onRollStart?: () => void;
  onSettled?: () => void;
}) {
  const halfWidth = penHalfWidth(dice.length);
  const bodyRefs = useRef<(RapierRigidBody | null)[]>([]);
  const phase = useRef<RollPhase>("tumbling");
  const phaseStartedAt = useRef<number | null>(null);
  const fromSnapshot = useRef<Snapshot[]>([]);
  const toSnapshot = useRef<Snapshot[]>([]);
  const lidLift = useRef(0);
  const cupGroupRef = useRef<THREE.Group>(null);
  const onRollStartRef = useRef(onRollStart);
  const onSettledRef = useRef(onSettled);
  // Refs may only be written outside render (this project's stricter
  // react-hooks lint config, see HANDOFF.md, flags a bare
  // `ref.current = ...` sitting directly in the function body) — an effect
  // is the correct place for "keep this ref pointed at the latest callback
  // prop" even though the write itself is unconditional.
  useEffect(() => {
    onRollStartRef.current = onRollStart;
    onSettledRef.current = onSettled;
  }, [onRollStart, onSettled]);

  // Only used to gate the match/wild floor-ring markers below — everything
  // else in this component is driven imperatively via refs (see file
  // header's trust-model note), but "should the rings be in the DOM at all"
  // is a legitimate one-shot render decision, not a per-frame animation.
  // Reset via the same render-time "adjust state when a prop changes"
  // pattern `PerudoBoard.tsx` uses elsewhere (`revealedRound`, `peekedRound`)
  // rather than an effect that would call `setIsSettled` synchronously.
  const [resetForToken, setResetForToken] = useState<number | string | null>(null);
  const [isSettled, setIsSettled] = useState(false);
  if (resetForToken !== rollToken) {
    setResetForToken(rollToken);
    setIsSettled(false);
  }

  function launchRoll() {
    phase.current = "tumbling";
    phaseStartedAt.current = null; // set on the next frame, against that frame's own clock
    dice.forEach((_, i) => {
      const rb = bodyRefs.current[i];
      if (!rb) return;
      rb.lockTranslations(false, true);
      rb.lockRotations(false, true);
      const spawnSpread = halfWidth * 0.5;
      rb.setTranslation({ x: (Math.random() - 0.5) * spawnSpread, y: 1.3 + i * 0.18, z: (Math.random() - 0.5) * spawnSpread }, true);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2));
      rb.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
      rb.setLinvel({ x: (Math.random() - 0.5) * 3.2, y: 1 + Math.random() * 1.6, z: (Math.random() - 0.5) * 3.2 }, true);
      rb.setAngvel({ x: (Math.random() - 0.5) * 20, y: (Math.random() - 0.5) * 20, z: (Math.random() - 0.5) * 20 }, true);
    });
    onRollStartRef.current?.();
  }

  useEffect(() => {
    launchRoll();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- launchRoll intentionally re-reads latest `dice`/refs each call; only `rollToken` should retrigger it.
  }, [rollToken]);

  useFrame((state, delta) => {
    const nowMs = state.clock.elapsedTime * 1000;
    if (phaseStartedAt.current === null) phaseStartedAt.current = nowMs;

    if (phase.current === "tumbling") {
      if (nowMs - phaseStartedAt.current >= TUMBLE_MS) {
        fromSnapshot.current = dice.map((_, i) => {
          const rb = bodyRefs.current[i];
          const t = rb?.translation() ?? { x: 0, y: DIE_SIZE / 2, z: 0 };
          const r = rb?.rotation() ?? { x: 0, y: 0, z: 0, w: 1 };
          return { pos: new THREE.Vector3(t.x, t.y, t.z), quat: new THREE.Quaternion(r.x, r.y, r.z, r.w) };
        });
        toSnapshot.current = dice.map((value, i) => ({
          pos: settledSlot(i, dice.length),
          quat: quaternionForFaceUp(value, Math.random() * Math.PI * 2),
        }));
        phase.current = "settling";
        phaseStartedAt.current = nowMs;
      }
    } else if (phase.current === "settling") {
      const t = Math.min(1, (nowMs - phaseStartedAt.current) / SETTLE_MS);
      const eased = easeOutCubic(t);
      dice.forEach((_, i) => {
        const rb = bodyRefs.current[i];
        const from = fromSnapshot.current[i];
        const to = toSnapshot.current[i];
        if (!rb || !from || !to) return;
        const pos = from.pos.clone().lerp(to.pos, eased);
        const quat = from.quat.clone().slerp(to.quat, eased);
        rb.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
        rb.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }, true);
        rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
        rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
      });
      if (t >= 1) {
        dice.forEach((_, i) => {
          const rb = bodyRefs.current[i];
          rb?.lockTranslations(true, true);
          rb?.lockRotations(true, true);
        });
        phase.current = "settled";
        setIsSettled(true);
        onSettledRef.current?.();
      }
    }

    // Cup lid: exponential approach toward 0 (down/closed) or 1 (up/open) — imperative transform, no React state, so this never re-renders anything.
    const target = peeking ? 1 : 0;
    lidLift.current += (target - lidLift.current) * Math.min(1, delta * LID_LERP_SPEED);
    if (cupGroupRef.current) {
      cupGroupRef.current.position.y = lidLift.current * 1.9;
      cupGroupRef.current.rotation.x = -lidLift.current * 0.35;
      cupGroupRef.current.rotation.z = lidLift.current * 0.12;
    }
  });

  return (
    <>
      <Pen halfWidth={halfWidth} />
      {dice.map((_, i) => (
        <RigidBody
          key={i}
          ref={(el) => {
            bodyRefs.current[i] = el;
          }}
          colliders="cuboid"
          restitution={0.3}
          friction={0.6}
          angularDamping={0.35}
          linearDamping={0.1}
        >
          <DiceMesh colorway={colorway} size={DIE_SIZE} />
        </RigidBody>
      ))}
      {/* Match/wild floor markers — the same at-a-glance highlight the CSS
          dice drew as a glowing ring around the cube itself (see
          `PerudoBoard.tsx`'s `DiceGlowRing`). A physics die's own rotation
          is spoken for (it's what shows the correct face up), so the ring
          lives on the floor at that die's fixed resting slot instead —
          `settledSlot` is a pure function of `(index, diceCount)`, so this
          doesn't need to track any live physics transform. */}
      {isSettled &&
        dice.map((_, i) => {
          const kind = ringForIndex?.(i);
          if (!kind) return null;
          const slot = settledSlot(i, dice.length);
          return (
            <mesh key={`ring-${i}`} position={[slot.x, 0.015, slot.z]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[DIE_SIZE * 0.62, DIE_SIZE * 0.76, 32]} />
              <meshBasicMaterial color={kind === "match" ? "#fcd34d" : "#c4b5fd"} transparent opacity={0.85} />
            </mesh>
          );
        })}
      <group ref={cupGroupRef}>
        <CupShell colorway={colorway} halfWidth={halfWidth} />
      </group>
    </>
  );
}

export interface DiceCup3DProps {
  /** The already-decided, engine-authoritative dice values (1-6) to land on — see file header. */
  dice: number[];
  colorway: DiceColorway;
  /** Bump this (e.g. `state.roundNumber`) to replay the toss animation; the actual `dice` values driving where it lands can (and should) already reflect the new round. */
  rollToken: number | string;
  /** Whether the cup is currently lifted so the dice show through. */
  peeking: boolean;
  /** Per-die match/wild highlight (same idea as the CSS dice's `ring` prop) — see `CupScene`'s floor-marker comment for why this isn't drawn directly on the die. */
  ringForIndex?: (index: number) => "match" | "wild" | undefined;
  onRollStart?: () => void;
  onSettled?: () => void;
  /** CSS pixel height for the canvas; width stretches to its container. */
  heightPx?: number;
}

/** Self-contained canvas (not part of the shared `DiceStage` — see that file's header for why static thumbnails share one canvas but this one-off physics spectacle gets its own). */
export function DiceCup3D({ dice, colorway, rollToken, peeking, ringForIndex, onRollStart, onSettled, heightPx = 132 }: DiceCup3DProps) {
  if (dice.length === 0) return null;
  return (
    <Canvas style={{ width: "100%", height: heightPx }} gl={{ antialias: true, alpha: true }} dpr={[1, 1.5]}>
      <PerspectiveCamera makeDefault position={[0, 2.6, penHalfWidth(dice.length) * 2.1 + 1.4]} fov={32} onUpdate={(camera) => camera.lookAt(0, 0.3, 0)} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[2, 4, 3]} intensity={1.1} castShadow={false} />
      <directionalLight position={[-2, 1.5, -2]} intensity={0.25} />
      <Physics gravity={[0, -9.81, 0]}>
        <CupScene dice={dice} colorway={colorway} rollToken={rollToken} peeking={peeking} ringForIndex={ringForIndex} onRollStart={onRollStart} onSettled={onSettled} />
      </Physics>
    </Canvas>
  );
}
