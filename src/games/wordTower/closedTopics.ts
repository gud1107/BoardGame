/**
 * 단어 마천루 🎯 정답 모으기 모드 — 정답이 4~10개로 정해진 주제 (룰북 §15).
 *
 * 정답 목록이 곧 전부라서 심사 투표가 없다. 대신 흔히 쓰는 다른 표기를 `aliases`에 넉넉히 넣어
 * "맞게 썼는데 오답" 처리되는 일을 줄인다(입력은 공백·문장부호를 지운 뒤 비교).
 * WordTower.test.ts가 정답 수(4~10)·한글 형식·별칭 중복을 검사한다.
 */

export interface ClosedAnswer {
  readonly word: string;
  readonly aliases?: readonly string[];
}

export interface ClosedTopic {
  readonly id: string;
  readonly name: string;
  readonly emoji: string;
  readonly answers: readonly ClosedAnswer[];
}

const a = (word: string, ...aliases: string[]): ClosedAnswer => (aliases.length ? { word, aliases } : { word });

export const CLOSED_TOPICS: readonly ClosedTopic[] = [
  { id: "c-season", name: "계절", emoji: "🍂", answers: [a("봄", "봄철"), a("여름", "여름철"), a("가을", "가을철"), a("겨울", "겨울철")] },
  {
    id: "c-rainbow",
    name: "무지개 색",
    emoji: "🌈",
    answers: [a("빨강", "빨간색", "빨강색", "적색"), a("주황", "주황색"), a("노랑", "노란색", "노랑색", "황색"), a("초록", "초록색", "녹색"), a("파랑", "파란색", "파랑색", "청색"), a("남색", "쪽빛"), a("보라", "보라색", "자주")],
  },
  {
    id: "c-weekday",
    name: "요일",
    emoji: "📅",
    answers: [a("월요일", "월"), a("화요일", "화"), a("수요일", "수"), a("목요일", "목"), a("금요일", "금"), a("토요일", "토"), a("일요일", "일")],
  },
  { id: "c-planet", name: "태양계 행성", emoji: "🪐", answers: [a("수성"), a("금성"), a("지구"), a("화성"), a("목성"), a("토성"), a("천왕성"), a("해왕성")] },
  { id: "c-solfege", name: "계이름", emoji: "🎵", answers: [a("도"), a("레"), a("미"), a("파"), a("솔"), a("라"), a("시")] },
  { id: "c-ocean", name: "오대양", emoji: "🌊", answers: [a("태평양"), a("대서양"), a("인도양"), a("북극해", "북빙양"), a("남극해", "남빙양")] },
  {
    id: "c-continent",
    name: "대륙",
    emoji: "🌏",
    answers: [a("아시아"), a("유럽"), a("아프리카"), a("북아메리카", "북미", "북미대륙"), a("남아메리카", "남미", "남미대륙"), a("오세아니아", "호주대륙"), a("남극", "남극대륙")],
  },
  { id: "c-senses", name: "오감", emoji: "👁️", answers: [a("시각", "보기"), a("청각", "듣기"), a("후각", "냄새"), a("미각", "맛"), a("촉각", "만지기")] },
  { id: "c-yut", name: "윷놀이 결과", emoji: "🎲", answers: [a("도"), a("개"), a("걸"), a("윷"), a("모"), a("빽도", "뒷도")] },
  {
    id: "c-metro",
    name: "광역시",
    emoji: "🏙️",
    answers: [a("부산", "부산광역시"), a("대구", "대구광역시"), a("인천", "인천광역시"), a("광주", "광주광역시"), a("대전", "대전광역시"), a("울산", "울산광역시")],
  },
  { id: "c-chess", name: "체스 말", emoji: "♟️", answers: [a("킹", "왕"), a("퀸", "여왕"), a("룩", "성"), a("비숍", "주교"), a("나이트", "기사"), a("폰", "병사")] },
  { id: "c-olympic", name: "오륜기 색", emoji: "🏅", answers: [a("파랑", "파란색", "파랑색", "청색"), a("노랑", "노란색", "노랑색", "황색"), a("검정", "검은색", "검정색", "흑색"), a("초록", "초록색", "녹색"), a("빨강", "빨간색", "빨강색", "적색")] },
  { id: "c-arith", name: "사칙연산", emoji: "➕", answers: [a("덧셈", "더하기"), a("뺄셈", "빼기"), a("곱셈", "곱하기"), a("나눗셈", "나누기")] },
  { id: "c-compass", name: "동서남북", emoji: "🧭", answers: [a("동", "동쪽"), a("서", "서쪽"), a("남", "남쪽"), a("북", "북쪽")] },
  { id: "c-taste", name: "기본 맛", emoji: "👅", answers: [a("단맛"), a("짠맛"), a("신맛"), a("쓴맛"), a("감칠맛")] },
  { id: "c-palace", name: "서울 5대 궁궐", emoji: "🏯", answers: [a("경복궁"), a("창덕궁"), a("창경궁"), a("덕수궁"), a("경희궁")] },
  { id: "c-samul", name: "사물놀이 악기", emoji: "🥁", answers: [a("꽹과리"), a("징"), a("장구", "장고"), a("북")] },
  {
    id: "c-finger",
    name: "손가락",
    emoji: "✋",
    answers: [a("엄지", "엄지손가락"), a("검지", "집게손가락", "검지손가락"), a("중지", "가운뎃손가락", "중지손가락"), a("약지", "약손가락", "넷째손가락"), a("소지", "새끼손가락", "새끼")],
  },
  { id: "c-trigram", name: "태극기 4괘", emoji: "🇰🇷", answers: [a("건"), a("곤"), a("감"), a("리")] },
  { id: "c-suits", name: "트럼프 카드 무늬", emoji: "🃏", answers: [a("스페이드"), a("하트"), a("다이아몬드", "다이아"), a("클로버", "클럽")] },
  { id: "c-sagunja", name: "사군자", emoji: "🎋", answers: [a("매화", "매"), a("난초", "난"), a("국화", "국"), a("대나무", "죽", "대")] },
  { id: "c-5w1h", name: "육하원칙", emoji: "❓", answers: [a("누가"), a("언제"), a("어디서"), a("무엇을", "무엇"), a("어떻게"), a("왜")] },
  { id: "c-nutrient", name: "5대 영양소", emoji: "🥗", answers: [a("탄수화물"), a("단백질"), a("지방"), a("비타민"), a("무기질", "미네랄")] },
  {
    id: "c-province",
    name: "우리나라 도",
    emoji: "🗺️",
    answers: [
      a("경기도", "경기"),
      a("강원도", "강원", "강원특별자치도"),
      a("충청북도", "충북"),
      a("충청남도", "충남"),
      a("전라북도", "전북", "전북특별자치도"),
      a("전라남도", "전남"),
      a("경상북도", "경북"),
      a("경상남도", "경남"),
      a("제주도", "제주", "제주특별자치도"),
    ],
  },
  { id: "c-soccer", name: "축구 포지션", emoji: "⚽", answers: [a("공격수", "포워드", "스트라이커"), a("미드필더", "미드필드"), a("수비수", "수비", "디펜더"), a("골키퍼", "키퍼")] },
  { id: "c-organs", name: "오장", emoji: "🫀", answers: [a("간"), a("심장", "염통"), a("비장", "지라"), a("폐", "허파"), a("신장", "콩팥")] },
];

export const CLOSED_BY_ID: ReadonlyMap<string, ClosedTopic> = new Map(CLOSED_TOPICS.map((t) => [t.id, t]));

const lookupCache = new Map<string, ReadonlyMap<string, string>>();

/** 입력(정규화된 단어) → 정답 대표 표기. 정답이 아니면 undefined. */
export function closedAnswerFor(topicId: string, word: string): string | undefined {
  let map = lookupCache.get(topicId);
  if (!map) {
    const m = new Map<string, string>();
    for (const ans of CLOSED_BY_ID.get(topicId)?.answers ?? []) {
      m.set(ans.word, ans.word);
      for (const alias of ans.aliases ?? []) m.set(alias, ans.word);
    }
    map = m;
    lookupCache.set(topicId, map);
  }
  return map.get(word);
}
