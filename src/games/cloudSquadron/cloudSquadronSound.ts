import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 구름 편대 "Above the Cloud Sea" — D 장조 148 BPM 모험 행진곡: 금관 팡파르 멜로디 위로
 * 현악 16분 리프가 달린다. 2단계 (CloudSquadronBoard가 `setIntensity`):
 *   0 평소 비행 · 1 보스전/중간 보스 — 팀파니·스네어 롤·낮은 금관 화음·빠른 하이햇.
 *
 * 효과음은 스냅샷 이벤트마다 울린다. 소리로만 알리는 신호는 없다 — 보스 경고·번개 줄기 예고·피격
 * 모두 화면 글자·빛·흔들림으로 같이 나온다(접근성).
 */

const SFX = {
  /** 잡몹 격추 */
  pop: [fx.thud(220, 0.12, 0.22), { wave: "noise", dur: 0.16, peak: 0.09, attack: 0.002, filter: { type: "bandpass", freq: 1800, to: 500, q: 0.8 } }],
  /** 큰 적 격추 */
  boom: [fx.thud(90, 0.45, 0.5), { wave: "noise", dur: 0.6, peak: 0.14, attack: 0.004, filter: { type: "lowpass", freq: 2200, to: 300 } }, fx.whoosh(1200, 300, 0.4, 0.06, 0.05)],
  /** 보스 격추 */
  bossDown: [
    fx.thud(60, 0.9, 0.6),
    { wave: "noise", dur: 1.4, peak: 0.18, attack: 0.01, filter: { type: "lowpass", freq: 3000, to: 160 } },
    ...fx.chord("brass", ["D4", "F#4", "A4", "D5"], 1.6, 0.6, 0.5),
    { inst: "timpani", note: "D2", at: 0.5, dur: 1.2, gain: 0.7 },
  ],
  /** 내가 맞음 */
  hit: [{ wave: "square", freq: 420, to: 120, glide: 0.22, dur: 0.25, peak: 0.12, attack: 0.002, filter: { type: "lowpass", freq: 2000 } }, fx.thud(130, 0.2, 0.35)],
  /** 동료가 맞음 (작게) */
  allyHit: [{ wave: "square", freq: 360, to: 160, glide: 0.15, dur: 0.15, peak: 0.05, attack: 0.002, filter: { type: "lowpass", freq: 1600 } }],
  /** 은신이 한 번 막아 줌 */
  phase: [{ wave: "sine", freq: 900, to: 1800, glide: 0.12, dur: 0.18, peak: 0.08, attack: 0.002 }, fx.whoosh(2000, 4000, 0.2, 0.05)],
  /** 격추됨 (낙하산) */
  down: [...fx.arp("brass", ["A4", "F4", "D4"], 0.14, 0.4, 0.6), fx.whoosh(2400, 400, 0.8, 0.08, 0.1)],
  revive: [...fx.arp("glock", ["D5", "F#5", "A5", "D6"], 0.06, 0.4, 0.6), { inst: "triangle", note: 1, at: 0.2, gain: 0.5 }],
  /** 스침 (여러 번 겹치면 작게) */
  graze: [{ wave: "sine", freq: 2600, to: 3400, glide: 0.03, dur: 0.04, peak: 0.03, attack: 0.001 }],
  power: [...fx.arp("chip", ["D5", "A5", "D6", "F#6"], 0.04, 0.12, 0.5), ...fx.coin(0.12, 2600, 0.08)],
  heal: [...fx.arp("vibes", ["A5", "D6", "F#6"], 0.06, 0.4, 0.6)],
  star: fx.coin(0, 2800, 0.07),
  /** 스킬 */
  dash: [fx.whoosh(500, 3000, 0.25, 0.14)],
  shield: [{ wave: "sine", freq: 300, to: 700, glide: 0.2, dur: 0.4, peak: 0.12, attack: 0.01 }, { inst: "bell", note: "A5", at: 0.05, dur: 0.4, gain: 0.35 }],
  drone: [{ wave: "triangle", freq: 600, to: 1200, glide: 0.25, dur: 0.3, peak: 0.08, attack: 0.01 }, ...fx.arp("glock", ["F#6", "A6"], 0.08, 0.2, 0.4)],
  charge: [{ wave: "sawtooth", freq: 120, to: 900, glide: 0.6, dur: 0.6, peak: 0.07, attack: 0.05, filter: { type: "lowpass", freq: 3000 } }],
  beam: [{ wave: "sawtooth", freq: 180, dur: 0.9, peak: 0.08, attack: 0.01, vibrato: { rate: 30, depth: 0.05 }, filter: { type: "lowpass", freq: 1800 } }, { wave: "noise", dur: 0.9, peak: 0.05, filter: { type: "bandpass", freq: 3000, q: 1 } }],
  stealth: [{ wave: "sine", freq: 1400, to: 300, glide: 0.4, dur: 0.45, peak: 0.07, attack: 0.02 }],
  napalm: [{ wave: "noise", dur: 0.8, peak: 0.1, attack: 0.05, filter: { type: "bandpass", freq: 900, to: 400, q: 0.7 } }, fx.thud(110, 0.3, 0.25)],
  /** 궁극기 */
  ult: [...fx.chord("brass", ["D4", "A4", "D5"], 0.7, 0.55), { inst: "timpani", note: "D2", dur: 0.8, gain: 0.55 }, fx.whoosh(300, 2400, 0.5, 0.1)],
  thunder: [fx.thud(70, 0.7, 0.55), { wave: "noise", dur: 1, peak: 0.2, attack: 0.002, filter: { type: "lowpass", freq: 4000, to: 200 } }],
  combo: [...fx.arp("brass", ["D5", "F#5", "A5", "D6"], 0.07, 0.4, 0.75), { inst: "clap", note: 1, at: 0.28, gain: 0.7 }],
  /** 보스 경고 사이렌 */
  warn: [0, 0.55, 1.1].flatMap((at) => [{ wave: "square" as const, freq: 520, to: 780, glide: 0.25, dur: 0.45, peak: 0.07, attack: 0.02, at, filter: { type: "lowpass" as const, freq: 2200 } }]),
  /** 번개 줄기 예고 */
  lane: [{ wave: "sawtooth", freq: 1800, to: 2600, glide: 0.4, dur: 0.5, peak: 0.035, attack: 0.05, filter: { type: "bandpass", freq: 2400, q: 3 } }],
  phaseUp: [...fx.arp("brass", ["A3", "D4", "A3", "D4"], 0.12, 0.2, 0.6), { inst: "timpani", note: "A2", at: 0.45, dur: 0.8, gain: 0.6 }],
  stage: [...fx.arp("brass", ["D4", "A4", "D5", "F#5", "A5"], 0.09, 0.5, 0.65), { inst: "triangle", note: 1, at: 0.4, gain: 0.5 }],
  clear: [...fx.arp("brass", ["D5", "F#5", "A5", "D6"], 0.1, 0.5), ...fx.chord("strings", ["D4", "F#4", "A4", "D5"], 1.8, 0.7, 0.45), { inst: "triangle", note: 1, at: 0.45, gain: 0.6 }],
  continue: [...fx.arp("bell", ["A4", "D5", "A5"], 0.15, 0.6, 0.6)],
  victory: [...fx.arp("brass", ["D4", "F#4", "A4", "D5", "F#5"], 0.09, 0.5), ...fx.chord("strings", ["D4", "F#4", "A4", "D5"], 2.2, 0.7, 0.5), { inst: "timpani", note: "D2", at: 0.45, dur: 1.4, gain: 0.6 }],
  defeat: [{ inst: "brass", note: "A3", dur: 0.4, gain: 0.5 }, { inst: "brass", note: "F3", at: 0.32, dur: 0.4, gain: 0.5 }, { inst: "brass", note: "D3", at: 0.64, dur: 1, gain: 0.5 }],
  pick: [fx.click(1600, 0.1), { inst: "glock", note: "A6", dur: 0.15, gain: 0.3 }],
  ready: [...fx.arp("glock", ["D6", "A6"], 0.06, 0.2, 0.4)],
  denied: [{ wave: "square", freq: 180, to: 150, glide: 0.06, dur: 0.07, peak: 0.04, attack: 0.002, filter: { type: "lowpass", freq: 900 } }],
  ui: [fx.click(1500, 0.08)],
} satisfies Record<string, SfxRecipe>;

