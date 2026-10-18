"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { Block, Collapse, Coord, Level, TowerEvent } from "../engine";
import { TowerSway, bendOffset, bendTilt } from "./sway";
import { blockMaterials, ghostMaterial, tableTexture, VARIANTS, type BlockLook } from "./wood";
import type { CollapseSim } from "./collapse";
import { LiveSmoother } from "./liveSmooth";

/**
 * 와르르 타워 3D 무대 (rulebook §13). Display only — every pose is derived
 * each frame from props + local animation clocks:
 *
 * - The tower bends like a damped spring (sway.ts): kicks from pulls,
 *   jerks and placements, a slow random breathing that grows with damage,
 *   and a static lean toward the center of mass.
 * - A pull: the player grabs the block and drags it out along its long
 *   axis — toward the camera (a pinch on the near end) or away (a fingertip
 *   pushing it through). Shown live from `live` for everyone, replayed for
 *   bots; then the block floats above the tower until it's placed.
 * - A collapse hands every block to a cannon-es world (collapse.ts).
 *
 * Lint rules this file follows (React Compiler, see bluffRoulette/Scene3D):
 * no ref reads during render, camera only touched inside useFrame.
 */

export const BLOCK_L = 1.5;
export const BLOCK_W = 0.5;
export const BLOCK_H = 0.3;
const HALF: [number, number, number] = [BLOCK_L / 2, BLOCK_H / 2 - 0.002, BLOCK_W / 2 - 0.004];
const PULL_OUT = BLOCK_L + 0.25;

export interface LivePull {
  turn: number;
  level: number;
  slot: number;
  progress: number;
  strain: number;
  stuck: boolean;
  jerked: boolean;
  /** Which way along the block's long axis it is coming out (±1), 0 = not decided yet. */
  sign: number;
  /** Where the finger is (0..1 of the pull) — runs ahead of `progress` while the block is stuck. */
  hand: number;
  /** performance.now() of the last update — stale remote updates fade out. */
  at: number;
  /** Came over the network (smoothed for display) rather than from my own finger. */
  remote?: boolean;
}

export interface TowerSceneProps {
  levels: Level[];
  held: (Block & { from: Coord }) | null;
  lastEvent: TowerEvent | null;
  collapse: Collapse | null;
  round: number;
  /** Selectable blocks for the viewer right now ("level:slot"), or null. */
  legal: Set<string> | null;
  selected: Coord | null;
  onSelect: (c: Coord) => void;
  /** The viewer may grab the selected block and drag it out (§5). */
  grabbable: boolean;
  onGrab: () => void;
  /** Finger position along the pull (0..1, never decreases) and exit side (±1). */
  onHand: (hand: number, sign: number) => void;
  /** Empty top slots the viewer may place into right now, or null. */
  placeSlots: number[] | null;
  placeLevel: number;
  onPlace: (slot: number) => void;
  live: MutableRefObject<LivePull | null>;
  fragility: number;
  lean: { x: number; z: number };
  quality: "high" | "low";
  onImpact?: (strength: number) => void;
  onCreak?: (strength: number) => void;
  onFps?: (fps: number) => void;
  /** Bumped by every 💨 from a spectator — a puff of wind (display only). */
  gust?: MutableRefObject<number>;
}

type Pose = { p: [number, number, number]; q: [number, number, number, number] };

const nowSec = () => performance.now() / 1000;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Rest pose of a block in the straight tower. */
function restPose(level: number, slot: number): { x: number; y: number; z: number; rotY: number } {
  const off = (slot - 1) * BLOCK_W;
  const y = level * BLOCK_H + BLOCK_H / 2;
  return level % 2 === 0 ? { x: 0, y, z: off, rotY: 0 } : { x: off, y, z: 0, rotY: Math.PI / 2 };
}

/** Unit vector of a level's long axis. */
function longAxis(level: number): { x: number; z: number } {
  return level % 2 === 0 ? { x: 1, z: 0 } : { x: 0, z: 1 };
}

let cannonPromise: Promise<typeof import("cannon-es")> | null = null;
function loadCannon() {
  cannonPromise ??= import("cannon-es");
  return cannonPromise;
}
let collapseModule: Promise<typeof import("./collapse")> | null = null;
function loadCollapse() {
  collapseModule ??= import("./collapse");
  return collapseModule;
}

