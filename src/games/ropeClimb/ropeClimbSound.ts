import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 한 줄 등반대 "Ridge Song" — D 장조 96 BPM 느긋한 산길 노래: 업라이트 베이스와 기타 아르페지오 위로
 * 리코더 선율. 판 상황에 따라 두꺼워진다 (RopeClimbBoard가 `setIntensity`):
 *   0 평소 · 1 누군가 줄에 매달려 있음(현악 긴장음·림) · 2 ⛑ 0개이거나 남은 시간 30초 이하(탐·리드).
 *
 * 효과음은 스냅샷 이벤트(sim.ts `GameEvent`)마다 RopeClimbBoard가 울린다.
 * 소리로만 알리는 신호는 없다 — 낙석·돌풍·체력 경고는 모두 화면 글자·표식과 같이 나온다(접근성).
 */

const SFX = {
  /** 바위를 잡음 */
  grab: [fx.click(700, 0.1), { wave: "noise", dur: 0.07, peak: 0.06, filter: { type: "bandpass", freq: 1800, q: 1.5 } }],
  /** 도약 */
  leap: [{ wave: "sine", freq: 300, to: 760, glide: 0.16, dur: 0.18, peak: 0.1, attack: 0.004 }, fx.whoosh(700, 1900, 0.2, 0.06)],
  /** 턱에 내려섬. arg 1 = 세게 */
  land: (hard: number) => [fx.thud(hard ? 90 : 150, hard ? 0.3 : 0.14, hard ? 0.4 : 0.2), { wave: "noise", dur: 0.08, peak: hard ? 0.09 : 0.04, filter: { type: "lowpass", freq: 1200 } }],
  /** 체력이 바닥나 손을 놓침 */
  slip: [fx.buzz(300, 120, 0.4, 0.1), { wave: "triangle", freq: 620, to: 240, glide: 0.35, dur: 0.38, peak: 0.1, attack: 0.004 }],
  /** 줄이 채이며 받아냄. arg = 속도 */
  catch: (v: number) => {
    const k = Math.min(1, v / 12);
    return [
      { wave: "sawtooth", freq: 110, to: 70, glide: 0.2, dur: 0.3, peak: 0.12 + k * 0.1, attack: 0.002, filter: { type: "lowpass", freq: 900 } },
      { wave: "sine", freq: 880, to: 440, glide: 0.25, dur: 0.3, peak: 0.07, attack: 0.002, vibrato: { rate: 18, depth: 0.03 } },
      fx.thud(120, 0.2, 0.3 + k * 0.2),
    ];
  },
  /** 줄 당기기 (끌어올리는 동안 반복). arg = 번갈아 */
  haul: (n: number) => [{ wave: "noise", dur: 0.12, peak: 0.045, attack: 0.02, filter: { type: "bandpass", freq: Math.round(n) % 2 ? 900 : 1200, to: 500, q: 2 } }, fx.click(Math.round(n) % 2 ? 420 : 520, 0.04)],
  /** 부서지는 바위를 잡음 (곧 떨어져 나감) */
  crack: [...fx.crack(0, 0.16), fx.click(1600, 0.06, 0.08)],
  crumble: [...fx.crack(0, 0.24), { wave: "noise", dur: 0.5, peak: 0.1, attack: 0.01, filter: { type: "lowpass", freq: 900, to: 200 } }, fx.thud(70, 0.3, 0.25, 0.08)],
  /** 낙석 경고 */
  rockWarn: [
    { wave: "square", freq: 880, dur: 0.09, peak: 0.05, attack: 0.002, filter: { type: "lowpass", freq: 2400 } },
    { wave: "square", freq: 880, at: 0.16, dur: 0.09, peak: 0.05, attack: 0.002, filter: { type: "lowpass", freq: 2400 } },
    { wave: "noise", at: 0.05, dur: 0.6, peak: 0.04, attack: 0.3, filter: { type: "lowpass", freq: 500 } },
  ],
  rockHit: [fx.thud(100, 0.3, 0.5), ...fx.crack(0.01, 0.2), { wave: "triangle", freq: 480, to: 200, glide: 0.2, dur: 0.24, peak: 0.1, at: 0.04 }],
  windWarn: [fx.whoosh(300, 900, 0.9, 0.07), { inst: "recorder", note: "A5", dur: 0.3, gain: 0.3 }, { inst: "recorder", note: "F#5", at: 0.3, dur: 0.4, gain: 0.3 }],
  wind: [fx.whoosh(500, 2400, 1.6, 0.12), fx.whoosh(2400, 600, 1.4, 0.08, 1.3)],
  star: [fx.pop(600, 1500, 0.2), ...fx.arp("glock", ["D6", "F#6", "A6", "D7"], 0.05, 0.35, 0.6)],
  camp: [...fx.arp("guitar", ["D4", "A4", "D5", "F#5"], 0.08, 0.5, 0.6), { inst: "triangle", note: 1, at: 0.3, gain: 0.5 }],
  /** 팀 추락 */
  fall: [fx.buzz(260, 70, 0.9, 0.16), fx.whoosh(1800, 200, 0.9, 0.12), { inst: "timpani", note: "D2", at: 0.75, dur: 0.8, gain: 0.6 }],
  summit: [...fx.arp("brass", ["D4", "F#4", "A4", "D5"], 0.09, 0.4, 0.6), { inst: "triangle", note: 1, at: 0.36, gain: 0.5 }],
  /** 체력 경고 (25 아래로) */
  tired: [fx.thud(70, 0.16, 0.3), fx.thud(70, 0.16, 0.24, 0.22)],
  /** 줄이 팽팽해 더 못 감 */
  taut: [{ wave: "sawtooth", freq: 190, to: 230, glide: 0.08, dur: 0.1, peak: 0.05, attack: 0.002, filter: { type: "bandpass", freq: 800, q: 4 } }],
  denied: [{ wave: "square", freq: 180, to: 150, glide: 0.06, dur: 0.07, peak: 0.04, attack: 0.002, filter: { type: "lowpass", freq: 900 } }],
  ui: [fx.click(1200, 0.06)],
  tick: [{ inst: "woodblock", note: 1, dur: 0.2, gain: 0.9 }],
  go: [...fx.chord("brass", ["D4", "F#4", "A4", "D5"], 0.5, 0.6), { inst: "triangle", note: 1, gain: 0.6 }],
  victory: [
    ...fx.arp("brass", ["D4", "F#4", "A4", "D5", "F#5"], 0.1, 0.5),
    ...fx.chord("strings", ["D4", "F#4", "A4", "D5"], 2.2, 0.7, 0.5),
    ...fx.arp("glock", ["A6", "D7", "F#7"], 0.12, 0.6, 0.5),
  ],
  defeat: [{ inst: "brass", note: "A3", dur: 0.4, gain: 0.5 }, { inst: "brass", note: "F3", at: 0.32, dur: 0.4, gain: 0.5 }, { inst: "brass", note: "D3", at: 0.64, dur: 1, gain: 0.5 }],
} satisfies Record<string, SfxRecipe>;

