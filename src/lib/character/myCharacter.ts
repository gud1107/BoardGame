"use client";

import { create } from "zustand";
import { getAuthSupabase } from "@/lib/supabase/authClient";
import { AVATAR_VERSION, sanitizeAvatar, type AvatarProfile } from "./avatar";

/**
 * This browser's chosen 3D character (the profile "캐릭터 선택").
 *
 * - Everyone (guests too) keeps it in localStorage, so it works without an account.
 * - Signed-in players also mirror it into their Supabase auth `user_metadata.character`
 *   (no table/SQL needed), so it follows them to another device; on load the
 *   account copy wins over the local one.
 * - Stored as `{ v, look }` — `v` is AVATAR_VERSION so a future shape change can migrate.
 *
 * Other players see it through `roomCharacters.ts`, which shares it over the room's presence.
 *
 * 내가 만든 캐릭터 (`saved`): looks the player stored from 직접 꾸미기 to switch back to
 * later — same two homes (localStorage + `user_metadata.savedCharacters`), at most
 * `MAX_SAVED`, saving under an existing name overwrites that one.
 *
 * Its portrait (a PNG rendered from the real 3D rig by CharacterThumbs3D) doubles as the
 * profile picture — see `useProfilePhoto`. The portrait is per-device (a data URL is too big
 * for auth metadata): another device just renders it again on first load.
 */

const STORAGE_KEY = "bg_my_character_v1";
const PORTRAIT_KEY = "bg_my_character_portrait_v1";
const SAVED_KEY = "bg_my_character_saved_v1";
export const MAX_SAVED = 8;
const NAME_MAX = 12;

export interface SavedLook {
  id: string;
  name: string;
  look: AvatarProfile;
}

/** Keep only well-formed saved looks (untrusted: localStorage / account metadata). */
export function sanitizeSaved(raw: unknown): SavedLook[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedLook[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const { id, name, look } = r as Record<string, unknown>;
    const clean = sanitizeAvatar(look);
    if (typeof id !== "string" || !/^[a-z0-9]{1,16}$/.test(id) || typeof name !== "string" || !Object.keys(clean).length) continue;
    const n = name.trim().slice(0, NAME_MAX);
    if (n && !out.some((s) => s.id === id)) out.push({ id, name: n, look: clean });
    if (out.length === MAX_SAVED) break;
  }
  return out;
}

/** The list after saving `look` as `name`: replaces a same-named one in place, else appends (null when full). */
export function withSaved(list: SavedLook[], name: string, look: AvatarProfile, id: string): SavedLook[] | null {
  const n = name.trim().slice(0, NAME_MAX);
  const { presetId: _p, ...clean } = sanitizeAvatar(look);
  void _p;
  const hit = list.findIndex((s) => s.name === n);
  if (hit >= 0) return list.map((s, i) => (i === hit ? { ...s, look: clean } : s));
  if (list.length >= MAX_SAVED) return null;
  return [...list, { id, name: n, look: clean }];
}

export interface Portrait {
  /** `portraitKey` of the look it was rendered from — a stale portrait is never shown. */
  key: string;
  url: string;
}

/** Bump when the rig that draws portraits changes, so saved portraits get re-shot (2 = VRoid, 3 = make-up). */
const PORTRAIT_RIG = 3;

/** Stable identity of a look for portrait caching (field order and presetId don't matter). */
export function portraitKey(look: AvatarProfile): string {
  const { presetId: _presetId, ...rest } = look;
  void _presetId;
  return JSON.stringify([PORTRAIT_RIG, ...Object.keys(rest).sort().map((k) => [k, rest[k as keyof typeof rest]])]);
}

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "null") as T | null;
  } catch {
    return null;
  }
}

