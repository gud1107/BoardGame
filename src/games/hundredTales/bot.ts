import { clampBotLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";
import { canStop, drawOdds, storyPoints, type EngineAction, type Seat, type TalesState } from "./engine";

/**
 * 백 개의 괴담 AI (rulebook §9). The bot only ever uses public information
 * (`drawOdds` counts the unseen cards; the deck order is read only when the
 * 🪞 mirror has turned the top card face up for everyone).
 *
 *  - Lv.1–3: a "nerve" — keeps telling until the story has N tales, with N
 *    rolled each turn, and ignores the candles until they're nearly out.
 *  - Lv.4–7: expected value of one more tale, with a risk appetite that
 *    tightens with the level.
 *  - Lv.8–10: same EV, plus the table: a leader near the end banks early,
 *    a trailer pushes harder, and the curse is priced in exactly.
 */

interface Params {
  /** Lv.1–3: tales to aim for each turn. */
  nerve: [number, number] | null;
  /** EV must beat this many points to go on (lower = braver). */
  margin: number;
  /** Extra caution per point already at stake. */
  stakeAversion: number;
  table: boolean;
  noise: number;
}

function paramsFor(level: BotLevel): Params {
  const l = clampBotLevel(level);
  if (l <= 3) return { nerve: l === 1 ? [1, 5] : l === 2 ? [2, 4] : [2, 4], margin: 0, stakeAversion: 0, table: false, noise: 0 };
  if (l <= 7) return { nerve: null, margin: 0.9 - (l - 4) * 0.25, stakeAversion: 0.05 - (l - 4) * 0.01, table: false, noise: 1.2 - (l - 4) * 0.3 };
  return { nerve: null, margin: 0, stakeAversion: 0, table: true, noise: l === 8 ? 0.2 : 0 };
}

export function chooseBotAction(s: TalesState, seat: Seat, level: BotLevel, rng: () => number = Math.random): EngineAction {
  const base = { seat, turn: s.turn };
  if (!canStop(s)) return { type: "draw", ...base };
  const p = paramsFor(level);
  const odds = drawOdds(s, seat);
  const stake = storyPoints(s.story);

  if (p.nerve) {
    // rolled once per turn: hash the turn start so the bot doesn't re-roll every draw
    const [lo, hi] = p.nerve;
    const roll = lo + (((s.turn - s.told) * 2654435761) >>> 0) % (hi - lo + 1);
    if (s.candles <= 4 && rng() < 0.5) return { type: "stop", ...base };
    return s.story.length < roll && odds.bust < 0.6 ? { type: "draw", ...base } : { type: "stop", ...base };
  }

  let threshold = p.margin + p.stakeAversion * stake * stake;
  if (p.table) {
    const others = s.scores.filter((_, i) => i !== seat);
    const best = Math.max(...others);
    const mine = s.scores[seat] + stake;
    const lateness = 1 - s.candles / s.candlesMax;
    // ahead near the end: lock it in; behind: the pie is running out, push
    if (mine > best) threshold += lateness * 1.5;
    else threshold -= lateness * Math.min(3, (best - mine) / 6);
  }
  const ev = odds.gain + (p.noise ? (rng() - 0.5) * 2 * p.noise : 0);
  return ev > threshold ? { type: "draw", ...base } : { type: "stop", ...base };
}
