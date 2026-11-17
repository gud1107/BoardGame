import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 술래는 우리 중에 "달빛초등학교, 밤 열두 시" — A 단조 58 BPM. 낡은 풍금 같은 패드 위로 오르골이
 * 술래잡기 노래 비슷한 가락을 느리게 흘린다. 상황에 따라 3단계 (TaggerBoard가 `setIntensity`):
 *   0 평소 — 패드 + 오르골 + 괘종시계 · 1 가면 쓴 술래가 가깝다(심장) — 반음 합창과 북 ·
 *   2 쫓고 쫓기는 중 — 팀파니 오스티나토와 현악 트레몰로.
 *
 * 효과음의 arg는 대부분 **크기 0~1** (멀수록 작게). 소리로만 알리는 신호는 없다:
 * 가면·얼음·봉인·교문은 모두 배너와 알림 글자로도 나온다.
 */

const vol = (v: number) => (v > 0 && v <= 1 ? v : 1);

const SFX = {
  /** 내 발소리. arg: 1 앉아 걷기 · 2 걷기 · 3 달리기 */
  step: (mode: number) => {
    const k = mode >= 3 ? 1 : mode >= 2 ? 0.55 : 0.16;
    return [
      { wave: "noise", dur: 0.07, peak: 0.07 * k, attack: 0.004, filter: { type: "lowpass", freq: 620 + k * 500 } },
      fx.thud(84 + k * 30, 0.08, 0.1 * k),
    ];
  },
  /** 가면 쓴 내 발소리 — 무겁게 끌린다 */
  stepMask: [fx.thud(52, 0.16, 0.22), { wave: "noise", dur: 0.14, peak: 0.05, attack: 0.01, filter: { type: "lowpass", freq: 380 } }],
  /** 심장 "쿵-쿵". arg = 세기 0~1 (술래가 가까울수록 세게) */
  beat: (v: number) => {
    const k = 0.35 + vol(v) * 0.65;
    return [fx.thud(58, 0.13, 0.42 * k), fx.thud(50, 0.16, 0.3 * k, 0.17)];
  },
  lightOn: [fx.click(2400, 0.1), fx.click(1500, 0.06, 0.02)],
  lightOff: [fx.click(1300, 0.09)],
  /** 문 (arg = 크기). 삐걱 */
  door: (v: number) => [
    { wave: "sawtooth", freq: 210, to: 350, glide: 0.35, dur: 0.42, peak: 0.07 * vol(v), attack: 0.03, filter: { type: "bandpass", freq: 950, q: 5 }, vibrato: { rate: 17, depth: 0.05 } },
    fx.thud(130, 0.12, 0.2 * vol(v), 0.36),
  ],
  /** 술래가 문을 두드려 부수기 시작 (arg = 크기) */
  bash: (v: number) => [fx.thud(70, 0.2, 0.5 * vol(v)), fx.thud(66, 0.2, 0.5 * vol(v), 0.32), fx.thud(62, 0.24, 0.55 * vol(v), 0.64)],
  /** 문이 박살나며 열림 (arg = 크기) */
  slam: (v: number) => [fx.thud(62, 0.5, 0.75 * vol(v)), ...fx.crack(0.01, 0.4 * vol(v)), { wave: "noise", dur: 0.5, peak: 0.16 * vol(v), filter: { type: "lowpass", freq: 500, to: 120 } }],
  /** 봉인하는 동안 반복 — 부적 종이 스치는 소리와 낮은 웅얼거림 */
  sealing: [
    { wave: "noise", dur: 0.16, peak: 0.04, attack: 0.03, filter: { type: "bandpass", freq: 2400, q: 0.9 } },
    { wave: "sine", freq: 220, dur: 0.5, peak: 0.035, attack: 0.1, vibrato: { rate: 5, depth: 0.02 } },
  ],
  /** 봉인 하나 완성. arg = 몇 번째 */
  sealDone: (n: number) => {
    const notes = ["A4", "C5", "E5", "A5", "C6"];
    const note = notes[Math.max(0, Math.min(4, Math.round(n) - 1))];
    return [fx.whoosh(300, 2600, 0.6, 0.14), { inst: "bell", note, dur: 2, gain: 0.7 }, { inst: "choir", note, at: 0.1, dur: 1.8, gain: 0.3 }];
  },
  /** 술래가 봉인을 걷어참 (arg = 크기) */
  kick: (v: number) => [fx.thud(90, 0.25, 0.6 * vol(v)), ...fx.crack(0.02, 0.3 * vol(v)), { inst: "bell", note: "A3", at: 0.05, dur: 0.9, gain: 0.3 * vol(v) }],
  /** 가면을 쓰기 시작 — 낮게 끓는 소리 (arg = 크기) */
  maskOn: (v: number) => [
    { wave: "sawtooth", freq: 48, to: 96, glide: 1.3, dur: 1.5, peak: 0.16 * vol(v), attack: 0.2, filter: { type: "lowpass", freq: 420 }, tremolo: 17 },
    { wave: "noise", dur: 1.4, peak: 0.07 * vol(v), attack: 0.5, filter: { type: "bandpass", freq: 500, to: 1800, q: 2 } },
  ],
  /** 가면을 다 씀 — 웃음 섞인 비명 (arg = 크기) */
  masked: (v: number) => {
    const k = vol(v);
    return [
      { wave: "sawtooth", freq: 520, to: 1300, glide: 0.4, dur: 0.9, peak: 0.15 * k, attack: 0.02, filter: { type: "bandpass", freq: 2000, q: 2.5 }, vibrato: { rate: 27, depth: 0.1 } },
      { wave: "square", freq: 780, to: 390, glide: 0.5, at: 0.2, dur: 0.7, peak: 0.06 * k, attack: 0.02, vibrato: { rate: 9, depth: 0.2 } },
      fx.thud(46, 0.7, 0.5 * k),
    ];
  },
  maskOff: (v: number) => [{ wave: "noise", dur: 0.7, peak: 0.08 * vol(v), attack: 0.02, filter: { type: "lowpass", freq: 2400, to: 200 } }, { inst: "musicbox", note: "A4", at: 0.3, dur: 0.7, gain: 0.25 * vol(v) }],
  /** 덮치기 (arg = 크기) */
  swing: (v: number) => [fx.whoosh(260, 1500, 0.3, 0.16 * vol(v)), fx.thud(70, 0.2, 0.3 * vol(v), 0.1)],
  /** 내가 얼음이 됨 */
  freezeMe: [
    { wave: "sine", freq: 3200, to: 5200, glide: 0.25, dur: 0.5, peak: 0.12, attack: 0.002 },
    ...fx.arp("glock", ["E6", "C6", "A5", "E5"], 0.05, 0.5, 0.6),
    ...fx.crack(0.02, 0.4),
    fx.thud(44, 0.9, 0.7),
  ],
  /** 누군가 얼음이 됨 (arg = 크기) */
  freeze: (v: number) => [{ wave: "sine", freq: 3000, to: 4600, glide: 0.2, dur: 0.4, peak: 0.08 * vol(v), attack: 0.002 }, ...fx.crack(0.02, 0.25 * vol(v)), fx.thud(52, 0.5, 0.35 * vol(v))],
  /** 녹이는 동안 반복 */
  thawing: [{ wave: "noise", dur: 0.2, peak: 0.035, attack: 0.05, filter: { type: "highpass", freq: 3800 } }, { inst: "glock", note: "E6", dur: 0.2, gain: 0.12 }],
  /** 땡! */
  thaw: [...fx.arp("glock", ["A5", "C6", "E6", "A6"], 0.06, 0.7, 0.6), fx.pop(500, 900, 0.14)],
  /** 끌려감 */
  out: [{ inst: "bell", note: "A2", dur: 2.4, gain: 0.6 }, { inst: "choir", note: "A2", dur: 2, gain: 0.3 }, { inst: "choir", note: "Eb3", at: 0.3, dur: 1.8, gain: 0.22 }],
  /** 소금 뿌림 */
  salt: [fx.whoosh(1200, 4200, 0.22, 0.1), { wave: "noise", dur: 0.3, peak: 0.1, attack: 0.01, filter: { type: "highpass", freq: 4200 } }],
  /** 소금이 술래에게 맞음 (arg = 크기) */
  saltHit: (v: number) => {
    const k = vol(v);
    return [
      { wave: "noise", dur: 0.9, peak: 0.16 * k, attack: 0.005, filter: { type: "bandpass", freq: 3000, to: 900, q: 1.2 } },
      { wave: "sawtooth", freq: 900, to: 240, glide: 0.7, dur: 0.9, peak: 0.12 * k, attack: 0.01, filter: { type: "bandpass", freq: 1600, q: 2 }, vibrato: { rate: 33, depth: 0.14 } },
      ...fx.arp("bell", ["E6", "A6"], 0.08, 0.8, 0.4 * k),
    ];
  },
  saltFriend: [fx.buzz(240, 180, 0.2, 0.07), { wave: "noise", dur: 0.2, peak: 0.06, filter: { type: "highpass", freq: 4000 } }],
  /** 마지막 봉인 — 빗장이 덜컹거리기 시작 */
  gateWarn: [fx.thud(90, 0.3, 0.5), fx.click(700, 0.2, 0.12), fx.thud(84, 0.3, 0.45, 0.5), fx.click(640, 0.2, 0.62), ...fx.chord("strings", ["A3", "E4", "A4"], 2, 0.35, 0.3)],
  /** 교문이 열림 */
  gatesOpen: [
    { wave: "sawtooth", freq: 120, to: 200, glide: 1, dur: 1.2, peak: 0.1, attack: 0.05, filter: { type: "bandpass", freq: 700, q: 4 }, vibrato: { rate: 13, depth: 0.06 } },
    fx.thud(60, 0.6, 0.6, 1.0),
    ...fx.arp("harp", ["A3", "E4", "A4", "C#5", "E5"], 0.09, 1.4, 0.55),
  ],
  escape: [fx.whoosh(400, 3000, 0.7, 0.12), ...fx.arp("harp", ["A4", "C#5", "E5", "A5"], 0.08, 1.2, 0.6)],
  lastMinute: [{ inst: "bell", note: "A3", dur: 1.6, gain: 0.7 }, { inst: "bell", note: "A3", at: 0.7, dur: 1.6, gain: 0.7 }, fx.buzz(120, 90, 0.8, 0.08, 0.2)],
  denied: [fx.buzz(180, 140, 0.1, 0.06)],
  ui: [fx.click(900, 0.05)],
  /** 내 편이 이김 */
  victory: [...fx.arp("harp", ["A3", "C#4", "E4", "A4", "C#5", "E5", "A5"], 0.1, 1.6, 0.6), ...fx.chord("strings", ["A3", "C#4", "E4", "A4"], 3, 0.5, 0.5), { inst: "bell", note: "A5", at: 0.7, dur: 2.5, gain: 0.4 }],
  /** 내 편이 짐 */
  defeat: [
    { inst: "choir", note: "A2", dur: 3, gain: 0.4 },
    { inst: "choir", note: "Bb2", at: 0.4, dur: 2.8, gain: 0.35 },
    { inst: "gong", note: "A1", dur: 3.5, gain: 0.6 },
    { wave: "sawtooth", freq: 55, to: 36, glide: 2.5, dur: 3, peak: 0.14, attack: 0.3, filter: { type: "lowpass", freq: 260 } },
  ],
  /** 비김 */
  draw: [...fx.chord("strings", ["A3", "D4", "E4"], 2.4, 0.4), { inst: "bell", note: "E4", at: 0.3, dur: 2, gain: 0.4 }],
} satisfies Record<string, SfxRecipe>;

