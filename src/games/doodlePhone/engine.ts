/**
 * 그림 전화기 (갈틱폰 스타일 텔레스트레이션) — pure rules engine.
 * Rulebook: boardGameRule/갈틱폰/갈틱폰.md (§ numbers below refer to it).
 *
 * ## Why this reducer looks different from the turn-based games
 *
 * Every other lockstep game here has one writer at a time, so actions reach
 * every client in the same order. Here all N players submit simultaneously,
 * and Supabase Realtime does not guarantee that two different senders'
 * messages arrive in the same order on every device. So this engine is built
 * so that **the final state only depends on the set of actions received,
 * never on their order** (rulebook §7):
 *
 * - A submission targets a (album, turn) slot and succeeds iff that slot is
 *   empty. It is not gated on "the current turn" — a client that is one
 *   message behind must still accept a neighbour's next-turn page.
 * - `TIMEOUT` (host only) names the seats the host had not heard from; their
 *   slots are overwritten with fallback content and stay locked, so a late
 *   submission is rejected on every device alike.
 * - The current turn and the game phase are never stored — they are derived
 *   from which slots are filled (docs/architecture.md §1.4, no derived state).
 *
 * `mergeStates` relies on the same property to fold a reconnect snapshot
 * into local state instead of blindly replacing it.
 *
 * Time is not part of the engine at all: each client runs its own countdown
 * from when it saw a turn open, and only the host decides a timeout.
 *
 * Game modes (rulebook §9) only change *which* kind each turn is, how long it
 * lasts and how the previous page is presented — all table-driven from
 * modes.ts. Routing, submission and timeout rules are identical in every mode.
 */

import { seededRng } from "@/lib/rng";
import { EMPTY_DRAWING, isValidDrawing, type Drawing } from "./drawing";
import { DEFAULT_OPTIONS, openingChoices, sanitizeOptions, turnKindFor, turnSecondsFor, type GameOptions, type PageKind } from "./modes";
import { FALLBACK_PROMPTS } from "./prompts";

export type { GameMode, GameOptions, PageKind } from "./modes";

export type SeatIndex = number;

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 14;
export const TEXT_MIN_CHARS = 2;
export const TEXT_MAX_CHARS = 35;
/** A single viewer may react to a single page at most this many times. */
export const MAX_REACTIONS_PER_PAGE = 3;
/** Extra wait the host grants past the visible 0s before force-closing a turn. */
export const TIMEOUT_GRACE_MS = 4_000;

export const REACTION_EMOJIS = ["😂", "🤯", "👏", "❤️", "🤔"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

interface PageBase {
  readonly author: SeatIndex;
  /** True when the engine filled this slot because the author never submitted. */
  readonly auto: boolean;
}
export interface TextPage extends PageBase {
  readonly kind: "text";
  readonly text: string;
}
export interface DrawingPage extends PageBase {
  readonly kind: "drawing";
  readonly drawing: Drawing;
}
export type Page = TextPage | DrawingPage;

export interface ShowcaseCursor {
  /** Album currently on stage; `playerCount` means every album is done. */
  readonly album: number;
  /** How many of that album's pages are revealed (0 = only the cover). */
  readonly revealed: number;
}

export type ReactionTally = Partial<Record<ReactionEmoji, number>>;

export interface DoodlePhoneState {
  readonly playerCount: number;
  readonly seed: number;
  readonly options: GameOptions;
  /** `albums[owner][turn - 1]` — album `owner` is the one seat `owner` started. */
  readonly albums: readonly (readonly (Page | null)[])[];
  /** Turns the host force-closed → seats whose slot got fallback content. */
  readonly timeouts: Readonly<Record<number, readonly SeatIndex[]>>;
  readonly showcase: ShowcaseCursor;
  /** Keyed by `pageKey(album, turn)`. */
  readonly reactions: Readonly<Record<string, ReactionTally>>;
  /** Keyed by `reactionUseKey(album, turn, seat)` — enforces MAX_REACTIONS_PER_PAGE. */
  readonly reactionUse: Readonly<Record<string, number>>;
  /** Score mode: `voteKey(album, seat)` → the turn that seat voted best in that album. */
  readonly votes: Readonly<Record<string, number>>;
}

export type EngineAction =
  | { type: "SUBMIT_TEXT"; seat: SeatIndex; turn: number; text: string }
  | { type: "SUBMIT_DRAWING"; seat: SeatIndex; turn: number; drawing: Drawing }
  | { type: "TIMEOUT"; turn: number; seats: SeatIndex[] }
  | { type: "SHOWCASE_NEXT"; from: ShowcaseCursor }
  | { type: "REACT"; seat: SeatIndex; album: number; turn: number; emoji: ReactionEmoji }
  | { type: "VOTE"; seat: SeatIndex; album: number; turn: number };

export type GamePhase = "turns" | "showcase" | "finished";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function startGame(playerCount: number, seed: number, options: Partial<GameOptions> = DEFAULT_OPTIONS): DoodlePhoneState {
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > MAX_PLAYERS) {
    throw new Error(`doodle-phone: unsupported player count ${playerCount}`);
  }
  return {
    playerCount,
    seed,
    options: sanitizeOptions(options),
    albums: Array.from({ length: playerCount }, () => Array<Page | null>(playerCount).fill(null)),
    timeouts: {},
    showcase: { album: 0, revealed: 0 },
    reactions: {},
    reactionUse: {},
    votes: {},
  };
}

