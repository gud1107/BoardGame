/**
 * Pure "레지스탕스 쿠(The Resistance: Coup)" rules engine — no React, no I/O.
 * Implements the rulebook at `boardGameRule/레지스탕스 쿠/레지스탕스 쿠.md`,
 * titled "단판 완결 정식 규칙서" — the base game is already structurally a
 * single-elimination sudden-death game (last player holding any influence
 * card wins), so there is no separate "단판 house rule" to layer on top the
 * way dalmuti/lasVegas/loveLetter needed — §5 of the rulebook IS the sudden-
 * death win condition verbatim.
 *
 * Same online-multiplayer trust model as every other game in this project
 * (see loveLetter/coyote's module docs): every connected client computes and
 * holds the FULL state (every seat's actual 1-2 hidden influence cards) from
 * a shared RNG seed plus replayed `EngineAction`s — there is no server
 * authority. Hidden-hand secrecy is enforced purely at the view layer via
 * `getPlayerView` below, never inside `CoupState` itself.
 *
 * ---------------------------------------------------------------------------
 * Turn anatomy — why the phase machine looks the way it does
 * ---------------------------------------------------------------------------
 * A single turn can cascade through up to 6 phases before control returns to
 * "action": declare → (§4-1 challenge the claim) → (§3-B block window) →
 * (§4-1 challenge the block) → (draw-and-resolve step: `exchange` or
 * `loseInfluence`) → back to "action" for the next seat. Every phase tracks
 * `awaitingSeats` — the still-undecided responders for *that* window — so
 * "everyone eligible has passed" and "someone objected" are both simple,
 * symmetric checks the reducer can apply no matter which client's action
 * happens to close the window.
 *
 * ---------------------------------------------------------------------------
 * Mid-game randomness (proving a card, drawing for 제상's exchange) without
 * breaking the "pure reducer, no Math.random()" contract (ARCHITECTURE.md §1)
 * ---------------------------------------------------------------------------
 * Two situations need a fresh random draw *after* the initial deal: (a) a
 * player whose claim survives a challenge shuffles the proven card back into
 * the deck and draws a replacement (§4-1), and (b) 제상's 교환 action draws 2
 * cards to choose from (§3-B table). Neither can be decided inside a pure
 * reducer call whose only inputs are the previous state and the action, so —
 * same technique grid-poker's `draw-common` action established — the
 * `EngineAction`s that might trigger one of these draws (`pass`,
 * `revealInfluence`) carry an optional `seed`, generated client-side by
 * whichever seat happens to send the action that closes the window. The seed
 * is simply unused on the (common) branches where no draw is needed that
 * turn, so every response button can attach one unconditionally without the
 * UI needing to know in advance whether it'll matter.
 *
 * ---------------------------------------------------------------------------
 * Documented inferences (the rulebook states the *character* table but
 * leaves a few interaction details to standard Coup convention)
 * ---------------------------------------------------------------------------
 * 1. **Costs (쿠 7코인, 암살 3코인) are paid the instant the action is
 *    declared, non-refundable even if the claim is later challenged and
 *    disproven.** The rulebook never says the coins come back on a failed
 *    bluff, and "은행에 7코인을 지불하고" reads as an upfront cost of
 *    *attempting* the move — the standard published ruling, and it also
 *    keeps the engine simpler (no cost-reversal bookkeeping mid-cascade).
 * 2. **Only the targeted seat may block 암살(assassinate)/갈취(steal).**
 *    §3-B's table only spells out "누가 막는가" by character, not by seat —
 *    but 외화 도입(foreign aid) explicitly says "누군가"(anyone) may block it
 *    while the targeted rows never repeat that word, and a block is
 *    mechanically a personal defense ("나 방어 카드 있어") in every published
 *    edition of Coup. Foreign aid, which has no target at all, stays open to
 *    every other alive seat.
 * 3. **"방해/도전 불가" (쿠, 소득, 세금, 교환)** is read literally: 쿠 skips
 *    both the challenge and block windows entirely (§3-A), and 세금/교환 skip
 *    only the block window (they're still challengeable claims, §4-1) since
 *    §3-B never lists a blocking character for either.
 * 4. **The "Double Kill" scenario (§4-2 콜아웃) is a direct, mechanical
 *    consequence of resolving in order, not a special-cased rule**: a failed
 *    block-challenge first costs the blocker a card for the false claim
 *    (§4-1 도전 성공), and *then* the original 암살 they were trying to block
 *    still executes against them — if that first loss already dropped them
 *    to 0 influence, the second hit is structurally skipped (nothing left to
 *    reveal) rather than treated as an error.
 * 5. **A steal on a seat with 0 coins is a legal (if pointless) declare** —
 *    the rulebook doesn't gate 갈취 on the target holding coins, so it
 *    resolves by transferring `min(2, target.coins)`, same as the real
 *    game's edge case.
 */

