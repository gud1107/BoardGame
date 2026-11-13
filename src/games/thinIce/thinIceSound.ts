import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 살얼음 파티 "Frost Polka" — A 장조 152 BPM 깡충거리는 폴카: 움파 베이스·글로켄 멜로디 위로
 * 썰매 방울(셰이커)이 달린다. 서든데스(intensity 1)엔 현악 트레몰로와 탐이 들어와 긴장감을 올린다.
 *
 * 효과음은 스냅샷 이벤트(sim.ts `GameEvent`)마다 ThinIceBoard가 울린다.
 * 소리로만 알리는 신호는 없다 — 해빙 경보·발밑 금·빠짐 모두 화면 글자·색·무늬와 같이 나온다(접근성).
 */

const SFX = {
  /** 얼음에 금 (내 발밑이 1·2단계로 갈라질 때). arg = 단계 1·2 */
  crack: (lvl: number) => [
    { wave: "noise", dur: 0.05 + lvl * 0.03, peak: 0.08 + lvl * 0.05, attack: 0.001, filter: { type: "highpass", freq: 2600 - lvl * 600 } },
    { wave: "sine", freq: 2200 - lvl * 500, to: 900, glide: 0.08, dur: 0.1, peak: 0.05 + lvl * 0.03, attack: 0.001 },
  ],
  /** 얼음 칸이 깨져 떨어짐 */
  break: [
    ...fx.crack(0, 0.22),
    { wave: "noise", dur: 0.35, peak: 0.08, attack: 0.01, filter: { type: "bandpass", freq: 3200, to: 900, q: 0.8 } },
    { inst: "glock", note: "E6", at: 0.03, dur: 0.12, gain: 0.25 },
  ],
  jump: [{ wave: "sine", freq: 380, to: 900, glide: 0.18, dur: 0.2, peak: 0.12, attack: 0.004 }, fx.whoosh(900, 1800, 0.18, 0.05)],
  land: [fx.thud(150, 0.12, 0.2), { wave: "noise", dur: 0.06, peak: 0.05, filter: { type: "highpass", freq: 3000 } }],
  /** 내려찍기 떠오름 */
  stomp: [{ wave: "triangle", freq: 260, to: 620, glide: 0.24, dur: 0.24, peak: 0.1, attack: 0.004 }, fx.whoosh(500, 2200, 0.24, 0.08)],
  /** 내려찍기 착지. arg = 밀친 사람 수 */
  slam: (n: number) => [fx.thud(80, 0.4, 0.5 + Math.min(3, n) * 0.06), ...fx.crack(0.02, 0.28), { wave: "noise", dur: 0.25, peak: 0.07, filter: { type: "lowpass", freq: 700 } }],
  /** 몸끼리 부딪힘. arg = 속도 */
  bump: (p: number) => {
    const k = Math.min(1, p / 8);
    return [{ wave: "sine", freq: 240 + k * 80, to: 110, glide: 0.1, dur: 0.14, peak: 0.16 + k * 0.18, attack: 0.002 }, { wave: "noise", dur: 0.05, peak: 0.04 + k * 0.05, filter: { type: "lowpass", freq: 1800 } }];
  },
  /** 물에 첨벙 */
  splash: [
    { wave: "noise", dur: 0.6, peak: 0.16, attack: 0.005, filter: { type: "lowpass", freq: 2600, to: 400 } },
    { wave: "sine", freq: 600, to: 140, glide: 0.25, dur: 0.3, peak: 0.12, attack: 0.002 },
    { wave: "noise", at: 0.12, dur: 0.5, peak: 0.05, attack: 0.05, filter: { type: "bandpass", freq: 1400, q: 1.2 } },
  ],
  ko: [{ inst: "brass", note: "A4", dur: 0.14, gain: 0.5 }, { inst: "brass", note: "E5", at: 0.1, dur: 0.32, gain: 0.55 }, { inst: "clap", note: "C4", at: 0.1, gain: 0.5 }],
  myOut: [fx.buzz(330, 110, 0.6, 0.14), { inst: "marimba", note: "A3", at: 0.12, dur: 0.5, gain: 0.5 }],
  /** 해빙 경보 — 해가 비추기 시작 (사이렌처럼 두 번 오르내림) */
  warn: [
    { wave: "triangle", freq: 660, to: 990, glide: 0.25, dur: 0.28, peak: 0.1, attack: 0.01 },
    { wave: "triangle", freq: 990, to: 660, glide: 0.25, at: 0.3, dur: 0.28, peak: 0.1, attack: 0.01 },
    { inst: "bell", note: "A5", at: 0.02, dur: 0.6, gain: 0.4 },
  ],
  /** 해가 내리쬠 — 얼음 녹는 지글지글 */
  thaw: [
    { wave: "noise", dur: 0.9, peak: 0.1, attack: 0.08, filter: { type: "bandpass", freq: 2400, to: 700, q: 0.7 } },
    ...fx.arp("vibes", ["E5", "C#5", "A4"], 0.08, 0.4, 0.5),
  ],
  /** 내 발밑이 경보 구역 */
  danger: [fx.click(1400, 0.12), fx.click(1400, 0.12, 0.12)],
  vote: [fx.pop(500, 1100, 0.16), { inst: "glock", note: "A5", at: 0.04, dur: 0.2, gain: 0.35 }],
  spawn: [fx.pop(700, 1400, 0.14), ...fx.arp("glock", ["A5", "E6"], 0.07, 0.3, 0.4)],
  frost: [...fx.arp("glock", ["E6", "A6", "C#7", "E7"], 0.04, 0.4, 0.55), fx.whoosh(3000, 6000, 0.4, 0.06)],
  spikes: [...fx.coin(0, 1700, 0.12), fx.click(900, 0.12, 0.08), fx.click(900, 0.12, 0.14)],
  fish: [fx.pop(400, 1200, 0.22), ...fx.arp("marimba", ["A4", "C#5", "E5", "A5"], 0.05, 0.3, 0.6)],
  /** 카운트다운 3·2·1 */
  tick: [{ inst: "bell", note: "A5", dur: 0.25, gain: 0.55 }],
  go: [...fx.chord("brass", ["A4", "C#5", "E5", "A5"], 0.5, 0.65), { inst: "triangle", note: "C6", gain: 0.7 }],
  sudden: [...fx.arp("brass", ["A4", "Bb4", "A4", "Bb4"], 0.14, 0.15, 0.7), { inst: "timpani", note: "A2", at: 0.56, dur: 1, gain: 0.6 }],
  /** 서든데스 고리 하나가 흔들리기 시작 */
  ring: [{ wave: "noise", dur: 0.5, peak: 0.07, attack: 0.05, filter: { type: "lowpass", freq: 400, to: 120 } }, fx.thud(60, 0.4, 0.22)],
  roundWin: [...fx.arp("glock", ["A5", "C#6", "E6", "A6"], 0.07, 0.4, 0.8), { inst: "clap", note: "C4", at: 0.3, gain: 0.7 }],
  roundLose: [{ inst: "marimba", note: "E5", dur: 0.3, gain: 0.5 }, { inst: "marimba", note: "C#5", at: 0.16, dur: 0.3, gain: 0.5 }, { inst: "marimba", note: "A4", at: 0.32, dur: 0.6, gain: 0.5 }],
  draw: [...fx.arp("marimba", ["A4", "E5", "A4"], 0.1, 0.3, 0.6)],
  victory: [
    ...fx.arp("brass", ["A4", "C#5", "E5", "A5", "C#6"], 0.09, 0.5),
    ...fx.chord("strings", ["A4", "C#5", "E5", "A5"], 2, 0.7, 0.45),
    { inst: "triangle", note: "C6", at: 0.45, gain: 0.6 },
  ],
  defeat: [{ inst: "brass", note: "E4", dur: 0.4, gain: 0.5 }, { inst: "brass", note: "C#4", at: 0.3, dur: 0.4, gain: 0.5 }, { inst: "brass", note: "A3", at: 0.6, dur: 0.9, gain: 0.5 }],
} satisfies Record<string, SfxRecipe>;

