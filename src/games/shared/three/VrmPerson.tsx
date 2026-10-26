"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM, type VRMHumanBoneName } from "@pixiv/three-vrm";
import type { VrmModel } from "@/lib/character/avatar";
import SeatedPerson, { blinking, FACES, Hat, holdPose, holdsInMood, STRONG_MOODS, TABLE_POSES, type PersonLook, type PersonMood, type SeatedPersonProps } from "./SeatedPerson";
import { createMotion, HANDS, stepMotion, type MotionState } from "./motion";
import { PERSONA_STYLE, personaGaze } from "./persona";
import { armJointQuat, fingerCurl, toVrm0, upperArmQuat } from "./vrmPose";

/**
 * A seated VRM avatar (VRoid style) behind the same props as `SeatedPerson`,
 * so TableScene and the tables that place people themselves can swap rigs
 * without touching any game. Body language comes from the same motion.ts
 * springs (mapped onto the humanoid bones in vrmPose.ts), faces from the same
 * FACES table (mapped onto VRM preset expressions).
 *
 * - The cartoon rig stands in while the model downloads, and for good if it fails.
 * - Every seat parses its own copy (bones/expressions are per instance), but
 *   textures are shared per model so a full table uploads each image once.
 * - Look → model: men get Seed-san, women alternate between the two pixiv
 *   samples; hair / outfit / skin colours are tinted from the PersonLook.
 *
 * Models live in public/models/vrm (licences in CREDITS.md).
 * Local frame: +z faces the table, origin = the chair's floor point.
 */

type ModelKey = VrmModel;

/** Per model: meshes to hide (props that don't belong at a card table) and which materials are skin / top. */
const MODELS: Record<ModelKey, { hide: string[]; skin: string[]; tops: string[] }> = {
  "pixiv-sample": { hide: [], skin: ["skin"], tops: ["tops"] },
  "three-vrm-girl": { hide: [], skin: ["body", "face"], tops: ["tops"] },
  "seed-san": { hide: ["robo_arm"], skin: ["body_bake"], tops: ["huku_bake"] },
};

function modelFor(look: PersonLook, seed: number): ModelKey {
  if (look.model) return look.model;
  if (look.gender === "m") return "seed-san";
  return seed % 2 === 0 ? "pixiv-sample" : "three-vrm-girl";
}

/** Seated head height of the cartoon rig — TableScene's gaze and label maths assume about this. */
const HEAD_Y = 1.42;
/** Where name tags sit above a VRM seat (lower than the big-headed cartoon's 2.18). */
export const VRM_NAME_Y = 1.95;

const files: Partial<Record<ModelKey, Promise<ArrayBuffer>>> = {};
const TEXTURE_KEYS = ["map", "normalMap", "emissiveMap", "shadeMultiplyTexture", "shadingShiftTexture", "matcapTexture", "rimMultiplyTexture", "outlineWidthMultiplyTexture", "uvAnimationMaskTexture", "roughnessMap", "metalnessMap", "aoMap"] as const;
/** The first parsed copy's textures per model, in material traversal order. */
const shared: Partial<Record<ModelKey, Record<string, THREE.Texture>[]>> = {};

function materialsOf(root: THREE.Object3D): THREE.Material[] {
  const out: THREE.Material[] = [];
  root.traverse((o) => {
    const mm = (o as THREE.Mesh).material;
    for (const m of Array.isArray(mm) ? mm : mm ? [mm] : []) if (!out.includes(m)) out.push(m);
  });
  return out;
}

/**
 * A hair texture as bright grey with its strand detail kept (luminance rescaled to a
 * fixed mean), so the hair colour tinted on top reads the same on every model —
 * multiplying a colour over the near-black hair of two of the models stays black.
 */
