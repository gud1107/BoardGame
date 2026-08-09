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
  bang: dynamic(() => import("./bang/BangGame"), { ssr: false }),
  "grid-poker": dynamic(() => import("./grid-poker/GridPokerGame"), { ssr: false }),
  avalon: dynamic(() => import("./avalon/AvalonGame"), { ssr: false }),
  "no-thanks": dynamic(() => import("./no-thanks/NoThanksGame"), { ssr: false }),
  perudo: dynamic(() => import("./perudo/PerudoGame"), { ssr: false }),
  century: dynamic(() => import("./century/CenturyGame"), { ssr: false }),
  "spot-difference": dynamic(() => import("./spot-difference/SpotDifferenceGame"), { ssr: false }),
  splendor: dynamic(() => import("./splendor/SplendorGame"), { ssr: false }),
  "five-cucumbers": dynamic(() => import("./five-cucumbers/FiveCucumbersGame"), { ssr: false }),
  "las-vegas": dynamic(() => import("./lasVegas/LasVegasGame"), { ssr: false }),
  "summoners-rift": dynamic(() => import("./summonersRift/SummonersRiftGame"), { ssr: false }),
};
