import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 여관 난투 "Tavern Jig" — 상점 단계엔 류트·피치카토·탬버린이 도는 D 도리안 여관 춤곡(132 BPM, 스윙),
 * 강도 1(전투 재생 중)엔 팀파니·타이코·브라스 스탭이 더해진다. 파일 없이 proceduralSuite로 합성.
 * 효과음은 내 행동(클릭)과 전투 재생 이벤트에서만 울린다 — 상점은 비공개라 남의 구매는 소리가 안 난다.
 */

const SFX = {
  buy: [...fx.coin(0, 2200, 0.12), ...fx.coin(0.07, 2900, 0.1), fx.cardSlide(0.02, 0.1)],
  sell: [...fx.coin(0, 2900, 0.11), ...fx.coin(0.06, 2200, 0.1), ...fx.coin(0.12, 1700, 0.09)],
  reroll: [fx.whoosh(500, 1800, 0.18, 0.1), fx.cardSlide(0.05, 0.1), fx.cardSlide(0.12, 0.09), fx.cardSlide(0.19, 0.08)],
  freeze: [...fx.arp("glock", ["E6", "B6"], 0.05, 0.3, 0.6), fx.click(2600, 0.08, 0.1)],
  play: [fx.thud(120, 0.22, 0.4), fx.click(900, 0.1, 0.02)],
  upgrade: [...fx.chord("brass", ["D4", "A4"], 0.18, 0.9), ...fx.chord("brass", ["D4", "F#4", "A4", "D5"], 0.7, 1, 0.2), { inst: "bell", note: "A5", at: 0.2, dur: 0.8, gain: 0.6 }],
  golden: [
    fx.whoosh(600, 4500, 0.35, 0.12),
    ...fx.arp("glock", ["D6", "F#6", "A6", "D7", "F#7"], 0.05, 0.5, 0.8).map((p) => ({ ...p, at: (p.at ?? 0) + 0.15 })),
    ...fx.chord("pad", ["D4", "F#4", "A4", "D5"], 1.1, 0.8, 0.3),
  ],
  discover: fx.arp("harp", ["A4", "D5", "F#5", "A5"], 0.06, 0.6, 0.8),
  power: [fx.whoosh(300, 2400, 0.3, 0.12), ...fx.arp("bell", ["A5", "E6"], 0.08, 0.5, 0.6)],
  /** 시간 압박 — 남은 10~6초 째깍, 5초부터 더 높고 진한 째깍 + 심장 쿵 */
  tick: [fx.click(1300, 0.09)],
  tickUrgent: [fx.click(2100, 0.16), { inst: "taiko", note: "C2", at: 0, dur: 0.15, gain: 0.35 }],
  timeUp: [fx.whoosh(1800, 300, 0.3, 0.12), { inst: "taiko", note: "C2", at: 0.05, gain: 0.6 }],
  ready: [fx.click(1500, 0.12), ...fx.arp("pluck", ["D5", "A5"], 0.06, 0.25, 0.7)],
  attack: [fx.whoosh(900, 300, 0.12, 0.1), fx.thud(150, 0.2, 0.42, 0.08)],
  /** 예비 동작 끝 — 칼바람 */
  swing: [fx.whoosh(2600, 500, 0.16, 0.16), fx.whoosh(1200, 300, 0.12, 0.08, 0.03)],
  /** 충돌 — 피해(arg)가 클수록 낮고 무겁고 길게 */
  impact: (dmg: number) => {
    const d = Math.max(1, Math.min(15, dmg));
    return [
      fx.thud(110 - d * 3, 0.22 + d * 0.02, 0.5 + d * 0.025),
      ...fx.crack(0, 0.25 + d * 0.025),
      { wave: "noise", dur: 0.06, peak: 0.25, attack: 0.001, filter: { type: "highpass", freq: 2500 } },
      ...(d >= 6 ? [{ inst: "taiko", note: "C2", gain: 0.9 }] : []),
    ];
  },
  /** 일격에 쓰러뜨림 — 충돌 + 금속성 울림 + 저음 붐 */
  impactHeavy: (dmg: number) => {
    const d = Math.max(1, Math.min(15, dmg));
    return [
      fx.thud(70, 0.45, 0.7),
      ...fx.crack(0, 0.45 + d * 0.02),
      { inst: "taiko", note: "C2", gain: 1 },
      { inst: "timpani", note: "D2", at: 0.02, dur: 0.6 },
      { wave: "square", freq: 1800, to: 900, glide: 0.25, dur: 0.3, peak: 0.06, attack: 0.001 },
      { wave: "noise", dur: 0.08, peak: 0.3, attack: 0.001, filter: { type: "highpass", freq: 3000 } },
    ];
  },
  /* ── 캐릭터별 타격음(attackStyle.ts의 kind) — 충돌 순간 피해음 위에 겹친다 ── */
  atk_slash: [fx.whoosh(4200, 1500, 0.1, 0.16), { wave: "square", freq: 2600, to: 2100, glide: 0.2, dur: 0.25, peak: 0.04, attack: 0.001, at: 0.04 }, { wave: "sine", freq: 3900, dur: 0.3, peak: 0.05, attack: 0.001, at: 0.04 }],
  atk_smash: [fx.thud(55, 0.5, 0.75), ...fx.crack(0, 0.5), { wave: "noise", dur: 0.6, peak: 0.2, attack: 0.01, filter: { type: "lowpass", freq: 600, to: 120 } }],
  atk_claw: [0, 0.05, 0.1].map((at) => ({ wave: "noise" as const, at, dur: 0.07, peak: 0.22, attack: 0.002, filter: { type: "bandpass" as const, freq: 3200, to: 1400, q: 2 } })),
  atk_bite: [fx.thud(180, 0.12, 0.5), { wave: "noise", dur: 0.12, peak: 0.3, attack: 0.001, filter: { type: "bandpass", freq: 900, q: 1.5 } }, fx.click(700, 0.25, 0.05)],
  atk_stab: [fx.whoosh(5000, 2500, 0.06, 0.12), fx.click(2400, 0.2, 0.05), { wave: "noise", dur: 0.08, peak: 0.12, at: 0.05, filter: { type: "highpass", freq: 3000 } }],
  atk_punch: [fx.thud(110, 0.18, 0.6), { wave: "square", freq: 900, to: 400, glide: 0.15, dur: 0.18, peak: 0.07, attack: 0.001 }, { wave: "sine", freq: 2400, dur: 0.4, peak: 0.05, attack: 0.001, at: 0.01 }],
  atk_arrow: [{ wave: "noise", dur: 0.05, peak: 0.2, attack: 0.001, filter: { type: "bandpass", freq: 1500, q: 3 } }, fx.thud(220, 0.1, 0.35)],
  atk_bolt: [...fx.arp("glock", ["E6", "B6"], 0.03, 0.3, 0.6), fx.pop(500, 1600, 0.25), ...fx.chord("pad", ["E4", "B4"], 0.4, 0.4)],
  atk_fire: [{ wave: "noise", dur: 0.55, peak: 0.32, attack: 0.01, filter: { type: "lowpass", freq: 2400, to: 300 } }, fx.thud(70, 0.35, 0.5), ...[0.1, 0.18, 0.27].map((at) => ({ wave: "noise" as const, at, dur: 0.02, peak: 0.12, filter: { type: "highpass" as const, freq: 4000 } }))],
  atk_lightning: [...fx.crack(0, 0.6), { wave: "sawtooth", freq: 1200, to: 80, glide: 0.25, dur: 0.3, peak: 0.08, attack: 0.001 }, { wave: "noise", dur: 0.4, peak: 0.25, attack: 0.001, filter: { type: "highpass", freq: 2500, to: 600 } }],
  atk_water: [{ wave: "noise", dur: 0.35, peak: 0.28, attack: 0.005, filter: { type: "bandpass", freq: 1200, to: 500, q: 0.8 } }, fx.pop(300, 120, 0.25), fx.pop(500, 200, 0.18, 0.08)],
  atk_wind: [fx.whoosh(300, 3000, 0.4, 0.18), fx.whoosh(2500, 400, 0.35, 0.12, 0.15)],
  atk_shadow: [fx.whoosh(200, 900, 0.35, 0.18), ...fx.chord("choir", ["D3", "Ab3"], 0.6, 0.5), fx.thud(80, 0.3, 0.4)],
  atk_leaf: [0, 0.04, 0.08, 0.12].map((at) => ({ wave: "noise" as const, at, dur: 0.06, peak: 0.14, attack: 0.002, filter: { type: "bandpass" as const, freq: 2600 + at * 6000, q: 3 } })),
  atk_fairy: [...fx.arp("glock", ["C7", "E7", "G7", "C8"], 0.03, 0.25, 0.55), ...fx.arp("bell", ["G6", "C7"], 0.05, 0.4, 0.35)],
  atk_holy: [...fx.chord("bell", ["D6", "A6"], 0.8, 0.6), ...fx.chord("choir", ["D4", "A4", "D5"], 0.7, 0.6), fx.thud(120, 0.25, 0.45)],
  atk_poison: [{ wave: "noise", dur: 0.4, peak: 0.2, attack: 0.02, filter: { type: "bandpass", freq: 700, to: 300, q: 1.2 } }, fx.pop(220, 90, 0.2), fx.pop(260, 110, 0.15, 0.12)],
  atk_cannon: [fx.thud(50, 0.6, 0.8), ...fx.crack(0, 0.7), { wave: "noise", dur: 0.8, peak: 0.3, attack: 0.005, filter: { type: "lowpass", freq: 900, to: 100 } }],
  /** 원거리 발사 */
  launch_arrow: [{ wave: "triangle", freq: 220, to: 160, glide: 0.15, dur: 0.18, peak: 0.25, attack: 0.002 }, fx.whoosh(1800, 3600, 0.18, 0.1, 0.05)],
  launch_magic: [fx.whoosh(600, 3000, 0.25, 0.12), ...fx.arp("musicbox", ["A5", "E6"], 0.05, 0.3, 0.5)],
  launch_fire: [{ wave: "noise", dur: 0.3, peak: 0.25, attack: 0.03, filter: { type: "lowpass", freq: 1500, to: 600 } }],
  launch_cannon: [fx.thud(60, 0.35, 0.7), ...fx.crack(0, 0.4)],
  /** 능력 발동 하이라이트 */
  ability: [...fx.arp("glock", ["A5", "E6", "A6"], 0.045, 0.35, 0.55), { inst: "bell", note: "E6", at: 0.1, dur: 0.6, gain: 0.35 }],
  /** 전투 시작 — 칼 맞부딪힘(짧게: 울림 없이 ~0.25초 안에 끝) */
  clash: [
    fx.whoosh(3000, 800, 0.07, 0.1),
    { wave: "square", freq: 2400, to: 1900, glide: 0.1, dur: 0.12, peak: 0.05, attack: 0.001, at: 0.05 },
    { wave: "sine", freq: 3300, dur: 0.15, peak: 0.07, attack: 0.001, at: 0.05 },
    ...fx.crack(0.05, 0.3),
  ],
  shieldPop: [
    { wave: "noise", dur: 0.25, peak: 0.3, attack: 0.001, filter: { type: "highpass", freq: 4000, to: 9000 } },
    ...fx.arp("glock", ["E7", "B6", "G6", "E6"], 0.025, 0.35, 0.7),
    ...fx.arp("bell", ["B6", "E7"], 0.03, 0.5, 0.4),
  ],
  death: [
    fx.thud(60, 0.5, 0.65),
    ...fx.crack(0, 0.5),
    { wave: "noise", dur: 0.5, peak: 0.25, attack: 0.002, filter: { type: "bandpass", freq: 1800, to: 200, q: 0.8 } },
    fx.buzz(260, 60, 0.4, 0.09, 0.05),
  ],
  summon: [fx.pop(300, 900, 0.2), fx.pop(500, 1200, 0.14, 0.06)],
  soc: [fx.whoosh(400, 2000, 0.25, 0.1), { inst: "bell", note: "D6", at: 0.1, dur: 0.6, gain: 0.5 }],
  win: [
    ...fx.arp("lute", ["D4", "F#4", "A4", "D5"], 0.08, 0.6),
    ...fx.chord("brass", ["D4", "F#4", "A4", "D5"], 1.0, 1, 0.34),
    { inst: "timpani", note: "D2", at: 0.34, dur: 0.8 },
  ],
  lose: [...fx.arp("lute", ["A4", "F4", "D4", "A3"], 0.14, 0.7, 0.8), ...fx.chord("pad", ["D3", "F3", "A3"], 1.2, 0.7, 0.5)],
  draw: [...fx.arp("pluck", ["D4", "A4", "D4"], 0.1, 0.4, 0.7)],
  eliminated: [
    fx.thud(70, 0.6, 0.6),
    ...fx.arp("strings", ["A3", "F3", "D3"], 0.35, 1.2, 0.8),
    ...fx.chord("choir", ["D3", "F3", "A3"], 1.6, 0.6, 0.9),
  ],
  victory: [
    ...fx.arp("lute", ["D4", "F#4", "A4", "D5", "F#5", "A5"], 0.07, 0.8),
    ...fx.chord("brass", ["D4", "F#4", "A4", "D5"], 1.4, 1.1, 0.45),
    ...fx.chord("strings", ["G3", "B3", "D4", "G4"], 0.8, 0.9, 1.3),
    ...fx.chord("brass", ["A3", "C#4", "E4", "A4"], 0.8, 1, 2.0),
    ...fx.chord("choir", ["D4", "F#4", "A4", "D5"], 2.2, 1, 2.7),
    { inst: "timpani", note: "D2", at: 2.7, dur: 1.4 },
    { inst: "bell", note: "D6", at: 2.7, dur: 2 },
  ],
} satisfies Record<string, SfxRecipe>;

