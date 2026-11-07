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
    }
  }
  if (tier > 0) cues.push({ name: "fire", arg: tier });
  for (const k of kinds) cues.push(k);
  if (next.phase === "ended" && prev.phase !== "ended") cues.push("victory");
  return cues;
}
