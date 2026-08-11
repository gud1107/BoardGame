"use client";

import { create } from "zustand";
import type { BugReportAttachment, BugReportRecord, BugReportStatus } from "@/lib/db/types";
import { createBugReport, listBugReports, updateBugReportStatus } from "@/lib/db/repository";
import { backupBugReport } from "@/lib/supabase/sync";
import { validateBugReportInput, type BugReportFieldErrors, type BugReportFormInput } from "@/lib/bugReports/validate";
import { prependReport, updateReportStatusInList } from "@/lib/bugReports/board";

export interface SubmitBugReportInput extends BugReportFormInput {
  gameId?: string;
  gameName?: string;
  attachment?: BugReportAttachment;
}

export type SubmitBugReportResult =
  | { ok: true; report: BugReportRecord }
  | { ok: false; errors: BugReportFieldErrors };

interface BugReportStore {
  reports: BugReportRecord[];
  hydrated: boolean;
  init: () => Promise<void>;
  submitReport: (input: SubmitBugReportInput) => Promise<SubmitBugReportResult>;
  updateStatus: (id: string, status: BugReportStatus) => Promise<void>;
}

export const useBugReportStore = create<BugReportStore>((set, get) => ({
  reports: [],
  hydrated: false,

  init: async () => {
    if (get().hydrated) return;
    const existing = await listBugReports();
    set({ reports: existing, hydrated: true });
  },

  submitReport: async (input) => {
    const errors = validateBugReportInput(input);
    if (Object.keys(errors).length > 0) return { ok: false, errors };

    const record = await createBugReport({
      title: input.title.trim(),
      description: input.description.trim(),
      author: input.author.trim(),
      phone: input.phone?.trim() || undefined,
      gameId: input.gameId,
      gameName: input.gameName,
      attachment: input.attachment,
    });
    // IndexedDB write already succeeded (createBugReport awaited above) —
    // prepend locally instead of re-fetching the whole list.
    set({ reports: prependReport(get().reports, record) });
    void backupBugReport(record); // best-effort mirror, never blocks the UI
    return { ok: true, report: record };
  },

  updateStatus: async (id, status) => {
    const updated = await updateBugReportStatus(id, status);
    if (!updated) return;
    set({ reports: updateReportStatusInList(get().reports, id, status) });
    void backupBugReport(updated);
  },
}));
