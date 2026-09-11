"use client";

import Link from "next/link";
import type { GameMeta } from "@/games/types";
import GameThumbnail from "@/components/GameThumbnail";
import { getSoundEngine } from "@/lib/audio/soundEngine";

function formatPlayers(g: GameMeta) {
  const { min, max } = g.players;
  return min === max ? `${min}인` : `${min}~${max}인`;
}

function formatTime(g: GameMeta) {
  const { minMinutes, maxMinutes } = g.playTime;
  return minMinutes === maxMinutes ? `${minMinutes}분` : `${minMinutes}~${maxMinutes}분`;
}

/**
 * Small-footprint card for the desktop dashboard's center game grid (see
 * `src/app/page.tsx`) — a compacted sibling of `GameCard.tsx` (which stays
 * the full-size card for every viewport below the xl+ dashboard). Adds a
 * live "지금 열린 방" count sourced from the real `active_rooms` table
 * (aggregated by the caller, see `ActiveRoomsPanel`'s sibling `useActiveRooms`
 * hook) — hidden entirely when 0 so this never implies a live count it can't
 * back up.
 */
export default function CompactGameCard({
  game,
  liveRoomCount,
}: {
  game: GameMeta;
  liveRoomCount: number;
}) {
  const content = (
    <div
      className={`group flex h-full flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] transition ${
        game.playable
          ? "hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.06] active:scale-95"
          : "opacity-60"
      }`}
    >
      <div
        className="relative flex aspect-[4/3] items-center justify-center overflow-hidden text-3xl"
        style={{
          background: `linear-gradient(135deg, ${game.thumbnail.gradient[0]}, ${game.thumbnail.gradient[1]})`,
        }}
      >
        <GameThumbnail game={game} imageClassName="object-contain p-2" imageSizes="140px" />
        {liveRoomCount > 0 && (
          <span className="absolute top-1 left-1 flex items-center gap-0.5 rounded-full bg-emerald-500/90 px-1.5 py-0.5 text-[9px] font-bold text-white shadow-sm">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            {liveRoomCount}
          </span>
        )}
        {!game.playable && (
          <span className="absolute top-1 right-1 rounded-full bg-black/50 px-1.5 py-0.5 text-[9px] font-medium text-white/80 backdrop-blur">
            준비중
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-2">
        <p className="line-clamp-1 break-keep text-[11px] font-semibold text-white">{game.name}</p>
        <div className="flex flex-wrap gap-1 text-[9px] text-white/50">
          <span>👥{formatPlayers(game)}</span>
          <span>⏱{formatTime(game)}</span>
        </div>
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
