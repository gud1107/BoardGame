"use client";

import { createPortal } from "react-dom";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import { canManuallyDetonate, TIME_BOMB_MANUAL_TRIGGER_DELAY, type TimeBomb } from "./engine";

/**
 * 원격 즉시 격발 팝업 — 본인 소유의 아직 안 터진 시한폭탄 칸을 탭하면 뜬다
 * (`MineOfOblivion2Board.tsx`의 `handleTileTap`). 2026-09-07 `AskUserQuestion`
 * 확인 사항(engine.ts 모듈 doc #5-7)을 그대로 반영:
 *  - 상대 위치나 경과 턴수와 무관하게 본인 턴이면 언제든 격발 버튼이 활성화됨.
 *  - 격발은 "즉시"가 아니라 이 폭탄의 `remaining`을
 *    `TIME_BOMB_MANUAL_TRIGGER_DELAY`(2)로 낮출 뿐 — 실제 폭발은 이후 정상
 *    카운트다운 경로(`tickTimeBombs`)를 타고 2턴 뒤 벌어진다.
 *  - 이동과 별개의 무료 액션이라 턴이 끝나지 않으므로, 격발 후에도 이 칸이
 *    (인접하다면) 이동 가능한 칸이라면 별도 버튼으로 바로 이동할 수 있다.
 */
export interface MineOfOblivion2BombControlModalProps {
  bomb: TimeBomb;
  canMoveHere: boolean;
  onClose: () => void;
  onDetonate: () => void;
  onMoveHere: () => void;
}

export default function MineOfOblivion2BombControlModal({ bomb, canMoveHere, onClose, onDetonate, onMoveHere }: MineOfOblivion2BombControlModalProps) {
  if (typeof document === "undefined") return null;

  const canDetonate = canManuallyDetonate(bomb);
  const buttonLabel = canDetonate ? "💥 지금 즉시 격발! (2턴 후 폭발)" : bomb.manuallyTriggered ? "🔥 이미 격발됨 · 자동 폭발 대기 중" : "⏳ 곧 자동 폭발 (격발 불필요)";

  return createPortal(
    <div className="pointer-events-auto fixed inset-0 z-[92] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="flex w-full max-w-xs flex-col gap-3 rounded-2xl border border-amber-400/30 bg-gradient-to-b from-[#1a1206] via-[#120c04] to-black p-4 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-center gap-2">
          <span className="text-3xl">🧨</span>
          <div className="flex flex-col items-start">
            <span className="text-sm font-bold text-amber-200 break-keep">내 시한폭탄 · {bomb.tile}</span>
            <span className="text-[11px] text-white/50 break-keep">{bomb.manuallyTriggered ? "🔥 격발됨 · 자동 폭발 대기 중" : "⏳ 카운트다운 진행 중"}</span>
          </div>
        </div>

        <div className="flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] py-2">
          <span className="text-xs text-white/50 break-keep">남은 턴</span>
          <span className={`text-lg font-black ${bomb.remaining <= 1 ? "text-rose-300" : "text-amber-200"}`}>{bomb.remaining}</span>
        </div>

        <button
          type="button"
          disabled={!canDetonate}
          onClick={() => {
            getSoundEngine().playBombManualArm();
            onDetonate();
          }}
          className="rounded-xl bg-rose-500 py-2.5 text-sm font-bold text-white transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
        >
          {buttonLabel}
        </button>

        {canMoveHere && (
          <button type="button" onClick={onMoveHere} className="rounded-xl border border-emerald-400/40 py-2 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-400/10">
            🚶 이 칸으로 이동
          </button>
        )}

        <button type="button" onClick={onClose} className="rounded-xl border border-white/10 py-2 text-xs text-white/50 transition hover:border-white/25">
          닫기
        </button>

        <p className="text-[10px] text-white/35 break-keep">
          💡 시한폭탄은 설치 시 고른 퓨즈가 다 되면 자동 폭발하거나, 언제든 [즉시 격발]을 눌러 {TIME_BOMB_MANUAL_TRIGGER_DELAY}턴 후 강제 폭발시킬 수 있어요. 3×3 범위 내 −5점
          (비어있으면 설치자 +2점).
        </p>
      </div>
    </div>,
    document.body,
  );
}
