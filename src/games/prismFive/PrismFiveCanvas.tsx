"use client";

import { useEffect, useRef, useState } from "react";
import { ASSIST_MAX, HEROES, MECHA, PRISM_MAX, VIEW_W, type Difficulty, type HeroId } from "./data";
import { createWorld, NO_INPUT, step, type Input, type StageSummary, type World } from "./engine";
import { drawWorld, newMemo, VIEW_H, type RenderMemo } from "./render";
import { PrismAudio } from "./audio";
import KeyHelpTable from "./KeyHelpTable";

/**
 * requestAnimationFrame host for one stage: owns the mutable `World`, turns
 * keyboard / touch into an engine `Input` at a fixed 60 Hz, drains
 * `world.events` into sound, and mirrors a small HUD snapshot into React
 * (~10 Hz) for the touch buttons' cooldown rings.
 */

const STEP_MS = 1000 / 60;

interface Pad {
  cds: [number, number, number];
  cdMax: [number, number, number];
  en: number;
  enCost: [number, number, number];
  prism: number;
  assist: number;
  giant: boolean;
  finish: boolean;
  score: number;
}

const KEYMAP: Record<string, keyof Omit<Input, "mx" | "mz" | "skill"> | "s1" | "s2" | "s3"> = {
  KeyJ: "light",
  KeyZ: "light",
  KeyK: "heavy",
  KeyX: "heavy",
  Space: "jump",
  KeyC: "jump",
  KeyL: "dodge",
  ShiftLeft: "dodge",
  ShiftRight: "dodge",
  KeyU: "s1",
  Digit1: "s1",
  KeyI: "s2",
  Digit2: "s2",
  KeyO: "s3",
  Digit3: "s3",
  KeyF: "ult",
  KeyV: "ult",
  KeyG: "assist",
  KeyB: "assist",
  KeyH: "poke",
  KeyN: "poke",
};

