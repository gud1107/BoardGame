import { DuelToken } from "./DuelToken";
import { GOLD_SUPPLY } from "./engine";

/**
 * The gold stand above the gem board — the ONLY place gold can be taken
 * from, and only by reserving a card (rulebook §3 필수 행동 2). Three fixed
 * slots; a filled slot shows a gold coin, an empty one a dashed ring, so
 * "how many golds can still be gained by reserving" reads at a glance.
 * Sized to sit inside the board header row without adding height (the phone
 * layout has zero vertical slack).
 */
export default function GoldReservoir({ count }: { count: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full whitespace-nowrap border border-amber-400/40 bg-black/50 py-px pr-1 pl-1.5 light:border-amber-500/40 light:bg-amber-50"
      title={`황금 스탠드 ${count}/${GOLD_SUPPLY} — 카드를 예약할 때만 1개씩 가져올 수 있어요`}
    >
      <span className="text-[9px] font-black tracking-wider text-amber-300 light:text-amber-700">
        GOLD
      </span>
      {Array.from({ length: GOLD_SUPPLY }, (_, i) =>
        i < count ? (
          <DuelToken key={i} color="gold" className="h-3.5 w-3.5 md:h-4 md:w-4" />
        ) : (
          <span key={i} className="h-3.5 w-3.5 rounded-full border border-dashed border-amber-200/30 md:h-4 md:w-4" aria-hidden="true" />
        ),
      )}
      <span className="font-mono text-[9px] text-amber-200/80 light:text-amber-700">
        {count}/{GOLD_SUPPLY}
      </span>
    </span>
  );
}