function writeJson(key: string, v: unknown): void {
  if (typeof window === "undefined") return;
  try {
    if (v === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // Storage blocked or full — the value just lasts for this tab.
  }
}

interface Stored {
  v: number;
  look: AvatarProfile;
}

function readLocal(): AvatarProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Stored | null;
    const look = sanitizeAvatar(raw?.look);
    return Object.keys(look).length ? look : null;
  } catch {
    return null;
  }
}

function writeLocal(look: AvatarProfile | null): void {
  if (typeof window === "undefined") return;
  try {
    if (look) window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: AVATAR_VERSION, look } satisfies Stored));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked — the choice just lasts for this tab.
  }
}

async function writeAccount(look: AvatarProfile | null): Promise<void> {
  const supabase = getAuthSupabase();
  if (!supabase) return;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.auth.updateUser({ data: { character: look ? { v: AVATAR_VERSION, look } : null } });
  } catch {
    // Best-effort: the local copy is already saved.
  }
}

async function writeAccountSaved(list: SavedLook[]): Promise<void> {
  const supabase = getAuthSupabase();
  if (!supabase) return;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.auth.updateUser({ data: { savedCharacters: list } });
  } catch {
    // Best-effort: the local copy is already saved.
  }
}

interface MyCharacterState {
  hydrated: boolean;
  /** null = no choice made → each table gives this seat its default K-pop look. */
  character: AvatarProfile | null;
  portrait: Portrait | null;
  saved: SavedLook[];
  /** Store `look` under `name` (overwriting a same-named one). False when the list is full. */
  saveLook: (name: string, look: AvatarProfile) => boolean;
  removeSaved: (id: string) => void;
  /** Idempotent; call from any consumer's mount effect. */
  init: () => Promise<void>;
  set: (look: AvatarProfile) => void;
  clear: () => void;
  setPortrait: (p: Portrait) => void;
}

export const useMyCharacter = create<MyCharacterState>((set, get) => ({
  hydrated: false,
  character: null,
  portrait: null,
  saved: [],

  init: async () => {
    if (get().hydrated) return;
    const p = readJson<Portrait>(PORTRAIT_KEY);
    set({
      hydrated: true,
      character: readLocal(),
      saved: sanitizeSaved(readJson(SAVED_KEY)),
      portrait: p && typeof p.key === "string" && typeof p.url === "string" && p.url.startsWith("data:image/") ? p : null,
    });
    const supabase = getAuthSupabase();
    if (!supabase) return;
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const meta = user?.user_metadata as { character?: Stored | null; savedCharacters?: unknown } | undefined;
      const look = sanitizeAvatar(meta?.character?.look);
      if (Object.keys(look).length) {
        writeLocal(look);
        set({ character: look });
      }
      if (meta?.savedCharacters !== undefined) {
        const saved = sanitizeSaved(meta.savedCharacters);
        writeJson(SAVED_KEY, saved);
        set({ saved });
      } else if (user && get().saved.length) {
        // saved on this device before signing in: carry them into the account
        void writeAccountSaved(get().saved);
      }
    } catch {
      // Signed out / offline — keep the local copy.
    }
  },

  set: (look) => {
    const clean = sanitizeAvatar(look);
    writeLocal(clean);
    set({ hydrated: true, character: clean });
    void writeAccount(clean);
  },

  clear: () => {
    writeLocal(null);
    set({ hydrated: true, character: null });
    void writeAccount(null);
  },

  setPortrait: (p) => {
    writeJson(PORTRAIT_KEY, p);
    set({ portrait: p });
  },

  saveLook: (name, look) => {
    const next = withSaved(get().saved, name, look, Math.random().toString(36).slice(2, 10) || "x");
    if (!next) return false;
    writeJson(SAVED_KEY, next);
    set({ saved: next });
    void writeAccountSaved(next);
    return true;
  },

  removeSaved: (id) => {
    const next = get().saved.filter((s) => s.id !== id);
    writeJson(SAVED_KEY, next);
    set({ saved: next });
    void writeAccountSaved(next);
  },
}));
