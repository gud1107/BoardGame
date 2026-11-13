"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExplainerScript } from "./types";
import { buildTimeline, chapterAt, formatTime, locate } from "./timeline";
import { isSpeaking, speak, speechSupported, stopSpeech, unlockSpeech } from "./narration";
import { STAGE_H, STAGE_W } from "./stage";
import { cameraAt, clampSpeed, MAX_SPEED, MIN_SPEED, moteAt, SPEED_PRESETS, speedLabel, stepSpeed, transitionAt } from "./cinema";
import { stopMusic, unlockMusic, updateMusic, whoosh } from "./explainerAudio";

/** Longest the clock waits at a cue boundary for slow TTS to finish (real seconds). */
const MAX_HOLD = 3.5;
/** Press-and-hold on the picture plays at 2× until released (YouTube mobile). */
const HOLD_MS = 450;
const MOTES = 16;

type Quality = "hd" | "lite";
type Menu = null | "main" | "speed" | "quality";

function readSpeed(): number {
  try {
    const v = Number(localStorage.getItem("explainer:speed"));
    return v > 0 ? clampSpeed(v) : 1;
  } catch {
    return 1;
  }
}
function readQuality(): Quality {
  try {
    const v = localStorage.getItem("explainer:quality");
    if (v === "hd" || v === "lite") return v;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return "lite";
  } catch {
    // fall through
  }
  return "hd";
}
function writeStr(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    // per-session only
  }
}

function readPref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}
function writePref(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    // per-session only
  }
}

/**
 * YouTube-like player for an `ExplainerScript`: big play button, red seek bar
 * split into chapters with hover previews, speed menu, subtitles (CC),
 * narration toggle, fullscreen, chapter list, keyboard shortcuts
 * (Space/K, ←/→ 5초, J/L 10초, F, C, M). Frames are rendered live.
 */
