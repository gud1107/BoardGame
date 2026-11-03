import { BASE, FLOOR_Y, room, roomCenter, routeVia, spot, type RoomId } from "./house";
import type { GameState, Move, Seat, SeatState, TurnEvent } from "./engine";

/**
 * 판정 연출 타임라인 + 3D 장면에 넘길 인물/단서 목록 (순수 함수).
 * 보는 사람(viewer)에게 보이면 안 되는 위치(다른 숨은 사람)는 여기서 걸러 장면으로 새지 않는다.
 */

export type P3 = [number, number, number];

export const SEAT_COLORS = ["#38bdf8", "#f472b6", "#a3e635", "#fb923c", "#c084fc", "#facc15"];

/** 판정 화면 길이 — 연출이 끝나면 다음 턴으로 (전원 준비면 더 일찍) */
export const RESOLVED_MS = 4_800;
export const ROUND_END_MS = 9_000;
export const HIDE_RESOLVED_MS = 1_800;

/** 연출 시각(초) */
export const T = { noise: 0.3, rustle: 0.55, home: 1.0, bump: 1.2, flash: 0.9, flashCount: 1.5, search: 1.7, sense: 2.3, reveal: 2.8, end: 3.6 } as const;

export const PILLAR: P3 = [6.6, 0, 4.9];

export type FigurePoseKind = "stand" | "count" | "crouch" | "search" | "caught" | "cheer" | "flash";

export interface FigureSpec {
  seat: Seat;
  path: P3[];
  pathKey: string;
  delay: number;
  pose: FigurePoseKind;
  faceTo: P3 | null;
  /** 판정 연출 중 이 시각(초)에 처음 나타난다 (null = 처음부터) */
  appearAt: number | null;
  tag: string | null;
  mine: boolean;
}

export type ClueSpec =
  | { key: string; kind: "bubble"; pos: P3; text: string; color: string; at: number }
  | { key: string; kind: "beam"; from: P3; to: P3; at: number }
  | { key: string; kind: "mark"; pos: P3 }
  /** 뒤진 가구 바닥에서 퍼지는 고리 — 찾았으면 크고 빨갛게 */
  | { key: string; kind: "ping"; pos: P3; color: string; at: number; big: boolean };

/** 이번 판정에서 뒤져지는 가구 — 뒤적이는 동안 들썩인다 (판정 연출 시각, 초) */
export function rummageFor(state: GameState, fresh: boolean): { spot: string; at: number; until: number }[] {
  if (!fresh || state.step !== "seek") return [];
  return state.events.filter((e) => e.t === "search").map((e) => ({ spot: e.t === "search" ? e.spot : "", at: T.search - 0.55, until: T.search + 0.15 }));
}

function ring(c: { x: number; y: number; z: number }, k: number, r = 0.75): P3 {
  const a = k * 2.399 + 0.6;
  return [c.x + Math.cos(a) * r, c.y, c.z + Math.sin(a) * r * 0.7];
}

export function roomSlot(r: RoomId, seat: Seat): P3 {
  if (r === BASE) return homeSlot(seat);
  return ring(roomCenter(r), seat);
}

export function homeSlot(seat: Seat): P3 {
  const a = seat * 1.05 + 0.4;
  return [PILLAR[0] + Math.cos(a) * 1.2, 0, PILLAR[2] - 0.2 + Math.sin(a) * 0.8];
}

function toward(sp: string, k: number): P3 {
  const s = spot(sp)!;
  const c = roomCenter(s.room);
  const dx = c.x - s.x;
  const dz = c.z - s.z;
  const d = Math.max(0.001, Math.hypot(dx, dz));
  return [s.x + (dx / d) * k, FLOOR_Y[room(s.room).floor], s.z + (dz / d) * k];
}

/** 뒤지는 사람이 서는 곳 */
export function spotStand(sp: string): P3 {
  return toward(sp, 0.95);
}

/** 숨은 사람이 웅크린 곳 (가구 바로 앞) */
export function spotHide(sp: string): P3 {
  return toward(sp, 0.45);
}

export function spotTop(sp: string): P3 {
  const s = spot(sp)!;
  return [s.x, FLOOR_Y[room(s.room).floor] + 1.9, s.z];
}

function roomTop(r: RoomId): P3 {
  const c = roomCenter(r);
  return [c.x, c.y + 2.25, c.z];
}

function lastTurnEvents(state: GameState): TurnEvent[] {
  return state.history.length ? state.history[state.history.length - 1].events : [];
}

