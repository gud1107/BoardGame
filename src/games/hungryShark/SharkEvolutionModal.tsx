"use client";

import { BRANCH_INFO, sharkById, type SharkBranch, type SharkDef } from "./data";

/**
 * 진화 분기 선택 모달 — shows the current shark's next evolution choices
 * (3 branches from the reef shark, one per branch after that) with stat
 * deltas, skill and passive, and an evolve button gated on coins.
 */

const BRANCH_BADGE: Record<SharkBranch, string> = {
  BASE: "bg-slate-800 text-slate-300 border-slate-600",
  BRUTE: "bg-rose-950 text-rose-300 border-rose-600",
  SPEED: "bg-sky-950 text-sky-300 border-sky-600",
  VOID: "bg-purple-950 text-purple-300 border-purple-600",
};

export function BranchBadge({ branch }: { branch: SharkBranch }) {
  if (branch === "BASE") return null;
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap ${BRANCH_BADGE[branch]}`}>
      {BRANCH_INFO[branch].emoji} {BRANCH_INFO[branch].short}
    </span>
  );
}

function delta(n: number) {
  return n >= 0 ? `+${n}` : `${n}`;
}

export default function SharkEvolutionModal({
  currentSharkId,
  playerGold,
  owned,
  onEvolve,
  onClose,
}: {
  currentSharkId: string;
  playerGold: number;
  owned: string[];
  onEvolve: (target: SharkDef) => void;
  onClose: () => void;
}) {
  const current = sharkById(currentSharkId);
  const nextOptions = current.nextIds.map(sharkById);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md select-none" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col gap-5 overflow-y-auto rounded-3xl border border-neutral-700 bg-neutral-900 p-5 text-white shadow-2xl sm:p-6"
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

          <div className={`grid grid-cols-1 gap-4 ${nextOptions.length > 1 ? "md:grid-cols-3" : ""}`}>
            {nextOptions.map((shark) => {
              const have = owned.includes(shark.id);
              const canAfford = playerGold >= shark.cost;
              return (
                <div
                  key={shark.id}
                  className={`flex flex-col justify-between rounded-2xl border p-4 transition-all ${
                    have || canAfford
                      ? "border-neutral-600 bg-neutral-800/90 hover:scale-[1.02] hover:border-amber-400"
                      : "border-neutral-800 bg-neutral-950/60 opacity-60"
                  }`}
                >
                  <div className="flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-mono text-xs font-bold text-neutral-400">Tier {shark.tier}</span>
                      <BranchBadge branch={shark.branch} />
                    </div>
                    <h4 className="text-base font-bold text-neutral-100">{shark.name}</h4>
                    <p className="line-clamp-2 text-xs text-neutral-400">{shark.blurb}</p>

                    <div className="mt-1 space-y-1 rounded-xl border border-white/5 bg-black/40 p-2 font-mono text-[11px]">
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
                    className={`mt-4 w-full rounded-xl py-2.5 text-xs font-bold shadow-md transition-all ${
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

        <div className="flex justify-end">
          <button onClick={onClose} className="rounded-xl bg-neutral-800 px-5 py-2 text-xs font-bold text-neutral-300 hover:bg-neutral-700">
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
