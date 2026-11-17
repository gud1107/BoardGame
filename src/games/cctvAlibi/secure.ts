import type { SecureGameDef } from "@/lib/secureMatch/core";
import type { BotLevel } from "@/games/shared/bot/botDifficulty";
import { MAX_WINDOW, TICKS } from "./data";
import { applyAction, cctvView, MAX_PLAYERS, stageDurationMs, startGame, type EngineAction, type GameOptions, type GameState } from "./engine";
import { botHasWork, chooseBotAction } from "./bot";
import type { Plan } from "./planner";

/**
 * CCTV 알리바이 서버 판정 (src/lib/secureMatch). 서버만 범인·모든 실제 동선·조작 구간·표를 들고,
 * 각 기기는 `cctvView(state, seat)`만 받는다. 봇·시간 초과도 서버가 처리한다.
 */

function isSeat(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < MAX_PLAYERS;
}
const int = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const rooms = (v: unknown, max: number): v is number[] => Array.isArray(v) && v.length >= 1 && v.length <= max && v.every(int);

/** 모양만 본다 — 규칙에 맞는지는 엔진(planError)이 판단한다 */
function parsePlan(raw: unknown): Plan | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (!rooms(p.route, TICKS) || p.route.length !== TICKS) return null;
  if (p.forge === null || p.forge === undefined) return { route: [...p.route], forge: null };
  if (typeof p.forge !== "object") return null;
  const f = p.forge as Record<string, unknown>;
  if (!int(f.from) || !rooms(f.rooms, MAX_WINDOW)) return null;
  return { route: [...p.route], forge: { from: f.from, rooms: [...f.rooms] } };
}

export const cctvSecure: SecureGameDef<GameState, EngineAction> = {
  start: (playerCount, seed, options) => startGame(playerCount, seed, (options ?? {}) as Partial<GameOptions>),
  apply: applyAction,
  clientAction(_state, seat, raw) {
    if (!raw || typeof raw !== "object" || !isSeat(seat)) return null;
    const a = raw as Record<string, unknown>;
    if (!int(a.stage)) return null;
    const stage = a.stage;
    switch (a.type) {
      case "PLAN": {
        const plan = parsePlan(a.plan);
        return plan ? { type: "PLAN", seat, stage, plan } : null;
      }
      case "READY":
        return { type: "READY", seat, stage };
      case "CHECK":
        return int(a.t) && int(a.room) ? { type: "CHECK", seat, stage, t: a.t, room: a.room } : null;
      case "TESTIFY":
        return isSeat(a.target) && int(a.t) ? { type: "TESTIFY", seat, stage, target: a.target, t: a.t } : null;
      case "PASS":
        return { type: "PASS", seat, stage };
      case "VOTE":
        if (a.target === null) return { type: "VOTE", seat, stage, target: null };
        return isSeat(a.target) ? { type: "VOTE", seat, stage, target: a.target } : null;
      default:
        return null; // TIMEOUT은 서버 시계만 보낸다
    }
  },
  view: cctvView,
  seatCount: (s) => s.seatCount,
  stageKey: (s) => String(s.stage),
  stageDurationMs,
  timeoutAction: (s) => (s.phase === "ended" ? null : { type: "TIMEOUT", stage: s.stage }),
  pendingBot: (s, bots) => [...bots].sort((a, b) => a - b).find((seat) => seat < s.seatCount && botHasWork(s, seat)) ?? null,
  botAction: (s, seat, level, rng) => chooseBotAction(s, seat, level as BotLevel, rng),
  botDelayMs: [1200, 2800],
};
