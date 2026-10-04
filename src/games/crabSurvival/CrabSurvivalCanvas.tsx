"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { epicBounty, EPIC_SURVIVE_EVERY, USURP_FX, GEAR_RARITY, GEARS, MUTATIONS, roadmap, SHIELDS, SPECIES, STAMINA_MAX, TIERS, tierForLevel, WEAPONS, comboMultiplier, type CrabTier, type MutationKind, type SpeciesId } from "./data";
import {
  attackReach,
  createWorld,
  crabRadius,
  endMatch,
  holdsEpic,
  penaltyLeft,
  player,
  rankOf,
  revivePlayer,
  step,
  summarize,
  type CrabInput,
  type MatchSummary,
  type World,
} from "./engine";
import { drawMinimap, drawWorld, screenToWorld, targetZoom, TILT, updateCamera, type Camera } from "./render";
import { CrabAudio } from "./audio";

/**
 * requestAnimationFrame host for one match: owns the mutable `World`, turns
 * keyboard/mouse/touch into a `CrabInput`, drains `world.events` into SFX +
 * broadcasts, and mirrors a HUD snapshot into React state at ~10 Hz (the
 * canvas itself never goes through React).
 */

interface LbRow {
  id: number;
  name: string;
  score: number;
  level: number;
  me: boolean;
  king: boolean;
}

interface Hud {
  hp: number;
  maxHp: number;
  stamina: number;
  score: number;
  level: number;
  alive: boolean;
  weapon: { emoji: string; name: string; dur: number; max: number } | null;
  shield: { emoji: string; name: string; dur: number; max: number } | null;
  key: boolean;
  combo: number;
  remaining: number;
  rank: number;
  total: number;
  lb: LbRow[];
  kingName: string | null;
  inPool: boolean;
  kills: number;
  tier: CrabTier;
  skillCd: number;
  burrow: boolean;
  gear: { emoji: string; name: string; t: number; max: number; color: string; label: string; lv: number }[];
  muts: { kind: MutationKind; t: number; pen: number }[];
  pearl: number;
  /** Bounty on my own shell while I carry a legendary (0 = none) + seconds to the next 생존 보상. */
  myBounty: number;
  nextSurvive: number;
}

interface Banner {
  id: number;
  text: string;
  sub?: string;
  tone: "king" | "down" | "level" | "kill" | "info";
}

interface Feed {
  id: number;
  text: string;
  mine: boolean;
}

const JOY_R = 54;
/** Bot evolutions within this many world units are heard (quietly, fading with distance). */
const NEAR_EVO = 650;

