import type { StatDetails } from "./details";

const n = (v: number | undefined) => (v ?? 0).toLocaleString("ko-KR");

// ---------------------------------------------------------------------------
// "이번 판 기록" — one finished match's `details` on the post-game card.
// Rows whose value is 0/absent are hidden so the card only shows what
// actually happened this game.
// ---------------------------------------------------------------------------

export interface MatchRow {
  label: string;
  key: string;
  /** Shown as "key/den" (e.g. 적중 2/3) when set. */
  den?: string;
  unit?: string;
  /** 0/1 flag — shown as just a check. */
  flag?: boolean;
  money?: boolean;
}

export const MATCH_SUMMARY_ROWS: Record<string, MatchRow[]> = {
  "great-legacy": [
    { label: "점수", key: "maxScore", unit: "점" },
    { label: "최고가 낙찰", key: "maxWinningBid", unit: "코인" },
    { label: "완성한 컬렉션", key: "synergies", unit: "개" },
    { label: "초대형호재 맞은 자산", key: "boosted", unit: "개" },
    { label: "악재 맞은 자산", key: "crashed", unit: "개" },
    { label: "상장폐지·반대매매로 잃은 자산", key: "delisted", unit: "개" },
    { label: "코인 0으로 끝냄 (파산)", key: "brokeGames", flag: true },
  ],
  "for-sale": [
    { label: "최종 자산", key: "maxTotal", money: true },
    { label: "가장 큰 수표", key: "maxCheck", money: true },
    { label: "0원 수표", key: "zeroChecks", unit: "장" },
    { label: "30번 매물 보유", key: "had30", flag: true },
    { label: "30번 매물을 0원에 판 굴욕", key: "sold30ForZero", flag: true },
  ],
  perudo: [
    { label: "“페루도!” 적중", key: "dudoCorrect", den: "dudoCalls" },
    { label: "“맞아!” 적중", key: "calzaCorrect", den: "calzaCalls" },
    { label: "의심받고 버텨낸 선언", key: "bidsHeld", unit: "번" },
    { label: "들킨 선언", key: "bluffsCaught", unit: "번" },
    { label: "경계 적중", key: "exactHits", unit: "번" },
    { label: "주사위 1개에서 역전승", key: "oneDieComebacks", flag: true },
    { label: "한 번에 잃은 최대 주사위", key: "maxDiceLostOnce", unit: "개" },
  ],
  dalmuti: [
    { label: "농노로 시작해 1등", key: "winAsPeon", flag: true },
    { label: "달무티로 시작해 꼴찌", key: "loseAsDalmuti", flag: true },
    { label: "혁명", key: "revolutions", flag: true },
    { label: "대혁명", key: "grandRevolutions", flag: true },
    { label: "조커로 마무리", key: "jokerFinishes", flag: true },
    { label: "한 번에 낸 최대 카드", key: "maxCardsInOnePlay", unit: "장" },
  ],
  "five-cucumbers": [
    { label: "먹은 오이", key: "cucumbersEaten", unit: "개" },
    { label: "마지막 트릭 생존", key: "finalTricksSurvived", den: "finalTricks" },
    { label: "15로 따낸 트릭", key: "topCardTricks", unit: "번" },
    { label: "마지막 트릭 1로 방어", key: "oneCardDefenses", unit: "번" },
    { label: "탈락", key: "eliminated", flag: true },
  ],
  coyote: [
    { label: "“코요테!” 적중", key: "coyoteCorrect", den: "coyoteCalls" },
    { label: "의심받고 버텨낸 선언", key: "bidsHeld", den: "bidsChallenged" },
    { label: "하트 무손실 1위", key: "flawlessWins", flag: true },
    { label: "이마에 특수 카드", key: "specialCardRounds", unit: "라운드" },
  ],
  "rat-a-tat-cat": [
    { label: "최종 점수 (낮을수록 좋음)", key: "minHandScore", unit: "점" },
    { label: "0점 퍼펙트 핸드", key: "zeroHands", flag: true },
    { label: "“랫어탯캣!” 선언", key: "ratCalls", flag: true },
    { label: "이득 본 Swap", key: "gainfulSwaps", den: "swaps" },
  ],
  century: [
    { label: "승점", key: "maxScore", unit: "점" },
    { label: "금화", key: "goldCoins", unit: "개" },
    { label: "은화", key: "silverCoins", unit: "개" },
    { label: "승점 카드", key: "pointCards", unit: "장" },
    { label: "갈색(시나몬) 확보", key: "brownGained", unit: "개" },
    { label: "승리까지 걸린 라운드", key: "minWinRounds", unit: "라운드" },
  ],
  "spot-difference": [
    { label: "찾은 틀린 곳", key: "spotsFound", unit: "곳" },
    { label: "오클릭", key: "missClicks", unit: "번" },
    { label: "오답 없는 퍼펙트", key: "perfectGames", flag: true },
    { label: "Lv.10 봇 상대 승리", key: "lv10BotWins", flag: true },
  ],
  "doodle-phone": [
    { label: "그린 그림", key: "drawings", unit: "장" },
    { label: "원래 문장 정확히 맞힘", key: "exactGuesses", unit: "번" },
    { label: "받은 반응", key: "reactionsReceived", unit: "개" },
    { label: "받은 투표", key: "votesReceived", unit: "표" },
  ],
};

