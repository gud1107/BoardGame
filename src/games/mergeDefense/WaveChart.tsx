"use client";

import { useRef, useState } from "react";

/**
 * Results-screen line chart: peak monsters on each player's road per wave,
 * with the elimination limit as a dashed rule. Colors are the seat identity
 * colors (SEAT_COLORS, validated as a categorical set); text stays in text
 * tones. Hover / touch shows a crosshair + per-wave values; a table view
 * carries the same numbers without color.
 */

export interface WaveSeries {
  seat: number;
  name: string;
  color: string;
  /** Peak monsters per wave, index = wave − 1. */
  values: number[];
  out: boolean;
  me: boolean;
}

const W = 320;
const H = 168;
const PAD = { l: 26, r: 62, t: 12, b: 20 };
/** Direct labels keep to a few characters so they fit the right margin; the legend has full names. */
const short = (name: string) => {
  const bare = name.replace(/^[^\p{L}\p{N}]+/u, "") || name; // drop a leading emoji like "🤖 "
  return bare.length > 4 ? `${bare.slice(0, 3)}…` : bare;
};

export default function WaveChart({ series, limit }: { series: WaveSeries[]; limit: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const waves = Math.max(1, ...series.map((s) => s.values.length));
  const top = Math.max(limit, ...series.flatMap((s) => s.values)) * 1.08;
  const x = (i: number) => PAD.l + (waves === 1 ? 0 : (i / (waves - 1)) * (W - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b);
  const xTicks = Array.from(new Set([0, Math.round((waves - 1) / 2), waves - 1]));

  // End labels: sorted by height, nudged apart so they never overlap.
  const ends = series
    .filter((s) => s.values.length > 0)
    .map((s) => ({ s, i: s.values.length - 1, yv: y(s.values[s.values.length - 1]) }))
    .sort((a, b) => a.yv - b.yv);
  for (let k = 1; k < ends.length; k++) if (ends[k].yv - ends[k - 1].yv < 11) ends[k].yv = ends[k - 1].yv + 11;

  function pick(clientX: number) {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (waves - 1));
    setHover(Math.max(0, Math.min(waves - 1, i)));
  }

  const rows = hover === null ? [] : series.filter((s) => s.values[hover] !== undefined).sort((a, b) => b.values[hover]! - a.values[hover]!);

  return (
    <figure className="w-full text-left">
      <figcaption className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/60">
        <span className="font-semibold text-white/80">웨이브별 최대 몬스터 수</span>
        {series.map((s) => (
          <span key={s.seat} className="inline-flex items-center gap-1">
            <span className="inline-block h-[3px] w-3 rounded-full" style={{ background: s.color }} />
            {s.me ? "나" : s.name}
          </span>
        ))}
      </figcaption>
      <div
        ref={boxRef}
        className="relative touch-none"
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="웨이브별 최대 몬스터 수 선 그래프">
          {/* Recessive grid + axis labels */}
          {[0, Math.round(limit / 2)].map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
              <text x={PAD.l - 4} y={y(v) + 3} textAnchor="end" fontSize={9} fill="rgba(255,255,255,0.45)">
                {v}
              </text>
            </g>
          ))}
          {xTicks.map((i) => (
            <text key={i} x={x(i)} y={H - 5} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.45)">
              W{i + 1}
            </text>
          ))}
          {/* Elimination limit */}
          <line x1={PAD.l} x2={W - PAD.r} y1={y(limit)} y2={y(limit)} stroke="#f87171" strokeWidth={1.2} strokeDasharray="4 3" opacity={0.8} />
          <text x={PAD.l - 4} y={y(limit) + 3} textAnchor="end" fontSize={9} fill="#fca5a5">
            {limit}
          </text>
          <text x={PAD.l + 3} y={y(limit) - 3} fontSize={8} fill="#fca5a5">
            탈락
          </text>
          {/* Series */}
          {series.map((s) =>
            s.values.length === 0 ? null : (
              <polyline
                key={s.seat}
                points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
                fill="none"
                stroke={s.color}
                strokeWidth={s.me ? 2.5 : 2}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={hover === null || s.values[hover] !== undefined ? 1 : 0.35}
              />
            ),
          )}
          {/* End markers (✕ = eliminated) + direct labels */}
          {ends.map(({ s, i, yv }) => {
            const ex = x(i);
            const ey = y(s.values[i]);
            return (
              <g key={s.seat}>
                {s.out ? (
                  <path d={`M${ex - 4},${ey - 4}L${ex + 4},${ey + 4}M${ex + 4},${ey - 4}L${ex - 4},${ey + 4}`} stroke={s.color} strokeWidth={2.2} strokeLinecap="round" />
                ) : (
                  <circle cx={ex} cy={ey} r={4} fill={s.color} stroke="#1c1206" strokeWidth={2} />
                )}
                <text x={W - PAD.r + 6} y={yv + 3} fontSize={9} fill="rgba(255,255,255,0.75)">
                  {s.me ? "나" : short(s.name)} {s.values[i]}
                </text>
              </g>
            );
          })}
          {/* Crosshair */}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="rgba(255,255,255,0.35)" strokeWidth={1} />}
        </svg>
        {hover !== null && rows.length > 0 && (
          <div
            className="pointer-events-none absolute top-1 z-10 rounded-lg border border-white/15 bg-black/85 px-2 py-1 text-[11px] whitespace-nowrap text-white shadow-lg"
            style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${x(hover) > W / 2 ? "-105%" : "5%"})` }}
          >
            <p className="mb-0.5 font-bold">WAVE {hover + 1}</p>
            {rows.map((s) => (
              <p key={s.seat} className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                <span className="text-white/70">{s.me ? "나" : s.name}</span>
                <span className="ml-auto pl-2 font-mono">
                  {s.values[hover]}
                  {s.out && hover === s.values.length - 1 ? " ✕" : ""}
                </span>
              </p>
            ))}
          </div>
        )}
      </div>
      <details className="mt-1 text-[11px] text-white/50">
        <summary className="cursor-pointer select-none">표로 보기</summary>
        <div className="mt-1 max-h-48 overflow-auto">
          <table className="w-full border-collapse text-right whitespace-nowrap">
            <thead>
              <tr>
                <th className="px-1 text-left font-normal">웨이브</th>
                {series.map((s) => (
                  <th key={s.seat} className="px-1 font-normal">
                    {s.me ? "나" : s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: waves }, (_, i) => (
                <tr key={i} className="text-white/70">
                  <td className="px-1 text-left">W{i + 1}</td>
                  {series.map((s) => (
                    <td key={s.seat} className="px-1 font-mono">
                      {s.values[i] ?? ""}
                      {s.out && i === s.values.length - 1 ? " ✕" : ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
