"use client";

import { resourceDir, RESOURCE_EMOJI, quadTerrain, type Terrain } from "./tiles";

/** Terrain fill + a pattern glyph per terrain so tiles read without colour (색각 이상). */
export const TERRAIN_FILL = ["#2f7d3a", "#a8cf55", "#8f8577", "#2f8fd8"] as const;
export const TERRAIN_EDGE = ["#1d5226", "#7ea53a", "#6a6156", "#1f6aa6"] as const;
export const TERRAIN_GLYPH = ["♣", "〃", "▲", "≈"] as const;
export const TERRAIN_GLYPH_INK = ["#c7f0c4", "#4f6d1f", "#ece5da", "#cde9ff"] as const;

/** Pioneer colours, each with its own shape (색각 이상). */
export const SEAT_COLORS = ["#ef4444", "#3b82f6", "#f59e0b", "#a855f7", "#f8fafc"] as const;
export const SEAT_SHAPES = ["●", "▲", "■", "◆", "★"] as const;
export const SEAT_NAMES = ["빨강", "파랑", "노랑", "보라", "하양"] as const;

/** Triangle (side `d`) of the unit cell at (x, y). */
export function triPoints(x: number, y: number, d: number): string {
  const c = `${x + 0.5},${y + 0.5}`;
  const p = [
    [x, y],
    [x + 1, y],
    [x + 1, y + 1],
    [x, y + 1],
  ];
  const a = p[d];
  const b = p[(d + 1) % 4];
  return `${a[0]},${a[1]} ${b[0]},${b[1]} ${c}`;
}

/** Point inside triangle `d` where an icon / pioneer sits. */
export function triCenter(x: number, y: number, d: number): [number, number] {
  const off = 0.27;
  const cx = x + 0.5;
  const cy = y + 0.5;
  return [cx + [0, off, 0, -off][d], cy + [-off, 0, off, 0][d]];
}

/** One tile drawn into a unit square at (x, y) inside an SVG. */
export function TileShape({ tile, rot, x, y, opacity = 1, glyphs = true }: { tile: number; rot: number; x: number; y: number; opacity?: number; glyphs?: boolean }) {
  const rd = resourceDir(tile, rot);
  return (
    <g opacity={opacity}>
      {[0, 1, 2, 3].map((d) => {
        const t = quadTerrain(tile, rot, d) as Terrain;
        const [gx, gy] = triCenter(x, y, d);
        return (
          <g key={d}>
            <polygon points={triPoints(x, y, d)} fill={TERRAIN_FILL[t]} stroke={TERRAIN_FILL[t]} strokeWidth={0.02} />
            {glyphs && rd !== d && (
              <text x={gx} y={gy} fontSize={0.2} textAnchor="middle" dominantBaseline="central" fill={TERRAIN_GLYPH_INK[t]} opacity={0.75} style={{ pointerEvents: "none" }}>
                {TERRAIN_GLYPH[t]}
              </text>
            )}
          </g>
        );
      })}
      {/* inner seams where neighbouring triangles differ */}
      {[0, 1, 2, 3].map((d) => {
        if (quadTerrain(tile, rot, d) === quadTerrain(tile, rot, (d + 1) % 4)) return null;
        const corner = [
          [x + 1, y],
          [x + 1, y + 1],
          [x, y + 1],
          [x, y],
        ][d];
        return <line key={`s${d}`} x1={x + 0.5} y1={y + 0.5} x2={corner[0]} y2={corner[1]} stroke="rgba(0,0,0,0.28)" strokeWidth={0.025} />;
      })}
      {rd >= 0 && (
        <text x={triCenter(x, y, rd)[0]} y={triCenter(x, y, rd)[1]} fontSize={0.26} textAnchor="middle" dominantBaseline="central" style={{ pointerEvents: "none" }}>
          {RESOURCE_EMOJI[quadTerrain(tile, rot, rd)]}
        </text>
      )}
      <rect x={x + 0.01} y={y + 0.01} width={0.98} height={0.98} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={0.02} />
    </g>
  );
}

/** A pioneer flag (seat colour + shape) centred at (cx, cy) in board units. */
export function PioneerFlag({ seat, cx, cy, size = 0.3, pulse = false }: { seat: number; cx: number; cy: number; size?: number; pulse?: boolean }) {
  const s = size;
  return (
    <g style={{ pointerEvents: "none" }} className={pulse ? "animate-pulse" : undefined}>
      <line x1={cx - s * 0.25} y1={cy + s * 0.55} x2={cx - s * 0.25} y2={cy - s * 0.55} stroke="#3f2a14" strokeWidth={s * 0.12} />
      <path d={`M${cx - s * 0.25},${cy - s * 0.55} L${cx + s * 0.55},${cy - s * 0.3} L${cx - s * 0.25},${cy - s * 0.05} Z`} fill={SEAT_COLORS[seat]} stroke="#111" strokeWidth={s * 0.06} />
      <text x={cx + s * 0.05} y={cy - s * 0.3} fontSize={s * 0.32} textAnchor="middle" dominantBaseline="central" fill={seat === 4 || seat === 2 ? "#111" : "#fff"}>
        {SEAT_SHAPES[seat]}
      </text>
      <ellipse cx={cx - s * 0.25} cy={cy + s * 0.58} rx={s * 0.22} ry={s * 0.07} fill="rgba(0,0,0,0.35)" />
    </g>
  );
}

/** A stand-alone tile (harbour, rulebook) as its own little SVG. */
export function TileCard({ tile, rot = 0, size = 64, className = "" }: { tile: number; rot?: number; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 1 1" width={size} height={size} className={className} aria-hidden>
      <TileShape tile={tile} rot={rot} x={0} y={0} />
    </svg>
  );
}
