import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 마네킹 백화점 "Closing Time Muzak" — 폐점 뒤에도 꺼지지 않은 매장 음악이 테이프가 늘어진 듯 느릿느릿 돈다.
 * F 장조 72 BPM 일렉트릭 피아노·비브라폰 라운지 곡이 조금씩 어긋난다. 상황에 따라 3단계 (보드가 `setIntensity`):
 *   0 평소 — 늘어진 매장 음악 · 1 근처에서 삐걱 소리 — 반음 어긋난 합창과 낮은 북 ·
 *   2 바로 앞 / 정전 — 팀파니와 높은 현악 트레몰로.
 *
 * 효과음 arg는 대부분 **크기 0~1** (멀수록 작게). 소리로만 알리는 신호는 없다: 삐걱 소리는 화면 가장자리 표시와
 * 👂 단계로, 정전 경고는 큰 글자와 화면 깜빡임으로도 나온다.
 */

const vol = (v: number) => (v > 0 && v <= 1 ? v : 1);

const SFX = {
  /** 내 발소리 (타일 바닥). arg: 2 걷기 · 3 달리기 */
  step: (mode: number) => {
    const k = mode >= 3 ? 1 : 0.5;
    return [{ wave: "noise", dur: 0.05, peak: 0.06 * k, attack: 0.002, filter: { type: "highpass", freq: 1800 } }, fx.thud(110 + k * 30, 0.06, 0.08 * k)];
  },
  /** 마네킹 관절이 삐걱 (arg = 크기 — 가까울수록 크게) */
  creak: (v: number) => {
    const k = vol(v);
    return [
      { wave: "sawtooth", freq: 420, to: 690, glide: 0.16, dur: 0.2, peak: 0.08 * k, attack: 0.01, filter: { type: "bandpass", freq: 1500, q: 7 }, vibrato: { rate: 41, depth: 0.06 } },
      { wave: "noise", dur: 0.06, peak: 0.05 * k, attack: 0.002, filter: { type: "bandpass", freq: 2600, q: 2 } },
      fx.click(900, 0.05 * k, 0.17),
    ];
  },
  /** 플라스틱 발이 바닥을 긁음 (arg = 크기) */
  scrape: (v: number) => [{ wave: "noise", dur: 0.18, peak: 0.05 * vol(v), attack: 0.03, filter: { type: "bandpass", freq: 700, to: 400, q: 2 } }],
  /** 심장 "쿵-쿵". arg = 세기 0~1 */
  beat: (v: number) => {
    const k = 0.35 + vol(v) * 0.65;
    return [fx.thud(58, 0.13, 0.42 * k), fx.thud(50, 0.16, 0.3 * k, 0.17)];
  },
  lightOn: [fx.click(2400, 0.1), fx.click(1500, 0.06, 0.02)],
  lightOff: [fx.click(1300, 0.09)],
  lightDead: [fx.click(900, 0.08), { wave: "sine", freq: 620, to: 200, glide: 0.5, dur: 0.55, peak: 0.05, attack: 0.01 }],
  /** 상자 뒤지는 소리 */
  rummage: [
    { wave: "noise", dur: 0.14, peak: 0.05, attack: 0.02, filter: { type: "bandpass", freq: 2200, q: 0.8 } },
    fx.click(600, 0.05, 0.09),
    { wave: "noise", at: 0.2, dur: 0.1, peak: 0.04, filter: { type: "bandpass", freq: 1400, q: 1 } },
  ],
  empty: [fx.thud(180, 0.1, 0.14), { wave: "noise", dur: 0.2, peak: 0.03, attack: 0.03, filter: { type: "highpass", freq: 3000 } }],
  /** 퓨즈 찾음 — 전기가 찌릿 */
  fuse: [fx.buzz(120, 240, 0.18, 0.06), ...fx.arp("vibes", ["F5", "A5", "C6"], 0.09, 0.8, 0.6)],
  battery: [fx.click(1800, 0.12), fx.click(2300, 0.1, 0.09), { inst: "glock", note: "A5", at: 0.1, dur: 0.2, gain: 0.3 }],
  camera: [fx.click(2600, 0.1), { wave: "sine", freq: 1800, to: 3600, glide: 0.4, dur: 0.45, peak: 0.04, attack: 0.05 }],
  ribbon: [{ wave: "noise", dur: 0.25, peak: 0.06, attack: 0.02, filter: { type: "bandpass", freq: 3200, q: 1.5 } }, { inst: "glock", note: "C6", at: 0.15, dur: 0.2, gain: 0.25 }],
  full: [fx.buzz(200, 150, 0.16, 0.07)],
  /** 퓨즈를 꽂음 — 배전반이 웅 하고 깨어난다. arg = 몇 번째 */
  place: (n: number) => {
    const notes = ["F4", "A4", "C5", "F5", "A5", "C6"];
    const note = notes[Math.max(0, Math.min(5, Math.round(n) - 1))];
    return [fx.thud(70, 0.3, 0.5), fx.buzz(60, 120, 0.9, 0.07, 0.05), { inst: "vibes", note, at: 0.1, dur: 1.4, gain: 0.7 }, { inst: "choir", note, at: 0.25, dur: 1.4, gain: 0.25 }];
  },
  /** 정문 셔터가 덜컹덜컹 올라간다 */
  exitOpen: [
    fx.thud(80, 0.4, 0.6),
    ...[0.2, 0.42, 0.64, 0.86, 1.08, 1.3, 1.52].map((at) => ({ wave: "noise" as const, at, dur: 0.12, peak: 0.08, attack: 0.005, filter: { type: "bandpass" as const, freq: 900, q: 1.4 } })),
    ...fx.chord("strings", ["F4", "C5", "F5"], 1.8, 0.35, 0.5),
  ],
  escape: [fx.whoosh(400, 3000, 0.7, 0.12), ...fx.arp("harp", ["F4", "C5", "F5", "A5", "C6"], 0.08, 1.2, 0.6)],
  /** 어딘가에서 마네킹 하나가 깨어났다 — 멀리서 플라스틱이 툭 */
  wake: [fx.thud(140, 0.18, 0.12, 0.1), fx.click(700, 0.05, 0.3), { inst: "gong", note: "F2", at: 0.4, dur: 2.2, gain: 0.25 }, { wave: "sawtooth", freq: 55, to: 49, glide: 2, dur: 2.2, peak: 0.08, attack: 0.6, filter: { type: "lowpass", freq: 260 } }],
  /** 형광등이 지직거린다 (정전 경고) */
  flickerWarn: [
    { wave: "square", freq: 120, dur: 2.4, peak: 0.05, attack: 0.05, filter: { type: "lowpass", freq: 900 }, tremolo: 17 },
    { wave: "noise", dur: 2.4, peak: 0.04, attack: 0.1, filter: { type: "bandpass", freq: 3400, q: 3 }, tremolo: 9 },
    fx.click(2200, 0.1, 0.6),
    fx.click(2000, 0.1, 1.4),
  ],
  /** 정전 — 툭 */
  flickerOn: [fx.thud(50, 0.6, 0.7), { wave: "sine", freq: 220, to: 40, glide: 0.4, dur: 0.5, peak: 0.12, attack: 0.002 }],
  /** 불이 다시 들어온다 — 핑 */
  flickerOff: [fx.click(2600, 0.12), { wave: "square", freq: 120, dur: 0.4, peak: 0.04, attack: 0.02, filter: { type: "lowpass", freq: 800 } }],
  /** 내가 붙잡힘 — 플라스틱 손이 어깨를 잡는다 */
  grabMe: [
    fx.thud(45, 1.0, 0.9),
    ...fx.crack(0, 0.4),
    { wave: "sawtooth", freq: 200, to: 1600, glide: 0.1, dur: 1.1, peak: 0.24, attack: 0.002, filter: { type: "bandpass", freq: 2200, q: 1.6 }, vibrato: { rate: 33, depth: 0.12 } },
    { wave: "noise", dur: 1.2, peak: 0.22, attack: 0.002, filter: { type: "highpass", freq: 1400 } },
    ...fx.chord("strings", ["F5", "Gb5", "G5", "C6", "Db6"], 1.6, 0.55),
  ],
  grabFar: (v: number) => {
    const k = vol(v);
    return [fx.thud(60, 0.5, 0.4 * k), ...fx.crack(0, 0.2 * k), { wave: "sawtooth", freq: 420, to: 1200, glide: 0.2, dur: 0.8, peak: 0.1 * k, attack: 0.01, filter: { type: "bandpass", freq: 2000, q: 2 } }];
  },
  revive: [...fx.arp("vibes", ["F5", "A5", "C6", "F6"], 0.1, 0.8, 0.55), { inst: "pad", note: "F4", dur: 1.4, gain: 0.3 }],
  /** 누군가 영영 마네킹이 됐다 */
  dead: [{ inst: "bell", note: "F3", dur: 2.4, gain: 0.6 }, { inst: "choir", note: "F3", dur: 2, gain: 0.3 }, { inst: "choir", note: "Db4", at: 0.3, dur: 1.8, gain: 0.22 }],
  /** 📸 플래시 — 찰칵 + 충전음 */
  flash: [fx.click(3000, 0.2), { wave: "noise", dur: 0.08, peak: 0.12, attack: 0.001, filter: { type: "highpass", freq: 4000 } }, { wave: "sine", freq: 2000, to: 5200, glide: 0.8, at: 0.12, dur: 0.9, peak: 0.03, attack: 0.1 }],
  /** 플래시에 정체가 드러남 */
  reveal: [...fx.chord("strings", ["F4", "Gb4", "C5"], 1.0, 0.45), fx.thud(55, 0.4, 0.4)],
  /** 🎀 묶음 — 테이프 찍 */
  bound: [{ wave: "noise", dur: 0.45, peak: 0.12, attack: 0.01, filter: { type: "bandpass", freq: 2600, to: 4200, q: 1.2 } }, fx.thud(90, 0.2, 0.3, 0.4), { inst: "vibes", note: "C5", at: 0.45, dur: 0.6, gain: 0.4 }],
  /** 그냥 마네킹이었다 — 텅 빈 소리 */
  decoy: [fx.thud(220, 0.12, 0.2), fx.thud(200, 0.12, 0.16, 0.14), { inst: "glock", note: "F5", at: 0.3, dur: 0.3, gain: 0.2 }],
  /** 끈이 끊어짐 */
  unbound: (v: number) => [{ wave: "noise", dur: 0.12, peak: 0.1 * vol(v), attack: 0.002, filter: { type: "bandpass", freq: 1800, q: 1 } }, fx.click(600, 0.08 * vol(v), 0.05)],
  /** 와르르 쓰러짐 (arg = 크기) */
  topple: (v: number) => {
    const k = vol(v);
    return [fx.thud(120, 0.25, 0.4 * k), fx.thud(90, 0.2, 0.3 * k, 0.14), fx.thud(160, 0.15, 0.25 * k, 0.25), ...fx.crack(0.05, 0.25 * k), { wave: "noise", at: 0.05, dur: 0.4, peak: 0.08 * k, attack: 0.005, filter: { type: "bandpass", freq: 1200, q: 1 } }];
  },
  /** 다시 일어섬 (arg = 크기) */
  rise: (v: number) => [{ wave: "sawtooth", freq: 260, to: 520, glide: 0.5, dur: 0.6, peak: 0.07 * vol(v), attack: 0.05, filter: { type: "bandpass", freq: 1200, q: 6 } }, fx.click(800, 0.08 * vol(v), 0.55)],
  /** 노려보는 동안 응시가 차오름 (arg = 0~1) */
  stare: (v: number) => [{ wave: "sine", freq: 300 + vol(v) * 500, dur: 0.12, peak: 0.03, attack: 0.02 }],
  /** 매장 안내 차임 (마지막 1분) */
  lastMinute: [...fx.arp("vibes", ["A5", "F5", "C5", "F4"], 0.32, 1.2, 0.8), fx.buzz(120, 90, 0.8, 0.06, 1.4)],
  denied: [fx.buzz(180, 140, 0.1, 0.06)],
  ui: [fx.click(900, 0.05)],
  victory: [...fx.arp("harp", ["F4", "A4", "C5", "F5", "A5", "C6", "F6"], 0.1, 1.6, 0.6), ...fx.chord("strings", ["F4", "A4", "C5", "F5"], 3, 0.5, 0.5), { inst: "vibes", note: "F5", at: 0.7, dur: 2.5, gain: 0.4 }],
  defeat: [
    { inst: "choir", note: "F3", dur: 3, gain: 0.4 },
    { inst: "choir", note: "Gb3", at: 0.4, dur: 2.8, gain: 0.35 },
    { inst: "gong", note: "F2", dur: 3.5, gain: 0.6 },
    { wave: "sawtooth", freq: 55, to: 36, glide: 2.5, dur: 3, peak: 0.14, attack: 0.3, filter: { type: "lowpass", freq: 260 } },
  ],
} satisfies Record<string, SfxRecipe>;

