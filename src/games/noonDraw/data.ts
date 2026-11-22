/**
 * 정오의 발도 (noon-draw) 숫자·표 — 룰북 boardGameRule/정오의발도/정오의발도.md 와 같은 값.
 * 엔진·봇·보드·룰북 모달이 모두 여기서 읽어서 서로 어긋나지 않는다.
 */

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

export type Mode = "tournament" | "brawl";

export const MODE_INFO: Record<Mode, { emoji: string; label: string; short: string }> = {
  tournament: { emoji: "⚔️", label: "토너먼트", short: "1:1 대진표, 2선승(결승 3선승). 탈락하면 🔮 예측으로 참여" },
  brawl: { emoji: "🌪️", label: "난투", short: "모두가 한꺼번에. 부정 출발·가장 느린 사람이 ❤️를 잃고, 마지막까지 남으면 우승" },
};

/** 판 시작 전 소개 (대진표·인원 보여 주기). */
export const INTRO_MS = 3200;
/** 자세 잡기 — 이때 누르는 건 무시 (부정 출발 아님). */
export const READY_MS = 1600;
/** 신호까지 기다리는 시간 = WAIT_MIN + 무작위 × (WAIT_SPAN + 열기 × WAIT_SPAN_PER_HEAT), 최대 WAIT_MAX. */
export const WAIT_MIN_MS = 1800;
export const WAIT_SPAN_MS = 2600;
export const WAIT_SPAN_PER_HEAT = 900;
export const WAIT_MAX_MS = 7500;
/** 신호 뒤 이만큼 안에 뽑아야 함 — 넘기면 "못 뽑음". */
export const DRAW_LIMIT_MS = 1500;
/** 방장이 늦게 도착하는 입력을 기다려 주는 여유 (네트워크). */
export const ARRIVAL_GRACE_MS = 900;
/** 이보다 빠른 반응은 사람이 볼 수 없는 속도 → 부정 출발 (육상 규칙과 같음). */
export const MIN_HUMAN_RT_MS = 100;
/** 이보다 빠르면 ✨ 신속(기록용). */
export const SWIFT_RT_MS = 200;
/** 한 합의 결과를 보여 주는 시간. */
export const RESULT_MS = 2700;
/** 다음 라운드(대진표 다음 단계) 넘어가며 보여 주는 시간. */
export const BETWEEN_MS = 3000;
/** 한 경기에서 점수 없는 합(양쪽 부정 출발·동시·둘 다 못 뽑음)이 이만큼 이어지면 심판 판정. */
export const STALL_LIMIT = 3;

/** 토너먼트 승리 조건. */
export const WINS_TO_ADVANCE = 2;
export const WINS_FINAL = 3;

/** 난투 시작 하트 (인원별). */
export function brawlHearts(players: number): number {
  return players >= 6 ? 2 : 3;
}
/** 난투에서 부정 출발·못 뽑음이 없을 때 하트를 잃는 가장 느린 사람 수. */
export function brawlSlowLosers(alive: number): number {
  return alive >= 5 ? 2 : 1;
}
/** 난투 최대 합 수 — 넘기면 하트, 평균 반응으로 순위. */
export const BRAWL_MAX_ROUNDS = 30;

export type FeintKind = "bird" | "leaf" | "crow" | "thunder" | "drum";

/**
 * 가짜 신호 (속임수). 모두 화면(3D 연출 + 화면 가장자리 아이콘·글자)과 소리로 같이 나온다 — 소리를 꺼도 똑같이 보인다.
 * 진짜 신호는 화면 한가운데 커다란 ❗ + 징 + (휴대폰) 진동 — 모양·위치가 가짜와 다르다.
 */
export const FEINT_INFO: Record<FeintKind, { emoji: string; label: string; minHeat: number }> = {
  bird: { emoji: "🐦", label: "새가 날아올라요", minHeat: 0 },
  leaf: { emoji: "🍂", label: "낙엽이 흩날려요", minHeat: 0 },
  crow: { emoji: "🐦‍⬛", label: "까마귀가 울어요", minHeat: 1 },
  thunder: { emoji: "⚡", label: "마른 천둥!", minHeat: 1 },
  drum: { emoji: "🥁", label: "어디선가 북소리", minHeat: 2 },
};
export const FEINT_KINDS = Object.keys(FEINT_INFO) as FeintKind[];

/** 열기(라운드가 갈수록 오름)별 가짜 신호 수 [최소, 최대]. */
export function feintRange(heat: number): [number, number] {
  if (heat <= 0) return [0, 1];
  if (heat === 1) return [1, 2];
  return [1, 3];
}
/** 가짜 신호끼리, 그리고 진짜 신호와의 최소 간격. */
export const FEINT_GAP_MS = 550;

export const SEAT_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#f97316", "#06b6d4", "#ec4899"];
export const SEAT_COLOR_NAMES = ["빨강", "파랑", "초록", "노랑", "보라", "주황", "하늘", "분홍"];
/** 색만으로 구분하지 않도록 이름표에 붙는 모양 기호. */
export const SEAT_SYMBOLS = ["●", "■", "▲", "◆", "★", "✚", "⬟", "♥"];

export const ROUND_NAMES: Record<number, string> = { 1: "결승", 2: "준결승", 4: "8강" };
/** 대진표에서 남은 경기 수 → 라운드 이름. */
export function roundName(matchCount: number): string {
  return ROUND_NAMES[matchCount] ?? `${matchCount * 2}강`;
}
