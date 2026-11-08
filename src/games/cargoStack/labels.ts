import { KIND_EMOJI, type Placed, type TurnEvent } from "./engine";

/** Seat colours + shape marks (rulebook §10 — readable without colour). */
export const SEAT_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ec4899"];
export const SEAT_DARK = ["#991b1b", "#1e3a8a", "#166534", "#92400e", "#6b21a8", "#9d174d"];
export const SEAT_MARKS = ["●", "◆", "▲", "■", "★", "✚"];
export const SEAT_NAMES = ["빨강", "파랑", "초록", "주황", "보라", "분홍"];

export const seatColor = (s: number) => SEAT_COLORS[((s % 6) + 6) % 6];
export const seatDark = (s: number) => SEAT_DARK[((s % 6) + 6) % 6];
export const seatMark = (s: number) => SEAT_MARKS[((s % 6) + 6) % 6];

export function crateLabel(c: Pick<Placed, "kind" | "w" | "len">): string {
  return `${KIND_EMOJI[c.kind]} ${c.len}칸 ${c.w}t`;
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** One-line description of a turn for the banner / log. */
export function eventText(ev: TurnEvent, name: (s: number) => string): string {
  const who = name(ev.seat);
  const parts: string[] = [];
  if (ev.act === "place" && ev.placed) parts.push(`${who}: ${crateLabel(ev.placed)} → ${ev.placed.x + 1}번 칸 ${ev.placed.y + 1}층 (+${ev.placed.pts})`);
  else if (ev.act === "ballast") parts.push(`${who}: ⚓ 밸러스트 ${ev.dir === -1 ? "◀ 왼쪽" : "오른쪽 ▶"}`);
  else parts.push(`${who}: ⏭️ 넘기기${ev.fine > 0 ? ` (−${ev.fine})` : ""}`);
  if (ev.auto) parts.push("⏰ 시간 초과 자동");
  if (ev.crushed.length) parts.push(`🥚 유리 ${ev.crushed.length}개 깨짐`);
  if (ev.spilled.length) parts.push(`🌊 ${ev.spilled.length}개 바다로`);
  if (ev.capsized) parts.push("🚨 전복!");
  if (ev.act !== "pass" && (ev.spilled.length || ev.crushed.length || ev.capsized)) parts.push(`(${who} ${signed(ev.delta)})`);
  return parts.join(" · ");
}
