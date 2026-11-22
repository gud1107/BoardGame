import { seededRng } from "@/lib/rng";
import { clampBotLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";
import { crowdOf } from "./data";
import { BETS, kindOf, questionOf, scoreRound, type Bet, type ChoiceState, type Move, type RoundKind, type Seat } from "./engine";

/**
 * 모두의 선택 bots (rulebook §8). A bot only sees public state — the question,
 * the round type and past rounds — never anyone's pick this round (those are
 * still hashes when it decides).
 *
 * - Every bot has an honest favourite, drawn from the question's crowd
 *   weights (seeded per game/round/seat, so it's stable across reloads).
 * - It forecasts the table as "everyone answers honestly" (🔄 rounds: half
 *   of them go contrarian) and Monte-Carlo-scores every (option, bet) pair
 *   with the real `scoreRound`.
 * - Level sets how often it answers honestly instead of strategically, and
 *   how sharply it picks the best expected value.
 */

const SAMPLES = 160;

function sample(p: number[], rng: () => number): number {
  let r = rng();
  for (let i = 0; i < p.length; i++) {
    r -= p[i];
    if (r <= 0) return i;
  }
  return p.length - 1;
}

/** How the bot thinks the others will answer. */
export function forecast(p: number[], kind: RoundKind): number[] {
  if (kind !== "reverse") return p;
  const u = 1 / p.length;
  return p.map((x) => 0.5 * x + 0.5 * u);
}

/** Expected score of every (option, bet) for `seat` against a forecast table. */
export function expectedValues(s: ChoiceState, seat: Seat, rng: () => number): number[][] {
  const q = questionOf(s);
  const kind = kindOf(s);
  const p = forecast(crowdOf(q), kind);
  const n = s.playerCount;
  const ev = q.opts.map(() => [0, 0, 0]);
  const picks: (number | null)[] = Array(n).fill(0);
  const bets: number[] = Array(n).fill(1);
  for (let k = 0; k < SAMPLES; k++) {
    for (let o = 0; o < n; o++) if (o !== seat) picks[o] = sample(p, rng);
    for (let i = 0; i < q.opts.length; i++) {
      picks[seat] = i;
      for (const b of BETS) {
        bets[seat] = b;
        ev[i][b - 1] += scoreRound(kind, q.opts.length, picks, bets).deltas[seat];
      }
    }
  }
  return ev.map((row) => row.map((v) => v / SAMPLES));
}

/** The bot's honest favourite for this round. */
export function honestPick(s: ChoiceState, seat: Seat): number {
  const rng = seededRng((s.seed ^ Math.imul(s.round + 1, 0x9e3779b1) ^ Math.imul(seat + 1, 0x85ebca6b)) | 0);
  return sample(crowdOf(questionOf(s)), rng);
}

export function chooseBotMove(s: ChoiceState, seat: Seat, level: BotLevel, rng: () => number = Math.random): Move {
  const lv = clampBotLevel(level);
  const skill = (lv - 1) / 9;
  const ev = expectedValues(s, seat, rng);
  const temp = 0.15 + (1 - skill) * 1.6;
  const soft = (vals: number[]) => {
    const m = Math.max(...vals);
    const w = vals.map((v) => Math.exp((v - m) / temp));
    const sum = w.reduce((a, b) => a + b, 0);
    return sample(
      w.map((x) => x / sum),
      rng,
    );
  };
  // low levels often just answer what they like
  if (rng() < 0.7 * (1 - skill)) {
    const pick = honestPick(s, seat);
    return { pick, bet: (soft(ev[pick]) + 1) as Bet };
  }
  const flat = ev.flat();
  const k = soft(flat);
  return { pick: Math.floor(k / 3), bet: ((k % 3) + 1) as Bet };
}
