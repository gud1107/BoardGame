import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { SoundCue } from "@/lib/audio/useProceduralSuite";
import type { GameState } from "./engine";

/**
 * 인생 상황극 "Curtain Up Shuffle" (규칙서 §11) — 공개 방송 콩트 무대의 하우스 밴드 느낌으로
 * 직접 쓴 112 BPM 셔플: 워킹 베이스 + 일렉트릭 피아노 컴핑 + 브러시. 결과 공개(강도 1) 때
 * 브라스 스탭과 라이드가 들어온다.
 */

const SFX = {
  /** 내 선택 확정 */
  pick: [fx.pop(420, 880, 0.2), { inst: "woodblock", note: "C5", at: 0.06, gain: 0.8 }],
  /** 다른 사람이 골랐다 */
  locked: [{ inst: "tick", note: "C6", gain: 0.35 }],
  /** 배역을 골랐다 */
  cast: [...fx.arp("vibes", ["C5", "E5", "G5"], 0.07, 0.4, 0.7)],
  /** 공개! — 두구두구 챙 */
  rimshot: [
    ...Array.from({ length: 6 }, (_, i) => ({ inst: "snare", note: "C3", at: i * 0.05, gain: 0.25 + i * 0.07 })),
    { inst: "kick", note: "C2", at: 0.34, gain: 0.9 },
    { inst: "openHat", note: "C6", at: 0.36, gain: 0.9 },
  ],
  /** 잘 풀렸다 */
  good: [...fx.arp("brass", ["G4", "B4", "D5", "G5"], 0.08, 0.35, 0.5).map((p) => ({ ...p, at: (p.at ?? 0) + 0.5 }))],
  /** 꼬였다 — 처지는 나팔 */
  bad: [
    { wave: "sawtooth", freq: 311, to: 294, glide: 0.25, dur: 0.3, peak: 0.07, at: 0.5, attack: 0.02, filter: { type: "lowpass", freq: 1400 } },
    { wave: "sawtooth", freq: 294, to: 262, glide: 0.25, dur: 0.3, peak: 0.07, at: 0.82, attack: 0.02, filter: { type: "lowpass", freq: 1300 } },
    { wave: "sawtooth", freq: 262, to: 196, glide: 0.7, dur: 0.9, peak: 0.08, at: 1.14, attack: 0.02, vibrato: { rate: 6, depth: 0.03 }, filter: { type: "lowpass", freq: 1100 } },
  ],
  /** 성격이 굳었다 */
  trait: [...fx.arp("glock", ["E6", "G#6", "B6"], 0.06, 0.5, 0.5).map((p) => ({ ...p, at: (p.at ?? 0) + 0.9 }))],
  /** 나비효과 */
  echo: [
    { inst: "timpani", note: "D2", at: 1.2, gain: 0.7 },
    { inst: "bell", note: "A4", at: 1.25, dur: 1.2, gain: 0.35 },
    fx.whoosh(500, 2600, 0.5, 0.05, 0.9),
  ],
  /** 박수 */
  clap: [0, 0.11, 0.2, 0.31, 0.4].map((at, i) => ({ inst: "clap", note: "C4", at, gain: 0.5 + (i % 2) * 0.2 })),
  /** 다음 장면 — 슬레이트 */
  slate: [{ inst: "woodblock", note: "G5", gain: 1 }, fx.click(2400, 0.2, 0.02), fx.whoosh(1800, 500, 0.3, 0.05, 0.05)],
  tick: [{ inst: "tick", note: "C6", gain: 0.6 }],
  /** 막이 내린다 */
  ending: [...fx.arp("brass", ["C4", "E4", "G4", "C5", "E5"], 0.11, 0.5, 0.55), ...fx.chord("strings", ["C3", "G3", "E4", "C5"], 2.4, 0.5, 0.6), { inst: "openHat", note: "C6", at: 0.6, gain: 0.7 }],
} satisfies Record<string, SfxRecipe>;

export const LIFE_SKIT_SUITE: SuiteConfig = {
  bpm: 112,
  swing: 0.22,
  tracks: [
    { voice: "upright", div: 4, pattern: "C2 E2 G2 A2 | F2 A2 C3 D3 | D2 F2 A2 C3 | G1 B1 D2 F2", gain: 0.32 },
    { voice: "epiano", div: 2, pattern: ". . E4+G4+B4 . . E4+G4+B4 . . | . . F4+A4+C5 . . F4+A4+C5 . . | . . F4+A4+C5 . . D4+F4+A4 . . | . . F4+B4+D5 . . F4+B4+D5 . F4+B4+D5", gain: 0.1 },
    { voice: "brush", pattern: "x . x x x . x x x . x x x . x x", gain: 0.05 },
    { voice: "rim", div: 4, pattern: ". x . x", gain: 0.12 },
    { voice: "vibes", div: 2, pattern: "G5 . E5 . . D5 E5 . | A5 . F5 . . . C5 . | F5 . D5 . . C5 D5 . | B4 . . D5 . G5 . .", gain: 0.09 },
    { voice: "brass", div: 2, pattern: ". . . . . . G4+B4 . | . . . . . . A4+C5 . | . . . . . . A4+C5 . | . . B4+D5 . B4+D5 . . .", gain: 0.08, level: 1 },
    { voice: "ride", div: 4, pattern: "x x x x", gain: 0.05, level: 1 },
  ],
  sfx: SFX,
};

export const getLifeSkitSound = defineSuite(LIFE_SKIT_SUITE);

/** BGM 강도: 결과 공개 중이면 1 */
export function lifeSkitIntensity(s: GameState): number {
  return s.phase === "reveal" ? 1 : 0;
}

export function lifeSkitCues(viewer: number) {
  return (prev: GameState, next: GameState): SoundCue[] => {
    const cues: SoundCue[] = [];
    if (prev.seed !== next.seed) return cues;
    if (prev.phase !== "ended" && next.phase === "ended") return ["ending"];
    if (prev.phase === "choose" && next.phase === "reveal") {
      cues.push("rimshot");
      const log = next.seats[viewer]?.log[next.scene];
      if (log) {
        const sum = log.fx.reduce((a, b) => a + b, 0);
        if (sum >= 2) cues.push("good");
        else if (sum <= -1) cues.push("bad");
        if (log.gained.length) cues.push("trait");
        if (log.echoes.length) cues.push("echo");
      }
      return cues;
    }
    if (next.phase === "choose" && (prev.phase === "reveal" || prev.phase === "cast")) return ["slate"];
    if (next.phase === "cast") {
      const was = prev.seats.filter((x) => x.role !== null).length;
      const now = next.seats.filter((x) => x.role !== null).length;
      if (now > was) cues.push("cast");
    } else if (next.phase === "choose" && prev.stage === next.stage) {
      const mine = prev.seats[viewer]?.pending === null && next.seats[viewer]?.pending !== null;
      const was = prev.seats.filter((x) => x.pending !== null).length;
      const now = next.seats.filter((x) => x.pending !== null).length;
      if (mine) cues.push("pick");
      else if (now > was) cues.push("locked");
    } else if (next.phase === "reveal" && prev.stage === next.stage) {
      const count = (s: GameState) => s.seats.reduce((n, x) => n + (x.log[s.scene]?.claps.length ?? 0), 0);
      if (count(next) > count(prev)) cues.push("clap");
    }
    return cues;
  };
}
