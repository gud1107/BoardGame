/**
 * Self-play benchmark: Level 10 (expert tier — PIMC / ISMCTS-lite+regret-
 * matching / iterative-deepening alpha-beta, see each engine's "Level 8-10
 * expert bot" section) vs Level 1-3 ("novice" tier — mostly-random legal
 * moves, see botDifficulty.ts), 1,000 headless 2-player games per game,
 * asserting Level 10 wins at least 85% of them.
 *
 * Every game here runs 2-player specifically (rather than trying to define
 * "win rate" against a variable-size table for perudo/five-cucumbers, both
 * of which support more): a literal "Level 10 vs Level 1-3" 1v1 is the
 * cleanest, least ambiguous read of the task brief, and gives a meaningful
 * 50%-baseline framing for the 85% target. The opponent's level round-robins
 * 1/2/3 across games (not randomly sampled) so all three novice levels get
 * even, reproducible coverage instead of depending on which the RNG happens
 * to favor. Which seat plays the strong bot alternates every game too, to
 * cancel out any first-mover advantage in the win-rate number.
 *
 * Trial/search budgets below are intentionally much smaller than each
 * engine's real default (100-200 PIMC/ISMCTS trials, up to a 500ms alpha-
 * beta budget) — this suite runs 3,000 full games total, and the production
 * defaults would take real minutes per game at that volume. Every engine's
 * `chooseBotAction` accepts an `opts` override for exactly this reason (see
 * each engine.ts); a smaller budget is still a real search/simulation, just
 * a shallower one, so it stays a fair (if weaker) proxy for "how the shipped
 * default behaves", not a different algorithm.
 */

import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";

import {
  applyAction as fcApplyAction,
  chooseBotAction as fcChooseBotAction,
  computeRankings as fcComputeRankings,
  startGame as fcStartGame,
  type SeatIndex as FcSeat,
} from "@/games/five-cucumbers/engine";

import {
  applyAction as perudoApplyAction,
  chooseBotAction as perudoChooseBotAction,
  startGame as perudoStartGame,
  type SeatIndex as PerudoSeat,
} from "@/games/perudo/engine";

import {
  applyAction as mddjApplyAction,
  chooseBotAction as mddjChooseBotAction,
  startGame as mddjStartGame,
  type Seat as MddjSeat,
} from "@/games/malDalliJa/engine";

const GAMES_PER_MATCHUP = 1000;
const WIN_RATE_THRESHOLD = 0.85;
const NOVICE_LEVELS = [1, 2, 3] as const;

function noviceLevelFor(gameIndex: number): 1 | 2 | 3 {
  return NOVICE_LEVELS[gameIndex % NOVICE_LEVELS.length];
}

// ---------------------------------------------------------------------------
// Five Cucumbers — win = finishing rank 1 (never eliminated) once gameOver.
// PIMC trial count reduced from the shipped default (150) for benchmark speed.
// ---------------------------------------------------------------------------

const FC_BENCHMARK_PIMC_TRIALS = 25;
const FC_MOVE_GUARD = 500;

function playFiveCucumbersGame(seed: number, strongSeat: FcSeat, noviceLevel: 1 | 2 | 3): boolean {
  const rng = seededRng(seed);
  let state = fcStartGame(2, seed);
  let guard = 0;
  while (state.phase !== "gameOver" && guard < FC_MOVE_GUARD) {
    guard++;
    const seat = state.activeSeat;
    const isStrong = seat === strongSeat;
    const action = fcChooseBotAction(
      state,
      seat,
      isStrong ? 10 : noviceLevel,
      rng,
      isStrong ? { pimcTrials: FC_BENCHMARK_PIMC_TRIALS } : undefined,
    );
    if (!action) break;
    state = fcApplyAction(state, action);
  }
  if (state.phase !== "gameOver") return false;
  const ranking = fcComputeRankings(state).find((r) => r.seat === strongSeat);
  return ranking?.rank === 1;
}

// ---------------------------------------------------------------------------
// Perudo — win = `winnerSeat` once gameOver. ISMCTS trial count reduced from
// the shipped default (120) for benchmark speed.
// ---------------------------------------------------------------------------

const PERUDO_BENCHMARK_ISMCTS_TRIALS = 25;
const PERUDO_MOVE_GUARD = 500;

