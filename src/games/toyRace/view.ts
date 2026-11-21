import { ITEM_INFO, SEAT_COLORS, SEAT_SYMBOLS } from "./data";
import type { LocalDriver } from "./local";
import type { Pose, SnapBuffer } from "./net";
import { FL } from "./sim";
import { trainState, trackFor, type Track } from "./track";

/**
 * 화면 공용 (3D 장면·2D 지도·작은 지도): 매 프레임 읽는 공유 객체와 그리기 함수.
 * 내 차는 LocalDriver가 움직인 위치, 남의 차는 버퍼의 추측 항법 위치.
 */

export interface SceneShared {
  buf: SnapBuffer;
  driver: LocalDriver;
  mySeat: number;
  /** 화면 흔들림 0~1 */
  shake: number;
  /** 이름표 DOM (자리 순서) */
  labels: (HTMLDivElement | null)[];
  /** 카메라 거리 */
  cam: "near" | "far";
}

export function poseOf(sh: SceneShared, seat: number, now: number): Pose | null {
  if (seat === sh.mySeat) return sh.driver.pose();
  return sh.buf.car(seat, now);
}

export function flagsOf(sh: SceneShared, seat: number): number {
  if (seat === sh.mySeat) return sh.driver.flags;
  return sh.buf.latest()?.players[seat]?.flags ?? 0;
}

/** 남의 차 위치 목록 (내 차 부딪힘·바람막이용) */
export function othersOf(sh: SceneShared, now: number) {
  const snap = sh.buf.latest();
  if (!snap) return [];
  const out: { seat: number; x: number; z: number; y: number; vx: number; vz: number }[] = [];
  for (const p of snap.players) {
    if (p.seat === sh.mySeat || p.finishedAt) continue;
    const q = sh.buf.car(p.seat, now);
    if (q) out.push({ seat: p.seat, x: q.x, z: q.z, y: q.y, vx: q.vx, vz: q.vz });
  }
  return out;
}

const pathCache = new Map<string, Path2D>();

function trackPath(t: Track, kind: "center"): Path2D {
  const key = `${t.id}:${kind}`;
  const hit = pathCache.get(key);
  if (hit) return hit;
  const p = new Path2D();
  for (let i = 0; i <= t.n; i++) {
    const k = i % t.n;
    if (i === 0) p.moveTo(t.x[k], t.z[k]);
    else p.lineTo(t.x[k], t.z[k]);
  }
  pathCache.set(key, p);
  return p;
}

/**
 * 위에서 본 트랙 그리기 (2D 보기·작은 지도). 색만으로 알리지 않는다:
 * 자리 = 색 + 기호, 나 = 흰 테두리 + 큰 점, 장난감 벽 = 빗금 막대, 오리 = 🦆, 상자 = 🎁, 비누 = 점선.
 */
