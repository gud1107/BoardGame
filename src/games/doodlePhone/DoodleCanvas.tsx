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
  type ShapeKind,
  type DrawOp,
  type Drawing,
  type Point,
} from "./drawing";
import { getDoodlePhoneSound } from "./doodlePhoneSound";
import DrawingView from "./DrawingView";
import { ONION_OPACITY } from "./modes";
import { clearToPaper, prepareContext, renderDrawing, renderOp, strokePath } from "./drawingRenderer";

/**
 * Drawing editor (rulebook §4): pen, straight line, rectangle, ellipse
 * (outline or filled), paint bucket, eraser, undo/redo, clear, 5 brush sizes,
 * 20 colors plus a free color picker and an eyedropper, an opacity slider
 * ("연하게 ↔ 짙게") and an ink gauge for the per-drawing size cap. The tool
 * row is a single line: icon-only buttons with tooltips, and on phones the
 * five brush sizes collapse into one button that cycles through them.
 *
 * Two layers: the gesture in progress — a pen stroke or a shape being dragged
 * — is drawn on a transparent preview canvas on top and only baked into the
 * main canvas on release. That keeps a dragged shape from smearing the
 * picture underneath, and lets a translucent stroke be stroked as one path
 * (segment-by-segment painting would darken every joint).
 *
 * Mode features (modes.ts):
 * - `blind` (비밀): strokes are painted to an offscreen canvas — the real
 *   pixels still exist, so the paint bucket keeps working — while the
 *   visible sheet stays blank.
 * - `baseDrawing` (보완): the previous player's picture is a locked first
 *   layer; undo never reaches below it and "전체 지우기" is hidden. The
 *   result is base ops + your ops, so the ink gauge shows what's left for the
 *   whole shared sheet.
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

type Tool = "pen" | "line" | "rect" | "ellipse" | "fill" | "eraser" | "picker";

/** How many recently picked free colors stay one tap away. */
const MAX_RECENT_COLORS = 6;

const SHAPE_OF: Partial<Record<Tool, ShapeKind>> = { line: "l", rect: "r", ellipse: "e" };
/** "연하게" preset — sketch/underdrawing strength. */
const LIGHT_OPACITY = 25;
/** A drag shorter than this (logical px) is treated as a stray click, not a shape. */
const MIN_SHAPE_SIZE = 2;

type Gesture =
  | { kind: "stroke"; points: Point[]; color: ColorRef; size: number; opacity: number }
  | { kind: "shape"; shape: ShapeKind; from: Point; to: Point; color: ColorRef; size: number; opacity: number; filled: boolean };

const PIXEL_SCALE = 2;
/** Skip pointer samples closer than this (logical px) — keeps payloads small without visible loss. */
const MIN_POINT_GAP = 1.5;
/** Long strokes are split so one op never grows unbounded. */
const MAX_POINTS_PER_STROKE = 400;
/** Rough JSON cost of one stroke point, used to stop a stroke before it overflows the ink cap. */
const CHARS_PER_POINT = 8;

const TOOLS: { id: Tool; icon: string; label: string }[] = [
  { id: "pen", icon: "✏️", label: "펜" },
  { id: "line", icon: "📏", label: "직선" },
  { id: "rect", icon: "⬜", label: "네모" },
  { id: "ellipse", icon: "⚪", label: "원" },
  { id: "fill", icon: "🪣", label: "채우기" },
  { id: "eraser", icon: "🧽", label: "지우개" },
  { id: "picker", icon: "💧", label: "스포이드 (그림에서 색 가져오기)" },
];