export const MANNEQUIN_MALL_SUITE: SuiteConfig = {
  bpm: 72,
  tracks: [
    // 0: 늘어진 매장 음악 — 일렉 피아노 화음 + 비브라폰 선율 (마지막 음이 반음 처진다)
    { voice: "epiano", div: 8, pattern: "F3+A3+C4+E4 | D3+F3+A3+C4 | G3+Bb3+D4+F4 | C3+E3+G3+Bb3", gain: 0.12, maxLevel: 1 },
    { voice: "vibes", div: 2, pattern: "A5 . C6 . A5 . F5 . | G5 . . . E5 . . . | F5 . A5 . D6 . C6 . | Bb5 . . . A5 . Ab5 .", gain: 0.08, maxLevel: 1 },
    { voice: "upright", div: 4, pattern: "F2 . C3 . | D2 . A2 . | G2 . D3 . | C2 . G2 .", gain: 0.12, maxLevel: 1 },
    { voice: "brush", div: 2, pattern: "x . x . x . x .", gain: 0.035, maxLevel: 1 },
    { voice: "crackle", div: 4, pattern: ". . x . . . . . . x . . . . . . . . . . x . . .", gain: 0.05 },
    { voice: "pad", div: 16, pattern: "F2+C3 | D2+A2 | Bb1+F2 | C2+G2", gain: 0.12 },
    // 1: 근처에서 삐걱 — 반음 어긋난 합창, 낮은 북
    { voice: "choir", div: 16, pattern: "F4+Gb4 | F4+Gb4 | E4+F4 | F4+Gb4", gain: 0.1, level: 1 },
    { voice: "taiko", pattern: "x . . x . . . . . . . . . . . .", gain: 0.2, level: 1, maxLevel: 2 },
    // 2: 바로 앞 / 정전 — 팀파니 오스티나토 + 높은 현악 트레몰로
    { voice: "timpani", pattern: "F2 . F2 . F2 . F2 F2 F2 . F2 . F2 . Gb2 Gb2", gain: 0.3, level: 2 },
    { voice: "strings", pattern: "F6 F6 F6 F6 F6 F6 F6 F6 Gb6 Gb6 Gb6 Gb6 Gb6 Gb6 Gb6 Gb6 | F6 F6 F6 F6 F6 F6 F6 F6 E6 E6 E6 E6 E6 E6 E6 E6", gain: 0.07, level: 2 },
    { voice: "stab", div: 8, pattern: "F4+B4 . . Gb4+C5", gain: 0.1, level: 2 },
  ],
  sfx: SFX,
};

export const getMannequinMallSound = defineSuite(MANNEQUIN_MALL_SUITE);