export const ROPE_CLIMB_SUITE: SuiteConfig = {
  bpm: 96,
  swing: 0.06,
  tracks: [
    { voice: "softKick", pattern: "x . . . . . x . x . . . . . . .", gain: 0.34 },
    { voice: "brush", pattern: ". . . . x . . . . . . . x . . .", gain: 0.16 },
    { voice: "shaker", pattern: "x . x . x . x . x . x . x . x .", gain: 0.07 },
    { voice: "upright", pattern: "D2 . . . . . A2 . D2 . . . . . F#2 . | G2 . . . . . D2 . A2 . . . . . A1 .", gain: 0.34 },
    { voice: "guitar", pattern: "D3 A3 D4 F#4 A3 D4 F#4 A3 D3 A3 D4 F#4 A3 D4 F#4 A3 | G3 B3 D4 G4 B3 D4 G4 B3 A3 C#4 E4 A4 C#4 E4 A4 C#4", gain: 0.13 },
    { voice: "recorder", div: 2, pattern: "F#5 - A5 - D6 - - . | B5 - A5 - F#5 - - . | G5 - B5 - D6 - B5 . | A5 - E5 - C#5 - - .", gain: 0.1, maxLevel: 2 },
    // 1단계: 누군가 매달려 있음 — 현악 긴장음과 림
    { voice: "strings", div: 2, pattern: "D4+A4 - - - - - - - | D4+B4 - - - - - - - | G4+D5 - - - - - - - | A4+E5 - - - - - - -", gain: 0.07, level: 1 },
    { voice: "rim", pattern: ". . x . . . x . . . x . . x x .", gain: 0.14, level: 1 },
    // 2단계: 마지막 기회 — 탐과 리드
    { voice: "tom", pattern: "x . . x . . x . x . . x . x x x", gain: 0.2, level: 2 },
    { voice: "lead", div: 2, pattern: "D5 - F#5 - A5 - D6 - | B5 - - - A5 - F#5 - | G5 - B5 - D6 - - - | E6 - C#6 - A5 - - -", gain: 0.06, level: 2 },
  ],
  sfx: SFX,
};

export const getRopeClimbSound = defineSuite(ROPE_CLIMB_SUITE);
