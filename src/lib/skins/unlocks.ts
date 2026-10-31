"use client";

import { useEffect, useState } from "react";
import type { StatTotalsRecord } from "@/lib/db/types";
import { GAME_REGISTRY } from "@/games/registry";
import { evaluateAchievements } from "@/lib/stats/achievements";
import { listPlayerStats, STATS_CHANGED_EVENT } from "@/lib/stats/playerStats";
import { CARD_BACK_SKINS, PLATE_SKINS, TABLE_SKINS, type UnlockId, type UnlockPrefix } from "./catalog";

/**
 * What earns a reward skin, read from the personal stat totals (/stats) — the
 * same synced numbers the 🏅 업적 tab uses, so an unlock follows the account.
 *
 * Games with a bot at the table never count toward "사람과 함께" plays/wins
 * (`noBot` slice), so those can't be farmed against easy bots. 1-player games
 * record every run as a bot-free 1st place, so they're kept out of every
 * play/win count and get their own 🧭 track instead; "게임 종류" and
 * achievements count everything.
 *
 * Client-side only: equipping a locked skin by editing localStorage is
 * possible and harmless (it's cosmetic), the picker just never offers it.
 */

export interface SkinProgress {
  /** Multiplayer matches, bots or not. */
  plays: number;
  humanPlays: number;
  humanWins: number;
  /** Distinct games finished at least once (solo included). */
  gamesPlayed: number;
  /** Distinct multiplayer games won at least once. */
  gamesWon: number;
  achievements: number;
  /** Wins at a table whose strongest lobby bot was Lv.8+ / Lv.10. */
  bot8Wins: number;
  bot10Wins: number;
  /** Most wins in any single multiplayer game. */
  mastery: number;
  /** Finished 1-player runs. */
  soloRuns: number;
}

export type RewardTier = "bronze" | "silver" | "gold" | "diamond" | "legend";

/** `color` on the dark theme, `lightColor` on white (silver/diamond pastels vanish there). */
export const TIERS: Record<RewardTier, { label: string; emoji: string; color: string; lightColor: string }> = {
  bronze: { label: "브론즈", emoji: "🥉", color: "#d6995a", lightColor: "#9a5b1e" },
  silver: { label: "실버", emoji: "🥈", color: "#cbd5e1", lightColor: "#64748b" },
  gold: { label: "골드", emoji: "🥇", color: "#fbbf24", lightColor: "#b7791f" },
  diamond: { label: "다이아", emoji: "💎", color: "#7dd3fc", lightColor: "#0369a1" },
  legend: { label: "레전드", emoji: "👑", color: "#f0abfc", lightColor: "#a21caf" },
};

/** CSS vars for `tierText` / `tierBorder` / `tierBg` classes. */
export function tierVars(tier: RewardTier): Record<string, string> {
  return { "--tier": TIERS[tier].color, "--tier-l": TIERS[tier].lightColor };
}
export const tierText = "text-[color:var(--tier)] light:text-[color:var(--tier-l)]";
export const tierBorder = "border-[color:var(--tier)] light:border-[color:var(--tier-l)]";
export const tierBg = "bg-[color:var(--tier)] light:bg-[color:var(--tier-l)]";

export const TIER_ORDER: readonly RewardTier[] = ["bronze", "silver", "gold", "diamond", "legend"];

