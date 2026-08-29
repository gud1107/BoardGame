/**
 * Vote-based "seat disconnected/unresponsive → AI bot takes over" state
 * machine, shared by every online-realtime game that opts in (currently:
 * dalmuti, lasVegas, grid-poker, malDalliJa, no-thanks, destinyWar39 — see
 * HANDOFF.md for the session that added this).
 *
 * Design mirrors `useBotAutoplay.ts`'s lockstep philosophy exactly, one
 * level down: there is no server and no single arbiter for "should this
 * seat become a bot" (that was an explicit, deliberate departure from a
 * host-authoritative decision — the room's host only stays authoritative for
 * *running* a bot seat's turns via `useBotAutoplay`, not for *deciding* a
 * human seat should become one). Every connected client independently
 * replays the exact same sequence of `BotTakeoverEvent`s (broadcast over the
 * game's existing Supabase Realtime channel, the same way `EngineAction`s
 * already are) through `reduceBotTakeover` and arrives at the same
 * `BotTakeoverState` — no client is more "correct" than another, and no
 * client needs to be the host to participate in or trigger a vote.
 *
 * `seatKey` is a plain string so this works for every game's seat model:
 * numeric `SeatIndex` (stringified, e.g. `"0"`) for five of the six games,
 * and malDalliJa's `Seat` (`"p1"` | `"p2"`) unchanged.
 *
 * What this module deliberately does NOT do:
 *  - Decide *when* to fire a `vote-start` (that's each `*Game.tsx`'s job —
 *    a presence "leave" event for `reason: "disconnected"`, or a stalled
 *    `currentActor` timer for `reason: "idle"`; see each game's own wiring).
 *  - Decide who's "eligible" to vote (that's `occupants` minus the target
 *    seat minus any already-bot seats — the caller counts this from its own
 *    `Occupant[]` state and passes it into `voteThresholdMet`).
 *  - Touch `originalUserId`/reward mapping — callers read
 *    `state.takeovers[seatKey]` themselves to prefer it over a live
 *    presence lookup when building their seat → playerId map, so a
 *    genuinely disconnected player (who has already dropped out of
 *    `occupants` entirely) still gets credited for what the bot does in
 *    their seat.
 */

export type TakeoverReason = "disconnected" | "idle";

export interface TakeoverVote {
  readonly seatKey: string;
  readonly reason: TakeoverReason;
  readonly startedAt: number;
  /**
   * Captured once, when the vote starts, from whichever occupant record is
   * still available at that moment (presence `leftPresences` for a real
   * disconnect — the occupant is already gone from live presence by the
   * time anyone could look it up again later — or the live `Occupant` for an
   * idle-but-connected seat). `convert` below reads it back out of here
   * rather than needing every client to re-resolve it at conversion time.
   */
  readonly originalUserId: string;
  readonly originalName: string;
  /** Deduplicated by `reduceBotTakeover` — casting again is a no-op. */
  readonly yesVoterDeviceIds: readonly string[];
}

export interface TakeoverInfo {
  readonly originalUserId: string;
  readonly originalName: string;
  readonly convertedAt: number;
}

export interface BotTakeoverState {
  readonly votes: Readonly<Record<string, TakeoverVote>>;
  readonly takeovers: Readonly<Record<string, TakeoverInfo>>;
}

export const INITIAL_BOT_TAKEOVER_STATE: BotTakeoverState = { votes: {}, takeovers: {} };

export type BotTakeoverEvent =
  | { type: "vote-start"; seatKey: string; reason: TakeoverReason; startedAt: number; originalUserId: string; originalName: string }
  | { type: "vote-cast"; seatKey: string; voterDeviceId: string }
  /** The vote target proving presence ("저 있어요") cancels the vote outright — same unified affordance as `reclaim` below, just before vs after conversion actually lands. */
  | { type: "vote-cancel"; seatKey: string }
  /** `originalUserId`/`originalName` are NOT repeated here — pulled from the matching in-progress vote (see `reduceBotTakeover`'s "convert" branch) so there's exactly one place a client resolves them. */
  | { type: "convert"; seatKey: string; at: number }
  /** The original player returning and reclaiming manual control — same unified "yes" button as `vote-cancel`, used once a seat has already converted. */
  | { type: "reclaim"; seatKey: string };