export default function CrabSurvivalCanvas({
  playerName,
  colorId,
  species,
  duration,
  muted,
  onToggleMute,
  noShake,
  onToggleShake,
  reduceFlash,
  onToggleFlash,
  followMouse,
  onToggleFollow,
  onEnd,
}: {
  playerName: string;
  colorId: string;
  species: SpeciesId;
  duration: number;
  muted: boolean;
  onToggleMute: () => void;
  noShake: boolean;
  onToggleShake: () => void;
  reduceFlash: boolean;
  onToggleFlash: () => void;
  followMouse: boolean;
  onToggleFollow: () => void;
  onEnd: (s: MatchSummary) => void;
}) {
  const road = roadmap(species);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<World | null>(null);
  const camRef = useRef<Camera>({ x: 0, y: 0, zoom: 1 });
  const audioRef = useRef<CrabAudio | null>(null);
  const sizeRef = useRef({ w: 800, h: 500, dpr: 1 });
  const pausedRef = useRef(false);
  const noShakeRef = useRef(noShake);
  const reduceFlashRef = useRef(reduceFlash);
  useEffect(() => {
    noShakeRef.current = noShake;
    reduceFlashRef.current = reduceFlash;
  }, [noShake, reduceFlash]);
  const followRef = useRef(followMouse);
  useEffect(() => {
    followRef.current = followMouse;
  }, [followMouse]);
  const input = useRef({
    keys: new Set<string>(),
    mouse: null as { x: number; y: number } | null,
    mouseAttack: false,
    mouseBoost: false,
    joy: null as { id: number; ox: number; oy: number; x: number; y: number } | null,
    touchAttack: false,
    touchBoost: false,
    touchSkill: false,
  });
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);

  const [hud, setHud] = useState<Hud | null>(null);
  const [paused, setPaused] = useState(false);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [feed, setFeed] = useState<Feed[]>([]);
  const [isTouch] = useState(() => typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0));
  const [joyView, setJoyView] = useState<{ ox: number; oy: number; x: number; y: number } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [down, setDown] = useState<{ by: string; score: number; revives: number } | null>(null);
  const [ended, setEnded] = useState(false);
  const [miniSize, setMiniSize] = useState(132);

  const pushBanner = useCallback((b: Omit<Banner, "id">) => {
    const id = Date.now() + Math.random();
    setBanners((prev) => [...prev.slice(-1), { ...b, id }]);
    setTimeout(() => setBanners((prev) => prev.filter((x) => x.id !== id)), 2600);
  }, []);
  const pushFeed = useCallback((text: string, mine: boolean) => {
    const id = Date.now() + Math.random();
    setFeed((prev) => [...prev.slice(-3), { id, text, mine }]);
    setTimeout(() => setFeed((prev) => prev.filter((x) => x.id !== id)), 5000);
  }, []);

  const setPause = useCallback((p: boolean) => {
    if (worldRef.current?.over) return;
    pausedRef.current = p;
    setPaused(p);
  }, []);

  // Audio lifecycle + mute sync.
  useEffect(() => {
    const a = new CrabAudio();
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
      // Portrait phones get a tall arena; desktop keeps the whole canvas (and its HUD) above the fold.
      const narrow = window.innerWidth < 640;
      const h = fs ? vh : Math.round(Math.max(380, Math.min(w * (narrow ? 1.45 : 0.9), vh - 130)));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.height = `${h}px`;
      sizeRef.current = { w, h, dpr };
      setMiniSize(narrow ? 96 : 132);
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
      if (k === "escape" || k === "p") {
        setPause(!pausedRef.current);
        return;
      }
      if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d", "shift", "j", "k", "e", "l", "q"].includes(k)) {
        e.preventDefault();
        input.current.keys.add(k);
        audioRef.current?.unlock();
      }
    };
    const up = (e: KeyboardEvent) => input.current.keys.delete(e.key.toLowerCase());
    const blur = () => {
      input.current.keys.clear();
      input.current.mouseAttack = false;
      input.current.mouseBoost = false;
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
  }, [setPause]);

  // Main loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const world = createWorld({ playerName, colorId, species, duration });
    worldRef.current = world;
    const me0 = player(world);
    const { w: W0, h: H0 } = sizeRef.current;
    camRef.current = { x: me0.x, y: me0.y, zoom: targetZoom(1, W0, H0) };

    let raf = 0;
    let last = performance.now();
    let hudAcc = 0;
    let endTimer: number | null = null;
    // Legendary pickups happen every ~20s across the island — only one big banner per 30s, the rest go to the feed.
    let lastEpicBanner = -Infinity;
    let lastBotEvo = -Infinity;

    const readInput = (): CrabInput => {
      const inp = input.current;
      const k = inp.keys;
      const me = player(world);
      let dx = 0, dy = 0;
      let fx: number | undefined, fy: number | undefined;
      if (k.has("arrowleft") || k.has("a")) dx -= 1;
      if (k.has("arrowright") || k.has("d")) dx += 1;
      if (k.has("arrowup") || k.has("w")) dy -= 1;
      if (k.has("arrowdown") || k.has("s")) dy += 1;
      if (inp.joy) {
        const jx = inp.joy.x - inp.joy.ox, jy = inp.joy.y - inp.joy.oy;
        if (Math.hypot(jx, jy) > 8) {
          // Undo the screen tilt so "up" on the stick is "up" on screen.
          dx = jx;
          dy = jy / TILT;
        }
      }
      if (inp.mouse && !inp.joy) {
        const { w, h } = sizeRef.current;
        const [wx, wy] = screenToWorld(camRef.current, w, h, inp.mouse.x, inp.mouse.y);
        const mx = wx - me.x, my = wy - me.y;
        const dist = Math.hypot(mx, my);
        if (dist > crabRadius(me) * 0.6) {
          fx = mx;
          fy = my;
        }
        if (followRef.current && dx === 0 && dy === 0 && dist > crabRadius(me) + 30) {
          dx = mx;
          dy = my;
        }
      }
      const attack = k.has(" ") || k.has("j") || inp.mouseAttack || inp.touchAttack;
      // Touch aim-assist: snap facing to the nearest thing in reach when swinging.
      if (inp.touchAttack && me.alive) {
        const reach = attackReach(me) * 1.35;
        let best = Infinity, bx = 0, by = 0;
        for (const c of world.crabs) {
          if (c === me || !c.alive) continue;
          const d = Math.hypot(c.x - me.x, c.y - me.y) - crabRadius(c);
          if (d < reach && d < best) { best = d; bx = c.x; by = c.y; }
        }
        if (best === Infinity) {
          for (const c of world.creatures) {
            if (!c.alive) continue;
            const d = Math.hypot(c.x - me.x, c.y - me.y) - c.def.radius;
            if (d < reach && d < best) { best = d; bx = c.x; by = c.y; }
          }
          for (const b of world.boxes) {
            if (!b.alive) continue;
            const d = Math.hypot(b.x - me.x, b.y - me.y) - 22;
            if (d < reach && d < best) { best = d; bx = b.x; by = b.y; }
          }
        }
        if (best !== Infinity) {
          fx = bx - me.x;
          fy = by - me.y;
        }
      }
      const boost = k.has("shift") || k.has("k") || inp.mouseBoost || inp.touchBoost;
      const skill = k.has("e") || k.has("q") || k.has("l") || inp.touchSkill;
      // Tier 4 beam fires down the facing: on touch, snap it to the nearest crab in range.
      if (inp.touchSkill && me.alive && tierForLevel(me.level) === 4 && fx === undefined) {
        let best = 700, bx = 0, by = 0;
        for (const c of world.crabs) {
          if (c === me || !c.alive) continue;
          const d = Math.hypot(c.x - me.x, c.y - me.y);
          if (d < best) { best = d; bx = c.x; by = c.y; }
        }
        if (best < 700) {
          fx = bx - me.x;
          fy = by - me.y;
          me.angle = Math.atan2(fy, fx);
        }
      }
      return { moveX: dx, moveY: dy, faceX: fx, faceY: fy, boost, attack, skill };
    };

    const handleEvents = () => {
      const a = audioRef.current;
      for (const ev of world.events) {
        switch (ev.type) {
          case "swing":
            if (ev.player) a?.swing(ev.heavy);
            break;
          case "hit":
            if (ev.hurtPlayer) {
              a?.hurt();
              if (navigator.vibrate) navigator.vibrate(35);
            } else if (ev.player) a?.hit(ev.crit || ev.big);
            break;
          case "guard":
            if (ev.player) a?.guard();
            break;
          case "break":
            if (ev.player) {
              a?.breakItem();
              pushBanner({ text: `${ev.name} 파괴!`, sub: ev.what === "weapon" ? "내구도가 다했습니다" : "방패가 부서졌습니다", tone: "info" });
            }
            break;
          case "boxBreak":
            if (ev.player) a?.boxBreak(ev.gold);
            break;
          case "locked":
            a?.locked();
            break;
          case "eat":
            a?.eat();
            break;
          case "coin":
            a?.coin();
            break;
          case "equip":
            a?.equip();
            break;
          case "key":
            a?.key();
            break;
          case "counter":
            a?.counter();
            break;
          case "levelUp":
            if (ev.player) {
              a?.levelUp(ev.species);
              a?.evolve(ev.species, ev.level);
              const perk = SPECIES[ev.species].perk;
              const tier = tierForLevel(ev.level);
              if (tier > tierForLevel(ev.level - 1)) {
                const td = TIERS[tier];
                pushBanner({ text: `🧬 진화! Tier ${tier} ${td.name}`, sub: `${td.passive} · ${td.skillIcon} ${td.skillName} 해금 [E]`, tone: "level" });
              } else {
                pushBanner({
                  text: `LEVEL UP! Lv${ev.level}`,
                  sub: `${road[ev.level - 1].name}(으)로 성장 · ${perk.icon} ${perk.name}: ${perk.desc.replace("레벨업 ", "")}`,
                  tone: "level",
                });
              }
            } else {
              // A bot evolving nearby: a quieter, distance-scaled echo of the same sound (throttled).
              const me = player(world);
              const d = Math.hypot(ev.x - me.x, ev.y - me.y);
              if (me.alive && d < NEAR_EVO && world.time - lastBotEvo > 1.2) {
                lastBotEvo = world.time;
                a?.evolve(ev.species, ev.level, 0.4 * (1 - d / NEAR_EVO));
              }
            }
            break;
          case "gear":
            a?.gear();
            if (ev.lv > 1) {
              pushBanner({ text: `⬆️ ${ev.emoji} ${ev.name} ${"★".repeat(ev.lv)}`, sub: `같은 무기 겹치기 강화! 피해 +${Math.round((ev.lv - 1) * 25)}% · 연사 +${Math.round((ev.lv - 1) * 12)}%${ev.lv >= 3 ? " (최대)" : ""}`, tone: "level" });
              break;
            }
            pushBanner({
              text: `${ev.rarity === "epic" ? "🌟 " : ev.rarity === "rare" ? "✨ " : ""}${ev.emoji} ${ev.name}`,
              sub: ev.rarity === "epic" ? "전설 무기 장착! 섬 전체에 위치가 알려졌고 현상금이 걸렸습니다 — 모두가 노립니다" : `${GEAR_RARITY[ev.rarity].label} 무기 · 자동 발사 장착! (같은 무기를 또 주우면 강화)`,
              tone: ev.rarity === "common" ? "info" : "king",
            });
            if (ev.rarity === "epic") a?.fanfare();
            break;
          case "mutation": {
            const m = MUTATIONS[ev.kind];
            a?.mutation(m.risk);
            const bad = m.bad ? `▼ ${m.bad} (${m.penalty ?? m.duration}초)` : "";
            pushBanner({ text: `${m.emoji} ${m.name}`, sub: m.good ? `▲ ${m.good} (${m.duration}초)${bad ? `  ${bad}` : ""}` : bad, tone: m.risk ? "down" : "level" });
            if (m.risk && navigator.vibrate) navigator.vibrate(60);
            break;
          }
          case "skill":
            if (ev.player) a?.skill(ev.tier);
            break;
          case "wanted":
            pushFeed(`🚨 ${ev.who} 현상금 ${ev.bounty.toLocaleString()} 돌파`, ev.player);
            if (ev.player) pushBanner({ text: "🚨 현상수배!", sub: `내 현상금이 ${ev.bounty.toLocaleString()}점을 넘었습니다 — 미니맵에 빨갛게 표시됩니다`, tone: "down" });
            else if (world.time - lastEpicBanner > 30) {
              lastEpicBanner = world.time;
              pushBanner({ text: `🚨 ${ev.who} 현상수배!`, sub: `현상금 ${ev.bounty.toLocaleString()}점 — 미니맵의 빨간 표시를 쫓으세요`, tone: "down" });
            }
            break;
          case "crownLost":
            a?.kingDown();
            if (a) a.king = false;
            pushBanner({ text: "💔 왕관을 빼앗겼습니다!", sub: `${ev.by}을(를) ${USURP_FX}초 안에 뒤집으면 ⚔️ 역습 보너스!`, tone: "down" });
            if (navigator.vibrate) navigator.vibrate([40, 50, 40]);
            break;
          case "revenge":
            a?.fanfare();
            pushBanner({ text: `⚔️ 역습 성공! +${ev.bonus.toLocaleString()}`, sub: `왕관을 가져간 ${ev.victim}을(를) 곧바로 뒤집었습니다`, tone: "king" });
            pushFeed(`⚔️ 역습! ${ev.victim}`, true);
            break;
          case "epicAlert":
            pushFeed(`🌟 ${ev.who} ${ev.emoji} ${ev.gear} 획득`, ev.player);
            if (!ev.player && world.time - lastEpicBanner > 30) {
              lastEpicBanner = world.time;
              a?.locked();
              pushBanner({ text: `🌟 ${ev.who}: 전설 ${ev.emoji} 획득!`, sub: "미니맵의 금빛 점 · 쓰러뜨리면 💰현상금 + 전설 무기를 빼앗을 수 있어요", tone: "king" });
            }
            break;
          case "blast":
            if (ev.player) a?.blast();
            break;
          case "pearl":
            if (ev.player) a?.guard();
            break;
          case "kingNew":
            a?.fanfare();
            if (a) a.king = ev.player;
            pushBanner({ text: ev.player ? "👑 당신이 킹 크랩!" : `👑 ${ev.name} 킹 크랩 등극!`, sub: ev.player ? "모두가 당신을 노립니다. 살아남으세요!" : "왕관을 쓴 게를 쓰러뜨리면 막대한 보너스!", tone: "king" });
            break;
          case "kingDown":
            a?.kingDown();
            if (a && ev.player) a.king = false;
            pushBanner({
              text: `${ev.name} 왕의 재임이 끝났습니다!`,
              sub: ev.byPlayer ? "당신이 왕을 쓰러뜨렸습니다! 대량 보너스 획득" : ev.by ? `${ev.by}의 일격` : undefined,
              tone: "down",
            });
            break;
          case "kill":
            pushFeed(`${ev.killer} 🦀✂️ ${ev.victim}${ev.bounty ? " 💰현상금" : ""}`, ev.byPlayer || ev.victimPlayer);
            if (ev.byPlayer) {
              a?.hit(true);
              if (ev.bounty) {
                a?.boxBreak(true);
                pushBanner({ text: `💰 현상금 +${ev.bounty.toLocaleString()}!`, sub: `전설 무기를 든 ${ev.victim}을(를) 뒤집었습니다 — 떨어진 전설 무기를 챙기세요`, tone: "king" });
              } else pushBanner({ text: "처치!", sub: `${ev.victim}을(를) 뒤집었습니다`, tone: "kill" });
            }
            break;
          case "playerDeath":
            a?.death();
            if (a) a.king = false;
            if (navigator.vibrate) navigator.vibrate([80, 60, 120]);
            setDown({ by: ev.by, score: world.deathSnapshot?.score ?? 0, revives: world.revivesLeft });
            break;
          case "matchEnd":
            break;
        }
      }
      world.events.length = 0;
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { w, h, dpr } = sizeRef.current;
      if (!pausedRef.current && !world.over) {
        step(world, readInput(), dt);
        handleEvents();
        updateCamera(camRef.current, world, w, h, dt);
      }
      drawWorld(ctx, world, camRef.current, w, h, now / 1000, dpr, { noShake: noShakeRef.current, reduceFlash: reduceFlashRef.current });
      const mini = miniRef.current;
      if (mini) {
        const mctx = mini.getContext("2d");
        const size = mini.clientWidth || 120;
        if (mctx) {
          if (mini.width !== Math.round(size * dpr)) {
            mini.width = mini.height = Math.round(size * dpr);
          }
          drawMinimap(mctx, world, size, now / 1000, dpr);
        }
      }

      hudAcc += dt;
      if (hudAcc > 0.1) {
        hudAcc = 0;
        const me = player(world);
        const king = world.kingId !== null ? world.crabs.find((c) => c.id === world.kingId) : undefined;
        const ranked = world.ranking.map((id) => world.crabs.find((c) => c.id === id)!).filter((c) => c.alive);
        setHud({
          hp: me.hp,
          maxHp: me.maxHp,
          stamina: me.stamina,
          score: me.score,
          level: me.level,
          alive: me.alive,
          weapon: me.weapon ? { emoji: WEAPONS[me.weapon.kind].emoji, name: WEAPONS[me.weapon.kind].name, dur: me.weapon.dur, max: WEAPONS[me.weapon.kind].durability } : null,
          shield: me.shield ? { emoji: SHIELDS[me.shield.kind].emoji, name: SHIELDS[me.shield.kind].name, dur: me.shield.dur, max: SHIELDS[me.shield.kind].durability } : null,
          key: me.hasKey,
          combo: me.combo,
          remaining: Math.max(0, world.duration - world.time),
          rank: me.alive ? rankOf(world, me.id) : 0,
          total: ranked.length,
          lb: ranked.slice(0, 10).map((c) => ({ id: c.id, name: c.name, score: c.score, level: c.level, me: c.isPlayer, king: c.id === world.kingId })),
          kingName: king?.alive ? king.name : null,
          inPool: me.inPool,
          kills: world.stats.kills,
          tier: tierForLevel(me.level),
          skillCd: me.skillCd,
          burrow: me.burrow > 0,
          gear: me.gear.map((g) => ({ emoji: GEARS[g.kind].emoji, name: GEARS[g.kind].name, t: g.t, max: GEARS[g.kind].duration, color: GEAR_RARITY[GEARS[g.kind].rarity].color, label: GEAR_RARITY[GEARS[g.kind].rarity].label, lv: g.lv })),
          muts: me.muts.map((m) => ({ kind: m.kind, t: m.t, pen: penaltyLeft(me, m.kind) })),
          pearl: me.pearl,
          myBounty: holdsEpic(me) ? epicBounty(me.level, me.epicT) : 0,
          nextSurvive: EPIC_SURVIVE_EVERY - (me.epicT % EPIC_SURVIVE_EVERY),
        });
      }
      if (world.over && endTimer === null) {
        setEnded(true);
        setDown(null);
        endTimer = window.setTimeout(() => onEndRef.current(summarize(world)), 1900);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      if (endTimer !== null) clearTimeout(endTimer);
    };
    // A match is created once per mount; the parent remounts for a new one.
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
    if (e.button === 0) input.current.mouseAttack = true;
    if (e.button === 2) input.current.mouseBoost = true;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = localPos(e);
    const joy = input.current.joy;
    if (e.pointerType === "touch") {
      if (joy && joy.id === e.pointerId) {
        let dx = p.x - joy.ox, dy = p.y - joy.oy;
        const d = Math.hypot(dx, dy);
        if (d > JOY_R) {
          dx = (dx / d) * JOY_R;
          dy = (dy / d) * JOY_R;
        }
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
    if (e.button === 0) input.current.mouseAttack = false;
    if (e.button === 2) input.current.mouseBoost = false;
  };

  const toggleFullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => {});
  };

  const revive = () => {
    const w = worldRef.current;
    if (w && revivePlayer(w)) {
      setDown(null);
      audioRef.current?.levelUp();
    }
  };
  const giveUp = () => {
    const w = worldRef.current;
    if (!w) return;
    pausedRef.current = false;
    setPaused(false);
    endMatch(w);
  };

  const lv = hud ? road[hud.level - 1] : road[0];
  const nextLv = hud && hud.level < road.length ? road[hud.level] : null;
  const xpPct = hud && nextLv ? Math.min(1, (hud.score - lv.points) / (nextLv.points - lv.points)) : 1;
  const hpPct = hud ? Math.max(0, hud.hp / hud.maxHp) : 1;
  const mm = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const compact = miniSize < 110;
  const hardBtn = "rounded-md bg-black/50 px-2 py-1 text-xs text-white hover:bg-black/70";

  return (
    <div
      ref={wrapRef}
      className={`relative w-full select-none overflow-hidden bg-sky-900 ${fullscreen ? "" : "rounded-2xl border border-white/10 light:border-slate-300"}`}
      style={{ touchAction: "none" }}
    >
      <style>{`@keyframes csBanner{0%{opacity:0;transform:scale(.6)}10%{opacity:1;transform:scale(1.1)}18%{transform:scale(1)}82%{opacity:1}100%{opacity:0;transform:translateY(-14px)}}.cs-banner{animation:csBanner 2.6s ease-out forwards}`}</style>
      <canvas
        ref={canvasRef}
        className={`block w-full ${followMouse ? "cursor-pointer" : "cursor-crosshair"}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={(e) => {
          if (e.pointerType === "touch") return;
          input.current.mouseAttack = false;
          input.current.mouseBoost = false;
          input.current.mouse = null;
        }}
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* ── Leaderboard (top-left) ── */}
      {hud && (
        <div className="pointer-events-none absolute top-2 left-2 w-[min(44%,210px)] rounded-lg bg-black/45 px-2 py-1.5 text-[11px] text-white backdrop-blur-[2px]">
          <div className="mb-0.5 flex items-center justify-between text-[10px] font-bold tracking-wider text-white/60">
            <span>🏆 리더보드</span>
            <span>⏱ {mm(hud.remaining)}</span>
          </div>
          {hud.lb.slice(0, compact ? 5 : 10).map((r, i) => (
            <div key={r.id} className={`flex items-center gap-1 leading-tight ${r.me ? "font-black text-cyan-300" : r.king ? "font-bold text-yellow-300" : "text-white/85"}`}>
              <span className="w-4 shrink-0 text-right tabular-nums text-white/50">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">
                {r.king ? "👑" : ""}
                {r.name}
              </span>
              <span className="shrink-0 tabular-nums">{fmt(r.score)}</span>
            </div>
          ))}
          {hud.alive && hud.rank > (compact ? 5 : 10) && (
            <div className="mt-0.5 flex items-center gap-1 border-t border-white/15 pt-0.5 font-black text-cyan-300">
              <span className="w-4 shrink-0 text-right tabular-nums">{hud.rank}</span>
              <span className="min-w-0 flex-1 truncate">나</span>
              <span className="shrink-0 tabular-nums">{fmt(hud.score)}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Minimap + controls (top-right) ── */}
      <div className="absolute top-2 right-2 flex flex-col items-end gap-1.5">
        <canvas ref={miniRef} className="pointer-events-none rounded-full shadow-lg" style={{ width: miniSize, height: miniSize }} />
        <div className="flex gap-1">
          <button onClick={() => setPause(!paused)} className={hardBtn} aria-label="일시정지">
            {paused ? "▶" : "⏸"}
          </button>
          {!isTouch && (
            <button
              onClick={onToggleFollow}
              className={`${hardBtn} ${followMouse ? "bg-emerald-600/70" : ""}`}
              title={followMouse ? "마우스 따라 이동: 켜짐 (WASD도 가능)" : "마우스 따라 이동: 꺼짐 (WASD 이동 + 마우스 조준)"}
              aria-label="마우스 이동 모드"
            >
              🖱️
            </button>
          )}
          <button
            onClick={onToggleShake}
            className={`${hardBtn} ${noShake ? "bg-slate-600/80" : ""}`}
            title={noShake ? "화면 흔들림: 꺼짐" : "화면 흔들림: 켜짐"}
            aria-label="화면 흔들림"
            aria-pressed={!noShake}
          >
            {noShake ? "🚫" : "📳"}
          </button>
          <button
            onClick={onToggleFlash}
            className={`${hardBtn} ${reduceFlash ? "bg-slate-600/80" : ""}`}
            title={reduceFlash ? "깜빡임·번쩍임 줄이기: 켜짐" : "깜빡임·번쩍임 줄이기: 꺼짐"}
            aria-label="깜빡임·번쩍임 줄이기"
            aria-pressed={reduceFlash}
          >
            {reduceFlash ? "🔅" : "🔆"}
          </button>
          <button onClick={onToggleMute} className={hardBtn} aria-label="소리">
            {muted ? "🔇" : "🔊"}
          </button>
          <button onClick={toggleFullscreen} className={hardBtn} aria-label="전체화면">
            {fullscreen ? "🗗" : "⛶"}
          </button>
        </div>
        {/* Kill feed */}
        <div className="pointer-events-none mt-1 flex flex-col items-end gap-0.5">
          {feed.map((f) => (
            <div key={f.id} className={`rounded bg-black/45 px-1.5 py-0.5 text-[10px] ${f.mine ? "font-bold text-yellow-200" : "text-white/80"}`}>
              {f.text}
            </div>
          ))}
        </div>
      </div>

      {/* ── Player status (bottom-left): field weapons + mutations on top ── */}
      {hud && hud.alive && (
        <div className={`pointer-events-none absolute left-2 flex w-[min(62%,300px)] flex-col gap-1 bottom-2`}>
          {(hud.gear.length > 0 || hud.muts.length > 0) && (
            <div className="flex flex-wrap items-center gap-1">
              {hud.myBounty > 0 && (
                <div className="flex items-center gap-1 rounded-lg bg-amber-950/85 px-1.5 py-0.5 text-[10px] font-bold text-amber-200 ring-1 ring-amber-400" title="전설 무기를 들고 버틸수록 내 현상금과 생존 보상이 쌓입니다">
                  <span>💰 현상금 {hud.myBounty.toLocaleString()}</span>
                  <span className="font-mono text-amber-300/80">🛡 {Math.ceil(hud.nextSurvive)}s</span>
                </div>
              )}
              {hud.gear.map((g, i) => (
                <div key={`g${i}`} className={`flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[10px] text-white ${g.lv >= 3 ? "bg-gradient-to-r from-amber-900/90 to-slate-950/85" : "bg-slate-950/80"}`} style={{ boxShadow: g.lv >= 3 ? `0 0 0 1.5px #fbbf24, 0 0 8px rgba(251,191,36,0.6)` : `0 0 0 1px ${g.color}` }} title={`[${g.label}] ${g.name}`}>
                  <span className="text-sm leading-none">{g.emoji}</span>
                  {g.lv > 1 && <span className="text-[9px] text-amber-300">{"★".repeat(g.lv)}</span>}
                  {!compact && <span className="max-w-[78px] truncate font-bold" style={{ color: g.color }}>{g.name}</span>}
                  <span className={`font-mono tabular-nums ${g.t < 5 ? `${reduceFlash ? "" : "animate-pulse "}text-rose-300` : "text-cyan-300"}`}>{Math.ceil(g.t)}s</span>
                </div>
              ))}
              {hud.muts.map((m) => {
                const def = MUTATIONS[m.kind];
                return (
                  <div
                    key={m.kind}
                    className={`flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[10px] font-bold ring-1 ${m.pen > 0 ? `${reduceFlash ? "" : "animate-pulse "}bg-rose-950/85 text-rose-200 ring-rose-500` : def.risk ? "bg-amber-950/85 text-amber-200 ring-amber-500" : "bg-emerald-950/85 text-emerald-200 ring-emerald-500"}`}
                    title={`${def.name} — ${def.good}${def.bad ? ` / ${def.bad}` : ""}`}
                  >
                    <span>{m.pen > 0 ? "⚠️" : "🔼"}</span>
                    <span className="text-sm leading-none">{def.emoji}</span>
                    {!compact && <span className="max-w-[80px] truncate">{def.name}</span>}
                    {m.kind === "pearl" && <span>×{hud.pearl}</span>}
                    {m.pen > 0 && m.kind !== "oil" && <span className="font-mono tabular-nums text-rose-300">벌칙 {Math.ceil(m.pen)}</span>}
                    <span className="font-mono tabular-nums">{Math.ceil(m.t)}s</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex items-end gap-2">
            <div className="rounded-lg bg-gradient-to-b from-orange-400 to-red-600 px-2 py-1 text-center leading-none text-white shadow ring-1 ring-white/30">
              <div className="text-[9px] font-bold opacity-80">LV</div>
              <div className="text-xl font-black">{hud.level}</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between text-[11px] font-bold text-white drop-shadow">
                <span>
                  {lv.name} <span className="font-semibold text-white/60">· {SPECIES[species].name}</span>
                </span>
                <span className="tabular-nums text-yellow-200">{hud.score.toLocaleString()} pts</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-black/50 ring-1 ring-white/20">
                <div className="h-full rounded-full bg-gradient-to-r from-yellow-200 to-amber-400" style={{ width: `${xpPct * 100}%` }} />
              </div>
              <div className="text-[9px] text-white/70 drop-shadow">{nextLv ? `다음 Lv${nextLv.level} ${nextLv.name}까지 ${(nextLv.points - hud.score).toLocaleString()}` : "최대 성장!"}</div>
            </div>
          </div>
          <div className="relative h-3.5 overflow-hidden rounded-full bg-black/50 ring-1 ring-white/20">
            <div
              className={`h-full rounded-full transition-[width] duration-100 ${hud.inPool ? "bg-gradient-to-r from-emerald-300 to-teal-500" : hpPct < 0.3 ? `${reduceFlash ? "" : "animate-pulse "}bg-gradient-to-r from-red-500 to-rose-700` : "bg-gradient-to-r from-lime-400 to-green-600"}`}
              style={{ width: `${hpPct * 100}%` }}
            />
            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white drop-shadow">
              ❤️ {Math.ceil(hud.hp).toLocaleString()} / {hud.maxHp.toLocaleString()} {hud.inPool ? "· 💧회복 중" : ""}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-black/50 ring-1 ring-white/20">
            <div className="h-full rounded-full bg-gradient-to-r from-sky-300 to-cyan-500" style={{ width: `${(hud.stamina / STAMINA_MAX) * 100}%` }} />
          </div>
          <div className="flex gap-1">
            <Slot label="무기" item={hud.weapon} empty="✊" />
            <Slot label="방패" item={hud.shield} empty="🫲" />
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg text-lg ring-1 ${hud.key ? "bg-yellow-400/30 ring-yellow-300" : "bg-black/40 opacity-50 ring-white/15"}`} title="열쇠">
              🔑
            </div>
            {hud.kills > 0 && <div className="flex h-10 items-center rounded-lg bg-black/40 px-2 text-xs font-bold text-white ring-1 ring-white/15">✂️ {hud.kills}</div>}
            {!isTouch && <SkillChip tier={hud.tier} cd={hud.skillCd} burrow={hud.burrow} />}
          </div>
        </div>
      )}

      {/* Combo */}
      {hud && hud.alive && hud.combo >= 2 && (
        <div className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-right drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
          <div className="text-3xl font-black text-orange-300 sm:text-4xl">{hud.combo}</div>
          <div className="text-xs font-black tracking-widest text-white">COMBO ×{comboMultiplier(hud.combo).toFixed(2)}</div>
        </div>
      )}

      {/* Banners */}
      <div className="pointer-events-none absolute inset-x-0 top-[18%] flex flex-col items-center gap-2 px-4">
        {banners.map((b) => (
          <div key={b.id} className="cs-banner text-center">
            <div
              className={`text-2xl font-black tracking-wide drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)] sm:text-4xl ${
                b.tone === "king" ? "text-yellow-300" : b.tone === "down" ? "text-rose-300" : b.tone === "level" ? "text-amber-200" : b.tone === "kill" ? "text-orange-300" : "text-sky-200"
              }`}
            >
              {b.text}
            </div>
            {b.sub && <div className="mt-1 text-xs font-semibold text-white drop-shadow sm:text-sm">{b.sub}</div>}
          </div>
        ))}
      </div>

      {/* Touch joystick + action buttons */}
      {isTouch && joyView && (
        <div className="pointer-events-none absolute" style={{ left: joyView.ox - JOY_R, top: joyView.oy - JOY_R }}>
          <div className="rounded-full border-2 border-white/40 bg-white/10" style={{ width: JOY_R * 2, height: JOY_R * 2 }} />
          <div className="absolute h-11 w-11 rounded-full bg-white/60" style={{ left: JOY_R - 22 + (joyView.x - joyView.ox), top: JOY_R - 22 + (joyView.y - joyView.oy) }} />
        </div>
      )}
      {isTouch && hud?.alive && (
        <>
          <TouchButton
            className="right-4 bottom-6 h-24 w-24 border-orange-200/70 bg-orange-500/45 text-4xl active:bg-orange-400/70"
            label="공격"
            onChange={(v) => {
              audioRef.current?.unlock();
              input.current.touchAttack = v;
            }}
          >
            🦀
          </TouchButton>
          <TouchButton
            className="right-8 bottom-32 h-16 w-16 border-sky-200/60 bg-sky-500/40 text-2xl active:bg-sky-400/60"
            label="부스트"
            onChange={(v) => {
              audioRef.current?.unlock();
              input.current.touchBoost = v;
            }}
          >
            💨
          </TouchButton>
          <TouchButton
            className={`right-6 bottom-52 h-16 w-16 text-2xl ${hud.skillCd > 0 || hud.burrow ? "border-white/25 bg-slate-700/50" : "border-amber-200/80 bg-amber-500/50 active:bg-amber-400/70"}`}
            label="특수기"
            onChange={(v) => {
              audioRef.current?.unlock();
              input.current.touchSkill = v;
            }}
          >
            <span className="relative">
              {TIERS[hud.tier].skillIcon}
              {hud.skillCd > 0 && <span className="absolute inset-0 flex items-center justify-center text-sm font-black text-white drop-shadow">{Math.ceil(hud.skillCd)}</span>}
            </span>
          </TouchButton>
        </>
      )}

      {/* Pause */}
      {paused && !down && !ended && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/70 backdrop-blur-sm">
          <div className="text-3xl font-black text-white">일시정지</div>
          <p className="text-xs text-white/60">Esc / P 키로 재개</p>
          <button onClick={() => setPause(false)} className="w-52 rounded-xl bg-orange-500 py-2.5 font-bold text-white hover:bg-orange-400">
            ▶ 계속하기
          </button>
          <button onClick={giveUp} className="w-52 rounded-xl bg-white/10 py-2.5 font-semibold text-white hover:bg-white/20">
            🏁 여기서 종료하고 정산
          </button>
        </div>
      )}

      {/* Death: Continue / End (spec §5.2) */}
      {down && !ended && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-red-950/55 px-6 text-center backdrop-blur-[2px]">
          <div className="text-4xl font-black text-rose-300 drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)] sm:text-5xl">
            뒤집혔다! 🦀
          </div>
          <div className="text-sm font-semibold text-white">
            <b className="text-rose-200">{down.by}</b>에게 당했습니다 · 기록 {down.score.toLocaleString()}점
          </div>
          <div className="mt-1 flex w-full max-w-xs flex-col gap-2">
            <button
              disabled={down.revives <= 0}
              onClick={revive}
              className="rounded-xl bg-gradient-to-r from-rose-500 to-pink-500 py-3 font-black text-white shadow-lg hover:brightness-110 disabled:cursor-not-allowed disabled:from-slate-600 disabled:to-slate-700"
            >
              {down.revives > 0 ? `❤️ 부활하기 (하트 ${down.revives}개)` : "❤️ 하트를 모두 썼습니다"}
              <div className="text-[10px] font-semibold opacity-85">점수 50%와 장비(내구도 절반)를 유지한 채 재도전</div>
            </button>
            <button onClick={giveUp} className="rounded-xl bg-white/15 py-2.5 font-bold text-white hover:bg-white/25">
              🏁 게임 종료 · 결과 정산
            </button>
          </div>
          <p className="text-[11px] text-white/60">결정하는 동안에도 섬의 시간은 흐릅니다.</p>
        </div>
      )}

      {ended && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-slate-950/50">
          <div className="cs-banner text-5xl font-black text-yellow-300 drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]">경기 종료!</div>
          <div className="mt-2 text-sm font-semibold text-white drop-shadow">결과를 정산하는 중…</div>
        </div>
      )}
    </div>
  );
}

function Slot({ label, item, empty }: { label: string; item: { emoji: string; name: string; dur: number; max: number } | null; empty: string }) {
  const pct = item ? item.dur / item.max : 0;
  return (
    <div
      className={`relative flex h-10 w-10 flex-col items-center justify-center rounded-lg ring-1 ${item ? "bg-black/50 ring-white/40" : "bg-black/30 ring-white/10"}`}
      title={item ? `${item.name} (내구도 ${item.dur}/${item.max})` : `${label} 없음`}
    >
      <span className={`text-lg leading-none ${item ? "" : "opacity-40"}`}>{item ? item.emoji : empty}</span>
      {item && (
        <>
          <div className="absolute inset-x-1 bottom-1 h-1 overflow-hidden rounded-full bg-white/15">
            <div className={`h-full ${pct < 0.3 ? "bg-red-400" : "bg-emerald-400"}`} style={{ width: `${pct * 100}%` }} />
          </div>
          <span className="absolute -top-1 -right-1 rounded bg-black/70 px-0.5 text-[8px] font-bold text-white tabular-nums">{item.dur}</span>
        </>
      )}
    </div>
  );
}

function SkillChip({ tier, cd, burrow }: { tier: CrabTier; cd: number; burrow: boolean }) {
  const td = TIERS[tier];
  const ready = cd <= 0 && !burrow;
  return (
    <div
      className={`relative flex h-10 items-center gap-1.5 overflow-hidden rounded-lg px-2 ring-1 ${ready ? "bg-amber-500/35 ring-amber-300" : "bg-black/45 ring-white/15"}`}
      title={`Tier ${tier} ${td.name} — ${td.skillName}: ${td.skillDescription}`}
    >
      {!ready && <div className="absolute inset-y-0 left-0 bg-white/10" style={{ width: `${(1 - cd / td.skillCooldown) * 100}%` }} />}
      <span className="relative text-lg leading-none">{td.skillIcon}</span>
      <div className="relative flex flex-col leading-tight">
        <span className="text-[9px] text-white/70">T{tier} · {td.skillName}</span>
        <span className={`font-mono text-[11px] font-bold ${ready ? "text-amber-200" : "text-white/80"}`}>{burrow ? "잠복 중…" : ready ? "READY [E]" : `${cd.toFixed(1)}s`}</span>
      </div>
    </div>
  );
}

function TouchButton({ className, label, onChange, children }: { className: string; label: string; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <button
      className={`absolute flex items-center justify-center rounded-full border-2 text-white active:scale-95 ${className}`}
      onPointerDown={(e) => {
        e.stopPropagation();
        onChange(true);
      }}
      onPointerUp={() => onChange(false)}
      onPointerCancel={() => onChange(false)}
      onPointerLeave={() => onChange(false)}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}
