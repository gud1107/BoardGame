/**
 * 낙서 결투 — turns a doodle into weapon stats by pure geometry (no shape
 * recognition / ML). Everything here uses only + − × ÷ and Math.sqrt so every
 * client computes bit-identical results for the lockstep sync (Math.sin/cos/
 * atan2/hypot are not guaranteed identical across JS engines — see `dsin`).
 */

/** Ink colors. Index = element (see ELEMENTS). */
export const INK_COLORS = ["#1f2937", "#dc2626", "#2563eb", "#16a34a", "#eab308"] as const;
export type InkColor = 0 | 1 | 2 | 3 | 4;
export const ELEMENTS = ["none", "fire", "ice", "poison", "shock"] as const;
export type Element = (typeof ELEMENTS)[number];
export const ELEMENT_LABEL: Record<Element, string> = {
  none: "⚫ 강철 (+10% 피해)",
  fire: "🔴 화염 (2턴 화상)",
  ice: "🔵 빙결 (다음 턴 잉크 −35)",
  poison: "🟢 독 (3턴 중독)",
  shock: "🟡 전기 (연쇄 +1)",
};

/** A stroke: color + flat [x0,y0,x1,y1,...] integer coordinates. */
export interface Stroke {
  c: InkColor;
  p: number[];
}

export const PAD_SIZE = 200;
export const INK_PER_TURN = 100;
export const MAX_STROKES = 16;
export const MAX_POINTS_PER_STROKE = 160;
/** Ink units per pixel of stroke length, plus a flat cost per stroke (stops dot spam). */
const INK_PER_PX = 1 / 5;
const INK_PER_STROKE = 2;