function liftToGrey(tex: THREE.Texture): THREE.Texture {
  const img = tex.image as CanvasImageSource & { width: number; height: number };
  if (!img?.width) return tex;
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return tex;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 16) continue;
    sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    n++;
  }
  const mean = n ? sum / n : 128;
  // compress the range a little so near-black strands don't vanish, then centre it bright
  for (let i = 0; i < px.length; i += 4) {
    const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    px[i] = px[i + 1] = px[i + 2] = Math.max(0, Math.min(255, 205 + (l - mean) * 0.9));
  }
  ctx.putImageData(data, 0, 0);
  const out = new THREE.CanvasTexture(canvas);
  out.flipY = tex.flipY;
  out.colorSpace = tex.colorSpace;
  out.wrapS = tex.wrapS;
  out.wrapT = tex.wrapT;
  out.magFilter = tex.magFilter;
  out.minFilter = tex.minFilter;
  out.channel = tex.channel;
  out.offset.copy(tex.offset);
  out.repeat.copy(tex.repeat);
  out.rotation = tex.rotation;
  out.center.copy(tex.center);
  return out;
}

function shareTextures(key: ModelKey, vrm: VRM) {
  const mats = materialsOf(vrm.scene) as unknown as Record<string, THREE.Texture | undefined>[];
  const base = shared[key];
  if (!base) {
    // first copy of this model: neutralise the hair textures once; every later copy shares them
    const lifted = new Map<THREE.Texture, THREE.Texture>();
    for (const m of mats) {
      if (!(m as unknown as THREE.Material).name.toLowerCase().includes("hair")) continue;
      for (const k of ["map", "shadeMultiplyTexture"] as const) {
        const t = m[k];
        if (!t?.isTexture) continue;
        if (!lifted.has(t)) lifted.set(t, liftToGrey(t));
        m[k] = lifted.get(t);
      }
    }
    shared[key] = mats.map((m) => Object.fromEntries(TEXTURE_KEYS.filter((k) => m[k]?.isTexture).map((k) => [k, m[k]!])));
    return;
  }
  mats.forEach((m, i) => {
    for (const k of TEXTURE_KEYS) {
      const mine = m[k];
      const theirs = base[i]?.[k];
      if (!mine?.isTexture || !theirs || mine === theirs) continue;
      m[k] = theirs;
      (mine.image as ImageBitmap | undefined)?.close?.();
      mine.dispose();
    }
  });
}

/**
 * Parsing a VRM blocks the main thread for a while; a full table mounting at once
 * would stack those into one long freeze, so seats parse one at a time with a
 * frame in between.
 */
let parseQueue: Promise<unknown> = Promise.resolve();
function loadVrm(key: ModelKey): Promise<VRM> {
  const job = parseQueue.then(() => parseVrm(key));
  parseQueue = job.catch(() => undefined).then(() => new Promise((r) => requestAnimationFrame(() => r(undefined))));
  return job;
}

async function parseVrm(key: ModelKey): Promise<VRM> {
  files[key] ??= fetch(`/models/vrm/${key}.vrm`).then((r) => {
    if (!r.ok) throw new Error(`${key}.vrm: ${r.status}`);
    return r.arrayBuffer();
  });
  const buf = await files[key]!;
  const loader = new GLTFLoader();
  loader.register((p) => new VRMLoaderPlugin(p));
  const gltf = await loader.parseAsync(buf.slice(0), "");
  const vrm = gltf.userData.vrm as VRM;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.rotateVRM0(vrm);
  vrm.scene.traverse((o) => {
    // skinned bounds don't follow the seated pose; no shadow-map pass either (a second
    // skinned render per seat) — TableScene's blob shadow grounds the seat instead
    o.frustumCulled = false;
    if (MODELS[key].hide.includes(o.name)) o.visible = false;
  });
  shareTextures(key, vrm);
  for (const m of materialsOf(vrm.scene)) memoProgramKey(m);
  return vrm;
}

/**
 * three.js re-derives every material's program key whenever the light state differs
 * between render passes — each frame here. MToon's key is a serialised define list,
 * so cache it until the material itself changes (`needsUpdate` bumps `version`).
 */
function memoProgramKey(m: THREE.Material) {
  const own = m.customProgramCacheKey;
  if (own === THREE.Material.prototype.customProgramCacheKey) return;
  let version = -1;
  let key = "";
  m.customProgramCacheKey = () => {
    if (m.version !== version) {
      version = m.version;
      key = own.call(m);
    }
    return key;
  };
}

/** Geometry and materials are per seat; textures are shared, so they stay. */
function release(vrm: VRM) {
  vrm.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
  });
}

