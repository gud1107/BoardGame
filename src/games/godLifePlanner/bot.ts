/**
 * 갓생 플래너 봇 (§22.8). 방장 기기에서만 돌므로 Math.random을 써도 된다(테스트는 rng 주입).
 *
 * 후보 계획(템플릿 + 어제 계획) → 블록 하나씩 바꿔 보는 언덕 오르기 → 유혹 처리 비교 →
 * 기회 카드 선택. 평가는 `previewDay`(나 혼자 했을 때)로 하루를 돌려 본 뒤 "최종 점수
 * 추정치 + 미래 가치(습관·연속 기록·게이지)"로 매긴다. 약속은 다른 자리들이 지난 날
 * 같은 블록에 약속을 잡은 빈도로 성사 확률을 추정한다.
 */

import { ACTIVITIES, BLOCK_COUNT, GOAL_BY_ID, OPPORTUNITY_BY_ID, TRACKS, type Activity } from "./data";
import {
  bannedActivities,
  canResist,
  forcedBlocks,
  goalIdOf,
  nonSleepHabits,
  previewDay,
  temptationOf,
  temptationPlacements,
  totalDays,
  type Cell,
  type EngineAction,
  type GameState,
  type Plan,
  type Seat,
  type SeatState,
} from "./engine";
import { clampBotLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";

type Rng = () => number;

const TEMPLATES: Cell[][] = [
  ["sleep", "sleep", "exercise", "work", "study", "work", "meet", "sleep"],
  ["sleep", "sleep", "study", "work", "work", "work", "rest", "sleep"],
  ["sleep", "sleep", "study", "work", "study", "work", "meet", "sleep"],
  ["sleep", "sleep", "exercise", "study", "work", "rest", "meet", "sleep"],
  ["sleep", "sleep", "sleep", "study", "exercise", "work", "meet", "sleep"],
  ["sleep", "sleep", "rest", "work", "study", "work", "rest", "sleep"],
  ["sleep", "sleep", "exercise", "work", "rest", "study", "exercise", "sleep"],
  ["sleep", "sleep", "study", "study", "rest", "work", "meet", "meet"],
  ["sleep", "sleep", "sleep", "rest", "work", "work", "meet", "sleep"],
];

const MEET_PRIOR = [0, 0, 0.02, 0.05, 0.05, 0.05, 0.35, 0.2];

function goalProgress(goalId: string | null, s: SeatState): number {
  const t = s.tracks;
  switch (goalId) {
    case "G1":
      return t.body / 32;
    case "G2":
      return t.knowledge / 32;
    case "G3":
      return t.wealth / 32;
    case "G4":
      return t.social / 32;
    case "G5":
      return Math.min(...TRACKS.map((k) => t[k])) / 22;
    case "G6":
      return s.morningDays / 5;
    case "G7":
      return nonSleepHabits(s) / 4;
    case "G8":
      return s.collapses === 0 ? s.mp / 8 : 0;
    case "G9":
      return s.overtimeWorks / 7;
    case "G10":
      return (Math.min(1, t.knowledge / 25) + Math.min(1, t.wealth / 25)) / 2;
    case "G11":
      return s.matches / 10;
    case "G12":
      return (s.habits.some((h) => h.activity === "study") ? 0.5 : 0) + Math.min(1, t.knowledge / 28) * 0.5;
    default:
      return 0;
  }
}

function gaugeValue(x: number): number {
  return Math.min(x, 6) * 0.9 + Math.max(0, x - 6) * 0.2;
}

/** 다른 자리가 블록 b에 약속을 잡을 확률(지난 날 빈도 기반) → 내 약속 성사 확률 */
function meetChance(state: GameState, seat: Seat): number[] {
  const days = state.day;
  return Array.from({ length: BLOCK_COUNT }, (_, b) => {
    if (state.friendBlocks[state.day] === b) return 1;
    let miss = 1;
    for (let j = 0; j < state.seatCount; j++) {
      if (j === seat) continue;
      const hist = state.seats[j].days;
      const count = hist.filter((d) => d.plan.cells[b] === "meet").length;
      const f = (count + MEET_PRIOR[b]) / (days + 1);
      miss *= 1 - Math.min(0.95, f);
    }
    return 1 - miss;
  });
}

function evaluate(state: GameState, seat: Seat, plan: Plan, meetP: number[]): number {
  const { record, after } = previewDay(state, seat, plan);
  const daysLeft = totalDays(state) - state.day - 1;
  const habitDays = state.options.easyHabit ? 2 : 3;
  const t = after.tracks;
  const lowest = Math.min(...TRACKS.map((k) => t[k]));
  let v = TRACKS.reduce((n, k) => n + t[k], 0) + lowest * (daysLeft === 0 ? 1 : 0.8);
  v += after.habits.reduce((n, h) => n + (h.shaken ? 1 : 2), 0);
  v += after.habits.length * daysLeft * 0.9;
  for (const st of after.streak) {
    if (st.activity && st.count > 0 && st.count < habitDays && daysLeft >= habitDays - st.count) v += st.count * 0.5;
  }
  const goalId = goalIdOf(state, seat);
  if (goalId) v += GOAL_BY_ID[goalId].points * Math.min(1, goalProgress(goalId, after)) * (goalProgress(goalId, after) >= 1 ? 1 : 0.6);
  v += after.challengePoints;
  if (daysLeft > 0) v += gaugeValue(after.hp) + gaugeValue(after.mp);
  else v += Math.floor((after.hp + after.mp) / 4);
  v -= after.collapses * 3;
  if (daysLeft > 0 && (record.exhausted || record.burnout)) v -= 4;
  // 성사 기대값
  record.outcomes.forEach((o, b) => {
    if (o.cell === "meet" && o.kind === "ok" && !o.matched) v += meetP[b] * 1.9;
  });
  return v;
}

function allowedActivities(state: GameState, seat: Seat): Activity[] {
  const banned = bannedActivities(state, seat);
  return ACTIVITIES.filter((a) => !banned.has(a));
}

function normalize(state: GameState, seat: Seat, cells: Cell[]): Cell[] {
  const banned = bannedActivities(state, seat);
  const out = cells.map((c) => (c === "temptation" || banned.has(c as Activity) ? "rest" : c)) as Cell[];
  for (const [b, act] of forcedBlocks(state, seat)) out[b] = act;
  return out;
}

export function chooseBotPlan(state: GameState, seat: Seat, level: BotLevel, rng: Rng = Math.random): Plan {
  const lv = clampBotLevel(level);
  const meetP = meetChance(state, seat);
  const forced = forcedBlocks(state, seat);
  const acts = allowedActivities(state, seat);
  const resist = canResist(state, seat);
  const base = (cells: Cell[]): Plan => ({ cells, temptation: resist ? "resist" : "yield", opportunityId: null });
  const noise = (10 - lv) * 0.35;
  const score = (p: Plan) => evaluate(state, seat, p, meetP) + (noise > 0 ? (rng() - 0.5) * noise : 0);

  const starts: Cell[][] = TEMPLATES.map((t) => normalize(state, seat, t));
  const yesterday = state.seats[seat].days[state.day - 1];
  if (yesterday) starts.push(normalize(state, seat, yesterday.plan.cells));

  // 실수(저레벨): 템플릿 하나를 거의 그대로
  const mistake = lv <= 3 ? 0.35 - lv * 0.08 : 0;
  let best: Plan;
  let bestScore: number;
  if (rng() < mistake) {
    best = base(starts[Math.floor(rng() * starts.length)]);
    bestScore = score(best);
  } else {
    best = base(starts[0]);
    bestScore = -Infinity;
    for (const s of starts) {
      const p = base(s);
      const v = score(p);
      if (v > bestScore) {
        best = p;
        bestScore = v;
      }
    }
    const iters = 30 + lv * 45;
    for (let i = 0; i < iters; i++) {
      const b = Math.floor(rng() * BLOCK_COUNT);
      if (forced.has(b)) continue;
      const cells = [...best.cells];
      if (rng() < 0.25 && b < BLOCK_COUNT - 1 && !forced.has(b + 1)) {
        [cells[b], cells[b + 1]] = [cells[b + 1], cells[b]];
      } else {
        cells[b] = acts[Math.floor(rng() * acts.length)];
      }
      const p = base(cells);
      const v = score(p);
      if (v > bestScore) {
        best = p;
        bestScore = v;
      }
    }
  }

  // 유혹: 저항 vs 굴복(각 배치) 비교
  const card = temptationOf(state, seat);
  const variants: Plan[] = [];
  if (card.kind === "instant") variants.push({ ...best, temptation: "yield" });
  for (const blocks of temptationPlacements(state, seat)) {
    const cells = [...best.cells];
    for (const b of blocks) cells[b] = "temptation";
    variants.push({ ...best, cells, temptation: "yield" });
  }
  if (card.id === "T4" && best.cells[2] === "sleep") variants.push({ ...best, temptation: "yield" });
  if (resist) {
    for (const v of variants) {
      const s = score(v);
      if (s > bestScore) {
        best = v;
        bestScore = s;
      }
    }
  } else if (variants.length > 0) {
    best = variants.reduce((a, b) => (score(b) > score(a) ? b : a));
    bestScore = score(best);
  }

  // 기회 카드: 계획과 맞는 카드 중 기대 이득이 가장 큰 것
  const others = state.seatCount - 1;
  let bestOpp: string | null = null;
  let bestGain = 0;
  for (const id of state.markets[state.day]) {
    const opp = OPPORTUNITY_BY_ID[id];
    const at = opp.block ?? best.cells.indexOf(opp.activity);
    if (at < 0 || best.cells[at] !== opp.activity) continue;
    const gain = evaluate(state, seat, { ...best, opportunityId: id }, meetP) - evaluate(state, seat, best, meetP);
    const pWin = Math.min(1, opp.capacity / (1 + 0.3 * others));
    const exp = gain * pWin;
    if (exp > bestGain) {
      bestGain = exp;
      bestOpp = id;
    }
  }
  return { ...best, opportunityId: bestOpp };
}

const GOAL_PREF: Record<string, number> = {
  G1: 1, G2: 1, G3: 1, G4: 0.7, G5: 0.9, G6: 0.85, G7: 1, G8: 0.6, G9: 0.8, G10: 0.95, G11: 0.6, G12: 0.85,
};

/** 계획 외 행동(목표 고르기·다음 날 준비). 계획은 커밋-공개라 래퍼가 `chooseBotPlan`을 직접 쓴다. */
export function chooseBotAction(state: GameState, seat: Seat, level: BotLevel, rng: Rng = Math.random): EngineAction | null {
  if (state.phase === "goalDraft" && state.seats[seat].goalPick === null) {
    const [a, b] = state.goalOptions[seat];
    const jitter = (10 - clampBotLevel(level)) * 0.05;
    const sa = (GOAL_PREF[a] ?? 0.8) + (rng() - 0.5) * jitter;
    const sb = (GOAL_PREF[b] ?? 0.8) + (rng() - 0.5) * jitter;
    return { type: "CHOOSE_GOAL", seat, pick: sb > sa ? 1 : 0 };
  }
  if (state.phase === "dayResult" && !state.ready[seat]) return { type: "READY", seat };
  return null;
}
