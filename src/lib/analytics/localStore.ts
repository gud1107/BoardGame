import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

/**
 * Server-only, file-based analytics store. Replaces the Supabase-backed
 * `site_visit_log`/`monthly_visit_stats`/`game_play_log` tables (see
 * HANDOFF.md's analytics section) with a single local JSON file, per the
 * 2026-09-03 requirement to drop external services for this feature.
 *
 * Import this ONLY from Route Handlers (`runtime = "nodejs"`) — never from
 * a "use client" component; `fs`/`os`/`crypto` aren't available in the
 * browser bundle.
 *
 * ## Storage location
 * Vercel's deployed filesystem is read-only outside `os.tmpdir()`, and
 * `os.tmpdir()` itself is ephemeral there (wiped on cold start, not shared
 * across concurrent instances/regions) — confirmed with the user before
 * building this, who accepted that tradeoff explicitly ("best-effort") for
 * the Vercel-hosted production deployment. Locally (`next dev`/self-hosted
 * `next start`), `process.env.VERCEL` is unset, so this writes to
 * `<repo>/data/analytics.json`, which *is* a real persistent local file.
 *
 * ## Write path (buffer + periodic flush)
 * Every `recordVisit`/`recordGameStart`/`recordGameComplete` call updates an
 * in-memory buffer synchronously (so admin reads are always accurate within
 * one warm instance) and is durably written to disk in two ways: a
 * background timer flushes every `FLUSH_INTERVAL_MS`, and — since a
 * long-lived `setInterval` isn't guaranteed to actually fire between
 * requests on a serverless instance — every write also opportunistically
 * flushes if more than `FLUSH_INTERVAL_MS` has passed since the last one.
 * Flushing merges the buffer into whatever is already on disk (read-modify
 * -write) rather than overwriting, so counts from other instances aren't
 * clobbered.
 *
 * ## Retention
 * Unlimited — every day's counts are kept forever (confirmed with the user,
 * "무기한 누적, 초기화 없음"). No cleanup job exists here on purpose.
 */

interface DayVisits {
  /** Total visit events that day. */
  pv: number;
  /** Hashed anonymous device ids seen that day (see `hashDeviceId`) — the raw array, not just a count, so multiple flush batches from different instances can be unioned without double-counting a returning visitor. */
  uv: string[];
}

interface DayGameStats {
  starts: number;
  completes: number;
}

export interface AnalyticsSnapshot {
  /** Keyed by UTC day, 'YYYY-MM-DD'. */
  visits: Record<string, DayVisits>;
  /** Keyed by UTC day, then by gameId. */
  games: Record<string, Record<string, DayGameStats>>;
}

const FLUSH_INTERVAL_MS = 2 * 60 * 1000; // 2 min — middle of the requested "1~5분" range

const DATA_DIR = process.env.VERCEL ? path.join(os.tmpdir(), "boardgame-analytics") : path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "analytics.json");

function emptySnapshot(): AnalyticsSnapshot {
  return { visits: {}, games: {} };
}

/** In-memory events not yet written to disk. */
let pending: AnalyticsSnapshot = emptySnapshot();
let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushing: Promise<void> | null = null;
let lastFlushAt = Date.now();

/** UTC day key, consistent with `monthKey()`'s UTC convention in aggregate.ts. */
function dayKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Shortens+anonymizes the client's localStorage device id before it ever touches disk. */
function hashDeviceId(id: string): string {
  return createHash("sha256").update(id).digest("hex").slice(0, 16);
}

