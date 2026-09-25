"use client";

import { ADJACENCY, LANDMARKS, REGIONS, REGION_INFO } from "./data";
import type { LotrDuelState, RegionId, RegionState } from "./types";

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
  preview,
  drops,
}: {
  state: LotrDuelState;
  targets: Set<RegionId>;
  selectedFrom: RegionId | null;
  onRegion: (r: RegionId) => void;
  /** Region whose fortress was just built — replays the rising-keep animation. */
  rise?: { key: number; region: RegionId } | null;
  /** Predictive highlight: regions a pending card would affect. */
  preview?: { regions: RegionId[]; tone: "red" | "violet" } | null;
  /** Units that just arrived — dropped in from above. */
  drops?: { key: number; items: { region: RegionId; faction: "FELLOWSHIP" | "SAURON"; count: number }[] } | null;
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
            className={`absolute flex w-[27%] max-w-[132px] -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-xl border px-1 py-1 text-center backdrop-blur-sm transition ${
              isFrom
                ? "border-amber-300 bg-amber-500/30 ring-2 ring-amber-300"
                : isTarget
                  ? "lotrd-target cursor-pointer border-emerald-300 bg-emerald-500/20"
                  : "border-white/15 bg-black/45 light:border-amber-800/20 light:bg-white/70"
            }`}
          >
            {flashing && <span key={flash.no} className="lotrd-clash pointer-events-none absolute inset-0 rounded-xl" />}
            {preview?.regions.includes(r) && <span className={`pointer-events-none absolute -inset-1 rounded-2xl ${preview.tone === "violet" ? "lotrp-violet" : "lotrp-red"}`} />}
            {drops?.items
              .filter((d) => d.region === r)
              .map((d) => (
                <span key={`d${drops.key}${d.faction}`} className="pointer-events-none absolute -top-2 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center">
                  <span className="lotrm-drop flex items-center gap-0.5 rounded-full border px-1.5 text-[11px] font-black whitespace-nowrap shadow-lg" style={{ borderColor: d.faction === "FELLOWSHIP" ? "#fcd34d" : "#f87171", background: d.faction === "FELLOWSHIP" ? "linear-gradient(#fde68a,#d97706)" : "linear-gradient(#991b1b,#450a0a)", color: d.faction === "FELLOWSHIP" ? "#1c1917" : "#fef2f2" }}>
                    🗡️{d.faction === "FELLOWSHIP" ? "💍" : "👁️"} +{d.count}
                  </span>
                  <span className="lotrm-dust mt-0.5 h-2 w-12 rounded-[50%] bg-amber-100/50 blur-[2px]" />
                </span>
              ))}
            {flashing && (
              <span key={`m${flash.no}`} className="pointer-events-none absolute inset-x-0 top-1/2 z-10 flex -translate-y-1/2 justify-center gap-3 text-lg">
                <span className="lotrm-dissolve">💍</span>
                <span className="lotrm-dissolve">👁️</span>
              </span>
            )}
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
            <FactionBadges region={reg} riseKey={rise?.region === r ? rise.key : undefined} className="mt-0.5" />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Who holds a region, spelled out: gold "💍 원정대 xN" and crimson
 * "👁️ 사우론 xN" unit badges plus "🏰 원정대 요새" / "🌋 사우론 요새". When both
 * sides are present (a fortress facing enemy units) the two rows stack so
 * the stand-off reads at a glance. Reused by the center choice modals.
 */
export function FactionBadges({ region, riseKey, className = "", size = "map" }: { region: RegionState; riseKey?: number; className?: string; size?: "map" | "modal" }) {
  const text = size === "map" ? "text-[clamp(7.5px,1.45vw,10.5px)]" : "text-[11px]";
  const empty = region.fellowshipUnits === 0 && region.sauronUnits === 0 && !region.fellowshipFortress && !region.sauronFortress;
  const keep = riseKey !== undefined ? "lotrfx-keep" : "";
  return (
    <span className={`flex w-full flex-col items-stretch gap-0.5 font-bold whitespace-nowrap ${text} ${className}`}>
      {(region.fellowshipUnits > 0 || region.fellowshipFortress) && (
        <span className="flex items-center justify-center gap-0.5 rounded-md border border-amber-300/80 bg-gradient-to-b from-amber-300 to-amber-600 px-1 text-black shadow-[0_0_6px_rgba(251,191,36,.6)]">
          {region.fellowshipUnits > 0 && <span title={`원정대 유닛 ${region.fellowshipUnits}개`}>💍 원정대 x{region.fellowshipUnits}</span>}
          {region.fellowshipFortress && (
            <span key={riseKey !== undefined ? `f${riseKey}` : "f"} title="원정대 요새 (전투로 파괴되지 않음)" className={keep}>
              {region.fellowshipUnits > 0 ? "🏰" : "🏰 원정대 요새"}
            </span>
          )}
        </span>
      )}
      {(region.sauronUnits > 0 || region.sauronFortress) && (
        <span className="flex items-center justify-center gap-0.5 rounded-md border border-red-400/70 bg-gradient-to-b from-red-800 to-red-950 px-1 text-red-50 shadow-[0_0_6px_rgba(244,63,94,.55)]">
          {region.sauronUnits > 0 && <span title={`사우론 유닛 ${region.sauronUnits}개`}>👁️ 사우론 x{region.sauronUnits}</span>}
          {region.sauronFortress && (
            <span key={riseKey !== undefined ? `s${riseKey}` : "s"} title="사우론 요새 (전투로 파괴되지 않음)" className={keep}>
              {region.sauronUnits > 0 ? "🌋" : "🌋 사우론 요새"}
            </span>
          )}
        </span>
      )}
      {empty && <span className="text-center font-normal text-white/30 light:text-slate-400">주둔 없음</span>}
    </span>
  );
}
