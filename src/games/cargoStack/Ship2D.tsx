"use client";

import { COLS, TIERS, type Kind } from "./engine";
import type { DisplayCrate, Frame } from "./anim";
import { seatColor, seatDark, seatMark } from "./labels";

/**
 * 2D side view of the ship (rulebook §10) — the fallback when WebGL is
 * missing and an option for small phones. Pure SVG: the hull, the 9×6 bay
 * grid, crates (colour + shape mark + weight), the crane ghost, splashes.
 * Tap a column to aim; tap the same column again to drop.
 */

export interface Ghost {
  len: number;
  w: number;
  kind: Kind;
  x: number;
  y: number;
  valid: boolean;
  owner: number;
}

const CELL = 40;
const DECK_Y = 300;
const WATER_Y = 332;
const PIVOT_X = (COLS * CELL) / 2;

const px = (x: number) => x * CELL;
const py = (y: number) => DECK_Y - (y + 1) * CELL;

function Crate2D({ d, warn }: { d: DisplayCrate; warn: boolean }) {
  const { c } = d;
  const w = c.len * CELL - 3;
  const h = CELL - 3;
  const x = px(d.x) + 1.5;
  const y = py(d.y) + 1.5;
  const fill = c.crushed ? "#6b7280" : seatColor(c.owner);
  const stroke = c.crushed ? "#374151" : seatDark(c.owner);
  const cx = x + w / 2;
  const cy = y + h / 2;
  return (
    <g transform={`rotate(${(d.rot * 180) / Math.PI} ${cx} ${cy})`} opacity={d.opacity}>
      <rect x={x} y={y} width={w} height={h} rx={3} fill={fill} stroke={warn ? "#fde047" : stroke} strokeWidth={warn ? 3 : 1.6} strokeDasharray={c.kind === "fragile" && !c.crushed ? "4 3" : undefined} />
      {/* corrugation */}
      {Array.from({ length: c.len * 3 - 1 }, (_, i) => (
        <line key={i} x1={x + ((i + 1) * w) / (c.len * 3)} y1={y + 4} x2={x + ((i + 1) * w) / (c.len * 3)} y2={y + h - 4} stroke="rgba(0,0,0,.18)" strokeWidth={1} />
      ))}
      {c.kind === "steel" && <rect x={x} y={y} width={w} height={h} rx={3} fill="url(#cs-hatch)" />}
      {c.kind === "gold" && <rect x={x} y={y + h - 7} width={w} height={5} fill="#facc15" />}
      {c.crushed && <path d={`M${x + 6} ${y + 6} L${cx} ${cy} L${x + w - 8} ${y + 9} M${cx} ${cy} L${cx - 4} ${y + h - 4}`} stroke="#111827" strokeWidth={1.5} fill="none" />}
      <text x={cx} y={cy - 2} textAnchor="middle" fontSize={11} fontWeight={800} fill="#fff" style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,.55)", strokeWidth: 2.5 }}>
        {c.kind === "gold" ? "💎" : c.kind === "fragile" ? "🥚" : c.kind === "steel" ? "⚙" : seatMark(c.owner)} {c.w}t
      </text>
      <text x={cx} y={cy + 11} textAnchor="middle" fontSize={9} fontWeight={700} fill="rgba(255,255,255,.85)">
        {c.crushed ? "깨짐" : `${seatMark(c.owner)} ${c.pts}`}
      </text>
    </g>
  );
}

