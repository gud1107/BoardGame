import {
  botDelay,
  HOLD_TO_PLAY_MS,
  type MindAction,
  type MindState,
  type SeatIndex,
} from "./engine";

/**
 * Host-side bot driver (rulebook §13). Lobby bots and takeover bots both run
 * through here; the host calls `runBots` on every loop tick and dispatches
 * whatever actions come back. Bots only read public state + their own hand.
 *
 * Mutable `BotMemory` holds each bot's current plan ("play my lowest card at
 * host time X") so the noise roll happens once per card, not once per tick.
 */

interface Plan {
  card: number;
  flowStartAt: number;
  at: number;
  reachSent: boolean;
  yielded: boolean;
}

export interface BotMemory {
  plans: Record<SeatIndex, Plan | undefined>;
  /** `${phase}:${seq}` the bot first saw + when — used to pace hold/vote/ready. */
  seen: { key: string; at: number } | null;
}

export function createBotMemory(): BotMemory {
  return { plans: {}, seen: null };
}

const HOLD_AFTER_MS = 450;
const VOTE_AFTER_MS = 1300;
const READY_AFTER_MS = 1800;
/** A human reaching for a card makes a bot about to play hold back once (§13-1). */
const YIELD_WINDOW_MS = 1200;
const YIELD_MS = 900;

export function runBots(
  state: MindState,
  now: number,
  bots: ReadonlyMap<SeatIndex, number>,
  memory: BotMemory,
  rng: () => number,
): MindAction[] {
  if (bots.size === 0) return [];
  const key = `${state.phase}:${state.level}:${state.phase === "sync" || state.phase === "break" ? state.seq : 0}`;
  if (memory.seen?.key !== key) memory.seen = { key, at: now };
  const sinceSeen = now - memory.seen.at;
  const actions: MindAction[] = [];

  for (const [seat, level] of bots) {
    if (seat >= state.playerCount) continue;
    switch (state.phase) {
      case "sync":
        if (!state.holds[seat] && !state.away[seat] && sinceSeen >= HOLD_AFTER_MS + seat * 120) actions.push({ type: "hold", seat, on: true });
        break;
      case "starVote":
        if (state.starVote && state.starVote.yes[seat] === null && sinceSeen >= VOTE_AFTER_MS + seat * 200) {
          actions.push({ type: "starVote", seat, yes: true });
        }
        break;
      case "break":
        if (!state.readies[seat] && sinceSeen >= READY_AFTER_MS) actions.push({ type: "ready", seat });
        break;
      case "playing": {
        const hand = state.hands[seat];
        if (hand.length === 0) {
          memory.plans[seat] = undefined;
          break;
        }
        let plan = memory.plans[seat];
        if (!plan || plan.card !== hand[0] || plan.flowStartAt !== state.flowStartAt) {
          const delay = botDelay(state, seat, level, rng);
          if (delay === null) break;
          plan = { card: hand[0], flowStartAt: state.flowStartAt, at: state.flowStartAt + delay, reachSent: false, yielded: false };
          memory.plans[seat] = plan;
        }
        if (!plan.yielded && plan.at - now < YIELD_WINDOW_MS) {
          const humanReaching = state.reaching.some((r, s) => r && s !== seat && !bots.has(s));
          if (humanReaching) {
            plan.yielded = true;
            plan.at = Math.max(plan.at, now) + YIELD_MS;
            if (plan.reachSent) {
              plan.reachSent = false;
              actions.push({ type: "reach", seat, on: false });
            }
          }
        }
        if (!plan.reachSent && now >= plan.at - HOLD_TO_PLAY_MS) {
          plan.reachSent = true;
          actions.push({ type: "reach", seat, on: true });
        }
        if (now >= plan.at) actions.push({ type: "play", seat, card: plan.card });
        break;
      }
      default:
        break;
    }
  }
  return actions;
}