/** How a goal's numbers are counted, said the way a player would read it. */
export const TRACKS: Record<keyof SkinProgress, { emoji: string; name: string; how: string }> = {
  plays: { emoji: "🎲", name: "판수", how: "여럿이 하는 게임을 끝까지 한 판 수. 봇과 한 판도 세요." },
  humanPlays: { emoji: "👥", name: "사람과 함께", how: "봇이 한 명도 없던 판만 세요. 중간에 봇이 대신 들어온 판도 빠져요." },
  humanWins: { emoji: "🏆", name: "사람과 함께 승리", how: "봇 없는 판에서 1등한 횟수예요." },
  gamesPlayed: { emoji: "🗺️", name: "게임 종류", how: "한 번이라도 끝까지 해 본 서로 다른 게임 수예요. 1인 게임도 세요." },
  gamesWon: { emoji: "🚩", name: "이긴 게임 종류", how: "1등을 한 번이라도 해 본 서로 다른 게임 수예요(봇 판 포함)." },
  achievements: { emoji: "🏅", name: "업적", how: "/stats 🏅 업적 탭에서 달성한 업적을 모든 게임 합쳐 세요." },
  bot8Wins: { emoji: "🤖", name: "강한 봇 격파", how: "Lv.8 이상 봇이 앉은 판에서 1등한 횟수예요." },
  bot10Wins: { emoji: "🦾", name: "최강 봇 격파", how: "Lv.10 봇이 앉은 판에서 1등한 횟수예요." },
  mastery: { emoji: "🎯", name: "한 게임 장인", how: "한 게임에서 쌓은 승리 수 중 가장 많은 것이에요." },
  soloRuns: { emoji: "🧭", name: "1인 도전", how: "배고픈 상어·게 생존 같은 1인 게임을 끝까지 한 판 수예요." },
};

export interface UnlockGoal {
  label: string;
  goal: number;
  of: keyof SkinProgress;
  tier: RewardTier;
}

const PREFIX: Record<keyof SkinProgress, UnlockPrefix> = {
  plays: "plays",
  humanPlays: "humanPlays",
  humanWins: "humanWins",
  gamesPlayed: "games",
  gamesWon: "gamesWon",
  achievements: "achv",
  bot8Wins: "bot8Wins",
  bot10Wins: "bot10Wins",
  mastery: "mastery",
  soloRuns: "solo",
};

const LABEL: Record<keyof SkinProgress, (n: number) => string> = {
  plays: (n) => `아무 게임 ${n}판`,
  humanPlays: (n) => `사람과 함께 ${n}판`,
  humanWins: (n) => `사람과 함께 ${n}승`,
  gamesPlayed: (n) => `서로 다른 게임 ${n}종 플레이`,
  gamesWon: (n) => `서로 다른 게임 ${n}종에서 승리`,
  achievements: (n) => `업적 ${n}개 달성`,
  bot8Wins: (n) => `Lv.8+ 봇 판에서 ${n}승`,
  bot10Wins: (n) => `Lv.10 봇 판에서 ${n}승`,
  mastery: (n) => `한 게임에서 ${n}승`,
  soloRuns: (n) => `1인 게임 ${n}판`,
};

const B = "bronze", S = "silver", G = "gold", D = "diamond", L = "legend";

/**
 * Every track is a tight ladder (2026-11-01 "갭을 촘촘하게"): early steps come
 * every few games so there's always a prize in reach. Id = prefix + goal, so the
 * first 25 goals (plays10, humanPlays5, …) kept their ids.
 */
const LADDERS: Record<keyof SkinProgress, readonly (readonly [number, RewardTier])[]> = {
  plays: [[3, B], [10, B], [20, B], [35, S], [50, S], [75, S], [100, G], [150, G], [200, D], [300, L]],
  humanPlays: [[1, B], [5, B], [10, S], [25, S], [50, G], [75, D], [100, L]],
  humanWins: [[1, B], [3, B], [5, S], [10, G], [20, D], [30, L], [50, L]],
  gamesPlayed: [[3, B], [5, B], [8, S], [12, S], [16, G], [20, G], [25, D], [30, D], [35, D], [40, L]],
  gamesWon: [[1, B], [3, S], [5, S], [10, G], [15, D], [20, L]],
  achievements: [[5, B], [10, B], [20, S], [30, G], [40, G], [60, D], [80, D], [100, L]],
  bot8Wins: [[1, B], [3, S], [6, S], [15, G], [25, D]],
  bot10Wins: [[1, S], [3, G], [5, G], [10, D], [20, L]],
  mastery: [[3, B], [5, S], [10, G], [20, D], [30, D], [50, L]],
  soloRuns: [[3, B], [10, B], [25, S], [50, S], [100, G]],
};

