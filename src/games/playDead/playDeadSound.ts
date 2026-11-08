import { defineSuite, fx, type SfxPart, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import { surgeAt, type GameState } from "./engine";
import { SHOW } from "./show";

/**
 * 죽은척 대작전 "No Man's Land" suite — a tense E minor field march (4/4,
 * 100 BPM): a snare roll and taiko under a low string drone, a brass call
 * every other bar. 총공세 (surge, intensity 1) adds a driving tom line and a
 * higher string ostinato.
 *
 * SFX follow the reveal timeline in show.ts, so every recipe bakes its own
 * offset (`SHOW.act` for the action, `SHOW.impact` for hits, `SHOW.fall` for
 * bodies dropping) and plays in sync with the 3D show. Only public outcomes
 * make a sound — never the hidden damage value or who is secretly alive.
 */

const at = <T extends SfxPart>(parts: T[], offset: number): T[] => parts.map((p) => ({ ...p, at: (p.at ?? 0) + offset }));

const SFX = {
  commit: [fx.click(1300, 0.12)],
  chant: [fx.click(900, 0.16, 0), fx.click(900, 0.16, 0.5), fx.click(1400, 0.2, 1.0), fx.thud(90, 0.3, 0.35, 1.0)],
  /** arg = highest fire tier this round (1 사격 · 2 연사 · 3 수류탄). */
  fire: (tier: number) =>
    tier >= 3
      ? [fx.whoosh(300, 1200, 0.5, 0.1, SHOW.act), fx.thud(60, 0.7, 0.7, SHOW.impact), ...fx.crack(SHOW.impact, 0.5)]
      : tier === 2
        ? [0, 0.09, 0.18].flatMap((d) => fx.crack(SHOW.act + 0.3 + d, 0.32))
        : fx.crack(SHOW.act + 0.3, 0.4),
  hit: [fx.thud(160, 0.18, 0.4, SHOW.impact), fx.click(2600, 0.1, SHOW.impact + 0.02)],
  blocked: [fx.pop(2400, 3800, 0.12, SHOW.impact), fx.click(3200, 0.1, SHOW.impact + 0.05)],
  clash: [...fx.crack(SHOW.impact - 0.2, 0.3), fx.pop(1800, 600, 0.15, SHOW.impact)],
  reload: [fx.click(1100, 0.14, SHOW.act + 0.2), fx.click(1700, 0.16, SHOW.act + 0.35)],
  cover: [fx.thud(220, 0.15, 0.3, SHOW.act + 0.1), fx.whoosh(600, 300, 0.2, 0.06, SHOW.act)],
  loot: [fx.cardSlide(SHOW.act + 0.2, 0.1), fx.cardSlide(SHOW.act + 0.35, 0.08), ...fx.coin(SHOW.impact, 1900, 0.08)],
  finish: [fx.whoosh(2500, 5000, 0.18, 0.12, SHOW.act + 0.3), fx.thud(120, 0.2, 0.4, SHOW.impact)],
  ambush: [fx.whoosh(400, 2000, 0.3, 0.12, SHOW.act), ...fx.crack(SHOW.act + 0.4, 0.4)],
  rise: [fx.whoosh(300, 900, 0.3, 0.07, SHOW.act)],
  fall: [fx.thud(80, 0.45, 0.55, SHOW.fall)],
  surge: [...fx.chord("brass", ["E3", "B3", "E4"], 1.1, 0.8), fx.thud(55, 0.8, 0.5)],
  // 🧬 증강 — 보급 무전(카드가 뜸) → 상자 걸쇠(내가 고름) → 나팔(모두 공개)
  /** arg = tier 1 실버 · 2 골드 · 3 프리즘: 무전 잡음 뒤 나팔 음이 등급만큼 길고 밝아진다. */
  augOffer: (tier: number) => [
    fx.buzz(1900, 1300, 0.14, 0.05),
    fx.click(2400, 0.1, 0.02),
    fx.click(2400, 0.1, 0.1),
    ...at(fx.arp("brass", tier >= 3 ? ["E4", "G4", "B4", "E5"] : tier === 2 ? ["E4", "G4", "B4"] : ["E4", "B4"], 0.1, 0.45, 0.7), 0.22),
    ...(tier >= 3 ? fx.chord("strings", ["E5", "B5"], 1.1, 0.45, 0.6) : []),
  ],
  augPick: [fx.thud(110, 0.25, 0.5), fx.click(2200, 0.14, 0.08), fx.click(1500, 0.12, 0.16), ...fx.chord("brass", ["B3", "E4"], 0.5, 0.55, 0.2)],
  augReroll: [fx.cardSlide(0, 0.12), fx.cardSlide(0.08, 0.1), fx.cardSlide(0.16, 0.08), fx.whoosh(500, 1500, 0.2, 0.07, 0.05)],
  augReveal: [fx.thud(70, 0.4, 0.45), ...fx.chord("brass", ["E3", "B3", "G4"], 0.9, 0.7, 0.05)],
  /** 부비트랩: 인계철선 "팅" → 폭발 */
  augTrap: [fx.click(3200, 0.12, SHOW.impact + 0.05), fx.thud(55, 0.6, 0.7, SHOW.impact + 0.25), ...fx.crack(SHOW.impact + 0.25, 0.45)],
  /** 카운터 저격: 먼 곳에서 날아오는 한 발 */
  augCounter: [fx.whoosh(5000, 2500, 0.15, 0.1, SHOW.impact + 0.05), ...fx.crack(SHOW.impact + 0.15, 0.5)],
  /** 파편 수류탄: 수류탄 폭발 뒤 사방으로 튀는 파편 */
  augFrag: [0, 0.05, 0.11, 0.18].map((d) => fx.pop(3200, 1400, 0.09, SHOW.impact + 0.2 + d)),
  // 💓 치료 시도(공개) — 결과와 상관없이 같은 소리
  /** 붕대: 천 찢는 소리 두 번 */
  bandage: [fx.whoosh(5200, 2600, 0.16, 0.1, SHOW.fall + 0.4), fx.whoosh(4800, 2200, 0.2, 0.09, SHOW.fall + 0.6)],
  /** 구급상자: 낙하산 바람 → 털썩 → 맑은 차임 */
  medkit: [fx.whoosh(900, 300, 1.1, 0.08, SHOW.fall + 0.1), fx.thud(130, 0.3, 0.5, SHOW.fall + 1.25), ...fx.arp("bell", ["E5", "B5"], 0.08, 0.6, 0.5).map((q) => ({ ...q, at: (q.at ?? 0) + SHOW.fall + 1.3 }))],
  // ☠ 내 화면 전용(보드가 직접 낸다): 심장 두 번 → 길게 삐— (심정지)
  myDeath: [
    fx.thud(70, 0.5, 0.9),
    ...fx.crack(0, 0.35),
    fx.thud(55, 0.22, 0.7, 0.35),
    fx.thud(50, 0.22, 0.55, 0.62),
    { wave: "sine", freq: 988, dur: 0.12, peak: 0.16, at: 1.0 },
    { wave: "sine", freq: 988, dur: 2.2, peak: 0.16, at: 1.45 },
    ...fx.chord("strings", ["E2", "B2", "G3"], 2.4, 0.6, 1.4),
  ],
  /** 💓 소생: 멈췄던 심장이 다시 쿵쿵 → 밝은 나팔 */
  myRevive: [fx.thud(60, 0.2, 0.75), fx.thud(55, 0.2, 0.6, 0.25), fx.thud(60, 0.2, 0.8, 0.8), fx.thud(55, 0.2, 0.65, 1.05), ...at(fx.arp("brass", ["E4", "G#4", "B4", "E5"], 0.1, 0.6, 0.7), 1.3)],
  victory: at([...fx.arp("brass", ["E3", "G3", "B3", "E4"], 0.12, 0.6), ...fx.chord("brass", ["E3", "G#3", "B3", "E4"], 1.8, 0.8, 0.5)], SHOW.end),
} satisfies Record<string, SfxRecipe>;

type Cue = keyof typeof SFX | { name: keyof typeof SFX; arg: number };

export const PLAY_DEAD_SUITE: SuiteConfig = {
  bpm: 100,
  tracks: [
    { voice: "snare", div: 1, pattern: "X . x x . . x . X . x x . x x x", gain: 0.45 },
    { voice: "taiko", div: 4, pattern: "X . x .", gain: 0.7 },
    { voice: "strings", div: 32, pattern: "E2+B2 C3+G3 D3+A3 B2+F#3", gain: 0.45 },
    { voice: "brass", div: 4, pattern: "E3 - G3 B3 | . . . . | D3 - F#3 A3 | . . . .", gain: 0.35 },
    { voice: "tom", div: 2, pattern: "x . x x x . X .", gain: 0.6, level: 1 },
    { voice: "strings", div: 2, pattern: "E4 B3 E4 G4 | F#4 B3 F#4 A4", gain: 0.3, level: 1 },
  ],
  sfx: SFX,
};

export const getPlayDeadSound = defineSuite(PLAY_DEAD_SUITE);

/** BGM intensity: 1 once 총공세 has started. */
export function playDeadIntensity(state: GameState): number {
  return surgeAt(state.round) > 0 ? 1 : 0;
}

const showing = (s: GameState) => s.phase === "resolved" || s.phase === "ended";

export function playDeadSoundCues(prev: GameState, next: GameState): Cue[] {
  if (prev === next) return [];
  const cues: Cue[] = [];
  // The last commit flips the phase to "revealing" in the same update, so gate on prev's phase.
  const committed = (s: GameState) => s.commits.filter((c) => c !== null && c !== "x").length;
  // 🧬 증강: 누가 골랐다는 것만 딸깍(무엇을 골랐는지는 공개 전까지 소리로도 안 샌다), 다 고르면 공개 나팔.
  // 카드가 뜨는 소리와 내 선택·다시 뽑기는 보드가 직접 낸다(첫 판 시작 화면엔 이전 상태가 없어서).
  const picked = (s: GameState) => (s.phase === "augment" && s.aug ? s.aug.done.filter(Boolean).length : 0);
  if (prev.phase === "augment" && next.phase === "augment" && prev.round === next.round && picked(next) > picked(prev)) cues.push("commit");
  if (prev.phase === "augment" && next.phase !== "augment") cues.push("augReveal");
  if (prev.phase === "choosing" && prev.round === next.round && committed(next) > committed(prev)) cues.push("commit");
  if (next.phase === "choosing") {
    if (next.round !== prev.round && surgeAt(next.round) > surgeAt(prev.round)) cues.push("surge");
    return cues;
  }
  if (!showing(next) || (showing(prev) && prev.stage === next.stage)) return cues;

  // A fresh reveal: one cue per kind of public outcome, so six seats don't stack into noise.
  cues.push("chant");
  const kinds = new Set<keyof typeof SFX>();
  let tier = 0;
  for (const ev of next.events) {
    switch (ev.t) {
      case "blast":
        tier = Math.max(tier, ev.tier);
        if (ev.result === "blocked") kinds.add("blocked");
        else if (ev.result === "clash" || ev.result === "overpowered") kinds.add("clash");
        else kinds.add("hit");
        break;
      case "ambush":
        kinds.add("ambush");
        kinds.add(ev.result === "blocked" ? "blocked" : "hit");
        break;
      case "reload":
      case "cover":
      case "loot":
      case "finish":
      case "rise":
        kinds.add(ev.t);
        break;
      case "fall":
        if (ev.seats.length > 0) kinds.add("fall");
        break;
      case "aug":
        kinds.add(ev.id === "tripwire" ? "augTrap" : ev.id === "counterSniper" ? "augCounter" : "augFrag");
        break;
      case "heal":
        kinds.add(ev.source);
        break;
    }
  }
  if (tier > 0) cues.push({ name: "fire", arg: tier });
  for (const k of kinds) cues.push(k);
  if (next.phase === "ended" && prev.phase !== "ended") cues.push("victory");
  return cues;
}
