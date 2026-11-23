import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";

/**
 * 만지면 내 꺼! "Last Call Shuffle" — F 장조 132 BPM 마트 방송풍 셔플: 워킹 베이스·일렉 피아노 컴핑 위로
 * 비브라폰이 "곧 문 닫습니다" 안내 멜로디를 흥얼거린다. 판 상황에 따라 3단계로 두꺼워진다
 * (FindersKeepersBoard가 `setIntensity`):
 *   0 평소 — 셔플 · 1 🔥 마감 세일(마지막 30초) — 브라스 스탭·클랩·계산대 "삑" 리듬(글록) ·
 *   2 마지막 10초 — 오픈 하이햇·리드 멜로디·스네어 필.
 *
 * 효과음은 스냅샷 이벤트(sim.ts `GameEvent`)마다 보드가 울린다. 줍기 소리는 물건 값마다 음이 올라간다.
 * 소리로만 알리는 신호는 없다 — 가로채기·마감 세일·방송·폭탄 모두 화면 글자·아이콘과 같이 나온다(접근성).
 */

const PICK_NOTES = ["C6", "E6", "G6", "C7", "E7"];

const SFX = {
  /** 바닥 물건 줍기. arg = 값 (1·2·3·5·10) — 비쌀수록 높게 */
  pick: (v: number) => {
    const i = v >= 10 ? 4 : v >= 5 ? 3 : v >= 3 ? 2 : v >= 2 ? 1 : 0;
    return [fx.pop(500 + i * 140, 1300 + i * 260, 0.1), { inst: "glock", note: PICK_NOTES[i], dur: 0.2, gain: 0.35 + i * 0.05 }];
  },
  /** 내가 가로챔 (휙 — 짤랑) */
  snatch: [fx.whoosh(500, 2600, 0.22, 0.1), ...fx.arp("marimba", ["F5", "A5", "C6", "F6"], 0.04, 0.25, 0.6), { inst: "triangle", note: "C7", at: 0.16, gain: 0.4 }],
  /** 남끼리 가로챔 (멀리서) */
  snatchOther: [fx.whoosh(700, 2000, 0.16, 0.05), { inst: "marimba", note: "C6", at: 0.05, dur: 0.15, gain: 0.3 }],
  /** 내 줄을 뺏김 (뚝—) */
  lost: [{ wave: "sine", freq: 520, to: 180, glide: 0.25, dur: 0.3, peak: 0.12, attack: 0.003 }, { inst: "brass", note: "D4", at: 0.08, dur: 0.35, gain: 0.45 }, fx.buzz(240, 120, 0.25, 0.06, 0.04)],
  /** 바구니에 넣기. arg = 지금까지 이번 묶음 개수 — 쌓일수록 높게 (쨍그랑 누적) */
  deposit: (n: number) => {
    const notes = ["F5", "G5", "A5", "C6", "D6", "F6", "G6", "A6", "C7"];
    const note = notes[Math.min(notes.length - 1, Math.max(0, n - 1))];
    return [{ inst: "bell", note, dur: 0.3, gain: 0.4 }, fx.click(2600, 0.05, 0.02)];
  },
  /** 계산대 "삑" (타임세일 덤) */
  register: [{ wave: "square", freq: 1760, dur: 0.09, peak: 0.06, attack: 0.002, filter: { type: "lowpass", freq: 4000 } }, { wave: "square", freq: 2350, at: 0.1, dur: 0.12, peak: 0.06, attack: 0.002, filter: { type: "lowpass", freq: 4000 } }],
  /** 세트 보너스 */
  set: [...fx.arp("vibes", ["F5", "A5", "C6", "F6", "A6"], 0.05, 0.4, 0.55), ...fx.coin(0.2, 2400, 0.12)],
  /** 무지개 세트 */
  rainbow: [...fx.arp("harp", ["F5", "G5", "A5", "C6", "D6", "F6", "G6", "A6"], 0.04, 0.6, 0.5), ...fx.chord("strings", ["F5", "A5", "C6"], 1, 0.35, 0.35)],
  /** 한 번에 많이 넣고 떠남 (기차 도착). arg = 개수 */
  runEnd: (n: number) => (n >= 6 ? [...fx.chord("brass", ["F4", "A4", "C5", "F5"], 0.5, 0.5), fx.whoosh(800, 2400, 0.3, 0.05)] : [{ inst: "glock", note: "C6", dur: 0.15, gain: 0.25 }]),
  /** ✂️ 줄 끊기 (싹둑 + 휙) */
  cut: [fx.click(4200, 0.08), fx.click(3000, 0.07, 0.06), fx.whoosh(600, 2800, 0.25, 0.08, 0.05)],
  /** 🤝 팀원에게 넘김 */
  pass: [...fx.arp("marimba", ["C5", "F5", "A5"], 0.05, 0.25, 0.5), fx.pop(400, 900, 0.1)],
  /** 🔥 바구니 털기 성공 */
  loot: [...fx.coin(0, 2000, 0.14), { inst: "brass", note: "C5", at: 0.05, dur: 0.2, gain: 0.45 }],
  /** 내 바구니가 털림 */
  looted: [{ inst: "brass", note: "A4", dur: 0.18, gain: 0.5 }, { inst: "brass", note: "E4", at: 0.15, dur: 0.35, gain: 0.5 }],
  /** 꽉 참 / 선물 상자 거부 */
  blocked: [{ wave: "square", freq: 200, to: 160, glide: 0.08, dur: 0.1, peak: 0.05, attack: 0.002, filter: { type: "lowpass", freq: 900 } }, { wave: "square", freq: 200, to: 160, glide: 0.08, at: 0.12, dur: 0.1, peak: 0.05, attack: 0.002, filter: { type: "lowpass", freq: 900 } }],
  dash: [fx.whoosh(500, 2600, 0.2, 0.12), { wave: "noise", dur: 0.12, peak: 0.05, filter: { type: "highpass", freq: 2500 } }],
  dashHit: [fx.thud(180, 0.15, 0.4), { wave: "triangle", freq: 420, to: 200, glide: 0.12, dur: 0.15, peak: 0.12, attack: 0.002 }],
  bump: (p: number) => {
    const k = Math.min(1, p / 8);
    return [{ wave: "sine", freq: 220 + k * 80, to: 110, glide: 0.1, dur: 0.12, peak: 0.12 + k * 0.14, attack: 0.002 }];
  },
  /** 지붕 틈에서 물건이 떨어지는 예고 (휘이—) */
  dropWarn: [{ wave: "sine", freq: 1400, to: 500, glide: 0.5, dur: 0.5, peak: 0.04, attack: 0.02 }],
  /** 물건 착지 (통) */
  land: [fx.thud(260, 0.1, 0.2), fx.pop(600, 900, 0.06, 0.02)],
  /** 🔥 마감 세일 시작 (방송 차임 + 팡파르) */
  sale: [...fx.arp("vibes", ["C6", "A5", "F5", "C5"], 0.18, 0.6, 0.6), ...fx.chord("brass", ["F4", "A4", "C5", "F5"], 0.6, 0.6, 0.8), { inst: "gong", note: "F3", at: 0.8, gain: 0.35 }],
  /** 🏆 트로피 착지 */
  trophy: [{ inst: "bell", note: "F6", dur: 0.8, gain: 0.55 }, { inst: "bell", note: "C6", at: 0.12, dur: 0.8, gain: 0.45 }, fx.thud(140, 0.25, 0.35)],
  /** 📢 점장 방송 차임 (딩동댕) */
  shop: [...fx.arp("vibes", ["C6", "A5", "F5"], 0.2, 0.7, 0.55)],
  /** 💣 폭탄이 내게 왔다 */
  bombOn: [fx.buzz(180, 90, 0.4, 0.1), { wave: "square", freq: 880, at: 0.1, dur: 0.06, peak: 0.05, attack: 0.002 }, { wave: "square", freq: 880, at: 0.3, dur: 0.06, peak: 0.05, attack: 0.002 }],
  /** 💣 폭탄을 떠넘김 */
  bombPass: [...fx.arp("marimba", ["F5", "C6", "F6"], 0.05, 0.3, 0.6), fx.whoosh(800, 2600, 0.25, 0.06)],
  /** 💣 째깍 (마지막 5초) */
  fuse: [{ wave: "square", freq: 1200, dur: 0.04, peak: 0.05, attack: 0.001, filter: { type: "highpass", freq: 800 } }],
  /** 💥 펑 */
  boom: [fx.thud(70, 0.6, 0.7), { wave: "noise", dur: 0.7, peak: 0.22, attack: 0.002, filter: { type: "lowpass", freq: 1800, to: 200 } }, { wave: "sine", freq: 160, to: 40, glide: 0.6, dur: 0.7, peak: 0.18, attack: 0.002 }],
  /** 🎖 목표 달성 발표 */
  goal: [...fx.arp("brass", ["C5", "F5", "A5", "C6"], 0.07, 0.4, 0.55), { inst: "triangle", note: "C7", at: 0.3, gain: 0.4 }],
  /** 돌진 다시 쓸 수 있음 */
  ready: [{ inst: "glock", note: "F6", dur: 0.18, gain: 0.25 }],
  denied: [{ wave: "square", freq: 180, to: 150, glide: 0.06, dur: 0.07, peak: 0.04, attack: 0.002, filter: { type: "lowpass", freq: 900 } }],
  tick: [{ inst: "bell", note: "F5", dur: 0.25, gain: 0.55 }],
  clock: (n: number) => [{ inst: "woodblock", note: n <= 3 ? "C6" : "F5", dur: 0.08, gain: 0.5 }],
  go: [...fx.chord("brass", ["F4", "A4", "C5", "F5"], 0.6, 0.65), { inst: "clap", note: "C4", gain: 0.5 }],
  victory: [...fx.arp("brass", ["F4", "A4", "C5", "F5", "A5"], 0.09, 0.5), ...fx.chord("strings", ["F4", "A4", "C5", "F5"], 2, 0.7, 0.45), { inst: "triangle", note: "C7", at: 0.45, gain: 0.6 }],
  defeat: [{ inst: "brass", note: "C5", dur: 0.4, gain: 0.5 }, { inst: "brass", note: "A4", at: 0.3, dur: 0.4, gain: 0.5 }, { inst: "brass", note: "F4", at: 0.6, dur: 0.9, gain: 0.5 }],
  ui: [fx.click(1200, 0.06)],
  /** 🧬 증강 카드 등장 (등급 1~3) */
  augOpen: (tier: number) => [
    ...fx.arp(tier >= 3 ? "harp" : "vibes", tier >= 3 ? ["C6", "E6", "G6", "B6", "D7"] : tier === 2 ? ["F5", "A5", "C6", "F6"] : ["C5", "E5", "G5"], 0.06, 0.5, 0.5),
    fx.whoosh(400, 2400, 0.35, 0.06),
  ],
  /** 🧬 카드 고름 */
  augPick: [fx.pop(600, 1600, 0.12), ...fx.arp("glock", ["G5", "D6", "G6"], 0.05, 0.3, 0.45)],
  /** 🧬 다시 뽑기 */
  augReroll: [fx.whoosh(900, 2800, 0.2, 0.08), fx.click(2200, 0.05, 0.03)],
  /** 🐷 저금통 */
  piggy: [...fx.coin(0, 2600, 0.12)],
  /** 🐂 들이받아 떨어뜨림 */
  ram: [fx.thud(120, 0.22, 0.5), { inst: "marimba", note: "C4", at: 0.06, dur: 0.2, gain: 0.4 }],
} satisfies Record<string, SfxRecipe>;

