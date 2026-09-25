"use client";

import { SealStamp } from "./CardArt";
import { FACTION_EMOJI, FACTION_LABEL, RACES, TECHS, TECH_INFO } from "./data";
import { raceSymbols, techProduction, type Faction, type LotrDuelState, type TechSymbol } from "./engine";

/**
 * Always-on "my tech" HUD — pinned to the bottom of the viewport (sticky
 * inside the game column) so the viewer can see, while drafting, exactly
 * which tech symbols they produce every turn: owned ones lit with a gold rim
 * and a count, missing ones dimmed (each missing symbol costs 1 coin), plus
 * choice cards ("📜/🎭 택1") and the Dwarf wild tech, coins and race seals.
 */

const TECH_TONE: Record<TechSymbol, string> = {
  BOOK: "border-sky-400/80 text-sky-200",
  FLAG: "border-amber-400/80 text-amber-200",
  SWORD: "border-rose-400/80 text-rose-200",
  MASK: "border-purple-400/80 text-purple-200",
  COURAGE: "border-emerald-400/80 text-emerald-200",
};

export default function PlayerTechHUD({ state, faction }: { state: LotrDuelState; faction: Faction }) {
  const p = state.players[faction];
  const { fixed, choices, wild } = techProduction(p);
  const races = raceSymbols(p);
  return (
    <div className="sticky bottom-2 z-30 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl border border-amber-500/35 bg-neutral-950/92 py-2 pr-16 pl-3 text-white shadow-[0_6px_30px_rgba(0,0,0,.6)] backdrop-blur-md select-none">
      <span className="hidden text-xs font-bold text-neutral-300 sm:inline">
        {FACTION_EMOJI[faction]} 내 진영: {FACTION_LABEL[faction]}
      </span>
      <span className="flex items-center gap-1 border-white/10 pr-2 sm:border-l sm:pl-3" title="보유 주화">
        <span className="text-sm">🪙</span>
        <span className="font-mono text-sm font-black text-amber-300">{p.coins}</span>
      </span>
      <span className="flex items-center gap-1.5" aria-label="내 기술 기호">
        {TECHS.map((t) => {
          const n = fixed[t];
          const has = n > 0;
          return (
            <span
              key={t}
              title={`${TECH_INFO[t].name} — ${has ? `매 턴 ${n}개 생산` : "없음 (필요 시 1개당 1주화)"}`}
              className={`relative flex h-8 w-8 items-center justify-center rounded-xl border text-sm transition ${
                has ? `${TECH_TONE[t]} bg-neutral-900 shadow-[0_0_10px_rgba(251,191,36,.35)]` : "scale-90 border-dashed border-neutral-700 bg-neutral-950/50 opacity-40 grayscale"
              }`}
            >
              {TECH_INFO[t].emoji}
              {has && <span className="absolute -top-1.5 -right-1.5 rounded-full border border-amber-400 bg-neutral-900 px-1 font-mono text-[9px] font-black text-amber-300">x{n}</span>}
            </span>
          );
        })}
      </span>
      {(choices.length > 0 || wild > 0) && (
        <span className="flex flex-wrap items-center gap-1">
          {choices.map((c, i) => (
            <span key={i} className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-bold text-amber-200" title="매 턴 둘 중 하나를 골라 생산 (비용 계산에 자동 적용)">
              {c.map((s) => TECH_INFO[s].emoji).join("/")} 택1
            </span>
          ))}
          {wild > 0 && (
            <span className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-bold text-amber-200" title="드워프 장인 — 차례마다 원하는 기술 1개">
              ⛏️ 아무거나 1
            </span>
          )}
        </span>
      )}
      <span className="ml-auto flex items-center gap-0.5" title={`종족 기호 ${races.size}/6`}>
        {RACES.map((r) => (
          <span key={r} className={`h-6 w-6 ${races.has(r) ? "" : "opacity-25 grayscale"}`}>
            <SealStamp race={r} />
          </span>
        ))}
        {races.has("EAGLE") && (
          <span className="h-6 w-6">
            <SealStamp race="EAGLE" />
          </span>
        )}
        <span className="ml-1 font-mono text-[11px] font-bold text-emerald-300">{races.size}/6</span>
      </span>
    </div>
  );
}
