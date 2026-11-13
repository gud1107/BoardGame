"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { createPortal, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { VRMHumanBoneName } from "@pixiv/three-vrm";
import type { PersonLook } from "./SeatedPerson";
import { blinkAmount } from "./vrmLife";
import { tickVrm, useVrmAvatar } from "./VrmPerson";
import { armJointQuat, toVrm0, upperArmQuat } from "./vrmPose";

/**
 * A standing / walking VRM body for game-specific actors (heist thieves, city-chase
 * thief and officers, mansion NPCs…) that used to be primitive dolls. The caller
 * writes joint targets into a channel buffer every frame through `pose`; VrmBody
 * eases toward them, maps them onto the normalized bones and ticks the VRM.
 *
 * Channel conventions match the old cartoon rigs so their animation code ports 1:1
 * (figure faces +z):
 * - spine/chest/neck/head: Euler x = lean/nod forward (+), y = turn, z = tilt
 * - upper arms: rotations of an arm already HANGING DOWN (zeros = relaxed A-pose);
 *   x < 0 swings the arm forward (−π ≈ straight up), z opens it outward —
 *   left arm outward = +z, right arm outward = −z (VRM left is +x)
 * - lower arms: x < 0 bends the elbow forward, z twists
 * - legs: x < 0 swings the thigh forward, lower leg x > 0 bends the knee
 * - DROP: how far the body sinks, as a fraction of the head height (crouching)
 */

const BONES = ["spine", "chest", "neck", "head", "rightUpperArm", "rightLowerArm", "leftUpperArm", "leftLowerArm", "rightUpperLeg", "rightLowerLeg", "leftUpperLeg", "leftLowerLeg"] as const satisfies readonly VRMHumanBoneName[];
type BodyBone = (typeof BONES)[number];
/** Offset of each bone's (x, y, z) in the channel buffer. */
export const BODY: Record<BodyBone, number> = Object.fromEntries(BONES.map((b, i) => [b, i * 3])) as Record<BodyBone, number>;
export const BODY_DROP = BONES.length * 3;
export const BODY_CHANNELS = BODY_DROP + 1;

export function setBone(o: Float32Array, bone: BodyBone, x: number, y = 0, z = 0) {
  const at = BODY[bone];
  o[at] = x;
  o[at + 1] = y;
  o[at + 2] = z;
}

/** Arms and legs swinging in a walk cycle (`phase` radians, `amt` 0..1). Adds onto what's there. */
export function addWalk(o: Float32Array, phase: number, amt: number) {
  const w = Math.sin(phase) * 0.6 * amt;
  o[BODY.rightUpperLeg] += w;
  o[BODY.leftUpperLeg] -= w;
  o[BODY.rightLowerLeg] += Math.max(0, -w) * 1.2;
  o[BODY.leftLowerLeg] += Math.max(0, w) * 1.2;
  o[BODY.rightUpperArm] -= w * 0.8;
  o[BODY.leftUpperArm] += w * 0.8;
  o[BODY.rightLowerArm] -= 0.25 * amt;
  o[BODY.leftLowerArm] -= 0.25 * amt;
}

/** Deep crouch (0..1): thighs up, knees folded, body sunk, arms on the knees. Adds onto what's there. */
export function addCrouch(o: Float32Array, k: number) {
  o[BODY.rightUpperLeg] -= 1.5 * k;
  o[BODY.leftUpperLeg] -= 1.5 * k;
  o[BODY.rightLowerLeg] += 2.2 * k;
  o[BODY.leftLowerLeg] += 2.2 * k;
  o[BODY.spine] += 0.45 * k;
  o[BODY.rightUpperArm] -= 0.9 * k;
  o[BODY.leftUpperArm] -= 0.9 * k;
  o[BODY.rightLowerArm] -= 0.8 * k;
  o[BODY.leftLowerArm] -= 0.8 * k;
  o[BODY_DROP] += 0.36 * k;
}

export interface BodyFace {
  happy?: number;
  surprised?: number;
  angry?: number;
  sad?: number;
  /** eyes shut (counting, sleeping) — otherwise VrmBody blinks on its own */
  shut?: boolean;
}

export interface VrmBodyProps {
  look: PersonLook;
  seed: number;
  /** World height of the head bone (≈ chin) when standing — sizes the model to the scene. */
  headY: number;
  /** Write this frame's joint targets (`o` is zeroed first). Read from refs; called every frame. */
  pose: (o: Float32Array, t: number, dt: number) => void;
  face?: (t: number) => BodyFace;
  lowDetail?: boolean;
  /** How quickly joints follow their targets (1/s). */
  follow?: number;
  /** Translucent glowing hologram in this colour (time-loop ghosts…); `alpha` is read every frame. */
  ghost?: { color: string; alpha: { current: number } } | null;
  /** Greys the body out (eliminated) — the same tint the tables use. */
  out?: boolean;
  /** Attached to the head bone: origin ≈ crown (+0.12 m model space), +z forward, model metres. */
  head?: ReactNode;
  /** Attached to the upper chest: +z forward (a sack on the back sits at −z), model metres. */
  back?: ReactNode;
  /** Attached to the right hand bone (hanging arm: fingers −y). */
  handR?: ReactNode;
  /** Drawn while the model loads (or if it fails) — keep it a silhouette, never a cartoon stand-in. */
  fallback?: ReactNode;
  onReady?: () => void;
}

const fQ = new THREE.Quaternion();
const fE = new THREE.Euler();

type GhostMat = THREE.Material & { uniforms?: { opacity?: { value: number }; alphaTest?: { value: number } }; emissive?: THREE.Color; emissiveIntensity?: number };

