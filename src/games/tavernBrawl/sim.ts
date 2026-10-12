import { seededRng } from "@/lib/rng";
import { chooseBotAction } from "./bot";
import { applyAction, pendingSeats, startGame, type GameOptions, type GameState } from "./engine";

/** 봇 자가대전 한 판(테스트·밸런스 측정용). levels[seat] = 봇 레벨. */
export function playBotGame(levels: number[], seed: number, options?: GameOptions, randomHeroes = false): { state: GameState; rounds: number } {
  let st = startGame(levels.length, seed, options);
  const rng = seededRng(seed ^ 0x9e3779b9);
  for (let guard = 0; guard < 5000 && st.phase !== "ended"; guard++) {
    const pending = pendingSeats(st);
    if (pending.length === 0) {
      st = applyAction(st, { type: "TIMEOUT", stage: st.stage });
      continue;
    }
    const seat = pending[0];
    if (randomHeroes && st.phase === "heroPick") {
      const opts = st.seats[seat].heroOptions;
      st = applyAction(st, { type: "PICK_HERO", seat, hero: opts[Math.floor(rng() * opts.length)] });
      continue;
    }
    const a = chooseBotAction(st, seat, levels[seat], rng);
    const next = a ? applyAction(st, a) : st;
    st = next === st ? applyAction(st, { type: "TIMEOUT", stage: st.stage }) : next;
  }
  return { state: st, rounds: st.round };
}
