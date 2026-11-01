/**
 * 별빛 러미 (Star Rummy) — an original numbered-tile rummy for 2~4 players.
 *
 * Tiles: 4 star colours × numbers 1~12 × 2 copies (96) + 2 혜성 wilds = 98.
 * Each round everyone gets 13 tiles; three tiles lie face up in the 관측소
 * (observatory) next to the face-down pool. On your turn you either
 *   - commit a new table: every meld valid, at least one tile from your hand,
 *     nothing taken back off the table (free rearranging once you've opened), or
 *   - draw one tile — a face-up observatory tile or a blind pool tile.
 * Your first commit (첫 관측) must be melds made only from your own hand worth
 * ≥ OPENING_MIN, and can't touch the melds already on the table.
 * The round ends when someone empties their hand (러미!), or when nothing is
 * left to draw and every seat passed in a row. Scores add up over 1~3 rounds.
 *
 * Lockstep like every other online room here (docs/cloud-sync.md): each client
 * replays the same actions from the same seed. Actions carry `turn` so a
 * duplicate/stale one (timer fired on two clients) is ignored.
 */
import { seededRng, shuffle } from "@/lib/rng";
import { tallyAdd, tallyMax, type StatTally } from "@/games/shared/statTally";

export type SeatIndex = number;
export type TileId = number;
export type StarColor = 0 | 1 | 2 | 3;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const MAX_NUM = 12;
export const HAND_SIZE = 13;
export const OBSERVATORY_SIZE = 3;
export const OPENING_MIN = 24;
export const WILD_PENALTY = 20;
export const TURN_MS = 90_000;
export const WILD_IDS: readonly TileId[] = [96, 97];
export const TILE_COUNT = 98;

export const COLOR_NAMES = ["루비", "사파이어", "황금", "에메랄드"] as const;
/** Shape per colour so the tiles read without colour (색각 이상). */
export const COLOR_SHAPES = ["●", "▲", "■", "◆"] as const;

export interface Tile {
  id: TileId;
  /** null = 혜성 (wild). */
  color: StarColor | null;
  /** 1~12, 0 for a wild. */
  num: number;
}

export function tileOf(id: TileId): Tile {
  if (id >= 96) return { id, color: null, num: 0 };
  return { id, color: Math.floor(id / 24) as StarColor, num: (id % 12) + 1 };
}

export const isWild = (id: TileId) => id >= 96;

/** Penalty value left in a hand at round end. */
export function penaltyOf(id: TileId): number {
  return isWild(id) ? WILD_PENALTY : tileOf(id).num;
}

// ---------------------------------------------------------------------------
// Melds
// ---------------------------------------------------------------------------

export interface MeldInfo {
  kind: "run" | "group";
  /** Tiles in display order (wilds where they stand). */
  ordered: TileId[];
  /** Number each tile stands for, same order as `ordered`. */
  values: number[];
  /** Sum of `values` — what counts toward the opening. */
  value: number;
}

/**
 * Reads a meld, or null when it's not valid. A run is 3~12 tiles of one colour
 * in consecutive numbers; a group is 3~4 tiles of one number in different
 * colours. Wilds stand in for anything; their meaning is re-read every time
 * (it isn't locked when they're laid down).
 */
export function analyzeMeld(ids: readonly TileId[]): MeldInfo | null {
  if (ids.length < 3) return null;
  const wilds = ids.filter(isWild);
  const reals = ids.filter((id) => !isWild(id)).map(tileOf);
  if (reals.length === 0) return null;
  const nums = new Set(reals.map((t) => t.num));
  if (nums.size === 1) {
    const group = readGroup(reals, wilds);
    if (group) return group;
    // a single real tile + wilds can also be a run (x, x+1, x+2)
  }
  return readRun(reals, wilds);
}

function readGroup(reals: Tile[], wilds: TileId[]): MeldInfo | null {
  const len = reals.length + wilds.length;
  if (len > 4) return null;
  const colors = new Set(reals.map((t) => t.color));
  if (colors.size !== reals.length) return null;
  const num = reals[0].num;
  const ordered = [...[...reals].sort((a, b) => (a.color ?? 0) - (b.color ?? 0)).map((t) => t.id), ...wilds];
  return { kind: "group", ordered, values: ordered.map(() => num), value: num * len };
}

