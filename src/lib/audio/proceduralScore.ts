/**
 * Pure score DSL for the procedural game sound suites (proceduralSuite.ts) —
 * no Web Audio here, so every game's BGM can be unit-tested as data.
 *
 * A score is a list of tracks. Each track is one instrument voice plus a
 * whitespace-separated pattern, one token per `div` sixteenth steps:
 *   - `C4`, `F#3`, `Bb2`      — a note (`!` suffix = accent, e.g. `C4!`)
 *   - `C4+E4+G4`              — a chord (all notes start together)
 *   - `x` / `X`               — an unpitched hit / accented hit (drums)
 *   - `-`                     — tie: lengthens the previous note by one token
 *   - `.`                     — rest
 *   - `|`                     — bar line, ignored
 * Tracks loop independently, so a 16-token drum bar repeats under a 64-token
 * melody. `level` gates a track to `setIntensity(level)` and above (e.g. extra
 * percussion in the last round).
 */

export interface ScoreTrack {
  voice: string;
  pattern: string;
  /** Sixteenth steps per token (1 = 16ths, 2 = 8ths, 4 = quarters). Default 1. */
  div?: number;
  /** Gain multiplier for this track. Default 1. */
  gain?: number;
  /** Semitones added to every note. */
  transpose?: number;
  /** Only plays when the suite's intensity is at least this. Default 0. */
  level?: number;
  /** Only plays while intensity is below this (a calm layer that drops out). */
  maxLevel?: number;
}

export interface ScoreEvent {
  voice: string;
  /** Hz; 0 for an unpitched hit. */
  freq: number;
  /** Length in sixteenth steps. */
  steps: number;
  accent: boolean;
  gain: number;
  level: number;
  maxLevel: number;
}

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** `A4` → 440 Hz. Accepts `#`/`b` accidentals. Throws on garbage so a typo fails the score test. */
export function noteToFreq(note: string, transpose = 0): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(note);
  if (!m) throw new Error(`bad note "${note}"`);
  const semis = NOTE_INDEX[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + (Number(m[3]) + 1) * 12 + transpose;
  return 440 * 2 ** ((semis - 69) / 12);
}

export interface CompiledTrack {
  length: number;
  /** step-in-track → events starting there */
  at: ScoreEvent[][];
}

export function compileTrack(track: ScoreTrack): CompiledTrack {
  const div = track.div ?? 1;
  const tokens = track.pattern.split(/\s+/).filter((t) => t && t !== "|");
  const at: ScoreEvent[][] = Array.from({ length: tokens.length * div }, () => []);
  let last: ScoreEvent[] | null = null;
  tokens.forEach((raw, i) => {
    if (raw === "-") {
      if (last) for (const e of last) e.steps += div;
      return;
    }
    if (raw === ".") {
      last = null;
      return;
    }
    const accent = raw.endsWith("!") || raw === "X";
    const body = raw.replace(/!$/, "");
    const base = { voice: track.voice, steps: div, accent, gain: track.gain ?? 1, level: track.level ?? 0, maxLevel: track.maxLevel ?? Infinity };
    const events: ScoreEvent[] =
      body === "x" || body === "X"
        ? [{ ...base, freq: 0 }]
        : body.split("+").map((n) => ({ ...base, freq: noteToFreq(n, track.transpose ?? 0) }));
    at[i * div].push(...events);
    last = events;
  });
  return { length: tokens.length * div, at };
}

export function compileScore(tracks: ScoreTrack[]): CompiledTrack[] {
  return tracks.map(compileTrack);
}

/** Every event that starts on global sixteenth `step` at the given intensity. */
export function eventsAt(score: CompiledTrack[], step: number, intensity = 0): ScoreEvent[] {
  const out: ScoreEvent[] = [];
  for (const t of score) {
    if (t.length === 0) continue;
    for (const e of t.at[((step % t.length) + t.length) % t.length]) {
      if (intensity >= e.level && intensity < e.maxLevel) out.push(e);
    }
  }
  return out;
}

/** The longest track length — one full pass of the score. */
export function loopLength(score: CompiledTrack[]): number {
  return score.reduce((m, t) => Math.max(m, t.length), 0);
}
