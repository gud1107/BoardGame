"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MatchView } from "./core";

/**
 * Browser side of a secure match (core.ts). The device keeps a random seat
 * token per room and only shares its hash; it never receives the full
 * state, just `MatchView.view` for its own seat.
 */

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** This device's seat token for a room (kept across reloads so a reconnect keeps the seat) and its hash. Null when Web Crypto is missing. */
export async function seatToken(gameKey: string, roomCode: string): Promise<{ token: string; hash: string } | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  const key = `${gameKey}-seat-token-${roomCode}`;
  let token: string | null = null;
  try {
    token = window.localStorage.getItem(key);
    if (!token) {
      token = randomHex(16);
      window.localStorage.setItem(key, token);
    }
  } catch {
    token ??= randomHex(16);
  }
  return { token, hash: await sha256Hex(token) };
}

export function storedMatchId(gameKey: string, roomCode: string): string | null {
  try {
    return window.localStorage.getItem(`${gameKey}-match-${roomCode}`);
  } catch {
    return null;
  }
}

export function storeMatchId(gameKey: string, roomCode: string, matchId: string) {
  try {
    window.localStorage.setItem(`${gameKey}-match-${roomCode}`, matchId);
  } catch {
    // reconnect after a reload just waits for the next match-start re-broadcast
  }
}

type CallResult<T> = { ok: true; data: T } | { ok: false; status: number };

async function call<T>(body: Record<string, unknown>): Promise<CallResult<T>> {
  try {
    const res = await fetch("/api/match", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** Null when the server isn't set up (503) or unreachable — the caller falls back to lockstep. */
export async function startSecureMatch(input: {
  game: string;
  playerCount: number;
  options: unknown;
  seatHashes: Record<number, string>;
  bots: Record<number, number>;
}): Promise<string | null> {
  const res = await call<{ matchId: string }>({ op: "start", ...input });
  return res.ok ? res.data.matchId : null;
}

const POLL_MS = 15_000;
/** Each later device in `tickerRank` waits this much longer before poking a due timer/bot, so usually only one does. */
const RANK_STAGGER_MS = 700;

export interface SecureMatchHandle<S> {
  view: S | null;
  /** Local-clock deadline of the current stage. */
  deadlineMs: number | null;
  act(action: unknown): void;
  refresh(): void;
  setBots(bots: Record<number, number>): void;
}

export function useSecureMatch<S>(opts: {
  matchId: string | null;
  seat: number | null;
  token: string | null;
  /** 0 for the device that should fire due timers first. */
  tickerRank: number;
  /** Tell the room a new version exists (they then fetch their own view). */
  announce(version: number): void;
}): SecureMatchHandle<S> {
  const { matchId, seat, token, tickerRank } = opts;
  const [latest, setLatest] = useState<{ matchId: string; view: S; version: number; deadlineMs: number | null; botDueMs: number | null } | null>(null);
  // A view from the previous match never shows in the next one.
  const state = latest && latest.matchId === matchId ? latest : null;
  const versionRef = useRef({ matchId: null as string | null, version: 0 });
  const announceRef = useRef(opts.announce);
  useEffect(() => {
    announceRef.current = opts.announce;
  });

  const send = useCallback(
    async (body: Record<string, unknown>) => {
      if (!matchId || seat === null || !token) return;
      const res = await call<MatchView<S>>({ ...body, matchId, seat, token });
      if (!res.ok || res.data.matchId !== matchId) return;
      const v = res.data;
      const known = versionRef.current.matchId === matchId ? versionRef.current.version : 0;
      if (v.version < known) return;
      const grew = v.version > known;
      versionRef.current = { matchId, version: v.version };
      const now = Date.now();
      setLatest({
        matchId,
        view: v.view,
        version: v.version,
        deadlineMs: v.deadlineInMs === null ? null : now + v.deadlineInMs,
        botDueMs: v.botDueInMs === null ? null : now + v.botDueInMs,
      });
      // Plain refreshes stay quiet, or every device would re-announce every version.
      if (grew && (body.op !== "view" || body.due)) announceRef.current(v.version);
    },
    [matchId, seat, token],
  );

  const refresh = useCallback(() => void send({ op: "view" }), [send]);

  useEffect(() => {
    if (!matchId) return;
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(id);
  }, [matchId, refresh]);

  // Fire the next due timer/bot. The server decides whether it's really due.
  const deadlineMs = state?.deadlineMs ?? null;
  const botDueMs = state?.botDueMs ?? null;
  const version = state?.version ?? 0;
  useEffect(() => {
    const due = [deadlineMs, botDueMs].filter((t): t is number => t !== null);
    if (due.length === 0) return;
    const wait = Math.max(0, Math.min(...due) - Date.now()) + 60 + tickerRank * RANK_STAGGER_MS;
    const id = window.setTimeout(() => void send({ op: "view", due: true }), wait);
    return () => window.clearTimeout(id);
  }, [deadlineMs, botDueMs, version, tickerRank, send]);

  return {
    view: state?.view ?? null,
    deadlineMs,
    act: useCallback((action: unknown) => void send({ op: "act", action }), [send]),
    refresh,
    setBots: useCallback((bots: Record<number, number>) => void send({ op: "bots", bots }), [send]),
  };
}
