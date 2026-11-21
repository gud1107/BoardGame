import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 택배 대란 "Conveyor Funk" — G 단조 116 BPM 물류 창고 펑크: 컨베이어처럼 끊이지 않는 16분 하이햇·
 * 슬랩 느낌 업라이트 베이스·일렉 피아노 컴핑 위로 마림바가 "삑— 삑—" 바코드 리듬을 친다.
 * 근무 상황에 따라 3단계로 두꺼워진다 (ParcelPanicBoard가 `setIntensity`):
 *   0 평소 · 1 🚨 돌발 사건 중이거나 컨베이어에 상자가 6개 넘게 밀림 — 브라스 스탭·클랩 ·
 *   2 마지막 20초 — 오픈 하이햇·리드 멜로디·스네어 필.
 *
 * 효과음은 스냅샷 이벤트(sim.ts `GameEvent`)마다 보드가 울린다. 싣기 소리는 연속으로 실을수록 음이 올라간다.
 * 소리로만 알리는 신호는 없다 — 트럭 출발·사건·놓침·깨짐 모두 화면 글자·아이콘과 같이 나온다(접근성).
 */

const LOAD_NOTES = ["G5", "A5", "Bb5", "C6", "D6", "F6", "G6", "A6", "Bb6", "D7"];

const SFX = {
  /** 상자 집기 (툭) */
  grab: [fx.pop(320, 700, 0.08), fx.click(1800, 0.03, 0.01)],
  /** 🛋️ 가구에 붙기 (영차!) */
  join: [fx.thud(160, 0.18, 0.35), ...fx.arp("marimba", ["G4", "D5"], 0.08, 0.2, 0.55)],
  /** 내려놓기 */
  put: [fx.thud(220, 0.08, 0.25)],
  /** 트럭에 싣기. arg = 연속 싣기 횟수 — 이어 실을수록 높게 */
  load: (n: number) => {
    const note = LOAD_NOTES[Math.min(LOAD_NOTES.length - 1, Math.max(0, n - 1))];
    return [fx.thud(180, 0.1, 0.3), { inst: "bell", note, at: 0.03, dur: 0.3, gain: 0.42 }, fx.click(2600, 0.04, 0.03)];
  },
  /** 🎯 던져 넣기 성공 (슛!) */
  shot: [fx.whoosh(600, 2400, 0.18, 0.08), ...fx.arp("vibes", ["D6", "G6", "Bb6"], 0.05, 0.3, 0.55), { inst: "triangle", note: "D7", at: 0.15, gain: 0.35 }],
  /** 던지기 (휙) */
  throw: [fx.whoosh(400, 1800, 0.2, 0.09)],
  /** 받기 */
  catch: [fx.pop(500, 1100, 0.08), { inst: "marimba", note: "D6", at: 0.03, dur: 0.15, gain: 0.4 }],
  /** ⚔️ 남의 상자를 가로챔 */
  steal: [fx.whoosh(700, 2600, 0.16, 0.08), ...fx.arp("marimba", ["G5", "Bb5", "D6"], 0.04, 0.2, 0.55)],
  /** 착지 (바닥에 퍽) */
  land: [fx.thud(200, 0.1, 0.22)],
  /** 🥚 깨짐 (와장창) */
  break: [{ wave: "noise", dur: 0.35, peak: 0.16, attack: 0.002, filter: { type: "highpass", freq: 2400 } }, fx.click(5200, 0.05), fx.click(3800, 0.05, 0.05), fx.click(4600, 0.04, 0.1), { inst: "brass", note: "D4", at: 0.12, dur: 0.3, gain: 0.35 }],
  /** 🧊 녹음 (주르륵) */
  melt: [{ wave: "sine", freq: 900, to: 260, glide: 0.6, dur: 0.6, peak: 0.08, attack: 0.02 }, { inst: "marimba", note: "D5", at: 0.3, dur: 0.3, gain: 0.25 }],
  /** 컨베이어 끝 반송 (삐— 뚜) */
  miss: [{ wave: "square", freq: 660, dur: 0.14, peak: 0.05, attack: 0.002, filter: { type: "lowpass", freq: 2200 } }, { wave: "square", freq: 440, at: 0.16, dur: 0.22, peak: 0.05, attack: 0.002, filter: { type: "lowpass", freq: 2200 } }],
  /** 🔍 스캔 (삑) */
  scan: [{ wave: "square", freq: 1980, dur: 0.07, peak: 0.06, attack: 0.002, filter: { type: "lowpass", freq: 5000 } }, { wave: "square", freq: 2640, at: 0.08, dur: 0.1, peak: 0.06, attack: 0.002, filter: { type: "lowpass", freq: 5000 } }],
  /** 실을 수 없음 (다른 트럭·라벨 없음·트럭 없음) */
  blocked: [{ wave: "square", freq: 210, to: 170, glide: 0.08, dur: 0.1, peak: 0.05, attack: 0.002, filter: { type: "lowpass", freq: 900 } }, { wave: "square", freq: 210, to: 170, glide: 0.08, at: 0.12, dur: 0.1, peak: 0.05, attack: 0.002, filter: { type: "lowpass", freq: 900 } }],
  /** 🚚 트럭 출발 (빵빵 + 부릉). arg = 가득이면 1 */
  truckGo: (full: number) =>
    full
      ? [{ wave: "square", freq: 392, dur: 0.12, peak: 0.07, attack: 0.003, filter: { type: "lowpass", freq: 1800 } }, { wave: "square", freq: 392, at: 0.18, dur: 0.18, peak: 0.07, attack: 0.003, filter: { type: "lowpass", freq: 1800 } }, ...fx.chord("brass", ["G4", "Bb4", "D5", "G5"], 0.6, 0.55, 0.3), fx.buzz(70, 120, 0.6, 0.05, 0.3)]
      : [fx.buzz(60, 110, 0.6, 0.06), { wave: "square", freq: 349, at: 0.1, dur: 0.15, peak: 0.05, attack: 0.003, filter: { type: "lowpass", freq: 1500 } }],
  /** 트럭 도착 (치익 — 후진 삐삐) */
  truckBack: [{ wave: "noise", dur: 0.25, peak: 0.05, attack: 0.01, filter: { type: "bandpass", freq: 1800 } }, { wave: "square", freq: 1050, at: 0.3, dur: 0.08, peak: 0.035, attack: 0.002 }, { wave: "square", freq: 1050, at: 0.5, dur: 0.08, peak: 0.035, attack: 0.002 }],
  /** 🚨 돌발 사건 (사이렌 한 번) */
  incident: [{ wave: "sawtooth", freq: 620, to: 920, glide: 0.25, dur: 0.25, peak: 0.05, attack: 0.01, filter: { type: "lowpass", freq: 2500 } }, { wave: "sawtooth", freq: 920, to: 620, glide: 0.25, at: 0.25, dur: 0.25, peak: 0.05, attack: 0.005, filter: { type: "lowpass", freq: 2500 } }],
  /** 🔌 정전 (뚝 — 우웅) */
  blackout: [fx.thud(90, 0.3, 0.5), { wave: "sine", freq: 220, to: 50, glide: 0.8, dur: 0.8, peak: 0.1, attack: 0.002 }],
  /** 🚜 지게차 경적 */
  forkHorn: [{ wave: "square", freq: 330, dur: 0.25, peak: 0.07, attack: 0.005, filter: { type: "lowpass", freq: 1400 } }, { wave: "square", freq: 415, dur: 0.25, peak: 0.05, attack: 0.005, filter: { type: "lowpass", freq: 1400 } }],
  /** 🚜 지게차에 부딪힘 / ⚔️ 들이받힘 */
  hit: [fx.thud(150, 0.2, 0.45), { wave: "triangle", freq: 440, to: 180, glide: 0.15, dur: 0.18, peak: 0.12, attack: 0.002 }],
  dash: [fx.whoosh(500, 2400, 0.18, 0.11)],
  bump: (p: number) => {
    const k = Math.min(1, p / 8);
    return [{ wave: "sine", freq: 220 + k * 80, to: 110, glide: 0.1, dur: 0.12, peak: 0.1 + k * 0.12, attack: 0.002 }];
  },
  /** ★ 별 하나 더 */
  star: [...fx.arp("harp", ["G5", "Bb5", "D6", "G6", "Bb6"], 0.05, 0.6, 0.5), ...fx.coin(0.25, 2600, 0.12), { inst: "triangle", note: "G7", at: 0.35, gain: 0.4 }],
  /** 상자 나옴 (컨베이어 입구 덜컥) — 아주 작게 */
  spawn: [fx.click(900, 0.03)],
  ready: [{ inst: "glock", note: "G6", dur: 0.16, gain: 0.22 }],
  denied: [{ wave: "square", freq: 180, to: 150, glide: 0.06, dur: 0.07, peak: 0.04, attack: 0.002, filter: { type: "lowpass", freq: 900 } }],
  tick: [{ inst: "bell", note: "G5", dur: 0.25, gain: 0.55 }],
  clock: (n: number) => [{ inst: "woodblock", note: n <= 5 ? "D6" : "G5", dur: 0.08, gain: 0.5 }],
  go: [...fx.chord("brass", ["G4", "Bb4", "D5", "G5"], 0.6, 0.65), { inst: "clap", note: "C4", gain: 0.5 }, { wave: "square", freq: 1320, at: 0.05, dur: 0.12, peak: 0.04, attack: 0.002 }],
  victory: [...fx.arp("brass", ["G4", "Bb4", "D5", "G5", "Bb5"], 0.09, 0.5), ...fx.chord("strings", ["G4", "Bb4", "D5", "G5"], 2, 0.7, 0.45), { inst: "triangle", note: "D7", at: 0.45, gain: 0.6 }],
  defeat: [{ inst: "brass", note: "D5", dur: 0.4, gain: 0.5 }, { inst: "brass", note: "Bb4", at: 0.3, dur: 0.4, gain: 0.5 }, { inst: "brass", note: "G4", at: 0.6, dur: 0.9, gain: 0.5 }],
  ui: [fx.click(1200, 0.06)],
} satisfies Record<string, SfxRecipe>;

