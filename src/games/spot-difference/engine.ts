/**
 * Pure "틀린 그림 찾기" (Spot the Difference) rules engine — no React, no
 * timers, no DOM. Two team-battle modes share one reducer:
 *
 *  - "builtin": a handful of generated-shape scenes (scenes.ts) with a
 *    baked-in, fixed answer key (5 diffs per stage).
 *  - "photo": the host's own uploaded photo. There is no object-detection
 *    step — instead `generatePhotoDiffSpots` deterministically derives N
 *    click-hit regions (position + which visual "damage" effect to render
 *    there) purely from the shared RNG seed, so every client computes the
 *    identical answer key from the same seed without needing to transmit it
 *    separately (same "derive, don't duplicate" principle as every other
 *    engine's `startGame(seed)"). The actual pixel manipulation (applying
 *    that effect to the photo) is a rendering concern, done in
 *    PhotoStageCanvas.tsx — this file only ever produces coordinates.
 *
 * Scoring is a **team total**, never a turn-by-turn duel: every seat is
 * assigned to team "A" or "B" at `startGame`, and any seat on a team can
 * click at any time — a correct click credits that seat's whole team, not
 * just the clicker (rulebook §3-C "실시간 총합 경쟁"). Winner = whichever
 * team found more spots when the last stage clears or the timer runs out;
 * a tie is a genuine co-win (see `computeTeamRankings`).
 *
 * Same online-multiplayer trust model as every other game here: every
 * connected client holds the FULL state and replays the same
 * `EngineAction`s from a shared seed — no server authority. The one thing
 * that would normally read the wall clock (the wrong-click penalty lock,
 * and the match timer) instead takes its timestamp from the action payload
 * itself (`atMs`, captured by the acting client) so replay stays
 * deterministic across every device — the same trick already used for RNG
 * seeds elsewhere in this project.
 */

export type SeatIndex = number;
export type TeamId = "A" | "B";
export type EffectKind = "hue" | "invert" | "blur" | "mosaic" | "mirror" | "tint" | "grayscale";

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const WRONG_CLICK_PENALTY_MS = 2000;
export const HINTS_PER_TEAM = 2;
export const MIN_PHOTO_DIFFS = 3;
export const MAX_PHOTO_DIFFS = 10;
export const DEFAULT_TIMER_SECONDS = 90;

import { BUILTIN_SCENES, TOLERANCE_RADIUS_PCT, type BuiltinScene } from "./scenes";

/** Deterministic PRNG + shuffle, shared across every engine — see src/lib/rng.ts. */
import { seededRng, shuffle } from "@/lib/rng";
export { seededRng };

export interface Spot {
  id: string;
  xPct: number;
  yPct: number;
  rPct: number;
}

export interface PhotoDiffSpot extends Spot {
  effect: EffectKind;
  intensity: number;
}

export const EFFECT_KINDS: EffectKind[] = ["hue", "invert", "blur", "mosaic", "mirror", "tint", "grayscale"];

/**
 * Deterministically derives `count` non-overlapping click-hit regions from
 * `seed` alone — the whole "answer key" for photo mode. Pure function, no
 * image data needed: rendering (PhotoStageCanvas.tsx) applies the named
 * `effect` to whatever photo the host uploaded, at these same coordinates.
 */
export function generatePhotoDiffSpots(seed: number, count: number): PhotoDiffSpot[] {
  const clamped = Math.min(Math.max(count, MIN_PHOTO_DIFFS), MAX_PHOTO_DIFFS);
  // Offset from the room's main seed so photo-spot placement doesn't
  // correlate with anything else ever derived from the same seed.
  const rng = seededRng(seed + 1_000_003);
  const spots: PhotoDiffSpot[] = [];
  let attempts = 0;
  while (spots.length < clamped && attempts < clamped * 200) {
    attempts++;
    const xPct = 12 + rng() * 76;
    const yPct = 12 + rng() * 76;
    const rPct = 6 + rng() * 3;
    const tooClose = spots.some((s) => Math.hypot(s.xPct - xPct, s.yPct - yPct) < (s.rPct + rPct) * 1.4);
    if (tooClose) continue;
    const effect = EFFECT_KINDS[Math.floor(rng() * EFFECT_KINDS.length)];
    const intensity = 0.5 + rng() * 0.5;
    spots.push({ id: `photo-${spots.length}`, xPct, yPct, rPct, effect, intensity });
  }
  return spots;
}

