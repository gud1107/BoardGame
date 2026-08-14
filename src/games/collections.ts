import type { GameCollectionId } from "./types";

/**
 * Display metadata for each `GameCollectionId` — rendered as a featured
 * banner row on the dashboard (`CollectionShowcase.tsx`) above the regular
 * grid, independent of genre filtering.
 */
export const GAME_COLLECTIONS: Record<
  GameCollectionId,
  { label: string; emoji: string; description: string; accent: string }
> = {
  "netflix-death-game": {
    label: "넷플릭스 데스게임 시리즈",
    emoji: "🔴",
    description:
      "넷플릭스 예능 <데스게임>에 등장한 게임들을 한 자리에 모았습니다. 실패하면 탈락하는 서바이벌 룰을 그대로 재현했습니다.",
    accent: "#ef4444",
  },
};
