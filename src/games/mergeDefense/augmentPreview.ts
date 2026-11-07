/**
 * ✨ 증강 "what would this card do for MY board right now" — UI only.
 *
 * Firepower = Σ per tower: damage × hits/s × crit expectation ×
 * (1 − armor/resist of the next wave, minus pierce) × share of the road the
 * tower reaches, ÷ (1 − monster slow). Comparing it with and without the
 * candidate card gives a "화력 +N%" that already accounts for the board's
 * tower mix (물리/마법, grades, kinds, cells). Economy and defence cards get a
 * concrete number instead (gold per wave, 탈락 기준, stun seconds, …).
 */
import {
  boardLimit,
  critStats,
  defenceProfile,
  FOCUS_MAX,
  GAMBLE_ODDS,
  GRADE_NAMES,
  killGold,
  MAX_GRADE,
  mergePairs,
  selectMap,
  sellValue,
  slotCoverage,
  stunTicks,
  summonCost,
  TICKS_PER_SEC,
  UNITS,
  unitDamage,
  unitInterval,
  unitRange,
  waveBonus,
  waveComposition,
  waveCount,
  type Board,
  type MergeDefenseState,
  type Unit,
} from "./engine";
import { AUGMENTS, augTotals, interestCap, mergeGoldAt, type AugmentId } from "./augments";

export interface AugPreview {
  /** Short line under the card, e.g. "📈 내 보드 화력 +12%". */
  text: string;
  /** "up" = a measurable gain on this board, "info" = a fact to weigh, "weak" = little effect right now. */
  tone: "up" | "info" | "weak";
}

const coverageCache = new Map<string, number>();
function coverage(map: string | undefined, slot: number, range: number): number {
  const key = `${map ?? "classic"}:${slot}:${Math.round(range)}`;
  let v = coverageCache.get(key);
  if (v === undefined) {
    v = slotCoverage(slot, range);
    coverageCache.set(key, v);
  }
  return v;
}

/** Effective damage per second this board puts on the road (see file comment). */
export function boardFirepower(state: MergeDefenseState, board: Board, vsWave?: number): number {
  selectMap(state.map);
  const t = augTotals(board.augments);
  const c = critStats(board.focus ?? 0);
  const chance = Math.min(1, c.chance + t.crit);
  const critF = 1 + chance * (c.mult + t.critMult - 1);
  const def = defenceProfile(waveComposition(state, vsWave ?? Math.max(1, state.wave + 1)));
  let sum = 0;
  board.units.forEach((u, slot) => {
    if (!u) return;
    const dps = (unitDamage(u, board) * TICKS_PER_SEC) / unitInterval(u, board);
    const d = UNITS[u.kind].dmgType === "physical" ? def.armor : def.resist;
    sum += dps * critF * (1 - d * (1 - t.pierce)) * coverage(state.map, slot, unitRange(u, board));
  });
  return sum / (1 - Math.min(0.9, t.slow));
}

/** From this wave the road carries armored/resistant kinds (knights from W12, see spawnKindFor). */
const ARMORED_FROM = 12;

const withAug = (board: Board, id: AugmentId): Board => ({ ...board, augments: [...(board.augments ?? []), id] });