function playPerudoGame(seed: number, strongSeat: PerudoSeat, noviceLevel: 1 | 2 | 3): boolean {
  const rng = seededRng(seed);
  let state = perudoStartGame(2, seed);
  let guard = 0;
  while (state.phase !== "gameOver" && guard < PERUDO_MOVE_GUARD) {
    guard++;
    if (state.phase === "reveal") {
      state = perudoApplyAction(state, { type: "continue", seed: Math.floor(rng() * 1_000_000_000) });
      continue;
    }
    const seat = state.activeSeat;
    const isStrong = seat === strongSeat;
    const action = perudoChooseBotAction(
      state,
      seat,
      isStrong ? 10 : noviceLevel,
      rng,
      isStrong ? { ismctsTrials: PERUDO_BENCHMARK_ISMCTS_TRIALS } : undefined,
    );
    if (!action) break;
    state = perudoApplyAction(state, action);
  }
  return state.phase === "gameOver" && state.winnerSeat === strongSeat;
}

// ---------------------------------------------------------------------------
// MalDalliJa — win = `winner` once gameOver. Alpha-beta budget reduced from
// the shipped default (maxDepth 10 / 500ms) for benchmark speed — still a
// real iterative-deepening search, just a shallower one.
// ---------------------------------------------------------------------------

const MDDJ_BENCHMARK_BUDGET = { maxDepth: 3, timeBudgetMs: 10 };
const MDDJ_MOVE_GUARD = 3000;

function playMalDalliJaGame(seed: number, strongSeat: MddjSeat, noviceLevel: 1 | 2 | 3): boolean {
  const rng = seededRng(seed);
  let state = mddjStartGame(rng);
  let guard = 0;
  while (state.phase !== "gameOver" && guard < MDDJ_MOVE_GUARD) {
    guard++;
    const seat = state.activeSeat;
    const isStrong = seat === strongSeat;
    const action = mddjChooseBotAction(
      state,
      seat,
      isStrong ? 10 : noviceLevel,
      rng,
      isStrong ? { alphaBetaBudget: MDDJ_BENCHMARK_BUDGET } : undefined,
    );
    if (!action) break;
    state = mddjApplyAction(state, action);
  }
  return state.phase === "gameOver" && state.winner === strongSeat;
}

// ---------------------------------------------------------------------------

describe("AI self-play benchmark — Level 10 vs Level 1-3", () => {
  it(
    `five-cucumbers: Level 10 wins >= ${WIN_RATE_THRESHOLD * 100}% of ${GAMES_PER_MATCHUP} games vs Level 1-3`,
    () => {
      let wins = 0;
      for (let i = 0; i < GAMES_PER_MATCHUP; i++) {
        const strongSeat: FcSeat = i % 2 === 0 ? 0 : 1;
        if (playFiveCucumbersGame(1_000_000 + i, strongSeat, noviceLevelFor(i))) wins++;
      }
      const winRate = wins / GAMES_PER_MATCHUP;
      expect(winRate).toBeGreaterThanOrEqual(WIN_RATE_THRESHOLD);
    },
    120_000,
  );

  it(
    `perudo: Level 10 wins >= ${WIN_RATE_THRESHOLD * 100}% of ${GAMES_PER_MATCHUP} games vs Level 1-3`,
    () => {
      let wins = 0;
      for (let i = 0; i < GAMES_PER_MATCHUP; i++) {
        const strongSeat: PerudoSeat = i % 2 === 0 ? 0 : 1;
        if (playPerudoGame(2_000_000 + i, strongSeat, noviceLevelFor(i))) wins++;
      }
      const winRate = wins / GAMES_PER_MATCHUP;
      expect(winRate).toBeGreaterThanOrEqual(WIN_RATE_THRESHOLD);
    },
    120_000,
  );

  it(
    `malDalliJa: Level 10 wins >= ${WIN_RATE_THRESHOLD * 100}% of ${GAMES_PER_MATCHUP} games vs Level 1-3`,
    () => {
      let wins = 0;
      for (let i = 0; i < GAMES_PER_MATCHUP; i++) {
        const strongSeat: MddjSeat = i % 2 === 0 ? "p1" : "p2";
        if (playMalDalliJaGame(3_000_000 + i, strongSeat, noviceLevelFor(i))) wins++;
      }
      const winRate = wins / GAMES_PER_MATCHUP;
      expect(winRate).toBeGreaterThanOrEqual(WIN_RATE_THRESHOLD);
    },
    450_000,
  );
});
