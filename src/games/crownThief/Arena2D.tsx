"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { arenaFor, inBush } from "./arena";
import { BODY_R, CROWN_DROP_MS, ITEM_INFO, SEAT_COLORS, SEAT_SYMBOLS, TEAM_INFO } from "./data";
import { crownOn } from "./sim";
import type { SceneShared } from "./three/ArenaScene";

/**
 * 2D 위에서 본 화면 — WebGL이 없거나 "2D 보기"를 고른 기기용 (룰북 §11).
 * 3D와 같은 스냅샷 버퍼를 읽어 캔버스에 그린다. 이름표는 보드의 DOM 이름표를 그대로 쓴다.
 * 색만으로 알리지 않는다: 자리 = 색 + 기호, 왕 = 👑 + 금 테두리, 무적 = 점선 고리, 팀 = ☀/☾,
 * 기둥 = 회색 원 + 굵은 테두리, 덤불 = 초록 + 점무늬, 점프대 = 청록 + 화살표.
 */
export default function Arena2D({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const cv = ref.current;
      const sh = shared.current;
      const snap = sh.buf.latest();
      if (!cv || !snap) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      const g = cv.getContext("2d");
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = "#8ec5ff";
      g.fillRect(0, 0, w, h);
      const geo = arenaFor(snap.seatCount);
      const scale = Math.min(w, h) / (geo.radius * 2.25);
      const ox = w / 2;
      const oy = h / 2;
      const X = (x: number) => ox + x * scale;
      const Y = (z: number) => oy + z * scale;
      const now = performance.now();
      const t = sh.buf.simNow(now);
      const curse = snap.options.mode === "curse";
      const gold = curse ? "#a855f7" : "#fbbf24";

      // 광장
      g.beginPath();
      g.arc(ox, oy, geo.radius * scale, 0, Math.PI * 2);
      g.fillStyle = "#e9dcc3";
      g.fill();
      g.lineWidth = Math.max(3, scale * 0.3);
      g.strokeStyle = "#d4a017";
      g.stroke();
      for (let r = 2; r < geo.radius; r += 2) {
        g.beginPath();
        g.arc(ox, oy, r * scale, 0, Math.PI * 2);
        g.lineWidth = 1;
        g.strokeStyle = "rgba(120,90,60,0.18)";
        g.stroke();
      }
      // 점프대
      for (const p of geo.pads) {
        g.beginPath();
        g.arc(X(p.x), Y(p.z), p.r * scale, 0, Math.PI * 2);
        g.fillStyle = "#22d3ee";
        g.fill();
        const a = Math.atan2(p.tz - p.z, p.tx - p.x);
        g.save();
        g.translate(X(p.x), Y(p.z));
        g.rotate(a);
        g.fillStyle = "#ecfeff";
        g.beginPath();
        g.moveTo(p.r * scale * 0.6, 0);
        g.lineTo(-p.r * scale * 0.2, p.r * scale * 0.4);
        g.lineTo(-p.r * scale * 0.2, -p.r * scale * 0.4);
        g.closePath();
        g.fill();
        g.restore();
      }
      // 바나나
      for (const tr of snap.traps) {
        g.font = `${Math.round(scale * 0.8)}px sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText("🍌", X(tr.x), Y(tr.z));
      }
      // 아이템
      for (const it of snap.items) {
        g.font = `${Math.round(scale * 0.85)}px sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(ITEM_INFO[it.kind].emoji, X(it.x), Y(it.z));
      }
      // 바닥 왕관 / 첫 낙하 그림자
      const cr = snap.crown;
      if (cr.state === "ground") {
        g.beginPath();
        g.arc(X(cr.x), Y(cr.z), scale * (0.7 + 0.1 * Math.sin(t * 0.008)), 0, Math.PI * 2);
        g.fillStyle = curse ? "rgba(168,85,247,0.35)" : "rgba(251,191,36,0.4)";
        g.fill();
        g.font = `${Math.round(scale * 1.1)}px sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText("👑", X(cr.x), Y(cr.z));
      } else if (cr.state === "pending" && !curse) {
        const left = snap.fightStart + CROWN_DROP_MS - t;
        g.beginPath();
        g.arc(ox, oy, scale * (0.5 + 0.5 * Math.max(0, 1 - left / 4000)), 0, Math.PI * 2);
        g.fillStyle = "rgba(28,25,23,0.3)";
        g.fill();
      }
      // 사람
      for (const p of snap.players) {
        const b = p.seat === sh.mySeat ? sh.buf.ahead(p.seat, now) : sh.buf.body(p.seat, now);
        if (!b) continue;
        if (p.respawnAt > 0 && (p.move !== "fall" || b.y < -2)) continue;
        const air = Math.max(0, b.y);
        const shrink = p.move === "fall" ? Math.max(0.2, 1 + b.y * 0.3) : 1 + air * 0.18;
        const r = BODY_R * scale * 1.15 * shrink;
        const c = crownOn(snap, p);
        const hide = p.seat !== sh.mySeat && !c && p.move === "none" && inBush(geo, b.x, b.z);
        g.globalAlpha = hide ? 0.25 : snap.t < p.ghostUntil ? 0.5 : 1;
        if (c) {
          g.beginPath();
          g.arc(X(b.x), Y(b.z), r + 5, 0, Math.PI * 2);
          g.fillStyle = gold;
          g.fill();
        }
        g.beginPath();
        g.arc(X(b.x), Y(b.z), r, 0, Math.PI * 2);
        g.fillStyle = SEAT_COLORS[p.seat % 8];
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = p.seat === sh.mySeat ? "#ffffff" : "#0f172a";
        g.stroke();
        // 무적: 점선 고리
        if (c === "real" && snap.t < cr.invulnUntil) {
          g.setLineDash([4, 3]);
          g.beginPath();
          g.arc(X(b.x), Y(b.z), r + 9, 0, Math.PI * 2);
          g.strokeStyle = gold;
          g.lineWidth = 2.5;
          g.stroke();
          g.setLineDash([]);
        }
        g.fillStyle = "#ffffff";
        g.font = `bold ${Math.max(9, Math.round(r * 1.1))}px sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(snap.options.mode === "team" ? TEAM_INFO[p.team].symbol : SEAT_SYMBOLS[p.seat % 8], X(b.x), Y(b.z) + 1);
        if (c) {
          g.font = `${Math.round(r * 1.5)}px sans-serif`;
          g.fillText(curse ? "💀" : "👑", X(b.x), Y(b.z) - r - 6);
        }
        g.globalAlpha = 1;
      }
      // 기둥·덤불은 사람 위에 (가림)
      for (const p of geo.pillars) {
        g.beginPath();
        g.arc(X(p.x), Y(p.z), p.r * scale, 0, Math.PI * 2);
        g.fillStyle = "#f5f1e8";
        g.fill();
        g.lineWidth = 3;
        g.strokeStyle = "#78716c";
        g.stroke();
      }
      for (const bsh of geo.bushes) {
        g.beginPath();
        g.arc(X(bsh.x), Y(bsh.z), bsh.r * scale, 0, Math.PI * 2);
        g.fillStyle = "rgba(47,122,59,0.78)";
        g.fill();
        g.fillStyle = "rgba(20,70,30,0.6)";
        for (let k = 0; k < 7; k++) {
          const a = k * 2.4;
          g.beginPath();
          g.arc(X(bsh.x + Math.cos(a) * bsh.r * 0.5), Y(bsh.z + Math.sin(a) * bsh.r * 0.5), scale * 0.12, 0, Math.PI * 2);
          g.fill();
        }
      }
      // 이름표 위치
      for (let seat = 0; seat < sh.labels.length; seat++) {
        const el = sh.labels[seat];
        const p = snap.players[seat];
        if (!el || !p) continue;
        const pos = p.respawnAt === 0 ? (seat === sh.mySeat ? sh.buf.ahead(seat, now) : sh.buf.body(seat, now)) : null;
        if (!pos || (seat !== sh.mySeat && !crownOn(snap, p) && p.move === "none" && inBush(geo, pos.x, pos.z))) {
          el.style.display = "none";
          continue;
        }
        el.style.display = "";
        el.style.transform = `translate(${X(pos.x).toFixed(1)}px, ${(Y(pos.z) - BODY_R * scale * 1.3 - 18).toFixed(1)}px) translate(-50%, -100%)`;
      }
      sh.shake = Math.max(0, sh.shake - 0.04);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [shared]);
  return <canvas ref={ref} className="h-full w-full" style={{ touchAction: "none" }} />;
}
