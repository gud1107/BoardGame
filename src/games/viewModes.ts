import type { GameId } from "./types";

/**
 * How each game is drawn — the 보드게임허브 🧊 3D / 🖼️ 2D filter reads this.
 * Classified from each game's board code on 2026-11-19:
 *
 * - `"3d"`   — 3D only from the player's side: no 2D switch (a few of these
 *              fall back to a 2D board only when the device has no WebGL).
 * - `"both"` — opens in 3D with a 🖼️ 2D toggle (shared `viewPref` toggle or
 *              the game's own 2D board).
 * - `"2d"`   — flat/2.5D board (Splendor Duel's 3D gem layer and LotR Duel's
 *              tilted map still count as 2D).
 *
 * `registry.test.ts` fails when a registry entry is missing here, so a new
 * game has to pick one.
 */
export type GameViewMode = "3d" | "both" | "2d";

export const GAME_VIEW_MODES: Record<GameId, GameViewMode> = {
  // 3D 전용 (1인칭/실시간 3D)
  "tagger-among-us": "3d",
  "hushed-ward": "3d",
  "mannequin-mall": "3d",
  "possession-night": "3d",
  "hide-and-seek": "3d",
  "morph-hide": "3d",
  "play-dead": "3d",
  "era-march": "3d",
  // 3D 전용 (WebGL 불가 기기만 2D 대체)
  alkkagi: "3d",
  "billiards-party": "3d",
  "bowling-mayhem": "3d",
  "mini-golf": "3d",
  "wobble-tower": "3d",
  "domino-chain": "3d",
  "word-tower": "3d",

  // 3D 기본 + 🖼️ 2D 전환
  avalon: "both",
  bang: "both",
  "cctv-alibi": "both",
  century: "both",
  "city-chase": "both",
  coup: "both",
  coyote: "both",
  curling: "both",
  dalmuti: "both",
  "destiny-war-39": "both",
  "five-cucumbers": "both",
  "fog-manor": "both",
  "for-sale": "both",
  "great-legacy": "both",
  "grid-poker": "both",
  hanamikoji: "both",
  "hill-of-truth": "both",
  "hundred-tales": "both",
  "hush-night": "both",
  "island-pioneers": "both",
  "lantern-keepers": "both",
  "las-vegas": "both",
  "liar-game": "both",
  "lost-cities": "both",
  "love-letter": "both",
  "love-wins-all": "both",
  mafia: "both",
  "mal-dalli-ja": "both",
  "mine-of-oblivion": "both",
  "mine-of-oblivion-2": "both",
  "no-thanks": "both",
  perudo: "both",
  qplay: "both",
  "rat-a-tat-cat": "both",
  "show-me-the-coin": "both",
  splendor: "both",
  "star-rummy": "both",
  "strange-corridor": "both",
  "summoners-rift": "both",
  telepathy: "both",
  "time-loop-heist": "both",
  chess: "both",
  "tavern-brawl": "both",
  "bluff-roulette": "both",
  "merge-defense": "both",
  "beat-mayhem": "both",
  "rope-climbers": "both",
  "bumper-arena": "both",
  "cargo-stack": "both",
  "snowball-fort": "both",
  "thin-ice-party": "both",
  "crumble-climb": "both",
  "noon-draw": "both",
  "crown-thief": "both",
  "finders-keepers": "both",
  "toy-room-race": "both",
  "parcel-panic": "both",

  // 2D
  "splendor-duel": "2d",
  "everyone-choice": "2d",
  "lotr-duel": "2d",
  worm: "2d",
  "lightning-pair": "2d",
  "hungry-shark": "2d",
  "crab-survival": "2d",
  "ink-duel": "2d",
  "doodle-phone": "2d",
  "spot-difference": "2d",
  "god-life-planner": "2d",
  "memory-feast": "2d",
  "pieces-of-language": "2d",
  "prism-five": "2d",
  "one-shot": "2d",
  "magic-shop": "2d",
  "cloud-squadron": "2d",
};

export type ViewFilter = "all" | "3d" | "2d";

/**
 * Lobby chips judge by the screen a game opens on: 🧊 3D = "3d" + "both"
 * (toggle games start in 3D), 🖼️ 2D = flat games only. Counting toggle
 * games under 2D too would make that chip show ~63 of 76 — no filter at all.
 */
export function matchesViewFilter(gameId: GameId, filter: ViewFilter): boolean {
  if (filter === "all") return true;
  const mode = GAME_VIEW_MODES[gameId];
  if (!mode) return false;
  return filter === "2d" ? mode === "2d" : mode !== "2d";
}

export const VIEW_FILTER_CHIPS: { value: ViewFilter; label: string; title: string }[] = [
  { value: "all", label: "2D·3D", title: "2D·3D 모두 보기" },
  { value: "3d", label: "🧊 3D", title: "3D로 열리는 게임 (대부분 🖼️ 2D로도 바꿀 수 있어요)" },
  { value: "2d", label: "🖼️ 2D", title: "평면 2D 게임" },
];
