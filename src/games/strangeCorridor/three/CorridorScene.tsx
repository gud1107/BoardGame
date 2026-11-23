"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { AdaptiveResolution } from "@/games/shared/three/sceneFx";
import { resolveLook } from "@/games/shared/three/SeatedPerson";
import VrmBody, { addWalk, setBone, BODY } from "@/games/shared/three/VrmBody";
import { useMyCharacter } from "@/lib/character/myCharacter";
import { emojiTexture, FONTS, paintedTexture } from "@/games/shared/three/tableKit";
import { CORRIDOR_H, CORRIDOR_LEN, CORRIDOR_W, type ShownProp } from "../engine";

/**
 * 이상한 복도 3D (rulebook §7). A long night corridor lit by four
 * fluorescent panels. The player walks it freely — WASD / arrow keys (Shift
 * to hurry) or the on-screen stick — and drags to look around; each new
 * corridor puts them back at the entrance. The default view sits over the
 * shoulder of the player's own profile VRM (like 변신 숨바꼭질); 👁️ switches
 * to first-person eyes. Every prop is tappable — a missing
 * prop leaves an invisible hit box where it used to be. Lint: per-frame
 * camera / light mutation lives in plain functions outside components.
 *
 * World: x across (left wall −W/2), y up, z = −distance down the hall.
 */

export interface CorridorSceneProps {
  props: ShownProp[];
  selectedId: string | null;
  /** Revealed answer (prop id) to outline in red, or null. */
  revealId: string | null;
  /** Changes when a new walk starts — the player goes back to the entrance. */
  resetKey: string;
  /** 0..1 how deep into the game — the hall gets darker and flickers more. */
  dread: number;
  lowDetail: boolean;
  onPick: ((id: string) => void) | null;
  /** Viewer's seat — picks the default look when no profile character is set. */
  seat: number;
}

const W2 = CORRIDOR_W / 2;
const START_Z = 0.6;
const BODY_R = 0.28;
const WALK_SPEED = 1.9;
const RUN_SPEED = 3.4;
/** The wall behind the entrance (a small vestibule so the 3rd-person camera fits behind you). */
const BACK_Z = 2.8;
/** Head-bone height of the player's VRM. */
const HEAD_Y = 1.42;
const CAM_DIST = 2.1;
const CAM_SHOULDER = 0.42;
const CAM_PAD = 0.14;

export type CorridorCam = "third" | "first";
const CAM_KEY = "strange-corridor:cam";

/** Where a prop sits and which way it faces. */
function placement(p: ShownProp): { pos: [number, number, number]; rotY: number; rotX: number } {
  const z = -p.z;
  if (p.side === "L") return { pos: [-W2 + 0.04, p.y, z], rotY: Math.PI / 2, rotX: 0 };
  if (p.side === "R") return { pos: [W2 - 0.04, p.y, z], rotY: -Math.PI / 2, rotX: 0 };
  if (p.side === "E") return { pos: [p.kind === "figure" ? 0.4 : p.kind === "exitSign" ? 0 : 0, p.y, p.kind === "figure" ? z : -CORRIDOR_LEN + 0.04], rotY: 0, rotX: 0 };
  if (p.side === "C") return { pos: [0, p.y, z], rotY: 0, rotX: Math.PI / 2 };
  return { pos: [0.3, 0.006, z], rotY: 0, rotX: -Math.PI / 2 };
}

function Pic({ icon, w, h, z = 0.03 }: { icon: string; w: number; h: number; z?: number }) {
  if (!icon) return null;
  const s = Math.min(w, h);
  return (
    <mesh position={[0, 0, z]}>
      <planeGeometry args={[s, s]} />
      <meshBasicMaterial map={emojiTexture(icon)} transparent toneMapped={false} />
    </mesh>
  );
}

