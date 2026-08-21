/**
 * Pure "소환사의 협곡" (Summoner's Rift — a League of Legends-themed parody of
 * "맨덤의 던전" / "Welcome to the Dungeon") rules engine — no React, no I/O.
 * Implements `boardGameRule/소환사의 협곡/소환사의 협곡.md`: a shared-hero
 * push-your-luck bluffing game. Every turn a player either feeds a secretly
 * drawn monster into the shared "Rift pile" or strips one of the 6 shared
 * item/skill cards off the hero (hiding the drawn monster instead), or
 * passes out of the round entirely. The last player who hasn't passed is
 * forced to challenge the Rift alone with whatever items remain equipped —
 * first to 2 successful clears wins, 2 failed clears eliminates a player.
 *
 * Same online-multiplayer trust model as every other game in this project:
 * every connected client computes and holds the FULL state (including the
 * remaining draw deck and the face-down Rift pile's contents) from a shared
 * RNG seed plus replayed `EngineAction`s — there is no server authority (see
 * docs/architecture.md §2). The *identity* of a just-drawn card is only
 * meant to be secret from other *players*, not from the engine (every client
 * must hold it to keep the reducer deterministic) — enforced at the UI layer
 * only, same technique bang/avalon/five-cucumbers already use (see
 * `SummonersRiftBoard.tsx`).
 *
 * Two interpretation calls not pinned down by the rulebook (documented here
 * per this project's standing rule — see HANDOFF.md "작업 규칙" — rather than
 * silently inventing them):
 * 1. **Player count range.** The rulebook never states min/max players (it
 *    only fixes the 13-card monster deck and 6-item set). This engine caps
 *    it at 2-6, matching this project's other push-your-luck/bluffing games
 *    (five-cucumbers, no-thanks) and staying sane against a 13-card deck —
 *    at 7+ players many rounds would end with an empty deck forcing instant
 *    passes before anyone gets a real turn.
 * 2. **Who starts the next round.** §3 only says the *first* round's starting
 *    player is picked "임의의 방법으로" (arbitrarily). This engine rotates to
 *    the next still-active seat clockwise after each round's starting seat —
 *    the same "rotate the dealer" convention every physical card game with
 *    repeated rounds uses, and consistent with how this project already
 *    handles multi-round games without an explicit rulebook rule for it.
 */

import { seededRng, shuffle } from "@/lib/rng";
export { seededRng };

export type SeatIndex = number;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const BASE_HP = 3;
export const SUCCESS_TOKENS_TO_WIN = 2;
export const FAILURE_TOKENS_TO_ELIMINATE = 2;

// ---------------------------------------------------------------------------
// Static game data (rulebook §2)
// ---------------------------------------------------------------------------

export type ItemId = 1 | 2 | 3 | 4 | 5 | 6;

export interface ItemDef {
  id: ItemId;
  name: string;
  originName: string;
  effect: string;
  /** HP granted while equipped (rulebook §2-B: 루비 수정 +3, 자벨 +5). 0 for non-HP items. */
  hpBonus: number;
  /** Monster threat values this item auto-kills for free, statically (rulebook §2-B table). Empty for 황금 뒤집개, whose target is chosen per-challenge (see `spatulaDeclaredThreat`). */
  kills: number[];
  isGoldenSpatula?: boolean;
}

export const ITEM_CATALOG: ItemDef[] = [
  { id: 1, name: "루비 수정", originName: "방패", effect: "챔피언의 체력(HP) +3 증가", hpBonus: 3, kills: [] },
  { id: 2, name: "자벨", originName: "갑옷", effect: "챔피언의 체력(HP) +5 증가", hpBonus: 5, kills: [] },
  {
    id: 3,
    name: "시비르 스펠쉴드",
    originName: "성배",
    effect: "제드(2), 블라디(4), 사신 카서스(6)를 데미지 없이 즉시 처치",
    hpBonus: 0,
    kills: [2, 4, 6],
  },
  {
    id: 4,
    name: "람머스 웅크리기",
    originName: "횃불",
    effect: "대포미니언(1), 제드(2), 사이온(3)을 데미지 없이 즉시 처치",
    hpBonus: 0,
    kills: [1, 2, 3],
  },
  {
    id: 5,
    name: "황금 뒤집개",
    originName: "용사의 검",
    effect: "협곡 공략 시작 전 몬스터 1종류를 지정. 해당 몬스터는 등장 시 데미지 없이 즉시 처치",
    hpBonus: 0,
    kills: [],
    isGoldenSpatula: true,
  },
  { id: 6, name: "강타", originName: "창", effect: "장로드래곤(9)을 데미지 없이 즉시 처치", hpBonus: 0, kills: [9] },
];

