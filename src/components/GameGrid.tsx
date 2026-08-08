import type { GameMeta } from "@/games/types";
import GameCard from "./GameCard";

export default function GameGrid({ games }: { games: GameMeta[] }) {
  return (
    // Mobile (base, no breakpoint below sm exists in this Tailwind config):
    // 2 cols. Tablet (sm/md): 2 cols. Desktop (lg/xl): 3~4 cols — capped at 4
    // even on very wide viewports so the now-taller (aspect-[4/5]) cover art
    // stays legible instead of shrinking into a dense wall of tiny cards.
    <div className="grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">
      {games.map((game) => (
        <GameCard key={game.id} game={game} />
      ))}
    </div>
  );
}
