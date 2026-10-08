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
  /** Player count to open the room with (applied on the create form only). */
  playerCount?: number;
  /** My character (personal — never included in a shared code). */
  character?: number | null;
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
    ...(typeof p.playerCount === "number" ? { playerCount: Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.round(p.playerCount))) } : {}),
    ...(typeof p.character === "number" && Number.isInteger(p.character) && p.character >= 0 && p.character < CHARACTER_COUNT ? { character: p.character } : {}),
  };
}

// --- Sharing: a preset as a short URL-safe code (character left out — it's personal). ---

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(code: string): string {
  const b64 = code.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((code.length + 3) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodePreset(p: MyPreset): string {
  const r = p.rtRules;
  const st = p.stopRules;
  return toBase64Url(
    JSON.stringify([1, p.name, p.mode === "moving" ? 1 : 0, p.map, r.speed, r.cooldownMs, Math.round(r.damageScale * 100), r.inkRegen, Math.round(r.matchMs / 1000), st.rounds, st.ink, st.turnSeconds, p.playerCount ?? 0]),
  );
}

/** Accepts a bare code or a whole share link; null when it isn't a valid preset. */
export function decodePreset(input: string): MyPreset | null {
  try {
    const text = input.trim();
    const code = text.includes("preset=") ? (new URL(text, "https://x.invalid").searchParams.get("preset") ?? "") : text;
    if (!code || code.length > 400) return null;
    const a = JSON.parse(fromBase64Url(code)) as unknown[];
    if (!Array.isArray(a) || a[0] !== 1) return null;
    const n = (i: number) => (typeof a[i] === "number" ? (a[i] as number) : undefined);
    return sanitizePreset(
      {
        id: newPresetId(),
        name: a[1],
        mode: a[2] === 1 ? "moving" : "stop",
        map: a[3],
        rtRules: { speed: n(4), cooldownMs: n(5), damageScale: n(6) !== undefined ? n(6)! / 100 : undefined, inkRegen: n(7), matchMs: n(8) !== undefined ? n(8)! * 1000 : undefined },
        stopRules: { rounds: n(9), ink: n(10), turnSeconds: n(11) },
        ...(n(12) ? { playerCount: n(12) } : {}),
      },
      0,
    );
  } catch {
    return null;
  }
}

export function presetShareLink(p: MyPreset): string {
  const base = typeof window === "undefined" ? "" : `${window.location.origin}${window.location.pathname}`;
  return `${base}?preset=${encodePreset(p)}`;
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
