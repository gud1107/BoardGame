import type { GameGenre } from "./types";

/**
 * Display metadata for each `GameGenre` — label/emoji/accent color shown as
 * filter chips and per-card badges on the dashboard. `GENRE_ORDER` is the
 * fixed display order (dashboard filter chips + any future sectioning
 * should iterate this, not `Object.keys`, so the order stays stable
 * regardless of object key insertion order).
 */
export const GENRE_META: Record<
  GameGenre,
  { label: string; emoji: string; description: string; accent: string }
> = {
  strategy: {
    label: "전략",
    emoji: "🧠",
    description: "장기적인 계획과 최적화가 승패를 가르는 게임",
    accent: "#38bdf8",
  },
  bluffing: {
    label: "속임수",
    emoji: "🎭",
    description: "거짓말, 추리, 심리전으로 상대를 흔드는 게임",
    accent: "#f472b6",
  },
  luck: {
    label: "운빨",
    emoji: "🎲",
    description: "주사위와 카드 운이 승부를 뒤집는 게임",
    accent: "#fbbf24",
  },
  party: {
    label: "파티",
    emoji: "🎉",
    description: "다같이 왁자지껄 즐기는 대인원 파티 게임",
    accent: "#a78bfa",
  },
  family: {
    label: "가족",
    emoji: "🎈",
    description: "규칙이 쉬워 누구나 금방 어울려 즐기는 게임",
    accent: "#34d399",
  },
};

export const GENRE_ORDER: GameGenre[] = ["strategy", "bluffing", "luck", "party", "family"];
