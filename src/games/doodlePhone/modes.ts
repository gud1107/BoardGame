/**
 * The 9 game modes (rulebook §9) and the host's room options — every
 * per-mode rule lives here so the engine, the bots and the UI all read the
 * same table instead of each growing its own `switch (mode)`.
 *
 * Where the brief's summary table and its sample code disagreed (넉오프 80s
 * vs 75s, 비밀 40/70s vs 35/70s, 애니메이션 70s vs 65s), the table wins —
 * same "rulebook over sample" rule as the rest of this repo. Speedrun uses
 * the sample code's concrete formula, since the table only gave a range.
 */

import { seededRng } from "@/lib/rng";
import { isThemeCategory, themeChoices, type ThemeCategory } from "./themes";

export type GameMode = "NORMAL" | "KNOCK_OFF" | "SECRET" | "ANIMATION" | "ICEBREAKER" | "COMPLEMENT" | "SCORE" | "SPEEDRUN" | "SANDWICH";
export type PageKind = "text" | "drawing";

/**
 * What a drawing turn shows about the previous page:
 * - `prompt`  previous page is text → draw that sentence
 * - `copy`    previous drawing stays visible → reproduce it
 * - `memory`  previous drawing visible for KNOCK_OFF_PEEK_MS, then hidden
 * - `onion`   previous frame as a faint ghost under your canvas (animation)
 * - `base`    previous drawing IS your canvas; you add to it
 * - `free`    turn 1 of an all-drawing mode — nothing before you
 */
export type DrawingReference = "prompt" | "copy" | "memory" | "onion" | "base" | "free";

export interface GameOptions {
  mode: GameMode;
  /** 0.7× … 1.5×, applied to every turn's base time. */
  timeMultiplier: number;
  /** Animation mode: show the previous frame as an onion skin. */
  ghostFrames: boolean;
  /** Undo/redo buttons and Ctrl+Z/Y in the drawing editor. */
  allowUndo: boolean;
  /** Theme pack for turn-1 keyword choices (themes.ts) — independent of `mode`. */
  theme: ThemeCategory;
}

export const TIME_MULTIPLIER_MIN = 0.7;
export const TIME_MULTIPLIER_MAX = 1.5;
export const TIME_MULTIPLIER_STEP = 0.1;
export const KNOCK_OFF_PEEK_MS = 10_000;
export const ONION_OPACITY = 0.35;
/** Score mode: how long the best-page vote stays open once an album is fully revealed. */
export const VOTE_WINDOW_MS = 20_000;
const MIN_TURN_SECONDS = 8;

export const DEFAULT_OPTIONS: GameOptions = { mode: "NORMAL", timeMultiplier: 1, ghostFrames: true, allowUndo: true, theme: "FREE" };

type Flow = "alternate" | "allDrawing" | "sandwich";

export interface ModeInfo {
  title: string;
  icon: string;
  badge: string;
  description: string;
  flow: Flow;
  /** Base seconds for a turn before the multiplier. */
  seconds: (kind: PageKind, turn: number) => number;
  /** Human-readable version of `seconds`, for the lobby and rulebook. */
  timeLabel: string;
  /** How a drawing turn uses a previous *drawing* (a previous text is always `prompt`). */
  drawingFromDrawing: DrawingReference;
  /** The author can't see their own strokes/letters while working. */
  blind: boolean;
}

