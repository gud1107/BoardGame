import { unitDef, type ClassId } from "./units";

/**
 * 직업 스킬 — 롤토체스처럼 "기력"이 가득 차면 자기 공격 차례에 스킬을 먼저 쓰고 이어서 공격한다.
 * 기력: 전투 시작 1칸(MANA_RULES.start), 공격할 때 +1, 피해를 받고 살아남으면 +1(보호막에 막히면 0). 스킬을 쓰면 0으로.
 * 위력 p = 유닛 등급(황금이면 ×2). 토큰(직업 없음)은 스킬이 없다.
 * 수치는 balance.sim.test.ts 자가대전으로 확인 — 바꾸면 룰북 §9.5-1 표도 같이 고칠 것.
 */

/**
 * 기력 규칙(룰북 §9.5-1) — 전투 시작 기력과 사건별 증가량.
 * backPassive: 내 편 다른 유닛이 공격할 때마다 뒷줄 유닛 기력 +1(롤토체스의 시간당 기력 회복 같은 것).
 *   뒷줄은 근접에게 덜 맞고 공격 차례도 늦게 와서(앞줄 → 뒷줄 순) 기력이 거의 안 찼다 — 실측 궁수 0.09회/전투.
 *   backAttack(뒷줄 공격 시 +2)도 재 봤지만 궁수·마법사엔 효과가 없고 성직자만 폭증해 1로 둠(룰북 측정 기록).
 * maxCasts: 스킬은 유닛마다 전투당 이 횟수까지 — 회복 스킬끼리 끝없이 버티는 전투(300번 상한) 방지.
 */
export const MANA_RULES = { start: 1, attack: 1, backAttack: 1, hit: 1, allyDeath: 0, backPassive: 1, maxCasts: 2 };

export interface SkillDef {
  name: string;
  emoji: string;
  /** 필요한 기력 */
  mana: number;
  /** p를 넣은 설명 */
  text: (p: number) => string;
}

export const SKILLS: Record<ClassId, SkillDef> = {
  warrior: { name: "필살 일격", emoji: "💥", mana: 3, text: (p) => `이번 공격 피해 +${2 * p}` },
  guardian: { name: "방벽", emoji: "🛡️", mana: 2, text: (p) => `자신에게 보호막·도발, 체력 +${p}` },
  assassin: { name: "그림자 습격", emoji: "🌑", mana: 3, text: (p) => `체력이 가장 낮은 적에게 피해 ${2 * p}` },
  mage: { name: "화염구", emoji: "☄️", mana: 3, text: (p) => `무작위 적에게 피해 ${2 * p}, 그 양옆에 ${p}` },
  ranger: { name: "화살 비", emoji: "🌧️", mana: 3, text: (p) => `모든 적에게 피해 ${Math.ceil(p / 2)}` },
  cleric: { name: "성스러운 빛", emoji: "✨", mana: 3, text: (p) => `체력이 가장 낮은 아군 +0/+${2 * p}, 보호막` },
  berserker: { name: "피의 광란", emoji: "🩸", mana: 2, text: (p) => `자신 +${p}/+${p}` },
  summoner: { name: "정령 부르기", emoji: "🌀", mana: 3, text: (p) => `${p}/${p} 소환 정령을 옆에 부름(보드가 꽉 차도)` },
  plunderer: { name: "약탈", emoji: "💰", mana: 3, text: (p) => `무작위 적 공격력 −${p}, 자신 공격력 +${p}` },
};

export function skillOf(defId: string): SkillDef | null {
  const cls = unitDef(defId).cls;
  return cls ? SKILLS[cls] : null;
}

/** 스킬 위력: 등급 × (황금 2) */
export function skillPower(defId: string, golden: boolean): number {
  const d = unitDef(defId);
  return (d.token ? 1 : d.tier) * (golden ? 2 : 1);
}
