import { M, W, H, type AgentKind, type Emitter, type Scenario } from "./sim";

/**
 * "이번 라운드에 뭐가 떨어지나" — turns a scenario's emitters into plain
 * forecast lines (what / where / when / how many) plus timeline spans, so the
 * design phase can show the danger before anyone builds.
 */

export interface ForecastItem {
  icon: string;
  /** Short name: "물", "벌", "번개" … */
  what: string;
  /** Where it comes from, in words. */
  where: string;
  /** "0~110틱" / "25틱". */
  when: string;
  /** "약 110칸", "10마리", "9번". */
  amount: string;
  /** Timeline span in ticks (inclusive start, exclusive end). */
  from: number;
  to: number;
  /** Tailwind-free colour for the chip / timeline bar. */
  color: string;
}

const MAT_INFO: Record<number, { icon: string; what: string; color: string; unit: string }> = {
  [M.WATER]: { icon: "💧", what: "물", color: "#3b82f6", unit: "칸" },
  [M.LAVA]: { icon: "🌋", what: "용암", color: "#f97316", unit: "칸" },
  [M.ACID]: { icon: "🧪", what: "산성비", color: "#84cc16", unit: "방울" },
  [M.SAND]: { icon: "🏜️", what: "모래", color: "#d6b46a", unit: "칸" },
  [M.SNOW]: { icon: "❄️", what: "눈", color: "#e2e8f0", unit: "칸" },
  [M.BOULDER]: { icon: "🪨", what: "바위", color: "#78716c", unit: "개" },
  [M.GAS]: { icon: "☠️", what: "독가스", color: "#a855f7", unit: "칸" },
};

const AGENT_INFO: Record<AgentKind, { icon: string; what: string; color: string }> = {
  bee: { icon: "🐝", what: "벌", color: "#facc15" },
  hornet: { icon: "🐝", what: "말벌", color: "#ea580c" },
  bat: { icon: "🦇", what: "박쥐", color: "#7c3aed" },
  rat: { icon: "🐀", what: "쥐", color: "#a8a29e" },
  meteor: { icon: "☄️", what: "운석", color: "#fb923c" },
};

export function placeWord(x: number, y: number): string {
  const col = x <= 3 ? "왼쪽" : x >= W - 4 ? "오른쪽" : "가운데";
  const row = y <= 3 ? "위" : y >= H - 5 ? "아래" : "중간";
  return `${col} ${row}`;
}

function bandWord(x0: number, x1: number): string {
  if (x0 <= 0 && x1 >= W - 1) return "하늘 전체";
  if (x1 <= W / 2) return "하늘 왼쪽";
  if (x0 >= W / 2 - 1) return "하늘 오른쪽";
  return `하늘 ${x0 + 1}~${x1 + 1}번째 칸`;
}

const count = (from: number, to: number, every: number) => Math.max(1, Math.floor((to - from) / Math.max(1, every)) + 1);

export function forecastOf(sc: Scenario, emitters: readonly Emitter[] = sc.emitters): ForecastItem[] {
  const out: ForecastItem[] = [];
  for (const e of emitters) {
    switch (e.k) {
      case "pour": {
        const m = MAT_INFO[e.mat] ?? MAT_INFO[M.WATER];
        out.push({ icon: m.icon, what: m.what, where: `${placeWord(e.x, e.y)}에서 쏟아짐`, when: `${e.from}~${e.to}틱`, amount: `약 ${count(e.from, e.to, e.every)}${m.unit}`, from: e.from, to: e.to + 1, color: m.color });
        break;
      }
      case "rain": {
        const m = MAT_INFO[e.mat] ?? MAT_INFO[M.WATER];
        out.push({ icon: m.icon, what: m.what, where: `${bandWord(e.x0, e.x1)}에서 떨어짐`, when: `${e.from}~${e.to}틱`, amount: `약 ${count(e.from, e.to, e.every)}${m.unit}`, from: e.from, to: e.to + 1, color: m.color });
        break;
      }
      case "spawn": {
        const a = AGENT_INFO[e.agent];
        const last = e.from + e.every * (e.count - 1);
        out.push({ icon: a.icon, what: a.what, where: `${placeWord(e.x, e.y)}에서 날아옴`, when: `${e.from}틱부터 ${e.every}틱마다`, amount: `${e.count}마리`, from: e.from, to: last + 1, color: a.color });
        break;
      }
      case "meteor": {
        const last = e.from + e.every * (e.count - 1);
        out.push({ icon: "☄️", what: "운석", where: `${bandWord(e.x0, e.x1)}에서 떨어짐(폭발)`, when: `${e.from}틱부터 ${e.every}틱마다`, amount: `${e.count}개`, from: e.from, to: last + 1, color: "#fb923c" });
        break;
      }
      case "bolt": {
        const first = Math.min(...e.at);
        const last = Math.max(...e.at);
        out.push({ icon: "⚡", what: "번개", where: `${bandWord(e.x0, e.x1)} · 10틱 전에 노란 기둥 경고`, when: `${first}~${last}틱`, amount: `${e.at.length}번`, from: Math.max(0, first - 10), to: last + 1, color: "#fde047" });
        break;
      }
      case "ignite":
        out.push({ icon: "🔥", what: "불씨", where: e.cells.map(([x, y]) => placeWord(x, y)).filter((w, i, all) => all.indexOf(w) === i).join(" · "), when: `${e.at}틱`, amount: `${e.cells.length}곳`, from: e.at, to: e.at + 30, color: "#ef4444" });
        break;
      case "breach":
        out.push({ icon: "🌊", what: "둑 붕괴", where: "회색 둑이 한꺼번에 사라짐", when: `${e.at}틱`, amount: "물벽", from: e.at, to: e.at + 25, color: "#0ea5e9" });
        break;
    }
  }
  return out;
}
