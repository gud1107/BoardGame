/**
 * 시대의 진격 low-poly models, all built from primitives in code (no asset
 * files). Every unit look is a template of up to three merged geometries:
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
import type { Era, TurretKind, UnitKind } from "../data";

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

const SKIN = ["#d9a066", "#c68a5a", "#e0b083", "#b97f55"];
const WHITE = "#ffffff";

interface HumanOpt {
  skin?: string;
  top: string;
  legs: string;
  head?: "hair" | "band" | "helm" | "crest" | "hood" | "tricorn" | "bearskin" | "bandana" | "brodie" | "cap" | "visor" | "robot";
  weapon?: "club" | "sling" | "sword" | "bow" | "spear" | "cutlass" | "musket" | "bomb" | "rifle" | "blade" | "rail" | "none";
  shield?: "round" | "tower" | "scutum";
  y?: number;
  scale?: number;
  /** Arms raised for throwing. */
  raise?: boolean;
}

function human(b: Builder, o: HumanOpt) {
  const y = o.y ?? 0;
  const k = o.scale ?? 1;
  const P = (x: number, yy: number, z: number): [number, number, number] => [x * k, y + yy * k, z * k];
  const skin = o.skin ?? SKIN[0];
  const S = (n: number) => n * k;
  // legs + boots
  b.box(S(0.24), S(0.78), S(0.24), o.legs, P(0, 0.39, -0.16));
  b.box(S(0.24), S(0.78), S(0.24), o.legs, P(0, 0.39, 0.16));
  b.box(S(0.3), S(0.14), S(0.28), "#3b2a1d", P(0.04, 0.07, -0.16));
  b.box(S(0.3), S(0.14), S(0.28), "#3b2a1d", P(0.04, 0.07, 0.16));
  // torso + tabard (team)
  b.box(S(0.42), S(0.66), S(0.6), o.top, P(0, 1.1, 0));
  b.box(S(0.48), S(0.56), S(0.64), WHITE, P(0, 1.08, 0), { layer: "team" });
  b.box(S(0.22), S(0.14), S(0.22), WHITE, P(0.02, 1.44, -0.4), { layer: "team" });
  b.box(S(0.22), S(0.14), S(0.22), WHITE, P(0.06, 1.44, 0.4), { layer: "team" });
  b.box(S(0.46), S(0.06), S(0.64), "#3b2a1d", P(0, 0.8, 0));
  // arms
  const armRot: [number, number, number] = o.raise ? [0, 0, 2.4] : [0, 0, 0.5];
  b.box(S(0.17), S(0.56), S(0.17), o.top, P(0.08, 1.12, -0.4), { rot: o.raise ? [0, 0, 0.3] : [0, 0, 0] });
  b.box(S(0.17), S(0.56), S(0.17), o.top, P(0.2, 1.15, 0.4), { rot: armRot });
  b.ball(S(0.1), skin, o.raise ? P(0.0, 1.62, 0.42) : P(0.36, 0.95, 0.42), undefined, 0);
  // head
  b.ball(S(0.22), skin, P(0.02, 1.66, 0), undefined, 1);
  b.box(S(0.05), S(0.05), S(0.05), "#1a1a1a", P(0.2, 1.7, -0.08));
  b.box(S(0.05), S(0.05), S(0.05), "#1a1a1a", P(0.2, 1.7, 0.08));
  switch (o.head ?? "hair") {
    case "hair":
      b.ball(S(0.23), "#3a2414", P(-0.04, 1.75, 0), { scale: [1, 0.7, 1] }, 0);
      break;
    case "band":
      b.ball(S(0.23), "#2b1a0f", P(-0.04, 1.76, 0), { scale: [1, 0.7, 1] }, 0);
      b.cyl(S(0.235), S(0.235), S(0.08), WHITE, P(0.02, 1.72, 0), { layer: "team" }, 8);
      b.cone(S(0.05), S(0.3), WHITE, P(-0.18, 1.98, 0), { layer: "team", rot: [0, 0, 0.5] }, 4);
      break;
    case "helm":
    case "crest":
      b.ball(S(0.25), "#9ca3af", P(0, 1.74, 0), { scale: [1, 0.8, 1] }, 1);
      b.box(S(0.06), S(0.2), S(0.5), "#6b7280", P(0.18, 1.6, 0));
      if (o.head === "crest") b.box(S(0.42), S(0.16), S(0.07), WHITE, P(-0.04, 2.0, 0), { layer: "team" });
      break;
    case "hood":
      b.cone(S(0.27), S(0.5), "#5b4a2f", P(-0.02, 1.82, 0), undefined, 6);
      break;
    case "tricorn":
      b.cyl(S(0.34), S(0.34), S(0.06), "#1f2937", P(0, 1.84, 0), undefined, 3);
      b.cyl(S(0.18), S(0.22), S(0.16), "#1f2937", P(0, 1.92, 0), undefined, 6);
      b.ball(S(0.06), WHITE, P(0.18, 1.9, 0), { layer: "team" }, 0);
      break;
    case "bearskin":
      b.cyl(S(0.22), S(0.24), S(0.62), "#111827", P(0, 2.0, 0), undefined, 7);
      b.box(S(0.05), S(0.1), S(0.3), WHITE, P(0.2, 1.85, 0), { layer: "team" });
      break;
    case "bandana":
      b.ball(S(0.235), WHITE, P(-0.02, 1.76, 0), { scale: [1, 0.65, 1], layer: "team" }, 0);
      b.box(S(0.04), S(0.06), S(0.12), "#111", P(0.22, 1.71, -0.08));
      break;
    case "brodie":
      b.cyl(S(0.4), S(0.4), S(0.05), "#4d5a3a", P(0, 1.84, 0), undefined, 9);
      b.ball(S(0.22), "#4d5a3a", P(0, 1.85, 0), { scale: [1, 0.55, 1] }, 1);
      b.box(S(0.3), S(0.06), S(0.3), WHITE, P(0, 1.89, 0), { layer: "team", scale: [0.6, 1, 0.6] });
      break;
    case "cap":
      b.cyl(S(0.24), S(0.24), S(0.14), "#3f4a2e", P(0, 1.86, 0), undefined, 8);
      b.box(S(0.16), S(0.03), S(0.3), "#222", P(0.2, 1.8, 0));
      b.box(S(0.05), S(0.08), S(0.2), WHITE, P(0.23, 1.87, 0), { layer: "team" });
      break;
    case "visor":
      b.ball(S(0.27), "#e5e7eb", P(0, 1.7, 0), { scale: [1, 0.95, 1] }, 1);
      b.box(S(0.08), S(0.1), S(0.4), "#22d3ee", P(0.22, 1.7, 0), { layer: "glow" });
      b.box(S(0.3), S(0.06), S(0.08), WHITE, P(-0.04, 1.96, 0), { layer: "team" });
      break;
    case "robot":
      b.box(S(0.42), S(0.38), S(0.4), "#b08d57", P(0.02, 1.7, 0));
      b.box(S(0.06), S(0.08), S(0.3), "#fde047", P(0.24, 1.72, 0), { layer: "glow" });
      b.cyl(S(0.03), S(0.03), S(0.3), "#6b4f2a", P(0, 2.0, 0));
      b.ball(S(0.06), WHITE, P(0, 2.16, 0), { layer: "team" }, 0);
      break;
  }
  const hand = o.raise ? P(0.0, 1.62, 0.42) : P(0.36, 0.95, 0.42);
  switch (o.weapon ?? "none") {
    case "club":
      b.cyl(S(0.05), S(0.07), S(0.8), "#7c5a35", [hand[0] + S(0.15), hand[1] + S(0.25), hand[2]], { rot: [0, 0, -0.5] });
      b.ball(S(0.16), "#8b8b8b", [hand[0] + S(0.38), hand[1] + S(0.58), hand[2]], undefined, 0);
      break;
    case "sling":
      b.cyl(S(0.02), S(0.02), S(0.5), "#a16207", [hand[0], hand[1] + S(0.25), hand[2]]);
      b.ball(S(0.09), "#9ca3af", [hand[0], hand[1] + S(0.5), hand[2]], undefined, 0);
      break;
    case "sword":
    case "cutlass":
      b.box(S(0.07), S(0.12), S(0.2), "#7c5a35", [hand[0], hand[1], hand[2]]);
      b.box(S(0.08), S(0.68), S(0.04), "#d1d5db", [hand[0] + S(0.2), hand[1] + S(0.28), hand[2]], { rot: [0, 0, o.weapon === "cutlass" ? -0.9 : -0.7] });
      break;
    case "spear":
      b.cyl(S(0.035), S(0.035), S(2.0), "#7c5a35", [hand[0] + S(0.3), hand[1] + S(0.15), hand[2]], { rot: [0, 0, -1.2] });
      b.cone(S(0.07), S(0.26), "#d1d5db", [hand[0] + S(1.25), hand[1] + S(0.55), hand[2]], { rot: [0, 0, -1.2] }, 4);
      break;
    case "bow":
      b.add(new THREE.TorusGeometry(S(0.5), S(0.035), 4, 10, Math.PI), "#7c4a1e", [hand[0] + S(0.05), hand[1] + S(0.2), hand[2] - S(0.4)], { rot: [0, Math.PI / 2, -Math.PI / 2] });
      b.cyl(S(0.01), S(0.01), S(1.0), "#e5e7eb", [hand[0] - S(0.05), hand[1] + S(0.2), hand[2] - S(0.4)]);
      break;
    case "musket":
    case "rifle":
      b.box(S(1.25), S(0.08), S(0.08), o.weapon === "musket" ? "#5b3a1e" : "#3f3f46", [hand[0] + S(0.3), hand[1] + S(0.25), hand[2] - S(0.3)], { rot: [0, 0, 0.12] });
      b.box(S(0.4), S(0.14), S(0.1), "#7c4a1e", [hand[0] - S(0.2), hand[1] + S(0.18), hand[2] - S(0.3)], { rot: [0, 0, 0.12] });
      if (o.weapon === "rifle") b.cone(S(0.03), S(0.22), "#d1d5db", [hand[0] + S(1.0), hand[1] + S(0.33), hand[2] - S(0.3)], { rot: [0, 0, -Math.PI / 2 + 0.12] }, 4);
      break;
    case "bomb":
      b.ball(S(0.17), "#111827", [hand[0], hand[1] + S(0.15), hand[2]], undefined, 1);
      b.box(S(0.03), S(0.12), S(0.03), "#f59e0b", [hand[0], hand[1] + S(0.35), hand[2]], { layer: "glow" });
      break;
    case "blade":
      b.box(S(0.08), S(0.16), S(0.16), "#374151", [hand[0], hand[1], hand[2]]);
      b.box(S(0.07), S(0.95), S(0.05), "#67e8f9", [hand[0] + S(0.26), hand[1] + S(0.38), hand[2]], { rot: [0, 0, -0.7], layer: "glow" });
      break;
    case "rail":
      b.box(S(1.2), S(0.16), S(0.16), "#4b5563", [hand[0] + S(0.25), hand[1] + S(0.3), hand[2] - S(0.3)]);
      b.box(S(1.0), S(0.05), S(0.05), "#a78bfa", [hand[0] + S(0.3), hand[1] + S(0.42), hand[2] - S(0.3)], { layer: "glow" });
      break;
  }
  if (o.shield) {
    const [w, h] = o.shield === "tower" ? [1.0, 1.35] : o.shield === "scutum" ? [0.62, 0.9] : [0.62, 0.62];
    if (o.shield === "round") b.cyl(S(0.34), S(0.34), S(0.08), WHITE, P(0.3, 1.1, -0.48), { rot: [Math.PI / 2, 0, Math.PI / 2], layer: "team" }, 9);
    else {
      b.box(S(0.1), S(h), S(w), WHITE, P(0.32, o.shield === "tower" ? 0.85 : 1.05, -0.42), { layer: "team" });
      b.box(S(0.12), S(h * 0.2), S(w * 0.2), "#d4a017", P(0.36, o.shield === "tower" ? 0.85 : 1.05, -0.42));
    }
  }
}

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

