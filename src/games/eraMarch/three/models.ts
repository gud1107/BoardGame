/**
 * 시대의 진격 low-poly bases, turrets and special props, built from primitives
 * in code (no asset files); units are jointed rigs in rigs.ts. Every look here
 * is a template of up to three merged geometries:
 *
 * - `main`: vertex-coloured body (lit, flat-shaded)
 * - `team`: white parts the scene tints with the side colour (tabard, plume,
 *   shield face, banner) so blue/red reads at a glance from any distance
 * - `glow`: unlit bright parts (torches, visors, energy blades)
 *
 * Units face +X with their feet at the origin; 1 world unit = 10 lane units,
 * a foot soldier stands about 2 units tall.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Era, TurretKind } from "../data";

export interface Template {
  main: THREE.BufferGeometry;
  team: THREE.BufferGeometry | null;
  glow: THREE.BufferGeometry | null;
  /** Height of the head top — HP bar anchor. */
  height: number;
}

type Layer = "main" | "team" | "glow";

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Collects coloured, transformed primitives per layer and merges them. */
class Builder {
  parts: Record<Layer, THREE.BufferGeometry[]> = { main: [], team: [], glow: [] };

  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, pos: [number, number, number], opt: { rot?: [number, number, number]; scale?: number | [number, number, number]; layer?: Layer } = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    if (g.attributes.uv) g.deleteAttribute("uv");
    const sc = opt.scale ?? 1;
    _s.set(...(typeof sc === "number" ? ([sc, sc, sc] as [number, number, number]) : sc));
    _q.setFromEuler(_e.set(...(opt.rot ?? [0, 0, 0])));
    _p.set(...pos);
    g.applyMatrix4(_m.compose(_p, _q, _s));
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    this.parts[opt.layer ?? "main"].push(g);
    return this;
  }
  box(w: number, h: number, d: number, color: THREE.ColorRepresentation, pos: [number, number, number], opt?: Parameters<Builder["add"]>[3]) {
    return this.add(new THREE.BoxGeometry(w, h, d), color, pos, opt);
  }
  ball(r: number, color: THREE.ColorRepresentation, pos: [number, number, number], opt?: Parameters<Builder["add"]>[3], detail = 1) {
    return this.add(new THREE.IcosahedronGeometry(r, detail), color, pos, opt);
  }
  cyl(rt: number, rb: number, h: number, color: THREE.ColorRepresentation, pos: [number, number, number], opt?: Parameters<Builder["add"]>[3], seg = 7) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, pos, opt);
  }
  cone(r: number, h: number, color: THREE.ColorRepresentation, pos: [number, number, number], opt?: Parameters<Builder["add"]>[3], seg = 6) {
    return this.add(new THREE.ConeGeometry(r, h, seg), color, pos, opt);
  }
  merged(layer: Layer): THREE.BufferGeometry | null {
    const list = this.parts[layer];
    if (!list.length) return null;
    const g = mergeGeometries(list, false)!;
    for (const p of list) p.dispose();
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
  template(height: number): Template {
    return { main: this.merged("main")!, team: this.merged("team"), glow: this.merged("glow"), height };
  }
}

/* ── humanoids ───────────────────────────────────────────────────────── */

const WHITE = "#ffffff";

/* ── mounts / vehicles ───────────────────────────────────────────────── */

function quadruped(b: Builder, body: string, opt: { len: number; h: number; w: number; tusk?: boolean; mane?: string; head: number }) {
  const { len, h, w } = opt;
  b.box(len, h * 0.5, w, body, [0, h * 0.75, 0]);
  for (const [lx, lz] of [[len * 0.35, w * 0.3], [len * 0.35, -w * 0.3], [-len * 0.35, w * 0.3], [-len * 0.35, -w * 0.3]]) b.box(0.18, h * 0.55, 0.18, body, [lx, h * 0.27, lz]);
  b.box(opt.head, opt.head * 0.8, w * 0.7, body, [len * 0.55, h * 0.95, 0], { rot: [0, 0, -0.35] });
  if (opt.mane) b.box(len * 0.4, 0.14, 0.12, opt.mane, [len * 0.3, h * 1.04, 0]);
  if (opt.tusk) {
    b.cone(0.06, 0.4, "#f5f5f4", [len * 0.75, h * 0.8, 0.18], { rot: [0, 0, -1.9] }, 4);
    b.cone(0.06, 0.4, "#f5f5f4", [len * 0.75, h * 0.8, -0.18], { rot: [0, 0, -1.9] }, 4);
  }
  // saddle cloth
  b.box(len * 0.42, 0.06, w * 1.05, WHITE, [-0.05, h + 0.02, 0], { layer: "team" });
}

