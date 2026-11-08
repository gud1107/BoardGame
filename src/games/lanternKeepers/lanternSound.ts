import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { GameState } from "./engine";

/**
 * 등불 지기 "Night Forest" suite (규칙서 §11) — 캄캄한 숲길. D 도리안 68 BPM, 하프 아르페지오와
 * 칼림바 종소리 위로 낮은 패드가 깔리고, 셰이커가 풀벌레처럼 운다. 등유가 얼마 안 남으면
 * (intensity 1) 팀파니 심장 박동과 낮은 현이 들어온다.
 *
 * 사건 소리(함정·골짜기·괴물·조각…)는 보드가 걸음 애니메이션에 맞춰 직접 울린다.
 * 상태 변화 신호(핑·한마디·라운드 시작·승패)는 `lanternCues`가 고른다.
 */

const SFX = {
  step: [{ wave: "noise", dur: 0.07, peak: 0.05, attack: 0.004, filter: { type: "lowpass", freq: 700 } }, fx.thud(110, 0.08, 0.08)],
  ping: [{ inst: "bell", note: "A5", dur: 0.6, gain: 0.55 }, { inst: "bell", note: "E6", at: 0.09, dur: 0.6, gain: 0.4 }],
  /** 위험·괴물 핑 — 조금 날카롭게 */
  pingDanger: [{ inst: "bell", note: "F5", dur: 0.4, gain: 0.6 }, { inst: "bell", note: "F5", at: 0.16, dur: 0.5, gain: 0.55 }, fx.click(2400, 0.06, 0.02)],
  word: [fx.pop(520, 880, 0.14), { inst: "kalimba", note: "D5", at: 0.03, dur: 0.3, gain: 0.5 }],
  ready: [fx.click(1500, 0.1), { inst: "kalimba", note: "A4", at: 0.02, dur: 0.25, gain: 0.4 }],
  round: [...fx.arp("harp", ["D4", "A4", "D5"], 0.07, 0.8, 0.45)],
  trap: [...fx.crack(0, 0.3), { wave: "square", freq: 300, to: 90, glide: 0.18, dur: 0.22, peak: 0.12, attack: 0.002 }, fx.click(3200, 0.12, 0.01)],
  disarm: [fx.click(2600, 0.12), fx.click(1900, 0.1, 0.07), { inst: "glock", note: "C6", at: 0.12, dur: 0.3, gain: 0.35 }],
  fall: [fx.whoosh(1400, 200, 0.45, 0.14), { wave: "noise", at: 0.42, dur: 0.35, peak: 0.12, attack: 0.01, filter: { type: "bandpass", freq: 900, q: 0.8 } }, fx.thud(70, 0.35, 0.35, 0.42)],
  bridge: [{ wave: "triangle", freq: 180, to: 140, glide: 0.25, dur: 0.3, peak: 0.12, attack: 0.02 }, fx.thud(140, 0.12, 0.16, 0.05)],
  bite: [
    { wave: "sawtooth", freq: 95, to: 60, glide: 0.5, dur: 0.6, peak: 0.2, attack: 0.03, filter: { type: "lowpass", freq: 600 } },
    { wave: "noise", dur: 0.5, peak: 0.1, attack: 0.05, filter: { type: "bandpass", freq: 300, q: 1.5 } },
    fx.thud(90, 0.25, 0.4, 0.3),
  ],
  banish: [fx.whoosh(300, 3000, 0.6, 0.1), ...fx.arp("glock", ["D6", "F#6", "A6", "D7"], 0.06, 0.4, 0.5)],
  shard: [...fx.arp("musicbox", ["A5", "D6", "F#6", "A6"], 0.07, 0.6, 0.6), { inst: "bell", note: "D7", at: 0.3, dur: 0.8, gain: 0.3 }],
  jar: [...fx.arp("glock", ["E6", "B6", "E7"], 0.05, 0.3, 0.45)],
  flare: [fx.whoosh(400, 2600, 0.5, 0.12), { inst: "pad", note: "A4", dur: 0.8, gain: 0.35 }],
  altar: [...fx.chord("choir", ["D4", "A4", "F#5"], 1.2, 0.5), { inst: "bell", note: "D6", at: 0.2, dur: 1, gain: 0.4 }],
  stunned: [{ wave: "sine", freq: 880, to: 440, glide: 0.4, dur: 0.45, peak: 0.08, attack: 0.01, vibrato: { rate: 9, depth: 30 } }],
  win: [
    ...fx.arp("harp", ["D4", "F#4", "A4", "D5", "F#5", "A5"], 0.08, 0.8, 0.6),
    ...fx.chord("strings", ["D4", "F#4", "A4", "D5"], 2.2, 0.55, 0.45),
    { inst: "bell", note: "D6", at: 0.5, dur: 1.4, gain: 0.45 },
  ],
  lose: [{ inst: "strings", note: "A3", dur: 0.6, gain: 0.45 }, { inst: "strings", note: "F3", at: 0.55, dur: 0.6, gain: 0.45 }, { inst: "strings", note: "D3", at: 1.1, dur: 1.4, gain: 0.5 }],
  /** 등유가 거의 떨어졌다 */
  lowOil: [{ inst: "timpani", note: "D2", dur: 0.5, gain: 0.5 }, { inst: "timpani", note: "D2", at: 0.32, dur: 0.6, gain: 0.4 }],
} satisfies Record<string, SfxRecipe>;

export const LANTERN_SUITE: SuiteConfig = {
  bpm: 68,
  tracks: [
    { voice: "harp", div: 2, pattern: "D3 A3 D4 F4 A4 F4 D4 A3 | C3 G3 C4 E4 G4 E4 C4 G3 | A2 E3 A3 C4 E4 C4 A3 E3 | B2 F#3 B3 D4 F#4 D4 B3 F#3", gain: 0.2 },
    { voice: "pad", div: 8, pattern: "D3+A3+F4 | C3+G3+E4 | A2+E3+C4 | B2+F#3+D4", gain: 0.16 },
    { voice: "kalimba", div: 4, pattern: ". . A5 . | . G5 . E5 | . . C6 . | . B5 . F#5", gain: 0.12 },
    { voice: "shaker", pattern: "x . x x . x . x x . x . x x . .", gain: 0.05 },
    { voice: "flute", div: 4, pattern: "A4 - - . | G4 - E4 - | C5 - - . | B4 - A4 -", gain: 0.08, level: 1 },
    { voice: "timpani", div: 4, pattern: "D2 . . D2 | D2 . . D2 | A1 . . A1 | B1 . . B1", gain: 0.22, level: 1 },
  ],
  sfx: SFX,
};

export const getLanternSound = defineSuite(LANTERN_SUITE);

/** 상태 변화 신호 (걸음 사건 소리는 보드가 애니메이션에 맞춰 낸다) */
export function lanternCues(viewer: number) {
  return (prev: GameState, next: GameState): string[] => {
    const cues: string[] = [];
    if (next.pings.length > 0) {
      const known = new Set(prev.pings.map((p) => p.id));
      const fresh = next.pings.filter((p) => !known.has(p.id) && p.seat !== viewer);
      if (fresh.some((p) => p.mark === "danger" || p.mark === "monster")) cues.push("pingDanger");
      else if (fresh.length > 0) cues.push("ping");
    }
    if (next.words.length > prev.words.length && next.words[next.words.length - 1]?.seat !== viewer) cues.push("word");
    if (next.round !== prev.round && next.phase === "plan") {
      cues.push("round");
      if (next.maxRounds - next.round === 4) cues.push("lowOil");
    }
    return cues;
  };
}
