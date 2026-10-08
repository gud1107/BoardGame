"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { analyzeWeapon, INK_COLORS, MAX_POINTS_PER_STROKE, MAX_STROKES, strokeInk, totalInk, type InkColor, type Stroke } from "./analyze";
import {
  Ambient,
  characterFor,
  crayon,
  drawAimArrow,
  drawBolt,
  drawCharacter,
  drawComicText,
  drawDamageNumber,
  drawNameplate,
  drawProjectile,
  drawShieldArt,
  drawTombstone,
  drawWallArt,
  Fx,
  renderBackground,
  renderTerrain,
  WindStreaks,
} from "./arenaArt";
import { CharacterAvatar } from "./ArenaCanvas";
import { computeRankings, MIN_INK, shieldWall, wallPlacementError, type SeatIndex } from "./engine";
import { playImpactKind, playLaunchSound, playScribbleTick, playVictorySound, playWallSound } from "./inkDuelAudio";
import { WeaponCard } from "./InkDuelBoard";
import { MAPS, type MapId } from "./maps";
import { GRAVITY, launchVelocity, MUZZLE_Y, WORLD_H, WORLD_W } from "./physics";
import { DEFAULT_RT_RULES, RT_INK_MAX, type RtCommand, type RtInput } from "./realtime";
import type { RtView, RtViewPlayer } from "./rtView";
import { activeStatuses, STATUS_INFO } from "./status";
import WeaponPad, { InkPalette } from "./WeaponPad";

type Mode = "weapon" | "shield" | "wall";
type CommandBody = RtCommand extends infer C ? (C extends RtCommand ? Omit<C, "seat"> : never) : never;

const WORD: Record<string, string> = {
  spear: "푸욱!",
  bomb: "콰광!",
  rocket: "슈우웅 쾅!",
  anvil: "쿠웅!!",
  shuriken: "슈슉!",
  lightning: "지지직!",
  boomerang: "휘리릭 퍽!",
  drill: "드드드 쾅!",
  wave: "철썩!",
  cluster: "파파팡!",
  club: "빠악!",
};

interface Props {
  /** Current frame to draw (host: live state; guests: interpolated snapshots). */
  getView: (now: number) => RtView | null;
  /** A slower (~8/s) copy for the React HUD. */
  hud: RtView | null;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: ReadonlySet<SeatIndex>;
  onInput: (input: RtInput) => void;
  onCommand: (cmd: CommandBody) => void;
  onGameEnd: () => void;
}

interface Popup {
  kind: "dmg" | "word";
  text: string;
  x: number;
  y: number;
  start: number;
  crit: boolean;
  color: string;
}

