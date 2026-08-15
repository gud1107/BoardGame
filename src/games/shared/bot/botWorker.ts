/**
 * Web Worker entry point for the heavy Level 8-10 bot searches (PIMC/ISMCTS/
 * alpha-beta — see five-cucumbers, perudo, and malDalliJa `engine.ts`
 * respectively). Bundled and spawned by `botWorkerClient.ts` via
 * `new Worker(new URL("./botWorker.ts", import.meta.url))`, which Turbopack
 * and Webpack both resolve as a separate worker chunk (Next.js's Turbopack
 * docs list `new Worker()` among the import forms it special-cases).
 *
 * Runs each game's *exact same* `chooseBotAction` used everywhere else
 * (main thread for levels < 8, this worker for levels 8-10, and the vitest
 * benchmark suite) — there is deliberately no separate "worker-only"
 * implementation to keep in sync. This file's only job is moving that same
 * pure computation off the UI thread.
 *
 * No "webworker" lib in tsconfig.json (this project's single tsconfig
 * targets `dom`, and TypeScript's `dom`/`webworker` lib declarations
 * conflict on the global `self`) — so the worker global scope is accessed
 * through a minimal structural type instead of relying on lib.webworker.d.ts.
 */

import type { BotLevel } from "./botDifficulty";

interface WorkerGlobalScope {
  onmessage: ((event: MessageEvent<BotWorkerRequest>) => void) | null;
  postMessage(message: BotWorkerResponse): void;
}

export type BotWorkerGameId = "five-cucumbers" | "perudo" | "malDalliJa";

export interface BotWorkerRequest {
  requestId: number;
  gameId: BotWorkerGameId;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each game's engine state/seat/action shapes are structurally distinct; the worker boundary is necessarily untyped like any postMessage payload.
  state: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  seat: any;
  level: BotLevel;
  /** Seeded so the same request replayed (e.g. a retry) is reproducible; bot decisions are local UX, not part of the deterministic engine contract, but still shouldn't depend on wall-clock Math.random inside the worker. */
  rngSeed: number;
}

export interface BotWorkerResponse {
  requestId: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  action: any;
  error?: string;
}

async function handleRequest(req: BotWorkerRequest): Promise<BotWorkerResponse> {
  const { seededRng } = await import("@/lib/rng");
  const rng = seededRng(req.rngSeed);
  try {
    switch (req.gameId) {
      case "five-cucumbers": {
        const { chooseBotAction } = await import("@/games/five-cucumbers/engine");
        return { requestId: req.requestId, action: chooseBotAction(req.state, req.seat, req.level, rng) };
      }
      case "perudo": {
        const { chooseBotAction } = await import("@/games/perudo/engine");
        return { requestId: req.requestId, action: chooseBotAction(req.state, req.seat, req.level, rng) };
      }
      case "malDalliJa": {
        const { chooseBotAction } = await import("@/games/malDalliJa/engine");
        return { requestId: req.requestId, action: chooseBotAction(req.state, req.seat, req.level, rng) };
      }
      default:
        return { requestId: req.requestId, action: null, error: `Unknown gameId: ${req.gameId}` };
    }
  } catch (err) {
    return { requestId: req.requestId, action: null, error: err instanceof Error ? err.message : String(err) };
  }
}

const ctx = (typeof self !== "undefined" ? self : undefined) as unknown as WorkerGlobalScope | undefined;

if (ctx) {
  ctx.onmessage = (event) => {
    void handleRequest(event.data).then((response) => ctx.postMessage(response));
  };
}
