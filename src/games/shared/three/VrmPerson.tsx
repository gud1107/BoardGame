"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM, type VRMHumanBoneName } from "@pixiv/three-vrm";
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

type ModelKey = "pixiv-sample" | "three-vrm-girl" | "seed-san";

/** Per model: meshes to hide (props that don't belong at a card table) and which materials are skin / top. */
const MODELS: Record<ModelKey, { hide: string[]; skin: string[]; tops: string[] }> = {
  "pixiv-sample": { hide: [], skin: ["skin"], tops: ["tops"] },
  "three-vrm-girl": { hide: [], skin: ["body", "face"], tops: ["tops"] },
  "seed-san": { hide: ["robo_arm"], skin: ["body_bake"], tops: ["huku_bake"] },
};

function modelFor(look: PersonLook, seed: number): ModelKey {
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

function shareTextures(key: ModelKey, vrm: VRM) {
  const mats = materialsOf(vrm.scene) as unknown as Record<string, THREE.Texture | undefined>[];
  const base = shared[key];
  if (!base) {
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

async function loadVrm(key: ModelKey): Promise<VRM> {
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
    // skinned bounds don't follow the seated pose
    o.frustumCulled = false;
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    if (MODELS[key].hide.includes(o.name)) o.visible = false;
  });
  shareTextures(key, vrm);
  return vrm;
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
const JOINTS = ["Proximal", "Intermediate", "Distal"] as const;
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

export default function VrmPerson(props: SeatedPersonProps) {
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

  // fit: thighs level on the seat, head at the cartoon rig's height
  const fit = useMemo(() => {
    if (!vrm) return null;
    const y = (b: VRMHumanBoneName) => vrm.humanoid.getNormalizedBoneNode(b)!.getWorldPosition(new THREE.Vector3()).y;
    const hips = y("hips"), knee = y("leftLowerLeg"), head = y("head");
    const scale = HEAD_Y / (knee + head - hips);
    return { scale, lift: (knee - hips) * scale, seatY: knee * scale };
  }, [vrm]);

  const heldRef = useRef<THREE.Group>(null);
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
    const pose = holding ? holdPose(TABLE_POSES[mood], mood) : TABLE_POSES[mood];
    const p = stepMotion(c.m, mood, pose, now, dt, seed);
    if (heldRef.current) heldRef.current.visible = holdsInMood(mood);

    const vrm0 = vrm.meta.metaVersion === "0";
    const set = (b: VRMHumanBoneName, quat: THREE.Quaternion) => {
      const n = vrm.humanoid.getNormalizedBoneNode(b);
      if (n) n.quaternion.copy(vrm0 ? toVrm0(quat) : quat);
    };
    const eul = (b: VRMHumanBoneName, x: number, y: number, z: number) => set(b, new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)));

    for (const s of ["left", "right"] as const) {
      eul(`${s}UpperLeg`, -Math.PI / 2, 0, s === "left" ? -0.06 : 0.06);
      eul(`${s}LowerLeg`, Math.PI / 2, 0, 0);
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
      const side = s === "l" ? "left" : "right";
      set(`${side}UpperArm`, upperArmQuat(s, p[o] + TUCK.shoulder * tuck, p[o + 1] + yawAdd, p[o + 2]));
      set(`${side}LowerArm`, armJointQuat(s, elbow + TUCK.elbow * tuck, 0));
      set(`${side}Hand`, armJointQuat(s, wx, wz));
      for (const f of FINGERS) for (const j of JOINTS) eul(`${side}${f}${j}`, 0, 0, fingerCurl(s, curl, j));
      eul(`${side}ThumbProximal`, 0, (s === "l" ? 1 : -1) * curl * 0.5, 0);
    };
    arm("l", 6, p[9], p[14], p[15], p[18], 0);
    arm("r", 10, p[13], p[16], p[17], p[19], mood === "point" ? c.look[0] * 0.9 : 0);

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
    vrm.update(dt);
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
