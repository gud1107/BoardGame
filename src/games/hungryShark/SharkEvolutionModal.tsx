"use client";

import { BRANCH_INFO, sharkById, type SharkBranch, type SharkDef } from "./data";

/**
 * 진화 분기 선택 모달 — shows the current shark's next evolution choices
 * (5 branches from the reef shark, 3 sub-lines from each T2, then one or two) with stat
 * deltas, skill and passive, and an evolve button gated on coins.
 */

const BRANCH_BADGE: Record<SharkBranch, string> = {
  BASE: "bg-slate-800 text-slate-300 border-slate-600",
  BRUTE: "bg-rose-950 text-rose-300 border-rose-600",
  SPEED: "bg-sky-950 text-sky-300 border-sky-600",
  VOID: "bg-purple-950 text-purple-300 border-purple-600",
  FROST: "bg-cyan-950 text-cyan-200 border-cyan-500",
  VENOM: "bg-lime-950 text-lime-300 border-lime-600",
};

/** Branch-colored frames: each choice card, plus the dashed box around a branch's choices. */
const BRANCH_FRAME: Record<SharkBranch, { card: string; box: string; label: string }> = {
  BASE: { card: "border-neutral-600 hover:border-neutral-300", box: "border-neutral-700", label: "text-neutral-300" },
  BRUTE: { card: "border-rose-500/70 hover:border-rose-300", box: "border-rose-500/50 bg-rose-500/[0.05]", label: "text-rose-300" },
  SPEED: { card: "border-sky-500/70 hover:border-sky-300", box: "border-sky-500/50 bg-sky-500/[0.05]", label: "text-sky-300" },
  VOID: { card: "border-purple-500/70 hover:border-purple-300", box: "border-purple-500/50 bg-purple-500/[0.05]", label: "text-purple-300" },
  FROST: { card: "border-cyan-400/70 hover:border-cyan-200", box: "border-cyan-400/50 bg-cyan-400/[0.05]", label: "text-cyan-200" },
  VENOM: { card: "border-lime-500/70 hover:border-lime-300", box: "border-lime-500/50 bg-lime-500/[0.05]", label: "text-lime-300" },
};

/** "① 백상아리 라인 → 메갈로돈" — where a T3 choice leads (T2 → T3 picks only). */
function lineCaption(shark: SharkDef, index: number): string | null {
  if (shark.tier !== 3) return null;
  const ends = shark.nextIds.map((id) => sharkById(id).name);
  return `${String.fromCharCode(9312 + index)} ${shark.name} 라인${ends.length ? ` → ${ends.join(" / ")}` : ""}`;
}

