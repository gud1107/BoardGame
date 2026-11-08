import type { SecureGameDef } from "@/lib/secureMatch/core";
import type { BotLevel } from "@/games/shared/bot/botDifficulty";
import { applyAction, fogView, isGuessShape, MAX_PLAYERS, stageDurationMs, startGame, type EngineAction, type GameOptions, type GameState } from "./engine";
import { botHasWork, chooseBotAction } from "./bot";

/**
 * 안개 저택 서버 판정 (src/lib/secureMatch). 서버만 정답·모든 손패·단서 더미를 들고,
 * 각 기기는 `fogView(state, seat)`만 받는다. 봇·시간 초과도 서버가 처리한다.
 */

function isSeat(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < MAX_PLAYERS;
}
const int = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

export const fogSecure: SecureGameDef<GameState, EngineAction> = {
  start: (playerCount, seed, options) => startGame(playerCount, seed, (options ?? {}) as Partial<GameOptions>),
  apply: applyAction,
  clientAction(_state, seat, raw) {
    if (!raw || typeof raw !== "object" || !isSeat(seat)) return null;
    const a = raw as Record<string, unknown>;
    if (!int(a.stage)) return null;
    const stage = a.stage;
    switch (a.type) {
      case "MOVE":
        return int(a.room) ? { type: "MOVE", seat, stage, room: a.room } : null;
      case "ASK":
        return isSeat(a.target) && int(a.suspect) && int(a.weapon) ? { type: "ASK", seat, stage, target: a.target, suspect: a.suspect, weapon: a.weapon } : null;
      case "SEARCH":
        return { type: "SEARCH", seat, stage };
      case "PASS":
        return { type: "PASS", seat, stage };
      case "ACCUSE":
        return isGuessShape(a.guess) ? { type: "ACCUSE", seat, stage, guess: { suspect: a.guess.suspect, weapon: a.guess.weapon, room: a.guess.room } } : null;
      case "SHOW":
        return int(a.card) ? { type: "SHOW", seat, stage, card: a.card } : null;
      case "FINAL":
        if (a.guess === null) return { type: "FINAL", seat, stage, guess: null };
        return isGuessShape(a.guess) ? { type: "FINAL", seat, stage, guess: { suspect: a.guess.suspect, weapon: a.guess.weapon, room: a.guess.room } } : null;
      default:
        return null; // TIMEOUT은 서버 시계만 보낸다
    }
  },
  view: fogView,
  seatCount: (s) => s.seatCount,
  stageKey: (s) => String(s.stage),
  stageDurationMs,
  timeoutAction: (s) => (s.phase === "ended" ? null : { type: "TIMEOUT", stage: s.stage }),
  pendingBot: (s, bots) => [...bots].sort((a, b) => a - b).find((seat) => seat < s.seatCount && botHasWork(s, seat)) ?? null,
  botAction: (s, seat, level, rng) => chooseBotAction(s, seat, level as BotLevel, rng),
  botDelayMs: [1100, 2600],
};