export function strokeLength(s: Stroke): number {
  let len = 0;
  for (let i = 2; i + 1 < s.p.length; i += 2) {
    const dx = s.p[i] - s.p[i - 2];
    const dy = s.p[i + 1] - s.p[i - 1];
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

export function strokeInk(s: Stroke): number {
  return strokeLength(s) * INK_PER_PX + INK_PER_STROKE;
}

export function totalInk(strokes: readonly Stroke[]): number {
  let ink = 0;
  for (const s of strokes) ink += strokeInk(s);
  return ink;
}

/** Validates shape + coordinate bounds; `bound` is the max coordinate (pad or world size). */
export function strokesValid(strokes: unknown, boundW: number, boundH: number): strokes is Stroke[] {
  if (!Array.isArray(strokes) || strokes.length === 0 || strokes.length > MAX_STROKES) return false;
  for (const s of strokes) {
    if (!s || typeof s !== "object") return false;
    const st = s as Stroke;
    if (!Number.isInteger(st.c) || st.c < 0 || st.c >= INK_COLORS.length) return false;
    if (!Array.isArray(st.p) || st.p.length < 2 || st.p.length % 2 !== 0 || st.p.length > MAX_POINTS_PER_STROKE * 2) return false;
    for (let i = 0; i < st.p.length; i += 2) {
      const x = st.p[i];
      const y = st.p[i + 1];
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x > boundW || y > boundH) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Deterministic trig (Taylor series after range reduction — only + − × ÷).
// ---------------------------------------------------------------------------

const TWO_PI = 6.283185307179586;
const PI = 3.141592653589793;

export function dsin(x: number): number {
  // Reduce to [-π, π].
  x = x - Math.floor((x + PI) / TWO_PI) * TWO_PI;
  // Reduce to [-π/2, π/2] using sin(π − x) = sin(x).
  if (x > PI / 2) x = PI - x;
  else if (x < -PI / 2) x = -PI - x;
  const x2 = x * x;
  // Taylor to x^13 — error < 1e-9 on [-π/2, π/2].
  return x * (1 - (x2 / 6) * (1 - (x2 / 20) * (1 - (x2 / 42) * (1 - (x2 / 72) * (1 - (x2 / 110) * (1 - x2 / 156))))));
}

export function dcos(x: number): number {
  return dsin(x + PI / 2);
}

export function degToRad(deg: number): number {
  return (deg * PI) / 180;
}

// ---------------------------------------------------------------------------
// Shape analysis
// ---------------------------------------------------------------------------

export type WeaponKind = "spear" | "bomb" | "lightning" | "boomerang" | "club";

export const WEAPON_LABEL: Record<WeaponKind, { emoji: string; name: string; hint: string }> = {
  spear: { emoji: "🗡️", name: "창", hint: "곧은 선 — 벽을 관통하고 빠르게 날아가요" },
  bomb: { emoji: "💣", name: "폭탄", hint: "닫힌 도형 — 넓을수록 큰 폭발, 지형을 파요" },
  lightning: { emoji: "⚡", name: "번개", hint: "지그재그 — 주변 적에게 연쇄 피해" },
  boomerang: { emoji: "🪃", name: "부메랑", hint: "부드러운 C자 호 — 나갔다가 돌아와요, 오갈 때 모두 맞힐 수 있어요" },
  club: { emoji: "🪨", name: "몽둥이", hint: "자유 낙서 — 묵직한 둔기 피해" },
};

export interface WeaponStats {
  kind: WeaponKind;
  element: Element;
  ink: number;
  /** Shape relative to its ink-weighted centroid, already scaled to world units, ≤ ~48 points per stroke. */
  shape: Stroke[];
  /** Max distance of any shape point from the centroid (world units). */
  radius: number;
  /** Main-axis unit vector (start→end of the longest stroke), used to align spears with flight. */
  axisX: number;
  axisY: number;
  straightness: number;
  closed: boolean;
  area: number;
  turns: number;
  spikes: number;
  damage: number;
  blastRadius: number;
  chains: number;
  critChance: number;
  /** Launch-speed multiplier: heavier doodles fly slower. */
  speedMul: number;
  pierce: boolean;
  /** Spin in radians per tick (0 for spears, which align with velocity instead). */
  spin: number;
  /** Boomerang: horizontal pull back toward the thrower (px/tick²), 0 for everything else. */
  returnAcc: number;
  /** Gravity multiplier (boomerangs float). */
  gravityMul: number;
}

/** Pad → world scale for weapons (a full 200px pad doodle ≈ 70px in the arena). */
export const WEAPON_SCALE = 0.35;

/** Resample a polyline at a fixed step so corner detection is independent of drawing speed. */
export function resample(points: number[], step: number): number[] {
  if (points.length <= 2) return points.slice();
  const out = [points[0], points[1]];
  let carry = 0;
  for (let i = 2; i + 1 < points.length; i += 2) {
    let ax = points[i - 2];
    let ay = points[i - 1];
    const bx = points[i];
    const by = points[i + 1];
    let seg = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
    while (carry + seg >= step && seg > 0) {
      const t = (step - carry) / seg;
      ax = ax + (bx - ax) * t;
      ay = ay + (by - ay) * t;
      out.push(ax, ay);
      seg = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
      carry = 0;
    }
    carry += seg;
  }
  const lx = points[points.length - 2];
  const ly = points[points.length - 1];
  if (out[out.length - 2] !== lx || out[out.length - 1] !== ly) out.push(lx, ly);
  return out;
}

function countTurns(pts: number[]): { turns: number; spikes: number; zigzag: number } {
  let turns = 0;
  let spikes = 0;
  let zigzag = 0;
  let lastSign = 0;
  for (let i = 2; i + 3 < pts.length; i += 2) {
    const ax = pts[i] - pts[i - 2];
    const ay = pts[i + 1] - pts[i - 1];
    const bx = pts[i + 2] - pts[i];
    const by = pts[i + 3] - pts[i + 1];
    const la = Math.sqrt(ax * ax + ay * ay);
    const lb = Math.sqrt(bx * bx + by * by);
    if (la < 1e-6 || lb < 1e-6) continue;
    const cos = (ax * bx + ay * by) / (la * lb);
    if (cos < 0.5) {
      turns++;
      const sign = ax * by - ay * bx > 0 ? 1 : -1;
      if (lastSign !== 0 && sign !== lastSign) zigzag++;
      lastSign = sign;
    }
    if (cos < -0.2) spikes++;
  }
  return { turns, spikes, zigzag };
}

/**
 * Signed total turning of a polyline, as the sum of sin(turn) per step —
 * deterministic arithmetic only. A smooth half circle ≈ ±π.
 */
function curl(pts: number[]): number {
  let total = 0;
  for (let i = 2; i + 3 < pts.length; i += 2) {
    const ax = pts[i] - pts[i - 2];
    const ay = pts[i + 1] - pts[i - 1];
    const bx = pts[i + 2] - pts[i];
    const by = pts[i + 3] - pts[i + 1];
    const la = Math.sqrt(ax * ax + ay * ay);
    const lb = Math.sqrt(bx * bx + by * by);
    if (la < 1e-6 || lb < 1e-6) continue;
    total += (ax * by - ay * bx) / (la * lb);
  }
  return total;
}

function polygonArea(pts: number[]): number {
  let a = 0;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
  }
  return Math.abs(a) / 2;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Full analysis of a weapon doodle drawn on the PAD_SIZE pad. */
export function analyzeWeapon(strokes: readonly Stroke[]): WeaponStats {
  const ink = totalInk(strokes);
  // Ink-weighted dominant color.
  const colorInk = [0, 0, 0, 0, 0];
  for (const s of strokes) colorInk[s.c] += strokeInk(s);
  let color = 0;
  for (let i = 1; i < colorInk.length; i++) if (colorInk[i] > colorInk[color]) color = i;
  const element = ELEMENTS[color];

  // Longest stroke drives the archetype.
  let main = strokes[0];
  let mainLen = strokeLength(main);
  for (const s of strokes) {
    const l = strokeLength(s);
    if (l > mainLen) {
      main = s;
      mainLen = l;
    }
  }
  const sx = main.p[0];
  const sy = main.p[1];
  const ex = main.p[main.p.length - 2];
  const ey = main.p[main.p.length - 1];
  const endDist = Math.sqrt((ex - sx) * (ex - sx) + (ey - sy) * (ey - sy));
  const straightness = mainLen > 0 ? endDist / mainLen : 0;
  const closed = mainLen >= 60 && endDist <= Math.max(18, mainLen * 0.15);
  const rs = resample(main.p, 8);
  const area = closed ? polygonArea(rs) : 0;

  let turns = 0;
  let spikes = 0;
  let zigzag = 0;
  for (const s of strokes) {
    const t = countTurns(resample(s.p, 8));
    turns += t.turns;
    spikes += t.spikes;
    zigzag += t.zigzag;
  }

  const mainTurns = countTurns(rs).turns;
  const mainCurl = curl(rs);
  let kind: WeaponKind;
  if (straightness >= 0.85 && mainLen >= 70) kind = "spear";
  else if (closed && area >= 900) kind = "bomb";
  else if (zigzag >= 3) kind = "lightning";
  // A smooth, open arc that bends one way by ≳110° with almost no sharp corners.
  else if (!closed && mainLen >= 60 && Math.abs(mainCurl) >= 1.9 && mainTurns <= 2 && straightness >= 0.15 && straightness < 0.85) kind = "boomerang";
  else kind = "club";

  // Centroid (ink-weighted by resampled points), then scale to world units.
  let cx = 0;
  let cy = 0;
  let n = 0;
  const sampled = strokes.map((s) => resample(s.p, 4));
  for (const p of sampled) {
    for (let i = 0; i < p.length; i += 2) {
      cx += p[i];
      cy += p[i + 1];
      n++;
    }
  }
  cx /= n;
  cy /= n;
  let radius = 0;
  const shape: Stroke[] = strokes.map((s) => {
    const pts = resample(s.p, 6);
    // Keep at most 48 points per stroke for collision cost.
    const stride = Math.max(1, Math.ceil(pts.length / 2 / 48));
    const out: number[] = [];
    for (let i = 0; i < pts.length; i += 2 * stride) {
      const x = Math.round((pts[i] - cx) * WEAPON_SCALE * 10) / 10;
      const y = Math.round((pts[i + 1] - cy) * WEAPON_SCALE * 10) / 10;
      out.push(x, y);
      const r = Math.sqrt(x * x + y * y);
      if (r > radius) radius = r;
    }
    if (out.length === 2) out.push(out[0], out[1]);
    return { c: s.c, p: out };
  });

  const axisLen = endDist > 1e-6 ? endDist : 1;
  const axisX = endDist > 1e-6 ? (ex - sx) / axisLen : 1;
  const axisY = endDist > 1e-6 ? (ey - sy) / axisLen : 0;

  const weight = clamp(ink / INK_PER_TURN, 0, 1);
  const wf = 0.7 + 0.6 * weight;
  let damage: number;
  let blastRadius: number;
  let chains = 0;
  let speedMul = 1.15 - 0.35 * weight;
  let pierce = false;
  let spin = 0.04 + 0.1 * (1 - straightness);
  let returnAcc = 0;
  let gravityMul = 1;
  switch (kind) {
    case "spear":
      damage = 28 * wf;
      blastRadius = 0;
      speedMul += 0.15;
      pierce = true;
      spin = 0;
      break;
    case "bomb":
      damage = 18 * wf;
      blastRadius = clamp(18 + Math.sqrt(area) * 0.3 * WEAPON_SCALE * 2.2, 24, 80);
      break;
    case "lightning":
      damage = 13 * wf;
      blastRadius = 20;
      chains = clamp(Math.floor(zigzag / 3), 1, 3);
      break;
    case "boomerang":
      damage = 19 * wf;
      blastRadius = 16;
      speedMul += 0.1;
      spin = 0.3;
      returnAcc = 0.13;
      gravityMul = 0.45;
      break;
    default:
      damage = 17 * wf;
      blastRadius = clamp(radius * 0.6, 18, 42);
      break;
  }
  if (element === "none") damage *= 1.1;
  if (element === "shock") chains += 1;
  const critChance = clamp(spikes * 0.07, 0, 0.45);

  return {
    kind,
    element,
    ink: Math.round(ink * 10) / 10,
    shape,
    radius: Math.max(4, radius),
    axisX,
    axisY,
    straightness,
    closed,
    area,
    turns,
    spikes,
    damage: Math.round(damage * 10) / 10,
    blastRadius: Math.round(blastRadius * 10) / 10,
    chains,
    critChance,
    speedMul,
    pierce,
    spin,
    returnAcc,
    gravityMul,
  };
}
