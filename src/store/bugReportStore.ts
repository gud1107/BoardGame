"use client";

import { create } from "zustand";
import type { BugReportAttachment, BugReportRecord, BugReportStatus } from "@/lib/db/types";
import {
  listBugReports,
  softDeleteBugReport,
  updateBugReportContent,
  updateBugReportStatus as updateLocalBugReportStatus,
} from "@/lib/db/repository";
import { getAuthSupabase } from "@/lib/supabase/authClient";
import { getDeviceId } from "@/lib/identity/deviceId";
import { SUPER_ADMIN_EMAIL } from "@/lib/admin/superAdmin";
import { validateBugReportInput, validateGuestPassword, type BugReportFieldErrors, type BugReportFormInput } from "@/lib/bugReports/validate";
import { prependReport, removeReportFromList, updateReportInList, updateReportStatusInList } from "@/lib/bugReports/board";
import type { CloudBugReportRecord } from "@/lib/bugReports/types";

export interface SubmitBugReportInput extends BugReportFormInput {
  gameId?: string;
  gameName?: string;
  attachment?: BugReportAttachment;
  /** Required when not logged in (guest) — see `validate.ts`'s `validateGuestPassword`. Ignored when logged in. */
  password?: string;
}

/** Content fields a `PATCH` may carry — same shape server-side, see `src/app/api/bug-reports/[id]/route.ts`. */
export interface BugReportContentPatch {
  title?: string;
  description?: string;
  author?: string;
  gameId?: string | null;
  gameName?: string | null;
  phone?: string | null;
  attachment?: BugReportAttachment | null;
  /** Required to edit a guest report as that guest (not needed for the report's own logged-in author or an admin) — see `GuestPasswordModal.tsx`. */
  password?: string;
}

export type SubmitBugReportResult =
  | { ok: true; report: CloudBugReportRecord }
  | { ok: false; reason: "validation"; errors: BugReportFieldErrors }
  | { ok: false; reason: "cooldown" }
  | { ok: false; reason: "unknown" };

export type UpdateBugReportResult =
  | { ok: true; report: CloudBugReportRecord }
  | { ok: false; reason: "validation"; errors: BugReportFieldErrors }
  | { ok: false; reason: "forbidden" }
  | { ok: false; reason: "unknown" };

export interface BugReportCurrentUser {
  id: string;
  email: string | null;
  /** Prefills the guest-style author field when logged in — see `BugReportModal.tsx`. Still freely editable, same "cosmetic, not the auth key" rule as `author` everywhere else in this feature. */
  nickname: string | null;
  isAdmin: boolean;
  /** Cosmetic only (picks the "👑 관리자 삭제" label/styling in `BugReportDetailModal.tsx`) — every admin already has the same real delete power server-side, see `permissions.ts`. */
  isSuperAdmin: boolean;
}

async function computeCurrentUser(): Promise<BugReportCurrentUser | null> {
  const authSupabase = getAuthSupabase();
  if (!authSupabase) return null;
  const {
    data: { user },
  } = await authSupabase.auth.getUser();
  if (!user) return null;
  // Allowed under the "self read profile" RLS policy (profiles.id = auth.uid()) — see supabase/schema.sql.
  const { data: profile } = await authSupabase.from("profiles").select("role, nickname").eq("id", user.id).maybeSingle();
  return {
    id: user.id,
    email: user.email ?? null,
    nickname: profile?.nickname ?? null,
    isAdmin: profile?.role === "admin" || user.email === SUPER_ADMIN_EMAIL,
    isSuperAdmin: user.email === SUPER_ADMIN_EMAIL,
  };
}

interface BugReportStore {
  /** Legacy, account-less reports from before this feature — IndexedDB, local to this browser. Read-only except for admin actions below. */
  localReports: BugReportRecord[];
  /** Account-linked reports — the primary store going forward. */
  cloudReports: CloudBugReportRecord[];
  currentUser: BugReportCurrentUser | null;
  /** Whether Supabase (accounts) is configured at all — distinct from "signed out", see `SupabaseRequiredNotice`. */
  configured: boolean;
  hydrated: boolean;

  init: () => Promise<void>;
  /** Unlike `init`, always re-fetches — call on mount so a just-completed login is reflected without a full page reload. */
  refreshCurrentUser: () => Promise<void>;

  /** Works logged in or as a guest (server-enforced) — see `SubmitBugReportInput.password`. New reports are cloud-only from this feature onward. */
  submitReport: (input: SubmitBugReportInput) => Promise<SubmitBugReportResult>;
  /** Content edit — author, admin, or (for a guest report) the correct password (server-enforced). */
  updateReport: (id: string, patch: BugReportContentPatch) => Promise<UpdateBugReportResult>;
  /** Processing-status change — admin only (server-enforced; previously unrestricted). */
  updateStatus: (id: string, status: BugReportStatus) => Promise<UpdateBugReportResult>;
  /** Soft delete — author, admin, or (for a guest report) the correct `password` (server-enforced). */
  deleteReport: (id: string, password?: string) => Promise<{ ok: boolean; reason?: "forbidden" | "unknown" }>;

