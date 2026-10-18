import type { GameId } from "@/games/types";

/**
 * One-line hooks printed on the lobby's poster cards (`GamePosterCard.tsx`) —
 * a movie-poster style "왜 해봐야 하나" line, not a rules summary (that's
 * what the detail page and 룰북 are for). Keep each to about 20 characters
 * so it fits one line on a 2-column phone grid. Games without an entry fall
 * back to the first sentence of `description`.
 */
export const POSTER_TAGLINES: Partial<Record<GameId, string>> = {
  hanamikoji: "게이샤의 마음, 단 4번의 수로 훔쳐라",
  splendor: "보석 하나로 시작해 제국을 세워라",
  "splendor-duel": "보석판 위 1:1 두뇌 쟁탈전",
  "lotr-duel": "절대반지냐, 사우론이냐",
  "bluff-roulette": "거짓말이 들키면 방아쇠가 당겨진다",
  "tavern-brawl": "사고, 세우고, 자동으로 박살내라",
  "god-life-planner": "일주일 갓생, 누가 먼저 완성할까",
  chess: "64칸 위의 영원한 전쟁",
  curling: "던지고! 쓸고! 소리 질러!",
  alkkagi: "튕겨라, 떨어뜨려라, 딱!",
  "wobble-tower": "한 칸만 더… 와르르!",
  "word-tower": "단어를 쏟아내 하늘까지 쌓아라",
  "liar-game": "우리 중에 거짓말쟁이가 있다",
  telepathy: "말없이, 신호없이, 마음으로만",
  "merge-defense": "합치고 또 합쳐라, 전설이 나올 때까지",
  "ink-duel": "내가 그린 낙서가 무기가 된다",
  "city-chase": "도둑은 숨고, 헬기는 쫓는다",
  "doodle-phone": "그림이 돌고 돌면 대참사가 된다",
  avalon: "원정대 안에 배신자가 숨어 있다",
  bang: "보안관을 쏴라, 정체는 숨겨라",
  "grid-poker": "5×5 판 위의 포커 데스게임",
  "no-thanks": "노땡스! 칩이 떨어지면 끝이다",
  perudo: "컵 속 주사위, 허세로 세어라",
  century: "향신료를 싣고 실크로드를 달려라",
  mafia: "밤이 되었습니다. 마피아는 고개를 드세요",
  "spot-difference": "눈 크게 떠! 팀 대결 틀린 그림 찾기",
  "five-cucumbers": "마지막 판만은 절대 이기지 마라",
  "las-vegas": "주사위 한 번에 지폐 다발이 바뀐다",
  dalmuti: "왕이 될 것인가, 노예가 될 것인가",
  "summoners-rift": "협곡의 던전, 끝까지 버티는 자가 승리",
  coyote: "내 숫자만 모른다. 코요테!",
  "love-letter": "공주에게 닿는 편지는 단 한 통",
  "for-sale": "싸게 사서 비싸게 팔아라",
  "mal-dalli-ja": "오아시스까지 먼저 달려라",
  "pieces-of-language": "글자 조각으로 비밀 단어를 깨라",
  coup: "없는 카드도 있는 척, 쿠!",
  "destiny-war-39": "몇 번 이길지 맞혀야 이긴다",
  "show-me-the-coin": "가림판 뒤의 코인, 올인할 수 있나",
  "love-wins-all": "가위바위보에 사랑을 걸어라",
  worm: "먹고, 커지고, 들이받아라",
  "hungry-shark": "배고프다. 바다 전체가 먹이다",
  "crab-survival": "작은 게가 해변의 왕이 되기까지",
  "lost-cities": "잃어버린 도시로, 모험엔 대가가 있다",
  "rat-a-tat-cat": "기억해라, 그리고 속여라",
  "mine-of-oblivion": "지뢰를 묻은 자리, 기억나나?",
  "mine-of-oblivion-2": "째깍째깍, 시한폭탄이 숨어 있다",
  "hill-of-truth": "질문 하나로 진실에 다가가라",
  "great-legacy": "국장·미장·코인, 영끌 경매 한판",
  "memory-feast": "보였다 사라진 접시, 기억하나?",
};

export function getPosterTagline(game: { id: GameId; description: string }): string {
  const line = POSTER_TAGLINES[game.id];
  if (line) return line;
  const first = game.description.split(/(?<=[.!?。])\s/)[0] ?? game.description;
  return first.length > 28 ? `${first.slice(0, 27)}…` : first;
}
