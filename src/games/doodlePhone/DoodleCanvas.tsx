"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref } from "react";
import {
  BRUSH_SIZES,
  CANVAS_H,
  CANVAS_W,
  INK_COLOR,
  MAX_DRAWING_CHARS,
  MAX_OPACITY,
  MIN_OPACITY,
  PALETTE,
  PAPER_COLOR,
  clampToCanvas,
  colorHex,
  fillOp,
  normalizeColor,
  rgbToHex,
  serializedLength,
  shapeOp,
  strokeOp,
  type ColorRef,
  type DrawOp,
  type Drawing,
  type Point,
  type ShapeKind,
} from "./drawing";
import { getDoodlePhoneSound } from "./doodlePhoneSound";
import DrawingView from "./DrawingView";
import { ONION_OPACITY } from "./modes";
import { clearToPaper, prepareContext, renderDrawing, renderOp, strokePath } from "./drawingRenderer";
import { handleAt, handlesFor, hitTest, opBounds, resizeShape, translateOp, type Handle } from "./editing";

/**
 * Drawing editor (rulebook §4, §11–§13): pen, straight line, rectangle,
 * ellipse (outline or filled), paint bucket, eraser, select/move, undo/redo,
 * clear, 5 brush sizes, 20 colors plus a free color picker and an eyedropper,
 * an opacity slider ("연하게 ↔ 짙게"), an ink gauge for the per-drawing size
 * cap, and two-finger pinch zoom.
 *
 * Layers: the gesture in progress (a stroke, a shape being dragged, a
 * selection being moved) is drawn on a transparent preview canvas on top and
 * only baked into the main canvas on release — dragging never smears the
 * picture, and a translucent stroke is stroked as one even path.
 *
 * History is a stack of op-list snapshots, not "pop the last op", so editing
 * an earlier stroke or shape with the select tool is undoable like drawing.
 *
 * Zoom: two fingers pinch/pan the sheet (CSS transform on the stage);
 * Ctrl/⌘ + wheel does the same on desktop. Pointer→canvas mapping already
 * goes through the canvas's on-screen rect, so drawing stays accurate at any
 * zoom. A second finger landing mid-stroke discards that stroke — it was
 * the start of a pinch, not a line.
 *
 * Mode features (modes.ts):
 * - `blind` (비밀): strokes are painted to an offscreen canvas — the real
 *   pixels still exist, so the paint bucket keeps working — while the
 *   visible sheet stays blank. The select tool is hidden (nothing to see).
 * - `baseDrawing` (보완): the previous player's picture is a locked first
 *   layer; undo and the select tool never reach it and "전체 지우기" is
 *   hidden. The result is base ops + your ops.
 * - `onionDrawing` (애니메이션): the previous frame as a faint grayscale ghost
 *   over the paper (multiply blend, so it reads as "under" your strokes).
 * - `allowUndo`: host option; hides undo/redo and their shortcuts.
 *
 * Uncontrolled on purpose: pointer moves arrive far faster than React should
 * re-render, so the op list lives in refs and is painted straight onto the
 * canvas. The parent reads the result through `ref.getDrawing()` — on submit
 * and when the timer auto-submits at 0s.
 */

export interface DoodleCanvasHandle {
  getDrawing(): Drawing;
}

type Tool = "pen" | "line" | "rect" | "ellipse" | "fill" | "eraser" | "select" | "picker";

const PIXEL_SCALE = 2;
/** Skip pointer samples closer than this (logical px) — keeps payloads small without visible loss. */
const MIN_POINT_GAP = 1.5;
/** Long strokes are split so one op never grows unbounded. */
const MAX_POINTS_PER_STROKE = 400;
/** Rough JSON cost of one stroke point, used to stop a stroke before it overflows the ink cap. */
const CHARS_PER_POINT = 8;
/** How many recently picked free colors stay one tap away. */
const MAX_RECENT_COLORS = 6;
/** Undo depth (op-list snapshots). */
const MAX_HISTORY = 60;
const MAX_ZOOM = 4;

