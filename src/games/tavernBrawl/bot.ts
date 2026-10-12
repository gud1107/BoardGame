import { classCounts, simulateCombat, synergyLevel, tribeCounts, type CombatSide, type UnitInstance } from "./combat";
import {
  BOARD_MAX,
  BUY_COST,
  HAND_MAX,
  applyAction,
  mix,
  upgradeCost,
  type EngineAction,
  type GameState,
  type Seat,
} from "./engine";
import { HERO_BY_ID, unitDef, type HeroId, type Tribe } from "./units";

/**
 * 여관 난투 봇(Lv.1~10). 상점 단계는 동시 진행이라 한 행동씩 보내면 7봇 × 수십 행동이 1초 간격으로
 * 줄을 서게 된다 — 그래서 봇은 한 라운드 상점 계획 전체를 로컬 복사본에 `applyAction`으로 미리
 * 굴려 보고(상점 굴림은 자기 좌석 시드라 결과가 확정적) `BATCH` 하나로 보낸다.
 *
 * 정보 공정성(ARCHITECTURE.md §7.1): 자기 좌석 + 공개 정보(체력·등급·지난 전투에서 드러난 보드)만 쓴다.
 */

interface Profile {
  /** 결정마다 엉뚱하게 굴 확률 */
  blunder: number;
  synergy: boolean;
  triples: boolean;
  /** 등급업 목표 라운드: curve[현재 등급] 라운드 이상이면 올린다 */
  curve: number[];
  rerollFloor: number;
  arrange: "none" | "heuristic" | "simulate";
}

export function botProfile(level: number): Profile {
  const L = Math.max(1, Math.min(10, Math.round(level)));
  return {
    blunder: [0.45, 0.35, 0.28, 0.2, 0.14, 0.1, 0.07, 0.04, 0.02, 0][L - 1],
    synergy: L >= 4,
    triples: L >= 3,
    curve:
      L <= 2
        ? [0, 3, 7, 10, 13, 16]
        : [0, 2, 5, 7, 9, 12], // 자가대전 측정: 더 빠른 곡선(2,4,6,8,10)은 Lv.5보다 평균 순위가 0.6 나빴다
    rerollFloor: L <= 3 ? 6 : L <= 6 ? 4 : 3,
    arrange: L <= 2 ? "none" : L <= 7 ? "heuristic" : "simulate",
  };
}

const HERO_RATING: Record<HeroId, number> = {
  tamer: 9,
  prophet: 8,
  necro: 7,
  castellan: 7,
  mage: 6,
  merchant: 6,
  architect: 5,
  mercenary: 5,
};

export function unitValue(u: UnitInstance): number {
  const d = unitDef(u.defId);
  const g = u.golden ? 2 : 1;
  let v = u.atk + u.hp + (d.ev ?? 0) * g + d.tier * 0.8;
  if (u.kw.includes("taunt")) v += 1;
  if (u.kw.includes("shield")) v += u.atk * 0.7 + 1;
  if (u.kw.includes("poison")) v += 5;
  if (u.kw.includes("reborn")) v += d.atk * g * 0.6 + 1;
  if (u.kw.includes("cleave")) v += u.atk * 0.5;
  if (u.kw.includes("windfury")) v += u.atk * 0.8;
  return v;
}

function protoValue(defId: string): number {
  const d = unitDef(defId);
  return unitValue({ uid: "", defId, atk: d.atk, hp: d.hp, golden: false, kw: [...d.keywords] });
}

function mainTribe(units: UnitInstance[]): Tribe | null {
  const c = tribeCounts(units);
  let best: Tribe | null = null;
  let n = 1;
  for (const [t, v] of Object.entries(c) as [Tribe, number][]) {
    if (v > n) {
      n = v;
      best = t;
    }
  }
  return best;
}

function buyScore(state: GameState, seat: Seat, defId: string, p: Profile): number {
  const s = state.seats[seat];
  const d = unitDef(defId);
  let v = protoValue(defId);
  const owned = [...s.board, ...s.hand].filter((u) => u.defId === defId && !u.golden).length;
  if (p.triples) v += owned >= 2 ? 14 : owned === 1 ? 3 : 0;
  if (p.synergy && d.tribe) {
    const all = [...s.board, ...s.hand];
    const c = tribeCounts(all)[d.tribe];
    if (c + 1 === 2 || c + 1 === 4 || c + 1 === 6) v += 4;
    if (mainTribe(all) === d.tribe) v += 2;
  }
  if (p.synergy && d.cls) {
    const cc = classCounts([...s.board, ...s.hand])[d.cls];
    if (cc + 1 === 2 || cc + 1 === 4 || cc + 1 === 6) v += 3;
  }
  // 악마의 대가(체력)는 체력이 낮을 때 부담
  if (d.tribe === "demon" && s.hp <= 10) v -= 4;
  return v;
}

