import type { GameMeta } from "@/games/types";
import GameCard from "./GameCard";
import GamePosterCard from "./lobby/GamePosterCard";
import { LOBBY_CARD_STYLE } from "@/constants/lobbyCardStyle";
import { getGameFreshnessBadge } from "@/constants/gameUpdateCount";

/** The lobby card for the active `LOBBY_CARD_STYLE` (also used by the sectioned browse view). */
export const LobbyCard = LOBBY_CARD_STYLE === "poster" ? GamePosterCard : GameCard;
const Card = LobbyCard;

export default function GameGrid({
  games,
  monthPlays,
  now,
  adminLine,
}: {
  games: GameMeta[];
  /** This month's real starts per game (shown as "🔥 10월 N회 플레이"). */
  monthPlays: ReadonlyMap<string, number>;
  now: number;
  /** Site admins on a 🛠 sort: per-card commit/push/deploy line. */
  adminLine?: (gameId: string) => React.ReactNode;
}) {
  return (
    // Phones 2 cols, tablets 3 (md), small laptops 4 (lg) — 2026-11-22: a
    // 900px tablet used to get two ~430px-wide posters. Capped at 4 so the
    // cover art stays legible instead of shrinking into tiny cards.
    <div className={`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 ${LOBBY_CARD_STYLE === "poster" ? "gap-3 sm:gap-4" : "gap-4 sm:gap-5"}`}>
      {games.map((game) => (
        <Card
          key={game.id}
          game={game}
          badge={getGameFreshnessBadge(game.id, now)}
          plays={monthPlays.get(game.id) ?? 0}
          now={now}
          adminLine={adminLine?.(game.id)}
        />
      ))}
    </div>
  );
}
