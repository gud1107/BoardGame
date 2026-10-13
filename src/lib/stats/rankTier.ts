import type { StatDetails } from "./details";

/**
 * 누적 랭크 점수(RP)와 티어(아이언 ~ 챌린저).
 *
 * - 한 판 결과는 순위로 정해진다: 8인 기준 1~4위 +40/+30/+20/+10, 5~8위 −10/−20/−30/−40.
 *   인원이 적으면 같은 표를 인원에 맞게 늘려 쓴다(1위 +40, 꼴찌 −40, 홀수 인원의 딱 가운데는 0).
 * - 전적 details는 음수를 못 담으므로(서버 검증) 얻은 점수 `rpGain`과 잃은 점수 `rpLoss`를
 *   따로 더하고, 누적 RP = rpGain − rpLoss. 0 아래로는 안 내려가게 잃는 점수를 보낼 때 깎는다.
 * - 공개 랭킹은 public_metric_leaderboard의 p_sub(= rpLoss)로 같은 차이를 계산한다.
 */

export const RP_GAIN_KEY = "rpGain";
export const RP_LOSS_KEY = "rpLoss";

const RP_TABLE_8 = [40, 30, 20, 10, -10, -20, -30, -40] as const;

/** 순위(1부터)와 인원으로 이번 판 RP 변화(0 바닥 처리 전). */
export function rpForRank(rank: number, players: number): number {
  if (players <= 1) return 0;
  const pos = ((rank - 1) * 7) / (players - 1);
  if (Math.abs(pos - 3.5) < 1e-9) return 0;
  return RP_TABLE_8[Math.max(0, Math.min(7, Math.round(pos)))];
}

export function rpFromDetails(d: StatDetails | undefined): number {
  return Math.max(0, (d?.[RP_GAIN_KEY] ?? 0) - (d?.[RP_LOSS_KEY] ?? 0));
}

/** 이전 RP에 이번 판을 반영 — 0 아래로 안 내려간다. details에 넣을 값도 같이 준다. */
export function applyRp(prev: number, rank: number, players: number): { delta: number; next: number; details: StatDetails } {
  const raw = rpForRank(rank, players);
  const next = Math.max(0, prev + raw);
  const delta = next - prev;
  return { delta, next, details: delta >= 0 ? { [RP_GAIN_KEY]: delta, [RP_LOSS_KEY]: 0 } : { [RP_GAIN_KEY]: 0, [RP_LOSS_KEY]: -delta } };
}

export interface RankTier {
  id: string;
  name: string;
  emoji: string;
  /** 이 티어가 시작하는 RP */
  min: number;
  /** 배지 색(tailwind 그라데이션) */
  badge: string;
}

export const RANK_TIERS: RankTier[] = [
  { id: "iron", name: "아이언", emoji: "⚙️", min: 0, badge: "from-stone-400 to-stone-700 text-white" },
  { id: "bronze", name: "브론즈", emoji: "🥉", min: 100, badge: "from-amber-600 to-amber-900 text-amber-50" },
  { id: "silver", name: "실버", emoji: "🥈", min: 200, badge: "from-slate-200 to-slate-500 text-slate-900" },
  { id: "gold", name: "골드", emoji: "🥇", min: 300, badge: "from-yellow-200 to-yellow-600 text-yellow-950" },
  { id: "platinum", name: "플래티넘", emoji: "💠", min: 400, badge: "from-teal-200 to-teal-600 text-teal-950" },
  { id: "emerald", name: "에메랄드", emoji: "💚", min: 500, badge: "from-emerald-300 to-emerald-700 text-emerald-950" },
  { id: "diamond", name: "다이아몬드", emoji: "💎", min: 600, badge: "from-sky-200 to-indigo-500 text-indigo-950" },
  { id: "master", name: "마스터", emoji: "🔮", min: 800, badge: "from-fuchsia-300 to-purple-700 text-white" },
  { id: "grandmaster", name: "그랜드마스터", emoji: "🔥", min: 1000, badge: "from-rose-400 to-red-700 text-white" },
  { id: "challenger", name: "챌린저", emoji: "👑", min: 1200, badge: "from-yellow-100 via-sky-200 to-yellow-400 text-slate-900" },
];

export function tierIndex(rp: number): number {
  let i = 0;
  while (i + 1 < RANK_TIERS.length && rp >= RANK_TIERS[i + 1].min) i++;
  return i;
}

export function tierOf(rp: number): { tier: RankTier; index: number; next: RankTier | null; progress: number } {
  const index = tierIndex(rp);
  const tier = RANK_TIERS[index];
  const next = RANK_TIERS[index + 1] ?? null;
  const progress = next ? (rp - tier.min) / (next.min - tier.min) : 1;
  return { tier, index, next, progress };
}

/** 이전 → 이후 RP로 승급/강등 판정 */
export function tierChange(prev: number, next: number): "promoted" | "demoted" | null {
  const a = tierIndex(prev);
  const b = tierIndex(next);
  return b > a ? "promoted" : b < a ? "demoted" : null;
}
