"use client";

import type { SceneShape, ShapeKind } from "./scenes";

/**
 * Pure presentational SVG renderer for one side (original or modified) of a
 * built-in scene. All shapes live on a 0..100 square viewBox so `xPct`/
 * `yPct`/`sizePct` from scenes.ts are usable directly as viewBox units —
 * this is also exactly the coordinate space click handling works in.
 */

function starPoints(cx: number, cy: number, outerR: number, innerR: number): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    points.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  return points.join(" ");
}

function trianglePoints(cx: number, cy: number, size: number): string {
  return `${cx},${cy - size} ${cx - size},${cy + size} ${cx + size},${cy + size}`;
}

function ShapeNode({ shape }: { shape: SceneShape }) {
  const transform = shape.rotationDeg ? `rotate(${shape.rotationDeg} ${shape.xPct} ${shape.yPct})` : undefined;
  const common = { fill: shape.color, opacity: shape.opacity ?? 1, transform };

  switch (shape.kind as ShapeKind) {
    case "circle":
      return <circle cx={shape.xPct} cy={shape.yPct} r={shape.sizePct} {...common} />;
    case "ellipse":
      return <ellipse cx={shape.xPct} cy={shape.yPct} rx={shape.sizePct} ry={shape.sizePct * 0.6} {...common} />;
    case "rect": {
      const width = shape.sizePct * 2;
      const height = shape.heightPct ?? shape.sizePct * 2;
      return <rect x={shape.xPct - shape.sizePct} y={shape.yPct - height / 2} width={width} height={height} rx={0.6} {...common} />;
    }
    case "triangle":
      return <polygon points={trianglePoints(shape.xPct, shape.yPct, shape.sizePct)} {...common} />;
    case "star":
      return <polygon points={starPoints(shape.xPct, shape.yPct, shape.sizePct, shape.sizePct * 0.45)} {...common} />;
    default:
      return null;
  }
}

export default function SpotDifferenceScene({
  shapes,
  background,
  className,
}: {
  shapes: SceneShape[];
  background: [string, string];
  className?: string;
}) {
  const gradientId = `sd-bg-${background[0].replace("#", "")}-${background[1].replace("#", "")}`;
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={className}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={background[0]} />
          <stop offset="100%" stopColor={background[1]} />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={100} height={100} fill={`url(#${gradientId})`} />
      {shapes.map((shape) => (
        <ShapeNode key={shape.id} shape={shape} />
      ))}
    </svg>
  );
}
