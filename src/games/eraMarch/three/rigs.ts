/**
 * 시대의 진격 unit rigs: every unit is a handful of jointed parts (body, legs,
 * arms, mount legs, wheels, rotors, barrel, cape) so the scene can animate
 * real combat motion: chopping swings, spear thrusts, bow draws, musket
 * recoil, gallops, wheel spin.
 *
 * - Built from primitives in code (no asset files), with rounded torsos,
 *   capsule limbs and a baked top-to-bottom shade for a softer, painted look.
 * - The side colour is baked into each side's rig (tabard, plumes, shields,
 *   capes, saddle cloth), so a unit look is one mesh per part — the scene
 *   instances every part across all units of that kind and side.
 * - Each part's geometry is stored around its pivot (shoulder, hip, axle…);
 *   multi-pivot parts (two legs, four wheels) reuse one geometry per pivot.
 *
 * Frame: the unit faces +X with its feet at the origin, a foot soldier is
 * ~2.1 units tall. Arms hang along −Y from the shoulder, so a weapon is built
 * straight down past the hand; rotating the arm about +Z by θ swings the hand
 * forward (θ = π/2 points it straight ahead, θ = π overhead).
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { UnitKind } from "../data";

export const TEAM_HEX: [string, string] = ["#3b82f6", "#ef4444"];
const TEAM_DARK: [string, string] = ["#1e40af", "#991b1b"];

export type PartKey = "body" | "legs" | "armL" | "armR" | "cape" | "fleg" | "bleg" | "wheel" | "rotor" | "barrel";
/** How the arms fight. */
export type Weapon = "swing" | "thrust" | "bow" | "gun" | "sling" | "throw" | "heal" | "drum" | "none";
/** How the whole body moves. */
export type Frame = "human" | "mount" | "vehicle" | "drone";

export interface RigPart {
  key: PartKey;
  pivots: THREE.Vector3[];
  main: THREE.BufferGeometry | null;
  glow: THREE.BufferGeometry | null;
}

export interface Rig {
  parts: RigPart[];
  /** Top of the head — HP bar anchor. */
  height: number;
  frame: Frame;
  weapon: Weapon;
  /** Body pivot height for leaning (hips / mount back). */
  hipY: number;
  /** Visual scale of the motion (giants move slower and bigger). */
  heavy: number;
  /** Hand to swing a shield with. */
  shield: boolean;
  /** A vehicle that rams in melee (lunges on its blows); ranged ones only recoil. */
  ram: boolean;
}

type V3 = [number, number, number];

interface PartBuf {
  pivots: V3[];
  main: THREE.BufferGeometry[];
  glow: THREE.BufferGeometry[];
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

interface AddOpt {
  rot?: V3;
  scale?: number | V3;
  team?: boolean;
  dark?: boolean;
  glow?: boolean;
  /** Skip the baked vertical shade (flat bright parts). */
  flat?: boolean;
}

class RigBuilder {
  private parts = new Map<PartKey, PartBuf>();
  private cur: PartKey = "body";
  constructor(readonly side: 0 | 1) {
    this.part("body", [[0, 0, 0]]);
  }

  part(key: PartKey, pivots: V3[] = [[0, 0, 0]]) {
    if (!this.parts.has(key)) this.parts.set(key, { pivots, main: [], glow: [] });
    this.cur = key;
    return this;
  }

  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, pos: V3, opt: AddOpt = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    if (g.attributes.uv) g.deleteAttribute("uv");
    if (g.attributes.uv1) g.deleteAttribute("uv1");
    const sc = opt.scale ?? 1;
    _s.set(...(typeof sc === "number" ? ([sc, sc, sc] as V3) : sc));
    _q.setFromEuler(_e.set(...(opt.rot ?? [0, 0, 0])));
    g.applyMatrix4(_m.compose(_p.set(...pos), _q, _s));
    const c = new THREE.Color(opt.team ? TEAM_HEX[this.side] : opt.dark ? TEAM_DARK[this.side] : color);
    const pos3 = g.attributes.position;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos3.count; i++) {
      const y = pos3.getY(i);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const span = Math.max(1e-4, maxY - minY);
    const arr = new Float32Array(pos3.count * 3);
    for (let i = 0; i < pos3.count; i++) {
      // soft painted shade: darker underside of every primitive
      const k = opt.glow || opt.flat ? 1 : 0.78 + 0.22 * ((pos3.getY(i) - minY) / span);
      arr[i * 3] = c.r * k;
      arr[i * 3 + 1] = c.g * k;
      arr[i * 3 + 2] = c.b * k;
    }
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    const buf = this.parts.get(this.cur)!;
    (opt.glow ? buf.glow : buf.main).push(g);
    return this;
  }
  box(w: number, h: number, d: number, color: THREE.ColorRepresentation, pos: V3, opt?: AddOpt) {
    return this.add(new THREE.BoxGeometry(w, h, d), color, pos, opt);
  }
  rbox(w: number, h: number, d: number, color: THREE.ColorRepresentation, pos: V3, opt?: AddOpt, r = 0.06) {
    return this.add(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2)), color, pos, opt);
  }
  ball(r: number, color: THREE.ColorRepresentation, pos: V3, opt?: AddOpt, detail = 1) {
    return this.add(new THREE.IcosahedronGeometry(r, detail), color, pos, opt);
  }
  cap(r: number, len: number, color: THREE.ColorRepresentation, pos: V3, opt?: AddOpt) {
    return this.add(new THREE.CapsuleGeometry(r, len, 2, 7), color, pos, opt);
  }
  cyl(rt: number, rb: number, h: number, color: THREE.ColorRepresentation, pos: V3, opt?: AddOpt, seg = 8) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, pos, opt);
  }
  cone(r: number, h: number, color: THREE.ColorRepresentation, pos: V3, opt?: AddOpt, seg = 7) {
    return this.add(new THREE.ConeGeometry(r, h, seg), color, pos, opt);
  }

  build(meta: Omit<Rig, "parts">): Rig {
    const parts: RigPart[] = [];
    for (const [key, buf] of this.parts) {
      const p0 = buf.pivots[0];
      const merge = (list: THREE.BufferGeometry[]) => {
        if (!list.length) return null;
        const g = mergeGeometries(list, false)!;
        for (const x of list) x.dispose();
        g.translate(-p0[0], -p0[1], -p0[2]);
        g.computeVertexNormals();
        g.computeBoundingSphere();
        return g;
      };
      const main = merge(buf.main);
      const glow = merge(buf.glow);
      if (!main && !glow) continue;
      parts.push({ key, pivots: buf.pivots.map((v) => new THREE.Vector3(...v)), main, glow });
    }
    return { parts, ...meta };
  }
}

