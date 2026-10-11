import { defineSuite, fx, INSTRUMENTS, type SfxRecipe, type SuiteConfig } from "@/lib/audio/proceduralSuite";
import type { CenterPlayEvent } from "./BangEffects";
import type { BangState } from "./engine";

/**
 * 뱅! "Dusty Saloon" suite — a honky-tonk ragtime upright in C major at
 * 132 BPM (stride left hand, swung right-hand tune, brushes on 2 and 4).
 * When only two gunslingers are left standing (intensity 1) a galloping
 * woodblock joins in. SFX ride the center play banner (one per revealed
 * card) plus the state diff (hits, dynamite, deaths, turn spurs, endings).
 */

const revolver = [
  { wave: "square" as const, freq: 1800, to: 800, glide: 0.03, dur: 0.035, peak: 0.14, filter: { type: "highpass" as const, freq: 900 } },
  ...fx.crack(0.08, 0.5),
];

const SFX = {
  bang: revolver,
  gatling: Array.from({ length: 6 }, (_, i) => fx.crack(i * 0.09, 0.32)).flat(),
  missed: [fx.click(2600, 0.12), { wave: "sine", freq: 2800, to: 700, glide: 0.35, dur: 0.38, peak: 0.12, attack: 0.002 }],
  duel: [{ inst: "whistle", note: "A5", dur: 0.35 }, { inst: "whistle", note: "E5", at: 0.38, dur: 0.6 }, { inst: "bell", note: "A3", at: 0.1, gain: 0.8 }],
  indians: [0, 0.14, 0.28, 0.42, 0.5].map((at, i) => ({ inst: "tom", note: i % 2 ? 1 : 0.8, at, gain: 1 })),
  heal: [...fx.coin(0, 3200, 0.1), ...fx.coin(0.08, 2800, 0.08), ...[0.2, 0.3, 0.4].map((at, i) => ({ wave: "sine" as const, freq: 300 - i * 30, to: 160, glide: 0.08, dur: 0.09, peak: 0.12, at }))],
  saloon: [...fx.arp("honkytonk", ["C5", "E5", "G5", "C6"], 0.07, 0.5), ...fx.coin(0.3, 3200, 0.08)],
  dynamite: [{ wave: "noise", dur: 0.9, peak: 0.08, attack: 0.05, tremolo: 22, filter: { type: "highpass", freq: 4000 } }, fx.click(1200, 0.12)],
  explosion: [{ wave: "noise", dur: 1.4, peak: 0.6, attack: 0.003, filter: { type: "lowpass", freq: 3000, to: 120 } }, fx.thud(90, 0.8, 0.7)],
  equip: [fx.click(1400, 0.14), ...fx.coin(0.05, 1300, 0.08)],
  mustang: [0, 0.12, 0.3, 0.42].map((at, i) => ({ inst: "woodblock", note: i % 2 ? 0.75 : 1, at })),
  jail: [{ wave: "square", freq: 140, to: 120, glide: 0.2, dur: 0.5, peak: 0.12, filter: { type: "lowpass", freq: 900 } }, { wave: "noise", dur: 0.3, peak: 0.12, filter: { type: "bandpass", freq: 2200, q: 2 } }, fx.click(600, 0.2, 0.32)],
  steal: [fx.whoosh(600, 3500, 0.22, 0.16), fx.click(2200, 0.1, 0.2)],
  draw: [fx.cardSlide(0), fx.cardSlide(0.1)],
  store: [...fx.arp("bell", ["E6", "C6"], 0.14, 0.8, 0.6)],
  plain: [fx.cardSlide(0, 0.14)],
  hit: [fx.thud(160, 0.22, 0.45), { wave: "noise", dur: 0.08, peak: 0.12, filter: { type: "lowpass", freq: 1200 } }],
  death: [{ wave: "sine", freq: 1400, to: 300, glide: 0.8, dur: 0.85, peak: 0.1 }, fx.thud(80, 0.5, 0.6, 0.85), ...fx.chord("honkytonk", ["C3", "Eb3", "Gb3"], 0.9, 0.8, 0.9)],
  turn: [{ wave: "noise", dur: 0.22, peak: 0.07, tremolo: 30, filter: { type: "highpass", freq: 6000 } }, ...fx.coin(0.04, 4200, 0.04)],
  lawWins: [...fx.arp("brass", ["C4", "E4", "G4", "C5"], 0.14, 0.4), ...fx.chord("brass", ["C4", "E4", "G4", "C5"], 1.6, 1.1, 0.56)],
  outlawWins: [...revolver, ...fx.crack(0.4, 0.4), ...fx.arp("honkytonk", ["A4", "C5", "E5", "A5"], 0.1, 0.8, 1).map((p) => ({ ...p, at: (p.at ?? 0) + 0.7 }))],
  renegadeWins: [{ inst: "whistle", note: "E5", dur: 0.5 }, { inst: "whistle", note: "B4", at: 0.5, dur: 0.5 }, { inst: "whistle", note: "E4", at: 1, dur: 1 }, { inst: "bell", note: "E3", at: 1 }],
} satisfies Record<string, SfxRecipe>;