import { seededRng, shuffle } from "@/lib/rng";

export type SeatIndex = number;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const STARTING_COINS = 2;
export const STARTING_INFLUENCE = 2;
export const FORCED_COUP_THRESHOLD = 10;
export const COUP_COST = 7;
export const ASSASSINATE_COST = 3;

// ---------------------------------------------------------------------------
// Characters & deck (§1 구성물 — 5종 x 3장 = 15장)
// ---------------------------------------------------------------------------

export type Character = "duke" | "assassin" | "contessa" | "captain" | "ambassador";

export const CHARACTERS: Character[] = ["duke", "assassin", "contessa", "captain", "ambassador"];

export const CHARACTER_NAMES: Record<Character, string> = {
  duke: "공작",
  assassin: "암살자",
  contessa: "백작부인",
  captain: "사령관",
  ambassador: "제상",
};

export const CHARACTER_EMOJI: Record<Character, string> = {
  duke: "👑",
  assassin: "🗡️",
  contessa: "🛡️",
  captain: "⚓",
  ambassador: "🕊️",
};

export interface Card {
  id: number;
  character: Character;
}

export function buildDeck(): Card[] {
  const cards: Card[] = [];
  let id = 0;
  for (const character of CHARACTERS) {
    for (let i = 0; i < 3; i++) cards.push({ id: id++, character });
  }
  return cards;
}

export const DECK_SIZE = buildDeck().length; // 15, verified in Coup.test.ts

// ---------------------------------------------------------------------------
// Actions (§3 — 7가지 중 택 1)
// ---------------------------------------------------------------------------

export type ActionKind = "income" | "foreignAid" | "coup" | "tax" | "assassinate" | "steal" | "exchange";

export const ACTION_NAMES: Record<ActionKind, string> = {
  income: "소득",
  foreignAid: "외화 도입",
  coup: "쿠데타",
  tax: "세금 징수",
  assassinate: "암살",
  steal: "갈취",
  exchange: "교환",
};

const ACTION_COST: Record<ActionKind, number> = {
  income: 0,
  foreignAid: 0,
  coup: COUP_COST,
  tax: 0,
  assassinate: ASSASSINATE_COST,
  steal: 0,
  exchange: 0,
};

/** Which character an action claims to be performed by — null for the 3 "일반 행동"s nobody can dispute. */
const CLAIMED_CHARACTER_FOR_ACTION: Record<ActionKind, Character | null> = {
  income: null,
  foreignAid: null,
  coup: null,
  tax: "duke",
  assassinate: "assassin",
  steal: "captain",
  exchange: "ambassador",
};

/** Which characters may be claimed to block this action — empty means "방해 불가" (§3-A/§3-B). */
const BLOCK_CHARACTERS: Record<ActionKind, Character[]> = {
  income: [],
  foreignAid: ["duke"],
  coup: [],
  tax: [],
  assassinate: ["contessa"],
  steal: ["captain", "ambassador"],
  exchange: [],
};

export function blockCharactersFor(action: ActionKind): Character[] {
  return BLOCK_CHARACTERS[action];
}

export function needsDeclareTarget(action: ActionKind): boolean {
  return action === "coup" || action === "assassinate" || action === "steal";
}

