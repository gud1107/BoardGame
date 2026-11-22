import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 무너지는 탑 오르기 "Tower Rush" — D 단조 144 BPM 달리는 행진: 피치카토 베이스·하프시코드 리프 위로
 * 글로켄이 계단을 오르듯 올라간다. 판 상황에 따라 3단계로 두꺼워진다 (CrumbleClimbBoard가 `setIntensity`):
 *   0 평소 · 1 붕괴선이 내 발밑 4m 안까지 올라옴 — 현악·오픈 하이햇 · 2 첫 등정자가 나와 붕괴가 빨라짐(🏁) —
 *   탐 필인·리드·팀파니.
 *
 * 효과음은 스냅샷 이벤트(sim.ts `GameEvent`)마다 보드가 울린다.
 * 소리로만 알리는 신호는 없다 — 붕괴선·금 간 발판·방해 카드·낙석 모두 화면 글자·색·무늬와 같이 나온다(접근성).
 */

const SFX = {
  /** 점프. arg = 크기 0~1 (내 것 1, 멀리 있는 남의 것은 작게) */
  jump: (v: number) => {
    const k = v > 0 && v <= 1 ? v : 1;
    return [{ wave: "square", freq: 330, to: 760, glide: 0.12, dur: 0.14, peak: 0.07 * k, attack: 0.003, filter: { type: "lowpass", freq: 2400 } }, fx.whoosh(800, 1600, 0.14, 0.04 * k)];
  },
  /** 🪶 공중 점프 */
  airJump: [{ wave: "sine", freq: 600, to: 1300, glide: 0.18, dur: 0.22, peak: 0.1, attack: 0.004 }, ...fx.arp("glock", ["A5", "D6", "F6"], 0.04, 0.25, 0.4), fx.whoosh(1400, 3200, 0.25, 0.05)],
  /** 착지. arg = 떨어진 높이 (클수록 쿵) */
  land: (drop: number) => {
    const k = Math.min(1, Math.max(0.25, drop / 4));
    return [fx.thud(120 - k * 40, 0.12 + k * 0.15, 0.16 + k * 0.22), { wave: "noise", dur: 0.05, peak: 0.03 + k * 0.04, filter: { type: "lowpass", freq: 1800 } }];
  },
  /** 남이 착지 (작게) */
  landFar: [fx.thud(140, 0.1, 0.07)],
  /** 트램펄린 */
  bounce: [{ wave: "sine", freq: 160, to: 520, glide: 0.25, dur: 0.3, peak: 0.16, attack: 0.002, vibrato: { rate: 18, depth: 0.04 } }, fx.pop(300, 900, 0.18)],
  /** 👊 밀치기 */
  shove: [fx.whoosh(500, 1500, 0.16, 0.08), { wave: "triangle", freq: 220, to: 150, glide: 0.08, dur: 0.1, peak: 0.1, attack: 0.002 }],
  /** 밀치기·낙석에 맞음 */
  hit: [fx.thud(200, 0.14, 0.34), { wave: "noise", dur: 0.08, peak: 0.08, filter: { type: "bandpass", freq: 1200, q: 1 } }, { wave: "triangle", freq: 640, to: 300, glide: 0.15, dur: 0.16, peak: 0.08, attack: 0.002 }],
  /** 🛡 막음 */
  block: [{ inst: "bell", note: "E6", dur: 0.3, gain: 0.4 }, fx.click(2400, 0.1), { wave: "sine", freq: 1800, to: 1200, glide: 0.2, dur: 0.25, peak: 0.06, attack: 0.002 }],
  /** 발판에 금 (금 간 발판·흔들기) */
  crack: [...fx.crack(0, 0.18), { wave: "noise", dur: 0.18, peak: 0.05, attack: 0.005, filter: { type: "bandpass", freq: 900, q: 1.5 } }],
  /** 발판이 무너져 떨어짐 */
  break: [fx.thud(90, 0.3, 0.3), { wave: "noise", dur: 0.45, peak: 0.08, attack: 0.01, filter: { type: "lowpass", freq: 1400, to: 300 } }, ...fx.crack(0.05, 0.16)],
  /** 금 간 발판이 다시 생김 */
  respawn: [fx.pop(500, 1000, 0.08), { inst: "glock", note: "D6", at: 0.03, dur: 0.12, gain: 0.18 }],
  /** 붕괴선이 발판을 삼킴 (우르릉) */
  gone: [{ wave: "noise", dur: 0.6, peak: 0.06, attack: 0.05, filter: { type: "lowpass", freq: 420, to: 120 } }, fx.thud(55, 0.4, 0.14)],
  /** 꼭대기 등정 (남) */
  finish: [...fx.arp("glock", ["D5", "F5", "A5", "D6"], 0.06, 0.35, 0.55), { inst: "triangle", note: 1, at: 0.2, gain: 0.4 }],
  /** 내가 꼭대기 등정 */
  myFinish: [...fx.arp("brass", ["D4", "F4", "A4", "D5"], 0.08, 0.4, 0.75), ...fx.chord("strings", ["D5", "F5", "A5"], 1.2, 0.5, 0.32), { inst: "clap", note: 1, at: 0.3, gain: 0.6 }, { inst: "triangle", note: 1, at: 0.32, gain: 0.6 }],
  /** 🏁 첫 등정 — 붕괴 가속 */
  finalCall: [...fx.arp("brass", ["A4", "Bb4", "A4", "Bb4"], 0.12, 0.13, 0.65), { inst: "timpani", note: "D2", at: 0.48, dur: 0.9, gain: 0.6 }],
  /** 남이 붕괴에 휩쓸림 */
  caught: [{ wave: "sine", freq: 700, to: 180, glide: 0.6, dur: 0.6, peak: 0.08, attack: 0.01 }, { wave: "noise", at: 0.2, dur: 0.4, peak: 0.04, filter: { type: "lowpass", freq: 600 } }],
  /** 내가 휩쓸림 */
  myOut: [fx.buzz(300, 90, 0.8, 0.14), { inst: "marimba", note: "D3", at: 0.15, dur: 0.6, gain: 0.5 }, { wave: "noise", at: 0.1, dur: 0.8, peak: 0.07, filter: { type: "lowpass", freq: 900, to: 150 } }],
  /** 🧱 방해 카드가 내 손에 */
  card: [fx.pop(400, 1000, 0.16), ...fx.arp("pizz", ["D4", "A4", "D5"], 0.06, 0.25, 0.6)],
  /** 방해 카드 사용 (남이 씀 / 내가 과녁) */
  sabRocks: [fx.thud(70, 0.3, 0.25), { wave: "noise", dur: 0.4, peak: 0.07, attack: 0.02, filter: { type: "bandpass", freq: 500, q: 0.8 } }],
  sabIce: [...fx.arp("glock", ["F6", "A6", "D7"], 0.04, 0.35, 0.45), fx.whoosh(3000, 6000, 0.35, 0.05)],
  sabWind: [fx.whoosh(300, 1600, 0.9, 0.12), fx.whoosh(600, 2400, 0.8, 0.08, 0.2)],
  sabShake: [{ wave: "noise", dur: 0.5, peak: 0.08, attack: 0.02, filter: { type: "lowpass", freq: 300 } }, ...fx.crack(0.1, 0.18), fx.thud(60, 0.3, 0.2)],
  /** 내가 방해 카드의 과녁 — 경고음 */
  targeted: [
    { wave: "triangle", freq: 880, to: 660, glide: 0.12, dur: 0.14, peak: 0.1, attack: 0.004 },
    { wave: "triangle", freq: 880, to: 660, glide: 0.12, at: 0.18, dur: 0.14, peak: 0.1, attack: 0.004 },
  ],
  /** 낙석이 떨어짐. arg = 맞은 사람 수 */
  rock: (n: number) => [fx.thud(70, 0.35, 0.3 + Math.min(2, n) * 0.08), { wave: "noise", dur: 0.3, peak: 0.08, filter: { type: "lowpass", freq: 900, to: 200 } }, ...fx.crack(0.03, 0.14)],
  /** 아이템 */
  spawn: [fx.pop(700, 1400, 0.12), ...fx.arp("glock", ["D6", "A6"], 0.07, 0.25, 0.35)],
  feather: [...fx.arp("vibes", ["D6", "F6", "A6", "D7"], 0.05, 0.4, 0.5), fx.whoosh(2000, 5000, 0.4, 0.04)],
  boots: [...fx.coin(0, 1500, 0.12), fx.buzz(700, 1400, 0.15, 0.05, 0.08)],
  shield: [{ inst: "bell", note: "A5", dur: 0.5, gain: 0.45 }, { inst: "bell", note: "D6", at: 0.08, dur: 0.6, gain: 0.35 }],
  /** 내 발밑까지 붕괴선이 다가옴 (경고, 반복) */
  danger: [fx.click(900, 0.12), fx.click(900, 0.12, 0.12), { wave: "sine", freq: 90, to: 70, glide: 0.2, dur: 0.25, peak: 0.08, attack: 0.02 }],
  /** 밀치기 다시 쓸 수 있음 */
  ready: [{ inst: "glock", note: "A6", dur: 0.16, gain: 0.22 }],
  /** 쓸 수 없을 때 누름 */
  denied: [{ wave: "square", freq: 180, to: 150, glide: 0.06, dur: 0.07, peak: 0.04, attack: 0.002, filter: { type: "lowpass", freq: 900 } }],
  /** 발소리 (돌 발판) */
  step: (n: number) => [fx.click(Math.round(n) % 2 === 0 ? 700 : 600, 0.035), { wave: "noise", dur: 0.04, peak: 0.02, filter: { type: "bandpass", freq: 1800, q: 1.5 } }],
  /** 메뉴·버튼 */
  ui: [fx.click(1200, 0.06)],
  tick: [{ inst: "bell", note: "D6", dur: 0.25, gain: 0.5 }],
  go: [...fx.chord("brass", ["D4", "F4", "A4", "D5"], 0.5, 0.65), { inst: "triangle", note: 1, gain: 0.7 }],
  roundStart: [fx.whoosh(300, 2000, 0.5, 0.08), ...fx.arp("pizz", ["D3", "A3", "D4"], 0.08, 0.3, 0.6)],
  roundWin: [...fx.arp("glock", ["D5", "F5", "A5", "D6"], 0.07, 0.4, 0.8), { inst: "clap", note: 1, at: 0.3, gain: 0.7 }],
  roundLose: [{ inst: "marimba", note: "A4", dur: 0.3, gain: 0.5 }, { inst: "marimba", note: "F4", at: 0.16, dur: 0.3, gain: 0.5 }, { inst: "marimba", note: "D4", at: 0.32, dur: 0.6, gain: 0.5 }],
  victory: [
    ...fx.arp("brass", ["D4", "F4", "A4", "D5", "F5"], 0.09, 0.5),
    ...fx.chord("strings", ["D4", "F4", "A4", "D5"], 2, 0.7, 0.45),
    { inst: "triangle", note: 1, at: 0.45, gain: 0.6 },
  ],
  defeat: [{ inst: "brass", note: "A3", dur: 0.4, gain: 0.5 }, { inst: "brass", note: "F3", at: 0.3, dur: 0.4, gain: 0.5 }, { inst: "brass", note: "D3", at: 0.6, dur: 0.9, gain: 0.5 }],
} satisfies Record<string, SfxRecipe>;

