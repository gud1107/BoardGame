/**
 * 등불 지기 — 색·문양·신호 표 (엔진·보드·봇·3D가 함께 쓴다).
 *
 * 좌석 번호 = 등불 색 번호. 색만으로 구분하지 않도록 색마다 문양이 하나씩 붙는다
 * (색각 이상 대비 — 규칙서 §9). 화면 어디서든 색이 나오면 문양도 같이 나온다.
 */

export interface LanternColor {
  id: string;
  name: string;
  hex: string;
  /** 빛이 닿은 바닥에 비치는 옅은 색 */
  glow: string;
  glyph: string;
  shape: string;
}

export const LANTERNS: readonly LanternColor[] = [
  { id: "red", name: "빨강", hex: "#f43f5e", glow: "#fda4af", glyph: "▲", shape: "세모" },
  { id: "blue", name: "파랑", hex: "#3b82f6", glow: "#93c5fd", glyph: "●", shape: "동그라미" },
  { id: "green", name: "초록", hex: "#22c55e", glow: "#86efac", glyph: "◆", shape: "마름모" },
  { id: "yellow", name: "노랑", hex: "#facc15", glow: "#fde68a", glyph: "★", shape: "별" },
  { id: "violet", name: "보라", hex: "#a855f7", glow: "#d8b4fe", glyph: "✚", shape: "십자" },
];

export function lantern(color: number): LanternColor {
  return LANTERNS[((color % LANTERNS.length) + LANTERNS.length) % LANTERNS.length];
}

/** "▲빨강" 처럼 문양+이름 */
export function colorTag(color: number): string {
  const l = lantern(color);
  return `${l.glyph}${l.name}`;
}

export type PingMark = "danger" | "monster" | "bridge" | "safe" | "here";

export const PING_MARKS: readonly { id: PingMark; icon: string; label: string; hint: string }[] = [
  { id: "danger", icon: "⚠️", label: "위험", hint: "밟지 마세요 (함정·골짜기)" },
  { id: "monster", icon: "👹", label: "괴물", hint: "괴물이 다니는 길" },
  { id: "bridge", icon: "🌉", label: "다리", hint: "여기 다리가 있어요 — 건널 수 있어요" },
  { id: "safe", icon: "✅", label: "안전", hint: "밟아도 괜찮아요" },
  { id: "here", icon: "📍", label: "여기로", hint: "이쪽으로 와요" },
];

export function pingMark(id: PingMark) {
  return PING_MARKS.find((m) => m.id === id) ?? PING_MARKS[0];
}

/** 짧은 단어 — 자유 채팅 대신 고정 문구만 (알파 플레이어 방지, 규칙서 §6) */
export const WORDS: readonly string[] = ["멈춰!", "따라와", "기다려", "내가 갈게", "돌아가", "괜찮아", "도와줘", "고마워", "조각 찾았어", "제단으로!"];

export const WORD_STOP = 0;
export const WORD_THANKS = 7;

export const DIRS = ["N", "E", "S", "W"] as const;
export type Dir = (typeof DIRS)[number];
export const DIR_ARROW: Record<Dir, string> = { N: "↑", E: "→", S: "↓", W: "←" };
