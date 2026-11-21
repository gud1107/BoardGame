"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { hallFor } from "./arena";
import { BASKET_R, BODY_R, SEAT_COLORS, SEAT_SYMBOLS, TEAM_INFO, TOY_INFO } from "./data";
import { bombOf } from "./sim";
import type { SceneShared } from "./three/HallScene";

/**
 * 2D 위에서 본 화면 — WebGL이 없거나 "2D 보기"를 고른 기기용 (룰북 §11).
 * 3D와 같은 스냅샷 버퍼를 읽어 캔버스에 그린다. 이름표는 보드의 DOM 이름표를 그대로 쓴다.
 * 색만으로 알리지 않는다: 자리 = 색 + 기호, 물건 = 아이콘 + 값 숫자, 줄 = 주인 색 선 + 물건 밑 주인 기호,
 * 바구니 = 색 고리 + 기호 + 점수, 💣 = 아이콘, 갓 찜 보호 = 흰 점선 고리.
 */
export default function Hall2D({ shared }: { shared: MutableRefObject<SceneShared> }) {
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
      g.fillStyle = "#2a1f3d";
      g.fillRect(0, 0, w, h);
      const geo = hallFor(snap.seatCount);
      const scale = Math.min(w, h) / (geo.radius * 2.2);
      const ox = w / 2;
      const oy = h / 2;
      const X = (x: number) => ox + x * scale;
      const Y = (z: number) => oy + z * scale;
      const now = performance.now();
      const simNow = sh.buf.simNow(now);
      const team = snap.options.mode === "team";
      const emoji = (e: string, x: number, y: number, size: number) => {
        g.font = `${Math.round(size)}px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(e, x, y);
      };

      // 홀 바닥 + 담
      g.beginPath();
      g.arc(ox, oy, geo.radius * scale, 0, Math.PI * 2);
      g.fillStyle = "#f5e8ff";
      g.fill();
      g.lineWidth = Math.max(3, scale * 0.25);
      g.strokeStyle = "#c084fc";
      g.stroke();
      if (geo.walkway) {
        g.beginPath();
        g.arc(ox, oy, ((geo.walkway.r0 + geo.walkway.r1) / 2) * scale, 0, Math.PI * 2);
        g.lineWidth = (geo.walkway.r1 - geo.walkway.r0) * scale;
        g.strokeStyle = "rgba(51,65,85,0.55)";
        g.stroke();
        // 도는 방향 화살표
        g.fillStyle = "#facc15";
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2 + (now / 1000) * 0.3;
          const rr = ((geo.walkway.r0 + geo.walkway.r1) / 2) * scale;
          g.save();
          g.translate(ox + Math.cos(a) * rr, oy + Math.sin(a) * rr);
          g.rotate(a + Math.PI / 2);
          g.beginPath();
          g.moveTo(6, 0);
          g.lineTo(-4, 4);
          g.lineTo(-4, -4);
          g.closePath();
          g.fill();
          g.restore();
        }
      }
      // 바구니
      for (const b of snap.baskets) {
        const color = team ? TEAM_INFO[b.team].color : SEAT_COLORS[b.owner % 8];
        g.beginPath();
        g.arc(X(b.x), Y(b.z), BASKET_R * scale, 0, Math.PI * 2);
        g.fillStyle = color + "33";
        g.fill();
        g.lineWidth = 3;
        g.strokeStyle = color;
        g.stroke();
        const v = b.stack.reduce((a, k) => a + TOY_INFO[k].value, 0);
        g.fillStyle = "#1e1530";
        g.font = `bold ${Math.max(11, Math.round(scale * 0.55))}px sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(`${team ? TEAM_INFO[b.team].symbol : SEAT_SYMBOLS[b.owner % 8]} ${v}`, X(b.x), Y(b.z));
      }
      // 진열대
      for (const c of snap.stands) {
        g.beginPath();
        g.arc(X(c.x), Y(c.z), c.r * scale, 0, Math.PI * 2);
        g.fillStyle = "#fda4af";
        g.fill();
        g.lineWidth = 3;
        g.strokeStyle = "#7c2d12";
        g.stroke();
      }
      // 줄 선
      const byId = new Map(snap.toys.map((t) => [t.id, t]));
      for (const p of snap.players) {
        if (!p.chain.length) continue;
        const b = p.seat === sh.mySeat ? sh.buf.ahead(p.seat, now) : sh.buf.body(p.seat, now);
        if (!b) continue;
        g.beginPath();
        g.moveTo(X(b.x), Y(b.z));
        for (const id of p.chain) {
          const t = byId.get(id);
          if (!t) continue;
          const q = sh.buf.toy(t, now);
          g.lineTo(X(q.x), Y(q.z));
        }
        g.lineWidth = 3;
        g.strokeStyle = SEAT_COLORS[p.seat % 8];
        g.stroke();
      }
      // 물건
      for (const t of snap.toys) {
        const q = sh.buf.toy(t, now);
        if (t.state === "drop") {
          const left = Math.max(0, t.landAt - simNow);
          g.beginPath();
          g.arc(X(q.x), Y(q.z), scale * (0.25 + 0.3 * (1 - left / 1500)), 0, Math.PI * 2);
          g.fillStyle = "rgba(30,21,48,0.35)";
          g.fill();
          continue;
        }
        const s = scale * (t.kind === "trophy" ? 1 : 0.75);
        if (t.state === "chain" && simNow < t.shieldUntil) {
          g.setLineDash([3, 3]);
          g.beginPath();
          g.arc(X(q.x), Y(q.z), s * 0.6, 0, Math.PI * 2);
          g.strokeStyle = "#ffffff";
          g.lineWidth = 2;
          g.stroke();
          g.setLineDash([]);
        }
        g.globalAlpha = t.state === "floor" && simNow < t.noPickUntil ? 0.5 : 1;
        emoji(TOY_INFO[t.kind].emoji, X(q.x), Y(q.z), s);
        g.globalAlpha = 1;
        g.fillStyle = "#1e1530";
        g.font = `bold ${Math.max(9, Math.round(s * 0.42))}px sans-serif`;
        g.fillText(t.state === "chain" && t.owner >= 0 ? SEAT_SYMBOLS[t.owner % 8] : String(TOY_INFO[t.kind].value), X(q.x) + s * 0.42, Y(q.z) + s * 0.42);
      }
      // 사람
      for (const p of snap.players) {
        const b = p.seat === sh.mySeat ? sh.buf.ahead(p.seat, now) : sh.buf.body(p.seat, now);
        if (!b) continue;
        const r = BODY_R * scale * 1.15;
        g.beginPath();
        g.arc(X(b.x), Y(b.z), r, 0, Math.PI * 2);
        g.fillStyle = SEAT_COLORS[p.seat % 8];
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = p.seat === sh.mySeat ? "#ffffff" : "#0f172a";
        g.stroke();
        g.fillStyle = "#ffffff";
        g.font = `bold ${Math.max(9, Math.round(r * 1.1))}px sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(team ? TEAM_INFO[p.team].symbol : SEAT_SYMBOLS[p.seat % 8], X(b.x), Y(b.z) + 1);
        if (bombOf(snap, p.seat) && snap.phase === "fight") emoji("💣", X(b.x), Y(b.z) - r - 6, r * 1.5);
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
        el.style.transform = `translate(${X(pos.x).toFixed(1)}px, ${(Y(pos.z) - BODY_R * scale * 1.3 - 18).toFixed(1)}px) translate(-50%, -100%)`;
      }
      sh.shake = Math.max(0, sh.shake - 0.04);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [shared]);
  return <canvas ref={ref} className="h-full w-full" style={{ touchAction: "none" }} />;
}
