import type { SecureGameDef } from "./core";
import { liarSecure } from "@/games/liarGame/secure";

/** Games whose online matches can run server-authoritative. Add an entry per migrated game. */
export const SECURE_GAMES: Record<string, SecureGameDef<unknown, unknown>> = {
  "liar-game": liarSecure as unknown as SecureGameDef<unknown, unknown>,
};
