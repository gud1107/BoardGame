import type { GameMeta } from "@/games/types";
import GameCard from "./GameCard";

export default function GameGrid({ games }: { games: GameMeta[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {games.map((game) => (
        <GameCard key={game.id} game={game} />
      ))}
    </div>
  );
}