export function mustCoup(coins: number): boolean {
  return coins >= FORCED_COUP_THRESHOLD;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface PlayerState {
  seat: SeatIndex;
  coins: number;
  /** Face-down, hidden from other viewers — 1-2 cards while alive, 0 once eliminated. */
  influence: Card[];
  /** Face-up, dead, always public — §2 "앞면으로 뒤집어 놓습니다". */
  revealed: Card[];
}

/** No separate `alive` field stored — derived from `influence.length`, per ARCHITECTURE.md §1.4's "파생 상태 금지" principle (a seat's aliveness and its remaining influence count are the same fact). */
export function isAlive(p: PlayerState): boolean {
  return p.influence.length > 0;
}

export type Phase =
  | "action" // active seat picks one of the 7 actions
  | "actionChallengeWindow" // others may dispute the claimed character (tax/assassinate/steal/exchange only)
  | "blockWindow" // eligible seat(s) may claim a blocking character (foreignAid/assassinate/steal only)
  | "blockChallengeWindow" // others (including the original actor) may dispute the block claim
  | "exchange" // 제상 교환 — the actor picks which cards to keep from (current influence + 2 drawn)
  | "loseInfluence" // a designated seat must choose which influence card to reveal
  | "gameOver";

export type LoseInfluenceReason =
  | "coup" // §3-A 쿠 — no claim, no defense, resolves immediately
  | "challengeActionLost" // actor's character claim was a bluff, caught (§4-1 도전 성공)
  | "challengeActionFailed_penalty" // challenger disputed a TRUE claim (§4-1 도전 실패) — challenger pays
  | "blockBluffCaught" // a block claim was a bluff, caught
  | "challengeBlockFailed_penalty" // challenger disputed a TRUE block claim — challenger pays
  | "assassinateEffect"; // 암살 itself landing — either the primary hit, or the §4-2 "Double Kill" second hit

export interface PendingActionInfo {
  actorSeat: SeatIndex;
  action: ActionKind;
  targetSeat: SeatIndex | null;
  claimedCharacter: Character | null;
}

export interface PendingBlockInfo {
  blockerSeat: SeatIndex;
  claimedCharacter: Character;
}

export type LastEvent =
  | { type: "declare"; seat: SeatIndex; action: ActionKind; targetSeat: SeatIndex | null }
  | { type: "challengeAction"; challengerSeat: SeatIndex; actorSeat: SeatIndex; character: Character; actorHadCard: boolean }
  | { type: "block"; blockerSeat: SeatIndex; actorSeat: SeatIndex; character: Character }
  | { type: "challengeBlock"; challengerSeat: SeatIndex; blockerSeat: SeatIndex; character: Character; blockerHadCard: boolean }
  | { type: "actionResolved"; action: ActionKind; actorSeat: SeatIndex; targetSeat: SeatIndex | null; blocked: boolean; amount?: number }
  | { type: "influenceLost"; seat: SeatIndex; character: Character; reason: LoseInfluenceReason }
  | { type: "cardReplaced"; seat: SeatIndex; character: Character }
  | { type: "exchangeStarted"; seat: SeatIndex }
  | { type: "exchangeResolved"; seat: SeatIndex };

export interface CoupState {
  playerCount: number;
  players: PlayerState[];
  /** Face-down draw pile, shared. */
  deck: Card[];
  activeSeat: SeatIndex;
  phase: Phase;
  turnNumber: number;
  pendingAction: PendingActionInfo | null;
  pendingBlock: PendingBlockInfo | null;
  /** Seats that still haven't responded in the *current* window (actionChallengeWindow / blockWindow / blockChallengeWindow). */
  awaitingSeats: SeatIndex[];
  pendingLoseInfluence: { seat: SeatIndex; reason: LoseInfluenceReason } | null;
  pendingExchange: { seat: SeatIndex; keepCount: number; options: Card[] } | null;
  lastEvent: LastEvent | null;
  /** Seats in elimination order (earliest first) — needed for final rankings. */
  eliminationOrder: SeatIndex[];
  /** Set the instant only one seat still holds any influence (§5 최종 승리 조건). */
  winnerSeat: SeatIndex | null;
}

export type EngineAction =
  | { type: "declareAction"; seat: SeatIndex; action: ActionKind; targetSeat?: SeatIndex }
  | { type: "declareBlock"; seat: SeatIndex; character: Character }
  | { type: "challenge"; seat: SeatIndex }
  | { type: "pass"; seat: SeatIndex; seed?: number }
  | { type: "resolveExchange"; seat: SeatIndex; keepCardIds: number[] }
  | { type: "revealInfluence"; seat: SeatIndex; cardId: number; seed?: number };

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function startGame(playerCount: number, seed: number): CoupState {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`Unsupported player count: ${playerCount}`);
  }
  const rng = seededRng(seed);
  let deck = shuffle(buildDeck(), rng);

  const players: PlayerState[] = Array.from({ length: playerCount }, (_, seat) => {
    const influence = deck.slice(0, STARTING_INFLUENCE);
    deck = deck.slice(STARTING_INFLUENCE);
    return { seat, coins: STARTING_COINS, influence, revealed: [] };
  });

  // No physical tiebreak (가위바위보, §1-5) has meaning at a fresh table —
  // same convention as every other game here: pick the starter from the
  // shared seed, after dealing is already fixed.
  const starter = Math.floor(rng() * playerCount);

  return {
    playerCount,
    players,
    deck,
    activeSeat: starter,
    phase: "action",
    turnNumber: 1,
    pendingAction: null,
    pendingBlock: null,
    awaitingSeats: [],
    pendingLoseInfluence: null,
    pendingExchange: null,
    lastEvent: null,
    eliminationOrder: [],
    winnerSeat: null,
  };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function aliveSeats(state: CoupState): SeatIndex[] {
  return state.players.filter(isAlive).map((p) => p.seat);
}

