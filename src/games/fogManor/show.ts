import { ROOMS, ROOM_BASE, SEAT_GLYPHS, SUSPECTS, WEAPONS, WEAPON_BASE, alibiText, cardLabel, cardsOf, matchesTrait, traitShort, traitText } from "./data";
import { clockMinutes, clockText, type Clue, type GameState, type Guess, type LogEntry } from "./engine";

/** 화면 문구 모음 — 기록 한 줄, 단서 문장, 사건 이야기, 수사 노트 자동 표시. */

export function seatTag(seat: number, names: Record<number, string>): string {
  return `${SEAT_GLYPHS[seat % SEAT_GLYPHS.length]} ${names[seat] ?? `${seat + 1}번`}`;
}

export function guessText(g: Guess): string {
  return `${cardLabel(g.suspect)} · ${cardLabel(g.weapon)} · ${cardLabel(g.room)}`;
}

export function clueText(c: Clue): string {
  return c.kind === "alibi" ? alibiText(c.card) : traitText(c.trait);
}

export function clueShort(c: Clue): string {
  return c.kind === "alibi" ? `${cardLabel(c.card)} ✗` : `${c.trait.cat === "suspect" ? "범인" : c.trait.cat === "weapon" ? "흉기" : "현장"} = ${traitShort(c.trait)}`;
}

/** 기록 한 줄 (보는 사람 기준) */
export function logLine(e: LogEntry, viewer: number, names: Record<number, string>, state: GameState): { icon: string; text: string; tone?: "good" | "bad" | "info" } {
  const who = (s: number) => (s === viewer ? "나" : seatTag(s, names));
  switch (e.kind) {
    case "move":
      return { icon: "🚶", text: `${who(e.seat)} → ${ROOMS[e.to].icon} ${ROOMS[e.to].name}${e.path.length > 1 ? " (통로)" : ""}` };
    case "ask": {
      const shown = e.shown === null ? "" : e.shown === -1 ? " · 한 장을 몰래 보여 줌" : ` · ${e.seat === viewer ? "받은" : "보여 준"} 카드 ${cardLabel(e.shown)}`;
      return { icon: "🗣️", text: `${who(e.seat)} → ${who(e.target)} 심문: ${e.cards.map(cardLabel).join(" · ")} → ${e.count}장${shown}`, tone: "info" };
    }
    case "search": {
      if (e.seat === viewer) {
        const c = state.clues[viewer]?.find((x) => x.id === e.clue);
        return { icon: "🔍", text: `내가 ${ROOMS[e.room].icon} ${ROOMS[e.room].name} 수색 — ${c ? clueShort(c) : "단서"}`, tone: "good" };
      }
      return { icon: "🔍", text: `${who(e.seat)}이(가) ${ROOMS[e.room].icon} ${ROOMS[e.room].name}을(를) 뒤져 단서를 가져갔다` };
    }
    case "bell":
      return { icon: "🔔", text: `괘종이 울린다 — ${ROOMS[e.room].icon} ${ROOMS[e.room].name}에서 무언가 떨어지는 소리! (새 단서)`, tone: "info" };
    case "vault":
      return { icon: "🗄️", text: `금고가 열렸다 — ${cardLabel(e.card)}는 정답이 아니다`, tone: "info" };
    case "accuse":
      return { icon: "⚖️", text: `${who(e.seat)} 고발: ${guessText(e.guess)} → ${e.correct ? "정답!" : "틀렸다 (누명)"}`, tone: e.correct ? "good" : "bad" };
    case "pass":
      return { icon: "💤", text: `${who(e.seat)} ${e.timeout ? "시간 초과" : "쉬기"}` };
    case "dawn":
      return { icon: "🌅", text: "새벽 6시 — 배가 들어온다. 마지막 추리!", tone: "info" };
    case "final":
      return { icon: "📜", text: `${who(e.seat)} 새벽 추리: ${e.guess ? `${guessText(e.guess)} → ${e.correct ? "정답!" : "오답"}` : "기권"}`, tone: e.correct ? "good" : e.guess ? "bad" : undefined };
  }
}

export function clockLabel(state: GameState): string {
  return clockText(clockMinutes(state));
}

/** 사건의 진상 이야기 (끝난 뒤) */
export function storyOf(sol: Guess): string[] {
  const s = SUSPECTS[sol.suspect];
  const w = WEAPONS[sol.weapon - WEAPON_BASE];
  const r = ROOMS[sol.room - ROOM_BASE];
  return [
    `범인은 ${s.icon} ${s.job} ${s.name}.`,
    `${s.motive}.`,
    `자정, ${r.icon} ${r.name}에서 ${w.icon} ${w.name}(으)로 남궁 회장을 해쳤다.`,
  ];
}

// ------------------------------------------------------------------ 수사 노트

/** 노트 칸: 좌석 0..n-1, n = ✉️ 봉투(정답) */
export type Mark = "" | "x" | "o" | "q";
export interface AutoFact {
  mark: Mark;
  why: string;
}

/**
 * 확실한 것만 자동 표시 (규칙서 §11): 내 손패 · 공개 카드 · 내가 본 카드 · 내 단서.
 * 공개 심문 장수는 사람이 직접 추리하도록 쓰지 않는다.
 */
export function autoFacts(view: GameState, me: number): Map<string, AutoFact> {
  const n = view.seatCount;
  const out = new Map<string, AutoFact>();
  const set = (card: number, col: number, mark: Mark, why: string) => {
    if (!out.has(`${card}:${col}`)) out.set(`${card}:${col}`, { mark, why });
  };
  const owned = (card: number, owner: number, why: string) => {
    for (let col = 0; col <= n; col++) set(card, col, col === owner ? "o" : "x", why);
  };
  for (const c of view.hands[me] ?? []) owned(c, me, "내 카드");
  for (const c of view.publicCards) for (let col = 0; col <= n; col++) set(c, col, "x", "공개 증거");
  for (const e of view.log) {
    if (e.kind === "ask" && e.seat === me && e.shown !== null && e.shown >= 0) owned(e.shown, e.target, "보여 받은 카드");
  }
  for (const c of cardsOf("suspect").concat(cardsOf("weapon"), cardsOf("room"))) {
    if (!(view.hands[me] ?? []).includes(c)) set(c, me, "x", "내 카드 아님");
  }
  for (const clue of view.clues[me] ?? []) {
    if (clue.kind === "alibi") set(clue.card, n, "x", "알리바이 단서");
    else for (const c of cardsOf(clue.trait.cat)) if (!matchesTrait(c, clue.trait)) set(c, n, "x", `단서: ${traitShort(clue.trait)}`);
  }
  if (view.phase === "ended" && view.solution) {
    for (const c of [view.solution.suspect, view.solution.weapon, view.solution.room]) set(c, n, "o", "정답");
  }
  return out;
}

export const MARK_CYCLE: Mark[] = ["", "x", "o", "q"];
export const MARK_GLYPH: Record<Mark, string> = { "": "", x: "✗", o: "✓", q: "?" };
