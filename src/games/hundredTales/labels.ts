import { GHOST_EMOJI, GHOST_LABEL, type TaleEvent } from "./engine";

/** Seat colours + shape marks (rulebook §11 — readable without colour). */
export const SEAT_COLORS = ["#f87171", "#60a5fa", "#a3e635", "#fbbf24", "#c084fc", "#f472b6"];
export const SEAT_MARKS = ["●", "◆", "▲", "■", "★", "✚"];
export const seatColor = (s: number) => SEAT_COLORS[((s % 6) + 6) % 6];
export const seatMark = (s: number) => SEAT_MARKS[((s % 6) + 6) % 6];

/** One line for the log / banner. */
export function eventText(ev: TaleEvent, name: (s: number) => string): string {
  const who = name(ev.seat);
  if (ev.act === "stop") return `${who}: 🛑 여기까지 — +${ev.gained}점${ev.auto ? " (⏰ 시간 초과)" : ""}`;
  const c = `${GHOST_EMOJI[ev.card.kind]} ${GHOST_LABEL[ev.card.kind]}${ev.card.fear > 0 ? ` ${ev.card.fear}` : ""}`;
  if (ev.act === "bust") return `${who}: ${c} — 같은 귀신이 또! 😱 씌었다 (−${ev.lost} 날아감)`;
  if (ev.act === "curse") return `${who}: ${c} — 💀 마지막 촛불을 꺼 백 번째 이야기의 저주!`;
  if (ev.act === "perfect") return `${who}: ${c} — 👻 다섯 귀신 완성! +${ev.gained}점`;
  if (ev.card.kind === "salt") return `${who}: ${c} — 부적을 챙겼다`;
  if (ev.card.kind === "candle") return `${who}: ${c} — 촛불 5개가 다시 켜졌다`;
  if (ev.card.kind === "mirror") return `${who}: ${c} — 다음 이야기가 비친다`;
  if (ev.salted) return `${who}: ${c} — 🧂 부적이 대신 타버렸다`;
  return `${who}: ${c}`;
}