/** Units 승급 의식 would raise (same rule as the engine: strongest ≤ 영웅 first). */
function ascendTargets(board: Board, n: number): number[] {
  const eligible = board.units.map((u, i) => (u && u.grade <= 3 ? i : -1)).filter((i) => i >= 0);
  eligible.sort((a, b) => board.units[b]!.grade - board.units[a]!.grade || a - b);
  return eligible.slice(0, n);
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const sec = (ticks: number) => `${(ticks / TICKS_PER_SEC).toFixed(1).replace(/\.0$/, "")}초`;

export function augmentPreview(state: MergeDefenseState, board: Board, id: AugmentId): AugPreview | null {
  const def = AUGMENTS[id];
  if (!def) return null;
  const fx = def.fx;
  const w = Math.max(1, state.wave);
  const base = boardFirepower(state, board);
  const gain = (after: number): AugPreview => {
    if (base <= 0) return { text: "타워를 놓으면 계산돼요", tone: "weak" };
    const g = after / base - 1;
    const n = Math.round(g * 100);
    return n >= 3 ? { text: `📈 내 보드 화력 +${n}%`, tone: "up" } : { text: `📉 지금 내 보드엔 +${Math.max(0, n)}% (효과 작음)`, tone: "weak" };
  };

  // 공격 카드 (damage / speed / range / crit / pierce / slow / kind-based).
  const combat = fx.phys || fx.magic || fx.low || fx.high || fx.rainbow || fx.specialist || fx.crit || fx.critMult || fx.haste || fx.range || fx.pierce || fx.slow;
  if (fx.pierce && base > 0 && state.wave + 1 < ARMORED_FROM) {
    // Early waves barely wear armor — also show the gain once 철갑기사 & co. walk (W12+).
    const later = Math.max(state.wave + 1, ARMORED_FROM);
    const now = Math.round((boardFirepower(state, withAug(board, id)) / base - 1) * 100);
    const then = Math.round((boardFirepower(state, withAug(board, id), later) / boardFirepower(state, board, later) - 1) * 100);
    return { text: `📈 화력 지금 +${now}% · W${later}부터 +${then}%`, tone: Math.max(now, then) >= 3 ? "up" : "weak" };
  }
  if (combat) return gain(boardFirepower(state, withAug(board, id)));
  if (fx.big) return { text: `👑 보스·전쟁군주에게 화력 +${pct(fx.big)} · 다음 보스 W${Math.ceil((state.wave + 1) / 5) * 5}`, tone: "info" };

  if (def.instant?.kind === "focus") {
    const lv = board.focus ?? 0;
    if (lv >= FOCUS_MAX) return { text: `🪙 이미 집중 MAX → 🪙${150 * def.instant.n} 받아요`, tone: "info" };
    const after = gain(boardFirepower(state, { ...board, focus: Math.min(FOCUS_MAX, lv + def.instant.n) }));
    return { ...after, text: `${after.text} · 집중 ${lv}→${Math.min(FOCUS_MAX, lv + def.instant.n)}` };
  }
  if (def.instant?.kind === "ascend") {
    const targets = ascendTargets(board, def.instant.n);
    if (targets.length === 0) return { text: "올릴 영웅 이하 타워가 없어요", tone: "weak" };
    const units = board.units.map((u, i) => (u && targets.includes(i) ? ({ ...u, grade: Math.min(MAX_GRADE, u.grade + 1) } as Unit) : u));
    const names = targets.map((i) => `${UNITS[board.units[i]!.kind].emoji}${GRADE_NAMES[board.units[i]!.grade + 1]}`).join(" ");
    const after = gain(boardFirepower(state, { ...board, units }));
    return { ...after, text: `${after.text} · ${names}` };
  }
  if (def.instant?.kind === "hero") {
    const empty = board.units.filter((u) => !u).length;
    const weak = board.units.filter((u) => u && u.grade <= 2).length;
    return { text: `🦸 영웅 ${def.instant.n}기 — 빈 칸 ${empty}개${empty < def.instant.n ? ` · 일반·희귀 ${Math.min(weak, def.instant.n - empty)}기 교체` : ""}`, tone: "up" };
  }

  // 경제.
  if (fx.interest) {
    const now = Math.min(interestCap(w + 1), Math.floor(board.gold * fx.interest));
    return { text: `🏦 지금 골드면 웨이브마다 +${now} (최대 ${interestCap(w + 1)})`, tone: now >= 10 ? "up" : "weak" };
  }
  if (def.instant?.kind === "gems" && !fx.gambleRetry) {
    const boss = fx.bossGems ? ` · 보스마다 💎+${fx.bossGems}` : "";
    return { text: `💎 ${board.gems} → ${board.gems + def.instant.n} (도박 ${def.instant.n}번)${boss}`, tone: "up" };
  }
  if (fx.killGold || fx.waveGold) {
    const kills = Math.round(waveCount(w) * killGold("normal", w) * (fx.killGold ?? 0));
    const bonus = Math.round(waveBonus(w) * (fx.waveGold ?? 0));
    const extra = fx.stunCut ? ` · 기절 ${sec(stunTicks(board.brace ?? 0))}→${sec(Math.round(stunTicks(board.brace ?? 0) * (1 - fx.stunCut)))}` : "";
    return { text: `💰 웨이브마다 약 +${kills + bonus}골드${extra}`, tone: "up" };
  }
  if (fx.cheap) {
    const now = summonCost(board);
    const after = summonCost(withAug(board, id));
    return { text: `🏷️ 소환비 ${now} → ${after} (이후 1씩만 올라요)`, tone: "up" };
  }
  if (fx.mergeGold) return { text: `⚗️ 합성마다 +${mergeGoldAt(w)}골드 · 지금 합성 가능 ${mergePairs(board).length}쌍`, tone: "up" };
  if (fx.lucky) return { text: `🍀 소환 희귀 확률 6% → ${pct(0.06 + fx.lucky)}`, tone: "info" };
  if (fx.gambleRetry) {
    const miss = (GAMBLE_ODDS.find((o) => o.grade === 0)?.pct ?? 0) / 100;
    return { text: `🎲 도박 꽝 ${pct(miss)} → ${pct(miss * miss)} · 💎 ${board.gems}→${board.gems + (def.instant?.kind === "gems" ? def.instant.n : 0)}`, tone: "info" };
  }
  if (fx.sellAll) {
    const extra = board.units.reduce((s, u) => s + (u ? sellValue(u, withAug(board, id)) - sellValue(u) : 0), 0);
    return { text: `♻️ 지금 보드를 팔면 +${extra}골드 더`, tone: extra >= 30 ? "info" : "weak" };
  }
  if (fx.limit) return { text: `🧱 탈락 기준 ${boardLimit(state, board)} → ${boardLimit(state, withAug(board, id))}마리`, tone: "up" };
  if (fx.stunCut) return { text: `🪖 기절 ${sec(stunTicks(board.brace ?? 0))} → ${sec(Math.round(stunTicks(board.brace ?? 0) * (1 - fx.stunCut)))}`, tone: "info" };
  if (fx.foeCut) return { text: `🏰 받는 견제 체력 → ${pct(1 - fx.foeCut)}`, tone: "info" };
  if (fx.sendHp) return { text: state.mode === "versus" ? "🏴 내 견제 몬스터 체력 ×1.4" : "🏴 12킬 정예 체력 ×1.4", tone: "info" };
  if (fx.income) return { text: `💹 수입 +${board.income ?? 0}/W · 앞으로 2.5배`, tone: "info" };
  return null;
}