/** Plain painted text (door numbers, poster captions, the exit sign). */
function textTexture(text: string, fg: string) {
  return paintedTexture(`corridor-text:${text}:${fg}`, 256, 64, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = fg;
    ctx.font = `800 40px ${FONTS.text}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, h / 2 + 2, w - 12);
  });
}

function Label({ text, color, w, y = 0, z = 0.04 }: { text: string; color: string; w: number; y?: number; z?: number }) {
  return (
    <mesh position={[0, y, z]}>
      <planeGeometry args={[w, w / 4]} />
      <meshBasicMaterial map={textTexture(text, color)} transparent toneMapped={false} />
    </mesh>
  );
}

/** The prop's body — simple shapes, coloured by `p.color`. */
function Body({ p }: { p: ShownProp }) {
  const c = p.color;
  switch (p.kind) {
    case "door":
      return (
        <group>
          <mesh position={[0, 0, 0.03]}>
            <boxGeometry args={[p.w, p.h, 0.06]} />
            <meshStandardMaterial color={c} roughness={0.7} />
          </mesh>
          <mesh position={[0.36, -0.05, 0.08]}>
            <sphereGeometry args={[0.045, 10, 8]} />
            <meshStandardMaterial color="#d6d3d1" metalness={0.8} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.7, 0.065]}>
            <planeGeometry args={[0.42, 0.16]} />
            <meshStandardMaterial color="#e7e5e4" />
          </mesh>
          {p.label && <Label text={p.label} color="#111" w={0.4} y={0.7} z={0.07} />}
        </group>
      );
    case "painting":
    case "poster":
      return (
        <group>
          <mesh position={[0, 0, 0.02]}>
            <boxGeometry args={[p.w, p.h, 0.04]} />
            <meshStandardMaterial color={c} roughness={0.6} />
          </mesh>
          <Pic icon={p.icon} w={p.w * 0.8} h={p.h * 0.7} z={0.045} />
          {p.label && <Label text={p.label} color="#111" w={p.w * 0.9} y={-p.h * 0.36} z={0.046} />}
        </group>
      );
    case "clock":
      return (
        <group>
          <mesh position={[0, 0, 0.02]} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[p.w / 2, p.w / 2, 0.05, 24]} />
            <meshStandardMaterial color={c} />
          </mesh>
          <Pic icon={p.icon} w={p.w * 0.9} h={p.h * 0.9} z={0.05} />
        </group>
      );
    case "extinguisher":
      return (
        <mesh position={[0, 0, 0.14]}>
          <cylinderGeometry args={[p.w / 2, p.w / 2, p.h, 14]} />
          <meshStandardMaterial color={c} roughness={0.4} />
        </mesh>
      );
    case "plant":
      return (
        <group position={[0, 0, 0.3]}>
          <mesh position={[0, -0.25, 0]}>
            <cylinderGeometry args={[0.18, 0.14, 0.4, 12]} />
            <meshStandardMaterial color="#7c2d12" />
          </mesh>
          <mesh position={[0, 0.15, 0]}>
            <sphereGeometry args={[0.3, 12, 10]} />
            <meshStandardMaterial color={c} roughness={0.9} />
          </mesh>
        </group>
      );
    case "vending":
      return (
        <group position={[0, 0, 0.35]}>
          <mesh>
            <boxGeometry args={[p.w, p.h, 0.7]} />
            <meshStandardMaterial color={c} roughness={0.5} />
          </mesh>
          <mesh position={[-0.1, 0.25, 0.36]}>
            <planeGeometry args={[0.55, 0.9]} />
            <meshStandardMaterial color="#e0f2fe" emissive="#7dd3fc" emissiveIntensity={0.9} />
          </mesh>
          <group position={[-0.1, 0.25, 0.37]}>
            <Pic icon={p.icon} w={0.3} h={0.3} z={0} />
          </group>
        </group>
      );
    case "bench":
      return (
        <mesh position={[0, 0, 0.3]}>
          <boxGeometry args={[p.w, 0.12, 0.45]} />
          <meshStandardMaterial color={c} roughness={0.8} />
        </mesh>
      );
    case "cctv":
      return (
        <group rotation-x={-Math.PI / 2}>
          <mesh position={[0, -0.12, 0]} rotation-x={0.4}>
            <boxGeometry args={[0.16, 0.12, 0.32]} />
            <meshStandardMaterial color={c} />
          </mesh>
          <mesh position={[0, -0.16, 0.17]}>
            <sphereGeometry args={[0.025, 8, 6]} />
            <meshBasicMaterial color="#ef4444" toneMapped={false} />
          </mesh>
        </group>
      );
    case "lamp":
      return (
        <mesh>
          <boxGeometry args={[p.w, p.h, 0.05]} />
          <meshStandardMaterial color={c} emissive={c} emissiveIntensity={1.6} toneMapped={false} />
        </mesh>
      );
    case "exitSign":
      return (
        <group>
          <mesh>
            <boxGeometry args={[p.w, p.h, 0.06]} />
            <meshStandardMaterial color={c} emissive={c} emissiveIntensity={1.4} toneMapped={false} />
          </mesh>
          {p.label && <Label text={`🏃 ${p.label}`} color="#ffffff" w={p.w * 0.95} z={0.035} />}
        </group>
      );
    case "window":
      return (
        <group>
          <mesh position={[0, 0, 0.01]}>
            <boxGeometry args={[p.w + 0.1, p.h + 0.1, 0.03]} />
            <meshStandardMaterial color="#d6d3d1" />
          </mesh>
          <mesh position={[0, 0, 0.03]}>
            <planeGeometry args={[p.w, p.h]} />
            <meshStandardMaterial color={c} emissive="#0f172a" emissiveIntensity={0.6} />
          </mesh>
          <Pic icon={p.icon} w={0.45} h={0.45} z={0.04} />
        </group>
      );
    case "figure":
      return (
        <group>
          <mesh>
            <capsuleGeometry args={[0.22, 1.25, 6, 12]} />
            <meshBasicMaterial color={c} />
          </mesh>
          <mesh position={[0, 0.98, 0]}>
            <sphereGeometry args={[0.2, 12, 10]} />
            <meshBasicMaterial color={c} />
          </mesh>
          {[-0.07, 0.07].map((x) => (
            <mesh key={x} position={[x, 1.0, 0.19]}>
              <sphereGeometry args={[0.025, 8, 6]} />
              <meshBasicMaterial color="#f87171" toneMapped={false} />
            </mesh>
          ))}
        </group>
      );
    default:
      // handprint / footprints: a decal
      return <Pic icon={p.icon} w={p.w} h={p.w} z={0.01} />;
  }
}

/** Generous invisible hit box (also stands in for a missing prop). */
function HitBox({ p }: { p: ShownProp }) {
  const d = p.kind === "vending" ? 0.8 : p.kind === "plant" || p.kind === "bench" ? 0.6 : 0.25;
  const pad = 0.12;
  return (
    <mesh position={[0, 0, d / 2]}>
      <boxGeometry args={[Math.max(0.4, p.w + pad), Math.max(0.4, p.h + pad), d]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

function Outline({ p, color, pulse }: { p: ShownProp; color: string; pulse: boolean }) {
  const ref = useRef<THREE.LineBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (ref.current && pulse) ref.current.opacity = 0.55 + Math.sin(clock.elapsedTime * 8) * 0.45;
  });
  const geo = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(p.w * p.scale + 0.16, p.h * p.scale + 0.16, 0.3)), [p.w, p.h, p.scale]);
  return (
    <lineSegments geometry={geo} position={[0, 0, 0.15]}>
      <lineBasicMaterial ref={ref} color={color} transparent toneMapped={false} />
    </lineSegments>
  );
}

function PropNode({ p, selected, revealed, onPick }: { p: ShownProp; selected: boolean; revealed: boolean; onPick: ((id: string) => void) | null }) {
  const { pos, rotY, rotX } = placement(p);
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (!onPick || e.delta > 8) return; // a drag to look around, not a tap
    onPick(p.id);
  };
  return (
    <group position={pos} rotation={[rotX, rotY, 0]}>
      <group rotation-z={p.tilt} scale={p.scale}>
        {!p.hidden && <Body p={p} />}
        {revealed && p.hidden && (
          // the ghost of what's gone
          <mesh position={[0, 0, 0.05]}>
            <planeGeometry args={[p.w, p.h]} />
            <meshBasicMaterial color="#f43f5e" transparent opacity={0.18} depthWrite={false} />
          </mesh>
        )}
      </group>
      <group onClick={click}>
        <HitBox p={p} />
      </group>
      {selected && <Outline p={p} color="#38bdf8" pulse={false} />}
      {revealed && <Outline p={p} color="#f43f5e" pulse />}
    </group>
  );
}

function Shell() {
  const len = CORRIDOR_LEN + BACK_Z;
  return (
    <group>
      {/* floor, ceiling, walls */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, -len / 2 + BACK_Z]}>
        <planeGeometry args={[CORRIDOR_W, len]} />
        <meshStandardMaterial color="#3f3f37" roughness={0.35} metalness={0.05} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.003, -len / 2 + BACK_Z]}>
        <planeGeometry args={[1.1, len]} />
        <meshStandardMaterial color="#4a2a24" roughness={0.9} />
      </mesh>
      <mesh rotation-x={Math.PI / 2} position={[0, CORRIDOR_H, -len / 2 + BACK_Z]}>
        <planeGeometry args={[CORRIDOR_W, len]} />
        <meshStandardMaterial color="#cbd5c0" roughness={0.9} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh rotation-y={(-s * Math.PI) / 2} position={[s * W2, CORRIDOR_H / 2, -len / 2 + BACK_Z]}>
            <planeGeometry args={[len, CORRIDOR_H]} />
            <meshStandardMaterial color="#9ca38f" roughness={0.85} />
          </mesh>
          <mesh rotation-y={(-s * Math.PI) / 2} position={[s * (W2 - 0.01), 0.06, -len / 2 + BACK_Z]}>
            <planeGeometry args={[len, 0.12]} />
            <meshStandardMaterial color="#3f3f46" />
          </mesh>
        </group>
      ))}
      <mesh position={[0, CORRIDOR_H / 2, -CORRIDOR_LEN]}>
        <planeGeometry args={[CORRIDOR_W, CORRIDOR_H]} />
        <meshStandardMaterial color="#8a917e" roughness={0.85} />
      </mesh>
      {/* behind the entrance: a closed wall, so looking back isn't a void */}
      <mesh position={[0, CORRIDOR_H / 2, BACK_Z]} rotation-y={Math.PI}>
        <planeGeometry args={[CORRIDOR_W, CORRIDOR_H]} />
        <meshStandardMaterial color="#57534e" roughness={0.9} />
      </mesh>
    </group>
  );
}

/** One point light under each ceiling panel; colour / presence follow the (possibly altered) lamp. */
function Lights({ lamps, dread }: { lamps: ShownProp[]; dread: number }) {
  const refs = useRef<(THREE.PointLight | null)[]>([]);
  const flickerIdx = lamps.length > 0 ? Math.floor(lamps.length / 2) : -1;
  useFrame(({ clock }) => flickerFrame(refs.current, flickerIdx, clock.elapsedTime, dread));
  return (
    <group>
      {lamps.map((l, i) =>
        l.hidden ? null : (
          <pointLight
            key={l.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            position={[0, CORRIDOR_H - 0.3, -l.z]}
            color={l.color}
            intensity={2.4}
            distance={7}
            decay={1.4}
          />
        ),
      )}
    </group>
  );
}

function flickerFrame(lights: (THREE.PointLight | null)[], idx: number, t: number, dread: number) {
  const base = 2.6 - dread * 1.1;
  lights.forEach((l, i) => {
    if (!l) return;
    let k = 1;
    if (i === idx && dread > 0.25) {
      const n = Math.sin(t * 31) * Math.sin(t * 7.7) + Math.sin(t * 2.1);
      k = n > 1.2 - dread * 0.8 ? 0.15 : 1;
    }
    l.intensity = base * k;
  });
}

/** Player body: position on the floor + look angles + current stick / key input. */
interface Walker {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  /** Stick input (−1..1; z forward). */
  sx: number;
  sz: number;
  keys: Set<string>;
  run: boolean;
  bobT: number;
  /** Body state the VRM reads: moving / hurrying, facing (rotation.y), stride phase. */
  moving: boolean;
  hurry: boolean;
  face: number;
  phase: number;
  /** Current (wall-shortened) camera distance behind the shoulder. */
  dist: number;
}

interface Blocker {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Floor-standing props you can't walk through (wall props are flat enough to brush past). */
function blockersOf(props: ShownProp[]): Blocker[] {
  const out: Blocker[] = [];
  for (const p of props) {
    if (p.hidden) continue;
    const depth = p.kind === "vending" ? 0.75 : p.kind === "plant" ? 0.62 : p.kind === "bench" ? 0.52 : p.kind === "figure" ? 0 : -1;
    if (depth < 0) continue;
    const half = (p.kind === "figure" ? 0.25 : p.w / 2) * p.scale;
    const z = -p.z;
    if (p.kind === "figure") {
      const x = 0.4;
      out.push({ x0: x - half, x1: x + half, z0: z - half, z1: z + half });
    } else if (p.side === "L") out.push({ x0: -W2, x1: -W2 + depth, z0: z - half, z1: z + half });
    else if (p.side === "R") out.push({ x0: W2 - depth, x1: W2, z0: z - half, z1: z + half });
  }
  return out;
}

/** Push a circle of radius BODY_R out of each box (one pass is plenty for a hallway). */
function collide(x: number, z: number, blocks: Blocker[]): [number, number] {
  x = Math.max(-W2 + BODY_R, Math.min(W2 - BODY_R, x));
  z = Math.max(-CORRIDOR_LEN + BODY_R + 0.2, Math.min(BACK_Z - BODY_R - 0.05, z));
  for (const b of blocks) {
    const cx = Math.max(b.x0, Math.min(b.x1, x));
    const cz = Math.max(b.z0, Math.min(b.z1, z));
    const dx = x - cx;
    const dz = z - cz;
    const d = Math.hypot(dx, dz);
    if (d >= BODY_R) continue;
    if (d < 1e-4) {
      // centre inside the box: shove out across the hall
      x = b.x0 <= -W2 + 0.01 ? b.x1 + BODY_R : b.x1 >= W2 - 0.01 ? b.x0 - BODY_R : x;
      continue;
    }
    x = cx + (dx / d) * BODY_R;
    z = cz + (dz / d) * BODY_R;
  }
  return [x, z];
}

const KEY_FWD = ["KeyW", "ArrowUp"];
const KEY_BACK = ["KeyS", "ArrowDown"];
const KEY_LEFT = ["KeyA", "ArrowLeft"];
const KEY_RIGHT = ["KeyD", "ArrowRight"];

function axis(keys: Set<string>, plus: string[], minus: string[]) {
  return (plus.some((k) => keys.has(k)) ? 1 : 0) - (minus.some((k) => keys.has(k)) ? 1 : 0);
}

function CameraRig({ walker, blocks, mode, body }: { walker: RefObject<Walker>; blocks: Blocker[]; mode: CorridorCam; body: RefObject<THREE.Group | null> }) {
  useFrame(({ camera }, dt) => rigFrame(camera, walker.current, blocks, mode, body.current, Math.min(dt, 0.1)));
  return null;
}

function wrapAngle(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** How far a ray from `o` along `d` can go before leaving the (padded) inside of the hall. */
function roomExit(o: THREE.Vector3, d: THREE.Vector3, max: number) {
  let t = max;
  const slab = (p: number, v: number, lo: number, hi: number) => {
    if (v > 1e-6) t = Math.min(t, (hi - p) / v);
    else if (v < -1e-6) t = Math.min(t, (lo - p) / v);
  };
  slab(o.x, d.x, -W2 + CAM_PAD, W2 - CAM_PAD);
  slab(o.y, d.y, 0.25, CORRIDOR_H - CAM_PAD);
  slab(o.z, d.z, -CORRIDOR_LEN + CAM_PAD, BACK_Z - CAM_PAD);
  return Math.max(0, t);
}

const vFwd = new THREE.Vector3();
const vOrigin = new THREE.Vector3();
const vBack = new THREE.Vector3();

function rigFrame(camera: THREE.Camera, w: Walker, blocks: Blocker[], mode: CorridorCam, body: THREE.Group | null, dt: number) {
  let f = axis(w.keys, KEY_FWD, KEY_BACK) + w.sz;
  let s = axis(w.keys, KEY_RIGHT, KEY_LEFT) + w.sx;
  const l = Math.hypot(f, s);
  if (l > 1) {
    f /= l;
    s /= l;
  }
  const moving = l > 0.05;
  const hurry = moving && (w.run || w.keys.has("ShiftLeft") || w.keys.has("ShiftRight"));
  // yaw 0 looks down −z; positive yaw turns left
  const sin = Math.sin(w.yaw);
  const cos = Math.cos(w.yaw);
  if (moving) {
    const sp = (hurry ? RUN_SPEED : WALK_SPEED) * dt;
    const mx = -sin * f + cos * s;
    const mz = -cos * f - sin * s;
    [w.x, w.z] = collide(w.x + mx * sp, w.z + mz * sp, blocks);
    w.bobT += dt * (hurry ? 11 : 8);
    w.phase += dt * (hurry ? 13 : 7.5);
    // the body turns toward where it walks (VRM faces +z → rotation.y = atan2(x, z))
    w.face += wrapAngle(Math.atan2(mx, mz) - w.face) * (1 - Math.exp(-dt * 10));
  }
  w.moving = moving;
  w.hurry = hurry;

  if (body) {
    body.position.set(w.x, 0, w.z);
    body.rotation.y = w.face;
  }
  if (mode === "first") {
    if (body) body.visible = false;
    const bob = moving ? Math.sin(w.bobT) * 0.018 : 0;
    camera.position.set(w.x, 1.6 + bob, w.z);
    camera.rotation.set(w.pitch, w.yaw, 0, "YXZ");
    return;
  }
  // over the right shoulder: pull in at once when a wall / the ceiling is in the way, ease back out
  const cp = Math.cos(w.pitch);
  vFwd.set(-sin * cp, Math.sin(w.pitch), -cos * cp);
  vOrigin.set(w.x + cos * CAM_SHOULDER, HEAD_Y + 0.12, w.z - sin * CAM_SHOULDER);
  vOrigin.x = Math.max(-W2 + CAM_PAD, Math.min(W2 - CAM_PAD, vOrigin.x));
  vBack.copy(vFwd).negate();
  const free = Math.max(0, roomExit(vOrigin, vBack, CAM_DIST) - 0.05);
  if (free < w.dist) w.dist = free;
  else w.dist += (free - w.dist) * (1 - Math.exp(-dt * 3.2));
  if (body) body.visible = w.dist > 0.55;
  camera.position.copy(vOrigin).addScaledVector(vFwd, -w.dist);
  camera.rotation.set(w.pitch, w.yaw, 0, "YXZ");
}

function freshWalker(keys: Set<string>): Walker {
  return { x: 0, z: START_Z, yaw: 0, pitch: -0.04, sx: 0, sz: 0, keys, run: false, bobT: 0, moving: false, hurry: false, face: Math.PI, phase: 0, dist: CAM_DIST };
}

/** The player's own profile VRM. Position / facing are written by rigFrame; this only poses the bones. */
function Player({ walker, body, seat, lowDetail }: { walker: RefObject<Walker>; body: RefObject<THREE.Group | null>; seat: number; lowDetail: boolean }) {
  const character = useMyCharacter((st) => st.character);
  const look = useMemo(() => resolveLook(Math.max(0, seat), ["none"], character ?? undefined), [seat, character]);
  const pose = (o: Float32Array, t: number) => {
    const w = walker.current;
    setBone(o, "rightUpperArm", 0, 0, -0.12);
    setBone(o, "leftUpperArm", 0, 0, 0.12);
    if (w.moving) {
      addWalk(o, w.phase, w.hurry ? 1 : 0.8);
      if (w.hurry) o[BODY.spine] += 0.1;
    } else {
      o[BODY.spine] += Math.sin(t * 1.7) * 0.025;
    }
    // the head turns a little toward where the camera looks
    const turn = wrapAngle(w.yaw + Math.PI - w.face);
    o[BODY.head + 1] += Math.max(-0.6, Math.min(0.6, turn * 0.5));
    o[BODY.head] += Math.max(-0.3, Math.min(0.3, -w.pitch * 0.5));
  };
  return (
    <group ref={body} position={[0, 0, START_Z]} rotation-y={Math.PI}>
      <VrmBody
        look={look}
        seed={seat * 17 + 3}
        headY={HEAD_Y}
        pose={pose}
        face={() => ({ surprised: 0.15 })}
        lowDetail={lowDetail}
        follow={16}
        fallback={
          <mesh position={[0, 0.8, 0]} scale={[0.3, 0.8, 0.25]}>
            <sphereGeometry args={[1, 14, 10]} />
            <meshBasicMaterial color="#0c0a09" transparent opacity={0.5} />
          </mesh>
        }
      />
    </group>
  );
}

function readCam(): CorridorCam {
  try {
    return localStorage.getItem(CAM_KEY) === "first" ? "first" : "third";
  } catch {
    return "third";
  }
}

const STICK_R = 44;

/** Bottom-left thumb stick. Pushed to the rim = hurry. */
function Stick({ onMove }: { onMove: (v: { x: number; z: number } | null) => void }) {
  const base = useRef<{ x: number; y: number; id: number } | null>(null);
  const [knob, setKnob] = useState<{ dx: number; dy: number } | null>(null);
  const end = () => {
    base.current = null;
    setKnob(null);
    onMove(null);
  };
  const clampTo = (cx: number, cy: number, b: { x: number; y: number }) => {
    let dx = cx - b.x;
    let dy = cy - b.y;
    const l = Math.hypot(dx, dy);
    if (l > STICK_R) {
      dx = (dx / l) * STICK_R;
      dy = (dy / l) * STICK_R;
    }
    return { dx, dy, l };
  };
  return (
    <div
      className="absolute bottom-3 left-3 z-20 touch-none select-none"
      style={{ width: STICK_R * 2 + 16, height: STICK_R * 2 + 16 }}
      aria-label="이동 조이스틱"
      onPointerDown={(e) => {
        e.stopPropagation();
        if (base.current) return;
        const r = e.currentTarget.getBoundingClientRect();
        const b = { x: r.left + r.width / 2, y: r.top + r.height / 2, id: e.pointerId };
        base.current = b;
        e.currentTarget.setPointerCapture(e.pointerId);
        const { dx, dy } = clampTo(e.clientX, e.clientY, b);
        setKnob({ dx, dy });
        onMove({ x: dx / STICK_R, z: -dy / STICK_R });
      }}
      onPointerMove={(e) => {
        e.stopPropagation();
        const b = base.current;
        if (!b || b.id !== e.pointerId) return;
        const { dx, dy, l } = clampTo(e.clientX, e.clientY, b);
        setKnob({ dx, dy });
        onMove(l < 5 ? { x: 0, z: 0 } : { x: dx / STICK_R, z: -dy / STICK_R });
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        if (base.current?.id === e.pointerId) end();
      }}
      onPointerCancel={end}
    >
      <div className="pointer-events-none absolute inset-2 rounded-full border-2 border-white/25 bg-black/35" />
      <div
        className="pointer-events-none absolute flex h-12 w-12 items-center justify-center rounded-full border-2 border-white/60 bg-white/20 text-[10px] font-bold text-white/80"
        style={{ left: STICK_R + 8 - 24 + (knob?.dx ?? 0), top: STICK_R + 8 - 24 + (knob?.dy ?? 0) }}
      >
        {knob ? "" : "이동"}
      </div>
    </div>
  );
}

const MOVE_KEYS = new Set([...KEY_FWD, ...KEY_BACK, ...KEY_LEFT, ...KEY_RIGHT, "ShiftLeft", "ShiftRight"]);

function isTyping(t: EventTarget | null) {
  return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

export default function CorridorScene(p: CorridorSceneProps) {
  const walker = useRef<Walker>(freshWalker(new Set()));
  const drag = useRef<{ x: number; y: number; id: number; yaw: number; pitch: number } | null>(null);
  const body = useRef<THREE.Group>(null);
  const [cam, setCam] = useState<CorridorCam>(readCam);
  const lamps = p.props.filter((x) => x.kind === "lamp");
  const blocks = useMemo(() => blockersOf(p.props), [p.props]);
  const nodes: ReactNode[] = p.props.map((x) => <PropNode key={x.id} p={x} selected={x.id === p.selectedId} revealed={x.id === p.revealId} onPick={p.onPick} />);
  const high = !p.lowDetail;

  // back to the entrance for every new corridor
  useEffect(() => {
    walker.current = freshWalker(walker.current.keys);
  }, [p.resetKey]);

  useEffect(() => {
    const k = walker.current.keys;
    const down = (e: KeyboardEvent) => {
      if (!MOVE_KEYS.has(e.code) || isTyping(e.target)) return;
      if (e.code.startsWith("Arrow")) e.preventDefault();
      k.add(e.code);
    };
    const up = (e: KeyboardEvent) => k.delete(e.code);
    const blur = () => k.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      k.clear();
    };
  }, []);

  return (
    <div
      className="relative h-full w-full"
      style={{ touchAction: "none", cursor: p.onPick ? "pointer" : "grab" }}
      onPointerDown={(e) => {
        if (drag.current) return;
        drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId, yaw: walker.current.yaw, pitch: walker.current.pitch };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        walker.current.yaw = d.yaw + (e.clientX - d.x) * 0.006;
        walker.current.pitch = Math.max(-0.8, Math.min(0.7, d.pitch + (e.clientY - d.y) * 0.004));
      }}
      onPointerUp={(e) => {
        if (drag.current?.id === e.pointerId) drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onPointerLeave={(e) => {
        if (drag.current?.id === e.pointerId) drag.current = null;
      }}
    >
      <Canvas dpr={high ? [1, 1.75] : 1} gl={{ antialias: high, powerPreference: "high-performance" }} camera={{ fov: 62, position: [0, 1.6, START_Z], near: 0.05, far: 40 }}>
        <color attach="background" args={["#050605"]} />
        <fog attach="fog" args={["#050605", 6, 17 - p.dread * 4]} />
        <AdaptiveResolution max={1.75} />
        <CameraRig walker={walker} blocks={blocks} mode={cam} body={body} />
        <Player walker={walker} body={body} seat={p.seat} lowDetail={p.lowDetail} />
        <ambientLight intensity={0.22 - p.dread * 0.08} color="#d9f99d" />
        <hemisphereLight args={["#e2e8f0", "#1c1917", 0.18]} />
        <Lights lamps={lamps} dread={p.dread} />
        <Shell />
        {nodes}
      </Canvas>
      <button
        type="button"
        className="absolute top-10 left-2 z-20 rounded-full border border-white/20 bg-black/55 px-2.5 py-1 text-[11px] font-bold text-white/85 hover:bg-black/70"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          const next: CorridorCam = cam === "third" ? "first" : "third";
          setCam(next);
          try {
            localStorage.setItem(CAM_KEY, next);
          } catch {
            /* private mode */
          }
          e.currentTarget.blur();
        }}
        aria-label="시점 바꾸기"
      >
        {cam === "third" ? "👤 3인칭" : "👁️ 1인칭"}
      </button>
      <Stick
        onMove={(v) => {
          walker.current.sx = v?.x ?? 0;
          walker.current.sz = v?.z ?? 0;
          walker.current.run = !!v && Math.hypot(v.x, v.z) > 0.92;
        }}
      />
    </div>
  );
}
