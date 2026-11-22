import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 정오의 발도 "High Noon Stillness" — A 단조 펜타토닉 84 BPM. 샤쿠하치·고토·타이코.
 * 보드가 `setIntensity`로 3단계를 고른다:
 *   0 합과 합 사이·소개 — 고토 리프·샤쿠하치·타이코 · 1 자세 잡기 — 고토와 북만 얇게 ·
 *   2 신호를 기다리는 동안 — 음악이 거의 멎고 심장 소리·바람만 (가짜 신호 소리가 묻히지 않게).
 *
 * 소리로만 알리는 신호는 없다 — 진짜 신호(❗)와 가짜 신호(🐦🍂🐦‍⬛⚡🥁)는 모두 화면에도 그림·글자로 같이 뜬다(접근성).
 */

const SFX = {
  /** ❗ 진짜 신호 — 징 + 큰 북 */
  signal: [{ inst: "gong", note: "A2", dur: 1.6, gain: 0.9 }, { inst: "taiko", note: "A1", dur: 0.6, gain: 1 }, { wave: "sine", freq: 1760, to: 1500, glide: 0.4, dur: 0.5, peak: 0.08, attack: 0.002 }],
  /** 🐦 새 */
  bird: [...fx.arp("whistle", ["E6", "A6", "G6", "B6"], 0.06, 0.08, 0.5), fx.whoosh(1500, 4000, 0.4, 0.05, 0.05)],
  /** 🍂 낙엽 */
  leaf: [fx.whoosh(1200, 3800, 0.7, 0.09), fx.whoosh(2400, 5200, 0.5, 0.05, 0.2)],
  /** 🐦‍⬛ 까마귀 */
  crow: [
    { wave: "sawtooth", freq: 620, to: 430, glide: 0.18, dur: 0.22, peak: 0.08, attack: 0.01, filter: { type: "bandpass", freq: 1100, q: 2 } },
    { wave: "sawtooth", freq: 600, to: 410, glide: 0.18, at: 0.3, dur: 0.22, peak: 0.07, attack: 0.01, filter: { type: "bandpass", freq: 1100, q: 2 } },
  ],
  /** ⚡ 마른 천둥 */
  thunder: [...fx.crack(0, 0.3), { wave: "noise", at: 0.05, dur: 1.4, peak: 0.12, attack: 0.08, filter: { type: "lowpass", freq: 500, to: 90 } }],
  /** 🥁 어디선가 북소리 (둥-둥, 징은 없다) */
  drum: [{ inst: "taiko", note: "D2", dur: 0.4, gain: 0.7 }, { inst: "taiko", note: "D2", at: 0.22, dur: 0.4, gain: 0.55 }],
  /** 칼을 뽑음 (내 것) */
  draw: [{ wave: "noise", dur: 0.16, peak: 0.12, attack: 0.002, filter: { type: "highpass", freq: 3500 } }, { wave: "sine", freq: 3200, to: 2900, glide: 0.3, dur: 0.45, peak: 0.05, at: 0.05, attack: 0.002 }],
  /** 남이 칼을 뽑음 (작게) */
  drawFar: [{ wave: "noise", dur: 0.12, peak: 0.05, attack: 0.002, filter: { type: "highpass", freq: 3800 } }],
  /** 베기 (합 결과 순간) */
  slash: [fx.whoosh(600, 5200, 0.22, 0.16), ...fx.crack(0.12, 0.22), { wave: "sine", freq: 2600, to: 2200, glide: 0.5, at: 0.12, dur: 0.7, peak: 0.05, attack: 0.002 }],
  /** 부정 출발 */
  early: [fx.buzz(260, 140, 0.4, 0.12), { inst: "woodblock", note: "C5", at: 0.05, dur: 0.1, gain: 0.6 }, { inst: "woodblock", note: "C5", at: 0.2, dur: 0.1, gain: 0.6 }],
  /** 내가 이 합을 이김 */
  point: [...fx.arp("koto", ["A4", "C5", "E5", "A5"], 0.06, 0.5, 0.7), { inst: "taiko", note: "A2", at: 0.05, dur: 0.3, gain: 0.5 }],
  /** 내가 이 합을 짐 */
  lose: [{ inst: "shakuhachi", note: "E4", dur: 0.5, gain: 0.5 }, { inst: "shakuhachi", note: "C4", at: 0.3, dur: 0.8, gain: 0.45 }],
  /** 무승부·다시 */
  replay: [{ inst: "koto", note: "E4", dur: 0.4, gain: 0.5 }, { inst: "koto", note: "E4", at: 0.18, dur: 0.4, gain: 0.4 }],
  /** 경기 승리 (다음 라운드 진출) */
  advance: [...fx.arp("koto", ["A4", "C5", "D5", "E5", "G5", "A5"], 0.07, 0.6, 0.7), { inst: "taiko", note: "A1", at: 0.4, dur: 0.6, gain: 0.7 }, { inst: "gong", note: "A3", at: 0.42, dur: 1, gain: 0.4 }],
  /** 탈락 (나) */
  out: [{ inst: "shakuhachi", note: "A4", dur: 0.5, gain: 0.5 }, { inst: "shakuhachi", note: "G4", at: 0.35, dur: 0.5, gain: 0.5 }, { inst: "shakuhachi", note: "E4", at: 0.7, dur: 1.1, gain: 0.5 }],
  /** ❤️ 하트를 잃음 (난투, 나) */
  heart: [fx.thud(110, 0.3, 0.35), { inst: "koto", note: "E3", at: 0.05, dur: 0.6, gain: 0.5 }],
  /** 자세 잡기 (합 시작) */
  ready: [{ inst: "woodblock", note: "A5", dur: 0.12, gain: 0.6 }, { inst: "woodblock", note: "A5", at: 0.14, dur: 0.12, gain: 0.45 }],
  /** 🔮 예측 고름 */
  pick: [fx.pop(500, 1100, 0.14)],
  /** 다음 라운드 */
  round: [{ inst: "taiko", note: "A1", dur: 0.5, gain: 0.8 }, { inst: "taiko", note: "A1", at: 0.3, dur: 0.5, gain: 0.8 }, { inst: "taiko", note: "E2", at: 0.6, dur: 0.6, gain: 0.9 }],
  victory: [...fx.arp("koto", ["A4", "C5", "E5", "A5", "C6", "E6"], 0.08, 0.8), ...fx.chord("strings", ["A3", "E4", "A4", "C5"], 2, 0.4, 0.5), { inst: "gong", note: "A2", at: 0.5, dur: 2, gain: 0.7 }],
  defeat: [{ inst: "shakuhachi", note: "E4", dur: 0.6, gain: 0.5 }, { inst: "shakuhachi", note: "D4", at: 0.5, dur: 0.6, gain: 0.5 }, { inst: "shakuhachi", note: "A3", at: 1, dur: 1.4, gain: 0.5 }],
  ui: [fx.click(1200, 0.06)],
} satisfies Record<string, SfxRecipe>;

