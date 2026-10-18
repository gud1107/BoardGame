import type { GameMeta } from "@/games/types";
import GameCard from "./GameCard";
import GamePosterCard from "./lobby/GamePosterCard";
import { LOBBY_CARD_STYLE } from "@/constants/lobbyCardStyle";
import { getGameFreshnessBadge } from "@/constants/gameUpdateCount";

const Card = LOBBY_CARD_STYLE === "poster" ? GamePosterCard : GameCard;

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
    // Mobile (base, no breakpoint below sm exists in this Tailwind config):
    // 2 cols. Tablet (sm/md): 2 cols. Desktop (lg/xl): 3~4 cols — capped at 4
    // even on very wide viewports so the now-taller (aspect-[4/5]) cover art
    // stays legible instead of shrinking into a dense wall of tiny cards.
    <div className={`grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ${LOBBY_CARD_STYLE === "poster" ? "gap-3 sm:gap-4" : "gap-4 sm:gap-5"}`}>
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
