"use client";

import { useEffect, useRef, useState } from "react";
import { useBettingStore } from "@/store/bettingStore";
import { rememberRoomNickname } from "@/lib/identity/lastNickname";
import CharacterButton from "@/components/profile/CharacterButton";
import { cleanNickname, startingNickname, useMyNickname } from "@/lib/identity/myNickname";

export interface RoomIdentityValue {
  name: string;
  /** Real betting-system playerId, set only when picked from the active session's roster below. */
  playerId?: string;
}

interface Props {
  value: RoomIdentityValue;
  onChange: (value: RoomIdentityValue) => void;
  placeholder?: string;
  accent?: "emerald" | "amber" | "rose" | "fuchsia";
  /**
   * Fired on a plain Enter keydown in the guest-mode text input (not the
   * roster chip picker, which has no text field). IME composition is
   * guarded here so committing a Korean syllable block doesn't fire this
   * twice — see `e.nativeEvent.isComposing`. Callers pass their room
   * create/join submit handler (e.g. `enterRoom`); that handler already
   * owns its own empty/invalid-input validation and error display, so this
   * is a plain "Enter = submit" wire-through, nothing more.
   */
  onEnter?: () => void;
}

// Tailwind's scanner needs literal class strings, not `border-${accent}-400`
// template interpolation — so each accent's full class set is spelled out
// here rather than built at runtime.
const ACCENT_CLASSES: Record<NonNullable<Props["accent"]>, { input: string; chipSelected: string }> = {
  emerald: { input: "focus:border-emerald-400", chipSelected: "border-emerald-400 bg-emerald-500/20 text-white" },
  amber: { input: "focus:border-amber-400", chipSelected: "border-amber-400 bg-amber-500/20 text-white" },
  rose: { input: "focus:border-rose-400", chipSelected: "border-rose-400 bg-rose-500/20 text-white" },
  fuchsia: { input: "focus:border-fuchsia-400", chipSelected: "border-fuchsia-400 bg-fuchsia-500/20 text-white" },
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
 *
 * The text input starts filled with the profile's 게임 닉네임 (`myNickname.ts`), or the
 * last name typed into any room, and offers to make a newly typed name the default.
 */
export default function RoomNicknameField({ value, onChange: onChangeProp, placeholder = "닉네임을 입력하세요", accent = "emerald", onEnter }: Props) {
  // Remember the typed name for the /visitors page (see lastNickname.ts).
  const onChange = (next: RoomIdentityValue) => {
    rememberRoomNickname(next.name);
    onChangeProp(next);
  };
  const session = useBettingStore((s) => s.session);
  const hasRoster = Boolean(session && session.participants.length > 0);
  const [guestMode, setGuestMode] = useState(!hasRoster);
  const classes = ACCENT_CLASSES[accent];
  const profileNick = useMyNickname((s) => s.nickname);
  const nickHydrated = useMyNickname((s) => s.hydrated);
  const initNick = useMyNickname((s) => s.init);
  const setProfileNick = useMyNickname((s) => s.set);
  useEffect(() => {
    void initNick();
  }, [initNick]);
  // fill an empty name field once, when the profile nickname is known
  const filled = useRef(false);
  useEffect(() => {
    if (filled.current || !nickHydrated || (hasRoster && !guestMode)) return;
    filled.current = true;
    const start = startingNickname(profileNick);
    if (!value.name.trim() && start) onChangeProp({ name: start, playerId: undefined });
  }, [nickHydrated, profileNick, hasRoster, guestMode, value.name, onChangeProp]);
  const typed = cleanNickname(value.name);
  // the name the field starts with (filled in above): say so while it's still the one in the box
  const autoName = nickHydrated ? startingNickname(profileNick) : "";
  const showAuto = !!autoName && typed === autoName;

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
                value.playerId === p.playerId
                  ? classes.chipSelected + " light:text-slate-900"
                  : "border-white/15 text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600 light:hover:border-slate-400"
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
          className="self-start text-xs text-white/40 underline hover:text-white/70 light:text-slate-400 light:hover:text-slate-600"
        >
          다른 이름으로 입장 (내기 참가자 아님)
        </button>
        <CharacterButton />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        aria-label="내 닉네임"
        value={value.name}
        onChange={(e) => onChange({ name: e.target.value, playerId: undefined })}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onEnter?.();
          }
        }}
        placeholder={placeholder}
        className={`rounded-lg border bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none light:bg-white light:text-slate-900 light:placeholder:text-slate-400 ${
          showAuto ? "border-amber-300/70 ring-2 ring-amber-300/30 light:border-amber-400" : "border-white/10 light:border-slate-300"
        } ${classes.input}`}
      />
      {showAuto && (
        <p className="text-xs text-amber-200 light:text-amber-700">
          🏷️ <b>&lsquo;{autoName}&rsquo;</b>(으)로 들어가요 — {profileNick === autoName ? "프로필의 게임 닉네임" : "지난번에 쓴 이름"}이에요. 다른 이름을 쓰려면 위 칸을 고치세요.
        </p>
      )}
      {typed && typed !== profileNick && (
        <button
          type="button"
          onClick={() => setProfileNick(typed)}
          className="self-start text-xs text-white/50 underline hover:text-white/80 light:text-slate-500 light:hover:text-slate-700"
        >
          ⭐ &lsquo;{typed}&rsquo;을(를) 내 기본 닉네임으로 저장 (다음 방부터 자동 입력)
        </button>
      )}
      {hasRoster && (
        <button
          type="button"
          onClick={() => setGuestMode(false)}
          className="self-start text-xs text-white/40 underline hover:text-white/70 light:text-slate-400 light:hover:text-slate-600"
        >
          내기 참가자 목록에서 선택
        </button>
      )}
      <CharacterButton />
    </div>
  );
}