/* ── humanoid ────────────────────────────────────────────────────────── */

const SKIN = ["#e0ac78", "#c98d5e", "#efc49a", "#b97f55"];
const STEEL = "#cfd5dc";
const IRON = "#6b7280";
const LEATHER = "#4a3424";
const WOOD = "#7c5a35";

type Head = "band" | "helm" | "crest" | "hood" | "tricorn" | "bearskin" | "bandana" | "brodie" | "cap" | "visor" | "robot" | "fur";
type Gear = "club" | "sling" | "sword" | "cutlass" | "spear" | "bow" | "musket" | "rifle" | "bayonet" | "bomb" | "blade" | "rail" | "staff" | "holy" | "stick" | "kit" | "nano" | "boulder" | "none";

interface HumanOpt {
  skin?: string;
  top: string;
  legs: string;
  head: Head;
  gear: Gear;
  shield?: "round" | "tower" | "scutum" | "buckler";
  cape?: boolean;
  /** Plate or fur trim on the shoulders. */
  pads?: "team" | "fur" | "steel" | "brass";
  /** Seated on a mount: legs + left arm go into the body part, at this seat height. */
  ride?: number;
  /** Shift along the body (a charioteer stands in the cart behind the horse). */
  x?: number;
  scale?: number;
}

function human(b: RigBuilder, o: HumanOpt) {
  const k = o.scale ?? 1;
  const y0 = o.ride ?? 0;
  const x0 = o.x ?? 0;
  const P = (x: number, y: number, z: number): V3 => [x0 + x * k, y0 + y * k, z * k];
  const S = (n: number) => n * k;
  const skin = o.skin ?? SKIN[0];

  // legs
  if (o.ride === undefined) {
    b.part("legs", [P(0, 0.82, -0.15), P(0, 0.82, 0.15)]);
    b.cap(S(0.105), S(0.26), o.legs, P(0, 0.6, -0.15));
    b.cap(S(0.09), S(0.24), o.legs, P(0.02, 0.3, -0.15));
    b.rbox(S(0.3), S(0.14), S(0.21), LEATHER, P(0.06, 0.07, -0.15), undefined, S(0.05));
    b.part("body");
  } else {
    // straddling: thighs forward-out, shins down along the mount's flank
    for (const z of [-0.26, 0.26]) {
      b.cap(S(0.1), S(0.26), o.legs, P(0.12, -0.02, z), { rot: [0, 0, -1.3] });
      b.cap(S(0.085), S(0.24), o.legs, P(0.28, -0.3, z * 1.25));
      b.rbox(S(0.26), S(0.12), S(0.18), LEATHER, P(0.32, -0.5, z * 1.25), undefined, S(0.04));
    }
  }
  // body
  b.rbox(S(0.36), S(0.2), S(0.5), o.legs, P(0, 0.88, 0));
  b.rbox(S(0.44), S(0.64), S(0.6), o.top, P(0, 1.17, 0), undefined, S(0.1));
  b.rbox(S(0.47), S(0.5), S(0.46), "", P(0.01, 1.1, 0), { team: true }, S(0.06));
  b.box(S(0.48), S(0.07), S(0.62), LEATHER, P(0, 0.9, 0));
  b.box(S(0.08), S(0.09), S(0.12), "#d4a017", P(0.24, 0.9, 0), { flat: true });
  b.cyl(S(0.1), S(0.11), S(0.12), skin, P(0, 1.52, 0));
  if (o.pads === "fur") for (const z of [-0.33, 0.33]) b.ball(S(0.17), "#8a6a45", P(0, 1.44, z), { scale: [1.2, 0.7, 1] }, 1);
  else if (o.pads) for (const z of [-0.34, 0.34]) b.ball(S(0.16), o.pads === "steel" ? STEEL : o.pads === "brass" ? "#b08d57" : "", P(0, 1.45, z), { scale: [1.15, 0.62, 1], team: o.pads === "team" }, 1);
  // head
  b.ball(S(0.23), skin, P(0.02, 1.72, 0), undefined, 2);
  b.box(S(0.05), S(0.06), S(0.05), "#111", P(0.22, 1.75, -0.08), { flat: true });
  b.box(S(0.05), S(0.06), S(0.05), "#111", P(0.22, 1.75, 0.08), { flat: true });
  b.box(S(0.06), S(0.07), S(0.05), skin, P(0.25, 1.69, 0));
  headgear(b, o.head, P, S);
  if (o.cape) {
    b.part("cape", [P(-0.24, 1.46, 0)]);
    b.rbox(S(0.05), S(0.95), S(0.56), "", P(-0.27, 1.0, 0), { team: true }, S(0.02));
    b.rbox(S(0.06), S(0.1), S(0.6), "#d4a017", P(-0.25, 1.46, 0), { flat: true }, S(0.02));
    b.part("body");
  }

  // left arm (shield / bow / support hand)
  if (o.ride === undefined || o.gear === "bow") b.part("armL", [P(0, 1.42, -0.39)]);
  arm(b, P, S, -0.39, o.top, skin, o.ride !== undefined && o.gear !== "bow");
  const HL = P(0, 0.86, -0.39);
  if (o.shield) {
    const [th, h, w] = o.shield === "tower" ? [0.1, 1.25, 0.9] : o.shield === "scutum" ? [0.09, 0.86, 0.58] : [0.08, 0.5, 0.5];
    if (o.shield === "round" || o.shield === "buckler") {
      const r = o.shield === "round" ? 0.34 : 0.24;
      b.cyl(S(r), S(r), S(0.07), "", [HL[0] + S(0.12), HL[1] + S(0.06), HL[2] - S(0.06)], { rot: [0, 0, Math.PI / 2], team: true }, 12);
      b.cyl(S(r * 0.3), S(r * 0.3), S(0.09), STEEL, [HL[0] + S(0.15), HL[1] + S(0.06), HL[2] - S(0.06)], { rot: [0, 0, Math.PI / 2] }, 8);
    } else {
      b.rbox(S(th), S(h), S(w), "", [HL[0] + S(0.13), HL[1] + S(o.shield === "tower" ? 0.1 : 0.06), HL[2] - S(0.04)], { team: true }, S(0.03));
      b.box(S(th + 0.02), S(h * 0.18), S(w * 0.18), "#d4a017", [HL[0] + S(0.15), HL[1] + S(0.08), HL[2] - S(0.04)], { flat: true });
      b.box(S(th + 0.01), S(h + 0.02), S(0.05), "#d4a017", [HL[0] + S(0.14), HL[1] + S(0.06), HL[2] - S(0.04) - S(w / 2)], { flat: true });
    }
  }
  if (o.gear === "stick") weapon(b, "stick", HL, S);
  if (o.gear === "bow") {
    b.add(new THREE.TorusGeometry(S(0.52), S(0.028), 4, 14, Math.PI), "#7c4a1e", [HL[0], HL[1] + S(0.5), HL[2]], { rot: [0, 0, Math.PI] });
    b.box(S(1.04), S(0.012), S(0.012), "#f5f5f4", [HL[0], HL[1] + S(0.5), HL[2]], { flat: true });
  }
  b.part("body");

  if (o.gear === "stick") {
    b.cyl(S(0.3), S(0.3), S(0.34), "#b45309", P(0.36, 0.98, 0), { rot: [Math.PI / 2, 0, 0] }, 14);
    b.cyl(S(0.31), S(0.31), S(0.05), "", P(0.36, 0.98, 0.16), { rot: [Math.PI / 2, 0, 0], team: true }, 14);
    b.cyl(S(0.31), S(0.31), S(0.05), "", P(0.36, 0.98, -0.16), { rot: [Math.PI / 2, 0, 0], team: true }, 14);
    b.cyl(S(0.29), S(0.29), S(0.36), "#f5f5f4", P(0.37, 0.98, 0), { rot: [Math.PI / 2, 0, 0], flat: true }, 14);
  }
  if (o.gear === "kit") {
    b.box(S(0.04), S(0.14), S(0.04), "#16a34a", P(0.23, 1.22, 0), { flat: true });
    b.box(S(0.04), S(0.04), S(0.14), "#16a34a", P(0.23, 1.22, 0), { flat: true });
  }
  // right arm + weapon
  b.part("armR", [P(0, 1.42, 0.39)]);
  arm(b, P, S, 0.39, o.top, skin, false);
  weapon(b, o.gear, P(0, 0.86, 0.39), S);
  b.part("body");
}

