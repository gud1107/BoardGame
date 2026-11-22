/**
 * 번개 짝꿍 (lightning-pair) 숫자·표 — 룰북 boardGameRule/번개짝꿍/번개짝꿍.md 와 같은 값.
 * 엔진·봇·보드·룰북 모달이 모두 여기서 읽어서 서로 어긋나지 않는다.
 */

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

export type Mode = "grab" | "dump";

export const MODE_INFO: Record<Mode, { emoji: string; label: string; short: string }> = {
  grab: { emoji: "⚡", label: "쟁탈전", short: "내 카드와 가운데 카드의 짝을 먼저 찾으면 가운데 카드를 가져와요. 카드를 가장 많이 모은 사람이 우승" },
  dump: { emoji: "🎯", label: "떨이전", short: "내 손 카드 맨 위와 가운데 카드의 짝을 찾으면 내 카드를 가운데로 버려요. 먼저 다 버리면 우승" },
};

/**
 * 그림 57개 — 카드 57장, 한 장에 8개. 어떤 두 카드든 **딱 하나**만 같다 (7차 사영평면).
 * 모양만으로 구분되게 골랐다: 색만 다른 그림(🔴🔵, 하트 색깔별 등)은 넣지 않는다 (색각 이상 배려).
 */
export const SYMBOLS = [
  "🍎", "🍌", "🍇", "🍉", "🍓", "🥕", "🌽", "🍄", "🌵", "🌲",
  "🌻", "🍀", "🔥", "💧", "⚡", "❄️", "🌙", "⭐", "☀️", "🌈",
  "☁️", "🐶", "🐱", "🐰", "🦊", "🐼", "🐸", "🐵", "🐔", "🐧",
  "🐢", "🐙", "🦋", "🐝", "🐌", "🐟", "🦀", "🦄", "🎈", "🎁",
  "🔑", "🔔", "🎸", "🎲", "⚽", "🚗", "🚀", "⛵", "✈️", "🏠",
  "⏰", "💡", "✂️", "🎩", "👓", "💎", "⚓",
] as const;

/** 그림 이름 (스크린리더·로그용). */
export const SYMBOL_NAMES = [
  "사과", "바나나", "포도", "수박", "딸기", "당근", "옥수수", "버섯", "선인장", "나무",
  "해바라기", "네잎클로버", "불", "물방울", "번개", "눈송이", "달", "별", "해", "무지개",
  "구름", "강아지", "고양이", "토끼", "여우", "판다", "개구리", "원숭이", "닭", "펭귄",
  "거북이", "문어", "나비", "벌", "달팽이", "물고기", "게", "유니콘", "풍선", "선물",
  "열쇠", "종", "기타", "주사위", "축구공", "자동차", "로켓", "돛단배", "비행기", "집",
  "자명종", "전구", "가위", "모자", "안경", "보석", "닻",
];

export const ORDER = 7;
export const SYMBOLS_PER_CARD = ORDER + 1;
export const CARD_COUNT = ORDER * ORDER + ORDER + 1;

/**
 * 7차 사영평면으로 카드 57장을 만든다. 점 (x,y) → x*7+y, 기울기 m → 49+m, 무한 → 56.
 * 직선 y = mx + b (49개) + 세로선 x = c (7개) + 무한 직선 (1개) = 57장, 각 8개 그림.
 */
export function buildDeck(): number[][] {
  const n = ORDER;
  const cards: number[][] = [];
  for (let m = 0; m < n; m++) {
    for (let b = 0; b < n; b++) {
      const c: number[] = [];
      for (let x = 0; x < n; x++) c.push(x * n + ((m * x + b) % n));
      c.push(n * n + m);
      cards.push(c);
    }
  }
  for (let x = 0; x < n; x++) {
    const c: number[] = [];
    for (let y = 0; y < n; y++) c.push(x * n + y);
    c.push(n * n + n);
    cards.push(c);
  }
  const inf: number[] = [];
  for (let m = 0; m <= n; m++) inf.push(n * n + m);
  cards.push(inf);
  return cards;
}

