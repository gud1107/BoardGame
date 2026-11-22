/**
 * 🧙 마법 상점 card + customer-order catalogue (rules: boardGameRule/마법상점/마법상점.md).
 *
 * Elements: 0 🔥 불꽃 · 1 💧 이슬 · 2 🌿 약초 · 3 ✨ 별빛. 🪙 is spent on cards,
 * elements on customer orders. Every card effect is deterministic except the
 * two "폐기" cards (choose up to N hand cards) — that keeps lockstep replay and
 * the bot simple.
 */

export const ELEMENTS = 4;
export const FIRE = 0;
export const WATER = 1;
export const HERB = 2;
export const STAR = 3;
export const EL_EMOJI = ["🔥", "💧", "🌿", "✨"] as const;
export const EL_NAMES = ["불꽃", "이슬", "약초", "별빛"] as const;
/** Short letter for colour-blind players (every chip shows emoji + letter). */
export const EL_LETTER = ["불", "물", "풀", "별"] as const;
export const EL_COLOR = ["#f97316", "#38bdf8", "#4ade80", "#facc15"] as const;

export type Els = readonly [number, number, number, number];
export const NO_ELS: Els = [0, 0, 0, 0];

export type CardKind = "starter" | "supply" | "shop" | "curse";

export interface CardDef {
  id: string;
  name: string;
  emoji: string;
  cost: number;
  kind: CardKind;
  gold: number;
  els: Els;
  draw: number;
  /** Choose up to this many hand cards to remove from the game. */
  trash: number;
  /** 명성 gained every time it is played. */
  fame: number;
  /** Every other player gains a 🕸️ 거미줄 into their discard pile. */
  curse: boolean;
  /** Repeats the effect of the card played just before it this turn. */
  mirror: boolean;
  /** Copies in the shop deck (shop cards only). */
  copies: number;
  text: string;
}

const card = (d: Partial<CardDef> & Pick<CardDef, "id" | "name" | "emoji" | "cost" | "kind" | "text">): CardDef => ({
  gold: 0,
  els: NO_ELS,
  draw: 0,
  trash: 0,
  fame: 0,
  curse: false,
  mirror: false,
  copies: 0,
  ...d,
});

