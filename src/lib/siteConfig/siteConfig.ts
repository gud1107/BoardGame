import { getSupabase } from "@/lib/supabase/client";

/**
 * Admin-controlled site settings that every visitor reads (public select
 * policies, see supabase/admin_suite.sql) and only site admins can change
 * (the `admin_set_*` RPCs, called from /admin/games). Best-effort: with no
 * Supabase or no tables yet, there's simply no notice and no overrides.
 */

export type NoticeLevel = "info" | "warning" | "maintenance";

export interface SiteNotice {
  enabled: boolean;
  message: string;
  level: NoticeLevel;
  updated_at: string;
}

export interface GameOverride {
  game_id: string;
  hidden: boolean;
  coming_soon: boolean;
  featured: boolean;
}

export async function fetchSiteNotice(): Promise<SiteNotice | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.from("site_notice").select("enabled, message, level, updated_at").eq("id", 1).maybeSingle();
    if (error || !data) return null;
    return data as SiteNotice;
  } catch {
    return null;
  }
}

export async function fetchGameOverrides(): Promise<Map<string, GameOverride>> {
  const map = new Map<string, GameOverride>();
  const supabase = getSupabase();
  if (!supabase) return map;
  try {
    const { data, error } = await supabase.from("game_overrides").select("game_id, hidden, coming_soon, featured");
    if (error || !data) return map;
    for (const row of data as GameOverride[]) map.set(row.game_id, row);
  } catch {
    // No overrides.
  }
  return map;
}

/**
 * Registry list as the lobby should show it: hidden games removed, 준비중
 * overrides made unplayable, and featured games flagged. Pure, so the
 * lobby's existing sort/filter pipeline runs on top unchanged.
 */
export function applyGameOverrides<T extends { id: string; playable: boolean }>(
  games: T[],
  overrides: ReadonlyMap<string, GameOverride>,
): (T & { featured?: boolean })[] {
  const out: (T & { featured?: boolean })[] = [];
  for (const g of games) {
    const o = overrides.get(g.id);
    if (!o) {
      out.push(g);
      continue;
    }
    if (o.hidden) continue;
    out.push({ ...g, playable: g.playable && !o.coming_soon, featured: o.featured });
  }
  return out;
}
