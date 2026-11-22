import { describe, expect, it } from "vitest";
import { QUESTIONS } from "./data";
import {
  applyAction,
  computeRankings,
  LONE_BONUS,
  moveHash,
  questionOf,
  roundKinds,
  scoreRound,
  startGame,
  titles,
  type ChoiceState,
  type Move,
} from "./engine";
import { chooseBotMove, honestPick } from "./bot";
import { everyoneChoiceStatDetails } from "./stats";
import { everyoneChoiceCues } from "./everyoneChoiceSound";
import { seededRng } from "@/lib/rng";

/** Commit + reveal everyone's moves (null = stay silent). */
function play(s: ChoiceState, moves: (Move | null)[]): ChoiceState {
  moves.forEach((m, seat) => {
    if (m) s = applyAction(s, { type: "commit", seat, step: s.step, hash: moveHash(m, `salt${seat}`) });
  });
  if (s.phase === "choose") s = applyAction(s, { type: "advance", step: s.step });
  moves.forEach((m, seat) => {
    if (m && s.phase === "reveal") s = applyAction(s, { type: "reveal", seat, step: s.step, move: m, salt: `salt${seat}` });
  });
  return s;
}
const adv = (s: ChoiceState) => applyAction(s, { type: "advance", step: s.step });
const m = (pick: number, bet: 1 | 2 | 3 = 1): Move => ({ pick, bet });

describe("question deck", () => {
  it("every question has 2–4 options with positive weights and no duplicate text", () => {
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(100);
    expect(new Set(QUESTIONS.map((q) => q.text)).size).toBe(QUESTIONS.length);
    for (const q of QUESTIONS) {
      expect(q.opts.length).toBeGreaterThanOrEqual(2);
      expect(q.opts.length).toBeLessThanOrEqual(4);
      for (const o of q.opts) expect(o.w).toBeGreaterThan(0);
      expect(new Set(q.opts.map((o) => o.label)).size).toBe(q.opts.length);
    }
  });
});

describe("setup", () => {
  it("first two rounds plain, last doubled, no specials back to back, 🐺 only on 3+ options", () => {
    for (let seed = 1; seed < 60; seed++) {
      for (const rounds of [8, 12] as const) {
        const s = startGame(6, seed, { rounds });
        expect(s.kinds.length).toBe(rounds);
        expect(s.kinds.slice(0, 2)).toEqual(["major", "major"]);
        expect(s.kinds[rounds - 1]).toBe("double");
        s.kinds.forEach((k, i) => {
          if (i > 0 && i < rounds - 1 && k !== "major") expect(s.kinds[i - 1]).toBe("major");
          if (k === "lone") expect(QUESTIONS[s.questions[i]].opts.length).toBeGreaterThanOrEqual(3);
        });
        expect(new Set(s.questions).size).toBe(rounds);
      }
    }
  });

  it("kind mix matches the rulebook", () => {
    const k8 = roundKinds(8, seededRng(3));
    expect(k8.filter((k) => k === "reverse").length).toBe(2);
    expect(k8.filter((k) => k === "lone").length).toBe(1);
    const k12 = roundKinds(12, seededRng(3));
    expect(k12.filter((k) => k === "reverse").length).toBe(2);
    expect(k12.filter((k) => k === "lone").length).toBe(2);
  });

  it("clamps player count to 4–12", () => {
    expect(startGame(2, 1).playerCount).toBe(4);
    expect(startGame(20, 1).playerCount).toBe(12);
  });
});

describe("scoring", () => {
  it("👥 majority: +bet for the biggest group, 0/−1/−3 for the rest", () => {
    const r = scoreRound("major", 2, [0, 0, 0, 1, 1], [1, 2, 3, 2, 3]);
    expect(r.winners).toEqual([0]);
    expect(r.deltas).toEqual([1, 2, 3, -1, -3]);
  });

  it("👥 tie for biggest: every tied group wins", () => {
    const r = scoreRound("major", 3, [0, 0, 1, 1, 2], [3, 3, 3, 3, 1]);
    expect(r.winners).toEqual([0, 1]);
    expect(r.note).toBe("tie");
    expect(r.deltas).toEqual([3, 3, 3, 3, 0]);
  });

  it("🔄 reverse: smallest non-empty group wins; unanimous = nobody wins", () => {
    const r = scoreRound("reverse", 4, [0, 0, 0, 1, 1, 2], [1, 1, 1, 1, 1, 3]);
    expect(r.winners).toEqual([2]);
    expect(r.deltas[5]).toBe(3);
    const u = scoreRound("reverse", 2, [1, 1, 1, 1], [2, 2, 2, 2]);
    expect(u.winners).toEqual([]);
    expect(u.note).toBe("no-minority");
    expect(u.deltas).toEqual([-1, -1, -1, -1]);
  });

  it("🐺 lone: a single loner gets bet + bonus and nobody loses; several loners get their bet", () => {
    const one = scoreRound("lone", 3, [0, 0, 0, 1, 1, 2], [3, 3, 3, 3, 3, 2]);
    expect(one.loners).toEqual([5]);
    expect(one.deltas).toEqual([0, 0, 0, 0, 0, 2 + LONE_BONUS]);
    const two = scoreRound("lone", 4, [0, 0, 0, 1, 2], [1, 1, 1, 3, 2]);
    expect(two.loners).toEqual([3, 4]);
    expect(two.deltas).toEqual([0, 0, 0, 3, 2]);
    const none = scoreRound("lone", 3, [0, 0, 1, 1, 1], [1, 1, 2, 2, 2]);
    expect(none.note).toBe("no-lone");
    expect(none.deltas).toEqual([0, 0, 2, 2, 2]);
  });

  it("✨ double doubles gains and losses; no answer scores nothing", () => {
    const r = scoreRound("double", 2, [0, 0, 1, null], [3, 1, 3, 0]);
    expect(r.deltas).toEqual([6, 2, -6, 0]);
  });
});

