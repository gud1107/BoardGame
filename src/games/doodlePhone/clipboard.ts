/**
 * The drawing editor's copy buffer, kept outside the editor so a copy made on
 * one drawing turn can be pasted on a later one (each turn mounts a fresh
 * DoodleCanvas).
 *
 * - Scoped to one match: entries are tagged with the match seed, and a
 *   different seed reads as empty, so a rematch starts clean.
 * - Survives a refresh/reconnect via sessionStorage (this tab only). Anything
 *   read back is re-validated like a network drawing, so a stale or
 *   hand-edited entry can't crash the renderer.
 * - Falls back to memory when storage is unavailable (private mode, SSR,
 *   tests).
 *
 * Only this player's own ops ever get here — the select tool can't grab the
 * locked base layer — so pasting can't smuggle in someone else's drawing.
 */

import { isValidDrawing, type DrawOp } from "./drawing";

const STORAGE_KEY = "doodle-phone-clipboard";

interface Entry {
  match: number;
  ops: readonly DrawOp[];
}

let memory: Entry | null = null;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function isEntry(value: unknown): value is Entry {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Partial<Entry>;
  return typeof e.match === "number" && Array.isArray(e.ops) && e.ops.length > 0 && isValidDrawing({ v: 1, ops: e.ops });
}

/** The copied ops for this match, or [] if nothing (valid) was copied in it. */
export function readClipboard(match: number): readonly DrawOp[] {
  let entry: unknown = memory;
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (raw) entry = JSON.parse(raw);
  } catch {
    // Unparseable storage — fall back to whatever memory holds.
  }
  return isEntry(entry) && entry.match === match ? entry.ops : [];
}

export function writeClipboard(match: number, ops: readonly DrawOp[]): void {
  memory = { match, ops };
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // Quota/privacy mode: the in-memory copy still works for this page load.
  }
}

/** Test hook: forget the in-memory entry. */
export function resetClipboardMemory(): void {
  memory = null;
}
