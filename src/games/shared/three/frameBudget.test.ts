import { describe, expect, it } from "vitest";
import { FpsWindow, nextDpr } from "./frameBudget";

/** Feeds `fps` frames per second for `secs` seconds starting at `t0`; returns the readings. */
function run(w: FpsWindow, fps: number, secs: number, t0 = 0) {
  const out: [number, number][] = [];
  const dt = 1 / fps;
  for (let t = t0 + dt; t <= t0 + secs + 1e-9; t += dt) {
    const r = w.tick(t, dt);
    if (r !== null) out.push([t, r]);
  }
  return out;
}

describe("FpsWindow", () => {
  it("decides within ~3 s even at 3 fps (frame-count windows took ~50 s)", () => {
    const readings = run(new FpsWindow(), 3, 4);
    expect(readings.length).toBeGreaterThan(0);
    expect(readings[0][0]).toBeLessThan(3);
    expect(readings[0][1]).toBeCloseTo(3, 0);
  });

  it("reports the steady rate at 60 fps", () => {
    const readings = run(new FpsWindow(), 60, 3);
    expect(readings[0][1]).toBeCloseTo(60, 0);
  });

  it("ignores the warm-up and restarts the window on a stall", () => {
    const w = new FpsWindow(1, 1.2);
    expect(run(w, 60, 0.9)).toEqual([]);
    // a 1.8 s shader-compile freeze in the middle must not read as a 0.5 fps device
    for (let i = 1; i <= 30; i++) w.tick(1 + i / 60, 1 / 60);
    expect(w.tick(3.3, 1.8)).toBeNull();
    const after = run(w, 60, 2, 3.3);
    expect(after[0][1]).toBeGreaterThan(55);
  });
});

describe("nextDpr", () => {
  it("jumps straight to the fitting ratio instead of 0.25 at a time", () => {
    expect(nextDpr(2, 3)).toBe(1);
    expect(nextDpr(2, 25)).toBe(1.25);
    expect(nextDpr(2, 40)).toBe(1.75);
  });

  it("keeps the ratio when the frame rate is fine and never goes below the floor or up", () => {
    expect(nextDpr(2, 58)).toBe(2);
    expect(nextDpr(1, 5)).toBe(1);
    expect(nextDpr(1.5, 44)).toBeLessThan(1.5);
  });
});