export default function Ship2D({
  frame,
  heel,
  ghost,
  warnIds,
  interactive,
  onColumn,
  storm,
}: {
  frame: Frame;
  heel: number;
  ghost: Ghost | null;
  warnIds: Set<number>;
  interactive: boolean;
  onColumn: (c: number) => void;
  storm: boolean;
}) {
  const sink = frame.capsize * 70;
  return (
    <svg viewBox="-90 0 540 420" className="h-full w-full select-none" role="img" aria-label="화물선 옆모습">
      <defs>
        <pattern id="cs-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(255,255,255,.28)" strokeWidth="3" />
        </pattern>
        <linearGradient id="cs-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={storm ? "#334155" : "#7dd3fc"} />
          <stop offset="1" stopColor={storm ? "#64748b" : "#e0f2fe"} />
        </linearGradient>
        <linearGradient id="cs-sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={storm ? "#1e3a5f" : "#0ea5e9"} />
          <stop offset="1" stopColor={storm ? "#0b1324" : "#075985"} />
        </linearGradient>
      </defs>
      <rect x={-90} y={0} width={540} height={WATER_Y} fill="url(#cs-sky)" />
      {/* crane gantry */}
      <g opacity={0.9}>
        <rect x={-78} y={14} width={8} height={WATER_Y - 14} fill="#f59e0b" />
        <rect x={-78} y={10} width={530} height={8} fill="#f59e0b" />
        <rect x={438} y={14} width={8} height={WATER_Y - 14} fill="#f59e0b" />
      </g>
      <g transform={`translate(0 ${sink}) rotate(${heel} ${PIVOT_X} ${WATER_Y})`}>
        {/* bay grid */}
        {Array.from({ length: COLS }, (_, c) => (
          <rect key={c} x={px(c)} y={py(TIERS - 1)} width={CELL} height={TIERS * CELL} fill={c % 2 ? "rgba(255,255,255,.07)" : "rgba(255,255,255,.12)"} stroke="rgba(255,255,255,.12)" />
        ))}
        <line x1={0} y1={py(TIERS - 1)} x2={COLS * CELL} y2={py(TIERS - 1)} stroke="rgba(239,68,68,.6)" strokeDasharray="6 4" />
        {/* hull */}
        <path d={`M -26 ${DECK_Y} L ${COLS * CELL + 26} ${DECK_Y} L ${COLS * CELL} ${DECK_Y + 56} L 0 ${DECK_Y + 56} Z`} fill="#1f2937" />
        <path d={`M -18 ${DECK_Y + 30} L ${COLS * CELL + 18} ${DECK_Y + 30} L ${COLS * CELL} ${DECK_Y + 56} L 0 ${DECK_Y + 56} Z`} fill="#b91c1c" />
        <rect x={-26} y={DECK_Y} width={COLS * CELL + 52} height={6} fill="#f8fafc" />
        <text x={PIVOT_X} y={DECK_Y + 24} textAnchor="middle" fontSize={12} fontWeight={800} fill="#e5e7eb" letterSpacing={3}>
          CARGO STACK
        </text>
        {/* column numbers */}
        {Array.from({ length: COLS }, (_, c) => (
          <text key={c} x={px(c) + CELL / 2} y={DECK_Y + 14} textAnchor="middle" fontSize={10} fontWeight={700} fill={c === 4 ? "#fde047" : "#9ca3af"}>
            {c + 1}
          </text>
        ))}
        {frame.crates.map((d) => (
          <Crate2D key={d.c.id} d={d} warn={warnIds.has(d.c.id)} />
        ))}
        {ghost && (
          <g pointerEvents="none">
            <line x1={px(ghost.x + ghost.len / 2)} y1={18 - sink} x2={px(ghost.x + ghost.len / 2)} y2={py(ghost.y)} stroke="#111827" strokeWidth={1.5} strokeDasharray="3 3" />
            <rect x={px(ghost.x) + 1.5} y={py(ghost.y) + 1.5} width={ghost.len * CELL - 3} height={CELL - 3} rx={3} fill={ghost.valid ? seatColor(ghost.owner) : "#ef4444"} fillOpacity={0.35} stroke={ghost.valid ? "#fff" : "#ef4444"} strokeWidth={2} strokeDasharray="5 3" />
            <text x={px(ghost.x + ghost.len / 2)} y={py(ghost.y) + CELL / 2 + 4} textAnchor="middle" fontSize={12} fontWeight={900} fill="#fff" style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,.6)", strokeWidth: 3 }}>
              {ghost.valid ? `${ghost.w}t` : "✕"}
            </text>
          </g>
        )}
        {interactive &&
          Array.from({ length: COLS }, (_, c) => (
            <rect key={c} x={px(c)} y={0} width={CELL} height={DECK_Y} fill="transparent" style={{ cursor: "pointer" }} onPointerDown={() => onColumn(c)} aria-label={`${c + 1}번 칸`} />
          ))}
      </g>
      {/* sea in front */}
      <path d={`M -90 ${WATER_Y} Q -45 ${WATER_Y - 6} 0 ${WATER_Y} T 90 ${WATER_Y} T 180 ${WATER_Y} T 270 ${WATER_Y} T 360 ${WATER_Y} T 450 ${WATER_Y} L 450 420 L -90 420 Z`} fill="url(#cs-sea)" opacity={0.92} />
      {frame.splashes.map((s, i) => (
        <g key={i} opacity={1 - s.u}>
          <ellipse cx={px(s.x) + CELL / 2} cy={WATER_Y + 4} rx={10 + s.u * 34} ry={4 + s.u * 8} fill="none" stroke="#e0f2fe" strokeWidth={3} />
          <circle cx={px(s.x) + CELL / 2 - 8} cy={WATER_Y - 10 - s.u * 22} r={4} fill="#e0f2fe" />
          <circle cx={px(s.x) + CELL / 2 + 9} cy={WATER_Y - 6 - s.u * 30} r={3} fill="#e0f2fe" />
        </g>
      ))}
    </svg>
  );
}
