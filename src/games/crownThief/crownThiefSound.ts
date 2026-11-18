import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 왕관 도둑 "Royal Scramble" — D 장조 144 BPM 장난스러운 궁정 행진곡: 피치카토 베이스·하프시코드 위로
 * 글로켄이 왕궁 나팔 가락을 흉내 낸다. 판 상황에 따라 3단계로 두꺼워진다 (CrownThiefBoard가 `setIntensity`):
 *   0 평소 — 행진 · 1 ✨ 황금 왕관(마지막 20초) — 금관 화음·오픈 하이햇·팀파니 ·
 *   2 마지막 10초 — 스네어 롤·리드 멜로디·더 빠른 셰이커.
 *
 * 효과음은 스냅샷 이벤트(sim.ts `GameEvent`)마다 CrownThiefBoard가 울린다.
 * 소리로만 알리는 신호는 없다 — 왕관 이동·무적·복수 금지·황금 구간 모두 화면 글자·아이콘과 같이 나온다(접근성).
 */

const SFX = {
  /** 왕관을 뺏음 (내가 새 왕) */
  steal: [...fx.arp("brass", ["D5", "F#5", "A5", "D6"], 0.05, 0.35, 0.7), fx.whoosh(600, 2400, 0.25, 0.08), { inst: "triangle", note: "C6", at: 0.18, gain: 0.5 }],
  /** 남이 왕관을 뺏음 (멀리서 들리는 짧은 팡파르) */
  stealOther: [...fx.arp("glock", ["A5", "D6"], 0.06, 0.25, 0.45), fx.pop(500, 1100, 0.12)],
  /** 내 왕관을 뺏김 */
  lost: [{ inst: "brass", note: "A4", dur: 0.18, gain: 0.5 }, { inst: "brass", note: "F4", at: 0.14, dur: 0.4, gain: 0.5 }, fx.buzz(300, 140, 0.35, 0.08, 0.05)],
  /** 저주를 떠안음 */
  cursed: [fx.buzz(220, 90, 0.6, 0.12), { inst: "choir", note: "D3", dur: 0.8, gain: 0.35 }, { wave: "sine", freq: 180, to: 120, glide: 0.5, dur: 0.6, peak: 0.08, attack: 0.05 }],
  /** 저주를 떠넘김 (홀가분) */
  passed: [...fx.arp("marimba", ["D5", "A5", "D6"], 0.05, 0.3, 0.6), fx.whoosh(800, 2600, 0.25, 0.06)],
  /** 바닥 왕관 줍기 */
  pickup: [...fx.coin(0, 2200, 0.14), ...fx.arp("glock", ["D6", "A6"], 0.05, 0.3, 0.5)],
  /** 왕관이 바닥에 떨어짐 (쨍그랑) */
  drop: [{ inst: "bell", note: "A5", dur: 0.4, gain: 0.45 }, { inst: "bell", note: "E5", at: 0.09, dur: 0.4, gain: 0.35 }, fx.click(3200, 0.08, 0.02), fx.thud(220, 0.12, 0.18, 0.02)],
  /** 첫 왕관이 하늘에서 떨어져 꽂힘 */
  crownLand: [fx.whoosh(2400, 400, 0.5, 0.1), fx.thud(120, 0.3, 0.4, 0.45), { inst: "bell", note: "D6", at: 0.45, dur: 0.8, gain: 0.5 }],
  dash: [fx.whoosh(500, 2600, 0.2, 0.12), { wave: "noise", dur: 0.12, peak: 0.05, filter: { type: "highpass", freq: 2500 } }],
  /** 돌진에 박힘. arg = 1이면 내가 박음 */
  dashHit: [fx.thud(180, 0.15, 0.4), { wave: "triangle", freq: 420, to: 200, glide: 0.12, dur: 0.15, peak: 0.12, attack: 0.002 }],
  /** 왕의 호령 */
  roar: [{ inst: "brass", note: "D3", dur: 0.6, gain: 0.7 }, { inst: "brass", note: "A3", dur: 0.6, gain: 0.6 }, { inst: "timpani", note: "D2", dur: 0.8, gain: 0.7 }, fx.whoosh(300, 1500, 0.5, 0.12, 0.05)],
  /** 저주의 손길 */
  snare: [{ inst: "choir", note: "A3", dur: 0.7, gain: 0.4 }, { wave: "sawtooth", freq: 300, to: 110, glide: 0.5, dur: 0.55, peak: 0.07, attack: 0.02, filter: { type: "lowpass", freq: 900 } }],
  /** 몸끼리 부딪힘. arg = 속도 */
  bump: (p: number) => {
    const k = Math.min(1, p / 8);
    return [{ wave: "sine", freq: 220 + k * 80, to: 110, glide: 0.1, dur: 0.12, peak: 0.14 + k * 0.16, attack: 0.002 }];
  },
  /** 광장 밖으로 떨어짐 (휘이이—) */
  fall: [{ wave: "sine", freq: 900, to: 160, glide: 0.9, dur: 0.95, peak: 0.12, attack: 0.01 }, fx.whoosh(1800, 300, 0.9, 0.07)],
  /** 다시 나타남 */
  respawn: [...fx.arp("vibes", ["D5", "A5", "D6"], 0.06, 0.4, 0.45), fx.pop(300, 900, 0.1)],
  /** 점프대 */
  pad: [{ wave: "sine", freq: 240, to: 1200, glide: 0.35, dur: 0.38, peak: 0.13, attack: 0.004 }, fx.whoosh(700, 2800, 0.4, 0.07)],
  land: [fx.thud(160, 0.12, 0.25), { wave: "noise", dur: 0.06, peak: 0.04, filter: { type: "lowpass", freq: 1500 } }],
  spawn: [fx.pop(700, 1400, 0.14), ...fx.arp("glock", ["D6", "A6"], 0.07, 0.3, 0.4)],
  banana: [fx.pop(300, 700, 0.18), { inst: "marimba", note: "G4", at: 0.05, dur: 0.2, gain: 0.4 }],
  magnet: [{ wave: "sawtooth", freq: 120, to: 240, glide: 0.4, dur: 0.45, peak: 0.06, attack: 0.02, filter: { type: "bandpass", freq: 800, q: 2 } }, ...fx.arp("glock", ["A5", "E6"], 0.08, 0.3, 0.4)],
  fake: [...fx.arp("harp", ["D5", "F5", "A5", "C6"], 0.05, 0.5, 0.45), { inst: "musicbox", note: "F6", at: 0.2, dur: 0.4, gain: 0.35 }],
  expire: [{ wave: "noise", dur: 0.3, peak: 0.05, attack: 0.02, filter: { type: "highpass", freq: 5000, to: 2500 } }],
  /** 바나나에 미끄러짐 (삐용—) */
  slip: [{ wave: "sine", freq: 300, to: 1500, glide: 0.25, dur: 0.3, peak: 0.12, attack: 0.003 }, { wave: "sine", freq: 1500, to: 200, glide: 0.4, at: 0.28, dur: 0.45, peak: 0.1, attack: 0.003 }],
  /** 새 왕 무적이 끝남 (이제 뺏을 수 있음) */
  invulnEnd: [fx.click(1800, 0.1), { inst: "glock", note: "A6", at: 0.02, dur: 0.15, gain: 0.25 }],
  /** 돌진 다시 쓸 수 있음 */
  ready: [{ inst: "glock", note: "D7", dur: 0.18, gain: 0.25 }],
  /** 재사용 대기 중에 누름 / 왕이 아닌데 호령 */
  denied: [{ wave: "square", freq: 180, to: 150, glide: 0.06, dur: 0.07, peak: 0.04, attack: 0.002, filter: { type: "lowpass", freq: 900 } }],
  /** 카운트다운 3·2·1 */
  tick: [{ inst: "bell", note: "D5", dur: 0.25, gain: 0.55 }],
  /** 마지막 10초 똑딱 (arg = 남은 초 — 줄수록 높게) */
  clock: (n: number) => [{ inst: "woodblock", note: n <= 3 ? "A5" : "D5", dur: 0.08, gain: 0.5 }],
  go: [...fx.chord("brass", ["D4", "F#4", "A4", "D5"], 0.6, 0.65), { inst: "timpani", note: "D2", gain: 0.6 }],
  golden: [...fx.arp("brass", ["D5", "F#5", "A5", "D6", "F#6"], 0.07, 0.5, 0.75), ...fx.chord("strings", ["D5", "F#5", "A5"], 1.2, 0.5, 0.35), { inst: "gong", note: "D3", gain: 0.4 }],
  victory: [...fx.arp("brass", ["D4", "F#4", "A4", "D5", "F#5"], 0.09, 0.5), ...fx.chord("strings", ["D4", "F#4", "A4", "D5"], 2, 0.7, 0.45), { inst: "triangle", note: "C6", at: 0.45, gain: 0.6 }],
  defeat: [{ inst: "brass", note: "A4", dur: 0.4, gain: 0.5 }, { inst: "brass", note: "F#4", at: 0.3, dur: 0.4, gain: 0.5 }, { inst: "brass", note: "D4", at: 0.6, dur: 0.9, gain: 0.5 }],
  ui: [fx.click(1200, 0.06)],
} satisfies Record<string, SfxRecipe>;

