/**
 * Shared deterministic randomness for every game engine (`src/games/<gameId>/engine.ts`).
 *
 * Every engine's `startGame`/`startRound` takes a seed and derives its initial
 * state deterministically via `seededRng(seed)` — this is what lets the online
 * lockstep sync (see ARCHITECTURE.md §1, docs/cloud-sync.md) work without a
 * server-authoritative engine: the host broadcasts one number, and every
 * client computes the identical shuffle/deal independently.
 *
 * This module used to be copy-pasted verbatim into all 10 engines. It was
 * extracted here during the 2026-08-09 docs/architecture cleanup session —
 * pure move, no behavior change (byte-identical implementation, verified by
 * the full Vitest suite passing unchanged). Per ARCHITECTURE.md §4, new
 * engines should import from here rather than redefining these.
 */

/** Deterministic PRNG (mulberry32). Same seed always produces the same sequence. */
export function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle, driven by an injected RNG (usually `seededRng(seed)`). */
export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