export function getItemDef(id: ItemId): ItemDef {
  return ITEM_CATALOG.find((i) => i.id === id)!;
}

export interface MonsterDef {
  threat: number;
  name: string;
  originName: string;
  copies: number;
}

export const MONSTER_CATALOG: MonsterDef[] = [
  { threat: 1, name: "대포미니언", originName: "고블린", copies: 2 },
  { threat: 2, name: "제드", originName: "해골전사", copies: 2 },
  { threat: 3, name: "사이온", originName: "오크", copies: 2 },
  { threat: 4, name: "블라디", originName: "뱀파이어", copies: 2 },
  { threat: 5, name: "빙하의 말파이트", originName: "골렘", copies: 2 },
  { threat: 6, name: "사신 카서스", originName: "사신(리치)", copies: 1 },
  { threat: 7, name: "재의 기사 모데카이저", originName: "마왕(데몬)", copies: 1 },
  { threat: 9, name: "장로드래곤", originName: "드래곤", copies: 1 },
];

export function getMonsterDef(threat: number): MonsterDef {
  return MONSTER_CATALOG.find((m) => m.threat === threat)!;
}

export const MONSTER_DECK_SIZE = MONSTER_CATALOG.reduce((sum, m) => sum + m.copies, 0); // 13

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface MonsterCard {
  /** `${threat}-${copyIndex}`, unique within one round's 13-card deck. */
  id: string;
  threat: number;
}

export interface PlayerState {
  seat: SeatIndex;
  successTokens: number;
  failureTokens: number;
  eliminated: boolean;
  /** Passed out of the current round already — reset every `dealRound`. */
  passed: boolean;
  /** How many drawn monsters this seat has hidden away via item removal this round — UI/flavor only, not itself consulted by any rule. */
  hiddenCardCount: number;
  /** Which items (in removal order) this seat personally stripped off the shared champion this round — reset every `dealRound` alongside `hiddenCardCount`, which its length always equals. UI-only (task brief §2's "누가 어떤 장비를 뺐는지" ownership overlay); no rule ever reads it. */
  removedItemIds: ItemId[];
}

export type Phase = "bidding" | "declaringSpatula" | "resolvingRift" | "gameOver";

export interface CombatLogEntry {
  monster: MonsterCard;
  /** What neutralized it, if anything. */
  killedBy: { itemId: ItemId } | { spatula: true } | null;
  damageTaken: number;
  hpAfter: number;
}

export interface RoundResult {
  roundNumber: number;
  challengerSeat: SeatIndex;
  outcome: "success" | "failure";
  equippedItemIds: ItemId[];
  totalHp: number;
  spatulaDeclaredThreat: number | null;
  combatLog: CombatLogEntry[];
  newlyEliminated: boolean;
}

export interface SummonersRiftState {
  playerCount: number;
  players: PlayerState[];
  roundNumber: number;
  /** Items still attached to the shared champion this round — subset of [1..6]. */
  equippedItemIds: ItemId[];
  /** Face-down draw pile, index 0 = top. */
  deck: MonsterCard[];
  /** Face-down accumulation pile fed by "카드 뽑기 → 협곡에 집어넣기", index 0 = top (most recently pushed — see module doc's stacking convention). Revealed top-down during the dungeon phase. */
  riftPile: MonsterCard[];
  /** Set the instant a seat draws, cleared once they resolve it (push or unequip). Only that seat may act while it's set. */
  pendingDraw: { seat: SeatIndex; card: MonsterCard } | null;
  /** Whose turn during "bidding"; the lone challenger's seat during "declaringSpatula"/"resolvingRift". */
  activeSeat: SeatIndex;
  /** This round's starting seat — carried forward so `dealRound` can rotate it for the next round. */
  roundStartSeat: SeatIndex;
  challengerSeat: SeatIndex | null;
  totalHp: number | null;
  currentHp: number | null;
  spatulaDeclaredThreat: number | null;
  combatLog: CombatLogEntry[];
  lastRoundResult: RoundResult | null;
  phase: Phase;
  winnerSeat: SeatIndex | null;
  initialSeed: number;
}

