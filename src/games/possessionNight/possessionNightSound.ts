import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 빙의의 밤 "Night Rite" — 산골 고택의 밤. 가야금(koto) 계면조 선율이 띄엄띄엄 튕기고, 대금(shakuhachi)이 길게
 * 흐느끼며, 멀리서 굿판 북(taiko)과 목탁(woodblock)이 들린다. 66 BPM D 계면조(D F G A C).
 * 상황에 따라 3단계 (보드가 `setIntensity`):
 *   0 평소 — 가야금 + 대금 · 1 원귀가 가깝다(영기 2↑·공황) — 반음 어긋난 합창과 북 ·
 *   2 빙의 직전 / 퇴마 의식 — 빠른 북 장단과 높은 현악 트레몰로.
 *
 * 효과음 arg는 대부분 **크기 0~1**. 소리로만 알리는 신호는 없다: 속삭임은 화면 가장자리 글자와 방향 표시로,
 * 덜컹은 그 자리의 흔들림과 알림으로, 영기는 🔮 막대로도 나온다.
 */

const vol = (v: number) => (v > 0 && v <= 1 ? v : 1);

const SFX = {
  /** 내 발소리 (마루·흙). arg: 2 걷기 · 3 달리기 */
  step: (mode: number) => {
    const k = mode >= 3 ? 1 : 0.5;
    return [{ wave: "noise", dur: 0.06, peak: 0.05 * k, attack: 0.003, filter: { type: "bandpass", freq: 900, q: 1.2 } }, fx.thud(95 + k * 25, 0.07, 0.08 * k)];
  },
  /** 마루가 삐걱 (원귀가 떠다닐 때 원귀 자신에게) */
  float: [{ wave: "sine", freq: 180, to: 150, glide: 0.8, dur: 0.9, peak: 0.03, attack: 0.3, filter: { type: "lowpass", freq: 500 } }],
  /** 심장 "쿵-쿵". arg = 세기 0~1 */
  beat: (v: number) => {
    const k = 0.35 + vol(v) * 0.65;
    return [fx.thud(58, 0.13, 0.42 * k), fx.thud(50, 0.16, 0.3 * k, 0.17)];
  },
  /** 한기 — 입김 (원귀가 5m 안) */
  chill: [{ wave: "noise", dur: 0.9, peak: 0.05, attack: 0.25, filter: { type: "bandpass", freq: 1600, to: 900, q: 1.5 } }, { wave: "sine", freq: 880, to: 840, glide: 0.9, dur: 0.9, peak: 0.015, attack: 0.3 }],
  lightOn: [fx.click(2400, 0.1), fx.click(1500, 0.06, 0.02)],
  lightOff: [fx.click(1300, 0.09)],
  lightDead: [fx.click(900, 0.08), { wave: "sine", freq: 620, to: 200, glide: 0.5, dur: 0.55, peak: 0.05, attack: 0.01 }],
  /** 반닫이·항아리 뒤지는 소리 */
  rummage: [
    { wave: "noise", dur: 0.14, peak: 0.05, attack: 0.02, filter: { type: "bandpass", freq: 1800, q: 0.8 } },
    fx.click(500, 0.05, 0.09),
    { wave: "noise", at: 0.2, dur: 0.1, peak: 0.04, filter: { type: "bandpass", freq: 1200, q: 1 } },
  ],
  empty: [fx.thud(170, 0.1, 0.14), { wave: "noise", dur: 0.2, peak: 0.03, attack: 0.03, filter: { type: "highpass", freq: 3000 } }],
  /** 🪆 저주받은 물건을 찾음 — 소름 */
  curse: [{ inst: "koto", note: "D5", dur: 0.6, gain: 0.5 }, { inst: "koto", note: "Eb5", at: 0.12, dur: 0.8, gain: 0.45 }, ...fx.chord("strings", ["D4", "Eb4", "A4"], 1.4, 0.3, 0.2), fx.thud(60, 0.4, 0.3)],
  water: [{ wave: "noise", dur: 0.4, peak: 0.12, attack: 0.01, filter: { type: "bandpass", freq: 2800, to: 1400, q: 0.9 } }, { inst: "bell", note: "A5", at: 0.05, dur: 0.6, gain: 0.25 }],
  /** 💧 성수가 원귀에게 맞음 — 비명 + 쉬익 */
  ghostHit: [{ wave: "sawtooth", freq: 900, to: 200, glide: 0.6, dur: 0.8, peak: 0.12, attack: 0.005, filter: { type: "bandpass", freq: 1500, q: 2 }, vibrato: { rate: 23, depth: 0.12 } }, { wave: "noise", dur: 0.7, peak: 0.1, attack: 0.005, filter: { type: "highpass", freq: 2400 } }, { inst: "gong", note: "D3", at: 0.1, dur: 1.8, gain: 0.35 }],
  waterFound: [{ inst: "bell", note: "A5", dur: 0.5, gain: 0.3 }, { inst: "bell", note: "D6", at: 0.1, dur: 0.5, gain: 0.25 }],
  tea: [{ inst: "koto", note: "A4", dur: 0.6, gain: 0.35 }, { inst: "pad", note: "D4", dur: 1.4, gain: 0.25 }],
  teaFound: [fx.click(1300, 0.08), { inst: "koto", note: "G5", at: 0.06, dur: 0.4, gain: 0.3 }],
  battery: [fx.click(1800, 0.12), fx.click(2300, 0.1, 0.09), { inst: "glock", note: "A5", at: 0.1, dur: 0.2, gain: 0.3 }],
  full: [fx.buzz(200, 150, 0.16, 0.07)],
  /** 🔥 화로에 태움 — 화르륵. arg = 몇 번째 */
  burn: (n: number) => {
    const notes = ["D4", "F4", "G4", "A4", "C5", "D5", "F5"];
    const note = notes[Math.max(0, Math.min(6, Math.round(n) - 1))];
    return [{ wave: "noise", dur: 1.0, peak: 0.12, attack: 0.05, filter: { type: "bandpass", freq: 700, to: 2600, q: 0.7 } }, fx.thud(70, 0.3, 0.4), { inst: "gong", note: "D3", at: 0.15, dur: 2, gain: 0.35 }, { inst: "koto", note, at: 0.3, dur: 1.2, gain: 0.5 }];
  },
  ritualStart: [{ inst: "gong", note: "D2", dur: 3, gain: 0.7 }, ...fx.chord("choir", ["D4", "A4", "D5"], 2.5, 0.4, 0.3), { inst: "taiko", note: "D2", at: 0.4, dur: 0.4, gain: 0.6 }],
  /** 등잔 켜기 */
  lantern: [fx.click(2000, 0.06), { wave: "noise", at: 0.05, dur: 0.35, peak: 0.05, attack: 0.05, filter: { type: "bandpass", freq: 900, q: 1 } }, { inst: "koto", note: "A5", at: 0.2, dur: 0.6, gain: 0.25 }],
  pick: [fx.click(800, 0.08), { inst: "koto", note: "D5", at: 0.05, dur: 0.5, gain: 0.3 }],
  /** 🗣️ 속삭임 (그 사람에게만) — 낮게 웅얼 */
  whisper: [
    { wave: "noise", dur: 1.3, peak: 0.09, attack: 0.2, filter: { type: "bandpass", freq: 1300, to: 2200, q: 4 }, tremolo: 7 },
    { wave: "noise", at: 0.3, dur: 1.0, peak: 0.07, attack: 0.2, filter: { type: "bandpass", freq: 2600, to: 1500, q: 5 }, tremolo: 11 },
    { wave: "sine", freq: 220, to: 207, glide: 1.2, dur: 1.3, peak: 0.03, attack: 0.3 },
  ],
  /** 💥 덜컹 (arg = 크기) */
  slam: (v: number) => {
    const k = vol(v);
    return [fx.thud(90, 0.3, 0.6 * k), fx.thud(70, 0.25, 0.45 * k, 0.12), ...fx.crack(0, 0.35 * k), { wave: "noise", dur: 0.25, peak: 0.12 * k, attack: 0.002, filter: { type: "bandpass", freq: 600, q: 1 } }];
  },
  /** 🕯️ 소등 — 훅 */
  snuff: (v: number) => [fx.whoosh(1600, 200, 0.5, 0.1 * vol(v)), { wave: "noise", dur: 0.5, peak: 0.06 * vol(v), attack: 0.02, filter: { type: "lowpass", freq: 600 } }],
  /** 👁️ 현신 — 날카로운 현악 + 비명 */
  manifest: (v: number) => {
    const k = vol(v);
    return [...fx.chord("strings", ["D5", "Eb5", "A5", "Bb5"], 1.6, 0.5 * k), { wave: "sawtooth", freq: 400, to: 1400, glide: 0.25, dur: 1.2, peak: 0.12 * k, attack: 0.01, filter: { type: "bandpass", freq: 1900, q: 2 }, vibrato: { rate: 9, depth: 0.08 } }, fx.thud(45, 0.8, 0.6 * k)];
  },
  /** 👻 내가 빙의당함 */
  possessMe: [
    fx.thud(40, 1.2, 0.9),
    { wave: "sawtooth", freq: 160, to: 1800, glide: 0.12, dur: 1.3, peak: 0.24, attack: 0.002, filter: { type: "bandpass", freq: 2200, q: 1.6 }, vibrato: { rate: 33, depth: 0.12 } },
    { wave: "noise", dur: 1.4, peak: 0.2, attack: 0.002, filter: { type: "highpass", freq: 1400 } },
    ...fx.chord("choir", ["D3", "Eb3", "A3", "Bb3"], 2.2, 0.55),
  ],
  possessFar: (v: number) => {
    const k = vol(v);
    return [fx.thud(55, 0.6, 0.45 * k), { wave: "sawtooth", freq: 300, to: 1100, glide: 0.3, dur: 0.9, peak: 0.1 * k, attack: 0.01, filter: { type: "bandpass", freq: 1800, q: 2 } }, { inst: "gong", note: "D2", at: 0.2, dur: 2.2, gain: 0.4 * k }];
  },
  revive: [...fx.arp("koto", ["D5", "F5", "G5", "A5", "D6"], 0.08, 0.8, 0.55), { inst: "bell", note: "D5", dur: 1.4, gain: 0.3 }],
  /** 공황 — 숨이 가빠진다 */
  panic: [{ wave: "noise", dur: 0.35, peak: 0.08, attack: 0.05, filter: { type: "bandpass", freq: 900, q: 1.5 } }, { wave: "noise", at: 0.45, dur: 0.35, peak: 0.08, attack: 0.05, filter: { type: "bandpass", freq: 1000, q: 1.5 } }, ...fx.chord("strings", ["D6", "Eb6"], 1.2, 0.25)],
  calm: [{ inst: "pad", note: "D4", dur: 1.2, gain: 0.25 }],
  /** 🌫️ 불길 꺾기 */
  quench: [fx.whoosh(2000, 300, 0.8, 0.14), { inst: "gong", note: "Eb2", at: 0.2, dur: 2, gain: 0.45 }],
  /** 원귀: 힘을 못 씀 */
  denied: [fx.buzz(180, 140, 0.1, 0.06)],
  /** 원귀: 유예가 끝나 힘이 깨어난다 */
  awaken: [{ inst: "gong", note: "D2", dur: 3, gain: 0.55 }, { wave: "sawtooth", freq: 55, to: 49, glide: 2, dur: 2.4, peak: 0.08, attack: 0.6, filter: { type: "lowpass", freq: 260 } }],
  /** 첫닭 1분 전 */
  lastMinute: [{ inst: "shakuhachi", note: "A5", dur: 0.6, gain: 0.5 }, { inst: "shakuhachi", note: "D6", at: 0.6, dur: 1.2, gain: 0.5 }, fx.thud(60, 0.3, 0.3, 1.6)],
  ui: [fx.click(900, 0.05)],
  victory: [...fx.arp("koto", ["D4", "F4", "G4", "A4", "C5", "D5", "F5", "A5"], 0.09, 1.6, 0.6), ...fx.chord("strings", ["D4", "A4", "D5", "F5"], 3, 0.45, 0.5), { inst: "bell", note: "D5", at: 0.7, dur: 2.5, gain: 0.4 }],
  defeat: [
    { inst: "choir", note: "D3", dur: 3, gain: 0.4 },
    { inst: "choir", note: "Eb3", at: 0.4, dur: 2.8, gain: 0.35 },
    { inst: "gong", note: "D2", dur: 3.5, gain: 0.6 },
    { wave: "sawtooth", freq: 55, to: 36, glide: 2.5, dur: 3, peak: 0.14, attack: 0.3, filter: { type: "lowpass", freq: 260 } },
  ],
} satisfies Record<string, SfxRecipe>;

