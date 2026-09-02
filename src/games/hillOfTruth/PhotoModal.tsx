"use client";

import { useState } from "react";
import Image from "next/image";
import type { EvidencePhoto } from "./scenarios";

/**
 * 증거단서함 포토 모달 — LV2 이상에서 증거 카드의 썸네일을 클릭하면 화면 중앙에
 * 고해상도로 확대되는 라이트박스 팝업(2026-09-03 세션 요청서 §3). 이미지는 전부
 * 로컬 파일(`public/images/hillOfTruth/evidence/`)이라 깨질 일이 없고, 혹시 로드에
 * 실패해도 아래 `onError`로 텍스트 폴백 카드로 대체한다("로컬 폴백 에셋 적용" 요구사항).
 */
export default function PhotoModal({
  title,
  photo,
  onClose,
}: {
  title: string;
  photo: EvidencePhoto;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <div
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/15 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h3 className="break-keep text-sm font-bold text-white">📷 {title}</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-white/50 hover:bg-white/10 hover:text-white">
            ✕
          </button>
        </div>
        <div className="relative flex-1 overflow-auto bg-black/30">
          <PhotoWithFallback photo={photo} />
        </div>
        <div className="border-t border-white/10 px-4 py-2.5">
          <p className="break-keep text-[11px] text-white/40">출처: {photo.credit}</p>
        </div>
      </div>
    </div>
  );
}

/** 로컬 폴백: 이미지 로드 실패 시 텍스트 카드로 대체(요청서 "이미지 깨짐 방지" 조항). */
function PhotoWithFallback({ photo }: { photo: EvidencePhoto }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex h-64 w-full flex-col items-center justify-center gap-2 p-8 text-center">
        <span className="text-3xl">🖼️</span>
        <p className="break-keep text-xs text-white/50">이미지를 불러올 수 없어요</p>
      </div>
    );
  }
  return (
    <div className="relative aspect-[4/3] w-full">
      <Image
        src={photo.url}
        alt={photo.alt}
        fill
        sizes="(max-width: 640px) 100vw, 512px"
        className="object-contain"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
