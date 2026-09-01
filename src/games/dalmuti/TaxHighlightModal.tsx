"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Avatar from "@/components/common/Avatar";
import { CardFace, EXCHANGE_TIER_STYLE, type AuraTier } from "./CardArt";
import type { Card, SeatIndex } from "./engine";
import type { TaxHighlightEvent } from "./DalmutiEffects";

/**
 * Large centered "세금 교환 완료" recap popup (task brief, 2026-09-01 세션) —
 * shown only to the two seats actually party to a just-resolved 왕↔노예 or
 * 귀족↔거지 tribute (never to a third party, same masking-scope decision as
 * `FlyingExchangeCard`'s `isExchangeParticipant`, confirmed again via
 * AskUserQuestion this session), right after that exchange's existing
 * ~1.4s card-flight animation (`DalmutiEffects.tsx`'s `FlyingExchangeCard`)
 * lands — the two effects are additive, not a replacement (AskUserQuestion).
 *
 * Purely a local cosmetic layer, same trust model as every other flourish in
 * this file's sibling `DalmutiEffects.tsx`: every connected client already
 * holds the same lockstep `DalmutiState` and independently diffs it via
 * `detectTaxHighlightEvents`, so this popup needs no broadcast action of its
 * own — `onSkip` only ever closes *this* viewer's own popup early, it never
 * needs to reach other clients (there is nothing for it to advance; the
 * `taxReturn` phase has already resolved by the time this shows).
 *
 * Holds for `HOLD_MS` (3s, per task brief "최소 3초간 유지") then
 * auto-dismisses; the skip button under the cards can end it earlier at any
 * time (same "skip always works immediately" convention as every other
 * `-SkipButton` in this project, e.g. grid-poker's `RoundResultOverlay`).
 */
const HOLD_MS = 3000;

function cardsSummaryText(cards: Card[]): string {
  return cards.map((c) => (c.isJoker ? "조커" : `${c.rank}번`)).join(", ") + " 카드";
}

/** "내가 준 카드" side — dimmed, sinks into its resting position (task brief "반투명 딤 처리 + 아래로 내려가는 궤적"). */
function GivenCard({ card, index }: { card: Card; index: number }) {
  return (
    <div
      className="grayscale"
      style={{ animation: `dalmuti-highlight-given-sink 0.55s ease-out ${(index * 0.12).toFixed(2)}s both` }}
    >
      <CardFace card={card} className="scale-110 sm:scale-125" />
    </div>
  );
}

/** "상납/하사받은 카드" side — golden aura + shimmer sweep + radial sparkles, same visual language as `DalmutiEffects.tsx`'s `ReceivedCardGlow` (reuses its keyframes) but sized for this popup and paired with the "✨ 획득!" badge the task brief asks for here specifically. */
function ReceivedCard({ card, tier, index }: { card: Card; tier: AuraTier; index: number }) {
  const palette = EXCHANGE_TIER_STYLE[tier];
  const particles = Array.from({ length: 8 });
  return (
    <div
      className="relative"
      style={{
        perspective: "600px",
        animation: `dalmuti-highlight-card-flip 0.6s cubic-bezier(0.34,1.56,0.64,1) ${(index * 0.12).toFixed(2)}s both`,
      }}
    >
      <span
        className="pointer-events-none absolute -inset-2 rounded-xl"
        style={{ boxShadow: `0 0 0 2px ${palette.spark}, 0 0 22px 6px ${palette.glow}`, animation: "dalmuti-received-aura-pulse 1.1s ease-in-out infinite" }}
      />
      <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
        <span
          className="absolute inset-y-0 left-0 w-1/3"
          style={{ background: `linear-gradient(90deg, transparent, ${palette.spark}, transparent)`, animation: "dalmuti-received-shimmer-sweep 1.6s ease-in-out infinite" }}
        />
      </span>
      {particles.map((_, i) => (
        <span
          key={i}
          className="pointer-events-none absolute top-1/2 left-1/2 h-1.5 w-1.5 rounded-full"
          style={
            {
              background: palette.spark,
              boxShadow: `0 0 6px 1px ${palette.spark}`,
              "--angle": `${(360 / particles.length) * i}deg`,
              animation: `dalmuti-received-spark 1.3s ease-out ${(i * 0.09).toFixed(2)}s infinite`,
            } as CSSProperties
          }
        />
      ))}
      <CardFace card={card} className="relative scale-110 sm:scale-125" />
    </div>
  );
}

function SkipButton({ onSkip }: { onSkip: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSkip();
      }}
      className="relative z-10 mt-2 flex items-center gap-1.5 rounded-full border border-amber-400/50 bg-slate-900/85 px-6 py-2.5 text-sm font-semibold text-white/90 backdrop-blur-sm transition hover:border-amber-300/70 hover:bg-slate-900 active:scale-95"
      style={{ animation: "dalmuti-skip-pulse-glow 1.8s ease-in-out infinite" }}
      aria-label="세금 교환 연출 스킵"
    >
      ⏩ 스킵
    </button>
  );
}

