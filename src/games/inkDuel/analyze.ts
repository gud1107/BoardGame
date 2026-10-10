/**
 * 낙서 결투 — turns a doodle into weapon stats by pure geometry (no shape
 * recognition / ML). Everything here uses only + − × ÷ and Math.sqrt so every
 * client computes bit-identical results for the lockstep sync (Math.sin/cos/
 * atan2/hypot are not guaranteed identical across JS engines — see `dsin`).
 */

/** Ink colors. Index = element (see ELEMENTS) — the color you draw with decides the effect. */
export const INK_COLORS = [
  "#1f2937", // 0 steel
  "#dc2626", // 1 fire
  "#2563eb", // 2 ice
  "#16a34a", // 3 poison
  "#eab308", // 4 shock
  "#06b6d4", // 5 slow
  "#92400e", // 6 stun
  "#9333ea", // 7 curse
  "#f97316", // 8 crush
  "#ec4899", // 9 vampire
  "#9ca3af", // 10 chaos
  "#3730a3", // 11 dark
] as const;
export type InkColor = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
export const ELEMENTS = ["none", "fire", "ice", "poison", "shock", "slow", "stun", "curse", "crush", "vampire", "chaos", "dark"] as const;
export type Element = (typeof ELEMENTS)[number];
export const COLOR_NAMES = ["검정", "빨강", "파랑", "초록", "노랑", "하늘", "갈색", "보라", "주황", "분홍", "회색", "남색"];
export const ELEMENT_LABEL: Record<Element, string> = {
  none: "⚫ 강철 (피해 +10%)",
  fire: "🔴 화염 (🔥 화상)",
  ice: "🔵 빙결 (❄️ 얼어붙음)",
  poison: "🟢 독 (☠️ 중독)",
  shock: "🟡 전기 (연쇄 +1 · 20% 💫 기절)",
  slow: "🩵 끈적 (🐌 느려짐)",
  stun: "🟤 충격 (45% 💫 기절, 피해 −20%)",
  curse: "🟣 저주 (⬇️ 약화)",
  crush: "🟠 분쇄 (💔 취약)",
  vampire: "🩷 흡혈 (준 피해의 30% 회복)",
  chaos: "⚪ 혼돈 (50% 😵 혼란)",
  dark: "🔷 어둠 (🕶️ 실명)",
};

/** A stroke: color + flat [x0,y0,x1,y1,...] integer coordinates. */
export interface Stroke {
  c: InkColor;
  p: number[];
}

export const PAD_SIZE = 200;
export const INK_PER_TURN = 100;
export const MAX_STROKES = 24;
export const MAX_POINTS_PER_STROKE = 260;
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

export type WeaponKind = "spear" | "bomb" | "rocket" | "anvil" | "shuriken" | "lightning" | "boomerang" | "drill" | "wave" | "cluster" | "club";

export const WEAPON_LABEL: Record<WeaponKind, { emoji: string; name: string; hint: string }> = {
  spear: { emoji: "🗡️", name: "창", hint: "곧은 선 — 벽을 관통하고 빠르게 날아가요" },
  bomb: { emoji: "💣", name: "폭탄", hint: "닫힌 도형 — 넓을수록 큰 폭발, 지형을 파요" },
  lightning: { emoji: "⚡", name: "번개", hint: "지그재그 — 주변 적에게 연쇄 피해" },
  boomerang: { emoji: "🪃", name: "부메랑", hint: "부드러운 C자 호 — 나갔다가 돌아와요, 오갈 때 모두 맞힐 수 있어요" },
  rocket: { emoji: "🚀", name: "로켓", hint: "세모 — 중력을 덜 받고 뾰족한 쪽으로 쭉 날아가요" },
  anvil: { emoji: "🔨", name: "모루", hint: "네모·다각형 — 무겁게 떨어져 큰 피해" },
  shuriken: { emoji: "✴️", name: "표창", hint: "뾰족한 별·엇갈린 선 — 땅에 두 번 튕기고 치명타가 잘 나요" },
  drill: { emoji: "🌀", name: "드릴", hint: "소용돌이 — 땅을 파고 들어가 큰 구덩이를 내며 폭발" },
  wave: { emoji: "🌊", name: "파도", hint: "S자 물결 — 맞은 상대를 밀어내요" },
  cluster: { emoji: "🎆", name: "산탄", hint: "작은 낙서 여러 개 — 흩어지며 여러 번 터져요" },
  club: { emoji: "🪨", name: "몽둥이", hint: "자유 낙서 — 묵직한 둔기 피해" },
};

