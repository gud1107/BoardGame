/**
 * 랜덤 합성 디펜스 3D 보드 — plain three.js (no R3F), display only.
 *
 * MergeDefenseBoard keeps every rule and input decision. Its render loop calls
 * `render(frame)` once per animation frame, so the 3D scene and the 2D overlay
 * canvas on top of it (effects, HP bars, labels, pointer input) always show
 * the same instant. The camera is orthographic: the board plane then maps to
 * the screen by an affine transform (`Proj`), which lets the overlay reuse the
 * existing 2D effect drawing and turn taps back into board coordinates.
 *
 * World: board point (x, y) sits at X = x − BOARD_W/2, Z = y − BOARD_H/2 on
 * the ground (Y = 0); 1 world unit = 1 board unit. Models face +X; a yaw of
 * −atan2(dy, dx) points them along a board direction.
 *
 * Towers and monsters are created/destroyed imperatively (keyed by slot and
 * mob id) — no React reconciliation per frame. Light count is fixed so
 * shaders never recompile mid-game; glows are additive meshes.
 */

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { BOARD_H, BOARD_W, CELL, GRADE_COLORS, MAP, SLOTS, UNITS, TICKS_PER_SEC, mobTier, pathPoint, slotCenter, unitInterval, unitRange, type Board, type Mob, type Unit, type UnitKind } from "../engine";
import { fieldImage, mobSize, SEAT_COLORS, type BoardProj } from "../render";

/** Board plane → CSS pixels (see render.ts BoardProj). */
export type Proj = BoardProj;

export interface Frame3D {
  board: Board;
  /** 0..1 fraction of a tick since the state arrived (0 when not playing). */
  alpha: number;
  now: number;
  selected: number | null;
  buildSlot: number | null;
  highlight: Set<number>;
  dropTarget: number | null;
  coverage: number[] | null;
  bornAt: Record<number, { t: number; big: boolean }>;
  hits: Map<number, number>;
  firedAt: Record<number, number>;
  aim: Record<number, number>;
  selectedMob: number | null;
  /** Screen shake offset (board units) and slow-motion zoom around a board point. */
  shake: { x: number; y: number };
  zoom: { z: number; x: number; y: number };
}

export interface DefenseScene {
  /** Draws one frame; returns the board→screen map for the overlay (null if the canvas has no size yet). */
  render(frame: Frame3D): Proj | null;
  dispose(): void;
}

/** Camera elevation — steep enough that every pad stays readable, low enough that towers stand up. */
const ELEV = THREE.MathUtils.degToRad(50);
const PAD_TOP = 6;
const W2 = BOARD_W / 2;
const H2 = BOARD_H / 2;
const toX = (x: number) => x - W2;
const toZ = (y: number) => y - H2;

// ---------------------------------------------------------------------------
// Shared geometry / material caches (live for the scene's lifetime)
// ---------------------------------------------------------------------------

type Mat = THREE.MeshStandardMaterial;
interface Caches {
  geo: Map<string, THREE.BufferGeometry>;
  mat: Map<string, THREE.Material>;
  tex: THREE.Texture[];
}
let C: Caches = { geo: new Map(), mat: new Map(), tex: [] };

function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = C.geo.get(key) as T | undefined;
  if (!g) {
    g = make();
    C.geo.set(key, g);
  }
  return g;
}

interface StdOpts {
  emissive?: string;
  ei?: number;
  rough?: number;
  metal?: number;
  opacity?: number;
  flat?: boolean;
  side?: THREE.Side;
}
function std(color: string, o: StdOpts = {}): Mat {
  const key = `s:${color}:${o.emissive ?? ""}:${o.ei ?? 0}:${o.rough ?? 0.7}:${o.metal ?? 0}:${o.opacity ?? 1}:${o.flat ? 1 : 0}:${o.side ?? 0}`;
  let m = C.mat.get(key) as Mat | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      emissive: o.emissive ?? "#000000",
      emissiveIntensity: o.ei ?? 0,
      roughness: o.rough ?? 0.7,
      metalness: o.metal ?? 0,
      flatShading: !!o.flat,
      transparent: (o.opacity ?? 1) < 1,
      opacity: o.opacity ?? 1,
      side: o.side ?? THREE.FrontSide,
    });
    C.mat.set(key, m);
  }
  return m;
}
/** Unshared standard material (per-object animated emissive / colour). */
function ownStd(color: string, o: StdOpts = {}): Mat {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: o.emissive ?? "#000000",
    emissiveIntensity: o.ei ?? 0,
    roughness: o.rough ?? 0.6,
    metalness: o.metal ?? 0,
    flatShading: !!o.flat,
  });
}
function glow(color: string, opacity = 1, own = false): THREE.MeshBasicMaterial {
  const make = () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
  if (own) return make();
  const key = `g:${color}:${opacity}`;
  let m = C.mat.get(key) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = make();
    C.mat.set(key, m);
  }
  return m;
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  return o;
}