export const CLOUD_SQUADRON_SUITE: SuiteConfig = {
  bpm: 148,
  swing: 0,
  tracks: [
    { voice: "kick", pattern: "x . . . x . . . x . . . x . x .", gain: 0.36 },
    { voice: "snare", pattern: ". . . . x . . . . . . . x . . .", gain: 0.24 },
    { voice: "snare", pattern: ". . . . . . . . . . . . . x x x", gain: 0.16, level: 1 },
    { voice: "hat", pattern: "x . x . x . x . x . x . x . x .", gain: 0.12, maxLevel: 1 },
    { voice: "hat", pattern: "x x x x x x x x x x x x x x x x", gain: 0.1, level: 1 },
    { voice: "bass", pattern: "D2 . D2 . A1 . D2 . | B1 . B1 . F#1 . B1 . | G1 . G1 . D2 . G1 . | A1 . A1 . E2 . A1 .", gain: 0.34 },
    { voice: "strings", pattern: "D4 A4 D5 A4 D4 A4 D5 A4 | B3 F#4 B4 F#4 B3 F#4 B4 F#4 | G3 D4 G4 D4 G3 D4 G4 D4 | A3 E4 A4 E4 A3 C#4 E4 A4", gain: 0.06 },
    { voice: "brass", div: 2, pattern: "D5 - F#5 A5 - - F#5 . | B4 - D5 F#5 - - E5 . | G4 - B4 D5 - E5 F#5 . | E5 - - C#5 A4 - - .", gain: 0.1, maxLevel: 1 },
    { voice: "glock", div: 2, pattern: ". . A6 . . . F#6 . | . . F#6 . . . D6 . | . . D6 . . . G6 . | . . E6 . C#6 . A5 .", gain: 0.06, maxLevel: 1 },
    // 1단계: 보스전
    { voice: "brass", div: 2, pattern: "D4+A4 - - - D4+A4 - C4+G4 - | B3+F#4 - - - B3+F#4 - A3+E4 - | G3+D4 - - - G3+D4 - A3+E4 - | A3+E4 - - - A3+C#4 - - -", gain: 0.09, level: 1 },
    { voice: "lead", div: 2, pattern: "D5 - E5 F#5 A5 - F#5 E5 | D5 - - B4 F#5 - - - | G5 - F#5 E5 D5 - E5 F#5 | E5 - A5 - C#6 - - -", gain: 0.05, level: 1 },
    { voice: "timpani", pattern: "x . . . . . . . x . . . . . x .", gain: 0.3, level: 1 },
  ],
  sfx: SFX,
};

export const getCloudSquadronSound = defineSuite(CLOUD_SQUADRON_SUITE);
