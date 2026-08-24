"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { CardFace } from "./CardArt";
import type { Card } from "./engine";

/**
 * Dedicated "pick 1 card to hand over" modal for the voluntary 평민(Commoner)
 * mutual card exchange (task brief §1, 2026-08-25 후속 세션) — pops up the
 * instant both paired commoners have accepted (`commonerOptIn`) and this
 * seat still needs to submit its `commonerOfferCard` choice
 * (`DalmutiBoard.tsx`'s `isMyCommonerOfferTurn`), replacing the plain inline
 * hand-click flow this phase used to share with `taxReturn`/`trick`.
 *
 * No dismiss/close affordance on purpose: `engine.ts`'s `commonerOfferCard`
 * offers no way to back out of an accepted exchange (once a seat's pick is
 * submitted it's final — see engine.ts §5), so this modal has nothing valid
 * to cancel back to. It unmounts on its own once `onSubmit` fires, because
 * that flips `isMyCommonerOfferTurn` to false in the caller.
 */
export default function CardExchangeModal({
  hand,
  partnerName,
  onSubmit,
}: {
  hand: Card[];
  partnerName: string;
  onSubmit: (cardId: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center">
      <div className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border border-emerald-300/30 bg-[#12241c] p-5 shadow-[0_0_60px_-15px_rgba(52,211,153,0.55)] sm:max-w-lg sm:rounded-2xl sm:p-6">
        <div className="mb-1 text-center text-2xl">🌾🤝🌾</div>
        <h2 className="mb-1 text-center text-lg font-bold text-emerald-100">평민 카드 교환</h2>
        <p className="mb-4 text-center text-xs text-emerald-200/70">
          <b>{partnerName}</b>님에게 건네줄 카드를 손패에서 <b>1장</b> 골라주세요. 서로 확정 전까지 상대의 선택은 보이지 않습니다.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {[...hand]
            .sort((a, b) => a.rank - b.rank)
            .map((c) => (
              <button
                key={c.id}
                onClick={() => setSelected(c.id)}
                className={`transition ${selected === c.id ? "-translate-y-2" : "hover:-translate-y-1"}`}
              >
                <CardFace card={c} highlight={selected === c.id} />
              </button>
            ))}
        </div>
        <div className="mt-5 flex justify-center">
          <button
            onClick={() => selected && onSubmit(selected)}
            disabled={!selected}
            className="rounded-full bg-emerald-500 px-8 py-3 text-sm font-bold text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-30"
          >
            🤝 {selected ? "이 카드 보내기" : "카드를 선택하세요"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
