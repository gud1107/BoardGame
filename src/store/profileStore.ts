import { create } from "zustand";
import { getAuthSupabase } from "@/lib/supabase/authClient";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

interface ProfileState {
  hydrated: boolean;
  /** null when signed out — profile avatars are a logged-in-only feature (guests always show DEFAULT_AVATAR). */
  userId: string | null;
  /** null means "no custom avatar set" — callers render `DEFAULT_AVATAR` for that case. */
  avatarUrl: string | null;
  uploading: boolean;
  error: string | null;

  /** Idempotent — safe to call from every consumer's mount effect, same contract as `useSubscriptionStore.init`. */
  init: () => Promise<void>;
  uploadAvatar: (file: File) => Promise<void>;
  resetAvatar: () => Promise<void>;
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
  uploading: false,
  error: null,

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
    const { data } = await supabase.from("profiles").select("avatar_url").eq("id", user.id).maybeSingle();
    set({ hydrated: true, userId: user.id, avatarUrl: (data?.avatar_url as string | null) ?? null });
  },

  uploadAvatar: async (file) => {
    const supabase = getAuthSupabase();
    const { userId } = get();
    if (!supabase || !userId) {
      set({ error: "로그인 후 이용할 수 있어요." });
      return;
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      set({ error: "PNG, JPG, WEBP, GIF 이미지만 업로드할 수 있어요." });
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      set({ error: "이미지 용량은 2MB를 넘을 수 없어요." });
      return;
    }

    set({ uploading: true, error: null });
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${userId}/avatar-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(path);

      await persistAvatarUrl(publicUrl);
      set({ avatarUrl: publicUrl, uploading: false });
    } catch (err) {
      set({ uploading: false, error: err instanceof Error ? err.message : "업로드에 실패했어요." });
    }
  },

  resetAvatar: async () => {
    if (!get().userId) return;
    set({ uploading: true, error: null });
    try {
      await persistAvatarUrl(null);
      set({ avatarUrl: null, uploading: false });
    } catch (err) {
      set({ uploading: false, error: err instanceof Error ? err.message : "초기화에 실패했어요." });
    }
  },
}));
