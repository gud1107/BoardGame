"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DT, H, TPS, W, Sim, aimPreview, clampAim, runShots, type Outcome, type Shot, type StageDef, type Vec } from "./sim";
import { FxLayer, drawScene } from "./render";
import { ShotAudio } from "./audio";
import { feedbackFor, isMyosu, starsFor } from "./scoring";
import type { StageRecord } from "./save";

/**
 * One stage: 🔍 관찰 (scrub time, aim, read the scene) → 🧩 연습 (reserve
 * shots on the timeline, then watch) or 🔥 실전 (3-2-1, then pull the
 * trigger in real time) → 결과 with "how far off" feedback.
 */

type Phase = "observe" | "countdown" | "run" | "result";

export interface StageResult {
  won: boolean;
  stars: number;
  bullets: number;
  myosu: boolean;
  ghost: boolean;
  live: boolean;
  outcome: Outcome;
}

interface Props {
  stage: StageDef;
  record: StageRecord | undefined;
  live: boolean;
  muted: boolean;
  hasNext: boolean;
  onLiveChange: (live: boolean) => void;
  onToggleMute: () => void;
  onFinish: (r: StageResult) => void;
  onNext: () => void;
  onExit: () => void;
}

interface Shown {
  outcome: Outcome;
  stars: number;
  myosu: boolean;
  bullets: number;
  feedback: string[];
}

const FAIL_TEXT: Record<Exclude<Outcome, "running" | "win">, string> = {
  "fail-hostage": "🙅 인질이 맞았어요!",
  "fail-ammo": "🔫 총알이 떨어졌어요",
  "fail-time": "⌛ 시간이 다 됐어요",
};

const fmtT = (t: number) => `${t.toFixed(2)}초`;
const elev = (a: number) => `${(-a).toFixed(1)}°`;

