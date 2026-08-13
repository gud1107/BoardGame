import { create } from "zustand";
import { fetchAppSettings } from "@/lib/entitlements/repository";
import type { AppSettings, Tier } from "@/lib/entitlements/types";
import type { AdminUserRow } from "@/app/api/admin/users/route";

interface AdminState {
  loading: boolean;
  settings: AppSettings | null;
  users: AdminUserRow[];
  usersError: string | null;
  savingUserId: string | null;
  settingsSaving: boolean;

  init: () => Promise<void>;
  setSettings: (settings: AppSettings) => void;
  saveSettings: () => Promise<void>;
  saveUser: (userId: string, patch: { tier?: Tier; resetUsageToday?: boolean }) => Promise<void>;
}

export const useAdminStore = create<AdminState>((set, get) => ({
  loading: true,
  settings: null,
  users: [],
  usersError: null,
  savingUserId: null,
  settingsSaving: false,

  init: async () => {
    const [settings, usersRes] = await Promise.all([fetchAppSettings(), fetch("/api/admin/users")]);
    if (usersRes.ok) {
      const body = await usersRes.json();
      set({ settings, users: body.users, usersError: null, loading: false });
    } else {
      set({ settings, usersError: `유저 목록을 불러오지 못했습니다 (${usersRes.status}).`, loading: false });
    }
  },

  setSettings: (settings) => set({ settings }),

  saveSettings: async () => {
    const { settings } = get();
    if (!settings) return;
    set({ settingsSaving: true });
    await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    }).catch(() => {});
    set({ settingsSaving: false });
  },

  saveUser: async (userId, patch) => {
    set({ savingUserId: userId });
    await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, extendDays: 0, ...patch }),
    }).catch(() => {});
    await get().init();
    set({ savingUserId: null });
  },
}));
