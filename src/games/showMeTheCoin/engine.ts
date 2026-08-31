/**
 * Pure "쇼미더코인" (Show Me The Coin, 넷플릭스 예능 <데스게임> 등장) rules engine —
 * no React, no I/O. Source of truth: `boardGameRule/쇼미더코인/쇼미더코인.md`
 * ("정식 완전 룰북"), a 1:1 (2-player) hidden-coin duel with a *separate*
 * betting-chip currency.
 *
 * **2026-08-31 session — full rebuild on the rebuilt rulebook.** The old
 * (2026-08-30) rulebook draft treated the secretly-submitted coins themselves
 * as the pot's currency ("충돌형"). The new rulebook explicitly splits two
 * resources that the old engine conflated:
 *  - **숫자 코인** (`coins`, §2A: 50 coins / 3,000 points per seat, fixed
 *    denominations 500×3/100×7/50×10/10×30) — a purely comparative "hand": a
 *    seat secretly submits some of its own coins each round, and whoever's
 *    *submitted sum* is higher wins. §4 is explicit that **every submitted
 *    coin is discarded forever at round's end, regardless of outcome** — a
 *    winner never gets its own submitted coins back, only the chip pot.
 *  - **베팅칩** (`chips`, §2B: 30 per seat) — the actual poker-style betting
 *    currency: a mandatory 1-chip ante every round (§4 step 1) plus
 *    check/bet/raise/call/fold (§4 step 2). This is the only thing that ever
 *    moves through `pot`.
 *
 * Every numeric/structural gap the new rulebook still leaves open was
 * confirmed with the user via `AskUserQuestion` (Strict No-Assumption Rule in
 * the rebuild request) before writing a line of this file:
 *
 * 1. **Player count**: confirmed 2-player only (matches this project's other
 *    `netflix-death-game` collection 2-player titles — `malDalliJa`,
 *    `piecesOfLanguage`, `loveWinsAll` — and the rulebook's own §3 "선
 *    플레이어를 무작위로 추첨" / §4.3 "다른 모든 플레이어가 폴드" phrasing reads
 *    fine for 2 players; it never states a headcount).
 * 2. **§1 commit range**: the rulebook only says "1개 이상" with no stated
 *    upper bound — confirmed keeping the previous engine's 2~6 coin range
 *    rather than going unbounded (`MIN_COMMIT`/`MAX_COMMIT` below).
 * 3. **Match length**: rulebook §5 offers "정해진 전체 라운드 종료 시 베팅칩
 *    최다 보유자 승리" as an alternative to the last-one-standing KO — confirmed
 *    KO-only (no round cap), matching the previous engine.
 * 4. **Raise/bet sizing**: no minimum-raise-increment rule in the rulebook —
 *    confirmed free-form sizing (any amount above the current bet, capped by
 *    the raiser's own remaining chip stack), matching the previous engine.
 *
 * Smaller mechanical gaps the rulebook is silent on, resolved here as
 * documented engineering judgment calls (ARCHITECTURE.md §5), not re-asked:
 *  - **Fold discards both seats' coins, not just the folder's**: §4's "이번
 *    라운드에 제출되었던 모든 플레이어의 코인은 승패와 상관없이 전량 회수되어
 *    폐기됩니다" reads literally as "every seat that submitted a coin this
 *    round," independent of §3's win/tie/fold outcome — so a fold-winner's own
 *    unrevealed §1 commit is discarded too, exactly like a showdown winner's.
 *    Only the *values* stay hidden on a fold (`RoundResultSnapshot.committed`
 *    is `null`), not the discard itself.
 *  - **Below-minimum coin submissions**: if a seat's remaining coin count is
 *    under `MIN_COMMIT` (2) but still >0, §1's 2~6 range clamps down to
 *    `[remaining, remaining]` — a forced "everything I have left" commit —
 *    the same "below-minimum clamp" judgment call the previous engine made
 *    for chip stacks, just applied to the coin pool instead (see
 *    `commitRange`).
 *  - **KO timing**: both "파산 탈락" (chips hit 0) and "코인 고갈" (coins hit 0,
 *    §5) are checked once a round's pot/discard has actually resolved (after
 *    a showdown or a fold) — never mid-hand while a seat's chips/coins are
 *    merely at risk (an all-in raise/call, or a low-on-coins forced commit,
 *    must never end the game before the hand that put them at risk actually
 *    resolves).
 *  - **Ante placement**: §4 step 1's "모든 플레이어는 팟에 기본 앤티로 베팅칩
 *    1개를 의무 지불" is mandatory and non-optional, so it's applied
 *    automatically by `startGame`/`applyContinue` (no seat ever "decides" to
 *    ante) rather than modeled as a player-facing `EngineAction`.
 *  - **Raise/call sizing**: no artificial min/max beyond the rulebook's own
 *    "상대보다 더 많이" for a raise and each seat's own remaining chip stack (a
 *    natural all-in cap); a short-stacked call is "call for less," the
 *    standard poker convention.
 *  - **Checking**: the rulebook's §4 step 2 "체크: 앞선 베팅이 없을 때만 가능"
 *    is honored, but (as in the previous engine) a 0-amount "call" at any
 *    point nothing is currently owed doubles as a check — needed so a seat
 *    that can't legally raise still has a legal action, and produces a
 *    "check-check → showdown" line the rulebook doesn't forbid.
 *  - **Dealer rotation**: the rulebook only specifies how the very first 선공
 *    is chosen (§3, "무작위로 추첨") and is silent on later rounds — this
 *    engine alternates `dealerSeat` every round, the standard heads-up poker
 *    convention.
 *  - **Fold reveal**: folding never reveals either seat's §1 secret commit
 *    (`RoundResultSnapshot.committed` is `null` for a `"fold"` outcome) —
 *    standard poker convention, keeps a successful bluff-fold from leaking
 *    the bluffer's real coins for free.
 *
 * **2026-08-31 follow-up session — betting-UI/FX rebuild request.** The
 * request asked for (a) a live opponent-bet-amount display, (b) a private
 * per-seat chip-conversion stats HUD, (c) "no-limit raise," and (d) heavy
 * bet/raise FX. Before writing any of it, every ambiguous point was
 * confirmed via `AskUserQuestion` (the request's own "Strict No-Assumption
 * Rule") rather than guessed, because the request's wording conflicts with
 * this file's own two-resource split documented above:
 *  - The request's "베팅 코인"/"코인 베팅/레이즈" — confirmed to mean 베팅칩
 *    (`chips`/`betsThisRound`/`currentBet`), NOT `coins`. `coins` is never
 *    bet or raised; only its *count* feeds the stats HUD below.
 *  - "1개 고정 레이즈 제한" — turned out to already be unlimited: `applyRaise`
 *    (below) already accepted any `minLevel..maxLevel` amount before this
 *    session touched it. Confirmed no engine change was needed here — only
 *    the raise UI (`ShowMeTheCoinBoard.tsx`'s `BettingControls`) gained
 *    quick-amount buttons (+1/+5/+10/MAX) alongside its existing slider.
 *  - The private HUD's "코인 {n}개 / 남은코인 500제외 {n}개 / 환산후총칩 {n}개"
 *    reads a seat's OWN remaining `coins` (never the opponent's — info
 *    fairness, same principle as `scoreMove`'s doc above), and was confirmed
 *    to mean: `coins개` = `coins[seat].length`; `남은코인 500제외` = that count
 *    minus how many of those remaining coins are 500-value; `환산후총칩` =
 *    `남은코인 500제외 ÷ 20`, displayed to 1 decimal place. This is a pure
 *    UI-side computation (`ShowMeTheCoinBoard.tsx`'s `ChipStatsPanel`) — the
 *    engine doesn't need to store it since it's fully derivable from
 *    `coins[seat]`.
 *  - **`totalBet` added below**: the request explicitly asked for both a
 *    per-street figure (already `betsThisRound`) and a running match-lifetime
 *    total — confirmed as "every 베팅칩 a seat has ever paid into any pot this
 *    match" (ante included, since an ante is still a mandatory chip payment
 *    into the pot), accumulated forever and never reset by `applyContinue`.
 *  - **`isSeatAllIn` added below**: a *derived* (not stored) helper — a seat
 *    is all-in whenever its `chips` hit exactly 0, which (per `applyAnte`'s
 *    own comment) can only happen via an all-in call/raise, never an ante.
 *    Kept as a pure derivation rather than a stored flag to match this
 *    engine's existing minimal-state convention (`ShowMeTheCoinBoard.tsx`
 *    already derives its ALL-IN emblem trigger the same way, by watching
 *    `chips[seat]` drop to 0).
 */

