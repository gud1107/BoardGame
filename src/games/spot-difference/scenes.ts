/**
 * Pure scene data for the "built-in stages" mode — no React, no DOM. Every
 * scene is a flat list of simple shapes drawn on a 0..100 square viewBox
 * (so `xPct`/`yPct`/`sizePct` are usable directly as SVG viewBox units,
 * matching the click-hit percentages used everywhere else in this game).
 * All visuals are generated shapes, never external image assets — same
 * convention as PerudoFaceIcon.tsx/ResourceIcon.tsx elsewhere in this repo.
 *
 * Each scene ships exactly `DIFFS_PER_SCENE` (5) differences between its
 * "original" shape list and its "modified" one (`applySceneDiffs`). The
 * *location* of each difference (used as the click-hit `Spot` in engine.ts)
 * is always the affected shape's original `xPct`/`yPct` — this keeps the
 * diff definition and the answer-key coordinates a single source of truth
 * instead of two lists that could drift apart.
 */

export type ShapeKind = "circle" | "ellipse" | "rect" | "triangle" | "star";

export interface SceneShape {
  id: string;
  kind: ShapeKind;
  xPct: number;
  yPct: number;
  /** Primary radius/half-width, in viewBox units (0..100). */
  sizePct: number;
  /** Rect-only: full height (defaults to `sizePct * 2`, i.e. a square, when omitted). */
  heightPct?: number;
  rotationDeg?: number;
  color: string;
  opacity?: number;
}

export type ShapeChange = Partial<Pick<SceneShape, "color" | "xPct" | "yPct" | "sizePct" | "heightPct" | "rotationDeg" | "opacity">>;

export type SceneDiff = { shapeId: string; change: ShapeChange } | { shapeId: string; change: { removed: true } };

export interface BuiltinScene {
  id: string;
  name: string;
  /** Two-stop background gradient, top -> bottom. */
  background: [string, string];
  shapes: SceneShape[];
  diffs: SceneDiff[];
}

export const DIFFS_PER_SCENE = 5;
/** Click-hit tolerance radius for built-in stages, in the same 0..100 units as `xPct`/`yPct`. */
export const TOLERANCE_RADIUS_PCT = 7;

function isRemoval(change: ShapeChange | { removed: true }): change is { removed: true } {
  return "removed" in change;
}

/** Produces the "modified" shape list — the original list is just `scene.shapes` untouched. */
export function applySceneDiffs(shapes: SceneShape[], diffs: SceneDiff[]): SceneShape[] {
  const removedIds = new Set(diffs.filter((d) => isRemoval(d.change)).map((d) => d.shapeId));
  return shapes
    .filter((s) => !removedIds.has(s.id))
    .map((s) => {
      const diff = diffs.find((d) => d.shapeId === s.id && !isRemoval(d.change));
      return diff ? { ...s, ...(diff.change as ShapeChange) } : s;
    });
}

