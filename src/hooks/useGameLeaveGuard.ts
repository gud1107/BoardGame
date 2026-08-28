"use client";

import { useEffect, useState } from "react";
import { reduceGameLeaveGuard } from "./gameLeaveGuard";

/**
 * Mobile back-gesture / browser back-button exit guard, shared across every
 * online-realtime game (originally built inline in DestinyWar39Game.tsx —
 * 2026-08-23 bug report: a back gesture instantly kicked the player out of
 * the game with no confirmation). None of these games ever do a real route
 * change while inside a room (join/create/play/leave are all handled by
 * internal component state — one mounted `<GameName>Game>` per game), so the
 * only way "back" can eject the player is the browser's own history stack:
 * the game's page is still just one entry in it, and a back gesture pops
 * straight past it.
 *
 * Standard "history trap": the moment `active` becomes true (a room is
 * joined), push one extra same-URL history entry. A back gesture then fires
 * `popstate` here (instead of actually navigating) because the browser pops
 * that extra entry first; the handler immediately pushes it right back
 * (cancelling the effective navigation) and opens the confirm modal instead.
 * `cancelExit` just closes the modal (the re-armed entry is already back in
 * place); `confirmExit` calls the caller-supplied `onLeave()` to return to
 * that game's own lobby screen in-place — no real cross-page navigation
 * happens either way, matching how every other exit path in these
 * components already works.
 */
export function useGameLeaveGuard(
  active: boolean,
  onLeave: () => void,
): {
  exitConfirmOpen: boolean;
  cancelExit: () => void;
  confirmExit: () => void;
} {
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);

  useEffect(() => {
    // No setState here on activate/deactivate: `exitConfirmOpen` already
    // starts `false`, and both `cancelExit`/`confirmExit` already close it
    // before `active` ever flips to false (see `handleLeave` callers), so
    // there's nothing to reconcile synchronously in the effect body itself
    // (which React's rules discourage — see react-hooks/set-state-in-effect).
    if (!active) return;
    window.history.pushState({ gameLeaveGuard: true }, "", window.location.href);
    const onPopState = () => {
      window.history.pushState({ gameLeaveGuard: true }, "", window.location.href);
      setExitConfirmOpen((prev) => reduceGameLeaveGuard(prev ? "open" : "closed", "popstate") === "open");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [active]);

  function cancelExit() {
    setExitConfirmOpen((prev) => reduceGameLeaveGuard(prev ? "open" : "closed", "cancel") === "open");
  }

  function confirmExit() {
    setExitConfirmOpen((prev) => reduceGameLeaveGuard(prev ? "open" : "closed", "confirm") === "open");
    onLeave();
  }

  return { exitConfirmOpen, cancelExit, confirmExit };
}
