/**
 * Pure "쇼미더코인" (Show Me The Coin, 넷플릭스 예능 <데스게임> 등장) rules engine —
 * no React, no I/O. Source of truth: `boardGameRule/쇼미더코인/쇼미더코인.md`
 * ("정식 규칙서"), a strictly 1:1 (2-player) hidden-coin betting duel.
 *
 * **2026-08-30 session — original implementation.** The rulebook leaves
 * several numeric/structural parameters unspecified or ambiguous; every gap
 * below was confirmed with the user via `AskUserQuestion` (Strict
 * No-Assumption Rule in the request) rather than assumed:
 *
 * 1. **Player count**: the rulebook's own text is explicit ("1:1 두뇌·베팅
 *    심리전 게임", §1 "두 플레이어") — confirmed 2-player only, matching this
 *    project's other `netflix-death-game` collection 2-player titles
 *    (`malDalliJa`, `piecesOfLanguage`), not the request's "2~8인" premise.
 * 2. **Starting stack**: not stated in the rulebook at all — confirmed 30
 *    coins per seat (`STARTING_COINS`).
 * 3. **§1 secret placement (2~6 coins) vs the pot**: confirmed "충돌형" —
 *    the secretly-committed coins are immediately staked into the pot (not a
 *    side comparison value with a separately-built betting pot). A round's
 *    pot is therefore always `committed.p1 + committed.p2 + any §2 raises`.
 * 4. **Match length**: rulebook offers "정해진 라운드 종료 시 비교" as an
 *    alternative win condition to KO — confirmed unused; this engine only
 *    ever ends a match via §4's KO condition (a seat's stack hits 0), so
 *    `round` has no upper bound.
 * 5. **Tie handling**: rulebook allows either "이월" (carry over) or "분할"
 *    (split) — confirmed carry-over: a tied round's pot is left untouched
 *    (not reset to 0) and simply keeps accumulating into the next round's §1
 *    commits/§2 bets.
 *
 * A few smaller mechanical gaps the rulebook is simply silent on were
 * resolved here as documented engineering judgment calls (ARCHITECTURE.md
 * §5), not re-asked:
 *  - **KO timing**: "상대방 코인 전량 소진 시킨 자 즉시 승리" is only checked
 *    once a round's pot is actually awarded (after a showdown loss or a
 *    fold) — never mid-hand while a seat's own coins are merely at risk in
 *    the pot (an all-in raise/call must never end the game before the hand
 *    that put those coins at risk has actually resolved).
 *  - **Below-minimum commits**: if a seat's remaining stack is under
 *    `MIN_COMMIT` (2), §1's 2~6 range is clamped down to `[stack, stack]` —
 *    a forced all-in commit — rather than soft-locking a seat with too few
 *    coins to legally act.
 *  - **Raise/call sizing**: no artificial min/max beyond the rulebook's own
 *    "상대보다 더 많이" for a raise and each seat's own remaining stack (a
 *    natural all-in cap; a short-stacked call is "call for less", the
 *    standard poker convention — the raiser's excess is simply never paid
 *    in, not returned as a separate step since it was never taken from
 *    their stack to begin with).
 *  - **Checking**: the rulebook frames the opening move as "선공의 베팅"
 *    (implying a nonzero opening bet), but this engine allows a 0-amount
 *    "call" (a check) at any point nothing is currently owed — needed so a
 *    seat that committed its entire remaining stack in §1 (leaving 0 to bet
 *    with) still has a legal action in §2, and it naturally produces a
 *    "check-check → showdown" line the rulebook doesn't explicitly forbid.
 *  - **Dealer rotation**: the rulebook only specifies how the very first
 *    선공/후공 is chosen (§1, "가위바위보나 선뽑기") and is silent on
 *    subsequent rounds — this engine alternates `dealerSeat` every round,
 *    the standard heads-up poker convention.
 *  - **Fold reveal**: folding never reveals either seat's §1 secret commit
 *    (`RoundResultSnapshot.committed` is `null` for a `"fold"` outcome) —
 *    standard poker convention, and keeps a successful bluff-fold from
 *    leaking the bluffer's real number for free.
 */

import { botTier, pickByLevel, type BotLevel, type BotTier, type ScoredCandidate } from "@/games/shared/bot/botDifficulty";