/** 술래 편이 지금 서 있는 곳: 이번(직전) 턴에 뒤졌으면 그 가구 앞, 아니면 방 안 */
export function hunterPos(state: GameState, seat: Seat): P3 {
  const s = state.seats[seat];
  if (state.step === "hide") return s.room === BASE && seat === state.seeker ? [PILLAR[0], 0, PILLAR[2] - 0.75] : roomSlot(s.room, seat);
  for (const e of lastTurnEvents(state)) if (e.t === "search" && e.seat === seat) return spotStand(e.spot);
  return roomSlot(s.room, seat);
}

const key = (path: P3[]) => path.map((p) => p.map((v) => v.toFixed(2)).join(",")).join("|");

/**
 * 장면의 인물들. `fresh` = 방금 판정된 턴을 연출 중(이동 경로·등장 시각을 쓴다).
 * `prevMine` = 판정 직전 내 자리(살금살금 경로용). `committed` = 숨기 단계에서 내가 고른 곳.
 */
export function figuresFor(state: GameState, viewer: Seat, fresh: boolean, prevMine: SeatState | null, committed: Move | null, names: Record<Seat, string>): FigureSpec[] {
  const out: FigureSpec[] = [];
  const events = fresh ? state.events : [];
  const reveal = state.roundOver || state.phase === "ended";
  const nm = (s: Seat) => (s === viewer ? `${names[s] ?? "나"} (나)` : (names[s] ?? `${s + 1}번`));
  state.seats.forEach((s, seat) => {
    const mine = seat === viewer;
    const push = (f: Omit<FigureSpec, "seat" | "mine" | "pathKey"> & { pathKey?: string }) => out.push({ seat, mine, pathKey: f.pathKey ?? key(f.path), ...f });
    if (s.status === "seeker" || (s.status === "caught" && s.caughtTurn !== null && s.caughtTurn < state.turn) || (s.status === "caught" && !fresh && state.step === "seek")) {
      const pos = hunterPos(state, seat);
      const mv = events.find((e) => e.t === "move" && e.seat === seat);
      const searched = lastTurnEvents(state).some((e) => e.t === "search" && e.seat === seat);
      const flashed = lastTurnEvents(state).find((e) => e.t === "flash" && e.seat === seat);
      const path: P3[] = mv && mv.t === "move" ? [roomSlot(mv.from, seat), ...routeVia(mv.from, mv.to), pos] : [pos];
      const counting = state.step === "hide" && seat === state.seeker;
      push({
        path,
        delay: 0,
        pose: counting ? "count" : searched ? "search" : flashed ? "flash" : "stand",
        faceTo: counting ? PILLAR : flashed && flashed.t === "flash" ? (() => { const c = roomCenter(flashed.room); return [c.x, c.y, c.z] as P3; })() : searched ? null : null,
        appearAt: null,
        tag: `${seat === state.seeker ? "👁️ 술래" : "🔦 꼬마 술래"} ${nm(seat)}`,
      });
      return;
    }
    if (s.status === "caught") {
      // 이번 턴에 잡힘 — 숨은 곳에서 튀어나온다
      const found = events.find((e) => e.t === "search" && e.found.includes(seat));
      const bump = events.find((e) => e.t === "bump" && e.victim === seat);
      const blocked = events.find((e) => e.t === "blocked" && e.seat === seat);
      let path: P3[];
      let at: number | null = null;
      if (found && found.t === "search") {
        path = [spotHide(found.spot)];
        at = T.search;
      } else if (bump && bump.t === "bump") {
        path = [roomSlot(bump.room, seat)];
        at = T.bump;
      } else if (blocked && blocked.t === "blocked") {
        const start = mine && prevMine?.spot ? spotHide(prevMine.spot) : roomSlot(blocked.from, seat);
        path = [start, ...routeVia(blocked.from, blocked.where === BASE ? BASE : blocked.from), blocked.where === BASE ? homeSlot(seat) : roomSlot(blocked.where, seat)];
        at = mine ? null : 0.2;
      } else {
        path = [roomSlot(s.room, seat)];
      }
      push({ path, delay: 0, pose: "caught", faceTo: null, appearAt: fresh && !mine ? at : null, tag: `😱 ${nm(seat)}` });
      return;
    }
    if (s.status === "home") {
      const ran = events.find((e) => e.t === "home" && e.seat === seat);
      const path: P3[] = ran && ran.t === "home" ? [mine && prevMine?.spot ? spotHide(prevMine.spot) : roomSlot(ran.from, seat), ...routeVia(ran.from, BASE), homeSlot(seat)] : [homeSlot(seat)];
      push({ path, delay: 0, pose: "cheer", faceTo: PILLAR, appearAt: fresh && ran && !mine ? 0.2 : null, tag: `🙌 찜! ${nm(seat)}` });
      return;
    }
    if (s.status === "safe") {
      if (!s.spot) return;
      push({ path: [spotHide(s.spot)], delay: 0, pose: "cheer", faceTo: null, appearAt: fresh && !mine ? T.reveal : null, tag: `🎉 ${nm(seat)}` });
      return;
    }
    // 숨어 있음 — 나만 내 위치를 본다 (라운드가 끝나면 모두 공개)
    if (!mine && !reveal) return;
    if (state.step === "hide") {
      if (!mine) return;
      const pick = committed?.kind === "hide" && committed.spot ? committed.spot : null;
      const sp = s.spot ?? pick;
      if (!sp) {
        push({ path: [homeSlot(seat)], delay: 0, pose: "stand", faceTo: PILLAR, appearAt: null, tag: `${nm(seat)} — 어디 숨지?` });
        return;
      }
      const r = spot(sp)!.room;
      push({ path: [homeSlot(seat), ...routeVia(BASE, r), spotHide(sp)], delay: 0, pose: "crouch", faceTo: null, appearAt: null, tag: `🤫 ${nm(seat)}` });
      return;
    }
    if (!s.spot) return;
    const sneaked = mine && fresh && prevMine?.spot && prevMine.spot !== s.spot;
    const path: P3[] = sneaked ? [spotHide(prevMine!.spot!), ...routeVia(prevMine!.room, s.room), spotHide(s.spot)] : [spotHide(s.spot)];
    push({ path, delay: 0, pose: "crouch", faceTo: null, appearAt: null, tag: mine ? `🤫 ${nm(seat)}${s.still >= 2 ? " · 다리 저림!" : ""}` : `🤫 ${nm(seat)}` });
  });
  return out;
}

