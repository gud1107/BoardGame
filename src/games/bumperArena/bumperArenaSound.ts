import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 범퍼 아레나 "Sky Brawl" — E 단조 132 BPM 펑크 록: 킥·스네어·하이햇 위로 신스 베이스가
 * 달리고, 스탭 코드가 엇박을 친다. 서든데스(intensity 1)엔 리드 멜로디와 탐이 들어온다.
 *
 * 효과음은 스냅샷 이벤트(sim.ts `GameEvent`)마다 BumperBoard가 울린다.
 * 소리로만 알리는 신호는 없다 — 모두 화면 연출·글자와 같이 나온다(접근성).
 */

const SFX = {
  /** arg = 부딪힌 속도 (m/s) */
  bump: (p: number) => {
    const k = Math.min(1, p / 12);
    return [
      { wave: "sine", freq: 220 + k * 80, to: 90, glide: 0.12, dur: 0.18, peak: 0.25 + k * 0.3, attack: 0.002 },
      { wave: "noise", dur: 0.06 + k * 0.05, peak: 0.05 + k * 0.08, filter: { type: "lowpass", freq: 1400 + k * 2000 } },
      ...(k > 0.6 ? [fx.thud(70, 0.3, 0.35)] : []),
    ];
  },
  dash: [fx.whoosh(500, 2400, 0.22, 0.13), { wave: "triangle", freq: 300, to: 620, glide: 0.15, dur: 0.16, peak: 0.06 }],
  jump: [{ wave: "sine", freq: 330, to: 880, glide: 0.2, dur: 0.22, peak: 0.12, attack: 0.005 }, fx.whoosh(800, 1600, 0.2, 0.06)],
  /** arg = 날려 보낸 사람 수 */
  land: (n: number) => [fx.thud(95, 0.35, 0.45 + Math.min(3, n) * 0.08), { wave: "noise", dur: 0.18, peak: 0.08, filter: { type: "lowpass", freq: 600 } }],
  post: [
    { wave: "sine", freq: 520, to: 1040, glide: 0.06, dur: 0.18, peak: 0.2, attack: 0.002 },
    { wave: "square", freq: 1040, to: 780, glide: 0.1, at: 0.05, dur: 0.14, peak: 0.05 },
  ],
  warn: [{ wave: "noise", dur: 0.25, peak: 0.05, attack: 0.05, filter: { type: "bandpass", freq: 300, q: 0.8 } }, fx.click(180, 0.08)],
  crumble: [fx.thud(60, 0.4, 0.25), { wave: "noise", dur: 0.4, peak: 0.07, attack: 0.03, filter: { type: "lowpass", freq: 500, to: 150 } }],
  /** 떨어지는 사람 — 아래로 내려가는 휘파람 */
  fall: [fx.whoosh(1800, 300, 0.9, 0.12), { wave: "sine", freq: 900, to: 160, glide: 1, dur: 1, peak: 0.1, attack: 0.02 }],
  ko: [...fx.crack(0, 0.3), { inst: "brass", note: "E5", at: 0.04, dur: 0.18, gain: 0.5 }, { inst: "brass", note: "B5", at: 0.12, dur: 0.3, gain: 0.5 }],
  myOut: [fx.buzz(300, 90, 0.7, 0.16), { inst: "brass", note: "E3", at: 0.1, dur: 0.6, gain: 0.6 }],
  spawn: [fx.pop(600, 1200, 0.16), ...fx.arp("glock", ["E6", "B6"], 0.07, 0.3, 0.4)],
  pick: [fx.pop(500, 1400, 0.22), ...fx.arp("glock", ["E5", "G#5", "B5", "E6"], 0.05, 0.3, 0.6)],
  big: [{ wave: "sawtooth", freq: 110, to: 70, glide: 0.5, dur: 0.6, peak: 0.08, filter: { type: "lowpass", freq: 600 } }, ...fx.arp("brass", ["E3", "B3", "E4"], 0.1, 0.4, 0.6)],
  turbo: [fx.whoosh(600, 3800, 0.4, 0.14), ...fx.arp("chip", ["E5", "B5", "E6"], 0.05, 0.12, 0.5)],
  shield: [...fx.coin(0, 1900, 0.12), { wave: "sine", freq: 660, to: 990, glide: 0.25, dur: 0.4, peak: 0.08 }],
  shock: [...fx.crack(0, 0.5), fx.thud(55, 0.5, 0.55), fx.whoosh(2400, 300, 0.5, 0.12)],
  block: [...fx.coin(0, 2600, 0.14), { wave: "triangle", freq: 1300, to: 650, glide: 0.2, dur: 0.25, peak: 0.08 }],
  gust: [{ wave: "noise", dur: 0.6, peak: 0.1, attack: 0.15, filter: { type: "bandpass", freq: 700, to: 1600, q: 0.7 } }],
  /** 카운트다운 3·2·1 */
  tick: [{ inst: "bell", note: "E5", dur: 0.25, gain: 0.6 }],
  go: [...fx.chord("brass", ["E4", "G#4", "B4", "E5"], 0.5, 0.7), { inst: "clap", note: "C4", gain: 0.8 }, fx.thud(80, 0.3, 0.4)],
  sudden: [...fx.arp("brass", ["E4", "F4", "E4", "F4"], 0.14, 0.15, 0.7), { inst: "gong", note: "E2", at: 0.6, dur: 1.2, gain: 0.5 }],
  roundWin: [...fx.arp("brass", ["E4", "G#4", "B4", "E5"], 0.08, 0.4, 0.8), { inst: "clap", note: "C4", at: 0.32, gain: 0.7 }, { inst: "clap", note: "C4", at: 0.46, gain: 0.7 }],
  roundLose: [{ inst: "marimba", note: "B4", dur: 0.3, gain: 0.5 }, { inst: "marimba", note: "G4", at: 0.16, dur: 0.3, gain: 0.5 }, { inst: "marimba", note: "E4", at: 0.32, dur: 0.6, gain: 0.5 }],
  draw: [...fx.arp("marimba", ["E5", "B4", "E5"], 0.1, 0.3, 0.6)],
  victory: [
    ...fx.arp("brass", ["E4", "G#4", "B4", "E5", "G#5"], 0.09, 0.5),
    ...fx.chord("strings", ["E4", "G#4", "B4", "E5"], 2, 0.7, 0.45),
    { inst: "clap", note: "C4", at: 0.45, gain: 0.7 },
    { inst: "clap", note: "C4", at: 0.6, gain: 0.7 },
    { inst: "triangle", note: "C6", at: 0.45, gain: 0.6 },
  ],
  defeat: [{ inst: "brass", note: "B3", dur: 0.4, gain: 0.5 }, { inst: "brass", note: "G3", at: 0.3, dur: 0.4, gain: 0.5 }, { inst: "brass", note: "E3", at: 0.6, dur: 0.9, gain: 0.5 }],
} satisfies Record<string, SfxRecipe>;

