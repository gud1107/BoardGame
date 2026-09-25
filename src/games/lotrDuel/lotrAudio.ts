import { getSoundEngine } from "@/lib/audio/soundEngine";

/**
 * Cues for 반지의 제왕: 가운데땅에서의 대결, all reusing the project's shared code-synthesized
 * SFX (src/lib/audio/soundEngine.ts — no mp3 assets anywhere in this project,
 * and that file is left untouched here).
 */
export const lotrSfx = {
  move: () => getSoundEngine().playWoodTap(),
  select: () => getSoundEngine().playUiClickTick(),
  battle: () => getSoundEngine().playCardSubmitImpact(),
  reveal: () => getSoundEngine().playShowdownReveal(),
  pick: () => getSoundEngine().playCardFlick(),
  death: () => getSoundEngine().playEliminationSlam(),
  escape: () => getSoundEngine().playBoostWind(),
  survive: () => getSoundEngine().playSurviveEpic(),
  victory: () => getSoundEngine().playFinishFanfare(),
  defeat: () => getSoundEngine().playPredictionLose(),
  myTurn: () => getSoundEngine().playMyTurnChime(),
};
