import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 눈싸움 요새전 "Snow Day March" suite (룰북 §11) — 썰매 방울이 짤랑이는 신나는 겨울 행진곡
 * (C장조 132 BPM): 글로켄 멜로디, 피치카토 베이스, 스네어 행진, 썰매 방울(셰이커).
 * 단계 1(남은 시간 30초 또는 눈사람 하나가 절반 아래)엔 금관이 들어오고, 단계 2(❄️ 눈보라)엔
 * 팀파니와 바람 소리가 겹친다.
 */

const SFX = {
  /** arg = 모은 힘 0..1 */
  throw: (p: number) => [fx.whoosh(700 + p * 900, 1600 + p * 1400, 0.16 + p * 0.1, 0.08 + p * 0.05)],
  /** 맞은 소리 (퍽!) */
  hit: [fx.thud(180, 0.12, 0.45), { wave: "noise", dur: 0.12, peak: 0.16, attack: 0.002, filter: { type: "lowpass", freq: 2200, to: 600 } }],
  /** 내가 맞음 — 더 둔하고 크게 */
  ouch: [fx.thud(120, 0.2, 0.6), { wave: "noise", dur: 0.18, peak: 0.2, attack: 0.002, filter: { type: "lowpass", freq: 1600, to: 400 } }, ...fx.arp("pizz", ["E4", "C4"], 0.06, 0.25, 0.5)],
  splat: [{ wave: "noise", dur: 0.09, peak: 0.07, attack: 0.003, filter: { type: "bandpass", freq: 1400, q: 0.8 } }],
  freeze: [...fx.arp("glock", ["E6", "C6", "G5", "E5"], 0.05, 0.5, 0.7), { wave: "noise", dur: 0.5, peak: 0.06, attack: 0.05, filter: { type: "highpass", freq: 6000 } }],
  myFreeze: [...fx.arp("glock", ["G5", "E5", "C5", "G4"], 0.08, 0.6, 0.8), fx.buzz(300, 150, 0.4, 0.08, 0.1)],
  thaw: [...fx.arp("glock", ["C5", "E5", "G5"], 0.05, 0.4, 0.6)],
  gather: [{ wave: "noise", dur: 0.1, peak: 0.08, attack: 0.02, filter: { type: "bandpass", freq: 900, q: 1.2 } }, fx.click(1200, 0.05, 0.08)],
  wallUp: [fx.thud(140, 0.18, 0.4), { wave: "noise", dur: 0.2, peak: 0.08, filter: { type: "lowpass", freq: 900 } }, fx.click(800, 0.06, 0.12)],
  wallHit: [fx.thud(200, 0.1, 0.3), { wave: "noise", dur: 0.06, peak: 0.08, filter: { type: "bandpass", freq: 1800, q: 1 } }],
  wallBreak: [fx.thud(90, 0.35, 0.6), ...fx.crack(0.01, 0.3)],
  snowman: [fx.thud(110, 0.25, 0.55), { inst: "timpani", note: "C2", gain: 0.5 }],
  snowmanMine: [fx.thud(110, 0.25, 0.55), fx.buzz(260, 180, 0.2, 0.06)],
  dash: [fx.whoosh(500, 2400, 0.2, 0.1)],
  denied: [fx.buzz(220, 150, 0.16, 0.08)],
  pick: [...fx.arp("glock", ["C6", "E6", "G6"], 0.05, 0.4, 0.6), ...fx.coin(0.06)],
  spawn: [{ inst: "bell", note: "G5", dur: 0.6, gain: 0.4 }],
  tick: [fx.click(1800, 0.12)],
  go: [{ inst: "whistle", note: "A5", dur: 0.35, gain: 0.8 }, { inst: "whistle", note: "A5", at: 0.4, dur: 0.6, gain: 0.8 }],
  blizzard: [fx.whoosh(300, 1200, 1.4, 0.14), fx.whoosh(1200, 400, 1.2, 0.1, 0.6), { inst: "gong", note: 1, gain: 0.4 }],
  roundWin: [...fx.arp("brass", ["C4", "E4", "G4", "C5"], 0.09, 0.6, 0.8), ...fx.chord("pad", ["C3", "E3", "G3"], 1.2, 0.6, 0.3)],
  roundLose: [...fx.arp("brass", ["G4", "E4", "C4"], 0.14, 0.6, 0.6), { inst: "timpani", note: "C2", at: 0.3, gain: 0.5 }],
  draw: [...fx.arp("glock", ["C5", "G5", "C5"], 0.1, 0.4, 0.6)],
  victory: [...fx.arp("glock", ["C5", "E5", "G5", "C6", "E6", "G6"], 0.07, 0.6), ...fx.chord("brass", ["C4", "E4", "G4"], 1.6, 0.8, 0.3), { inst: "timpani", note: "C2", at: 0.3, gain: 0.7 }],
  defeat: [...fx.arp("pizz", ["G4", "E4", "C4", "G3"], 0.16, 0.5, 0.7)],
  ui: [fx.click(2400, 0.06)],
} satisfies Record<string, SfxRecipe>;

export const SNOWBALL_SUITE: SuiteConfig = {
  bpm: 132,
  tracks: [
    { voice: "glock", pattern: "E5 . G5 . C6 . G5 . | A5 . F5 . D5 . F5 . | G5 . E5 . C5 . E5 . | D5 . B4 . G4 - - .", gain: 0.3 },
    { voice: "pizz", div: 2, pattern: "C3 . G2 . C3 . G2 . | F2 . C3 . F2 . C3 . | C3 . G2 . C3 . E3 . | G2 . D3 . G2 . B2 .", gain: 0.42 },
    { voice: "snare", pattern: "x . . . x . x . x . . . x . x x", gain: 0.2 },
    { voice: "kick", div: 2, pattern: "x . x . x . x .", gain: 0.3 },
    { voice: "shaker", pattern: "x x x x x x x x x x x x x x x x", gain: 0.1 },
    { voice: "brass", div: 4, pattern: "C4+E4+G4 . . . | F4+A4+C5 . . . | C4+E4+G4 . . . | G3+B3+D4 . . .", gain: 0.16, level: 1 },
    { voice: "timpani", div: 4, pattern: "C2 . G1 . | C2 . G1 . | C2 . G1 . | G1 . G1 G1", gain: 0.35, level: 2 },
  ],
  sfx: SFX,
};

export const getSnowballSound = defineSuite(SNOWBALL_SUITE);