export const TAGGER_AMONG_US_SUITE: SuiteConfig = {
  bpm: 58,
  tracks: [
    // 0: 낡은 풍금 같은 패드
    { voice: "pad", div: 16, pattern: "A1+E2 | A1+E2 | F1+C2 | E1+B1", gain: 0.2 },
    { voice: "pad", div: 16, pattern: "C3 | E3 | C3 | B2", gain: 0.07, maxLevel: 2 },
    // 오르골: 술래잡기 노래처럼 들리다 마는 가락
    { voice: "musicbox", div: 2, pattern: "E5 . E5 . A5 . . . | G5 . E5 . . . . . | . . . . D5 . E5 . | C5 . . . . . B4 . | E5 . E5 . A5 . . . | G5 . . . . . F5 . | . . . . . . . . | . . . A4 . . . .", gain: 0.1, maxLevel: 2 },
    { voice: "tock", div: 4, pattern: "x . . . x . . . x . . . x . . .", gain: 0.045, maxLevel: 1 },
    { voice: "crackle", div: 4, pattern: ". . x . . . . . . x . . . . . . . . . . x . . .", gain: 0.05 },
    // 1: 가면이 가깝다 — 반음 부딪히는 합창, 심장 같은 북
    { voice: "choir", div: 16, pattern: "A3+Bb3 | A3+Bb3 | G#3+A3 | A3+Bb3", gain: 0.1, level: 1 },
    { voice: "taiko", pattern: "x . . x . . . . . . . . . . . .", gain: 0.2, level: 1, maxLevel: 2 },
    // 2: 추격 — 팀파니 오스티나토 + 높은 현악 트레몰로 + 찌르는 스탭
    { voice: "timpani", pattern: "A1 . A1 . A1 . A1 A1 A1 . A1 . A1 . Bb1 Bb1", gain: 0.3, level: 2 },
    { voice: "taiko", pattern: "x . x . x . x x x . x . x . x x", gain: 0.24, level: 2 },
    { voice: "strings", pattern: "A5 A5 A5 A5 A5 A5 A5 A5 Bb5 Bb5 Bb5 Bb5 Bb5 Bb5 Bb5 Bb5 | A5 A5 A5 A5 A5 A5 A5 A5 G#5 G#5 G#5 G#5 G#5 G#5 G#5 G#5", gain: 0.07, level: 2 },
    { voice: "stab", div: 8, pattern: "A3+Eb4 . . Bb3+E4", gain: 0.1, level: 2 },
  ],
  sfx: SFX,
};

export const getTaggerAmongUsSound = defineSuite(TAGGER_AMONG_US_SUITE);