export function BranchBadge({ branch }: { branch: SharkBranch }) {
  if (branch === "BASE") return null;
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap ${BRANCH_BADGE[branch]}`}>
      {BRANCH_INFO[branch].emoji} {BRANCH_INFO[branch].short}
    </span>
  );
}

/** One row for every choice: 5 T2 branches from the reef shark, 3 sub-lines from each T2. */
const GRID_COLS: Record<number, string> = {
  0: "grid-cols-1",
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-1 sm:grid-cols-3 lg:grid-cols-5",
};

function delta(n: number) {
  return n >= 0 ? `+${n}` : `${n}`;
}

export default function SharkEvolutionModal({
  currentSharkId,
  playerGold,
  owned,
  goldNote,
  closeLabel = "닫기",
  onEvolve,
  onClose,
}: {
  currentSharkId: string;
  playerGold: number;
  owned: string[];
  /** Small caption under the gold amount (e.g. "보유 + 이번 잠수"). */
  goldNote?: string;
  closeLabel?: string;
  onEvolve: (target: SharkDef) => void;
  onClose: () => void;
}) {
  const current = sharkById(currentSharkId);
  const nextOptions = current.nextIds.map(sharkById);
  const compact = nextOptions.length > 3;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md select-none" onClick={onClose}>
      <div
        className={`flex max-h-[92vh] w-full ${nextOptions.length > 3 ? "max-w-7xl" : "max-w-3xl"} flex-col gap-5 overflow-y-auto rounded-3xl border border-neutral-700 bg-neutral-900 p-5 text-white shadow-2xl sm:p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-neutral-800 pb-4">
          <div>
            <span className="text-xs text-neutral-400">현재 상어</span>
            <h2 className="flex items-center gap-2 text-lg font-black text-amber-400 sm:text-xl">
              🦈 {current.name} <span className="text-sm text-amber-200/70">(Tier {current.tier})</span>
            </h2>
          </div>
          <div className="text-right">
            <span className="text-xs text-neutral-400">보유 골드</span>
            <div className="font-mono text-lg font-black text-amber-300 sm:text-xl">🪙 {playerGold.toLocaleString()}</div>
            {goldNote && <div className="text-[10px] text-neutral-500">{goldNote}</div>}
          </div>
        </div>

        <div>
          <h3 className="mb-3 text-sm font-bold text-neutral-300">
            {nextOptions.length > 1
              ? "진화 분기 경로를 선택하세요 — 한 번 고른 계통은 그 계통의 다음 단계로만 이어집니다"
              : nextOptions.length === 1
                ? "다음 진화 단계"
                : "최종 진화 정점에 도달했습니다!"}
          </h3>

          <div
            className={
              current.branch === "BASE" || nextOptions.length === 0
                ? ""
                : `rounded-2xl border-2 border-dashed p-2.5 sm:p-3 ${BRANCH_FRAME[current.branch].box}`
            }
          >
            {current.branch !== "BASE" && nextOptions.length > 0 && (
              <div className={`mb-2 text-center text-xs font-black ${BRANCH_FRAME[current.branch].label}`}>
                {BRANCH_INFO[current.branch].emoji} {BRANCH_INFO[current.branch].name} 계통
              </div>
            )}
            <div className={`grid gap-3 ${GRID_COLS[Math.min(nextOptions.length, 5)]}`}>
              {nextOptions.map((shark, idx) => {
                const caption = nextOptions.length > 1 ? lineCaption(shark, idx) : null;
                const have = owned.includes(shark.id);
                const canAfford = playerGold >= shark.cost;
                // Many choices on a phone: compact rows so every option fits on one screen.
                const full = compact ? "hidden sm:block" : "";
                return (
                  <div
                    key={shark.id}
                    className={`flex justify-between rounded-2xl border-2 transition-all ${compact ? "flex-row items-center gap-2 p-2.5 sm:flex-col sm:items-stretch sm:gap-0 sm:p-3" : "flex-col p-4"} ${BRANCH_FRAME[shark.branch].card} ${
                      have || canAfford ? "bg-neutral-800/90 hover:scale-[1.02]" : "bg-neutral-950/60 opacity-60"
                    }`}
                  >
                    <div className={`flex min-w-0 flex-col ${compact ? "gap-0.5 sm:gap-2" : "gap-2"}`}>
                      <div className={`items-start justify-between gap-2 ${compact ? "hidden sm:flex" : "flex"}`}>
                        <span className="font-mono text-xs font-bold text-neutral-400">Tier {shark.tier}</span>
                        <BranchBadge branch={shark.branch} />
                      </div>
                      {caption && <div className={`truncate text-[10px] font-black ${BRANCH_FRAME[shark.branch].label}`}>{caption}</div>}
                      <h4 className={`font-bold text-neutral-100 ${compact ? "flex items-center gap-1.5 text-sm sm:text-base" : "text-base"}`}>
                        <span className="truncate">{shark.name}</span>
                        {compact && <span className="shrink-0 sm:hidden"><BranchBadge branch={shark.branch} /></span>}
                      </h4>
                      <p className={`line-clamp-2 text-xs text-neutral-400 ${full}`}>{shark.blurb}</p>
                      {compact && (
                        <div className="font-mono text-[11px] text-neutral-300 sm:hidden">
                          <span className="text-rose-300">❤ {shark.maxHealth}</span> · <span className="text-sky-300">💨 {shark.swimSpeed}</span> ·{" "}
                          <span className="text-orange-300">🦷 {shark.biteForce}</span> · <span className="text-amber-300">×{shark.goldMultiplier.toFixed(1)}</span>
                          <div className="truncate font-bold text-purple-300">⚡ {shark.skill.name} ({shark.skill.cooldown}s)</div>
                        </div>
                      )}

                      <div className={`mt-1 space-y-1 ${full} rounded-xl border border-white/5 bg-black/40 p-2 font-mono text-[11px]`}>
                        <div className="flex justify-between text-rose-300">
                          <span>체력</span>
                          <span>{shark.maxHealth} ({delta(shark.maxHealth - current.maxHealth)})</span>
                        </div>
                        <div className="flex justify-between text-sky-300">
                          <span>속도</span>
                          <span>{shark.swimSpeed} ({delta(shark.swimSpeed - current.swimSpeed)})</span>
                        </div>
                        <div className="flex justify-between text-orange-300">
                          <span>물기</span>
                          <span>{shark.biteForce} ({delta(shark.biteForce - current.biteForce)})</span>
                        </div>
                        <div className="flex justify-between text-amber-300">
                          <span>골드 배율</span>
                          <span>×{shark.goldMultiplier.toFixed(1)}</span>
                        </div>
                        <div className="flex justify-between text-amber-200">
                          <span>먹이 자석</span>
                          <span>{shark.magnetRadius}</span>
                        </div>
                        <div className="flex justify-between text-cyan-300">
                          <span>부스트 효율</span>
                          <span>×{shark.boostEfficiency.toFixed(1)}</span>
                        </div>
                        <div className="border-t border-white/10 pt-1 font-bold text-purple-300">
                          ⚡ {shark.skill.name} <span className="font-normal text-purple-300/70">({shark.skill.cooldown}s)</span>
                        </div>
                        <div className="font-sans text-[10px] leading-snug text-neutral-400">{shark.skill.desc}</div>
                        {shark.passive && (
                          <div className="font-sans text-[10px] text-emerald-300">🧬 {shark.passive.name}: {shark.passive.desc}</div>
                        )}
                      </div>
                    </div>

                    <button
                      disabled={!have && !canAfford}
                      onClick={() => onEvolve(shark)}
                      className={`${compact ? "w-24 shrink-0 px-2 py-2 sm:mt-4 sm:w-full sm:py-2.5" : "mt-4 w-full py-2.5"} rounded-xl text-xs font-bold shadow-md transition-all ${
                        have
                          ? "bg-emerald-500 text-neutral-950 hover:bg-emerald-400 active:scale-95"
                          : canAfford
                            ? "bg-amber-500 text-neutral-950 hover:bg-amber-400 active:scale-95"
                            : "cursor-not-allowed bg-neutral-700 text-neutral-400"
                      }`}
                    >
                      {have
                        ? "보유 중 · 이 상어 선택"
                        : canAfford
                          ? `진화하기 (${shark.cost.toLocaleString()} 🪙)`
                          : `골드 부족 (${shark.cost.toLocaleString()} 🪙)`}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button onClick={onClose} className="rounded-xl bg-neutral-800 px-5 py-2 text-xs font-bold text-neutral-300 hover:bg-neutral-700">
            {closeLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
