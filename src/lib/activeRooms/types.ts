/**
 * A joinable room shown in the desktop lobby dashboard's "실시간 활성 대기실"
 * panel (see `src/app/page.tsx`). Sourced from the `active_rooms` Supabase
 * table — see `supabase/schema.sql` for the write posture and staleness
 * caveats.
 */
export interface ActiveRoomRecord {
  id: string;
  gameId: string;
  roomCode: string;
  hostName: string | null;
  playerCount: number;
  maxPlayers: number;
  /**
   * True for a 🌐 공개방 — listed in the lobby's public-room browser and
   * one-click joinable. False for a 🔒 비공개방, which stays reachable only
   * by its invite code (the row still exists so code lookup / per-game room
   * counts keep working). See `src/lib/activeRooms/visibility.ts`.
   */
  isPublic: boolean;
  /** Host-typed room title (≤30 chars), or null — the UI falls back to "<host>님의 방". */
  title: string | null;
  updatedAt: string;
}
