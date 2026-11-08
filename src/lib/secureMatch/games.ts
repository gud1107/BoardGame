import type { SecureGameDef } from "./core";
import { liarSecure } from "@/games/liarGame/secure";
import { lanternSecure } from "@/games/lanternKeepers/secure";

/** Games whose online matches can run server-authoritative. Add an entry per migrated game. */
export const SECURE_GAMES: Record<string, SecureGameDef<unknown, unknown>> = {
  "liar-game": liarSecure as unknown as SecureGameDef<unknown, unknown>,
  "lantern-keepers": lanternSecure as unknown as SecureGameDef<unknown, unknown>,
};
