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
  ready: [fx.click(1500, 0.12), ...fx.arp("pluck", ["D5", "A5"], 0.06, 0.25, 0.7)],
  attack: [fx.whoosh(900, 300, 0.12, 0.1), fx.thud(150, 0.2, 0.42, 0.08)],
  shieldPop: [...fx.crack(0, 0.3), ...fx.arp("glock", ["B6", "G6"], 0.03, 0.2, 0.5)],
  death: [fx.thud(90, 0.35, 0.5), fx.buzz(300, 90, 0.3, 0.08, 0.02)],
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