function fmtTime(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function RealtimeBoard({ getView, hud, viewerSeat, names, connectedSeats, onInput, onCommand, onGameEnd }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [mode, setMode] = useState<Mode>("weapon");
  const [weapon, setWeapon] = useState<Stroke[]>([]);
  const [shield, setShield] = useState<Stroke[]>([]);
  const [wall, setWall] = useState<Stroke[]>([]);
  const [color, setColor] = useState<InkColor>(0);
  const [angle, setAngle] = useState(45);
  const [power, setPower] = useState(60);

  const stats = useMemo(() => (weapon.length > 0 && totalInk(weapon) >= MIN_INK ? analyzeWeapon(weapon) : null), [weapon]);
  const me = hud?.players[viewerSeat] ?? null;
  const myInk = me?.ink ?? 0;
  const cooling = (me?.cooldownMs ?? 0) > 0;
  const stunned = me ? (me.status.stun ?? 0) > 0 || (me.status.freeze ?? 0) > 0 : false;
  const blind = me ? (me.status.blind ?? 0) > 0 : false;
  const activeStrokes = mode === "weapon" ? weapon : mode === "shield" ? shield : wall;
  const cost = totalInk(activeStrokes);
  const ready = !!me?.alive && !cooling && !stunned && cost >= MIN_INK && cost <= myInk + 0.5;

  // Latest values for the canvas loop / key handlers.
  const live = useRef({ mode, weapon, shield, wall, color, angle, power, stats, ready, blind });
  useEffect(() => {
    live.current = { mode, weapon, shield, wall, color, angle, power, stats, ready, blind };
  });
  const onCommandRef = useRef(onCommand);
  const onInputRef = useRef(onInput);
  useEffect(() => {
    onCommandRef.current = onCommand;
    onInputRef.current = onInput;
  });

  const fire = () => {
    const l = live.current;
    if (!l.ready) return;
    if (l.mode === "weapon") onCommandRef.current({ type: "fire", strokes: l.weapon, angle: l.angle, power: l.power });
    else if (l.mode === "shield") onCommandRef.current({ type: "shield", strokes: l.shield, angle: l.angle });
    else {
      onCommandRef.current({ type: "wall", strokes: l.wall });
      setWall([]);
    }
  };
  const fireRef = useRef(fire);
  useEffect(() => {
    fireRef.current = fire;
  });

  // --- Movement input: keyboard + on-screen buttons ---
  const inputRef = useRef<RtInput>({ left: false, right: false, jump: false });
  const setKey = (k: keyof RtInput, v: boolean) => {
    if (inputRef.current[k] === v) return;
    inputRef.current = { ...inputRef.current, [k]: v };
    onInputRef.current(inputRef.current);
  };
  const setKeyRef = useRef(setKey);
  useEffect(() => {
    setKeyRef.current = setKey;
  });
  useEffect(() => {
    const map: Record<string, keyof RtInput> = { ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right", ArrowUp: "jump", w: "jump", W: "jump", " ": "jump" };
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "f" || e.key === "F" || e.key === "Enter") {
        fireRef.current();
        return;
      }
      const k = map[e.key];
      if (!k) return;
      e.preventDefault();
      setKeyRef.current(k, true);
    };
    const up = (e: KeyboardEvent) => {
      const k = map[e.key];
      if (k) setKeyRef.current(k, false);
    };
    const blur = () => (["left", "right", "jump"] as const).forEach((k) => setKeyRef.current(k, false));
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    // Keep-alive so the host recovers from a lost input message.
    const keep = window.setInterval(() => onInputRef.current(inputRef.current), 600);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      window.clearInterval(keep);
    };
  }, []);

  // --- Canvas loop ---
  const drawingRef = useRef<number[] | null>(null);
  const aimingRef = useRef(false);
  const getViewRef = useRef(getView);
  useEffect(() => {
    getViewRef.current = getView;
  }, [getView]);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = WORLD_W * dpr;
    canvas.height = WORLD_H * dpr;
    const backgrounds = new Map<MapId, HTMLCanvasElement>();
    const terrainCache = new Map<readonly number[], HTMLCanvasElement>();
    const fx = new Fx();
    const wind = new WindStreaks();
    let ambient: Ambient | null = null;
    let ambientMap: MapId | null = null;
    const seen = new Set<number>();
    const popups: Popup[] = [];
    const bolts: { path: number[]; start: number }[] = [];
    const hurtAt = new Map<number, number>();
    const ghost: number[] = [];
    let raf = 0;
    let lastNow = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016;
      lastNow = now;
      const view = getViewRef.current(now);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!view) {
        ctx.fillStyle = "#fbf7ec";
        ctx.fillRect(0, 0, WORLD_W, WORLD_H);
        ctx.fillStyle = "#64748b";
        ctx.font = "bold 22px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("연결하는 중…", WORLD_W / 2, WORLD_H / 2);
        return;
      }
      const l = live.current;
      // New events → particles, popups, sounds.
      for (const ev of view.events) {
        if (seen.has(ev.id)) continue;
        seen.add(ev.id);
        if (ev.kind === "fire") playLaunchSound();
        else if (ev.kind === "wall" || ev.kind === "shield") playWallSound();
        else if (ev.kind === "caught") popups.push({ kind: "word", text: "탁! 받았다", x: ev.x, y: ev.y - 40, start: now, crit: false, color: "#0ea5e9" });
        else if (ev.kind === "boom") {
          const pts = ev.pelletPoints.length ? ev.pelletPoints : [ev.x, ev.y];
          const power = ev.hits.reduce((s, h) => s + h.dmg, 0);
          for (let k = 0; k < pts.length; k += 2) fx.explode(pts[k], pts[k + 1], Math.max(18, ev.blast), ev.element, ev.ink, { dirt: ev.dirt, power: pts.length > 2 ? power / 3 : power });
          if (ev.chainPath.length >= 4) bolts.push({ path: ev.chainPath, start: now });
          popups.push({ kind: "word", text: ev.hits.length === 0 ? "퍽!" : ev.crit ? "크리티컬!!" : WORD[ev.weapon] ?? "쾅!", x: ev.x, y: Math.min(WORLD_H - 30, ev.y + Math.max(26, ev.blast * 0.6) + 14), start: now, crit: ev.crit, color: ev.hits.length === 0 ? "#9ca3af" : ev.crit ? "#f59e0b" : "#ef4444" });
          for (const h of ev.hits) {
            const p = view.players[h.seat];
            if (!p) continue;
            hurtAt.set(h.seat, now);
            popups.push({ kind: "dmg", text: `${h.chain ? "⚡" : ""}-${h.dmg}`, x: p.x, y: p.y - 112, start: now, crit: ev.crit, color: "" });
          }
          playImpactKind(ev.weapon, ev.hits.length, ev.killed.length, ev.crit);
        }
      }
      if (seen.size > 600) seen.clear();
      fx.update(now);
      for (let i = 0; i < view.players.length; i++) {
        const hp = view.players[i].hp;
        if (ghost[i] === undefined || ghost[i] < hp) ghost[i] = hp;
        else ghost[i] = Math.max(hp, ghost[i] - dt * 45);
      }

      ctx.save();
      if (fx.shake > 0) ctx.translate((Math.random() - 0.5) * fx.shake, (Math.random() - 0.5) * fx.shake);
      let bg = backgrounds.get(view.map);
      if (!bg) {
        bg = renderBackground(dpr, view.map);
        backgrounds.set(view.map, bg);
      }
      ctx.drawImage(bg, -8, -8, WORLD_W + 16, WORLD_H + 16);
      if (!l.blind) wind.draw(ctx, view.wind, now);
      let layer = terrainCache.get(view.terrain);
      if (!layer) {
        layer = renderTerrain(view.terrain, dpr, view.map);
        terrainCache.set(view.terrain, layer);
        if (terrainCache.size > 4) terrainCache.delete(terrainCache.keys().next().value!);
      }
      const mePl = view.players[viewerSeat];
      if (l.mode === "wall" && mePl?.alive) {
        ctx.save();
        ctx.fillStyle = "rgba(37, 99, 235, 0.08)";
        ctx.fillRect(mePl.x - 230, 0, 460, WORLD_H);
        ctx.restore();
      }
      ctx.drawImage(layer, 0, 0, WORLD_W, WORLD_H);
      fx.drawSplats(ctx);
      drawWallArt(ctx, view.walls, now);
      if (l.mode === "shield" && mePl?.alive && l.shield.length > 0 && totalInk(l.shield) >= MIN_INK) {
        const preview = shieldWall({ players: view.players, nextWallId: -1 }, viewerSeat, l.shield, l.angle);
        drawShieldArt(ctx, preview, 1, true, now);
      }

      // Characters.
      const nearestProjectile = (p: RtViewPlayer) => {
        let best: { x: number; y: number } | null = null;
        let bd = 260 * 260;
        for (const pr of view.projectiles) {
          if (pr.owner === p.seat) continue;
          const d = (pr.x - p.x) ** 2 + (pr.y - p.y) ** 2;
          if (d < bd) {
            bd = d;
            best = { x: pr.x, y: pr.y };
          }
        }
        return best;
      };
      for (const p of view.players) {
        const char = view.characters[p.seat] ?? p.seat;
        if (!p.alive) {
          drawTombstone(ctx, p.x, p.y, char, now);
          continue;
        }
        let enemy: RtViewPlayer | null = null;
        for (const q of view.players) if (q.alive && q.seat !== p.seat && (!enemy || Math.abs(q.x - p.x) < Math.abs(enemy.x - p.x))) enemy = q;
        const isMe = p.seat === viewerSeat;
        const hurtT = hurtAt.get(p.seat);
        drawCharacter(ctx, {
          seat: p.seat,
          char,
          x: p.x,
          y: p.y,
          now,
          facing: isMe && l.mode !== "wall" ? (l.angle > 90 ? -1 : 1) : p.facing,
          look: nearestProjectile(p) ?? (enemy ? { x: enemy.x, y: enemy.y - 20 } : null),
          hurt: hurtT ? Math.max(0, 1 - (now - hurtT) / 750) : 0,
          holdAngle: isMe && l.mode !== "wall" ? l.angle : null,
          frozen: (p.status.freeze ?? 0) > 0,
          burn: (p.status.burn ?? 0) > 0,
          poison: (p.status.poison ?? 0) > 0,
          statuses: activeStatuses(p.status),
        });
      }
      for (const p of view.players) {
        if (!p.alive) continue;
        drawNameplate(ctx, p.x, p.y, view.characters[p.seat] ?? p.seat, names[p.seat] ?? `P${p.seat + 1}`, p.hp, ghost[p.seat] ?? p.hp, activeStatuses(p.status));
      }
      if (mePl?.alive) {
        // "나" marker.
        const b = Math.sin(now / 160) * 3;
        ctx.save();
        ctx.fillStyle = characterFor(view.characters[viewerSeat] ?? viewerSeat).base;
        ctx.strokeStyle = "#111827";
        ctx.lineWidth = 2;
        const top = mePl.y - 118 - (activeStatuses(mePl.status).length > 0 ? 20 : 0) + b;
        ctx.beginPath();
        ctx.moveTo(mePl.x - 9, top);
        ctx.lineTo(mePl.x + 9, top);
        ctx.lineTo(mePl.x, top + 12);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      ambient ??= new Ambient(view.map);
      if (ambientMap !== view.map) {
        ambient = new Ambient(view.map);
        ambientMap = view.map;
      }
      ambient.draw(ctx, view.wind, now);

      // Wall draft.
      if (l.mode === "wall") {
        for (const s of l.wall) crayon(ctx, s.p, INK_COLORS[s.c], 7, () => 0.5, 0.85);
        const d = drawingRef.current;
        if (d && d.length >= 4) crayon(ctx, d, INK_COLORS[l.color], 7, () => 0.5, 0.85);
      }

      // Aim guide (hidden while blind).
      if (mePl?.alive && l.mode !== "wall" && !l.blind) {
        if (l.mode === "weapon") {
          let x = mePl.x;
          let y = mePl.y - MUZZLE_Y;
          let { vx, vy } = launchVelocity(l.angle, l.power, l.stats?.speedMul ?? 1);
          ctx.save();
          for (let tick = 1; tick <= 42; tick++) {
            vx += view.wind;
            vy += GRAVITY * (l.stats?.gravityMul ?? 1);
            x += vx;
            y += vy;
            if (tick % 3 === 0) {
              ctx.globalAlpha = 1 - tick / 50;
              ctx.fillStyle = "#ffffff";
              ctx.beginPath();
              ctx.arc(x, y, 4, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = characterFor(view.characters[viewerSeat] ?? viewerSeat).dark;
              ctx.beginPath();
              ctx.arc(x, y, 2.6, 0, Math.PI * 2);
              ctx.fill();
            }
          }
          ctx.restore();
        }
        drawAimArrow(ctx, mePl.x, mePl.y - MUZZLE_Y, l.angle, l.mode === "weapon" ? l.power : 30, characterFor(view.characters[viewerSeat] ?? viewerSeat).base, now);
      }

      // Projectiles.
      for (const pr of view.projectiles) {
        if (!pr.shape) continue;
        drawProjectile(ctx, pr.shape, pr.element, pr.x, pr.y, pr.c, pr.s);
        if (Math.random() < 0.7) fx.trail(pr.x, pr.y, pr.element, INK_COLORS[pr.ink] ?? INK_COLORS[0]);
      }
      fx.draw(ctx);
      for (let i = bolts.length - 1; i >= 0; i--) {
        const t = now - bolts[i].start;
        if (t > 900) {
          bolts.splice(i, 1);
          continue;
        }
        const path = bolts[i].path;
        for (let k = 2; k < path.length; k += 2) drawBolt(ctx, path[k - 2], path[k - 1], path[k], path[k + 1], 1 - t / 900);
      }
      for (let i = popups.length - 1; i >= 0; i--) {
        const pp = popups[i];
        const t = now - pp.start;
        if (t > 1500) {
          popups.splice(i, 1);
          continue;
        }
        if (pp.kind === "dmg") drawDamageNumber(ctx, pp.text, pp.x, pp.y, t, pp.crit);
        else drawComicText(ctx, pp.text, pp.x, pp.y, t, pp.color, pp.crit ? 34 : 26);
      }
      ctx.restore();
      if (fx.flash > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${fx.flash})`;
        ctx.fillRect(0, 0, WORLD_W, WORLD_H);
      }
      if (l.blind && mePl?.alive) {
        // 🕶️ Blind: darkness everywhere except a small circle around me.
        const g = ctx.createRadialGradient(mePl.x, mePl.y - 30, 60, mePl.x, mePl.y - 30, 260);
        g.addColorStop(0, "rgba(15, 23, 42, 0)");
        g.addColorStop(1, "rgba(15, 23, 42, 0.88)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, WORLD_W, WORLD_H);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [viewerSeat, names]);

  // --- Pointer on the arena: drag to aim (release fires) / draw walls ---
  function toWorld(e: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const rect = e.currentTarget.getBoundingClientRect();
    return [Math.round(((e.clientX - rect.left) / rect.width) * WORLD_W), Math.round(((e.clientY - rect.top) / rect.height) * WORLD_H)];
  }
  function aimFrom(x: number, y: number) {
    const v = getViewRef.current(performance.now());
    const p = v?.players[viewerSeat];
    if (!p) return;
    const dx = x - p.x;
    const dy = p.y - MUZZLE_Y - y;
    setAngle(Math.max(0, Math.min(180, Math.round((Math.atan2(Math.max(0, dy), dx) * 180) / Math.PI))));
    setPower(Math.round(Math.max(10, Math.min(100, Math.sqrt(dx * dx + dy * dy) / 2.6))));
  }
  const view0 = hud;
  const wallError = (() => {
    if (mode !== "wall" || wall.length === 0 || !view0) return null;
    return wallPlacementError({ players: view0.players, terrain: view0.terrain }, viewerSeat, wall);
  })();

  const rankings = hud && hud.phase === "gameOver" ? computeRankings(hud) : [];
  const fanfare = useRef(false);
  useEffect(() => {
    if (hud?.phase === "gameOver" && !fanfare.current) {
      fanfare.current = true;
      playVictorySound();
    }
  }, [hud?.phase]);

  const holdBtn = (k: keyof RtInput, label: string) => (
    <button
      type="button"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setKey(k, true);
      }}
      onPointerUp={() => setKey(k, false)}
      onPointerCancel={() => setKey(k, false)}
      onContextMenu={(e) => e.preventDefault()}
      className="h-11 min-w-0 flex-1 touch-none select-none rounded-xl border-2 border-white/20 bg-white/10 text-lg font-bold text-white active:scale-95 active:bg-amber-500/40 light:border-slate-300 light:bg-white light:text-slate-700"
    >
      {label}
    </button>
  );

  const rules = hud?.rules ?? DEFAULT_RT_RULES;
  const playing = !!me?.alive && hud?.phase === "playing";
  const timeLeft = rules.matchMs - (hud?.timeMs ?? 0);
  const mapInfo = MAPS[hud?.map ?? "meadow"];

  return (
    <div className="flex flex-col gap-2.5">
      {/* HUD */}
      <div className="flex flex-wrap items-center gap-2">
        {(hud?.players ?? []).map((p) => {
          const char = hud?.characters[p.seat] ?? p.seat;
          const sts = activeStatuses(p.status);
          return (
            <div key={p.seat} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${p.seat === viewerSeat ? "border-amber-400 bg-amber-400/15 light:bg-amber-50" : "border-white/10 light:border-slate-200"} ${p.alive ? "" : "opacity-40 line-through"}`}>
              <span className="-my-1 -ml-1.5 rounded-full p-0.5" style={{ background: characterFor(char).light }}>
                <CharacterAvatar char={char} size={26} dead={!p.alive} />
              </span>
              <span className="max-w-[7rem] truncate font-semibold text-white light:text-slate-800">
                {names[p.seat]}
                {p.seat === viewerSeat ? " (나)" : ""}
              </span>
              <span className="font-mono text-white/70 light:text-slate-600">♥{p.hp}</span>
              {sts.length > 0 && <span title={sts.map((s) => STATUS_INFO[s].name).join(", ")}>{sts.map((s) => STATUS_INFO[s].emoji).join("")}</span>}
              {!connectedSeats.has(p.seat) && <span title="연결 끊김">📡</span>}
            </div>
          );
        })}
        <span className="ml-auto flex flex-wrap items-center justify-end gap-2 text-xs">
          <span className="rounded-full border border-white/15 px-2.5 py-1 text-white/70 light:border-slate-300 light:text-slate-600">
            {mapInfo.emoji} {mapInfo.name}
          </span>
          <span className={`rounded-full border px-2.5 py-1 font-mono font-bold ${timeLeft < 30_000 ? "border-rose-400 text-rose-400" : "border-white/15 text-white/80 light:border-slate-300 light:text-slate-700"}`}>⏱ {fmtTime(timeLeft)}</span>
          <span className="rounded-full border border-white/15 px-2.5 py-1 text-white/70 light:border-slate-300 light:text-slate-600">
            🌬️ {blind ? "???" : `${(hud?.wind ?? 0) > 0 ? "→" : (hud?.wind ?? 0) < 0 ? "←" : "·"} ${Math.round(Math.abs(hud?.wind ?? 0) * 100)}`}
          </span>
        </span>
      </div>

      {/* Arena on top, then the pad | buttons side by side right under it (no scrolling to draw/move/fire), tools last. */}
      <div
        className={
          playing
            ? "grid grid-cols-[38%_minmax(0,1fr)] gap-2 [grid-template-areas:'arena_arena'_'pad_ctrl'_'tools_tools'] sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-3"
            : "grid [grid-template-areas:'arena']"
        }
      >
      <div className="relative self-start [grid-area:arena]">
        <canvas
          ref={canvasRef}
          onPointerDown={(e) => {
            if (!me?.alive) return;
            const [x, y] = toWorld(e);
            e.currentTarget.setPointerCapture(e.pointerId);
            if (mode === "wall") {
              if (wall.length >= MAX_STROKES) return;
              drawingRef.current = [Math.max(0, Math.min(WORLD_W, x)), Math.max(0, Math.min(WORLD_H, y))];
              return;
            }
            aimingRef.current = true;
            aimFrom(x, y);
          }}
          onPointerMove={(e) => {
            const [x, y] = toWorld(e);
            const pts = drawingRef.current;
            if (pts && mode === "wall") {
              const lx = pts[pts.length - 2];
              const ly = pts[pts.length - 1];
              const cx = Math.max(0, Math.min(WORLD_W, x));
              const cy = Math.max(0, Math.min(WORLD_H, y));
              if ((cx - lx) ** 2 + (cy - ly) ** 2 < 16 || pts.length >= MAX_POINTS_PER_STROKE * 2) return;
              if (totalInk(wall) + strokeInk({ c: color, p: [...pts, cx, cy] }) > myInk) return;
              pts.push(cx, cy);
              return;
            }
            if (aimingRef.current) aimFrom(x, y);
          }}
          onPointerUp={() => {
            const pts = drawingRef.current;
            drawingRef.current = null;
            if (pts && mode === "wall") {
              setWall((w) => [...w, { c: color, p: pts.length === 2 ? [...pts, pts[0], pts[1]] : pts }]);
              return;
            }
            if (aimingRef.current) {
              aimingRef.current = false;
              // Slingshot: letting go fires the loaded doodle (or raises the shield).
              window.setTimeout(() => fireRef.current(), 0);
            }
          }}
          onPointerCancel={() => {
            drawingRef.current = null;
            aimingRef.current = false;
          }}
          className="block aspect-[16/9] w-full touch-none select-none rounded-2xl shadow-[0_10px_30px_-8px_rgba(60,40,10,0.45)] ring-1 ring-black/10"
          style={{ cursor: mode === "wall" ? "crosshair" : "pointer" }}
        />
        {me && !me.alive && hud?.phase === "playing" && (
          <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-slate-900/75 px-3 py-1 text-xs text-white">💀 탈락 — 남은 싸움을 관전 중</div>
        )}
        {stunned && me?.alive && (
          <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-amber-500/90 px-3 py-1 text-xs font-bold text-white">{(me.status.stun ?? 0) > 0 ? "💫 기절!" : "❄️ 꽁꽁 얼었어요!"}</div>
        )}
        {hud?.phase === "gameOver" && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-slate-900/55 p-3">
            <div className="w-full max-w-xs rounded-2xl border-2 border-slate-700 bg-[#fffdf6] p-4 text-center text-slate-800 shadow-xl">
              <div className="flex justify-center gap-1">
                {rankings
                  .filter((r) => r.rank === 1)
                  .map((r) => (
                    <span key={r.seat} className="animate-[inkwin_0.9s_ease-in-out_infinite_alternate]">
                      <CharacterAvatar char={hud.characters[r.seat] ?? r.seat} size={64} />
                    </span>
                  ))}
              </div>
              <p className="text-2xl">🏆</p>
              <p className="mt-1 text-lg font-bold">
                {rankings
                  .filter((r) => r.rank === 1)
                  .map((r) => names[r.seat])
                  .join(", ")}{" "}
                승리!
              </p>
              <ol className="mt-3 space-y-1 text-left text-sm">
                {rankings.map((r) => (
                  <li key={r.seat} className="flex justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                      <b className="w-6">{r.rank}위</b>
                      <CharacterAvatar char={hud.characters[r.seat] ?? r.seat} size={22} dead={r.rank > 1} />
                      {names[r.seat]}
                    </span>
                    <span className="text-xs text-slate-500">가한 피해 {hud.players[r.seat]?.damageDealt ?? 0}</span>
                  </li>
                ))}
              </ol>
              <button onClick={onGameEnd} className="mt-4 w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500">
                결과 확인
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Controls: the pad and the buttons sit side by side right under the arena. */}
      {playing && (
        <div className="flex min-w-0 flex-col gap-1.5 [grid-area:pad]">
          {mode === "wall" ? (
            <div className="flex aspect-square w-full items-center justify-center rounded-lg border-2 border-dashed border-sky-400/50 p-2 text-center text-[11px] text-white/60 light:text-slate-500">
              🧱 경기장 위 내 주변(파란 영역)에 직접 선을 그은 뒤 🧱 버튼으로 세워요.
            </div>
          ) : (
            <WeaponPad strokes={mode === "shield" ? shield : weapon} color={color} budget={RT_INK_MAX} onChange={mode === "shield" ? setShield : setWeapon} onScribble={playScribbleTick} />
          )}
        </div>
      )}
      {playing && me && (
        <div className="flex min-w-0 flex-col gap-1.5 [grid-area:ctrl]">
          <div className="flex items-center gap-1.5">
            {holdBtn("left", "◀")}
            {holdBtn("right", "▶")}
            {holdBtn("jump", "⤒")}
          </div>
          <button
            disabled={!ready || (mode === "wall" && !!wallError)}
            onClick={fire}
            className="h-11 w-full rounded-xl bg-rose-600 text-sm font-bold text-white transition hover:bg-rose-500 disabled:opacity-40"
          >
            {mode === "weapon" ? "🚀 발사" : mode === "shield" ? "🛡️ 방패" : "🧱 벽 세우기"}
          </button>
          <div className="flex items-center gap-1.5 text-[11px] text-white/60 light:text-slate-500">
            🖋️
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
              <div className="h-full rounded-full bg-sky-400 transition-[width] duration-150" style={{ width: `${(myInk / RT_INK_MAX) * 100}%` }} />
            </div>
            <span className="w-8 text-right font-mono">{Math.floor(myInk)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-white/60 light:text-slate-500">
            ⏳
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
              <div className="h-full rounded-full bg-amber-400" style={{ width: `${(1 - (me.cooldownMs ?? 0) / rules.cooldownMs) * 100}%` }} />
            </div>
            <span className="w-8 text-right font-mono">{cost > 0 ? `−${Math.ceil(cost)}` : ""}</span>
          </div>
          {mode !== "wall" && (
            <label className="flex items-center gap-1.5 text-[11px] text-white/70 light:text-slate-600">
              <span className="w-6 shrink-0">각도</span>
              <input type="range" min={0} max={180} value={angle} onChange={(e) => setAngle(Number(e.target.value))} className="min-w-0 flex-1 accent-amber-500" style={{ direction: "rtl" }} />
              <span className="w-8 text-right font-mono">{angle}°</span>
            </label>
          )}
          {mode === "weapon" && (
            <label className="flex items-center gap-1.5 text-[11px] text-white/70 light:text-slate-600">
              <span className="w-6 shrink-0">힘</span>
              <input type="range" min={10} max={100} value={power} onChange={(e) => setPower(Number(e.target.value))} className="min-w-0 flex-1 accent-amber-500" />
              <span className="w-8 text-right font-mono">{power}</span>
            </label>
          )}
          {cost > myInk + 0.5 && <p className="text-[10px] font-semibold text-rose-400">잉크 충전 중 ({Math.floor(myInk)}/{Math.ceil(cost)})</p>}
          {wallError && <p className="text-[10px] font-semibold text-rose-400">⚠️ {wallError}</p>}
        </div>
      )}
      {playing && (
        <div className="flex min-w-0 flex-col gap-2 [grid-area:tools]">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex rounded-full border border-white/15 p-0.5 light:border-slate-300">
              {(
                [
                  ["weapon", "⚔️ 무기"],
                  ["shield", "🛡️ 방패"],
                  ["wall", "🧱 벽"],
                ] as const
              ).map(([m, label]) => (
                <button key={m} onClick={() => setMode(m)} className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${mode === m ? "bg-amber-500 text-white" : "text-white/60 hover:text-white light:text-slate-600"}`}>
                  {label}
                </button>
              ))}
            </div>
            <InkPalette color={color} onChange={setColor} />
            <div className="ml-auto flex gap-1.5">
              <button onClick={() => (mode === "weapon" ? setWeapon : mode === "shield" ? setShield : setWall)((s) => s.slice(0, -1))} className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-white/70 light:border-slate-300 light:text-slate-600">
                ↶
              </button>
              <button onClick={() => (mode === "weapon" ? setWeapon : mode === "shield" ? setShield : setWall)([])} className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-white/70 light:border-slate-300 light:text-slate-600">
                🗑
              </button>
            </div>
          </div>
          {mode === "weapon" && stats && <WeaponCard stats={stats} compact />}
          {mode === "weapon" && !stats && <p className="text-[11px] text-white/50 light:text-slate-500">✏️ 공책에 무기를 그려 장전하세요 — 모양마다 다른 무기, 그린 무기는 계속 다시 쏠 수 있어요.</p>}
          {mode === "shield" && <p className="text-[11px] text-white/60 light:text-slate-500">🛡️ 그린 모양이 6초 동안 방패로 서요 (받는 피해 −40%). 경기장을 드래그해 방향을 정하세요.</p>}
          <p className="hidden text-[10px] text-white/40 sm:block light:text-slate-400">←/→·A/D 이동 · ↑/W/스페이스 점프 · 경기장 드래그 후 놓으면 발사 · F/Enter 발사</p>
        </div>
      )}
    </div>
      <style>{`@keyframes inkwin { from { transform: translateY(0) rotate(-4deg) } to { transform: translateY(-6px) rotate(4deg) } }`}</style>
      <div aria-hidden className="h-16 sm:hidden" />
    </div>
  );
}

export type { CommandBody };
