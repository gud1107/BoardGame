/**
 * Curated Korean noun word bank, bucketed by syllable count (2~5, per
 * `boardGameRule/언어의조각/언어의조각.md` §2's "글자 수 자율 지정").
 *
 * The rulebook requires secret/guessed words to be "표준 국어대사전(또는
 * 표준 단어장)에 등재된 명사" — a full dictionary isn't embeddable here, so
 * (same spirit as every digital Wordle clone, which always plays against a
 * fixed word list rather than an unbounded dictionary) this module is that
 * project's "표준 단어장": a hand-picked list of common, unambiguous,
 * pure-Hangul nouns. Every word was verified to have exactly the syllable
 * count of its bucket (JS string length == Hangul syllable-block count,
 * since each precomposed syllable is one UTF-16 code unit for all words
 * here) — see the module's own `isPureHangulWord` + length check reused
 * from `hangul.ts`.
 */

import { isPureHangulWord } from "./hangul";

export const WORD_BANK: Record<number, string[]> = {
  2: [
    "나무", "사과", "바다", "하늘", "구름", "의자", "책상", "거울", "인형", "시계",
    "안경", "우산", "지갑", "열쇠", "편지", "신발", "모자", "장갑", "반지", "냄비",
    "접시", "그릇", "바늘", "단추", "지퍼", "벨트", "가방", "베개", "이불", "담요",
    "커튼", "카펫", "전등", "촛불", "화분", "꽃병", "열매", "씨앗", "뿌리", "줄기",
    "나비", "매미", "여우", "사자", "기린", "토끼", "오리", "거위", "참새", "까치",
    "고래", "상어", "문어", "새우", "조개", "제비", "펭귄", "호수", "폭포", "동굴",
    "사막", "기차", "트럭", "버스", "보트", "계단", "창문", "지붕", "마당", "대문",
    "벽돌", "기와", "굴뚝", "다리", "터널", "학교", "병원", "약국", "은행", "시장",
    "공원", "극장", "연필", "가위", "공책", "물감", "바지", "치마", "셔츠", "외투",
    "장화", "잠옷", "한복", "딸기", "포도", "수박", "참외", "감귤", "레몬", "당근",
    "감자", "양파", "마늘", "호박", "오이", "가지", "우유", "치즈", "버터", "계란",
    "국수", "라면", "김밥", "기타", "드럼", "단소", "장구", "축구", "야구", "농구",
    "배구", "탁구", "수영", "여름", "가을", "겨울", "아침", "점심", "저녁", "새벽",
    "오늘", "내일", "누나", "언니", "오빠", "동생", "삼촌", "이모", "의사", "화가",
    "가수", "배우", "기자", "태양", "번개", "천둥", "바람",
  ],
  3: [
    "달팽이", "까마귀", "독수리", "눈사람", "비행기", "자전거", "울타리", "도서관",
    "놀이터", "박물관", "지우개", "크레용", "도화지", "목도리", "운동화", "수영복",
    "복숭아", "오렌지", "바나나", "고구마", "시금치", "떡볶이", "불고기", "피아노",
    "트럼펫", "플루트", "꽹과리", "테니스", "달리기", "줄넘기", "태권도", "할머니",
    "아버지", "어머니", "경찰관", "소방관", "간호사", "선생님", "요리사", "무지개",
    "컴퓨터", "전화기", "냉장고", "세탁기", "청소기", "선풍기", "에어컨", "스피커",
    "마이크", "윷놀이", "자치기",
  ],
  4: [
    "오토바이", "파인애플", "브로콜리", "바이올린", "하모니카", "할아버지", "텔레비전",
    "숨바꼭질", "술래잡기", "제기차기", "팽이치기", "공기놀이", "딱지치기", "비석치기",
    "놀이공원", "횡단보도", "고속도로", "지하철역", "공중전화", "할인마트", "체육대회",
    "졸업식장", "어린이집", "초등학교", "고등학교", "헬리콥터", "경비행기", "드라이기",
    "냉방장치", "세계지도", "인공지능", "동물병원", "종합병원", "경찰서장",
  ],
  5: [
    "엘리베이터", "가위바위보", "우주정거장", "자동판매기", "버스정류장", "소방자동차",
    "김치냉장고", "전자레인지", "식기세척기", "진공청소기", "세탁건조기", "공기청정기",
    "실내수영장",
  ],
};

/** All valid word lengths per §2 — 2글자~5글자. */
export const MIN_WORD_LENGTH = 2;
export const MAX_WORD_LENGTH = 5;

const WORD_SETS: Record<number, Set<string>> = Object.fromEntries(
  Object.entries(WORD_BANK).map(([len, words]) => [Number(len), new Set(words)]),
);

/** Words of a given syllable length, for UI pickers / random secret-word suggestions. */
export function wordsOfLength(length: number): string[] {
  return WORD_BANK[length] ?? [];
}

/**
 * A word is valid iff it's pure Hangul, matches the agreed syllable count,
 * and is a member of this module's word bank (see module doc for why a
 * fixed word bank stands in for "표준 국어대사전 등재").
 */
export function isValidWord(word: string, wordLength: number): boolean {
  if (!isPureHangulWord(word)) return false;
  if (word.length !== wordLength) return false;
  return WORD_SETS[wordLength]?.has(word) ?? false;
}
