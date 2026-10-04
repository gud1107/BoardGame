/**
 * Per-map level geometry for 배고픈 상어 — what makes the three dive sites
 * play differently instead of being recolors of one seabed:
 *
 *   - seabed profile  : rolling hills (딥 블루) / shelves cut by two deep
 *                       trenches (얼음 해협) / stepped terraces down to an
 *                       abyss (난파선 무덤)
 *   - ice ceiling     : 얼음 해협's surface is a solid ice sheet with a few
 *                       breathing holes (the only places to jump / meet boats)
 *   - solid obstacles : icicles + ice pillars, sunken hulls + broken masts —
 *                       circles the shark and swimmers collide with
 *
 * Everything is a pure function of the MapDef (hash noise, no Math.random),
 * so engine physics and the renderer always agree. Lookups are tables built
 * once per `setActiveMap`, because `seabedY` runs for every entity per frame.
 */

export type TerrainSpec =
  /** Sum of sine octaves around the base depth: [amplitude, frequency, phase]. */
  | { kind: "rolling"; base: number; octaves: [number, number, number][] }
  /** Smoothstep between [x, depth] control points (flat runs + steep cliffs) plus small noise. */
  | { kind: "profile"; points: [number, number][]; octaves: [number, number, number][] };

export interface IceSpec {
  /** Breathing holes: [centerX, width]. Everything else is covered. */
  holes: [number, number][];
  /** Average depth of the ice sheet's underside (world y). */
  thickness: number;
}

export type StructureKind = "icicle" | "icePillar" | "hull" | "mast";

/** A drawable obstacle; `colliders` are what physics actually tests. */
export interface Structure {
  kind: StructureKind;
  x: number;
  y: number;
  /** Length along `angle` (icicle: downward length; hull: keel length; pillar/mast: height). */
  len: number;
  /** Thickness (icicle/pillar base width, hull height, mast width). */
  thick: number;
  angle: number;
  seed: number;
}

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface MapGeometry {
  width: number;
  floorMin: number;
  floorMax: number;
  structures: Structure[];
  colliders: Circle[];
  /** colliders bucketed by floor(x / BUCKET). */
  buckets: Circle[][];
  floor: Float32Array;
  /** Ice underside per sample, or null when the surface is open water. */
  ceil: Float32Array | null;
  ice: IceSpec | null;
}

const STEP = 8;
export const BUCKET = 400;
/** Ice sheet top sits slightly above the waterline. */
export const ICE_TOP = -16;

function h01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

const smooth = (t: number) => t * t * (3 - 2 * t);

function rawFloor(spec: TerrainSpec, x: number): number {
  let y = 0;
  if (spec.kind === "rolling") y = spec.base;
  else {
    const p = spec.points;
    if (x <= p[0][0]) y = p[0][1];
    else if (x >= p[p.length - 1][0]) y = p[p.length - 1][1];
    else {
      for (let i = 1; i < p.length; i++) {
        if (x <= p[i][0]) {
          const [x0, y0] = p[i - 1];
          const [x1, y1] = p[i];
          y = y0 + (y1 - y0) * smooth((x - x0) / (x1 - x0));
          break;
        }
      }
    }
  }
  for (const [a, f, ph] of spec.octaves) y += Math.sin(x * f + ph) * a;
  return y;
}

function rawCeil(ice: IceSpec, x: number): number | null {
  for (const [cx, wd] of ice.holes) if (Math.abs(x - cx) < wd / 2) return null;
  // Jagged underside: a couple of slow waves + per-120u chunks.
  return ice.thickness + Math.sin(x * 0.004) * 18 + Math.sin(x * 0.017 + 1.3) * 9 + (h01(Math.floor(x / 120)) - 0.5) * 22;
}

function sampleAt(table: Float32Array, x: number): number {
  const f = Math.max(0, Math.min(table.length - 1.001, x / STEP));
  const i = Math.floor(f);
  return table[i] + (table[i + 1] - table[i]) * (f - i);
}

