"use client";

import Overlay from "@/components/Overlay";
import { ACTION_NAMES, type ActionKind, type SeatIndex } from "./engine";

/** Who to aim 쿠/암살/갈취 at — the only decision needed before those 3 actions are declared. */
export default function TargetModal({
  action,
  targets,
  names,
  onConfirm,
  onCancel,
}: {
  action: ActionKind;
  targets: SeatIndex[];
  names: Record<SeatIndex, string>;
  onConfirm: (targetSeat: SeatIndex) => void;
  onCancel: () => void;
}) {
  return (
    <Overlay title={`${ACTION_NAMES[action]} — 대상 지정`} onClose={onCancel}>
      <div className="flex flex-col gap-3 text-sm text-white/80">
        <p className="text-xs text-white/50">누구를 대상으로 할까요?</p>
        <div className="flex flex-wrap gap-2">
          {targets.map((seat) => (
            <button
              key={seat}
              onClick={() => onConfirm(seat)}
              className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-medium text-white/80 transition hover:border-amber-300 hover:bg-amber-400/10 hover:text-amber-100"
            >
              {names[seat] ?? `${seat + 1}번`}
            </button>
          ))}
        </div>
        <button onClick={onCancel} className="mt-1 rounded-xl border border-white/15 py-2 text-xs text-white/60 hover:border-white/30">
          취소
        </button>
      </div>
    </Overlay>
  );
}
