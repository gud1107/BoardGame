import { pickByLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";
import { aliveChance, BLAST_TIER, DMG, legalMoves, MAX_LIE, survivalChance, type DmgRange, type GameState, type Move, type Seat, type SeatState } from "./engine";

/**
 * 죽은척 기싸움 봇 — 공개 정보(기, 맞은 피해 범위, 누운 라운드)와
 * 자기 목숨만 본다. 다른 자리의 hp/dead는 절대 읽지 않는다(ARCHITECTURE.md §7.1).
 * 점수는 단순 휴리스틱, 레벨별 실수/오차는 공용 `pickByLevel`이 맡는다.
 */

function threat(state: GameState, seat: Seat): { shooters: number; maxKi: number } {
  let shooters = 0;
  let maxKi = 0;
  state.seats.forEach((s, i) => {
    if (i === seat || s.down || s.confirmed) return;
    if (s.ki >= 1) shooters++;
    maxKi = Math.max(maxKi, s.ki);
  });
  return { shooters, maxKi };
}

const BLAST_RANGE: Record<number, DmgRange> = { 1: DMG.pa, 2: DMG.jangpung, 3: DMG.energy };

/** 이 타격이 상대를 쓰러뜨려 끝낼 확률(공개 범위 기준) */
function killChance(t: SeatState, range: DmgRange): number {
  return survivalChance(t.hits) - survivalChance([...t.hits, range]);
}

export function scoreMove(state: GameState, seat: Seat, m: Move): number {
  const me = state.seats[seat];
  const fragile = me.hp <= 1 ? 1.6 : me.hp === 2 ? 1.15 : 1;
  const { shooters, maxKi } = threat(state, seat);
  const danger = shooters === 0 ? 0 : (0.45 + 0.22 * maxKi + 0.1 * shooters) * fragile;
  const t = m.target !== undefined ? state.seats[m.target] : null;
  switch (m.kind) {
    case "charge":
      return 1 + (me.ki < 3 ? 0.5 : me.ki >= 5 ? -1 : 0) - danger;
    case "block":
      return shooters === 0 ? -1 : 0.2 + danger * 0.75 - (maxKi >= 3 ? 0.25 : 0);
    case "pa":
    case "jangpung":
    case "energy": {
      const tier = BLAST_TIER[m.kind]!;
      // 기가 없는 상대는 막기보다 기 모으기를 할 공산이 크다 → 명중 기대가 높다
      const hit = t!.ki === 0 ? 0.8 : t!.ki >= tier ? 0.45 : 0.6;
      const lethal = killChance(t!, BLAST_RANGE[tier]) * 1.6;
      return tier * hit + lethal - tier * 0.3 + (m.kind === "energy" ? 0.35 : 0);
    }
    case "loot": {
      const p = aliveChance(state, m.target!, seat);
      const ambushRisk = p * Math.min(1, (t!.lie + 1) / MAX_LIE) * 0.75;
      return Math.min(2, t!.ki) * 0.75 + 0.2 - ambushRisk * 3 * fragile;
    }
    case "finish": {
      const p = aliveChance(state, m.target!, seat);
      return p * 2.3 + (1 - p) * 0.35 - 0.45;
    }
    case "hold":
      return 1 + (me.lie < 2 ? 0.45 : -0.7) + (me.hp <= 1 ? 0.5 : 0);
    case "rise":
      return 0.35 + (me.ki >= 3 ? 0.55 : 0) - (me.hp <= 1 ? 0.4 : 0);
    case "ambush": {
      const lethal = killChance(t!, DMG.ambush) * 0.9;
      return 0.55 + me.lie * 0.3 + (t!.ki >= 2 ? 0.3 : 0) + lethal;
    }
  }
}

export function chooseBotMove(state: GameState, seat: Seat, level: BotLevel, rng: () => number = Math.random): Move | null {
  const moves = legalMoves(state, seat);
  if (moves.length === 0) return null;
  const scored = moves.map((move) => ({ move, score: scoreMove(state, seat, move) + rng() * 0.25 }));
  return pickByLevel(scored, level, rng);
}