function getPlayer(state: { players: PlayerState[] }, seat: SeatIndex): PlayerState | undefined {
  return state.players.find((p) => p.seat === seat);
}

function nextAliveSeat(seat: SeatIndex, players: PlayerState[], playerCount: number): SeatIndex {
  let next = (seat + 1) % playerCount;
  for (let i = 0; i < playerCount; i++) {
    const p = players.find((pl) => pl.seat === next);
    if (p && isAlive(p)) return next;
    next = (next + 1) % playerCount;
  }
  return seat; // unreachable once the game hasn't already ended, kept only as a safe fallback
}

/** Who may currently submit a response — for UI gating (the engine re-validates independently on every action). */
export function currentResponders(state: CoupState): SeatIndex[] {
  switch (state.phase) {
    case "actionChallengeWindow":
    case "blockWindow":
    case "blockChallengeWindow":
      return state.awaitingSeats;
    case "loseInfluence":
      return state.pendingLoseInfluence ? [state.pendingLoseInfluence.seat] : [];
    case "exchange":
      return state.pendingExchange ? [state.pendingExchange.seat] : [];
    case "action":
      return [state.activeSeat];
    default:
      return [];
  }
}

function endTurn(state: CoupState): CoupState {
  const alive = aliveSeats(state);
  if (alive.length <= 1) {
    return {
      ...state,
      phase: "gameOver",
      winnerSeat: alive[0] ?? null,
      pendingAction: null,
      pendingBlock: null,
      pendingLoseInfluence: null,
      pendingExchange: null,
      awaitingSeats: [],
    };
  }
  const next = nextAliveSeat(state.activeSeat, state.players, state.playerCount);
  return {
    ...state,
    phase: "action",
    activeSeat: next,
    turnNumber: state.turnNumber + 1,
    pendingAction: null,
    pendingBlock: null,
    pendingLoseInfluence: null,
    pendingExchange: null,
    awaitingSeats: [],
  };
}

/** §4-1 "카드를 낸 사람은 그 카드를 덱에 넣고 잘 섞은 뒤 새 카드 1장을 뽑아 손패를 보충합니다" — shuffles the proven card back in and replaces it in place. */
function replaceProvenCard(state: CoupState, seat: SeatIndex, character: Character, seed: number | undefined): CoupState {
  const player = getPlayer(state, seat)!;
  const idx = player.influence.findIndex((c) => c.character === character);
  if (idx === -1) return state; // structurally unreachable — only called after confirming the player holds this character
  const provenCard = player.influence[idx];
  const rng = seededRng(seed ?? 0);
  const reshuffled = shuffle([...state.deck, provenCard], rng);
  const [newCard, ...deck] = reshuffled;
  const players = state.players.map((p) => (p.seat === seat ? { ...p, influence: p.influence.map((c, i) => (i === idx ? newCard : c)) } : p));
  return { ...state, players, deck, lastEvent: { type: "cardReplaced", seat, character } };
}

// ---------------------------------------------------------------------------
// declareAction — §3
// ---------------------------------------------------------------------------

