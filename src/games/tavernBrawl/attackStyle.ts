import { FIGURES, type FigureSpec } from "./three/figureSpecs";
import { unitDef } from "./units";

/**
 * 캐릭터별 공격·피격 연출 정의 — 2D 재생(CombatReplay)과 3D 재생(Combat3D)이 같이 쓴다.
 * 무기·몸 형태(three/figures.tsx의 FIGURES)에서 기본값을 정하고, 개성이 필요한 유닛만 OVERRIDES로 덮는다.
 *
 * - kind: 무엇으로 때리나(베기·내려찍기·할퀴기·물기·찌르기·주먹·화살·마법탄·불꽃·번개·물·바람·그림자·나뭇잎·요정가루·성광·독·포탄)
 * - ranged: 원거리면 공격 유닛이 뛰어들지 않고 그 자리에서 투사체를 날린다
 * - color: 투사체·타격 이펙트 색
 * - material: 맞았을 때 이 유닛 몸에서 튀는 것(피격 반응) — 금속 불꽃, 뼛조각, 잎, 원소 입자, 피
 */

export type AttackKind =
  | "slash"
  | "smash"
  | "claw"
  | "bite"
  | "stab"
  | "punch"
  | "arrow"
  | "bolt"
  | "fire"
  | "lightning"
  | "water"
  | "wind"
  | "shadow"
  | "leaf"
  | "fairy"
  | "holy"
  | "poison"
  | "cannon";

export type HitMaterial = "flesh" | "metal" | "bone" | "plant" | "spirit" | "element" | "scale";

export interface AttackStyle {
  kind: AttackKind;
  ranged: boolean;
  color: string;
  /** 짧은 동작 이름 — 2D 재생 말풍선 등 */
  verb: string;
  material: HitMaterial;
  /** 맞았을 때 튀는 입자 색 */
  hitColor: string;
}

const RANGED: Partial<Record<AttackKind, true>> = { arrow: true, bolt: true, fire: true, lightning: true, water: true, leaf: true, fairy: true, poison: true, cannon: true };

const VERB: Record<AttackKind, string> = {
  slash: "베기",
  smash: "내려찍기",
  claw: "할퀴기",
  bite: "물어뜯기",
  stab: "찌르기",
  punch: "강철 주먹",
  arrow: "화살",
  bolt: "마법탄",
  fire: "불꽃",
  lightning: "번개",
  water: "물대포",
  wind: "회오리",
  shadow: "그림자 일격",
  leaf: "나뭇잎 칼날",
  fairy: "요정 가루",
  holy: "성스러운 일격",
  poison: "독 포자",
  cannon: "포격",
};

/** 개성이 필요한 유닛만 직접 지정 */
const OVERRIDES: Record<string, Partial<Pick<AttackStyle, "kind" | "color" | "material">>> = {
  k_guardian: { kind: "holy", color: "#fde68a" },
  k_paladin: { kind: "holy", color: "#fbbf24" },
  k_lord: { kind: "holy", color: "#fef08a" },
  n_priest: { kind: "holy", color: "#fef3c7" },
  e_origin: { kind: "holy", color: "#fef9c3" },
  f_oberon: { kind: "fairy", color: "#a5f3fc" },
  f_queen: { kind: "fairy", color: "#f9a8d4" },
  u_lich: { kind: "shadow", color: "#a78bfa" },
  dm_warlock: { kind: "fire", color: "#c026d3" },
  s_siren: { kind: "water", color: "#67e8f9" },
  n_alch: { kind: "poison", color: "#4ade80" },
  m_tank: { kind: "cannon", color: "#fb923c" },
  u_dk: { kind: "slash", color: "#ef4444" },
  dm_archfiend: { kind: "fire", color: "#f97316" },
  e_lava: { kind: "fire", color: "#f97316" },
  b_turtle: { kind: "smash", color: "#a3e635" },
  b_mammoth: { kind: "smash", color: "#d6a46b" },
  dm_boar: { kind: "smash", color: "#fb923c" },
  s_octo: { kind: "shadow", color: "#581c87" },
  u_crow: { kind: "stab", color: "#ef4444" },
  n_rogue: { kind: "stab", color: "#a3e635" },
  n_ninja: { kind: "stab", color: "#a3e635" },
  sy_treant: { kind: "smash", color: "#4ade80" },
  sy_worldtree: { kind: "leaf", color: "#a3e635" },
  d_guard: { kind: "bite", color: "#22d3ee" },
};

