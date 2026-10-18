"use client";

import Image from "next/image";
import Link from "next/link";
import type { GameMeta } from "@/games/types";
import { GENRE_META } from "@/games/genres";
import { GAME_COLLECTIONS } from "@/games/collections";
import { getGameDifficulty } from "@/constants/gameDifficulty";
import { getPosterImage } from "@/constants/posterImages";
import { getPosterTagline } from "@/constants/posterTaglines";
import type { GameFreshnessBadge } from "@/constants/gameUpdateCount";
import { trackGameEvent } from "@/lib/analytics/gameEvents";
import { useGoldClickBurst } from "./useGoldClickBurst";
import GoldParticleLayer from "./GoldParticleLayer";
import { FreshnessBadge, isFeatured, PlayCountLabel } from "./GameCardStatusBadges";

function formatPlayers(g: GameMeta) {
  const { min, max } = g.players;
  return min === max ? `${min}인` : `${min}~${max}인`;
}

function formatTime(g: GameMeta) {
  const { minMinutes, maxMinutes } = g.playTime;
  return minMinutes === maxMinutes ? `${minMinutes}분` : `${minMinutes}~${maxMinutes}분`;
}

/**
 * Movie-poster lobby card (2026-10-19 개편, switched by `LOBBY_CARD_STYLE`).
 * A real in-game capture fills the card (`/posters/<id>.webp`, see
 * `posterImages.ts`), tinted with the game's own two thumbnail colors, with
 * the title, a one-line hook and the stats laid over the bottom. Games with
 * no capture get a generated poster instead: their emoji blown up over
 * light rays in the same colors. Posters stay dark in light mode too — they
 * are artwork, like the box photos they replace.
 */
