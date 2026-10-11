/**
 * 텔레파시 (The Mind 스타일 실시간 협력 게임) — pure engine.
 *
 * Rules: boardGameRule/더마인드/더마인드_온라인판.md (the online-tailored
 * rulebook is the source of truth; the original-rules summary next to it is
 * reference only).
 *
 * ⚠️ Not lockstep. "Who played first" is the whole game, so the host is the
 * only authority (same model as worm/ink-duel realtime): clients send
 * intents, the host feeds them through `applyAction(state, action, now)` with
 * its own clock and advances timers with `tick(state, now)`, then broadcasts
 * the snapshot. Every timestamp in the state is the HOST's `Date.now()`;
 * clients correct for clock skew with the `hostNow` sent next to each
 * snapshot.
 *
 * Both functions return the SAME object when nothing changed, so the host can
 * broadcast on reference change only.
 *
 * Shuffles use the seeded `rngState` (no Math.random) so a seed always deals
 * the same hands — needed for the planned "오늘의 도전" mode and for tests.
 */

export type SeatIndex = number;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const CARD_MAX = 100;
export const MAX_LIVES = 5;
export const MAX_STARS = 3;

/** Per player count: last level, starting hearts, starting ⚡. 2–4 = original, 5–6 = online extension. */
export const SETUP: Record<number, { levels: number; lives: number; stars: number }> = {
  2: { levels: 12, lives: 2, stars: 1 },
  3: { levels: 10, lives: 3, stars: 1 },
  4: { levels: 8, lives: 4, stars: 1 },
  5: { levels: 7, lives: 5, stars: 1 },
  6: { levels: 6, lives: 5, stars: 1 },
};

/** Reward for clearing a level (granted unless it was the last level). */
export const REWARDS: Record<number, "star" | "life"> = { 2: "star", 3: "life", 5: "star", 6: "life", 8: "star", 9: "life" };

/** Lower card arriving within this window after another counts as played first (§5-4). */
export const GRACE_MS = 250;
/** A cluster of near-simultaneous plays is confirmed at most this long after its first card. */
export const GRACE_CAP_MS = 600;
/** Press-and-hold time to play a card (§5-2). Client-side; the host only sees the final play. */
export const HOLD_TO_PLAY_MS = 600;
/** Others only see your "reaching" glow after this much holding. */
export const REACH_VISIBLE_MS = 200;
/** Free hold cancels per level; after that each cancel locks the card for CANCEL_LOCK_MS. */
export const FREE_CANCELS = 3;
export const CANCEL_LOCK_MS = 2000;
export const SYNC_COUNTDOWN_MS = 3000;
/** Long enough to read "who played what, what was still held" (§6-2). */
export const MISTAKE_MS = 4800;
export const STAR_VOTE_MS = 8000;
export const STAR_REVEAL_MS = 2400;
export const STAR_COOLDOWN_MS = 10_000;
export const RESUME_MS = 1000;
export const BREAK_MS = 20_000;
export const RESYNC_PER_LEVEL = 2;

export type Phase = "sync" | "playing" | "mistake" | "starVote" | "starReveal" | "resume" | "break" | "won" | "lost";

export interface PileCard {
  card: number;
  seat: SeatIndex;
}

export interface Reveal {
  seat: SeatIndex;
  card: number;
}

export interface PendingPlay {
  card: number;
  seat: SeatIndex;
  receivedAt: number;
}

export type LogKind = "play" | "mistake" | "star";

/** Why the table is (re)syncing — shown on the sync screen. */
export type SyncReason =
  | { kind: "level" }
  | { kind: "resync"; seat: SeatIndex }
  | { kind: "mistake" }
  | { kind: "star" }
  | { kind: "away"; seats: SeatIndex[] };

/** One dot on the replay timeline (§12). `t` = ms since the level's first sync finished. */
export interface LogEntry {
  card: number;
  seat: SeatIndex;
  t: number;
  kind: LogKind;
}

export interface LevelLog {
  level: number;
  hands: number[][];
  entries: LogEntry[];
  mistakes: number;
  cleared: boolean;
}

export interface MindStats {
  levelsCleared: number;
  perfectLevels: number;
  mistakes: number;
  starsUsed: number;
  /** Clusters whose arrival order got fixed by the grace window (a saved mistake). */
  graceSaves: number;
}

