"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useAudioSettingsStore } from "@/lib/audio/audioSettings";
import { AUG_TAG_ICON, AUG_TAG_NAME, AUG_TIER_COLOR, AUG_TIER_NAME, AUGMENTS, AUG_ROUNDS, TICKS_PER_SEC, type AugFx, type AugmentDef, BEATS, DOCTRINES, ERA_DOCTRINES, ITEMS, PLANS, ERA_TURRETS, ERAS, LANE, QUEUE_CAP, ROLE_ICON, ROLE_NAME, SELL_REFUND, SLOT_COST, SPECIALS, TICK_MS, TURRETS, UNITS, type DoctrineId, type Era, type Role, type TurretKind } from "./data";
import { aug, commandError, evolveCost, frontProgress, incomeOf, nextEra, popCapOf, popOf, roleAug, unitCost, progress, rosterOf, secondsLeft, specialCdMax, type Command, type EraMarchState, type FxEvent, type Side } from "./engine";
import { EraMarchSound, eraSuite, playCue, unlockAudio } from "./eraMarchAudio";
import type { MatchDriver } from "./driver";
import { BattleScene, TEAM_HEX } from "./three/battleScene";

/**
 * Play screen: full-screen 3D battlefield + HUD. A `MatchDriver` owns the
 * simulation (local vs AI, or the online replay); the board only renders,
 * collects commands and hands each tick's events to the scene, the sound
 * layer and the HUD toasts. Your own base is always on the left: the guest
 * (side 1) gets a mirrored view.
 *
 * The HUD re-renders at ~10 Hz from a state snapshot instead of on every tick.
 */

export interface MatchSummary {
  won: boolean;
  draw: boolean;
  seconds: number;
  era: Era;
  enemyEra: Era;
  trained: number;
  kills: number;
  lost: number;
  damage: number;
  specials: number;
  goldEarned: number;
  doctrines: DoctrineId[];
}

interface Toast {
  id: number;
  text: string;
  tone: "info" | "warn" | "good" | "big";
  at: number;
}

const ROLE_ORDER: Role[] = ["melee", "ranged", "charge", "support"];

const counterOf = (r: Role): Role | null => (r === "support" ? null : (ROLE_ORDER.find((x) => BEATS[x] === r) ?? null));

interface Props {
  driver: MatchDriver;
  reduceShake: boolean;
  /** Line under the "진격!" banner, e.g. "Lv.5 중사 상대". */
  subtitle: string;
  onEnd: (m: MatchSummary) => void;
  onQuit: () => void;
  onRules: () => void;
  /** Extra overlay (online: takeover banners / vote modal). */
  children?: ReactNode;
}