const sphere = (r: number, w = 14, h = 10) => geo(`sph:${r}:${w}:${h}`, () => new THREE.SphereGeometry(r, w, h));
const cyl = (rt: number, rb: number, h: number, n = 10) => geo(`cyl:${rt}:${rb}:${h}:${n}`, () => new THREE.CylinderGeometry(rt, rb, h, n));
const cone = (r: number, h: number, n = 10) => geo(`cone:${r}:${h}:${n}`, () => new THREE.ConeGeometry(r, h, n));
const box = (w: number, h: number, d: number) => geo(`box:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));
const torus = (r: number, t: number, rs = 6, ts = 24, arc = Math.PI * 2) => geo(`tor:${r}:${t}:${rs}:${ts}:${arc}`, () => new THREE.TorusGeometry(r, t, rs, ts, arc));
const octa = (r: number) => geo(`oct:${r}`, () => new THREE.OctahedronGeometry(r));
const dodeca = (r: number) => geo(`dod:${r}`, () => new THREE.DodecahedronGeometry(r));
const capsule = (r: number, l: number) => geo(`cap:${r}:${l}`, () => new THREE.CapsuleGeometry(r, l, 4, 10));
/** A flat ring lying on the ground (unit radius → scale it). */
const flatRing = (inner: number) =>
  geo(`fring:${inner}`, () => {
    const g = new THREE.RingGeometry(inner, 1, 48);
    g.rotateX(-Math.PI / 2);
    return g;
  });
const flatDisc = () =>
  geo("fdisc", () => {
    const g = new THREE.CircleGeometry(1, 40);
    g.rotateX(-Math.PI / 2);
    return g;
  });
/** A wing: a flat triangle-fan hinged at the origin, spreading along +Z. */
const wing = () =>
  geo("wing", () => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(-0.35, 0.55);
    shape.quadraticCurveTo(-0.1, 1.05, 0.2, 1);
    shape.lineTo(0.15, 0.7);
    shape.lineTo(0.45, 0.6);
    shape.lineTo(0.35, 0.3);
    shape.lineTo(0.6, 0.15);
    shape.closePath();
    const g = new THREE.ShapeGeometry(shape);
    // Shape is in XY; lay it in the XZ plane so +Y → +Z.
    g.rotateX(Math.PI / 2);
    return g;
  });

function canvasTexture(size: number, paint: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  paint(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  C.tex.push(t);
  return t;
}

let blobTex: THREE.Texture | null = null;
/** Soft round shadow (radial alpha) — under every tower and monster, even without shadow maps. */
function blobMaterial(): THREE.MeshBasicMaterial {
  const key = "blob";
  let m = C.mat.get(key) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    blobTex ??= canvasTexture(64, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(0,0,0,0.55)");
      g.addColorStop(0.6, "rgba(0,0,0,0.25)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    });
    m = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false });
    C.mat.set(key, m);
  }
  return m;
}
let softTex: THREE.Texture | null = null;
/** Radial white→clear for additive glow discs (tinted by material colour). */
function softGlow(color: string, own = false): THREE.MeshBasicMaterial {
  softTex ??= canvasTexture(64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.45, "rgba(255,255,255,0.45)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
  const make = () => new THREE.MeshBasicMaterial({ color, map: softTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  if (own) return make();
  const key = `soft:${color}`;
  let m = C.mat.get(key) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = make();
    C.mat.set(key, m);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Towers
// ---------------------------------------------------------------------------

/** Pedestal materials by grade: [top, base, rim] — mirrors render.ts MATERIAL. */
const PEDESTAL: [string, string, string][] = [
  ["#000000", "#000000", "#000000"],
  ["#d1d5db", "#4b5563", "#9ca3af"],
  ["#bfdbfe", "#1e3a8a", "#60a5fa"],
  ["#ddd6fe", "#4c1d95", "#a78bfa"],
  ["#fef3c7", "#92400e", "#fbbf24"],
  ["#ffe4e6", "#881337", "#fb7185"],
];
/** Height of each tower's top (above the pad) — for stun stars and the lift. */
const TOWER_TOP: Record<UnitKind, number> = { archer: 30, mage: 42, frost: 30, thunder: 34, poison: 22, cannon: 20, holy: 38, wind: 34, liberty: 42, thinker: 32 };
const BODY_Y = 7.5;
/** Tower bodies are modelled small and scaled up so they read at board size. */
const BODY_SCALE = 1.3;

interface TowerObj {
  key: string;
  root: THREE.Group;
  /** Scaled for pop-in / recoil / lift. */
  pose: THREE.Group;
  stun: THREE.Group;
  /** Per-frame animation (now ms, firing, aim radians or undefined, kick 0..1). */
  tick: (now: number, firing: boolean, aim: number | undefined, kick: number) => void;
  own: THREE.Material[];
}

function buildTower(u: Unit, slot: number, shadows: boolean): TowerObj {
  const root = new THREE.Group();
  const pose = new THREE.Group();
  root.add(pose);
  const own: THREE.Material[] = [];
  const [top, base, rim] = PEDESTAL[u.grade];
  const anims: ((now: number, firing: boolean, aim: number | undefined, kick: number) => void)[] = [];

  // Blob shadow on the pad.
  const blob = mesh(flatDisc(), blobMaterial(), 0, 0.15, 0);
  blob.scale.setScalar(22);
  root.add(blob);

  // 전설+ aura disc on the pad.
  if (u.grade >= 4) {
    const auraMat = softGlow(GRADE_COLORS[u.grade], true);
    own.push(auraMat);
    const aura = mesh(flatDisc(), auraMat, 0, 0.3, 0);
    aura.scale.setScalar(27);
    root.add(aura);
    anims.push((now) => {
      auraMat.opacity = 0.35 + 0.2 * Math.sin(now / 260);
    });
  }

  // Pedestal: two-tier octagon + rim + grade gems on the front.
  const ped = new THREE.Group();
  const p1 = mesh(cyl(18, 19.5, 4, 8), std(base, { rough: 0.55, metal: 0.25, flat: true }), 0, 2, 0);
  const p2 = mesh(cyl(16.5, 18, 3.5, 8), std(top, { rough: 0.45, metal: 0.2, flat: true }), 0, 5.75, 0);
  p1.rotation.y = p2.rotation.y = Math.PI / 8;
  ped.add(p1, p2);
  const rimMat = u.grade === 5 ? ownStd(rim, { emissive: rim, ei: 0.6, metal: 0.6, rough: 0.3 }) : std(rim, { emissive: rim, ei: 0.25, metal: 0.6, rough: 0.35 });
  if (u.grade === 5) {
    own.push(rimMat);
    anims.push((now) => {
      const c = new THREE.Color().setHSL((now / 2400) % 1, 0.85, 0.6);
      rimMat.color.copy(c);
      rimMat.emissive.copy(c);
    });
  }
  const rimMesh = mesh(torus(17.6, 0.9, 4, 8), rimMat, 0, 7.5, 0);
  rimMesh.rotation.set(Math.PI / 2, 0, Math.PI / 8);
  ped.add(rimMesh);
  const gemMat = std(GRADE_COLORS[u.grade], { emissive: GRADE_COLORS[u.grade], ei: 0.7, rough: 0.2, metal: 0.3, flat: true });
  for (let i = 0; i < u.grade; i++) {
    const gx = (i - (u.grade - 1) / 2) * 5.2;
    const gem = mesh(octa(1.7), gemMat, gx, 3.6, 18.7);
    ped.add(gem);
  }
  pose.add(ped);

  const body = new THREE.Group();
  body.position.y = BODY_Y;
  body.scale.setScalar(BODY_SCALE);
  pose.add(body);
  const kindAnim = buildKind(u.kind, body, own, slot);
  anims.push(kindAnim);

  // 신화 sparkles orbiting the tower.
  if (u.grade === 5) {
    const sparks = new THREE.Group();
    const cols = ["#fde68a", "#f9a8d4", "#a5f3fc", "#c4b5fd"];
    cols.forEach((col, i) => {
      const s = mesh(octa(1.6), std(col, { emissive: col, ei: 1, flat: true }), Math.cos((i * Math.PI) / 2) * 21, 14, Math.sin((i * Math.PI) / 2) * 21);
      sparks.add(s);
    });
    pose.add(sparks);
    anims.push((now) => {
      sparks.rotation.y = now / 700;
      sparks.position.y = Math.sin(now / 400) * 2;
    });
  }

  // Stun stars (shown while a berserk boss has this tower stunned).
  const stun = new THREE.Group();
  stun.position.y = BODY_Y + (TOWER_TOP[u.kind] - BODY_Y) * BODY_SCALE + 6;
  const starMat = std("#fde047", { emissive: "#facc15", ei: 0.9, flat: true });
  for (let i = 0; i < 3; i++) {
    const s = mesh(octa(2.2), starMat, Math.cos((i * Math.PI * 2) / 3) * 8, 0, Math.sin((i * Math.PI * 2) / 3) * 8);
    s.scale.y = 0.45;
    stun.add(s);
  }
  stun.visible = false;
  root.add(stun);

  if (shadows) pose.traverse((o) => o instanceof THREE.Mesh && !(o.material as THREE.Material).transparent && (o.castShadow = true));

  return {
    key: `${u.kind}:${u.grade}`,
    root,
    pose,
    stun,
    own,
    tick: (now, firing, aim, kick) => {
      for (const a of anims) a(now, firing, aim, kick);
      if (stun.visible) stun.rotation.y = now / 260;
    },
  };
}

/** Builds one tower kind's body into `body` (origin = pedestal top) and returns its animation. */
function buildKind(kind: UnitKind, body: THREE.Group, own: THREE.Material[], seed: number): (now: number, firing: boolean, aim: number | undefined, kick: number) => void {
  const add = (o: THREE.Object3D) => (body.add(o), o);
  const yawOf = (aim: number | undefined) => (aim === undefined ? -Math.PI / 2 + 0.6 : -aim);
  switch (kind) {
    case "archer": {
      const wood = std("#8b5a2b", { rough: 0.85, flat: true });
      add(mesh(cyl(7, 8.5, 16, 8), wood, 0, 8, 0));
      add(mesh(cyl(10.5, 9, 3, 8), std("#6b4423", { rough: 0.9, flat: true }), 0, 17.5, 0));
      const merlon = std("#a16207", { rough: 0.8, flat: true });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        add(mesh(box(3, 3.2, 3), merlon, Math.cos(a) * 8.6, 20.6, Math.sin(a) * 8.6));
      }
      // Ballista on a turntable — turns to the latest target.
      const aimG = new THREE.Group();
      aimG.position.y = 21;
      add(aimG);
      aimG.add(mesh(box(12, 1.8, 2.2), std("#5b3a1a", { rough: 0.8 }), 2, 2.4, 0));
      const bow = new THREE.Group();
      bow.position.set(6, 2.6, 0);
      const arcMesh = mesh(torus(6, 0.75, 5, 14, Math.PI), std("#f97316", { emissive: "#f97316", ei: 0.25, rough: 0.5 }));
      arcMesh.rotation.set(Math.PI / 2, Math.PI / 2, 0, "YXZ");
      bow.add(arcMesh);
      aimG.add(bow);
      const bolt = mesh(cyl(0.45, 0.45, 9, 5), std("#fde68a", { emissive: "#fbbf24", ei: 0.5 }), 3.5, 3.4, 0);
      bolt.rotation.z = Math.PI / 2;
      aimG.add(bolt);
      let yaw = yawOf(undefined);
      return (now, firing, aim, kick) => {
        yaw += (yawOf(aim) - yaw) * 0.25;
        aimG.rotation.y = yaw;
        bow.scale.x = 1 - 0.35 * kick;
        bolt.visible = kick < 0.5;
      };
    }
    case "mage": {
      add(mesh(cyl(6, 8.5, 18, 6), std("#5b5b7a", { rough: 0.8, flat: true }), 0, 9, 0));
      const band = add(mesh(torus(7.4, 0.9, 4, 6), std("#d4af37", { metal: 0.9, rough: 0.3 }), 0, 14, 0));
      band.rotation.x = Math.PI / 2;
      add(mesh(cone(9.5, 13, 6), std("#7e22ce", { rough: 0.55, flat: true }), 0, 24.5, 0));
      const orbMat = ownStd("#e9d5ff", { emissive: "#a855f7", ei: 1.1, rough: 0.2 });
      own.push(orbMat);
      const orb = add(mesh(sphere(3.6), orbMat, 0, 36, 0));
      const halo = add(mesh(sphere(6.5, 12, 8), softGlow("#a855f7"), 0, 36, 0));
      const runes = new THREE.Group();
      runes.position.y = 36;
      for (let i = 0; i < 3; i++) runes.add(mesh(octa(1.1), std("#c084fc", { emissive: "#c084fc", ei: 1, flat: true }), Math.cos((i * Math.PI * 2) / 3) * 6, 0, Math.sin((i * Math.PI * 2) / 3) * 6));
      add(runes);
      return (now, firing) => {
        const bob = Math.sin(now / 380 + seed) * 1.6;
        orb.position.y = halo.position.y = runes.position.y = 36 + bob;
        runes.rotation.y = now / 500;
        const s = firing ? 1.4 : 1;
        orb.scale.setScalar(s);
        orbMat.emissiveIntensity = firing ? 2.2 : 1.1;
        halo.scale.setScalar(firing ? 1.5 : 1);
      };
    }
    case "frost": {
      add(mesh(cyl(9, 11, 3, 6), std("#bae6fd", { rough: 0.3, flat: true }), 0, 1.5, 0));
      const ice = std("#7dd3fc", { emissive: "#0ea5e9", ei: 0.35, rough: 0.12, metal: 0.1, opacity: 0.88, flat: true });
      const cluster = new THREE.Group();
      add(cluster);
      const big = mesh(octa(1), ice, 0, 13, 0);
      big.scale.set(3.6, 12, 3.6);
      cluster.add(big);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        const c = mesh(octa(1), ice, Math.cos(a) * 5.5, 7.5, Math.sin(a) * 5.5);
        c.scale.set(2.2, 6.5 + (i % 2) * 2, 2.2);
        c.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
        cluster.add(c);
      }
      const chill = add(mesh(sphere(8, 12, 8), softGlow("#38bdf8"), 0, 14, 0));
      return (now, firing) => {
        cluster.rotation.y = now / 2400;
        chill.scale.setScalar(firing ? 1.6 : 1 + 0.08 * Math.sin(now / 300));
      };
    }
    case "thunder": {
      add(mesh(cyl(2.2, 3.6, 24, 6), std("#475569", { metal: 0.8, rough: 0.35, flat: true }), 0, 12, 0));
      const copper = std("#b45309", { metal: 0.9, rough: 0.3, emissive: "#b45309", ei: 0.15 });
      for (let i = 0; i < 3; i++) {
        const c = add(mesh(torus(5.4 - i * 1.1, 0.9, 5, 16), copper, 0, 8 + i * 5, 0));
        c.rotation.x = Math.PI / 2;
      }
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const p = add(mesh(cone(0.8, 5, 5), std("#94a3b8", { metal: 0.8, rough: 0.3 }), Math.cos(a) * 3.2, 25, Math.sin(a) * 3.2));
        p.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
      }
      const coreMat = ownStd("#fef9c3", { emissive: "#facc15", ei: 1.2, rough: 0.2 });
      own.push(coreMat);
      const core = add(mesh(sphere(4.2), coreMat, 0, 28, 0));
      const halo = add(mesh(sphere(8, 12, 8), softGlow("#facc15"), 0, 28, 0));
      return (now, firing) => {
        const flick = firing ? 2.5 : 1 + 0.35 * Math.max(0, Math.sin(now / 47 + seed) * Math.sin(now / 113));
        coreMat.emissiveIntensity = flick;
        halo.scale.setScalar(firing ? 1.7 : 0.9 + 0.15 * flick);
        core.scale.setScalar(firing ? 1.25 : 1);
      };
    }
    case "poison": {
      const iron = std("#1f2937", { metal: 0.6, rough: 0.45 });
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const l = add(mesh(cyl(0.9, 0.9, 7, 5), iron, Math.cos(a) * 6.5, 3, Math.sin(a) * 6.5));
        l.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
      }
      const th0 = Math.PI * 0.35;
      add(mesh(geo("cauldron", () => new THREE.SphereGeometry(10.5, 16, 10, 0, Math.PI * 2, th0, Math.PI - th0)), std("#1f2937", { metal: 0.55, rough: 0.4, side: THREE.DoubleSide }), 0, 12, 0));
      const rimY = 12 + 10.5 * Math.cos(th0);
      const rimR = 10.5 * Math.sin(th0);
      const potRim = add(mesh(torus(rimR, 1.1, 6, 20), std("#374151", { metal: 0.7, rough: 0.35 }), 0, rimY, 0));
      potRim.rotation.x = Math.PI / 2;
      const brew = add(mesh(flatDisc(), std("#22c55e", { emissive: "#16a34a", ei: 0.9, rough: 0.3 }), 0, rimY - 1.2, 0));
      brew.scale.setScalar(rimR - 0.6);
      add(mesh(sphere(9, 12, 8), softGlow("#22c55e"), 0, rimY + 2, 0)).scale.set(1, 0.5, 1);
      const bubbleMat = std("#86efac", { emissive: "#22c55e", ei: 1 });
      const bubbles = [0, 1, 2].map((i) => add(mesh(sphere(1.6, 8, 6), bubbleMat, Math.cos(i * 2.1) * 4, rimY, Math.sin(i * 2.1) * 4)));
      return (now, firing) => {
        bubbles.forEach((b, i) => {
          const t = (now / (firing ? 380 : 700) + i / 3 + seed * 0.1) % 1;
          b.position.y = rimY + t * 9;
          b.scale.setScalar(1 - t * 0.7);
        });
      };
    }
    case "cannon": {
      const wood = std("#7c4a24", { rough: 0.85, flat: true });
      add(mesh(box(15, 5, 10), wood, 0, 5.5, 0));
      const wheelMat = std("#3f2a14", { rough: 0.9, flat: true });
      for (const z of [-6, 6]) {
        const wh = add(mesh(cyl(4.6, 4.6, 2, 10), wheelMat, -2, 4.6, z));
        wh.rotation.x = Math.PI / 2;
      }
      const aimG = new THREE.Group();
      aimG.position.y = 9;
      add(aimG);
      const barrel = new THREE.Group();
      aimG.add(barrel);
      const tube = mesh(cyl(2.8, 3.9, 17, 12), std("#3f3f46", { metal: 0.8, rough: 0.35 }), 0, 0, 0);
      tube.rotation.z = -Math.PI / 2 + 0.32;
      tube.position.set(3, 2.6, 0);
      barrel.add(tube);
      const muzzle = mesh(torus(3, 0.9, 5, 14), std("#d4af37", { metal: 0.9, rough: 0.3 }), 11, 5.4, 0);
      muzzle.rotation.y = Math.PI / 2;
      muzzle.rotation.x = 0.32;
      barrel.add(muzzle);
      const flash = mesh(sphere(4.5, 10, 8), softGlow("#fb923c", true), 13, 6, 0);
      own.push(flash.material as THREE.Material);
      barrel.add(flash);
      let yaw = yawOf(undefined);
      return (now, firing, aim, kick) => {
        yaw += (yawOf(aim) - yaw) * 0.2;
        aimG.rotation.y = yaw;
        barrel.position.x = -3 * kick;
        (flash.material as THREE.MeshBasicMaterial).opacity = kick;
        flash.scale.setScalar(0.5 + kick);
      };
    }
    case "holy": {
      const marble = std("#f5f5f4", { rough: 0.35 });
      add(mesh(cyl(4.5, 5.5, 20, 12), marble, 0, 10, 0));
      add(mesh(cyl(6.5, 5, 2.4, 12), std("#d4af37", { metal: 0.9, rough: 0.3 }), 0, 21, 0));
      const sun = new THREE.Group();
      sun.position.set(0, 30, 0);
      add(sun);
      const gold = std("#fbbf24", { emissive: "#f59e0b", ei: 0.8, metal: 0.6, rough: 0.3 });
      sun.add(mesh(torus(6.5, 1.2, 6, 20), gold));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r = mesh(cone(1.2, 4.5, 4), gold, Math.cos(a) * 9.5, Math.sin(a) * 9.5, 0);
        r.rotation.z = a - Math.PI / 2;
        sun.add(r);
      }
      const coreMat = ownStd("#fef3c7", { emissive: "#fde68a", ei: 1.3, rough: 0.2 });
      own.push(coreMat);
      sun.add(mesh(sphere(3.4), coreMat));
      const halo = mesh(sphere(10, 12, 8), softGlow("#fbbf24"));
      sun.add(halo);
      return (now, firing) => {
        sun.rotation.z = now / 900;
        coreMat.emissiveIntensity = firing ? 2.6 : 1.3;
        halo.scale.setScalar(firing ? 1.5 : 1 + 0.06 * Math.sin(now / 260));
      };
    }
    case "wind": {
      add(mesh(cyl(5, 8, 22, 8), std("#e2e8f0", { rough: 0.6, flat: true }), 0, 11, 0));
      add(mesh(cone(6.8, 8, 8), std("#0d9488", { rough: 0.5, flat: true }), 0, 26, 0));
      const hub = new THREE.Group();
      hub.position.set(0, 20, 6.6);
      add(hub);
      hub.add(mesh(sphere(1.8, 8, 6), std("#334155", { metal: 0.6 })));
      const blade = std("#5eead4", { emissive: "#14b8a6", ei: 0.3, rough: 0.5, flat: true });
      for (let i = 0; i < 4; i++) {
        const arm = new THREE.Group();
        arm.rotation.z = (i * Math.PI) / 2;
        arm.add(mesh(box(2.6, 12, 0.6), blade, 0, 7, 0));
        hub.add(arm);
      }
      const gust = add(mesh(torus(9, 0.5, 4, 24), glow("#99f6e4", 0.5), 0, 6, 0));
      gust.rotation.x = Math.PI / 2;
      let spin = 0;
      let last = 0;
      return (now, firing) => {
        const dt = last ? Math.min(100, now - last) : 16;
        last = now;
        spin += dt * (firing ? 0.03 : 0.008);
        hub.rotation.z = -spin;
        gust.rotation.z = spin * 0.5;
        gust.scale.setScalar(1 + 0.1 * Math.sin(now / 200));
      };
    }
    case "liberty": {
      add(mesh(box(14, 5, 14), std("#a8a29e", { rough: 0.8, flat: true }), 0, 2.5, 0));
      const copper = std("#0f9f8a", { rough: 0.55, metal: 0.35, flat: true });
      add(mesh(cone(7, 21, 10), copper, 0, 15.5, 0));
      add(mesh(sphere(3.4, 12, 8), copper, 0, 28, 0));
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI / 2 + ((i - 3) / 6) * Math.PI * 0.9;
        const sp = add(mesh(cone(0.7, 3.4, 4), copper, Math.cos(a) * 3, 31, Math.sin(a) * 3 + 0.8));
        sp.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
      }
      const arm = add(mesh(cyl(1.1, 1.3, 10, 6), copper, 4, 30, 0));
      arm.rotation.z = -0.22;
      add(mesh(cone(1.9, 4, 8), std("#d4af37", { metal: 0.9, rough: 0.3 }), 5.2, 35.5, 0)).rotation.x = Math.PI;
      const flameMat = ownStd("#fdba74", { emissive: "#f97316", ei: 1.6, rough: 0.4 });
      own.push(flameMat);
      const flame = add(mesh(cone(2, 5.5, 8), flameMat, 5.2, 40, 0));
      const halo = add(mesh(sphere(6, 10, 8), softGlow("#fb923c"), 5.2, 40, 0));
      add(mesh(box(4, 6.5, 1.6), std("#0d9488", { rough: 0.6, flat: true }), -5.2, 18, 2.4)).rotation.z = 0.25;
      return (now, firing) => {
        const f = 1 + 0.18 * Math.sin(now / 70 + seed) + (firing ? 0.5 : 0);
        flame.scale.set(1, f, 1);
        flameMat.emissiveIntensity = firing ? 2.8 : 1.6;
        halo.scale.setScalar(firing ? 1.6 : 0.9 + 0.1 * f);
      };
    }
    case "thinker": {
      const obsidian = std("#111827", { rough: 0.25, metal: 0.4 });
      const gold = std("#d4af37", { metal: 1, rough: 0.25, emissive: "#a16207", ei: 0.15 });
      add(mesh(box(17, 8, 13), obsidian, 0, 4, 0));
      add(mesh(box(17.6, 1, 13.6), gold, 0, 7.8, 0));
      add(mesh(box(17.6, 1, 13.6), gold, 0, 0.6, 0));
      const marble = std("#f8fafc", { rough: 0.35 });
      const torso = add(mesh(capsule(3.3, 6), marble, 0, 14.5, -1.2));
      torso.rotation.x = 0.45;
      add(mesh(sphere(2.9, 12, 10), marble, 0, 20.5, 2.6));
      for (const x of [-2.1, 2.1]) {
        const thigh = add(mesh(capsule(1.6, 5), marble, x, 10.4, 2));
        thigh.rotation.x = Math.PI / 2;
        add(mesh(capsule(1.4, 4), marble, x, 7.8, 5.2));
      }
      const forearm = add(mesh(capsule(1.2, 6), marble, 1.4, 15.5, 4.2));
      forearm.rotation.x = -0.35;
      const ideas = new THREE.Group();
      ideas.position.set(0, 27, 2.6);
      add(ideas);
      const ideaMat = std("#fde68a", { emissive: "#facc15", ei: 1.2 });
      for (let i = 0; i < 3; i++) ideas.add(mesh(sphere(1.1, 8, 6), ideaMat, Math.cos((i * Math.PI * 2) / 3) * 6, 0, Math.sin((i * Math.PI * 2) / 3) * 6));
      const spark = add(mesh(sphere(5, 10, 8), softGlow("#fde68a"), 0, 27, 2.6));
      return (now, firing) => {
        ideas.rotation.y = now / 800;
        ideas.position.y = 27 + Math.sin(now / 500) * 1.2;
        spark.scale.setScalar(firing ? 1.8 : 0.6);
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Monsters
// ---------------------------------------------------------------------------

const SLIME = ["#84cc16", "#06b6d4", "#9333ea", "#9f1239"];
const BAT = [
  { body: "#b45309", wing: "#7c2d12", eye: "#fef08a" },
  { body: "#b91c1c", wing: "#450a0a", eye: "#fef08a" },
  { body: "#4338ca", wing: "#1e1b4b", eye: "#a5f3fc" },
  { body: "#27272a", wing: "#09090b", eye: "#fb7185" },
];
const BEETLE = [
  { shell: "#64748b", head: "#334155", horn: "#e2e8f0" },
  { shell: "#b45309", head: "#78350f", horn: "#fef3c7" },
  { shell: "#047857", head: "#064e3b", horn: "#d1fae5" },
  { shell: "#27272a", head: "#18181b", horn: "#fbbf24" },
];
const DEMON = ["#b91c1c", "#9f1239", "#7e22ce", "#18181b"];
const TIER_RING = ["", "#e2e8f0", "#fbbf24", "#fb7185"];

interface MobObj {
  root: THREE.Group;
  body: THREE.Group;
  size: number;
  /** Body top above the ground (for status icons and spikes). */
  top: number;
  yaw: number;
  flashMat: THREE.MeshBasicMaterial;
  flash: THREE.Mesh;
  rage: THREE.Mesh | null;
  rageMat: THREE.MeshBasicMaterial | null;
  slow: THREE.Group;
  stun: THREE.Group;
  poison: THREE.Group;
  burn: THREE.Group;
  vuln: THREE.Mesh;
  heal: THREE.Mesh | null;
  healMat: THREE.MeshBasicMaterial | null;
  lastHeal: number;
  healAt: number;
  anim: (now: number) => void;
}

function eyesOn(g: THREE.Group, x: number, y: number, gap: number, r: number, iris = "#111827", glowEye?: string) {
  const white = glowEye ? std(glowEye, { emissive: glowEye, ei: 1.4 }) : std("#ffffff", { rough: 0.3 });
  for (const s of [-1, 1]) {
    g.add(mesh(sphere(r, 10, 8), white, x, y, s * gap));
    if (!glowEye) g.add(mesh(sphere(r * 0.55, 8, 6), std(iris, { rough: 0.2 }), x + r * 0.6, y, s * gap));
  }
}

function buildMob(m: Mob): MobObj {
  const tier = mobTier(m);
  const s = mobSize(m);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const add = (o: THREE.Object3D) => (body.add(o), o);
  let top = s * 1.7;
  let anim: (now: number) => void = () => {};
  const id = m.id;

  const blob = mesh(flatDisc(), blobMaterial(), 0, 0.2, 0);
  blob.scale.setScalar(s * 1.15);
  root.add(blob);

  switch (m.kind) {
    case "normal": {
      const col = SLIME[tier];
      const slime = new THREE.Group();
      add(slime);
      slime.add(mesh(sphere(s, 16, 12), std(col, { rough: 0.25, emissive: col, ei: 0.12 }), 0, s * 0.8, 0));
      slime.children[0].scale.set(1.05, 0.82, 1.05);
      slime.add(mesh(sphere(s * 0.35, 8, 6), std("#ffffff", { opacity: 0.45, rough: 0.1 }), -s * 0.2, s * 1.35, -s * 0.35));
      eyesOn(slime, s * 0.78, s * 0.95, s * 0.32, s * 0.22);
      top = s * 1.6;
      anim = (now) => {
        const t = Math.sin(now / 130 + id);
        slime.scale.set(1 + t * 0.09, 1 - t * 0.09, 1 + t * 0.09);
        slime.position.y = Math.abs(Math.sin(now / 160 + id)) * s * 0.25;
      };
      break;
    }
    case "fast": {
      const pal = BAT[tier];
      const bat = new THREE.Group();
      bat.position.y = s * 1.7;
      add(bat);
      bat.add(mesh(sphere(s * 0.7, 12, 10), std(pal.body, { rough: 0.6 })));
      for (const z of [-1, 1]) bat.add(mesh(cone(s * 0.18, s * 0.5, 5), std(pal.body), s * 0.1, s * 0.65, z * s * 0.3));
      eyesOn(bat, s * 0.55, s * 0.15, s * 0.22, s * 0.13, "#111827", pal.eye);
      const wMat = std(pal.wing, { rough: 0.7, side: THREE.DoubleSide });
      const wings = [-1, 1].map((side) => {
        const w = mesh(wing(), wMat, 0, 0, side * s * 0.4);
        w.scale.set(s * 1.4, 1, s * 1.6 * side);
        bat.add(w);
        return w;
      });
      top = s * 2.5;
      anim = (now) => {
        const f = Math.sin(now / 55 + id) * 0.8;
        wings[0].rotation.x = -f;
        wings[1].rotation.x = f;
        bat.position.y = s * 1.7 + Math.sin(now / 200 + id) * s * 0.25;
      };
      break;
    }
    case "tank": {
      const pal = BEETLE[tier];
      const shell = add(mesh(geo("halfsph", () => new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), std(pal.shell, { rough: 0.35, metal: 0.35 }), 0, s * 0.25, 0));
      shell.scale.set(s * 1.25, s * 0.85, s);
      add(mesh(box(s * 2.3, s * 0.08, s * 0.06), std("#0f172a"), 0, s * 1.05, 0));
      add(mesh(sphere(s * 0.45, 10, 8), std(pal.head, { rough: 0.5 }), s * 1.15, s * 0.45, 0));
      const horn = add(mesh(cone(s * 0.15, s * 0.7, 6), std(pal.horn, { metal: 0.3, rough: 0.4 }), s * 1.6, s * 0.75, 0));
      horn.rotation.z = -1.1;
      const legMat = std("#1e293b");
      const legs: THREE.Mesh[] = [];
      for (const x of [-0.6, 0, 0.6])
        for (const z of [-1, 1]) {
          const l = add(mesh(cyl(s * 0.07, s * 0.07, s * 0.7, 4), legMat, x * s, s * 0.25, z * s * 0.95)) as THREE.Mesh;
          l.rotation.x = z * 0.9;
          legs.push(l);
        }
      eyesOn(body, s * 1.45, s * 0.55, s * 0.2, s * 0.11, "#111827", "#fca5a5");
      top = s * 1.3;
      anim = (now) => {
        legs.forEach((l, i) => (l.rotation.z = Math.sin(now / 90 + i * 1.7) * 0.35));
      };
      break;
    }
    case "boss": {
      const col = DEMON[tier];
      const demon = new THREE.Group();
      add(demon);
      demon.add(mesh(sphere(s * 0.95, 18, 14), std(col, { rough: 0.45, emissive: col, ei: 0.15 }), 0, s * 1.1, 0));
      demon.add(mesh(sphere(s * 0.55, 12, 10), std("#fca5a5", { rough: 0.6 }), s * 0.55, s * 0.95, 0));
      const hornMat = std(tier >= 2 ? "#fde68a" : "#e7e5e4", { rough: 0.35, metal: 0.2 });
      for (const z of [-1, 1]) {
        const h = mesh(cone(s * 0.2, s * (0.8 + tier * 0.2), 6), hornMat, s * 0.1, s * 2, z * s * 0.45);
        h.rotation.x = z * 0.45;
        demon.add(h);
      }
      eyesOn(demon, s * 0.82, s * 1.35, s * 0.32, s * 0.15, "#111827", "#fde047");
      const wMat = std(tier === 3 ? "#0a0a0a" : "#450a0a", { rough: 0.7, side: THREE.DoubleSide });
      const wings = [-1, 1].map((side) => {
        const w = mesh(wing(), wMat, -s * 0.3, s * 1.4, side * s * 0.6);
        w.scale.set(s * 1.8, 1, s * 2 * side);
        demon.add(w);
        return w;
      });
      if (tier >= 2) {
        const crownMat = std("#fbbf24", { emissive: "#f59e0b", ei: 0.6, metal: 0.8, rough: 0.3 });
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          demon.add(mesh(cone(s * 0.1, s * 0.4, 4), crownMat, Math.cos(a) * s * 0.4, s * 2.1, Math.sin(a) * s * 0.4));
        }
      }
      top = s * (2.4 + tier * 0.2);
      anim = (now) => {
        const f = Math.sin(now / 240 + id) * 0.4;
        wings[0].rotation.x = -0.3 - f;
        wings[1].rotation.x = 0.3 + f;
        demon.position.y = Math.sin(now / 300 + id) * s * 0.08;
      };
      break;
    }
    case "elite": {
      add(mesh(capsule(s * 0.6, s * 0.7), std("#ea580c", { rough: 0.5, emissive: "#c2410c", ei: 0.35 }), 0, s * 1.05, 0));
      add(mesh(sphere(s * 0.42, 12, 10), std("#fdba74", { rough: 0.6 }), s * 0.2, s * 2, 0));
      eyesOn(body, s * 0.55, s * 2.05, s * 0.16, s * 0.1, "#111827", "#fde047");
      const club = add(mesh(cyl(s * 0.18, s * 0.08, s * 1.4, 6), std("#7c2d12", { rough: 0.9 }), s * 0.2, s * 1.2, s * 0.8));
      club.rotation.x = 0.5;
      top = s * 2.5;
      anim = (now) => {
        club.rotation.z = Math.sin(now / 180 + id) * 0.4;
      };
      break;
    }
    case "invader": {
      const col = m.unitKind ? UNITS[m.unitKind].color : "#7c3aed";
      add(mesh(cyl(s * 0.55, s * 0.75, s * 1.5, 8), std(col, { rough: 0.5, emissive: "#7c3aed", ei: 0.45, flat: true }), 0, s * 0.75, 0));
      add(mesh(cone(s * 0.65, s * 0.7, 8), std("#1e1b4b", { rough: 0.5, flat: true }), 0, s * 1.85, 0));
      for (const z of [-1, 1]) {
        const h = add(mesh(cone(s * 0.12, s * 0.6, 5), std("#e9d5ff", { emissive: "#a855f7", ei: 0.6 }), 0, s * 2, z * s * 0.4));
        h.rotation.x = z * 0.7;
      }
      eyesOn(body, s * 0.6, s * 1.15, s * 0.22, s * 0.12, "#111827", "#f43f5e");
      add(mesh(sphere(s * 1.2, 12, 8), softGlow("#7c3aed"), 0, s, 0));
      top = s * 2.4;
      break;
    }
    case "golem": {
      const rock = std("#78716c", { rough: 0.95, flat: true });
      const g = new THREE.Group();
      add(g);
      g.add(mesh(dodeca(s * 0.8), rock, 0, s * 0.7, 0));
      g.add(mesh(dodeca(s * 0.62), std("#a8a29e", { rough: 0.95, flat: true }), 0.1 * s, s * 1.6, 0));
      g.add(mesh(dodeca(s * 0.42), rock, s * 0.25, s * 2.3, 0));
      for (const z of [-1, 1]) g.add(mesh(dodeca(s * 0.35), rock, 0, s * 1.5, z * s * 0.85));
      eyesOn(g, s * 0.6, s * 2.35, s * 0.15, s * 0.09, "#111827", "#fb923c");
      top = s * 2.7;
      anim = (now) => {
        g.rotation.z = Math.sin(now / 260 + id) * 0.08;
      };
      break;
    }
    case "wraith": {
      const ghost = std("#e0f2fe", { emissive: "#67e8f9", ei: 0.35, opacity: 0.7, rough: 0.3 });
      const g = new THREE.Group();
      add(g);
      const robe = mesh(cone(s * 0.75, s * 1.7, 12), ghost, 0, s * 1.15, 0);
      robe.rotation.z = Math.PI;
      robe.rotation.x = 0;
      g.add(robe);
      g.add(mesh(sphere(s * 0.6, 12, 10), ghost, 0, s * 2, 0));
      eyesOn(g, s * 0.45, s * 2.05, s * 0.2, s * 0.12, "#111827", "#22d3ee");
      g.add(mesh(sphere(s * 1.3, 12, 8), softGlow("#67e8f9"), 0, s * 1.6, 0));
      top = s * 2.7;
      anim = (now) => {
        g.position.y = s * 0.4 + Math.sin(now / 220 + id) * s * 0.2;
        g.rotation.z = Math.sin(now / 300 + id) * 0.15;
      };
      break;
    }
    case "warlord": {
      add(mesh(sphere(s * 0.9, 16, 12), std("#3f6212", { rough: 0.6 }), 0, s * 1.05, 0));
      add(mesh(sphere(s * 0.5, 12, 10), std("#65a30d", { rough: 0.6 }), s * 0.35, s * 1.95, 0));
      const helm = add(mesh(geo("halfsph", () => new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), std("#57534e", { metal: 0.85, rough: 0.3 }), s * 0.35, s * 2.05, 0));
      helm.scale.setScalar(s * 0.56);
      for (const z of [-1, 1]) {
        const h = add(mesh(cone(s * 0.13, s * 0.7, 6), std("#f5f5f4", { rough: 0.4 }), s * 0.35, s * 2.5, z * s * 0.45));
        h.rotation.x = z * 0.8;
      }
      eyesOn(body, s * 0.78, s * 1.95, s * 0.18, s * 0.1, "#111827", "#ef4444");
      const axe = new THREE.Group();
      axe.position.set(0, s * 1.2, s * 0.95);
      axe.add(mesh(cyl(s * 0.08, s * 0.08, s * 1.8, 5), std("#78350f")));
      axe.add(mesh(box(s * 0.7, s * 0.6, s * 0.1), std("#d6d3d1", { metal: 0.9, rough: 0.25 }), s * 0.35, s * 0.7, 0));
      add(axe);
      top = s * 2.9;
      anim = (now) => {
        axe.rotation.z = -0.3 + Math.sin(now / 200 + id) * 0.35;
      };
      break;
    }
    case "knight": {
      const steel = std("#94a3b8", { metal: 0.85, rough: 0.3 });
      add(mesh(cyl(s * 0.55, s * 0.68, s * 1.3, 10), steel, 0, s * 0.85, 0));
      add(mesh(sphere(s * 0.45, 12, 10), steel, 0, s * 1.85, 0));
      add(mesh(box(s * 0.2, s * 0.12, s * 0.6), std("#0f172a"), s * 0.4, s * 1.88, 0));
      add(mesh(cone(s * 0.18, s * 0.7, 6), std("#dc2626", { rough: 0.6 }), -s * 0.1, s * 2.45, 0));
      const shield = add(mesh(box(s * 0.9, s * 1.1, s * 0.15), std("#1e3a8a", { rough: 0.4, metal: 0.4 }), s * 0.2, s * 0.95, s * 0.75));
      shield.add(mesh(box(s * 0.25, s * 0.8, s * 0.05), std("#fbbf24", { metal: 0.9, rough: 0.3 }), 0, 0, s * 0.09));
      top = s * 2.6;
      anim = (now) => {
        body.position.y = Math.abs(Math.sin(now / 150 + id)) * s * 0.12;
      };
      break;
    }
    case "shaman": {
      add(mesh(cone(s * 0.7, s * 1.6, 10), std("#6d28d9", { rough: 0.7, flat: true }), 0, s * 0.8, 0));
      add(mesh(sphere(s * 0.38, 12, 10), std("#a3e635", { rough: 0.6 }), 0, s * 1.75, 0));
      add(mesh(cone(s * 0.45, s * 0.6, 8), std("#4c1d95", { flat: true }), 0, s * 2.2, 0));
      eyesOn(body, s * 0.32, s * 1.8, s * 0.13, s * 0.08, "#111827", "#fde047");
      add(mesh(cyl(s * 0.06, s * 0.06, s * 2.2, 5), std("#78350f"), s * 0.3, s * 1.1, s * 0.6));
      const orb = add(mesh(sphere(s * 0.22, 10, 8), std("#86efac", { emissive: "#22c55e", ei: 1.4 }), s * 0.3, s * 2.3, s * 0.6));
      top = s * 2.6;
      anim = (now) => {
        orb.position.y = s * 2.3 + Math.sin(now / 250 + id) * s * 0.1;
      };
      break;
    }
  }

  // Tier spikes on top (정예+, not on the boss — it has horns / a crown).
  if (tier >= 2 && m.kind !== "boss") {
    const n = tier === 3 ? 4 : 3;
    const spikeMat = std(tier === 3 ? "#fda4af" : "#fde68a", { emissive: tier === 3 ? "#9f1239" : "#a16207", ei: 0.4, flat: true });
    for (let i = 0; i < n; i++) {
      const sp = mesh(cone(s * 0.13, s * 0.5, 4), spikeMat, -s * 0.2 + (i - (n - 1) / 2) * s * 0.3, top - s * 0.15, 0);
      sp.rotation.z = 0.35;
      body.add(sp);
    }
  }

  // Ground rings: rank tier + the seat that sent it.
  if (tier >= 1) {
    const r = mesh(flatRing(0.88), glow(TIER_RING[tier], 0.85), 0, 0.5, 0);
    r.scale.setScalar(s * 1.15);
    root.add(r);
    if (tier === 3) {
      let auraMat = C.mat.get("abyss");
      if (!auraMat) {
        auraMat = new THREE.MeshBasicMaterial({ color: "#3b0718", transparent: true, opacity: 0.25, depthWrite: false });
        C.mat.set("abyss", auraMat);
      }
      root.add(mesh(sphere(s * 1.6, 12, 8), auraMat, 0, s, 0));
    }
  }
  if (m.from >= 0) {
    const r = mesh(flatRing(0.82), glow(SEAT_COLORS[m.from] ?? "#ffffff", 0.9), 0, 0.6, 0);
    r.scale.setScalar(s * 1.35);
    root.add(r);
  }

  const flashMat = glow("#ffffff", 0, true);
  const flash = mesh(sphere(s * 1.25, 12, 8), flashMat, 0, top * 0.5, 0);
  flash.visible = false;
  root.add(flash);

  let rage: THREE.Mesh | null = null;
  let rageMat: THREE.MeshBasicMaterial | null = null;
  if (m.kind === "boss" || m.kind === "warlord") {
    rageMat = softGlow("#ef4444", true);
    rage = mesh(sphere(s * 2, 12, 8), rageMat, 0, top * 0.5, 0);
    rage.visible = false;
    root.add(rage);
  }

  const iceMat = std("#e0f2fe", { emissive: "#7dd3fc", ei: 0.8, flat: true });
  const slow = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const c = mesh(octa(1.6), iceMat, Math.cos((i * Math.PI * 2) / 3) * s * 1.1, 0, Math.sin((i * Math.PI * 2) / 3) * s * 1.1);
    c.scale.y = 1.8;
    slow.add(c);
  }
  slow.position.y = top * 0.5;
  root.add(slow);

  const stun = new THREE.Group();
  const shell = mesh(sphere(s * 1.15, 12, 8), std("#bae6fd", { opacity: 0.32, rough: 0.1, emissive: "#38bdf8", ei: 0.3 }), 0, top * 0.45, 0);
  stun.add(shell);
  const starMat = std("#fde047", { emissive: "#facc15", ei: 1, flat: true });
  const stars = new THREE.Group();
  stars.position.y = top + 4;
  for (let i = 0; i < 3; i++) {
    const st = mesh(octa(2), starMat, Math.cos((i * Math.PI * 2) / 3) * s * 0.8, 0, Math.sin((i * Math.PI * 2) / 3) * s * 0.8);
    st.scale.y = 0.45;
    stars.add(st);
  }
  stun.add(stars);
  root.add(stun);

  const poison = new THREE.Group();
  const bubbleMat = std("#86efac", { emissive: "#22c55e", ei: 1.2 });
  for (let i = 0; i < 3; i++) poison.add(mesh(sphere(1.3, 8, 6), bubbleMat, (i - 1) * s * 0.5, 0, (i % 2 ? 1 : -1) * s * 0.2));
  root.add(poison);

  const burn = new THREE.Group();
  const flameMat = glow("#fb923c", 0.85);
  for (let i = 0; i < 4; i++) burn.add(mesh(cone(1.6, 5, 6), flameMat, (i - 1.5) * s * 0.45, 0, (i % 2 ? 1 : -1) * s * 0.3));
  root.add(burn);

  const vuln = mesh(torus(1, 0.06, 4, 32), glow("#fb7185", 0.9), 0, top * 0.5, 0);
  vuln.scale.setScalar(s * 1.3);
  vuln.rotation.x = Math.PI / 2;
  root.add(vuln);

  let heal: THREE.Mesh | null = null;
  let healMat: THREE.MeshBasicMaterial | null = null;
  if (m.kind === "shaman") {
    healMat = glow("#4ade80", 0, true);
    heal = mesh(flatRing(0.9), healMat, 0, 0.8, 0);
    heal.visible = false;
    root.add(heal);
  }

  return { root, body, size: s, top, yaw: 0, flashMat, flash, rage, rageMat, slow, stun, poison, burn, vuln, heal, healMat, lastHeal: -1, healAt: m.healAt ?? -1, anim };
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export function createDefenseScene(canvas: HTMLCanvasElement, quality: "high" | "low"): DefenseScene {
  C = { geo: new Map(), mat: new Map(), tex: [] };
  blobTex = null;
  softTex = null;
  const shadows = quality === "high";
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 3000);

  // Lights — fixed count.
  scene.add(new THREE.HemisphereLight("#e0f2fe", "#3f3a2e", 1.1));
  scene.add(new THREE.AmbientLight("#ffffff", 0.25));
  const sun = new THREE.DirectionalLight("#fff1dc", 2.3);
  sun.position.set(-170, 360, 210);
  sun.target.position.set(0, 0, 0);
  scene.add(sun, sun.target);
  if (shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -260;
    sc.right = 260;
    sc.top = 220;
    sc.bottom = -220;
    sc.near = 50;
    sc.far = 900;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.6;
  }

  // Board slab: a bevelled stone plinth, the painted field on top.
  const shape = new THREE.Shape();
  const r = 18;
  shape.moveTo(-W2 + r, -H2);
  shape.lineTo(W2 - r, -H2);
  shape.quadraticCurveTo(W2, -H2, W2, -H2 + r);
  shape.lineTo(W2, H2 - r);
  shape.quadraticCurveTo(W2, H2, W2 - r, H2);
  shape.lineTo(-W2 + r, H2);
  shape.quadraticCurveTo(-W2, H2, -W2, H2 - r);
  shape.lineTo(-W2, -H2 + r);
  shape.quadraticCurveTo(-W2, -H2, -W2 + r, -H2);
  const slabGeo = new THREE.ExtrudeGeometry(shape, { depth: 16, bevelEnabled: true, bevelSize: 4, bevelThickness: 3, bevelSegments: 3, curveSegments: 8 });
  slabGeo.rotateX(-Math.PI / 2);
  slabGeo.translate(0, -19.6, 0);
  C.geo.set("slab", slabGeo);
  const slab = new THREE.Mesh(slabGeo, std("#3b3226", { rough: 0.9 }));
  slab.receiveShadow = shadows;
  scene.add(slab);

  const fieldMat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, alphaTest: 0.5, transparent: false });
  C.mat.set("field", fieldMat);
  const field = new THREE.Mesh(geo("fieldPlane", () => new THREE.PlaneGeometry(BOARD_W, BOARD_H).rotateX(-Math.PI / 2)), fieldMat);
  field.receiveShadow = shadows;
  scene.add(field);
  let fieldKey = "";
  let fieldTex: THREE.CanvasTexture | null = null;

  // Pads (rebuilt with the map).
  const padTex = canvasTexture(128, (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, s, s);
    g.addColorStop(0, "#9aa3b2");
    g.addColorStop(1, "#5a6170");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 3;
    ctx.strokeRect(8, 8, s - 16, s - 16);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(s / 2, s / 2, s * 0.3, s * 0.3, 0, 0, Math.PI * 2);
    ctx.moveTo(s * 0.38, s / 2);
    ctx.lineTo(s * 0.62, s / 2);
    ctx.moveTo(s / 2, s * 0.38);
    ctx.lineTo(s / 2, s * 0.62);
    ctx.stroke();
  });
  const padGeo = geo("pad", () => new RoundedBoxGeometry(CELL - 8, PAD_TOP, CELL - 8, 3, 3));
  const padGroup = new THREE.Group();
  scene.add(padGroup);
  let pads: { mesh: THREE.Mesh; mat: Mat }[] = [];
  let padMap = "";
  const buildPads = () => {
    for (const p of pads) {
      padGroup.remove(p.mesh);
      p.mat.dispose();
    }
    pads = [];
    for (let i = 0; i < SLOTS; i++) {
      const c = slotCenter(i);
      const mat = new THREE.MeshStandardMaterial({ map: padTex, roughness: 0.85, metalness: 0.05, emissive: "#000000" });
      const pm = mesh(padGeo, mat, toX(c.x), PAD_TOP / 2, toZ(c.y));
      pm.receiveShadow = shadows;
      pm.castShadow = shadows;
      padGroup.add(pm);
      pads.push({ mesh: pm, mat });
    }
  };

  // Portal: a swirling vortex on the road + two gyroscope rings.
  const portal = new THREE.Group();
  scene.add(portal);
  const swirl = canvasTexture(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(250,232,255,1)");
    g.addColorStop(0.35, "rgba(192,132,252,0.85)");
    g.addColorStop(1, "rgba(76,29,149,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      for (let t = 0; t < 1; t += 0.02) {
        const a = t * Math.PI * 2.2 + (i * Math.PI) / 2;
        const rr = t * s * 0.46;
        const x = s / 2 + Math.cos(a) * rr;
        const y = s / 2 + Math.sin(a) * rr;
        if (t === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
  const vortexMat = new THREE.MeshBasicMaterial({ map: swirl, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  C.mat.set("vortex", vortexMat);
  const vortex = mesh(flatDisc(), vortexMat, 0, 0.7, 0);
  vortex.scale.setScalar(22);
  portal.add(vortex);
  const ringMat = std("#c084fc", { emissive: "#a855f7", ei: 1.4, metal: 0.4, rough: 0.3 });
  const ring1 = mesh(torus(12, 1.1, 6, 32), ringMat, 0, 14, 0);
  const ring2 = mesh(torus(9, 0.9, 6, 28), ringMat, 0, 14, 0);
  const core = mesh(sphere(9, 14, 10), softGlow("#d8b4fe"), 0, 14, 0);
  portal.add(ring1, ring2, core);

  // Range preview (selected unit / build spot) + build marker + selected-mob ring.
  const rangeDiscMat = new THREE.MeshBasicMaterial({ color: "#fde047", transparent: true, opacity: 0.08, depthWrite: false });
  const rangeEdgeMat = new THREE.MeshBasicMaterial({ color: "#fde047", transparent: true, opacity: 0.7, depthWrite: false });
  C.mat.set("rangeDisc", rangeDiscMat);
  C.mat.set("rangeEdge", rangeEdgeMat);
  const rangeDisc = mesh(flatDisc(), rangeDiscMat, 0, PAD_TOP + 0.4, 0);
  const rangeEdge = new THREE.Mesh(flatRing(0.985), rangeEdgeMat);
  rangeEdge.position.y = PAD_TOP + 0.5;
  rangeDisc.renderOrder = rangeEdge.renderOrder = 2;
  scene.add(rangeDisc, rangeEdge);

  const plus = new THREE.Group();
  const plusMat = std("#fde047", { emissive: "#facc15", ei: 0.9, rough: 0.4 });
  plus.add(mesh(box(12, 3, 3), plusMat), mesh(box(3, 12, 3), plusMat));
  plus.add(mesh(sphere(12, 12, 8), softGlow("#fde047")));
  scene.add(plus);

  const mobRingMat = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.95, depthWrite: false });
  C.mat.set("mobRing", mobRingMat);
  const mobRing = new THREE.Mesh(flatRing(0.85), mobRingMat);
  scene.add(mobRing);

  const towers = new Map<number, TowerObj>();
  const mobs = new Map<number, MobObj>();
  const v = new THREE.Vector3();
  let lastW = 0;
  let lastH = 0;

  const disposeTower = (t: TowerObj) => {
    scene.remove(t.root);
    for (const m of t.own) m.dispose();
  };
  const disposeMob = (o: MobObj) => {
    scene.remove(o.root);
    o.flashMat.dispose();
    o.rageMat?.dispose();
    o.healMat?.dispose();
  };

  function render(f: Frame3D): Proj | null {
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (cw < 2 || ch < 2) return null;
    if (cw !== lastW || ch !== lastH) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === "high" ? 2 : 1.5));
      renderer.setSize(cw, ch, false);
      lastW = cw;
      lastH = ch;
    }
    const { board, now } = f;

    // Field texture follows the map and the board's alive state.
    const key = `${MAP.id}:${board.alive ? 1 : 0}`;
    if (key !== fieldKey) {
      fieldKey = key;
      const img = fieldImage(1600, board.alive);
      if (img) {
        fieldTex?.dispose();
        fieldTex = new THREE.CanvasTexture(img);
        fieldTex.colorSpace = THREE.SRGBColorSpace;
        fieldTex.anisotropy = 4;
        fieldMat.map = fieldTex;
        fieldMat.needsUpdate = true;
      }
    }
    if (MAP.id !== padMap) {
      padMap = MAP.id;
      buildPads();
      for (const t of towers.values()) disposeTower(t);
      towers.clear();
      const p0 = pathPoint(0);
      portal.position.set(toX(p0.x), 0, toZ(p0.y));
    }

    // Portal spin.
    vortex.rotation.y = -now / 500;
    ring1.rotation.set(now / 900, now / 1300, 0);
    ring2.rotation.set(-now / 700, 0, now / 1100);
    core.scale.setScalar(0.9 + 0.12 * Math.sin(now / 240));

    // Pads: merge targets / drop target / build spot / placement guide.
    let covLo = Infinity;
    let covHi = -Infinity;
    if (f.coverage) {
      f.coverage.forEach((cv, i) => {
        if (board.units[i]) return;
        covLo = Math.min(covLo, cv);
        covHi = Math.max(covHi, cv);
      });
    }
    pads.forEach((p, i) => {
      const mat = p.mat;
      const u = board.units[i];
      if (f.highlight.has(i)) {
        mat.emissive.set(u ? GRADE_COLORS[u.grade] : "#ffffff");
        mat.emissiveIntensity = 0.35 + 0.3 * Math.sin(now / 140);
      } else if (f.dropTarget === i) {
        mat.emissive.set("#ffffff");
        mat.emissiveIntensity = 0.35;
      } else if (f.buildSlot === i) {
        mat.emissive.set("#facc15");
        mat.emissiveIntensity = 0.35 + 0.15 * Math.sin(now / 160);
      } else if (f.coverage && !u) {
        const t = covHi > covLo ? (f.coverage[i] - covLo) / (covHi - covLo) : 1;
        mat.emissive.setHSL((t * 130) / 360, 0.85, 0.45);
        mat.emissiveIntensity = 0.25 + t * 0.25;
      } else {
        mat.emissiveIntensity = 0;
      }
    });

    // Range preview.
    const rangeSlot = f.selected ?? f.buildSlot;
    if (rangeSlot !== null && rangeSlot < SLOTS) {
      const u = board.units[rangeSlot];
      const c = slotCenter(rangeSlot);
      const rr = u ? unitRange(u) : 140;
      const col = u ? UNITS[u.kind].color : "#fde047";
      rangeDiscMat.color.set(col);
      rangeEdgeMat.color.set(col);
      rangeDisc.position.set(toX(c.x), PAD_TOP + 0.4, toZ(c.y));
      rangeEdge.position.set(toX(c.x), PAD_TOP + 0.5, toZ(c.y));
      rangeDisc.scale.setScalar(rr);
      rangeEdge.scale.setScalar(rr);
      rangeDisc.visible = rangeEdge.visible = true;
    } else rangeDisc.visible = rangeEdge.visible = false;

    if (f.buildSlot !== null && f.buildSlot < SLOTS) {
      const c = slotCenter(f.buildSlot);
      plus.visible = true;
      plus.position.set(toX(c.x), PAD_TOP + 11 + Math.sin(now / 220) * 2, toZ(c.y));
      plus.rotation.y = now / 600;
    } else plus.visible = false;

    // Towers.
    for (let slot = 0; slot < SLOTS; slot++) {
      const u = board.units[slot];
      let t = towers.get(slot);
      if (!u) {
        if (t) {
          disposeTower(t);
          towers.delete(slot);
        }
        continue;
      }
      const k = `${u.kind}:${u.grade}`;
      if (!t || t.key !== k) {
        if (t) disposeTower(t);
        t = buildTower(u, slot, shadows);
        const c = slotCenter(slot);
        t.root.position.set(toX(c.x), PAD_TOP, toZ(c.y));
        scene.add(t.root);
        towers.set(slot, t);
      }
      const born = f.bornAt[slot];
      const age = born ? (now - born.t) / (born.big ? 650 : 320) : 1;
      t.root.visible = age >= 0;
      let sc = 1;
      if (age >= 0 && age < 1) sc = age < 0.6 ? (age / 0.6) * 1.18 : 1.18 - ((age - 0.6) / 0.4) * 0.18;
      const fired = f.firedAt[slot];
      const kick = fired !== undefined ? Math.max(0, 1 - (now - fired) / 130) : 0;
      const lifted = f.selected === slot;
      const lift = lifted ? 1.08 : 1;
      t.pose.scale.set(Math.max(0.05, sc) * lift * (1 + 0.07 * kick), Math.max(0.05, sc) * lift * (1 - 0.09 * kick), Math.max(0.05, sc) * lift * (1 + 0.07 * kick));
      t.pose.position.y = lifted ? 4 + Math.sin(now / 200) * 1.2 : 0;
      t.stun.visible = !!u.stun;
      const firing = unitInterval(u) - u.cd <= 2;
      t.tick(now, firing, f.aim[slot], kick);
    }

    // Monsters.
    const seen = new Set<number>();
    let ringOn = false;
    for (const m of board.mobs) {
      if (m.hp <= 0) continue;
      seen.add(m.id);
      let o = mobs.get(m.id);
      if (!o) {
        o = buildMob(m);
        scene.add(o.root);
        mobs.set(m.id, o);
        const p0 = pathPoint(m.trav);
        const a0 = pathPoint(m.trav + 4);
        o.yaw = -Math.atan2(a0.y - p0.y, a0.x - p0.x);
      }
      const slow = m.slowT > 0 ? m.slowPct : 0;
      const frozen = (m.stunT ?? 0) > 0;
      const trav = frozen ? m.trav : m.trav + (m.speed * (1 - slow) * f.alpha) / TICKS_PER_SEC;
      const p = pathPoint(trav);
      const ahead = pathPoint(trav + 4);
      o.root.position.set(toX(p.x), 0, toZ(p.y));
      // Turn smoothly toward the road direction (shortest way round).
      const want = -Math.atan2(ahead.y - p.y, ahead.x - p.x);
      let dy = want - o.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      o.yaw += dy * 0.25;
      o.body.rotation.y = o.yaw;
      if (!frozen) o.anim(now);

      const hitAt = f.hits.get(m.id);
      const hit = hitAt !== undefined ? Math.max(0, 1 - (now - hitAt) / 140) : 0;
      o.flash.visible = hit > 0;
      o.flashMat.opacity = 0.85 * hit;
      const fx = Math.cos(o.yaw);
      const fz = -Math.sin(o.yaw);
      o.body.position.set(-fx * 2.2 * hit, o.body.position.y, -fz * 2.2 * hit);
      o.body.scale.set(1 + 0.16 * hit, 1 - 0.13 * hit, 1 + 0.16 * hit);

      if (o.rage && o.rageMat) {
        o.rage.visible = !!m.rage;
        if (m.rage) o.rageMat.opacity = 0.35 + 0.3 * Math.sin(now / 90 + m.id);
      }
      o.slow.visible = m.slowT > 0;
      if (o.slow.visible) o.slow.rotation.y = now / 500;
      o.stun.visible = frozen;
      if (frozen) o.stun.children[1].rotation.y = now / 200;
      o.poison.visible = m.poisonT > 0;
      if (o.poison.visible)
        o.poison.children.forEach((b, i) => {
          const t = (now / 600 + i / 3) % 1;
          b.position.y = o!.top + t * 9;
          b.scale.setScalar(1 - t * 0.6);
        });
      o.burn.visible = (m.burnT ?? 0) > 0;
      if (o.burn.visible)
        o.burn.children.forEach((b, i) => {
          const t = (now / 380 + i / 4) % 1;
          b.position.y = o!.top * 0.4 + t * 10;
          b.scale.setScalar(1 - t * 0.8);
        });
      o.vuln.visible = (m.vulnT ?? 0) > 0;
      if (o.vuln.visible) o.vuln.rotation.z = now / 900;
      if (o.heal && o.healMat) {
        if ((m.healAt ?? -1) !== o.healAt) {
          o.healAt = m.healAt ?? -1;
          o.lastHeal = now;
        }
        const k = o.lastHeal >= 0 ? (now - o.lastHeal) / 700 : 1;
        o.heal.visible = k < 1;
        if (k < 1) {
          o.heal.scale.setScalar(o.size + k * 45);
          o.healMat.opacity = 0.7 * (1 - k);
        }
      }
      if (f.selectedMob === m.id) {
        ringOn = true;
        mobRing.position.set(toX(p.x), 0.9, toZ(p.y));
        mobRing.scale.setScalar(o.size * 1.6 + Math.sin(now / 150) * 1.2);
      }
    }
    for (const [id, o] of mobs) {
      if (!seen.has(id)) {
        disposeMob(o);
        mobs.delete(id);
      }
    }
    mobRing.visible = ringOn;

    // Camera: fit the board, then slow-motion zoom and screen shake.
    const fitW = BOARD_W + 26;
    const fitH = BOARD_H * Math.sin(ELEV) + 50;
    const z = f.zoom.z;
    camera.left = -cw / 2;
    camera.right = cw / 2;
    camera.top = ch / 2;
    camera.bottom = -ch / 2;
    camera.zoom = Math.min(cw / fitW, ch / fitH) * z;
    const tx0 = 0;
    const tz0 = -9;
    const k = z > 1 ? 1 - 1 / z : 0;
    const target = new THREE.Vector3(tx0 + (toX(f.zoom.x) - tx0) * k, 0, tz0 + (toZ(f.zoom.y) - tz0) * k);
    target.x -= f.shake.x;
    target.y += Math.cos(ELEV) * f.shake.y;
    target.z -= Math.sin(ELEV) * f.shake.y;
    camera.position.set(target.x, target.y + Math.sin(ELEV) * 900, target.z + Math.cos(ELEV) * 900);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    renderer.render(scene, camera);

    const pr = (x: number, y: number, h: number): [number, number] => {
      v.set(toX(x), h, toZ(y)).project(camera);
      return [((v.x + 1) / 2) * cw, ((1 - v.y) / 2) * ch];
    };
    const o0 = pr(0, 0, 0);
    const ox = pr(100, 0, 0);
    const oy = pr(0, 100, 0);
    const oh = pr(0, 0, 100);
    return {
      a: (ox[0] - o0[0]) / 100,
      b: (ox[1] - o0[1]) / 100,
      c: (oy[0] - o0[0]) / 100,
      d: (oy[1] - o0[1]) / 100,
      e: o0[0],
      f: o0[1],
      hx: (oh[0] - o0[0]) / 100,
      hy: (oh[1] - o0[1]) / 100,
    };
  }

  return {
    render,
    dispose() {
      for (const t of towers.values()) disposeTower(t);
      for (const o of mobs.values()) disposeMob(o);
      for (const p of pads) p.mat.dispose();
      fieldTex?.dispose();
      for (const g of C.geo.values()) g.dispose();
      for (const m of C.mat.values()) m.dispose();
      for (const t of C.tex) t.dispose();
      C = { geo: new Map(), mat: new Map(), tex: [] };
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
