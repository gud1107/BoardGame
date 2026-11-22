import type { BotLevel } from "@/games/shared/bot/botDifficulty";
import { DECK, FREEZE_MS } from "./data";
import { answerFor, topCard, type PairAction, type PairState, type SeatIndex } from "./engine";

/**
 * 번개 짝꿍 AI (룰북 §9). 봇은 화면에 보이는 두 카드만 본다 — 짝은 늘 "알 수 있는" 정보라, 실력 차이는 **찾는 데 걸리는 시간**과
 * **헛짚기**로만 낸다.
 *
 * - 찾는 시간: 로그정규분포. 중앙값 Lv.1 ≈ 3.6초 → Lv.10 ≈ 1.45초, 흔들림 σ 0.55 (사람 보통 2초 안팎).
 * - 헛짚기: 레벨별 확률로 찾는 도중 엉뚱한 그림을 눌러 {@link FREEZE_MS} 얼고, 그만큼 늦게 맞힌다.
 */

interface Plan {
  seq: number;
  wrongAt: number | null;
  wrongSym: number;
  at: number;
}

export interface BotMemory {
  plans: Map<SeatIndex, Plan>;
}

export function createBotMemory(): BotMemory {
  return { plans: new Map() };
}

export function botMedianFind(level: number): number {
  return Math.round(3600 * Math.pow(1450 / 3600, (Math.max(1, Math.min(10, level)) - 1) / 9));
}
export function botWrongRate(level: number): number {
  return Math.max(0.012, 0.14 - (level - 1) * 0.014);
}
const SIGMA = 0.55;

function gauss(rng: () => number): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function sampleFind(level: number, rng: () => number): number {
  return Math.round(Math.max(450, Math.min(12_000, botMedianFind(level) * Math.exp(gauss(rng) * SIGMA))));
}

export function runBots(s: PairState, now: number, bots: Map<SeatIndex, BotLevel | number>, mem: BotMemory, rng: () => number): PairAction[] {
  if (s.phase !== "play" || bots.size === 0) return [];
  const out: PairAction[] = [];
  for (const [seat, level] of bots) {
    if (seat >= s.playerCount) continue;
    const top = topCard(s, seat);
    if (top === null) continue;
    if (s.pending.some((p) => p.seat === seat)) continue;
    let plan = mem.plans.get(seat);
    if (!plan || plan.seq !== s.seq) {
      const find = sampleFind(level, rng);
      const wrong = rng() < botWrongRate(level);
      const answer = answerFor(s, seat)!;
      const decoys = DECK[top].filter((x) => x !== answer);
      plan = {
        seq: s.seq,
        wrongAt: wrong ? s.centerAt + Math.round(find * (0.35 + rng() * 0.3)) : null,
        wrongSym: decoys[Math.floor(rng() * decoys.length)],
        at: s.centerAt + find + (wrong ? FREEZE_MS : 0),
      };
      mem.plans.set(seat, plan);
    }
    if (s.frozenUntil[seat] > now) continue;
    if (plan.wrongAt !== null && now >= plan.wrongAt) {
      plan.wrongAt = null;
      out.push({ type: "claim", seat, sym: plan.wrongSym, seq: s.seq, rt: now - s.centerAt });
      continue;
    }
    if (now >= plan.at) {
      plan.at = Infinity;
      out.push({ type: "claim", seat, sym: answerFor(s, seat)!, seq: s.seq, rt: now - s.centerAt });
    }
  }
  return out;
}
