"use client";

import { useEffect, useRef } from "react";

/**
 * Generic "a bot seat acts on its own turn" scheduler, reused by every
 * `<Game>Game.tsx` that supports mixed human+bot lobbies (see
 * ARCHITECTURE.md §7, "신규 게임은 AI 플레이어 지원을 기본 내장한다").
 *
 * Bots have no device of their own, so exactly ONE client — the room's
 * host — should ever mount this with `active: true`. The host simulates the
 * bot's decision locally and calls `dispatch`, which broadcasts the
 * resulting `EngineAction` over the exact same channel a human's click
 * would use. Every other client just replays that action like any other —
 * this preserves the lockstep protocol's single-writer invariant
 * (docs/cloud-sync.md §1) without inventing a second sync mechanism.
 *
 * `currentActor`/`chooseAction` should be plain, stateless functions
 * (module-scope, not inline closures) so their identity stays stable across
 * renders — that keeps this effect from re-scheduling on unrelated
 * re-renders. `botSeats` should be memoized by the caller for the same
 * reason.
 *
 * `chooseAction` may return a plain value OR a Promise — most games' Level
 * 1-7 bots are one cheap heuristic pass and stay synchronous, but
 * five-cucumbers/perudo/malDalliJa route Level 8-10 through a Web Worker
 * (PIMC/ISMCTS/alpha-beta — see each engine.ts and botWorkerClient.ts) to
 * keep a 100+-trial simulation off the UI thread, which makes their
 * `chooseAction` async. Both shapes are handled identically below via
 * `Promise.resolve`.
 */
export interface UseBotAutoplayOptions<State, Action, Actor> {
  /** Only true on the host's client. */
  active: boolean;
  state: State | null;
  /** Whose decision is currently pending, or null if nobody is blocked on one (e.g. a shared "continue" screen a human always handles). */
  currentActor: (state: State) => Actor | null;
  botSeats: ReadonlySet<Actor>;
  /** Returns (or resolves to) the action to broadcast for that bot seat, or null if it has no legal move (defensive — should not normally happen since `currentActor` already implies one exists). */
  chooseAction: (state: State, actor: Actor) => Action | null | Promise<Action | null>;
  dispatch: (action: Action) => void;
  /** Natural-feeling "thinking" delay before the bot acts. Defaults to 500–1500ms per the project's bot UX standard. */
  minDelayMs?: number;
  maxDelayMs?: number;
}

export function useBotAutoplay<State, Action, Actor>({
  active,
  state,
  currentActor,
  botSeats,
  chooseAction,
  dispatch,
  minDelayMs = 500,
  maxDelayMs = 1500,
}: UseBotAutoplayOptions<State, Action, Actor>): void {
  // A given state object is only ever acted on once, even though this effect
  // re-runs whenever any dependency changes identity (e.g. a fresh
  // `botSeats` Set every render if the caller didn't memoize it).
  const actedForRef = useRef<State | null>(null);

  useEffect(() => {
    if (!active || !state) return;
    const actor = currentActor(state);
    if (actor === null || !botSeats.has(actor)) return;
    if (actedForRef.current === state) return;
    actedForRef.current = state;

    let cancelled = false;
    const delay = minDelayMs + Math.random() * Math.max(0, maxDelayMs - minDelayMs);
    const timer = window.setTimeout(() => {
      // The "thinking" delay and the (possibly async, worker-backed) search
      // itself overlap rather than stack — chooseAction is kicked off right
      // when the delay fires, same as the fully-synchronous case always did.
      void Promise.resolve(chooseAction(state, actor)).then((action) => {
        if (cancelled || !action) return;
        dispatch(action);
      });
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      // 2026-09-01 fix (말달리자 "오아시스 도착 후 멈춤" 버그 조사 중 발견): if
      // this cleanup runs *before* the scheduled dispatch above ever fired,
      // undo the "claimed" mark for `state` too — otherwise React's dev-mode
      // Strict Mode double-invoke (mount → cleanup → mount, same `state`
      // reference both times) permanently skips this bot turn: the phantom
      // first mount claims `state` via `actedForRef.current = state` above,
      // this cleanup cancels its *own* pending dispatch (correct), but the
      // *second*, real mount then sees `actedForRef.current === state`
      // already true and bails out without ever scheduling a replacement —
      // the bot silently never moves again for the rest of that turn. Any
      // *other* legitimate remount mid-game (e.g. an error-boundary reset)
      // would hit the identical trap. Only resets when we're actually
      // cancelling our own not-yet-fired dispatch, not after a successful
      // one (a fired dispatch's timer has already elapsed, so this branch is
      // a no-op then — see the module doc's reasoning).
      if (actedForRef.current === state) actedForRef.current = null;
    };
  }, [active, state, currentActor, botSeats, chooseAction, dispatch, minDelayMs, maxDelayMs]);
}
