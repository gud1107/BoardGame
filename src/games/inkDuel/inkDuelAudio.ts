import { getSoundEngine } from "@/lib/audio/soundEngine";
import type { WeaponKind } from "./analyze";
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
  playImpactKind(ev.stats.kind, ev.hits.length, ev.killed.length, ev.crit);
}

/** Impact cue from the bare facts (moving mode's events carry no full ShotEvent). */
export function playImpactKind(kind: WeaponKind, hitCount: number, killedCount: number, crit: boolean) {
  const sfx = getSoundEngine();
  if (killedCount > 0) {
    sfx.playEliminationSlam();
    return;
  }
  if (hitCount === 0) {
    sfx.playPassWhiff();
    return;
  }
  switch (kind) {
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
      sfx.playCardSlam(crit);
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
