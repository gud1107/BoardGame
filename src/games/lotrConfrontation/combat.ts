import { CARDS, CHARACTERS, ORC_KIND, FLYING } from "./data";
import type { CardEffect, CharacterId, Faction, LotrCard, PreStepKind } from "./types";

/**
 * Combat rules, split out of the reducer so each stage can be unit-tested on
 * its own. Two pure entry points:
 * - `preCombatSteps` — STEP 2 (attacker's abilities first, then defender's).
 * - `resolveCards`   — STEP 4+5 once both hidden cards are in.
 *
 * Card-stage order (rulebook §5-4, §8 "텍스트 무효화가 수치보다 먼저"):
 *  1. character nullifiers (간달프 / 사루만 / 위치킹 vs 원정대 기본 카드)
 *  2. 빛의 일격 cancels a dark 마법/불경한 마법 outright
 *  3. card nullifiers, simultaneous — 마법, 암흑의 공포, 사우론의 눈 (유리병 앞에서는 무력)
 *  4. 사악한 속임수 steals the opponent special's text
 *  5. instant effects: 엘프의 활 → 사우론의 눈 → 모르굴의 칼날 → 퇴각/독수리 (공격자 먼저)
 *  6. power = base (+아라곤/샘/쉐롭) + card (망토·거미줄·불경한 마법 반영) + bonus
 *  7. casualties: 미스릴 생존, 발록 채찍, 트롤/오크 패널티, 아셀라스, 그론드
 */

export type Side = "A" | "D";
const opp = (s: Side): Side => (s === "A" ? "D" : "A");

export interface Combatant {
  faction: Faction;
  characterId: CharacterId;
}

export function preCombatSteps(att: Combatant, def: Combatant): { side: Side; kind: PreStepKind }[] {
  const steps: { side: Side; kind: PreStepKind }[] = [];
  const pairs: [Side, Combatant, Combatant][] = [
    ["A", att, def],
    ["D", def, att],
  ];
  for (const [side, me, them] of pairs) {
    switch (me.characterId) {
      case "GIMLI":
        if (ORC_KIND.includes(them.characterId)) steps.push({ side, kind: "KILL" });
        break;
      case "LEGOLAS":
        if (FLYING.includes(them.characterId)) steps.push({ side, kind: "KILL" });
        break;
      case "MERRY":
        if (them.characterId === "WITCH_KING") steps.push({ side, kind: "KILL" });
        break;
      case "BOROMIR":
        steps.push({ side, kind: "BOROMIR" });
        break;
      case "SHELOB":
        steps.push({ side, kind: "SHELOB" });
        break;
      case "GOBLIN":
        steps.push({ side, kind: "GOBLIN_PEEK" });
        break;
      case "FRODO":
        steps.push({ side, kind: "FRODO_FLEE" });
        break;
      case "PIPPIN":
        steps.push({ side, kind: "PIPPIN" });
        break;
    }
  }
  return steps;
}

export interface CardCombatInput {
  A: Combatant & { cardId: string };
  D: Combatant & { cardId: string };
  /** Characters pinned to base 0 by Shelob. */
  baseZeroed: CharacterId[];
  /** Sauron characters that previously attacked Frodo (Sam's 헌신). */
  frodoAttackers: CharacterId[];
  /** Board lookup for 퇴각/독수리 — returns the destination region or null if there's nowhere to go. */
  findEscape: (side: Side, kind: "RETREAT" | "EAGLES") => string | null;
}

export type CardFate = "discard" | "hand" | "destroyed";

export interface CardCombatResult {
  dead: Record<Side, boolean>;
  escape: { side: Side; to: string; via: "RETREAT" | "EAGLES" } | null;
  power: Record<Side, number> | null;
  cardFate: Record<Side, CardFate>;
  /** Side whose faction recovers a basic card (희망의 빛). */
  athelas: Side | null;
  /** Side whose character is frozen by 그론드. */
  grond: Side | null;
  textOn: Record<Side, boolean>;
  log: string[];
}

export function effectiveBase(side: Side, me: Combatant, them: Combatant, baseZeroed: CharacterId[], frodoAttackers: CharacterId[]): number {
  if (baseZeroed.includes(me.characterId)) return 0;
  let base = CHARACTERS[me.characterId].basePower;
  if (me.characterId === "ARAGORN" && side === "A") base = 5;
  if (me.characterId === "SAM" && frodoAttackers.includes(them.characterId)) base = 5;
  return base;
}

