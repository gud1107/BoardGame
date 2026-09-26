import type { DuelEvent } from "./engine";
import { getSplendorDuelSound } from "./splendorDuelSound";

/**
 * Engine events → this game's own procedural Renaissance sound suite
 * (splendorDuelSound.ts — no audio files). Mute/volume follow the site-wide
 * audio settings store like every other game.
 */
export function playDuelEventSound(event: DuelEvent) {
  getSplendorDuelSound().event(event);
}

export function playDuelVictorySound() {
  getSplendorDuelSound().victory();
}