export const UNLOCKS: Record<UnlockId, UnlockGoal> = Object.fromEntries(
  (Object.keys(LADDERS) as (keyof SkinProgress)[]).flatMap((of) =>
    LADDERS[of].map(([goal, tier]) => [`${PREFIX[of]}${goal}`, { label: LABEL[of](goal), goal, of, tier }]),
  ),
) as Record<UnlockId, UnlockGoal>;

export interface RewardItem {
  kind: "back" | "table" | "plate";
  kindLabel: string;
  id: string;
  name: string;
  emoji: string;
}

/** Each unlock's prize, looked up from the catalog so the two never drift. */
export function rewardsFor(id: UnlockId): RewardItem[] {
  return [
    ...CARD_BACK_SKINS.filter((s) => s.unlock === id).map((s) => ({ kind: "back" as const, kindLabel: "카드 뒷면", id: s.id, name: s.name, emoji: s.emoji })),
    ...TABLE_SKINS.filter((s) => s.unlock === id).map((s) => ({ kind: "table" as const, kindLabel: "테이블", id: s.id, name: s.name, emoji: s.emoji })),
    ...PLATE_SKINS.filter((s) => s.unlock === id).map((s) => ({ kind: "plate" as const, kindLabel: "이름표", id: s.id, name: s.name, emoji: s.emoji })),
  ];
}

export const UNLOCK_IDS = Object.keys(UNLOCKS) as UnlockId[];

const SOLO_IDS = new Set(GAME_REGISTRY.filter((g) => g.players.max === 1).map((g) => g.id));

const EMPTY: SkinProgress = { plays: 0, humanPlays: 0, humanWins: 0, gamesPlayed: 0, gamesWon: 0, achievements: 0, bot8Wins: 0, bot10Wins: 0, mastery: 0, soloRuns: 0 };

export function progressFrom(totals: readonly StatTotalsRecord[]): SkinProgress {
  const p: SkinProgress = { ...EMPTY };
  for (const t of totals) {
    if (t.played > 0) p.gamesPlayed += 1;
    p.achievements += evaluateAchievements(t.gameId, t).filter((a) => a.unlocked).length;
    if (SOLO_IDS.has(t.gameId)) {
      p.soloRuns += t.played;
      continue;
    }
    p.plays += t.played;
    p.humanPlays += t.noBot?.played ?? 0;
    p.humanWins += t.noBot?.wins ?? 0;
    if (t.wins > 0) p.gamesWon += 1;
    p.mastery = Math.max(p.mastery, t.wins);
    const lv = (n: string) => t.byBotLevel?.[n]?.wins ?? 0;
    p.bot8Wins += lv("8") + lv("9") + lv("10");
    p.bot10Wins += lv("10");
  }
  return p;
}

export function isUnlocked(id: UnlockId | undefined, p: SkinProgress): boolean {
  if (!id) return true;
  const u = UNLOCKS[id];
  return p[u.of] >= u.goal;
}

/** Locked goals, closest to done first — what the 🎁 tracker suggests next. */
export function nextGoals(p: SkinProgress): UnlockId[] {
  const ratio = (id: UnlockId) => p[UNLOCKS[id].of] / UNLOCKS[id].goal;
  return UNLOCK_IDS.filter((id) => !isUnlocked(id, p)).sort((a, b) => ratio(b) - ratio(a) || UNLOCKS[a].goal - UNLOCKS[b].goal);
}

/** Live progress (re-read whenever a finished match or a sync changes the totals); `null` until the first read. */
export function useSkinProgressState(): SkinProgress | null {
  const [p, setP] = useState<SkinProgress | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => void listPlayerStats().then((t) => alive && setP(progressFrom(t)));
    load();
    window.addEventListener(STATS_CHANGED_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(STATS_CHANGED_EVENT, load);
    };
  }, []);
  return p;
}

export function useSkinProgress(): SkinProgress {
  return useSkinProgressState() ?? EMPTY;
}
