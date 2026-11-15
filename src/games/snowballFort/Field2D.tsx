"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { FIELD_HL, FIELD_HW, PILES, SNOWMAN_R, TEAM_COLORS, TEAM_SYMBOLS, WALL_LEN, WALL_T, launchFor, sideSign } from "./data";
import { ballPos, isFrozen } from "./sim";
import type { SceneShared } from "./three/FieldScene";

/**
 * 2D 대체 화면 (WebGL 없음, 룰북 §11): 위에서 본 눈밭. 내 팀 진영이 늘 아래로 오게 돌린다.
 * 마우스를 움직이면 그 점을 조준점으로 `shared.aimWorld`에 넣는다(3D와 같은 조준 방식).
 */
export default function Field2D({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const draw = () => {
      raf = window.requestAnimationFrame(draw);
      const sh = shared.current;
      const snap = sh.buf.latest();
      const W = el.clientWidth;
      const H = el.clientHeight;
      if (el.width !== W * devicePixelRatio || el.height !== H * devicePixelRatio) {
        el.width = W * devicePixelRatio;
        el.height = H * devicePixelRatio;
      }
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.fillStyle = "#b9d3ec";
      ctx.fillRect(0, 0, W, H);
      if (!snap) return;
      const me = snap.players[sh.mySeat];
      const flip = me && me.team === 1 ? -1 : 1;
      const scale = Math.min(W / (FIELD_HW * 2 + 2), H / (FIELD_HL * 2 + 2));
      const X = (x: number) => W / 2 + x * scale * flip;
      const Y = (z: number) => H / 2 + z * scale * flip;
      ctx.fillStyle = "#eef4fa";
      ctx.fillRect(X(-FIELD_HW * flip), Y(-FIELD_HL * flip), FIELD_HW * 2 * scale, FIELD_HL * 2 * scale);
      ctx.fillStyle = "#93c5fd";
      ctx.fillRect(X(-FIELD_HW * flip), Y(0) - 1.5, FIELD_HW * 2 * scale, 3);
      for (const p of PILES) {
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(X(p.x), Y(p.z), 1.6 * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(96,165,250,0.5)";
        ctx.stroke();
      }
      for (const w of snap.walls) {
        ctx.save();
        ctx.translate(X(w.x), Y(w.z));
        ctx.rotate(flip === 1 ? w.a : w.a);
        ctx.fillStyle = `rgba(226,232,240,${0.5 + (w.hp / w.hpMax) * 0.5})`;
        ctx.strokeStyle = TEAM_COLORS[w.team];
        ctx.lineWidth = 2;
        ctx.fillRect((-WALL_LEN / 2) * scale, (-WALL_T / 2) * scale, WALL_LEN * scale, WALL_T * scale);
        ctx.strokeRect((-WALL_LEN / 2) * scale, (-WALL_T / 2) * scale, WALL_LEN * scale, WALL_T * scale);
        ctx.restore();
      }
      for (const m of snap.snowmen) {
        ctx.fillStyle = m.hp > 0 ? "#ffffff" : "#cbd5e1";
        ctx.strokeStyle = TEAM_COLORS[m.team];
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(X(m.x), Y(m.z), SNOWMAN_R * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#0f172a";
        ctx.font = `bold ${Math.max(10, scale * 0.7)}px system-ui`;
        ctx.textAlign = "center";
        ctx.fillText(`☃ ${m.hp}`, X(m.x), Y(m.z) + 4);
      }
      for (const it of snap.items) {
        ctx.font = `${Math.max(14, scale)}px system-ui`;
        ctx.textAlign = "center";
        ctx.fillText(it.kind === "cocoa" ? "🍫" : "🧊", X(it.x), Y(it.z) + 6);
      }
      const now = performance.now();
      const t = sh.buf.simNow(now);
      for (const b of snap.balls) {
        const p = ballPos(b, Math.max(b.t0, t));
        ctx.fillStyle = "rgba(71,85,105,0.3)";
        ctx.beginPath();
        ctx.arc(X(p.x), Y(p.z), (b.big ? 0.34 : 0.14) * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#64748b";
        ctx.beginPath();
        ctx.arc(X(p.x), Y(p.z) - p.y * scale * 0.35, (b.big ? 0.34 : 0.16) * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      for (const p of snap.players) {
        const pose = p.seat === sh.mySeat ? sh.buf.ahead(p.seat, now) : sh.buf.body(p.seat, now);
        if (!pose) continue;
        const frozen = isFrozen(p, snap.t);
        ctx.fillStyle = frozen ? "#bfe9ff" : TEAM_COLORS[p.team];
        ctx.beginPath();
        ctx.arc(X(pose.x), Y(pose.z), 0.45 * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = p.seat === sh.mySeat ? "#facc15" : "#0f172a";
        ctx.lineWidth = p.seat === sh.mySeat ? 3 : 1.5;
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${Math.max(10, scale * 0.55)}px system-ui`;
        ctx.fillText(TEAM_SYMBOLS[p.team], X(pose.x), Y(pose.z) + 4);
        // 조준 방향
        ctx.strokeStyle = "rgba(15,23,42,0.6)";
        ctx.beginPath();
        ctx.moveTo(X(pose.x), Y(pose.z));
        ctx.lineTo(X(pose.x + Math.cos(pose.face) * 0.9), Y(pose.z + Math.sin(pose.face) * 0.9));
        ctx.stroke();
      }
      const pv = sh.preview;
      if (pv && me && !isFrozen(me, snap.t)) {
        const pose = sh.buf.ahead(sh.mySeat, now) ?? me;
        const L = launchFor(pv.pow);
        ctx.strokeStyle = "#facc15";
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(X(pose.x), Y(pose.z));
        ctx.lineTo(X(pose.x + Math.cos(pv.aim) * L.range), Y(pose.z + Math.sin(pv.aim) * L.range));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(X(pose.x + Math.cos(pv.aim) * L.range), Y(pose.z + Math.sin(pv.aim) * L.range), 0.45 * scale, 0, Math.PI * 2);
        ctx.stroke();
      }
      void sideSign;
    };
    raf = window.requestAnimationFrame(draw);
    const move = (e: PointerEvent) => {
      const snap = shared.current.buf.latest();
      if (!snap || e.pointerType === "touch") return;
      const r = el.getBoundingClientRect();
      const me = snap.players[shared.current.mySeat];
      const flip = me && me.team === 1 ? -1 : 1;
      const scale = Math.min(r.width / (FIELD_HW * 2 + 2), r.height / (FIELD_HL * 2 + 2));
      shared.current.aimWorld = { x: ((e.clientX - r.left - r.width / 2) / scale) * flip, z: ((e.clientY - r.top - r.height / 2) / scale) * flip };
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerdown", move);
    return () => {
      window.cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerdown", move);
    };
  }, [shared]);
  return <canvas ref={canvas} className="h-full w-full touch-none" />;
}
