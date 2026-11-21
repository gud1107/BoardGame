"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { createPortal, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import type { PersonLook } from "./SeatedPerson";
import { blinkAmount } from "./vrmLife";
import { tickVrm, useVrmAvatar } from "./VrmPerson";
import { armJointQuat, toVrm0, upperArmQuat } from "./vrmPose";
import { cycleAt, GAIT_STYLES, gaitLocal, gaitParents, getGait, sampleGait, type GaitData, type GaitStyle } from "./vrmGait";

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

/** The channels addWalk swings (x of each), in {@link walkSwing}'s order. */
const WALK_CH = [BODY.rightUpperLeg, BODY.leftUpperLeg, BODY.rightLowerLeg, BODY.leftLowerLeg, BODY.rightUpperArm, BODY.leftUpperArm, BODY.rightLowerArm, BODY.leftLowerArm];

/** The procedural walk's swing per WALK_CH channel. */
function walkSwing(phase: number, amt: number, out: Float32Array) {
  const w = Math.sin(phase) * 0.6 * amt;
  out[0] = w;
  out[1] = -w;
  out[2] = Math.max(0, -w) * 1.2;
  out[3] = Math.max(0, w) * 1.2;
  out[4] = -w * 0.8;
  out[5] = w * 0.8;
  out[6] = -0.25 * amt;
  out[7] = -0.25 * amt;
}

/**
 * What addWalk left in a pose buffer this frame: VrmBody plays the motion-capture cycle
 * (vrmGait.ts) for every swung joint the caller didn't touch afterwards (`snap` = the
 * channel values addWalk wrote), and keeps the procedural swing for the ones it did
 * (crouching legs, an arm holding a crown…).
 */
type WalkMark = { phase: number; amt: number; style: GaitStyle | null; swing: Float32Array; snap: Float32Array; fresh: boolean };
const walkMarks = new WeakMap<Float32Array, WalkMark>();

/**
 * Arms and legs swinging in a walk cycle (`phase` radians, `amt` 0..1). Adds onto what's there.
 * On a VRM body this becomes a real motion-capture walk / run (picked from how fast `phase`
 * advances) or `style`, in step with `phase`.
 */
