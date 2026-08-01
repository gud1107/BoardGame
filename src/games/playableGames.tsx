import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { GameId, PlayableGameProps } from "./types";

/**
 * Registry of actual React implementations, keyed by GameId. Every entry
 * here must have `playable: true` in `registry.ts`. Dynamically imported so
 * the dashboard bundle never grows with the number of implemented games.
 */
export const PLAYABLE_GAME_COMPONENTS: Record<GameId, ComponentType<PlayableGameProps>> = {
  hanamikoji: dynamic(() => import("./hanamikoji/HanamikojiGame"), { ssr: false }),
};
