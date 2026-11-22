import type { MatchState } from "./sim";

/**
 * 한 판의 상세 기록 (룰북 §12; 합치기 규칙: `max*`·`best*`는 큰 값, `min*`은 작은 값, 나머지는 더함).
 * finishes = 꼭대기 등정, roundWins = 라운드 1등 등정, caught = 붕괴에 휩쓸림, jumps · airJumps(🪶) ·
 * bounces(트램펄린), shoves · shoveHits, drops = 3m 넘게 떨어짐, cards = 쓴 방해 카드, sabHits = 내 낙석에
 * 맞은 사람, items, blocks = 🛡 막음, maxHeight = 가장 높이(m), minClimbSec = 가장 빠른 등정(초), maxScore.
 */
export function crumbleClimbStatDetails(state: MatchState, seat: number): Record<string, number> {
  const p = state.players[seat];
  if (!p) return {};
  const st = p.stats;
  const out: Record<string, number> = {
    rounds: state.history.length,
    finishes: st.finishes,
    roundWins: st.roundWins,
    caught: st.caught,
    jumps: st.jumps,
    airJumps: st.airJumps,
    bounces: st.bounces,
    shoves: st.shoves,
    shoveHits: st.shoveHits,
    drops: st.drops,
    cards: st.cards,
    sabHits: st.sabHits,
    items: st.items,
    blocks: st.blocks,
    maxHeight: Math.round(st.bestHeight),
    maxScore: p.score,
  };
  if (st.fastestMs > 0) out.minClimbSec = Math.round(st.fastestMs / 1000);
  return out;
}
