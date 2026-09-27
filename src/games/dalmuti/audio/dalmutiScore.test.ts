import { describe, expect, it } from "vitest";
import { cycleOf, dalmutiEventsAt, LOOP_STEPS, partOf, STEP_SECONDS, VARIATIONS } from "./dalmutiScore";

const loop = (cycle: number) => Array.from({ length: LOOP_STEPS }, (_, s) => dalmutiEventsAt(cycle * LOOP_STEPS + s));
const lute = (cycle: number) => loop(cycle).map((ev) => ev.filter((e) => e.voice === "lute").map((e) => e.freq).join("+"));

describe("dalmuti 계급 서사 score", () => {
  it("is 108 BPM eighth-note steps in four 8-step parts", () => {
    expect(STEP_SECONDS).toBeCloseTo(60 / 108 / 2);
    expect([0, 8, 16, 24].map(partOf)).toEqual(["A", "B", "C", "D"]);
  });

  it("drone walks Am → C/F → Dm/G → E7 and resolves back to A on the next loop", () => {
    const roots = loop(0).flatMap((ev) => ev.filter((e) => e.voice === "drone").map((e) => e.freq));
    expect(roots).toEqual([110, 110, 130.81, 87.31, 73.42, 98, 82.41, 123.47]);
    expect(dalmutiEventsAt(LOOP_STEPS)).toContainEqual(expect.objectContaining({ voice: "drone", freq: 110 }));
  });

  it("Part D carries the E7 leading tone G#", () => {
    expect(loop(0).slice(24).flat().some((e) => e.voice === "lute" && e.freq === 415.3)).toBe(true);
  });

  it("flute bridges ring only into Part B and Part D", () => {
    const flutes = loop(0).map((ev, s) => (ev.some((e) => e.voice === "flute") ? s : -1)).filter((s) => s >= 0);
    expect(flutes).toEqual([8, 24]);
  });

  it("no two consecutive loop passes share the same lute line, and variations cycle", () => {
    for (let c = 0; c < VARIATIONS; c++) expect(lute(c)).not.toEqual(lute((c + 1) % VARIATIONS));
    expect(cycleOf(VARIATIONS * LOOP_STEPS)).toBe(0);
    expect(lute(VARIATIONS)).toEqual(lute(0));
  });
});