// ---------------------------------------------------------------------------
// Routing (rulebook §3)
// ---------------------------------------------------------------------------

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Album seat `seat` works on during `turn` (1-based): (i − t + 1) mod N. */
export function albumFor(playerCount: number, seat: SeatIndex, turn: number): number {
  return mod(seat - turn + 1, playerCount);
}

/** Seat that holds album `album` during `turn`: (k + t − 1) mod N. */
export function receiverOf(playerCount: number, album: number, turn: number): SeatIndex {
  return mod(album + turn - 1, playerCount);
}

export function turnKind(state: DoodlePhoneState, turn: number): PageKind {
  return turnKindFor(state.options.mode, turn, state.playerCount);
}

export function turnDurationMs(state: DoodlePhoneState, turn: number): number {
  return turnSecondsFor(state.options, turn, state.playerCount) * 1000;
}

// ---------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------

export function pageAt(state: DoodlePhoneState, album: number, turn: number): Page | null {
  return state.albums[album]?.[turn - 1] ?? null;
}

/** The slot `seat` fills during `turn`, or null once already filled. */
export function slotFor(state: DoodlePhoneState, seat: SeatIndex, turn: number): Page | null {
  return pageAt(state, albumFor(state.playerCount, seat, turn), turn);
}

export function isTurnClosed(state: DoodlePhoneState, turn: number): boolean {
  if (state.timeouts[turn]) return true;
  return state.albums.every((album) => album[turn - 1] !== null);
}

/** An album's drawing pages in order — the frames of an animation-mode flipbook. */
export function albumDrawings(state: DoodlePhoneState, album: number): Drawing[] {
  return (state.albums[album] ?? []).flatMap((page) => (page?.kind === "drawing" ? [page.drawing] : []));
}

/** First turn still open, or `playerCount + 1` once every turn is closed. */
export function currentTurn(state: DoodlePhoneState): number {
  for (let t = 1; t <= state.playerCount; t++) {
    if (!isTurnClosed(state, t)) return t;
  }
  return state.playerCount + 1;
}

export function gamePhase(state: DoodlePhoneState): GamePhase {
  if (currentTurn(state) <= state.playerCount) return "turns";
  return state.showcase.album >= state.playerCount ? "finished" : "showcase";
}

export function hasSubmitted(state: DoodlePhoneState, seat: SeatIndex, turn: number): boolean {
  return slotFor(state, seat, turn) !== null;
}

