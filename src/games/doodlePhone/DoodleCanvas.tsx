"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref } from "react";
import {
  BRUSH_SIZES,
  CANVAS_H,
  CANVAS_W,
  INK_COLOR,
  MAX_DRAWING_CHARS,
  PALETTE,
  PAPER_COLOR,
  clampToCanvas,
  serializedLength,
  strokeOp,
  type DrawOp,
  type Drawing,
  type Point,
} from "./drawing";
import { getDoodlePhoneSound } from "./doodlePhoneSound";
import DrawingView from "./DrawingView";
import { ONION_OPACITY } from "./modes";
import { clearToPaper, prepareContext, renderDrawing, renderOp, strokePath } from "./drawingRenderer";

/**
 * Drawing editor (rulebook §4): pen, eraser, paint bucket, undo/redo, clear,
 * 5 brush sizes, 20 colors, and an ink gauge for the per-drawing size cap.
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

type Tool = "pen" | "eraser" | "fill";

const PIXEL_SCALE = 2;
/** Skip pointer samples closer than this (logical px) — keeps payloads small without visible loss. */
const MIN_POINT_GAP = 1.5;
/** Long strokes are split so one op never grows unbounded. */
const MAX_POINTS_PER_STROKE = 400;
/** Rough JSON cost of one stroke point, used to stop a stroke before it overflows the ink cap. */
const CHARS_PER_POINT = 8;

const TOOLS: { id: Tool; icon: string; label: string }[] = [
  { id: "pen", icon: "✏️", label: "펜" },
  { id: "eraser", icon: "🧽", label: "지우개" },
  { id: "fill", icon: "🪣", label: "채우기" },
];

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
  const strokeRef = useRef<{ points: Point[]; color: number; size: number } | null>(null);

  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(INK_COLOR);
  const [size, setSize] = useState(1);
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

  function finishStroke() {
    const stroke = strokeRef.current;
    strokeRef.current = null;
    if (!stroke) return;
    const op = strokeOp(stroke.color, stroke.size, stroke.points);
    if (serializedLength(currentDrawing([op])) > MAX_DRAWING_CHARS) {
      repaint(); // drop the overflowing stroke from the screen too
      return;
    }
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
    if (tool === "fill") {
      const op: DrawOp = { k: "f", c: color, x: p.x, y: p.y };
      renderOp(ctx, op);
      commitOp(op);
      return;
    }
    const strokeColor = tool === "eraser" ? PAPER_COLOR : color;
    strokeRef.current = { points: [p], color: strokeColor, size };
    strokePath(ctx, strokeColor, size, [p]);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    const stroke = strokeRef.current;
    const ctx = ctxRef.current;
    if (!stroke || !ctx) return;
    const p = toLogical(e);
    const last = stroke.points[stroke.points.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < MIN_POINT_GAP) return;
    stroke.points.push(p);
    strokePath(ctx, stroke.color, stroke.size, [last, p]);
    getDoodlePhoneSound().drawTick(); // self-throttled to one tick per 120ms
    const projected = history.ink + stroke.points.length * CHARS_PER_POINT;
    if (projected > MAX_DRAWING_CHARS) {
      finishStroke();
    } else if (stroke.points.length >= MAX_POINTS_PER_STROKE) {
      finishStroke();
      strokeRef.current = { points: [p], color: stroke.color, size: stroke.size };
    }
  }

  const toolButton = "flex h-9 min-w-9 items-center justify-center rounded-lg border px-2 text-sm transition disabled:opacity-40";
  const idle = "border-white/10 bg-white/5 text-white/80 hover:border-white/30 light:border-slate-200 light:bg-white light:text-slate-700";
  const active = "border-fuchsia-400 bg-fuchsia-500/25 text-white light:bg-fuchsia-50 light:text-fuchsia-800";

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishStroke}
        onPointerCancel={finishStroke}
        className={`block aspect-[4/3] w-full touch-none rounded-xl bg-white shadow-lg ring-2 ring-fuchsia-400/40 select-none ${
          disabled ? "cursor-not-allowed opacity-80" : tool === "fill" ? "cursor-cell" : "cursor-crosshair"
        }`}
        aria-label="그림판"
      />
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
          <div className="flex flex-wrap items-center gap-1.5">
            {TOOLS.map((t) => (
              <button key={t.id} type="button" title={t.label} aria-pressed={tool === t.id} onClick={() => setTool(t.id)} className={`${toolButton} ${tool === t.id ? active : idle}`}>
                {t.icon}
                <span className="ml-1 hidden text-xs sm:inline">{t.label}</span>
              </button>
            ))}
            <span className="mx-1 h-6 w-px bg-white/10 light:bg-slate-200" />
            {allowUndo && (
              <>
                <button type="button" title="되돌리기 (Ctrl+Z)" onClick={undo} disabled={history.undo === 0} className={`${toolButton} ${idle}`}>
                  ↶
                </button>
                <button type="button" title="다시하기 (Ctrl+Y)" onClick={redo} disabled={history.redo === 0} className={`${toolButton} ${idle}`}>
                  ↷
                </button>
              </>
            )}
            {!baseDrawing?.ops.length && (
              <button type="button" title="전체 지우기" onClick={clearAll} disabled={history.undo === 0} className={`${toolButton} ${idle}`}>
                🗑️
              </button>
            )}
            <span className="mx-1 h-6 w-px bg-white/10 light:bg-slate-200" />
            {BRUSH_SIZES.map((px, i) => (
              <button key={px} type="button" title={`굵기 ${i + 1}`} aria-pressed={size === i} onClick={() => setSize(i)} className={`${toolButton} w-9 ${size === i ? active : idle}`}>
                <span className="rounded-full bg-current" style={{ width: Math.min(22, px * 0.75 + 2), height: Math.min(22, px * 0.75 + 2) }} />
              </button>
            ))}
          </div>

          <div className="grid grid-cols-10 gap-1">
            {PALETTE.map((hex, i) => (
              <button
                key={hex}
                type="button"
                title={i === PAPER_COLOR ? "흰색" : hex}
                aria-pressed={color === i}
                onClick={() => {
                  setColor(i);
                  if (tool === "eraser") setTool("pen");
                }}
                className={`aspect-square rounded-md border transition ${color === i ? "scale-110 border-fuchsia-300 ring-2 ring-fuchsia-400" : "border-black/20 hover:scale-105"}`}
                style={{ backgroundColor: hex }}
              />
            ))}
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