export const NOON_DRAW_SUITE: SuiteConfig = {
  bpm: 84,
  tracks: [
    // 0: 합 사이 — 고토 리프 + 샤쿠하치 + 타이코
    { voice: "taiko", pattern: "A1 . . . . . . . A1 . . A1 . . . . | A1 . . . . . . . A1 . . . E2 . E2 .", gain: 0.34, maxLevel: 2 },
    { voice: "koto", div: 2, pattern: "A3 C4 E4 A4 G4 E4 D4 C4 | A3 C4 D4 E4 G4 E4 D4 . | C4 E4 G4 A4 C5 A4 G4 E4 | D4 E4 G4 E4 D4 C4 A3 .", gain: 0.12, maxLevel: 2 },
    { voice: "shakuhachi", div: 1, pattern: "E5 - - - - - D5 - C5 - - - A4 - - - | G4 - - - A4 - - - - - - - . . . .", gain: 0.07, maxLevel: 1 },
    { voice: "upright", pattern: "A1 . . . . . . . E1 . . . . . . . | F1 . . . . . . . E1 . . . . . . .", gain: 0.24, maxLevel: 1 },
    { voice: "rim", pattern: ". . . . x . . . . . . . x . . x", gain: 0.12, maxLevel: 1 },
    // 2: 신호 기다림 — 심장 소리만
    { voice: "softKick", pattern: "x . x . . . . . . . . . . . . .", gain: 0.3, level: 2 },
    { voice: "pad", div: 1, pattern: "A2+E3 - - - - - - - - - - - - - - -", gain: 0.035, level: 2 },
  ],
  sfx: SFX,
};

export const getNoonDrawSound = defineSuite(NOON_DRAW_SUITE);