export const CRUMBLE_CLIMB_SUITE: SuiteConfig = {
  bpm: 144,
  swing: 0.02,
  tracks: [
    { voice: "softKick", pattern: "x . . . x . . . x . . . x . x .", gain: 0.44 },
    { voice: "kick", pattern: "x . . . . . x . x . . . . . . .", gain: 0.28, level: 2 },
    { voice: "rim", pattern: ". . x . . . x . . . x . . . x x", gain: 0.2 },
    { voice: "shaker", pattern: "x x x x x x x x x x x x x x x x", gain: 0.09 },
    { voice: "openHat", pattern: ". . . . . . . x . . . . . . . x", gain: 0.11, level: 1 },
    { voice: "upright", pattern: "D2 . . D2 . . A1 . D2 . . D2 . . C2 . | Bb1 . . Bb1 . . F1 . A1 . . A1 . . E1 .", gain: 0.36 },
    { voice: "harpsichord", pattern: "D4 F4 A4 F4 D4 F4 A4 F4 C4 E4 A4 E4 C4 E4 A4 E4 | Bb3 D4 F4 D4 Bb3 D4 F4 D4 A3 C#4 E4 C#4 A3 C#4 E4 C#4", gain: 0.07 },
    { voice: "glock", div: 2, pattern: "D5 E5 F5 G5 A5 - F5 . | E5 F5 G5 A5 C6 - A5 . | Bb5 A5 G5 F5 E5 - D5 . | C#5 D5 E5 F5 E5 - A4 .", gain: 0.12, maxLevel: 2 },
    // 1단계: 붕괴선이 가까움 — 현악이 깔린다
    { voice: "strings", div: 2, pattern: "D4+A4 - - - - - - - | C4+A4 - - - - - - - | Bb3+F4 - - - - - - - | A3+E4 - - - - - - -", gain: 0.08, level: 1 },
    // 2단계: 🏁 붕괴 가속 — 리드·탐·팀파니
    { voice: "lead", div: 2, pattern: "D6 - F6 - A6 - F6 D6 | E6 - - - C6 - - - | F6 - D6 - Bb5 - D6 F6 | E6 - C#6 - A5 - - -", gain: 0.06, level: 2 },
    { voice: "tom", pattern: ". . . . . . . . . . . . x . x x", gain: 0.22, level: 2 },
    { voice: "timpani", pattern: "D2 . . . . . . . A1 . . . . . . .", gain: 0.3, level: 2 },
  ],
  sfx: SFX,
};

export const getCrumbleClimbSound = defineSuite(CRUMBLE_CLIMB_SUITE);