function wheels(b: Builder, xs: number[], z: number, r: number, color = "#1f2937") {
  for (const x of xs)
    for (const zz of [z, -z]) b.cyl(r, r, 0.2, color, [x, r, zz], { rot: [Math.PI / 2, 0, 0] }, 9);
}

function flag(b: Builder, x: number, y: number, z: number, h = 1.4) {
  b.cyl(0.03, 0.03, h, "#4b3621", [x, y + h / 2, z]);
  b.box(0.5, 0.32, 0.03, WHITE, [x - 0.26, y + h - 0.18, z], { layer: "team" });
}

const UNIT_BUILD: Record<UnitKind, (b: Builder) => number> = {
  club: (b) => (human(b, { top: "#7c5530", legs: "#5a3d22", head: "band", weapon: "club", skin: SKIN[1] }), 2.1),
  sling: (b) => (human(b, { top: "#8a6a3f", legs: "#5a3d22", head: "band", weapon: "sling", raise: true, skin: SKIN[2], scale: 0.95 }), 2.0),
  boar: (b) => {
    quadruped(b, "#5b3b22", { len: 1.6, h: 1.0, w: 0.8, tusk: true, mane: "#2b1a0f", head: 0.6 });
    human(b, { top: "#7c5530", legs: "#5a3d22", head: "band", weapon: "club", y: 0.75, scale: 0.85 });
    return 2.6;
  },
  legion: (b) => (human(b, { top: "#9ca3af", legs: "#7f1d1d", head: "crest", weapon: "sword", shield: "scutum" }), 2.1),
  archer: (b) => (human(b, { top: "#6b4f2a", legs: "#3f3f2a", head: "hood", weapon: "bow" }), 2.1),
  cavalry: (b) => {
    quadruped(b, "#6b4226", { len: 1.8, h: 1.25, w: 0.6, mane: "#1c1917", head: 0.5 });
    human(b, { top: "#9ca3af", legs: "#7f1d1d", head: "helm", weapon: "spear", y: 0.95, scale: 0.85 });
    return 2.9;
  },
  shieldwall: (b) => (human(b, { top: "#6b7280", legs: "#374151", head: "helm", weapon: "sword", shield: "tower", scale: 1.1 }), 2.3),
  chariot: (b) => {
    b.box(1.0, 0.5, 1.2, "#7c5a35", [-0.4, 0.75, 0]);
    b.box(1.02, 0.12, 1.22, WHITE, [-0.4, 1.0, 0], { layer: "team" });
    wheels(b, [-0.4], 0.68, 0.45, "#5b3a1e");
    b.cone(0.08, 0.7, "#d1d5db", [-0.4, 0.45, 0.95], { rot: [Math.PI / 2, 0, 0] }, 4);
    b.cone(0.08, 0.7, "#d1d5db", [-0.4, 0.45, -0.95], { rot: [-Math.PI / 2, 0, 0] }, 4);
    b.box(1.2, 0.06, 0.06, "#5b3a1e", [0.5, 0.75, 0]);
    b.box(1.1, 0.55, 0.45, "#8b5a2b", [1.4, 1.0, 0]);
    for (const lx of [1.0, 1.8]) for (const lz of [0.12, -0.12]) b.box(0.13, 0.75, 0.13, "#8b5a2b", [lx, 0.37, lz]);
    b.box(0.4, 0.35, 0.3, "#8b5a2b", [2.0, 1.3, 0], { rot: [0, 0, -0.4] });
    human(b, { top: "#9ca3af", legs: "#7f1d1d", head: "crest", weapon: "spear", y: 0.5, scale: 0.85 });
    return 2.4;
  },
  marine: (b) => (human(b, { top: "#1e3a5f", legs: "#e5e7eb", head: "tricorn", weapon: "cutlass" }), 2.1),
  musket: (b) => (human(b, { top: "#1e3a5f", legs: "#e5e7eb", head: "tricorn", weapon: "musket" }), 2.1),
  dragoon: (b) => {
    quadruped(b, "#3f2a1a", { len: 1.8, h: 1.25, w: 0.6, mane: "#111", head: 0.5 });
    human(b, { top: "#1e3a5f", legs: "#e5e7eb", head: "helm", weapon: "musket", y: 0.95, scale: 0.85 });
    return 2.9;
  },
  grenadier: (b) => (human(b, { top: "#1e3a5f", legs: "#e5e7eb", head: "bearskin", weapon: "bomb", raise: true }), 2.4),
  corsair: (b) => (human(b, { top: "#7f1d1d", legs: "#1f2937", head: "bandana", weapon: "cutlass", skin: SKIN[3] }), 2.1),
  trooper: (b) => (human(b, { top: "#556b2f", legs: "#4a5a2a", head: "brodie", weapon: "rifle" }), 2.1),
  rifle: (b) => (human(b, { top: "#5f6b3a", legs: "#4a5a2a", head: "cap", weapon: "rifle" }), 2.1),
  armored: (b) => {
    b.box(2.6, 0.9, 1.4, "#5b6b3a", [0, 0.95, 0]);
    b.box(1.2, 0.6, 1.1, "#4d5a30", [-0.2, 1.7, 0]);
    b.box(2.62, 0.18, 1.42, WHITE, [0, 1.15, 0], { layer: "team" });
    b.box(0.9, 0.12, 0.12, "#27272a", [0.7, 1.75, 0]);
    wheels(b, [-0.8, 0.8], 0.72, 0.42);
    b.box(0.1, 0.25, 0.9, "#fde047", [1.31, 1.05, 0], { layer: "glow", scale: [1, 0.4, 0.4] });
    flag(b, -1.0, 2.0, 0.4, 0.9);
    return 2.6;
  },
  automaton: (b) => (human(b, { top: "#b08d57", legs: "#8a6d3b", head: "robot", weapon: "rifle", skin: "#a3a3a3", scale: 0.95 }), 2.3),
  steamtank: (b) => {
    b.box(3.4, 1.3, 1.9, "#57534e", [0, 1.3, 0]);
    b.box(3.6, 0.6, 2.1, "#292524", [0, 0.45, 0]);
    b.box(3.42, 0.2, 1.92, WHITE, [0, 1.6, 0], { layer: "team" });
    b.cyl(0.28, 0.32, 1.2, "#44403c", [-0.9, 2.5, 0], undefined, 8);
    b.cyl(0.18, 0.18, 1.6, "#3f3f46", [1.9, 1.5, 0], { rot: [0, 0, Math.PI / 2] }, 8);
    b.box(1.4, 0.8, 1.3, "#6b5e52", [0.4, 2.3, 0]);
    for (const x of [-1.3, -0.45, 0.45, 1.3]) b.cyl(0.32, 0.32, 2.15, "#1c1917", [x, 0.35, 0], { rot: [Math.PI / 2, 0, 0] }, 8);
    b.box(0.12, 0.3, 0.3, "#f97316", [-0.9, 3.12, 0], { layer: "glow" });
    return 3.3;
  },
  plasma: (b) => (human(b, { top: "#e5e7eb", legs: "#334155", head: "visor", weapon: "blade", skin: "#cbd5e1", shield: "round" }), 2.2),
  railgun: (b) => (human(b, { top: "#cbd5e1", legs: "#334155", head: "visor", weapon: "rail", skin: "#cbd5e1" }), 2.2),
  hovertank: (b) => {
    b.box(2.8, 0.7, 1.6, "#cbd5e1", [0, 1.15, 0], { rot: [0, 0, 0.04] });
    b.box(1.5, 0.5, 1.1, "#94a3b8", [-0.2, 1.7, 0]);
    b.box(1.6, 0.1, 0.1, "#475569", [0.9, 1.75, 0]);
    b.box(2.82, 0.14, 1.62, WHITE, [0, 1.35, 0], { layer: "team" });
    b.box(2.2, 0.1, 1.3, "#22d3ee", [0, 0.72, 0], { layer: "glow" });
    b.box(0.08, 0.1, 0.8, "#a78bfa", [1.72, 1.75, 0], { layer: "glow" });
    return 2.4;
  },
  drone: (b) => {
    b.ball(0.5, "#e2e8f0", [0, 2.0, 0], { scale: [1.2, 0.7, 1.2] }, 1);
    b.ball(0.2, "#4ade80", [0.4, 1.95, 0], { layer: "glow" }, 0);
    for (const [x, z] of [[0.7, 0.7], [0.7, -0.7], [-0.7, 0.7], [-0.7, -0.7]]) {
      b.box(0.9, 0.06, 0.08, "#475569", [x * 0.55, 2.15, z * 0.55], { rot: [0, Math.atan2(z, x), 0] });
      b.cyl(0.32, 0.32, 0.03, "#94a3b8", [x, 2.22, z], undefined, 8);
    }
    b.cyl(0.52, 0.52, 0.1, WHITE, [0, 2.1, 0], { layer: "team" }, 10);
    return 2.6;
  },
  colossus: (b) => {
    human(b, { top: "#64748b", legs: "#334155", head: "visor", weapon: "blade", skin: "#94a3b8", scale: 2.0 });
    b.cyl(0.28, 0.28, 1.6, "#78350f", [-0.8, 3.0, 0], undefined, 8);
    for (let i = 0; i < 4; i++) b.cyl(0.42, 0.42, 0.1, "#a78bfa", [-0.8, 2.4 + i * 0.4, 0], { layer: "glow" }, 10);
    b.ball(0.32, "#c4b5fd", [-0.8, 4.0, 0], { layer: "glow" }, 1);
    return 4.4;
  },
};

const cache = new Map<string, Template>();

export function unitTemplate(kind: UnitKind): Template {
  let t = cache.get(kind);
  if (!t) {
    const b = new Builder();
    const h = UNIT_BUILD[kind](b);
    t = b.template(h);
    cache.set(kind, t);
  }
  return t;
}

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