function arm(b: RigBuilder, P: (x: number, y: number, z: number) => V3, S: (n: number) => number, z: number, top: string, skin: string, reins: boolean) {
  if (reins) {
    // holding the reins forward: one static bent arm in the body part
    b.cap(S(0.085), S(0.22), top, P(0.12, 1.28, z), { rot: [0, 0, 0.7] });
    b.cap(S(0.075), S(0.2), top, P(0.32, 1.14, z * 0.8), { rot: [0, 0, 1.4] });
    b.ball(S(0.085), skin, P(0.46, 1.12, z * 0.7), undefined, 1);
    return;
  }
  b.cap(S(0.088), S(0.22), top, P(0, 1.26, z));
  b.cap(S(0.078), S(0.2), top, P(0, 1.02, z));
  b.cyl(S(0.09), S(0.085), S(0.08), LEATHER, P(0, 0.93, z));
  b.ball(S(0.09), skin, P(0, 0.86, z), undefined, 1);
}

function headgear(b: RigBuilder, head: Head, P: (x: number, y: number, z: number) => V3, S: (n: number) => number) {
  switch (head) {
    case "fur":
      b.ball(S(0.25), "#6b4a2b", P(-0.02, 1.8, 0), { scale: [1, 0.62, 1] }, 1);
      b.cone(S(0.06), S(0.22), "#f5f5f4", P(-0.06, 1.98, -0.16), { rot: [0.5, 0, 0] }, 5);
      b.cone(S(0.06), S(0.22), "#f5f5f4", P(-0.06, 1.98, 0.16), { rot: [-0.5, 0, 0] }, 5);
      break;
    case "band":
      b.ball(S(0.24), "#2b1a0f", P(-0.04, 1.8, 0), { scale: [1, 0.68, 1] }, 1);
      b.cyl(S(0.24), S(0.24), S(0.08), "", P(0.02, 1.76, 0), { team: true }, 10);
      b.cone(S(0.05), S(0.34), "", P(-0.2, 2.04, 0), { rot: [0, 0, 0.6], team: true }, 4);
      b.cone(S(0.04), S(0.26), "#f5f5f4", P(-0.16, 2.06, 0.06), { rot: [0.3, 0, 0.4] }, 4);
      break;
    case "helm":
    case "crest":
      b.ball(S(0.26), STEEL, P(0, 1.78, 0), { scale: [1, 0.86, 1] }, 2);
      b.box(S(0.05), S(0.22), S(0.06), IRON, P(0.24, 1.7, 0));
      b.cyl(S(0.27), S(0.27), S(0.05), IRON, P(0, 1.68, 0), undefined, 12);
      if (head === "crest") {
        b.rbox(S(0.5), S(0.2), S(0.07), "", P(-0.04, 2.06, 0), { team: true }, S(0.03));
        b.box(S(0.08), S(0.12), S(0.08), "#d4a017", P(0.12, 1.98, 0), { flat: true });
      }
      break;
    case "hood":
      b.ball(S(0.27), "#4d3b22", P(-0.02, 1.76, 0), { scale: [1.05, 1, 1] }, 1);
      b.cone(S(0.2), S(0.32), "#4d3b22", P(-0.1, 1.98, 0), { rot: [0, 0, 0.7] }, 6);
      break;
    case "tricorn":
      b.cyl(S(0.36), S(0.36), S(0.05), "#1f2937", P(0, 1.88, 0), undefined, 3);
      b.cyl(S(0.2), S(0.23), S(0.16), "#1f2937", P(0, 1.96, 0), undefined, 8);
      b.cyl(S(0.37), S(0.37), S(0.02), "#d4a017", P(0, 1.86, 0), { flat: true }, 3);
      b.ball(S(0.06), "", P(0.17, 1.95, 0), { team: true }, 1);
      break;
    case "bearskin":
      b.cyl(S(0.23), S(0.25), S(0.62), "#111827", P(0, 2.06, 0), undefined, 10);
      b.box(S(0.05), S(0.12), S(0.3), "", P(0.21, 1.9, 0), { team: true });
      b.cone(S(0.05), S(0.22), "", P(0, 2.45, 0.16), { team: true }, 5);
      break;
    case "bandana":
      b.ball(S(0.245), "", P(-0.02, 1.8, 0), { scale: [1, 0.62, 1], team: true }, 1);
      b.box(S(0.04), S(0.07), S(0.13), "#111", P(0.23, 1.76, -0.08), { flat: true });
      b.ball(S(0.06), "#d4a017", P(0.02, 1.68, 0.23), { flat: true }, 1);
      break;
    case "brodie":
      b.cyl(S(0.42), S(0.42), S(0.05), "#4d5a3a", P(0, 1.88, 0), undefined, 12);
      b.ball(S(0.23), "#4d5a3a", P(0, 1.88, 0), { scale: [1, 0.55, 1] }, 2);
      b.box(S(0.24), S(0.06), S(0.24), "", P(0, 1.95, 0), { team: true });
      break;
    case "cap":
      b.cyl(S(0.25), S(0.25), S(0.14), "#3f4a2e", P(0, 1.9, 0), undefined, 10);
      b.box(S(0.17), S(0.03), S(0.32), "#222", P(0.21, 1.84, 0));
      b.box(S(0.05), S(0.08), S(0.2), "", P(0.24, 1.91, 0), { team: true });
      break;
    case "visor":
      b.ball(S(0.28), "#e5e7eb", P(0, 1.74, 0), { scale: [1, 0.96, 1] }, 2);
      b.rbox(S(0.1), S(0.11), S(0.42), "#22d3ee", P(0.22, 1.74, 0), { glow: true }, S(0.03));
      b.rbox(S(0.36), S(0.07), S(0.09), "", P(-0.04, 2.02, 0), { team: true }, S(0.02));
      break;
    case "robot":
      b.rbox(S(0.44), S(0.4), S(0.42), "#b08d57", P(0.02, 1.74, 0), undefined, S(0.06));
      b.box(S(0.06), S(0.08), S(0.32), "#fde047", P(0.25, 1.76, 0), { glow: true });
      b.cyl(S(0.03), S(0.03), S(0.3), "#6b4f2a", P(0, 2.06, 0));
      b.ball(S(0.07), "", P(0, 2.22, 0), { team: true }, 1);
      break;
  }
}

