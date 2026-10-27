import { create } from "zustand";
import { getAuthSupabase } from "@/lib/supabase/authClient";

interface ProfileState {
  hydrated: boolean;
  /** null when signed out — profile avatars are a logged-in-only feature (guests always show DEFAULT_AVATAR). */
  userId: string | null;
  /**
   * A photo uploaded before image upload was removed (2026-10-27) — no longer shown in the
   * profile, but still mirrored to the public ranking until the player deletes it (`resetAvatar`).
   */
  avatarUrl: string | null;
  /** Self-chosen name shown on the public leaderboard (`user_profiles.public_name`); null = shown as 게이머_xxxxxx. */
  publicName: string | null;
  uploading: boolean;
  error: string | null;
  savingName: boolean;
  nameError: string | null;

  /** Idempotent — safe to call from every consumer's mount effect, same contract as `useSubscriptionStore.init`. */
  init: () => Promise<void>;
  /** Deletes a leftover uploaded photo (Storage file + ranking mirror). */
  resetAvatar: () => Promise<void>;
  /** Blank/null clears it. Resolves true on success. */
  setPublicName: (name: string | null) => Promise<boolean>;
}

export const PUBLIC_NAME_RULE = "2~12자, 한글·영문·숫자·밑줄(_)·공백";

function publicNameErrorMessage(message: string): string {
  if (message.includes("name taken")) return "이미 다른 사람이 쓰고 있는 닉네임이에요.";
  if (message.includes("reserved name")) return "사용할 수 없는 닉네임이에요.";
  if (message.includes("invalid name")) return `닉네임은 ${PUBLIC_NAME_RULE}만 쓸 수 있어요.`;
  if (message.includes("set_my_public_name")) return "아직 서버 설정이 끝나지 않았어요. 잠시 후 다시 시도해 주세요.";
  return "닉네임 저장에 실패했어요.";
}

async function persistAvatarUrl(avatarUrl: string | null): Promise<void> {
  const res = await fetch("/api/profile/avatar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ avatarUrl }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "아바타 저장에 실패했어요.");
  }
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  hydrated: false,
  userId: null,
  avatarUrl: null,
  publicName: null,
  uploading: false,
  error: null,
  savingName: false,
  nameError: null,

  init: async () => {
    if (get().hydrated) return;
    const supabase = getAuthSupabase();
    if (!supabase) {
      set({ hydrated: true });
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      set({ hydrated: true, userId: null, avatarUrl: null });
      return;
    }
    const [{ data }, { data: pub }] = await Promise.all([
      supabase.from("profiles").select("avatar_url").eq("id", user.id).maybeSingle(),
      // Errors (e.g. player_stats.sql not applied yet) just leave the name unset.
      supabase.from("user_profiles").select("public_name").eq("id", user.id).maybeSingle(),
    ]);
    set({
      hydrated: true,
      userId: user.id,
      avatarUrl: (data?.avatar_url as string | null) ?? null,
      publicName: (pub?.public_name as string | null) ?? null,
    });
  },

  resetAvatar: async () => {
    if (!get().userId) return;
    set({ uploading: true, error: null });
    try {
      await persistAvatarUrl(null);
      set({ avatarUrl: null, uploading: false });
    } catch (err) {
      set({ uploading: false, error: err instanceof Error ? err.message : "사진 삭제에 실패했어요." });
    }
  },

  setPublicName: async (name) => {
    const supabase = getAuthSupabase();
    if (!supabase || !get().userId) {
      set({ nameError: "로그인 후 이용할 수 있어요." });
      return false;
    }
    set({ savingName: true, nameError: null });
    const { data, error } = await supabase.rpc("set_my_public_name", { p_name: name?.trim() || null });
    if (error) {
      set({ savingName: false, nameError: publicNameErrorMessage(error.message) });
      return false;
    }
    set({ savingName: false, publicName: (data as string | null) ?? null });
    return true;
  },
}));
