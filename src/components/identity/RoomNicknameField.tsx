"use client";

import { useState } from "react";
import { useBettingStore } from "@/store/bettingStore";

export interface RoomIdentityValue {
  name: string;
  /** Real betting-system playerId, set only when picked from the active session's roster below. */
  playerId?: string;
}

interface Props {
  value: RoomIdentityValue;
  onChange: (value: RoomIdentityValue) => void;
  placeholder?: string;
  accent?: "emerald" | "amber" | "rose";
}

// Tailwind's scanner needs literal class strings, not `border-${accent}-400`
// template interpolation — so each accent's full class set is spelled out
// here rather than built at runtime.
const ACCENT_CLASSES: Record<NonNullable<Props["accent"]>, { input: string; chipSelected: string }> = {
  emerald: { input: "focus:border-emerald-400", chipSelected: "border-emerald-400 bg-emerald-500/20 text-white" },
  amber: { input: "focus:border-amber-400", chipSelected: "border-amber-400 bg-amber-500/20 text-white" },
  rose: { input: "focus:border-rose-400", chipSelected: "border-rose-400 bg-rose-500/20 text-white" },
};

/**
 * Single-session identity mapping for online-room name entry. The betting
 * system's `playerId` (IndexedDB `PlayerRecord.id`) previously had no
 * connection at all to the free-text nickname typed into a game room — every
 * online game just made up a synthetic `roomCode:seat` id, so the betting
 * ledger's "자동 채움" ranking could never actually match a real participant,
 * and retyping a name (even a slightly different one) risked creating a
 * duplicate player. This fixes that by making "join as an existing betting
 * participant" a *selection* from the session roster (guaranteed exact
 * name+id match) instead of a retype, while still allowing free-text entry
 * for guests who aren't part of any betting session.
 *
 * Only meaningful when a betting session happens to be active *on this
 * device* — see the plan/HANDOFF notes on why that's device-local, not
 * synced across every player's phone. When there's no active session this
 * renders identically to the old plain text input.
 */
export default function RoomNicknameField({ value, onChange, placeholder = "닉네임을 입력하세요", accent = "emerald" }: Props) {
  const session = useBettingStore((s) => s.session);
  const hasRoster = Boolean(session && session.participants.length > 0);
  const [guestMode, setGuestMode] = useState(!hasRoster);
  const classes = ACCENT_CLASSES[accent];

  if (session && hasRoster && !guestMode) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          {session.participants.map((p) => (
            <button
              key={p.playerId}
              type="button"
              onClick={() => onChange({ name: p.name, playerId: p.playerId })}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                value.playerId === p.playerId ? classes.chipSelected : "border-white/15 text-white/70 hover:border-white/30"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            setGuestMode(true);
            onChange({ name: "", playerId: undefined });
          }}
          className="self-start text-xs text-white/40 underline hover:text-white/70"
        >
          다른 이름으로 입장 (내기 참가자 아님)
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        value={value.name}
        onChange={(e) => onChange({ name: e.target.value, playerId: undefined })}
        placeholder={placeholder}
        className={`rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none ${classes.input}`}
      />
      {hasRoster && (
        <button
          type="button"
          onClick={() => setGuestMode(false)}
          className="self-start text-xs text-white/40 underline hover:text-white/70"
        >
          내기 참가자 목록에서 선택
        </button>
      )}
    </div>
  );
}
