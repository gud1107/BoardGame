import { getSoundEngine } from "@/lib/audio/soundEngine";

/**
 * Maps 랜덤 합성 디펜스 moments onto the project's shared, code-synthesized
 * SFX (src/lib/audio/soundEngine.ts — no mp3 assets). Reuses existing cues only.
 */

export function playSummon(lucky: boolean) {
  const sfx = getSoundEngine();
  if (lucky) sfx.playLuxuryChime();
  else sfx.playCardFlick();
}

export function playMerge(grade: number) {
  const sfx = getSoundEngine();
  if (grade >= 4) sfx.playHandFanfare();
  else sfx.playGridSnap();
}

export function playGamble(success: boolean) {
  const sfx = getSoundEngine();
  if (success) sfx.playLuxuryChime();
  else sfx.playWrongBuzz();
}

export function playUpgrade() {
  getSoundEngine().playCoinDropSound();
}

export function playBossWave() {
  getSoundEngine().playRevolutionBell();
}

export function playBossKill() {
  getSoundEngine().playTreasureGrab();
}

export function playEliteIncoming() {
  getSoundEngine().playDeathCardSting();
}

export function playOut() {
  getSoundEngine().playEliminationSlam();
}

export function playVictory() {
  getSoundEngine().playFinishFanfare();
}

export function playSendUnit() {
  getSoundEngine().playCardDrawWhoosh();
}
