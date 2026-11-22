import { seededRng } from "@/lib/rng";
import { applyAction, pendingSeats, startGame, type EngineAction, type ResolveState } from "./engine";
import { chooseBotAction } from "./bot";

/** Plays one all-bot game (`levels[seat]`) — used by the balance tests. */
export function playOut(levels: number[], seed: number, override?: (s: ResolveState, seat: number) => EngineAction | null): { state: ResolveState; steps: number } {
  let s = startGame(levels.length, seed);
  const rng = seededRng(seed * 31 + 7);
  let steps = 0;
  while (s.phase !== "gameOver" && steps < 5000) {
    const seat = pendingSeats(s)[0];
    const move = override?.(s, seat) ?? chooseBotAction(s, seat, levels[seat], rng)!;
    const next = applyAction(s, move);
    if (next === s) throw new Error(`bot move rejected: ${JSON.stringify(move)}`);
    s = next;
    steps++;
  }
  return { state: s, steps };
}
