import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { SoundCue } from "@/lib/audio/useProceduralSuite";
import { isPassage } from "./data";
import type { GameState, LogEntry } from "./engine";

/**
 * 안개 저택 "Fog Manor Nocturne" suite (규칙서 §14) — C단조 72 BPM 느와르 저택.
 * 하프시코드 아르페지오 + 콘트라베이스 워킹 + 브러시 + 낮은 현 패드, 오르간이 네 마디마다 한 화음.
 * 새벽 직전 두 라운드(intensity 1)엔 팀파니 심장 박동과 합창, 플루트가 더해진다.
 *
 * 효과음은 기록(log)에 새로 붙은 항목마다 `fogCues`가 고른다 — 봇·다른 기기의 행동도 똑같이 들린다.
 * 버튼을 누르는 순간의 클릭·연필 소리는 보드가 직접 낸다.
 */

const SFX = {
  /** 삐걱이는 마루 위 발걸음 두 번 */
  step: [
    { wave: "noise", dur: 0.08, peak: 0.07, attack: 0.004, filter: { type: "lowpass", freq: 650 } },
    fx.thud(120, 0.1, 0.12),
    { wave: "noise", at: 0.24, dur: 0.08, peak: 0.06, attack: 0.004, filter: { type: "lowpass", freq: 600 } },
    fx.thud(105, 0.1, 0.1, 0.24),
    { wave: "triangle", freq: 340, to: 260, glide: 0.2, at: 0.1, dur: 0.22, peak: 0.03, attack: 0.04 },
  ],
  /** 비밀 통로 — 돌문이 갈리며 열린다 */
  passage: [
    { wave: "noise", dur: 0.9, peak: 0.12, attack: 0.15, filter: { type: "bandpass", freq: 240, to: 120, q: 2 } },
    { wave: "sawtooth", freq: 55, to: 48, glide: 0.8, dur: 0.9, peak: 0.08, attack: 0.1, filter: { type: "lowpass", freq: 300 } },
    fx.thud(70, 0.4, 0.35, 0.85),
  ],
  /** 심문 시작 — 의사봉 두 번 */
  gavel: [fx.thud(220, 0.12, 0.5), fx.click(900, 0.25, 0.005), fx.thud(220, 0.12, 0.45, 0.22), fx.click(900, 0.22, 0.225)],
  /** 공개 장수: arg = 0~3 */
  count: (n: number) =>
    n <= 0
      ? [fx.thud(90, 0.3, 0.35), { inst: "upright", note: "C2", at: 0.02, dur: 0.5, gain: 0.5 }]
      : [
          ...fx.chord("piano", ["C3", "Eb3", "G3"].slice(0, 1 + Math.min(2, n)), 0.9, 0.55),
          ...Array.from({ length: Math.min(3, n) }, (_, i) => ({ inst: "piano", note: ["G4", "Bb4", "D5"][i], at: 0.12 + i * 0.14, dur: 0.5, gain: 0.5 })),
        ],
  /** 내 카드를 보여 준다 — 카드 미끄러짐 + 속삭임 */
  show: [fx.cardSlide(0, 0.16), fx.cardSlide(0.06, 0.1), { wave: "noise", at: 0.05, dur: 0.35, peak: 0.04, attack: 0.1, filter: { type: "bandpass", freq: 3200, q: 2 } }],
  /** 카드를 받는다 — 뒤집기 + 차임 */
  receive: [fx.cardSlide(0, 0.14), fx.click(2600, 0.1, 0.1), ...fx.arp("musicbox", ["G5", "C6", "Eb6"], 0.07, 0.5, 0.5)],
  /** 남들 사이에서 카드가 몰래 오갔다 */
  secret: [fx.cardSlide(0, 0.09), { inst: "pizz", note: "G3", at: 0.08, dur: 0.2, gain: 0.35 }],
  /** 서랍·상자 뒤지기 */
  search: [
    { wave: "noise", dur: 0.12, peak: 0.1, attack: 0.01, filter: { type: "bandpass", freq: 1800, q: 1.5 } },
    { wave: "noise", at: 0.16, dur: 0.1, peak: 0.08, attack: 0.01, filter: { type: "bandpass", freq: 2400, q: 1.5 } },
    fx.click(700, 0.12, 0.3),
    { wave: "noise", at: 0.34, dur: 0.18, peak: 0.08, attack: 0.02, filter: { type: "bandpass", freq: 1200, q: 1 } },
  ],
  /** 단서 발견 (내가) — 오르골 */
  clue: [...fx.arp("musicbox", ["C6", "G5", "Eb6", "D6", "C6"], 0.09, 0.6, 0.55), { inst: "glock", note: "G6", at: 0.5, dur: 0.8, gain: 0.25 }],
  /** 괘종 단서 발견 (내가) */
  bellClue: [...fx.arp("musicbox", ["C6", "Eb6", "G6", "C7"], 0.08, 0.7, 0.6), ...fx.chord("choir", ["C4", "G4", "Eb5"], 1.2, 0.35, 0.2)],
  /** 빈 방 — 둔한 노크 */
  empty: [fx.thud(160, 0.15, 0.3), fx.thud(150, 0.15, 0.28, 0.2)],
  /** 괘종시계 */
  bell: [
    { inst: "bell", note: "C4", dur: 1.6, gain: 0.6 },
    { inst: "bell", note: "G3", at: 0.8, dur: 1.6, gain: 0.55 },
    { inst: "bell", note: "C4", at: 1.6, dur: 2, gain: 0.55 },
    { inst: "gong", note: "C2", at: 0, dur: 2.4, gain: 0.25 },
  ],
  /** 🗄️ 금고 카드 공개 */
  vault: [fx.click(1400, 0.15), fx.click(1100, 0.13, 0.08), { wave: "square", freq: 180, to: 120, glide: 0.2, at: 0.14, dur: 0.25, peak: 0.06, attack: 0.01, filter: { type: "lowpass", freq: 900 } }, ...fx.arp("vibes", ["Eb5", "G5"], 0.1, 0.6, 0.4)],
  /** 고발 — 오르갠 화음 + 북 롤 */
  accuse: [
    ...fx.chord("organ", ["C3", "G3", "C4", "Eb4"], 1.4, 0.55),
    ...Array.from({ length: 10 }, (_, i) => ({ inst: "snare", note: 0, at: 0.2 + i * 0.06, dur: 0.1, gain: 0.25 + i * 0.03 })),
    { inst: "timpani", note: "C2", at: 0.85, dur: 0.8, gain: 0.7 },
  ],
  /** 정답 고발 */
  correct: [
    ...fx.arp("brass", ["C4", "Eb4", "G4", "C5"], 0.09, 0.7, 0.55),
    ...fx.chord("strings", ["C4", "Eb4", "G4", "C5"], 2, 0.5, 0.4),
    { inst: "bell", note: "C6", at: 0.4, dur: 1.4, gain: 0.45 },
    { inst: "timpani", note: "C2", at: 0.36, dur: 1, gain: 0.6 },
  ],
  /** 틀린 고발 */
  wrong: [...fx.chord("organ", ["C3", "F#3", "B3"], 1.1, 0.55), fx.buzz(200, 90, 0.6, 0.16, 0.15), { inst: "timpani", note: "F#1", at: 0.1, dur: 0.9, gain: 0.6 }],
  /** 쉬기 */
  pass: [{ inst: "pizz", note: "C3", dur: 0.3, gain: 0.4 }, { inst: "pizz", note: "G2", at: 0.16, dur: 0.35, gain: 0.35 }],
  /** 내 차례 */
  myTurn: [{ inst: "glock", note: "G5", dur: 0.6, gain: 0.5 }, { inst: "glock", note: "C6", at: 0.12, dur: 0.8, gain: 0.45 }],
  /** 남이 나를 심문했다 — 카드 골라야 함 */
  summoned: [fx.pop(300, 600, 0.2), ...fx.arp("pizz", ["C4", "Eb4", "G4"], 0.07, 0.3, 0.5)],
  /** 시간 임박 째깍 */
  tick: [{ inst: "tick", note: 0, dur: 0.05, gain: 0.5 }],
  /** 새벽 — 하프 + 합창 */
  dawn: [...fx.arp("harp", ["C4", "G4", "C5", "Eb5", "G5", "C6"], 0.09, 1, 0.55), ...fx.chord("choir", ["C4", "G4", "Eb5"], 2.6, 0.45, 0.4)],
  /** 새벽 추리 제출 */
  sealed: [fx.cardSlide(0, 0.14), { wave: "noise", at: 0.12, dur: 0.12, peak: 0.08, attack: 0.01, filter: { type: "lowpass", freq: 900 } }, fx.thud(180, 0.14, 0.25, 0.16)],
  /** 노트 표시 — 연필 사각 */
  pencil: [{ wave: "noise", dur: 0.09, peak: 0.06, attack: 0.01, filter: { type: "bandpass", freq: 4200, to: 3000, q: 3 } }, { wave: "noise", at: 0.08, dur: 0.06, peak: 0.04, attack: 0.01, filter: { type: "bandpass", freq: 3600, q: 3 } }],
  /** 선택 클릭 */
  select: [fx.click(1700, 0.12)],
  /** 용의자가 불려 온다 */
  summon: [fx.whoosh(500, 1600, 0.35, 0.08), { inst: "strings", note: "G3", at: 0.05, dur: 0.4, gain: 0.25 }],
  /** 천둥 (라운드 시작 때 가끔) */
  thunder: [
    { wave: "noise", dur: 0.12, peak: 0.25, attack: 0.002, filter: { type: "highpass", freq: 1800 } },
    { wave: "noise", at: 0.05, dur: 2.2, peak: 0.22, attack: 0.25, filter: { type: "lowpass", freq: 420, to: 120 } },
    fx.thud(45, 1.4, 0.35, 0.15),
  ],
  /** 새 라운드 — 시계 초침 두 번 */
  round: [{ inst: "tick", note: 0, dur: 0.05, gain: 0.45 }, { inst: "tock", note: 0, at: 0.5, dur: 0.06, gain: 0.45 }],
  win: [
    ...fx.arp("harp", ["C4", "Eb4", "G4", "C5", "Eb5", "G5"], 0.08, 0.9, 0.6),
    ...fx.chord("brass", ["C4", "E4", "G4", "C5"], 2.2, 0.5, 0.5),
    { inst: "bell", note: "C6", at: 0.6, dur: 1.6, gain: 0.45 },
  ],
  lose: [{ inst: "strings", note: "G3", dur: 0.7, gain: 0.45 }, { inst: "strings", note: "Eb3", at: 0.6, dur: 0.7, gain: 0.45 }, { inst: "strings", note: "C3", at: 1.2, dur: 1.6, gain: 0.5 }, { inst: "organ", note: "C2", at: 1.2, dur: 1.6, gain: 0.3 }],
} satisfies Record<string, SfxRecipe>;