export interface StageResult {
  spots: Spot[];
  /** spotId -> which team found it. */
  foundBy: Record<string, TeamId>;
}

export type StageSource = { kind: "builtin" } | { kind: "photo"; imageDataUrl: string };

export interface ActiveHint {
  team: TeamId;
  spotId: string;
}

export interface SpotDifferenceState {
  playerCount: number;
  /** seat -> team, fixed for the whole match. */
  teamOf: Record<SeatIndex, TeamId>;
  source: StageSource;
  /** Only meaningful for `source.kind === "builtin"` — the chosen scene order. */
  builtinSceneIds: string[];
  stages: StageResult[];
  currentStageIndex: number;
  /** Configured total match duration — the countdown itself ticks client-side (see useCountdown.ts pattern); this is just the agreed length. */
  timerSeconds: number;
  timeUp: boolean;
  /** seat -> timestamp (ms) until which that seat's clicks are ignored. */
  penalties: Record<SeatIndex, number>;
  hints: Record<TeamId, number>;
  activeHint: ActiveHint | null;
  phase: "playing" | "gameOver";
}

export type EngineAction =
  | { type: "click"; seat: SeatIndex; xPct: number; yPct: number; atMs: number }
  | { type: "useHint"; team: TeamId; atMs: number }
  | { type: "timeUp" };

/** Alternating A/B/A/B/... seat assignment — the only team-split policy this engine offers (see README limitations). */
export function defaultTeamAssignment(playerCount: number): Record<SeatIndex, TeamId> {
  const teamOf: Record<SeatIndex, TeamId> = {};
  for (let seat = 0; seat < playerCount; seat++) teamOf[seat] = seat % 2 === 0 ? "A" : "B";
  return teamOf;
}

function computeSpotsForScene(scene: BuiltinScene): Spot[] {
  return scene.diffs.map((diff) => {
    const shape = scene.shapes.find((s) => s.id === diff.shapeId);
    if (!shape) throw new Error(`Scene "${scene.id}" diff references unknown shape "${diff.shapeId}"`);
    return { id: `${scene.id}:${diff.shapeId}`, xPct: shape.xPct, yPct: shape.yPct, rPct: TOLERANCE_RADIUS_PCT };
  });
}

export interface StartGameOptions {
  source: StageSource;
  /** Builtin mode only — how many scenes to chain, clamped to [1, BUILTIN_SCENES.length]. */
  stageCount?: number;
  /** Photo mode only — how many diff regions to generate, clamped to [MIN_PHOTO_DIFFS, MAX_PHOTO_DIFFS]. */
  diffCount?: number;
  timerSeconds?: number;
  teamAssignment?: Record<SeatIndex, TeamId>;
}

