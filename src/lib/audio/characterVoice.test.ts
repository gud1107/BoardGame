import { describe, expect, it } from "vitest";
import { PERSONA_ORDER } from "@/games/shared/three/persona";
import { CHARACTER_PRESETS } from "@/lib/character/avatar";
import { characterVoice, introLine, isVoiced, passLine, PRESET_VOICES, spokenPhrases, VOICE_GAP, VoiceGate, voiceLine, voiceProfile, type VoicedMood } from "./characterVoice";

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
            // Hangul syllables and plain punctuation only — "~" is read as "물결표", "ㅋㅋ" as "키읔키읔"
            expect(ph.text).toMatch(/^[가-힣 ,.!?]+$/);
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
  it("speaks only big moments; routine moods stay caption-only", () => {
    const g = new VoiceGate();
    for (const m of ["smug", "nervous", "shrug", "clap", "raise", "point", "laugh"] as const) expect(g.allow(1, m, 100, false)).toBe("skip");
    expect(g.allow(1, "cheer", 100, false)).toBe("speak");
  });

  it("one seat can't chatter: per-seat gap", () => {
    const g = new VoiceGate();
    expect(g.allow(1, "sad", 0, false)).toBe("speak");
    expect(g.allow(1, "cheer", VOICE_GAP.perSeat - 0.1, false)).toBe("skip");
    expect(g.allow(1, "cheer", VOICE_GAP.perSeat + 0.1, false)).toBe("speak");
  });

  it("the table keeps a long quiet between voices; only urgent moods come sooner", () => {
    const g = new VoiceGate();
    expect(g.allow(1, "sad", 0, false)).toBe("speak");
    expect(g.allow(2, "slump", VOICE_GAP.global - 0.1, false)).toBe("skip");
    expect(g.allow(3, "shock", VOICE_GAP.urgent - 0.1, true)).toBe("skip");
    expect(g.allow(4, "shock", VOICE_GAP.urgent + 0.1, true)).toBe("cut");
    expect(g.allow(5, "sad", VOICE_GAP.urgent + VOICE_GAP.global + 0.2, false)).toBe("speak");
  });
});

describe("character voices", () => {
  it("gives every cast character their own pitch, inside their gender's band", () => {
    const pitches = CHARACTER_PRESETS.map((p) => {
      const v = PRESET_VOICES[p.id];
      expect(v, p.id).toBeDefined();
      if (p.look.gender === "f") expect(v.pitch).toBeGreaterThan(1.05);
      else expect(v.pitch).toBeLessThan(1.05);
      return v.pitch.toFixed(2);
    });
    expect(new Set(pitches).size).toBe(CHARACTER_PRESETS.length);
  });

  it("keeps a chosen character's voice the same at any seat", () => {
    const a = characterVoice(0, { presetId: "haerin" });
    const b = characterVoice(5, { presetId: "haerin" }, "m");
    expect(b).toEqual(a);
    expect(a).toMatchObject({ gender: "f", persona: "shy", pitch: PRESET_VOICES.haerin.pitch });
    expect(characterVoice(0, { presetId: "doyoon" }).gender).toBe("m");
  });

  it("falls back to the seat's voice without a cast character", () => {
    const v = characterVoice(3, { gender: "f" });
    expect(v.gender).toBe("f");
    expect(v.pitch).toBe(voiceProfile(3, "f", v.persona).pitch);
    expect(characterVoice(3, { presetId: "no-such" }, "m").gender).toBe("m");
    expect(characterVoice(2).gender).toBe("f");
  });

  it("says a pass each persona's way, in words the engine can speak", () => {
    const said = new Set<string>();
    for (const p of PERSONA_ORDER)
      for (let n = 1; n <= 6; n++) {
        const line = passLine(p, n, n);
        said.add(line);
        for (const ph of spokenPhrases(line)) expect(ph.text).toMatch(/^[가-힣 ,.!?]+$/);
      }
    for (const c of CHARACTER_PRESETS)
      for (const ph of spokenPhrases(introLine(PRESET_VOICES[c.id].persona, c.name))) expect(ph.text).toMatch(/^[가-힣 ,.!?]+$/);
    expect(said.size).toBeGreaterThanOrEqual(8);
  });
});