export default function EraMarchBoard({ driver, reduceShake, subtitle, onEnd, onQuit, onRules, children }: Props) {
  const ME = driver.mySide;
  const FOE: Side = ME === 0 ? 1 : 0;
  const online = driver.online;
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<BattleScene | null>(null);
  const stateRef = useRef<EraMarchState>(driver.state());
  const pausedRef = useRef(false);
  const speedRef = useRef(1);
  // HUD snapshot: the live state object plus a counter so React re-renders at ~10 Hz
  const [hud, setHud] = useState(() => ({ s: driver.state(), n: 0, lag: 0 }));
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [turretOpen, setTurretOpen] = useState(false);
  const [doctrinePick, setDoctrinePick] = useState<Era | null>(null);
  const [bookOpen, setBookOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [countdown, setCountdown] = useState(4);
  const [banner, setBanner] = useState<{ title: string; sub: string; color: string } | null>(null);
  const toastId = useRef(0);
  const endedRef = useRef(false);
  const countRef = useRef(4);
  const audio = useAudioSettingsStore();
  const soundOn = !audio.masterMuted && !(audio.bgmMuted && audio.sfxMuted);

  const toast = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, text, tone, at: Date.now() }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "big" ? 2600 : 2200);
  }, []);

  const send = useCallback((cmd: Command) => {
    unlockAudio();
    const err = commandError(stateRef.current, ME, cmd);
    if (err) {
      playCue("reject");
      toast(err, "warn");
      return;
    }
    driver.send(cmd);
    playCue("click", 0.6);
  }, [toast, driver, ME]);

  const setPause = useCallback((v: boolean) => {
    if (online) return;
    pausedRef.current = v;
    setPaused(v);
    playCue("pause", 0.7);
  }, [online]);

  /* ── event → HUD toasts / banners ─────────────────────────────────── */
  const onEventsHud = useCallback((events: FxEvent[], s: EraMarchState) => {
    for (const e of events) {
      if (e.t === "evolve") {
        const era = ERAS[e.era];
        const doc = e.doctrine ? DOCTRINES[e.doctrine] : null;
        if (e.side === ME) setBanner({ title: `${era.emoji} ${era.name}`, sub: doc ? `${doc.emoji} ${doc.name} — ${doc.passive}` : "", color: era.accent });
        else toast(`상대가 ${era.emoji} ${era.name}로 진화!${doc ? ` (${doc.emoji} ${doc.name})` : ""}`, "warn");
      } else if (e.t === "special") {
        const sp = SPECIALS[e.era];
        if (e.side === ME) setBanner({ title: `${sp.emoji} ${sp.name}!`, sub: sp.desc, color: "#fde68a" });
        else toast(`⚠ 상대 필살기: ${sp.emoji} ${sp.name}`, "warn");
      } else if (e.t === "specialReady" && e.side === ME) toast(`${SPECIALS[s.players[ME].era].emoji} 필살기 준비 완료 [R]`, "good");
      else if (e.t === "reject" && e.side === ME && online) toast(e.reason, "warn");
      else if (e.t === "augOffer" && e.side === ME) {
        // solo: the battle waits while you read the cards
        if (!online) pausedRef.current = true;
        toast(`✨ ${AUG_TIER_NAME[e.tier]} 증강 선택!`, "big");
      } else if (e.t === "augReroll" && e.side === ME && !online) pausedRef.current = true;
      else if (e.t === "augment") {
        const a = AUGMENTS[e.id];
        if (!a) continue;
        if (e.side === ME) setBanner({ title: `${a.emoji} ${a.name}`, sub: `${e.auto ? "시간 초과 — 자동 선택 · " : ""}${a.desc}`, color: AUG_TIER_COLOR[a.tier] });
        else toast(`상대 증강: ${a.emoji} ${a.name}`, "warn");
      } else if (e.t === "suddenDeath") setBanner({ title: "⏳ 서든데스", sub: "양쪽 기지가 매초 무너집니다", color: "#f87171" });
    }
  }, [toast, ME, online]);

  /* ── mount: scene + loop ──────────────────────────────────────────── */
  useEffect(() => {
    const host = hostRef.current!;
    const scene = new BattleScene(host, overlayRef.current!, ME === 1);
    sceneRef.current = scene;
    const sound = new EraMarchSound();
    const prevX = new Map<number, number>();
    let last = performance.now();
    let raf = 0;
    let hudAt = 0;
    let bgmEra: Era | null = null;
    let endAt = 0;
    let wasReady = false;
    let frameT = 0;
    const ro = new ResizeObserver(() => scene.resize());
    ro.observe(host);
    const hooks = {
      before: (s: EraMarchState) => {
        prevX.clear();
        for (const u of s.units) prevX.set(u.id, u.x);
      },
      after: (s: EraMarchState) => {
        if (!s.events.length) return;
        scene.onEvents(s.events, s);
        sound.handle(s.events, scene.view(), ME, frameT);
        onEventsHud(s.events, s);
      },
    };
    const extra = driver as MatchDriver & { replaced?: boolean; lag?: () => number };

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      frameT = t;
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      const before = driver.state();
      const running = !pausedRef.current && countRef.current <= 0 && before.winner === null;
      // online the clock never pauses — only the opening countdown holds it
      driver.pump(running ? dt * 1000 * speedRef.current : 0, hooks);
      if (extra.replaced) {
        extra.replaced = false;
        scene.reset();
        prevX.clear();
      }
      const s = driver.state();
      stateRef.current = s;
      const alpha = running ? driver.alpha() : 1;
      scene.render({ s, prevX, alpha, now: t, dt, viewer: ME, reduceShake });
      drawMinimap(miniRef.current, s, scene.view(), ME);

      // BGM follows my era; urgent layer when my base is low or in sudden death
      const myEra = s.players[ME].era;
      if (myEra !== bgmEra) {
        if (bgmEra !== null) eraSuite(bgmEra).setBgmWanted(false);
        bgmEra = myEra;
        eraSuite(myEra).setBgmWanted(true);
      }
      const urgent = s.players[ME].baseHp / s.players[ME].baseMax < 0.35 || s.suddenDeath;
      const suite = eraSuite(myEra);
      suite.setIntensity(urgent ? 1 : 0);
      suite.setTempo(urgent ? 1.08 : 1);

      const n = nextEra(s.players[ME]);
      const ready = n !== null && s.players[ME].xp >= ERAS[n].xpNeed && s.players[ME].gold >= evolveCost(s, ME);
      if (ready && !wasReady) playCue("ready", 0.8);
      wasReady = ready;

      if (t - hudAt > 100) {
        hudAt = t;
        const lag = extra.lag ? extra.lag() : 0;
        setHud((h) => ({ s, n: h.n + 1, lag }));
      }
      if (s.winner !== null && !endedRef.current) {
        if (!endAt) endAt = t;
        if (t - endAt > 2600) {
          endedRef.current = true;
          const me = s.players[ME];
          onEnd({
            won: s.winner === ME,
            draw: s.winner === "draw",
            seconds: Math.round((s.tick * TICK_MS) / 1000),
            era: me.era,
            enemyEra: s.players[FOE].era,
            trained: me.stats.trained,
            kills: me.stats.kills,
            lost: me.stats.lost,
            damage: me.stats.damage,
            specials: me.stats.specials,
            goldEarned: me.stats.goldEarned,
            doctrines: me.doctrines,
          });
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (bgmEra !== null) eraSuite(bgmEra).setBgmWanted(false);
      scene.dispose();
      sceneRef.current = null;
    };
    // one driver per mount (the parent remounts with a new key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    countRef.current = countdown;
  }, [countdown]);

  // 3-2-1 start
  useEffect(() => {
    if (countdown <= 0) return;
    const id = setTimeout(() => {
      setCountdown((c) => c - 1);
      if (countdown === 1) {
        playCue("start");
        setBanner({ title: "⚔️ 진격!", sub: subtitle, color: "#fde68a" });
      } else playCue("click", 0.8);
    }, 800);
    return () => clearTimeout(id);
  }, [countdown, subtitle]);

  useEffect(() => {
    if (!banner) return;
    const id = setTimeout(() => setBanner(null), 2300);
    return () => clearTimeout(id);
  }, [banner]);

  /* ── actions ──────────────────────────────────────────────────────── */
  const s = hud.s;
  const me = s.players[ME];
  const foe = s.players[FOE];
  const roster = rosterOf(me);
  const n = nextEra(me);
  const evoCost = evolveCost(s, ME);

  const tryEvolve = useCallback(() => {
    const st = stateRef.current;
    const nn = nextEra(st.players[ME]);
    const err = commandError(st, ME, { t: "evolve" });
    if (err || nn === null) {
      playCue("reject");
      toast(err ?? "마지막 시대", "warn");
      return;
    }
    if (ERA_DOCTRINES[nn]) {
      if (!online) pausedRef.current = true;
      setDoctrinePick(nn);
      playCue("click");
    } else send({ t: "evolve" });
  }, [send, toast, ME, online]);

  const pickDoctrine = (d: DoctrineId) => {
    send({ t: "evolve", doctrine: d });
    setDoctrinePick(null);
    pausedRef.current = paused;
  };

  const special = useCallback(() => send({ t: "special" }), [send]);

  const pickAugment = useCallback((pick: number) => {
    send({ t: "augment", pick });
    pausedRef.current = paused;
  }, [send, paused]);
  const rerollAugment = useCallback(() => {
    send({ t: "reroll" });
    // one tick runs to apply it; the reroll event pauses again
    if (!online) pausedRef.current = false;
  }, [send, online]);

  // keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const st = stateRef.current;
      const list = rosterOf(st.players[ME]);
      if (e.key === "Tab") {
        e.preventDefault();
        setBookOpen((v) => !v);
        return;
      }
      if (st.players[ME].offer && doctrinePick === null && !online) {
        if (/^[1-3]$/.test(e.key)) pickAugment(Number(e.key) - 1);
        else if (e.key === "r" || e.key === "R") rerollAugment();
        return;
      }
      if (doctrinePick !== null) {
        const pair = ERA_DOCTRINES[doctrinePick];
        if (pair && (e.key === "1" || e.key === "2")) pickDoctrine(pair[Number(e.key) - 1]);
        if (e.key === "Escape") {
          setDoctrinePick(null);
          pausedRef.current = paused;
        }
        return;
      }
      if (/^[1-6]$/.test(e.key)) {
        const k = list[Number(e.key) - 1];
        if (k) send({ t: "train", kind: k });
      } else if (e.key === "q" || e.key === "Q") setTurretOpen((v) => !v);
      else if (e.key === "e" || e.key === "E") tryEvolve();
      else if (e.key === "r" || e.key === "R") special();
      else if (e.key === " " || e.key === "p" || e.key === "P") {
        e.preventDefault();
        setPause(!pausedRef.current);
      } else if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") sceneRef.current?.pan(120);
      else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") sceneRef.current?.pan(-120);
      else if (e.key === "Escape") setTurretOpen(false);
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctrinePick, paused, send, special, tryEvolve, setPause, pickAugment, rerollAugment]);

  // drag to pan / wheel + pinch to zoom
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef(0);
  const onPointerDown = (e: React.PointerEvent) => {
    unlockAudio();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    if (pointers.current.size === 2) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current) sceneRef.current?.zoomBy(pinch.current / d);
      pinch.current = d;
      return;
    }
    sceneRef.current?.pan(e.clientX - prev.x);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = 0;
  };

  /* ── derived HUD values ───────────────────────────────────────────── */
  const enemyFrontRole = (() => {
    let best: { p: number; role: Role } | null = null;
    for (const u of s.units) if (u.side === FOE) {
      const p = progress(FOE, u.x);
      if (!best || p > best.p) best = { p, role: UNITS[u.kind].role };
    }
    return best?.role ?? null;
  })();
  const recommend = enemyFrontRole ? counterOf(enemyFrontRole) : null;
  const secs = secondsLeft(s);
  const pop = popOf(s, ME);
  const inc = incomeOf(s, ME);
  const front = frontProgress(s, ME);
  const xpFrom = ERAS[me.era].xpNeed;
  const xpTo = n !== null ? ERAS[n].xpNeed : me.xp;
  const xpK = n === null ? 1 : Math.min(1, (me.xp - xpFrom) / Math.max(1, xpTo - xpFrom));
  const canEvolve = n !== null && !commandError(s, ME, { t: "evolve" });
  const spMax = specialCdMax(me);
  const spK = 1 - me.specialCd / spMax;
  const sp = SPECIALS[me.era];

  return (
    <div className="fixed inset-0 z-[60] select-none overflow-hidden bg-[#1b1510] text-white" style={{ touchAction: "none" }}>
      <div ref={hostRef} className="absolute inset-0" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={(e) => sceneRef.current?.zoomBy(e.deltaY > 0 ? 1.08 : 0.93)}>
        <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      </div>

      {/* top: bases + timer + minimap */}
      <div className="pointer-events-none absolute inset-x-0 top-0 p-2 sm:p-3">
        <div className="flex items-start gap-2">
          <BaseCard side={ME} p={me} label={driver.names[ME] || "나"} onAugments={() => setBookOpen(true)} />
          <div className="pointer-events-auto flex shrink-0 flex-col items-center gap-1">
            <div className={`rounded-lg px-2.5 py-1 font-mono text-sm font-bold tabular-nums shadow ${s.suddenDeath ? "animate-pulse bg-red-700" : "bg-black/60"}`}>{s.suddenDeath ? "서든데스" : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`}</div>
            <div className="flex gap-1">
              {online ? (
                <IconBtn label="나가기" onClick={onQuit}>✕</IconBtn>
              ) : (
                <>
                  <IconBtn label={paused ? "계속" : "일시정지"} onClick={() => setPause(!paused)}>{paused ? "▶" : "⏸"}</IconBtn>
                  <IconBtn label="배속" onClick={() => { const v = speed === 1 ? 2 : 1; speedRef.current = v; setSpeed(v); playCue("click"); }}>{speed}×</IconBtn>
                </>
              )}
              <IconBtn label="증강 보기 [Tab]" onClick={() => { setBookOpen((v) => !v); playCue("click"); }}>
                <span className="text-xs">✨{(me.augments ?? []).length}:{(foe.augments ?? []).length}</span>
              </IconBtn>
              <IconBtn label={soundOn ? "소리 끄기" : "소리 켜기"} onClick={() => { unlockAudio(); const st = useAudioSettingsStore.getState(); if (soundOn) st.setMasterMuted(true); else { st.setMasterMuted(false); st.setBgmMuted(false); st.setSfxMuted(false); } }}>{soundOn ? "🔊" : "🔇"}</IconBtn>
            </div>
          </div>
          <BaseCard side={FOE} p={foe} label={driver.names[FOE]} right onAugments={() => setBookOpen(true)} />
        </div>
        <canvas
          ref={miniRef}
          className="pointer-events-auto mt-2 h-5 w-full cursor-pointer rounded-md border border-white/15 bg-black/50"
          onPointerDown={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const k = (e.clientX - r.left) / r.width;
            sceneRef.current?.focusLane((ME === 1 ? 1 - k : k) * LANE);
            playCue("click", 0.5);
          }}
          aria-label="미니맵 — 눌러서 이동"
        />
      </div>

      {/* toasts */}
      <div className="pointer-events-none absolute inset-x-0 top-[96px] flex flex-col items-center gap-1 sm:top-[108px]">
        {toasts.map((t) => (
          <div key={t.id} className={`rounded-full px-3 py-1 text-xs font-bold shadow-lg sm:text-sm ${t.tone === "warn" ? "bg-red-600/90" : t.tone === "good" ? "bg-emerald-600/90" : "bg-black/70"}`}>{t.text}</div>
        ))}
      </div>

      {/* banner */}
      {banner && (
        <div className="pointer-events-none absolute inset-x-0 top-[34%] flex flex-col items-center em-banner">
          <div className="text-3xl font-black tracking-tight drop-shadow-[0_3px_0_rgba(0,0,0,0.6)] sm:text-5xl" style={{ color: banner.color }}>{banner.title}</div>
          {banner.sub && <div className="mt-1 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold sm:text-sm">{banner.sub}</div>}
        </div>
      )}
      {countdown > 0 && (me.plan || foe.plan) && (
        <div className="pointer-events-none absolute inset-x-0 top-[30%] flex items-stretch justify-center gap-2 px-3 sm:gap-4">
          {[ME, FOE].map((side, i) => {
            const pl = s.players[side];
            const plan = pl.plan ? PLANS[pl.plan] : null;
            return (
              <div key={side} className={`em-reveal w-40 rounded-2xl border-2 bg-black/75 p-3 text-center shadow-2xl sm:w-56 ${i === 1 ? "[animation-delay:.35s]" : ""}`} style={{ borderColor: TEAM_HEX[side] }}>
                <div className="truncate text-xs font-bold text-white/70">{driver.names[side]}</div>
                <div className="text-4xl">{plan?.emoji ?? "⚔️"}</div>
                <div className="font-black" style={{ color: plan?.color ? "#fde68a" : undefined }}>{plan?.name ?? "기본 전략"}</div>
                <div className="mt-1 flex flex-wrap justify-center gap-1 text-lg">{pl.items.map((it) => <span key={it} title={ITEMS[it].name}>{ITEMS[it].emoji}</span>)}</div>
              </div>
            );
          })}
        </div>
      )}
      {countdown > 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-[50%] flex items-center justify-center">
          <div key={countdown} className="em-count text-7xl font-black text-amber-200 drop-shadow-[0_4px_0_rgba(0,0,0,0.6)]">{countdown}</div>
        </div>
      )}
      {paused && doctrinePick === null && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-stone-900/95 p-6 shadow-2xl">
            <div className="text-2xl font-black">⏸ 일시정지</div>
            <button className="w-48 rounded-xl bg-amber-500 py-2 font-bold text-black" onClick={() => setPause(false)}>계속하기</button>
            <button className="w-48 rounded-xl bg-white/10 py-2 font-bold" onClick={onRules}>📖 룰북</button>
            <button className="w-48 rounded-xl bg-white/10 py-2 font-bold" onClick={onQuit}>나가기</button>
          </div>
        </div>
      )}

      {/* bottom HUD */}
      <div className="absolute inset-x-0 bottom-0 p-2 sm:p-3">
        <div className="mx-auto max-w-4xl rounded-2xl border border-white/10 bg-gradient-to-b from-stone-900/85 to-black/90 p-2 shadow-2xl backdrop-blur-sm sm:p-3">
          {/* economy row */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
            <div className="flex items-baseline gap-1 font-black text-amber-300">
              <span className="text-lg sm:text-xl">💰 {Math.floor(me.gold)}</span>
              <span className="text-[11px] font-semibold text-amber-200/70">+{inc}/s{front > LANE / 2 + 99 ? " 🚩" : ""}</span>
            </div>
            <div className="text-xs text-white/70">👥 {pop}/{popCapOf(me)}</div>
            <div className="order-last flex w-full items-center gap-2 sm:order-none sm:w-auto sm:min-w-[150px] sm:flex-1">
              <div className="relative h-4 flex-1 overflow-hidden rounded-full bg-white/10">
                <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-sky-500 to-violet-400 transition-[width]" style={{ width: `${xpK * 100}%` }} />
                <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold tabular-nums">{n === null ? "최종 시대" : `XP ${Math.floor(me.xp)} / ${xpTo}`}</div>
              </div>
              <button
                onClick={tryEvolve}
                disabled={n === null}
                className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-black transition ${canEvolve ? "em-ready bg-gradient-to-b from-amber-300 to-amber-500 text-black" : "bg-white/10 text-white/50"}`}
                title="진화 [E]"
              >
                {n === null ? "MAX" : `⏫ ${ERAS[n].emoji} ${evoCost}G`}
              </button>
            </div>
            <button
              onClick={special}
              className={`relative ml-auto flex sm:ml-0 h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl ${me.specialCd === 0 ? "em-ready bg-gradient-to-b from-fuchsia-400 to-violet-600" : "bg-white/10"}`}
              title={`${sp.name} [R] — ${sp.desc}`}
              aria-label={`필살기 ${sp.name}`}
            >
              <svg className="absolute inset-0 -rotate-90" viewBox="0 0 40 40">
                <circle cx="20" cy="20" r="18" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="3" />
                <circle cx="20" cy="20" r="18" fill="none" stroke="#f0abfc" strokeWidth="3" strokeDasharray={`${spK * 113} 113`} />
              </svg>
              <span className={me.specialCd === 0 ? "" : "opacity-50 grayscale"}>{sp.emoji}</span>
            </button>
          </div>

          {/* queue */}
          <div className="mt-1.5 flex items-center gap-1">
            <span className="mr-1 text-[10px] text-white/50">생산</span>
            {Array.from({ length: QUEUE_CAP }, (_, i) => {
              const q = me.queue[i];
              const k = q && i === 0 ? 1 - q.left / q.total : 0;
              return (
                <button key={i} onClick={() => q && send({ t: "cancel", index: i })} disabled={!q} className="relative h-7 w-7 overflow-hidden rounded-md border border-white/15 bg-white/5 text-sm" title={q ? `${UNITS[q.kind].name} (눌러서 취소)` : "빈 칸"}>
                  {q && <div className="absolute inset-x-0 bottom-0 bg-emerald-500/60" style={{ height: `${k * 100}%` }} />}
                  <span className="relative">{q ? UNITS[q.kind].emoji : ""}</span>
                </button>
              );
            })}
            <span className="ml-auto hidden text-[10px] text-white/45 sm:inline">상성 ⚔근접 ▶ 🐎돌격 ▶ 🏹원거리 ▶ ⚔근접 (×1.5)</span>
          </div>

          {/* unit + turret buttons */}
          <div className="mt-1.5 grid grid-cols-4 gap-1.5 sm:grid-cols-7">
            {roster.map((k, i) => {
              const d = UNITS[k];
              const price = unitCost(me, k);
              const afford = me.gold >= price;
              const err = commandError(s, ME, { t: "train", kind: k });
              const rec = recommend === d.role;
              return (
                <button
                  key={k}
                  onClick={() => send({ t: "train", kind: k })}
                  className={`relative flex flex-col items-center rounded-xl border px-1 py-1.5 transition active:scale-95 ${err ? "border-white/10 bg-white/5 opacity-60" : "border-white/20 bg-gradient-to-b from-white/15 to-white/5 hover:from-white/25"} ${rec && !err ? "ring-2 ring-amber-300" : ""}`}
                  title={`${d.name} — ${d.desc} [${i + 1}]`}
                >
                  {rec && <span className="absolute -top-2 rounded-full bg-amber-400 px-1.5 text-[9px] font-black text-black">상성 추천</span>}
                  <span className="text-xl leading-none sm:text-2xl">{d.emoji}</span>
                  <span className="mt-0.5 w-full truncate text-center text-[10px] font-bold sm:text-xs">{d.name}</span>
                  <span className="flex items-center gap-1 text-[10px]">
                    <span className="rounded bg-black/40 px-1" title={ROLE_NAME[d.role]}>{ROLE_ICON[d.role]}</span>
                    <span className={`font-black ${afford ? "text-amber-300" : "text-red-400"}`}>{price}</span>
                  </span>
                  <span className="absolute left-1 top-0.5 hidden text-[9px] text-white/40 sm:block">{i + 1}</span>
                </button>
              );
            })}
            {Array.from({ length: Math.max(0, 6 - roster.length) }, (_, i) => (
              <div key={`e${i}`} className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 text-[9px] text-white/30">교리 유닛</div>
            ))}
            <button onClick={() => { setTurretOpen((v) => !v); playCue("click"); }} className={`flex flex-col items-center justify-center rounded-xl border px-1 py-1.5 ${turretOpen ? "border-amber-300 bg-amber-500/20" : "border-white/20 bg-white/10"}`} title="포탑 [Q]">
              <span className="text-xl sm:text-2xl">🏰</span>
              <span className="text-[10px] font-bold sm:text-xs">포탑 {me.turrets.filter(Boolean).length}/{me.slots}</span>
            </button>
          </div>

          {turretOpen && <TurretPanel s={s} side={ME} onSend={send} />}
        </div>
      </div>

      {online && hud.lag > 20 && (
        <div className="pointer-events-none absolute left-1/2 top-[132px] -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs font-bold text-amber-200">📶 연결 지연 — 따라잡는 중…</div>
      )}
      {children}

      {me.offer && doctrinePick === null && (
        <AugmentPanel s={s} side={ME} online={online} onPick={pickAugment} onReroll={rerollAugment} onBook={() => setBookOpen(true)} />
      )}

      {bookOpen && <AugmentBook s={s} me={ME} names={driver.names} onClose={() => setBookOpen(false)} />}

      {doctrinePick !== null && (
        <DoctrineModal era={doctrinePick} cost={evoCost} online={online} onPick={pickDoctrine} onCancel={() => { setDoctrinePick(null); pausedRef.current = paused; }} />
      )}

      <style>{`
        .em-card{animation:emCard .45s cubic-bezier(.2,1.4,.4,1) both}
        @keyframes emCard{0%{opacity:0;transform:translateY(30px) rotateY(70deg)}100%{opacity:1;transform:none}}
        .em-ready{animation:emPulse 1.1s ease-in-out infinite}
        @keyframes emPulse{0%,100%{box-shadow:0 0 0 0 rgba(253,224,71,.65)}50%{box-shadow:0 0 0 6px rgba(253,224,71,0)}}
        .em-banner{animation:emBanner 2.3s ease-out both}
        @keyframes emBanner{0%{opacity:0;transform:scale(1.6)}12%{opacity:1;transform:scale(1)}80%{opacity:1}100%{opacity:0;transform:translateY(-16px)}}
        .em-count{animation:emCount .8s ease-out both}
        .em-reveal{animation:emReveal .5s cubic-bezier(.2,1.4,.4,1) both}
        @keyframes emReveal{0%{opacity:0;transform:translateY(24px) scale(.8) rotateY(80deg)}100%{opacity:1;transform:none}}
        @keyframes emCount{0%{opacity:0;transform:scale(2.2)}30%{opacity:1;transform:scale(1)}100%{opacity:.2;transform:scale(.8)}}
      `}</style>
    </div>
  );
}

