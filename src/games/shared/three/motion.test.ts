import { describe, expect, it } from "vitest";
import { CH, HANDS, LIMITS, createMotion, gestureInto, stepMotion } from "./motion";
import { POSES, blinking, type PersonMood } from "./SeatedPerson";

const MOODS = Object.keys(POSES) as PersonMood[];

function run(mood: PersonMood, seconds: number, seed = 3, dt = 1 / 60, from: PersonMood = "rest") {
  const m = createMotion(POSES[from], HANDS[from]);
  const frames: number[][] = [];
  for (let t = 0; t < seconds; t += dt) frames.push([...stepMotion(m, mood, POSES[mood], t, dt, seed)]);
  return frames;
}

describe("motion", () => {
  it("every mood has a full key pose and hand pose", () => {
    for (const mood of MOODS) {
      expect(POSES[mood]).toHaveLength(14);
      expect(HANDS[mood]).toHaveLength(6);
    }
  });

  it("stays finite and inside joint limits (small spring overshoot allowed) for 20 s of every mood", () => {
    const bad: string[] = [];
    for (const mood of MOODS) {
      for (const f of run(mood, 20)) {
        for (let i = 0; i < CH; i++) {
          if (!Number.isFinite(f[i]) || f[i] < LIMITS[i][0] - 0.25 || f[i] > LIMITS[i][1] + 0.25) bad.push(`${mood} ch${i}=${f[i]}`);
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it("eases into a new mood instead of snapping (no frame jumps more than 0.2 rad)", () => {
    for (const mood of MOODS) {
      const fr = run(mood, 3);
      let worst = 0;
      for (let k = 1; k < fr.length; k++) for (let i = 0; i < CH; i++) worst = Math.max(worst, Math.abs(fr[k][i] - fr[k - 1][i]));
      expect(worst, mood).toBeLessThan(0.2);
    }
  });

  it("reaches the new key pose within about a second", () => {
    const fr = run("cheer", 1.2, 5, 1 / 60, "rest");
    const last = fr[fr.length - 1];
    // right shoulder raises from −0.75 to near −2.9 (gestures add a little on top)
    expect(last[10]).toBeLessThan(-2.4);
    expect(last[19]).toBeGreaterThan(0.8); // fists
  });

  it("survives a huge frame (tab refocus) without blowing up", () => {
    const m = createMotion(POSES.rest, HANDS.rest);
    const x = stepMotion(m, "shock", POSES.shock, 0, 5, 1);
    for (const v of x) expect(Number.isFinite(v)).toBe(true);
  });

  it("talking actually gestures: the hands move noticeably over a few seconds", () => {
    const fr = run("talk", 6).slice(60);
    const range = (i: number) => Math.max(...fr.map((f) => f[i])) - Math.min(...fr.map((f) => f[i]));
    expect(range(13) + range(17) + range(9)).toBeGreaterThan(0.4);
  });

  it("idle seats don't move in unison", () => {
    const a = run("rest", 8, 1).map((f) => f[4]);
    const b = run("rest", 8, 2).map((f) => f[4]);
    const diff = a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;
    expect(diff).toBeGreaterThan(0.01);
  });

  it("gestures are deterministic for a given seat and time", () => {
    const a = new Array(CH).fill(0);
    const b = new Array(CH).fill(0);
    gestureInto(a, "talk", 12.3, 4);
    gestureInto(b, "talk", 12.3, 4);
    expect(a).toEqual(b);
  });

  it("blinks naturally: roughly every 2-6 s, briefly", () => {
    let blinks = 0;
    let closed = 0;
    let prev = false;
    const dt = 1 / 60;
    for (let t = 0; t < 120; t += dt) {
      const b = blinking(t, 7);
      if (b) closed += dt;
      if (b && !prev) blinks++;
      prev = b;
    }
    expect(blinks).toBeGreaterThan(20); // ≥ every 6 s
    expect(blinks).toBeLessThan(70); // ≤ every ~1.7 s
    expect(closed / 120).toBeLessThan(0.08);
  });
});
