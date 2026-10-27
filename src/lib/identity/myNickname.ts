"use client";

import { create } from "zustand";
import { getAuthSupabase } from "@/lib/supabase/authClient";
import { getVisitorNickname, rememberRoomNickname } from "./lastNickname";

/**
 * The nickname this player enters game rooms with — set once in the profile
 * (프로필 → 게임 닉네임) and filled into every online game's name field
 * (`RoomNicknameField`), where it can still be changed for that one room.
 *
 * - Everyone keeps it in localStorage; signed-in players also mirror it into
 *   `user_metadata.gameNickname` so it follows them to another device (the
 *   account copy wins on load, same as `myCharacter.ts`).
 * - Not the 랭킹 닉네임 (`user_profiles.public_name`): that one is public and
 *   unique; this one is just what the table calls you.
 * - Unset → the room field falls back to the last name typed in any room.
 */

const STORAGE_KEY = "bg_game_nickname_v1";
export const GAME_NICKNAME_MAX = 12;

export function cleanNickname(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, GAME_NICKNAME_MAX) : "";
}

/** This browser's saved 게임 닉네임 without waiting for the store (sync, for initial state). */
export function readGameNickname(): string {
  return readLocal();
}

function readLocal(): string {
  if (typeof window === "undefined") return "";
  try {
    return cleanNickname(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return "";
  }
}

function writeLocal(name: string): void {
  if (typeof window === "undefined") return;
  try {
    if (name) window.localStorage.setItem(STORAGE_KEY, name);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked — it just lasts for this tab.
  }
}

interface MyNicknameState {
  hydrated: boolean;
  /** "" = not set in the profile. */
  nickname: string;
  init: () => Promise<void>;
  set: (name: string) => void;
}

export const useMyNickname = create<MyNicknameState>((set, get) => ({
  hydrated: false,
  nickname: "",

  init: async () => {
    if (get().hydrated) return;
    set({ hydrated: true, nickname: readLocal() });
    const supabase = getAuthSupabase();
    if (!supabase) return;
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const remote = cleanNickname((user?.user_metadata as { gameNickname?: unknown } | undefined)?.gameNickname);
      if (remote) {
        writeLocal(remote);
        set({ nickname: remote });
      }
    } catch {
      // Signed out / offline — keep the local copy.
    }
  },

  set: (name) => {
    const clean = cleanNickname(name);
    writeLocal(clean);
    if (clean) rememberRoomNickname(clean);
    set({ hydrated: true, nickname: clean });
    void (async () => {
      const supabase = getAuthSupabase();
      if (!supabase) return;
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) await supabase.auth.updateUser({ data: { gameNickname: clean || null } });
      } catch {
        // Best-effort: the local copy is already saved.
      }
    })();
  },
}));

/** What a room's name field starts with: the profile nickname, else the last name typed in a room. */
export function startingNickname(profile: string): string {
  return cleanNickname(profile) || cleanNickname(getVisitorNickname());
}