/** Weapon hanging down past the hand H (arm frame: −Y is "along the arm"). */
function weapon(b: RigBuilder, gear: Gear, H: V3, S: (n: number) => number) {
  const at = (dy: number, dx = 0, dz = 0): V3 => [H[0] + S(dx), H[1] + S(dy), H[2] + S(dz)];
  switch (gear) {
    case "club":
      b.cyl(S(0.04), S(0.055), S(0.62), WOOD, at(-0.22));
      b.add(new THREE.DodecahedronGeometry(S(0.17), 0), "#8b8f86", at(-0.56));
      b.cyl(S(0.06), S(0.06), S(0.08), LEATHER, at(-0.36));
      break;
    case "sling":
      b.cyl(S(0.012), S(0.012), S(0.46), "#a16207", at(-0.24));
      b.ball(S(0.08), "#9ca3af", at(-0.5), undefined, 1);
      break;
    case "sword":
      b.cyl(S(0.035), S(0.035), S(0.16), LEATHER, at(0.02));
      b.box(S(0.06), S(0.04), S(0.26), "#d4a017", at(-0.08), { flat: true });
      b.box(S(0.11), S(0.66), S(0.03), STEEL, at(-0.44));
      b.cone(S(0.055), S(0.12), STEEL, at(-0.83), { rot: [Math.PI, 0, 0], scale: [1, 1, 0.3] }, 4);
      break;
    case "cutlass":
      b.cyl(S(0.035), S(0.035), S(0.14), LEATHER, at(0.02));
      b.add(new THREE.TorusGeometry(S(0.1), S(0.015), 4, 8, Math.PI), "#d4a017", at(-0.02, 0.06), { rot: [0, 0, -Math.PI / 2], flat: true });
      b.box(S(0.12), S(0.36), S(0.03), STEEL, at(-0.26, 0.01));
      b.box(S(0.13), S(0.32), S(0.03), STEEL, at(-0.58, 0.06), { rot: [0, 0, 0.25] });
      break;
    case "spear":
      b.cyl(S(0.03), S(0.03), S(2.1), WOOD, at(-0.45));
      b.cone(S(0.07), S(0.3), STEEL, at(-1.62), { rot: [Math.PI, 0, 0] }, 4);
      b.box(S(0.02), S(0.14), S(0.12), "", at(-1.4), { team: true });
      break;
    case "musket":
    case "rifle":
    case "bayonet":
      b.cyl(S(0.032), S(0.032), S(1.12), gear === "musket" ? "#3f3f46" : "#27272a", at(-0.5));
      b.rbox(S(0.09), S(0.62), S(0.09), gear === "musket" ? "#6b3f1e" : "#5b4a3a", at(-0.25, -0.03), undefined, S(0.03));
      b.rbox(S(0.11), S(0.34), S(0.08), gear === "musket" ? "#6b3f1e" : "#5b4a3a", at(0.16, -0.04), undefined, S(0.03));
      if (gear !== "musket") b.cone(S(0.03), S(0.26), STEEL, at(-1.18), { rot: [Math.PI, 0, 0] }, 4);
      else b.box(S(0.04), S(0.06), S(0.04), "#d4a017", at(-0.08, 0.05), { flat: true });
      break;
    case "bomb":
      b.ball(S(0.17), "#111827", at(-0.14), undefined, 2);
      b.cyl(S(0.04), S(0.04), S(0.06), "#57534e", at(-0.3));
      b.ball(S(0.045), "#fbbf24", at(-0.36), { glow: true }, 0);
      break;
    case "blade":
      b.rbox(S(0.08), S(0.2), S(0.08), "#374151", at(0), undefined, S(0.02));
      b.box(S(0.05), S(0.06), S(0.22), "#94a3b8", at(-0.11));
      b.rbox(S(0.1), S(0.92), S(0.035), "#67e8f9", at(-0.6), { glow: true }, S(0.015));
      break;
    case "rail":
      b.rbox(S(0.17), S(1.12), S(0.17), "#4b5563", at(-0.38), undefined, S(0.04));
      b.box(S(0.05), S(0.9), S(0.05), "#a78bfa", at(-0.42, 0.09), { glow: true });
      b.rbox(S(0.22), S(0.22), S(0.22), "#64748b", at(0.1), undefined, S(0.05));
      break;
    case "staff":
      b.cyl(S(0.035), S(0.045), S(1.6), WOOD, at(-0.15));
      b.ball(S(0.12), "#e7e5e4", at(-0.98), undefined, 1);
      b.ball(S(0.09), "#4ade80", at(-1.08), { glow: true }, 1);
      b.cone(S(0.03), S(0.25), "", at(-0.9, 0.08), { rot: [0, 0, 2.4], team: true }, 4);
      break;
    case "holy":
      b.cyl(S(0.03), S(0.03), S(1.55), "#d4a017", at(-0.15), { flat: true });
      b.add(new THREE.TorusGeometry(S(0.14), S(0.025), 5, 12), "#d4a017", at(-1.02), { flat: true });
      b.ball(S(0.08), "#fef08a", at(-1.02), { glow: true }, 1);
      break;
    case "stick":
      b.cyl(S(0.02), S(0.025), S(0.4), WOOD, at(-0.18));
      b.ball(S(0.045), "#f5f5f4", at(-0.38), { flat: true }, 1);
      break;
    case "kit":
      b.rbox(S(0.16), S(0.3), S(0.26), "#f5f5f4", at(-0.16), undefined, S(0.03));
      b.box(S(0.17), S(0.16), S(0.05), "#16a34a", at(-0.16), { flat: true });
      b.box(S(0.17), S(0.05), S(0.16), "#16a34a", at(-0.16), { flat: true });
      break;
    case "nano":
      b.rbox(S(0.07), S(0.5), S(0.07), "#e2e8f0", at(-0.2), undefined, S(0.02));
      b.add(new THREE.TorusGeometry(S(0.12), S(0.02), 5, 12), "#4ade80", at(-0.5), { glow: true });
      b.ball(S(0.06), "#86efac", at(-0.5), { glow: true }, 1);
      break;
    case "boulder":
      b.add(new THREE.DodecahedronGeometry(S(0.32), 0), "#8b8f86", at(-0.22));
      b.add(new THREE.DodecahedronGeometry(S(0.14), 0), "#7a7d74", at(-0.28, 0.16, 0.08));
      break;
    case "none":
      break;
  }
}

