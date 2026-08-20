import type { CardType, EquipSlot, Role, Team } from "./engine";

/**
 * Pure presentation data for every card type + role/team label, split out of
 * BangBoard.tsx (2026-08-21 hover/HP/center-banner redesign session — see
 * HANDOFF.md) so BangEffects.tsx's `deriveCenterEvent`/`CenterPlayBanner` and
 * CardFace.tsx can both read the same labels/icons/descriptions without
 * importing from BangBoard.tsx (which would create a circular import once
 * BangBoard itself imports the center-banner pieces from BangEffects.tsx).
 */

export type CardKind =
  | "self"
  | "none"
  | "target-bang"
  | "target-range1"
  | "target-any-alive"
  | "target-non-sheriff"
  | "response-only";

export const CARD_META: Record<CardType, { label: string; icon: string; desc: string; kind: CardKind }> = {
  bang: { label: "뱅!", icon: "💥", desc: "사거리 내의 상대 1명을 조준합니다. 상대는 '빗나감!'을 내거나 체력 1을 잃습니다.", kind: "target-bang" },
  missed: { label: "빗나감!", icon: "🛡️", desc: "뱅!이나 개틀링에 대한 방어 카드입니다. 응답할 때만 낼 수 있어요.", kind: "response-only" },
  beer: { label: "맥주", icon: "🍺", desc: "체력을 1 회복합니다 (생존자가 2명뿐일 때는 효과가 없어요).", kind: "self" },
  saloon: { label: "선술집", icon: "🍻", desc: "생존한 모든 플레이어가 체력을 1씩 회복합니다.", kind: "self" },
  duel: { label: "듀얼", icon: "🤠", desc: "상대 1명과 결투합니다. 번갈아 뱅!을 내다 먼저 못 내면 체력 1을 잃습니다 (거리 무관).", kind: "target-any-alive" },
  indians: { label: "인디언!", icon: "🏹", desc: "나를 제외한 모두가 뱅!을 버리거나 체력 1을 잃습니다.", kind: "none" },
  gatling: { label: "개틀링", icon: "🔫", desc: "나를 제외한 모두에게 뱅!과 같은 효과입니다 (거리 무관, 빗나감!으로 방어 가능).", kind: "none" },
  "general-store": { label: "종합 상점", icon: "🏪", desc: "생존자 수만큼 카드를 공개하고, 순서대로 한 장씩 가져갑니다.", kind: "none" },
  stagecoach: { label: "역마차", icon: "🐎", desc: "카드를 2장 더 뽑습니다.", kind: "self" },
  "wells-fargo": { label: "웰스파고", icon: "🚂", desc: "카드를 3장 더 뽑습니다.", kind: "self" },
  panic: { label: "패닉!", icon: "😱", desc: "거리 1 이내의 상대에게서 카드 1장(패 또는 장비)을 빼앗습니다.", kind: "target-range1" },
  "cat-balou": { label: "고양이 발톱", icon: "🐈", desc: "거리와 상관없이 상대의 카드 1장(패 또는 장비)을 버리게 합니다.", kind: "target-any-alive" },
  jail: { label: "감옥", icon: "🔒", desc: "보안관을 제외한 상대 1명에게 씌웁니다. 다음 턴 시작 시 하트를 뽑지 못하면 턴을 건너뜁니다.", kind: "target-non-sheriff" },
  dynamite: { label: "다이너마이트", icon: "🧨", desc: "자신에게 장착합니다. 매 턴 시작 시 스페이드 2~9를 뽑으면 폭발(체력 3 손실), 아니면 다음 사람에게 넘어갑니다.", kind: "self" },
  volcanic: { label: "볼카닉", icon: "🔫", desc: "사거리 1 무기. 장착한 턴부터 뱅!을 여러 번 낼 수 있게 해줍니다.", kind: "self" },
  schofield: { label: "스코필드", icon: "🔫", desc: "사거리 2 무기.", kind: "self" },
  remington: { label: "레밍턴", icon: "🔫", desc: "사거리 3 무기.", kind: "self" },
  "rev-carbine": { label: "레버액션 카빈", icon: "🔫", desc: "사거리 4 무기.", kind: "self" },
  winchester: { label: "윈체스터", icon: "🔫", desc: "사거리 5 무기.", kind: "self" },
  barrel: { label: "술통", icon: "🛢️", desc: "뱅!이나 개틀링을 맞았을 때 카드를 뽑아 하트가 나오면 방어합니다.", kind: "self" },
  scope: { label: "쌍안경", icon: "🔭", desc: "내가 상대를 조준할 때 거리가 1 가까워집니다.", kind: "self" },
  mustang: { label: "무스탕", icon: "🐎", desc: "상대가 나를 조준할 때 거리가 1 멀어집니다.", kind: "self" },
};

/** Weapon card types — the only equip slots whose displayed range depends on `weaponRange(player)` rather than a fixed per-card value. */
export const WEAPON_TYPES: CardType[] = ["volcanic", "schofield", "remington", "rev-carbine", "winchester"];

export const ROLE_LABEL: Record<Role, { label: string; icon: string }> = {
  sheriff: { label: "보안관", icon: "⭐" },
  deputy: { label: "부보안관", icon: "🥈" },
  outlaw: { label: "무법자", icon: "🥷" },
  renegade: { label: "배신자", icon: "🃏" },
};

export const TEAM_LABEL: Record<Team, string> = {
  law: "보안관 팀 승리!",
  outlaw: "무법자 팀 승리!",
  renegade: "배신자 단독 승리!",
};

export const EQUIP_ORDER: EquipSlot[] = ["weapon", "scope", "mustang", "barrel", "dynamite", "jail"];