export function addWalk(o: Float32Array, phase: number, amt: number, style?: GaitStyle) {
  let m = walkMarks.get(o);
  if (!m) walkMarks.set(o, (m = { phase: 0, amt: 0, style: null, swing: new Float32Array(WALK_CH.length), snap: new Float32Array(WALK_CH.length), fresh: false }));
  walkSwing(phase, amt, m.swing);
  for (let j = 0; j < WALK_CH.length; j++) {
    o[WALK_CH[j]] += m.swing[j];
    m.snap[j] = o[WALK_CH[j]];
  }
  m.phase = phase;
  m.amt = amt;
  m.style = style ?? null;
  m.fresh = true;
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

/** Which WALK_CH entry decides each mocap bone's weight (−1 = the whole gait; −2 = both thighs). */
const GAIT_OWNER: Partial<Record<VRMHumanBoneName, number>> = {
  hips: -2,
  rightUpperLeg: 0,
  leftUpperLeg: 1,
  rightLowerLeg: 2,
  rightFoot: 2,
  rightToes: 2,
  leftLowerLeg: 3,
  leftFoot: 3,
  leftToes: 3,
  rightShoulder: 4,
  rightUpperArm: 4,
  leftShoulder: 5,
  leftUpperArm: 5,
  rightLowerArm: 6,
  rightHand: 6,
  leftLowerArm: 7,
  leftHand: 7,
};
/** Bones the game's channels pose too: the mocap rotation is layered under the channel's own. */
const BODY_BONES = new Set<VRMHumanBoneName>(BONES);
const LAYERED = new Set<VRMHumanBoneName>(["spine", "chest", "neck", "head"]);

/** Per model: the normalized gait bones, their parents and the leg length (unscaled, for the hips' bob). */
type GaitRig = { nodes: (THREE.Object3D | null)[]; parents: number[]; ofBody: Int8Array; hips: number; legLen: number };
function gaitRig(vrm: VRM, g: GaitData): GaitRig {
  const node = (b: VRMHumanBoneName) => vrm.humanoid.getNormalizedBoneNode(b);
  const nodes = g.bones.map(node);
  const y = (b: VRMHumanBoneName) => node(b)?.getWorldPosition(new THREE.Vector3()).y ?? 0;
  return {
    nodes,
    parents: gaitParents(g.bones, (b) => !!node(b)),
    ofBody: Int8Array.from(BONES, (b) => g.bones.indexOf(b)),
    hips: g.bones.indexOf("hips"),
    legLen: Math.max(0.2, y("hips") - y("leftFoot")),
  };
}

/** Per body: where in the stride it is, how much of each style, and each bone's mocap weight. */
type GaitState = { phase: number; rate: number; mix: Float32Array; boneW: Float32Array; D: THREE.Quaternion[]; local: THREE.Quaternion[]; hips: { x: number; y: number }; on: boolean };
const gQ = new THREE.Quaternion();
const gE = new THREE.Euler();
const ID = new THREE.Quaternion();
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

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
  const gait = useRef<GaitState | null>(null);
  const rig = useRef<{ of: VRM; rig: GaitRig } | null>(null);

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
    const walk = walkMarks.get(s.want);
    if (walk) walk.fresh = false;
    p.pose(s.want, t, dt);

    // motion capture: take addWalk's procedural swing back out of the joints the caller left
    // alone and play the real cycle there instead, blended in and out per joint
    const gd = vrm ? getGait() : null;
    const gs = gd ? (gait.current ??= { phase: 0, rate: 0, mix: new Float32Array(GAIT_STYLES.length), boneW: new Float32Array(gd.bones.length), D: gd.bones.map(() => new THREE.Quaternion()), local: gd.bones.map(() => new THREE.Quaternion()), hips: { x: 0, y: 0 }, on: false }) : null;
    let ownedMask = 0;
    let gaitAmt = 0;
    if (gs && walk?.fresh) {
      for (let j = 0; j < WALK_CH.length; j++)
        if (s.want[WALK_CH[j]] === walk.snap[j]) {
          s.want[WALK_CH[j]] -= walk.swing[j];
          ownedMask |= 1 << j;
        }
      const step = walk.phase - gs.phase;
      if (dt > 0 && Math.abs(step) < 3) gs.rate += (step / dt - gs.rate) * (1 - Math.exp(-dt * 6));
      gs.phase = walk.phase;
      gaitAmt = Math.max(0, Math.min(1, walk.amt));
      // style: the caller's, else walk → run by how fast the stride turns over
      const run = smoothstep(9, 12.5, Math.abs(gs.rate));
      const kMix = 1 - Math.exp(-dt * 5);
      for (let k = 0; k < GAIT_STYLES.length; k++) {
        const st = GAIT_STYLES[k];
        const want = walk.style ? (st === walk.style ? 1 : 0) : st === "run" ? run : st === "walk" ? 1 - run : 0;
        gs.mix[k] += (want - gs.mix[k]) * kMix;
      }
    } else if (gs) gs.phase += gs.rate * dt; // keep stepping while it blends out

    if (s.first) {
      s.cur.set(s.want);
      s.first = false;
    } else {
      const k = 1 - Math.exp(-dt * (p.follow ?? 14));
      for (let i = 0; i < BODY_CHANNELS; i++) s.cur[i] += (s.want[i] - s.cur[i]) * k;
    }
    if (bodyRef.current) {
      bodyRef.current.position.y = -s.cur[BODY_DROP] * p.headY;
      bodyRef.current.position.x = 0;
    }
    if (!vrm) return;
    const vrm0 = vrm.meta.metaVersion === "0";

    let gaitOn = false;
    let gr: GaitRig | null = null;
    if (gd && gs) {
      if (rig.current?.of !== vrm) rig.current = { of: vrm, rig: gaitRig(vrm, gd) };
      gr = rig.current.rig;
      const kW = 1 - Math.exp(-dt * 10);
      for (let b = 0; b < gd.bones.length; b++) {
        const own = GAIT_OWNER[gd.bones[b]];
        const mine = own === undefined || own === -1 ? true : own === -2 ? (ownedMask & 3) === 3 : (ownedMask >> own) & 1;
        gs.boneW[b] += ((mine ? gaitAmt : 0) - gs.boneW[b]) * kW;
        if (gs.boneW[b] > 0.002) gaitOn = true;
      }
      if (gaitOn) {
        sampleGait(gd, gs.mix, cycleAt(gs.phase), gs.D, gs.hips);
        for (let b = 0; b < gd.bones.length; b++) gaitLocal(gs.D, gr.parents, b, gs.local[b]);
        const hipsW = gr.hips >= 0 ? gs.boneW[gr.hips] : 0;
        if (bodyRef.current && fit) {
          const leg = gr.legLen * fit * hipsW;
          bodyRef.current.position.y += gs.hips.y * leg;
          bodyRef.current.position.x = gs.hips.x * leg;
        }
      }
    }

    for (let i = 0; i < BONES.length; i++) {
      const bone = BONES[i];
      const node = vrm.humanoid.getNormalizedBoneNode(bone);
      if (!node) continue;
      const x = s.cur[i * 3], y = s.cur[i * 3 + 1], z = s.cur[i * 3 + 2];
      if (bone === "rightUpperArm" || bone === "leftUpperArm") upperArmQuat(bone[0] === "r" ? "r" : "l", x, y, z, fQ);
      else if (bone === "rightLowerArm" || bone === "leftLowerArm") armJointQuat(bone[0] === "r" ? "r" : "l", x, z, fQ);
      else fQ.setFromEuler(fE.set(x, y, z));
      const b = gr ? gr.ofBody[i] : -1;
      if (gaitOn && gs && b >= 0 && gs.boneW[b] > 0.002) {
        if (LAYERED.has(bone)) {
          // the game's lean / look on top of the captured spine and head motion
          fQ.premultiply(gQ.copy(ID).slerp(gs.local[b], gs.boneW[b]));
        } else {
          // swung limbs: the caller's resting offsets (arms held out on the ice…) on top of the capture
          const base = bone === "rightUpperArm" || bone === "leftUpperArm" ? gE.set(x, y, z) : gE.set(0, 0, 0);
          gQ.setFromEuler(base).multiply(gs.local[b]);
          fQ.slerp(gQ, gs.boneW[b]);
        }
      }
      node.quaternion.copy(vrm0 ? toVrm0(fQ) : fQ);
    }
    // the joints only the capture moves (hips, shoulders, hands, feet, toes); back to rest once it's off
    if (gd && gs && gr && (gaitOn || gs.on)) {
      for (let b = 0; b < gd.bones.length; b++) {
        const node = gr.nodes[b];
        if (!node || BODY_BONES.has(gd.bones[b])) continue;
        gQ.copy(ID);
        if (gaitOn) gQ.slerp(gs.local[b], gs.boneW[b]);
        node.quaternion.copy(vrm0 ? toVrm0(gQ) : gQ);
      }
    }
    if (gs) gs.on = gaitOn;
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