/** 공개 정보로 본 상대 보드들(지난 전투에서 드러난 것) */
function knownEnemyBoards(state: GameState, seat: Seat): CombatSide[] {
  const out: CombatSide[] = [];
  for (const c of state.combats) {
    if (c.a !== seat && state.seats[c.a]?.alive) out.push(c.sideA);
    if (c.b >= 0 && c.b !== seat && state.seats[c.b]?.alive) out.push(c.sideB);
  }
  return out.slice(0, 4);
}

function heuristicOrder(board: UnitInstance[]): UnitInstance[] {
  const key = (u: UnitInstance) => {
    const d = unitDef(u.defId);
    const early = d.deathrattle?.some((e) => e.kind === "summon") || u.kw.includes("reborn") ? 0 : 1;
    const taunt = u.kw.includes("taunt") ? 1 : 0;
    return early * 100 + taunt * 50 - u.atk;
  };
  return [...board].sort((a, b) => key(a) - key(b));
}

function chooseOrder(state: GameState, seat: Seat, p: Profile, rng: () => number): UnitInstance[] {
  const s = state.seats[seat];
  if (p.arrange === "none") return s.board;
  const base = heuristicOrder(s.board);
  if (p.arrange === "heuristic") return base;
  const enemies = knownEnemyBoards(state, seat);
  if (enemies.length === 0 || s.board.length < 2) return base;
  const candidates: UnitInstance[][] = [base, [...base].reverse(), [...s.board].sort((a, b) => a.atk - b.atk), [...s.board].sort((a, b) => b.hp - a.hp)];
  for (let i = 0; i < 3; i++) candidates.push([...s.board].sort(() => rng() - 0.5));
  let best = base;
  let bestScore = -Infinity;
  candidates.forEach((order, ci) => {
    let score = 0;
    enemies.forEach((enemy, ei) => {
      for (let k = 0; k < 3; k++) {
        const r = simulateCombat({ board: order, hero: s.hero, tier: s.tier }, enemy, mix(state.seed, state.round, seat, ci, ei, k));
        score += r.winner === 0 ? 1 + r.survivorTiers * 0.05 : r.winner === 1 ? -1 - r.survivorTiers * 0.05 : 0;
      }
    });
    if (score > bestScore) {
      bestScore = score;
      best = order;
    }
  });
  return best;
}

