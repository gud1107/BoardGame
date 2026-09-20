"use client";

/**
 * "시간초 과반수 스킵" 토글 버튼 (2026-09-20 요청) — `night`/`dayDiscuss`
 * 타이머 옆에 상시 배치. 실제 과반수 판정/즉시 페이즈 전환은 전부
 * `engine.ts`의 `toggleSkipVote`가 처리하므로, 이 컴포넌트는 순수
 * 프레젠테이션 + 토글 디스패치만 담당한다.
 */
export default function PhaseSkipVote({
  skipCount,
  requiredCount,
  hasVotedSkip,
  onToggleSkip,
  disabled = false,
}: {
  skipCount: number;
  requiredCount: number;
  hasVotedSkip: boolean;
  onToggleSkip: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggleSkip}
      disabled={disabled}
      className={`group flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-bold transition-all duration-200 select-none ${
        hasVotedSkip
          ? "border-amber-400 bg-amber-500/20 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.35)]"
          : "border-white/15 bg-black/30 text-white/60 hover:border-white/30 hover:text-white/90 light:border-slate-300 light:bg-white light:text-slate-600"
      } ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
    >
      <span className="text-sm transition-transform group-hover:scale-110">⏩</span>
      <span>스킵 투표</span>
      <span className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[11px] text-amber-300 light:bg-slate-900/10 light:text-amber-700">
        {skipCount}/{requiredCount}
      </span>
    </button>
  );
}
