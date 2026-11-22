"use client";

import { useEffect, useRef } from "react";
import { bulletSprite, cloudSprite, drawEnemy, drawEngines, drawSprite, itemSprite, planeShadow, planeSprite, rgba, shotSprite, SHOT_KIND, type Ctx } from "./art";
import { ENEMIES, GRAZE_R, H, INVULN_MS, PILOTS, REVIVE_MS, REVIVE_R, SEAT_SYMBOLS, W, type PilotId } from "./data";
import type { SnapBuffer } from "./net";
import {
  activeZones,
  beaming,
  CARPET_ROWS,
  CARPET_ROW_MS,
  carpetRowY,
  charging,
  dronePos,
  fireVolley,
  FIRE_INTERVAL,
  flying,
  inZone,
  invulnerable,
  movePlane,
  ramming,
  vortexing,
  type Bullet,
  type GameEvent,
  type PlayerState,
} from "./sim";

/**
 * 구름 편대 하늘 캔버스 (룰북 §10·§11).
 *
 * 매 프레임: ① 내 기체를 내 입력으로 직접 움직이고(손님도 즉시 반응) ② 스냅샷 적탄을 "지금"
 * 위치로 이어 그리며 ③ 탄 지우는 구역(방패·레이저 등)에 든 탄은 숨기고 ④ **내 판정점에 닿은 탄은
 * 내 기기가 맞았다고 보고**한다(`onReport`). 다른 기체·적은 100ms 늦게 보간해서 부드럽게.
 * 아군 탄은 각 기체의 발사 규칙(`fireVolley`)으로 그리는 장식 — 피해 계산은 방장이 따로 한다.
 */

export interface LocalControls {
  mx: number;
  my: number;
  focus: boolean;
  /** 터치 드래그로 아직 덜 움직인 거리 (손가락이 움직인 만큼 따라가되 기체 속도 한도 안에서) */
  dragX: number;
  dragY: number;
}

export interface SkyProps {
  buf: SnapBuffer;
  mySeat: number;
  /** 내 기체 (화면 쪽 사본) — Board가 스킬 예측을 여기 적는다 */
  selfRef: React.MutableRefObject<PlayerState | null>;
  controls: React.MutableRefObject<LocalControls>;
  fresh: { events: GameEvent[]; seq: number };
  /** 내 위치·맞음·스침 보고 (Board가 묶어 보낸다) */
  onReport: (r: { x: number; y: number; hit: boolean; grazes: number }) => void;
  names: Record<number, string>;
  low: boolean;
  reduceMotion: boolean;
}

interface Particle {
  k: "spark" | "debris" | "smoke" | "ring" | "flash" | "text" | "bolt" | "boom";
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  life: number;
  c: string;
  s: number;
  txt?: string;
  pts?: number[];
}

interface FxShot {
  pilot: PilotId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  until: number;
  homing: boolean;
  pierce: boolean;
}

const STAGE_LOOK = [
  { top: "#2f6fb4", mid: "#5f9fd8", bot: "#a9d3f2", tint: "day" as const, far: 0.2, near: 0.45 },
  { top: "#141a2b", mid: "#263149", bot: "#3c4a66", tint: "storm" as const, far: 0.34, near: 0.6 },
  { top: "#2a1a4a", mid: "#5b3a7e", bot: "#d58fae", tint: "dusk" as const, far: 0.26, near: 0.5 },
];

/** 배경 구름 배치 (결정적) */
function layout(n: number, seed: number, h: number) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, () => ({ x: r() * (W + 120) - 60, y: r() * h, v: Math.floor(r() * 6), sc: 0.6 + r() * 0.9 }));
}
const FAR = layout(14, 7, 1400);
const NEAR = layout(9, 31, 1600);
const ISLES = layout(6, 99, 2000);

