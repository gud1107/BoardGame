import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import {
  applyAction,
  buildLayout,
  computeRankings,
  correctPick,
  currentAnomaly,
  LOOK_MS,
  pointsFor,
  shownProps,
  startGame,
  type CorridorState,
} from "./engine";
import { chooseBotAnswer } from "./bot";
import { strangeCorridorStatDetails } from "./stats";
import { strangeCorridorCues } from "./strangeCorridorSound";

const adv = (s: CorridorState) => applyAction(s, { type: "advance", step: s.step });
const answer = (s: CorridorState, seat: number, pick: string, ms = 1000) => applyAction(s, { type: "answer", seat, step: s.step, pick, ms });

describe("layout and script", () => {
  it("same seed, same corridor; unique prop ids", () => {
    const a = buildLayout(9);
    expect(a).toEqual(buildLayout(9));
    expect(new Set(a.map((p) => p.id)).size).toBe(a.length);
    expect(a.filter((p) => p.kind === "door").length).toBe(6);
  });

  it("round 0 is the study walk; rounds mix anomalies and normal halls", () => {
    for (let seed = 1; seed < 60; seed++) {
      const s = startGame(3, seed, { rounds: 12, difficulty: "hard", scare: true });
      expect(s.script.length).toBe(13);
      expect(s.script[0]).toBeNull();
      const normals = s.script.slice(1).filter((a) => a === null).length;
      expect(normals).toBeGreaterThanOrEqual(2);
      expect(normals).toBeLessThanOrEqual(8);
      // never three normal halls in a row
      for (let r = 3; r <= 12; r++) expect([s.script[r - 2], s.script[r - 1], s.script[r]].every((a) => a === null)).toBe(false);
      for (const an of s.script) if (an && an.kind !== "extra") expect(s.layout.some((p) => p.id === an.target)).toBe(true);
    }
  });

  it("normal difficulty never uses the subtle kinds; no figure without scares", () => {
    for (let seed = 1; seed < 80; seed++) {
      const s = startGame(2, seed, { rounds: 12, difficulty: "normal", scare: false });
      for (const an of s.script) {
        expect(an?.kind === "shift" || an?.kind === "tilt").toBe(false);
        expect(an?.extra?.kind).not.toBe("figure");
      }
    }
  });

  it("shownProps applies exactly one change", () => {
    const layout = buildLayout(4);
    const p = layout.find((x) => x.kind === "painting")!;
    expect(shownProps(layout, { kind: "missing", target: p.id }).find((x) => x.id === p.id)!.hidden).toBe(true);
    expect(shownProps(layout, { kind: "scale", target: p.id }).find((x) => x.id === p.id)!.scale).toBeGreaterThan(1);
    expect(shownProps(layout, { kind: "swap", target: p.id, icon: "👁️" }).find((x) => x.id === p.id)!.icon).toBe("👁️");
    const extra = shownProps(layout, { kind: "extra", target: "x-hand", extra: { ...p, id: "x-hand", kind: "handprint" } });
    expect(extra.length).toBe(layout.length + 1);
    expect(shownProps(layout, null)).toHaveLength(layout.length);
  });
});

describe("flow and scoring", () => {
  it("study → look when everyone is ready (or the timer runs out)", () => {
    let s = startGame(2, 3);
    s = applyAction(s, { type: "ready", seat: 0, step: s.step });
    expect(s.phase).toBe("study");
    s = applyAction(s, { type: "ready", seat: 1, step: s.step });
    expect(s.phase).toBe("look");
    expect(s.round).toBe(1);
    expect(adv(startGame(2, 3)).phase).toBe("look");
  });

  it("all answers reveal; right answers score base + speed + streak", () => {
    let s = adv(startGame(2, 11));
    const want = correctPick(currentAnomaly(s));
    s = answer(s, 0, want, 0);
    expect(s.phase).toBe("look");
    s = answer(s, 1, want === "none" ? "door-L0" : "none", 0);
    expect(s.phase).toBe("reveal");
    expect(s.scores).toEqual([200, 0]);
    expect(s.streaks).toEqual([1, 0]);
    expect(pointsFor({ pick: "a", ms: LOOK_MS }, { kind: "missing", target: "a" }, 3)).toBe(175);
    expect(pointsFor({ pick: "a", ms: 0 }, { kind: "missing", target: "a" }, 10)).toBe(300);
    expect(pointsFor(null, null, 2)).toBe(0);
  });

  it("time-out reveal gives nothing to the silent; stale and double answers are ignored", () => {
    let s = adv(startGame(2, 12));
    const once = answer(s, 0, "none");
    expect(answer(once, 0, "door-L0")).toBe(once);
    expect(applyAction(once, { type: "answer", seat: 1, step: s.step - 1, pick: "none", ms: 0 })).toBe(once);
    s = adv(once);
    expect(s.phase).toBe("reveal");
    expect(s.results[0].points[1]).toBe(0);
  });

  it("ends after the last round's reveal", () => {
    let s = startGame(1, 5, { rounds: 8, difficulty: "normal", scare: true });
    for (let i = 0; i < 100 && s.phase !== "ended"; i++) {
      if (s.phase === "look") s = answer(s, 0, correctPick(currentAnomaly(s)), 500);
      else s = adv(s);
    }
    expect(s.phase).toBe("ended");
    expect(s.results.length).toBe(8);
    expect(strangeCorridorStatDetails(s, 0).perfectGames).toBe(1);
    expect(strangeCorridorStatDetails(s, 0).correct).toBe(8);
    expect(computeRankings(s)[0].rank).toBe(1);
  });

  it("cues: steps on a new round, right/wrong on reveal", () => {
    const s0 = startGame(1, 2);
    const s1 = adv(s0);
    expect(strangeCorridorCues(0)(s0, s1)).toContain("steps");
    const s2 = answer(s1, 0, correctPick(currentAnomaly(s1)));
    expect(strangeCorridorCues(0)(s1, s2)).toContain("right");
  });
});

describe("bots", () => {
  it("higher levels find more, faster", () => {
    const acc = (lv: number) => {
      const rng = seededRng(lv);
      let right = 0;
      let total = 0;
      for (let seed = 1; seed <= 150; seed++) {
        let s = adv(startGame(1, seed, { rounds: 12, difficulty: "hard", scare: true }));
        while (s.phase !== "ended") {
          if (s.phase === "look") {
            const a = chooseBotAnswer(s, 0, lv, 1000, rng);
            if (a.type === "answer" && a.pick === correctPick(currentAnomaly(s))) right++;
            total++;
            s = applyAction(s, a);
          } else s = adv(s);
        }
      }
      return right / total;
    };
    const lo = acc(1);
    const hi = acc(10);
    expect(hi).toBeGreaterThan(0.85);
    expect(lo).toBeLessThan(0.65);
  });
});
