/**
 * Pure "러브 윈즈 올" (Love Wins All) rules engine — no React, no I/O. Source
 * of truth: `boardGameRule/러브윈즈올/러브윈즈올.md`.
 *
 * **2026-08-30 session — full rebuild from a completely different rulebook.**
 * The rulebook file this engine now targets was entirely replaced upstream
 * (git history: commit `41562e2`) with an unrelated game — the previous
 * implementation of this folder (a LOVE/WAR hidden-choice prisoner's-dilemma
 * duel, see `git log -- src/games/loveWinsAll/engine.ts` for that version)
 * matched the *old* rulebook and had nothing in common with this one. Per
 * the request's explicit instruction, that entire implementation was
 * discarded rather than patched — this file, `cards.ts`, and every UI file
 * in this folder are a from-scratch rewrite.
 *
 * The new rulebook is a 1:1 (2-player) gambling duel: gesture-card hands
 * (가위/바위/보 + 러브) ranked poker-style, built over two betting streets with
 * a bluffable mid-hand "족보 선언" in between, played for chips until one
 * seat is broke. Every structural gap below was confirmed with the user via
 * `AskUserQuestion` (Strict No-Assumption Rule in the request) rather than
 * assumed:
 *
 * 1. **Ruleset scope**: the document's main body (A~K, "base") is a complete,
 *    self-contained 30-card/6-tier-hand ruleset; its appendix (L~Z,
 *    "러브 윈즈 올 2", `variant: "lwa2"`) is explicitly labeled a *later,
 *    season-2 house-rule variant* ("주요 변경점만 정리") — confirmed
 *    **base as the default, with lwa2 selectable by the host at room
 *    creation**, not a forced either/or.
 * 2. **Betting structure**: the rulebook only ever says "통상적인 포커식
 *    베팅(콜/레이즈/폴드)" with no stated limit structure — confirmed
 *    **no-limit** (a raise may be sized anywhere up to the raiser's entire
 *    remaining stack).
 * 3. **Base-variant deck exhaustion**: the 30-card deck is consumed 6 cards
 *    a round (§F.2/§F.4's 3-per-seat deal), so a match that outlasts 5
 *    rounds would run dry — the rulebook only ever states a reshuffle
 *    cadence for the *lwa2* appendix ("7라운드마다 새 덱으로 전량교체") and is
 *    silent for the base game — confirmed **base reshuffles a fresh,
 *    fully-shuffled deck every single round** (see `dealRound`), so match
 *    length is never capped by the deck. lwa2 keeps its own stated 7-round
 *    cadence unchanged (`dealRound`'s `deck.length < needed` branch — the
 *    arithmetic works out exactly: 7 cards/round × 7 rounds = the full
 *    49-card deck, so this naturally reshuffles right at the appendix's own
 *    boundary without a separate round-counter).
 * 4. **§J practice game** (a full pre-match warm-up played to 20 chips):
 *    confirmed **omitted** — this engine only ever implements the real match
 *    (`STARTING_CHIPS.base` = 25 / `.lwa2` = 35), matching every other
 *    online game in this project going straight from lobby to the real
 *    match.
 *
 * A number of smaller mechanical gaps the rulebook (or its appendix) simply
 * never states were resolved here as documented engineering judgment calls
 * (ARCHITECTURE.md §5), not re-asked — see `cards.ts`'s module doc for the
 * hand-ranking/tiebreak ones (mix-vs-mix, identical-symbol triple-vs-triple,
 * every lwa2 comparator beyond what the appendix restates) and:
 *  - **§F.1 선공(first-actor) rotation**: "직전 라운드 승자가 선공" is clear for
 *    a decisive win or a fold, but a genuine full tie (§G, rare — see
 *    `cards.ts`) has no winner to hand priority to; this engine simply keeps
 *    the same 선공 for the replay round in that case.
 *  - **Ante-induced KO**: nothing in the rulebook anticipates the mandatory
 *    1-chip ante (§F.2) itself being unaffordable this deep into a match —
 *    `dealRound` clamps a short-stacked ante down to the seat's remaining
 *    chips (mirrors `showMeTheCoin`'s "below-minimum commit" clamp), and
 *    `applyContinue` runs the same KO check used after every showdown/fold
 *    right after posting it, so a seat can't be soft-locked into an
 *    unplayable negative stack.
 *  - **Raise/call sizing**: no artificial min/max beyond "no-limit" itself —
 *    a raise tops out at the raiser's entire remaining stack (natural all-in
 *    cap), and a short-stacked call is "call for less" (standard heads-up
 *    poker convention, same as `showMeTheCoin`).
 *  - **§4 "1장 공개" card choice**: the rulebook never says which of a
 *    seat's 3 private cards gets revealed, only that exactly one does — this
 *    engine lets the player pick freely (`declare`'s `cardIndex`); which
 *    card is revealed has no rules effect beyond the count (§H — the
 *    declaration itself carries the only strategic weight, and it is never
 *    validated against the revealed card or the true hand, per §H's "거짓
 *    선언에 대한 별도 페널티 규정이 없습니다").
 *  - **Fold reveal**: folding never reveals either seat's hand (§G — "카드는
 *    공개하지 않고 그대로 라운드가 종료"), matching `showMeTheCoin`'s identical
 *    convention.
 */

