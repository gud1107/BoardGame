import type { GameCategoryDef } from "@/constants/gameCategories";
import { GAME_REGISTRY } from "@/games/registry";
import GameCard from "@/components/GameCard";

/**
 * One Netflix-style horizontal-scroll "row" for the mobile lobby (see
 * `src/app/page.tsx` — rendered only in the `sm:hidden` mobile-only section,
 * as a curated preview stacked above the full searchable catalog, which as
 * of 2026-09-02 renders on mobile too instead of being desktop-only).
 * Each card gets a fixed peek width (not the grid's implicit column width)
 * so the next card's edge is visibly cut off at the viewport edge — the
 * "you can swipe" affordance — and snaps flush via `snap-x`/`snap-start`
 * once the finger lifts. `scrollbar-hide` (globals.css) + the inline
 * `WebkitOverflowScrolling` hide the OS scrollbar and give the scroll its
 * native momentum/deceleration feel on iOS.
 */
export default function GameCategoryRow({ category }: { category: GameCategoryDef }) {
  const games = category.gameIds
    .map((id) => GAME_REGISTRY.find((g) => g.id === id))
    .filter((g): g is NonNullable<typeof g> => g != null);

  if (games.length === 0) return null;

  return (
    <section className="mb-6">
      <div className="mb-3 px-4">
        <h2 className="text-base font-bold text-white">{category.title}</h2>
        <p className="mt-0.5 text-xs text-white/50">{category.description}</p>
      </div>
      <div
        className="scrollbar-hide flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {games.map((game) => (
          <div key={game.id} className="w-[72vw] max-w-[260px] shrink-0 snap-start">
            <GameCard game={game} />
          </div>
        ))}
      </div>
    </section>
  );
}
