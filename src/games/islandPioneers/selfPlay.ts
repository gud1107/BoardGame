import { seededRng } from "@/lib/rng";
import { applyAction, currentActor, startGame, type IslandState } from "./engine";
import { chooseBotAction } from "./bot";

/** Plays one bot game (`levels[seat]`) — used by the balance tests. */
export function playOut(levels: number[], seed: number): { state: IslandState; turns: number } {
  let s = startGame(levels.length, seed);
  const rng = seededRng(seed * 31 + 7);
  let turns = 0;
  while (s.phase === "playing" && turns < 400) {
    const seat = currentActor(s)!;
    const move = chooseBotAction(s, seat, levels[seat], rng)!;
    const next = applyAction(s, move);
    if (next === s) throw new Error("bot move rejected");
    s = next;
    turns++;
  }
  return { state: s, turns };
}
