"use client";

import { AUG_BY_ID, AUG_REROLLS, AUG_ROUNDS, AUG_TIER_NAME, augIndexOf, type AugId, type AugTier } from "./augments";
import type { GameState, Seat, SeatState } from "./engine";

/**
 * 🧬 증강 고르기 화면 — 같은 등급 3장 중 1장, 다시 뽑기 1번.
 * 남이 뭘 골랐는지는 전원이 다 고른 뒤(참가자 표의 칩)에만 보인다.
 */

const TIER_STYLE: Record<AugTier, { ring: string; chip: string; glow: string }> = {
  1: {
    ring: "border-slate-300/40 light:border-slate-300",
    chip: "bg-slate-200/15 text-slate-100 light:bg-slate-100 light:text-slate-700",
    glow: "from-slate-200/10",
  },
  2: {
    ring: "border-amber-300/50 light:border-amber-400",
    chip: "bg-amber-300/20 text-amber-100 light:bg-amber-100 light:text-amber-800",
    glow: "from-amber-300/15",
  },
  3: {
    ring: "border-fuchsia-300/60 light:border-fuchsia-400",
    chip: "bg-fuchsia-400/20 text-fuchsia-100 light:bg-fuchsia-100 light:text-fuchsia-800",
    glow: "from-fuchsia-400/20",
  },
};

export function AugChips({ seat, small }: { seat: SeatState; small?: boolean }) {
  if (!seat.augs?.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {seat.augs.map((id) => {
        const a = AUG_BY_ID[id];
        return (
          <span
            key={id}
            title={`${a.name} — ${a.desc}`}
            className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 ${small ? "text-[10.5px]" : "text-xs"} font-semibold ${TIER_STYLE[a.tier].chip}`}
          >
            {a.icon}
            <span>{a.name}</span>
          </span>
        );
      })}
    </span>
  );
}

export function nextAugRound(round: number): number | null {
  return (AUG_ROUNDS as readonly number[]).find((r) => r > round) ?? null;
}

export default function AugmentPicker({
  state,
  me,
  secsLeft,
  onPick,
  onReroll,
}: {
  state: GameState;
  me: Seat;
  secsLeft: number | null;
  onPick: (id: AugId) => void;
  onReroll: () => void;
}) {
  const aug = state.aug;
  const mine = state.seats[me];
  if (!aug || !mine) return null;
  const offer = aug.offers[me] ?? [];
  const done = aug.done[me];
  const picked = aug.picks[me];
  const left = AUG_REROLLS - (mine.rerollsUsed ?? 0);
  const waiting = aug.done.filter((d) => !d).length;
  const style = TIER_STYLE[aug.tier];
  const no = augIndexOf(state.round) + 1;

  return (
    <div className={`flex flex-col gap-3 rounded-2xl border bg-gradient-to-b to-transparent p-3 ${style.ring} ${style.glow}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="break-keep text-sm font-bold text-white light:text-slate-900">
          🧬 증강 {no}/{AUG_ROUNDS.length} — <span className={`rounded-full px-2 py-0.5 text-xs ${style.chip}`}>{AUG_TIER_NAME[aug.tier]}</span>
        </p>
        <span className="text-xs text-white/55 light:text-slate-500">
          모두 같은 등급 · 고른 증강은 다 고른 뒤 공개{secsLeft !== null && <b className={`ml-2 font-mono ${secsLeft <= 3 ? "text-rose-400" : "text-white/80 light:text-slate-700"}`}>{secsLeft}s</b>}
        </span>
      </div>
      {mine.confirmed ? (
        <p className="text-sm text-white/60 light:text-slate-500">☠ 사망이 확인돼서 증강을 고르지 않아요.</p>
      ) : done ? (
        <p className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100 light:text-emerald-700">
          ✅ {picked ? `${AUG_BY_ID[picked].icon} ${AUG_BY_ID[picked].name}` : "선택"} — 다른 사람을 기다리는 중… ({waiting}명 남음)
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {offer.map((id, i) => {
              const a = AUG_BY_ID[id];
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onPick(id)}
                  className={`flex min-h-[44px] items-start gap-2 rounded-xl border bg-white/[0.04] px-3 py-2.5 text-left transition hover:-translate-y-0.5 hover:bg-white/[0.08] light:bg-white ${style.ring}`}
                >
                  <span className="text-2xl leading-none">{a.icon}</span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-bold text-white light:text-slate-900">
                      <span className="mr-1 hidden font-mono text-[10px] text-white/35 sm:inline light:text-slate-400">{i + 1}</span>
                      {a.name}
                    </span>
                    <span className="break-keep text-[12px] leading-snug text-white/65 light:text-slate-600">{a.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-white/45 light:text-slate-400">시간이 지나면 첫 번째 카드가 골라져요.</span>
            <button
              type="button"
              disabled={left <= 0}
              onClick={onReroll}
              className="rounded-full border border-white/20 px-3 py-1.5 text-xs font-semibold text-white/80 disabled:opacity-40 light:border-slate-300 light:text-slate-600"
            >
              🎲 다시 뽑기 ({left}/{AUG_REROLLS})
            </button>
          </div>
        </>
      )}
    </div>
  );
}