type Cue = keyof typeof SFX;

export const BANG_SUITE: SuiteConfig = {
  bpm: 132,
  swing: 0.22,
  instruments: {
    honkytonk: [...INSTRUMENTS.piano, { wave: "triangle", detune: 22, dur: 0.9, peak: 0.1, attack: 0.003 }],
  },
  tracks: [
    { voice: "honkytonk", div: 4, pattern: "C3 . G2 . | F2 . C3 . | G2 . D3 . | C3 . G2 .", gain: 0.9 },
    {
      voice: "honkytonk",
      div: 4,
      pattern: ". C4+E4+G4 . C4+E4+G4 | . F3+A3+C4 . F3+A3+C4 | . G3+B3+F4 . G3+B3+F4 | . C4+E4+G4 . G3+B3+D4",
      gain: 0.55,
    },
    {
      voice: "honkytonk",
      div: 2,
      pattern: "E5 G5 E5 C5 D5 - C5 A4 | F5 A5 F5 C5 A4 - G4 . | B4 D5 G5 F5 D5 B4 G4 B4 | C5 - E5 - C5 - . .",
      gain: 0.75,
    },
    { voice: "brush", div: 4, pattern: ". x . x" },
    { voice: "woodblock", div: 2, pattern: "X x x X x x X x", gain: 0.5, level: 1 },
  ],
  sfx: SFX,
};

export const getBangSound = defineSuite(BANG_SUITE);

const WEAPONS = new Set<string>(["volcanic", "schofield", "remington", "rev-carbine", "winchester"]);

/** The sting for a revealed card in the center banner. */
export function bangCenterCue(e: CenterPlayEvent): Cue {
  switch (e.cardType) {
    case "gatling":
      return "gatling";
    case "indians":
      return "indians";
    case "saloon":
      return "saloon";
    case "beer":
      return "heal";
    case "mustang":
      return "mustang";
    case "jail":
      return "jail";
    case "panic":
    case "cat-balou":
      return "steal";
    case "stagecoach":
    case "wells-fargo":
      return "draw";
    case "general-store":
      return "store";
    case "dynamite":
      return "dynamite";
    case "barrel":
    case "scope":
      return "equip";
  }
  if (e.effect === "bang") return "bang";
  if (e.effect === "missed") return "missed";
  if (e.effect === "duel") return "duel";
  return WEAPONS.has(e.cardType) ? "equip" : "plain";
}

export function bangSoundCues(prev: BangState, next: BangState): Cue[] {
  if (prev === next) return [];
  if (!prev.winner && next.winner) return [next.winner === "law" ? "lawWins" : next.winner === "outlaw" ? "outlawWins" : "renegadeWins"];
  const cues: Cue[] = [];
  let worstLoss = 0;
  let died = false;
  next.players.forEach((p, i) => {
    const before = prev.players[i];
    if (!before) return;
    worstLoss = Math.max(worstLoss, before.life - p.life);
    if (before.alive && !p.alive) died = true;
  });
  if (worstLoss >= 3) cues.push("explosion");
  else if (worstLoss > 0) cues.push("hit");
  if (died) cues.push("death");
  if (prev.turnSeat !== next.turnSeat) cues.push("turn");
  const ps = prev.pending;
  const ns = next.pending;
  if (ps?.kind === "general-store" && ns?.kind === "general-store" && ns.nextPickIndex > ps.nextPickIndex) cues.push("plain");
  return cues;
}

export function bangIntensity(s: BangState): number {
  return s.players.filter((p) => p.alive).length <= 2 ? 1 : 0;
}