/** Wheeled or hovering artillery; the barrel part recoils. */
function artillery(b: RigBuilder, kind: "ballista" | "fieldgun" | "howitzer" | "plasmagun") {
  b.part("body");
  if (kind === "ballista") {
    b.rbox(1.7, 0.36, 1.1, WOOD, [0, 0.72, 0], undefined, 0.05);
    b.rbox(1.74, 0.08, 1.14, "", [0, 0.92, 0], { team: true }, 0.02);
    for (const z of [-0.45, 0.45]) b.box(0.12, 0.5, 0.12, WOOD, [0.2, 1.1, z]);
    flag(b, -0.75, 0.9, 0.4, 0.8);
    wheels(b, [-0.5, 0.5], 0.62, 0.4, "#5b3a1e", "#d4a017", true);
    b.part("barrel", [[0.1, 1.36, 0]]);
    b.rbox(1.7, 0.13, 0.16, "#8b6b45", [0.1, 1.36, 0], undefined, 0.03);
    for (const z of [-1, 1]) b.cyl(0.04, 0.05, 0.85, "#6b4423", [0.75, 1.38, z * 0.38], { rot: [z * 1.1, 0, 0] });
    b.box(0.02, 0.02, 1.4, "#f5f5f4", [0.45, 1.38, 0], { flat: true });
    b.cyl(0.03, 0.03, 1.2, WOOD, [0.45, 1.46, 0], { rot: [0, 0, Math.PI / 2] });
    b.cone(0.06, 0.2, STEEL, [1.12, 1.46, 0], { rot: [0, 0, -Math.PI / 2] }, 4);
  } else if (kind === "fieldgun") {
    b.rbox(1.5, 0.22, 0.42, "#5b3a1e", [-0.55, 0.52, 0], { rot: [0, 0, 0.32] }, 0.04);
    b.rbox(0.5, 0.36, 0.9, "#6b4423", [0.05, 0.92, 0], undefined, 0.05);
    b.rbox(0.52, 0.08, 0.92, "", [0.05, 1.12, 0], { team: true }, 0.02);
    wheels(b, [0.05], 0.62, 0.62, "#5b3a1e", "#d4a017", true);
    b.part("barrel", [[0.1, 1.2, 0]]);
    b.cyl(0.13, 0.17, 1.6, "#1f2937", [0.55, 1.22, 0], { rot: [0, 0, -Math.PI / 2] }, 12);
    b.cyl(0.19, 0.19, 0.1, "#d4a017", [1.33, 1.22, 0], { rot: [0, 0, Math.PI / 2], flat: true }, 12);
    b.ball(0.18, "#1f2937", [-0.25, 1.22, 0], undefined, 1);
  } else if (kind === "howitzer") {
    b.rbox(2.2, 0.5, 1.4, "#57534e", [0, 0.8, 0], undefined, 0.1);
    b.rbox(2.24, 0.12, 1.44, "", [0, 1.08, 0], { team: true }, 0.04);
    b.rbox(0.12, 0.9, 1.3, "#6b7280", [0.75, 1.45, 0], { rot: [0, 0, -0.2] }, 0.04);
    wheels(b, [-0.7, 0.7], 0.72, 0.4, "#1c1917", "#44403c");
    b.part("barrel", [[0.0, 1.5, 0]]);
    b.rbox(0.8, 0.5, 0.7, "#6b7280", [0.0, 1.5, 0], undefined, 0.08);
    b.cyl(0.14, 0.17, 2.2, "#3f3f46", [0.95, 2.0, 0], { rot: [0, 0, -Math.PI / 2 + 0.45] }, 12);
    b.cyl(0.2, 0.2, 0.18, "#27272a", [1.95, 2.48, 0], { rot: [0, 0, -Math.PI / 2 + 0.45] }, 12);
  } else {
    b.rbox(2.4, 0.55, 1.6, "#cbd5e1", [0, 1.0, 0], undefined, 0.22);
    b.rbox(2.44, 0.12, 1.64, "", [0, 1.2, 0], { team: true }, 0.05);
    b.rbox(2.0, 0.1, 1.3, "#a78bfa", [0, 0.68, 0], { glow: true }, 0.05);
    b.part("barrel", [[-0.1, 1.6, 0]]);
    b.rbox(1.0, 0.55, 0.9, "#94a3b8", [-0.1, 1.6, 0], undefined, 0.15);
    b.cyl(0.12, 0.16, 2.0, "#475569", [1.0, 1.66, 0], { rot: [0, 0, -Math.PI / 2] }, 12);
    for (let i = 0; i < 3; i++) b.cyl(0.2, 0.2, 0.07, "#c4b5fd", [0.55 + i * 0.45, 1.66, 0], { rot: [0, 0, Math.PI / 2], glow: true }, 12);
    b.ball(0.12, "#e9d5ff", [2.02, 1.66, 0], { glow: true }, 1);
  }
  b.part("body");
}

