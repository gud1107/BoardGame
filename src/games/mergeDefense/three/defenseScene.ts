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
 * Performance (2026-10-20 rewrite — the first version drew every part of
 * every monster as its own mesh, ~565 draw calls on a late wave):
 * - Every tower / monster look is a *template*: its parts are baked with
 *   vertex colours and merged per surface, so a whole slime is 2–3 meshes.
 * - Each template part is one InstancedMesh shared by every unit of that
 *   look; animation (wings, aim, bob) is per-instance matrices, glows are
 *   per-instance colours. Draw calls scale with distinct looks, not with
 *   the number of monsters on the road.
 * - Status markers, shadows, rings, pads and ground decoration are global
 *   instanced pools. Nothing allocates per frame.
 * - Resolution adapts to the measured frame time (and drops the shadow map
 *   on slow devices).
 */

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { BOARD_H, BOARD_W, CELL, GRADE_COLORS, MAP, SLOTS, UNITS, TICKS_PER_SEC, mobTier, pathPoint, slotCenter, unitInterval, unitRange, type Board, type Mob, type UnitKind } from "../engine";
import { mobSize, SEAT_COLORS, type BoardProj } from "../render";

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
/** Rotation that turns a +Z-facing disc toward the camera (billboard glows). */
const FACE_CAM = new THREE.Quaternion().setFromEuler(new THREE.Euler(-ELEV, 0, 0));
/** Deterministic 0..1 noise. */
const noise = (i: number, k = 0) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

// ---------------------------------------------------------------------------
// Surfaces — a handful of shared materials; part colours live in vertex colours
// ---------------------------------------------------------------------------

type Surf = "matte" | "satin" | "metal" | "glass" | "glow" | "add";

interface SceneRes {
  geos: THREE.BufferGeometry[];
  mats: THREE.Material[];
  texs: THREE.Texture[];
  surf: Map<Surf, THREE.Material>;
  softTex: THREE.Texture;
}

