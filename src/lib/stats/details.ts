/**
 * Game-specific detail stats carried in `GameSelfResult.details`.
 *
 * Merge rule (mirrored by `merge_stat_details()` in supabase/player_stats.sql
 * — keep the two in sync): keys starting with `max` keep the highest value,
 * keys starting with `min` keep the lowest, every other key is summed.
 * Values are non-negative numbers.
 */
export type StatDetails = Record<string, number>;

export function mergeStatDetails(base: StatDetails | undefined, delta: StatDetails | undefined): StatDetails {
  const out: StatDetails = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(delta ?? {})) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const prev = out[key];
    if (key.startsWith("max")) out[key] = Math.max(prev ?? value, value);
    else if (key.startsWith("min")) out[key] = Math.min(prev ?? value, value);
    else out[key] = (prev ?? 0) + value;
  }
  return out;
}

interface DetailRow {
  label: string;
  value: (d: StatDetails, played: number) => string | null;
}

const n = (v: number | undefined) => (v ?? 0).toLocaleString("ko-KR");
const ratio = (hit: number | undefined, total: number | undefined) =>
  total ? `${Math.round(((hit ?? 0) / total) * 100)}% (${n(hit)}/${n(total)})` : null;
const avg = (sum: number | undefined, count: number, digits = 1) =>
  count > 0 && sum !== undefined ? (sum / count).toFixed(digits) : null;

const waves3 = (...v: (number | undefined)[]) => (v.some((x) => x) ? v.map((x) => (x ? `W${n(x)}` : "-")).join(" · ") : null);

/** One-line headline per 1-player game for the /stats 솔로 기록 table. */
export const SOLO_HEADLINE: Record<string, (d: StatDetails) => string> = {
  "hungry-shark": (d) => `최고 ${n(d.maxScore)}점 · 🔥 최고 연속 올클리어 ${n(d.maxMissionStreak)}회`,
  "crab-survival": (d) => `최고 ${n(d.maxScore)}점 · 👑 1등 ${n(d.firsts)}회${d.minRank !== undefined ? ` · 최고 ${n(d.minRank)}위` : ""}`,
};

