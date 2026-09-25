"use client";

import { ADJACENCY, REGIONS, REGION_INFO } from "./data";
import { controlledCount } from "./engine";
import type { LotrDuelState, RegionId, RegionState } from "./types";

/**
 * 가운데땅 전술 지도 — the 7 regions as an ancient-parchment war map: an SVG
 * terrain layer (sea off Lindon, the Misty Mountains, Mirkwood, the Anduin,
 * the White Mountains, Mordor's ash ring, drifting fog), rune-marked
 * adjacency roads (movement follows these), and each region as a themed
 * plaque (its own gradient/glow, icon, landmark) carrying 3D faction badges.
 * A region where a fortress faces enemy units shows "⚔️ 대치".
 *
 * Geography is approximate (the rulebook has no map picture) — north-west
 * Lindon/Arnor to south-east Mordor. Regions in `targets` pulse and are
 * clickable; the FX props (rise / preview / drops / combat flash) layer on top.
 */

const REGION_THEME: Record<RegionId, { icon: string; landmark: string; en: string; gradient: string; border: string; glow: string }> = {
  LINDON: { icon: "⛵", landmark: "회색 항구", en: "Lindon", gradient: "from-teal-950/90 via-slate-900/90 to-neutral-950/90", border: "border-teal-500/50", glow: "shadow-[0_0_16px_rgba(20,184,166,.3)]" },
  ARNOR: { icon: "🏛️", landmark: "북부 고대 왕국", en: "Arnor", gradient: "from-sky-950/90 via-indigo-950/85 to-neutral-950/90", border: "border-sky-500/50", glow: "shadow-[0_0_16px_rgba(56,189,248,.3)]" },
  RHOVANION: { icon: "🌲", landmark: "에레보르 & 어둠숲", en: "Rhovanion", gradient: "from-amber-950/90 via-yellow-950/80 to-neutral-950/90", border: "border-amber-500/50", glow: "shadow-[0_0_16px_rgba(245,158,11,.3)]" },
  ENEDWAITH: { icon: "🗼", landmark: "아이센가드 & 고원", en: "Enedwaith", gradient: "from-purple-950/90 via-violet-950/80 to-neutral-950/90", border: "border-purple-500/50", glow: "shadow-[0_0_16px_rgba(168,85,247,.3)]" },
  ROHAN: { icon: "🐎", landmark: "헬름 협곡 & 초원", en: "Rohan", gradient: "from-emerald-950/90 via-green-950/80 to-neutral-950/90", border: "border-emerald-500/50", glow: "shadow-[0_0_16px_rgba(16,185,129,.3)]" },
  GONDOR: { icon: "👑", landmark: "미나스 티리스", en: "Gondor", gradient: "from-slate-700/90 via-neutral-900/90 to-neutral-950/90", border: "border-slate-300/60", glow: "shadow-[0_0_16px_rgba(203,213,225,.35)]" },
  MORDOR: { icon: "🌋", landmark: "바라드두르 & 운명의 산", en: "Mordor", gradient: "from-rose-950/95 via-red-950/85 to-neutral-950/95", border: "border-rose-600/70", glow: "shadow-[0_0_22px_rgba(225,29,72,.45)]" },
};

const RUNES = "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈ";

const MAP_KEYFRAMES = `
@keyframes lotrmap-fog { 0% { transform: translateX(-8%) } 50% { transform: translateX(8%) } 100% { transform: translateX(-8%) } }
@keyframes lotrmap-ember { 0%,100% { opacity: .35 } 50% { opacity: .75 } }
@keyframes lotrmap-standoff { 0%,100% { transform: scale(1) } 50% { transform: translateY(-2px) scale(1.08) } }
@media (prefers-reduced-motion: reduce) { .lotrmap-anim { animation: none !important } }
`;

