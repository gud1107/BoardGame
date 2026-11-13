"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { BODY_R, CRACK_1, CRACK_2, ITEM_INFO, SEAT_COLORS, SEAT_SYMBOLS, THAW_WARN_MS } from "./data";
import { HEX, lakeGeo, sectorAngle } from "./lake";
import type { SceneShared } from "./three/LakeScene";

/**
 * 2D 위에서 본 화면 — WebGL이 없거나 "2D 보기"를 고른 기기용 (룰북 §11).
 * 3D와 같은 스냅샷 버퍼를 읽어 캔버스에 그린다. 이름표는 보드의 DOM 이름표를 그대로 쓴다.
 * 색만으로 알리지 않는다: 금 1단계 = 가는 선, 2단계 = 굵은 X, 경보 구역 = 빗금 + ☀, 서든데스 = !
 */
export default function Lake2D({ shared }: { shared: MutableRefObject<SceneShared> }) {
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
      g.fillStyle = "#0d3a5c";
      g.fillRect(0, 0, w, h);
      const geo = lakeGeo(snap.rings);
      const scale = Math.min(w, h) / (geo.radius * 2.35);
      const ox = w / 2;
      const oy = h / 2;
      const X = (x: number) => ox + x * scale;
      const Y = (z: number) => oy + z * scale;
      const now = performance.now();
      const t = sh.buf.simNow(now);
      const warned = snap.thaw?.sector ?? -1;
      const left = snap.thaw ? Math.max(0, (snap.thaw.at - t) / THAW_WARN_MS) : 0;
      // 칸
      for (let i = 0; i < geo.tiles.length; i++) {
        const tile = geo.tiles[i];
        if (snap.broke[i] !== 0) continue;
        const hp = snap.hp[i] ?? 1;
        const doom = snap.doom[i] ?? 0;
        const l = Math.round(42 + hp * 50);
        let color = `hsl(205, 70%, ${l}%)`;
        let jitter = 0;
        if (doom > 0) {
          color = Math.sin(t * 0.03) > 0 ? "#e05263" : "#b23a4c";
          jitter = Math.sin(t * 0.07 + i) * 1.5;
        }
        g.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = Math.PI / 2 + (k * Math.PI) / 3;
          const px = X(tile.x + Math.cos(a) * HEX * 0.95) + jitter;
          const py = Y(tile.z + Math.sin(a) * HEX * 0.95);
          if (k === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
        g.fillStyle = color;
        g.fill();
        if (tile.sector === warned && warned >= 0) {
          // 경보 구역: 주황 + 빗금
          g.save();
          g.clip();
          g.fillStyle = `rgba(255,160,70,${0.3 + 0.25 * (0.5 + 0.5 * Math.sin(t * (0.012 + (1 - left) * 0.02)))})`;
          g.fillRect(X(tile.x) - HEX * scale, Y(tile.z) - HEX * scale, HEX * 2 * scale, HEX * 2 * scale);
          g.strokeStyle = "rgba(255,240,220,0.55)";
          g.lineWidth = 1.5;
          for (let d = -2; d <= 2; d++) {
            g.beginPath();
            g.moveTo(X(tile.x) + d * 6 - 12, Y(tile.z) - 12);
            g.lineTo(X(tile.x) + d * 6 + 12, Y(tile.z) + 12);
            g.stroke();
          }
          g.restore();
        }
        // 금 표시
        const cx = X(tile.x);
        const cy = Y(tile.z);
        const r = HEX * scale * 0.45;
        g.strokeStyle = "rgba(10,30,60,0.75)";
        if (hp < CRACK_1 && hp >= CRACK_2) {
          g.lineWidth = 1.2;
          g.beginPath();
          g.moveTo(cx - r, cy - r * 0.3);
          g.lineTo(cx, cy + r * 0.2);
          g.lineTo(cx + r * 0.8, cy - r * 0.5);
          g.stroke();
        } else if (hp < CRACK_2) {
          g.lineWidth = 2.4;
          g.beginPath();
          g.moveTo(cx - r, cy - r);
          g.lineTo(cx + r, cy + r);
          g.moveTo(cx + r, cy - r);
          g.lineTo(cx - r, cy + r);
          g.stroke();
        }
        if (doom > 0) {
          g.fillStyle = "#ffffff";
          g.font = `bold ${Math.round(scale * 0.8)}px sans-serif`;
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillText("!", cx, cy);
        }
      }
      // 구역 번호
      for (let k = 0; k < 6; k++) {
        const a = sectorAngle(k);
        const px = X(Math.cos(a) * (geo.radius + 0.9));
        const py = Y(Math.sin(a) * (geo.radius + 0.9));
        g.beginPath();
        g.arc(px, py, Math.max(10, scale * 0.6), 0, Math.PI * 2);
        g.fillStyle = k === warned ? "#ff9a3c" : "rgba(12,30,52,0.85)";
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = sh.votes.includes(k) ? "#ffffff" : "#9cc9e8";
        g.stroke();
        g.fillStyle = k === warned ? "#1f1300" : "#eaf6ff";
        g.font = `bold ${Math.max(11, Math.round(scale * 0.7))}px sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(k === warned ? `☀${k + 1}` : String(k + 1), px, py + 1);
      }
      // 아이템
      for (const it of snap.items) {
        g.font = `${Math.round(scale * 0.8)}px sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(ITEM_INFO[it.kind].emoji, X(it.x), Y(it.z));
      }
      // 사람
      for (const p of snap.players) {
        const b = p.seat === sh.mySeat ? sh.buf.ahead(p.seat, now) : sh.buf.body(p.seat, now);
        if (!b) continue;
        if (!p.alive && !(p.falling && b.y > -1.2)) continue;
        const sink = p.falling ? Math.max(0.2, 1 + b.y * 0.4) : 1 + Math.max(0, b.y) * 0.25;
        const r = BODY_R * scale * 1.15 * sink;
        g.beginPath();
        g.arc(X(b.x), Y(b.z), r, 0, Math.PI * 2);
        g.fillStyle = SEAT_COLORS[p.seat % 6];
        g.fill();
        g.lineWidth = snap.t < p.spikesUntil ? 4 : 2;
        g.strokeStyle = snap.t < p.spikesUntil ? "#a3e635" : p.seat === sh.mySeat ? "#ffffff" : "#0f172a";
        g.stroke();
        g.fillStyle = "#ffffff";
        g.font = `bold ${Math.max(9, Math.round(r * 1.1))}px sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(SEAT_SYMBOLS[p.seat % 6], X(b.x), Y(b.z) + 1);
      }
      // 이름표 위치
      for (let seat = 0; seat < sh.labels.length; seat++) {
        const el = sh.labels[seat];
        const p = snap.players[seat];
        if (!el || !p) continue;
        const pos = p.alive ? (seat === sh.mySeat ? sh.buf.ahead(seat, now) : sh.buf.body(seat, now)) : null;
        if (!pos) {
          el.style.display = "none";
          continue;
        }
        el.style.display = "";
        el.style.transform = `translate(${X(pos.x).toFixed(1)}px, ${(Y(pos.z) - BODY_R * scale * 1.3 - 4).toFixed(1)}px) translate(-50%, -100%)`;
      }
      sh.shake = Math.max(0, sh.shake - 0.04);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [shared]);
  return <canvas ref={ref} className="h-full w-full" style={{ touchAction: "none" }} />;
}