function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  if (!(key in record)) return record as Record<string, T>;
  const next = { ...record };
  delete next[key];
  return next;
}

/**
 * Pure state transition — call once per received/sent `BotTakeoverEvent`,
 * same as `applyAction` for game moves. Every branch is idempotent against
 * races (two clients both noticing a disconnect and both broadcasting
 * `vote-start`, a vote being cast twice by the same device, a `convert`
 * arriving for a seat some client already voted on, etc.) so it's safe for
 * every client to fire these speculatively without coordinating who "gets"
 * to send one.
 */
export function reduceBotTakeover(state: BotTakeoverState, event: BotTakeoverEvent): BotTakeoverState {
  switch (event.type) {
    case "vote-start": {
      // Already a bot, or a vote is already running for this seat — ignore
      // (a second client noticing the same disconnect shouldn't restart the
      // clock or wipe existing yes-votes).
      if (state.takeovers[event.seatKey] || state.votes[event.seatKey]) return state;
      return {
        ...state,
        votes: {
          ...state.votes,
          [event.seatKey]: {
            seatKey: event.seatKey,
            reason: event.reason,
            startedAt: event.startedAt,
            originalUserId: event.originalUserId,
            originalName: event.originalName,
            yesVoterDeviceIds: [],
          },
        },
      };
    }
    case "vote-cast": {
      const vote = state.votes[event.seatKey];
      if (!vote) return state;
      if (vote.yesVoterDeviceIds.includes(event.voterDeviceId)) return state;
      return {
        ...state,
        votes: {
          ...state.votes,
          [event.seatKey]: { ...vote, yesVoterDeviceIds: [...vote.yesVoterDeviceIds, event.voterDeviceId] },
        },
      };
    }
    case "vote-cancel": {
      if (!state.votes[event.seatKey]) return state;
      return { ...state, votes: withoutKey(state.votes, event.seatKey) };
    }
    case "convert": {
      // No matching in-progress vote (e.g. a stale/duplicate broadcast after
      // the seat already reclaimed) — nothing to promote into a takeover.
      const vote = state.votes[event.seatKey];
      if (!vote) return state;
      return {
        votes: withoutKey(state.votes, event.seatKey),
        takeovers: {
          ...state.takeovers,
          [event.seatKey]: {
            originalUserId: vote.originalUserId,
            originalName: vote.originalName,
            convertedAt: event.at,
          },
        },
      };
    }
    case "reclaim": {
      if (!state.takeovers[event.seatKey]) return state;
      return {
        votes: withoutKey(state.votes, event.seatKey),
        takeovers: withoutKey(state.takeovers, event.seatKey),
      };
    }
    default:
      return state;
  }
}

/** Current yes-tally for a seat's in-progress vote, or 0 if none is running. */
export function voteYesCount(state: BotTakeoverState, seatKey: string): number {
  return state.votes[seatKey]?.yesVoterDeviceIds.length ?? 0;
}

/**
 * Majority rule (decision: over half, NOT unanimous) among the *other*
 * remaining real players — `eligibleVoterCount` is the target seat's
 * occupant excluded, and every already-bot seat excluded, computed by the
 * caller from its own `Occupant[]`/`botSeats`. A 1-eligible-voter room (e.g.
 * malDalliJa's 2-player games) resolves correctly: `1 > 0.5` is true, so the
 * single other player's yes vote alone converts the seat.
 */
export function voteThresholdMet(yesCount: number, eligibleVoterCount: number): boolean {
  if (eligibleVoterCount <= 0) return false;
  return yesCount > eligibleVoterCount / 2;
}

export function isSeatTakenOver(state: BotTakeoverState, seatKey: string): boolean {
  return seatKey in state.takeovers;
}

export function activeVoteFor(state: BotTakeoverState, seatKey: string): TakeoverVote | null {
  return state.votes[seatKey] ?? null;
}
