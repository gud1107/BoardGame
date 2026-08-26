/**
 * Themed background-music playback for the six hub games — real royalty-free
 * `<audio>` tracks (native HTMLAudioElement, no new library — see this
 * session's brief), a deliberately separate pipeline from `soundEngine.ts`'s
 * synthesized SFX/legacy-ambient-loop. Volume/mute both read live from the
 * shared `audioSettings.ts` store's `bgmMuted`/`bgmVolume`, so the settings
 * modal's BGM slider and the header's master toggle affect this the same way
 * they affect the synthesized ambient loop.
 *
 * Track files are **not bundled with the repo** (see `저작권, 상표권.md` —
 * this project has never shipped a real audio file, precisely because
 * background music is copyright-protected expression). Each id below maps to
 * a `public/assets/sounds/bgm/*.mp3` path the user places by hand after
 * downloading a royalty-free track (Pixabay Content License picks were
 * proposed in this session's chat). Until a file exists at that path, the
 * browser's own `error` event fires once and this manager silently gives up
 * on that id — no thrown error, no retry storm, no console spam beyond one
 * warning — so the rest of the app (and every other track) is unaffected by
 * a game whose file hasn't been dropped in yet.
 *
 * `crossfadeTo(id)` fades the currently-playing track out while fading the
 * new one in over `CROSSFADE_MS`, then stops/frees the old element.
 * `crossfadeTo(null)` fades out to silence (e.g. leaving every themed game
 * back to the lobby's own call, or a page with no BGM at all).
 */

import { isBgmEffectivelyMuted, useAudioSettingsStore } from "./audioSettings";

export type BgmTrackId = "lobby" | "destinyWar39" | "lasVegas" | "gridPoker" | "malDalliJa" | "dalmuti";

const BGM_SRC: Record<BgmTrackId, string> = {
  lobby: "/assets/sounds/bgm/lobby.mp3",
  destinyWar39: "/assets/sounds/bgm/destiny-war-39.mp3",
  lasVegas: "/assets/sounds/bgm/las-vegas.mp3",
  gridPoker: "/assets/sounds/bgm/grid-poker.mp3",
  malDalliJa: "/assets/sounds/bgm/mal-dalli-ja.mp3",
  dalmuti: "/assets/sounds/bgm/dalmuti.mp3",
};

const CROSSFADE_MS = 900;
const FADE_STEP_MS = 40;

function targetVolume(): number {
  const settings = useAudioSettingsStore.getState();
  return isBgmEffectivelyMuted(settings) ? 0 : settings.bgmVolume;
}

class BgmManager {
  private current: HTMLAudioElement | null = null;
  private currentId: BgmTrackId | null = null;
  /** One-shot per id — an id whose file 404s/errors once is never retried this session. */
  private failedIds = new Set<BgmTrackId>();
  private fadeTimers = new Set<ReturnType<typeof setInterval>>();
  private subscribed = false;

  constructor() {
    this.subscribeToSettings();
  }

  private subscribeToSettings() {
    if (this.subscribed || typeof window === "undefined") return;
    this.subscribed = true;
    useAudioSettingsStore.subscribe(() => {
      if (this.current && !this.isFading) this.current.volume = targetVolume();
    });
  }

  /** True while a crossfade's own interval is actively driving `.volume` — settings changes mid-fade are picked up by the fade loop itself, not the subscription above, to avoid the two fighting. */
  private isFading = false;

  private clearFadeTimers() {
    for (const t of this.fadeTimers) clearInterval(t);
    this.fadeTimers.clear();
  }

  /** Crossfades to `id`'s themed track, looping it, or fades to silence for `null`. Safe to call repeatedly (e.g. re-entering the same room) — a no-op if already playing `id`. */
  crossfadeTo(id: BgmTrackId | null) {
    if (typeof window === "undefined") return;
    if (id === this.currentId) return;
    this.clearFadeTimers();
    this.isFading = true;

    const outgoing = this.current;
    const outgoingStartVolume = outgoing?.volume ?? 0;

    let incoming: HTMLAudioElement | null = null;
    if (id && !this.failedIds.has(id)) {
      incoming = new Audio(BGM_SRC[id]);
      incoming.loop = true;
      incoming.volume = 0;
      incoming.addEventListener(
        "error",
        () => {
          this.failedIds.add(id);
          console.warn(`[bgmManager] "${id}" BGM 파일을 찾을 수 없어 무음으로 진행합니다: ${BGM_SRC[id]}`);
        },
        { once: true },
      );
      incoming.play().catch(() => {
        // Autoplay rejected (no user gesture yet, or still muted) — harmless;
        // volume 0 either way, and the next real gesture's unlock() retries.
      });
    }

    this.current = incoming;
    this.currentId = id;

    const finalVolume = targetVolume();
    const steps = Math.max(1, Math.round(CROSSFADE_MS / FADE_STEP_MS));
    let step = 0;
    const timer = setInterval(() => {
      step++;
      const progress = Math.min(1, step / steps);
      if (outgoing) {
        outgoing.volume = outgoingStartVolume * (1 - progress);
      }
      if (incoming) {
        incoming.volume = finalVolume * progress;
      }
      if (progress >= 1) {
        clearInterval(timer);
        this.fadeTimers.delete(timer);
        if (outgoing) {
          outgoing.pause();
          outgoing.src = "";
        }
        this.isFading = this.fadeTimers.size > 0;
      }
    }, FADE_STEP_MS);
    this.fadeTimers.add(timer);
  }

  /** Immediately stops whatever is playing, no fade — for unmount paths that don't want a lingering fade timer outliving the component. */
  stop() {
    this.clearFadeTimers();
    this.isFading = false;
    if (this.current) {
      this.current.pause();
      this.current.src = "";
    }
    this.current = null;
    this.currentId = null;
  }
}

let instance: BgmManager | null = null;

export function getBgmManager(): BgmManager {
  if (!instance) instance = new BgmManager();
  return instance;
}