/** Seats that still owe a page for the current turn. Empty outside the turn phase. */
export function pendingSeats(state: DoodlePhoneState): SeatIndex[] {
  const turn = currentTurn(state);
  if (turn > state.playerCount) return [];
  return Array.from({ length: state.playerCount }, (_, s) => s).filter((s) => !hasSubmitted(state, s, turn));
}

/**
 * What `seat` is shown while working on `turn`: only the previous page of
 * the album it holds (rulebook §3 정보 격리). `undefined` means the page
 * exists in principle but has not reached this client yet.
 */
export function promptFor(state: DoodlePhoneState, seat: SeatIndex, turn: number): Page | null | undefined {
  if (turn <= 1) return null;
  return pageAt(state, albumFor(state.playerCount, seat, turn), turn - 1) ?? undefined;
}

/** How many turns in a row (ending at the latest closed turn) `seat` was auto-filled by a timeout. */
export function consecutiveTimeouts(state: DoodlePhoneState, seat: SeatIndex): number {
  let run = 0;
  for (let t = Math.min(currentTurn(state) - 1, state.playerCount); t >= 1; t--) {
    if (!state.timeouts[t]?.includes(seat)) break;
    run++;
  }
  return run;
}

// ---------------------------------------------------------------------------
// Text rules (rulebook §4)
// ---------------------------------------------------------------------------

export function normalizeText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function textLength(text: string): number {
  return Array.from(text).length;
}

export function isValidText(raw: string): boolean {
  const n = textLength(normalizeText(raw));
  return n >= TEXT_MIN_CHARS && n <= TEXT_MAX_CHARS;
}

/** Deterministic per slot, so every client injects the identical fallback. */
export function fallbackPrompt(seed: number, album: number, turn: number): string {
  const rng = seededRng((seed ^ Math.imul(album + 1, 0x9e3779b1) ^ Math.imul(turn, 0x85ebca6b)) >>> 0);
  return FALLBACK_PROMPTS[Math.floor(rng() * FALLBACK_PROMPTS.length)];
}

function fallbackPage(state: DoodlePhoneState, seat: SeatIndex, turn: number): Page {
  const album = albumFor(state.playerCount, seat, turn);
  // A themed opening falls back to the first of that album's offered choices, so it stays on theme.
  const themed = turn === 1 ? openingChoices(state.options, state.seed, album)[0] : undefined;
  return turnKind(state, turn) === "text"
    ? { kind: "text", author: seat, auto: true, text: themed ?? fallbackPrompt(state.seed, album, turn) }
    : { kind: "drawing", author: seat, auto: true, drawing: EMPTY_DRAWING };
}

// ---------------------------------------------------------------------------
// Showcase (rulebook §6)
// ---------------------------------------------------------------------------

export function nextShowcaseCursor(state: DoodlePhoneState): ShowcaseCursor {
  const { album, revealed } = state.showcase;
  if (revealed < state.playerCount) return { album, revealed: revealed + 1 };
  return { album: album + 1, revealed: 0 };
}

export function pageKey(album: number, turn: number): string {
  return `${album}:${turn}`;
}

function reactionUseKey(album: number, turn: number, seat: SeatIndex): string {
  return `${album}:${turn}:${seat}`;
}

export function reactionsLeft(state: DoodlePhoneState, seat: SeatIndex, album: number, turn: number): number {
  return MAX_REACTIONS_PER_PAGE - (state.reactionUse[reactionUseKey(album, turn, seat)] ?? 0);
}

export function reactionTotal(tally: ReactionTally | undefined): number {
  if (!tally) return 0;
  return Object.values(tally).reduce((sum, n) => sum + (n ?? 0), 0);
}

export function voteKey(album: number, seat: SeatIndex): string {
  return `${album}:${seat}`;
}

/** The turn `seat` voted best in `album` (score mode), or null. */
export function voteOf(state: DoodlePhoneState, album: number, seat: SeatIndex): number | null {
  return state.votes[voteKey(album, seat)] ?? null;
}

