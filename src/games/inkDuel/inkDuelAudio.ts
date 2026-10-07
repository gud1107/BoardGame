import { getSoundEngine } from "@/lib/audio/soundEngine";
import type { InkEvent } from "./engine";

/**
 * Maps 낙서 결투 moments onto the project's shared, code-synthesized SFX
 * (src/lib/audio/soundEngine.ts — no mp3 assets). Reuses existing cues only.
 */

type ShotEvent = Extract<InkEvent, { kind: "shot" }>;

export function playCardRevealSound() {
  getSoundEngine().playCardFlick();
}

export function playLaunchSound() {
  getSoundEngine().playCardDrawWhoosh();
}

export function playImpactSound(ev: ShotEvent) {
  const sfx = getSoundEngine();
  if (ev.killed.length > 0) {
    sfx.playEliminationSlam();
    return;
  }
  if (ev.hits.length === 0) {
    sfx.playPassWhiff();
    return;
  }
  switch (ev.stats.kind) {
    case "bomb":
      sfx.playMineBlast();
      return;
    case "lightning":
      sfx.playLwaClashSpark();
      return;
    case "spear":
      sfx.playCardSubmitImpact();
      return;
    default:
      sfx.playCardSlam(ev.crit);
  }
}

export function playWallSound() {
  getSoundEngine().playWoodTap();
}

export function playMyTurnSound() {
  getSoundEngine().playMyTurnChime();
}

export function playScribbleTick() {
  getSoundEngine().playUiClickTick();
}

export function playVictorySound() {
  getSoundEngine().playFinishFanfare();
}
