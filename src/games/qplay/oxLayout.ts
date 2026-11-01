import type { Seat } from "./engine";

/**
 * OX 광장 자리 배치(순수 계산 — OxArena와 테스트가 같이 쓴다).
 * 광장 높이: 휴대폰 288px(h-72) / sm 이상 320px(h-80). 말: 남 36px(+링 2) / 나 40px(+링 2), 이름표 15px.
 *
 * 가로 배치(%): [⭕ 2열: 9.5 · 25.5] [가운데 통로 2열: 41.5 · 58.5] [❌ 2열: 74.5 · 90.5].
 * 말 폭 15% < 열 간격 16%, ⭕ 오른쪽 열 끝(33) < 통로 왼쪽 열 시작(34) — 안 고른 사람(통로)과
 * 고른 사람(구역)이 어떤 조합으로 섞여도 안 겹친다. 세로는 4행(21% 간격 ≥ 말+이름표).
 */

export type Pos = { x: number; y: number };

/** 말 하나(말+이름표)가 차지하는 폭(광장 폭의 %). */
export const TOKEN_W = 15;
const ZONE_COLS = [9.5, 25.5];
const LANE_COLS = [41.5, 58.5];
const ROWS = [21, 42, 63, 84];

/** 좌석별 고정 자리 — 다른 사람이 움직여도 내 자리가 밀리지 않게. 좌석 s는 어느 구역에서든 (s%2열, s/2행). */
export function slot(seat: Seat, zone: number | null): Pos {
  const col = seat % 2;
  const y = ROWS[Math.floor(seat / 2) % ROWS.length];
  if (zone === null) return { x: LANE_COLS[col], y };
  return { x: zone * 65 + ZONE_COLS[col], y };
}

/** 말+이름표 상자(px) — 가운데 기준. 말(링 포함) 아래 2px 틈 + 이름표. */
export function tokenBox(pos: Pos, fieldW: number, fieldH: number, me: boolean): { l: number; r: number; t: number; b: number } {
  const cx = (pos.x / 100) * fieldW;
  const cy = (pos.y / 100) * fieldH;
  const disc = me ? 40 + 4 : 36 + 4;
  const h = disc + 2 + 15;
  const w = Math.max((TOKEN_W / 100) * fieldW, disc);
  return { l: cx - w / 2, r: cx + w / 2, t: cy - h / 2, b: cy + h / 2 };
}

/** 공개 배지(✔ 정답 / ✘ 오답)가 차지하는 위쪽 띠(px) — 첫 행 말은 이 아래에 있어야 한다. */
export const BADGE_BOTTOM_PX = 28;
