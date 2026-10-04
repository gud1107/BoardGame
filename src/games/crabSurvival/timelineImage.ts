/**
 * Shareable match card for 꽃게 서바이벌: draws the result + 경기 타임라인 onto a canvas
 * (pure Canvas 2D, no DOM screenshotting) so it can be saved as a PNG or handed to the
 * Web Share API.
 */

import type { CrownLogEntry, MatchSummary, MomentEntry } from "./engine";

export const CROWN_ICON: Record<CrownLogEntry["kind"], string> = { crown: "👑", recapture: "🔁", lost: "💔", down: "☠️" };
export const CROWN_LABEL: Record<CrownLogEntry["kind"], string> = { crown: "등극", recapture: "탈환", lost: "빼앗김", down: "왕관 잃고 쓰러짐" };
export const MOMENT_ICON: Record<MomentEntry["kind"], string> = { kill: "✂️", evolve: "🧬", epic: "🌟", revenge: "⚔️", death: "☠️", revive: "❤️" };

export interface TimelineRow {
  t: number;
  icon: string;
  text: string;
  crown: boolean;
  score?: number;
  delta?: number;
  detail?: string;
}

/** Crown history + key moments merged into one time-ordered list (kills optional — they can be many). */
export function timelineRows(log: CrownLogEntry[], moments: MomentEntry[], withKills: boolean): TimelineRow[] {
  return [
    ...log.map((e) => ({ t: e.t, icon: CROWN_ICON[e.kind], text: `${CROWN_LABEL[e.kind]}${e.by ? ` · ${e.by}` : ""}`, crown: true, score: e.score })),
    ...moments
      .filter((m) => withKills || m.kind !== "kill")
      .map((m) => ({ t: m.t, icon: MOMENT_ICON[m.kind], text: m.kind === "kill" ? `처치 · ${m.label}` : m.label, crown: false, score: m.score, delta: m.delta, detail: m.detail })),
  ].sort((a, b) => a.t - b.t);
}

/** Reign spans: a crown/recapture opens one, a lost/down closes it. */
export function reignSpans(log: CrownLogEntry[], end: number): [number, number][] {
  const out: [number, number][] = [];
  let open: number | null = null;
  for (const e of log) {
    if (e.kind === "crown" || e.kind === "recapture") open ??= e.t;
    else if (open !== null) {
      out.push([open, e.t]);
      open = null;
    }
  }
  if (open !== null) out.push([open, end]);
  return out;
}

