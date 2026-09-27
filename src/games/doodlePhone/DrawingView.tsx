"use client";

import { useEffect, useRef } from "react";
import type { Drawing } from "./drawing";
import { createDrawingAnimator, prepareContext, renderDrawing } from "./drawingRenderer";

/**
 * Read-only drawing. With `animateMs` it replays the strokes in order over
 * that duration (the showcase "그리는 과정" reveal); otherwise it renders the
 * finished picture once.
 */
export default function DrawingView({
  drawing,
  animateMs = 0,
  className = "",
  label = "그림",
}: {
  drawing: Drawing;
  animateMs?: number;
  className?: string;
  label?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = prepareContext(canvas, 2);
    if (!ctx) return;
    if (animateMs <= 0) {
      renderDrawing(ctx, drawing);
      return;
    }
    let frame = 0;
    const startedAt = performance.now();
    const advance = createDrawingAnimator(ctx, drawing);
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / animateMs);
      advance(progress);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [drawing, animateMs]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      className={`block aspect-[4/3] w-full rounded-xl bg-white shadow-inner ring-1 ring-black/10 ${className}`}
    />
  );
}