/**
 * Formatted rows for one match, skipping anything that didn't happen. A
 * `min*` key (lower-is-better score) is shown even at 0 — a 0 there is the
 * best possible result, not "nothing happened".
 */
export function matchSummaryLines(gameId: string, d: StatDetails | undefined): { label: string; value: string }[] {
  const rows = MATCH_SUMMARY_ROWS[gameId];
  if (!rows || !d) return [];
  const out: { label: string; value: string }[] = [];
  for (const r of rows) {
    const v = d[r.key];
    if (r.den) {
      const total = d[r.den] ?? 0;
      if (total > 0) out.push({ label: r.label, value: `${n(v)}/${n(total)}` });
      continue;
    }
    const shown = v !== undefined && (v > 0 || r.key.startsWith("min"));
    if (!shown) continue;
    out.push({ label: r.label, value: r.flag ? "✔" : r.money ? `$${n(v)}` : `${n(v)}${r.unit ?? ""}` });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Detail-stat leaderboards (public_metric_leaderboard RPC).
// ---------------------------------------------------------------------------

export interface RankMetric {
  id: string;
  label: string;
  num: string;
  /** Ratio denominator: another details key, or "played" for a per-game average. */
  den?: string;
  /** Lower is better (min* keys, averages in low-score games). */
  asc?: boolean;
  /** Minimum denominator to qualify for a ratio/average board. */
  minDen?: number;
  format: "count" | "percent" | "avg" | "money";
  unit?: string;
}

export const STAT_RANK_METRICS: Record<string, RankMetric[]> = {
  "great-legacy": [
    { id: "gl-max", label: "최고 점수", num: "maxScore", format: "count", unit: "점" },
    { id: "gl-bid", label: "최고가 낙찰", num: "maxWinningBid", format: "count", unit: "코인" },
    { id: "gl-syn", label: "컬렉션 완성", num: "synergies", format: "count", unit: "개" },
  ],
  "for-sale": [
    { id: "fs-max", label: "최고 자산", num: "maxTotal", format: "money" },
    { id: "fs-avg", label: "평균 자산", num: "totalMoney", den: "played", minDen: 10, format: "money" },
    { id: "fs-30", label: "30번 보유 승리", num: "won30", format: "count", unit: "번" },
  ],
  perudo: [
    { id: "pe-dudo", label: "페루도! 적중률", num: "dudoCorrect", den: "dudoCalls", minDen: 10, format: "percent" },
    { id: "pe-calza", label: "맞아! 적중률", num: "calzaCorrect", den: "calzaCalls", minDen: 5, format: "percent" },
    { id: "pe-one", label: "1개 역전승", num: "oneDieComebacks", format: "count", unit: "번" },
  ],
  dalmuti: [
    { id: "da-peon", label: "농노 역전승", num: "winAsPeon", format: "count", unit: "번" },
    { id: "da-rev", label: "혁명", num: "revolutions", format: "count", unit: "번" },
    { id: "da-joker", label: "조커 마무리", num: "jokerFinishes", format: "count", unit: "번" },
  ],
  "five-cucumbers": [
    { id: "fc-surv", label: "마지막 트릭 생존율", num: "finalTricksSurvived", den: "finalTricks", minDen: 10, format: "percent" },
    { id: "fc-avg", label: "판당 오이 (적을수록)", num: "cucumbersEaten", den: "played", asc: true, minDen: 10, format: "avg", unit: "개" },
    { id: "fc-15", label: "15로 딴 트릭", num: "topCardTricks", format: "count", unit: "번" },
  ],
  coyote: [
    { id: "co-call", label: "코요테! 적중률", num: "coyoteCorrect", den: "coyoteCalls", minDen: 10, format: "percent" },
    { id: "co-held", label: "선언 버팀률", num: "bidsHeld", den: "bidsChallenged", minDen: 10, format: "percent" },
    { id: "co-flaw", label: "무손실 승리", num: "flawlessWins", format: "count", unit: "번" },
  ],
  "rat-a-tat-cat": [
    { id: "rc-min", label: "최저 점수", num: "minHandScore", asc: true, format: "count", unit: "점" },
    { id: "rc-avg", label: "평균 점수 (낮을수록)", num: "totalHandScore", den: "played", asc: true, minDen: 10, format: "avg", unit: "점" },
    { id: "rc-zero", label: "0점 핸드", num: "zeroHands", format: "count", unit: "번" },
  ],
  century: [
    { id: "ce-max", label: "최고 승점", num: "maxScore", format: "count", unit: "점" },
    { id: "ce-fast", label: "최단 승리", num: "minWinRounds", asc: true, format: "count", unit: "라운드" },
    { id: "ce-brown", label: "갈색 확보", num: "brownGained", format: "count", unit: "개" },
  ],
  "spot-difference": [
    { id: "sd-found", label: "찾은 곳", num: "spotsFound", format: "count", unit: "곳" },
    { id: "sd-perfect", label: "퍼펙트 판", num: "perfectGames", format: "count", unit: "판" },
    { id: "sd-lv10", label: "Lv.10 봇 격파", num: "lv10BotWins", format: "count", unit: "번" },
  ],
  "merge-defense": [
    { id: "md-wave", label: "최고 웨이브", num: "maxWave", format: "count", unit: "웨이브" },
    { id: "md-s-hard", label: "생존전 어려움 최고", num: "maxWaveSurvivalHard", format: "count", unit: "웨이브" },
    { id: "md-s-normal", label: "생존전 보통 최고", num: "maxWaveSurvivalNormal", format: "count", unit: "웨이브" },
    { id: "md-v-hard", label: "유닛 대결 어려움 최고", num: "maxWaveVersusHard", format: "count", unit: "웨이브" },
    { id: "md-kills", label: "누적 처치", num: "kills", format: "count", unit: "마리" },
    { id: "md-rage", label: "광폭 보스 처치", num: "rageKills", format: "count", unit: "회" },
    { id: "md-combo", label: "최고 치명타 콤보", num: "maxCritCombo", format: "count", unit: "콤보" },
  ],
  "doodle-phone": [
    { id: "dp-react", label: "받은 반응", num: "reactionsReceived", format: "count", unit: "개" },
    { id: "dp-exact", label: "정확히 맞힘", num: "exactGuesses", format: "count", unit: "번" },
    { id: "dp-vote", label: "받은 투표", num: "votesReceived", format: "count", unit: "표" },
  ],
};

export function formatRankMetric(m: RankMetric, value: number, num: number, den: number | null): string {
  if (m.format === "percent") return `${Math.round(value * 1000) / 10}% (${n(num)}/${n(den ?? 0)})`;
  if (m.format === "avg") return `${value.toFixed(1)}${m.unit ?? ""}`;
  if (m.format === "money") return `$${n(Math.round(value))}`;
  return `${n(value)}${m.unit ?? ""}`;
}
