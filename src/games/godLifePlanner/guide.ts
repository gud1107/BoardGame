/**
 * 갓생 플래너 화면 안내 문구 — 처음 하는 사람이 "지금 무엇을 해야 하는지"를 알 수 있게
 * 오늘 상황(이벤트·몸살·무기력·습관·마지막 날 등)에 맞춘 팁을 고른다. 엔진 규칙은 바꾸지 않는다.
 */

import { ACTIVITY_INFO, BLOCK_INFO, TEMPTATIONS, TUNING, type Activity, type EventId } from "./data";
import { canResist, goalIdOf, goalProgressInfo, resistCost, temptationOf, totalDays, type GameState, type Seat } from "./engine";

/** 활동 버튼을 골랐을 때 보여 주는 한 줄 설명 */
export const ACTIVITY_HELP: Record<Activity, string> = {
  sleep: "밤(B1·B2·B8)에 자면 체력 +2, 낮잠은 +1. 밤잠이 2블록 미만이면 마감 때 체력 −2·멘탈 −1.",
  study: "체력 −1 · 멘탈 −1 → 📘 지식 +2 (B3 아침이면 +1 더)",
  exercise: "체력 −2 → 💪 몸 +2 (B3 아침·B7 저녁이면 +1 더)",
  work: "체력 −1 · 멘탈 −1 → 💰 자산 +2. 평일 B4~B6 밖이면 야근(멘탈 −1 더, 자산 +1 더)",
  meet: "체력 −1 → 🤝 관계 +1 (B7 +1). 같은 블록에 약속 잡은 사람이 있으면 성사 — 관계·멘탈 +1 더",
  rest: "☕ 멘탈 +2 — 멘탈을 채우는 가장 확실한 방법",
  empty: "아무것도 안 함. 비용도 성장도 없어요",
};

/** 오늘의 이벤트별 "그래서 어떻게 하면 좋나" */
export const EVENT_TIPS: Record<EventId, string> = {
  E1: "공부·일이 멘탈을 1 더 먹어요. 휴식을 한 칸 더 넣거나 운동·약속 위주로 짜 보세요.",
  E2: "운동 아침·저녁 보너스가 없어요. 대신 휴식이 멘탈 +3이라 회복하기 좋은 날이에요.",
  E3: "어느 시간에 운동해도 몸 +1 더. 💪 몸을 몰아서 키울 기회예요.",
  E4: "일을 하면 자산 +1 더. 오늘 일을 한 칸도 안 하면 마감 때 멘탈 −1이에요.",
  E5: "공부 지식 +1 더. 대신 약속의 기본 관계 +1이 사라져요(성사 보너스는 그대로).",
  E6: "B7·B8 약속은 혼자 잡아도 성사돼요. 관계를 올리기 쉬운 날!",
  E7: "모두 B7(18–21)에 강제로 야근해요(🔒 칸). 나머지 블록에서 체력·멘탈을 아껴 두세요.",
  E8: "밤잠(B1·B2·B8)이 멘탈도 +1 채워 줘요. 푹 자기 좋은 날.",
  E9: "약속이 성사되면 관계 +2 더. 오늘 약속을 한 칸도 안 잡으면 마감 때 관계 −1이에요.",
  E10: "유혹을 참는 데 멘탈이 1 더 들어요. 멘탈이 넉넉하지 않으면 넘어가는 편이 나을 수도 있어요.",
  E11: "아침에 모두 멘탈 +2를 받았어요. 공부·일을 평소보다 더 넣어도 버틸 수 있어요.",
  E12: "마감 때 체력이 4 이하면 내일 몸살(운동 불가)이에요. 체력을 5 이상 남기세요.",
  SAT: "주말이라 근무시간이 없어요 — 일은 모두 특근(야근 취급). 약속은 관계 +1 더.",
  SUN: "주말 효과에 휴식 멘탈 +1. 마지막 날이라면 남은 게이지도 점수에 들어가요.",
};

export type GuideTone = "warn" | "info" | "good";
export interface GuideNote {
  icon: string;
  title: string;
  text: string;
  tone: GuideTone;
}

const tag = (b: number) => `${BLOCK_INFO[b].label}(${BLOCK_INFO[b].time})`;