/** Shift-drag makes a perfect square/circle. */
function constrainSquare(from: Point, to: Point): Point {
  const side = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  return clampToCanvas({ x: from.x + Math.sign(to.x - from.x || 1) * side, y: from.y + Math.sign(to.y - from.y || 1) * side });
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
  // Fixed for the lifetime of this editor (it is keyed per turn by its parent).
  const baseOpsRef = useRef<readonly DrawOp[]>(baseDrawing?.ops ?? []);
  const opsRef = useRef<DrawOp[]>([]);
  const redoRef = useRef<DrawOp[]>([]);
  const gestureRef = useRef<Gesture | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const previewCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState<ColorRef>(INK_COLOR);
  const [recentColors, setRecentColors] = useState<string[]>([]);
  /** Drawing tool to return to after a one-shot eyedropper pick. */
  const lastDrawingToolRef = useRef<Tool>("pen");
  const [size, setSize] = useState(1);
  const [opacity, setOpacity] = useState(MAX_OPACITY);
  const [filledShape, setFilledShape] = useState(false);
  // Mirrors of the op refs that the toolbar renders from.
  const [history, setHistory] = useState({ undo: 0, redo: 0, ink: 0 });

  const currentDrawing = useCallback((extra: readonly DrawOp[] = []): Drawing => ({ v: 1, ops: [...baseOpsRef.current, ...opsRef.current, ...extra] }), []);

  const syncHistory = useCallback(() => {
    setHistory({ undo: opsRef.current.length, redo: redoRef.current.length, ink: serializedLength(currentDrawing()) });
  }, [currentDrawing]);

  const repaint = useCallback(() => {
    const ctx = ctxRef.current;
    if (ctx) renderDrawing(ctx, currentDrawing());
  }, [currentDrawing]);

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

  const commitOp = useCallback(
    (op: DrawOp) => {
      opsRef.current.push(op);
      redoRef.current = [];
      syncHistory();
    },
    [syncHistory],
  );

  const undo = useCallback(() => {
    const op = opsRef.current.pop();
    if (!op) return;
    redoRef.current.push(op);
    repaint();
    syncHistory();
  }, [repaint, syncHistory]);

  const redo = useCallback(() => {
    const op = redoRef.current.pop();
    if (!op || !ctxRef.current) return;
    opsRef.current.push(op);
    renderOp(ctxRef.current, op);
    syncHistory();
  }, [syncHistory]);

  const clearAll = useCallback(() => {
    if (!ctxRef.current || opsRef.current.length === 0) return;
    const op: DrawOp = { k: "x" };
    renderOp(ctxRef.current, op);
    commitOp(op);
  }, [commitOp]);

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

  const inkLeft = MAX_DRAWING_CHARS - history.ink;
  const outOfInk = inkLeft < 200;

  function toLogical(e: ReactPointerEvent<HTMLCanvasElement>): Point {
    const rect = e.currentTarget.getBoundingClientRect();
    return clampToCanvas({ x: ((e.clientX - rect.left) / rect.width) * CANVAS_W, y: ((e.clientY - rect.top) / rect.height) * CANVAS_H });
  }

  /** Selects a color; free (non-palette) colors are remembered as recents. Leaves eraser/eyedropper for the last drawing tool. */
  function chooseColor(next: ColorRef) {
    const normalized = normalizeColor(next);
    setColor(normalized);
    if (typeof normalized === "string") setRecentColors((list) => [normalized, ...list.filter((c) => c !== normalized)].slice(0, MAX_RECENT_COLORS));
    if (tool === "eraser" || tool === "picker") setTool(lastDrawingToolRef.current);
  }

  function chooseTool(next: Tool) {
    if (next !== "eraser" && next !== "picker") lastDrawingToolRef.current = next;
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

  /** Redraws the in-progress gesture on the preview layer (nothing in blind mode — that's the point of it). */
  function drawPreview(gesture: Gesture | null) {
    const pctx = previewCtxRef.current;
    if (!pctx) return;
    pctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    if (!gesture || blind) return;
    if (gesture.kind === "stroke") strokePath(pctx, gesture.color, gesture.size, gesture.points, gesture.opacity / 100);
    else renderOp(pctx, gestureToOp(gesture));
  }

  function gestureToOp(gesture: Gesture): DrawOp {
    return gesture.kind === "stroke"
      ? strokeOp(gesture.color, gesture.size, gesture.points, gesture.opacity)
      : shapeOp(gesture.shape, gesture.color, gesture.size, gesture.from, gesture.to, { opacity: gesture.opacity, filled: gesture.filled });
  }

  /** Bakes the gesture into the main layer as one op (dropped if it would overflow the ink cap). */
  function finishGesture() {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    drawPreview(null);
    const ctx = ctxRef.current;
    if (!gesture || !ctx) return;
    if (gesture.kind === "shape" && Math.abs(gesture.to.x - gesture.from.x) < MIN_SHAPE_SIZE && Math.abs(gesture.to.y - gesture.from.y) < MIN_SHAPE_SIZE) return;
    const op = gestureToOp(gesture);
    if (serializedLength(currentDrawing([op])) > MAX_DRAWING_CHARS) return;
    renderOp(ctx, op);
    commitOp(op);
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    const ctx = ctxRef.current;
    if (disabled || outOfInk || !ctx || e.button > 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const sound = getDoodlePhoneSound();
    sound.unlock();
    sound.drawTick();
    const p = toLogical(e);
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
    drawPreview(gestureRef.current);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const p = toLogical(e);
    if (gesture.kind === "shape") {
      gesture.to = e.shiftKey && gesture.shape !== "l" ? constrainSquare(gesture.from, p) : p;
      drawPreview(gesture);
      return;
    }
    const last = gesture.points[gesture.points.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < MIN_POINT_GAP) return;
    gesture.points.push(p);
    drawPreview(gesture);
    getDoodlePhoneSound().drawTick(); // self-throttled to one tick per 120ms
    const projected = history.ink + gesture.points.length * CHARS_PER_POINT;
    if (projected > MAX_DRAWING_CHARS) {
      finishGesture();
    } else if (gesture.points.length >= MAX_POINTS_PER_STROKE) {
      finishGesture();
      gestureRef.current = { ...gesture, points: [p] };
    }
  }

  const toolButton = "flex h-9 w-7 shrink-0 items-center justify-center rounded-lg border text-sm transition disabled:opacity-40 sm:w-9";
  const idle = "border-white/10 bg-white/5 text-white/80 hover:border-white/30 light:border-slate-200 light:bg-white light:text-slate-700";
  const active = "border-fuchsia-400 bg-fuchsia-500/25 text-white light:bg-fuchsia-50 light:text-fuchsia-800";

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishGesture}
        onPointerCancel={finishGesture}
        className={`block aspect-[4/3] w-full touch-none rounded-xl bg-white shadow-lg ring-2 ring-fuchsia-400/40 select-none ${
          disabled ? "cursor-not-allowed opacity-80" : tool === "fill" || tool === "picker" ? "cursor-cell" : "cursor-crosshair"
        }`}
        aria-label="그림판"
      />
      <canvas ref={previewRef} className="pointer-events-none absolute inset-0 block aspect-[4/3] w-full rounded-xl" aria-hidden />
      {onionDrawing && (
        <div className="pointer-events-none absolute inset-0 mix-blend-multiply grayscale" style={{ opacity: ONION_OPACITY }} aria-hidden>
          <DrawingView drawing={onionDrawing} label="이전 프레임 잔상" className="shadow-none ring-0" />
        </div>
      )}
      {blind && (
        <p className="pointer-events-none absolute top-3 left-3 rounded-full bg-rose-500/90 px-3 py-1 text-xs font-bold text-white shadow">
          🙈 비밀 모드 — 그린 선이 화면에 보이지 않아요
        </p>
      )}
      </div>

      {!disabled && (
        <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/20 p-2 light:border-slate-200 light:bg-slate-50">
          <div className="flex flex-nowrap items-center gap-0.5 overflow-x-auto [scrollbar-width:none] sm:gap-1.5 [&::-webkit-scrollbar]:hidden">
            {TOOLS.map((t) => (
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
              <button type="button" title="전체 지우기" aria-label="전체 지우기" onClick={clearAll} disabled={history.undo === 0} className={`${toolButton} ${idle}`}>
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
        </div>
      )}
    </div>
  );
}

function BrushDot({ px }: { px: number }) {
  const d = Math.min(22, px * 0.75 + 2);
  return <span className="rounded-full bg-current" style={{ width: d, height: d }} />;
}
