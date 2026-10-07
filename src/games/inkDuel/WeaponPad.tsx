"use client";

import { useEffect, useRef } from "react";
import { INK_COLORS, MAX_POINTS_PER_STROKE, MAX_STROKES, PAD_SIZE, strokeInk, totalInk, type InkColor, type Stroke } from "./analyze";

interface Props {
  strokes: Stroke[];
  color: InkColor;
  budget: number;
  disabled?: boolean;
  onChange: (strokes: Stroke[]) => void;
  onScribble?: () => void;
}

function draw(ctx: CanvasRenderingContext2D, strokes: readonly Stroke[], live: Stroke | null) {
  ctx.fillStyle = "#fffdf6";
  ctx.fillRect(0, 0, PAD_SIZE, PAD_SIZE);
  ctx.strokeStyle = "rgba(96, 140, 210, 0.22)";
  ctx.lineWidth = 1;
  for (let y = 20; y < PAD_SIZE; y += 20) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(PAD_SIZE, y);
    ctx.stroke();
  }
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of live ? [...strokes, live] : strokes) {
    ctx.strokeStyle = INK_COLORS[s.c];
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(s.p[0], s.p[1]);
    if (s.p.length === 2) ctx.lineTo(s.p[0] + 0.1, s.p[1]);
    for (let i = 2; i < s.p.length; i += 2) ctx.lineTo(s.p[i], s.p[i + 1]);
    ctx.stroke();
  }
}

/** Square doodle pad (PAD_SIZE logical px) with a hard ink limit. */
export default function WeaponPad({ strokes, color, budget, disabled, onChange, onScribble }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveRef = useRef<Stroke | null>(null);
  const lastTickRef = useRef(0);

  const redraw = () => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, strokes, liveRef.current);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== PAD_SIZE * dpr) {
      canvas.width = PAD_SIZE * dpr;
      canvas.height = PAD_SIZE * dpr;
    }
    redraw();
  });

  /**
   * Pointer → pad coordinates. Measured against the canvas *content box*:
   * the dashed 2px border is part of getBoundingClientRect, and mapping
   * against the border box shifted strokes a few pixels up/down and
   * stretched them (the reported "그리면 살짝 위/아래로 그려져요").
   */
  function toPad(canvas: HTMLCanvasElement, clientX: number, clientY: number): [number, number] {
    const rect = canvas.getBoundingClientRect();
    const left = rect.left + canvas.clientLeft;
    const top = rect.top + canvas.clientTop;
    const x = Math.round(((clientX - left) / canvas.clientWidth) * PAD_SIZE);
    const y = Math.round(((clientY - top) / canvas.clientHeight) * PAD_SIZE);
    return [Math.max(0, Math.min(PAD_SIZE, x)), Math.max(0, Math.min(PAD_SIZE, y))];
  }

  function addPoint(live: Stroke, x: number, y: number): boolean {
    const lx = live.p[live.p.length - 2];
    const ly = live.p[live.p.length - 1];
    if ((x - lx) * (x - lx) + (y - ly) * (y - ly) < 4 || live.p.length >= MAX_POINTS_PER_STROKE * 2) return false;
    const candidate = { c: live.c, p: [...live.p, x, y] };
    if (totalInk(strokes) + strokeInk(candidate) > budget) return false;
    live.p.push(x, y);
    return true;
  }

  return (
    <canvas
      ref={canvasRef}
      className={`aspect-square w-full touch-none select-none rounded-lg border-2 border-dashed ${disabled ? "border-slate-400/40 opacity-60" : "border-slate-500/60"}`}
      onPointerDown={(e) => {
        if (disabled || strokes.length >= MAX_STROKES) return;
        if (totalInk(strokes) + 2 > budget) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const [x, y] = toPad(e.currentTarget, e.clientX, e.clientY);
        liveRef.current = { c: color, p: [x, y] };
        redraw();
      }}
      onPointerMove={(e) => {
        const live = liveRef.current;
        if (!live) return;
        // Coalesced events keep fast strokes smooth (browsers batch moves per frame).
        const native = e.nativeEvent;
        const samples = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
        let added = false;
        for (const ev of samples.length > 0 ? samples : [native]) {
          const [x, y] = toPad(e.currentTarget, ev.clientX, ev.clientY);
          if (addPoint(live, x, y)) added = true;
        }
        if (!added) return;
        const now = performance.now();
        if (onScribble && now - lastTickRef.current > 90) {
          lastTickRef.current = now;
          onScribble();
        }
        redraw();
      }}
      onPointerUp={() => {
        const live = liveRef.current;
        liveRef.current = null;
        if (!live) return;
        const p = live.p.length === 2 ? [...live.p, live.p[0], live.p[1]] : live.p;
        onChange([...strokes, { c: live.c, p }]);
      }}
      onPointerCancel={() => {
        liveRef.current = null;
        redraw();
      }}
    />
  );
}

/** Static SVG thumbnail of a doodle (pad-space or centered shape-space strokes). */
export function DoodleSvg({ strokes, size = 72 }: { strokes: readonly Stroke[]; size?: number }) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of strokes) {
    for (let i = 0; i < s.p.length; i += 2) {
      x0 = Math.min(x0, s.p[i]);
      x1 = Math.max(x1, s.p[i]);
      y0 = Math.min(y0, s.p[i + 1]);
      y1 = Math.max(y1, s.p[i + 1]);
    }
  }
  const pad = 6;
  const w = Math.max(10, x1 - x0) + pad * 2;
  const h = Math.max(10, y1 - y0) + pad * 2;
  const side = Math.max(w, h);
  const vx = x0 - pad - (side - w) / 2;
  const vy = y0 - pad - (side - h) / 2;
  return (
    <svg width={size} height={size} viewBox={`${vx} ${vy} ${side} ${side}`} className="shrink-0">
      {strokes.map((s, i) => (
        <polyline
          key={i}
          points={Array.from({ length: s.p.length / 2 }, (_, k) => `${s.p[k * 2]},${s.p[k * 2 + 1]}`).join(" ")}
          fill="none"
          stroke={INK_COLORS[s.c]}
          strokeWidth={side / 40}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
