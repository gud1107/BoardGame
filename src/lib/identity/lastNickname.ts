import { getChatNickname } from "@/lib/chat/nickname";

const STORAGE_KEY = "bg_last_room_nickname";

/**
 * The most recent nickname this browser typed into any online game's room
 * name field (`RoomNicknameField`, shared by every online game), falling
 * back to the lobby chat nickname. Sent with visit/play analytics so the
 * /visitors page can put a name next to an anonymous device id.
 */
export function getVisitorNickname(): string {
  if (typeof window === "undefined") return "";
  try {
    return (window.localStorage.getItem(STORAGE_KEY) || getChatNickname()).trim();
  } catch {
    return "";
  }
}

export function rememberRoomNickname(name: string): void {
  const trimmed = name.trim();
  if (typeof window === "undefined" || !trimmed) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, trimmed.slice(0, 24));
  } catch {
    // Storage blocked — the visitor just stays nameless.
  }
}