export type EngineAction =
  | { type: "drawCard"; seat: SeatIndex }
  | { type: "pushToRift"; seat: SeatIndex }
  | { type: "removeItem"; seat: SeatIndex; itemId: ItemId }
  | { type: "pass"; seat: SeatIndex }
  | { type: "declareSpatula"; seat: SeatIndex; monsterThreat: number }
  | { type: "revealNextMonster"; seat: SeatIndex };

// ---------------------------------------------------------------------------
// Deck construction
// ---------------------------------------------------------------------------

/** The full 13-card monster deck (rulebook §2-C): one entry per copy of every threat value. */
export function buildMonsterDeck(): MonsterCard[] {
  const deck: MonsterCard[] = [];
  for (const def of MONSTER_CATALOG) {
    for (let copy = 0; copy < def.copies; copy++) {
      deck.push({ id: `${def.threat}-${copy}`, threat: def.threat });
    }
  }
  return deck;
}

function findPlayer(state: SummonersRiftState, seat: SeatIndex): PlayerState {
  return state.players.find((p) => p.seat === seat)!;
}

function activeSeats(players: PlayerState[]): SeatIndex[] {
  return players.filter((p) => !p.eliminated).map((p) => p.seat);
}

function nextActiveSeat(players: PlayerState[], from: SeatIndex): SeatIndex {
  const count = players.length;
  let s = (from + 1) % count;
  let guard = 0;
  while (players[s].eliminated && guard < count) {
    s = (s + 1) % count;
    guard++;
  }
  return s;
}

/** Next seat, among active + not-yet-passed seats, clockwise from `from` (exclusive). */
function nextUnpassedSeat(players: PlayerState[], from: SeatIndex): SeatIndex | null {
  const count = players.length;
  let s = (from + 1) % count;
  let guard = 0;
  while (guard < count) {
    const p = players[s];
    if (!p.eliminated && !p.passed) return s;
    s = (s + 1) % count;
    guard++;
  }
  return null;
}

export function computeTotalHp(equippedItemIds: ItemId[]): number {
  return BASE_HP + equippedItemIds.reduce((sum, id) => sum + getItemDef(id).hpBonus, 0);
}

/** Can any currently-equipped item (or the declared spatula target) kill this monster for free? */
export function findKiller(
  equippedItemIds: ItemId[],
  spatulaDeclaredThreat: number | null,
  monsterThreat: number,
): { itemId: ItemId } | { spatula: true } | null {
  if (spatulaDeclaredThreat === monsterThreat && equippedItemIds.includes(5)) return { spatula: true };
  const item = equippedItemIds.find((id) => id !== 5 && getItemDef(id).kills.includes(monsterThreat));
  return item ? { itemId: item as ItemId } : null;
}

// ---------------------------------------------------------------------------
// Round dealing
// ---------------------------------------------------------------------------

/** Deals a fresh round: reshuffles a brand-new 13-card monster deck, re-equips all 6 items, clears the Rift pile, and resets every active seat's "passed" flag. */
function dealRound(state: SummonersRiftState, startSeat: SeatIndex): SummonersRiftState {
  const roundNumber = state.roundNumber + 1;
  // Distinct offset per round so consecutive rounds don't reuse the same
  // shuffle, while staying purely a function of shared state (no extra
  // network round-trip needed to keep every client's RNG in lockstep) — same
  // convention as five-cucumbers' `dealRound`.
  const rng = seededRng(state.initialSeed + roundNumber * 104729);
  const deck = shuffle(buildMonsterDeck(), rng);

  const players = state.players.map((p) => (p.eliminated ? p : { ...p, passed: false, hiddenCardCount: 0, removedItemIds: [] }));

  return {
    ...state,
    players,
    roundNumber,
    equippedItemIds: [1, 2, 3, 4, 5, 6],
    deck,
    riftPile: [],
    pendingDraw: null,
    activeSeat: startSeat,
    roundStartSeat: startSeat,
    challengerSeat: null,
    totalHp: null,
    currentHp: null,
    spatulaDeclaredThreat: null,
    combatLog: [],
    phase: "bidding",
  };
}

