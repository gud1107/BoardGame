import type { SecureGameDef } from "@/lib/secureMatch/core";
import {
  MAX_PLAYERS,
  applyAction,
  chooseBotAction,
  pendingSeats,
  startGame,
  type EngineAction,
  type GameOptions,
  type GameState,
  type RoundPlan,
  type Seat,
} from "./engine";
import type { BotLevel } from "@/games/shared/bot/botDifficulty";

export const PHASE_DURATION_MS: Record<GameState["phase"], number> = {
  describe: 45_000, // 바퀴마다 모두 동시에 쓰므로 1인 30초가 아니라 바퀴당 45초
  discuss: 90_000,
  vote: 30_000,
  guess: 30_000,
  roundEnd: 15_000,
  ended: 0,
};

const HIDDEN_PLAN: RoundPlan = { categoryId: "", category: "", word: "", fakeWord: null, liarSeat: -1, firstSeat: 0, options: [] };

/**
 * 한 좌석이 볼 수 있는 상태 — 판(`LiarGameBoard`)이 그대로 그릴 수 있게 모양은 유지하고
 * 비밀만 지운다. 이번 라운드가 공개되기 전에는:
 * - 시민: 라이어 좌석은 -1(정답 맞히기 단계에서 지목된 라이어만 공개), 가짜 제시어·보기 없음
 * - 아는 라이어: 진짜 제시어 대신 "" — 보기는 정답 맞히기 단계에서만
 * - 모르는 라이어: 가짜 제시어를 자기 제시어로 받고 자기가 라이어인 줄 모른다
 * 다음 라운드 계획, 남이 이번 바퀴에 쓴 설명, 투표 중인 남의 표도 가린다.
 */
export function liarView(state: GameState, seat: Seat): GameState {
  const revealed = state.phase === "roundEnd" || state.phase === "ended";
  const guessing = state.phase === "guess";
  const plan = state.plan.map((p, r): RoundPlan => {
    if (r < state.roundIndex || (r === state.roundIndex && revealed)) return p;
    if (r > state.roundIndex) return HIDDEN_PLAN;
    const options = guessing && seat === p.liarSeat ? p.options : [];
    const publicLiar = guessing ? p.liarSeat : -1;
    if (seat !== p.liarSeat) return { ...p, fakeWord: null, liarSeat: publicLiar, options };
    if (state.options.mode === "fool" && !guessing) return { ...p, word: p.fakeWord ?? "", fakeWord: null, liarSeat: -1, options };
    return { ...p, word: "", fakeWord: null, liarSeat: seat, options };
  });
  const lap = Math.floor(state.descriptions.length / state.seatCount) + 1;
  const descriptions =
    state.phase === "describe" ? state.descriptions.map((d) => (d.lap === lap && d.seat !== seat ? { ...d, text: "" } : d)) : state.descriptions;
  const votes: Record<Seat, Seat | null> = {};
  for (const [voter, target] of Object.entries(state.votes)) votes[Number(voter)] = state.phase !== "vote" || Number(voter) === seat ? target : null;
  return { ...state, plan, descriptions, votes, firstVotes: revealed ? state.firstVotes : {} };
}

function isSeat(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < MAX_PLAYERS;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length <= 200 ? v : null;
}

export const liarSecure: SecureGameDef<GameState, EngineAction> = {
  start: (playerCount, seed, options) => startGame(playerCount, seed, (options ?? {}) as Partial<GameOptions>),
  apply: applyAction,
  clientAction(_state, seat, raw) {
    if (!raw || typeof raw !== "object") return null;
    const a = raw as Record<string, unknown>;
    switch (a.type) {
      case "DESCRIBE":
      case "GUESS": {
        const text = str(a.text);
        return text === null ? null : { type: a.type, seat, text };
      }
      case "CHAT": {
        const text = str(a.text);
        if (text === null) return null;
        return { type: "CHAT", seat, text, ...(isSeat(a.mention) ? { mention: a.mention } : {}) };
      }
      case "READY":
        return { type: "READY", seat };
      case "VOTE":
        return isSeat(a.target) ? { type: "VOTE", seat, target: a.target } : null;
      case "NEXT":
        return typeof a.stage === "number" ? { type: "NEXT", stage: a.stage } : null;
      default:
        return null; // TIMEOUT은 서버 시계만 보낸다
    }
  },
  view: liarView,
  seatCount: (s) => s.seatCount,
  stageKey: (s) => `${s.roundIndex}:${s.stage}`,
  stageDurationMs: (s) => PHASE_DURATION_MS[s.phase],
  timeoutAction: (s) => (s.phase === "ended" ? null : { type: "TIMEOUT", stage: s.stage }),
  pendingBot: (s, bots) => pendingSeats(s).find((seat) => bots.has(seat)) ?? null,
  botAction: (s, seat, level, rng) => chooseBotAction(s, seat, level as BotLevel, rng),
  botDelayMs: [1200, 3200],
};
