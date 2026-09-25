"use client";

import { ADJACENCY, LANDMARKS, REGIONS, REGION_INFO } from "./data";
import type { LotrDuelState, RegionId } from "./types";

/**
 * 7-region Middle-earth map as an SVG node graph (the rulebook has no map
 * picture, so geography is approximate). Gold = Fellowship, ash-grey =
 * Sauron; 🏰 marks a fortress. Regions in `targets` glow and are clickable.
 */
export default function MiddleEarthMap({
  state,
  targets,
  selectedFrom,
  onRegion,
  rise,
}: {
  state: LotrDuelState;
  targets: Set<RegionId>;
  selectedFrom: RegionId | null;
  onRegion: (r: RegionId) => void;
  /** Region whose fortress was just built — replays the rising-keep animation. */
  rise?: { key: number; region: RegionId } | null;
}) {
  const edges: [RegionId, RegionId][] = [];
  for (const a of REGIONS) for (const b of ADJACENCY[a]) if (a < b) edges.push([a, b]);
  const landmarkAt = (r: RegionId) => Object.values(LANDMARKS).find((l) => l.targetRegion === r);
  const flash = state.combatFlash;

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-amber-900/40 bg-[radial-gradient(ellipse_at_30%_20%,#2a2213,#0e0b08_70%)] light:border-amber-300 light:bg-[radial-gradient(ellipse_at_30%_20%,#fdf6e3,#efe2c0_70%)]">
      <svg viewBox="0 0 100 100" className="block aspect-[10/9] w-full" preserveAspectRatio="none">
        <defs>
          <radialGradient id="lotrd-mordor" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#7f1d1d" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#7f1d1d" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={REGION_INFO.MORDOR.x} cy={REGION_INFO.MORDOR.y} r="16" fill="url(#lotrd-mordor)" />
        {edges.map(([a, b]) => (
          <line
            key={`${a}-${b}`}
            x1={REGION_INFO[a].x}
            y1={REGION_INFO[a].y}
            x2={REGION_INFO[b].x}
            y2={REGION_INFO[b].y}
            stroke="#b8893b"
            strokeOpacity={selectedFrom && (a === selectedFrom || b === selectedFrom) ? 0.9 : 0.3}
            strokeWidth={selectedFrom && (a === selectedFrom || b === selectedFrom) ? 0.9 : 0.5}
            strokeDasharray="1.5 1"
          />
        ))}
      </svg>
      {REGIONS.map((r) => {
        const info = REGION_INFO[r];
        const reg = state.boardRegions[r];
        const isTarget = targets.has(r);
        const isFrom = selectedFrom === r;
        const lm = landmarkAt(r);
        const flashing = flash && flash.region === r;
        return (
          <button
            key={r}
            type="button"
            disabled={!isTarget}
            onClick={() => onRegion(r)}
            style={{ left: `${info.x}%`, top: `${info.y}%` }}
            className={`absolute flex w-[23%] max-w-[118px] -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-xl border px-1 py-1 text-center backdrop-blur-sm transition ${
              isFrom
                ? "border-amber-300 bg-amber-500/30 ring-2 ring-amber-300"
                : isTarget
                  ? "lotrd-target cursor-pointer border-emerald-300 bg-emerald-500/20"
                  : "border-white/15 bg-black/45 light:border-amber-800/20 light:bg-white/70"
            }`}
          >
            {flashing && <span key={flash.no} className="lotrd-clash pointer-events-none absolute inset-0 rounded-xl" />}
            {flashing && (
              <span key={`x${flash.no}`} className="pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 text-xl drop-shadow-[0_0_8px_rgba(244,63,94,.9)]" style={{ animation: "lotrfx-rim 1.2s ease-out both" }}>
                ⚔️
              </span>
            )}
            {rise?.region === r && (
              <span key={`r${rise.key}`} className="pointer-events-none absolute inset-0 rounded-xl" style={{ boxShadow: "0 0 0 2px rgba(251,191,36,.9), 0 0 28px 6px rgba(251,191,36,.6)", animation: "lotrfx-rim 1.8s ease-out both" }} />
            )}
            <span className="text-[clamp(9px,1.9vw,13px)] leading-tight font-bold text-amber-100 light:text-amber-900">{info.name}</span>
            <span className="text-[clamp(7px,1.3vw,9px)] leading-tight text-white/45 light:text-slate-500">{lm?.name}</span>
            <span className="mt-0.5 flex items-center gap-1 text-[clamp(9px,1.8vw,12px)] font-bold">
              {reg.fellowshipFortress && (
                <span key={rise?.region === r ? `f${rise.key}` : "f"} title="원정대 요새" className={`rounded bg-amber-400/90 px-0.5 text-[0.8em] text-black ${rise?.region === r ? "lotrfx-keep" : ""}`}>
                  🏰
                </span>
              )}
              {reg.fellowshipUnits > 0 && (
                <span className="flex items-center rounded-full bg-gradient-to-b from-amber-300 to-amber-600 px-1.5 text-black shadow-[0_0_6px_rgba(251,191,36,.6)]">{reg.fellowshipUnits}</span>
              )}
              {reg.sauronUnits > 0 && (
                <span className="flex items-center rounded-full bg-gradient-to-b from-zinc-400 to-zinc-700 px-1.5 text-white shadow-[0_0_6px_rgba(244,63,94,.45)]">{reg.sauronUnits}</span>
              )}
              {reg.sauronFortress && (
                <span key={rise?.region === r ? `s${rise.key}` : "s"} title="사우론 요새" className={`rounded bg-zinc-600 px-0.5 text-[0.8em] ${rise?.region === r ? "lotrfx-keep" : ""}`}>
                  🏯
                </span>
              )}
              {!reg.fellowshipFortress && !reg.sauronFortress && reg.fellowshipUnits === 0 && reg.sauronUnits === 0 && <span className="text-white/25 light:text-slate-400">·</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