export function startGame(playerCount: number, seed: number): SummonersRiftState {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`Unsupported player count: ${playerCount}`);
  }
  const players: PlayerState[] = Array.from({ length: playerCount }, (_, seat) => ({
    seat,
    successTokens: 0,
    failureTokens: 0,
    eliminated: false,
    passed: false,
    hiddenCardCount: 0,
    removedItemIds: [],
  }));
  const rng = seededRng(seed);
  const startSeat = Math.floor(rng() * playerCount);
  const base: SummonersRiftState = {
    playerCount,
    players,
    roundNumber: 0,
    equippedItemIds: [1, 2, 3, 4, 5, 6],
    deck: [],
    riftPile: [],
    pendingDraw: null,
    activeSeat: startSeat,
    roundStartSeat: startSeat,
    challengerSeat: null,
    totalHp: null,
    currentHp: null,
    spatulaDeclaredThreat: null,
    combatLog: [],
    lastRoundResult: null,
    phase: "bidding",
    winnerSeat: null,
    initialSeed: seed,
  };
  return dealRound(base, startSeat);
}

// ---------------------------------------------------------------------------
// Bidding phase (rulebook §4, [1단계])
// ---------------------------------------------------------------------------

function drawCard(state: SummonersRiftState, seat: SeatIndex): SummonersRiftState {
  if (state.phase !== "bidding" || state.activeSeat !== seat || state.pendingDraw !== null) return state;
  const player = findPlayer(state, seat);
  if (player.eliminated || player.passed || state.deck.length === 0) return state;

  const [card, ...rest] = state.deck;
  return { ...state, deck: rest, pendingDraw: { seat, card } };
}

function pushToRift(state: SummonersRiftState, seat: SeatIndex): SummonersRiftState {
  if (state.phase !== "bidding" || state.pendingDraw?.seat !== seat) return state;
  const riftPile = [state.pendingDraw.card, ...state.riftPile];
  const advanced = { ...state, riftPile, pendingDraw: null };
  return advanceBiddingTurn(advanced, seat);
}

function removeItem(state: SummonersRiftState, seat: SeatIndex, itemId: ItemId): SummonersRiftState {
  if (state.phase !== "bidding" || state.pendingDraw?.seat !== seat) return state;
  if (!state.equippedItemIds.includes(itemId)) return state;

  const equippedItemIds = state.equippedItemIds.filter((id) => id !== itemId);
  const players = state.players.map((p) =>
    p.seat === seat ? { ...p, hiddenCardCount: p.hiddenCardCount + 1, removedItemIds: [...p.removedItemIds, itemId] } : p,
  );
  const advanced = { ...state, equippedItemIds, players, pendingDraw: null };
  return advanceBiddingTurn(advanced, seat);
}

/** Moves the turn to the next active+unpassed seat after `seat` resolves a draw. Never triggers a phase change — passing is the only action that can end the bidding phase. */
function advanceBiddingTurn(state: SummonersRiftState, seat: SeatIndex): SummonersRiftState {
  const next = nextUnpassedSeat(state.players, seat);
  // `seat` itself hasn't passed, so there is always at least one unpassed
  // seat (itself) to fall back on if everyone else already passed.
  return { ...state, activeSeat: next ?? seat };
}

function pass(state: SummonersRiftState, seat: SeatIndex): SummonersRiftState {
  if (state.phase !== "bidding" || state.activeSeat !== seat || state.pendingDraw !== null) return state;
  const player = findPlayer(state, seat);
  if (player.eliminated || player.passed) return state;

  const players = state.players.map((p) => (p.seat === seat ? { ...p, passed: true } : p));
  const remaining = players.filter((p) => !p.eliminated && !p.passed);

  if (remaining.length === 1) {
    return enterDungeon({ ...state, players }, remaining[0].seat);
  }
  const next = nextUnpassedSeat(players, seat);
  // remaining.length >= 2 here, so an unpassed seat other than `seat` always exists.
  return { ...state, players, activeSeat: next ?? seat };
}