/** 이번 라운드에 뒤진 곳 표시 + 직전 턴의 소리·손전등·인기척 말풍선 */
export function cluesFor(state: GameState, fresh: boolean): ClueSpec[] {
  if (state.step !== "seek") return [];
  const out: ClueSpec[] = [];
  const searched = new Set<string>();
  for (const turn of state.history) for (const e of turn.events) if (e.t === "search") searched.add(e.spot);
  for (const sp of searched) out.push({ key: `mark-${sp}`, kind: "mark", pos: spotTop(sp) });
  const turn = state.history[state.history.length - 1];
  if (!turn) return out;
  const at = (t: number) => (fresh ? t : -10);
  const k = (s: string) => `${turn.turn}-${s}`;
  turn.events.forEach((e, i) => {
    switch (e.t) {
      case "noise":
        out.push({ key: k(`n${i}`), kind: "bubble", pos: roomTop(e.room), text: `🔊 삐걱!${e.count > 1 ? ` ×${e.count}` : ""}`, color: "#fb923c", at: at(T.noise) });
        break;
      case "rustle":
        out.push({ key: k(`r${i}`), kind: "bubble", pos: shift(roomTop(e.room), -0.35), text: `🍃 부스럭${e.count > 1 ? ` ×${e.count}` : ""}`, color: "#4ade80", at: at(T.rustle) });
        break;
      case "flash": {
        const from = state.seats[e.seat] ? hunterPos(state, e.seat) : roomSlot(e.room, e.seat);
        const c = roomCenter(e.room);
        out.push({ key: k(`fb${i}`), kind: "beam", from: [from[0], from[1] + 1.1, from[2]], to: [c.x, c.y + 0.4, c.z], at: at(T.flash) });
        out.push({ key: k(`fc${i}`), kind: "bubble", pos: shift(roomTop(e.room), 0.3), text: `🔦 ${e.count}명`, color: "#fde047", at: at(T.flashCount) });
        break;
      }
      case "search":
        out.push({ key: k(`s${i}`), kind: "bubble", pos: shift(spotTop(e.spot), 0.25), text: e.found.length ? "찾았다!" : "없다…", color: e.found.length ? "#f87171" : "#94a3b8", at: at(T.search) });
        if (fresh) {
          const sp = spot(e.spot)!;
          out.push({ key: k(`pg${i}`), kind: "ping", pos: [sp.x, FLOOR_Y[room(sp.room).floor], sp.z], color: e.found.length ? "#f43f5e" : "#94a3b8", at: T.search, big: e.found.length > 0 });
        }
        break;
      case "bump":
        out.push({ key: k(`b${i}`), kind: "bubble", pos: shift(roomTop(e.room), 0.6), text: "딱 마주쳤다!", color: "#f87171", at: at(T.bump) });
        break;
      case "home":
        out.push({ key: k(`h${i}`), kind: "bubble", pos: [PILLAR[0], 2.4, PILLAR[2]], text: "찜! 🙌", color: "#facc15", at: at(T.home) });
        break;
      case "blocked":
        out.push({ key: k(`x${i}`), kind: "bubble", pos: e.where === BASE ? [PILLAR[0] + 0.8, 2.6, PILLAR[2]] : roomTop(e.where), text: "앗, 막혔다!", color: "#f87171", at: at(T.home) });
        break;
      case "sense":
        out.push({ key: k(`p${i}`), kind: "bubble", pos: shift(roomTop(e.room), -0.7), text: e.present ? "💓 인기척!" : "🤫 조용…", color: e.present ? "#f472b6" : "#94a3b8", at: at(T.sense) });
        break;
      case "survive":
        out.push({ key: k(`v${i}`), kind: "bubble", pos: [PILLAR[0], 3.0, PILLAR[2]], text: "못 찾겠다 꾀꼬리!", color: "#fde047", at: at(T.reveal) });
        break;
      case "sweep":
        out.push({ key: k(`w${i}`), kind: "bubble", pos: [PILLAR[0], 3.0, PILLAR[2]], text: "싹쓸이! 👁️", color: "#f87171", at: at(T.reveal) });
        break;
    }
  });
  return out;
}

