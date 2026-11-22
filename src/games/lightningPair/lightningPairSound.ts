import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 번개 짝꿍 "Spark Rush" — E 장조 148 BPM 칩튠·마림바. 보드가 `setIntensity`로 고른다:
 *   0 시작 카운트·결과 — 마림바·베이스 · 1 카드를 찾는 동안 — 하이햇·아르페지오가 더해져 급해진다.
 *
 * 소리로만 알리는 것은 없다 — 맞힘·틀림·⚡·얼음은 모두 화면 글자·테두리로도 뜬다(접근성).
 */

const SFX = {
  /** 새 가운데 카드가 펼쳐짐 */
  flip: [fx.whoosh(900, 3200, 0.16, 0.08), fx.click(2200, 0.08, 0.05)],
  /** 3·2·1 */
  count: [{ inst: "woodblock", note: "E5", dur: 0.1, gain: 0.7 }],
  go: [...fx.arp("chip", ["E5", "B5", "E6"], 0.05, 0.2, 0.6)],
  /** 내가 짝을 맞혀 가져옴 */
  claim: [...fx.arp("marimba", ["E5", "G#5", "B5", "E6"], 0.045, 0.35, 0.8), ...fx.coin(0.12)],
  /** 남이 가져감 */
  claimOther: [fx.pop(700, 380, 0.12), { inst: "marimba", note: "B3", at: 0.03, dur: 0.25, gain: 0.4 }],
  /** 맞혔는데 아깝게 짐 */
  close: [{ inst: "marimba", note: "G4", dur: 0.2, gain: 0.5 }, { inst: "marimba", note: "D4", at: 0.12, dur: 0.35, gain: 0.45 }],
  /** 틀린 그림 → 얼음 */
  wrong: [fx.buzz(240, 120, 0.3, 0.13), { wave: "sine", freq: 2600, to: 3400, glide: 0.4, at: 0.08, dur: 0.6, peak: 0.04, attack: 0.01 }],
  /** ⚡ 번개 카드가 펼쳐짐 */
  golden: [...fx.crack(0, 0.25), ...fx.arp("glock", ["E6", "B6", "E7"], 0.05, 0.4, 0.6)],
  /** 💡 힌트 */
  hint: [{ inst: "glock", note: "B5", dur: 0.3, gain: 0.4 }],
  victory: [...fx.arp("chip", ["E5", "G#5", "B5", "E6", "G#6", "B6"], 0.07, 0.6, 0.8), ...fx.chord("marimba", ["E4", "G#4", "B4", "E5"], 1.2, 0.7, 0.45)],
  defeat: [{ inst: "marimba", note: "B4", dur: 0.4, gain: 0.6 }, { inst: "marimba", note: "G4", at: 0.25, dur: 0.4, gain: 0.6 }, { inst: "marimba", note: "E4", at: 0.5, dur: 0.9, gain: 0.6 }],
  ui: [fx.click(1400, 0.06)],
} satisfies Record<string, SfxRecipe>;

export const LIGHTNING_PAIR_SUITE: SuiteConfig = {
  bpm: 148,
  tracks: [
    { voice: "kick", pattern: "x . . . x . . . x . . . x . . x", gain: 0.3 },
    { voice: "chipBass", pattern: "E2 . E3 . E2 . B2 . C#2 . C#3 . A1 . B1 .", gain: 0.16 },
    { voice: "marimba", div: 2, pattern: "E4 B4 G#4 B4 E5 B4 G#4 B4 | C#4 A4 E4 A4 B3 F#4 D#4 F#4", gain: 0.12 },
    { voice: "hat", pattern: "x x x x x x x x x x x x x x x x", gain: 0.07, level: 1 },
    { voice: "snare", pattern: ". . . . x . . . . . . . x . . .", gain: 0.16, level: 1 },
    { voice: "arp", div: 1, pattern: "E5 G#5 B5 E6 B5 G#5 E5 B4 | C#5 E5 A5 C#6 A5 E5 C#5 A4", gain: 0.05, level: 1 },
  ],
  sfx: SFX,
};

export const getLightningPairSound = defineSuite(LIGHTNING_PAIR_SUITE);