type Tintable = THREE.Material & { color?: THREE.Color; shadeColorFactor?: THREE.Color };
const GREY = new THREE.Color("#57534e");
const WHITE = new THREE.Color("#ffffff");

/** Hair / top / skin colours from the look (multiplied over the textures); greyed out when eliminated. */
function tint(vrm: VRM, key: ModelKey, look: PersonLook, out: boolean) {
  const M = MODELS[key];
  for (const m of materialsOf(vrm.scene) as Tintable[]) {
    if (!m.color) continue;
    const n = m.name.toLowerCase();
    const ud = m.userData as { base?: THREE.Color; shade?: THREE.Color };
    ud.base ??= m.color.clone();
    if (m.shadeColorFactor) ud.shade ??= m.shadeColorFactor.clone();
    const skin = M.skin.some((k) => (k.length > 4 ? n.includes(k) : n === k));
    const hex = n.includes("hair") ? look.hair : M.tops.some((k) => n.includes(k)) ? look.coat : skin ? look.skin : null;
    const c = hex ? new THREE.Color(hex) : ud.base.clone();
    if (skin) c.lerp(WHITE, 0.55);
    if (out) c.lerp(GREY, 0.55);
    m.color.copy(c);
    if (m.shadeColorFactor) m.shadeColorFactor.copy(hex ? new THREE.Color(hex).multiplyScalar(0.7) : ud.shade!).lerp(GREY, out ? 0.55 : 0);
  }
}

const FINGERS = ["Index", "Middle", "Ring", "Little"] as const;
/** Per-frame scratch (useFrame runs for every seat, every frame — allocating here means GC hitches). */
const fQ = new THREE.Quaternion();
const fE = new THREE.Euler();
const JOINTS = ["Proximal", "Intermediate", "Distal"] as const;
/** Bone names per side, built once (template strings in the frame loop are garbage too). */
const SIDE = {
  l: {
    upper: "leftUpperArm",
    lower: "leftLowerArm",
    hand: "leftHand",
    thumb: "leftThumbProximal",
    fingers: FINGERS.flatMap((f) => JOINTS.map((j) => [`left${f}${j}` as VRMHumanBoneName, j] as const)),
  },
  r: {
    upper: "rightUpperArm",
    lower: "rightLowerArm",
    hand: "rightHand",
    thumb: "rightThumbProximal",
    fingers: FINGERS.flatMap((f) => JOINTS.map((j) => [`right${f}${j}` as VRMHumanBoneName, j] as const)),
  },
} as const;
const LEGS = [
  ["leftUpperLeg", "leftLowerLeg", -0.06],
  ["rightUpperLeg", "rightLowerLeg", 0.06],
] as const;
const tmpGaze = new THREE.Vector3();
const hash = (a: number, b: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};
/**
 * The cartoon's table-rest pose leans the long VRM arms halfway across the felt;
 * resting shoulders swing in a little less and the elbows bend a little more.
 */
const TUCK = { shoulder: 0.32, elbow: -0.45 };
/**
 * Raised-arm moods splay the cartoon's short arms inward above its big head; on adult
 * proportions they'd cross over the scalp, so those shoulders open outward instead
 * (pose channels 8 = left shoulder z, 12 = right shoulder z).
 */
const VRM_POSES: Record<PersonMood, number[]> = (() => {
  const out = Object.fromEntries(Object.entries(TABLE_POSES).map(([k, v]) => [k, [...v]])) as Record<PersonMood, number[]>;
  out.cheer[8] = 0.3;
  out.cheer[12] = -0.3;
  out.raise[12] = -0.18;
  // hands-to-cheeks: keep the gesture but frame the face instead of covering it
  out.shock[8] = 0.5;
  out.shock[12] = -0.5;
  return out;
})();

/**
 * Self-collision in the model's own (unscaled) units: a head sphere and a torso capsule.
 * Hands and forearms that end up inside them — any mood, gesture or idle drift — are
 * pushed out by turning the upper arm, the way a person moves the whole arm.
 */
