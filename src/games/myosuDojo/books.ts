/**
 * The four puzzle books of 묘수 도장 and their chapters. Stage ids are
 * unique across books (c… chess, b… billiards, a… alkkagi, u… curling,
 * d… domino) so one save map holds them all.
 */

import { CHESS_PUZZLES } from "./chess/puzzles";
import { CUE_STAGES } from "./cue/stages";
import { DOMINO_STAGES } from "./domino/stages";
import { CURL_STAGES, FLICK_STAGES } from "./flick/stages";

export type BookId = "chess" | "cue" | "flick" | "domino";

export interface Chapter {
  title: string;
  emoji: string;
  desc: string;
  ids: { id: string; title: string }[];
}

export interface Book {
  id: BookId;
  name: string;
  emoji: string;
  /** Which existing game's engine runs it (shown on the tab). */
  engine: string;
  blurb: string;
  chapters: Chapter[];
}

const t = (xs: { id: string; title: string }[]) => xs.map(({ id, title }) => ({ id, title }));

export const BOOKS: Book[] = [
  {
    id: "chess",
    name: "체스 N수 메이트",
    emoji: "♟️",
    engine: "체스",
    blurb: "백 차례. 흑이 어떻게 막아도 정해진 수 안에 체크메이트하세요. 흑은 가장 오래 버티는 수로 응수해요.",
    chapters: [
      { title: "한 수 메이트", emoji: "♙", desc: "단 한 수로 끝내기", ids: t(CHESS_PUZZLES.filter((p) => p.n === 1)) },
      { title: "두 수 메이트", emoji: "♘", desc: "어떻게 막아도 두 수 안에", ids: t(CHESS_PUZZLES.filter((p) => p.n === 2)) },
      { title: "세 수 메이트", emoji: "♛", desc: "끝까지 버티는 흑을 세 수 안에", ids: t(CHESS_PUZZLES.filter((p) => p.n === 3)) },
    ],
  },
  {
    id: "cue",
    name: "당구 한 큐",
    emoji: "🎱",
    engine: "당구 파티",
    blurb: "단 한 번의 큐. 방향·힘·당점을 맞춰 목표를 이루세요. 정답은 반드시 있어요.",
    chapters: [
      { title: "포켓볼", emoji: "🕳️", desc: "넣고, 피하고, 세우기", ids: t(CUE_STAGES.filter((s) => s.pockets)) },
      { title: "캐롬", emoji: "🔴", desc: "구멍 없는 테이블에서 두 공 맞히기", ids: t(CUE_STAGES.filter((s) => !s.pockets)) },
    ],
  },
  {
    id: "flick",
    name: "알까기 · 컬링 한 수",
    emoji: "🥏",
    engine: "알까기 대전 · 컬링 파티",
    blurb: "한 번 튕기고, 한 번 던지기. 물리가 판정하니 같은 수는 언제나 같은 결과예요.",
    chapters: [
      { title: "알까기", emoji: "⚪", desc: "흰 알 하나를 튕겨 검은 알 떨어뜨리기", ids: t(FLICK_STAGES) },
      { title: "컬링 마지막 스톤", emoji: "🥌", desc: "스위핑 없이 한 번에 점수 내기", ids: t(CURL_STAGES) },
    ],
  },
  {
    id: "domino",
    name: "도미노 설계",
    emoji: "🁢",
    engine: "도미노 연쇄",
    blurb: "도미노를 세우고 밀대를 쓰러뜨려 종을 모두 울리세요. 가장 적은 조각으로 해내면 ⭐⭐⭐.",
    chapters: [{ title: "종소리 설계도", emoji: "🔔", desc: "최소 조각으로 모든 종 울리기", ids: t(DOMINO_STAGES) }],
  },
];

export const ALL_IDS: string[] = BOOKS.flatMap((b) => b.chapters.flatMap((c) => c.ids.map((x) => x.id)));
export const bookOf = (id: string): BookId => BOOKS.find((b) => b.chapters.some((c) => c.ids.some((x) => x.id === id)))!.id;