export default function Sky({ buf, mySeat, selfRef, controls, fresh, onReport, names, low, reduceMotion }: SkyProps) {
  const cvRef = useRef<HTMLCanvasElement | null>(null);
  const parts = useRef<Particle[]>([]);
  const shots = useRef<FxShot[]>([]);
  const fireAcc = useRef<number[]>([0, 0, 0, 0]);
  const shake = useRef(0);
  const flashScreen = useRef<{ c: string; until: number; dur: number } | null>(null);
  const lightning = useRef(0);
  const hidden = useRef(new Set<number>());
  const grazed = useRef(new Set<number>());
  const lastHit = useRef(-99999);
  const propsRef = useRef({ buf, mySeat, onReport, names, low, reduceMotion });
  useEffect(() => {
    propsRef.current = { buf, mySeat, onReport, names, low, reduceMotion };
  }, [buf, mySeat, onReport, names, low, reduceMotion]);

  // 이벤트 → 효과
  useEffect(() => {
    const P = parts.current;
    const big = (x: number, y: number, scale: number, c = "#ffb547") => {
      P.push({ k: "flash", x, y, vx: 0, vy: 0, t: 0, life: 0.25, c: "#ffffff", s: 30 * scale });
      P.push({ k: "boom", x, y, vx: 0, vy: 0, t: 0, life: 0.55, c, s: 26 * scale });
      P.push({ k: "ring", x, y, vx: 0, vy: 0, t: 0, life: 0.5, c: "#ffe2a8", s: 46 * scale });
      const n = Math.round((low ? 8 : 16) * scale);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = (80 + Math.random() * 200) * Math.min(1.6, scale);
        P.push({ k: i % 3 === 0 ? "debris" : "spark", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.5 + Math.random() * 0.5, c: i % 2 ? c : "#ffffff", s: 1.5 + Math.random() * 2.5 });
      }
      for (let i = 0; i < (low ? 2 : 5) * Math.min(2, scale); i++) P.push({ k: "smoke", x: x + (Math.random() - 0.5) * 20, y: y + (Math.random() - 0.5) * 20, vx: (Math.random() - 0.5) * 20, vy: 30, t: 0, life: 1 + Math.random() * 0.6, c: "#3a4256", s: 10 + Math.random() * 12 * scale });
    };
    const txt = (x: number, y: number, s: string, c: string) => P.push({ k: "text", x, y, vx: 0, vy: -30, t: 0, life: 1.1, c, s: 13, txt: s });
    for (const e of fresh.events) {
      switch (e.k) {
        case "kill": {
          const info = ENEMIES[e.kind];
          big(e.x, e.y, info.r / 16);
          if (info.score >= 500) txt(e.x, e.y - 10, `+${info.score}`, "#ffe27a");
          if (e.kind === "frigate") shake.current = Math.max(shake.current, 0.5);
          break;
        }
        case "bossDown":
          for (let i = 0; i < 7; i++) setTimeout(() => big(e.x + (Math.random() - 0.5) * 120, e.y + (Math.random() - 0.5) * 100, 2.2), i * 140);
          setTimeout(() => big(e.x, e.y, 5, "#ffffff"), 1000);
          shake.current = 1.2;
          flashScreen.current = { c: "#ffffff", until: performance.now() + 900, dur: 900 };
          break;
        case "hit":
          if (e.s === mySeat) {
            shake.current = Math.max(shake.current, 0.45);
            flashScreen.current = { c: "#ff3b5c", until: performance.now() + 260, dur: 260 };
          }
          break;
        case "down": {
          const p = buf.latest()?.players[e.s];
          if (p) big(p.x, p.y, 1.4, "#ff6b4a");
          break;
        }
        case "revive": {
          const p = buf.latest()?.players[e.s];
          if (p) {
            P.push({ k: "ring", x: p.x, y: p.y, vx: 0, vy: 0, t: 0, life: 0.6, c: "#7ef0a0", s: 60 });
            txt(p.x, p.y - 26, "부활!", "#7ef0a0");
          }
          break;
        }
        case "phase": {
          const p = buf.latest()?.players[e.s];
          if (p) txt(p.x, p.y - 24, "스침!", PILOTS.shadow.color);
          break;
        }
        case "item": {
          const p = buf.latest()?.players[e.s];
          if (p) txt(p.x, p.y - 22, e.kind === "power" ? "POWER UP" : e.kind === "heal" ? "+1 ❤" : "+300", e.kind === "power" ? "#ffcf3a" : e.kind === "heal" ? "#ff8fa6" : "#ffe27a");
          break;
        }
        case "chain":
          P.push({ k: "bolt", x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 0.5, c: PILOTS.bolt.color, s: 3, pts: e.pts });
          flashScreen.current = { c: "#c8b0ff", until: performance.now() + 300, dur: 300 };
          for (let i = 2; i + 1 < e.pts.length; i += 2) big(e.pts[i], e.pts[i + 1], 0.8, "#c8b0ff");
          break;
        case "ult":
          shake.current = Math.max(shake.current, 0.3);
          if (e.pilot === "firefly") flashScreen.current = { c: "#fff1b0", until: performance.now() + 700, dur: 700 };
          break;
        case "lane":
          if (STAGE_LOOK[buf.latest()?.stage ?? 0]) lightning.current = performance.now();
          break;
        case "stage":
        case "continue":
          hidden.current.clear();
          grazed.current.clear();
          break;
      }
    }
  }, [fresh, buf, mySeat, low]);

  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const g = cv.getContext("2d");
    if (!g) return;
    let raf = 0;
    let last = performance.now();
    let lastReport = 0;
    let pendingGraze = 0;
    let pendingHit = false;
    const scratch: Bullet[] = [];
    const fit = () => {
      const r = cv.getBoundingClientRect();
      const d = Math.min(propsRef.current.low ? 1.25 : 2, window.devicePixelRatio || 1);
      cv.width = Math.max(1, Math.round(r.width * d));
      cv.height = Math.max(1, Math.round(r.height * d));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(cv);

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { buf, mySeat, onReport, names, low, reduceMotion } = propsRef.current;
      const snap = buf.latest();
      if (!snap) return;
      const t = buf.simNow(now);
      const look = STAGE_LOOK[snap.stage] ?? STAGE_LOOK[0];
      const play = snap.phase === "play";

      /* ── 내 기체 ── */
      const server = snap.players[mySeat];
      let me = selfRef.current;
      if (server && (!me || me.pilot !== server.pilot || me.st !== server.st || snap.phase === "pick" || snap.phase === "gameOver" || (snap.phase === "intro" && t - (snap.phaseEnd - 3200) < 250))) {
        me = { ...server, stats: { ...server.stats } };
        selfRef.current = me;
      }
      if (me && server) {
        // 방장이 정하는 값은 따라간다 (위치·대시·돌진 예측은 내 것 유지)
        const keep = { x: me.x, y: me.y, dashUntil: me.dashUntil, dashX: me.dashX, dashY: me.dashY, ramStart: me.ramStart, ramX: me.ramX, ramY0: me.ramY0 };
        Object.assign(me, server, keep);
        if (server.dashUntil > me.dashUntil) Object.assign(me, { dashUntil: server.dashUntil, dashX: server.dashX, dashY: server.dashY });
        if (server.ramStart > me.ramStart + 300) Object.assign(me, { ramStart: server.ramStart, ramX: server.ramX, ramY0: server.ramY0 });
        if (server.st === "down") {
          me.x = server.x;
          me.y = server.y;
        } else if (snap.phase !== "pick") {
          const c = controls.current;
          const dl = Math.hypot(c.dragX, c.dragY);
          if (dl > 0.5 && me.pilot && !ramming(me, t) && t >= me.dashUntil) {
            // 드래그: 기체 속도의 1.5배까지만 따라간다 (조종사 속도 차이 유지)
            const lim = PILOTS[me.pilot].speed * (c.focus ? 0.6 : 1.5) * dt;
            const k = Math.min(1, lim / dl);
            const mx = c.dragX * k;
            const my = c.dragY * k;
            c.dragX -= mx;
            c.dragY -= my;
            me.x = Math.max(12, Math.min(W - 12, me.x + mx));
            me.y = Math.max(30, Math.min(H - 16, me.y + my));
            if (me.x <= 12 || me.x >= W - 12) c.dragX = 0;
            if (me.y <= 30 || me.y >= H - 16) c.dragY = 0;
          } else movePlane(me, c.mx, c.my, c.focus, dt, t);
        }
      }
      const posOf = (seat: number) => {
        if (seat === mySeat && me) return { x: me.x, y: me.y };
        return buf.player(seat, now) ?? snap.players[seat];
      };

      /* ── 적탄 (지금 위치) + 지우는 구역 ── */
      const bullets = buf.bulletsAt(now, scratch);
      const zones = activeZones(snap, t, posOf);
      const hid = hidden.current;
      for (const b of bullets) if (zones.some((z) => inZone(z, b.x, b.y))) hid.add(b.id);
      if (hid.size > 3000) hid.clear();

      /* ── 내 판정 ── */
      if (me && play && flying(me) && !invulnerable(me, t) && now - lastHit.current > INVULN_MS) {
        const r = PILOTS[me.pilot!].hitR;
        let hit = false;
        for (const b of bullets) {
          if (hid.has(b.id)) continue;
          const d2 = (b.x - me.x) ** 2 + (b.y - me.y) ** 2;
          if (d2 < (b.r * 0.8 + r) ** 2) {
            hit = true;
            hid.add(b.id);
            break;
          }
          if (d2 < GRAZE_R * GRAZE_R && !grazed.current.has(b.id)) {
            grazed.current.add(b.id);
            pendingGraze++;
            if (!low) parts.current.push({ k: "spark", x: (b.x + me.x) / 2, y: (b.y + me.y) / 2, vx: (Math.random() - 0.5) * 60, vy: -40, t: 0, life: 0.3, c: "#ffffff", s: 1.4 });
          }
        }
        if (!hit) for (const l of snap.lanes) if (t >= l.fireAt && t < l.until && Math.abs(me.x - l.x) < l.w / 2 - 2) hit = true;
        if (hit) {
          lastHit.current = now;
          pendingHit = true;
        }
        if (grazed.current.size > 2000) grazed.current.clear();
      }
      if (me && (now - lastReport > 50 || pendingHit)) {
        lastReport = now;
        onReport({ x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10, hit: pendingHit, grazes: pendingGraze });
        pendingHit = false;
        pendingGraze = 0;
      }

      /* ── 그리기 ── */
      const sx = cv.width / W;
      const sy = cv.height / H;
      g.setTransform(sx, 0, 0, sy, 0, 0);
      g.save();
      if (shake.current > 0 && !reduceMotion) g.translate((Math.random() - 0.5) * 10 * shake.current, (Math.random() - 0.5) * 10 * shake.current);
      shake.current = Math.max(0, shake.current - dt * 2.2);
      drawBackground(g, snap.stage, t, look, low, now - lightning.current);

      // 네이팜 불길
      for (const q of snap.patches) {
        if (q.until <= t) continue;
        const k = (q.until - t) / 1300;
        const gr = g.createRadialGradient(q.x, q.y, 2, q.x, q.y, 24);
        gr.addColorStop(0, `rgba(255,236,150,${0.85 * k})`);
        gr.addColorStop(0.5, `rgba(255,120,40,${0.55 * k})`);
        gr.addColorStop(1, "rgba(255,60,20,0)");
        g.fillStyle = gr;
        g.beginPath();
        g.arc(q.x, q.y, 24, 0, Math.PI * 2);
        g.fill();
      }

      // 번개 줄기 (예고 → 발사)
      for (const l of snap.lanes) {
        if (t < l.fireAt) {
          const k = 1 - (l.fireAt - t) / 900;
          g.fillStyle = `rgba(127,216,255,${0.08 + 0.12 * k})`;
          g.fillRect(l.x - l.w / 2, 0, l.w, H);
          g.strokeStyle = `rgba(200,240,255,${0.4 + 0.5 * Math.sin(now * 0.03) ** 2})`;
          g.setLineDash([8, 6]);
          g.lineWidth = 1.5;
          g.strokeRect(l.x - l.w / 2, -2, l.w, H + 4);
          g.setLineDash([]);
          g.fillStyle = "#e8f8ff";
          g.font = "bold 12px system-ui, sans-serif";
          g.textAlign = "center";
          g.fillText("⚡", l.x, H - 30);
        } else if (t < l.until) {
          g.save();
          g.globalCompositeOperation = "lighter";
          const gr = g.createLinearGradient(l.x - l.w / 2, 0, l.x + l.w / 2, 0);
          gr.addColorStop(0, "rgba(127,216,255,0)");
          gr.addColorStop(0.3, "rgba(127,216,255,.75)");
          gr.addColorStop(0.5, "rgba(255,255,255,.95)");
          gr.addColorStop(0.7, "rgba(127,216,255,.75)");
          gr.addColorStop(1, "rgba(127,216,255,0)");
          g.fillStyle = gr;
          g.fillRect(l.x - l.w / 2, 0, l.w, H);
          g.strokeStyle = "rgba(255,255,255,.9)";
          g.lineWidth = 2;
          g.beginPath();
          for (let y = 0; y <= H; y += 24) g.lineTo(l.x + (Math.random() - 0.5) * l.w * 0.5, y);
          g.stroke();
          g.restore();
        }
      }

      // 아이템
      for (const it of buf.items(now)) {
        const bob = Math.sin(now * 0.006 + it.id) * 1.5;
        drawSprite(g, itemSprite(it.kind), it.x, it.y + bob, 1, it.kind === "star" ? now * 0.003 : 0);
      }

      // 기체 그림자 (구름 위에 비친)
      for (const p of snap.players) {
        if (!p.pilot || p.st !== "fly") continue;
        const pos = posOf(p.seat);
        drawSprite(g, planeShadow(p.pilot), pos.x + 14, pos.y + 22, 0.82, 0, 0.18);
      }

      // 적
      const enemies = buf.enemies(now);
      const aimFrom = (x: number, y: number) => {
        let best = { x: W / 2, y: H };
        let bd = Infinity;
        for (const p of snap.players) {
          if (p.st !== "fly" || !p.pilot) continue;
          const q = posOf(p.seat);
          const d = (q.x - x) ** 2 + (q.y - y) ** 2;
          if (d < bd) {
            bd = d;
            best = q;
          }
        }
        return Math.atan2(best.y - y, best.x - x);
      };
      for (const e of enemies) {
        const flash = Math.max(0, 1 - (t - e.hitAt) / 90);
        const desc = (e.ty - e.y0) / 150;
        const chargingL = e.kind === "lancer" && e.age / 1000 >= desc && e.age / 1000 < desc + 0.85;
        drawEnemy(g, e.kind, e.rx, e.ry, now, aimFrom(e.rx, e.ry), flash * 0.8, e.hp / e.max, chargingL);
        const info = ENEMIES[e.kind];
        if (!info.boss && !info.mid && e.max >= 50 && e.hp < e.max) {
          g.fillStyle = "rgba(0,0,0,.5)";
          g.fillRect(e.rx - 16, e.ry - info.r - 8, 32, 3);
          g.fillStyle = "#ff8f9a";
          g.fillRect(e.rx - 16, e.ry - info.r - 8, 32 * (e.hp / e.max), 3);
        }
      }

      // 아군 탄 (장식)
      const S = shots.current;
      for (const p of snap.players) {
        if (!p.pilot || !flying(p) || !play || ramming(p, t) || vortexing(p, t) || charging(p, t)) continue;
        const pos = posOf(p.seat);
        fireAcc.current[p.seat] += dt * 1000;
        const iv = FIRE_INTERVAL[p.pilot];
        if (fireAcc.current[p.seat] > iv * 4) fireAcc.current[p.seat] = iv;
        while (fireAcc.current[p.seat] >= iv) {
          fireAcc.current[p.seat] -= iv;
          if (low && p.seat !== mySeat && Math.random() < 0.5) continue;
          for (const v of fireVolley(p.pilot, p.power, pos.x, pos.y)) S.push({ pilot: p.pilot, x: v.x, y: v.y, vx: v.vx, vy: v.vy, until: now + v.life * 1000, homing: v.homing, pierce: v.pierce });
        }
        if (t < p.droneUntil && Math.floor(now / 200) !== Math.floor((now - dt * 1000) / 200)) {
          const d = dronePos({ ...p, x: pos.x, y: pos.y }, t);
          S.push({ pilot: "firefly", x: d.x, y: d.y, vx: 0, vy: -620, until: now + 1500, homing: true, pierce: false });
        }
      }
      if (S.length > 500) S.splice(0, S.length - 500);
      g.save();
      g.globalCompositeOperation = "lighter";
      for (let i = S.length - 1; i >= 0; i--) {
        const s = S[i];
        if (s.homing) {
          let best: { rx: number; ry: number } | null = null;
          let bd = Infinity;
          for (const e of enemies) {
            const d = (e.rx - s.x) ** 2 + (e.ry - s.y) ** 2;
            if (d < bd && e.ry > -10) {
              bd = d;
              best = e;
            }
          }
          if (best) {
            const dx = best.rx - s.x;
            const dy = best.ry - s.y;
            const d = Math.hypot(dx, dy) || 1;
            s.vx += (dx / d) * 1700 * dt;
            s.vy += (dy / d) * 1700 * dt;
            const v = Math.hypot(s.vx, s.vy) || 1;
            s.vx = (s.vx / v) * 470;
            s.vy = (s.vy / v) * 470;
          }
        }
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        let dead = now > s.until || s.y < -30 || s.y > H + 30 || s.x < -30 || s.x > W + 30;
        if (!dead && !s.pierce)
          for (const e of enemies) {
            const rr = ENEMIES[e.kind].r;
            if ((e.rx - s.x) ** 2 + (e.ry - s.y) ** 2 < rr * rr) {
              dead = true;
              if (!low && Math.random() < 0.35) parts.current.push({ k: "spark", x: s.x, y: s.y, vx: (Math.random() - 0.5) * 120, vy: -60 - Math.random() * 80, t: 0, life: 0.22, c: PILOTS[s.pilot].color, s: 1.6 });
              break;
            }
          }
        if (dead) {
          S.splice(i, 1);
          continue;
        }
        drawSprite(g, shotSprite(s.pilot, s.pilot === "firefly" && s.vy > -600 && s.homing ? "orb" : SHOT_KIND[s.pilot]), s.x, s.y, 1, Math.atan2(s.vy, s.vx) + Math.PI / 2);
      }
      g.restore();

      // 기체 + 스킬 효과
      for (const p of snap.players) {
        if (!p.pilot) continue;
        const pos = posOf(p.seat);
        drawPilot(g, p.seat === mySeat && me ? me : p, pos.x, pos.y, t, now, p.seat === mySeat, snap.players);
        // 이름표
        if (p.seat !== mySeat || p.st === "down") {
          g.font = "bold 10px system-ui, sans-serif";
          g.textAlign = "center";
          g.fillStyle = "rgba(6,12,24,.6)";
          const label = `${SEAT_SYMBOLS[p.seat]} ${(names[p.seat] ?? "").slice(0, 8)}`;
          const w = g.measureText(label).width + 8;
          g.fillRect(pos.x - w / 2, pos.y + 24, w, 13);
          g.fillStyle = PILOTS[p.pilot].color;
          g.fillText(label, pos.x, pos.y + 34);
        }
      }

      // 적탄 (맨 위 — 언제나 잘 보이게)
      for (const b of bullets) {
        if (hid.has(b.id)) continue;
        if (b.k === 2) drawSprite(g, bulletSprite(2), b.x, b.y, 1, Math.atan2(b.vy, b.vx) + Math.PI / 2);
        else drawSprite(g, bulletSprite(b.k), b.x, b.y);
      }

      // 내 판정점 (정밀 비행 중엔 크게)
      if (me && flying(me) && play) {
        const r = PILOTS[me.pilot!].hitR;
        g.fillStyle = "#ffffff";
        g.strokeStyle = "#ff3b5c";
        g.lineWidth = 1.4;
        g.beginPath();
        g.arc(me.x, me.y, me.focus ? r + 1 : r * 0.8, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        if (me.focus) {
          g.strokeStyle = "rgba(255,255,255,.35)";
          g.setLineDash([3, 3]);
          g.beginPath();
          g.arc(me.x, me.y, GRAZE_R, 0, Math.PI * 2);
          g.stroke();
          g.setLineDash([]);
        }
      }

      drawParticles(g, parts.current, dt);

      // 시간 감속
      if (t < snap.slowUntil) {
        const k = Math.min(1, (snap.slowUntil - t) / 400);
        g.fillStyle = `rgba(110,120,190,${0.16 * k})`;
        g.fillRect(0, 0, W, H);
        g.strokeStyle = `rgba(255,111,177,${0.8 * k})`;
        g.lineWidth = 3;
        g.beginPath();
        g.arc(W - 26, 60, 13, -Math.PI / 2, -Math.PI / 2 + ((snap.slowUntil - t) / 4000) * Math.PI * 2);
        g.stroke();
      }
      g.restore();

      // 화면 번쩍
      const fl = flashScreen.current;
      if (fl && now < fl.until) {
        g.fillStyle = rgba(fl.c, ((fl.until - now) / fl.dur) * 0.4);
        g.fillRect(0, 0, W, H);
      }
      // 가장자리 어둡게
      const vg = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.75);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(4,8,20,.38)");
      g.fillStyle = vg;
      g.fillRect(0, 0, W, H);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [selfRef, controls]);

  return <canvas ref={cvRef} className="block h-full w-full" aria-label="구름 편대 하늘" />;
}