function declareAction(state: CoupState, seat: SeatIndex, action: ActionKind, targetSeat: SeatIndex | undefined): CoupState {
  if (state.phase !== "action" || seat !== state.activeSeat) return state;
  const actor = getPlayer(state, seat);
  if (!actor || !isAlive(actor)) return state;
  if (mustCoup(actor.coins) && action !== "coup") return state; // §3-A 필수 규칙

  if (needsDeclareTarget(action)) {
    if (targetSeat === undefined || targetSeat === seat) return state;
    const target = getPlayer(state, targetSeat);
    if (!target || !isAlive(target)) return state;
  } else if (targetSeat !== undefined) {
    return state;
  }

  const cost = ACTION_COST[action];
  if (actor.coins < cost) return state;
  const players = cost > 0 ? state.players.map((p) => (p.seat === seat ? { ...p, coins: p.coins - cost } : p)) : state.players;

  const base: CoupState = { ...state, players, lastEvent: { type: "declare", seat, action, targetSeat: targetSeat ?? null } };

  if (action === "income") {
    return endTurn({ ...base, players: players.map((p) => (p.seat === seat ? { ...p, coins: p.coins + 1 } : p)) });
  }

  if (action === "coup") {
    return {
      ...base,
      phase: "loseInfluence",
      pendingAction: { actorSeat: seat, action, targetSeat: targetSeat!, claimedCharacter: null },
      pendingLoseInfluence: { seat: targetSeat!, reason: "coup" },
      awaitingSeats: [],
    };
  }

  if (action === "foreignAid") {
    return {
      ...base,
      phase: "blockWindow",
      pendingAction: { actorSeat: seat, action, targetSeat: null, claimedCharacter: null },
      awaitingSeats: aliveSeats(state).filter((s) => s !== seat),
    };
  }

  // tax / assassinate / steal / exchange — a character claim, open to challenge first (§4-1).
  return {
    ...base,
    phase: "actionChallengeWindow",
    pendingAction: { actorSeat: seat, action, targetSeat: targetSeat ?? null, claimedCharacter: CLAIMED_CHARACTER_FOR_ACTION[action] },
    awaitingSeats: aliveSeats(state).filter((s) => s !== seat),
  };
}

// ---------------------------------------------------------------------------
// actionChallengeWindow
// ---------------------------------------------------------------------------

function proceedAfterClaimSurvives(state: CoupState, seed: number | undefined): CoupState {
  const pending = state.pendingAction!;

  if (pending.action === "tax") {
    const players = state.players.map((p) => (p.seat === pending.actorSeat ? { ...p, coins: p.coins + 3 } : p));
    return endTurn({
      ...state,
      players,
      pendingAction: null,
      lastEvent: { type: "actionResolved", action: "tax", actorSeat: pending.actorSeat, targetSeat: null, blocked: false },
    });
  }

  if (pending.action === "exchange") {
    return startExchange(state, pending.actorSeat, seed);
  }

  // assassinate / steal — survive the claim, now offer the target a block window (§3-B).
  return { ...state, phase: "blockWindow", awaitingSeats: [pending.targetSeat!] };
}

function startExchange(state: CoupState, seat: SeatIndex, seed: number | undefined): CoupState {
  const actor = getPlayer(state, seat)!;
  const rng = seededRng(seed ?? 0);
  const deck = shuffle(state.deck, rng);
  const drawCount = Math.min(2, deck.length);
  const drawn = deck.slice(0, drawCount);
  return {
    ...state,
    deck: deck.slice(drawCount),
    phase: "exchange",
    pendingExchange: { seat, keepCount: actor.influence.length, options: [...actor.influence, ...drawn] },
    pendingAction: null,
    awaitingSeats: [],
    lastEvent: { type: "exchangeStarted", seat },
  };
}

function passActionChallenge(state: CoupState, seat: SeatIndex, seed: number | undefined): CoupState {
  if (state.phase !== "actionChallengeWindow" || !state.awaitingSeats.includes(seat)) return state;
  const awaitingSeats = state.awaitingSeats.filter((s) => s !== seat);
  if (awaitingSeats.length > 0) return { ...state, awaitingSeats };
  return proceedAfterClaimSurvives({ ...state, awaitingSeats: [] }, seed);
}

function challengeAction(state: CoupState, seat: SeatIndex): CoupState {
  if (state.phase !== "actionChallengeWindow" || !state.awaitingSeats.includes(seat)) return state;
  const pending = state.pendingAction!;
  const actor = getPlayer(state, pending.actorSeat)!;
  const actorHadCard = actor.influence.some((c) => c.character === pending.claimedCharacter);
  const lastEvent: LastEvent = {
    type: "challengeAction",
    challengerSeat: seat,
    actorSeat: pending.actorSeat,
    character: pending.claimedCharacter!,
    actorHadCard,
  };
  if (actorHadCard) {
    // §4-1 도전 실패 — challenger pays the penalty; actor's card gets replaced once that resolves.
    return { ...state, phase: "loseInfluence", awaitingSeats: [], pendingLoseInfluence: { seat, reason: "challengeActionFailed_penalty" }, lastEvent };
  }
  // §4-1 도전 성공 — the claim was a bluff, the actor pays and the action is cancelled.
  return { ...state, phase: "loseInfluence", awaitingSeats: [], pendingLoseInfluence: { seat: pending.actorSeat, reason: "challengeActionLost" }, lastEvent };
}