/** Decorative terrain in the 0–100 map box (drawn under the roads and plaques). */
function Terrain() {
  const peaks = (pts: [number, number][], h: number, fill: string) =>
    pts.map(([x, y], i) => <path key={i} d={`M${x - h * 0.7} ${y} L${x} ${y - h} L${x + h * 0.7} ${y} Z`} fill={fill} stroke="#00000055" strokeWidth=".3" />);
  const trees = (pts: [number, number][]) =>
    pts.map(([x, y], i) => <path key={i} d={`M${x} ${y - 2.4} L${x + 1.3} ${y} L${x - 1.3} ${y} Z`} fill="#1f3b24" opacity=".85" />);
  return (
    <>
      <defs>
        <radialGradient id="lotrmap-parch" cx="45%" cy="40%" r="75%">
          <stop offset="0%" stopColor="#3a2e18" />
          <stop offset="60%" stopColor="#1d170d" />
          <stop offset="100%" stopColor="#0c0906" />
        </radialGradient>
        <linearGradient id="lotrmap-sea" x1="0" x2="1">
          <stop offset="0%" stopColor="#0e3b44" />
          <stop offset="100%" stopColor="#0e3b44" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="lotrmap-mordor" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ea580c" stopOpacity=".55" />
          <stop offset="60%" stopColor="#7f1d1d" stopOpacity=".35" />
          <stop offset="100%" stopColor="#7f1d1d" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="100" height="100" fill="url(#lotrmap-parch)" />
      {/* parchment grain */}
      {Array.from({ length: 40 }, (_, i) => (
        <circle key={i} cx={(i * 37) % 100} cy={(i * 53) % 100} r={0.25 + (i % 3) * 0.15} fill="#d9b36b" opacity=".08" />
      ))}
      {/* western sea */}
      <path d="M0 0 H9 C6 20 11 35 5 50 C2 65 8 80 4 100 H0 Z" fill="url(#lotrmap-sea)" />
      {/* Anduin */}
      <path d="M58 0 C56 18 62 30 57 45 C53 58 60 68 56 80 C54 88 58 94 57 100" fill="none" stroke="#1e4f63" strokeWidth="1.1" opacity=".75" />
      {/* Misty Mountains (north–south between Arnor/Enedwaith and Rhovanion) */}
      {peaks(
        [
          [46, 12],
          [44, 22],
          [46, 32],
          [43, 42],
          [41, 50],
        ],
        5,
        "#4a4035",
      )}
      {/* White Mountains (south of Rohan) */}
      {peaks(
        [
          [40, 76],
          [47, 75],
          [54, 77],
        ],
        4,
        "#5b5448",
      )}
      {/* Mordor's mountain ring */}
      <circle cx={REGION_INFO.MORDOR.x} cy={REGION_INFO.MORDOR.y} r="18" fill="url(#lotrmap-mordor)" className="lotrmap-anim" style={{ animation: "lotrmap-ember 3s ease-in-out infinite" }} />
      {peaks(
        [
          [74, 50],
          [80, 46],
          [87, 45],
          [94, 48],
          [74, 74],
          [82, 78],
        ],
        4,
        "#2a1a18",
      )}
      {/* Mirkwood */}
      {trees([
        [70, 30],
        [73, 33],
        [76, 30],
        [79, 34],
        [72, 37],
        [77, 38],
        [81, 31],
      ])}
      {/* compass rose */}
      <g transform="translate(92 90)" opacity=".5">
        <circle r="4.5" fill="none" stroke="#b8893b" strokeWidth=".3" />
        <path d="M0 -5 L1 0 L0 5 L-1 0 Z" fill="#d4a54a" />
        <path d="M-5 0 L0 1 L5 0 L0 -1 Z" fill="#8a6421" />
        <text y="-6" textAnchor="middle" fontSize="2.6" fill="#d4a54a">
          N
        </text>
      </g>
    </>
  );
}

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
  const flash = state.combatFlash;

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-amber-700/40 shadow-2xl light:border-amber-300">
      <style>{MAP_KEYFRAMES}</style>
      {/* header: control summary */}
      <div className="relative z-10 flex items-center justify-between gap-2 border-b border-amber-700/30 bg-black/55 px-2.5 py-1.5 backdrop-blur-sm">
        <span className="font-serif text-[11px] font-black tracking-wider text-amber-200">🗺️ 가운데땅 전황 지도</span>
        <span className="flex gap-1.5 font-mono text-[10px] font-bold">
          <span className="rounded-md border border-amber-400/50 bg-amber-500/15 px-1.5 text-amber-200">💍 {controlledCount(state, "FELLOWSHIP")}/7</span>
          <span className="rounded-md border border-red-500/50 bg-red-950/60 px-1.5 text-rose-200">👁️ {controlledCount(state, "SAURON")}/7</span>
        </span>
      </div>
      <div className="relative">
        <svg viewBox="0 0 100 100" className="block aspect-[10/9] w-full" preserveAspectRatio="none" aria-hidden>
          <Terrain />
          {/* rune roads = adjacency (unit moves follow these) */}
          {edges.map(([a, b], i) => {
            const hot = selectedFrom !== null && (a === selectedFrom || b === selectedFrom);
            const mx = (REGION_INFO[a].x + REGION_INFO[b].x) / 2;
            const my = (REGION_INFO[a].y + REGION_INFO[b].y) / 2;
            return (
              <g key={`${a}-${b}`}>
                <line x1={REGION_INFO[a].x} y1={REGION_INFO[a].y} x2={REGION_INFO[b].x} y2={REGION_INFO[b].y} stroke="#000" strokeOpacity=".5" strokeWidth={hot ? 1.8 : 1.2} />
                <line
                  x1={REGION_INFO[a].x}
                  y1={REGION_INFO[a].y}
                  x2={REGION_INFO[b].x}
                  y2={REGION_INFO[b].y}
                  stroke={hot ? "#fcd34d" : "#c9973f"}
                  strokeOpacity={hot ? 1 : 0.55}
                  strokeWidth={hot ? 0.9 : 0.5}
                  strokeDasharray="1.6 1.1"
                />
                <circle cx={mx} cy={my} r="1.7" fill="#140f08" stroke="#c9973f" strokeOpacity=".7" strokeWidth=".25" />
                <text x={mx} y={my + 0.9} textAnchor="middle" fontSize="2.4" fill="#e7b85a" opacity=".85">
                  {RUNES[i % RUNES.length]}
                </text>
              </g>
            );
          })}
        </svg>
        {/* drifting fog */}
        <div className="lotrmap-anim pointer-events-none absolute inset-0 overflow-hidden" style={{ animation: "lotrmap-fog 18s ease-in-out infinite" }}>
          <div className="absolute top-[8%] left-[20%] h-[18%] w-[45%] rounded-full bg-slate-200/[0.06] blur-xl" />
          <div className="absolute top-[55%] left-[5%] h-[16%] w-[40%] rounded-full bg-slate-200/[0.05] blur-xl" />
          <div className="absolute top-[35%] right-[2%] h-[14%] w-[35%] rounded-full bg-slate-300/[0.05] blur-xl" />
        </div>
        {REGIONS.map((r) => {
          const info = REGION_INFO[r];
          const theme = REGION_THEME[r];
          const reg = state.boardRegions[r];
          const isTarget = targets.has(r);
          const isFrom = selectedFrom === r;
          const flashing = flash && flash.region === r;
          const standoff = (reg.fellowshipFortress && reg.sauronUnits > 0) || (reg.sauronFortress && reg.fellowshipUnits > 0) || (reg.fellowshipUnits > 0 && reg.sauronUnits > 0);
          return (
            <button
              key={r}
              type="button"
              disabled={!isTarget}
              onClick={() => onRegion(r)}
              title={`${info.name} (${theme.en}) — ${theme.landmark}`}
              style={{ left: `${info.x}%`, top: `${info.y}%` }}
              className={`absolute flex w-[27%] max-w-[136px] -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-xl border-2 bg-gradient-to-b px-1 pt-0.5 pb-1 text-center backdrop-blur-[2px] transition ${theme.gradient} ${
                isFrom ? "border-amber-300 ring-2 ring-amber-300" : isTarget ? "lotrd-target cursor-pointer border-emerald-300" : `${theme.border} ${theme.glow}`
              }`}
            >
              {flashing && <span key={flash.no} className="lotrd-clash pointer-events-none absolute inset-0 rounded-xl" />}
              {preview?.regions.includes(r) && <span className={`pointer-events-none absolute -inset-1 rounded-2xl ${preview.tone === "violet" ? "lotrp-violet" : "lotrp-red"}`} />}
              {drops?.items
                .filter((d) => d.region === r)
                .map((d) => (
                  <span key={`d${drops.key}${d.faction}`} className="pointer-events-none absolute -top-2 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center">
                    <span
                      className="lotrm-drop flex items-center gap-0.5 rounded-full border px-1.5 text-[11px] font-black whitespace-nowrap shadow-lg"
                      style={{
                        borderColor: d.faction === "FELLOWSHIP" ? "#fcd34d" : "#f87171",
                        background: d.faction === "FELLOWSHIP" ? "linear-gradient(#fde68a,#d97706)" : "linear-gradient(#991b1b,#450a0a)",
                        color: d.faction === "FELLOWSHIP" ? "#1c1917" : "#fef2f2",
                      }}
                    >
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
              {standoff && !flashing && (
                <span
                  className="lotrmap-anim pointer-events-none absolute -top-2.5 -right-2 z-10 rounded-full bg-rose-600/95 px-1.5 text-[9px] font-black whitespace-nowrap text-white shadow-[0_0_10px_rgba(244,63,94,.8)]"
                  style={{ animation: "lotrmap-standoff 1.2s ease-in-out infinite" }}
                >
                  ⚔️ 대치
                </span>
              )}
              {rise?.region === r && (
                <span key={`r${rise.key}`} className="pointer-events-none absolute inset-0 rounded-xl" style={{ boxShadow: "0 0 0 2px rgba(251,191,36,.9), 0 0 28px 6px rgba(251,191,36,.6)", animation: "lotrfx-rim 1.8s ease-out both" }} />
              )}
              <span className="flex items-center gap-0.5 text-[clamp(9px,1.8vw,13px)] leading-tight font-black text-amber-100 drop-shadow">
                <span className="text-[0.95em]">{theme.icon}</span>
                {info.name}
              </span>
              <span className="w-full truncate text-[clamp(6.5px,1.2vw,9px)] leading-tight text-white/55">{theme.landmark}</span>
              <FactionBadges region={reg} riseKey={rise?.region === r ? rise.key : undefined} className="mt-0.5" />
            </button>
          );
        })}
      </div>
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
        <span className="flex items-center justify-center gap-0.5 rounded-md border border-amber-200/90 bg-gradient-to-b from-amber-200 via-amber-400 to-amber-700 px-1 text-black shadow-[inset_0_1px_0_rgba(255,255,255,.7),inset_0_-2px_0_rgba(120,53,15,.6),0_2px_4px_rgba(0,0,0,.6),0_0_8px_rgba(251,191,36,.55)]">
          {region.fellowshipUnits > 0 && <span title={`원정대 유닛 ${region.fellowshipUnits}개`}>💍 원정대 x{region.fellowshipUnits}</span>}
          {region.fellowshipFortress && (
            <span key={riseKey !== undefined ? `f${riseKey}` : "f"} title="원정대 요새 (전투로 파괴되지 않음)" className={keep}>
              {region.fellowshipUnits > 0 ? "🏰" : "🏰 원정대 요새"}
            </span>
          )}
        </span>
      )}
      {(region.sauronUnits > 0 || region.sauronFortress) && (
        <span className="flex items-center justify-center gap-0.5 rounded-md border border-red-400/80 bg-gradient-to-b from-red-600 via-red-800 to-red-950 px-1 text-red-50 shadow-[inset_0_1px_0_rgba(255,255,255,.35),inset_0_-2px_0_rgba(0,0,0,.5),0_2px_4px_rgba(0,0,0,.6),0_0_8px_rgba(244,63,94,.55)]">
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
