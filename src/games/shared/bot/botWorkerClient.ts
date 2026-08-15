"use client";

/**
 * Main-thread client for `botWorker.ts` — spawns (lazily, once per tab) a
 * single shared Web Worker and exposes a promise-based `requestBotAction`
 * so `useBotAutoplay` can `await` a Level 8-10 bot's move without blocking
 * the UI thread while PIMC/ISMCTS/alpha-beta run (see botWorker.ts's doc for
 * why levels 1-7 don't need this at all — they're a cheap single heuristic
 * pass, not a 100+-trial simulation).
 *
 * Falls back to calling `fallback` synchronously on the main thread whenever
 * a real Worker isn't usable: SSR (no `Worker` global), a browser without
 * Worker support, or the worker module failing to construct (e.g. a bundler
 * environment that doesn't resolve `new Worker(new URL(...))`, or the vitest
 * unit-test environment, which never spins up an actual DOM/browser). This
 * keeps every call site correct in every environment without special-casing
 * "are we in a worker-capable browser" itself.
 */

import type { BotWorkerGameId, BotWorkerRequest, BotWorkerResponse } from "./botWorker";
import type { BotLevel } from "./botDifficulty";

let worker: Worker | null = null;
let workerFailed = false;
let nextRequestId = 1;
const pending = new Map<number, { resolve: (action: unknown) => void; reject: (err: unknown) => void }>();

function getWorker(): Worker | null {
  if (workerFailed) return null;
  if (worker) return worker;
  if (typeof window === "undefined" || typeof Worker === "undefined") return null;
  try {
    worker = new Worker(new URL("./botWorker.ts", import.meta.url));
    worker.onmessage = (event: MessageEvent<BotWorkerResponse>) => {
      const entry = pending.get(event.data.requestId);
      if (!entry) return;
      pending.delete(event.data.requestId);
      if (event.data.error) entry.reject(new Error(event.data.error));
      else entry.resolve(event.data.action);
    };
    worker.onerror = () => {
      // A worker-level failure (e.g. bundling didn't resolve the chunk) —
      // permanently fall back to the main thread for the rest of this tab's
      // session rather than retrying a broken worker on every bot turn.
      workerFailed = true;
      worker = null;
      for (const [, entry] of pending) entry.reject(new Error("bot worker crashed"));
      pending.clear();
    };
    return worker;
  } catch {
    workerFailed = true;
    return null;
  }
}

/**
 * Resolves with the bot's chosen action, computed off the main thread when
 * possible. `fallback` (a synchronous call to the same game's
 * `chooseBotAction`) always runs instead whenever a worker isn't available —
 * see module doc.
 */
export function requestBotAction<Action>(
  gameId: BotWorkerGameId,
  state: unknown,
  seat: unknown,
  level: BotLevel,
  rngSeed: number,
  fallback: () => Action | null,
): Promise<Action | null> {
  const w = getWorker();
  if (!w) return Promise.resolve(fallback());

  const requestId = nextRequestId++;
  const request: BotWorkerRequest = { requestId, gameId, state, seat, level, rngSeed };
  return new Promise<Action | null>((resolve) => {
    pending.set(requestId, {
      resolve: (action) => resolve(action as Action | null),
      reject: () => resolve(fallback()), // a failed worker round-trip still shouldn't stall a real game — degrade to the synchronous path for this one decision
    });
    w.postMessage(request);
  });
}