/** What /stats shows per game — only games listed here have a detail panel. */
export const STAT_DETAIL_ROWS: Record<string, DetailRow[]> = {
  "great-legacy": [
    { label: "최고 점수", value: (d) => n(d.maxScore) },
    { label: "평균 점수", value: (d, played) => avg(d.totalScore, played) },
    { label: "최고가 낙찰", value: (d) => `${n(d.maxWinningBid)}코인` },
    {
      label: "투자 효율 (자산점수 ÷ 낙찰가)",
      value: (d) => (d.totalPaid ? `${((d.totalAssetScore ?? 0) / d.totalPaid).toFixed(2)}점/코인` : null),
    },
    { label: "완성한 컬렉션", value: (d) => `${n(d.synergies)}개 (한 판 최고 ${n(d.maxSynergies)}개)` },
    { label: "초대형호재 / 악재 맞은 자산", value: (d) => `${n(d.boosted)} / ${n(d.crashed)}` },
    { label: "상장폐지·반대매매로 잃은 자산", value: (d) => n(d.delisted) },
    { label: "코인 0으로 끝낸 판 (파산)", value: (d) => n(d.brokeGames) },
  ],
  perudo: [
    { label: "\"페루도!\" 적중률", value: (d) => ratio(d.dudoCorrect, d.dudoCalls) },
    { label: "\"맞아!\" 적중률", value: (d) => ratio(d.calzaCorrect, d.calzaCalls) },
    { label: "내 선언이 의심받고 버텨냄", value: (d) => n(d.bidsHeld) },
    { label: "내 선언이 들킴", value: (d) => n(d.bluffsCaught) },
    { label: "경계 적중 (모두 1개씩 잃게 함)", value: (d) => n(d.exactHits) },
    { label: "주사위 1개에서 역전승", value: (d) => n(d.oneDieComebacks) },
    { label: "한 번에 가장 많이 잃은 주사위", value: (d) => `${n(d.maxDiceLostOnce)}개` },
  ],
  dalmuti: [
    { label: "1등으로 끝냄 / 꼴찌로 끝냄", value: (d) => `${n(d.finishedFirst)} / ${n(d.finishedLast)}` },
    { label: "농노로 시작해 1등 (역전승)", value: (d) => n(d.winAsPeon) },
    { label: "달무티로 시작해 꼴찌 (강등)", value: (d) => n(d.loseAsDalmuti) },
    { label: "혁명 / 대혁명", value: (d) => `${n(d.revolutions)} / ${n(d.grandRevolutions)}` },
    { label: "조커로 마무리", value: (d) => n(d.jokerFinishes) },
    { label: "한 번에 낸 최대 카드 수", value: (d) => `${n(d.maxCardsInOnePlay)}장` },
  ],
  "five-cucumbers": [
    { label: "누적 먹은 오이", value: (d) => `${n(d.cucumbersEaten)}개` },
    { label: "판당 평균 오이", value: (d, played) => avg(d.cucumbersEaten, played) },
    { label: "마지막 트릭 생존율", value: (d) => ratio(d.finalTricksSurvived, d.finalTricks) },
    { label: "15 카드로 따낸 트릭", value: (d) => n(d.topCardTricks) },
    { label: "마지막 트릭에서 1로 방어", value: (d) => n(d.oneCardDefenses) },
    { label: "한 번에 먹은 최대 오이", value: (d) => `${n(d.maxPenaltyOnce)}개` },
    { label: "탈락한 판", value: (d) => n(d.eliminated) },
  ],
  coyote: [
    { label: "\"코요테!\" 적중률", value: (d) => ratio(d.coyoteCorrect, d.coyoteCalls) },
    { label: "내 선언이 의심받고 버텨낸 비율", value: (d) => ratio(d.bidsHeld, d.bidsChallenged) },
    { label: "하트를 하나도 잃지 않고 1위", value: (d) => n(d.flawlessWins) },
    { label: "이마에 ?·MAX→0·x2가 붙은 라운드", value: (d) => n(d.specialCardRounds) },
  ],
  "rat-a-tat-cat": [
    { label: "최저 점수 (낮을수록 좋음)", value: (d) => (d.minHandScore === undefined ? null : `${n(d.minHandScore)}점`) },
    { label: "평균 점수", value: (d, played) => avg(d.totalHandScore, played) },
    { label: "0점 퍼펙트 핸드", value: (d) => n(d.zeroHands) },
    { label: "\"랫어탯캣!\" 선언 후 1등", value: (d) => ratio(d.ratCallWins, d.ratCalls) },
    { label: "Swap 사용 / 이득 본 Swap", value: (d) => `${n(d.swaps)} / ${n(d.gainfulSwaps)}` },
  ],
  century: [
    { label: "최고 승점", value: (d) => n(d.maxScore) },
    { label: "평균 승점", value: (d, played) => avg(d.totalScore, played) },
    { label: "금화(3점) / 은화(1점)", value: (d) => `${n(d.goldCoins)} / ${n(d.silverCoins)}` },
    { label: "모은 승점 카드", value: (d) => `${n(d.pointCards)}장` },
    { label: "갈색(시나몬) 확보량", value: (d) => n(d.brownGained) },
    { label: "가장 빨리 이긴 판", value: (d) => (d.minWinRounds === undefined ? null : `${n(d.minWinRounds)}라운드`) },
  ],
  "spot-difference": [
    { label: "누적 찾은 틀린 곳", value: (d) => n(d.spotsFound) },
    { label: "오클릭률", value: (d) => ratio(d.missClicks, (d.spotsFound ?? 0) + (d.missClicks ?? 0)) },
    { label: "한 판 최다 발견", value: (d) => n(d.maxSpotsInGame) },
    { label: "오답 없는 퍼펙트 판", value: (d) => n(d.perfectGames) },
    { label: "Lv.10 봇 상대 승리", value: (d) => n(d.lv10BotWins) },
  ],
  "doodle-phone": [
    { label: "그린 그림 / 쓴 문장", value: (d) => `${n(d.drawings)} / ${n(d.texts)}` },
    { label: "원래 문장을 정확히 맞힘", value: (d) => n(d.exactGuesses) },
    { label: "받은 반응 (😂🤯👏❤️🤔)", value: (d) => n(d.reactionsReceived) },
    { label: "한 장에 받은 최다 반응", value: (d) => n(d.maxReactionsOnePage) },
    { label: "받은 투표 (점수 모드)", value: (d) => n(d.votesReceived) },
    { label: "시간 초과로 자동 제출", value: (d) => n(d.autoFilled) },
  ],
  "crab-survival": [
    { label: "최고 점수 (한 판)", value: (d) => n(d.maxScore) },
    { label: "1등", value: (d) => ratio(d.firsts, d.matches) },
    { label: "3위 안", value: (d) => ratio(d.top3, d.matches) },
    { label: "최고 순위", value: (d) => (d.minRank === undefined ? null : `${n(d.minRank)}위`) },
    { label: "처치 (판당 평균 · 한 판 최다)", value: (d) => `${avg(d.kills, d.matches ?? 0) ?? "-"} · ${n(d.maxKills)}` },
    { label: "왕관 보유 시간", value: (d) => `${n(Math.round((d.kingSeconds ?? 0) / 60))}분` },
    { label: "최고 레벨", value: (d) => n(d.maxLevel) },
    { label: "현상금 / 역습", value: (d) => `${n(d.bounties)} / ${n(d.revenges)}` },
  ],
  "hungry-shark": [
    { label: "최고 점수 (한 잠수)", value: (d) => n(d.maxScore) },
    { label: "누적 잠수", value: (d) => `${n(d.dives)}회` },
    { label: "미션 올클리어", value: (d) => ratio(d.missionAllClears, d.dives) },
    { label: "최고 연속 미션 올클리어", value: (d) => `${n(d.maxMissionStreak)}회` },
  ],
  "merge-defense": [
    { label: "최고 웨이브 (전체)", value: (d) => (d.maxWave ? `WAVE ${n(d.maxWave)}` : null) },
    {
      label: "🛡️ 생존전 최고 (쉬움 · 보통 · 어려움)",
      value: (d) => waves3(d.maxWaveSurvivalEasy, d.maxWaveSurvivalNormal, d.maxWaveSurvivalHard),
    },
    {
      label: "⚔️ 유닛 대결 최고 (쉬움 · 보통 · 어려움)",
      value: (d) => waves3(d.maxWaveVersusEasy, d.maxWaveVersusNormal, d.maxWaveVersusHard),
    },
    { label: "처치 (누적 · 판당 평균)", value: (d, played) => `${n(d.kills)} · ${avg(d.kills, played) ?? "-"}` },
  ],
  "for-sale": [
    { label: "최고 최종 자산", value: (d) => `$${n(d.maxTotal)}` },
    { label: "평균 최종 자산", value: (d, played) => (played ? `$${n(Math.round((d.totalMoney ?? 0) / played))}` : null) },
    { label: "가장 큰 수표", value: (d) => `$${n(d.maxCheck)}` },
    { label: "0원 수표 받은 횟수", value: (d) => n(d.zeroChecks) },
    { label: "30번 매물 보유한 판", value: (d) => n(d.had30) },
    { label: "30번 매물 보유 + 1위", value: (d) => n(d.won30) },
    { label: "30번 매물을 0원에 판 굴욕", value: (d) => n(d.sold30ForZero) },
  ],
};