/* ── mounts / vehicles ───────────────────────────────────────────────── */

function quadruped(b: RigBuilder, body: string, o: { len: number; h: number; w: number; tusk?: boolean; mane: string; head: number; armor?: boolean }) {
  const { len, h, w } = o;
  b.part("body");
  b.rbox(len, h * 0.46, w, body, [0, h * 0.8, 0], undefined, 0.14);
  b.rbox(len * 0.34, h * 0.4, w * 0.62, body, [len * 0.48, h * 1.0, 0], { rot: [0, 0, -0.75] }, 0.08);
  b.rbox(o.head, o.head * 0.62, w * 0.6, body, [len * 0.66, h * 1.16, 0], { rot: [0, 0, -0.3] }, 0.08);
  b.box(0.05, 0.06, 0.05, "#111", [len * 0.7, h * 1.24, w * 0.24], { flat: true });
  b.box(0.05, 0.06, 0.05, "#111", [len * 0.7, h * 1.24, -w * 0.24], { flat: true });
  b.rbox(len * 0.42, 0.13, 0.1, o.mane, [len * 0.36, h * 1.17, 0], { rot: [0, 0, -0.6] }, 0.04);
  b.cone(0.07, h * 0.5, o.mane, [-len * 0.52, h * 0.7, 0], { rot: [0, 0, -2.6] }, 5);
  b.rbox(len * 0.44, 0.07, w * 1.08, "", [-0.02, h * 1.04, 0], { team: true }, 0.02);
  b.rbox(len * 0.24, 0.12, w * 0.72, LEATHER, [-0.02, h * 1.1, 0], undefined, 0.04);
  if (o.armor) b.rbox(len * 0.3, h * 0.3, w * 1.06, STEEL, [len * 0.4, h * 0.95, 0], { rot: [0, 0, -0.5] }, 0.05);
  if (o.tusk) {
    b.cone(0.06, 0.42, "#f5f5f4", [len * 0.78, h * 0.98, 0.18], { rot: [0, 0, -1.9] }, 5);
    b.cone(0.06, 0.42, "#f5f5f4", [len * 0.78, h * 0.98, -0.18], { rot: [0, 0, -1.9] }, 5);
  }
  for (const [key, x] of [["fleg", len * 0.34], ["bleg", -len * 0.34]] as const) {
    b.part(key, [[x, h * 0.66, w * 0.3], [x, h * 0.66, -w * 0.3]]);
    b.cap(0.1, h * 0.34, body, [x, h * 0.44, w * 0.3]);
    b.cap(0.075, h * 0.22, body, [x + 0.02, h * 0.17, w * 0.3]);
    b.rbox(0.15, 0.08, 0.15, "#1c1917", [x + 0.03, 0.04, w * 0.3], undefined, 0.02);
  }
  b.part("body");
}

function wheels(b: RigBuilder, xs: number[], z: number, r: number, color = "#1f2937", hub = "#6b7280", spokes = false) {
  const pivots: V3[] = [];
  for (const x of xs) for (const zz of [z, -z]) pivots.push([x, r, zz]);
  b.part("wheel", pivots);
  const [x, , zz] = pivots[0];
  b.cyl(r, r, 0.2, color, [x, r, zz], { rot: [Math.PI / 2, 0, 0] }, 14);
  b.cyl(r * 0.45, r * 0.45, 0.23, hub, [x, r, zz], { rot: [Math.PI / 2, 0, 0] }, 8);
  if (spokes) for (let i = 0; i < 3; i++) b.box(0.05, r * 1.9, 0.06, "#4a3424", [x, r, zz], { rot: [0, 0, (i * Math.PI) / 3] });
  else b.box(r * 0.5, 0.06, 0.24, "#e5e7eb", [x, r, zz], { flat: true });
  b.part("body");
}

function flag(b: RigBuilder, x: number, y: number, z: number, h = 1.2) {
  b.cyl(0.025, 0.025, h, "#4b3621", [x, y + h / 2, z]);
  b.rbox(0.46, 0.3, 0.03, "", [x - 0.24, y + h - 0.17, z], { team: true }, 0.01);
}

/* ── the roster ──────────────────────────────────────────────────────── */

type Spec = { build: (b: RigBuilder) => void; height: number; frame: Frame; weapon: Weapon; hipY: number; heavy?: number; shield?: boolean; ram?: boolean };

const ART = (kind: "ballista" | "fieldgun" | "howitzer" | "plasmagun", height: number): Spec => ({ build: (b) => artillery(b, kind), height, frame: "vehicle", weapon: "none", hipY: 1.0, heavy: 1.2 });

const H = (o: HumanOpt, weaponStyle: Weapon, height = 2.15, extra?: Partial<Spec>): Spec => ({
  build: (b) => human(b, o),
  height: height * (o.scale ?? 1),
  frame: "human",
  weapon: weaponStyle,
  hipY: 0.86 * (o.scale ?? 1),
  shield: !!o.shield,
  ...extra,
});

