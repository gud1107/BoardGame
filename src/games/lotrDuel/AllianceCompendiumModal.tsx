"use client";

import { useEffect, useState } from "react";
import { TOKEN_COMPENDIUM } from "./allianceCompendiumData";
import { FACTION_EMOJI, RACES, RACE_INFO, TOKENS, TOKEN_IDS_BY_RACE, otherFaction } from "./data";
import type { AllianceRace, AllianceTokenId, Faction, LotrDuelState } from "./types";

/**
 * Alliance Compendium — every one of the 18 alliance tokens (6 races × 3) with
 * its type, trigger, full effect and a strategy tip, plus a live ownership
 * badge: mine / the opponent's / still face-down in its race pile. A token only
 * ever lives in one of those three places (engine `PICK_TOKEN` moves it from
 * the pile to a tableau), so the badge is derived straight from `state`.
 *
 * Opened from the header's 📜 button at any time. Center of the viewport with
 * `max-h-[90dvh]` and inner scroll (race tabs + footer stay pinned); closes on
 * ✕, a backdrop tap or Escape.
 */

const KEYFRAMES = `
@keyframes lotrc-fade { 0% { opacity: 0 } 100% { opacity: 1 } }
@keyframes lotrc-in { 0% { opacity: 0; transform: translateY(12px) scale(.96) } 100% { opacity: 1; transform: none } }
`;

type Tab = AllianceRace | "ALL";
type Owner = "MINE" | "OPPONENT" | "DECK";

const RACE_TINT: Record<AllianceRace, string> = {
  ELF: "text-emerald-300",
  DWARF: "text-amber-300",
  HOBBIT: "text-lime-300",
  HUMAN: "text-sky-300",
  ENT: "text-teal-300",
  WIZARD: "text-fuchsia-300",
};

const OWNER_BADGE: Record<Owner, string> = {
  MINE: "border-emerald-400/70 bg-emerald-950/80 text-emerald-300",
  OPPONENT: "border-rose-500/70 bg-rose-950/80 text-rose-300",
  DECK: "border-neutral-700 bg-neutral-900 text-neutral-400",
};

