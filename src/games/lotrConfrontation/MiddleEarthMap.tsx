"use client";

import { CHARACTERS, REGIONS } from "./data";
import type { CharacterId, Faction } from "./types";

/**
 * The Shire→Mordor board. Pure presentation: the Board decides what's
 * selectable/targetable and passes plain props in.
 *
 * Fog of war: `tokens` already carries `hidden` for enemy pieces that were
 * never revealed in combat — those render as a dark rune stand with no
 * identity at all (the character id is simply not passed down).
 *
 * Orientation: the viewer's own home is always at the bottom, so the Sauron
 * player sees Mordor at the bottom and the Shire at the top.
 */

export interface MapToken {
  id: CharacterId;
  faction: Faction;
  regionId: string;
  hidden: boolean;
  mine: boolean;
  frozen?: boolean;
}

interface Props {
  viewerFaction: Faction;
  tokens: MapToken[];
  selectedId: CharacterId | null;
  /** region → "move" (peaceful) | "attack" */
  targets: Record<string, "move" | "attack">;
  /** Regions to softly highlight (e.g. setup zone with free slots). */
  softRegions?: string[];
  lastMove?: { from: string; to: string } | null;
  battleRegion?: string | null;
  onTokenClick?: (id: CharacterId) => void;
  onRegionClick?: (regionId: string) => void;
}

const EDGES: [string, string][] = (() => {
  const seen = new Set<string>();
  const out: [string, string][] = [];
  for (const r of Object.values(REGIONS)) {
    for (const n of r.adjacentRegions) {
      const key = [r.id, n].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([r.id, n]);
    }
  }
  return out;
})();