const SPECS: Record<UnitKind, Spec> = {
  club: H({ top: "#7c5530", legs: "#5a3d22", head: "fur", gear: "club", skin: SKIN[1], pads: "fur" }, "swing"),
  sling: H({ top: "#8a6a3f", legs: "#5a3d22", head: "band", gear: "sling", skin: SKIN[2], scale: 0.95 }, "sling"),
  boar: {
    build: (b) => {
      quadruped(b, "#5b3b22", { len: 1.7, h: 1.05, w: 0.86, tusk: true, mane: "#2b1a0f", head: 0.66 });
      human(b, { top: "#7c5530", legs: "#5a3d22", head: "fur", gear: "club", ride: 0.95, scale: 0.85, pads: "fur" });
    },
    height: 2.7,
    frame: "mount",
    weapon: "swing",
    hipY: 0.9,
  },
  legion: H({ top: "#a8a29e", legs: "#7f1d1d", head: "crest", gear: "sword", shield: "scutum", pads: "steel", cape: true }, "swing"),
  archer: H({ top: "#6b4f2a", legs: "#3f3f2a", head: "hood", gear: "bow", pads: "team" }, "bow"),
  cavalry: {
    build: (b) => {
      quadruped(b, "#6b4226", { len: 1.9, h: 1.3, w: 0.62, mane: "#1c1917", head: 0.52, armor: true });
      human(b, { top: "#a8a29e", legs: "#7f1d1d", head: "helm", gear: "spear", ride: 1.18, scale: 0.85, pads: "steel", cape: true });
    },
    height: 3.0,
    frame: "mount",
    weapon: "thrust",
    hipY: 1.0,
  },
  shieldwall: H({ top: IRON, legs: "#374151", head: "helm", gear: "sword", shield: "tower", pads: "steel", scale: 1.1 }, "swing"),
  chariot: {
    build: (b) => {
      quadruped(b, "#8b5a2b", { len: 1.5, h: 1.15, w: 0.5, mane: "#1c1917", head: 0.48 });
      b.part("body");
      b.rbox(1.0, 0.52, 1.3, WOOD, [-1.3, 0.8, 0], undefined, 0.06);
      b.rbox(1.04, 0.1, 1.34, "", [-1.3, 1.08, 0], { team: true }, 0.03);
      b.box(1.2, 0.06, 0.06, WOOD, [-0.5, 0.78, 0]);
      b.cone(0.07, 0.75, STEEL, [-1.3, 0.48, 1.0], { rot: [Math.PI / 2, 0, 0] }, 4);
      b.cone(0.07, 0.75, STEEL, [-1.3, 0.48, -1.0], { rot: [-Math.PI / 2, 0, 0] }, 4);
      wheels(b, [-1.3], 0.72, 0.48, "#5b3a1e", "#d4a017", true);
      human(b, { top: "#a8a29e", legs: "#7f1d1d", head: "crest", gear: "spear", ride: 0.62, x: -1.3, scale: 0.85, pads: "steel" });
    },
    height: 2.5,
    frame: "mount",
    weapon: "thrust",
    hipY: 0.9,
  },
  marine: H({ top: "#1e3a5f", legs: "#e5e7eb", head: "tricorn", gear: "cutlass", pads: "brass", shield: "buckler" }, "swing"),
  musket: H({ top: "#1e3a5f", legs: "#e5e7eb", head: "tricorn", gear: "musket", pads: "team" }, "gun"),
  dragoon: {
    build: (b) => {
      quadruped(b, "#3f2a1a", { len: 1.9, h: 1.3, w: 0.62, mane: "#111", head: 0.52 });
      human(b, { top: "#1e3a5f", legs: "#e5e7eb", head: "helm", gear: "musket", ride: 1.18, scale: 0.85, pads: "brass" });
    },
    height: 3.0,
    frame: "mount",
    weapon: "gun",
    hipY: 1.0,
  },
  grenadier: H({ top: "#1e3a5f", legs: "#e5e7eb", head: "bearskin", gear: "bomb", pads: "brass" }, "throw", 2.5),
  corsair: H({ top: "#7f1d1d", legs: "#1f2937", head: "bandana", gear: "cutlass", skin: SKIN[3], cape: true }, "swing"),
  trooper: H({ top: "#556b2f", legs: "#4a5a2a", head: "brodie", gear: "bayonet", pads: "team" }, "thrust"),
  rifle: H({ top: "#5f6b3a", legs: "#4a5a2a", head: "cap", gear: "rifle" }, "gun"),
  armored: {
    build: (b) => {
      b.rbox(2.6, 0.9, 1.4, "#5b6b3a", [0, 1.0, 0], undefined, 0.15);
      b.rbox(2.64, 0.16, 1.44, "", [0, 1.2, 0], { team: true }, 0.05);
      b.rbox(0.5, 0.4, 1.3, "#4d5a30", [1.1, 1.35, 0], { rot: [0, 0, -0.5] }, 0.06);
      b.box(0.08, 0.2, 0.36, "#fde047", [1.32, 1.05, 0.45], { glow: true });
      b.box(0.08, 0.2, 0.36, "#fde047", [1.32, 1.05, -0.45], { glow: true });
      flag(b, -1.0, 1.45, 0.45, 0.9);
      wheels(b, [-0.8, 0.8], 0.72, 0.42);
      b.part("barrel", [[-0.2, 1.75, 0]]);
      b.rbox(1.1, 0.5, 0.95, "#4d5a30", [-0.2, 1.75, 0], undefined, 0.1);
      b.cyl(0.07, 0.08, 0.95, "#27272a", [0.65, 1.8, 0], { rot: [0, 0, Math.PI / 2] }, 8);
      b.part("body");
    },
    height: 2.4,
    frame: "vehicle",
    weapon: "none",
    hipY: 1.0,
    ram: true,
  },
  automaton: H({ top: "#b08d57", legs: "#8a6d3b", head: "robot", gear: "bayonet", skin: "#a3a3a3", pads: "brass", scale: 0.95 }, "thrust"),
  steamtank: {
    build: (b) => {
      b.rbox(3.4, 1.3, 1.9, "#57534e", [0, 1.35, 0], undefined, 0.12);
      b.rbox(3.5, 0.2, 1.96, "", [0, 1.7, 0], { team: true }, 0.05);
      b.rbox(3.7, 0.6, 2.15, "#292524", [0, 0.48, 0], undefined, 0.2);
      for (let i = 0; i < 6; i++) b.ball(0.06, "#a16207", [-1.4 + i * 0.56, 1.9, 0.96], { flat: true }, 0);
      b.cyl(0.28, 0.34, 1.3, "#44403c", [-1.0, 2.6, 0], undefined, 10);
      b.cyl(0.36, 0.3, 0.14, "#292524", [-1.0, 3.28, 0], undefined, 10);
      b.box(0.14, 0.24, 0.3, "#f97316", [-1.0, 3.35, 0], { glow: true });
      wheels(b, [-1.3, -0.45, 0.45, 1.3], 1.0, 0.34, "#1c1917", "#44403c");
      b.part("barrel", [[0.5, 2.25, 0]]);
      b.rbox(1.4, 0.8, 1.3, "#6b5e52", [0.4, 2.3, 0], undefined, 0.12);
      b.cyl(0.18, 0.2, 1.7, "#3f3f46", [1.8, 2.3, 0], { rot: [0, 0, Math.PI / 2] }, 10);
      b.cyl(0.24, 0.24, 0.16, "#27272a", [2.6, 2.3, 0], { rot: [0, 0, Math.PI / 2] }, 10);
      b.part("body");
    },
    height: 3.4,
    frame: "vehicle",
    weapon: "none",
    hipY: 1.2,
    heavy: 1.4,
  },
  plasma: H({ top: "#e5e7eb", legs: "#334155", head: "visor", gear: "blade", skin: "#cbd5e1", shield: "round", pads: "steel", cape: true }, "swing", 2.2),
  railgun: H({ top: "#cbd5e1", legs: "#334155", head: "visor", gear: "rail", skin: "#cbd5e1", pads: "team" }, "gun", 2.2),
  hovertank: {
    build: (b) => {
      b.rbox(2.9, 0.7, 1.7, "#cbd5e1", [0, 1.15, 0], undefined, 0.25);
      b.rbox(2.94, 0.14, 1.74, "", [0, 1.35, 0], { team: true }, 0.06);
      b.rbox(2.3, 0.12, 1.4, "#22d3ee", [0, 0.74, 0], { glow: true }, 0.05);
      for (const z of [-0.75, 0.75]) b.rbox(0.5, 0.3, 0.3, "#94a3b8", [-1.3, 1.2, z], undefined, 0.08);
      b.box(0.08, 0.16, 0.24, "#a78bfa", [-1.56, 1.2, 0.75], { glow: true });
      b.box(0.08, 0.16, 0.24, "#a78bfa", [-1.56, 1.2, -0.75], { glow: true });
      b.part("barrel", [[-0.2, 1.72, 0]]);
      b.rbox(1.5, 0.5, 1.1, "#94a3b8", [-0.2, 1.72, 0], undefined, 0.15);
      b.rbox(1.6, 0.12, 0.12, "#475569", [0.9, 1.76, 0], undefined, 0.03);
      b.box(0.1, 0.1, 0.3, "#a78bfa", [1.72, 1.76, 0], { glow: true });
      b.part("body");
    },
    height: 2.4,
    frame: "vehicle",
    weapon: "none",
    hipY: 1.0,
    ram: true,
  },
  drone: {
    build: (b) => {
      b.ball(0.5, "#e2e8f0", [0, 2.0, 0], { scale: [1.25, 0.7, 1.25] }, 2);
      b.ball(0.2, "#4ade80", [0.45, 1.95, 0], { glow: true }, 1);
      b.cyl(0.54, 0.54, 0.1, "", [0, 2.1, 0], { team: true }, 14);
      for (const [x, z] of [[0.7, 0.7], [0.7, -0.7], [-0.7, 0.7], [-0.7, -0.7]]) b.rbox(0.95, 0.06, 0.09, "#475569", [x * 0.5, 2.15, z * 0.5], { rot: [0, Math.atan2(-z, x), 0] }, 0.02);
      b.part("rotor", [[0.7, 2.24, 0.7], [0.7, 2.24, -0.7], [-0.7, 2.24, 0.7], [-0.7, 2.24, -0.7]]);
      b.box(0.7, 0.03, 0.09, "#cbd5e1", [0.7, 2.24, 0.7]);
      b.box(0.09, 0.03, 0.7, "#cbd5e1", [0.7, 2.24, 0.7]);
      b.cyl(0.06, 0.06, 0.08, "#475569", [0.7, 2.22, 0.7]);
      b.part("body");
    },
    height: 2.6,
    frame: "drone",
    weapon: "heal",
    hipY: 2.0,
  },
  shaman: H({ top: "#6b4a2b", legs: "#4a3424", head: "fur", gear: "staff", skin: SKIN[3], pads: "fur", cape: true }, "heal"),
  ogre: H({ top: "#6b5a3a", legs: "#4a3424", head: "band", gear: "boulder", skin: "#a3b18a", pads: "fur", scale: 1.42 }, "throw", 2.15, { heavy: 1.3 }),
  priest: H({ top: "#f5f5f4", legs: "#e7e5e4", head: "hood", gear: "holy", pads: "team", cape: true }, "heal"),
  ballista: ART("ballista", 2.0),
  drummer: H({ top: "#1e3a5f", legs: "#e5e7eb", head: "tricorn", gear: "stick", pads: "brass" }, "drum"),
  fieldgun: ART("fieldgun", 2.0),
  medic: H({ top: "#f5f5f4", legs: "#4a5a2a", head: "cap", gear: "kit", pads: "team" }, "heal"),
  howitzer: ART("howitzer", 2.8),
  android: H({ top: "#e2e8f0", legs: "#64748b", head: "robot", gear: "nano", skin: "#cbd5e1", pads: "steel" }, "heal", 2.3),
  plasmagun: ART("plasmagun", 2.4),
  colossus: {
    build: (b) => {
      human(b, { top: "#64748b", legs: "#334155", head: "visor", gear: "blade", skin: "#94a3b8", scale: 2.0, pads: "steel", cape: true });
      b.part("body");
      b.cyl(0.28, 0.28, 1.6, "#78350f", [-0.8, 3.0, 0], undefined, 10);
      for (let i = 0; i < 4; i++) b.cyl(0.42, 0.42, 0.1, "#a78bfa", [-0.8, 2.4 + i * 0.4, 0], { glow: true }, 12);
      b.ball(0.32, "#c4b5fd", [-0.8, 4.0, 0], { glow: true }, 2);
    },
    height: 4.4,
    frame: "human",
    weapon: "swing",
    hipY: 1.72,
    heavy: 1.7,
    shield: false,
  },
};

const cache = new Map<string, Rig>();

export function unitRig(kind: UnitKind, side: 0 | 1): Rig {
  const key = `${kind}:${side}`;
  let rig = cache.get(key);
  if (!rig) {
    const spec = SPECS[kind];
    const b = new RigBuilder(side);
    spec.build(b);
    rig = b.build({ height: spec.height, frame: spec.frame, weapon: spec.weapon, hipY: spec.hipY, heavy: spec.heavy ?? 1, shield: !!spec.shield, ram: !!spec.ram });
    cache.set(key, rig);
  }
  return rig;
}

/** Height for the HP bar without building anything extra. */
export function unitHeight(kind: UnitKind): number {
  return SPECS[kind].height;
}
