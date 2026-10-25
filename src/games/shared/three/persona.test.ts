import { describe, expect, it } from "vitest";
import { PERSONA_ORDER, personaFor, personaGaze, type Persona } from "./persona";

/** Share of the time spent on each gaze kind over a minute at 30 fps. */
function shares(p: Persona, seed = 3) {
  const n: Record<string, number> = { cue: 0, viewer: 0, down: 0, away: 0 };
  let total = 0;
  for (let t = 0; t < 600; t += 1 / 30) {
    n[personaGaze(p, t, seed, false).kind]++;
    total++;
  }
  return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, v / total]));
}

describe("persona", () => {
  it("gives neighbouring seats different personas", () => {
    for (let s = 0; s < 10; s++) expect(personaFor(s)).not.toBe(personaFor(s + 1));
    expect(new Set(Array.from({ length: 6 }, (_, s) => personaFor(s))).size).toBe(PERSONA_ORDER.length);
  });

  it("the starer mostly looks at the viewer, the shy one mostly at the table", () => {
    expect(shares("starer").viewer).toBeGreaterThan(0.55);
    expect(shares("shy").down).toBeGreaterThan(0.6);
    expect(shares("focused").cue).toBeGreaterThan(0.85);
    expect(shares("dreamer").away).toBeGreaterThan(0.45);
  });

  it("everyone follows the game cue when something strong happens", () => {
    for (const p of PERSONA_ORDER) expect(personaGaze(p, 12.3, 5, true)).toEqual({ kind: "cue" });
  });

  it("holds a gaze for a while instead of flickering every frame", () => {
    let changes = 0;
    let last = "";
    for (let t = 0; t < 60; t += 1 / 30) {
      const g = JSON.stringify(personaGaze("scanner", t, 7, false));
      if (g !== last) changes++;
      last = g;
    }
    // scanner is the jumpiest (1.1 s slots): at most ~one switch per slot
    expect(changes).toBeLessThan(60 / 1.1 + 2);
  });
});
