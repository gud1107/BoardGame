import type { ReactNode } from "react";

/**
 * 🎬 영상 설명(Explainer) — a "YouTube board-game rules video" that is not a
 * video file: every frame is drawn live from a script, so it never goes stale
 * against an asset pipeline, costs no bandwidth and seeks instantly.
 *
 * A script is chapters → scenes → narration cues. Each cue is one subtitle
 * line that is also read aloud (browser TTS) and lasts long enough to be read.
 * A scene's `render` is a PURE function of the scene-local time, so the
 * player can scrub to any point and get the exact same frame.
 */
export interface SceneCtx {
  /** Seconds since this scene started. */
  t: number;
  /** Total length of this scene in seconds. */
  dur: number;
  /** Start time (scene-local seconds) of cue `i`; `at(cues.length)` = `dur`. */
  at: (i: number) => number;
  /** Index of the cue currently on screen. */
  cue: number;
}

export interface ExplainerScene {
  /** Narration + subtitles, one sentence-ish per entry. */
  cues: string[];
  render: (ctx: SceneCtx) => ReactNode;
  /** Extra quiet seconds at the end of the scene (let an animation land). */
  tail?: number;
}

export interface ExplainerChapter {
  title: string;
  scenes: ExplainerScene[];
}

export interface ExplainerScript {
  gameId: string;
  title: string;
  /** "animated" = hand-made scenes with real card art; "summary" = auto-built from the 30초 룰북. */
  kind: "animated" | "summary";
  chapters: ExplainerChapter[];
}
