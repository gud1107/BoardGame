"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ZONES, zoneAt, type SharkDef, type UpgradeLevels } from "./data";
import { createWorld, depthMeters, step, summarize, type MissionState, type RunSummary, type SharkInput, type World } from "./engine";
import { drawWorld, updateCamera, viewHeightFor, type Camera } from "./render";
import { SharkAudio } from "./audio";
import BestiaryPanel from "./BestiaryPanel";
import { selectMarkers } from "./markers";

/**
 * requestAnimationFrame host for one dive: owns the mutable `World`, turns
 * mouse/keyboard/touch into a `SharkInput`, drains `world.events` into SFX +
 * banners, and mirrors a small HUD snapshot into React state at ~10 Hz (the
 * canvas itself never goes through React).
 */

interface Hud {
  hp: number;
  maxHp: number;
  boost: number;
  boostMax: number;
  gauge: number;
  cap: number;
  goldActive: boolean;
  mega: boolean;
  goldRemaining: number;
  mult: number;
  rushCount: number;
  score: number;
  coins: number;
  combo: number;
  depth: number;
  zone: string;
  time: number;
  poisoned: boolean;
  airborne: boolean;
  missions: MissionState[];
}

interface Banner {
  id: number;
  text: string;
  sub?: string;
  tone: "gold" | "mega" | "mission" | "chest";
}

const JOY_R = 52;

