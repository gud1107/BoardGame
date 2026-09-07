import { CARAVAN_STYLE, CartInventory } from "./boardChrome";
import { bundleTotal } from "./cards";
import { HAND_LIMIT, type PlayerState } from "./engine";

/**
 * My caravan cart — the 10-well resource inventory grid + gold/silver/point
 * totals. Split out of CenturyBoard.tsx so the mobile compact dashboard can
 * render it as its own dense grid cell without dragging the hand/discard
 * pile along (see MyHandCards.tsx for those) — the desktop mat layout wraps
 * this in the same wooden-cart section it always did.
 */
export function MyCaravan({ me, forwardedRef }: { me: PlayerState; forwardedRef?: React.Ref<HTMLDivElement> }) {
  const over = bundleTotal(me.resources) > HAND_LIMIT;
  return (
    <div ref={forwardedRef} className="rounded-2xl border p-2.5 sm:p-3" style={CARAVAN_STYLE}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
        <h3 className="text-[11px] font-semibold tracking-wide text-amber-200/90 uppercase">🐫 내 수레 (Caravan)</h3>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${over ? "border-rose-400/60 text-rose-300" : "border-amber-200/30 text-amber-100/80"}`}>
          {bundleTotal(me.resources)} / {HAND_LIMIT}
        </span>
      </div>
      <CartInventory resources={me.resources} limit={HAND_LIMIT} />
      <div className="mt-2.5 flex flex-wrap gap-3 text-xs text-amber-50/80">
        <span>🪙 금화 {me.gold}</span>
        <span>🥈 은화 {me.silver}</span>
        <span>🏆 점수 카드 {me.pointCards.length}장</span>
      </div>
    </div>
  );
}

/** Compact single-row variant for the mobile dashboard's caravan cell (no header, wraps tighter). */
export function MyCaravanCompact({ me, forwardedRef }: { me: PlayerState; forwardedRef?: React.Ref<HTMLDivElement> }) {
  const over = bundleTotal(me.resources) > HAND_LIMIT;
  return (
    <div ref={forwardedRef} className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border p-1.5" style={CARAVAN_STYLE}>
      <CartInventory resources={me.resources} limit={HAND_LIMIT} compact slotClass="h-4 w-4" cubeClass="h-3 w-3" />
      <div className={`ml-auto flex shrink-0 flex-col items-end gap-0.5 text-[10px] font-bold ${over ? "text-rose-300" : "text-amber-100/80"}`}>
        <span>
          {bundleTotal(me.resources)}/{HAND_LIMIT}
        </span>
        <span className="flex gap-1.5 text-amber-50/70">
          🪙{me.gold} 🥈{me.silver} 🏆{me.pointCards.length}
        </span>
      </div>
    </div>
  );
}