export function buildGeometry(width: number, terrain: TerrainSpec, ice: IceSpec | null, feature: string): MapGeometry {
  const n = Math.ceil(width / STEP) + 2;
  const floor = new Float32Array(n);
  let floorMin = Infinity, floorMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const y = rawFloor(terrain, i * STEP);
    floor[i] = y;
    floorMin = Math.min(floorMin, y);
    floorMax = Math.max(floorMax, y);
  }
  let ceil: Float32Array | null = null;
  if (ice) {
    ceil = new Float32Array(n);
    for (let i = 0; i < n; i++) ceil[i] = rawCeil(ice, i * STEP) ?? 0;
  }
  const floorAt = (x: number) => sampleAt(floor, x);
  const ceilAt = (x: number) => (ceil ? sampleAt(ceil, x) : 0);

  const structures: Structure[] = [];
  if (feature === "iceSheet" && ice) {
    // Icicles hang from the ice sheet (never inside a breathing hole).
    for (let i = 0; i * 180 < width; i++) {
      const x = i * 180 + h01(i * 1.7) * 90;
      if (h01(i * 0.731 + 17.3) < 0.28 || ceilAt(x) <= 1) continue;
      if (ice.holes.some(([cx, wd]) => Math.abs(x - cx) < wd / 2 + 60)) continue;
      structures.push({ kind: "icicle", x, y: ceilAt(x) - 6, len: 70 + h01(i + 0.4) * 150, thick: 26 + h01(i + 0.9) * 22, angle: 0, seed: i });
    }
    // Giant ice pillars rise from the trench floors (deeper than 2600).
    for (let i = 0; i * 520 < width; i++) {
      const x = i * 520 + h01(i * 5.1) * 260;
      const fy = floorAt(x);
      if (fy < 2700 || h01(i * 2.9) < 0.35) continue;
      structures.push({ kind: "icePillar", x, y: fy + 20, len: 380 + h01(i + 0.2) * 520, thick: 70 + h01(i + 0.6) * 50, angle: 0, seed: i });
    }
  } else if (feature === "wrecks") {
    // One big hull per terrace (+ a giant liner in the abyss), each with a broken mast.
    const spots = [800, 2550, 4250, 6800, 8250, 9900, 11900].filter((x) => x < width - 400);
    spots.forEach((cx, i) => {
      const giant = floorAt(cx) > 3200;
      const len = giant ? 1150 : 520 + h01(i + 0.3) * 260;
      const thick = giant ? 250 : 120 + h01(i + 0.7) * 50;
      const xl = cx - len / 2, xr = cx + len / 2;
      // Lie along the floor, sunk a little into the sand.
      const yl = floorAt(xl), yr = floorAt(xr);
      const angle = Math.atan2(yr - yl, len) * 0.6 + (h01(i + 1.1) - 0.5) * 0.12;
      const y = (yl + yr) / 2 - thick * 0.38;
      structures.push({ kind: "hull", x: cx, y, len, thick, angle, seed: i });
      const mx = cx - len * (0.12 + h01(i + 2.2) * 0.2);
      structures.push({ kind: "mast", x: mx, y: y - thick * 0.35, len: (giant ? 620 : 300) + h01(i + 4.4) * 220, thick: giant ? 26 : 16, angle: (h01(i + 5.5) - 0.5) * 0.5, seed: i });
    });
  }

  const colliders: Circle[] = [];
  for (const s of structures) {
    if (s.kind === "icicle") {
      // Tapers to a point: 3 shrinking circles down the length.
      for (let k = 0; k < 3; k++) {
        const f = 0.18 + k * 0.3;
        colliders.push({ x: s.x, y: s.y + s.len * f, r: (s.thick / 2) * (1 - f * 0.85) + 4 });
      }
    } else if (s.kind === "icePillar") {
      const nC = Math.ceil(s.len / 70);
      for (let k = 0; k < nC; k++) {
        const f = k / nC;
        colliders.push({ x: s.x, y: s.y - s.len * f, r: (s.thick / 2) * (1 - f * 0.7) });
      }
    } else if (s.kind === "hull") {
      const ca = Math.cos(s.angle), sa = Math.sin(s.angle);
      const r = s.thick / 2;
      const nC = Math.max(2, Math.round(s.len / (r * 0.9)));
      for (let k = 0; k <= nC; k++) {
        const along = -s.len / 2 + r * 0.7 + (k / nC) * (s.len - r * 1.4);
        colliders.push({ x: s.x + ca * along, y: s.y + sa * along, r });
      }
    } else if (s.kind === "mast") {
      const dx = Math.sin(s.angle), dy = -Math.cos(s.angle);
      const nC = Math.ceil(s.len / 40);
      for (let k = 1; k <= nC; k++) {
        const along = (k / nC) * s.len;
        colliders.push({ x: s.x + dx * along, y: s.y + dy * along, r: s.thick / 2 + 4 });
      }
    }
  }
  const buckets: Circle[][] = Array.from({ length: Math.ceil(width / BUCKET) + 1 }, () => []);
  for (const c of colliders) {
    const lo = Math.max(0, Math.floor((c.x - c.r) / BUCKET));
    const hi = Math.min(buckets.length - 1, Math.floor((c.x + c.r) / BUCKET));
    for (let b = lo; b <= hi; b++) buckets[b].push(c);
  }
  return { width, floorMin, floorMax, structures, colliders, buckets, floor, ceil, ice };
}