export function resolveCards(input: CardCombatInput): CardCombatResult {
  const log: string[] = [];
  const who: Record<Side, Combatant> = { A: input.A, D: input.D };
  const card: Record<Side, LotrCard> = { A: CARDS[input.A.cardId], D: CARDS[input.D.cardId] };
  const name = (s: Side) => CHARACTERS[who[s].characterId].name;
  const textOn: Record<Side, boolean> = { A: true, D: true };
  const valueOn: Record<Side, boolean> = { A: true, D: true };
  const sides: Side[] = ["A", "D"];
  const cardFate: Record<Side, CardFate> = { A: "discard", D: "discard" };

  const base = (s: Side) => effectiveBase(s, who[s], who[opp(s)], input.baseZeroed, input.frodoAttackers);

  const result = (partial: Partial<CardCombatResult>): CardCombatResult => {
    const dead = partial.dead ?? { A: false, D: false };
    for (const s of sides) {
      const o = opp(s);
      if (dead[s] && who[s].characterId === "CAVE_TROLL") {
        cardFate[o] = "hand";
        log.push(`동굴 트롤 쓰러짐 — 상대는 방금 낸 [${card[o].name}]을(를) 손으로 되돌려받습니다.`);
      }
      if (dead[s] && who[s].characterId === "ORCS") {
        cardFate[o] = "destroyed";
        log.push(`오크 군단의 물량 공세 — 상대의 [${card[o].name}] 카드가 영구 파괴됩니다.`);
      }
    }
    return { escape: null, power: null, cardFate, athelas: null, grond: null, textOn: { ...textOn }, log, ...partial, dead };
  };

  // 1. Character nullifiers.
  for (const s of sides) {
    const o = opp(s);
    const c = who[s].characterId;
    if (c === "GANDALF" && card[o].effectType) {
      textOn[o] = false;
      log.push(`간달프의 백색의 마법 — [${card[o].name}]의 텍스트가 무시됩니다.`);
    }
    if (c === "SARUMAN" && card[o].effectType) {
      textOn[o] = false;
      log.push(`사루만의 음모 — [${card[o].name}]의 텍스트가 무효가 됩니다.`);
    }
    if (c === "WITCH_KING" && card[o].type === "BASIC" && card[o].effectType && who[o].faction === "FELLOWSHIP") {
      textOn[o] = false;
      log.push(`앙그마르의 군주 — 원정대 기본 카드 [${card[o].name}]의 효과가 무효화됩니다.`);
    }
  }

  // 2. 빛의 일격 vs dark magic.
  for (const s of sides) {
    const o = opp(s);
    if (textOn[s] && card[s].effectType === "SMITE" && who[o].faction === "SAURON" && (card[o].effectType === "MAGIC" || card[o].effectType === "BLACK_SORCERY")) {
      textOn[o] = false;
      valueOn[o] = false;
      log.push(`빛의 일격 — 어둠의 [${card[o].name}] 카드가 통째로 취소됩니다!`);
    }
  }

  // 3. Simultaneous card nullifiers (read from a snapshot so two 마법 cancel each other).
  const snap = { ...textOn };
  const phialSnap: Record<Side, boolean> = { A: snap.A && card.A.effectType === "PHIAL", D: snap.D && card.D.effectType === "PHIAL" };
  for (const s of sides) {
    const o = opp(s);
    const eff = card[s].effectType;
    if (!snap[s] || !eff) continue;
    if (eff === "MAGIC" && card[o].effectType) {
      textOn[o] = false;
      log.push(`${name(s)} 측 [마법] — 상대 [${card[o].name}]의 텍스트가 무력화됩니다.`);
    }
    if (eff === "DARK_DESPAIR") {
      textOn[o] = false;
      valueOn[o] = false;
      log.push(`암흑의 공포 — 상대 [${card[o].name}] 카드가 수치·텍스트 모두 무효화됩니다.`);
    }
    if (eff === "EYE_OF_SAURON" && !phialSnap[o]) {
      textOn[o] = false;
      valueOn[o] = false;
    }
  }

  // 4. Treachery: effect ownership (whose benefit a card's text serves).
  const owner: Record<Side, Side> = { A: "A", D: "D" };
  for (const s of sides) {
    const o = opp(s);
    if (textOn[s] && card[s].effectType === "TREACHERY" && textOn[o] && card[o].type === "SPECIAL" && card[o].effectType) {
      owner[o] = s;
      log.push(`사악한 속임수 — [${card[o].name}]의 효과를 사우론이 강탈합니다!`);
    }
  }
  const has = (s: Side, eff: CardEffect): boolean => sides.some((src) => textOn[src] && owner[src] === s && card[src].effectType === eff);

  // 5. Instant effects.
  for (const s of sides) {
    const o = opp(s);
    if (has(s, "ELVEN_BOW") && base(o) <= 3) {
      log.push(`엘프의 활 — 기본 전투력 ${base(o)}의 ${name(o)}을(를) 즉시 사살!`);
      return result({ dead: { A: o === "A", D: o === "D" } as Record<Side, boolean> });
    }
  }
  for (const s of sides) {
    const o = opp(s);
    if (has(s, "EYE_OF_SAURON")) {
      if (has(o, "PHIAL")) {
        log.push("사우론의 눈이 번뜩였지만 갈라드리엘의 유리병 빛에 가로막혔습니다!");
      } else {
        log.push("사우론의 눈 발동! 양측 캐릭터가 강제로 동반 사망합니다.");
        return result({ dead: { A: true, D: true } });
      }
    }
  }
  for (const s of sides) {
    const o = opp(s);
    if (has(s, "MORGUL_BLADE") && who[o].characterId === "FRODO") {
      if (has(o, "PHIAL")) {
        log.push("모르굴의 칼날이 유리병의 빛에 튕겨 나갔습니다!");
      } else {
        log.push("모르굴의 칼날이 프로도의 심장을 찔렀습니다! 프로도 즉사.");
        return result({ dead: { A: o === "A", D: o === "D" } as Record<Side, boolean> });
      }
    }
  }
  for (const s of sides) {
    const o = opp(s);
    for (const kind of ["RETREAT", "EAGLES"] as const) {
      if (!has(s, kind)) continue;
      if (has(o, "NAZGUL_SHRIEK")) {
        log.push(`나즈굴의 비명 — ${name(s)}의 ${kind === "RETREAT" ? "퇴각" : "독수리 공수"}가 봉쇄되었습니다!`);
        continue;
      }
      const to = input.findEscape(s, kind);
      if (to) {
        log.push(kind === "RETREAT" ? `${name(s)}이(가) 퇴각해 전투가 취소됩니다.` : `독수리가 ${name(s)}을(를) 낚아채 후방으로 공수합니다!`);
        return result({ escape: { side: s, to, via: kind } });
      }
      log.push(`${name(s)}은(는) 물러날 곳이 없어 ${kind === "RETREAT" ? "퇴각" : "공수"}에 실패했습니다.`);
    }
  }

  // 6. Power.
  const cardValue = (s: Side): number => {
    const o = opp(s);
    let v = valueOn[s] ? card[s].power : 0;
    if (has(o, "ELVEN_CLOAK") || has(o, "WEB")) v = 0;
    if (has(o, "BLACK_SORCERY")) v = Math.ceil(v / 2);
    return v;
  };
  const bonus = (s: Side): number => {
    const o = opp(s);
    let b = 0;
    if (has(s, "ANDURIL") && CHARACTERS[who[s].characterId].basePower >= 4) b += 1;
    if (has(s, "ENTS") && (who[o].characterId === "SARUMAN" || who[o].characterId === "CAVE_TROLL")) b += 3;
    if (has(s, "ORC_MOB") && s === "A" && CHARACTERS[who[s].characterId].basePower <= 2) b += 2;
    return b;
  };
  const power: Record<Side, number> = { A: base("A") + cardValue("A") + bonus("A"), D: base("D") + cardValue("D") + bonus("D") };
  log.push(`최종 전투력 — 공격 ${name("A")} ${power.A} vs 방어 ${name("D")} ${power.D}`);

  // 7. Casualties.
  const dead: Record<Side, boolean> = { A: false, D: false };
  let winner: Side | null = null;
  if (power.A > power.D) winner = "A";
  else if (power.D > power.A) winner = "D";
  if (winner) {
    const loser = opp(winner);
    if (has(loser, "MITHRIL_MAIL")) log.push(`미스릴 갑옷이 ${name(loser)}의 목숨을 지켰습니다!`);
    else dead[loser] = true;
    if (dead[loser] && who[loser].characterId === "BALROG") {
      if (has(winner, "PHIAL")) log.push("발록의 채찍이 유리병의 빛에 끊어졌습니다!");
      else {
        dead[winner] = true;
        log.push("발록의 화염 채찍! 패배하면서도 승자를 함께 끌고 갑니다.");
      }
    }
  } else {
    log.push("호각세의 대결! 양 캐릭터 모두 전사합니다.");
    for (const s of sides) {
      if (has(s, "MITHRIL_MAIL")) log.push(`미스릴 갑옷이 ${name(s)}의 목숨을 지켰습니다!`);
      else dead[s] = true;
    }
  }

  const athelas = sides.find((s) => has(s, "ATHELAS")) ?? null;
  const grond = sides.find((s) => has(s, "GROND") && !dead[s]) ?? null;

  return result({ dead, power, athelas, grond });
}
