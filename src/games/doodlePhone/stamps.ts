/**
 * One-tap shape stamps for the drawing tool (DoodleCanvas "🔷 도장").
 *
 * Square/rectangle and circle/oval are stamped as real shape ops (`r`/`e`),
 * so the 👆 select tool can still resize them afterwards. Everything else is
 * a closed polyline stroke; "도형 속 채우기" adds a flood fill at a point
 * known to be inside the outline (not the centroid — a lightning bolt's
 * centroid is outside it).
 *
 * Pure: geometry is authored in a unit box (-1…1 on both axes) and scaled to
 * the stamp size at the tap point, clamped onto the sheet by the op builders.
 */

import { CANVAS_H, CANVAS_W, fillOp, shapeOp, strokeOp, type ColorRef, type DrawOp, type Point } from "./drawing";

export type StampId = "square" | "rect" | "circle" | "oval" | "triangle" | "star" | "heart" | "diamond" | "pentagon" | "hexagon" | "arrow" | "bolt" | "bubble" | "cloud" | "cross" | "moon";

interface StampDef {
  readonly id: StampId;
  readonly icon: string;
  readonly label: string;
  /** Box aspect (width / height) for the shape kinds. */
  readonly box?: { kind: "r" | "e"; aspect: number };
  /** Closed outline in unit coords. */
  readonly outline?: readonly Point[];
  /** A point inside the outline for the fill (unit coords). */
  readonly inside?: Point;
}

const polygon = (sides: number, rotation = -Math.PI / 2): Point[] =>
  Array.from({ length: sides + 1 }, (_, i) => {
    const a = rotation + (i * Math.PI * 2) / sides;
    return { x: Math.cos(a), y: Math.sin(a) };
  });

const star = (): Point[] =>
  Array.from({ length: 11 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 1 : 0.42;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  });

const heart = (): Point[] =>
  Array.from({ length: 41 }, (_, i) => {
    const t = (i / 40) * Math.PI * 2;
    // Classic heart curve, normalised to roughly -1…1 with the dip on top.
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    return { x: x / 17, y: -y / 15 - 0.15 };
  });

const cloud = (): Point[] => {
  const bumps = [
    { cx: -0.55, cy: 0.15, r: 0.45, from: 0.5, to: 1.55 },
    { cx: -0.1, cy: -0.25, r: 0.55, from: 1.05, to: 1.85 },
    { cx: 0.45, cy: -0.05, r: 0.5, from: 1.4, to: 2.35 },
  ];
  const pts: Point[] = [];
  for (const b of bumps) {
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * (b.from + ((b.to - b.from) * i) / 10);
      pts.push({ x: b.cx + Math.cos(a) * b.r, y: b.cy + Math.sin(a) * b.r });
    }
  }
  pts.push({ x: 0.95, y: 0.45 }, { x: -0.95, y: 0.45 }, pts[0]);
  return pts;
};

const moon = (): Point[] => {
  const pts: Point[] = [];
  for (let i = 0; i <= 20; i++) {
    const a = Math.PI * (0.3 + (1.4 * i) / 20);
    pts.push({ x: Math.cos(a), y: Math.sin(a) });
  }
  for (let i = 20; i >= 0; i--) {
    const a = Math.PI * (0.38 + (1.24 * i) / 20);
    pts.push({ x: 0.35 + Math.cos(a) * 0.75, y: Math.sin(a) * 0.82 });
  }
  pts.push(pts[0]);
  return pts;
};

const pts = (...xy: number[]): Point[] => Array.from({ length: xy.length / 2 }, (_, i) => ({ x: xy[i * 2], y: xy[i * 2 + 1] }));

