import { seededRng } from "@/lib/rng";
import { KEYWORDS, unitDef, type Effect, type HeroId, type Keyword, type Tribe } from "./units";

/**
 * 여관 난투 전투 시뮬레이터 — 순수 함수. 같은 (보드A, 보드B, 영웅, 시드) → 항상 같은 결과·같은 프레임.
 * 엔진은 결과(승패·피해)만 쓰고, 보드 UI는 같은 함수를 `record: true`로 다시 돌려 프레임을 재생한다.
 * 그래서 전투 로그를 네트워크로 보내거나 상태에 저장할 필요가 없다(docs/auto-battler-spec.md §3.2).
 *
 * 규칙(룰북 §8): 유닛이 많은 쪽 선공(같으면 시드) → 양쪽이 번갈아 "다음 차례 유닛"이 공격 →
 * 대상은 도발 우선 무작위 → 서로 공격력만큼 피해 교환 → 죽음 처리(죽음의 메아리·부활) 반복.
 */

export interface UnitInstance {
  uid: string;
  defId: string;
  atk: number;
  hp: number;
  golden: boolean;
  kw: Keyword[];
}

export interface CombatSide {
  board: UnitInstance[];
  hero: HeroId | null;
  tier: number;
}

export interface Snap {
  uid: string;
  defId: string;
  atk: number;
  hp: number;
  golden: boolean;
  kw: Keyword[];
}

export type FrameEvent =
  | { t: "start" }
  | { t: "soc"; side: 0 | 1; uid: string | null; label: string }
  | { t: "attack"; side: 0 | 1; from: string; to: string; splash: string[] }
  | { t: "deaths"; uids: string[] }
  | { t: "end"; winner: 0 | 1 | null };

export interface Frame {
  sides: [Snap[], Snap[]];
  ev: FrameEvent;
  /** 이 프레임에서 보호막이 깨진 유닛 */
  popped: string[];
}

export interface CombatResult {
  winner: 0 | 1 | null;
  /** 승자 쪽 살아남은 유닛 등급 합(토큰 1) */
  survivorTiers: number;
  survivors: number;
  frames: Frame[];
}

export const MAX_COMBAT_STEPS = 300;

interface CU extends UnitInstance {
  poisoned: boolean;
  attacked: boolean;
}

export function tribeOf(defId: string): Tribe | null {
  return unitDef(defId).tribe;
}

/** 보드 위 종족 수(같은 유닛 중복 포함, 황금도 1). */
export function tribeCounts(board: readonly { defId: string }[]): Record<Tribe, number> {
  const c: Record<Tribe, number> = { knight: 0, beast: 0, mech: 0, elemental: 0, undead: 0, dragon: 0 };
  for (const u of board) {
    const t = tribeOf(u.defId);
    if (t) c[t]++;
  }
  return c;
}

export function synergyLevel(count: number): 0 | 2 | 4 | 6 {
  return count >= 6 ? 6 : count >= 4 ? 4 : count >= 2 ? 2 : 0;
}

/** 기본 스탯(황금이면 2배)으로 새 인스턴스 — 부활·소환용. */
export function baseInstance(defId: string, golden: boolean, uid: string): UnitInstance {
  const d = unitDef(defId);
  const m = golden ? 2 : 1;
  return { uid, defId, atk: d.atk * m, hp: d.hp * m, golden, kw: [...d.keywords] };
}

export function hasKw(u: { kw: Keyword[] }, k: Keyword): boolean {
  return u.kw.includes(k);
}

function addKw(u: { kw: Keyword[] }, k: Keyword) {
  if (!u.kw.includes(k)) u.kw.push(k);
}

function removeKw(u: { kw: Keyword[] }, k: Keyword) {
  const i = u.kw.indexOf(k);
  if (i >= 0) u.kw.splice(i, 1);
}

function snap(list: CU[]): Snap[] {
  return list.map((u) => ({ uid: u.uid, defId: u.defId, atk: u.atk, hp: u.hp, golden: u.golden, kw: [...u.kw] }));
}

