"use client";

import { useEffect, useState } from "react";
import type { StatTotalsRecord } from "@/lib/db/types";
import { evaluateAchievements } from "@/lib/stats/achievements";
import { listPlayerStats, STATS_CHANGED_EVENT } from "@/lib/stats/playerStats";
import type { UnlockId } from "./catalog";

/**
 * What earns a reward skin, read from the personal stat totals (/stats) — the
 * same synced numbers the 🏅 업적 tab uses, so an unlock follows the account.
 *
 * Games with a bot at the table never count toward plays/wins (`noBot` slice),
 * so a reward can't be farmed against easy bots; "게임 종류" and achievements
 * count everything, since neither is cheap to grind.
 *
 * Client-side only: equipping a locked skin by editing localStorage is
 * possible and harmless (it's cosmetic), the picker just never offers it.
 */

export interface SkinProgress {
  humanPlays: number;
  humanWins: number;
  gamesPlayed: number;
  achievements: number;
}

export const UNLOCKS: Record<UnlockId, { label: string; goal: number; of: keyof SkinProgress }> = {
  humanPlays5: { label: "사람과 함께 5판", goal: 5, of: "humanPlays" },
  games8: { label: "서로 다른 게임 8종 플레이", goal: 8, of: "gamesPlayed" },
  humanWins10: { label: "사람과 함께 10승", goal: 10, of: "humanWins" },
  achv20: { label: "업적 20개 달성", goal: 20, of: "achievements" },
  achv40: { label: "업적 40개 달성", goal: 40, of: "achievements" },
  humanWins30: { label: "사람과 함께 30승", goal: 30, of: "humanWins" },
};

export function progressFrom(totals: readonly StatTotalsRecord[]): SkinProgress {
  const p: SkinProgress = { humanPlays: 0, humanWins: 0, gamesPlayed: 0, achievements: 0 };
  for (const t of totals) {
    p.humanPlays += t.noBot?.played ?? 0;
    p.humanWins += t.noBot?.wins ?? 0;
    if (t.played > 0) p.gamesPlayed += 1;
    p.achievements += evaluateAchievements(t.gameId, t).filter((a) => a.unlocked).length;
  }
  return p;
}

export function isUnlocked(id: UnlockId | undefined, p: SkinProgress): boolean {
  if (!id) return true;
  const u = UNLOCKS[id];
  return p[u.of] >= u.goal;
}

/** Live progress (re-read whenever a finished match or a sync changes the totals). */
export function useSkinProgress(): SkinProgress {
  const [p, setP] = useState<SkinProgress>({ humanPlays: 0, humanWins: 0, gamesPlayed: 0, achievements: 0 });
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
