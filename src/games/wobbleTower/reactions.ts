/**
 * Spectator layer (rulebook §12.5) — things the other players do while one
 * person pulls: reaction emotes, a 💨 puff of breath that shakes the tower
 * on every screen (display only), and a "버틴다 / 무너진다" call on each
 * pull scored as 🔮 예언 points.
 *
 * None of this touches the lockstep engine or the ranking. Predictions are
 * scored on each predictor's own device (it alone knows its call went in
 * before it saw the pull) and the running total is broadcast, so every
 * screen shows the same numbers without depending on message order.
 */

export type ReactionKind = "cheer" | "gasp" | "shh" | "laugh" | "pray" | "blow";

export const REACTIONS: { kind: ReactionKind; emoji: string; label: string }[] = [
  { kind: "cheer", emoji: "👏", label: "응원" },
  { kind: "gasp", emoji: "😱", label: "헉" },
  { kind: "shh", emoji: "🤫", label: "쉿" },
  { kind: "laugh", emoji: "😂", label: "웃음" },
  { kind: "pray", emoji: "🙏", label: "제발" },
  { kind: "blow", emoji: "💨", label: "입김" },
];

export const REACTION_EMOJI: Record<ReactionKind, string> = Object.fromEntries(REACTIONS.map((r) => [r.kind, r.emoji])) as Record<ReactionKind, string>;

/** Minimum gap between my own reactions (ms). */
export const REACT_COOLDOWN_MS = 1200;
/** How long a floating reaction stays on screen (ms). */
export const REACTION_TTL_MS = 2600;

export interface Reaction {
  id: string;
  seat: number;
  kind: ReactionKind;
  /** Local receipt time (Date.now ms). */
  at: number;
}

export function sanitizeReaction(raw: unknown, playerCount: number): Omit<Reaction, "at"> | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const seat = r.seat;
  const kind = r.kind;
  const id = r.id;
  if (typeof seat !== "number" || !Number.isInteger(seat) || seat < 0 || seat >= playerCount) return null;
  if (typeof kind !== "string" || !(kind in REACTION_EMOJI)) return null;
  if (typeof id !== "string" || id.length > 64) return null;
  return { id, seat, kind: kind as ReactionKind };
}

export type Prediction = "stand" | "fall";

export interface PredictionBoard {
  /** The pull turn these calls are about. */
  turn: number;
  picks: Record<number, Prediction>;
}

export function sanitizePrediction(raw: unknown, playerCount: number): { seat: number; turn: number; pick: Prediction } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const { seat, turn, pick } = r;
  if (typeof seat !== "number" || !Number.isInteger(seat) || seat < 0 || seat >= playerCount) return null;
  if (typeof turn !== "number" || !Number.isInteger(turn) || turn < 0) return null;
  if (pick !== "stand" && pick !== "fall") return null;
  return { seat, turn, pick };
}

/** One prediction's outcome: +1 for a correct call, +2 for correctly calling a collapse (rarer, braver). */
export function predictionPoints(pick: Prediction, collapsed: boolean): number {
  if (pick === "fall") return collapsed ? 2 : 0;
  return collapsed ? 0 : 1;
}

/** Bots call "fall" more often the shakier the tower looks (instability from the engine). */
export function botPrediction(instability: number, rand: () => number): Prediction {
  const pFall = Math.max(0.06, Math.min(0.6, instability * 0.35));
  return rand() < pFall ? "fall" : "stand";
}

/** Side lane x (%) for a seat — reactions never rise over the tower in the middle. */
export function reactionLaneX(seat: number): number {
  const step = Math.floor(seat / 2) * 7;
  return seat % 2 === 0 ? 7 + step : 93 - step;
}

/** Same seat + same emote within the TTL collapses into one bubble with a ×n count. */
export function groupReactions(reactions: readonly Reaction[], nowMs: number, max: number): { r: Reaction; count: number; stack: number }[] {
  const groups = new Map<string, { r: Reaction; count: number }>();
  for (const r of reactions) {
    if (nowMs - r.at >= REACTION_TTL_MS) continue;
    const key = `${r.seat}:${r.kind}`;
    const g = groups.get(key);
    if (!g) groups.set(key, { r, count: 1 });
    else {
      g.count += 1;
      if (r.at >= g.r.at) g.r = r;
    }
  }
  const latest = [...groups.values()].sort((a, b) => a.r.at - b.r.at).slice(-max);
  const perSeat = new Map<number, number>();
  return latest.map((g) => {
    const stack = perSeat.get(g.r.seat) ?? 0;
    perSeat.set(g.r.seat, stack + 1);
    return { ...g, stack };
  });
}
