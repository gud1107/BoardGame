import { pickByLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";
import { AUG_BY_ID, type AugId } from "./augments";
import { aliveChance, attackRange, BANDAGE_COST, BLAST_TIER, costOf, defendedRange, hasAug, legalMoves, lieLimitOf, MAX_LIE, START_HP, survivalOf, type DmgRange, type GameState, type Move, type Seat, type SeatState } from "./engine";

/**
 * 죽은척 대작전 봇 — 공개 정보(탄약, 맞은 피해 범위, 누운 라운드)와
 * 자기 목숨만 본다. 다른 자리의 hp/dead는 절대 읽지 않는다(ARCHITECTURE.md §7.1).
 * 점수는 단순 휴리스틱, 레벨별 실수/오차는 공용 `pickByLevel`이 맡는다.
 */

function threat(state: GameState, seat: Seat): { shooters: number; maxKi: number } {
  let shooters = 0;
  let maxKi = 0;
  state.seats.forEach((s, i) => {
    if (i === seat || s.down || s.confirmed) return;
    if (s.ammo >= 1) shooters++;
    maxKi = Math.max(maxKi, s.ammo);
  });
  return { shooters, maxKi };
}

/** 이 타격이 상대를 쓰러뜨려 끝낼 확률(공개 범위 기준, 상대 방탄 반영) */
function killChance(t: SeatState, range: DmgRange): number {
  // 방탄모·조끼(shield)는 빼고 본다 — 넣으면 봇이 방탄 가진 사람을 끝까지 안 쏴서 방탄이 영영 안 닳는다
  return survivalOf(t) - survivalOf(t, defendedRange({ ...t, shield: 0 }, range));
}

export function scoreMove(state: GameState, seat: Seat, m: Move): number {
  const me = state.seats[seat];
  const fragile = me.hp <= 1 ? 1.6 : me.hp === 2 ? 1.15 : 1;
  const { shooters, maxKi } = threat(state, seat);
  const danger = shooters === 0 ? 0 : (0.45 + 0.22 * maxKi + 0.1 * shooters) * fragile;
  const t = m.target !== undefined ? state.seats[m.target] : null;
  switch (m.kind) {
    case "reload":
      return 1 + (me.ammo < 3 ? 0.5 : me.ammo >= 5 ? -1 : 0) - danger;
    case "cover":
      return shooters === 0 ? -1 : 0.2 + danger * 0.75 - (maxKi >= 3 ? 0.25 : 0);
    case "shot":
    case "burst":
    case "grenade": {
      const tier = BLAST_TIER[m.kind]!;
      // 탄약이 없는 상대는 엄폐보다 장전할 공산이 크다 → 명중 기대가 높다
      const hit = t!.ammo === 0 ? 0.8 : t!.ammo >= tier ? 0.45 : 0.6;
      const lethal = killChance(t!, attackRange(me, m.kind)) * 1.6;
      return tier * hit + lethal - costOf(me, m.kind) * 0.3 + (m.kind === "grenade" ? 0.35 : 0);
    }
    case "loot": {
      const p = aliveChance(state, m.target!, seat);
      const ambushRisk = p * Math.min(1, (t!.lie + 1) / lieLimitOf(t!)) * 0.75;
      return Math.min(2, t!.ammo) * 0.75 + 0.2 - ambushRisk * 3 * fragile - (hasAug(t!, "tripwire") ? 0.9 * fragile : 0);
    }
    case "finish": {
      const p = aliveChance(state, m.target!, seat);
      return p * 2.3 + (1 - p) * 0.35 - (costOf(me, "finish") > 0 ? 0.45 : 0.1);
    }
    case "hold":
      // 위장복의 늘어난 한도는 안전 여유일 뿐 더 숨을 이유가 아니다(명배우만 누워 있을수록 탄약)
      return 1 + (me.lie < (hasAug(me, "understudy") ? lieLimitOf(me) : MAX_LIE) - 1 ? 0.45 : -0.7) + (me.hp <= 1 ? 0.5 : 0);
    case "rise":
      return 0.35 + (me.ammo >= 3 ? 0.55 : 0) - (me.hp <= 1 ? 0.4 : 0);
    case "bandage":
      // 내 생사는 나만 안다: 진짜 시체면 붕대가 유일한 살길, 살아 있으면 다친 만큼만
      // 점수를 숨죽이기와 비슷하게 둬서 "붕대 = 시체" 티가 나지 않게 섞는다
      if (me.dead) return 2.1;
      return me.hp >= START_HP ? -1 : 1.2 + (START_HP - me.hp) * 0.35 - (BANDAGE_COST - 2) * 0.3;
    case "ambush": {
      const lethal = killChance(t!, attackRange(me, "ambush")) * 0.9;
      return 0.55 + me.lie * 0.3 + (t!.ammo >= 2 ? 0.3 : 0) + lethal;
    }
  }
}

export function chooseBotMove(state: GameState, seat: Seat, level: BotLevel, rng: () => number = Math.random): Move | null {
  const moves = legalMoves(state, seat);
  if (moves.length === 0) return null;
  const scored = moves.map((move) => ({ move, score: scoreMove(state, seat, move) + rng() * 0.25 }));
  return pickByLevel(scored, level, rng);
}

/** 증강 선호도(대략적인 체감 가치) — 레벨이 높을수록 이 순서대로, 낮으면 아무거나 */
const AUG_PREF: Partial<Record<AugId, number>> = {
  supply: 1.2,
  bandolier: 1,
  helmet: 1.1,
  vest: 1.5,
  plate: 1.6,
  ammoCrate: 1.6,
  heavy: 1.4,
  sniper: 1.2,
  scavenger: 1.2,
  stethoscope: 1.1,
};

export function chooseBotAugment(state: GameState, seat: Seat, level: BotLevel, rng: () => number = Math.random): AugId | null {
  const offer = state.aug?.offers[seat] ?? [];
  if (!offer.length) return null;
  const scored = offer.map((id) => ({ move: id, score: (AUG_PREF[id] ?? 0.9) + AUG_BY_ID[id].tier * 0.05 + rng() * 0.4 }));
  return pickByLevel(scored, level, rng);
}
