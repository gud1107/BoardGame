import { describe, expect, it } from "vitest";
import {
  applyAction,
  bustChance,
  compromiseGain,
  computeRankings,
  CRISIS_DAY,
  DAYS,
  pendingSeats,
  previewPlan,
  SEASONS,
  solveRun,
  startGame,
  successGain,
  EVENTS,
  TUNING,
  type EngineAction,
  type ResolveState,
} from "./engine";
import { chooseBotAction } from "./bot";
import { playOut } from "./selfPlay";
import { resolveSoundCues } from "./threeDayResolveSound";
import { threeDayResolveStatDetails } from "./stats";

const calm = EVENTS[0];

function planAll(s: ResolveState, plan: Omit<Extract<EngineAction, { type: "plan" }>, "seat" | "step" | "type">): ResolveState {
  for (let seat = 0; seat < s.playerCount; seat++) s = applyAction(s, { type: "plan", seat, step: s.step, ...plan });
  return s;
}

describe("작심삼일 engine", () => {
  it("starts in the plan phase with a calm first season and identical bags", () => {
    const s = startGame(4, 42);
    expect(s.phase).toBe("plan");
    expect(s.events[0]).toBe("calm");
    expect(new Set(s.events).size).toBe(SEASONS);
    expect(s.players.every((p) => p.bag.will === TUNING.startBag.will && p.limit === TUNING.startLimit)).toBe(true);
    expect(pendingSeats(s)).toEqual([0, 1, 2, 3]);
  });

  it("is deterministic for the same seed and actions", () => {
    const a = playOut([5, 8, 3], 77).state;
    const b = playOut([5, 8, 3], 77).state;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("reveals only after everyone planned, then applies strength tokens, declare limit and cheers", () => {
    let s = startGame(3, 1);
    s = applyAction(s, { type: "plan", seat: 0, step: s.step, strength: "hard", declare: "sns", bet: null });
    expect(s.phase).toBe("plan");
    s = applyAction(s, { type: "plan", seat: 1, step: s.step, strength: "light", declare: "solo", bet: { target: 0, kind: "cheer" } });
    s = applyAction(s, { type: "plan", seat: 2, step: s.step, strength: "proper", declare: "friend", bet: { target: 0, kind: "watch" } });
    expect(s.phase).toBe("day");
    expect(s.day).toBe(1);
    const r0 = s.players[0].run!;
    // hard adds 4 temptations, SNS −1 limit, one cheer +1
    expect(r0.pool.excuse).toBe(TUNING.startBag.excuse + 1);
    expect(r0.limit).toBe(TUNING.startLimit - 1 + 1);
    expect(r0.cheers).toBe(1);
    expect(s.players[1].run!.limit).toBe(TUNING.startLimit + 1);
  });

  it("rejects stale steps, double plans, self-bets and cheat on the crisis day", () => {
    let s = startGame(2, 3);
    const stale = applyAction(s, { type: "plan", seat: 0, step: s.step - 1, strength: "light", declare: "solo", bet: null });
    expect(stale).toBe(s);
    expect(applyAction(s, { type: "plan", seat: 0, step: s.step, strength: "light", declare: "solo", bet: { target: 0, kind: "cheer" } })).toBe(s);
    s = applyAction(s, { type: "plan", seat: 0, step: s.step, strength: "light", declare: "solo", bet: null });
    expect(applyAction(s, { type: "plan", seat: 0, step: s.step, strength: "hard", declare: "solo", bet: null })).toBe(s);
    s = applyAction(s, { type: "plan", seat: 1, step: s.step, strength: "light", declare: "solo", bet: null });
    // force day 3 by cheat on day 1 + push on day 2 for a bag with no temptation
    s.players.forEach((p) => {
      p.run!.pool = { will: 5, tired: 0, snack: 0, lazy: 0, excuse: 0, guilt: 0 };
    });
    for (const choice of ["push", "push"] as const) {
      s = applyAction(s, { type: "day", seat: 0, step: s.step, choice });
      s = applyAction(s, { type: "day", seat: 1, step: s.step, choice });
    }
    expect(s.day).toBe(CRISIS_DAY);
    expect(applyAction(s, { type: "day", seat: 0, step: s.step, choice: "cheat" })).toBe(s);
  });

  it("a temptation-free bag always succeeds and pays strength × declare", () => {
    let s = startGame(2, 9);
    s = planAll(s, { strength: "hard", declare: "friend", bet: null });
    s.players.forEach((p) => (p.run!.pool = { will: 4, tired: 0, snack: 0, lazy: 0, excuse: 0, guilt: 0 }));
    for (let d = 1; d <= DAYS; d++) for (let seat = 0; seat < 2; seat++) s = applyAction(s, { type: "day", seat, step: s.step, choice: "push" });
    expect(s.phase).toBe("review");
    expect(s.players[0].score).toBe(successGain("hard", "friend", calm));
    expect(s.players[0].successes).toBe(1);
    expect(s.players[0].run!.drawn.length).toBe(DAYS + 1); // crisis day draws two
  });

  it("busting adds 😞 + 📘 and the declare penalty; 📘 then blocks the breaking token", () => {
    let s = startGame(2, 11);
    s = planAll(s, { strength: "light", declare: "sns", bet: null });
    s.players[0].run!.pool = { will: 0, tired: 0, snack: 0, lazy: 0, excuse: 1, guilt: 0 };
    s.players[1].run!.pool = { will: 1, tired: 0, snack: 0, lazy: 0, excuse: 0, guilt: 0 };
    while (s.phase === "day") {
      for (const seat of pendingSeats(s)) s = applyAction(s, { type: "day", seat, step: s.step, choice: seat === 0 ? "push" : "stop" });
    }
    const p0 = s.players[0];
    expect(p0.run!.status).toBe("busted");
    expect(p0.score).toBe(-5);
    expect(p0.bag.guilt).toBe(1);
    expect(p0.lessons).toBe(1);
    // seat 1 stopped on day 1 after 0 days → 0 − face 2
    expect(s.players[1].score).toBe(compromiseGain("sns", 0));

    // next season: the lesson blocks the first breaking draw
    for (const seat of [0, 1]) s = applyAction(s, { type: "ready", seat, step: s.step });
    s = planAll(s, { strength: "light", declare: "solo", bet: null });
    s.players[0].run!.pool = { will: 0, tired: 0, snack: 0, lazy: 0, excuse: 1, guilt: 0 };
    s.players[0].run!.sum = s.players[0].run!.limit - 1;
    s = applyAction(s, { type: "day", seat: 0, step: s.step, choice: "push" });
    s = applyAction(s, { type: "day", seat: 1, step: s.step, choice: "push" });
    expect(s.players[0].lessons).toBe(0);
    expect(s.players[0].run!.status).toBe("going");
    expect(s.log.some((e) => e.kind === "block" && e.seat === 0)).toBe(true);
  });

  it("bets pay out at season end", () => {
    let s = startGame(3, 5);
    s = applyAction(s, { type: "plan", seat: 0, step: s.step, strength: "light", declare: "solo", bet: { target: 1, kind: "cheer" } });
    s = applyAction(s, { type: "plan", seat: 1, step: s.step, strength: "light", declare: "solo", bet: null });
    s = applyAction(s, { type: "plan", seat: 2, step: s.step, strength: "light", declare: "solo", bet: { target: 1, kind: "watch" } });
    s.players.forEach((p) => (p.run!.pool = { will: 3, tired: 0, snack: 0, lazy: 0, excuse: 0, guilt: 0 }));
    while (s.phase === "day") for (const seat of pendingSeats(s)) s = applyAction(s, { type: "day", seat, step: s.step, choice: "push" });
    expect(s.players[0].history[0].betGain).toBe(TUNING.cheerPay);
    expect(s.players[2].history[0].betGain).toBe(0);
  });

  it("timeouts auto-pick light/solo, compromise and ready", () => {
    let s = startGame(2, 8);
    s = applyAction(s, { type: "timeout", seat: 0, step: s.step });
    expect(s.players[0].plan).toEqual({ strength: "light", declare: "solo", bet: null });
    s = applyAction(s, { type: "plan", seat: 1, step: s.step, strength: "light", declare: "solo", bet: null });
    s = applyAction(s, { type: "timeout", seat: 0, step: s.step });
    s = applyAction(s, { type: "day", seat: 1, step: s.step, choice: "stop" });
    expect(s.players[0].run!.status).toBe("stopped");
    expect(s.phase).toBe("review");
    s = applyAction(s, { type: "timeout", seat: 0, step: s.step });
    expect(s.players[0].ready).toBe(true);
  });

  it("bust chance and the solver agree with simple cases", () => {
    const bag = { will: 1, tired: 0, snack: 0, lazy: 0, excuse: 1, guilt: 0 };
    expect(bustChance({ pool: bag, sum: 5, limit: 7, lessons: 0 }, 1)).toBeCloseTo(0.5);
    expect(bustChance({ pool: bag, sum: 5, limit: 7, lessons: 1 }, 1)).toBeCloseTo(0);
    expect(bustChance({ pool: bag, sum: 0, limit: 7, lessons: 0 }, 2)).toBeCloseTo(0);
    const s = startGame(2, 1);
    const r = solveRun(previewPlan(s, 0, "light", "solo"));
    expect(r.pushAllSuccess).toBeGreaterThan(0.5);
    expect(r.pushAllSuccess).toBeLessThanOrEqual(1);
    const hard = solveRun(previewPlan(s, 0, "hard", "sns"));
    expect(hard.pushAllSuccess).toBeLessThan(r.pushAllSuccess);
  });

  it("bots always produce legal moves and games finish at every player count", () => {
    for (const n of [2, 3, 6]) {
      const { state } = playOut(Array.from({ length: n }, (_, i) => 1 + ((i * 3) % 10)), 300 + n);
      expect(state.phase).toBe("gameOver");
      expect(state.players.every((p) => p.history.length === SEASONS)).toBe(true);
      const ranks = computeRankings(state);
      expect(ranks[0].rank).toBe(1);
      const det = threeDayResolveStatDetails(state, ranks[0].seat, 1);
      expect(det.gamesWon).toBe(1);
      expect(det.successes + det.fails + det.compromises).toBe(SEASONS);
    }
  });

  it("bots return null for seats that owe nothing", () => {
    let s = startGame(2, 4);
    s = applyAction(s, { type: "plan", seat: 0, step: s.step, strength: "light", declare: "solo", bet: null });
    expect(chooseBotAction(s, 0, 5)).toBeNull();
    expect(chooseBotAction(s, 1, 5)?.type).toBe("plan");
  });

  it("sound cues fire for draws, crisis and the end", () => {
    const { state } = playOut([6, 6], 21);
    expect(resolveSoundCues(state, state)).toEqual([]);
    let s = startGame(2, 2);
    const before = s;
    s = planAll(s, { strength: "light", declare: "solo", bet: null });
    expect(resolveSoundCues(before, s)).toContain("reveal");
  });
});