export default function GamePosterCard({
  game,
  badge = null,
  plays = 0,
  now = 0,
  liveRoomCount = 0,
  adminLine = null,
  compact = false,
}: {
  game: GameMeta;
  badge?: GameFreshnessBadge | null;
  plays?: number;
  /** Page-load timestamp, for the play label's month name. */
  now?: number;
  /** Live waiting rooms for this game (desktop dashboard). */
  liveRoomCount?: number;
  adminLine?: React.ReactNode;
  /** Desktop 5-column grid: slightly smaller type. */
  compact?: boolean;
}) {
  const { particles, isPressed, triggerBurst } = useGoldClickBurst();
  const [colorA, colorB] = game.thumbnail.gradient;
  const poster = getPosterImage(game.id);
  const difficulty = getGameDifficulty(game.id);
  const collection = game.collectionId ? GAME_COLLECTIONS[game.collectionId] : undefined;
  const genres = (game.genres ?? []).slice(0, 2);
  const longName = game.name.length > 9;

  const content = (
    <div
      className={`group/poster relative aspect-[3/4] overflow-hidden rounded-2xl bg-neutral-950 shadow-[0_6px_20px_-6px_rgba(0,0,0,0.7)] ring-1 ring-white/10 transition duration-500 ease-out light:ring-black/10 ${
        game.playable
          ? "hover:-translate-y-1.5 hover:shadow-[0_22px_44px_-12px_var(--poster-glow)] hover:ring-2 hover:ring-(color:--poster-a) active:scale-[0.97]"
          : "grayscale-[0.7]"
      } ${isPressed ? "lobby-card-pressed scale-95 brightness-125" : ""}`}
      style={
        {
          "--poster-a": colorA,
          "--poster-b": colorB,
          "--poster-glow": `${colorA}99`,
        } as React.CSSProperties
      }
    >
      {/* Art: the capture (slow Ken Burns zoom on hover) or the generated poster. */}
      {poster ? (
        <Image
          src={poster}
          alt={`${game.name} 실제 게임 화면`}
          fill
          sizes={compact ? "240px" : "(min-width: 640px) 280px, 50vw"}
          className="scale-[1.2] object-cover object-center brightness-[1.08] contrast-[1.12] saturate-[1.4] transition-transform duration-[1800ms] ease-out group-hover/poster:scale-[1.32]"
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{ background: `radial-gradient(120% 90% at 50% 30%, ${colorA} 0%, ${colorB} 55%, #050505 100%)` }}
        >
          <div className="poster-rays absolute top-[33%] left-1/2 aspect-square w-[180%] opacity-40" />
          <span
            className="poster-float absolute top-[33%] left-1/2 text-[5.5rem] leading-none drop-shadow-[0_10px_24px_rgba(0,0,0,0.55)]"
            aria-hidden
          >
            {game.thumbnail.emoji}
          </span>
        </div>
      )}

      {/* Color grade in the game's colors + readability gradients. */}
      <div
        className={`pointer-events-none absolute inset-0 mix-blend-soft-light ${poster ? "opacity-35" : "opacity-70"}`}
        style={{ background: `linear-gradient(155deg, ${colorA} 0%, transparent 45%, ${colorB} 100%)` }}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1/4 bg-gradient-to-b from-black/70 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[58%] bg-gradient-to-t from-black via-black/75 to-transparent" />
      {/* Bottom glow strip in the game's color. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 opacity-50 mix-blend-screen"
        style={{ background: `radial-gradient(80% 100% at 50% 100%, ${colorA}66, transparent 70%)` }}
      />
      {game.playable && <div className="poster-shine pointer-events-none absolute inset-0" />}
      <GoldParticleLayer particles={particles} />

      {/* Top row: genre / collection on the left, status on the right. */}
      <div className="absolute top-2 right-14 left-2">
        <div className="flex min-w-0 flex-wrap gap-1">
          {collection && (
            <span className="rounded-full bg-red-600/90 px-1.5 py-0.5 text-[9px] font-bold text-white shadow-sm">
              {collection.emoji} 데스게임
            </span>
          )}
          {isFeatured(game) && (
            <span className="rounded-full bg-gradient-to-r from-amber-400 to-yellow-300 px-1.5 py-0.5 text-[9px] font-extrabold text-black shadow-sm">
              ⭐ 추천
            </span>
          )}
          {genres.map((genre, i) => (
            <span
              key={genre}
              className={`rounded-full border px-1.5 py-px text-[9px] font-bold text-white/90 backdrop-blur-sm ${i > 0 || collection ? "hidden sm:inline" : ""}`}
              style={{ borderColor: `${GENRE_META[genre].accent}88`, backgroundColor: `${GENRE_META[genre].accent}40` }}
            >
              {GENRE_META[genre].emoji} {GENRE_META[genre].label}
            </span>
          ))}
          {liveRoomCount > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/90 px-1.5 py-0.5 text-[9px] font-bold text-white shadow-sm">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
              {liveRoomCount}개 방
            </span>
          )}
        </div>
      </div>
      {game.playable ? (
        <FreshnessBadge badge={badge} />
      ) : (
        <span className="absolute top-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white/80 backdrop-blur">
          준비중
        </span>
      )}

      {/* Bottom: title, hook, stats, CTA. */}
      <div className={`absolute inset-x-0 bottom-0 flex flex-col ${compact ? "gap-1 p-3" : "gap-0.5 p-2.5 sm:gap-1.5 sm:p-4"}`}>
        <h3
          className={`line-clamp-2 font-black leading-[1.15] tracking-tight break-keep text-white ${
            compact
              ? longName ? "text-base" : "text-xl"
              : longName ? "text-[15px] sm:text-xl" : "text-[20px] sm:text-[26px]"
          }`}
          style={{ textShadow: `0 2px 10px rgba(0,0,0,0.85), 0 0 22px ${colorA}aa` }}
        >
          {game.name}
        </h3>
        <p className={`line-clamp-2 font-semibold leading-snug break-keep text-white/85 ${compact ? "text-[11px]" : "text-[11px] sm:text-[13px]"}`}>
          {getPosterTagline(game)}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-medium text-white/70">
          <span>👥 {formatPlayers(game)}</span>
          <span>⏱ {formatTime(game)}</span>
          {difficulty && (
            <span className="text-amber-300" title={`체감 난이도 ${difficulty}/5`}>
              {"★".repeat(difficulty)}
              <span className="text-white/25">{"★".repeat(5 - difficulty)}</span>
            </span>
          )}
        </div>
        <PlayCountLabel plays={plays} now={now} className="text-[10px] font-bold text-orange-300! light:text-orange-300!" />
        {adminLine}
        {game.playable && (
          <span
            className="mt-1 hidden items-center justify-center gap-1 rounded-full py-1.5 text-[11px] font-extrabold text-white shadow-[0_4px_14px_-4px_var(--poster-glow)] transition duration-300 sm:flex sm:translate-y-1 sm:opacity-0 sm:group-hover/poster:translate-y-0 sm:group-hover/poster:opacity-100 [@media(hover:none)]:translate-y-0 [@media(hover:none)]:opacity-100"
            style={{ background: `linear-gradient(90deg, ${colorA}, ${colorB})` }}
          >
            ▶ 지금 플레이
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
      className="block h-full"
      onClick={(e) => {
        trackGameEvent(game.id, "hub_click");
        triggerBurst(e);
      }}
    >
      {content}
    </Link>
  );
}