const SHAPE_OF: Partial<Record<Tool, ShapeKind>> = { line: "l", rect: "r", ellipse: "e" };
/** "연하게" preset — sketch/underdrawing strength. */
const LIGHT_OPACITY = 25;
/** A drag shorter than this (logical px) is treated as a stray click, not a shape. */
const MIN_SHAPE_SIZE = 2;

type Gesture =
  | { kind: "stroke"; points: Point[]; color: ColorRef; size: number; opacity: number }
  | { kind: "shape"; shape: ShapeKind; from: Point; to: Point; color: ColorRef; size: number; opacity: number; filled: boolean }
  | { kind: "move"; index: number; start: Point; original: DrawOp; current: DrawOp }
  | { kind: "resize"; index: number; handle: Handle; original: DrawOp; current: DrawOp };

interface Zoom {
  scale: number;
  x: number;
  y: number;
}

const TOOLS: { id: Tool; icon: string; label: string }[] = [
  { id: "pen", icon: "✏️", label: "펜" },
  { id: "line", icon: "📏", label: "직선" },
  { id: "rect", icon: "⬜", label: "네모" },
  { id: "ellipse", icon: "⚪", label: "원" },
  { id: "fill", icon: "🪣", label: "채우기" },
  { id: "eraser", icon: "🧽", label: "지우개" },
  { id: "select", icon: "👆", label: "선택·이동 (그린 선·도형을 옮기고 크기 조절)" },
];

/** Shift-drag makes a perfect square/circle. */
function constrainSquare(from: Point, to: Point): Point {
  const side = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  return clampToCanvas({ x: from.x + Math.sign(to.x - from.x || 1) * side, y: from.y + Math.sign(to.y - from.y || 1) * side });
}

/** Keeps the zoomed sheet covering its viewport (no empty margins). */
function clampZoom(z: Zoom, width: number, height: number): Zoom {
  const scale = Math.min(MAX_ZOOM, Math.max(1, z.scale));
  return { scale, x: Math.min(0, Math.max(width - width * scale, z.x)), y: Math.min(0, Math.max(height - height * scale, z.y)) };
}

interface DoodleCanvasProps {
  ref?: Ref<DoodleCanvasHandle>;
  disabled?: boolean;
  blind?: boolean;
  baseDrawing?: Drawing | null;
  onionDrawing?: Drawing | null;
  allowUndo?: boolean;
}