export const CARDS: readonly CardDef[] = [
  // ── starter (10 per player) ──
  card({ id: "coin", name: "동전", emoji: "🪙", cost: 0, kind: "starter", gold: 1, text: "🪙1" }),
  card({ id: "herb", name: "말린 약초", emoji: "🌱", cost: 0, kind: "starter", els: [0, 0, 1, 0], text: "🌿1" }),
  card({ id: "ember", name: "불씨", emoji: "🔸", cost: 0, kind: "starter", els: [1, 0, 0, 0], text: "🔥1" }),
  card({ id: "dew", name: "이슬 방울", emoji: "💠", cost: 0, kind: "starter", els: [0, 1, 0, 0], text: "💧1" }),
  // ── curse ──
  card({ id: "web", name: "거미줄", emoji: "🕸️", cost: 0, kind: "curse", text: "아무 효과 없음 · 끝날 때 명성 −1" }),
  // ── supply (always on the counter, unlimited) ──
  card({ id: "silver", name: "은화 주머니", emoji: "💰", cost: 3, kind: "supply", gold: 2, text: "🪙2" }),
  card({ id: "stardust", name: "별가루 병", emoji: "🫙", cost: 4, kind: "supply", els: [0, 0, 0, 1], text: "✨1" }),
  card({ id: "goldbar", name: "금화 상자", emoji: "🧰", cost: 6, kind: "supply", gold: 3, text: "🪙3" }),
  // ── shop deck (5 face-up on the shelf) ──
  card({ id: "candle", name: "도깨비 양초", emoji: "🕯️", cost: 2, kind: "shop", copies: 3, els: [2, 0, 0, 0], text: "🔥2" }),
  card({ id: "spring", name: "샘물 항아리", emoji: "🏺", cost: 2, kind: "shop", copies: 3, els: [0, 2, 0, 0], text: "💧2" }),
  card({ id: "mushroom", name: "반딧불 버섯", emoji: "🍄", cost: 2, kind: "shop", copies: 3, els: [0, 0, 2, 0], text: "🌿2" }),
  card({ id: "broom", name: "마법 빗자루", emoji: "🧹", cost: 2, kind: "shop", copies: 2, trash: 2, text: "손의 카드 최대 2장 폐기" }),
  card({ id: "salamander", name: "불도마뱀", emoji: "🦎", cost: 3, kind: "shop", copies: 2, els: [1, 0, 1, 0], text: "🔥1 🌿1" }),
  card({ id: "jelly", name: "물빛 해파리", emoji: "🪼", cost: 3, kind: "shop", copies: 2, els: [1, 1, 0, 0], text: "🔥1 💧1" }),
  card({ id: "bee", name: "꿀벌 일꾼", emoji: "🐝", cost: 3, kind: "shop", copies: 2, els: [0, 1, 1, 0], text: "💧1 🌿1" }),
  card({ id: "frog", name: "개구리 다리", emoji: "🐸", cost: 3, kind: "shop", copies: 2, els: [0, 0, 1, 0], draw: 1, text: "🌿1 · 카드 1장" }),
  card({ id: "mouse", name: "사역마 쥐", emoji: "🐭", cost: 3, kind: "shop", copies: 2, gold: 1, draw: 1, text: "🪙1 · 카드 1장" }),
  card({ id: "golem", name: "흙 골렘", emoji: "🗿", cost: 3, kind: "shop", copies: 2, els: [0, 0, 1, 0], trash: 1, text: "🌿1 · 손의 카드 1장 폐기" }),
  card({ id: "tome", name: "낡은 마법서", emoji: "📖", cost: 4, kind: "shop", copies: 2, draw: 2, text: "카드 2장" }),
  card({ id: "owl", name: "부엉이 배달부", emoji: "🦉", cost: 4, kind: "shop", copies: 2, gold: 2, draw: 1, text: "🪙2 · 카드 1장" }),
  card({ id: "cat", name: "검은 고양이", emoji: "🐈‍⬛", cost: 4, kind: "shop", copies: 2, gold: 2, curse: true, text: "🪙2 · 다른 모두에게 🕸️ 거미줄" }),
  card({ id: "phoenix", name: "불사조 깃털", emoji: "🪶", cost: 5, kind: "shop", copies: 2, els: [2, 0, 0, 0], draw: 1, text: "🔥2 · 카드 1장" }),
  card({ id: "fairy", name: "요정 가루", emoji: "🧚", cost: 5, kind: "shop", copies: 2, els: [0, 0, 0, 1], draw: 1, text: "✨1 · 카드 1장" }),
  card({ id: "cauldron", name: "달빛 가마솥", emoji: "🌙", cost: 5, kind: "shop", copies: 2, els: [0, 1, 0, 1], text: "💧1 ✨1" }),
  card({ id: "crystal", name: "수정 구슬", emoji: "🔮", cost: 5, kind: "shop", copies: 2, draw: 3, text: "카드 3장" }),
  card({ id: "mirror", name: "거울 마법", emoji: "🪞", cost: 5, kind: "shop", copies: 2, mirror: true, text: "바로 앞에 낸 카드 효과를 한 번 더" }),
  card({ id: "dragon", name: "용의 비늘", emoji: "🐉", cost: 6, kind: "shop", copies: 2, els: [2, 0, 0, 1], text: "🔥2 ✨1" }),
  card({ id: "sign", name: "황금 간판", emoji: "🪧", cost: 6, kind: "shop", copies: 2, gold: 1, fame: 1, text: "🪙1 · 명성 +1" }),
];

export const CARD_INDEX: Record<string, number> = Object.fromEntries(CARDS.map((c, i) => [c.id, i]));
export const cardDef = (id: number) => CARDS[id];
export const cid = (name: string) => CARD_INDEX[name];
export const SUPPLY_IDS: readonly number[] = CARDS.map((c, i) => (c.kind === "supply" ? i : -1)).filter((i) => i >= 0);
export const SHOP_IDS: readonly number[] = CARDS.map((c, i) => (c.kind === "shop" ? i : -1)).filter((i) => i >= 0);
export const WEB = CARD_INDEX.web;
export const STARTER: readonly number[] = [
  ...Array(6).fill(CARD_INDEX.coin),
  CARD_INDEX.herb,
  CARD_INDEX.herb,
  CARD_INDEX.ember,
  CARD_INDEX.dew,
];

