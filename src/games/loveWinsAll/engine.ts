/**
 * Pure "러브 윈즈 올" (Love Wins All, 넷플릭스 예능 <데스게임> 등장) rules engine —
 * no React, no I/O. Source of truth: `boardGameRule/러브윈즈올/러브윈즈올.md`
 * ("단판 승부 모드" 정식 규칙서), a strictly 1:1 (2-player) hidden-choice
 * prisoner's-dilemma duel: both seats secretly pick **LOVE** or **WAR**,
 * reveal simultaneously, and the combination decides the match.
 *
 * **2026-08-30 session — original implementation.** The rulebook's own
 * "단판 승부" framing directly conflicts with the request prompt's "하트
 * 0까지 여러 라운드 반복" premise, and leaves the LOVE+LOVE tie's two stated
 * outcomes ("공동 승리" vs "공동 무승부 후 재경기") unresolved — every gap
 * below was confirmed with the user via `AskUserQuestion` (Strict
 * No-Assumption Rule in the request) rather than assumed:
 *
 * 1. **Player count**: the rulebook is explicit ("두 플레이어가 협력하여...",
 *    §1 "두 플레이어는 각각...") — confirmed 2-player only, NOT the request
 *    prompt's multi-player "라운드별 파트너 매칭/타겟 지목" premise. Matches
 *    this project's other `netflix-death-game` 2-player titles
 *    (`showMeTheCoin`, `malDalliJa`, `piecesOfLanguage`).
 * 2. **Match structure**: confirmed the rulebook's own "단판 승부" (one
 *    LOVE/WAR choice decides the outcome), NOT the request prompt's
 *    hearts-deplete-to-0/multi-round-survival premise — this engine has no
 *    heart/life gauge at all.
 * 3. **LOVE+LOVE tie**: rulebook offers "공동 승리 (또는 공동 무승부 후
 *    재경기)" as two alternatives — confirmed the *재경기* (rematch) branch:
 *    a tie is not a final outcome, the pot carries into an immediate replay
 *    of the same match (see `applyContinue`).
 * 4. **Bot takeover strategy**: confirmed "휴리스틱형 (Tit-for-Tat 등, 요청서
 *    원문 그대로)" — see `warTemptation`'s doc for how literal TFT was
 *    adapted to a structure where a replay round is only ever reached via a
 *    mutual-LOVE tie (so "mirror the opponent's last move" is, by
 *    construction, always LOVE — the interesting bot behavior is instead
 *    *when* it chooses to defect from that trust).
 *
 * A few smaller mechanical gaps the rulebook is simply silent on were
 * resolved here as documented engineering judgment calls (ARCHITECTURE.md
 * §5), not re-asked:
 *  - **The "판돈"(pot) itself**: the rulebook only ever describes a shared
 *    "공용 목표 자원(하트/승점 칩)" on the table, never a number. Since a
 *    replay is only reachable via a tie (LOVE+LOVE, "아름다운 신뢰"), the pot
 *    is modeled as a purely cosmetic tension counter — `ANTE_PER_ROUND` (10)
 *    is staked automatically at the start of round 1 and again on every
 *    replay (§3's "판돈이월" — carried, then topped up), so it grows with
 *    the number of times both seats have chosen to keep trusting each
 *    other. It has no bearing on win/lose, only on the score the eventual
 *    WAR winner is shown to have taken (or that both seats forfeit on a
 *    mutual WAR, or that both keep on a mutual-victory ending — see below).
 *  - **Infinite-tie safety valve**: two seats that always choose LOVE would
 *    otherwise replay forever with no decisive outcome, which would never
 *    resolve the match. `MAX_TIE_ROUNDS` (5) applies the rulebook's *other*
 *    stated alternative for a tie — "공동 승리" — as a backstop: the 5th
 *    consecutive mutual-LOVE round ends the match as a **mutual victory**
 *    instead of triggering yet another replay. This never overrides the
 *    user's confirmed "재경기" choice for an ordinary tie — it only ever
 *    fires after 5 straight ties, which real play essentially never reaches.
 *  - **Mutual WAR's pot**: the rulebook only says "둘 다 최종 패배(탈락)"
 *    with no mention of the pot — resolved as forfeited (reset to 0, awarded
 *    to nobody), matching "공멸"/mutual destruction rather than either seat
 *    profiting from a double-betrayal.
 */

import { botTier, pickByLevel, type BotTier, type BotLevel, type ScoredCandidate } from "@/games/shared/bot/botDifficulty";

export type Seat = "p1" | "p2";

