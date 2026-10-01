/**
 * Game-specific detail stats carried in `GameSelfResult.details`.
 *
 * Merge rule (mirrored by `merge_stat_details()` in supabase/player_stats.sql
 * — keep the two in sync): keys starting with `max` keep the highest value,
 * every other key is summed. Values are non-negative numbers.
 */
export type StatDetails = Record<string, number>;

export function mergeStatDetails(base: StatDetails | undefined, delta: StatDetails | undefined): StatDetails {
  const out: StatDetails = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(delta ?? {})) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const prev = out[key];
    out[key] = key.startsWith("max") ? Math.max(prev ?? value, value) : (prev ?? 0) + value;
  }
  return out;
}

interface DetailRow {
  label: string;
  value: (d: StatDetails, played: number) => string | null;
}

const n = (v: number | undefined) => (v ?? 0).toLocaleString("ko-KR");
const avg = (sum: number | undefined, count: number, digits = 1) =>
  count > 0 && sum !== undefined ? (sum / count).toFixed(digits) : null;

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
