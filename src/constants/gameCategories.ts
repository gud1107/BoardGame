import type { GameId } from "@/games/types";

/**
 * A hand-curated "row" of games for the mobile Netflix-style horizontal
 * carousel lobby (see `GameCategoryRow.tsx`). Deliberately separate from
 * `GameGenre` (src/games/genres.ts) — genres are a flat filter axis applied
 * uniformly across the whole catalog, while these categories are a small,
 * editorially chosen set scoped to the 6 fully-built titles, meant to read
 * as "curated rows" rather than an exhaustive taxonomy. `gameIds` may
 * overlap across categories (the same game can headline more than one row)
 * and are resolved against `GAME_REGISTRY` at render time — an id that no
 * longer exists there is silently skipped rather than erroring.
 */
export interface GameCategoryDef {
  id: string;
  title: string;
  description: string;
  gameIds: GameId[];
}

export const GAME_CATEGORIES: GameCategoryDef[] = [
  {
    id: "hot-now",
    title: "🔥 지금 가장 핫한 게임",
    description: "지금 가장 인기 있는 추천 타이틀을 한 자리에 모았습니다.",
    gameIds: [
      "destiny-war-39",
      "las-vegas",
      "grid-poker",
      "mal-dalli-ja",
      "dalmuti",
      "no-thanks",
    ],
  },
  {
    id: "mind-strategy",
    title: "🧠 두뇌 풀가동 심리·전략",
    description: "예측과 수싸움, 눈치 게임으로 상대를 흔드는 심리전 카드 게임.",
    gameIds: ["destiny-war-39", "grid-poker", "dalmuti"],
  },
  {
    id: "party-luck-betting",
    title: "🎲 파티 & 럭키 다이스/베팅",
    description: "주사위 운과 배짱 있는 베팅으로 왁자지껄 즐기는 파티 게임.",
    gameIds: ["las-vegas", "mal-dalli-ja", "no-thanks"],
  },
  {
    id: "fast-race",
    title: "⚡ 빠른 템포 & 스피드 레이스",
    description: "짧고 굵게, 빠른 템포로 승부가 갈리는 스피드 게임.",
    gameIds: ["mal-dalli-ja", "no-thanks"],
  },
];
