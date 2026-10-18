/**
 * Things to do while someone else throws (rulebook §17) — cosmetic only,
 * never part of the engine, rankings or stats:
 *
 * - 📣 Skip calls: the thrower's teammates tap the sheet to mark where they
 *   want the stone (🎯 draw / 🛡️ guard / 💥 hit). Shown to that side only.
 * - 🔮 Predictions: everyone but the thrower calls "🏠 stays in the house" or
 *   "💨 doesn't" before the release; each device scores its own pick (and the
 *   bot-driving device its bots') and broadcasts only the running total, so
 *   message order never matters.
 */

import type { CurlingState, ThrowRecord } from "./engine";
import { inHouse } from "./physics";
import type { CallMark } from "./SheetCanvas";

export type Prediction = "in" | "out";

export interface PredictionBoard {
  turn: number;
  picks: Record<number, Prediction>;
}

export const EMPTY_PREDICTIONS: PredictionBoard = { turn: -1, picks: {} };

/** Did the delivered stone come to rest in the house? */
export function stoneStayedIn(state: CurlingState, lt: ThrowRecord): boolean {
  // stone ids are unique for the whole game; after the end is cleared, look in its snapshot
  const s = state.stones.find((x) => x.id === lt.stoneId) ?? state.history[state.history.length - 1]?.stones.find((x) => x.id === lt.stoneId);
  return !!s && inHouse(s);
}

export function predictionHit(pick: Prediction, stayed: boolean): boolean {
  return (pick === "in") === stayed;
}

export function sanitizePrediction(raw: unknown, playerCount: number): { seat: number; turn: number; pick: Prediction } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const seat = r.seat;
  const turn = r.turn;
  if (typeof seat !== "number" || !Number.isInteger(seat) || seat < 0 || seat >= playerCount) return null;
  if (typeof turn !== "number" || !Number.isInteger(turn) || turn < 0) return null;
  if (r.pick !== "in" && r.pick !== "out") return null;
  return { seat, turn, pick: r.pick };
}

export function sanitizeCall(raw: unknown, playerCount: number): { seat: number; turn: number; x: number; y: number; tag: CallMark["tag"] } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const { seat, turn, x, y, tag } = r;
  if (typeof seat !== "number" || !Number.isInteger(seat) || seat < 0 || seat >= playerCount) return null;
  if (typeof turn !== "number" || !Number.isInteger(turn)) return null;
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 2.5 || y < -3 || y > 10) return null;
  if (tag !== "draw" && tag !== "guard" && tag !== "hit") return null;
  return { seat, turn, x, y, tag };
}

/** A bot's guess — slightly optimistic, like a fan. */
export function botPrediction(rng: () => number = Math.random): Prediction {
  return rng() < 0.58 ? "in" : "out";
}
