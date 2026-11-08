/**
 * 안개 저택 살인사건 — 카드·저택 데이터. 규칙 원전: boardGameRule/안개저택살인사건/안개저택살인사건.md §2.
 *
 * 카드 번호 0~20: 용의자 0~5, 흉기 6~11, 장소 12~20 (장소 카드 = 12 + 방 번호).
 * 방 번호 0~8은 3×3 단면도 순서(위층부터, 서→동).
 */

export type Category = "suspect" | "weapon" | "room";
export const CATEGORIES: Category[] = ["suspect", "weapon", "room"];

export const SUSPECT_COUNT = 6;
export const WEAPON_COUNT = 6;
export const ROOM_COUNT = 9;
export const CARD_COUNT = SUSPECT_COUNT + WEAPON_COUNT + ROOM_COUNT;
export const WEAPON_BASE = SUSPECT_COUNT;
export const ROOM_BASE = SUSPECT_COUNT + WEAPON_COUNT;

export interface SuspectDef {
  name: string;
  job: string;
  icon: string;
  color: string;
  /** [손잡이 0=오른손 1=왼손, 키 0=작은 1=큰, 냄새 0=향수 1=담배] */
  traits: [number, number, number];
  motive: string;
  /** 알리바이 단서 문장 */
  alibi: string;
}

export const SUSPECTS: SuspectDef[] = [
  { name: "오정한", job: "집사", icon: "🎩", color: "#64748b", traits: [0, 1, 1], motive: "40년을 모셨지만 유언장에 이름 한 줄 없었다", alibi: "자정 무렵 주방에서 하녀들과 은그릇을 닦고 있었다" },
  { name: "남궁세린", job: "상속녀", icon: "💎", color: "#db2777", traits: [1, 0, 0], motive: "유산 상속 순위가 바뀐다는 소문을 들었다", alibi: "자정 내내 손님들 앞에서 피아노를 치고 있었다" },
  { name: "권태오", job: "주치의", icon: "🩺", color: "#0891b2", traits: [0, 0, 0], motive: "회장의 처방전에 감춰진 의료 사고가 드러날 참이었다", alibi: "열이 난 하인을 돌보느라 하인 숙소를 떠나지 않았다" },
  { name: "민유라", job: "화가", icon: "🎨", color: "#7c3aed", traits: [1, 1, 0], motive: "위작이라며 퇴짜 맞은 초상화 값을 받지 못했다", alibi: "온실 창가에서 폭풍을 스케치하는 모습이 목격됐다" },
  { name: "장도식", job: "동업자", icon: "💼", color: "#b45309", traits: [0, 0, 1], motive: "다음 날 아침 터질 횡령 장부를 회장이 쥐고 있었다", alibi: "자정에 섬 밖으로 무선 전화를 거는 소리가 기록돼 있다" },
  { name: "한봄", job: "정원사", icon: "🌿", color: "#15803d", traits: [1, 1, 1], motive: "온실 땅 아래 묻힌 비밀을 회장이 파내려 했다", alibi: "폭풍에 쓰러진 정원수를 붙들고 밤새 비를 맞고 있었다" },
];

export interface WeaponDef {
  name: string;
  icon: string;
  /** [상처 0=무외상 1=외상, 출처 0=외부 반입 1=저택 물건] */
  traits: [number, number];
  /** 알리바이 단서 문장 */
  alibi: string;
}

export const WEAPONS: WeaponDef[] = [
  { name: "은촛대", icon: "🕯️", traits: [1, 1], alibi: "은촛대는 식탁 위 제자리에, 먼지까지 그대로 있다" },
  { name: "부지깽이", icon: "🔥", traits: [1, 1], alibi: "부지깽이는 벽난로 옆 걸이에 깨끗하게 걸려 있다" },
  { name: "사냥칼", icon: "🔪", traits: [1, 0], alibi: "사냥칼은 동업자의 가방 속 칼집에 녹이 슨 채 꽂혀 있다" },
  { name: "비단 커튼끈", icon: "🎗️", traits: [0, 1], alibi: "비단 커튼끈은 모든 창에 그대로 매여 있다" },
  { name: "독약병", icon: "🧪", traits: [0, 0], alibi: "독약병은 봉인 밀랍이 깨지지 않은 채 약장 안에 있다" },
  { name: "주사기", icon: "💉", traits: [0, 0], alibi: "주사기는 왕진 가방 속에서 포장도 뜯기지 않았다" },
];

export type Floor = 0 | 1 | 2; // 0=2층 1=1층 2=지하
export type Wing = 0 | 1 | 2; // 0=서관 1=중앙 2=동관

