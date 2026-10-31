/**
 * Server-authoritative ("secure") matches — the pure part.
 *
 * The lockstep games broadcast one shuffle seed to every device, so anyone
 * with devtools can rebuild the whole game: every hand, role and the next
 * card. A secure match keeps the real state on the server only. Each device
 * sends its actions to `/api/match` and gets back just the view its seat is
 * allowed to see (`SecureGameDef.view`). The server also owns the clock and
 * the bots, so no device ever needs the full state.
 *
 * Seats are proven with a per-device random token: the room only ever sees
 * its SHA-256 hash (in presence), the server compares `sha256(token)` on
 * every request. This file has no I/O so it can be unit-tested; the store
 * and the route handler live in `store.ts` / `src/app/api/match/route.ts`.
 */

export interface SecureGameDef<S, A> {
  start(playerCount: number, seed: number, options: unknown): S;
  apply(state: S, action: A): S;
  /** Parses an untrusted client action for `seat` — null rejects it (wrong shape, or server-only like TIMEOUT). */
  clientAction(state: S, seat: number, raw: unknown): A | null;
  /** What `seat` may see. Must keep the state's shape so the existing board renders it unchanged. */
  view(state: S, seat: number): S;
  seatCount(state: S): number;
  /** Changes whenever the current timer should restart. */
  stageKey(state: S): string;
  /** How long the current stage lasts; 0 = no timer. */
  stageDurationMs(state: S): number;
  timeoutAction(state: S): A | null;
  pendingBot(state: S, botSeats: ReadonlySet<number>): number | null;
  botAction(state: S, seat: number, level: number, rng: () => number): A | null;
  botDelayMs: readonly [number, number];
}

export interface MatchRecord {
  id: string;
  game: string;
  version: number;
  state: unknown;
  /** seat → SHA-256 hex of that seat's token. Bot seats have none. */
  seatHashes: Record<string, string>;
  /** seat → bot level, for lobby bots and taken-over seats. */
  bots: Record<string, number>;
  stageKey: string;
  stageAt: number;
  botDueAt: number | null;
}

export interface MatchView<S> {
  matchId: string;
  version: number;
  view: S;
  /** Remaining time, so devices don't depend on the server's clock. */
  deadlineInMs: number | null;
  botDueInMs: number | null;
}

export function createMatch<S, A>(
  def: SecureGameDef<S, A>,
  input: { id: string; game: string; playerCount: number; options: unknown; seatHashes: Record<string, string>; bots: Record<string, number>; seed: number; now: number },
): MatchRecord {
  const state = def.start(input.playerCount, input.seed, input.options);
  const rec: MatchRecord = {
    id: input.id,
    game: input.game,
    version: 1,
    state,
    seatHashes: input.seatHashes,
    bots: input.bots,
    stageKey: def.stageKey(state),
    stageAt: input.now,
    botDueAt: null,
  };
  return advance(def, rec, input.now, Math.random).rec;
}

function botSet(rec: MatchRecord): Set<number> {
  return new Set(Object.keys(rec.bots).map(Number));
}

/** Restarts the timer when the stage moved on. */
function withStage<S, A>(def: SecureGameDef<S, A>, rec: MatchRecord, state: S, now: number): MatchRecord {
  const key = def.stageKey(state);
  if (key === rec.stageKey) return { ...rec, state };
  return { ...rec, state, stageKey: key, stageAt: now, botDueAt: null };
}

/**
 * Fires whatever is due at `now` — an expired stage timer, or a bot whose
 * thinking delay has passed — and schedules the next bot. Repeats until
 * nothing more is due (one bot per pass, like the old client autoplay).
 */
export function advance<S, A>(def: SecureGameDef<S, A>, start: MatchRecord, now: number, rng: () => number): { rec: MatchRecord; changed: boolean } {
  let rec = start;
  let changed = false;
  for (let guard = 0; guard < 64; guard++) {
    const state = rec.state as S;
    const duration = def.stageDurationMs(state);
    if (duration > 0 && now >= rec.stageAt + duration) {
      const timeout = def.timeoutAction(state);
      const next = timeout ? def.apply(state, timeout) : state;
      if (next !== state) {
        rec = withStage(def, rec, next, now);
        changed = true;
        continue;
      }
    }
    const bot = def.pendingBot(state, botSet(rec));
    if (bot === null) {
      if (rec.botDueAt !== null) {
        rec = { ...rec, botDueAt: null };
        changed = true;
      }
      break;
    }
    if (rec.botDueAt === null) {
      const [lo, hi] = def.botDelayMs;
      rec = { ...rec, botDueAt: now + lo + Math.floor(rng() * (hi - lo)) };
      changed = true;
      break;
    }
    if (now < rec.botDueAt) break;
    const action = def.botAction(state, bot, rec.bots[String(bot)] ?? 1, rng);
    const next = action ? def.apply(state, action) : state;
    if (next === state) break; // the bot had nothing legal — wait for the timer instead
    rec = { ...withStage(def, rec, next, now), botDueAt: null };
    changed = true;
  }
  return { rec: changed ? { ...rec, version: start.version + 1 } : rec, changed };
}

export type ActResult = { ok: true; rec: MatchRecord; changed: boolean } | { ok: false; reason: "rejected" };

export function act<S, A>(def: SecureGameDef<S, A>, rec: MatchRecord, seat: number, raw: unknown, now: number, rng: () => number): ActResult {
  const state = rec.state as S;
  const action = def.clientAction(state, seat, raw);
  if (!action) return { ok: false, reason: "rejected" };
  const next = def.apply(state, action);
  // The board pre-checks moves, so an ignored action is usually a race (someone else moved first) — not an error.
  if (next === state) {
    const res = advance(def, rec, now, rng);
    return { ok: true, ...res };
  }
  const moved = withStage(def, rec, next, now);
  const res = advance(def, { ...moved, version: rec.version }, now, rng);
  return { ok: true, rec: { ...res.rec, version: rec.version + 1 }, changed: true };
}

export function setBots(rec: MatchRecord, bots: Record<string, number>): { rec: MatchRecord; changed: boolean } {
  const same = JSON.stringify(Object.entries(rec.bots).sort()) === JSON.stringify(Object.entries(bots).sort());
  if (same) return { rec, changed: false };
  return { rec: { ...rec, bots, botDueAt: null, version: rec.version + 1 }, changed: true };
}

export function seatAllowed(rec: MatchRecord, seat: number, tokenHash: string): boolean {
  const expected = rec.seatHashes[String(seat)];
  return typeof expected === "string" && expected.length > 0 && expected === tokenHash;
}

export function viewFor<S, A>(def: SecureGameDef<S, A>, rec: MatchRecord, seat: number, now: number): MatchView<S> {
  const state = rec.state as S;
  const duration = def.stageDurationMs(state);
  return {
    matchId: rec.id,
    version: rec.version,
    view: def.view(state, seat),
    deadlineInMs: duration > 0 ? Math.max(0, rec.stageAt + duration - now) : null,
    botDueInMs: rec.botDueAt === null ? null : Math.max(0, rec.botDueAt - now),
  };
}