/** 상점 한 라운드 계획. 반환 액션은 BATCH로 순서대로 재생하면 같은 결과가 난다. 마지막은 항상 READY. */
export function planShopTurn(state: GameState, seat: Seat, level: number, rng: () => number = Math.random): EngineAction[] {
  const p = botProfile(level);
  const round = state.round;
  const actions: EngineAction[] = [];
  let st = state;
  const act = (a: EngineAction): boolean => {
    const next = applyAction(st, a);
    if (next === st) return false;
    st = next;
    actions.push(a);
    return true;
  };
  const me = () => st.seats[seat];
  const worstBoard = () => me().board.reduce<UnitInstance | null>((w, u) => (!w || unitValue(u) < unitValue(w) ? u : w), null);

  for (let guard = 0; guard < 45; guard++) {
    const s = me();
    // 1) 발견
    if (s.discover.length) {
      const opts = s.discover[0];
      let pick = 0;
      if (rng() >= p.blunder) {
        let bv = -Infinity;
        opts.forEach((id, i) => {
          const v = buyScore(st, seat, id, p);
          if (v > bv) {
            bv = v;
            pick = i;
          }
        });
      }
      if (act({ type: "DISCOVER", seat, round, pick })) continue;
    }
    // 2) 손 → 보드
    if (s.hand.length && s.board.length < BOARD_MAX) {
      const best = [...s.hand].sort((a, b) => unitValue(b) - unitValue(a))[0];
      if (act({ type: "PLAY", seat, round, uid: best.uid, index: s.board.length })) continue;
    }
    if (s.hand.length && s.board.length >= BOARD_MAX) {
      const best = [...s.hand].sort((a, b) => unitValue(b) - unitValue(a))[0];
      const worst = worstBoard();
      if (worst && unitValue(best) > unitValue(worst) + 1.5) {
        if (act({ type: "SELL", seat, round, uid: worst.uid })) continue;
      }
      // 짝 맞추기 대기 중이 아닌 손 유닛은 팔아 골드로
      const pairWait = (u: UnitInstance) => p.triples && !u.golden && [...s.board, ...s.hand].filter((x) => x.defId === u.defId && !x.golden).length >= 2;
      const junk = s.hand.find((u) => !pairWait(u) && unitValue(u) <= unitValue(worst ?? u));
      if (junk && s.gold < BUY_COST && act({ type: "SELL", seat, round, uid: junk.uid })) continue;
    }
    // 3) 등급업
    const cost = upgradeCost(s);
    const wantTier = s.tier < 6 && round >= p.curve[s.tier] && !(s.hp <= 8 && s.tier >= 4 && s.board.length < BOARD_MAX);
    if (s.tier < 6 && s.gold >= cost && (wantTier || cost === 0) && rng() >= p.blunder / 2) {
      if (act({ type: "UPGRADE", seat, round })) continue;
    }
    // 등급업을 위해 돈을 모으는 라운드인지
    const savingFor = wantTier && s.gold < cost && s.gold >= cost - 2 && s.board.length >= 3;
    // 4) 구매
    if (s.gold >= BUY_COST && s.hand.length < HAND_MAX && !savingFor) {
      const slots = s.shop.map((id, slot) => (id ? { id, slot, v: buyScore(st, seat, id, p) } : null)).filter((x): x is { id: string; slot: number; v: number } => !!x);
      if (slots.length) {
        const choice = rng() < p.blunder ? slots[Math.floor(rng() * slots.length)] : slots.sort((a, b) => b.v - a.v)[0];
        const worst = worstBoard();
        const room = s.board.length + s.hand.length < BOARD_MAX;
        const upgrade = worst ? choice.v > unitValue(worst) + 2 : true;
        const triple = p.triples && [...s.board, ...s.hand].filter((u) => u.defId === choice.id && !u.golden).length >= 2;
        if ((room || upgrade || triple) && act({ type: "BUY", seat, round, slot: choice.slot })) continue;
      }
    }
    // 5) 영웅 능력
    const hero = s.hero ? HERO_BY_ID[s.hero] : null;
    if (hero && hero.cost !== null && !s.powerUsed && s.gold >= hero.cost && (hero.id !== "tamer" || s.board.length >= 4)) {
      const usable = hero.id === "mage" || hero.id === "tamer" ? s.board.length > 0 : true;
      const target = hero.id === "mage" ? [...s.board].sort((a, b) => unitValue(b) - unitValue(a))[0]?.uid : undefined;
      if (usable && act({ type: "HERO_POWER", seat, round, target })) continue;
    }
    // 6) 새로고침
    const wantsMore = s.board.length < BOARD_MAX || s.gold >= p.rerollFloor;
    if (wantsMore && round >= 2 && !savingFor && (s.freeRerolls > 0 || s.gold > BUY_COST || (s.gold >= p.rerollFloor && rng() > p.blunder))) {
      if (act({ type: "REROLL", seat, round })) continue;
    }
    break;
  }

  // 7) 배치
  const order = chooseOrder(st, seat, p, rng);
  order.forEach((u, index) => {
    const cur = me().board.findIndex((x) => x.uid === u.uid);
    if (cur !== index) act({ type: "MOVE", seat, round, uid: u.uid, index });
  });
  actions.push({ type: "READY", seat, round });
  return actions;
}

export function chooseBotHero(state: GameState, seat: Seat, level: number, rng: () => number = Math.random): HeroId {
  const opts = state.seats[seat].heroOptions;
  if (level <= 2 || rng() < botProfile(level).blunder) return opts[Math.floor(rng() * opts.length)];
  return [...opts].sort((a, b) => HERO_RATING[b] - HERO_RATING[a])[0];
}

/** ARCHITECTURE.md §7.1 계약 — 지금 이 좌석이 할 행동 하나(상점은 BATCH 한 덩어리). */
export function chooseBotAction(state: GameState, seat: Seat, level = 5, rng: () => number = Math.random): EngineAction | null {
  const s = state.seats[seat];
  if (!s) return null;
  if (state.phase === "heroPick") return s.hero === null ? { type: "PICK_HERO", seat, hero: chooseBotHero(state, seat, level, rng) } : null;
  if (state.phase === "combat") return s.inCombat && !s.combatDone ? { type: "COMBAT_DONE", seat, round: state.round } : null;
  if (state.phase === "shop" && s.alive && !s.ready) return { type: "BATCH", seat, round: state.round, actions: planShopTurn(state, seat, level, rng) };
  return null;
}

export { synergyLevel };
