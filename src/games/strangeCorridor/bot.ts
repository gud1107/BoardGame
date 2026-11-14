import { clampBotLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";
import { correctPick, currentAnomaly, LOOK_MS, shownProps, type CorridorState, type EngineAction, type Seat } from "./engine";

/**
 * 이상한 복도 AI (rulebook §8). A bot "notices" the anomaly with a chance
 * that rises with its level (and drops for subtle kinds), and answers after a
 * human-like delay that shrinks with the level. When it doesn't notice, it
 * either says 이상 없음 (it walked past) or, on a normal round, sometimes
 * imagines something (a false alarm on a random prop).
 */

export function botParams(level: BotLevel) {
  const l = clampBotLevel(level);
  return {
    /** chance to see an obvious anomaly */
    eye: 0.38 + l * 0.058,
    /** chance to keep calm on a normal round */
    calm: 0.62 + l * 0.035,
    /** answer delay range (ms) */
    delay: [Math.max(2500, 12500 - l * 950), Math.max(5000, 17000 - l * 1000)] as [number, number],
  };
}

export function botDelayMs(level: BotLevel, rng: () => number = Math.random): number {
  const [lo, hi] = botParams(level).delay;
  return Math.min(LOOK_MS - 500, lo + rng() * (hi - lo));
}

export function chooseBotAnswer(s: CorridorState, seat: Seat, level: BotLevel, ms: number, rng: () => number = Math.random): EngineAction {
  const p = botParams(level);
  const anomaly = currentAnomaly(s);
  const base = { type: "answer" as const, seat, step: s.step, ms };
  const props = shownProps(s.layout, anomaly).filter((x) => !x.hidden);
  const randomProp = () => props[Math.floor(rng() * props.length)].id;
  if (!anomaly) return { ...base, pick: rng() < p.calm ? "none" : randomProp() };
  const subtle = anomaly.kind === "shift" || anomaly.kind === "tilt" ? 0.75 : 1;
  if (rng() < p.eye * subtle) return { ...base, pick: correctPick(anomaly) };
  // didn't spot it: mostly walk on, sometimes blame the wrong thing
  return { ...base, pick: rng() < 0.7 ? "none" : randomProp() };
}
