import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 박자 난장판 소리.
 *
 * 곡 자체는 `song.ts`가 만든 음표 목록을 BeatMayhemBoard가 오디오 시계에 맞춰 직접 예약한다
 * (`ProceduralSuite.noteAt`, BGM 버스) — 그래서 아래 `tracks`는 곡 사이 결과 화면에서만 흐르는
 * 짧은 대기 음악이다. 효과음(SFX 버스)은 내 판정·장난·결과.
 *
 * 소리를 꺼도 플레이할 수 있다: 노트·판정선·박자 깜빡임·장난 예고가 모두 화면에 나온다(접근성).
 */

const SFX = {
  /** 노트를 침. arg 0 퍼펙트 · 1 그레이트 · 2 굿 */
  hit: (j: number) => {
    const k = Math.round(j);
    return k === 0
      ? [fx.click(2400, 0.16), { wave: "sine", freq: 1320, dur: 0.07, peak: 0.1, attack: 0.001 }]
      : k === 1
        ? [fx.click(1800, 0.13), { wave: "sine", freq: 990, dur: 0.06, peak: 0.07, attack: 0.001 }]
        : [fx.click(1200, 0.1)];
  },
  /** 노트를 놓침 */
  miss: [{ wave: "square", freq: 160, to: 110, glide: 0.08, dur: 0.1, peak: 0.05, attack: 0.002, filter: { type: "lowpass", freq: 700 } }],
  /** 빈 곳을 침 */
  empty: [fx.click(500, 0.05)],
  tick: [{ inst: "woodblock", note: 1, dur: 0.2, gain: 0.9 }],
  go: [...fx.chord("stab", ["E4", "G#4", "B4", "E5"], 0.4, 0.6), { inst: "clap", note: 1, gain: 0.7 }],
  /** 게이지가 다 참 */
  gaugeFull: [...fx.arp("glock", ["E6", "G#6", "B6", "E7"], 0.04, 0.3, 0.6), fx.whoosh(1500, 5000, 0.3, 0.06)],
  /** 장난을 쏨 */
  prankSend: [fx.whoosh(600, 3600, 0.35, 0.12), { wave: "sawtooth", freq: 300, to: 1200, glide: 0.3, dur: 0.32, peak: 0.08, attack: 0.01, filter: { type: "lowpass", freq: 3000 } }],
  /** 나에게 장난이 날아옴 (예고) */
  prankWarn: [
    { wave: "square", freq: 740, dur: 0.1, peak: 0.06, attack: 0.002, filter: { type: "lowpass", freq: 2200 } },
    { wave: "square", freq: 740, at: 0.16, dur: 0.1, peak: 0.06, attack: 0.002, filter: { type: "lowpass", freq: 2200 } },
    { wave: "square", freq: 990, at: 0.32, dur: 0.16, peak: 0.06, attack: 0.002, filter: { type: "lowpass", freq: 2200 } },
  ],
  /** 장난이 시작됨 */
  prankStart: [fx.buzz(500, 200, 0.4, 0.1), fx.whoosh(3000, 500, 0.4, 0.08)],
  /** 장난이 끝남 */
  prankEnd: [...fx.arp("vibes", ["B5", "E6"], 0.07, 0.3, 0.5)],
  /** 방패로 막음 */
  shield: [...fx.coin(0, 1900, 0.14), { inst: "bell", note: "E6", at: 0.03, dur: 0.5, gain: 0.4 }],
  /** 콤보 50·100·200. arg = 콤보 */
  combo: (n: number) => fx.arp("glock", n >= 200 ? ["E6", "G#6", "B6", "E7", "G#7"] : n >= 100 ? ["E6", "G#6", "B6", "E7"] : ["E6", "B6", "E7"], 0.05, 0.3, 0.55),
  /** 콤보가 끊김 (10 이상이었을 때) */
  comboBreak: [fx.buzz(240, 120, 0.25, 0.09)],
  roundWin: [...fx.arp("brass", ["E4", "G#4", "B4", "E5"], 0.08, 0.4, 0.6), { inst: "clap", note: 1, at: 0.32, gain: 0.7 }],
  roundLose: [...fx.arp("marimba", ["B4", "G#4", "E4"], 0.14, 0.4, 0.5)],
  victory: [
    ...fx.arp("brass", ["E4", "G#4", "B4", "E5", "G#5"], 0.09, 0.5),
    ...fx.chord("strings", ["E4", "G#4", "B4", "E5"], 2, 0.7, 0.45),
    ...fx.arp("glock", ["B6", "E7", "G#7"], 0.12, 0.5, 0.5),
  ],
  defeat: [{ inst: "brass", note: "B3", dur: 0.4, gain: 0.5 }, { inst: "brass", note: "G3", at: 0.3, dur: 0.4, gain: 0.5 }, { inst: "brass", note: "E3", at: 0.6, dur: 0.9, gain: 0.5 }],
  ui: [fx.click(1200, 0.06)],
} satisfies Record<string, SfxRecipe>;

export const BEAT_MAYHEM_SUITE: SuiteConfig = {
  bpm: 100,
  swing: 0.08,
  // 곡을 직접 예약하는 게임이라 BGM 버스를 다른 게임보다 크게 쓴다
  bgmLevel: 0.75,
  tracks: [
    { voice: "softKick", pattern: "x . . . . . x . x . . . . . . .", gain: 0.3 },
    { voice: "brush", pattern: ". . . . x . . . . . . . x . . .", gain: 0.2 },
    { voice: "upright", pattern: "E2 . . . . . B2 . E2 . . . G#2 . B2 . | A2 . . . . . E2 . B2 . . . . . B1 .", gain: 0.3 },
    { voice: "epiano", div: 2, pattern: "E4+G#4+B4 - . . G#4+B4+D#5 - . . | A4+C#5+E5 - . . F#4+A4+B4 - . .", gain: 0.12 },
    { voice: "vibes", div: 2, pattern: "B5 - G#5 . E5 - . . | C#6 - A5 . B5 - . .", gain: 0.1 },
  ],
  sfx: SFX,
};

export const getBeatMayhemSound = defineSuite(BEAT_MAYHEM_SUITE);
