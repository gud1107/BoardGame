import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 숨죽인 병동 "Ward at 3 A.M." — 음악이라기보다 공기: D 단조 54 BPM의 낮은 패드 위로 고장 난 오르골이
 * 드문드문 울린다. 상황에 따라 3단계 (HushedWardBoard가 `setIntensity`):
 *   0 평소 — 패드 + 오르골 + 먼 틱톡 · 1 귀신이 가깝다 — 반음 부딪히는 합창과 북(심장) ·
 *   2 추격 — 팀파니 오스티나토와 높은 현악 트레몰로.
 *
 * 효과음의 arg는 대부분 **크기 0~1** (멀수록 작게 — 귀신의 "딱…딱…" 소리로 거리를 가늠한다).
 * 소리로만 알리는 신호는 없다: 귀신 접근은 화면 가장자리 떨림·심장 아이콘, 종은 큰 글자와 화면 색으로도 나온다.
 */

const vol = (v: number) => (v > 0 && v <= 1 ? v : 1);

const SFX = {
  /** 내 발소리. arg: 1 앉아 걷기 · 2 걷기 · 3 달리기 */
  step: (mode: number) => {
    const k = mode >= 3 ? 1 : mode >= 2 ? 0.55 : 0.16;
    return [
      { wave: "noise", dur: 0.07, peak: 0.07 * k, attack: 0.004, filter: { type: "lowpass", freq: 520 + k * 500 } },
      fx.thud(70 + k * 30, 0.08, 0.1 * k),
    ];
  },
  /** 남의 발소리 (arg = 크기) */
  stepFar: (v: number) => [{ wave: "noise", dur: 0.06, peak: 0.05 * vol(v), attack: 0.004, filter: { type: "lowpass", freq: 600 } }],
  /** 심장 "쿵-쿵". arg = 세기 0~1 */
  beat: (v: number) => {
    const k = 0.35 + vol(v) * 0.65;
    return [fx.thud(58, 0.13, 0.42 * k), fx.thud(50, 0.16, 0.3 * k, 0.17)];
  },
  /** 숨 들이마심 (참기 시작) */
  inhale: [{ wave: "noise", dur: 0.38, peak: 0.07, attack: 0.25, filter: { type: "bandpass", freq: 900, to: 2400, q: 1.2 } }],
  /** 숨 내쉼 (참기 끝) */
  exhale: [{ wave: "noise", dur: 0.55, peak: 0.06, attack: 0.04, filter: { type: "bandpass", freq: 1800, to: 600, q: 1 } }],
  /** 숨이 터짐 "헉!" (arg = 크기: 남의 것은 작게) */
  gasp: (v: number) => [
    { wave: "noise", dur: 0.3, peak: 0.2 * vol(v), attack: 0.01, filter: { type: "bandpass", freq: 1500, to: 3200, q: 1.5 } },
    { wave: "sawtooth", freq: 260, to: 420, glide: 0.12, dur: 0.2, peak: 0.07 * vol(v), attack: 0.01, filter: { type: "lowpass", freq: 1200 } },
    { wave: "noise", at: 0.36, dur: 0.5, peak: 0.1 * vol(v), attack: 0.05, filter: { type: "bandpass", freq: 1900, to: 700, q: 1 } },
  ],
  lightOn: [fx.click(2400, 0.1), fx.click(1500, 0.06, 0.02)],
  lightOff: [fx.click(1300, 0.09)],
  /** 건전지가 바닥 */
  lightDead: [fx.click(900, 0.08), { wave: "sine", freq: 620, to: 200, glide: 0.5, dur: 0.55, peak: 0.05, attack: 0.01 }],
  /** 문 (arg = 크기). 삐걱 */
  door: (v: number) => [
    { wave: "sawtooth", freq: 190, to: 330, glide: 0.35, dur: 0.42, peak: 0.07 * vol(v), attack: 0.03, filter: { type: "bandpass", freq: 900, q: 5 }, vibrato: { rate: 17, depth: 0.05 } },
    fx.thud(120, 0.12, 0.2 * vol(v), 0.36),
  ],
  /** 앉아서 조용히 여는 문 */
  doorSoft: [{ wave: "sawtooth", freq: 170, to: 210, glide: 0.5, dur: 0.5, peak: 0.018, attack: 0.1, filter: { type: "bandpass", freq: 800, q: 6 } }],
  /** 귀신이 문을 박차고 연다 (arg = 크기) */
  slam: (v: number) => [fx.thud(62, 0.5, 0.75 * vol(v)), ...fx.crack(0.01, 0.4 * vol(v)), { wave: "noise", dur: 0.5, peak: 0.16 * vol(v), filter: { type: "lowpass", freq: 500, to: 120 } }],
  /** 서랍 뒤지는 소리 (누르는 동안 반복) */
  rummage: [
    { wave: "noise", dur: 0.12, peak: 0.05, attack: 0.02, filter: { type: "bandpass", freq: 2600, q: 0.8 } },
    fx.click(700, 0.05, 0.08),
    { wave: "noise", at: 0.18, dur: 0.1, peak: 0.04, filter: { type: "bandpass", freq: 1700, q: 1 } },
  ],
  empty: [fx.thud(180, 0.1, 0.14), { wave: "noise", dur: 0.2, peak: 0.03, attack: 0.03, filter: { type: "highpass", freq: 3000 } }],
  /** 봉인 부적을 찾음 — 서늘한 종소리 */
  talisman: [...fx.arp("bell", ["D5", "A5", "D6"], 0.16, 1.2, 0.55), { inst: "choir", note: "D4", dur: 1.4, gain: 0.25 }],
  battery: [fx.click(1800, 0.12), fx.click(2300, 0.1, 0.09), { inst: "glock", note: "A5", at: 0.1, dur: 0.2, gain: 0.3 }],
  bottle: [{ wave: "sine", freq: 2100, dur: 0.18, peak: 0.08, attack: 0.002 }, { wave: "sine", freq: 3150, at: 0.05, dur: 0.14, peak: 0.05, attack: 0.002 }],
  pillGet: [fx.click(1500, 0.06), fx.click(1700, 0.05, 0.05), fx.click(1400, 0.05, 0.11)],
  charmGet: [...fx.arp("musicbox", ["D5", "F5", "A5"], 0.09, 0.6, 0.5)],
  full: [fx.buzz(200, 150, 0.16, 0.07)],
  /** 진정제 삼킴 */
  pill: [fx.pop(300, 180, 0.12), { inst: "pad", note: "D4", at: 0.1, dur: 1.2, gain: 0.3 }],
  /** 약병 던짐 */
  throw: [fx.whoosh(500, 1700, 0.26, 0.09)],
  /** 약병이 깨짐 (arg = 크기) */
  shatter: (v: number) => [
    ...fx.crack(0, 0.45 * vol(v)),
    { wave: "noise", dur: 0.4, peak: 0.16 * vol(v), attack: 0.002, filter: { type: "highpass", freq: 3600 } },
    { wave: "sine", freq: 4200, to: 2600, glide: 0.2, at: 0.03, dur: 0.24, peak: 0.07 * vol(v), attack: 0.002 },
    { wave: "sine", freq: 5300, to: 3100, glide: 0.25, at: 0.08, dur: 0.3, peak: 0.05 * vol(v), attack: 0.002 },
  ],
  /** 종 — 정적 예고 (세 번 울린다) */
  toll: [
    { inst: "bell", note: "D3", dur: 2.4, gain: 0.9 },
    { inst: "gong", note: "D2", dur: 2.6, gain: 0.35 },
    { wave: "sine", freq: 73.4, dur: 2.2, peak: 0.16, attack: 0.01 },
  ],
  /** 정적 시작 — 공기가 빨려 나간다 */
  hush: [
    { wave: "noise", dur: 1.1, peak: 0.1, attack: 0.02, filter: { type: "lowpass", freq: 3000, to: 90 } },
    { wave: "sine", freq: 48, dur: 1.6, peak: 0.26, attack: 0.3 },
  ],
  /** 정적 끝 — 무사히 */
  hushEnd: [{ inst: "pad", note: "D4", dur: 1.6, gain: 0.35 }, { inst: "musicbox", note: "A5", at: 0.2, dur: 0.8, gain: 0.3 }],
  /** 귀신이 깨어남 (멀리서 끌리는 소리) */
  wake: [
    { wave: "sawtooth", freq: 52, to: 44, glide: 2, dur: 2.4, peak: 0.12, attack: 0.6, filter: { type: "lowpass", freq: 240 } },
    { wave: "noise", dur: 2.2, peak: 0.05, attack: 0.8, filter: { type: "bandpass", freq: 300, to: 900, q: 2 } },
    { inst: "gong", note: "D2", at: 0.4, dur: 2.5, gain: 0.3 },
  ],
  /** 귀신의 "딱…딱…" (arg = 크기 — 가까울수록 크게) */
  click: (v: number) => {
    const k = vol(v);
    return [
      { wave: "square", freq: 1350, to: 620, glide: 0.018, dur: 0.028, peak: 0.16 * k, attack: 0.001, filter: { type: "bandpass", freq: 1500, q: 3 } },
      { wave: "noise", dur: 0.02, peak: 0.1 * k, attack: 0.001, filter: { type: "highpass", freq: 2500 } },
    ];
  },
  /** 귀신이 귀를 세움 — 목이 꺾이는 소리 (arg = 크기) */
  notice: (v: number) => {
    const k = vol(v);
    return [0, 0.07, 0.13, 0.18, 0.22].flatMap((at, i) => [
      { wave: "square" as const, freq: 900 - i * 90, to: 420, glide: 0.02, dur: 0.03, peak: 0.13 * k, at, attack: 0.001, filter: { type: "bandpass" as const, freq: 1200, q: 3 } },
    ]);
  },
  /** 추격 시작 — 비명 (arg = 크기) */
  screech: (v: number) => {
    const k = vol(v);
    return [
      { wave: "sawtooth", freq: 620, to: 1500, glide: 0.5, dur: 1.1, peak: 0.16 * k, attack: 0.03, filter: { type: "bandpass", freq: 2200, q: 2.5 }, vibrato: { rate: 31, depth: 0.09 } },
      { wave: "square", freq: 911, to: 1760, glide: 0.6, dur: 1.0, peak: 0.07 * k, attack: 0.05, detune: 35, vibrato: { rate: 23, depth: 0.12 } },
      { wave: "noise", dur: 1.1, peak: 0.12 * k, attack: 0.05, filter: { type: "bandpass", freq: 3200, q: 1.2 } },
      fx.thud(48, 0.7, 0.5 * k),
    ];
  },
  /** 놓침 — 낮은 그르렁 */
  lost: (v: number) => [{ wave: "sawtooth", freq: 70, to: 52, glide: 0.8, dur: 0.9, peak: 0.12 * vol(v), attack: 0.1, filter: { type: "lowpass", freq: 420 }, tremolo: 19 }],
  /** 내가 붙잡힘 — 점프 스케어 */
  grabMe: [
    { wave: "sawtooth", freq: 180, to: 1900, glide: 0.09, dur: 1.3, peak: 0.3, attack: 0.002, filter: { type: "bandpass", freq: 2400, q: 1.6 }, vibrato: { rate: 37, depth: 0.14 } },
    { wave: "square", freq: 233, to: 2217, glide: 0.11, dur: 1.2, peak: 0.14, attack: 0.002, vibrato: { rate: 29, depth: 0.1 } },
    { wave: "noise", dur: 1.4, peak: 0.3, attack: 0.002, filter: { type: "highpass", freq: 1200 } },
    fx.thud(40, 1.2, 0.9),
    ...fx.chord("strings", ["D5", "Eb5", "E5", "A5", "Bb5"], 1.6, 0.6),
  ],
  /** 동료가 붙잡힘 (arg = 크기) */
  grabFar: (v: number) => {
    const k = vol(v);
    return [
      { wave: "sawtooth", freq: 420, to: 1300, glide: 0.2, dur: 0.9, peak: 0.12 * k, attack: 0.01, filter: { type: "bandpass", freq: 2000, q: 2 }, vibrato: { rate: 31, depth: 0.1 } },
      { wave: "noise", dur: 0.8, peak: 0.1 * k, attack: 0.01, filter: { type: "bandpass", freq: 1500, q: 1 } },
      fx.thud(52, 0.6, 0.4 * k),
    ];
  },
  /** 수호 부적이 타오름 */
  charm: [
    fx.whoosh(700, 4200, 0.5, 0.16),
    ...fx.arp("bell", ["A5", "D6", "F6", "A6"], 0.06, 0.9, 0.6),
    { wave: "noise", dur: 0.9, peak: 0.1, attack: 0.02, filter: { type: "bandpass", freq: 2600, q: 0.8 } },
  ],
  revive: [...fx.arp("musicbox", ["D5", "F5", "A5", "D6"], 0.1, 0.8, 0.55), { inst: "pad", note: "D4", dur: 1.4, gain: 0.3 }],
  /** 누군가 끝내 숨을 거둠 */
  dead: [{ inst: "bell", note: "D3", dur: 2.4, gain: 0.6 }, { inst: "choir", note: "D3", dur: 2, gain: 0.3 }, { inst: "choir", note: "Ab3", at: 0.3, dur: 1.8, gain: 0.22 }],
  /** 부적을 제단에 붙임 — 불꽃이 인다. arg = 몇 번째 */
  place: (n: number) => {
    const notes = ["D4", "F4", "A4", "D5", "F5", "A5"];
    const note = notes[Math.max(0, Math.min(5, Math.round(n) - 1))];
    return [
      fx.whoosh(300, 2600, 0.6, 0.14),
      { inst: "bell", note, dur: 2, gain: 0.7 },
      { inst: "choir", note, at: 0.1, dur: 1.8, gain: 0.3 },
      { wave: "sawtooth", freq: 60, to: 90, glide: 1.2, at: 0.5, dur: 1.5, peak: 0.1, attack: 0.3, filter: { type: "lowpass", freq: 300 }, tremolo: 13 },
    ];
  },
  /** 현관 자물쇠가 풀림 + 경보 */
  exitOpen: [
    fx.thud(90, 0.3, 0.5),
    fx.click(700, 0.2, 0.12),
    { wave: "square", freq: 660, dur: 0.22, peak: 0.07, at: 0.4, attack: 0.005, filter: { type: "lowpass", freq: 2200 } },
    { wave: "square", freq: 660, dur: 0.22, peak: 0.07, at: 0.85, attack: 0.005, filter: { type: "lowpass", freq: 2200 } },
    { wave: "square", freq: 660, dur: 0.22, peak: 0.07, at: 1.3, attack: 0.005, filter: { type: "lowpass", freq: 2200 } },
    ...fx.chord("strings", ["D4", "A4", "D5"], 1.6, 0.4, 0.3),
  ],
  escape: [fx.whoosh(400, 3000, 0.7, 0.12), ...fx.arp("harp", ["D4", "A4", "D5", "F#5", "A5"], 0.08, 1.2, 0.6)],
  lastMinute: [{ inst: "bell", note: "D3", dur: 1.6, gain: 0.7 }, { inst: "bell", note: "D3", at: 0.7, dur: 1.6, gain: 0.7 }, fx.buzz(120, 90, 0.8, 0.08, 0.2)],
  denied: [fx.buzz(180, 140, 0.1, 0.06)],
  ui: [fx.click(900, 0.05)],
  victory: [...fx.arp("harp", ["D4", "F#4", "A4", "D5", "F#5", "A5", "D6"], 0.1, 1.6, 0.6), ...fx.chord("strings", ["D4", "F#4", "A4", "D5"], 3, 0.5, 0.5), { inst: "bell", note: "D5", at: 0.7, dur: 2.5, gain: 0.4 }],
  defeat: [
    { inst: "choir", note: "D3", dur: 3, gain: 0.4 },
    { inst: "choir", note: "Eb3", at: 0.4, dur: 2.8, gain: 0.35 },
    { inst: "gong", note: "D2", dur: 3.5, gain: 0.6 },
    { wave: "sawtooth", freq: 55, to: 36, glide: 2.5, dur: 3, peak: 0.14, attack: 0.3, filter: { type: "lowpass", freq: 260 } },
  ],
} satisfies Record<string, SfxRecipe>;