function readRun(reals: Tile[], wilds: TileId[]): MeldInfo | null {
  const len = reals.length + wilds.length;
  if (len > MAX_NUM) return null;
  const color = reals[0].color;
  if (reals.some((t) => t.color !== color)) return null;
  const nums = reals.map((t) => t.num);
  if (new Set(nums).size !== nums.length) return null;
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  if (hi - lo + 1 > len) return null;
  // Wilds fill the gaps first, then extend upward, then downward.
  let extra = len - (hi - lo + 1);
  const up = Math.min(extra, MAX_NUM - hi);
  extra -= up;
  const start = lo - extra;
  if (start < 1) return null;
  const byNum = new Map(reals.map((t) => [t.num, t.id]));
  const pool = [...wilds];
  const ordered: TileId[] = [];
  const values: number[] = [];
  for (let n = start; n < start + len; n++) {
    ordered.push(byNum.get(n) ?? pool.shift()!);
    values.push(n);
  }
  return { kind: "run", ordered, values, value: values.reduce((a, b) => a + b, 0) };
}

export const isValidMeld = (ids: readonly TileId[]) => analyzeMeld(ids) !== null;

/** Display order for a meld (unchanged when invalid). */
export function orderMeld(ids: readonly TileId[]): TileId[] {
  return analyzeMeld(ids)?.ordered ?? [...ids];
}

/** Rack order: by colour then number ("color") or by number then colour ("number"). Wilds last. */
export function sortHand(ids: readonly TileId[], by: "color" | "number" = "color"): TileId[] {
  return [...ids].sort((a, b) => {
    const ta = tileOf(a);
    const tb = tileOf(b);
    if (isWild(a) !== isWild(b)) return isWild(a) ? 1 : -1;
    if (by === "number") return ta.num - tb.num || (ta.color ?? 0) - (tb.color ?? 0) || a - b;
    return (ta.color ?? 0) - (tb.color ?? 0) || ta.num - tb.num || a - b;
  });
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type Phase = "playing" | "roundEnd" | "gameOver";

export type LastEvent =
  | { seq: number; kind: "meld"; seat: SeatIndex; played: TileId[]; opened: boolean; rearranged: boolean }
  | { seq: number; kind: "draw"; seat: SeatIndex; from: "pool" | "observatory"; tile: TileId | null; timeout: boolean }
  | { seq: number; kind: "pass"; seat: SeatIndex; timeout: boolean }
  | { seq: number; kind: "out"; seat: SeatIndex; played: TileId[] };

export interface RoundResult {
  round: number;
  /** Who emptied their hand, or null when the round ran dry. */
  outSeat: SeatIndex | null;
  winners: SeatIndex[];
  /** Hands left at the end (shown face up). */
  hands: TileId[][];
  penalties: number[];
  delta: number[];
}

export interface StarRummyState {
  playerCount: number;
  seed: number;
  totalRounds: number;
  round: number;
  phase: Phase;
  hands: TileId[][];
  table: TileId[][];
  pool: TileId[];
  observatory: TileId[];
  opened: boolean[];
  starter: SeatIndex;
  active: SeatIndex;
  /** Bumps on every turn change — actions name the turn they're for. */
  turn: number;
  /** Bumps on every applied action (state-sync stale guard). */
  seq: number;
  /** Seats in a row that passed with nothing left to draw. */
  passStreak: number;
  scores: number[];
  results: RoundResult[];
  lastEvent: LastEvent | null;
  statTally?: StatTally;
}

export type EngineAction =
  | { type: "commit"; seat: SeatIndex; turn: number; table: TileId[][] }
  | { type: "draw"; seat: SeatIndex; turn: number; from: "pool" | number }
  | { type: "timeout"; seat: SeatIndex; turn: number }
  | { type: "nextRound"; round: number };

export function isStateSyncStale(current: StarRummyState | null, synced: StarRummyState): boolean {
  if (!current) return false;
  if (synced.seed !== current.seed) return false;
  return synced.seq < current.seq;
}

function dealRound(base: Omit<StarRummyState, "hands" | "table" | "pool" | "observatory" | "opened" | "active" | "passStreak" | "lastEvent">): StarRummyState {
  const rng = seededRng(base.seed + base.round * 7919);
  const bag = shuffle(
    Array.from({ length: TILE_COUNT }, (_, i) => i),
    rng,
  );
  const hands = Array.from({ length: base.playerCount }, () => bag.splice(0, HAND_SIZE));
  const observatory = bag.splice(0, OBSERVATORY_SIZE);
  return {
    ...base,
    hands,
    table: [],
    pool: bag,
    observatory,
    opened: Array.from({ length: base.playerCount }, () => false),
    active: base.starter,
    passStreak: 0,
    lastEvent: null,
  };
}

export function startGame(playerCount: number, seed: number, totalRounds = 2): StarRummyState {
  const count = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, playerCount));
  const rng = seededRng(seed);
  return dealRound({
    playerCount: count,
    seed,
    totalRounds: Math.max(1, Math.min(3, totalRounds)),
    round: 1,
    phase: "playing",
    starter: Math.floor(rng() * count),
    turn: 0,
    seq: 0,
    scores: Array.from({ length: count }, () => 0),
    results: [],
    statTally: {},
  });
}

