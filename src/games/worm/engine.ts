/**
 * Pure "지렁이" rules engine — no React, no I/O.
 *
 * ⚠️ Spec provenance (important, see HANDOFF.md for the full story): the only
 * rule document that actually exists at `boardGameRule/지렁이/지렁이.md` describes
 * a *completely different* game (a real-time Slither.io-style tail-cutting
 * action game). It does not match this engine at all. The task brief instead
 * spelled out — directly, in full — a turn-based dice/tile-collecting ruleset
 * that is a house-rule variant of the classic Reiner Knizia game "Heckmeck am
 * Bratwurmeck" / "Pickomino": 16 tiles numbered 21-36 (each worth 1-4 "worm"
 * icons), 8 special dice (faces 1-5 plus a "worm" face worth 5 pips), a
 * roll/keep/stop push-your-luck loop, and a tile-claim/steal/bust resolution.
 * This engine implements *that* brief literally (confirmed with the user via
 * AskUserQuestion before writing any code — the mismatched .md file was
 * deliberately not used as a source of truth). Every rule below is either
 * quoted directly from the brief or documented as a reasonable inference
 * where the brief left a gap.
 *
 * Same online-multiplayer trust model as every other game in this project:
 * every connected client computes and holds the FULL state from a shared RNG
 * seed plus replayed `EngineAction`s — there is no server authority.
 *
 * Documented inferences (brief didn't spell these out, filled in from the
 * classic game's own mechanics per the task brief's explicit permission to
 * do so):
 * - A player may voluntarily `stop` at any point after keeping at least one
 *   die group (not just once a worm has been kept) — the brief's "지렁이
 *   필수 포함 규칙" only gates whether a `stop` *succeeds* at claiming a tile,
 *   not whether `stop` itself is a legal action. Stopping without a kept
 *   worm die is simply a guaranteed bust (see `stop` below).
 * - Tile-claim precedence when the kept-dice sum doesn't exactly match a
 *   center tile: the brief only defines "정확히 일치 -> 중앙에서 가져오기",
 *   "정확히 일치하지 않으면 -> 중앙의 낮은 타일", and separately "상대 스택
 *   맨 위와 정확히 일치하면 뺏기". Since every tile number is unique
 *   game-wide (it's either in the center, on top of exactly one stack, or
 *   buried), this engine checks in order: (1) exact match in the center,
 *   (2) exact match against any *opponent's* top tile (steal), (3) the
 *   highest center tile strictly below the sum. A tile buried under other
 *   tiles in a stack (yours or an opponent's) is unreachable, same as if it
 *   didn't exist for this turn.
 * - Bust resolution ("실패 시: 내 타일 스택 맨 위의 타일을 중앙에 반납하고,
 *   중앙 타일 중 가장 높은 숫자 타일을 비공개 처리") is implemented
 *   *literally and unconditionally* exactly as written: both steps always
 *   run in order (return-own-top-tile, THEN flip-current-highest-center-
 *   tile) whenever a bust occurs, regardless of whether the player has a
 *   stack. This deliberately differs from the classic Pickomino rule (which
 *   is an "either/or": flip your own top tile OR, only if you have none,
 *   the center's highest) — the brief's wording has no "only if" branch, so
 *   a player who just returned their own tile to the center can watch it
 *   immediately become the new highest and get flipped right back out if
 *   nothing else in the center is higher. This is intentional, not a bug.
 * - Player count: the physical Pickomino box supports 2-7; nothing in the
 *   brief overrides that, so this engine keeps the same range.
 * - Starting player: picked deterministically from the shared seed, same
 *   convention as every other game in this project (Avalon/No
 *   Thanks/Perudo/...) — the brief doesn't specify a physical tiebreak.
 */

import { seededRng } from "@/lib/rng";
export { seededRng };

export type SeatIndex = number;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 7;
export const DICE_COUNT = 8;
export const TILE_MIN = 21;
export const TILE_MAX = 36;

/** 1-5 are plain pips; the 6th die face is the "지렁이"(worm) face, worth 5 pips toward the sum but also the mandatory ingredient for a valid claim. */
export type PipFace = 1 | 2 | 3 | 4 | 5;
export type Face = PipFace | "worm";