export const PARCEL_PANIC_SUITE: SuiteConfig = {
  bpm: 116,
  swing: 0.08,
  tracks: [
    { voice: "softKick", pattern: "x . . . x . . x . . x . x . . .", gain: 0.42 },
    { voice: "snare", pattern: ". . . . x . . . . . . . x . . .", gain: 0.14 },
    { voice: "clap", pattern: ". . . . x . . . . . . . x . x .", gain: 0.12, level: 1 },
    { voice: "snare", div: 2, pattern: ". . . . . . . . . . . . . . . . . . . . . . . . x . x . x x x x", gain: 0.1, level: 2 },
    { voice: "hat", pattern: "x x x x x x x x x x x x x x x x", gain: 0.05 },
    { voice: "openHat", pattern: ". . x . . . x . . . x . . . x .", gain: 0.07, level: 2 },
    { voice: "upright", pattern: "G2 . . G2 Bb2 . G2 . | Eb2 . . Eb2 G2 . Bb2 . | F2 . . F2 A2 . C3 . | D2 . . D2 F#2 . A2 .", gain: 0.34 },
    { voice: "epiano", pattern: ". . G3+Bb3+D4 . . . G3+Bb3+D4 . | . . Eb3+G3+Bb3 . . . Eb3+G3+Bb3 . | . . F3+A3+C4 . . . F3+A3+C4 . | . . D3+F#3+A3 . . . D3+F#3+A3 .", gain: 0.1 },
    { voice: "marimba", pattern: "D6 . D6 . . . G5 . | Eb6 . Eb6 . . . Bb5 . | F6 . F6 . . . C6 . | F#6 . D6 . . . A5 .", gain: 0.08, maxLevel: 1 },
    // 1단계: 🚨 돌발 사건 · 컨베이어 밀림 — 브라스 스탭
    { voice: "stab", pattern: "G4+Bb4+D5 . . . . . . . . . . . . . . . | Eb4+G4+Bb4 . . . . . . . . . . . . . . . | F4+A4+C5 . . . . . . . . . . . . . . . | D4+F#4+A4 . . . . . . . . . . D4+F#4+A4 . . .", gain: 0.07, level: 1 },
    { voice: "glock", pattern: ". . . . . . . . . . D7 . . . D7 . ", gain: 0.05, level: 1 },
    // 2단계: 마지막 20초 — 리드 멜로디
    { voice: "lead", div: 2, pattern: "G6 - Bb6 - D7 - Bb6 G6 | Eb6 - G6 - Bb6 - G6 - | F6 - A6 - C7 - A6 F6 | F#6 - A6 - D7 - - -", gain: 0.05, level: 2 },
  ],
  sfx: SFX,
};

export const getParcelPanicSound = defineSuite(PARCEL_PANIC_SUITE);