export const MODES: Record<GameMode, ModeInfo> = {
  NORMAL: {
    title: "일반",
    icon: "📝",
    badge: "클래식",
    description: "문장 → 그림 → 문장 → 그림이 번갈아 도는 정통 룰",
    flow: "alternate",
    seconds: (kind, turn) => (turn === 1 ? 60 : kind === "text" ? 50 : 90),
    timeLabel: "첫 문장 60초 · 글 50초 · 그림 90초",
    drawingFromDrawing: "copy",
    blind: false,
  },
  KNOCK_OFF: {
    title: "넉오프",
    icon: "👥",
    badge: "드로잉",
    description: "글 없이 앞사람 그림을 기억해서 따라 그리는 릴레이 — 원본은 10초 뒤 가려져요",
    flow: "allDrawing",
    seconds: () => 80,
    timeLabel: "그림 80초",
    drawingFromDrawing: "memory",
    blind: false,
  },
  SECRET: {
    title: "비밀",
    icon: "🙈",
    badge: "하드코어",
    description: "내가 쓰는 글자와 그리는 선이 내 화면엔 보이지 않는 블라인드 모드",
    flow: "alternate",
    seconds: (kind) => (kind === "text" ? 40 : 70),
    timeLabel: "글 40초 · 그림 70초",
    drawingFromDrawing: "copy",
    blind: true,
  },
  ANIMATION: {
    title: "애니메이션",
    icon: "🎞️",
    badge: "창작",
    description: "앞 프레임 잔상(어니언 스킨)을 보며 다음 장면을 이어 그려 움직이는 그림 완성",
    flow: "allDrawing",
    seconds: () => 70,
    timeLabel: "프레임당 70초",
    drawingFromDrawing: "onion",
    blind: false,
  },
  ICEBREAKER: {
    title: "아이스브레이커",
    icon: "🧊",
    badge: "파티용",
    description: "첫 턴에 랜덤 질문이 주어지고, 그 답이 제시어가 되는 모드",
    flow: "alternate",
    seconds: (kind) => (kind === "text" ? 40 : 80),
    timeLabel: "글 40초 · 그림 80초",
    drawingFromDrawing: "copy",
    blind: false,
  },
  COMPLEMENT: {
    title: "보완 (덧그리기)",
    icon: "🖍️",
    badge: "협동",
    description: "새 도화지 대신 앞사람 그림 위에 계속 덧그려 하나의 그림을 완성",
    flow: "allDrawing",
    seconds: () => 70,
    timeLabel: "덧그리기 70초",
    drawingFromDrawing: "base",
    blind: false,
  },
  SCORE: {
    title: "점수",
    icon: "🏆",
    badge: "경쟁",
    description: "결과 발표에서 앨범마다 최고의 장면에 투표 — 득표 수로 순위 경쟁",
    flow: "alternate",
    seconds: (kind, turn) => (turn === 1 ? 60 : kind === "text" ? 50 : 90),
    timeLabel: "일반과 같음 + 앨범별 투표 20초",
    drawingFromDrawing: "copy",
    blind: false,
  },
  SPEEDRUN: {
    title: "스피드런",
    icon: "⚡",
    badge: "스릴",
    description: "제한 시간이 극단적으로 짧고, 턴이 지날수록 더 빨라지는 모드",
    flow: "alternate",
    seconds: (kind, turn) => (kind === "text" ? Math.max(10, 20 - turn * 2) : Math.max(20, 35 - turn * 2)),
    timeLabel: "글 20초→10초 · 그림 33초→20초 (턴마다 2초씩 단축)",
    drawingFromDrawing: "copy",
    blind: false,
  },
  SANDWICH: {
    title: "샌드위치",
    icon: "🥪",
    badge: "변형",
    description: "처음 문장과 마지막 추측만 글, 그 사이는 전부 앞 그림을 보고 따라 그리기",
    flow: "sandwich",
    seconds: (kind) => (kind === "text" ? 40 : 75),
    timeLabel: "첫·끝 글 40초 · 중간 그림 75초",
    drawingFromDrawing: "copy",
    blind: false,
  },
};

export const GAME_MODES = Object.keys(MODES) as GameMode[];

export function isGameMode(value: unknown): value is GameMode {
  return typeof value === "string" && value in MODES;
}

