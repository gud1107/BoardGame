import Link from "next/link";
import type { GameMeta } from "@/games/types";
import GameThumbnail from "./GameThumbnail";
import { GENRE_META } from "@/games/genres";
import { GAME_COLLECTIONS } from "@/games/collections";
import { getSoundEngine } from "@/lib/audio/soundEngine";

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
      className={`group relative flex h-full flex-col overflow-hidden rounded-2xl border bg-gradient-to-b from-neutral-900/80 to-neutral-950/90 transition ${
        collection ? "border-red-500/25" : "border-amber-500/15"
      } ${
        game.playable
          ? "hover:-translate-y-1 hover:border-amber-400/50 hover:shadow-[0_8px_28px_rgba(245,158,11,0.15)] active:scale-95"
          : "opacity-70"
      }`}
    >
      {/* 카드 상단 골드 림라이트 — 다크 럭셔리 리뉴얼(2026-09-12) */}
      <div className="absolute top-0 right-0 left-0 h-px bg-gradient-to-r from-transparent via-amber-400/0 to-transparent transition-all duration-500 group-hover:via-amber-300/60" />
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
        <h3 className="line-clamp-2 break-keep text-base font-semibold text-white sm:text-lg">
          {game.name}
        </h3>
        <p className="line-clamp-2 flex-1 text-xs leading-relaxed text-white/55">{game.description}</p>
        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-white/60">
          <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-amber-100/80">👥 {formatPlayers(game)}</span>
          <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-amber-100/80">⏱ {formatTime(game)}</span>
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
        {game.playable && (
          <span className="mt-1 inline-flex items-center gap-1 self-start rounded-full bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-300 transition group-hover:bg-amber-500/25">
            입장하기 →
          </span>
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