// ---------------------------------------------------------------------------
// Commit validation
// ---------------------------------------------------------------------------

export type CommitCheck =
  | { ok: true; played: TileId[]; openingValue: number; rearranged: boolean }
  | { ok: false; reason: string; invalidMelds: number[]; openingValue: number; played: TileId[] };

const sameMeld = (a: readonly TileId[], b: readonly TileId[]) => a.length === b.length && [...a].sort((x, y) => x - y).every((v, i) => v === [...b].sort((x, y) => x - y)[i]);

/**
 * Whether `seat` may replace the table with `next` this turn. Also used by the
 * board for the live draft check (reasons are shown to the player).
 */
export function checkCommit(state: StarRummyState, seat: SeatIndex, next: readonly (readonly TileId[])[]): CommitCheck {
  const melds = next.filter((m) => m.length > 0);
  const flat = melds.flat();
  const before = new Set(state.table.flat());
  const hand = new Set(state.hands[seat] ?? []);
  const played = flat.filter((id) => !before.has(id));
  const invalidMelds = melds.map((m, i) => (isValidMeld(m) ? -1 : i)).filter((i) => i >= 0);
  const fail = (reason: string, openingValue = 0): CommitCheck => ({ ok: false, reason, invalidMelds, openingValue, played });

  if (new Set(flat).size !== flat.length) return fail("같은 타일이 두 번 들어갔어요");
  const after = new Set(flat);
  for (const id of before) if (!after.has(id)) return fail("테이블의 타일은 손으로 가져올 수 없어요");
  if (played.some((id) => !hand.has(id))) return fail("내 손에 없는 타일이에요");

  let openingValue = 0;
  const opened = state.opened[seat];
  if (!opened) {
    // Old melds must stay exactly as they were; new melds only from my hand.
    const fresh = [...melds];
    for (const old of state.table) {
      const idx = fresh.findIndex((m) => sameMeld(m, old));
      if (idx < 0) return fail("첫 관측 전에는 테이블의 조합을 건드릴 수 없어요");
      fresh.splice(idx, 1);
    }
    openingValue = fresh.reduce((sum, m) => sum + (analyzeMeld(m)?.value ?? 0), 0);
  }
  if (played.length === 0) return fail("손에서 타일을 1장 이상 내려놓아야 해요", openingValue);
  if (invalidMelds.length > 0) return fail(`올바르지 않은 조합이 ${invalidMelds.length}개 있어요`, openingValue);
  if (!opened && openingValue < OPENING_MIN) return fail(`첫 관측은 합계 ${OPENING_MIN}점 이상 (지금 ${openingValue}점)`, openingValue);

  const rearranged = opened && state.table.some((old) => !melds.some((m) => sameMeld(m, old)));
  return { ok: true, played, openingValue, rearranged };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function advanceTurn(state: StarRummyState): StarRummyState {
  return { ...state, active: (state.active + 1) % state.playerCount, turn: state.turn + 1 };
}

const nothingToDraw = (s: StarRummyState) => s.pool.length === 0 && s.observatory.length === 0;

function endRound(state: StarRummyState, outSeat: SeatIndex | null): StarRummyState {
  const penalties = state.hands.map((h) => h.reduce((sum, id) => sum + penaltyOf(id), 0));
  let winners: SeatIndex[];
  let delta: number[];
  if (outSeat !== null) {
    winners = [outSeat];
    delta = penalties.map((p, seat) => (seat === outSeat ? 0 : -p));
    delta[outSeat] = penalties.reduce((a, b) => a + b, 0);
  } else {
    // Ran dry: the lowest hand wins; everyone else loses the difference.
    const low = Math.min(...penalties);
    winners = penalties.map((p, seat) => (p === low ? seat : -1)).filter((s) => s >= 0);
    delta = penalties.map((p) => -(p - low));
    const pot = -delta.reduce((a, b) => a + b, 0);
    for (const w of winners) delta[w] = Math.floor(pot / winners.length);
  }
  let statTally = state.statTally;
  for (const w of winners) statTally = tallyAdd(statTally, w, "roundsWon");
  if (outSeat !== null) statTally = tallyAdd(statTally, outSeat, "rummyOuts");
  const result: RoundResult = { round: state.round, outSeat, winners, hands: state.hands.map((h) => sortHand(h)), penalties, delta };
  const scores = state.scores.map((s, i) => s + delta[i]);
  return {
    ...state,
    scores,
    results: [...state.results, result],
    phase: state.round >= state.totalRounds ? "gameOver" : "roundEnd",
    statTally,
  };
}

function applyDraw(state: StarRummyState, seat: SeatIndex, from: "pool" | number, timeout: boolean): StarRummyState {
  const seq = state.seq + 1;
  if (nothingToDraw(state)) {
    const passed: StarRummyState = { ...state, seq, passStreak: state.passStreak + 1, lastEvent: { seq, kind: "pass", seat, timeout } };
    if (passed.passStreak >= state.playerCount) return endRound(passed, null);
    return advanceTurn(passed);
  }
  let pool = state.pool;
  let observatory = state.observatory;
  let tile: TileId;
  let source: "pool" | "observatory" = "pool";
  if (typeof from === "number" && observatory[from] !== undefined) {
    tile = observatory[from];
    source = "observatory";
    observatory = observatory.filter((_, i) => i !== from);
    if (pool.length > 0) {
      observatory = [...observatory.slice(0, from), pool[0], ...observatory.slice(from)];
      pool = pool.slice(1);
    }
  } else if (pool.length > 0) {
    tile = pool[0];
    pool = pool.slice(1);
  } else {
    // pool empty — take the first observatory tile instead
    tile = observatory[0];
    source = "observatory";
    observatory = observatory.slice(1);
  }
  const hands = state.hands.map((h, i) => (i === seat ? [...h, tile] : h));
  let statTally = tallyAdd(state.statTally, seat, "draws");
  if (source === "observatory") statTally = tallyAdd(statTally, seat, "observatoryPicks");
  return advanceTurn({
    ...state,
    hands,
    pool,
    observatory,
    seq,
    passStreak: 0,
    statTally,
    lastEvent: { seq, kind: "draw", seat, from: source, tile: source === "observatory" ? tile : null, timeout },
  });
}

function applyCommit(state: StarRummyState, seat: SeatIndex, next: TileId[][]): StarRummyState {
  const check = checkCommit(state, seat, next);
  if (!check.ok) return state;
  const playedSet = new Set(check.played);
  const hands = state.hands.map((h, i) => (i === seat ? h.filter((id) => !playedSet.has(id)) : h));
  const table = next.filter((m) => m.length > 0).map(orderMeld);
  const seq = state.seq + 1;
  const firstOpen = !state.opened[seat];
  let statTally = tallyAdd(state.statTally, seat, "tilesPlayed", check.played.length);
  statTally = tallyMax(statTally, seat, "maxTurnTiles", check.played.length);
  if (check.rearranged) statTally = tallyAdd(statTally, seat, "rearranges");
  const wildsPlayed = check.played.filter(isWild).length;
  if (wildsPlayed) statTally = tallyAdd(statTally, seat, "wildsPlayed", wildsPlayed);
  const after: StarRummyState = {
    ...state,
    hands,
    table,
    opened: state.opened.map((o, i) => (i === seat ? true : o)),
    seq,
    passStreak: 0,
    statTally,
    lastEvent:
      hands[seat].length === 0
        ? { seq, kind: "out", seat, played: check.played }
        : { seq, kind: "meld", seat, played: check.played, opened: firstOpen, rearranged: check.rearranged },
  };
  if (hands[seat].length === 0) return endRound(after, seat);
  return advanceTurn(after);
}

export function applyAction(state: StarRummyState, action: EngineAction): StarRummyState {
  if (action.type === "nextRound") {
    if (state.phase !== "roundEnd" || action.round !== state.round) return state;
    return dealRound({
      ...state,
      round: state.round + 1,
      phase: "playing",
      starter: (state.starter + 1) % state.playerCount,
      turn: state.turn + 1,
      seq: state.seq + 1,
    });
  }
  if (state.phase !== "playing" || action.seat !== state.active || action.turn !== state.turn) return state;
  switch (action.type) {
    case "commit":
      return applyCommit(state, action.seat, action.table);
    case "draw":
      return applyDraw(state, action.seat, action.from, false);
    case "timeout":
      return applyDraw(state, action.seat, "pool", true);
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function currentActor(state: StarRummyState): SeatIndex | null {
  return state.phase === "playing" ? state.active : null;
}

export function handValue(ids: readonly TileId[]): number {
  return ids.reduce((sum, id) => sum + penaltyOf(id), 0);
}

export interface RankedSeat {
  seat: SeatIndex;
  rank: number;
  score: number;
}

/** Final standings by total score (ties share a rank; fewer tiles left in the last round breaks nothing — ties stay ties). */
export function computeRankings(state: StarRummyState): RankedSeat[] {
  const order = state.scores.map((score, seat) => ({ seat, score })).sort((a, b) => b.score - a.score || a.seat - b.seat);
  return order.map((o) => ({ ...o, rank: order.findIndex((x) => x.score === o.score) + 1 }));
}
