/**
 * A minimal, real-time regret-matching move sampler — the practical form of
 * "CFR-style" play a bot can run *live*, per decision.
 *
 * Full Counterfactual Regret Minimization converges toward a Nash
 * equilibrium by training over millions of self-play iterations *offline*,
 * then shipping the resulting fixed strategy table; that's a different
 * (much larger) project than a per-move decision function computed at play
 * time. What this module gives Level 8-10 bots instead is the same core
 * update rule CFR is built on — Hart & Mas-Colell's regret matching, "play
 * each action with probability proportional to its positive regret" —
 * applied fresh at decision time to *this* node's simulated payoffs. That's
 * enough to produce genuine probabilistic bluffing (never a flat "always
 * play the argmax") without a training pipeline, at the cost of not being a
 * provably-converged equilibrium the way a fully trained CFR table would be.
 */

export interface RegretCandidate<T> {
  move: T;
  /** Estimated payoff/EV for this move — any consistent scale, only relative differences matter. */
  value: number;
}

/**
 * Each move's selection probability is proportional to how much better it
 * looks than the candidate set's average value ("positive regret"). When no
 * move beats the average by more than the others (e.g. one dominant move,
 * every regret <= 0), falls back to a uniform mix over the tied best moves
 * rather than a hard, perfectly-predictable argmax.
 */
/**
 * `sharpness` (default 1 = textbook regret matching) raises each positive
 * regret to this power before normalizing into probabilities. A value > 1
 * concentrates more of the distribution's mass on the largest regrets
 * without ever zeroing out a smaller-but-still-positive one outright — still
 * a genuine mixed strategy (a real, if smaller, bluff probability survives),
 * just less willing to spend meaningful probability on an option that's only
 * marginally above average. Perudo's expert tier (perudo/engine.ts) uses
 * this to keep bluffing from diluting decisions that are already clearly
 * correct, while still mixing when candidates are genuinely close.
 */
export function regretMatchingDistribution<T>(
  candidates: ReadonlyArray<RegretCandidate<T>>,
  sharpness = 1,
): { move: T; probability: number }[] {
  if (candidates.length === 0) return [];
  if (candidates.length === 1) return [{ move: candidates[0].move, probability: 1 }];

  const avgValue = candidates.reduce((sum, c) => sum + c.value, 0) / candidates.length;
  const regrets = candidates.map((c) => Math.max(0, c.value - avgValue) ** sharpness);
  const totalRegret = regrets.reduce((a, b) => a + b, 0);

  if (totalRegret <= 0) {
    const best = Math.max(...candidates.map((c) => c.value));
    const top = candidates.filter((c) => c.value === best);
    return top.map((c) => ({ move: c.move, probability: 1 / top.length }));
  }

  return candidates.map((c, i) => ({ move: c.move, probability: regrets[i] / totalRegret }));
}

/** Samples one move from a `{ move, probability }` distribution using `rng() -> [0, 1)`. */
export function sampleFromDistribution<T>(
  distribution: ReadonlyArray<{ move: T; probability: number }>,
  rng: () => number,
): T {
  const r = rng();
  let cumulative = 0;
  for (const entry of distribution) {
    cumulative += entry.probability;
    if (r < cumulative) return entry.move;
  }
  return distribution[distribution.length - 1].move; // floating-point safety net
}