export const POSSESSION_NIGHT_SUITE: SuiteConfig = {
  bpm: 66,
  tracks: [
    // 0: 가야금 계면조 + 대금 + 멀리 목탁
    { voice: "koto", div: 2, pattern: "D4 . . A4 . . G4 F4 | D4 . . . C4 . D4 . | A3 . C4 . D4 . F4 . | G4 . F4 . D4 . . .", gain: 0.12, maxLevel: 1 },
    { voice: "shakuhachi", div: 16, pattern: "A4 | G4 | F4 | D4", gain: 0.07, maxLevel: 1 },
    { voice: "woodblock", div: 4, pattern: "x . . . . . . . x . . . . . x .", gain: 0.05 },
    { voice: "crackle", div: 4, pattern: ". . x . . . . . . x . . . . . . . . . . x . . .", gain: 0.04 },
    { voice: "pad", div: 16, pattern: "D2+A2 | C2+G2 | Bb1+F2 | A1+E2", gain: 0.12 },
    // 1: 원귀가 가깝다 — 반음 어긋난 합창, 낮은 북
    { voice: "choir", div: 16, pattern: "D4+Eb4 | D4+Eb4 | C4+Db4 | D4+Eb4", gain: 0.1, level: 1 },
    { voice: "taiko", pattern: "x . . x . . . . x . . . . . . .", gain: 0.2, level: 1, maxLevel: 2 },
    // 2: 빙의 직전 / 퇴마 의식 — 굿판 장단 + 높은 현악 트레몰로
    { voice: "taiko", pattern: "x . x x . x . x x . x . x x x .", gain: 0.3, level: 2 },
    { voice: "strings", pattern: "D6 D6 D6 D6 D6 D6 D6 D6 Eb6 Eb6 Eb6 Eb6 Eb6 Eb6 Eb6 Eb6 | D6 D6 D6 D6 D6 D6 D6 D6 C6 C6 C6 C6 C6 C6 C6 C6", gain: 0.07, level: 2 },
    { voice: "gong", div: 16, pattern: "D2 . . .", gain: 0.2, level: 2 },
  ],
  sfx: SFX,
};

export const getPossessionNightSound = defineSuite(POSSESSION_NIGHT_SUITE);