/** Soft cool rim light baked into the lit surfaces — the "polished toy" edge. */
function withRim(m: THREE.MeshStandardMaterial, strength: number) {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
      {
        vec3 rimV = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
        float rim = pow(1.0 - clamp(dot(normal, rimV), 0.0, 1.0), 2.6);
        totalEmissiveRadiance += vec3(0.62, 0.72, 0.95) * rim * ${strength.toFixed(2)};
      }`,
    );
  };
  m.customProgramCacheKey = () => `rim${strength}`;
  return m;
}

function makeSurfaces(res: SceneRes) {
  const lit = (rough: number, metal: number, rim: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
    withRim(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal, ...extra }), rim);
  res.surf.set("matte", lit(0.78, 0, 0.32));
  res.surf.set("satin", lit(0.38, 0.08, 0.38));
  res.surf.set("metal", lit(0.28, 0.9, 0.25));
  res.surf.set("glass", lit(0.08, 0.1, 0.55, { transparent: true, opacity: 0.82 }));
  res.surf.set("glow", new THREE.MeshBasicMaterial({ vertexColors: true }));
  res.surf.set("add", new THREE.MeshBasicMaterial({ vertexColors: true, map: res.softTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  for (const m of res.surf.values()) res.mats.push(m);
}

function canvasTexture(res: SceneRes, w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  paint(ctx);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  res.texs.push(t);
  return t;
}

// ---------------------------------------------------------------------------
// Geometry primitives (unit-ish, transformed when baked)
// ---------------------------------------------------------------------------

const G = {
  sphere: (r: number, w = 16, h = 12) => new THREE.SphereGeometry(r, w, h),
  cyl: (rt: number, rb: number, h: number, n = 12) => new THREE.CylinderGeometry(rt, rb, h, n),
  cone: (r: number, h: number, n = 10) => new THREE.ConeGeometry(r, h, n),
  box: (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d),
  rbox: (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 2, r),
  torus: (r: number, t: number, rs = 6, ts = 24, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, rs, ts, arc),
  octa: (r: number) => new THREE.OctahedronGeometry(r),
  dodeca: (r: number) => new THREE.DodecahedronGeometry(r),
  capsule: (r: number, l: number) => new THREE.CapsuleGeometry(r, l, 4, 10),
  halfSphere: (r: number) => new THREE.SphereGeometry(r, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2),
  /** Flat disc on the ground (XZ), unit radius. */
  flatDisc: () => new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2),
  /** Disc facing +Z (billboards), unit radius. */
  disc: () => new THREE.CircleGeometry(1, 24),
  flatRing: (inner: number) => new THREE.RingGeometry(inner, 1, 48).rotateX(-Math.PI / 2),
  /** A bat wing: flat fan hinged at the origin, spreading along +Z (XZ plane). */
  wing: () => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(-0.35, 0.55);
    s.quadraticCurveTo(-0.1, 1.05, 0.2, 1);
    s.lineTo(0.15, 0.7);
    s.lineTo(0.45, 0.6);
    s.lineTo(0.35, 0.3);
    s.lineTo(0.6, 0.15);
    s.closePath();
    return new THREE.ShapeGeometry(s).rotateX(Math.PI / 2);
  },
};

// ---------------------------------------------------------------------------
// Templates: baked parts → instanced pools
// ---------------------------------------------------------------------------

/** Per-instance inputs for part animation. Reused — never allocated per frame. */
interface Ctx {
  now: number;
  seed: number;
  /** Tower aim yaw (radians, already smoothed). */
  yaw: number;
  /** 0..1 recoil since the last shot. */
  kick: number;
  /** 1 while the tower is firing. */
  firing: number;
}

/** Writes a node's animated local transform into `o` (already reset to identity). */
type AnimFn = (c: Ctx, o: THREE.Object3D) => void;
/** Writes a per-instance colour (glows, rainbow rims). */
type ColorFn = (c: Ctx, col: THREE.Color) => void;

interface NodeDef {
  base: THREE.Matrix4;
  anim?: AnimFn;
  color?: ColorFn;
  /** Camera-facing (glow discs): keeps only the node's position and scale. */
  bill?: boolean;
}

interface Raw {
  geo: THREE.BufferGeometry;
  surf: Surf;
  node: number;
}

type V3 = [number, number, number];

/** Collects coloured parts (optionally inside animated nodes) for one look. */
class Builder {
  raws: Raw[] = [];
  nodes: NodeDef[] = [];
  private cur = -1;
  /** Applied to everything added (and to node bases) — e.g. the tower body's lift and scale. */
  prefix = new THREE.Matrix4();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();

  private compose(pos: V3, rot: V3, scale: number | V3, order: THREE.EulerOrder = "XYZ") {
    this.e.set(rot[0], rot[1], rot[2], order);
    this.q.setFromEuler(this.e);
    const s = typeof scale === "number" ? new THREE.Vector3(scale, scale, scale) : new THREE.Vector3(...scale);
    return this.m.compose(new THREE.Vector3(...pos), this.q, s);
  }

  /** Adds a part; `c1` makes a bottom→top gradient (c0 at the bottom). */
  add(geo: THREE.BufferGeometry, surf: Surf, c0: string, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: number | V3 = 1, c1?: string, order?: THREE.EulerOrder) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    g.deleteAttribute("uv1");
    if (!g.getAttribute("uv")) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((g.getAttribute("position").count) * 2), 2));
    // Vertex colours (gradient by the part's own height).
    const p = g.getAttribute("position");
    g.computeBoundingBox();
    const y0 = g.boundingBox!.min.y;
    const y1 = g.boundingBox!.max.y;
    const a = new THREE.Color(c0);
    const b = new THREE.Color(c1 ?? c0);
    const col = new Float32Array(p.count * 3);
    const tmp = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const t = y1 > y0 ? (p.getY(i) - y0) / (y1 - y0) : 0;
      tmp.copy(a).lerp(b, t);
      col[i * 3] = tmp.r;
      col[i * 3 + 1] = tmp.g;
      col[i * 3 + 2] = tmp.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const local = this.compose(pos, rot, scale, order).clone();
    if (this.cur < 0) local.premultiply(this.prefix);
    g.applyMatrix4(local);
    this.raws.push({ geo: g, surf, node: this.cur });
    return this;
  }

  /** Parts added inside `fn` move with an animated node at `pos`. */
  node(pos: V3, def: { anim?: AnimFn; color?: ColorFn; bill?: boolean; rot?: V3; scale?: number }, fn: () => void) {
    const base = this.compose(pos, def.rot ?? [0, 0, 0], def.scale ?? 1).clone().premultiply(this.prefix);
    const id = this.nodes.push({ base, anim: def.anim, color: def.color, bill: def.bill }) - 1;
    const prev = this.cur;
    this.cur = id;
    fn();
    this.cur = prev;
    return this;
  }
}

interface PartDef {
  geo: THREE.BufferGeometry;
  surf: Surf;
  node: NodeDef | null;
  nodeIndex: number;
}

/** One look's parts, each an InstancedMesh shared by every instance of that look. */
class Pool {
  meshes: THREE.InstancedMesh[] = [];
  count = 0;
  private cap = 0;
  constructor(
    private scene: THREE.Scene,
    private res: SceneRes,
    readonly parts: PartDef[],
    private nodeCount: number,
    private shadows: boolean,
  ) {
    this.grow(8);
  }

  private grow(cap: number) {
    for (const m of this.meshes) this.scene.remove(m);
    const old = this.meshes;
    this.meshes = this.parts.map((p, i) => {
      const m = new THREE.InstancedMesh(p.geo, this.res.surf.get(p.surf)!, cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (p.node?.color) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      const opaque = p.surf !== "add" && p.surf !== "glass" && p.surf !== "glow";
      m.castShadow = this.shadows && opaque;
      m.receiveShadow = false;
      if (p.surf === "add") m.renderOrder = 3;
      const prev = old[i];
      if (prev) {
        // Keep what was already written this frame.
        (m.instanceMatrix.array as Float32Array).set(prev.instanceMatrix.array as Float32Array);
        if (prev.instanceColor && m.instanceColor) (m.instanceColor.array as Float32Array).set(prev.instanceColor.array as Float32Array);
        prev.dispose();
      }
      this.scene.add(m);
      return m;
    });
    this.cap = cap;
  }

  setShadows(on: boolean) {
    this.shadows = on;
    this.meshes.forEach((m, i) => {
      const s = this.parts[i].surf;
      m.castShadow = on && s !== "add" && s !== "glass" && s !== "glow";
    });
  }

  begin() {
    this.count = 0;
  }

  /** Writes one instance at `root` (world matrix of the look's origin). */
  push(root: THREE.Matrix4, c: Ctx) {
    if (this.count >= this.cap) this.grow(this.cap * 2);
    const i = this.count++;
    for (let n = 0; n < this.nodeCount; n++) nodeDone[n] = 0;
    this.parts.forEach((p, k) => {
      const mesh = this.meshes[k];
      if (!p.node) {
        mesh.setMatrixAt(i, root);
        return;
      }
      const ni = p.nodeIndex;
      if (!nodeDone[ni]) {
        nodeDone[ni] = 1;
        const nm = nodeMats[ni] ?? (nodeMats[ni] = new THREE.Matrix4());
        TMP_OBJ.position.set(0, 0, 0);
        TMP_OBJ.rotation.set(0, 0, 0);
        TMP_OBJ.scale.set(1, 1, 1);
        p.node.anim?.(c, TMP_OBJ);
        TMP_OBJ.updateMatrix();
        nm.multiplyMatrices(root, p.node.base).multiply(TMP_OBJ.matrix);
        if (p.node.bill) {
          nm.decompose(V_POS, Q_TMP, V_SCL);
          nm.compose(V_POS, FACE_CAM, V_SCL.setScalar(Math.max(V_SCL.x, V_SCL.y, V_SCL.z)));
        }
        if (p.node.color) {
          p.node.color(c, COL_TMP);
          nodeCols[ni] = nodeCols[ni] ?? new THREE.Color();
          nodeCols[ni].copy(COL_TMP);
        }
      }
      mesh.setMatrixAt(i, nodeMats[ni]);
      if (p.node.color) mesh.setColorAt(i, nodeCols[ni]);
    });
  }

  end() {
    for (const m of this.meshes) {
      m.count = this.count;
      m.visible = this.count > 0;
      if (this.count > 0) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }
  }

  dispose() {
    for (const m of this.meshes) {
      this.scene.remove(m);
      m.dispose();
    }
    for (const p of this.parts) p.geo.dispose();
  }
}

const TMP_OBJ = new THREE.Object3D();
const V_POS = new THREE.Vector3();
const V_SCL = new THREE.Vector3();
const Q_TMP = new THREE.Quaternion();
const COL_TMP = new THREE.Color();
const nodeDone: number[] = [];
const nodeMats: THREE.Matrix4[] = [];
const nodeCols: THREE.Color[] = [];

/** Merges a builder's parts per (node, surface) into pool parts. */
function compile(b: Builder): { parts: PartDef[]; nodeCount: number } {
  const groups = new Map<string, Raw[]>();
  for (const r of b.raws) {
    const k = `${r.node}:${r.surf}`;
    const list = groups.get(k) ?? [];
    list.push(r);
    groups.set(k, list);
  }
  const parts: PartDef[] = [];
  for (const list of groups.values()) {
    const geo = list.length === 1 ? list[0].geo : mergeGeometries(list.map((r) => r.geo));
    if (list.length > 1) for (const r of list) r.geo.dispose();
    geo.computeBoundingSphere();
    const node = list[0].node;
    parts.push({ geo, surf: list[0].surf, node: node >= 0 ? b.nodes[node] : null, nodeIndex: node });
  }
  // Opaque first, glows last (stable draw order).
  const rank: Record<Surf, number> = { matte: 0, satin: 1, metal: 2, glow: 3, glass: 4, add: 5 };
  parts.sort((x, y) => rank[x.surf] - rank[y.surf]);
  return { parts, nodeCount: b.nodes.length };
}

// ---------------------------------------------------------------------------
// Tower looks
// ---------------------------------------------------------------------------

/** Pedestal colours by grade: [top, base, rim]. */
const PEDESTAL: [string, string, string][] = [
  ["#000000", "#000000", "#000000"],
  ["#e5e7eb", "#4b5563", "#9ca3af"],
  ["#dbeafe", "#1e3a8a", "#60a5fa"],
  ["#ede9fe", "#4c1d95", "#a78bfa"],
  ["#fef3c7", "#92400e", "#fbbf24"],
  ["#ffe4e6", "#881337", "#fb7185"],
];
/** Height of each tower's top (body units, before BODY_SCALE) — stun stars sit above it. */
const TOWER_TOP: Record<UnitKind, number> = { archer: 24, mage: 38, frost: 24, thunder: 31, poison: 18, cannon: 13, holy: 32, wind: 28, liberty: 42, thinker: 29 };
const BODY_Y = 7.5;
/** Tower bodies are modelled small and scaled up so they read at board size. */
const BODY_SCALE = 1.3;
const towerTop = (k: UnitKind) => BODY_Y + TOWER_TOP[k] * BODY_SCALE;

const GOLD = "#e8c25a";
const GOLD_DK = "#9a7425";

const pulse = (col: string, lo: number, hi: number, ms: number, fireBoost = 0): ColorFn => {
  const base = new THREE.Color(col);
  return (c, out) => out.copy(base).multiplyScalar(lo + (hi - lo) * (0.5 + 0.5 * Math.sin(c.now / ms + c.seed)) + fireBoost * c.firing);
};

function buildTowerLook(kind: UnitKind, grade: number): Builder {
  const b = new Builder();
  const [top, base, rim] = PEDESTAL[grade];

  // Pedestal: two-tier octagon, metal rim, gold trim (전설+), grade gems on the front.
  b.add(G.cyl(18, 19.5, 4, 8), "satin", base, [0, 2, 0], [0, Math.PI / 8, 0], 1, top);
  b.add(G.cyl(16.5, 18, 3.5, 8), "satin", base, [0, 5.75, 0], [0, Math.PI / 8, 0], 1, top);
  if (grade === 5) {
    b.node([0, 7.5, 0], { color: (c, out) => out.setHSL((c.now / 2400 + c.seed * 0.07) % 1, 0.85, 0.62) }, () => {
      b.add(G.torus(17.6, 1, 5, 8), "metal", "#ffffff", [0, 0, 0], [Math.PI / 2, 0, Math.PI / 8]);
    });
  } else b.add(G.torus(17.6, 0.95, 5, 8), "metal", rim, [0, 7.5, 0], [Math.PI / 2, 0, Math.PI / 8]);
  if (grade >= 4) b.add(G.torus(19, 0.6, 4, 8), "metal", GOLD, [0, 3.8, 0], [Math.PI / 2, 0, Math.PI / 8]);
  for (let i = 0; i < grade; i++) b.add(G.octa(1.8), "glow", GRADE_COLORS[grade], [(i - (grade - 1) / 2) * 5.2, 3.6, 18.9], [0, Math.PI / 4, 0], [1, 1.25, 0.6]);
  if (grade >= 4) b.node([0, 0.4, 0], { color: pulse(GRADE_COLORS[grade], 0.22, 0.42, 260) }, () => b.add(G.flatDisc(), "add", "#ffffff", [0, 0, 0], [0, 0, 0], 28));

  b.prefix = new THREE.Matrix4().compose(new THREE.Vector3(0, BODY_Y, 0), new THREE.Quaternion(), new THREE.Vector3(BODY_SCALE, BODY_SCALE, BODY_SCALE));
  const halo = (pos: V3, col: string, size: number, lo = 0.32, fire = 0.5, ms = 300) =>
    b.node(pos, { bill: true, color: pulse(col, lo, lo + 0.15, ms, fire), anim: (c, o) => o.scale.setScalar(1 + 0.45 * c.firing) }, () => b.add(G.disc(), "add", "#ffffff", [0, 0, 0], [0, 0, 0], size));
  const aimNode = (y: number, recoil: number, fn: () => void) =>
    b.node([0, y, 0], { anim: (c, o) => (o.rotation.set(0, c.yaw, 0), o.position.set(-Math.cos(c.yaw) * recoil * c.kick, 0, Math.sin(c.yaw) * recoil * c.kick)) }, fn);

  switch (kind) {
    case "archer": {
      b.add(G.cyl(7.5, 9, 15, 10), "matte", "#78716c", [0, 7.5, 0], [0, 0, 0], 1, "#d6d3d1");
      b.add(G.torus(8.3, 0.7, 4, 12), "matte", "#6b4423", [0, 6, 0], [Math.PI / 2, 0, 0]);
      b.add(G.cyl(10.5, 9, 3, 10), "matte", "#57381c", [0, 16.5, 0], [0, 0, 0], 1, "#8b5a2b");
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        b.add(G.rbox(3.2, 3.4, 3.2, 0.6), "matte", "#a8a29e", [Math.cos(a) * 8.6, 19.6, Math.sin(a) * 8.6], [0, -a, 0], 1, "#e7e5e4");
      }
      aimNode(20, 1.6, () => {
        b.add(G.rbox(12, 1.8, 2.4, 0.5), "satin", "#5b3a1a", [2, 2.4, 0], [0, 0, 0], 1, "#8b5a2b");
        b.add(G.torus(6, 0.7, 5, 16, Math.PI), "metal", "#f59e0b", [6.2, 2.6, 0], [Math.PI / 2, Math.PI / 2, 0], 1, "#fde68a", "YXZ");
        b.add(G.cyl(0.45, 0.45, 9, 6), "glow", "#fde68a", [3.5, 3.4, 0], [0, 0, Math.PI / 2]);
      });
      break;
    }
    case "mage": {
      b.add(G.cyl(6, 8.5, 18, 6), "satin", "#312e81", [0, 9, 0], [0, 0, 0], 1, "#6366f1");
      b.add(G.torus(7.4, 0.9, 4, 6), "metal", GOLD, [0, 14, 0], [Math.PI / 2, 0, 0]);
      b.add(G.torus(8.2, 0.7, 4, 6), "metal", GOLD_DK, [0, 1.2, 0], [Math.PI / 2, 0, 0]);
      b.add(G.cone(9.5, 13, 6), "satin", "#581c87", [0, 24.5, 0], [0, 0, 0], 1, "#c084fc");
      b.add(G.sphere(1.2, 8, 6), "metal", GOLD, [0, 31.4, 0]);
      b.node([0, 36, 0], { anim: (c, o) => (o.position.y = Math.sin(c.now / 380 + c.seed) * 1.6, o.scale.setScalar(1 + 0.4 * c.firing)) }, () => {
        b.add(G.sphere(3.4, 16, 12), "glow", "#e9d5ff");
      });
      b.node([0, 36, 0], { anim: (c, o) => (o.rotation.y = c.now / 500, o.position.y = Math.sin(c.now / 380 + c.seed) * 1.6) }, () => {
        for (let i = 0; i < 3; i++) b.add(G.octa(1.1), "glow", "#d8b4fe", [Math.cos((i * Math.PI * 2) / 3) * 6, 0, Math.sin((i * Math.PI * 2) / 3) * 6]);
      });
      halo([0, 36, 0], "#a855f7", 7.5);
      break;
    }
    case "frost": {
      b.add(G.cyl(9, 11, 3, 6), "satin", "#7dd3fc", [0, 1.5, 0], [0, 0, 0], 1, "#e0f2fe");
      b.node([0, 0, 0], { anim: (c, o) => (o.rotation.y = c.now / 2400 + c.seed) }, () => {
        b.add(G.octa(1), "glass", "#0ea5e9", [0, 13, 0], [0, 0, 0], [3.6, 12, 3.6], "#f0f9ff");
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + 0.4;
          b.add(G.octa(1), "glass", "#38bdf8", [Math.cos(a) * 5.5, 7.5, Math.sin(a) * 5.5], [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5], [2.2, 6.5 + (i % 2) * 2, 2.2], "#e0f2fe");
        }
      });
      halo([0, 13, 0], "#38bdf8", 9, 0.25, 0.55);
      break;
    }
    case "thunder": {
      b.add(G.cyl(2.2, 3.6, 24, 8), "metal", "#334155", [0, 12, 0], [0, 0, 0], 1, "#94a3b8");
      for (let i = 0; i < 3; i++) b.add(G.torus(5.4 - i * 1.1, 0.9, 6, 18), "metal", "#b45309", [0, 8 + i * 5, 0], [Math.PI / 2, 0, 0], 1, "#fbbf24");
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        b.add(G.cone(0.8, 5, 6), "metal", "#cbd5e1", [Math.cos(a) * 3.2, 25, Math.sin(a) * 3.2], [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5]);
      }
      b.node([0, 28, 0], { anim: (c, o) => o.scale.setScalar(1 + 0.3 * c.firing + 0.06 * Math.sin(c.now / 47 + c.seed)) }, () => b.add(G.sphere(4.2, 16, 12), "glow", "#fef9c3"));
      b.node([0, 28, 0], { bill: true, color: (c, out) => out.set("#facc15").multiplyScalar(0.3 + 0.3 * Math.max(0, Math.sin(c.now / 47 + c.seed) * Math.sin(c.now / 113)) + 0.6 * c.firing), anim: (c, o) => o.scale.setScalar(1 + 0.5 * c.firing) }, () =>
        b.add(G.disc(), "add", "#ffffff", [0, 0, 0], [0, 0, 0], 11),
      );
      break;
    }
    case "poison": {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        b.add(G.cyl(0.9, 0.9, 7, 6), "metal", "#1f2937", [Math.cos(a) * 6.5, 3, Math.sin(a) * 6.5], [Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35]);
      }
      const th0 = Math.PI * 0.35;
      b.add(new THREE.SphereGeometry(10.5, 18, 10, 0, Math.PI * 2, th0, Math.PI - th0), "metal", "#111827", [0, 12, 0], [0, 0, 0], 1, "#4b5563");
      const rimY = 12 + 10.5 * Math.cos(th0);
      const rimR = 10.5 * Math.sin(th0);
      b.add(G.torus(rimR, 1.1, 6, 22), "metal", "#6b7280", [0, rimY, 0], [Math.PI / 2, 0, 0]);
      b.add(G.flatDisc(), "glow", "#4ade80", [0, rimY - 1.2, 0], [0, 0, 0], rimR - 0.6);
      for (let i = 0; i < 3; i++)
        b.node([Math.cos(i * 2.1) * 4, rimY, Math.sin(i * 2.1) * 4], {
          anim: (c, o) => {
            const t = (c.now / (c.firing ? 380 : 700) + i / 3 + c.seed * 0.1) % 1;
            o.position.y = t * 9;
            o.scale.setScalar(1 - t * 0.7);
          },
        }, () => b.add(G.sphere(1.6, 8, 6), "glow", "#86efac"));
      b.node([0, rimY + 1, 0], { color: pulse("#22c55e", 0.5, 0.7, 400, 0.4) }, () => b.add(G.flatDisc(), "add", "#ffffff", [0, 0, 0], [0, 0, 0], 13));
      break;
    }
    case "cannon": {
      b.add(G.rbox(15, 5, 10, 1), "matte", "#5b3417", [0, 5.5, 0], [0, 0, 0], 1, "#9a6232");
      for (const z of [-6, 6]) {
        b.add(G.cyl(4.6, 4.6, 2, 14), "matte", "#3f2a14", [-2, 4.6, z], [Math.PI / 2, 0, 0]);
        b.add(G.cyl(1.4, 1.4, 2.4, 8), "metal", GOLD, [-2, 4.6, z], [Math.PI / 2, 0, 0]);
      }
      aimNode(9, 3, () => {
        b.add(G.cyl(2.8, 3.9, 17, 14), "metal", "#27272a", [3, 2.6, 0], [0, 0, -Math.PI / 2 + 0.32], 1, "#52525b");
        b.add(G.torus(3, 0.9, 6, 16), "metal", GOLD, [11, 5.4, 0], [0.32, Math.PI / 2, 0], 1, undefined, "YXZ");
        b.add(G.torus(3.6, 0.7, 6, 16), "metal", GOLD_DK, [-4.5, 0.4, 0], [0.32, Math.PI / 2, 0], 1, undefined, "YXZ");
      });
      b.node([0, 9, 0], {
        bill: true,
        color: (c, out) => out.set("#fb923c").multiplyScalar(c.kick * 1.2),
        anim: (c, o) => (o.position.set(Math.cos(c.yaw) * 13, 6, -Math.sin(c.yaw) * 13), o.scale.setScalar(0.4 + c.kick)),
      }, () => b.add(G.disc(), "add", "#ffffff", [0, 0, 0], [0, 0, 0], 6));
      break;
    }
    case "holy": {
      b.add(G.cyl(4.5, 5.5, 20, 14), "satin", "#d6d3d1", [0, 10, 0], [0, 0, 0], 1, "#fafaf9");
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        b.add(G.box(0.6, 19, 0.6), "satin", "#e7e5e4", [Math.cos(a) * 5, 10, Math.sin(a) * 5]);
      }
      b.add(G.cyl(6.5, 5, 2.4, 14), "metal", GOLD, [0, 21, 0]);
      b.add(G.cyl(6, 6.5, 1.6, 14), "metal", GOLD_DK, [0, 0.8, 0]);
      b.node([0, 30, 0], { anim: (c, o) => (o.rotation.z = c.now / 900 + c.seed) }, () => {
        b.add(G.torus(6.5, 1.2, 8, 24), "metal", GOLD);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          b.add(G.cone(1.2, 4.5, 6), "metal", "#fbbf24", [Math.cos(a) * 9.5, Math.sin(a) * 9.5, 0], [0, 0, a - Math.PI / 2], 1, "#fef3c7");
        }
      });
      b.node([0, 30, 0], { anim: (c, o) => o.scale.setScalar(1 + 0.3 * c.firing) }, () => b.add(G.sphere(3.4, 14, 10), "glow", "#fef3c7"));
      halo([0, 30, 0], "#fbbf24", 10, 0.3, 0.55, 260);
      break;
    }
    case "wind": {
      b.add(G.cyl(5, 8, 22, 10), "satin", "#cbd5e1", [0, 11, 0], [0, 0, 0], 1, "#f8fafc");
      b.add(G.cone(6.8, 8, 10), "satin", "#0f766e", [0, 26, 0], [0, 0, 0], 1, "#2dd4bf");
      b.add(G.torus(5.8, 0.6, 4, 10), "metal", GOLD, [0, 22, 0], [Math.PI / 2, 0, 0]);
      b.add(G.sphere(1.8, 10, 8), "metal", "#334155", [0, 20, 6.6]);
      b.node([0, 20, 6.6], { anim: (c, o) => (o.rotation.z = -(c.now * 0.008 + c.seed) - c.kick * 0.6) }, () => {
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI) / 2;
          b.add(G.rbox(2.8, 12, 0.6, 0.25), "satin", "#14b8a6", [-Math.sin(a) * 7, Math.cos(a) * 7, 0], [0, 0, a], 1, "#99f6e4");
        }
      });
      b.node([0, 6, 0], { color: pulse("#5eead4", 0.35, 0.55, 200, 0.4), anim: (c, o) => (o.rotation.y = c.now / 300) }, () => b.add(G.flatRing(0.86), "add", "#ffffff", [0, 0, 0], [0, 0, 0], 11));
      break;
    }
    case "liberty": {
      b.add(G.rbox(14, 5, 14, 1), "matte", "#78716c", [0, 2.5, 0], [0, 0, 0], 1, "#d6d3d1");
      b.add(G.rbox(14.6, 0.8, 14.6, 0.3), "metal", GOLD, [0, 5, 0]);
      b.add(G.cone(7, 21, 14), "satin", "#0f766e", [0, 15.5, 0], [0, 0, 0], 1, "#5eead4");
      b.add(G.sphere(3.4, 14, 10), "satin", "#14b8a6", [0, 28, 0]);
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI / 2 + ((i - 3) / 6) * Math.PI * 0.9;
        b.add(G.cone(0.7, 3.4, 5), "satin", "#2dd4bf", [Math.cos(a) * 3, 31, Math.sin(a) * 3 + 0.8], [Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6]);
      }
      b.add(G.cyl(1.1, 1.3, 10, 8), "satin", "#14b8a6", [4, 30, 0], [0, 0, -0.22]);
      b.add(G.cone(1.9, 4, 10), "metal", GOLD, [5.2, 35.5, 0], [Math.PI, 0, 0]);
      b.add(G.rbox(4, 6.5, 1.6, 0.4), "satin", "#0d9488", [-5.2, 18, 2.4], [0, 0, 0.25]);
      b.node([5.2, 39.5, 0], { anim: (c, o) => o.scale.set(1, 1 + 0.18 * Math.sin(c.now / 70 + c.seed) + 0.5 * c.firing, 1) }, () => b.add(G.cone(2, 5.5, 10), "glow", "#fb923c", [0, 0, 0], [0, 0, 0], 1, "#fef3c7"));
      halo([5.2, 40, 0], "#fb923c", 7, 0.35, 0.6, 90);
      break;
    }
    case "thinker": {
      b.add(G.rbox(17, 8, 13, 1), "satin", "#0b0f19", [0, 4, 0], [0, 0, 0], 1, "#1f2937");
      b.add(G.rbox(17.6, 0.9, 13.6, 0.3), "metal", GOLD, [0, 7.8, 0]);
      b.add(G.rbox(17.6, 0.9, 13.6, 0.3), "metal", GOLD, [0, 0.6, 0]);
      const marble = "#f8fafc";
      b.add(G.capsule(3.3, 6), "satin", "#cbd5e1", [0, 14.5, -1.2], [0.45, 0, 0], 1, marble);
      b.add(G.sphere(2.9, 14, 12), "satin", marble, [0, 20.5, 2.6]);
      for (const x of [-2.1, 2.1]) {
        b.add(G.capsule(1.6, 5), "satin", "#e2e8f0", [x, 10.4, 2], [Math.PI / 2, 0, 0]);
        b.add(G.capsule(1.4, 4), "satin", "#e2e8f0", [x, 7.8, 5.2]);
      }
      b.add(G.capsule(1.2, 6), "satin", "#e2e8f0", [1.4, 15.5, 4.2], [-0.35, 0, 0]);
      b.node([0, 27, 2.6], { anim: (c, o) => (o.rotation.y = c.now / 800 + c.seed, o.position.y = Math.sin(c.now / 500) * 1.2) }, () => {
        for (let i = 0; i < 3; i++) b.add(G.sphere(1.1, 8, 6), "glow", "#fde68a", [Math.cos((i * Math.PI * 2) / 3) * 6, 0, Math.sin((i * Math.PI * 2) / 3) * 6]);
      });
      halo([0, 27, 2.6], "#fde68a", 7, 0.3, 0.9);
      break;
    }
  }

  // 신화 sparkles orbiting the tower (outside the body scale).
  if (grade === 5) {
    b.prefix = new THREE.Matrix4();
    b.node([0, 14, 0], { anim: (c, o) => (o.rotation.y = c.now / 700, o.position.y = Math.sin(c.now / 400) * 2) }, () => {
      ["#fde68a", "#f9a8d4", "#a5f3fc", "#c4b5fd"].forEach((col, i) => b.add(G.octa(1.7), "glow", col, [Math.cos((i * Math.PI) / 2) * 21, 0, Math.sin((i * Math.PI) / 2) * 21]));
    });
  }
  return b;
}

// ---------------------------------------------------------------------------
// Monster looks
// ---------------------------------------------------------------------------

const SLIME = [
  ["#3f6212", "#bef264"],
  ["#155e75", "#67e8f9"],
  ["#581c87", "#d8b4fe"],
  ["#4c0519", "#fb7185"],
];
const BAT = [
  { body: "#92400e", hi: "#fbbf24", wing: "#7c2d12", eye: "#fef08a" },
  { body: "#991b1b", hi: "#f87171", wing: "#450a0a", eye: "#fef08a" },
  { body: "#3730a3", hi: "#a5b4fc", wing: "#1e1b4b", eye: "#a5f3fc" },
  { body: "#18181b", hi: "#52525b", wing: "#09090b", eye: "#fb7185" },
];
const BEETLE = [
  { shell: "#475569", hi: "#cbd5e1", head: "#334155", horn: "#e2e8f0" },
  { shell: "#92400e", hi: "#fcd34d", head: "#78350f", horn: "#fef3c7" },
  { shell: "#065f46", hi: "#6ee7b7", head: "#064e3b", horn: "#d1fae5" },
  { shell: "#18181b", hi: "#52525b", head: "#09090b", horn: "#fbbf24" },
];
const DEMON = [
  ["#7f1d1d", "#ef4444"],
  ["#881337", "#fb7185"],
  ["#4c1d95", "#a855f7"],
  ["#09090b", "#3f3f46"],
];
const TIER_RING = ["", "#e2e8f0", "#fbbf24", "#fb7185"];
/** Body top per monster kind (× size) — status icons and spikes sit here; matches render.ts MOB_TOP_3D. */
const MOB_TOP: Record<Mob["kind"], number> = { normal: 1.6, fast: 2.5, tank: 1.3, boss: 2.4, elite: 2.5, invader: 2.4, golem: 2.7, wraith: 2.9, warlord: 2.9, knight: 2.6, shaman: 2.6 };

interface MobLook {
  builder: Builder;
  /** Whole-body motion (bounce, squash, sway) written into `o`. */
  body?: (c: Ctx, o: THREE.Object3D) => void;
}

function eyes(b: Builder, x: number, y: number, gap: number, r: number, glowCol?: string) {
  for (const sd of [-1, 1]) {
    if (glowCol) b.add(G.sphere(r, 10, 8), "glow", glowCol, [x, y, sd * gap]);
    else {
      b.add(G.sphere(r, 12, 10), "glow", "#ffffff", [x, y, sd * gap]);
      b.add(G.sphere(r * 0.55, 10, 8), "satin", "#0f172a", [x + r * 0.6, y, sd * gap]);
    }
  }
}

function buildMobLook(kind: Mob["kind"], tier: number, s: number, unitKind?: UnitKind): MobLook {
  const b = new Builder();
  let body: MobLook["body"];
  switch (kind) {
    case "normal": {
      const [lo, hi] = SLIME[tier];
      b.add(G.sphere(s, 20, 14), "satin", lo, [0, s * 0.8, 0], [0, 0, 0], [1.05, 0.82, 1.05], hi);
      b.add(G.sphere(s * 0.3, 10, 8), "glow", "#ffffff", [-s * 0.15, s * 1.32, -s * 0.38], [0, 0, 0], [1, 0.6, 1]);
      eyes(b, s * 0.78, s * 0.95, s * 0.32, s * 0.22);
      body = (c, o) => {
        const t = Math.sin(c.now / 130 + c.seed);
        o.scale.set(1 + t * 0.09, 1 - t * 0.09, 1 + t * 0.09);
        o.position.y = Math.abs(Math.sin(c.now / 160 + c.seed)) * s * 0.25;
      };
      break;
    }
    case "fast": {
      const p = BAT[tier];
      b.add(G.sphere(s * 0.7, 14, 12), "satin", p.body, [0, s * 1.7, 0], [0, 0, 0], 1, p.hi);
      for (const z of [-1, 1]) b.add(G.cone(s * 0.18, s * 0.5, 6), "satin", p.body, [s * 0.1, s * 2.35, z * s * 0.3]);
      eyes(b, s * 0.55, s * 1.85, s * 0.22, s * 0.13, p.eye);
      for (const side of [-1, 1])
        b.node([0, s * 1.7, side * s * 0.4], { anim: (c, o) => (o.rotation.x = side * Math.sin(c.now / 55 + c.seed) * 0.8) }, () => {
          b.add(G.wing(), "matte", p.wing, [0, 0, 0], [0, 0, 0], [s * 1.4, 1, s * 1.6 * side]);
        });
      body = (c, o) => (o.position.y = Math.sin(c.now / 200 + c.seed) * s * 0.25);
      break;
    }
    case "tank": {
      const p = BEETLE[tier];
      b.add(G.halfSphere(1), "metal", p.shell, [0, s * 0.25, 0], [0, 0, 0], [s * 1.25, s * 0.85, s], p.hi);
      b.add(G.box(s * 2.3, s * 0.08, s * 0.06), "matte", "#0f172a", [0, s * 1.05, 0]);
      b.add(G.sphere(s * 0.45, 12, 10), "satin", p.head, [s * 1.15, s * 0.45, 0]);
      b.add(G.cone(s * 0.15, s * 0.7, 8), "metal", p.horn, [s * 1.6, s * 0.75, 0], [0, 0, -1.1]);
      for (const x of [-0.6, 0, 0.6]) for (const z of [-1, 1]) b.add(G.cyl(s * 0.07, s * 0.07, s * 0.7, 5), "matte", "#1e293b", [x * s, s * 0.25, z * s * 0.95], [z * 0.9, 0, 0]);
      eyes(b, s * 1.45, s * 0.55, s * 0.2, s * 0.11, "#fca5a5");
      body = (c, o) => (o.rotation.z = Math.sin(c.now / 90 + c.seed) * 0.04);
      break;
    }
    case "boss": {
      const [lo, hi] = DEMON[tier];
      b.add(G.sphere(s * 0.95, 22, 16), "satin", lo, [0, s * 1.1, 0], [0, 0, 0], 1, hi);
      b.add(G.sphere(s * 0.55, 14, 12), "satin", "#fecaca", [s * 0.55, s * 0.95, 0]);
      const horn = tier >= 2 ? "#fde68a" : "#e7e5e4";
      for (const z of [-1, 1]) b.add(G.cone(s * 0.2, s * (0.8 + tier * 0.2), 8), "satin", "#78716c", [s * 0.1, s * 2, z * s * 0.45], [z * 0.45, 0, 0], 1, horn);
      eyes(b, s * 0.82, s * 1.35, s * 0.32, s * 0.15, "#fde047");
      for (const side of [-1, 1])
        b.node([-s * 0.3, s * 1.4, side * s * 0.6], { anim: (c, o) => (o.rotation.x = side * (0.3 + Math.sin(c.now / 240 + c.seed) * 0.4)) }, () => {
          b.add(G.wing(), "matte", tier === 3 ? "#0a0a0a" : "#450a0a", [0, 0, 0], [0, 0, 0], [s * 1.8, 1, s * 2 * side]);
        });
      if (tier >= 2)
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          b.add(G.cone(s * 0.1, s * 0.4, 5), "metal", GOLD, [Math.cos(a) * s * 0.4, s * 2.1, Math.sin(a) * s * 0.4]);
        }
      body = (c, o) => (o.position.y = Math.sin(c.now / 300 + c.seed) * s * 0.08);
      break;
    }
    case "elite": {
      b.add(G.capsule(s * 0.6, s * 0.7), "satin", "#9a3412", [0, s * 1.05, 0], [0, 0, 0], 1, "#fb923c");
      b.add(G.sphere(s * 0.42, 14, 12), "satin", "#fdba74", [s * 0.2, s * 2, 0]);
      eyes(b, s * 0.55, s * 2.05, s * 0.16, s * 0.1, "#fde047");
      b.node([s * 0.2, s * 1.2, s * 0.8], { anim: (c, o) => (o.rotation.set(0.5, 0, Math.sin(c.now / 180 + c.seed) * 0.4)) }, () => b.add(G.cyl(s * 0.18, s * 0.08, s * 1.4, 7), "matte", "#7c2d12"));
      b.node([0, s * 1.2, 0], { bill: true, color: (c, out) => out.set("#f97316").multiplyScalar(0.35 + 0.15 * Math.sin(c.now / 150 + c.seed)) }, () => b.add(G.disc(), "add", "#ffffff", [0, 0, 0], [0, 0, 0], s * 1.6));
      break;
    }
    case "invader": {
      const col = unitKind ? UNITS[unitKind].color : "#7c3aed";
      b.add(G.cyl(s * 0.55, s * 0.75, s * 1.5, 8), "satin", "#1e1b4b", [0, s * 0.75, 0], [0, 0, 0], 1, col);
      b.add(G.cone(s * 0.65, s * 0.7, 8), "satin", "#1e1b4b", [0, s * 1.85, 0]);
      for (const z of [-1, 1]) b.add(G.cone(s * 0.12, s * 0.6, 6), "glow", "#e9d5ff", [0, s * 2, z * s * 0.4], [z * 0.7, 0, 0]);
      eyes(b, s * 0.6, s * 1.15, s * 0.22, s * 0.12, "#f43f5e");
      b.node([0, s, 0], { bill: true, color: pulse("#7c3aed", 0.45, 0.65, 200) }, () => b.add(G.disc(), "add", "#ffffff", [0, 0, 0], [0, 0, 0], s * 1.8));
      break;
    }
    case "golem": {
      b.add(G.dodeca(s * 0.8), "matte", "#57534e", [0, s * 0.7, 0], [0, 0, 0], 1, "#a8a29e");
      b.add(G.dodeca(s * 0.62), "matte", "#78716c", [0.1 * s, s * 1.6, 0], [0.4, 0.3, 0], 1, "#d6d3d1");
      b.add(G.dodeca(s * 0.42), "matte", "#57534e", [s * 0.25, s * 2.3, 0], [0, 0.7, 0], 1, "#a8a29e");
      for (const z of [-1, 1]) b.add(G.dodeca(s * 0.35), "matte", "#57534e", [0, s * 1.5, z * s * 0.85], [z, 0, 0], 1, "#a8a29e");
      b.add(G.box(s * 0.1, s * 0.5, s * 0.08), "glow", "#fb923c", [s * 0.72, s * 1.5, s * 0.15], [0, 0, 0.4]);
      eyes(b, s * 0.6, s * 2.35, s * 0.15, s * 0.09, "#fb923c");
      body = (c, o) => (o.rotation.z = Math.sin(c.now / 260 + c.seed) * 0.08);
      break;
    }
    case "wraith": {
      b.add(G.cone(s * 0.75, s * 1.7, 14), "glass", "#a5f3fc", [0, s * 1.15, 0], [Math.PI, 0, 0], 1, "#f0f9ff");
      b.add(G.sphere(s * 0.6, 14, 12), "glass", "#e0f2fe", [0, s * 2, 0]);
      eyes(b, s * 0.45, s * 2.05, s * 0.2, s * 0.12, "#22d3ee");
      b.node([0, s * 1.6, 0], { bill: true, color: pulse("#67e8f9", 0.3, 0.45, 260) }, () => b.add(G.disc(), "add", "#ffffff", [0, 0, 0], [0, 0, 0], s * 1.7));
      body = (c, o) => {
        o.position.y = s * 0.4 + Math.sin(c.now / 220 + c.seed) * s * 0.2;
        o.rotation.z = Math.sin(c.now / 300 + c.seed) * 0.15;
      };
      break;
    }
    case "warlord": {
      b.add(G.sphere(s * 0.9, 18, 14), "satin", "#365314", [0, s * 1.05, 0], [0, 0, 0], 1, "#65a30d");
      b.add(G.sphere(s * 0.5, 14, 12), "satin", "#65a30d", [s * 0.35, s * 1.95, 0], [0, 0, 0], 1, "#a3e635");
      b.add(G.halfSphere(1), "metal", "#44403c", [s * 0.35, s * 2.05, 0], [0, 0, 0], s * 0.56, "#a8a29e");
      for (const z of [-1, 1]) b.add(G.cone(s * 0.13, s * 0.7, 7), "satin", "#d6d3d1", [s * 0.35, s * 2.5, z * s * 0.45], [z * 0.8, 0, 0], 1, "#ffffff");
      eyes(b, s * 0.78, s * 1.95, s * 0.18, s * 0.1, "#ef4444");
      b.node([0, s * 1.2, s * 0.95], { anim: (c, o) => (o.rotation.z = -0.3 + Math.sin(c.now / 200 + c.seed) * 0.35) }, () => {
        b.add(G.cyl(s * 0.08, s * 0.08, s * 1.8, 6), "matte", "#78350f");
        b.add(G.box(s * 0.7, s * 0.6, s * 0.1), "metal", "#d6d3d1", [s * 0.35, s * 0.7, 0]);
      });
      break;
    }
    case "knight": {
      b.add(G.cyl(s * 0.55, s * 0.68, s * 1.3, 12), "metal", "#64748b", [0, s * 0.85, 0], [0, 0, 0], 1, "#cbd5e1");
      b.add(G.sphere(s * 0.45, 14, 12), "metal", "#94a3b8", [0, s * 1.85, 0], [0, 0, 0], 1, "#e2e8f0");
      b.add(G.box(s * 0.2, s * 0.12, s * 0.6), "matte", "#0f172a", [s * 0.4, s * 1.88, 0]);
      b.add(G.cone(s * 0.18, s * 0.7, 7), "satin", "#b91c1c", [-s * 0.1, s * 2.45, 0], [0, 0, 0], 1, "#f87171");
      b.add(G.rbox(s * 0.9, s * 1.1, s * 0.15, s * 0.05), "metal", "#1e3a8a", [s * 0.2, s * 0.95, s * 0.75], [0, 0, 0], 1, "#3b82f6");
      b.add(G.box(s * 0.25, s * 0.8, s * 0.05), "metal", GOLD, [s * 0.2, s * 0.95, s * 0.84]);
      body = (c, o) => (o.position.y = Math.abs(Math.sin(c.now / 150 + c.seed)) * s * 0.12);
      break;
    }
    case "shaman": {
      b.add(G.cone(s * 0.7, s * 1.6, 12), "satin", "#3b0764", [0, s * 0.8, 0], [0, 0, 0], 1, "#8b5cf6");
      b.add(G.sphere(s * 0.38, 14, 12), "satin", "#65a30d", [0, s * 1.75, 0], [0, 0, 0], 1, "#bef264");
      b.add(G.cone(s * 0.45, s * 0.6, 10), "satin", "#2e1065", [0, s * 2.2, 0], [0, 0, 0], 1, "#6d28d9");
      eyes(b, s * 0.32, s * 1.8, s * 0.13, s * 0.08, "#fde047");
      b.add(G.cyl(s * 0.06, s * 0.06, s * 2.2, 6), "matte", "#78350f", [s * 0.3, s * 1.1, s * 0.6]);
      b.node([s * 0.3, s * 2.3, s * 0.6], { anim: (c, o) => (o.position.y = Math.sin(c.now / 250 + c.seed) * s * 0.1) }, () => b.add(G.sphere(s * 0.22, 10, 8), "glow", "#86efac"));
      b.node([s * 0.3, s * 2.3, s * 0.6], { bill: true, color: pulse("#22c55e", 0.4, 0.6, 250) }, () => b.add(G.disc(), "add", "#ffffff", [0, 0, 0], [0, 0, 0], s * 0.9));
      break;
    }
  }

  // Tier spikes on top (정예+, not on the boss — it has horns / a crown).
  if (tier >= 2 && kind !== "boss") {
    const top = s * MOB_TOP[kind];
    const n = tier === 3 ? 4 : 3;
    for (let i = 0; i < n; i++) b.add(G.cone(s * 0.13, s * 0.5, 5), "metal", tier === 3 ? "#4c0519" : "#78350f", [-s * 0.2 + (i - (n - 1) / 2) * s * 0.3, top - s * 0.15, 0], [0, 0, 0.35], 1, tier === 3 ? "#fda4af" : "#fde68a");
  }
  return { builder: b, body };
}

// ---------------------------------------------------------------------------
// Simple instanced sprinkles (shadows, rings, status markers, decoration)
// ---------------------------------------------------------------------------

class Spray {
  mesh: THREE.InstancedMesh;
  n = 0;
  constructor(scene: THREE.Scene, geo: THREE.BufferGeometry, mat: THREE.Material, private cap: number, colored: boolean, order = 0) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (colored) this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }
  begin() {
    this.n = 0;
  }
  push(x: number, y: number, z: number, sx: number, sy = sx, sz = sx, ry = 0, col?: THREE.Color) {
    if (this.n >= this.cap) return;
    TMP_OBJ.position.set(x, y, z);
    TMP_OBJ.rotation.set(0, ry, 0);
    TMP_OBJ.scale.set(sx, sy, sz);
    TMP_OBJ.updateMatrix();
    this.mesh.setMatrixAt(this.n, TMP_OBJ.matrix);
    if (col && this.mesh.instanceColor) this.mesh.setColorAt(this.n, col);
    this.n++;
  }
  /** Pushes a ready matrix (billboards). */
  pushMatrix(m: THREE.Matrix4, col?: THREE.Color) {
    if (this.n >= this.cap) return;
    this.mesh.setMatrixAt(this.n, m);
    if (col && this.mesh.instanceColor) this.mesh.setColorAt(this.n, col);
    this.n++;
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    if (this.n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }
  dispose() {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.mesh.geometry.dispose();
  }
}

// ---------------------------------------------------------------------------
// Ground painting (3D view only: no flat pads, richer grass and cobbles)
// ---------------------------------------------------------------------------

function distToRoad(x: number, y: number): number {
  let best = Infinity;
  const pts = MAP.path;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l2));
    best = Math.min(best, Math.hypot(x - (x0 + dx * t), y - (y0 + dy * t)));
  }
  return best;
}
function distToPad(x: number, y: number): number {
  let best = Infinity;
  const half = (CELL - 8) / 2;
  for (const [cx, cy] of MAP.slots) {
    const dx = Math.max(0, Math.abs(x - cx) - half);
    const dy = Math.max(0, Math.abs(y - cy) - half);
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
}

function paintGround(ctx: CanvasRenderingContext2D, alive: boolean) {
  const k = ctx.canvas.width / BOARD_W;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  const [g0, g1] = MAP.grass;
  const g = ctx.createRadialGradient(W2, H2 * 0.8, 30, W2, H2, BOARD_W * 0.72);
  g.addColorStop(0, g0);
  g.addColorStop(1, g1);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, BOARD_W, BOARD_H);
  // Mowing stripes + soft blotches.
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = "#ffffff";
  for (let x = -BOARD_H; x < BOARD_W; x += 26) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 13, 0);
    ctx.lineTo(x + 13 + BOARD_H * 0.6, BOARD_H);
    ctx.lineTo(x + BOARD_H * 0.6, BOARD_H);
    ctx.fill();
  }
  ctx.restore();
  for (let i = 0; i < 60; i++) {
    const x = noise(i, 1) * BOARD_W;
    const y = noise(i, 2) * BOARD_H;
    const r = 10 + noise(i, 3) * 30;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    const light = noise(i, 4) > 0.5;
    rg.addColorStop(0, light ? "rgba(190,242,100,0.10)" : "rgba(0,30,0,0.12)");
    rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.lineCap = "round";
  for (let i = 0; i < 1400; i++) {
    const x = noise(i, 5) * BOARD_W;
    const y = noise(i, 6) * BOARD_H;
    const h = 1.5 + noise(i, 7) * 2.5;
    ctx.strokeStyle = noise(i, 8) > 0.5 ? "rgba(217,249,157,0.22)" : "rgba(20,60,20,0.22)";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (noise(i, 9) - 0.5) * 2, y - h);
    ctx.stroke();
  }
  // Contact shadows where the pads stand.
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 8 * k;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  for (const [cx, cy] of MAP.slots) {
    const s = CELL - 8;
    ctx.beginPath();
    ctx.roundRect(cx - s / 2, cy - s / 2 + 1, s, s, 6);
    ctx.fill();
  }
  ctx.restore();
  // Road: blurred trench shadow, earth bed, cobbles, worn centre.
  const road = (w: number, style: string, blur = 0) => {
    ctx.save();
    if (blur) {
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = blur * k;
    }
    ctx.strokeStyle = style;
    ctx.lineWidth = w;
    ctx.lineJoin = "round";
    ctx.beginPath();
    MAP.path.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  };
  road(36, "rgba(0,0,0,0.35)", 6);
  road(32, "#5b4330");
  road(28, "#7a5f43");
  const len = (() => {
    let l = 0;
    for (let i = 0; i < MAP.path.length; i++) {
      const [x0, y0] = MAP.path[i];
      const [x1, y1] = MAP.path[(i + 1) % MAP.path.length];
      l += Math.hypot(x1 - x0, y1 - y0);
    }
    return l;
  })();
  let n = 0;
  for (let d = 0; d < len; d += 5.2) {
    const p = pathPoint(d);
    const q = pathPoint(d + 1);
    const tl = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const tx = (q.x - p.x) / tl;
    const ty = (q.y - p.y) / tl;
    const row = Math.round(d / 5.2) % 2;
    for (let j = -2; j <= 2; j++) {
      const off = j * 5.2 + (row ? 2.6 : 0);
      if (Math.abs(off) > 12.5) continue;
      n++;
      const x = p.x - ty * off + tx * (noise(n, 1) - 0.5);
      const y = p.y + tx * off + ty * (noise(n, 2) - 0.5);
      const tone = 0.78 + noise(n, 3) * 0.32;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(ty, tx) + (noise(n, 4) - 0.5) * 0.3);
      ctx.fillStyle = `rgb(${Math.round(158 * tone)},${Math.round(134 * tone)},${Math.round(102 * tone)})`;
      ctx.beginPath();
      ctx.roundRect(-2.2, -2.1, 4.4, 4.2, 1.4);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(-1.6, -1.8, 3, 0.6);
      ctx.restore();
    }
  }
  if (!alive) {
    ctx.globalCompositeOperation = "saturation";
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(20,20,24,0.35)";
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

interface TowerState {
  key: string;
  pool: Pool;
  yaw: number;
  seed: number;
}

interface MobState {
  pool: Pool;
  look: MobLook;
  size: number;
  top: number;
  yaw: number;
  healAt: number;
  healStart: number;
}

export function createDefenseScene(canvas: HTMLCanvasElement, quality: "high" | "low"): DefenseScene {
  const res: SceneRes = { geos: [], mats: [], texs: [], surf: new Map(), softTex: null as unknown as THREE.Texture };
  res.softTex = canvasTexture(res, 64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,0.45)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
  makeSurfaces(res);

  let shadows = quality === "high";
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  res.texs.push(envTex);
  scene.environment = envTex;
  scene.environmentIntensity = 0.38;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 3000);

  // Lights — fixed count.
  scene.add(new THREE.HemisphereLight("#dbeafe", "#3f3a2e", 0.6));
  const sun = new THREE.DirectionalLight("#fff1dc", 2.4);
  sun.position.set(-170, 360, 210);
  scene.add(sun, sun.target);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -260, right: 260, top: 220, bottom: -220, near: 50, far: 900 });
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.6;

  // Board slab: bevelled dark-stone plinth with a gold inlay line, painted field on top.
  const rr = (o: number) => {
    const sh = new THREE.Shape();
    const r = 18 + o;
    const w = W2 + o;
    const h = H2 + o;
    sh.moveTo(-w + r, -h);
    sh.lineTo(w - r, -h);
    sh.quadraticCurveTo(w, -h, w, -h + r);
    sh.lineTo(w, h - r);
    sh.quadraticCurveTo(w, h, w - r, h);
    sh.lineTo(-w + r, h);
    sh.quadraticCurveTo(-w, h, -w, h - r);
    sh.lineTo(-w, -h + r);
    sh.quadraticCurveTo(-w, -h, -w + r, -h);
    return sh;
  };
  const slabGeo = new THREE.ExtrudeGeometry(rr(0), { depth: 16, bevelEnabled: true, bevelSize: 5, bevelThickness: 3, bevelSegments: 4, curveSegments: 10 });
  slabGeo.rotateX(-Math.PI / 2).translate(0, -19.6, 0);
  const slabMat = withRim(new THREE.MeshStandardMaterial({ color: "#2a2420", roughness: 0.55, metalness: 0.15 }), 0.25);
  res.geos.push(slabGeo);
  res.mats.push(slabMat);
  const slab = new THREE.Mesh(slabGeo, slabMat);
  scene.add(slab);
  const inlay = rr(4.2);
  inlay.holes.push(new THREE.Path(rr(2.6).getPoints(24).reverse()));
  const inlayGeo = new THREE.ShapeGeometry(inlay, 12).rotateX(-Math.PI / 2).translate(0, -0.05, 0);
  const inlayMat = new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.25, metalness: 1 });
  res.geos.push(inlayGeo);
  res.mats.push(inlayMat);
  scene.add(new THREE.Mesh(inlayGeo, inlayMat));

  const fieldMat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
  const fieldGeo = new THREE.PlaneGeometry(BOARD_W, BOARD_H).rotateX(-Math.PI / 2);
  res.geos.push(fieldGeo);
  res.mats.push(fieldMat);
  const field = new THREE.Mesh(fieldGeo, fieldMat);
  field.receiveShadow = true;
  scene.add(field);
  let fieldKey = "";
  let fieldTex: THREE.CanvasTexture | null = null;

  // Pads: one instanced mesh; per-instance colour carries highlight / guide tints.
  const padTex = canvasTexture(res, 128, 128, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 128, 128);
    g.addColorStop(0, "#8d96a5");
    g.addColorStop(1, "#4a5160");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = `rgba(${noise(i, 1) > 0.5 ? "255,255,255" : "0,0,0"},${0.04 + noise(i, 2) * 0.05})`;
      ctx.beginPath();
      ctx.arc(noise(i, 3) * 128, noise(i, 4) * 128, 1 + noise(i, 5) * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, 108, 108);
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.strokeRect(13, 13, 102, 102);
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(64, 64, 34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(64, 64, 26, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(64 + Math.cos(a) * 26, 64 + Math.sin(a) * 26);
      ctx.lineTo(64 + Math.cos(a) * 34, 64 + Math.sin(a) * 34);
      ctx.stroke();
    }
  });
  const padMat = withRim(new THREE.MeshStandardMaterial({ map: padTex, roughness: 0.7, metalness: 0.05 }), 0.2);
  res.mats.push(padMat);
  const pads = new Spray(scene, new RoundedBoxGeometry(CELL - 8, PAD_TOP, CELL - 8, 3, 2.5), padMat, 32, true);
  pads.mesh.receiveShadow = true;

  // Ground decoration (per map): kerb stones, grass tufts, flowers, pebbles.
  const kerbMat = withRim(new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.85, flatShading: true }), 0.15);
  const tuftMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.9, flatShading: true });
  const flowerMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.6, emissive: "#ffffff", emissiveIntensity: 0.08 });
  res.mats.push(kerbMat, tuftMat, flowerMat);
  const kerbs = new Spray(scene, new THREE.DodecahedronGeometry(1, 0), kerbMat, 600, true);
  const tuftGeo = mergeGeometries([0, 1, 2].map((i) => new THREE.ConeGeometry(0.35, 2.6, 4).toNonIndexed().rotateZ((i - 1) * 0.35).translate((i - 1) * 0.5, 1.2, (i % 2) * 0.3)));
  const tufts = new Spray(scene, tuftGeo, tuftMat, 400, true);
  const flowers = new Spray(scene, new THREE.SphereGeometry(0.9, 6, 5), flowerMat, 120, true);
  let decoMap = "";
  const buildDeco = () => {
    kerbs.begin();
    tufts.begin();
    flowers.begin();
    const col = new THREE.Color();
    const len = (() => {
      let l = 0;
      for (let i = 0; i < MAP.path.length; i++) {
        const [x0, y0] = MAP.path[i];
        const [x1, y1] = MAP.path[(i + 1) % MAP.path.length];
        l += Math.hypot(x1 - x0, y1 - y0);
      }
      return l;
    })();
    let n = 0;
    for (let d = 0; d < len; d += 9) {
      const p = pathPoint(d);
      const q = pathPoint(d + 1);
      const tl = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      const nx = -(q.y - p.y) / tl;
      const ny = (q.x - p.x) / tl;
      for (const side of [-1, 1]) {
        n++;
        const x = p.x + nx * 17 * side;
        const y = p.y + ny * 17 * side;
        if (x < 3 || y < 3 || x > BOARD_W - 3 || y > BOARD_H - 3) continue;
        if (distToRoad(x, y) < 15.5 || distToPad(x, y) < 2) continue;
        const t = 0.32 + noise(n, 1) * 0.16;
        col.setRGB(t * 0.95, t * 0.88, t * 0.78);
        kerbs.push(toX(x), 0.4, toZ(y), 3.4 + noise(n, 2) * 0.9, 1.4 + noise(n, 3) * 0.6, 3, noise(n, 4) * 3, col);
      }
    }
    for (let i = 0; i < 2600 && tufts.n < 360; i++) {
      const x = 4 + noise(i, 11) * (BOARD_W - 8);
      const y = 4 + noise(i, 12) * (BOARD_H - 8);
      if (distToRoad(x, y) < 21 || distToPad(x, y) < 3) continue;
      const g = 0.35 + noise(i, 13) * 0.35;
      col.set(MAP.grass[0]).multiplyScalar(0.8 + g);
      tufts.push(toX(x), 0, toZ(y), 1 + noise(i, 14) * 0.8, 0.8 + noise(i, 15) * 0.9, 1, noise(i, 16) * 6, col);
      if (noise(i, 17) > 0.82 && flowers.n < 110) {
        col.set(["#fde68a", "#fbcfe8", "#ffffff", "#c4b5fd", "#fca5a5"][Math.floor(noise(i, 18) * 5)]);
        flowers.push(toX(x + 2), 2.4, toZ(y + 1), 1, 1, 1, 0, col);
      }
    }
    kerbs.end();
    tufts.end();
    flowers.end();
  };

  // Portal: swirling vortex on the road + gyroscope rings + glow.
  const portal = new THREE.Group();
  scene.add(portal);
  const swirl = canvasTexture(res, 128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(250,232,255,1)");
    g.addColorStop(0.35, "rgba(192,132,252,0.85)");
    g.addColorStop(1, "rgba(76,29,149,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      for (let t = 0; t < 1; t += 0.02) {
        const a = t * Math.PI * 2.2 + (i * Math.PI) / 2;
        const r = t * 59;
        if (t === 0) ctx.moveTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
        else ctx.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
      }
      ctx.stroke();
    }
  });
  const vortexMat = new THREE.MeshBasicMaterial({ map: swirl, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const ringMat = new THREE.MeshStandardMaterial({ color: "#c084fc", emissive: "#a855f7", emissiveIntensity: 1.4, metalness: 0.5, roughness: 0.25 });
  const coreMat = new THREE.MeshBasicMaterial({ color: "#d8b4fe", map: res.softTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  res.mats.push(vortexMat, ringMat, coreMat);
  const vortex = new THREE.Mesh(G.flatDisc(), vortexMat);
  vortex.position.y = 0.7;
  vortex.scale.setScalar(22);
  const ring1 = new THREE.Mesh(G.torus(12, 1.1, 8, 40), ringMat);
  const ring2 = new THREE.Mesh(G.torus(9, 0.9, 8, 32), ringMat);
  ring1.position.y = ring2.position.y = 14;
  const core = new THREE.Mesh(G.disc(), coreMat);
  core.position.y = 14;
  core.quaternion.copy(FACE_CAM);
  portal.add(vortex, ring1, ring2, core);

  // Range preview (selected unit / build spot) + build marker + selected-mob ring.
  const rangeDiscMat = new THREE.MeshBasicMaterial({ color: "#fde047", transparent: true, opacity: 0.08, depthWrite: false });
  const rangeEdgeMat = new THREE.MeshBasicMaterial({ color: "#fde047", transparent: true, opacity: 0.75, depthWrite: false });
  const plusMat = new THREE.MeshStandardMaterial({ color: "#fde047", emissive: "#facc15", emissiveIntensity: 0.9, roughness: 0.4 });
  const mobRingMat = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.95, depthWrite: false });
  res.mats.push(rangeDiscMat, rangeEdgeMat, plusMat, mobRingMat);
  const rangeDisc = new THREE.Mesh(G.flatDisc(), rangeDiscMat);
  const edgeGeos = new Map<number, THREE.BufferGeometry>();
  const rangeEdge = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(G.flatRing(0.985), rangeEdgeMat);
  rangeDisc.renderOrder = rangeEdge.renderOrder = 2;
  scene.add(rangeDisc, rangeEdge);
  const plus = new THREE.Group();
  plus.add(new THREE.Mesh(G.rbox(12, 3, 3, 1), plusMat), new THREE.Mesh(G.rbox(3, 12, 3, 1), plusMat));
  scene.add(plus);
  const mobRing = new THREE.Mesh(G.flatRing(0.85), mobRingMat);
  scene.add(mobRing);

  // Shared instanced pools for shadows, rings and status markers.
  const blobTex = canvasTexture(res, 64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(0,0,0,0.6)");
    g.addColorStop(0.6, "rgba(0,0,0,0.28)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
  const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false });
  const addRingMat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const addSoftMat = new THREE.MeshBasicMaterial({ map: res.softTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const iceMat = new THREE.MeshStandardMaterial({ color: "#e0f2fe", emissive: "#7dd3fc", emissiveIntensity: 0.8, flatShading: true });
  const shellMat = new THREE.MeshStandardMaterial({ color: "#bae6fd", transparent: true, opacity: 0.3, roughness: 0.1, emissive: "#38bdf8", emissiveIntensity: 0.3, depthWrite: false });
  const starMat = new THREE.MeshBasicMaterial({ color: "#fde047" });
  const bubbleMat = new THREE.MeshBasicMaterial({ color: "#86efac" });
  const flameMat = new THREE.MeshBasicMaterial({ color: "#fb923c", transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const abyssMat = new THREE.MeshBasicMaterial({ color: "#3b0718", transparent: true, opacity: 0.28, depthWrite: false });
  res.mats.push(blobMat, addRingMat, addSoftMat, iceMat, shellMat, starMat, bubbleMat, flameMat, abyssMat);
  const blobs = new Spray(scene, G.flatDisc(), blobMat, 256, false, 1);
  const rings = new Spray(scene, G.flatRing(0.86), addRingMat, 256, true, 2);
  const glows = new Spray(scene, G.disc(), addSoftMat, 256, true, 4);
  const slows = new Spray(scene, G.octa(1.6), iceMat, 384, false);
  const shells = new Spray(scene, G.sphere(1, 14, 10), shellMat, 128, false, 3);
  const stars = new Spray(scene, G.octa(2.1), starMat, 384, false);
  const bubbles = new Spray(scene, G.sphere(1.3, 8, 6), bubbleMat, 384, false);
  const flames = new Spray(scene, G.cone(1.6, 5, 7), flameMat, 512, false, 4);
  const vulns = new Spray(scene, G.torus(1, 0.06, 4, 32).rotateX(Math.PI / 2), addRingMat, 128, true, 2);
  const abyss = new Spray(scene, G.sphere(1, 12, 8), abyssMat, 128, false, 1);
  const sprays = [blobs, rings, glows, slows, shells, stars, bubbles, flames, vulns, abyss];

  const towerPools = new Map<string, Pool>();
  const mobPools = new Map<string, { pool: Pool; look: MobLook }>();
  const towers = new Map<number, TowerState>();
  const mobs = new Map<number, MobState>();
  const allPools = () => [...towerPools.values(), ...[...mobPools.values()].map((p) => p.pool)];

  const towerPool = (kind: UnitKind, grade: number) => {
    const key = `${kind}:${grade}`;
    let p = towerPools.get(key);
    if (!p) {
      const { parts, nodeCount } = compile(buildTowerLook(kind, grade));
      p = new Pool(scene, res, parts, nodeCount, shadows);
      towerPools.set(key, p);
    }
    return p;
  };
  const mobPool = (m: Mob) => {
    const tier = mobTier(m);
    const key = `${m.kind}:${tier}:${m.kind === "invader" ? (m.unitKind ?? "") : ""}`;
    let p = mobPools.get(key);
    if (!p) {
      const look = buildMobLook(m.kind, tier, mobSize(m), m.unitKind);
      const { parts, nodeCount } = compile(look.builder);
      p = { pool: new Pool(scene, res, parts, nodeCount, shadows), look };
      mobPools.set(key, p);
    }
    return p;
  };

  const ctx: Ctx = { now: 0, seed: 0, yaw: 0, kick: 0, firing: 0 };
  const rootM = new THREE.Matrix4();
  const bodyObj = new THREE.Object3D();
  const col = new THREE.Color();
  const target = new THREE.Vector3();
  const v = new THREE.Vector3();
  const seen = new Set<number>();
  const WHITE = new THREE.Color(1, 1, 1);
  const RED = new THREE.Color("#ef4444");
  const HEAL = new THREE.Color("#4ade80");
  const VULN = new THREE.Color("#fb7185");
  const TIER_COLS = TIER_RING.map((c) => new THREE.Color(c || "#ffffff"));
  const SEAT_COLS = SEAT_COLORS.map((c) => new THREE.Color(c));
  let padMap = "";
  let lastW = 0;
  let lastH = 0;

  // Adaptive resolution: watch real frame time, trade pixels for smoothness.
  const maxPR = Math.min(window.devicePixelRatio || 1, quality === "high" ? 2 : 1.5);
  let pr = maxPR;
  const minPR = Math.min(maxPR, 0.75);
  let lastNow = 0;
  let acc = 0;
  let frames = 0;
  let calm = 0;
  const adapt = (real: number) => {
    if (lastNow) {
      const dt = Math.min(200, real - lastNow);
      acc += dt;
      frames++;
    }
    lastNow = real;
    if (acc < 1000) return;
    const avg = acc / frames;
    acc = 0;
    frames = 0;
    if (avg > 24 && pr > minPR) {
      pr = Math.max(minPR, pr - 0.25);
      lastW = 0;
      calm = 0;
      if (pr <= 1 && shadows) {
        shadows = false;
        renderer.shadowMap.enabled = false;
        for (const p of allPools()) p.setShadows(false);
      }
    } else if (avg < 17.5) {
      if (++calm >= 4 && pr < maxPR) {
        pr = Math.min(maxPR, pr + 0.25);
        lastW = 0;
        calm = 0;
      }
    } else calm = 0;
  };

  function render(f: Frame3D): Proj | null {
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (cw < 2 || ch < 2) return null;
    adapt(performance.now());
    if (cw !== lastW || ch !== lastH) {
      renderer.setPixelRatio(pr);
      renderer.setSize(cw, ch, false);
      lastW = cw;
      lastH = ch;
    }
    const { board, now } = f;
    ctx.now = now;

    // Map change: ground texture, pads, decoration, portal. Alive change: ground only.
    if (MAP.id !== padMap) {
      padMap = MAP.id;
      towers.clear();
      const p0 = pathPoint(0);
      portal.position.set(toX(p0.x), 0, toZ(p0.y));
    }
    const key = `${MAP.id}:${board.alive ? 1 : 0}`;
    if (key !== fieldKey) {
      fieldKey = key;
      fieldTex?.dispose();
      fieldTex = canvasTexture(res, 2048, Math.round((2048 * BOARD_H) / BOARD_W), (c2) => paintGround(c2, board.alive));
      res.texs.pop();
      fieldTex.anisotropy = 4;
      fieldMat.map = fieldTex;
      fieldMat.needsUpdate = true;
    }
    if (decoMap !== MAP.id) {
      decoMap = MAP.id;
      buildDeco();
    }

    vortex.rotation.y = -now / 500;
    ring1.rotation.set(now / 900, now / 1300, 0);
    ring2.rotation.set(-now / 700, 0, now / 1100);
    core.scale.setScalar(16 + 2 * Math.sin(now / 240));

    // Pads: merge targets / drop target / build spot / placement guide (instance colour).
    let covLo = Infinity;
    let covHi = -Infinity;
    if (f.coverage)
      for (let i = 0; i < SLOTS; i++)
        if (!board.units[i]) {
          covLo = Math.min(covLo, f.coverage[i]);
          covHi = Math.max(covHi, f.coverage[i]);
        }
    pads.begin();
    for (let i = 0; i < SLOTS; i++) {
      const c = slotCenter(i);
      const u = board.units[i];
      col.copy(WHITE);
      if (f.highlight.has(i)) col.set(u ? GRADE_COLORS[u.grade] : "#ffffff").multiplyScalar(1.3 + 0.5 * Math.sin(now / 140)).lerp(WHITE, 0.25);
      else if (f.dropTarget === i) col.setScalar(1.7);
      else if (f.buildSlot === i) col.setRGB(1.6, 1.45, 0.6).multiplyScalar(1 + 0.12 * Math.sin(now / 160));
      else if (f.coverage && !u) {
        const t = covHi > covLo ? (f.coverage[i] - covLo) / (covHi - covLo) : 1;
        col.setHSL((t * 130) / 360, 0.75, 0.55).multiplyScalar(1.25).lerp(WHITE, 0.35);
      }
      pads.push(toX(c.x), PAD_TOP / 2, toZ(c.y), 1, 1, 1, 0, col);
    }
    pads.end();

    // Range preview.
    const rangeSlot = f.selected ?? f.buildSlot;
    if (rangeSlot !== null && rangeSlot < SLOTS) {
      const u = board.units[rangeSlot];
      const c = slotCenter(rangeSlot);
      const r = u ? unitRange(u) : 140;
      const hex = u ? UNITS[u.kind].color : "#fde047";
      rangeDiscMat.color.set(hex);
      rangeEdgeMat.color.set(hex);
      // Edge ring keeps a constant ~2-unit line width (geometry cached per radius).
      let eg = edgeGeos.get(r);
      if (!eg) {
        eg = G.flatRing(1 - 2 / r);
        edgeGeos.set(r, eg);
      }
      rangeEdge.geometry = eg;
      rangeDisc.position.set(toX(c.x), PAD_TOP + 0.4, toZ(c.y));
      rangeEdge.position.set(toX(c.x), PAD_TOP + 0.5, toZ(c.y));
      rangeDisc.scale.setScalar(r);
      rangeEdge.scale.setScalar(r);
      rangeDisc.visible = rangeEdge.visible = true;
    } else rangeDisc.visible = rangeEdge.visible = false;

    if (f.buildSlot !== null && f.buildSlot < SLOTS) {
      const c = slotCenter(f.buildSlot);
      plus.visible = true;
      plus.position.set(toX(c.x), PAD_TOP + 11 + Math.sin(now / 220) * 2, toZ(c.y));
      plus.rotation.y = now / 600;
    } else plus.visible = false;

    for (const p of towerPools.values()) p.begin();
    for (const p of mobPools.values()) p.pool.begin();
    for (const s of sprays) s.begin();

    // Towers.
    for (let slot = 0; slot < SLOTS; slot++) {
      const u = board.units[slot];
      if (!u) {
        towers.delete(slot);
        continue;
      }
      const k = `${u.kind}:${u.grade}`;
      let t = towers.get(slot);
      if (!t || t.key !== k) {
        t = { key: k, pool: towerPool(u.kind, u.grade), yaw: -Math.PI / 2 + 0.6, seed: slot * 1.7 };
        towers.set(slot, t);
      }
      const born = f.bornAt[slot];
      const age = born ? (now - born.t) / (born.big ? 650 : 320) : 1;
      if (age < 0) continue;
      let sc = 1;
      if (age < 1) sc = Math.max(0.05, age < 0.6 ? (age / 0.6) * 1.18 : 1.18 - ((age - 0.6) / 0.4) * 0.18);
      const fired = f.firedAt[slot];
      const kick = fired !== undefined ? Math.max(0, 1 - (now - fired) / 130) : 0;
      const lifted = f.selected === slot;
      const lift = lifted ? 1.08 : 1;
      const aim = f.aim[slot];
      if (aim !== undefined) {
        let d = -aim - t.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        t.yaw += d * 0.25;
      }
      const c = slotCenter(slot);
      bodyObj.position.set(toX(c.x), PAD_TOP + (lifted ? 4 + Math.sin(now / 200) * 1.2 : 0), toZ(c.y));
      bodyObj.rotation.set(0, 0, 0);
      bodyObj.scale.set(sc * lift * (1 + 0.07 * kick), sc * lift * (1 - 0.09 * kick), sc * lift * (1 + 0.07 * kick));
      bodyObj.updateMatrix();
      ctx.seed = t.seed;
      ctx.yaw = t.yaw;
      ctx.kick = kick;
      ctx.firing = unitInterval(u) - u.cd <= 2 ? 1 : 0;
      t.pool.push(bodyObj.matrix, ctx);
      blobs.push(toX(c.x), PAD_TOP + 0.15, toZ(c.y), 22);
      if (u.stun) {
        const y = PAD_TOP + towerTop(u.kind) + 6;
        for (let i = 0; i < 3; i++) {
          const a = now / 260 + (i * Math.PI * 2) / 3;
          stars.push(toX(c.x) + Math.cos(a) * 8, y, toZ(c.y) + Math.sin(a) * 8, 1, 0.45, 1, a);
        }
      }
    }

    // Monsters.
    ctx.kick = 0;
    ctx.firing = 0;
    seen.clear();
    let ringOn = false;
    for (const m of board.mobs) {
      if (m.hp <= 0) continue;
      seen.add(m.id);
      let o = mobs.get(m.id);
      if (!o) {
        const { pool, look } = mobPool(m);
        const s = mobSize(m);
        const p0 = pathPoint(m.trav);
        const a0 = pathPoint(m.trav + 4);
        o = { pool, look, size: s, top: s * MOB_TOP[m.kind], yaw: -Math.atan2(a0.y - p0.y, a0.x - p0.x), healAt: m.healAt ?? -1, healStart: -1 };
        mobs.set(m.id, o);
      }
      const s = o.size;
      const slow = m.slowT > 0 ? m.slowPct : 0;
      const frozen = (m.stunT ?? 0) > 0;
      const trav = frozen ? m.trav : m.trav + (m.speed * (1 - slow) * f.alpha) / TICKS_PER_SEC;
      const p = pathPoint(trav);
      const ahead = pathPoint(trav + 4);
      const want = -Math.atan2(ahead.y - p.y, ahead.x - p.x);
      let dy = want - o.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      o.yaw += dy * 0.25;
      const x = toX(p.x);
      const z = toZ(p.y);

      // Body: look motion (frozen when stunned), hit squash + knock-back, facing.
      const hitAt = f.hits.get(m.id);
      const hit = hitAt !== undefined ? Math.max(0, 1 - (now - hitAt) / 140) : 0;
      ctx.seed = m.id;
      bodyObj.position.set(0, 0, 0);
      bodyObj.rotation.set(0, 0, 0);
      bodyObj.scale.set(1, 1, 1);
      if (!frozen) o.look.body?.(ctx, bodyObj);
      const fx = Math.cos(o.yaw);
      const fz = -Math.sin(o.yaw);
      bodyObj.position.x += x - fx * 2.2 * hit;
      bodyObj.position.z += z - fz * 2.2 * hit;
      bodyObj.rotation.y = o.yaw;
      bodyObj.scale.x *= 1 + 0.16 * hit;
      bodyObj.scale.y *= 1 - 0.13 * hit;
      bodyObj.scale.z *= 1 + 0.16 * hit;
      bodyObj.updateMatrix();
      rootM.copy(bodyObj.matrix);
      // Frozen monsters hold their pose: animate on a stopped clock.
      if (frozen) ctx.now = 0;
      o.pool.push(rootM, ctx);
      ctx.now = now;

      blobs.push(x, 0.2, z, s * 1.15);
      const tier = mobTier(m);
      if (tier >= 1) rings.push(x, 0.5, z, s * 1.15, 1, s * 1.15, 0, col.copy(TIER_COLS[tier]).multiplyScalar(0.85));
      if (tier === 3) abyss.push(x, s, z, s * 1.6);
      if (m.from >= 0) rings.push(x, 0.6, z, s * 1.35, 1, s * 1.35, 0, col.copy(SEAT_COLS[m.from] ?? WHITE));
      if (hit > 0) {
        TMP_OBJ.position.set(x, o.top * 0.5, z);
        TMP_OBJ.quaternion.copy(FACE_CAM);
        TMP_OBJ.scale.setScalar(s * 1.6);
        TMP_OBJ.updateMatrix();
        glows.pushMatrix(TMP_OBJ.matrix, col.copy(WHITE).multiplyScalar(0.95 * hit));
      }
      if (m.rage) {
        TMP_OBJ.position.set(x, o.top * 0.5, z);
        TMP_OBJ.quaternion.copy(FACE_CAM);
        TMP_OBJ.scale.setScalar(s * 2.4);
        TMP_OBJ.updateMatrix();
        glows.pushMatrix(TMP_OBJ.matrix, col.copy(RED).multiplyScalar(0.4 + 0.3 * Math.sin(now / 90 + m.id)));
      }
      if (m.slowT > 0)
        for (let i = 0; i < 3; i++) {
          const a = now / 500 + (i * Math.PI * 2) / 3;
          slows.push(x + Math.cos(a) * s * 1.1, o.top * 0.5, z + Math.sin(a) * s * 1.1, 1, 1.8, 1, a);
        }
      if (frozen) {
        shells.push(x, o.top * 0.45, z, s * 1.15);
        for (let i = 0; i < 3; i++) {
          const a = now / 200 + (i * Math.PI * 2) / 3;
          stars.push(x + Math.cos(a) * s * 0.8, o.top + 4, z + Math.sin(a) * s * 0.8, 1, 0.45, 1, a);
        }
      }
      if (m.poisonT > 0)
        for (let i = 0; i < 3; i++) {
          const t = (now / 600 + i / 3) % 1;
          bubbles.push(x + (i - 1) * s * 0.5, o.top + t * 9, z + (i % 2 ? 1 : -1) * s * 0.2, 1 - t * 0.6);
        }
      if ((m.burnT ?? 0) > 0)
        for (let i = 0; i < 4; i++) {
          const t = (now / 380 + i / 4) % 1;
          flames.push(x + (i - 1.5) * s * 0.45, o.top * 0.4 + t * 10, z + (i % 2 ? 1 : -1) * s * 0.3, 1 - t * 0.8);
        }
      if ((m.vulnT ?? 0) > 0) vulns.push(x, o.top * 0.5, z, s * 1.3, s * 1.3, s * 1.3, now / 900, VULN);
      if (m.kind === "shaman") {
        if ((m.healAt ?? -1) !== o.healAt) {
          o.healAt = m.healAt ?? -1;
          o.healStart = now;
        }
        const k = o.healStart >= 0 ? (now - o.healStart) / 700 : 1;
        if (k < 1) rings.push(x, 0.8, z, s + k * 45, 1, s + k * 45, 0, col.copy(HEAL).multiplyScalar(0.7 * (1 - k)));
      }
      if (f.selectedMob === m.id) {
        ringOn = true;
        mobRing.position.set(x, 0.9, z);
        mobRing.scale.setScalar(s * 1.6 + Math.sin(now / 150) * 1.2);
      }
    }
    for (const id of mobs.keys()) if (!seen.has(id)) mobs.delete(id);
    mobRing.visible = ringOn;

    for (const p of towerPools.values()) p.end();
    for (const p of mobPools.values()) p.pool.end();
    for (const s of sprays) s.end();

    // Camera: fit the board, then slow-motion zoom and screen shake.
    const fitW = BOARD_W + 30;
    const fitH = BOARD_H * Math.sin(ELEV) + 56;
    const zm = f.zoom.z;
    camera.left = -cw / 2;
    camera.right = cw / 2;
    camera.top = ch / 2;
    camera.bottom = -ch / 2;
    camera.zoom = Math.min(cw / fitW, ch / fitH) * zm;
    const tz0 = -10;
    const kz = zm > 1 ? 1 - 1 / zm : 0;
    target.set(toX(f.zoom.x) * kz, 0, tz0 + (toZ(f.zoom.y) - tz0) * kz);
    target.x -= f.shake.x;
    target.y += Math.cos(ELEV) * f.shake.y;
    target.z -= Math.sin(ELEV) * f.shake.y;
    camera.position.set(target.x, target.y + Math.sin(ELEV) * 900, target.z + Math.cos(ELEV) * 900);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    renderer.render(scene, camera);

    const pr2 = (bx: number, by: number, h: number, out: number[]) => {
      v.set(toX(bx), h, toZ(by)).project(camera);
      out[0] = ((v.x + 1) / 2) * cw;
      out[1] = ((1 - v.y) / 2) * ch;
    };
    pr2(0, 0, 0, P0);
    pr2(100, 0, 0, PX);
    pr2(0, 100, 0, PY);
    pr2(0, 0, 100, PH);
    proj.a = (PX[0] - P0[0]) / 100;
    proj.b = (PX[1] - P0[1]) / 100;
    proj.c = (PY[0] - P0[0]) / 100;
    proj.d = (PY[1] - P0[1]) / 100;
    proj.e = P0[0];
    proj.f = P0[1];
    proj.hx = (PH[0] - P0[0]) / 100;
    proj.hy = (PH[1] - P0[1]) / 100;
    return proj;
  }
  const P0 = [0, 0];
  const PX = [0, 0];
  const PY = [0, 0];
  const PH = [0, 0];
  const proj: Proj = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, hx: 0, hy: 0 };

  return {
    render,
    dispose() {
      for (const p of allPools()) p.dispose();
      for (const s of [...sprays, pads, kerbs, tufts, flowers]) s.dispose();
      for (const g of edgeGeos.values()) g.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh)) o.geometry.dispose();
      });
      fieldTex?.dispose();
      for (const g of res.geos) g.dispose();
      for (const m of res.mats) m.dispose();
      for (const t of res.texs) t.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
