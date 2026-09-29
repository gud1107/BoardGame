import { describe, expect, it } from "vitest";
import { BEATS_PER_BAR, LOOP_STEPS, TICK_HZ, TOCK_HZ, waltzEventsAt } from "./spotDetectiveScore";

describe("detective waltz score", () => {
  it("is 8 bars of 3/4: bass on beat 1, tick on 2, tock on 3", () => {
    expect(LOOP_STEPS).toBe(24);
    for (let s = 0; s < LOOP_STEPS; s++) {
      const voices = waltzEventsAt(s).map((e) => e.voice);
      const beat = s % BEATS_PER_BAR;
      expect(voices.includes("bass")).toBe(beat === 0);
      expect(voices.includes("tick")).toBe(beat === 1);
      expect(voices.includes("tock")).toBe(beat === 2);
      expect(voices.filter((v) => v === "marimba")).toHaveLength(1);
    }
    expect(waltzEventsAt(1).find((e) => e.voice === "tick")?.freq).toBe(TICK_HZ);
    expect(waltzEventsAt(2).find((e) => e.voice === "tock")?.freq).toBe(TOCK_HZ);
  });

  it("loops seamlessly and stays out of the harsh high register", () => {
    expect(waltzEventsAt(LOOP_STEPS + 5)).toEqual(waltzEventsAt(5));
    expect(waltzEventsAt(-1)).toEqual(waltzEventsAt(LOOP_STEPS - 1));
    for (let s = 0; s < LOOP_STEPS; s++) for (const e of waltzEventsAt(s)) expect(e.freq).toBeLessThan(1000);
  });

  it("the bar-8 walk-down lands on A3 and the loop restarts on bar 1's A4", () => {
    const marimba = (s: number) => waltzEventsAt(s).find((e) => e.voice === "marimba")!.freq;
    expect(marimba(LOOP_STEPS - 1)).toBe(220);
    expect(marimba(0)).toBe(440);
  });
});
