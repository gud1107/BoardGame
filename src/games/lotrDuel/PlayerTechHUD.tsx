"use client";

import { useState } from "react";
import { SealStamp } from "./CardArt";
import { FACTION_EMOJI, FACTION_LABEL, RACES, TECHS, TECH_INFO } from "./data";
import { raceSymbols, techProduction, type Faction, type LotrDuelState, type TechSymbol } from "./engine";
import type { CardPreview } from "./fxEvents";
import PlayerPassivesHUD, { type PassiveTrigger } from "./PlayerPassivesHUD";

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

const TECH_EN: Record<TechSymbol, string> = { BOOK: "Lore", FLAG: "Command", SWORD: "Might", MASK: "Cunning", COURAGE: "Courage" };

type Info = { key: string; title: string; lines: string[] };

export default function PlayerTechHUD({
  state,
  faction,
  preview,
  trigger,
}: {
  state: LotrDuelState;
  faction: Faction;
  preview?: CardPreview | null;
  trigger?: PassiveTrigger | null;
}) {
  const p = state.players[faction];
  const { fixed, choices, wild } = techProduction(p);
  const races = raceSymbols(p);
  // Hover shows the guide; a tap/click pins it (and a second tap closes it) — works on phones too.
  const [hover, setHover] = useState<Info | null>(null);
  const [pinned, setPinned] = useState<Info | null>(null);
  const shown = pinned ?? hover;
  const bind = (info: Info) => ({
    onMouseEnter: () => setHover(info),
    onMouseLeave: () => setHover(null),
    onClick: () => setPinned((cur) => (cur?.key === info.key ? null : info)),
  });
  const techInfo = (t: TechSymbol): Info => ({
    key: t,
    title: `${TECH_INFO[t].emoji} ${TECH_INFO[t].name} (${TECH_EN[t]}) — ${fixed[t]}개 보유`,
    lines: [
      fixed[t] > 0 ? `효과: 카드·랜드마크 비용의 '${TECH_INFO[t].name}' 기호를 매 턴 ${fixed[t]}개까지 무료로 공급 (쓰고 사라지지 않음)` : `아직 '${TECH_INFO[t].name}' 기호를 생산하는 회색 카드가 없습니다.`,
      "팁: 없는 기술 기호는 카드 구매 시 1개당 1주화로 대신 지불할 수 있습니다.",
    ],
  });
  return (
    <div className="sticky bottom-2 z-30 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl border border-amber-500/35 bg-neutral-950/92 py-2 pr-16 pl-3 text-white shadow-[0_6px_30px_rgba(0,0,0,.6)] backdrop-blur-md select-none">
      <span className="hidden text-xs font-bold text-neutral-300 sm:inline">
        {FACTION_EMOJI[faction]} 내 진영: {FACTION_LABEL[faction]}
      </span>
      <span
        data-lotr-coins
        className={`relative flex items-center gap-1 rounded-xl border-white/10 px-1.5 pr-2 sm:border-l sm:pl-3 ${preview?.coins ? "lotrp-gold" : ""}`}
        title="보유 주화"
      >
        <span className="text-sm">🪙</span>
        <span className="font-mono text-sm font-black text-amber-300">{p.coins}</span>
        {preview?.coins ? <span className="lotrp-float absolute -top-4 left-1/2 -translate-x-1/2 font-mono text-[11px] font-black text-amber-200">+{preview.coins}</span> : null}
      </span>
      <span className="flex items-center gap-1.5" aria-label="내 기술 기호">
        {TECHS.map((t) => {
          const n = fixed[t];
          const has = n > 0;
          return (
            <button
              key={t}
              type="button"
              data-lotr-tech={t}
              {...bind(techInfo(t))}
              aria-label={`${TECH_INFO[t].name} ${n}개 — 설명 보기`}
              className={`relative flex h-11 w-10 flex-col items-center justify-center rounded-xl border text-sm leading-none transition ${
                has ? `${TECH_TONE[t]} bg-neutral-900 shadow-[0_0_10px_rgba(251,191,36,.35)]` : "border-dashed border-neutral-700 bg-neutral-950/50 opacity-45 grayscale hover:opacity-80"
              } ${shown?.key === t ? "ring-2 ring-amber-300" : ""} ${preview?.techs?.includes(t) ? "lotrp-tech !opacity-100 !grayscale-0" : ""}`}
            >
              {preview?.techs?.includes(t) && <span className="lotrp-float absolute -top-4 left-1/2 -translate-x-1/2 font-mono text-[10px] font-black text-amber-200">+1</span>}
              {TECH_INFO[t].emoji}
              <span className="mt-0.5 font-serif text-[9px] font-bold">{TECH_INFO[t].name}</span>
              {has && <span className="absolute -top-1.5 -right-1.5 rounded-full border border-amber-400 bg-neutral-900 px-1 font-mono text-[9px] font-black text-amber-300">x{n}</span>}
            </button>
          );
        })}
      </span>
      {(choices.length > 0 || wild > 0) && (
        <span className="flex flex-wrap items-center gap-1">
          {choices.map((c, i) => (
            <button
              key={i}
              type="button"
              {...bind({
                key: `choice${i}`,
                title: `${c.map((s) => `${TECH_INFO[s].emoji} ${TECH_INFO[s].name}`).join(" / ")} — 선택형`,
                lines: ["효과: 매 턴 둘 중 하나를 생산합니다. 카드 비용을 계산할 때 가장 유리한 쪽이 자동으로 적용됩니다.", "팁: 없는 기술 기호는 1개당 1주화로 대신 지불할 수 있습니다."],
              })}
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-bold text-amber-200"
            >
              {c.map((s) => TECH_INFO[s].emoji).join("/")} 택1
            </button>
          ))}
          {wild > 0 && (
            <button
              type="button"
              {...bind({ key: "wild", title: "⛏️ 드워프 장인 (동맹 토큰)", lines: ["효과: 차례마다 원하는 기술 기호 1개를 무료로 공급합니다. 비용 계산에 자동 적용됩니다."] })}
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-bold text-amber-200"
            >
              ⛏️ 아무거나 1
            </button>
          )}
        </span>
      )}
      <PlayerPassivesHUD tokens={p.allianceTokens} trigger={trigger} />
      <span className="shrink-0 font-mono text-[11px] font-bold text-emerald-300 sm:hidden" title="종족 기호">
        🌿 {races.size}/6
      </span>
      <span className="ml-auto hidden items-center gap-0.5 sm:flex" title={`종족 기호 ${races.size}/6`}>
        {RACES.map((r) => (
          <span key={r} data-lotr-race={r} className={`h-6 w-6 rounded-full ${preview?.race === r ? "lotrp-ember" : races.has(r) ? "" : "opacity-25 grayscale"}`}>
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
      {shown && (
        <div className="absolute bottom-full left-1/2 z-40 mb-2 w-72 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-2xl border border-amber-400/60 bg-neutral-900/95 p-3 text-left shadow-2xl backdrop-blur-md" role="tooltip">
          <div className="mb-1.5 flex items-center justify-between gap-2 border-b border-white/10 pb-1.5">
            <span className="font-serif text-xs font-bold text-amber-300">{shown.title}</span>
            {pinned && (
              <button type="button" onClick={() => setPinned(null)} className="text-xs text-neutral-400 hover:text-white" aria-label="설명 닫기">
                ✕
              </button>
            )}
          </div>
          {shown.lines.map((l) => (
            <p key={l} className="text-[11px] leading-relaxed text-neutral-200">
              • {l}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
