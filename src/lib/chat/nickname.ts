const STORAGE_KEY = "bg_chat_nickname";

/**
 * Display name for the global lobby chat, remembered per-browser like
 * `deviceId.ts`'s `bg_device_id`. Deliberately separate from
 * `RoomNicknameField`'s betting-roster identity (`src/components/identity/
 * RoomNicknameField.tsx`) — a lobby visitor isn't necessarily part of any
 * betting session, so this is just a plain remembered nickname.
 */
export function getChatNickname(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(STORAGE_KEY) ?? "";
}

export function setChatNickname(name: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, name);
}
