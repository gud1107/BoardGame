"use client";

import {
  ROOM_TITLE_MAX,
  setRoomTitle,
  setRoomVisibility,
  useRoomTitle,
  useRoomVisibility,
  type RoomVisibility,
} from "@/lib/activeRooms/visibility";

const VISIBILITY_OPTIONS: { value: RoomVisibility; label: string; hint: string }[] = [
  { value: "public", label: "🌐 공개방", hint: "로비 공개방 목록에 보여서 누구나 바로 들어올 수 있어요" },
  { value: "private", label: "🔒 비공개방", hint: "초대 코드를 아는 사람만 들어올 수 있어요" },
];

/**
 * 🌐 공개방 / 🔒 비공개방 toggle + room title, shared by the room-creation
 * screen (`RulebookGate`) and the waiting-room `HostedRoomControls` pill.
 * Both write the same per-game settings (`src/lib/activeRooms/visibility.ts`),
 * which `useActiveRoomListing` re-publishes live. The title only shows in
 * the public list, so its input is hidden for a private room.
 */
export default function RoomListingSettings({
  gameId,
  heading,
  className = "",
}: {
  gameId: string;
  heading: string;
  className?: string;
}) {
  const visibility = useRoomVisibility(gameId);
  const title = useRoomTitle(gameId);
  const current = VISIBILITY_OPTIONS.find((o) => o.value === visibility) ?? VISIBILITY_OPTIONS[0];

  return (
    <div className={`flex w-full flex-col gap-1.5 text-left ${className}`}>
      <span className="text-[11px] font-semibold text-white/50 light:text-slate-500">{heading}</span>
      <div role="radiogroup" aria-label="방 입장 방식" className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-black/20 p-1 light:border-slate-200 light:bg-slate-100">
        {VISIBILITY_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={visibility === o.value}
            onClick={() => setRoomVisibility(gameId, o.value)}
            className={`rounded-lg py-1.5 text-xs font-bold transition ${
              visibility === o.value
                ? o.value === "public"
                  ? "bg-emerald-500 text-neutral-950 shadow"
                  : "bg-rose-500/90 text-white shadow"
                : "text-white/50 hover:text-white/80 light:text-slate-500 light:hover:text-slate-800"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <span className="text-center text-[11px] break-keep text-white/40 light:text-slate-500">{current.hint}</span>
      {visibility === "public" && (
        <label className="flex flex-col gap-1">
          <span className="sr-only">방 제목</span>
          <input
            value={title}
            onChange={(e) => setRoomTitle(gameId, e.target.value)}
            maxLength={ROOM_TITLE_MAX}
            placeholder="방 제목 (선택) — 예: 초보 환영! 매너 게임해요"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-white/30 focus:border-emerald-400 focus:outline-none light:border-slate-300 light:bg-white light:text-slate-900 light:placeholder:text-slate-400"
          />
        </label>
      )}
    </div>
  );
}
