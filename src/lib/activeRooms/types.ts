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
  updatedAt: string;
}
