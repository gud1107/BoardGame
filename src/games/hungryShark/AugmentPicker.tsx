"use client";

import { AUG_BY_ID, AUG_TIER_LABEL, AUG_TIMES, type AugmentId, type AugTier } from "./augments";

/** Card frame per tier — text labels the tier too, so color isn't the only cue. */
export const AUG_TIER_STYLE: Record<AugTier, { frame: string; chip: string; label: string }> = {
  silver: {
    frame: "border-slate-300/70 bg-gradient-to-b from-slate-600/90 to-slate-800/95 shadow-slate-300/20",
    chip: "bg-slate-500/80 ring-slate-200/60",
    label: "text-slate-100",
  },
  gold: {
    frame: "border-amber-300/80 bg-gradient-to-b from-amber-700/90 to-stone-900/95 shadow-amber-400/30",
    chip: "bg-amber-600/80 ring-amber-200/70",
    label: "text-amber-200",
  },
  prism: {
    frame: "border-fuchsia-300/80 bg-gradient-to-br from-fuchsia-700/90 via-indigo-800/95 to-cyan-800/95 shadow-fuchsia-400/40",
    chip: "bg-gradient-to-br from-fuchsia-500/90 to-cyan-500/90 ring-fuchsia-200/70",
    label: "text-fuchsia-200",
  },
};

/**
 * 3-card augment offer, drawn over the frozen dive. Keys 1/2/3 pick, R rerolls
 * (wired in HungrySharkCanvas). Phones stack the cards as compact rows.
 */
export default function AugmentPicker({
  round,
  tier,
  cards,
  rerolls,
  owned,
  onPick,
  onReroll,
}: {
  round: number;
  tier: AugTier;
  cards: AugmentId[];
  rerolls: number;
  owned: AugmentId[];
  onPick: (id: AugmentId) => void;
  onReroll: () => void;
}) {
  const st = AUG_TIER_STYLE[tier];
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 overflow-y-auto bg-slate-950/75 p-3 backdrop-blur-sm sm:gap-3">
      <div className="text-center">
        <div className="text-[10px] font-bold tracking-[0.3em] text-white/50">
          {round + 1} / {AUG_TIMES.length} · 생존 {Math.floor(AUG_TIMES[round] / 60)}:{String(AUG_TIMES[round] % 60).padStart(2, "0")}
        </div>
        <div className={`text-xl font-black sm:text-2xl ${st.label}`}>🧬 {AUG_TIER_LABEL[tier]} 증강 — 하나를 고르세요</div>
        <div className="text-[11px] text-white/60">이번 잠수 동안만 유지 · 고르는 동안 바다는 멈춰 있어요</div>
      </div>
      <div className="flex w-full max-w-3xl flex-col gap-2 sm:flex-row sm:gap-3">
        {cards.map((id, i) => {
          const a = AUG_BY_ID[id];
          return (
            <button
              key={id}
              onClick={() => onPick(id)}
              className={`group flex flex-1 items-center gap-3 rounded-2xl border-2 p-3 text-left shadow-xl transition hover:-translate-y-0.5 hover:brightness-110 active:scale-[0.98] sm:flex-col sm:items-center sm:gap-2 sm:p-4 sm:text-center ${st.frame}`}
            >
              <span className="text-3xl drop-shadow sm:text-5xl">{a.icon}</span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:items-center">
                <span className="flex items-center gap-1.5">
                  <span className="text-sm font-black text-white sm:text-base">{a.name}</span>
                  <span className="rounded-full bg-black/40 px-1.5 py-px text-[9px] font-bold text-white/80">{a.tag}</span>
                </span>
                <span className="text-[11px] leading-snug text-white/85 sm:text-xs">{a.desc}</span>
              </span>
              <span className="hidden rounded bg-black/40 px-1.5 text-[10px] font-bold text-white/60 sm:inline">[{i + 1}]</span>
            </button>
          );
        })}
      </div>
      <button
        onClick={onReroll}
        disabled={rerolls <= 0}
        className="rounded-xl bg-white/10 px-4 py-2 text-xs font-bold text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        🔄 다시 뽑기 ({rerolls}회 남음){" "}
        <span className="hidden text-white/50 sm:inline">[R]</span>
      </button>
      {owned.length > 0 && (
        <div className="flex max-w-3xl flex-wrap justify-center gap-1 text-[10px] text-white/70">
          <span className="font-bold text-white/50">보유:</span>
          {owned.map((o) => (
            <span key={o} className="rounded-full bg-white/10 px-1.5 py-px">
              {AUG_BY_ID[o].icon} {AUG_BY_ID[o].name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Small icon row for the HUD (title = full description on hover). */
export function AugChips({ augs, className = "" }: { augs: AugmentId[]; className?: string }) {
  if (!augs.length) return null;
  return (
    <div className={`flex flex-wrap gap-0.5 ${className}`}>
      {augs.map((id) => {
        const a = AUG_BY_ID[id];
        return (
          <span
            key={id}
            title={`${a.name} (${AUG_TIER_LABEL[a.tier]}) — ${a.desc}`}
            className={`flex h-5 w-5 items-center justify-center rounded-md text-[11px] ring-1 ${AUG_TIER_STYLE[a.tier].chip}`}
          >
            {a.icon}
          </span>
        );
      })}
    </div>
  );
}

/** Full list with descriptions (pause menu / results). `themed` = follows light mode (results panel); the pause overlay is always dark. */
export function AugList({ augs, themed = false }: { augs: AugmentId[]; themed?: boolean }) {
  const lt = (c: string) => (themed ? ` ${c}` : "");
  if (!augs.length) return null;
  return (
    <div className="flex flex-col gap-1">
      {augs.map((id) => {
        const a = AUG_BY_ID[id];
        return (
          <div key={id} className="flex items-start gap-2 text-left text-[11px]">
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] ring-1 ${AUG_TIER_STYLE[a.tier].chip}`}>{a.icon}</span>
            <span>
              <b className={`text-white${lt("light:text-slate-900")}`}>{a.name}</b>{" "}
              <span className={`text-white/50${lt("light:text-slate-500")}`}>({AUG_TIER_LABEL[a.tier]})</span>{" "}
              <span className={`text-white/75${lt("light:text-slate-600")}`}>{a.desc}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
