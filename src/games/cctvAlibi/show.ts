import { ROOMS, SEAT_GLYPHS, roomLabel, timeLabel } from "./data";
import type { GameState, LogEntry } from "./engine";

/** 화면 문구 도우미 — 보드·결과 창·기록이 함께 쓴다. */

export function seatName(seat: number, me: number, names: Record<number, string>): string {
  return seat === me ? "나" : (names[seat] ?? `${seat + 1}번`);
}

export function seatTag(seat: number, me: number, names: Record<number, string>): string {
  return `${SEAT_GLYPHS[seat % SEAT_GLYPHS.length]} ${seatName(seat, me, names)}`;
}

/** 증언 문장 */
export function claimText(e: Extract<LogEntry, { kind: "testify" }>, me: number, names: Record<number, string>): string {
  const who = seatTag(e.target, me, names);
  const where = `${timeLabel(e.t)} ${roomLabel(e.room)}`;
  return e.claim === "absent" ? `${where}에 ${who}은(는) 없었어요. 영상이 가짜예요!` : `${where}에서 ${who}을(를) 봤어요. 영상엔 딴 곳에 찍혀 있어요!`;
}

export interface LogLine {
  icon: string;
  text: string;
  tone: "plain" | "good" | "bad" | "info";
}

export function logLine(e: LogEntry, me: number, names: Record<number, string>): LogLine {
  switch (e.kind) {
    case "night":
      return { icon: "🌙", text: `사건 ${e.caseIndex + 1} — 밤이 지나고 CCTV 영상이 공개됐어요`, tone: "info" };
    case "check": {
      const diff = e.truth !== e.footage;
      return {
        icon: diff ? "🚨" : "🔎",
        text: `${seatTag(e.seat, me, names)} 센서 대조: ${timeLabel(e.t)} ${roomLabel(e.room)} — 영상 ${e.footage}명 · 센서 ${e.truth}명 ${diff ? "→ 불일치!" : "→ 일치"}`,
        tone: diff ? "bad" : "plain",
      };
    }
    case "testify":
      return { icon: "🗣️", text: `${seatTag(e.seat, me, names)}의 증언: “${claimText(e, me, names)}”`, tone: "info" };
    case "pass":
      return { icon: "💤", text: `${seatTag(e.seat, me, names)} ${e.timeout ? "시간 초과로 넘김" : "넘김"}`, tone: "plain" };
    case "verdict":
      return {
        icon: e.caught ? "🚔" : "💨",
        text: `사건 ${e.caseIndex + 1} 판결 — 범인은 ${seatTag(e.culprit, me, names)}. ${e.caught ? "검거!" : "달아났어요…"}`,
        tone: e.caught ? "good" : "bad",
      };
  }
}

export function phaseLabel(view: GameState): string {
  switch (view.phase) {
    case "night":
      return "🌙 밤 — 동선 짜기";
    case "watch":
      return "📼 영상 판독";
    case "investigate":
      return `🔎 수사 ${view.round}/${view.rounds}`;
    case "vote":
      return "🗳️ 투표";
    case "result":
      return "⚖️ 판결";
    default:
      return "🏁 종료";
  }
}

/** "📚→🖼️→💎" */
export function routeIcons(rooms: number[]): string {
  return rooms.map((r) => ROOMS[r]?.icon ?? "?").join("→");
}