export function geoFloor(g: MapGeometry, x: number): number {
  return sampleAt(g.floor, x);
}

/** Underside of the ice at x, or `surface` where the water is open. */
export function geoCeil(g: MapGeometry, x: number, surface: number): number {
  if (!g.ceil) return surface;
  const v = sampleAt(g.ceil, x);
  return v <= 1 ? surface : v;
}

export function underIce(g: MapGeometry, x: number): boolean {
  return !!g.ceil && sampleAt(g.ceil, x) > 1;
}

/** Colliders whose x-span may overlap [x - r, x + r]. */
export function collidersNear(g: MapGeometry, x: number, r: number, out: Circle[]): Circle[] {
  out.length = 0;
  const lo = Math.max(0, Math.floor((x - r) / BUCKET));
  const hi = Math.min(g.buckets.length - 1, Math.floor((x + r) / BUCKET));
  for (let b = lo; b <= hi; b++) for (const c of g.buckets[b]) if (!out.includes(c)) out.push(c);
  return out;
}

/** Push a circle (x, y, r) out of every overlapping collider. Returns the summed push normal, or null if clear. */
export function resolveCircle(g: MapGeometry, p: { x: number; y: number }, r: number, scratch: Circle[]): { nx: number; ny: number } | null {
  let hit: { nx: number; ny: number } | null = null;
  for (const c of collidersNear(g, p.x, r + 140, scratch)) {
    const dx = p.x - c.x, dy = p.y - c.y;
    const min = r + c.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) continue;
    const d = Math.sqrt(d2) || 0.001;
    const nx = d2 > 0 ? dx / d : 0, ny = d2 > 0 ? dy / d : -1;
    p.x += nx * (min - d);
    p.y += ny * (min - d);
    hit = hit ? { nx: hit.nx + nx, ny: hit.ny + ny } : { nx, ny };
  }
  return hit;
}

export function insideAny(g: MapGeometry, x: number, y: number, pad: number, scratch: Circle[]): boolean {
  for (const c of collidersNear(g, x, pad + 140, scratch)) if (Math.hypot(x - c.x, y - c.y) < c.r + pad) return true;
  return false;
}

/** Nearest breathing-hole center to x (ice maps), for sliding a stranded shark. */
export function nearestHole(g: MapGeometry, x: number): number {
  if (!g.ice) return x;
  let best = g.ice.holes[0][0];
  for (const [cx] of g.ice.holes) if (Math.abs(cx - x) < Math.abs(best - x)) best = cx;
  return best;
}
