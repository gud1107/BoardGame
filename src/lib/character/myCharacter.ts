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
 * Its portrait (a PNG rendered from the real 3D rig by CharacterThumbs3D) doubles as the
 * profile picture — see `useProfilePhoto`. The portrait is per-device (a data URL is too big
 * for auth metadata): another device just renders it again on first load.
 */

const STORAGE_KEY = "bg_my_character_v1";
const PORTRAIT_KEY = "bg_my_character_portrait_v1";
const PHOTO_MODE_KEY = "bg_profile_photo_mode_v1";

/** Which picture the profile shows when both exist: the 3D character's portrait or an uploaded image. */
export type PhotoMode = "character" | "upload";

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

interface MyCharacterState {
  hydrated: boolean;
  /** null = no choice made → each table gives this seat its default K-pop look. */
  character: AvatarProfile | null;
  portrait: Portrait | null;
  photoMode: PhotoMode;
  /** Idempotent; call from any consumer's mount effect. */
  init: () => Promise<void>;
  set: (look: AvatarProfile) => void;
  clear: () => void;
  setPortrait: (p: Portrait) => void;
  setPhotoMode: (m: PhotoMode) => void;
}

export const useMyCharacter = create<MyCharacterState>((set, get) => ({
  hydrated: false,
  character: null,
  portrait: null,
  photoMode: "character",

  init: async () => {
    if (get().hydrated) return;
    const p = readJson<Portrait>(PORTRAIT_KEY);
    const mode = readJson<PhotoMode>(PHOTO_MODE_KEY);
    set({
      hydrated: true,
      character: readLocal(),
      portrait: p && typeof p.key === "string" && typeof p.url === "string" && p.url.startsWith("data:image/") ? p : null,
      photoMode: mode === "upload" ? "upload" : "character",
    });
    const supabase = getAuthSupabase();
    if (!supabase) return;
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const stored = (user?.user_metadata as { character?: Stored | null } | undefined)?.character;
      const look = sanitizeAvatar(stored?.look);
      if (Object.keys(look).length) {
        writeLocal(look);
        set({ character: look });
      }
    } catch {
      // Signed out / offline — keep the local copy.
    }
  },

  set: (look) => {
    const clean = sanitizeAvatar(look);
    writeLocal(clean);
    writeJson(PHOTO_MODE_KEY, "character");
    // picking a character makes it the profile picture again
    set({ hydrated: true, character: clean, photoMode: "character" });
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

  setPhotoMode: (m) => {
    writeJson(PHOTO_MODE_KEY, m);
    set({ photoMode: m });
  },
}));