export default function MiddleEarthMap({ viewerFaction, tokens, selectedId, targets, softRegions = [], lastMove, battleRegion, onTokenClick, onRegionClick }: Props) {
  const flip = viewerFaction === "SAURON";
  const pos = (id: string) => {
    const r = REGIONS[id];
    return { x: r.x, y: flip ? 100 - r.y : r.y };
  };

  return (
    <div className="lotr-map relative mx-auto aspect-square w-full max-w-[min(100%,50dvh)] md:aspect-[4/5] overflow-hidden rounded-3xl border border-amber-600/30 bg-[radial-gradient(ellipse_at_50%_0%,rgba(127,29,29,0.35),transparent_55%),radial-gradient(ellipse_at_50%_100%,rgba(21,128,61,0.22),transparent_55%),linear-gradient(180deg,#0b0a10,#13111c_50%,#0a0c0b)] shadow-[0_0_40px_rgba(245,158,11,0.08),inset_0_0_60px_rgba(0,0,0,0.6)] md:max-w-[560px]">
      {/* Faint parchment grain + rim light */}
      <div className="pointer-events-none absolute inset-0 rounded-3xl ring-1 ring-inset ring-amber-300/10" />
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {EDGES.map(([a, b]) => {
          const pa = pos(a);
          const pb = pos(b);
          const active = lastMove && ((lastMove.from === a && lastMove.to === b) || (lastMove.from === b && lastMove.to === a));
          return (
            <line
              key={`${a}-${b}`}
              x1={pa.x}
              y1={pa.y}
              x2={pb.x}
              y2={pb.y}
              stroke={active ? "rgba(251,191,36,0.85)" : "rgba(217,180,110,0.22)"}
              strokeWidth={active ? 2.2 : 1.2}
              strokeDasharray={active ? undefined : "3 3"}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>

      {Object.values(REGIONS).map((region) => {
        const p = pos(region.id);
        const here = tokens.filter((t) => t.regionId === region.id);
        const target = targets[region.id];
        const soft = softRegions.includes(region.id);
        const isHome = region.isShire || region.isMordor;
        const isBattle = battleRegion === region.id;
        return (
          <div
            key={region.id}
            role={target || soft ? "button" : undefined}
            onClick={() => (target || soft) && onRegionClick?.(region.id)}
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
            className={[
              "absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-0.5 rounded-2xl border px-1.5 py-1 transition-all",
              isHome ? "w-[46%] min-h-[14%]" : "w-[30%] min-h-[14%]",
              region.isMountain
                ? "border-dashed border-sky-400/50 bg-sky-950/30"
                : region.isMordor
                  ? "border-red-500/40 bg-red-950/40"
                  : region.isShire
                    ? "border-emerald-500/40 bg-emerald-950/35"
                    : "border-amber-700/30 bg-neutral-950/60",
              target === "attack"
                ? "cursor-pointer ring-2 ring-rose-500 shadow-[0_0_18px_rgba(244,63,94,0.55)] animate-pulse"
                : target === "move"
                  ? "cursor-pointer ring-2 ring-amber-400 shadow-[0_0_16px_rgba(251,191,36,0.45)] animate-pulse"
                  : soft
                    ? "cursor-pointer ring-1 ring-amber-300/60"
                    : "",
              isBattle ? "ring-2 ring-rose-400 lotr-battle-glow" : "",
            ].join(" ")}
          >
            <span className="flex items-center gap-1 font-serif text-[10px] leading-none font-bold tracking-wide text-amber-200/90 sm:text-[11px]">
              {region.isMountain && <span aria-hidden>⛰️</span>}
              {region.isMordor && <span aria-hidden>👁️</span>}
              {region.isShire && <span aria-hidden>🏡</span>}
              {region.name}
              {target === "attack" && <span aria-hidden>⚔️</span>}
            </span>
            <span className="hidden text-[8px] leading-none text-amber-100/35 sm:inline">{region.isMountain ? "산맥 · 1개 제한" : `최대 ${region.capacity}`}</span>
            <div className="mt-0.5 flex min-h-8 flex-wrap items-center justify-center gap-1">
              {here.map((t) => (
                <Token key={t.id} token={t} selected={selectedId === t.id} onClick={onTokenClick} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Token({ token, selected, onClick }: { token: MapToken; selected: boolean; onClick?: (id: CharacterId) => void }) {
  const fellowship = token.faction === "FELLOWSHIP";
  const base = "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border text-base transition-transform sm:h-9 sm:w-9";
  if (token.hidden) {
    return (
      <span
        title="정체를 알 수 없는 적"
        className={`${base} ${fellowship ? "border-sky-400/40 bg-[linear-gradient(160deg,#1e293b,#0b1120)]" : "border-red-500/40 bg-[linear-gradient(160deg,#3f1010,#12070a)]"} shadow-[inset_0_0_8px_rgba(0,0,0,0.8)]`}
      >
        <span className={`font-serif text-sm font-black ${fellowship ? "text-sky-300/70" : "text-red-400/70"} lotr-rune`}>ᛟ</span>
      </span>
    );
  }
  const c = CHARACTERS[token.id];
  return (
    <button
      type="button"
      title={`${c.name} (전투력 ${c.basePower}) — ${c.abilityName}`}
      onClick={(e) => {
        // Enemy tokens let the tap fall through to their region (that's how you attack them).
        if (!token.mine) return;
        e.stopPropagation();
        onClick?.(token.id);
      }}
      className={[
        base,
        fellowship ? "border-sky-300/60 bg-[linear-gradient(160deg,#1d3a6e,#0c1a33)]" : "border-red-400/60 bg-[linear-gradient(160deg,#7f1d1d,#2a0a0a)]",
        token.mine ? "cursor-pointer" : "cursor-default",
        selected ? "z-10 scale-115 ring-2 ring-yellow-300 shadow-[0_0_14px_rgba(253,224,71,0.7)]" : "",
        token.mine ? "" : "opacity-95",
      ].join(" ")}
    >
      <span aria-hidden>{c.emoji}</span>
      <span className="absolute -right-1 -bottom-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full border border-black/40 bg-amber-300 px-0.5 text-[8px] font-black text-black">
        {c.basePower}
      </span>
      {token.frozen && <span className="absolute -top-1 -left-1 text-[10px]" aria-label="이동 불가">⛓️</span>}
    </button>
  );
}