export const CROWN_THIEF_SUITE: SuiteConfig = {
  bpm: 144,
  swing: 0.03,
  tracks: [
    { voice: "softKick", pattern: "x . . . x . . . x . . . x . . .", gain: 0.4 },
    { voice: "snare", pattern: ". . . . x . . . . . . . x . . x", gain: 0.16 },
    { voice: "snare", div: 2, pattern: ". . . . . . . . . . . . . . . . . . . . . . . . x x x x x x x x", gain: 0.12, level: 2 },
    { voice: "shaker", pattern: "x . x . x . x . x . x . x . x .", gain: 0.08, maxLevel: 1 },
    { voice: "shaker", pattern: "x x x x x x x x x x x x x x x x", gain: 0.08, level: 2 },
    { voice: "openHat", pattern: ". . . . . . . x . . . . . . . x", gain: 0.1, level: 1 },
    { voice: "pizz", pattern: "D2 . . . A2 . . . D2 . . . A2 . . . | G2 . . . D2 . . . A2 . . . A1 . . .", gain: 0.34 },
    { voice: "harpsichord", pattern: ". . D4+F#4+A4 . . . D4+F#4+A4 . . . D4+F#4+A4 . . . D4+F#4+A4 . | . . G4+B4+D5 . . . G4+B4+D5 . . . A4+C#5+E5 . . . A4+C#5+E5 .", gain: 0.11 },
    { voice: "glock", div: 2, pattern: "D5 - A4 . D5 F#5 A5 - | G5 F#5 E5 . D5 - . . | B4 - D5 . G5 - F#5 E5 | A5 - . . A4 - . .", gain: 0.13, maxLevel: 2 },
    // 1단계: 황금 왕관 — 금관 화음과 팀파니
    { voice: "brass", div: 2, pattern: "D4+A4 - - - - - - - | G4+D5 - - - - - - - | G4+B4 - - - - - - - | A4+E5 - - - - - - -", gain: 0.06, level: 1 },
    { voice: "timpani", pattern: "D2 . . . . . . . A1 . . . . . . . | G1 . . . . . . . A1 . . . A1 . . .", gain: 0.2, level: 1 },
    // 2단계: 마지막 10초 — 리드 멜로디
    { voice: "lead", div: 2, pattern: "D6 - F#6 - A6 - F#6 D6 | G6 - - - B5 - - - | D6 - B5 - G5 - B5 D6 | E6 - C#6 - A5 - - -", gain: 0.055, level: 2 },
  ],
  sfx: SFX,
};

export const getCrownThiefSound = defineSuite(CROWN_THIEF_SUITE);
