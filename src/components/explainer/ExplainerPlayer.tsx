"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExplainerScript } from "./types";
import { buildTimeline, chapterAt, formatTime, locate } from "./timeline";
import { isSpeaking, speak, speechSupported, stopSpeech, unlockSpeech } from "./narration";
import { STAGE_H, STAGE_W } from "./stage";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;
/** Longest the clock waits at a cue boundary for slow TTS to finish (real seconds). */
const MAX_HOLD = 3.5;

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
  const [speed, setSpeed] = useState<number>(1);
  const [captions, setCaptions] = useState(() => readPref("explainer:captions", true));
  const [voiceOn, setVoiceOn] = useState(() => readPref("explainer:voice", true));
  const [speedMenu, setSpeedMenu] = useState(false);
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
  const speedRef = useRef(1);
  const voiceRef = useRef(voiceOn);
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
        setSpeedMenu(false);
      }
    }, 2600);
  }, []);

  const play = useCallback(() => {
    unlockSpeech();
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
    };
  }, [pause]);

  const chrome = controlsShown || !playing;

  const setRate = (s: number) => {
    speedRef.current = s;
    setSpeed(s);
    setSpeedMenu(false);
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
      } else if (k === "arrowleft") seek(timeRef.current - 5);
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
  }, [toggle, seek, poke, toggleFull]);

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
  const sceneMeta = tl.scenes[loc.sceneIndex];
  const scene = flatScenes[loc.sceneIndex];
  const frame = scene.render({
    t: loc.local,
    dur: sceneMeta.dur,
    at: (i) => sceneMeta.cueStarts[Math.min(Math.max(i, 0), sceneMeta.cueStarts.length - 1)],
    cue: loc.sceneCue,
  });
  const caption = started && loc.cueIndex >= 0 ? tl.cues[loc.cueIndex].text.trim() || null : null;
  const noVoice = !speechSupported();
  // On phone-width players an overlaid 2-line subtitle hides a quarter of the
  // picture — put it in a bar under the video instead (overlay again in fullscreen).
  const narrow = scale * STAGE_W < 560 && !isFull;

  return (
    <div className="flex w-full flex-col gap-3 lg:flex-row lg:items-start">
      <div
        ref={shellRef}
        className={`group relative overflow-hidden bg-black select-none ${
          cssFull ? "fixed inset-0 z-[300] flex items-center justify-center" : `w-full lg:flex-1 ${isFull ? "flex items-center" : narrow && captions ? "rounded-t-xl" : "rounded-xl"}`
        }`}
        onPointerMove={poke}
        style={{ cursor: chrome ? undefined : "none" }}
      >
        <div
          ref={frameRef}
          style={cssFull ? { width: "min(100vw, calc(100dvh * 16 / 9))" } : undefined}
          className="relative aspect-video w-full overflow-hidden" onClick={() => (speedMenu ? setSpeedMenu(false) : toggle())}>
          <div className="absolute top-0 left-0 origin-top-left" style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})` }}>
            {frame}
          </div>

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
              <CtlButton label="재생 속도" onClick={() => setSpeedMenu((m) => !m)}>
                <span className="text-xs font-bold">{speed === 1 ? "1×" : `${speed}×`}</span>
              </CtlButton>
              {speedMenu && (
                <div className="absolute right-0 bottom-9 z-10 flex flex-col overflow-hidden rounded-lg bg-black/90 py-1 text-sm shadow-xl">
                  <div className="px-4 py-1 text-[11px] text-white/50">재생 속도</div>
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setRate(s)}
                      className={`px-4 py-1.5 text-left hover:bg-white/10 ${s === speed ? "font-bold text-red-400" : "text-white"}`}
                    >
                      {s === 1 ? "보통" : `${s}×`}
                    </button>
                  ))}
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
          단축키: Space 재생 · ←/→ 5초 · J/L 10초 · F 전체화면 · C 자막 · M 내레이션
        </li>
      </ol>
    </div>
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
