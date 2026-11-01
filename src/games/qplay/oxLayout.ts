import type { Seat } from "./engine";

/**
 * OX 광장 자리 배치(순수 계산 — OxArena와 테스트가 같이 쓴다).
 * 광장 높이: 휴대폰 288px(h-72) / sm 이상 320px(h-80). 말 크기: 남 36px(+링 2) / 나 44px(+링 3), 이름표 15px.
 */

export type Pos = { x: number; y: number };

/** 말 하나(말+이름표)가 차지하는 폭(광장 폭의 %) — 열 간격 `COL_GAP`보다 좁아야 8명이 한쪽에 몰려도 안 겹친다. */
export const TOKEN_W = 15;
export const COL_GAP = 16.5;
const ROW_GAP = 24;

/**
 * 좌석별 고정 자리(구역 안 3열 × 3행) — 다른 사람이 움직여도 내 자리가 밀리지 않게.
 * 아직 안 고른 사람은 가운데 선 양옆 두 줄(짝수 좌석 왼쪽·홀수 오른쪽, 좌우 17%, 위아래 23.5%).
 */
export function slot(seat: Seat, zone: number | null): Pos {
  if (zone === null) return { x: 50 + (seat % 2 ? 8.5 : -8.5), y: 15 + Math.floor(seat / 2) * 23.5 };
  const col = seat % 3;
  const row = Math.floor(seat / 3);
  return { x: zone * 50 + 8.5 + col * COL_GAP, y: 26 + row * ROW_GAP + (col === 1 ? 3 : 0) };
}

/** 말+이름표 상자(px) — 가운데 기준 위아래. 말 위쪽에 링, 아래에 2px 틈 + 이름표. */
export function tokenBox(pos: Pos, fieldW: number, fieldH: number, me: boolean): { l: number; r: number; t: number; b: number } {
  const cx = (pos.x / 100) * fieldW;
  const cy = (pos.y / 100) * fieldH;
  const disc = me ? 44 + 6 : 36 + 4;
  const h = disc + 2 + 15;
  const w = Math.max((TOKEN_W / 100) * fieldW, disc);
  return { l: cx - w / 2, r: cx + w / 2, t: cy - h / 2, b: cy + h / 2 };
}