export default function VrmBody(props: VrmBodyProps) {
  const { look, seed, headY, lowDetail = false, ghost = null } = props;
  const { vrm, morphs } = useVrmAvatar(look, seed, { lowDetail: lowDetail || !!ghost, out: props.out });
  const bodyRef = useRef<THREE.Group>(null);
  const live = useRef(props);
  useLayoutEffect(() => {
    live.current = props;
  });
  const st = useRef<{ cur: Float32Array; want: Float32Array; springs: { current: number }; first: boolean } | null>(null);

  const fit = useMemo(() => {
    if (!vrm) return null;
    const head = vrm.humanoid.getNormalizedBoneNode("head");
    const y = head ? head.getWorldPosition(new THREE.Vector3()).y : 1.4;
    return headY / Math.max(0.3, y);
  }, [vrm, headY]);

  const { onReady } = props;
  useEffect(() => {
    if (vrm) onReady?.();
  }, [vrm, onReady]);

  // ghosts: every material see-through with a glow of the seat colour (materials are per instance)
  const ghostMats = useRef<{ of: unknown; list: GhostMat[] }>({ of: null, list: [] });

  useFrame(({ clock }, dtRaw) => {
    const p = live.current;
    const dt = Math.min(dtRaw, 0.05);
    const t = clock.elapsedTime;
    const s = (st.current ??= { cur: new Float32Array(BODY_CHANNELS), want: new Float32Array(BODY_CHANNELS), springs: { current: 0 }, first: true });
    s.want.fill(0);
    p.pose(s.want, t, dt);
    if (s.first) {
      s.cur.set(s.want);
      s.first = false;
    } else {
      const k = 1 - Math.exp(-dt * (p.follow ?? 14));
      for (let i = 0; i < BODY_CHANNELS; i++) s.cur[i] += (s.want[i] - s.cur[i]) * k;
    }
    if (bodyRef.current) bodyRef.current.position.y = -s.cur[BODY_DROP] * p.headY;
    if (!vrm) return;
    const vrm0 = vrm.meta.metaVersion === "0";
    for (let i = 0; i < BONES.length; i++) {
      const bone = BONES[i];
      const node = vrm.humanoid.getNormalizedBoneNode(bone);
      if (!node) continue;
      const x = s.cur[i * 3], y = s.cur[i * 3 + 1], z = s.cur[i * 3 + 2];
      if (bone === "rightUpperArm" || bone === "leftUpperArm") upperArmQuat(bone[0] === "r" ? "r" : "l", x, y, z, fQ);
      else if (bone === "rightLowerArm" || bone === "leftLowerArm") armJointQuat(bone[0] === "r" ? "r" : "l", x, z, fQ);
      else fQ.setFromEuler(fE.set(x, y, z));
      node.quaternion.copy(vrm0 ? toVrm0(fQ) : fQ);
    }
    const em = vrm.expressionManager;
    if (em) {
      const f = p.face?.(t) ?? {};
      em.setValue("happy", f.happy ?? 0);
      em.setValue("surprised", f.surprised ?? 0);
      em.setValue("angry", f.angry ?? 0);
      em.setValue("sad", f.sad ?? 0);
      const wide = (f.happy ?? 0) > 0.9 || (f.surprised ?? 0) > 0.5;
      em.setValue("blink", f.shut ? 1 : wide ? 0 : blinkAmount(t, seed));
    }
    if (p.ghost) {
      const g = p.ghost;
      const gm = ghostMats.current;
      const mark = `${vrm.scene.uuid}|${p.ghost.color}`;
      if (gm.of !== mark) {
        gm.of = mark;
        gm.list = [];
        vrm.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as GhostMat[]) {
            if (gm.list.includes(m)) continue;
            m.transparent = true;
            m.depthWrite = false;
            // cut-out materials (hair, clothes) discard alpha < 0.5 — at ghost opacity the whole body would vanish
            m.alphaTest = 0;
            if (m.uniforms?.alphaTest) m.uniforms.alphaTest.value = 0;
            if (m.emissive) m.emissive.set(g.color);
            if (typeof m.emissiveIntensity === "number") m.emissiveIntensity = 0.55;
            m.needsUpdate = true;
            gm.list.push(m);
          }
        });
      }
      const a = p.ghost.alpha.current;
      for (const m of gm.list) {
        m.opacity = a;
        if (m.uniforms?.opacity) m.uniforms.opacity.value = a;
      }
    }
    tickVrm(vrm, dt, morphs.current, s.springs, lowDetail || !!p.ghost, { t, seed });
  });

  const headBone = vrm?.humanoid.getNormalizedBoneNode("head") ?? null;
  const chestBone = vrm ? (vrm.humanoid.getNormalizedBoneNode("upperChest") ?? vrm.humanoid.getNormalizedBoneNode("chest")) : null;
  const handBone = vrm?.humanoid.getNormalizedBoneNode("rightHand") ?? null;
  // VRM 0.x normalized bone frames are turned 180° about y (see vrmPose.toVrm0)
  const turn = vrm?.meta.metaVersion === "0" ? Math.PI : 0;
  return (
    <group ref={bodyRef}>
      {vrm && fit ? (
        <>
          <primitive object={vrm.scene} scale={fit} />
          {props.head && headBone && createPortal(<group rotation-y={turn}><group position={[0, 0.12, 0.005]}>{props.head}</group></group>, headBone)}
          {props.back && chestBone && createPortal(<group rotation-y={turn}>{props.back}</group>, chestBone)}
          {props.handR && handBone && createPortal(<group rotation-y={turn}>{props.handR}</group>, handBone)}
        </>
      ) : (
        props.fallback ?? null
      )}
    </group>
  );
}