function flag(b: Builder, x: number, y: number, z: number, h = 1.4) {
  b.cyl(0.03, 0.03, h, "#4b3621", [x, y + h / 2, z]);
  b.box(0.5, 0.32, 0.03, WHITE, [x - 0.26, y + h - 0.18, z], { layer: "team" });
}

const cache = new Map<string, Template>();

/* ── bases ───────────────────────────────────────────────────────────── */

/** A side's base for an era, facing +X (the scene mirrors it for side 1). Origin = wall foot centre. */
export function baseTemplate(era: Era): Template {
  const key = `base${era}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const b = new Builder();
  let h = 8;
  switch (era) {
    case 0: {
      // log palisade, huts, totem, torches
      for (let i = 0; i < 9; i++) {
        const z = -4 + i;
        b.cyl(0.32, 0.36, 3.2 + ((i * 7) % 3) * 0.3, "#7c5a35", [0, 1.6, z], undefined, 6);
        b.cone(0.33, 0.6, "#6b4a2b", [0, 3.4 + ((i * 7) % 3) * 0.3, z], undefined, 6);
      }
      b.cyl(2.2, 2.4, 2.2, "#8b6b45", [-3.5, 1.1, -1.5], undefined, 8);
      b.cone(2.9, 2.6, "#a3803f", [-3.5, 3.5, -1.5], undefined, 8);
      b.cyl(1.5, 1.6, 1.6, "#8b6b45", [-3.0, 0.8, 2.6], undefined, 8);
      b.cone(2.0, 2.0, "#a3803f", [-3.0, 2.6, 2.6], undefined, 8);
      for (let i = 0; i < 3; i++) b.box(0.9, 1.4, 0.9, ["#b45309", "#7c2d12", "#a16207"][i], [-1.4, 1.0 + i * 1.4, 0.4]);
      b.box(1.8, 0.3, 0.3, "#7c2d12", [-1.4, 4.0, 0.4]);
      b.box(1.2, 0.8, 0.1, WHITE, [-1.4, 5.5, 0.4], { layer: "team" });
      b.cyl(0.04, 0.04, 1.6, "#4b3621", [-1.4, 5.0, 0.4]);
      for (const z of [-4.6, 4.6]) {
        b.cyl(0.1, 0.12, 2.8, "#5b3a1e", [0.6, 1.4, z]);
        b.ball(0.32, "#fb923c", [0.6, 3.0, z], { layer: "glow" }, 0);
      }
      h = 6;
      break;
    }
    case 1: {
      b.box(2.2, 5, 10, "#d6d3d1", [0, 2.5, 0]);
      for (let i = 0; i < 6; i++) b.box(2.4, 0.8, 0.9, "#e7e5e4", [0, 5.4, -4.4 + i * 1.76]);
      b.cyl(2.0, 2.2, 8, "#d6d3d1", [-2.8, 4, 0], undefined, 10);
      b.cone(2.6, 3, "#991b1b", [-2.8, 9.5, 0], undefined, 10);
      for (const z of [-3, 3]) b.cyl(0.4, 0.4, 5, "#f5f5f4", [1.3, 2.5, z], undefined, 8);
      b.box(0.1, 3.2, 1.6, WHITE, [1.2, 3.0, 0], { layer: "team" });
      b.box(0.15, 2.4, 2.0, "#57534e", [1.15, 1.2, 0]);
      flag(b, -2.8, 11, 0, 2);
      h = 11;
      break;
    }
    case 2: {
      // star fort with gun ports and a mast
      b.box(3.4, 4, 11, "#a8a29e", [0, 2, 0]);
      b.box(2.4, 1.2, 4, "#a8a29e", [1.6, 0.6, 0], { rot: [0, Math.PI / 4, 0] });
      for (let i = 0; i < 4; i++) b.box(0.3, 0.6, 0.8, "#1c1917", [1.72, 2.6, -3.6 + i * 2.4]);
      b.box(3.6, 0.5, 11.2, WHITE, [0, 4.2, 0], { layer: "team" });
      b.box(5, 3.2, 6, "#78716c", [-3.5, 1.6, 0]);
      b.cyl(0.2, 0.25, 9, "#5b3a1e", [-3.5, 7.6, 0]);
      b.box(0.1, 2.6, 3.4, "#f5f5f4", [-3.4, 9.5, 0]);
      b.box(0.12, 1.2, 1.6, WHITE, [-3.5, 11.4, 0.8], { layer: "team" });
      b.box(1.2, 1.4, 1.2, "#44403c", [-1.2, 4.9, 3.5]);
      h = 9;
      break;
    }
    case 3: {
      b.box(3, 5, 11, "#7f3b2a", [0, 2.5, 0]);
      b.box(3.1, 0.4, 11.1, "#3f3f46", [0, 5.1, 0]);
      b.box(6, 7, 7, "#8a4a35", [-4, 3.5, 0]);
      b.box(6.1, 0.6, 7.1, WHITE, [-4, 6.4, 0], { layer: "team" });
      for (const [x, z] of [[-5.5, -2], [-3.5, 2.4], [-2.2, -2.6]]) b.cyl(0.55, 0.7, 6, "#44403c", [x, 9.5, z], undefined, 8);
      b.cyl(1.6, 1.6, 0.4, "#a16207", [1.55, 3.3, 0], { rot: [0, 0, Math.PI / 2] }, 12);
      for (let i = 0; i < 8; i++) b.box(0.42, 0.42, 0.6, "#a16207", [1.6, 3.3 + Math.sin((i / 8) * Math.PI * 2) * 1.75, Math.cos((i / 8) * Math.PI * 2) * 1.75]);
      for (let i = 0; i < 5; i++) b.box(0.1, 0.5, 0.9, "#fde68a", [-0.9, 3.5, -4 + i * 2], { layer: "glow" });
      b.box(0.2, 2.6, 3, "#27272a", [1.5, 1.3, 0]);
      h = 12;
      break;
    }
    case 4: {
      b.cyl(3.4, 4.2, 4, "#cbd5e1", [-1.4, 2, 0], undefined, 6);
      b.cyl(2.2, 3.0, 7, "#e2e8f0", [-1.4, 7.5, 0], undefined, 6);
      b.cone(2.2, 4, "#94a3b8", [-1.4, 13, 0], undefined, 6);
      for (let i = 0; i < 3; i++) b.cyl(3.1 - i * 0.4, 3.1 - i * 0.4, 0.25, "#22d3ee", [-1.4, 5 + i * 2.6, 0], { layer: "glow" }, 6);
      b.ball(0.8, "#e879f9", [-1.4, 15.4, 0], { layer: "glow" }, 1);
      b.box(1.5, 5, 9, "#94a3b8", [1.5, 2.5, 0]);
      b.box(0.2, 4.2, 8, "#38bdf8", [2.3, 2.6, 0], { layer: "glow", scale: [1, 1, 1] });
      b.cyl(3.45, 4.25, 0.5, WHITE, [-1.4, 4.2, 0], { layer: "team" }, 6);
      h = 15;
      break;
    }
  }
  const t = b.template(h);
  cache.set(key, t);
  return t;
}

/** Turret slot anchors on a base, relative to its origin (facing +X). */
export const TURRET_SLOTS: readonly (readonly [number, number, number])[] = [
  [1.2, 5.6, 2.6],
  [1.2, 5.6, -2.6],
  [-0.6, 7.8, 0],
];

export function turretTemplate(kind: TurretKind): Template {
  const key = `tur-${kind}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const b = new Builder();
  const pal: Record<TurretKind, [string, string, string | null]> = {
    rock: ["#7c5a35", "#8b8b8b", null],
    fire: ["#7c5a35", "#5b3a1e", "#fb923c"],
    ballista: ["#8b6b45", "#5b3a1e", null],
    pitch: ["#57534e", "#292524", "#f59e0b"],
    cannon: ["#44403c", "#1c1917", null],
    mortar: ["#57534e", "#1c1917", null],
    gatling: ["#3f3f46", "#71717a", null],
    flak: ["#4d5a30", "#27272a", null],
    laser: ["#cbd5e1", "#64748b", "#f43f5e"],
    tesla: ["#94a3b8", "#78350f", "#a78bfa"],
  };
  const [base, barrel, glow] = pal[kind];
  b.box(1.3, 0.5, 1.3, base, [0, 0.25, 0]);
  b.box(1.32, 0.15, 1.32, WHITE, [0, 0.52, 0], { layer: "team" });
  switch (kind) {
    case "rock":
    case "ballista":
      b.box(1.6, 0.14, 0.14, barrel, [0.3, 0.9, 0], { rot: [0, 0, 0.5] });
      b.box(0.14, 0.14, 1.2, barrel, [0.2, 0.75, 0]);
      if (kind === "rock") b.ball(0.25, "#8b8b8b", [-0.3, 0.75, 0], undefined, 0);
      break;
    case "tesla":
      b.cyl(0.2, 0.3, 1.6, barrel, [0, 1.3, 0], undefined, 8);
      for (let i = 0; i < 3; i++) b.cyl(0.42, 0.42, 0.08, glow!, [0, 0.9 + i * 0.4, 0], { layer: "glow" }, 10);
      b.ball(0.35, glow!, [0, 2.3, 0], { layer: "glow" }, 1);
      break;
    case "mortar":
      b.cyl(0.32, 0.38, 0.9, barrel, [0.15, 0.95, 0], { rot: [0, 0, -0.6] }, 8);
      break;
    case "gatling":
      for (let i = 0; i < 4; i++) b.cyl(0.07, 0.07, 1.4, barrel, [0.6, 0.95 + Math.sin(i * 1.57) * 0.12, Math.cos(i * 1.57) * 0.12], { rot: [0, 0, Math.PI / 2] }, 5);
      b.box(0.6, 0.5, 0.6, base, [0, 0.95, 0]);
      break;
    default:
      b.box(0.7, 0.5, 0.7, base, [0, 0.8, 0]);
      b.cyl(0.16, 0.2, 1.4, barrel, [0.6, 0.95, 0], { rot: [0, 0, Math.PI / 2] }, 8);
      if (glow) b.ball(0.18, glow, [1.32, 0.95, 0], { layer: "glow" }, 0);
  }
  if (glow && kind !== "tesla" && kind !== "laser") b.ball(0.16, glow, [-0.3, 1.2, 0.3], { layer: "glow" }, 0);
  const t = b.template(1.6);
  cache.set(key, t);
  return t;
}