import { botTier, pickByLevel, type BotLevel, type BotTier, type ScoredCandidate } from "@/games/shared/bot/botDifficulty";
import { seededRng, shuffle } from "@/lib/rng";
import {
  ANTE,
  BASE_HAND_RANK,
  LWA2_HAND_RANK,
  LIAR_PENALTY,
  PRIVATE_HAND_SIZE,
  STARTING_CHIPS,
  buildDeck,
  cardsPerRound,
  compareEvaluated,
  declarableHands,
  evaluateHand,
  handRankNumber,
  type EvaluatedHand,
  type HandCategory,
  type Suit,
  type Variant,
} from "./cards";

export type { Variant, Suit, HandCategory, HandTier } from "./cards";
export {
  ANTE,
  LIAR_PENALTY,
  PRIVATE_HAND_SIZE,
  STARTING_CHIPS,
  declarableHands,
  evaluateHand,
  handRankNumber,
  handTier,
  handTierRank,
  HAND_CATEGORY_LABEL,
  SUIT_EMOJI,
  SUIT_LABEL,
} from "./cards";

export type Seat = "p1" | "p2";

export function otherSeat(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

export type RoundPhase =
  | "bet1" // §3: normal poker-style call/raise/fold
  | "declare" // §4: both seats independently reveal 1 private card + declare a (bluffable) hand
  | "bet2" // §5: second betting street, informed by the declarations
  | "showdown" // §6 reveal, held for the UI's ~3s beat until "continue"
  | "gameOver"; // §I KO reached (a seat's chips hit 0)

export type RoundOutcome = "win" | "tie" | "fold";

export interface RoundResultSnapshot {
  roundNumber: number;
  outcome: RoundOutcome;
  /** `null` only for a tie. */
  winnerSeat: Seat | null;
  /** Set only for a `"fold"` outcome. */
  folderSeat: Seat | null;
  potWon: number;
  /** Appendix's Liar-card penalty actually paid this round (0 unless lwa2 and the loser's hand used the Liar). */
  liarPenaltyPaid: number;
  /** Both seats' full private hands — `null` for a fold (§G: never revealed). */
  hands: Record<Seat, Suit[]> | null;
  /** lwa2 only; always `null` for `"base"`. */
  community: Suit | null;
  /** Each seat's actual final hand category — `null` for a fold. */
  handRanks: Record<Seat, HandCategory> | null;
  /** Each seat's §4 bluffable claim (may not match `handRanks`) — kept even after a fold if declaring had already happened before the fold (bet2). */
  declaredHand: Partial<Record<Seat, HandCategory>>;
  /** This round's "매칭 팟" uncalled-bet refund (2026-09-01 session), if any — see `applyCall`'s doc. `null` when no street this round closed on a short all-in call. */
  refund: { seat: Seat; amount: number } | null;
}

export interface LoveWinsAllState {
  variant: Variant;
  round: number; // 1-based
  phase: RoundPhase;
  chips: Record<Seat, number>;
  pot: number;
  /** Undealt cards left after this round's deal — see module doc point 3 (base always discards this and reshuffles fresh next round; lwa2 keeps drawing it down). */
  deck: Suit[];
  /** lwa2 only; always `null` for `"base"`. */
  community: Suit | null;
  hands: Record<Seat, Suit[]>;
  /** Which private-hand index each seat has publicly revealed via `declare`. */
  revealedIndex: Partial<Record<Seat, number>>;
  /** Each seat's §4 bluffable claim this round. */
  declaredHand: Partial<Record<Seat, HandCategory>>;
  /** This round's §F.1 선공(first bettor) — round 1 is random, later rounds are the previous round's winner (module doc). */
  firstActorSeat: Seat;
  /** Whose betting decision is pending, or `null` outside `"bet1"`/`"bet2"`. */
  actingSeat: Seat | null;
  currentBet: number;
  betsThisStreet: Record<Seat, number>;
  /** Distinguishes "opening check, passes to the other seat" from "check-check, street closes" — reset every time a betting street starts. */
  checkedThisStreet: boolean;
  lastRoundResult: RoundResultSnapshot | null;
  /** This round's "매칭 팟" uncalled-bet refund so far (2026-09-01 session), carried from whichever street last closed on a short all-in call into this round's eventual `RoundResultSnapshot.refund` — `null` most rounds. Reset to `null` at the start of every new round (`applyContinue`/`startGame`), independent of `lastRoundResult`. */
  roundRefund: { seat: Seat; amount: number } | null;
  /** Final match winner once `phase === "gameOver"`; `null` for the (rare) simultaneous double-KO. */
  winner: Seat | null;
  /** Monotonic counter, incremented on every state-changing action — used by `isStateSyncStale` to reject a stale reconnect `state-sync` race. */
  seq: number;
}

interface DealResult {
  deck: Suit[];
  hands: Record<Seat, Suit[]>;
  community: Suit | null;
  chips: Record<Seat, number>;
  potAdd: number;
}

/** §F.2 (ante) + §F.2/§F.4 (deal) for one round — see module doc points 3/"Ante-induced KO" for the reshuffle-cadence and short-stack-clamp judgment calls. */
function dealRound(input: { variant: Variant; chips: Record<Seat, number>; deck: Suit[] }, rng: () => number): DealResult {
  const needed = cardsPerRound(input.variant);
  let deck = input.deck;
  if (input.variant === "base" || deck.length < needed) {
    deck = shuffle(buildDeck(input.variant), rng);
  }
  const hands: Record<Seat, Suit[]> = {
    p1: deck.slice(0, PRIVATE_HAND_SIZE),
    p2: deck.slice(PRIVATE_HAND_SIZE, PRIVATE_HAND_SIZE * 2),
  };
  const community = input.variant === "lwa2" ? deck[PRIVATE_HAND_SIZE * 2] : null;
  const restDeck = deck.slice(needed);

  const anteP1 = Math.min(ANTE, input.chips.p1);
  const anteP2 = Math.min(ANTE, input.chips.p2);
  const chips: Record<Seat, number> = { p1: input.chips.p1 - anteP1, p2: input.chips.p2 - anteP2 };

  return { deck: restDeck, hands, community, chips, potAdd: anteP1 + anteP2 };
}

export function startGame(variant: Variant = "base", rng: () => number = Math.random): LoveWinsAllState {
  const firstActorSeat: Seat = rng() < 0.5 ? "p1" : "p2";
  const dealt = dealRound({ variant, chips: { p1: STARTING_CHIPS[variant], p2: STARTING_CHIPS[variant] }, deck: [] }, rng);
  return {
    variant,
    round: 1,
    phase: "bet1",
    chips: dealt.chips,
    pot: dealt.potAdd,
    deck: dealt.deck,
    community: dealt.community,
    hands: dealt.hands,
    revealedIndex: {},
    declaredHand: {},
    firstActorSeat,
    actingSeat: firstActorSeat,
    currentBet: 0,
    betsThisStreet: { p1: 0, p2: 0 },
    checkedThisStreet: false,
    lastRoundResult: null,
    roundRefund: null,
    winner: null,
    seq: 0,
  };
}

/** Same shape as every other engine's stale-reconnect guard, keyed off `seq`. */
export function isStateSyncStale(current: LoveWinsAllState | null, synced: LoveWinsAllState): boolean {
  return current !== null && synced.seq < current.seq;
}

export type EngineAction =
  | { type: "raise"; amount: number }
  | { type: "call" }
  | { type: "fold" }
  | { type: "declare"; seat: Seat; cardIndex: number; declaredHand: HandCategory }
  | { type: "continue"; seed: number };

/** No-limit raise legal range for the acting seat — exported so the UI (`LoveWinsAllBoard.tsx`) can render the same bounds it's about to submit. `null` if the acting seat has no room to raise (would-be all-in call already covers their whole stack). */
export function raiseRange(state: LoveWinsAllState, seat: Seat): { min: number; max: number } | null {
  const stack = state.chips[seat];
  const already = state.betsThisStreet[seat];
  const toCall = state.currentBet - already;
  if (stack <= toCall) return null;
  return { min: Math.max(state.currentBet + 1, already + 1), max: already + stack };
}

function isBettingPhase(phase: RoundPhase): phase is "bet1" | "bet2" {
  return phase === "bet1" || phase === "bet2";
}

function applyRaise(state: LoveWinsAllState, action: Extract<EngineAction, { type: "raise" }>): LoveWinsAllState {
  if (!isBettingPhase(state.phase) || !state.actingSeat) return state;
  const seat = state.actingSeat;
  const range = raiseRange(state, seat);
  if (!range || action.amount < range.min || action.amount > range.max) return state;

  const delta = action.amount - state.betsThisStreet[seat];
  return {
    ...state,
    chips: { ...state.chips, [seat]: state.chips[seat] - delta },
    betsThisStreet: { ...state.betsThisStreet, [seat]: action.amount },
    currentBet: action.amount,
    pot: state.pot + delta,
    actingSeat: otherSeat(seat),
    seq: state.seq + 1,
  };
}

/** §6 full reveal + hand comparison, appendix's Liar tie-override, pot award, KO check — reachable only once §5 (`bet2`) closes. */
function resolveShowdown(state: LoveWinsAllState): LoveWinsAllState {
  const h1 = state.variant === "lwa2" && state.community ? [...state.hands.p1, state.community] : state.hands.p1;
  const h2 = state.variant === "lwa2" && state.community ? [...state.hands.p2, state.community] : state.hands.p2;
  const e1: EvaluatedHand = evaluateHand(h1, state.variant);
  const e2: EvaluatedHand = evaluateHand(h2, state.variant);

  let cmp = compareEvaluated(e1, e2);
  // Appendix: "라이어 카드로... 같은 등급끼리 비교될 경우에도 라이어 카드 쪽이 패배 처리" — only overrides an otherwise-genuine tie.
  if (cmp === 0 && state.variant === "lwa2") {
    if (e1.hasLiar && !e2.hasLiar) cmp = 1;
    else if (e2.hasLiar && !e1.hasLiar) cmp = -1;
  }

  let winnerSeat: Seat | null = null;
  let potWon = 0;
  let nextChips = state.chips;
  let nextPot = state.pot;
  let liarPenaltyPaid = 0;

  if (cmp !== 0) {
    winnerSeat = cmp < 0 ? "p1" : "p2";
    const loserSeat = otherSeat(winnerSeat);
    potWon = state.pot;
    nextChips = { ...state.chips, [winnerSeat]: state.chips[winnerSeat] + state.pot };
    nextPot = 0;

    const loserEval = loserSeat === "p1" ? e1 : e2;
    if (state.variant === "lwa2" && loserEval.hasLiar) {
      liarPenaltyPaid = Math.min(LIAR_PENALTY, nextChips[loserSeat]);
      nextChips = {
        ...nextChips,
        [loserSeat]: nextChips[loserSeat] - liarPenaltyPaid,
        [winnerSeat]: nextChips[winnerSeat] + liarPenaltyPaid,
      };
    }
  }
  // tie: nextPot stays == state.pot — §G's "다음 라운드로 이월".

  const snapshot: RoundResultSnapshot = {
    roundNumber: state.round,
    outcome: winnerSeat ? "win" : "tie",
    winnerSeat,
    folderSeat: null,
    potWon,
    liarPenaltyPaid,
    refund: state.roundRefund,
    hands: { p1: state.hands.p1, p2: state.hands.p2 },
    community: state.community,
    handRanks: { p1: e1.category, p2: e2.category },
    declaredHand: state.declaredHand,
  };

  const next: LoveWinsAllState = {
    ...state,
    chips: nextChips,
    pot: nextPot,
    actingSeat: null,
    lastRoundResult: snapshot,
    phase: "showdown",
    seq: state.seq + 1,
  };
  return applyKoCheck(next);
}

function applyCall(state: LoveWinsAllState): LoveWinsAllState {
  if (!isBettingPhase(state.phase) || !state.actingSeat) return state;
  const seat = state.actingSeat;
  const stack = state.chips[seat];
  const already = state.betsThisStreet[seat];
  const toCall = state.currentBet - already;
  const pay = Math.max(0, Math.min(toCall, stack)); // call-for-less if short (standard heads-up poker convention)
  const newTotal = already + pay;

  // Matched-pot / uncalled-bet rule (request's "베팅 상한 매칭 팟"): if this call
  // is short — an all-in for less than `currentBet` — the raiser's excess
  // above what actually got matched was never contested and is refunded
  // straight back to their stack right now, rather than sitting in a pot the
  // short-stacked opponent could never have covered. `currentBet` always
  // equals the raiser's own `betsThisStreet` total (`applyRaise` sets both
  // together), so `currentBet - newTotal` is exactly that uncalled excess.
  const raiser = otherSeat(seat);
  const refund = toCall > 0 && newTotal < state.currentBet ? state.currentBet - newTotal : 0;
  let nextChips = { ...state.chips, [seat]: stack - pay };
  if (refund > 0) nextChips = { ...nextChips, [raiser]: nextChips[raiser] + refund };

  const afterPay: LoveWinsAllState = {
    ...state,
    chips: nextChips,
    betsThisStreet: { ...state.betsThisStreet, [seat]: newTotal },
    pot: state.pot + pay - refund,
    roundRefund: refund > 0 ? { seat: raiser, amount: refund } : state.roundRefund,
  };

  // A genuine call (toCall > 0) always closes the street. A check (toCall
  // === 0) only closes it the SECOND time this street (the opening check
  // just passes the turn) — same check-check convention as showMeTheCoin.
  if (toCall === 0 && !state.checkedThisStreet) {
    return { ...afterPay, actingSeat: otherSeat(seat), checkedThisStreet: true, seq: state.seq + 1 };
  }

  if (state.phase === "bet1") {
    return { ...afterPay, phase: "declare", actingSeat: null, seq: state.seq + 1 };
  }
  return resolveShowdown({ ...afterPay, seq: state.seq + 1 });
}

function applyFold(state: LoveWinsAllState): LoveWinsAllState {
  if (!isBettingPhase(state.phase) || !state.actingSeat) return state;
  const folder = state.actingSeat;
  const winnerSeat = otherSeat(folder);
  const potWon = state.pot;

  const snapshot: RoundResultSnapshot = {
    roundNumber: state.round,
    outcome: "fold",
    winnerSeat,
    folderSeat: folder,
    potWon,
    liarPenaltyPaid: 0,
    refund: state.roundRefund,
    hands: null, // §G — a fold never reveals either hand
    community: null,
    handRanks: null,
    declaredHand: state.declaredHand,
  };

  const next: LoveWinsAllState = {
    ...state,
    chips: { ...state.chips, [winnerSeat]: state.chips[winnerSeat] + state.pot },
    pot: 0,
    actingSeat: null,
    lastRoundResult: snapshot,
    phase: "showdown",
    seq: state.seq + 1,
  };
  return applyKoCheck(next);
}

function applyDeclare(state: LoveWinsAllState, action: Extract<EngineAction, { type: "declare" }>): LoveWinsAllState {
  if (state.phase !== "declare") return state;
  if (state.declaredHand[action.seat] !== undefined) return state; // already declared this round
  if (action.cardIndex < 0 || action.cardIndex >= PRIVATE_HAND_SIZE) return state;
  if (!declarableHands(state.variant).includes(action.declaredHand)) return state;

  const nextDeclared = { ...state.declaredHand, [action.seat]: action.declaredHand };
  const nextRevealed = { ...state.revealedIndex, [action.seat]: action.cardIndex };
  const bothDeclared = nextDeclared.p1 !== undefined && nextDeclared.p2 !== undefined;

  const withDeclare: LoveWinsAllState = {
    ...state,
    declaredHand: nextDeclared,
    revealedIndex: nextRevealed,
    seq: state.seq + 1,
  };
  if (!bothDeclared) return withDeclare;

  return {
    ...withDeclare,
    phase: "bet2",
    actingSeat: state.firstActorSeat,
    currentBet: 0,
    betsThisStreet: { p1: 0, p2: 0 },
    checkedThisStreet: false,
  };
}

/**
 * §I — KO the instant either seat's chips hit 0 (checked after every pot
 * award/ante, not mid-hand while chips are merely at risk in a live bet).
 *
 * **KO absorbs any outstanding pot.** For a decisive showdown win or a fold,
 * `state.pot` is already 0 by the time this runs, so this is a no-op there.
 * But a §G tie *carries* the pot forward untouched — and an all-in-for-less
 * call can still leave the short-stacked seat at exactly 0 chips even on a
 * tied hand, or (more commonly, see module doc) the *next* round's mandatory
 * ante itself can be the thing that finally clamps a seat to 0. Either way,
 * once a seat hits 0 the match is over (§I) and there is no future round
 * left for a carried pot to be resolved into — so any such leftover is
 * folded into the sole surviving seat right here rather than vanishing.
 * (The one case with no seat left to award it to — both hitting 0
 * simultaneously — matches `showMeTheCoin`'s identical draw convention;
 * that pot has nowhere to go and is discarded.)
 *
 * **2026-09-01 bug fix — synthesized `lastRoundResult`.** The showdown/fold
 * call sites always populate `state.lastRoundResult` themselves before
 * reaching this function, so this used to just leave it alone. But
 * `applyContinue`'s ante-induced-KO path (module doc above) calls this
 * *after* already resetting `lastRoundResult` to `null` for the new round it
 * just dealt — so a match that ends purely from a short-stacked ante (never
 * from a showdown/fold) used to reach `phase: "gameOver"` with a `null`
 * `lastRoundResult`. `LoveWinsAllBoard.tsx`'s reveal overlay (and everything
 * downstream of it: the skip button, `onGameEnd`, the post-game result
 * screen) is gated on `state.lastRoundResult` being non-null — so that combo
 * silently froze the UI on the live table with no result screen ever
 * appearing, which is the "게임 종료 후 결과창이 안 뜬다" bug this session was
 * asked to fix. Synthesizing a minimal snapshot here (only when one isn't
 * already present) closes that gap without touching the showdown/fold paths
 * at all — `?? synthesized` is a no-op for those.
 */
function applyKoCheck(state: LoveWinsAllState): LoveWinsAllState {
  const p1Out = state.chips.p1 <= 0;
  const p2Out = state.chips.p2 <= 0;
  if (!p1Out && !p2Out) return state;

  function synthesizedResult(winnerSeat: Seat | null, potWon: number): RoundResultSnapshot {
    return {
      roundNumber: state.round,
      outcome: winnerSeat ? "win" : "tie",
      winnerSeat,
      folderSeat: null,
      potWon,
      liarPenaltyPaid: 0,
      refund: state.roundRefund,
      hands: null,
      community: null,
      handRanks: null,
      declaredHand: state.declaredHand,
    };
  }

  if (p1Out && p2Out) {
    return { ...state, pot: 0, phase: "gameOver", winner: null, lastRoundResult: state.lastRoundResult ?? synthesizedResult(null, 0) };
  }
  const loserSeat: Seat = p1Out ? "p1" : "p2";
  const winnerSeat = otherSeat(loserSeat);
  return {
    ...state,
    chips: { ...state.chips, [winnerSeat]: state.chips[winnerSeat] + state.pot },
    pot: 0,
    phase: "gameOver",
    winner: winnerSeat,
    lastRoundResult: state.lastRoundResult ?? synthesizedResult(winnerSeat, state.pot),
  };
}

function applyContinue(state: LoveWinsAllState, action: Extract<EngineAction, { type: "continue" }>): LoveWinsAllState {
  if (state.phase !== "showdown") return state;
  const rng = seededRng(action.seed);
  // §F.1: 직전 라운드 승자가 선공. A genuine tie has no winner — keep the same 선공 (module doc).
  const nextFirstActor = state.lastRoundResult?.winnerSeat ?? state.firstActorSeat;
  const dealt = dealRound({ variant: state.variant, chips: state.chips, deck: state.deck }, rng);

  const withDeal: LoveWinsAllState = {
    ...state,
    round: state.round + 1,
    phase: "bet1",
    chips: dealt.chips,
    pot: state.pot + dealt.potAdd,
    deck: dealt.deck,
    community: dealt.community,
    hands: dealt.hands,
    revealedIndex: {},
    declaredHand: {},
    firstActorSeat: nextFirstActor,
    actingSeat: nextFirstActor,
    currentBet: 0,
    betsThisStreet: { p1: 0, p2: 0 },
    checkedThisStreet: false,
    lastRoundResult: null,
    roundRefund: null,
    seq: state.seq + 1,
  };
  return applyKoCheck(withDeal); // ante-induced KO edge case (module doc)
}

/** Single entry point applying any `EngineAction` to a state — the whole engine as one reducer. Every branch is a no-op (returns `state` unchanged) on an illegal/out-of-phase action, mirroring every other engine in this project. */
export function applyAction(state: LoveWinsAllState, action: EngineAction): LoveWinsAllState {
  if (state.phase === "gameOver") return state;
  switch (action.type) {
    case "raise":
      return applyRaise(state, action);
    case "call":
      return applyCall(state);
    case "fold":
      return applyFold(state);
    case "declare":
      return applyDeclare(state, action);
    case "continue":
      return applyContinue(state, action);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7) — getValidMoves / scoreMove /
// chooseBotAction(state, seat, level, rng?).
//
// Info fairness: `ownHandStrength`/`scoreMove` only ever read the calling
// seat's OWN hand (`state.hands[seat]`) plus fully public fields (chips,
// pot, currentBet, betsThisStreet, community) — never the opponent's
// `hands` entry, even though (per this project's documented trust model,
// docs/architecture.md §2) every client's replicated `state` technically
// holds it already.
// ---------------------------------------------------------------------------

/** Whose decision is pending right now, or `null` if nobody is blocked on one (drives `useBotAutoplay`). `"showdown"`/`"gameOver"` are intentionally excluded — the host's own fixed timer (mirroring every other `<Game>Game.tsx`'s showdown timer) drives `"continue"`, not a bot-seat decision — see module doc. */
export function currentActor(state: LoveWinsAllState): Seat | null {
  if (isBettingPhase(state.phase)) return state.actingSeat;
  if (state.phase === "declare") {
    if (state.declaredHand.p1 === undefined) return "p1";
    if (state.declaredHand.p2 === undefined) return "p2";
    return null; // both declared, mid-transition — structurally momentary
  }
  return null; // "showdown" / "gameOver"
}

export function getValidMoves(state: LoveWinsAllState, seat: Seat): EngineAction[] {
  if (isBettingPhase(state.phase)) {
    if (state.actingSeat !== seat) return [];
    const moves: EngineAction[] = [{ type: "fold" }, { type: "call" }];
    const range = raiseRange(state, seat);
    if (range) {
      for (let amount = range.min; amount <= range.max; amount++) moves.push({ type: "raise", amount });
    }
    return moves;
  }
  if (state.phase === "declare") {
    if (state.declaredHand[seat] !== undefined) return [];
    const moves: EngineAction[] = [];
    for (let cardIndex = 0; cardIndex < PRIVATE_HAND_SIZE; cardIndex++) {
      for (const declaredHand of declarableHands(state.variant)) {
        moves.push({ type: "declare", seat, cardIndex, declaredHand });
      }
    }
    return moves;
  }
  return []; // "showdown"/"gameOver" — "continue" is host-timer/skip-button driven, never a per-seat bot decision (module doc)
}

/** 0..1 — how strong this seat's own current hand is, relative to the variant's full rank range. Only ever reads the caller's own `hands[seat]` (info fairness, section doc). */
function ownHandStrength(state: LoveWinsAllState, seat: Seat): number {
  const cards = state.variant === "lwa2" && state.community ? [...state.hands[seat], state.community] : state.hands[seat];
  const evaluated = evaluateHand(cards, state.variant);
  const worst = state.variant === "base" ? BASE_HAND_RANK.oneLove : LWA2_HAND_RANK.oneLove;
  if (worst <= 1) return 1;
  return 1 - (evaluated.rank - 1) / (worst - 1);
}

function scoreMove(state: LoveWinsAllState, seat: Seat, move: EngineAction, tier: BotTier): number {
  if (tier === "novice") return 0; // uniform over every legal move, per ARCHITECTURE.md §7.5

  const strength = ownHandStrength(state, seat);

  switch (move.type) {
    case "fold": {
      const toCall = state.currentBet - state.betsThisStreet[seat];
      if (toCall <= 0) return -100; // never fold for free
      const riskRatio = toCall / Math.max(1, state.chips[seat] + toCall);
      return (1 - strength) * riskRatio * 20;
    }
    case "call": {
      const toCall = state.currentBet - state.betsThisStreet[seat];
      if (toCall <= 0) return 5; // a free check is always fine
      const riskRatio = toCall / Math.max(1, state.chips[seat] + toCall);
      return strength * 20 - riskRatio * 10;
    }
    case "raise": {
      const already = state.betsThisStreet[seat];
      const stack = state.chips[seat];
      const aggressiveness = tier === "expert" ? 0.5 : 0.3;
      const target = already + 1 + Math.round(strength * stack * aggressiveness);
      return -Math.abs(move.amount - target) + strength * 5;
    }
    case "declare": {
      const cards = state.variant === "lwa2" && state.community ? [...state.hands[seat], state.community] : state.hands[seat];
      const trueCategory = evaluateHand(cards, state.variant).category;
      const honest = move.declaredHand === trueCategory ? 10 : 0;
      // §5's own tip ("신뢰를 쌓게 한 뒤 배신") applied to the declaration step:
      // an expert bot with a genuinely weak hand occasionally claims a
      // stronger label instead of always declaring honestly.
      const bluffing =
        tier === "expert" && strength < 0.4 && handRankNumber(move.declaredHand, state.variant) < handRankNumber(trueCategory, state.variant)
          ? 6
          : 0;
      return honest + bluffing;
    }
    default:
      return 0;
  }
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
  const candidates: ScoredCandidate<EngineAction>[] = moves.map((move) => ({ move, score: scoreMove(state, seat, move, tier) }));
  return pickByLevel(candidates, level, rng);
}
