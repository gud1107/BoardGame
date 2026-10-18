import type { StatTotalsRecord } from "@/lib/db/types";
import { GAME_REGISTRY } from "@/games/registry";
import type { StatDetails } from "./details";

/**
 * Per-game achievements (업적), derived purely from the personal stat totals
 * (`played` / `wins` / `details` / bot-filter slices). Nothing extra is
 * stored: the totals already sync to the account through
 * `record_match_stats`, so an achievement unlocked on one device shows on
 * every device, and adding a new achievement retroactively unlocks it for
 * anyone whose past totals already qualify.
 *
 * Detail keys come from each game's `self.details` (merge rules in
 * details.ts: `max*` = best, `min*` = lowest, others summed).
 */
export interface Achievement {
  /** `${gameId}:${key}` — stable, used to diff before/after a match. */
  id: string;
  gameId: string;
  emoji: string;
  title: string;
  desc: string;
  goal: number;
  /** Current progress toward `goal` (clamped by the caller). */
  value: (t: StatTotalsRecord) => number;
}

type Spec = [key: string, emoji: string, title: string, desc: string, goal: number, value: (t: StatTotalsRecord) => number];

const d = (t: StatTotalsRecord): StatDetails => t.details ?? {};
/** Sum / best-value detail as progress. */
const k = (key: string) => (t: StatTotalsRecord) => d(t)[key] ?? 0;
/** `min*` detail: done (1) once it has ever been at or under `limit`. */
const atMost = (key: string, limit: number) => (t: StatTotalsRecord) => {
  const v = d(t)[key];
  return v !== undefined && v <= limit ? 1 : 0;
};

const SOLO_IDS = new Set(GAME_REGISTRY.filter((g) => g.players.max === 1).map((g) => g.id));

/** Every game gets these. */
function commonSpecs(gameId: string): Spec[] {
  if (SOLO_IDS.has(gameId)) {
    return [
      ["first-run", "🎮", "첫 도전", "첫 판을 끝까지 마치기", 1, (t) => t.played],
      ["ten-runs", "🔁", "단골 도전자", "10판 플레이", 10, (t) => t.played],
      ["fifty-runs", "🏅", "끈기의 화신", "50판 플레이", 50, (t) => t.played],
    ];
  }
  return [
    ["first-win", "🥇", "첫 승리", "1등으로 한 판 끝내기", 1, (t) => t.wins],
    ["ten-games", "🎲", "단골손님", "10판 플레이", 10, (t) => t.played],
    ["ten-wins", "🏆", "베테랑", "누적 10승", 10, (t) => t.wins],
    ["human-wins", "👥", "사람 잡는 고수", "봇 없이 사람끼리 한 판에서 5승", 5, (t) => t.noBot?.wins ?? 0],
    ["bot-slayer", "🤖", "AI 정복자", "Lv.10 봇이 있는 판에서 1등", 1, (t) => t.byBotLevel?.["10"]?.wins ?? 0],
  ];
}

