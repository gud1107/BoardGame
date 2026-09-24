import type { Ref } from "react";
import { DuelToken } from "./DuelToken";
import { GOLD_SUPPLY } from "./engine";

/**
 * The gold stand mounted above the gem board — the ONLY place gold can be
 * taken from, and only by reserving a card (rulebook §3 필수 행동 2).
 *
 * Three physical slots: a present coin gets a glowing gold rim, a taken one
 * leaves an engraved empty groove. Each slot carries `data-gold-slot={i}` so
 * the board's fly-in/fly-back animation (SplendorDuelBoard's
 * `flyGold`) can start from / land on the exact slot. Tapping the stand on
 * your turn is a shortcut into "pick a card to reserve".
 *
 * Sized to sit inside the board header row: 16px coins on phones (the phone
 * layout has zero vertical slack), 24px from md up.
 */
export default function GoldReservoir({
  count,
  onClick,
  innerRef,
}: {
  count: number;
  onClick?: () => void;
  innerRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={innerRef}
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-400/50 bg-gradient-to-b from-stone-800 to-black py-0 pr-1.5 pl-2 whitespace-nowrap shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_10px_rgba(251,191,36,0.12)] md:gap-1.5 md:py-0.5 light:border-amber-500/40 light:from-amber-50 light:to-amber-100 ${
        onClick ? "cursor-pointer hover:border-amber-300" : "cursor-default"
      }`}
      title={
        count > 0
          ? `황금 스탠드 ${count}/${GOLD_SUPPLY} — 카드를 예약하면 여기서 1개를 가져가요`
          : `황금 스탠드 0/${GOLD_SUPPLY} — 황금이 모두 소진되어 예약해도 카드만 받아요`
      }
    >
      <span className="text-[9px] font-black tracking-wider text-amber-300 light:text-amber-700">GOLD</span>
      {Array.from({ length: GOLD_SUPPLY }, (_, i) => {
        const present = i < count;
        return (
          <span
            key={i}
            data-gold-slot={i}
            className={`relative inline-flex h-4 w-4 items-center justify-center rounded-full transition-all duration-300 md:h-6 md:w-6 ${
              present
                ? "shadow-[0_0_8px_rgba(251,191,36,0.75)] ring-1 ring-yellow-200/80"
                : "bg-black/70 shadow-[inset_0_2px_3px_rgba(0,0,0,0.9),inset_0_-1px_0_rgba(255,255,255,0.08)] ring-1 ring-amber-900/60"
            }`}
          >
            {present && <DuelToken color="gold" className="h-full w-full" />}
          </span>
        );
      })}
      <span className={`font-mono text-[9px] md:text-[10px] ${count > 0 ? "text-amber-200/90 light:text-amber-700" : "text-rose-300"}`}>
        {count}/{GOLD_SUPPLY}
      </span>
    </button>
  );
}