function mergeSnapshots(base: AnalyticsSnapshot, extra: AnalyticsSnapshot): AnalyticsSnapshot {
  const visits: Record<string, DayVisits> = { ...base.visits };
  for (const [day, v] of Object.entries(extra.visits)) {
    const cur = visits[day] ?? { pv: 0, uv: [] };
    visits[day] = { pv: cur.pv + v.pv, uv: [...new Set([...cur.uv, ...v.uv])] };
  }

  const games: Record<string, Record<string, DayGameStats>> = { ...base.games };
  for (const [day, byGame] of Object.entries(extra.games)) {
    const curDay = { ...(games[day] ?? {}) };
    for (const [gameId, stats] of Object.entries(byGame)) {
      const cur = curDay[gameId] ?? { starts: 0, completes: 0 };
      curDay[gameId] = { starts: cur.starts + stats.starts, completes: cur.completes + stats.completes };
    }
    games[day] = curDay;
  }

  return { visits, games };
}

async function readDiskSnapshot(): Promise<AnalyticsSnapshot> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<AnalyticsSnapshot>;
    return { visits: parsed.visits ?? {}, games: parsed.games ?? {} };
  } catch {
    // First run (no file yet) or a corrupted/unreadable file — start clean
    // rather than throwing; analytics is best-effort and must never break
    // the request that triggered it.
    return emptySnapshot();
  }
}

/** Merges the pending buffer into the on-disk file and clears the buffer. Safe to call concurrently — overlapping calls await the same in-flight flush. */
async function flushToDisk(): Promise<void> {
  if (flushing) return flushing;
  const toFlush = pending;
  pending = emptySnapshot(); // reset now so writes that happen during the flush accumulate separately
  flushing = (async () => {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const disk = await readDiskSnapshot();
      const merged = mergeSnapshots(disk, toFlush);
      // Write-then-rename instead of a direct write so a crash mid-write
      // can never leave `analytics.json` half-written/corrupted.
      const tmpFile = path.join(DATA_DIR, `.analytics.${process.pid}.${randomUUID()}.tmp`);
      await fs.writeFile(tmpFile, JSON.stringify(merged), "utf8");
      await fs.rename(tmpFile, DATA_FILE);
      lastFlushAt = Date.now();
    } catch (err) {
      // Put the unflushed data back rather than losing it — the next
      // successful flush will pick it up.
      pending = mergeSnapshots(pending, toFlush);
      console.error("[analytics] flush to disk failed", err);
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

function ensureFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => void flushToDisk(), FLUSH_INTERVAL_MS);
  // Don't hold the process open just for this timer (matters for local
  // `next dev`/short-lived scripts; harmless on a long-running server).
  flushTimer.unref?.();
}

/** Starts the background timer on first use and opportunistically flushes if it's been stale for a while — the safety net for serverless instances where a long-lived interval may not get to fire between requests. */
function touch(): void {
  ensureFlushTimer();
  if (Date.now() - lastFlushAt >= FLUSH_INTERVAL_MS) void flushToDisk();
}

export function recordVisit(deviceId: string): void {
  const day = dayKey();
  const id = hashDeviceId(deviceId);
  const cur = pending.visits[day] ?? { pv: 0, uv: [] };
  cur.pv += 1;
  if (!cur.uv.includes(id)) cur.uv.push(id);
  pending.visits[day] = cur;
  touch();
}

export function recordGameStart(gameId: string): void {
  const day = dayKey();
  const byGame = pending.games[day] ?? {};
  const cur = byGame[gameId] ?? { starts: 0, completes: 0 };
  cur.starts += 1;
  byGame[gameId] = cur;
  pending.games[day] = byGame;
  touch();
}

export function recordGameComplete(gameId: string): void {
  const day = dayKey();
  const byGame = pending.games[day] ?? {};
  const cur = byGame[gameId] ?? { starts: 0, completes: 0 };
  cur.completes += 1;
  byGame[gameId] = cur;
  pending.games[day] = byGame;
  touch();
}

/** Disk contents merged with whatever hasn't flushed yet — always up to date within this instance, regardless of the flush timer's cadence. */
export async function readSnapshot(): Promise<AnalyticsSnapshot> {
  touch();
  const disk = await readDiskSnapshot();
  return mergeSnapshots(disk, pending);
}
