/**
 * Maps state transitions to SFX: this game's own turn chime (doodlePhoneSound.ts)
 * plus the shared synthesized cues for the showcase (no audio assets).
 * Called from the room adapter wherever a new state is committed, so every
 * cue fires from an event handler, never from render.
 */

import { getSoundEngine } from "@/lib/audio/soundEngine";
import { getDoodlePhoneSound } from "./doodlePhoneSound";
import { currentTurn, gamePhase, reactionTotal, type DoodlePhoneState } from "./engine";

function totalReactions(state: DoodlePhoneState): number {
  return Object.values(state.reactions).reduce((sum, tally) => sum + reactionTotal(tally), 0);
}

export function playTransitionSounds(prev: DoodlePhoneState | null, next: DoodlePhoneState | null): void {
  if (!prev || !next || prev.seed !== next.seed) return;
  const sfx = getSoundEngine();
  const prevPhase = gamePhase(prev);
  const nextPhase = gamePhase(next);
  if (nextPhase === "finished" && prevPhase !== "finished") sfx.playFinishFanfare();
  else if (nextPhase === "turns" && currentTurn(next) !== currentTurn(prev)) getDoodlePhoneSound().turnStartChime();
  else if (nextPhase === "showcase" && (prev.showcase.album !== next.showcase.album || prev.showcase.revealed !== next.showcase.revealed)) sfx.playCardFlick();
  if (totalReactions(next) > totalReactions(prev)) sfx.playUiClickTick();
}