/** Sum contribution of each face — the worm face counts as a 5, same as the highest pip face. */
export const FACE_VALUE: Record<Face, number> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, worm: 5 };

export interface TileInfo {
  number: number;
  /** Worm-icon count printed on the tile — 21-24:1, 25-28:2, 29-32:3, 33-36:4 (standard Pickomino tile distribution). */
  worms: number;
}

function buildTiles(): TileInfo[] {
  const tiles: TileInfo[] = [];
  for (let n = TILE_MIN; n <= TILE_MAX; n++) {
    tiles.push({ number: n, worms: Math.floor((n - TILE_MIN) / 4) + 1 });
  }
  return tiles;
}

/** All 16 tiles (21-36), static — same data every game, only their location (center/removed/whose stack) changes. */
export const TILES: TileInfo[] = buildTiles();

export function wormsOnTile(tileNumber: number): number {
  return TILES.find((t) => t.number === tileNumber)?.worms ?? 0;
}

export function sumKept(dice: Face[]): number {
  return dice.reduce((sum, f) => sum + FACE_VALUE[f], 0);
}

/** Narrative of the most recently resolved turn — purely for the UI's flourish/toast, never read by the engine itself. */
export type TurnEvent =
  | { kind: "claimed"; seat: SeatIndex; tileNumber: number }
  | { kind: "stolen"; seat: SeatIndex; tileNumber: number; fromSeat: SeatIndex }
  | { kind: "bustedNoWorm"; seat: SeatIndex; sum: number; returnedTile: number | null; removedTile: number | null }
  | { kind: "bustedNoClaimTarget"; seat: SeatIndex; sum: number; returnedTile: number | null; removedTile: number | null }
  | { kind: "bustedNoMoves"; seat: SeatIndex; returnedTile: number | null; removedTile: number | null };

export interface WormState {
  playerCount: number;
  /** Tile numbers currently face-up and claimable in the center. */
  centerTiles: number[];
  /** Tile numbers permanently flipped face-down (removed from play forever) by a bust. */
  removedTiles: number[];
  /** Each seat's claimed tiles, oldest first — the LAST entry is the visible top of that stack. */
  stacks: Record<SeatIndex, number[]>;
  activeSeat: SeatIndex;
  /** The current turn's most recent roll, awaiting a `keep` choice. Empty once resolved (or before the first roll of the turn). */
  currentRoll: Face[];
  /** Dice not yet rolled-and-kept this turn; the next `roll` rolls exactly this many. */
  diceRemaining: number;
  /** Every die kept so far this turn, across all keeps. */
  keptDice: Face[];
  /** Face values already chosen via `keep` this turn — cannot be chosen again (rule: "한 번 킵한 숫자는 해당 턴 동안 다시 선택할 수 없음"). */
  usedFaces: Face[];
  turnNumber: number;
  phase: "rolling" | "gameOver";
  /** Set only once `phase` is "gameOver". More than one seat when tied on total worms. */
  winnerSeats: SeatIndex[] | null;
  lastEvent: TurnEvent | null;
}

export type EngineAction =
  | { type: "roll"; seat: SeatIndex; seed: number }
  | { type: "keep"; seat: SeatIndex; face: Face }
  | { type: "stop"; seat: SeatIndex };

function rollOneDie(rng: () => number): Face {
  const r = 1 + Math.floor(rng() * 6);
  return r === 6 ? "worm" : (r as PipFace);
}

function rollDice(rng: () => number, count: number): Face[] {
  return Array.from({ length: count }, () => rollOneDie(rng));
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function startGame(playerCount: number, seed: number): WormState {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`Unsupported player count: ${playerCount}`);
  }
  const rng = seededRng(seed);
  const stacks: Record<SeatIndex, number[]> = {};
  for (let seat = 0; seat < playerCount; seat++) stacks[seat] = [];
  const starter = Math.floor(rng() * playerCount);

  return {
    playerCount,
    centerTiles: TILES.map((t) => t.number),
    removedTiles: [],
    stacks,
    activeSeat: starter,
    currentRoll: [],
    diceRemaining: DICE_COUNT,
    keptDice: [],
    usedFaces: [],
    turnNumber: 1,
    phase: "rolling",
    winnerSeats: null,
    lastEvent: null,
  };
}

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