export const BUILTIN_SCENES: BuiltinScene[] = [
  {
    id: "park",
    name: "공원 소풍",
    background: ["#7dd3fc", "#bbf7d0"],
    shapes: [
      { id: "sun", kind: "circle", xPct: 85, yPct: 15, sizePct: 8, color: "#fbbf24" },
      { id: "cloud1", kind: "ellipse", xPct: 20, yPct: 18, sizePct: 10, color: "#ffffff", opacity: 0.9 },
      { id: "cloud2", kind: "ellipse", xPct: 50, yPct: 12, sizePct: 7, color: "#ffffff", opacity: 0.85 },
      { id: "tree1Top", kind: "circle", xPct: 15, yPct: 55, sizePct: 9, color: "#15803d" },
      { id: "tree1Trunk", kind: "rect", xPct: 15, yPct: 68, sizePct: 1.5, heightPct: 14, color: "#7c4a21" },
      { id: "tree2Top", kind: "circle", xPct: 78, yPct: 60, sizePct: 10, color: "#16a34a" },
      { id: "tree2Trunk", kind: "rect", xPct: 78, yPct: 75, sizePct: 1.5, heightPct: 14, color: "#7c4a21" },
      { id: "bench", kind: "rect", xPct: 45, yPct: 78, sizePct: 7, heightPct: 4, color: "#92400e" },
      { id: "ball", kind: "circle", xPct: 60, yPct: 85, sizePct: 4, color: "#ef4444" },
      { id: "kite", kind: "triangle", xPct: 30, yPct: 25, sizePct: 6, color: "#3b82f6", rotationDeg: 15 },
      { id: "flower1", kind: "circle", xPct: 25, yPct: 88, sizePct: 3, color: "#ec4899" },
      { id: "flower2", kind: "circle", xPct: 35, yPct: 90, sizePct: 3, color: "#ec4899" },
      { id: "bird", kind: "triangle", xPct: 65, yPct: 20, sizePct: 3, color: "#475569", rotationDeg: 180 },
    ],
    diffs: [
      { shapeId: "sun", change: { color: "#f97316" } },
      { shapeId: "cloud2", change: { yPct: 22 } },
      { shapeId: "ball", change: { sizePct: 7 } },
      { shapeId: "bench", change: { rotationDeg: 10 } },
      { shapeId: "flower2", change: { removed: true } },
    ],
  },
  {
    id: "space",
    name: "우주 탐험",
    background: ["#1e1b4b", "#312e81"],
    shapes: [
      { id: "planet", kind: "circle", xPct: 25, yPct: 60, sizePct: 14, color: "#8b5cf6" },
      { id: "moon", kind: "circle", xPct: 50, yPct: 20, sizePct: 6, color: "#e2e8f0" },
      { id: "ufo", kind: "ellipse", xPct: 80, yPct: 25, sizePct: 8, color: "#22c55e" },
      { id: "rocketBody", kind: "rect", xPct: 70, yPct: 55, sizePct: 3, heightPct: 16, color: "#f87171" },
      { id: "rocketFin", kind: "triangle", xPct: 70, yPct: 68, sizePct: 5, color: "#fbbf24", rotationDeg: 0 },
      { id: "astronautHelmet", kind: "circle", xPct: 55, yPct: 78, sizePct: 5, color: "#f1f5f9" },
      { id: "comet", kind: "star", xPct: 15, yPct: 15, sizePct: 5, color: "#fde68a" },
      { id: "star1", kind: "circle", xPct: 10, yPct: 40, sizePct: 1.2, color: "#ffffff" },
      { id: "star2", kind: "circle", xPct: 40, yPct: 85, sizePct: 1.2, color: "#ffffff" },
      { id: "star3", kind: "circle", xPct: 90, yPct: 60, sizePct: 1.2, color: "#ffffff" },
      { id: "star4", kind: "circle", xPct: 60, yPct: 10, sizePct: 1.2, color: "#ffffff" },
    ],
    diffs: [
      { shapeId: "planet", change: { color: "#3b82f6" } },
      { shapeId: "moon", change: { xPct: 42 } },
      { shapeId: "ufo", change: { removed: true } },
      { shapeId: "rocketFin", change: { rotationDeg: 25 } },
      { shapeId: "star3", change: { sizePct: 3 } },
    ],
  },
  {
    id: "ocean",
    name: "바닷속 탐험",
    background: ["#0891b2", "#0e7490"],
    shapes: [
      { id: "fish1", kind: "triangle", xPct: 25, yPct: 35, sizePct: 6, color: "#f97316", rotationDeg: 90 },
      { id: "fish2", kind: "triangle", xPct: 65, yPct: 50, sizePct: 5, color: "#facc15", rotationDeg: -90 },
      { id: "coral1", kind: "star", xPct: 20, yPct: 85, sizePct: 6, color: "#fb7185" },
      { id: "coral2", kind: "star", xPct: 78, yPct: 88, sizePct: 5, color: "#fb923c" },
      { id: "jellyfish", kind: "ellipse", xPct: 50, yPct: 22, sizePct: 6, color: "#e9d5ff", opacity: 0.85 },
      { id: "bubble1", kind: "circle", xPct: 35, yPct: 65, sizePct: 2, color: "#ffffff", opacity: 0.6 },
      { id: "bubble2", kind: "circle", xPct: 45, yPct: 55, sizePct: 2.5, color: "#ffffff", opacity: 0.6 },
      { id: "bubble3", kind: "circle", xPct: 55, yPct: 40, sizePct: 1.8, color: "#ffffff", opacity: 0.6 },
      { id: "seaweed", kind: "rect", xPct: 85, yPct: 70, sizePct: 1.5, heightPct: 20, color: "#15803d" },
      { id: "sharkFin", kind: "triangle", xPct: 10, yPct: 15, sizePct: 4, color: "#64748b" },
      { id: "starfish", kind: "star", xPct: 55, yPct: 90, sizePct: 4, color: "#fbbf24" },
    ],
    diffs: [
      { shapeId: "fish1", change: { color: "#22c55e" } },
      { shapeId: "coral2", change: { removed: true } },
      { shapeId: "jellyfish", change: { xPct: 40 } },
      { shapeId: "bubble2", change: { sizePct: 4.5 } },
      { shapeId: "starfish", change: { rotationDeg: 30 } },
    ],
  },
];