const BODY_COLLIDERS = { headR: 0.13, headUp: 0.08, torsoR: 0.125, handR: 0.035 };
const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const tC = new THREE.Vector3();
const tN = new THREE.Vector3();
const tAxis = new THREE.Vector3();
const tQ = new THREE.Quaternion();
const tParent = new THREE.Quaternion();
const tParentInv = new THREE.Quaternion();
const cHead = new THREE.Vector3();
const cT0 = new THREE.Vector3();
const cT1 = new THREE.Vector3();
const cHand = new THREE.Vector3();
const cFore = new THREE.Vector3();
const cTip = new THREE.Vector3();
const cNormal = new THREE.Vector3();
const cPoints = [cHand, cTip, cFore];

/** Deepest penetration of point `p` (radius `pr`) into the head sphere / torso capsule; writes the outward normal to `n`. */
function penetration(p: THREE.Vector3, pr: number, head: THREE.Vector3, headR: number, t0: THREE.Vector3, t1: THREE.Vector3, torsoR: number, n: THREE.Vector3): number {
  let best = 0;
  const dHead = p.distanceTo(head);
  if (headR + pr - dHead > best) {
    best = headR + pr - dHead;
    n.subVectors(p, head).normalize();
  }
  // closest point on the spine segment
  tC.subVectors(t1, t0);
  const k = Math.max(0, Math.min(1, tC.dot(tB.subVectors(p, t0)) / tC.lengthSq()));
  tC.multiplyScalar(k).add(t0);
  const dTorso = p.distanceTo(tC);
  if (torsoR + pr - dTorso > best) {
    best = torsoR + pr - dTorso;
    n.subVectors(p, tC).normalize();
  }
  return best;
}

type Chains = { torso: THREE.Object3D[]; head: THREE.Object3D; hips: THREE.Object3D; top: THREE.Object3D; arms: { upper: THREE.Object3D; lower: THREE.Object3D; hand: THREE.Object3D; chain: THREE.Object3D[]; tip: number }[] };
const chainCache = new WeakMap<VRM, Chains | null>();

/** The normalized bones the collision pass reads, root-first so a parent is always refreshed before its child. */
function chainsOf(vrm: VRM): Chains | null {
  if (chainCache.has(vrm)) return chainCache.get(vrm)!;
  const node = (b: VRMHumanBoneName) => vrm.humanoid.getNormalizedBoneNode(b);
  const torso = (["hips", "spine", "chest", "upperChest", "neck", "head"] as const).map(node).filter((n): n is THREE.Object3D => !!n);
  const head = node("head"), hips = node("hips"), top = node("upperChest") ?? node("chest");
  const flip = vrm.meta.metaVersion === "0" ? -1 : 1;
  const arms = (["left", "right"] as const).flatMap((side) => {
    const upper = node(`${side}UpperArm`), lower = node(`${side}LowerArm`), hand = node(`${side}Hand`);
    if (!upper || !lower || !hand) return [];
    const chain = [node(`${side}Shoulder`), upper, lower, hand].filter((n): n is THREE.Object3D => !!n);
    return [{ upper, lower, hand, chain, tip: (side === "left" ? 1 : -1) * 0.07 * flip }];
  });
  const out = head && hips && top ? { torso, head, hips, top, arms } : null;
  chainCache.set(vrm, out);
  return out;
}

/**
 * Recompute world matrices down a parent→child chain only. (getWorldPosition & co. walk
 * every ancestor up to the scene root on each call — far too slow per seat per frame.)
 * The VRM's own ancestors keep last frame's matrices, which is fine: the seat doesn't move.
 */
function refresh(chain: THREE.Object3D[]) {
  for (const n of chain) {
    n.updateMatrix();
    n.matrixWorld.multiplyMatrices(n.parent!.matrixWorld, n.matrix);
  }
}

const tScale = new THREE.Vector3();