export default function DoodleCanvas({ ref, disabled = false, blind = false, baseDrawing = null, onionDrawing = null, allowUndo = true }: DoodleCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /** Where strokes are painted: the visible canvas, or an offscreen one in blind mode. */
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const previewCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  // Fixed for the lifetime of this editor (it is keyed per turn by its parent).
  const baseOpsRef = useRef<readonly DrawOp[]>(baseDrawing?.ops ?? []);
  /** This player's ops (the base layer excluded). Replaced, never mutated, so history can keep snapshots. */
  const opsRef = useRef<readonly DrawOp[]>([]);
  const undoStackRef = useRef<(readonly DrawOp[])[]>([]);
  const redoStackRef = useRef<(readonly DrawOp[])[]>([]);
  const gestureRef = useRef<Gesture | null>(null);
  const selectedRef = useRef<number | null>(null);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef<Zoom>({ scale: 1, x: 0, y: 0 });
  const touchesRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; mid: Point; start: Zoom } | null>(null);

  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState<ColorRef>(INK_COLOR);
  const [recentColors, setRecentColors] = useState<string[]>([]);
  /** Drawing tool to return to after a one-shot eyedropper pick. */
  const lastDrawingToolRef = useRef<Tool>("pen");
  const [size, setSize] = useState(1);
  const [opacity, setOpacity] = useState(MAX_OPACITY);
  const [filledShape, setFilledShape] = useState(false);
  // Mirrors of the refs that the toolbar renders from.
  const [history, setHistory] = useState({ undo: 0, redo: 0, ink: 0, count: 0 });
  /** The selected op's index and whether it has resize handles (shapes do, strokes don't). */
  const [selected, setSelected] = useState<{ index: number; resizable: boolean } | null>(null);
  /** Zoom level for the "원래대로" badge (the live value is in zoomRef). */
  const [zoomPercent, setZoomPercent] = useState(100);

  const currentDrawing = useCallback((extra: readonly DrawOp[] = []): Drawing => ({ v: 1, ops: [...baseOpsRef.current, ...opsRef.current, ...extra] }), []);

  const syncHistory = useCallback(() => {
    setHistory({ undo: undoStackRef.current.length, redo: redoStackRef.current.length, ink: serializedLength(currentDrawing()), count: opsRef.current.length });
  }, [currentDrawing]);

  /** Repaints the main layer, optionally leaving one of this player's ops out (it's being dragged on the preview layer). */
  const repaint = useCallback((liftedIndex: number | null = null) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const own = liftedIndex === null ? opsRef.current : opsRef.current.filter((_, i) => i !== liftedIndex);
    renderDrawing(ctx, { v: 1, ops: [...baseOpsRef.current, ...own] });
  }, []);

  const select = useCallback((index: number | null) => {
    selectedRef.current = index;
    const op = index === null ? undefined : opsRef.current[index];
    setSelected(op && index !== null ? { index, resizable: handlesFor(op).length > 0 } : null);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const visible = prepareContext(canvas, PIXEL_SCALE);
    if (visible) clearToPaper(visible);
    ctxRef.current = blind ? prepareContext(document.createElement("canvas"), PIXEL_SCALE) : visible;
    previewCtxRef.current = previewRef.current ? prepareContext(previewRef.current, PIXEL_SCALE) : null;
    repaint();
    syncHistory();
  }, [blind, repaint, syncHistory]);

  /** Replaces this player's op list, recording the previous one for undo. */
  const setOps = useCallback(
    (next: readonly DrawOp[]) => {
      undoStackRef.current = [...undoStackRef.current, opsRef.current].slice(-MAX_HISTORY);
      redoStackRef.current = [];
      opsRef.current = next;
      syncHistory();
    },
    [syncHistory],
  );

  const commitOp = useCallback((op: DrawOp) => setOps([...opsRef.current, op]), [setOps]);

  const travel = useCallback(
    (from: typeof undoStackRef, to: typeof undoStackRef) => {
      const previous = from.current[from.current.length - 1];
      if (!previous) return;
      from.current = from.current.slice(0, -1);
      to.current = [...to.current, opsRef.current];
      opsRef.current = previous;
      select(null);
      drawOverlay(null);
      repaint();
      syncHistory();
    },
    // drawOverlay only touches refs; see below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [repaint, select, syncHistory],
  );
  const undo = useCallback(() => travel(undoStackRef, redoStackRef), [travel]);
  const redo = useCallback(() => travel(redoStackRef, undoStackRef), [travel]);

  const clearAll = useCallback(() => {
    if (!ctxRef.current || opsRef.current.length === 0) return;
    const op: DrawOp = { k: "x" };
    renderOp(ctxRef.current, op);
    select(null);
    commitOp(op);
  }, [commitOp, select]);

  useImperativeHandle(ref, () => ({ getDrawing: () => currentDrawing() }), [currentDrawing]);

  useEffect(() => {
    if (disabled || !allowUndo) return;
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (!(e.ctrlKey || e.metaKey) || (key !== "z" && key !== "y")) return;
      e.preventDefault();
      if (key === "y" || e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled, allowUndo, undo, redo]);

  // Ctrl/⌘ + wheel zooms around the cursor on desktop (a passive React onWheel can't preventDefault).
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const z = zoomRef.current;
      const scale = z.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15);
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      applyZoom({ scale, x: mx - ((mx - z.x) / z.scale) * scale, y: my - ((my - z.y) / z.scale) * scale });
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, []);

  const inkLeft = MAX_DRAWING_CHARS - history.ink;
  const outOfInk = inkLeft < 200;
  /** Ops before the last "clear" are invisible — the select tool must not grab them. */
  const firstSelectable = () => opsRef.current.findLastIndex((op) => op.k === "x") + 1;

  function applyZoom(next: Zoom) {
    const viewport = viewportRef.current;
    const stage = stageRef.current;
    if (!viewport || !stage) return;
    const z = clampZoom(next, viewport.clientWidth, viewport.clientHeight);
    zoomRef.current = z;
    stage.style.transform = `translate(${z.x}px, ${z.y}px) scale(${z.scale})`;
    setZoomPercent(Math.round(z.scale * 100));
  }

  function toLogical(e: ReactPointerEvent<HTMLCanvasElement>): Point {
    // The rect is the canvas as currently shown, zoom transform included.
    const rect = e.currentTarget.getBoundingClientRect();
    return clampToCanvas({ x: ((e.clientX - rect.left) / rect.width) * CANVAS_W, y: ((e.clientY - rect.top) / rect.height) * CANVAS_H });
  }

  /** Selects a color; free (non-palette) colors are remembered as recents. Leaves eraser/eyedropper/select for the last drawing tool. */
  function chooseColor(next: ColorRef) {
    const normalized = normalizeColor(next);
    setColor(normalized);
    if (typeof normalized === "string") setRecentColors((list) => [normalized, ...list.filter((c) => c !== normalized)].slice(0, MAX_RECENT_COLORS));
    if (tool === "eraser" || tool === "picker" || tool === "select") chooseTool(lastDrawingToolRef.current);
  }

  function chooseTool(next: Tool) {
    if (next !== "eraser" && next !== "picker" && next !== "select") lastDrawingToolRef.current = next;
    if (next !== "select") {
      select(null);
      drawOverlay(null);
    }
    setTool(next);
  }

  /** Eyedropper: the pixel under the pointer on the real layer (the offscreen one in blind mode). */
  function pickColorAt(p: Point) {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const scale = ctx.getTransform().a || 1;
    const x = Math.min(ctx.canvas.width - 1, Math.floor(p.x * scale));
    const y = Math.min(ctx.canvas.height - 1, Math.floor(p.y * scale));
    const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
    chooseColor(rgbToHex(r, g, b));
  }

  function gestureToOp(gesture: Gesture): DrawOp {
    switch (gesture.kind) {
      case "stroke":
        return strokeOp(gesture.color, gesture.size, gesture.points, gesture.opacity);
      case "shape":
        return shapeOp(gesture.shape, gesture.color, gesture.size, gesture.from, gesture.to, { opacity: gesture.opacity, filled: gesture.filled });
      default:
        return gesture.current;
    }
  }

  /** Selection box + resize handles for `op`, drawn on the preview layer. */
  function drawSelectionFrame(pctx: CanvasRenderingContext2D, op: DrawOp) {
    const b = opBounds(op);
    if (!b) return;
    const pad = ("w" in op ? (BRUSH_SIZES[op.w] ?? 5) / 2 : 0) + 4;
    pctx.save();
    pctx.strokeStyle = "#d946ef";
    pctx.lineWidth = 1.5;
    pctx.setLineDash([6, 4]);
    pctx.strokeRect(b.minX - pad, b.minY - pad, b.maxX - b.minX + pad * 2, b.maxY - b.minY + pad * 2);
    pctx.setLineDash([]);
    for (const h of handlesFor(op)) {
      pctx.fillStyle = "#ffffff";
      pctx.fillRect(h.at.x - 5, h.at.y - 5, 10, 10);
      pctx.strokeRect(h.at.x - 5, h.at.y - 5, 10, 10);
    }
    pctx.restore();
  }

  /**
   * Redraws the preview layer: the gesture in progress (never in blind mode —
   * that's the point of it) and, with the select tool, the selection frame.
   */
  function drawOverlay(gesture: Gesture | null) {
    const pctx = previewCtxRef.current;
    if (!pctx) return;
    pctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    if (blind) return;
    if (gesture?.kind === "stroke") strokePath(pctx, gesture.color, gesture.size, gesture.points, gesture.opacity / 100);
    else if (gesture) renderOp(pctx, gestureToOp(gesture));
    const index = gesture && (gesture.kind === "move" || gesture.kind === "resize") ? gesture.index : selectedRef.current;
    if (index !== null && opsRef.current[index]) drawSelectionFrame(pctx, gesture && "current" in gesture ? gesture.current : opsRef.current[index]);
  }

  /** Bakes the gesture into the main layer (dropped if it would overflow the ink cap). */
  function finishGesture() {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    const ctx = ctxRef.current;
    if (!gesture || !ctx) {
      drawOverlay(null);
      return;
    }
    if (gesture.kind === "move" || gesture.kind === "resize") {
      if (gesture.current !== gesture.original) setOps(opsRef.current.map((op, i) => (i === gesture.index ? gesture.current : op)));
      repaint();
      drawOverlay(null);
      return;
    }
    drawOverlay(null);
    if (gesture.kind === "shape" && Math.abs(gesture.to.x - gesture.from.x) < MIN_SHAPE_SIZE && Math.abs(gesture.to.y - gesture.from.y) < MIN_SHAPE_SIZE) return;
    const op = gestureToOp(gesture);
    if (serializedLength(currentDrawing([op])) > MAX_DRAWING_CHARS) return;
    renderOp(ctx, op);
    commitOp(op);
  }

  /** A second finger turns the touch into a pinch: whatever the first finger started is thrown away. */
  function beginPinch() {
    const [a, b] = [...touchesRef.current.values()];
    if (!a || !b) return;
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (gesture && (gesture.kind === "move" || gesture.kind === "resize")) repaint();
    drawOverlay(null);
    const rect = viewportRef.current!.getBoundingClientRect();
    pinchRef.current = {
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      mid: { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top },
      start: zoomRef.current,
    };
  }

  function updatePinch() {
    const pinch = pinchRef.current;
    const [a, b] = [...touchesRef.current.values()];
    if (!pinch || !a || !b) return;
    const rect = viewportRef.current!.getBoundingClientRect();
    const scale = pinch.start.scale * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance);
    const mid = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
    // Keep the sheet point that was under the fingers' midpoint under it now (pinch + two-finger pan).
    const sheetX = (pinch.mid.x - pinch.start.x) / pinch.start.scale;
    const sheetY = (pinch.mid.y - pinch.start.y) / pinch.start.scale;
    applyZoom({ scale, x: mid.x - sheetX * scale, y: mid.y - sheetY * scale });
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === "touch") {
      touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touchesRef.current.size >= 2) {
        e.currentTarget.setPointerCapture(e.pointerId);
        beginPinch();
        return;
      }
    }
    if (pinchRef.current) return; // a finger left over from a pinch doesn't draw
    const ctx = ctxRef.current;
    if (disabled || !ctx || e.button > 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toLogical(e);

    if (tool === "select") {
      const current = selectedRef.current;
      const handle = current !== null && opsRef.current[current] ? handleAt(opsRef.current[current], p) : null;
      if (current !== null && handle) {
        gestureRef.current = { kind: "resize", index: current, handle, original: opsRef.current[current], current: opsRef.current[current] };
      } else {
        const hit = hitTest(opsRef.current, p, firstSelectable());
        select(hit >= 0 ? hit : null);
        if (hit < 0) {
          drawOverlay(null);
          return;
        }
        gestureRef.current = { kind: "move", index: hit, start: p, original: opsRef.current[hit], current: opsRef.current[hit] };
      }
      // Lift the op off the main layer while it's dragged on the preview layer.
      repaint(gestureRef.current.index);
      drawOverlay(gestureRef.current);
      return;
    }

    if (outOfInk) return;
    const sound = getDoodlePhoneSound();
    sound.unlock();
    sound.drawTick();
    if (tool === "picker") {
      pickColorAt(p);
      return;
    }
    if (tool === "fill") {
      const op = fillOp(color, p, opacity);
      renderOp(ctx, op);
      commitOp(op);
      return;
    }
    const shape = SHAPE_OF[tool];
    gestureRef.current = shape
      ? { kind: "shape", shape, from: p, to: p, color, size, opacity, filled: filledShape }
      : { kind: "stroke", points: [p], color: tool === "eraser" ? PAPER_COLOR : color, size, opacity: tool === "eraser" ? MAX_OPACITY : opacity };
    drawOverlay(gestureRef.current);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === "touch" && touchesRef.current.has(e.pointerId)) {
      touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinchRef.current) {
        updatePinch();
        return;
      }
    }
    const gesture = gestureRef.current;
    if (!gesture) return;
    const p = toLogical(e);
    switch (gesture.kind) {
      case "move":
        gesture.current = translateOp(gesture.original, p.x - gesture.start.x, p.y - gesture.start.y);
        drawOverlay(gesture);
        return;
      case "resize":
        gesture.current = resizeShape(gesture.original, gesture.handle, p);
        drawOverlay(gesture);
        return;
      case "shape":
        gesture.to = e.shiftKey && gesture.shape !== "l" ? constrainSquare(gesture.from, p) : p;
        drawOverlay(gesture);
        return;
      case "stroke": {
        const last = gesture.points[gesture.points.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) < MIN_POINT_GAP) return;
        gesture.points.push(p);
        drawOverlay(gesture);
        getDoodlePhoneSound().drawTick(); // self-throttled to one tick per 120ms
        const projected = history.ink + gesture.points.length * CHARS_PER_POINT;
        if (projected > MAX_DRAWING_CHARS) {
          finishGesture();
        } else if (gesture.points.length >= MAX_POINTS_PER_STROKE) {
          finishGesture();
          gestureRef.current = { ...gesture, points: [p] };
        }
      }
    }
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === "touch") {
      touchesRef.current.delete(e.pointerId);
      if (pinchRef.current) {
        if (touchesRef.current.size === 0) pinchRef.current = null;
        return;
      }
    }
    finishGesture();
  }

  function deleteSelected() {
    const index = selectedRef.current;
    if (index === null) return;
    select(null);
    setOps(opsRef.current.filter((_, i) => i !== index));
    repaint();
    drawOverlay(null);
  }

  const toolButton = "flex h-9 w-7 shrink-0 items-center justify-center rounded-lg border text-sm transition disabled:opacity-40 sm:w-9";
  const idle = "border-white/10 bg-white/5 text-white/80 hover:border-white/30 light:border-slate-200 light:bg-white light:text-slate-700";
  const active = "border-fuchsia-400 bg-fuchsia-500/25 text-white light:bg-fuchsia-50 light:text-fuchsia-800";
  const tools = blind ? TOOLS.filter((t) => t.id !== "select") : TOOLS;

  return (
    <div className="flex flex-col gap-2">
      <div ref={viewportRef} className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-white shadow-lg ring-2 ring-fuchsia-400/40">
        <div ref={stageRef} className="absolute inset-0 origin-top-left">
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className={`block h-full w-full touch-none select-none ${
              disabled ? "cursor-not-allowed opacity-80" : tool === "fill" || tool === "picker" ? "cursor-cell" : tool === "select" ? "cursor-move" : "cursor-crosshair"
            }`}
            aria-label="그림판"
          />
          <canvas ref={previewRef} className="pointer-events-none absolute inset-0 block h-full w-full" aria-hidden />
          {onionDrawing && (
            <div className="pointer-events-none absolute inset-0 mix-blend-multiply grayscale" style={{ opacity: ONION_OPACITY }} aria-hidden>
              <DrawingView drawing={onionDrawing} label="이전 프레임 잔상" className="rounded-none shadow-none ring-0" />
            </div>
          )}
        </div>
        {blind && (
          <p className="pointer-events-none absolute top-3 left-3 rounded-full bg-rose-500/90 px-3 py-1 text-xs font-bold text-white shadow">
            🙈 비밀 모드 — 그린 선이 화면에 보이지 않아요
          </p>
        )}
        {zoomPercent > 100 && (
          <button
            type="button"
            onClick={() => applyZoom({ scale: 1, x: 0, y: 0 })}
            className="absolute right-2 bottom-2 rounded-full bg-slate-900/80 px-3 py-1 text-xs font-bold text-white shadow"
          >
            🔍 {zoomPercent}% · 원래대로
          </button>
        )}
      </div>

      {!disabled && (
        <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/20 p-2 light:border-slate-200 light:bg-slate-50">
          <div className="flex flex-nowrap items-center gap-0.5 overflow-x-auto [scrollbar-width:none] sm:gap-1.5 [&::-webkit-scrollbar]:hidden">
            {tools.map((t) => (
              <button key={t.id} type="button" title={t.label} aria-label={t.label} aria-pressed={tool === t.id} onClick={() => chooseTool(t.id)} className={`${toolButton} ${tool === t.id ? active : idle}`}>
                {t.icon}
              </button>
            ))}
            <span className="mx-0.5 hidden h-6 w-px shrink-0 bg-white/10 sm:block light:bg-slate-200" />
            {allowUndo && (
              <>
                <button type="button" title="되돌리기 (Ctrl+Z)" aria-label="되돌리기" onClick={undo} disabled={history.undo === 0} className={`${toolButton} ${idle}`}>
                  ↶
                </button>
                <button type="button" title="다시하기 (Ctrl+Y)" aria-label="다시하기" onClick={redo} disabled={history.redo === 0} className={`${toolButton} ${idle}`}>
                  ↷
                </button>
              </>
            )}
            {!baseDrawing?.ops.length && (
              <button type="button" title="전체 지우기" aria-label="전체 지우기" onClick={clearAll} disabled={history.count === 0} className={`${toolButton} ${idle}`}>
                🗑️
              </button>
            )}
            <span className="mx-0.5 hidden h-6 w-px shrink-0 bg-white/10 sm:block light:bg-slate-200" />
            {/* Phones: one button cycling through the sizes keeps the row to a single line. */}
            <span className="shrink-0 sm:hidden">
              <button
                type="button"
                title={`굵기 ${size + 1}/${BRUSH_SIZES.length} (눌러서 바꾸기)`}
                aria-label={`굵기 ${size + 1}, 눌러서 바꾸기`}
                onClick={() => setSize((i) => (i + 1) % BRUSH_SIZES.length)}
                className={`${toolButton} ${active}`}
              >
                <BrushDot px={BRUSH_SIZES[size]} />
              </button>
            </span>
            <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
              {BRUSH_SIZES.map((px, i) => (
                <button key={px} type="button" title={`굵기 ${i + 1}`} aria-label={`굵기 ${i + 1}`} aria-pressed={size === i} onClick={() => setSize(i)} className={`${toolButton} ${size === i ? active : idle}`}>
                  <BrushDot px={px} />
                </button>
              ))}
            </span>
          </div>

          {tool === "select" ? (
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/60 light:text-slate-500">
              {selected === null ? (
                <span>👆 옮기거나 크기를 바꿀 선·도형을 누르세요. 도형은 모서리 □를 끌면 크기가 바뀌어요.</span>
              ) : (
                <>
                  <span className="text-fuchsia-200 light:text-fuchsia-700">선택됨 — 끌어서 옮기기{selected.resizable && " · □ 끌어서 크기 조절"}</span>
                  <button type="button" onClick={deleteSelected} className={`rounded-md border px-2 py-0.5 ${idle}`}>
                    🗑 선택한 것 지우기
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      select(null);
                      drawOverlay(null);
                    }}
                    className={`rounded-md border px-2 py-0.5 ${idle}`}
                  >
                    선택 해제
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/60 light:text-slate-500">
              <span className="whitespace-nowrap">🌫️ 농도 {opacity}%</span>
              <input
                type="range"
                min={MIN_OPACITY}
                max={MAX_OPACITY}
                step={5}
                value={opacity}
                disabled={tool === "eraser"}
                onChange={(e) => setOpacity(Number(e.target.value))}
                className="min-w-24 flex-1 accent-fuchsia-500 disabled:opacity-40"
                aria-label="농도"
              />
              {(
                [
                  [LIGHT_OPACITY, "연하게"],
                  [MAX_OPACITY, "짙게"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={opacity === value}
                  disabled={tool === "eraser"}
                  onClick={() => setOpacity(value)}
                  className={`rounded-md border px-2 py-0.5 transition disabled:opacity-40 ${opacity === value ? active : idle}`}
                >
                  {label}
                </button>
              ))}
              {(tool === "rect" || tool === "ellipse") && (
                <label className="flex items-center gap-1 whitespace-nowrap text-white/80 light:text-slate-700">
                  <input type="checkbox" checked={filledShape} onChange={(e) => setFilledShape(e.target.checked)} className="accent-fuchsia-500" />
                  도형 속 채우기
                </label>
              )}
              {SHAPE_OF[tool] && tool !== "line" && <span className="text-white/40 light:text-slate-400">Shift = 정사각형·정원</span>}
            </div>
          )}

          <div className="grid grid-cols-10 gap-1">
            {PALETTE.map((hex, i) => (
              <button
                key={hex}
                type="button"
                title={i === PAPER_COLOR ? "흰색" : hex}
                aria-pressed={color === i}
                onClick={() => chooseColor(i)}
                className={`aspect-square rounded-md border transition ${color === i ? "scale-110 border-fuchsia-300 ring-2 ring-fuchsia-400" : "border-black/20 hover:scale-105"}`}
                style={{ backgroundColor: hex }}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-white/60 light:text-slate-500">
            <label
              title="팔레트 밖의 색 직접 고르기"
              className="relative flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-white/15 px-2 hover:border-white/30 light:border-slate-300"
            >
              <span className="h-4 w-4 rounded-sm border border-black/20" style={{ backgroundColor: colorHex(color) }} />
              🎨 직접 고르기
              <input type="color" value={colorHex(color)} onChange={(e) => chooseColor(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="색 직접 고르기" />
            </label>
            <button
              type="button"
              title="스포이드 (그림에서 색 가져오기)"
              aria-label="스포이드 (그림에서 색 가져오기)"
              aria-pressed={tool === "picker"}
              onClick={() => chooseTool("picker")}
              className={`flex h-8 items-center gap-1 rounded-md border px-2 ${tool === "picker" ? active : idle}`}
            >
              💧 스포이드
            </button>
            {recentColors.map((hex) => (
              <button
                key={hex}
                type="button"
                title={hex}
                aria-label={`최근 색 ${hex}`}
                aria-pressed={color === hex}
                onClick={() => chooseColor(hex)}
                className={`h-7 w-7 rounded-md border transition ${color === hex ? "scale-110 border-fuchsia-300 ring-2 ring-fuchsia-400" : "border-black/20 hover:scale-105"}`}
                style={{ backgroundColor: hex }}
              />
            ))}
            {tool === "picker" && <span className="text-fuchsia-200 light:text-fuchsia-700">💧 그림을 눌러 그 색을 가져와요</span>}
          </div>

          <div className="flex items-center gap-2 text-[11px] text-white/50 light:text-slate-500">
            <span>🖋️ 잉크</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
              <div
                className={`h-full rounded-full transition-all ${inkLeft < MAX_DRAWING_CHARS * 0.15 ? "bg-rose-400" : "bg-fuchsia-400"}`}
                style={{ width: `${Math.max(0, (inkLeft / MAX_DRAWING_CHARS) * 100)}%` }}
              />
            </div>
            {outOfInk && <span className="font-semibold text-rose-300 light:text-rose-600">잉크가 다 떨어졌어요 — 되돌리기로 공간을 만들 수 있어요</span>}
          </div>
          <p className="text-[10px] text-white/35 light:text-slate-400">📱 두 손가락으로 확대·이동 · 🖱️ Ctrl+휠로 확대</p>
        </div>
      )}
    </div>
  );
}

function BrushDot({ px }: { px: number }) {
  const d = Math.min(22, px * 0.75 + 2);
  return <span className="rounded-full bg-current" style={{ width: d, height: d }} />;
}