export const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export function renderMatchCard(s: MatchSummary, who: { name: string; species: string; shell: string }): HTMLCanvasElement {
  const W = 1080;
  const rows = timelineRows(s.crownLog ?? [], s.moments ?? [], false).slice(0, 14);
  const H = 640 + Math.max(1, rows.length) * 46;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const font = (w: number, px: number) => `${w} ${px}px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif`;
  // Background: deep sea → sand.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0b3b5c");
  bg.addColorStop(0.55, "#0f172a");
  bg.addColorStop(1, "#1c1917");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(253,230,138,0.08)";
  for (let i = 0; i < 40; i++) {
    ctx.beginPath();
    ctx.arc((i * 263) % W, (i * 151) % 260, 2 + (i % 3), 0, Math.PI * 2);
    ctx.fill();
  }

  // Header.
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = font(800, 26);
  ctx.fillText("🦀 꽃게 서바이벌 · 경기 기록", 60, 80);
  ctx.fillStyle = "#ffffff";
  ctx.font = font(900, 56);
  ctx.fillText(who.name, 60, 150);
  ctx.fillStyle = who.shell;
  ctx.font = font(800, 28);
  ctx.fillText(who.species, 60, 192);
  ctx.textAlign = "right";
  ctx.fillStyle = s.rank === 1 ? "#fde047" : "#ffffff";
  ctx.font = font(900, 96);
  ctx.fillText(`${s.rank}위`, W - 60, 160);
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = font(700, 26);
  ctx.fillText(`/ ${s.total}마리 · ${mmss(s.seconds)}`, W - 60, 196);
  ctx.textAlign = "left";
  ctx.fillStyle = "#fbbf24";
  ctx.font = font(900, 64);
  ctx.fillText(`${s.score.toLocaleString()}점`, 60, 280);

  // Stat chips.
  const st = s.stats;
  const chips = [`✂️ 처치 ${st.kills}`, `🧬 Lv${st.maxLevel}`, `👑 재위 ${Math.round(st.kingSeconds)}초`, ...(st.bounties ? [`💰 현상금 ${st.bounties}회`] : []), ...(st.revenges ? [`⚔️ 역습 ${st.revenges}회`] : [])];
  let x = 60;
  ctx.font = font(800, 26);
  for (const ch of chips) {
    const w = ctx.measureText(ch).width + 36;
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    roundRect(ctx, x, 312, w, 48, 24);
    ctx.fill();
    ctx.fillStyle = "#f8fafc";
    ctx.fillText(ch, x + 18, 345);
    x += w + 14;
  }

  // Timeline bar.
  const end = Math.max(1, Math.min(s.duration || s.seconds, s.seconds));
  const bx = 60, bw = W - 120, by = 450, bh = 26;
  const px = (t: number) => bx + Math.min(1, t / end) * bw;
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = font(800, 26);
  ctx.fillText("📈 경기 타임라인", 60, 400);
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  roundRect(ctx, bx, by, bw, bh, bh / 2);
  ctx.fill();
  for (const [a, b] of reignSpans(s.crownLog ?? [], end)) {
    const g = ctx.createLinearGradient(px(a), 0, px(b), 0);
    g.addColorStop(0, "#fcd34d");
    g.addColorStop(1, "#eab308");
    ctx.fillStyle = g;
    roundRect(ctx, px(a), by, Math.max(bh, px(b) - px(a)), bh, bh / 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(244,63,94,0.9)";
  for (const k of (s.moments ?? []).filter((m) => m.kind === "kill")) ctx.fillRect(px(k.t) - 1.5, by + 2, 3, bh - 4);
  ctx.textAlign = "center";
  ctx.font = font(400, 30);
  for (const e of s.crownLog ?? []) ctx.fillText(CROWN_ICON[e.kind], px(e.t), by - 10);
  ctx.font = font(400, 24);
  for (const m of (s.moments ?? []).filter((m) => m.kind !== "kill")) ctx.fillText(MOMENT_ICON[m.kind], px(m.t), by + bh + 32);
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.font = font(600, 20);
  ctx.textAlign = "left";
  ctx.fillText("0:00", bx, by + bh + 62);
  ctx.textAlign = "right";
  ctx.fillText(mmss(end), bx + bw, by + bh + 62);
  ctx.textAlign = "left";

  // Moment list.
  let y = 600;
  if (!rows.length) {
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = font(600, 24);
    ctx.fillText("기록된 주요 순간이 없어요", 60, y);
  }
  for (const r of rows) {
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = font(700, 24);
    ctx.fillText(mmss(r.t), 60, y);
    ctx.font = font(400, 28);
    ctx.fillText(r.icon, 140, y);
    ctx.fillStyle = r.crown ? "#fde68a" : "#f1f5f9";
    ctx.font = font(800, 26);
    ctx.fillText(r.text, 190, y);
    if (r.delta) {
      ctx.textAlign = "right";
      ctx.fillStyle = r.delta > 0 ? "#86efac" : "#fca5a5";
      ctx.fillText(`${r.delta > 0 ? "+" : ""}${r.delta.toLocaleString()}`, W - 60, y);
      ctx.textAlign = "left";
    }
    y += 46;
  }
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.font = font(600, 20);
  ctx.textAlign = "right";
  ctx.fillText(new Date().toLocaleDateString("ko-KR"), W - 60, H - 30);
  ctx.textAlign = "left";
  return c;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Save the card as a PNG, or hand it to the OS share sheet when that can take files. */
export async function exportMatchCard(s: MatchSummary, who: { name: string; species: string; shell: string }, mode: "save" | "share"): Promise<"saved" | "shared" | "cancelled"> {
  const canvas = renderMatchCard(s, who);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (!blob) return "cancelled";
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const file = new File([blob], `crab-survival-${stamp}.png`, { type: "image/png" });
  if (mode === "share" && typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "꽃게 서바이벌 경기 기록", text: `🦀 ${s.rank}위 · ${s.score.toLocaleString()}점` });
      return "shared";
    } catch {
      return "cancelled";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return "saved";
}
