import type { Mode } from "./engine";

/**
 * 단어 마천루 주제 카테고리 — 방장이 방 만들 때 고르면 그 카테고리 주제 중에서만 무작위로 나온다
 * (룰북 §3). 아무것도 안 고르면 그 모드의 전체 주제. 모든 주제는 자기 모드의 카테고리 하나에만
 * 속한다(WordTower.test.ts가 검사).
 */

export interface TopicCategory {
  readonly id: string;
  readonly mode: Mode;
  readonly name: string;
  readonly emoji: string;
  readonly topicIds: readonly string[];
}

export const CATEGORIES: readonly TopicCategory[] = [
  // 🏗️ 자유 쌓기 (words.ts)
  { id: "o-food", mode: "open", name: "먹거리", emoji: "🍎", topicIds: ["fruit", "vegetable", "food", "snack", "drink", "kitchen"] },
  { id: "o-life", mode: "open", name: "생물", emoji: "🐾", topicIds: ["animal", "sea", "bird", "insect", "plant"] },
  { id: "o-place", mode: "open", name: "장소·자연", emoji: "🌍", topicIds: ["country", "region", "place", "nature"] },
  { id: "o-people", mode: "open", name: "사람·생활", emoji: "🧑", topicIds: ["job", "sport", "body", "clothes", "color"] },
  { id: "o-things", mode: "open", name: "물건", emoji: "📦", topicIds: ["stationery", "home", "electronics", "instrument", "vehicle"] },
  // 🎯 정답 모으기 (closedTopics.ts)
  {
    id: "c-science",
    mode: "closed",
    name: "자연·과학",
    emoji: "🔭",
    topicIds: ["c-season", "c-rainbow", "c-planet", "c-moon", "c-earth", "c-compass", "c-8dir"],
  },
  { id: "c-geo", mode: "closed", name: "지리", emoji: "🗺️", topicIds: ["c-ocean", "c-continent", "c-metro", "c-province", "c-rivers"] },
  {
    id: "c-korea",
    mode: "closed",
    name: "한국 문화·역사",
    emoji: "🏯",
    topicIds: ["c-palace", "c-samul", "c-trigram", "c-sagunja", "c-sasin", "c-gates", "c-holiday", "c-national", "c-pansori", "c-obang", "c-banknote", "c-yut"],
  },
  {
    id: "c-school",
    mode: "closed",
    name: "상식·교과",
    emoji: "📚",
    topicIds: [
      "c-weekday",
      "c-solfege",
      "c-senses",
      "c-arith",
      "c-5w1h",
      "c-nutrient",
      "c-taste",
      "c-ssang",
      "c-hanja-num",
      "c-native-num",
      "c-organs",
      "c-finger",
      "c-orchestra",
      "c-siblings",
    ],
  },
  {
    id: "c-east",
    mode: "closed",
    name: "동양 사상·고전",
    emoji: "📜",
    topicIds: ["c-ohaeng", "c-gan", "c-emotions", "c-lifecycle", "c-sasang", "c-tigers", "c-journey"],
  },
  {
    id: "c-play",
    mode: "closed",
    name: "놀이·스포츠·군대",
    emoji: "⚽",
    topicIds: ["c-chess", "c-janggi", "c-suits", "c-soccer", "c-basketball", "c-olympic", "c-rank", "c-forces"],
  },
];

export function categoriesFor(mode: Mode): readonly TopicCategory[] {
  return CATEGORIES.filter((c) => c.mode === mode);
}

/** 고른 카테고리(없으면 전체)에 속한 주제 id들. 다른 모드의 카테고리 id는 무시. */
export function topicIdsFor(mode: Mode, categoryIds: readonly string[], allIds: readonly string[]): string[] {
  const picked = categoriesFor(mode).filter((c) => categoryIds.includes(c.id));
  if (picked.length === 0) return [...allIds];
  const set = new Set(picked.flatMap((c) => c.topicIds));
  return allIds.filter((id) => set.has(id));
}