export interface TaxHighlightModalProps {
  event: TaxHighlightEvent;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  titleFor: (seat: SeatIndex) => string;
  onDone: () => void;
}

export default function TaxHighlightModal({ event, viewerSeat, names, titleFor, onDone }: TaxHighlightModalProps) {
  const hasClosedRef = useRef(false);
  const [holdElapsed, setHoldElapsed] = useState(false);

  const isRecipient = viewerSeat === event.recipientSeat;
  const isGiver = viewerSeat === event.giverSeat;

  function close() {
    if (hasClosedRef.current) return;
    hasClosedRef.current = true;
    onDone();
  }

  useEffect(() => {
    const holdTimer = setTimeout(() => setHoldElapsed(true), HOLD_MS);
    const closeTimer = setTimeout(close, HOLD_MS);
    return () => {
      clearTimeout(holdTimer);
      clearTimeout(closeTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only, see FlyingExchangeCard in DalmutiEffects.tsx for the same pattern
  }, []);

  if (typeof document === "undefined") return null;
  if (!isRecipient && !isGiver) return null; // defensive — caller already only mounts this for the two actual parties

  const otherSeat = isRecipient ? event.giverSeat : event.recipientSeat;
  const givenByMe = isRecipient ? event.returnedCards : event.givenCards;
  const receivedByMe = isRecipient ? event.givenCards : event.returnedCards;
  const palette = EXCHANGE_TIER_STYLE[event.auraTier];

  return createPortal(
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      style={{ animation: "dalmuti-highlight-overlay-in 0.3s ease-out both" }}
      onClick={holdElapsed ? close : undefined}
    >
      <div
        className="relative flex w-full max-w-lg flex-col items-center gap-4 rounded-3xl border-2 px-5 py-6 text-center shadow-[0_0_80px_-10px_rgba(0,0,0,0.9)] sm:px-8"
        style={{ borderColor: palette.spark, background: "linear-gradient(180deg, rgba(24,20,10,0.97) 0%, rgba(10,8,5,0.98) 100%)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-4xl">{palette.icon} 💰 {palette.icon}</span>
        <h2 className="break-keep text-xl font-black text-amber-100 sm:text-2xl">세금 교환 완료!</h2>
        <p className="flex items-center gap-2 break-keep text-xs text-white/60 sm:text-sm">
          <Avatar size={22} />
          <span className="font-semibold text-white/90">
            {titleFor(viewerSeat)}({names[viewerSeat]})
          </span>
          <span>↔</span>
          <Avatar size={22} />
          <span className="font-semibold text-white/90">
            {titleFor(otherSeat)}({names[otherSeat]})
          </span>
        </p>

        <div className="flex w-full flex-col gap-5 sm:flex-row sm:justify-center">
          <div className="flex flex-1 flex-col items-center gap-2">
            <span className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs font-bold break-keep text-white/70">
              [ 📤 내가 준 카드 ]
            </span>
            <div className="flex flex-wrap justify-center gap-2">
              {givenByMe.length > 0 ? (
                givenByMe.map((c, i) => <GivenCard key={c.id} card={c} index={i} />)
              ) : (
                <span className="text-xs text-white/30">없음</span>
              )}
            </div>
            <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-bold break-keep text-white/60">💨 전달 완료</span>
            <span className="break-keep text-[10px] text-white/40">{givenByMe.length > 0 ? cardsSummaryText(givenByMe) : ""}</span>
          </div>

          <div className="hidden w-px self-stretch bg-white/10 sm:block" />

          <div className="flex flex-1 flex-col items-center gap-2">
            <span
              className="rounded-full border px-3 py-1 text-xs font-bold break-keep"
              style={{ borderColor: palette.spark, background: `${palette.glow}`, color: "#1c1408" }}
            >
              [ 📥 상납/하사받은 카드 ]
            </span>
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              {receivedByMe.length > 0 ? (
                receivedByMe.map((c, i) => <ReceivedCard key={c.id} card={c} tier={event.auraTier} index={i} />)
              ) : (
                <span className="text-xs text-white/30">없음</span>
              )}
            </div>
            <span className="rounded-full px-2.5 py-0.5 text-[10px] font-black break-keep text-black" style={{ background: palette.spark }}>
              ✨ 획득!
            </span>
            <span className="break-keep text-[10px] text-amber-100/70">{receivedByMe.length > 0 ? cardsSummaryText(receivedByMe) : ""}</span>
          </div>
        </div>

        <SkipButton onSkip={close} />
      </div>
    </div>,
    document.body,
  );
}