/** Options arrive over the network from the host — clamp them into a legal shape. */
export function sanitizeOptions(raw: unknown): GameOptions {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<Record<keyof GameOptions, unknown>>;
  const multiplier = typeof o.timeMultiplier === "number" && Number.isFinite(o.timeMultiplier) ? o.timeMultiplier : DEFAULT_OPTIONS.timeMultiplier;
  return {
    mode: isGameMode(o.mode) ? o.mode : DEFAULT_OPTIONS.mode,
    timeMultiplier: Math.round(Math.min(TIME_MULTIPLIER_MAX, Math.max(TIME_MULTIPLIER_MIN, multiplier)) * 10) / 10,
    ghostFrames: typeof o.ghostFrames === "boolean" ? o.ghostFrames : DEFAULT_OPTIONS.ghostFrames,
    allowUndo: typeof o.allowUndo === "boolean" ? o.allowUndo : DEFAULT_OPTIONS.allowUndo,
    theme: isThemeCategory(o.theme) ? o.theme : DEFAULT_OPTIONS.theme,
  };
}

/** Whether the theme pack shapes openings in this mode — icebreaker's opening is the answer to its question instead. */
export function themeApplies(options: GameOptions): boolean {
  return options.theme !== "FREE" && options.mode !== "ICEBREAKER";
}

/** Turn-1 keyword choices for `album` under the room's theme (empty when no theme applies). */
export function openingChoices(options: GameOptions, seed: number, album: number): string[] {
  return themeApplies(options) ? themeChoices(options.theme, seed, album) : [];
}

export function turnKindFor(mode: GameMode, turn: number, playerCount: number): PageKind {
  switch (MODES[mode].flow) {
    case "allDrawing":
      return "drawing";
    case "sandwich":
      return turn === 1 || turn === playerCount ? "text" : "drawing";
    case "alternate":
      return turn % 2 === 1 ? "text" : "drawing";
  }
}

export function turnSecondsFor(options: GameOptions, turn: number, playerCount: number): number {
  const base = MODES[options.mode].seconds(turnKindFor(options.mode, turn, playerCount), turn);
  return Math.max(MIN_TURN_SECONDS, Math.round(base * options.timeMultiplier));
}

/** How a drawing turn presents what came before (see `DrawingReference`). */
export function drawingReferenceFor(mode: GameMode, previousKind: PageKind | null): DrawingReference {
  if (previousKind === null) return "free";
  return previousKind === "text" ? "prompt" : MODES[mode].drawingFromDrawing;
}

// ---------------------------------------------------------------------------
// Icebreaker questions + free-draw inspiration (deterministic per album)
// ---------------------------------------------------------------------------

export const ICEBREAKER_QUESTIONS: readonly string[] = [
  "가장 좋아하는 야식은 무엇인가요?",
  "로또 1등에 당첨된다면 가장 먼저 살 것은?",
  "내 인생 최고의 (혹은 최악의) 여행지는?",
  "초능력을 하나 가질 수 있다면?",
  "나를 동물로 표현한다면 어떤 동물일까?",
  "무인도에 딱 하나만 가져갈 수 있다면?",
  "어릴 때 꿈은 무엇이었나요?",
  "요즘 가장 자주 먹는 음식은?",
  "하루 동안 투명인간이 된다면 할 일은?",
  "가장 무서워하는 것은?",
];

/** Words offered (optionally) as a starting idea on turn 1 of the all-drawing modes. */
export const INSPIRATION_WORDS: readonly string[] = [
  "고양이", "우주선", "피자", "공룡", "눈사람", "해적선", "로봇", "꽃다발",
  "수박", "문어", "자동차", "성", "무지개", "케이크", "펭귄", "화산",
];

function pick<T>(list: readonly T[], seed: number, album: number, salt: number): T {
  const rng = seededRng((seed ^ Math.imul(album + 1, 0x9e3779b1) ^ Math.imul(salt, 0x27d4eb2d)) >>> 0);
  return list[Math.floor(rng() * list.length)];
}

export function icebreakerQuestion(seed: number, album: number): string {
  return pick(ICEBREAKER_QUESTIONS, seed, album, 17);
}

export function inspirationWord(seed: number, album: number): string {
  return pick(INSPIRATION_WORDS, seed, album, 29);
}
