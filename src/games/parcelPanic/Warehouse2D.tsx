"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { BODY_R, BOX_INFO, DEST_INFO, FORK_HALF, HEAVY_R, ROLE_INFO, SEAT_COLORS, SEAT_SYMBOLS, truckCap } from "./data";
import { layoutOf } from "./sim";
import type { SceneShared } from "./three/WarehouseScene";

/**
 * 2D 위에서 본 창고 — WebGL이 없거나 "2D 보기"를 고른 기기용 (룰북 §11).
 * 3D와 같은 스냅샷 버퍼를 읽어 캔버스에 그린다. 이름표는 보드의 DOM 이름표를 그대로 쓴다.
 * 색만으로 알리지 않는다: 목적지 = 색 + 기호(☀≈♣✦) + 이름, 상자 = 종류 아이콘 + 목적지 기호(❓ = 라벨 없음),
 * 사람 = 자리 색 + 모양, 지게차 길 = 노란 빗금 + 🚜.
 */
export default function Warehouse2D({ shared }: { shared: MutableRefObject<SceneShared> }) {
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
      g.fillStyle = "#1c1f26";
      g.fillRect(0, 0, w, h);
      const L = layoutOf(snap);
      // 위쪽에 트럭 칸을 그릴 자리 (1.8m)
      const scale = Math.min(w / (L.W + 1), h / (L.H + 3));
      const ox = w / 2;
      const oy = h / 2 + scale * 0.9;
      const X = (x: number) => ox + x * scale;
      const Y = (z: number) => oy + z * scale;
      const now = performance.now();
      const simNow = sh.buf.simNow(now);
      const emoji = (e: string, x: number, y: number, size: number) => {
        g.font = `${Math.round(size)}px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(e, x, y);
      };
      const text = (t: string, x: number, y: number, size: number, color = "#ffffff") => {
        g.font = `bold ${Math.max(9, Math.round(size))}px sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillStyle = color;
        g.fillText(t, x, y);
      };

      // 바닥
      g.fillStyle = "#5b6170";
      g.fillRect(X(-L.W / 2), Y(-L.H / 2), L.W * scale, L.H * scale);
      g.strokeStyle = "#2f3340";
      g.lineWidth = 3;
      g.strokeRect(X(-L.W / 2), Y(-L.H / 2), L.W * scale, L.H * scale);
      // 지게차 길
      for (const [i, lz] of L.lanes.entries()) {
        const active = snap.fork && Math.abs(snap.fork.z - lz) < 0.01;
        const warn = active && simNow < (snap.fork?.goAt ?? 0);
        g.fillStyle = active ? (warn && Math.floor(now / 200) % 2 ? "rgba(250,204,21,0.55)" : "rgba(250,204,21,0.35)") : "rgba(250,204,21,0.14)";
        g.fillRect(X(-L.W / 2), Y(lz - FORK_HALF.z), L.W * scale, FORK_HALF.z * 2 * scale);
        void i;
      }
      // 트럭 칸 + 트럭
      const cap = truckCap(snap.seatCount);
      L.docks.forEach((dk, k) => {
        const d = snap.docks[k];
        const info = DEST_INFO[d.dest];
        const z0 = dk.zone;
        g.fillStyle = info.color + "40";
        g.fillRect(X(z0.x0), Y(z0.z0), (z0.x1 - z0.x0) * scale, (z0.z1 - z0.z0) * scale);
        g.strokeStyle = info.color;
        g.lineWidth = 2;
        g.setLineDash([6, 4]);
        g.strokeRect(X(z0.x0), Y(z0.z0), (z0.x1 - z0.x0) * scale, (z0.z1 - z0.z0) * scale);
        g.setLineDash([]);
        // 트럭 (윗벽 너머)
        const here = d.state === "here";
        g.globalAlpha = here ? 1 : 0.35;
        g.fillStyle = info.color;
        g.fillRect(X(dk.x - 1.25), Y(-L.H / 2 - 1.6), 2.5 * scale, 1.5 * scale);
        g.globalAlpha = 1;
        text(`${info.sym} ${info.short}`, X(dk.x), Y(-L.H / 2 - 1.05), scale * 0.42);
        text(here ? `${d.load.length}/${cap}` : d.swapping ? "🔀" : "🚚…", X(dk.x), Y(-L.H / 2 - 0.45), scale * 0.38, "#fef3c7");
      });
      // 스캐너
      const sc = L.scanner;
      g.beginPath();
      g.arc(X(sc.x), Y(sc.z), sc.r * scale, 0, Math.PI * 2);
      g.fillStyle = "rgba(56,189,248,0.35)";
      g.fill();
      g.strokeStyle = "#38bdf8";
      g.lineWidth = 2;
      g.stroke();
      emoji("🔍", X(sc.x), Y(sc.z), scale * 0.8);
      // 선반 · 컨베이어 · 반송구
      for (const r of L.racks) {
        g.fillStyle = "#334155";
        g.fillRect(X(r.x0), Y(r.z0), (r.x1 - r.x0) * scale, (r.z1 - r.z0) * scale);
        g.strokeStyle = "#f97316";
        g.lineWidth = 2;
        g.strokeRect(X(r.x0), Y(r.z0), (r.x1 - r.x0) * scale, (r.z1 - r.z0) * scale);
      }
      const bt = L.belt;
      g.fillStyle = "#111827";
      g.fillRect(X(bt.x0), Y(bt.z - bt.hw), (bt.x1 - bt.x0) * scale, bt.hw * 2 * scale);
      g.fillStyle = "#6b7280";
      const off = (now / 1000) * 0.95;
      for (let x = bt.x0 + (off % 1); x < bt.x1; x += 1) {
        g.beginPath();
        g.moveTo(X(x), Y(bt.z - bt.hw * 0.6));
        g.lineTo(X(x + 0.3), Y(bt.z));
        g.lineTo(X(x), Y(bt.z + bt.hw * 0.6));
        g.lineWidth = 2;
        g.strokeStyle = "#6b7280";
        g.stroke();
      }
      g.fillStyle = "#7f1d1d";
      g.fillRect(X(L.chute.x0), Y(L.chute.z0), (L.chute.x1 - L.chute.x0) * scale, (L.chute.z1 - L.chute.z0) * scale);
      text("반송", X((L.chute.x0 + L.chute.x1) / 2), Y((L.chute.z0 + L.chute.z1) / 2), scale * 0.4, "#fecaca");
      // 상자
      for (const b of snap.boxes) {
        if (b.state === "gone") continue;
        const q = sh.buf.box(b, now, sh.mySeat);
        const size = (b.kind === "heavy" ? HEAVY_R * 1.6 : 0.55) * scale * (1 + q.y * 0.15);
        const x = X(q.x);
        const y = Y(q.z) - q.y * scale * 0.3;
        if (b.state === "air") {
          g.beginPath();
          g.arc(X(q.x), Y(q.z), size * 0.35, 0, Math.PI * 2);
          g.fillStyle = "rgba(0,0,0,0.3)";
          g.fill();
        }
        g.fillStyle = BOX_INFO[b.kind].color;
        g.fillRect(x - size / 2, y - size / 2, size, size);
        g.strokeStyle = b.known ? DEST_INFO[b.dest].color : "#94a3b8";
        g.lineWidth = Math.max(2, size * 0.14);
        g.strokeRect(x - size / 2, y - size / 2, size, size);
        if (b.kind !== "normal") emoji(BOX_INFO[b.kind].emoji, x, y - size * 0.05, size * 0.62);
        text(b.known ? DEST_INFO[b.dest].sym : "❓", x + size * 0.42, y + size * 0.42, size * 0.5, b.known ? DEST_INFO[b.dest].color : "#e2e8f0");
      }
      // 사람
      for (const p of snap.players) {
        const pos = p.seat === sh.mySeat ? sh.buf.ahead(p.seat, now) : sh.buf.body(p.seat, now);
        if (!pos) continue;
        const r = BODY_R * scale * 1.1;
        g.beginPath();
        g.arc(X(pos.x), Y(pos.z), r, 0, Math.PI * 2);
        g.fillStyle = SEAT_COLORS[p.seat % 6];
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = p.seat === sh.mySeat ? "#ffffff" : "#0f172a";
        g.stroke();
        text(SEAT_SYMBOLS[p.seat % 6], X(pos.x), Y(pos.z) + 1, r * 1.1);
        if (p.role !== "none") emoji(ROLE_INFO[p.role].emoji, X(pos.x) - r, Y(pos.z) - r, r * 0.9);
      }
      // 지게차
      if (snap.fork) {
        const f = snap.fork;
        const fx = simNow < f.goAt ? f.x : f.x + f.dir * 3.4 * ((now - (sh.buf.curr?.at ?? now)) / 1000);
        g.fillStyle = "#facc15";
        g.fillRect(X(fx - FORK_HALF.x), Y(f.z - FORK_HALF.z), FORK_HALF.x * 2 * scale, FORK_HALF.z * 2 * scale);
        emoji("🚜", X(fx), Y(f.z), scale * 1.1);
      }
      // 이름표 위치
      for (let seat = 0; seat < sh.labels.length; seat++) {
        const el = sh.labels[seat];
        if (!el) continue;
        const pos = seat === sh.mySeat ? sh.buf.ahead(seat, now) : sh.buf.body(seat, now);
        if (!pos) {
          el.style.display = "none";
          continue;
        }
        el.style.display = "";
        el.style.transform = `translate(${X(pos.x).toFixed(1)}px, ${(Y(pos.z) - BODY_R * scale * 1.3 - 14).toFixed(1)}px) translate(-50%, -100%)`;
      }
      sh.shake = Math.max(0, sh.shake - 0.04);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [shared]);
  return <canvas ref={ref} className="h-full w-full" style={{ touchAction: "none" }} />;
}