export default function ExplainerPlayer({ script, onFinish, finishLabel = "방 만들러 가기" }: { script: ExplainerScript; onFinish?: () => void; finishLabel?: string }) {
  const tl = useMemo(() => buildTimeline(script), [script]);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [speed, setSpeed] = useState<number>(readSpeed);
  const [captions, setCaptions] = useState(() => readPref("explainer:captions", true));
  const [voiceOn, setVoiceOn] = useState(() => readPref("explainer:voice", true));
  const [musicOn, setMusicOn] = useState(() => readPref("explainer:music", true));
  const [quality, setQuality] = useState<Quality>(readQuality);
  const [menu, setMenu] = useState<Menu>(null);
  /** Centre-screen "1.5×" / "▶▶ 2×" badge, like YouTube's. */
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  const [boosting, setBoosting] = useState(false);
  const [controlsShown, setControlsShown] = useState(true);
  const [hover, setHover] = useState<{ x: number; t: number; w: number } | null>(null);
  const [scale, setScale] = useState(0.5);
  const [nativeFull, setNativeFull] = useState(false);
  /** iPhone Safari has no element Fullscreen API — fill the window with CSS instead. */
  const [cssFull, setCssFull] = useState(false);
  const isFull = nativeFull || cssFull;
  const [ended, setEnded] = useState(false);
  const flatScenes = useMemo(() => script.chapters.flatMap((c) => c.scenes), [script]);

  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const speedRef = useRef(speed);
  const voiceRef = useRef(voiceOn);
  const musicRef = useRef(musicOn);
  const lastSceneRef = useRef(-1);
  const toastTimer = useRef<number | undefined>(undefined);
  const holdTimer = useRef<number | undefined>(undefined);
  /** Speed to restore when a press-and-hold 2× ends (null = not boosting). */
  const boostFrom = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const lastCueRef = useRef(-2);
  const holdRef = useRef(0);
  const cancelSpeechRef = useRef<() => void>(() => {});
  const frameRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const scrubbing = useRef(false);

  // Fit the 1600×900 stage into the frame.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / STAGE_W));
    ro.observe(el);
    setScale(el.clientWidth / STAGE_W);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onFs = () => setNativeFull(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const say = useCallback(
    (cueIndex: number) => {
      cancelSpeechRef.current();
      cancelSpeechRef.current = () => {};
      if (!voiceRef.current || cueIndex < 0) return;
      cancelSpeechRef.current = speak(tl.cues[cueIndex].text, speedRef.current);
    },
    [tl],
  );

  const seek = useCallback(
    (t: number) => {
      const nt = Math.min(Math.max(t, 0), tl.duration);
      timeRef.current = nt;
      holdRef.current = 0;
      setTime(nt);
      const loc = locate(tl, nt);
      cancelSpeechRef.current();
      cancelSpeechRef.current = () => {};
      // Landing at the very start of a cue reads it; mid-cue waits for the next line.
      if (loc.cueIndex >= 0 && nt - tl.cues[loc.cueIndex].start < 0.6) {
        lastCueRef.current = -2;
      } else {
        lastCueRef.current = loc.cueIndex;
      }
      if (nt < tl.duration) setEnded(false);
    },
    [tl],
  );

  const poke = useCallback(() => {
    setControlsShown(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (playingRef.current) {
        setControlsShown(false);
        setMenu(null);
      }
    }, 2600);
  }, []);

  const play = useCallback(() => {
    unlockSpeech();
    unlockMusic();
    if (timeRef.current >= tl.duration - 0.05) seek(0);
    setStarted(true);
    setEnded(false);
    playingRef.current = true;
    setPlaying(true);
    poke();
  }, [seek, tl.duration, poke]);

  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    cancelSpeechRef.current();
    cancelSpeechRef.current = () => {};
    // resume re-reads the line on screen from its start
    lastCueRef.current = -2;
    const loc = locate(tl, timeRef.current);
    if (loc.cueIndex >= 0) {
      const t = tl.cues[loc.cueIndex].start + 1e-3;
      timeRef.current = t;
      setTime(t);
    }
  }, [tl]);

  const toggle = useCallback(() => (playingRef.current ? pause() : play()), [pause, play]);

  // Clock.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const realDt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (playingRef.current && !scrubbing.current) {
        let t = timeRef.current;
        const loc = locate(tl, t);
        if (loc.cueIndex !== lastCueRef.current) {
          lastCueRef.current = loc.cueIndex;
          if (loc.cueIndex >= 0) say(loc.cueIndex);
        }
        let next = t + realDt * speedRef.current;
        const cue = loc.cueIndex >= 0 ? tl.cues[loc.cueIndex] : null;
        if (cue && next >= cue.end && voiceRef.current && isSpeaking() && holdRef.current < MAX_HOLD) {
          holdRef.current += realDt;
          next = Math.max(t, cue.end - 0.001);
        } else if (!cue || next < cue.end) {
          // still inside the line
        } else holdRef.current = 0;
        t = next;
        // Scene change → whoosh (skipped while scrubbing/seeking far).
        const nowScene = locate(tl, t).sceneIndex;
        if (nowScene !== lastSceneRef.current) {
          if (nowScene === lastSceneRef.current + 1 && musicRef.current) whoosh(tl.scenes[nowScene].chapterIndex !== tl.scenes[nowScene - 1]?.chapterIndex);
          lastSceneRef.current = nowScene;
        }
        if (t >= tl.duration) {
          t = tl.duration;
          playingRef.current = false;
          setPlaying(false);
          setEnded(true);
          setControlsShown(true);
        }
        timeRef.current = t;
        setTime(t);
      }
      updateMusic(timeRef.current, playingRef.current && musicRef.current, isSpeaking());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [tl, say]);

  // Stop talking when the player goes away or the tab hides.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden && playingRef.current) pause();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      cancelSpeechRef.current();
      stopSpeech();
      stopMusic();
    };
  }, [pause]);

  const chrome = controlsShown || !playing;

  const setRate = useCallback((raw: number, closeMenu = true) => {
    const s = clampSpeed(raw);
    boostFrom.current = null;
    setBoosting(false);
    speedRef.current = s;
    setSpeed(s);
    writeStr("explainer:speed", String(s));
    if (closeMenu) setMenu(null);
    window.clearTimeout(toastTimer.current);
    setToast((prev) => ({ text: s === 1 ? "1×" : `${s}×`, n: (prev?.n ?? 0) + 1 }));
    toastTimer.current = window.setTimeout(() => setToast(null), 700);
  }, []);
  const toggleMusic = () => {
    const v = !musicRef.current;
    musicRef.current = v;
    setMusicOn(v);
    writePref("explainer:music", v);
    if (v) unlockMusic();
  };
  const pickQuality = (q: Quality) => {
    setQuality(q);
    writeStr("explainer:quality", q);
    setMenu(null);
  };
  // Press-and-hold the picture → 2× while held.
  const onFrameDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !playingRef.current) return;
    window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => {
      if (!playingRef.current || speedRef.current >= MAX_SPEED) return;
      boostFrom.current = speedRef.current;
      speedRef.current = MAX_SPEED;
      suppressClick.current = true;
      setBoosting(true);
    }, HOLD_MS);
  };
  const endBoost = () => {
    window.clearTimeout(holdTimer.current);
    if (boostFrom.current !== null) {
      speedRef.current = boostFrom.current;
      boostFrom.current = null;
      setBoosting(false);
    }
  };
  const toggleVoice = () => {
    const v = !voiceRef.current;
    voiceRef.current = v;
    setVoiceOn(v);
    writePref("explainer:voice", v);
    if (!v) {
      cancelSpeechRef.current();
      cancelSpeechRef.current = () => {};
    } else unlockSpeech();
  };
  const toggleCaptions = () =>
    setCaptions((c) => {
      writePref("explainer:captions", !c);
      return !c;
    });
  const cssFullRef = useRef(false);
  useEffect(() => {
    cssFullRef.current = cssFull;
  }, [cssFull]);
  const toggleFull = useCallback(() => {
    const el = shellRef.current;
    if (!el) return;
    if (cssFullRef.current) return setCssFull(false);
    if (document.fullscreenElement) return void document.exitFullscreen?.();
    if (typeof el.requestFullscreen === "function" && document.fullscreenEnabled !== false) {
      el.requestFullscreen().catch(() => setCssFull(true));
    } else setCssFull(true);
  }, []);
  useEffect(() => {
    if (!cssFull) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        setCssFull(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cssFull]);

  const chapterIdx = chapterAt(tl, time);
  const jumpChapter = (dir: 1 | -1) => {
    const cur = tl.chapters[chapterIdx];
    if (dir === -1 && time - cur.start > 2) return seek(cur.start);
    const target = tl.chapters[chapterIdx + dir];
    if (target) seek(target.start);
    else if (dir === 1) seek(tl.duration);
  };

  // Keyboard shortcuts (while this player is mounted).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.altKey || e.ctrlKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k === " " || k === "k") {
        e.preventDefault();
        toggle();
      } else if (e.key === ">" || (e.shiftKey && e.code === "Period")) setRate(stepSpeed(speedRef.current, 1));
      else if (e.key === "<" || (e.shiftKey && e.code === "Comma")) setRate(stepSpeed(speedRef.current, -1));
      else if (/^[0-9]$/.test(e.key)) seek((tl.duration * Number(e.key)) / 10);
      else if (k === "arrowleft") seek(timeRef.current - 5);
      else if (k === "arrowright") seek(timeRef.current + 5);
      else if (k === "j") seek(timeRef.current - 10);
      else if (k === "l") seek(timeRef.current + 10);
      else if (k === "f") toggleFull();
      else if (k === "c") toggleCaptions();
      else if (k === "m") toggleVoice();
      else return;
      poke();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, seek, poke, toggleFull, setRate, tl.duration]);

  // Seek bar pointer handling.
  const timeFromX = (clientX: number) => {
    const r = barRef.current!.getBoundingClientRect();
    return (Math.min(Math.max(clientX - r.left, 0), r.width) / r.width) * tl.duration;
  };
  const onBarDown = (e: React.PointerEvent) => {
    scrubbing.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    seek(timeFromX(e.clientX));
  };
  const onBarMove = (e: React.PointerEvent) => {
    const r = barRef.current!.getBoundingClientRect();
    setHover({ x: Math.min(Math.max(e.clientX - r.left, 0), r.width), t: timeFromX(e.clientX), w: r.width });
    if (scrubbing.current) seek(timeFromX(e.clientX));
  };
  const onBarUp = () => {
    scrubbing.current = false;
  };

  // Current frame (before first play: a nicer poster frame a moment in).
  const shownTime = started ? time : Math.min(2.4, tl.duration * 0.5);
  const loc = locate(tl, shownTime);
  const hd = quality === "hd";
  const renderScene = (i: number, local: number, cue: number) => {
    const meta = tl.scenes[i];
    const node = flatScenes[i].render({
      t: local,
      dur: meta.dur,
      at: (k) => meta.cueStarts[Math.min(Math.max(k, 0), meta.cueStarts.length - 1)],
      cue,
    });
    if (!hd) return node;
    const cam = cameraAt(i, local, meta.dur);
    return (
      <div className="absolute inset-0" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.scale})`, transformOrigin: "50% 50%" }}>
        {node}
      </div>
    );
  };
  const current = renderScene(loc.sceneIndex, loc.local, loc.sceneCue);
  const trans = hd ? transitionAt(tl, loc.sceneIndex, loc.local) : null;
  let frame = current;
  if (trans) {
    const prevMeta = tl.scenes[trans.from];
    const outgoing = renderScene(trans.from, prevMeta.dur - 1e-3, prevMeta.cueStarts.length - 2);
    const p = trans.p;
    frame = (
      <>
        <div className="absolute inset-0" style={trans.kind === "fade" ? undefined : { transform: `scale(${1 + 0.06 * p})`, filter: `brightness(${1 - 0.5 * p})` }}>
          {outgoing}
        </div>
        <div
          className="absolute inset-0"
          style={
            trans.kind === "fade"
              ? { opacity: p }
              : { clipPath: `circle(${p * 105}% at 50% 50%)`, transform: `scale(${1.04 - 0.04 * p})` }
          }
        >
          {current}
        </div>
      </>
    );
  }
  const motes = hd ? Array.from({ length: MOTES }, (_, i) => moteAt(i, shownTime)) : [];
  const caption = started && loc.cueIndex >= 0 ? tl.cues[loc.cueIndex].text.trim() || null : null;
  const noVoice = !speechSupported();
  // On phone-width players an overlaid 2-line subtitle hides a quarter of the
  // picture — put it in a bar under the video instead (overlay again in fullscreen).
  const narrow = scale * STAGE_W < 560 && !isFull;

  return (
    <div className="flex w-full flex-col gap-3 lg:flex-row lg:items-start">
      <div
        ref={shellRef}
        className={`group overflow-hidden bg-black select-none ${
          // never combine with `relative` — Tailwind's `relative` comes later in the CSS and wins over `fixed`
          cssFull ? "fixed inset-0 z-[300] flex items-center justify-center" : `relative w-full lg:flex-1 ${isFull ? "flex items-center" : narrow && captions ? "rounded-t-xl" : "rounded-xl"}`
        }`}
        onPointerMove={poke}
        style={{ cursor: chrome ? undefined : "none" }}
      >
        <div
          ref={frameRef}
          style={cssFull ? { width: "min(100vw, calc(100dvh * 16 / 9))" } : undefined}
          className="relative aspect-video w-full overflow-hidden"
          onPointerDown={onFrameDown}
          onPointerUp={endBoost}
          onPointerLeave={endBoost}
          onPointerCancel={endBoost}
          onContextMenu={(e) => e.preventDefault()}
          onClick={() => {
            if (suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            if (menu) setMenu(null);
            else toggle();
          }}
        >
          <div className="absolute top-0 left-0 origin-top-left overflow-hidden" style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})` }}>
            {frame}
            {hd && (
              <div className="pointer-events-none absolute inset-0 mix-blend-screen">
                {motes.map((m, i) => (
                  <div
                    key={i}
                    className="absolute rounded-full"
                    style={{
                      left: m.x - m.r,
                      top: m.y - m.r,
                      width: m.r * 2,
                      height: m.r * 2,
                      opacity: m.o,
                      background: "radial-gradient(circle, rgba(255,244,214,.9) 0%, rgba(255,244,214,0) 70%)",
                    }}
                  />
                ))}
                {/* lens vignette + faint top light, like a filmed table */}
                <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(255,240,200,.08), transparent 55%)" }} />
              </div>
            )}
          </div>

          {/* Speed badge (key presses / menu) and press-and-hold 2× */}
          {boosting && (
            <div className="pointer-events-none absolute top-[8%] left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs font-bold text-white sm:text-sm">
              2배속 ▶▶
            </div>
          )}
          {toast && !boosting && (
            <div key={toast.n} className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-xl bg-black/65 px-5 py-2 text-lg font-black text-white sm:text-2xl">
              {toast.text}
            </div>
          )}

          {/* Subtitles */}
          {captions && caption && !narrow && (
            <div
              className="pointer-events-none absolute inset-x-0 flex justify-center px-[4%] transition-[bottom]"
              style={{ bottom: chrome ? "16%" : "6%" }}
            >
              <span
                className="max-w-[92%] rounded-md bg-black/75 px-[0.6em] py-[0.25em] text-center leading-snug font-semibold break-keep text-white"
                style={{ fontSize: Math.max(13, 34 * scale) }}
              >
                {caption}
              </span>
            </div>
          )}

          {/* Title bar */}
          <div
            className={`pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent px-4 pt-3 pb-8 transition-opacity ${chrome ? "opacity-100" : "opacity-0"}`}
          >
            <div className="text-sm font-bold text-white sm:text-base">{script.title}</div>
            <div className="text-xs text-white/70">
              {tl.chapters[chapterIdx]?.title}
              {script.kind === "summary" && " · 30초 룰북 요약판"}
            </div>
          </div>

          {/* Big play button / end screen */}
          {!started && (
            <button
              type="button"
              aria-label="재생"
              onClick={(e) => {
                e.stopPropagation();
                play();
              }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/35"
            >
              <span className="flex h-16 w-24 items-center justify-center rounded-2xl bg-red-600 text-3xl text-white shadow-xl transition group-hover:scale-105 sm:h-20 sm:w-28">
                ▶
              </span>
              <span className="rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white">
                {formatTime(tl.duration)} · 챕터 {tl.chapters.length}개{noVoice ? " · 자막만" : ""}
              </span>
            </button>
          )}
          {ended && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70" onClick={(e) => e.stopPropagation()}>
              <div className="text-lg font-black text-white sm:text-2xl">설명 끝! 이제 직접 해 볼까요?</div>
              <div className="flex gap-2">
                <button type="button" onClick={play} className="rounded-full bg-white/15 px-4 py-2 text-sm font-bold text-white hover:bg-white/25">
                  ↻ 다시 보기
                </button>
                {onFinish && (
                  <button type="button" onClick={onFinish} className="rounded-full bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500">
                    {finishLabel}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div
          className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-3 pt-8 pb-2 transition-opacity ${
            chrome ? "opacity-100" : "pointer-events-none opacity-0"
          } ${!started ? "hidden" : ""}`}
        >
          {/* Seek bar with chapter segments */}
          <div
            ref={barRef}
            className="relative flex h-4 cursor-pointer touch-none items-center"
            onPointerDown={onBarDown}
            onPointerMove={onBarMove}
            onPointerUp={onBarUp}
            onPointerCancel={onBarUp}
            onPointerLeave={() => setHover(null)}
            role="slider"
            aria-label="재생 위치"
            aria-valuemin={0}
            aria-valuemax={Math.round(tl.duration)}
            aria-valuenow={Math.round(time)}
          >
            {tl.chapters.map((c, i) => {
              const w = ((c.end - c.start) / tl.duration) * 100;
              const fill = Math.min(1, Math.max(0, (time - c.start) / (c.end - c.start)));
              return (
                <div key={i} className="relative h-1 transition-[height] group-hover:h-1.5" style={{ width: `${w}%`, paddingRight: i < tl.chapters.length - 1 ? 3 : 0 }}>
                  <div className="relative h-full w-full overflow-hidden bg-white/30">
                    <div className="absolute inset-y-0 left-0 bg-red-600" style={{ width: `${fill * 100}%` }} />
                  </div>
                </div>
              );
            })}
            <div
              className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-600 shadow"
              style={{ left: `${(time / tl.duration) * 100}%` }}
            />
            {hover && (
              <div
                className="pointer-events-none absolute bottom-5 -translate-x-1/2 rounded bg-black/90 px-2 py-1 text-center text-[11px] whitespace-nowrap text-white"
                style={{ left: Math.min(Math.max(hover.x, 60), hover.w - 60) }}
              >
                <div className="font-semibold">{tl.chapters[chapterAt(tl, hover.t)]?.title}</div>
                <div className="text-white/70">{formatTime(hover.t)}</div>
              </div>
            )}
          </div>

          <div className="mt-1 flex items-center gap-1 text-white sm:gap-2">
            <CtlButton label={playing ? "일시정지 (K)" : "재생 (K)"} onClick={toggle}>
              {playing ? "❚❚" : "▶"}
            </CtlButton>
            <CtlButton label="다음 챕터" onClick={() => jumpChapter(1)}>
              ⏭
            </CtlButton>
            <CtlButton label={voiceOn ? "내레이션 끄기 (M)" : "내레이션 켜기 (M)"} onClick={toggleVoice}>
              {voiceOn ? "🔊" : "🔇"}
            </CtlButton>
            <span className="ml-1 text-xs tabular-nums text-white/90 sm:text-sm">
              {formatTime(time)} / {formatTime(tl.duration)}
            </span>
            <span className="ml-2 hidden truncate text-xs text-white/70 sm:inline">· {tl.chapters[chapterIdx]?.title}</span>
            <span className="flex-1" />
            <CtlButton label="자막 (C)" onClick={toggleCaptions} active={captions}>
              <span className="rounded border border-current px-1 text-[10px] leading-tight font-black">CC</span>
            </CtlButton>
            <div className="relative">
              <CtlButton label="설정 (재생 속도·화질)" onClick={() => setMenu((m) => (m ? null : "main"))} active={menu !== null ? true : undefined}>
                <span className="relative">
                  ⚙
                  {speed !== 1 && (
                    <span className="absolute -top-2 -right-3 rounded bg-red-600 px-0.5 text-[9px] leading-tight font-black text-white">{speed}×</span>
                  )}
                </span>
              </CtlButton>
              {menu && (
                <div
                  className="absolute right-0 bottom-10 z-10 w-60 overflow-y-auto overscroll-contain rounded-xl bg-black/90 py-1.5 text-sm text-white shadow-2xl"
                  // phones: the picture is only ~200px tall — never let the menu run off its top
                  style={{ maxHeight: Math.max(150, scale * STAGE_H - (isFull ? 70 : 48)) }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {menu === "main" && (
                    <>
                      <MenuRow icon="⏱" label="재생 속도" value={speedLabel(speed)} onClick={() => setMenu("speed")} />
                      <MenuRow icon="🎞" label="화질" value={quality === "hd" ? "고화질 (연출 효과)" : "가볍게"} onClick={() => setMenu("quality")} />
                      <MenuRow icon="🎵" label="배경음악" value={musicOn ? "켜짐" : "꺼짐"} onClick={toggleMusic} />
                      <MenuRow icon="💬" label="자막" value={captions ? "켜짐" : "꺼짐"} onClick={toggleCaptions} />
                    </>
                  )}
                  {menu === "speed" && (
                    <>
                      <SubHeader title="재생 속도" onBack={() => setMenu("main")} />
                      <div className="px-4 pt-1 pb-2">
                        <div className="mb-1 text-center text-base font-black tabular-nums">{speed.toFixed(2)}×</div>
                        <div className="flex items-center gap-2">
                          <button type="button" aria-label="느리게" className="h-7 w-7 rounded-full bg-white/10 font-bold" onClick={() => setRate(speed - 0.05, false)}>
                            −
                          </button>
                          <input
                            type="range"
                            aria-label="재생 속도 직접 조절"
                            min={MIN_SPEED}
                            max={MAX_SPEED}
                            step={0.05}
                            value={speed}
                            onChange={(e) => setRate(Number(e.target.value), false)}
                            className="flex-1 accent-red-600"
                          />
                          <button type="button" aria-label="빠르게" className="h-7 w-7 rounded-full bg-white/10 font-bold" onClick={() => setRate(speed + 0.05, false)}>
                            +
                          </button>
                        </div>
                      </div>
                      <div className={`border-t border-white/10 ${narrow ? "grid grid-cols-4 gap-1 p-2" : "pt-1"}`}>
                        {SPEED_PRESETS.map((s) => {
                          const on = Math.abs(s - speed) < 1e-6;
                          return narrow ? (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setRate(s)}
                              className={`rounded-md py-1.5 text-xs font-bold ${on ? "bg-red-600 text-white" : "bg-white/10"}`}
                            >
                              {s === 1 ? "1×" : `${s}×`}
                            </button>
                          ) : (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setRate(s)}
                              className={`flex w-full items-center gap-2 px-4 py-1.5 text-left hover:bg-white/10 ${on ? "font-bold text-red-400" : ""}`}
                            >
                              <span className="w-4">{on ? "✓" : ""}</span>
                              {speedLabel(s)}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                  {menu === "quality" && (
                    <>
                      <SubHeader title="화질" onBack={() => setMenu("main")} />
                      {(
                        [
                          ["hd", "고화질", "장면 전환·카메라 무빙·빛 효과"],
                          ["lite", "가볍게", "효과 끄기 — 저사양 휴대폰용"],
                        ] as const
                      ).map(([q, name, desc]) => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => pickQuality(q)}
                          className={`flex w-full items-start gap-2 px-4 py-2 text-left hover:bg-white/10 ${quality === q ? "text-red-400" : ""}`}
                        >
                          <span className="w-4">{quality === q ? "✓" : ""}</span>
                          <span>
                            <span className="font-bold">{name}</span>
                            {q === "hd" && <span className="ml-1 rounded bg-red-600 px-1 text-[9px] font-black text-white">HD</span>}
                            <span className="block text-[11px] text-white/50">{desc}</span>
                          </span>
                        </button>
                      ))}
                      <div className="px-4 pt-1 pb-1 text-[10px] leading-snug text-white/40">
                        영상 파일이 아니라 화면에서 직접 그려서, 어떤 크기에서도 글자가 선명해요.
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            <CtlButton label="전체 화면 (F)" onClick={toggleFull}>
              {isFull ? "⤡" : "⛶"}
            </CtlButton>
          </div>
        </div>
      </div>

      {narrow && captions && started && (
        <div className="-mt-3 flex min-h-[3.4em] w-full items-center justify-center rounded-b-xl bg-black px-3 py-1.5 text-center text-[13px] leading-snug font-semibold break-keep text-white">
          {caption ?? ""}
        </div>
      )}

      {/* Chapter list */}
      <ol className="flex w-full flex-col gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-2 text-left lg:max-h-[min(70vh,560px)] lg:w-72 lg:overflow-y-auto light:border-slate-200 light:bg-white">
        <li className="px-2 pt-1 pb-2 text-xs font-bold text-white/60 light:text-slate-500">📑 챕터</li>
        {tl.chapters.map((c, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => {
                seek(c.start);
                if (!playingRef.current) play();
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition ${
                started && i === chapterIdx ? "bg-red-500/15 ring-1 ring-red-400/40" : "hover:bg-white/5 light:hover:bg-slate-100"
              }`}
            >
              <span className="w-10 shrink-0 text-xs font-semibold tabular-nums text-sky-300 light:text-sky-700">{formatTime(c.start)}</span>
              <span className="text-sm break-keep text-white/85 light:text-slate-700">{c.title}</span>
            </button>
          </li>
        ))}
        <li className="hidden px-2 pt-2 text-[11px] leading-relaxed break-keep text-white/40 md:list-item light:text-slate-400">
          단축키: Space 재생 · ←/→ 5초 · J/L 10초 · Shift+&gt;/&lt; 배속 · 0~9 구간 이동 · F 전체화면 · C 자막 · M 내레이션 · 화면 길게 누르기 2배속
        </li>
      </ol>
    </div>
  );
}

function MenuRow({ icon, label, value, onClick }: { icon: string; label: string; value: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-white/10">
      <span className="w-5 text-center">{icon}</span>
      <span className="flex-1">{label}</span>
      <span className="text-xs text-white/60">{value} ›</span>
    </button>
  );
}

function SubHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <button type="button" onClick={onBack} className="mb-1 flex w-full items-center gap-2 border-b border-white/10 px-4 pt-1 pb-2 text-left font-bold hover:bg-white/5">
      ‹ {title}
    </button>
  );
}

function CtlButton({ children, onClick, label, active }: { children: React.ReactNode; onClick: () => void; label: string; active?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 text-base hover:bg-white/15 ${active === false ? "opacity-50" : ""} ${
        active ? "text-red-400" : ""
      }`}
    >
      {children}
    </button>
  );
}
