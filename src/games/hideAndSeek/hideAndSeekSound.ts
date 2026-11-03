import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import { isSfxEffectivelyMuted, useAudioSettingsStore } from "@/lib/audio/audioSettings";
import type { GameState, TurnEvent } from "./engine";
import { T } from "./show";

/**
 * 한밤의 숨바꼭질 "Midnight Tiptoe" suite — 살금살금 걷는 A단조 피치카토 + 오르골 멜로디,
 * 째깍째깍 벽시계(우드블록)와 콘트라베이스. 긴장(마지막 3턴 / 남은 사람 1명)이 오르면
 * 심장 박동 킥과 트레몰로 현이 깔린다.
 *
 * SFX는 판정 연출 타임라인(`show.ts`의 T)에 맞춰 보드가 `revealCues`로 예약한다 —
 * 삐걱 소리가 말풍선과 같은 순간에 나도록.
 */

const SFX = {
  /** 술래가 기둥에서 세기 시작 — 시계 두 번 */
  count: [{ inst: "woodblock", note: "E5", dur: 0.2 }, { inst: "woodblock", note: "A4", at: 0.35, dur: 0.2 }, { inst: "musicbox", note: "E6", at: 0.7, dur: 0.6, gain: 0.7 }],
  /** "찾는다~!" — 낮은 징 + 종 */
  ready: [{ inst: "gong", note: "A2", dur: 1.6, gain: 0.5 }, ...fx.arp("bell", ["A4", "C5", "E5"], 0.12, 0.8, 0.6)],
  /** 내가 고를 차례 */
  turn: [{ inst: "glock", note: "E6", dur: 0.3, gain: 0.6 }, { inst: "glock", note: "A6", at: 0.1, dur: 0.45, gain: 0.6 }],
  commit: [fx.click(1600, 0.12)],
  /** 발소리 — arg = 걸음 수 */
  step: (n: number) =>
    Array.from({ length: Math.max(2, Math.min(6, n)) }, (_, i) => ({ wave: "sine" as const, freq: i % 2 ? 95 : 110, to: 60, glide: 0.08, at: i * 0.24, dur: 0.12, peak: 0.16, attack: 0.004 })),
  /** 🔊 삐걱 — 낡은 마룻바닥 */
  creak: [
    { wave: "sawtooth", freq: 180, to: 120, glide: 0.45, dur: 0.5, peak: 0.07, attack: 0.04, filter: { type: "bandpass", freq: 900, q: 6 }, vibrato: { rate: 23, depth: 9 } },
    { wave: "sawtooth", freq: 240, to: 200, glide: 0.25, at: 0.28, dur: 0.3, peak: 0.05, attack: 0.03, filter: { type: "bandpass", freq: 1200, q: 7 }, vibrato: { rate: 31, depth: 7 } },
  ],
  /** 🍃 부스럭 */
  rustle: [
    { wave: "noise", dur: 0.14, peak: 0.08, attack: 0.01, filter: { type: "bandpass", freq: 3200, q: 1.4 } },
    { wave: "noise", at: 0.17, dur: 0.12, peak: 0.07, attack: 0.01, filter: { type: "bandpass", freq: 2600, q: 1.4 } },
    { wave: "noise", at: 0.32, dur: 0.16, peak: 0.06, attack: 0.01, filter: { type: "bandpass", freq: 3600, q: 1.2 } },
  ],
  /** 🔦 손전등 딸깍 + 웅 */
  flash: [fx.click(2400, 0.16), { wave: "sine", freq: 220, to: 330, glide: 0.4, at: 0.05, dur: 0.6, peak: 0.05, attack: 0.08 }],
  /** 가구 뒤적뒤적 */
  search: [0, 0.13, 0.27, 0.4].map((at, i) => ({ wave: "noise" as const, at, dur: 0.1, peak: 0.1, attack: 0.005, filter: { type: "lowpass" as const, freq: 900 + i * 300 } })),
  /** "찾았다!" */
  found: [...fx.crack(0, 0.3), ...fx.chord("stab", ["A3", "C4", "D#4", "F#4"], 0.6, 0.9), { inst: "timpani", note: "A2", dur: 0.8, gain: 0.7 }],
  /** "없다…" */
  miss: [{ inst: "vibes", note: "E4", dur: 0.4, gain: 0.6 }, { inst: "vibes", note: "C4", at: 0.16, dur: 0.6, gain: 0.6 }],
  /** 딱 마주침 */
  bump: [fx.thud(160, 0.2, 0.4), ...fx.chord("strings", ["A3", "D#4", "A4"], 0.5, 0.8, 0.02)],
  /** "찜!" */
  home: [...fx.arp("glock", ["A5", "C6", "E6", "A6"], 0.06, 0.5), ...fx.coin(0.26, 2600, 0.1)],
  blocked: [fx.buzz(260, 120, 0.4, 0.13), fx.thud(90, 0.3, 0.35)],
  /** 💓 인기척 — 두근두근 */
  heartbeat: [fx.thud(62, 0.18, 0.55), fx.thud(55, 0.2, 0.45, 0.22), fx.thud(62, 0.18, 0.4, 0.75), fx.thud(55, 0.2, 0.32, 0.97)],
  /** 🤫 조용 */
  quiet: [{ wave: "triangle", freq: 660, to: 590, glide: 0.6, dur: 0.7, peak: 0.04, attack: 0.1 }],
  /** 🐦 못 찾겠다 꾀꼬리 — 새 지저귐 */
  survive: [
    { wave: "sine", freq: 1800, to: 2600, glide: 0.08, dur: 0.1, peak: 0.08, attack: 0.005 },
    { wave: "sine", freq: 2400, to: 1900, glide: 0.08, at: 0.12, dur: 0.12, peak: 0.08, attack: 0.005 },
    { wave: "sine", freq: 1800, to: 2700, glide: 0.1, at: 0.32, dur: 0.12, peak: 0.08, attack: 0.005 },
    ...fx.arp("flute", ["E5", "A5", "C6", "E6"], 0.09, 0.5, 0.6),
  ],
  sweep: [...fx.arp("brass", ["A3", "C4", "E4", "A4"], 0.09, 0.5, 0.7), ...fx.chord("brass", ["A3", "C4", "E4", "A4"], 1.2, 0.6, 0.4)],
  victory: [...fx.arp("musicbox", ["A5", "C6", "E6", "A6", "C7"], 0.08, 0.6), ...fx.chord("strings", ["F3", "A3", "C4", "E4"], 1.6, 0.6, 0.45), { inst: "upright", note: "A1", at: 0.5, dur: 1.4 }],
} satisfies Record<string, SfxRecipe>;

