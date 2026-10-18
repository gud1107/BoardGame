import { describe, expect, it } from "vitest";
import { compileScore, compileTrack, eventsAt, loopLength, noteToFreq } from "./proceduralScore";
import { INSTRUMENTS, type SfxPart, type SuiteConfig } from "./proceduralSuite";
import { encodeFeedback } from "@/games/piecesOfLanguage/piecesOfLanguageSound";

/**
 * Data checks for every game's procedural sound suite (proceduralSuite.ts):
 * each score compiles (a note typo throws in noteToFreq), every track's
 * voice and every SFX instrument exists, and every SFX recipe builds for the
 * arguments its cue functions pass. Web Audio itself isn't available in this
 * node test environment, so playback is checked separately in a browser.
 */

const modules = import.meta.glob<Record<string, unknown>>("/src/games/**/*{Sound,Bgm}.ts", { eager: true });

function isSuite(v: unknown): v is SuiteConfig {
  return !!v && typeof v === "object" && "bpm" in v && "tracks" in v && "sfx" in v;
}

const suites: [string, SuiteConfig][] = Object.entries(modules).flatMap(([path, mod]) =>
  Object.entries(mod)
    .filter(([, v]) => isSuite(v))
    .map(([name, v]) => [`${path.replace("/src/games/", "")} ${name}`, v as SuiteConfig] as [string, SuiteConfig]),
);

describe("proceduralScore DSL", () => {
  it("maps A4 to 440 Hz and handles accidentals", () => {
    expect(noteToFreq("A4")).toBeCloseTo(440);
    expect(noteToFreq("C#4")).toBeCloseTo(noteToFreq("Db4"));
    expect(noteToFreq("A3")).toBeCloseTo(220);
    expect(() => noteToFreq("H2")).toThrow();
  });

  it("ties lengthen the previous note and rests clear it", () => {
    const t = compileTrack({ voice: "piano", div: 2, pattern: "C4 - - . E4+G4!" });
    expect(t.length).toBe(10);
    expect(t.at[0][0].steps).toBe(6);
    expect(t.at[8]).toHaveLength(2);
    expect(t.at[8][0].accent).toBe(true);
  });

  it("loops tracks independently and gates by intensity", () => {
    const score = compileScore([
      { voice: "kick", div: 4, pattern: "x" },
      { voice: "piano", pattern: "C4 . . . . . . .", level: 1 },
    ]);
    expect(loopLength(score)).toBe(8);
    expect(eventsAt(score, 4, 0).map((e) => e.voice)).toEqual(["kick"]);
    expect(eventsAt(score, 8, 0).map((e) => e.voice)).toEqual(["kick"]);
    expect(eventsAt(score, 8, 1).map((e) => e.voice)).toEqual(["kick", "piano"]);
  });
});

describe("game sound suites", () => {
  it("finds all 33 suites", () => {
    // 27 from the 2026-10-11 sound-suite pass + telepathy's BGM + tavern brawl.
    // + word tower (단어 마천루) + wobble tower (와르르 타워) + alkkagi (알까기 대전)
    // + curling (컬링 파티).
    expect(suites.length).toBe(33);
  });

  it.each(suites)("%s: score compiles with known voices", (_name, cfg) => {
    const known = { ...INSTRUMENTS, ...cfg.instruments };
    const score = compileScore(cfg.tracks);
    expect(loopLength(score)).toBeGreaterThan(0);
    expect(loopLength(score)).toBeLessThanOrEqual(256);
    for (const t of cfg.tracks) expect(known[t.voice], t.voice).toBeDefined();
    expect(cfg.bpm).toBeGreaterThan(40);
    expect(cfg.bpm).toBeLessThan(200);
  });

  it.each(suites)("%s: every SFX recipe builds with valid instruments and notes", (_name, cfg) => {
    const known = { ...INSTRUMENTS, ...cfg.instruments };
    const args = [0, 1, 3, 5, 2500, encodeFeedback(["green", "yellow", "red"])];
    for (const [sfxName, recipe] of Object.entries(cfg.sfx)) {
      const builds: SfxPart[][] = typeof recipe === "function" ? args.map((a) => recipe(a)) : [recipe];
      for (const parts of builds) {
        expect(parts.length, sfxName).toBeGreaterThan(0);
        for (const p of parts) {
          if ("inst" in p) {
            expect(known[p.inst], `${sfxName}: ${p.inst}`).toBeDefined();
            if (typeof p.note === "string") expect(() => noteToFreq(p.note as string)).not.toThrow();
          } else {
            expect(p.dur, sfxName).toBeGreaterThan(0);
            expect(p.peak, sfxName).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});

describe("encodeFeedback", () => {
  it("round-trips syllable colors through one number", () => {
    const code = encodeFeedback(["red", "green", "yellow", "green"]);
    expect(code.toString(4)).toBe("13121");
  });
});
