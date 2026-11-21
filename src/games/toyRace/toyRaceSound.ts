import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 장난감 방 레이스 "Toy Box Grand Prix" — G 장조 152 BPM 장난감 피아노 행진: 마림바 베이스 라인 위로
 * 글로켄·뮤직박스가 달리고 셰이커가 바퀴 소리를 낸다. 3단계 (ToyRaceBoard가 `setIntensity`):
 *   0 평소 · 1 🏁 마지막 바퀴 — 브라스 화음·오픈 하이햇 · 2 첫 사람이 들어온 뒤(15초 마감) — 스네어 롤·리드.
 *
 * 효과음은 스냅샷 이벤트와 내 차 이벤트(LocalDriver)마다 울린다. 소리로만 알리는 신호는 없다 —
 * 출발 신호·마지막 바퀴·추월·맞음·장난감 투하·기차 경고는 모두 화면 글자·아이콘·불빛으로도 나온다.
 */

const SFX = {
  /** 카운트다운 3·2·1 */
  tick: [{ inst: "bell", note: "G5", dur: 0.25, gain: 0.55 }],
  go: [...fx.chord("brass", ["G4", "B4", "D5", "G5"], 0.55, 0.6), fx.whoosh(500, 2600, 0.35, 0.1), { inst: "triangle", note: "G6", gain: 0.5 }],
  /** 🚀 출발 부스트 성공 */
  rocket: [fx.whoosh(300, 3200, 0.45, 0.14), ...fx.arp("glock", ["G5", "D6", "G6"], 0.05, 0.3, 0.55)],
  /** 시동 꺼짐 (푸드득) */
  stall: [fx.buzz(160, 70, 0.5, 0.12), { wave: "noise", dur: 0.25, peak: 0.06, filter: { type: "lowpass", freq: 600 } }],
  /** ⚡ 드리프트 부스트 1단·2단 */
  drift1: [fx.whoosh(700, 2400, 0.25, 0.1), { inst: "glock", note: "D6", gain: 0.35 }],
  drift2: [fx.whoosh(500, 3200, 0.4, 0.13), ...fx.arp("glock", ["D6", "G6", "B6"], 0.04, 0.3, 0.45)],
  /** 🌀 드리프트 단계가 올라감 (불꽃 색 바뀜) */
  driftTier: [{ inst: "musicbox", note: "B6", dur: 0.15, gain: 0.3 }],
  boost: [fx.whoosh(400, 2800, 0.5, 0.12), { wave: "sawtooth", freq: 180, to: 420, glide: 0.4, dur: 0.45, peak: 0.05, attack: 0.02, filter: { type: "lowpass", freq: 1400 } }],
  /** 울타리에 박음. arg = 세기 */
  wall: (p: number) => {
    const k = Math.min(1, p / 9);
    return [fx.thud(150 + k * 60, 0.15, 0.25 + k * 0.25), fx.click(2400, 0.06 + k * 0.06)];
  },
  bump: (p: number) => {
    const k = Math.min(1, p / 8);
    return [{ wave: "sine", freq: 260 + k * 80, to: 120, glide: 0.1, dur: 0.12, peak: 0.12 + k * 0.14, attack: 0.002 }, fx.click(1600, 0.05)];
  },
  jump: [{ wave: "sine", freq: 220, to: 900, glide: 0.3, dur: 0.32, peak: 0.12, attack: 0.004 }],
  land: [fx.thud(140, 0.14, 0.3)],
  perfect: [...fx.arp("vibes", ["G5", "B5", "D6"], 0.05, 0.35, 0.5), fx.whoosh(800, 2600, 0.25, 0.08)],
  /** 🎁 상자 깨짐 + 룰렛 */
  box: [fx.pop(500, 1300, 0.2), ...fx.arp("musicbox", ["C6", "E6", "G6", "C7", "E6", "G6"], 0.11, 0.18, 0.35)],
  itemReady: [{ inst: "bell", note: "D6", dur: 0.3, gain: 0.45 }],
  battery: [fx.whoosh(300, 2400, 0.4, 0.12), { inst: "chip", note: "G5", at: 0.05, dur: 0.12, gain: 0.25 }, { inst: "chip", note: "D6", at: 0.12, dur: 0.18, gain: 0.25 }],
  bubble: [{ wave: "sine", freq: 400, to: 1100, glide: 0.25, dur: 0.3, peak: 0.1, attack: 0.01 }, ...fx.arp("vibes", ["B5", "E6"], 0.06, 0.3, 0.35)],
  yarn: [fx.whoosh(900, 400, 0.3, 0.1), { inst: "pluck", note: "E5", dur: 0.2, gain: 0.35 }],
  duck: [{ wave: "square", freq: 700, to: 520, glide: 0.12, dur: 0.14, peak: 0.07, attack: 0.002, filter: { type: "bandpass", freq: 1200, q: 3 } }, { wave: "square", freq: 760, to: 560, glide: 0.12, at: 0.16, dur: 0.14, peak: 0.07, attack: 0.002, filter: { type: "bandpass", freq: 1200, q: 3 } }],
  yoyo: [{ wave: "sine", freq: 300, to: 1200, glide: 0.5, dur: 0.55, peak: 0.1, attack: 0.01 }, fx.whoosh(600, 2200, 0.5, 0.06)],
  top: [...fx.arp("glock", ["G5", "A5", "B5", "D6", "E6", "G6"], 0.04, 0.25, 0.4), fx.whoosh(400, 2000, 0.6, 0.08)],
  /** 빙글 (내가 맞음) */
  spun: [{ wave: "sine", freq: 900, to: 200, glide: 0.8, dur: 0.85, peak: 0.12, attack: 0.005 }, fx.thud(180, 0.12, 0.3)],
  /** 남이 맞음 (내 아이템이면 arg 1) */
  hitOther: (mine: number) => (mine ? [...fx.arp("marimba", ["G5", "D6", "G6"], 0.05, 0.25, 0.5), fx.pop(400, 900, 0.14)] : [fx.pop(300, 600, 0.12)]),
  /** 🫧 방패가 막고 터짐 */
  block: [{ wave: "noise", dur: 0.12, peak: 0.1, filter: { type: "highpass", freq: 3000 } }, fx.pop(900, 300, 0.16)],
  /** 🧸 꼴찌의 장난감을 받음 */
  toyGet: [...fx.arp("musicbox", ["G5", "B5", "D6", "G6"], 0.07, 0.35, 0.5)],
  /** 장난감 투하 (휘이— 떨어지는 소리) */
  toyDrop: [{ wave: "sine", freq: 1800, to: 300, glide: 1.3, dur: 1.35, peak: 0.07, attack: 0.02 }],
  toyLand: [fx.thud(110, 0.3, 0.5), fx.click(900, 0.1, 0.02)],
  toyBreak: [{ inst: "woodblock", note: "C5", dur: 0.08, gain: 0.5 }, { inst: "woodblock", note: "G4", at: 0.07, dur: 0.08, gain: 0.45 }, { inst: "woodblock", note: "E5", at: 0.13, dur: 0.08, gain: 0.4 }, { inst: "woodblock", note: "A4", at: 0.2, dur: 0.08, gain: 0.35 }],
  /** 장난감 벽에 박음 */
  crash: [fx.thud(120, 0.25, 0.55), ...fx.arp("woodblock", ["C5", "G4", "E4"], 0.06, 0.08, 0.4)],
  /** 🚂 기차 건널목 경고 (땡땡) · 지나감 (칙칙폭폭) */
  trainWarn: [{ inst: "bell", note: "E6", dur: 0.25, gain: 0.35 }, { inst: "bell", note: "E6", at: 0.4, dur: 0.25, gain: 0.35 }],
  train: [{ inst: "whistle", note: "A5", dur: 0.6, gain: 0.35 }, { inst: "whistle", note: "C#6", dur: 0.6, gain: 0.25 }, { wave: "noise", at: 0.2, dur: 0.12, peak: 0.06, filter: { type: "bandpass", freq: 900, q: 1.5 } }, { wave: "noise", at: 0.45, dur: 0.12, peak: 0.06, filter: { type: "bandpass", freq: 900, q: 1.5 } }],
  /** 내가 추월함 / 추월당함 */
  pass: [fx.whoosh(600, 1800, 0.22, 0.08), { inst: "glock", note: "B5", at: 0.05, dur: 0.15, gain: 0.3 }],
  passed: [{ inst: "glock", note: "E5", dur: 0.15, gain: 0.25 }, { inst: "glock", note: "C5", at: 0.1, dur: 0.2, gain: 0.22 }],
  lap: [...fx.arp("marimba", ["G5", "B5", "D6"], 0.06, 0.3, 0.5)],
  bestLap: [...fx.arp("vibes", ["G5", "B5", "D6", "G6"], 0.06, 0.4, 0.5)],
  finalLap: [...fx.arp("brass", ["D5", "G5", "B5", "D6"], 0.08, 0.4, 0.6), { inst: "timpani", note: "G2", gain: 0.5 }],
  finish: [...fx.chord("brass", ["G4", "B4", "D5", "G5"], 0.8, 0.55), ...fx.arp("glock", ["G6", "D6", "B5", "G6"], 0.08, 0.3, 0.4)],
  wrongWay: [fx.buzz(240, 200, 0.3, 0.07)],
  reset: [{ inst: "musicbox", note: "D6", dur: 0.2, gain: 0.35 }, { inst: "musicbox", note: "G5", at: 0.1, dur: 0.3, gain: 0.3 }],
  denied: [{ wave: "square", freq: 180, to: 150, glide: 0.06, dur: 0.07, peak: 0.04, attack: 0.002, filter: { type: "lowpass", freq: 900 } }],
  /** 마지막 10초(들어오기 마감) 똑딱 */
  clock: (n: number) => [{ inst: "woodblock", note: n <= 3 ? "A5" : "D5", dur: 0.08, gain: 0.5 }],
  victory: [...fx.arp("brass", ["G4", "B4", "D5", "G5", "B5"], 0.09, 0.5), ...fx.chord("strings", ["G4", "B4", "D5", "G5"], 2, 0.7, 0.45), { inst: "triangle", note: "G6", at: 0.45, gain: 0.6 }],
  defeat: [{ inst: "marimba", note: "D5", dur: 0.3, gain: 0.5 }, { inst: "marimba", note: "B4", at: 0.25, dur: 0.3, gain: 0.5 }, { inst: "marimba", note: "G4", at: 0.5, dur: 0.7, gain: 0.5 }],
  ui: [fx.click(1200, 0.06)],
} satisfies Record<string, SfxRecipe>;

