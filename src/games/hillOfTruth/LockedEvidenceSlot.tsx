"use client";

import { useState } from "react";
import type { LockedEvidenceItem } from "./scenarios";
import PhotoModal from "./PhotoModal";

/**
 * LV3 전용 잠금 단서 카드 — 자물쇠 아이콘과 함께 미해금 상태로 노출되며, 조건(지정된
 * questionBank 트리거로 초록불)을 만족하면 네온 해금 연출과 함께 내용이 열린다
 * (2026-09-03 세션 요청서 §3). 해금 판정 자체는 새 상태 없이 상위(`InvestigationPanel`)가
 * `questionLog`만으로 순수 계산해 `unlocked` prop으로 내려준다 — 엔진 변경 없음.
 */
export default function LockedEvidenceSlot({ item, unlocked }: { item: LockedEvidenceItem; unlocked: boolean }) {
  const [justUnlocked, setJustUnlocked] = useState(unlocked);
  const [photoOpen, setPhotoOpen] = useState(false);

  if (!unlocked) {
    return (
      <li className="rounded-xl border border-dashed border-fuchsia-400/25 bg-fuchsia-500/[0.03] p-3">
        <p className="flex items-center gap-1.5 break-keep text-sm font-bold text-white/40">
          🔒 {item.name}
        </p>
        <p className="mt-1 break-keep text-xs leading-relaxed text-white/35">{item.unlockHint}</p>
      </li>
    );
  }

  return (
    <li
      className={`rounded-xl border p-3 transition ${
        justUnlocked
          ? "border-fuchsia-400/60 bg-fuchsia-500/10 shadow-[0_0_20px_2px_rgba(232,121,249,0.35)]"
          : "border-fuchsia-400/30 bg-fuchsia-500/[0.05]"
      }`}
      onAnimationEnd={() => setJustUnlocked(false)}
    >
      <p className="break-keep text-sm font-bold text-fuchsia-200">🔓 {item.name}</p>
      <p className="mt-1 break-keep text-xs leading-relaxed text-white/70">{item.description}</p>
      {item.photo && (
        <button
          onClick={() => setPhotoOpen(true)}
          className="mt-2 flex items-center gap-1.5 rounded-lg border border-fuchsia-400/30 px-2.5 py-1.5 text-[11px] text-fuchsia-200 hover:border-fuchsia-300/50"
        >
          📷 사진 증거 보기
        </button>
      )}
      {photoOpen && item.photo && <PhotoModal title={item.name} photo={item.photo} onClose={() => setPhotoOpen(false)} />}
    </li>
  );
}
