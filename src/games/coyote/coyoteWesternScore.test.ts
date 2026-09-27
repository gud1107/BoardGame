import { describe, expect, it } from "vitest";
import { applyAction, startGame } from "./engine";
import { coyoteSoundCues, LOOP_STEPS, STEPS_PER_BAR, westernEventsAt } from "./coyoteWesternScore";

const loop = () => Array.from({ length: LOOP_STEPS }, (_, s) => westernEventsAt(s));

describe("western score", () => {
  it("opens on the brief's A3 banjo strum and follows its Am → G bar", () => {
    expect(westernEventsAt(0)).toContainEqual({ voice: "banjo", freq: 220, accent: true });
    expect(westernEventsAt(8)).toContainEqual({ voice: "banjo", freq: 196, accent: true });
  });

  it("bar 1 whistles the brief's A4 C5 B4 A4 E5 D5, bar 4 is whistle-free", () => {
    const whistle = (from: number, to: number) =>
      loop()
        .slice(from, to)
        .flatMap((ev) => ev.filter((e) => e.voice === "whistle").map((e) => e.freq));
    expect(whistle(0, STEPS_PER_BAR)).toEqual([440, 523.25, 493.88, 440, 659.25, 587.33]);
    expect(whistle(STEPS_PER_BAR * 3, LOOP_STEPS)).toEqual([]);
  });

  it("whistle notes never overlap the next one", () => {
    let busyUntil = 0;
    loop().forEach((ev, step) => {
      const w = ev.find((e) => e.voice === "whistle");
      if (!w) return;
      expect(step).toBeGreaterThanOrEqual(busyUntil);
      busyUntil = step + (w.steps ?? 0);
    });
  });

  it("shaker on every eighth, woodblock on beats 2 and 4, one rattlesnake per loop", () => {
    const bar = loop().slice(0, STEPS_PER_BAR);
    expect(bar.filter((ev) => ev.some((e) => e.voice === "shaker"))).toHaveLength(8);
    expect(bar.filter((ev) => ev.some((e) => e.voice === "woodblock"))).toHaveLength(2);
    expect(loop().filter((ev) => ev.some((e) => e.voice === "rattlesnake"))).toHaveLength(1);
  });

  it("loops", () => {
    expect(westernEventsAt(LOOP_STEPS + 7)).toEqual(westernEventsAt(7));
  });
});

describe("coyoteSoundCues", () => {
  it("a declaration pops for everyone, carrying the number", () => {
    const s0 = startGame(4, 11);
    const s1 = applyAction(s0, { type: "declare", seat: s0.activeSeat, number: 7 });
    expect(coyoteSoundCues(s0, s1)).toEqual([{ kind: "declare", number: 7 }]);
  });

  it("a coyote call fires the call cue, not a declare", () => {
    const s0 = startGame(4, 11);
    const s1 = applyAction(s0, { type: "declare", seat: s0.activeSeat, number: 7 });
    const s2 = applyAction(s1, { type: "coyote", seat: s1.activeSeat });
    expect(s2.phase).not.toBe("playing");
    expect(coyoteSoundCues(s1, s2)).toEqual([{ kind: "call" }]);
  });

  it("the next round starting (bid reset) and a no-op snapshot are silent", () => {
    const s0 = startGame(4, 11);
    const s1 = applyAction(s0, { type: "declare", seat: s0.activeSeat, number: 7 });
    const s2 = applyAction(s1, { type: "coyote", seat: s1.activeSeat });
    const s3 = applyAction(s2, { type: "continue", seed: 5 });
    expect(coyoteSoundCues(s2, s3)).toEqual([]);
    expect(coyoteSoundCues(s1, s1)).toEqual([]);
    // an illegal declare returns the same state object — no sound either
    expect(coyoteSoundCues(s1, applyAction(s1, { type: "declare", seat: s1.activeSeat, number: 3 }))).toEqual([]);
  });
});
