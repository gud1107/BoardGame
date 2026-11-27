"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { arenaGeo, HEX } from "./arena";
import { BIG_SCALE, BODY_R, ITEM_INFO, POST_R, SEAT_COLORS, SEAT_SYMBOLS, WARN_MS } from "./data";
import type { SceneShared } from "./three/ArenaScene";

/**
 * 2D 위에서 본 화면 — WebGL이 없거나 "2D 보기"를 고른 기기용 (룰북 §11).
 * 3D와 같은 스냅샷 버퍼를 읽어 캔버스에 그린다. 이름표는 보드의 DOM 이름표를 그대로 쓴다.
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
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#5aa9f5");
      grad.addColorStop(1, "#bfe3ff");
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      const geo = arenaGeo(snap.rings);
      const scale = Math.min(w, h) / (geo.radius * 2.15);
      const ox = w / 2;
      const oy = h / 2;
      const X = (x: number) => ox + x * scale;
      const Y = (z: number) => oy + z * scale;
      const now = performance.now();
      const t = sh.buf.simNow(now);
      // 타일
      for (let i = 0; i < geo.tiles.length; i++) {
        const tile = geo.tiles[i];
        const f = snap.tiles[i] ?? 0;
        if (f > 0 && t >= f) continue;
        let color = tile.ring === 0 ? "#f5c542" : (tile.q + tile.r * 2) % 2 === 0 ? "#5fc46a" : "#4fb15e";
        let jitter = 0;
        if (f > 0) {
          const left = (f - t) / WARN_MS;
          const blink = Math.sin(t * (0.012 + (1 - left) * 0.03)) > 0;
          color = blink ? "#ff3b30" : "#c2410c";
          jitter = Math.sin(t * 0.07 + i) * 1.5 * (1 - left);
        }
        g.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = Math.PI / 2 + (k * Math.PI) / 3;
          const px = X(tile.x + Math.cos(a) * HEX * 0.96) + jitter;
          const py = Y(tile.z + Math.sin(a) * HEX * 0.96);
          if (k === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
        g.fillStyle = color;
        g.fill();
        if (f > 0) {
          // 경고 칸엔 ! 표시 (색만으로 알리지 않음)
          g.fillStyle = "#ffffff";
          g.font = `bold ${Math.round(scale * 0.8)}px sans-serif`;
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillText("!", X(tile.x), Y(tile.z));
        }
      }
      // 기둥
      for (const p of snap.posts) {
        g.beginPath();
        g.arc(X(p.x), Y(p.z), POST_R * scale, 0, Math.PI * 2);
        g.fillStyle = "#e11d48";
        g.fill();
        g.lineWidth = 3;
        g.strokeStyle = "#fde047";
        g.stroke();
      }
      // 아이템
      for (const it of snap.items) {
        g.font = `${Math.round(scale * 0.9)}px sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(ITEM_INFO[it.kind].emoji, X(it.x), Y(it.z));
      }
      // 사람
      for (const p of snap.players) {
        const b = p.seat === sh.mySeat ? sh.buf.ahead(p.seat, now) : sh.buf.body(p.seat, now);
        if (!b) continue;
        if (!p.alive && !(p.falling && b.y > -3)) {
          const gh = p.ghost && snap.phase === "fight" ? sh.buf.ghost(p.seat, now) : null;
          if (gh) {
            g.globalAlpha = 0.45;
            g.font = `${Math.round(scale * 0.9)}px sans-serif`;
            g.fillText("👻", X(gh.x), Y(gh.z));
            g.globalAlpha = 1;
          }
          continue;
        }
        const r = BODY_R * (snap.t < p.bigUntil ? BIG_SCALE : 1) * scale * (p.falling ? Math.max(0.2, 1 + b.y * 0.15) : 1 + Math.max(0, b.y) * 0.2);
        g.beginPath();
        g.arc(X(b.x), Y(b.z), r, 0, Math.PI * 2);
        g.fillStyle = SEAT_COLORS[p.seat % 6];
        g.fill();
        g.lineWidth = p.bracing ? 4 : 2;
        g.strokeStyle = p.shield ? "#7dd3fc" : p.seat === sh.mySeat ? "#ffffff" : "#1f2937";
        g.stroke();
        // 방향
        g.beginPath();
        g.moveTo(X(b.x + Math.cos(b.face) * BODY_R * 1.25), Y(b.z + Math.sin(b.face) * BODY_R * 1.25));
        g.lineTo(X(b.x + Math.cos(b.face + 2.6) * BODY_R * 0.8), Y(b.z + Math.sin(b.face + 2.6) * BODY_R * 0.8));
        g.lineTo(X(b.x + Math.cos(b.face - 2.6) * BODY_R * 0.8), Y(b.z + Math.sin(b.face - 2.6) * BODY_R * 0.8));
        g.closePath();
        g.fillStyle = "rgba(255,255,255,0.85)";
        g.fill();
        g.fillStyle = "#ffffff";
        g.font = `bold ${Math.round(r * 0.9)}px sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(SEAT_SYMBOLS[p.seat % 6], X(b.x), Y(b.z) + 1);
      }
      // 이름표 위치 (3D와 같은 DOM 이름표)
      for (let seat = 0; seat < sh.labels.length; seat++) {
        const el = sh.labels[seat];
        const p = snap.players[seat];
        if (!el || !p) continue;
        let pos: { x: number; z: number } | null = null;
        if (p.alive) pos = seat === sh.mySeat ? sh.buf.ahead(seat, now) : sh.buf.body(seat, now);
        else if (p.ghost && snap.phase === "fight") pos = sh.buf.ghost(seat, now);
        if (!pos) {
          el.style.display = "none";
          continue;
        }
        el.style.display = "";
        el.style.transform = `translate(${X(pos.x).toFixed(1)}px, ${(Y(pos.z) - BODY_R * scale - 4).toFixed(1)}px) translate(-50%, -100%)`;
      }
      sh.shake = Math.max(0, sh.shake - 0.04);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [shared]);
  return <canvas ref={ref} className="h-full w-full" style={{ touchAction: "none" }} />;
}
