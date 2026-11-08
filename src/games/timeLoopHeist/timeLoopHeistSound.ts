import { defineSuite, fx, type SfxPart, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { Frame, SimEvent } from "./sim";

/**
 * 시간 루프 도둑단 "Midnight Caper" — 한밤 박물관을 살금살금 지나는 느와르 첩보 재즈(D단조,
 * 4/4, 104 BPM, 살짝 스윙). 걸어 다니는 업라이트 베이스 + 브러시 + 비브라폰 컴핑 위에, 시간
 * 루프를 상징하는 시계 째깍 소리가 늘 깔린다. 재생 단계(intensity 1)에는 피치카토 첩보 선율 ·
 * 현악 지속음 · 낮은 킥이 더해져 "지금 다 같이 움직인다"는 긴장감이 생긴다.
 *
 * 효과음은 전부 같은 결로 — 짧고 부드럽게, 금속·유리 질감. 녹화 중 내 조작은 즉시(내 기기만),
 * 재생 중에는 매 틱 시뮬레이션 사건(줍기·입금·레버·EMP·역설·체포·문)을 그대로 소리로 낸다.
 * 숨길 정보가 없는 게임이라 남의 행동 소리를 내도 새는 것이 없다.
 */

const CHORDS = [
  ["D3", "F3", "A3", "C4"],
  ["D3", "F3", "A3", "C4"],
  ["G2", "Bb2", "D3", "F3"],
  ["G2", "Bb2", "D3", "F3"],
  ["Bb2", "D3", "F3", "A3"],
  ["A2", "C#3", "E3", "G3"],
  ["D3", "F3", "A3", "C4"],
  ["A2", "C#3", "E3", "G3"],
];

const BASS = "D2 F2 A2 C3 | D3 C3 A2 F2 | G2 Bb2 D3 F3 | G2 A2 Bb2 B2 | Bb2 D3 F3 D3 | A2 C#3 E3 G2 | D2 F2 A2 F2 | A2 G2 E2 C#2";

/** 비브라폰 컴핑: 한 마디 8분음표 8칸 중 2·4박 뒤 엇박에 위 세 음 */
const COMP = CHORDS.map((c) => {
  const v = c.slice(1).map((n) => n.replace(/(\d)$/, (d) => String(Number(d) + 1))).join("+");
  return `. . . ${v} . . ${v}! .`;
}).join(" | ");

const PAD = CHORDS.map((c) => c.slice(0, 3).join("+")).join(" ");

const MELODY =
  "D4 . F4 . E4 D4 . . | A3 . . C#4 D4 . . . | G4 . Bb4 . A4 G4 . . | D4 . . F4 G4 . . . | F4 . D4 . Bb3 . D4 F4 | E4 . C#4 . A3 . . . | D4 F4 A4 . G4 F4 E4 . | C#4 . E4 . A3 . . .";

const at = (parts: SfxPart[], offset: number): SfxPart[] => parts.map((p) => ({ ...p, at: (p.at ?? 0) + offset }));

/** 부드러운 발걸음 — 왼발/오른발이 살짝 다른 높이 */
const footstep = (side: number, peak: number): SfxPart[] => [
  { wave: "noise", dur: 0.075, peak, attack: 0.004, filter: { type: "bandpass", freq: side % 2 ? 820 : 680, q: 1.6 } },
  fx.thud(side % 2 ? 118 : 104, 0.09, peak * 1.3),
  { wave: "noise", at: 0.012, dur: 0.03, peak: peak * 0.35, filter: { type: "highpass", freq: 5200 } },
];

const SFX = {
  /** 녹화 중 내 한 걸음 (arg = 걸음 번호, 홀짝으로 좌우 발) */
  step: (side: number) => footstep(side, 0.16),
  /** 재생 중 그 틱에 누군가 움직였을 때 (여럿이어도 한 번) */
  ghostStep: (side: number) => footstep(side, 0.085),
  /** 한 틱 대기 — 시계 째깍 */
  wait: [{ inst: "tick", note: 1, gain: 0.9 }, { inst: "tock", note: 1, at: 0.05, gain: 0.5 }],
  /** 여러 틱 대기 — 째깍째깍 빠르게 */
  waitMany: [0, 0.06, 0.12, 0.18].map((t, i) => ({ inst: i % 2 ? "tock" : "tick", note: 1, at: t, gain: 0.7 })),
  /** 벽·닫힌 문으로 못 감 */
  blocked: [fx.thud(86, 0.14, 0.32), { wave: "noise", dur: 0.06, peak: 0.07, filter: { type: "lowpass", freq: 600 } }],
  /** ↶ 되돌리기 — 테이프를 한 칸 뒤로 감는 소리 */
  undo: [{ wave: "sine", freq: 900, to: 420, glide: 0.09, dur: 0.11, peak: 0.12, attack: 0.003 }, fx.whoosh(3200, 900, 0.1, 0.05)],
  /** 💎 보석 줍기 — 유리 반짝임 */
  pick: [...fx.arp("glock", ["E6", "G6", "B6"], 0.045, 0.45, 0.75), { wave: "sine", freq: 3950, dur: 0.5, peak: 0.035, at: 0.1, attack: 0.002 }],
  /** 🪙 동전 줍기 */
  coin: [...fx.coin(0, 2600, 0.11), ...fx.coin(0.07, 3300, 0.07)],
  /** 들고 있던 보석 내려놓기 */
  drop: [fx.thud(170, 0.12, 0.25), fx.click(1400, 0.08, 0.02)],
  /** 🔧 레버 — 묵직한 철컥 */
  lever: [
    { wave: "noise", dur: 0.05, peak: 0.16, filter: { type: "bandpass", freq: 2400, q: 2 } },
    fx.thud(150, 0.18, 0.35, 0.04),
    { wave: "square", freq: 330, to: 220, glide: 0.06, dur: 0.07, peak: 0.04, at: 0.04, filter: { type: "lowpass", freq: 1200 } },
    fx.click(2100, 0.12, 0.11),
  ],
  /** ⚡ EMP 발동 — 전기 지지직 + 로봇 전원 꺼지는 하강 */
  emp: [
    { wave: "sawtooth", freq: 1800, to: 70, glide: 0.55, dur: 0.6, peak: 0.1, attack: 0.004, filter: { type: "lowpass", freq: 3000, to: 200 } },
    { wave: "noise", dur: 0.35, peak: 0.09, tremolo: 32, filter: { type: "bandpass", freq: 3600, q: 0.8 } },
    { wave: "sine", freq: 520, to: 130, glide: 0.5, dur: 0.55, peak: 0.12, at: 0.05, vibrato: { rate: 18, depth: 0.04 } },
  ],
  /** 발판 밟아 켜짐 */
  plateOn: [fx.click(900, 0.12), { wave: "sine", freq: 440, to: 660, glide: 0.08, dur: 0.18, peak: 0.07, attack: 0.005 }],
  /** 발판에서 내려와 꺼짐 */
  plateOff: [fx.click(700, 0.08), { wave: "sine", freq: 520, to: 330, glide: 0.08, dur: 0.15, peak: 0.05, attack: 0.005 }],
  /** 🚪 문 열림 — 철문이 미끄러지며 내려감 / 레이저가 꺼짐 */
  doorOpen: [fx.whoosh(260, 1300, 0.38, 0.09), fx.thud(130, 0.16, 0.22, 0.34), { wave: "sine", freq: 1500, to: 380, glide: 0.25, dur: 0.28, peak: 0.04, at: 0.02 }],
  /** 문 닫힘 */
  doorClose: [fx.whoosh(1100, 280, 0.3, 0.07), fx.thud(110, 0.2, 0.3, 0.26)],
  /** 🚐 밴에 보석 입금 */
  bank: [...fx.chord("vibes", ["D5", "F#5", "A5"], 0.9, 0.7), ...at(fx.arp("glock", ["A5", "D6", "F#6"], 0.06, 0.5, 0.6), 0.08), ...fx.coin(0.02, 2200, 0.06)],
  /** 🚐 밴에 동전 입금 */
  bankCoin: [...fx.coin(0, 2400, 0.1), ...fx.coin(0.06, 2900, 0.08), ...fx.coin(0.12, 3500, 0.06)],
  /** ⚠️ 시간 역설 — 시공간이 뒤틀리며 사라짐 */
  paradox: [
    { wave: "sine", freq: 1400, to: 160, glide: 0.6, dur: 0.65, peak: 0.13, attack: 0.01, tremolo: 22 },
    { wave: "sine", freq: 1420, to: 150, glide: 0.6, dur: 0.6, peak: 0.07, detune: 30 },
    fx.whoosh(5000, 300, 0.5, 0.07, 0.05),
  ],
  /** 🚨 경비에게 들킴 — 짧은 경보 */
  caught: [
    ...[0, 0.16, 0.32].flatMap((t): SfxPart[] => [
      { wave: "square", freq: 988, dur: 0.08, peak: 0.06, at: t, attack: 0.003, filter: { type: "lowpass", freq: 3000 } },
      { wave: "square", freq: 740, dur: 0.08, peak: 0.06, at: t + 0.08, attack: 0.003, filter: { type: "lowpass", freq: 3000 } },
    ]),
    fx.thud(90, 0.3, 0.3),
  ],
  /** ✅ 내 녹화 제출 — 테이프 저장 */
  submit: [fx.click(1600, 0.12), ...at(fx.chord("vibes", ["A4", "D5", "F5"], 0.7, 0.55), 0.04), { inst: "bell", note: "A5", at: 0.1, dur: 0.6, gain: 0.35 }],
  /** 동료가 녹화를 냄 / 다음 루프 준비 */
  mateDone: [fx.pop(520, 980, 0.12), fx.click(2200, 0.06, 0.06)],
  /** ▶ 재생 시작 — 테이프를 감아 처음으로 */
  rewind: [
    fx.whoosh(6000, 500, 0.55, 0.09),
    { wave: "sawtooth", freq: 300, to: 1600, glide: 0.45, dur: 0.5, peak: 0.035, tremolo: 28, filter: { type: "lowpass", freq: 2500 } },
    ...at([0, 0.05, 0.1, 0.15, 0.2, 0.25].map((t, i) => ({ inst: i % 2 ? "tock" : "tick", note: 1, at: t, gain: 0.5 })), 0.35),
  ],
  /** 🔁 새 루프 녹화 시작 — 시간이 되감겨 다시 시작 */
  loopStart: [...fx.arp("bell", ["A5", "D5", "A4"], 0.09, 0.9, 0.45), fx.whoosh(400, 3200, 0.4, 0.05, 0.05)],
  /** 재생 끝, 아직 보석이 모자람 */
  loopEnd: [...fx.chord("vibes", ["D4", "F4", "A4"], 0.9, 0.55), { inst: "tick", note: 1, at: 0.5, gain: 0.6 }],
  /** ⏱ 녹화 제한 10초 이내 매 초 */
  timeWarn: [{ wave: "sine", freq: 1760, dur: 0.06, peak: 0.07, attack: 0.002 }],
  /** 작은 UI 버튼 */
  ui: [fx.click(1800, 0.08)],
  /** 🏆 작전 성공 */
  victory: [
    ...fx.arp("vibes", ["D4", "F#4", "A4", "D5", "F#5", "A5"], 0.07, 0.9, 0.8),
    ...fx.chord("brass", ["D4", "F#4", "A4"], 1.2, 0.45, 0.42),
    ...fx.chord("bell", ["D5", "A5", "D6"], 2, 0.5, 0.5),
    ...fx.coin(0.6, 2600, 0.08),
  ],
  /** 🚓 작전 실패 — 내려앉는 화음 + 멀리서 사이렌 */
  fail: [
    ...fx.arp("vibes", ["A4", "F4", "D4", "A3"], 0.14, 1, 0.7),
    { wave: "sine", freq: 700, to: 980, glide: 0.45, dur: 0.5, peak: 0.035, at: 0.5 },
    { wave: "sine", freq: 980, to: 700, glide: 0.45, dur: 0.5, peak: 0.035, at: 1 },
  ],
} satisfies Record<string, SfxRecipe>;

export type HeistSfx = keyof typeof SFX;

export const TIME_LOOP_HEIST_SUITE: SuiteConfig = {
  bpm: 104,
  swing: 0.22,
  tracks: [
    { voice: "upright", div: 4, pattern: BASS, gain: 0.85 },
    { voice: "brush", div: 4, pattern: ". x . x", gain: 0.7 },
    { voice: "ride", div: 2, pattern: "x . x x x . x x", gain: 0.3 },
    { voice: "tick", div: 4, pattern: "X x x x", gain: 0.28 },
    { voice: "pad", div: 16, pattern: PAD, gain: 0.32 },
    { voice: "vibes", div: 2, pattern: COMP, gain: 0.32 },
    { voice: "pizz", div: 2, pattern: MELODY, gain: 0.55, level: 1 },
    { voice: "strings", div: 16, pattern: "D4 D4 D4 D4 F4 E4 D4 C#4", gain: 0.22, level: 1 },
    { voice: "softKick", div: 4, pattern: "x . . . x . x .", gain: 0.45, level: 1 },
  ],
  sfx: SFX,
};

export const getTimeLoopHeistSound = defineSuite(TIME_LOOP_HEIST_SUITE);

export function heistPlay(name: HeistSfx, arg?: number) {
  getTimeLoopHeistSound().play(name, arg);
}

/** 시뮬레이션 사건 하나의 소리 (없으면 null) */
export function eventSfx(e: SimEvent, coin: boolean): HeistSfx | null {
  switch (e.kind) {
    case "pick":
      return "pick";
    case "coin":
      return "coin";
    case "drop":
      return "drop";
    case "bank":
      return coin ? "bankCoin" : "bank";
    case "lever":
      return "lever";
    case "emp":
      return "emp";
    case "paradox":
      return "paradox";
    case "caught":
      return "caught";
    default:
      return null;
  }
}

/** 두 프레임 사이에 문·발판이 바뀐 소리 (`plates` = 발판 글자들) */
export function deviceSfx(a: Frame, b: Frame, plates: readonly string[]): HeistSfx[] {
  const out: HeistSfx[] = [];
  const opened = Object.keys(b.open).some((k) => b.open[k] && !a.open[k]);
  const closed = Object.keys(b.open).some((k) => !b.open[k] && a.open[k]);
  if (opened) out.push("doorOpen");
  else if (closed) out.push("doorClose");
  if (plates.some((k) => b.active[k] && !a.active[k])) out.push("plateOn");
  else if (plates.some((k) => !b.active[k] && a.active[k])) out.push("plateOff");
  return out;
}

/**
 * 한 틱(프레임 t → t+1) 동안 난 소리 — 모든 자아의 사건 + 문/발판. 같은 소리는 한 번만.
 * 녹화 중에도 유령 사건까지 내서, 내 걸음이 유령을 망가뜨리면 바로 들린다.
 */
export function tickSfx(events: readonly SimEvent[], t: number, a: Frame, b: Frame, plates: readonly string[], coinOf: (loot: number) => boolean): HeistSfx[] {
  const out = new Set<HeistSfx>();
  for (const e of events) {
    if (e.t !== t) continue;
    const s = eventSfx(e, e.loot !== undefined && coinOf(e.loot));
    if (s) out.add(s);
  }
  for (const s of deviceSfx(a, b, plates)) out.add(s);
  // 입금 화음이 울리면 동전 입금 소리는 겹치지 않게
  if (out.has("bank")) out.delete("bankCoin");
  return [...out];
}
