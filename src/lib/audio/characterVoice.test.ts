import { describe, expect, it } from "vitest";
import { PERSONA_ORDER } from "@/games/shared/three/persona";
import { isVoiced, spokenPhrases, VOICE_GAP, VoiceGate, voiceLine, voiceProfile, type VoicedMood } from "./characterVoice";

const MOODS: VoicedMood[] = ["cheer", "shock", "laugh", "sad", "smug", "nervous", "point", "clap", "shrug", "slump", "raise"];

describe("character voice lines", () => {
  it("has a line for every persona × voiced mood", () => {
    for (const p of PERSONA_ORDER) for (const m of MOODS) expect(voiceLine(p, m, 3, 1).length).toBeGreaterThan(0);
  });

  it("gives personas their own words for the same emotion", () => {
    const cheers = new Set(PERSONA_ORDER.map((p) => voiceLine(p, "cheer", 2, 1)));
    expect(cheers.size).toBeGreaterThanOrEqual(5);
  });

  it("keeps idle and working moods silent", () => {
    expect(isVoiced("rest")).toBe(false);
    expect(isVoiced("think")).toBe(false);
    expect(isVoiced("talk")).toBe(false);
    expect(isVoiced("cheer")).toBe(true);
  });
});

describe("spoken phrasing", () => {
  it("never hands the speech engine a symbol it would read aloud", () => {
    for (const p of PERSONA_ORDER)
      for (const m of MOODS)
        for (let n = 0; n < 12; n++)
          for (const ph of spokenPhrases(voiceLine(p, m, n % 8, n))) {
            expect(ph.text).not.toMatch(/[~…\p{Extended_Pictographic}]/u);
            expect(ph.text.replace(/[.!?,\s]/g, "").length).toBeGreaterThan(0);
          }
  });

  it("draws out a ~ phrase and lifts it, then says the rest plainly", () => {
    const [um, good] = spokenPhrases("으음~ 좋아, 좋아.");
    expect(um.text).toBe("으음");
    expect(um.rate).toBeLessThan(1);
    expect(um.pitch).toBeGreaterThan(1);
    expect(good).toEqual({ text: "좋아, 좋아.", pitch: 1, rate: 1 });
  });

  it("lets a … phrase fall and an exclamation brighten", () => {
    const [trail, bang] = spokenPhrases("어, 됐다… 와, 제가 했어요!");
    expect(trail.pitch).toBeLessThan(1);
    expect(bang.pitch).toBeGreaterThan(1);
    expect(spokenPhrases("…뭐라고?")).toEqual([{ text: "뭐라고?", pitch: 1.04, rate: 1 }]);
  });
});

describe("voice profile", () => {
  it("separates women and men by pitch and spreads seats of the same gender", () => {
    const f = [1, 3, 5].map((s) => voiceProfile(s, "f", "focused").pitch);
    const m = [2, 4, 6].map((s) => voiceProfile(s, "m", "focused").pitch);
    expect(Math.min(...f)).toBeGreaterThan(Math.max(...m));
    expect(new Set(f.map((x) => x.toFixed(2))).size).toBe(3);
  });

  it("lets the persona set the manner", () => {
    expect(voiceProfile(1, "f", "fidget").rate).toBeGreaterThan(voiceProfile(1, "f", "dreamer").rate);
    expect(voiceProfile(1, "f", "shy").volume).toBeLessThan(voiceProfile(1, "f", "fidget").volume);
  });
});

describe("VoiceGate", () => {
  it("one seat can't chatter: per-seat gap", () => {
    const g = new VoiceGate();
    expect(g.allow(1, "laugh", 0, false)).toBe("speak");
    expect(g.allow(1, "cheer", VOICE_GAP.perSeat - 0.1, false)).toBe("skip");
    expect(g.allow(1, "cheer", VOICE_GAP.perSeat + 0.1, false)).toBe("speak");
  });

  it("a table reacting at once yields one voice; only urgent moods cut in", () => {
    const g = new VoiceGate();
    expect(g.allow(1, "clap", 0, false)).toBe("speak");
    expect(g.allow(2, "clap", 0.1, true)).toBe("skip");
    expect(g.allow(3, "laugh", 0.3, false)).toBe("skip");
    // even a shock lets the current line be heard for a moment before cutting in
    expect(g.allow(4, "shock", 0.4, true)).toBe("skip");
    expect(g.allow(5, "shock", 0.6, true)).toBe("cut");
  });
});
