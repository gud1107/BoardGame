import { create } from "zustand";
import { v4 as uuid } from "uuid";
import type { BettingParticipant, BettingSessionRecord, DailyRecord } from "@/lib/db/types";
import {
  deleteBettingSession,
  getActiveBettingSession,
  saveBettingSession,
  saveDailyRecord,
} from "@/lib/db/repository";
import { validatePayoutTable } from "@/lib/betting/zeroSum";
import { computeFinalStandings, computeRoundDeltas, mergeDeltasIntoTotals } from "@/lib/betting/ledger";
import { mergeParticipants as foldMergeGroups, unmergeParticipants as dissolveMergeGroup } from "@/lib/betting/mergeGroups";
import { backupDailyRecord } from "@/lib/supabase/sync";
import { renamePlayer } from "@/lib/db/repository";

interface BettingStore {
  session: BettingSessionRecord | null;
  hydrated: boolean;
  /** UI-only, not persisted: whether the always-available management sidebar is open. */
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  init: () => Promise<void>;
  startSession: (
    participants: BettingParticipant[],
    payoutTable: number[],
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  recordRound: (
    gameId: string,
    gameName: string,
    ranks: Record<string, number>,
  ) => Promise<void>;
  /** Renames a participant mid-session. Persists immediately; also updates the player's alias history. */
  updateParticipantName: (playerId: string, name: string) => Promise<void>;
  /** Replaces the active session's payout table. Rejects (no-op on storage) if it isn't zero-sum. */
  updatePayoutTable: (table: number[]) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Folds `memberIds` into one settlement row under `canonicalId` (see `mergeGroups.ts`) — never touches raw round history. */
  mergeParticipants: (canonicalId: string, memberIds: string[]) => Promise<void>;
  /** Undoes a merge — the group's rows split back apart, with their original round history untouched. */
  unmergeGroup: (canonicalId: string) => Promise<void>;
  /** Hand-entered correction outside the normal round flow (e.g. a cash rounding fix). */
  applyManualAdjustment: (playerId: string, amount: number, note?: string) => Promise<void>;
  endSession: () => Promise<DailyRecord | null>;
}

export const useBettingStore = create<BettingStore>((set, get) => ({
  session: null,
  hydrated: false,
  sidebarOpen: false,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  init: async () => {
    if (get().hydrated) return;
    const existing = await getActiveBettingSession();
    set({ session: existing ?? null, hydrated: true });
  },

  startSession: async (participants, payoutTable) => {
    if (participants.length < 2) {
      return { ok: false, error: "최소 2명 이상 참가해야 내기를 시작할 수 있습니다." };
    }
    if (participants.length !== payoutTable.length) {
      return { ok: false, error: "참가자 수와 순위표 항목 수가 일치해야 합니다." };
    }
    const check = validatePayoutTable(payoutTable);
    if (!check.valid) {
      return {
        ok: false,
        error: `상금/벌금 합계가 0원이어야 합니다. (현재 합계: ${check.sum.toLocaleString()}원)`,
      };
    }

    const session: BettingSessionRecord = {
      id: uuid(),
      status: "active",
      startedAt: new Date().toISOString(),
      participants,
      payoutTable,
      rounds: [],
      totals: Object.fromEntries(participants.map((p) => [p.playerId, 0])),
    };
    await saveBettingSession(session);
    set({ session });
    return { ok: true };
  },

  recordRound: async (gameId, gameName, ranks) => {
    const session = get().session;
    if (!session) return;
    const deltas = computeRoundDeltas(ranks, session.payoutTable);
    const totals = mergeDeltasIntoTotals(session.totals, deltas);
    const round = {
      id: uuid(),
      gameId,
      gameName,
      rankedPlayerIds: Object.entries(ranks)
        .sort(([, a], [, b]) => a - b)
        .map(([id]) => id),
      deltas,
      playedAt: new Date().toISOString(),
    };
    const updated: BettingSessionRecord = {
      ...session,
      rounds: [...session.rounds, round],
      totals,
    };
    await saveBettingSession(updated);
    set({ session: updated });
  },

  updateParticipantName: async (playerId, name) => {
    const session = get().session;
    const trimmed = name.trim();
    if (!session || !trimmed) return;
    const updated: BettingSessionRecord = {
      ...session,
      participants: session.participants.map((p) =>
        p.playerId === playerId ? { ...p, name: trimmed } : p,
      ),
    };
    await saveBettingSession(updated);
    void renamePlayer(playerId, trimmed);
    set({ session: updated });
  },

  updatePayoutTable: async (table) => {
    const session = get().session;
    if (!session) return { ok: false, error: "진행 중인 내기가 없습니다." };
    if (table.length !== session.participants.length) {
      return { ok: false, error: "참가자 수와 순위표 항목 수가 일치해야 합니다." };
    }
    const check = validatePayoutTable(table);
    if (!check.valid) {
      return {
        ok: false,
        error: `상금/벌금 합계가 0원이어야 합니다. (현재 합계: ${check.sum.toLocaleString()}원)`,
      };
    }
    const updated: BettingSessionRecord = { ...session, payoutTable: table };
    await saveBettingSession(updated);
    set({ session: updated });
    return { ok: true };
  },

  mergeParticipants: async (canonicalId, memberIds) => {
    const session = get().session;
    if (!session) return;
    const updated: BettingSessionRecord = {
      ...session,
      mergedGroups: foldMergeGroups(session.mergedGroups ?? [], canonicalId, memberIds),
    };
    await saveBettingSession(updated);
    set({ session: updated });
  },

  unmergeGroup: async (canonicalId) => {
    const session = get().session;
    if (!session) return;
    const updated: BettingSessionRecord = {
      ...session,
      mergedGroups: dissolveMergeGroup(session.mergedGroups ?? [], canonicalId),
    };
    await saveBettingSession(updated);
    set({ session: updated });
  },

  applyManualAdjustment: async (playerId, amount, note) => {
    const session = get().session;
    if (!session || !Number.isFinite(amount) || amount === 0) return;
    const adjustment = { id: uuid(), playerId, amount, note, createdAt: new Date().toISOString() };
    const updated: BettingSessionRecord = {
      ...session,
      manualAdjustments: [...(session.manualAdjustments ?? []), adjustment],
      totals: { ...session.totals, [playerId]: (session.totals[playerId] ?? 0) + amount },
    };
    await saveBettingSession(updated);
    set({ session: updated });
  },

  endSession: async () => {
    const session = get().session;
    if (!session) return null;

    const standings = computeFinalStandings(session.totals);
    const dailyRecord: DailyRecord = {
      id: uuid(),
      date: new Date().toISOString().slice(0, 10),
      sessionId: session.id,
      standings: standings.map((s) => ({
        playerId: s.playerId,
        name:
          session.participants.find((p) => p.playerId === s.playerId)?.name ??
          "알 수 없음",
        total: s.total,
        rank: s.rank,
      })),
      payoutTable: session.payoutTable,
      roundCount: session.rounds.length,
      createdAt: new Date().toISOString(),
    };

    await saveDailyRecord(dailyRecord);
    void backupDailyRecord(dailyRecord);
    await deleteBettingSession(session.id);
    set({ session: null });
    return dailyRecord;
  },
}));
