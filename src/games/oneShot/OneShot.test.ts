import { describe, expect, it } from "vitest";
import { AIM_MAX, AIM_MIN, Sim, TPS, runShots, solutionWindow, type StageDef } from "./sim";
import { CHAPTERS, STAGES } from "./stages";
import { feedbackFor, starsFor } from "./scoring";

/** One shot fired at `tick`, stepped until everything settles; true if it alone clears the stage. */
function singleClears(st: StageDef, tick: number, angle: number): boolean {
  const sim = new Sim(st, [{ tick, angle }]);
  sim.tick = tick;
  for (let i = 0; i < TPS * 6; i++) {
    sim.step();
    if (sim.fired.length && sim.quiet()) break;
  }
  return sim.outcome() !== "fail-hostage" && sim.targetsLeft() === 0;
}

describe("한 발의 묘수 stage book", () => {
  it("has 20 uniquely numbered stages across the chapters", () => {
    expect(STAGES).toHaveLength(20);
    expect(new Set(STAGES.map((s) => s.id)).size).toBe(20);
    for (const c of CHAPTERS) expect(STAGES.filter((s) => s.chapter === c.n).length).toBe(4);
  });

  for (const st of STAGES) {
    describe(`${st.id} ${st.title}`, () => {
      it("reference answer clears with exactly par bullets", () => {
        expect(st.solution).toHaveLength(st.par);
        expect(st.ammo).toBeGreaterThan(st.par - 1);
        expect(runShots(st, st.solution).outcome).toBe("win");
        for (const s of st.solution) {
          expect(s.angle).toBeGreaterThanOrEqual(AIM_MIN);
          expect(s.angle).toBeLessThanOrEqual(AIM_MAX);
          expect(s.tick / TPS).toBeLessThan(st.duration);
        }
      });

      it("every reference shot leaves a playable timing window", () => {
        for (const w of solutionWindow(st, st.solution)) {
          expect(w.ms).toBeGreaterThanOrEqual(90);
          expect(w.deg).toBeGreaterThanOrEqual(0.8);
        }
      });

      if (st.myosu) {
        it("the hidden 묘수 really clears with fewer bullets", () => {
          expect(st.myosu!).toBeLessThan(st.par);
          expect(st.myosuSolution).toHaveLength(st.myosu!);
          expect(runShots(st, st.myosuSolution!).outcome).toBe("win");
        });
      }

      it("is deterministic", () => {
        const a = runShots(st, st.solution).sim;
        const b = runShots(st, st.solution).sim;
        expect(a.tick).toBe(b.tick);
        expect([...a.dead.entries()]).toEqual([...b.dead.entries()]);
      });
    });
  }

  it("par-2 stages without a 묘수 have no one-bullet answer (coarse sweep)", () => {
    for (const st of STAGES.filter((s) => s.par >= 2 && !s.myosu)) {
      let found = false;
      for (let tick = 0; tick < st.duration * TPS && !found; tick += 3)
        for (let a = AIM_MIN; a <= AIM_MAX && !found; a += 0.75) found = singleClears(st, tick, a);
      expect(found, st.id).toBe(false);
    }
  }, 60_000);

  it("a missing shot or a hostage hit fails", () => {
    const st = STAGES.find((s) => s.id === "3-1")!;
    expect(runShots(st, []).outcome).toBe("fail-time");
    // Fire straight at the target while the near hostage crosses the line.
    const out = new Set<string>();
    for (let tick = 0; tick < 480; tick += 6) out.add(runShots(st, [{ tick, angle: st.solution[0].angle }]).outcome);
    expect(out.has("fail-hostage")).toBe(true);
  });
});

describe("scoring", () => {
  const st = STAGES.find((s) => s.id === "1-4")!;
  it("stars: clear / par / live par without the answer ghost", () => {
    expect(starsFor(st, { won: false, bullets: 1, live: true, ghost: false })).toBe(0);
    expect(starsFor(st, { won: true, bullets: 3, live: true, ghost: false })).toBe(1);
    expect(starsFor(st, { won: true, bullets: 2, live: false, ghost: false })).toBe(2);
    expect(starsFor(st, { won: true, bullets: 2, live: true, ghost: false })).toBe(3);
    expect(starsFor(st, { won: true, bullets: 1, live: true, ghost: true })).toBe(2);
  });

  it("feedback compares against the reference with the same bullet count", () => {
    const late = st.solution.map((s, i) => (i === 0 ? { tick: s.tick + 12, angle: s.angle - 4 } : s));
    const lines = feedbackFor(st, late);
    expect(lines[0]).toContain("0.10초 늦게");
    expect(lines[0]).toContain("4.0° 높게");
    expect(feedbackFor(st, [])).toEqual([]);
  });
});