function resolveArmCollisions(vrm: VRM, scale: number) {
  const c = chainsOf(vrm);
  if (!c) return;
  refresh(c.torso);
  const head = cHead.set(0, BODY_COLLIDERS.headUp, 0).applyMatrix4(c.head.matrixWorld);
  const t0 = cT0.setFromMatrixPosition(c.hips.matrixWorld);
  const t1 = cT1.setFromMatrixPosition(c.top.matrixWorld);
  const headR = BODY_COLLIDERS.headR * scale, torsoR = BODY_COLLIDERS.torsoR * scale, pr = BODY_COLLIDERS.handR * scale;
  for (const arm of c.arms) {
    refresh(arm.chain);
    for (let it = 0; it < 4; it++) {
      const shoulder = tA.setFromMatrixPosition(arm.upper.matrixWorld);
      const pHand = cHand.setFromMatrixPosition(arm.hand.matrixWorld);
      cFore.setFromMatrixPosition(arm.lower.matrixWorld).lerp(pHand, 0.5);
      cTip.set(arm.tip, 0, 0).applyMatrix4(arm.hand.matrixWorld);
      let worst = 0;
      let at: THREE.Vector3 | null = null;
      const n = cNormal;
      for (const p of cPoints) {
        const d = penetration(p, pr, head, headR, t0, t1, torsoR, tN);
        if (d > worst) {
          worst = d;
          at = p;
          n.copy(tN);
        }
      }
      if (!at) break;
      const lever = tB.subVectors(at, shoulder);
      const len = lever.length();
      tAxis.crossVectors(lever, n);
      if (tAxis.lengthSq() < 1e-8) tAxis.set(0, 1, 0);
      tAxis.normalize();
      // rotate the upper arm in world space by just enough to clear, then back into its parent's frame
      tQ.setFromAxisAngle(tAxis, (worst + 0.004 * scale) / len);
      arm.upper.parent!.matrixWorld.decompose(tC, tParent, tScale);
      arm.upper.quaternion.premultiply(tParentInv.copy(tParent).invert().multiply(tQ).multiply(tParent));
      refresh(arm.chain);
    }
  }
}

export interface VrmPersonProps extends SeatedPersonProps {
  /** Called once the VRM has replaced the cartoon stand-in (e.g. to take a portrait). */
  onReady?: () => void;
}