export const DECK: number[][] = buildDeck();

/** 두 카드의 같은 그림 (언제나 딱 하나). */
export function commonSymbol(a: number, b: number): number {
  const sa = DECK[a];
  const sb = DECK[b];
  for (const s of sa) if (sb.includes(s)) return s;
  return -1;
}

/** 판 시작 전 3·2·1. */
export const INTRO_MS = 3000;
/** 첫 맞힘이 방장에게 도착한 뒤 더 빠른 반응(먼 사람)이 도착하기를 기다리는 시간. */
export const CLAIM_WINDOW_MS = 400;
/**
 * 내 기기 반응 시간을 믿어 주는 한도: 방장 기준으로 카드가 열린 뒤 걸린 시간보다 이만큼 넘게 짧다고 하면 그 값으로 끌어올린다
 * (핑은 빼 주되, 반응 시간을 거짓으로 줄여 보내는 효과를 이 안으로 묶는다).
 */
export const LATENCY_ALLOW_MS = 800;
/** 사람이 8개 그림을 보고 짝을 찾는 가장 빠른 시간 — 이보다 짧은 값은 이 값으로 친다. */
export const MIN_FIND_MS = 300;
/** 틀린 그림을 누르면 얼어붙는 시간. */
export const FREEZE_MS = 1200;
/** 맞힘 결과를 보여 주는 시간 (모드별). */
export const REVEAL_MS: Record<Mode, number> = { grab: 1100, dump: 800 };
/** 아무도 못 찾고 이만큼 지나면 내 화면에 💡 힌트 (화면에만, 점수와 무관). */
export const HINT_MS = 9000;
/** 이보다 빠르면 ✨ 번개 손 (기록용). */
export const SWIFT_MS = 1000;

/** 쟁탈전: 가운데에 펼치는 카드 수 (덱이 모자라면 덱 끝까지). */
export const GRAB_ROUNDS = 25;
/** 쟁탈전: 이 간격마다 가운데 카드가 ⚡ 번개 카드 (2점). */
export const GOLDEN_EVERY = 6;
/** 떨이전: 인원별 손 카드 수. */
export function dumpHand(players: number): number {
  return Math.min(10, Math.floor((CARD_COUNT - 1) / players));
}

/** 자리 비움 투표 — 이만큼 아무것도 누르지 않으면. */
export const IDLE_MS = 40_000;

export const SEAT_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#f97316", "#06b6d4", "#ec4899"];
/** 색만으로 구분하지 않도록 이름표에 붙는 모양 기호. */
export const SEAT_SYMBOLS = ["●", "■", "▲", "◆", "★", "✚", "⬟", "♥"];

export interface SlotLayout {
  sym: number;
  /** 카드 중심 기준 % (−50~50) */
  x: number;
  y: number;
  scale: number;
  rot: number;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 카드 한 장의 그림 배치 — 가운데 1 + 둘레 7. 크기·기울기가 제각각이라 같은 그림도 달라 보인다.
 * (cardId, salt)로 정해져서 모든 기기에 똑같이 그려진다. 크기는 0.78~1.22배라 360px 화면에서도 누르기 쉽다.
 */
export function cardLayout(card: number, salt: number): SlotLayout[] {
  const rng = mulberry(card * 7919 + salt * 104729 + 17);
  const syms = [...DECK[card]];
  for (let i = syms.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [syms[i], syms[j]] = [syms[j], syms[i]];
  }
  const offset = rng() * Math.PI * 2;
  return syms.map((sym, i) => {
    const scale = 0.78 + rng() * 0.44;
    const rot = Math.round((rng() - 0.5) * 80);
    if (i === 0) return { sym, x: 0, y: 0, scale: scale * 1.05, rot };
    const a = offset + ((i - 1) / 7) * Math.PI * 2;
    const r = 31 + rng() * 3;
    return { sym, x: Math.cos(a) * r, y: Math.sin(a) * r, scale, rot };
  });
}
