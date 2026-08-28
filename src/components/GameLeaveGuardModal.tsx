"use client";

import Overlay from "@/components/Overlay";

/**
 * Confirm-leave modal shown by `useGameLeaveGuard` when a mobile back
 * gesture / browser back button is intercepted mid-game. Copy/design
 * extracted verbatim from the original DestinyWar39Game.tsx implementation
 * — standardized here so every online game shows the exact same modal.
 */
export default function GameLeaveGuardModal({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;

  return (
    <Overlay title="게임을 나가시겠습니까?" onClose={onCancel}>
      <div className="flex flex-col gap-4 text-sm text-white/80">
        <p>진행 중인 게임에서 나가면 다시 들어오기 전까지 참여할 수 없어요.</p>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm font-semibold text-white/80 hover:border-white/30"
          >
            계속하기
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-rose-600 py-2.5 text-sm font-semibold text-white hover:bg-rose-500"
          >
            나가기
          </button>
        </div>
      </div>
    </Overlay>
  );
}