  /**
   * Legacy local reports have no `authorId` to check server-side — this
   * gate is client-only (`currentUser.isAdmin`), which is the best this
   * data can offer since it never leaves the browser. See board.ts /
   * repository.ts for the same caveat. Takes the complete editable field
   * set (not a sparse patch) — see `repository.ts#updateBugReportContent`.
   */
  adminUpdateLocalReport: (
    id: string,
    fields: Pick<BugReportRecord, "title" | "description" | "gameId" | "gameName" | "phone" | "attachment">,
  ) => Promise<boolean>;
  adminDeleteLocalReport: (id: string) => Promise<boolean>;
  /** Local reports have no server to admin-check against either — same client-only gate as the two above. */
  adminUpdateLocalStatus: (id: string, status: BugReportStatus) => Promise<boolean>;
}

export const useBugReportStore = create<BugReportStore>((set, get) => {
  async function patchCloud(id: string, body: BugReportContentPatch & { status?: BugReportStatus }): Promise<UpdateBugReportResult> {
    const res = await fetch(`/api/bug-reports/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 403) return { ok: false, reason: "forbidden" };
    if (res.status === 400) {
      const errBody = await res.json().catch(() => null);
      return { ok: false, reason: "validation", errors: errBody?.errors ?? {} };
    }
    if (!res.ok) return { ok: false, reason: "unknown" };
    const resBody = await res.json();
    set({ cloudReports: updateReportInList(get().cloudReports, id, resBody.report) });
    return { ok: true, report: resBody.report };
  }

  return {
    localReports: [],
    cloudReports: [],
    currentUser: null,
    configured: false,
    hydrated: false,

    init: async () => {
      if (get().hydrated) return;
      const [localReports, currentUser, cloudRes] = await Promise.all([
        listBugReports(),
        computeCurrentUser(),
        fetch("/api/bug-reports")
          .then((r) => (r.ok ? r.json() : { reports: [] }))
          .catch(() => ({ reports: [] })),
      ]);
      set({
        localReports,
        currentUser,
        cloudReports: cloudRes.reports ?? [],
        configured: getAuthSupabase() !== null,
        hydrated: true,
      });
    },

    refreshCurrentUser: async () => {
      const currentUser = await computeCurrentUser();
      set({ currentUser, configured: getAuthSupabase() !== null });
    },

    submitReport: async (input) => {
      const isGuest = !get().currentUser;
      const errors = validateBugReportInput(input);
      if (isGuest) {
        const passwordError = validateGuestPassword(input.password);
        if (passwordError) errors.password = passwordError;
      }
      if (Object.keys(errors).length > 0) return { ok: false, reason: "validation", errors };

      // `deviceId` is a client-only concern (localStorage) — attached here
      // rather than asked of the caller, and only for a guest submission
      // (the server's cooldown check ignores it for a logged-in author).
      const body = isGuest ? { ...input, deviceId: getDeviceId() } : input;

      const res = await fetch("/api/bug-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 429) return { ok: false, reason: "cooldown" };
      if (res.status === 400) {
        const errBody = await res.json().catch(() => null);
        return { ok: false, reason: "validation", errors: errBody?.errors ?? {} };
      }
      if (!res.ok) return { ok: false, reason: "unknown" };
      const resBody = await res.json();
      set({ cloudReports: prependReport(get().cloudReports, resBody.report) });
      return { ok: true, report: resBody.report };
    },

    updateReport: (id, patch) => patchCloud(id, patch),
    updateStatus: (id, status) => patchCloud(id, { status }),

    deleteReport: async (id, password) => {
      const res = await fetch(`/api/bug-reports/${id}`, {
        method: "DELETE",
        headers: password !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: password !== undefined ? JSON.stringify({ password }) : undefined,
      });
      if (res.status === 403) return { ok: false, reason: "forbidden" };
      if (!res.ok) return { ok: false, reason: "unknown" };
      set({ cloudReports: removeReportFromList(get().cloudReports, id) });
      return { ok: true };
    },

    adminUpdateLocalReport: async (id, patch) => {
      if (!get().currentUser?.isAdmin) return false;
      const updated = await updateBugReportContent(id, patch);
      if (!updated) return false;
      set({ localReports: updateReportInList(get().localReports, id, updated) });
      return true;
    },

    adminDeleteLocalReport: async (id) => {
      if (!get().currentUser?.isAdmin) return false;
      const ok = await softDeleteBugReport(id);
      if (ok) set({ localReports: removeReportFromList(get().localReports, id) });
      return ok;
    },

    adminUpdateLocalStatus: async (id, status) => {
      if (!get().currentUser?.isAdmin) return false;
      const updated = await updateLocalBugReportStatus(id, status);
      if (!updated) return false;
      set({ localReports: updateReportStatusInList(get().localReports, id, status) });
      return true;
    },
  };
});
