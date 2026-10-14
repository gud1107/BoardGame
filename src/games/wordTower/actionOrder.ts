/**
 * 방장 판정 순서 — 손님은 행동을 방장에게 "요청"만 하고, 방장이 받은 순서대로 번호(seq)를 붙여
 * 다시 방송한다. 모든 기기는 그 번호 순서대로만 적용하므로, 거의 동시에 낸 정답도 어느 기기에서나
 * 같은 사람이 차지한다(브로드캐스트는 보낸 사람이 다르면 기기마다 도착 순서가 다를 수 있다).
 *
 * `game`은 판마다 다른 시드 — "다시하기" 직후 지난 판의 늦은 메시지를 걸러 낸다.
 */
export interface OrderedCursor {
  game: number;
  /** 마지막으로 적용한 번호(0 = 아직 없음). */
  applied: number;
}

export type OrderVerdict = "apply" | "duplicate" | "gap" | "other-game";

export function judgeOrdered(cursor: OrderedCursor, game: number, seq: number): OrderVerdict {
  if (game !== cursor.game) return "other-game";
  if (seq <= cursor.applied) return "duplicate";
  if (seq > cursor.applied + 1) return "gap";
  return "apply";
}

/** 상태 동기화 응답을 받아들일지 — 같은 판에서 내가 이미 더 많이 적용했으면 무시. */
export function acceptSync(cursor: OrderedCursor | null, game: number, seq: number): boolean {
  if (!cursor || cursor.game !== game) return true;
  return seq > cursor.applied;
}