// ---------------------------------------------------------------------------
// Dungeon phase (rulebook §4, [2단계])
// ---------------------------------------------------------------------------

function enterDungeon(state: SummonersRiftState, challengerSeat: SeatIndex): SummonersRiftState {
  const totalHp = computeTotalHp(state.equippedItemIds);
  const withChallenger: SummonersRiftState = {
    ...state,
    challengerSeat,
    activeSeat: challengerSeat,
    totalHp,
    currentHp: totalHp,
    combatLog: [],
  };

  // Nothing to fight — trivially clears without needing a spatula declaration.
  if (withChallenger.riftPile.length === 0) {
    return finishRound({ ...withChallenger, phase: "resolvingRift" }, "success");
  }

  if (state.equippedItemIds.includes(5)) {
    return { ...withChallenger, phase: "declaringSpatula" };
  }
  return { ...withChallenger, phase: "resolvingRift" };
}

function declareSpatula(state: SummonersRiftState, seat: SeatIndex, monsterThreat: number): SummonersRiftState {
  if (state.phase !== "declaringSpatula" || state.challengerSeat !== seat) return state;
  if (!MONSTER_CATALOG.some((m) => m.threat === monsterThreat)) return state;
  return { ...state, spatulaDeclaredThreat: monsterThreat, phase: "resolvingRift" };
}

function revealNextMonster(state: SummonersRiftState, seat: SeatIndex): SummonersRiftState {
  if (state.phase !== "resolvingRift" || state.challengerSeat !== seat) return state;
  if (state.riftPile.length === 0 || state.currentHp === null) return state;

  const [monster, ...rest] = state.riftPile;
  const killer = findKiller(state.equippedItemIds, state.spatulaDeclaredThreat, monster.threat);
  const damageTaken = killer ? 0 : monster.threat;
  const hpAfter = state.currentHp - damageTaken;

  const entry: CombatLogEntry = { monster, killedBy: killer, damageTaken, hpAfter };
  const next: SummonersRiftState = {
    ...state,
    riftPile: rest,
    currentHp: hpAfter,
    combatLog: [...state.combatLog, entry],
  };

  if (hpAfter <= 0) return finishRound(next, "failure");
  if (rest.length === 0) return finishRound(next, "success");
  return next;
}

