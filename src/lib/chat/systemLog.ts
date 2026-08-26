/**
 * Pure system-log line formatters for the in-game chat system-log pilot
 * (Perudo + Dalmuti — see HANDOFF.md). Deliberately take already-resolved
 * plain values (names, numbers, titles) instead of importing either game's
 * `engine.ts` — the reducers stay pure and untouched; the calling
 * `*Game.tsx` component resolves seat -> name/title itself (it already has
 * that data in scope for its own UI) and only hands this formatter the
 * strings/numbers needed to build the sentence.
 */

/** e.g. "지수님이 1번 주사위를 3개 베팅했습니다" for a Perudo `raise` action. */
export function formatPerudoRaiseLog(name: string, quantity: number, face: number): string {
  return `${name}님이 ${face}번 주사위를 ${quantity}개 베팅했습니다`;
}

/** e.g. "왕(지수)와 거지(민준)가 카드를 교환했습니다" for a Dalmuti `returnTax` action. */
export function formatDalmutiTributeLog(
  fromName: string,
  fromTitle: string,
  toName: string,
  toTitle: string,
): string {
  return `${fromTitle}(${fromName})와 ${toTitle}(${toName})가 카드를 교환했습니다`;
}