/** Whether playing the card needs a choice (trash) or depends on play order (mirror). */
export const isChoiceCard = (id: number) => CARDS[id].trash > 0 || CARDS[id].mirror;

// ---------------------------------------------------------------------------
// Customer orders (📜 손님 의뢰)
// ---------------------------------------------------------------------------

export type OrderBonus = "none" | "gold2" | "draw1" | "flask" | "clean";
export const BONUS_TEXT: Record<OrderBonus, string> = {
  none: "",
  gold2: "🪙+2 (이번 턴)",
  draw1: "카드 1장 (바로)",
  flask: "🧪 보관병 +1칸 (영구)",
  clean: "🕸️ 거미줄 1장 폐기",
};

export interface OrderDef {
  id: number;
  customer: string;
  emoji: string;
  potion: string;
  need: Els;
  fame: number;
  bonus: OrderBonus;
}

const o = (customer: string, emoji: string, potion: string, need: Els, fame: number, bonus: OrderBonus = "none") => ({ customer, emoji, potion, need, fame, bonus });

const ORDER_LIST = [
  // 3 elements → 2~3
  o("마을 할머니", "👵", "감기약", [0, 1, 2, 0], 3, "gold2"),
  o("견습 기사", "🛡️", "용기의 물약", [2, 0, 1, 0], 3, "gold2"),
  o("어부", "🎣", "숨참기 물약", [0, 2, 1, 0], 3, "draw1"),
  o("농부", "👨‍🌾", "풍년 비료", [0, 0, 3, 0], 3, "flask"),
  o("대장장이", "🔨", "용광로 불씨", [3, 0, 0, 0], 3, "flask"),
  o("뱃사공", "⛵", "잔잔한 바다", [0, 3, 0, 0], 3, "flask"),
  o("떠돌이 상인", "🧳", "만능 연고", [1, 1, 1, 0], 3, "clean"),
  o("빵집 주인", "🥖", "부풀리기 가루", [2, 1, 0, 0], 3, "draw1"),
  o("정원사", "🧑‍🌾", "꽃 피우는 이슬", [0, 2, 2, 0], 4, "none"),
  o("사냥꾼", "🏹", "매의 눈 물약", [2, 0, 2, 0], 4, "none"),
  o("목욕탕 주인", "♨️", "온천수", [2, 2, 0, 0], 4, "none"),
  // with ✨
  o("점술가", "🔮", "예지몽 차", [0, 1, 1, 1], 5, "gold2"),
  o("음유시인", "🪕", "꾀꼬리 목소리", [1, 1, 0, 1], 5, "draw1"),
  o("연금술사", "⚗️", "현자의 소금", [1, 0, 1, 1], 5, "clean"),
  o("엘프 궁수", "🧝", "투명 망토 물약", [0, 2, 1, 1], 6, "flask"),
  o("드워프 광부", "⛏️", "어둠눈 물약", [2, 0, 1, 1], 6, "flask"),
  o("인어 공주", "🧜", "다리 생기는 물약", [0, 3, 0, 1], 6, "none"),
  o("용 사냥꾼", "🗡️", "화염 내성 물약", [3, 1, 0, 1], 7, "none"),
  o("숲의 정령", "🌳", "천년 나무 수액", [0, 1, 3, 1], 7, "none"),
  o("왕실 요리사", "👨‍🍳", "황금 소스", [1, 1, 1, 1], 7, "gold2"),
  o("떠도는 유령", "👻", "성불의 향", [1, 0, 0, 2], 7, "clean"),
  o("밤의 마녀", "🧙‍♀️", "달빛 미약", [0, 2, 0, 2], 8, "none"),
  o("공주님", "👸", "영원한 아름다움", [1, 1, 1, 2], 9, "none"),
  o("늙은 용", "🐲", "회춘의 묘약", [2, 1, 1, 2], 11, "none"),
  o("대마법사", "🧙", "별의 정수", [1, 1, 2, 2], 11, "none"),
  o("국왕 폐하", "🤴", "불로장생약", [2, 2, 2, 2], 15, "none"),
] as const;

export const ORDERS: readonly OrderDef[] = ORDER_LIST.map((x, id) => ({ id, ...x, need: x.need as unknown as Els }));
export const orderDef = (id: number) => ORDERS[id];
export const needTotal = (need: Els) => need[0] + need[1] + need[2] + need[3];