export default function PrismFiveCanvas({
  stage,
  hero,
  diff,
  seed,
  muted,
  onToggleMute,
  noShake,
  reduceFlash,
  onEnd,
  onQuit,
}: {
  stage: number;
  hero: HeroId;
  diff: Difficulty;
  seed: number;
  muted: boolean;
  onToggleMute: () => void;
  noShake: boolean;
  reduceFlash: boolean;
  onEnd: (s: StageSummary) => void;
  onQuit: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<World | null>(null);
  const memoRef = useRef<RenderMemo>(newMemo());
  const audioRef = useRef<PrismAudio | null>(null);
  const keys = useRef(new Set<string>());
  const pressed = useRef(new Set<string>());
  const joy = useRef<{ id: number; ox: number; oy: number; x: number; y: number } | null>(null);
  const pausedRef = useRef(false);
  const optsRef = useRef({ noShake, calm: reduceFlash, touch: false });
  const onEndRef = useRef(onEnd);
  const muteRef = useRef(onToggleMute);
  const [paused, setPaused] = useState(false);
  const [touch, setTouch] = useState(false);
  const [pad, setPad] = useState<Pad | null>(null);
  const [joyView, setJoyView] = useState<{ ox: number; oy: number; x: number; y: number } | null>(null);
  const [full, setFull] = useState(false);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    onEndRef.current = onEnd;
    muteRef.current = onToggleMute;
  }, [onEnd, onToggleMute]);
  useEffect(() => {
    optsRef.current = { ...optsRef.current, noShake, calm: reduceFlash };
  }, [noShake, reduceFlash]);
  useEffect(() => {
    audioRef.current?.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    optsRef.current.touch = coarse;
    // Detecting a coarse pointer can only happen on the client after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTouch(coarse);
  }, []);

  const setPause = (p: boolean) => {
    pausedRef.current = p;
    setPaused(p);
  };

  useEffect(() => {
    const w = createWorld({ stage, hero, diff, seed });
    worldRef.current = w;
    const audio = new PrismAudio();
    audio.muted = muted;
    audioRef.current = audio;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let endT = -1;
    let hudT = 0;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const readInput = (): Input => {
      const k = keys.current;
      const p = pressed.current;
      let mx = (k.has("ArrowRight") || k.has("KeyD") ? 1 : 0) - (k.has("ArrowLeft") || k.has("KeyA") ? 1 : 0);
      let mz = (k.has("ArrowDown") || k.has("KeyS") ? 1 : 0) - (k.has("ArrowUp") || k.has("KeyW") ? 1 : 0);
      const j = joy.current;
      if (j) {
        const dx = j.x - j.ox;
        const dy = j.y - j.oy;
        if (Math.abs(dx) > 14) mx = dx > 0 ? 1 : -1;
        if (Math.abs(dy) > 14) mz = dy > 0 ? 1 : -1;
      }
      const inp: Input = {
        ...NO_INPUT,
        mx: mx as Input["mx"],
        mz: mz as Input["mz"],
        light: p.has("light"),
        heavy: p.has("heavy"),
        jump: p.has("jump"),
        dodge: p.has("dodge"),
        ult: p.has("ult"),
        assist: p.has("assist"),
        poke: p.has("poke"),
        skill: p.has("s1") ? 1 : p.has("s2") ? 2 : p.has("s3") ? 3 : 0,
      };
      p.clear();
      return inp;
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(100, now - last);
      last = now;
      if (!pausedRef.current) {
        acc += dt;
        let n = 0;
        while (acc >= STEP_MS && n < 5) {
          step(w, readInput());
          acc -= STEP_MS;
          n++;
        }
        if (n === 5) acc = 0;
      }
      for (const e of w.events) audio.play(e);
      w.events.length = 0;
      const b = w.actors.find((a) => a.id === w.bossActor && a.state !== "gone");
      audio.setTrack(w.phase === "clear" || w.phase === "over" ? "none" : w.mode === "giant" ? "giant" : b && b.kind === "boss" ? "boss" : "stage");
      // Draw.
      const sx = canvas.width / VIEW_W;
      const sy = canvas.height / VIEW_H;
      ctx.setTransform(sx, 0, 0, sy, 0, 0);
      drawWorld(ctx, w, memoRef.current, optsRef.current);
      if ((w.phase === "clear" || w.phase === "over") && w.summary) {
        if (endT < 0) endT = now;
        else if (now - endT > 1600) {
          const s = w.summary;
          w.summary = null;
          onEndRef.current(s);
        }
      }
      if (now - hudT > 100) {
        hudT = now;
        const hd = HEROES[hero];
        const giant = w.mode === "giant";
        setPad({
          cds: [...w.cds] as [number, number, number],
          cdMax: giant ? [MECHA.rocket.cd ?? 1, 1, 1] : (hd.skills.map((s) => s.cd ?? 1) as [number, number, number]),
          en: w.en,
          enCost: giant ? [MECHA.rocket.en ?? 0, 999, 999] : (hd.skills.map((s) => s.en ?? 0) as [number, number, number]),
          prism: w.prism,
          assist: w.assistStock,
          giant,
          finish: w.finishReady,
          score: w.score,
        });
      }
    };
    raf = requestAnimationFrame(frame);

    const down = (e: KeyboardEvent) => {
      if (e.code === "Escape" || e.code === "KeyP") {
        setHelp(false);
        setPause(!pausedRef.current);
        return;
      }
      if (e.code === "F1" || e.code === "Slash") {
        e.preventDefault();
        setHelp((v) => {
          setPause(!v);
          return !v;
        });
        return;
      }
      if (e.code === "KeyM" && !e.repeat) {
        muteRef.current();
        return;
      }
      audio.unlock();
      const action = KEYMAP[e.code];
      if (action || e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
      if (!e.repeat && action) pressed.current.add(action);
      keys.current.add(e.code);
    };
    const upKey = (e: KeyboardEvent) => keys.current.delete(e.code);
    const blur = () => {
      keys.current.clear();
      if (worldRef.current && worldRef.current.phase !== "clear" && worldRef.current.phase !== "over") setPause(true);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", upKey);
    window.addEventListener("blur", blur);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", upKey);
      window.removeEventListener("blur", blur);
      audio.dispose();
    };
    // The world is created once per mount; the parent remounts (key) for a new stage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const press = (action: string) => {
    audioRef.current?.unlock();
    pressed.current.add(action);
  };

  const toggleFull = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().then(() => setFull(false));
    else
      void el
        .requestFullscreen?.()
        .then(() => setFull(true))
        .catch(() => setFull(false));
  };

  const hd = HEROES[hero];

  return (
    <div ref={wrapRef} className={`relative mx-auto w-full select-none ${full ? "flex h-full items-center bg-black" : ""}`} style={{ touchAction: "none" }}>
      <canvas
        ref={canvasRef}
        className="block w-full rounded-xl border border-white/10 bg-black shadow-2xl"
        style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
        onPointerDown={() => audioRef.current?.unlock()}
      />
      {/* Top-right controls */}
      <div className="absolute top-1.5 left-1/2 flex -translate-x-1/2 gap-1">
        <button type="button" onClick={() => setPause(true)} className="rounded-md bg-black/50 px-2 py-0.5 text-xs text-white/80 hover:bg-black/70" aria-label="일시정지">
          ⏸
        </button>
        <button type="button" onClick={onToggleMute} className="rounded-md bg-black/50 px-2 py-0.5 text-xs text-white/80 hover:bg-black/70" aria-label={muted ? "소리 켜기" : "소리 끄기"}>
          {muted ? "🔇" : "🔊"}
        </button>
        <button type="button" onClick={toggleFull} className="rounded-md bg-black/50 px-2 py-0.5 text-xs text-white/80 hover:bg-black/70" aria-label="전체 화면">
          ⛶
        </button>
        <button
          type="button"
          onClick={() => {
            setHelp(true);
            setPause(true);
          }}
          className="rounded-md bg-black/50 px-2 py-0.5 text-xs text-white/80 hover:bg-black/70"
          aria-label="단축키 보기"
        >
          ⌨️
        </button>
      </div>

      {touch && (
        <>
          {/* Left half: floating joystick */}
          <div
            className="absolute bottom-0 left-0 h-3/4 w-1/2"
            onPointerDown={(e) => {
              audioRef.current?.unlock();
              const r = e.currentTarget.getBoundingClientRect();
              const j = { id: e.pointerId, ox: e.clientX - r.left, oy: e.clientY - r.top, x: e.clientX - r.left, y: e.clientY - r.top };
              joy.current = j;
              setJoyView({ ...j });
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const j = joy.current;
              if (!j || j.id !== e.pointerId) return;
              const r = e.currentTarget.getBoundingClientRect();
              const nx = e.clientX - r.left;
              const ny = e.clientY - r.top;
              // Double-flick → run: quick re-push after release is handled by the engine's double-tap.
              j.x = nx;
              j.y = ny;
              setJoyView({ ...j });
            }}
            onPointerUp={() => {
              joy.current = null;
              setJoyView(null);
            }}
            onPointerCancel={() => {
              joy.current = null;
              setJoyView(null);
            }}
          >
            {joyView && (
              <>
                <div className="pointer-events-none absolute h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/30 bg-white/5" style={{ left: joyView.ox, top: joyView.oy }} />
                <div
                  className="pointer-events-none absolute h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/40"
                  style={{ left: joyView.ox + Math.max(-40, Math.min(40, joyView.x - joyView.ox)), top: joyView.oy + Math.max(-40, Math.min(40, joyView.y - joyView.oy)) }}
                />
              </>
            )}
            {!joyView && <div className="pointer-events-none absolute bottom-3 left-3 text-[10px] text-white/40">여기를 끌어 이동 · 같은 방향 두 번 = 달리기</div>}
          </div>
          {/* Right: action buttons */}
          <div className="absolute right-1 bottom-1 grid grid-cols-5 gap-1">
            {pad &&
              (pad.giant ? [0] : [0, 1, 2]).map((i) => {
                const ready = pad.cds[i] <= 0 && pad.en >= pad.enCost[i];
                const name = pad.giant ? MECHA.rocket.name : hd.skills[i].name;
                return (
                  <button
                    key={i}
                    type="button"
                    onPointerDown={() => press(`s${i + 1}`)}
                    className={`relative h-11 w-11 overflow-hidden rounded-full border text-[9px] leading-tight font-bold ${ready ? "border-yellow-300/80 bg-yellow-400/30 text-white" : "border-white/20 bg-black/40 text-white/40"}`}
                  >
                    {pad.cds[i] > 0 && <span className="absolute inset-x-0 bottom-0 bg-white/20" style={{ height: `${(pad.cds[i] / pad.cdMax[i]) * 100}%` }} />}
                    <span className="relative">{name.slice(0, 4)}</span>
                  </button>
                );
              })}
            {pad && !pad.giant && (
              <button
                type="button"
                onPointerDown={() => press("assist")}
                className={`h-11 w-11 rounded-full border text-[10px] font-black ${pad.assist > 0 ? "border-sky-300/80 bg-sky-500/30 text-white" : "border-white/20 bg-black/40 text-white/40"}`}
              >
                {pad.assist >= ASSIST_MAX ? "합체!" : `팀×${pad.assist}`}
              </button>
            )}
            {pad && !pad.giant && (
              <button type="button" onPointerDown={() => press("poke")} className="h-11 w-11 rounded-full border border-emerald-300/60 bg-emerald-500/25 text-[10px] font-black text-white">
                견제
              </button>
            )}
            {pad && pad.giant && [0, 1, 2, 3].map((i) => <span key={i} />)}
            <button type="button" onPointerDown={() => press("dodge")} className="h-12 w-12 rounded-full border border-white/30 bg-white/10 text-[11px] font-black text-white">
              회피
            </button>
            <button type="button" onPointerDown={() => press("jump")} className="h-12 w-12 rounded-full border border-white/30 bg-white/10 text-[11px] font-black text-white">
              점프
            </button>
            <button type="button" onPointerDown={() => press("heavy")} className="h-12 w-12 rounded-full border border-orange-300/60 bg-orange-500/30 text-[11px] font-black text-white">
              강공
            </button>
            <button type="button" onPointerDown={() => press("light")} className="h-12 w-12 rounded-full border-2 border-white/60 text-[11px] font-black text-white" style={{ background: `${hd.color}66` }}>
              공격
            </button>
          </div>
          {pad && (pad.giant ? pad.finish : pad.prism >= PRISM_MAX) && (
            <button
              type="button"
              onPointerDown={() => press("ult")}
              className="absolute right-2 bottom-28 animate-pulse rounded-full border-2 border-yellow-200 bg-gradient-to-r from-red-500 via-yellow-400 to-pink-500 px-3 py-2 text-xs font-black text-white shadow-lg"
            >
              {pad.giant ? "필살 일도양단!" : "필살기!"}
            </button>
          )}
        </>
      )}

      {help && (
        <div className="absolute inset-0 z-10 flex flex-col rounded-xl bg-slate-950/95 p-3 text-white">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-black">⌨️ 단축키 · 조작</div>
            <button
              type="button"
              onClick={() => {
                setHelp(false);
                setPause(false);
              }}
              className="rounded-md bg-white/90 px-3 py-1 text-xs font-bold text-slate-900"
            >
              ▶ 닫고 계속 (? / Esc)
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <KeyHelpTable compact={touch} />
          </div>
        </div>
      )}

      {paused && !help && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-black/70">
          <div className="text-lg font-black text-white">일시정지</div>
          <button type="button" onClick={() => setPause(false)} className="w-40 rounded-lg bg-white/90 px-3 py-2 text-sm font-bold text-slate-900">
            ▶ 계속하기
          </button>
          <button type="button" onClick={onQuit} className="w-40 rounded-lg bg-white/15 px-3 py-2 text-sm font-bold text-white">
            🏠 메뉴로 (기록 없음)
          </button>
          {pad && <div className="mt-1 text-[11px] text-white/50">{hd.name} · 현재 점수 {pad.score.toLocaleString()}</div>}
        </div>
      )}
    </div>
  );
}