function shift(p: P3, dy: number): P3 {
  return [p[0], p[1] + dy, p[2]];
}

// ---------------------------------------------------------------------------
// 기록 문장

export interface LogLine {
  text: string;
  mine: boolean;
}

export function describeEvents(events: TurnEvent[], names: Record<Seat, string>, viewer: Seat): LogLine[] {
  const nm = (s: Seat) => (s === viewer ? "나" : (names[s] ?? `${s + 1}번`));
  const out: LogLine[] = [];
  for (const e of events) {
    switch (e.t) {
      case "move":
        out.push({ text: `🚶 ${nm(e.seat)}${e.helper ? "(꼬마 술래)" : ""} → ${room(e.to).icon} ${room(e.to).name}`, mine: e.seat === viewer });
        break;
      case "search": {
        const sp = spot(e.spot)!;
        out.push({
          text: `🔍 ${nm(e.seat)}${e.helper ? "(꼬마 술래)" : ""}: ${room(sp.room).name} ${sp.name} — ${e.found.length ? `${e.found.map(nm).join(", ")} 찾았다!` : "없다…"}`,
          mine: e.seat === viewer || e.found.includes(viewer),
        });
        break;
      }
      case "flash":
        out.push({ text: `🔦 손전등: ${room(e.room).name}에 ${e.count}명 숨어 있다`, mine: e.seat === viewer });
        break;
      case "noise":
        out.push({ text: `🔊 ${room(e.room).name}에서 삐걱! 누군가 몰래 빠져나갔다${e.count > 1 ? ` (${e.count}명)` : ""}`, mine: false });
        break;
      case "rustle":
        out.push({ text: `🍃 ${room(e.room).name}에서 부스럭… 다리가 저린 누군가${e.count > 1 ? ` (${e.count}명)` : ""}`, mine: false });
        break;
      case "bump":
        out.push({ text: `😱 ${room(e.room).name}에 들어서던 ${nm(e.victim)}, ${nm(e.seat)}와 딱 마주쳤다!`, mine: e.victim === viewer || e.seat === viewer });
        break;
      case "home":
        out.push({ text: `🙌 ${nm(e.seat)} ${room(e.from).name}에서 뛰쳐나와 찜! (+3)`, mine: e.seat === viewer });
        break;
      case "blocked":
        out.push({ text: `🚫 ${nm(e.seat)} 찜하러 뛰었지만 ${nm(e.by)}에게 막혔다!`, mine: e.seat === viewer || e.by === viewer });
        break;
      case "sense":
        out.push({ text: e.present ? `💓 ${room(e.room).name}에 인기척이 느껴진다…` : `🤫 ${room(e.room).name}은 조용하다`, mine: false });
        break;
      case "survive":
        out.push({ text: `🐦 못 찾겠다 꾀꼬리! ${e.seats.map(nm).join(", ")} 끝까지 숨어 있었다 (+2)`, mine: e.seats.includes(viewer) });
        break;
      case "sweep":
        out.push({ text: `👁️ ${nm(e.seat)} 싹쓸이! 모두 찾아냈다`, mine: e.seat === viewer });
        break;
    }
  }
  return out;
}

export const MOVE_LABEL: Record<Move["kind"], { icon: string; label: string }> = {
  hide: { icon: "🫣", label: "여기 숨기" },
  stay: { icon: "🤫", label: "숨죽이기" },
  sneak: { icon: "🐾", label: "살금살금" },
  home: { icon: "🏃", label: "찜하러 달리기" },
  search: { icon: "🔍", label: "뒤지기" },
  move: { icon: "🚶", label: "이동" },
  flash: { icon: "🔦", label: "손전등" },
};