export const FINDERS_KEEPERS_SUITE: SuiteConfig = {
  bpm: 132,
  swing: 0.18,
  tracks: [
    { voice: "softKick", pattern: "x . . . . . x . x . . . . . . .", gain: 0.4 },
    { voice: "snare", pattern: ". . . . x . . . . . . . x . . .", gain: 0.13 },
    { voice: "clap", pattern: ". . . . x . . . . . . . x . . x", gain: 0.12, level: 1 },
    { voice: "snare", div: 2, pattern: ". . . . . . . . . . . . . . . . . . . . . . . . . . x . x x x x", gain: 0.1, level: 2 },
    { voice: "hat", pattern: "x . x . x . x . x . x . x . x .", gain: 0.07 },
    { voice: "openHat", pattern: ". . . x . . . x . . . x . . . x", gain: 0.07, level: 2 },
    { voice: "upright", pattern: "F2 . A2 . C3 . D3 . | Bb2 . D3 . F3 . G3 . | C3 . E3 . G3 . A3 . | F2 . C3 . A2 . C3 .", gain: 0.32 },
    { voice: "epiano", pattern: ". . F4+A4+C5 . . . F4+A4+C5 . | . . Bb3+D4+F4 . . . Bb3+D4+F4 . | . . C4+E4+G4+Bb4 . . . C4+E4+G4+Bb4 . | . . F4+A4+C5 . . . F4+A4+C5 .", gain: 0.1 },
    { voice: "vibes", div: 2, pattern: "C6 - A5 . F5 - . . | D6 - Bb5 . G5 - . . | E5 - G5 . C6 - Bb5 A5 | F5 - - - . . . .", gain: 0.12, maxLevel: 1 },
    // 1단계: 🔥 마감 세일 — 브라스 스탭 + 계산대 "삑" 리듬
    { voice: "stab", pattern: "F4+A4+C5 . . . . . . . . . . . . . . . | Bb3+D4+F4 . . . . . . . . . . . . . . . | C4+E4+G4 . . . . . . . . . . . . . . . | F4+A4+C5 . . . . . . . . . . F4+A4+C5 . . .", gain: 0.07, level: 1 },
    { voice: "glock", pattern: ". . . . . . . . . . C7 . C7 . . . ", gain: 0.06, level: 1 },
    // 2단계: 마지막 10초 — 리드 멜로디
    { voice: "lead", div: 2, pattern: "F6 - A6 - C7 - A6 F6 | D6 - F6 - Bb6 - G6 - | E6 - G6 - C7 - Bb6 A6 | F6 - - - C6 - - -", gain: 0.05, level: 2 },
  ],
  sfx: SFX,
};

export const getFindersKeepersSound = defineSuite(FINDERS_KEEPERS_SUITE);