export function totalWorms(state: WormState, seat: SeatIndex): number {
  return (state.stacks[seat] ?? []).reduce((sum, n) => sum + wormsOnTile(n), 0);
}

/** Which seat currently owns `tileNumber` (anywhere in their stack, not just the top), or null if it's face-up in the center or already removed. UI-only helper (e.g. rendering "누구 스택에 가 있는지" for a slot that's neither in the center nor removed). */
export function ownerOfTile(state: WormState, tileNumber: number): SeatIndex | null {
  for (let seat = 0; seat < state.playerCount; seat++) {
    if (state.stacks[seat]?.includes(tileNumber)) return seat;
  }
  return null;
}

type ClaimTarget = { kind: "center"; number: number } | { kind: "steal"; number: number; fromSeat: SeatIndex };

/** See module doc's "Documented inferences" §2 for the precedence this implements. */
function findClaimTarget(state: WormState, seat: SeatIndex, sum: number): ClaimTarget | null {
  if (state.centerTiles.includes(sum)) return { kind: "center", number: sum };
  for (let other = 0; other < state.playerCount; other++) {
    if (other === seat) continue;
    const stack = state.stacks[other];
    if (stack.length > 0 && stack[stack.length - 1] === sum) {
      return { kind: "steal", number: sum, fromSeat: other };
    }
  }
  const lower = state.centerTiles.filter((n) => n < sum);
  if (lower.length === 0) return null;
  return { kind: "center", number: Math.max(...lower) };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function roll(state: WormState, seat: SeatIndex, seed: number): WormState {
  if (state.phase !== "rolling" || seat !== state.activeSeat) return state;
  if (state.diceRemaining <= 0 || state.currentRoll.length > 0) return state;

  const rng = seededRng(seed);
  const rolled = rollDice(rng, state.diceRemaining);
  const distinctFaces = Array.from(new Set(rolled));
  const anyKeepable = distinctFaces.some((f) => !state.usedFaces.includes(f));
  // Rule: "굴린 주사위 눈금들이 이미 모두 킵한 숫자라 더 이상 선택할 수 없는 경우" — forced bust, no `keep` is possible on this roll.
  if (!anyKeepable) return bust(state, seat, "bustedNoMoves");

  return { ...state, currentRoll: rolled };
}

function keep(state: WormState, seat: SeatIndex, face: Face): WormState {
  if (state.phase !== "rolling" || seat !== state.activeSeat) return state;
  if (state.currentRoll.length === 0) return state;
  if (state.usedFaces.includes(face)) return state; // rule: can't re-pick an already-kept number this turn
  const matching = state.currentRoll.filter((f) => f === face);
  if (matching.length === 0) return state;

  return {
    ...state,
    currentRoll: [],
    diceRemaining: state.diceRemaining - matching.length,
    keptDice: [...state.keptDice, ...matching],
    usedFaces: [...state.usedFaces, face],
  };
}

function stop(state: WormState, seat: SeatIndex): WormState {
  if (state.phase !== "rolling" || seat !== state.activeSeat) return state;
  if (state.currentRoll.length > 0) return state; // must `keep` (or already forced-bust) before stopping
  if (state.usedFaces.length === 0) return state; // nothing kept yet — nothing to stop with

  const sum = sumKept(state.keptDice);
  // Rule: "지렁이 필수 포함 규칙" — a stop without any kept worm die is a guaranteed bust.
  if (!state.keptDice.includes("worm")) return bust(state, seat, "bustedNoWorm", sum);

  const target = findClaimTarget(state, seat, sum);
  if (!target) return bust(state, seat, "bustedNoClaimTarget", sum);

  let centerTiles = state.centerTiles;
  let stacks = state.stacks;
  let event: TurnEvent;
  if (target.kind === "center") {
    centerTiles = centerTiles.filter((n) => n !== target.number);
    stacks = { ...stacks, [seat]: [...stacks[seat], target.number] };
    event = { kind: "claimed", seat, tileNumber: target.number };
  } else {
    stacks = {
      ...stacks,
      [target.fromSeat]: stacks[target.fromSeat].slice(0, -1),
      [seat]: [...stacks[seat], target.number],
    };
    event = { kind: "stolen", seat, tileNumber: target.number, fromSeat: target.fromSeat };
  }
  return advanceTurn({ ...state, centerTiles, stacks, lastEvent: event });
}

/**
 * Literal, unconditional two-step bust resolution — see module doc's
 * "Documented inferences" §3 for why this doesn't branch on whether the
 * player has a stack to return from.
 */
function bust(
  state: WormState,
  seat: SeatIndex,
  kind: "bustedNoWorm" | "bustedNoClaimTarget" | "bustedNoMoves",
  sum?: number,
): WormState {
  let centerTiles = state.centerTiles;
  let stacks = state.stacks;

  let returnedTile: number | null = null;
  const myStack = stacks[seat];
  if (myStack.length > 0) {
    returnedTile = myStack[myStack.length - 1];
    stacks = { ...stacks, [seat]: myStack.slice(0, -1) };
    centerTiles = [...centerTiles, returnedTile];
  }

  let removedTile: number | null = null;
  if (centerTiles.length > 0) {
    removedTile = Math.max(...centerTiles);
    centerTiles = centerTiles.filter((n) => n !== removedTile);
  }

  const event: TurnEvent =
    kind === "bustedNoMoves"
      ? { kind, seat, returnedTile, removedTile }
      : { kind, seat, sum: sum!, returnedTile, removedTile };

  return advanceTurn({
    ...state,
    centerTiles,
    stacks,
    removedTiles: removedTile !== null ? [...state.removedTiles, removedTile] : state.removedTiles,
    lastEvent: event,
  });
}

/** Resets per-turn scratch state and hands off to the next seat, or ends the game once the center is exhausted (rule: "중앙 타일이 모두 소진되면 게임이 종료"). */
function advanceTurn(state: WormState): WormState {
  if (state.centerTiles.length === 0) {
    return {
      ...state,
      phase: "gameOver",
      winnerSeats: computeWinners(state),
      currentRoll: [],
      diceRemaining: 0,
      keptDice: [],
      usedFaces: [],
    };
  }
  return {
    ...state,
    activeSeat: (state.activeSeat + 1) % state.playerCount,
    currentRoll: [],
    diceRemaining: DICE_COUNT,
    keptDice: [],
    usedFaces: [],
    turnNumber: state.turnNumber + 1,
  };
}

function computeWinners(state: WormState): SeatIndex[] {
  let best = -1;
  let winners: SeatIndex[] = [];
  for (let seat = 0; seat < state.playerCount; seat++) {
    const worms = totalWorms(state, seat);
    if (worms > best) {
      best = worms;
      winners = [seat];
    } else if (worms === best) {
      winners.push(seat);
    }
  }
  return winners;
}

/** Single entry point applying any `EngineAction` to a state — the whole engine as one reducer. */
export function applyAction(state: WormState, action: EngineAction): WormState {
  switch (action.type) {
    case "roll":
      return roll(state, action.seat, action.seed);
    case "keep":
      return keep(state, action.seat, action.face);
    case "stop":
      return stop(state, action.seat);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Final rankings
// ---------------------------------------------------------------------------

export interface RankedSeat {
  seat: SeatIndex;
  rank: number;
  worms: number;
}

/** Only meaningful once `state.phase === "gameOver"`. Ties (same total worm count) share a rank, same competition-ranking convention as five-cucumbers/century. */
export function computeRankings(state: WormState): RankedSeat[] {
  const scored = Array.from({ length: state.playerCount }, (_, seat) => ({ seat, worms: totalWorms(state, seat) }));
  const sorted = [...scored].sort((a, b) => b.worms - a.worms);
  const ranked: RankedSeat[] = [];
  let rank = 1;
  sorted.forEach((entry, i) => {
    if (i > 0 && sorted[i - 1].worms !== entry.worms) rank = i + 1;
    ranked.push({ seat: entry.seat, rank, worms: entry.worms });
  });
  return ranked;
}
