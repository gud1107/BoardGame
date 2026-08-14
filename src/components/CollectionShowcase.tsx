import type { GameCollectionId, GameMeta } from "@/games/types";
import { GAME_COLLECTIONS } from "@/games/collections";
import GameGrid from "./GameGrid";

/**
 * Featured banner for a named cross-catalog collection (currently just the
 * Netflix <데스게임> series — see `GAME_COLLECTIONS`). Rendered above the
 * regular dashboard grid so games sharing a collection stay visually
 * bundled together instead of scattered across the alphabetical/playability
 * sort order. Renders nothing if no games in `games` match `collectionId`,
 * so the caller can pass its already-filtered (search/player-count) list
 * without checking emptiness itself.
 */
export default function CollectionShowcase({
  collectionId,
  games,
}: {
  collectionId: GameCollectionId;
  games: GameMeta[];
}) {
  const matches = games.filter((g) => g.collectionId === collectionId);
  if (matches.length === 0) return null;

  const meta = GAME_COLLECTIONS[collectionId];

  return (
    <section
      className="mb-8 rounded-2xl border p-4 sm:p-5"
      style={{
        borderColor: `${meta.accent}33`,
        background: `linear-gradient(160deg, ${meta.accent}14 0%, rgba(255,255,255,0.02) 60%)`,
      }}
    >
      <div className="mb-4 flex items-start gap-2">
        <span className="text-xl leading-none">{meta.emoji}</span>
        <div>
          <h2 className="text-base font-bold text-white sm:text-lg">{meta.label}</h2>
          <p className="mt-0.5 text-xs text-white/50 sm:text-sm">{meta.description}</p>
        </div>
      </div>
      <GameGrid games={matches} />
    </section>
  );
}
