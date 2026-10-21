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
 */

const STORAGE_KEY = "bg_my_character_v1";

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
  /** Idempotent; call from any consumer's mount effect. */
  init: () => Promise<void>;
  set: (look: AvatarProfile) => void;
  clear: () => void;
}

export const useMyCharacter = create<MyCharacterState>((set, get) => ({
  hydrated: false,
  character: null,

  init: async () => {
    if (get().hydrated) return;
    set({ hydrated: true, character: readLocal() });
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
    set({ hydrated: true, character: clean });
    void writeAccount(clean);
  },

  clear: () => {
    writeLocal(null);
    set({ hydrated: true, character: null });
    void writeAccount(null);
  },
}));