export function startGame(playerCount: number, seed: number, options: StartGameOptions): SpotDifferenceState {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`Unsupported player count: ${playerCount}`);
  }
  const rng = seededRng(seed);
  const teamOf = options.teamAssignment ?? defaultTeamAssignment(playerCount);

  let stages: StageResult[];
  let builtinSceneIds: string[] = [];
  if (options.source.kind === "builtin") {
    const order = shuffle(
      BUILTIN_SCENES.map((s) => s.id),
      rng,
    );
    const count = Math.min(Math.max(options.stageCount ?? 1, 1), BUILTIN_SCENES.length);
    builtinSceneIds = order.slice(0, count);
    stages = builtinSceneIds.map((id) => {
      const scene = BUILTIN_SCENES.find((s) => s.id === id)!;
      return { spots: computeSpotsForScene(scene), foundBy: {} };
    });
  } else {
    const diffCount = options.diffCount ?? 5;
    stages = [{ spots: generatePhotoDiffSpots(seed, diffCount), foundBy: {} }];
  }

  return {
    playerCount,
    teamOf,
    source: options.source,
    builtinSceneIds,
    stages,
    currentStageIndex: 0,
    timerSeconds: options.timerSeconds ?? DEFAULT_TIMER_SECONDS,
    timeUp: false,
    penalties: {},
    hints: { A: HINTS_PER_TEAM, B: HINTS_PER_TEAM },
    activeHint: null,
    phase: "playing",
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function isLocked(state: SpotDifferenceState, seat: SeatIndex, atMs: number): boolean {
  const until = state.penalties[seat];
  return until !== undefined && atMs < until;
}

function click(state: SpotDifferenceState, seat: SeatIndex, xPct: number, yPct: number, atMs: number): SpotDifferenceState {
  if (state.phase !== "playing") return state;
  const team = state.teamOf[seat];
  if (!team) return state;
  if (isLocked(state, seat, atMs)) return state;

  const stage = state.stages[state.currentStageIndex];
  if (!stage) return state;
  const hit = stage.spots.find((s) => Math.hypot(s.xPct - xPct, s.yPct - yPct) <= s.rPct);

  if (hit && stage.foundBy[hit.id]) {
    // Someone already found this one — a redundant confirmation, not a miss.
    return state;
  }
  if (!hit) {
    // Wrong click — lock this seat out per the rulebook §4 penalty option.
    return { ...state, penalties: { ...state.penalties, [seat]: atMs + WRONG_CLICK_PENALTY_MS } };
  }

  const foundBy = { ...stage.foundBy, [hit.id]: team };
  const newStage: StageResult = { ...stage, foundBy };
  const stages = state.stages.map((s, i) => (i === state.currentStageIndex ? newStage : s));
  const activeHint = state.activeHint?.spotId === hit.id ? null : state.activeHint;
  const stageCleared = Object.keys(foundBy).length >= newStage.spots.length;

  if (!stageCleared) {
    return { ...state, stages, activeHint };
  }
  const nextIndex = state.currentStageIndex + 1;
  if (nextIndex >= stages.length) {
    // Every stage's every spot found — immediate win per the rulebook's "스피드전" rule.
    return { ...state, stages, phase: "gameOver", activeHint: null };
  }
  return { ...state, stages, currentStageIndex: nextIndex, activeHint: null };
}

function applyHint(state: SpotDifferenceState, team: TeamId, atMs: number): SpotDifferenceState {
  void atMs; // no wall-clock effect, kept for symmetry with `click` and future cooldown rules
  if (state.phase !== "playing") return state;
  if ((state.hints[team] ?? 0) <= 0) return state;
  const stage = state.stages[state.currentStageIndex];
  if (!stage) return state;
  const undiscovered = stage.spots.find((s) => !stage.foundBy[s.id]);
  if (!undiscovered) return state;
  return { ...state, hints: { ...state.hints, [team]: state.hints[team] - 1 }, activeHint: { team, spotId: undiscovered.id } };
}

function timeUp(state: SpotDifferenceState): SpotDifferenceState {
  if (state.phase !== "playing") return state;
  return { ...state, timeUp: true, phase: "gameOver" };
}

/** Single entry point applying any `EngineAction` to a state — the whole engine as one reducer. */
export function applyAction(state: SpotDifferenceState, action: EngineAction): SpotDifferenceState {
  switch (action.type) {
    case "click":
      return click(state, action.seat, action.xPct, action.yPct, action.atMs);
    case "useHint":
      return applyHint(state, action.team, action.atMs);
    case "timeUp":
      return timeUp(state);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export function computeTeamScores(state: SpotDifferenceState): Record<TeamId, number> {
  const scores: Record<TeamId, number> = { A: 0, B: 0 };
  for (const stage of state.stages) {
    for (const team of Object.values(stage.foundBy)) scores[team] += 1;
  }
  return scores;
}

export function totalSpotCount(state: SpotDifferenceState): number {
  return state.stages.reduce((sum, s) => sum + s.spots.length, 0);
}

export function foundSpotCount(state: SpotDifferenceState): number {
  return state.stages.reduce((sum, s) => sum + Object.keys(s.foundBy).length, 0);
}

export interface RankedTeam {
  team: TeamId;
  rank: number;
  score: number;
}

/** Higher team total wins; equal totals are a genuine co-win (both rank 1) — same convention as No Thanks's `computeRankings`. */
export function computeTeamRankings(state: SpotDifferenceState): RankedTeam[] {
  const scores = computeTeamScores(state);
  const entries = (["A", "B"] as TeamId[]).map((team) => ({ team, score: scores[team] }));
  return entries
    .map((entry) => ({ ...entry, rank: 1 + entries.filter((o) => o.score > entry.score).length }))
    .sort((a, b) => a.rank - b.rank);
}

/** Per-seat ranking, for feeding `GameCompletionResult` — every seat inherits its team's rank. */
export function computeRankings(state: SpotDifferenceState): { seat: SeatIndex; rank: number }[] {
  const rankOf: Record<TeamId, number> = { A: 0, B: 0 };
  for (const t of computeTeamRankings(state)) rankOf[t.team] = t.rank;
  return Object.entries(state.teamOf).map(([seat, team]) => ({ seat: Number(seat), rank: rankOf[team] }));
}
