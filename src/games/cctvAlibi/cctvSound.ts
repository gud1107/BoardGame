import { defineSuite, fx, type SfxPart, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { SoundCue } from "@/lib/audio/useProceduralSuite";
import type { GameState, LogEntry } from "./engine";

/**
 * CCTV 알리바이 "Night Tape" suite (규칙서 §12) — A단조 84 BPM 감시실 느와르.
 * 비브라폰 리프 + 업라이트 베이스 + 브러시 + 낮은 패드, 테이프 잡음(crackle)이 깔린다.
 * 투표 단계(intensity 1)엔 팀파니 심장 박동과 현이 더해진다.
 *
 * 효과음은 기록(log)에 새로 붙은 항목마다 `cctvCues`가 고른다 — 봇·다른 기기의 행동도 똑같이 들린다.
 */

const later = (parts: SfxPart[], at: number): SfxPart[] => parts.map((p) => ({ ...p, at: (p.at ?? 0) + at }));

const SFX = {
  /** 동선 한 칸 — 발걸음 */
  step: [{ wave: "noise", dur: 0.07, peak: 0.07, attack: 0.004, filter: { type: "lowpass", freq: 700 } }, fx.thud(130, 0.09, 0.12)],
  /** 되돌리기 */
  undo: [fx.pop(520, 300, 0.12)],
  /** 금고실 — 다이얼 + 철문 */
  vault: [fx.click(1500, 0.14), fx.click(1250, 0.12, 0.09), fx.click(1700, 0.12, 0.18), fx.thud(70, 0.45, 0.35, 0.3), { inst: "glock", note: "E6", at: 0.34, dur: 0.7, gain: 0.3 }],
  /** 영상 조작 — 테이프 되감기 */
  forge: [
    { wave: "sawtooth", freq: 300, to: 1400, glide: 0.35, dur: 0.4, peak: 0.06, attack: 0.02, filter: { type: "bandpass", freq: 1800, q: 2 } },
    { wave: "noise", at: 0.05, dur: 0.4, peak: 0.05, attack: 0.05, filter: { type: "highpass", freq: 2500 } },
    fx.click(900, 0.14, 0.42),
  ],
  /** 계획 제출 — 도장 */
  submit: [fx.cardSlide(0, 0.12), fx.thud(180, 0.14, 0.3, 0.12)],
  /** 밤이 끝나고 영상 공개 — 모니터 켜짐 */
  tape: [
    { wave: "noise", dur: 0.5, peak: 0.1, attack: 0.02, filter: { type: "bandpass", freq: 3000, to: 900, q: 1 } },
    { wave: "sine", freq: 15000, to: 9000, glide: 0.4, dur: 0.45, peak: 0.02, attack: 0.01 },
    ...later(fx.arp("vibes", ["A4", "C5", "E5"], 0.1, 0.7, 0.4), 0.4),
  ],
  /** 재생 한 시각 — 초침 */
  scrub: [{ inst: "tick", note: 1, dur: 0.05, gain: 0.35 }],
  /** 센서 대조 시작 — 스캔 */
  scan: [{ wave: "sine", freq: 500, to: 1600, glide: 0.3, dur: 0.32, peak: 0.08, attack: 0.02 }, fx.click(2200, 0.1, 0.32)],
  /** 일치 */
  match: [{ inst: "vibes", note: "E5", dur: 0.4, gain: 0.4 }, { inst: "vibes", note: "A5", at: 0.1, dur: 0.6, gain: 0.35 }],
  /** 불일치 — 경보 */
  alarm: [
    fx.buzz(520, 520, 0.16, 0.14),
    fx.buzz(390, 390, 0.16, 0.14, 0.2),
    fx.buzz(520, 520, 0.16, 0.14, 0.4),
    { inst: "timpani", note: "A1", at: 0.02, dur: 0.9, gain: 0.55 },
  ],
  /** 증언 — 의사봉 */
  gavel: [fx.thud(220, 0.12, 0.5), fx.click(900, 0.25, 0.005), fx.thud(220, 0.12, 0.45, 0.22), fx.click(900, 0.22, 0.225)],
  /** 내가 지목당했다 */
  accused: [...fx.chord("organ", ["A2", "Eb3", "A3"], 0.9, 0.5), fx.thud(80, 0.4, 0.3)],
  /** 넘기기 */
  pass: [{ inst: "pizz", note: "A2", dur: 0.3, gain: 0.4 }, { inst: "pizz", note: "E2", at: 0.16, dur: 0.35, gain: 0.35 }],
  /** 내 차례 */
  myTurn: [{ inst: "glock", note: "E5", dur: 0.6, gain: 0.5 }, { inst: "glock", note: "A5", at: 0.12, dur: 0.8, gain: 0.45 }],
  /** 투표 시작 */
  voteOpen: [...fx.chord("strings", ["A3", "E4", "A4"], 1.4, 0.4), { inst: "timpani", note: "A1", dur: 0.9, gain: 0.5 }],
  /** 표를 넣는다 */
  ballot: [fx.cardSlide(0, 0.14), fx.thud(160, 0.12, 0.22, 0.14)],
  /** 검거 — 수갑 + 금관 */
  caught: [
    fx.click(1800, 0.2),
    fx.click(1400, 0.2, 0.09),
    ...later(fx.arp("brass", ["A3", "C4", "E4", "A4"], 0.09, 0.7, 0.55), 0.2),
    ...fx.chord("strings", ["A3", "C#4", "E4", "A4"], 1.8, 0.45, 0.55),
    { inst: "bell", note: "A5", at: 0.6, dur: 1.4, gain: 0.4 },
  ],
  /** 도주 — 빠져나가는 발소리 + 불협 */
  escaped: [
    fx.whoosh(1600, 300, 0.6, 0.1),
    ...fx.chord("organ", ["A2", "Eb3", "Bb3"], 1.2, 0.5, 0.1),
    { inst: "timpani", note: "Eb1", at: 0.15, dur: 1, gain: 0.55 },
  ],
  /** 시간 임박 */
  tick: [{ inst: "tick", note: 1, dur: 0.05, gain: 0.5 }],
  /** 선택 클릭 */
  select: [fx.click(1700, 0.12)],
  win: [
    ...fx.arp("vibes", ["A4", "C5", "E5", "A5", "C6", "E6"], 0.08, 0.9, 0.55),
    ...fx.chord("brass", ["A3", "C#4", "E4", "A4"], 2, 0.5, 0.5),
    { inst: "bell", note: "A5", at: 0.6, dur: 1.6, gain: 0.4 },
  ],
  lose: [{ inst: "strings", note: "E4", dur: 0.7, gain: 0.45 }, { inst: "strings", note: "C4", at: 0.6, dur: 0.7, gain: 0.45 }, { inst: "strings", note: "A3", at: 1.2, dur: 1.6, gain: 0.5 }],
} satisfies Record<string, SfxRecipe>;

export const CCTV_SUITE: SuiteConfig = {
  bpm: 84,
  swing: 0.16,
  tracks: [
    { voice: "vibes", div: 2, pattern: "A4 . E5 . C5 . E5 A4 | G4 . D5 . B4 . D5 G4 | F4 . C5 . A4 . C5 F4 | E4 . B4 . G#4 . B4 E5", gain: 0.13 },
    { voice: "upright", div: 4, pattern: "A1 C2 E2 G2 | G1 B1 D2 F2 | F1 A1 C2 E2 | E1 G#1 B1 D2", gain: 0.32 },
    { voice: "pad", div: 16, pattern: "A2+E3+C4 | G2+D3+B3 | F2+C3+A3 | E2+B2+G#3", gain: 0.11 },
    { voice: "brush", pattern: "x . . x . . x . x . . x . x x .", gain: 0.055 },
    { voice: "crackle", pattern: "x . . . . . x . . . x . . . . .", gain: 0.03 },
    { voice: "timpani", div: 4, pattern: "A1 . . A1 | G1 . . G1 | F1 . . F1 | E1 . E1 E1", gain: 0.22, level: 1 },
    { voice: "strings", div: 16, pattern: "E4+A4 | D4+G4 | C4+F4 | B3+E4", gain: 0.07, level: 1 },
  ],
  sfx: SFX,
};

export const getCctvSound = defineSuite(CCTV_SUITE);

/** 새로 붙은 기록 항목 → 효과음 (보는 사람 기준) */
export function cueFor(e: LogEntry, viewer: number): SoundCue[] {
  switch (e.kind) {
    case "night":
      return ["tape"];
    case "check":
      return ["scan", e.truth !== e.footage ? "alarm" : "match"];
    case "testify":
      return e.target === viewer ? ["gavel", "accused"] : ["gavel"];
    case "pass":
      return ["pass"];
    case "verdict":
      return [e.caught ? "caught" : "escaped"];
  }
}

/** 상태 변화 → 효과음 */
export function cctvCues(viewer: number) {
  return (prev: GameState, next: GameState): SoundCue[] => {
    const cues: SoundCue[] = [];
    if (next.log.length > prev.log.length) for (const e of next.log.slice(prev.log.length)) cues.push(...cueFor(e, viewer));
    if (next.phase === "investigate" && next.turn === viewer && (prev.turn !== viewer || prev.phase !== "investigate")) cues.push("myTurn");
    if (next.phase === "vote" && prev.phase !== "vote") cues.push("voteOpen");
    if (next.phase === "ended" && prev.phase !== "ended") cues.push(next.outcome?.winners.includes(viewer) ? "win" : "lose");
    return cues;
  };
}