export const HIDE_AND_SEEK_SUITE: SuiteConfig = {
  bpm: 96,
  swing: 0.12,
  tracks: [
    // 벽시계 째깍째깍
    { voice: "woodblock", pattern: "E5 . . . A4 . . . E5 . . . A4 . . .", gain: 0.12 },
    // 살금살금 피치카토 베이스 (Am – F – Dm – E)
    { voice: "pizz", div: 2, pattern: "A2 . E3 . A2 . C3 . | F2 . C3 . F2 . A2 . | D2 . A2 . D2 . F2 . | E2 . B2 . E2 . G#2 .", gain: 0.42 },
    { voice: "pizz", div: 2, pattern: ". A3 . C4 . E4 . C4 | . A3 . C4 . F4 . C4 | . A3 . D4 . F4 . D4 | . G#3 . B3 . E4 . B3", gain: 0.2 },
    // 오르골 멜로디
    { voice: "musicbox", div: 2, pattern: "E5 . . C5 . . A4 . | F5 . E5 . C5 . . . | D5 . F5 . A5 . G5 F5 | E5 . . . G#4 . B4 .", gain: 0.2 },
    { voice: "pad", div: 8, pattern: "A3+C4+E4 - | F3+A3+C4 - | D3+F3+A3 - | E3+G#3+B3 -", gain: 0.07, maxLevel: 1 },
    // 긴장: 심장 박동 + 트레몰로 현
    { voice: "softKick", pattern: "x . x . . . . . x . x . . . . .", gain: 0.5, level: 1 },
    { voice: "strings", div: 8, pattern: "A3+E4 - | F3+C4 - | D3+A3 - | E3+B3 -", gain: 0.1, level: 1 },
    { voice: "tick", pattern: ". . x . . . x . . . x . . . x .", gain: 0.1, level: 1 },
  ],
  sfx: SFX,
};

export const getHideAndSeekSound = defineSuite(HIDE_AND_SEEK_SUITE);

/** 긴장 단계: 마지막 3턴이거나 숨은 사람이 1명 남았을 때 */
export function tensionOf(state: GameState): number {
  if (state.step !== "seek" || state.phase === "ended") return 0;
  const left = state.seats.filter((s) => s.status === "hiding").length;
  return state.seekTurns - state.turn <= 2 || left === 1 ? 1 : 0;
}

/** 판정 연출에 맞춘 효과음 예약표: [초, 이름, 인자] */
export function revealCues(events: TurnEvent[]): [number, string, number?][] {
  const out: [number, string, number?][] = [];
  const once = new Set<string>();
  const add = (t: number, name: string, arg?: number) => {
    const key = `${name}@${t}`;
    if (once.has(key)) return;
    once.add(key);
    out.push([t, name, arg]);
  };
  for (const e of events) {
    switch (e.t) {
      case "move":
        add(0, "step", 4);
        break;
      case "noise":
        add(T.noise, "creak");
        break;
      case "rustle":
        add(T.rustle, "rustle");
        break;
      case "flash":
        add(T.flash, "flash");
        break;
      case "bump":
        add(T.bump, "bump");
        break;
      case "home":
        add(T.home, "home");
        break;
      case "blocked":
        add(T.home, "blocked");
        break;
      case "search":
        add(T.search - 0.45, "search");
        add(T.search, e.found.length ? "found" : "miss");
        break;
      case "sense":
        add(T.sense, e.present ? "heartbeat" : "quiet");
        break;
      case "survive":
        add(T.reveal, "survive");
        break;
      case "sweep":
        add(T.reveal, "sweep");
        break;
    }
  }
  return out;
}

/* ── 구호 — 브라우저 음성, 효과음 음소거를 따른다 ─────────────────────── */

export function callOut(text: string, rate = 1.05, pitch = 1.1): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  if (isSfxEffectivelyMuted(useAudioSettingsStore.getState())) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ko-KR";
    u.rate = rate;
    u.pitch = pitch;
    u.volume = Math.min(1, useAudioSettingsStore.getState().sfxVolume ?? 0.7);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    /* 음성은 장식일 뿐 */
  }
}
