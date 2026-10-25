/**
 * Per-character temperament for the seated table rigs — pure math, no three.js, so it is
 * unit-tested directly. A persona never overrides what the game wants shown (moods, a
 * pointing arm, a big reaction); it decides where a calm player's eyes wander and how
 * restless they are, so a table of eight reads as eight different people:
 *
 *   starer   뚫어지게 — keeps looking straight at you
 *   shy      수줍음   — eyes on the table in front of them, quick glances up
 *   scanner  두리번   — glances around the table every second or so
 *   focused  집중형   — follows the game, barely moves
 *   dreamer  멍때림   — gazes off into the distance, slow to come back
 *   fidget   산만함   — fidgets a lot, glances at you now and then
 */

export type Persona = "starer" | "shy" | "scanner" | "focused" | "dreamer" | "fidget";

export const PERSONA_ORDER: Persona[] = ["starer", "shy", "scanner", "focused", "dreamer", "fidget"];

export const PERSONA_LABEL: Record<Persona, string> = {
  starer: "뚫어지게 보는",
  shy: "수줍은",
  scanner: "두리번거리는",
  focused: "집중하는",
  dreamer: "멍때리는",
  fidget: "산만한",
};

/** Seat → persona, spread so neighbours differ (seat 0, usually the viewer, still gets one). */
export function personaFor(seat: number): Persona {
  return PERSONA_ORDER[(seat * 5 + 1) % PERSONA_ORDER.length];
}

export interface PersonaStyle {
  /** Added head pitch (+ = looks down). */
  pitch: number;
  /** Multiplier on the idle head drift. */
  drift: number;
  /** Multiplier on eye openness. */
  eye: number;
  /** Chance per 7 s slot that a calm player breaks into a fidget (think/shrug). */
  fidget: number;
  /** How fast the head chases its target (per second). */
  turn: number;
}

export const PERSONA_STYLE: Record<Persona, PersonaStyle> = {
  starer: { pitch: 0, drift: 0.3, eye: 1.08, fidget: 0.15, turn: 5 },
  shy: { pitch: 0.12, drift: 0.6, eye: 0.85, fidget: 0.3, turn: 4 },
  scanner: { pitch: 0, drift: 1.2, eye: 1.05, fidget: 0.35, turn: 8 },
  focused: { pitch: 0.03, drift: 0.2, eye: 0.95, fidget: 0.12, turn: 5 },
  dreamer: { pitch: -0.05, drift: 0.8, eye: 0.8, fidget: 0.2, turn: 2 },
  fidget: { pitch: 0, drift: 1.4, eye: 1, fidget: 0.65, turn: 7 },
};

export type Gaze =
  /** whatever the game asked to look at (active player, table centre …) */
  | { kind: "cue" }
  /** straight at the viewer (the camera seat) */
  | { kind: "viewer" }
  /** at the table in front of their own seat */
  | { kind: "down" }
  /** off to the side / into the distance: head offsets in radians */
  | { kind: "away"; yaw: number; pitch: number };

const hash = (a: number, b: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** [slot seconds, [weight cue, viewer, down, away]] */
const SCHEDULE: Record<Persona, [number, [number, number, number, number]]> = {
  starer: [2.6, [0.3, 0.7, 0, 0]],
  shy: [3, [0.22, 0.03, 0.75, 0]],
  scanner: [1.1, [0.35, 0.2, 0.05, 0.4]],
  focused: [4, [0.95, 0.05, 0, 0]],
  dreamer: [4.2, [0.35, 0, 0.05, 0.6]],
  fidget: [1.6, [0.55, 0.15, 0.1, 0.2]],
};

/**
 * Where a calm player is looking at time `now`. `strong` = the game has something the player
 * must react to (their turn, a reveal, a big mood) — then everyone follows the cue.
 */
export function personaGaze(persona: Persona, now: number, seed: number, strong: boolean): Gaze {
  if (strong) return { kind: "cue" };
  const [slotLen, w] = SCHEDULE[persona];
  const t = now + seed * 1.7;
  const slot = Math.floor(t / slotLen);
  const r = hash(seed, slot);
  let acc = w[0];
  if (r < acc) return { kind: "cue" };
  acc += w[1];
  if (r < acc) return { kind: "viewer" };
  acc += w[2];
  if (r < acc) return { kind: "down" };
  const r2 = hash(seed + 17, slot);
  const side = r2 < 0.5 ? -1 : 1;
  return persona === "dreamer" ? { kind: "away", yaw: side * (0.45 + r2 * 0.3), pitch: -0.22 } : { kind: "away", yaw: side * (0.5 + r2 * 0.5), pitch: 0.05 };
}