export function simulateCombat(a: CombatSide, b: CombatSide, seed: number, record = false): CombatResult {
  const rng = seededRng(seed);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
  const sides: [CU[], CU[]] = [
    a.board.map((u) => ({ ...u, kw: [...u.kw], poisoned: false, attacked: false })),
    b.board.map((u) => ({ ...u, kw: [...u.kw], poisoned: false, attacked: false })),
  ];
  const heroes = [a.hero, b.hero] as const;
  const counts = [tribeCounts(a.board), tribeCounts(b.board)];
  const necroUsed = [false, false];
  let summonN = 0;
  const frames: Frame[] = [];
  let popped: string[] = [];
  const push = (ev: FrameEvent) => {
    if (record) frames.push({ sides: [snap(sides[0]), snap(sides[1])], ev, popped });
    popped = [];
  };

  function damage(u: CU, amount: number, poison: boolean) {
    if (amount <= 0 || u.hp <= 0) return;
    if (hasKw(u, "shield")) {
      removeKw(u, "shield");
      popped.push(u.uid);
      return;
    }
    u.hp -= amount;
    if (poison) u.poisoned = true;
  }

  function targetsFor(side: 0 | 1, source: CU | null, target: string, tribe?: Tribe): CU[] {
    const list = sides[side].filter((u) => u.hp > 0 && !u.poisoned && (!tribe || tribeOf(u.defId) === tribe));
    switch (target) {
      case "self":
        return source && source.hp > 0 ? [source] : [];
      case "randomOther": {
        const others = list.filter((u) => u !== source);
        return others.length ? [pick(others)] : [];
      }
      case "allOthers":
        return list.filter((u) => u !== source);
      case "all":
        return list;
      case "leftmost":
        return list.length ? [list[0]] : [];
      default:
        return [];
    }
  }

  /** 소환된 야수에 붙는 시너지 보너스 */
  function beastBonus(side: 0 | 1): number {
    const lv = synergyLevel(counts[side].beast);
    return lv === 6 ? 4 : lv === 4 ? 2 : lv === 2 ? 1 : 0;
  }

  function summon(side: 0 | 1, defId: string, golden: boolean, at: number): CU | null {
    if (sides[side].length >= 7) return null;
    const inst = baseInstance(defId, golden, `s${side}-${summonN++}`);
    const cu: CU = { ...inst, poisoned: false, attacked: false };
    if (tribeOf(defId) === "beast") {
      const bonus = beastBonus(side);
      cu.atk += bonus;
      cu.hp += bonus;
    }
    sides[side].splice(Math.max(0, Math.min(at, sides[side].length)), 0, cu);
    return cu;
  }

  function runEffects(side: 0 | 1, source: CU | null, effects: Effect[] | undefined, golden: boolean, at: number) {
    if (!effects) return;
    const m = golden ? 2 : 1;
    for (const e of effects) {
      if (e.kind === "buff") {
        for (const u of targetsFor(side, source, e.target, e.tribe)) {
          u.atk += e.atk * m;
          u.hp += e.hp * m;
        }
      } else if (e.kind === "grant") {
        for (const u of targetsFor(side, source, e.target, e.tribe)) addKw(u, e.keyword);
      } else if (e.kind === "summon") {
        for (let i = 0; i < e.count * m; i++) summon(side, e.unit, false, at + i);
      } else if (e.kind === "damage") {
        const enemy = (1 - side) as 0 | 1;
        const alive = sides[enemy].filter((u) => u.hp > 0 && !u.poisoned);
        if (e.target === "randomEnemy") {
          if (alive.length) damage(pick(alive), e.amount * m, false);
        } else {
          for (const u of alive) damage(u, e.amount * m, false);
        }
      }
      // gold / freeReroll은 상점 전용 — 전투에선 무시
    }
  }

  function isDead(u: CU) {
    return u.hp <= 0 || u.poisoned;
  }

  function processDeaths(order: [0 | 1, 0 | 1]) {
    for (let guard = 0; guard < 50; guard++) {
      const dead: { side: 0 | 1; u: CU; idx: number }[] = [];
      for (const side of order) {
        sides[side].forEach((u, idx) => {
          if (isDead(u)) dead.push({ side, u, idx });
        });
      }
      if (dead.length === 0) return;
      // 같은 편에서 왼쪽에 먼저 죽은 수만큼 위치를 당긴다
      const removedLeft = [0, 0];
      const placed = dead.map((d) => {
        const at = d.idx - removedLeft[d.side];
        removedLeft[d.side]++;
        return { ...d, at };
      });
      sides[0] = sides[0].filter((u) => !isDead(u));
      sides[1] = sides[1].filter((u) => !isDead(u));
      push({ t: "deaths", uids: dead.map((d) => d.u.uid) });
      const shift = [0, 0];
      for (const d of placed) {
        const def = unitDef(d.u.defId);
        const at = d.at + shift[d.side];
        const before = sides[d.side].length;
        runEffects(d.side, d.u, def.deathrattle, d.u.golden, at);
        if (hasKw(d.u, "reborn")) {
          const r = summon(d.side, d.u.defId, d.u.golden, at + (sides[d.side].length - before));
          if (r) {
            r.hp = 1;
            removeKw(r, "reborn");
          }
        } else if (heroes[d.side] === "necro" && !necroUsed[d.side] && !d.u.defId.startsWith("t_")) {
          necroUsed[d.side] = true;
          const r = summon(d.side, d.u.defId, d.u.golden, at + (sides[d.side].length - before));
          if (r) {
            r.hp = 1;
            removeKw(r, "reborn");
          }
        }
        shift[d.side] += sides[d.side].length - before;
        // 아군 사망 반응
        for (const ally of sides[d.side]) {
          if (ally.hp <= 0) continue;
          const ad = unitDef(ally.defId);
          if (ad.onAllyDeath) runEffects(d.side, ally, ad.onAllyDeath, ally.golden, 0);
        }
        if (synergyLevel(counts[d.side].undead) >= 4) {
          for (const u of sides[d.side]) if (tribeOf(u.defId) === "undead") u.atk += 1;
        }
      }
      if (shift[0] + shift[1] > 0) push({ t: "deaths", uids: [] });
    }
  }

  // ── 선공 결정 ──
  const first: 0 | 1 = sides[0].length > sides[1].length ? 0 : sides[1].length > sides[0].length ? 1 : rng() < 0.5 ? 0 : 1;
  const order: [0 | 1, 0 | 1] = [first, (1 - first) as 0 | 1];
  push({ t: "start" });

  // ── 전투 시작 효과: 영웅 → 종족 시너지 → 유닛(선공 쪽부터, 왼쪽부터) ──
  for (const side of order) {
    const list = sides[side];
    if (heroes[side] === "castellan" && list.length) {
      addKw(list[0], "shield");
      push({ t: "soc", side, uid: list[0].uid, label: "🏰 수호의 맹세" });
    }
    const c = counts[side];
    const kn = synergyLevel(c.knight);
    if (kn) {
      const knights = list.filter((u) => tribeOf(u.defId) === "knight");
      for (const u of kn === 2 ? knights.slice(0, 1) : knights) addKw(u, "shield");
      if (kn === 6) {
        for (const u of knights) {
          u.atk += 2;
          u.hp += 2;
        }
      }
      push({ t: "soc", side, uid: null, label: `🛡️ 기사단 ${kn}` });
    }
    const me = synergyLevel(c.mech);
    if (me >= 4) {
      for (const u of list) {
        if (tribeOf(u.defId) !== "mech") continue;
        u.atk += 1;
        u.hp += 2;
      }
      if (me === 6) for (const u of list) if (tribeOf(u.defId) === "mech") addKw(u, "reborn");
      push({ t: "soc", side, uid: null, label: `⚙️ 기계 ${me}` });
    }
    const un = synergyLevel(c.undead);
    if (un) {
      for (const u of list) {
        if (tribeOf(u.defId) !== "undead") continue;
        u.atk += 1;
        u.hp += 1;
      }
      if (un === 6) for (const u of list) if (tribeOf(u.defId) === "undead") addKw(u, "reborn");
      push({ t: "soc", side, uid: null, label: `💀 망령 ${un}` });
    }
    const dr = synergyLevel(c.dragon);
    if (dr) {
      const v = dr >= 4 ? 3 : 1;
      for (const u of list) {
        if (tribeOf(u.defId) !== "dragon") continue;
        u.atk += v;
        u.hp += v;
      }
      if (dr === 6) for (const u of sides[1 - side]) damage(u, 3, false);
      push({ t: "soc", side, uid: null, label: `🐲 용족 ${dr}` });
      if (dr === 6) processDeaths(order);
    }
  }
  for (const side of order) {
    for (const u of [...sides[side]]) {
      const d = unitDef(u.defId);
      if (!d.startOfCombat || u.hp <= 0) continue;
      runEffects(side, u, d.startOfCombat, u.golden, sides[side].indexOf(u));
      push({ t: "soc", side, uid: u.uid, label: d.name });
      processDeaths(order);
    }
  }

  // ── 공격 루프 ──
  const ptr = [0, 0];
  let turn: 0 | 1 = first;
  let steps = 0;
  let winner: 0 | 1 | null = null;
  while (steps < MAX_COMBAT_STEPS) {
    if (sides[0].length === 0 || sides[1].length === 0) break;
    const canAttack = (s: 0 | 1) => sides[s].some((u) => u.atk > 0);
    if (!canAttack(0) && !canAttack(1)) break;
    if (!canAttack(turn)) {
      turn = (1 - turn) as 0 | 1;
      continue;
    }
    steps++;
    const list = sides[turn];
    let idx = ptr[turn] % list.length;
    for (let i = 0; i < list.length && list[idx].atk <= 0; i++) idx = (idx + 1) % list.length;
    const attacker = list[idx];
    const enemy = (1 - turn) as 0 | 1;
    const taunts = sides[enemy].filter((u) => hasKw(u, "taunt"));
    const defender = pick(taunts.length ? taunts : sides[enemy]);
    const ad = unitDef(attacker.defId);
    if (ad.onAttack) runEffects(turn, attacker, ad.onAttack, attacker.golden, idx);
    const dIdx = sides[enemy].indexOf(defender);
    const splash = hasKw(attacker, "cleave") ? [sides[enemy][dIdx - 1], sides[enemy][dIdx + 1]].filter((u): u is CU => !!u) : [];
    const atkPoison = hasKw(attacker, "poison");
    damage(defender, attacker.atk, atkPoison);
    for (const s of splash) damage(s, attacker.atk, atkPoison);
    damage(attacker, defender.atk, hasKw(defender, "poison"));
    push({ t: "attack", side: turn, from: attacker.uid, to: defender.uid, splash: splash.map((s) => s.uid) });
    processDeaths(turn === 0 ? [0, 1] : [1, 0]);
    const after = sides[turn].indexOf(attacker);
    ptr[turn] = after >= 0 ? after + 1 : idx;
    turn = enemy;
  }
  if (sides[0].length > 0 && sides[1].length === 0) winner = 0;
  else if (sides[1].length > 0 && sides[0].length === 0) winner = 1;
  const survivorList = winner === null ? [] : sides[winner];
  push({ t: "end", winner });
  return {
    winner,
    survivorTiers: survivorList.reduce((s, u) => s + (unitDef(u.defId).token ? 1 : unitDef(u.defId).tier), 0),
    survivors: survivorList.length,
    frames,
  };
}

export function keywordLabel(k: Keyword): string {
  return `${KEYWORDS[k].icon} ${KEYWORDS[k].name}`;
}
