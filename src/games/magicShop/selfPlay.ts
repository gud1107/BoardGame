import { seededRng } from "@/lib/rng";
import { applyAction, currentActor, startGame, type MagicState } from "./engine";
import { chooseBotAction } from "./bot";

/** Plays one bot game (`levels[seat]`) — used by the balance tests. */
export function playOut(levels: number[], seed: number): { state: MagicState; steps: number } {
  let s = startGame(levels.length, seed);
  const rng = seededRng(seed * 31 + 7);
  let steps = 0;
  while (s.phase === "playing" && steps < 5000) {
    const seat = currentActor(s)!;
    const move = chooseBotAction(s, seat, levels[seat], rng)!;
    const next = applyAction(s, move);
    if (next === s) throw new Error(`bot move rejected: ${JSON.stringify(move)}`);
    s = next;
    steps++;
  }
  return { state: s, steps };
}