// ---------------------------------------------------------------------------
// blockWindow / blockChallengeWindow — §3-B / §4-2
// ---------------------------------------------------------------------------

function executeUnblockedAction(state: CoupState): CoupState {
  const pending = state.pendingAction!;

  if (pending.action === "foreignAid") {
    const players = state.players.map((p) => (p.seat === pending.actorSeat ? { ...p, coins: p.coins + 2 } : p));
    return endTurn({
      ...state,
      players,
      pendingAction: null,
      lastEvent: { type: "actionResolved", action: "foreignAid", actorSeat: pending.actorSeat, targetSeat: null, blocked: false },
    });
  }

  if (pending.action === "steal") {
    const target = getPlayer(state, pending.targetSeat!)!;
    const amount = Math.min(2, target.coins);
    const players = state.players.map((p) => {
      if (p.seat === pending.actorSeat) return { ...p, coins: p.coins + amount };
      if (p.seat === pending.targetSeat) return { ...p, coins: p.coins - amount };
      return p;
    });
    return endTurn({
      ...state,
      players,
      pendingAction: null,
      lastEvent: { type: "actionResolved", action: "steal", actorSeat: pending.actorSeat, targetSeat: pending.targetSeat, blocked: false, amount },
    });
  }

  // assassinate — lands, target loses an influence card.
  return { ...state, phase: "loseInfluence", pendingLoseInfluence: { seat: pending.targetSeat!, reason: "assassinateEffect" }, awaitingSeats: [] };
}

function declareBlock(state: CoupState, seat: SeatIndex, character: Character): CoupState {
  if (state.phase !== "blockWindow" || !state.awaitingSeats.includes(seat)) return state;
  const pending = state.pendingAction!;
  if (!BLOCK_CHARACTERS[pending.action].includes(character)) return state;
  return {
    ...state,
    phase: "blockChallengeWindow",
    pendingBlock: { blockerSeat: seat, claimedCharacter: character },
    awaitingSeats: aliveSeats(state).filter((s) => s !== seat),
    lastEvent: { type: "block", blockerSeat: seat, actorSeat: pending.actorSeat, character },
  };
}

function passBlockWindow(state: CoupState, seat: SeatIndex): CoupState {
  if (state.phase !== "blockWindow" || !state.awaitingSeats.includes(seat)) return state;
  const awaitingSeats = state.awaitingSeats.filter((s) => s !== seat);
  if (awaitingSeats.length > 0) return { ...state, awaitingSeats };
  return executeUnblockedAction({ ...state, awaitingSeats: [] });
}

function challengeBlock(state: CoupState, seat: SeatIndex): CoupState {
  if (state.phase !== "blockChallengeWindow" || !state.awaitingSeats.includes(seat)) return state;
  const block = state.pendingBlock!;
  const blocker = getPlayer(state, block.blockerSeat)!;
  const blockerHadCard = blocker.influence.some((c) => c.character === block.claimedCharacter);
  const lastEvent: LastEvent = {
    type: "challengeBlock",
    challengerSeat: seat,
    blockerSeat: block.blockerSeat,
    character: block.claimedCharacter,
    blockerHadCard,
  };
  if (blockerHadCard) {
    // §4-1 도전 실패 — challenger pays; the block stands once resolved.
    return { ...state, phase: "loseInfluence", awaitingSeats: [], pendingLoseInfluence: { seat, reason: "challengeBlockFailed_penalty" }, lastEvent };
  }
  // §4-2 "Double Kill" setup — the block was a bluff; the blocker pays, and (for 암살) the original action still lands afterward.
  return { ...state, phase: "loseInfluence", awaitingSeats: [], pendingLoseInfluence: { seat: block.blockerSeat, reason: "blockBluffCaught" }, lastEvent };
}