export interface WeaponStats {
  kind: WeaponKind;
  element: Element;
  /** A second color with ≥35% of the ink adds its effect too. */
  element2: Element | null;
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
  /** ✴️ Ground bounces before it can explode. */
  bounces: number;
  /** 🌀 Ticks it keeps tunnelling once it hits the ground. */
  dig: number;
  /** 🌊 Push hit players away from the impact (px). */
  knockback: number;
  /** 🎆 Number of sub-blasts spread around the impact. */
  pellets: number;
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

/** Do segments AB and CD properly cross? */
function segmentsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Smooth-turn profile of a resampled polyline: total |turning| and how often the bend direction flips. */
function bendProfile(pts: number[]): { absCurl: number; inflections: number } {
  let absCurl = 0;
  let inflections = 0;
  let lastSign = 0;
  for (let i = 2; i + 3 < pts.length; i += 2) {
    const ax = pts[i] - pts[i - 2];
    const ay = pts[i + 1] - pts[i - 1];
    const bx = pts[i + 2] - pts[i];
    const by = pts[i + 3] - pts[i + 1];
    const la = Math.sqrt(ax * ax + ay * ay);
    const lb = Math.sqrt(bx * bx + by * by);
    if (la < 1e-6 || lb < 1e-6) continue;
    const sin = (ax * by - ay * bx) / (la * lb);
    absCurl += Math.abs(sin);
    if (Math.abs(sin) > 0.12) {
      const sign = sin > 0 ? 1 : -1;
      if (lastSign !== 0 && sign !== lastSign) inflections++;
      lastSign = sign;
    }
  }
  return { absCurl, inflections };
}

/**
 * Points of a star: how many times the distance from the outline's centre
 * swings from "far" (tip) to "near" (notch). Robust to resampling rounding
 * off the tips, unlike per-step corner angles.
 */
function starPeaks(pts: number[]): number {
  const n = pts.length / 2;
  if (n < 6) return 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < pts.length; i += 2) {
    mx += pts[i];
    my += pts[i + 1];
  }
  mx /= n;
  my /= n;
  const r: number[] = [];
  let sum = 0;
  let lo = Infinity;
  let hi = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const d = Math.sqrt((pts[i] - mx) * (pts[i] - mx) + (pts[i + 1] - my) * (pts[i + 1] - my));
    r.push(d);
    sum += d;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  if (lo <= 0 || hi / lo < 1.8) return 0;
  const mean = sum / n;
  let peaks = 0;
  let state = 0; // 1 = in a tip, -1 = in a notch
  for (const d of r) {
    if (d > mean * 1.2 && state !== 1) {
      if (state === -1) peaks++;
      state = 1;
    } else if (d < mean * 0.85) state = -1;
  }
  return peaks;
}

/** Sharp corners of a closed outline, including the one where the pen started/ended. */
function closedCorners(pts: number[]): number {
  let corners = countTurns(pts).turns;
  const n = pts.length;
  if (n >= 8) {
    const ax = pts[n - 2] - pts[n - 4];
    const ay = pts[n - 1] - pts[n - 3];
    const bx = pts[2] - pts[0];
    const by = pts[3] - pts[1];
    const la = Math.sqrt(ax * ax + ay * ay);
    const lb = Math.sqrt(bx * bx + by * by);
    if (la > 1e-6 && lb > 1e-6 && (ax * bx + ay * by) / (la * lb) < 0.5) corners++;
  }
  return corners;
}

/** Pen lifts whose ends are this close (pad px) count as one continued line. */
export const JOIN_DIST = 14;

function reversePts(p: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = p.length - 2; i >= 0; i -= 2) out.push(p[i], p[i + 1]);
  return out;
}