/** Best-page votes a page received. */
export function votesFor(state: DoodlePhoneState, album: number, turn: number): number {
  let n = 0;
  for (let seat = 0; seat < state.playerCount; seat++) if (voteOf(state, album, seat) === turn) n++;
  return n;
}

/**
 * Points per seat for pages it authored — best-page votes in score mode,
 * reactions otherwise. A slot's author is always `receiverOf(album, turn)`
 * (fallback pages included), so this never depends on a page having arrived.
 */
export function playerScores(state: DoodlePhoneState): number[] {
  const scores = Array<number>(state.playerCount).fill(0);
  for (let album = 0; album < state.playerCount; album++) {
    for (let turn = 1; turn <= state.playerCount; turn++) {
      const author = receiverOf(state.playerCount, album, turn);
      scores[author] += state.options.mode === "SCORE" ? votesFor(state, album, turn) : reactionTotal(state.reactions[pageKey(album, turn)]);
    }
  }
  return scores;
}

/** Standard competition ranking by `playerScores` (rank 1 = 웃음왕 / 최다 득표); ties share a rank. */
export function computeRankings(state: DoodlePhoneState): { seat: SeatIndex; rank: number; score: number }[] {
  const scores = playerScores(state);
  const ordered = scores.map((score, seat) => ({ seat, score })).sort((a, b) => b.score - a.score || a.seat - b.seat);
  return ordered.map((entry) => ({ ...entry, rank: 1 + ordered.filter((o) => o.score > entry.score).length }));
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function isSeat(state: DoodlePhoneState, seat: unknown): seat is SeatIndex {
  return typeof seat === "number" && Number.isInteger(seat) && seat >= 0 && seat < state.playerCount;
}

function isTurn(state: DoodlePhoneState, turn: unknown): turn is number {
  return typeof turn === "number" && Number.isInteger(turn) && turn >= 1 && turn <= state.playerCount;
}

function withPage(state: DoodlePhoneState, album: number, turn: number, page: Page): DoodlePhoneState {
  return {
    ...state,
    albums: state.albums.map((pages, a) => (a === album ? pages.map((p, i) => (i === turn - 1 ? page : p)) : pages)),
  };
}

function isLockedByTimeout(state: DoodlePhoneState, seat: SeatIndex, turn: number): boolean {
  return state.timeouts[turn]?.includes(seat) ?? false;
}

function submit(state: DoodlePhoneState, seat: SeatIndex, turn: number, page: Page): DoodlePhoneState {
  if (hasSubmitted(state, seat, turn) || isLockedByTimeout(state, seat, turn)) return state;
  return withPage(state, albumFor(state.playerCount, seat, turn), turn, page);
}

export function applyAction(state: DoodlePhoneState, action: EngineAction): DoodlePhoneState {
  switch (action.type) {
    case "SUBMIT_TEXT": {
      if (!isSeat(state, action.seat) || !isTurn(state, action.turn) || turnKind(state, action.turn) !== "text") return state;
      if (typeof action.text !== "string" || !isValidText(action.text)) return state;
      return submit(state, action.seat, action.turn, {
        kind: "text",
        author: action.seat,
        auto: false,
        text: normalizeText(action.text),
      });
    }
    case "SUBMIT_DRAWING": {
      if (!isSeat(state, action.seat) || !isTurn(state, action.turn) || turnKind(state, action.turn) !== "drawing") return state;
      if (!isValidDrawing(action.drawing)) return state;
      return submit(state, action.seat, action.turn, { kind: "drawing", author: action.seat, auto: false, drawing: action.drawing });
    }
    case "TIMEOUT": {
      if (!isTurn(state, action.turn) || state.timeouts[action.turn] || !Array.isArray(action.seats)) return state;
      const seats = [...new Set(action.seats.filter((s) => isSeat(state, s)))].sort((a, b) => a - b);
      // Overwrite (not "fill if empty"): see the module doc — this is what
      // makes a submission racing the timeout resolve the same everywhere.
      let next: DoodlePhoneState = { ...state, timeouts: { ...state.timeouts, [action.turn]: seats } };
      for (const seat of seats) {
        next = withPage(next, albumFor(state.playerCount, seat, action.turn), action.turn, fallbackPage(state, seat, action.turn));
      }
      return next;
    }
    case "SHOWCASE_NEXT": {
      if (gamePhase(state) !== "showcase") return state;
      // Carries the cursor it was issued from, so a double-click or a
      // replayed message advances exactly once.
      if (action.from?.album !== state.showcase.album || action.from?.revealed !== state.showcase.revealed) return state;
      return { ...state, showcase: nextShowcaseCursor(state) };
    }
    case "REACT": {
      const { seat, album, turn, emoji } = action;
      if (!isSeat(state, seat) || !isSeat(state, album) || !isTurn(state, turn)) return state;
      if (!REACTION_EMOJIS.includes(emoji)) return state;
      // Own-page check via routing, not the page itself: the page may still be
      // in flight on this client, and the result must not depend on that.
      if (receiverOf(state.playerCount, album, turn) === seat) return state;
      if (reactionsLeft(state, seat, album, turn) <= 0) return state;
      const key = pageKey(album, turn);
      const tally = state.reactions[key] ?? {};
      return {
        ...state,
        reactions: { ...state.reactions, [key]: { ...tally, [emoji]: (tally[emoji] ?? 0) + 1 } },
        reactionUse: { ...state.reactionUse, [reactionUseKey(album, turn, seat)]: (state.reactionUse[reactionUseKey(album, turn, seat)] ?? 0) + 1 },
      };
    }
    case "VOTE": {
      const { seat, album, turn } = action;
      if (state.options.mode !== "SCORE" || !isSeat(state, seat) || !isSeat(state, album) || !isTurn(state, turn)) return state;
      if (receiverOf(state.playerCount, album, turn) === seat || voteOf(state, album, seat) !== null) return state;
      return { ...state, votes: { ...state.votes, [voteKey(album, seat)]: turn } };
    }
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Reconnect merge
// ---------------------------------------------------------------------------

function cursorRank(c: ShowcaseCursor, playerCount: number): number {
  return c.album * (playerCount + 1) + c.revealed;
}

function maxRecord(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, v);
  return out;
}

/**
 * Folds a `state-sync` snapshot into local state. Pages and timeouts are a
 * union (timeout fallbacks win, same as in the reducer); the showcase cursor
 * and reaction counters only move forward. Returns `local` untouched when the
 * snapshot belongs to a different match.
 */
export function mergeStates(local: DoodlePhoneState, incoming: DoodlePhoneState): DoodlePhoneState {
  if (local.seed !== incoming.seed || local.playerCount !== incoming.playerCount) return local;
  const timeouts: Record<number, readonly SeatIndex[]> = { ...incoming.timeouts, ...local.timeouts };
  let merged: DoodlePhoneState = {
    ...local,
    timeouts,
    albums: local.albums.map((pages, album) => pages.map((page, i) => page ?? incoming.albums[album]?.[i] ?? null)),
    showcase:
      cursorRank(incoming.showcase, local.playerCount) > cursorRank(local.showcase, local.playerCount) ? incoming.showcase : local.showcase,
    reactionUse: maxRecord(local.reactionUse, incoming.reactionUse),
    // One vote per (album, seat) and a seat never changes it, so a union is exact.
    votes: { ...incoming.votes, ...local.votes },
    reactions: Object.fromEntries(
      [...new Set([...Object.keys(local.reactions), ...Object.keys(incoming.reactions)])].map((key) => [
        key,
        maxRecord(local.reactions[key] ?? {}, incoming.reactions[key] ?? {}) as ReactionTally,
      ]),
    ),
  };
  for (const [turnStr, seats] of Object.entries(timeouts)) {
    const turn = Number(turnStr);
    for (const seat of seats) {
      merged = withPage(merged, albumFor(merged.playerCount, seat, turn), turn, fallbackPage(merged, seat, turn));
    }
  }
  return merged;
}
