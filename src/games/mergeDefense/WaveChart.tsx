"use client";

import { useRef, useState } from "react";

/**
 * Results-screen line chart with three views of the same match, one line per
 * seat: peak monsters on the road per wave (with the elimination limit as a
 * dashed rule), cumulative gold earned, and kills per wave. Boss waves get a
 * faint band + 👑. Colors are the seat identity colors (SEAT_COLORS,
 * validated as a categorical set); text stays in text tones. Hover / touch
 * shows a crosshair + per-wave values; a table view carries the same numbers.
 */

export interface WaveSeries {
  seat: number;
  name: string;
  color: string;
  me: boolean;
  out: boolean;
  /** Per wave (index = wave − 1): peak monsters on the road, cumulative gold earned, cumulative kills. */
  load: number[];
  gold: number[];
  kills: number[];
  /** Board upgrades bought (shown for the viewer's own line only). */
  upgrades?: { wave: number; kind: "focus" | "brace"; level: number }[];
}

const UPGRADE_ICON = { focus: "🎯", brace: "🛡️" } as const;
const UPGRADE_NAME = { focus: "집중", brace: "결속" } as const;

type Tab = "load" | "gold" | "kills";
const TABS: { id: Tab; label: string; title: string }[] = [
  { id: "load", label: "👾 몬스터", title: "웨이브별 최대 몬스터 수" },
  { id: "gold", label: "🪙 골드", title: "누적 획득 골드" },
  { id: "kills", label: "⚔️ 처치", title: "웨이브별 처치 수" },
];