function fromFigure(f: FigureSpec): { kind: AttackKind; color: string; material: HitMaterial } {
  switch (f.kind) {
    case "human": {
      const material: HitMaterial = f.head === "skull" ? "bone" : f.head === "helm" || f.head === "plume" || f.head === "visor" ? "metal" : "flesh";
      switch (f.weapon) {
        case "sword":
        case "bigsword":
        case "swordShield":
          return { kind: "slash", color: f.accent, material };
        case "hammer":
        case "mace":
        case "shield":
        case "shovel":
          return { kind: "smash", color: f.accent, material };
        case "dagger":
          return { kind: "stab", color: f.accent, material };
        case "bow":
          return { kind: "arrow", color: f.accent, material };
        case "staff":
          return { kind: "bolt", color: f.accent, material };
        case "flask":
          return { kind: "poison", color: "#4ade80", material };
        default:
          return { kind: "punch", color: f.accent, material };
      }
    }
    case "beast":
      return { kind: f.tusks || f.shell ? "smash" : f.ears === "long" ? "bite" : "claw", color: "#fca5a5", material: f.shell ? "scale" : "flesh" };
    case "robot":
      return { kind: f.form === "mouse" ? "bite" : f.form === "tank" ? "cannon" : "punch", color: f.eye, material: "metal" };
    case "elemental": {
      const kind: AttackKind = f.form === "flame" ? "fire" : f.form === "drop" ? "water" : f.form === "tornado" ? "wind" : f.form === "storm" ? "lightning" : f.form === "lava" ? "fire" : "bolt";
      return { kind, color: f.core === "#ffffff" ? f.color : f.core, material: "element" };
    }
    case "wraith":
      return { kind: "shadow", color: f.eye, material: "spirit" };
    case "bird":
      return { kind: "stab", color: f.beak, material: "flesh" };
    case "dragon":
      return { kind: f.form === "lizard" || f.form === "drake" || f.form === "elder" ? "fire" : f.form === "bat" ? "claw" : "bite", color: f.form === "bat" ? "#c084fc" : "#fb923c", material: "scale" };
    case "critter":
      switch (f.form) {
        case "crab":
        case "fish":
        case "shark":
          return { kind: "bite", color: f.accent, material: "scale" };
        case "octopus":
          return { kind: "smash", color: f.color, material: "flesh" };
        case "eel":
          return { kind: "lightning", color: f.accent, material: "scale" };
        case "sprout":
          return { kind: "leaf", color: f.accent, material: "plant" };
        case "mushroom":
          return { kind: "poison", color: "#a3e635", material: "plant" };
        case "tree":
          return { kind: "smash", color: f.accent, material: "plant" };
        case "butterfly":
          return { kind: "fairy", color: f.color, material: "spirit" };
        default:
          return { kind: "bolt", color: f.color, material: "spirit" };
      }
  }
}

const HIT_COLOR: Record<HitMaterial, string> = {
  flesh: "#ef4444",
  metal: "#fde047",
  bone: "#f5f5f4",
  plant: "#4ade80",
  spirit: "#c4b5fd",
  element: "#fb923c",
  scale: "#fca5a5",
};

const cache = new Map<string, AttackStyle>();
export function attackStyle(defId: string): AttackStyle {
  const hit = cache.get(defId);
  if (hit) return hit;
  const fig = FIGURES[defId];
  const base = fig ? fromFigure(fig) : { kind: "punch" as AttackKind, color: "#fde68a", material: "flesh" as HitMaterial };
  const o = OVERRIDES[defId] ?? {};
  const kind = o.kind ?? base.kind;
  const material = o.material ?? base.material;
  // 원소 몸은 자기 색 입자가 튄다
  const elemColor = fig && fig.kind === "elemental" ? fig.color : null;
  const style: AttackStyle = {
    kind,
    ranged: !!RANGED[kind],
    color: o.color ?? base.color,
    verb: VERB[kind],
    material,
    hitColor: elemColor ?? (unitDef(defId).tribe === "undead" && material === "flesh" ? "#a78bfa" : HIT_COLOR[material]),
  };
  cache.set(defId, style);
  return style;
}
