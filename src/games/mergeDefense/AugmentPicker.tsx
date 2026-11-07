"use client";

import { useState } from "react";
import { AUGMENTS, AUG_PICK_TICKS, AUG_REROLLS, AUG_TIER_INFO, AUG_WAVES, type AugmentId, type AugTier } from "./augments";
import type { Board } from "./engine";

const TIER_BG: Record<AugTier, string> = {
  silver: "from-slate-600/95 to-slate-800/95",
  gold: "from-amber-600/95 to-amber-900/95",
  prism: "from-fuchsia-600/95 via-violet-700/95 to-sky-700/95",
};

/**
 * ✨ 증강 pick card row, laid over my board while an offer is open. The game
 * keeps running underneath, so it can fold into a pill ("접기") and the
 * first card is taken when the timer hits 0.
 */
export function AugmentPicker({ board, tick, onPick, onReroll }: { board: Board; tick: number; onPick: (id: AugmentId) => void; onReroll: () => void }) {
  const [folded, setFolded] = useState<number | null>(null);
  const offer = board.augOffer;
  if (!offer) return null;
  const left = Math.max(0, Math.ceil((offer.until - tick) / 20));
  const pct = Math.max(0, Math.min(1, (offer.until - tick) / AUG_PICK_TICKS));
  const tier = AUG_TIER_INFO[offer.tier];
  const rerollsLeft = AUG_REROLLS - (board.augRerolls ?? 0);
  if (folded === offer.round) {
    return (
      <button
        onClick={() => setFolded(null)}
        className="absolute top-2 left-1/2 z-20 -translate-x-1/2 animate-pulse rounded-full border-2 px-3 py-1 text-xs font-black text-white shadow-lg"
        style={{ borderColor: tier.color, background: "rgba(15,23,42,0.9)" }}
      >
        ✨ 증강 고르기 · {left}초
      </button>
    );
  }
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-slate-950/70 p-1.5 backdrop-blur-[2px] sm:gap-2 sm:p-3" role="dialog" aria-label="증강 선택">
      <div className="flex w-full max-w-[560px] items-center justify-between gap-2 text-white">
        <p className="text-xs font-black sm:text-sm">
          ✨ 증강 {offer.round + 1}/{AUG_WAVES.length}{" "}
          <span className="whitespace-nowrap" style={{ color: tier.color }}>
            {tier.mark}
            <span className="hidden min-[400px]:inline"> {tier.name}</span>
          </span>
        </p>
        <span className="flex items-center gap-1">
          <button
            onClick={onReroll}
            disabled={rerollsLeft <= 0}
            className="rounded-full border border-white/30 bg-white/10 px-2 py-0.5 text-[11px] font-bold whitespace-nowrap disabled:opacity-35"
            title="세 장을 새로 뽑아요 (한 판에 한 번)"
            aria-label={`새로고침 ${rerollsLeft}회 남음`}
          >
            🔄<span className="hidden min-[400px]:inline"> 새로고침</span> {rerollsLeft}
          </button>
          <button onClick={() => setFolded(offer.round)} className="rounded-full border border-white/30 bg-white/10 px-2 py-0.5 text-[11px] font-bold whitespace-nowrap" title="잠깐 접고 보드 보기 (게임은 계속 진행돼요)">
            ▾ 접기
          </button>
        </span>
      </div>
      <div className="grid w-full max-w-[560px] grid-cols-3 gap-1.5 sm:gap-2">
        {offer.cards.map((id, i) => {
          const def = AUGMENTS[id];
          if (!def) return null;
          return (
            <button
              key={`${offer.round}-${id}`}
              onClick={() => onPick(id)}
              className={`flex min-h-[96px] animate-[md-pop_0.35s_ease-out] flex-col items-center gap-0.5 rounded-xl border-2 bg-gradient-to-b p-1.5 text-center text-white shadow-xl transition hover:-translate-y-0.5 active:scale-95 sm:min-h-[130px] sm:p-2 ${TIER_BG[def.tier]}`}
              style={{ borderColor: AUG_TIER_INFO[def.tier].color, animationDelay: `${i * 70}ms` }}
            >
              <span className="text-2xl leading-none sm:text-3xl" aria-hidden>
                {def.emoji}
              </span>
              <b className="text-[12px] leading-tight break-keep sm:text-sm">{def.name}</b>
              <span className="text-[10px] leading-snug break-keep opacity-90 sm:text-[11px]">{def.desc}</span>
              <span className="mt-auto rounded-full bg-black/30 px-1.5 text-[9px] font-semibold opacity-80">
                {AUG_TIER_INFO[def.tier].mark} {def.tag}
              </span>
            </button>
          );
        })}
      </div>
      {/* pr-9 keeps the countdown clear of the 📜 log tab on the board's right edge. */}
      <div className="flex w-full max-w-[560px] items-center gap-2 pr-12 text-[10px] text-white/80 sm:pr-0">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/15">
          <div className="h-full rounded-full bg-amber-300 transition-[width] duration-200" style={{ width: `${pct * 100}%` }} />
        </div>
        <span className="font-mono whitespace-nowrap">
          {left}초<span className="hidden min-[400px]:inline"> 뒤 첫 카드 자동</span>
        </span>
      </div>
    </div>
  );
}

/** Compact chips of a board's augments (emoji + name; tap/hover shows the effect). */
export function AugmentChips({ ids, compact = false }: { ids: readonly AugmentId[] | undefined; compact?: boolean }) {
  if (!ids || ids.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {ids.map((id) => {
        const def = AUGMENTS[id];
        if (!def) return null;
        return (
          <span
            key={id}
            title={`${def.name} (${AUG_TIER_INFO[def.tier].name}) — ${def.desc}`}
            className="inline-flex items-center gap-0.5 rounded-full border bg-black/30 px-1.5 py-0.5 text-[10px] font-semibold text-white light:bg-white light:text-slate-800"
            style={{ borderColor: AUG_TIER_INFO[def.tier].color }}
          >
            <span aria-hidden>{def.emoji}</span>
            {!compact && <span>{def.name}</span>}
            <span className="sr-only">{compact ? def.name : ""} {AUG_TIER_INFO[def.tier].name}</span>
          </span>
        );
      })}
    </span>
  );
}
