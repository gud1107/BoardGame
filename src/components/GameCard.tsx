import Link from "next/link";
import type { GameMeta } from "@/games/types";
import GameThumbnail from "./GameThumbnail";
import { GENRE_META } from "@/games/genres";
import { GAME_COLLECTIONS } from "@/games/collections";

function formatPlayers(g: GameMeta) {
  const { min, max } = g.players;
  return min === max ? `${min}인 전용` : `${min}~${max}인`;
}

function formatTime(g: GameMeta) {
  const { minMinutes, maxMinutes } = g.playTime;
  return minMinutes === maxMinutes ? `${minMinutes}분` : `${minMinutes}~${maxMinutes}분`;
}

export default function GameCard({ game }: { game: GameMeta }) {
  const collection = game.collectionId ? GAME_COLLECTIONS[game.collectionId] : undefined;

  const content = (
    <div
      className={`group flex h-full flex-col overflow-hidden rounded-2xl border bg-white/[0.03] transition ${
        collection ? "border-red-500/25" : "border-white/10"
      } ${game.playable ? "hover:-translate-y-1 hover:border-white/25 hover:bg-white/[0.06]" : "opacity-70"}`}
    >
      <div
        className="relative flex aspect-[4/5] items-center justify-center overflow-hidden text-6xl"
        style={{
          background: `linear-gradient(135deg, ${game.thumbnail.gradient[0]}, ${game.thumbnail.gradient[1]})`,
        }}
      >
        {/* object-contain (not cover) so the box-cover photos — mostly
            portrait, and not necessarily this exact ratio — show their full
            artwork with no top/bottom/side cropping; the padding lets the
            gradient behind show through as a natural letterbox border
            instead of the image butting against the card edge. */}
        <GameThumbnail
          game={game}
          className="drop-shadow-sm"
          imageClassName="object-contain p-4"
          imageSizes="(min-width: 640px) 240px, 50vw"
        />
        {collection && (
          <span className="absolute top-2 left-2 rounded-full bg-red-600/90 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm">
            {collection.emoji} 데스게임
          </span>
        )}
        {!game.playable && (
          <span className="absolute top-2 right-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white/80 backdrop-blur">
            준비중
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2.5 p-4 sm:p-5">
        <h3 className="text-base font-semibold text-white sm:text-lg">{game.name}</h3>
        <p className="line-clamp-2 flex-1 text-xs leading-relaxed text-white/55">{game.description}</p>
        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-white/60">
          <span className="rounded-full bg-white/10 px-2.5 py-1">👥 {formatPlayers(game)}</span>
          <span className="rounded-full bg-white/10 px-2.5 py-1">⏱ {formatTime(game)}</span>
        </div>
        {game.genres && game.genres.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {game.genres.map((genre) => {
              const meta = GENRE_META[genre];
              return (
                <span
                  key={genre}
                  className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{ color: meta.accent, backgroundColor: `${meta.accent}1a` }}
                >
                  {meta.emoji} {meta.label}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  if (!game.playable) {
    return <div className="h-full cursor-not-allowed">{content}</div>;
  }
  return (
    <Link href={`/games/${game.id}`} className="h-full">
      {content}
    </Link>
  );
}