function passBlockChallengeWindow(state: CoupState, seat: SeatIndex): CoupState {
  if (state.phase !== "blockChallengeWindow" || !state.awaitingSeats.includes(seat)) return state;
  const awaitingSeats = state.awaitingSeats.filter((s) => s !== seat);
  if (awaitingSeats.length > 0) return { ...state, awaitingSeats };
  // Nobody disputed the block — it stands, and the original action is cancelled.
  const pending = state.pendingAction!;
  return endTurn({
    ...state,
    awaitingSeats: [],
    pendingAction: null,
    pendingBlock: null,
    lastEvent: { type: "actionResolved", action: pending.action, actorSeat: pending.actorSeat, targetSeat: pending.targetSeat, blocked: true },
  });
}

// ---------------------------------------------------------------------------
// pass / challenge — contextual dispatch by phase
// ---------------------------------------------------------------------------

function pass(state: CoupState, seat: SeatIndex, seed: number | undefined): CoupState {
  switch (state.phase) {
    case "actionChallengeWindow":
      return passActionChallenge(state, seat, seed);
    case "blockWindow":
      return passBlockWindow(state, seat);
    case "blockChallengeWindow":
      return passBlockChallengeWindow(state, seat);
    default:
      return state;
  }
}

function challenge(state: CoupState, seat: SeatIndex): CoupState {
  switch (state.phase) {
    case "actionChallengeWindow":
      return challengeAction(state, seat);
    case "blockChallengeWindow":
      return challengeBlock(state, seat);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// loseInfluence — §2 영향력 공개, §4-2 Double Kill chaining
// ---------------------------------------------------------------------------

function resolveAfterInfluenceLoss(state: CoupState, reason: LoseInfluenceReason, seed: number | undefined): CoupState {
  switch (reason) {
    case "coup":
    case "challengeActionLost":
    case "assassinateEffect":
      return endTurn({ ...state, pendingLoseInfluence: null, pendingAction: null, pendingBlock: null });

    case "challengeActionFailed_penalty": {
      const pending = state.pendingAction!;
      const replaced = replaceProvenCard(state, pending.actorSeat, pending.claimedCharacter!, seed);
      return proceedAfterClaimSurvives({ ...replaced, pendingLoseInfluence: null }, seed);
    }

    case "challengeBlockFailed_penalty": {
      const block = state.pendingBlock!;
      const replaced = replaceProvenCard(state, block.blockerSeat, block.claimedCharacter, seed);
      return endTurn({ ...replaced, pendingLoseInfluence: null, pendingAction: null, pendingBlock: null });
    }

    case "blockBluffCaught": {
      const pending = state.pendingAction!;
      const block = state.pendingBlock!;
      const blocker = getPlayer(state, block.blockerSeat)!;
      const cleared: CoupState = { ...state, pendingLoseInfluence: null, pendingBlock: null };

      if (pending.action === "assassinate") {
        // §4-2 Double Kill: the failed block only postponed the hit — it still lands, unless the
        // block-bluff penalty already eliminated the blocker (nothing left to reveal a second time).
        if (isAlive(blocker)) {
          return { ...cleared, phase: "loseInfluence", pendingLoseInfluence: { seat: block.blockerSeat, reason: "assassinateEffect" } };
        }
        return endTurn({ ...cleared, pendingAction: null });
      }

      if (pending.action === "foreignAid") {
        const players = cleared.players.map((p) => (p.seat === pending.actorSeat ? { ...p, coins: p.coins + 2 } : p));
        return endTurn({ ...cleared, players, pendingAction: null });
      }

      // steal
      const target = getPlayer(cleared, pending.targetSeat!)!;
      const amount = Math.min(2, target.coins);
      const players = cleared.players.map((p) => {
        if (p.seat === pending.actorSeat) return { ...p, coins: p.coins + amount };
        if (p.seat === pending.targetSeat) return { ...p, coins: p.coins - amount };
        return p;
      });
      return endTurn({ ...cleared, players, pendingAction: null });
    }
  }
}

function revealInfluence(state: CoupState, seat: SeatIndex, cardId: number, seed: number | undefined): CoupState {
  if (state.phase !== "loseInfluence") return state;
  const pending = state.pendingLoseInfluence;
  if (!pending || pending.seat !== seat) return state;
  const player = getPlayer(state, seat)!;
  const idx = player.influence.findIndex((c) => c.id === cardId);
  if (idx === -1) return state;
  const revealedCard = player.influence[idx];

  const players = state.players.map((p) =>
    p.seat === seat ? { ...p, influence: p.influence.filter((c) => c.id !== cardId), revealed: [...p.revealed, revealedCard] } : p,
  );
  const nowEliminated = players.find((p) => p.seat === seat)!.influence.length === 0;
  const eliminationOrder = nowEliminated ? [...state.eliminationOrder, seat] : state.eliminationOrder;

  const withReveal: CoupState = {
    ...state,
    players,
    eliminationOrder,
    lastEvent: { type: "influenceLost", seat, character: revealedCard.character, reason: pending.reason },
  };
  return resolveAfterInfluenceLoss(withReveal, pending.reason, seed);
}

// ---------------------------------------------------------------------------
// resolveExchange — 제상 교환
// ---------------------------------------------------------------------------

function resolveExchange(state: CoupState, seat: SeatIndex, keepCardIds: number[]): CoupState {
  if (state.phase !== "exchange") return state;
  const pending = state.pendingExchange;
  if (!pending || pending.seat !== seat) return state;
  if (keepCardIds.length !== pending.keepCount) return state;
  if (new Set(keepCardIds).size !== keepCardIds.length) return state;
  if (!keepCardIds.every((id) => pending.options.some((c) => c.id === id))) return state;

  const kept = pending.options.filter((c) => keepCardIds.includes(c.id));
  const returned = pending.options.filter((c) => !keepCardIds.includes(c.id));
  const players = state.players.map((p) => (p.seat === seat ? { ...p, influence: kept } : p));

  return endTurn({
    ...state,
    players,
    deck: [...state.deck, ...returned],
    pendingExchange: null,
    lastEvent: { type: "exchangeResolved", seat },
  });
}

// ---------------------------------------------------------------------------
// Single entry point
// ---------------------------------------------------------------------------

export function applyAction(state: CoupState, action: EngineAction): CoupState {
  switch (action.type) {
    case "declareAction":
      return declareAction(state, action.seat, action.action, action.targetSeat);
    case "declareBlock":
      return declareBlock(state, action.seat, action.character);
    case "challenge":
      return challenge(state, action.seat);
    case "pass":
      return pass(state, action.seat, action.seed);
    case "resolveExchange":
      return resolveExchange(state, action.seat, action.keepCardIds);
    case "revealInfluence":
      return revealInfluence(state, action.seat, action.cardId, action.seed);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Player view — hand secrecy projection
// ---------------------------------------------------------------------------

export interface VisiblePlayer {
  seat: SeatIndex;
  coins: number;
  influenceCount: number;
  /** Only populated for the viewer's own seat, or every seat once `phase === "gameOver"`. */
  influence: Card[] | null;
  revealed: Card[];
}

export interface CoupView {
  players: VisiblePlayer[];
  /** The 2-of-N exchange draw — only populated for the seat that owns the pending exchange. */
  pendingExchangeOptions: Card[] | null;
  /** How many of `pendingExchangeOptions` must be kept — exposed alongside it rather than left for the UI to re-derive from `influenceCount`. */
  pendingExchangeKeepCount: number | null;
}

export function getPlayerView(state: CoupState, viewerSeat: SeatIndex): CoupView {
  const revealAll = state.phase === "gameOver";
  const players: VisiblePlayer[] = state.players.map((p) => ({
    seat: p.seat,
    coins: p.coins,
    influenceCount: p.influence.length,
    influence: revealAll || p.seat === viewerSeat ? p.influence : null,
    revealed: p.revealed,
  }));
  const mine = state.pendingExchange && state.pendingExchange.seat === viewerSeat ? state.pendingExchange : null;
  return { players, pendingExchangeOptions: mine?.options ?? null, pendingExchangeKeepCount: mine?.keepCount ?? null };
}

// ---------------------------------------------------------------------------
// Final rankings
// ---------------------------------------------------------------------------

export interface RankedSeat {
  seat: SeatIndex;
  rank: number;
}

/** Only meaningful once `state.phase === "gameOver"`. Sudden-death elimination order gives a total order with no ties possible (§5). */
export function computeRankings(state: CoupState): RankedSeat[] {
  if (state.phase !== "gameOver") return [];
  const ranks: RankedSeat[] = [];
  if (state.winnerSeat !== null) ranks.push({ seat: state.winnerSeat, rank: 1 });
  [...state.eliminationOrder].reverse().forEach((seat, i) => ranks.push({ seat, rank: 2 + i }));
  return ranks;
}