export default function StageScreen(props: Props) {
  const { stage, live, muted } = props;
  const [phase, setPhase] = useState<Phase>("observe");
  const [scrubT, setScrubT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [aim, setAim] = useState(-30);
  const [reserved, setReserved] = useState<Shot[]>([]);
  const [hint, setHint] = useState(0);
  const [count, setCount] = useState(3);
  const [shown, setShown] = useState<Shown | null>(null);
  const [mine, setMine] = useState<Vec[][]>([]);
  const [showMine, setShowMine] = useState(true);
  const [ammoLeft, setAmmoLeft] = useState(stage.ammo);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const timeLabelRef = useRef<HTMLSpanElement>(null);
  const simRef = useRef<Sim | null>(null);
  const fxRef = useRef(new FxLayer());
  const audioRef = useRef<ShotAudio | null>(null);
  const loop = useRef({ phase: "observe" as Phase, scrubT: 0, playing: true, aim: -30, reserved: [] as Shot[], ghost: [] as Vec[][], mine: [] as Vec[][], live, endAt: 0, fxSeen: 0, ammo: stage.ammo });
  const dragRef = useRef<{ id: number; y: number; aim: number } | null>(null);

  const obsSim = useMemo(() => new Sim(stage), [stage]);
  const ghost = useMemo(() => (hint >= 3 ? runShots(stage, stage.solution).sim.bullets.map((b) => b.path) : []), [hint, stage]);
  const bands = useMemo(() => (hint >= 2 ? stage.solution.map((s) => [Math.max(0, s.tick / TPS - 0.35), Math.min(stage.duration, s.tick / TPS + 0.35)] as const) : []), [hint, stage]);

  useEffect(() => {
    Object.assign(loop.current, { phase, scrubT, playing, aim, reserved, ghost, mine: showMine ? mine : [], live });
  }, [phase, scrubT, playing, aim, reserved, ghost, mine, showMine, live]);

  useEffect(() => {
    const a = new ShotAudio();
    audioRef.current = a;
    return () => a.dispose();
  }, []);
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.muted = muted;
      audioRef.current.setMuted(muted);
    }
  }, [muted]);

  const finish = useCallback(
    (sim: Sim) => {
      const o = sim.outcome();
      const outcome: Outcome = o === "running" ? "fail-time" : o;
      const won = outcome === "win";
      const facts = { won, bullets: sim.fired.length, live: loop.current.live, ghost: hint >= 3 || (props.record?.ghost ?? false) };
      const stars = starsFor(stage, facts);
      const my = isMyosu(stage, facts);
      setShown({ outcome, stars, myosu: my, bullets: sim.fired.length, feedback: won ? [] : feedbackFor(stage, sim.fired) });
      setMine(sim.bullets.map((b) => b.path));
      setPhase("result");
      if (won) audioRef.current?.win(my);
      else audioRef.current?.fail();
      props.onFinish({ won, stars, bullets: sim.fired.length, myosu: my, ghost: facts.ghost, live: facts.live, outcome });
    },
    [hint, props, stage],
  );
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  }, [finish]);

  // Canvas resolution follows its CSS size.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = c.clientWidth;
      c.width = Math.round(w * dpr);
      c.height = Math.round(((w * H) / W) * dpr);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  // One RAF loop for the whole screen; it reads `loop.current`, never React state.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const L = loop.current;
      const fx = fxRef.current;
      let sim = obsSim;
      let t = L.scrubT;
      if (L.phase === "observe" && L.playing) {
        const nt = (L.scrubT + dt) % stage.duration;
        L.scrubT = nt;
        t = nt;
        setScrubT(nt);
      }
      if ((L.phase === "run" || L.phase === "result") && simRef.current) {
        sim = simRef.current;
        if (L.phase === "run") {
          acc += dt;
          while (acc >= DT) {
            acc -= DT;
            if (sim.outcome() === "running") sim.step();
          }
          for (; L.fxSeen < sim.fx.length; L.fxSeen++) {
            const f = sim.fx[L.fxSeen];
            fx.spawn(f, calm);
            audioRef.current?.play(f.kind);
          }
          if (sim.ammoLeft !== L.ammo) {
            L.ammo = sim.ammoLeft;
            setAmmoLeft(sim.ammoLeft);
          }
          if (sim.outcome() !== "running") {
            if (!L.endAt) L.endAt = now + 900;
            else if (now >= L.endAt) {
              L.endAt = 0;
              L.phase = "result";
              finishRef.current(sim);
            }
          }
          if (progressRef.current) progressRef.current.style.width = `${Math.min(100, (sim.time / stage.duration) * 100)}%`;
          if (timeLabelRef.current) timeLabelRef.current.textContent = fmtT(sim.time);
        }
        t = sim.time;
      }
      fx.update(dt);
      const c = canvasRef.current;
      const ctx = c?.getContext("2d");
      if (c && ctx) {
        ctx.setTransform(c.width / W, 0, 0, c.height / H, 0, 0);
        const aimOn = L.phase === "observe" || (L.phase === "run" && L.live) || L.phase === "countdown";
        drawScene(ctx, {
          sim,
          t,
          aim: L.aim,
          showAim: aimOn,
          preview: aimOn ? aimPreview(sim, L.aim, t) : null,
          ghost: L.ghost,
          mine: L.phase === "observe" ? L.mine : [],
          reserved: !L.live && L.phase === "observe" ? L.reserved.map((r, i) => ({ angle: r.angle, label: `${i + 1}`, active: Math.abs(r.tick / TPS - t) < 0.15 })) : [],
          fx,
        });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [obsSim, stage]);

  // 3-2-1 before a 실전 run.
  useEffect(() => {
    if (phase !== "countdown") return;
    if (count <= 0) {
      const id = window.setTimeout(() => setPhase("run"), 0);
      return () => window.clearTimeout(id);
    }
    audioRef.current?.tick();
    const id = window.setTimeout(() => setCount((c) => c - 1), 600);
    return () => window.clearTimeout(id);
  }, [phase, count]);

  const begin = useCallback(() => {
    audioRef.current?.unlock();
    fxRef.current.clear();
    const L = loop.current;
    simRef.current = new Sim(stage, L.live ? [] : L.reserved);
    L.fxSeen = 0;
    L.endAt = 0;
    L.ammo = simRef.current.ammoLeft;
    setAmmoLeft(simRef.current.ammoLeft);
    setShown(null);
    if (L.live) {
      setCount(3);
      setPhase("countdown");
    } else setPhase("run");
  }, [stage]);

  const fire = useCallback(() => {
    audioRef.current?.unlock();
    const L = loop.current;
    if (L.phase === "run" && L.live && simRef.current) simRef.current.fire(L.aim);
  }, []);

  const reserve = useCallback(() => {
    audioRef.current?.unlock();
    const L = loop.current;
    if (L.phase !== "observe" || L.live || L.reserved.length >= stage.ammo) return;
    const tick = Math.min(Math.floor(stage.duration * TPS) - 1, Math.round(L.scrubT * TPS));
    setReserved((r) => [...r, { tick, angle: Math.round(L.aim * 20) / 20 }].sort((a, b) => a.tick - b.tick));
    setPlaying(false);
  }, [stage]);

  const toObserve = useCallback(() => {
    simRef.current = null;
    fxRef.current.clear();
    setShown(null);
    setPhase("observe");
  }, []);

  const nudgeAim = useCallback((d: number) => setAim((a) => clampAim(Math.round((a + d) * 100) / 100)), []);
  const scrub = useCallback(
    (d: number) => {
      setPlaying(false);
      setScrubT((t) => Math.max(0, Math.min(stage.duration - DT, t + d)));
    },
    [stage],
  );

  // Keyboard: ↑↓ aim (Shift = fine), ←→ scrub, Space fire/reserve/start, P play, R retry.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" && (e.target as HTMLInputElement).type !== "range") return;
      const L = loop.current;
      const fine = e.shiftKey ? 0.1 : 0.5;
      if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
        e.preventDefault();
        nudgeAim(-fine);
      } else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
        e.preventDefault();
        nudgeAim(fine);
      } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && L.phase === "observe") {
        e.preventDefault();
        scrub((e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? DT : 1 / 30));
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (L.phase === "run") fire();
        else if (L.phase === "observe") {
          if (L.live) begin();
          else reserve();
        } else if (L.phase === "result") begin();
      } else if ((e.key === "p" || e.key === "P") && L.phase === "observe") setPlaying((p) => !p);
      else if ((e.key === "r" || e.key === "R") && L.phase === "result") begin();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [begin, fire, nudgeAim, reserve, scrub]);

  const toWorld = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const aimAt = (p: Vec) => {
    const g = obsSim.gun;
    setAim(clampAim(Math.round(((Math.atan2(p.y - g.y, p.x - g.x) * 180) / Math.PI) * 20) / 20));
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "mouse") {
      if (phase !== "result") aimAt(toWorld(e));
      return;
    }
    const d = dragRef.current;
    if (d && d.id === e.pointerId) setAim(clampAim(Math.round((d.aim + (e.clientY - d.y) * 0.15) * 20) / 20));
  };
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    audioRef.current?.unlock();
    if (e.pointerType === "mouse") {
      if (e.button !== 0) return;
      aimAt(toWorld(e));
      if (phase === "run") fire();
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { id: e.pointerId, y: e.clientY, aim };
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.id === e.pointerId) dragRef.current = null;
  };

  const ammoShown = phase === "run" || phase === "result" ? ammoLeft : live ? stage.ammo : stage.ammo - reserved.length;
  const best = props.record;

  return (
    <div className="flex flex-col gap-3 text-stone-100">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={props.onExit} className="rounded-lg bg-stone-800 px-3 py-1.5 text-sm font-bold hover:bg-stone-700">← 목록</button>
        <div className="min-w-0 flex-1 basis-48">
          <div className="truncate text-lg font-black">
            <span className="mr-2 rounded bg-amber-500 px-1.5 py-0.5 text-sm text-stone-900">{stage.id}</span>
            {stage.title}
          </div>
          <div className="truncate text-xs text-stone-400">{stage.brief}</div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="rounded-lg bg-stone-800 px-2 py-1" title="남은 총알">🔫 {ammoShown}</span>
          <span className="rounded-lg bg-stone-800 px-2 py-1" title="기준 탄수">기준 {stage.par}발</span>
          {stage.myosu !== undefined && <span className="rounded-lg bg-cyan-900/70 px-2 py-1" title="더 적은 탄수의 숨은 정답이 있어요">💎 숨은 묘수</span>}
          {best && best.stars > 0 && <span className="rounded-lg bg-stone-800 px-2 py-1">{"⭐".repeat(best.stars)}{best.myosu ? " 💎" : ""}</span>}
          <button onClick={props.onToggleMute} className="rounded-lg bg-stone-800 px-2 py-1" aria-label={muted ? "소리 켜기" : "소리 끄기"}>{muted ? "🔇" : "🔊"}</button>
        </div>
      </div>

      {/* readouts (kept off the canvas so they never hide a mirror or rope) */}
      <div className="-mb-1 flex flex-wrap gap-2 text-xs font-bold">
        <span className="rounded bg-stone-800 px-2 py-1">고각 {elev(aim)}</span>
        {phase === "observe" && <span className="rounded bg-stone-800 px-2 py-1">🔍 관찰 {fmtT(scrubT)}</span>}
        {(phase === "run" || phase === "countdown") && <span className="rounded bg-red-700/80 px-2 py-1">{live ? "🔥 실전" : "▶ 실행"} <span ref={timeLabelRef}>0.00초</span></span>}
      </div>

      {/* canvas */}
      <div className="relative overflow-hidden rounded-xl border-2 border-amber-900/70 bg-stone-950 shadow-xl">
        <canvas
          ref={canvasRef}
          className="block w-full touch-none select-none"
          style={{ aspectRatio: `${W} / ${H}`, cursor: phase === "result" ? "default" : "crosshair" }}
          onPointerMove={onPointerMove}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={(e) => e.preventDefault()}
        />
        {phase === "countdown" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="text-7xl font-black text-amber-300 drop-shadow-[0_4px_0_rgba(0,0,0,0.6)]">{count > 0 ? count : "드로우!"}</div>
          </div>
        )}
        {phase === "result" && shown && (
          <div className="absolute inset-0 grid place-items-center bg-black/55 p-3">
            <div className="w-full max-w-sm rounded-2xl border border-amber-700/60 bg-stone-900/95 p-4 text-center shadow-2xl">
              {shown.outcome === "win" ? (
                <>
                  <div className="text-3xl font-black text-amber-300">클리어!</div>
                  <div className="mt-1 text-3xl" aria-label={`별 ${shown.stars}개`}>
                    {"⭐".repeat(shown.stars)}
                    <span className="opacity-25">{"⭐".repeat(3 - shown.stars)}</span>
                  </div>
                  {shown.myosu && <div className="mt-1 text-lg font-black text-cyan-300">💎 묘수 발견!</div>}
                  <div className="mt-2 text-sm text-stone-300">
                    {shown.bullets}발 사용 · 기준 {stage.par}발
                  </div>
                  <div className="mt-1 text-xs text-stone-400">
                    {shown.stars === 1 && "기준 탄수 안에 풀면 ⭐⭐"}
                    {shown.stars === 2 && (hint >= 3 || best?.ghost ? "정답 고스트를 본 스테이지는 ⭐⭐까지" : "🔥 실전 모드로 풀면 ⭐⭐⭐")}
                    {shown.stars === 3 && !shown.myosu && stage.myosu !== undefined && `${stage.myosu}발로 푸는 묘수가 숨어 있어요`}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-2xl font-black text-red-300">{FAIL_TEXT[shown.outcome as keyof typeof FAIL_TEXT] ?? "실패"}</div>
                  {shown.feedback.length > 0 && (
                    <div className="mt-2 rounded-lg bg-black/40 p-2 text-left text-sm">
                      <div className="mb-1 text-xs text-stone-400">모범 답안과 비교</div>
                      {shown.feedback.map((l) => (
                        <div key={l}>{l}</div>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 text-xs text-stone-400">관찰 모드에서 내 탄도(흰 점선)를 보며 되감아 볼 수 있어요.</div>
                </>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm font-bold">
                <button onClick={begin} className="rounded-lg bg-amber-500 px-3 py-2 text-stone-900 hover:bg-amber-400">↻ 다시 (R)</button>
                <button onClick={toObserve} className="rounded-lg bg-stone-700 px-3 py-2 hover:bg-stone-600">🔍 관찰로</button>
                {shown.outcome === "win" && props.hasNext && (
                  <button onClick={props.onNext} className="col-span-2 rounded-lg bg-emerald-600 px-3 py-2 hover:bg-emerald-500">다음 스테이지 →</button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* timeline */}
      <div className="rounded-xl bg-stone-900 p-3">
        {phase === "observe" ? (
          <>
            <div className="flex items-center gap-2">
              <button onClick={() => setPlaying((p) => !p)} className="w-10 shrink-0 rounded-lg bg-stone-700 py-1.5 text-sm" aria-label={playing ? "일시정지" : "재생"}>{playing ? "⏸" : "▶"}</button>
              <button onClick={() => scrub(-1 / 30)} className="shrink-0 rounded-lg bg-stone-800 px-2 py-1.5 text-xs" aria-label="뒤로">◀</button>
              <div className="relative flex-1">
                <div className="pointer-events-none absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded bg-stone-700">
                  {bands.map(([a, b], i) => (
                    <div key={i} className="absolute h-full rounded bg-amber-400/70" style={{ left: `${(a / stage.duration) * 100}%`, width: `${((b - a) / stage.duration) * 100}%` }} />
                  ))}
                  {!live && reserved.map((r, i) => (
                    <div key={i} className="absolute -top-1 h-4 w-1 rounded bg-yellow-300" style={{ left: `${(r.tick / TPS / stage.duration) * 100}%` }} />
                  ))}
                </div>
                <input
                  type="range"
                  min={0}
                  max={stage.duration}
                  step={DT}
                  value={scrubT}
                  onChange={(e) => {
                    setPlaying(false);
                    setScrubT(Number(e.target.value));
                  }}
                  className="relative w-full accent-amber-400"
                  aria-label="관찰 시간"
                />
              </div>
              <button onClick={() => scrub(1 / 30)} className="shrink-0 rounded-lg bg-stone-800 px-2 py-1.5 text-xs" aria-label="앞으로">▶</button>
              <span className="w-16 shrink-0 text-right font-mono text-xs">{fmtT(scrubT)}</span>
            </div>
            <div className="mt-1 text-[11px] text-stone-500">← → 0.03초 · Shift+← → 1프레임 · P 재생/정지 · ↑ ↓ 조준 (Shift 미세)</div>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <div className="relative h-2 flex-1 overflow-hidden rounded bg-stone-700">
              {bands.map(([a, b], i) => (
                <div key={i} className="absolute h-full bg-amber-400/50" style={{ left: `${(a / stage.duration) * 100}%`, width: `${((b - a) / stage.duration) * 100}%` }} />
              ))}
              <div ref={progressRef} className="absolute left-0 top-0 h-full bg-red-500" style={{ width: 0 }} />
            </div>
            <span className="w-14 text-right font-mono text-xs">{stage.duration}초</span>
          </div>
        )}
      </div>

      {/* controls */}
      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <div className="rounded-xl bg-stone-900 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-stone-700 text-sm font-bold">
              <button disabled={phase !== "observe"} onClick={() => props.onLiveChange(false)} className={`px-3 py-1.5 ${!live ? "bg-sky-600" : "bg-stone-800"} disabled:opacity-60`}>🧩 연습</button>
              <button disabled={phase !== "observe"} onClick={() => props.onLiveChange(true)} className={`px-3 py-1.5 ${live ? "bg-red-600" : "bg-stone-800"} disabled:opacity-60`}>🔥 실전</button>
            </div>
            <span className="text-xs text-stone-400">{live ? "실시간으로 직접 쏴요. ⭐⭐⭐은 실전에서만." : "시간을 멈추고 사격을 예약해요. 순수 퍼즐."}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => nudgeAim(-0.5)} className="rounded-lg bg-stone-800 px-3 py-2 text-sm" aria-label="조준 올리기">▲</button>
            <button onClick={() => nudgeAim(-0.1)} className="rounded-lg bg-stone-800 px-2 py-2 text-xs" aria-label="조준 미세하게 올리기">▴</button>
            <button onClick={() => nudgeAim(0.1)} className="rounded-lg bg-stone-800 px-2 py-2 text-xs" aria-label="조준 미세하게 내리기">▾</button>
            <button onClick={() => nudgeAim(0.5)} className="rounded-lg bg-stone-800 px-3 py-2 text-sm" aria-label="조준 내리기">▼</button>
            {phase === "observe" && !live && (
              <>
                <button onClick={reserve} disabled={reserved.length >= stage.ammo} className="rounded-lg bg-yellow-500 px-3 py-2 text-sm font-black text-stone-900 disabled:opacity-40">🎯 이 순간 예약 (Space)</button>
                <button onClick={begin} disabled={!reserved.length} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-black disabled:opacity-40">▶ 실행</button>
              </>
            )}
            {phase === "observe" && live && (
              <button onClick={begin} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-black hover:bg-red-500">🔥 실전 시작 (Space)</button>
            )}
            {(phase === "run" || phase === "countdown") && live && (
              <button onPointerDown={(e) => { e.preventDefault(); fire(); }} className="min-w-32 rounded-xl bg-red-600 px-6 py-3 text-lg font-black active:scale-95">💥 발사</button>
            )}
            {(phase === "run" || phase === "countdown") && (
              <button onClick={toObserve} className="rounded-lg bg-stone-700 px-3 py-2 text-sm">■ 중단</button>
            )}
          </div>
          {!live && reserved.length > 0 && phase === "observe" && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {reserved.map((r, i) => (
                <span key={`${r.tick}-${r.angle}-${i}`} className="flex items-center gap-1 rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs">
                  <button onClick={() => { setPlaying(false); setScrubT(r.tick / TPS); setAim(r.angle); }} className="font-bold" title="이 예약으로 이동">
                    {i + 1}발 · {fmtT(r.tick / TPS)} · {elev(r.angle)}
                  </button>
                  <button onClick={() => setReserved((list) => list.filter((_, j) => j !== i))} aria-label={`${i + 1}발 예약 취소`} className="px-1 text-stone-300 hover:text-white">✕</button>
                </span>
              ))}
            </div>
          )}
          <div className="mt-2 text-[11px] text-stone-500">
            마우스: 가리켜 조준, {live ? "클릭으로 발사" : "Space로 예약"} · 터치: 화면을 위아래로 끌어 조준{live ? ", 💥 버튼으로 발사" : ""}
          </div>
          {mine.length > 0 && phase === "observe" && (
            <label className="mt-1 flex items-center gap-1 text-xs text-stone-400">
              <input type="checkbox" checked={showMine} onChange={(e) => setShowMine(e.target.checked)} /> 지난 시도 탄도 보기
            </label>
          )}
        </div>

        <div className="rounded-xl bg-stone-900 p-3 md:w-64">
          <div className="mb-1 text-sm font-black">💡 힌트</div>
          <div className="flex gap-1.5">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                disabled={hint >= n || hint < n - 1}
                onClick={() => setHint(n)}
                className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-bold ${hint >= n ? "bg-amber-600" : "bg-stone-800 hover:bg-stone-700"} disabled:cursor-default`}
              >
                {n === 1 ? "장치" : n === 2 ? "시간대" : "정답 고스트"}
              </button>
            ))}
          </div>
          <div className="mt-2 min-h-10 text-xs text-stone-300">
            {hint === 0 && "막히면 하나씩 열어 보세요. 3단계(정답 고스트)를 보면 이 스테이지는 ⭐⭐까지만."}
            {hint >= 1 && <div>① {stage.hint}</div>}
            {hint >= 2 && <div className="mt-1">② 타임라인의 노란 구간 근처에 쏘면 돼요.</div>}
            {hint >= 3 && <div className="mt-1 text-cyan-300">③ 하늘색 점선이 모범 답안 탄도예요.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
