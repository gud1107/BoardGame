import { getSoundEngine } from "@/lib/audio/soundEngine";
import type { CityEvent } from "./engine";

/**
 * Maps engine events to the project's shared, code-synthesized SFX
 * (src/lib/audio/soundEngine.ts — no mp3 assets anywhere in this project).
 * Reuses existing cues only; nothing new is added to the shared engine.
 */
export function playCityEventSound(event: CityEvent) {
  const sfx = getSoundEngine();
  switch (event.kind) {
    case "thiefMove":
      sfx.playCardFlick();
      return;
    case "heliPlace":
    case "heliMove":
      sfx.playBoostWind();
      return;
    case "search":
      if (event.result === "caught") {
        sfx.playRatCallSiren();
      } else if (event.result === "trail") {
        sfx.playRadarPing();
      } else {
        sfx.playWoodTap();
      }
      return;
    case "trapped":
      sfx.playRatCallSiren();
      return;
    case "escaped":
      sfx.playFinishFanfare();
      return;
  }
}
