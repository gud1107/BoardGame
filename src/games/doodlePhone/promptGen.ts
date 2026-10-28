/**
 * Opening-prompt generator for the AI bots — a tiny grammar that stitches
 * situations together ("우주에서 라면 끓이는 펭귄", "케이크를 훔친 원숭이")
 * instead of only picking from a fixed list.
 *
 * - Pure and rng-injected: the bot's text travels as a normal SUBMIT_TEXT
 *   action, so every client sees the same words (no lockstep concerns).
 * - Every noun slot is something the bot artist (bot.ts) can draw, so a
 *   generated prompt still has a fighting chance of surviving the chain.
 * - Particles agree with the noun (을/를, 이/가, 와/과); every line fits
 *   TEXT_MAX_CHARS.
 */

/** Characters who can do things. */
const CREATURES = ["고양이", "강아지", "곰", "토끼", "돼지", "원숭이", "펭귄", "개구리", "공룡", "문어", "로봇", "눈사람", "쥐", "소", "새", "물고기", "할머니", "선생님"];
/** Things you can ride. */
const RIDES = ["자동차", "비행기", "배", "기차", "로켓", "구름", "공룡", "고래"];
/** Things. */
const OBJECTS = ["피자", "케이크", "우산", "모자", "휴대폰", "커피", "아이스크림", "수박", "책", "공", "하트", "별", "꽃", "번개", "무지개", "달", "해"];
const PLACES = ["우주", "바닷속", "구름 위", "편의점", "놀이공원", "남극", "지하철", "사막", "냉장고 속", "화산 위", "학교", "생일파티", "산꼭대기", "목욕탕"];
const ACTS = ["라면 끓이는", "춤추는", "잠자는", "요가하는", "셀카 찍는", "스키 타는", "노래하는", "낚시하는", "청소하는", "피자 배달하는", "화가 난", "출근하는", "엉엉 우는", "방귀 뀌는", "줄넘기하는", "축구하는", "기타 치는", "다이어트 중인", "로또에 당첨된", "사랑에 빠진", "책 읽는", "우산 쓴", "커피 마시는", "아이스크림 먹는", "휴대폰 보는", "길을 잃은"];
const GOING = ["출근하는", "여행 가는", "도망치는", "등교하는", "소풍 가는", "장 보러 가는"];
const EVENTS = ["줄다리기", "결혼식", "팔씨름", "숨바꼭질", "요리 대결", "첫 데이트", "눈싸움", "댄스 배틀", "가위바위보", "소개팅"];
const LOOKS = ["선글라스 낀", "왕관을 쓴", "거대한", "아주 작은", "날개 달린", "근육질", "털이 복슬복슬한", "무지개색", "투명한", "콧수염 난"];
const MOMENTS = ["첫 출근", "생일", "여름휴가", "비밀", "졸업식", "다이어트"];
const SHOPS = ["피자 가게", "편의점", "카페", "꽃집", "아이스크림 가게"];

function hasFinalConsonant(word: string): boolean {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0;
}

/** Attaches the right particle: josa("곰", "을", "를") → "곰을". */
export function josa(word: string, withFinal: string, withoutFinal: string): string {
  return word + (hasFinalConsonant(word) ? withFinal : withoutFinal);
}

const pick = <T,>(list: readonly T[], rng: () => number): T => list[Math.floor(rng() * list.length)];

/** Two different entries. */
function pickTwo<T>(list: readonly T[], rng: () => number): [T, T] {
  const a = pick(list, rng);
  let b = pick(list, rng);
  for (let i = 0; i < 8 && b === a; i++) b = pick(list, rng);
  return [a, b];
}

const PATTERNS: readonly ((rng: () => number) => string)[] = [
  (r) => `${pick(PLACES, r)}에서 ${pick(ACTS, r)} ${pick(CREATURES, r)}`,
  (r) => `${josa(pick(RIDES, r), "을", "를")} 타고 ${pick(GOING, r)} ${pick(CREATURES, r)}`,
  (r) => {
    const [a, b] = pickTwo(CREATURES, r);
    return `${josa(a, "과", "와")} ${b}의 ${pick(EVENTS, r)}`;
  },
  (r) => `${pick(LOOKS, r)} ${pick(CREATURES, r)}의 ${pick(MOMENTS, r)}`,
  (r) => `${josa(pick(OBJECTS, r), "이", "가")} 된 ${pick(CREATURES, r)}`,
  (r) => {
    const [a, b] = pickTwo(CREATURES, r);
    return `${josa(a, "을", "를")} 피해 도망치는 ${b}`;
  },
  (r) => {
    const [a, b] = pickTwo(CREATURES, r);
    return `${a} 등에 탄 ${b}`;
  },
  (r) => `${josa(pick(CREATURES, r), "이", "가")} 차린 ${pick(SHOPS, r)}`,
  (r) => `${josa(pick(OBJECTS, r), "을", "를")} 훔친 ${pick(CREATURES, r)}`,
  (r) => {
    const [a, b] = pickTwo(OBJECTS, r);
    return `${a} 모양 ${b}`;
  },
];

/** A fresh opening prompt. */
export function generatePrompt(rng: () => number): string {
  return pick(PATTERNS, rng)(rng);
}

/** Number of distinct patterns (for tests). */
export const PROMPT_PATTERN_COUNT = PATTERNS.length;