export const TOY_RACE_SUITE: SuiteConfig = {
  bpm: 152,
  swing: 0.04,
  tracks: [
    { voice: "softKick", pattern: "x . . . x . . . x . . . x . . .", gain: 0.42 },
    { voice: "rim", pattern: ". . . . x . . . . . . . x . . .", gain: 0.16 },
    { voice: "snare", div: 2, pattern: ". . . . . . . . . . . . . . . . . . . . . . . . x x x x x x x x", gain: 0.12, level: 2 },
    { voice: "shaker", pattern: "x x x x x x x x x x x x x x x x", gain: 0.07 },
    { voice: "openHat", pattern: ". . . . . . . x . . . . . . . x", gain: 0.1, level: 1 },
    { voice: "marimba", pattern: "G2 . G3 . D3 . G3 . | C3 . C4 . G3 . C4 . | D3 . D4 . A3 . D4 . | G2 . G3 . D3 . B2 .", gain: 0.3 },
    { voice: "musicbox", pattern: ". . B4+D5 . . . B4+D5 . | . . C5+E5 . . . C5+E5 . | . . D5+F#5 . . . C5+F#5 . | . . B4+D5 . . . B4+D5 .", gain: 0.1 },
    { voice: "glock", div: 2, pattern: "G5 - B5 D6 G6 - D6 B5 | C6 - E6 - G6 - E6 C6 | D6 - F#6 - A6 - F#6 D6 | B5 - G5 - D5 - . .", gain: 0.12, maxLevel: 2 },
    // 1단계: 마지막 바퀴 — 브라스
    { voice: "brass", div: 2, pattern: "G4+D5 - - - - - - - | C5+G5 - - - - - - - | D5+A5 - - - - - - - | G4+B4 - - - - - - -", gain: 0.06, level: 1 },
    // 2단계: 들어오기 마감 — 리드
    { voice: "lead", div: 2, pattern: "G6 - B6 - D7 - B6 G6 | E6 - G6 - C7 - - - | F#6 - A6 - D7 - A6 F#6 | G6 - - - D6 - - -", gain: 0.05, level: 2 },
  ],
  sfx: SFX,
};

export const getToyRaceSound = defineSuite(TOY_RACE_SUITE);
