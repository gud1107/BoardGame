"use client";

import { create } from "zustand";
import { getAuthSupabase } from "@/lib/supabase/authClient";
import { DEFAULT_SKIN, sanitizeSkin, type SkinChoice } from "./catalog";

/**
 * This browser's chosen skins (🎨 내 스킨) — same two homes as the 3D character
 * (`myCharacter.ts`): localStorage for everyone, plus the signed-in account's
 * `user_metadata.skin` so it follows them to another device. On load the
 * account copy wins when it has one; otherwise the local choice is pushed up.
 *
 * Other players see it through `roomCharacters.ts`, which shares it over the
 * room's presence channel next to the character.
 */

const STORAGE_KEY = "bg_my_skin_v1";

interface MySkinState {
  hydrated: boolean;
  skin: SkinChoice;
  init: () => Promise<void>;
  set: (patch: Partial<SkinChoice>) => void;
}

function readLocal(): SkinChoice {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeSkin(JSON.parse(raw)) : DEFAULT_SKIN;
  } catch {
    return DEFAULT_SKIN;
  }
}

function writeLocal(skin: SkinChoice): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(skin));
  } catch {
    // Private mode / blocked storage — the choice just lasts this tab.
  }
}

const isDefault = (s: SkinChoice) => s.table === DEFAULT_SKIN.table && s.back === DEFAULT_SKIN.back;

async function writeAccount(skin: SkinChoice): Promise<void> {
  const supabase = getAuthSupabase();
  if (!supabase) return;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) await supabase.auth.updateUser({ data: { skin } });
  } catch {
    // Best-effort: the local copy is already saved.
  }
}

let listening = false;

export const useMySkin = create<MySkinState>((set, get) => ({
  hydrated: false,
  skin: DEFAULT_SKIN,

  init: async () => {
    if (get().hydrated) return;
    set({ hydrated: true, skin: readLocal() });
    if (listening) return;
    listening = true;
    if (typeof window !== "undefined") {
      window.addEventListener("storage", (e) => {
        if (e.key === STORAGE_KEY) set({ skin: readLocal() });
      });
    }
    const supabase = getAuthSupabase();
    if (!supabase) return;
    const sync = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;
        const meta = user.user_metadata as { skin?: unknown } | undefined;
        if (meta?.skin !== undefined && meta.skin !== null) {
          const account = sanitizeSkin(meta.skin);
          writeLocal(account);
          set({ skin: account });
        } else if (!isDefault(get().skin)) {
          await writeAccount(get().skin);
        }
      } catch {
        // Offline — keep the local copy.
      }
    };
    supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") setTimeout(() => void sync(), 0);
    });
    await sync();
  },

  set: (patch) => {
    const next = sanitizeSkin({ ...get().skin, ...patch });
    writeLocal(next);
    set({ hydrated: true, skin: next });
    void writeAccount(next);
  },
}));