function finishRound(state: SummonersRiftState, outcome: "success" | "failure"): SummonersRiftState {
  const challengerSeat = state.challengerSeat!;
  let newlyEliminated = false;
  const players = state.players.map((p) => {
    if (p.seat !== challengerSeat) return p;
    if (outcome === "success") return { ...p, successTokens: p.successTokens + 1 };
    const failureTokens = p.failureTokens + 1;
    const eliminated = failureTokens >= FAILURE_TOKENS_TO_ELIMINATE;
    newlyEliminated = eliminated;
    return { ...p, failureTokens, eliminated };
  });

  const result: RoundResult = {
    roundNumber: state.roundNumber,
    challengerSeat,
    outcome,
    equippedItemIds: state.equippedItemIds,
    totalHp: state.totalHp!,
    spatulaDeclaredThreat: state.spatulaDeclaredThreat,
    combatLog: state.combatLog,
    newlyEliminated,
  };
  const settled: SummonersRiftState = { ...state, players, lastRoundResult: result };

  const challenger = players.find((p) => p.seat === challengerSeat)!;
  if (outcome === "success" && challenger.successTokens >= SUCCESS_TOKENS_TO_WIN) {
    return { ...settled, phase: "gameOver", winnerSeat: challengerSeat };
  }
  const survivors = activeSeats(players);
  if (survivors.length === 1) {
    return { ...settled, phase: "gameOver", winnerSeat: survivors[0] };
  }

  const nextStart = nextActiveSeat(players, state.roundStartSeat);
  return dealRound(settled, nextStart);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function applyAction(state: SummonersRiftState, action: EngineAction): SummonersRiftState {
  switch (action.type) {
    case "drawCard":
      return drawCard(state, action.seat);
    case "pushToRift":
      return pushToRift(state, action.seat);
    case "removeItem":
      return removeItem(state, action.seat, action.itemId);
    case "pass":
      return pass(state, action.seat);
    case "declareSpatula":
      return declareSpatula(state, action.seat, action.monsterThreat);
    case "revealNextMonster":
      return revealNextMonster(state, action.seat);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7 — every game exposes getValidMoves +
// chooseBotAction so a host client can drive a bot-occupied seat). Levels
// 1–10 route through the shared `pickByLevel` noise curve (botDifficulty.ts)
// on top of `scoreMove` below.
// ---------------------------------------------------------------------------

import { botTier, pickByLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";

/**
 * seat가 지금 제출할 수 있는 모든 합법 EngineAction — bidding/declaringSpatula/
 * resolvingRift 각 핸들러의 가드를 그대로 반영. A seat mid-`pendingDraw` can
 * only push or strip an item off; an active bidding seat with nothing
 * pending can only pass, plus draw if the deck isn't empty.
 */
export function getValidMoves(state: SummonersRiftState, seat: SeatIndex): EngineAction[] {
  if (state.phase === "bidding") {
    if (state.pendingDraw) {
      if (state.pendingDraw.seat !== seat) return [];
      const moves: EngineAction[] = [{ type: "pushToRift", seat }];
      for (const itemId of state.equippedItemIds) moves.push({ type: "removeItem", seat, itemId });
      return moves;
    }
    if (state.activeSeat !== seat) return [];
    const player = findPlayer(state, seat);
    if (player.eliminated || player.passed) return [];
    const moves: EngineAction[] = [{ type: "pass", seat }];
    if (state.deck.length > 0) moves.push({ type: "drawCard", seat });
    return moves;
  }
  if (state.phase === "declaringSpatula") {
    if (state.challengerSeat !== seat) return [];
    return MONSTER_CATALOG.map((m) => ({ type: "declareSpatula", seat, monsterThreat: m.threat }) satisfies EngineAction);
  }
  if (state.phase === "resolvingRift") {
    if (state.challengerSeat !== seat || state.riftPile.length === 0) return [];
    return [{ type: "revealNextMonster", seat }];
  }
  return [];
}

/**
 * Expected damage a random still-unseen monster deals under `equippedItemIds`
 * (0 if some equipped item auto-kills it), averaged over the FULL 13-card
 * catalog composition — legitimate public knowledge (the deck's contents are
 * common knowledge; which specific cards already left it is not, so this
 * deliberately does NOT read `state.deck`/`state.riftPile` identities, only
 * their public *counts* — info fairness, same principle as Coyote's
 * `estimateTotal`).
 */
function expectedDamagePerMonster(equippedItemIds: ItemId[]): number {
  const survivingDamageSum = MONSTER_CATALOG.reduce((sum, m) => {
    if (findKiller(equippedItemIds, null, m.threat)) return sum;
    return sum + m.threat * m.copies;
  }, 0);
  return survivingDamageSum / MONSTER_DECK_SIZE;
}

/** Current HP minus the expected total damage the Rift pile (its size is public, its contents are not) would deal if fought right now with the current equipment — positive = comfortably survivable on average, negative = expected to die. This is the "성공 확률" proxy the work order asks Level 8–10 to compute. */
function survivalMargin(state: SummonersRiftState): number {
  const totalHp = computeTotalHp(state.equippedItemIds);
  return totalHp - expectedDamagePerMonster(state.equippedItemIds) * state.riftPile.length;
}

/**
 * Core levels (4–7): a rough "pile is getting bigger than my item cushion"
 * proxy. Expert levels (8–10): the actual expected-damage survival margin —
 * "장비 체력/아이템 능력치와 덱 누적 데미지를 계산하여 성공 확률 100%에 가까울
 * 때만 진입" — pass hard once that margin goes negative, keep drawing while
 * it stays comfortably positive.
 */
function scorePassOrDraw(state: SummonersRiftState, isPass: boolean, deep: boolean): number {
  const signal = deep ? survivalMargin(state) : state.equippedItemIds.length - state.riftPile.length;
  return isPass ? -signal : signal;
}

function scorePendingDrawMove(state: SummonersRiftState, move: EngineAction): number {
  const card = state.pendingDraw!.card;
  if (move.type === "pushToRift") {
    const mitigated = findKiller(state.equippedItemIds, null, card.threat) !== null;
    return -(mitigated ? card.threat * 0.3 : card.threat);
  }
  if (move.type !== "removeItem") return 0;
  const item = getItemDef(move.itemId);
  const hidingBenefit = card.threat;
  const cost = item.hpBonus * 1.5 + item.kills.length * 2 + (item.isGoldenSpatula ? 3 : 0);
  return hidingBenefit - cost;
}

/** Prefers declaring the highest expected-value monster threat (threat × how common it is in the 13-card deck) that isn't already covered for free by another equipped item — a redundant declaration wastes the spatula's flexibility. */
function scoreDeclareSpatula(state: SummonersRiftState, move: Extract<EngineAction, { type: "declareSpatula" }>): number {
  const def = getMonsterDef(move.monsterThreat);
  const alreadyCovered = state.equippedItemIds.some((id) => id !== 5 && getItemDef(id).kills.includes(move.monsterThreat));
  const value = def.threat * (def.copies / MONSTER_DECK_SIZE);
  return alreadyCovered ? value * 0.1 : value;
}

function scoreMove(state: SummonersRiftState, move: EngineAction, level: BotLevel): number {
  const deep = botTier(level) === "expert";
  switch (move.type) {
    case "pass":
      return scorePassOrDraw(state, true, deep);
    case "drawCard":
      return scorePassOrDraw(state, false, deep);
    case "pushToRift":
    case "removeItem":
      return scorePendingDrawMove(state, move);
    case "declareSpatula":
      return scoreDeclareSpatula(state, move);
    case "revealNextMonster":
      return 0; // the only legal move whenever offered — never actually chosen among alternatives
    default:
      return 0;
  }
}

/** getValidMoves 중 level(1~10)에 맞는 액션을 고른다 — 점수 매기기+노이즈는 botDifficulty.ts의 공용 커브. seat가 지금 할 게 없으면 null. */
export function chooseBotAction(
  state: SummonersRiftState,
  seat: SeatIndex,
  level: BotLevel = 5,
  rng: () => number = Math.random,
): EngineAction | null {
  const moves = getValidMoves(state, seat);
  if (moves.length === 0) return null;
  const scored = moves.map((move) => ({ move, score: scoreMove(state, move, level) }));
  return pickByLevel(scored, level, rng);
}

// ---------------------------------------------------------------------------
// Final scoring
// ---------------------------------------------------------------------------

export interface RankedPlayer {
  seat: SeatIndex;
  rank: number;
  successTokens: number;
  failureTokens: number;
  eliminated: boolean;
}

/**
 * Only meaningful once `state.phase === "gameOver"`. `winnerSeat` always
 * ranks 1st alone (it may have won either by reaching 2 successes, or by
 * being the sole non-eliminated seat left — the latter case doesn't
 * necessarily give it the best success/failure tally, so it can't be derived
 * from sorting by score alone). Everyone else is ranked by
 * `successTokens*10 - failureTokens` descending (standard competition
 * ranking, ties share a rank).
 */
export function computeRankings(state: SummonersRiftState): RankedPlayer[] {
  if (state.phase !== "gameOver" || state.winnerSeat === null) return [];
  const score = (p: PlayerState) => p.successTokens * 10 - p.failureTokens;

  const winner = state.players.find((p) => p.seat === state.winnerSeat)!;
  const others = state.players.filter((p) => p.seat !== state.winnerSeat).sort((a, b) => score(b) - score(a));

  const ranked: RankedPlayer[] = [
    { seat: winner.seat, rank: 1, successTokens: winner.successTokens, failureTokens: winner.failureTokens, eliminated: winner.eliminated },
  ];
  let rank = 2;
  others.forEach((p, i) => {
    if (i > 0 && score(others[i - 1]) !== score(p)) rank = i + 2;
    ranked.push({ seat: p.seat, rank, successTokens: p.successTokens, failureTokens: p.failureTokens, eliminated: p.eliminated });
  });
  return ranked;
}