import { botTier, pickByLevel, type BotLevel, type BotTier, type ScoredCandidate } from "@/games/shared/bot/botDifficulty";

export type Seat = "p1" | "p2";

export function otherSeat(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

/** §2B: 베팅칩 30개. */
export const STARTING_CHIPS = 30;
/** §4 step 1: "기본 앤티로 베팅칩 1개를 의무 지불". */
export const ANTE = 1;

/** §1: not upper-bounded by the rulebook — confirmed with the user (see module doc) as keeping the previous engine's 2~6 range. */
export const MIN_COMMIT = 2;
export const MAX_COMMIT = 6;

/** §2A: fixed starting denominations, 50 coins / 3,000 points per seat. */
export type CoinValue = 500 | 100 | 50 | 10;
export const COIN_COMPOSITION: ReadonlyArray<{ value: CoinValue; count: number }> = [
  { value: 500, count: 3 },
  { value: 100, count: 7 },
  { value: 50, count: 10 },
  { value: 10, count: 30 },
];

export interface CoinToken {
  /** Stable per-coin id (`${seat}-${value}-${index}`) — never reused once discarded, so React keys/FX stay stable across a coin's lifetime. */
  id: string;
  value: CoinValue;
}

function makeStartingCoins(seat: Seat): CoinToken[] {
  const coins: CoinToken[] = [];
  for (const { value, count } of COIN_COMPOSITION) {
    for (let i = 0; i < count; i++) coins.push({ id: `${seat}-${value}-${i}`, value });
  }
  return coins;
}

export type RoundPhase =
  | "commit" // §4 step 1: both seats secretly submit 2~6 coins as this round's "hand" (no chips move here — see module doc)
  | "betting" // §4 step 2: poker-style check/bet/raise/call/fold with chips
  | "showdown" // §4 step 3 reveal + step 4 discard, held for the UI's ~3s celebration/elimination beat until "continue"
  | "gameOver"; // §5 KO reached (bankrupt or coin-depleted)

export type RoundOutcome = "win" | "tie" | "fold";

export interface RoundResultSnapshot {
  roundNumber: number;
  /** Both seats' §1 submitted coins (revealed), or `null` if the round ended by fold (see module doc — a fold never reveals either hand). */
  committed: Record<Seat, CoinToken[]> | null;
  /** Chips the winner actually gained this round (0 on a tie — see `carriedOver`). */
  potWon: number;
  outcome: RoundOutcome;
  /** `null` only for a tie. */
  winnerSeat: Seat | null;
  /** Set only for a `"fold"` outcome. */
  folderSeat: Seat | null;
  /** §4.3 tie handling: the odd chip(s) that didn't divide evenly, carried into next round's pot. 0 for a decisive win/fold. */
  carriedOver: number;
}

export interface ShowMeTheCoinState {
  /** 베팅칩 — the actual betting currency (§2B). */
  chips: Record<Seat, number>;
  /** 숫자 코인 — each seat's remaining "hand" inventory (§2A). Shrinks every round per §4 step 4, never refilled. */
  coins: Record<Seat, CoinToken[]>;
  alive: Record<Seat, boolean>;
  round: number; // 1-based
  /** This round's 선공(first bettor) — alternates every round (see module doc). */
  dealerSeat: Seat;
  phase: RoundPhase;
  /**
   * §1 secret coin submissions for the round in progress, by coin id; empty
   * at the start of "commit", both keys present once "betting" begins. Named
   * `committed` (not e.g. `committedCoinIds`) to match every other engine in
   * this project's "committed = this round's secret submission" vocabulary.
   */
  committed: Partial<Record<Seat, string[]>>;
  /** Chips at stake this round (ante + §2 bets; carries a tied round's odd remainder forward — see module doc). */
  pot: number;
  /** The §2 bet total the acting seat must match to call. */
  currentBet: number;
  /** Each seat's cumulative §2 chip contribution this betting street (for call/raise sizing). */
  betsThisRound: Record<Seat, number>;
  /** Each seat's cumulative §2 chip contribution across the WHOLE match (ante + every bet/raise/call ever paid) — persists across rounds, never reset by `applyContinue`. Added for the betting-UI rebuild's live-bet-display/stats request (see module doc addendum); purely informational, no rule reads it. */
  totalBet: Record<Seat, number>;
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
  /** Monotonic counter, incremented on every state-changing action — mirrors every other engine's `seq`/`turnNumber`, used by `isStateSyncStale` to reject a stale reconnect `state-sync` race. */
  seq: number;
}

/** §4 step 1: mandatory 1-chip ante from both seats into the pot, applied automatically (no seat "decides" to ante — see module doc). Both seats are guaranteed ≥1 chip whenever this runs (a seat hitting 0 chips ends the match immediately via `applyKoCheck`, so `applyContinue`/`startGame` never reach a seat already bankrupt); the `Math.min` is a defensive clamp only. */
function applyAnte(state: ShowMeTheCoinState): ShowMeTheCoinState {
  const anteP1 = Math.min(ANTE, state.chips.p1);
  const anteP2 = Math.min(ANTE, state.chips.p2);
  return {
    ...state,
    chips: { p1: state.chips.p1 - anteP1, p2: state.chips.p2 - anteP2 },
    pot: state.pot + anteP1 + anteP2,
    totalBet: { p1: state.totalBet.p1 + anteP1, p2: state.totalBet.p2 + anteP2 },
  };
}

export function startGame(rng: () => number = Math.random): ShowMeTheCoinState {
  const dealerSeat: Seat = rng() < 0.5 ? "p1" : "p2";
  const base: ShowMeTheCoinState = {
    chips: { p1: STARTING_CHIPS, p2: STARTING_CHIPS },
    coins: { p1: makeStartingCoins("p1"), p2: makeStartingCoins("p2") },
    alive: { p1: true, p2: true },
    round: 1,
    dealerSeat,
    phase: "commit",
    committed: {},
    pot: 0,
    currentBet: 0,
    betsThisRound: { p1: 0, p2: 0 },
    totalBet: { p1: 0, p2: 0 },
    actingSeat: null,
    checkedThisStreet: false,
    lastRoundResult: null,
    winner: null,
    seq: 0,
  };
  return applyAnte(base);
}

/** See every other engine's `isStateSyncStale` doc for the full race this guards against — keyed off `seq`. */
export function isStateSyncStale(current: ShowMeTheCoinState | null, synced: ShowMeTheCoinState): boolean {
  return current !== null && synced.seq < current.seq;
}

export type EngineAction =
  | { type: "commit"; seat: Seat; coinIds: string[] }
  | { type: "raise"; amount: number }
  | { type: "call" }
  | { type: "fold" }
  | { type: "continue" };

/** §1 clamp for a seat's remaining coin count (see module doc's "below-minimum coin submissions" judgment call). Exported so the UI (`ShowMeTheCoinBoard.tsx`) can render the same legal count range it's about to submit. */
export function commitRange(coinsRemaining: number): { min: number; max: number } {
  if (coinsRemaining <= 0) return { min: 0, max: 0 };
  return { min: Math.min(MIN_COMMIT, coinsRemaining), max: Math.min(MAX_COMMIT, coinsRemaining) };
}

/**
 * §1 opponent-facing coin-count masking — 2026-08-31 후속 세션 ("실물 동전
 * ±1 힌트 시스템"). §1의 비공개 커밋은 *금액*뿐 아니라 이제 *개수*도 상대방
 * 화면에는 정확히 노출하지 않고 `[max(0, N-1), N+1]` 범위 힌트로만 보여준다
 * (본인 화면은 항상 정확한 개수/구성을 그대로 표시 — 정보 비대칭 없음).
 * `AskUserQuestion`으로 확인된 스펙 그대로: N<=0(이론상 코인 완전 고갈 케이스,
 * 실전에서는 `applyKoCheck`가 라운드 사이에 먼저 게임을 끝내므로 도달 불가)도
 * 별도 분기 없이 같은 공식으로 자연스럽게 "0 ~ 1개"가 나온다. 하한만 0으로
 * 클램프하고 상한은 클램프하지 않음(순수 힌트이므로 `MAX_COMMIT`을 넘어도 무방).
 * 순수 문자열 포맷터라 엔진에 두되(다른 UI 파생값과 동일한 위치), 렌더링은
 * 전적으로 `ShowMeTheCoinBoard.tsx`/`ShowMeTheCoinEffects.tsx` 쪽 책임.
 */
export function getMaskedCoinCountRange(coinCount: number): string {
  return `${Math.max(0, coinCount - 1)} ~ ${coinCount + 1}개`;
}

function coinSum(coins: CoinToken[], ids: string[]): number {
  const byId = new Map(coins.map((c) => [c.id, c.value] as const));
  return ids.reduce((sum, id) => sum + (byId.get(id) ?? 0), 0);
}

function applyCommit(state: ShowMeTheCoinState, action: Extract<EngineAction, { type: "commit" }>): ShowMeTheCoinState {
  if (state.phase !== "commit") return state;
  if (state.committed[action.seat] !== undefined) return state; // already committed this round
  const available = state.coins[action.seat];
  const { min, max } = commitRange(available.length);
  const ids = action.coinIds;
  if (ids.length < min || ids.length > max) return state;
  if (new Set(ids).size !== ids.length) return state; // no duplicate coin ids
  const ownIds = new Set(available.map((c) => c.id));
  if (!ids.every((id) => ownIds.has(id))) return state; // every id must belong to this seat's own remaining hand

  const nextCommitted = { ...state.committed, [action.seat]: ids };
  const bothCommitted = nextCommitted.p1 !== undefined && nextCommitted.p2 !== undefined;

  return {
    ...state,
    committed: nextCommitted,
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
  const stack = state.chips[seat];
  const already = state.betsThisRound[seat];
  const toCall = state.currentBet - already;
  if (stack <= toCall) return state; // no room to raise beyond an (all-in) call — see getValidMoves
  const minLevel = Math.max(state.currentBet + 1, already + 1);
  const maxLevel = already + stack; // all-in cap
  if (action.amount < minLevel || action.amount > maxLevel) return state;

  const delta = action.amount - already;
  return {
    ...state,
    chips: { ...state.chips, [seat]: stack - delta },
    betsThisRound: { ...state.betsThisRound, [seat]: action.amount },
    totalBet: { ...state.totalBet, [seat]: state.totalBet[seat] + delta },
    currentBet: action.amount,
    pot: state.pot + delta,
    actingSeat: otherSeat(seat),
    seq: state.seq + 1,
  };
}

/** Whether `seat` is currently all-in (zero chips left) — see module doc addendum. Purely derived, not stored. */
export function isSeatAllIn(state: ShowMeTheCoinState, seat: Seat): boolean {
  return state.chips[seat] === 0;
}

/**
 * §500-exclusion coin→chip conversion for the private `ChipStatsPanel` HUD
 * (`ShowMeTheCoinBoard.tsx`) — confirmed via `AskUserQuestion` (see module
 * doc addendum): remaining-coin COUNT (not value) with every 500-value coin
 * excluded, then 1 converted chip per 20 remaining coins (displayed to 1
 * decimal place by the caller). A pure formula, so it lives here rather than
 * in the UI layer — same "derivable from `coins[seat]`, no extra state"
 * principle as `commitRange`.
 */
export const CHIP_CONVERSION_DIVISOR = 20;
export function convertedChipTotal(remainingAfter500: number): number {
  return remainingAfter500 / CHIP_CONVERSION_DIVISOR;
}

/**
 * Ends the match once a *resolved* round (never mid-hand — see module doc's
 * "KO timing" judgment call) has actually left a seat §5-eliminated: either
 * "파산 탈락" (`chips <= 0`) or "코인 고갈" (`coins.length === 0`). Checked
 * independently for both seats rather than trusting the round's own
 * win/tie/fold attribution — a **tied** round can still leave one (or both)
 * seats bankrupt/coin-depleted if that seat had gone all-in this round with
 * nothing left over:
 *  - exactly one seat eliminated → the other seat wins outright, regardless
 *    of whether this round's own outcome was a "win" *for them* or a "tie";
 *  - both seats eliminated simultaneously (only reachable via a tie — a
 *    decisive win/fold's winner always ends the hand able to act again) → a
 *    draw, `winner: null`, both seats marked eliminated.
 */
function applyKoCheck(state: ShowMeTheCoinState): ShowMeTheCoinState {
  const p1Out = state.chips.p1 <= 0 || state.coins.p1.length === 0;
  const p2Out = state.chips.p2 <= 0 || state.coins.p2.length === 0;
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

/** §4 step 4: every coin submitted this round (by either seat) is discarded, win/tie/fold alike — see module doc. */
function discardCommitted(state: ShowMeTheCoinState): Record<Seat, CoinToken[]> {
  const p1Ids = new Set(state.committed.p1 ?? []);
  const p2Ids = new Set(state.committed.p2 ?? []);
  return {
    p1: state.coins.p1.filter((c) => !p1Ids.has(c.id)),
    p2: state.coins.p2.filter((c) => !p2Ids.has(c.id)),
  };
}

function resolveShowdown(state: ShowMeTheCoinState): ShowMeTheCoinState {
  const ids1 = state.committed.p1;
  const ids2 = state.committed.p2;
  if (ids1 === undefined || ids2 === undefined) return state; // structurally unreachable — betting only starts once both have committed

  const sum1 = coinSum(state.coins.p1, ids1);
  const sum2 = coinSum(state.coins.p2, ids2);
  const revealed: Record<Seat, CoinToken[]> = {
    p1: state.coins.p1.filter((c) => ids1.includes(c.id)),
    p2: state.coins.p2.filter((c) => ids2.includes(c.id)),
  };

  let winnerSeat: Seat | null = null;
  let potWon = 0;
  let carriedOver = 0;
  let nextChips = state.chips;
  let nextPot = 0;
  if (sum1 !== sum2) {
    winnerSeat = sum1 > sum2 ? "p1" : "p2";
    potWon = state.pot;
    nextChips = { ...state.chips, [winnerSeat]: state.chips[winnerSeat] + state.pot };
  } else {
    // §4.3 tie: split the pot evenly; an odd leftover chip carries into next round's pot.
    const share = Math.floor(state.pot / 2);
    carriedOver = state.pot - share * 2;
    potWon = share;
    nextChips = { p1: state.chips.p1 + share, p2: state.chips.p2 + share };
    nextPot = carriedOver;
  }

  const snapshot: RoundResultSnapshot = {
    roundNumber: state.round,
    committed: revealed,
    potWon,
    outcome: winnerSeat ? "win" : "tie",
    winnerSeat,
    folderSeat: null,
    carriedOver,
  };

  const next: ShowMeTheCoinState = {
    ...state,
    chips: nextChips,
    coins: discardCommitted(state),
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
  const stack = state.chips[seat];
  const already = state.betsThisRound[seat];
  const toCall = state.currentBet - already;
  const pay = Math.max(0, Math.min(toCall, stack)); // call-for-less if short (standard poker convention)

  const afterPay: ShowMeTheCoinState = {
    ...state,
    chips: { ...state.chips, [seat]: stack - pay },
    betsThisRound: { ...state.betsThisRound, [seat]: already + pay },
    totalBet: { ...state.totalBet, [seat]: state.totalBet[seat] + pay },
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
    carriedOver: 0,
  };

  const next: ShowMeTheCoinState = {
    ...state,
    chips: { ...state.chips, [winnerSeat]: state.chips[winnerSeat] + state.pot },
    coins: discardCommitted(state), // both seats' submitted coins are discarded too — see module doc
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
  const next: ShowMeTheCoinState = {
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
  return applyAnte(next); // §4 step 1's mandatory ante for the new round
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
// Info fairness: `scoreMove` only ever reads `state.committed[seat]` /
// `state.coins[seat]` (the bot's OWN hand) plus fully public fields
// (chips/pot/currentBet/betsThisRound) — never the opponent's `committed`
// value or coin inventory, even though (per this project's documented trust
// model, docs/architecture.md §2) every client's replicated `state`
// technically holds it already.
//
// §1 enumeration note: unlike every other phase, "every legal commit action"
// is combinatorially infeasible to enumerate (up to C(50,6) coin-id subsets)
// — `getValidMoves` instead offers two representative denomination
// strategies ("strongest available" / "weakest available") at each legal
// commit count, which is enough to (a) give `chooseBotAction` a meaningful
// choice between a strong hand and a cheap bluff at every size, and (b)
// satisfy the ARCHITECTURE.md §7.4 test contract ("chooseBotAction always
// returns a move contained in getValidMoves"). The real UI
// (`ShowMeTheCoinBoard.tsx`'s `CommitControls`) lets a human pick *any* legal
// subset directly — `applyCommit`'s own validation above is the actual
// authority, independent of this enumeration.
// ---------------------------------------------------------------------------

function coinsByStrategy(available: CoinToken[], count: number, strategy: "high" | "low"): CoinToken[] {
  const sorted = [...available].sort((a, b) => (strategy === "high" ? b.value - a.value : a.value - b.value) || a.id.localeCompare(b.id));
  return sorted.slice(0, count);
}

export function getValidMoves(state: ShowMeTheCoinState, seat: Seat): EngineAction[] {
  if (state.phase === "commit") {
    if (state.committed[seat] !== undefined) return [];
    const available = state.coins[seat];
    if (available.length === 0) return [];
    const { min, max } = commitRange(available.length);
    const moves: EngineAction[] = [];
    const seen = new Set<string>();
    for (let count = min; count <= max; count++) {
      for (const strategy of ["high", "low"] as const) {
        const ids = coinsByStrategy(available, count, strategy).map((c) => c.id);
        const key = [...ids].sort().join(",");
        if (seen.has(key)) continue;
        seen.add(key);
        moves.push({ type: "commit", seat, coinIds: ids });
      }
    }
    return moves;
  }

  if (state.phase === "betting") {
    if (state.actingSeat !== seat) return [];
    const stack = state.chips[seat];
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

/** Theoretical [min,max] sum achievable with `count` coins from the *canonical starting* denomination pool (§2A) — a static, supply-independent normalization range used only to gauge "how strong is this sum for this many coins," not an exact reflection of a seat's actual depleted inventory (documented simplification). */
function theoreticalSumBounds(count: number): { min: number; max: number } {
  if (count <= 0) return { min: 0, max: 0 };
  const descByValue = COIN_COMPOSITION.flatMap((d) => Array<number>(d.count).fill(d.value)).sort((a, b) => b - a);
  return { min: count * 10, max: descByValue.slice(0, count).reduce((a, b) => a + b, 0) };
}

/** 0..1 — how strong this seat's own §1 secret commit is, relative to the theoretical sum range for its coin count. Only ever reads the caller's own `committed`/`coins` (info fairness — see section doc). */
function ownConfidence(state: ShowMeTheCoinState, seat: Seat): number {
  const ids = state.committed[seat];
  if (!ids || ids.length === 0) return 0.5;
  const sum = coinSum(state.coins[seat], ids);
  const { min, max } = theoreticalSumBounds(ids.length);
  return max > min ? Math.max(0, Math.min(1, (sum - min) / (max - min))) : 0.5;
}

function scoreMove(state: ShowMeTheCoinState, seat: Seat, move: EngineAction, tier: BotTier): number {
  if (tier === "novice") return 0; // uniform over every legal move, per ARCHITECTURE.md §7.5

  switch (move.type) {
    case "commit": {
      const count = move.coinIds.length;
      const sum = coinSum(state.coins[seat], move.coinIds);
      const { min: sumMin, max: sumMax } = theoreticalSumBounds(count);
      const normalized = sumMax > sumMin ? (sum - sumMin) / (sumMax - sumMin) : 0.5;
      const { min: countMin, max: countMax } = commitRange(state.coins[seat].length);
      const idealFraction = tier === "expert" ? 0.65 : 0.5;
      const idealCount = countMin + idealFraction * (countMax - countMin);
      return -Math.abs(count - idealCount) * 3 - Math.abs(normalized - idealFraction) * 5;
    }
    case "fold": {
      const toCall = state.currentBet - state.betsThisRound[seat];
      if (toCall <= 0) return -100; // never fold for free — see module doc's checking judgment call
      const confidence = ownConfidence(state, seat);
      const riskRatio = toCall / Math.max(1, state.chips[seat] + toCall);
      return (1 - confidence) * riskRatio * 20;
    }
    case "call": {
      const toCall = state.currentBet - state.betsThisRound[seat];
      if (toCall <= 0) return 5; // a free check is always fine
      const confidence = ownConfidence(state, seat);
      const riskRatio = toCall / Math.max(1, state.chips[seat] + toCall);
      return confidence * 20 - riskRatio * 10;
    }
    case "raise": {
      const confidence = ownConfidence(state, seat);
      const already = state.betsThisRound[seat];
      const stack = state.chips[seat];
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
