"use client";

import Link from "next/link";
import type { GameMeta } from "@/games/types";
import { GENRE_META } from "@/games/genres";
import { getGameDifficulty } from "@/constants/gameDifficulty";
import GameThumbnail from "@/components/GameThumbnail";
import { getSoundEngine } from "@/lib/audio/soundEngine";

function formatPlayers(g: GameMeta) {
  const { min, max } = g.players;
  return min === max ? `${min}인` : `${min}~${max}인`;
}

const MAX_GENRE_TAGS = 2;

/**
 * Large "showcase" game card for the desktop dashboard's full-width grid
 * (see `DesktopDashboard.tsx`) — replaces the earlier small-footprint
 * `CompactGameCard` (removed 2026-09-12) now that the dashboard no longer
 * reserves side columns for a room-list/profile rail and gives the grid
 * ~85%+ of the screen instead. Bigger thumbnail, genre tag chips, and a
 * difficulty star badge (`getGameDifficulty` — a hand-assigned rating, see
 * that file's doc comment on why it's editorial and not real player data).
 *
 * Still shows the live "지금 열린 방" count sourced from the real
 * `active_rooms` table (unchanged infra from the same-day dashboard build —
 * only the dedicated right-rail panel was removed, not the underlying
 * table/hooks) — hidden entirely at 0 so it never implies a live count it
 * can't back up.
 */
export default function GameShowcaseCard({
  game,
  liveRoomCount,
}: {
  game: GameMeta;
  liveRoomCount: number;
}) {
  const difficulty = getGameDifficulty(game.id);
  const genreTags = (game.genres ?? []).slice(0, MAX_GENRE_TAGS);

  const content = (
    <div
      className={`group flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] transition-all duration-300 ${
        game.playable
          ? "hover:scale-[1.05] hover:border-rose-400/50 hover:shadow-[0_0_24px_rgba(244,63,94,0.25)] active:scale-100"
          : "opacity-60"
      }`}
    >
      <div
        className="relative flex aspect-[4/3] items-center justify-center overflow-hidden text-4xl"
        style={{
          background: `linear-gradient(135deg, ${game.thumbnail.gradient[0]}, ${game.thumbnail.gradient[1]})`,
        }}
      >
        <GameThumbnail game={game} imageClassName="object-contain p-3" imageSizes="220px" />
        {liveRoomCount > 0 && (
          <span className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            {liveRoomCount}개 방 오픈
          </span>
        )}
        {!game.playable && (
          <span className="absolute top-1.5 right-1.5 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white/80 backdrop-blur">
            준비중
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <p className="line-clamp-1 break-keep text-sm font-bold text-white">{game.name}</p>
        <div className="flex flex-wrap items-center gap-1 text-[10px] text-white/50">
          <span>👥 {formatPlayers(game)}</span>
          {difficulty && (
            <span className="text-amber-300/90" title={`체감 난이도 ${difficulty}/5`}>
              {"★".repeat(difficulty)}
              <span className="text-white/20">{"★".repeat(5 - difficulty)}</span>
            </span>
          )}
        </div>
        {genreTags.length > 0 && (
          <div className="mt-auto flex flex-wrap gap-1 pt-1">
            {genreTags.map((genre) => (
              <span
                key={genre}
                className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
                style={{
                  color: GENRE_META[genre].accent,
                  backgroundColor: `${GENRE_META[genre].accent}1a`,
                }}
              >
                {GENRE_META[genre].emoji} {GENRE_META[genre].label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  if (!game.playable) {
    return <div className="h-full cursor-not-allowed">{content}</div>;
  }
  return (
    <Link
      href={`/games/${game.id}`}
      className="h-full"
      onClick={() => {
        const engine = getSoundEngine();
        engine.unlock();
        engine.playWoodTap();
      }}
    >
      {content}
    </Link>
  );
}