function IconBtn({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="flex h-8 min-w-8 items-center justify-center rounded-lg bg-black/60 px-1.5 text-sm font-bold shadow hover:bg-black/80">
      {children}
    </button>
  );
}

function BaseCard({ side, p, label, right, onAugments }: { side: Side; p: EraMarchState["players"][0]; label: string; right?: boolean; onAugments?: () => void }) {
  const k = p.baseHp / p.baseMax;
  const era = ERAS[p.era];
  return (
    <div className={`min-w-0 flex-1 rounded-xl bg-black/55 px-2 py-1.5 shadow-lg backdrop-blur-sm ${right ? "text-right" : ""}`}>
      <div className={`flex items-center gap-1.5 text-xs font-bold sm:text-sm ${right ? "flex-row-reverse" : ""}`}>
        <span className="inline-block h-2.5 w-2.5 shrink-0" style={{ background: TEAM_HEX[side], clipPath: side === 0 ? "polygon(50% 0,100% 100%,0 100%)" : undefined }} />
        <span className="truncate">{label}</span>
        <span className="shrink-0 text-white/70">{era.emoji} <span className="hidden sm:inline">{era.name}</span></span>
        <span className="shrink-0" title={p.plan ? PLANS[p.plan].name : undefined}>{p.plan ? PLANS[p.plan].emoji : ""}{p.doctrines.map((d) => DOCTRINES[d].emoji).join("")}</span>
      </div>
      {(p.augments ?? []).length > 0 && (
        <button type="button" onClick={onAugments} aria-label="증강 자세히 보기" className={`pointer-events-auto mt-0.5 flex flex-wrap gap-0.5 ${right ? "flex-row-reverse" : ""}`}>
          {p.augments.map((id) => {
            const a = AUGMENTS[id];
            if (!a) return null;
            return (
              <span key={id} title={`${AUG_TIER_NAME[a.tier]} · ${a.name} — ${a.desc}`} className="flex h-5 w-5 items-center justify-center rounded-md bg-black/50 text-[11px] sm:h-6 sm:w-6 sm:text-sm" style={{ boxShadow: `inset 0 0 0 1.5px ${AUG_TIER_COLOR[a.tier]}` }}>
                {a.emoji}
              </span>
            );
          })}
        </button>
      )}
      <div className="relative mt-1 h-3 overflow-hidden rounded-full bg-white/10">
        <div className={`absolute inset-y-0 rounded-full transition-[width] duration-200 ${right ? "right-0" : "left-0"}`} style={{ width: `${k * 100}%`, background: k > 0.5 ? TEAM_HEX[side] : k > 0.25 ? "#f59e0b" : "#dc2626" }} />
        <div className="absolute inset-0 flex items-center justify-center text-[9px] font-black tabular-nums">{Math.ceil(p.baseHp)} / {p.baseMax}</div>
      </div>
    </div>
  );
}

