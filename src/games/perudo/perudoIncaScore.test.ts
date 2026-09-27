import { describe, expect, it } from "vitest";
import { incaEventsAt, LOOP_STEPS, STEPS_PER_BAR } from "./perudoIncaScore";

const loop = () => Array.from({ length: LOOP_STEPS }, (_, s) => incaEventsAt(s));
const freqs = (voice: string, from = 0, to = LOOP_STEPS) =>
  loop()
    .slice(from, to)
    .flatMap((ev) => ev.filter((e) => e.voice === voice).map((e) => e.freq));

describe("inca score", () => {
  it("plays the brief's 16-note pan-flute melody, ending home on D4", () => {
    expect(freqs("flute")).toEqual([
      293.66, 349.23, 440, 392, 466.16, 440, 349.23, 293.66, 261.63, 329.63, 392, 349.23, 220, 261.63, 329.63, 293.66,
    ]);
  });

  it("guitar roots follow Dm → Bb → C → Am, one chord per bar", () => {
    const roots = [0, 1, 2, 3].map((bar) => incaEventsAt(bar * STEPS_PER_BAR).find((e) => e.voice === "guitar")?.freq);
    expect(roots).toEqual([146.83, 116.54, 130.81, 110]);
  });

  it("flute notes never overlap the next one", () => {
    let busyUntil = 0;
    loop().forEach((ev, step) => {
      const f = ev.find((e) => e.voice === "flute");
      if (!f) return;
      expect(step).toBeGreaterThanOrEqual(busyUntil);
      busyUntil = step + (f.steps ?? 0);
    });
    expect(busyUntil).toBeLessThanOrEqual(LOOP_STEPS);
  });

  it("shaker on every eighth, tom accent on each downbeat, bar-2 double hit kept", () => {
    expect(loop().every((ev) => ev.some((e) => e.voice === "shaker"))).toBe(true);
    for (let bar = 0; bar < 4; bar++) {
      expect(incaEventsAt(bar * STEPS_PER_BAR).find((e) => e.voice === "tom")?.accent).toBe(true);
    }
    expect(freqs("tom", 12, 14)).toEqual([70, 75]);
  });

  it("loops", () => {
    expect(incaEventsAt(LOOP_STEPS + 5)).toEqual(incaEventsAt(5));
    expect(incaEventsAt(-1)).toEqual(incaEventsAt(LOOP_STEPS - 1));
  });
});
