/**
 * Word pools for 그림 전화기. Kept apart from engine.ts so the lists can grow
 * without touching rule code.
 */

/** Injected by the engine when a text turn times out empty (rulebook §5). */
export const FALLBACK_PROMPTS: readonly string[] = [
  "춤추는 우주비행사",
  "선글라스를 낀 문어",
  "피자를 굽는 용",
  "외계인과의 바비큐 파티",
  "스케이트보드 타는 판다",
  "길 잃은 오리",
  "우산을 쓴 고양이",
  "하늘을 나는 자동차",
  "화난 브로콜리",
  "잠자는 로봇",
  "눈사람의 여름휴가",
  "왕관을 쓴 강아지",
  "바나나를 든 원숭이",
  "노래하는 물고기",
  "달에서 라면 먹기",
  "커피 마시는 공룡",
];

/**
 * Opening prompts the AI bots write on turn 1. Most of them contain a word
 * the bot artist (bot.ts) knows how to draw, so an all-bot chain still has a
 * fighting chance of surviving a few hops.
 */
export const BOT_OPENING_PROMPTS: readonly string[] = [
  "모자를 쓴 고양이",
  "바다 위의 해",
  "꽃을 든 사람",
  "비 오는 날의 집",
  "하트를 가진 로봇",
  "별을 보는 강아지",
  "산 위의 나무",
  "달밤의 물고기",
  "생일 케이크와 친구",
  "빨간 자동차",
  "눈사람과 구름",
  "피자를 먹는 사람",
  "문어의 우산",
  "사과 나무",
];