const boxGeo = new THREE.BoxGeometry(BLOCK_L - 0.004, BLOCK_H - 0.004, BLOCK_W - 0.008);
const TMP_Q = new THREE.Quaternion();
const TMP_E = new THREE.Euler(0, 0, 0, "YXZ");

interface Anim {
  turn: number;
  kind: "pull" | "place";
  start: number;
  /** pull: progress the block was already at when the event arrived. */
  from: number;
  sign: number;
  blockId: number;
  at: Coord;
  collapsed: boolean;
  jolt: number;
  /** place: pose the block started from (hover). */
  fromPose?: Pose;
}

function Tower(props: TowerSceneProps) {
  const { levels, held, lastEvent, collapse, round, legal, selected, placeSlots, placeLevel } = props;
  const meshes = useRef(new Map<number, THREE.Mesh>());
  const ghosts = useRef(new Map<number, THREE.Mesh>());
  const sway = useRef<TowerSway | null>(null);
  const anim = useRef<Anim | null>(null);
  const seenTurn = useRef<number | null>(null);
  const liveSign = useRef<{ turn: number; sign: number } | null>(null);
  const hovered = useRef<number | null>(null);
  const hoverGhost = useRef<number | null>(null);
  const sim = useRef<{ sim: CollapseSim | null; poses: Map<number, Pose>; started: number; loading: boolean; round: number } | null>(null);
  const build = useRef<{ round: number; start: number } | null>(null);
  const lastPoses = useRef(new Map<number, Pose>());
  const sounds = useRef({ impactAt: 0, creakAt: 0 });
  const shake = useRef(0);
  const gl = useThree((st) => st.gl);
  const grab = useRef<{ key: string; sign: number; hand: number } | null>(null);
  const hitbox = useRef<THREE.Mesh>(null);
  const finger = useRef<THREE.Group>(null);
  const smoother = useRef<LiveSmoother | null>(null);
  const gustSeen = useRef<number | null>(null);

  useEffect(() => {
    // fetch the physics chunk early so a collapse never waits on the network
    void loadCannon();
    void loadCollapse();
  }, []);

  // id → coord of every block standing in the tower
  const coordOf = useMemo(() => {
    const m = new Map<number, Coord>();
    levels.forEach((lv, level) => lv.slots.forEach((b, slot) => b && m.set(b.id, { level, slot })));
    return m;
  }, [levels]);

  // blocks to render: tower + held + the one that was being pulled when it fell
  const ids = useMemo(() => {
    const list = [...coordOf.keys()];
    if (held && !coordOf.has(held.id)) list.push(held.id);
    if (collapse && lastEvent && !coordOf.has(lastEvent.blockId) && lastEvent.blockId !== held?.id) list.push(lastEvent.blockId);
    return list;
  }, [coordOf, held, collapse, lastEvent]);

  const topY = levels.length * BLOCK_H;

  useFrame((frame, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = nowSec();
    sway.current ??= new TowerSway();
    const sw = sway.current;
    const cam = frame.camera;

    // ---- new round → fresh tower drops in
    if (!build.current || build.current.round !== round) {
      build.current = { round, start: t };
      sim.current = null;
      anim.current = null;
      sw.ax = sw.az = sw.vx = sw.vz = 0;
    }

    // ---- new event → start its animation
    if (lastEvent && seenTurn.current !== lastEvent.turn) {
      const first = seenTurn.current === null;
      seenTurn.current = lastEvent.turn;
      if (!first) {
        const live = props.live.current;
        const axis = longAxis(lastEvent.at.level);
        const camSign = Math.sign(cam.position.x * axis.x + cam.position.z * axis.z) || 1;
        const liveHere = live && live.turn === lastEvent.turn && live.level === lastEvent.at.level && live.slot === lastEvent.at.slot && t * 1000 - live.at < 3000;
        const sign = lastEvent.kind === "pull" && liveHere && liveSign.current?.turn === lastEvent.turn ? liveSign.current.sign : camSign;
        anim.current = {
          turn: lastEvent.turn,
          kind: lastEvent.kind,
          start: t,
          from: lastEvent.kind === "pull" && liveHere ? (live.remote && smoother.current?.matches(live) ? smoother.current.p : live.progress) : 0,
          sign,
          blockId: lastEvent.blockId,
          at: lastEvent.at,
          collapsed: lastEvent.collapsed,
          jolt: lastEvent.kind === "pull" ? lastEvent.jolt : 0,
          fromPose: lastEvent.kind === "place" ? lastPoses.current.get(lastEvent.blockId) : undefined,
        };
        if (lastEvent.kind === "pull" && lastEvent.timeout) sw.addRattle(0.6);
      }
    }

    // ---- 💨 a spectator blew on the tower
    const g = props.gust?.current ?? 0;
    if (gustSeen.current === null) gustSeen.current = g;
    else if (g !== gustSeen.current) {
      const n = g - gustSeen.current;
      gustSeen.current = g;
      for (let i = 0; i < Math.min(3, n); i++) {
        const ang = Math.random() * Math.PI * 2;
        sw.kick(Math.cos(ang) * 0.016, Math.sin(ang) * 0.016);
      }
      sw.addRattle(0.25);
    }

    // ---- live drag (mine or someone else's)
    const rawLive = props.live.current;
    const liveActive = !!rawLive && !anim.current?.collapsed && (anim.current === null || anim.current.turn < rawLive.turn) && t * 1000 - rawLive.at < 2500 && coordOf.get(levels[rawLive.level]?.slots[rawLive.slot]?.id ?? -1) !== undefined;
    // remote drags arrive ~11x/s with jitter: ease between packets (liveSmooth.ts); my own drag is drawn raw
    smoother.current ??= new LiveSmoother();
    const live = rawLive && liveActive && rawLive.remote ? { ...rawLive, ...smoother.current.update(rawLive, t * 1000, dt) } : rawLive;
    if (liveActive && live) {
      if (live.sign !== 0) liveSign.current = { turn: live.turn, sign: live.sign };
      else if (liveSign.current?.turn !== live.turn) {
        const axis = longAxis(live.level);
        liveSign.current = { turn: live.turn, sign: Math.sign(cam.position.x * axis.x + cam.position.z * axis.z) || 1 };
      }
      const axis = longAxis(live.level);
      const s = liveSign.current.sign;
      // strain drags the whole tower toward the hand; a stuck block shudders
      const push = live.strain * live.strain * 0.05 + (live.stuck ? 0.012 : 0);
      sw.kick(axis.x * s * push * dt * 6, axis.z * s * push * dt * 6);
      if (live.stuck) sw.addRattle(dt * 2.2);
      if (live.jerked) sw.addRattle(1);
    }

    // ---- pull/place animation progress
    const a = anim.current;
    let pullOut: { id: number; progress: number; sign: number; level: number } | null = null;
    let floating: { id: number; pose: Pose } | null = null;
    let wantCollapse = false;
    if (a) {
      const el = t - a.start;
      if (a.kind === "pull") {
        const slideDur = a.from > 0.6 ? 0.35 : 1.25;
        const k = clamp01(el / slideDur);
        const prog = a.from + (1 - a.from) * easeInOut(k);
        const axis = longAxis(a.at.level);
        // replayed pulls shake the tower by how rough they were; doomed pulls tremble harder
        if (k < 1) {
          const rough = a.jolt * (a.collapsed ? 2.2 : 1);
          sw.kick(axis.x * a.sign * rough * 0.05 * dt * 6, axis.z * a.sign * rough * 0.05 * dt * 6);
          sw.addRattle(rough * dt * 2);
        }
        if (a.collapsed && prog >= 0.82) wantCollapse = true;
        if (k < 1 || a.collapsed) pullOut = { id: a.blockId, progress: a.collapsed ? Math.min(prog, 0.85) : prog, sign: a.sign, level: a.at.level };
        else {
          const lift = clamp01((el - slideDur) / 0.55);
          const r = restPose(a.at.level, a.at.slot);
          const from: [number, number, number] = [r.x + axis.x * a.sign * PULL_OUT, r.y, r.z + axis.z * a.sign * PULL_OUT];
          const hover = hoverPose(t, levels.length, placeLevel, cam);
          const e = easeInOut(lift);
          const p: [number, number, number] = [from[0] + (hover.p[0] - from[0]) * e, from[1] + (hover.p[1] - from[1]) * e + Math.sin(e * Math.PI) * 0.4, from[2] + (hover.p[2] - from[2]) * e];
          TMP_E.set(0, r.rotY + (hoverRotY(placeLevel) - r.rotY) * e, 0);
          TMP_Q.setFromEuler(TMP_E);
          floating = { id: a.blockId, pose: { p, q: [TMP_Q.x, TMP_Q.y, TMP_Q.z, TMP_Q.w] } };
          if (lift >= 1) anim.current = null;
        }
      } else {
        const dur = 0.5;
        const k = clamp01(el / dur);
        const target = restPose(a.at.level, a.at.slot);
        const fp = a.fromPose ?? hoverPose(t, a.at.level, a.at.level, cam);
        const e = easeOut(k);
        const p: [number, number, number] = [fp.p[0] + (target.x - fp.p[0]) * e, fp.p[1] + (target.y - fp.p[1]) * e + Math.sin(k * Math.PI) * 0.15, fp.p[2] + (target.z - fp.p[2]) * e];
        TMP_E.set(0, target.rotY, 0);
        TMP_Q.setFromEuler(TMP_E);
        if (k < 1) floating = { id: a.blockId, pose: { p, q: [TMP_Q.x, TMP_Q.y, TMP_Q.z, TMP_Q.w] } };
        else {
          // thump
          const ang = hash(a.turn) * Math.PI * 2;
          sw.kick(Math.cos(ang) * 0.018, Math.sin(ang) * 0.018);
          sw.addRattle(0.25);
          if (a.collapsed) wantCollapse = true;
          anim.current = null;
          props.onImpact?.(0.5);
        }
      }
    }
    if (collapse && !a && !sim.current) wantCollapse = true;

    // ---- sway integration
    const leanScale = 0.006 * (1 + props.fragility);
    sw.step(dt, { fragility: props.fragility, leanX: props.lean.x * leanScale, leanZ: props.lean.z * leanScale });
    const energy = sw.energy;
    if (energy > 0.006 && t - sounds.current.creakAt > 0.9) {
      sounds.current.creakAt = t;
      props.onCreak?.(Math.min(1, energy / 0.03));
    }

    // ---- start the physics collapse
    if (wantCollapse && collapse && (!sim.current || sim.current.round !== round)) {
      const poses = new Map<number, Pose>();
      for (const id of ids) {
        const pose = lastPoses.current.get(id);
        if (pose) poses.set(id, pose);
      }
      const state = { sim: null as CollapseSim | null, poses, started: t, loading: true, round };
      sim.current = state;
      const spec = {
        bodies: [...poses.entries()].map(([id, pose]) => ({ id, pos: pose.p, quat: pose.q })),
        half: HALF,
        pivotY: (collapse.level + 1) * BLOCK_H,
        dir: collapse.dir,
        force: collapse.cause === "structure" ? 0.55 : 0.25 + (lastEvent && lastEvent.kind === "pull" ? lastEvent.jolt * 1.5 : 0.2),
        seed: lastEvent?.turn ?? 1,
      };
      void Promise.all([loadCannon(), loadCollapse()]).then(([C, mod]) => {
        if (sim.current !== state) return;
        state.sim = mod.createCollapse(C, spec);
        state.loading = false;
      });
      shake.current = 0.6;
      anim.current = null;
    }

    // ---- write poses
    const out = sim.current;
    if (out?.sim) {
      out.sim.step(dt);
      const impact = out.sim.read(out.poses);
      if (impact > 0 && t - sounds.current.impactAt > 0.07) {
        sounds.current.impactAt = t;
        props.onImpact?.(Math.min(1, impact / 25));
        shake.current = Math.min(1, shake.current + impact / 120);
      }
    }
    const buildK = build.current ? t - build.current.start : 99;
    const ax = sw.ax;
    const az = sw.az;
    const rattle = sw.rattle;
    for (const id of ids) {
      const mesh = meshes.current.get(id);
      if (!mesh) continue;
      let pose: Pose | undefined;
      if (out) pose = out.poses.get(id);
      if (!pose && floating && floating.id === id) pose = floating.pose;
      if (!pose && held && held.id === id && !(a && a.blockId === id)) pose = hoverPose(t, levels.length, placeLevel, cam);
      if (!pose) {
        const c = coordOf.get(id) ?? (pullOut && pullOut.id === id ? { level: pullOut.level, slot: a!.at.slot } : null);
        if (!c) continue;
        const r = restPose(c.level, c.slot);
        let x = r.x;
        let y = r.y;
        let z = r.z;
        // drop-in when a new tower is built
        const delay = c.level * 0.045 + c.slot * 0.012;
        const drop = 1 - easeOut(clamp01((buildK - delay) / 0.32));
        y += drop * 2.5;
        // pulled block slides out; its neighbours get dragged a hair
        const axis = longAxis(c.level);
        let slide = 0;
        if (pullOut && pullOut.id === id) slide = pullOut.progress * PULL_OUT * pullOut.sign;
        else if (liveActive && live && live.level === c.level && live.slot === c.slot) {
          slide = live.progress * PULL_OUT * (liveSign.current?.sign ?? 1);
          if (live.stuck) slide += Math.sin(t * 70) * 0.006;
        } else if (liveActive && live && live.level === c.level) slide = live.strain * 0.025 * (liveSign.current?.sign ?? 1);
        x += axis.x * slide;
        z += axis.z * slide;
        // bending + rattle
        x += bendOffset(ax, y, topY);
        z += bendOffset(az, y, topY);
        if (rattle > 0) {
          x += Math.sin(t * 53 + id * 1.7) * 0.006 * rattle;
          z += Math.sin(t * 47 + id * 2.3) * 0.006 * rattle;
          y += Math.abs(Math.sin(t * 61 + id)) * 0.003 * rattle;
        }
        // selected block wiggles by its looseness (§5 "더듬어 보기")
        if (selected && selected.level === c.level && selected.slot === c.slot && !(liveActive && live && live.progress > 0.005)) {
          const b = levels[c.level].slots[c.slot];
          const loose = b?.loose ?? 0.5;
          const w = Math.sin(t * (9 + loose * 8)) * (0.004 + loose * 0.028);
          x += axis.x * w;
          z += axis.z * w;
        }
        TMP_E.set(bendTilt(az, y, topY), r.rotY, -bendTilt(ax, y, topY));
        TMP_Q.setFromEuler(TMP_E);
        pose = { p: [x, y, z], q: [TMP_Q.x, TMP_Q.y, TMP_Q.z, TMP_Q.w] };
      }
      mesh.position.set(pose.p[0], pose.p[1], pose.p[2]);
      mesh.quaternion.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]);
      lastPoses.current.set(id, pose);

      // look
      const c = coordOf.get(id);
      const variant = Math.floor(hash(id) * VARIANTS);
      let look: BlockLook = "base";
      if (out) look = "base";
      else if (c && selected && selected.level === c.level && selected.slot === c.slot) look = "selected";
      else if (liveActive && live && c && live.level === c.level && live.slot === c.slot) look = "live";
      else if (c && legal) look = !legal.has(`${c.level}:${c.slot}`) ? "dim" : hovered.current === id ? "hover" : "base";
      const mats = blockMaterials(variant, look);
      if (mesh.material !== mats) mesh.material = mats;
    }

    // ghosts for placing
    for (const [slot, g] of ghosts.current) {
      const r = restPose(placeLevel, slot);
      g.position.set(r.x + bendOffset(ax, r.y, topY), r.y + 0.02 + Math.sin(t * 3) * 0.015, r.z + bendOffset(az, r.y, topY));
      g.rotation.set(0, r.rotY, 0);
      const mat = ghostMaterial(hoverGhost.current === slot);
      if (g.material !== mat) g.material = mat;
    }

    // grab hitbox rides on the selected block (bigger than the block, easier to catch on a phone)
    const hb = hitbox.current;
    if (hb && selected) {
      const id = levels[selected.level]?.slots[selected.slot]?.id;
      const pose = id !== undefined ? lastPoses.current.get(id) : undefined;
      if (pose) {
        hb.position.set(pose.p[0], pose.p[1], pose.p[2]);
        hb.quaternion.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]);
      }
    }

    // fingers: one fingertip pushing the near end, or a pinch on the end coming toward you
    const fg = finger.current;
    if (fg) {
      const show = liveActive && !!live && live.sign !== 0 && live.progress < 1 && !out;
      fg.visible = show;
      if (show && live) {
        const r = restPose(live.level, live.slot);
        const axis = longAxis(live.level);
        const sg = live.sign;
        const camSide = Math.sign(cam.position.x * axis.x + cam.position.z * axis.z) || 1;
        const pulling = sg === camSide;
        // the finger presses ahead of a stuck block only a hair
        const h = Math.min(live.hand, live.progress + 0.035) * PULL_OUT;
        const along = pulling ? h + BLOCK_L / 2 - 0.1 : h - BLOCK_L / 2 - 0.075;
        const shudder = live.stuck ? Math.sin(t * 70) * 0.01 : 0;
        const y = r.y;
        fg.position.set(r.x + axis.x * sg * (along + shudder) + bendOffset(ax, y, topY), y + 0.02, r.z + axis.z * sg * (along + shudder) + bendOffset(az, y, topY));
        fg.rotation.set(0, Math.atan2(axis.x * sg, axis.z * sg), 0);
        const [f0, f1] = fg.children;
        if (f0 && f1) {
          // pinch = thumb + index on both sides; push = one fingertip behind the end
          f0.position.set(pulling ? BLOCK_W / 2 + 0.05 : 0, 0, 0);
          f1.visible = pulling;
          f1.position.set(-(BLOCK_W / 2 + 0.05), 0, 0);
        }
      }
    }

    // camera shake (consumed by CameraRig through the shared ref)
    shake.current = Math.max(0, shake.current - dt * 0.9);
    camShake.v = shake.current + Math.min(0.3, rattle * 0.08);
  });

  /** §5 — grab the selected block and drag it along its long axis (screen-projected). */
  const startDrag = (e: ThreeEvent<PointerEvent>) => {
    if (!props.grabbable || !selected) return;
    e.stopPropagation();
    const key = `${selected.level}:${selected.slot}`;
    if (!grab.current || grab.current.key !== key) grab.current = { key, sign: 0, hand: 0 };
    const g = grab.current;
    dragLock.v = true;
    props.onGrab();
    const el = gl.domElement;
    const w = el.clientWidth || 1;
    const hgt = el.clientHeight || 1;
    const r = restPose(selected.level, selected.slot);
    const axis = longAxis(selected.level);
    const p0 = new THREE.Vector3(r.x, r.y, r.z).project(e.camera);
    const p1 = new THREE.Vector3(r.x + axis.x, r.y, r.z + axis.z).project(e.camera);
    const ax = ((p1.x - p0.x) * w) / 2;
    const ay = (-(p1.y - p0.y) * hgt) / 2;
    // px per world unit along the axis; floored so an end-on view is not twitchy
    const len2 = Math.max(ax * ax + ay * ay, 900);
    const sx = e.nativeEvent.clientX;
    const sy = e.nativeEvent.clientY;
    const base = g.hand * PULL_OUT * (g.sign || 1);
    const onHand = props.onHand;
    const move = (ev: PointerEvent) => {
      const d = base + ((ev.clientX - sx) * ax + (ev.clientY - sy) * ay) / len2;
      if (g.sign === 0) {
        if (Math.abs(d) < 0.05) return;
        g.sign = Math.sign(d);
      }
      g.hand = Math.max(g.hand, Math.min(1, (d * g.sign) / PULL_OUT));
      onHand(g.hand, g.sign);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      dragLock.v = false;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const pick = (e: ThreeEvent<MouseEvent>, id: number) => {
    if (e.delta > 8) return;
    const c = coordOf.get(id);
    if (!c || !legal?.has(`${c.level}:${c.slot}`)) return;
    e.stopPropagation();
    props.onSelect(c);
  };

  return (
    <group>
      {ids.map((id) => (
        <mesh
          key={id}
          ref={(m) => {
            if (m) meshes.current.set(id, m);
            else meshes.current.delete(id);
          }}
          geometry={boxGeo}
          material={blockMaterials(Math.floor(hash(id) * VARIANTS), "base")}
          castShadow
          receiveShadow
          onClick={(e) => pick(e, id)}
          onPointerDown={(e) => {
            const c = coordOf.get(id);
            if (c && selected && c.level === selected.level && c.slot === selected.slot) startDrag(e);
          }}
          onPointerOver={(e) => {
            if (!legal) return;
            e.stopPropagation();
            hovered.current = id;
          }}
          onPointerOut={() => {
            if (hovered.current === id) hovered.current = null;
          }}
        />
      ))}
      {props.grabbable && selected && (
        <mesh ref={hitbox} geometry={boxGeo} scale={[1.08, 3.2, 2.4]} onPointerDown={startDrag}>
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      <group ref={finger} visible={false}>
        <mesh scale={[1, 0.8, 1.25]}>
          <sphereGeometry args={[0.085, 16, 12]} />
          <meshStandardMaterial color="#f0bf98" roughness={0.6} />
        </mesh>
        <mesh scale={[1, 0.8, 1.25]}>
          <sphereGeometry args={[0.085, 16, 12]} />
          <meshStandardMaterial color="#f0bf98" roughness={0.6} />
        </mesh>
      </group>
      {placeSlots?.map((slot) => (
        <mesh
          key={`ghost-${placeLevel}-${slot}`}
          ref={(m) => {
            if (m) ghosts.current.set(slot, m);
            else ghosts.current.delete(slot);
          }}
          geometry={boxGeo}
          material={ghostMaterial(false)}
          onClick={(e) => {
            if (e.delta > 8) return;
            e.stopPropagation();
            props.onPlace(slot);
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            hoverGhost.current = slot;
          }}
          onPointerOut={() => {
            if (hoverGhost.current === slot) hoverGhost.current = null;
          }}
        />
      ))}
    </group>
  );
}

/** The held block hovers above the tower, a little toward the camera. */
function hoverPose(t: number, levelCount: number, joinLevel: number, cam: THREE.Camera): Pose {
  const d = Math.hypot(cam.position.x, cam.position.z) || 1;
  const toward = 0.9;
  const y = levelCount * BLOCK_H + 1.05 + Math.sin(t * 2.1) * 0.05;
  TMP_E.set(Math.sin(t * 1.3) * 0.04, hoverRotY(joinLevel), Math.sin(t * 1.7) * 0.05);
  TMP_Q.setFromEuler(TMP_E);
  return { p: [(cam.position.x / d) * toward, y, (cam.position.z / d) * toward], q: [TMP_Q.x, TMP_Q.y, TMP_Q.z, TMP_Q.w] };
}

/** Orientation of the level the held block will join. */
function hoverRotY(level: number): number {
  return level % 2 === 0 ? 0 : Math.PI / 2;
}

/** Shared between Tower (writer) and CameraRig (reader) inside one frame loop. */
const camShake = { v: 0 };
/** True while a block is being dragged — the orbit camera holds still. */
const dragLock = { v: false };

/**
 * Orbit camera: drag to circle the tower and tilt, wheel / pinch to zoom.
 * Frames the whole tower and eases toward the selected level.
 */
function CameraRig({ topY, focusY, closeUp }: { topY: number; focusY: number | null; closeUp: boolean }) {
  const gl = useThree((s) => s.gl);
  const orbit = useRef({ az: Math.PI / 4 + 0.2, el: 0.32, dist: 14, zoom: 1 });
  const look = useRef(new THREE.Vector3(0, 2, 0));
  useEffect(() => {
    const el = gl.domElement;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch: number | null = null;
    const down = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const move = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, cur);
      if (dragLock.v) return;
      const o = orbit.current;
      if (pointers.size >= 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        o.zoom = Math.max(0.55, Math.min(1.6, o.zoom * (pinch / Math.max(1, d))));
        pinch = d;
        return;
      }
      const w = el.clientWidth || 1;
      o.az -= ((cur.x - prev.x) / w) * 4.2;
      o.el = Math.max(0.02, Math.min(1.25, o.el + ((cur.y - prev.y) / w) * 2.4));
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const o = orbit.current;
      o.zoom = Math.max(0.55, Math.min(1.6, o.zoom * (1 + Math.sign(e.deltaY) * 0.08)));
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("wheel", wheel, { passive: false });
    for (const ev of ["pointerup", "pointerleave", "pointercancel"] as const) el.addEventListener(ev, up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("wheel", wheel);
      for (const ev of ["pointerup", "pointerleave", "pointercancel"] as const) el.removeEventListener(ev, up);
    };
  }, [gl]);
  useFrame((frame) => {
    const cam = frame.camera as THREE.PerspectiveCamera;
    const o = orbit.current;
    const portrait = frame.size.width / frame.size.height < 0.9;
    const fitDist = Math.max(7, topY * (portrait ? 1.75 : 1.25) + 3.2);
    // move in on the block you picked so it is big enough to grab
    const near = closeUp ? (portrait ? 0.55 : 0.68) : 1;
    o.dist += (fitDist * o.zoom * near - o.dist) * 0.06;
    const ty = focusY ?? topY * 0.5;
    look.current.y += (ty - look.current.y) * 0.06;
    const r = o.dist;
    const s = camShake.v;
    const jx = s > 0.01 ? (Math.random() - 0.5) * s * 0.12 : 0;
    const jy = s > 0.01 ? (Math.random() - 0.5) * s * 0.12 : 0;
    cam.position.set(Math.cos(o.az) * Math.cos(o.el) * r + jx, look.current.y + Math.sin(o.el) * r + jy, Math.sin(o.az) * Math.cos(o.el) * r);
    cam.lookAt(look.current.x, look.current.y, look.current.z);
    const fov = portrait ? 50 : 38;
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  });
  return null;
}

function Table({ quality }: { quality: "high" | "low" }) {
  const map = useMemo(() => tableTexture(), []);
  const seg = quality === "high" ? 64 : 28;
  return (
    <group>
      <mesh position={[0, -0.12, 0]} receiveShadow>
        <cylinderGeometry args={[5.2, 5.2, 0.24, seg]} />
        <meshStandardMaterial map={map} roughness={0.55} metalness={0.05} />
      </mesh>
      <mesh position={[0, -0.36, 0]}>
        <cylinderGeometry args={[5.05, 4.9, 0.25, seg]} />
        <meshStandardMaterial color="#2a170b" roughness={0.8} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3, 0]}>
        <circleGeometry args={[30, 24]} />
        <meshStandardMaterial color="#120c08" roughness={1} />
      </mesh>
    </group>
  );
}

