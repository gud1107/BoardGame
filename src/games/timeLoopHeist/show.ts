import type { LevelDef } from "./levels";
import { sortTracks, type SelfTrack, type SimEvent } from "./sim";

/** 좌석 색 + 모양(색각 이상 대비 — 색만으로 구분하지 않는다) */
export const SEAT_COLORS = ["#38bdf8", "#f472b6", "#a3e635", "#fb923c"];
export const SEAT_MARKS = ["▲", "●", "■", "◆"];

export interface SelfMeta {
  seat: number;
  loop: number;
  /** 지금 녹화 중인 나 */
  live: boolean;
  color: string;
  mark: string;
  /** "민수 · 2루프" */
  label: string;
  short: string;
  /** 좌석의 플레이어 이름 (3D VRM 캐릭터를 찾을 때) */
  name?: string;
}

/** 시뮬레이션의 자아 순서(루프·좌석 오름차순)에 맞춘 표시 정보 */
export function selfMeta(tracks: readonly SelfTrack[], names: Record<number, string>, live: { seat: number; loop: number } | null): SelfMeta[] {
  return sortTracks(tracks).map((t) => {
    const isLive = !!live && live.seat === t.seat && live.loop === t.loop;
    const name = names[t.seat] ?? `${t.seat + 1}번`;
    return {
      seat: t.seat,
      loop: t.loop,
      live: isLive,
      color: SEAT_COLORS[t.seat % SEAT_COLORS.length],
      mark: SEAT_MARKS[t.seat % SEAT_MARKS.length],
      label: isLive ? `나 · 지금` : `${name} · ${t.loop}루프`,
      short: `${SEAT_MARKS[t.seat % SEAT_MARKS.length]}${t.loop}`,
      name: names[t.seat],
    };
  });
}

export function eventText(e: SimEvent, meta: SelfMeta[], def: LevelDef): string | null {
  const who = meta[e.self]?.label ?? "누군가";
  switch (e.kind) {
    case "paradox":
      return `⚠️ ${e.t}틱 — ${who}: 시간 역설! 가려던 길이 막혀 사라졌어요`;
    case "caught":
      return `🚨 ${e.t}틱 — ${who}: 경비 로봇에게 들켰어요`;
    case "bank":
      return e.loot !== undefined && lootKindAt(def, e.loot) === "coin" ? `🪙 ${e.t}틱 — ${who}: 동전 입금` : `💎 ${e.t}틱 — ${who}: 보석 입금!`;
    case "lever":
      return `🔧 ${e.t}틱 — ${who}: 레버를 당겼어요`;
    case "emp":
      return `⚡ ${e.t}틱 — ${who}: EMP 발동`;
    default:
      return null;
  }
}

export function lootKindAt(def: LevelDef, id: number): "gem" | "coin" {
  let k = 0;
  for (const row of def.rows) {
    for (const c of row) {
      if (c === "*" || c === "$") {
        if (k === id) return c === "*" ? "gem" : "coin";
        k++;
      }
    }
  }
  return "gem";
}

export const KEY_HELP = "←↑↓→/WASD 이동 · Space 대기 · E 사용 · Z 되돌리기 · Enter 녹화 완료";
