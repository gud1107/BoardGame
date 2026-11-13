import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 살얼음 파티 "Frost Polka" — A 장조 152 BPM 깡충거리는 폴카: 움파 베이스·글로켄 멜로디 위로
 * 썰매 방울(셰이커)이 달린다. 판 상황에 따라 3단계로 두꺼워진다 (ThinIceBoard가 `setIntensity`):
 *   0 평소 — 폴카 · 1 해빙 경보 중이거나 최후의 2인 — 현악 화음·오픈 하이햇·빠른 셰이커 ·
 *   2 서든데스 — 탐 필인·하프시코드 16분 리프·리드 멜로디(현악은 더 높게).
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
  /** 점프. arg = 크기 0~1 (0이면 내 것 = 1, 멀리 있는 남의 것은 작게) */
  jump: (v: number) => {
    const k = v > 0 && v <= 1 ? v : 1;
    return [{ wave: "sine", freq: 380, to: 900, glide: 0.18, dur: 0.2, peak: 0.12 * k, attack: 0.004 }, fx.whoosh(900, 1800, 0.18, 0.05 * k)];
  },
  /** 착지 (얼음에 톡). arg = 크기 0~1 */
  land: (v: number) => {
    const k = v > 0 && v <= 1 ? v : 1;
    return [fx.thud(150, 0.12, 0.2 * k), { wave: "noise", dur: 0.06, peak: 0.05 * k, filter: { type: "highpass", freq: 3000 } }];
  },
  /** 얼음 위 발소리 — 스케이트 날이 긁히는 소리. arg = 발 번갈아(짝수/홀수) */
  step: (n: number) => {
    const alt = Math.round(n) % 2 === 0;
    return [
      { wave: "noise", dur: 0.09, peak: 0.035, attack: 0.008, filter: { type: "bandpass", freq: alt ? 4200 : 3600, to: alt ? 2600 : 2200, q: 1.4 } },
      fx.click(alt ? 1500 : 1300, 0.03),
    ];
  },
  /** 금 2단계 얼음 위에서 계속 나는 삐걱임 (경고) */
  creak: [
    { wave: "sawtooth", freq: 140, to: 95, glide: 0.25, dur: 0.28, peak: 0.05, attack: 0.03, filter: { type: "bandpass", freq: 700, q: 3 } },
    { wave: "noise", dur: 0.08, peak: 0.04, at: 0.12, filter: { type: "highpass", freq: 3500 } },
  ],
  /** 내려찍기에 밀쳐짐 — "윽" + 미끄러지는 바람 */
  knocked: [fx.thud(200, 0.15, 0.3), { wave: "triangle", freq: 520, to: 260, glide: 0.18, dur: 0.2, peak: 0.1, attack: 0.003 }, fx.whoosh(1600, 500, 0.4, 0.09, 0.05)],
  /** 해빙 3·2·1 (arg = 남은 초 — 줄수록 높게) */
  thawTick: (n: number) => [{ inst: "glock", note: n >= 3 ? "E5" : n === 2 ? "G#5" : "B5", dur: 0.18, gain: 0.45 }, fx.click(2600, 0.05)],
  /** 내려찍기 다시 쓸 수 있음 */
  ready: [{ inst: "glock", note: "A6", dur: 0.2, gain: 0.3 }, { inst: "glock", note: "E7", at: 0.06, dur: 0.25, gain: 0.25 }],
  /** 재사용 대기 중에 누름 */
  denied: [{ wave: "square", freq: 180, to: 150, glide: 0.06, dur: 0.07, peak: 0.04, attack: 0.002, filter: { type: "lowpass", freq: 900 } }],
  /** 내가 유령이 됨 */
  ghost: [{ wave: "sine", freq: 520, to: 780, glide: 0.8, dur: 0.9, peak: 0.07, attack: 0.2, vibrato: { rate: 6, depth: 0.02 } }, ...fx.arp("vibes", ["A5", "E6", "A6"], 0.12, 0.6, 0.35)],
  /** 물에 가라앉는 보글보글 */
  bubbles: [0, 0.12, 0.27, 0.45].map((at, i) => ({ wave: "sine" as const, freq: 300 + i * 90, to: 700 + i * 120, glide: 0.06, dur: 0.07, peak: 0.06, at, attack: 0.002 })),
  /** 아이템이 아무도 안 주워 사라짐 */
  expire: [{ wave: "noise", dur: 0.35, peak: 0.05, attack: 0.02, filter: { type: "highpass", freq: 5000, to: 2500 } }, { inst: "glock", note: "E5", at: 0.05, dur: 0.15, gain: 0.15 }],
  /** 라운드 시작 (카운트다운 전) */
  roundStart: [fx.whoosh(400, 2400, 0.5, 0.08), ...fx.arp("pizz", ["A3", "E4", "A4"], 0.08, 0.3, 0.6)],
  /** 최후의 2인 */
  finalTwo: [...fx.chord("brass", ["A3", "E4", "A4"], 0.5, 0.55), { inst: "timpani", note: "A2", at: 0.05, dur: 0.6, gain: 0.5 }, { inst: "brass", note: "C5", at: 0.45, dur: 0.5, gain: 0.45 }],
  /** 메뉴·버튼 */
  ui: [fx.click(1200, 0.06)],
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
    { voice: "kick", pattern: ". . . . . . . . . . . . . . x .", gain: 0.3, level: 2 },
    { voice: "rim", pattern: ". . x . . . x . . . x . . . x .", gain: 0.2 },
    { voice: "shaker", pattern: "x x x x x x x x x x x x x x x x", gain: 0.1, maxLevel: 1 },
    { voice: "shaker", div: 2, pattern: "x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x", gain: 0.08, level: 1 },
    { voice: "openHat", pattern: ". . . . . . . x . . . . . . . x", gain: 0.12, level: 1 },
    { voice: "upright", pattern: "A2 . . . E2 . . . A2 . . . E2 . . . | D2 . . . A1 . . . E2 . . . B1 . . .", gain: 0.36 },
    { voice: "pizz", pattern: ". . A3+C#4+E4 . . . A3+C#4+E4 . . . A3+C#4+E4 . . . A3+C#4+E4 . | . . D4+F#4+A4 . . . D4+F#4+A4 . . . E4+G#4+B4 . . . E4+G#4+B4 .", gain: 0.16 },
    { voice: "glock", div: 2, pattern: "E5 C#5 E5 A5 - . G#5 F#5 | E5 - C#5 . D5 E5 F#5 . | A5 - F#5 . D5 - B4 . | G#4 B4 E5 . E5 - . .", gain: 0.13, maxLevel: 2 },
    // 1단계: 해빙 경보·최후의 2인 — 현악 화음이 깔린다
    { voice: "strings", div: 2, pattern: "A4+E5 - - - - - - - | F#4+D5 - - - - - - - | D4+A4 - - - - - - - | E4+B4 - - - - - - -", gain: 0.08, level: 1, maxLevel: 2 },
    // 2단계: 서든데스 — 높은 현악, 하프시코드 16분 리프, 리드, 탐 필인
    { voice: "strings", div: 2, pattern: "A5+E6 - - - - - - - | F#5+D6 - - - - - - - | D5+A5 - - - - - - - | E5+B5 - - - - - - -", gain: 0.07, level: 2 },
    { voice: "harpsichord", pattern: "A4 C#5 E5 C#5 A4 C#5 E5 C#5 A4 C#5 E5 C#5 A4 C#5 E5 C#5 | D5 F#5 A5 F#5 D5 F#5 A5 F#5 E5 G#5 B5 G#5 E5 G#5 B5 G#5", gain: 0.07, level: 2 },
    { voice: "lead", div: 2, pattern: "A5 - C#6 - E6 - C#6 A5 | F#5 - - - D6 - - - | A5 - F#5 - D5 - F#5 A5 | G#5 - B5 - E6 - - -", gain: 0.06, level: 2 },
    { voice: "tom", pattern: ". . . . . . . . . . . . x . x x", gain: 0.22, level: 2 },
  ],
  sfx: SFX,
};

export const getThinIceSound = defineSuite(THIN_ICE_SUITE);
