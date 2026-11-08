import { describe, expect, it } from "vitest";
import { blinkAmount, breath, GazeSpring, mouthShape, saccade } from "./vrmLife";

const sample = (fn: (t: number) => number, from: number, to: number, step = 1 / 120) => {
  const out: number[] = [];
  for (let t = from; t < to; t += step) out.push(fn(t));
  return out;
};

describe("blinkAmount", () => {
  it("stays in 0..1 and is open most of the time", () => {
    const v = sample((t) => blinkAmount(t, 3), 0, 60);
    expect(Math.min(...v)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...v)).toBeLessThanOrEqual(1);
    expect(v.filter((x) => x > 0.5).length / v.length).toBeLessThan(0.06);
  });

  it("blinks 10–30 times a minute, at irregular intervals", () => {
    for (const seed of [0, 1, 7, 12]) {
      const v = sample((t) => blinkAmount(t, seed), 0, 60);
      const starts: number[] = [];
      v.forEach((x, i) => i > 0 && x > 0.95 && v[i - 1] <= 0.95 && starts.push(i / 120));
      expect(starts.length).toBeGreaterThanOrEqual(10);
      expect(starts.length).toBeLessThanOrEqual(30);
      const gaps = starts.slice(1).map((s, i) => s - starts[i]);
      expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(1);
    }
  });

  it("closes and opens smoothly (no single-frame jump to shut)", () => {
    const v = sample((t) => blinkAmount(t, 5), 0, 30);
    const jumps = v.slice(1).map((x, i) => Math.abs(x - v[i]));
    expect(Math.max(...jumps)).toBeLessThan(0.5);
  });

  it("desynchronises seats", () => {
    const a = sample((t) => blinkAmount(t, 1), 0, 20).map((x) => x > 0.5);
    const b = sample((t) => blinkAmount(t, 2), 0, 20).map((x) => x > 0.5);
    expect(a.some((x, i) => x !== b[i])).toBe(true);
  });
});

describe("saccade", () => {
  it("holds still between quick jumps", () => {
    const v = sample((t) => saccade(t, 4)[0], 0, 30);
    const moving = v.slice(1).filter((x, i) => Math.abs(x - v[i]) > 1e-6).length;
    // eyes are moving only during the ~40 ms jumps
    expect(moving / v.length).toBeLessThan(0.12);
    expect(new Set(v.map((x) => x.toFixed(2))).size).toBeGreaterThan(8);
  });

  it("stays within a few degrees, scaled by spread", () => {
    for (let t = 0; t < 40; t += 0.05) {
      const [y, p] = saccade(t, 9, 1);
      expect(Math.abs(y)).toBeLessThanOrEqual(3.5);
      expect(Math.abs(p)).toBeLessThanOrEqual(1.8);
      const [y2] = saccade(t, 9, 0.5);
      expect(Math.abs(y2)).toBeLessThanOrEqual(1.75);
    }
  });
});

describe("breath", () => {
  it("cycles about 13–17 times a minute when calm, faster when worked up", () => {
    const cycles = (excited: boolean, seed: number) => {
      const v = sample((t) => breath(t, seed, excited), 0, 60, 1 / 30);
      let n = 0;
      v.forEach((x, i) => i > 0 && x >= 0 && v[i - 1] < 0 && n++);
      return n;
    };
    for (const seed of [0, 3, 8]) {
      expect(cycles(false, seed)).toBeGreaterThanOrEqual(12);
      expect(cycles(false, seed)).toBeLessThanOrEqual(19);
      expect(cycles(true, seed)).toBeGreaterThan(cycles(false, seed));
    }
  });
});

describe("mouthShape", () => {
  it("varies the vowel and pauses between phrases", () => {
    const shapes = sample((t) => {
      const m = mouthShape(t, 6);
      return m.open > 0.05 ? "aa ih ou ee oh".split(" ").indexOf(m.v) : -1;
    }, 0, 10, 1 / 60);
    expect(new Set(shapes.filter((x) => x >= 0)).size).toBeGreaterThanOrEqual(4);
    // some closed stretches longer than a syllable (pauses)
    let run = 0, longest = 0;
    for (const s of shapes) {
      run = s < 0 ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    expect(longest / 60).toBeGreaterThan(0.15);
  });

  it("never opens past 1", () => {
    for (let t = 0; t < 20; t += 0.01) expect(mouthShape(t, 2).open).toBeLessThanOrEqual(1);
  });
});

describe("GazeSpring", () => {
  it("reaches the target with a small overshoot, and survives a long frame", () => {
    const g = new GazeSpring();
    let peak = 0;
    for (let i = 0; i < 120; i++) peak = Math.max(peak, g.step([0.5, 0], 1 / 60, 7.5)[0]);
    expect(g.x[0]).toBeCloseTo(0.5, 2);
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThan(0.56);
    g.step([0, 0], 5, 7.5);
    expect(Number.isFinite(g.x[0])).toBe(true);
  });
});
