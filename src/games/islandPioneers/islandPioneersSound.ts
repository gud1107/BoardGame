import { defineSuite, fx, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { IslandState } from "./engine";
import { quadTerrain } from "./tiles";

/**
 * 섬 개척자 "Trade Winds" suite — a breezy island G major (4/4, 100 BPM):
 * kalimba and marimba over a steel-drum-ish pluck, a soft upright bass and a
 * shaker. Intensity 1 (the last 6 tiles of the game) adds a flute melody and a
 * light kick so the endgame is audible.
 *
 * SFX for every action: hover / pick a harbour tile, rotate, an illegal spot,
 * the tile thudding down (pitch by terrain under it), a pioneer flag planted,
 * the resource pickup, a region completed (bigger for mountains / lagoons),
 * a shared region, pioneers coming home, a quest achieved, a tile washed away,
 * your-turn chime, the last-10-seconds tick, the time-out, and the final fanfare.
 */

const SFX = {
  ui: [fx.click(1500, 0.08)],
  pick: [fx.pop(500, 1000, 0.16), fx.click(2400, 0.06, 0.05)],
  rotate: [fx.whoosh(1200, 2600, 0.12, 0.08), fx.click(1900, 0.08, 0.08)],
  invalid: [fx.buzz(240, 150, 0.18, 0.09)],
  place: (terrain: number) => [
    fx.thud(terrain === 3 ? 90 : terrain === 2 ? 150 : 120, 0.25, 0.4),
    terrain === 3 ? fx.whoosh(500, 1600, 0.35, 0.1, 0.03) : fx.click(terrain === 2 ? 900 : 1300, 0.12, 0.02),
  ],
  settler: [fx.pop(300, 700, 0.18), ...fx.arp("marimba", ["G5", "D6"], 0.06, 0.25, 0.7).map((p) => ({ ...p, at: (p.at ?? 0) + 0.05 }))],
  resource: [...fx.coin(0, 2600, 0.1), { inst: "kalimba", note: "B5", at: 0.04, dur: 0.3, gain: 0.7 }],
  complete: (big: number) =>
    big
      ? [...fx.arp("marimba", ["G4", "B4", "D5", "G5", "B5", "D6"], 0.06, 0.4, 0.8), ...fx.chord("bell", ["G5", "D6"], 1.2, 0.5, 0.36)]
      : fx.arp("kalimba", ["D5", "G5", "B5", "D6"], 0.07, 0.4, 0.8),
  shared: fx.arp("vibes", ["E5", "G5", "E5", "G5"], 0.08, 0.3, 0.6),
  homecoming: [fx.whoosh(2000, 700, 0.3, 0.07), { inst: "kalimba", note: "G4", at: 0.12, dur: 0.3, gain: 0.6 }],
  quest: [...fx.chord("brass", ["G4", "B4", "D5"], 0.45, 0.4), ...fx.arp("glock", ["D6", "G6", "B6"], 0.07, 0.4, 0.6).map((p) => ({ ...p, at: (p.at ?? 0) + 0.25 }))],
  washed: [fx.whoosh(400, 1800, 0.6, 0.14), fx.whoosh(1800, 300, 0.5, 0.08, 0.35)],
  myTurn: fx.arp("kalimba", ["G5", "B5", "D6"], 0.08, 0.35, 0.7),
  tick: [fx.click(2100, 0.1)],
  timeout: [fx.buzz(330, 200, 0.3, 0.1), fx.click(900, 0.08, 0.25)],
  victory: [...fx.arp("marimba", ["G4", "B4", "D5", "G5", "B5", "D6", "G6"], 0.08, 0.6, 0.9), ...fx.chord("bell", ["G5", "B5", "D6", "G6"], 2, 0.6, 0.6)],
} satisfies Record<string, SfxRecipe>;

export type IslandCue = keyof typeof SFX | { name: keyof typeof SFX; arg: number };

export const ISLAND_PIONEERS_SUITE: SuiteConfig = {
  bpm: 100,
  swing: 0.12,
  tracks: [
    {
      voice: "kalimba",
      div: 2,
      pattern: "G5 . B5 D6 . B5 A5 . | E5 . G5 B5 . A5 G5 . | C5 . E5 G5 . E5 D5 . | D5 . F#5 A5 . G5 F#5 .",
      gain: 0.45,
    },
    { voice: "marimba", div: 4, pattern: "G3+D4 B3+D4 | E3+B3 G3+B3 | C4+E4 G3+E4 | D4+F#4 A3+F#4", gain: 0.4 },
    { voice: "upright", div: 4, pattern: "G2 . D2 . | E2 . B1 . | C2 . G2 . | D2 . A2 .", gain: 0.75 },
    { voice: "shaker", div: 1, pattern: "x . x x x . x x x . x x x . X x", gain: 0.5 },
    { voice: "pad", div: 32, pattern: "G3+B3+D4 E3+G3+B3 C3+E3+G3 D3+F#3+A3", gain: 0.25 },
    { voice: "flute", div: 4, pattern: "B5 - D6 B5 | G5 - - . | E5 G5 A5 G5 | F#5 - - .", gain: 0.35, level: 1 },
    { voice: "softKick", div: 4, pattern: "x . x .", gain: 0.6, level: 1 },
  ],
  sfx: SFX,
};

export const getIslandPioneersSound = defineSuite(ISLAND_PIONEERS_SUITE);

/** BGM intensity: 1 in the last 6 tiles. */
export function islandIntensity(state: IslandState): number {
  return state.phase === "playing" && state.market.length + state.bag.length <= 6 ? 1 : 0;
}

/** Sounds for one engine step (all clients hear the same thing). */
export function islandSoundCues(prev: IslandState, next: IslandState): IslandCue[] {
  if (prev === next) return [];
  const cues: IslandCue[] = [];
  const ev = next.lastEvent;
  if (ev && ev.seq !== prev.lastEvent?.seq) {
    const p = next.board[ev.cell];
    // the tile's most common terrain colours the thud
    const counts = [0, 0, 0, 0];
    if (p) for (let d = 0; d < 4; d++) counts[quadTerrain(p.tile, p.rot, d)]++;
    const terrain = counts.indexOf(Math.max(...counts));
    cues.push({ name: "place", arg: terrain });
    if (ev.settler !== null) cues.push("settler");
    if (ev.picked >= 0) cues.push("resource");
    for (const r of ev.scored) {
      cues.push({ name: "complete", arg: r.terrain >= 2 || r.tiles >= 6 ? 1 : 0 });
      if (r.owners.length > 1) cues.push("shared");
    }
    if (ev.scored.length) cues.push("homecoming");
    if (ev.quests.length) cues.push("quest");
    if (ev.washed.length) cues.push("washed");
    if (ev.timeout) cues.push("timeout");
  }
  if (prev.phase === "playing" && next.phase === "gameOver") cues.push("victory");
  return cues;
}
