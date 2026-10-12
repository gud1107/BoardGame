import { seededRng } from "@/lib/rng";
import { KEYWORDS, unitDef, type ClassId, type Effect, type HeroId, type Keyword, type Tribe } from "./units";

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
  const c: Record<Tribe, number> = { knight: 0, beast: 0, mech: 0, elemental: 0, undead: 0, dragon: 0, sea: 0, demon: 0, sylvan: 0, fae: 0 };
  for (const u of board) {
    const t = tribeOf(u.defId);
    if (t) c[t]++;
  }
  return c;
}

export function classOf(defId: string): ClassId | null {
  return unitDef(defId).cls;
}

/** 보드 위 직업 수(같은 유닛 중복 포함, 황금도 1). */
export function classCounts(board: readonly { defId: string }[]): Record<ClassId, number> {
  const c: Record<ClassId, number> = { warrior: 0, guardian: 0, assassin: 0, mage: 0, ranger: 0, cleric: 0, berserker: 0, summoner: 0, plunderer: 0 };
  for (const u of board) {
    const k = classOf(u.defId);
    if (k) c[k]++;
  }
  return c;
}

/** 단계별 값 고르기: lv 2/4/6 → v2/v4/v6, 0 → 0 */
export function byLevel(lv: number, v2: number, v4: number, v6: number): number {
  return lv >= 6 ? v6 : lv >= 4 ? v4 : lv >= 2 ? v2 : 0;
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
  const ccounts = [classCounts(a.board), classCounts(b.board)];
  const clv = (side: 0 | 1, k: ClassId) => synergyLevel(ccounts[side][k]);
  const tlv = (side: 0 | 1, t: Tribe) => synergyLevel(counts[side][t]);
  /** 이번 행동에서 피해를 받은 유닛(광전사 판정용) */
  const hurt = new Set<CU>();
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
    hurt.add(u);
    if (poison) u.poisoned = true;
  }

  function targetsFor(side: 0 | 1, source: CU | null, target: string, tribe?: Tribe): CU[] {
    const list = sides[side].filter((u) => u.hp > 0 && !u.poisoned && (!tribe || tribeOf(u.defId) === tribe));
    const foes = sides[1 - side].filter((u) => u.hp > 0 && !u.poisoned);
    switch (target) {
      case "randomEnemy":
        return foes.length ? [pick(foes)] : [];
      case "allEnemies":
        return foes;
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
    return byLevel(lv, 2, 3, 5);
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
          u.atk = Math.max(0, u.atk + e.atk * m);
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

  /** 광전사: 피해를 받고 살아남은 광전사 공격력 +1/+2/+4 */
  function berserkerRage() {
    for (const u of hurt) {
      if (isDead(u) || classOf(u.defId) !== "berserker") continue;
      const side = sides[0].includes(u) ? 0 : sides[1].includes(u) ? 1 : -1;
      if (side < 0) continue;
      u.atk += byLevel(clv(side as 0 | 1, "berserker"), 1, 2, 4);
    }
    hurt.clear();
  }

  function processDeaths(order: [0 | 1, 0 | 1]) {
    berserkerRage();
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
        // 소환사: 죽으면 정령
        if (classOf(d.u.defId) === "summoner") {
          const v = byLevel(clv(d.side, "summoner"), 2, 4, 7);
          if (v) {
            const sp = summon(d.side, "t_spirit", false, at + (sides[d.side].length - before));
            if (sp) {
              sp.atk = v;
              sp.hp = v;
            }
          }
        }
        shift[d.side] += sides[d.side].length - before;
        // 요정: 죽으면 무작위 아군 강화
        if (tribeOf(d.u.defId) === "fae") {
          const v = byLevel(tlv(d.side, "fae"), 3, 4, 6);
          const alive = sides[d.side].filter((x) => !isDead(x));
          if (v && alive.length) {
            const t = pick(alive);
            t.atk += v;
            t.hp += v;
          }
        }
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
      for (const u of knights) {
        u.atk += kn === 6 ? 3 : 1;
        u.hp += kn === 6 ? 3 : 1;
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
      push({ t: "soc", side, uid: null, label: `👻 망령 ${un}` });
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
    const de = synergyLevel(c.demon);
    if (de) {
      const v = byLevel(de, 2, 4, 7);
      for (const u of list) {
        if (tribeOf(u.defId) !== "demon") continue;
        u.atk += v;
        u.hp += v;
      }
      push({ t: "soc", side, uid: null, label: `😈 악마 ${de}` });
    }
    // ── 직업 ──
    const of = (k: ClassId) => list.filter((u) => classOf(u.defId) === k);
    const wa = clv(side, "warrior");
    if (wa) {
      for (const u of of("warrior")) {
        u.atk += byLevel(wa, 2, 4, 7);
        u.hp += byLevel(wa, 0, 1, 3);
      }
      push({ t: "soc", side, uid: null, label: `⚔️ 전사 ${wa}` });
    }
    const gu = clv(side, "guardian");
    if (gu) {
      for (const u of of("guardian")) {
        u.hp += byLevel(gu, 2, 4, 0);
        if (gu >= 4) addKw(u, "taunt");
      }
      if (gu === 6) for (const u of list) u.hp += 4;
      push({ t: "soc", side, uid: null, label: `🧱 수호자 ${gu}` });
    }
    const asn = clv(side, "assassin");
    if (asn) {
      for (const u of of("assassin")) {
        u.atk += byLevel(asn, 2, 4, 4);
        u.hp += byLevel(asn, 1, 2, 2);
        if (asn === 6) addKw(u, "poison");
      }
      push({ t: "soc", side, uid: null, label: `🗡️ 암살자 ${asn}` });
    }
    const ra = clv(side, "ranger");
    if (ra) {
      for (const u of of("ranger")) {
        u.atk += byLevel(ra, 1, 3, 5);
        u.hp += byLevel(ra, 1, 3, 5);
        if (ra >= 4) addKw(u, "windfury");
      }
      // 선제 사격: 반격 없이 자기 공격력만큼
      for (const u of of("ranger")) {
        const foes = sides[1 - side].filter((x) => !isDead(x));
        if (foes.length && u.atk > 0) damage(pick(foes), u.atk, hasKw(u, "poison"));
      }
      push({ t: "soc", side, uid: null, label: `🏹 궁수 ${ra} — 선제 사격` });
      processDeaths(order);
    }
    const pl = clv(side, "plunderer");
    if (pl) {
      for (const u of of("plunderer")) {
        u.atk += byLevel(pl, 2, 3, 5);
        u.hp += byLevel(pl, 2, 3, 5);
      }
      push({ t: "soc", side, uid: null, label: `💰 약탈자 ${pl}` });
    }
    const cl = clv(side, "cleric");
    if (cl && list.length) {
      for (const u of of("cleric")) u.hp += 2;
      const n = cl === 6 ? list.length : cl === 4 ? 4 : 2;
      const pool = [...list];
      for (let i = 0; i < n && pool.length; i++) addKw(pool.splice(Math.floor(rng() * pool.length), 1)[0], "shield");
      push({ t: "soc", side, uid: null, label: `🕊️ 성직자 ${cl}` });
    }
    const mg = clv(side, "mage");
    if (mg) {
      const dmg = byLevel(mg, 2, 3, 5);
      for (let i = of("mage").length; i > 0; i--) {
        const foes = sides[1 - side].filter((u) => !isDead(u));
        if (foes.length) damage(pick(foes), dmg, false);
      }
      push({ t: "soc", side, uid: null, label: `🔮 마법사 ${mg}` });
      processDeaths(order);
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
    const swings = hasKw(attacker, "windfury") ? 2 : 1;
    for (let sw = 0; sw < swings; sw++) {
      if (isDead(attacker) || !sides[turn].includes(attacker) || sides[enemy].length === 0) break;
      const taunts = sides[enemy].filter((u) => hasKw(u, "taunt"));
      // 암살자(시너지 2 이상): 도발 무시하고 공격력이 가장 높은 적
      const sneaky = classOf(attacker.defId) === "assassin" && clv(turn, "assassin") >= 2;
      const defender = sneaky
        ? sides[enemy].reduce((hi, u) => (u.atk > hi.atk ? u : hi), sides[enemy][0])
        : pick(taunts.length ? taunts : sides[enemy]);
      const ad = unitDef(attacker.defId);
      if (ad.onAttack) runEffects(turn, attacker, ad.onAttack, attacker.golden, idx);
      const dIdx = sides[enemy].indexOf(defender);
      const splash = hasKw(attacker, "cleave") ? [sides[enemy][dIdx - 1], sides[enemy][dIdx + 1]].filter((u): u is CU => !!u) : [];
      const atkPoison = hasKw(attacker, "poison");
      damage(defender, attacker.atk, atkPoison);
      for (const s of splash) damage(s, attacker.atk, atkPoison);
      if (!sneaky) damage(attacker, defender.atk, hasKw(defender, "poison"));
      push({ t: "attack", side: turn, from: attacker.uid, to: defender.uid, splash: splash.map((s) => s.uid) });
      processDeaths(turn === 0 ? [0, 1] : [1, 0]);
    }
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
