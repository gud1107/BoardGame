import { CARD_META } from "./cardMeta";
import type { Card } from "./engine";

/**
 * The visible face (and back) of a physical card — extracted out of
 * BangBoard.tsx in the 2026-08-21 hover/HP/center-banner redesign session
 * (see HANDOFF.md) so BangEffects.tsx's `CenterPlayBanner` can render the
 * exact same card face at the table's center as the one sitting in a hand.
 *
 * Per the user's explicit answer to the "카드 크기" AskUserQuestion in that
 * session, "md" (the hand/center-banner default) is now a big
 * name+description-bearing card (176×128px) instead of the old icon-only
 * 112×80px face — the description text (`meta.desc`, already a single full
 * sentence per card, see cardMeta.ts) is printed directly on the card body
 * at rest, not behind a hover tooltip. `size="sm"` stays the old compact
 * icon-only face (deck/discard back, general-store peek) — there's no room
 * for prose at that size and neither of those spots is about reading a
 * card's rules text.
 *
 * No hover-scale styling lives here on purpose: BangBoard.tsx's hand fan
 * needs the *wrapper*'s z-index bumped above sibling cards on hover (a
 * child's z-index can never escape its already-stacked-by-inline-style
 * parent — every fanned card wrapper has its own stacking context from
 * `fanStyle`'s `transform`), which only works driven by React state, not a
 * bare CSS `:hover`. BangBoard owns that; this component only ever renders
 * one fixed size at a time.
 */
export function CardFace({ card, size = "md" }: { card: Card; size?: "sm" | "md" }) {
  const meta = CARD_META[card.type];
  if (size === "sm") {
    return (
      <div className="relative flex h-16 w-11 flex-col items-center justify-between rounded-lg border-[3px] border-amber-700/80 bg-gradient-to-b from-amber-50 via-amber-100 to-amber-200 px-1 py-1 text-amber-950 shadow-[0_4px_10px_rgba(0,0,0,0.5)]">
        <span className="absolute top-0.5 left-1 text-[8px] font-bold leading-none">{card.suit}</span>
        <span className="absolute right-1 bottom-0.5 rotate-180 text-[8px] font-bold leading-none">{card.suit}</span>
        <span className="mt-1.5 max-w-full truncate px-1 text-center text-[6px] font-black tracking-tight text-amber-900 uppercase">
          {meta.label}
        </span>
        <span className="text-xl drop-shadow-sm">{meta.icon}</span>
        <span className="mb-1 h-1" />
      </div>
    );
  }
  return (
    <div className="relative flex h-44 w-32 flex-col rounded-xl border-[3px] border-amber-700/80 bg-gradient-to-b from-amber-50 via-amber-100 to-amber-200 px-2 py-1.5 text-amber-950 shadow-[0_4px_10px_rgba(0,0,0,0.5)]">
      <span className="absolute top-1 left-1.5 text-[10px] font-bold leading-none">{card.suit}</span>
      <span className="absolute right-1.5 bottom-1 rotate-180 text-[10px] font-bold leading-none">{card.suit}</span>
      <div className="mt-1 flex flex-col items-center gap-0.5">
        <span className="text-2xl drop-shadow-sm">{meta.icon}</span>
        <span className="max-w-full truncate px-1 text-center text-[11px] font-black tracking-tight text-amber-900 uppercase">{meta.label}</span>
      </div>
      <div className="mx-2 mt-1 border-t border-amber-700/30" />
      <p className="mt-1 flex-1 overflow-hidden px-0.5 text-center text-[9.5px] leading-snug font-medium text-amber-900/90">{meta.desc}</p>
    </div>
  );
}

export function CardBack({ size = "sm" }: { size?: "sm" | "md" }) {
  const dims = size === "sm" ? "h-16 w-11" : "h-24 w-16";
  return (
    <div
      className={`flex ${dims} items-center justify-center rounded-xl border-2 border-white/15 shadow-[0_4px_10px_rgba(0,0,0,0.5)]`}
      style={{
        backgroundImage:
          "repeating-linear-gradient(135deg, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 2px, transparent 2px, transparent 8px), linear-gradient(160deg, #4a2f14, #1c1108)",
      }}
    >
      <span className="rounded-full border border-white/25 bg-black/30 p-1 text-sm">🤠</span>
    </div>
  );
}
