import {
  cheatAllowed,
  computeRankings,
  DECLARE_IDS,

  pendingSeats,
  previewPlan,
  SEASONS,
  solveInputFor,
  solveRun,
  STRENGTH_IDS,
  TUNING,
  type Bet,
  type DayChoice,
  type Declare,
  type EngineAction,
  type ResolveState,
  type SeatIndex,
  type Strength,
} from "./engine";

/**
 * 작심삼일 bots. Lv.6+ use the exact optimal-stopping solver for daily
 * choices and plan EV; lower levels misjudge risk on purpose (fixed nerve
 * thresholds + noise). Late in the game a trailing bot takes bigger swings.
 */

type Rng = () => number;

/** Rough worth of a success/failure beyond this season's points (cleaner bag vs 😞 + 📘). */
function futureTerms(state: ResolveState): { win: number; bust: number } {
  const left = SEASONS - state.season;
  return { win: Math.min(3, left * 0.6), bust: left > 0 ? -0.6 : 0 };
}

function standing(state: ResolveState, seat: SeatIndex): number {
  const me = state.players[seat].score;
  const best = Math.max(...state.players.filter((_, i) => i !== seat).map((p) => p.score));
  return me - best;
}

function choosePlan(state: ResolveState, seat: SeatIndex, level: number, rng: Rng): Extract<EngineAction, { type: "plan" }> {
  const step = state.step;
  if (level <= 2 && rng() < 0.7) {
    const strength = STRENGTH_IDS[Math.floor(rng() * 3)];
    const declare = DECLARE_IDS[Math.floor(rng() * (level === 1 ? 3 : 2))];
    return { type: "plan", seat, step, strength, declare, bet: randomBet(state, seat, rng, 0.4) };
  }
  const fut = futureTerms(state);
  const diff = standing(state, seat);
  const lateGame = state.season >= SEASONS - 1;
  // trailing late → prefer variance; leading late → prefer safety
  const swing = level >= 7 && lateGame ? (diff < -4 ? 0.25 : diff > 4 ? -0.15 : 0) : 0;
  const noise = (10 - level) * 0.45;
  let best: { strength: Strength; declare: Declare; u: number } | null = null;
  for (const strength of STRENGTH_IDS) {
    for (const declare of DECLARE_IDS) {
      const inp = previewPlan(state, seat, strength, declare);
      const win = inp.winValue + fut.win;
      const bust = inp.bustValue + fut.bust;
      const r = solveRun({ ...inp, winValue: win, bustValue: bust });
      const u = r.value + swing * inp.winValue * r.pushAllSuccess + (rng() - 0.5) * noise;
      if (!best || u > best.u) best = { strength, declare, u };
    }
  }
  const bet = level >= 4 ? smartBet(state, seat) : randomBet(state, seat, rng, 0.5);
  return { type: "plan", seat, step, strength: best!.strength, declare: best!.declare, bet };
}

function randomBet(state: ResolveState, seat: SeatIndex, rng: Rng, chance: number): Bet | null {
  if (rng() > chance || state.playerCount < 2) return null;
  let target = Math.floor(rng() * (state.playerCount - 1));
  if (target >= seat) target++;
  return { target, kind: rng() < 0.5 ? "cheer" : "watch" };
}

/** Best bet assuming each rival plays a medium (😤 + 💬) resolution. */
function smartBet(state: ResolveState, seat: SeatIndex): Bet | null {
  let best: { bet: Bet; ev: number } | null = null;
  const leader = computeRankings(state)[0].seat;
  for (let t = 0; t < state.playerCount; t++) {
    if (t === seat) continue;
    const p = solveRun({ ...previewPlan(state, t, "proper", "friend", 1), winValue: 1, bustValue: 0 }).pushAllSuccess;
    const pw = solveRun({ ...previewPlan(state, t, "proper", "friend", 0), winValue: 1, bustValue: 0 }).pushAllSuccess;
    // cheering the leader helps them more than it pays me
    const cheer = p * TUNING.cheerPay - (t === leader ? 0.6 : 0.15);
    const watch = (1 - pw) * 0.75 * TUNING.watchPay;
    if (!best || cheer > best.ev) best = { bet: { target: t, kind: "cheer" }, ev: cheer };
    if (watch > best.ev) best = { bet: { target: t, kind: "watch" }, ev: watch };
  }
  return best && best.ev > 0 ? best.bet : null;
}

function chooseDay(state: ResolveState, seat: SeatIndex, level: number, rng: Rng): Extract<EngineAction, { type: "day" }> {
  const step = state.step;
  const inp = solveInputFor(state, seat)!;
  const fut = futureTerms(state);
  const r = solveRun({ ...inp, winValue: inp.winValue + fut.win, bustValue: inp.bustValue + fut.bust }, cheatAllowed(state, seat));
  let choice: DayChoice;
  if (level >= 6) {
    choice = r.best;
    // a little human wobble below Lv.9 when the call is close
    if (level < 9 && choice !== "stop" && Math.abs((r.values.push ?? 0) - (r.values.stop ?? 0)) < 0.4 && rng() < 0.25) choice = "stop";
  } else {
    // nerve: P(success if I push on) needed to keep going
    const nerve = [0.15, 0.25, 0.35, 0.4, 0.45][Math.max(0, level - 1)] + (rng() - 0.5) * 0.3;
    choice = r.pushAllSuccess >= nerve ? "push" : "stop";
    if (choice === "push" && cheatAllowed(state, seat) && level >= 3 && state.day >= 6 && rng() < 0.3) choice = "cheat";
  }
  if (choice === "cheat" && !cheatAllowed(state, seat)) choice = "push";
  return { type: "day", seat, step, choice };
}

export function chooseBotAction(state: ResolveState, seat: SeatIndex, level: number, rng: Rng = Math.random): EngineAction | null {
  if (!pendingSeats(state).includes(seat)) return null;
  if (state.phase === "plan") return choosePlan(state, seat, level, rng);
  if (state.phase === "day") return chooseDay(state, seat, level, rng);
  if (state.phase === "review") return { type: "ready", seat, step: state.step };
  return null;
}