export default function AllianceCompendiumModal({ state, myFaction, onClose }: { state: LotrDuelState; myFaction: Faction; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("ALL");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const oppFaction = otherFaction(myFaction);
  const ownerOf = (id: AllianceTokenId): Owner =>
    state.players[myFaction].allianceTokens.some((t) => t.id === id)
      ? "MINE"
      : state.players[oppFaction].allianceTokens.some((t) => t.id === id)
        ? "OPPONENT"
        : "DECK";
  const ownerLabel: Record<Owner, string> = {
    MINE: `${FACTION_EMOJI[myFaction]} 내가 보유 중`,
    OPPONENT: `${FACTION_EMOJI[oppFaction]} 상대가 보유 중`,
    DECK: "📦 미획득 · 더미 대기",
  };

  const ids = tab === "ALL" ? RACES.flatMap((r) => TOKEN_IDS_BY_RACE[r]) : TOKEN_IDS_BY_RACE[tab];
  const mineCount = state.players[myFaction].allianceTokens.length;
  const oppCount = state.players[oppFaction].allianceTokens.length;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-3 backdrop-blur-md sm:p-5"
      style={{ animation: "lotrc-fade .2s ease-out" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="종족 동맹 능력 도감"
    >
      <style>{KEYFRAMES}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border-2 border-amber-500/60 bg-neutral-950/95 p-4 text-neutral-100 shadow-[0_0_60px_rgba(245,158,11,0.25)] sm:p-6"
        style={{ animation: "lotrc-in .25s cubic-bezier(.2,.8,.2,1)" }}
      >
        {/* header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 pb-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-2xl">📜</span>
            <div className="min-w-0">
              <h2 className="font-serif text-base font-black tracking-wider text-amber-200 sm:text-lg">종족 동맹 능력 도감</h2>
              <p className="text-[11px] text-neutral-400">
                6종족 × 3 = 18개 동맹 토큰 · 내 보유 {mineCount} · 상대 보유 {oppCount} · 더미 {18 - mineCount - oppCount}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900 text-sm text-neutral-400 transition-colors hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* race filter tabs */}
        <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-white/5 py-2.5" role="tablist">
          {(["ALL", ...RACES] as Tab[]).map((key) => {
            const on = tab === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setTab(key)}
                className={`flex shrink-0 items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-bold transition-all ${
                  on ? "border-amber-400 bg-amber-500/20 text-white shadow-[0_0_10px_rgba(251,191,36,0.4)]" : "border-neutral-800 bg-neutral-900/80 text-neutral-400 hover:border-neutral-600"
                }`}
              >
                <span>{key === "ALL" ? "📜" : RACE_INFO[key].emoji}</span>
                <span className={key === "ALL" ? "text-amber-300" : RACE_TINT[key]}>{key === "ALL" ? "전체 (18)" : `${RACE_INFO[key].name} (3)`}</span>
              </button>
            );
          })}
        </div>

        {/* token cards */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto overscroll-contain py-2 pr-1 md:grid-cols-2 lg:grid-cols-3">
          {ids.map((id) => {
            const token = TOKENS[id];
            const info = TOKEN_COMPENDIUM[id];
            const owner = ownerOf(id);
            return (
              <div
                key={id}
                data-token={id}
                data-owner={owner}
                className={`group relative flex flex-col justify-between rounded-2xl border-2 bg-gradient-to-b from-neutral-900/90 via-[#11121c] to-neutral-950 p-3.5 shadow-md transition-colors hover:border-amber-500/50 ${
                  owner === "MINE" ? "border-emerald-500/40" : owner === "OPPONENT" ? "border-rose-500/30" : "border-neutral-800"
                }`}
              >
                <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-1">
                    <span className="rounded-md border border-amber-500/30 bg-black/60 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                      {token.isOneShot ? "⚡ 획득 즉시 1회" : "♾️ 영구 지속"}
                    </span>
                    <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${OWNER_BADGE[owner]}`}>{ownerLabel[owner]}</span>
                  </div>
                  <h3 className="flex items-center gap-1.5 font-serif text-sm font-black text-amber-100 transition-colors group-hover:text-amber-300">
                    <span>{RACE_INFO[token.race].emoji}</span>
                    <span>{token.name}</span>
                    <span className={`text-[10px] font-bold ${RACE_TINT[token.race]}`}>{RACE_INFO[token.race].name}</span>
                  </h3>
                  <div className="mt-1.5 rounded-lg border border-white/5 bg-black/40 px-2 py-1 text-[11px] text-cyan-300">
                    <span className="text-neutral-400">조건:</span> {info.triggerCondition}
                  </div>
                  <p className="mt-2 rounded-xl border border-white/5 bg-neutral-950/60 p-2.5 text-xs leading-relaxed text-neutral-200">{info.detail}</p>
                </div>
                <div className="mt-2.5 border-t border-white/5 pt-2 text-[11px] leading-snug text-neutral-400">
                  <span className="font-bold text-amber-400">💡 전략 팁:</span> {info.strategyTip}
                </div>
              </div>
            );
          })}
        </div>

        {/* footer */}
        <div className="mt-1 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3 text-[11px] text-neutral-400">
          <span>※ 같은 종족 초록 카드 2장 → 그 종족 더미 위 2장 중 1장 · 서로 다른 3종족 → 각 더미 맨 위 중 1장 (1회)</span>
          <button type="button" onClick={onClose} className="rounded-xl bg-neutral-800 px-4 py-1.5 text-xs font-bold text-neutral-200 transition-colors hover:bg-neutral-700">
            도감 닫기
          </button>
        </div>
      </div>
    </div>
  );
}
