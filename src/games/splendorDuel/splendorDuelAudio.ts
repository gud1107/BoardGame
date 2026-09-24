import { getSoundEngine } from "@/lib/audio/soundEngine";
import type { DuelEvent } from "./engine";

/**
 * Maps engine events to the project's shared, code-synthesized SFX
 * (src/lib/audio/soundEngine.ts — no mp3 assets anywhere in this project).
 * Every cue here reuses an existing sound rather than adding new synth code
 * to the shared engine.
 */
export function playDuelEventSound(event: DuelEvent) {
  const sfx = getSoundEngine();
  switch (event.kind) {
    case "take":
      if (event.penalty) sfx.playChainRattle();
      else sfx.playChipSettle();
      return;
    case "takeMatching":
    case "discard":
      sfx.playChipSettle();
      return;
    case "scrollUse":
      sfx.playParchmentSubmit();
      return;
    case "refill":
      sfx.playCasinoDiceRoll(500);
      return;
    case "reserve":
      sfx.playCardFlick();
      return;
    case "buy":
      sfx.playCardSubmitImpact();
      return;
    case "royal":
      sfx.playRankFanfare();
      return;
    case "steal":
      sfx.playChainRattle();
      return;
    case "copy":
    case "extraTurn":
      sfx.playReverseSpark();
      return;
    case "pass":
      sfx.playUiClickTick();
      return;
  }
}

export function playDuelVictorySound() {
  getSoundEngine().playFinishFanfare();
}