export const TAVERN_BRAWL_SUITE: SuiteConfig = {
  bpm: 132,
  swing: 0.18,
  bgmLevel: 0.22,
  tracks: [
    // D 도리안: Dm – C – Dm – Am, 한 마디 4박(div 4 = 16분음표 단위 4칸 = 1박)
    { voice: "upright", div: 4, gain: 0.5, pattern: "D2 . A2 . | C2 . G2 . | D2 . A2 . | A1 . E2 . " },
    {
      voice: "lute",
      div: 2,
      gain: 0.45,
      pattern: "D4 F4 A4 F4 E4 D4 C4 E4 | G4 E4 C4 E4 D4 C4 B3 C4 | D4 F4 A4 B4 C5 A4 F4 A4 | E4 A4 G4 E4 C#4 E4 A3 . ",
    },
    { voice: "pizz", div: 4, gain: 0.3, pattern: "D3+A3 . D3+A3 . | C3+G3 . C3+G3 . | D3+A3 . D3+A3 . | A2+E3 . A2+E3 . " },
    { voice: "shaker", div: 2, gain: 0.22, pattern: "x x x x x x x x " },
    { voice: "tom", div: 4, gain: 0.3, pattern: "x . . x | x . . . " },
    // 강도 1: 전투
    { voice: "timpani", div: 4, gain: 0.45, level: 1, pattern: "D2 . . D2 | D2 . A1 . " },
    { voice: "taiko", div: 2, gain: 0.35, level: 1, pattern: "x . . x . . x . " },
    { voice: "stab", div: 8, gain: 0.22, level: 1, pattern: "D4+F4+A4 . C4+E4+G4 . D4+F4+A4 . E4+A4+C#5 . " },
  ],
  sfx: SFX,
};

export const getTavernBrawlSound = defineSuite(TAVERN_BRAWL_SUITE);