export default function VrmPerson(props: VrmPersonProps) {
  const { look, position, facing, seed } = props;
  const key = modelFor(look, seed);
  const [vrm, setVrm] = useState<VRM | null>(null);
  useEffect(() => {
    let alive = true;
    let got: VRM | null = null;
    loadVrm(key).then(
      (v) => {
        got = v;
        if (alive) setVrm(v);
        else release(v);
      },
      (err) => console.warn("VRM load failed — keeping the cartoon rig", err),
    );
    return () => {
      alive = false;
      setVrm(null);
      if (got) release(got);
    };
  }, [key]);
  useEffect(() => {
    if (vrm) tint(vrm, key, look, !!props.out);
  }, [vrm, key, look, props.out]);
  const { onReady } = props;
  useEffect(() => {
    if (vrm) onReady?.();
  }, [vrm, onReady]);
  // low-spec devices skip MToon's outline pass (it draws every mesh a second time)
  useEffect(() => {
    if (!vrm) return;
    for (const m of materialsOf(vrm.scene)) if ((m as { isOutline?: boolean }).isOutline) m.visible = !props.lowDetail;
  }, [vrm, props.lowDetail]);

  // fit: thighs level on the seat, head at the cartoon rig's height
  const fit = useMemo(() => {
    if (!vrm) return null;
    const y = (b: VRMHumanBoneName) => vrm.humanoid.getNormalizedBoneNode(b)!.getWorldPosition(new THREE.Vector3()).y;
    const hips = y("hips"), knee = y("leftLowerLeg"), head = y("head");
    const scale = HEAD_Y / (knee + head - hips);
    return { scale, lift: (knee - hips) * scale, seatY: knee * scale };
  }, [vrm]);

  const heldRef = useRef<THREE.Group>(null);
  const springDt = useRef(0);
  const cur = useRef<{ m: MotionState; look: [number, number] } | null>(null);
  useFrame(({ clock }, dt) => {
    if (!vrm || !fit) return;
    const now = clock.elapsedTime;
    cur.current ??= { m: createMotion(TABLE_POSES.rest, HANDS.rest), look: [0, 0] };
    const c = cur.current;
    const ps = PERSONA_STYLE[props.persona ?? "focused"];
    let mood: PersonMood = props.out ? "slump" : props.mood;
    // same idle fidgets as SeatedPerson
    if (mood === "rest") {
      const slot = Math.floor((now + seed * 2.3) / 7);
      if ((now + seed * 2.3) % 7 < 2.2) {
        const r = hash(seed, slot);
        if (r < ps.fidget * 0.7) mood = "think";
        else if (r < ps.fidget) mood = props.persona === "shy" ? "nervous" : "shrug";
      }
    }
    const holding = !!props.held;
    const pose = holding ? holdPose(VRM_POSES[mood], mood) : VRM_POSES[mood];
    const p = stepMotion(c.m, mood, pose, now, dt, seed);
    if (heldRef.current) heldRef.current.visible = holdsInMood(mood);

    const vrm0 = vrm.meta.metaVersion === "0";
    const set = (b: VRMHumanBoneName, quat: THREE.Quaternion) => {
      const n = vrm.humanoid.getNormalizedBoneNode(b);
      if (n) n.quaternion.copy(vrm0 ? toVrm0(quat) : quat);
    };
    const eul = (b: VRMHumanBoneName, x: number, y: number, z: number) => set(b, fQ.setFromEuler(fE.set(x, y, z)));

    for (const [upperLeg, lowerLeg, splay] of LEGS) {
      eul(upperLeg, -Math.PI / 2, 0, splay);
      eul(lowerLeg, Math.PI / 2, 0, 0);
    }
    eul("spine", p[0] * 0.6, p[1] * 0.6, p[2] * 0.6);
    eul("chest", p[0] * 0.4, p[1] * 0.4, p[2] * 0.4);

    // gaze: the game's cue, or wherever this temperament drifts (as SeatedPerson)
    let yaw = 0;
    let pitch = 0;
    const gaze = props.out ? { kind: "cue" as const } : personaGaze(props.persona ?? "focused", now, seed, STRONG_MOODS.has(mood) || !props.persona);
    let la = props.lookAt ?? null;
    if (gaze.kind === "viewer" && props.viewerAt) la = props.viewerAt;
    else if (gaze.kind === "down") la = tmpGaze.set(position.x + Math.sin(facing) * 0.75, 0.93, position.z + Math.cos(facing) * 0.75);
    else if (gaze.kind === "away") la = null;
    if (la && !props.out) {
      const dx = la.x - position.x;
      const dz = la.z - position.z;
      const lx = dx * Math.cos(facing) - dz * Math.sin(facing);
      const lz = dx * Math.sin(facing) + dz * Math.cos(facing);
      const my = props.maxYaw ?? 1.0;
      yaw = Math.max(-my, Math.min(my, Math.atan2(lx, Math.max(0.05, lz))));
      pitch = Math.max(-0.4, Math.min(0.5, Math.atan2(1.45 - la.y, Math.max(0.3, Math.hypot(dx, dz))) * 0.7));
    }
    if (gaze.kind === "away") {
      yaw = gaze.yaw;
      pitch = gaze.pitch;
    }
    pitch += ps.pitch;
    c.look[0] += (yaw - c.look[0]) * (1 - Math.exp(-dt * ps.turn));
    c.look[1] += (pitch - c.look[1]) * (1 - Math.exp(-dt * ps.turn));
    const drift = (la ? 0.35 : 1) * ps.drift;
    const hx = p[3] + c.look[1], hy = p[4] * drift + c.look[0], hz = p[5];
    eul("neck", hx * 0.3, hy * 0.3, hz * 0.3);
    eul("head", hx * 0.7, hy * 0.7, hz * 0.7);

    // arms: resting tables tuck the long arms in; gestures and held cards keep the shared angles
    const tuck = !holding && (mood === "rest" || mood === "think" || mood === "write" || mood === "nervous" || mood === "smug" || mood === "sad") ? 1 : 0;
    const arm = (s: "l" | "r", o: number, elbow: number, wx: number, wz: number, curl: number, yawAdd: number) => {
      const b = SIDE[s];
      set(b.upper, upperArmQuat(s, p[o] + TUCK.shoulder * tuck, p[o + 1] + yawAdd, p[o + 2], fQ));
      set(b.lower, armJointQuat(s, elbow + TUCK.elbow * tuck, 0, fQ));
      set(b.hand, armJointQuat(s, wx, wz, fQ));
      for (const [name, j] of b.fingers) eul(name, 0, 0, fingerCurl(s, curl, j));
      eul(b.thumb, 0, (s === "l" ? 1 : -1) * curl * 0.5, 0);
    };
    arm("l", 6, p[9], p[14], p[15], p[18], 0);
    arm("r", 10, p[13], p[16], p[17], p[19], mood === "point" ? c.look[0] * 0.9 : 0);

    resolveArmCollisions(vrm, fit.scale);

    // face: the FACES table → VRM preset expressions
    const f = FACES[mood];
    const em = vrm.expressionManager;
    if (em) {
      const grin = f.mouth === "grin" ? 1 : f.mouth === "smile" ? 0.55 : 0;
      em.setValue("happy", grin);
      em.setValue("sad", f.mouth === "frown" ? 0.75 : 0);
      em.setValue("surprised", f.eye > 1.3 ? 1 : 0);
      em.setValue("angry", f.brow < -0.5 ? 0.6 : 0);
      em.setValue("aa", mood === "talk" ? 0.25 + Math.abs(Math.sin(now * 11)) * 0.45 : f.mouth === "o" && f.eye <= 1.3 ? 0.35 : 0);
      em.setValue("blink", grin > 0.9 ? 0 : f.eye < 0.3 ? 1 : blinking(now, seed) ? 1 : 0);
    }
    // VRM.update, unrolled so the hair/cloth springs can run at 30 Hz (off on low-spec
    // devices) — they cost more than the rest of the rig, and the eye can't tell
    vrm.humanoid.update();
    vrm.lookAt?.update(dt);
    vrm.expressionManager?.update();
    vrm.nodeConstraintManager?.update();
    if (!props.lowDetail) {
      springDt.current += dt;
      if (springDt.current >= 1 / 30) {
        vrm.springBoneManager?.update(springDt.current);
        springDt.current = 0;
      }
    }
    vrm.materials?.forEach((m) => (m as { update?: (d: number) => void }).update?.(dt));
  });

  if (!vrm || !fit) return <SeatedPerson {...props} />;
  const head = vrm.humanoid.getNormalizedBoneNode("head");
  const chairH = fit.seatY;
  const wood = <meshStandardMaterial color={props.chairColor ?? "#6b4423"} roughness={0.7} />;
  return (
    <group position={position} rotation-y={facing}>
      {props.chair !== "none" && (
        <group>
          <mesh position={[0, chairH - 0.03, -0.05]} castShadow receiveShadow>
            <boxGeometry args={[0.5, 0.05, 0.48]} />
            {wood}
          </mesh>
          {props.chair !== "stool" && (
            <mesh position={[0, chairH + 0.38, -0.28]} castShadow>
              <boxGeometry args={[0.48, 0.72, 0.05]} />
              {wood}
            </mesh>
          )}
          {[-0.21, 0.21].flatMap((x) =>
            [-0.25, 0.17].map((z) => (
              <mesh key={`${x}${z}`} position={[x, (chairH - 0.05) / 2, z]}>
                <boxGeometry args={[0.04, chairH - 0.05, 0.04]} />
                {wood}
              </mesh>
            )),
          )}
        </group>
      )}
      <group position={[0, fit.lift, -0.05]} scale={fit.scale}>
        <primitive object={vrm.scene} />
      </group>
      {/* a held hand of cards, gripped in front of the chest (as SeatedPerson's hold point) */}
      {props.held && (
        <group ref={heldRef} position={[0, 1.07, 0.46]} rotation-y={Math.PI} scale={0.85}>
          {props.held}
        </group>
      )}
      {head &&
        createPortal(
          // the head bone sits at the skull base; the cartoon head's centre (hat / headSlot origin) is ~0.1 above
          <group position={[0, 0.1, 0]} rotation-y={vrm.meta.metaVersion === "0" ? Math.PI : 0}>
            <group scale={0.47}>
              <Hat kind={look.hat} color={look.hatColor} seg={props.lowDetail ? 10 : 20} />
            </group>
            {props.headSlot && <group scale={0.55}>{props.headSlot}</group>}
          </group>,
          head,
        )}
      {props.children}
    </group>
  );
}
