"use client";

import type { PlayableGameProps } from "@/games/types";
import HanamikojiBoard from "./HanamikojiBoard";

/**
 * Betting-system adapter. This is the only Hanamikoji file that knows about
 * `PlayableGameProps`/`GameCompletionResult` — it translates the pure
 * game's `onGameEnd(winnerId)` into the ranking shape the betting ledger
 * expects. `HanamikojiBoard` itself has zero knowledge of betting.
 */
export default function HanamikojiGame({ participants, onComplete }: PlayableGameProps) {
  const [p1, p2] = participants;

  function handleGameEnd(winnerId: string) {
    const loserId = winnerId === p1.id ? p2.id : p1.id;
    onComplete({
      rankings: [
        { playerId: winnerId, rank: 1 },
        { playerId: loserId, rank: 2 },
      ],
      finishedAt: new Date().toISOString(),
    });
  }

  return (
    <HanamikojiBoard
      players={{ p1: { id: p1.id, name: p1.name }, p2: { id: p2.id, name: p2.name } }}
      onGameEnd={handleGameEnd}
    />
  );
}
