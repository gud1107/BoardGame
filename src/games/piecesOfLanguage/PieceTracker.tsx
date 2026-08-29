"use client";

import { jamoAvailableInPool, type JamoUsage } from "./hangul";

/**
 * Live "조각 소모 현황판" shown above `WordInput.tsx`'s text field: total
 * consonant/vowel counts as summary badges, plus one chip per distinct jamo
 * actually typed so far (e.g. "ㄱ×2"). A chip a viewer typed that has no
 * matching tile in the shared `pool` (literally or via rotation — see
 * `hangul.ts`'s `jamoAvailableInPool`) turns red instead of neutral, exactly
 * mirroring the same pool rule that already gates submission
 * (`wordBuildableFromPool` in engine.ts) — this panel is a live *preview* of
 * that gate, not a separate rule of its own. `shake` is driven by the parent
 * (`WordInput.tsx`) on a failed submit attempt, not on every keystroke, so
 * the animation reads as "that didn't work" rather than firing constantly
 * while a pool-incompatible word is mid-typing.
 */
export interface PieceTrackerProps {
  usage: JamoUsage;
  pool: string[];
  shake: boolean;
}

function totalCount(map: Record<string, number>): number {
  return Object.values(map).reduce((sum, n) => sum + n, 0);
}

function JamoChip({ jamo, count, available }: { jamo: string; count: number; available: boolean }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        available ? "border-white/15 bg-white/5 text-white/80" : "border-red-500/40 bg-red-500/20 text-red-400"
      }`}
    >
      {jamo}×{count}
    </span>
  );
}

export default function PieceTracker({ usage, pool, shake }: PieceTrackerProps) {
  const consonantEntries = Object.entries(usage.consonants);
  const vowelEntries = Object.entries(usage.vowels);
  const consonantTotal = totalCount(usage.consonants);
  const vowelTotal = totalCount(usage.vowels);
  const hasAny = consonantEntries.length > 0 || vowelEntries.length > 0;

  return (
    <div
      className="flex flex-col gap-1.5 rounded-xl border border-white/10 bg-black/20 p-2.5"
      style={shake ? { animation: "pol-piece-shake 0.4s ease-in-out" } : undefined}
    >
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-300">
          🟢 사용 중인 자음 {consonantTotal}개
        </span>
        <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-sky-300">
          🔵 사용 중인 모음 {vowelTotal}개
        </span>
      </div>
      {hasAny && (
        <div className="flex flex-wrap gap-1">
          {consonantEntries.map(([jamo, count]) => (
            <JamoChip key={`c-${jamo}`} jamo={jamo} count={count} available={jamoAvailableInPool(jamo, pool)} />
          ))}
          {vowelEntries.map(([jamo, count]) => (
            <JamoChip key={`v-${jamo}`} jamo={jamo} count={count} available={jamoAvailableInPool(jamo, pool)} />
          ))}
        </div>
      )}
    </div>
  );
}