/* ── 배경 ───────────────────────────────────────────────────────────── */

function drawBackground(g: Ctx, stage: number, t: number, look: (typeof STAGE_LOOK)[number], low: boolean, sinceLightning: number) {
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, look.top);
  gr.addColorStop(0.55, look.mid);
  gr.addColorStop(1, look.bot);
  g.fillStyle = gr;
  g.fillRect(-20, -20, W + 40, H + 40);
  const sec = t / 1000;

  if (stage === 0) {
    // 구름 사이로 보이는 바다 물결
    g.strokeStyle = "rgba(255,255,255,.08)";
    g.lineWidth = 1;
    const off = (sec * 22) % 40;
    for (let y = -40 + off; y < H; y += 40) {
      g.beginPath();
      for (let x = 0; x <= W; x += 20) g.lineTo(x, y + Math.sin(x * 0.05 + y) * 3);
      g.stroke();
    }
    // 햇빛
    const sun = g.createRadialGradient(W * 0.8, -40, 10, W * 0.8, -40, 360);
    sun.addColorStop(0, "rgba(255,240,200,.45)");
    sun.addColorStop(1, "rgba(255,240,200,0)");
    g.fillStyle = sun;
    g.fillRect(0, 0, W, H);
  } else if (stage === 1) {
    // 협곡 벽
    const off = (sec * 70) % 1400;
    for (const side of [-1, 1]) {
      g.fillStyle = side < 0 ? "#1b2030" : "#171b29";
      g.beginPath();
      const bx = side < 0 ? 0 : W;
      g.moveTo(bx, -20);
      for (let y = -20; y <= H + 20; y += 20) {
        const yy = y - off;
        const w = 26 + Math.sin(yy * 0.012) * 18 + Math.sin(yy * 0.041) * 8;
        g.lineTo(bx - side * w, y);
      }
      g.lineTo(bx, H + 20);
      g.closePath();
      g.fill();
      g.strokeStyle = "rgba(120,140,180,.25)";
      g.lineWidth = 1.2;
      g.stroke();
    }
    // 비
    if (!low) {
      g.strokeStyle = "rgba(180,200,240,.18)";
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i < 46; i++) {
        const x = (i * 97.3 + sec * 40) % (W + 40) - 20;
        const y = (i * 53.7 + sec * 620) % (H + 40) - 20;
        g.moveTo(x, y);
        g.lineTo(x - 4, y + 16);
      }
      g.stroke();
    }
    // 번개 섬광
    if (sinceLightning < 260) {
      g.fillStyle = `rgba(200,230,255,${0.22 * (1 - sinceLightning / 260)})`;
      g.fillRect(0, 0, W, H);
    }
  } else {
    // 떠 있는 섬 폐허
    for (const is of ISLES) {
      const y = ((is.y + sec * 40) % 2000) - 200;
      if (y < -160 || y > H + 160) continue;
      const s = is.sc;
      g.save();
      g.translate(is.x, y);
      g.scale(s, s);
      g.fillStyle = "#3a2a54";
      g.beginPath();
      g.moveTo(-50, 0);
      g.lineTo(50, 0);
      g.lineTo(20, 60);
      g.lineTo(-10, 80);
      g.lineTo(-30, 40);
      g.closePath();
      g.fill();
      g.fillStyle = "#6b5a8e";
      g.beginPath();
      g.ellipse(0, 0, 52, 14, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#8a7aaa";
      for (let i = -2; i <= 2; i++) g.fillRect(i * 16 - 3, -14, 6, 12);
      g.restore();
    }
    // 오로라
    const a = g.createLinearGradient(0, 0, W, 0);
    a.addColorStop(0, "rgba(120,255,200,0)");
    a.addColorStop(0.5, `rgba(160,140,255,${0.08 + 0.04 * Math.sin(sec)})`);
    a.addColorStop(1, "rgba(255,140,200,0)");
    g.fillStyle = a;
    g.fillRect(0, 0, W, H * 0.6);
  }

  // 먼 구름 층 (느리게) · 가까운 구름 층 (빠르게)
  for (const c of FAR) {
    const y = ((c.y + sec * 35) % 1400) - 120;
    if (y < -80 || y > H + 80) continue;
    drawSprite(g, cloudSprite(c.v, look.tint), c.x, y, c.sc * 0.7, 0, look.far);
  }
  if (!low || stage !== 1)
    for (const c of NEAR) {
      const y = ((c.y + sec * 95) % 1600) - 140;
      if (y < -100 || y > H + 100) continue;
      drawSprite(g, cloudSprite(c.v, look.tint), c.x, y, c.sc * 1.15, 0, look.near);
    }
}

