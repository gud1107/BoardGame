"use client";

import { CharacterCardFace } from "./CardArt";
import type { Card, LoseInfluenceReason } from "./engine";

const REASON_LABEL: Record<LoseInfluenceReason, string> = {
  coup: "쿠데타를 맞았습니다. 영향력 카드 1장을 공개해야 합니다.",
  challengeActionLost: "거짓 능력 선언이 들통났습니다. 카드 1장을 공개해야 합니다.",
  challengeActionFailed_penalty: "잘못된 의심이었습니다. 벌점으로 카드 1장을 공개해야 합니다.",
  blockBluffCaught: "거짓 방어 선언이 들통났습니다. 카드 1장을 공개해야 합니다.",
  challengeBlockFailed_penalty: "방어에 대한 의심이 틀렸습니다. 벌점으로 카드 1장을 공개해야 합니다.",
  assassinateEffect: "암살을 맞았습니다. 영향력 카드 1장을 공개해야 합니다.",
};

/** §2 "영향력(카드) 공개 및 사망" — the only decision here is *which* held card to flip; no cancel path. */
export default function LoseInfluenceModal({
  options,
  reason,
  onReveal,
}: {
  options: Card[];
  reason: LoseInfluenceReason;
  onReveal: (cardId: number) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border border-rose-400/40 bg-[#240808] p-5 text-center shadow-2xl">
        <span className="text-3xl">💀</span>
        <h2 className="text-base font-bold text-rose-100">영향력 카드를 공개하세요</h2>
        <p className="text-xs text-white/60">{REASON_LABEL[reason]}</p>
        <div className="flex justify-center gap-3">
          {options.map((c) => (
            <button key={c.id} onClick={() => onReveal(c.id)} className="rounded-xl p-1 opacity-90 transition hover:scale-105 hover:opacity-100">
              <CharacterCardFace card={c} size="lg" />
            </button>
          ))}
        </div>
        {options.length === 1 && <p className="text-[11px] text-white/40">공개할 카드가 1장뿐입니다.</p>}
      </div>
    </div>
  );
}
