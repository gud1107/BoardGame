import Link from "next/link";
import type { GameMeta } from "@/games/types";

function formatPlayers(g: GameMeta) {
  const { min, max } = g.players;
  return min === max ? `${min}인 전용` : `${min}~${max}인`;
}

function formatTime(g: GameMeta) {
  const { minMinutes, maxMinutes } = g.playTime;
  return minMinutes === maxMinutes ? `${minMinutes}분` : `${minMinutes}~${maxMinutes}분`;
}

export default function GameCard({ game }: { game: GameMeta }) {
  const content = (
    <div
      className={`group flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] transition ${
        game.playable ? "hover:-translate-y-1 hover:border-white/25 hover:bg-white/[0.06]" : "opacity-70"
      }`}
    >
      <div
        className="relative flex h-28 items-center justify-center text-5xl sm:h-32"
        style={{
          background: `linear-gradient(135deg, ${game.thumbnail.gradient[0]}, ${game.thumbnail.gradient[1]})`,
        }}
      >
        <span className="drop-shadow-sm">{game.thumbnail.emoji}</span>
        {!game.playable && (
          <span className="absolute top-2 right-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white/80 backdrop-blur">
            준비중
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="text-base font-semibold text-white">{game.name}</h3>
        <p className="line-clamp-2 flex-1 text-xs leading-relaxed text-white/55">{game.description}</p>
        <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-white/60">
          <span className="rounded-full bg-white/10 px-2 py-0.5">👥 {formatPlayers(game)}</span>
          <span className="rounded-full bg-white/10 px-2 py-0.5">⏱ {formatTime(game)}</span>
        </div>
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