export interface RoomDef {
  name: string;
  icon: string;
  floor: Floor;
  wing: Wing;
  /** 2D 방 바닥 색 */
  tint: string;
  /** 알리바이 단서 문장 */
  alibi: string;
}

export const ROOMS: RoomDef[] = [
  { name: "침실", icon: "🛏️", floor: 0, wing: 0, tint: "#3b2a4a", alibi: "침실 이불은 반듯하고 아무도 들어온 흔적이 없다" },
  { name: "음악실", icon: "🎹", floor: 0, wing: 1, tint: "#2e3350", alibi: "음악실 바닥엔 먼지 위로 발자국 하나 없다" },
  { name: "서재", icon: "📚", floor: 0, wing: 2, tint: "#3a2e22", alibi: "서재 문은 저녁부터 안에서 잠겨 있었다" },
  { name: "온실", icon: "🌿", floor: 1, wing: 0, tint: "#1f3a2c", alibi: "온실의 젖은 흙 위엔 정원사의 장화 자국뿐이다" },
  { name: "대연회장", icon: "🏛️", floor: 1, wing: 1, tint: "#43301c", alibi: "대연회장은 자정 내내 손님들로 북적였다" },
  { name: "응접실", icon: "🛋️", floor: 1, wing: 2, tint: "#422326", alibi: "응접실 찻잔은 식은 채 아무도 손대지 않았다" },
  { name: "주방", icon: "🍳", floor: 2, wing: 0, tint: "#2d3236", alibi: "주방은 하녀들이 밤새 지키고 있었다" },
  { name: "와인 저장고", icon: "🍷", floor: 2, wing: 1, tint: "#3a1b25", alibi: "와인 저장고 자물쇠는 녹이 슨 채 그대로다" },
  { name: "당구실", icon: "🎱", floor: 2, wing: 2, tint: "#163327", alibi: "당구대 위 공들이 어제 끝난 게임 그대로 놓여 있다" },
];

export const FLOOR_NAMES = ["2층", "1층", "지하"] as const;
export const WING_NAMES = ["서관", "중앙", "동관"] as const;

/** 시작 방 — 대연회장 */
export const START_ROOM = 4;

/** 비밀 통로 (대각선 끝끼리) */
export const PASSAGES: [number, number][] = [
  [0, 8],
  [2, 6],
];

/** 붙은 방 (문 + 비밀 통로) */
export function neighbors(room: number): number[] {
  const r = Math.floor(room / 3);
  const c = room % 3;
  const out: number[] = [];
  if (r > 0) out.push(room - 3);
  if (r < 2) out.push(room + 3);
  if (c > 0) out.push(room - 1);
  if (c < 2) out.push(room + 1);
  for (const [a, b] of PASSAGES) {
    if (a === room) out.push(b);
    if (b === room) out.push(a);
  }
  return out;
}

export function isPassage(a: number, b: number): boolean {
  return PASSAGES.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

/** 이동 최대 칸 */
export const MOVE_STEPS = 1;

/** room에서 steps칸 안에 갈 수 있는 방 → 최단 경로(출발 제외) */
export function reachable(room: number, steps = MOVE_STEPS): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const queue: { at: number; path: number[] }[] = [{ at: room, path: [] }];
  const seen = new Set([room]);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.path.length >= steps) continue;
    for (const n of neighbors(cur.at)) {
      if (seen.has(n)) continue;
      seen.add(n);
      const path = [...cur.path, n];
      out.set(n, path);
      queue.push({ at: n, path });
    }
  }
  return out;
}

export function categoryOf(card: number): Category {
  if (card < WEAPON_BASE) return "suspect";
  if (card < ROOM_BASE) return "weapon";
  return "room";
}

export function cardsOf(cat: Category): number[] {
  if (cat === "suspect") return Array.from({ length: SUSPECT_COUNT }, (_, i) => i);
  if (cat === "weapon") return Array.from({ length: WEAPON_COUNT }, (_, i) => WEAPON_BASE + i);
  return Array.from({ length: ROOM_COUNT }, (_, i) => ROOM_BASE + i);
}

export function cardName(card: number): string {
  const c = categoryOf(card);
  if (c === "suspect") return SUSPECTS[card].name;
  if (c === "weapon") return WEAPONS[card - WEAPON_BASE].name;
  return ROOMS[card - ROOM_BASE].name;
}

export function cardIcon(card: number): string {
  const c = categoryOf(card);
  if (c === "suspect") return SUSPECTS[card].icon;
  if (c === "weapon") return WEAPONS[card - WEAPON_BASE].icon;
  return ROOMS[card - ROOM_BASE].icon;
}

