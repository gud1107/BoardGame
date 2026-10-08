"use client";

/**
 * 낙서 결투 — remembered room-creation choices + "내 프리셋".
 *
 * Stored on this device (localStorage) and, for a signed-in user, on the
 * account as Supabase Auth `user_metadata.ink_duel` — the same no-table
 * pattern the theme toggle uses (src/contexts/ThemeContext.tsx). Whichever
 * copy was changed last wins (`t`). user_metadata rides in the session token,
 * so the payload is kept small: at most MAX_PRESETS presets, short names.
 */

import { getAuthSupabase } from "@/lib/supabase/authClient";
import { DEFAULT_STOP_RULES, MAX_PLAYERS, MIN_PLAYERS, sanitizeStopRules, type StopRules } from "./engine";
import type { GameMode } from "./LobbyPickers";
import { CHARACTER_COUNT, isMapId, type MapId } from "./maps";
import { DEFAULT_RT_RULES, sanitizeRules, type RtRules } from "./realtime";

export const MAX_PRESETS = 6;
export const PRESET_NAME_MAX = 16;
const STORAGE_KEY = "ink-duel-room-prefs-v1";
const META_KEY = "ink_duel";

export interface RoomPrefs {
  playerCount: number;
  character: number | null;
  map: MapId | "random";
  mode: GameMode;
  rtRules: RtRules;
  stopRules: StopRules;
}

/** A named combo the host saved: mode, map and both modes' settings. */
export interface MyPreset {
  id: string;
  name: string;
  mode: GameMode;
  map: MapId | "random";
  rtRules: RtRules;
  stopRules: StopRules;
}

export interface StoredPrefs {
  prefs: RoomPrefs;
  presets: MyPreset[];
  /** Last change time (ms) — the newer of device / account copy wins. */
  t: number;
}

export const DEFAULT_PREFS: RoomPrefs = { playerCount: 2, character: null, map: "random", mode: "stop", rtRules: DEFAULT_RT_RULES, stopRules: DEFAULT_STOP_RULES };

const EMPTY: StoredPrefs = { prefs: DEFAULT_PREFS, presets: [], t: 0 };

function sanitizePrefs(raw: unknown): RoomPrefs {
  const p = (raw ?? {}) as Partial<RoomPrefs>;
  return {
    playerCount: typeof p.playerCount === "number" ? Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.round(p.playerCount))) : 2,
    character: typeof p.character === "number" && Number.isInteger(p.character) && p.character >= 0 && p.character < CHARACTER_COUNT ? p.character : null,
    map: p.map === "random" || isMapId(p.map) ? p.map : "random",
    mode: p.mode === "moving" ? "moving" : "stop",
    rtRules: sanitizeRules(p.rtRules),
    stopRules: sanitizeStopRules(p.stopRules),
  };
}

function sanitizePreset(raw: unknown, i: number): MyPreset | null {
  const p = (raw ?? {}) as Partial<MyPreset>;
  const name = typeof p.name === "string" ? p.name.trim().slice(0, PRESET_NAME_MAX) : "";
  if (!name) return null;
  return {
    id: typeof p.id === "string" && p.id.length <= 24 ? p.id : `p${i}`,
    name,
    mode: p.mode === "moving" ? "moving" : "stop",
    map: p.map === "random" || isMapId(p.map) ? p.map : "random",
    rtRules: sanitizeRules(p.rtRules),
    stopRules: sanitizeStopRules(p.stopRules),
  };
}

/** Re-validates anything read back from storage or the account (it can be stale or edited). */
export function sanitizeStored(raw: unknown): StoredPrefs | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<StoredPrefs>;
  const presets = Array.isArray(r.presets) ? r.presets.map(sanitizePreset).filter((p): p is MyPreset => p !== null).slice(0, MAX_PRESETS) : [];
  return { prefs: sanitizePrefs(r.prefs), presets, t: typeof r.t === "number" && Number.isFinite(r.t) ? r.t : 0 };
}

export function loadStored(): { stored: StoredPrefs; saved: boolean } {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { stored: EMPTY, saved: false };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // v1 stored the bare RoomPrefs object (before presets / account sync).
    const stored = "prefs" in parsed ? sanitizeStored(parsed) : sanitizeStored({ prefs: parsed, presets: [], t: 0 });
    return stored ? { stored, saved: true } : { stored: EMPTY, saved: false };
  } catch {
    return { stored: EMPTY, saved: false };
  }
}

export function saveLocal(stored: StoredPrefs) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Private mode / blocked storage: just don't remember.
  }
}

const sameContent = (a: StoredPrefs, b: StoredPrefs) => JSON.stringify({ ...a, t: 0 }) === JSON.stringify({ ...b, t: 0 });

/** Copies the prefs to the signed-in account (no-op when signed out or unchanged). Best-effort. */
export async function pushToAccount(stored: StoredPrefs) {
  const supabase = getAuthSupabase();
  if (!supabase) return;
  try {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) return;
    const remote = sanitizeStored(user.user_metadata?.[META_KEY]);
    if (remote && sameContent(remote, stored)) return;
    await supabase.auth.updateUser({ data: { [META_KEY]: stored } });
  } catch {
    // Offline / auth disabled — the account keeps its older copy.
  }
}

/**
 * On sign-in / page load with a session: if the account's copy is newer, hand
 * it to `onRemote`; otherwise seed the account with this device's copy.
 * Reports whether someone is signed in. Returns an unsubscribe function.
 */
export function watchAccount(getLocal: () => StoredPrefs, onRemote: (s: StoredPrefs) => void, onSignedIn: (signedIn: boolean) => void): () => void {
  const supabase = getAuthSupabase();
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") onSignedIn(false);
    if ((event !== "INITIAL_SESSION" && event !== "SIGNED_IN") || !session?.user) return;
    const remote = sanitizeStored(session.user.user_metadata?.[META_KEY]);
    // Deferred: Supabase deadlocks if another auth call runs inside this callback.
    setTimeout(() => {
      onSignedIn(true);
      const local = getLocal();
      if (remote && remote.t > local.t) onRemote(remote);
      else if (local.t > 0) void pushToAccount(local);
    }, 0);
  });
  return () => data.subscription.unsubscribe();
}

export function newPresetId(): string {
  return `p${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}
