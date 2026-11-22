"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { COLLAPSE_WARN_H, ITEM_INFO, LANE_MAX, LANE_MIN, ROCK_WARN_MS, SEAT_COLORS, SEAT_SYMBOLS } from "./data";
import { buildTower, platAngle } from "./tower";
import { followSeat, type SceneShared } from "./view";

/**
 * 2D 보기 (WebGL이 없거나 고른 사람): 탑 둘레를 펼친 옆모습. 가로 = 기둥 둘레 각도(따라가는 사람이 가운데),
 * 세로 = 높이. 발판은 종류마다 색 + 무늬(금 간 = 톱니, 트램펄린 = ⬆, 움직이는 = ↔, 왕관 = 👑)로 그리고,
 * 기둥에 가까운 안쪽 줄 발판은 조금 어둡게 그린다. 붕괴 먼지와 경고선, 낙석 경고, 아이템도 같이.
 * 입력 방향은 3D와 같다: ←→ = 탑 둘레, ↑↓ = 기둥 쪽/바깥쪽.
 */

const KIND_FILL: Record<string, string> = { base: "#a99882", stone: "#b9ab98", crumbly: "#a0754d", bouncy: "#3fbf6a", moving: "#7aa6d6", crown: "#f4c542" };
const R_UNWRAP = 4.4;

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export default function Tower2D({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const view = { ang: 0, y: 0, init: false };
    let last = performance.now();
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvas.current;
      const sh = shared.current;
      const snap = sh.buf.latest();
      if (!c || !snap) return;
      const nowWall = performance.now();
      const dt = Math.min(0.05, (nowWall - last) / 1000);
      last = nowWall;
      const now = sh.buf.simNow(nowWall);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = c.clientWidth;
      const H = c.clientHeight;
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
        c.width = Math.round(W * dpr);
        c.height = Math.round(H * dpr);
      }
      const g = c.getContext("2d");
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const tower = buildTower(snap.towerSeed);
      const seat = followSeat(snap, sh.mySeat);
      sh.follow = seat;
      const fp = seat === sh.mySeat ? sh.buf.ahead(seat, nowWall) : sh.buf.body(seat, nowWall);
      const wantAng = fp ? Math.atan2(fp.z, fp.x) : 0;
      const wantY = fp ? fp.y : 0;
      if (!view.init) {
        view.ang = wantAng;
        view.y = wantY;
        view.init = true;
      }
      view.ang = wrap(view.ang + wrap(wantAng - view.ang) * (1 - Math.exp(-dt * 4)));
      view.y += (wantY - view.y) * (1 - Math.exp(-dt * 4));
      sh.camAngle = view.ang;
      // 1m당 픽셀: 세로 15m가 보이게
      const ppm = Math.max(16, Math.min(W / 22, H / 15));
      const cx = W / 2;
      const cy = H * 0.62;
      const toX = (a: number) => cx - wrap(a - view.ang) * R_UNWRAP * ppm;
      const toY = (y: number) => cy - (y - view.y) * ppm;
      // 하늘
      const sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#3b2a6b");
      sky.addColorStop(0.6, "#d9677a");
      sky.addColorStop(1, "#f5c08a");
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);
      // 높이 눈금
      g.fillStyle = "rgba(255,255,255,0.35)";
      g.font = "10px sans-serif";
      for (let y = Math.floor(view.y - 12); y < view.y + 12; y++) {
        if (y % 5 !== 0 || y < 0) continue;
        const py = toY(y);
        g.fillRect(0, py, 10, 1);
        g.fillText(`${y}m`, 12, py + 3);
      }
      // 발판
      for (const p of tower.platforms) {
        const gone = snap.gone[p.i] !== 0;
        const broke = snap.broke[p.i] !== 0;
        if (gone || broke) continue;
        const py = toY(p.y);
        if (py < -30 || py > H + 30) continue;
        if (p.kind === "base") {
          g.fillStyle = KIND_FILL.base;
          g.fillRect(0, py, W, 0.5 * ppm);
          continue;
        }
        const a = platAngle(p, now);
        const px = toX(a);
        const half = (p.r / p.rad) * R_UNWRAP * ppm;
        const depth = (p.rad - LANE_MIN) / (LANE_MAX - LANE_MIN);
        g.globalAlpha = 0.6 + depth * 0.4;
        g.fillStyle = (snap.icyUntil[p.i] ?? 0) > now ? "#cdefff" : KIND_FILL[p.kind];
        const shake = snap.crumbleAt[p.i] > 0 ? Math.sin(now * 0.08 + p.i) * 2 : 0;
        g.fillRect(px - half + shake, py, half * 2, 0.32 * ppm);
        g.globalAlpha = 1;
        if (p.y < snap.collapseY + COLLAPSE_WARN_H) {
          g.strokeStyle = "#ef4444";
          g.lineWidth = 2;
          g.strokeRect(px - half, py, half * 2, 0.32 * ppm);
        }
        g.fillStyle = "rgba(0,0,0,0.7)";
        g.font = `${Math.round(ppm * 0.5)}px sans-serif`;
        g.textAlign = "center";
        if (p.kind === "crumbly") {
          g.strokeStyle = "rgba(45,25,10,0.9)";
          g.lineWidth = 1.5;
          g.beginPath();
          for (let k = 0; k <= 6; k++) g.lineTo(px - half + (half * 2 * k) / 6, py + (k % 2 ? 0.3 : 0.05) * ppm);
          g.stroke();
        } else if (p.kind === "bouncy") g.fillText("⬆", px, py - 2);
        else if (p.kind === "moving") g.fillText("↔", px, py - 2);
        else if (p.kind === "crown") g.fillText("👑", px, py - 4);
      }
      // 아이템
      for (const it of snap.items) {
        const p = tower.platforms[it.plat];
        g.font = `${Math.round(ppm * 0.7)}px sans-serif`;
        g.textAlign = "center";
        g.fillText(ITEM_INFO[it.kind].emoji, toX(platAngle(p, now)), toY(p.y) - ppm * 0.4);
      }
      // 낙석 경고
      for (const r of snap.rocks) {
        const px = toX(Math.atan2(r.z, r.x));
        const py = toY(r.y);
        const u = Math.max(0, Math.min(1, 1 - (r.at - now) / ROCK_WARN_MS));
        g.strokeStyle = "#ef4444";
        g.lineWidth = 2;
        g.beginPath();
        g.arc(px, py, ppm * 0.6, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = "#78716c";
        g.beginPath();
        g.arc(px, py - (1 - u) * 8 * ppm, ppm * 0.4, 0, Math.PI * 2);
        g.fill();
      }
      // 사람
      for (const p of snap.players) {
        if (p.status === "out") continue;
        const b = p.seat === sh.mySeat ? sh.buf.ahead(p.seat, nowWall) : sh.buf.body(p.seat, nowWall);
        if (!b) continue;
        const px = toX(Math.atan2(b.z, b.x));
        const py = toY(b.y);
        const rad = Math.hypot(b.x, b.z);
        const size = ppm * (0.45 + ((rad - LANE_MIN) / (LANE_MAX - LANE_MIN)) * 0.15);
        g.fillStyle = SEAT_COLORS[p.seat % 6];
        g.beginPath();
        g.arc(px, py - size, size, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = p.seat === sh.mySeat ? "#ffffff" : "rgba(0,0,0,0.6)";
        g.lineWidth = p.seat === sh.mySeat ? 3 : 1.5;
        g.stroke();
        g.fillStyle = "#ffffff";
        g.font = `bold ${Math.round(size * 1.1)}px sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(SEAT_SYMBOLS[p.seat % 6], px, py - size);
        g.textBaseline = "alphabetic";
      }
      // 붕괴 먼지
      const cyl = toY(snap.collapseY);
      if (cyl < H) {
        g.fillStyle = "rgba(58,46,38,0.88)";
        g.fillRect(0, cyl, W, H - cyl);
      }
      const warnY = toY(snap.collapseY + COLLAPSE_WARN_H);
      g.setLineDash([8, 6]);
      g.strokeStyle = "rgba(239,68,68,0.9)";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, warnY);
      g.lineTo(W, warnY);
      g.stroke();
      g.setLineDash([]);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [shared]);
  return <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-label="탑 옆모습 (2D)" />;
}