/** Game-specific conditions. */
const GAME_SPECS: Record<string, Spec[]> = {
  avalon: [
    ["good-5", "🛡️", "원탁의 수호자", "선 진영으로 5승", 5, k("goodWins")],
    ["evil-5", "🗡️", "어둠의 군주", "악 진영으로 5승", 5, k("evilWins")],
    ["merlin", "🔮", "들키지 않은 멀린", "멀린으로 승리", 1, k("merlinWins")],
    ["assassin", "🎯", "정확한 암살", "암살자로 멀린 지목 성공", 1, k("assassinSnipes")],
    ["flawless", "✨", "완벽한 원정", "실패 원정 없이 선 진영 승리", 1, k("flawlessQuests")],
  ],
  bang: [
    ["sheriff", "⭐", "마을의 보안관", "보안관으로 승리", 1, k("sheriffWins")],
    ["deputy", "🤠", "든든한 부관", "부관으로 승리", 1, k("deputyWins")],
    ["outlaw-3", "💰", "현상수배범", "무법자로 3승", 3, k("outlawWins")],
    ["renegade", "🐍", "배신자의 꿈", "배신자로 단독 승리", 1, k("renegadeWins")],
    ["survivor-5", "❤️", "끝까지 서 있는 자", "살아남은 채로 5승", 5, k("survivedWins")],
  ],
  mafia: [
    ["mafia-3", "🕴️", "완전범죄", "마피아 팀으로 3승", 3, k("mafiaWins")],
    ["citizen-5", "⚖️", "정의 구현", "시민 팀으로 5승", 5, k("citizenWins")],
    ["survivor-3", "🌅", "살아남은 증인", "살아남은 채로 3승", 3, k("survivedWins")],
  ],
  "grid-poker": [["score-30", "🃏", "족보 수집가", "누적 30점", 30, k("totalScore")]],
  "lost-cities": [
    ["score-50", "🧭", "탐험가", "한 판 50점 이상", 50, k("maxScore")],
    ["score-100", "🗺️", "전설의 원정대", "한 판 100점 이상", 100, k("maxScore")],
  ],
  "lotr-duel": [
    ["fellowship", "💍", "반지 원정대", "원정대로 승리", 1, k("fellowshipWins")],
    ["sauron", "👁️", "어둠의 군주", "사우론으로 승리", 1, k("sauronWins")],
    ["ring-quest", "🌋", "운명의 산", "반지 운반으로 승리", 1, k("ringQuestWins")],
    ["conquest", "⚔️", "정복자", "정복으로 승리", 1, k("conquestWins")],
  ],
  "mine-of-oblivion": [
    ["treasure-10", "💎", "보물 사냥꾼", "누적 보물 10개", 10, k("treasures")],
    ["flawless", "🦺", "무사고 광부", "지뢰를 한 번도 안 밟고 승리", 1, k("flawlessWins")],
  ],
  "mine-of-oblivion-2": [
    ["treasure-10", "💎", "보물 사냥꾼", "누적 보물 10개", 10, k("treasures")],
    ["safe-bomb-5", "💣", "폭탄 전문가", "빈 곳에서 안전 격발 5회", 5, k("safeBombs")],
    ["flawless", "🦺", "무사고 광부", "지뢰·폭발 피해 없이 승리", 1, k("flawlessWins")],
  ],
  "splendor-duel": [
    ["prestige", "💠", "명성의 승리", "명성 점수로 승리", 1, k("prestigeWins")],
    ["crowns", "👑", "왕관의 승리", "왕관으로 승리", 1, k("crownWins")],
    ["color", "🎨", "한 색의 장인", "한 색 점수로 승리", 1, k("colorWins")],
  ],
  hanamikoji: [
    ["first-round", "🌸", "단숨의 매혹", "1라운드 만에 승리", 1, k("firstRoundWins")],
    ["geisha-5", "🏮", "꽃길의 주인", "게이샤 5명 이상 확보한 채로 끝내기", 5, k("maxGeishas")],
  ],
  "love-wins-all": [
    ["lwa2-3", "💞", "시즌 2의 연인", "러브 윈즈 올 2 규칙으로 3승", 3, k("lwa2Wins")],
    ["chips-60", "🪙", "사랑의 독점", "칩 60개 이상으로 끝내기", 60, k("maxChips")],
  ],
  "mal-dalli-ja": [["fast-40", "🐎", "질주하는 말", "40턴 안에 승리", 1, atMost("minWinTurns", 40)]],
  "memory-feast": [
    ["perfect", "🍽️", "완벽한 기억력", "벌점 없이 승리", 1, k("perfectWins")],
    ["hard-3", "🧠", "만찬의 대가", "어려움 난이도 3승", 3, k("hardWins")],
  ],
  "pieces-of-language": [
    ["two-guess", "🔤", "직감의 언어", "2번 이내 추측으로 승리", 1, atMost("minWinGuesses", 2)],
    ["one-guess", "🎯", "한 방에!", "첫 추측으로 정답", 1, atMost("minWinGuesses", 1)],
  ],
  "show-me-the-coin": [
    ["fast-5", "⚡", "속전속결", "5라운드 안에 승리", 1, atMost("minWinRounds", 5)],
    ["fast-3", "🥊", "원펀치 KO", "3라운드 안에 승리", 1, atMost("minWinRounds", 3)],
  ],
  "city-chase": [
    ["thief-3", "🦹", "잡히지 않는 괴도", "도둑으로 3승", 3, k("thiefWins")],
    ["police-3", "🚓", "명수사관", "경찰로 3승", 3, k("policeWins")],
    ["quick-catch", "🚨", "신속 검거", "4라운드 안에 도둑 검거", 1, atMost("minCatchRound", 4)],
  ],
  coup: [
    ["flawless", "🎭", "무결점 정치가", "영향력을 하나도 잃지 않고 승리", 1, k("flawlessWins")],
    ["coins-10", "💰", "쿠데타 자금", "코인 10개 이상으로 끝내기", 10, k("maxCoins")],
  ],
  "destiny-war-39": [
    ["exact-20", "🔮", "운명을 읽는 자", "누적 예측 적중 20라운드", 20, k("exactRounds")],
    ["exact-6", "📜", "예언자", "한 판에 6라운드 이상 예측 적중", 6, k("maxExactRounds")],
  ],
  "ink-duel": [
    ["dmg-100", "🖋️", "잉크 폭풍", "한 판에 피해 100 이상", 100, k("maxDamage")],
    ["dmg-2000", "🌊", "잉크의 바다", "누적 피해 2,000", 2000, k("damage")],
  ],
  "las-vegas": [
    ["money-300k", "🎰", "카지노 거물", "한 판에 $300,000 이상", 300_000, k("maxMoney")],
    ["bill-90k", "💸", "잭팟", "$90,000 지폐 획득", 90_000, k("maxBill")],
  ],
  "love-letter": [
    ["princess", "👸", "공주의 편지", "공주를 들고 승리", 1, k("princessWins")],
    ["last-standing-5", "💌", "마지막 연인", "모두 탈락시키고 5승", 5, k("eliminationWins")],
  ],
  "no-thanks": [
    ["zero-card", "🙅", "노땡스 장인", "카드 한 장 없이 승리", 1, k("zeroCardWins")],
    ["chips-20", "🪙", "칩 부자", "칩 20개 이상 남기고 끝내기", 20, k("maxChipsLeft")],
  ],
  splendor: [
    ["score-20", "💎", "보석 상단주", "한 판 20점 이상", 20, k("maxScore")],
    ["nobles-10", "🎩", "귀족의 후원", "누적 귀족 10명", 10, k("nobles")],
  ],
  "summoners-rift": [
    ["flawless", "🧙", "무결점 소환사", "실패 토큰 없이 승리", 1, k("flawlessWins")],
    ["success-20", "✨", "소환의 대가", "누적 성공 토큰 20개", 20, k("successes")],
  ],
  "bluff-roulette": [
    ["detector-20", "🕵", "거짓말 탐지기", "\"거짓말!\" 적중 누적 20회", 20, k("liarCorrect")],
    ["steel-4", "🍀", "강철 심장", "한 판에서 방아쇠 4번 당기고 살아남기", 4, k("maxPullsSurvived")],
    ["untouched", "😎", "손대지 않은 리볼버", "방아쇠 없이 1위", 1, k("flawlessWins")],
    ["skull", "💀", "해골의 주인", "해골 발동 성공", 1, k("skullTriggers")],
  ],
  "tavern-brawl": [
    ["champion-1", "🍺", "여관의 챔피언", "1위 달성", 1, k("firstPlaces")],
    ["top4-10", "🍻", "단골 손님", "4위 안에 10번", 10, k("topFour")],
    ["golden-10", "✨", "황금 수집가", "황금 유닛 10개 만들기", 10, k("triples")],
    ["tier6-3", "🏰", "최고급 여관", "여관 6등급 3번", 3, k("tier6")],
  ],
  "god-life-planner": [
    ["score-150", "📅", "갓생 장인", "한 판 150점 이상", 150, k("maxScore")],
    ["goals-5", "🎯", "인생 설계자", "인생 목표 달성 5번", 5, k("goalsMet")],
    ["habits-4", "🌱", "루틴 마스터", "수면이 아닌 습관 4개로 마무리", 4, k("maxHabits")],
    ["flawless-3", "🧘", "번아웃 제로", "붕괴 없이 일주일 3번", 3, k("flawlessWeeks")],
  ],
  curling: [
    ["button-1", "🎯", "첫 버튼", "아무것도 안 맞히고 버튼 위에 멈추기", 1, k("buttons")],
    ["button-10", "🥌", "버튼 장인", "버튼 누적 10번", 10, k("buttons")],
    ["double-1", "🔥", "더블 테이크아웃", "한 번에 상대 스톤 2개 이상 내보내기", 1, k("doubles")],
    ["big-end", "🏔️", "빅 엔드", "한 엔드에 3점 이상", 3, k("maxEnd")],
    ["steal-1", "🕵️", "스틸!", "해머 없이 엔드 득점", 1, k("steals")],
    ["party-20", "🎉", "파티 피플", "파티 스톤 20번 사용", 20, k("partyStones")],
    ["takeout-50", "💥", "테이크아웃 머신", "상대 스톤 누적 50개 내보내기", 50, k("takeouts")],
  ],
  alkkagi: [
    ["knock-1", "⚫", "첫 알까기", "상대 알 1개 떨어뜨리기", 1, k("knocked")],
    ["double-1", "💥", "더블킬", "한 번에 2개 이상 떨어뜨리기", 1, k("multiKnocks")],
    ["flawless-1", "🛡️", "무결점 승리", "알을 하나도 안 잃고 판 1등", 1, k("flawless")],
    ["king-3", "👑", "왕 사냥꾼", "왕알 모드에서 왕 잡기 3번", 3, k("kingKills")],
    ["knock-100", "🎯", "알까기 장인", "상대 알 누적 100개", 100, k("knocked")],
  ],
  "wobble-tower": [
    ["builder-1", "🏅", "마지막 건축가", "무너지기 직전에 마지막으로 올리기 1번", 1, k("lastBuilder")],
    ["pulls-50", "🪵", "목수의 손", "빼기 성공 누적 50번", 50, k("pulls")],
    ["perfect-10", "🧘", "숨 참고 쑥", "손놀림 95% 이상 빼기 10번", 10, k("perfectPulls")],
    ["risky-15", "😰", "외줄 타기", "빈칸 있는 층에서 빼고 버티기 15번", 15, k("riskyPulls")],
    ["tall-30", "🏗️", "하늘 찌르기", "탑을 30층 이상 쌓기", 30, k("maxLevels")],
  ],
  "word-tower": [
    ["win-1", "🏙️", "첫 마천루", "라운드 1등 1번", 1, k("roundWins")],
    ["height-40", "🏗️", "초고층 건축가", "한 라운드 40층 이상", 40, k("maxHeight")],
    ["streak-3", "🔥", "연속 준공", "라운드 3연승", 3, k("bestStreak")],
    ["words-300", "📚", "걸어 다니는 사전", "누적 단어 300개", 300, k("words")],
    ["approved-20", "🗳️", "설득의 달인", "심사로 인정받은 단어 20개", 20, k("approvedWords")],
    ["complete-3", "🧹", "싹쓸이", "정답 모으기에서 정답을 혼자 전부 차지 3번", 3, k("completedTopics")],
  ],
  "liar-game": [
    ["escape-5", "🎭", "완벽한 위장", "라이어로 지목을 5번 피함", 5, k("liarEscapes")],
    ["guess-3", "🔍", "역전의 한 수", "들킨 뒤 제시어를 맞혀 역전 3번", 3, k("liarGuesses")],
    ["detect-20", "🕵️", "거짓말 탐지기", "라이어에게 투표 적중 20번", 20, k("correctVotes")],
    ["score-15", "🏆", "판의 지배자", "한 판 15점 이상", 15, k("maxScore")],
  ],
  telepathy: [
    ["level-5", "📡", "주파수 맞추기", "한 판에 레벨 5 통과", 5, k("maxLevel")],
    ["flawless", "🌌", "완전한 동기화", "실수 없이 마지막 레벨까지 승리", 1, k("flawlessWins")],
    ["no-star", "🧘", "번뜩임 없이", "⚡를 한 번도 안 쓰고 승리", 1, k("noStarWins")],
    ["perfect-20", "✨", "흔들림 없는 마음", "실수 없이 통과한 레벨 누적 20개", 20, k("perfectLevels")],
    ["grace-10", "⏱", "아슬아슬", "0.25초 관용 판정으로 실수를 피한 순간 10번", 10, k("graceSaves")],
  ],
  worm: [
    ["len-50", "🐛", "거대 지렁이", "길이 50 달성", 50, k("maxLength")],
    ["len-150", "🐉", "대지의 용", "길이 150 달성", 150, k("maxLength")],
  ],
  "hill-of-truth": [
    ["green-30", "🟢", "진실 탐구자", "누적 초록불 30개", 30, k("greenAnswers")],
    ["quick-3", "💡", "번뜩이는 추리", "질문 3개 이내로 정답", 1, atMost("minWinQuestions", 3)],
  ],
  perudo: [
    ["dudo-20", "🎲", "거짓말 탐지기", "\"페루도!\" 적중 20회", 20, k("dudoCorrect")],
    ["exact", "🎯", "경계 적중", "모두를 1개씩 잃게 하기", 1, k("exactHits")],
    ["comeback", "🔥", "주사위 하나의 기적", "주사위 1개에서 역전승", 1, k("oneDieComebacks")],
  ],
  dalmuti: [
    ["peon-win", "🧹", "농노의 반란", "농노로 시작해 1등", 1, k("winAsPeon")],
    ["grand-revolution", "🚩", "대혁명", "대혁명 일으키기", 1, k("grandRevolutions")],
    ["joker-finish", "🃏", "광대의 마무리", "조커로 마무리", 1, k("jokerFinishes")],
  ],
  "five-cucumbers": [
    ["one-defense", "🥒", "1의 방패", "마지막 트릭에서 1로 방어", 1, k("oneCardDefenses")],
    ["top-10", "🔝", "15의 지배자", "15 카드로 트릭 10회", 10, k("topCardTricks")],
  ],
  coyote: [
    ["coyote-20", "🐺", "코요테 사냥꾼", "\"코요테!\" 적중 20회", 20, k("coyoteCorrect")],
    ["flawless", "💖", "무결점 승리", "하트를 잃지 않고 1위", 1, k("flawlessWins")],
  ],
  "rat-a-tat-cat": [
    ["zero", "🐱", "퍼펙트 핸드", "0점 핸드 만들기", 1, k("zeroHands")],
    ["call-5", "📣", "확신의 외침", "\"랫어탯캣!\" 선언 후 1등 5회", 5, k("ratCallWins")],
  ],
  century: [
    ["gold-10", "🥇", "금화 수집가", "누적 금화 10개", 10, k("goldCoins")],
    ["fast-win", "🐫", "빠른 대상", "25라운드 안에 승리", 1, atMost("minWinRounds", 25)],
  ],
  "spot-difference": [
    ["spots-100", "🔍", "매의 눈", "누적 틀린 곳 100개", 100, k("spotsFound")],
    ["perfect", "🎯", "오답 제로", "오클릭 없는 퍼펙트 판", 1, k("perfectGames")],
    ["lv10", "🤖", "AI보다 빠른 눈", "Lv.10 봇 상대 승리", 1, k("lv10BotWins")],
  ],
  "doodle-phone": [
    ["exact", "🎯", "텔레파시", "원래 문장을 정확히 맞히기", 1, k("exactGuesses")],
    ["reactions-50", "😂", "인기 화백", "누적 반응 50개", 50, k("reactionsReceived")],
    ["drawings-30", "🖍️", "열정 화가", "그림 30장 그리기", 30, k("drawings")],
  ],
  "for-sale": [
    ["won-30", "🏰", "30번 매물의 주인", "30번 매물 보유 + 1위", 1, k("won30")],
    ["sold-30-zero", "🤦", "뼈아픈 거래", "30번 매물을 0원에 팔기", 1, k("sold30ForZero")],
  ],
  "great-legacy": [
    ["synergy-3", "🏛️", "컬렉터", "한 판에 컬렉션 3개 완성", 3, k("maxSynergies")],
    ["broke", "💸", "빈털터리", "코인 0으로 끝낸 판", 1, k("brokeGames")],
  ],
  "merge-defense": [
    ["wave-30", "🌊", "30웨이브 생존", "WAVE 30 도달", 30, k("maxWave")],
    ["rage", "😡", "광폭화 진압", "광폭화 보스·전쟁군주 처치", 1, k("rageKills")],
    ["combo-8", "⚡", "치명타 연쇄", "치명타 8콤보", 8, k("maxCritCombo")],
  ],
  "hungry-shark": [
    ["all-clear", "🦈", "미션 올클리어", "한 잠수에서 미션 모두 달성", 1, k("missionAllClears")],
    ["streak-5", "🔥", "연속 올클리어", "5연속 미션 올클리어", 5, k("maxMissionStreak")],
  ],
  "crab-survival": [
    ["first", "👑", "게들의 왕", "1등으로 살아남기", 1, k("firsts")],
    ["kills-10", "🦀", "집게 폭풍", "한 판에 10마리 처치", 10, k("maxKills")],
  ],
};