/* ── special props + scenery ─────────────────────────────────────────── */

export function mammothTemplate(): Template {
  const hit = cache.get("mammoth");
  if (hit) return hit;
  const b = new Builder();
  quadruped(b, "#6b4226", { len: 3.4, h: 2.6, w: 2.0, mane: "#3b2414", head: 1.5 });
  b.ball(1.5, "#5b3820", [-0.2, 2.3, 0], { scale: [1.4, 1.0, 1.0] }, 1);
  for (const z of [0.5, -0.5]) b.add(new THREE.TorusGeometry(0.8, 0.12, 5, 8, Math.PI), "#f5f5f4", [2.3, 1.5, z], { rot: [0, 0, Math.PI * 0.85] });
  b.cyl(0.25, 0.15, 1.6, "#5b3820", [2.5, 1.2, 0], { rot: [0, 0, 0.3] });
  const t = b.template(4);
  cache.set("mammoth", t);
  return t;
}

export function airshipTemplate(): Template {
  const hit = cache.get("airship");
  if (hit) return hit;
  const b = new Builder();
  b.ball(2.2, "#d6d3d1", [0, 0, 0], { scale: [2.6, 1, 1] }, 2);
  b.box(2.4, 0.8, 1.0, "#57534e", [0, -2.4, 0]);
  b.box(5.5, 0.5, 0.1, WHITE, [0, 0, 2.18], { layer: "team" });
  b.box(5.5, 0.5, 0.1, WHITE, [0, 0, -2.18], { layer: "team" });
  for (const r of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) b.box(1.2, 0.08, 1.4, "#a8a29e", [-5.4, Math.sin(r) * 0.7, Math.cos(r) * 0.7], { rot: [r, 0, 0] });
  b.box(0.3, 0.3, 0.3, "#fde047", [1.0, -2.4, 0.52], { layer: "glow" });
  const t = b.template(3);
  cache.set("airship", t);
  return t;
}

