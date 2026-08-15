/**
 * Generic "determinize the hidden information, then evaluate" shell, shared
 * by every imperfect-information game's Level 8-10 bot. Perfect Information
 * Monte Carlo (PIMC, five-cucumbers/engine.ts) and Information Set Monte
 * Carlo Tree Search's determinization step (ISMCTS, perudo/engine.ts) both
 * reduce to the same procedure: sample N plausible "worlds" consistent with
 * only what this seat could fairly know (own hand/dice + public counts),
 * evaluate every candidate move against each sampled world, and average.
 * Each game supplies its own `determinize` (how to fill in unseen
 * cards/dice) and `evaluateInWorld` (how good a move looks once the hidden
 * info is fixed); this module is just the shared sampling/averaging loop.
 *
 * Deliberately uses the SAME determinized world across every candidate move
 * within a trial (common random numbers), not a fresh world per move — that
 * cancels shared sampling noise when comparing candidates, the standard
 * variance-reduction trick for this kind of Monte Carlo comparison.
 */

export interface MonteCarloConfig<World, Move> {
  determinize: (rng: () => number) => World;
  evaluateInWorld: (world: World, move: Move) => number;
  trials: number;
  rng: () => number;
}

export function evaluateMovesByDeterminization<World, Move>(
  moves: ReadonlyArray<Move>,
  config: MonteCarloConfig<World, Move>,
): { move: Move; averageValue: number }[] {
  const totals = new Array(moves.length).fill(0);
  for (let t = 0; t < config.trials; t++) {
    const world = config.determinize(config.rng);
    for (let i = 0; i < moves.length; i++) {
      totals[i] += config.evaluateInWorld(world, moves[i]);
    }
  }
  return moves.map((move, i) => ({ move, averageValue: totals[i] / config.trials }));
}