/* ── 기체 + 스킬 효과 ───────────────────────────────────────────────── */

function drawPilot(g: Ctx, p: PlayerState, x: number, y: number, t: number, now: number, mine: boolean, all: PlayerState[]) {
  const P = PILOTS[p.pilot!];
  if (p.st === "down") {
    // 낙하산
    const sway = Math.sin(now * 0.003 + p.seat) * 6;
    g.save();
    g.translate(x + sway, y);
    g.strokeStyle = "rgba(255,255,255,.7)";
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(-14, -18);
    g.lineTo(0, 2);
    g.lineTo(14, -18);
    g.stroke();
    const ch = g.createLinearGradient(-18, 0, 18, 0);
    ch.addColorStop(0, P.dark);
    ch.addColorStop(0.5, P.color);
    ch.addColorStop(1, P.dark);
    g.fillStyle = ch;
    g.beginPath();
    g.ellipse(0, -20, 18, 9, 0, Math.PI, 0);
    g.fill();
    g.fillStyle = "#f2c9a5";
    g.beginPath();
    g.arc(0, 4, 3.5, 0, Math.PI * 2);
    g.fill();
    g.restore();
    // 부활 원
    const k = p.revive / REVIVE_MS;
    g.strokeStyle = "rgba(126,240,160,.35)";
    g.setLineDash([4, 4]);
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(x, y, REVIVE_R, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    if (k > 0) {
      g.strokeStyle = "#7ef0a0";
      g.lineWidth = 3;
      g.beginPath();
      g.arc(x, y, REVIVE_R, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = "#e9f6ff";
    g.font = "bold 10px system-ui, sans-serif";
    g.textAlign = "center";
    g.fillText("SOS · 곁에 머물러 구해 주세요", x, y - 40);
    return;
  }
  const inv = t < p.invulnUntil;
  const blink = inv && Math.floor(now / 70) % 2 === 0 ? 0.45 : 1;
  const stealth = t < p.stealthUntil ? 0.3 + Math.sin(now * 0.02) * 0.06 : 1;
  const alpha = blink * stealth;

  // 대시·돌진 잔상
  if (t < p.dashUntil || ramming(p, t)) {
    for (let i = 1; i <= 4; i++) {
      const dx = ramming(p, t) ? 0 : -p.dashX * i * 10;
      const dy = ramming(p, t) ? i * 14 : -p.dashY * i * 10;
      drawSprite(g, planeSprite(p.pilot!), x + dx, y + dy, 1, 0, 0.22 * (1 - i / 5));
    }
  }
  // 충전 중 빛
  if (charging(p, t)) {
    const k = 1 - (p.chargeAt - t) / 600;
    g.save();
    g.globalCompositeOperation = "lighter";
    const gr = g.createRadialGradient(x, y - 38, 0, x, y - 38, 6 + k * 16);
    gr.addColorStop(0, "rgba(255,255,255,.95)");
    gr.addColorStop(0.4, rgba(P.color, 0.8));
    gr.addColorStop(1, rgba(P.color, 0));
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y - 38, 6 + k * 16, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  // 레이저
  if (beaming(p, t)) {
    g.save();
    g.globalCompositeOperation = "lighter";
    const w = 20 + Math.sin(now * 0.08) * 3;
    const gr = g.createLinearGradient(x - w, 0, x + w, 0);
    gr.addColorStop(0, rgba(P.color, 0));
    gr.addColorStop(0.3, rgba(P.color, 0.8));
    gr.addColorStop(0.5, "rgba(255,255,255,1)");
    gr.addColorStop(0.7, rgba(P.color, 0.8));
    gr.addColorStop(1, rgba(P.color, 0));
    g.fillStyle = gr;
    g.fillRect(x - w, -10, w * 2, y - 26);
    g.strokeStyle = "rgba(255,255,255,.8)";
    g.lineWidth = 1.2;
    g.beginPath();
    for (let yy = y - 30; yy > 0; yy -= 18) g.lineTo(x + (Math.random() - 0.5) * w, yy);
    g.stroke();
    g.restore();
  }
  // 소용돌이
  if (vortexing(p, t)) {
    g.save();
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < 5; i++) {
      const r = 30 + i * 36 - ((now * 0.12) % 36);
      g.strokeStyle = rgba(P.color, 0.15 + i * 0.07);
      g.lineWidth = 2.4;
      g.beginPath();
      g.arc(x, y, Math.max(6, r), now * 0.008 + i, now * 0.008 + i + 4);
      g.stroke();
    }
    g.restore();
  }
  // 신호탄
  if (p.flareAt > 0 && t - p.flareAt < 1200) {
    const k = (t - p.flareAt) / 1200;
    g.save();
    g.globalCompositeOperation = "lighter";
    const gr = g.createRadialGradient(x, y, 0, x, y, 40 + k * 420);
    gr.addColorStop(0, `rgba(255,245,200,${0.5 * (1 - k)})`);
    gr.addColorStop(1, "rgba(255,224,138,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    g.fillStyle = `rgba(255,240,170,${1 - k})`;
    g.beginPath();
    g.arc(x, y - k * 360, 5, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  // 융단 폭격
  if (p.carpetStart > 0) {
    const r = (t - p.carpetStart) / CARPET_ROW_MS;
    for (let i = 0; i < CARPET_ROWS; i++) {
      const age = r - i;
      if (age < 0 || age > 3) continue;
      const k = age / 3;
      const yy = carpetRowY(i);
      for (let j = 0; j < 6; j++) {
        const xx = 30 + j * 60 + Math.sin(i * 7 + j) * 10;
        const rad = 10 + k * 30;
        const gr = g.createRadialGradient(xx, yy, 0, xx, yy, rad);
        gr.addColorStop(0, `rgba(255,250,220,${1 - k})`);
        gr.addColorStop(0.4, `rgba(255,170,70,${0.9 * (1 - k)})`);
        gr.addColorStop(1, "rgba(255,80,30,0)");
        g.fillStyle = gr;
        g.beginPath();
        g.arc(xx, yy, rad, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  // 합동 궁극기 오라
  if (t < p.comboUntil) {
    g.strokeStyle = `rgba(255,226,122,${0.5 + 0.4 * Math.sin(now * 0.02)})`;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(x, y, 30, 0, Math.PI * 2);
    g.stroke();
  }

  drawEngines(g, p.pilot!, x, y, now, t < p.dashUntil || ramming(p, t) ? 2 : p.focus ? 0.6 : 1, alpha);
  drawSprite(g, planeSprite(p.pilot!), x, y, mine ? 1 : 0.92, 0, alpha);

  // 방패
  if (t < p.shieldUntil) {
    const k = Math.min(1, (p.shieldUntil - t) / 400);
    g.save();
    g.globalCompositeOperation = "lighter";
    g.strokeStyle = `rgba(230,240,255,${0.65 * k})`;
    g.lineWidth = 6;
    g.beginPath();
    g.arc(x, y, 38, Math.PI * 1.08, Math.PI * 1.92);
    g.stroke();
    g.strokeStyle = rgba(P.color, 0.9 * k);
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(x, y, 44, Math.PI * 1.08, Math.PI * 1.92);
    g.stroke();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI * 1.1 + (i / 5) * Math.PI * 0.8;
      g.fillStyle = `rgba(255,255,255,${0.5 * k})`;
      g.fillRect(x + Math.cos(a) * 38 - 1, y + Math.sin(a) * 38 - 1, 2, 2);
    }
    g.restore();
  }
  // 드론
  if (t < p.droneUntil) {
    const d = dronePos({ ...p, x, y }, t);
    const gr = g.createRadialGradient(d.x, d.y, 0, d.x, d.y, 9);
    gr.addColorStop(0, "#ffffff");
    gr.addColorStop(0.4, PILOTS.firefly.color);
    gr.addColorStop(1, rgba(PILOTS.firefly.color, 0));
    g.fillStyle = gr;
    g.beginPath();
    g.arc(d.x, d.y, 9, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(255,255,255,.6)";
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(d.x, d.y, 9, 2.5, now * 0.05, 0, Math.PI * 2);
    g.stroke();
  }
  void all;
}

/* ── 파티클 ─────────────────────────────────────────────────────────── */

function drawParticles(g: Ctx, P: Particle[], dt: number) {
  for (let i = P.length - 1; i >= 0; i--) {
    const q = P[i];
    q.t += dt;
    if (q.t >= q.life) {
      P.splice(i, 1);
      continue;
    }
    const k = q.t / q.life;
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    if (q.k === "spark" || q.k === "debris") {
      q.vx *= 0.93;
      q.vy *= 0.93;
    }
    g.save();
    switch (q.k) {
      case "spark":
        g.globalCompositeOperation = "lighter";
        g.fillStyle = rgba(q.c.startsWith("#") ? q.c : "#ffffff", 1 - k);
        g.fillRect(q.x - q.s / 2, q.y - q.s / 2, q.s, q.s);
        break;
      case "debris":
        g.fillStyle = `rgba(40,46,60,${1 - k})`;
        g.translate(q.x, q.y);
        g.rotate(q.t * 12);
        g.fillRect(-q.s, -q.s / 2, q.s * 2, q.s);
        break;
      case "smoke":
        g.fillStyle = rgba(q.c, 0.35 * (1 - k));
        g.beginPath();
        g.arc(q.x, q.y, q.s * (1 + k), 0, Math.PI * 2);
        g.fill();
        break;
      case "boom": {
        g.globalCompositeOperation = "lighter";
        const r = q.s * (0.4 + k);
        const gr = g.createRadialGradient(q.x, q.y, 0, q.x, q.y, r);
        gr.addColorStop(0, `rgba(255,250,230,${1 - k})`);
        gr.addColorStop(0.35, rgba(q.c, 0.85 * (1 - k)));
        gr.addColorStop(1, "rgba(255,60,30,0)");
        g.fillStyle = gr;
        g.beginPath();
        g.arc(q.x, q.y, r, 0, Math.PI * 2);
        g.fill();
        break;
      }
      case "flash":
        g.globalCompositeOperation = "lighter";
        g.fillStyle = `rgba(255,255,255,${0.8 * (1 - k)})`;
        g.beginPath();
        g.arc(q.x, q.y, q.s * (0.5 + k * 0.5), 0, Math.PI * 2);
        g.fill();
        break;
      case "ring":
        g.strokeStyle = rgba(q.c, 1 - k);
        g.lineWidth = 2.5 * (1 - k) + 0.5;
        g.beginPath();
        g.arc(q.x, q.y, q.s * k, 0, Math.PI * 2);
        g.stroke();
        break;
      case "text":
        g.globalAlpha = 1 - k * k;
        g.font = `900 ${q.s}px system-ui, sans-serif`;
        g.textAlign = "center";
        g.lineWidth = 3;
        g.strokeStyle = "rgba(6,12,28,.85)";
        g.strokeText(q.txt ?? "", q.x, q.y);
        g.fillStyle = q.c;
        g.fillText(q.txt ?? "", q.x, q.y);
        break;
      case "bolt": {
        const pts = q.pts ?? [];
        g.globalCompositeOperation = "lighter";
        g.strokeStyle = `rgba(240,230,255,${1 - k})`;
        g.lineWidth = 2.6;
        g.shadowColor = q.c;
        g.shadowBlur = 10;
        g.beginPath();
        g.moveTo(pts[0], pts[1]);
        for (let i2 = 2; i2 + 1 < pts.length; i2 += 2) {
          const x0 = pts[i2 - 2];
          const y0 = pts[i2 - 1];
          const x1 = pts[i2];
          const y1 = pts[i2 + 1];
          for (let s = 1; s <= 5; s++) g.lineTo(x0 + ((x1 - x0) * s) / 5 + (s < 5 ? (Math.random() - 0.5) * 18 : 0), y0 + ((y1 - y0) * s) / 5 + (s < 5 ? (Math.random() - 0.5) * 18 : 0));
        }
        g.stroke();
        break;
      }
    }
    g.restore();
  }
  if (P.length > 700) P.splice(0, P.length - 700);
}