export interface MindState {
  playerCount: number;
  practice: boolean;
  maxLevel: number;
  level: number;
  lives: number;
  stars: number;
  /** Each seat's cards, always sorted ascending. */
  hands: number[][];
  pile: PileCard[];
  discards: (Reveal & { reason: "mistake" | "star" })[];
  pending: PendingPlay[];
  clusterFirstAt: number;
  phase: Phase;
  /** Deadline of the current timed phase (countdown end in `sync`, null while not everyone holds). */
  phaseUntil: number | null;
  holds: boolean[];
  away: boolean[];
  reaching: boolean[];
  readies: boolean[];
  resyncUsed: number[];
  /** Host time the flow clock counts from (last confirmed card / level start). */
  flowStartAt: number;
  /** Set while the flow clock is frozen (⚡ vote / resume countdown). */
  pausedAt: number | null;
  /** Host time the current level's first sync finished; null until then. */
  levelStartedAt: number | null;
  starVote: { proposer: SeatIndex; yes: (boolean | null)[]; deadline: number } | null;
  starCooldownUntil: number;
  /** `prevTop` = pile top before the bad card landed (0 = empty pile). */
  lastMistake: { id: number; trigger: PileCard; revealed: Reveal[]; prevTop: number } | null;
  syncReason: SyncReason | null;
  lastStar: { id: number; revealed: Reveal[] } | null;
  /** Bumped on every visible event so clients can fire one-shot FX. */
  seq: number;
  levelMistakes: number;
  lastReward: { level: number; kind: "star" | "life"; granted: boolean } | null;
  stats: MindStats;
  log: LevelLog[];
  rngState: number;
}

export type MindAction =
  | { type: "hold"; seat: SeatIndex; on: boolean }
  | { type: "reach"; seat: SeatIndex; on: boolean }
  | { type: "play"; seat: SeatIndex; card: number }
  | { type: "resync"; seat: SeatIndex }
  | { type: "starPropose"; seat: SeatIndex }
  | { type: "starVote"; seat: SeatIndex; yes: boolean }
  | { type: "ready"; seat: SeatIndex }
  | { type: "away"; away: boolean[] };

// ---------------------------------------------------------------------------
// RNG + dealing
// ---------------------------------------------------------------------------