const W = 320;
const H = 178;
/** Bottom pad holds the upgrade-marker strip above the wave labels. */
const PAD = { l: 30, r: 62, t: 14, b: 30 };
/** Direct labels keep to a few characters so they fit the right margin; the legend has full names. */
const short = (name: string) => {
  const bare = name.replace(/^[^\p{L}\p{N}]+/u, "") || name; // drop a leading emoji like "🤖 "
  return bare.length > 4 ? `${bare.slice(0, 3)}…` : bare;
};
const fmt = (v: number) => (v >= 10000 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`);

function valuesFor(s: WaveSeries, tab: Tab): number[] {
  if (tab === "load") return s.load;
  if (tab === "gold") return s.gold;
  return s.kills.map((k, i) => k - (i > 0 ? s.kills[i - 1] : 0));
}

export default function WaveChart({ series, limit, bossEvery }: { series: WaveSeries[]; limit: number; bossEvery: number }) {
  const [tab, setTab] = useState<Tab>("load");
  const [hover, setHover] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const data = series.map((s) => ({ s, v: valuesFor(s, tab) }));
  const waves = Math.max(1, ...data.map((d) => d.v.length));
  const peak = Math.max(1, ...data.flatMap((d) => d.v));
  const top = (tab === "load" ? Math.max(limit, peak) : peak) * 1.08;
  const step = waves === 1 ? 0 : (W - PAD.l - PAD.r) / (waves - 1);
  const x = (i: number) => PAD.l + i * step;
  const y = (v: number) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b);
  const xTicks = Array.from(new Set([0, Math.round((waves - 1) / 2), waves - 1]));
  const yTicks = tab === "load" ? [0, Math.round(limit / 2)] : [0, Math.round(peak / 2), Math.round(peak)];
  const bosses = Array.from({ length: Math.floor(waves / bossEvery) }, (_, k) => (k + 1) * bossEvery - 1);
  const meta = TABS.find((t) => t.id === tab)!;
  const mine = series.find((s) => s.me);
  const marks = mine?.upgrades ?? [];
  const markY = H - PAD.b + 10;

  // End labels: sorted by height, nudged apart so they never overlap.
  const ends = data
    .filter((d) => d.v.length > 0)
    .map((d) => ({ ...d, i: d.v.length - 1, yv: y(d.v[d.v.length - 1]) }))
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

  const rows = hover === null ? [] : data.filter((d) => d.v[hover] !== undefined).sort((a, b) => b.v[hover]! - a.v[hover]!);

  return (
    <figure className="w-full text-left">
      <div className="mb-1.5 flex gap-1" role="tablist" aria-label="그래프 종류">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              setTab(t.id);
              setHover(null);
            }}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] whitespace-nowrap transition ${
              tab === t.id ? "border-amber-300/60 bg-amber-400/15 font-bold text-amber-100" : "border-white/10 text-white/55 hover:border-white/30"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <figcaption className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/60">
        <span className="font-semibold text-white/80">
          {meta.title}
          {/* The match ends mid-wave, so the last point only counts that wave's start. */}
          {tab === "kills" && <span className="ml-1 font-normal text-white/40">(마지막 웨이브는 끝난 순간까지)</span>}
        </span>
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
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={`${meta.title} 선 그래프`}>
          {/* Boss waves: faint band + crown */}
          {bosses.map((i) => (
            <g key={i}>
              <rect x={x(i) - Math.max(2, step * 0.35)} y={PAD.t} width={Math.max(4, step * 0.7)} height={H - PAD.t - PAD.b} fill="rgba(250,204,21,0.07)" />
              <text x={x(i)} y={PAD.t - 3} textAnchor="middle" fontSize={8}>
                👑
              </text>
            </g>
          ))}
          {/* Recessive grid + axis labels */}
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
              <text x={PAD.l - 4} y={y(v) + 3} textAnchor="end" fontSize={9} fill="rgba(255,255,255,0.45)">
                {fmt(v)}
              </text>
            </g>
          ))}
          {xTicks.map((i) => (
            <text key={i} x={x(i)} y={H - 5} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.45)">
              W{i + 1}
            </text>
          ))}
          {tab === "load" && (
            <>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(limit)} y2={y(limit)} stroke="#f87171" strokeWidth={1.2} strokeDasharray="4 3" opacity={0.8} />
              <text x={PAD.l - 4} y={y(limit) + 3} textAnchor="end" fontSize={9} fill="#fca5a5">
                {limit}
              </text>
              <text x={PAD.l + 3} y={y(limit) - 3} fontSize={8} fill="#fca5a5">
                탈락
              </text>
            </>
          )}
          {/* Series */}
          {data.map(({ s, v }) =>
            v.length === 0 ? null : (
              <polyline
                key={s.seat}
                points={v.map((val, i) => `${x(i)},${y(val)}`).join(" ")}
                fill="none"
                stroke={s.color}
                strokeWidth={s.me ? 2.5 : 2}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={hover === null || v[hover] !== undefined ? 1 : 0.35}
              />
            ),
          )}
          {/* End markers (✕ = eliminated) + direct labels */}
          {ends.map(({ s, v, i, yv }) => {
            const ex = x(i);
            const ey = y(v[i]);
            return (
              <g key={s.seat}>
                {s.out ? (
                  <path d={`M${ex - 4},${ey - 4}L${ex + 4},${ey + 4}M${ex + 4},${ey - 4}L${ex - 4},${ey + 4}`} stroke={s.color} strokeWidth={2.2} strokeLinecap="round" />
                ) : (
                  <circle cx={ex} cy={ey} r={4} fill={s.color} stroke="#1c1206" strokeWidth={2} />
                )}
                <text x={W - PAD.r + 6} y={yv + 3} fontSize={9} fill="rgba(255,255,255,0.75)">
                  {s.me ? "나" : short(s.name)} {fmt(v[i])}
                </text>
              </g>
            );
          })}
          {/* My board upgrades: icon on the strip under the plot + a faint guide up through it */}
          {marks.map((m, k) => {
            const sameWave = marks.filter((o) => o.wave === m.wave);
            const nth = sameWave.indexOf(m);
            const mx = x(Math.min(waves - 1, m.wave - 1)) + (nth - (sameWave.length - 1) / 2) * 9;
            return (
              <g key={k}>
                {nth === 0 && <line x1={mx} x2={mx} y1={PAD.t} y2={H - PAD.b} stroke={mine?.color} strokeWidth={1} strokeDasharray="1 3" opacity={0.45} />}
                <text x={mx} y={markY + 3} textAnchor="middle" fontSize={8}>
                  {UPGRADE_ICON[m.kind]}
                </text>
              </g>
            );
          })}
          {/* Crosshair */}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="rgba(255,255,255,0.35)" strokeWidth={1} />}
        </svg>
      </div>
      {/* Readout under the plot (never covers the lines); fixed height so the card doesn't jump. */}
      <div className="mt-1 min-h-[2.6rem] rounded-lg bg-black/25 px-2 py-1 text-[11px]" aria-live="polite">
        {hover === null || rows.length === 0 ? (
          <p className="pt-2 text-center text-white/40">
            그래프를 누르거나 올리면 웨이브별 수치가 여기 나와요{marks.length > 0 ? " · 🎯 집중 🛡️ 결속 = 내가 올린 시점" : ""}
          </p>
        ) : (
          <>
            <p className="font-bold text-white/85">
              WAVE {hover + 1}
              {(hover + 1) % bossEvery === 0 && " 👑"}
              {marks
                .filter((m) => m.wave === hover + 1)
                .map((m, k) => (
                  <span key={k} className="ml-1.5 font-normal text-white/60">
                    {UPGRADE_ICON[m.kind]} {UPGRADE_NAME[m.kind]} {m.level}단계
                  </span>
                ))}
            </p>
            <p className="flex flex-wrap gap-x-3 gap-y-0.5">
              {rows.map(({ s, v }) => (
                <span key={s.seat} className="inline-flex items-center gap-1 whitespace-nowrap">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                  <span className="text-white/60">{s.me ? "나" : short(s.name)}</span>
                  <span className="font-mono text-white">
                    {fmt(v[hover]!)}
                    {s.out && hover === v.length - 1 ? " ✕" : ""}
                  </span>
                </span>
              ))}
            </p>
          </>
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
                  <td className="px-1 text-left">
                    W{i + 1}
                    {(i + 1) % bossEvery === 0 && " 👑"}
                  </td>
                  {data.map(({ s, v }) => (
                    <td key={s.seat} className="px-1 font-mono">
                      {v[i] !== undefined ? fmt(v[i]) : ""}
                      {s.out && i === v.length - 1 ? " ✕" : ""}
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