function FpsProbe({ onFps }: { onFps?: (fps: number) => void }) {
  const acc = useRef({ frames: 0, time: 0 });
  useFrame((_, dt) => {
    const a = acc.current;
    a.frames += 1;
    a.time += Math.min(dt, 0.5);
    if (a.time >= 2) {
      onFps?.(a.frames / a.time);
      a.frames = 0;
      a.time = 0;
    }
  });
  return null;
}

function SceneContents(props: TowerSceneProps) {
  const high = props.quality === "high";
  const topY = props.levels.length * BLOCK_H;
  const focusY = props.selected ? props.selected.level * BLOCK_H : props.placeSlots ? topY : null;
  return (
    <>
      <color attach="background" args={["#160f0a"]} />
      <fog attach="fog" args={["#160f0a", 14, 34]} />
      <hemisphereLight args={["#ffe2c0", "#20140c", 0.55]} />
      <ambientLight intensity={0.18} />
      <directionalLight
        position={[5, 11, 4]}
        intensity={1.9}
        color="#fff1dc"
        castShadow={high}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={9}
        shadow-camera-bottom={-3}
        shadow-camera-near={1}
        shadow-camera-far={30}
        shadow-bias={-0.0006}
      />
      <directionalLight position={[-6, 4, -5]} intensity={0.45} color="#9bb8ff" />
      <pointLight position={[0, 2.5, 0]} intensity={0.6} distance={9} color="#ffb870" />
      <Table quality={props.quality} />
      <Tower {...props} />
      <CameraRig topY={topY} focusY={focusY} closeUp={!!props.selected && props.grabbable} />
      <FpsProbe onFps={props.onFps} />
    </>
  );
}

export default function Tower3D(props: TowerSceneProps) {
  const high = props.quality === "high";
  return (
    <Canvas
      shadows={high}
      dpr={high ? [1, 1.75] : 1}
      gl={{ antialias: high, powerPreference: "high-performance" }}
      camera={{ fov: 38, position: [8, 5, 8], near: 0.1, far: 80 }}
      style={{ touchAction: "none" }}
    >
      <SceneContents {...props} />
    </Canvas>
  );
}
