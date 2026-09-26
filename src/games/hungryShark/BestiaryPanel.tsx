"use client";

import { useEffect, useRef, useState } from "react";
import { ENTITY_DEFS, healGain, NEVER, type EntityKind } from "./data";
import { BESTIARY_ORDER, BESTIARY_TIPS, habitatLabel, hazardTip, tierLabel } from "./markers";
import { drawEntityIcon } from "./render";

/**
 * 해양 생태계 먹이 도감 (Prey Bestiary). Rendered inline (not a portal) so it
 * also works over the canvas while the dive is in browser fullscreen — a
 * `document.body` portal would be invisible there.
 */

type Filter = "all" | "edible" | "locked" | "danger";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "edible", label: "🟢 사냥 가능" },
  { id: "locked", label: "🔴 티어 부족" },
  { id: "danger", label: "☠ 위험" },
];

export default function BestiaryPanel({
  tier,
  sharkName,
  biteLevel,
  eaten,
}: {
  tier: number;
  sharkName: string;
  biteLevel: number;
  /** This dive's eat counts, when opened mid-dive. */
  eaten?: Partial<Record<EntityKind, number>>;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const rows = BESTIARY_ORDER.map((kind) => {
    const def = ENTITY_DEFS[kind];
    const edible = def.requiredTier <= tier;
    return { kind, def, edible, danger: !edible && def.damage > 0 };
  }).filter((r) =>
    filter === "all" ? true : filter === "edible" ? r.edible : filter === "locked" ? !r.edible : r.danger,
  );
  const edibleCount = BESTIARY_ORDER.filter((k) => ENTITY_DEFS[k].requiredTier <= tier).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-white/80 light:text-slate-700">
          내 상어 티어: <b className="text-amber-400">{tierLabel(tier)}</b>
          <span className="ml-1 text-white/50 light:text-slate-500">({sharkName})</span>
          <span className="ml-2 text-xs text-white/45 light:text-slate-500">
            {BESTIARY_ORDER.length}종 중 {edibleCount}종 사냥 가능
          </span>
        </div>
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                filter === f.id
                  ? "bg-sky-500 text-white"
                  : "bg-white/5 text-white/60 hover:bg-white/10 light:bg-slate-100 light:text-slate-600"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {rows.map(({ kind, def, edible, danger }) => (
          <div
            key={kind}
            className={`flex gap-2.5 rounded-xl border p-2.5 ${
              edible
                ? "border-emerald-500/30 bg-emerald-500/[0.06]"
                : danger
                  ? "border-red-500/35 bg-red-500/[0.07]"
                  : "border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-slate-50"
            }`}
          >
            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-gradient-to-b from-sky-700/70 to-slate-900/90">
              <PreyIcon kind={kind} size={56} dim={!edible} />
              {!edible && (
                <span className="absolute right-0.5 bottom-0 text-sm drop-shadow">{danger ? "☠" : "🔒"}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-bold text-white light:text-slate-800">{def.name}</span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${
                    edible ? "bg-emerald-600/90 text-white" : "bg-red-700/90 text-white"
                  }`}
                >
                  {edible ? "사냥 가능" : def.requiredTier >= NEVER ? "메가 골드 러시 전용" : `티어 부족 (${tierLabel(def.requiredTier)})`}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] text-white/65 tabular-nums light:text-slate-600">
                {kind !== "chest" && <span>❤️ +{Math.round(healGain(def.heal, biteLevel))}</span>}
                <span>⭐ {def.score.toLocaleString()}점</span>
                <span>🪙 {def.coins}{def.coinChance < 1 ? ` (${Math.round(def.coinChance * 100)}%)` : ""}</span>
                <span>🌊 {habitatLabel(kind)}</span>
                {def.toughness > 1 && <span>🦷 여러 번 물기</span>}
                {eaten?.[kind] ? <span className="text-sky-300 light:text-sky-600">이번 잠수 ×{eaten[kind]}</span> : null}
              </div>
              {(danger || BESTIARY_TIPS[kind]) && (
                <div className={`mt-1 text-[11px] ${danger ? "text-red-300 light:text-red-700" : "text-white/45 light:text-slate-500"}`}>
                  {danger && <b>⚠️ {hazardTip(def)} · </b>}
                  {BESTIARY_TIPS[kind]}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-white/40 light:text-slate-400">
        상위 티어는 하위 티어의 먹이를 모두 먹을 수 있습니다. 골드 러시 중엔 사냥 가능한 먹이가 전부 황금색이 되고, 메가 골드 러시
        중엔 위 목록의 <b>모든 것</b>을 먹을 수 있습니다. ❤️ 회복량은 현재 물어뜯기 업그레이드가 반영된 값입니다.
      </p>
    </div>
  );
}

function PreyIcon({ kind, size, dim }: { kind: EntityKind; size: number; dim?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size * dpr;
    c.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.globalAlpha = dim ? 0.55 : 1;
    drawEntityIcon(ctx, kind, size, 1.3);
  }, [kind, size, dim]);
  return <canvas ref={ref} style={{ width: size, height: size }} className="block" />;
}
