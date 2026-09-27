import { describe, expect, it } from "vitest";
import { cardPlaySound, LOOP_STEPS, trickTension, waltzEventsAt, waltzTempo, WALTZ_BPM, WALTZ_MAX_BPM } from "./cucumberWaltz";

describe("cardPlaySound", () => {
  it("15 always gets the orchestra hit, even when leading", () => {
    expect(cardPlaySound(15, null)).toBe("dominance15");
    expect(cardPlaySound(15, 15)).toBe("dominance15");
  });

  it("1 always gets the bell chime, even though it is also below the trick's top", () => {
    expect(cardPlaySound(1, null)).toBe("safeEscape1");
    expect(cardPlaySound(1, 13)).toBe("safeEscape1");
  });

  it("a card below the trick's top is a forced low shed", () => {
    expect(cardPlaySound(4, 13)).toBe("discardLow");
  });

  it("leading, matching or beating the top is a normal play", () => {
    expect(cardPlaySound(7, null)).toBe("normal");
    expect(cardPlaySound(9, 9)).toBe("normal");
    expect(cardPlaySound(12, 9)).toBe("normal");
  });
});

describe("waltz score", () => {
  it("tension runs 0 on trick 1 to 1 on trick 7, clamped", () => {
    expect(trickTension(1)).toBe(0);
    expect(trickTension(4)).toBeCloseTo(0.5);
    expect(trickTension(7)).toBe(1);
    expect(trickTension(9)).toBe(1);
  });

  it("tempo climbs from 126 to 156 BPM", () => {
    expect(waltzTempo(0)).toBe(WALTZ_BPM);
    expect(waltzTempo(1)).toBe(WALTZ_MAX_BPM);
  });

  it("is a 3/4 oom-pah-pah: bass on beat 1, accordion on beats 2 and 3", () => {
    for (let step = 0; step < LOOP_STEPS; step++) {
      const voices = waltzEventsAt(step, 0).map((e) => e.voice);
      expect(voices).toEqual([step % 3 === 0 ? "bass" : "accordion"]);
    }
  });

  it("adds the melody from mid-round and the tick + pickup bass only on the final trick", () => {
    expect(waltzEventsAt(0, 0.5).map((e) => e.voice)).toContain("melody");
    expect(waltzEventsAt(0, 0.5).map((e) => e.voice)).not.toContain("tick");
    expect(waltzEventsAt(2, 1).map((e) => e.voice)).toEqual(["accordion", "melody", "tick", "bass"]);
  });

  it("loops every 12 steps and tolerates negative steps", () => {
    expect(waltzEventsAt(LOOP_STEPS + 4, 1)).toEqual(waltzEventsAt(4, 1));
    expect(waltzEventsAt(-1, 0)).toEqual(waltzEventsAt(LOOP_STEPS - 1, 0));
  });
});