export default function HungrySharkCanvas({
  def,
  upgrades,
  muted,
  onToggleMute,
  markersOn,
  onToggleMarkers,
  onEnd,
  onQuit,
}: {
  def: SharkDef;
  upgrades: UpgradeLevels;
  muted: boolean;
  onToggleMute: () => void;
  markersOn: boolean;
  onToggleMarkers: () => void;
  onEnd: (summary: RunSummary) => void;
  onQuit: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<World | null>(null);
  const camRef = useRef<Camera>({ x: 0, y: 0, zoom: 1 });
  const audioRef = useRef<SharkAudio | null>(null);
  const sizeRef = useRef({ w: 800, h: 500, dpr: 1 });
  const pausedRef = useRef(false);
  const markersOnRef = useRef(markersOn);
  useEffect(() => {
    markersOnRef.current = markersOn;
  }, [markersOn]);
  const bestiaryRef = useRef(false);
  const input = useRef({
    keys: new Set<string>(),
    mouse: null as { x: number; y: number } | null,
    mouseDown: false,
    joy: null as { id: number; ox: number; oy: number; x: number; y: number } | null,
    touchBoost: false,
  });
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);

  const [hud, setHud] = useState<Hud | null>(null);
  const [paused, setPaused] = useState(false);
  const [banners, setBanners] = useState<Banner[]>([]);
  // Only ever rendered client-side (dynamic import with ssr:false).
  const [isTouch] = useState(() => typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0));
  const [joyView, setJoyView] = useState<{ ox: number; oy: number; x: number; y: number } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [dead, setDead] = useState<string | null>(null);
  const [bestiary, setBestiary] = useState<{ eaten: World["run"]["eaten"] } | null>(null);

  const openBestiary = useCallback((open: boolean) => {
    const w = worldRef.current;
    if (!w || w.over) return;
    bestiaryRef.current = open;
    if (open) {
      pausedRef.current = true;
      setPaused(true);
      setBestiary({ eaten: { ...w.run.eaten } });
    } else setBestiary(null);
  }, []);

  const pushBanner = useCallback((b: Omit<Banner, "id">) => {
    const id = Date.now() + Math.random();
    setBanners((prev) => [...prev.slice(-2), { ...b, id }]);
    setTimeout(() => setBanners((prev) => prev.filter((x) => x.id !== id)), 2200);
  }, []);

  const setPause = useCallback((p: boolean) => {
    if (worldRef.current?.over) return;
    pausedRef.current = p;
    setPaused(p);
  }, []);

  // Audio lifecycle + mute sync.
  useEffect(() => {
    const a = new SharkAudio();
    a.muted = muted;
    audioRef.current = a;
    return () => a.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    audioRef.current?.setMuted(muted);
  }, [muted]);

  // Resize: fill the wrapper width, height capped to the viewport.
  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      const fs = !!document.fullscreenElement;
      const w = wrap.clientWidth;
      const vh = window.innerHeight;
      const h = fs ? vh : Math.round(Math.max(360, Math.min(w * 0.62, vh - 150)));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.height = `${h}px`;
      sizeRef.current = { w, h, dpr };
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    const onFs = () => {
      setFullscreen(!!document.fullscreenElement);
      resize();
    };
    document.addEventListener("fullscreenchange", onFs);
    window.addEventListener("resize", resize);
    return () => {
      ro.disconnect();
      document.removeEventListener("fullscreenchange", onFs);
      window.removeEventListener("resize", resize);
    };
  }, []);

  // Keyboard.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "b") {
        openBestiary(!bestiaryRef.current);
        return;
      }
      if (k === "escape" || k === "p") {
        // Esc inside the bestiary just closes it (stays paused).
        if (bestiaryRef.current) openBestiary(false);
        else setPause(!pausedRef.current);
        return;
      }
      if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d", "shift"].includes(k)) {
        e.preventDefault();
        input.current.keys.add(k);
        audioRef.current?.unlock();
      }
    };
    const up = (e: KeyboardEvent) => input.current.keys.delete(e.key.toLowerCase());
    const blur = () => {
      input.current.keys.clear();
      input.current.mouseDown = false;
    };
    const vis = () => {
      if (document.hidden) setPause(true);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [setPause, openBestiary]);

  // Main loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const world = createWorld(def, upgrades);
    worldRef.current = world;
    const { h } = sizeRef.current;
    camRef.current = { x: world.shark.x, y: world.shark.y, zoom: h / viewHeightFor(def) };

    let raf = 0;
    let last = performance.now();
    let hudAcc = 0;
    let endTimer: number | null = null;
    let lastBeep = 0;
    let seenDanger = new Set<number>();

    const readInput = (): SharkInput => {
      const inp = input.current;
      const k = inp.keys;
      let dx = 0, dy = 0;
      if (k.has("arrowleft") || k.has("a")) dx -= 1;
      if (k.has("arrowright") || k.has("d")) dx += 1;
      if (k.has("arrowup") || k.has("w")) dy -= 1;
      if (k.has("arrowdown") || k.has("s")) dy += 1;
      if (dx === 0 && dy === 0) {
        if (inp.joy) {
          const jx = inp.joy.x - inp.joy.ox, jy = inp.joy.y - inp.joy.oy;
          if (Math.hypot(jx, jy) > 8) { dx = jx; dy = jy; }
        } else if (inp.mouse) {
          const { w, h } = sizeRef.current;
          const cam = camRef.current;
          const sx = (world.shark.x - cam.x) * cam.zoom + w / 2;
          const sy = (world.shark.y - cam.y) * cam.zoom + h / 2;
          const mx = inp.mouse.x - sx, my = inp.mouse.y - sy;
          if (Math.hypot(mx, my) > 24) { dx = mx; dy = my; }
        }
      }
      const boost = k.has(" ") || k.has("shift") || inp.mouseDown || inp.touchBoost;
      return { dirX: dx, dirY: dy, boost };
    };

    const handleEvents = () => {
      const a = audioRef.current;
      for (const ev of world.events) {
        switch (ev.type) {
          case "eat": {
            const big = world.gold.active || ["fishingBoat", "yacht", "submarine", "helicopter", "ghostShark", "smallShark", "angler", "cageDiver"].includes(ev.kind);
            a?.crunch(big);
            a?.gulp();
            break;
          }
          case "bite": a?.crunch(true); break;
          case "hurt": a?.hurt(); if (navigator.vibrate) navigator.vibrate(40); break;
          case "poison": a?.poison(); break;
          case "bounce": a?.bounce(); break;
          case "explode": a?.explosion(ev.big); if (navigator.vibrate) navigator.vibrate(ev.big ? 120 : 70); break;
          case "jumpOut": a?.jump(); a?.setAirborne(true); break;
          case "splash": a?.splash(ev.strength); a?.setAirborne(false); break;
          case "coin": a?.coin(); break;
          case "torpedo": a?.torpedo(); break;
          case "goldStart":
            a?.goldRush(ev.mega);
            pushBanner(ev.mega
              ? { text: "MEGA GOLD RUSH!", sub: `×${ev.multiplier} · 무엇이든 먹어치워라!`, tone: "mega" }
              : { text: "GOLD RUSH!", sub: `×${ev.multiplier} 점수 · 무적 · 부스트 무제한`, tone: "gold" });
            break;
          case "goldEnd": a?.goldEnd(); break;
          case "mission": a?.mission(); pushBanner({ text: "미션 완료!", sub: `${ev.label} · +${ev.reward}🪙`, tone: "mission" }); break;
          case "chest": pushBanner({ text: "보물 상자 발견!", sub: `+${ev.amount}🪙`, tone: "chest" }); break;
          case "death": a?.death(); break;
        }
      }
      world.events.length = 0;
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { w, h, dpr } = sizeRef.current;
      if (!pausedRef.current) {
        step(world, readInput(), dt);
        handleEvents();
        updateCamera(camRef.current, world, w, h, dt);
        const hpFrac = world.shark.hp / world.stats.maxHealth;
        if (hpFrac < 0.25 && !world.over && !world.gold.active) audioRef.current?.heartbeat(now, 1 - hpFrac / 0.25);
      }
      const markers = markersOnRef.current ? selectMarkers(world) : [];
      // Danger-approach beep: only when a new threat first enters the reticle set.
      if (!pausedRef.current && markers.length) {
        const cur = new Set<number>();
        let fresh = false;
        for (const m of markers)
          if (m.kind === "danger") {
            cur.add(m.e.id);
            if (!seenDanger.has(m.e.id)) fresh = true;
          }
        if (fresh && now - lastBeep > 700) {
          lastBeep = now;
          audioRef.current?.beep();
        }
        seenDanger = cur;
      }
      drawWorld(ctx, world, camRef.current, w, h, now / 1000, dpr, markers);

      hudAcc += dt;
      if (hudAcc > 0.1) {
        hudAcc = 0;
        const s = world.shark;
        setHud({
          hp: s.hp,
          maxHp: world.stats.maxHealth,
          boost: s.boost,
          boostMax: world.stats.boostDuration,
          gauge: world.gold.gauge,
          cap: world.gold.capacity,
          goldActive: world.gold.active,
          mega: world.gold.mega,
          goldRemaining: world.gold.remaining,
          mult: world.gold.multiplier,
          rushCount: world.gold.count,
          score: world.score,
          coins: world.coins,
          combo: world.combo,
          depth: depthMeters(s.y),
          zone: s.y < 0 ? "공중" : (ZONES.find((z) => z.id === zoneAt(s.y))?.name ?? ""),
          time: world.time,
          poisoned: !!s.poison,
          airborne: s.airborne,
          missions: world.missions.map((m) => ({ ...m })),
        });
      }
      if (world.over && endTimer === null) {
        setDead(world.deathCause);
        endTimer = window.setTimeout(() => onEndRef.current(summarize(world)), 1800);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      if (endTimer !== null) clearTimeout(endTimer);
    };
    // A dive is created once per mount; the parent remounts for a new run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Pointer input ──
  const localPos = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onPointerDown = (e: React.PointerEvent) => {
    audioRef.current?.unlock();
    const p = localPos(e);
    if (e.pointerType === "touch") {
      if (!input.current.joy) {
        input.current.joy = { id: e.pointerId, ox: p.x, oy: p.y, x: p.x, y: p.y };
        setJoyView({ ox: p.x, oy: p.y, x: p.x, y: p.y });
        (e.target as Element).setPointerCapture?.(e.pointerId);
      }
      return;
    }
    input.current.mouse = p;
    if (e.button === 0) input.current.mouseDown = true;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = localPos(e);
    const joy = input.current.joy;
    if (e.pointerType === "touch") {
      if (joy && joy.id === e.pointerId) {
        let dx = p.x - joy.ox, dy = p.y - joy.oy;
        const d = Math.hypot(dx, dy);
        if (d > JOY_R) { dx = (dx / d) * JOY_R; dy = (dy / d) * JOY_R; }
        joy.x = joy.ox + dx;
        joy.y = joy.oy + dy;
        setJoyView({ ox: joy.ox, oy: joy.oy, x: joy.x, y: joy.y });
      }
      return;
    }
    input.current.mouse = p;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") {
      if (input.current.joy?.id === e.pointerId) {
        input.current.joy = null;
        setJoyView(null);
      }
      return;
    }
    input.current.mouseDown = false;
  };

  const toggleFullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => {});
  };

  const hpPct = hud ? Math.max(0, hud.hp / hud.maxHp) : 1;
  const boostPct = hud ? hud.boost / hud.boostMax : 1;
  const gaugePct = hud ? Math.min(1, hud.gauge / hud.cap) : 0;
  const mm = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  return (
    <div
      ref={wrapRef}
      className={`relative w-full select-none overflow-hidden bg-slate-950 ${fullscreen ? "" : "rounded-2xl border border-white/10 light:border-slate-300"}`}
      style={{ touchAction: "none" }}
    >
      <style>{`@keyframes hsBanner{0%{opacity:0;transform:scale(.6)}12%{opacity:1;transform:scale(1.08)}20%{transform:scale(1)}80%{opacity:1}100%{opacity:0;transform:translateY(-16px)}}.hs-banner{animation:hsBanner 2.2s ease-out forwards}`}</style>
      <canvas
        ref={canvasRef}
        className="block w-full cursor-crosshair"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={(e) => e.pointerType !== "touch" && (input.current.mouseDown = false)}
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* ── HUD ── */}
      {hud && (
        <>
          <div className="pointer-events-none absolute top-2 left-2 flex w-[min(46%,260px)] flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-base">{hud.poisoned ? "🤢" : hpPct < 0.25 ? "💔" : "❤️"}</span>
              <div className="relative h-3.5 flex-1 overflow-hidden rounded-full bg-black/50 ring-1 ring-white/20">
                <div
                  className={`h-full rounded-full transition-[width] duration-100 ${hud.goldActive ? "bg-gradient-to-r from-yellow-300 to-amber-500" : hud.poisoned ? "bg-gradient-to-r from-lime-400 to-green-600" : hpPct < 0.25 ? "animate-pulse bg-gradient-to-r from-red-500 to-rose-700" : "bg-gradient-to-r from-rose-400 to-red-600"}`}
                  style={{ width: `${hpPct * 100}%` }}
                />
                <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white drop-shadow">
                  {Math.ceil(Math.max(0, hud.hp))} / {hud.maxHp}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm">🚀</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/50 ring-1 ring-white/20">
                <div
                  className={`h-full rounded-full ${hud.goldActive ? "bg-yellow-300" : "bg-gradient-to-r from-sky-300 to-cyan-500"}`}
                  style={{ width: `${(hud.goldActive ? 1 : boostPct) * 100}%` }}
                />
              </div>
            </div>
            <div className="text-[11px] font-semibold text-white/85 drop-shadow">
              {hud.airborne ? "🌤️ 공중" : `🌊 ${hud.depth}m · ${hud.zone}`}
            </div>
          </div>

          <div className="pointer-events-none absolute top-2 left-1/2 flex w-[min(34%,240px)] -translate-x-1/2 flex-col items-center gap-0.5">
            <div className={`text-[10px] font-black tracking-widest drop-shadow ${hud.mega ? "text-pink-300" : "text-yellow-300"}`}>
              {hud.goldActive ? `${hud.mega ? "MEGA " : ""}GOLD RUSH ×${hud.mult} · ${Math.ceil(hud.goldRemaining)}s` : `GOLD RUSH ${hud.rushCount > 0 ? `(${hud.rushCount}회)` : ""}`}
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-black/50 ring-1 ring-yellow-300/40">
              <div
                className={`h-full rounded-full ${hud.mega ? "bg-gradient-to-r from-pink-400 via-yellow-300 to-pink-400" : "bg-gradient-to-r from-yellow-200 via-amber-400 to-yellow-500"} ${hud.goldActive ? "animate-pulse" : ""}`}
                style={{ width: `${gaugePct * 100}%` }}
              />
            </div>
          </div>

          <div className="pointer-events-none absolute top-2 right-2 flex flex-col items-end text-right drop-shadow">
            <div className="text-lg leading-none font-black text-white tabular-nums sm:text-2xl">{hud.score.toLocaleString()}</div>
            <div className="mt-0.5 text-xs font-bold text-yellow-300 tabular-nums">🪙 {hud.coins.toLocaleString()}</div>
            <div className="text-[11px] text-white/70 tabular-nums">⏱ {mm(hud.time)}</div>
            {hud.combo >= 3 && (
              <div className="mt-1 animate-pulse text-sm font-black text-orange-300">{hud.combo} 콤보!</div>
            )}
          </div>

          <div className="pointer-events-none absolute bottom-2 left-2 hidden flex-col gap-0.5 rounded-lg bg-black/40 px-2 py-1.5 text-[10px] text-white/80 sm:flex">
            {hud.missions.map((m) => (
              <div key={m.id} className={m.done ? "text-emerald-300 line-through" : ""}>
                {m.done ? "✅" : "🎯"} {m.label} ({m.progress.toLocaleString()}/{m.goal.toLocaleString()})
              </div>
            ))}
          </div>
        </>
      )}

      {/* Top-right controls row (under the score block). */}
      <div className="absolute top-[4.6rem] right-2 flex gap-1 sm:top-20">
        <button onClick={() => setPause(!paused)} className="rounded-md bg-black/50 px-2 py-1 text-xs text-white hover:bg-black/70" aria-label="일시정지">
          {paused ? "▶" : "⏸"}
        </button>
        <button
          onClick={onToggleMarkers}
          className={`rounded-md px-2 py-1 text-xs text-white hover:bg-black/70 ${markersOn ? "bg-emerald-600/70" : "bg-black/50"}`}
          aria-label="먹이 인디케이터"
          title="먹이 인디케이터 켜기/끄기"
        >
          🎯
        </button>
        <button onClick={() => openBestiary(true)} className="rounded-md bg-black/50 px-2 py-1 text-xs text-white hover:bg-black/70" aria-label="먹이 도감" title="먹이 도감 (B)">
          📖
        </button>
        <button onClick={onToggleMute} className="rounded-md bg-black/50 px-2 py-1 text-xs text-white hover:bg-black/70" aria-label="소리">
          {muted ? "🔇" : "🔊"}
        </button>
        <button onClick={toggleFullscreen} className="rounded-md bg-black/50 px-2 py-1 text-xs text-white hover:bg-black/70" aria-label="전체화면">
          {fullscreen ? "🗗" : "⛶"}
        </button>
      </div>

      {/* Banners */}
      <div className="pointer-events-none absolute inset-x-0 top-[22%] flex flex-col items-center gap-2">
        {banners.map((b) => (
          <div key={b.id} className="hs-banner text-center">
            <div
              className={`text-3xl font-black tracking-wider drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)] sm:text-5xl ${
                b.tone === "mega" ? "bg-gradient-to-r from-pink-300 via-yellow-200 to-pink-300 bg-clip-text text-transparent"
                : b.tone === "gold" ? "text-yellow-300"
                : b.tone === "chest" ? "text-amber-300"
                : "text-emerald-300"
              }`}
            >
              {b.text}
            </div>
            {b.sub && <div className="mt-1 text-xs font-semibold text-white drop-shadow sm:text-sm">{b.sub}</div>}
          </div>
        ))}
      </div>

      {/* Touch joystick + boost */}
      {isTouch && joyView && (
        <div className="pointer-events-none absolute" style={{ left: joyView.ox - JOY_R, top: joyView.oy - JOY_R }}>
          <div className="rounded-full border-2 border-white/40 bg-white/10" style={{ width: JOY_R * 2, height: JOY_R * 2 }} />
          <div
            className="absolute h-10 w-10 rounded-full bg-white/60"
            style={{ left: JOY_R - 20 + (joyView.x - joyView.ox), top: JOY_R - 20 + (joyView.y - joyView.oy) }}
          />
        </div>
      )}
      {isTouch && (
        <button
          className="absolute right-4 bottom-[27%] flex h-20 w-20 items-center justify-center rounded-full border-2 border-sky-200/60 bg-sky-500/40 text-3xl text-white active:scale-95 active:bg-sky-400/60"
          onPointerDown={(e) => {
            e.stopPropagation();
            audioRef.current?.unlock();
            input.current.touchBoost = true;
          }}
          onPointerUp={() => (input.current.touchBoost = false)}
          onPointerCancel={() => (input.current.touchBoost = false)}
          onPointerLeave={() => (input.current.touchBoost = false)}
          aria-label="부스트"
        >
          🚀
        </button>
      )}

      {/* Pause overlay */}
      {paused && !dead && !bestiary && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/70 backdrop-blur-sm">
          <div className="text-3xl font-black text-white">일시정지</div>
          <p className="text-xs text-white/60">Esc / P 키로 재개 · B 먹이 도감</p>
          <button onClick={() => setPause(false)} className="w-48 rounded-xl bg-sky-500 py-2.5 font-bold text-white hover:bg-sky-400">
            ▶ 계속하기
          </button>
          <button onClick={onQuit} className="w-48 rounded-xl bg-white/10 py-2.5 font-semibold text-white hover:bg-white/20">
            🏳️ 포기하고 나가기
          </button>
          <button onClick={() => openBestiary(true)} className="w-48 rounded-xl bg-emerald-600/80 py-2.5 font-semibold text-white hover:bg-emerald-500">
            📖 먹이 도감
          </button>
        </div>
      )}

      {bestiary && !dead && (
        <div className="absolute inset-0 flex flex-col bg-slate-950/90 backdrop-blur-sm">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
            <div className="text-base font-black text-white">📖 해양 생태계 먹이 도감</div>
            <div className="flex gap-1.5">
              <button onClick={() => openBestiary(false)} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20">
                ← 일시정지 메뉴
              </button>
              <button
                onClick={() => {
                  openBestiary(false);
                  setPause(false);
                }}
                className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-400"
              >
                ▶ 계속하기
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <BestiaryPanel tier={def.tier} sharkName={def.name} biteLevel={upgrades.bite} eaten={bestiary.eaten} />
          </div>
        </div>
      )}

      {dead && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-red-950/40">
          <div className="hs-banner text-5xl font-black text-red-400 drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]">GAME OVER</div>
          <div className="mt-2 text-sm font-semibold text-white drop-shadow">사인: {dead}</div>
        </div>
      )}
    </div>
  );
}
