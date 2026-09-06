import { getRoomRulebookSummary } from "@/constants/roomRulebookSummaries";

/**
 * The "30초 핵심 룰" card rendered inside `RulebookGate`'s 📖 룰북 tab/
 * accordion. Deliberately neutral (sky accent, same family as
 * `BotSeatControls`'s shared lobby chrome) rather than per-game branded —
 * this is shared infrastructure, not part of any one game's palette.
 *
 * Renders nothing when the game has no curated entry yet in
 * `ROOM_RULEBOOK_SUMMARIES` (see that file's TODO) — callers don't need to
 * guard this themselves.
 */
export default function RulebookSummaryCard({ gameId }: { gameId: string }) {
  const summary = getRoomRulebookSummary(gameId);
  if (!summary) return null;

  return (
    <div className="flex w-full flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left">
      <section>
        <h4 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-white/50 uppercase">
          🎯 목표 &amp; 승리 조건
        </h4>
        <p className="text-sm break-keep text-white/80">{summary.objective}</p>
      </section>

      <section>
        <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-white/50 uppercase">
          🔄 진행 방법
        </h4>
        <ol className="flex flex-col gap-1.5">
          {summary.turnFlow.map((step, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-white/70">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-sky-400/15 text-[10px] font-bold text-sky-300">
                {i + 1}
              </span>
              <span className="break-keep">{step}</span>
            </li>
          ))}
        </ol>
      </section>

      {summary.specialRules.length > 0 && (
        <section>
          <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-white/50 uppercase">
            ⚠️ 특수 룰 / 주의점
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {summary.specialRules.map((rule, i) => (
              <span
                key={i}
                className="rounded-full border border-sky-400/20 bg-sky-400/10 px-2.5 py-1 text-xs break-keep text-sky-200"
              >
                {rule}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