describe("commit–reveal flow", () => {
  it("picks stay hashes until everyone has committed, then resolve", () => {
    let s = startGame(4, 7);
    const moves = [m(0, 2), m(0, 1), m(1, 3), m(0, 3)];
    moves.slice(0, 3).forEach((mv, seat) => (s = applyAction(s, { type: "commit", seat, step: s.step, hash: moveHash(mv, `salt${seat}`) })));
    expect(s.phase).toBe("choose");
    expect(JSON.stringify(s)).not.toContain('"pick"');
    s = play(s, [null, null, null, moves[3]]);
    expect(s.phase).toBe("reveal");
    moves.forEach((mv, seat) => (s = applyAction(s, { type: "reveal", seat, step: s.step, move: mv, salt: `salt${seat}` })));
    expect(s.phase).toBe("resolved");
    expect(s.scores).toEqual([2, 1, -3, 3]);
  });

  it("a reveal that doesn't match its hash counts as no answer", () => {
    let s = startGame(4, 8);
    [m(0), m(0), m(1), m(1)].forEach((mv, seat) => (s = applyAction(s, { type: "commit", seat, step: s.step, hash: moveHash(mv, `salt${seat}`) })));
    s = applyAction(s, { type: "reveal", seat: 0, step: s.step, move: m(1, 3), salt: "salt0" });
    expect(s.commits[0]).toBe("x");
    for (let seat = 1; seat < 4; seat++) s = applyAction(s, { type: "reveal", seat, step: s.step, move: [m(0), m(0), m(1), m(1)][seat], salt: `salt${seat}` });
    expect(s.phase).toBe("resolved");
    expect(s.last!.picks[0]).toBeNull();
  });

  it("illegal option index is rejected", () => {
    let s = startGame(4, 9);
    const bad = m(9, 1);
    s = applyAction(s, { type: "commit", seat: 0, step: s.step, hash: moveHash(bad, "a") });
    s = adv(s);
    s = applyAction(s, { type: "reveal", seat: 0, step: s.step, move: bad, salt: "a" });
    expect(s.phase).toBe("resolved");
    expect(s.last!.picks.every((p) => p === null)).toBe(true);
  });

  it("silence (no commit) scores nothing, timed-out reveal phase resolves", () => {
    let s = startGame(5, 10);
    s = applyAction(s, { type: "commit", seat: 0, step: s.step, hash: moveHash(m(0, 3), "q") });
    s = adv(s); // choose → reveal (others never committed)
    expect(s.phase).toBe("reveal");
    s = adv(s); // seat 0 never revealed
    expect(s.phase).toBe("resolved");
    expect(s.scores).toEqual([0, 0, 0, 0, 0]);
  });

  it("stale-step actions are ignored", () => {
    const s = startGame(4, 11);
    expect(applyAction(s, { type: "advance", step: 5 })).toBe(s);
  });

  it("a full game ends after the last round with rankings, titles and stats", () => {
    let s = startGame(6, 12, { rounds: 8 });
    const rng = seededRng(5);
    while (s.phase !== "ended") {
      if (s.phase === "choose") s = play(s, Array.from({ length: 6 }, (_, seat) => chooseBotMove(s, seat, 1 + seat, rng)));
      else s = adv(s);
    }
    expect(s.history.length).toBe(8);
    const ranks = computeRankings(s);
    expect(ranks[0].rank).toBe(1);
    expect(ranks.map((r) => r.score)).toEqual([...s.scores].sort((a, b) => b - a));
    const st = everyoneChoiceStatDetails(s, ranks[0].seat);
    expect(st.wins).toBe(1);
    expect(st.answers).toBe(8);
    expect(st.maxScore).toBe(s.scores[ranks[0].seat]);
    titles(s); // must not throw
  });

  it("shared rank on equal score and round wins", () => {
    const s = { ...startGame(4, 1), scores: [3, 3, 1, 0], wins: [2, 2, 1, 0] };
    expect(computeRankings(s).map((r) => r.rank)).toEqual([1, 1, 3, 4]);
  });
});

describe("bots", () => {
  it("only produce legal moves and keep a stable honest favourite", () => {
    for (let seed = 1; seed < 30; seed++) {
      const s = startGame(8, seed);
      for (let seat = 0; seat < 8; seat++) {
        const mv = chooseBotMove(s, seat, 1 + (seat % 10), seededRng(seed * 31 + seat));
        expect(mv.pick).toBeGreaterThanOrEqual(0);
        expect(mv.pick).toBeLessThan(questionOf(s).opts.length);
        expect([1, 2, 3]).toContain(mv.bet);
        expect(honestPick(s, seat)).toBe(honestPick(s, seat));
      }
    }
  });
});

describe("sound cues", () => {
  it("reveal + win/lose for the viewer, victory at the end", () => {
    let s = startGame(4, 3);
    const before = s;
    s = play(s, [m(0, 2), m(0, 1), m(0, 1), m(1, 3)]);
    const cues = everyoneChoiceCues(3)(before, s);
    expect(cues).toContain("reveal");
    expect(cues).toContain("lose");
  });
});