export const FOG_SUITE: SuiteConfig = {
  bpm: 72,
  swing: 0.12,
  tracks: [
    { voice: "harpsichord", div: 2, pattern: "C4 G4 Eb5 G4 C5 G4 Eb5 G4 | Ab3 Eb4 C5 Eb4 Ab4 Eb4 C5 Eb4 | F3 C4 Ab4 C4 F4 C4 Ab4 C4 | G3 D4 B4 D4 G4 D4 F4 D4", gain: 0.16 },
    { voice: "upright", div: 4, pattern: "C2 Eb2 G2 Bb2 | Ab1 C2 Eb2 G2 | F1 Ab1 C2 Eb2 | G1 B1 D2 F2", gain: 0.34 },
    { voice: "pad", div: 16, pattern: "C3+G3+Eb4 | Ab2+Eb3+C4 | F2+C3+Ab3 | G2+D3+B3", gain: 0.12 },
    { voice: "brush", pattern: "x . . x . . x . x . . x . . x .", gain: 0.06 },
    { voice: "organ", div: 16, pattern: "C3+G3 | . | . | G2+D3+B3", gain: 0.07 },
    { voice: "timpani", div: 4, pattern: "C2 . . C2 | Ab1 . . Ab1 | F1 . . F1 | G1 . G1 G1", gain: 0.24, level: 1 },
    { voice: "choir", div: 16, pattern: "G4+C5 | Eb4+Ab4 | C4+F4 | D4+G4", gain: 0.08, level: 1 },
    { voice: "flute", div: 4, pattern: "G5 - Eb5 . | C5 - - . | Ab4 - C5 . | B4 - - .", gain: 0.06, level: 1 },
  ],
  sfx: SFX,
};