export function shipTemplate(): Template {
  const hit = cache.get("ship");
  if (hit) return hit;
  const b = new Builder();
  b.box(9, 1.6, 2.6, "#5b3a1e", [0, 0.8, 0]);
  b.box(2.4, 1.2, 2.4, "#6b4a2b", [-3.4, 2.0, 0]);
  for (const x of [-1.5, 1.8]) {
    b.cyl(0.14, 0.18, 8, "#4b3621", [x, 5, 0]);
    b.box(0.1, 3.4, 3.2, "#f5f5f4", [x + 0.2, 5.6, 0]);
  }
  b.box(0.12, 0.9, 1.4, WHITE, [1.8, 9.2, 0], { layer: "team" });
  for (let i = 0; i < 4; i++) b.box(0.4, 0.3, 0.1, "#111", [-2 + i * 1.4, 1.1, 1.32]);
  const t = b.template(9);
  cache.set("ship", t);
  return t;
}

export function treeTemplate(): Template {
  const hit = cache.get("tree");
  if (hit) return hit;
  const b = new Builder();
  b.cyl(0.25, 0.35, 1.6, "#6b4a2b", [0, 0.8, 0], undefined, 5);
  b.cone(1.6, 2.6, "#3f6b2a", [0, 2.6, 0], undefined, 6);
  b.cone(1.2, 2.0, "#4d7c32", [0, 3.8, 0], undefined, 6);
  const t = b.template(5);
  cache.set("tree", t);
  return t;
}

export function rockTemplate(): Template {
  const hit = cache.get("rock");
  if (hit) return hit;
  const b = new Builder();
  b.add(new THREE.DodecahedronGeometry(0.8, 0), "#8b8f86", [0, 0.35, 0], { scale: [1.3, 0.7, 1] });
  b.add(new THREE.DodecahedronGeometry(0.5, 0), "#7a7d74", [0.7, 0.2, 0.4], { scale: [1, 0.7, 1] });
  const t = b.template(1);
  cache.set("rock", t);
  return t;
}
