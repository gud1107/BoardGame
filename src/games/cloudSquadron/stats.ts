import { PILOT_IDS } from "./data";
import type { MatchState } from "./sim";

/**
 * 한 판의 상세 기록 (룰북 §12; 합치기 규칙: `max*`는 큰 값, 나머지는 더함).
 * clears = 원정 성공, stagesCleared = 돌파한 스테이지, bossKills = 보스 격파(피해를 준 판),
 * kills = 격추한 적, revives = 쓰러진 동료를 구함, downs = 격추당함, grazes = 스침, ults = 궁극기,
 * combos = 합동 궁극기, skills = 스킬, items = 주운 아이템, hits = 맞은 횟수,
 * noHitClears = 한 번도 안 맞고 원정 성공, maxScore = 한 판 점수, pilot_<id> = 그 조종사로 출격한 판.
 */
export function cloudSquadronStatDetails(state: MatchState, seat: number): Record<string, number> {
  const p = state.players[seat];
  if (!p) return {};
  const st = p.stats;
  const clear = state.result === "clear" ? 1 : 0;
  const out: Record<string, number> = {
    clears: clear,
    stagesCleared: state.history.length,
    bossKills: st.bossKills,
    kills: st.kills,
    revives: st.revives,
    downs: st.downs,
    grazes: st.grazes,
    ults: st.ults,
    combos: st.combos,
    skills: st.skills,
    items: st.items,
    hits: st.hits,
    noHitClears: clear && st.hits === 0 ? 1 : 0,
    maxScore: p.score,
  };
  for (const id of PILOT_IDS) out[`pilot_${id}`] = p.pilot === id ? 1 : 0;
  return out;
}
