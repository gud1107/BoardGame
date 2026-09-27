/**
 * Theme packs (rulebook §10) — the second, independent axis next to game
 * modes (modes.ts): any mode × any theme, e.g. 애니메이션 모드 + 영화 테마.
 *
 * A theme only changes where the opening idea comes from: on turn 1 each
 * album is offered THEME_CHOICE_COUNT keywords from the pack. On a text turn
 * one click fills the input (still editable); on the free first drawing of an
 * all-drawing mode they replace the single inspiration word. Icebreaker mode
 * ignores themes — its opening prompt is the answer to a question.
 *
 * Choices are derived from (seed, album), not Math.random, so every device —
 * and the timeout fallback — sees the same three words.
 */

import { seededRng, shuffle } from "@/lib/rng";

export type ThemeCategory = "FREE" | "ANIME" | "PROVERB" | "MOVIE" | "CELEBRITY";

export const THEME_CHOICE_COUNT = 3;

export const THEME_INFO: Record<ThemeCategory, { name: string; icon: string; description: string }> = {
  FREE: { name: "자유 주제", icon: "✨", description: "제약 없이 원하는 모든 제시어 작성" },
  ANIME: { name: "애니메이션", icon: "⚡", description: "명대사, 인기 캐릭터, 명장면" },
  PROVERB: { name: "속담/관용구", icon: "📜", description: "교과서 속담 및 유명 관용구" },
  MOVIE: { name: "영화 명장면", icon: "🎬", description: "국내외 명작 영화 & 명대사" },
  CELEBRITY: { name: "연예인/밈", icon: "⭐", description: "유명 방송인, 아이돌, 인터넷 밈" },
};

export const THEME_CATEGORIES = Object.keys(THEME_INFO) as ThemeCategory[];

export const THEME_BANK: Record<Exclude<ThemeCategory, "FREE">, readonly string[]> = {
  ANIME: [
    "도라에몽의 어디로든 문",
    "피카츄의 백만볼트",
    "원피스 루피의 기어 세컨드",
    "센과 치히로의 가오나시",
    "명탐정 코난의 마취총 시계",
    "슬램덩크 강백호의 왼손은 거들 뿐",
    "귀멸의 칼날 탄지로의 물의 호흡",
    "진격의 거인 초대형 거인",
    "이웃집 토토로의 고양이 버스",
    "하울의 움직이는 성",
  ],
  PROVERB: [
    "소 잃고 외양간 고친다",
    "원숭이도 나무에서 떨어진다",
    "고래 싸움에 새우 등 터진다",
    "호랑이 없는 골에 토끼가 왕 노릇 한다",
    "티끌 모아 태산",
    "밑 빠진 독에 물 붓기",
    "누워서 떡 먹기",
    "낮말은 새가 듣고 밤말은 쥐가 듣는다",
    "우물 안 개구리",
    "닭 쫓던 개 지붕 쳐다본다",
  ],
  MOVIE: [
    "기생충의 짜파구리",
    "타이타닉 뱃머리 명장면",
    "아바타의 나비족 비행",
    "어벤져스 타노스의 핑거스냅",
    "올드보이 장도리 액션",
    "인터스텔라 옥수수밭 추격전",
    "스파이더맨 거꾸로 키스",
    "범죄도시 마동석의 진실의 방",
    "해리포터 9와 4분의 3 승강장",
    "매트릭스 네오의 총알 피하기",
  ],
  CELEBRITY: [
    "유재석의 메뚜기 춤",
    "박진영의 비닐 바지",
    "아이유의 3단 고음",
    "이병헌의 건치 미소",
    "싸이의 강남스타일 말춤",
    "마동석의 팔뚝 자랑",
    "노홍철의 저질 댄스",
    "침착맨의 킹받는 표정",
    "페이커의 쉿 세레머니",
    "BTS 정국의 무대 퍼포먼스",
  ],
};

export function isThemeCategory(value: unknown): value is ThemeCategory {
  return typeof value === "string" && value in THEME_INFO;
}

/** The turn-1 keyword choices for `album` (empty for FREE). Deterministic per (seed, album). */
export function themeChoices(theme: ThemeCategory, seed: number, album: number, count = THEME_CHOICE_COUNT): string[] {
  if (theme === "FREE") return [];
  const rng = seededRng((seed ^ Math.imul(album + 1, 0x9e3779b1) ^ 0x5bd1e995) >>> 0);
  return shuffle([...THEME_BANK[theme]], rng).slice(0, count);
}