/** mulberry32 step: returns [value in [0,1), next state]. */
export function rngNext(state: number): [number, number] {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

function deal(playerCount: number, level: number, rngState: number): { hands: number[][]; rngState: number } {
  const deck = Array.from({ length: CARD_MAX }, (_, i) => i + 1);
  let s = rngState;
  for (let i = deck.length - 1; i > 0; i--) {
    const [r, n] = rngNext(s);
    s = n;
    const j = Math.floor(r * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const hands: number[][] = [];
  for (let seat = 0; seat < playerCount; seat++) {
    hands.push(deck.slice(seat * level, seat * level + level).sort((a, b) => a - b));
  }
  return { hands, rngState: s };
}

export function setupFor(playerCount: number) {
  return SETUP[Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, playerCount))];
}

export function createGame(playerCount: number, seed: number, now: number, opts: { practice?: boolean } = {}): MindState {
  const setup = setupFor(playerCount);
  const { hands, rngState } = deal(playerCount, 1, seed >>> 0);
  const falses = () => Array.from({ length: playerCount }, () => false);
  return {
    playerCount,
    practice: !!opts.practice,
    maxLevel: setup.levels,
    level: 1,
    lives: setup.lives,
    stars: setup.stars,
    hands,
    pile: [],
    discards: [],
    pending: [],
    clusterFirstAt: 0,
    phase: "sync",
    phaseUntil: null,
    holds: falses(),
    away: falses(),
    reaching: falses(),
    readies: falses(),
    resyncUsed: Array.from({ length: playerCount }, () => 0),
    flowStartAt: now,
    pausedAt: null,
    levelStartedAt: null,
    starVote: null,
    starCooldownUntil: 0,
    lastMistake: null,
    syncReason: { kind: "level" },
    lastStar: null,
    seq: 0,
    levelMistakes: 0,
    lastReward: null,
    stats: { levelsCleared: 0, perfectLevels: 0, mistakes: 0, starsUsed: 0, graceSaves: 0 },
    log: [{ level: 1, hands: hands.map((h) => [...h]), entries: [], mistakes: 0, cleared: false }],
    rngState,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function pileTop(state: MindState): number {
  return state.pile.length > 0 ? state.pile[state.pile.length - 1].card : 0;
}

export function cardsLeft(state: MindState): number {
  return state.hands.reduce((n, h) => n + h.length, 0);
}

export function isFinished(state: MindState): boolean {
  return state.phase === "won" || state.phase === "lost";
}

/** §11-1. Time is deliberately not part of it. */
export function computeScore(state: MindState): number {
  let score = 0;
  for (const lv of state.log) if (lv.cleared) score += lv.level * 100 + (lv.mistakes === 0 ? 50 : 0);
  if (state.phase === "won") score += 500 + state.lives * 100 + state.stars * 50;
  return score;
}

/** Highest level fully cleared. */
export function reachedLevel(state: MindState): number {
  return state.stats.levelsCleared;
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

function levelTime(state: MindState, at: number): number {
  return state.levelStartedAt === null ? 0 : Math.max(0, at - state.levelStartedAt);
}

function appendLog(state: MindState, entries: LogEntry[], mistake = false): LevelLog[] {
  const log = state.log.slice();
  const cur = log[log.length - 1];
  log[log.length - 1] = { ...cur, entries: [...cur.entries, ...entries], mistakes: cur.mistakes + (mistake ? 1 : 0) };
  return log;
}

function enterSync(state: MindState, syncReason: SyncReason): MindState {
  return {
    ...state,
    syncReason,
    phase: "sync",
    phaseUntil: null,
    holds: state.holds.map(() => false),
    reaching: state.reaching.map(() => false),
    pausedAt: null,
    starVote: null,
  };
}

function allEmpty(hands: number[][]): boolean {
  return hands.every((h) => h.length === 0);
}

function clearLevel(state: MindState, now: number): MindState {
  const log = state.log.slice();
  log[log.length - 1] = { ...log[log.length - 1], cleared: true };
  const stats = {
    ...state.stats,
    levelsCleared: state.stats.levelsCleared + 1,
    perfectLevels: state.stats.perfectLevels + (state.levelMistakes === 0 ? 1 : 0),
  };
  const base = { ...state, log, stats, reaching: state.reaching.map(() => false), starVote: null, pausedAt: null, seq: state.seq + 1 };
  if (state.level >= state.maxLevel) return { ...base, phase: "won", phaseUntil: null, lastReward: null };
  const reward = REWARDS[state.level];
  let lives = state.lives;
  let stars = state.stars;
  let lastReward: MindState["lastReward"] = null;
  if (reward === "life") {
    lastReward = { level: state.level, kind: "life", granted: lives < MAX_LIVES };
    lives = Math.min(MAX_LIVES, lives + 1);
  } else if (reward === "star") {
    lastReward = { level: state.level, kind: "star", granted: stars < MAX_STARS };
    stars = Math.min(MAX_STARS, stars + 1);
  }
  return { ...base, lives, stars, lastReward, phase: "break", phaseUntil: now + BREAK_MS, readies: state.readies.map(() => false) };
}

function nextLevel(state: MindState, now: number): MindState {
  const level = state.level + 1;
  const { hands, rngState } = deal(state.playerCount, level, state.rngState);
  return enterSync({
    ...state,
    level,
    hands,
    rngState,
    pile: [],
    discards: [],
    pending: [],
    resyncUsed: state.resyncUsed.map(() => 0),
    levelMistakes: 0,
    levelStartedAt: null,
    flowStartAt: now,
    lastMistake: null,
    lastStar: null,
    lastReward: null,
    log: [...state.log, { level, hands: hands.map((h) => [...h]), entries: [], mistakes: 0, cleared: false }],
    seq: state.seq + 1,
  }, { kind: "level" });
}

/** Confirms the pending cluster (lowest first) and runs the mistake check (§5-4, §6). */
function resolveCluster(state: MindState, now: number): MindState {
  if (state.pending.length === 0) return state;
  const arrival = state.pending;
  const sorted = [...arrival].sort((a, b) => a.card - b.card);
  const reordered = sorted.some((p, i) => p !== arrival[i]);
  const maxCard = sorted[sorted.length - 1].card;
  const pile = [...state.pile, ...sorted.map(({ card, seat }) => ({ card, seat }))];
  const entries: LogEntry[] = sorted.map((p) => ({ card: p.card, seat: p.seat, t: levelTime(state, p.receivedAt), kind: "play" }));

  const revealed: Reveal[] = [];
  const hands = state.hands.map((hand, seat) => {
    const lower = hand.filter((c) => c < maxCard);
    for (const card of lower) revealed.push({ seat, card });
    return lower.length > 0 ? hand.filter((c) => c >= maxCard) : hand;
  });
  revealed.sort((a, b) => a.card - b.card);

  const stats = { ...state.stats, graceSaves: state.stats.graceSaves + (reordered ? 1 : 0) };
  const base: MindState = {
    ...state,
    pile,
    pending: [],
    flowStartAt: now,
    reaching: state.reaching.map((r, seat) => (sorted.some((p) => p.seat === seat) ? false : r)),
    seq: state.seq + 1,
    stats,
  };

  if (revealed.length === 0) {
    const next = { ...base, log: appendLog(state, entries) };
    return allEmpty(hands) ? clearLevel(next, now) : next;
  }

  const mistakeT = levelTime(state, now);
  return {
    ...base,
    hands,
    discards: [...state.discards, ...revealed.map((r) => ({ ...r, reason: "mistake" as const }))],
    lives: state.practice ? state.lives : Math.max(0, state.lives - 1),
    levelMistakes: state.levelMistakes + 1,
    stats: { ...stats, mistakes: stats.mistakes + 1 },
    lastMistake: { id: state.seq + 1, trigger: sorted[sorted.length - 1], revealed, prevTop: pileTop(state) },
    log: appendLog(state, [...entries, ...revealed.map((r) => ({ ...r, t: mistakeT, kind: "mistake" as const }))], true),
    phase: "mistake",
    phaseUntil: now + MISTAKE_MS,
    reaching: state.reaching.map(() => false),
  };
}

/** Confirms anything pending right now (before a pause), returning the possibly-changed state. */
function flush(state: MindState, now: number): MindState {
  return state.pending.length > 0 ? resolveCluster(state, now) : state;
}

function pauseFlow(state: MindState, now: number): MindState {
  return state.pausedAt === null ? { ...state, pausedAt: now } : state;
}

function resumeFlow(state: MindState, now: number): MindState {
  if (state.pausedAt === null) return state;
  return { ...state, flowStartAt: state.flowStartAt + (now - state.pausedAt), pausedAt: null };
}

function cancelStarVote(state: MindState, now: number): MindState {
  return { ...state, starVote: null, starCooldownUntil: now + STAR_COOLDOWN_MS, phase: "resume", phaseUntil: now + RESUME_MS, seq: state.seq + 1 };
}

function fireStar(state: MindState, now: number): MindState {
  const revealed: Reveal[] = [];
  const hands = state.hands.map((hand, seat) => {
    if (hand.length === 0) return hand;
    revealed.push({ seat, card: hand[0] });
    return hand.slice(1);
  });
  revealed.sort((a, b) => a.card - b.card);
  const t = levelTime(state, now);
  return {
    ...state,
    hands,
    stars: state.practice ? state.stars : state.stars - 1,
    discards: [...state.discards, ...revealed.map((r) => ({ ...r, reason: "star" as const }))],
    stats: { ...state.stats, starsUsed: state.stats.starsUsed + 1 },
    lastStar: { id: state.seq + 1, revealed },
    log: appendLog(state, revealed.map((r) => ({ ...r, t, kind: "star" as const }))),
    starVote: null,
    phase: "starReveal",
    phaseUntil: now + STAR_REVEAL_MS,
    seq: state.seq + 1,
  };
}

/** Whether every seat that has to confirm sync is holding and nobody is away. */
function syncReady(state: MindState): boolean {
  return state.holds.every((h) => h) && !state.away.some((a) => a);
}

function refreshCountdown(state: MindState, now: number): MindState {
  if (state.phase !== "sync") return state;
  const ready = syncReady(state);
  if (ready && state.phaseUntil === null) return { ...state, phaseUntil: now + SYNC_COUNTDOWN_MS, seq: state.seq + 1 };
  if (!ready && state.phaseUntil !== null) return { ...state, phaseUntil: null };
  return state;
}

function validSeat(state: MindState, seat: SeatIndex): boolean {
  return Number.isInteger(seat) && seat >= 0 && seat < state.playerCount;
}

export function applyAction(state: MindState, action: MindAction, now: number): MindState {
  if (isFinished(state)) return state;
  switch (action.type) {
    case "away": {
      const away = state.hands.map((_, seat) => !!action.away[seat]);
      if (away.every((a, i) => a === state.away[i])) return state;
      let next: MindState = { ...state, away };
      if (away.some((a) => a) && (next.phase === "playing" || next.phase === "starVote" || next.phase === "resume")) {
        next = flush(next, now);
        if (next.phase === "playing" || next.phase === "starVote" || next.phase === "resume") {
          next = enterSync({ ...next, seq: next.seq + 1 }, { kind: "away", seats: away.flatMap((a, seat) => (a ? [seat] : [])) });
        }
      }
      if (next.phase === "sync") next = { ...next, holds: next.holds.map((h, seat) => h && !away[seat]) };
      return refreshCountdown(next, now);
    }
    case "hold": {
      if (state.phase !== "sync" || !validSeat(state, action.seat)) return state;
      if (state.holds[action.seat] === action.on || (action.on && state.away[action.seat])) return state;
      const holds = state.holds.slice();
      holds[action.seat] = action.on;
      return refreshCountdown({ ...state, holds }, now);
    }
    case "reach": {
      if (state.phase !== "playing" || !validSeat(state, action.seat)) return state;
      const on = action.on && state.hands[action.seat].length > 0;
      if (state.reaching[action.seat] === on) return state;
      const reaching = state.reaching.slice();
      reaching[action.seat] = on;
      return { ...state, reaching };
    }
    case "play": {
      if (state.phase !== "playing" || !validSeat(state, action.seat)) return state;
      const hand = state.hands[action.seat];
      // Only the lowest card can be played; a stale request for a card that
      // was already discarded/played is dropped.
      if (hand.length === 0 || hand[0] !== action.card) return state;
      const hands = state.hands.slice();
      hands[action.seat] = hand.slice(1);
      const reaching = state.reaching.slice();
      reaching[action.seat] = false;
      return {
        ...state,
        hands,
        reaching,
        pending: [...state.pending, { card: action.card, seat: action.seat, receivedAt: now }],
        clusterFirstAt: state.pending.length === 0 ? now : state.clusterFirstAt,
      };
    }
    case "resync": {
      if (state.phase !== "playing" || !validSeat(state, action.seat)) return state;
      if (state.resyncUsed[action.seat] >= RESYNC_PER_LEVEL) return state;
      const flushed = flush(state, now);
      if (flushed.phase !== "playing") return flushed;
      const resyncUsed = flushed.resyncUsed.slice();
      resyncUsed[action.seat] += 1;
      return enterSync({ ...flushed, resyncUsed, seq: flushed.seq + 1 }, { kind: "resync", seat: action.seat });
    }
    case "starPropose": {
      if (state.phase !== "playing" || !validSeat(state, action.seat)) return state;
      if (state.stars <= 0 || now < state.starCooldownUntil) return state;
      const flushed = flush(state, now);
      if (flushed.phase !== "playing") return flushed;
      const yes: (boolean | null)[] = flushed.hands.map(() => null);
      yes[action.seat] = true;
      return pauseFlow(
        {
          ...flushed,
          phase: "starVote",
          phaseUntil: now + STAR_VOTE_MS,
          starVote: { proposer: action.seat, yes, deadline: now + STAR_VOTE_MS },
          reaching: flushed.reaching.map(() => false),
          seq: flushed.seq + 1,
        },
        now,
      );
    }
    case "starVote": {
      if (state.phase !== "starVote" || !state.starVote || !validSeat(state, action.seat)) return state;
      if (state.starVote.yes[action.seat] !== null) return state;
      if (!action.yes) return cancelStarVote(state, now);
      const yes = state.starVote.yes.slice();
      yes[action.seat] = true;
      if (yes.every((v) => v === true)) return fireStar(state, now);
      return { ...state, starVote: { ...state.starVote, yes } };
    }
    case "ready": {
      if (state.phase !== "break" || !validSeat(state, action.seat) || state.readies[action.seat]) return state;
      const readies = state.readies.slice();
      readies[action.seat] = true;
      const next = { ...state, readies };
      return readies.every((r, seat) => r || state.away[seat]) ? nextLevel(next, now) : next;
    }
  }
}

/** Advances every timer. Call often (the host runs it every ~50ms). */
export function tick(state: MindState, now: number): MindState {
  switch (state.phase) {
    case "playing": {
      if (state.pending.length === 0) return state;
      const lastArrival = state.pending[state.pending.length - 1].receivedAt;
      if (now >= Math.min(lastArrival + GRACE_MS, state.clusterFirstAt + GRACE_CAP_MS)) return resolveCluster(state, now);
      return state;
    }
    case "sync": {
      if (state.phaseUntil === null || now < state.phaseUntil) return state;
      if (!syncReady(state)) return { ...state, phaseUntil: null };
      // First sync of a level starts the replay clock.
      return {
        ...state,
        phase: "playing",
        phaseUntil: null,
        holds: state.holds.map(() => false),
        flowStartAt: now,
        levelStartedAt: state.levelStartedAt ?? now,
        seq: state.seq + 1,
      };
    }
    case "mistake": {
      if (state.phaseUntil === null || now < state.phaseUntil) return state;
      if (state.lives <= 0) return { ...state, phase: "lost", phaseUntil: null, seq: state.seq + 1 };
      if (allEmpty(state.hands)) return clearLevel(state, now);
      return enterSync({ ...state, seq: state.seq + 1 }, { kind: "mistake" });
    }
    case "starVote": {
      if (!state.starVote || now < state.starVote.deadline) return state;
      return cancelStarVote(state, now);
    }
    case "starReveal": {
      if (state.phaseUntil === null || now < state.phaseUntil) return state;
      if (allEmpty(state.hands)) return clearLevel(state, now);
      return enterSync({ ...state, seq: state.seq + 1 }, { kind: "star" });
    }
    case "resume": {
      if (state.phaseUntil === null || now < state.phaseUntil) return state;
      return { ...resumeFlow(state, now), phase: "playing", phaseUntil: null, seq: state.seq + 1 };
    }
    case "break": {
      if (state.phaseUntil === null || now < state.phaseUntil) return state;
      return nextLevel(state, now);
    }
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Bots (§13) — host-only, never look at other hands.
// ---------------------------------------------------------------------------

/** Milliseconds per "unseen number" between the pile top and the bot's card. */
export const BOT_MS_PER_NUMBER = 230;
export const BOT_BASE_MS = 700;

/** Timing noise (σ as a fraction of the delay) by bot level 1..10. */
export function botNoise(level: number): number {
  const l = Math.min(10, Math.max(1, Math.round(level)));
  return 0.42 - (l - 1) * 0.04; // Lv.1 0.42 → Lv.10 0.06
}

/** Numbers between `top` and `card` (exclusive) that could still be in someone's hand. */
export function unseenBetween(state: MindState, top: number, card: number): number {
  const known = new Set(state.discards.map((d) => d.card));
  let n = 0;
  for (let v = top + 1; v < card; v++) if (!known.has(v)) n++;
  return n;
}

/**
 * How long after `flowStartAt` this bot wants to play its lowest card, before
 * noise. Pure counting rule, shared by every bot so a table of bots stays
 * internally consistent; humans match it with the flow clock.
 */
export function botBaseDelay(state: MindState, seat: SeatIndex): number | null {
  const hand = state.hands[seat];
  if (!hand || hand.length === 0) return null;
  const top = pileTop(state);
  const gap = unseenBetween(state, top, hand[0]);
  // Expected number of other players' cards below mine: if it's tiny, hurry.
  const othersCards = cardsLeft(state) - hand.length;
  const unknownTotal = Math.max(1, unseenBetween(state, top, CARD_MAX + 1) - hand.length);
  const expectedBelow = (gap * othersCards) / unknownTotal;
  const hurry = expectedBelow < 0.35 ? 0.6 : 1;
  return (BOT_BASE_MS + gap * BOT_MS_PER_NUMBER) * hurry;
}

/** Delay with gaussian-ish noise (sum of three uniforms, rescaled to σ≈1). */
export function botDelay(state: MindState, seat: SeatIndex, level: number, rng: () => number): number | null {
  const base = botBaseDelay(state, seat);
  if (base === null) return null;
  const z = (rng() + rng() + rng() - 1.5) * 2; // ~N(0, 1)
  return Math.max(250, base * (1 + z * botNoise(level)));
}