export function drawTop(g: CanvasRenderingContext2D, w: number, h: number, sh: SceneShared, now: number, mini: boolean) {
  const snap = sh.buf.latest();
  if (!snap) return;
  const t = trackFor(snap.track);
  let minx = Infinity;
  let maxx = -Infinity;
  let minz = Infinity;
  let maxz = -Infinity;
  for (let i = 0; i < t.n; i += 4) {
    minx = Math.min(minx, t.x[i]);
    maxx = Math.max(maxx, t.x[i]);
    minz = Math.min(minz, t.z[i]);
    maxz = Math.max(maxz, t.z[i]);
  }
  const pad = mini ? 5 : 7;
  const sc = Math.min(w / (maxx - minx + pad * 2), h / (maxz - minz + pad * 2));
  const ox = w / 2 - ((minx + maxx) / 2) * sc;
  const oz = h / 2 - ((minz + maxz) / 2) * sc;
  g.save();
  g.setTransform(g.getTransform().a, 0, 0, g.getTransform().d, 0, 0);
  g.translate(ox, oz);
  g.scale(sc, sc);
  const center = trackPath(t, "center");
  g.lineJoin = "round";
  g.lineCap = "round";
  if (!mini) {
    g.strokeStyle = "#c08457";
    g.lineWidth = (t.w[0] + 1.6) * 2;
    g.stroke(center);
  }
  g.strokeStyle = mini ? "rgba(255,255,255,0.85)" : "#64748b";
  g.lineWidth = mini ? Math.max(2.4 / sc, 2.2) : t.w[0] * 2;
  g.stroke(center);
  // 비누 구간 (점선)
  if (!mini) {
    g.setLineDash([0.6, 0.8]);
    g.strokeStyle = "#e0f2fe";
    g.lineWidth = 0.5;
    g.beginPath();
    for (let i = 0; i < t.n; i++) if (t.soap[i]) g.rect(t.x[i] - 0.3, t.z[i] - 0.3, 0.6, 0.6);
    g.stroke();
    g.setLineDash([]);
  }
  // 출발선
  {
    const nx = -t.tz[0];
    const nz = t.tx[0];
    g.strokeStyle = "#ffffff";
    g.lineWidth = mini ? 1.4 / sc + 0.6 : 0.6;
    g.beginPath();
    g.moveTo(t.x[0] - nx * t.w[0], t.z[0] - nz * t.w[0]);
    g.lineTo(t.x[0] + nx * t.w[0], t.z[0] + nz * t.w[0]);
    g.stroke();
  }
  const emoji = (e: string, x: number, z: number, size: number) => {
    g.save();
    g.translate(x, z);
    g.scale(1 / sc, 1 / sc);
    g.font = `${size}px sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(e, 0, 0);
    g.restore();
  };
  // 기차 건널목
  if (t.train) {
    const st = trainState(t, sh.buf.hostNow(now) - snap.goAt);
    const i = Math.round(t.train.s / t.ds) % t.n;
    g.fillStyle = st === "cross" ? "#ef4444" : st === "warn" ? "#f59e0b" : "#a3a3a3";
    g.fillRect(t.x[i] - 1.2, t.z[i] - 1.2, 2.4, 2.4);
    if (!mini && st !== "clear") emoji("🚂", t.x[i], t.z[i], 16);
  }
  if (!mini) {
    snap.boxes.forEach((b, i) => {
      if (b.back > 0) return;
      const p = t.boxes[i];
      emoji("🎁", p.x, p.z, Math.max(9, sc * 1.1));
    });
    for (const o of t.obstacles) {
      g.fillStyle = "#94a3b8";
      g.beginPath();
      g.arc(o.x, o.z, o.r, 0, Math.PI * 2);
      g.fill();
    }
    for (const d of snap.ducks) if (!sh.driver.hitIds.has(d.id)) emoji("🦆", d.x, d.z, Math.max(10, sc * 1.1));
    for (const pj of snap.projectiles) {
      const q = pj.kind === "yarn" ? sh.buf.ahead(pj.x, pj.z, pj.vx, pj.vz, now) : pj;
      emoji(ITEM_INFO[pj.kind].emoji, q.x, q.z, Math.max(10, sc * 1));
    }
  }
  // 장난감 벽 (빗금 막대 — 그림자 단계는 점선)
  for (const toy of snap.toys) {
    if (sh.driver.hitIds.has(toy.id)) continue;
    const warn = sh.buf.hostNow(now) < toy.activeAt;
    const nx = -Math.sin(toy.h);
    const nz = Math.cos(toy.h);
    g.save();
    g.translate(toy.x, toy.z);
    g.rotate(Math.atan2(nz, nx));
    g.fillStyle = warn ? "rgba(239,68,68,0.35)" : "#ef4444";
    g.strokeStyle = "#7f1d1d";
    g.lineWidth = 0.25;
    if (warn) g.setLineDash([0.5, 0.4]);
    g.fillRect(-2, -0.65, 4, 1.3);
    g.strokeRect(-2, -0.65, 4, 1.3);
    g.restore();
  }
  // 차 (내 차는 맨 위에)
  const seats = snap.players.map((p) => p.seat).sort((a, b) => (a === sh.mySeat ? 1 : b === sh.mySeat ? -1 : a - b));
  for (const seat of seats) {
    const q = poseOf(sh, seat, now);
    if (!q) continue;
    const me = seat === sh.mySeat;
    const fl = flagsOf(sh, seat);
    const r = (mini ? (me ? 5 : 3.6) : me ? 9 : 7) / sc;
    g.save();
    g.translate(q.x, q.z);
    g.rotate(q.h);
    g.fillStyle = SEAT_COLORS[seat % 8];
    g.strokeStyle = me ? "#ffffff" : "#0f172a";
    g.lineWidth = (me ? 2.2 : 1.2) / sc;
    g.beginPath();
    g.moveTo(r * 1.35, 0);
    g.lineTo(-r * 0.9, r * 0.85);
    g.lineTo(-r * 0.55, 0);
    g.lineTo(-r * 0.9, -r * 0.85);
    g.closePath();
    g.fill();
    g.stroke();
    if (fl & FL.top || fl & FL.boost) {
      g.strokeStyle = fl & FL.top ? "#c084fc" : "#22c55e";
      g.lineWidth = 1.5 / sc;
      g.beginPath();
      g.arc(0, 0, r * 1.6, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
    if (!mini) emoji(SEAT_SYMBOLS[seat % 8], q.x, q.z - (r * 1.9), 11);
  }
  g.restore();
}