function TurretPanel({ s, side, onSend }: { s: EraMarchState; side: Side; onSend: (c: Command) => void }) {
  const ME = side;
  const me = s.players[ME];
  const kinds: TurretKind[] = [];
  for (let e = 0; e <= me.era; e++) kinds.push(...ERA_TURRETS[e]);
  const best = kinds.slice(-2);
  return (
    <div className="mt-2 grid grid-cols-3 gap-1.5 border-t border-white/10 pt-2">
      {[0, 1, 2].map((slot) => {
        const t = me.turrets[slot];
        if (slot >= me.slots) {
          const can = slot === me.slots;
          return (
            <button key={slot} disabled={!can} onClick={() => onSend({ t: "slot" })} className="rounded-xl border border-dashed border-white/20 p-2 text-xs disabled:opacity-40">
              🔒 슬롯 {slot + 1}<br />
              <span className="font-black text-amber-300">{SLOT_COST[slot]}G 개방</span>
            </button>
          );
        }
        return (
          <div key={slot} className="rounded-xl border border-white/15 bg-white/5 p-1.5 text-xs">
            <div className="mb-1 flex items-center justify-between font-bold">
              <span>{t ? `${TURRETS[t.kind].emoji} ${TURRETS[t.kind].name}` : `슬롯 ${slot + 1} (비어 있음)`}</span>
              {t && (
                <button onClick={() => onSend({ t: "sell", slot })} className="rounded bg-red-500/30 px-1 text-[10px]" title="판매">
                  +{Math.floor(TURRETS[t.kind].cost * SELL_REFUND)}
                </button>
              )}
            </div>
            <div className="flex flex-col gap-1">
              {best.filter((k) => k !== t?.kind).map((k) => {
                const d = TURRETS[k];
                const err = commandError(s, ME, { t: "turret", slot, kind: k });
                return (
                  <button key={k} onClick={() => onSend({ t: "turret", slot, kind: k })} className={`flex items-center justify-between rounded-lg px-1.5 py-1 text-left ${err ? "bg-white/5 opacity-50" : "bg-white/15 hover:bg-white/25"}`} title={`피해 ${d.dmg} · 사거리 ${d.range}${d.splash ? " · 범위" : ""}`}>
                    <span>{d.emoji} {d.name}{d.splash ? " 💥" : ""}</span>
                    <span className="font-black text-amber-300">{d.cost}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const TIER_BG: Record<string, string> = {
  silver: "linear-gradient(180deg,rgba(203,213,225,.22),rgba(30,41,59,.9))",
  gold: "linear-gradient(180deg,rgba(251,191,36,.28),rgba(41,30,10,.92))",
  prism: "linear-gradient(160deg,rgba(244,114,182,.3),rgba(129,140,248,.3) 45%,rgba(52,211,153,.25)),rgba(20,16,40,.92)",
};

/** Tier is also spelled out on every card, so colour is never the only cue. */
function AugmentPanel({ s, side, online, onPick, onReroll, onBook }: { s: EraMarchState; side: Side; online: boolean; onPick: (i: number) => void; onReroll: () => void; onBook: () => void }) {
  const p = s.players[side];
  const foeAugs = s.players[side === 0 ? 1 : 0].augments ?? [];
  const o = p.offer!;
  const left = Math.max(0, Math.ceil((o.deadline - s.tick) / 20));
  const color = AUG_TIER_COLOR[o.tier];
  return (
    <div className={`absolute inset-x-0 z-10 flex justify-center px-2 ${online ? "top-[124px] sm:top-[136px]" : "inset-y-0 items-center bg-black/55"}`}>
      <div className="w-full max-w-2xl rounded-2xl border-2 bg-stone-950/90 p-2.5 shadow-2xl backdrop-blur-sm sm:p-4" style={{ borderColor: color }}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-white/60">증강 {o.round + 1} / {AUG_ROUNDS.length}{online ? " · 전투는 계속됩니다" : " · 일시정지"}</div>
            <div className="text-lg font-black sm:text-2xl" style={{ color }}>✨ {AUG_TIER_NAME[o.tier]} 증강 — 하나를 고르세요</div>
          </div>
          {online && <div className={`shrink-0 rounded-lg px-2 py-1 font-mono text-lg font-black tabular-nums ${left <= 5 ? "animate-pulse bg-red-600" : "bg-white/10"}`}>⏱ {left}</div>}
        </div>
        <div className="grid grid-cols-3 gap-1.5 sm:gap-2.5">
          {o.cards.map((id, i) => {
            const a = AUGMENTS[id];
            if (!a) return null;
            const c = AUG_TIER_COLOR[a.tier];
            return (
              <button key={`${o.round}-${id}`} onClick={() => onPick(i)} className="em-card flex min-h-[150px] flex-col items-center gap-1 rounded-xl border-2 p-2 text-center transition hover:-translate-y-1 active:scale-95 sm:min-h-[190px] sm:p-3" style={{ borderColor: c, background: TIER_BG[a.tier], animationDelay: `${i * 0.08}s` }}>
                <span className="flex items-center gap-1 text-[10px] font-black tracking-widest">
                  <span style={{ color: c }}>{AUG_TIER_NAME[a.tier]}</span>
                  <span className="rounded bg-black/40 px-1 font-bold tracking-normal text-white/75">{AUG_TAG_ICON[a.tag]} {AUG_TAG_NAME[a.tag]}</span>
                </span>
                <span className="text-3xl sm:text-5xl">{a.emoji}</span>
                <span className="text-sm font-black leading-tight sm:text-base">{a.name}</span>
                <span className="text-[11px] leading-snug text-white/80 sm:text-xs">{a.desc}</span>
                {answersOf(a, foeAugs).map((t) => (
                  <span key={t.id} className="rounded-full bg-rose-500/25 px-1.5 py-0.5 text-[10px] font-black text-rose-100 ring-1 ring-rose-300/60">🎯 상대 {t.emoji} {t.name} 견제</span>
                ))}
                {!online && <span className="mt-auto text-[10px] text-white/40">[{i + 1}]</span>}
              </button>
            );
          })}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
          {([["내 증강", p.augments ?? []], ["상대 증강", foeAugs]] as const).map(([label, list], i) => (
            <button key={label} type="button" onClick={onBook} className={`flex min-w-0 items-center gap-1 rounded-lg px-2 py-1 text-left ${i ? "bg-rose-500/10" : "bg-sky-500/10"}`}>
              <span className="shrink-0 font-bold text-white/60">{label}</span>
              <span className="min-w-0 truncate">{list.length ? list.map((id) => AUGMENTS[id]?.emoji).join(" ") : "없음"}</span>
              <span className="ml-auto shrink-0 text-white/40">자세히</span>
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-xs">
          <span className="min-w-0 truncate text-white/50">{online ? `${left}초 안에 안 고르면 첫 번째 카드가 자동 선택돼요` : "고를 때까지 전투가 멈춰 있어요"}</span>
          <button onClick={onReroll} disabled={p.rerolls <= 0} className="shrink-0 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 font-bold disabled:opacity-35">🎲 다시 뽑기 ({p.rerolls}){online ? "" : " [R]"}</button>
        </div>
      </div>
    </div>
  );
}

/** Enemy augments this card answers. */
function answersOf(a: AugmentDef, foe: readonly string[]): AugmentDef[] {
  return (a.counters ?? []).filter((c) => foe.includes(c)).map((c) => AUGMENTS[c]).filter((x): x is AugmentDef => !!x);
}

type SumKey = Exclude<keyof AugFx, "roles" | "specialNow" | "goldNow">;
/** How each knob reads in the totals: label, unit and whether a bigger number is a cut. */
const SUM_LABEL: [SumKey, string, "pct" | "cut" | "num" | "sec" | "mul" | "pps"][] = [
  ["atk", "공격력", "pct"], ["hp", "HP", "pct"], ["speed", "이동속도", "pct"], ["train", "생산 시간", "cut"], ["costCut", "유닛 가격", "cut"],
  ["income", "골드 수입", "pct"], ["killGold", "처치 골드", "pct"], ["xp", "XP", "pct"], ["killXp", "처치 XP", "pct"], ["evolve", "진화 골드", "cut"],
  ["interest", "골드 이자/초", "pct"], ["range", "사거리", "pct"], ["turret", "포탑 피해", "pct"], ["turretRange", "포탑 사거리", "pct"],
  ["baseHp", "기지 HP", "pct"], ["regen", "기지 수리/초", "pct"], ["baseGuard", "기지 받는 피해", "cut"], ["siegeDmg", "기지 공격", "pct"],
  ["specialCd", "필살기 쿨", "cut"], ["specialDmg", "필살기 피해", "pct"], ["lifesteal", "흡혈", "pct"], ["heal", "치유량", "pct"],
  ["thorns", "가시 반사", "pct"], ["execute", "처형 피해", "pct"], ["berserk", "광전사", "pct"], ["frontGuard", "선봉 받는 피해", "cut"],
  ["deathBlast", "사망 폭발", "pct"], ["twin", "쌍둥이 확률", "pct"], ["revive", "부활 확률", "pct"], ["chain", "튕김", "num"],
  ["counter", "상성 배율", "mul"], ["counterResist", "상성 피해 무시", "pct"], ["pop", "인구", "num"], ["healCut", "상대 회복 차단", "pct"],
  ["incomeCut", "상대 수입", "cut"], ["shock", "기절", "sec"], ["shove", "밀치기", "num"], ["ambush", "첫 공격", "pct"], ["merc", "용병", "num"],
  ["underdog", "역전 시 능력치", "pct"], ["lastStand", "최후 포탑 배율", "num"], ["desperate", "위기 시 공격력", "pct"],
];
const ROLE_LABEL: Record<Role, string> = { melee: "근접", ranged: "원거리", charge: "돌격", support: "지원" };

/** The side's augment effects added up, as short chips ("공격력 +23%", "인구 +6"). */
function augTotals(p: EraMarchState["players"][0]): string[] {
  const out: string[] = [];
  for (const [k, label, kind] of SUM_LABEL) {
    const v = aug(p, k);
    if (!v) continue;
    const pct = Math.round(v * 1000) / 10;
    if (kind === "pct") out.push(`${label} ${v > 0 ? "+" : ""}${pct}%`);
    else if (kind === "cut") out.push(`${label} ${v > 0 ? "−" : "+"}${Math.abs(pct)}%`);
    else if (kind === "sec") out.push(`${label} ${v / TICKS_PER_SEC}초`);
    else if (kind === "mul") out.push(`${label} ×${v}`);
    else out.push(`${label} ${v > 0 ? "+" : ""}${Math.round(v * 10) / 10}`);
  }
  for (const r of ["melee", "ranged", "charge", "support"] as Role[]) {
    for (const [k, label] of [["atk", "공격력"], ["hp", "HP"], ["speed", "속도"]] as const) {
      const v = roleAug(p, r, k);
      if (v) out.push(`${ROLE_LABEL[r]} ${label} +${Math.round(v * 100)}%`);
    }
  }
  return out;
}

/** Both sides' picks side by side, with totals and what is coming next — readable mid-battle (it never pauses the match). */
function AugmentBook({ s, me, names, onClose }: { s: EraMarchState; me: Side; names: [string, string]; onClose: () => void }) {
  const foe: Side = me === 0 ? 1 : 0;
  const round = s.augRound ?? 0;
  const next = AUG_ROUNDS[round];
  const nextIn = next ? Math.max(0, next.sec - Math.floor(s.tick / TICKS_PER_SEC)) : 0;
  const foeAugs = s.players[foe].augments ?? [];
  const myAugs = s.players[me].augments ?? [];
  const col = (side: Side, title: string, tone: string, other: readonly string[]) => {
    const p = s.players[side];
    const list = p.augments ?? [];
    const totals = augTotals(p);
    return (
      <div className="min-w-0 rounded-xl border border-white/10 bg-white/[0.04] p-2.5">
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: TEAM_HEX[side] }} />
          <span className="truncate text-sm font-black">{title}</span>
          <span className={`ml-auto shrink-0 rounded-full px-2 text-[11px] font-bold ${tone}`}>{list.length} / {AUG_ROUNDS.length}</span>
        </div>
        {list.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/15 p-3 text-center text-xs text-white/45">아직 고른 증강이 없어요</div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {list.map((id, i) => {
              const a = AUGMENTS[id];
              if (!a) return null;
              const hits = answersOf(a, other);
              return (
                <li key={id} className="flex gap-2 rounded-lg bg-black/35 p-1.5" style={{ boxShadow: `inset 3px 0 0 ${AUG_TIER_COLOR[a.tier]}` }}>
                  <span className="text-2xl leading-none">{a.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-1.5 text-xs">
                      <b className="text-sm">{a.name}</b>
                      <span className="font-bold" style={{ color: AUG_TIER_COLOR[a.tier] }}>{AUG_TIER_NAME[a.tier]}</span>
                      <span className="text-white/55">{AUG_TAG_ICON[a.tag]} {AUG_TAG_NAME[a.tag]}</span>
                      <span className="ml-auto text-[10px] text-white/35">{i + 1}번째</span>
                    </div>
                    <div className="text-[11px] leading-snug text-white/75">{a.desc}</div>
                    {hits.length > 0 && <div className="mt-0.5 text-[10px] font-bold text-rose-200">🎯 {hits.map((h) => `${h.emoji} ${h.name}`).join(", ")} 견제 중</div>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {totals.length > 0 && (
          <div className="mt-2">
            <div className="mb-1 text-[10px] font-bold text-white/45">합계 효과</div>
            <div className="flex flex-wrap gap-1">
              {totals.map((t) => <span key={t} className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-bold">{t}</span>)}
            </div>
          </div>
        )}
      </div>
    );
  };
  return (
    <div className="absolute inset-0 z-20 flex items-end justify-center bg-black/55 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-label="증강 비교" className="flex max-h-[82vh] w-full max-w-3xl flex-col rounded-t-2xl border border-white/15 bg-stone-950/95 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
          <div className="min-w-0">
            <div className="text-base font-black">✨ 증강 비교</div>
            <div className="truncate text-[11px] text-white/55">
              {next ? `다음 증강 ${Math.floor(nextIn / 60)}:${String(nextIn % 60).padStart(2, "0")} 뒤 · 실버 ${next.odds[0]}% · 골드 ${next.odds[1]}% · 프리즘 ${next.odds[2]}%` : "이번 판 증강은 모두 나왔어요"} · 전투는 계속돼요
            </div>
          </div>
          <button onClick={onClose} className="ml-auto shrink-0 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-bold" aria-label="닫기">닫기 [Tab]</button>
        </div>
        <div className="grid min-h-0 grid-cols-1 gap-2 overflow-y-auto p-2.5 sm:grid-cols-2">
          {col(me, `나 · ${names[me] || "나"}`, "bg-sky-500/20 text-sky-100", foeAugs)}
          {col(foe, `상대 · ${names[foe]}`, "bg-rose-500/20 text-rose-100", myAugs)}
        </div>
        <div className="border-t border-white/10 px-3 py-1.5 text-[10px] text-white/45">🎯 견제 = 상대가 가진 증강을 약하게 만드는 카드예요. 증강을 고를 때 카드에도 같은 표시가 떠요.</div>
      </div>
    </div>
  );
}

function DoctrineModal({ era, cost, online, onPick, onCancel }: { era: Era; cost: number; online: boolean; onPick: (d: DoctrineId) => void; onCancel: () => void }) {
  const pair = ERA_DOCTRINES[era]!;
  const e = ERAS[era];
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/65 p-3">
      <div className="w-full max-w-xl rounded-2xl border border-amber-300/30 bg-stone-900/95 p-4 shadow-2xl">
        <div className={`text-center text-xs font-bold ${online ? "text-red-300" : "text-amber-200/80"}`}>{online ? "⚠ 온라인 대전 중 — 전투는 계속됩니다" : "게임 일시정지"} · 진화 비용 {cost}G</div>
        <div className="text-center text-2xl font-black" style={{ color: e.accent }}>{e.emoji} {e.name}로 진화</div>
        <div className="mb-3 text-center text-sm text-white/70">교리를 하나 고르세요 — 전용 유닛과 패시브가 생깁니다</div>
        <div className="grid grid-cols-2 gap-2">
          {pair.map((d, i) => {
            const doc = DOCTRINES[d];
            const u = UNITS[doc.unit];
            return (
              <button key={d} onClick={() => onPick(d)} className="flex flex-col items-center gap-1 rounded-xl border border-white/15 bg-gradient-to-b from-white/15 to-white/5 p-3 text-center transition hover:border-amber-300 hover:from-amber-400/25 active:scale-95">
                <span className="text-4xl">{doc.emoji}</span>
                <span className="text-lg font-black">{doc.name}</span>
                <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-xs font-bold text-emerald-200">{doc.passive}</span>
                <span className="mt-1 text-xs text-white/80">+ {u.emoji} <b>{u.name}</b> ({ROLE_ICON[u.role]} {u.cost}G)</span>
                <span className="text-[11px] text-white/55">{u.desc}</span>
                <span className="mt-1 text-[10px] text-white/40">[{i + 1}]</span>
              </button>
            );
          })}
        </div>
        <button onClick={onCancel} className="mt-3 w-full rounded-lg bg-white/10 py-1.5 text-sm">나중에 (Esc)</button>
      </div>
    </div>
  );
}

/** Lane strip; mirrored for side 1 so your own base is always on the left. */
function drawMinimap(cv: HTMLCanvasElement | null, s: EraMarchState, view: { center: number; half: number }, me: Side) {
  if (!cv) return;
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(w * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const ctx = cv.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const flip = me === 1;
  const X = (x: number) => ((flip ? LANE - x : x) / LANE) * w;
  // territory
  const f0 = frontProgress(s, 0);
  const f1 = frontProgress(s, 1);
  const span = (a: number, b: number) => {
    const x0 = X(a);
    const x1 = X(b);
    ctx.fillRect(Math.min(x0, x1), 0, Math.abs(x1 - x0), h);
  };
  ctx.fillStyle = "rgba(59,130,246,0.25)";
  span(0, Math.max(40, f0));
  ctx.fillStyle = "rgba(239,68,68,0.25)";
  span(LANE - Math.max(40, f1), LANE);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(X(LANE / 2) - 0.5, 0, 1, h);
  // view box
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 1;
  const v0 = Math.min(X(view.center - view.half), X(view.center + view.half));
  ctx.strokeRect(v0 + 0.5, 0.5, (view.half * 2 * w) / LANE - 1, h - 1);
  // units
  for (const u of s.units) {
    ctx.fillStyle = TEAM_HEX[u.side];
    const big = UNITS[u.kind].size > 1.3;
    const r = big ? 3.2 : 2.2;
    ctx.beginPath();
    ctx.arc(X(u.x), h / 2 + (u.side === 0 ? -2 : 2), r, 0, Math.PI * 2);
    ctx.fill();
  }
  // bases
  ctx.font = "11px system-ui";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(ERAS[s.players[me].era].emoji, 2, h / 2);
  ctx.textAlign = "right";
  ctx.fillText(ERAS[s.players[me === 0 ? 1 : 0].era].emoji, w - 2, h / 2);
}
