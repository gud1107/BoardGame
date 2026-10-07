"use client";

import { ROOM_TOAST_MS, useRoomToasts } from "@/lib/activeRooms/roomToasts";

/**
 * Join/leave nickname toasts for every online game's waiting room — see
 * `roomToasts.ts`. Mounted once in the root layout; renders nothing until
 * `useActiveRoomListing` pushes a toast.
 */
export default function RoomEntryToasts() {
  const toasts = useRoomToasts();
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed left-1/2 z-50 flex w-[min(92vw,360px)] -translate-x-1/2 flex-col items-center gap-2"
      style={{ top: "calc(var(--site-header-h, 96px) + 52px)" }}
    >
      <style>{`
        @keyframes room-toast-life {
          0% { opacity: 0; transform: translateY(-10px) scale(0.92); }
          8% { opacity: 1; transform: translateY(0) scale(1.04); }
          14% { transform: scale(1); }
          88% { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-6px); }
        }
      `}</style>
      {toasts.map((t) => {
        const isJoin = t.kind === "join";
        return (
          <div
            key={t.id}
            className={`flex max-w-full items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold shadow-xl backdrop-blur ${
              isJoin
                ? "border-amber-300/60 bg-amber-950/85 text-amber-100 light:border-amber-300 light:bg-amber-50/95 light:text-amber-900"
                : "border-white/15 bg-neutral-900/85 text-white/75 light:border-slate-300 light:bg-white/95 light:text-slate-600"
            }`}
            style={{ animation: `room-toast-life ${ROOM_TOAST_MS}ms ease-out both` }}
          >
            <span aria-hidden>{isJoin ? "🎉" : "👋"}</span>
            <span className="truncate">{t.name}</span>
            <span className="shrink-0 font-medium opacity-80">
              {isJoin ? "님이 입장했어요" : "님이 나갔어요"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
