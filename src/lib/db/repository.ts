import { v4 as uuid } from "uuid";
import { getDb } from "./client";
import type {
  BettingSessionRecord,
  BugReportRecord,
  BugReportStatus,
  DailyRecord,
  DeviceIdentityRecord,
  GameResultRecord,
  PlayerRecord,
} from "./types";

const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export async function createPlayer(name: string): Promise<PlayerRecord> {
  const db = await getDb();
  const record: PlayerRecord = {
    id: uuid(),
    name,
    aliases: [name],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.put("players", record);
  return record;
}

export async function getPlayer(id: string): Promise<PlayerRecord | undefined> {
  const db = await getDb();
  return db.get("players", id);
}

export async function findPlayersByNameLike(
  name: string,
): Promise<PlayerRecord[]> {
  const db = await getDb();
  const all = await db.getAll("players");
  const needle = name.trim().toLowerCase();
  if (!needle) return [];
  return all.filter(
    (p) =>
      p.name.toLowerCase() === needle ||
      p.aliases.some((a) => a.toLowerCase() === needle),
  );
}

export async function renamePlayer(
  id: string,
  newName: string,
): Promise<PlayerRecord | undefined> {
  const db = await getDb();
  const player = await db.get("players", id);
  if (!player) return undefined;
  const aliases = player.aliases.includes(newName)
    ? player.aliases
    : [...player.aliases, newName];
  const updated: PlayerRecord = {
    ...player,
    name: newName,
    aliases,
    updatedAt: nowIso(),
  };
  await db.put("players", updated);
  return updated;
}

export async function listAllPlayers(): Promise<PlayerRecord[]> {
  const db = await getDb();
  return db.getAll("players");
}

// ---------------------------------------------------------------------------
// Device identities
// ---------------------------------------------------------------------------

export async function getIdentity(
  deviceId: string,
): Promise<DeviceIdentityRecord | undefined> {
  const db = await getDb();
  return db.get("identities", deviceId);
}

export async function linkDeviceToPlayer(
  deviceId: string,
  playerId: string,
  lastIp?: string,
): Promise<DeviceIdentityRecord> {
  const db = await getDb();
  const record: DeviceIdentityRecord = {
    deviceId,
    playerId,
    lastIp,
    updatedAt: nowIso(),
  };
  await db.put("identities", record);
  return record;
}

// ---------------------------------------------------------------------------
// Betting sessions
// ---------------------------------------------------------------------------

export async function saveBettingSession(
  session: BettingSessionRecord,
): Promise<void> {
  const db = await getDb();
  await db.put("bettingSessions", session);
}

export async function getActiveBettingSession(): Promise<
  BettingSessionRecord | undefined
> {
  const db = await getDb();
  const all = await db.getAllFromIndex("bettingSessions", "by-status", "active");
  // Only one active session is ever expected; last one wins if data drifted.
  return all[all.length - 1];
}

export async function deleteBettingSession(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("bettingSessions", id);
}

// ---------------------------------------------------------------------------
// Daily records (archived, finalized betting sessions)
// ---------------------------------------------------------------------------

export async function saveDailyRecord(record: DailyRecord): Promise<void> {
  const db = await getDb();
  await db.put("dailyRecords", record);
}

export async function listDailyRecords(): Promise<DailyRecord[]> {
  const db = await getDb();
  const all = await db.getAll("dailyRecords");
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------------------------------------------------------------------------
// Individual game results (history, independent of betting)
// ---------------------------------------------------------------------------

export async function saveGameResult(
  result: Omit<GameResultRecord, "id">,
): Promise<GameResultRecord> {
  const db = await getDb();
  const record: GameResultRecord = { ...result, id: uuid() };
  await db.put("gameResults", record);
  return record;
}

export async function listGameResultsForGame(
  gameId: string,
): Promise<GameResultRecord[]> {
  const db = await getDb();
  return db.getAllFromIndex("gameResults", "by-game", gameId);
}

// ---------------------------------------------------------------------------
// Bug reports
// ---------------------------------------------------------------------------

export async function createBugReport(
  input: Omit<BugReportRecord, "id" | "status" | "createdAt">,
): Promise<BugReportRecord> {
  const db = await getDb();
  const record: BugReportRecord = {
    ...input,
    id: uuid(),
    status: "접수됨",
    createdAt: nowIso(),
  };
  await db.put("bugReports", record);
  return record;
}

export async function listBugReports(): Promise<BugReportRecord[]> {
  const db = await getDb();
  const all = await db.getAll("bugReports");
  return all
    .filter((r) => !r.isDeleted)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function updateBugReportStatus(
  id: string,
  status: BugReportStatus,
): Promise<BugReportRecord | undefined> {
  const db = await getDb();
  const record = await db.get("bugReports", id);
  if (!record) return undefined;
  const updated: BugReportRecord = { ...record, status };
  await db.put("bugReports", updated);
  return updated;
}

/**
 * Content edit for a legacy (account-less) local report. Callers must
 * independently verify the current user is an admin first (see
 * `bugReportStore.ts`'s `adminUpdateLocalReport`) — this repository layer
 * has no concept of identity, IndexedDB is local to the browser, so there
 * is no server to re-check against. Documented limitation, not an oversight.
 */
/**
 * Unlike the cloud `PATCH` route (which accepts a sparse patch because it
 * also has to serve status-only requests through the same endpoint), this
 * is only ever called by the edit form with the complete set of editable
 * fields — so a plain full-replacement merge is correct and simpler than
 * trying to distinguish "field omitted" from "field explicitly cleared".
 */
export async function updateBugReportContent(
  id: string,
  patch: Pick<BugReportRecord, "title" | "description" | "gameId" | "gameName" | "phone" | "attachment">,
): Promise<BugReportRecord | undefined> {
  const db = await getDb();
  const record = await db.get("bugReports", id);
  if (!record) return undefined;
  const updated: BugReportRecord = { ...record, ...patch, updatedAt: nowIso() };
  await db.put("bugReports", updated);
  return updated;
}

/** Soft-deletes a legacy local report — same admin-only caveat as `updateBugReportContent`. */
export async function softDeleteBugReport(id: string): Promise<boolean> {
  const db = await getDb();
  const record = await db.get("bugReports", id);
  if (!record) return false;
  await db.put("bugReports", { ...record, isDeleted: true, updatedAt: nowIso() });
  return true;
}