export const HUSHED_WARD_SUITE: SuiteConfig = {
  bpm: 54,
  tracks: [
    // 0: 숨 쉬는 듯한 낮은 패드
    { voice: "pad", div: 16, pattern: "D2+A2 | D2+A2 | Bb1+F2 | C2+G2", gain: 0.22 },
    { voice: "pad", div: 16, pattern: "D3 | F3 | D3 | E3", gain: 0.07, maxLevel: 2 },
    // 고장 난 오르골: 드문드문, 끝이 어긋난다
    { voice: "musicbox", div: 2, pattern: "A5 . . . . . . . | . . . F5 . . . . | . . . . . . E5 . | . . D5 . . . C#5 . | . . . . . . . . | A5 . . Bb5 . . . . | . . . . . . . . | . . . . . D5 . .", gain: 0.1, maxLevel: 2 },
    { voice: "tock", div: 4, pattern: "x . . . . . . . . . x . . . . .", gain: 0.05, maxLevel: 1 },
    { voice: "crackle", div: 4, pattern: ". . x . . . . . . x . . . . . . . . . . x . . .", gain: 0.05 },
    // 1: 귀신이 가깝다 — 반음 부딪히는 합창, 심장 같은 북
    { voice: "choir", div: 16, pattern: "D4+Eb4 | D4+Eb4 | C#4+D4 | D4+Eb4", gain: 0.1, level: 1 },
    { voice: "taiko", pattern: "x . . x . . . . . . . . . . . .", gain: 0.2, level: 1, maxLevel: 2 },
    // 2: 추격 — 팀파니 오스티나토 + 높은 현악 트레몰로 + 찌르는 스탭
    { voice: "timpani", pattern: "D2 . D2 . D2 . D2 D2 D2 . D2 . D2 . Eb2 Eb2", gain: 0.3, level: 2 },
    { voice: "taiko", pattern: "x . x . x . x x x . x . x . x x", gain: 0.24, level: 2 },
    { voice: "strings", pattern: "D6 D6 D6 D6 D6 D6 D6 D6 Eb6 Eb6 Eb6 Eb6 Eb6 Eb6 Eb6 Eb6 | D6 D6 D6 D6 D6 D6 D6 D6 C#6 C#6 C#6 C#6 C#6 C#6 C#6 C#6", gain: 0.07, level: 2 },
    { voice: "stab", div: 8, pattern: "D4+Ab4 . . Eb4+A4", gain: 0.1, level: 2 },
  ],
  sfx: SFX,
};

export const getHushedWardSound = defineSuite(HUSHED_WARD_SUITE);