export function otherSeat(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

export type Choice = "LOVE" | "WAR";

/** §1: not specified by the rulebook — confirmed as a documented judgment call (see module doc's "판돈" section). Purely cosmetic; never affects win/lose. */
export const ANTE_PER_ROUND = 10;

/** Engineering safety valve for an otherwise-infinite mutual-LOVE tie streak — see module doc's "Infinite-tie safety valve". */
export const MAX_TIE_ROUNDS = 5;

export type RoundPhase =
  | "choice" // both seats secretly pick LOVE or WAR behind their screen
  | "reveal" // simultaneous reveal, held for the UI's ~3s showdown beat until "continue" (only reachable on a non-final tie) — or already "gameOver" for a decisive round
  | "gameOver";

export type RoundOutcome = "mutualLove" | "betrayal" | "mutualWar";

export interface RoundResultSnapshot {
  roundNumber: number;
  choices: Record<Seat, Choice>;
  outcome: RoundOutcome;
  /** Set only for `"betrayal"`. */
  winnerSeat: Seat | null;
  /** 0 unless `outcome === "betrayal"`. */
  potWon: number;
}

/** The match's final headline once `phase === "gameOver"` — see module doc's LOVE+LOVE / mutual-WAR judgment calls. */
export type MatchOutcome = "p1" | "p2" | "mutualVictory" | "mutualDefeat";

export interface LoveWinsAllState {
  round: number; // 1-based; increments only on a replayed (non-final) mutual-LOVE tie
  phase: RoundPhase;
  /** This round's secret picks; empty at the start of "choice", both keys present the instant "reveal" begins. */
  choices: Partial<Record<Seat, Choice>>;
  /** Cosmetic tension counter — see module doc's "판돈" section. */
  pot: number;
  /** The just-resolved round's reveal, kept until `"continue"` (or forever, once `gameOver`) — the UI's showdown/elimination display reads this. */
  lastRoundResult: RoundResultSnapshot | null;
  /** The sole seat that won via a decisive WAR betrayal, or `null` for both mutual endings. Only meaningful once `phase === "gameOver"`. */
  winner: Seat | null;
  /** `null` until `phase === "gameOver"`. */
  matchOutcome: MatchOutcome | null;
  /** Monotonic counter, incremented on every state-changing action — mirrors `showMeTheCoin`'s `seq`, used by `isStateSyncStale` to reject a stale reconnect `state-sync` race. */
  seq: number;
}

export function startGame(): LoveWinsAllState {
  return {
    round: 1,
    phase: "choice",
    choices: {},
    pot: ANTE_PER_ROUND,
    lastRoundResult: null,
    winner: null,
    matchOutcome: null,
    seq: 0,
  };
}

/** See `ShowMeTheCoinState`'s `isStateSyncStale` doc for the full race this guards against — same shape here, keyed off `seq` instead. */
export function isStateSyncStale(current: LoveWinsAllState | null, synced: LoveWinsAllState): boolean {
  return current !== null && synced.seq < current.seq;
}

export type EngineAction =
  | { type: "choose"; seat: Seat; choice: Choice }
  | { type: "continue" };

function applyMatchEndCheck(state: LoveWinsAllState, outcome: RoundOutcome, winnerSeat: Seat | null): LoveWinsAllState {
  if (outcome === "betrayal") {
    return { ...state, phase: "gameOver", winner: winnerSeat, matchOutcome: winnerSeat };
  }
  if (outcome === "mutualWar") {
    return { ...state, phase: "gameOver", winner: null, matchOutcome: "mutualDefeat" };
  }
  // mutualLove: replay unless the safety valve has kicked in (module doc).
  if (state.round >= MAX_TIE_ROUNDS) {
    return { ...state, phase: "gameOver", winner: null, matchOutcome: "mutualVictory" };
  }
  return state; // stays in "reveal", waiting for "continue" to replay
}

function resolveRound(state: LoveWinsAllState): LoveWinsAllState {
  const c1 = state.choices.p1;
  const c2 = state.choices.p2;
  if (c1 === undefined || c2 === undefined) return state; // structurally unreachable — resolved only once both have chosen

  let outcome: RoundOutcome;
  let winnerSeat: Seat | null = null;
  let potWon = 0;
  let nextPot = state.pot;
  if (c1 === "LOVE" && c2 === "LOVE") {
    outcome = "mutualLove"; // nextPot unchanged — carries into the replay (module doc's "판돈이월")
  } else if (c1 === "WAR" && c2 === "WAR") {
    outcome = "mutualWar";
    nextPot = 0; // forfeited — see module doc's "Mutual WAR's pot"
  } else {
    outcome = "betrayal";
    winnerSeat = c1 === "WAR" ? "p1" : "p2";
    potWon = state.pot;
    nextPot = 0;
  }

  const snapshot: RoundResultSnapshot = {
    roundNumber: state.round,
    choices: { p1: c1, p2: c2 },
    outcome,
    winnerSeat,
    potWon,
  };

  const next: LoveWinsAllState = {
    ...state,
    pot: nextPot,
    lastRoundResult: snapshot,
    phase: "reveal",
    seq: state.seq + 1,
  };
  return applyMatchEndCheck(next, outcome, winnerSeat);
}

function applyChoose(state: LoveWinsAllState, action: Extract<EngineAction, { type: "choose" }>): LoveWinsAllState {
  if (state.phase !== "choice") return state;
  if (state.choices[action.seat] !== undefined) return state; // already chosen this round

  const nextChoices = { ...state.choices, [action.seat]: action.choice };
  const bothChosen = nextChoices.p1 !== undefined && nextChoices.p2 !== undefined;
  const withChoice: LoveWinsAllState = { ...state, choices: nextChoices, seq: state.seq + 1 };
  return bothChosen ? resolveRound(withChoice) : withChoice;
}

function applyContinue(state: LoveWinsAllState): LoveWinsAllState {
  if (state.phase !== "reveal") return state;
  // The only way to still be in "reveal" (not already "gameOver") is a
  // non-final mutual-LOVE tie — see applyMatchEndCheck.
  return {
    ...state,
    round: state.round + 1,
    phase: "choice",
    choices: {},
    pot: state.pot + ANTE_PER_ROUND,
    lastRoundResult: null,
    seq: state.seq + 1,
  };
}

/** Single entry point applying any `EngineAction` to a state — the whole engine as one reducer. Every branch is a no-op (returns `state` unchanged) on an illegal/out-of-phase action, mirroring every other engine in this project. */
export function applyAction(state: LoveWinsAllState, action: EngineAction): LoveWinsAllState {
  if (state.phase === "gameOver") return state;
  switch (action.type) {
    case "choose":
      return applyChoose(state, action);
    case "continue":
      return applyContinue(state);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7) — getValidMoves / scoreMove /
// chooseBotAction(state, seat, level, rng?).
// ---------------------------------------------------------------------------

/** Whose secret pick is still pending, or `null` if nobody is blocked on one right now — drives `useBotAutoplay`. `"reveal"` is intentionally excluded: the host's own fixed timer (mirroring `ShowMeTheCoinGame.tsx`'s showdown timer) drives the replay's `"continue"`, not a bot-seat decision. */
export function currentActor(state: LoveWinsAllState): Seat | null {
  if (state.phase !== "choice") return null;
  if (state.choices.p1 === undefined) return "p1";
  if (state.choices.p2 === undefined) return "p2";
  return null;
}

export function getValidMoves(state: LoveWinsAllState, seat: Seat): EngineAction[] {
  if (state.phase === "choice") {
    if (state.choices[seat] !== undefined) return [];
    return [
      { type: "choose", seat, choice: "LOVE" },
      { type: "choose", seat, choice: "WAR" },
    ];
  }
  if (state.phase === "reveal") return [{ type: "continue" }];
  return []; // "gameOver"
}

/**
 * Probability weight a bot of this heuristic tier assigns to defecting
 * (choosing WAR) this round — see module doc point 4 for why this is what
 * "Tit-for-Tat" collapses into here: `round > 1` is only ever reached via a
 * mutual-LOVE tie, so the opponent's last move is *always* LOVE by
 * construction, and mirroring it would just mean "always LOVE forever".
 * Instead this models the rulebook's own §5 tip ("완전히 상대의 신뢰를 얻어...
 * 자신은 WAR를 내어 단독 승리") directly: temptation to betray rises with the
 * round number (the pot has grown, trust has been "proven" longer) and with
 * tier (an expert bot is simply better at picking the profitable moment).
 * `pickByLevel`'s own mistake-rate/tie-margin curve (botDifficulty.ts) is
 * what actually makes a *novice*-level bot behave near-randomly regardless
 * of this score — this function only needs to encode "what's the good play",
 * not separately simulate weak play.
 */
function warTemptation(round: number, tier: BotTier): number {
  const base = tier === "expert" ? 0.22 : tier === "core" ? 0.12 : 0.05;
  return Math.min(0.75, base * round);
}

function scoreMove(state: LoveWinsAllState, move: EngineAction, tier: BotTier): number {
  if (move.type !== "choose") return 0;
  const temptation = warTemptation(state.round, tier);
  return move.choice === "WAR" ? temptation : 1 - temptation;
}

export function chooseBotAction(
  state: LoveWinsAllState,
  seat: Seat,
  level: BotLevel,
  rng: () => number = Math.random,
): EngineAction | null {
  const moves = getValidMoves(state, seat);
  if (moves.length === 0) return null;
  const tier = botTier(level);
  const candidates: ScoredCandidate<EngineAction>[] = moves.map((move) => ({ move, score: scoreMove(state, move, tier) }));
  return pickByLevel(candidates, level, rng);
}