export const STAMPS: readonly StampDef[] = [
  { id: "square", icon: "🟦", label: "정사각형", box: { kind: "r", aspect: 1 } },
  { id: "rect", icon: "▬", label: "직사각형", box: { kind: "r", aspect: 1.7 } },
  { id: "circle", icon: "🔵", label: "원", box: { kind: "e", aspect: 1 } },
  { id: "oval", icon: "🥚", label: "타원", box: { kind: "e", aspect: 1.6 } },
  { id: "triangle", icon: "🔺", label: "세모", outline: pts(0, -1, 1, 0.8, -1, 0.8, 0, -1), inside: { x: 0, y: 0.3 } },
  { id: "diamond", icon: "🔷", label: "마름모", outline: pts(0, -1, 0.7, 0, 0, 1, -0.7, 0, 0, -1), inside: { x: 0, y: 0 } },
  { id: "pentagon", icon: "⬟", label: "오각형", outline: polygon(5), inside: { x: 0, y: 0 } },
  { id: "hexagon", icon: "⬢", label: "육각형", outline: polygon(6, 0), inside: { x: 0, y: 0 } },
  { id: "star", icon: "⭐", label: "별", outline: star(), inside: { x: 0, y: 0.05 } },
  { id: "heart", icon: "❤️", label: "하트", outline: heart(), inside: { x: 0, y: 0 } },
  { id: "moon", icon: "🌙", label: "달", outline: moon(), inside: { x: -0.75, y: 0 } },
  { id: "cloud", icon: "☁️", label: "구름", outline: cloud(), inside: { x: 0, y: 0.15 } },
  { id: "bubble", icon: "💬", label: "말풍선", outline: pts(-1, -0.8, 1, -0.8, 1, 0.4, -0.2, 0.4, -0.6, 1, -0.5, 0.4, -1, 0.4, -1, -0.8), inside: { x: 0, y: -0.2 } },
  { id: "arrow", icon: "➡️", label: "화살표", outline: pts(-1, -0.3, 0.2, -0.3, 0.2, -0.75, 1, 0, 0.2, 0.75, 0.2, 0.3, -1, 0.3, -1, -0.3), inside: { x: -0.4, y: 0 } },
  { id: "bolt", icon: "⚡", label: "번개", outline: pts(0.15, -1, -0.65, 0.15, -0.05, 0.15, -0.3, 1, 0.65, -0.25, 0.05, -0.25, 0.4, -1, 0.15, -1), inside: { x: -0.25, y: 0.08 } },
  { id: "cross", icon: "➕", label: "십자", outline: pts(-0.3, -1, 0.3, -1, 0.3, -0.3, 1, -0.3, 1, 0.3, 0.3, 0.3, 0.3, 1, -0.3, 1, -0.3, 0.3, -1, 0.3, -1, -0.3, -0.3, -0.3, -0.3, -1), inside: { x: 0, y: 0 } },
];

/** Stamp sizes (logical px across the longer side). */
export const STAMP_SIZES = [
  { label: "작게", px: 50 },
  { label: "보통", px: 100 },
  { label: "크게", px: 170 },
] as const;

export function stampDef(id: StampId): StampDef {
  return STAMPS.find((s) => s.id === id) ?? STAMPS[0];
}

/**
 * The ops one tap of `id` adds, centred on `at` and `sizePx` across. Kept
 * inside the sheet: a stamp near the edge slides in rather than being cut.
 */
export function stampOps(id: StampId, at: Point, sizePx: number, style: { color: ColorRef; sizeIndex: number; opacity: number; filled: boolean }): DrawOp[] {
  const def = stampDef(id);
  const aspect = def.box?.aspect ?? 1;
  const halfW = (aspect >= 1 ? sizePx : sizePx * aspect) / 2;
  const halfH = (aspect >= 1 ? sizePx / aspect : sizePx) / 2;
  const cx = Math.min(CANVAS_W - halfW, Math.max(halfW, at.x));
  const cy = Math.min(CANVAS_H - halfH, Math.max(halfH, at.y));
  const map = (p: Point): Point => ({ x: cx + p.x * halfW, y: cy + p.y * halfH });

  if (def.box) {
    return [shapeOp(def.box.kind, style.color, style.sizeIndex, map({ x: -1, y: -1 }), map({ x: 1, y: 1 }), { opacity: style.opacity, filled: style.filled })];
  }
  const outline = strokeOp(style.color, style.sizeIndex, (def.outline ?? []).map(map), style.opacity);
  return style.filled && def.inside ? [outline, fillOp(style.color, map(def.inside), style.opacity)] : [outline];
}
