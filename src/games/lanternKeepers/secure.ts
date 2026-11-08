import type { SecureGameDef } from "@/lib/secureMatch/core";
import type { BotLevel } from "@/games/shared/bot/botDifficulty";
import { MAX_PLAYERS, applyAction, lanternView, startGame, type EngineAction, type GameOptions, type GameState } from "./engine";
import { botHasWork, chooseBotAction } from "./bot";
import { DIRS, PING_MARKS, type Dir, type PingMark } from "./show";

/**
 * 등불 지기 서버 판정 (src/lib/secureMatch). 서버만 전체 숲을 들고, 각 기기는
 * `lanternView(state, seat)` — 자기 등불 색이 본 것 + 팀 지도 — 만 받는다.
 * 봇도 서버가 돌리고, 봇 역시 자기 좌석의 보기만 보고 판단한다(bot.ts).
 */

/** 라운드 제한 시간 — 0 = 무제한 */
export function roundDurationMs(state: GameState): number {
  if (state.phase !== "plan" || state.options.turnSeconds <= 0) return 0;
  return state.options.turnSeconds * 1000;
}

function isSeat(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < MAX_PLAYERS;
}

function steps(v: unknown): Dir[] | null {
  if (!Array.isArray(v) || v.length > 3) return null;
  return v.every((d) => DIRS.includes(d as Dir)) ? (v as Dir[]) : null;
}

export const lanternSecure: SecureGameDef<GameState, EngineAction> = {
  start: (playerCount, seed, options) => startGame(playerCount, seed, (options ?? {}) as Partial<GameOptions>),
  apply: applyAction,
  clientAction(_state, seat, raw) {
    if (!raw || typeof raw !== "object" || !isSeat(seat)) return null;
    const a = raw as Record<string, unknown>;
    const round = typeof a.round === "number" ? a.round : -1;
    const rev = typeof a.rev === "number" && Number.isFinite(a.rev) ? { rev: a.rev } : {};
    switch (a.type) {
      case "PLAN":
      case "TURN": {
        const s = steps(a.steps);
        return s ? { type: a.type, seat, round, steps: s, flare: a.flare === true, ...rev } : null;
      }
      case "READY":
        return { type: "READY", seat, round, ready: a.ready !== false, ...rev };
      case "SIGNAL": {
        const out: Extract<EngineAction, { type: "SIGNAL" }> = { type: "SIGNAL", seat, round };
        const ping = a.ping as Record<string, unknown> | undefined;
        if (ping && typeof ping === "object") {
          const mark = ping.mark;
          if (typeof ping.cell !== "number" || !(mark === "clear" || PING_MARKS.some((m) => m.id === mark))) return null;
          out.ping = { cell: ping.cell, mark: mark as PingMark | "clear" };
        }
        if (typeof a.word === "number") out.word = a.word;
        return out.ping || out.word !== undefined ? out : null;
      }
      default:
        return null; // TIMEOUT은 서버 시계만 보낸다
    }
  },
  view: lanternView,
  seatCount: (s) => s.seatCount,
  stageKey: (s) => `${s.round}:${s.stage}`,
  stageDurationMs: roundDurationMs,
  timeoutAction: (s) => (s.phase === "ended" ? null : { type: "TIMEOUT", stage: s.stage }),
  pendingBot: (s, bots) => [...bots].sort((a, b) => a - b).find((seat) => seat < s.seatCount && botHasWork(s, seat)) ?? null,
  botAction: (s, seat, level, rng) => chooseBotAction(s, seat, level as BotLevel, rng),
  botDelayMs: [900, 2400],
};