/** 계획 단계에서 이 자리에게 해당하는 상황 안내(중요한 것부터). */
export function situationNotes(state: GameState, seat: Seat): GuideNote[] {
  const s = state.seats[seat];
  const out: GuideNote[] = [];
  const yesterday = state.day > 0 ? s.days[state.day - 1] : undefined;
  const lastDay = state.day + 1 >= totalDays(state);
  const habitDays = state.options.easyHabit ? 2 : 3;

  if (yesterday?.exhausted) out.push({ icon: "🚑", title: "어제 탈진 → 응급 회복", text: `체력이 최소 ${TUNING.emergencyFloor}까지 회복됐지만 오늘은 몸살이에요.`, tone: "warn" });
  if (yesterday?.burnout) out.push({ icon: "🚑", title: "어제 번아웃 → 응급 회복", text: `멘탈이 최소 ${TUNING.emergencyFloor}까지 회복됐지만 오늘은 무기력이에요.`, tone: "warn" });
  if (s.sick) out.push({ icon: "🤒", title: "몸살", text: "오늘은 운동을 할 수 없어요. 수면·휴식으로 체력을 채우고 공부·약속으로 성장하세요.", tone: "warn" });
  if (s.apathy) out.push({ icon: "😶", title: "무기력", text: "오늘은 공부·일을 할 수 없고 유혹도 참을 수 없어요. 휴식으로 멘탈을 채우고 운동·약속을 해 보세요.", tone: "warn" });
  if (yesterday && yesterday.plan.temptation === "yield" && TEMPTATIONS[yesterday.temptationId]?.nextMorningHp)
    out.push({ icon: "🍺", title: "숙취", text: "어제 술자리 때문에 아침 체력이 2 줄었어요.", tone: "warn" });

  if (s.hp <= 3) out.push({ icon: "⚡", title: `체력 ${s.hp} — 위험`, text: "체력이 0이 되면 탈진(−3점, 남은 블록 날아감). 밤잠(B1·B2·B8 수면)을 꼭 넣으세요.", tone: "warn" });
  if (s.mp <= 3) out.push({ icon: "💗", title: `멘탈 ${s.mp} — 위험`, text: "멘탈이 0이 되면 번아웃(−3점). ☕ 휴식(멘탈 +2)을 1~2칸 넣으세요.", tone: "warn" });

  if (!canResist(state, seat)) {
    const why = s.apathy ? "무기력이라" : `멘탈이 ${resistCost(state) + 1} 이상이어야 하는데 지금 ${s.mp}라서`;
    out.push({ icon: "😈", title: "유혹을 참을 수 없어요", text: `${why} 오늘 유혹(${temptationOf(state, seat).name})에 넘어가야 해요. 놓을 블록을 골라 피해를 줄이세요.`, tone: "warn" });
  }

  for (const h of s.habits)
    if (h.shaken)
      out.push({ icon: "⚠️", title: `${tag(h.block)} ${ACTIVITY_INFO[h.activity].name} 습관이 흔들려요`, text: "오늘 같은 블록에 같은 활동을 성공하면 회복, 또 빠지면 습관이 사라져요(−2점).", tone: "warn" });

  for (let b = 0; b < s.streak.length; b++) {
    const st = s.streak[b];
    if (!st.activity || st.count !== habitDays - 1 || s.habits.some((h) => h.block === b)) continue;
    out.push({ icon: "🌱", title: `${tag(b)} ${ACTIVITY_INFO[st.activity].name} — 오늘 하면 습관!`, text: `${st.count}일 연속이에요. 오늘도 같은 블록에 하면 습관이 생겨 비용 −1·성장 +1, 점수 +2.`, tone: "good" });
  }

  const friend = state.friendBlocks[state.day];
  if (friend !== null) out.push({ icon: "🧑‍🤝‍🧑", title: `친구는 ${tag(friend)}에 시간 있음`, text: "그 블록에 🤝 약속을 잡으면 혼자여도 성사돼요(관계 +1, 멘탈 +1 더).", tone: "info" });
  else if (state.seatCount > 1 && state.day === 0)
    out.push({ icon: "🤝", title: "약속은 같은 시간에", text: "다른 사람과 같은 블록에 약속을 잡아야 성사돼요(관계·멘탈 +1 더). 혼자 나가면 기본 관계 +1만 받아요.", tone: "info" });

  const goalId = goalIdOf(state, seat);
  if (goalId) {
    const g = goalProgressInfo(goalId, s, state.options.days === 5);
    if (!g.met && lastDay) out.push({ icon: "🤫", title: "오늘이 인생 목표 마지막 기회", text: `지금 ${g.label}. 오늘 안에 채워야 보너스 점수를 받아요.`, tone: "info" });
  }

  if (lastDay)
    out.push({ icon: "🏁", title: "마지막 날", text: "내일이 없으니 체력·멘탈을 아낄 필요가 없어요. 남은 (체력+멘탈)÷4만 점수가 돼요 — 단 0이 되면 −3점.", tone: "info" });
  else if (state.day === 0)
    out.push({ icon: "💡", title: "첫날 팁", text: `같은 블록에 같은 활동을 ${habitDays}일 이어 하면 습관이 돼요. 오늘 짠 계획이 내일 그대로 복사되니 "매일 할 루틴"을 생각하며 짜 보세요.`, tone: "info" });

  return out;
}