export function cardLabel(card: number): string {
  return `${cardIcon(card)} ${cardName(card)}`;
}

export const roomCard = (room: number) => ROOM_BASE + room;

// ------------------------------------------------------------------ 특징

/** 특징 하나 — 카테고리, 특징 번호, 값 */
export interface TraitRef {
  cat: Category;
  dim: number;
  value: number;
}

export const TRAIT_DIMS: Record<Category, number> = { suspect: 3, weapon: 2, room: 2 };

/** 카드의 특징 값 (room: dim 0=층, 1=관) */
export function traitValue(card: number, dim: number): number {
  const c = categoryOf(card);
  if (c === "suspect") return SUSPECTS[card].traits[dim];
  if (c === "weapon") return WEAPONS[card - WEAPON_BASE].traits[dim];
  const r = ROOMS[card - ROOM_BASE];
  return dim === 0 ? r.floor : r.wing;
}

export function matchesTrait(card: number, t: TraitRef): boolean {
  return categoryOf(card) === t.cat && traitValue(card, t.dim) === t.value;
}

/** 특징 단서 문장 */
export function traitText(t: TraitRef): string {
  if (t.cat === "suspect") {
    if (t.dim === 0) return t.value === 1 ? "상처의 각도로 보아 범인은 왼손잡이다" : "상처의 각도로 보아 범인은 오른손잡이다";
    if (t.dim === 1) return t.value === 1 ? "커튼 높은 곳이 찢겨 있다 — 범인은 키가 크다" : "낮은 선반에만 손자국이 있다 — 범인은 키가 작다";
    return t.value === 1 ? "현장에 독한 담배 냄새가 배어 있다" : "현장에 달콤한 향수 냄새가 남아 있다";
  }
  if (t.cat === "weapon") {
    if (t.dim === 0) return t.value === 1 ? "시신에 뚜렷한 외상이 있다" : "시신엔 외상이 하나도 없다";
    return t.value === 1 ? "흉기는 원래 저택에 있던 물건이다" : "흉기는 누군가 밖에서 몰래 들여온 물건이다";
  }
  if (t.dim === 0) return `범행 현장은 ${FLOOR_NAMES[t.value]}${t.value === 2 ? "다" : "이다"} — ${["창밖으로 번개가 내려다보였다", "현관 괘종 소리가 가까웠다", "벽에서 습기가 배어 나왔다"][t.value]}`;
  return `범행 현장은 ${WING_NAMES[t.value]}이다 — ${["서쪽 절벽 파도 소리가 들렸다", "중앙 계단의 삐걱임이 들렸다", "동쪽 등대 불빛이 비쳤다"][t.value]}`;
}

/** 짧은 특징 이름 (노트용) */
export function traitShort(t: TraitRef): string {
  if (t.cat === "suspect") return [["오른손잡이", "왼손잡이"], ["작은 키", "큰 키"], ["향수", "담배"]][t.dim][t.value];
  if (t.cat === "weapon") return [["무외상", "외상"], ["외부 반입", "저택 물건"]][t.dim][t.value];
  return t.dim === 0 ? FLOOR_NAMES[t.value] : WING_NAMES[t.value];
}

/** 알리바이 단서 문장 */
export function alibiText(card: number): string {
  const c = categoryOf(card);
  if (c === "suspect") return `${SUSPECTS[card].icon} ${SUSPECTS[card].name}: ${SUSPECTS[card].alibi}`;
  if (c === "weapon") return `${WEAPONS[card - WEAPON_BASE].icon} ${WEAPONS[card - WEAPON_BASE].alibi}`;
  return `${ROOMS[card - ROOM_BASE].icon} ${ROOMS[card - ROOM_BASE].alibi}`;
}

/** 탐정 색 (좌석) */
export const SEAT_COLORS = ["#f59e0b", "#38bdf8", "#f472b6", "#4ade80", "#a78bfa", "#fb7185"];
export const SEAT_GLYPHS = ["◆", "●", "▲", "■", "★", "✚"];

/** 인원별 라운드 수 (§2-4, §13) */
/** 인원별 금고 증거(아무도 못 보는 엎어 둔 카드) 장수 (§3, §13) — 나머지를 똑같이 나누고 남는 카드는 앞면 공개 */
export const VAULT_BY_PLAYERS: Record<number, number> = { 2: 2, 3: 0, 4: 0, 5: 0, 6: 0 };

export const ROUNDS_BY_PLAYERS: Record<number, number> = { 2: 14, 3: 8, 4: 8, 5: 8, 6: 9 };
