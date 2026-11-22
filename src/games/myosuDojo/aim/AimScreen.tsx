"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { dojoAudio } from "../sound";
import { normParam, type AimAdapter, type AimStage, type Params, type ShotRun } from "./types";

/**
 * One physics puzzle stage (🎱 당구 / 🥏 알까기 / 🥌 컬링): aim with the
 * pointer or the fine-tune buttons, fire, watch the replay, read which star
 * conditions held. Every attempt reports its stars to the parent.
 */
export default function AimScreen<S extends AimStage>({
  adapter,
  stage,
  bestStars,
  onFinish,
  onNext,
  hasNext,
  onExit,
}: {
  adapter: AimAdapter<S>;
  stage: S;
  bestStars: number;
  onFinish: (stars: number, peeked: boolean) => void;
  onNext: () => void;
  hasNext: boolean;
  onExit: () => void;
}) {
  const [params, setParams] = useState<Params>(() => adapter.defaults(stage));
  const [run, setRun] = useState<ShotRun | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fast, setFast] = useState(false);
  const [peeked, setPeeked] = useState(false);
  const [hint, setHint] = useState(false);
  const [tries, setTries] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(640);
  const dragging = useRef(false);

  const v = adapter.view;
  const vw = v.maxX - v.minX;
  const vh = v.maxY - v.minY;
  const maxH = typeof window === "undefined" ? 600 : Math.max(320, window.innerHeight * 0.62);
  const scale = Math.min(width / vw, maxH / vh);
  const cw = Math.round(vw * scale);
  const ch = Math.round(vh * scale);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const bodies = useMemo(() => adapter.bodies(stage, params), [adapter, stage, params]);

  // playback clock
  useEffect(() => {
    if (!playing || !run) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let f = frame;
    const step = () => {
      const now = performance.now();
      acc += ((now - last) / 1000) * (fast ? 2.5 : 1);
      last = now;
      let moved = false;
      while (acc >= run.frameDt && f < run.frames.length - 1) {
        acc -= run.frameDt;
        f++;
        moved = true;
        for (const h of run.hits) {
          if (h.f !== f) continue;
          if (h.kind === "ball") dojoAudio.clack(h.power);
          else if (h.kind === "rail") dojoAudio.rail(h.power);
          else dojoAudio.drop();
        }
      }
      if (moved) setFrame(f);
      if (f >= run.frames.length - 1) {
        setPlaying(false);
        if (run.outcome.stars > 0) dojoAudio.clear(run.outcome.stars);
        else dojoAudio.fail();
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, run, fast]);

  // draw
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1);
    cv.width = cw * dpr;
    cv.height = ch * dpr;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const px = (x: number, y: number): [number, number] => [(x - v.minX) * scale, (y - v.minY) * scale];
    adapter.drawTable(ctx, stage, px, scale);
    if (!run) {
      for (const g of adapter.guide(stage, params)) {
        if (g.pts.length < 2) continue;
        ctx.strokeStyle = g.color ?? "rgba(255,255,255,0.85)";
        ctx.lineWidth = Math.max(1.5, scale * 0.06);
        ctx.setLineDash(g.dashed ? [scale * 0.3, scale * 0.2] : []);
        ctx.beginPath();
        g.pts.forEach(([x, y], i) => {
          const [a, b] = px(x, y);
          if (i === 0) ctx.moveTo(a, b);
          else ctx.lineTo(a, b);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    const fr = run ? run.frames[Math.min(frame, run.frames.length - 1)] : null;
    bodies.forEach((b, i) => {
      const x = fr ? fr[i * 2] : b.x;
      const y = fr ? fr[i * 2 + 1] : b.y;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const [a, c] = px(x, y);
      const r = b.r * scale;
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.beginPath();
      ctx.arc(a + r * 0.18, c + r * 0.22, r, 0, Math.PI * 2);
      ctx.fill();
      const g = ctx.createRadialGradient(a - r * 0.35, c - r * 0.35, r * 0.1, a, c, r);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.25, b.color);
      g.addColorStop(1, b.color);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(a, c, r, 0, Math.PI * 2);
      ctx.fill();
      if (b.ring && !run) {
        ctx.strokeStyle = b.ring;
        ctx.lineWidth = Math.max(2, r * 0.22);
        ctx.beginPath();
        ctx.arc(a, c, r + ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (b.label) {
        ctx.fillStyle = b.color === "#111827" || b.color === "#2563eb" || b.color === "#7c3aed" ? "#f8fafc" : "#111827";
        ctx.font = `900 ${Math.max(9, r * 1.05)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(b.label, a, c + 0.5);
      }
    });
  }, [adapter, stage, params, run, frame, bodies, cw, ch, scale, v.minX, v.minY]);

  const set = (key: string, value: number) => {
    const spec = adapter.params.find((p) => p.key === key)!;
    setParams((p) => ({ ...p, [key]: normParam(spec, value) }));
  };

  const fire = () => {
    if (run) return;
    dojoAudio.unlock();
    dojoAudio.cue();
    const r = adapter.run(stage, params);
    setRun(r);
    setFrame(0);
    setPlaying(true);
    setTries((n) => n + 1);
    onFinish(r.outcome.stars, peeked);
  };

  const again = () => {
    setRun(null);
    setPlaying(false);
    setFrame(0);
  };

  const showAnswer = () => {
    setPeeked(true);
    setRun(null);
    setPlaying(false);
    setParams({ ...adapter.defaults(stage), ...stage.solution });
  };

  // keyboard: ←→ first param, ↑↓ second, Shift = coarse, Space fire, R again
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const [p0, p1] = adapter.params;
      const k = e.key;
      if (k === "ArrowLeft" || k === "ArrowRight") {
        if (run) return;
        e.preventDefault();
        const d = (e.shiftKey ? p0.coarse : p0.step) * (k === "ArrowRight" ? 1 : -1);
        set(p0.key, (params[p0.key] ?? 0) + d);
      } else if (k === "ArrowUp" || k === "ArrowDown") {
        if (run || !p1) return;
        e.preventDefault();
        const d = (e.shiftKey ? p1.coarse : p1.step) * (k === "ArrowUp" ? 1 : -1);
        set(p1.key, (params[p1.key] ?? 0) + d);
      } else if (k === " " || k === "Enter") {
        e.preventDefault();
        if (!run) fire();
        else if (!playing) again();
      } else if (k === "r" || k === "R") again();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const toWorld = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [((e.clientX - rect.left) / rect.width) * vw + v.minX, ((e.clientY - rect.top) / rect.height) * vh + v.minY] as const;
  };
  const onDown = (e: React.PointerEvent) => {
    if (run) return;
    const [wx, wy] = toWorld(e);
    if (adapter.pick) {
      const hit = bodies.find((b) => b.pickable && (b.x - wx) ** 2 + (b.y - wy) ** 2 <= (b.r * 1.6) ** 2);
      if (hit) {
        const p = adapter.pick(stage, params, hit.id);
        if (p) {
          setParams(p);
          dojoAudio.unlock();
          dojoAudio.place();
          return;
        }
      }
    }
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setParams((p) => adapter.dragTo(stage, p, wx, wy));
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragging.current || run) return;
    const [wx, wy] = toWorld(e);
    setParams((p) => adapter.dragTo(stage, p, wx, wy));
  };
  const onUp = () => {
    dragging.current = false;
  };

  const out = run && !playing ? run.outcome : null;

  return (
    <div className="flex flex-col gap-3 text-stone-100">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onExit} className="rounded-lg bg-stone-800 px-3 py-1.5 text-sm hover:bg-stone-700">← 목록</button>
        <div className="min-w-0 flex-1">
          <div className="text-lg font-black leading-tight">
            {stage.id.toUpperCase()} · {stage.title}
          </div>
          <div className="text-sm text-amber-200">{stage.goal}</div>
        </div>
        <div className="text-sm" aria-label={`최고 별 ${bestStars}개`}>
          {"⭐".repeat(bestStars)}
          <span className="opacity-25">{"⭐".repeat(3 - bestStars)}</span>
        </div>
      </div>

      <ol className="grid gap-1 rounded-xl bg-stone-900 p-2 text-xs sm:grid-cols-3">
        {stage.tierText.map((txt, i) => {
          const ok = out ? out.tiers[i].every((c) => c.ok) && out.stars > i : null;
          return (
            <li key={i} className={`rounded-lg px-2 py-1 ${ok === null ? "bg-stone-800" : ok ? "bg-emerald-800/70" : "bg-rose-900/50"}`}>
              <span className="mr-1">{"⭐".repeat(i + 1)}</span>
              {txt}
              {ok !== null && <span className="ml-1 font-black">{ok ? "✓" : "✗"}</span>}
            </li>
          );
        })}
      </ol>

      <div ref={wrapRef} className="relative w-full">
        <canvas
          ref={canvasRef}
          style={{ width: cw, height: ch, touchAction: "none" }}
          className="mx-auto block cursor-crosshair rounded-xl shadow-lg"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          aria-label="조준판 — 끌어서 방향을 정하세요"
        />
        {out && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
            <div className={`rounded-2xl px-5 py-2 text-xl font-black shadow-xl ${out.stars > 0 ? "bg-amber-400 text-stone-900" : "bg-rose-700 text-white"}`}>{out.summary}</div>
          </div>
        )}
      </div>

      {!run ? (
        <div className="grid gap-2 rounded-xl bg-stone-900 p-3 sm:grid-cols-2">
          {adapter.params.map((p) => (
            <ParamRow key={p.key} spec={p} value={params[p.key] ?? 0} onChange={(x) => set(p.key, x)} />
          ))}
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <button onClick={fire} className="min-h-11 flex-1 rounded-xl bg-amber-400 px-5 py-2 text-lg font-black text-stone-900 shadow hover:bg-amber-300">
              {stage.id.startsWith("u") ? "🥌 던지기" : stage.id.startsWith("a") ? "👆 튕기기" : "🎱 치기"} (Space)
            </button>
            <button onClick={() => setHint((h) => !h)} className="min-h-11 rounded-xl bg-stone-800 px-3 py-2 text-sm">💡 힌트</button>
            {tries >= 3 && (
              <button onClick={showAnswer} className="min-h-11 rounded-xl bg-stone-800 px-3 py-2 text-sm" title="정답 값을 채워 줘요. 이 스테이지는 이후 ⭐ 1개까지만">
                🔑 정답 보기
              </button>
            )}
          </div>
          {hint && <p className="rounded-lg bg-stone-800 p-2 text-sm text-amber-100 sm:col-span-2">💡 {stage.hint}</p>}
          {peeked && <p className="text-xs text-stone-400 sm:col-span-2">🔑 정답 값을 채웠어요 — 이 스테이지 기록은 ⭐ 1개까지만 남아요.</p>}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {playing ? (
            <>
              <button onClick={() => setFast((f) => !f)} className="min-h-11 rounded-xl bg-stone-800 px-4 py-2 text-sm">{fast ? "⏩ 빠르게" : "▶ 보통"}</button>
              <button onClick={() => { setFrame(run.frames.length - 1); setPlaying(false); if (run.outcome.stars > 0) dojoAudio.clear(run.outcome.stars); else dojoAudio.fail(); }} className="min-h-11 rounded-xl bg-stone-800 px-4 py-2 text-sm">⏭ 결과로</button>
            </>
          ) : (
            <>
              <button onClick={again} className="min-h-11 flex-1 rounded-xl bg-amber-400 px-5 py-2 font-black text-stone-900">↺ 같은 자리에서 다시 (R)</button>
              <button onClick={() => { setFrame(0); setPlaying(true); }} className="min-h-11 rounded-xl bg-stone-800 px-4 py-2 text-sm">🔁 다시 보기</button>
              {hasNext && (run.outcome.stars > 0 || bestStars > 0) && <button onClick={onNext} className="min-h-11 rounded-xl bg-emerald-600 px-4 py-2 font-bold">다음 ▶</button>}
            </>
          )}
        </div>
      )}
      <p className="text-xs text-stone-500">판을 끌어서 방향 · ←→ {adapter.params[0].label} · ↑↓ {adapter.params[1]?.label} · Shift = 크게 · Space 실행 · R 다시</p>
    </div>
  );
}

function ParamRow({ spec, value, onChange }: { spec: AimAdapter<AimStage>["params"][number]; value: number; onChange: (v: number) => void }) {
  if (spec.toggle) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs font-bold text-stone-400">{spec.label}</span>
        <div className="flex gap-1">
          {spec.toggle.map((lbl, i) => {
            const val = i === 0 ? spec.min : spec.max;
            const on = (value >= 0 ? spec.max : spec.min) === val;
            return (
              <button key={lbl} onClick={() => onChange(val)} className={`min-h-10 flex-1 rounded-lg px-2 text-sm font-bold ${on ? "bg-sky-500 text-stone-900" : "bg-stone-800"}`} aria-pressed={on}>
                {lbl}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  const shown = spec.fmt ? spec.fmt(value) : value.toFixed(2);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-bold text-stone-400">{spec.label}</span>
        <span className="font-mono text-sm font-black text-amber-200">
          {shown}
          {spec.unit && !spec.fmt?.(value).includes(spec.unit) && /^-?[\d.]+$/.test(shown) ? spec.unit : ""}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button onClick={() => onChange(value - spec.coarse)} className="min-h-10 w-10 rounded-lg bg-stone-800 text-sm font-bold" aria-label={`${spec.label} 크게 줄이기`}>«</button>
        <button onClick={() => onChange(value - spec.step)} className="min-h-10 w-10 rounded-lg bg-stone-800 text-sm font-bold" aria-label={`${spec.label} 조금 줄이기`}>‹</button>
        <input type="range" min={spec.min} max={spec.max} step={spec.step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="min-w-0 flex-1 accent-amber-400" aria-label={spec.label} />
        <button onClick={() => onChange(value + spec.step)} className="min-h-10 w-10 rounded-lg bg-stone-800 text-sm font-bold" aria-label={`${spec.label} 조금 늘리기`}>›</button>
        <button onClick={() => onChange(value + spec.coarse)} className="min-h-10 w-10 rounded-lg bg-stone-800 text-sm font-bold" aria-label={`${spec.label} 크게 늘리기`}>»</button>
      </div>
    </div>
  );
}