export const getFogSound = defineSuite(FOG_SUITE);

/** 새로 붙은 기록 항목 → 효과음 (보는 사람 기준) */
export function cueFor(e: LogEntry, viewer: number, state: GameState): SoundCue[] {
  switch (e.kind) {
    case "move":
      return isPassage(e.from, e.to) || e.path.some((r, i) => isPassage(i === 0 ? e.from : e.path[i - 1], r)) ? ["passage"] : ["step"];
    case "ask": {
      const cues: SoundCue[] = ["gavel", "summon", { name: "count", arg: e.count }];
      if (e.count === 1) cues.push(e.seat === viewer ? "receive" : e.target === viewer ? "show" : "secret");
      return cues;
    }
    case "search": {
      if (e.seat !== viewer) return ["search"];
      const clue = state.clues[viewer]?.find((c) => c.id === e.clue);
      return ["search", clue?.bell ? "bellClue" : "clue"];
    }
    case "bell":
      return ["bell"];
    case "vault":
      return ["vault"];
    case "accuse":
      return ["accuse", e.correct ? "correct" : "wrong"];
    case "pass":
      return ["pass"];
    case "dawn":
      return ["dawn"];
    case "final":
      return [];
  }
  return [];
}

/** 상태 변화 → 효과음. 기록 차이 + 차례/응답 시작 + 보여 준 카드(2장 이상 고르기 결과) */
export function fogCues(viewer: number) {
  return (prev: GameState, next: GameState): SoundCue[] => {
    const cues: SoundCue[] = [];
    if (next.log.length > prev.log.length) for (const e of next.log.slice(prev.log.length)) cues.push(...cueFor(e, viewer, next));
    // 2장 이상에서 고른 카드가 정해짐 (같은 기록 항목의 shown이 채워짐)
    if (prev.pending && !next.pending) {
      const e = next.log[prev.pending.logIndex];
      if (e?.kind === "ask") cues.push(e.seat === viewer ? "receive" : e.target === viewer ? "show" : "secret");
    }
    if (next.phase === "turn" && next.turn === viewer && (prev.turn !== viewer || prev.phase !== "turn")) cues.push("myTurn");
    if (next.phase === "respond" && next.pending?.target === viewer && prev.phase !== "respond") cues.push("summoned");
    if (next.round !== prev.round && next.phase === "turn") {
      cues.push("round");
      // 폭풍우: 결정론적으로 세 라운드에 한 번쯤 천둥
      if ((next.round * 7 + next.caseNo) % 3 === 0) cues.push("thunder");
    }
    if (next.phase === "ended" && prev.phase !== "ended") cues.push(next.outcome?.winners.includes(viewer) ? "win" : "lose");
    return cues;
  };
}