const cache = new Map<string, Achievement[]>();

export function achievementsFor(gameId: string): Achievement[] {
  let list = cache.get(gameId);
  if (!list) {
    list = [...commonSpecs(gameId), ...(GAME_SPECS[gameId] ?? [])].map(([key, emoji, title, desc, goal, value]) => ({
      id: `${gameId}:${key}`,
      gameId,
      emoji,
      title,
      desc,
      goal,
      value,
    }));
    cache.set(gameId, list);
  }
  return list;
}

export interface AchievementStatus extends Achievement {
  progress: number;
  unlocked: boolean;
}

export function evaluateAchievements(gameId: string, totals: StatTotalsRecord | null | undefined): AchievementStatus[] {
  return achievementsFor(gameId).map((a) => {
    const raw = totals ? a.value(totals) : 0;
    const progress = Math.max(0, Math.min(a.goal, Number.isFinite(raw) ? raw : 0));
    return { ...a, progress, unlocked: progress >= a.goal };
  });
}

/** Achievements that `after` has and `before` didn't — for the post-game card. */
export function newlyUnlocked(gameId: string, before: StatTotalsRecord | null, after: StatTotalsRecord | null): AchievementStatus[] {
  const was = new Set(evaluateAchievements(gameId, before).filter((a) => a.unlocked).map((a) => a.id));
  return evaluateAchievements(gameId, after).filter((a) => a.unlocked && !was.has(a.id));
}

/** Game ids that have achievements, in registry order (playable only). */
export const ACHIEVEMENT_GAME_IDS = GAME_REGISTRY.filter((g) => g.playable).map((g) => g.id);
