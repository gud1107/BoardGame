"use client";

import { CORRIDOR_H, CORRIDOR_LEN, CORRIDOR_W, type ShownProp } from "./engine";

/**
 * 2D fallback (no WebGL / 🖼️ 2D): a one-point-perspective SVG of the same
 * corridor, drawn from the same `shownProps` as the 3D scene. Far props are
 * drawn first; every prop (and the empty spot of a missing one) is tappable.
 */

const VW = 400;
const VH = 300;
const VX = VW / 2;
const EYE = 1.55;
const NEAR = 1.4;

function proj(x: number, y: number, z: number) {
  const f = 230 / (NEAR + z);
  return { x: VX + x * f, y: VH * 0.5 - (y - EYE) * f, f };
}

function spot(p: ShownProp) {
  const W2 = CORRIDOR_W / 2;
  if (p.side === "L") return proj(-W2, p.y, p.z);
  if (p.side === "R") return proj(W2, p.y, p.z);
  if (p.side === "E") return proj(p.kind === "figure" ? 0.4 : 0, p.y, CORRIDOR_LEN);
  if (p.side === "C") return proj(0, p.y, p.z);
  return proj(0.3, 0, p.z);
}

export default function Corridor2D({ props, selectedId, revealId, onPick }: { props: ShownProp[]; selectedId: string | null; revealId: string | null; onPick: ((id: string) => void) | null }) {
  const W2 = CORRIDOR_W / 2;
  const n = (x: number, y: number) => proj(x, y, 0);
  const f = (x: number, y: number) => proj(x, y, CORRIDOR_LEN);
  const poly = (pts: { x: number; y: number }[]) => pts.map((q) => `${q.x},${q.y}`).join(" ");
  const sorted = [...props].sort((a, b) => b.z - a.z);
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="h-full w-full select-none" role="img" aria-label="복도">
      <rect width={VW} height={VH} fill="#050605" />
      <polygon points={poly([n(-W2, 0), n(W2, 0), f(W2, 0), f(-W2, 0)])} fill="#33332c" />
      <polygon points={poly([n(-W2, CORRIDOR_H), n(W2, CORRIDOR_H), f(W2, CORRIDOR_H), f(-W2, CORRIDOR_H)])} fill="#4b5246" />
      <polygon points={poly([n(-W2, 0), n(-W2, CORRIDOR_H), f(-W2, CORRIDOR_H), f(-W2, 0)])} fill="#5e6555" />
      <polygon points={poly([n(W2, 0), n(W2, CORRIDOR_H), f(W2, CORRIDOR_H), f(W2, 0)])} fill="#565d4e" />
      <polygon points={poly([f(-W2, 0), f(W2, 0), f(W2, CORRIDOR_H), f(-W2, CORRIDOR_H)])} fill="#6b7262" />
      {sorted.map((p) => {
        const s = spot(p);
        const onWall = p.side === "L" || p.side === "R";
        const w = p.w * s.f * (onWall ? 0.42 : 1) * p.scale;
        const h = (p.side === "F" ? 0.25 : p.h) * s.f * p.scale;
        const sel = p.id === selectedId;
        const rev = p.id === revealId;
        const cx = s.x + (p.side === "L" ? w / 2 : p.side === "R" ? -w / 2 : 0);
        return (
          <g
            key={p.id}
            transform={`translate(${cx} ${s.y}) rotate(${(p.tilt * 180) / Math.PI})`}
            onClick={onPick ? () => onPick(p.id) : undefined}
            style={{ cursor: onPick ? "pointer" : "default" }}
          >
            <rect x={-Math.max(w, 14) / 2} y={-Math.max(h, 14) / 2} width={Math.max(w, 14)} height={Math.max(h, 14)} fill="transparent" />
            {!p.hidden && (
              <>
                <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={Math.min(4, w / 6)} fill={p.color} opacity={p.kind === "lamp" || p.kind === "exitSign" ? 1 : 0.9} />
                {p.icon && (
                  <text textAnchor="middle" dominantBaseline="central" fontSize={Math.max(8, Math.min(w * (onWall ? 1.6 : 0.8), h * 0.7))}>
                    {p.icon}
                  </text>
                )}
                {p.label && p.kind !== "poster" && (
                  <text y={p.kind === "door" ? -h * 0.32 : 0} textAnchor="middle" dominantBaseline="central" fontSize={Math.max(6, s.f * 0.14)} fill={p.kind === "door" ? "#fff" : "#f8fafc"} fontWeight={700}>
                    {p.label}
                  </text>
                )}
              </>
            )}
            {(sel || rev) && <rect x={-Math.max(w, 14) / 2 - 3} y={-Math.max(h, 14) / 2 - 3} width={Math.max(w, 14) + 6} height={Math.max(h, 14) + 6} fill="none" stroke={rev ? "#f43f5e" : "#38bdf8"} strokeWidth={2} className={rev ? "animate-pulse" : ""} />}
          </g>
        );
      })}
    </svg>
  );
}
