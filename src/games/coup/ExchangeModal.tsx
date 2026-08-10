"use client";

import { useState } from "react";
import { CharacterCardFace } from "./CardArt";
import type { Card } from "./engine";

/**
 * 제상(Ambassador)의 교환 — the actor already drew the 2 extra cards
 * (`engine.ts`'s `startExchange`); this is purely "which `keepCount` of the
 * combined options do I keep". No cancel path (it's a forced follow-up to an
 * already-resolved claim), so this is a plain fixed overlay like loveLetter's
 * `confirmPrincess`, not `Overlay` (which always renders a functional ×).
 */
export default function ExchangeModal({
  options,
  keepCount,
  onConfirm,
}: {
  options: Card[];
  keepCount: number;
  onConfirm: (keepCardIds: number[]) => void;
}) {
  const [selected, setSelected] = useState<number[]>([]);

  function toggle(id: number) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= keepCount) return prev;
      return [...prev, id];
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-purple-300/30 bg-[#160c28] p-5 text-center shadow-2xl">
        <span className="text-3xl">🕊️</span>
        <h2 className="text-base font-bold text-purple-100">교환할 카드를 고르세요</h2>
        <p className="text-xs text-white/50">
          아래 {options.length}장 중 남길 {keepCount}장을 선택하세요. 나머지는 덱으로 돌아갑니다.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          {options.map((c) => {
            const isSelected = selected.includes(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggle(c.id)}
                className={`rounded-xl p-1 transition ${isSelected ? "ring-2 ring-amber-300" : "opacity-60 hover:opacity-100"}`}
              >
                <CharacterCardFace card={c} size="lg" highlight={isSelected} />
              </button>
            );
          })}
        </div>
        <button
          disabled={selected.length !== keepCount}
          onClick={() => onConfirm(selected)}
          className="rounded-xl bg-purple-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-30"
        >
          확정 ({selected.length}/{keepCount})
        </button>
      </div>
    </div>
  );
}
