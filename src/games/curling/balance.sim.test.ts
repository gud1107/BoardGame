import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import { applyAction, currentSide, currentThrower, startGame, type CurlingState, type GameOptions } from "./engine";
import { planBotThrow, recordBotSweeps } from "./bot";

/**
 * Self-play balance check (rulebook §14). Skipped unless CURL_SIM is set:
 *   CURL_SIM=40 npx vitest run src/games/curling/balance.sim.test.ts --reporter=verbose
 */
const N = Number(process.env.CURL_SIM ?? 0);

/** levels[seat]; every side's bots sweep their own stones, the first rival bot sweeps past the tee. */
function playGame(levels: number[], seed: number, options: Partial<GameOptions>, sweep = true) {
  const rng = seededRng(seed * 31 + 7);
  let s: CurlingState = startGame(levels.length, seed, options);
  const firstHammer = s.hammer;
  let thinkMs = 0;
  let throws = 0;
  const calls: Record<string, number> = {};
  for (let guard = 0; guard < 400 && s.phase !== "ended"; guard++) {
    if (s.phase === "scored") {
      s = applyAction(s, { type: "next", turn: s.turn });
      continue;
    }
    const seat = currentThrower(s)!;
    const side = currentSide(s);
    const t0 = performance.now();
    const plan = planBotThrow(s, levels[seat], rng);
    thinkMs += performance.now() - t0;
    throws++;
    const mate = s.members[side].find((m) => m !== seat) ?? seat;
    const rivalSide = s.options.mode === "team" ? 1 - side : (side + 1) % s.sides;
    const rival = s.members[rivalSide][0];
    const sw = sweep ? recordBotSweeps(s, { ...plan, kind: plan.useCard ? s.cards[side] : null }, { own: levels[mate], opp: levels[rival], oppSide: rivalSide }, rng) : { own: [], opp: [] };
    s = applyAction(s, { type: "throw", seat, turn: s.turn, ...plan, ...sw });
    const k = s.lastThrow!.call.key;
    calls[k] = (calls[k] ?? 0) + 1;
  }
  return { s, firstHammer, thinkMs, throws, calls };
}

describe.skipIf(!N)("curling balance", { timeout: 3_600_000 }, () => {
  it("bot think time per throw by level", () => {
    for (const lv of [1, 5, 10]) {
      const r = playGame([lv, lv], 77, { ends: 1, party: true, stones: 8 });
      console.log(`Lv${lv} think ${(r.thinkMs / r.throws).toFixed(0)} ms/throw (8 stones/side end)`);
    }
  });

  it("Lv.N vs Lv.N 1v1: points per end, blank ends, hammer side, shot calls", () => {
    for (const lv of [3, 7]) {
      let ends = 0;
      let blanks = 0;
      let pts = 0;
      let hammerScored = 0;
      let steals = 0;
      const calls: Record<string, number> = {};
      for (let i = 0; i < N; i++) {
        const r = playGame([lv, lv], 1000 + i, { ends: 3, party: true });
        for (const e of r.s.history) {
          ends++;
          if (e.scorer === null) blanks++;
          else if (e.scorer === e.hammer) hammerScored++;
          else steals++;
          pts += e.points;
        }
        for (const [k, v] of Object.entries(r.calls)) calls[k] = (calls[k] ?? 0) + v;
      }
      console.log(`Lv${lv}×2: ${(pts / ends).toFixed(2)} pts/end, blank ${((blanks / ends) * 100).toFixed(0)}%, hammer scores ${((hammerScored / ends) * 100).toFixed(0)}%, steal ${((steals / ends) * 100).toFixed(0)}%`);
      console.log(`   calls ${JSON.stringify(calls)}`);
      expect(ends).toBeGreaterThan(0);
    }
  });

  it("level separation: Lv.10 vs Lv.1, Lv.7 vs Lv.4", () => {
    for (const [hi, lo] of [
      [10, 1],
      [7, 4],
      [6, 5],
    ]) {
      let win = 0;
      let draw = 0;
      for (let i = 0; i < N; i++) {
        const hiSeat = i % 2;
        const levels = hiSeat === 0 ? [hi, lo] : [lo, hi];
        const r = playGame(levels, 5000 + i, { ends: 3, party: true });
        const sc = r.s.scores;
        if (sc[hiSeat] > sc[1 - hiSeat]) win++;
        else if (sc[0] === sc[1]) draw++;
      }
      console.log(`Lv${hi} vs Lv${lo}: win ${((win / N) * 100).toFixed(0)}% draw ${((draw / N) * 100).toFixed(0)}%`);
    }
  });

  it("does the party stone matter? party off vs on, 2v2 Lv.5", () => {
    for (const party of [false, true]) {
      let pts = 0;
      let ends = 0;
      let firstHammerWins = 0;
      for (let i = 0; i < N; i++) {
        const r = playGame([5, 5, 5, 5], 9000 + i, { ends: 3, party });
        for (const e of r.s.history) {
          ends++;
          pts += e.points;
        }
        const top = Math.max(...r.s.scores);
        if (r.s.scores[r.firstHammer] === top && r.s.scores[1 - r.firstHammer] < top) firstHammerWins++;
      }
      console.log(`party=${party}: ${(pts / ends).toFixed(2)} pts/end, first-hammer side wins ${((firstHammerWins / N) * 100).toFixed(0)}%`);
    }
  });

  it("ffa 4p Lv.5: seat win spread", () => {
    const wins = [0, 0, 0, 0];
    for (let i = 0; i < N; i++) {
      const r = playGame([5, 5, 5, 5], 12000 + i, { mode: "ffa", ends: 3, party: true });
      const top = Math.max(...r.s.scores);
      r.s.scores.forEach((sc, k) => {
        if (sc === top) wins[k]++;
      });
    }
    console.log(`ffa4 Lv5 wins by seat ${wins.join(" / ")}`);
  });
});