export const BUMPER_ARENA_SUITE: SuiteConfig = {
  bpm: 132,
  swing: 0.06,
  tracks: [
    { voice: "kick", pattern: "x . . . x . . x . . x . x . . .", gain: 0.5 },
    { voice: "snare", pattern: ". . . . x . . . . . . . x . . .", gain: 0.36 },
    { voice: "hat", pattern: "x x x x x x x x x x x x x x x x", gain: 0.12 },
    { voice: "synthBass", pattern: "E2 . E2 . G2 . E2 . | D2 . D2 . B1 . D2 . | C2 . C2 . E2 . C2 . | B1 . B1 . D#2 . B1 .", gain: 0.34 },
    { voice: "stab", div: 2, pattern: ". E4+G4+B4 . . . E4+G4+B4 . . | . D4+F#4+A4 . . . D4+F#4+A4 . . | . C4+E4+G4 . . . C4+E4+G4 . . | . B3+D#4+F#4 . . . B3+D#4+F#4 . .", gain: 0.16 },
    { voice: "tom", pattern: ". . . . . . . . . . . . x . x x", gain: 0.25, level: 1 },
    { voice: "lead", div: 2, pattern: "E5 - G5 - B5 - A5 G5 | F#5 - - - D5 - - - | E5 - G5 - C6 - B5 A5 | B5 - - - D#5 - - -", gain: 0.1, level: 1 },
  ],
  sfx: SFX,
};

export const getBumperArenaSound = defineSuite(BUMPER_ARENA_SUITE);
