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
 *   account copy wins on load, same as `myCharacter.ts` — and likewise a name
 *   set here as a guest wins once, when they sign in: `GUEST_EDIT_KEY`).
 * - Not the 랭킹 닉네임 (`user_profiles.public_name`): that one is public and
 *   unique; this one is just what the table calls you.
 * - Unset → the room field falls back to the last name typed in any room.
 */

const STORAGE_KEY = "bg_game_nickname_v1";
export const GAME_NICKNAME_MAX = 12;
/** "1" = set while signed out, still to be carried into the account on sign-in. */
const GUEST_EDIT_KEY = "bg_game_nickname_guest_edit_v1";

function guestEdited(): boolean {
  try {
    return window.localStorage.getItem(GUEST_EDIT_KEY) === "1";
  } catch {
    return false;
  }
}

function setGuestEdited(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(GUEST_EDIT_KEY, "1");
    else window.localStorage.removeItem(GUEST_EDIT_KEY);
  } catch {
    // Storage blocked — nothing to carry over then.
  }
}

/** The name to keep on sign-in: a guest edit wins, else the account's, else this device's (then uploaded). */
export function mergeGuestNickname(local: string, account: string, edited: boolean): { name: string; push: boolean } {
  // a guest clearing the field doesn't wipe the account's name
  if (edited && local) return { name: local, push: local !== account };
  if (account) return { name: account, push: false };
  return { name: local, push: !!local };
}

let syncing: Promise<void> | null = null;
let listening = false;

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
    if (listening) return;
    listening = true;
    if (typeof window !== "undefined") {
      // another tab changed it
      window.addEventListener("storage", (e) => {
        if (e.key === STORAGE_KEY) set({ nickname: readLocal() });
      });
    }
    const supabase = getAuthSupabase();
    if (!supabase) return;
    const sync = () => {
      const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
      // one tab at a time, each reading what the previous one left
      syncing ??= (locks ? locks.request("bg-game-nickname-sync", syncWithAccount).then(() => {}) : syncWithAccount()).finally(() => (syncing = null));
      return syncing;
    };
    // signing in happens without a reload (LoginForm → router.push): merge right then
    supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") setTimeout(() => void sync(), 0);
    });
    await sync();

    async function syncWithAccount() {
      try {
        const {
          data: { user },
        } = await supabase!.auth.getUser();
        if (!user) return;
        const remote = cleanNickname((user.user_metadata as { gameNickname?: unknown } | undefined)?.gameNickname);
        const { name, push } = mergeGuestNickname(readLocal(), remote, guestEdited());
        writeLocal(name);
        set({ nickname: name });
        if (push && (await supabase!.auth.updateUser({ data: { gameNickname: name || null } })).error) return;
        setGuestEdited(false);
      } catch {
        // Offline — keep the local copy.
      }
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
        else setGuestEdited(true);
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
