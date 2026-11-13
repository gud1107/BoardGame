import type { ExplainerScript } from "./types";

/**
 * Flattened, seekable timeline for an `ExplainerScript`. Pure — no React, no
 * clock — so it is unit-tested and shared by the player and its chapter list.
 */

/** Text with emoji/symbols stripped and read-aloud-friendly substitutions. */
export function speakable(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, "")
    .replace(/(\d)\s*~\s*(\d)/g, "$1에서 $2")
    .replace(/×\s*(\d)/g, " 곱하기 $1")
    .replace(/MAX→0/g, "맥스 제로")
    .replace(/[→⇒]/g, ", ")
    .replace(/[()[\]「」『』'"“”‘’]/g, " ")
    .replace(/[·…~—–]/g, ", ")
    .replace(/\s*,\s*(,\s*)+/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

/** How long a cue stays on screen at 1× — roughly Korean TTS speed plus a breath. */
export function cueSeconds(text: string): number {
  const chars = speakable(text).replace(/\s/g, "").length;
  if (chars === 0) return 1.6;
  return Math.min(14, Math.max(2.2, 0.9 + chars * 0.165));
}

export interface TimelineCue {
  text: string;
  start: number;
  end: number;
  sceneIndex: number;
  chapterIndex: number;
}

export interface TimelineScene {
  start: number;
  dur: number;
  chapterIndex: number;
  /** Scene-local start of each cue, with the scene end appended. */
  cueStarts: number[];
  /** Global index of this scene's first cue. */
  firstCue: number;
}

export interface TimelineChapter {
  title: string;
  start: number;
  end: number;
}

export interface Timeline {
  duration: number;
  cues: TimelineCue[];
  scenes: TimelineScene[];
  chapters: TimelineChapter[];
}

export function buildTimeline(script: ExplainerScript): Timeline {
  const cues: TimelineCue[] = [];
  const scenes: TimelineScene[] = [];
  const chapters: TimelineChapter[] = [];
  let clock = 0;
  script.chapters.forEach((ch, chapterIndex) => {
    const chStart = clock;
    for (const sc of ch.scenes) {
      const sceneIndex = scenes.length;
      const cueStarts: number[] = [];
      let local = 0;
      const firstCue = cues.length;
      for (const text of sc.cues) {
        cueStarts.push(local);
        const d = cueSeconds(text);
        cues.push({ text, start: clock + local, end: clock + local + d, sceneIndex, chapterIndex });
        local += d;
      }
      const dur = Math.max(local + (sc.tail ?? 0.6), 1);
      cueStarts.push(dur);
      scenes.push({ start: clock, dur, chapterIndex, cueStarts, firstCue });
      clock += dur;
    }
    chapters.push({ title: ch.title, start: chStart, end: clock });
  });
  return { duration: clock, cues, scenes, chapters };
}

/** Largest index `i` with `starts[i] <= t` (0 when before the first). */
function floorIndex<T>(items: T[], t: number, startOf: (x: T) => number): number {
  let lo = 0;
  let hi = items.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (startOf(items[mid]) <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export interface Located {
  sceneIndex: number;
  /** Scene-local time. */
  local: number;
  /** Global cue index on screen, or -1 in a scene's quiet tail. */
  cueIndex: number;
  /** Cue index inside the scene (clamped to the last cue during the tail). */
  sceneCue: number;
  chapterIndex: number;
}

export function locate(tl: Timeline, t: number): Located {
  const time = Math.min(Math.max(t, 0), Math.max(tl.duration - 1e-6, 0));
  const sceneIndex = floorIndex(tl.scenes, time, (s) => s.start);
  const sc = tl.scenes[sceneIndex];
  const local = time - sc.start;
  const n = sc.cueStarts.length - 1;
  // Compare in global time against the same numbers the cues were built with
  // (scene-local sums round differently and could drop a line at its boundary).
  let sceneCue = 0;
  for (let i = 0; i < n; i++) if (tl.cues[sc.firstCue + i].start <= time + 1e-6) sceneCue = i;
  const cue = tl.cues[sc.firstCue + sceneCue];
  const cueIndex = n > 0 && cue && time < cue.end - 1e-6 ? sc.firstCue + sceneCue : -1;
  return { sceneIndex, local, cueIndex, sceneCue, chapterIndex: sc.chapterIndex };
}

export function chapterAt(tl: Timeline, t: number): number {
  return floorIndex(tl.chapters, t, (c) => c.start);
}

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