export const THIN_ICE_SUITE: SuiteConfig = {
  bpm: 152,
  swing: 0.04,
  tracks: [
    { voice: "softKick", pattern: "x . . . x . . . x . . . x . . .", gain: 0.42 },
    { voice: "rim", pattern: ". . x . . . x . . . x . . . x .", gain: 0.2 },
    { voice: "shaker", pattern: "x x x x x x x x x x x x x x x x", gain: 0.1 },
    { voice: "upright", pattern: "A2 . . . E2 . . . A2 . . . E2 . . . | D2 . . . A1 . . . E2 . . . B1 . . .", gain: 0.36 },
    { voice: "pizz", pattern: ". . A3+C#4+E4 . . . A3+C#4+E4 . . . A3+C#4+E4 . . . A3+C#4+E4 . | . . D4+F#4+A4 . . . D4+F#4+A4 . . . E4+G#4+B4 . . . E4+G#4+B4 .", gain: 0.16 },
    { voice: "glock", div: 2, pattern: "E5 C#5 E5 A5 - . G#5 F#5 | E5 - C#5 . D5 E5 F#5 . | A5 - F#5 . D5 - B4 . | G#4 B4 E5 . E5 - . .", gain: 0.13 },
    { voice: "strings", div: 2, pattern: "A4+E5 - - - - - - - | F#4+D5 - - - - - - - | D4+A4 - - - - - - - | E4+B4 - - - - - - -", gain: 0.08, level: 1 },
    { voice: "tom", pattern: ". . . . . . . . . . . . x . x x", gain: 0.22, level: 1 },
  ],
  sfx: SFX,
};

export const getThinIceSound = defineSuite(THIN_ICE_SUITE);