export type Seat = "p1" | "p2";

export function otherSeat(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

/** §1: not specified by the rulebook — confirmed with the user (see module doc). */
export const STARTING_COINS = 30;

/** §1: "2개~6개 사이의 상한/하한선". */
export const MIN_COMMIT = 2;
export const MAX_COMMIT = 6;

export type RoundPhase =
  | "commit" // §1: both seats secretly place 2~6 coins into the pot
  | "betting" // §2: poker-style raise/call/fold
  | "showdown" // §3 reveal, held for the UI's ~3s celebration/elimination beat until "continue"
  | "gameOver"; // §4 KO reached

export type RoundOutcome = "win" | "tie" | "fold";

export interface RoundResultSnapshot {
  roundNumber: number;
  /** Both seats' §1 secret commit, or `null` if the round ended by fold (see module doc — a fold never reveals either commit). */
  committed: Record<Seat, number> | null;
  potWon: number;
  outcome: RoundOutcome;
  /** `null` only for a tie. */
  winnerSeat: Seat | null;
  /** Set only for a `"fold"` outcome. */
  folderSeat: Seat | null;
}

export interface ShowMeTheCoinState {
  stacks: Record<Seat, number>;
  alive: Record<Seat, boolean>;
  round: number; // 1-based
  /** This round's 선공(first bettor) — alternates every round (see module doc). */
  dealerSeat: Seat;
  phase: RoundPhase;
  /** §1 secret commits for the round in progress; empty at the start of "commit", both keys present once "betting" begins. */
  committed: Partial<Record<Seat, number>>;
  /** Total coins at stake this round (carries a tied round's pot forward — see module doc). */
  pot: number;
  /** The §2 bet total the acting seat must match to call. */
  currentBet: number;
  /** Each seat's cumulative §2 contribution this betting street (for call/raise sizing). */
  betsThisRound: Record<Seat, number>;
  /** Whose §2 decision is pending, or `null` outside the betting phase. */
  actingSeat: Seat | null;
  /**
   * Whether the *opening* check (a `"call"` with nothing owed, from the
   * dealer before either seat has bet) has already happened this betting
   * street — distinguishes a "check, passes to the other seat" from a
   * "check-check, betting is over" (both check, per standard heads-up poker;
   * see `applyCall`). Reset to `false` every time betting starts.
   */
  checkedThisStreet: boolean;
  /** The just-concluded round's reveal, kept until `"continue"` — the UI's ~3s showdown/elimination display reads this. */
  lastRoundResult: RoundResultSnapshot | null;
  /** Final match winner once `phase === "gameOver"`. */
  winner: Seat | null;
  /** Monotonic counter, incremented on every state-changing action — mirrors `malDalliJa`'s `turnNumber`, used by `isStateSyncStale` to reject a stale reconnect `state-sync` race. */
  seq: number;
}

export function startGame(rng: () => number = Math.random): ShowMeTheCoinState {
  const dealerSeat: Seat = rng() < 0.5 ? "p1" : "p2";
  return {
    stacks: { p1: STARTING_COINS, p2: STARTING_COINS },
    alive: { p1: true, p2: true },
    round: 1,
    dealerSeat,
    phase: "commit",
    committed: {},
    pot: 0,
    currentBet: 0,
    betsThisRound: { p1: 0, p2: 0 },
    actingSeat: null,
    checkedThisStreet: false,
    lastRoundResult: null,
    winner: null,
    seq: 0,
  };
}

/** See `MalDalliJaState`'s `isStateSyncStale` doc for the full race this guards against — same shape here, keyed off `seq` instead of `turnNumber`. */
export function isStateSyncStale(current: ShowMeTheCoinState | null, synced: ShowMeTheCoinState): boolean {
  return current !== null && synced.seq < current.seq;
}

export type EngineAction =
  | { type: "commit"; seat: Seat; amount: number }
  | { type: "raise"; amount: number }
  | { type: "call" }
  | { type: "fold" }
  | { type: "continue" };

/** §1 clamp for a seat's remaining stack (see module doc's "below-minimum commits" judgment call). Exported so the UI (`ShowMeTheCoinBoard.tsx`) can render the same legal range it's about to submit. */
export function commitRange(stack: number): { min: number; max: number } {
  return { min: Math.min(MIN_COMMIT, stack), max: Math.min(MAX_COMMIT, stack) };
}

function applyCommit(state: ShowMeTheCoinState, action: Extract<EngineAction, { type: "commit" }>): ShowMeTheCoinState {
  if (state.phase !== "commit") return state;
  if (state.committed[action.seat] !== undefined) return state; // already committed this round
  const stack = state.stacks[action.seat];
  const { min, max } = commitRange(stack);
  if (stack <= 0 || action.amount < min || action.amount > max) return state;

  const nextCommitted = { ...state.committed, [action.seat]: action.amount };
  const nextStacks = { ...state.stacks, [action.seat]: stack - action.amount };
  const bothCommitted = nextCommitted.p1 !== undefined && nextCommitted.p2 !== undefined;

  return {
    ...state,
    stacks: nextStacks,
    committed: nextCommitted,
    pot: state.pot + action.amount,
    phase: bothCommitted ? "betting" : "commit",
    actingSeat: bothCommitted ? state.dealerSeat : null,
    currentBet: bothCommitted ? 0 : state.currentBet,
    betsThisRound: bothCommitted ? { p1: 0, p2: 0 } : state.betsThisRound,
    checkedThisStreet: bothCommitted ? false : state.checkedThisStreet,
    seq: state.seq + 1,
  };
}

function applyRaise(state: ShowMeTheCoinState, action: Extract<EngineAction, { type: "raise" }>): ShowMeTheCoinState {
  if (state.phase !== "betting" || !state.actingSeat) return state;
  const seat = state.actingSeat;
  const stack = state.stacks[seat];
  const already = state.betsThisRound[seat];
  const toCall = state.currentBet - already;
  if (stack <= toCall) return state; // no room to raise beyond an (all-in) call — see getValidMoves
  const minLevel = Math.max(state.currentBet + 1, already + 1);
  const maxLevel = already + stack; // all-in cap
  if (action.amount < minLevel || action.amount > maxLevel) return state;

  const delta = action.amount - already;
  return {
    ...state,
    stacks: { ...state.stacks, [seat]: stack - delta },
    betsThisRound: { ...state.betsThisRound, [seat]: action.amount },
    currentBet: action.amount,
    pot: state.pot + delta,
    actingSeat: otherSeat(seat),
    seq: state.seq + 1,
  };
}

/**
 * Ends the match once a *resolved* hand (never mid-hand — see module doc's
 * "KO timing" judgment call) has actually left a seat at 0 coins, checked
 * independently for both seats rather than trusting the round's own
 * win/tie/fold attribution: a **tied** round can still leave one (or both)
 * seats at 0 if that seat had gone all-in on its §1 commit alone (matching
 * the other seat's commit exactly, with nothing left over). The rulebook
 * never anticipates a tie leaving a stack at 0, so this resolves it as a
 * documented judgment call:
 *  - exactly one seat at 0 → the other seat wins outright, regardless of
 *    whether this round's own outcome was a "win" *for them* or a "tie";
 *  - both seats at 0 simultaneously (only reachable via a tie — a decisive
 *    win/fold's winner always ends the hand with a positive stack) → a draw,
 *    `winner: null`, both seats marked eliminated.
 */
function applyKoCheck(state: ShowMeTheCoinState): ShowMeTheCoinState {
  const p1Out = state.stacks.p1 <= 0;
  const p2Out = state.stacks.p2 <= 0;
  if (!p1Out && !p2Out) return state;
  if (p1Out && p2Out) {
    return { ...state, alive: { p1: false, p2: false }, phase: "gameOver", winner: null };
  }
  const loserSeat: Seat = p1Out ? "p1" : "p2";
  return {
    ...state,
    alive: { ...state.alive, [loserSeat]: false },
    phase: "gameOver",
    winner: otherSeat(loserSeat),
  };
}

function resolveShowdown(state: ShowMeTheCoinState): ShowMeTheCoinState {
  const c1 = state.committed.p1;
  const c2 = state.committed.p2;
  if (c1 === undefined || c2 === undefined) return state; // structurally unreachable — betting only starts once both have committed

  let winnerSeat: Seat | null = null;
  let potWon = 0;
  let nextStacks = state.stacks;
  let nextPot = state.pot;
  if (c1 !== c2) {
    winnerSeat = c1 > c2 ? "p1" : "p2";
    potWon = state.pot;
    nextStacks = { ...state.stacks, [winnerSeat]: state.stacks[winnerSeat] + state.pot };
    nextPot = 0;
  }
  // tie: nextPot stays == state.pot — carries into next round (see module doc's "tie handling").

  const snapshot: RoundResultSnapshot = {
    roundNumber: state.round,
    committed: { p1: c1, p2: c2 },
    potWon,
    outcome: winnerSeat ? "win" : "tie",
    winnerSeat,
    folderSeat: null,
  };

  const next: ShowMeTheCoinState = {
    ...state,
    stacks: nextStacks,
    pot: nextPot,
    actingSeat: null,
    lastRoundResult: snapshot,
    phase: "showdown",
    seq: state.seq + 1,
  };
  return applyKoCheck(next);
}

function applyCall(state: ShowMeTheCoinState): ShowMeTheCoinState {
  if (state.phase !== "betting" || !state.actingSeat) return state;
  const seat = state.actingSeat;
  const stack = state.stacks[seat];
  const already = state.betsThisRound[seat];
  const toCall = state.currentBet - already;
  const pay = Math.max(0, Math.min(toCall, stack)); // call-for-less if short (standard poker convention)

  const afterPay: ShowMeTheCoinState = {
    ...state,
    stacks: { ...state.stacks, [seat]: stack - pay },
    betsThisRound: { ...state.betsThisRound, [seat]: already + pay },
    pot: state.pot + pay,
  };

  // A genuine call (toCall > 0) always closes the betting street. A check
  // (toCall === 0) only closes it the SECOND time it happens this street —
  // the dealer's opening check just passes the turn (see `checkedThisStreet`'s
  // doc) — matching standard heads-up poker's check-check-to-showdown line.
  if (toCall === 0 && !state.checkedThisStreet) {
    return {
      ...afterPay,
      actingSeat: otherSeat(seat),
      checkedThisStreet: true,
      seq: state.seq + 1,
    };
  }
  return resolveShowdown(afterPay);
}

function applyFold(state: ShowMeTheCoinState): ShowMeTheCoinState {
  if (state.phase !== "betting" || !state.actingSeat) return state;
  const folder = state.actingSeat;
  const winnerSeat = otherSeat(folder);
  const potWon = state.pot;

  const snapshot: RoundResultSnapshot = {
    roundNumber: state.round,
    committed: null, // fold never reveals either secret commit — see module doc
    potWon,
    outcome: "fold",
    winnerSeat,
    folderSeat: folder,
  };

  const next: ShowMeTheCoinState = {
    ...state,
    stacks: { ...state.stacks, [winnerSeat]: state.stacks[winnerSeat] + state.pot },
    pot: 0,
    actingSeat: null,
    lastRoundResult: snapshot,
    phase: "showdown",
    seq: state.seq + 1,
  };
  return applyKoCheck(next);
}

function applyContinue(state: ShowMeTheCoinState): ShowMeTheCoinState {
  if (state.phase !== "showdown") return state;
  return {
    ...state,
    round: state.round + 1,
    dealerSeat: otherSeat(state.dealerSeat), // alternates every round — see module doc
    phase: "commit",
    committed: {},
    currentBet: 0,
    betsThisRound: { p1: 0, p2: 0 },
    actingSeat: null,
    lastRoundResult: null,
    seq: state.seq + 1,
  };
}

/** Single entry point applying any `EngineAction` to a state — the whole engine as one reducer. Every branch is a no-op (returns `state` unchanged) on an illegal/out-of-phase action, mirroring every other engine in this project. */
export function applyAction(state: ShowMeTheCoinState, action: EngineAction): ShowMeTheCoinState {
  if (state.phase === "gameOver") return state;
  switch (action.type) {
    case "commit":
      return applyCommit(state, action);
    case "raise":
      return applyRaise(state, action);
    case "call":
      return applyCall(state);
    case "fold":
      return applyFold(state);
    case "continue":
      return applyContinue(state);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7) — getValidMoves / scoreMove /
// chooseBotAction(state, seat, level, rng?).
//
// Info fairness: `scoreMove` only ever reads `state.committed[seat]` (the
// bot's OWN secret §1 commit) plus fully public fields (stacks/pot/
// currentBet/betsThisRound) — never the opponent's `committed` value, even
// though (per this project's documented trust model, docs/architecture.md
// §2) every client's replicated `state` technically holds it already.
// ---------------------------------------------------------------------------

export function getValidMoves(state: ShowMeTheCoinState, seat: Seat): EngineAction[] {
  if (state.phase === "commit") {
    if (state.committed[seat] !== undefined) return [];
    const stack = state.stacks[seat];
    if (stack <= 0) return [];
    const { min, max } = commitRange(stack);
    const moves: EngineAction[] = [];
    for (let amount = min; amount <= max; amount++) moves.push({ type: "commit", seat, amount });
    return moves;
  }

  if (state.phase === "betting") {
    if (state.actingSeat !== seat) return [];
    const stack = state.stacks[seat];
    const already = state.betsThisRound[seat];
    const toCall = state.currentBet - already;
    const moves: EngineAction[] = [{ type: "fold" }, { type: "call" }];
    if (stack > toCall) {
      const minLevel = Math.max(state.currentBet + 1, already + 1);
      const maxLevel = already + stack;
      for (let amount = minLevel; amount <= maxLevel; amount++) moves.push({ type: "raise", amount });
    }
    return moves;
  }

  if (state.phase === "showdown") return [{ type: "continue" }];
  return []; // "gameOver"
}

/** 0..1 — how strong this seat's own §1 secret commit is, relative to the 2~6 range. Only ever reads the caller's own `committed[seat]` (info fairness — see section doc). */
function ownConfidence(state: ShowMeTheCoinState, seat: Seat): number {
  const committed = state.committed[seat] ?? MIN_COMMIT;
  return (committed - MIN_COMMIT) / (MAX_COMMIT - MIN_COMMIT);
}

function scoreMove(state: ShowMeTheCoinState, seat: Seat, move: EngineAction, tier: BotTier): number {
  if (tier === "novice") return 0; // uniform over every legal move, per ARCHITECTURE.md §7.5

  switch (move.type) {
    case "commit": {
      const stack = state.stacks[seat];
      const idealFraction = tier === "expert" ? 0.6 : 0.5;
      const ideal = MIN_COMMIT + idealFraction * (MAX_COMMIT - MIN_COMMIT);
      return -Math.abs(move.amount - ideal) - (stack > 0 && move.amount >= stack ? 3 : 0); // mild reluctance to commit the entire remaining stack this early
    }
    case "fold": {
      const toCall = state.currentBet - state.betsThisRound[seat];
      if (toCall <= 0) return -100; // never fold for free — see module doc's checking judgment call
      const confidence = ownConfidence(state, seat);
      const riskRatio = toCall / Math.max(1, state.stacks[seat] + toCall);
      return (1 - confidence) * riskRatio * 20;
    }
    case "call": {
      const toCall = state.currentBet - state.betsThisRound[seat];
      if (toCall <= 0) return 5; // a free check is always fine
      const confidence = ownConfidence(state, seat);
      const riskRatio = toCall / Math.max(1, state.stacks[seat] + toCall);
      return confidence * 20 - riskRatio * 10;
    }
    case "raise": {
      const confidence = ownConfidence(state, seat);
      const already = state.betsThisRound[seat];
      const stack = state.stacks[seat];
      const aggressiveness = tier === "expert" ? 0.5 : 0.3;
      const target = already + 1 + Math.round(confidence * stack * aggressiveness);
      return -Math.abs(move.amount - target) + confidence * 5;
    }
    case "continue":
      return 0;
    default:
      return 0;
  }
}

export function chooseBotAction(
  state: ShowMeTheCoinState,
  seat: Seat,
  level: BotLevel,
  rng: () => number = Math.random,
): EngineAction | null {
  const moves = getValidMoves(state, seat);
  if (moves.length === 0) return null;
  const tier = botTier(level);
  const candidates: ScoredCandidate<EngineAction>[] = moves.map((move) => ({ move, score: scoreMove(state, seat, move, tier) }));
  return pickByLevel(candidates, level, rng);
}