/**
 * Joins strokes that pick up where another one stopped (lift the mouse, keep
 * drawing) into single polylines, so a triangle drawn as 3 lines still reads
 * as a triangle. Shape only — colors are counted per stroke elsewhere. Dots
 * stay apart (cluster pellets), and a chain that already closed on itself is
 * left alone (a bomb with a fuse stays a bomb).
 */
function chainStrokes(strokes: readonly Stroke[]): number[][] {
  const near = (p: readonly number[], i: number, q: readonly number[], j: number) => {
    const dx = p[i] - q[j];
    const dy = p[i + 1] - q[j + 1];
    return dx * dx + dy * dy <= JOIN_DIST * JOIN_DIST;
  };
  const isClosed = (p: number[]) => strokeLength({ c: 0, p }) >= 60 && near(p, 0, p, p.length - 2);
  const chains: number[][] = [];
  for (const s of strokes) {
    let pts = s.p.slice();
    if (strokeLength(s) >= 6) {
      for (let joined = true; joined && !isClosed(pts); ) {
        joined = false;
        for (let k = chains.length - 1; k >= 0; k--) {
          const c = chains[k];
          if (strokeLength({ c: 0, p: c }) < 6 || isClosed(c)) continue;
          const ce = c.length - 2;
          const pe = pts.length - 2;
          let next: number[] | null = null;
          if (near(c, ce, pts, 0)) next = c.concat(pts);
          else if (near(c, ce, pts, pe)) next = c.concat(reversePts(pts));
          else if (near(c, 0, pts, pe)) next = pts.concat(c);
          else if (near(c, 0, pts, 0)) next = reversePts(pts).concat(c);
          if (next) {
            chains.splice(k, 1);
            pts = next;
            joined = true;
            break;
          }
        }
      }
    }
    chains.push(pts);
  }
  return chains;
}

