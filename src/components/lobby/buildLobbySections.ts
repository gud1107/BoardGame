import type { GameGenre, GameMeta } from "@/games/types";
import { GENRE_META, GENRE_ORDER } from "@/games/genres";
import { GAME_COLLECTIONS } from "@/games/collections";
import { isNewGame } from "@/constants/gameUpdateCount";

/**
 * One titled row group in the 보드게임허브 browse view (2026-11-22). The
 * 81-game catalog used to be one flat grid; while no search/filter is
 * active it's now split into these sections, each showing two rows until
 * "더 보기" is pressed (see `LobbySections.tsx`).
 */
export interface LobbySection {
  id: string;
  emoji: string;
  title: string;
  description: string;
  accent: string;
  games: GameMeta[];
}

/** How many games the 🔥 popular strip lists (it's a highlight, not a partition). */
const POPULAR_LIMIT = 12;

/**
 * Builds the sections from the lobby's already sorted + playability-ordered
 * list, so each section keeps the user's chosen sort.
 *
 * - 🔥 인기 / 🆕 신작 / collections are highlights: their games also appear in
 *   their genre section below.
 * - Genre sections partition the catalog by each game's FIRST genre, so
 *   every game is reachable exactly once across them.
 */
export function buildLobbySections(
  games: GameMeta[],
  playCounts: ReadonlyMap<string, number>,
  now: number,
): LobbySection[] {
  const sections: LobbySection[] = [];
  const playable = games.filter((g) => g.playable);

  const popular = playable
    .filter((g) => (playCounts.get(g.id) ?? 0) > 0)
    .sort((a, b) => (playCounts.get(b.id) ?? 0) - (playCounts.get(a.id) ?? 0))
    .slice(0, POPULAR_LIMIT);
  if (popular.length > 0) {
    sections.push({
      id: "popular",
      emoji: "🔥",
      title: "지금 인기 있는 게임",
      description: "다른 플레이어들이 가장 많이 시작한 게임",
      accent: "#fb923c",
      games: popular,
    });
  }

  const fresh = playable.filter((g) => isNewGame(g.id, now));
  if (fresh.length > 0) {
    sections.push({
      id: "new",
      emoji: "🆕",
      title: "새로 나온 게임",
      description: "최근 추가된 따끈따끈한 게임",
      accent: "#34d399",
      games: fresh,
    });
  }

  for (const [collectionId, collection] of Object.entries(GAME_COLLECTIONS)) {
    const matches = games.filter((g) => g.collectionId === collectionId);
    if (matches.length === 0) continue;
    sections.push({
      id: `collection-${collectionId}`,
      emoji: collection.emoji,
      title: collection.label,
      description: collection.description,
      accent: collection.accent,
      games: matches,
    });
  }

  const byGenre = new Map<GameGenre, GameMeta[]>();
  const noGenre: GameMeta[] = [];
  for (const g of games) {
    const primary = g.genres?.[0];
    if (!primary) {
      noGenre.push(g);
      continue;
    }
    const list = byGenre.get(primary) ?? [];
    list.push(g);
    byGenre.set(primary, list);
  }
  for (const genre of GENRE_ORDER) {
    const list = byGenre.get(genre);
    if (!list?.length) continue;
    const meta = GENRE_META[genre];
    sections.push({
      id: `genre-${genre}`,
      emoji: meta.emoji,
      title: `${meta.label} 게임`,
      description: meta.description,
      accent: meta.accent,
      games: list,
    });
  }
  if (noGenre.length > 0) {
    sections.push({
      id: "genre-etc",
      emoji: "🎮",
      title: "그 밖의 게임",
      description: "장르를 하나로 정하기 어려운 게임",
      accent: "#94a3b8",
      games: noGenre,
    });
  }
  return sections;
}
