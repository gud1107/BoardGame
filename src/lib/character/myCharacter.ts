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
 *   account copy wins over the local one — unless it was changed here as a guest
 *   (`GUEST_EDITS_KEY`): then signing in keeps what they just made and parks the
 *   account's old look in 내가 만든 캐릭터 (`mergeGuestEdits`), so nothing is lost.
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
/** `{ look?, saved? }` — what was changed here while signed out, still to be merged into an account. */
const GUEST_EDITS_KEY = "bg_my_character_guest_edits_v1";
/** Name the account's previous look is parked under when a guest look replaces it. */
export const PREVIOUS_ACCOUNT_LOOK = "예전 계정 캐릭터";
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

export interface GuestEdits {
  look?: boolean;
  saved?: boolean;
}

/**
 * What this device and the account end up with when a player signs in. Without
 * guest edits the account wins (an empty account takes this device's copy).
 * With them the guest's work wins: their look becomes the account's, the
 * account's old look is kept as `PREVIOUS_ACCOUNT_LOOK`, and saved lists are
 * united (account first, capped at MAX_SAVED).
 */
export function mergeGuestEdits(
  local: { look: AvatarProfile | null; saved: SavedLook[] },
  account: { look: AvatarProfile | null; saved: SavedLook[] | undefined },
  edits: GuestEdits,
  newId: () => string,
): { look: AvatarProfile | null; saved: SavedLook[]; pushLook: boolean; pushSaved: boolean } {
  let saved: SavedLook[];
  let pushSaved: boolean;
  if (account.saved === undefined) {
    saved = local.saved;
    pushSaved = local.saved.length > 0;
  } else if (edits.saved) {
    saved = [...account.saved];
    for (const s of local.saved) {
      if (saved.length >= MAX_SAVED) break;
      if (saved.some((a) => a.id === s.id || portraitKey(a.look) === portraitKey(s.look))) continue;
      saved.push(s);
    }
    pushSaved = saved.length !== account.saved.length;
  } else {
    saved = account.saved;
    pushSaved = false;
  }

  if (edits.look && local.look) {
    const old = account.look;
    if (old && portraitKey(old) !== portraitKey(local.look) && !saved.some((s) => portraitKey(s.look) === portraitKey(old))) {
      const next = withSaved(saved, PREVIOUS_ACCOUNT_LOOK, old, newId());
      if (next) {
        saved = next;
        pushSaved = true;
      }
    }
    return { look: local.look, saved, pushLook: !old || portraitKey(old) !== portraitKey(local.look), pushSaved };
  }
  if (account.look) return { look: account.look, saved, pushLook: false, pushSaved };
  return { look: local.look, saved, pushLook: !!local.look, pushSaved };
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

function markGuestEdit(key: keyof GuestEdits): void {
  writeJson(GUEST_EDITS_KEY, { ...readJson<GuestEdits>(GUEST_EDITS_KEY), [key]: true });
}

async function writeAccount(look: AvatarProfile | null): Promise<void> {
  const supabase = getAuthSupabase();
  if (!supabase) return;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return markGuestEdit("look");
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
    if (!user) return markGuestEdit("saved");
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

let syncing: Promise<void> | null = null;
let listening = false;

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
    const sync = () => {
      syncing ??= syncWithAccount().finally(() => (syncing = null));
      return syncing;
    };
    if (!listening) {
      listening = true;
      // signing in happens without a reload (LoginForm → router.push): merge right then
      supabase.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_IN") setTimeout(() => void sync(), 0);
      });
    }
    await sync();

    async function syncWithAccount() {
      try {
        const {
          data: { user },
        } = await supabase!.auth.getUser();
        if (!user) return;
        const meta = user.user_metadata as { character?: Stored | null; savedCharacters?: unknown } | undefined;
        const accountLook = sanitizeAvatar(meta?.character?.look);
        const merged = mergeGuestEdits(
          { look: get().character, saved: get().saved },
          {
            look: Object.keys(accountLook).length ? accountLook : null,
            saved: meta?.savedCharacters === undefined ? undefined : sanitizeSaved(meta.savedCharacters),
          },
          readJson<GuestEdits>(GUEST_EDITS_KEY) ?? {},
          () => Math.random().toString(36).slice(2, 10) || "x",
        );
        writeLocal(merged.look);
        writeJson(SAVED_KEY, merged.saved);
        set({ character: merged.look, saved: merged.saved });
        const data: Record<string, unknown> = {};
        if (merged.pushLook) data.character = merged.look ? { v: AVATAR_VERSION, look: merged.look } : null;
        if (merged.pushSaved) data.savedCharacters = merged.saved;
        // guest edits stay marked until the account really has them
        if (Object.keys(data).length && (await supabase!.auth.updateUser({ data })).error) return;
        writeJson(GUEST_EDITS_KEY, null);
      } catch {
        // Offline — keep the local copy; guest edits stay marked for next time.
      }
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