/** Full analysis of a weapon doodle drawn on the PAD_SIZE pad. */
export function analyzeWeapon(strokes: readonly Stroke[]): WeaponStats {
  const ink = totalInk(strokes);
  // Ink-weighted colors: the top color is the element, a strong runner-up (≥35%) adds a second one.
  const colorInk = new Array<number>(INK_COLORS.length).fill(0);
  for (const s of strokes) colorInk[s.c] += strokeInk(s);
  let color = 0;
  for (let i = 1; i < colorInk.length; i++) if (colorInk[i] > colorInk[color]) color = i;
  let second = -1;
  for (let i = 0; i < colorInk.length; i++) if (i !== color && (second < 0 || colorInk[i] > colorInk[second])) second = i;
  const element = ELEMENTS[color];
  const element2: Element | null = second >= 0 && colorInk[second] >= ink * 0.35 ? ELEMENTS[second] : null;

  // Longest continued line drives the archetype.
  const lines = chainStrokes(strokes);
  let main = lines[0];
  let mainLen = strokeLength({ c: 0, p: main });
  let totalLen = 0;
  for (const p of lines) {
    const l = strokeLength({ c: 0, p });
    totalLen += l;
    if (l > mainLen) {
      main = p;
      mainLen = l;
    }
  }
  const sx = main[0];
  const sy = main[1];
  const ex = main[main.length - 2];
  const ey = main[main.length - 1];
  const endDist = Math.sqrt((ex - sx) * (ex - sx) + (ey - sy) * (ey - sy));
  const straightness = mainLen > 0 ? endDist / mainLen : 0;
  // Gap allowed between pen-down and pen-up for a closed shape (capped so a spiral never counts).
  const closed = mainLen >= 60 && endDist <= Math.max(18, Math.min(35, mainLen * 0.15));
  const rs = resample(main, 8);
  const area = closed ? polygonArea(rs) : 0;

  let turns = 0;
  let spikes = 0;
  let zigzag = 0;
  for (const p of lines) {
    const t = countTurns(resample(p, 8));
    turns += t.turns;
    spikes += t.spikes;
    zigzag += t.zigzag;
  }
  const mainShape = countTurns(rs);
  const mainCurl = curl(rs);
  const bend = bendProfile(rs);
  const mainShare = totalLen > 0 ? mainLen / totalLen : 1;

  // Long straight strokes that cross each other read as a throwing star.
  const straights = strokes.filter((s) => {
    const l = strokeLength(s);
    if (l < 50) return false;
    const dx = s.p[s.p.length - 2] - s.p[0];
    const dy = s.p[s.p.length - 1] - s.p[1];
    return Math.sqrt(dx * dx + dy * dy) / l >= 0.85;
  });
  let crossing = false;
  for (let i = 0; i < straights.length && !crossing; i++) {
    for (let j = i + 1; j < straights.length && !crossing; j++) {
      const a = straights[i].p;
      const b = straights[j].p;
      crossing = segmentsCross(a[0], a[1], a[a.length - 2], a[a.length - 1], b[0], b[1], b[b.length - 2], b[b.length - 1]);
    }
  }

  let kind: WeaponKind;
  if (lines.length >= 4 && mainShare < 0.45) kind = "cluster";
  else if (crossing) kind = "shuriken";
  else if (straightness >= 0.85 && mainLen >= 70) kind = "spear";
  else if (closed && area >= 900) {
    const corners = closedCorners(rs);
    if (starPeaks(rs) >= 4) kind = "shuriken";
    else if (corners === 3) kind = "rocket";
    else if (corners >= 4 && corners <= 5) kind = "anvil";
    else kind = "bomb";
  } else if (zigzag >= 3) kind = "lightning";
  else if (!closed && mainLen >= 60 && mainShape.turns <= 3 && Math.abs(mainCurl) >= 9) kind = "drill";
  else if (!closed && mainLen >= 60 && Math.abs(mainCurl) >= 1.9 && mainShape.turns <= 2 && straightness >= 0.15 && straightness < 0.85) kind = "boomerang";
  else if (!closed && mainLen >= 80 && mainShape.turns <= 2 && bend.inflections >= 1 && bend.absCurl >= 2.5 && Math.abs(mainCurl) < 1.9) kind = "wave";
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

  let axisX = 1;
  let axisY = 0;
  if (kind === "rocket") {
    // The nose is the outline point farthest from the centroid.
    let best = -1;
    for (let i = 0; i < rs.length; i += 2) {
      const dx = rs[i] - cx;
      const dy = rs[i + 1] - cy;
      const d = dx * dx + dy * dy;
      if (d > best) {
        best = d;
        const l = Math.sqrt(d) || 1;
        axisX = dx / l;
        axisY = dy / l;
      }
    }
  } else if (endDist > 1e-6) {
    axisX = (ex - sx) / endDist;
    axisY = (ey - sy) / endDist;
  }

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
  let bounces = 0;
  let dig = 0;
  let knockback = 0;
  let pellets = 0;
  let critBonus = 0;
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
    case "rocket":
      damage = 22 * wf;
      blastRadius = 30;
      speedMul += 0.25;
      gravityMul = 0.35;
      spin = 0;
      break;
    case "anvil":
      damage = 24 * wf;
      blastRadius = 18;
      speedMul = Math.max(0.55, speedMul - 0.25);
      gravityMul = 1.9;
      spin = 0.02;
      break;
    case "shuriken":
      damage = 15 * wf;
      blastRadius = 12;
      speedMul += 0.1;
      spin = 0.45;
      bounces = 2;
      critBonus = 0.15;
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
    case "drill":
      damage = 20 * wf;
      blastRadius = 34;
      spin = 0.5;
      dig = 45;
      break;
    case "wave":
      damage = 14 * wf;
      blastRadius = 34;
      knockback = 50;
      spin = 0.1;
      break;
    case "cluster":
      damage = 9 * wf;
      blastRadius = 20;
      pellets = clamp(lines.length, 3, 6);
      break;
    default:
      damage = 17 * wf;
      blastRadius = clamp(radius * 0.6, 18, 42);
      break;
  }
  if (element === "none" || element2 === "none") damage *= 1.1;
  if (element === "stun" || element2 === "stun") damage *= 0.8;
  if (element === "shock" || element2 === "shock") chains += 1;
  const critChance = clamp(spikes * 0.07 + critBonus, 0, 0.45);

  return {
    kind,
    element,
    element2,
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
    bounces,
    dig,
    knockback,
    pellets,
  };
}
